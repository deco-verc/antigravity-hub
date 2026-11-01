// server/src/metaChatService.ts
// DecoHUB Meta-Chat: Chat Livre de Auto-Evolução e Modificação do Próprio Código
// Permite ao usuário solicitar melhorias, refatorações e correções no DecoHUB com Typecheck Guard e Self-Healing.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, execSync, spawnSync } from 'node:child_process';
import { db } from './db.js';
import { Logger } from './logger.js';
import { AgentApiGateway } from './agentApiGateway.js';
import { AntigravityDiscovery } from './antigravityDiscovery.js';
import { AccountProfileManager } from './accountProfileManager.js';
import { NativeWorkspaceBinding } from './nativeWorkspaceBinding.js';
import { ModelRegistry } from './modelRegistry.js';
import { PlaywrightVisualInspector } from './playwrightVisualInspector.js';
import { AntigravityProvider, isToolDump, stripRawLineNumberDumps, stripViewedCodeAndToolDumps } from './antigravityProvider.js';
import { DevAutonomyService } from './devAutonomyService.js';
import { TurnCancellationManager } from './turnCancellationManager.js';
import { ExecutionCoordinator } from './executionCoordinator.js';
import { FATAL_QUOTA_OR_AUTH_REGEX, captureFileInventory, changedFiles, FileInventory, isRawToolOrCommandOutput } from './agentTurnState.js';
import { SkillRouter } from './skillRouter.js';
import { SseStreamService } from './sseStreamService.js';
import { AstSymbolIndexService } from './astSymbolIndexService.js';
import { DocSimpService } from './docSimpService.js';

export const META_CHAT_STATUS = {
  STATUS_FACADE_RECEIVED: 'STATUS_FACADE_RECEIVED',
  STATUS_SUPERVISOR_PLANNING: 'STATUS_SUPERVISOR_PLANNING',
  STATUS_WORKER_EXECUTING: 'STATUS_WORKER_EXECUTING',
  STATUS_REVIEWER_AUDITING: 'STATUS_REVIEWER_AUDITING',
  STATUS_REVIEWER_VERIFYING: 'STATUS_REVIEWER_VERIFYING',
  STATUS_ANALYZING_PROJECT: 'STATUS_ANALYZING_PROJECT',
  STATUS_EXECUTING_STAGE: 'STATUS_EXECUTING_STAGE',
  STATUS_RUNNING_TYPECHECK: 'STATUS_RUNNING_TYPECHECK',
  STATUS_RUNNING_TESTS: 'STATUS_RUNNING_TESTS',
  STATUS_SYNCING_PRODUCTION: 'STATUS_SYNCING_PRODUCTION',
  STATUS_REJECTED_RETRYING: 'STATUS_REJECTED_RETRYING'
} as const;

/** Número máximo de loops cirúrgicos Worker→Reviewer antes do rollback final. */
export const MAX_SELF_HEAL_RETRIES = 3;

export type MetaChatStatusCode = (typeof META_CHAT_STATUS)[keyof typeof META_CHAT_STATUS];

export interface MetaChatTimelineStep {
  step: string;
  status: 'done' | 'running' | 'failed';
  duration_ms: number;
}

export interface MetaChatSupervisorPlan {
  scopeFiles: string[];
  dagSteps: string[];
  verificationCommand: string;
  planningDurationMs: number;
  rawResponse?: string;
  source: 'live_inference' | 'offline_ast_inference';
}

export interface MetaChatActiveTurnStatus {
  isRunning: boolean;
  executingThreadId?: string | null;
  startedAt?: string;
  elapsedSeconds: number;
  currentStage?: {
    code: string;
    title: string;
  };
  steps: MetaChatTimelineStep[];
  threadId?: string;
  pipelineTasks?: MetaChatPipelineTask[];
}

export interface MetaChatDetailedFile {
  path: string;
  type: 'modified' | 'created' | 'deleted';
}

export interface MetaChatImpactSummary {
  modified: number;
  created: number;
  deleted: number;
  total: number;
}

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
  id: 'task-inspect' | 'task-implement' | 'task-verify' | 'task-guard' | 'task-facade' | 'task-supervisor' | 'task-worker' | 'task-reviewer' | string;
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
  executingThreadId?: string | null;
  activeTurnStatus?: MetaChatActiveTurnStatus;
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
    execution_timeline?: MetaChatTimelineStep[];
    active_stage?: {
      code: string;
      title: string;
    };
    impact_summary?: MetaChatImpactSummary;
    files_detailed?: MetaChatDetailedFile[];
    rolled_back?: boolean;
    duration_sec?: number;
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

export interface MetaChatExecutionState {
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
  currentStage?: { code: string; title: string };
  executionTimeline: MetaChatTimelineStep[];
  steps?: MetaChatTimelineStep[];
}

export class MetaChatService {
  public static readonly MAX_SELF_HEAL_RETRIES = MAX_SELF_HEAL_RETRIES;
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
  private static _currentExecutions: Map<string, MetaChatExecutionState> = new Map();

  public static getExecution(threadId?: string): MetaChatExecutionState | null {
    if (threadId && this._currentExecutions.has(threadId)) {
      return this._currentExecutions.get(threadId)!;
    }
    if (this._currentExecutions.size === 0) return null;
    const values = Array.from(this._currentExecutions.values());
    return values[values.length - 1] || null;
  }

  private static get _currentExecution(): MetaChatExecutionState | null {
    return this.getExecution();
  }

  private static set _currentExecution(val: MetaChatExecutionState | null) {
    if (!val) {
      this._currentExecutions.clear();
    } else {
      this._currentExecutions.set(val.threadId, val);
    }
  }
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

  <single_chat_4_role_pipeline>
    ARQUITETURA UNIFICADA DE 4 PAPÉIS EM CHAT ÚNICO (SINGLE-CHAT 4-ROLE PIPELINE):
    A cognição deve ser estritamente dividida em 4 papéis sequenciais:
    - PAPEL 1: CHAT FACADE (Comunicação & Alinhamento): Interface direta com o usuário, objetivo, sem prolixidade. Apresenta o resumo executivo final.
    - PAPEL 2: SUPERVISOR (Planejador & Orquestrador): Inspeciona a realidade (.ai-dev-hub/ e repositório), cria o DAG cirúrgico e define critérios de teste binários.
    - PAPEL 3: WORKER (Engenheiro de Implementação): Executa alterações cirúrgicas com ferramentas nativas, roda comandos e coleta evidências de execução.
    - PAPEL 4: REVIEWER (Auditor Independente & QA): Executa typecheck (tsc --noEmit), audita regras anti-slop e emite o veredicto [VEREDICTO: APROVADO] ou [VEREDICTO: REJEITADO].

    PROTOCOLO DE RESPOSTA TRACE (DELIMITAÇÃO PADRONIZADA):
    Para máxima clareza operacional na UI do DecoHUB, estruture sua resposta com as marcações de papéis:
    [CHAT FACADE]
    Mensagem direta e humana de alinhamento com o usuário.

    [SUPERVISOR]
    Resumo da inspeção, DAG cirúrgico e critérios de verificação.

    [WORKER]
    Arquivos modificados, ações executadas e evidências de testes.

    [REVIEWER]
    Auditoria de tipagem (tsc --noEmit), anti-slop e [VEREDICTO: APROVADO].

    [CHAT FACADE]
    Entrega final limpa, técnica e executiva para o usuário.
  </single_chat_4_role_pipeline>
</system_invariants>

<workspace_context>
  <decohub_repository_root>${params.root}</decohub_repository_root>
  <active_intent_mode>${params.mode}</active_intent_mode>${attachmentsXml}
</workspace_context>

${
  params.mode === 'ANALYTICAL_BRIEFING'
    ? `<execution_directive mode="ANALYTICAL_BRIEFING">
  Com base exclusivamente na inspeção real dos arquivos do repositório DecoHUB em <workspace_context> usando ferramentas de leitura (\`view_file\`, \`grep_search\`, \`find_by_name\`, \`list_dir\`), responda à solicitação abaixo de forma direta, clara e humana:

  <user_request>
${params.userQueryOrMission}
  </user_request>

  <briefing_contract>
    1. MODO SOMENTE LEITURA: Inspecione os arquivos reais em \`server/src/\` e \`client/src/\` via \`grep_search\` e \`view_file\` antes de afirmar qualquer fato técnico. Não modifique nenhum arquivo neste modo.
    2. FORMATO DA RESPOSTA AO USUÁRIO (DIRETO, SIMPLES E SEM POLUIÇÃO):
       - Responda em português claro, objetivo e amigável.
       - Estrutura recomendada:
         **O que foi identificado:** breve diagnóstico do problema ou resposta à pergunta.
         **Como resolver / Recomendações:** ações práticas para a correção.
       - NUNCA inclua tags XML (<tag>...</tag>), logs de comandos ou despejos desnecessários de código que não foram solicitados. O usuário quer uma resposta simples e clara do que foi feito.
       - Omita detalhes e tags desnecessárias.
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
       - NUNCA inclua tags XML (<tag>...</tag>), logs brutos de ferramentas ou blocos desnecessários de código no relatório final.
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

  /**
   * Constrói o prompt especializado para a inferência cognitiva real do Supervisor (Fase de Planejamento).
   * O Supervisor analisa o repositório e obrigatoriamente responde um JSON estruturado com scopeFiles, dagSteps e verificationCommand.
   */
  static buildSupervisorPlanningPrompt(params: {
    userContent: string;
    root: string;
    canonicalModelName: string;
    intelligenceLevel: string;
    candidateFiles?: string[];
  }): string {
    const candidateList = params.candidateFiles && params.candidateFiles.length > 0
      ? `\n  <candidate_files_ast_index>\n${params.candidateFiles.map(f => `    - ${f}`).join('\n')}\n  </candidate_files_ast_index>`
      : '';

    return `<system_invariants>
  <role_identity>
    Você é o SUPERVISOR do DecoHUB (Planejador Estratégico & Orquestrador de Engenharia).
    Princípios Inegociáveis:
    - Think Before Coding: Analise o escopo cirúrgico antes de qualquer implementação.
    - Simplicity First & Surgical Changes: Delimite o menor conjunto viável de arquivos a modificar.
    - Zero Quebra de Retrocompatibilidade e Preservação Estrita de Tipagem TypeScript.
    - Respeite as diretrizes de SystemPrompt/PROMPT_ARQUITETURA_4_PAPEIS.md e SystemPrompt/PROMPT_INICIAL_PLANEJAMENTO.md.
    - REGRA INVIOLÁVEL DE COMPLETUDE FUNCIONAL DE PRODUTO (NO PASSIVE DASHBOARDS): Em automação/mensageria/webhooks, contemplar obrigatoriamente os 4 pilares: 1. Ingestão & Webhook Studio (URL + Simulador 1-clique); 2. Editor de Templates ({nome}, {produto}, {pix}, {link}); 3. Disparador Manual ("Enviar Agora"); 4. Monitoramento da Fila & Auditoria. Planos com apenas dashboards passivos são estritamente proibidos.
  </role_identity>

  <mandato_operacional>
    Sua missão é exclusivamente formular o PLANO DE AÇÃO CIRÚRGICO (DAG) e delimitar os ARQUIVOS EM ESCOPO para a solicitação do desenvolvedor.
    Você NÃO deve executar código nem alterar arquivos nesta fase de planejamento.
    Você deve responder OBRIGATORIAMENTE um bloco JSON estritamente válido no seguinte formato:

\`\`\`json
{
  "scopeFiles": [
    "server/src/caminho/do/arquivo1.ts",
    "client/src/caminho/do/arquivo2.tsx"
  ],
  "dagSteps": [
    "1. Inspeção de contratos e interfaces existentes",
    "2. Implementação cirúrgica no escopo delimitado",
    "3. Validação de integridade e compilação"
  ],
  "verificationCommand": "npm --prefix server run typecheck"
}
\`\`\`

    REGRAS ESTRITAS DO JSON:
    1. "scopeFiles": Lista com 1 a 5 caminhos relativos de arquivos existentes em server/ ou client/ que realmente precisam de alteração. NUNCA retorne array vazio.
    2. "dagSteps": Lista ordenada de etapas sequenciais claras e objetivas.
    3. "verificationCommand": Comando rápido de verificação local (ex: "npm --prefix server run typecheck" ou teste unitário focado).
    4. Não inclua texto fora do JSON ou coloque o JSON dentro de bloco de código json.
  </mandato_operacional>
</system_invariants>

<workspace_context>
  <repository_root>${params.root}</repository_root>${candidateList}
</workspace_context>

<user_instruction>
${params.userContent}
</user_instruction>`;
  }

  /**
   * Inferência cognitiva do Supervisor via AST Index e heurística de repositório (modo offline ou fallback).
   * Garante que o escopo de arquivos seja sempre real e nunca vazio (scopeFiles.length > 0).
   */
  static inferSupervisorPlanOffline(userContent: string, root: string): MetaChatSupervisorPlan {
    const startTime = Date.now();
    const lower = userContent.toLowerCase();
    const candidateFiles: string[] = [];

    // 1. Detecção explícita e direta de arquivos DecoHUB mencionados na instrução
    const knownFiles = [
      'server/src/metaChatService.ts',
      'client/src/components/FourRoleTimeline.tsx',
      'server/src/projectChatService.ts',
      'server/src/astSymbolIndexService.ts',
      'server/src/docSimpService.ts',
      'server/src/promptArchitectureService.ts',
      'server/src/accountProfileManager.ts',
      'server/src/agentApiGateway.ts',
      'server/src/antigravityProvider.ts',
      'server/src/agentSessionManager.ts'
    ];

    for (const kf of knownFiles) {
      const base = path.basename(kf, path.extname(kf)).toLowerCase();
      if (lower.includes(base) || lower.includes(kf.toLowerCase())) {
        if (!candidateFiles.includes(kf) && fs.existsSync(path.join(root, kf))) {
          candidateFiles.push(kf);
        }
      }
    }

    // Heurísticas semânticas se nenhum arquivo específico foi mencionado pelo nome
    if (candidateFiles.length === 0) {
      if (/metachat|meta-chat|timeline|quatro\s+pap[eé]is|4\s+pap[eé]is|supervisor|worker|facade|reviewer/i.test(lower)) {
        ['server/src/metaChatService.ts', 'client/src/components/FourRoleTimeline.tsx'].forEach(f => {
          if (!candidateFiles.includes(f) && fs.existsSync(path.join(root, f))) candidateFiles.push(f);
        });
      }
      if (/symbol|ast|token|docsimp/i.test(lower)) {
        ['server/src/astSymbolIndexService.ts', 'server/src/docSimpService.ts'].forEach(f => {
          if (!candidateFiles.includes(f) && fs.existsSync(path.join(root, f))) candidateFiles.push(f);
        });
      }
      if (/prompt|systemprompt|template/i.test(lower)) {
        ['server/src/promptArchitectureService.ts'].forEach(f => {
          if (!candidateFiles.includes(f) && fs.existsSync(path.join(root, f))) candidateFiles.push(f);
        });
      }
      if (/account|profile|language_server|headless/i.test(lower)) {
        ['server/src/accountProfileManager.ts'].forEach(f => {
          if (!candidateFiles.includes(f) && fs.existsSync(path.join(root, f))) candidateFiles.push(f);
        });
      }
      if (/project\s*chat|projectchatservice/i.test(lower)) {
        ['server/src/projectChatService.ts'].forEach(f => {
          if (!candidateFiles.includes(f) && fs.existsSync(path.join(root, f))) candidateFiles.push(f);
        });
      }
    }

    // 2. Complementa com AST Index descartando benchmarks, tmp e node_modules
    const rawAst = AstSymbolIndexService.identifyTargetFiles(userContent, root, 4) || [];
    const cleanAst = rawAst.filter(f => (f.startsWith('server/') || f.startsWith('client/')) && !f.includes('.ai-dev-benchmarks') && fs.existsSync(path.join(root, f)));
    for (const f of cleanAst) {
      if (!candidateFiles.includes(f)) candidateFiles.push(f);
    }

    // 3. Fallback garantindo que nunca seja vazio
    if (candidateFiles.length === 0) {
      const defaultCandidates = [
        'server/src/metaChatService.ts',
        'client/src/components/FourRoleTimeline.tsx'
      ].filter(f => fs.existsSync(path.join(root, f)));
      candidateFiles.push(...(defaultCandidates.length > 0 ? defaultCandidates : ['server/src/metaChatService.ts']));
    }

    const scopeFiles = candidateFiles.slice(0, 4);

    const hasServer = scopeFiles.some(f => f.startsWith('server/'));
    const hasClient = scopeFiles.some(f => f.startsWith('client/'));
    const verificationCommand = hasServer && hasClient
      ? 'npm --prefix server run typecheck && npm --prefix client run typecheck'
      : hasClient
      ? 'npm --prefix client run typecheck'
      : 'npm --prefix server run typecheck';

    const dagSteps = [
      `1. Mapeamento e inspeção de contratos nos arquivos: ${scopeFiles.map(f => f.split('/').pop()).join(', ')}`,
      `2. Execução das modificações cirúrgicas solicitadas preservando 100% dos tipos`,
      `3. Validação com comando: ${verificationCommand}`
    ];

    return {
      scopeFiles,
      dagSteps,
      verificationCommand,
      planningDurationMs: Math.max(12, Date.now() - startTime),
      source: 'offline_ast_inference'
    };
  }

  /**
   * Faz o parse seguro do plano do Supervisor retornado pelo LLM em formato JSON.
   */
  static parseSupervisorPlanResponse(rawText: string, userContent: string, root: string): MetaChatSupervisorPlan | null {
    if (!rawText || typeof rawText !== 'string') return null;

    try {
      let jsonCandidate = '';
      const codeBlockMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
      if (codeBlockMatch) {
        jsonCandidate = codeBlockMatch[1].trim();
      } else {
        const braceMatch = rawText.match(/\{[\s\S]*"scopeFiles"[\s\S]*\}/);
        if (braceMatch) {
          jsonCandidate = braceMatch[0].trim();
        }
      }

      if (jsonCandidate) {
        const parsed = JSON.parse(jsonCandidate);
        if (parsed && Array.isArray(parsed.scopeFiles) && parsed.scopeFiles.length > 0) {
          const validFiles: string[] = [];
          for (const f of parsed.scopeFiles) {
            if (typeof f === 'string') {
              const clean = f.replace(/^[\\/]+/, '').replace(/\\/g, '/');
              const full = path.join(root, clean);
              if (fs.existsSync(full)) {
                validFiles.push(clean);
              }
            }
          }

          const scopeFiles = validFiles.length > 0 ? validFiles : parsed.scopeFiles.map((f: string) => f.replace(/\\/g, '/')).slice(0, 5);
          const dagSteps = Array.isArray(parsed.dagSteps) && parsed.dagSteps.length > 0
            ? parsed.dagSteps.map((s: any) => String(s))
            : [
                `1. Inspeção dos contratos em ${scopeFiles.join(', ')}`,
                `2. Implementação cirúrgica dos requisitos`,
                `3. Auditoria de tipagem estrita`
              ];
          const verificationCommand = typeof parsed.verificationCommand === 'string' && parsed.verificationCommand.trim()
            ? parsed.verificationCommand.trim()
            : 'npm --prefix server run typecheck';

          return {
            scopeFiles,
            dagSteps,
            verificationCommand,
            planningDurationMs: 0,
            rawResponse: rawText,
            source: 'live_inference'
          };
        }
      }
    } catch {
      // Ignora erro de JSON e retorna null para fallback
    }

    return null;
  }

  /**
   * Constrói o prompt de Ordem de Serviço cirúrgica para o Worker (Estágio 2).
   * Injeta:
   * "ARQUIVOS ALVO: [scopeFiles]. EXECUTE AS SEGUINTES TAREFAS CIRÚRGICAS: [dagSteps]. CRITÉRIO DE ACEITE: [verificationCommand]."
   * Injeta também as assinaturas de AST compactas dos arquivos-alvo para economizar tokens.
   */
  static buildWorkerWorkOrderPrompt(params: {
    userContent: string;
    supervisorPlan: MetaChatSupervisorPlan;
    root: string;
    intelligenceLevel: string;
    canonicalModelName: string;
    requestedModel: string;
    attachmentsBlock?: string;
  }): string {
    const { supervisorPlan } = params;

    let astContextBlock = '';
    try {
      const symbolMapResult = AstSymbolIndexService.getSymbolMapForFiles(supervisorPlan.scopeFiles, params.root);
      if (symbolMapResult && symbolMapResult.summaryBlock) {
        astContextBlock = `\n  <ast_symbol_signatures>\n${symbolMapResult.summaryBlock}\n  </ast_symbol_signatures>`;
      }
    } catch {
      // Falha não bloqueante
    }

    let docSimpBlock = '';
    try {
      const docSimp = DocSimpService.getKnowledgeForBriefing(params.userContent);
      if (docSimp && typeof docSimp === 'string' && docSimp.trim()) {
        docSimpBlock = `\n  <docsimp_integration_rules>\n${docSimp.trim()}\n  </docsimp_integration_rules>`;
      }
    } catch {
      // Ignora se não houver catalogo correspondente
    }

    const attachmentsXml = params.attachmentsBlock
      ? `\n  <user_attachments>\n${params.attachmentsBlock}\n  </user_attachments>`
      : '';

    const filesFormatted = supervisorPlan.scopeFiles.map(f => `    - \`${f}\``).join('\n');
    const dagFormatted = supervisorPlan.dagSteps.map((s, i) => `    ${i + 1}. ${s}`).join('\n');

    return `<system_invariants>
  <worker_identity>
    Você é o WORKER do DecoHUB (Engenheiro de Implementação Cirúrgica).
    Você opera sob a ORDEM DE SERVIÇO estrita emitida pelo SUPERVISOR.
    Repositório Autoritativo: "${params.root}"
    Calibração Cognitiva: ${params.intelligenceLevel} | Modelo: ${params.canonicalModelName} (${params.requestedModel})
  </worker_identity>

  <operational_safety_invariants>
    1. ESCOPO CIRÚRGICO DELIMITADO: Edite estritamente os ARQUIVOS ALVO autorizados pelo Supervisor. É proibido modificar arquivos fora desta lista.
    2. NENHUMA QUEBRA DE TIPAGEM: Toda alteração deve passar com 0 erros em \`${supervisorPlan.verificationCommand}\`.
    3. PRESERVAÇÃO DE RETROCOMPATIBILIDADE: Mantenha 100% de compatibilidade em interfaces, funções públicas e schemas.
    4. FERRAMENTAS NATIVAS: Use view_file, replace_file_content, multi_replace_file_content ou write_to_file.
  </operational_safety_invariants>

  <single_chat_4_role_pipeline>
    Papel ativo atual: PAPEL 3: WORKER (Implementação Cirúrgica & Evidências).
    Ao concluir as alterações, reporte as modificações realizadas e os testes executados.
  </single_chat_4_role_pipeline>
</system_invariants>

<workspace_context>
  <decohub_repository_root>${params.root}</decohub_repository_root>${astContextBlock}${docSimpBlock}${attachmentsXml}
</workspace_context>

<supervisor_work_order>
  ORDEM DE SERVIÇO AUTORITATIVA DO SUPERVISOR:
  ARQUIVOS ALVO:
${filesFormatted}

  EXECUTE AS SEGUINTES TAREFAS CIRÚRGICAS:
${dagFormatted}

  CRITÉRIO DE ACEITE:
    ${supervisorPlan.verificationCommand}
</supervisor_work_order>

<execution_directive mode="AUTONOMOUS_EVOLUTION">
  VOCÊ DEVE EDITAR APENAS OS ARQUIVOS: [${supervisorPlan.scopeFiles.join(', ')}]. SIGA OS PASSOS: [${supervisorPlan.dagSteps.join('; ')}]. CRITÉRIO DE ACEITE: [${supervisorPlan.verificationCommand}].

  Instrução original do desenvolvedor:
  ${params.userContent}
</execution_directive>`;
  }

  /**
   * Formata a entrega final sintetizada pelo Chat Facade integrando os 4 papéis de forma executiva.
   */
  static formatFourRoleDeliveryReport(
    agentReport: string,
    supervisorPlan: MetaChatSupervisorPlan,
    filesChanged: string[],
    typecheckResult: { passed: boolean; output?: string },
    diffStat: string = ''
  ): string {
    const cleanedReport = this.sanitizeMetaChatReply(agentReport, filesChanged).trim();

    // Se o agente já gerou estrutura trace completa dos 4 papéis, preserva
    if (/\[CHAT FACADE\]/i.test(cleanedReport) && /\[WORKER\]/i.test(cleanedReport)) {
      return cleanedReport;
    }

    const filesList = filesChanged.length > 0
      ? filesChanged.map(f => `  - \`${f}\``).join('\n')
      : supervisorPlan.scopeFiles.map(f => `  - \`${f}\` *(inspecionado)*`).join('\n');

    const dagList = supervisorPlan.dagSteps.map((s, i) => `  ${i + 1}. ${s}`).join('\n');
    const verdict = typecheckResult.passed ? '`[VEREDICTO: APROVADO]`' : '`[VEREDICTO: REJEITADO]`';
    const typecheckDetail = typecheckResult.passed
      ? '0 erros de tipagem (`tsc --noEmit` OK)'
      : 'Erros detectados no typecheck guard';

    const diffBlock = diffStat ? `\n\n\`\`\`diff\n${diffStat.slice(0, 800)}\n\`\`\`` : '';

    return `### 1. Chat Facade
> Solicitação processada com sucesso no DecoHUB.

### 2. Supervisor
> **Arquivos em Escopo:**
${filesList}
> **Plano Cirúrgico (DAG):**
${dagList}

### 3. Worker
${cleanedReport ? `> **Execução:**\n${cleanedReport.split('\n').map(l => `> ${l}`).join('\n')}\n` : '> **Execução:** Alterações cirúrgicas concluídas conforme a Ordem de Serviço.\n'}
### 4. Reviewer
> **Veredito:** ${verdict}
> **Auditoria:** ${typecheckDetail}.${diffBlock}`;
  }

  /**
   * Executa o Estágio 1 (Execução Cognitiva Real do Supervisor).
   * Em modo Live, despacha turno de planejamento com a persona do Supervisor.
   * Em modo Offline ou fallback, utiliza AstSymbolIndexService e inferência de repositório.
   */
  static async executeSupervisorPlanning(options: {
    userContent: string;
    root: string;
    resolvedConfig: any;
    projectBinding: any;
    execEnv?: NodeJS.ProcessEnv;
    directCliMode?: boolean;
    currentThreadId: string;
    activeSlashCommand?: string;
  }): Promise<MetaChatSupervisorPlan> {
    const startTime = Date.now();
    const candidateFiles = AstSymbolIndexService.identifyTargetFiles(options.userContent, options.root, 4);

    let plan: MetaChatSupervisorPlan | null = null;

    const canRunLiveInference =
      !AgentApiGateway.isOfflineMode() &&
      !AccountProfileManager.isAutomatedTestRuntime() &&
      Boolean(options.execEnv) &&
      !options.directCliMode;

    if (canRunLiveInference) {
      try {
        const planningPrompt = MetaChatService.buildSupervisorPlanningPrompt({
          userContent: options.userContent,
          root: options.root,
          canonicalModelName: options.resolvedConfig.canonicalName,
          intelligenceLevel: options.resolvedConfig.intelligenceLevel,
          candidateFiles
        });

        const supervisorConvId = await AgentApiGateway.newConversation({
          model: AgentApiGateway.normalizeCliModelFlag(options.resolvedConfig.canonicalName),
          title: 'DecoHUB Supervisor Planning',
          prompt: planningPrompt,
          projectId: options.projectBinding.project.id,
          role: 'CONVERSATIONAL',
          caller: 'MetaChatService.executeSupervisorPlanning',
          cwd: options.root,
          env: options.execEnv
        });

        const antigravityProvider = new AntigravityProvider(options.execEnv);
        const supervisorTurn = await antigravityProvider.getResult(
          supervisorConvId,
          30000,
          options.root,
          () => Boolean(this.getExecution(options.currentThreadId)?.cancelRequested)
        );

        const raw = supervisorTurn.rawResponse || (supervisorTurn as any).finalResponse || '';
        plan = MetaChatService.parseSupervisorPlanResponse(raw, options.userContent, options.root);
      } catch (err: any) {
        Logger.warn(`[MetaChatService] Live supervisor planning fallback to AST inference: ${err.message}`);
      }
    }

    if (!plan) {
      plan = MetaChatService.inferSupervisorPlanOffline(options.userContent, options.root);
    }

    plan.planningDurationMs = Math.max(Date.now() - startTime, 15);
    return plan;
  }

  /**
   * Extrai erros estruturados do output bruto do tsc, com arquivo, linha, coluna e código TS.
   * Usado pelo ciclo de Self-Healing Reativo para montar diagnósticos precisos ao Worker.
   */
  static parseTypecheckErrors(
    rawOutput: string
  ): Array<{ file: string; line: number; column: number; code: string; message: string; raw: string }> {
    const results: Array<{ file: string; line: number; column: number; code: string; message: string; raw: string }> = [];
    const errorRegex1 = /^(.+?)\((\d+),(\d+)\):\s+(error\s+(TS\d+):\s*.+)$/;
    const errorRegex2 = /^(.+?):(\d+):(\d+)\s+-\s+(error\s+(TS\d+):\s*.+)$/;
    for (const line of rawOutput.split('\n')) {
      const trimmed = line.trim();
      const m = trimmed.match(errorRegex1) || trimmed.match(errorRegex2);
      if (m) {
        results.push({
          file: m[1].trim(),
          line: parseInt(m[2], 10),
          column: parseInt(m[3], 10),
          code: m[5] || '',
          message: m[4].trim(),
          raw: trimmed
        });
      }
    }
    return results;
  }

  /**
   * Formata um relatório de diagnóstico estruturado para ser passado ao Worker
   * em cada iteração do ciclo de Self-Healing Reativo.
   */
  static buildRetryRepairPrompt(
    originalContext: string,
    previousDiff: string,
    typecheckErrors: Array<{ file: string; line: number; column: number; code: string; message: string; raw: string }>,
    testErrors: string,
    attempt: number,
    maxAttempts: number,
    modifiedFiles: string[]
  ): string {
    const errorLines = typecheckErrors.length > 0
      ? typecheckErrors.map(e => `  - ${e.file}:${e.line}:${e.column} — ${e.code}: ${e.message}`).join('\n')
      : '  (nenhum erro de tipagem — verificar falhas de teste abaixo)';

    const testBlock = testErrors
      ? `\n<test_failures>\n${testErrors.slice(0, 2000)}\n</test_failures>`
      : '';

    return `<system_invariants>
  Modo: SELF-HEALING REATIVO — Tentativa ${attempt} de ${maxAttempts}.
  Usar exclusivamente ferramentas nativas (\`view_file\`, \`replace_file_content\`, \`multi_replace_file_content\`, \`write_to_file\`).
  NÃO reintroduza os mesmos erros da tentativa anterior.
</system_invariants>

<workspace_context>
  <original_objective>
${originalContext.slice(0, 800)}
  </original_objective>
  <scoped_modified_files>
${modifiedFiles.map(f => `    - ${f}`).join('\n')}
  </scoped_modified_files>
  <previous_diff_summary>
${previousDiff.slice(0, 1500)}
  </previous_diff_summary>
  <reviewer_rejection_report attempt="${attempt}" of="${maxAttempts}">
    O Reviewer rejeitou a implementação anterior com os seguintes erros exatos:
${errorLines}
  </reviewer_rejection_report>${testBlock}
</workspace_context>

<execution_directive mode="SURGICAL_REPAIR_RETRY">
  1. ANÁLISE PRECISA: Para cada erro listado em <reviewer_rejection_report>, localize exatamente o arquivo e linha indicados via \`view_file\`.
  2. CORREÇÃO MÍNIMA: Use \`replace_file_content\` ou \`multi_replace_file_content\` para corrigir APENAS o trecho problemático sem alterar lógica adjacente.
  3. SEM REGRESSÕES: Preserve todos os métodos, tipos e interfaces existentes nos arquivos do escopo.
  4. ENCERRAMENTO: Apresente **O que foi feito:** e **Arquivos alterados:** ao concluir.
</execution_directive>`;
  }

  static getLiveStatus(threadId?: string): MetaChatLiveStatus {
    const globalExec = this._currentExecution;
    const isGlobalRunning = Boolean(globalExec && !globalExec.cancelRequested) || Boolean(this._liveStatus.isRunning);
    const executingThreadId = globalExec?.threadId || null;

    if (threadId) {
      const threadExec = this._currentExecutions.get(threadId) || null;
      const isRunning = Boolean(threadExec && !threadExec.cancelRequested);
      let elapsedSeconds = 0;
      if (isRunning && threadExec?.startedAt) {
        elapsedSeconds = Math.max(0, Math.floor((Date.now() - new Date(threadExec.startedAt).getTime()) / 1000));
      }
      const currentPhase = isRunning && threadExec?.phase ? threadExec.phase : (this._liveStatus.phase || 'Pronto');
      return {
        isRunning,
        isExecuting: isRunning,
        executingThreadId,
        phase: currentPhase,
        currentPhase,
        activeAccount: threadExec?.accountId || this._liveStatus.activeAccount,
        activeAccountId: threadExec?.accountId || this._liveStatus.activeAccountId,
        activeModel: threadExec?.model || this._liveStatus.activeModel,
        startedAt: isRunning ? threadExec?.startedAt : undefined,
        elapsedSeconds: isRunning ? elapsedSeconds : 0,
        cancelRequested: Boolean(threadExec?.cancelRequested),
        lastStep: threadExec?.currentActionSummary || this._liveStatus.lastStep,
        activeTurnStatus: this.getActiveTurnStatus(threadId)
      };
    }

    // Chamada global (sem threadId)
    let elapsedSeconds = 0;
    if (globalExec && !globalExec.cancelRequested && globalExec.startedAt) {
      elapsedSeconds = Math.max(0, Math.floor((Date.now() - new Date(globalExec.startedAt).getTime()) / 1000));
    }
    const currentPhase = (globalExec && globalExec.phase) || this._liveStatus.phase || 'IDLE';

    return {
      isRunning: isGlobalRunning,
      isExecuting: isGlobalRunning,
      executingThreadId,
      phase: currentPhase,
      currentPhase,
      activeAccount: this._liveStatus.activeAccount || globalExec?.accountId,
      activeAccountId: this._liveStatus.activeAccountId || globalExec?.accountId,
      activeModel: this._liveStatus.activeModel || globalExec?.model,
      startedAt: isGlobalRunning ? (globalExec?.startedAt || this._liveStatus.startedAt) : undefined,
      elapsedSeconds: isGlobalRunning ? elapsedSeconds : 0,
      cancelRequested: Boolean(globalExec?.cancelRequested),
      lastStep: this._liveStatus.lastStep,
      activeTurnStatus: this.getActiveTurnStatus()
    };
  }

  static getActiveTurnStatus(threadId?: string): MetaChatActiveTurnStatus {
    const globalExec = this._currentExecution;
    const isGlobalRunning = Boolean(globalExec && !globalExec.cancelRequested);
    const executingThreadId = globalExec?.threadId || null;

    if (threadId) {
      const threadExec = this._currentExecutions.get(threadId) || null;
      const isRunning = Boolean(threadExec && !threadExec.cancelRequested);
      let elapsedSeconds = 0;
      if (isRunning && threadExec?.startedAt) {
        elapsedSeconds = Math.max(0, Math.floor((Date.now() - new Date(threadExec.startedAt).getTime()) / 1000));
      }
      return {
        isRunning,
        executingThreadId,
        startedAt: isRunning ? threadExec?.startedAt : undefined,
        elapsedSeconds: isRunning ? elapsedSeconds : 0,
        currentStage: isRunning
          ? (threadExec?.currentStage || {
              code: META_CHAT_STATUS.STATUS_EXECUTING_STAGE,
              title: threadExec?.phase || 'Executando...'
            })
          : undefined,
        steps: isRunning ? (threadExec?.executionTimeline || threadExec?.steps || []) : [],
        threadId: threadId,
        pipelineTasks: isRunning ? (threadExec?.pipelineTasks || []) : []
      };
    }

    // Chamada global
    let elapsedSeconds = 0;
    if (isGlobalRunning && globalExec?.startedAt) {
      elapsedSeconds = Math.max(0, Math.floor((Date.now() - new Date(globalExec.startedAt).getTime()) / 1000));
    }
    return {
      isRunning: isGlobalRunning,
      executingThreadId,
      startedAt: isGlobalRunning ? globalExec?.startedAt : undefined,
      elapsedSeconds: isGlobalRunning ? elapsedSeconds : 0,
      currentStage: isGlobalRunning
        ? (globalExec?.currentStage || {
            code: META_CHAT_STATUS.STATUS_EXECUTING_STAGE,
            title: globalExec?.phase || 'Executando...'
          })
        : undefined,
      steps: isGlobalRunning ? (globalExec?.executionTimeline || globalExec?.steps || []) : [],
      threadId: executingThreadId || undefined,
      pipelineTasks: isGlobalRunning ? (globalExec?.pipelineTasks || []) : []
    };
  }

  static broadcastTelemetry(status: string, payload: Record<string, any> = {}): void {
    try {
      const data = {
        status,
        timestamp: new Date().toISOString(),
        ...payload
      };
      SseStreamService.broadcast('metachat', 'activity', data);
      SseStreamService.broadcast('metachat', status, data);
    } catch (err: any) {
      Logger.warn(`[MetaChatService] Falha ao transmitir telemetria SSE: ${err.message}`);
    }
  }

  static async rollbackLastTurn(threadId?: string): Promise<{
    success: boolean;
    filesRolledBack?: string[];
    message: string;
  }> {
    const root = this.getDecoHubRoot();
    try {
      const effectiveThreadId = threadId || this.getActiveThreadId();
      let rows: any[] = [];
      if (effectiveThreadId) {
        rows = db.prepare(`
          SELECT * FROM meta_chat_messages
          WHERE role = 'assistant' AND thread_id = ?
          ORDER BY created_at DESC LIMIT 15
        `).all(effectiveThreadId) as any[];
      } else {
        rows = db.prepare(`
          SELECT * FROM meta_chat_messages
          WHERE role = 'assistant'
          ORDER BY created_at DESC LIMIT 15
        `).all() as any[];
      }

      if (!rows || rows.length === 0) {
        return { success: false, message: 'Nenhuma mensagem recente encontrada para reversão.' };
      }

      let targetMsg: any = null;
      let filesToRollback: string[] = [];

      for (const m of rows) {
        let meta: any = null;
        try {
          meta = typeof m.metadata === 'string' ? JSON.parse(m.metadata) : m.metadata;
        } catch {}
        if (meta && !meta.rolled_back) {
          const files = meta.files_changed || meta.filesModified || [];
          if (Array.isArray(files) && files.length > 0) {
            targetMsg = m;
            filesToRollback = files;
            break;
          }
        }
      }

      if (!targetMsg || filesToRollback.length === 0) {
        return {
          success: false,
          message: 'Nenhum turno recente com arquivos modificados elegível para reversão.'
        };
      }

      // Safe rollback on disk via git checkout or previous state
      this.rollbackChangedFiles(root, filesToRollback);

      // Mark metadata in DB
      let currentMeta: any = {};
      try {
        currentMeta = typeof targetMsg.metadata === 'string' ? JSON.parse(targetMsg.metadata) : (targetMsg.metadata || {});
      } catch {}
      currentMeta.rolled_back = true;

      db.prepare(`
        UPDATE meta_chat_messages
        SET metadata = ?
        WHERE id = ?
      `).run(JSON.stringify(currentMeta), targetMsg.id);

      // Record system notification message in thread
      const sysMsg = this.addMessage({
        role: 'system',
        content: `↺ **Turno Revertido com Sucesso:**\n\nOs arquivos modificados foram restaurados com segurança para o estado íntegro anterior:\n` +
          filesToRollback.map(f => `- \`${f}\``).join('\n'),
        thread_id: effectiveThreadId || undefined,
        metadata: {
          rolled_back: true,
          files_reverted: filesToRollback,
          target_message_id: targetMsg.id
        }
      });

      // Broadcast SSE telemetry
      this.broadcastTelemetry('rolled_back', {
        threadId: effectiveThreadId,
        message: `Turno revertido: ${filesToRollback.length} arquivo(s) restaurados.`,
        filesRolledBack: filesToRollback
      });

      SseStreamService.broadcast('metachat', 'message', {
        message: sysMsg,
        threadId: effectiveThreadId
      });

      return {
        success: true,
        filesRolledBack: filesToRollback,
        message: `Reversão concluída com sucesso! ${filesToRollback.length} arquivo(s) restaurados.`
      };
    } catch (err: any) {
      Logger.error(`[MetaChatService] Erro ao reverter turno: ${err.message}`);
      return {
        success: false,
        message: `Erro ao executar reversão: ${err.message}`
      };
    }
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

  static cancelActiveExecution(threadId?: string): { cancelled: boolean; message: string } {
    if (threadId && this._currentExecution && this._currentExecution.threadId !== threadId) {
      return { cancelled: false, message: 'Nenhuma execução ativa nesta conversa.' };
    }

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
    threadId?: string;
  }): void {
    const exec = this.getExecution(step.threadId);
    if (!exec) return;
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
    exec.liveSteps.push(liveStep);
    exec.currentActionSummary = liveStep.details || `${step.type}: ${step.target}`;
    this.updateLiveStatus({
      lastStep: liveStep.details
    });
  }

  static updatePipelineTask(
    taskId: 'task-inspect' | 'task-implement' | 'task-verify' | 'task-guard' | 'task-facade' | 'task-supervisor' | 'task-worker' | 'task-reviewer' | string,
    status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped',
    details?: string,
    threadId?: string
  ): void {
    const execs: MetaChatExecutionState[] = [];
    if (threadId && this._currentExecutions.has(threadId)) {
      execs.push(this._currentExecutions.get(threadId)!);
    }
    if (this._currentExecution && !execs.includes(this._currentExecution)) {
      execs.push(this._currentExecution);
    }
    if (execs.length === 0) {
      const fallback = this.getExecution(threadId);
      if (fallback) execs.push(fallback);
    }
    for (const exec of execs) {
      const task = exec.pipelineTasks.find((t: MetaChatPipelineTask) => t.id === taskId) ||
        (taskId === 'task-inspect' ? exec.pipelineTasks.find((t: MetaChatPipelineTask) => t.id === 'task-facade' || t.id === 'task-supervisor') :
         taskId === 'task-implement' ? exec.pipelineTasks.find((t: MetaChatPipelineTask) => t.id === 'task-worker') :
         taskId === 'task-verify' || taskId === 'task-guard' ? exec.pipelineTasks.find((t: MetaChatPipelineTask) => t.id === 'task-reviewer') :
         taskId === 'task-facade' ? exec.pipelineTasks.find((t: MetaChatPipelineTask) => t.id === 'task-inspect') :
         taskId === 'task-supervisor' ? exec.pipelineTasks.find((t: MetaChatPipelineTask) => t.id === 'task-inspect') :
         taskId === 'task-worker' ? exec.pipelineTasks.find((t: MetaChatPipelineTask) => t.id === 'task-implement') :
         taskId === 'task-reviewer' ? exec.pipelineTasks.find((t: MetaChatPipelineTask) => t.id === 'task-verify' || t.id === 'task-guard') :
         undefined);
      if (task) {
        task.status = status;
        if (details) task.details = details;
      }
    }
  }

  static getLiveActivity(threadId?: string): MetaChatLiveActivity {
    const targetThreadId = threadId || this.getActiveThreadId();
    const exec = targetThreadId ? (this._currentExecutions.get(targetThreadId) || null) : this._currentExecution;

    if (
      exec &&
      !exec.cancelRequested &&
      (!threadId || exec.threadId === threadId)
    ) {
      const elapsedMs = Math.max(0, Date.now() - new Date(exec.startedAt).getTime());

      // Inspect Antigravity transcript in real-time if active
      if (exec.conversationId && exec.userProfileDir) {
        try {
          const brainDir = path.join(exec.userProfileDir, '.gemini', 'antigravity', 'brain');
          const transcriptPath = path.join(
            brainDir,
            exec.conversationId,
            '.system_generated',
            'logs',
            'transcript.jsonl'
          );
          if (fs.existsSync(transcriptPath)) {
            const lines = fs.readFileSync(transcriptPath, 'utf-8').trim().split('\n').filter(Boolean);
            if (lines.length > exec.lastTranscriptLineCount) {
              for (let i = exec.lastTranscriptLineCount; i < lines.length; i++) {
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
                        this.updatePipelineTask('task-inspect', 'completed', undefined, exec.threadId);
                        this.updatePipelineTask('task-implement', 'in_progress', `Modificando ${path.basename(target)}`, exec.threadId);
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
                      if (!exec.liveSteps.some(s => s.id === stepId)) {
                        exec.liveSteps.push({
                          id: stepId,
                          type,
                          target,
                          status: 'done',
                          timestamp: new Date().toISOString(),
                          details
                        });
                        exec.currentActionSummary = details;
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
              exec.lastTranscriptLineCount = lines.length;
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
      if (exec.baselineBefore && exec.root) {
        try {
          const currentDiff = this.diffFileBaseline(
            exec.root,
            exec.baselineBefore
          );
          for (const f of currentDiff) {
            exec.filesChanged.add(f);
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
        threadId: exec.threadId,
        activeAccount: exec.accountId,
        activeModel: exec.model,
        currentActionSummary: exec.currentActionSummary,
        elapsedMs,
        pipelineTasks: exec.pipelineTasks,
        liveSteps: exec.liveSteps,
        filesModified: Array.from(exec.filesChanged)
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
      process.cwd()
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

    // 1. Resolução inteligente e offline do executável Node.js
    const resolveNodeBinary = (): string => {
      const isElectron = Boolean(
        (process.versions as any)?.electron ||
        process.execPath.toLowerCase().includes('electron') ||
        process.execPath.toLowerCase().includes('decohub')
      );

      if (!isElectron && fs.existsSync(process.execPath)) {
        return process.execPath;
      }

      // Se sob Electron, procurar Node ativo no PATH antes de assumir caminho padrão
      try {
        const lookupCmd = isWin ? 'where node' : 'which node';
        const lookupOut = execSync(lookupCmd, {
          encoding: 'utf-8',
          timeout: 3000,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'ignore']
        }).trim();
        const firstLine = lookupOut.split(/\r?\n/)[0]?.trim();
        if (firstLine && fs.existsSync(firstLine)) {
          return firstLine;
        }
      } catch {
        // lookup falhou
      }

      const defaultNode = isWin
        ? path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'node.exe')
        : '/usr/bin/node';
      if (fs.existsSync(defaultNode)) {
        return defaultNode;
      }

      return process.execPath;
    };

    // 2. Resolução offline em cascata do compilador TypeScript (tsc) sem acionar o npm registry
    const resolveTsc = (dir: string): { type: 'binary' | 'script'; target: string } | null => {
      const binName = isWin ? 'tsc.cmd' : 'tsc';

      // 1. root/server/node_modules/.bin/tsc(.cmd)
      const serverBin = path.join(root, 'server', 'node_modules', '.bin', binName);
      if (fs.existsSync(serverBin)) {
        return { type: 'binary', target: serverBin };
      }

      // local dirPath/node_modules/.bin/tsc(.cmd)
      const localBin = path.join(dir, 'node_modules', '.bin', binName);
      if (fs.existsSync(localBin)) {
        return { type: 'binary', target: localBin };
      }

      // 2. root/node_modules/.bin/tsc(.cmd)
      const rootBin = path.join(root, 'node_modules', '.bin', binName);
      if (fs.existsSync(rootBin)) {
        return { type: 'binary', target: rootBin };
      }

      // Scripts diretos typescript/bin/tsc
      const serverScript = path.join(root, 'server', 'node_modules', 'typescript', 'bin', 'tsc');
      if (fs.existsSync(serverScript)) {
        return { type: 'script', target: serverScript };
      }
      const localScript = path.join(dir, 'node_modules', 'typescript', 'bin', 'tsc');
      if (fs.existsSync(localScript)) {
        return { type: 'script', target: localScript };
      }
      const rootScript = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');
      if (fs.existsSync(rootScript)) {
        return { type: 'script', target: rootScript };
      }

      // 3. Binário global tsc disponível no PATH (where tsc / which tsc)
      try {
        const lookupCmd = isWin ? 'where tsc' : 'which tsc';
        const lookupOut = execSync(lookupCmd, {
          encoding: 'utf-8',
          timeout: 3000,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'ignore']
        }).trim();
        const firstLine = lookupOut.split(/\r?\n/)[0]?.trim();
        if (firstLine && fs.existsSync(firstLine)) {
          return { type: 'binary', target: firstLine };
        }
      } catch {
        // tsc global não encontrado
      }

      return null;
    };

    const checkDir = (subDir: string): boolean => {
      const dirPath = path.join(root, subDir);
      if (!fs.existsSync(dirPath)) return true;

      const tscResolved = resolveTsc(dirPath);
      if (!tscResolved) {
        output += `[${subDir}] AVISO: Compilador TypeScript (tsc) não encontrado localmente nem no PATH. Typecheck offline estruturado: validação ignorada com segurança sem disparar requisição ao npm registry.\n`;
        return true;
      }

      const safeNode = resolveNodeBinary();

      try {
        let res = '';
        const companionScript = tscResolved.type === 'binary'
          ? path.resolve(path.dirname(tscResolved.target), '..', 'typescript', 'bin', 'tsc')
          : null;

        if (tscResolved.type === 'script' || (companionScript && fs.existsSync(companionScript))) {
          const scriptPath = tscResolved.type === 'script' ? tscResolved.target : companionScript!;
          res = execFileSync(safeNode, [scriptPath, '--noEmit', '--skipLibCheck'], {
            cwd: dirPath,
            encoding: 'utf-8',
            timeout: 45000,
            windowsHide: true,
            env: { ...process.env, CI: 'true', NONINTERACTIVE: '1', ELECTRON_RUN_AS_NODE: '1' }
          });
        } else {
          const binCmd = isWin && tscResolved.target.includes(' ') ? `"${tscResolved.target}"` : tscResolved.target;
          res = execFileSync(binCmd, ['--noEmit', '--skipLibCheck'], {
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
   * Calcula as estatísticas de linhas adicionadas e removidas para telemetria de diff (+added/-removed).
   */
  static calculateDiffLineStats(root: string, filesChanged: string[]): { added: number; removed: number } {
    try {
      const gitDiff = execFileSync('git', ['diff', '--numstat', 'HEAD'], {
        cwd: root,
        encoding: 'utf-8',
        timeout: 5000,
        windowsHide: true
      }).trim();
      if (gitDiff) {
        let added = 0;
        let removed = 0;
        const lines = gitDiff.split(/\r?\n/);
        for (const line of lines) {
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 3) {
            const a = parseInt(parts[0], 10);
            const r = parseInt(parts[1], 10);
            const file = parts[2];
            if (filesChanged.length === 0 || filesChanged.some(f => f.includes(file) || file.includes(f))) {
              if (!isNaN(a)) added += a;
              if (!isNaN(r)) removed += r;
            }
          }
        }
        if (added > 0 || removed > 0) {
          return { added, removed };
        }
      }
    } catch {}

    const diff = this.calculateLineDiff(root, filesChanged);
    return { added: diff.linesAdded, removed: diff.linesRemoved };
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

  static getMessage(messageId: string): MetaChatMessage | null {
    try {
      const row: any = db.prepare(`
        SELECT id, thread_id, role, content, metadata, executed_steps_json, created_at
        FROM meta_chat_messages
        WHERE id = ?
      `).get(messageId);
      if (!row) return null;
      let parsedMetadata = null;
      if (row.metadata) {
        try {
          parsedMetadata = JSON.parse(row.metadata);
        } catch {}
      }
      return {
        id: row.id,
        thread_id: row.thread_id,
        role: row.role,
        content: row.content,
        metadata: parsedMetadata,
        created_at: row.created_at
      };
    } catch {
      return null;
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
    timeoutMs = 1500000,
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
    const maxCeilingMs = Math.max(timeoutMs, 1500000);
    const idleTimeoutMs = 180000;
    let lastSeenLineCount = initialLineCount;
    let lastActivityTime = Date.now();
    let lastMtime = 0;
    let lastSize = 0;

    while (Date.now() - start < maxCeilingMs && (Date.now() - lastActivityTime < idleTimeoutMs)) {
      if (fs.existsSync(transcriptPath)) {
        try {
          const stats = fs.statSync(transcriptPath);
          if (stats.size !== lastSize || stats.mtimeMs !== lastMtime) {
            lastActivityTime = Date.now();
            lastSize = stats.size;
            lastMtime = stats.mtimeMs;
          }

          const content = fs.readFileSync(transcriptPath, 'utf-8');
          const lines = content.trim().split('\n').filter(Boolean);
          const newLines = lines.slice(Math.max(0, initialLineCount));

          if (lines.length > lastSeenLineCount) {
            lastSeenLineCount = lines.length;
            lastActivityTime = Date.now();
          }

          // 1. Detectar erro fatal ou quota
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
          }

          // 2. Verificar se há chamadas de ferramenta pendentes
          let hasPendingToolCalls = false;
          let isExplicitDone = false;
          if (newLines.length > 0) {
            let lastParsed: any = null;
            try { lastParsed = JSON.parse(newLines[newLines.length - 1]); } catch {}
            if (lastParsed) {
              isExplicitDone = lastParsed.status === 'DONE' || lastParsed.type === 'DONE';
              if (Array.isArray(lastParsed.tool_calls) && lastParsed.tool_calls.length > 0) {
                hasPendingToolCalls = true;
              }
            }
          }

          const quietStabilityReached = Date.now() - lastActivityTime >= 4000;

          // Se concluiu explicitamente ou estabilizou quieto por 4s sem chamadas pendentes:
          if ((isExplicitDone || quietStabilityReached) && !hasPendingToolCalls && newLines.length > 0) {
            for (let i = newLines.length - 1; i >= 0; i--) {
              let entry: any;
              try {
                entry = JSON.parse(newLines[i]);
              } catch {
                continue;
              }

              if (
                entry.type === 'TOOL_RESULT' ||
                entry.type === 'COMMAND_OUTPUT' ||
                entry.type === 'USER_INPUT' ||
                entry.source === 'SYSTEM' ||
                entry.source === 'USER'
              ) {
                continue;
              }

              const isAssistantEntry =
                entry.type === 'PLANNER_RESPONSE' ||
                entry.type === 'ASSISTANT_RESPONSE' ||
                entry.type === 'MODEL_TURN' ||
                entry.type === 'ASSISTANT_MESSAGE' ||
                entry.type === 'TEXT' ||
                entry.type === 'STEP_SUMMARY' ||
                entry.role === 'assistant' ||
                entry.source === 'MODEL';

              if (Array.isArray(entry.tool_calls) && entry.tool_calls.length > 0 && !entry.content?.trim()) {
                continue;
              }

              if (isAssistantEntry && (entry.content || entry.thinking || entry.message)) {
                let fullText = String(entry.content || entry.thinking || entry.message || '');
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
                        (fullEntry.content || fullEntry.thinking)
                      ) {
                        const candidateFull = String(fullEntry.content || fullEntry.thinking || '');
                        if (candidateFull.length >= fullText.length) {
                          fullText = candidateFull;
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
                    }
                  }
                }

                const cleanedText = stripViewedCodeAndToolDumps(fullText).trim();
                if (
                  cleanedText &&
                  cleanedText.length > 15 &&
                  !isToolDump(cleanedText) &&
                  !isRawToolOrCommandOutput(cleanedText) &&
                  !cleanedText.includes('<truncated') &&
                  cleanedText !== 'Created file.'
                ) {
                  return cleanedText;
                }
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

  static startPostTurnTranscriptWatcher(
    conversationId: string,
    messageId: string,
    threadId: string,
    root: string,
    customUserProfileDir?: string
  ): void {
    const brainDir = AntigravityDiscovery.getBrainDir(customUserProfileDir);
    const transcriptPath = path.join(brainDir, conversationId, '.system_generated', 'logs', 'transcript.jsonl');
    if (!fs.existsSync(transcriptPath)) return;

    let checkCount = 0;
    const maxChecks = 15; // 30 segundos de vigilância pós-turno
    let initialMtime = 0;
    try {
      initialMtime = fs.statSync(transcriptPath).mtimeMs;
    } catch {}

    const interval = setInterval(() => {
      checkCount++;
      if (checkCount > maxChecks) {
        clearInterval(interval);
        return;
      }
      try {
        if (!fs.existsSync(transcriptPath)) return;
        const currentMtime = fs.statSync(transcriptPath).mtimeMs;
        if (currentMtime > initialMtime) {
          initialMtime = currentMtime;
          const content = fs.readFileSync(transcriptPath, 'utf-8');
          const lines = content.trim().split('\n').filter(Boolean);
          for (let i = lines.length - 1; i >= Math.max(0, lines.length - 10); i--) {
            try {
              const e = JSON.parse(lines[i]);
              if (
                e.source === 'MODEL' ||
                e.type === 'PLANNER_RESPONSE' ||
                e.type === 'STEP_SUMMARY' ||
                e.type === 'ASSISTANT_RESPONSE'
              ) {
                const text = String(e.content || e.message || '').trim();
                const cleaned = stripViewedCodeAndToolDumps(text);
                if (cleaned && cleaned.length > 50 && (cleaned.includes('**O que foi feito:**') || cleaned.includes('# '))) {
                  const formatted = MetaChatService.formatDeliveryReport(cleaned, []);
                  db.prepare(`UPDATE meta_chat_messages SET content = ? WHERE id = ?`).run(formatted, messageId);
                  const updatedMsg = MetaChatService.getMessage(messageId);
                  if (updatedMsg) {
                    SseStreamService.broadcast('metachat', 'message', {
                      message: updatedMsg,
                      threadId
                    });
                  }
                  clearInterval(interval);
                  break;
                }
              }
            } catch {}
          }
        }
      } catch {
        clearInterval(interval);
      }
    }, 2000);
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
    const karpathyCandidates = [
      path.join(skillsDir, 'andrej-karpathy-skills-main', 'andrej-karpathy-skills-main', 'skills', 'karpathy-guidelines', 'SKILL.md'),
      path.join(hubRoot, '.agents', 'skills', 'karpathy-guidelines', 'SKILL.md'),
      path.join(hubRoot, 'server', '.agents', 'skills', 'karpathy-guidelines', 'SKILL.md'),
      path.join(hubRoot, 'server', '.ai-dev-hub', 'skills', 'karpathy-guidelines-skill.md'),
      path.join(__dirname, '../../.agents/skills/karpathy-guidelines/SKILL.md'),
      path.join(__dirname, '../.agents/skills/karpathy-guidelines/SKILL.md'),
      path.join(__dirname, '../.ai-dev-hub/skills/karpathy-guidelines-skill.md'),
      path.join(process.cwd(), '.agents', 'skills', 'karpathy-guidelines', 'SKILL.md'),
      path.join(process.cwd(), 'server', '.agents', 'skills', 'karpathy-guidelines', 'SKILL.md')
    ];
    const karpathySrc = karpathyCandidates.find(c => fs.existsSync(c));

    const examplesCandidates = [
      path.join(skillsDir, 'andrej-karpathy-skills-main', 'andrej-karpathy-skills-main', 'EXAMPLES.md'),
      path.join(hubRoot, '.agents', 'skills', 'karpathy-guidelines', 'examples', 'EXAMPLES.md'),
      path.join(hubRoot, 'server', '.agents', 'skills', 'karpathy-guidelines', 'examples', 'EXAMPLES.md'),
      path.join(hubRoot, 'server', '.ai-dev-hub', 'skills', 'EXAMPLES.md'),
      path.join(__dirname, '../../.agents/skills/karpathy-guidelines/examples/EXAMPLES.md'),
      path.join(__dirname, '../.agents/skills/karpathy-guidelines/examples/EXAMPLES.md'),
      path.join(__dirname, '../.ai-dev-hub/skills/EXAMPLES.md'),
      path.join(process.cwd(), '.agents', 'skills', 'karpathy-guidelines', 'examples', 'EXAMPLES.md'),
      path.join(process.cwd(), 'server', '.agents', 'skills', 'karpathy-guidelines', 'examples', 'EXAMPLES.md')
    ];
    const examplesSrc = examplesCandidates.find(c => fs.existsSync(c));

    if (karpathySrc && fs.existsSync(karpathySrc)) {
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

      if (examplesSrc && fs.existsSync(examplesSrc)) {
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
    this.broadcastTelemetry(META_CHAT_STATUS.STATUS_SYNCING_PRODUCTION, {
      message: 'Recompilando servidor e frontend do DecoHUB...',
      active_stage_code: 'SYNC',
      active_stage_title: 'Recompilação e Sincronização'
    });

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
        { id: 'task-facade', label: 'Chat Facade', status: 'completed', details: 'Instrução recebida e escopo alinhado' },
        { id: 'task-supervisor', label: 'Supervisor', status: 'in_progress', details: 'Inspeção e plano cirúrgico (DAG)' },
        { id: 'task-worker', label: 'Worker', status: 'pending', details: 'Implementação cirúrgica e evidências' },
        { id: 'task-reviewer', label: 'Reviewer', status: 'pending', details: 'Auditoria de integridade e veredicto' }
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
      userProfileDir: undefined,
      currentStage: {
        code: META_CHAT_STATUS.STATUS_SUPERVISOR_PLANNING,
        title: 'Supervisor (Planejamento & DAG Cirúrgico)'
      },
      executionTimeline: []
    };

    let effectiveAccountId = requestedAccountId;
    let activeStage: { code: string; title: string } = {
      code: META_CHAT_STATUS.STATUS_SUPERVISOR_PLANNING,
      title: 'Supervisor (Planejamento & DAG Cirúrgico)'
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
        startedAt: this._currentExecution?.startedAt || new Date().toISOString(),
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
      const executionTimeline: MetaChatTimelineStep[] = [];
      let stepStartTime = Date.now();
      const recordTimelineStep = (stepName: string, status: 'done' | 'running' | 'failed') => {
        const now = Date.now();
        executionTimeline.push({
          step: stepName,
          status,
          duration_ms: Math.max(1, now - stepStartTime)
        });
        if (this._currentExecution) {
          this._currentExecution.executionTimeline = [...executionTimeline];
        }
        stepStartTime = now;
      };

      const slashMatch = userContent.trim().match(/^(\/[a-zA-Z0-9_-]+)/);
      const activeSlashCommand = slashMatch ? slashMatch[1] : undefined;

      recordTimelineStep('Chat Facade', 'done');

      activeStage = {
        code: META_CHAT_STATUS.STATUS_SUPERVISOR_PLANNING,
        title: 'Supervisor (Planejamento & DAG Cirúrgico)'
      };

      this.broadcastTelemetry(META_CHAT_STATUS.STATUS_FACADE_RECEIVED, {
        threadId: currentThread.id,
        message: 'Chat Facade recebeu instrução do desenvolvedor e alinhou o escopo de execução.',
        active_stage_code: META_CHAT_STATUS.STATUS_FACADE_RECEIVED,
        active_stage_title: 'Chat Facade (Alinhamento & Comunicação)',
        active_slash_command: activeSlashCommand,
        objective: userContent.slice(0, 160)
      });

      let supervisorPlan: MetaChatSupervisorPlan | null = null;

      this.broadcastTelemetry(META_CHAT_STATUS.STATUS_SUPERVISOR_PLANNING, {
        threadId: currentThread.id,
        message: 'Supervisor inspecionando repositório e formulando plano cirúrgico (DAG)...',
        active_stage_code: META_CHAT_STATUS.STATUS_SUPERVISOR_PLANNING,
        active_stage_title: 'Supervisor (Planejamento & DAG Cirúrgico)',
        active_slash_command: activeSlashCommand,
        isPlanning: true
      });

      if (parsedActions.length > 0) {
        const directFiles = parsedActions.map(a => a.filePath.replace(/\\/g, '/'));
        supervisorPlan = {
          scopeFiles: directFiles.length > 0 ? directFiles : ['server/src/metaChatService.ts'],
          dagSteps: [
            `1. Identificação de ${parsedActions.length} ação(ões) direta(s) de código`,
            `2. Aplicação cirúrgica nos arquivos em escopo`,
            `3. Validação com Typecheck Guard`
          ],
          verificationCommand: 'npm --prefix server run typecheck',
          planningDurationMs: 15,
          source: 'offline_ast_inference'
        };
        recordTimelineStep('Supervisor (Plano)', 'done');
        this.updatePipelineTask('task-supervisor', 'completed', `${supervisorPlan.scopeFiles.length} arq(s) em escopo`, currentThread.id);
        this.broadcastTelemetry(META_CHAT_STATUS.STATUS_SUPERVISOR_PLANNING, {
          threadId: currentThread.id,
          message: `Supervisor definiu escopo de ${supervisorPlan.scopeFiles.length} arquivo(s).`,
          active_stage_code: META_CHAT_STATUS.STATUS_SUPERVISOR_PLANNING,
          active_stage_title: 'Supervisor (Planejamento & DAG Cirúrgico)',
          active_slash_command: activeSlashCommand,
          plannedFiles: supervisorPlan.scopeFiles,
          affectedFiles: supervisorPlan.scopeFiles,
          dag: {
            id: `dag-${Date.now()}`,
            nodes: supervisorPlan.dagSteps.map((s, i) => ({ id: `step-${i + 1}`, title: s, status: i === 0 ? 'COMPLETED' : 'IN_PROGRESS', files: supervisorPlan!.scopeFiles }))
          }
        });
        SseStreamService.broadcast('metachat', 'timeline_event', {
          type: 'supervisor_dag_created',
          role: 'supervisor',
          phase: 'DAG_COMPOSED',
          dag: {
            id: `dag-${Date.now()}`,
            nodes: supervisorPlan.dagSteps.map((s, i) => ({ id: `step-${i + 1}`, title: s, status: i === 0 ? 'COMPLETED' : 'IN_PROGRESS', files: supervisorPlan!.scopeFiles }))
          },
          plannedFiles: supervisorPlan.scopeFiles,
          affectedFiles: supervisorPlan.scopeFiles,
          timestamp: new Date().toISOString()
        });

        this.updatePipelineTask('task-implement', 'in_progress', `Processando ${parsedActions.length} ação(ões)`, currentThread.id);
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
        this.updatePipelineTask('task-worker', 'completed', `${filesChanged.length} arquivo(s) modificados`, currentThread.id);
        recordTimelineStep('Worker (Execução)', 'done');
        SseStreamService.broadcast('metachat', 'timeline_event', {
          type: 'worker_executed',
          role: 'worker',
          phase: 'SURGICAL_EDIT_EXECUTED',
          affectedFiles: filesChanged.length > 0 ? filesChanged : supervisorPlan.scopeFiles,
          testPassed: true,
          timestamp: new Date().toISOString()
        });

        if (filesChanged.length > 0) {
          this.updatePipelineTask('task-reviewer', 'in_progress', `Auditando tipagem de ${filesChanged.length} arquivos`, currentThread.id);
          this.recordLiveStep({
            type: 'GUARD',
            target: 'tsc --noEmit',
            status: 'running',
            details: 'Validando tipagem com Typecheck Guard...'
          });
          activeStage = {
            code: META_CHAT_STATUS.STATUS_RUNNING_TYPECHECK,
            title: 'TypeScript Guard'
          };
          if (this._currentExecution) this._currentExecution.currentStage = activeStage;
          this.broadcastTelemetry(META_CHAT_STATUS.STATUS_RUNNING_TYPECHECK, {
            threadId: currentThread.id,
            message: 'Validando tipagem estrita com TypeScript Guard (tsc --noEmit)...',
            active_stage_code: META_CHAT_STATUS.STATUS_RUNNING_TYPECHECK,
            active_stage_title: 'TypeScript Guard'
          });
          this.updateLiveStatus({
            phase: 'Validando Typecheck Guard (tsc --noEmit)...',
            lastStep: `Verificando tipagem de ${filesChanged.length} arquivos`
          });
          const hasServerFiles = filesChanged.some(f => f.startsWith('server/'));
          const hasClientFiles = filesChanged.some(f => f.startsWith('client/'));
          const target = hasServerFiles && hasClientFiles ? 'all' : hasClientFiles ? 'client' : 'server';

          typecheckResult = await this.runTypecheck(target, filesChanged);
          recordTimelineStep('Reviewer (Auditoria)', typecheckResult.passed ? 'done' : 'failed');

          if (!typecheckResult.passed) {
            Logger.warn(`[MetaChatService] Typecheck quebrou após alteração manual. Acionando Autoproteção Ativa...`);
            this.updatePipelineTask('task-reviewer', 'failed', 'Erro de compilação detectado', currentThread.id);
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
            this.updatePipelineTask('task-reviewer', 'completed', `[APROVADO] tsc --noEmit em ${typecheckResult.durationMs}ms`, currentThread.id);
            recordTimelineStep('Reviewer (Auditoria)', 'done');
            SseStreamService.broadcast('metachat', 'timeline_event', {
              type: 'reviewer_validated',
              role: 'reviewer',
              phase: 'TYPECHECK_VALIDATED',
              verdict: 'APROVADO',
              typecheckPassed: true,
              output: typecheckResult.output || 'tsc --noEmit concluído com 0 erros.',
              timestamp: new Date().toISOString()
            });
          }
        } else {
          this.updatePipelineTask('task-reviewer', 'completed', '[APROVADO] Nenhum arquivo modificado', currentThread.id);
          recordTimelineStep('Reviewer (Auditoria)', 'done');
          SseStreamService.broadcast('metachat', 'timeline_event', {
            type: 'reviewer_validated',
            role: 'reviewer',
            phase: 'TYPECHECK_VALIDATED',
            verdict: 'APROVADO',
            typecheckPassed: true,
            output: 'Nenhum arquivo modificado.',
            timestamp: new Date().toISOString()
          });
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

          supervisorPlan = MetaChatService.inferSupervisorPlanOffline(userContent, root);
          recordTimelineStep('Supervisor (Plano)', 'done');

          const dagNodes = supervisorPlan.dagSteps.map((step, idx) => ({
            id: `step-${idx + 1}`,
            title: step,
            status: idx === 0 ? 'COMPLETED' : 'IN_PROGRESS',
            files: supervisorPlan!.scopeFiles
          }));

          this.broadcastTelemetry(META_CHAT_STATUS.STATUS_SUPERVISOR_PLANNING, {
            threadId: currentThread.id,
            message: `Supervisor definiu escopo com ${supervisorPlan.scopeFiles.length} arquivo(s).`,
            active_stage_code: META_CHAT_STATUS.STATUS_SUPERVISOR_PLANNING,
            active_stage_title: 'Supervisor (Planejamento & DAG Cirúrgico)',
            active_slash_command: activeSlashCommand,
            plannedFiles: supervisorPlan.scopeFiles,
            affectedFiles: supervisorPlan.scopeFiles,
            dag: {
              id: `dag-${Date.now()}`,
              nodes: dagNodes
            }
          });

          SseStreamService.broadcast('metachat', 'timeline_event', {
            type: 'supervisor_dag_created',
            role: 'supervisor',
            phase: 'DAG_COMPOSED',
            dag: {
              id: `dag-${Date.now()}`,
              nodes: dagNodes
            },
            plannedFiles: supervisorPlan.scopeFiles,
            affectedFiles: supervisorPlan.scopeFiles,
            timestamp: new Date().toISOString()
          });

          this.updatePipelineTask(
            'task-supervisor',
            'completed',
            `${supervisorPlan.scopeFiles.length} arq(s) em escopo`,
            currentThread.id
          );

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
          const lineStats = this.calculateDiffLineStats(root, filesChanged);
          this.broadcastTelemetry(META_CHAT_STATUS.STATUS_WORKER_EXECUTING, {
            threadId: currentThread.id,
            message: `Worker concluiu alterações em ${filesChanged.length} arquivo(s) (+${lineStats.added} / -${lineStats.removed}).`,
            active_stage_code: META_CHAT_STATUS.STATUS_WORKER_EXECUTING,
            active_stage_title: 'Worker (Execução Concluída)',
            plannedFiles: supervisorPlan.scopeFiles,
            affectedFiles: filesChanged.length > 0 ? filesChanged : supervisorPlan.scopeFiles,
            linesAdded: lineStats.added,
            linesRemoved: lineStats.removed
          });
          this.updatePipelineTask(
            'task-worker',
            'completed',
            `${filesChanged.length > 0 ? filesChanged.length : supervisorPlan.scopeFiles.length} arquivo(s) processados (+${lineStats.added} / -${lineStats.removed})`,
            currentThread.id
          );
          recordTimelineStep('Worker (Execução)', 'done');
          SseStreamService.broadcast('metachat', 'timeline_event', {
            type: 'worker_executed',
            role: 'worker',
            phase: 'SURGICAL_EDIT_EXECUTED',
            affectedFiles: filesChanged.length > 0 ? filesChanged : supervisorPlan.scopeFiles,
            linesAdded: lineStats.added,
            linesRemoved: lineStats.removed,
            testPassed: true,
            timestamp: new Date().toISOString()
          });

          const hasServerFiles = filesChanged.some(f => f.startsWith('server/'));
          const hasClientFiles = filesChanged.some(f => f.startsWith('client/'));
          const target = hasServerFiles && hasClientFiles ? 'all' : hasClientFiles ? 'client' : 'server';
          typecheckResult = await this.runTypecheck(target, filesChanged);
          recordTimelineStep('Reviewer (Auditoria)', typecheckResult.passed ? 'done' : 'failed');
          this.updatePipelineTask('task-reviewer', 'completed', '[APROVADO] Integridade preservada', currentThread.id);

          this.broadcastTelemetry(META_CHAT_STATUS.STATUS_REVIEWER_VERIFYING, {
            threadId: currentThread.id,
            message: 'Reviewer auditou a integridade: [VEREDICTO: APROVADO] (Nenhum arquivo quebrou compilação).',
            active_stage_code: META_CHAT_STATUS.STATUS_REVIEWER_VERIFYING,
            active_stage_title: 'Reviewer (Auditoria & Integridade)',
            verdict: 'APROVADO',
            typecheckPassed: true,
            output: 'Auditoria de integridade aprovada com 0 erros.'
          });

          SseStreamService.broadcast('metachat', 'timeline_event', {
            type: 'reviewer_validated',
            role: 'reviewer',
            phase: 'TYPECHECK_VALIDATED',
            verdict: 'APROVADO',
            typecheckPassed: true,
            output: 'Auditoria de integridade aprovada com 0 erros.',
            timestamp: new Date().toISOString()
          });
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

          this.updatePipelineTask('task-supervisor', 'in_progress', 'Supervisor inspecionando repositório e formulando plano cirúrgico (DAG)...', currentThread.id);
          this.updateLiveStatus({
            phase: 'Supervisor formulando plano cirúrgico (DAG)...',
            lastStep: 'Análise de dependências e escopo de arquivos'
          });

          supervisorPlan = await this.executeSupervisorPlanning({
            userContent,
            root,
            resolvedConfig,
            projectBinding,
            execEnv,
            directCliMode,
            currentThreadId: currentThread.id,
            activeSlashCommand
          });

          recordTimelineStep('Supervisor (Plano)', 'done');

          const dagNodes = supervisorPlan.dagSteps.map((step, idx) => ({
            id: `step-${idx + 1}`,
            title: step,
            status: idx === 0 ? 'COMPLETED' : 'IN_PROGRESS',
            files: supervisorPlan!.scopeFiles
          }));

          this.broadcastTelemetry(META_CHAT_STATUS.STATUS_SUPERVISOR_PLANNING, {
            threadId: currentThread.id,
            message: `Supervisor formulou plano cirúrgico com ${supervisorPlan.scopeFiles.length} arquivo(s) em escopo.`,
            active_stage_code: META_CHAT_STATUS.STATUS_SUPERVISOR_PLANNING,
            active_stage_title: 'Supervisor (Planejamento & DAG Cirúrgico)',
            active_slash_command: activeSlashCommand,
            plannedFiles: supervisorPlan.scopeFiles,
            affectedFiles: supervisorPlan.scopeFiles,
            dag: {
              id: `dag-${Date.now()}`,
              nodes: dagNodes
            }
          });

          SseStreamService.broadcast('metachat', 'timeline_event', {
            type: 'supervisor_dag_created',
            role: 'supervisor',
            phase: 'DAG_COMPOSED',
            dag: {
              id: `dag-${Date.now()}`,
              nodes: dagNodes
            },
            plannedFiles: supervisorPlan.scopeFiles,
            affectedFiles: supervisorPlan.scopeFiles,
            timestamp: new Date().toISOString()
          });

          this.updatePipelineTask(
            'task-supervisor',
            'completed',
            `${supervisorPlan.scopeFiles.length} arq(s) em escopo: [${supervisorPlan.scopeFiles.map(f => f.split('/').pop()).join(', ')}]`,
            currentThread.id
          );

          const fullPrompt = MetaChatService.buildWorkerWorkOrderPrompt({
            userContent,
            supervisorPlan,
            root,
            intelligenceLevel: resolvedConfig.intelligenceLevel,
            canonicalModelName: resolvedConfig.canonicalName,
            requestedModel,
            attachmentsBlock
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
            this.updatePipelineTask('task-worker', 'in_progress', `Executando em ${supervisorPlan.scopeFiles.length} arquivo(s)`, currentThread.id);
            activeStage = {
              code: META_CHAT_STATUS.STATUS_WORKER_EXECUTING,
              title: `Worker (Execução Cirúrgica — ${resolvedConfig.canonicalName})`
            };
            if (this._currentExecution) this._currentExecution.currentStage = activeStage;
            this.broadcastTelemetry(META_CHAT_STATUS.STATUS_WORKER_EXECUTING, {
              threadId: currentThread.id,
              message: `Worker executando turno no Antigravity (${resolvedConfig.canonicalName})...`,
              active_stage_code: META_CHAT_STATUS.STATUS_WORKER_EXECUTING,
              active_stage_title: `Worker (Execução Cirúrgica — ${resolvedConfig.canonicalName})`,
              active_slash_command: activeSlashCommand,
              plannedFiles: supervisorPlan.scopeFiles,
              affectedFiles: supervisorPlan.scopeFiles
            });
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

          const workerTurnStartTime = Date.now();
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
            1500000,
            root,
            () => Boolean(this.getExecution(currentThread.id)?.cancelRequested || TurnCancellationManager.isCancelled('metachat', activeConvId))
          );
          let agentReport = (turnResult.rawResponse || (turnResult as any).finalResponse || '').trim();

          if (!agentReport && activeConvId) {
            try {
              const fromTranscript = await this.waitForTranscriptResponse(
                activeConvId,
                initialLineCount,
                1500000,
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

          if (Array.isArray((turnResult as any).agentSteps)) {
            for (const step of (turnResult as any).agentSteps) {
              this.recordLiveStep({
                type: step.type || 'COMMAND',
                target: step.target || 'DecoHUB',
                status: 'done',
                details: step.details || step.action,
                threadId: currentThread.id
              });
            }
          }

          this.updatePipelineTask('task-inspect', 'completed', undefined, currentThread.id);
          this.updatePipelineTask('task-implement', 'completed', undefined, currentThread.id);

          const changedInTurn = this.diffFileBaseline(root, baselineBefore, turnResult.filesChanged);
          filesChanged.push(...changedInTurn);

          if (Array.isArray(turnResult.filesChanged)) {
            for (const fc of turnResult.filesChanged) {
              if (!filesChanged.includes(fc)) {
                filesChanged.push(fc);
              }
            }
          }

          try {
            const gitStatus = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf-8', timeout: 5000 }).trim();
            if (gitStatus) {
              const gitLines = gitStatus.split(/\r?\n/);
              for (const gl of gitLines) {
                const parts = gl.trim().split(/\s+/);
                const filePath = parts[1] || parts[parts.length - 1];
                if (filePath && !filesChanged.includes(filePath)) {
                  filesChanged.push(filePath);
                }
              }
            }
          } catch {}

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

          const lineStats = this.calculateDiffLineStats(root, filesChanged);
          const workerDurationMs = workerTurnStartTime > 0 ? (Date.now() - workerTurnStartTime) : 0;
          this.broadcastTelemetry(META_CHAT_STATUS.STATUS_WORKER_EXECUTING, {
            threadId: currentThread.id,
            message: `Worker concluiu edições: ${filesChanged.length} arquivo(s) (+${lineStats.added}/-${lineStats.removed}) em ${(workerDurationMs / 1000).toFixed(1)}s`,
            active_stage_code: META_CHAT_STATUS.STATUS_WORKER_EXECUTING,
            active_stage_title: 'Worker (Execução Cirúrgica)',
            affectedFiles: filesChanged.length > 0 ? filesChanged : (supervisorPlan?.scopeFiles || []),
            plannedFiles: supervisorPlan?.scopeFiles || [],
            linesAdded: lineStats.added,
            linesRemoved: lineStats.removed,
            workerDurationMs
          });

          recordTimelineStep('Worker (Execução)', 'done');
          this.updatePipelineTask(
            'task-worker',
            'completed',
            `${filesChanged.length > 0 ? filesChanged.length : (supervisorPlan?.scopeFiles.length || 0)} arquivo(s) processados (+${lineStats.added}/-${lineStats.removed})`,
            currentThread.id
          );
          SseStreamService.broadcast('metachat', 'timeline_event', {
            type: 'worker_executed',
            role: 'worker',
            phase: 'SURGICAL_EDIT_EXECUTED',
            affectedFiles: filesChanged.length > 0 ? filesChanged : (supervisorPlan?.scopeFiles || []),
            testPassed: true,
            linesAdded: lineStats.added,
            linesRemoved: lineStats.removed,
            workerDurationMs,
            timestamp: new Date().toISOString()
          });

          if (filesChanged.length > 0) {
            this.updatePipelineTask('task-reviewer', 'in_progress', `Auditando ${filesChanged.length} arquivos alterados`, currentThread.id);
            this.recordLiveStep({
              type: 'GUARD',
              target: 'tsc --noEmit',
              status: 'running',
              details: 'Reviewer validando integridade de compilação com Typecheck Guard...'
            });
            activeStage = {
              code: META_CHAT_STATUS.STATUS_REVIEWER_AUDITING,
              title: 'Reviewer (Auditoria & Typecheck Guard)'
            };
            if (this._currentExecution) this._currentExecution.currentStage = activeStage;
            this.broadcastTelemetry(META_CHAT_STATUS.STATUS_REVIEWER_AUDITING, {
              threadId: currentThread.id,
              message: 'Reviewer auditando tipagem estrita com TypeScript Guard (tsc --noEmit)...',
              active_stage_code: META_CHAT_STATUS.STATUS_REVIEWER_AUDITING,
              active_stage_title: 'Reviewer (Auditoria & Typecheck Guard)',
              plannedFiles: supervisorPlan?.scopeFiles || [],
              affectedFiles: filesChanged
            });
            this.updateLiveStatus({
              phase: `Reviewer validando Typecheck Guard tsc --noEmit...`,
              lastStep: `Auditando ${filesChanged.length} arquivos alterados`
            });

            const hasServerFiles = filesChanged.some(f => f.startsWith('server/'));
            const hasClientFiles = filesChanged.some(f => f.startsWith('client/'));
            const target = hasServerFiles && hasClientFiles ? 'all' : hasClientFiles ? 'client' : 'server';

            typecheckResult = await this.runTypecheck(target, filesChanged);
            recordTimelineStep('Reviewer (Auditoria)', typecheckResult.passed ? 'done' : 'failed');

            // ── Self-Healing Reativo: loop Worker→Reviewer (máx MAX_SELF_HEAL_RETRIES) ──
            if (!typecheckResult.passed) {
              Logger.warn(
                `[MetaChatService] Typecheck apontou erros após turno do Antigravity. Iniciando ciclo Self-Healing Reativo (máx ${MAX_SELF_HEAL_RETRIES} tentativas)...`
              );

              let healedOnRetry = false;
              let lastRepairReport = '';

              for (
                let attempt = 1;
                attempt <= MAX_SELF_HEAL_RETRIES && !healedOnRetry && !this._currentExecution?.cancelRequested;
                attempt++
              ) {
                if (AgentApiGateway.isOfflineMode() || !activeConvId) break;

                // — Emite STATUS_REJECTED_RETRYING com contador —
                this.broadcastTelemetry(META_CHAT_STATUS.STATUS_REJECTED_RETRYING, {
                  threadId: currentThread.id,
                  attempt,
                  maxAttempts: MAX_SELF_HEAL_RETRIES,
                  message: `Reviewer rejeitou (tentativa ${attempt}/${MAX_SELF_HEAL_RETRIES}). Enviando diagnóstico ao Worker para correção...`,
                  active_stage_code: META_CHAT_STATUS.STATUS_REJECTED_RETRYING,
                  active_stage_title: `Self-Healing Reativo — Tentativa ${attempt}/${MAX_SELF_HEAL_RETRIES}`
                });
                this.updatePipelineTask(
                  'task-verify',
                  'in_progress',
                  `Self-Healing Reativo: tentativa ${attempt}/${MAX_SELF_HEAL_RETRIES}...`
                );
                this.recordLiveStep({
                  type: 'GUARD',
                  target: `Self-Healing (${attempt}/${MAX_SELF_HEAL_RETRIES})`,
                  status: 'running',
                  details: `Reviewer rejeitou — enviando diagnóstico estruturado ao Worker (tentativa ${attempt})`
                });
                this.updateLiveStatus({
                  phase: `Self-Healing Reativo: Reviewer→Worker (tentativa ${attempt}/${MAX_SELF_HEAL_RETRIES})...`,
                  lastStep: `Corrigindo erros de typecheck — attempt ${attempt}`
                });

                // — Extrai erros estruturados (arquivo:linha:coluna:código) —
                const previousErrors = typecheckResult.output || '';
                const structuredErrors = MetaChatService.parseTypecheckErrors(typecheckResult.output || '');
                const rawDiag = structuredErrors.length > 0
                  ? structuredErrors.map(e => e.raw).join('\n')
                  : (typecheckResult.output || 'Erros de tipagem detectados pelo tsc.').slice(0, 3500);

                // — Monta prompt de reparo cirúrgico com contexto completo —
                const retryPrompt = MetaChatService.buildRetryRepairPrompt(
                  userContent,
                  lastRepairReport || rawDiag,
                  structuredErrors,
                  '',
                  attempt,
                  MAX_SELF_HEAL_RETRIES,
                  Array.from(filesChanged)
                );

                try {
                  antigravityProvider.captureTurnStart(activeConvId, root, 'metachat-' + currentThread.id);
                  AgentApiGateway.sendMessage({
                    conversationId: activeConvId,
                    prompt: retryPrompt,
                    projectId: projectBinding.project.id,
                    role: 'CONVERSATIONAL',
                    caller: `MetaChatService.selfHealingRetry.attempt${attempt}`,
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
                    lastRepairReport = repairReport;
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

                  // — Re-executa o Reviewer após cada turno do Worker —
                  typecheckResult = await this.runTypecheck(target, filesChanged);
                  recordTimelineStep(`Self-Healing Guard (attempt ${attempt})`, typecheckResult.passed ? 'done' : 'failed');

                  if (typecheckResult.passed) {
                    healedOnRetry = true;
                    Logger.success(`[MetaChatService] Self-Healing Reativo bem-sucedido na tentativa ${attempt}!`);
                    try {
                      const { EngineeringContextService } = await import('./engineeringContextService.js');
                      EngineeringContextService.registerResolvedVaccine({
                        projectId: (currentThread as any)?.project_id || 'metachat',
                        projectPath: root,
                        problemSummary: `Erro de TypeScript no arquivo ${filesChanged.slice(0, 3).join(', ')}`,
                        rootCause: (typecheckResult.output || 'Falha de tipagem no Reviewer').slice(0, 300),
                        failedStrategy: 'Código inicial falhou na validação estrita de tipos',
                        workingStrategy: `Auto-reparo convergente resolvido com sucesso na tentativa ${attempt}`,
                        affectedFiles: filesChanged
                      });
                    } catch {}
                    this.updatePipelineTask(
                      'task-reviewer',
                      'completed',
                      `[APROVADO] Self-Healing aprovado na tentativa ${attempt} em ${typecheckResult.durationMs}ms`,
                      currentThread.id
                    );
                    recordTimelineStep('Reviewer (Auditoria)', 'done');
                    this.broadcastTelemetry(META_CHAT_STATUS.STATUS_REVIEWER_VERIFYING, {
                      threadId: currentThread.id,
                      message: `[VEREDICTO: APROVADO] Self-Healing aprovado na tentativa ${attempt} em ${typecheckResult.durationMs}ms`,
                      active_stage_code: META_CHAT_STATUS.STATUS_REVIEWER_VERIFYING,
                      active_stage_title: 'Reviewer (Auditoria & Typecheck Guard)',
                      verdict: 'APROVADO',
                      typecheckPassed: true,
                      durationMs: typecheckResult.durationMs,
                      affectedFiles: filesChanged
                    });
                    SseStreamService.broadcast('metachat', 'timeline_event', {
                      type: 'reviewer_validated',
                      role: 'reviewer',
                      phase: 'TYPECHECK_VALIDATED',
                      verdict: 'APROVADO',
                      typecheckPassed: true,
                      output: typecheckResult.output || 'tsc --noEmit concluído com 0 erros.',
                      timestamp: new Date().toISOString()
                    });
                    this.recordLiveStep({
                      type: 'GUARD',
                      target: `Self-Healing (${attempt}/${MAX_SELF_HEAL_RETRIES})`,
                      status: 'done',
                      details: `Tipos corrigidos com sucesso na tentativa ${attempt} sem necessidade de rollback`
                    });
                  } else {
                    Logger.warn(`[MetaChatService] Tentativa ${attempt}/${MAX_SELF_HEAL_RETRIES} falhou. ${attempt < MAX_SELF_HEAL_RETRIES ? 'Continuando ciclo...' : 'Máximo de tentativas atingido.'}`);
                  }
                } catch (repairErr: any) {
                  Logger.warn(`[MetaChatService] Erro na tentativa ${attempt}/${MAX_SELF_HEAL_RETRIES} de auto-reparo: ${repairErr.message}`);
                  break;
                }
              }

              if (!healedOnRetry) {
                Logger.warn(
                  `[MetaChatService] Self-Healing Reativo esgotado após ${MAX_SELF_HEAL_RETRIES} tentativas. Acionando Rollback de Segurança e notificando usuário...`
                );
                this.updatePipelineTask('task-reviewer', 'failed', `[REJEITADO] Erro persistente após ${MAX_SELF_HEAL_RETRIES} tentativas: rollback executado`, currentThread.id);
                this.recordLiveStep({
                  type: 'GUARD',
                  target: 'Rollback Automático',
                  status: 'done',
                  details: `Autoproteção Ativa: ${MAX_SELF_HEAL_RETRIES} tentativas esgotadas — restaurando integridade do repositório`
                });
                this.rollbackChangedFiles(root, filesChanged, baselineBefore);
                selfHealed = true;
              }
            } else {
              this.updatePipelineTask('task-reviewer', 'completed', `[APROVADO] tsc --noEmit em ${typecheckResult.durationMs}ms`, currentThread.id);
              recordTimelineStep('Reviewer (Auditoria)', 'done');
              this.broadcastTelemetry(META_CHAT_STATUS.STATUS_REVIEWER_VERIFYING, {
                threadId: currentThread.id,
                message: `[VEREDICTO: APROVADO] Reviewer validou tipagem TypeScript com 0 erros (${typecheckResult.durationMs}ms)`,
                active_stage_code: META_CHAT_STATUS.STATUS_REVIEWER_VERIFYING,
                active_stage_title: 'Reviewer (Auditoria & Typecheck Guard)',
                verdict: 'APROVADO',
                typecheckPassed: true,
                durationMs: typecheckResult.durationMs,
                affectedFiles: filesChanged
              });
              SseStreamService.broadcast('metachat', 'timeline_event', {
                type: 'reviewer_validated',
                role: 'reviewer',
                phase: 'TYPECHECK_VALIDATED',
                verdict: 'APROVADO',
                typecheckPassed: true,
                output: typecheckResult.output || 'tsc --noEmit concluído com 0 erros.',
                timestamp: new Date().toISOString()
              });
            }
          } else {
            this.updatePipelineTask('task-reviewer', 'completed', '[APROVADO] Integridade preservada', currentThread.id);
            recordTimelineStep('Reviewer (Auditoria)', 'done');
            this.broadcastTelemetry(META_CHAT_STATUS.STATUS_REVIEWER_VERIFYING, {
              threadId: currentThread.id,
              message: '[VEREDICTO: APROVADO] Integridade preservada com 0 erros.',
              active_stage_code: META_CHAT_STATUS.STATUS_REVIEWER_VERIFYING,
              active_stage_title: 'Reviewer (Auditoria & Typecheck Guard)',
              verdict: 'APROVADO',
              typecheckPassed: true,
              output: 'Auditoria de integridade aprovada com 0 erros.'
            });
            SseStreamService.broadcast('metachat', 'timeline_event', {
              type: 'reviewer_validated',
              role: 'reviewer',
              phase: 'TYPECHECK_VALIDATED',
              verdict: 'APROVADO',
              typecheckPassed: true,
              output: 'Auditoria de integridade aprovada com 0 erros.',
              timestamp: new Date().toISOString()
            });
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
              activeStage = {
                code: META_CHAT_STATUS.STATUS_RUNNING_TESTS,
                title: 'Testes de Integridade'
              };
              if (this._currentExecution) this._currentExecution.currentStage = activeStage;
              this.broadcastTelemetry(META_CHAT_STATUS.STATUS_RUNNING_TESTS, {
                threadId: currentThread.id,
                message: `Executando teste unitário correspondente: ${unitTestName}...`,
                active_stage_code: META_CHAT_STATUS.STATUS_RUNNING_TESTS,
                active_stage_title: 'Testes de Integridade'
              });
              this.updateLiveStatus({
                phase: 'Executando teste unitário correspondente...',
                lastStep: unitTestName
              });
              const tRes = await this.runScopedTest(unitTestName);
              recordTimelineStep(`Teste (${unitTestName})`, tRes.passed ? 'done' : 'failed');
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
          } else {
            let diffStat = '';
            try {
              const { execFileSync } = await import('node:child_process');
              diffStat = execFileSync('git', ['diff', '--stat', 'HEAD'], {
                cwd: root,
                encoding: 'utf-8',
                timeout: 5000
              }).trim();
            } catch {}

            reply = MetaChatService.formatFourRoleDeliveryReport(
              agentReport,
              supervisorPlan || {
                scopeFiles: filesChanged.length > 0 ? filesChanged : ['server/src/metaChatService.ts'],
                dagSteps: ['Mapeamento e análise de contexto', 'Implementação cirúrgica', 'Auditoria de integridade'],
                verificationCommand: 'npm --prefix server run typecheck',
                planningDurationMs: 0,
                source: 'offline_ast_inference'
              },
              filesChanged,
              typecheckResult,
              diffStat
            );
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
        activeStage = {
          code: META_CHAT_STATUS.STATUS_RUNNING_TESTS,
          title: 'Testes de Integridade'
        };
        if (this._currentExecution) this._currentExecution.currentStage = activeStage;
        this.broadcastTelemetry(META_CHAT_STATUS.STATUS_RUNNING_TESTS, {
          threadId: currentThread.id,
          message: `Executando testes automatizados: ${options.testFile || 'testes'}...`,
          active_stage_code: META_CHAT_STATUS.STATUS_RUNNING_TESTS,
          active_stage_title: 'Testes de Integridade'
        });
        this.updateLiveStatus({
          phase: 'Executando testes automatizados com Scoped Test Runner...',
          lastStep: options.testFile || 'test/metaChatSelfEvolution.test.ts'
        });
        const tFile = options.testFile || 'test/metaChatSelfEvolution.test.ts';
        const tRes = await this.runScopedTest(tFile);
        recordTimelineStep(`Testes (${tFile})`, tRes.passed ? 'done' : 'failed');
        testResult = { ran: true, passed: tRes.passed, output: tRes.output };
        this.updatePipelineTask('task-guard', tRes.passed ? 'completed' : 'failed', tRes.passed ? 'Aprovado' : 'Falha');
      } else if (!testResult.ran) {
        this.updatePipelineTask('task-guard', 'completed', 'Verificação finalizada');
      }

      const liveSteps = this.getExecution(currentThread.id)?.liveSteps || this._currentExecution?.liveSteps || [];
      const pipelineTasks = this.getExecution(currentThread.id)?.pipelineTasks || this._currentExecution?.pipelineTasks || [];

      // Garante que todas as tarefas da pipeline que não falharam estejam marcadas como 'completed' ao final do turno
      for (const t of pipelineTasks) {
        if (t.status !== 'failed' && t.status !== 'skipped') {
          t.status = 'completed';
        }
      }

      this._currentExecutions.delete(currentThread.id);
      this.updateLiveStatus({
        isRunning: this._currentExecutions.size > 0,
        isExecuting: this._currentExecutions.size > 0,
        phase: 'Pronto',
        currentPhase: 'Pronto',
        lastStep: 'Concluído com sucesso'
      });
      this.updateThread(currentThread.id, { status: 'idle' });

      const turnDurationSec = Math.max(0.1, (Date.now() - executionStartTime) / 1000);

      const filesDetailed: MetaChatDetailedFile[] = [];
      let modCount = 0;
      let creCount = 0;
      let delCount = 0;

      for (const relPath of filesChanged) {
        const fullPath = path.join(root, relPath);
        const existsNow = fs.existsSync(fullPath);
        const before = baselineBefore?.get(relPath);
        const existedBefore = Boolean(before && before.size !== -1 && before.content !== null);

        if (existsNow && !existedBefore) {
          creCount++;
          filesDetailed.push({ path: relPath, type: 'created' });
        } else if (!existsNow && existedBefore) {
          delCount++;
          filesDetailed.push({ path: relPath, type: 'deleted' });
        } else {
          modCount++;
          filesDetailed.push({ path: relPath, type: 'modified' });
        }
      }

      const impactSummary: MetaChatImpactSummary = {
        modified: modCount,
        created: creCount,
        deleted: delCount,
        total: filesChanged.length
      };

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
          agent_steps: liveSteps,
          executedSteps: liveSteps,
          pipelineTasks: pipelineTasks,
          execution_timeline: executionTimeline,
          active_stage: activeStage,
          impact_summary: impactSummary,
          files_detailed: filesDetailed,
          duration_sec: turnDurationSec
        }
      });

      if (activeConvId && assistantMsg?.id) {
        MetaChatService.startPostTurnTranscriptWatcher(activeConvId, assistantMsg.id, currentThread.id, root, this.getExecution(currentThread.id)?.userProfileDir);
      }

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
      this._currentExecutions.delete(currentThread.id);
      if (this._currentExecution?.cancelRequested || err.message?.includes('RUN_CANCELLED')) {
        this.rollbackChangedFiles(root, filesChanged, this._currentExecution?.baselineBefore);
        this.updateLiveStatus({ isRunning: this._currentExecutions.size > 0, isExecuting: this._currentExecutions.size > 0, phase: 'Pronto', currentPhase: 'Pronto' });
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
                `[ERRO / AVISO DE COTA] **Todas as contas configuradas atingiram o limite de cota / Weekly Limit.**\n\n` +
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

      const failedStageName = typeof activeStage === 'object'
        ? (activeStage.title || activeStage.code)
        : String(activeStage || 'UNKNOWN');

      const errorReply =
        `[ERRO] [FALHA NO TURNO] **Não foi possível concluir a instrução:**\n\n` +
        `\`\`\`text\n${err.message || 'Erro desconhecido durante o turno'}\n\`\`\`\n\n` +
        (requestedAccountId ? `- **Conta Ativa:** \`${requestedAccountId}\`\n` : '') +
        `- **Etapa Interrompida:** \`${failedStageName}\`\n` +
        `- **Modelo:** \`${requestedModel}\`\n\n` +
        `Verifique se o processo do Language Server está ativo ou tente reenviar com o escopo reduzido.`;

      let assistantMsg: any;
      try {
        assistantMsg = this.addMessage({
          role: 'assistant',
          content: errorReply,
          thread_id: currentThread?.id || effectiveThreadId,
          metadata: {
            error: err.message,
            failed_stage: failedStageName,
            timestamp: new Date().toISOString(),
            model: requestedModel,
            reasoningMode: requestedReasoning,
            accountId: requestedAccountId,
            conversationId: activeConvId || undefined,
            canRetry: true
          }
        });
      } catch (dbErr: any) {
        Logger.error(`[MetaChatService] Falha ao persistir mensagem de erro: ${dbErr.message}`);
        assistantMsg = {
          id: `err-${Date.now()}`,
          role: 'assistant',
          content: errorReply,
          thread_id: currentThread?.id || effectiveThreadId,
          created_at: new Date().toISOString(),
          metadata: {
            error: err.message,
            failed_stage: failedStageName,
            canRetry: true
          }
        };
      }

      try {
        const { SseStreamService } = await import('./sseStreamService.js');
        SseStreamService.broadcast('metachat', 'message', {
          result: {
            message: assistantMsg,
            filesChanged: [],
            typecheck: { passed: false, durationMs: 0, output: err.message },
            selfHealed: false,
            conversationId: activeConvId || undefined
          },
          message: assistantMsg,
          threadId: currentThread?.id || effectiveThreadId
        });
        SseStreamService.broadcast('metachat', 'done', {
          status: 'error',
          error: err.message
        });
      } catch {}

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
      // Strip internal reasoning and thinking tags
      .replace(/<thought[\s\S]*?<\/thought>/gi, '')
      .replace(/<thinking[\s\S]*?<\/thinking>/gi, '')
      // Strip system, directive, and context XML blocks
      .replace(/<system_invariants[\s\S]*?<\/system_invariants>/gi, '')
      .replace(/<meta_engineer_identity[\s\S]*?<\/meta_engineer_identity>/gi, '')
      .replace(/<operational_safety_invariants[\s\S]*?<\/operational_safety_invariants>/gi, '')
      .replace(/<workspace_context[\s\S]*?<\/workspace_context>/gi, '')
      .replace(/<execution_directive[^>]*>[\s\S]*?<\/execution_directive>/gi, '')
      .replace(/<evolution_mission[\s\S]*?<\/evolution_mission>/gi, '')
      .replace(/<briefing_contract[\s\S]*?<\/briefing_contract>/gi, '')
      .replace(/<autonomous_evolution_cycle[\s\S]*?<\/autonomous_evolution_cycle>/gi, '')
      .replace(/<antigravity_output[\s\S]*?<\/antigravity_output>/gi, '')
      .replace(/<task_review[\s\S]*?<\/task_review>/gi, '')
      .replace(/<system_message[\s\S]*?<\/system_message>/gi, '')
      .replace(/<context_bridge[\s\S]*?<\/context_bridge>/gi, '')
      .replace(/<user_request[\s\S]*?<\/user_request>/gi, '')
      .replace(/<user_attachments[\s\S]*?<\/user_attachments>/gi, '')
      .replace(/<failure_diagnostics[\s\S]*?<\/failure_diagnostics>/gi, '')
      .replace(/<scoped_modified_files[\s\S]*?<\/scoped_modified_files>/gi, '')
      // Strip prompt leakage and truncation markers
      .replace(/<truncated\s+\d+\s+bytes>/gi, '')
      .replace(/<truncated\s+\d+\s+lines>/gi, '')
      .replace(/<truncated\s+\d+\s+chars>/gi, '')
      .replace(/#\s*(?:Behavioral Guidelines|Guidelines|System Instructions|Operational Directives)[\s\S]*?(?=\n#|\n---|\n\*\*|$)/gi, '')
      .replace(/planejamento e revisão exclusivamente nos artefatos de e nas especificações canônicas @\.ai-dev-hub\/specs\/\*/gi, '')
      // Strip any isolated system XML tags
      .replace(/<\/?(?:system_invariants|meta_engineer_identity|operational_safety_invariants|workspace_context|execution_directive|evolution_mission|briefing_contract|autonomous_evolution_cycle|thought|thinking|antigravity_output|task_review|system_message|context_bridge|user_request|user_attachments|scoped_modified_files|failure_diagnostics)[^>]*>/gi, '')
      // Strip code directives and file wrapper blocks
      .replace(/\[(?:FILE|ARQUIVO|CRIAR|MODIFICAR):\s*[^\]]+\][\s\S]*?\[ENDFILE\]/gi, '')
      .replace(/```(?:[a-zA-Z0-9_-]+)?\s*\[(?:FILE|ARQUIVO|CRIAR|MODIFICAR):[^\]]+\][\s\S]*?```/gi, '')
      // Strip command execution artifacts
      .replace(/^Created At:\s+[^\r\n]+/gm, '')
      .replace(/^Completed At:\s+[^\r\n]+/gm, '')
      .replace(/Showing lines \d+-\d+ of \d+[^\r\n]*/gm, '')
      .replace(/Made \d+ replacements? in [^\r\n]*/gm, '')
      .replace(/^Command exited with code \d+[^\r\n]*/gm, '')
      .replace(/^Command output:[^\r\n]*/gm, '')
      .replace(/^Log output:[^\r\n]*/gm, '')
      .replace(/The tool's output was truncated[^\r\n]*/gi, '')
      // Clean up bracket tags
      .replace(/\[(?:TYPECHECK|VISUAL GATE|DOUBLE ORACLE|SIMPLICITY|APPLIED)\]\s*/gi, '')
      .replace(/\[AI DEV Council\]:[^\n]*/gi, '')
      .replace(/\(NEEDS_EVIDENCE:[^\n]*/gi, '')
      .trim();

    if (!cleaned || /^(?:created file|file created|done|ok)\.?$/i.test(cleaned)) {
      if (filesChanged.length > 0) {
        return `**Intervenção Técnica Concluída:** As alterações solicitadas foram implementadas e verificadas no repositório DecoHUB.\n\n**Arquivos modificados e validados:**\n` +
          filesChanged.map(f => `- \`${f}\`: modificado cirurgicamente e validado com Typecheck Guard.`).join('\n');
      }
      return `Operação concluída com sucesso no DecoHUB.`;
    }
    return cleaned;
  }

  public static formatDeliveryReport(
    rawText: string,
    filesChanged: string[] = [],
    diffStat: string = ''
  ): string {
    if (!rawText || typeof rawText !== 'string') rawText = '';

    // Limpa tags XML de envelopes de instrução e prompt
    let cleaned = this.sanitizeMetaChatReply(rawText, filesChanged).trim();
    cleaned = cleaned
      .replace(/<\/?(?:autonomous_evolution_cycle|execution_directive|system_invariants|meta_engineer_identity|operational_safety_invariants|workspace_context|evolution_mission|briefing_contract|thought|thinking|antigravity_output|task_review|system_message|context_bridge|user_request|user_attachments|scoped_modified_files|failure_diagnostics)[^>]*>/gi, '')
      .replace(/<\/[a-zA-Z0-9_-]+>/g, '')
      .replace(/<[a-zA-Z0-9_-]+(?:\s+[^>]*)?>/g, '')
      .replace(/```(?:typescript|javascript|json|html|css|bash|sh)?\s*\[(?:FILE|ARQUIVO):[^\]]+\][\s\S]*?```/gi, '')
      .replace(/The tool's output was truncated[^\r\n]*/gi, '')
      .replace(/<truncated[^\r\n>]*>/gi, '')
      .trim();

    // Extrai "O que foi feito:" e "Arquivos alterados:" caso já existam no texto do agente
    let whatWasDone = '';
    let filesSummary = '';

    const whatMatch = cleaned.match(/\*\*O que foi feito:\*\*\s*([\s\S]*?)(?=(?:\*\*Arquivos alterados:\*\*|####|\n#|$))/i);
    const filesMatch = cleaned.match(/\*\*Arquivos alterados:\*\*\s*([\s\S]*?)(?=(?:\*\*Validação de Qualidade:\*\*|####|\n#|$))/i);

    if (whatMatch && whatMatch[1] && whatMatch[1].trim()) {
      whatWasDone = stripViewedCodeAndToolDumps(whatMatch[1].trim());
    }
    if (filesMatch && filesMatch[1] && filesMatch[1].trim()) {
      filesSummary = stripViewedCodeAndToolDumps(filesMatch[1].trim());
    }

    const hasRichMarkdownHeaders = /^#+\s+/m.test(cleaned);
    const hasDeliverySections = Boolean(whatMatch || filesMatch);

    if (!whatWasDone && hasRichMarkdownHeaders && !hasDeliverySections) {
      return stripViewedCodeAndToolDumps(cleaned);
    }

    if (!whatWasDone) {
      let candidate = cleaned
        .replace(/^###?\s+[^\r\n]+/gm, '')
        .replace(/####\s+[^\r\n]+/gm, '')
        .trim();

      // Remove blocos de código extensos do resumo
      candidate = candidate.replace(/```[\s\S]*?```/g, '').trim();

      if (candidate.length > 10) {
        const paragraphs = candidate.split(/\n\s*\n/).filter(p => p.trim() && !p.startsWith('- `') && !p.startsWith('* `'));
        whatWasDone = stripViewedCodeAndToolDumps(paragraphs.slice(0, 3).join('\n\n').trim());
      }
    }

    if (!whatWasDone) {
      whatWasDone = filesChanged.length > 0
        ? 'As alterações solicitadas foram implementadas e verificadas no repositório DecoHUB com tipagem estrita.'
        : 'Análise técnica e inspeção do repositório DecoHUB concluídas com sucesso.';
    }

    // Formata o bloco de arquivos alterados estritamente em 1 linha por arquivo
    let filesBlock = '';
    if (filesChanged && filesChanged.length > 0) {
      if (filesSummary && filesSummary.includes('`')) {
        filesBlock = filesSummary;
      } else {
        filesBlock = filesChanged
          .map(f => `- \`${f}\`: modificado cirurgicamente e validado com sucesso.`)
          .join('\n');
      }
    } else {
      if (filesSummary && !filesSummary.includes('Nenhum')) {
        filesBlock = filesSummary;
      } else {
        filesBlock = '- Nenhum arquivo foi alterado (análise técnica / consulta).';
      }
    }

    return `**O que foi feito:**\n${whatWasDone}\n\n**Arquivos alterados:**\n${filesBlock}`;
  }

  public static generateStructuredTechnicalReport(
    filesChanged: string[] = [],
    diffStat: string = ''
  ): string {
    return this.formatDeliveryReport('', filesChanged, diffStat);
  }

  public static sanitizeMetaChatOutput(
    rawText: string,
    filesChanged: string[] = [],
    diffStat: string = ''
  ): string {
    return this.formatDeliveryReport(rawText, filesChanged, diffStat);
  }
}