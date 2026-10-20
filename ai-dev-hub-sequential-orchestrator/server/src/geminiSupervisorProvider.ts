import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { BuilderToSupervisorContract, SupervisorReviewContract } from './agentProvider.js';
import { getLanguageServerExe } from './antigravityProvider.js';
import { Logger } from './logger.js';
import { getGlobalAgentGuidelines, validateSurgicalDiff } from './agentGuidelines.js';
import { EvaluationResult } from './independentEvaluator.js';
import { PromptArchitectureService, SupervisorMode } from './promptArchitectureService.js';

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
  async planTasks(
    briefing: string,
    projectContext: { name: string; path: string; objective: string; id?: string },
    options?: {
      mode?: SupervisorMode;
      runId?: string | null;
      completedTasks?: Array<{ id: string; title: string }>;
      pendingTasks?: Array<{ id: string; title: string }>;
      replanReason?: string;
    }
  ): Promise<PlannedTask[]> {
    const mode: SupervisorMode = options?.mode || 'INITIAL_PLAN';
    Logger.info(`[GeminiSupervisor] Planejando arquitetura e tarefas com modelo Gemini (${this.model}) no modo [${mode}]...`);

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

    const effectiveProjectId = this.projectId || projectContext.id;
    const { prompt, meta } = PromptArchitectureService.buildSupervisorPrompt({
      mode,
      projectId: effectiveProjectId || 'default-project',
      projectName: projectContext.name,
      projectPath: projectContext.path,
      projectObjective: projectContext.objective,
      runId: options?.runId || null,
      briefing,
      constitutionSnippet,
      existingMemorySnippet,
      completedTasks: options?.completedTasks,
      pendingTasks: options?.pendingTasks,
      replanReason: options?.replanReason
    });

    try {
      const { AgentSessionManager } = await import('./agentSessionManager.js');
      const { ConversationManager } = await import('./conversationManager.js');
      let conversationId = this.lastConversationId;
      const effectiveProjectId = this.projectId;
      let minStepIndex = -1;

      if (effectiveProjectId) {
        const { session, isNew } = await AgentSessionManager.getOrCreateAgentSession(effectiveProjectId, 'SUPERVISOR', {
          model: this.model,
          env: this.env,
          initialPrompt: prompt,
          accountProfileId: this.accountProfileId
        });
        conversationId = session.provider_conversation_id;

        if (!isNew) {
          const rotationCheck = AgentSessionManager.checkContextRotationPolicy(session, this.appDataBrainDir);
          if (rotationCheck.shouldRotate) {
            Logger.info(`[GeminiSupervisor] Rotação de contexto acionada para Supervisor no projeto ${effectiveProjectId}. Motivo: ${rotationCheck.reason}`);
            const { newSession } = await AgentSessionManager.rotateSession(effectiveProjectId, 'SUPERVISOR', rotationCheck.reason || 'CONTEXT_LIMIT_REACHED', {
              model: this.model,
              env: this.env
            });
            conversationId = newSession.provider_conversation_id;
            await AgentSessionManager.sendMessage(newSession, prompt, {
              env: this.env,
              taskTitle: 'Planejamento de Tarefas (Pós-Rotação)'
            });
          } else {
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

            await AgentSessionManager.sendMessage(session, prompt, {
              env: this.env,
              taskTitle: 'Planejamento de Tarefas'
            });
          }
        }
      } else if (this.accountProfileId) {
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
      const rawTasks = this.extractJsonArray<PlannedTask>(responseText);

      if (rawTasks && Array.isArray(rawTasks) && rawTasks.length > 0) {
        // Strict validation: reject truncated or malformed objects
        const validTasks = rawTasks.filter(t => t && typeof t === 'object' && typeof t.title === 'string' && t.title.trim().length > 0);
        if (validTasks.length === rawTasks.length) {
          Logger.success(`[GeminiSupervisor] Gemini planejou com sucesso ${validTasks.length} tarefas estruturadas! (Modo: ${mode}, Versão: ${meta.version})`);
          return validTasks;
        }
        Logger.warn(`[GeminiSupervisor] Resposta continha ${rawTasks.length - validTasks.length} tarefas malformadas ou incompletas. Rejeitando plano parcial.`);
      }
    } catch (err: any) {
      Logger.error(`[GeminiSupervisor] Erro no planejamento via Gemini: ${err.message}`);
      if (err.message?.startsWith('QUOTA_EXHAUSTED')) throw err;
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

    const effectiveProjectId = this.projectId || projectContext?.id || 'default-project';
    const { prompt, meta } = PromptArchitectureService.buildSupervisorPrompt({
      mode: 'TASK_REVIEW',
      projectId: effectiveProjectId,
      projectName: projectContext?.name || 'Projeto',
      projectPath: projectContext?.path || '',
      projectObjective: projectContext?.objective || '',
      task: {
        id: task.id,
        title: task.title,
        criteria: task.criteria,
        verificationCommand: task.verificationCommand,
        expectedScopeFiles: task.expectedScopeFiles
      },
      builderReport: {
        status: report.status,
        filesChanged: report.filesChanged,
        commandsExecuted: report.commandsExecuted,
        finalResponse: report.rawResponse || (report as any).finalResponse
      },
      diffValidation: {
        isSurgical: diffValidation.isSurgical,
        unrelatedFiles: diffValidation.unrelatedFiles
      },
      evaluation: evaluation ? {
        verdict: evaluation.verdict,
        taskIsDone: evaluation.taskIsDone,
        exitCode: evaluation.exitCode,
        executedCommands: evaluation.executedCommands,
        actual: evaluation.actual,
        tamperedFiles: evaluation.evidence?.tamperedFiles
      } : undefined
    });

    try {
      const { AgentSessionManager } = await import('./agentSessionManager.js');
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

      if (effectiveProjectId) {
        const { session, isNew } = await AgentSessionManager.getOrCreateAgentSession(effectiveProjectId, 'SUPERVISOR', {
          model: this.model,
          env: this.env,
          initialPrompt: prompt,
          accountProfileId: this.accountProfileId
        });
        conversationId = session.provider_conversation_id;

        if (!isNew) {
          const rotationCheck = AgentSessionManager.checkContextRotationPolicy(session, this.appDataBrainDir);
          if (rotationCheck.shouldRotate) {
            Logger.info(`[GeminiSupervisor] Rotação de contexto acionada para Supervisor no projeto ${effectiveProjectId}. Motivo: ${rotationCheck.reason}`);
            const { newSession } = await AgentSessionManager.rotateSession(effectiveProjectId, 'SUPERVISOR', rotationCheck.reason || 'CONTEXT_LIMIT_REACHED', {
              model: this.model,
              env: this.env
            });
            conversationId = newSession.provider_conversation_id;
            await AgentSessionManager.sendMessage(newSession, prompt, {
              env: this.env,
              taskTitle: 'Revisão de Entrega (Pós-Rotação)'
            });
          } else {
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

            await AgentSessionManager.sendMessage(session, prompt, {
              env: this.env,
              taskTitle: 'Revisão de Relatório do Builder'
            });
          }
        }
      } else if (this.accountProfileId) {
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
          Logger.success(`[GeminiSupervisor] Avaliação concluída: ${review.verdict} (Qualidade: ${review.qualityScore || 8}/10, Simplicidade: ${review.simplicityScore || 8}/10, Cirúrgico: ${review.isSurgical}) [Versão: ${meta.version}]`);
          return review;
        }
      }
    } catch (err: any) {
      Logger.warn(`[GeminiSupervisor] Falha na chamada ao Gemini: ${err.message}.`);
      if (err.message?.startsWith('QUOTA_EXHAUSTED')) throw err;
    }

    throw new Error('SUPERVISOR_REVIEW_UNAVAILABLE: agentapi não retornou revisão verificável.');
  }

  /**
   * Helper to wait for the conversation transcript to complete.
   * If transcript.jsonl contains truncated content, this reads the full
   * content from transcript_full.jsonl to eliminate artificial text truncation.
   */
  async waitForResponse(conversationId: string, timeoutMs: number, minStepIndex = -1): Promise<string> {
    const transcriptPath = path.join(this.appDataBrainDir, conversationId, '.system_generated', 'logs', 'transcript.jsonl');
    const transcriptFullPath = path.join(this.appDataBrainDir, conversationId, '.system_generated', 'logs', 'transcript_full.jsonl');
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      if (fs.existsSync(transcriptPath)) {
        try {
          const content = fs.readFileSync(transcriptPath, 'utf-8');
          const lines = content.trim().split('\n').filter(Boolean);
          for (let i = lines.length - 1; i >= 0; i--) {
            const entry = JSON.parse(lines[i]);
            const isAfterMinStep = minStepIndex < 0 || (typeof entry.step_index === 'number' && entry.step_index > minStepIndex);
            if (isAfterMinStep) {
              if (entry.type === 'ERROR_MESSAGE') {
                const errStr = String(entry.error || entry.content || '');
                if (/RESOURCE_EXHAUSTED|code 429|Individual quota reached/i.test(errStr)) {
                  throw new Error(`QUOTA_EXHAUSTED: ${errStr}`);
                }
              }
              if (entry.type === 'PLANNER_RESPONSE' && entry.status === 'DONE' && entry.content && !(entry.tool_calls?.length > 0)) {
                // Antigravity compact transcript truncates large text fields with truncated_fields: ["content"].
                // In this case, recover the full, untruncated content from transcript_full.jsonl!
                if (Array.isArray(entry.truncated_fields) && entry.truncated_fields.includes('content') && fs.existsSync(transcriptFullPath)) {
                  try {
                    const fullLines = fs.readFileSync(transcriptFullPath, 'utf-8').trim().split('\n').filter(Boolean);
                    for (let j = fullLines.length - 1; j >= 0; j--) {
                      const fullEntry = JSON.parse(fullLines[j]);
                      if (fullEntry.step_index === entry.step_index && fullEntry.content) {
                        return fullEntry.content;
                      }
                    }
                  } catch (fullReadErr: any) {
                    Logger.warn(`[GeminiSupervisor] Falha ao ler transcript_full.jsonl: ${fullReadErr.message}`);
                  }
                }
                return entry.content;
              }
            }
          }
        } catch (e: any) {
          if (e.message?.startsWith('QUOTA_EXHAUSTED')) throw e;
        }
      }
      await new Promise(r => setTimeout(r, 1500));
    }
    return '';
  }

  private extractJsonArray<T>(text: string): T[] | null {
    if (!text) return null;
    try {
      const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonStr = match ? match[1].trim() : text.trim();
      const parsed = JSON.parse(jsonStr);
      if (Array.isArray(parsed)) return parsed;
    } catch {}

    // Fallback: search for outermost '[' and ']'
    try {
      const firstBracket = text.indexOf('[');
      const lastBracket = text.lastIndexOf(']');
      if (firstBracket !== -1 && lastBracket > firstBracket) {
        const candidate = text.substring(firstBracket, lastBracket + 1);
        const parsed = JSON.parse(candidate);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}

    return null;
  }

  private extractJsonObject<T>(text: string): T | null {
    if (!text) return null;
    try {
      const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonStr = match ? match[1].trim() : text.trim();
      const parsed = JSON.parse(jsonStr);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return parsed;
    } catch {}

    // Fallback: search for outermost '{' and '}'
    try {
      const firstBrace = text.indexOf('{');
      const lastBrace = text.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        const candidate = text.substring(firstBrace, lastBrace + 1);
        const parsed = JSON.parse(candidate);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return parsed;
      }
    } catch {}

    return null;
  }
}
