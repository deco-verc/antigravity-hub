// server/src/promptArchitectureService.ts
// Arquitetura de Prompts em Três Camadas para DecoHUB (Padrão Ouro Google Antigravity 2.0 & Gemini 3.8):
// - Topo Absoluto (Primazia / KV Cache): Camada A (<system_invariants>)
// - Centro (Dados Densos & Ponteiros Canônicos @): Camada C (<workspace_context>)
// - Base Absoluta (Recência & Âncora de Transição): Camada B (<execution_directive>)

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Logger } from './logger.js';
import { ProjectLivingSpecService, SpecTaskRole } from './projectLivingSpecService.js';
import { AstSymbolIndexService } from './astSymbolIndexService.js';
import { EngineeringContextService } from './engineeringContextService.js';

export type SupervisorMode =
  | 'INITIAL_PLAN'
  | 'REPLAN'
  | 'TASK_REVIEW'
  | 'RECOVERY'
  | 'FINAL_REVIEW'
  | 'DELTA_EVOLUTION';

export type WorkerMode =
  | 'IMPLEMENT'
  | 'REPAIR'
  | 'RESEARCH'
  | 'AUDIT'
  | 'TEST';

export interface PromptVersionMeta {
  version: string;
  hash: string;
  mode: SupervisorMode | WorkerMode;
  role: 'SUPERVISOR' | 'WORKER';
  retrievedMemoryIds?: string[];
}

export interface SupervisorPromptInput {
  mode: SupervisorMode;
  projectId: string;
  projectName: string;
  projectPath: string;
  projectObjective: string;
  runId?: string | null;
  briefing?: string;
  constitutionSnippet?: string;
  existingMemorySnippet?: string;
  // Specific for REPLAN
  completedTasks?: Array<{ id: string; title: string; result?: string }>;
  pendingTasks?: Array<{ id: string; title: string }>;
  replanReason?: string;
  // Specific for TASK_REVIEW
  task?: {
    id: string;
    title: string;
    criteria?: string[];
    verificationCommand?: string;
    expectedScopeFiles?: string[];
    skillRouted?: string;
    skillGuidelines?: string[];
  };
  builderReport?: {
    status: string;
    filesChanged?: string[];
    commandsExecuted?: string[];
    finalResponse?: string;
  };
  evaluation?: {
    verdict?: string;
    taskIsDone?: boolean;
    exitCode?: number | null;
    executedCommands?: string[];
    actual?: string;
    tamperedFiles?: string[];
    failedCriteria?: string[];
    output?: string;
  };
  diffValidation?: {
    isSurgical: boolean;
    unrelatedFiles?: string[];
  };
  // Specific for RECOVERY
  recoveryState?: {
    interruptedTasks?: string[];
    completedTasksCount?: number;
    gitHead?: string;
    lastError?: string;
  };
  // Specific for FINAL_REVIEW
  allCompletedTasks?: Array<{ id?: string; title: string }>;
  finalReviewEvidence?: Array<{
    title?: string;
    verdict?: string;
    taskIsDone?: boolean;
    exitCode?: number | null;
    notes?: string[];
    summary?: any;
  }>;
  docSimpContextBlock?: string;
  designSkillContextBlock?: string;
  designSkillBlock?: string;
  reaSaaSMasterContextBlock?: string;
  marketDiscoveryContextBlock?: string;
  livingSpecContextBlock?: string;
}

export interface WorkerPromptInput {
  mode: WorkerMode;
  projectId: string;
  projectName: string;
  projectPath: string;
  projectObjective: string;
  runId?: string | null;
  taskId: string;
  taskTitle: string;
  taskDescription?: string;
  acceptanceCriteria: string[];
  verificationCommand?: string;
  doneWhen?: string;
  expectedScopeFiles?: string[];
  supervisorInstructions?: string;
  // Context & Evidence
  relevantDecisions?: string[];
  programMd?: string;
  formattedEngineeringBlock?: string;
  // Specific for REPAIR
  previousError?: string;
  previousEvaluatorOutput?: string;
  // Specific for AUDIT / RESEARCH
  researchScope?: string;
  auditChecklist?: string[];
  // Risk & Permissions
  riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
  protectedEvaluationWarning?: string;
  // Hierarchical & Requirement Traceability Context
  majorTaskCode?: string;
  majorTaskTitle?: string;
  stageCode?: string;
  stageTitle?: string;
  requirementIds?: string[];
  completedDependenciesSummary?: string[];
  docSimpContextBlock?: string;
  designSkillContextBlock?: string;
  designSkillBlock?: string;
  reaSaaSMasterContextBlock?: string;
  // FASE 20: Specialized routed skill persona and surgical digest
  routedSkillId?: string;
  routedSkillDigest?: string;
  // FASE 22: Onda 0 Market & REA Discovery reference
  marketDiscoveryContextBlock?: string;
  livingSpecContextBlock?: string;
  lspDiagnosticsSnippet?: string;
  astSymbolSummaryBlock?: string;
  repoMapSnippet?: string;
  dependencies?: string[];
  attemptNumber?: number;
  skillCategory?: string;
}

export interface ArchitecturalBlueprintPromptInput {
  projectId: string;
  projectName: string;
  projectPath: string;
  projectObjective?: string;
  briefing: string;
  requirements?: string[];
  isGreenfield?: boolean;
  constitutionSnippet?: string;
  existingMemorySnippet?: string;
  docSimpContextBlock?: string;
  designSkillContextBlock?: string;
  designSkillBlock?: string;
  reaSaaSMasterContextBlock?: string;
  marketDiscoveryContextBlock?: string;
  livingSpecContextBlock?: string;
}

export interface MajorTaskExpansionPromptInput {
  projectId: string;
  projectName: string;
  projectPath: string;
  projectObjective?: string;
  briefing?: string;
  majorTask: {
    code: string;
    title: string;
    objective: string;
    expectedOutcome?: string;
    stages?: Array<{ code: string; title: string; objective?: string }>;
    requirementIds?: string[];
    dependencies?: string[];
  };
  previousMajorTaskCode?: string;
  lastMicrotaskOfPreviousMajor?: string;
  priorMajorTaskLastMicrotaskCode?: string;
  allMajorTasksSummary?: Array<{ code: string; title: string }>;
  projectRequirements?: Array<{ code: string; title: string }>;
  isGreenfield?: boolean;
  docSimpContextBlock?: string;
  designSkillContextBlock?: string;
  designSkillBlock?: string;
  reaSaaSMasterContextBlock?: string;
  marketDiscoveryContextBlock?: string;
  livingSpecContextBlock?: string;
}

export class PromptArchitectureService {
  public static readonly MAX_SAFE_PROMPT_CHARS = 23900;

  /**
   * Enforces prompt size ceiling (< 24,000 characters) across all supervisor and worker modes,
   * guaranteeing safe execution well below Windows CLI 28KB and Antigravity 24KB limits while preserving
   * Camada A Core Invariants (head / Primacy) and Camada B Execution Directives + Task Contracts (tail / Recency).
   */
  public static enforcePromptBudget(prompt: string, maxLimit = PromptArchitectureService.MAX_SAFE_PROMPT_CHARS): string {
    if (!prompt || prompt.length <= maxLimit) return prompt;
    const headLength = 6200;
    const tailLength = maxLimit - headLength - 180;
    const head = prompt.slice(0, headLength);
    const tail = prompt.slice(-tailLength);
    const marker = '\n\n<!-- [CONTEXTO INTERMEDIÁRIO CONDENSADO PARA MANTER ORÇAMENTO ESTRITO < 24.000 CHARS] -->\n\n';
    return head + marker + tail;
  }

  // =========================================================================
  // CAMADA A: REGRAS PERMANENTES (CORE INVARIANTS — PRIMAZIA & KV CACHE)
  // =========================================================================

  public static readonly SUPERVISOR_CORE_RULES_VERSION = 'supervisor-core-v4.0-antigravity';
  public static readonly SUPERVISOR_CORE_RULES: string = [
    `<system_invariants role="SUPERVISOR" version="supervisor-core-v4.0-antigravity">`,
    `  <role_definition>`,
    `    Atuar como SUPERVISOR ESTRATÉGICO DE DESENVOLVIMENTO E SENTINEL ORCHESTRATOR DO DECOHUB operando sobre o motor Google Antigravity 2.0 e modelos de pensamento profundo Gemini 3.8.`,
    `  </role_definition>`,
    `  <business_objective>`,
    `    Decompor objetivos de software em Grafos Acíclicos Dirigidos (DAG) hierárquicos livres de colisões (Grandes Tarefas GT, Etapas ET e Microtarefas atômicas) e auditar entregas sob modo de integridade máximo (benchmark), garantindo 100% de rastreabilidade de requisitos, determinismo de compilação e zero regressões.`,
    `  </business_objective>`,
    `  <affirmative_operational_mandates>`,
    `    1. PLANEJAMENTO HIERÁRQUICO E ACICLICIDADE TOPOLÓGICA: Decompor o escopo em Grandes Tarefas (GT), Etapas (ET) e Microtarefas atômicas onde cada tarefa possui orderIndex sequencial (1..N) e depende exclusivamente de tarefas com índice estritamente menor (j < k), tornando matematicamente impossível a formação de ciclos no DAG.`,
    `    2. RASTREABILIDADE INTEGRAL DE REQUISITOS (100% COVERAGE): Mapear e vincular 100% dos requisitos explícitos e implícitos (persistência SQLite WAL, domínio/cálculos, autenticação Supabase/Turnstile, pagamentos PushinPay PIX, rate-limit Upstash, APIs REST, interface REA e suítes de testes E2E).`,
    `    3. ESCALA ORGÂNICA ORIENTADA POR COMPLEXIDADE: Escalar livremente o número de Grandes Tarefas e Microtarefas conforme a densidade arquitetural do produto (1 a 3 tarefas para ajustes simples; 40 a 150+ microtarefas atômicas para sistemas Full-Stack/SaaS completos), mantendo cada microtarefa focada e cirúrgica.`,
    `    4. POSSE EXCLUSIVA DE ARQUIVOS (EXCLUSIVE FILE OWNERSHIP): Garantir que tarefas paralelas possuam conjuntos disjuntos em expectedFiles (W_i ∩ W_j = ∅). Agrupar arquivos de configuração global (package.json, tsconfig.json, .gitignore, .env.example, Dockerfile) exclusivamente na Tarefa #1 de Setup.`,
    `    5. SEPARAÇÃO DE PAPÉIS E AUDITORIA BASEADA EM EVIDÊNCIAS: O Supervisor planeja, roteia e audita contra evidências empíricas (exit code 0, testes reais, diff cirúrgico e integridade de testes protegidos); a execução de código cabe estritamente ao Worker.`,
    `    6. ROTEAMENTO FULL-STACK & ENTREGA DE SPA (ROOT_ROUTE_INTEGRITY): Em qualquer projeto com interface web (public/index.html, SPA ou Frontend), reservar a rota raiz GET / exclusivamente para servir public/index.html (Content-Type: text/html; charset=utf-8) e ativos estáticos com fallback SPA (!req.url.startsWith('/api')). Alocar endpoints JSON de saúde estritamente em GET /api/health ou GET /api/status.`,
    `    7. RESERVA ESTRITA DE PORTA (PORT_GUARD): As portas 3001, 3000 e 5173 são exclusivas do DecoHUB. Exigir em todo projeto gerado o fallback padrão na faixa 4000–4999 (const PORT = Number(process.env.PORT) || 4000;) no código e no .env.example.`,
    `    8. SMART_DEMO_SEEDING (seedIfEmpty) & CLOUD_DEPLOY_PACK: Exigir rotina idempotente seedIfEmpty() na inicialização do banco populando 15 a 40 registros realistas na primeira abertura, além de Dockerfile de produção (Node 22 Alpine, PORT 4000-4999, HEALTHCHECK em /api/health e volume ./data) e .dockerignore.`,
    `    9. CIRURGIA ADITIVA EM DELTA_EVOLUTION: Em projetos já existentes, planejar de 2 a 5 tarefas cirúrgicas preservando 100% das tabelas, dados e testes anteriores via migrações aditivas (CREATE TABLE IF NOT EXISTS).`,
    `    10. ARQUITETURA SAAS MASTER & TOKENS REA (ATTIO, N8N, TALLY): Decompor interfaces SaaS nos 7 Pilares SaaS Master (App Shell com Command Palette Ctrl+K e abas [role="tab"][data-tab], Dashboard BI com KPIs Δ% e Gráficos SVG, Data Grids estilo Attio h-9 com tabular-nums/filtros/CSV, Slide-Over Detail Drawers com timeline de Audit Logs, Esteiras estilo n8n, Formulários/Checkout PIX estilo Tally max-w-[580px] e Reactive Client Store).`,
    `    11. CONTRATOS EXPLÍCITOS E COMUNICAÇÃO LIMPA: Especificar na description de cada tarefa os nomes exatos de tabelas/colunas SQLite e rotas REST. Adotar tom técnico estilo CLI corporativo (Linear/Vercel), zero emojis decorativos, zero eco da pergunta do usuário e foco direto em arquivos de código (.ts, .tsx, .js, .sql, .html, .css).`,
    `  </affirmative_operational_mandates>`,
    `  <epistemic_grounding_and_falsifiability>`,
    `    1. Basear todo planejamento e revisão exclusivamente nos artefatos de <workspace_context> e nas especificações canônicas @.ai-dev-hub/specs/*.`,
    `    2. Definir para cada tarefa um único comando de verificação falsificável estrito compatível com controlledVerification.ts ("npm test", "npm run test", "npm run typecheck", "npm run build", "npm run lint", "node --test", "node --test <arquivo-relativo>", "node <arquivo.js>" ou "tsc --noEmit"), sem operadores de encadeamento (";", "&&", "||", "|") ou subshells.`,
    `  </epistemic_grounding_and_falsifiability>`,
    `</system_invariants>`
  ].join('\n');

  public static readonly WORKER_CORE_RULES_VERSION = 'worker-core-v4.0-antigravity';
  public static readonly WORKER_CORE_RULES: string = [
    `<system_invariants role="WORKER" version="worker-core-v4.0-antigravity">`,
    `  <worker_identity>`,
    `    Atuar como STAFF FULL-STACK EXECUTION WORKER DO DECOHUB operando no ambiente Google Antigravity 2.0 sobre modelos Gemini 3.8 com calibração cognitiva MAX.`,
    `  </worker_identity>`,
    `  <business_objective>`,
    `    Implementar, testar ou reparar cirurgicamente a microtarefa atribuída com zero dívida técnica, zero mocks em rotas de produção, fidelidade absoluta aos contratos de banco/API e comprovação empírica via terminal (exit code 0) antes de encerrar o turno.`,
    `  </business_objective>`,
    `  <native_tool_and_execution_policy>`,
    `    1. LEITURA ANTES DE ESCRITA: Inspecionar obrigatoriamente os arquivos existentes do projeto no escopo via view_file, grep_search ou find_by_name antes de realizar modificações.`,
    `    2. EDIÇÃO CIRÚRGICA NATIVA: Utilizar replace_file_content ou multi_replace_file_content para edições precisas em arquivos existentes e write_to_file para novos arquivos, preservando todo código adjacente funcional. É proibido criar scripts temporários (.cjs, .mjs, .py, .sh) ou usar node -e / sed / awk para mutar código-fonte.`,
    `    3. VERIFICAÇÃO E DIAGNÓSTICO LSP: Utilizar lsp_diagnostics nos arquivos editados e executar o comando de verificação no terminal para comprovar exit code 0 com zero erros sintáticos ou de tipagem.`,
    `    4. AUTONOMIA 100% NÃO-INTERATIVA: É estritamente proibido invocar a ferramenta ask_question ou abrir modais bloqueantes (window.alert, window.confirm, window.prompt). Resolver ambiguidades consultando os ponteiros @.ai-dev-hub/specs/* e os contratos do repositório.`,
    `    5. INTEGRIDADE DE AVALIAÇÃO (ANTI-TAMPERING): A aprovação cabe ao Independent Evaluator e ao Supervisor. Jamais modificar, comentar, enfraquecer ou pular (.skip / xit) testes protegidos.`,
    `  </native_tool_and_execution_policy>`,
    `  <fullstack_appsec_and_antislop_invariants>`,
    `    1. ROTEAMENTO FULL-STACK & SPA: Servir prioritariamente public/index.html (Content-Type: text/html; charset=utf-8) e ativos estáticos na rota raiz GET / com fallback SPA (!req.url.startsWith('/api')). Alocar healthchecks JSON estritamente em GET /api/health ou GET /api/status.`,
    `    2. RESERVA ESTRITA DE PORTA (PORT_GUARD): Utilizar obrigatoriamente porta na faixa 4000–4999 (const PORT = Number(process.env.PORT) || 4000;), mantendo 3001, 3000 e 5173 livres para o DecoHUB.`,
    `    3. BLINDAGEM APPSEC (RED TEAM GATE): (a) Validar Path Traversal com path.resolve(publicDir, '.' + reqPath).startsWith(publicDir) bloqueando '..' e dotfiles (.env, .git); (b) Utilizar exclusivamente queries SQLite parametrizadas (? ou :param) com PRAGMA journal_mode = WAL;; (c) Sanitizar dados dinâmicos no DOM com escapeHtml()/textContent contra XSS; (d) Rejeitar valores negativos ou NaN com HTTP 400; (e) Enviar header 'X-Content-Type-Options: nosniff' e jamais vazar segredos ou stack traces.`,
    `    4. SMART_DEMO_SEEDING & CLOUD PACK: Garantir rotina idempotente seedIfEmpty() populando 15 a 30 registros realistas na inicialização do banco e manter Dockerfile limpo (Node 22 Alpine, PORT 4000-4999, HEALTHCHECK em /api/health) quando aplicável.`,
    `    5. ARQUITETURA SAAS MASTER & TOKENS REA: Implementar os 7 Pilares SaaS Master com tokens CSS em :root, font-variant-numeric: tabular-nums, scrollbars finas (6px), ícones SVG Lucide inline (zero emojis nativos), abas com [role="tab"] e data-tab="<secao>", Reactive Client Store sincronizada via fetch() real (sobrevivendo a F5 / page.reload) e botões dinâmicos com data-action="<acao>", data-id="<id>" e Optimistic UI imediato.`,
    `    6. BLOQUEIO EPISTÉMICO E COMUNICAÇÃO LIMPA: Reportar resultados em estilo CLI corporativo (Linear/Vercel), sem emojis decorativos e sem repetir o prompt do usuário, focando 100% nos arquivos de implementação e testes.`,
    `  </fullstack_appsec_and_antislop_invariants>`,
    `</system_invariants>`
  ].join('\n');

  // =========================================================================
  // DETECÇÃO AUTOMÁTICA DE MODO
  // =========================================================================

  /**
   * Detects the appropriate WorkerMode based on task attributes and execution state
   */
  static detectWorkerMode(task: {
    title: string;
    description?: string;
    retry_count?: number;
    is_bug_fix?: boolean;
    mode?: string;
  }, runState?: { lastError?: string }): WorkerMode {
    if (task.mode && ['IMPLEMENT', 'REPAIR', 'RESEARCH', 'AUDIT', 'TEST'].includes(task.mode.toUpperCase())) {
      return task.mode.toUpperCase() as WorkerMode;
    }

    if ((task.retry_count && task.retry_count > 0) || task.is_bug_fix || Boolean(runState?.lastError)) {
      return 'REPAIR';
    }

    const titleLower = (task.title || '').toLowerCase().trim();
    const descLower = (task.description || '').toLowerCase().trim();
    const combined = `${titleLower} ${descLower}`;

    const sanitizedForAudit = combined
      .replace(/audit[_-\s]?(log|logs|trail|event|events|table|tabela|timeline|history)/gi, ' ')
      .replace(/(log|logs|tabela|rota|endpoint|historico|histórico)\s+de\s+auditoria/gi, ' ');

    if (
      /\b(auditar|inspecionar conformidade|realizar auditoria|auditoria de seguran[cç]a|security audit|compliance audit)\b/i.test(sanitizedForAudit) ||
      /^(audit|auditar|auditoria)\b/i.test(titleLower)
    ) {
      return 'AUDIT';
    }

    if (
      /\b(pesquisar|estudo de viabilidade|avaliar alternativas|levantamento bibliogr[aá]fico)\b/i.test(combined) ||
      /^(research|pesquisa|pesquisar)\b/i.test(titleLower)
    ) {
      return 'RESEARCH';
    }

    if (/\b(corrigir|fix|bug|reparar|defeito|hotfix|regress[aã]o)\b/i.test(combined)) {
      return 'REPAIR';
    }

    const hasImplementationLeadInTitle = /^(implementar|construir|criar|desenvolver)\s+(?!su[ií]te de teste|testes?\b|casos de teste)/i.test(titleLower);
    if (
      !hasImplementationLeadInTitle &&
      (
        /\b(su[ií]te de testes?|test suite|validar cen[aá]rios|testes? e2e|testes? unit[aá]rios|testes? de integra[cç][aã]o|homologa[cç][aã]o)\b/i.test(titleLower) ||
        /\b(teste|testes|su[ií]te de teste|test suite|validar cen[aá]rios)\b/i.test(combined)
      )
    ) {
      return 'TEST';
    }

    return 'IMPLEMENT';
  }

  // =========================================================================
  // CONSTRUTOR DE PROMPTS DO SUPERVISOR (GEOMETRIA EM "U": A -> C -> B)
  // =========================================================================

  static buildSupervisorPrompt(input: SupervisorPromptInput): {
    prompt: string;
    meta: PromptVersionMeta;
  } {
    const sections: string[] = [];

    // 1. TOPO ABSOLUTO (PRIMAZIA / KV CACHE): CAMADA A
    sections.push(this.SUPERVISOR_CORE_RULES);
    sections.push('');

    // 2. CENTRO (CONTEXTO DENSO DO WORKSPACE): CAMADA C
    sections.push(`<workspace_context role="SUPERVISOR" mode="${input.mode}">`);
    sections.push(`  <project_metadata>`);
    sections.push(`    <project_name>${input.projectName}</project_name>`);
    sections.push(`    <project_id>${input.projectId}</project_id>`);
    sections.push(`    <project_path>${input.projectPath}</project_path>`);
    sections.push(`    <project_objective>${input.projectObjective}</project_objective>`);
    if (input.runId) sections.push(`    <run_id>${input.runId}</run_id>`);
    sections.push(`  </project_metadata>`);

    sections.push(`  <canonical_artifact_pointers>`);
    sections.push(`    - Especificação de Princípios e AppSec: @.ai-dev-hub/specs/PRINCIPIOS.md`);
    sections.push(`    - Especificação de Conteúdo e Seções: @.ai-dev-hub/specs/CONTEUDO.md`);
    sections.push(`    - Especificação de Backend, SQLite e Rotas REST: @.ai-dev-hub/specs/BACKEND.md`);
    sections.push(`    - Especificação de Design Tokens e REA UI: @.ai-dev-hub/specs/DESIGN.md`);
    sections.push(`    - Dossiê de Engenharia Reversa e Mercado: @.ai-dev-hub/market-research-rea.md`);
    sections.push(`  </canonical_artifact_pointers>`);

    if (input.constitutionSnippet) {
      sections.push(`  <project_constitution>\n${input.constitutionSnippet.slice(0, 3500)}\n  </project_constitution>`);
    }

    if (input.existingMemorySnippet) {
      sections.push(`  <project_memory>\n${input.existingMemorySnippet.slice(0, 3500)}\n  </project_memory>`);
    }

    if (input.mode === 'INITIAL_PLAN' || input.mode === 'REPLAN' || input.mode === 'DELTA_EVOLUTION' || input.mode === 'FINAL_REVIEW') {
      if (input.briefing) {
        sections.push(`  <user_briefing>\n${input.briefing}\n  </user_briefing>`);
      }
      if (input.completedTasks && input.completedTasks.length > 0) {
        sections.push(`  <completed_dag_tasks>\n${input.completedTasks.map(t => `    - ${t.title} [CONCLUÍDO]`).join('\n')}\n  </completed_dag_tasks>`);
      }
      if (input.pendingTasks && input.pendingTasks.length > 0) {
        sections.push(`  <pending_dag_tasks>\n${input.pendingTasks.map(t => `    - ${t.title}`).join('\n')}\n  </pending_dag_tasks>`);
      }
    }

    if (input.mode === 'TASK_REVIEW') {
      sections.push(`  <task_review_evidence>`);
      if (input.task) {
        sections.push(`    TAREFA AVALIADA: ${input.task.title} (ID: ${input.task.id})`);
        if (input.task.criteria?.length) sections.push(`    CRITÉRIOS: ${input.task.criteria.join('; ')}`);
        if (input.task.verificationCommand) sections.push(`    COMANDO DE VERIFICAÇÃO: ${input.task.verificationCommand}`);
        if (input.task.expectedScopeFiles?.length) sections.push(`    ARQUIVOS ESPERADOS NO ESCOPO (owned_files_write): ${input.task.expectedScopeFiles.join(', ')}`);
        if (input.task.skillRouted) {
          sections.push(`    ESPECIALIDADE / SKILL ALOCADA AO WORKER: [${input.task.skillRouted}]`);
        }
        if (input.task.skillGuidelines?.length) {
          sections.push(`    DIRETRIZES DA SKILL EXIGIDAS NESTA ENTREGA: ${input.task.skillGuidelines.join(' ; ')}`);
        }
      }
      if (input.builderReport) {
        sections.push(`    RELATÓRIO DO BUILDER: Status: ${input.builderReport.status} | Arquivos alterados: ${(input.builderReport.filesChanged || []).join(', ') || 'Nenhum'}`);
        if (input.builderReport.commandsExecuted?.length) sections.push(`    COMANDOS EXECUTADOS: ${input.builderReport.commandsExecuted.join(' && ')}`);
        if (input.builderReport.finalResponse) sections.push(`    RESUMO DO BUILDER:\n${input.builderReport.finalResponse.slice(0, 1500)}`);
      }
      if (input.diffValidation) {
        sections.push(`    DIFF CIRÚRGICO: ${input.diffValidation.isSurgical ? 'SIM' : 'NÃO (Arquivos fora do escopo detectados)'}`);
        if (input.diffValidation.unrelatedFiles?.length) sections.push(`    ARQUIVOS NÃO RELACIONADOS: ${input.diffValidation.unrelatedFiles.join(', ')}`);
      }
      if (input.evaluation) {
        sections.push(`    INDEPENDENT EVALUATOR: Veredito: ${input.evaluation.verdict} | Exit Code: ${input.evaluation.exitCode ?? 'N/A'}`);
        if (input.evaluation.actual) sections.push(`    RESULTADO OBSERVADO: ${input.evaluation.actual}`);
        if (input.evaluation.failedCriteria?.length) sections.push(`    REQUISITOS REPROVADOS: ${input.evaluation.failedCriteria.join('; ')}`);
        if (input.evaluation.output) sections.push(`    EVIDÊNCIA INDEPENDENTE (SAÍDA DAS VERIFICAÇÕES):\n${input.evaluation.output.slice(-6000)}`);
        if (input.evaluation.executedCommands?.length) sections.push(`    COMANDOS DO EVALUATOR: ${input.evaluation.executedCommands.join('; ')}`);
        if (input.evaluation.tamperedFiles?.length) sections.push(`    ADULTERAÇÃO DE TESTES DETECTADA: ${input.evaluation.tamperedFiles.join(', ')}`);
      }
      sections.push(`  </task_review_evidence>`);
    }

    if (input.mode === 'RECOVERY' && input.recoveryState) {
      sections.push(`  <recovery_state>`);
      sections.push(`    ESTADO DE RECUPERAÇÃO: Concluídas: ${input.recoveryState.completedTasksCount || 0} | Interrompidas: ${(input.recoveryState.interruptedTasks || []).join(', ') || 'Nenhuma'}`);
      if (input.recoveryState.gitHead) sections.push(`    ÚLTIMO COMMIT: ${input.recoveryState.gitHead}`);
      if (input.recoveryState.lastError) sections.push(`    ÚLTIMO ERRO REGISTRADO: ${input.recoveryState.lastError}`);
      sections.push(`  </recovery_state>`);
    }

    if (input.mode === 'FINAL_REVIEW') {
      if (input.allCompletedTasks && input.allCompletedTasks.length > 0) {
        sections.push(`  <all_completed_tasks>\n${input.allCompletedTasks.map(t => `    - [CONCLUÍDO] ${t.title}`).join('\n')}\n  </all_completed_tasks>`);
      }
      if (input.finalReviewEvidence && input.finalReviewEvidence.length > 0) {
        sections.push(`  <final_review_evidence>\n${input.finalReviewEvidence.map(e => `    - Tarefa: ${e.title || 'Microtarefa'} | Veredito: ${e.verdict || 'PASS'} | ExitCode: ${e.exitCode ?? 0}${e.notes?.length ? ` | Notas: ${e.notes.join('; ')}` : ''}`).join('\n')}\n  </final_review_evidence>`);
      }
    }

    if (input.docSimpContextBlock) {
      sections.push(`  <docsimp_blueprints>\n${input.docSimpContextBlock}\n  </docsimp_blueprints>`);
    }

    const designBlock = input.designSkillContextBlock || input.designSkillBlock;
    if (designBlock) {
      sections.push(`  <design_skill_tokens>\n${designBlock}\n  </design_skill_tokens>`);
    }

    if (input.reaSaaSMasterContextBlock) {
      sections.push(`  <rea_saas_master_architecture>\n${input.reaSaaSMasterContextBlock}\n  </rea_saas_master_architecture>`);
    }

    if (input.marketDiscoveryContextBlock) {
      sections.push(`  <market_discovery_reference>Consulte @.ai-dev-hub/market-research-rea.md para benchmarks de produtos de referência e entidades recomendadas.</market_discovery_reference>`);
    }

    if (input.livingSpecContextBlock) {
      sections.push(`  <living_specifications>\n${input.livingSpecContextBlock}\n  </living_specifications>`);
    } else if (input.projectPath && fs.existsSync(path.join(input.projectPath, '.ai-dev-hub', 'specs'))) {
      try {
        const specBlock = ProjectLivingSpecService.getRoleSpecificSpecContext(input.projectPath, 'SUPERVISOR_BLUEPRINT');
        if (specBlock) {
          sections.push(`  <living_specifications>\n${specBlock}\n  </living_specifications>`);
        }
      } catch (err) {
        if (typeof (globalThis as any).logger !== 'undefined' && (globalThis as any).logger?.warn) {
          (globalThis as any).logger.warn({
            event: 'server.handled_exception',
            file: 'promptArchitectureService',
            error: (err as any)?.message || String(err)
          });
        } else {
          console.warn('[WARN][server:promptArchitectureService]', err);
        }
      }
    }

    sections.push(`</workspace_context>`);
    sections.push('');

    // 3. BASE ABSOLUTA (RECÊNCIA E ÂNCORA DE TRANSIÇÃO): CAMADA B
    sections.push(`<execution_directive role="SUPERVISOR" mode="${input.mode}">`);
    sections.push(`  Com base exclusivamente nas especificações e no estado do repositório fornecidos nos blocos <workspace_context> acima, execute a diretiva a seguir:`);
    switch (input.mode) {
      case 'INITIAL_PLAN':
        sections.push(
          `  <mode_objective>Atuar como ARQUITETO DE SOFTWARE SÊNIOR AUTÔNOMO para decompor o briefing do projeto em uma hierarquia profunda e adaptativa de Grandes Tarefas (Major Tasks), Etapas (Stages) e Microtarefas atômicas executáveis (DAG).</mode_objective>`,
          `  <planning_rules_and_criteria>`,
          `    - INVESTIGAÇÃO DE ESTADO DO REPOSITÓRIO: Verificar se o diretório é GREENFIELD (projeto novo do zero) ou REPOSITÓRIO EXISTENTE com código legado.`,
          `    - COBERTURA OBRIGATÓRIA EM PROJETOS GREENFIELD (BACKEND-FIRST -> FRONTEND HIGH-CRAFT):`,
          `      1. Scaffolding inicial & Config Unificada: package.json, dependências, .env.example, Dockerfile, .dockerignore, config/env e runner de testes em uma única tarefa coesa (proibido criar tarefas isoladas apenas para .gitignore ou .env.example).`,
          `      2. Modelagem de dados, Persistência SQLite WAL & Smart Demo Seeding: esquemas SQLite parametrizados (PRAGMA journal_mode = WAL;), migrações, tabela audit_logs, repositórios e rotina seedIfEmpty() com 30 a 50 registros realistas interconectados.`,
          `      3. Lógica de negócios central e domínio: regras puras, validação estrita (rejeição de negativos/NaN), cálculos matemáticos/financeiros, adaptadores Dual-Mode DOCSIMP e serviços.`,
          `      4. Endpoints / APIs / Contratos REST: rotas HTTP/REST com validação de payload, headers de segurança (nosniff), GET /api/health e entrega estrita da SPA em GET /.`,
          `      5. Ecossistema SaaS Enterprise: billing/planos com medidores de uso, portal de documentação (/docs com curl/fetch), Developer Hub (API Keys e Webhooks Playground), RBAC de equipe e trilha global /api/audit-logs.`,
          `      6. Interface com usuário (Decomposição Obrigatória em microtarefas progressivas cobrindo App Shell com abas [role="tab"]/data-tab, Command Palette Ctrl+K, BI com KPIs Δ%, Gráficos SVG, Data Grids estilo Attio h-9 com Bulk Actions, Visão Kanban, Drawers de 480px-520px e Checkout PIX estilo Tally).`,
          `      7. Suíte de testes E2E, User Journey e Homologação AppSec: testes automatizados verificando regras de domínio, rotas API, fallbacks DOCSIMP, sobrevivência ao F5 e blindagem contra XSS/SQLi/Path Traversal.`,
          `    - ESCALA ORGÂNICA POR COMPLEXIDADE:`,
          `      * Escopo simples (ajuste ou 1 função): 1 a 3 microtarefas atômicas.`,
          `      * Escopo intermediário (múltiplos módulos / CLI): 6 a 15 microtarefas organizadas em Grandes Tarefas e Etapas.`,
          `      * Sistema SaaS / Full-Stack Completo: 40 a 75+ microtarefas atômicas distribuídas entre 10 a 12 Grandes Tarefas (4 a 7 microtarefas por GT).`,
          `    - POSSE EXCLUSIVA E ACICLICIDADE: Cada microtarefa deve declarar expectedFiles disjuntos na mesma onda, criteria binários verificáveis, requirementIds e dependencies estritamente anteriores (j < orderIndex).`,
          `    - GRAMÁTICA ESTRITA DE VERIFICATION COMMAND (controlledVerification.ts):`,
          `      * O campo "verificationCommand" DEVE usar EXCLUSIVAMENTE um único comando simples dentre: "npm test" | "npm run test" | "npm run typecheck" | "npm run build" | "npm run lint" | "node --test" | "node --test <arquivo-relativo>" | "node <arquivo.js>" | "tsc --noEmit".`,
          `      * É proibido usar ";", "&&", "||", "|", redirecionamentos (">", "<"), "node -e", "node --check", "powershell -Command" ou múltiplos comandos.`,
          `  </planning_rules_and_criteria>`,
          `  <output_contract>`,
          `    Responder exclusivamente com um JSON compacto (array de microtarefas estruturadas):`,
          `    [{"title":"...","description":"...","milestone":"GT-1","majorTaskCode":"GT-1","majorTaskTitle":"...","stageCode":"ET-1.1","stageTitle":"...","requirementIds":["REQ-1"],"expectedFiles":["src/..."],"orderIndex":1,"dependencies":[],"criteria":["..."],"verificationCommand":"npm test","doneWhen":"..."}]`,
          `  </output_contract>`
        );
        break;

      case 'REPLAN':
        sections.push(
          `  <mode_objective>Replanejar ou expandir adaptativamente a DAG de tarefas preservando 100% do trabalho já concluído.</mode_objective>`,
          `  <replan_trigger>${input.replanReason || 'Descoberta de lacuna de cobertura, subdivisão ou ajuste de dependências'}</replan_trigger>`,
          `  <planning_rules_and_criteria>`,
          `    - Preservar 100% das tarefas já concluídas em <completed_dag_tasks> e seus commits sem recriá-las.`,
          `    - Adicionar ou refinar exclusivamente as microtarefas necessárias para cobrir requisitos faltantes, sanar falhas de integração ou subdividir tarefas complexas sem sobreposição semântica.`,
          `    - Cumprir a gramática estrita de verificationCommand ("npm test", "npm run test|typecheck|build|lint", "node --test", "node --test <arquivo-relativo>", "node <arquivo.js>", "tsc --noEmit") sem ";", "&&", "||", "|" ou "node -e".`,
          `  </planning_rules_and_criteria>`,
          `  <output_contract>`,
          `    Retornar exclusivamente o array JSON com as tarefas que devem ser executadas a partir de agora.`,
          `  </output_contract>`
        );
        break;

      case 'TASK_REVIEW':
        sections.push(
          `  <mode_objective>Executar o Portão de Verificação Adversarial (Critic, Challenger, Auditor e Success Auditor) sob o modo de integridade benchmark sobre a entrega do Worker.</mode_objective>`,
          `  <adversarial_verification_gates>`,
          `    1. GATE CRITIC (Escopo e Especialidade): Verificar se o diff foi cirúrgico nos expectedScopeFiles e se o Worker cumpriu as DIRETRIZES DA ESPECIALIDADE / SKILL ALOCADA.`,
          `    2. GATE CHALLENGER (Persistência F5 e Resiliência): Verificar se as rotas e a UI sobrevivem a reload (F5) com dados reais no SQLite e tratam entradas inválidas com HTTP 400.`,
          `    3. GATE AUDITOR (Integridade Benchmark & Anti-Tampering): Reprovar imediatamente (CHANGES_REQUESTED) se o Independent Evaluator reportou FAIL, se houve adulteração de testes protegidos (tamperedFiles), ou presença de mocks/TODOs indevidos.`,
          `    4. GATE SUCCESS AUDITOR (Anti-Slop & Rota Raiz): Reprovar se GET / retornar JSON bruto em vez da SPA, se houver emojis na UI ou falha em gates visuais/AppSec.`,
          `    5. DIAGNÓSTICO ACIONÁVEL: Ao emitir CHANGES_REQUESTED, especificar no campo "feedback" exatamente o arquivo, linha, critério violado e a aresta de contraste (o que corrigir sem quebrar funcionalidades vizinhas). Se 100% dos critérios passaram com exit code 0, emitir APPROVED.`,
          `  </adversarial_verification_gates>`,
          `  <output_contract>`,
          `    Responder exclusivamente com um objeto JSON:`,
          `    {"verdict":"APPROVED ou CHANGES_REQUESTED","feedback":"justificativa técnica concisa com coordenada arquivo:linha e instrução exata de reparo","nextAction":"próximo passo seguro","qualityScore":8,"simplicityScore":8,"isSurgical":true,"unrelatedFilesDetected":[]}`,
          `  </output_contract>`
        );
        break;

      case 'RECOVERY':
        sections.push(
          `  <mode_objective>Reconciliar o estado da execução após interrupção, queda de processo ou reinicialização.</mode_objective>`,
          `  <recovery_protocol>`,
          `    - Inspecionar as tarefas interrompidas em <recovery_state> e confirmar a integridade das tarefas concluídas.`,
          `    - Determinar a próxima ação determinística para retomar o pipeline sem retrabalho.`,
          `  </recovery_protocol>`
        );
        break;

      case 'FINAL_REVIEW':
        sections.push(
          `  <mode_objective>Atuar como SUCCESS AUDITOR & STAFF QUALITY PRINCIPAL para a homologação final e encerramento do Autonomous Run.</mode_objective>`,
          `  <project_completion_invariants>`,
          `    1. ESTADO DA ESTEIRA: 100% das microtarefas planejadas foram implementadas e atestadas com exit code 0 pelo Independent Evaluator.`,
          `    2. AVALIAÇÃO FACTUAL DOS 7 PILARES SAAS MASTER:`,
          `       - Arquitetura & Backend: Rotas /api funcionais, SPA servida na raiz GET /, validação HTTP 400 e blindagem OWASP (Path Traversal com path.resolve, nosniff, sanitização DOM).`,
          `       - Persistência & Dados: Banco SQLite com PRAGMA journal_mode = WAL;, tabela audit_logs e rotina seedIfEmpty() com dados realistas.`,
          `       - Interface & UX: Design Tokens :root, ícones SVG Lucide inline (zero emojis), navegação por abas [role="tab"]/data-tab e persistência pós-reload (F5).`,
          `       - Governança & Cloud: Dockerfile limpo (PORT 4000-4999 com PORT_GUARD) e documentação /docs íntegra.`,
          `    3. CRITÉRIO DE HOMOLOGAÇÃO:`,
          `       - Se 100% das tarefas foram executadas com sucesso sem regressões atestadas, o veredito DEVE ser obrigatoriamente "APPROVED".`,
          `       - Se houver falha crítica factual comprovada por evidências nos testes, emita "CHANGES_REQUESTED" detalhando o reparo.`,
          `  </project_completion_invariants>`,
          `  <output_contract format="application/json">`,
          `    IMPORTANTE: É ESTRITAMENTE PROIBIDO responder com texto conversacional solto, saudações ou markdown fora do bloco JSON.`,
          `    Responda EXCLUSIVAMENTE com um único objeto JSON válido (application/json, puro ou em bloco \`\`\`json):`,
          `    {`,
          `      "verdict": "APPROVED" | "CHANGES_REQUESTED" | "BLOCKED",`,
          `      "feedback": "Parecer executivo detalhado da homologação final, destacando os módulos entregues e a comprovação dos testes.",`,
          `      "nextAction": "Projeto concluído com sucesso" | "Ação corretiva recomendada",`,
          `      "qualityScore": 10,`,
          `      "requirementsMet": true,`,
          `      "buildPassed": true,`,
          `      "testsPassed": true,`,
          `      "uiFunctional": true,`,
          `      "summary": "Resumo de alto nível do projeto entregue.",`,
          `      "highlights": ["Destaque 1", "Destaque 2"]`,
          `    }`,
          `  </output_contract>`
        );
        break;

      case 'DELTA_EVOLUTION':
        sections.push(
          `  <mode_objective>Planejar evolução cirúrgica aditiva (DELTA_EVOLUTION) em projeto já estruturado.</mode_objective>`,
          `  <delta_evolution_rules>`,
          `    - O projeto já possui código em src/, suíte de testes em test/ e rotas prévias.`,
          `    - Gerar um plano enxuto de 2 a 5 tarefas focadas exclusivamente na nova feature:`,
          `      1. Delta-1: Domínio, Migração Aditiva & Backend (CREATE TABLE IF NOT EXISTS sem dropar dados, novas rotas /api).`,
          `      2. Delta-2: Interface, Componentes Visuais & Integração (novos componentes/modais em public/ com Design Tokens e SVG Lucide).`,
          `      3. Delta-3: Testes de Regressão & Validação E2E (100% dos testes antigos passando + novos testes da feature).`,
          `    - Preservar 100% das tabelas existentes e dos testes anteriores em test/, garantindo SmartDemoSeeder (seedIfEmpty) e Kit Cloud Deploy (Dockerfile com HEALTHCHECK e PORT 4000-4999).`,
          `    - Cumprir a gramática estrita de verificationCommand ("npm test", "node --test", etc.).`,
          `  </delta_evolution_rules>`,
          `  <output_contract>`,
          `    Responder exclusivamente com um array JSON contendo as 2 a 5 tarefas delta planejadas.`,
          `  </output_contract>`
        );
        break;
    }
    sections.push(`</execution_directive>`);

    const fullPrompt = this.enforcePromptBudget(sections.join('\n'));
    const hash = crypto.createHash('sha256').update(fullPrompt).digest('hex');

    return {
      prompt: fullPrompt,
      meta: {
        version: this.SUPERVISOR_CORE_RULES_VERSION,
        hash,
        mode: input.mode,
        role: 'SUPERVISOR'
      }
    };
  }

  // =========================================================================
  // CONSTRUTOR DE PROMPTS DO WORKER (GEOMETRIA EM "U": A -> C -> B)
  // =========================================================================

  static buildWorkerPrompt(input: WorkerPromptInput): {
    prompt: string;
    meta: PromptVersionMeta;
  } {
    const sections: string[] = [];

    // 1. TOPO ABSOLUTO (PRIMAZIA / KV CACHE): CAMADA A
    sections.push(this.WORKER_CORE_RULES);
    sections.push('');

    // 2. CENTRO (CONTEXTO REAL DA TAREFA, REPOMAP, AST E VACINAS ML): CAMADA C
    sections.push(`<workspace_context role="WORKER" mode="${input.mode}">`);
    sections.push(`  <project_and_task_metadata>`);
    sections.push(`    PROJETO: ${input.projectName} (ID: ${input.projectId})`);
    sections.push(`    DIRETÓRIO EXATO: ${input.projectPath}`);
    sections.push(`    OBJETIVO DO PROJETO: ${input.projectObjective}`);
    if (input.runId) sections.push(`    RUN_ID: ${input.runId}`);
    if (input.majorTaskCode || input.majorTaskTitle) {
      sections.push(`    GRANDE TAREFA: [${input.majorTaskCode || 'GT'}] ${input.majorTaskTitle || ''}`.trim());
    }
    if (input.stageCode || input.stageTitle) {
      sections.push(`    ETAPA: [${input.stageCode || 'ET'}] ${input.stageTitle || ''}`.trim());
    }
    sections.push(`    TAREFA ATUAL: ${input.taskTitle} (ID: ${input.taskId})`);
    if (input.requirementIds?.length) {
      sections.push(`    REQUISITOS VINCULADOS (IDs): ${input.requirementIds.join(', ')}`);
    }
    if (input.riskLevel) {
      sections.push(`    NÍVEL DE RISCO DA TAREFA: ${input.riskLevel}`);
    }
    sections.push(`  </project_and_task_metadata>`);

    sections.push(`  <file_ownership_contract>`);
    sections.push(`    <owned_files_write>${(input.expectedScopeFiles || []).join(', ') || 'escopo estrito da tarefa no projeto'}</owned_files_write>`);
    sections.push(`    <forbidden_outside_scope>Proibido alterar arquivos de tarefas vizinhas ou enfraquecer suítes de testes protegidas.</forbidden_outside_scope>`);
    sections.push(`  </file_ownership_contract>`);

    if (input.completedDependenciesSummary?.length) {
      sections.push(`  <completed_dependencies>\n${input.completedDependenciesSummary.map(d => `    - ${d}`).join('\n')}\n  </completed_dependencies>`);
    }

    if (input.relevantDecisions?.length) {
      sections.push(`  <relevant_technical_decisions>\n${input.relevantDecisions.join('\n')}\n  </relevant_technical_decisions>`);
    }

    if (input.programMd) {
      sections.push(`  <program_constitution>\n${input.programMd.slice(0, 3000)}\n  </program_constitution>`);
    }

    if (input.formattedEngineeringBlock) {
      sections.push(`  <karpathy_engineering_package>\n${input.formattedEngineeringBlock}\n  </karpathy_engineering_package>`);
    }

    if (input.docSimpContextBlock) {
      sections.push(`  <docsimp_context>\n${input.docSimpContextBlock}\n  </docsimp_context>`);
    }

    const designBlock = input.designSkillContextBlock || input.designSkillBlock;
    if (designBlock) {
      sections.push(`  <design_skill_context>\n${designBlock}\n  </design_skill_context>`);
    }

    if (input.reaSaaSMasterContextBlock) {
      sections.push(`  <rea_saas_master_context>\n${input.reaSaaSMasterContextBlock}\n  </rea_saas_master_context>`);
    }

    if (input.marketDiscoveryContextBlock) {
      sections.push(`  <market_discovery_pointer title="DIRETRIZES DA ONDA 0 (MARKET RESEARCH & REA)">\n=== DIRETRIZES DA ONDA 0 (MARKET RESEARCH & REA) ===\nConsulte @.ai-dev-hub/market-research-rea.md para benchmarks de produtos de referência e entidades recomendadas.\n  </market_discovery_pointer>`);
    }

    if (input.livingSpecContextBlock) {
      sections.push(`  <living_specifications_truth source=".ai-dev-hub/specs/">`);
      sections.push(`=== FONTE ÚNICA DE VERDADE DO PROJETO (.ai-dev-hub/specs/) ===`);
      sections.push(input.livingSpecContextBlock);
      sections.push(`    INSTRUÇÕES OBRIGATÓRIAS AO WORKER:`);
      sections.push(`    - Siga rigorosamente os nomes exatos de tabelas, colunas e rotas REST de @.ai-dev-hub/specs/BACKEND.md;`);
      sections.push(`    - Siga todas as seções, abas (role="tab", data-tab), KPIs e componentes de @.ai-dev-hub/specs/CONTEUDO.md;`);
      sections.push(`    - Aplique os tokens :root, tipografia (tabular-nums) e SVGs Lucide inline de @.ai-dev-hub/specs/DESIGN.md;`);
      sections.push(`    - Cumpra as invariantes Karpathy, PORT_GUARD (faixa 4000-4999) e AppSec de @.ai-dev-hub/specs/PRINCIPIOS.md.`);
      sections.push(`  </living_specifications_truth>`);
    } else if (input.projectPath && fs.existsSync(path.join(input.projectPath, '.ai-dev-hub', 'specs'))) {
      try {
        let taskRole: SpecTaskRole = 'WORKER_FULLSTACK';
        const taskText = ((input.taskTitle || '') + ' ' + (input.taskDescription || '') + ' ' + (input.expectedScopeFiles || []).join(' ') + ' ' + (input.stageCode || '')).toLowerCase();
        if (/public\/|html|css|frontend|interface|ui|design|dashboard|grid|drawer|componente|visual/i.test(taskText)) {
          taskRole = 'WORKER_FRONTEND';
        } else if (/src\/db|src\/server|src\/routes|src\/services|backend|banco|sqlite|rota|schema|endpoint|model/i.test(taskText)) {
          taskRole = 'WORKER_BACKEND';
        } else if (/test\/|teste|homolog|e2e|verific|audit/i.test(taskText)) {
          taskRole = 'WORKER_TEST';
        }
        const specBlock = ProjectLivingSpecService.getRoleSpecificSpecContext(input.projectPath, taskRole);
        if (specBlock) {
          sections.push(`  <living_specifications_truth source=".ai-dev-hub/specs/">`);
          sections.push(`=== FONTE ÚNICA DE VERDADE DO PROJETO (.ai-dev-hub/specs/) ===`);
          sections.push(specBlock);
          sections.push(`    INSTRUÇÕES OBRIGATÓRIAS AO WORKER:`);
          sections.push(`    - Siga rigorosamente os nomes exatos de tabelas, colunas e rotas REST de @.ai-dev-hub/specs/BACKEND.md;`);
          sections.push(`    - Siga todas as seções, abas (role="tab", data-tab), KPIs e componentes de @.ai-dev-hub/specs/CONTEUDO.md;`);
          sections.push(`    - Aplique os tokens :root, tipografia (tabular-nums) e SVGs Lucide inline de @.ai-dev-hub/specs/DESIGN.md;`);
          sections.push(`    - Cumpra as invariantes Karpathy, PORT_GUARD (faixa 4000-4999) e AppSec de @.ai-dev-hub/specs/PRINCIPIOS.md.`);
          sections.push(`  </living_specifications_truth>`);
        }
      } catch (err) {
        if (typeof (globalThis as any).logger !== 'undefined' && (globalThis as any).logger?.warn) {
          (globalThis as any).logger.warn({
            event: 'server.handled_exception',
            file: 'promptArchitectureService',
            error: (err as any)?.message || String(err)
          });
        } else {
          console.warn('[WARN][server:promptArchitectureService]', err);
        }
      }
    }

    // FASE 5: AstSymbolIndexService - Estrutura de símbolos e assinaturas (anti-context-rot)
    try {
      const symbolSummary = input.astSymbolSummaryBlock || (
        input.projectId && input.projectPath
          ? AstSymbolIndexService.generateStructuredSymbolSummary(input.projectId, {
              projectPath: input.projectPath,
              targetFiles: input.expectedScopeFiles,
              maxChars: 7000
            })
          : ''
      );
      if (symbolSummary) {
        sections.push(`  <ast_symbol_index>\n${symbolSummary}\n  </ast_symbol_index>`);
      }
    } catch (symErr: any) {
      Logger.warn(`[PromptArchitectureService] Falha não bloqueante ao gerar AST Symbol Summary: ${symErr.message}`);
    }

    // FASE 23: RepoMap Automático de Símbolos, Rotas e Schemas (Aider RepoMap)
    try {
      const repoMap = input.repoMapSnippet || (
        input.projectPath ? EngineeringContextService.buildCompactRepoMap(input.projectPath, 1500) : ''
      );
      if (repoMap) {
        sections.push(`  <compact_repo_map>\n${repoMap}\n  </compact_repo_map>`);
      }
    } catch (repoErr: any) {
      Logger.warn(`[PromptArchitectureService] Falha não bloqueante ao gerar RepoMap: ${repoErr.message}`);
    }

    // DecoMind ML Engine: Predição de Risco Online & Vacinas Episódicas Aprendidas (Arestas de Contraste)
    let retrievedMemoryIds: string[] = [];
    try {
      const { DecoMindMlService } = require('./decoMindMlService.js');
      const mlRisk = DecoMindMlService.predictReworkRiskFromTask({
        taskTitle: input.taskTitle,
        taskDescription: input.taskDescription,
        expectedFiles: input.expectedScopeFiles || [],
        dependencies: input.dependencies || input.completedDependenciesSummary || [],
        attempts: input.attemptNumber || 0,
        category: input.skillCategory || input.stageCode || 'GENERAL'
      }, input.projectPath);

      const mlVaccines = DecoMindMlService.retrieveTopEpisodicVaccines(
        `${input.taskTitle} ${input.taskDescription} ${(input.expectedScopeFiles || []).join(' ')}`,
        input.skillCategory || input.stageCode || 'GENERAL',
        3
      );
      if (Array.isArray(mlVaccines) && mlVaccines.length > 0) {
        retrievedMemoryIds = mlVaccines.map(v => v.id).filter(Boolean);
      }

      const mlLines: string[] = [
        `  <decomind_ml_episodic_vaccines>`,
        `    PROBABILIDADE CALCULADA DE REWORK: ${(mlRisk.probability * 100).toFixed(1)}% (Nível: ${mlRisk.riskTier})`
      ];

      if (mlRisk.topRiskFactors?.length) {
        mlLines.push(`    FATORES PREDITIVOS DE RISCO DETECTADOS: ${mlRisk.topRiskFactors.join(', ')}`);
      }

      if (mlVaccines.length > 0) {
        mlLines.push(`    VACINAS EPISÓDICAS E ARESTAS DE CONTRASTE APRENDIDAS (Q-Value Reinforcement):`);
        for (const v of mlVaccines) {
          mlLines.push(`    - [Score: ${v.similarityScore?.toFixed(2) || '0.50'} | Q: ${v.q_value.toFixed(2)}] Padrão de Falha: ${v.error_pattern} -> Vacina Cirúrgica: ${v.surgical_vaccine}`);
        }
      }
      mlLines.push(`  </decomind_ml_episodic_vaccines>`);
      sections.push(mlLines.join('\n'));
    } catch (mlErr: any) {
      Logger.warn(`[PromptArchitectureService] Aviso não bloqueante ao injetar DecoMind ML: ${mlErr.message}`);
    }

    sections.push(`  <lsp_realtime_diagnostics_tool>`);
    sections.push(`    Você dispõe da ferramenta 'lsp_diagnostics(filePath)' para validação sintática e de tipagem em tempo real nos arquivos modificados antes de encerrar a tarefa.`);
    if (input.lspDiagnosticsSnippet) {
      sections.push(`    DIAGNÓSTICOS LSP FACTUAIS DOS ARQUIVOS MODIFICADOS:\n${input.lspDiagnosticsSnippet}`);
    }
    sections.push(`  </lsp_realtime_diagnostics_tool>`);

    if (input.protectedEvaluationWarning) {
      sections.push(`  <protected_evaluation_warning>\n${input.protectedEvaluationWarning}\n  </protected_evaluation_warning>`);
    }

    if (input.mode === 'REPAIR' || input.previousError || input.previousEvaluatorOutput) {
      sections.push(`  <failure_diagnostics>`);
      if (input.previousError) {
        sections.push(`    ERRO ANTERIOR A CORRIGIR:\n${input.previousError.slice(-4500)}`);
      }
      if (input.previousEvaluatorOutput) {
        sections.push(`    SAÍDA DO AVALIADOR ANTERIOR:\n${input.previousEvaluatorOutput.slice(-6000)}`);
      }
      sections.push(`  </failure_diagnostics>`);
    }

    if (input.mode === 'AUDIT' && input.auditChecklist?.length) {
      sections.push(`  <audit_checklist>\n${input.auditChecklist.map(c => `    - [ ] ${c}`).join('\n')}\n  </audit_checklist>`);
    }

    if (input.mode === 'RESEARCH' && input.researchScope) {
      sections.push(`  <research_scope>\n${input.researchScope}\n  </research_scope>`);
    }

    if (input.supervisorInstructions) {
      sections.push(`  <supervisor_specific_instructions>\n${input.supervisorInstructions}\n  </supervisor_specific_instructions>`);
    }

    sections.push(`</workspace_context>`);
    sections.push('');

    // 3. BASE ABSOLUTA (RECÊNCIA, GSD ATOMIC CONTRACT & PROTOCOLO PASSO A PASSO): CAMADA B
    const skillPersona = input.routedSkillId || 'GENERAL_ENGINEER';
    const skillDigest = input.routedSkillDigest || 'Aplicar padrões de código limpo e contratos da tarefa';

    sections.push(`<execution_directive role="WORKER" mode="${input.mode}">`);
    sections.push(`  Com base exclusivamente nas especificações, no mapa do repositório e nos contratos fornecidos nos blocos <workspace_context> acima, execute a microtarefa abaixo:`);
    sections.push(
      `  <gsd_atomic_task type="auto" mode="${input.mode}">\n` +
      `    <name>${input.taskTitle}</name>\n` +
      `    <files>${(input.expectedScopeFiles || []).join(', ') || 'escopo do projeto'}</files>\n` +
      `    <action>${input.taskDescription || input.taskTitle}</action>\n` +
      `    <skill persona="${skillPersona}">${skillDigest}</skill>\n` +
      `    <verify>${input.verificationCommand || 'npm test'}</verify>\n` +
      `    <done>${input.doneWhen || 'Critérios 100% atendidos e comando verify retornando exit code 0'}</done>\n` +
      `  </gsd_atomic_task>`
    );

    if (input.taskDescription) {
      sections.push(`  <task_description>${input.taskDescription}</task_description>`);
    }
    if (input.acceptanceCriteria?.length) {
      sections.push(`  <acceptance_criteria>${input.acceptanceCriteria.join('; ')}</acceptance_criteria>`);
    }
    if (input.verificationCommand) {
      sections.push(`  <verification_command>${input.verificationCommand}</verification_command>`);
    }
    if (input.doneWhen) {
      sections.push(`  <done_when>${input.doneWhen}</done_when>`);
    }
    if (input.expectedScopeFiles?.length) {
      sections.push(`  <expected_scope_files>${input.expectedScopeFiles.join(', ')}</expected_scope_files>`);
    }

    switch (input.mode) {
      case 'IMPLEMENT':
        sections.push(
          `  <step_by_step_execution_protocol>`,
          `    OBJETIVO DESTE MODO: Implementar o código funcional cirúrgico e completo para atender a 100% dos critérios da tarefa.`,
          `    Passo 1 (Inspeção e Ancoragem de Contratos): Verificar os arquivos existentes no projeto (package.json, esquemas SQLite, serviços e rotas) via view_file para manter consistência absoluta de propriedades JSON e imports. Em Node.js/TypeScript, utilizar SEMPRE imports canônicos com namespace para bibliotecas padrão: 'import * as fs from "node:fs"', 'import * as path from "node:path"', 'import * as http from "node:http"', 'import assert from "node:assert/strict"' (jamais usar default import de módulos CJS sem default export).`,
          `    Passo 2 (Implementação Cirúrgica de Produção): Implementar 100% da lógica exigida nos arquivos de <expected_scope_files> (zero placeholders, zero TODOs, zero funções vazias):`,
          `      * Banco/Domínio (SQLite): usar queries parametrizadas (db.prepare('... WHERE id = ?').get(id)), validar números finitos e não-negativos (Number.isFinite(val) && val >= 0) e garantir seedIfEmpty() idempotente com 15-30 registros realistas.`,
          `      * API/Servidor HTTP: definir const PORT = Number(process.env.PORT) || 4000; incluir res.setHeader('X-Content-Type-Options', 'nosniff'); servir GET /api/health com JSON; bloquear Path Traversal verificando const safePath = path.resolve(publicDir, '.' + reqPath); if (!safePath.startsWith(publicDir) || /\\/\\.|\\.env|\\.git/i.test(reqPath)) return 403/404; e servir public/index.html em GET / e fallback SPA.`,
          `      * Frontend/UI (Anti-Slop & SaaS Master): (1) Tokens :root (--bg, --surface, --border, --text, --accent), ::-webkit-scrollbar (6px) e font-variant-numeric: tabular-nums; (2) Botões/abas com role="tab" e data-tab="<secao>" + ícones SVG Lucide inline (zero emojis); (3) Helper obrigatório function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); } em toda renderização innerHTML; (4) Reactive Store + Fetch API real recarregando do backend no boot para sobreviver ao F5; (5) Botões dinâmicos com data-action="<acao>" e data-id="<id>" aplicando Optimistic UI imediato no DOM.`,
          `    Passo 3 (Diagnóstico LSP e Verificação Empírica): Executar lsp_diagnostics nos arquivos editados e rodar o comando de verificação (${input.verificationCommand || 'npm test'}) comprovando exit code 0.`,
          `    Passo 4 (Relatório Factual): Encerrar reportando objetivamente os arquivos alterados e a saída real dos testes.`,
          `  </step_by_step_execution_protocol>`
        );
        break;

      case 'REPAIR':
        sections.push(
          `  <surgical_repair_protocol>`,
          `    OBJETIVO DESTE MODO: Corrigir cirurgicamente o defeito ou reprovação identificada em <failure_diagnostics> na avaliação anterior.`,
          `    Passo 1 (Isolamento de Coordenada e Falsificabilidade): Ler atentamente <failure_diagnostics> acima, inspecionar via view_file uma janela de 30 linhas ao redor do erro e confirmar que a causa raiz explica simultaneamente o modo de falha e o momento da regressão:`,
          `      1. Falha em Teste Unitário/Integração: verificar stack trace, valor esperado vs. recebido, colunas SQLite ou status HTTP.`,
          `      2. Falha no Gate Visual (EMOJI_ICON_PROLIFERATION / MISSING_DESIGN_TOKENS / RAW_UNSTYLED_CONTROLS): substituir todos os emojis por SVGs Lucide inline, declarar tokens em :root e estilizar controles/scrollbars.`,
          `      3. Falha em ROOT_ROUTE_HIJACKED_BY_JSON: mover o JSON da rota GET / para GET /api/health e servir public/index.html em GET /.`,
          `      4. Falha no UserExperienceSimulator (DATA_LOST_AFTER_RELOAD / DEAD_INTERACTIVE_ELEMENTS / HTTP 4xx/5xx): garantir data-action="<acao>" e data-id="<id>" com Optimistic UI imediato em todo <button> dinâmico, conectar formulários ao backend via fetch() e recarregar no DOMContentLoaded para sobreviver ao F5.`,
          `      5. Falha no SecurityPentestSimulator (XSS / SQLi / Path Traversal / Negative Values): aplicar escapeHtml() no DOM, usar '?' no SQLite, validar path.resolve().startsWith(publicDir) e retornar HTTP 400 para negativos ou JSON malformado.`,
          `    Passo 2 (Aplicação de Diff Mínimo): Aplicar a correção no código de produção via replace_file_content preservando código adjacente intacto. REGRA INVIOLÁVEL: NUNCA alterar ou enfraquecer testes protegidos para mascarar o defeito.`,
          `    Passo 3 (Prova Empírica de Convergência): Reexecutar (${input.verificationCommand || 'npm test'}) e comprovar exit code 0.`,
          `  </surgical_repair_protocol>`
        );
        break;

      case 'RESEARCH':
        sections.push(
          `  <research_protocol>`,
          `    OBJETIVO DESTE MODO: Realizar pesquisa técnica, validar alternativas ou inspecionar documentação compatível com a stack sem editar código de produção, registrando constatações verificáveis.`,
          `  </research_protocol>`
        );
        break;

      case 'AUDIT':
        sections.push(
          `  <audit_protocol>`,
          `    OBJETIVO DESTE MODO: Realizar auditoria técnica de conformidade, segurança ou dependências conforme <audit_checklist>. Uma tarefa de auditoria PODE SER CONCLUÍDA SEM ALTERAR ARQUIVOS DE CÓDIGO se o resultado for apenas inspeção e constatações objetivas.`,
          `  </audit_protocol>`
        );
        break;

      case 'TEST':
        sections.push(
          `  <test_engineering_protocol>`,
          `    OBJETIVO DESTE MODO: Criar ou expandir suíte de testes automatizados independentes cobrindo happy paths, entradas inválidas (valores negativos, campos vazios, payloads malformados), limites e fallbacks DOCSIMP.`,
          `    - CONVENÇÃO CANÔNICA DE IMPORTS TYPESCRIPT / NODE.JS (ZERO ERROS DE LSP):`,
          `      * Usar SEMPRE: import * as fs from 'node:fs'; import * as path from 'node:path'; import * as http from 'node:http'; import assert from 'node:assert/strict';`,
          `      * NUNCA usar default import de módulos da biblioteca padrão sem default export.`,
          `      * Em projetos TypeScript com 'outDir: ./dist', executar a compilação (npm run build) antes de rodar testes que importam de dist.`,
          `      * Isolar instâncias SQLite com caminhos temporários e encerrar servidores efêmeros em blocos try/finally.`,
          `    - É proibido enfraquecer testes existentes, remover asserções ou utilizar .skip/xit.`,
          `    - Executar (${input.verificationCommand || 'npm test'}) e comprovar exit code 0.`,
          `  </test_engineering_protocol>`
        );
        break;
    }
    sections.push(`</execution_directive>`);

    const fullPrompt = this.enforcePromptBudget(sections.join('\n'));
    const hash = crypto.createHash('sha256').update(fullPrompt).digest('hex');

    return {
      prompt: fullPrompt,
      meta: {
        version: this.WORKER_CORE_RULES_VERSION,
        hash,
        mode: input.mode,
        role: 'WORKER',
        retrievedMemoryIds
      }
    };
  }

  // =========================================================================
  // DECOMPOSIÇÃO EM DUAS ONDAS (TWO-PASS / MULTI-PASS HIERARCHICAL PLANNING)
  // =========================================================================

  /**
   * Onda 1: Gera o Blueprint Arquitetural (Grandes Tarefas e Etapas) com Geometria em "U" (A -> C -> B)
   */
  static buildArchitecturalBlueprintPrompt(input: ArchitecturalBlueprintPromptInput): {
    prompt: string;
    meta: PromptVersionMeta;
  } {
    const sections: string[] = [];

    // 1. TOPO ABSOLUTO (PRIMAZIA): CAMADA A
    sections.push(this.SUPERVISOR_CORE_RULES);
    sections.push('');

    // 2. CENTRO (CONTEXTO DO PROJETO): CAMADA C
    sections.push(`<workspace_context role="SUPERVISOR" wave="ONDA_1_BLUEPRINT">`);
    sections.push(`  <project_metadata>`);
    sections.push(`    PROJETO: ${input.projectName} (ID: ${input.projectId})`);
    sections.push(`    CAMINHO: ${input.projectPath}`);
    sections.push(`    ESTADO DO REPOSITÓRIO: ${input.isGreenfield !== false ? 'GREENFIELD (iniciado do zero, pasta vazia)' : 'REPOSITÓRIO EXISTENTE (com código legado)'}`);
    sections.push(`    OBJETIVO: ${input.projectObjective || input.briefing.slice(0, 300)}`);
    sections.push(`  </project_metadata>`);
    sections.push(`  <user_briefing>\n${input.briefing}\n  </user_briefing>`);

    const isLargeBriefing = (input.briefing || '').length > 5000;
    const maxAuxiliaryChars = isLargeBriefing ? 1200 : 3500;

    if (input.requirements && input.requirements.length > 0) {
      sections.push(`  <traceable_requirements>\n${input.requirements.map(r => `    - ${r}`).join('\n')}\n  </traceable_requirements>`);
    }
    if (input.constitutionSnippet) sections.push(`  <constitution>\n${input.constitutionSnippet.slice(0, maxAuxiliaryChars)}\n  </constitution>`);
    if (input.existingMemorySnippet) sections.push(`  <memory>\n${input.existingMemorySnippet.slice(0, maxAuxiliaryChars)}\n  </memory>`);
    if (input.docSimpContextBlock) sections.push(`  <docsimp_blueprints>\n${input.docSimpContextBlock.slice(0, maxAuxiliaryChars)}\n  </docsimp_blueprints>`);

    const designBlock = input.designSkillContextBlock || input.designSkillBlock;
    if (designBlock) sections.push(`  <design_skill_tokens>\n${designBlock.slice(0, maxAuxiliaryChars)}\n  </design_skill_tokens>`);
    if (input.reaSaaSMasterContextBlock) sections.push(`  <rea_saas_master>\n${input.reaSaaSMasterContextBlock.slice(0, maxAuxiliaryChars)}\n  </rea_saas_master>`);

    if (input.marketDiscoveryContextBlock) {
      sections.push(`  <onda_0_market_discovery title="CAMADA C: ESTUDO DE MERCADO, BENCHMARKING & REA DISCOVERY (ONDA 0)">\n=== CAMADA C: ESTUDO DE MERCADO, BENCHMARKING & REA DISCOVERY (ONDA 0) ===\n${input.marketDiscoveryContextBlock.slice(0, maxAuxiliaryChars)}\n    Incorpore os diferenciais 10-star, entidades recomendadas e fluxos mapeados na modelagem das Grandes Tarefas.\n  </onda_0_market_discovery>`);
    }

    if (input.livingSpecContextBlock) {
      sections.push(`  <living_specifications source=".ai-dev-hub/specs/">\n${input.livingSpecContextBlock.slice(0, isLargeBriefing ? 2000 : 4000)}\n    Incorpore rigorosamente as seções de CONTEUDO.md, schemas de BACKEND.md, tokens de DESIGN.md e invariantes de PRINCIPIOS.md nas Grandes Tarefas.\n  </living_specifications>`);
    } else if (input.projectPath && fs.existsSync(path.join(input.projectPath, '.ai-dev-hub', 'specs'))) {
      try {
        const specBlock = ProjectLivingSpecService.getRoleSpecificSpecContext(input.projectPath, 'SUPERVISOR_BLUEPRINT');
        if (specBlock) {
          sections.push(`  <living_specifications source=".ai-dev-hub/specs/">\n${specBlock.slice(0, isLargeBriefing ? 2000 : 4000)}\n    Incorpore rigorosamente as seções de CONTEUDO.md, schemas de BACKEND.md, tokens de DESIGN.md e invariantes de PRINCIPIOS.md nas Grandes Tarefas.\n  </living_specifications>`);
        }
      } catch (err) {
        if (typeof (globalThis as any).logger !== 'undefined' && (globalThis as any).logger?.warn) {
          (globalThis as any).logger.warn({
            event: 'server.handled_exception',
            file: 'promptArchitectureService',
            error: (err as any)?.message || String(err)
          });
        } else {
          console.warn('[WARN][server:promptArchitectureService]', err);
        }
      }
    }
    sections.push(`</workspace_context>`);
    sections.push('');

    // 3. BASE ABSOLUTA (RECÊNCIA E DIRETRIZ DA ONDA 1): CAMADA B
    sections.push(`<execution_directive role="SUPERVISOR" wave="ONDA_1_BLUEPRINT">`);
    sections.push(
      `  Com base exclusivamente nas especificações e no estado do repositório fornecidos nos blocos <workspace_context> acima, execute o mapeamento de Grandes Tarefas (GT) e Etapas (ET):`,
      `  <blueprint_architecture_mandates>`,
      `    OBJETIVO: Estruturar as Grandes Tarefas (Major Tasks - GT) e Etapas (Stages - ET) cobrindo todo o ciclo de vida do software sob a metodologia BACKEND-FIRST, ROCK-SOLID & TESTED -> PROGRESSIVE FRONTEND REFINEMENT.`,
      `    === FASE MACRO 1: BACKEND 100% FUNCIONAL, TESTADO E REVISADO + FRONTEND SIMPLES CONECTADO (GT-1 a GT-7) ===`,
      `    * GT-1 [Infra Dual-Mode DOCSIMP, Cache e Config]: Scaffolding, tipagem TypeScript estrita, configuração de ambiente (.env.example), endpoint /api/system/integrations, cache/rate-limiting com fallback em memória, Dockerfile e servidor HTTP base (PORT_GUARD 4000-4999).`,
      `    * GT-2 [Banco de Dados SQLite Relacional & Seed Realista]: Modelagem relacional completa das entidades e tabelas do domínio solicitadas no briefing com PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; e rotina seedIfEmpty() rica com 30 a 50 registros interconectados e realistas.`,
      `    * GT-3 [Autenticação e Permissões (se solicitado no briefing)]: Implementação de rotas de autenticação, sessão e proteção apenas se requerido pelo projeto; caso contrário, focar nos contratos de persistência e domínio.`,
      `    * GT-4 [Cobrança e Monetização (se solicitado no briefing)]: Integração de planos e gateway de pagamento apenas se requerido pelo projeto; caso contrário, focar em regras de negócio e serviços core.`,
      `    * GT-5 [Motor Core do Domínio & Filtros Compostos]: Motor de busca e filtros do domínio com debounce, validação de invariantes de negócio, cálculos analíticos/scores e exportação tabular (CSV RFC-4180 / JSON).`,
      `    * GT-6 [Bateria Exaustiva de Testes, Revisão e Blindagem do Backend]: Suíte completa de testes unitários, testes de integração REST, validações HTTP 400 (rejeição de valores negativos/NaN/campos nulos) e defesas AppSec Red Team (blindagem contra SQLi, XSS e Path Traversal) — Hard Milestone Gate: nenhuma tarefa de polimento visual começa antes de 100% do backend estar testado e aprovado em GT-6.`,
      `    * GT-7 [Frontend Simples Funcional — Prova de Integração Ponta a Ponta]: Construção de interface limpa conectando via fetch() a 100% das rotas do backend com persistência pós-F5, comprovando integração ponta a ponta sem botões mortos.`,
      `    === FASE MACRO 2: REFINAMENTO PROFUNDO DE FRONTEND & SCREENSHOTS FINAIS (GT-8 a GT-12) ===`,
      `    * GT-8 [Cores & Tipografia: ui-ux-pro-max + brandkit]: Sistema de cores profissional de alto contraste, tokens CSS em :root, hierarquia tipográfica precisa (Inter + JetBrains Mono com tabular-nums), superfícies refinadas e badges semânticos.`,
      `    * GT-9 [Inputs, Busca e Modais Zero-Fricção]: Refinamento de formulários, barra de busca com comandos rápidos, modais de criação e visualização com validação inline em tempo real.`,
      `    * GT-10 [Data Grid de Alta Densidade & Filtros Empilháveis]: Refinamento da tabela de registros do domínio (linhas compactas h-9, tabular-nums) e cards, filtros compostos empilháveis, Bulk Actions e Slide-Over Detail Drawer lateral de 480px-520px.`,
      `    * GT-11 [Visualizações Especializadas do Domínio & Responsividade]: Painéis de análise, comparadores ou visualizadores específicos do domínio conforme solicitado no briefing, com responsividade completa para Desktop (1440x900), Tablet (768x1024) e Mobile (390x844).`,
      `    * GT-12 [Homologação Visual Playwright & Screenshots no Chat: playwright-agent-cli]: Auditoria visual E2E Desktop e Mobile, garantia de sobrevivência ao F5, zero botões mortos, zero overflow horizontal, captura de evidências fotográficas em PNG no Playwright e envio automático das Screenshots finais no Chat do Projeto.`,
      `    - FIDELIDADE ABSOLUTA AO BRIEFING: Modele estritamente os módulos, entidades e fluxos solicitados no briefing do usuário (@.ai-dev-hub/BRIEFING_ORIGINAL.md). Jamais invente módulos não solicitados (como vídeos virais do YouTube, PIX, Turnstile ou n8n, a menos que constem no briefing).`,
      `    - Explicitar no campo "objective" de cada Grande Tarefa e Etapa os nomes principais de tabelas, módulos e rotas da API para orientar a Onda 2.`,
      `  </blueprint_architecture_mandates>`,
      `  <output_contract>`,
      `    Responder exclusivamente com um JSON (array de Grandes Tarefas com Etapas):`,
      `    [{"code":"GT-1","title":"Fundação SaaS, Configuração Dual-Mode DOCSIMP e Infraestrutura","objective":"Configurar package.json, ambiente, adaptadores Dual-Mode com fallback local, Dockerfile e runner de testes","expectedOutcome":"Estrutura do projeto pronta com adaptadores resilientes e testes executáveis","requirementIds":["REQ-1"],"dependencies":[],"stages":[{"code":"ET-1.1","title":"Scaffolding, Env e Adaptadores DOCSIMP","objective":"Configurar arquivos base, Dockerfile e adaptadores Dual-Mode"},{"code":"ET-1.2","title":"Configuração da Suíte de Testes","objective":"Configurar runner e smoke tests de infraestrutura"}]}]`,
      `  </output_contract>`
    );
    sections.push(`</execution_directive>`);

    const fullPrompt = this.enforcePromptBudget(sections.join('\n'));
    const hash = crypto.createHash('sha256').update(fullPrompt).digest('hex');
    return {
      prompt: fullPrompt,
      meta: {
        version: this.SUPERVISOR_CORE_RULES_VERSION,
        hash,
        mode: 'INITIAL_PLAN',
        role: 'SUPERVISOR'
      }
    };
  }

  /**
   * Onda 2: Expande uma Grande Tarefa específica em microtarefas atômicas e executáveis com Geometria em "U" (A -> C -> B)
   */
  static buildMajorTaskExpansionPrompt(input: MajorTaskExpansionPromptInput): {
    prompt: string;
    meta: PromptVersionMeta;
  } {
    const sections: string[] = [];

    // 1. TOPO ABSOLUTO (PRIMAZIA): CAMADA A
    sections.push(this.SUPERVISOR_CORE_RULES);
    sections.push('');

    // 2. CENTRO (CONTEXTO DO PROJETO E MAPA DE REQUISITOS): CAMADA C
    sections.push(`<workspace_context role="SUPERVISOR" wave="ONDA_2_EXPANSION" target_gt="${input.majorTask.code}">`);
    sections.push(`  <project_metadata>`);
    sections.push(`    PROJETO: ${input.projectName} (ID: ${input.projectId})`);
    sections.push(`    CAMINHO: ${input.projectPath}`);
    sections.push(`    OBJETIVO GERAL: ${input.projectObjective || ''}`);
    sections.push(`  </project_metadata>`);

    if (input.briefing) {
      sections.push(`  <user_briefing>\n${input.briefing}\n  </user_briefing>`);
    }
    if (input.allMajorTasksSummary && input.allMajorTasksSummary.length > 0) {
      sections.push(`  <all_major_tasks_topology>\n${input.allMajorTasksSummary.map(m => `    - [${m.code}] ${m.title}`).join('\n')}\n  </all_major_tasks_topology>`);
    }
    if (input.projectRequirements && input.projectRequirements.length > 0) {
      sections.push(`  <project_requirements_catalog>\n${input.projectRequirements.map(r => `    - [${r.code}] ${r.title}`).join('\n')}\n  </project_requirements_catalog>`);
    }
    if (input.docSimpContextBlock) sections.push(`  <docsimp_blueprints>\n${input.docSimpContextBlock}\n  </docsimp_blueprints>`);

    const designBlock = input.designSkillContextBlock || input.designSkillBlock;
    if (designBlock) sections.push(`  <design_skill_tokens>\n${designBlock}\n  </design_skill_tokens>`);
    if (input.reaSaaSMasterContextBlock) sections.push(`  <rea_saas_master>\n${input.reaSaaSMasterContextBlock}\n  </rea_saas_master>`);

    if (input.marketDiscoveryContextBlock) {
      sections.push(`  <onda_0_market_discovery title="CAMADA C: ESTUDO DE MERCADO & REA DISCOVERY (ONDA 0)">\n=== CAMADA C: ESTUDO DE MERCADO & REA DISCOVERY (ONDA 0) ===\n${input.marketDiscoveryContextBlock}\n  </onda_0_market_discovery>`);
    }

    if (input.livingSpecContextBlock) {
      sections.push(`  <living_specifications source=".ai-dev-hub/specs/">\n${input.livingSpecContextBlock}\n  </living_specifications>`);
    } else if (input.projectPath && fs.existsSync(path.join(input.projectPath, '.ai-dev-hub', 'specs'))) {
      try {
        const specBlock = ProjectLivingSpecService.getRoleSpecificSpecContext(input.projectPath, 'SUPERVISOR_EXPAND');
        if (specBlock) {
          sections.push(`  <living_specifications source=".ai-dev-hub/specs/">\n${specBlock}\n  </living_specifications>`);
        }
      } catch (err) {
        if (typeof (globalThis as any).logger !== 'undefined' && (globalThis as any).logger?.warn) {
          (globalThis as any).logger.warn({
            event: 'server.handled_exception',
            file: 'promptArchitectureService',
            error: (err as any)?.message || String(err)
          });
        } else {
          console.warn('[WARN][server:promptArchitectureService]', err);
        }
      }
    }
    sections.push(`</workspace_context>`);
    sections.push('');

    // 3. BASE ABSOLUTA (RECÊNCIA E DIRETRIZ DE EXPANSÃO DA GT): CAMADA B
    sections.push(`<execution_directive role="SUPERVISOR" wave="ONDA_2_EXPANSION" target_gt="${input.majorTask.code}">`);
    sections.push(
      `  Com base exclusivamente nas especificações e no estado do repositório fornecidos nos blocos <workspace_context> acima, expanda a Grande Tarefa alvo em microtarefas atômicas executáveis:`,
      `  <target_major_task>`,
      `    GRANDE TAREFA ALVO: [${input.majorTask.code}] "${input.majorTask.title}"`,
      `    OBJETIVO: ${input.majorTask.objective}`,
      `    RESULTADO ESPERADO: ${input.majorTask.expectedOutcome || input.majorTask.title}`,
      `    ETAPAS PREVISTAS: ${JSON.stringify(input.majorTask.stages || [])}`,
      `    REQUISITOS VINCULADOS: ${JSON.stringify(input.majorTask.requirementIds || [])}`,
      `    GRANDE TAREFA PREDECESSORA: ${input.previousMajorTaskCode || 'Nenhuma (primeira Grande Tarefa)'}`,
      `    ÚLTIMA MICROTAREFA DA GT ANTERIOR: ${input.lastMicrotaskOfPreviousMajor || input.priorMajorTaskLastMicrotaskCode || 'Nenhuma'}`,
      `  </target_major_task>`,
      `  <atomic_expansion_rules>`,
      `    - Decompor esta Grande Tarefa em microtarefas cirúrgicas, semânticas e verificáveis pelo IndependentEvaluator.`,
      `    - Agrupar arquivos de configuração (.gitignore, .env.example, Dockerfile, package.json, tsconfig.json) junto à tarefa de setup inicial; jamais criar microtarefa isolada para arquivos de metadados.`,
      `    - DECOMPOSIÇÃO RICA EM 2 FASES MACRO SEQUENCIAIS (BACKEND-FIRST -> PROGRESSIVE FRONTEND REFINEMENT):`,
      `      * SE GT-1 A GT-6 (MACRO FASE 1 - BACKEND, SCHEMAS, SEED, AUTH, PIX & TESTES): Foco estrito em lógica de servidor, infra Dual-Mode DOCSIMP (/api/system/integrations), modelagem SQLite WAL e seedIfEmpty() rico (30-40 registros), autenticação Supabase Auth (/api/auth/register, /api/auth/login, /api/auth/logout, /api/auth/me) com Cloudflare Turnstile (/api/auth/verify-turnstile), gateway PushinPay PIX (/api/billing/plans, /api/billing/checkout-pix, /api/webhooks/pushinpay) idempotente, motor de busca com filtros compostos, esteira estilo n8n com 3 pilares (Headline, Transcrição e Thumbnail) e bateria exaustiva de testes unitários, validação HTTP 400 e AppSec (SQLi, XSS, Path Traversal). Nenhuma tarefa visual de polimento de UI começa antes de 100% do backend estar aprovado em GT-6.`,
      `      * SE GT-7 (MACRO FASE 1 - FRONTEND SIMPLES FUNCIONAL): Construção de interface base limpa e 100% conectada via fetch() a todas as rotas do backend, provando integração ponta a ponta.`,
      `      * SE GT-8 A GT-12+ (MACRO FASE 2 - REFINAMENTO PROFUNDO DE FRONTEND COM TALLY, N8N, ATTIO & PLAYWRIGHT): Decompor em microtarefas de maestria visual: GT-8 (Cores & Tipografia com tokens :root e tabular-nums), GT-9 (Inputs, Busca / & Modais Zero-Fricção estilo Tally max-w-[580px]), GT-10 (Data Grid estilo Attio h-9, filtros empilháveis, alternância Tabela/Cards e Slide-Over 480px-520px), GT-11 (Esteira Visual estilo n8n & Decompositor de 3 Pilares com responsividade Desktop 1440x900, Tablet 768x1024 e Mobile 390x844), GT-12 (Homologação Visual Playwright com persistência pós-F5, zero botões mortos, zero emojis e envio das Screenshots finais no Chat).`,
      `    - POSSE EXCLUSIVA DE ARQUIVOS E ANTI-CONTEXT-ROT: Definir na description uma 'action' detalhada e manter expectedFiles disjuntos entre tarefas paralelas.`,
      `    - Cada microtarefa deve conter: title (sem sufixos repetidos), description (contratos exatos de tabelas, rotas e tipos), majorTaskCode ("${input.majorTask.code}"), majorTaskTitle ("${input.majorTask.title}"), stageCode, stageTitle, requirementIds, expectedFiles (incluindo o teste em test/), allowedScope, criteria (2 a 4 critérios objetivos), verificationCommand (comando único simples compatível com controlledVerification.ts: "npm test", "npm run test", "node --test", "node --test <arquivo-relativo>", "tsc --noEmit"; proibido usar ";", "&&", "||", "|", "node -e" ou "node --check"), doneWhen e dependencies (a primeira microtarefa desta GT deve depender de "${input.lastMicrotaskOfPreviousMajor || input.priorMajorTaskLastMicrotaskCode || 'nenhuma'}").`,
      `  </atomic_expansion_rules>`,
      `  <output_contract>`,
      `    Responder exclusivamente com um JSON compacto (array de microtarefas):`,
      `    [{"title":"...","description":"...","milestone":"${input.majorTask.code}","majorTaskCode":"${input.majorTask.code}","majorTaskTitle":"${input.majorTask.title}","stageCode":"ET-1.1","stageTitle":"...","requirementIds":["REQ-1"],"expectedFiles":["src/...","test/..."],"orderIndex":1,"dependencies":[],"criteria":["..."],"verificationCommand":"npm test","doneWhen":"..."}]`,
      `  </output_contract>`
    );
    sections.push(`</execution_directive>`);

    const fullPrompt = this.enforcePromptBudget(sections.join('\n'));
    const hash = crypto.createHash('sha256').update(fullPrompt).digest('hex');
    return {
      prompt: fullPrompt,
      meta: {
        version: this.SUPERVISOR_CORE_RULES_VERSION,
        hash,
        mode: 'INITIAL_PLAN',
        role: 'SUPERVISOR'
      }
    };
  }
}