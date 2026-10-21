// server/src/metaChatService.ts
// DecoHUB Meta-Chat: Chat Livre de Auto-Evolução e Modificação do Próprio Código
// Permite ao usuário solicitar melhorias, refatorações e correções no DecoHUB com Typecheck Guard e Self-Healing.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { db } from './db.js';
import { Logger } from './logger.js';
import { AgentApiGateway } from './agentApiGateway.js';
import { AntigravityDiscovery } from './antigravityDiscovery.js';
import { AccountProfileManager } from './accountProfileManager.js';
import { NativeWorkspaceBinding } from './nativeWorkspaceBinding.js';
import { ModelRegistry } from './modelRegistry.js';
import { AntigravityProvider } from './antigravityProvider.js';
import { DevAutonomyService } from './devAutonomyService.js';
import { TurnCancellationManager } from './turnCancellationManager.js';
import { ExecutionCoordinator } from './executionCoordinator.js';

export interface MetaChatThread {
  id: string;
  title: string;
  provider_conversation_id?: string | null;
  model: string;
  effort: string;
  account_id?: string | null;
  status: 'idle' | 'running';
  files_modified_count: number;
  last_message_preview?: string | null;
  created_at: string;
  updated_at: string;
}

export interface MetaChatPipelineTask {
  id: 'task-inspect' | 'task-implement' | 'task-verify' | 'task-guard';
  label: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
  details?: string;
}

export interface MetaChatLiveStep {
  id: string;
  type: 'READ' | 'SEARCH' | 'EDIT' | 'COMMAND' | 'GUARD';
  target: string;
  status: 'running' | 'done' | 'failed';
  timestamp: string;
  durationMs?: number;
  details?: string;
}

export interface MetaChatLiveActivity {
  isExecuting: boolean;
  threadId?: string;
  activeAccount?: string;
  activeModel?: string;
  currentActionSummary: string;
  elapsedMs: number;
  pipelineTasks: MetaChatPipelineTask[];
  liveSteps: MetaChatLiveStep[];
  filesModified: string[];
}

export interface MetaChatLiveStatus {
  isRunning: boolean;
  isExecuting: boolean;
  phase: string;
  currentPhase: string;
  activeAccount?: string;
  activeAccountId?: string;
  activeModel?: string;
  startedAt?: string;
  elapsedSeconds?: number;
  lastStep?: string;
  cancelRequested?: boolean;
}

export interface MetaChatAttachment {
  name: string;
  size?: number;
  type?: string;
  base64Content?: string;
  content?: string;
  diskPath?: string;
  isImage?: boolean;
}

export interface MetaChatMessage {
  id: string;
  thread_id?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  executed_steps_json?: string | null;
  metadata?: {
    files_changed?: string[];
    filesModified?: string[];
    typecheck?: {
      passed: boolean;
      duration_ms: number;
      output?: string;
    };
    tests?: {
      ran: boolean;
      passed: boolean;
      command?: string;
      output?: string;
    };
    recompiled?: boolean;
    synced?: boolean;
    error?: string;
    conversationId?: string;
    model?: string;
    reasoningMode?: 'high' | 'medium' | 'low';
    accountId?: string;
    attachments?: Array<{
      name: string;
      size?: number;
      type?: string;
      diskPath?: string;
      isImage?: boolean;
    }>;
    executedSteps?: MetaChatLiveStep[];
    pipelineTasks?: MetaChatPipelineTask[];
    [key: string]: any;
  } | null;
  created_at: string;
}

export interface MetaChatHandleOptions {
  threadId?: string;
  model?: string;
  reasoningMode?: 'high' | 'medium' | 'low';
  accountId?: string;
  profileId?: string;
  attachments?: MetaChatAttachment[];
  codeActions?: Array<{ action: 'write' | 'read' | 'delete'; filePath: string; content?: string }>;
  runTests?: boolean;
  testFile?: string;
  retryAfterFailover?: boolean;
}

export interface MetaChatResponse {
  message: MetaChatMessage;
  filesChanged: string[];
  typecheck: {
    passed: boolean;
    durationMs: number;
    output?: string;
  };
  tests?: {
    ran: boolean;
    passed: boolean;
    output?: string;
  };
  selfHealed?: boolean;
  conversationId?: string;
  status?: string;
  telemetry?: MetaChatLiveActivity | MetaChatLiveStatus;
}

export class MetaChatService {
  private static _repoRoot: string | null = null;
  private static _liveStatus: MetaChatLiveStatus = {
    isRunning: false,
    isExecuting: false,
    phase: 'IDLE',
    currentPhase: 'Pronto'
  };
  private static _currentExecution: {
    cancelRequested: boolean;
    startedAt: string;
    phase: string;
    model: string;
    accountId?: string;
    threadId: string;
    baselineBefore?: Map<string, { size: number; mtime: number; hash?: string; content?: string | null }>;
    conversationId?: string;
    root: string;
    filesChanged: Set<string>;
    currentActionSummary: string;
    pipelineTasks: MetaChatPipelineTask[];
    liveSteps: MetaChatLiveStep[];
    lastTranscriptLineCount: number;
    userProfileDir?: string;
  } | null = null;
  private static _accountConversations = new Map<string, string>();

  static getLiveStatus(): MetaChatLiveStatus {
    const isExecuting = Boolean(this._currentExecution && !this._currentExecution.cancelRequested);
    let elapsedSeconds = 0;
    if (isExecuting && this._currentExecution?.startedAt) {
      elapsedSeconds = Math.max(0, Math.floor((Date.now() - new Date(this._currentExecution.startedAt).getTime()) / 1000));
    }
    const currentPhase = isExecuting
      ? (this._currentExecution?.phase || 'Processando...')
      : (this._liveStatus.phase || 'IDLE');

    return {
      isRunning: isExecuting || this._liveStatus.isRunning,
      isExecuting: isExecuting || this._liveStatus.isExecuting,
      phase: currentPhase,
      currentPhase,
      activeAccount: this._currentExecution?.accountId || this._liveStatus.activeAccount,
      activeAccountId: this._currentExecution?.accountId || this._liveStatus.activeAccountId,
      activeModel: this._currentExecution?.model || this._liveStatus.activeModel,
      startedAt: this._currentExecution?.startedAt || this._liveStatus.startedAt,
      elapsedSeconds,
      cancelRequested: Boolean(this._currentExecution?.cancelRequested),
      lastStep: this._liveStatus.lastStep
    };
  }

  static updateLiveStatus(status: Partial<MetaChatLiveStatus>): void {
    if (this._currentExecution && status.phase) {
      this._currentExecution.phase = status.phase;
    }
    this._liveStatus = {
      ...this._liveStatus,
      ...status
    };
  }

  static deleteMessage(id: string): boolean {
    try {
      const res = db.prepare('DELETE FROM meta_chat_messages WHERE id = ?').run(id);
      return Boolean(res.changes > 0);
    } catch (err: any) {
      Logger.warn(`[MetaChatService] Erro ao remover mensagem ${id}: ${err.message}`);
      return false;
    }
  }

  static cancelActiveExecution(): { cancelled: boolean; message: string } {
    TurnCancellationManager.requestCancellation('metachat');

    // Always release any locks in ExecutionCoordinator for metachat
    try {
      ExecutionCoordinator.releaseByContext({ scope: 'metachat' });
      ExecutionCoordinator.reconcileDeadReservations();
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "metaChatService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:metaChatService]", err);
      }
    }

    if (this._currentExecution) {
      this._currentExecution.cancelRequested = true;
      const convId = this._currentExecution.conversationId;
      if (convId) {
        TurnCancellationManager.requestCancellation(convId);
        try {
          ExecutionCoordinator.releaseByContext({ scope: convId });
        } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "metaChatService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:metaChatService]", err);
      }
    }
      }

      // Rollback files that were changed or diffed
      if (this._currentExecution.baselineBefore && this._currentExecution.root) {
        const changed = Array.from(this._currentExecution.filesChanged);
        const currentDiff = this.diffFileBaseline(this._currentExecution.root, this._currentExecution.baselineBefore);
        const allToRollback = [...new Set([...changed, ...currentDiff])];
        if (allToRollback.length > 0) {
          this.rollbackChangedFiles(this._currentExecution.root, allToRollback, this._currentExecution.baselineBefore);
        }
      }

      if (this._currentExecution.threadId) {
        this.updateThread(this._currentExecution.threadId, { status: 'idle' });
      }

      // Add cancellation record to Meta-Chat history
      this.addMessage({
        role: 'system',
        content: '[CANCELADO] Execução interrompida pelo usuário (arquivos preservados no estado íntegro)',
        thread_id: this._currentExecution.threadId,
        metadata: {
          cancelled: true,
          phase: this._currentExecution.phase,
          model: this._currentExecution.model,
          accountId: this._currentExecution.accountId
        }
      });

      this._liveStatus = {
        isRunning: false,
        isExecuting: false,
        phase: 'Pronto',
        currentPhase: 'Pronto',
        cancelRequested: true
      };
      this._currentExecution = null;

      return { cancelled: true, message: 'Execução do Meta-Chat cancelada com sucesso.' };
    }

    // Mesmo sem _currentExecution ativo, garante registro no histórico e limpeza de status
    this.addMessage({
      role: 'system',
      content: '[CANCELADO] Execução interrompida pelo usuário (arquivos preservados no estado íntegro)',
      metadata: {
        cancelled: true
      }
    });

    this._liveStatus = {
      isRunning: false,
      isExecuting: false,
      phase: 'Pronto',
      currentPhase: 'Pronto',
      cancelRequested: true
    };

    return { cancelled: true, message: 'Execução do Meta-Chat cancelada com sucesso.' };
  }

  // ==========================================
  // THREAD MANAGEMENT (Multi-Threads SQLite)
  // ==========================================

  static getActiveThreadId(): string {
    try {
      const row = db
        .prepare("SELECT value FROM system_settings WHERE key = 'metachat_active_thread_id'")
        .get() as any;
      if (row?.value) {
        const exists = db.prepare('SELECT id FROM meta_chat_threads WHERE id = ?').get(row.value);
        if (exists) return row.value;
      }

      const latest = db
        .prepare('SELECT id FROM meta_chat_threads ORDER BY updated_at DESC LIMIT 1')
        .get() as any;
      if (latest?.id) {
        this.setActiveThreadId(latest.id);
        return latest.id;
      }

      const created = this.createThread({ title: 'Conversa Inicial de Auto-Evolução' });
      return created.id;
    } catch {
      return 'thread-default';
    }
  }

  static setActiveThreadId(threadId: string): void {
    try {
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO system_settings (key, value, updated_at)
        VALUES ('metachat_active_thread_id', ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `).run(threadId, now);
    } catch (err: any) {
      Logger.warn(`[MetaChatService] Erro ao definir active thread ${threadId}: ${err.message}`);
    }
  }

  static getOrCreateActiveThread(): MetaChatThread {
    const activeId = this.getActiveThreadId();
    let thread = this.getThread(activeId);
    if (!thread) {
      thread = this.createThread({ title: 'Conversa Inicial de Auto-Evolução' });
    }
    return thread;
  }

  static createThread(input?: {
    title?: string;
    model?: string;
    effort?: string;
    account_id?: string;
  }): MetaChatThread {
    const id = `thread-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
    const nowIso = new Date().toISOString();
    const title = input?.title?.trim() || 'Nova Conversa';
    const model = input?.model || 'gemini-3.8-flash';
    const effort = input?.effort || 'HIGH';
    const account_id = input?.account_id || null;

    db.prepare(`
      INSERT INTO meta_chat_threads (id, title, provider_conversation_id, model, effort, account_id, status, files_modified_count, last_message_preview, created_at, updated_at)
      VALUES (?, ?, NULL, ?, ?, ?, 'idle', 0, NULL, ?, ?)
    `).run(id, title, model, effort, account_id, nowIso, nowIso);

    this.setActiveThreadId(id);

    return {
      id,
      title,
      provider_conversation_id: null,
      model,
      effort,
      account_id,
      status: 'idle',
      files_modified_count: 0,
      last_message_preview: null,
      created_at: nowIso,
      updated_at: nowIso
    };
  }

  static listThreads(): MetaChatThread[] {
    try {
      const rows = db.prepare(`
        SELECT id, title, provider_conversation_id, model, effort, account_id, status, files_modified_count, last_message_preview, created_at, updated_at
        FROM meta_chat_threads
        ORDER BY updated_at DESC
      `).all() as any[];

      if (rows.length === 0) {
        const defaultThread = this.createThread({ title: 'Conversa Inicial de Auto-Evolução' });
        return [defaultThread];
      }

      return rows.map(r => ({
        id: r.id,
        title: r.title,
        provider_conversation_id: r.provider_conversation_id || null,
        model: r.model || 'gemini-3.8-flash',
        effort: r.effort || 'HIGH',
        account_id: r.account_id || null,
        status: (r.status === 'running' ? 'running' : 'idle') as 'idle' | 'running',
        files_modified_count: Number(r.files_modified_count) || 0,
        last_message_preview: r.last_message_preview || null,
        created_at: r.created_at,
        updated_at: r.updated_at
      }));
    } catch (err: any) {
      Logger.warn(`[MetaChatService] Erro ao listar threads: ${err.message}`);
      return [];
    }
  }

  static getThread(threadId: string): MetaChatThread | null {
    try {
      const row = db.prepare(`
        SELECT id, title, provider_conversation_id, model, effort, account_id, status, files_modified_count, last_message_preview, created_at, updated_at
        FROM meta_chat_threads
        WHERE id = ?
      `).get(threadId) as any;

      if (!row) return null;

      return {
        id: row.id,
        title: row.title,
        provider_conversation_id: row.provider_conversation_id || null,
        model: row.model || 'gemini-3.8-flash',
        effort: row.effort || 'HIGH',
        account_id: row.account_id || null,
        status: (row.status === 'running' ? 'running' : 'idle') as 'idle' | 'running',
        files_modified_count: Number(row.files_modified_count) || 0,
        last_message_preview: row.last_message_preview || null,
        created_at: row.created_at,
        updated_at: row.updated_at
      };
    } catch {
      return null;
    }
  }

  static updateThread(threadId: string, updates: Partial<MetaChatThread>): MetaChatThread | null {
    try {
      const existing = this.getThread(threadId);
      if (!existing) return null;

      const updated: MetaChatThread = {
        ...existing,
        ...updates,
        updated_at: new Date().toISOString()
      };

      db.prepare(`
        UPDATE meta_chat_threads
        SET title = ?, model = ?, effort = ?, account_id = ?, status = ?, files_modified_count = ?, last_message_preview = ?, updated_at = ?
        WHERE id = ?
      `).run(
        updated.title,
        updated.model,
        updated.effort,
        updated.account_id ?? null,
        updated.status,
        updated.files_modified_count,
        updated.last_message_preview ?? null,
        updated.updated_at,
        threadId
      );

      return updated;
    } catch (err: any) {
      Logger.warn(`[MetaChatService] Erro ao atualizar thread ${threadId}: ${err.message}`);
      return null;
    }
  }

  static deleteThread(threadId: string): boolean {
    try {
      db.prepare('DELETE FROM meta_chat_messages WHERE thread_id = ?').run(threadId);
      const res = db.prepare('DELETE FROM meta_chat_threads WHERE id = ?').run(threadId);
      if (res.changes > 0) {
        const activeId = this.getActiveThreadId();
        if (activeId === threadId) {
          const remaining = db
            .prepare('SELECT id FROM meta_chat_threads ORDER BY updated_at DESC LIMIT 1')
            .get() as any;
          if (remaining?.id) {
            this.setActiveThreadId(remaining.id);
          } else {
            this.createThread({ title: 'Conversa Inicial de Auto-Evolução' });
          }
        }
        return true;
      }
      return false;
    } catch (err: any) {
      Logger.warn(`[MetaChatService] Erro ao remover thread ${threadId}: ${err.message}`);
      return false;
    }
  }

  // ==========================================
  // REAL-TIME ACTIVITY & LIVE TELEMETRY
  // ==========================================

  static recordLiveStep(step: {
    type: 'READ' | 'SEARCH' | 'EDIT' | 'COMMAND' | 'GUARD';
    target: string;
    status: 'running' | 'done' | 'failed';
    details?: string;
    durationMs?: number;
  }): void {
    if (!this._currentExecution) return;
    const id = `step-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const liveStep: MetaChatLiveStep = {
      id,
      type: step.type,
      target: step.target,
      status: step.status,
      timestamp: new Date().toISOString(),
      durationMs: step.durationMs,
      details: step.details || `${step.type}: ${step.target}`
    };
    this._currentExecution.liveSteps.push(liveStep);
    this._currentExecution.currentActionSummary = liveStep.details || `${step.type}: ${step.target}`;
    this.updateLiveStatus({
      lastStep: liveStep.details
    });
  }

  static updatePipelineTask(
    taskId: 'task-inspect' | 'task-implement' | 'task-verify' | 'task-guard',
    status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped',
    details?: string
  ): void {
    if (!this._currentExecution) return;
    const task = this._currentExecution.pipelineTasks.find(t => t.id === taskId);
    if (task) {
      task.status = status;
      if (details) task.details = details;
    }
  }

  static getLiveActivity(threadId?: string): MetaChatLiveActivity {
    const targetThreadId = threadId || this.getActiveThreadId();

    if (this._currentExecution && !this._currentExecution.cancelRequested) {
      const elapsedMs = Math.max(0, Date.now() - new Date(this._currentExecution.startedAt).getTime());

      // Inspect Antigravity transcript in real-time if active
      if (this._currentExecution.conversationId && this._currentExecution.userProfileDir) {
        try {
          const brainDir = path.join(this._currentExecution.userProfileDir, '.gemini', 'antigravity', 'brain');
          const transcriptPath = path.join(
            brainDir,
            this._currentExecution.conversationId,
            '.system_generated',
            'logs',
            'transcript.jsonl'
          );
          if (fs.existsSync(transcriptPath)) {
            const lines = fs.readFileSync(transcriptPath, 'utf-8').trim().split('\n').filter(Boolean);
            if (lines.length > this._currentExecution.lastTranscriptLineCount) {
              for (let i = this._currentExecution.lastTranscriptLineCount; i < lines.length; i++) {
                try {
                  const entry = JSON.parse(lines[i]);
                  if (entry.tool_calls && Array.isArray(entry.tool_calls)) {
                    for (const tc of entry.tool_calls) {
                      const fnName = String(tc.function?.name || tc.name || '');
                      const rawArgs = tc.function?.arguments || tc.args || {};
                      const args = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs;
                      let type: 'READ' | 'SEARCH' | 'EDIT' | 'COMMAND' | 'GUARD' = 'READ';
                      let target = '';
                      let details = '';

                      if (fnName.includes('read')) {
                        type = 'READ';
                        target = args.Path || args.path || args.file_path || 'arquivo';
                        details = `Lendo arquivo: ${path.basename(target)}`;
                      } else if (
                        fnName.includes('edit') ||
                        fnName.includes('write') ||
                        fnName.includes('replace')
                      ) {
                        type = 'EDIT';
                        target = args.Path || args.path || args.file_path || 'arquivo';
                        details = `Modificando arquivo: ${path.basename(target)}`;
                        this.updatePipelineTask('task-inspect', 'completed');
                        this.updatePipelineTask('task-implement', 'in_progress', `Modificando ${path.basename(target)}`);
                      } else if (fnName.includes('search') || fnName.includes('find') || fnName.includes('grep')) {
                        type = 'SEARCH';
                        target = args.Pattern || args.query || args.pattern || 'termo';
                        details = `Buscando no código: "${target}"`;
                      } else if (fnName.includes('command') || fnName.includes('terminal')) {
                        type = 'COMMAND';
                        target = args.CommandLine || args.command || 'comando';
                        details = `Executando: ${target.slice(0, 60)}`;
                      } else {
                        type = 'COMMAND';
                        target = fnName;
                        details = `Ação: ${fnName}`;
                      }

                      const stepId = `transcript-${entry.step_index ?? i}-${fnName}`;
                      if (!this._currentExecution.liveSteps.some(s => s.id === stepId)) {
                        this._currentExecution.liveSteps.push({
                          id: stepId,
                          type,
                          target,
                          status: 'done',
                          timestamp: new Date().toISOString(),
                          details
                        });
                        this._currentExecution.currentActionSummary = details;
                      }
                    }
                  }
                } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "metaChatService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:metaChatService]", err);
      }
    }
              }
              this._currentExecution.lastTranscriptLineCount = lines.length;
            }
          }
        } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "metaChatService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:metaChatService]", err);
      }
    }
      }

      // Check git diff against baseline
      if (this._currentExecution.baselineBefore && this._currentExecution.root) {
        try {
          const currentDiff = this.diffFileBaseline(
            this._currentExecution.root,
            this._currentExecution.baselineBefore
          );
          for (const f of currentDiff) {
            this._currentExecution.filesChanged.add(f);
          }
        } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "metaChatService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:metaChatService]", err);
      }
    }
      }

      return {
        isExecuting: true,
        threadId: this._currentExecution.threadId,
        activeAccount: this._currentExecution.accountId,
        activeModel: this._currentExecution.model,
        currentActionSummary: this._currentExecution.currentActionSummary,
        elapsedMs,
        pipelineTasks: this._currentExecution.pipelineTasks,
        liveSteps: this._currentExecution.liveSteps,
        filesModified: Array.from(this._currentExecution.filesChanged)
      };
    }

    // Not executing: return latest execution info for this thread
    try {
      const lastRow = db
        .prepare(`
        SELECT executed_steps_json, metadata
        FROM meta_chat_messages
        WHERE thread_id = ? AND role = 'assistant'
        ORDER BY created_at DESC
        LIMIT 1
      `)
        .get(targetThreadId) as any;

      if (lastRow) {
        let liveSteps: MetaChatLiveStep[] = [];
        let pipelineTasks: MetaChatPipelineTask[] = [];
        if (lastRow.executed_steps_json) {
          try {
            liveSteps = JSON.parse(lastRow.executed_steps_json);
          } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "metaChatService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:metaChatService]", err);
      }
    }
        }
        if (lastRow.metadata) {
          try {
            const meta = JSON.parse(lastRow.metadata);
            if (Array.isArray(meta.pipelineTasks)) pipelineTasks = meta.pipelineTasks;
            if (liveSteps.length === 0 && Array.isArray(meta.executedSteps)) liveSteps = meta.executedSteps;
          } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "metaChatService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:metaChatService]", err);
      }
    }
        }

        if (pipelineTasks.length === 0 && liveSteps.length > 0) {
          pipelineTasks = [
            { id: 'task-inspect', label: 'Mapeamento & Análise de Contexto', status: 'completed' },
            { id: 'task-implement', label: 'Modificação Cirúrgica de Código', status: 'completed' },
            { id: 'task-verify', label: 'Self-Healing Typecheck Guard (tsc)', status: 'completed' },
            { id: 'task-guard', label: 'Testes Automatizados & Sincronização', status: 'completed' }
          ];
        }

        return {
          isExecuting: false,
          threadId: targetThreadId,
          currentActionSummary: 'Execução concluída com sucesso',
          elapsedMs: 0,
          pipelineTasks: pipelineTasks.length > 0 ? pipelineTasks : [
            { id: 'task-inspect', label: 'Mapeamento & Análise de Contexto', status: 'completed' },
            { id: 'task-implement', label: 'Modificação Cirúrgica de Código', status: 'completed' },
            { id: 'task-verify', label: 'Self-Healing Typecheck Guard (tsc)', status: 'completed' },
            { id: 'task-guard', label: 'Testes Automatizados & Sincronização', status: 'completed' }
          ],
          liveSteps,
          filesModified: []
        };
      }
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "metaChatService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:metaChatService]", err);
      }
    }

    return {
      isExecuting: false,
      threadId: targetThreadId,
      currentActionSummary: 'Pronto para receber instruções',
      elapsedMs: 0,
      pipelineTasks: [
        { id: 'task-inspect', label: 'Mapeamento & Análise de Contexto', status: 'pending' },
        { id: 'task-implement', label: 'Modificação Cirúrgica de Código', status: 'pending' },
        { id: 'task-verify', label: 'Self-Healing Typecheck Guard (tsc)', status: 'pending' },
        { id: 'task-guard', label: 'Testes Automatizados & Sincronização', status: 'pending' }
      ],
      liveSteps: [],
      filesModified: []
    };
  }

  /**
   * Resolves the DecoHUB workspace root safely.
   */
  static getDecoHubRoot(): string {
    if (process.env.DECOHUB_REPO_ROOT && fs.existsSync(process.env.DECOHUB_REPO_ROOT)) {
      this._repoRoot = path.resolve(process.env.DECOHUB_REPO_ROOT);
      return this._repoRoot;
    }

    if (
      this._repoRoot &&
      (fs.existsSync(path.join(this._repoRoot, 'server', 'package.json')) ||
        fs.existsSync(path.join(this._repoRoot, 'dist-desktop')))
    ) {
      return this._repoRoot;
    }

    const currentDir = typeof __dirname !== 'undefined' ? __dirname : process.cwd();

    const candidates = [
      path.resolve(currentDir, '..', '..'), // from server/src or server/dist -> ai-dev-hub root
      path.resolve(currentDir, '..'),
      path.resolve(process.cwd(), '..'),
      process.cwd(),
      'C:\\IA\\Antigravity HUB\\ai-dev-hub',
      'C:\\IA\\Antigravity HUB'
    ];

    for (const cand of candidates) {
      if (
        fs.existsSync(path.join(cand, 'server', 'package.json')) ||
        fs.existsSync(path.join(cand, 'dist-desktop'))
      ) {
        this._repoRoot = path.resolve(cand);
        return this._repoRoot;
      }
    }

    this._repoRoot = path.resolve(process.cwd());
    return this._repoRoot;
  }

  /**
   * Security & Scope Guard: Ensures target path is strictly within DecoHUB repository.
   */
  static validatePathWithinRepo(relativeOrAbsolutePath: string): string {
    const root = this.getDecoHubRoot();
    const fullPath = path.isAbsolute(relativeOrAbsolutePath)
      ? path.resolve(relativeOrAbsolutePath)
      : path.resolve(root, relativeOrAbsolutePath);

    const relative = path.relative(root, fullPath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(
        `SECURITY_SCOPE_VIOLATION: O Meta-Chat possui acesso restrito ao repositório DecoHUB. Acesso negado a: "${relativeOrAbsolutePath}"`
      );
    }
    return fullPath;
  }

  /**
   * Reads a file from the repository safely.
   */
  static readFile(relativeOrAbsolutePath: string): { path: string; content: string; lines: number } {
    const prevNoAsar = (process as any).noAsar;
    (process as any).noAsar = true;
    try {
      const fullPath = this.validatePathWithinRepo(relativeOrAbsolutePath);
      if (fullPath.includes('.asar') || fullPath.endsWith('.asar')) {
        throw new Error(`Acesso negado a arquivos compactados .asar: ${relativeOrAbsolutePath}`);
      }
      if (!fs.existsSync(fullPath)) {
        throw new Error(`Arquivo não encontrado no repositório: ${relativeOrAbsolutePath}`);
      }
      const content = fs.readFileSync(fullPath, 'utf-8');
      return {
        path: path.relative(this.getDecoHubRoot(), fullPath).replace(/\\/g, '/'),
        content,
        lines: content.split('\n').length
      };
    } finally {
      (process as any).noAsar = prevNoAsar;
    }
  }

  /**
   * Writes or updates a file within the repository safely.
   */
  static writeFile(relativeOrAbsolutePath: string, content: string): { path: string; size: number } {
    const fullPath = this.validatePathWithinRepo(relativeOrAbsolutePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf-8');
    return {
      path: path.relative(this.getDecoHubRoot(), fullPath).replace(/\\/g, '/'),
      size: content.length
    };
  }

  /**
   * Lists directory entries inside the repository.
   */
  static listDirectory(relativeOrAbsolutePath = '.'): string[] {
    const prevNoAsar = (process as any).noAsar;
    (process as any).noAsar = true;
    try {
      const fullPath = this.validatePathWithinRepo(relativeOrAbsolutePath);
      if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isDirectory()) {
        return [];
      }
      return fs.readdirSync(fullPath).map(item => {
        try {
          const isDir = fs.statSync(path.join(fullPath, item)).isDirectory();
          return isDir ? `${item}/` : item;
        } catch {
          return item;
        }
      });
    } finally {
      (process as any).noAsar = prevNoAsar;
    }
  }

  /**
   * Self-Healing Typecheck Guard: Runs tsc --noEmit --skipLibCheck to verify code syntax and typing integrity.
   */
  static async runTypecheck(
    target: 'server' | 'client' | 'all' = 'server',
    changedFiles?: string[]
  ): Promise<{
    passed: boolean;
    durationMs: number;
    output: string;
    errors?: Array<{ file: string; line?: number; column?: number; code?: string; message: string; raw: string }>;
  }> {
    const root = this.getDecoHubRoot();
    const startTime = Date.now();
    const isWin = process.platform === 'win32';

    let output = '';
    let passed = true;
    const collectedErrors: Array<{ file: string; line?: number; column?: number; code?: string; message: string; raw: string }> = [];

    const checkDir = (subDir: string): boolean => {
      const dirPath = path.join(root, subDir);
      if (!fs.existsSync(dirPath)) return true;

      const serverTsc = path.join(root, 'server', 'node_modules', 'typescript', 'bin', 'tsc');
      const localTsc = path.join(dirPath, 'node_modules', 'typescript', 'bin', 'tsc');
      const tscScript = fs.existsSync(serverTsc) ? serverTsc : fs.existsSync(localTsc) ? localTsc : null;

      try {
        let res = '';
        if (tscScript) {
          res = execFileSync(process.execPath, [tscScript, '--noEmit', '--skipLibCheck'], {
            cwd: dirPath,
            encoding: 'utf-8',
            timeout: 45000,
            windowsHide: true,
            env: { ...process.env, CI: 'true', NONINTERACTIVE: '1' }
          });
        } else {
          const npxCmd = isWin ? 'npx.cmd' : 'npx';
          res = execFileSync(npxCmd, ['--yes', 'tsc', '--noEmit', '--skipLibCheck'], {
            cwd: dirPath,
            encoding: 'utf-8',
            timeout: 45000,
            windowsHide: true,
            shell: isWin,
            env: { ...process.env, CI: 'true', NONINTERACTIVE: '1' }
          });
        }
        output += `[${subDir}] Typecheck aprovado:\n${res || 'Sem erros de compilação.'}\n`;
        return true;
      } catch (err: any) {
        const errOut = `${err.stdout || ''}\n${err.stderr || ''}\n${err.message || ''}`.trim();
        const parsedErrors: Array<{ file: string; line?: number; column?: number; code?: string; message: string; raw: string }> = [];
        const lines = errOut.split('\n');
        const errorRegex1 = /^(.+?)\((\d+),(\d+)\):\s+(error\s+TS\d+:\s*.+)$/;
        const errorRegex2 = /^(.+?):(\d+):(\d+)\s+-\s+(error\s+TS\d+:\s*.+)$/;

        for (const line of lines) {
          const trimmed = line.trim();
          const m = trimmed.match(errorRegex1) || trimmed.match(errorRegex2);
          if (m) {
            parsedErrors.push({
              file: m[1].trim(),
              line: parseInt(m[2], 10),
              column: parseInt(m[3], 10),
              message: m[4].trim(),
              raw: trimmed
            });
          }
        }

        // If changedFiles are provided, focus only on errors affecting the scoped files
        if (changedFiles && changedFiles.length > 0) {
          const normChanged = changedFiles.map(f => f.replace(/\\/g, '/').toLowerCase());
          const scopedErrors = parsedErrors.filter(e => {
            const normErr = e.file.replace(/\\/g, '/').toLowerCase();
            return normChanged.some(c => normErr.endsWith(c) || c.endsWith(normErr));
          });

          if (scopedErrors.length > 0) {
            passed = false;
            collectedErrors.push(...scopedErrors);
            output += `[${subDir}] FALHA NO TYPECHECK (Arquivos de Escopo):\n${scopedErrors.map(e => e.raw).join('\n')}\n`;
            return false;
          } else if (parsedErrors.length > 0) {
            // Errors were outside scoped files (pre-existing or unrelated) - do not fail the scoped typecheck
            output += `[${subDir}] AVISO: ${parsedErrors.length} erro(s) de tipagem encontrados fora dos arquivos modificados. Escopo validado com sucesso.\n`;
            return true;
          }
        }

        passed = false;
        collectedErrors.push(...(parsedErrors.length > 0 ? parsedErrors : [{ file: subDir, message: errOut, raw: errOut }]));
        output += `[${subDir}] FALHA NO TYPECHECK:\n${errOut}\n`;
        return false;
      }
    };

    if (target === 'server' || target === 'all') {
      checkDir('server');
    }
    if (target === 'client' || target === 'all') {
      checkDir('client');
    }

    return {
      passed,
      durationMs: Date.now() - startTime,
      output: output.trim(),
      errors: collectedErrors
    };
  }

  /**
   * Runs a scoped test in the server to verify runtime behavior.
   */
  static async runScopedTest(testFileRel: string): Promise<{ passed: boolean; output: string }> {
    const root = this.getDecoHubRoot();
    const serverDir = path.join(root, 'server');
    const nodeCmd = 'node';

    try {
      const args = ['--import', 'tsx', '--import', './test/testSetup.ts', '--test', testFileRel];
      const res = execFileSync(nodeCmd, args, {
        cwd: serverDir,
        encoding: 'utf-8',
        timeout: 30000,
        windowsHide: true,
        env: { ...process.env, DECOHUB_OFFLINE_MODE: 'true' }
      });
      return { passed: true, output: res.trim() };
    } catch (err: any) {
      return {
        passed: false,
        output: `${err.stdout || ''}\n${err.stderr || ''}\n${err.message || ''}`.trim()
      };
    }
  }

  /**
   * Retrieves messages from the meta_chat_messages table for a thread (or active thread).
   */
  static getMessages(threadIdOrLimit?: string | number, maybeLimit?: number): MetaChatMessage[] {
    let threadId: string | null = null;
    let limit = 100;

    if (typeof threadIdOrLimit === 'number') {
      limit = threadIdOrLimit;
      threadId = this.getActiveThreadId();
    } else if (typeof threadIdOrLimit === 'string' && threadIdOrLimit.trim()) {
      threadId = threadIdOrLimit.trim();
      if (typeof maybeLimit === 'number') limit = maybeLimit;
    } else {
      threadId = this.getActiveThreadId();
      if (typeof maybeLimit === 'number') limit = maybeLimit;
    }

    try {
      const rows = threadId && threadId !== '*'
        ? db.prepare(`
            SELECT id, thread_id, role, content, metadata, executed_steps_json, created_at
            FROM meta_chat_messages
            WHERE thread_id = ?
            ORDER BY created_at ASC
            LIMIT ?
          `).all(threadId, limit) as any[]
        : db.prepare(`
            SELECT id, thread_id, role, content, metadata, executed_steps_json, created_at
            FROM meta_chat_messages
            ORDER BY created_at ASC
            LIMIT ?
          `).all(limit) as any[];

      return rows.map(r => ({
        id: r.id,
        thread_id: r.thread_id,
        role: r.role,
        content: r.content,
        executed_steps_json: r.executed_steps_json || null,
        metadata: (() => {
          try {
            return r.metadata ? JSON.parse(r.metadata) : null;
          } catch {
            return null;
          }
        })(),
        created_at: r.created_at
      }));
    } catch (err: any) {
      Logger.warn(`[MetaChatService] Erro ao carregar mensagens: ${err.message}`);
      return [];
    }
  }

  /**
   * Resets the meta chat session history for a specific thread or active thread.
   */
  static resetMessages(threadId?: string): void {
    try {
      if (threadId) {
        db.prepare('DELETE FROM meta_chat_messages WHERE thread_id = ?').run(threadId);
        db.prepare(`
          UPDATE meta_chat_threads
          SET files_modified_count = 0, last_message_preview = NULL, updated_at = ?
          WHERE id = ?
        `).run(new Date().toISOString(), threadId);
        Logger.info(`[MetaChatService] Histórico da thread ${threadId} reiniciado com sucesso.`);
      } else {
        db.exec('DELETE FROM meta_chat_messages');
        db.prepare(`
          UPDATE meta_chat_threads
          SET files_modified_count = 0, last_message_preview = NULL, updated_at = ?
        `).run(new Date().toISOString());
        db.prepare("DELETE FROM system_settings WHERE key LIKE 'metachat_conversation_id%'").run();
        this._accountConversations.clear();
        Logger.info('[MetaChatService] Histórico do Meta-Chat reiniciado com sucesso.');
      }
      this._liveStatus = {
        isRunning: false,
        isExecuting: false,
        phase: 'IDLE',
        currentPhase: 'Pronto'
      };
    } catch (err: any) {
      Logger.warn(`[MetaChatService] Erro ao resetar mensagens: ${err.message}`);
    }
  }

  static getActiveConversationId(accountProfileId?: string | null): string | null {
    try {
      if (accountProfileId && this._accountConversations.has(accountProfileId)) {
        return this._accountConversations.get(accountProfileId)!;
      }
      if (accountProfileId) {
        const scopedRow = db
          .prepare('SELECT value FROM system_settings WHERE key = ?')
          .get(`metachat_conversation_id:${accountProfileId}`) as any;
        if (scopedRow?.value) {
          this._accountConversations.set(accountProfileId, scopedRow.value);
          return scopedRow.value;
        }
      }
      const row = db
        .prepare("SELECT value FROM system_settings WHERE key = 'metachat_conversation_id'")
        .get() as any;
      return row?.value || null;
    } catch {
      return null;
    }
  }

  static setActiveConversationId(id: string | null, accountProfileId?: string | null): void {
    try {
      const now = new Date().toISOString();
      if (!id) {
        db.prepare("DELETE FROM system_settings WHERE key = 'metachat_conversation_id'").run();
        if (accountProfileId) {
          this._accountConversations.delete(accountProfileId);
          db.prepare('DELETE FROM system_settings WHERE key = ?').run(
            `metachat_conversation_id:${accountProfileId}`
          );
        } else {
          this._accountConversations.clear();
        }
      } else {
        db.prepare(`
          INSERT INTO system_settings (key, value, updated_at)
          VALUES ('metachat_conversation_id', ?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        `).run(id, now);

        if (accountProfileId) {
          this._accountConversations.set(accountProfileId, id);
          db.prepare(`
            INSERT INTO system_settings (key, value, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
          `).run(`metachat_conversation_id:${accountProfileId}`, id, now);
        }
      }
    } catch (err: any) {
      Logger.warn(`[MetaChatService] Erro ao persistir conversationId: ${err.message}`);
    }
  }

  static isConversationValid(conversationId: string, customUserProfileDir?: string): boolean {
    if (!conversationId) return false;
    const brainDir = AntigravityDiscovery.getBrainDir(customUserProfileDir);
    const dir = path.join(brainDir, conversationId);
    return fs.existsSync(dir);
  }

  static getLatestTranscriptStepIndex(conversationId: string | null, customUserProfileDir?: string): number {
    if (!conversationId) return -1;
    const brainDir = AntigravityDiscovery.getBrainDir(customUserProfileDir);
    const transcriptPath = path.join(brainDir, conversationId, '.system_generated', 'logs', 'transcript.jsonl');
    if (!fs.existsSync(transcriptPath)) return -1;
    try {
      const lines = fs.readFileSync(transcriptPath, 'utf-8').trim().split('\n').filter(Boolean);
      for (let i = lines.length - 1; i >= 0; i--) {
        const e = JSON.parse(lines[i]);
        if (typeof e.step_index === 'number') {
          return e.step_index;
        }
      }
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "metaChatService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:metaChatService]", err);
      }
    }
    return -1;
  }

  static async waitForTranscriptResponse(
    conversationId: string,
    minStepIndex: number,
    timeoutMs = 90000,
    customUserProfileDir?: string
  ): Promise<string | null> {
    const brainDir = AntigravityDiscovery.getBrainDir(customUserProfileDir);
    const transcriptPath = path.join(brainDir, conversationId, '.system_generated', 'logs', 'transcript.jsonl');
    const transcriptFullPath = path.join(
      brainDir,
      conversationId,
      '.system_generated',
      'logs',
      'transcript_full.jsonl'
    );
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      if (fs.existsSync(transcriptPath)) {
        try {
          const content = fs.readFileSync(transcriptPath, 'utf-8');
          const lines = content.trim().split('\n').filter(Boolean);
          for (let i = lines.length - 1; i >= 0; i--) {
            let entry: any;
            try {
              entry = JSON.parse(lines[i]);
            } catch {
              continue;
            }
            const isAfterMin =
              minStepIndex < 0 || (typeof entry.step_index === 'number' && entry.step_index > minStepIndex);
            if (isAfterMin) {
              if (entry.status === 'ERROR' || entry.type === 'ERROR_MESSAGE') {
                throw new Error(
                  `Antigravity conversation reported error: ${entry.error || entry.content || 'Status ERROR'}`
                );
              }
              if (
                entry.type === 'PLANNER_RESPONSE' &&
                entry.status === 'DONE' &&
                entry.content &&
                !(entry.tool_calls?.length > 0)
              ) {
                if (
                  Array.isArray(entry.truncated_fields) &&
                  entry.truncated_fields.includes('content') &&
                  fs.existsSync(transcriptFullPath)
                ) {
                  try {
                    const fullLines = fs
                      .readFileSync(transcriptFullPath, 'utf-8')
                      .trim()
                      .split('\n')
                      .filter(Boolean);
                    for (let j = fullLines.length - 1; j >= 0; j--) {
                      const fullEntry = JSON.parse(fullLines[j]);
                      if (fullEntry.step_index === entry.step_index && fullEntry.content) {
                        return fullEntry.content;
                      }
                    }
                  } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "metaChatService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:metaChatService]", err);
      }
    }
                }
                return entry.content;
              }
            }
          }
        } catch (parseErr: any) {
          if (parseErr.message?.includes('Antigravity conversation reported error')) {
            throw parseErr;
          }
        }
      }
      await new Promise(r => setTimeout(r, 600));
    }
    return null;
  }

  static saveAttachments(
    attachments: MetaChatAttachment[]
  ): Array<{ name: string; diskPath: string; size: number; isImage: boolean }> {
    const root = this.getDecoHubRoot();
    const uploadsDir = path.join(root, '.ai-dev-hub', 'metachat-uploads');
    fs.mkdirSync(uploadsDir, { recursive: true });

    const saved: Array<{ name: string; diskPath: string; size: number; isImage: boolean }> = [];

    for (const att of attachments) {
      try {
        const ext =
          path.extname(att.name) ||
          (att.type?.includes('png') ? '.png' : att.type?.includes('jpeg') ? '.jpg' : '.txt');
        const baseName = path.basename(att.name, ext).replace(/[^a-zA-Z0-9_\-]/g, '_');
        const filename = `${Date.now()}_${baseName}${ext}`;
        const diskPath = path.join(uploadsDir, filename);

        let size = 0;
        if (att.base64Content) {
          const raw = att.base64Content.replace(/^data:[^;]+;base64,/, '');
          const buf = Buffer.from(raw, 'base64');
          fs.writeFileSync(diskPath, buf);
          size = buf.length;
        } else if (typeof att.content === 'string') {
          fs.writeFileSync(diskPath, att.content, 'utf-8');
          size = Buffer.byteLength(att.content, 'utf-8');
        }

        const isImage =
          /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(filename) || Boolean(att.type?.startsWith('image/'));
        saved.push({ name: att.name, diskPath, size: att.size || size, isImage });
      } catch (err: any) {
        Logger.warn(`[MetaChatService] Erro ao salvar anexo "${att.name}": ${err.message}`);
      }
    }

    return saved;
  }

  static buildAttachmentsBlock(
    savedAttachments: Array<{ name: string; diskPath: string; size: number; isImage: boolean }>
  ): string {
    if (savedAttachments.length === 0) return '';

    const lines: string[] = [
      '--- ARQUIVOS E PRINTS ANEXADOS PELO USUÁRIO ---',
      'O desenvolvedor anexou os seguintes arquivos/evidências para esta instrução:'
    ];

    for (const att of savedAttachments) {
      if (att.isImage) {
        lines.push(
          `- [SCREENSHOT: ${att.name}] salvo em disco no caminho absoluto:\n  "${att.diskPath}" (${(att.size / 1024).toFixed(1)} KB) — Inspecione esta imagem/print se relevante para a solicitação.`
        );
      } else {
        lines.push(`- [ARQUIVO: ${att.name}] salvo em disco no caminho absoluto:\n  "${att.diskPath}" (${att.size} bytes)`);
        try {
          if (att.size < 40000 && fs.existsSync(att.diskPath)) {
            const content = fs.readFileSync(att.diskPath, 'utf-8');
            const ext = path.extname(att.name).replace('.', '') || 'text';
            lines.push(`  Conteúdo de ${att.name}:\n  \`\`\`${ext}\n${content.slice(0, 3000)}\n  \`\`\``);
          }
        } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "metaChatService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:metaChatService]", err);
      }
    }
      }
    }

    return lines.join('\n');
  }

  static getGitStatusPorcelain(root: string): string[] {
    try {
      const out = execFileSync('git', ['status', '--porcelain'], {
        cwd: root,
        encoding: 'utf-8',
        windowsHide: true,
        timeout: 10000
      });
      return out.trim().split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }

  static captureFileBaseline(root: string): Map<string, { size: number; mtime: number; hash?: string; content?: string | null }> {
    const map = new Map<string, { size: number; mtime: number; hash?: string; content?: string | null }>();
    try {
      const statusLines = this.getGitStatusPorcelain(root);
      for (const line of statusLines) {
        const file = line.slice(3).trim().replace(/^"|"$/g, '').replace(/\\/g, '/');
        const full = path.join(root, file);
        try {
          if (fs.existsSync(full)) {
            const stat = fs.statSync(full);
            let hash: string | undefined;
            let content: string | null = null;
            if (stat.size < 2000000) {
              const buf = fs.readFileSync(full);
              hash = crypto.createHash('sha1').update(buf).digest('hex');
              content = buf.toString('utf-8');
            }
            map.set(file, { size: stat.size, mtime: stat.mtimeMs, hash, content });
          } else {
            map.set(file, { size: -1, mtime: 0, content: null });
          }
        } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "metaChatService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:metaChatService]", err);
      }
    }
      }
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "metaChatService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:metaChatService]", err);
      }
    }
    return map;
  }

  static diffFileBaseline(
    root: string,
    beforeBaseline: Map<string, { size: number; mtime: number; hash?: string }>,
    turnChangedFiles?: string[]
  ): string[] {
    const afterPorcelain = this.getGitStatusPorcelain(root);
    const changedInTurn = new Set<string>();

    for (const line of afterPorcelain) {
      const file = line.slice(3).trim().replace(/^"|"$/g, '').replace(/\\/g, '/');
      const full = path.join(root, file);

      if (!beforeBaseline.has(file)) {
        // File was NOT in git status before the turn -> Newly modified or created in this turn
        changedInTurn.add(file);
      } else {
        // File was already in git status before the turn. Check if changed during this turn.
        const before = beforeBaseline.get(file)!;
        try {
          if (!fs.existsSync(full)) {
            if (before.size !== -1) {
              changedInTurn.add(file);
            }
          } else {
            const stat = fs.statSync(full);
            if (stat.size !== before.size) {
              changedInTurn.add(file);
            } else if (before.hash) {
              const content = fs.readFileSync(full);
              const hash = crypto.createHash('sha1').update(content).digest('hex');
              if (hash !== before.hash) {
                changedInTurn.add(file);
              }
            } else if (stat.mtimeMs !== before.mtime) {
              changedInTurn.add(file);
            }
          }
        } catch {
          changedInTurn.add(file);
        }
      }
    }

    if (turnChangedFiles && Array.isArray(turnChangedFiles)) {
      for (const f of turnChangedFiles) {
        const rel = path.isAbsolute(f)
          ? path.relative(root, f).replace(/\\/g, '/')
          : f.replace(/\\/g, '/');
        if (rel.startsWith('..')) continue;

        const full = path.join(root, rel);
        if (fs.existsSync(full)) {
          const before = beforeBaseline.get(rel);
          if (!before) {
            changedInTurn.add(rel);
          } else {
            try {
              const stat = fs.statSync(full);
              if (stat.size !== before.size) {
                changedInTurn.add(rel);
              } else if (before.hash) {
                const content = fs.readFileSync(full);
                const hash = crypto.createHash('sha1').update(content).digest('hex');
                if (hash !== before.hash) {
                  changedInTurn.add(rel);
                }
              }
            } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "metaChatService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:metaChatService]", err);
      }
    }
          }
        }
      }
    }

    return Array.from(changedInTurn);
  }

  static diffGitStatus(before: string[], after: string[]): string[] {
    const beforeMap = new Map<string, string>();
    for (const line of before) {
      const status = line.slice(0, 2);
      const file = line.slice(3).trim().replace(/^"|"$/g, '').replace(/\\/g, '/');
      beforeMap.set(file, status);
    }
    const changed: string[] = [];
    for (const line of after) {
      const status = line.slice(0, 2);
      const file = line.slice(3).trim().replace(/^"|"$/g, '').replace(/\\/g, '/');
      if (!beforeMap.has(file) || beforeMap.get(file) !== status) {
        changed.push(file);
      }
    }
    return changed;
  }

  static rollbackChangedFiles(
    root: string,
    files: string[],
    beforeBaseline?: Map<string, { size: number; mtime: number; hash?: string; content?: string | null }>
  ): void {
    for (const file of files) {
      const full = path.join(root, file);
      const before = beforeBaseline?.get(file);
      if (before) {
        if (before.content === null || before.size === -1) {
          try { if (fs.existsSync(full)) fs.unlinkSync(full); } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "metaChatService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:metaChatService]", err);
      }
    }
        } else if (typeof before.content === 'string') {
          try { fs.writeFileSync(full, before.content, 'utf-8'); } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "metaChatService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:metaChatService]", err);
      }
    }
        }
      } else {
        try {
          execFileSync('git', ['checkout', '--', file], { cwd: root, windowsHide: true });
        } catch {
          try {
            if (fs.existsSync(full)) {
              fs.unlinkSync(full);
            }
          } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "metaChatService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:metaChatService]", err);
      }
    }
        }
      }
    }
  }

  static ensureDecoHubProject(accountProfileId?: string): {
    project: any;
    accountProfile: any;
    userProfileDir: string;
    nativeProjectId: string;
    env: NodeJS.ProcessEnv;
  } {
    const root = this.getDecoHubRoot();
    const nowIso = new Date().toISOString();

    // 1. Resolve account profile first so project binding is aligned with the chosen account
    let profile: any = null;
    if (accountProfileId) {
      try {
        profile = AccountProfileManager.getProfile(accountProfileId);
      } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "metaChatService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:metaChatService]", err);
      }
    }
    }
    if (!profile) {
      try {
        profile = AccountProfileManager.getGlobalActiveProfile();
      } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "metaChatService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:metaChatService]", err);
      }
    }
    }
    if (!profile) {
      const all = AccountProfileManager.getAllProfiles();
      profile = all[0];
    }
    if (!profile) {
      AccountProfileManager.initDefaultProfiles();
      profile = AccountProfileManager.getAllProfiles()[0];
    }

    // 2. Ensure project record exists and is bound to profile.id
    let proj: any = db
      .prepare('SELECT id, name, path, is_trusted, full_dev_autonomy, active_account_profile_id FROM projects WHERE path = ?')
      .get(root);
    if (!proj) {
      const id = 'decohub-meta';
      db.prepare(`
        INSERT OR REPLACE INTO projects (id, name, path, stack, status, is_trusted, full_dev_autonomy, active_account_profile_id, created_at, updated_at)
        VALUES (?, 'DecoHUB Engine', ?, 'TypeScript', 'active', 1, 1, ?, ?, ?)
      `).run(id, root, profile.id, nowIso, nowIso);
      proj = {
        id,
        name: 'DecoHUB Engine',
        path: root,
        is_trusted: 1,
        full_dev_autonomy: 1,
        active_account_profile_id: profile.id
      };
    } else if (!proj.is_trusted || !proj.full_dev_autonomy || proj.active_account_profile_id !== profile.id) {
      db.prepare(
        'UPDATE projects SET is_trusted = 1, full_dev_autonomy = 1, active_account_profile_id = ?, updated_at = ? WHERE id = ?'
      ).run(profile.id, nowIso, proj.id);
      proj.is_trusted = 1;
      proj.full_dev_autonomy = 1;
      proj.active_account_profile_id = profile.id;
    }

    DevAutonomyService.setProjectAutonomy(proj.id, true, true);

    const userProfileDir = AccountProfileManager.getUserProfileDir(profile);

    // 3. Ensure native workspace binding for this account profile
    const binding = NativeWorkspaceBinding.ensureBinding(proj.id, profile.id, userProfileDir, {
      mode: 'permissive',
      userConsent: 'Auto-Evolução do DecoHUB autorizada pelo desenvolvedor.'
    });

    // 4. Resolve full execution environment (including ANTIGRAVITY_LS_ADDRESS, ANTIGRAVITY_CSRF_TOKEN & runtime auto-boot)
    let env: NodeJS.ProcessEnv;
    try {
      if (!AgentApiGateway.isOfflineMode() && !AccountProfileManager.isAutomatedTestRuntime()) {
        try {
          AccountProfileManager.ensureProfileRuntimeRunningSync(profile, 14000);
        } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "metaChatService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:metaChatService]", err);
      }
    }
      }
      env = AccountProfileManager.getExecutionEnvForProfile(profile, proj.id);
    } catch {
      env = AgentApiGateway.sanitizeEnv(process.env);
      env.ANTIGRAVITY_PROJECT_ID = binding.nativeProjectId;
      env.USERPROFILE = userProfileDir;
      env.HOME = userProfileDir;
    }

    return {
      project: proj,
      accountProfile: profile,
      userProfileDir,
      nativeProjectId: binding.nativeProjectId,
      env
    };
  }

  /**
   * Adds a message to the persistent meta chat history and links to thread.
   */
  static addMessage(msg: {
    role: 'user' | 'assistant' | 'system';
    content: string;
    metadata?: any;
    thread_id?: string;
    executed_steps_json?: string;
  }): MetaChatMessage {
    const id = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    const effectiveThreadId = msg.thread_id || this.getActiveThreadId();
    const metaJson = msg.metadata ? JSON.stringify(msg.metadata) : null;
    const executedStepsJson = msg.executed_steps_json || (msg.metadata?.executedSteps ? JSON.stringify(msg.metadata.executedSteps) : null);

    db.prepare(`
      INSERT INTO meta_chat_messages (id, thread_id, role, content, metadata, executed_steps_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, effectiveThreadId, msg.role, msg.content, metaJson, executedStepsJson, nowIso);

    // Update parent thread metadata
    try {
      const curThread = this.getThread(effectiveThreadId);
      if (curThread) {
        let newTitle = curThread.title;
        // Auto-title thread from first user message if title is still default
        if (msg.role === 'user' && (curThread.title === 'Nova Conversa' || curThread.title === 'Conversa Inicial de Auto-Evolução')) {
          const cleanSnippet = msg.content
            .replace(/[#*`_\[\]()]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
          if (cleanSnippet) {
            newTitle = cleanSnippet.length > 45 ? `${cleanSnippet.slice(0, 42)}...` : cleanSnippet;
          }
        }

        const preview = msg.content.length > 160 ? `${msg.content.slice(0, 157)}...` : msg.content;
        const addFilesCount = Array.isArray(msg.metadata?.files_changed) ? msg.metadata.files_changed.length : 0;
        const totalFiles = (curThread.files_modified_count || 0) + addFilesCount;

        db.prepare(`
          UPDATE meta_chat_threads
          SET title = ?, last_message_preview = ?, files_modified_count = ?, updated_at = ?
          WHERE id = ?
        `).run(newTitle, preview, totalFiles, nowIso, effectiveThreadId);
      }
    } catch (err: any) {
      Logger.warn(`[MetaChatService] Erro ao sincronizar thread com mensagem: ${err.message}`);
    }

    return {
      id,
      thread_id: effectiveThreadId,
      role: msg.role,
      content: msg.content,
      executed_steps_json: executedStepsJson,
      metadata: msg.metadata || null,
      created_at: nowIso
    };
  }

  /**
   * Full Build & Production Sync: Recompiles DecoHUB and syncs to app.asar.unpacked.
   */
  static async recompileAndSync(): Promise<{
    success: boolean;
    message: string;
    durationMs: number;
    serverBuild?: string;
    clientBuild?: string;
    synced?: boolean;
    restarted?: boolean;
  }> {
    const startTime = Date.now();
    const root = this.getDecoHubRoot();
    const isWin = process.platform === 'win32';
    const npmCmd = isWin ? 'npm.cmd' : 'npm';

    Logger.info('[MetaChatService] Iniciando recompilação completa do DecoHUB...');

    // 1. Build Server
    let serverOutput = '';
    try {
      serverOutput = execFileSync(npmCmd, ['run', 'build'], {
        cwd: path.join(root, 'server'),
        encoding: 'utf-8',
        timeout: 45000,
        windowsHide: true
      });
    } catch (err: any) {
      return {
        success: false,
        message: `Falha na compilação do servidor:\n${err.stdout || ''}\n${err.stderr || ''}`,
        durationMs: Date.now() - startTime
      };
    }

    // 2. Build Client
    let clientOutput = '';
    try {
      clientOutput = execFileSync(npmCmd, ['run', 'build'], {
        cwd: path.join(root, 'client'),
        encoding: 'utf-8',
        timeout: 60000,
        windowsHide: true
      });
    } catch (err: any) {
      return {
        success: false,
        message: `Falha na compilação do frontend:\n${err.stdout || ''}\n${err.stderr || ''}`,
        durationMs: Date.now() - startTime
      };
    }

    // 3. Mirror to app.asar.unpacked locations if they exist
    let synced = false;
    const unpackedBases = [
      path.join(
        process.env.LOCALAPPDATA || 'C:\\Users\\Deco\\AppData\\Local',
        'Programs',
        'ai-dev-hub-root',
        'resources',
        'app.asar.unpacked'
      ),
      path.join(root, 'dist-desktop', 'win-unpacked', 'resources', 'app.asar.unpacked'),
      path.join(root, 'decohub_unpacked')
    ];

    if (isWin) {
      for (const unpackedBase of unpackedBases) {
        if (fs.existsSync(unpackedBase)) {
          try {
            const serverDistSrc = path.join(root, 'server', 'dist');
            const serverDistDest = path.join(unpackedBase, 'server', 'dist');
            const clientDistSrc = path.join(root, 'client', 'dist');
            const clientDistDest = path.join(unpackedBase, 'client', 'dist');

            spawnSync('robocopy', [serverDistSrc, serverDistDest, '/MIR', '/NP', '/NDL', '/NFL'], { windowsHide: true });
            spawnSync('robocopy', [clientDistSrc, clientDistDest, '/MIR', '/NP', '/NDL', '/NFL'], { windowsHide: true });
            synced = true;
            Logger.success(`[MetaChatService] Distribuição sincronizada com sucesso para ${unpackedBase}.`);
          } catch (copyErr: any) {
            Logger.warn(`[MetaChatService] Aviso na sincronização robocopy para ${unpackedBase}: ${copyErr.message}`);
          }
        }
      }
    }

    // 4. Clean service restart when running in Desktop Electron
    const isDesktop = process.env.ELECTRON_RUN_AS_NODE === '1' || Boolean(process.env.AI_DEV_HUB_DATA_DIR);
    let restarted = false;

    if (isDesktop && synced) {
      restarted = true;
      Logger.info('[MetaChatService] Ambiente Desktop Electron detectado. Notificando serviceManager e agendando reinício limpo do serviço...');
      if (process.env.AI_DEV_HUB_DATA_DIR && fs.existsSync(process.env.AI_DEV_HUB_DATA_DIR)) {
        try {
          fs.writeFileSync(
            path.join(process.env.AI_DEV_HUB_DATA_DIR, 'backend.status'),
            JSON.stringify({ status: 'RESTARTING', timestamp: new Date().toISOString(), reason: 'RECOMPILE_AND_SYNC' })
          );
        } catch {}
      }
      setTimeout(() => {
        try {
          process.exit(0);
        } catch {}
      }, 1000);
    }

    const durationMs = Date.now() - startTime;
    return {
      success: true,
      message: `Recompilação e sincronização do DecoHUB concluídas com sucesso em ${(durationMs / 1000).toFixed(1)}s!${restarted ? ' Reinício limpo do serviço desktop agendado.' : ''}`,
      durationMs,
      serverBuild: serverOutput.trim(),
      clientBuild: clientOutput.trim(),
      synced,
      restarted
    };
  }

  /**
   * Main Dispatcher: Handles incoming instructions from the user, interprets intent,
   * performs safe code modifications, executes the Self-Healing Guard (Typecheck & Tests),
   * dispatches natural language commands to the real Antigravity runtime,
   * and records the conversational response.
   */
  static async handleUserMessage(
    userContent: string,
    options?: MetaChatHandleOptions
  ): Promise<MetaChatResponse> {
    const root = this.getDecoHubRoot();
    const filesChanged: string[] = [];
    const backups = new Map<string, string | null>();
    const requestedAccountId = options?.accountId || options?.profileId;
    const requestedModel = options?.model || 'gemini-3.8-flash';
    const requestedReasoning = options?.reasoningMode || 'high';

    // 0. Resolve active thread
    const effectiveThreadId = options?.threadId || this.getActiveThreadId();
    this.setActiveThreadId(effectiveThreadId);
    const currentThread = this.getThread(effectiveThreadId) || this.createThread();
    this.updateThread(currentThread.id, { status: 'running' });

    // 1. Process attachments if provided
    const savedAttachments = options?.attachments?.length ? this.saveAttachments(options.attachments) : [];

    // 2. Record user message
    this.addMessage({
      role: 'user',
      content: userContent,
      thread_id: currentThread.id,
      metadata: {
        attachments: savedAttachments.map(a => ({
          name: a.name,
          diskPath: a.diskPath,
          size: a.size,
          isImage: a.isImage
        })),
        model: requestedModel,
        reasoningMode: requestedReasoning,
        accountId: requestedAccountId
      }
    });

    let activeConvId = this.getActiveConversationId(requestedAccountId);
    const baselineBefore = this.captureFileBaseline(root);

    this._currentExecution = {
      cancelRequested: false,
      startedAt: new Date().toISOString(),
      phase: 'Interpretando instrução do desenvolvedor...',
      model: requestedModel,
      accountId: requestedAccountId,
      threadId: currentThread.id,
      root,
      baselineBefore,
      conversationId: activeConvId || undefined,
      filesChanged: new Set<string>(),
      currentActionSummary: 'Interpretando instrução do desenvolvedor...',
      pipelineTasks: [
        { id: 'task-inspect', label: 'Mapeamento & Análise de Contexto', status: 'in_progress', details: 'Interpretando instrução e inspecionando repositório' },
        { id: 'task-implement', label: 'Modificação Cirúrgica de Código', status: 'pending', details: 'Aguardando diagnóstico e plano de ação' },
        { id: 'task-verify', label: 'Self-Healing Typecheck Guard (tsc)', status: 'pending', details: 'Verificação de tipagem estrita' },
        { id: 'task-guard', label: 'Testes Automatizados & Sincronização', status: 'pending', details: 'Execução de testes de escopo e empacotamento' }
      ],
      liveSteps: [
        {
          id: `step-${Date.now()}-inspect`,
          type: 'SEARCH',
          target: 'Repositório DecoHUB',
          status: 'done',
          timestamp: new Date().toISOString(),
          details: 'Análise de contexto e intenção iniciada'
        }
      ],
      lastTranscriptLineCount: 0,
      userProfileDir: undefined
    };

    try {
      this.updateLiveStatus({
        isRunning: true,
        isExecuting: true,
        phase: 'Interpretando instrução do desenvolvedor...',
        currentPhase: 'Interpretando instrução do desenvolvedor...',
        activeAccount: requestedAccountId || 'Padrão',
        activeAccountId: requestedAccountId,
        activeModel: requestedModel,
        startedAt: this._currentExecution.startedAt,
        lastStep: 'Análise de intenção'
      });

      // 3. Parse explicit or structured code actions
      const parsedActions = options?.codeActions || this.parseCodeDirectives(userContent);

      let actionSummary = '';
      let reply = '';
      let typecheckResult: {
        passed: boolean;
        durationMs: number;
        output: string;
        errors?: Array<{ file: string; line?: number; column?: number; code?: string; message: string; raw: string }>;
      } = { passed: true, durationMs: 0, output: 'Nenhum arquivo de código foi alterado.' };
      let selfHealed = false;
      let testResult: { ran: boolean; passed: boolean; output?: string } | undefined;

      if (parsedActions.length > 0) {
        this.updatePipelineTask('task-inspect', 'completed');
        this.updatePipelineTask('task-implement', 'in_progress', `Processando ${parsedActions.length} ação(ões)`);
        this.updateLiveStatus({
          phase: 'Aplicando alterações diretas de código no DecoHUB...',
          lastStep: `Processando ${parsedActions.length} ação(ões)`
        });

        // Direct code modifications requested via explicit code block or API codeActions
        for (const act of parsedActions) {
          try {
            const fullPath = this.validatePathWithinRepo(act.filePath);
            const relPath = path.relative(root, fullPath).replace(/\\/g, '/');

            if (act.action === 'write' && typeof act.content === 'string') {
              backups.set(fullPath, fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf-8') : null);
              this.writeFile(relPath, act.content);
              filesChanged.push(relPath);
              this._currentExecution?.filesChanged.add(relPath);
              this.recordLiveStep({
                type: 'EDIT',
                target: relPath,
                status: 'done',
                details: `Gravando ${relPath} (${act.content.length} bytes)`
              });
              actionSummary += `- Arquivo atualizado/criado: \`${relPath}\` (${act.content.length} bytes)\n`;
            } else if (act.action === 'read') {
              const data = this.readFile(relPath);
              this.recordLiveStep({
                type: 'READ',
                target: relPath,
                status: 'done',
                details: `Lendo ${relPath} (${data.lines} linhas)`
              });
              actionSummary += `- Leitura de \`${relPath}\` (${data.lines} linhas)\n`;
            }
          } catch (err: any) {
            actionSummary += `- Erro na operação em \`${act.filePath}\`: ${err.message}\n`;
          }
        }
        this.updatePipelineTask('task-implement', 'completed');

        if (filesChanged.length > 0) {
          this.updatePipelineTask('task-verify', 'in_progress', `Verificando tipagem de ${filesChanged.length} arquivos`);
          this.recordLiveStep({
            type: 'GUARD',
            target: 'tsc --noEmit',
            status: 'running',
            details: 'Validando tipagem com Typecheck Guard...'
          });
          this.updateLiveStatus({
            phase: 'Validando Typecheck Guard (tsc --noEmit)...',
            lastStep: `Verificando tipagem de ${filesChanged.length} arquivos`
          });
          const hasServerFiles = filesChanged.some(f => f.startsWith('server/'));
          const hasClientFiles = filesChanged.some(f => f.startsWith('client/'));
          const target = hasServerFiles && hasClientFiles ? 'all' : hasClientFiles ? 'client' : 'server';

          typecheckResult = await this.runTypecheck(target, filesChanged);

          if (!typecheckResult.passed) {
            Logger.warn(`[MetaChatService] Typecheck quebrou após alteração manual. Acionando Autoproteção Ativa...`);
            this.updatePipelineTask('task-verify', 'failed', 'Erro de compilação detectado');
            this.recordLiveStep({
              type: 'GUARD',
              target: 'Autoproteção Ativa',
              status: 'done',
              details: 'Autoproteção Ativa: restaurando arquivos após falha de tipagem'
            });
            for (const [fullPath, originalContent] of backups.entries()) {
              if (originalContent === null) {
                try {
                  fs.unlinkSync(fullPath);
                } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "metaChatService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:metaChatService]", err);
      }
    }
              } else {
                try {
                  fs.writeFileSync(fullPath, originalContent, 'utf-8');
                } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "metaChatService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:metaChatService]", err);
      }
    }
              }
            }
            selfHealed = true;
          } else {
            this.updatePipelineTask('task-verify', 'completed', `Aprovado em ${typecheckResult.durationMs}ms`);
          }
        } else {
          this.updatePipelineTask('task-verify', 'completed', 'Nenhum arquivo modificado');
        }

        if (selfHealed) {
          let errorDetails = '';
          if (typecheckResult.errors && typecheckResult.errors.length > 0) {
            errorDetails = typecheckResult.errors
              .map(e => `- \`${e.file}:${e.line || '?'}\` → **${e.message}**`)
              .join('\n');
          } else {
            errorDetails = `\`\`\`text\n${typecheckResult.output.slice(0, 800)}\n\`\`\``;
          }

          reply =
            `[SELF_HEALING_GUARD] **Autoproteção Ativa Ativada:**\n\n` +
            `A alteração solicitada causou erro de compilação/tipagem TypeScript no DecoHUB:\n\n` +
            `${errorDetails}\n\n` +
            `O DecoHUB desfez a alteração automaticamente para manter o repositório 100% íntegro e estável. Por favor, ajuste os tipos ou parâmetros da instrução.`;
        } else if (filesChanged.length > 0) {
          reply =
            `[APPLIED] **Alterações no Código do DecoHUB Aplicadas com Sucesso!**\n\n` +
            `${actionSummary}\n` +
            `[TYPECHECK] **Typecheck Guard:** Aprovado em ${typecheckResult.durationMs}ms (0 erros de compilação).\n` +
            (testResult ? `[TESTS] **Testes:** ${testResult.passed ? 'Aprovados (0 falhas)' : 'Falha'}\n` : '') +
            `\nVocê pode testar a alteração agora ou clicar em **"Recompilar e Atualizar Produção"** para empacotar o executável local.`;
        }
      } else {
        // Natural language instruction: dispatch to Antigravity runtime!
        const attachmentsBlock = this.buildAttachmentsBlock(savedAttachments);

        const projectBinding = this.ensureDecoHubProject(requestedAccountId);
        let effectiveAccountId = projectBinding.accountProfile.id;
        activeConvId = this.getActiveConversationId(effectiveAccountId);

        const resolvedConfig = ModelRegistry.resolveModelConfig({
          preference: requestedModel,
          role: 'default',
          accountProfileId: effectiveAccountId,
          projectId: projectBinding.project.id,
          requestedIntelligence: requestedReasoning.toUpperCase()
        });
        const cliModel = resolvedConfig.modelId;

        if (AgentApiGateway.isOfflineMode()) {
          this.updateLiveStatus({
            phase: 'Executando em modo simulado/offline...',
            lastStep: 'Despacho para Fake Provider'
          });
          const mockProvider = AgentApiGateway.getMockProvider();
          if (mockProvider) {
            let sendSucceeded = false;
            if (activeConvId) {
              try {
                mockProvider.sendMessage({
                  conversationId: activeConvId,
                  prompt: userContent,
                  projectId: 'decohub-meta',
                  role: 'CONVERSATIONAL'
                });
                sendSucceeded = true;
              } catch (mockSendErr: any) {
                Logger.warn(
                  `[MetaChatService] Mock sendMessage falhou na conversa [${activeConvId}]: ${mockSendErr.message}. Criando nova sessão de auto-recuperação...`
                );
                sendSucceeded = false;
              }
            }

            if (!sendSucceeded) {
              activeConvId = mockProvider.newConversation({
                model: cliModel,
                title: 'DecoHUB Meta-Chat',
                prompt: userContent,
                projectId: 'decohub-meta',
                role: 'CONVERSATIONAL'
              });
              this.setActiveConversationId(activeConvId, requestedAccountId);
            }

            const candidate = mockProvider.getResponse?.(activeConvId!, 'CONVERSATIONAL');
            if (candidate) {
              reply = candidate;
            }
          }

          if (!reply) {
            reply =
              `[META-CHAT] **DecoHUB Meta-Chat:**\n\n` +
              `Execução concluída no núcleo de auto-evolução.\n\n` +
              `- **Modelo**: \`${resolvedConfig.canonicalName} (${resolvedConfig.modelId})\`\n` +
              `- **Raciocínio**: \`${resolvedConfig.intelligenceLevel}\`\n` +
              (requestedAccountId ? `- **Conta**: \`${projectBinding.accountProfile.display_name}\`\n` : '') +
              (savedAttachments.length > 0 ? `- **Anexos Analisados**: ${savedAttachments.length} arquivo(s)\n` : '') +
              `\nNenhuma violação de integridade detectada. Repositório DecoHUB validado com Typecheck Guard.`;
          }

          if (reply) {
            const parsedBlocks = this.parseCodeDirectives(reply);
            for (const pb of parsedBlocks) {
              if (pb.action === 'write' && typeof pb.content === 'string') {
                try {
                  const fullPath = this.validatePathWithinRepo(pb.filePath);
                  const relPath = path.relative(root, fullPath).replace(/\\/g, '/');
                  let shouldWrite = true;
                  if (fs.existsSync(fullPath)) {
                    const currentDiskContent = fs.readFileSync(fullPath, 'utf-8');
                    if (currentDiskContent === pb.content) {
                      shouldWrite = false;
                    }
                  }
                  if (shouldWrite) {
                    this.writeFile(relPath, pb.content);
                    if (!filesChanged.includes(relPath)) {
                      filesChanged.push(relPath);
                    }
                    this.recordLiveStep({
                      type: 'EDIT',
                      target: relPath,
                      status: 'done',
                      details: `Gravando ${relPath} (bloco de código direto)`
                    });
                  }
                } catch (writeErr: any) {
                  Logger.warn(`[MetaChatService] Erro ao aplicar bloco [FILE] offline: ${writeErr.message}`);
                }
              }
            }
          }

          if (!activeConvId) {
            activeConvId = `conv-metachat-offline-${Date.now().toString(36)}`;
            this.setActiveConversationId(activeConvId, requestedAccountId);
          }

          this.recordLiveStep({
            type: 'COMMAND',
            target: `Mock Provider (${cliModel})`,
            status: 'done',
            details: 'Execução em modo simulado/offline concluída'
          });
          this.updatePipelineTask('task-inspect', 'completed');
          this.updatePipelineTask('task-implement', 'completed');

          const hasServerFiles = filesChanged.some(f => f.startsWith('server/'));
          const hasClientFiles = filesChanged.some(f => f.startsWith('client/'));
          const target = hasServerFiles && hasClientFiles ? 'all' : hasClientFiles ? 'client' : 'server';
          typecheckResult = await this.runTypecheck(target, filesChanged);
          this.updatePipelineTask('task-verify', 'completed', 'Typecheck validado');
        } else {
          // Live production execution on Antigravity Language Server!
          this.updateLiveStatus({
            phase: `Conectando ao runtime da ${projectBinding.accountProfile.display_name}...`,
            activeAccount: projectBinding.accountProfile.display_name,
            lastStep: 'Garantindo runtime ativo em background'
          });

          if (!AccountProfileManager.isAutomatedTestRuntime()) {
            try {
              await AccountProfileManager.ensureProfileRuntimeRunning(projectBinding.accountProfile, 14000);
            } catch (bootErr: any) {
              Logger.warn(
                `[MetaChatService] Aviso ao assegurar runtime para ${projectBinding.accountProfile.display_name}: ${bootErr.message}`
              );
            }
          }

          let execEnv: NodeJS.ProcessEnv | undefined;
          let activeProfile = projectBinding.accountProfile;
          let directCliMode = false;

          try {
            execEnv = AccountProfileManager.getExecutionEnvForProfile(
              activeProfile,
              projectBinding.project.id
            );
          } catch (envErr: any) {
            Logger.warn(
              `[MetaChatService] Falha ao obter ambiente de execução para perfil "${activeProfile.display_name}": ${envErr?.message || envErr}. Tentando resiliência multi-perfil...`
            );

            // a) Tente encontrar qualquer perfil que esteja READY ou com runtime em execução via AccountProfileManager.getRunningInstanceForProfile
            const allProfiles = AccountProfileManager.getAllProfiles();
            let alternateProfile = allProfiles.find(p => {
              if (p.id === activeProfile.id) return false;
              const running = AccountProfileManager.getRunningInstanceForProfile(p.environment_path);
              return Boolean(running);
            });

            if (!alternateProfile) {
              alternateProfile = allProfiles.find(
                p => p.id !== activeProfile.id && (p.auth_status === 'READY' || p.auth_status === 'ACTIVE')
              );
            }

            if (alternateProfile) {
              try {
                if (!AccountProfileManager.isAutomatedTestRuntime()) {
                  try {
                    await AccountProfileManager.ensureProfileRuntimeRunning(alternateProfile, 8000);
                  } catch (e) {
                    /* ignore background boot error */
                  }
                }
                execEnv = AccountProfileManager.getExecutionEnvForProfile(
                  alternateProfile,
                  projectBinding.project.id
                );
                activeProfile = alternateProfile;
                projectBinding.accountProfile = alternateProfile;
                effectiveAccountId = alternateProfile.id;
                this.updateLiveStatus({
                  phase: `Conectado via fallback ao runtime de ${alternateProfile.display_name}`,
                  activeAccount: alternateProfile.display_name
                });
                Logger.info(`[MetaChatService] Alternado com sucesso para perfil ${alternateProfile.display_name}.`);
              } catch (altErr: any) {
                Logger.warn(`[MetaChatService] Falha ao conectar ao perfil alternativo ${alternateProfile.display_name}: ${altErr?.message}`);
              }
            }

            // b) Se nenhum Language Server estiver rodando na porta TCP:
            if (!execEnv) {
              const discovery = AntigravityDiscovery.discover();
              if (discovery.available && discovery.languageServerExe) {
                // Executar via CLI direta do Antigravity (language_server.exe ou agentapi) usando o diretório do projeto e USERPROFILE limpo
                const userProfileDir = AccountProfileManager.getUserProfileDir(activeProfile);
                execEnv = AgentApiGateway.sanitizeEnv(process.env);
                execEnv.ANTIGRAVITY_PROJECT_ID = projectBinding.nativeProjectId || 'hub-metachat';
                execEnv.USERPROFILE = userProfileDir;
                execEnv.HOME = userProfileDir;
                delete execEnv.ANTIGRAVITY_LS_ADDRESS;
                delete execEnv.ANTIGRAVITY_CSRF_TOKEN;
                directCliMode = true;
                Logger.info(`[MetaChatService] Nenhum Language Server TCP ativo detectado. Usando modo CLI direta do Antigravity com USERPROFILE="${userProfileDir}".`);
              } else {
                // Informe ao usuário com clareza: "Runtime Antigravity não detectado. Inicie o Antigravity para executar tarefas com a IA"
                const errorMsg = 'Runtime Antigravity não detectado. Inicie o Antigravity para executar tarefas com a IA.';
                this.updateLiveStatus({
                  isRunning: false,
                  isExecuting: false,
                  phase: 'Pronto',
                  currentPhase: 'Pronto',
                  lastStep: errorMsg
                });
                this.updatePipelineTask('task-inspect', 'failed', errorMsg);
                this.updatePipelineTask('task-implement', 'failed', errorMsg);
                this.updatePipelineTask('task-verify', 'failed', errorMsg);
                this.recordLiveStep({
                  type: 'GUARD',
                  target: 'Runtime Antigravity',
                  status: 'failed',
                  details: errorMsg
                });

                const assistantMsg = this.addMessage({
                  role: 'assistant',
                  content: `⚠️ **Aviso de Conexão com a IA:**\n\n${errorMsg}\n\n*Por favor, inicie o aplicativo Google Antigravity e garanta que sua conta esteja conectada.*`,
                  thread_id: currentThread.id,
                  metadata: {
                    error: errorMsg,
                    model: requestedModel,
                    reasoningMode: requestedReasoning,
                    accountId: requestedAccountId
                  }
                });

                return {
                  message: assistantMsg,
                  filesChanged: [],
                  typecheck: { passed: false, durationMs: 0, output: errorMsg },
                  selfHealed: false,
                  conversationId: undefined,
                  status: 'error',
                  telemetry: this.getLiveActivity()
                };
              }
            }
          }

          const antigravityProvider = new AntigravityProvider(execEnv);

          const fullPrompt = [
            `=== PAPEL: AUTO-EVOLUÇÃO E ENGENHARIA DO PRÓPRIO DECOHUB ===`,
            `Você é o agente de engenharia do Antigravity operando diretamente no repositório do DecoHUB em "${root}".`,
            `Modo de Raciocínio: ${resolvedConfig.intelligenceLevel} | Modelo Solicitado: ${resolvedConfig.canonicalName} (${requestedModel})`,
            ``,
            `--- MENSAGEM DO USUÁRIO ---`,
            userContent,
            attachmentsBlock,
            ``,
            `--- DIRETRIZES DE EXECUÇÃO CIRÚRGICA ---`,
            `1. Inspecione e edite diretamente os arquivos necessários em "server/src/" ou "client/src/". Caso alguma ferramenta nativa de escrita/edição não esteja disponível, emita blocos estruturados no padrão:`,
            `   [FILE: caminho/relativo/do/arquivo.ts]`,
            `   \`\`\`typescript`,
            `   // código completo atualizado do arquivo`,
            `   \`\`\``,
            `   [ENDFILE]`,
            `2. Mantenha os padrões arquiteturais existentes, tipagem estrita de TypeScript e testes verdes.`,
            `3. Não altere arquivos em .git/, node_modules/ ou .ai-dev-hub/.`,
            `4. Padrão Corporativo Limpo: ZERO emojis decorativos em código, logs ou mensagens. Jamais repita o enunciado do usuário no início da resposta. Explique objetivamente as modificações aplicadas.`
          ]
            .filter(Boolean)
            .join('\n\n');

          const userProfileDir = AccountProfileManager.getUserProfileDir(projectBinding.accountProfile);
          const brainDir = path.join(userProfileDir, '.gemini', 'antigravity', 'brain');
          const transcriptPath = activeConvId
            ? path.join(brainDir, activeConvId, '.system_generated', 'logs', 'transcript.jsonl')
            : null;

          let initialLineCount = 0;
          if (transcriptPath && fs.existsSync(transcriptPath)) {
            try {
              initialLineCount = fs
                .readFileSync(transcriptPath, 'utf-8')
                .trim()
                .split('\n')
                .filter(Boolean).length;
            } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "metaChatService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:metaChatService]", err);
      }
    }
          }

          if (this._currentExecution) {
            this._currentExecution.userProfileDir = userProfileDir;
            this._currentExecution.lastTranscriptLineCount = initialLineCount;
          }

          this.updateLiveStatus({
            phase: `Inspecionando e modificando código no Antigravity...`,
            lastStep: `Despachando prompt para ${resolvedConfig.canonicalName}`
          });

          this.recordLiveStep({
            type: 'COMMAND',
            target: `Antigravity (${resolvedConfig.canonicalName})`,
            status: 'done',
            details: `Despachando turno para Antigravity Language Server (${resolvedConfig.intelligenceLevel})`
          });

          let sendSucceeded = false;
          if (activeConvId && this.isConversationValid(activeConvId, userProfileDir)) {
            try {
              antigravityProvider.captureTurnStart(activeConvId, root);
              AgentApiGateway.sendMessage({
                conversationId: activeConvId,
                prompt: fullPrompt,
                projectId: projectBinding.project.id,
                role: 'CONVERSATIONAL',
                caller: 'MetaChatService.handleUserMessage',
                cwd: root,
                env: execEnv
              });
              sendSucceeded = true;
            } catch (sendErr: any) {
              Logger.warn(
                `[MetaChatService] Falha ao enviar mensagem na conversa ativa [${activeConvId}]: ${sendErr.message}. Criando nova sessão de auto-recuperação...`
              );
              sendSucceeded = false;
            }
          }

          if (!sendSucceeded) {
            try {
              activeConvId = AgentApiGateway.newConversation({
                model: cliModel,
                title: 'DecoHUB Meta-Chat',
                prompt: fullPrompt,
                projectId: projectBinding.project.id,
                role: 'CONVERSATIONAL',
                caller: 'MetaChatService.handleUserMessage',
                cwd: root,
                env: execEnv
              });
              this.setActiveConversationId(activeConvId, effectiveAccountId);
              antigravityProvider.captureTurnStart(activeConvId, root);
            } catch (createErr: any) {
              const errMsg = createErr?.message || String(createErr);
              const isRuntimeUnavailable =
                directCliMode ||
                errMsg.includes('AGENTAPI_UNAVAILABLE') ||
                errMsg.includes('ECONNREFUSED') ||
                errMsg.includes('não encontrado no sistema') ||
                errMsg.includes('could not connect') ||
                errMsg.includes('failed to connect') ||
                errMsg.includes('Runtime Antigravity');

              if (isRuntimeUnavailable && !AgentApiGateway.isOfflineMode()) {
                const clearMsg = 'Runtime Antigravity não detectado. Inicie o Antigravity para executar tarefas com a IA.';
                Logger.warn(`[MetaChatService] ${clearMsg} (${errMsg})`);
                this.updateLiveStatus({
                  isRunning: false,
                  isExecuting: false,
                  phase: 'Pronto',
                  currentPhase: 'Pronto',
                  lastStep: clearMsg
                });
                this.updatePipelineTask('task-inspect', 'failed', clearMsg);
                this.updatePipelineTask('task-implement', 'failed', clearMsg);
                this.updatePipelineTask('task-verify', 'failed', clearMsg);

                const botMsg = this.addMessage({
                  role: 'assistant',
                  content: `⚠️ **Aviso de Conexão com a IA:**\n\n${clearMsg}\n\n*Detalhes técnicos: ${errMsg}*`,
                  thread_id: currentThread.id,
                  metadata: {
                    error: clearMsg,
                    model: requestedModel,
                    reasoningMode: requestedReasoning,
                    accountId: requestedAccountId
                  }
                });

                return {
                  message: botMsg,
                  filesChanged: [],
                  typecheck: { passed: false, durationMs: 0, output: clearMsg },
                  selfHealed: false,
                  conversationId: undefined,
                  status: 'error',
                  telemetry: this.getLiveActivity()
                };
              }
              throw createErr;
            }
          }

          if (this._currentExecution) {
            this._currentExecution.conversationId = activeConvId || undefined;
          }

          this.updateLiveStatus({
            phase: `Inspecionando e modificando código no Antigravity...`,
            lastStep: `Aguardando turno em ${activeConvId}`
          });

          const turnResult = await antigravityProvider.getResult(
            activeConvId!,
            300000,
            root,
            () => Boolean(this._currentExecution?.cancelRequested || TurnCancellationManager.isCancelled('metachat', activeConvId))
          );
          let agentReport = (turnResult.rawResponse || (turnResult as any).finalResponse || '').trim();

          if (!agentReport && activeConvId) {
            try {
              const fromTranscript = await this.waitForTranscriptResponse(
                activeConvId,
                initialLineCount,
                4000,
                userProfileDir
              );
              if (fromTranscript && fromTranscript.trim()) {
                agentReport = fromTranscript.trim();
              }
            } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "metaChatService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:metaChatService]", err);
      }
    }
          }

          if (!agentReport && turnResult.agentThoughts) {
            agentReport = turnResult.agentThoughts.trim();
          }

          this.updatePipelineTask('task-inspect', 'completed');
          this.updatePipelineTask('task-implement', 'completed');

          const changedInTurn = this.diffFileBaseline(root, baselineBefore, turnResult.filesChanged);
          filesChanged.push(...changedInTurn);

          // Fallback parser: Check if textual response contains [FILE: ...] blocks not yet applied to disk
          if (agentReport) {
            const parsedBlocks = this.parseCodeDirectives(agentReport);
            for (const pb of parsedBlocks) {
              if (pb.action === 'write' && typeof pb.content === 'string') {
                try {
                  const fullPath = this.validatePathWithinRepo(pb.filePath);
                  const relPath = path.relative(root, fullPath).replace(/\\/g, '/');
                  let shouldWrite = true;
                  if (fs.existsSync(fullPath)) {
                    const currentDiskContent = fs.readFileSync(fullPath, 'utf-8');
                    if (currentDiskContent === pb.content) {
                      shouldWrite = false;
                    }
                  }
                  if (shouldWrite) {
                    this.writeFile(relPath, pb.content);
                    if (!filesChanged.includes(relPath)) {
                      filesChanged.push(relPath);
                    }
                    this.recordLiveStep({
                      type: 'EDIT',
                      target: relPath,
                      status: 'done',
                      details: `Gravando ${relPath} (bloco de código)`
                    });
                  }
                } catch (writeErr: any) {
                  Logger.warn(`[MetaChatService] Erro ao aplicar bloco [FILE]: ${writeErr.message}`);
                }
              }
            }
          }

          if (this._currentExecution) {
            for (const f of filesChanged) {
              this._currentExecution.filesChanged.add(f);
            }
          }

          if (filesChanged.length > 0) {
            this.updatePipelineTask('task-verify', 'in_progress', `Verificando ${filesChanged.length} arquivos alterados`);
            this.recordLiveStep({
              type: 'GUARD',
              target: 'tsc --noEmit',
              status: 'running',
              details: 'Validando integridade de compilação com Typecheck Guard...'
            });
            this.updateLiveStatus({
              phase: `Validando Typecheck Guard tsc --noEmit...`,
              lastStep: `Verificando ${filesChanged.length} arquivos alterados`
            });

            const hasServerFiles = filesChanged.some(f => f.startsWith('server/'));
            const hasClientFiles = filesChanged.some(f => f.startsWith('client/'));
            const target = hasServerFiles && hasClientFiles ? 'all' : hasClientFiles ? 'client' : 'server';

            typecheckResult = await this.runTypecheck(target, filesChanged);

            if (!typecheckResult.passed) {
              Logger.warn(
                `[MetaChatService] Typecheck quebrou após turno do Antigravity. Acionando Autoproteção Ativa...`
              );
              this.updatePipelineTask('task-verify', 'failed', 'Erro no Typecheck: rollback executado');
              this.recordLiveStep({
                type: 'GUARD',
                target: 'Rollback Automático',
                status: 'done',
                details: 'Autoproteção Ativa: restaurando integridade do repositório'
              });
              this.rollbackChangedFiles(root, filesChanged, baselineBefore);
              selfHealed = true;
            } else {
              this.updatePipelineTask('task-verify', 'completed', `Aprovado em ${typecheckResult.durationMs}ms`);
            }
          } else {
            this.updatePipelineTask('task-verify', 'completed', 'Sem alterações em arquivos de código');
          }

          if (selfHealed) {
            let errorDetails = '';
            if (typecheckResult.errors && typecheckResult.errors.length > 0) {
              errorDetails = typecheckResult.errors
                .map(e => `- \`${e.file}:${e.line || '?'}\` → **${e.message}**`)
                .join('\n');
            } else {
              errorDetails = `\`\`\`text\n${typecheckResult.output.slice(0, 800)}\n\`\`\``;
            }

            reply =
              `[SELF_HEALING_GUARD] **Autoproteção Ativa Ativada:**\n\n` +
              `As alterações geradas causaram erro de compilação TypeScript no DecoHUB:\n\n` +
              `${errorDetails}\n\n` +
              `O DecoHUB desfez as alterações automaticamente para manter o repositório 100% íntegro e estável.\n\n` +
              (agentReport ? `**Relatório do Agente Antigravity:**\n${agentReport}` : '');
          } else if (filesChanged.length > 0) {
            const telemetryFooter =
              `\n\n[MODIFIED] **Arquivos Modificados no DecoHUB:**\n` +
              filesChanged.map(f => `- \`${f}\``).join('\n') +
              `\n\n` +
              `[TYPECHECK] **Typecheck Guard:** Aprovado em ${typecheckResult.durationMs}ms (0 erros de compilação).\n` +
              `\nClique em **"Recompilar e Atualizar Produção"** para empacotar as melhorias no executável local.`;
            reply =
              (agentReport
                ? agentReport
                : `[AGENTE] As alterações solicitadas foram executadas com sucesso no repositório DecoHUB.`) +
              telemetryFooter;
          } else {
            reply =
              agentReport ||
              `[META-CHAT] **DecoHUB Meta-Chat:**\n\nTurno concluído no Antigravity. Nenhuma modificação direta em arquivos foi necessária para responder à instrução.`;
          }
        }
      }

      // 4. Run tests if requested and typecheck passed
      if (options?.runTests && typecheckResult.passed && !selfHealed) {
        this.updatePipelineTask('task-guard', 'in_progress', `Executando ${options.testFile || 'testes'}`);
        this.recordLiveStep({
          type: 'COMMAND',
          target: options.testFile || 'test/metaChatSelfEvolution.test.ts',
          status: 'running',
          details: `Executando teste focado: ${options.testFile || 'test/metaChatSelfEvolution.test.ts'}`
        });
        this.updateLiveStatus({
          phase: 'Executando testes automatizados com Scoped Test Runner...',
          lastStep: options.testFile || 'test/metaChatSelfEvolution.test.ts'
        });
        const tFile = options.testFile || 'test/metaChatSelfEvolution.test.ts';
        const tRes = await this.runScopedTest(tFile);
        testResult = { ran: true, passed: tRes.passed, output: tRes.output };
        this.updatePipelineTask('task-guard', tRes.passed ? 'completed' : 'failed', tRes.passed ? 'Aprovado' : 'Falha');
      } else {
        this.updatePipelineTask('task-guard', 'completed', 'Verificação finalizada');
      }

      const liveSteps = this._currentExecution?.liveSteps || [];
      const pipelineTasks = this._currentExecution?.pipelineTasks || [];

      this._currentExecution = null;
      this.updateLiveStatus({
        isRunning: false,
        isExecuting: false,
        phase: 'Pronto',
        currentPhase: 'Pronto',
        lastStep: 'Concluído com sucesso'
      });
      this.updateThread(currentThread.id, { status: 'idle' });

      const assistantMsg = this.addMessage({
        role: 'assistant',
        content: reply,
        thread_id: currentThread.id,
        executed_steps_json: JSON.stringify(liveSteps),
        metadata: {
          files_changed: filesChanged,
          filesModified: filesChanged,
          typecheck: {
            passed: typecheckResult.passed && !selfHealed,
            duration_ms: typecheckResult.durationMs,
            output: typecheckResult.output
          },
          tests: testResult,
          error: selfHealed ? typecheckResult.output : undefined,
          conversationId: activeConvId || undefined,
          model: requestedModel,
          reasoningMode: requestedReasoning,
          accountId: requestedAccountId,
          executedSteps: liveSteps,
          pipelineTasks: pipelineTasks
        }
      });

      return {
        message: assistantMsg,
        filesChanged,
        typecheck: {
          passed: typecheckResult.passed && !selfHealed,
          durationMs: typecheckResult.durationMs,
          output: typecheckResult.output
        },
        tests: testResult,
        selfHealed,
        conversationId: activeConvId || undefined
      };
    } catch (err: any) {
      if (this._currentExecution?.cancelRequested || err.message?.includes('RUN_CANCELLED')) {
        this.rollbackChangedFiles(root, filesChanged, this._currentExecution?.baselineBefore);
        this._currentExecution = null;
        this.updateLiveStatus({ isRunning: false, isExecuting: false, phase: 'Pronto', currentPhase: 'Pronto' });
        this.updateThread(currentThread.id, { status: 'idle' });
        TurnCancellationManager.clearCancellation('metachat', activeConvId);

        const cancelMsg = this.addMessage({
          role: 'system',
          content: '[CANCELADO] Execução interrompida pelo usuário (arquivos preservados no estado íntegro)',
          thread_id: currentThread.id,
          metadata: {
            cancelled: true,
            model: requestedModel,
            reasoningMode: requestedReasoning,
            accountId: requestedAccountId,
            conversationId: activeConvId || undefined
          }
        });

        return {
          message: cancelMsg,
          filesChanged: [],
          typecheck: { passed: true, durationMs: 0, output: 'Cancelado pelo usuário.' },
          selfHealed: false,
          conversationId: activeConvId || undefined
        };
      }

      this._currentExecution = null;
      this.updateThread(currentThread.id, { status: 'idle' });

      if (!options?.retryAfterFailover) {
        try {
          const { AccountProfileManager } = await import('./accountProfileManager.js');
          const classification = AccountProfileManager.classifyAccountOrQuotaError(err);
          if (classification.isAccountOrQuotaError) {
            Logger.warn(
              `[MetaChatService] Falha de conta/cota detectada no Meta-Chat (${classification.kind}): ${classification.reason}. Tentando Auto-Failover...`
            );
            const failoverRes = await AccountProfileManager.handleAccountFailureAndRapidSwitch({
              failedProfileId: requestedAccountId,
              error: err
            });
            if (failoverRes.switched) {
              Logger.info(
                `[MetaChatService] Auto-Failover concluído com sucesso: "${failoverRes.previousProfileId}" -> "${failoverRes.activeProfile.display_name}". Retentando mensagem no Meta-Chat...`
              );
              return this.handleUserMessage(userContent, {
                ...options,
                threadId: currentThread.id,
                accountId: failoverRes.activeProfile.id,
                retryAfterFailover: true
              });
            }
          }
        } catch (failoverErr: any) {
          Logger.warn(`[MetaChatService] Falha ao tentar Auto-Failover no Meta-Chat: ${failoverErr.message}`);
        }
      }

      Logger.error(`[MetaChatService] Erro na execução de handleUserMessage: ${err.message}`);
      this.updateLiveStatus({
        isRunning: false,
        isExecuting: false,
        phase: 'Pronto',
        currentPhase: 'Pronto',
        lastStep: `Erro: ${err.message}`
      });

      const errorReply =
        `[ERRO] **Falha na Execução do Meta-Chat:**\n\n` +
        `- **Diagnóstico Técnico:** ${err.message || String(err)}\n` +
        (requestedAccountId ? `- **Conta Ativa Solicitada:** \`${requestedAccountId}\`\n` : '') +
        `- **Modelo:** \`${requestedModel}\`\n` +
        (err.code ? `- **Código:** \`${err.code}\`\n` : '') +
        (err.stack ? `\n\`\`\`text\n${err.stack.slice(0, 500)}\n\`\`\`\n` : '\n') +
        `Por favor, verifique se o runtime do Antigravity está online para esta conta ou tente usar o botão **Rapid Switch** para alternar de perfil.`;

      const assistantMsg = this.addMessage({
        role: 'assistant',
        content: errorReply,
        thread_id: currentThread.id,
        metadata: {
          error: err.message,
          model: requestedModel,
          reasoningMode: requestedReasoning,
          accountId: requestedAccountId,
          conversationId: activeConvId || undefined
        }
      });

      return {
        message: assistantMsg,
        filesChanged: [],
        typecheck: { passed: false, durationMs: 0, output: err.message },
        selfHealed: false,
        conversationId: activeConvId || undefined
      };
    }
  }

  /**
   * Helper to parse markdown code directives:
   * e.g. [FILE: server/src/utils/myUtil.ts]
   * ```ts
   * export function ...
   * ```
   */
  private static parseCodeDirectives(
    content: string
  ): Array<{ action: 'write' | 'read'; filePath: string; content?: string }> {
    const directives: Array<{ action: 'write' | 'read'; filePath: string; content?: string }> = [];
    const seenPaths = new Set<string>();

    if (!content || typeof content !== 'string') return directives;

    // Pattern 1: [FILE: path] ... [ENDFILE]
    const endFileRegex =
      /\[(?:FILE|ARQUIVO|CRIAR|MODIFICAR):\s*([a-zA-Z0-9_\-./\\]+)\]([\s\S]*?)\[ENDFILE\]/gi;
    let match: RegExpExecArray | null;

    while ((match = endFileRegex.exec(content)) !== null) {
      const filePath = match[1].trim();
      let fileCode = match[2].trim();
      const fenced = fileCode.match(/^```(?:[a-zA-Z0-9_-]+)?\r?\n([\s\S]*?)\r?\n```$/);
      if (fenced) {
        fileCode = fenced[1];
      }
      directives.push({ action: 'write', filePath, content: fileCode });
      seenPaths.add(filePath.replace(/\\/g, '/'));
    }

    // Pattern 2: [FILE: path] ```ts ... ``` (supports preceding headers/bold)
    const fencedRegex =
      /(?:#{1,6}\s*|\*\*|`)?\[(?:FILE|ARQUIVO|CRIAR|MODIFICAR):\s*([a-zA-Z0-9_\-./\\]+)\](?:\*\*|`)?\s*```(?:[a-zA-Z0-9_-]+)?\s*([\s\S]*?)```/gi;

    while ((match = fencedRegex.exec(content)) !== null) {
      const filePath = match[1].trim();
      const normPath = filePath.replace(/\\/g, '/');
      if (!seenPaths.has(normPath)) {
        directives.push({ action: 'write', filePath, content: match[2].trim() });
        seenPaths.add(normPath);
      }
    }

    // Pattern 3: ```lang [FILE: path] ... ```
    const fenceHeaderRegex =
      /```(?:[a-zA-Z0-9_-]+)?\s*\[(?:FILE|ARQUIVO|CRIAR|MODIFICAR):\s*([a-zA-Z0-9_\-./\\]+)\]\s*([\s\S]*?)```/gi;

    while ((match = fenceHeaderRegex.exec(content)) !== null) {
      const filePath = match[1].trim();
      const normPath = filePath.replace(/\\/g, '/');
      if (!seenPaths.has(normPath)) {
        directives.push({ action: 'write', filePath, content: match[2].trim() });
        seenPaths.add(normPath);
      }
    }

    // Pattern 4: Code block containing top comment header: // [FILE: path] or // FILE: path
    const commentHeaderRegex =
      /```(?:[a-zA-Z0-9_-]+)?\s*\r?\n\s*(?:\/\/|#|\/\*)\s*\[?(?:FILE|ARQUIVO):\s*([a-zA-Z0-9_\-./\\]+)\]?(?:\s*\*\/)?\s*\r?\n([\s\S]*?)```/gi;

    while ((match = commentHeaderRegex.exec(content)) !== null) {
      const filePath = match[1].trim();
      const normPath = filePath.replace(/\\/g, '/');
      if (!seenPaths.has(normPath)) {
        directives.push({ action: 'write', filePath, content: match[2].trim() });
        seenPaths.add(normPath);
      }
    }

    // Pattern 5: Fence with file path in language identifier (e.g. ```typescript:server/src/foo.ts)
    const fencePathRegex =
      /```(?:[a-zA-Z0-9_-]+)?(?::|\s+file=|\s+path=|\s+)([a-zA-Z0-9_\-./\\]+\.[a-zA-Z0-9]+)\s*\r?\n([\s\S]*?)```/gi;

    while ((match = fencePathRegex.exec(content)) !== null) {
      const filePath = match[1].trim();
      const normPath = filePath.replace(/\\/g, '/');
      if (!seenPaths.has(normPath)) {
        directives.push({ action: 'write', filePath, content: match[2].trim() });
        seenPaths.add(normPath);
      }
    }

    return directives;
  }
}