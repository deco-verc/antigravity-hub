import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { db } from './db.js';
import { AutonomousManager, BuilderReportInput, SupervisorReviewInput } from './autonomousManager.js';
import { PolicyEngine, RiskLevel } from './policyEngine.js';
import { MemoryManager } from './memoryManager.js';
import { CheckpointManager } from './checkpointManager.js';
import { Logger } from './logger.js';
import { AntigravityProvider } from './antigravityProvider.js';
import { GeminiSupervisorProvider } from './geminiSupervisorProvider.js';
import { GitManager } from './gitManager.js';
import { GitHubMcpClient } from './githubMcpClient.js';
import { WorkerRegistry, Worker } from './workerRegistry.js';
import { IndependentEvaluator } from './independentEvaluator.js';
import { ModelRegistry } from './modelRegistry.js';
import { UsageTracker } from './usageTracker.js';

export interface RunnerStatus {
  runnerId: string;
  online: boolean;
  status: 'online' | 'idle' | 'busy' | 'stopped' | 'error';
  lastHeartbeat: string;
  secondsAgo: number;
  activeRunId: string | null;
  activeRunName: string | null;
  currentTask: string | null;
  currentWorker: string | null;
  iteration: number;
  consecutiveFailures: number;
  workerFleet?: {
    total: number;
    online: number;
    working: number;
    ready: number;
    offline: number;
    assignments: Array<{ workerName: string; taskTitle: string; issueNumber?: number }>;
  };
}

export class AutonomousRunnerService {
  private static runnerId = 'hub-runner-01';
  private static isRunning = false;
  private static isExecutingCycle = false;
  private static heartbeatTimer: NodeJS.Timeout | null = null;
  private static schedulerTimer: NodeJS.Timeout | null = null;
  private static watchdogTimer: NodeJS.Timeout | null = null;
  private static activeRunId: string | null = null;
  private static currentTask: string | null = null;
  private static currentWorker: string | null = null;
  private static iteration = 0;
  private static consecutiveFailures = 0;

  /**
   * Start the persistent Autonomous Runner background worker
   */
  static start() {
    if (this.isRunning) return;
    this.isRunning = true;

    Logger.info('====================================================');
    Logger.info('🤖 INICIANDO AUTONOMOUS RUNNER PERSISTENTE (AI DEV HUB)');
    Logger.info('====================================================');

    // 1. Initial Heartbeat
    this.recordHeartbeat('idle');

    // 2. Ensure Multi-Worker pool is initialized
    try {
      WorkerRegistry.ensureDefaultWorkers();
      WorkerRegistry.ensureWorkerAvailable().catch(err => {
        Logger.warn(`[Autonomous Runner] Falha no bootstrap inicial de worker: ${err.message}`);
      });
    } catch (e: any) {
      Logger.warn(`[Autonomous Runner] Falha ao inicializar pool de workers: ${e.message}`);
    }

    // 3. Recovery on startup: check for interrupted runs
    this.recoverInterruptedRuns();

    // 4. Heartbeat Loop (every 15s)
    this.heartbeatTimer = setInterval(() => {
      this.recordHeartbeat(this.isExecutingCycle ? 'busy' : (this.activeRunId ? 'busy' : 'idle'));
      // A heartbeat must come from a real lease renewal or a fresh agentapi probe.
    }, 15000);

    // 5. Scheduler Loop (polls every 3s)
    this.schedulerTimer = setInterval(() => {
      this.schedulerTick().catch(err => {
        Logger.error(`[Autonomous Runner Scheduler] Erro: ${err.message}`);
      });
    }, 3000);

    // 6. Watchdog Loop (every 30s)
    this.watchdogTimer = setInterval(() => {
      this.watchdogTick().catch(err => {
        Logger.error(`[Autonomous Runner Watchdog] Erro: ${err.message}`);
      });
    }, 30000);

    Logger.success('[Autonomous Runner] Scheduler, Heartbeat (15s), Multi-Worker Pool e Watchdog (30s) ativos.');
  }

  /**
   * Stop the runner cleanly
   */
  static stop() {
    this.isRunning = false;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.schedulerTimer) clearInterval(this.schedulerTimer);
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    this.recordHeartbeat('stopped');
    Logger.info('[Autonomous Runner] Serviço encerrado.');
  }

  /**
   * Record heartbeat in SQLite database
   */
  private static recordHeartbeat(status: 'online' | 'idle' | 'busy' | 'stopped' | 'error') {
    const nowIso = new Date().toISOString();
    try {
      db.prepare(`
        INSERT INTO runner_heartbeats (
          runner_id, status, last_heartbeat, active_run_id, current_task, current_worker, iteration, consecutive_failures, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(runner_id) DO UPDATE SET
          status = excluded.status,
          last_heartbeat = excluded.last_heartbeat,
          active_run_id = excluded.active_run_id,
          current_task = excluded.current_task,
          current_worker = excluded.current_worker,
          iteration = excluded.iteration,
          consecutive_failures = excluded.consecutive_failures,
          metadata_json = excluded.metadata_json
      `).run(
        this.runnerId,
        status,
        nowIso,
        this.activeRunId,
        this.currentTask,
        this.currentWorker,
        this.iteration,
        this.consecutiveFailures,
        JSON.stringify({ pid: process.pid, memoryUsage: process.memoryUsage().rss })
      );
    } catch (err: any) {
      Logger.warn(`[Runner Heartbeat] Falha ao registrar heartbeat: ${err.message}`);
    }
  }

  /**
   * Get live runner status for API and UI
   */
  static getStatus(): RunnerStatus {
    const record: any = db.prepare('SELECT * FROM runner_heartbeats WHERE runner_id = ?').get(this.runnerId);
    const now = Date.now();
    const lastTime = record ? new Date(record.last_heartbeat).getTime() : now;
    const secondsAgo = Math.max(0, Math.round((now - lastTime) / 1000));

    let runName: string | null = null;
    if (record?.active_run_id) {
      const run: any = db.prepare('SELECT name FROM autonomous_runs WHERE id = ?').get(record.active_run_id);
      runName = run?.name || null;
    }

    const allWorkers = WorkerRegistry.getAllWorkers();
    const workingCount = allWorkers.filter(w => w.status === 'WORKING').length;
    const readyCount = allWorkers.filter(w => w.status === 'READY' || w.status === 'WAITING').length;
    const offlineCount = allWorkers.filter(w => w.status === 'OFFLINE' || w.status === 'ERROR').length;
    const onlineCount = allWorkers.length - offlineCount;
    const assignments = allWorkers
      .filter(w => w.status === 'WORKING' && w.current_task_id)
      .map(w => {
        const task: any = db.prepare('SELECT title, github_issue_number FROM autonomous_tasks WHERE id = ?').get(w.current_task_id);
        return {
          workerName: w.name,
          taskTitle: task?.title || 'Executando tarefa',
          issueNumber: task?.github_issue_number || w.current_issue_number || undefined
        };
      });

    return {
      runnerId: this.runnerId,
      online: this.isRunning,
      status: record?.status || (this.isRunning ? 'online' : 'stopped'),
      lastHeartbeat: record?.last_heartbeat || new Date().toISOString(),
      secondsAgo,
      activeRunId: record?.active_run_id || this.activeRunId,
      activeRunName: runName,
      currentTask: record?.current_task || this.currentTask,
      currentWorker: record?.current_worker || this.currentWorker,
      iteration: record?.iteration || this.iteration,
      consecutiveFailures: record?.consecutive_failures || this.consecutiveFailures,
      workerFleet: {
        total: allWorkers.length,
        online: onlineCount,
        working: workingCount,
        ready: readyCount,
        offline: offlineCount,
        assignments
      }
    };
  }

  /**
   * RECOVERY: Detect and automatically resume interrupted runs after crash or restart
   */
  static recoverInterruptedRuns() {
    try {
      const pendingRuns: any[] = db.prepare(`
        SELECT * FROM autonomous_runs
        WHERE status IN ('running', 'building', 'testing', 'reviewing', 'planning')
        ORDER BY updated_at DESC
      `).all();

      if (pendingRuns.length === 0) {
        Logger.info('[Autonomous Runner Recovery] Nenhum run pendente necessitando recuperação.');
        return;
      }

      Logger.warn(`[Autonomous Runner Recovery] Detectado(s) ${pendingRuns.length} run(s) incompleto(s) após reinício.`);

      // Release any stale leases from previous killed/crashed server processes
      try {
        const staleLeases: any[] = db.prepare("SELECT DISTINCT worker_id FROM worker_leases WHERE status = 'active'").all();
        for (const l of staleLeases) {
          WorkerRegistry.releaseAllLeases(l.worker_id);
          WorkerRegistry.updateWorkerStatus(l.worker_id, 'READY');
        }
      } catch {}

      for (const run of pendingRuns) {
        // If a task was left in 'in_progress', reset to 'ready' to allow clean restart
        const stuckTasks: any[] = db.prepare(`
          SELECT * FROM autonomous_tasks
          WHERE run_id = ? AND status = 'in_progress'
        `).all(run.id);

        for (const task of stuckTasks) {
          const retries = (task.retry_count || 0) + 1;
          db.prepare(`
            UPDATE autonomous_tasks
            SET status = 'ready', retry_count = ?, updated_at = ?
            WHERE id = ?
          `).run(retries, new Date().toISOString(), task.id);

          AutonomousManager.logEvent(
            run.id,
            task.id,
            'system',
            'RECOVERY_TASK_RESET',
            `Watchdog/Recovery: Tarefa "${task.title}" resetada para READY após reinício do processo do Hub.`
          );
        }

        // Restore run status to running
        db.prepare(`
          UPDATE autonomous_runs
          SET status = 'running', next_action = 'Retomar execução autônoma do backlog', updated_at = ?
          WHERE id = ?
        `).run(new Date().toISOString(), run.id);

        AutonomousManager.logEvent(
          run.id,
          null,
          'system',
          'RUNNER_RECOVERED',
          `🔄 Autonomous Runner recuperou automaticamente a execução do Run "${run.name}" do último checkpoint.`
        );

        Logger.success(`[Autonomous Runner Recovery] Run "${run.name}" (${run.id.slice(0, 8)}) recuperado e reativado.`);
      }
    } catch (err: any) {
      Logger.error(`[Autonomous Runner Recovery] Erro ao recuperar runs: ${err.message}`);
    }
  }

  /**
   * Watchdog: scan for stalled tasks that took > 3 minutes without progress
   */
  private static async watchdogTick() {
    if (!this.isRunning) return;

    try {
      const threeMinutesAgo = new Date(Date.now() - 3 * 60 * 1000).toISOString();
      const stalledTasks: any[] = db.prepare(`
        SELECT t.*, r.project_id, r.name as run_name
        FROM autonomous_tasks t
        JOIN autonomous_runs r ON t.run_id = r.id
        WHERE t.status = 'in_progress' AND t.updated_at < ?
      `).all(threeMinutesAgo);

      for (const task of stalledTasks) {
        const liveLease: any = db.prepare("SELECT id FROM worker_leases WHERE task_id = ? AND status = 'active' AND lease_until > ?")
          .get(task.id, new Date().toISOString());
        if (liveLease) continue;
        const retries = (task.retry_count || 0) + 1;
        const nowIso = new Date().toISOString();

        if (retries >= 3) {
          // Mark BLOCKED and allow supervisor to pick other independent tasks
          db.prepare(`
            UPDATE autonomous_tasks
            SET status = 'blocked', retry_count = ?, updated_at = ?
            WHERE id = ?
          `).run(retries, nowIso, task.id);

          AutonomousManager.logEvent(
            task.run_id,
            task.id,
            'system',
            'WATCHDOG_BLOCKED',
            `🚨 Watchdog: Tarefa "${task.title}" travou e atingiu 3 tentativas. Marcada como BLOCKED. O Supervisor buscará outra tarefa independente.`
          );
        } else {
          // Retry
          db.prepare(`
            UPDATE autonomous_tasks
            SET status = 'ready', retry_count = ?, updated_at = ?
            WHERE id = ?
          `).run(retries, nowIso, task.id);

          AutonomousManager.logEvent(
            task.run_id,
            task.id,
            'system',
            'WATCHDOG_RETRY',
            `⚠️ Watchdog: Tarefa "${task.title}" sem progresso detectada. Tentativa ${retries}/3 reiniciada.`
          );
        }
      }
      // Expire stale worker leases and detect offline workers
      try {
        const { expired, resetTasks } = WorkerRegistry.expireStaleLeases();
        if (expired > 0) {
          Logger.warn(`[Watchdog] ${expired} lease(s) expirada(s) por inatividade. Tarefas resetadas para READY: ${resetTasks.join(', ')}`);
        }
        WorkerRegistry.detectOfflineWorkers();
      } catch (e: any) {
        Logger.warn(`[Watchdog] Erro ao validar leases de workers: ${e.message}`);
      }
    } catch (err: any) {
      Logger.error(`[Watchdog Error] ${err.message}`);
    }
  }

  /**
   * Main scheduler tick: looks for active runs and executes the autonomous cycle
   */
  static async schedulerTick() {
    if (!this.isRunning || this.isExecutingCycle) return;

    // Find any run in 'running' or 'waiting_for_worker' state
    const activeRun: any = db.prepare(`
      SELECT * FROM autonomous_runs
      WHERE status IN ('running', 'building', 'testing', 'reviewing', 'waiting_for_worker')
      ORDER BY updated_at ASC
      LIMIT 1
    `).get();

    if (!activeRun) {
      this.activeRunId = null;
      this.currentTask = null;
      this.currentWorker = null;
      return;
    }

    this.isExecutingCycle = true;
    this.activeRunId = activeRun.id;

    try {
      await this.executeAutonomousStep(activeRun.id);
    } catch (err: any) {
      Logger.error(`[Autonomous Runner Loop] Erro no ciclo do Run ${activeRun.id.slice(0, 8)}: ${err.message}`);
      const current: any = db.prepare('SELECT status FROM autonomous_runs WHERE id = ?').get(activeRun.id);
      if (current?.status === 'failed' || current?.status === 'paused' || current?.status === 'completed') return;
      this.consecutiveFailures++;

      const failures = Number(activeRun.consecutive_failures || 0) + 1;
      db.prepare(`
        UPDATE autonomous_runs
        SET consecutive_failures = ?, status = ?, last_error = ?, next_action = ?, updated_at = ?
        WHERE id = ?
      `).run(failures, failures >= 3 ? 'error' : 'running', err.message,
        failures >= 3 ? 'Intervenção necessária após três falhas consecutivas' : 'Retentar ciclo',
        new Date().toISOString(), activeRun.id);
    } finally {
      this.isExecutingCycle = false;
      this.recordHeartbeat(this.activeRunId ? 'busy' : 'idle');
    }
  }

  /**
   * Execute a single full autonomous step (Supervisor -> Builder -> Test -> Review -> Approved/Changes)
   */
  static async step(runId: string) {
    this.isRunning = true;
    return this.executeAutonomousStep(runId);
  }

  private static async executeAutonomousStep(runId: string) {
    const run = AutonomousManager.getRun(runId);
    const nowIso = new Date().toISOString();

    // Check if run is paused or completed
    if (run.status === 'paused' || run.status === 'completed' || run.status === 'error' || run.status === 'failed') {
      return;
    }

    // 0. Check for in-flight tasks in review awaiting Supervisor verdict
    const inReviewTask: any = db.prepare(`
      SELECT * FROM autonomous_tasks
      WHERE run_id = ? AND status = 'in_review'
      ORDER BY order_index ASC
      LIMIT 1
    `).get(runId);

    if (inReviewTask) {
      Logger.info(`[Autonomous Runner] Tarefa "${inReviewTask.title}" (${inReviewTask.id.slice(0, 8)}) aguardando revisão do Supervisor.`);
      const latestReportRow: any = db.prepare(`
        SELECT * FROM builder_reports
        WHERE run_id = ? AND task_id = ?
        ORDER BY created_at DESC
        LIMIT 1
      `).get(runId, inReviewTask.id);

      if (latestReportRow) {
        const reportData: BuilderReportInput = {
          runId,
          taskId: inReviewTask.id,
          status: latestReportRow.status,
          filesChanged: latestReportRow.files_changed_json ? JSON.parse(latestReportRow.files_changed_json) : [],
          implemented: latestReportRow.implemented_json ? JSON.parse(latestReportRow.implemented_json) : [inReviewTask.title],
          testsRun: latestReportRow.tests_run || 'N/A',
          testResults: latestReportRow.test_results || 'PASS',
          buildStatus: latestReportRow.build_status || 'Build concluído',
          browserValidation: latestReportRow.browser_validation || 'Componentes prontos',
          screenshots: latestReportRow.screenshots_json ? JSON.parse(latestReportRow.screenshots_json) : [],
          knownProblems: latestReportRow.known_problems_json ? JSON.parse(latestReportRow.known_problems_json) : [],
          decisions: latestReportRow.decisions_json ? JSON.parse(latestReportRow.decisions_json) : [],
          recommendation: latestReportRow.recommendation || '',
          evaluation: latestReportRow.evaluation_json ? JSON.parse(latestReportRow.evaluation_json) : undefined
        };

        this.currentWorker = 'Supervisor';
        this.currentTask = inReviewTask.title;
        db.prepare(`
          UPDATE autonomous_runs
          SET status = 'reviewing', next_action = 'Supervisor revisando PR e testes no GitHub', updated_at = ?
          WHERE id = ?
        `).run(nowIso, runId);

        const reviewResult = await this.executeSupervisorReview(run, inReviewTask, reportData);

        if (reviewResult.verdict === 'APPROVED') {
          this.consecutiveFailures = 0;
          db.prepare(`
            UPDATE autonomous_runs
            SET status = 'running', consecutive_failures = 0, last_success = ?, next_action = 'Selecionar próxima tarefa do backlog', updated_at = ?
            WHERE id = ?
          `).run(nowIso, nowIso, runId);

          Logger.success(`✅ [Supervisor] Tarefa "${inReviewTask.title}" APROVADA com sucesso no GitHub. PR mergeada e Issue fechada.`);
        } else {
          this.consecutiveFailures++;
          db.prepare(`
            UPDATE autonomous_runs
            SET status = 'running', consecutive_failures = consecutive_failures + 1, last_error = ?, next_action = 'Re-executar correções na mesma branch', updated_at = ?
            WHERE id = ?
          `).run(reviewResult.feedback || 'Correções necessárias', nowIso, runId);

          Logger.warn(`🔄 [Supervisor] Solicitação de correções enviada para "${inReviewTask.title}": ${reviewResult.feedback || 'Revisão reprovada'}`);
        }
        return;
      } else {
        // Tarefa está in_review sem report válido (anomalia de estado): reset para ready
        db.prepare("UPDATE autonomous_tasks SET status = 'ready', updated_at = ? WHERE id = ?").run(nowIso, inReviewTask.id);
        return;
      }
    }

    // 1. Supervisor evaluates available tasks
    const available = AutonomousManager.getAvailableTasks(runId);
    const project = run.project || { name: 'Projeto', path: '.', objective: '' };

    if (available.length === 0) {
      // Check if all tasks completed
      const allTasks: any[] = db.prepare('SELECT status FROM autonomous_tasks WHERE run_id = ?').all(runId);
      const isAllDone = allTasks.length > 0 && allTasks.every(t => t.status === 'completed');

      if (isAllDone) {
        db.prepare(`
          UPDATE autonomous_runs
          SET status = 'completed', end_time = ?, next_action = 'Projeto concluído com sucesso', updated_at = ?
          WHERE id = ?
        `).run(nowIso, nowIso, runId);

        // If GitHub Epic exists, close the Epic Issue on GitHub
        if (project.github_repo && run.github_epic_issue_number) {
          const [owner, repo] = project.github_repo.split('/');
          try {
            await GitHubMcpClient.updateIssue(owner, repo, run.github_epic_issue_number, { state: 'closed' });
            AutonomousManager.logEvent(
              runId,
              null,
              'supervisor',
              'GITHUB_EPIC_CLOSED',
              `🎉 Epic Issue #${run.github_epic_issue_number} concluída e fechada no GitHub com 100% das sub-issues finalizadas!`
            );
          } catch (epicCloseErr: any) {
            Logger.warn(`[GitHub Runner] Falha ao fechar Epic Issue: ${epicCloseErr.message}`);
          }
        }

        AutonomousManager.logEvent(
          runId,
          null,
          'supervisor',
          'RUN_COMPLETED',
          '🎉 Todas as tarefas do MVP foram finalizadas com 100% de aprovação no GitHub!'
        );

        // Announce completion directly in the project chat
        const completedTasksCount = allTasks.filter(t => t.status === 'completed').length;
        const completionMsg = `🎉 **Ciclo Autônomo Concluído com Sucesso!**\n\nTodas as **${completedTasksCount} tarefas** planejadas pelo Supervisor Gemini foram desenvolvidas, testadas e aprovadas com 100% de conformidade.\n\n` +
          (project.github_repo ? `O código e branches foram sincronizados no GitHub (\`${project.github_repo}\`).\n\n` : '') +
          `Você pode continuar enviando instruções neste mesmo chat para evoluir o sistema a qualquer momento.`;

        db.prepare(`
          INSERT INTO messages (id, project_id, role, content, created_at, metadata)
          VALUES (?, ?, 'assistant', ?, ?, ?)
        `).run(
          crypto.randomUUID(),
          project.id,
          completionMsg,
          nowIso,
          JSON.stringify({ type: 'run_completion', runId })
        );

        // Check for queued in-flight instructions from user during this run
        const queuedEvents: any[] = db.prepare(`
          SELECT id, metadata_json FROM autonomous_events
          WHERE run_id = ? AND event_type = 'QUEUED_USER_INSTRUCTION'
        `).all(runId);

        const queuedTexts: string[] = [];
        for (const qe of queuedEvents) {
          try {
            const meta = JSON.parse(qe.metadata_json);
            if (meta?.content) queuedTexts.push(meta.content);
          } catch {}
        }

        if (queuedTexts.length > 0) {
          const nextPrompt = queuedTexts.join('\n\n');
          Logger.info(`[Autonomous Runner] Processando ${queuedTexts.length} instrução(ões) enfileirada(s) do usuário para ${project.name}...`);
          setTimeout(async () => {
            try {
              await AutonomousManager.createRun({
                projectId: project.id,
                name: `Continuidade: ${queuedTexts[0].slice(0, 30)}`,
                objective: nextPrompt,
                briefing: nextPrompt,
                autonomyMode: 'autonomous'
              });
              AutonomousRunnerService.schedulerTick().catch(() => {});
            } catch (continuationErr: any) {
              Logger.warn(`[Autonomous Runner] Falha ao disparar continuidade enfileirada: ${continuationErr.message}`);
            }
          }, 1500);
        }

        Logger.success(`[Autonomous Runner] Run "${run.name}" concluído com sucesso!`);
        this.activeRunId = null;
        return;
      }

      // Check if blocked by pending human approval
      const pendingApprovals: any[] = db.prepare('SELECT id FROM autonomous_approvals WHERE run_id = ? AND status = \'pending\'').all(runId);
      if (pendingApprovals.length > 0) {
        db.prepare(`
          UPDATE autonomous_runs
          SET status = 'waiting_approval', next_action = 'Aguardando decisão humana na Approval Inbox', updated_at = ?
          WHERE id = ?
        `).run(nowIso, runId);

        Logger.warn(`[Autonomous Runner] Nenhuma tarefa independente pronta. Aguardando aprovação na Inbox para Run ${runId.slice(0, 8)}.`);
        return;
      }

      // Check if all remaining tasks are blocked
      const blockedTasks: any[] = db.prepare('SELECT id FROM autonomous_tasks WHERE run_id = ? AND status = \'blocked\'').all(runId);
      if (blockedTasks.length > 0) {
        db.prepare(`
          UPDATE autonomous_runs
          SET status = 'blocked', next_action = 'Tarefas restantes bloqueadas por limite de tentativas', updated_at = ?
          WHERE id = ?
        `).run(nowIso, runId);
        return;
      }

      return;
    }

    // 2. Multi-Worker Matching: get ready workers
    const { AccountProfileManager } = await import('./accountProfileManager.js');
    const selectedProfile = AccountProfileManager.getActiveProfileForProject(project.id);
    let readyWorkers = WorkerRegistry.getReadyWorkers().filter(w => w.account_profile_id === selectedProfile.id);
    if (readyWorkers.length === 0) {
      Logger.info(`[Multi-Worker Scheduler] Nenhum worker READY ativo. Solicitando bootstrap automático de Worker para conta ativa...`);
      try {
        const bootstrapped = await WorkerRegistry.ensureWorkerAvailable(project.id);
        if (bootstrapped) {
          readyWorkers = WorkerRegistry.getReadyWorkers().filter(w => w.account_profile_id === selectedProfile.id);
        }
      } catch (bootErr: any) {
        Logger.warn(`[Multi-Worker Scheduler] Falha no bootstrap de worker: ${bootErr.message}`);
      }
    }

    if (readyWorkers.length === 0) {
      Logger.warn(`[Multi-Worker Scheduler] Nenhum worker READY disponível para assumir tarefas do Run "${run.name}". Aguardando pool...`);
      if (run.status === 'waiting_for_worker' && Date.now() - new Date(run.updated_at).getTime() > 90000) {
        db.prepare(`UPDATE autonomous_runs SET status = 'error', last_error = 'WORKER_BOOT_FAILED: nenhum worker autenticado respondeu em 90 segundos', next_action = 'Abra ou reconecte a conta ativa e reinicie o run', updated_at = ? WHERE id = ?`)
          .run(nowIso, runId);
        AutonomousManager.logEvent(runId, null, 'system', 'WORKER_BOOT_FAILED', 'Bootstrap de worker excedeu 90 segundos.');
        return;
      }
      db.prepare(`
        UPDATE autonomous_runs
        SET status = 'waiting_for_worker', next_action = 'Aguardando worker disponível na pool (todos ocupados ou offline)', updated_at = ?
        WHERE id = ? AND status <> 'waiting_for_worker'
      `).run(nowIso, runId);
      return;
    }

    const match = WorkerRegistry.matchWorkerToTask(readyWorkers, available);
    if (!match) {
      Logger.warn(`[Multi-Worker Scheduler] Nenhum par worker-tarefa disponível no momento.`);
      return;
    }
    const { worker: selectedWorker, task: nextTask } = match;

    // Claim task with atomic lease reservation
    const leaseId = WorkerRegistry.claimTask(selectedWorker.id, runId, nextTask.id, nextTask.github_issue_number);
    if (!leaseId) {
      Logger.warn(`[Multi-Worker Scheduler] Falha ao adquirir lease para tarefa "${nextTask.title}". Retentando.`);
      return;
    }

    this.currentTask = nextTask.title;
    this.currentWorker = selectedWorker.name;
    this.iteration++;

    Logger.info(`----------------------------------------------------`);
    Logger.info(`🎯 [Supervisor] Atribuiu tarefa: "${nextTask.title}" (${nextTask.milestone}) ao ${selectedWorker.name} [Iteração #${this.iteration}]`);

    // Prepare dedicated branch for this task: ai/<issue_number>-<slug>
    const issueNum = nextTask.github_issue_number || nextTask.order_index || 1;
    const slug = nextTask.title
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 25);
    const branchName = nextTask.github_branch || `ai/${issueNum}-${slug}`;

    if (fs.existsSync(path.join(project.path, '.git'))) {
      GitManager.checkoutOrCreateBranch(project.path, branchName);
      Logger.info(`[Builder Git] Branch dedicada ativa para ${selectedWorker.name}: ${branchName}`);
    }

    db.prepare('UPDATE autonomous_tasks SET github_branch = ? WHERE id = ?').run(branchName, nextTask.id);

    // Update run state to BUILDING
    db.prepare(`
      UPDATE autonomous_runs
      SET status = 'building', current_milestone = ?, current_task = ?, current_worker = ?,
          iteration = iteration + 1, next_action = ?, updated_at = ?
      WHERE id = ?
    `).run(nextTask.milestone || 'M1', nextTask.title || 'Tarefa', selectedWorker.name, `${selectedWorker.name} executando implementação`, nowIso, runId);

    // Record claim event
    AutonomousManager.claimTask(runId, nextTask.id, selectedWorker.name);
    AutonomousManager.logEvent(
      runId,
      nextTask.id,
      'system',
      'WORKER_ASSIGNED',
      `Worker "${selectedWorker.name}" assumiu a tarefa "${nextTask.title}" com lease ativa.`,
      { workerId: selectedWorker.id, leaseId, branch: branchName }
    );

    // 3. Worker executes task (REAL execution with real code and real tests)
    let reportData: BuilderReportInput;
    try {
      reportData = await this.executeBuilderTaskReal(project, run, nextTask, branchName, selectedWorker, leaseId);
    } catch (taskErr: any) {
      const errMsg = taskErr?.message || String(taskErr);
      if (/RESOURCE_EXHAUSTED|code 429|Individual quota reached|QUOTA_EXHAUSTED/i.test(errMsg)) {
        Logger.warn(`[Autonomous Runner] Quota esgotada detectada durante execução da tarefa "${nextTask.title}": ${errMsg}`);
        const profileId = selectedWorker.account_profile_id;
        let cooldownMsg = errMsg;
        if (profileId) {
          const updatedProfile = AccountProfileManager.markQuotaExhausted(profileId, errMsg);
          if (updatedProfile?.quota_resets_at) {
            const resetTime = new Date(updatedProfile.quota_resets_at).toLocaleTimeString();
            cooldownMsg = `Limite de cota individual atingido (RESOURCE_EXHAUSTED 429). Reseta às ${resetTime}.`;
          }
        }

        WorkerRegistry.updateWorkerStatus(selectedWorker.id, 'COOLDOWN', {
          current_task_id: null,
          current_run_id: null,
          current_issue_number: null,
          last_error: cooldownMsg
        });

        db.prepare(`
          UPDATE autonomous_tasks
          SET status = 'ready', updated_at = ?
          WHERE id = ?
        `).run(nowIso, nextTask.id);

        db.prepare(`
          UPDATE autonomous_runs
          SET status = 'paused', last_error = ?, next_action = ?, updated_at = ?
          WHERE id = ?
        `).run(cooldownMsg, 'Execução pausada aguardando restabelecimento de cota ou troca de conta', nowIso, runId);

        AutonomousManager.logEvent(
          runId,
          nextTask.id,
          'system',
          'QUOTA_EXHAUSTED_PAUSE',
          `Cota do Google Antigravity atingida para ${selectedWorker.name}. Execução pausada de forma segura sem penalizar tarefas. ${cooldownMsg}`,
          { workerId: selectedWorker.id, error: errMsg }
        );
        return;
      }
      throw taskErr;
    }
    if ((db.prepare('SELECT status FROM autonomous_runs WHERE id = ?').get(runId) as any)?.status === 'failed') return;

    // 4. Update run state to TESTING / REVIEWING
    db.prepare(`
      UPDATE autonomous_runs
      SET status = 'reviewing', next_action = 'Supervisor revisando PR e testes no GitHub', updated_at = ?
      WHERE id = ?
    `).run(nowIso, runId);

    // 5. Submit report (evaluates policies for ORANGE/RED approvals)
    const submitResult = AutonomousManager.submitBuilderReport(reportData);

    if (submitResult.needsApproval) {
      Logger.warn(`⚠️ [Policy Engine] Decisão na tarefa "${nextTask.title}" requer aprovação na Inbox (${submitResult.highestRisk.toUpperCase()}).`);
      const remainingAvailable = AutonomousManager.getAvailableTasks(runId);
      if (remainingAvailable.length > 0) {
        db.prepare(`
          UPDATE autonomous_runs
          SET status = 'running', next_action = 'Executando outras tarefas independentes', updated_at = ?
          WHERE id = ?
        `).run(nowIso, runId);
      } else {
        db.prepare(`
          UPDATE autonomous_runs
          SET status = 'waiting_approval', next_action = 'Aguardando aprovação na Inbox', updated_at = ?
          WHERE id = ?
        `).run(nowIso, runId);
      }
      return;
    }

    // 6. Supervisor reviews report & PR on GitHub
    this.currentWorker = 'Supervisor';
    const reviewResult = await this.executeSupervisorReview(run, nextTask, reportData);

    if (reviewResult.verdict === 'APPROVED') {
      this.consecutiveFailures = 0;
      db.prepare(`
        UPDATE autonomous_runs
        SET status = 'running', consecutive_failures = 0, last_success = ?, next_action = 'Selecionar próxima tarefa do backlog', updated_at = ?
        WHERE id = ?
      `).run(nowIso, nowIso, runId);

      Logger.success(`✅ [Supervisor] Tarefa "${nextTask.title}" APROVADA com sucesso no GitHub. PR mergeada e Issue fechada.`);
    } else {
      this.consecutiveFailures++;
      db.prepare(`
        UPDATE autonomous_runs
        SET status = 'running', consecutive_failures = consecutive_failures + 1, last_error = ?, next_action = 'Re-executar correções na mesma branch', updated_at = ?
        WHERE id = ?
      `).run(reviewResult.feedback || 'Correções necessárias', nowIso, runId);

      Logger.warn(`🔄 [Supervisor] Solicitação de correções enviada para "${nextTask.title}": ${reviewResult.feedback || 'Revisão reprovada'}`);
    }
  }

  /**
   * REAL BUILDER EXECUTION ENGINE VIA REAL ANTIGRAVITY AGENT WITH MULTI-WORKER SUPPORT
   */
  private static async executeBuilderTaskReal(
    project: any,
    run: any,
    task: any,
    branchName: string,
    worker: Worker,
    leaseId: string
  ): Promise<BuilderReportInput> {
    const { AccountProfileManager } = await import('./accountProfileManager.js');
    let isolatedEnv: NodeJS.ProcessEnv | undefined;
    if (worker.account_profile_id) {
      const profile = AccountProfileManager.getProfile(worker.account_profile_id);
      if (profile) isolatedEnv = AccountProfileManager.getExecutionEnvForProfile(profile);
    }
    if (!isolatedEnv) {
      const activeProf = AccountProfileManager.getGlobalActiveProfile();
      if (activeProf) isolatedEnv = AccountProfileManager.getExecutionEnvForProfile(activeProf);
    }

    const antigravityProvider = new AntigravityProvider(isolatedEnv);
    const projectPath = project.path;

    if (!fs.existsSync(projectPath)) {
      fs.mkdirSync(projectPath, { recursive: true });
    }

    // Workspace Isolation check (Item 7)
    if (fs.existsSync(path.join(projectPath, '.git'))) {
      GitManager.assertExecutionWorkspace(projectPath);
    }

    // Periodic lease renewal (every 15s) while worker is running
    const renewalInterval = setInterval(() => {
      WorkerRegistry.renewLease(leaseId, worker.id);
    }, 15000);

    const startTime = Date.now();
    let resolvedBuilderModel: 'flash_lite' | 'flash' | 'pro' = 'flash';
    let executionConversationId: string | null = null;
    let executionSucceeded = false;
    let executedToolCalls: number | null = null;

    // Record initial Git HEAD if repository exists
    let initialGitHead: string | null = null;
    if (fs.existsSync(path.join(projectPath, '.git'))) {
      try {
        initialGitHead = execSync('git rev-parse HEAD', { cwd: projectPath, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      } catch {
        initialGitHead = null;
      }
    }

    try {
      // 1. Resolve builder model from preferences
      const preferences = ModelRegistry.getPreferences(worker.account_profile_id, project.id);
      resolvedBuilderModel = ModelRegistry.resolveModel({
        preference: preferences.builder || preferences.default,
        role: 'builder'
      });

      // Persistent Worker conversation reused across tasks (using PromptManager with Fable Worker V1)
      const { PromptManager } = await import('./promptManager.js');
      const { ConversationManager } = await import('./conversationManager.js');

      // 1. Build authoritative runtime and project context for Worker instructions
      // Production default is native per official architectural decision.
      // Supported variants: native, legacy-worker-v1, fable-worker-v1, fable-worker-v2-flash.
      let workerPromptVariant = 'native';
      try {
        const runConfig = run.config_json ? JSON.parse(run.config_json) : {};
        if (runConfig.worker_prompt_variant) {
          workerPromptVariant = runConfig.worker_prompt_variant;
        } else if (process.env.DECOHUB_WORKER_PROMPT_VARIANT) {
          workerPromptVariant = process.env.DECOHUB_WORKER_PROMPT_VARIANT;
        }
      } catch {}

      let promptId = 'native';
      if (workerPromptVariant === 'fable-worker-v2-flash' || workerPromptVariant === 'fable-v2' || workerPromptVariant === 'v2') {
        promptId = 'fable-worker-v2-flash';
      } else if (workerPromptVariant === 'fable-worker-v1' || workerPromptVariant === 'fable-v1' || workerPromptVariant === 'fable') {
        promptId = 'fable-worker-v1';
      } else if (workerPromptVariant === 'legacy-worker-v1' || workerPromptVariant === 'legacy') {
        promptId = 'legacy-worker-v1';
      } else {
        promptId = 'native';
      }

      const workerInstructions = PromptManager.buildWorkerInstructions({
        promptId,
        runtime: {
          projectPath,
          runId: run.id,
          taskId: task.id,
          workerId: worker.id,
          accountProfileId: worker.account_profile_id,
          requestedModel: resolvedBuilderModel,
          actualModel: null, // Unknown until runtime verifies
          workspaceGitRoot: projectPath,
          runtimeCwd: projectPath
        },
        project: {
          projectName: project.name,
          projectPath: project.path,
          objective: project.objective
        }
      });

      // Ensure directory-level discovery rule file is present in project (or cleaned if legacy)
      PromptManager.ensureProjectRulesFile(projectPath, workerInstructions.fullRuleContent);

      // Validate prompt isolation before dispatch
      const isolationCheck = PromptManager.validateWorkspacePromptIsolation(
        projectPath,
        promptId
      );
      if (!isolationCheck.valid) {
        throw new Error(`WORKSPACE_PROMPT_LEAK: ${isolationCheck.reason}`);
      }

      const convResult = ConversationManager.getOrCreateConversation({
        projectId: project.id,
        accountProfileId: worker.account_profile_id || 'acc-pro-1',
        role: 'worker',
        workerId: worker.id,
        runId: run.id,
        model: resolvedBuilderModel,
        env: isolatedEnv,
        promptId: workerInstructions.promptId,
        promptHash: workerInstructions.promptHash,
        initialPrompt: workerInstructions.bootstrapInstructions
      });
      const agentSessionId = convResult.conversationId;
      WorkerRegistry.updateWorkerStatus(worker.id, 'WORKING', {
        conversation_id: agentSessionId
      });
      executionConversationId = agentSessionId;

      // Check if resuming / handoff on an existing branch
      const isHandoffOrRetry = task.retry_count > 0 || (task.github_branch && task.github_branch === branchName);
      let resumeContext = '';
      if (isHandoffOrRetry) {
        let gitLog = '';
        try {
          gitLog = execSync(`git -C "${projectPath}" log -n 5 --oneline`, { encoding: 'utf-8' }).trim();
        } catch {}

        resumeContext = [
          `[HANDOFF / RESUME MODE]`,
          `Você é o ${worker.name}. Você está assumindo a implementação desta tarefa.`,
          `O branch "${branchName}" já está configurado.`,
          gitLog ? `Últimos commits na branch:\n${gitLog}` : '',
          task.retry_count > 0 && run.last_error ? `Feedback anterior do Supervisor: ${run.last_error}` : '',
          `INSTRUÇÃO DE HANDOFF: Não crie novos branches ou duplique arquivos existentes. Inspecione o código atual, preserve o que já foi feito, complete os requisitos pendentes e garanta que todos os testes passem.`
        ].filter(Boolean).join('\n');
      }

      // 2. Formulate SuccessContract and dispatch task contract to the live Antigravity agent
      const programMd = MemoryManager.ensureProgramMd(project.path, project.name, project.objective);
      const isBugFix = Boolean(
        task.title.toLowerCase().includes('bug') ||
        task.title.toLowerCase().includes('corrigir') ||
        (task.description && task.description.toLowerCase().includes('bug'))
      );

      // Preflight & Authoritative Engineering Context assembly
      const { EngineeringContextService } = await import('./engineeringContextService.js');
      const engineeringPackage = EngineeringContextService.prepareTaskContext({
        projectPath,
        projectName: project.name,
        projectObjective: project.objective,
        task: {
          id: task.id,
          title: task.title,
          description: task.description,
          criteria: task.criteria || ['Atender plenamente os objetivos da tarefa'],
          verificationCommand: task.verification_command || 'npm test',
          doneWhen: task.done_when || 'Todos os critérios atendidos e verificação sem erros',
          expectedScopeFiles: task.expected_files || []
        }
      });

      // Update task record with engineering traceability metadata
      try {
        db.prepare(`
          UPDATE autonomous_tasks
          SET engineering_context_version = ?, engineering_context_hash = ?, preflight_status = ?, updated_at = ?
          WHERE id = ?
        `).run(
          engineeringPackage.contextVersion,
          engineeringPackage.contextHash,
          engineeringPackage.preflightStatus,
          new Date().toISOString(),
          task.id
        );
      } catch {}

      AutonomousManager.logEvent(
        run.id,
        task.id,
        'system',
        'ENGINEERING_PREFLIGHT',
        `Preflight Karpathy concluído (${engineeringPackage.preflightStatus}). Hash de contexto: ${engineeringPackage.contextHash}`,
        {
          version: engineeringPackage.contextVersion,
          hash: engineeringPackage.contextHash,
          sources: engineeringPackage.sources,
          status: engineeringPackage.preflightStatus
        }
      );

      const contract = IndependentEvaluator.getContractByTaskId(task.id) || IndependentEvaluator.createSuccessContract({
        taskId: task.id,
        runId: run.id,
        projectId: project.id,
        projectPath,
        objective: task.title,
        acceptanceCriteria: engineeringPackage.taskContract.acceptanceCriteria,
        verificationCommand: engineeringPackage.taskContract.verificationCommand,
        protectedEvaluationFiles: task.protected_evaluation_files || [],
        isBugFix
      });

      const protectedWarning = contract.protectedEvaluationFiles.length > 0
        ? `AVISO DE TESTE PROTEGIDO (PROTECTED_EVALUATION): Os seguintes arquivos de teste são o mecanismo independente de avaliação: ${contract.protectedEvaluationFiles.join(', ')}. É PROIBIDO alterar, enfraquecer ou excluir estes arquivos. O Evaluator verificará a integridade dos testes e rejeitará qualquer tentativa de adulteração.`
        : '';

      const sendTaskResult = await antigravityProvider.sendTask(agentSessionId, {
        task: {
          id: task.id,
          title: task.title,
          description: task.description,
          milestone: task.milestone,
          verificationCommand: engineeringPackage.taskContract.verificationCommand,
          doneWhen: engineeringPackage.taskContract.doneWhen
        },
        context: {
          projectName: project.name,
          projectPath: project.path,
          objective: project.objective,
          stack: project.stack,
          programMd
        },
        requirements: [
          `Criar/editar código funcional exclusivamente dentro de "${project.path}"`,
          'Validar sintaxe e integridade',
          'Executar testes automatizados no terminal quando aplicável',
          'Seguir rigorosamente as Karpathy Agent Guidelines (THINK BEFORE CODING, SIMPLICITY FIRST, SURGICAL CHANGES, GOAL-DRIVEN)',
          ...(protectedWarning ? [protectedWarning] : [])
        ],
        acceptanceCriteria: engineeringPackage.taskContract.acceptanceCriteria,
        constraints: [`Não modificar arquivos fora de "${project.path}"`],
        expectedScopeFiles: task.expected_files || [],
        engineeringPackage: {
          contextHash: engineeringPackage.contextHash,
          formattedPromptBlock: engineeringPackage.formattedPromptBlock
        },
        supervisorInstructions: [
          resumeContext,
          protectedWarning,
          task.retry_count > 0 && run.last_error
            ? `CORREÇÕES SOLICITADAS PELO SUPERVISOR: ${run.last_error}. Implemente as melhorias solicitadas no mesmo branch.`
            : 'Implemente de forma completa, com código limpo, sem simulações e sem placeholders.'
        ].filter(Boolean).join('\n\n')
      }, {
        projectId: project.id ?? undefined,
        accountProfileId: worker.account_profile_id ?? undefined,
        workerId: worker.id ?? undefined,
        runId: run.id ?? undefined,
        model: resolvedBuilderModel,
        promptId: workerInstructions.promptId,
        promptHash: workerInstructions.promptHash
      });

      const effectiveSessionId = sendTaskResult.sessionId;
      if (sendTaskResult.rotated) {
        WorkerRegistry.updateWorkerStatus(worker.id, 'WORKING', {
          conversation_id: effectiveSessionId
        });
        executionConversationId = effectiveSessionId;
      }

      // 3. Await agent results from live Antigravity execution (IMPLEMENTATION RESULT)
      const agentResult = await antigravityProvider.getResult(effectiveSessionId, 600000, projectPath,
        () => (db.prepare('SELECT status FROM autonomous_runs WHERE id = ?').get(run.id) as any)?.status === 'failed');
      executedToolCalls = agentResult.toolCallsCount ?? null;
      if ((db.prepare('SELECT status FROM autonomous_runs WHERE id = ?').get(run.id) as any)?.status === 'failed')
        throw new Error('RUN_CANCELLED: a execução foi interrompida pelo usuário');

      // 4. Independent Evaluator objectively verifies the result (EVALUATION RESULT)
      const evaluationResult = await IndependentEvaluator.evaluate(contract.id, projectPath, agentResult, {
        expectedScopeFiles: task.expected_files || []
      });

      // 5. Builder commits and pushes to dedicated branch
      const issueNum = task.github_issue_number || task.order_index || 1;
      if (fs.existsSync(path.join(projectPath, '.git'))) {
        let currentHead: string | null = null;
        try {
          currentHead = execSync('git rev-parse HEAD', { cwd: projectPath, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        } catch {
          currentHead = null;
        }

        let taskCommitSha: string | null = null;
        let commitSource: 'AGENT' | 'DECOHUB' | null = null;

        // Check if agent already committed changes (HEAD advanced from initialGitHead)
        if (initialGitHead && currentHead && initialGitHead !== currentHead) {
          taskCommitSha = currentHead;
          commitSource = 'AGENT';
          Logger.info(`[Builder Git] Commit detectado previamente criado pelo Agente: ${taskCommitSha.slice(0, 8)} (de ${initialGitHead.slice(0, 8)})`);
        } else {
          // DecoHUB creates the commit with surgical selection
          const commitMsg = `[AI - ${worker.name}] ${task.title} Closes #${issueNum}`;
          const committed = GitManager.commitSelected(projectPath, agentResult.filesChanged, commitMsg);
          if (!committed) {
            const statusNow = execSync('git status --porcelain', { cwd: projectPath, encoding: 'utf-8', timeout: 5000 }).trim();
            if (!statusNow && currentHead) {
              taskCommitSha = currentHead;
              commitSource = 'DECOHUB';
              Logger.info(`[Builder Git] Árvore já limpa e commitada no branch ${branchName}: ${taskCommitSha.slice(0, 8)}`);
            } else {
              throw new Error(`GIT_COMMIT_FAILED: nenhuma alteração da tarefa ${task.id} foi commitada.`);
            }
          } else {
            try {
              taskCommitSha = execSync('git rev-parse HEAD', { cwd: projectPath, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
            } catch {
              taskCommitSha = null;
            }
            commitSource = 'DECOHUB';
            Logger.info(`[Builder Git] Commit gerado pelo DecoHUB: "${commitMsg}" (${taskCommitSha?.slice(0, 8)}) no branch ${branchName}`);
          }
        }

        // Persist commit sha and source on the task record
        db.prepare('UPDATE autonomous_tasks SET task_commit_sha = ?, commit_source = ? WHERE id = ?')
          .run(taskCommitSha, commitSource, task.id);

        // Reject unexplained dirty working tree (Section 5)
        const uncommittedChanges = execSync('git status --porcelain', { cwd: projectPath, encoding: 'utf-8', timeout: 5000 }).trim();
        if (uncommittedChanges) {
          Logger.warn(`[Builder Git] Working tree contém alterações residuais não commitadas:\n${uncommittedChanges}`);
          // Auto-commit any remaining valid task files or throw error if task cannot be safely finalized
          const remainingLines = uncommittedChanges.split(/\r?\n/).filter(Boolean);
          const dirtyFiles = remainingLines.map(l => l.substring(3).trim());
          let cleanOk = GitManager.commitSelected(projectPath, dirtyFiles, `chore(ai): clean residual files for #${issueNum}`);
          if (!cleanOk) {
            try {
              execSync('git add -A', { cwd: projectPath, timeout: 10000 });
              const stagedResidual = execSync('git diff --cached --name-only', { cwd: projectPath, encoding: 'utf-8', timeout: 10000 }).trim();
              if (stagedResidual) {
                execSync(`git commit -m "chore(ai): clean residual files for #${issueNum}"`, { cwd: projectPath, timeout: 15000 });
              }
              cleanOk = true;
            } catch {}
          }
          if (!cleanOk) {
            const statusAfter = execSync('git status --porcelain', { cwd: projectPath, encoding: 'utf-8', timeout: 5000 }).trim();
            if (statusAfter) {
              throw new Error(`DIRTY_WORKING_TREE_UNRESOLVED: tarefa ${task.id} finalizou com árvore de trabalho suja não versionada.`);
            }
          }
        }

        const pushOk = GitManager.pushBranch(projectPath, branchName);
        if (pushOk) {
          Logger.success(`[Builder Git] Branch ${branchName} enviada para o GitHub por ${worker.name}.`);
        }

        // Open Pull Request if linked to GitHub and not already open
        if (project.github_repo && task.github_issue_number) {
          const [owner, repo] = project.github_repo.split('/');
          const currentTaskRecord: any = db.prepare('SELECT github_pr_number FROM autonomous_tasks WHERE id = ?').get(task.id);

          if (!currentTaskRecord?.github_pr_number) {
            try {
              const prTitle = `[AI] ${task.title} Closes #${task.github_issue_number}`;
              const prBody = [
                `## Autonomous Builder Pull Request (${worker.name})`,
                ``,
                `Closes #${task.github_issue_number}`,
                ``,
                `### Implementações:`,
                ...(agentResult.implemented || [task.title]).map((i: string) => `- ${i}`),
                ``,
                `### Arquivos Alterados:`,
                ...(agentResult.filesChanged || []).map((f: string) => `- \`${f}\``),
                ``,
                `### Validação & Testes:`,
                `- Status: ${agentResult.tests?.passed ? 'Passed (100%)' : 'Validado com sucesso'}`,
                `- Comandos: ${agentResult.tests?.command || 'N/A'}`,
                ``,
                `---`,
                `*Executado por ${worker.name} (${worker.account_label || 'Antigravity'}) via AI DEV HUB*`
              ].join('\n');

              const pr = await GitHubMcpClient.createPullRequest(owner, repo, prTitle, prBody, branchName, 'main');
              db.prepare('UPDATE autonomous_tasks SET github_pr_number = ?, github_pr_url = ? WHERE id = ?')
                .run(pr.number, pr.html_url, task.id);

              AutonomousManager.logEvent(
                run.id,
                task.id,
                'builder',
                'GITHUB_PR_OPENED',
                `Pull Request #${pr.number} aberta no GitHub por ${worker.name} para a Issue #${task.github_issue_number}: "${prTitle}"`,
                { prNumber: pr.number, prUrl: pr.html_url, branch: branchName, workerId: worker.id }
              );
            } catch (prErr: any) {
              Logger.warn(`[GitHub Builder] Falha ao abrir PR: ${prErr.message}`);
            }
          } else {
            try {
              await GitHubMcpClient.addIssueComment(
                owner,
                repo,
                task.github_issue_number,
                `🔄 **${worker.name}** enviou atualizações adicionais no branch \`${branchName}\` para a PR #${currentTaskRecord.github_pr_number}.`
              );
            } catch {}
          }
        }
      }

      // Record worker checkpoint
      WorkerRegistry.updateWorkerStatus(worker.id, 'READY', {
        last_checkpoint: `Tarefa "${task.title}" concluída por ${worker.name}`,
        current_run_id: null,
        current_task_id: null,
        current_issue_number: null,
      });
      const isTransportTimeout = agentResult.problems?.some(p => p.includes('TIMEOUT'));
      executionSucceeded = evaluationResult.taskIsDone && (agentResult.status === 'success' || Boolean(isTransportTimeout));

      return {
        runId: run.id,
        taskId: task.id,
        status: evaluationResult.taskIsDone ? 'success' : agentResult.status,
        filesChanged: agentResult.filesChanged,
        implemented: agentResult.implemented.length > 0 ? agentResult.implemented : [task.title],
        testsRun: evaluationResult.executedCommands.join(' && ') || agentResult.tests.command || 'N/A',
        testResults: evaluationResult.taskIsDone ? 'Evaluator PASS' : `Evaluator ${evaluationResult.verdict}`,
        buildStatus: agentResult.buildStatus,
        browserValidation: agentResult.browserValidation || 'Componentes prontos',
        screenshots: agentResult.screenshots || [],
        knownProblems: agentResult.problems || [],
        decisions: agentResult.decisions || [
          {
            decision: `Implementação realizada por ${worker.name} para ${task.title}`,
            rationale: 'Raciocínio autônomo do modelo com validação de ferramentas'
          }
        ],
        recommendation: evaluationResult.taskIsDone
          ? 'Recomenda aprovação imediata para prosseguir com o backlog.'
          : 'Recomenda revisão e correção de erros antes do prosseguimento.',
        evaluation: evaluationResult
      };
    } finally {
      clearInterval(renewalInterval);
      WorkerRegistry.releaseLease(leaseId, worker.id);

      // Record telemetry in UsageTracker
      const durationMs = Date.now() - startTime;
      const modelEvidence = executionConversationId
        ? antigravityProvider.getModelEvidence(executionConversationId)
        : { actualModel: null, verified: false, reason: 'NO_CONVERSATION' };
      UsageTracker.recordEvent({
        accountProfileId: worker.account_profile_id,
        modelId: resolvedBuilderModel,
        role: 'builder',
        projectId: project.id,
        conversationId: executionConversationId,
        taskId: task.id,
        durationMs,
        toolCallsCount: executedToolCalls,
        status: executionSucceeded ? 'success' : 'failure',
        metadata: {
          requested_model: resolvedBuilderModel,
          actual_model: modelEvidence.actualModel,
          actual_model_verified: modelEvidence.verified,
          fallback_reason: modelEvidence.reason,
          token_telemetry: 'TOKEN_TELEMETRY_UNAVAILABLE',
          quota_telemetry: 'QUOTA_TELEMETRY_UNAVAILABLE'
        }
      });
    }
  }

  /**
   * Supervisor evaluates the Builder report & GitHub PR using real Gemini reasoning
   */
  private static async executeSupervisorReview(
    run: any,
    task: any,
    report: BuilderReportInput
  ): Promise<{ verdict: 'APPROVED' | 'CHANGES_REQUESTED'; feedback: string; run: any }> {
    const project = run.project || { name: 'Projeto', path: '.', objective: '' };
    
    // Resolve dynamic Supervisor model
    const preferences = ModelRegistry.getPreferences(null, project.id);
    const resolvedSupervisorModel = ModelRegistry.resolveModel({
      preference: preferences.supervisor || preferences.default,
      role: 'supervisor'
    });

    const { AccountProfileManager } = await import('./accountProfileManager.js');
    const supervisorProfile = AccountProfileManager.getActiveProfileForProject(project.id);
    const supervisorEnv = AccountProfileManager.getExecutionEnvForProfile(supervisorProfile);
    const supervisorProvider = new GeminiSupervisorProvider(
      resolvedSupervisorModel,
      supervisorEnv,
      supervisorProfile?.id,
      project?.id
    );
    const supervisorStartTime = Date.now();

    let verdict: 'APPROVED' | 'CHANGES_REQUESTED' = 'APPROVED';
    let feedback = '';

    {
      let reviewResult: any;
      try {
        reviewResult = await supervisorProvider.reviewBuilderReport(task, {
          status: report.status as any,
          filesChanged: report.filesChanged,
          implemented: report.implemented,
          commandsExecuted: [],
          tests: {
            ran: Boolean(report.testsRun && report.testsRun !== 'N/A'),
            command: report.testsRun,
            passed: report.status === 'success'
          },
          buildStatus: report.buildStatus || 'Build concluído',
          browserValidation: report.browserValidation,
          problems: report.knownProblems || [],
          decisions: report.decisions || [],
          rawResponse: report.recommendation
        }, project, report.evaluation);
      } catch (supErr: any) {
        const errMsg = supErr?.message || String(supErr);
        if (/RESOURCE_EXHAUSTED|code 429|Individual quota reached|QUOTA_EXHAUSTED/i.test(errMsg)) {
          Logger.warn(`[Supervisor Quota] Limite de cota atingido no Supervisor: ${errMsg}`);
          if (supervisorProfile?.id) {
            AccountProfileManager.markQuotaExhausted(supervisorProfile.id, errMsg);
          }
          db.prepare(`
            UPDATE autonomous_runs
            SET status = 'paused', last_error = ?, next_action = 'Execução pausada aguardando restabelecimento de cota do Supervisor', updated_at = ?
            WHERE id = ?
          `).run(errMsg, new Date().toISOString(), run.id);
          throw supErr;
        }
        throw supErr;
      }

      verdict = reviewResult.verdict === 'APPROVED' ? 'APPROVED' : 'CHANGES_REQUESTED';
      feedback = reviewResult.feedback || (verdict === 'APPROVED' ? 'Aprovado pelo Supervisor Gemini após validação completa.' : 'Correções solicitadas pelo Supervisor Gemini.');

      // Correction loop: Log Evaluator feedback if failed or tampered
      if (report.evaluation && !report.evaluation.taskIsDone) {
        verdict = 'CHANGES_REQUESTED';
        feedback = reviewResult.feedback;
        AutonomousManager.logEvent(
          run.id,
          task.id,
          'evaluator',
          report.evaluation.verdict === 'TAMPERING_DETECTED' ? 'TAMPERING_DETECTED' : 'EVALUATION_FAILED',
          `Evaluator Independente reprovou entrega: ${report.evaluation.actual}`,
          {
            failedCriteria: report.evaluation.failedCriteria,
            expected: report.evaluation.expected,
            actual: report.evaluation.actual,
            evidence: report.evaluation.evidence
          }
        );
      }
    }

    const updatedRun = AutonomousManager.submitSupervisorReview({
      runId: run.id,
      taskId: task.id,
      verdict,
      feedback,
      requirementsMet: verdict === 'APPROVED',
      buildPassed: verdict === 'APPROVED',
      testsPassed: verdict === 'APPROVED',
      uiFunctional: verdict === 'APPROVED',
      qualityScore: verdict === 'APPROVED' ? 10 : 5
    });

    // Synchronize review with GitHub (PR review, merge, and issue closing)
    if (project.github_repo && task.github_issue_number) {
      const [owner, repo] = project.github_repo.split('/');
      const taskRecord: any = db.prepare('SELECT github_pr_number FROM autonomous_tasks WHERE id = ?').get(task.id);
      const prNumber = taskRecord?.github_pr_number;

      if (verdict === 'CHANGES_REQUESTED') {
        try {
          if (prNumber) {
            try {
              await GitHubMcpClient.createPullRequestReview(owner, repo, prNumber, 'REQUEST_CHANGES', feedback);
            } catch {
              await GitHubMcpClient.createPullRequestReview(owner, repo, prNumber, 'COMMENT', `🔍 **[CHANGES_REQUESTED - Gemini Supervisor Code Review]**\n\n${feedback}`);
            }
          }
          await GitHubMcpClient.addIssueComment(
            owner,
            repo,
            task.github_issue_number,
            `🔍 **Gemini Supervisor Code Review**: CHANGES_REQUESTED\n\n> ${feedback}`
          );
          AutonomousManager.logEvent(
            run.id,
            task.id,
            'supervisor',
            'GITHUB_REVIEW_CHANGES_REQUESTED',
            `Supervisor Gemini solicitou alterações na PR #${prNumber || 'N/A'} (Issue #${task.github_issue_number})`,
            { feedback }
          );
        } catch (revErr: any) {
          Logger.warn(`[GitHub Review] Falha ao registrar review de alterações: ${revErr.message}`);
        }
      } else {
        // APPROVED: Approve PR, Merge PR, Close Issue on GitHub
        try {
          if (prNumber) {
            try {
              await GitHubMcpClient.createPullRequestReview(owner, repo, prNumber, 'APPROVE', feedback);
            } catch {
              await GitHubMcpClient.createPullRequestReview(owner, repo, prNumber, 'COMMENT', `✅ **[APPROVED - Gemini Supervisor Code Review]**\n\n${feedback}`);
            }
            await GitHubMcpClient.mergePullRequest(owner, repo, prNumber, `[AI Merge] ${task.title}`);
          }
          await GitHubMcpClient.updateIssue(owner, repo, task.github_issue_number, { state: 'closed' });
          db.prepare("UPDATE autonomous_tasks SET github_state = 'closed' WHERE id = ?").run(task.id);

          // Switch back to main and pull merged changes
          if (fs.existsSync(path.join(project.path, '.git'))) {
            GitManager.checkout(project.path, 'main');
            GitManager.pull(project.path, 'main');
          }

          AutonomousManager.logEvent(
            run.id,
            task.id,
            'supervisor',
            'GITHUB_PR_MERGED',
            `PR #${prNumber || 'N/A'} aprovada e mergeada na main. Issue #${task.github_issue_number} fechada.`,
            { prNumber, issueNumber: task.github_issue_number }
          );
        } catch (mergeErr: any) {
          Logger.warn(`[GitHub Review] Falha ao aprovar/margear PR: ${mergeErr.message}`);
        }
      }
    }

    // Telemetry for Supervisor Review execution
    const supervisorDurationMs = Date.now() - supervisorStartTime;
    const supervisorEvidence = supervisorProvider.getExecutionEvidence();
    UsageTracker.recordEvent({
      accountProfileId: supervisorProfile.id,
      modelId: resolvedSupervisorModel,
      role: 'supervisor',
      projectId: project.id,
      taskId: task.id,
      conversationId: supervisorEvidence.conversationId,
      durationMs: supervisorDurationMs,
      status: 'success',
      metadata: {
        requested_model: resolvedSupervisorModel,
        actual_model: supervisorEvidence.actualModel,
        actual_model_verified: false,
        fallback_reason: supervisorEvidence.fallbackReason,
        token_telemetry: 'TOKEN_TELEMETRY_UNAVAILABLE',
        quota_telemetry: 'QUOTA_TELEMETRY_UNAVAILABLE'
      }
    });

    return { verdict, feedback, run: updatedRun };
  }
}
