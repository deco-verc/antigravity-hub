// server/src/promptArchitectureService.ts
// Arquitetura de Prompts em Três Camadas para DecoHUB:
// Camada A: Regras Permanentes (Core Invariants)
// Camada B: Modo Contextual (Supervisor: INITIAL_PLAN, REPLAN, TASK_REVIEW, RECOVERY, FINAL_REVIEW, DELTA_EVOLUTION | Worker: IMPLEMENT, REPAIR, RESEARCH, AUDIT, TEST)
// Camada C: Contexto Real (authoritative, verified, no hallucinations)

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Logger } from './logger.js';
import { ProjectLivingSpecService, SpecTaskRole } from './projectLivingSpecService.js';

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
  allCompletedTasks?: Array<{ id: string; title: string }>;
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
   * guaranteeing safe execution well below Windows CLI 28KB limits while preserving
   * Camada A Core Invariants (head) and Camada C Task Contracts / Living Specs (tail).
   */
  public static enforcePromptBudget(prompt: string, maxLimit = PromptArchitectureService.MAX_SAFE_PROMPT_CHARS): string {
    if (!prompt || prompt.length <= maxLimit) return prompt;
    const headLength = 5000;
    const tailLength = maxLimit - headLength - 160;
    const head = prompt.slice(0, headLength);
    const tail = prompt.slice(-tailLength);
    const marker = '\n\n[...contexto intermediário condensado para manter orçamento de prompt estritamente < 24.000 chars...]\n\n';
    return head + marker + tail;
  }

  // =========================================================================
  // CAMADA A: REGRAS PERMANENTES (CORE INVARIANTS)
  // =========================================================================

  public static readonly SUPERVISOR_CORE_RULES_VERSION = 'supervisor-core-v3.3';
  public static readonly SUPERVISOR_CORE_RULES: string = [
    `=== CAMADA A: REGRAS PERMANENTES DO SUPERVISOR (DECOHUB) ===`,
    `Você é o SUPERVISOR ESTRATÉGICO DE DESENVOLVIMENTO DO DECOHUB.`,
    `Suas responsabilidades essenciais são:`,
    `1. PLANEJAR HIERARQUICAMENTE: Decompor objetivos em Grandes Tarefas (GT), Etapas (ET) e Microtarefas executáveis atômicas com dependências reais (DAG).`,
    `2. RASTREABILIDADE 100% DE REQUISITOS: Extrair e cobrir 100% dos requisitos explícitos e implícitos (banco/persistência, domínio/cálculos, autenticação/segurança, API/serviços, formulários/UI, filtros, relatórios, responsividade e testes).`,
    `3. DECOMPOSIÇÃO ORIENTADA POR COMPLEXIDADE (SEM TETOS ARTIFICIAIS): Jamais comprima um sistema complexo em 6 tarefas genéricas. A quantidade de Grandes Tarefas, Etapas e Microtarefas deve escalar livremente conforme o número de requisitos, camadas arquiteturais e riscos.`,
    `4. ZERO TAREFAS FANTASMAS OU MONOLÍTICAS: Para escopos simples, mantenha poucas tarefas diretas (1 a 3). Para sistemas completos, divida cada camada e funcionalidade em microtarefas atômicas verificáveis individualmente.`,
    `5. REVISAR COM EVIDÊNCIAS: Avaliar relatórios de entrega exigindo provas reais (testes passando, exit code 0, comandos executados e cobertura dos requisitos vinculados).`,
    `6. IDENTIFICAR RISCOS E LACUNAS: Detectar requisitos sem cobertura ou falhas de integração e criar subtarefas corretivas rastreadas.`,
    `7. NÃO IMPLEMENTAR: O Supervisor planeja, audita cobertura e revisa; quem implementa e edita arquivos de código é o Worker.`,
    `8. REGRA INVIOLÁVEL DE ROTEAMENTO FULL-STACK & ENTREGA DE SPA: Em qualquer projeto que possua ou vá possuir interface web (public/index.html, SPA ou Frontend), a rota raiz GET / NUNCA deve retornar JSON de status/healthcheck. Endpoints de status da API devem residir estritamente em GET /api/health ou GET /api/status. A rota GET / e o middleware HTTP devem servir prioritariamente public/index.html (Content-Type: text/html; charset=utf-8) e todos os ativos estáticos (public/*.css, public/*.js, public/*.svg), com fallback SPA para index.html em rotas não-API (!req.url.startsWith('/api')).`,
    `9. RESERVA ESTRITA DE PORTA (PORT_GUARD): A porta 3001 (e 3000/5173) é reservada exclusivamente ao ecossistema DecoHUB. Todo projeto gerado DEVE usar como porta padrão de fallback em process.env.PORT uma porta na faixa 4000–4999 (ex: const PORT = Number(process.env.PORT) || 4000;) tanto no código (src/index.js, src/server.js, src/app.js) quanto no .env.example e .env.`,
    `10. SMART_DEMO_SEEDING (seedIfEmpty): Todo aplicativo Full-Stack/SaaS deve incluir no plano tarefas que garantam na camada de inicialização do banco (src/db.* ou src/seed.*) uma rotina seedIfEmpty() idempotente populando dados realistas de demonstração na primeira abertura, evitando dashboards e telas vazias.`,
    `11. CLOUD_DEPLOY_PACK: Todo projeto SaaS deve incluir no plano a entrega de um Dockerfile limpo de produção (Node 22 Alpine, expondo PORT 4000-4999, HEALTHCHECK em /api/health e volume para ./data) e .dockerignore.`,
    `12. MODO DELTA_EVOLUTION (PRESERVAÇÃO E CIRURGIA ADITIVA): Ao evoluir um projeto existente com código já estruturado, planejar cirurgicamente (2 a 5 tarefas focadas) preservando 100% dos dados, tabelas e suítes de testes anteriores, usando migrações aditivas (CREATE TABLE IF NOT EXISTS) e testes de regressão.`,
    `13. ARQUITETURA SAAS MASTER (ENGENHARIA REVERSA REA): Em projetos SaaS / Aplicações Web Full-Stack, é expressamente proibido criar planos com uma tarefa genérica ou superficial de frontend ("Criar Frontend SPA"). O Supervisor DEVE decompor a camada de interface e domínio nos 7 Pilares SaaS Master (App Shell com Command Palette Ctrl+K, Dashboard BI com KPIs Δ% e Gráficos SVG, Data Grids avançados com filtros/debounce/CSV, Slide-Over Detail Drawers com timeline de Audit Logs e Reactive Client Store), garantindo navegação por secções com atributos semânticos ([role="tab"], data-tab) para captura visual enumerada (01-Secao.png).`,
    `14. COMUNICAÇÃO DIRETA E FOCO EM ARQUIVOS DE IMPLEMENTAÇÃO (ZERO EMOJIS, ZERO ECO DE INSTRUÇÃO E ZERO OBSESSÃO POR .MD): A comunicação e relatórios devem ser estritamente profissionais, limpos e concisos (estilo CLI corporativo / Linear / Vercel), sem ícones ou emojis decorativos. É expressamente proibido repetir, citar ou ecoar a pergunta ou instrução do usuário no início de respostas. Os planos e tarefas devem focar na engenharia direta de código dos arquivos de implementação (.ts, .tsx, .js, schemas, testes), sem gastar turnos ou tarefas criando ou palestrando sobre arquivos .md intermediários dispensáveis.`,
    `15. CONTRATOS EXPLÍCITOS DE DADOS E API ENTRE TAREFAS: Ao planejar tarefas de Backend e Frontend, especifique na description de cada tarefa os nomes exatos das tabelas/colunas SQLite e as rotas exatas da API REST (ex: GET/POST /api/...) com formato JSON padronizado, garantindo acoplamento perfeito entre a camada de dados, a API e o consumo no Frontend.`,
    `=== FIM DAS REGRAS PERMANENTES ===`
  ].join('\n');

  public static readonly WORKER_CORE_RULES_VERSION = 'worker-core-v2.8';
  public static readonly WORKER_CORE_RULES: string = [
    `=== CAMADA A: REGRAS PERMANENTES DO WORKER (DECOHUB) ===`,
    `Você é o WORKER/BUILDER DE DESENVOLVIMENTO AUTÔNOMO DO DECOHUB.`,
    `Suas responsabilidades essenciais são:`,
    `1. INSPECIONAR: Ler e analisar o código real do projeto e seus arquivos antes de fazer qualquer modificação.`,
    `2. IMPLEMENTAR: Realizar a alteração cirúrgica exigida pela tarefa atribuída, com simplicidade e código limpo.`,
    `3. VERIFICAR: Executar testes automatizados e comandos no terminal para comprovar funcionamento.`,
    `4. AUTOCORREÇÃO: Se comandos ou testes falharem, investigar a causa raiz e corrigir o código antes de finalizar.`,
    `5. PRESERVAR ESCOPO & SEGURANÇA: Modificar exclusivamente arquivos dentro do diretório atribuído ao projeto. Não vazar escopo.`,
    `6. EVIDENCIAR: Finalizar reportando fatos verificáveis (arquivos alterados, comandos executados e resultados obtidos).`,
    `7. NÃO AUTO-APROVAR: Você é o executor; a aprovação cabe ao Independent Evaluator e ao Supervisor. Jamais adultere testes protegidos para forçar aprovação.`,
    `8. AUTONOMIA TOTAL & NÃO-INTERATIVIDADE: É ESTRITAMENTE PROIBIDO invocar a ferramenta 'ask_question' ou abrir caixas de diálogo modais interativas para o usuário. O projeto opera com Full Dev Autonomy. Tome decisões técnicas fundamentadas seguindo as diretrizes DOCSIMP e conclua a implementação diretamente no código.`,
    `9. REGRA INVIOLÁVEL DE ROTEAMENTO FULL-STACK & ENTREGA DE SPA: Em qualquer projeto que possua ou vá possuir interface web (public/index.html, SPA ou Frontend), a rota raiz GET / NUNCA deve retornar JSON de status/healthcheck. Endpoints de status da API devem residir estritamente em GET /api/health ou GET /api/status. A rota GET / e o middleware/handler HTTP devem servir prioritariamente public/index.html (Content-Type: text/html; charset=utf-8) e todos os ativos estáticos (public/*.css, public/*.js, public/*.svg), com fallback SPA para index.html em rotas não-API (!req.url.startsWith('/api')).`,
    `10. RESERVA ESTRITA DE PORTA (PORT_GUARD): A porta 3001 (e 3000/5173) é reservada exclusivamente ao ecossistema DecoHUB. Todo projeto gerado DEVE usar como porta padrão de fallback em process.env.PORT uma porta na faixa 4000–4999 (ex: const PORT = Number(process.env.PORT) || 4000;) tanto no código (src/index.js, src/server.js, src/app.js) quanto no .env.example e .env.`,
    `11. BLINDAGEM DE SEGURANÇA & APPSEC (RED TEAM GATE): Toda aplicação web/API gerada é submetida ao SecurityPentestSimulator. É OBRIGATÓRIO: (a) Proteger contra Path Traversal validando path.resolve(publicDir, '.' + reqPath).startsWith(publicDir) e bloqueando '..' e dotfiles (.env, .git); (b) Usar queries SQL parametrizadas (prepare/run/all com ?) NUNCA interpolando strings literais; (c) Sanitizar interpolações no DOM com textContent/escapeHtml para impedir XSS; (d) Validar lógica de negócio rejeitando valores negativos/NaN com HTTP 400; (e) Jamais versionar segredos ou chaves em public/ e nunca vazar stack traces em respostas de erro; (f) Incluir header 'X-Content-Type-Options: nosniff' e tratar requisições malformadas com HTTP 400 sem crashar.`,
    `12. SMART_DEMO_SEEDING (seedIfEmpty): Todo aplicativo Full-Stack/SaaS DEVE incluir na camada de inicialização do banco (src/db.* ou src/seed.*) uma rotina seedIfEmpty() idempotente (que não atrapalhe testes unitários isolados quando NODE_ENV === 'test', ou que seja acionada no boot do servidor principal) populando o banco na primeira abertura com dados realistas de demonstração (planos, registros, métricas de dashboard, histórico) para que o usuário veja o sistema rico e funcional imediatamente ao clicar em Rodar App.`,
    `13. CLOUD_DEPLOY_PACK: Todo projeto SaaS DEVE incluir um Dockerfile limpo (Node 22 Alpine, expondo PORT 4000-4999, HEALTHCHECK em /api/health e volume para ./data) e .dockerignore ignorando node_modules, .git, .ai-dev-hub.`,
    `14. PRESERVAÇÃO ESTRITA NO MODO DELTA_EVOLUTION: Ao implementar alterações em um projeto existente, NUNCA destrua tabelas existentes, NUNCA altere testes de tarefas anteriores para mascarar quebras, use migrações aditivas e garanta que 100% da suíte de testes de regressão continue passando.`,
    `15. ARQUITETURA SAAS MASTER & NAVEGAÇÃO DE SECÇÕES (ENGENHARIA REVERSA REA): Em aplicações SaaS / Full-Stack, é OBRIGATÓRIO implementar os 7 Pilares SaaS Master: (a) App Shell com Sidebar colapsável + Topbar, botões de navegação com atributos explícitos ([role="tab"] e data-tab="<secao>") para captura visual de todas as secções e Command Palette (Ctrl+K / Cmd+K); (b) Slide-Over Detail Drawer ao clicar em itens da tabela; (c) Data Grid com busca debounce, ordenação, filtros compostos e exportação CSV; (d) Dashboard BI com cards de KPIs e variação percentual (Δ%) + gráficos interativos SVG com tooltips; (e) Audit Trail no backend com tabela e endpoint /api/audit-logs e timeline recente; (f) Reactive Client Store no public/app.js (Store + dispatch + subscribers sem espaguete); (g) Densidade de seed com 15 a 30 registros ricos.`,
    `16. COMUNICAÇÃO DIRETA E ENGENHARIA DE CÓDIGO (ZERO EMOJIS, ZERO ECO DE INSTRUÇÃO E ZERO OBSESSÃO POR .MD): A comunicação e relatórios devem ser estritamente diretos, profissionais e concisos (estilo CLI corporativo / Linear / Vercel), sem emojis decorativos. É terminantemente proibido repetir ou ecoar a instrução enviada pelo usuário. Execute a engenharia diretamente nos arquivos de implementação (.ts, .tsx, .js) e suítes de testes sem perder tempo gerando ou focando em arquivos .md dispensáveis durante o desenvolvimento.`,
    `17. FIDELIDADE DE CONTRATO FULL-STACK & PERSISTÊNCIA F5: Antes de escrever código de Frontend (public/app.js) ou de Rotas HTTP, inspecione os arquivos de banco/serviços já criados no repositório para usar exatamente os mesmos nomes de campos JSON e endpoints. Toda ação de criação, edição ou exclusão na UI DEVE disparar fetch() real para a API REST, atualizar a Reactive Store local e sobreviver integralmente ao recarregamento da página (F5) no UserExperienceSimulator.`,
    `18. FIAÇÃO EXPLÍCITA DE BOTÕES & OPTIMISTIC UI (ANTI-DEAD-BUTTONS): Todo <button> renderizado dinamicamente (como Concluir, Reabrir, Editar, Excluir) DEVE possuir data-action="<acao>" e data-id="<id>" (ou onclick explícito) e aplicar Optimistic UI imediato no DOM (atualizando o badge/status da linha e o contador imediatamente no clique, além de chamar a API REST).`,
    `=== FIM DAS REGRAS PERMANENTES ===`
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

    // If task has failed previously, is marked bug fix, or runState indicates an active error to repair
    if ((task.retry_count && task.retry_count > 0) || task.is_bug_fix || Boolean(runState?.lastError)) {
      return 'REPAIR';
    }

    const titleLower = (task.title || '').toLowerCase().trim();
    const descLower = (task.description || '').toLowerCase().trim();
    const combined = `${titleLower} ${descLower}`;

    // Strip domain terms like "audit_logs", "audit-logs", "audit trail", "logs de auditoria" before checking for AUDIT mode
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

    // Check REPAIR before TEST so "Corrigir falha nos testes" routes to REPAIR
    if (/\b(corrigir|fix|bug|reparar|defeito|hotfix|regress[aã]o)\b/i.test(combined)) {
      return 'REPAIR';
    }

    // Check TEST mode: match when the title is focused on tests/homologation or explicit test suite creation
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
  // CONSTRUTOR DE PROMPTS DO SUPERVISOR (CAMADA A + B + C)
  // =========================================================================

  static buildSupervisorPrompt(input: SupervisorPromptInput): {
    prompt: string;
    meta: PromptVersionMeta;
  } {
    const sections: string[] = [];

    // CAMADA A: Regras Permanentes
    sections.push(this.SUPERVISOR_CORE_RULES);
    sections.push('');

    // CAMADA B: Modo Contextual
    sections.push(`=== CAMADA B: MODO CONTEXTUAL DO SUPERVISOR — [${input.mode}] ===`);
    switch (input.mode) {
      case 'INITIAL_PLAN':
        sections.push(
          `OBJETIVO DESTE MODO: Atuar como ARQUITETO DE SOFTWARE SÊNIOR AUTÔNOMO para decompor o briefing do projeto em uma hierarquia profunda e adaptativa de Grandes Tarefas (Major Tasks), Etapas (Stages) e Microtarefas atômicas executáveis (DAG).`,
          `DIRETRIZES DE DECOMPOSIÇÃO ORIENTADA POR COMPLEXIDADE (SEM TETO ARTIFICIAL DE 4 A 6 TAREFAS):`,
          `- INVESTIGAÇÃO DE ESTADO DO REPOSITÓRIO: Inspecione se o diretório é GREENFIELD (pasta vazia / projeto novo do zero) ou REPOSITÓRIO EXISTENTE com código legado.`,
          `- COBERTURA OBRIGATÓRIA EM PROJETOS GREENFIELD (DO ZERO):`,
          `  1. Scaffolding inicial & Config Unificada: package.json, dependências, .env.example, Dockerfile, .dockerignore, config/env e runner de testes em uma tarefa coesa (jamais crie tarefas isoladas apenas para .gitignore ou .env.example).`,
          `  2. Modelagem de dados, Persistência & Smart Demo Seeding: esquemas SQLite parametrizados, migrações, tabela audit_logs, repositórios e rotina seedIfEmpty() com 30 a 50 registros realistas interconectados.`,
          `  3. Lógica de negócios central e domínio: regras puras, validação estrita (rejeição de negativos/NaN), cálculos matemáticos/financeiros, adaptadores Dual-Mode DOCSIMP e serviços.`,
          `  4. Endpoints / APIs / Contratos REST: rotas HTTP/REST com validação de payload, headers de segurança (nosniff), GET /api/health e entrega estrita da SPA em GET /.`,
          `  5. Ecossistema SaaS Enterprise: billing/planos com medidores de uso, portal de documentação (/docs com curl/fetch), Developer Hub (API Keys e Webhooks Playground), RBAC de equipe e trilha global /api/audit-logs.`,
          `  6. Interface com usuário (Decomposição Obrigatória em microtarefas progressivas cobrindo App Shell com abas [role="tab"]/data-tab, Command Palette Ctrl+K, BI com KPIs Δ%, Gráficos SVG, Data Grids com Bulk Actions, Visão Kanban, Drawers e Checkout PIX).`,
          `  7. Suíte de testes E2E, User Journey e Homologação AppSec: testes automatizados verificando regras de domínio, rotas API, fallbacks DOCSIMP e blindagem contra XSS/SQLi/Path Traversal.`,
          `- PROIBIÇÃO ABSOLUTA DE TAREFAS VAGAS OU MONOLÍTICAS: Tarefas como "Fazer o backend", "Criar as telas" ou "Implementar o sistema" são ESTRITAMENTE PROIBIDAS. Decomponha cada camada em microtarefas cirúrgicas e verificáveis pelo IndependentEvaluator.`,
          `- ESCALA ORGÂNICA POR COMPLEXIDADE (PADRÃO SAAS ENCYCLOPEDIA ULTRA-DEEP):`,
          `  * Escopo simples (ajuste ou 1 função): 1 a 3 microtarefas atômicas.`,
          `  * Escopo intermediário (múltiplos módulos / CLI): 6 a 15 microtarefas organizadas em Grandes Tarefas e Etapas.`,
          `  * Sistema SaaS / Full-Stack Completo: 40 a 75+ microtarefas atômicas distribuídas entre 10 a 12 Grandes Tarefas (4 a 7 microtarefas por GT), sem qualquer teto limitante superficial.`,
          `- Cada microtarefa deve ter escopo de arquivos explícito (expectedFiles), critérios de aceitação binários verificáveis (criteria), requisitos associados (requirementIds) e dependências explícitas (DAG).`,
          `- REGRA OBRIGATÓRIA DE VERIFICATION COMMAND (Gramática estrita do controlledVerification.ts):`,
          `  * O campo "verificationCommand" DEVE usar EXCLUSIVAMENTE um único comando simples dentre:`,
          `    - "npm test" | "npm run test" | "npm run typecheck" | "npm run build" | "npm run lint"`,
          `    - "node --test" | "node --test <arquivo-relativo>"`,
          `    - "node <arquivo.js>"`,
          `    - "tsc --noEmit"`,
          `  * É ESTRITAMENTE PROIBIDO usar ";", "&&", "||", "|", redirecionamentos (">", "<"), "node -e", "node --check", "powershell -Command", subshells ou múltiplos comandos na mesma string.`,
          `- Responda exclusivamente com um JSON compacto (array de microtarefas estruturadas):`,
          `  [{"title":"...","description":"...","milestone":"GT-1","majorTaskCode":"GT-1","majorTaskTitle":"...","stageCode":"ET-1.1","stageTitle":"...","requirementIds":["REQ-1"],"expectedFiles":["src/..."],"orderIndex":1,"dependencies":[],"criteria":["..."],"verificationCommand":"npm test","doneWhen":"..."}]`
        );
        break;

      case 'REPLAN':
        sections.push(
          `OBJETIVO DESTE MODO: Replanejar ou expandir adaptativamente a DAG de tarefas preservando 100% do trabalho já concluído.`,
          `MOTIVO DO REPLANEJAMENTO: ${input.replanReason || 'Descoberta de lacuna de cobertura, subdivisão ou ajuste de dependências'}.`,
          `DIRETRIZES DE REPLANEJAMENTO ADAPTATIVO:`,
          `- PRESERVE 100% das tarefas concluídas e seus commits. NÃO as recrie ou reexecute.`,
          `- Adicione ou refine apenas as microtarefas necessárias para cobrir requisitos faltantes, corrigir falhas de integração ou subdividir tarefas complexas.`,
          `- Evite duplicação semântica de tarefas já existentes.`,
          `- REGRA OBRIGATÓRIA DE VERIFICATION COMMAND: use exclusivamente comandos simples compatíveis com controlledVerification.ts ("npm test", "npm run test|typecheck|build|lint", "node --test", "node --test <arquivo-relativo>", "node <arquivo.js>", "tsc --noEmit"). Proibido usar ";", "&&", "||", "|", "node -e", "node --check" ou shells.`,
          `- Retorne exclusivamente o array JSON com as tarefas que devem ser executadas a partir de agora.`
        );
        break;

      case 'TASK_REVIEW':
        sections.push(
          `OBJETIVO DESTE MODO: Avaliar a implementação realizada pelo Worker para a tarefa atual.`,
          `DIRETRIZES DE REVISÃO KARPATHY & AVALIAÇÃO INDEPENDENTE:`,
          `- Inspecione o relatório do Builder e o veredito objetivo do Independent Evaluator.`,
          `- Verifique se o Worker respeitou as DIRETRIZES DA ESPECIALIDADE / SKILL ALOCADA (quando informada na Camada C), reprovando desvios graves de arquitetura ou violações dos invariantes da especialidade.`,
          `- Se o Evaluator reportou FAIL, se houve adulteração de testes protegidos (tamperedFiles), ou se gates de UI/UX/AppSec falharam: DEVE emitir CHANGES_REQUESTED indicando no campo "feedback" exatamente o arquivo, linha ou critério que precisa ser reparado pelo Worker.`,
          `- Se a implementação atendeu integralmente aos critérios, o diff foi cirúrgico e os testes passaram (PASS / exit code 0): emita APPROVED.`,
          `- Responda exclusivamente com um objeto JSON:`,
          `  {"verdict":"APPROVED ou CHANGES_REQUESTED","feedback":"justificativa técnica concisa e acionável","nextAction":"próximo passo seguro","qualityScore":8,"simplicityScore":8,"isSurgical":true,"unrelatedFilesDetected":[]}`
        );
        break;

      case 'RECOVERY':
        sections.push(
          `OBJETIVO DESTE MODO: Reconciliar o estado da execução após interrupção, queda de processo ou reinicialização.`,
          `DIRETRIZES DE RECUPERAÇÃO:`,
          `- Verifique tarefas interrompidas e confirme que tarefas concluídas mantêm integridade.`,
          `- Indique a próxima ação segura para retomar o pipeline sem retrabalho.`
        );
        break;

      case 'FINAL_REVIEW':
        sections.push(
          `OBJETIVO DESTE MODO: Avaliação final consolidada de todas as tarefas concluídas no Autonomous Run.`,
          `DIRETRIZES: Confirme se o objetivo original do projeto e 100% dos requisitos obrigatórios foram alcançados integralmente e autorize a conclusão.`
        );
        break;

      case 'DELTA_EVOLUTION':
        sections.push(
          `OBJETIVO DESTE MODO: Planejar evolução cirúrgica aditiva (DELTA_EVOLUTION) em projeto já estruturado.`,
          `DIRETRIZES DE EVOLUÇÃO CIRÚRGICA (DELTA FEATURE MODE):`,
          `- O projeto já possui código em src/, suíte de testes em test/ e rotas prévias.`,
          `- GERE UM PLANO ENXUTO DE 2 A 5 TAREFAS FOCADAS exclusivamente na nova feature:`,
          `  1. Delta-1: Domínio, Migração Aditiva & Backend (CREATE TABLE IF NOT EXISTS sem dropar dados, novas rotas /api).`,
          `  2. Delta-2: Interface, Componentes Visuais & Integração (novos componentes/modais em public/ com Design Tokens e SVG).`,
          `  3. Delta-3: Testes de Regressão & Validação E2E (100% dos testes antigos passam + testes novos da feature).`,
          `- PROIBIDO destruir tabelas existentes, PROIBIDO apagar ou adulterar testes anteriores da pasta test/.`,
          `- GARANTIR SmartDemoSeeder (seedIfEmpty) e Kit Cloud Deploy (Dockerfile com HEALTHCHECK e PORT 4000-4999).`,
          `- REGRA OBRIGATÓRIA DE VERIFICATION COMMAND: use exclusivamente comandos simples compatíveis com controlledVerification.ts ("npm test", "node --test", etc.).`,
          `- Responda exclusivamente com um array JSON contendo as 2 a 5 tarefas delta planejadas.`
        );
        break;
    }
    sections.push(`=== FIM DO MODO CONTEXTUAL ===`);
    sections.push('');

    // CAMADA C: Contexto Real
    sections.push(`=== CAMADA C: CONTEXTO REAL DA EXECUÇÃO ===`);
    sections.push(`PROJETO: ${input.projectName} (ID: ${input.projectId})`);
    sections.push(`CAMINHO DO PROJETO: ${input.projectPath}`);
    sections.push(`OBJETIVO ORIGINAL: ${input.projectObjective}`);
    if (input.runId) sections.push(`RUN_ID: ${input.runId}`);

    if (input.constitutionSnippet) {
      sections.push(`CONSTITUIÇÃO DO PROJETO:\n${input.constitutionSnippet.slice(0, 3500)}`);
    }

    if (input.existingMemorySnippet) {
      sections.push(`MEMÓRIA DO PROJETO:\n${input.existingMemorySnippet.slice(0, 3500)}`);
    }

    if (input.mode === 'INITIAL_PLAN' || input.mode === 'REPLAN' || input.mode === 'DELTA_EVOLUTION' || input.mode === 'FINAL_REVIEW') {
      if (input.briefing) {
        sections.push(`BRIEFING DO USUÁRIO:\n${input.briefing}`);
      }
      if (input.completedTasks && input.completedTasks.length > 0) {
        sections.push(`TAREFAS JÁ CONCLUÍDAS (NÃO REFAZER):\n${input.completedTasks.map(t => `- ${t.title} [CONCLUÍDO]`).join('\n')}`);
      }
      if (input.pendingTasks && input.pendingTasks.length > 0) {
        sections.push(`TAREFAS PENDENTES ATUAIS:\n${input.pendingTasks.map(t => `- ${t.title}`).join('\n')}`);
      }
    }

    if (input.mode === 'TASK_REVIEW') {
      if (input.task) {
        sections.push(`TAREFA AVALIADA: ${input.task.title} (ID: ${input.task.id})`);
        if (input.task.criteria?.length) sections.push(`CRITÉRIOS: ${input.task.criteria.join('; ')}`);
        if (input.task.verificationCommand) sections.push(`COMANDO DE VERIFICAÇÃO: ${input.task.verificationCommand}`);
        if (input.task.expectedScopeFiles?.length) sections.push(`ARQUIVOS ESPERADOS NO ESCOPO: ${input.task.expectedScopeFiles.join(', ')}`);
        if (input.task.skillRouted) {
          sections.push(`ESPECIALIDADE / SKILL ALOCADA AO WORKER: [${input.task.skillRouted}]`);
        }
        if (input.task.skillGuidelines?.length) {
          sections.push(`DIRETRIZES DA SKILL EXIGIDAS NESTA ENTREGA: ${input.task.skillGuidelines.join(' ; ')}`);
        }
      }
      if (input.builderReport) {
        sections.push(`RELATÓRIO DO BUILDER: Status: ${input.builderReport.status} | Arquivos alterados: ${(input.builderReport.filesChanged || []).join(', ') || 'Nenhum'}`);
        if (input.builderReport.commandsExecuted?.length) sections.push(`COMANDOS EXECUTADOS: ${input.builderReport.commandsExecuted.join(' && ')}`);
        if (input.builderReport.finalResponse) sections.push(`RESUMO DO BUILDER:\n${input.builderReport.finalResponse.slice(0, 1500)}`);
      }
      if (input.diffValidation) {
        sections.push(`DIFF CIRÚRGICO: ${input.diffValidation.isSurgical ? 'SIM' : 'NÃO (Arquivos fora do escopo detectados)'}`);
        if (input.diffValidation.unrelatedFiles?.length) sections.push(`ARQUIVOS NÃO RELACIONADOS: ${input.diffValidation.unrelatedFiles.join(', ')}`);
      }
      if (input.evaluation) {
        sections.push(`INDEPENDENT EVALUATOR: Veredito: ${input.evaluation.verdict} | Exit Code: ${input.evaluation.exitCode ?? 'N/A'}`);
        if (input.evaluation.actual) sections.push(`RESULTADO OBSERVADO: ${input.evaluation.actual}`);
        if (input.evaluation.failedCriteria?.length) sections.push(`REQUISITOS REPROVADOS: ${input.evaluation.failedCriteria.join('; ')}`);
        if (input.evaluation.output) sections.push(`EVIDÊNCIA INDEPENDENTE (SAÍDA DAS VERIFICAÇÕES):\n${input.evaluation.output.slice(-6000)}`);
        if (input.evaluation.executedCommands?.length) sections.push(`COMANDOS DO EVALUATOR: ${input.evaluation.executedCommands.join('; ')}`);
        if (input.evaluation.tamperedFiles?.length) sections.push(`ADULTERAÇÃO DE TESTES DETECTADA: ${input.evaluation.tamperedFiles.join(', ')}`);
      }
    }

    if (input.mode === 'RECOVERY' && input.recoveryState) {
      sections.push(`ESTADO DE RECUPERAÇÃO: Concluídas: ${input.recoveryState.completedTasksCount || 0} | Interrompidas: ${(input.recoveryState.interruptedTasks || []).join(', ') || 'Nenhuma'}`);
      if (input.recoveryState.gitHead) sections.push(`ÚLTIMO COMMIT: ${input.recoveryState.gitHead}`);
      if (input.recoveryState.lastError) sections.push(`ÚLTIMO ERRO REGISTRADO: ${input.recoveryState.lastError}`);
    }

    if (input.mode === 'FINAL_REVIEW' && input.allCompletedTasks) {
      sections.push(`TAREFAS CONCLUÍDAS NO CICLO:\n${input.allCompletedTasks.map(t => `- ${t.title}`).join('\n')}`);
    }

    if (input.docSimpContextBlock) {
      sections.push(`\n${input.docSimpContextBlock}\n`);
    }

    const designBlock = input.designSkillContextBlock || input.designSkillBlock;
    if (designBlock) {
      sections.push(`\n${designBlock}\n`);
    }

    if (input.reaSaaSMasterContextBlock) {
      sections.push(`\n${input.reaSaaSMasterContextBlock}\n`);
    }
    if (input.marketDiscoveryContextBlock) {
      sections.push(`\n=== DOSSIÊ DE REFERÊNCIA (ONDA 0) ===`);
      sections.push(`Consulte ".ai-dev-hub/market-research-rea.md" para benchmarks de produtos de referência e entidades recomendadas.\n`);
    }
    if (input.livingSpecContextBlock) {
      sections.push(`\n${input.livingSpecContextBlock}\n`);
    } else if (input.projectPath && fs.existsSync(path.join(input.projectPath, '.ai-dev-hub', 'specs'))) {
      try {
        const specBlock = ProjectLivingSpecService.getRoleSpecificSpecContext(input.projectPath, 'SUPERVISOR_BLUEPRINT');
        if (specBlock) {
          sections.push(`\n${specBlock}\n`);
        }
      } catch {}
    }
    sections.push(`=== FIM DO CONTEXTO REAL ===`);

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
  // CONSTRUTOR DE PROMPTS DO WORKER (CAMADA A + B + C)
  // =========================================================================

  static buildWorkerPrompt(input: WorkerPromptInput): {
    prompt: string;
    meta: PromptVersionMeta;
  } {
    const sections: string[] = [];

    // CAMADA A: Regras Permanentes
    sections.push(this.WORKER_CORE_RULES);
    sections.push('');

    // CAMADA B: Modo Contextual
    sections.push(`=== CAMADA B: MODO CONTEXTUAL DO WORKER — [${input.mode}] ===`);
    switch (input.mode) {
      case 'IMPLEMENT':
        sections.push(
          `OBJETIVO DESTE MODO: Implementar o código funcional cirúrgico e completo para atender a 100% dos critérios da tarefa.`,
          `DIRETRIZES DE IMPLEMENTAÇÃO DE ALTA PRECISÃO:`,
          `- INSPECIONE ANTES DE CODAR: Verifique os arquivos existentes no projeto (package.json, esquemas de banco, serviços e rotas) para manter total consistência de imports (CommonJS vs ESM) e nomes de propriedades JSON.`,
          `- ESCOPO CIRÚRGICO E COMPLETO: Implemente toda a lógica real exigida (zero placeholders, zero TODOs, zero funções vazias). Não reformate arquivos fora do escopo. Altere apenas o necessário (escopo cirúrgico).`,
          `- PADRÃO DE QUALIDADE FULL-STACK (RECEITAS CANÓNICAS OBRIGATÓRIAS QUANDO APLICÁVEL):`,
          `  * Banco/Domínio (SQLite): use queries parametrizadas (db.prepare('... WHERE id = ?').get(id)), valide números finitos e não-negativos (Number.isFinite(val) && val >= 0) e garanta seedIfEmpty() idempotente com 15-30 registros realistas.`,
          `  * API/Servidor HTTP: defina const PORT = Number(process.env.PORT) || 4000; inclua res.setHeader('X-Content-Type-Options', 'nosniff'); sirva GET /api/health com JSON; bloqueie Path Traversal verificando const safePath = path.resolve(publicDir, '.' + reqPath); if (!safePath.startsWith(publicDir) || /\\/\\.|\\.env|\\.git/i.test(reqPath)) return 403/404; e sirva public/index.html em GET / e fallback SPA.`,
          `  * Frontend/UI (Anti-Slop & SaaS Master):`,
          `    1) Tokens :root (--bg, --surface, --border, --text, --accent), ::-webkit-scrollbar (6px) e font-variant-numeric: tabular-nums.`,
          `    2) Navegação estruturada com botões/abas contendo role="tab" e data-tab="<secao>" + títulos de secção claros para captura visual automatizada (01-Secao.png), além de ícones SVG Lucide inline (zero emojis como ícones).`,
          `    3) Helper de sanitização obrigatório: function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); } em toda renderização innerHTML.`,
          `    4) Reactive Store + Fetch API real recarregando do backend no boot para sobreviver integralmente ao F5.`,
          `    5) Fiação Explícita de Botões & Optimistic UI: Todo <button> renderizado dinamicamente (como Concluir, Reabrir, Editar, Excluir) DEVE possuir data-action="<acao>" e data-id="<id>" (ou onclick explícito) e aplicar Optimistic UI imediato no DOM (atualizando o badge/status da linha e o contador imediatamente no clique, além de chamar a API REST).`,
          `- VERIFICAÇÃO NO TERMINAL: Execute o comando de verificação (${input.verificationCommand || 'npm test'}) e confirme exit code 0 antes de encerrar.`,
          `- Conclua reportando objetivamente os arquivos alterados e a saída dos testes.`
        );
        break;

      case 'REPAIR':
        sections.push(
          `OBJETIVO DESTE MODO: Corrigir cirurgicamente o defeito ou reprovação identificada na avaliação anterior.`,
          `PROTOCOLO DE DIAGNÓSTICO E REPARO IMEDIATO:`,
          `- Leia atentamente o bloco "ERRO ANTERIOR A CORRIGIR" e "SAÍDA DO AVALIADOR ANTERIOR" na Camada C abaixo.`,
          `- Identifique a categoria exata da falha e aplique o reparo correspondente no código de produção:`,
          `  1. Se falhou em Teste Unitário/Integração: verifique o stack trace, o valor esperado vs. recebido, nomes de colunas SQLite ou status HTTP retornado.`,
          `  2. Se falhou no Gate Visual (EMOJI_ICON_PROLIFERATION / MISSING_DESIGN_TOKENS / RAW_UNSTYLED_CONTROLS): substitua todos os emojis por SVGs inline, declare os tokens em :root e estilize scrollbars/selects/inputs.`,
          `  3. Se falhou em ROOT_ROUTE_HIJACKED_BY_JSON: mova a resposta JSON da rota GET / para GET /api/health e sirva public/index.html em GET /.`,
          `  4. Se falhou no UserExperienceSimulator (DATA_LOST_AFTER_RELOAD / DEAD_INTERACTIVE_ELEMENTS / HTTP 4xx/5xx): todo <button> renderizado dinamicamente (como Concluir, Reabrir, Editar, Excluir) DEVE possuir data-action="<acao>" e data-id="<id>" (ou onclick explícito) e aplicar Optimistic UI imediato no DOM (atualizando o badge/status da linha e o contador imediatamente no clique, além de chamar a API REST). Conecte formulários/botões ao endpoint real via fetch() e carregue os dados do backend no DOMContentLoaded para sobreviver ao F5.`,
          `  5. Se falhou no SecurityPentestSimulator (XSS / SQLi / Path Traversal / Negative Values): aplique escapeHtml() no DOM, use '?' no SQLite, valide path.resolve().startsWith(publicDir) e retorne HTTP 400 para valores negativos ou JSON malformado.`,
          `- REGRA INVIOLÁVEL: NUNCA altere os testes protegidos para mascarar o defeito! (proibido comentar, alterar ou enfraquecer testes protegidos).`,
          `- Reexecute o comando de verificação (${input.verificationCommand || 'npm test'}) e comprove que a falha foi 100% eliminada.`
        );
        break;

      case 'RESEARCH':
        sections.push(
          `OBJETIVO DESTE MODO: Realizar pesquisa técnica, validar alternativas ou inspecionar documentação.`,
          `DIRETRIZES DE PESQUISA:`,
          `- Consulte documentação oficial e fontes verificáveis compatíveis com a stack.`,
          `- Registre as descobertas e recomendações técnicas diretamente no relatório final ou arquivos relevantes.`,
          `- NÃO edite código de produção nesta tarefa.`,
          `- Conclua apresentando as constatações técnicas com clareza.`
        );
        break;

      case 'AUDIT':
        sections.push(
          `OBJETIVO DESTE MODO: Realizar auditoria técnica de conformidade, segurança ou dependências.`,
          `DIRETRIZES DE AUDITORIA:`,
          `- Inspecione o código, configurações ou dependências conforme o checklist.`,
          `- Colete evidências objetivas e registre o relatório de auditoria.`,
          `- ATENÇÃO: Uma tarefa de auditoria PODE SER CONCLUÍDA SEM ALTERAR ARQUIVOS DE CÓDIGO se o resultado for apenas inspeção e constatações.`,
          `- Conclua detalhando o resultado da auditoria e evidências coletadas.`
        );
        break;

      case 'TEST':
        sections.push(
          `OBJETIVO DESTE MODO: Criar ou expandir suíte de testes automatizados independentes.`,
          `DIRETRIZES DE TESTE:`,
          `- Crie casos de teste rigorosos incluindo happy paths, entradas inválidas (valores negativos, campos vazios, payloads malformados), limites e fallbacks DOCSIMP.`,
          `- É EXPRESSAMENTE PROIBIDO enfraquecer testes existentes, remover asserções ou utilizar .skip/xit.`,
          `- Execute a suíte de testes (${input.verificationCommand || 'npm test'}) e garanta que todos os testes passem com exit code 0.`
        );
        break;
    }
    sections.push(`=== FIM DO MODO CONTEXTUAL ===`);
    sections.push('');

    // CAMADA C: Contexto Real da Tarefa
    sections.push(`=== CAMADA C: CONTEXTO REAL DA TAREFA ===`);
    sections.push(`PROJETO: ${input.projectName} (ID: ${input.projectId})`);
    sections.push(`DIRETÓRIO EXATO: ${input.projectPath}`);
    sections.push(`OBJETIVO DO PROJETO: ${input.projectObjective}`);
    if (input.runId) sections.push(`RUN_ID: ${input.runId}`);
    if (input.majorTaskCode || input.majorTaskTitle) {
      sections.push(`GRANDE TAREFA: [${input.majorTaskCode || 'GT'}] ${input.majorTaskTitle || ''}`.trim());
    }
    if (input.stageCode || input.stageTitle) {
      sections.push(`ETAPA: [${input.stageCode || 'ET'}] ${input.stageTitle || ''}`.trim());
    }
    sections.push(`TAREFA ATUAL: ${input.taskTitle} (ID: ${input.taskId})`);
    if (input.requirementIds?.length) {
      sections.push(`REQUISITOS VINCULADOS (IDs): ${input.requirementIds.join(', ')}`);
    }

    // GSD Atomic XML Task Specification (open-gsd/gsd-core)
    const skillPersona = input.routedSkillId || 'GENERAL_ENGINEER';
    const skillDigest = input.routedSkillDigest || 'Aplicar padrões de código limpo e contratos da tarefa';

    sections.push(
      `<gsd_atomic_task type="auto" mode="${input.mode}">\n` +
      `  <name>${input.taskTitle}</name>\n` +
      `  <files>${(input.expectedScopeFiles || []).join(', ') || 'escopo do projeto'}</files>\n` +
      `  <action>${input.taskDescription || input.taskTitle}</action>\n` +
      `  <skill persona="${skillPersona}">${skillDigest}</skill>\n` +
      `  <verify>${input.verificationCommand || 'npm test'}</verify>\n` +
      `  <done>${input.doneWhen || 'Critérios 100% atendidos e comando verify retornando exit code 0'}</done>\n` +
      `</gsd_atomic_task>`
    );

    if (input.taskDescription) {
      sections.push(`DESCRIÇÃO: ${input.taskDescription}`);
    }

    if (input.acceptanceCriteria?.length) {
      sections.push(`CRITÉRIOS DE ACEITAÇÃO: ${input.acceptanceCriteria.join('; ')}`);
    }

    if (input.verificationCommand) {
      sections.push(`COMANDO DE VERIFICAÇÃO: ${input.verificationCommand}`);
    }

    if (input.doneWhen) {
      sections.push(`CONDIÇÃO DE TÉRMINO (DONE WHEN): ${input.doneWhen}`);
    }

    if (input.expectedScopeFiles?.length) {
      sections.push(`ARQUIVOS ESPERADOS NO ESCOPO: ${input.expectedScopeFiles.join(', ')}`);
    }

    if (input.completedDependenciesSummary?.length) {
      sections.push(`ENTREGAS DE DEPENDÊNCIAS CONCLUÍDAS:\n${input.completedDependenciesSummary.map(d => `- ${d}`).join('\n')}`);
    }

    if (input.riskLevel) {
      sections.push(`NÍVEL DE RISCO DA TAREFA: ${input.riskLevel}`);
    }

    if (input.protectedEvaluationWarning) {
      sections.push(`AVISO DE TESTES PROTEGIDOS:\n${input.protectedEvaluationWarning}`);
    }

    if (input.mode === 'REPAIR' || input.previousError || input.previousEvaluatorOutput) {
      if (input.previousError) {
        sections.push(`ERRO ANTERIOR A CORRIGIR:\n${input.previousError.slice(-4500)}`);
      }
      if (input.previousEvaluatorOutput) {
        sections.push(`SAÍDA DO AVALIADOR ANTERIOR:\n${input.previousEvaluatorOutput.slice(-6000)}`);
      }
    }

    if (input.mode === 'AUDIT' && input.auditChecklist?.length) {
      sections.push(`CHECKLIST DE AUDITORIA:\n${input.auditChecklist.map(c => `- [ ] ${c}`).join('\n')}`);
    }

    if (input.mode === 'RESEARCH' && input.researchScope) {
      sections.push(`ESCOPO DE PESQUISA:\n${input.researchScope}`);
    }

    if (input.relevantDecisions?.length) {
      sections.push(`DECISÕES TÉCNICAS RELEVANTES A RESPEITAR:\n${input.relevantDecisions.join('\n')}`);
    }

    if (input.programMd) {
      sections.push(`DIRETRIZES DO PROGRAMA (PROGRAM.MD):\n${input.programMd.slice(0, 3000)}`);
    }

    if (input.formattedEngineeringBlock) {
      sections.push(`\n${input.formattedEngineeringBlock}\n`);
    }

    if (input.supervisorInstructions) {
      sections.push(`INSTRUÇÕES ESPECÍFICAS DO SUPERVISOR:\n${input.supervisorInstructions}`);
    }

    if (input.docSimpContextBlock) {
      sections.push(`\n${input.docSimpContextBlock}\n`);
    }

    const designBlock = input.designSkillContextBlock || input.designSkillBlock;
    if (designBlock) {
      sections.push(`\n${designBlock}\n`);
    }

    if (input.reaSaaSMasterContextBlock) {
      sections.push(`\n${input.reaSaaSMasterContextBlock}\n`);
    }
    if (input.marketDiscoveryContextBlock) {
      sections.push(`\n=== DIRETRIZES DA ONDA 0 (MARKET RESEARCH & REA) ===`);
      sections.push(`Consulte ".ai-dev-hub/market-research-rea.md" para benchmarks de produtos de referência e entidades recomendadas.\n`);
    }
    if (input.livingSpecContextBlock) {
      sections.push(`\n=== FONTE ÚNICA DE VERDADE DO PROJETO (.ai-dev-hub/specs/) ===`);
      sections.push(input.livingSpecContextBlock);
      sections.push(`INSTRUÇÕES OBRIGATÓRIAS AO WORKER:`);
      sections.push(`- Siga rigorosamente os nomes exatos de tabelas, colunas e rotas REST de BACKEND.md;`);
      sections.push(`- Siga todas as seções, abas (role="tab", data-tab), KPIs e componentes de CONTEUDO.md;`);
      sections.push(`- Aplique os tokens :root, tipografia (tabular-nums) e SVGs Lucide inline de DESIGN.md;`);
      sections.push(`- Cumpra as invariantes Karpathy, PORT_GUARD (faixa 4000-4999) e AppSec de PRINCIPIOS.md.\n`);
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
          sections.push(`\n=== FONTE ÚNICA DE VERDADE DO PROJETO (.ai-dev-hub/specs/) ===`);
          sections.push(specBlock);
          sections.push(`INSTRUÇÕES OBRIGATÓRIAS AO WORKER:`);
          sections.push(`- Siga rigorosamente os nomes exatos de tabelas, colunas e rotas REST de BACKEND.md;`);
          sections.push(`- Siga todas as seções, abas (role="tab", data-tab), KPIs e componentes de CONTEUDO.md;`);
          sections.push(`- Aplique os tokens :root, tipografia (tabular-nums) e SVGs Lucide inline de DESIGN.md;`);
          sections.push(`- Cumpra as invariantes Karpathy, PORT_GUARD (faixa 4000-4999) e AppSec de PRINCIPIOS.md.\n`);
        }
      } catch {}
    }
    sections.push(`=== FIM DO CONTEXTO REAL ===`);

    const fullPrompt = this.enforcePromptBudget(sections.join('\n'));
    const hash = crypto.createHash('sha256').update(fullPrompt).digest('hex');

    return {
      prompt: fullPrompt,
      meta: {
        version: this.WORKER_CORE_RULES_VERSION,
        hash,
        mode: input.mode,
        role: 'WORKER'
      }
    };
  }

  // =========================================================================
  // DECOMPOSIÇÃO EM DUAS ONDAS (TWO-PASS / MULTI-PASS HIERARCHICAL PLANNING)
  // =========================================================================

  /**
   * Onda 1: Gera o Blueprint Arquitetural (Grandes Tarefas e Etapas)
   */
  static buildArchitecturalBlueprintPrompt(input: ArchitecturalBlueprintPromptInput): {
    prompt: string;
    meta: PromptVersionMeta;
  } {
    const sections: string[] = [];
    sections.push(this.SUPERVISOR_CORE_RULES);
    sections.push('');
    sections.push(`=== CAMADA B: ONDA 1 — BLUEPRINT ARQUITETURAL (GRANDES TAREFAS & ETAPAS) ===`);
    sections.push(
      `OBJETIVO: Atuar como Arquiteto Principal de Software para mapear os requisitos completos e estruturar as Grandes Tarefas (Major Tasks - GT) e Etapas (Stages - ET) cobrindo todo o ciclo de vida do software.`,
      `DIRETRIZES DE DECOMPOSIÇÃO ARQUITETURAL:`,
      `- INFORMAÇÃO DE ESTADO: O projeto é ${input.isGreenfield !== false ? 'GREENFIELD (iniciado do zero, pasta vazia)' : 'REPOSITÓRIO EXISTENTE (com código legado)'}.`,
      `- COBERTURA DE CAMADAS OBRIGATÓRIA (COM ESPECIFICAÇÃO DE CONTRATOS NO OBJECTIVE):`,
      `  * GT-1: Scaffolding, Config Unificada, Infra Dual-Mode DOCSIMP e Cloud Deploy Pack (Dockerfile, .dockerignore, .env.example, package.json, tsconfig.json).`,
      `  * GT-2: Modelagem Relacional SQLite Completa (Tabelas de Domínio + team_members, api_keys, webhooks, notifications, audit_logs) & Migrations Idempotentes.`,
      `  * GT-3: Smart Demo Seeding Denso (seedIfEmpty com 30 a 50 registros interconectados para todas as entidades e gráficos).`,
      `  * GT-4: Motor de Regras de Negócio Core, Cálculos Analíticos/Financeiros, Máquina de Estados e Validações Estritas.`,
      `  * GT-5: API RESTful Core, Filtros Compostos, Ordenação, Bulk Operations e Exportação RFC-4180 (/api/export/csv).`,
      `  * GT-6: Endpoints de Ecossistema SaaS (/api/analytics, /api/billing, /api/api-keys, /api/webhooks/test, /api/team, /api/docs-spec, /api/audit-logs, /api/health) & Blindagem OWASP.`,
      `  * GT-7: Design System Master (:root), Enterprise App Shell, Sidebar Multi-Secção (role="tab", data-tab), Notification Center & Command Palette (Ctrl+K).`,
      `  * GT-8: Executive BI Dashboard, KPIs Tabulares (Δ%), Gráficos Vetoriais Multi-Série (SVG) & Onboarding Checklist Interativo.`,
      `  * GT-9: Módulos Operacionais de Domínio Core, Data Grids Avançados com Bulk Actions, Visão Kanban/Cards & Slide-Over Detail Drawers.`,
      `  * GT-10: Billing & Planos (Usage Meters, Upgrade Flow, QR Code PIX) + Gestão de Equipe (RBAC) e Configurações do Workspace.`,
      `  * GT-11: Portal de Documentação Técnica Embutido (data-tab="docs") com Referência de API Copiável + Developer Hub (API Keys & Webhooks Playground).`,
      `  * GT-12: Suíte Exaustiva de Testes Unitários, Contratos REST, Jornada E2E (Persistência F5, Zero Botões Mortos) & Homologação AppSec Red Team.`,
      `- No campo "objective" de cada Grande Tarefa e Etapa, explicite os nomes principais de tabelas, módulos e rotas da API para orientar a Onda 2.`,
      `- Responda exclusivamente com um JSON (array de Grandes Tarefas com Etapas):`,
      `  [`,
      `    {`,
      `      "code": "GT-1",`,
      `      "title": "Fundação, Configuração Dual-Mode DOCSIMP e Infraestrutura",`,
      `      "objective": "Configurar package.json, ambiente, adaptadores Dual-Mode com fallback local, Dockerfile e runner de testes",`,
      `      "expectedOutcome": "Estrutura do projeto pronta com adaptadores resilientes e testes executáveis",`,
      `      "requirementIds": ["REQ-1"],`,
      `      "dependencies": [],`,
      `      "stages": [`,
      `        { "code": "ET-1.1", "title": "Scaffolding, Env e Adaptadores DOCSIMP", "objective": "Configurar arquivos base, Dockerfile e adaptadores Dual-Mode" },`,
      `        { "code": "ET-1.2", "title": "Configuração da Suíte de Testes", "objective": "Configurar runner e smoke tests de infraestrutura" }`,
      `      ]`,
      `    }`,
      `  ]`
    );
    sections.push(`=== FIM DA ONDA 1 ===`);
    sections.push('');
    sections.push(`=== CAMADA C: CONTEXTO DO PROJETO ===`);
    sections.push(`PROJETO: ${input.projectName} (ID: ${input.projectId})`);
    sections.push(`CAMINHO: ${input.projectPath}`);
    sections.push(`OBJETIVO: ${input.projectObjective || input.briefing.slice(0, 300)}`);
    sections.push(`BRIEFING COMPLETO DO USUÁRIO:\n${input.briefing}`);
    if (input.requirements && input.requirements.length > 0) {
      sections.push(`REQUISITOS EXTRAÍDOS A COBRIR 100%:\n${input.requirements.map(r => `- ${r}`).join('\n')}`);
    }
    if (input.constitutionSnippet) sections.push(`CONSTITUIÇÃO:\n${input.constitutionSnippet.slice(0, 3500)}`);
    if (input.existingMemorySnippet) sections.push(`MEMÓRIA:\n${input.existingMemorySnippet.slice(0, 3500)}`);
    if (input.docSimpContextBlock) {
      sections.push(`\n${input.docSimpContextBlock}\n`);
    }

    const designBlock = input.designSkillContextBlock || input.designSkillBlock;
    if (designBlock) {
      sections.push(`\n${designBlock}\n`);
    }
    if (input.reaSaaSMasterContextBlock) {
      sections.push(`\n${input.reaSaaSMasterContextBlock}\n`);
    }
    if (input.marketDiscoveryContextBlock) {
      sections.push(`\n=== CAMADA C: ESTUDO DE MERCADO, BENCHMARKING & REA DISCOVERY (ONDA 0) ===`);
      sections.push(input.marketDiscoveryContextBlock);
      sections.push(`Incorpore os diferenciais 10-star, entidades recomendadas e fluxos mapeados na modelagem das Grandes Tarefas.\n`);
    }
    if (input.livingSpecContextBlock) {
      sections.push(`\n=== FONTE ÚNICA DE VERDADE DO PROJETO (.ai-dev-hub/specs/) ===`);
      sections.push(input.livingSpecContextBlock);
      sections.push(`Incorpore rigorosamente as seções de CONTEUDO.md, schemas de BACKEND.md, tokens de DESIGN.md e invariantes de PRINCIPIOS.md nas Grandes Tarefas.\n`);
    } else if (input.projectPath && fs.existsSync(path.join(input.projectPath, '.ai-dev-hub', 'specs'))) {
      try {
        const specBlock = ProjectLivingSpecService.getRoleSpecificSpecContext(input.projectPath, 'SUPERVISOR_BLUEPRINT');
        if (specBlock) {
          sections.push(`\n=== FONTE ÚNICA DE VERDADE DO PROJETO (.ai-dev-hub/specs/) ===`);
          sections.push(specBlock);
          sections.push(`Incorpore rigorosamente as seções de CONTEUDO.md, schemas de BACKEND.md, tokens de DESIGN.md e invariantes de PRINCIPIOS.md nas Grandes Tarefas.\n`);
        }
      } catch {}
    }
    sections.push(`=== FIM DO CONTEXTO ===`);

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
   * Onda 2: Expande uma Grande Tarefa específica em microtarefas atômicas e executáveis
   */
  static buildMajorTaskExpansionPrompt(input: MajorTaskExpansionPromptInput): {
    prompt: string;
    meta: PromptVersionMeta;
  } {
    const sections: string[] = [];
    sections.push(this.SUPERVISOR_CORE_RULES);
    sections.push('');
    sections.push(`=== CAMADA B: ONDA 2 — EXPANSÃO ATÔMICA DA GRANDE TAREFA [${input.majorTask.code}] ===`);
    sections.push(
      `GRANDE TAREFA ALVO: [${input.majorTask.code}] "${input.majorTask.title}"`,
      `OBJETIVO: ${input.majorTask.objective}`,
      `RESULTADO ESPERADO: ${input.majorTask.expectedOutcome || input.majorTask.title}`,
      `ETAPAS PREVISTAS: ${JSON.stringify(input.majorTask.stages || [])}`,
      `REQUISITOS VINCULADOS: ${JSON.stringify(input.majorTask.requirementIds || [])}`,
      `GRANDE TAREFA PREDECESSORA: ${input.previousMajorTaskCode || 'Nenhuma (primeira Grande Tarefa)'}`,
      `ÚLTIMA MICROTAREFA DA GT ANTERIOR: ${input.lastMicrotaskOfPreviousMajor || input.priorMajorTaskLastMicrotaskCode || 'Nenhuma'}`,
      '',
      `DIRETRIZES DE EXPANSÃO DE MICROTAREFAS:`,
      `- Decomponha esta Grande Tarefa em microtarefas cirúrgicas, semânticas e verificáveis pelo IndependentEvaluator.`,
      `- PROIBIÇÃO DE TAREFAS TRIVIAIS ISOLADAS: Agrupe arquivos de configuração (.gitignore, .env.example, Dockerfile, package.json, tsconfig.json) junto à tarefa de setup inicial; jamais crie uma microtarefa separada apenas para arquivos de metadados.`,
      `- DECOMPOSIÇÃO RICA POR TIPO DE CAMADA:`,
      `  * Se esta Grande Tarefa for de BANCO/DOMÍNIO/API: especifique na description os nomes exatos das tabelas, colunas, métodos de serviço, rotas HTTP e garanta testes unitários/integração dedicados em test/.`,
      `  * Se esta Grande Tarefa for de FRONTEND / INTERFACE WEB / SPA / ECOSSISTEMA: NUNCA comprima toda a interface ou produto em poucas tarefas rasas. Decomponha em microtarefas progressivas de alta fidelidade (App Shell com sidebar e abas [role="tab"]/data-tab para 01-Secao.png, Command Palette Ctrl+K, BI com KPIs Δ%, gráficos SVG interativos, Data Grids com Bulk Actions, Visão Kanban, Drawers, Billing/PIX, Portal /docs interativo e Developer Hub com API Keys/Webhooks).`,
      `  * ESCALA DE DECOMPOSIÇÃO: Em projetos SaaS / Full-Stack complexos, expanda cada Grande Tarefa em 4 a 7 microtarefas atômicas (totalizando 40 a 75+ microtarefas no projeto), garantindo profundidade máxima comercial e zero superficialidade.`,
      `- PADRÃO GSD ATOMIC SPECIFICATION & ANTI-CONTEXT-ROT:`,
      `  * Defina na description uma 'action' detalhada (o que fazer, como fazer e o que evitar de forma cristalina).`,
      `  * Mantenha as microtarefas com escopo de arquivos isolado e disjunto (expectedFiles sem colisão desnecessária) para permitir paralelismo de ondas (Wave Parallelism) e execução limpa sem Context Rot.`,
      `- Cada microtarefa deve possuir:`,
      `  * title: Ação específica em arquivo ou módulo (sem sufixos repetidos como "(Parte 1) (Parte 1)").`,
      `  * description: Detalhes exatos dos contratos, classes, funções, rotas HTTP, colunas de banco e validações.`,
      `  * majorTaskCode: "${input.majorTask.code}"`,
      `  * majorTaskTitle: "${input.majorTask.title}"`,
      `  * stageCode: Código da etapa correspondente (ex.: "ET-1.1").`,
      `  * stageTitle: Nome descritivo da etapa.`,
      `  * requirementIds: Array de códigos de requisitos atendidos (ex.: ["REQ-1"]).`,
      `  * expectedFiles: Arquivos alvo específicos a serem criados/modificados (incluindo o arquivo de teste correspondente em test/).`,
      `  * allowedScope: Escopo delimitado para prevenir vazamentos.`,
      `  * criteria: Array com 2 a 4 critérios de aceitação objetivos e verificáveis.`,
      `  * verificationCommand: Comando único simples compatível com controlledVerification.ts ("npm test", "npm run test", "node --test", "node --test <arquivo-relativo>", "tsc --noEmit"). PROIBIDO usar ";", "&&", "||", "|", "node -e" ou "node --check".`,
      `  * doneWhen: Condição binária de conclusão.`,
      `  * dependencies: Microtarefas das quais esta tarefa depende. A primeira microtarefa desta GT deve depender da última microtarefa da GT predecessora (${input.lastMicrotaskOfPreviousMajor || input.priorMajorTaskLastMicrotaskCode || 'nenhuma'}).`,
      `- Responda exclusivamente com um JSON compacto (array de microtarefas):`,
      `  [{"title":"...","description":"...","milestone":"${input.majorTask.code}","majorTaskCode":"${input.majorTask.code}","majorTaskTitle":"${input.majorTask.title}","stageCode":"ET-1.1","stageTitle":"...","requirementIds":["REQ-1"],"expectedFiles":["src/...","test/..."],"orderIndex":1,"dependencies":[],"criteria":["..."],"verificationCommand":"npm test","doneWhen":"..."}]`
    );
    sections.push(`=== FIM DA ONDA 2 ===`);
    sections.push('');
    sections.push(`=== CAMADA C: CONTEXTO REAL DO PROJETO ===`);
    sections.push(`PROJETO: ${input.projectName} (ID: ${input.projectId})`);
    sections.push(`CAMINHO: ${input.projectPath}`);
    sections.push(`OBJETIVO GERAL: ${input.projectObjective || ''}`);
    if (input.briefing) {
      sections.push(`BRIEFING DO USUÁRIO:\n${input.briefing}`);
    }
    if (input.allMajorTasksSummary && input.allMajorTasksSummary.length > 0) {
      sections.push(`MAPA DE GRANDES TAREFAS DO PROJETO:\n${input.allMajorTasksSummary.map(m => `- [${m.code}]${m.title}`).join('\n')}`);
    }
    if (input.projectRequirements && input.projectRequirements.length > 0) {
      sections.push(`CATÁLOGO DE REQUISITOS DO PROJETO:\n${input.projectRequirements.map(r => `- [${r.code}]${r.title}`).join('\n')}`);
    }
    if (input.docSimpContextBlock) {
      sections.push(`\n${input.docSimpContextBlock}\n`);
    }

    const designBlock = input.designSkillContextBlock || input.designSkillBlock;
    if (designBlock) {
      sections.push(`\n${designBlock}\n`);
    }
    if (input.reaSaaSMasterContextBlock) {
      sections.push(`\n${input.reaSaaSMasterContextBlock}\n`);
    }
    if (input.marketDiscoveryContextBlock) {
      sections.push(`\n=== CAMADA C: ESTUDO DE MERCADO & REA DISCOVERY (ONDA 0) ===`);
      sections.push(input.marketDiscoveryContextBlock);
      sections.push(`Ao expandir esta Grande Tarefa em microtarefas, garanta que os contratos de teste, atributos de tela (role="tab", data-tab) e regras de banco reflitam a maturidade dos produtos líderes mapeados.\n`);
    }
    if (input.livingSpecContextBlock) {
      sections.push(`\n=== FONTE ÚNICA DE VERDADE DO PROJETO (.ai-dev-hub/specs/) ===`);
      sections.push(input.livingSpecContextBlock);
      sections.push(`Ao expandir esta Grande Tarefa em microtarefas, garanta que os contratos de teste, atributos de tela (role="tab", data-tab), schemas SQLite e rotas REST reflitam exatamente os 4 arquivos canônicos.\n`);
    } else if (input.projectPath && fs.existsSync(path.join(input.projectPath, '.ai-dev-hub', 'specs'))) {
      try {
        const specBlock = ProjectLivingSpecService.getRoleSpecificSpecContext(input.projectPath, 'SUPERVISOR_EXPAND');
        if (specBlock) {
          sections.push(`\n=== FONTE ÚNICA DE VERDADE DO PROJETO (.ai-dev-hub/specs/) ===`);
          sections.push(specBlock);
          sections.push(`Ao expandir esta Grande Tarefa em microtarefas, garanta que os contratos de teste, atributos de tela (role="tab", data-tab), schemas SQLite e rotas REST reflitam exatamente os 4 arquivos canônicos.\n`);
        }
      } catch {}
    }
    sections.push(`=== FIM DO CONTEXTO ===`);

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