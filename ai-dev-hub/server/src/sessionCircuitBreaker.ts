// server/src/sessionCircuitBreaker.ts
// Circuit Breaker anti-storm para proteção de criação de sessões no Antigravity com reuso inteligente

import crypto from 'node:crypto';
import { db } from './db.js';
import { Logger } from './logger.js';

export type SessionTelemetryEventType =
  | 'AGENT_CONVERSATION_CREATE_ATTEMPT'
  | 'CREATE_SUCCESS'
  | 'CREATE_BLOCKED'
  | 'SESSION_REUSED'
  | 'SESSION_ROTATED'
  | 'SESSION_RECOVERED'
  | 'SESSION_CREATION_STORM'
  | 'LIVE_TEST_DENIED';

export interface SessionTelemetryEvent {
  event: SessionTelemetryEventType;
  origin: 'RUNNER' | 'TEST' | 'CLI' | 'API' | 'UNKNOWN';
  projectId?: string | null;
  role?: string | null;
  runId?: string | null;
  taskId?: string | null;
  caller?: string | null;
  processId?: number;
  conversationId?: string | null;
  previousConversationId?: string | null;
  reason?: string | null;
  metadata?: Record<string, any>;
  timestamp?: string;
}

export class SessionCreationStormError extends Error {
  public code = 'SESSION_CREATION_STORM';
  constructor(message: string) {
    super(message);
    this.name = 'SessionCreationStormError';
  }
}

export class SessionCircuitBreaker {
  private static _windowMs: number = 5 * 60 * 1000; // 5 minutos janela deslizante do projeto
  private static _maxCreationsPerWindow: number = 15; // Máximo de 15 criações por projeto a cada 5 minutos
  private static _taskWindowMs: number = 2 * 60 * 1000; // 2 minutos para detecção de loop na MESMA tarefa
  private static _maxCreationsPerTask: number = 6; // Máximo de 6 criações para o mesmo taskId

  /**
   * Configure circuit breaker limits (útil para testes unitários controlados)
   */
  static configure(options: {
    windowMs?: number;
    maxCreationsPerWindow?: number;
    taskWindowMs?: number;
    maxCreationsPerTask?: number;
  }) {
    if (options.windowMs !== undefined) this._windowMs = options.windowMs;
    if (options.maxCreationsPerWindow !== undefined) this._maxCreationsPerWindow = options.maxCreationsPerWindow;
    if (options.taskWindowMs !== undefined) this._taskWindowMs = options.taskWindowMs;
    if (options.maxCreationsPerTask !== undefined) this._maxCreationsPerTask = options.maxCreationsPerTask;
  }

  static resetConfiguration() {
    this._windowMs = 5 * 60 * 1000;
    this._maxCreationsPerWindow = 15;
    this._taskWindowMs = 2 * 60 * 1000;
    this._maxCreationsPerTask = 6;
  }

  /**
   * Registra evento estruturado de telemetria no SQLite e Logger
   */
  static logTelemetry(event: SessionTelemetryEvent): void {
    const nowIso = event.timestamp || new Date().toISOString();
    const id = `telemetry-${crypto.randomUUID().slice(0, 8)}`;
    const pid = event.processId || process.pid;

    try {
      db.prepare(`
        INSERT INTO session_creation_telemetry (
          id, event_type, origin, project_id, role, run_id, task_id,
          caller, process_id, conversation_id, previous_conversation_id,
          reason, metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        event.event,
        event.origin,
        event.projectId || null,
        event.role || null,
        event.runId || null,
        event.taskId || null,
        event.caller || null,
        pid,
        event.conversationId || null,
        event.previousConversationId || null,
        event.reason || null,
        JSON.stringify(event.metadata || {}),
        nowIso
      );
    } catch (err: any) {
      Logger.warn(`[SessionCircuitBreaker] Falha ao persistir telemetria: ${err.message}`);
    }

    if (event.event === 'SESSION_CREATION_STORM' || event.event === 'LIVE_TEST_DENIED') {
      Logger.error(`[SessionCircuitBreaker] [${event.event}] ${event.reason} (Project: ${event.projectId || 'N/A'}, Role: ${event.role || 'N/A'})`);
    } else if (event.event === 'CREATE_BLOCKED') {
      Logger.warn(`[SessionCircuitBreaker] [CREATE_BLOCKED] ${event.reason} (Project: ${event.projectId || 'N/A'})`);
    } else if (event.event === 'SESSION_REUSED') {
      Logger.info(`[SessionCircuitBreaker] [SESSION_REUSED] Reutilizando conversa ${event.conversationId} para evitar storm.`);
    } else {
      Logger.info(`[SessionCircuitBreaker] [${event.event}] Project: ${event.projectId || 'N/A'}, Role: ${event.role || 'N/A'}`);
    }
  }

  /**
   * Avalia se a criação de nova conversa é permitida para o projeto.
   * Diferencia progresso legítimo (múltiplas tarefas, multi-pass) de loop infinito real (mesma tarefa travada).
   */
  static evaluateCreation(
    projectId: string,
    role?: string,
    options?: { taskId?: string | null; caller?: string | null; runId?: string | null }
  ): {
    allowed: boolean;
    reason?: string;
    recentCount: number;
    limit: number;
    isTaskStorm?: boolean;
  } {
    if (!projectId) {
      return { allowed: true, recentCount: 0, limit: this._maxCreationsPerWindow };
    }

    // 1. Verificação Estrita por Tarefa: previne loop infinito na MESMA tarefa
    if (options?.taskId) {
      const taskWindowStart = new Date(Date.now() - this._taskWindowMs).toISOString();
      try {
        const taskRow: any = db.prepare(`
          SELECT COUNT(*) as count
          FROM session_creation_telemetry
          WHERE project_id = ? AND task_id = ? AND created_at >= ?
            AND event_type IN ('AGENT_CONVERSATION_CREATE_ATTEMPT', 'CREATE_SUCCESS')
        `).get(projectId, options.taskId, taskWindowStart);

        const taskCount = taskRow?.count || 0;
        if (taskCount >= this._maxCreationsPerTask) {
          return {
            allowed: false,
            reason: `SESSION_CREATION_STORM: Limite de ${this._maxCreationsPerTask} tentativas na mesma tarefa (${options.taskId}) em ${Math.round(this._taskWindowMs / 60000)} minutos excedido (${taskCount} tentativas detectadas sem progresso).`,
            recentCount: taskCount,
            limit: this._maxCreationsPerTask,
            isTaskStorm: true
          };
        }
      } catch {}
    }

    // 2. Verificação Global do Projeto com Limite Relaxado (15 em 5 minutos)
    const windowStart = new Date(Date.now() - this._windowMs).toISOString();

    const row: any = db.prepare(`
      SELECT COUNT(*) as count
      FROM session_creation_telemetry e
      WHERE e.project_id = ? AND e.created_at >= ?
        AND (e.event_type = 'AGENT_CONVERSATION_CREATE_ATTEMPT'
          OR (e.event_type = 'CREATE_SUCCESS' AND NOT EXISTS (
            SELECT 1 FROM session_creation_telemetry a
            WHERE a.project_id = e.project_id
              AND a.event_type = 'AGENT_CONVERSATION_CREATE_ATTEMPT'
              AND a.process_id = e.process_id AND a.caller IS e.caller AND a.role IS e.role
              AND a.created_at <= e.created_at
              AND julianday(a.created_at) >= julianday(e.created_at) - 60.0 / 86400.0
          )))
    `).get(projectId, windowStart);

    const recentCount = row?.count || 0;

    if (recentCount >= this._maxCreationsPerWindow) {
      return {
        allowed: false,
        reason: `SESSION_CREATION_STORM: Limite de ${this._maxCreationsPerWindow} criações por projeto em ${Math.round(this._windowMs / 60000)} minutos excedido (${recentCount} tentativas detectadas).`,
        recentCount,
        limit: this._maxCreationsPerWindow,
        isTaskStorm: false
      };
    }

    return {
      allowed: true,
      recentCount,
      limit: this._maxCreationsPerWindow
    };
  }

  /**
   * Procura uma sessão/conversa ativa existente para o projeto/papel.
   * Usado como Fallback Anti-Storm para reutilizar sessão em vez de bloquear a execução com erro fatal.
   */
  static findReusableConversation(projectId: string, role?: string): string | null {
    if (!projectId) return null;
    try {
      const normalizedRole = (role || 'WORKER').toUpperCase();

      // 1. Sessão ativa correspondente em agent_sessions
      const activeSession: any = db.prepare(`
        SELECT provider_conversation_id 
        FROM agent_sessions 
        WHERE project_id = ? AND role = ? AND status = 'ACTIVE' AND provider_conversation_id IS NOT NULL
        ORDER BY last_used_at DESC LIMIT 1
      `).get(projectId, normalizedRole);

      if (activeSession?.provider_conversation_id) {
        return activeSession.provider_conversation_id;
      }

      // 2. Qualquer sessão ativa recente para este projeto
      const anyActiveSession: any = db.prepare(`
        SELECT provider_conversation_id 
        FROM agent_sessions 
        WHERE project_id = ? AND status = 'ACTIVE' AND provider_conversation_id IS NOT NULL
        ORDER BY last_used_at DESC LIMIT 1
      `).get(projectId);

      if (anyActiveSession?.provider_conversation_id) {
        return anyActiveSession.provider_conversation_id;
      }

      // 3. Sessão recente mais recente do projeto
      const recentSession: any = db.prepare(`
        SELECT provider_conversation_id 
        FROM agent_sessions 
        WHERE project_id = ? AND provider_conversation_id IS NOT NULL
        ORDER BY last_used_at DESC LIMIT 1
      `).get(projectId);

      if (recentSession?.provider_conversation_id) {
        return recentSession.provider_conversation_id;
      }

      // 4. Última conversa registrada na tabela conversations
      const conv: any = db.prepare(`
        SELECT id FROM conversations WHERE project_id = ? ORDER BY updated_at DESC LIMIT 1
      `).get(projectId);

      if (conv?.id) {
        return conv.id;
      }

      // 5. Última conversa com sucesso de criação em session_creation_telemetry
      const telem: any = db.prepare(`
        SELECT conversation_id FROM session_creation_telemetry 
        WHERE project_id = ? AND conversation_id IS NOT NULL AND event_type = 'CREATE_SUCCESS'
        ORDER BY created_at DESC LIMIT 1
      `).get(projectId);

      if (telem?.conversation_id) {
        return telem.conversation_id;
      }
    } catch (err: any) {
      Logger.warn(`[SessionCircuitBreaker] Falha ao buscar sessão reutilizável: ${err.message}`);
    }
    return null;
  }

  /**
   * Zera/limpa o histórico de tentativas do Circuit Breaker para um projeto específico.
   * Acionado automaticamente quando uma tarefa é concluída com sucesso (COMPLETED) ou ao retomar/iniciar um run.
   */
  static resetProjectWindow(projectId: string): void {
    if (!projectId) return;
    try {
      db.prepare(`
        DELETE FROM session_creation_telemetry
        WHERE project_id = ? AND event_type IN ('AGENT_CONVERSATION_CREATE_ATTEMPT', 'SESSION_CREATION_STORM', 'CREATE_BLOCKED')
      `).run(projectId);
      Logger.info(`[SessionCircuitBreaker] Histórico do Circuit Breaker zerado com sucesso para o projeto ${projectId}.`);
    } catch (err: any) {
      Logger.warn(`[SessionCircuitBreaker] Falha ao resetar histórico do projeto ${projectId}: ${err.message}`);
    }
  }

  /**
   * Zera o histórico de tentativas de uma tarefa específica quando ela progride
   */
  static resetTaskWindow(projectId: string, taskId: string): void {
    if (!projectId || !taskId) return;
    try {
      db.prepare(`
        DELETE FROM session_creation_telemetry
        WHERE project_id = ? AND task_id = ? AND event_type IN ('AGENT_CONVERSATION_CREATE_ATTEMPT', 'SESSION_CREATION_STORM', 'CREATE_BLOCKED')
      `).run(projectId, taskId);
    } catch {}
  }

  /**
   * Assegura que a criação é permitida; dispara erro se excedido sem possibilidade de auto-recuperação.
   */
  static assertCanCreate(opts: {
    projectId: string;
    role: string;
    origin?: 'RUNNER' | 'TEST' | 'CLI' | 'API';
    caller?: string;
    taskId?: string | null;
    runId?: string | null;
  }): void {
    const { projectId, role, origin = 'API', caller = 'unknown', taskId, runId } = opts;
    const evaluation = this.evaluateCreation(projectId, role, { taskId, caller, runId });

    if (!evaluation.allowed) {
      this.logTelemetry({
        event: 'SESSION_CREATION_STORM',
        origin,
        projectId,
        role,
        caller,
        runId,
        taskId,
        reason: evaluation.reason,
        metadata: { recentCount: evaluation.recentCount, limit: evaluation.limit, isTaskStorm: evaluation.isTaskStorm }
      });

      this.logTelemetry({
        event: 'CREATE_BLOCKED',
        origin,
        projectId,
        role,
        caller,
        runId,
        taskId,
        reason: evaluation.reason
      });

      throw new SessionCreationStormError(
        `[CIRCUIT_BREAKER] ${evaluation.reason} Bloqueio ativado para evitar criação massiva de conversas no Antigravity.`
      );
    }
  }
}
