// server/src/agentSessionManager.ts
// Centralized manager for persistent agent sessions, strict role uniqueness,
// real provider reuse, controlled context rotation with structured handoffs, and audit.

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db } from './db.js';
import { Logger } from './logger.js';
import { getLanguageServerExe } from './antigravityProvider.js';
import { MemoryManager } from './memoryManager.js';
import { GitManager } from './gitManager.js';
import { AgentApiGateway } from './agentApiGateway.js';
import { SessionCircuitBreaker } from './sessionCircuitBreaker.js';
import { ModelRegistry } from './modelRegistry.js';

export type AgentRole = 'SUPERVISOR' | 'WORKER' | 'CONVERSATIONAL';
export type AgentSessionStatus = 'ACTIVE' | 'ARCHIVED' | 'ROTATING' | 'INVALID';

export type AgentSessionEventType =
  | 'SESSION_CREATED'
  | 'SESSION_REUSED'
  | 'SESSION_ROTATION_STARTED'
  | 'SESSION_ROTATED'
  | 'SESSION_ARCHIVED'
  | 'SESSION_RECOVERED'
  | 'SESSION_INVALID'
  | 'SESSION_CREATION_RECONCILED';

export interface AgentSessionRecord {
  id: string;
  project_id: string;
  role: AgentRole;
  logical_conversation_id: string;
  provider_conversation_id: string;
  generation: number;
  status: AgentSessionStatus;
  created_at: string;
  last_used_at: string;
  last_successful_turn_at: string | null;
  context_estimate: number;
  rotation_reason: string | null;
  checkpoint_reference: string | null;
  metadata_json: string | null;
}

export interface ContextHandoffPackage {
  projectId: string;
  role: AgentRole;
  generationFrom: number;
  generationTo: number;
  logicalConversationId: string;
  originalGoal: string;
  planVersion: string;
  currentRunId: string | null;
  currentTaskId: string | null;
  taskAttemptId: string | null;
  requirements: string[];
  acceptanceCriteria: string[];
  projectDecisions: string[];
  architectureSummary: string;
  relevantFiles: string[];
  gitBranch: string | null;
  gitCommit: string | null;
  completedWork: string[];
  pendingWork: string[];
  knownErrors: string[];
  verificationEvidence: string[];
  pendingApprovals: string[];
  nextSafeAction: string;
  sourceReferences: string[];
  timestamp: string;
}

export interface SessionAuditReport {
  timestamp: string;
  totalAgentSessions: number;
  activeSessionsCount: number;
  archivedSessionsCount: number;
  invalidSessionsCount: number;
  totalActiveSessions?: number;
  totalArchivedSessions?: number;
  totalLegacyUnassociated?: number;
  byProject: Record<string, {
    projectName: string;
    supervisor?: AgentSessionRecord;
    worker?: AgentSessionRecord;
    archivedCount: number;
  }>;
  unassociatedLegacyCount: number;
  findings: string[];
}

export class AgentSessionManager {
  private static _lockMap = new Map<string, Promise<any>>();
  private static _providerCreateOverride: ((params: { model: string; title: string; prompt: string }) => string) | null = null;
  private static _providerSendMessageOverride: ((convId: string, prompt: string) => void) | null = null;
  private static _providerLivenessOverride: ((convId: string) => boolean) | null = null;

  // Context rotation threshold in estimated characters (~150k tokens ≈ 600KB)
  static CONTEXT_ROTATION_THRESHOLD_BYTES = 600 * 1024;

  /**
   * Test overrides for deterministic simulation
   */
  static setProviderCreateOverride(fn: ((params: { model: string; title: string; prompt: string }) => string) | null) {
    this._providerCreateOverride = fn;
  }

  static setProviderSendMessageOverride(fn: ((convId: string, prompt: string) => void) | null) {
    this._providerSendMessageOverride = fn;
  }

  static setProviderLivenessOverride(fn: ((convId: string) => boolean) | null) {
    this._providerLivenessOverride = fn;
  }

  /**
   * Atomically acquires a per-resource lock to serialize creations
   */
  private static async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    while (this._lockMap.has(key)) {
      try {
        await this._lockMap.get(key);
      } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "agentSessionManager",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:agentSessionManager]", err);
      }
    }
    }
    let resolveLock!: () => void;
    const lockPromise = new Promise<void>(resolve => { resolveLock = resolve; });
    this._lockMap.set(key, lockPromise);
    try {
      return await fn();
    } finally {
      this._lockMap.delete(key);
      resolveLock();
    }
  }

  /**
   * Helper to clean environment variables for language_server invocation
   */
  private static getCleanEnv(env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const rawEnv = env || process.env;
    const cleanEnv: NodeJS.ProcessEnv = { ...rawEnv };
    delete cleanEnv.ELECTRON_RUN_AS_NODE;
    delete cleanEnv.ELECTRON_NO_ASAR;
    delete cleanEnv.ELECTRON_OZONE_PLATFORM_HINT;
    delete cleanEnv.ELECTRON_ENABLE_LOGGING;
    return cleanEnv;
  }

  /**
   * Checks if a provider session is physically alive
   */
  static isSessionAlive(providerConversationId: string, env?: NodeJS.ProcessEnv): boolean {
    if (!providerConversationId) return false;
    if (this._providerLivenessOverride) {
      return this._providerLivenessOverride(providerConversationId);
    }

    try {
      const meta = AgentApiGateway.getConversationMetadata(providerConversationId, env);
      if (meta?.status === 'NOT_FOUND' || meta?.status === 'INVALID') return false;
      if (meta && (meta.status === 'OFFLINE_MOCK_ACTIVE' || meta.rootConversationId === providerConversationId)) {
        return true;
      }
      return Boolean(meta && meta.rootConversationId === providerConversationId);
    } catch (err: any) {
      const errMsg = (err?.message || err?.stderr || String(err)).toLowerCase();
      if (errMsg.includes('timeout') || errMsg.includes('timed out') || err?.code === 'ETIMEDOUT') {
        Logger.warn(`[AgentSessionManager] Timeout transitório ao verificar sessão ${providerConversationId.slice(0, 8)}. Preservando como ativa.`);
        return true;
      }
      if (errMsg.includes('not found') || errMsg.includes('notfound') || errMsg.includes('invalid conversation') || errMsg.includes('does not exist')) {
        Logger.warn(`[AgentSessionManager] Sessão ${providerConversationId.slice(0, 8)} explicitamente não encontrada no provider. Marcando como inválida.`);
        return false;
      }
      // For any other unexpected transient error, keep active
      Logger.warn(`[AgentSessionManager] Erro transitório ao verificar sessão ${providerConversationId.slice(0, 8)}: ${err.message}. Preservando.`);
      return true;
    }
  }

  /**
   * Retrieves the current ACTIVE session for a given project and role
   */
  static getActiveSession(projectId: string, role: AgentRole): AgentSessionRecord | null {
    if (!projectId || !role) return null;
    const row: any = db.prepare(`
      SELECT * FROM agent_sessions
      WHERE project_id = ? AND role = ? AND status = 'ACTIVE'
      LIMIT 1
    `).get(projectId, role);
    return row ? (row as AgentSessionRecord) : null;
  }

  /**
   * Retrieves a session by its unique ID
   */
  static getSessionById(sessionId: string): AgentSessionRecord | null {
    if (!sessionId) return null;
    const row: any = db.prepare('SELECT * FROM agent_sessions WHERE id = ?').get(sessionId);
    return row ? (row as AgentSessionRecord) : null;
  }

  /**
   * Retrieves all sessions (active and archived) for a given project
   */
  static getProjectSessions(projectId: string): AgentSessionRecord[] {
    if (!projectId) return [];
    const rows: any[] = db.prepare(`
      SELECT * FROM agent_sessions
      WHERE project_id = ?
      ORDER BY generation ASC, created_at ASC
    `).all(projectId);
    return rows.map(r => r as AgentSessionRecord);
  }

  /**
   * Centralized Operation: getOrCreateAgentSession(projectId, role)
   * Enforces strictly ONE active session per (projectId, role).
   * Reuses existing session if alive; otherwise performs atomic creation with proper naming.
   */
  static async getOrCreateAgentSession(
    projectId: string,
    role: AgentRole,
    options: {
      model?: string;
      env?: NodeJS.ProcessEnv;
      initialPrompt?: string;
      accountProfileId?: string;
      runId?: string | null;
      forceNew?: boolean;
    } = {}
  ): Promise<{ session: AgentSessionRecord; isNew: boolean }> {
    if (!projectId) throw new Error('[AgentSessionManager] projectId é estritamente obrigatório.');
    if (!role || (role !== 'SUPERVISOR' && role !== 'WORKER' && role !== 'CONVERSATIONAL')) {
      throw new Error(`[AgentSessionManager] Papel inválido: "${role}". Deve ser "SUPERVISOR", "WORKER" ou "CONVERSATIONAL".`);
    }

    const lockKey = `${projectId}:${role}`;
    return await this.withLock(lockKey, async () => {
      return await this.internalGetOrCreateAgentSession(projectId, role, options);
    });
  }

  private static async internalGetOrCreateAgentSession(
    projectId: string,
    role: AgentRole,
    options: {
      model?: string;
      env?: NodeJS.ProcessEnv;
      initialPrompt?: string;
      accountProfileId?: string;
      runId?: string | null;
      forceNew?: boolean;
    } = {}
  ): Promise<{ session: AgentSessionRecord; isNew: boolean }> {
    const nowIso = new Date().toISOString();

    // 1. Check existing active session
    if (!options.forceNew) {
      const existing = this.getActiveSession(projectId, role);
      if (existing) {
          const binding = JSON.parse(existing.metadata_json || '{}');
          if (options.accountProfileId && binding.accountProfileId && binding.accountProfileId !== options.accountProfileId) {
            throw new Error('SESSION_PROFILE_MISMATCH: sessão pertence a outro perfil; faça handoff explícito antes de usar outra conta.');
          }
          if (options.accountProfileId && !binding.accountProfileId && !AgentApiGateway.isOfflineMode()) throw new Error('SESSION_PROFILE_UNVERIFIED: perfil da sessão antiga não confirmado; reconciliar antes de enviar.');
          if (options.model && binding.model && options.model !== binding.model) throw new Error(`SESSION_MODEL_MISMATCH: sessão configurada com ${binding.model}; solicitado ${options.model}. Rotação explícita necessária.`);
          if (!AgentApiGateway.isOfflineMode() && (!binding.nativeProjectId || binding.nativeProjectId!==options.env?.ANTIGRAVITY_PROJECT_ID)) throw new Error('SESSION_NATIVE_PROJECT_MISMATCH: reconciliar o vínculo nativo antes de reutilizar a sessão.');
          const alive = this.isSessionAlive(existing.provider_conversation_id, options.env);
          if (alive) {
            // Update last_used_at
            db.prepare('UPDATE agent_sessions SET last_used_at = ? WHERE id = ?').run(nowIso, existing.id);
            Logger.info(`[AgentSessionManager] Reutilizando sessão persistente [${role} gen ${existing.generation}] "${existing.provider_conversation_id.slice(0, 8)}" no projeto "${projectId}"`);
            this.logEvent(existing.id, projectId, role, 'SESSION_REUSED', existing.generation, `Sessão [${role} gen ${existing.generation}] reutilizada com sucesso.`);
            return { session: existing, isNew: false };
          } else {
            Logger.warn(`[AgentSessionManager] Sessão ativa ${existing.id} (${existing.provider_conversation_id.slice(0, 8)}) não responde. Marcando como INVALID.`);
            this.retireSession(existing.id, 'INVALID', 'PROVIDER_SESSION_DEAD');
          }
        }
      }

      // 2. Resolve project information
      const project: any = db.prepare('SELECT id, name, path, objective FROM projects WHERE id = ?').get(projectId);
      const projectName = project?.name || 'Projeto';

      // 3. Determine next generation
      const maxGenRow: any = db.prepare(`
        SELECT COALESCE(MAX(generation), 0) as max_gen
        FROM agent_sessions
        WHERE project_id = ? AND role = ?
      `).get(projectId, role);
      const nextGeneration = (maxGenRow?.max_gen || 0) + 1;

      // 4. Determine deterministic title for Antigravity sidebar
      const roleDisplay = role === 'SUPERVISOR' ? 'Supervisor' : role === 'WORKER' ? 'Worker' : 'Conversational Agent';
      const deterministicTitle = nextGeneration === 1
        ? `${roleDisplay} — ${projectName}`
        : `${roleDisplay} ${nextGeneration} — ${projectName}`;

      // 5. Build bootstrap prompt
      const defaultPrompt = options.initialPrompt || `Sessão persistente do DecoHUB iniciada para o papel ${roleDisplay} (Geração ${nextGeneration}) no projeto "${projectName}".`;
      const model = options.model || ModelRegistry.resolveModel({
        role: role === 'SUPERVISOR' ? 'supervisor' : role === 'WORKER' ? 'builder' : 'default',
        projectId,
        accountProfileId: options.accountProfileId
      });

      // 6. Invoke provider to create conversation
      const operationId = crypto.randomUUID();
      const reservation = db.prepare("INSERT OR IGNORE INTO agent_creation_reservations (project_id,role,operation_id,owner_pid,status,created_at) VALUES (?,?,?,?,'CREATING',?)")
        .run(projectId, role, operationId, process.pid, nowIso);
      if (!reservation.changes) {
        throw new Error(`SESSION_CREATION_UNCERTAIN: criação reservada para ${projectId}/${role}; reconciliar com o provider antes de repetir.`);
      }
      let providerConversationId: string;
      try {
      if (this._providerCreateOverride) {
        providerConversationId = this._providerCreateOverride({
          model,
          title: deterministicTitle,
          prompt: defaultPrompt
        });
      } else {
        providerConversationId = AgentApiGateway.newConversation({
          model,
          title: deterministicTitle,
          prompt: defaultPrompt,
          projectId,
          role,
          runId: options.runId,
          caller: 'AgentSessionManager.getOrCreateAgentSession',
          env: options.env
        });
      }

      if (!providerConversationId) {
        throw new Error(`[AgentSessionManager] Falha ao criar sessão técnica no Antigravity para ${roleDisplay} no projeto "${projectName}".`);
      }
      } catch (err: any) {
        // A guard rejects BEFORE an external call. Other failures may have created a conversation.
        if (err.code === 'FAIL_CLOSED_GUARD' || err.code === 'SESSION_CREATION_STORM') {
          db.prepare('DELETE FROM agent_creation_reservations WHERE operation_id=?').run(operationId);
        } else {
          db.prepare("UPDATE agent_creation_reservations SET status='UNCERTAIN' WHERE operation_id=?").run(operationId);
        }
        throw err;
      }
      db.prepare("UPDATE agent_creation_reservations SET status='PROVIDER_CONFIRMED',conversation_id=? WHERE operation_id=?").run(providerConversationId, operationId);

      // 7. Persist atomically in SQLite
      const sessionId = `sess-${role.toLowerCase()}-${crypto.randomUUID().slice(0, 8)}`;
      db.exec('BEGIN IMMEDIATE');
      try {
        // Double check no other active session exists (reconcile)
        const conflict = this.getActiveSession(projectId, role);
        if (conflict) {
          throw new Error('SESSION_CREATION_CONFLICT: sessão ativa encontrada após criação; suspender e reconciliar.');
        }
        const foreign: any = db.prepare('SELECT id FROM agent_sessions WHERE provider_conversation_id=? AND project_id<>?').get(providerConversationId, projectId);
        if (foreign) throw new Error('CROSS_PROJECT_SESSION_REJECTED: provider retornou conversa de outro projeto.');

        db.prepare(`
          INSERT INTO agent_sessions (
            id, project_id, role, logical_conversation_id, provider_conversation_id,
            generation, status, created_at, last_used_at, last_successful_turn_at,
            context_estimate, rotation_reason, checkpoint_reference, metadata_json
          ) VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, 0, NULL, NULL, ?)
        `).run(
          sessionId,
          projectId,
          role,
          projectId, // Logical conversation ID is 1:1 with project!
          providerConversationId,
          nextGeneration,
          nowIso,
          nowIso,
          nowIso,
          JSON.stringify({ model, title: deterministicTitle, accountProfileId: options.accountProfileId || null, nativeProjectId: options.env?.ANTIGRAVITY_PROJECT_ID || null })
        );

        // Also sync to legacy conversations table for backwards compatibility
        try {
          db.prepare(`
            INSERT INTO conversations (
              conversation_id, project_id, account_profile_id, role, title,
              status, created_at, last_used_at, turn_count, rotation_index
            ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, 1, ?)
          `).run(
            providerConversationId,
            projectId,
            options.accountProfileId || 'acc-pro-1',
            role.toLowerCase(),
            deterministicTitle,
            nowIso,
            nowIso,
            nextGeneration
          );
        } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "agentSessionManager",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:agentSessionManager]", err);
      }
    }

        db.prepare('DELETE FROM agent_creation_reservations WHERE operation_id=?').run(operationId);
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }

      const created = this.getSessionById(sessionId)!;
      this.logEvent(sessionId, projectId, role, 'SESSION_CREATED', nextGeneration, `Sessão [${role} gen ${nextGeneration}] criada no Antigravity: "${deterministicTitle}" (${providerConversationId.slice(0, 8)})`);
      Logger.success(`[AgentSessionManager] Nova sessão persistente criada: "${deterministicTitle}" (${providerConversationId.slice(0, 8)}) [Geração ${nextGeneration}]`);
      return { session: created, isNew: true };
  }

  /**
   * Sends a message to the active agent session using agentapi send-message
   */
  static async sendMessage(
    session: AgentSessionRecord,
    content: string,
    options: {
      timeoutMs?: number;
      env?: NodeJS.ProcessEnv;
      taskTitle?: string;
    } = {}
  ): Promise<{ success: boolean; contextEstimate: number }> {
    const persisted = session ? this.getSessionById(session.id) : null;
    if (!session || session.status !== 'ACTIVE' || !persisted || persisted.status !== 'ACTIVE' || persisted.provider_conversation_id !== session.provider_conversation_id) {
      throw new Error(`[AgentSessionManager] Tentativa de enviar mensagem para sessão que não está ACTIVE (Status: ${session?.status}).`);
    }

    const timeoutMs = options.timeoutMs || 45000;
    const nowIso = new Date().toISOString();

    if (this._providerSendMessageOverride) {
      this._providerSendMessageOverride(session.provider_conversation_id, content);
    } else {
      AgentApiGateway.sendMessage({
        conversationId: session.provider_conversation_id,
        prompt: content,
        projectId: session.project_id,
        role: session.role,
        caller: 'AgentSessionManager.sendMessageToActiveSession',
        env: options.env,
        timeoutMs
      });
    }

    // Estimate context increment (prompt characters + conservative reply estimate)
    const estimatedChars = (session.context_estimate || 0) + content.length + 1500;

    db.prepare(`
      UPDATE agent_sessions
      SET last_used_at = ?, last_successful_turn_at = ?, context_estimate = ?
      WHERE id = ?
    `).run(nowIso, nowIso, estimatedChars, session.id);

    // Also update legacy turn count if present
    try {
      db.prepare(`
        UPDATE conversations
        SET last_used_at = ?, turn_count = turn_count + 1
        WHERE conversation_id = ?
      `).run(nowIso, session.provider_conversation_id);
    } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "agentSessionManager",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:agentSessionManager]", err);
      }
    }

    this.logEvent(
      session.id,
      session.project_id,
      session.role,
      'SESSION_REUSED',
      session.generation,
      `Turno executado na sessão ${session.provider_conversation_id.slice(0, 8)}${options.taskTitle ? ` (Tarefa: "${options.taskTitle}")` : ''}. Estimativa de contexto: ${Math.round(estimatedChars / 1024)} KB.`
    );

    return { success: true, contextEstimate: estimatedChars };
  }

  /**
   * Controlled Context Rotation & Handoff
   * 1. Checkpoint & structured handoff package created
   * 2. New session created with handoff context
   * 3. Old session marked ARCHIVED
   * 4. Single logical conversation preserved in UI
   */
  static async rotateSession(
    projectId: string,
    role: AgentRole,
    reason: string,
    options: {
      model?: string;
      env?: NodeJS.ProcessEnv;
      runId?: string | null;
      taskId?: string | null;
    } = {}
  ): Promise<{ newSession: AgentSessionRecord; handoffPackage: ContextHandoffPackage; handoffFile: string }> {
    const lockKey = `${projectId}:${role}`;
    return await this.withLock(lockKey, async () => {
      const active = this.getActiveSession(projectId, role);
      if (!active) {
        throw new Error(`[AgentSessionManager] Não há sessão ativa para rotacionar no projeto "${projectId}" para o papel "${role}".`);
      }

      const project: any = db.prepare('SELECT id, name, path, objective FROM projects WHERE id = ?').get(projectId);
      if (!project) throw new Error(`[AgentSessionManager] Projeto ${projectId} não encontrado.`);

      Logger.warn(`[AgentSessionManager] Iniciando rotação controlada de [${role} gen ${active.generation}] no projeto "${project.name}". Motivo: ${reason}`);
      this.logEvent(active.id, projectId, role, 'SESSION_ROTATION_STARTED', active.generation, `Iniciando rotação de contexto. Motivo: ${reason}`);

      // 1. Build authoritative Context Handoff Package
      const handoffPackage = await this.buildHandoffPackage({
        projectId,
        role,
        generationFrom: active.generation,
        generationTo: active.generation + 1,
        project,
        runId: options.runId || null,
        taskId: options.taskId || null
      });

      // 2. Persist handoff checkpoint file to project memory
      const handoffDir = path.join(project.path, '.ai-dev-hub', 'handoffs');
      if (!fs.existsSync(handoffDir)) fs.mkdirSync(handoffDir, { recursive: true });
      const handoffFileName = `handoff-${role.toLowerCase()}-gen${active.generation}-to-gen${active.generation + 1}.json`;
      const handoffFilePath = path.join(handoffDir, handoffFileName);
      fs.writeFileSync(handoffFilePath, JSON.stringify(handoffPackage, null, 2), 'utf-8');

      // 3. Format continuity bootstrap prompt for the new session
      const continuityBootstrap = [
        `=== CONTINUIDADE DE CONTEXTO E HANDOFF KARPATHY (AI DEV HUB) ===`,
        `PROJETO: ${project.name}`,
        `PAPEL: ${role === 'SUPERVISOR' ? 'Supervisor' : 'Worker'} (Geração ${active.generation + 1})`,
        `GERAÇÃO ANTERIOR: ${active.generation} (Arquivada por rotação controlada)`,
        `OBJETIVO ORIGINAL: ${handoffPackage.originalGoal}`,
        ``,
        `--- ARQUITETURA & DECISÕES FUNDACIONAIS ---`,
        handoffPackage.architectureSummary ? handoffPackage.architectureSummary.slice(0, 1000) : 'Conforme constitution',
        handoffPackage.projectDecisions.length > 0 ? `Decisões:\n${handoffPackage.projectDecisions.slice(0, 5).join('\n')}` : '',
        ``,
        `--- ESTADO DO TRABALHO ---`,
        `Trabalho Concluído: ${handoffPackage.completedWork.join(', ') || 'Nenhum'}`,
        `Trabalho Pendente: ${handoffPackage.pendingWork.join(', ') || 'Próxima tarefa no pipeline'}`,
        `Git Branch Atual: ${handoffPackage.gitBranch || 'main'} | Commit: ${handoffPackage.gitCommit?.slice(0, 7) || 'N/A'}`,
        ``,
        `INSTRUÇÃO DE CONTINUIDADE: Você está continuando um projeto existente em nova sessão limpa. Não recrie arquivos existentes, não perca critérios e continue rigorosamente a partir deste estado confirmado.`
      ].filter(Boolean).join('\n');

      // 4. Mark old session as ROTATING
      db.prepare("UPDATE agent_sessions SET status = 'ROTATING' WHERE id = ?").run(active.id);

      // 5. Create new session via internalGetOrCreateAgentSession (forceNew: true)
      let newSession: AgentSessionRecord;
      try {
      ({ session: newSession } = await this.internalGetOrCreateAgentSession(projectId, role, {
        model: options.model,
        env: options.env,
        initialPrompt: continuityBootstrap,
        accountProfileId: JSON.parse(active.metadata_json || '{}').accountProfileId,
        runId: options.runId,
        forceNew: true
      }));
      } catch (err) {
        db.prepare("UPDATE agent_sessions SET status='ACTIVE' WHERE id=?").run(active.id);
        throw err;
      }

      // 6. Finalize old session to ARCHIVED
      db.prepare(`
        UPDATE agent_sessions
        SET status = 'ARCHIVED', rotation_reason = ?, checkpoint_reference = ?
        WHERE id = ?
      `).run(reason, handoffFileName, active.id);

      // Legacy table update
      try {
        db.prepare("UPDATE conversations SET status = 'retired', rotation_reason = ? WHERE conversation_id = ?")
          .run(reason, active.provider_conversation_id);
      } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "agentSessionManager",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:agentSessionManager]", err);
      }
    }

      this.logEvent(active.id, projectId, role, 'SESSION_ARCHIVED', active.generation, `Sessão anterior arquivada após handoff para Geração ${newSession.generation}.`);
      this.logEvent(newSession.id, projectId, role, 'SESSION_ROTATED', newSession.generation, `Rotação concluída com sucesso: [${role} gen ${active.generation}] -> [${role} gen ${newSession.generation}]. Handoff: ${handoffFileName}`);

      Logger.success(`[AgentSessionManager] Rotação concluída com sucesso: [${role} gen ${active.generation}] -> [${role} gen ${newSession.generation}] no projeto "${project.name}"`);
      return { newSession, handoffPackage, handoffFile: handoffFilePath };
    });
  }

  /**
   * Builds the comprehensive, verified ContextHandoffPackage from real storage
   */
  private static async buildHandoffPackage(params: {
    projectId: string;
    role: AgentRole;
    generationFrom: number;
    generationTo: number;
    project: any;
    runId: string | null;
    taskId: string | null;
  }): Promise<ContextHandoffPackage> {
    const { projectId, role, generationFrom, generationTo, project, runId, taskId } = params;

    // Read real memory files
    const memory = MemoryManager.readMemoryFiles(project.path);
    const gitInfo = GitManager.getGitInfo(project.path);

    // Extract completed and pending tasks from DB
    let completedWork: string[] = [];
    let pendingWork: string[] = [];
    let requirements: string[] = [];
    let acceptanceCriteria: string[] = [];

    try {
      const tasks: any[] = db.prepare(`
        SELECT title, status, criteria_json FROM autonomous_tasks
        WHERE run_id IN (SELECT id FROM autonomous_runs WHERE project_id = ?)
        ORDER BY order_index ASC
      `).all(projectId);

      for (const t of tasks) {
        if (t.status === 'completed') completedWork.push(t.title);
        else pendingWork.push(t.title);

        if (t.criteria_json) {
          try {
            const crits = JSON.parse(t.criteria_json);
            if (Array.isArray(crits)) acceptanceCriteria.push(...crits);
          } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "agentSessionManager",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:agentSessionManager]", err);
      }
    }
        }
      }
    } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "agentSessionManager",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:agentSessionManager]", err);
      }
    }

    // Extract decisions from decisions.md or program.md
    const projectDecisions: string[] = [];
    if (memory.decisionsMd) {
      const lines = memory.decisionsMd.split('\n');
      for (const line of lines) {
        if (line.includes('DECISION_') || line.startsWith('- **Decisão:')) {
          projectDecisions.push(line.trim());
        }
      }
    }

    return {
      projectId,
      role,
      generationFrom,
      generationTo,
      logicalConversationId: projectId,
      originalGoal: project.objective || 'Desenvolvimento autônomo do projeto',
      planVersion: `plan-v${generationTo}`,
      currentRunId: runId,
      currentTaskId: taskId,
      taskAttemptId: taskId ? `attempt-${Date.now()}` : null,
      requirements: requirements.length > 0 ? requirements : ['Desenvolver software com código funcional e testes'],
      acceptanceCriteria: [...new Set(acceptanceCriteria)],
      projectDecisions,
      architectureSummary: memory.architectureMd || memory.projectMd || `Stack: ${project.stack || 'Node/TypeScript'}`,
      relevantFiles: gitInfo.changedFiles.map(f => f.path),
      gitBranch: gitInfo.branch,
      gitCommit: gitInfo.lastCommit?.hash || null,
      completedWork,
      pendingWork,
      knownErrors: [],
      verificationEvidence: [],
      pendingApprovals: [],
      nextSafeAction: 'Executar próxima etapa do plano preservando implementações anteriores',
      sourceReferences: ['.ai-dev-hub/project.md', '.ai-dev-hub/decisions.md', '.ai-dev-hub/tasks.md'],
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Retires a session explicitly (ARCHIVED or INVALID)
   */
  static retireSession(sessionId: string, status: 'ARCHIVED' | 'INVALID', reason: string): void {
    const session = this.getSessionById(sessionId);
    if (!session) return;

    db.prepare(`
      UPDATE agent_sessions
      SET status = ?, rotation_reason = ?
      WHERE id = ?
    `).run(status, reason, sessionId);

    try {
      db.prepare("UPDATE conversations SET status = 'retired', rotation_reason = ? WHERE conversation_id = ?")
        .run(reason, session.provider_conversation_id);
    } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "agentSessionManager",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:agentSessionManager]", err);
      }
    }

    this.logEvent(sessionId, session.project_id, session.role, status === 'ARCHIVED' ? 'SESSION_ARCHIVED' : 'SESSION_INVALID', session.generation, `Sessão marcada como ${status}. Motivo: ${reason}`);
    Logger.info(`[AgentSessionManager] Sessão ${sessionId} (${session.provider_conversation_id.slice(0, 8)}) marcada como ${status} (${reason})`);
  }

  /**
   * Checks if an active session should rotate based on context estimate or transcripts
   */
  static checkContextRotationPolicy(session: AgentSessionRecord, appDataBrainDir?: string): { shouldRotate: boolean; reason?: string } {
    if (!session || session.status !== 'ACTIVE') return { shouldRotate: false };

    // Bytes and estimated characters are not a verified model context limit.
    const metadata = JSON.parse(session.metadata_json || '{}');
    if (metadata.contextLimitVerified === true && metadata.contextLimitReason) {
      return { shouldRotate: true, reason: metadata.contextLimitReason };
    }

    return { shouldRotate: false };
  }

  /**
   * Read-only Audit of existing sessions across all projects or specific project
   */
  static auditSessions(projectIdFilter?: string): SessionAuditReport {
    const nowIso = new Date().toISOString();
    const query = projectIdFilter
      ? db.prepare('SELECT * FROM agent_sessions WHERE project_id = ?').all(projectIdFilter) as any[]
      : db.prepare('SELECT * FROM agent_sessions').all() as any[];

    const projects: any[] = db.prepare('SELECT id, name FROM projects').all();
    const projectMap = new Map<string, string>();
    for (const p of projects) projectMap.set(p.id, p.name);

    const byProject: Record<string, any> = {};
    let activeSessionsCount = 0;
    let archivedSessionsCount = 0;
    let invalidSessionsCount = 0;

    for (const row of query) {
      const sess = row as AgentSessionRecord;
      if (!byProject[sess.project_id]) {
        byProject[sess.project_id] = {
          projectName: projectMap.get(sess.project_id) || sess.project_id,
          archivedCount: 0
        };
      }

      if (sess.status === 'ACTIVE') {
        activeSessionsCount++;
        if (sess.role === 'SUPERVISOR') byProject[sess.project_id].supervisor = sess;
        else if (sess.role === 'WORKER') byProject[sess.project_id].worker = sess;
      } else if (sess.status === 'ARCHIVED') {
        archivedSessionsCount++;
        byProject[sess.project_id].archivedCount++;
      } else if (sess.status === 'INVALID') {
        invalidSessionsCount++;
      }
    }

    // Check legacy conversations table for unassociated legacy items
    const legacyCount: any = db.prepare(`
      SELECT count(*) as count FROM conversations
      WHERE project_id IS NULL OR project_id NOT IN (SELECT id FROM projects)
    `).get();

    const findings: string[] = [];
    for (const [pId, pData] of Object.entries(byProject)) {
      if (!pData.supervisor) findings.push(`Projeto "${pData.projectName}" (${pId.slice(0, 8)}) não possui Supervisor ACTIVE.`);
      if (!pData.worker) findings.push(`Projeto "${pData.projectName}" (${pId.slice(0, 8)}) não possui Worker ACTIVE.`);
    }

    return {
      timestamp: nowIso,
      totalAgentSessions: query.length,
      activeSessionsCount,
      archivedSessionsCount,
      invalidSessionsCount,
      totalActiveSessions: activeSessionsCount,
      totalArchivedSessions: archivedSessionsCount,
      totalLegacyUnassociated: legacyCount?.count || 0,
      byProject,
      unassociatedLegacyCount: legacyCount?.count || 0,
      findings
    };
  }

  /**
   * Log an event into agent_session_events table
   */
  private static logEvent(
    sessionId: string,
    projectId: string,
    role: AgentRole,
    eventType: AgentSessionEventType,
    generation: number,
    details: string,
    metadata?: any
  ): void {
    try {
      db.prepare(`
        INSERT INTO agent_session_events (id, session_id, project_id, role, event_type, generation, details, metadata_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        crypto.randomUUID(),
        sessionId,
        projectId,
        role,
        eventType,
        generation,
        details,
        metadata ? JSON.stringify(metadata) : null,
        new Date().toISOString()
      );
    } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "agentSessionManager",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:agentSessionManager]", err);
      }
    }
  }
}
