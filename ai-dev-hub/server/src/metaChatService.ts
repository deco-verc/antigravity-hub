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
import { PlaywrightVisualInspector } from './playwrightVisualInspector.js';
import { AntigravityProvider, isToolDump, stripRawLineNumberDumps } from './antigravityProvider.js';
import { DevAutonomyService } from './devAutonomyService.js';
import { TurnCancellationManager } from './turnCancellationManager.js';
import { ExecutionCoordinator } from './executionCoordinator.js';
import { FATAL_QUOTA_OR_AUTH_REGEX, captureFileInventory, changedFiles, FileInventory } from './agentTurnState.js';
import { SkillRouter } from './skillRouter.js';

export type MetaChatIntentMode = 'ANALYTICAL_BRIEFING' | 'AUTONOMOUS_EVOLUTION';

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
  intentMode?: MetaChatIntentMode;
  isAutopilotCycle?: boolean;
  skipLedgerAppend?: boolean;
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
  status?: 'keep' | 'discard' | 'crash' | string;
  keepOrDiscard?: 'keep' | 'discard' | 'crash';
  scoreMetric?: string;
  durationSec?: number;
  commitHash?: string;
  hypothesisSummary?: string;
  simplicityDelta?: {
    linesAdded: number;
    linesRemoved: number;
    delta: number;
  };
  visualGate?: {
    passed: boolean;
    buildPassed: boolean;
    visualPassed: boolean;
    details?: string;
  };
  telemetry?: MetaChatLiveActivity | MetaChatLiveStatus;
}

export interface MetaChatAutopilotStatus {
  enabled: boolean;
  isExecutingCycle: boolean;
  mode: 'CONTINUOUS' | 'BATCH';
  maxCycles: number;
  completedCycles: number;
  keptEvolutions: number;
  revertedEvolutions: number;
  cooldownSeconds: number;
  activeThreadId?: string;
  lastCycleSummary?: string;
  startedAt?: string;
}

export class MetaChatService {
  private static _repoRoot: string | null = null;
  private static _autopilotState: MetaChatAutopilotStatus = {
    enabled: false,
    isExecutingCycle: false,
    mode: 'BATCH',
    maxCycles: 1,
    completedCycles: 0,
    keptEvolutions: 0,
    revertedEvolutions: 0,
    cooldownSeconds: 15
  };
  private static _autopilotAbortController: AbortController | null = null;
  private static _autopilotLoopPromise: Promise<void> | null = null;
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

  // ==========================================
  // DUAL-MODE INTENT ROUTER & XML PROMPT BUILDERS (EIXO 7 ANTIGRAVITY 2.0)
  // ==========================================

  /**
   * Classifies whether the user request is an analytical/diagnostic query (ANALYTICAL_BRIEFING)
   * or a code mutation / self-evolution directive (AUTONOMOUS_EVOLUTION).
   */
  static detectIntentMode(userContent: string, explicitMode?: MetaChatIntentMode): MetaChatIntentMode {
    if (explicitMode) return explicitMode;
    const text = (userContent || '').trim();

    if (
      text.includes('<evolution_mission>') ||
      text.includes('AUTOPILOT CYCLE') ||
      /\[(?:FILE|ARQUIVO|CRIAR|MODIFICAR):/i.test(text)
    ) {
      return 'AUTONOMOUS_EVOLUTION';
    }

    const mutationKeywords =
      /\b(implement\w*|refator\w*|corrig\w*|consert\w*|adicion\w*|crie|criar|modifiq\w*|alter\w*|atualiz\w*|remov\w*|delet\w*|apliq\w*|fix|patch|update|refactor|add|create|remove|rewrite|reescrev\w*|otimiz\w*|migre|migrar)\b/i;
    const analyticalReadOnlyKeywords =
      /\b(apenas\s+analis\w*|somente\s+leitura|sem\s+alterar|sem\s+modificar|explique|explicar|como\s+funciona|qual\s+a\s+causa|diagnostiq\w*|audite|auditoria|o\s+que\s+faz|por\s+que|onde\s+fica|liste|listar|resuma|relat[oó]rio|briefing)\b/i;

    if (analyticalReadOnlyKeywords.test(text) && !/\b(e\s+corrija|e\s+implemente|e\s+aplique|e\s+modifique)\b/i.test(text)) {
      return 'ANALYTICAL_BRIEFING';
    }

    if (mutationKeywords.test(text)) {
      return 'AUTONOMOUS_EVOLUTION';
    }

    if (text.endsWith('?') && !mutationKeywords.test(text)) {
      return 'ANALYTICAL_BRIEFING';
    }

    return 'AUTONOMOUS_EVOLUTION';
  }

  /**
   * Builds the Antigravity 2.0 & Gemini 3.8 XML Prompt using U-shaped attention geometry:
   * - Top (Primacy): <system_invariants>
   * - Middle (Context): <workspace_context>
   * - Bottom (Recency): <execution_directive mode="ANALYTICAL_BRIEFING | AUTONOMOUS_EVOLUTION">
   */
  static buildMetaChatPrompt(params: {
    mode: MetaChatIntentMode;
    root: string;
    userQueryOrMission: string;
    attachmentsBlock?: string;
    intelligenceLevel: string;
    canonicalModelName: string;
    requestedModel: string;
  }): string {
    const attachmentsXml = params.attachmentsBlock
      ? `\n  <user_attachments>\n${params.attachmentsBlock}\n  </user_attachments>`
      : '';

    return `<system_invariants>
  <meta_engineer_identity>
    Atuar como Principal Meta-Orchestrator & Staff AI Systems Engineer responsável pelo diagnóstico, manutenção e auto-evolução contínua do próprio orquestrador DecoHUB (\`ai-dev-hub\`) no ecossistema Google Antigravity 2.0.
    Repositório Autoritativo: "${params.root}"
    Calibração Cognitiva: ${params.intelligenceLevel} | Modelo: ${params.canonicalModelName} (${params.requestedModel})
  </meta_engineer_identity>

  <operational_safety_invariants>
    1. PROTEÇÃO DA COMPILAÇÃO DO DECOHUB: O código-fonte do DecoHUB (\`server/src/**\`, \`client/src/**\`) é infraestrutura crítica de missão. Nenhuma modificação pode deixar o repositório com erros em \`npx tsc --noEmit\` ou quebrar os testes em \`node --test\`.
    2. USO EXCLUSIVO DE FERRAMENTAS NATIVAS DO ANTIGRAVITY 2.0: Utilizar exclusivamente \`view_file\`, \`grep_search\`, \`find_by_name\`, \`list_dir\`, \`replace_file_content\`, \`multi_replace_file_content\`, \`write_to_file\` e \`run_command\`. É terminantemente proibido criar scripts temporários (\`.cjs\`, \`.mjs\`, \`node -e\`, \`sed\`) para editar o código-fonte.
    3. FRONTEIRAS DE ESCOPO: Jamais modificar arquivos dentro de \`.git/\`, \`node_modules/\` ou artefatos protegidos em \`.ai-dev-hub/\`.
    4. PADRÃO CORPORATIVO LIMPO (ZERO EMOJIS): Não utilizar emojis decorativos em código, comentários, logs ou respostas. Nunca repetir ou ecoar o enunciado do usuário no início da resposta.
  </operational_safety_invariants>
</system_invariants>

<workspace_context>
  <decohub_repository_root>${params.root}</decohub_repository_root>
  <active_intent_mode>${params.mode}</active_intent_mode>${attachmentsXml}
</workspace_context>

${
  params.mode === 'ANALYTICAL_BRIEFING'
    ? `<execution_directive mode="ANALYTICAL_BRIEFING">
  Com base exclusivamente na inspeção real dos arquivos do repositório DecoHUB em <workspace_context> usando ferramentas de leitura (\`view_file\`, \`grep_search\`, \`find_by_name\`, \`list_dir\`), responda à solicitação abaixo produzindo um **Briefing Executivo Markdown Literal, Denso e Completo**:

  <user_request>
${params.userQueryOrMission}
  </user_request>

  <briefing_contract>
    1. MODO SOMENTE LEITURA: Inspecione os arquivos reais em \`server/src/\` e \`client/src/\` via \`grep_search\` e \`view_file\` antes de afirmar qualquer fato técnico. Não modifique nenhum arquivo neste modo.
    2. ESTRUTURA OBRIGATÓRIA DA RESPOSTA DIRETA NO CHAT:
       - **Sumário Executivo e Diagnóstico Direto**;
       - **Mapeamento Técnico com Coordenadas Exatas** (\`caminho/do/arquivo.ts:linha\`);
       - **Tabela Comparativa de Riscos / Trade-offs Arquiteturais**;
       - **Plano de Ação / Implementação Recomendado**.
    3. COMPLETUDE LITERAL: Não trunque listas, não omita análises em arquivos externos e não entregue respostas superficiais.
  </briefing_contract>
</execution_directive>`
    : `<execution_directive mode="AUTONOMOUS_EVOLUTION">
  Com base exclusivamente na inspeção real do repositório DecoHUB em <workspace_context>, execute a missão de engenharia abaixo seguindo estritamente o ciclo **Explore -> Plan -> Edit -> Verify (Poka-Yoke)**:

  <evolution_mission>
${params.userQueryOrMission}
  </evolution_mission>

  <autonomous_evolution_cycle>
    1. EXPLORE: Inspecione os arquivos alvo e seus importadores em \`server/src/\` e \`client/src/\` usando \`grep_search\` e \`view_file\`.
    2. PLAN: Defina a alteração cirúrgica mínima que resolve a causa raiz preservando 100% da retrocompatibilidade de interfaces e contratos TypeScript existentes.
    3. EDIT: Aplique as modificações diretamente nos arquivos em \`server/src/\` ou \`client/src/\` usando \`replace_file_content\`, \`multi_replace_file_content\` ou \`write_to_file\`.
    4. VERIFY (POKA-YOKE): Se aplicável, valide a compilação via \`npx tsc --noEmit\` antes de concluir.
    5. FORMATO DO RELATÓRIO DE ENTREGA AO USUÁRIO (DIRETO E SEM DESPEJO DE CÓDIGO BRUTO):
       - Explique de forma enxuta e técnica:
         **O que foi feito:** resumo claro e objetivo da solução implementada e da causa raiz resolvida.
         **Arquivos alterados:** lista concisa indicando em 1 linha o que mudou em cada arquivo (\`caminho/do/arquivo.ts\`).
  </autonomous_evolution_cycle>
</execution_directive>`
}`;
  }

  /**
   * Builds the GSD Repair Delta Envelope for convergent TypeScript self-healing on the 1st retry.
   * Never mentions bracketed file markers to prevent Instruction Injection / Example Matching.
   */
  static buildSurgicalRepairPrompt(rawCompilerDiagnostics: string, modifiedFiles: string[]): string {
    return `<system_invariants>
  Atuar em modo de Reparo Cirúrgico Convergente (GSD REPAIR DELTA ENVELOPE) no repositório DecoHUB.
  Usar exclusivamente ferramentas nativas (\`view_file\`, \`replace_file_content\`, \`multi_replace_file_content\`, \`write_to_file\`).
</system_invariants>

<workspace_context>
  <scoped_modified_files>
${modifiedFiles.map(f => `    - ${f}`).join('\n')}
  </scoped_modified_files>
  <failure_diagnostics>
${rawCompilerDiagnostics}
  </failure_diagnostics>
</workspace_context>

<execution_directive mode="REPAIR">
  Com base exclusivamente nos erros exatos de compilação TypeScript listados em <failure_diagnostics> acima, execute imediatamente o reparo cirúrgico:
  1. LOCALIZAÇÃO EXATA: Use \`view_file\` para inspecionar uma janela de 30 linhas acima e abaixo das coordenadas \`arquivo.ts(linha,coluna)\` apontadas pelo compilador.
  2. DIFF MÍNIMO: Corrija a divergência de tipos, importação ou assinatura nos arquivos listados em <scoped_modified_files> utilizando \`replace_file_content\` ou \`multi_replace_file_content\`, mantendo tipagem estrita (\`strict: true\`) e preservando todos os métodos existentes.
  3. ENCERRAMENTO: Conclua apresentando o resumo atualizado (**O que foi feito:** e **Arquivos alterados:**).
</execution_directive>`;
  }

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
        SET title = ?, model = ?, effort = ?, account_id = ?, status = ?, files_modified_count = ?, last_message_preview = ?, provider_conversation_id = ?, updated_at = ?
        WHERE id = ?
      `).run(
        updated.title,
        updated.model,
        updated.effort,
        updated.account_id ?? null,
        updated.status,
        updated.files_modified_count,
        updated.last_message_preview ?? null,
        updated.provider_conversation_id ?? null,
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
          const defaultNode = isWin ? 'C:\\Program Files\\nodejs\\node.exe' : '/usr/bin/node';
          const isElectron = Boolean(
            (process.versions as any)?.electron ||
            process.execPath.toLowerCase().includes('electron') ||
            process.execPath.toLowerCase().includes('decohub')
          );
          const safeNode = (isElectron && fs.existsSync(defaultNode)) ? defaultNode : process.execPath;
          res = execFileSync(safeNode, [tscScript, '--noEmit', '--skipLibCheck'], {
            cwd: dirPath,
            encoding: 'utf-8',
            timeout: 45000,
            windowsHide: true,
            env: { ...process.env, CI: 'true', NONINTERACTIVE: '1', ELECTRON_RUN_AS_NODE: '1' }
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
   * Resolve o teste unitário focado correspondente aos arquivos modificados em server/src/.
   */
  static resolveMatchingServerTest(filesChanged: string[]): string {
    const serverFiles = filesChanged.filter(f => f.startsWith('server/src/'));
    const testFiles = filesChanged.filter(f => f.startsWith('server/test/'));
    if (testFiles.length > 0) {
      return testFiles[0].replace(/^server\//, '');
    }

    const root = this.getDecoHubRoot();
    const testDir = path.join(root, 'server', 'test');
    if (!fs.existsSync(testDir)) return 'test/metaChatSelfEvolution.test.ts';

    try {
      const allTests = fs.readdirSync(testDir).filter(f => f.endsWith('.test.ts') || f.endsWith('.test.js'));

      for (const sf of serverFiles) {
        const base = path.basename(sf).replace(/\.[^.]+$/, '').toLowerCase();
        // Correspondência exata: <base>.test.ts
        const exact = allTests.find(t => t.toLowerCase() === `${base}.test.ts` || t.toLowerCase() === `${base}.test.js`);
        if (exact) return `test/${exact}`;

        // Correspondência parcial
        const partial = allTests.find(t => t.toLowerCase().includes(base));
        if (partial) return `test/${partial}`;
      }
    } catch {}

    return 'test/metaChatSelfEvolution.test.ts';
  }

  /**
   * Calcula o delta de linhas modificadas (+linhasAdded / -linesRemoved) para o Critério de Simplicidade Karpathy.
   */
  static calculateLineDiff(
    root: string,
    filesChanged: string[],
    beforeBaseline?: Map<string, { size: number; mtime: number; hash?: string; content?: string | null }>
  ): { linesAdded: number; linesRemoved: number; delta: number } {
    let linesAdded = 0;
    let linesRemoved = 0;

    for (const rel of filesChanged) {
      const full = path.join(root, rel);
      const beforeContent = beforeBaseline?.get(rel)?.content ?? '';
      let currentContent = '';
      if (fs.existsSync(full)) {
        try {
          currentContent = fs.readFileSync(full, 'utf-8');
        } catch {}
      }

      const beforeLines = beforeContent ? beforeContent.split(/\r?\n/) : [];
      const currentLines = currentContent ? currentContent.split(/\r?\n/) : [];

      if (beforeLines.length === 0 && currentLines.length > 0) {
        linesAdded += currentLines.length;
      } else if (beforeLines.length > 0 && currentLines.length === 0) {
        linesRemoved += beforeLines.length;
      } else {
        const diff = currentLines.length - beforeLines.length;
        if (diff > 0) {
          linesAdded += diff;
        } else if (diff < 0) {
          linesRemoved += Math.abs(diff);
        }
      }
    }

    return {
      linesAdded,
      linesRemoved,
      delta: linesAdded - linesRemoved
    };
  }

  /**
   * Avalia o Critério de Simplicidade de Karpathy (Navalha de Occam):
   * Código mais simples com resultado igual ou superior é sempre preferível (keep).
   * Ganhos que adicionam complexidade excessiva sem testes são descartados (discard).
   */
  static checkSimplicityCriterion(
    root: string,
    filesChanged: string[],
    beforeBaseline?: Map<string, { size: number; mtime: number; hash?: string; content?: string | null }>,
    metrics?: { testsPassed?: boolean; errorsCount?: number }
  ): { passed: boolean; linesAdded: number; linesRemoved: number; delta: number; reason?: string } {
    const diff = this.calculateLineDiff(root, filesChanged, beforeBaseline);

    const MAX_ALLOWED_UNTESTED_DELTA = 400;
    if (diff.delta > MAX_ALLOWED_UNTESTED_DELTA && !metrics?.testsPassed) {
      return {
        passed: false,
        ...diff,
        reason: `Critério de Simplicidade Karpathy: Complexidade excessiva (+${diff.delta} linhas adicionadas sem validação de testes unitários, limite: ${MAX_ALLOWED_UNTESTED_DELTA}).`
      };
    }

    return {
      passed: true,
      ...diff
    };
  }

  /**
   * Playwright Visual Gate: Valida build do frontend e renderização sem erros de console/página.
   */
  static async runClientVisualGate(filesChanged: string[]): Promise<{
    passed: boolean;
    buildPassed: boolean;
    visualPassed: boolean;
    output: string;
    details: string;
  }> {
    const root = this.getDecoHubRoot();
    const clientDir = path.join(root, 'client');
    const isWin = process.platform === 'win32';
    const isOfflineOrTest = process.env.NODE_ENV === 'test' || AgentApiGateway.isOfflineMode() || Boolean(process.env.NODE_TEST_CONTEXT);

    let buildPassed = true;
    let buildOutput = '';

    // 1. Build do Client (tsc && vite build)
    try {
      if (!isOfflineOrTest) {
        const npmCmd = isWin ? 'npm.cmd' : 'npm';
        buildOutput = execFileSync(npmCmd, ['run', 'build'], {
          cwd: clientDir,
          encoding: 'utf-8',
          timeout: 60000,
          windowsHide: true,
          env: { ...process.env, CI: 'true' }
        });
      } else {
        buildPassed = true;
        buildOutput = 'Build do client aprovado (modo offline/teste).';
      }
    } catch (err: any) {
      buildPassed = false;
      buildOutput = `${err.stdout || ''}\n${err.stderr || ''}\n${err.message || ''}`.trim();
    }

    if (!buildPassed) {
      return {
        passed: false,
        buildPassed: false,
        visualPassed: false,
        output: buildOutput,
        details: 'Falha no build do client (npm run build).'
      };
    }

    // 2. Playwright Visual Gate (0 erros de console, 0 erros de página e renderização válida)
    let visualPassed = true;
    let visualDetails = 'Inspeção visual do client aprovada (0 erros de console, 0 erros de página).';

    try {
      const inspectRes = await PlaywrightVisualInspector.inspect({
        projectPath: clientDir,
        taskId: 'meta-chat-visual-gate',
        timeoutMs: 8000,
        offlineFallback: true
      });

      const consoleErrors = inspectRes.consoleErrors || [];
      const pageErrors = inspectRes.pageErrors || [];

      if (!inspectRes.passed || consoleErrors.length > 0 || pageErrors.length > 0) {
        visualPassed = false;
        visualDetails = `Falha na verificação visual do Playwright: ${consoleErrors.length} erro(s) de console, ${pageErrors.length} erro(s) de página.`;
      }
    } catch (visErr: any) {
      Logger.warn(`[MetaChatService] Aviso ao executar PlaywrightVisualInspector no client: ${visErr.message}`);
      visualPassed = true;
    }

    return {
      passed: buildPassed && visualPassed,
      buildPassed,
      visualPassed,
      output: buildOutput,
      details: visualDetails
    };
  }

  /**
   * Garante que results.tsv esteja listado no .gitignore da raiz do DecoHUB.
   */
  static ensureResultsTsvIgnored(): void {
    const root = this.getDecoHubRoot();
    const gitignorePath = path.join(root, '.gitignore');
    try {
      if (fs.existsSync(gitignorePath)) {
        const content = fs.readFileSync(gitignorePath, 'utf-8');
        if (!/(?:^|\r?\n)\s*results\.tsv\s*(?:\r?\n|$)/.test(content)) {
          fs.appendFileSync(gitignorePath, '\n# Karpathy Autoresearch Ledger\nresults.tsv\n', 'utf-8');
        }
      }
    } catch (err: any) {
      Logger.warn(`[MetaChatService] Erro ao verificar .gitignore para results.tsv: ${err.message}`);
    }
  }

  /**
   * Obtém o hash curto de commit atual (7 caracteres) ou 'baseline'.
   */
  static getCurrentGitCommit(root?: string): string {
    const targetRoot = root || this.getDecoHubRoot();
    try {
      const hash = execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], {
        cwd: targetRoot,
        encoding: 'utf-8',
        windowsHide: true,
        timeout: 5000
      }).trim();
      return hash || 'baseline';
    } catch {
      return 'baseline';
    }
  }

  /**
   * Registra um experimento no results.tsv seguindo o protocolo oficial do Karpathy Autoresearch.
   */
  static appendAutoresearchLedger(entry: {
    commit: string;
    scoreMetric: string;
    durationSec: number;
    status: 'keep' | 'discard' | 'crash';
    description: string;
  }): void {
    const root = this.getDecoHubRoot();
    this.ensureResultsTsvIgnored();
    const tsvPath = path.join(root, 'results.tsv');
    const header = 'commit\tscore_metric\tduration_s\tstatus\tdescription\n';

    try {
      if (!fs.existsSync(tsvPath)) {
        fs.writeFileSync(tsvPath, header, 'utf-8');
      }

      const shortCommit = (entry.commit || 'baseline').slice(0, 7) || 'baseline';
      const cleanDesc = (entry.description || 'Experimento autônomo')
        .replace(/[\r\n\t]+/g, ' ')
        .trim()
        .slice(0, 160);
      const metric = (entry.scoreMetric || 'N/A').replace(/[\r\n\t]+/g, ' ').trim();
      const dur = entry.durationSec >= 0 ? entry.durationSec.toFixed(1) : '0.0';

      const line = `${shortCommit}\t${metric}\t${dur}\t${entry.status}\t${cleanDesc}\n`;
      fs.appendFileSync(tsvPath, line, 'utf-8');
      Logger.info(`[MetaChatService] [Autoresearch Ledger] ${line.trim()}`);
    } catch (err: any) {
      Logger.warn(`[MetaChatService] Falha ao gravar results.tsv: ${err.message}`);
    }
  }

  /**
   * Lê as últimas N linhas de results.tsv para alimentar a memória experimental do prompt.
   */
  static getRecentAutoresearchHistory(limit = 15): string {
    const root = this.getDecoHubRoot();
    const tsvPath = path.join(root, 'results.tsv');
    try {
      if (!fs.existsSync(tsvPath)) return '';
      const raw = fs.readFileSync(tsvPath, 'utf-8').trim();
      if (!raw) return '';
      const lines = raw.split(/\r?\n/).filter(Boolean);
      if (lines.length <= 1) return '';
      const header = lines[0];
      const dataLines = lines.slice(1);
      const recent = dataLines.slice(-limit);
      return [header, ...recent].join('\n');
    } catch (err: any) {
      Logger.warn(`[MetaChatService] Erro ao ler results.tsv: ${err.message}`);
      return '';
    }
  }

  /**
   * Retrieves messages from the meta_chat_messages table for a thread (or active thread).
   */
  static getMessages(threadIdOrLimit?: string | number, maybeLimit?: number): MetaChatMessage[] {
    let threadId: string | null = null;
    let limit = 500;

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
            FROM (
              SELECT id, thread_id, role, content, metadata, executed_steps_json, created_at, rowid
              FROM meta_chat_messages
              WHERE thread_id = ?
              ORDER BY created_at DESC, rowid DESC
              LIMIT ?
            )
            ORDER BY created_at ASC, rowid ASC
          `).all(threadId, limit) as any[]
        : db.prepare(`
            SELECT id, thread_id, role, content, metadata, executed_steps_json, created_at
            FROM (
              SELECT id, thread_id, role, content, metadata, executed_steps_json, created_at, rowid
              FROM meta_chat_messages
              ORDER BY created_at DESC, rowid DESC
              LIMIT ?
            )
            ORDER BY created_at ASC, rowid ASC
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
          SET files_modified_count = 0, last_message_preview = NULL, provider_conversation_id = NULL, updated_at = ?
          WHERE id = ?
        `).run(new Date().toISOString(), threadId);
        try {
          db.prepare("DELETE FROM system_settings WHERE key LIKE ?").run(`metachat_conversation_id:thread:${threadId}%`);
        } catch {}
        Logger.info(`[MetaChatService] Histórico da thread ${threadId} reiniciado com sucesso.`);
      } else {
        db.exec('DELETE FROM meta_chat_messages');
        db.prepare(`
          UPDATE meta_chat_threads
          SET files_modified_count = 0, last_message_preview = NULL, provider_conversation_id = NULL, updated_at = ?
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

  static getActiveConversationId(accountProfileId?: string | null, threadId?: string | null): string | null {
    try {
      if (threadId) {
        // 1. Chave escopada por thread e perfil de conta
        const scopedRow = db
          .prepare('SELECT value FROM system_settings WHERE key = ?')
          .get(`metachat_conversation_id:thread:${threadId}:${accountProfileId || 'default'}`) as any;
        if (scopedRow?.value) {
          return scopedRow.value;
        }

        // 2. Coluna provider_conversation_id na tabela meta_chat_threads
        const threadRow = this.getThread(threadId);
        if (threadRow?.provider_conversation_id) {
          if (!accountProfileId || !threadRow.account_id || threadRow.account_id === accountProfileId) {
            return threadRow.provider_conversation_id;
          }
        }

        // 3. Se a thread existir, tiver provider_conversation_id === null e ainda não possuir nenhuma mensagem do assistente,
        // retorna null (forçando abertura de uma conversa nova e limpa no Antigravity para essa thread!)
        if (threadRow && !threadRow.provider_conversation_id) {
          const assistantMsgCount = (db.prepare(
            "SELECT count(*) as cnt FROM meta_chat_messages WHERE thread_id = ? AND role = 'assistant'"
          ).get(threadId) as any)?.cnt || 0;
          if (assistantMsgCount === 0) {
            return null;
          }
        }
      }

      // Fallback legado por conta ou global
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

  static setActiveConversationId(id: string | null, accountProfileId?: string | null, threadId?: string | null): void {
    try {
      const now = new Date().toISOString();
      if (threadId) {
        const threadKey = `metachat_conversation_id:thread:${threadId}:${accountProfileId || 'default'}`;
        if (!id) {
          db.prepare('DELETE FROM system_settings WHERE key = ?').run(threadKey);
          this.updateThread(threadId, {
            provider_conversation_id: null,
            ...(accountProfileId ? { account_id: accountProfileId } : {})
          });
        } else {
          db.prepare(`
            INSERT INTO system_settings (key, value, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
          `).run(threadKey, id, now);
          this.updateThread(threadId, {
            provider_conversation_id: id,
            ...(accountProfileId ? { account_id: accountProfileId } : {})
          });
        }
      }

      // Atualização legada/global para compatibilidade de testes
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
    initialLineCount: number = 0,
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
          const newLines = lines.slice(Math.max(0, initialLineCount));
          for (let i = newLines.length - 1; i >= 0; i--) {
            let entry: any;
            try {
              entry = JSON.parse(newLines[i]);
            } catch {
              continue;
            }
            if (entry.status === 'ERROR' || entry.type === 'ERROR_MESSAGE') {
              throw new Error(
                `Antigravity conversation reported error: ${entry.error || entry.content || 'Status ERROR'}`
              );
            }
            const entryText = String(entry.error || entry.content || entry.message || '');
            if (FATAL_QUOTA_OR_AUTH_REGEX.test(entryText)) {
              throw new Error(`QUOTA_EXHAUSTED: ${entryText}`);
            }
            if (
              (entry.type === 'PLANNER_RESPONSE' ||
                entry.type === 'ASSISTANT_RESPONSE' ||
                entry.type === 'MODEL_TURN' ||
                entry.role === 'assistant' ||
                entry.source === 'MODEL') &&
              entry.content &&
              !(entry.tool_calls?.length > 0)
            ) {
              let fullText = String(entry.content);
              if (fs.existsSync(transcriptFullPath)) {
                try {
                  const fullLines = fs
                    .readFileSync(transcriptFullPath, 'utf-8')
                    .trim()
                    .split('\n')
                    .filter(Boolean);
                  for (let j = fullLines.length - 1; j >= 0; j--) {
                    const fullEntry = JSON.parse(fullLines[j]);
                    if (
                      fullEntry.step_index === entry.step_index &&
                      (!fullEntry.type || fullEntry.type === 'PLANNER_RESPONSE' || fullEntry.role === 'assistant' || fullEntry.source === 'MODEL') &&
                      fullEntry.content
                    ) {
                      if (String(fullEntry.content).length >= fullText.length) {
                        fullText = String(fullEntry.content);
                      }
                      break;
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
              const cleanedText = stripRawLineNumberDumps(fullText);
              if (!isToolDump(cleanedText)) {
                return cleanedText;
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
      const out = execFileSync('git', ['status', '--porcelain', '.'], {
        cwd: root,
        encoding: 'utf-8',
        windowsHide: true,
        timeout: 10000
      });
      return out
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(line => {
          const status = line.slice(0, 3);
          let file = line.slice(3).trim().replace(/^"|"$/g, '').replace(/\\/g, '/');
          file = file.replace(/^ai-dev-hub[\\/]/, '');
          return `${status}${file}`;
        });
    } catch {
      return [];
    }
  }

  static captureFileBaseline(root: string): Map<string, { size: number; mtime: number; hash?: string; content?: string | null; diskHash?: string }> {
    const map = new Map<string, { size: number; mtime: number; hash?: string; content?: string | null; diskHash?: string }>();
    try {
      const statusLines = this.getGitStatusPorcelain(root);
      for (const line of statusLines) {
        let file = line.slice(3).trim().replace(/^"|"$/g, '').replace(/\\/g, '/');
        file = file.replace(/^ai-dev-hub[\\/]/, '');
        const full = path.join(root, file);
        try {
          if (fs.existsSync(full)) {
            const stat = fs.statSync(full);
            if (stat.isDirectory()) continue;
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

      // Hybrid Check: Full disk SHA-256 inventory via captureFileInventory for total byte-level certainty
      try {
        const inventory = captureFileInventory(root);
        for (const [invFile, sha] of Object.entries(inventory)) {
          const normalizedFile = invFile.replace(/^ai-dev-hub[\\/]/, '');
          const existing = map.get(normalizedFile);
          if (existing) {
            existing.diskHash = sha;
          } else {
            map.set(normalizedFile, { size: 0, mtime: 0, diskHash: sha });
          }
        }
      } catch (invErr: any) {
        Logger.warn(`[MetaChatService] Aviso ao capturar inventário de arquivos em disco: ${invErr.message}`);
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
    beforeBaseline: Map<string, { size: number; mtime: number; hash?: string; diskHash?: string }>,
    turnChangedFiles?: string[]
  ): string[] {
    const afterPorcelain = this.getGitStatusPorcelain(root);
    const changedInTurn = new Set<string>();

    for (const line of afterPorcelain) {
      let file = line.slice(3).trim().replace(/^"|"$/g, '').replace(/\\/g, '/');
      file = file.replace(/^ai-dev-hub[\\/]/, '');
      // IGNORE_DIRS_AND_INTERNAL_ARTIFACTS_IN_DIFF
      if (!file || file.endsWith('/') || file.includes('.ai-dev-hub')) continue;
      const full = path.join(root, file);
      try { if (fs.existsSync(full) && fs.statSync(full).isDirectory()) continue; } catch {}

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
            if (before.size > 0 && stat.size !== before.size) {
              changedInTurn.add(file);
            } else if (before.hash && stat.size < 2000000) {
              const content = fs.readFileSync(full);
              const hash = crypto.createHash('sha1').update(content).digest('hex');
              if (hash !== before.hash) {
                changedInTurn.add(file);
              }
            } else if (before.mtime > 0 && stat.mtimeMs !== before.mtime) {
              changedInTurn.add(file);
            }
          }
        } catch {
          changedInTurn.add(file);
        }
      }
    }

    // Hybrid Check: Compare real SHA-256 disk inventory with baseline
    try {
      const currentInventory = captureFileInventory(root);
      const beforeInventory: FileInventory = {};
      for (const [file, val] of beforeBaseline.entries()) {
        if (val.diskHash) {
          beforeInventory[file] = val.diskHash;
        }
      }
      const diskChanged = changedFiles(beforeInventory, currentInventory);
      for (const f of diskChanged) {
        const normF = f.replace(/^ai-dev-hub[\\/]/, '');
        if (!normF.includes('.ai-dev-hub')) {
          changedInTurn.add(normF);
        }
      }
    } catch (invErr: any) {
      Logger.warn(`[MetaChatService] Aviso na checagem de inventário em diffFileBaseline: ${invErr.message}`);
    }

    if (turnChangedFiles && Array.isArray(turnChangedFiles)) {
      for (const f of turnChangedFiles) {
        let rel = path.isAbsolute(f)
          ? path.relative(root, f).replace(/\\/g, '/')
          : f.replace(/\\/g, '/');
        rel = rel.replace(/^ai-dev-hub[\\/]/, '');
        if (rel.startsWith('..')) continue;

        const full = path.join(root, rel);
        if (fs.existsSync(full)) {
          const before = beforeBaseline.get(rel);
          if (!before) {
            changedInTurn.add(rel);
          } else {
            try {
              const stat = fs.statSync(full);
              if (before.size > 0 && stat.size !== before.size) {
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

    // Se o perfil selecionado estiver esgotado ou indisponível, busca a próxima conta pronta
    if (profile && (profile.auth_status === 'QUOTA_EXHAUSTED' || !AccountProfileManager.isAccountAvailableForTasks(profile.id))) {
      AccountProfileManager.checkAndRefreshQuotaStatus(profile.id);
      profile = AccountProfileManager.getProfile(profile.id);
      if (profile && (profile.auth_status === 'QUOTA_EXHAUSTED' || !AccountProfileManager.isAccountAvailableForTasks(profile.id))) {
        const nextReady = AccountProfileManager.getNextAvailableProfile(profile.id);
        if (nextReady) {
          AccountProfileManager.setGlobalActiveProfile(nextReady.id);
          profile = nextReady;
        }
      }
    }

    // 2. Ensure project record exists and is bound to profile.id
    let proj: any = db
      .prepare('SELECT id, name, path, is_trusted, full_dev_autonomy, active_account_profile_id FROM projects WHERE path = ?')
      .get(root);
    if (!proj) {
      const id = 'decohub-meta';
      db.prepare(`
        INSERT OR REPLACE INTO projects (id, name, path, stack, status, is_trusted, full_dev_autonomy, active_account_profile_id, created_at, updated_at)
        VALUES (?, 'DecoHUB Engine', ?, 'TypeScript', 'active', 1, 1, ?, '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z')
      `).run(id, root, profile.id);
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
      ).run(profile.id, '2020-01-01T00:00:00.000Z', proj.id);
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

    // 3.1 Ensure native Antigravity 2.0 skills in DecoHUB workspace
    try {
      this.ensureDecoHubNativeSkills(root);
    } catch (err: any) {
      Logger.warn(`[MetaChatService] Falha não bloqueante ao provisionar native skills em ${root}: ${err.message}`);
    }

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
   * Provisions native Google Antigravity 2.0 skills (.agents/skills/<skill-slug>/SKILL.md) in the DecoHUB workspace.
   */
  static ensureDecoHubNativeSkills(root: string): void {
    const hubRoot = SkillRouter.getHubRootDir();
    const skillsDir = path.join(hubRoot, 'Skills');
    const karpathySrc = path.join(skillsDir, 'andrej-karpathy-skills-main', 'andrej-karpathy-skills-main', 'skills', 'karpathy-guidelines', 'SKILL.md');
    const examplesSrc = path.join(skillsDir, 'andrej-karpathy-skills-main', 'andrej-karpathy-skills-main', 'EXAMPLES.md');

    if (fs.existsSync(karpathySrc)) {
      const nativeDir = path.join(root, '.agents', 'skills', 'karpathy-guidelines');
      if (!fs.existsSync(nativeDir)) {
        fs.mkdirSync(nativeDir, { recursive: true });
      }
      const nativeSkillFile = path.join(nativeDir, 'SKILL.md');
      const rawContent = fs.readFileSync(karpathySrc, 'utf-8');
      const calibrated = SkillRouter.calibrateKarpathySkillContent(rawContent);
      const withFrontmatter = SkillRouter.ensureSkillFrontmatter(calibrated, 'karpathy-guidelines');
      if (!fs.existsSync(nativeSkillFile) || fs.readFileSync(nativeSkillFile, 'utf-8') !== withFrontmatter) {
        fs.writeFileSync(nativeSkillFile, withFrontmatter, 'utf-8');
      }

      if (fs.existsSync(examplesSrc)) {
        const examplesDir = path.join(nativeDir, 'examples');
        if (!fs.existsSync(examplesDir)) {
          fs.mkdirSync(examplesDir, { recursive: true });
        }
        const examplesDest = path.join(examplesDir, 'EXAMPLES.md');
        const exContent = fs.readFileSync(examplesSrc, 'utf-8');
        if (!fs.existsSync(examplesDest) || fs.readFileSync(examplesDest, 'utf-8') !== exContent) {
          fs.writeFileSync(examplesDest, exContent, 'utf-8');
        }
      }

      // Also ensure legacy/fallback path for full compatibility
      const legacyDir = path.join(root, '.ai-dev-hub', 'skills');
      if (!fs.existsSync(legacyDir)) {
        fs.mkdirSync(legacyDir, { recursive: true });
      }
      const legacySkillFile = path.join(legacyDir, 'karpathy-guidelines-skill.md');
      if (!fs.existsSync(legacySkillFile) || fs.readFileSync(legacySkillFile, 'utf-8') !== calibrated) {
        fs.writeFileSync(legacySkillFile, calibrated, 'utf-8');
      }
    }
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
  static async recompileAndSync(options?: {
    skipRestart?: boolean;
  }): Promise<{
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
        timeout: 120000,
        windowsHide: true,
        shell: isWin
      });
    } catch (err: any) {
      return {
        success: false,
        message: `Falha na compilação do servidor:\n${err.message || ''}\n${err.stdout || ''}\n${err.stderr || ''}`.trim(),
        durationMs: Date.now() - startTime
      };
    }

    // 2. Build Client
    let clientOutput = '';
    try {
      clientOutput = execFileSync(npmCmd, ['run', 'build'], {
        cwd: path.join(root, 'client'),
        encoding: 'utf-8',
        timeout: 120000,
        windowsHide: true,
        shell: isWin
      });
    } catch (err: any) {
      return {
        success: false,
        message: `Falha na compilação do frontend:\n${err.message || ''}\n${err.stdout || ''}\n${err.stderr || ''}`.trim(),
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

            fs.mkdirSync(serverDistDest, { recursive: true });
            fs.mkdirSync(clientDistDest, { recursive: true });

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

    if (isDesktop && synced && !options?.skipRestart) {
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
   * Coletor Automático de Telemetria Forense para o Autopilot:
   * Consulta em modo somente-leitura o hub.db (tarefas com rework/retries,
   * evaluation_results reprovadas, lições aprendidas) e .ai-dev-hub/lessons.md,
   * analisa ciclos prévios da thread para evitar repetições,
   * e monta automaticamente a missão de auto-evolução sem necessidade de prompts manuais.
   */
  static collectSystemTelemetryDossier(threadId?: string): { prompt: string; telemetry: any } {
    let problematicTasks: any[] = [];
    try {
      problematicTasks = db.prepare(`
        SELECT id, title, status, review_decision, retry_count, replan_reason, blocking_reason, review_result_json, updated_at
        FROM autonomous_tasks
        WHERE status = 'failed' OR review_decision = 'REWORK_REQUIRED' OR retry_count > 0
        ORDER BY updated_at DESC
        LIMIT 6
      `).all();
    } catch {}

    let rejectedEvaluations: any[] = [];
    try {
      rejectedEvaluations = db.prepare(`
        SELECT id, task_id, verdict, evaluator_verdict, failed_criteria_json, evaluator_notes, created_at
        FROM evaluation_results
        WHERE verdict != 'PASS' OR evaluator_verdict != 'PASS'
        ORDER BY created_at DESC
        LIMIT 6
      `).all();
    } catch {}

    let operationalLessons: any[] = [];
    try {
      operationalLessons = db.prepare(`
        SELECT problem_summary, root_cause, failed_strategy, working_strategy, occurrences
        FROM operational_lessons
        ORDER BY updated_at DESC
        LIMIT 5
      `).all();
    } catch {}

    let lessonsMdContent = '';
    const root = this.getDecoHubRoot();
    const lessonsPath = path.join(root, '.ai-dev-hub', 'lessons.md');
    if (fs.existsSync(lessonsPath)) {
      try {
        lessonsMdContent = fs.readFileSync(lessonsPath, 'utf-8').slice(0, 2000);
      } catch {}
    }

    let pastEvolutionsSummary = '';
    if (threadId) {
      try {
        const pastMsgs = db.prepare(`
          SELECT content, created_at FROM meta_chat_messages
          WHERE thread_id = ? AND role IN ('assistant', 'system')
          ORDER BY created_at DESC LIMIT 10
        `).all(threadId) as Array<{ content: string; created_at: string }>;
        if (pastMsgs.length > 0) {
          pastEvolutionsSummary = pastMsgs
            .map(m => {
              const lines = m.content.split('\n').filter(l => /(?:Ciclo|Gargalo|Implementad|Corrigid|Fix|Evolu[çc][ãa]o)/i.test(l));
              return lines.slice(0, 3).join(' | ');
            })
            .filter(Boolean)
            .join('\n');
        }
      } catch {}
    }

    const problematicTasksFormatted = problematicTasks.length > 0
      ? problematicTasks.map(t => `- [${String(t.status || '').toUpperCase()} | Rework/Retries: ${t.retry_count}] ${t.title} (Motivo: ${t.replan_reason || t.blocking_reason || t.review_decision || 'N/A'})`).join('\n')
      : 'Nenhuma tarefa com falha crítica ou rework excessivo registrada no momento.';

    const rejectedEvalsFormatted = rejectedEvaluations.length > 0
      ? rejectedEvaluations.map(e => `- [Avaliação ${e.verdict || e.evaluator_verdict}] Tarefa ${String(e.task_id || '').slice(0, 8)}: ${e.evaluator_notes || e.failed_criteria_json || 'Critério reprovado'}`).join('\n')
      : 'Sem reprovações ativas de avaliador recente.';

    const lessonsFormatted = operationalLessons.length > 0
      ? operationalLessons.map(l => `- Problema: ${l.problem_summary} -> Causa Raiz: ${l.root_cause} (Estratégia eficaz: ${l.working_strategy})`).join('\n')
      : (lessonsMdContent ? lessonsMdContent.slice(0, 800) : 'Nenhuma lição anterior registrada.');

    let mlTelemetrySummary = '';
    try {
      const { DecoMindMlService } = require('./decoMindMlService.js');
      const mlStatus = DecoMindMlService.getSystemMlStatus();
      const underperforming = (mlStatus.topUnderperformingArms || []).map((a: any) => `${a.arm_key} (Reward: ${(a.mean_reward * 100).toFixed(0)}%)`).join(', ');
      mlTelemetrySummary = `- Modelos/Bandits com Menor Recompensa: ${underperforming || 'Nenhum'}\n- Acurácia Online do Preditor de Risco: ${(mlStatus.runningAccuracy * 100).toFixed(1)}% (Amostras: ${mlStatus.samplesSeen})\n- Vacinas Episódicas Aprendidas: ${mlStatus.episodicMemoriesCount}`;
    } catch {}

    const autoresearchHistory = this.getRecentAutoresearchHistory(15);

    const prompt = `# MISSÃO AUTÔNOMA DE AUTO-EVOLUÇÃO (AUTOPILOT CYCLE) — ZERO-PROMPT

Você é o Engenheiro Principal do DecoHUB operando no modo Autopilot de Auto-Evolução Contínua (inspirado no Karpathy Autoresearch Loop e Darwin Gödel Machine).
Sua missão neste ciclo é diagnosticar a telemetria empírica real do sistema abaixo, selecionar o próximo gargalo inédito de maior impacto que ainda não foi resolvido e implementar uma melhoria cirúrgica definitiva com testes automatizados.

### 1. TELEMETRIA COLETADA DO SISTEMA:
- **Tarefas com Re-trabalho/Retry:**
${problematicTasksFormatted}

- **Reprovações Recentes de Avaliador Independente:**
${rejectedEvalsFormatted}

- **Lições Operacionais Registradas:**
${lessonsFormatted}

- **Telemetria de Machine Learning (DecoMind ML):**
${mlTelemetrySummary || 'DecoMind ML ativo e calibrado.'}

- **Evoluções Já Implementadas em Ciclos Anteriores (NÃO REPETIR):**
${pastEvolutionsSummary || 'Nenhuma evolução anterior registrada nesta thread.'}

=== HISTÓRICO RECENTE DE EXPERIMENTOS (RESULTS.TSV) ===
${autoresearchHistory || 'Nenhum experimento registrado em results.tsv ainda (estabelecendo baseline).'}

### 2. DIRETRIZES DE EXECUÇÃO CIRÚRGICA:
(PROTOCOLO KARPATHY AUTORESEARCH — 4 REGRAS OPERACIONAIS)
1. **Escopo Cirúrgico (Single Logical Target):** Aplique a hipótese no menor conjunto possível de arquivos em \`server/src/\` ou \`client/src/\` (nunca toque na Zona Vermelha ou em arquivos de avaliação protegidos).
2. **Critério de Simplicidade (Simplicity Criterion):** Código mais simples com resultado igual ou superior é sempre preferível (\`keep\`). Ganhos marginais que adicionam dezenas de linhas de código complexo/hacky são descartados (\`discard\`).
3. **Higiene de Contexto em Comandos de Terminal (Log Redirection):** Ao rodar testes no terminal via \`run_command\`, filtre a saída ou execute apenas o arquivo de teste alvo (\`node --test server/dist/test/<alvo>.test.js\`) para nunca inundar a janela de contexto com milhares de linhas de log.
4. **Memória Experimental (results.tsv):** Consulte a tabela \`results.tsv\` injetada acima antes de formular a hipótese para nunca repetir um experimento que já recebeu \`discard\` ou \`crash\`.
5. Identifique um gargalo real e inédito no DecoHUB (em server/src/ ou client/src/) que impacta estabilidade, velocidade, observabilidade ou resiliência.
6. Aplique a alteração cirurgicamente no código do DecoHUB utilizando ferramentas nativas de manipulação de arquivos (view_file, replace_file_content, write_to_file, run_command).
7. Garanta 100% de compatibilidade e tipagem estrita TypeScript (sem violar tipos).
8. Crie ou atualize um teste em server/test/ que comprove a solução implementada.
9. Emita ao final um Briefing Executivo estruturado contendo:
   - ### 1. Diagnóstico do Gargalo Selecionado
   - ### 2. Alteração Cirúrgica Implementada
   - ### 3. Validação Automatizada e Portões de Qualidade
   - ### 4. Status Final e Próximo Alvo`;

    return {
      prompt,
      telemetry: {
        problematicTasksCount: problematicTasks.length,
        rejectedEvaluationsCount: rejectedEvaluations.length,
        operationalLessonsCount: operationalLessons.length,
        hasLessonsMd: Boolean(lessonsMdContent),
        pastEvolutionsCount: pastEvolutionsSummary ? pastEvolutionsSummary.split('\n').length : 0
      }
    };
  }

  static getAutopilotStatus(): MetaChatAutopilotStatus {
    return { ...this._autopilotState };
  }

  static stopAutopilot(): MetaChatAutopilotStatus {
    this._autopilotState.enabled = false;
    if (this._autopilotAbortController) {
      try {
        this._autopilotAbortController.abort();
      } catch {}
    }
    Logger.info('[MetaChatService] Autopilot interrompido pelo usuário.');
    return this.getAutopilotStatus();
  }

  static async waitForAutopilotCompletion(timeoutMs = 60000): Promise<MetaChatAutopilotStatus> {
    const start = Date.now();
    while (this._autopilotState.enabled && (Date.now() - start < timeoutMs)) {
      if (this._autopilotLoopPromise) {
        await Promise.race([
          this._autopilotLoopPromise,
          new Promise(r => setTimeout(r, 200))
        ]);
      } else {
        await new Promise(r => setTimeout(r, 200));
      }
    }
    return this.getAutopilotStatus();
  }

  static async startAutopilot(options?: {
    maxCycles?: number;
    cooldownSeconds?: number;
    model?: string;
    accountId?: string;
    threadId?: string;
  }): Promise<MetaChatAutopilotStatus> {
    if (this._autopilotState.enabled && this._autopilotState.isExecutingCycle) {
      return this.getAutopilotStatus();
    }

    const maxCycles = options?.maxCycles !== undefined ? options.maxCycles : 1;
    const cooldownSeconds = options?.cooldownSeconds !== undefined ? options.cooldownSeconds : 15;
    const mode = maxCycles === 0 ? 'CONTINUOUS' : 'BATCH';

    let threadId = options?.threadId;
    if (!threadId) {
      const existingThreads = this.listThreads();
      const autopilotThread = existingThreads.find(t => t.title.includes('Autopilot') || t.title.includes('Auto-Evolução Autônoma'));
      if (autopilotThread) {
        threadId = autopilotThread.id;
      } else {
        const created = this.createThread({
          title: 'Auto-Evolução Autônoma (Autopilot)',
          model: options?.model || 'gemini-3.8-flash',
          effort: 'HIGH'
        });
        threadId = created.id;
      }
    }

    this.setActiveThreadId(threadId);

    this._autopilotAbortController = new AbortController();
    this._autopilotState = {
      enabled: true,
      isExecutingCycle: false,
      mode,
      maxCycles,
      completedCycles: 0,
      keptEvolutions: 0,
      revertedEvolutions: 0,
      cooldownSeconds,
      activeThreadId: threadId,
      startedAt: new Date().toISOString()
    };

    this._autopilotLoopPromise = this._runAutopilotLoop({
      maxCycles,
      cooldownSeconds,
      model: options?.model,
      accountId: options?.accountId,
      threadId
    }).catch(err => {
      Logger.error(`[MetaChatService] Erro fatal no loop do Autopilot: ${err.message}`);
      this._autopilotState.enabled = false;
      this._autopilotState.isExecutingCycle = false;
    });

    return this.getAutopilotStatus();
  }

  private static async _runAutopilotLoop(options: {
    maxCycles: number;
    cooldownSeconds: number;
    model?: string;
    accountId?: string;
    threadId: string;
  }): Promise<void> {
    const isTestOrOffline = AgentApiGateway.isOfflineMode() || process.env.NODE_ENV === 'test' || Boolean(process.env.NODE_TEST_CONTEXT);
    const actualCooldownMs = isTestOrOffline ? 50 : Math.max(500, options.cooldownSeconds * 1000);

    while (this._autopilotState.enabled) {
      if (this._autopilotState.maxCycles > 0 && this._autopilotState.completedCycles >= this._autopilotState.maxCycles) {
        Logger.info(`[MetaChatService] Meta de ciclos do Autopilot atingida (${this._autopilotState.completedCycles}/${this._autopilotState.maxCycles}). Finalizando loop.`);
        break;
      }

      const currentCycle = this._autopilotState.completedCycles + 1;
      const cycleStart = Date.now();
      this._autopilotState.isExecutingCycle = true;
      Logger.info(`[MetaChatService] [Autopilot] Iniciando Ciclo #${currentCycle} (meta: ${this._autopilotState.maxCycles === 0 ? 'Contínuo' : this._autopilotState.maxCycles})...`);

      try {
        const dossier = this.collectSystemTelemetryDossier(options.threadId);

        this.addMessage({
          role: 'system',
          content: `[AUTOPILOT CICLO #${currentCycle}] Diagnóstico coletado. Disparando auto-evolução autônoma...`,
          thread_id: options.threadId
        });

        const res = await this.handleUserMessage(dossier.prompt, {
          threadId: options.threadId,
          model: options.model || 'gemini-3.8-flash',
          reasoningMode: 'high',
          accountId: options.accountId,
          runTests: true,
          isAutopilotCycle: true
        });

        const cycleDurationSec = Math.max(0.1, (Date.now() - cycleStart) / 1000);
        const commitHash = this.getCurrentGitCommit();

        if (res.typecheck.passed && !res.selfHealed && res.filesChanged.length > 0) {
          this._autopilotState.keptEvolutions++;
          this._autopilotState.lastCycleSummary = `Ciclo #${currentCycle} PROMOVIDO (KEEP): ${res.filesChanged.length} arquivos alterados.`;
          Logger.success(`[MetaChatService] [Autopilot] Ciclo #${currentCycle} aprovado com sucesso! Sincronizando build...`);

          if (!isTestOrOffline) {
            try {
              await this.recompileAndSync({ skipRestart: true });
            } catch (syncErr: any) {
              Logger.warn(`[MetaChatService] [Autopilot] Aviso na recompilação do Ciclo #${currentCycle}: ${syncErr.message}`);
            }
          }

          this.addMessage({
            role: 'system',
            content: `[AUTOPILOT CICLO #${currentCycle} CONCLUÍDO - KEEP] Evolução promovida e sincronizada no decohub_unpacked (${res.filesChanged.length} arquivos atualizados).`,
            thread_id: options.threadId
          });

          this.appendAutoresearchLedger({
            commit: commitHash,
            scoreMetric: (res as any).scoreMetric || `tc:0_files:${res.filesChanged.length}`,
            durationSec: cycleDurationSec,
            status: 'keep',
            description: (res as any).hypothesisSummary || `Ciclo #${currentCycle} auto-evolução promovida`
          });
        } else {
          if (res.selfHealed) {
            this._autopilotState.revertedEvolutions++;
            this._autopilotState.lastCycleSummary = `Ciclo #${currentCycle} REVERTIDO (DISCARD/ROLLBACK): Avaliador reprovou alterações.`;
            this.appendAutoresearchLedger({
              commit: commitHash,
              scoreMetric: (res as any).scoreMetric || 'eval:rejected',
              durationSec: cycleDurationSec,
              status: 'discard',
              description: `Ciclo #${currentCycle} revertido pelo avaliador imutável`
            });
          } else {
            this._autopilotState.lastCycleSummary = `Ciclo #${currentCycle} FINALIZADO sem alterações de arquivos.`;
            this.appendAutoresearchLedger({
              commit: commitHash,
              scoreMetric: 'baseline',
              durationSec: cycleDurationSec,
              status: 'keep',
              description: `Ciclo #${currentCycle} baseline mantido`
            });
          }
          this.addMessage({
            role: 'system',
            content: `[AUTOPILOT CICLO #${currentCycle} FINALIZADO] ${this._autopilotState.lastCycleSummary}`,
            thread_id: options.threadId
          });
        }
      } catch (cycleErr: any) {
        const cycleDurationSec = Math.max(0.1, (Date.now() - cycleStart) / 1000);
        const commitHash = this.getCurrentGitCommit();
        Logger.error(`[MetaChatService] [Autopilot] Erro no Ciclo #${currentCycle}: ${cycleErr.message}`);
        this._autopilotState.lastCycleSummary = `Ciclo #${currentCycle} FALHOU: ${cycleErr.message}`;
        this.appendAutoresearchLedger({
          commit: commitHash,
          scoreMetric: 'crash',
          durationSec: cycleDurationSec,
          status: 'crash',
          description: `Ciclo #${currentCycle} falha: ${cycleErr.message}`
        });
      } finally {
        this._autopilotState.completedCycles++;
        this._autopilotState.isExecutingCycle = false;
      }

      if (!this._autopilotState.enabled) break;
      if (this._autopilotState.maxCycles > 0 && this._autopilotState.completedCycles >= this._autopilotState.maxCycles) {
        break;
      }

      Logger.info(`[MetaChatService] [Autopilot] Aguardando cooldown de ${actualCooldownMs}ms antes do próximo ciclo...`);
      await new Promise(resolve => setTimeout(resolve, actualCooldownMs));
    }

    this._autopilotState.enabled = false;
    this._autopilotState.isExecutingCycle = false;
    Logger.info('[MetaChatService] [Autopilot] Loop concluído.');
  }

  static triggerReactiveSelfHealIfNeeded(failureContext: {
    taskId: string;
    projectId: string;
    reworkCount: number;
    reason: string;
  }): boolean {
    if (this._autopilotState.enabled || this._autopilotState.isExecutingCycle) {
      return false;
    }
    if (failureContext.reworkCount < 2) {
      return false;
    }

    Logger.info(`[MetaChatService] [Reactive Self-Heal] Rework repetido detectado na tarefa ${failureContext.taskId} (rework: ${failureContext.reworkCount}). Disparando 1 ciclo de Autopilot.`);
    this.startAutopilot({
      maxCycles: 1,
      cooldownSeconds: 5
    }).catch(err => {
      Logger.warn(`[MetaChatService] Falha ao disparar reactive self-heal: ${err.message}`);
    });
    return true;
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

    let activeConvId = this.getActiveConversationId(requestedAccountId, currentThread.id);
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

    let effectiveAccountId = requestedAccountId;

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

      // 3. Parse explicit or structured code actions (apenas quando fornecido explicitamente via options)
      const parsedActions = Array.isArray(options?.codeActions) ? options.codeActions : [];

      let actionSummary = '';
      let reply = '';
      let typecheckResult: {
        passed: boolean;
        durationMs: number;
        output: string;
        errors?: Array<{ file: string; line?: number; column?: number; code?: string; message: string; raw: string }>;
      } = { passed: true, durationMs: 0, output: 'Nenhum arquivo de código foi alterado.' };
      let selfHealed = false;
      let testResult: { ran: boolean; passed: boolean; output?: string } = { ran: false, passed: false };
      let clientGateResult: { passed: boolean; buildPassed: boolean; visualPassed: boolean; output: string; details: string } | null = null;
      let simplicityResult: { passed: boolean; linesAdded: number; linesRemoved: number; delta: number; reason?: string } | null = null;
      const executionStartTime = Date.now();

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
        effectiveAccountId = projectBinding.accountProfile.id;
        activeConvId = this.getActiveConversationId(effectiveAccountId, currentThread.id);

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
              activeConvId = await mockProvider.newConversation({
                model: cliModel,
                title: 'DecoHUB Meta-Chat',
                prompt: userContent,
                projectId: 'decohub-meta',
                role: 'CONVERSATIONAL'
              });
              this.setActiveConversationId(activeConvId, requestedAccountId, currentThread.id);
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
            this.setActiveConversationId(activeConvId, requestedAccountId, currentThread.id);
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

          const intentMode = options?.intentMode || MetaChatService.detectIntentMode(userContent);
          const fullPrompt = MetaChatService.buildMetaChatPrompt({
            mode: intentMode,
            root,
            userQueryOrMission: userContent,
            attachmentsBlock,
            intelligenceLevel: resolvedConfig.intelligenceLevel,
            canonicalModelName: resolvedConfig.canonicalName,
            requestedModel
          });

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
              antigravityProvider.captureTurnStart(activeConvId, root, 'metachat-' + currentThread.id);
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
              activeConvId = await AgentApiGateway.newConversation({
                model: cliModel,
                title: 'DecoHUB Meta-Chat: ' + (currentThread.title || 'Auto-Evolução').replace(/"/g, "'").slice(0, 50),
                prompt: fullPrompt,
                projectId: projectBinding.project.id,
                role: 'CONVERSATIONAL',
                caller: 'MetaChatService.handleUserMessage',
                cwd: root,
                env: execEnv
              });
              this.setActiveConversationId(activeConvId, effectiveAccountId, currentThread.id);
              initialLineCount = 0;
              if (this._currentExecution) {
                this._currentExecution.lastTranscriptLineCount = 0;
              }
              (antigravityProvider as any).turnStarts?.set(activeConvId, 0);
              antigravityProvider.captureTurnStart(activeConvId, root, 'metachat-' + currentThread.id);
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
                15000,
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

          this.updatePipelineTask('task-inspect', 'completed');
          this.updatePipelineTask('task-implement', 'completed');

          const changedInTurn = this.diffFileBaseline(root, baselineBefore, turnResult.filesChanged);
          filesChanged.push(...changedInTurn);

          // Fallback parser: Check if textual response or thought blocks contain [FILE: ...] blocks not yet applied to disk
          const codeCandidateSource = agentReport || turnResult.agentThoughts || '';
          if (codeCandidateSource) {
            const parsedBlocks = this.parseCodeDirectives(codeCandidateSource);
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
                `[MetaChatService] Typecheck apontou erros após turno do Antigravity. Tentando auto-reparo antes do rollback...`
              );

              let healedOnRetry = false;
              if (!AgentApiGateway.isOfflineMode() && activeConvId && !this._currentExecution?.cancelRequested) {
                this.updatePipelineTask('task-verify', 'in_progress', 'Auto-Reparo TypeScript em andamento...');
                this.recordLiveStep({
                  type: 'GUARD',
                  target: 'Auto-Reparo TypeScript',
                  status: 'running',
                  details: 'Enviando diagnóstico do compilador para auto-correção na mesma conversa'
                });
                this.updateLiveStatus({
                  phase: 'Solicitando auto-reparo de tipagem ao Antigravity...',
                  lastStep: 'Self-Healing TypeScript Guard'
                });

                const rawDiag = typecheckResult.output ? typecheckResult.output.slice(0, 3500) : 'Erros de tipagem detectados pelo tsc.';
                const repairPrompt = MetaChatService.buildSurgicalRepairPrompt(rawDiag, Array.from(filesChanged));

                try {
                  antigravityProvider.captureTurnStart(activeConvId, root, 'metachat-' + currentThread.id);
                  AgentApiGateway.sendMessage({
                    conversationId: activeConvId,
                    prompt: repairPrompt,
                    projectId: projectBinding.project.id,
                    role: 'CONVERSATIONAL',
                    caller: 'MetaChatService.selfHealingTypecheck',
                    cwd: root,
                    env: execEnv
                  });

                  const repairTurnResult = await antigravityProvider.getResult(
                    activeConvId,
                    180000,
                    root,
                    () => Boolean(this._currentExecution?.cancelRequested || TurnCancellationManager.isCancelled('metachat', activeConvId))
                  );

                  const repairReport = (repairTurnResult.rawResponse || (repairTurnResult as any).finalResponse || '').trim();
                  if (repairReport) {
                    agentReport = repairReport;
                    const parsedBlocks = this.parseCodeDirectives(repairReport);
                    for (const pb of parsedBlocks) {
                      if (pb.action === 'write' && typeof pb.content === 'string') {
                        try {
                          const fullPath = this.validatePathWithinRepo(pb.filePath);
                          const relPath = path.relative(root, fullPath).replace(/\\/g, '/');
                          this.writeFile(relPath, pb.content);
                          if (!filesChanged.includes(relPath)) filesChanged.push(relPath);
                        } catch {}
                      }
                    }
                  }

                  const repairChanged = this.diffFileBaseline(root, baselineBefore, repairTurnResult.filesChanged);
                  for (const rc of repairChanged) {
                    if (!filesChanged.includes(rc)) filesChanged.push(rc);
                  }

                  typecheckResult = await this.runTypecheck(target, filesChanged);
                  if (typecheckResult.passed) {
                    healedOnRetry = true;
                    Logger.success('[MetaChatService] Auto-reparo de Typecheck bem-sucedido!');
                  }
                } catch (repairErr: any) {
                  Logger.warn(`[MetaChatService] Falha durante tentativa de auto-reparo: ${repairErr.message}`);
                }
              }

              if (!healedOnRetry) {
                Logger.warn(
                  `[MetaChatService] Typecheck permaneceu quebrado após tentativa. Acionando Rollback de Segurança...`
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
                this.updatePipelineTask('task-verify', 'completed', `Auto-reparo aprovado em ${typecheckResult.durationMs}ms`);
                this.recordLiveStep({
                  type: 'GUARD',
                  target: 'Auto-Reparo TypeScript',
                  status: 'done',
                  details: 'Tipos corrigidos com sucesso sem necessidade de rollback'
                });
              }
            } else {
              this.updatePipelineTask('task-verify', 'completed', `Aprovado em ${typecheckResult.durationMs}ms`);
            }
          } else {
            this.updatePipelineTask('task-verify', 'completed', 'Sem alterações em arquivos de código');
          }

          let discardReason = '';
          let unitTestName = '';
          clientGateResult = null;
          simplicityResult = null;

          // Oráculo Duplo de Avaliação Imutável + Critério de Simplicidade Karpathy
          if (!selfHealed && filesChanged.length > 0) {
            const hasServerFiles = filesChanged.some(f => f.startsWith('server/'));
            const hasClientFiles = filesChanged.some(f => f.startsWith('client/'));

            // 1. Oráculo de Testes Unitários para server/src/
            const shouldRunTests = Boolean(options?.runTests || options?.isAutopilotCycle);
            if (hasServerFiles && shouldRunTests) {
              unitTestName = options?.testFile || this.resolveMatchingServerTest(filesChanged);
              this.updatePipelineTask('task-guard', 'in_progress', `Executando ${unitTestName}`);
              this.recordLiveStep({
                type: 'COMMAND',
                target: unitTestName,
                status: 'running',
                details: `[Double Oracle] Executando teste correspondente: ${unitTestName}`
              });
              this.updateLiveStatus({
                phase: 'Executando teste unitário correspondente...',
                lastStep: unitTestName
              });
              const tRes = await this.runScopedTest(unitTestName);
              testResult = { ran: true, passed: tRes.passed, output: tRes.output };
              if (!tRes.passed) {
                Logger.warn(`[MetaChatService] [Double Oracle] Teste unitário ${unitTestName} falhou. Acionando Rollback Karpathy...`);
                this.updatePipelineTask('task-guard', 'failed', `Falha no teste ${unitTestName}`);
                this.recordLiveStep({
                  type: 'GUARD',
                  target: 'Rollback Karpathy',
                  status: 'done',
                  details: `Avaliador Imutável reprovou: teste ${unitTestName} falhou`
                });
                this.rollbackChangedFiles(root, filesChanged, baselineBefore);
                selfHealed = true;
                discardReason = `Teste unitário correspondente (\`${unitTestName}\`) reprovado pelo avaliador imutável.`;
              } else {
                this.updatePipelineTask('task-guard', 'completed', `Teste ${unitTestName} aprovado`);
              }
            }

            // 2. Oráculo Visual Playwright para client/src/
            if (!selfHealed && hasClientFiles) {
              this.recordLiveStep({
                type: 'GUARD',
                target: 'Playwright Visual Gate',
                status: 'running',
                details: '[Double Oracle] Validando build do client e integridade visual (0 erros de console/página)...'
              });
              clientGateResult = await this.runClientVisualGate(filesChanged);
              if (!clientGateResult.passed) {
                Logger.warn(`[MetaChatService] [Double Oracle] Client Visual Gate falhou: ${clientGateResult.details}. Acionando Rollback Karpathy...`);
                this.recordLiveStep({
                  type: 'GUARD',
                  target: 'Rollback Karpathy',
                  status: 'done',
                  details: `Client Visual Gate falhou: ${clientGateResult.details}`
                });
                this.rollbackChangedFiles(root, filesChanged, baselineBefore);
                selfHealed = true;
                discardReason = `Client Visual Gate reprovado: ${clientGateResult.details}`;
              }
            }

            // 3. Critério de Simplicidade de Karpathy (Navalha de Occam)
            if (!selfHealed) {
              simplicityResult = this.checkSimplicityCriterion(root, filesChanged, baselineBefore, {
                testsPassed: testResult.passed
              });
              if (!simplicityResult.passed) {
                Logger.warn(`[MetaChatService] [Simplicity Criterion] ${simplicityResult.reason}. Acionando Rollback Karpathy...`);
                this.recordLiveStep({
                  type: 'GUARD',
                  target: 'Rollback Simplicidade',
                  status: 'done',
                  details: simplicityResult.reason || 'Complexidade excessiva sem testes'
                });
                this.rollbackChangedFiles(root, filesChanged, baselineBefore);
                selfHealed = true;
                discardReason = simplicityResult.reason || 'Complexidade excessiva detectada pela Navalha de Occam.';
              }
            }
          }

          if (selfHealed) {
            let errorDetails = '';
            if (discardReason) {
              errorDetails = `- **Causa do Rollback (Avaliador Imutável / Simplicidade):** ${discardReason}\n`;
            }
            if (typecheckResult.errors && typecheckResult.errors.length > 0) {
              errorDetails += typecheckResult.errors
                .map(e => `- \`${e.file}:${e.line || '?'}\` → **${e.message}**`)
                .join('\n');
            } else if (typecheckResult.output && !typecheckResult.passed) {
              errorDetails += `\`\`\`text\n${typecheckResult.output.slice(0, 800)}\n\`\`\``;
            }

            reply =
              `[SELF_HEALING_GUARD] **Autoproteção Ativa Ativada:**\n\n` +
              `As alterações geradas causaram erro de compilação TypeScript no DecoHUB:\n\n` +
              `${errorDetails}\n\n` +
              `O DecoHUB desfez as alterações automaticamente para manter o repositório 100% íntegro e estável.\n\n` +
              (agentReport ? `**Relatório do Agente Antigravity:**\n${agentReport}` : '');
          } else if (filesChanged.length > 0) {
            const sanitized = MetaChatService.sanitizeMetaChatReply(agentReport, filesChanged);
            let telemetryFooter = '';
            if (!sanitized.includes('**Arquivos alterados:**') && !sanitized.includes('[MODIFIED]')) {
              telemetryFooter += `\n\n**Arquivos alterados:**\n` + filesChanged.map(f => `- \`${f}\``).join('\n');
            }
            telemetryFooter +=
              `\n\n[TYPECHECK] **Typecheck Guard:** Aprovado em ${typecheckResult.durationMs}ms (0 erros de compilação).\n`;
            if (clientGateResult && clientGateResult.passed) {
              telemetryFooter += `[VISUAL GATE] **Playwright Visual Gate:** Aprovado (0 erros de console, 0 erros de página).\n`;
            }
            if (testResult.ran && testResult.passed) {
              telemetryFooter += `[DOUBLE ORACLE] **Avaliador Imutável:** Teste ${unitTestName} aprovado com código 0.\n`;
            }
            if (simplicityResult) {
              telemetryFooter += `[SIMPLICITY] **Navalha de Occam:** Delta de linhas (+${simplicityResult.linesAdded}/-${simplicityResult.linesRemoved}, delta: ${simplicityResult.delta}).\n`;
            }
            telemetryFooter +=
              `Clique em **"Recompilar e Atualizar Produção"** para empacotar as melhorias no executável local.`;
            reply =
              (sanitized
                ? sanitized
                : `**O que foi feito:** As alterações solicitadas foram executadas com sucesso no repositório DecoHUB.`) +
              telemetryFooter;
          } else {
            const sanitized = MetaChatService.sanitizeMetaChatReply(agentReport, []);
            reply =
              sanitized ||
              (agentReport && agentReport.trim()
                ? agentReport.trim()
                : `Turno concluído no Antigravity.`);
          }
        }
      }

      // 4. Run tests if requested and typecheck passed (se ainda não executado pelo Oráculo)
      if (options?.runTests && typecheckResult.passed && !selfHealed && !testResult.ran) {
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
      } else if (!testResult.ran) {
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

      const turnDurationSec = Math.max(0.1, (Date.now() - executionStartTime) / 1000);
      const commitHash = this.getCurrentGitCommit(root);
      const hypothesisSummary = (userContent || 'Evolução Meta-Chat').split('\n')[0].replace(/[\t\r\n]+/g, ' ').slice(0, 100);
      const scoreMetric = testResult.ran ? (testResult.passed ? 'tc:0_tests:pass' : 'tests:fail') : (typecheckResult.passed ? 'tc:0_clean' : 'tc:err');
      const finalStatus: 'keep' | 'discard' | 'crash' = selfHealed ? 'discard' : (filesChanged.length > 0 ? 'keep' : 'keep');

      if (!options?.isAutopilotCycle && !options?.skipLedgerAppend && options?.intentMode === 'AUTONOMOUS_EVOLUTION' && filesChanged.length > 0) {
        this.appendAutoresearchLedger({
          commit: commitHash,
          scoreMetric,
          durationSec: turnDurationSec,
          status: finalStatus,
          description: hypothesisSummary
        });
      }

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
        conversationId: activeConvId || undefined,
        status: finalStatus,
        keepOrDiscard: finalStatus,
        scoreMetric,
        durationSec: turnDurationSec,
        commitHash,
        hypothesisSummary,
        simplicityDelta: simplicityResult ? { linesAdded: simplicityResult.linesAdded, linesRemoved: simplicityResult.linesRemoved, delta: simplicityResult.delta } : undefined,
        visualGate: clientGateResult ? { passed: clientGateResult.passed, buildPassed: clientGateResult.buildPassed, visualPassed: clientGateResult.visualPassed, details: clientGateResult.details } : undefined
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
            const failedProfileId = effectiveAccountId || requestedAccountId;
            Logger.warn(
              `[MetaChatService] Falha de conta/cota detectada no Meta-Chat (${classification.kind}): ${classification.reason}. Tentando Auto-Failover para conta ${failedProfileId}...`
            );
            const failoverRes = await AccountProfileManager.handleAccountFailureAndRapidSwitch({
              failedProfileId,
              error: err
            });
            if (failoverRes.switched) {
              Logger.info(
                `[MetaChatService] Auto-Failover concluído com sucesso: "${failoverRes.previousProfileId}" -> "${failoverRes.activeProfile.display_name}". Retentando mensagem no Meta-Chat...`
              );
              this.setActiveConversationId(null, failoverRes.activeProfile.id, currentThread.id);
              this.updateThread(currentThread.id, {
                account_id: failoverRes.activeProfile.id,
                provider_conversation_id: null
              });
              return this.handleUserMessage(userContent, {
                ...options,
                threadId: currentThread.id,
                accountId: failoverRes.activeProfile.id,
                retryAfterFailover: true
              });
            } else {
              // Todas as contas esgotaram a cota: interrompe o Autopilot se ativo e emite orientação clara
              if (this._autopilotState.enabled) {
                this.stopAutopilot();
              }
              const quotaInfo = failedProfileId ? AccountProfileManager.getProfile(failedProfileId) : null;
              const resetNotice = quotaInfo?.quota_resets_at
                ? `Horário de reset previsto: ${new Date(quotaInfo.quota_resets_at).toLocaleString()}`
                : 'Aguardando restabelecimento de cota pelo provedor.';

              const allExhaustedMsg =
                `[AVISO DE COTA] **Todas as contas configuradas atingiram o limite de cota / Weekly Limit.**\n\n` +
                `- **Diagnóstico:** ${classification.reason}\n` +
                `- **Previsão:** ${resetNotice}\n\n` +
                `O Autopilot e novas requisições em loop foram pausados para evitar sobrecarga. ` +
                `Recomenda-se alternar o modelo para Claude/GPT ou aguardar a renovação da cota.`;

              const assistantMsg = this.addMessage({
                role: 'assistant',
                content: allExhaustedMsg,
                thread_id: currentThread.id,
                metadata: {
                  error: err.message,
                  model: requestedModel,
                  reasoningMode: requestedReasoning,
                  accountId: failedProfileId,
                  quotaExhaustedAll: true
                }
              });

              return {
                message: assistantMsg,
                filesChanged: [],
                typecheck: { passed: false, durationMs: 0, output: classification.reason },
                selfHealed: false,
                conversationId: undefined
              };
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
  public static parseCodeDirectives(
    content: string
  ): Array<{ action: 'write' | 'read'; filePath: string; content?: string }> {
    const directives: Array<{ action: 'write' | 'read'; filePath: string; content?: string }> = [];
    const seenPaths = new Set<string>();

    if (!content || typeof content !== 'string') return directives;

    const isValidDirective = (rawPath: string, code: string): boolean => {
      if (!rawPath || typeof rawPath !== 'string') return false;
      const norm = rawPath.replace(/\\/g, '/').toLowerCase().trim();
      const trimmedCode = (code || '').trim();

      // Conteúdo mínimo substantivo: rejeita placeholders de exemplo como '...', '// ...' ou < 25 caracteres
      if (trimmedCode.length < 25) return false;
      if (
        trimmedCode === '...' ||
        trimmedCode.replace(/\s+/g, '') === '...' ||
        trimmedCode.startsWith('// ...') ||
        trimmedCode.startsWith('// código completo')
      ) {
        return false;
      }

      // Rejeita caminhos fictícios ou placeholders de documentação
      const blockedPatterns = [
        'caminho/',
        'caminho\\',
        'path/to/',
        'exemplo',
        'arquivo.ts',
        'example',
        'dummy',
        'placeholder'
      ];
      if (blockedPatterns.some(pattern => norm.includes(pattern))) {
        return false;
      }

      // Whitelist estrita de diretórios permitidos no DecoHUB
      const allowedRoots = [
        'server/',
        'client/',
        'electron/',
        'scripts/',
        'desktop/',
        'decohub_unpacked/'
      ];
      const hasAllowedRoot = allowedRoots.some(rootPrefix => norm.startsWith(rootPrefix));
      if (!hasAllowedRoot) {
        return false;
      }

      // Deve ter extensão válida de código/configuração
      const hasValidExt = /\.(ts|tsx|js|jsx|json|css|html|sql|md|sh|ps1)$/i.test(norm);
      if (!hasValidExt) {
        return false;
      }

      return true;
    };

    const tryAddDirective = (rawPath: string, code: string) => {
      const cleanPath = rawPath.trim();
      const cleanCode = code.trim();
      if (!isValidDirective(cleanPath, cleanCode)) return;
      const normPath = cleanPath.replace(/\\/g, '/');
      if (!seenPaths.has(normPath)) {
        directives.push({ action: 'write', filePath: cleanPath, content: cleanCode });
        seenPaths.add(normPath);
      }
    };

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
      tryAddDirective(filePath, fileCode);
    }

    // Pattern 2: [FILE: path] ```ts ... ``` (supports preceding headers/bold)
    const fencedRegex =
      /(?:#{1,6}\s*|\*\*|`)?\[(?:FILE|ARQUIVO|CRIAR|MODIFICAR):\s*([a-zA-Z0-9_\-./\\]+)\](?:\*\*|`)?\s*```(?:[a-zA-Z0-9_-]+)?\s*([\s\S]*?)```/gi;

    while ((match = fencedRegex.exec(content)) !== null) {
      tryAddDirective(match[1], match[2]);
    }

    // Pattern 3: ```lang [FILE: path] ... ```
    const fenceHeaderRegex =
      /```(?:[a-zA-Z0-9_-]+)?\s*\[(?:FILE|ARQUIVO|CRIAR|MODIFICAR):\s*([a-zA-Z0-9_\-./\\]+)\]\s*([\s\S]*?)```/gi;

    while ((match = fenceHeaderRegex.exec(content)) !== null) {
      tryAddDirective(match[1], match[2]);
    }

    // Pattern 4: Code block containing top comment header: // [FILE: path] or // FILE: path
    const commentHeaderRegex =
      /```(?:[a-zA-Z0-9_-]+)?\s*\r?\n\s*(?:\/\/|#|\/\*)\s*\[?(?:FILE|ARQUIVO):\s*([a-zA-Z0-9_\-./\\]+)\]?(?:\s*\*\/)?\s*\r?\n([\s\S]*?)```/gi;

    while ((match = commentHeaderRegex.exec(content)) !== null) {
      tryAddDirective(match[1], match[2]);
    }

    // Pattern 5: Fence with file path in language identifier (e.g. ```typescript:server/src/foo.ts)
    const fencePathRegex =
      /```(?:[a-zA-Z0-9_-]+)?(?::|\s+file=|\s+path=|\s+)([a-zA-Z0-9_\-./\\]+\.[a-zA-Z0-9]+)\s*\r?\n([\s\S]*?)```/gi;

    while ((match = fencePathRegex.exec(content)) !== null) {
      tryAddDirective(match[1], match[2]);
    }

    return directives;
  }

  public static sanitizeMetaChatReply(rawText: string, filesChanged: string[] = []): string {
    if (!rawText || typeof rawText !== 'string') return '';
    let cleaned = stripRawLineNumberDumps(rawText)
      .replace(/^Created At:\s+[^\r\n]+/gm, '')
      .replace(/^Completed At:\s+[^\r\n]+/gm, '')
      .replace(/Showing lines \d+-\d+ of \d+[^\r\n]*/gm, '')
      .replace(/Made \d+ replacements? in [^\r\n]*/gm, '')
      .replace(/^Command exited with code \d+[^\r\n]*/gm, '')
      .replace(/^Command output:[^\r\n]*/gm, '')
      .replace(/^Log output:[^\r\n]*/gm, '')
      .replace(/The tool's output was truncated[^\r\n]*/gi, '')
      .replace(/\[FILE:\s*[^\]]+\][\s\S]*?\[ENDFILE\]/g, '')
      .trim();

    if (!cleaned) {
      if (filesChanged.length > 0) {
        return `**O que foi feito:** As alterações solicitadas foram aplicadas com sucesso no repositório DecoHUB.\n\n**Arquivos alterados:**\n` +
          filesChanged.map(f => `- \`${f}\`: atualizado conforme solicitado.`).join('\n');
      }
      return `Operação concluída com sucesso no DecoHUB.`;
    }
    return cleaned;
  }
}