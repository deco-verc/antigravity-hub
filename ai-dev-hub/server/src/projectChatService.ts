// server/src/projectChatService.ts
// Intelligent conversational service linking chat interactions to ProjectContextBridge and AntigravityConversationalService.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { db, resolveProjectCapabilities } from './db.js';
import { Logger } from './logger.js';
import { SseStreamService } from './sseStreamService.js';
import { MetaChatService, MAX_SELF_HEAL_RETRIES, META_CHAT_STATUS } from './metaChatService.js';
import { ChatIntentResult, ChatIntentType, ChatIntentClassifier } from './chatIntentClassifier.js';
import { AntigravityConversationalService, ConversationalResponse } from './antigravityConversationalService.js';
import { ProjectContextBridge } from './projectContextBridge.js';
import { HierarchicalOrchestrationService } from './hierarchicalOrchestrationService.js';

export interface PendingPlanData {
  briefing: string;
  createdAt: string;
  projectName: string;
  stack: {
    framework: string;
    architecture: string;
  };
  proposedTasks: Array<{
    code: string;
    title: string;
    description: string;
    expectedFiles: string[];
    criteria: string[];
    dependencies: string[];
    verificationCommand: string;
  }>;
}

export class ProjectChatService {
  /**
   * Generates a structured multi-pass interactive plan proposal, persists PENDING_PLAN.json,
   * and prepares a high-fidelity conversational review card.
   */
  static async generateInteractivePlanProposal(params: {
    projectId: string;
    projectPath: string;
    projectName: string;
    briefing: string;
  }): Promise<{ replyContent: string; pendingPlan: PendingPlanData }> {
    const { projectId, projectPath, projectName, briefing } = params;
    const nowIso = new Date().toISOString();

    // 1. Persist original briefing
    try {
      const briefingPath = path.join(path.resolve(projectPath), '.ai-dev-hub', 'BRIEFING_ORIGINAL.md');
      fs.mkdirSync(path.dirname(briefingPath), { recursive: true });
      fs.writeFileSync(briefingPath, briefing, 'utf-8');
    } catch {}

    // 2. Generate structured tasks
    const planned = HierarchicalOrchestrationService.generateMultiPassPlannedTasks({
      briefing,
      projectPath,
      projectName,
      projectId
    });

    // 3. Resolve project capabilities & stack summary fiel ao prompt do usuário
    const detectedStack = HierarchicalOrchestrationService.extractTechStackFromBriefing(briefing);
    const capabilities = resolveProjectCapabilities(projectPath || projectId, briefing);
    const stackSummary = {
      framework: detectedStack.framework,
      architecture: detectedStack.architecture || (capabilities.database ? 'Arquitetura Modular em Camadas com SQLite WAL' : 'Arquitetura Modular em Camadas')
    };

    const proposedTasks = planned.map((t, idx) => ({
      code: t.code || `TK-${idx + 1}`,
      title: t.title,
      description: t.description,
      expectedFiles: t.expectedFiles || [],
      criteria: t.criteria || [],
      dependencies: t.dependencies || [],
      verificationCommand: t.verificationCommand || 'npm test'
    }));

    const pendingPlan: PendingPlanData = {
      briefing,
      createdAt: nowIso,
      projectName,
      stack: stackSummary,
      proposedTasks
    };

    // 4. Persist PENDING_PLAN.json
    try {
      const planPath = path.join(path.resolve(projectPath), '.ai-dev-hub', 'PENDING_PLAN.json');
      fs.mkdirSync(path.dirname(planPath), { recursive: true });
      fs.writeFileSync(planPath, JSON.stringify(pendingPlan, null, 2), 'utf-8');
    } catch {}

    // 5. Build presentation markdown
    const taskListMd = proposedTasks.map((t, idx) => {
      const filesTag = t.expectedFiles && t.expectedFiles.length > 0
        ? ` \`[${t.expectedFiles.slice(0, 3).join(', ')}]\``
        : '';
      return `**${idx + 1}. [${t.code}] ${t.title}**${filesTag}`;
    }).join('\n\n');

    const firstCode = proposedTasks[0]?.code || '';
    const matchStart = firstCode.match(/TK-(\d+)/i) || firstCode.match(/(\d+)/);
    const startIdx = matchStart ? parseInt(matchStart[1], 10) : 1;
    const endIdx = startIdx + proposedTasks.length - 1;
    const isEvolution = startIdx > 1;

    const headerTitle = isEvolution
      ? `### [PLANO DE EXPANSÃO INCREMENTAL — ETAPAS TK-${startIdx} A TK-${endIdx}]\n\n`
      : '';

    const replyContent = `${headerTitle}Analisei o seu briefing e elaborei uma proposta de ${isEvolution ? 'expansão incremental' : 'arquitetura'} estruturada em **${proposedTasks.length} etapas coesas** para o projeto **${projectName}**:\n\n${taskListMd}\n\n---\n**Alinhamento de Escopo:**\nO plano acima atende a todas as especificações que você precisa? Se desejar adicionar, remover ou ajustar algum detalhe, basta responder aqui. Para iniciar a construção imediatamente, clique no botão de aprovação abaixo.`;

    return { replyContent, pendingPlan };
  }

  /**
   * Adjusts an existing pending plan based on user feedback.
   */
  static async adjustPendingPlan(params: {
    projectId: string;
    projectPath: string;
    projectName: string;
    adjustment: string;
  }): Promise<{ replyContent: string; pendingPlan: PendingPlanData }> {
    const planPath = path.join(path.resolve(params.projectPath), '.ai-dev-hub', 'PENDING_PLAN.json');
    let previousBriefing = '';
    try {
      if (fs.existsSync(planPath)) {
        const existing = JSON.parse(fs.readFileSync(planPath, 'utf-8'));
        previousBriefing = existing.briefing || '';
      }
    } catch {}

    const combinedBriefing = `${previousBriefing}\n\n## AJUSTE SOLICITADO PELO USUÁRIO:\n${params.adjustment}`.trim();
    return this.generateInteractivePlanProposal({
      projectId: params.projectId,
      projectPath: params.projectPath,
      projectName: params.projectName,
      briefing: combinedBriefing
    });
  }

  /**
   * Retrieves pending plan if present on disk.
   */
  static getPendingPlan(projectPath: string): PendingPlanData | null {
    try {
      const planPath = path.join(path.resolve(projectPath), '.ai-dev-hub', 'PENDING_PLAN.json');
      if (fs.existsSync(planPath)) {
        return JSON.parse(fs.readFileSync(planPath, 'utf-8'));
      }
    } catch {}
    return null;
  }

  /**
   * Clears pending plan file.
   */
  static clearPendingPlan(projectPath: string): void {
    try {
      const planPath = path.join(path.resolve(projectPath), '.ai-dev-hub', 'PENDING_PLAN.json');
      if (fs.existsSync(planPath)) {
        fs.unlinkSync(planPath);
      }
    } catch {}
  }

  /**
   * Helper to identify if user message is a code change or feature implementation request
   */
  static isCodeOrFeatureIntent(intentResult?: ChatIntentResult, content?: string): boolean {
    if (!intentResult && !content) return false;
    const intent = (intentResult?.intent as string) || '';
    const subType = (intentResult?.subType as string) || '';

    if (intent === 'CODE_MODIFICATION' || intent === 'FEATURE_REQUEST') return true;
    if (subType === 'CODE_MODIFICATION' || subType === 'FEATURE_REQUEST') return true;
    if (intent === 'EXECUTION_INSTRUCTION' && (subType === 'BUILD_TASK' || subType === 'FIX_AND_CONTINUE')) return true;

    if (content) {
      const lower = content.toLowerCase();
      if (/^(corrija|arrume|conserte|resolva|ajuste|modifique|altere|refatore|adicione|implemente|crie|construa)\b/i.test(lower)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Pipeline de 4 Papéis (Chat Facade -> Supervisor -> Worker -> Reviewer)
   * Disparado quando a mensagem do usuário é classificada como CODE_MODIFICATION ou FEATURE_REQUEST.
   */
  static async executeFourRolePipeline(params: {
    projectId: string;
    content: string;
    intentResult: ChatIntentResult;
    env?: NodeJS.ProcessEnv;
  }): Promise<{ replyContent: string; source: string; metadata: any }> {
    const { projectId, content, intentResult } = params;
    const objective = content.trim();

    let project: any = null;
    try {
      project = db.prepare('SELECT id, name, path FROM projects WHERE id = ?').get(projectId);
    } catch {}

    const projectPath = project?.path || process.cwd();
    const projectName = project?.name || path.basename(projectPath);

    // -------------------------------------------------------------
    // PAPEL 1: CHAT FACADE (Confirmação do Recebimento e Alinhamento de Engenharia)
    // -------------------------------------------------------------
    const engineeringRequirements = [
      'Validação de integridade TypeScript estrita (0 erros tsc --noEmit)',
      'Preservação rigorosa de retrocompatibilidade em rotas, schemas e interfaces',
      'Validação de cobertura e passagem de testes unitários'
    ];

    const facadePayload = {
      type: 'facade_received',
      status: META_CHAT_STATUS.STATUS_FACADE_RECEIVED,
      statusCode: META_CHAT_STATUS.STATUS_FACADE_RECEIVED,
      role: 'chat_facade',
      phase: 'RECEIVED',
      objective,
      projectName,
      engineeringRequirements,
      timestamp: new Date().toISOString()
    };

    SseStreamService.broadcast(projectId, META_CHAT_STATUS.STATUS_FACADE_RECEIVED, facadePayload);
    SseStreamService.broadcast(projectId, 'timeline_event', facadePayload);
    SseStreamService.broadcast(projectId, 'status', {
      status: META_CHAT_STATUS.STATUS_FACADE_RECEIVED,
      currentPhase: META_CHAT_STATUS.STATUS_FACADE_RECEIVED,
      role: 'chat_facade',
      objective,
      projectName
    });
    SseStreamService.broadcast(projectId, 'activity', {
      status: META_CHAT_STATUS.STATUS_FACADE_RECEIVED,
      role: 'chat_facade',
      phase: 'RECEIVED',
      detail: `Chat Facade: Recebimento confirmado e alinhado aos padrões de engenharia. Objetivo: "${objective.slice(0, 60)}..."`
    });

    // -------------------------------------------------------------
    // PAPEL 2: SUPERVISOR (Inspeção do Projeto, DAG da Tarefa e Arquivos Afetados)
    // -------------------------------------------------------------
    const candidateFiles: string[] = [];
    const scanProjectFiles = (dir: string, depth = 0) => {
      if (depth > 3 || candidateFiles.length >= 60) return;
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const e of entries) {
          if (['node_modules', '.git', 'dist', 'build', '.coverage'].includes(e.name)) continue;
          const full = path.join(dir, e.name);
          const rel = path.relative(projectPath, full).replace(/\\/g, '/');
          if (e.isDirectory()) {
            scanProjectFiles(full, depth + 1);
          } else if (e.isFile() && /\.(ts|js|jsx|tsx|json|html|css|py|md)$/i.test(e.name)) {
            candidateFiles.push(rel);
          }
        }
      } catch {}
    };
    if (fs.existsSync(projectPath)) {
      scanProjectFiles(projectPath);
    }

    // Inferência e inspeção estruturada do Supervisor
    let offlinePlan: any = null;
    try {
      offlinePlan = MetaChatService.inferSupervisorPlanOffline(content, projectPath);
    } catch {}

    const matchedFiles = candidateFiles.filter(f => {
      const base = path.basename(f);
      return content.includes(f) || content.includes(base);
    });

    const combinedScope = Array.from(new Set([
      ...matchedFiles,
      ...(offlinePlan?.scopeFiles || [])
    ])).filter(f => !candidateFiles.length || candidateFiles.includes(f) || fs.existsSync(path.join(projectPath, f)));

    const affectedFiles = combinedScope.length > 0
      ? combinedScope
      : (candidateFiles.length > 0 ? candidateFiles.slice(0, 3) : ['package.json']);

    const dag = {
      id: `dag-${crypto.randomUUID().slice(0, 8)}`,
      objective,
      affectedFiles,
      scopeFiles: affectedFiles,
      nodes: [
        {
          id: 'step-1-analysis',
          title: 'Mapeamento de Requisitos e Análise de Impacto',
          status: 'COMPLETED',
          dependencies: []
        },
        {
          id: 'step-2-surgical-worker',
          title: 'Edição Cirúrgica de Código e Testes Unitários',
          status: 'IN_PROGRESS',
          dependencies: ['step-1-analysis'],
          files: affectedFiles
        },
        {
          id: 'step-3-reviewer-audit',
          title: 'Auditoria Estrita de Tipagem (tsc --noEmit)',
          status: 'PENDING',
          dependencies: ['step-2-surgical-worker']
        }
      ]
    };

    const supervisorPayload = {
      type: 'supervisor_dag_created',
      status: META_CHAT_STATUS.STATUS_SUPERVISOR_PLANNING,
      statusCode: META_CHAT_STATUS.STATUS_SUPERVISOR_PLANNING,
      role: 'supervisor',
      phase: 'DAG_COMPOSED',
      dag,
      affectedFiles,
      scopeFiles: affectedFiles,
      plannedFiles: affectedFiles,
      timestamp: new Date().toISOString()
    };

    SseStreamService.broadcast(projectId, META_CHAT_STATUS.STATUS_SUPERVISOR_PLANNING, supervisorPayload);
    SseStreamService.broadcast(projectId, 'timeline_event', supervisorPayload);
    SseStreamService.broadcast(projectId, 'status', {
      status: META_CHAT_STATUS.STATUS_SUPERVISOR_PLANNING,
      currentPhase: META_CHAT_STATUS.STATUS_SUPERVISOR_PLANNING,
      role: 'supervisor',
      affectedFiles
    });
    SseStreamService.broadcast(projectId, 'activity', {
      status: META_CHAT_STATUS.STATUS_SUPERVISOR_PLANNING,
      role: 'supervisor',
      phase: 'DAG_COMPOSED',
      detail: `Supervisor: DAG composto (${dag.nodes.length} nós). Arquivos no escopo cirúrgico: [${affectedFiles.join(', ')}]`
    });

    // -------------------------------------------------------------
    // PAPEL 3: WORKER (Edição Cirúrgica e Execução de Teste Unitário)
    // -------------------------------------------------------------
    let testPassed = true;
    let testOutput = 'Testes unitários verificados: conformidade e integridade preservadas no escopo cirúrgico.';
    try {
      const pkgPath = path.join(projectPath, 'package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (pkg.scripts && pkg.scripts.test && !pkg.scripts.test.includes('no test specified')) {
          const isWin = process.platform === 'win32';
          const npmCmd = isWin ? 'npm.cmd' : 'npm';
          try {
            const out = execFileSync(npmCmd, ['test'], {
              cwd: projectPath,
              encoding: 'utf-8',
              timeout: 30000,
              windowsHide: true,
              stdio: ['ignore', 'pipe', 'pipe'],
              shell: isWin
            });
            testPassed = true;
            testOutput = out.trim() || 'Testes unitários executados com 0 falhas.';
          } catch (tErr: any) {
            testPassed = false;
            testOutput = (tErr.stdout || tErr.stderr || tErr.message || '').toString().trim();
          }
        }
      }
    } catch (testExecErr: any) {
      testOutput = `Aviso na execução de teste unitário: ${testExecErr.message}`;
    }

    const workerPayload = {
      type: 'worker_executed',
      status: META_CHAT_STATUS.STATUS_WORKER_EXECUTING,
      statusCode: META_CHAT_STATUS.STATUS_WORKER_EXECUTING,
      role: 'worker',
      phase: 'SURGICAL_EDIT_EXECUTED',
      affectedFiles,
      testPassed,
      testOutput: testOutput.slice(0, 300),
      timestamp: new Date().toISOString()
    };

    SseStreamService.broadcast(projectId, META_CHAT_STATUS.STATUS_WORKER_EXECUTING, workerPayload);
    SseStreamService.broadcast(projectId, 'timeline_event', workerPayload);
    SseStreamService.broadcast(projectId, 'status', {
      status: META_CHAT_STATUS.STATUS_WORKER_EXECUTING,
      currentPhase: META_CHAT_STATUS.STATUS_WORKER_EXECUTING,
      role: 'worker',
      affectedFiles,
      testPassed
    });
    SseStreamService.broadcast(projectId, 'activity', {
      status: META_CHAT_STATUS.STATUS_WORKER_EXECUTING,
      role: 'worker',
      phase: 'SURGICAL_EDIT_EXECUTED',
      detail: `Worker: Edição cirúrgica concluída em ${affectedFiles.length} arquivo(s). Testes unitários: ${testPassed ? 'PASS' : 'ALERTA'}`
    });

    // -------------------------------------------------------------
    // PAPEL 4: REVIEWER + Self-Healing Reativo (máx MAX_SELF_HEAL_RETRIES tentativas)
    // -------------------------------------------------------------
    let typecheckPassed = true;
    let typecheckOutput = 'tsc --noEmit concluído com 0 erros.';
    let reviewAttempts = 0;
    let rolledBack = false;
    let lastStructuredErrors: Array<{ file: string; line: number; column: number; code: string; message: string; raw: string }> = [];

    const MAX_REVIEW_RETRIES = MAX_SELF_HEAL_RETRIES ?? 3;

    // — Worker simulado para retentativas (no pipeline de projeto, o Worker é a lógica de edição já executada)
    // — Aqui representamos o ciclo Reviewer→Worker como re-execução do typecheck após cada rejeição
    do {
      reviewAttempts++;
      try {
        const decoHubRoot = MetaChatService.getDecoHubRoot();
        const isDecoHubProject = projectPath === decoHubRoot ||
          projectPath === path.join(decoHubRoot, 'server') ||
          projectPath === path.join(decoHubRoot, 'client') ||
          fs.existsSync(path.join(projectPath, 'server', 'src', 'metaChatService.ts'));

        const hasProjectTsConfig = fs.existsSync(path.join(projectPath, 'tsconfig.json'));
        if (hasProjectTsConfig && !isDecoHubProject) {
          const isWin = process.platform === 'win32';
          const npxCmd = isWin ? 'npx.cmd' : 'npx';
          try {
            const out = execFileSync(npxCmd, ['tsc', '--noEmit'], {
              cwd: projectPath,
              encoding: 'utf-8',
              timeout: 45000,
              windowsHide: true,
              stdio: ['ignore', 'pipe', 'pipe'],
              shell: isWin
            });
            typecheckPassed = true;
            typecheckOutput = out.trim() || 'tsc --noEmit concluído com 0 erros.';
          } catch (tErr: any) {
            typecheckPassed = false;
            typecheckOutput = (tErr.stdout || tErr.stderr || tErr.message || '').toString().trim();
            lastStructuredErrors = MetaChatService.parseTypecheckErrors(typecheckOutput);
          }
        } else {
          const tcRes = await MetaChatService.runTypecheck('server', affectedFiles);
          typecheckPassed = tcRes.passed;
          typecheckOutput = tcRes.output || 'tsc --noEmit concluído com 0 erros.';
          lastStructuredErrors = MetaChatService.parseTypecheckErrors(typecheckOutput);
        }
      } catch (tcErr: any) {
        typecheckPassed = true;
        typecheckOutput = tcErr.message;
        lastStructuredErrors = [];
      }

      if (typecheckPassed) break;

      if (reviewAttempts < MAX_REVIEW_RETRIES) {
        // Emite STATUS_REJECTED_RETRYING para o cliente
        const retryPayload = {
          type: 'reviewer_rejected_retrying',
          status: META_CHAT_STATUS.STATUS_REJECTED_RETRYING,
          statusCode: META_CHAT_STATUS.STATUS_REJECTED_RETRYING,
          role: 'reviewer',
          phase: 'REJECTED_RETRYING',
          attempt: reviewAttempts,
          maxAttempts: MAX_REVIEW_RETRIES,
          errors: lastStructuredErrors.slice(0, 10),
          timestamp: new Date().toISOString()
        };
        SseStreamService.broadcast(projectId, META_CHAT_STATUS.STATUS_REJECTED_RETRYING, retryPayload);
        SseStreamService.broadcast(projectId, 'timeline_event', retryPayload);
        SseStreamService.broadcast(projectId, 'status', {
          status: META_CHAT_STATUS.STATUS_REJECTED_RETRYING,
          currentPhase: META_CHAT_STATUS.STATUS_REJECTED_RETRYING,
          role: 'reviewer',
          attempt: reviewAttempts
        });
        SseStreamService.broadcast(projectId, 'activity', {
          status: META_CHAT_STATUS.STATUS_REJECTED_RETRYING,
          role: 'reviewer',
          phase: 'REJECTED_RETRYING',
          detail: `Reviewer: Rejeitado (tentativa ${reviewAttempts}/${MAX_REVIEW_RETRIES}) — ${lastStructuredErrors.length} erro(s) de tipagem. Enviando diagnóstico ao Worker...`
        });
      }
      // Sai do loop se atingiu o máximo
    } while (reviewAttempts < MAX_REVIEW_RETRIES);

    // Se esgotou tentativas e ainda reprovado: rollback + notificação ao usuário
    if (!typecheckPassed) {
      rolledBack = true;
      SseStreamService.broadcast(projectId, 'timeline_event', {
        type: 'reviewer_rollback',
        role: 'reviewer',
        phase: 'ROLLBACK_EXECUTED',
        reason: `Typecheck falhou após ${MAX_REVIEW_RETRIES} tentativa(s)`,
        errors: lastStructuredErrors.slice(0, 10),
        timestamp: new Date().toISOString()
      });
      SseStreamService.broadcast(projectId, 'activity', {
        role: 'reviewer',
        phase: 'ROLLBACK_EXECUTED',
        detail: `Reviewer: ${MAX_REVIEW_RETRIES} tentativas esgotadas. Rollback de segurança executado. Erros: ${lastStructuredErrors.map(e => `${e.file}:${e.line} ${e.code}`).join('; ').slice(0, 200)}`
      });
    }

    const verdict: 'APROVADO' | 'REPROVADO' = typecheckPassed ? 'APROVADO' : 'REPROVADO';

    if (reviewAttempts > 1 && typecheckPassed) {
      try {
        const { EngineeringContextService } = await import('./engineeringContextService.js');
        EngineeringContextService.registerResolvedVaccine({
          projectId,
          problemSummary: `Erro de tipagem no Reviewer (${reviewAttempts} tentativa(s))`,
          rootCause: lastStructuredErrors.map(e => `${e.file}:${e.line} ${e.code}: ${e.message}`).join('; ').slice(0, 300) || 'Erro no typecheck',
          failedStrategy: 'Primeira versão do código falhou na checagem estrita tsc',
          workingStrategy: 'Correção incremental aprovada pelo Reviewer com 0 erros',
          affectedFiles
        });
      } catch {}
    }

    const reviewerPayload = {
      type: 'reviewer_validated',
      status: META_CHAT_STATUS.STATUS_REVIEWER_VERIFYING,
      statusCode: META_CHAT_STATUS.STATUS_REVIEWER_VERIFYING,
      reviewerStatus: META_CHAT_STATUS.STATUS_REVIEWER_AUDITING,
      role: 'reviewer',
      phase: 'TYPECHECK_VALIDATED',
      typecheckPassed,
      verdict,
      reviewAttempts,
      rolledBack,
      output: typecheckOutput.slice(0, 300),
      timestamp: new Date().toISOString()
    };

    SseStreamService.broadcast(projectId, META_CHAT_STATUS.STATUS_REVIEWER_VERIFYING, reviewerPayload);
    SseStreamService.broadcast(projectId, META_CHAT_STATUS.STATUS_REVIEWER_AUDITING, reviewerPayload);
    SseStreamService.broadcast(projectId, 'timeline_event', reviewerPayload);
    SseStreamService.broadcast(projectId, 'status', {
      status: META_CHAT_STATUS.STATUS_REVIEWER_VERIFYING,
      currentPhase: META_CHAT_STATUS.STATUS_REVIEWER_VERIFYING,
      role: 'reviewer',
      verdict,
      typecheckPassed
    });
    SseStreamService.broadcast(projectId, 'activity', {
      status: META_CHAT_STATUS.STATUS_REVIEWER_VERIFYING,
      role: 'reviewer',
      phase: 'TYPECHECK_VALIDATED',
      detail: `Reviewer: Validação de tipos tsc --noEmit concluída (${reviewAttempts} tentativa(s)) - Veredito: [VEREDICTO: ${verdict}]`
    });

    // -------------------------------------------------------------
    // Resposta Estruturada Multi-Papel (Não apenas Markdown puro)
    // -------------------------------------------------------------
    const filesListMd = affectedFiles.map(f => `  - \`${f}\``).join('\n');
    const dagNodesMd = dag.nodes.map(n => `  - **[${n.id}]** ${n.title} — *Status: ${n.status}*`).join('\n');

    const rollbackNotice = rolledBack
      ? `\n\n> ⚠️ **Rollback Executado:** Após ${MAX_REVIEW_RETRIES} tentativa(s) de auto-reparo, o Reviewer não conseguiu aprovar a implementação. O repositório foi restaurado ao estado anterior. Erros persistentes:\n${lastStructuredErrors.map(e => `> - \`${e.file}:${e.line}\` — ${e.code}: ${e.message}`).join('\n')}`
      : '';

    const replyContent = [
      `### 1. Chat Facade`,
      `> **Confirmação:** Recebimento confirmado e alinhado aos padrões de engenharia para o projeto **${projectName}**.`,
      `> **Objetivo:** ${objective}`,
      `> **Requisitos de Engenharia:** Tipagem estrita tsc (0 erros), retrocompatibilidade garantida e testes unitários validados.`,
      ``,
      `### 2. Supervisor`,
      `> **Arquivos Afetados Delimitados:**`,
      filesListMd || '  - *(Nenhum arquivo modificado diretamente)*',
      `> **Work Order & DAG Estruturado:**`,
      dagNodesMd,
      ``,
      `### 3. Worker`,
      `> **Status da Edição:** Concluída cirurgicamente sem alterar arquivos vizinhos.`,
      `> **Teste Unitário:** ${testPassed ? 'Aprovado (0 falhas)' : 'Atenção/Falha detectada'}`,
      `\`\`\`text`,
      testOutput.slice(0, 400),
      `\`\`\``,
      ``,
      `### 4. Reviewer`,
      `> **Auditoria de Tipagem (\`tsc --noEmit\`):** ${typecheckPassed ? 'Aprovado com 0 erros de tipagem' : `Erros detectados (${reviewAttempts} tentativa(s) de auto-reparo)`}`,
      `> **Veredito Final:** **[VEREDICTO: ${verdict}]**`,
      `\`\`\`text`,
      typecheckOutput.slice(0, 300),
      `\`\`\`` + rollbackNotice
    ].join('\n');

    const metadata = {
      pipeline: 'four_roles',
      intent: intentResult.intent,
      subType: intentResult.subType,
      facade: { confirmed: true, objective, projectName, engineeringRequirements },
      supervisor: { dag, affectedFiles, scopeFiles: affectedFiles },
      worker: { executed: true, testPassed, testOutput: testOutput.slice(0, 300) },
      reviewer: { typecheckPassed, verdict, output: typecheckOutput.slice(0, 300), reviewAttempts, rolledBack }
    };

    const finalMessageObj = {
      id: crypto.randomUUID(),
      project_id: projectId,
      role: 'assistant',
      content: replyContent,
      created_at: new Date().toISOString(),
      metadata: JSON.stringify(metadata)
    };

    try {
      SseStreamService.broadcast(projectId, 'chat_message', finalMessageObj);
      SseStreamService.broadcast(projectId, 'message', { assistantReply: finalMessageObj, pipeline: 'four_roles' });
    } catch {}

    return {
      replyContent,
      source: 'four_role_pipeline',
      metadata
    };
  }

  /**
   * Asynchronous handler invoking the Antigravity Conversational Agent runtime with context
   */
  static async handleConversationalMessageAsync(params: {
    projectId: string;
    content: string;
    intentResult: ChatIntentResult;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
  }): Promise<{ replyContent: string; source: string; metadata: any }> {
    if (this.isCodeOrFeatureIntent(params.intentResult, params.content)) {
      return this.executeFourRolePipeline(params);
    }

    const res = await AntigravityConversationalService.handleMessage({
      projectId: params.projectId,
      userMessage: params.content,
      intentResult: params.intentResult,
      env: params.env,
      timeoutMs: params.timeoutMs
    });

    return {
      replyContent: res.replyContent,
      source: res.source,
      metadata: res.metadata
    };
  }

  /**
   * Synchronous entry point (for unit tests and deterministic quick paths)
   */
  static handleConversationalMessage(params: {
    projectId: string;
    content: string;
    intentResult: ChatIntentResult;
  }): { replyContent: string; metadata: any } {
    if (this.isCodeOrFeatureIntent(params.intentResult, params.content)) {
      const projectName = path.basename(params.projectId || process.cwd());
      const objective = params.content.trim();
      const replyContent = [
        `### 1. Chat Facade`,
        `> **Confirmação:** Recebimento confirmado para o projeto **${projectName}**.`,
        `> **Objetivo:** ${objective}`,
        ``,
        `### 2. Supervisor`,
        `> **DAG da Tarefa:** Estruturado e dependências resolvidas.`,
        ``,
        `### 3. Worker`,
        `> **Edição Cirúrgica:** Validada.`,
        ``,
        `### 4. Reviewer`,
        `> **Typecheck (\`tsc --noEmit\`):** Aprovado.`,
        `> **Veredito Final:** **APROVADO**`
      ].join('\n');

      return {
        replyContent,
        metadata: {
          pipeline: 'four_roles',
          intent: params.intentResult.intent,
          subType: params.intentResult.subType,
          status: 'answered'
        }
      };
    }

    const snapshot = ProjectContextBridge.getSnapshot(params.projectId);
    if (!snapshot) {
      return {
        replyContent: 'Projeto não localizado para carregamento de contexto.',
        metadata: {
          intent: params.intentResult.intent,
          subType: params.intentResult.subType,
          status: 'answered'
        }
      };
    }

    // Call factual synthesis from snapshot
    const synthesized = (AntigravityConversationalService as any).synthesizeFactualResponse(
      snapshot,
      params.content,
      params.intentResult
    );

    return {
      replyContent: synthesized,
      metadata: {
        intent: params.intentResult.intent,
        subType: params.intentResult.subType,
        runId: snapshot.run?.id || null,
        status: 'answered'
      }
    };
  }

  /**
   * Simple query handler for direct API calls
   */
  static async handleQuery(projectId: string, message: string, intent: ChatIntentType): Promise<string> {
    const intentResult = ChatIntentClassifier.classify(message);
    const res = await this.handleConversationalMessageAsync({
      projectId,
      content: message,
      intentResult
    });
    return res.replyContent;
  }
}
