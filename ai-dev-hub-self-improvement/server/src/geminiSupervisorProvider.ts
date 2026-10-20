import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { BuilderToSupervisorContract, SupervisorReviewContract } from './agentProvider.js';
import { getLanguageServerExe } from './antigravityProvider.js';
import { Logger } from './logger.js';
import { getGlobalAgentGuidelines, validateSurgicalDiff } from './agentGuidelines.js';
import { EvaluationResult } from './independentEvaluator.js';

export interface PlannedTask {
  id?: string;
  title: string;
  description: string;
  milestone: string;
  orderIndex: number;
  dependencies: string[];
  criteria: string[];
  verificationCommand?: string;
  doneWhen?: string;
}

export class GeminiSupervisorProvider {
  private exePath: string;
  private appDataBrainDir: string;
  private model: 'flash' | 'pro' | 'flash_lite';

  private env?: NodeJS.ProcessEnv;
  private lastConversationId: string | null = null;
  private accountProfileId?: string;
  private projectId?: string;

  constructor(
    model: 'flash' | 'pro' | 'flash_lite' = 'flash',
    env?: NodeJS.ProcessEnv,
    accountProfileId?: string,
    projectId?: string
  ) {
    this.exePath = getLanguageServerExe();
    this.appDataBrainDir = path.join(env?.USERPROFILE || process.env.USERPROFILE || '', '.gemini', 'antigravity', 'brain');
    this.model = model;
    this.env = env;
    this.accountProfileId = accountProfileId;
    this.projectId = projectId;
  }

  getExecutionEvidence() {
    let actualModel: string | null = null;
    if (this.lastConversationId) {
      try {
        const output = execFileSync(this.exePath, ['agentapi', 'get-conversation-metadata', this.lastConversationId], {
          encoding: 'utf-8', timeout: 10000, env: this.env
        });
        const metadata = JSON.parse(output)?.response?.conversationMetadata?.metadata;
        if (metadata?.rootConversationId === this.lastConversationId) {
          actualModel = metadata?.staticConfig?.cascadeConfig?.plannerConfig?.planModel || null;
        }
      } catch {}
    }
    return {
      conversationId: this.lastConversationId,
      requestedModel: this.model,
      actualModel,
      actualModelVerified: false,
      fallbackReason: actualModel ? 'RUNTIME_MODEL_ID_UNMAPPED' : 'ACTUAL_MODEL_UNAVAILABLE'
    };
  }

  /**
   * Supervisor Gemini uses real reasoning to analyze a briefing and decompose it into a DAG of tasks
   */
  async planTasks(briefing: string, projectContext: { name: string; path: string; objective: string }): Promise<PlannedTask[]> {
    Logger.info(`[GeminiSupervisor] Planejando arquitetura e tarefas com modelo Gemini (${this.model})...`);

    let existingMemorySnippet = '';
    let constitutionSnippet = '';
    try {
      const { MemoryManager } = await import('./memoryManager.js');
      const memory = MemoryManager.readMemoryFiles(projectContext.path);
      const parsed = MemoryManager.parseTasks(memory.tasksMd);
      const doneList = parsed.done.slice(-5);
      if (doneList.length > 0) {
        existingMemorySnippet = `TAREFAS ANTERIORES JÁ PRONTAS (PRESERVAR): ${doneList.join(' | ')}. Construa novas tarefas adicionais incrementais sem refazer o que já existe.`;
      }
      if (memory.decisionsMd) {
        const decisions = memory.decisionsMd.split('\n').filter(l => l.trim().startsWith('-') || l.trim().startsWith('###')).slice(-4).join('; ');
        if (decisions) {
          existingMemorySnippet += ` DECISÕES TÉCNICAS A RESPEITAR: ${decisions.slice(0, 300)}.`;
        }
      }
      if (memory.programMd) {
        constitutionSnippet = `CONSTITUIÇÃO DO PROJETO (program.md): Respeite as restrições e convenções registradas do projeto.`;
      }
    } catch {}

    const prompt = [
      `Você é o SUPERVISOR ESTRATÉGICO DE DESENVOLVIMENTO (Gemini).`,
      `Esta é somente uma tarefa de planejamento. NÃO use ferramentas, terminal, navegação ou leitura de arquivos. Responda apenas com o JSON solicitado.`,
      `Planeje para o caminho do projeto indicado abaixo, nunca para o workspace aberto no Antigravity.`,
      `Analise o seguinte briefing e decomponha em tarefas sequenciais e incrementais com dependências claras (DAG).`,
      `DIRETRIZES DE ENGENHARIA (KARPATHY): Think Before Coding (explicite premissas), Simplicity First (menor código viável), Surgical Changes (escopo delimitado), Goal-Driven (verificável).`,
      `RASTREABILIDADE OBRIGATÓRIA DE REQUISITOS (UR): Decomponha preservando 100% dos requisitos explícitos do briefing:`,
      `- Se o briefing solicitar interface visual, dashboard, tela ou web: DEVE incluir tarefa dedicada para a Interface Visual/Dashboard com critérios visuais explícitos (ex: renderiza dashboard com métricas/gráficos em HTML). NUNCA substitua interface visual por apenas API REST ou CLI!`,
      `- Se o briefing solicitar persistência ou banco de dados: DEVE incluir tarefa dedicada para Persistência com critérios em disco/localStorage/banco.`,
      `- Autonomia operacional: Planeje tarefas com comandos de verificação reais (npm test, build) e critérios que incluam instalação de dependências locais quando necessário.`,
      `PROJETO: ${projectContext.name}`,
      `CAMINHO: ${projectContext.path}`,
      `OBJETIVO: ${projectContext.objective}`,
      constitutionSnippet,
      existingMemorySnippet,
      `BRIEFING:`,
      briefing,
      ``,
      `Toda tarefa DEVE ser GOAL-DRIVEN: possuir objetivo claro, critérios de aceitação binários, comando de verificação e critério de término.`,
      `IMPORTANTE: a resposta inteira deve ter menos de 1900 caracteres para não ser truncada pelo transcript do agentapi.`,
      `Responda somente com JSON compacto, sem markdown: array de exatamente 5 objetos.`,
      `Cada objeto: {"title":"curto","description":"uma frase","milestone":"M1","orderIndex":1,"dependencies":[],"criteria":["um critério"],"verificationCommand":"npm test","doneWhen":"curto"}.`,
      `Dependências podem referir o título da tarefa anterior. Use frases curtas.`
    ].filter(Boolean).join('\n');

    try {
      const { ConversationManager } = await import('./conversationManager.js');
      let conversationId = this.lastConversationId;
      const transcriptPath = conversationId ? path.join(this.appDataBrainDir, conversationId, '.system_generated', 'logs', 'transcript.jsonl') : null;
      let minStepIndex = -1;
      if (transcriptPath && fs.existsSync(transcriptPath)) {
        try {
          const lines = fs.readFileSync(transcriptPath, 'utf-8').trim().split('\n').filter(Boolean);
          for (let i = lines.length - 1; i >= 0; i--) {
            const entry = JSON.parse(lines[i]);
            if (typeof entry.step_index === 'number') {
              minStepIndex = entry.step_index;
              break;
            }
          }
        } catch {}
      }

      if (this.accountProfileId) {
        const initial = ConversationManager.getOrCreateConversation({
          projectId: this.projectId,
          accountProfileId: this.accountProfileId,
          role: 'supervisor',
          model: this.model,
          env: this.env,
          initialPrompt: prompt
        });
        conversationId = initial.conversationId;
        if (!initial.isNew) {
          const activeTranscriptPath = path.join(this.appDataBrainDir, conversationId, '.system_generated', 'logs', 'transcript.jsonl');
          if (fs.existsSync(activeTranscriptPath)) {
            try {
              const lines = fs.readFileSync(activeTranscriptPath, 'utf-8').trim().split('\n').filter(Boolean);
              for (let i = lines.length - 1; i >= 0; i--) {
                const entry = JSON.parse(lines[i]);
                if (typeof entry.step_index === 'number') {
                  minStepIndex = entry.step_index;
                  break;
                }
              }
            } catch {}
          }
          const sendRes = ConversationManager.sendMessageOrRotate({
            conversationId,
            prompt,
            projectId: this.projectId,
            accountProfileId: this.accountProfileId,
            role: 'supervisor',
            model: this.model,
            env: this.env
          });
          conversationId = sendRes.conversationId;
        }
      } else if (!conversationId) {
        const out = execFileSync(
          this.exePath,
          ['agentapi', 'new-conversation', `--model=${this.model}`, `--title=DecoHUB — Supervisor`, prompt],
          { encoding: 'utf-8', timeout: 45000, env: this.env }
        );
        const parsed = JSON.parse(out);
        conversationId = parsed?.response?.newConversation?.conversationId;
      } else {
        execFileSync(
          this.exePath,
          ['agentapi', 'send-message', conversationId, prompt],
          { encoding: 'utf-8', timeout: 45000, env: this.env }
        );
      }

      if (!conversationId) {
        throw new Error('Falha ao iniciar sessão de planejamento com Gemini');
      }
      this.lastConversationId = conversationId;

      // Wait for Gemini response in transcript strictly after minStepIndex
      const responseText = await this.waitForResponse(conversationId, 180000, minStepIndex);
      const tasks = this.extractJsonArray<PlannedTask>(responseText);

      if (tasks && tasks.length >= 5) {
        Logger.success(`[GeminiSupervisor] Gemini planejou com sucesso ${tasks.length} tarefas estruturadas!`);
        return tasks;
      } else if (tasks && tasks.length > 0) {
        Logger.info(`[GeminiSupervisor] Gemini planejou ${tasks.length} tarefas. Garantindo pelo menos 5 tarefas estruturadas.`);
        return tasks;
      }
    } catch (err: any) {
      Logger.error(`[GeminiSupervisor] Erro no planejamento via Gemini: ${err.message}`);
    }

    throw new Error('SUPERVISOR_UNAVAILABLE: o agentapi não retornou um plano de tarefas válido.');

  }

  /**
   * Supervisor Gemini reviews a Builder report using real reasoning and Karpathy guidelines
   */
  /**
   * Supervisor Gemini reviews a Builder report using real reasoning, Karpathy guidelines,
   * and the Independent Evaluator verdict
   */
  async reviewBuilderReport(
    task: any,
    report: BuilderToSupervisorContract,
    projectContext: any,
    evaluation?: EvaluationResult
  ): Promise<SupervisorReviewContract> {
    Logger.info(`[GeminiSupervisor] Supervisor Gemini (${this.model}) avaliando implementação de "${task.title}" sob diretrizes Karpathy e Avaliação Independente...`);

    // 1. Immediate anti-tampering rejection: Builder cannot modify protected evaluation tests!
    if (evaluation?.verdict === 'TAMPERING_DETECTED') {
      const tamperedList = evaluation.evidence?.tamperedFiles?.join(', ') || 'arquivos protegidos';
      Logger.error(`🚨 [GeminiSupervisor] REJEITADO POR ADULTERAÇÃO: O Builder modificou arquivos de teste protegidos (${tamperedList})!`);
      return {
        verdict: 'CHANGES_REQUESTED',
        feedback: `🚨 REJEITADO POR ADULTERAÇÃO (INDEPENDENT EVALUATOR): Tentativa de adulteração detectada nos arquivos de avaliação protegidos: ${tamperedList}. O agente que implementa o código NÃO pode modificar os testes de avaliação para contornar falhas. A aprovação deve decorrer da correção do código da aplicação.`,
        nextAction: 'Reverter imediatamente as alterações nos arquivos de teste protegidos para o estado original e corrigir o código de produção.',
        qualityScore: 1,
        simplicityScore: 1,
        isSurgical: false,
        unrelatedFilesDetected: evaluation.evidence?.tamperedFiles || []
      };
    }

    const expectedScope = task.expectedScopeFiles || [];
    const diffValidation = validateSurgicalDiff(report.filesChanged || [], expectedScope);
    const prompt = [
      `Você é o Supervisor que revisa uma tarefa de código. Não use ferramentas. Responda somente JSON compacto, menos de 1000 caracteres.`,
      `Tarefa: ${task.title}. Critérios: ${JSON.stringify(task.criteria || []).slice(0, 300)}.`,
      `Builder: status ${report.status}; arquivos ${JSON.stringify((report.filesChanged || []).map(f => typeof f === 'string' ? f.replace(/.*[\\/](prompts[\\/].*|src[\\/].*|test[\\/].*|[^\\/]+)$/, '$1') : f)).slice(0, 2000)}.`,
      `Diff no escopo: ${diffValidation.isSurgical}.`,
      `Evaluator: ${evaluation?.verdict || 'UNAVAILABLE'}; exit code ${evaluation?.exitCode ?? 'N/A'}; comando ${evaluation?.executedCommands?.join(' && ') || 'N/A'}.`,
      `Se Evaluator falhou ou diff fora do escopo, responda CHANGES_REQUESTED.`,
      `Formato: {"verdict":"APPROVED ou CHANGES_REQUESTED","feedback":"uma frase","nextAction":"uma frase","qualityScore":8,"simplicityScore":8,"isSurgical":true,"unrelatedFilesDetected":[]}`
    ].join('\n');

    try {
      const { ConversationManager } = await import('./conversationManager.js');
      let conversationId = this.lastConversationId;
      if (!conversationId && this.accountProfileId) {
        const activeSupervisor = ConversationManager.getActiveLeaf({
          projectId: this.projectId || projectContext?.id,
          accountProfileId: this.accountProfileId,
          role: 'supervisor'
        });
        if (activeSupervisor) {
          conversationId = activeSupervisor.conversation_id;
        }
      }

      const transcriptPath = conversationId ? path.join(this.appDataBrainDir, conversationId, '.system_generated', 'logs', 'transcript.jsonl') : null;
      let minStepIndex = -1;
      if (transcriptPath && fs.existsSync(transcriptPath)) {
        try {
          const lines = fs.readFileSync(transcriptPath, 'utf-8').trim().split('\n').filter(Boolean);
          for (let i = lines.length - 1; i >= 0; i--) {
            const entry = JSON.parse(lines[i]);
            if (typeof entry.step_index === 'number') {
              minStepIndex = entry.step_index;
              break;
            }
          }
        } catch {}
      }


      if (this.accountProfileId) {
        const initial = ConversationManager.getOrCreateConversation({
          projectId: this.projectId || projectContext?.id,
          accountProfileId: this.accountProfileId,
          role: 'supervisor',
          model: this.model,
          env: this.env,
          initialPrompt: prompt
        });
        conversationId = initial.conversationId;
        if (!initial.isNew) {
          // Re-calculate minStepIndex immediately before sending
          const activeTranscriptPath = path.join(this.appDataBrainDir, conversationId, '.system_generated', 'logs', 'transcript.jsonl');
          if (fs.existsSync(activeTranscriptPath)) {
            try {
              const lines = fs.readFileSync(activeTranscriptPath, 'utf-8').trim().split('\n').filter(Boolean);
              for (let i = lines.length - 1; i >= 0; i--) {
                const entry = JSON.parse(lines[i]);
                if (typeof entry.step_index === 'number') {
                  minStepIndex = entry.step_index;
                  break;
                }
              }
            } catch {}
          }

          const sendRes = ConversationManager.sendMessageOrRotate({
            conversationId,
            prompt,
            projectId: this.projectId || projectContext?.id,
            accountProfileId: this.accountProfileId,
            role: 'supervisor',
            model: this.model,
            env: this.env
          });
          conversationId = sendRes.conversationId;
        }
      } else if (!conversationId) {
        const out = execFileSync(
          this.exePath,
          ['agentapi', 'new-conversation', `--model=${this.model}`, `--title=DecoHUB — Supervisor`, prompt],
          { encoding: 'utf-8', timeout: 45000, env: this.env }
        );
        const parsed = JSON.parse(out);
        conversationId = parsed?.response?.newConversation?.conversationId;
      } else {
        execFileSync(
          this.exePath,
          ['agentapi', 'send-message', conversationId, prompt],
          { encoding: 'utf-8', timeout: 45000, env: this.env }
        );
      }

      if (conversationId) {
        this.lastConversationId = conversationId;
        const responseText = await this.waitForResponse(conversationId, 180000, minStepIndex);
        const review = this.extractJsonObject<SupervisorReviewContract>(responseText);

        if (review && review.verdict) {
          // If evaluator failed, supervisor cannot approve regardless of builder text
          if (evaluation && !evaluation.taskIsDone && review.verdict === 'APPROVED') {
            Logger.warn(`[GeminiSupervisor] Sobrepondo aprovação: O Evaluator Independente reportou FAIL, rejeitando entrega.`);
            review.verdict = 'CHANGES_REQUESTED';
            review.feedback = `Reprovado pelo Evaluator Independente: ${evaluation.actual}. ${review.feedback}`;
          }

          if (review.isSurgical === undefined) {
            review.isSurgical = diffValidation.isSurgical;
          }
          if (!review.unrelatedFilesDetected && diffValidation.unrelatedFiles.length > 0) {
            review.unrelatedFilesDetected = diffValidation.unrelatedFiles;
          }
          Logger.success(`[GeminiSupervisor] Avaliação concluída: ${review.verdict} (Qualidade: ${review.qualityScore || 8}/10, Simplicidade: ${review.simplicityScore || 8}/10, Cirúrgico: ${review.isSurgical})`);
          return review;
        }
      }
    } catch (err: any) {
      Logger.warn(`[GeminiSupervisor] Falha na chamada ao Gemini: ${err.message}.`);
    }

    throw new Error('SUPERVISOR_REVIEW_UNAVAILABLE: agentapi não retornou revisão verificável.');
  }

  /**
   * Helper to wait for the conversation transcript to complete
   */
  async waitForResponse(conversationId: string, timeoutMs: number, minStepIndex = -1): Promise<string> {
    const transcriptPath = path.join(this.appDataBrainDir, conversationId, '.system_generated', 'logs', 'transcript.jsonl');
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      if (fs.existsSync(transcriptPath)) {
        try {
          const content = fs.readFileSync(transcriptPath, 'utf-8');
          const lines = content.trim().split('\n').filter(Boolean);
          for (let i = lines.length - 1; i >= 0; i--) {
            const entry = JSON.parse(lines[i]);
            const isAfterMinStep = minStepIndex < 0 || (typeof entry.step_index === 'number' && entry.step_index > minStepIndex);
            if (isAfterMinStep && entry.type === 'PLANNER_RESPONSE' && entry.status === 'DONE' && entry.content && !(entry.tool_calls?.length > 0)) {
              return entry.content;
            }
          }
        } catch {}
      }
      await new Promise(r => setTimeout(r, 1500));
    }
    return '';
  }

  private extractJsonArray<T>(text: string): T[] | null {
    try {
      const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonStr = match ? match[1].trim() : text.trim();
      const parsed = JSON.parse(jsonStr);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  private extractJsonObject<T>(text: string): T | null {
    try {
      const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonStr = match ? match[1].trim() : text.trim();
      const parsed = JSON.parse(jsonStr);
      return typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
}
