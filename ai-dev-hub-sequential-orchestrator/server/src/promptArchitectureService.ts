// server/src/promptArchitectureService.ts
// Arquitetura de Prompts em Três Camadas para DecoHUB:
// Camada A: Regras Permanentes (Core Invariants)
// Camada B: Modo Contextual (Supervisor: INITIAL_PLAN, REPLAN, TASK_REVIEW, RECOVERY, FINAL_REVIEW | Worker: IMPLEMENT, REPAIR, RESEARCH, AUDIT, TEST)
// Camada C: Contexto Real (authoritative, verified, no hallucinations)

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Logger } from './logger.js';

export type SupervisorMode =
  | 'INITIAL_PLAN'
  | 'REPLAN'
  | 'TASK_REVIEW'
  | 'RECOVERY'
  | 'FINAL_REVIEW';

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
}

export class PromptArchitectureService {
  // =========================================================================
  // CAMADA A: REGRAS PERMANENTES (CORE INVARIANTS)
  // =========================================================================

  public static readonly SUPERVISOR_CORE_RULES_VERSION = 'supervisor-core-v2.0';
  public static readonly SUPERVISOR_CORE_RULES: string = [
    `=== CAMADA A: REGRAS PERMANENTES DO SUPERVISOR (DECOHUB) ===`,
    `Você é o SUPERVISOR ESTRATÉGICO DE DESENVOLVIMENTO DO DECOHUB.`,
    `Suas responsabilidades essenciais são:`,
    `1. PLANEJAR: Decompor objetivos em tarefas atômicas sequenciais e incrementais com dependências claras (DAG).`,
    `2. ANALISAR REQUISITOS: Preservar rigorosamente 100% dos requisitos explícitos solicitados pelo usuário (UI, persistência, regras de negócio).`,
    `3. PRESERVAR DECISÕES: Respeitar a constituição do projeto (.ai-dev-hub/program.md) e decisões técnicas consolidadas.`,
    `4. ZERO TAREFAS FANTASMAS: O número de tarefas deve ser proporcional ao escopo real. NUNCA crie tarefas artificiais para atingir cotas e nunca duplique tarefas já concluídas.`,
    `5. REVISAR COM EVIDÊNCIAS: Avaliar relatórios de entrega exigindo provas reais (testes passando, exit code 0, comandos executados).`,
    `6. IDENTIFICAR RISCOS: Alertar sobre riscos de segurança, escopo ou estabilidade.`,
    `7. NÃO IMPLEMENTAR: O Supervisor orquestra e revisa; quem implementa e edita arquivos de código é o Worker.`,
    `=== FIM DAS REGRAS PERMANENTES ===`
  ].join('\n');

  public static readonly WORKER_CORE_RULES_VERSION = 'worker-core-v2.0';
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

    // If task has failed previously or is marked bug fix
    if ((task.retry_count && task.retry_count > 0) || task.is_bug_fix || runState?.lastError) {
      return 'REPAIR';
    }

    const titleLower = task.title.toLowerCase();
    const descLower = (task.description || '').toLowerCase();
    const combined = `${titleLower} ${descLower}`;

    if (combined.includes('audit') || combined.includes('auditar') || combined.includes('inspecionar conformidade') || combined.includes('auditoria')) {
      return 'AUDIT';
    }

    if (combined.includes('pesquisar') || combined.includes('research') || combined.includes('estudo de viabilidade') || combined.includes('avaliar alternativas')) {
      return 'RESEARCH';
    }

    if (combined.includes('teste') || combined.includes('testes') || combined.includes('suite de teste') || combined.includes('test suite') || combined.includes('validar cenários')) {
      return 'TEST';
    }

    if (combined.includes('corrigir') || combined.includes('fix') || combined.includes('bug') || combined.includes('reparar') || combined.includes('defeito')) {
      return 'REPAIR';
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
          `OBJETIVO DESTE MODO: Decompor o briefing do projeto em uma DAG de tarefas estruturadas.`,
          `DIRETRIZES DE PLANEJAMENTO ADAPTATIVO:`,
          `- Planeje a quantidade de tarefas ESTRITAMENTE NECESSÁRIA e proporcional à complexidade:`,
          `  * As faixas são orientativas, não tetos obrigatórios nem cotas fixas:`,
          `    - Tarefa simples/pontual: 1 a 3 tarefas.`,
          `    - Projeto padrão/MVP: 3 a 6 tarefas.`,
          `    - Projeto grande/complexo: 6 a 10 tarefas (estruturadas por milestone M1, M2, M3).`,
          `- NÃO invente tarefas artificiais para bater cotas numéricas.`,
          `- Garanta rastreabilidade de 100% dos requisitos explícitos: interface visual, persistência, lógica de negócio e testes.`,
          `- Para cada tarefa defina: title, description, milestone, orderIndex, dependencies (array de títulos ou IDs anteriores), criteria (array de critérios binários), verificationCommand (comando de validação real) e doneWhen.`,
          `- Responda exclusivamente com um JSON compacto: array de objetos com o formato:`,
          `  [{"title":"...","description":"...","milestone":"M1","orderIndex":1,"dependencies":[],"criteria":["..."],"verificationCommand":"npm test","doneWhen":"..."}]`
        );
        break;

      case 'REPLAN':
        sections.push(
          `OBJETIVO DESTE MODO: Replanejar ou expandir a DAG de tarefas preservando o trabalho já concluído.`,
          `MOTIVO DO REPLANEJAMENTO: ${input.replanReason || 'Ajuste de dependências ou falha recorrente'}.`,
          `DIRETRIZES DE REPLANEJAMENTO:`,
          `- PRESERVE 100% das tarefas concluídas. NÃO as recrie ou reexecute.`,
          `- Ajuste ou adicione apenas as tarefas necessárias para superar o bloqueio ou atender novos requisitos.`,
          `- Retorne exclusivamente o array JSON com as tarefas que devem ser executadas a partir de agora.`
        );
        break;

      case 'TASK_REVIEW':
        sections.push(
          `OBJETIVO DESTE MODO: Avaliar a implementação realizada pelo Worker para a tarefa atual.`,
          `DIRETRIZES DE REVISÃO KARPATHY & AVALIAÇÃO INDEPENDENTE:`,
          `- Inspecione o relatório do Builder e o veredito do Independent Evaluator.`,
          `- Se o Evaluator reportou FAIL ou houve adulteração de testes protegidos: DEVE emitir CHANGES_REQUESTED.`,
          `- Se a implementação atendeu aos critérios, o diff foi cirúrgico e os testes passaram: emita APPROVED.`,
          `- Responda exclusivamente com um objeto JSON:`,
          `  {"verdict":"APPROVED ou CHANGES_REQUESTED","feedback":"justificativa técnica concisa","nextAction":"próximo passo seguro","qualityScore":8,"simplicityScore":8,"isSurgical":true,"unrelatedFilesDetected":[]}`
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
          `DIRETRIZES: Confirme se o objetivo original do projeto foi alcançado integralmente e autorize a conclusão.`
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
      sections.push(`CONSTITUIÇÃO DO PROJETO:\n${input.constitutionSnippet}`);
    }

    if (input.existingMemorySnippet) {
      sections.push(`MEMÓRIA DO PROJETO:\n${input.existingMemorySnippet}`);
    }

    if (input.mode === 'INITIAL_PLAN' || input.mode === 'REPLAN') {
      if (input.briefing) {
        sections.push(`BRIEFING DO USUÁRIO:\n${input.briefing}`);
      }
      if (input.completedTasks && input.completedTasks.length > 0) {
        sections.push(`TAREFAS JÁ CONCLUÍDAS (NÃO REFAZER):\n${input.completedTasks.map(t => `- ${t.title} [CONCLUÍDO]`).join('\n')}`);
      }
    }

    if (input.mode === 'TASK_REVIEW') {
      if (input.task) {
        sections.push(`TAREFA AVALIADA: ${input.task.title} (ID: ${input.task.id})`);
        if (input.task.criteria?.length) sections.push(`CRITÉRIOS: ${input.task.criteria.join('; ')}`);
        if (input.task.verificationCommand) sections.push(`COMANDO DE VERIFICAÇÃO: ${input.task.verificationCommand}`);
        if (input.task.expectedScopeFiles?.length) sections.push(`ARQUIVOS ESPERADOS NO ESCOPO: ${input.task.expectedScopeFiles.join(', ')}`);
      }
      if (input.builderReport) {
        sections.push(`RELATÓRIO DO BUILDER: Status: ${input.builderReport.status} | Arquivos alterados: ${(input.builderReport.filesChanged || []).join(', ') || 'Nenhum'}`);
        if (input.builderReport.commandsExecuted?.length) sections.push(`COMANDOS EXECUTADOS: ${input.builderReport.commandsExecuted.join(' && ')}`);
      }
      if (input.diffValidation) {
        sections.push(`DIFF CIRÚRGICO: ${input.diffValidation.isSurgical ? 'SIM' : 'NÃO (Arquivos fora do escopo detectados)'}`);
        if (input.diffValidation.unrelatedFiles?.length) sections.push(`ARQUIVOS NÃO RELACIONADOS: ${input.diffValidation.unrelatedFiles.join(', ')}`);
      }
      if (input.evaluation) {
        sections.push(`INDEPENDENT EVALUATOR: Veredito: ${input.evaluation.verdict} | Exit Code: ${input.evaluation.exitCode ?? 'N/A'}`);
        if (input.evaluation.actual) sections.push(`RESULTADO OBSERVADO: ${input.evaluation.actual}`);
        if (input.evaluation.tamperedFiles?.length) sections.push(`🚨 ADULTERAÇÃO DE TESTES DETECTADA: ${input.evaluation.tamperedFiles.join(', ')}`);
      }
    }

    if (input.mode === 'RECOVERY' && input.recoveryState) {
      sections.push(`ESTADO DE RECUPERAÇÃO: Concluídas: ${input.recoveryState.completedTasksCount || 0} | Interrompidas: ${(input.recoveryState.interruptedTasks || []).join(', ') || 'Nenhuma'}`);
      if (input.recoveryState.gitHead) sections.push(`ÚLTIMO COMMIT: ${input.recoveryState.gitHead}`);
    }

    if (input.mode === 'FINAL_REVIEW' && input.allCompletedTasks) {
      sections.push(`TAREFAS CONCLUÍDAS NO CICLO:\n${input.allCompletedTasks.map(t => `- ${t.title}`).join('\n')}`);
    }

    sections.push(`=== FIM DO CONTEXTO REAL ===`);

    const fullPrompt = sections.join('\n');
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
          `OBJETIVO DESTE MODO: Implementar o código funcional cirúrgico para atender aos critérios da tarefa.`,
          `DIRETRIZES DE IMPLEMENTAÇÃO:`,
          `- Localize código existente no projeto e reutilize funções quando viável.`,
          `- Altere apenas o necessário (escopo cirúrgico). Não reformate arquivos alheios.`,
          `- Instale dependências locais do projeto se estritamente necessário.`,
          `- Execute os testes no terminal (${input.verificationCommand || 'npm test'}) e comprove funcionamento.`,
          `- Conclua reportando arquivos alterados e saída dos testes.`
        );
        break;

      case 'REPAIR':
        sections.push(
          `OBJETIVO DESTE MODO: Corrigir defeito ou falha identificada na avaliação anterior.`,
          `DIRETRIZES DE REPARO:`,
          `- Analise o erro exato reportado na Camada C abaixo.`,
          `- Reproduza o defeito executando o comando de verificação.`,
          `- Corrija a causa raiz no código de produção.`,
          `- NUNCA altere os testes protegidos para mascarar o defeito!`,
          `- Reexecute os testes e comprove que o defeito foi solucionado.`
        );
        break;

      case 'RESEARCH':
        sections.push(
          `OBJETIVO DESTE MODO: Realizar pesquisa técnica, validar alternativas ou inspecionar documentação.`,
          `DIRETRIZES DE PESQUISA:`,
          `- Consulte documentação oficial e fontes verificáveis compatíveis com a stack.`,
          `- Registre as descobertas e recomendações em .ai-dev-hub/notes/ ou no transcript.`,
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
          `- Crie casos de teste rigorosos incluindo happy paths, entradas inválidas, limites e falhas simuladas.`,
          `- É EXPRESSAMENTE PROIBIDO enfraquecer testes existentes, remover asserções ou utilizar .skip/xit.`,
          `- Execute a suíte de testes e garanta que todos os testes passem.`
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
    sections.push(`TAREFA ATUAL: ${input.taskTitle} (ID: ${input.taskId})`);

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

    if (input.riskLevel) {
      sections.push(`NÍVEL DE RISCO DA TAREFA: ${input.riskLevel}`);
    }

    if (input.protectedEvaluationWarning) {
      sections.push(`AVISO DE TESTES PROTEGIDOS:\n${input.protectedEvaluationWarning}`);
    }

    if (input.mode === 'REPAIR') {
      if (input.previousError) {
        sections.push(`ERRO ANTERIOR A CORRIGIR:\n${input.previousError}`);
      }
      if (input.previousEvaluatorOutput) {
        sections.push(`SAÍDA DO AVALIADOR ANTERIOR:\n${input.previousEvaluatorOutput}`);
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

    if (input.formattedEngineeringBlock) {
      sections.push(`\n${input.formattedEngineeringBlock}\n`);
    }

    if (input.supervisorInstructions) {
      sections.push(`INSTRUÇÕES ESPECÍFICAS DO SUPERVISOR:\n${input.supervisorInstructions}`);
    }

    sections.push(`=== FIM DO CONTEXTO REAL ===`);

    const fullPrompt = sections.join('\n');
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
}
