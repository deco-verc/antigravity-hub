import crypto from 'node:crypto';
import { db } from './db.js';
import { Logger } from './logger.js';

// ----------------------------------------------------------------
// Worker status states
// READY        — registered and available to receive tasks
// STARTING     — new conversation being spawned
// WORKING      — actively executing a task (holds a lease)
// PAUSED       — manually paused by user
// WAITING      — no task available, run exists but waiting
// OFFLINE      — last heartbeat > 60s ago
// ERROR        — last action resulted in unrecoverable error
// NEEDS_AUTH   — authentication failure detected
// ----------------------------------------------------------------
export type WorkerStatus =
  | 'READY'
  | 'STARTING'
  | 'WORKING'
  | 'PAUSED'
  | 'WAITING'
  | 'OFFLINE'
  | 'ERROR'
  | 'NEEDS_AUTH'
  | 'COOLDOWN';

export interface Worker {
  id: string;
  name: string;
  provider: string;
  account_label: string | null;
  account_profile_id?: string | null;
  environment: string;
  status: WorkerStatus;
  conversation_id: string | null;
  current_run_id: string | null;
  current_issue_number: number | null;
  current_task_id: string | null;
  workspace: string | null;
  pid: number | null;
  last_heartbeat: string | null;
  last_activity: string | null;
  last_checkpoint: string | null;
  last_error: string | null;
  capabilities: string[];
  created_at: string;
  updated_at: string;
}

export type WorkerProbeFn = (profile: any) => Promise<{ conversationId: string; pid: number }>;

export interface WorkerLease {
  id: string;
  worker_id: string;
  run_id: string;
  task_id: string;
  issue_number: number | null;
  claimed_at: string;
  lease_until: string;
  last_heartbeat: string;
  status: 'active' | 'released' | 'expired';
  released_at: string | null;
}

// Lease duration: 60 seconds. Worker must renew every ~15s.
const LEASE_DURATION_MS = 60 * 1000;
const HEARTBEAT_OFFLINE_THRESHOLD_MS = 60 * 1000;

export class WorkerRegistry {
  private static _probeOverride: WorkerProbeFn | null = null;

  static setProbeOverrideForTest(probe: WorkerProbeFn | null): void {
    this._probeOverride = probe;
  }

  // ----------------------------------------------------------------
  // WORKER CRUD
  // ----------------------------------------------------------------

  static createWorker(opts: {
    name: string;
    provider?: string;
    account_label?: string;
    account_profile_id?: string;
    environment?: string;
    capabilities?: string[];
  }): Worker {
    const now = new Date().toISOString();
    const id = `worker-${crypto.randomUUID().slice(0, 8)}`;
    db.prepare(`
      INSERT INTO workers (id, name, provider, account_label, account_profile_id, environment, status, capabilities_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'OFFLINE', ?, ?, ?)
    `).run(
      id,
      opts.name,
      opts.provider || 'antigravity',
      opts.account_label || null,
      opts.account_profile_id || null,
      opts.environment || 'local',
      JSON.stringify(opts.capabilities || ['build', 'test', 'review', 'git']),
      now,
      now
    );
    Logger.info(`[WorkerRegistry] Worker criado: ${id} ("${opts.name}") [Env: ${opts.environment || 'local'}]`);
    return this.getWorker(id)!;
  }

  static getWorker(id: string): Worker | null {
    const row: any = db.prepare('SELECT * FROM workers WHERE id = ?').get(id);
    if (!row) return null;
    return this._rowToWorker(row);
  }

  static getAllWorkers(): Worker[] {
    const rows: any[] = db.prepare('SELECT * FROM workers ORDER BY created_at ASC').all();
    return rows.map(this._rowToWorker);
  }

  static getReadyWorkers(): Worker[] {
    const rows: any[] = db.prepare("SELECT * FROM workers WHERE status = 'READY' AND account_profile_id IS NOT NULL AND conversation_id IS NOT NULL AND pid IS NOT NULL ORDER BY created_at ASC").all();
    const cutoff = Date.now() - HEARTBEAT_OFFLINE_THRESHOLD_MS;
    return rows.filter(row => {
      if (!row.last_heartbeat || new Date(row.last_heartbeat).getTime() < cutoff) return false;
      try { process.kill(row.pid, 0); } catch { return false; }
      if (row.account_profile_id) {
        const profile: any = db.prepare('SELECT auth_status, quota_resets_at FROM account_profiles WHERE id = ?').get(row.account_profile_id);
        if (profile) {
          if (profile.auth_status === 'QUOTA_EXHAUSTED') {
            if (profile.quota_resets_at && Date.now() >= new Date(profile.quota_resets_at).getTime()) {
              // Quota reset time passed, will be refreshed
            } else {
              return false;
            }
          } else if (profile.auth_status === 'LOGIN_REQUIRED' || profile.auth_status === 'ERROR') {
            return false;
          }
        }
      }
      return true;
    }).map(this._rowToWorker);
  }

  static updateWorkerStatus(workerId: string, status: WorkerStatus, extra?: Partial<{
    conversation_id: string | null;
    current_run_id: string | null;
    current_issue_number: number | null;
    current_task_id: string | null;
    last_error: string | null;
    last_checkpoint: string;
    pid: number | null;
  }>): void {
    const now = new Date().toISOString();
    const fields: string[] = ['status = ?', 'updated_at = ?', 'last_activity = ?'];
    const values: any[] = [status, now, now];

    if (extra) {
      for (const [key, val] of Object.entries(extra)) {
        fields.push(`${key} = ?`);
        values.push(val ?? null);
      }
    }

    values.push(workerId);
    db.prepare(`UPDATE workers SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }

  static updateWorkerHeartbeat(workerId: string): void {
    const now = new Date().toISOString();
    db.prepare('UPDATE workers SET last_heartbeat = ?, updated_at = ? WHERE id = ?').run(now, now, workerId);
  }

  static deleteWorker(workerId: string): void {
    // Release any active lease first
    this.releaseAllLeases(workerId);
    db.prepare('DELETE FROM workers WHERE id = ?').run(workerId);
    Logger.info(`[WorkerRegistry] Worker removido: ${workerId}`);
  }

  static pauseWorker(workerId: string): void {
    this.updateWorkerStatus(workerId, 'PAUSED');
    this.logActivity(workerId, 'WORKER_PAUSED', 'Worker pausado manualmente pelo operador.', {});
    Logger.info(`[WorkerRegistry] Worker ${workerId} pausado.`);
  }

  static resumeWorker(workerId: string): void {
    this.updateWorkerStatus(workerId, 'READY');
    this.logActivity(workerId, 'WORKER_RESUMED', 'Worker retomado para estado READY.', {});
    Logger.info(`[WorkerRegistry] Worker ${workerId} reativado para READY.`);
  }

  static ensureDefaultWorkers(): Worker[] {
    // Historical placeholder workers remain visible, but are never made READY.
    return this.getAllWorkers();
  }

  /**
   * Ensures at least one healthy, authenticated Worker is available for the active AccountProfile.
   * If existing workers are OFFLINE/ERROR or unlinked, links or creates a Worker tied to active profile,
   * verifies Antigravity agentapi connectivity, updates heartbeat and marks status as READY.
   */
  static async ensureWorkerAvailable(projectId?: string): Promise<Worker | null> {
    const { AccountProfileManager } = await import('./accountProfileManager.js');
    const { AntigravityProvider } = await import('./antigravityProvider.js');

    const activeProfile = AccountProfileManager.getActiveProfileForProject(projectId);
    if (!activeProfile) {
      Logger.warn('[WorkerRegistry] Nenhum AccountProfile configurado.');
      return null;
    }

    // 1. Reuse only a recently probed worker bound to this exact profile and live runtime.
    const all = this.getAllWorkers();
    const existingActive = this.getReadyWorkers().find(w => w.account_profile_id === activeProfile.id);

    if (existingActive) {
      return existingActive;
    }

    Logger.info(`[WorkerRegistry] [worker-bootstrap-started] Iniciando bootstrap de Worker para perfil "${activeProfile.display_name}" (${activeProfile.id})...`);

    // 2. Test agentapi connectivity with isolated execution environment
    let testConvId: string | null = null;
    let workerPid: number | null = null;

    if (this._probeOverride) {
      try {
        const probeRes = await this._probeOverride(activeProfile);
        testConvId = probeRes.conversationId;
        workerPid = probeRes.pid;
        Logger.success(`[WorkerRegistry] [worker-agentapi-ready] Conexão mock/probed validada com sucesso (Conv: ${testConvId}).`);
        AccountProfileManager.updateStatus(activeProfile.id, 'READY');
      } catch (err: any) {
        Logger.error(`[WorkerRegistry] Falha no readiness check do Worker probe: ${err.message}`);
        AccountProfileManager.updateStatus(activeProfile.id, 'LOGIN_REQUIRED');
        return null;
      }
    } else {
      let profileEnv: NodeJS.ProcessEnv;
      let runtime: { pid: number } | null;
      try {
        runtime = AccountProfileManager.getRunningInstanceForProfile(activeProfile.environment_path);
        if (!runtime) {
          AccountProfileManager.launchLogin(activeProfile.id);
          const deadline = Date.now() + 20000;
          while (!runtime && Date.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, 1500));
            runtime = AccountProfileManager.getRunningInstanceForProfile(activeProfile.environment_path);
          }
        }
        if (!runtime) throw new Error('AGENTAPI_UNAVAILABLE: Antigravity não iniciou um runtime para este perfil em 20 segundos');
        profileEnv = AccountProfileManager.getExecutionEnvForProfile(activeProfile);
        workerPid = runtime.pid;
      } catch (err: any) {
        Logger.error(`[WorkerRegistry] ${err.message}`);
        return null;
      }
      try {
        const { ConversationManager } = await import('./conversationManager.js');
        const probeResult = ConversationManager.getOrCreateConversation({
          accountProfileId: activeProfile.id,
          role: 'probe',
          model: 'flash',
          env: profileEnv,
          initialPrompt: `Ping de prontidão para o Worker do perfil ${activeProfile.display_name}.`
        });
        testConvId = probeResult.conversationId;
        Logger.success(`[WorkerRegistry] [worker-agentapi-ready] Conexão agentapi validada com sucesso (Conv: ${testConvId}, Reused: ${!probeResult.isNew}).`);
        AccountProfileManager.updateStatus(activeProfile.id, 'READY');
      } catch (err: any) {
        Logger.error(`[WorkerRegistry] Falha no readiness check do Antigravity agentapi: ${err.message}`);
        AccountProfileManager.updateStatus(activeProfile.id, 'LOGIN_REQUIRED');
        return null;
      }
    }

    // 3. Find an existing worker to revive or create a new one
    let targetWorker = all.find(w => w.account_profile_id === activeProfile.id);

    const now = new Date().toISOString();
    if (targetWorker) {
      db.prepare(`
        UPDATE workers
        SET account_profile_id = ?, account_label = ?, status = 'READY',
            conversation_id = ?, pid = ?, last_error = NULL, current_task_id = NULL, current_run_id = NULL, current_issue_number = NULL, last_heartbeat = ?, updated_at = ?, last_activity = ?
        WHERE id = ?
      `).run(
        activeProfile.id,
        activeProfile.google_account_label || activeProfile.display_name,
        testConvId,
        workerPid,
        now,
        now,
        now,
        targetWorker.id
      );
      Logger.info(`[WorkerRegistry] [worker-registered] Worker existente ${targetWorker.id} atualizado e vinculado ao perfil ${activeProfile.id}.`);
    } else {
      targetWorker = this.createWorker({
        name: `Worker 1 (${activeProfile.display_name})`,
        account_label: activeProfile.google_account_label || activeProfile.display_name,
        account_profile_id: activeProfile.id,
        environment: 'local'
      });
      db.prepare('UPDATE workers SET conversation_id = ?, pid = ?, status = ?, current_task_id = NULL, current_run_id = NULL, current_issue_number = NULL, last_heartbeat = ? WHERE id = ?')
        .run(testConvId, workerPid, 'READY', now, targetWorker.id);
      Logger.info(`[WorkerRegistry] [worker-registered] Novo worker criado: ${targetWorker.id}`);
    }

    this.updateWorkerHeartbeat(targetWorker.id);
    this.logActivity(targetWorker.id, 'WORKER_BOOTSTRAP', `Worker inicializado com sucesso para perfil ${activeProfile.display_name}.`, {
      profileId: activeProfile.id,
      conversationId: testConvId
    });

    Logger.success(`[WorkerRegistry] [worker-ready] Worker ${targetWorker.id} está ONLINE e READY para receber tarefas.`);
    return this.getWorker(targetWorker.id);
  }

  static async testWorker(workerId: string): Promise<{ success: boolean; message: string; conversationId?: string }> {
    const worker = this.getWorker(workerId);
    if (!worker) return { success: false, message: 'Worker não encontrado' };

    try {
      const { AntigravityProvider } = await import('./antigravityProvider.js');
      const { AccountProfileManager } = await import('./accountProfileManager.js');

      const profile = worker.account_profile_id
        ? AccountProfileManager.getProfile(worker.account_profile_id)
        : AccountProfileManager.getGlobalActiveProfile();
      const profileEnv = profile ? AccountProfileManager.getExecutionEnvForProfile(profile) : undefined;
      const provider = new AntigravityProvider(profileEnv);

      let convId = worker.conversation_id;
      if (!convId) {
        convId = await provider.startAgent({
          model: 'flash',
          title: `Test Agent: ${worker.name}`,
          initialPrompt: `Ping de teste para ${worker.name}. Responda confirmando prontidão.`,
          env: profileEnv
        });
        this.updateWorkerStatus(workerId, worker.status === 'WORKING' ? 'WORKING' : 'READY', {
          conversation_id: convId
        });
      }

      const status = await provider.getStatus(convId);
      this.updateWorkerHeartbeat(workerId);
      this.logActivity(workerId, 'WORKER_TESTED', `Teste executado com sucesso (Conv: ${convId.slice(0, 8)}, State: ${status.state}).`, {
        conversationId: convId,
        state: status.state
      });

      return {
        success: true,
        message: `Worker ${worker.name} respondendo normalmente (Conversation: ${convId.slice(0, 8)}, Status: ${status.state})`,
        conversationId: convId
      };
    } catch (err: any) {
      this.updateWorkerStatus(workerId, 'ERROR', { last_error: err.message });
      this.logActivity(workerId, 'WORKER_TEST_FAILED', `Falha no teste do worker: ${err.message}`, { error: err.message });
      return { success: false, message: `Erro ao testar worker: ${err.message}` };
    }
  }

  // ----------------------------------------------------------------
  // LEASE MANAGEMENT
  // ----------------------------------------------------------------

  /**
   * Atomically claim a task for a worker.
   * Returns the lease id, or null if claim failed (another worker beat us to it).
   */
  static claimTask(workerId: string, runId: string, taskId: string, issueNumber?: number): string | null {
    const now = new Date();
    const leaseUntil = new Date(now.getTime() + LEASE_DURATION_MS);
    const leaseId = crypto.randomUUID();

    db.exec('BEGIN IMMEDIATE');
    try {
      const task: any = db.prepare("SELECT status FROM autonomous_tasks WHERE id = ? AND run_id = ?").get(taskId, runId);
      const worker: any = db.prepare("SELECT status FROM workers WHERE id = ?").get(workerId);
      const existing: any = db.prepare("SELECT id FROM worker_leases WHERE task_id = ? AND status = 'active'").get(taskId);
      if (!task || task.status !== 'ready' || !worker || worker.status !== 'READY' || existing) {
        db.exec('ROLLBACK');
        return null;
      }
      db.prepare(`
        INSERT INTO worker_leases (id, worker_id, run_id, task_id, issue_number, claimed_at, lease_until, last_heartbeat, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')
      `).run(leaseId, workerId, runId, taskId, issueNumber ?? null, now.toISOString(), leaseUntil.toISOString(), now.toISOString());
      this.updateWorkerStatus(workerId, 'WORKING', {
        current_run_id: runId,
        current_task_id: taskId,
        current_issue_number: issueNumber ?? null,
      });
      this.updateWorkerHeartbeat(workerId);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    this.logActivity(workerId, 'LEASE_CLAIMED', `Worker claimed task ${taskId.slice(0, 8)} (issue #${issueNumber ?? 'N/A'}) with lease until ${leaseUntil.toISOString()}`, {
      runId, taskId, issueNumber, leaseId
    });

    Logger.info(`[WorkerRegistry] Lease ${leaseId.slice(0, 8)} criada: Worker ${workerId} → Task ${taskId.slice(0, 8)}`);
    return leaseId;
  }

  /**
   * Renew a lease heartbeat (extend lease_until by another 60s).
   */
  static renewLease(leaseId: string, workerId: string): boolean {
    const now = new Date();
    const newUntil = new Date(now.getTime() + LEASE_DURATION_MS);

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = db.prepare(`
          UPDATE worker_leases
          SET lease_until = ?, last_heartbeat = ?
          WHERE id = ? AND worker_id = ? AND status = 'active'
        `).run(newUntil.toISOString(), now.toISOString(), leaseId, workerId);

        if ((result as any).changes > 0) {
          this.updateWorkerHeartbeat(workerId);
          return true;
        }
        return false;
      } catch (err: any) {
        if (attempt === 2) {
          Logger.warn(`[WorkerRegistry] Falha ao renovar lease ${leaseId.slice(0, 8)} após 3 tentativas: ${err.message}`);
          return false;
        }
        // Small backoff before retry
        const waitUntil = Date.now() + 50;
        while (Date.now() < waitUntil) {}
      }
    }
    return false;
  }

  /**
   * Release a lease explicitly (task done or worker stopping).
   */
  static releaseLease(leaseId: string, workerId: string): void {
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE worker_leases
      SET status = 'released', released_at = ?
      WHERE id = ? AND worker_id = ?
    `).run(now, leaseId, workerId);

    this.logActivity(workerId, 'LEASE_RELEASED', `Worker released lease ${leaseId.slice(0, 8)}`, { leaseId });
    Logger.info(`[WorkerRegistry] Lease ${leaseId.slice(0, 8)} liberada pelo Worker ${workerId}`);
  }

  /**
   * Release all leases for a worker (on shutdown/error).
   */
  static releaseAllLeases(workerId: string): void {
    const now = new Date().toISOString();
    const leases: any[] = db.prepare("SELECT id, task_id FROM worker_leases WHERE worker_id = ? AND status = 'active'").all(workerId);
    for (const lease of leases) {
      db.prepare("UPDATE worker_leases SET status = 'released', released_at = ? WHERE id = ?").run(now, lease.id);
      // Reset task back to 'ready' so another worker can pick it up
      db.prepare("UPDATE autonomous_tasks SET status = 'ready', updated_at = ? WHERE id = ? AND status = 'in_progress'").run(now, lease.task_id);
      Logger.info(`[WorkerRegistry] Lease ${lease.id.slice(0, 8)} liberada e tarefa ${lease.task_id.slice(0, 8)} resetada para READY.`);
    }
  }

  /**
   * Expire leases whose heartbeat has gone cold (called by watchdog).
   */
  static expireStaleLeases(): { expired: number; resetTasks: string[] } {
    const now = new Date().toISOString();
    const stale: any[] = db.prepare(`
      SELECT * FROM worker_leases
      WHERE status = 'active' AND lease_until < ?
    `).all(now);

    const resetTasks: string[] = [];
    for (const lease of stale) {
      db.prepare("UPDATE worker_leases SET status = 'expired', released_at = ? WHERE id = ?").run(now, lease.id);
      db.prepare("UPDATE autonomous_tasks SET status = 'ready', updated_at = ? WHERE id = ? AND status = 'in_progress'").run(now, lease.task_id);
      db.prepare("UPDATE workers SET status = 'OFFLINE', current_task_id = NULL, current_run_id = NULL, current_issue_number = NULL, last_error = 'Lease expirada por ausência de heartbeat', updated_at = ? WHERE id = ?")
        .run(now, lease.worker_id);

      resetTasks.push(lease.task_id);
      this.logActivity(
        lease.worker_id,
        'LEASE_EXPIRED',
        `Lease ${lease.id.slice(0, 8)} expirou. Task ${lease.task_id.slice(0, 8)} retornou para READY.`,
        { leaseId: lease.id, taskId: lease.task_id }
      );
      Logger.warn(`[WorkerRegistry] Lease expirada: Worker ${lease.worker_id} perdeu task ${lease.task_id.slice(0, 8)}.`);
    }

    return { expired: stale.length, resetTasks };
  }

  /**
   * Get the active lease for a worker (if any).
   */
  static getActiveLease(workerId: string): WorkerLease | null {
    const row: any = db.prepare("SELECT * FROM worker_leases WHERE worker_id = ? AND status = 'active' ORDER BY claimed_at DESC LIMIT 1").get(workerId);
    if (!row) return null;
    return row as WorkerLease;
  }

  // ----------------------------------------------------------------
  // OFFLINE DETECTION
  // ----------------------------------------------------------------

  /**
   * Detect workers whose heartbeat is stale and mark them OFFLINE.
   */
  static detectOfflineWorkers(): string[] {
    const threshold = new Date(Date.now() - HEARTBEAT_OFFLINE_THRESHOLD_MS).toISOString();
    const stale: any[] = db.prepare(`
      SELECT id FROM workers
      WHERE status IN ('WORKING', 'WAITING', 'STARTING', 'READY')
      AND last_heartbeat IS NOT NULL
      AND last_heartbeat < ?
    `).all(threshold);

    const now = new Date().toISOString();
    for (const w of stale) {
      db.prepare("UPDATE workers SET status = 'OFFLINE', current_task_id = NULL, current_run_id = NULL, current_issue_number = NULL, updated_at = ? WHERE id = ?").run(now, w.id);
      this.releaseAllLeases(w.id);
      this.logActivity(w.id, 'WORKER_OFFLINE', 'Worker marcado OFFLINE por ausência de heartbeat (>60s)', {});
      Logger.warn(`[WorkerRegistry] Worker ${w.id} marcado OFFLINE por heartbeat ausente.`);
    }

    return stale.map((w: any) => w.id);
  }

  // ----------------------------------------------------------------
  // MATCHING: which worker should take which issue
  // ----------------------------------------------------------------

  /**
   * Simple greedy match: first READY worker gets the first available task.
   * Extensible: can add capability filtering, load balancing, etc.
   */
  static matchWorkerToTask(workers: Worker[], tasks: any[]): { worker: Worker; task: any } | null {
    for (const worker of workers) {
      // Skip workers already holding a lease
      const activeLease = this.getActiveLease(worker.id);
      if (activeLease) continue;

      for (const task of tasks) {
        return { worker, task };
      }
    }
    return null;
  }

  // ----------------------------------------------------------------
  // ACTIVITY LOG
  // ----------------------------------------------------------------

  static logActivity(
    workerId: string,
    eventType: string,
    message: string,
    meta: Record<string, any>
  ): void {
    db.prepare(`
      INSERT INTO worker_activity (id, worker_id, run_id, task_id, issue_number, event_type, message, metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      workerId,
      meta.runId ?? null,
      meta.taskId ?? null,
      meta.issueNumber ?? null,
      eventType,
      message,
      JSON.stringify(meta),
      new Date().toISOString()
    );
  }

  static getActivityLog(workerId: string, limit = 50): any[] {
    return db.prepare(
      'SELECT * FROM worker_activity WHERE worker_id = ? ORDER BY created_at DESC LIMIT ?'
    ).all(workerId, limit) as any[];
  }

  static getAllActivity(limit = 100): any[] {
    return db.prepare(
      'SELECT wa.*, w.name as worker_name FROM worker_activity wa JOIN workers w ON w.id = wa.worker_id ORDER BY wa.created_at DESC LIMIT ?'
    ).all(limit) as any[];
  }

  // ----------------------------------------------------------------
  // CONTEXT INJECTION PAYLOAD
  // ----------------------------------------------------------------

  /**
   * Build the context blob a Worker needs before starting any Issue.
   * Lives entirely in the Hub — not in the Antigravity conversation transcript.
   */
  static buildWorkerContext(opts: {
    worker: Worker;
    run: any;
    task: any;
    project: any;
    gitStatus?: string;
    lastCheckpoint?: string;
    githubIssueBody?: string;
    existingPrUrl?: string;
    decisions?: string;
    architecture?: string;
  }): string {
    const { worker, run, task, project, gitStatus, lastCheckpoint, githubIssueBody, existingPrUrl, decisions, architecture } = opts;
    return [
      `=== WORKER CONTEXT INJECTION ===`,
      `WORKER: ${worker.id} (${worker.name})`,
      `PROJECT: ${project.name}`,
      `PROJECT_PATH: ${project.path}`,
      `OBJECTIVE: ${project.objective || run.objective}`,
      ``,
      `=== CURRENT TASK ===`,
      `RUN: ${run.name} (${run.id.slice(0, 8)})`,
      `TASK: [${task.milestone}] ${task.title}`,
      `TASK_ID: ${task.id}`,
      `DESCRIPTION: ${task.description || ''}`,
      task.github_issue_number ? `GITHUB_ISSUE: #${task.github_issue_number}` : '',
      task.github_branch ? `CURRENT_BRANCH: ${task.github_branch}` : '',
      existingPrUrl ? `EXISTING_PR: ${existingPrUrl}` : '',
      githubIssueBody ? `\n=== GITHUB ISSUE BODY ===\n${githubIssueBody}` : '',
      gitStatus ? `\n=== GIT STATUS ===\n${gitStatus}` : '',
      lastCheckpoint ? `\n=== LAST CHECKPOINT ===\n${lastCheckpoint}` : '',
      decisions ? `\n=== DECISIONS ===\n${decisions}` : '',
      architecture ? `\n=== ARCHITECTURE ===\n${architecture}` : '',
      ``,
      `=== WORKER HANDOFF RULES ===`,
      `1. NÃO crie nova branch se github_branch já existe — faça checkout nela.`,
      `2. NÃO reabra Issues ou PRs já existentes — continue de onde o trabalho parou.`,
      `3. Contexto do projeto vem do HUB — não da conversa anterior.`,
      `4. Após concluir: git commit, push, atualizar PR existente ou abrir novo.`,
    ].filter(l => l !== '').join('\n');
  }

  // ----------------------------------------------------------------
  // PRIVATE HELPERS
  // ----------------------------------------------------------------

  private static _rowToWorker(row: any): Worker {
    return {
      id: row.id,
      name: row.name,
      provider: row.provider,
      account_label: row.account_label,
      account_profile_id: row.account_profile_id || null,
      environment: row.environment || 'local',
      status: row.status as WorkerStatus,
      conversation_id: row.conversation_id,
      current_run_id: row.current_run_id,
      current_issue_number: row.current_issue_number,
      current_task_id: row.current_task_id,
      workspace: row.workspace,
      pid: row.pid,
      last_heartbeat: row.last_heartbeat,
      last_activity: row.last_activity,
      last_checkpoint: row.last_checkpoint,
      last_error: row.last_error,
      capabilities: row.capabilities_json ? JSON.parse(row.capabilities_json) : [],
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}
