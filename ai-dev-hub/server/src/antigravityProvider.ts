import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  AgentProvider,
  AgentSessionStatus,
  BuilderToSupervisorContract,
  SupervisorToBuilderContract
} from './agentProvider.js';
import { Logger } from './logger.js';
import { AntigravityDiscovery } from './antigravityDiscovery.js';
import { PromptArchitectureService } from './promptArchitectureService.js';
import { AgentApiGateway } from './agentApiGateway.js';
import { ModelRegistry } from './modelRegistry.js';
import { AgentTurnState, captureFileInventory, changedFiles, observeTranscript } from './agentTurnState.js';
import { TurnCancellationManager, activeTurnCancellations } from './turnCancellationManager.js';

export function getLanguageServerExe(): string {
  if (AgentApiGateway.isOfflineMode()) {
    throw new Error('[FAIL_CLOSED_GUARD] Acesso ao executável do Language Server bloqueado em modo offline/teste.');
  }
  const discovery = AntigravityDiscovery.discover();
  if (discovery.available && discovery.languageServerExe) {
    return discovery.languageServerExe;
  }
  throw new Error(`Antigravity language_server.exe não encontrado no sistema: ${discovery.errorMessage}`);
}

export class AntigravityProvider implements AgentProvider {
  private exePath: string;
  private appDataBrainDir: string;
  private defaultEnv?: NodeJS.ProcessEnv;
  private turnStarts = new Map<string, number>();

  public captureTurnStart(sessionId: string, projectPath?: string, taskId?: string): void {
    const transcript = path.join(this.appDataBrainDir, sessionId, '.system_generated', 'logs', 'transcript.jsonl');
    const baseline = projectPath
      ? AgentTurnState.begin(sessionId, projectPath, this.appDataBrainDir, taskId)
      : fs.existsSync(transcript)
        ? fs.readFileSync(transcript, 'utf8').split('\n').filter(Boolean).length
        : 0;

    if (this.turnStarts.size > 250) {
      const oldestKey = this.turnStarts.keys().next().value;
      if (oldestKey) this.turnStarts.delete(oldestKey);
    }
    this.turnStarts.set(sessionId, baseline);
  }

  /**
   * Scrubs Electron runtime flags so child CLI processes do not inherit conflicting node/asar states
   */
  private sanitizeExecutionEnv(env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const rawEnv = env || this.defaultEnv || process.env;
    const cleanEnv: NodeJS.ProcessEnv = { ...rawEnv };
    delete cleanEnv.ELECTRON_RUN_AS_NODE;
    delete cleanEnv.ELECTRON_NO_ASAR;
    delete cleanEnv.ELECTRON_OZONE_PLATFORM_HINT;
    delete cleanEnv.ELECTRON_ENABLE_LOGGING;
    return cleanEnv;
  }

  /**
   * Determines whether an error occurred before dispatching the message to the external runtime
   */
  private isPreDispatchGuardError(err: any): boolean {
    return (
      err?.code === 'FAIL_CLOSED_GUARD' ||
      /GUARD|AUTHORIZATION_MISSING|QUOTA_EXHAUSTED|RESOURCE_EXHAUSTED|AUTH_ERROR|UNAUTHENTICATED|RUNTIME_UNAVAILABLE/i.test(
        String(err?.message || '')
      )
    );
  }

  constructor(customEnv?: NodeJS.ProcessEnv) {
    const discovery = AntigravityDiscovery.discover({
      userProfileDir: customEnv?.USERPROFILE
    });
    if (!discovery.available || !discovery.languageServerExe) {
      Logger.warn(`[AntigravityProvider] Aviso: ${discovery.errorMessage}`);
    }
    this.exePath = discovery.languageServerExe || '';
    this.appDataBrainDir = customEnv?.USERPROFILE
      ? path.join(customEnv.USERPROFILE, '.gemini', 'antigravity', 'brain')
      : discovery.brainDir;
    this.defaultEnv = customEnv;
  }

  getAppDataBrainDir(): string {
    return this.appDataBrainDir;
  }

  getModelEvidence(conversationId: string): { actualModel: string | null; verified: boolean; reason: string | null } {
    try {
      const metadata = AgentApiGateway.getConversationMetadata(conversationId, this.defaultEnv || process.env);
      const runtimeValue = metadata?.staticConfig?.cascadeConfig?.plannerConfig?.planModel;
      if (metadata?.rootConversationId !== conversationId) {
        return { actualModel: null, verified: false, reason: 'CONVERSATION_METADATA_MISMATCH' };
      }
      if (typeof runtimeValue === 'string' && runtimeValue.length > 0) {
        return { actualModel: runtimeValue, verified: false, reason: 'RUNTIME_MODEL_ID_UNMAPPED' };
      }
      return { actualModel: null, verified: false, reason: 'ACTUAL_MODEL_UNAVAILABLE' };
    } catch (err: any) {
      return { actualModel: null, verified: false, reason: `MODEL_METADATA_UNAVAILABLE: ${err.message}` };
    }
  }

  /**
   * Spawns a new real Antigravity agent conversation
   */
  async startAgent(options: {
    model?: 'flash' | 'pro' | 'flash_lite';
    title: string;
    initialPrompt?: string;
    env?: NodeJS.ProcessEnv;
  }): Promise<string> {
    const model = ModelRegistry.resolveModel({ preference: options.model as any });
    const title = options.title.replace(/"/g, "'");
    const prompt = options.initialPrompt || 'Você é o Builder Antigravity. Aguarde tarefas do Supervisor.';
    const cleanEnv = this.sanitizeExecutionEnv(options.env);

    if (cleanEnv.USERPROFILE) {
      this.appDataBrainDir = path.join(cleanEnv.USERPROFILE, '.gemini', 'antigravity', 'brain');
    }

    Logger.info(`[AntigravityProvider] Iniciando novo agente Antigravity (Model: ${model}, Title: "${title}")...`);

    try {
      const conversationId = AgentApiGateway.newConversation({
        model,
        title,
        prompt,
        env: cleanEnv,
        caller: 'AntigravityProvider.startAgent'
      });

      Logger.success(`[AntigravityProvider] Agente Antigravity iniciado com ID: ${conversationId}`);
      return conversationId;
    } catch (err: any) {
      const errStr = (err.stderr || err.stdout || err.message || '').toString();
      if (/RESOURCE_EXHAUSTED|code 429|Individual quota reached/i.test(errStr)) {
        Logger.error(`[AntigravityProvider] Cota esgotada (429 / RESOURCE_EXHAUSTED). Abortando retries imediatos.`);
        throw new Error(`QUOTA_EXHAUSTED: ${errStr}`);
      }
      Logger.error(`[AntigravityProvider] Erro ao iniciar agente: ${err.message}`);
      throw err;
    }
  }

  /**
   * Sends a structured task to the Antigravity Builder agent with Karpathy Execution Layer hierarchy
   * and strict multi-account session affinity.
   */
  async sendTask(
    sessionId: string,
    taskInput: SupervisorToBuilderContract,
    options?: {
      projectId?: string | null;
      accountProfileId?: string;
      workerId?: string | null;
      runId?: string | null;
      model?: string;
      promptId?: string | null;
      promptHash?: string | null;
    }
  ): Promise<{ sessionId: string; rotated: boolean }> {
    const effectiveMode =
      taskInput.mode ||
      taskInput.task.mode ||
      PromptArchitectureService.detectWorkerMode(taskInput.task, {
        lastError: taskInput.previousError
      });

    const effectiveProjectId = options?.projectId || 'default-project';
    const relevantDecisions =
      (taskInput as any).relevantDecisions ||
      (taskInput.engineeringPackage as any)?.bundle?.relevantDecisions ||
      undefined;

    const { prompt, meta } = PromptArchitectureService.buildWorkerPrompt({
      mode: effectiveMode,
      projectId: effectiveProjectId,
      projectName: taskInput.context.projectName,
      projectPath: taskInput.context.projectPath,
      projectObjective: taskInput.context.objective,
      runId: options?.runId || null,
      taskId: taskInput.task.id,
      taskTitle: taskInput.task.title,
      taskDescription: taskInput.task.description,
      majorTaskCode: taskInput.task.majorTaskCode,
      majorTaskTitle: taskInput.task.majorTaskTitle,
      stageCode: taskInput.task.stageCode,
      stageTitle: taskInput.task.stageTitle,
      requirementIds: taskInput.task.requirementIds,
      completedDependenciesSummary: taskInput.task.completedDependenciesSummary,
      acceptanceCriteria: taskInput.acceptanceCriteria || [],
      verificationCommand: taskInput.task.verificationCommand,
      doneWhen: taskInput.task.doneWhen,
      expectedScopeFiles: taskInput.expectedScopeFiles,
      supervisorInstructions: taskInput.supervisorInstructions,
      relevantDecisions,
      programMd: taskInput.context.programMd,
      formattedEngineeringBlock: taskInput.engineeringPackage?.formattedPromptBlock,
      previousError: taskInput.previousError,
      previousEvaluatorOutput: taskInput.previousEvaluatorOutput,
      researchScope: (taskInput as any).researchScope,
      auditChecklist: (taskInput as any).auditChecklist,
      riskLevel: taskInput.riskLevel,
      protectedEvaluationWarning: taskInput.protectedEvaluationWarning,
      docSimpContextBlock: taskInput.docSimpContextBlock,
      designSkillContextBlock: taskInput.designSkillContextBlock || taskInput.designSkillBlock,
      reaSaaSMasterContextBlock: taskInput.reaSaaSMasterContextBlock,
      livingSpecContextBlock: taskInput.livingSpecContextBlock || (taskInput as any).livingSpecBlock,
      ...( {
        routedSkillId:
          (taskInput as any).routedSkillId ||
          (taskInput.task as any).skillRouted ||
          (taskInput.task as any).skill_routed,
        routedSkillDigest:
          (taskInput as any).routedSkillDigest ||
          (taskInput.task as any).skillDigest ||
          (taskInput.task as any).surgicalDigest
      } as any )
    });

    Logger.info(
      `[AntigravityProvider] Enviando tarefa "${taskInput.task.title}" (Modo: ${effectiveMode}, Versão: ${meta.version}) para o agente ${sessionId.slice(0, 8)}...`
    );

    const cleanEnv = this.sanitizeExecutionEnv(this.defaultEnv);
    if (cleanEnv.USERPROFILE) {
      this.appDataBrainDir = path.join(cleanEnv.USERPROFILE, '.gemini', 'antigravity', 'brain');
    }

    if (options?.projectId) {
      const { AgentSessionManager } = await import('./agentSessionManager.js');
      const activeWorkerSession = AgentSessionManager.getActiveSession(options.projectId, 'WORKER');
      if (activeWorkerSession) {
        let sessionMatchesAccount = true;
        if (options.accountProfileId && activeWorkerSession.metadata_json) {
          try {
            const parsedMeta = JSON.parse(activeWorkerSession.metadata_json);
            if (parsedMeta?.accountProfileId && parsedMeta.accountProfileId !== options.accountProfileId) {
              sessionMatchesAccount = false;
            }
          } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "antigravityProvider",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:antigravityProvider]", err);
      }
    }
        }

        if (sessionMatchesAccount) {
          this.captureTurnStart(
            activeWorkerSession.provider_conversation_id,
            taskInput.context.projectPath,
            taskInput.task.id
          );
          AgentTurnState.setPhase(activeWorkerSession.provider_conversation_id, 'IN_FLIGHT');
          try {
            await AgentSessionManager.sendMessage(activeWorkerSession, prompt, {
              env: cleanEnv,
              taskTitle: taskInput.task.title
            });
          } catch (err: any) {
            const beforeCall = this.isPreDispatchGuardError(err);
            AgentTurnState.setPhase(
              activeWorkerSession.provider_conversation_id,
              beforeCall ? 'NOT_SENT' : 'UNCERTAIN'
            );
            if (!beforeCall) throw new Error('AGENT_TURN_UNCERTAIN: send-message result requires reconciliation');
            throw err;
          }
          return { sessionId: activeWorkerSession.provider_conversation_id, rotated: false };
        } else {
          // Account was switched: rotate session to bind cleanly to the new accountProfileId
          const { newSession } = await AgentSessionManager.rotateSession(
            options.projectId,
            'WORKER',
            'ACCOUNT_SWITCH',
            {
              model: (options.model as any) || 'flash',
              env: cleanEnv,
              runId: options.runId,
              taskId: taskInput.task.id
            }
          );
          this.captureTurnStart(newSession.provider_conversation_id, taskInput.context.projectPath, taskInput.task.id);
          AgentTurnState.setPhase(newSession.provider_conversation_id, 'IN_FLIGHT');
          await AgentSessionManager.sendMessage(newSession, prompt, {
            env: cleanEnv,
            taskTitle: taskInput.task.title
          });
          return { sessionId: newSession.provider_conversation_id, rotated: true };
        }
      }
    }

    if (options?.accountProfileId) {
      this.captureTurnStart(sessionId, taskInput.context.projectPath, taskInput.task.id);
      AgentTurnState.setPhase(sessionId, 'IN_FLIGHT');
      const { ConversationManager } = await import('./conversationManager.js');
      try {
        const sendRes = ConversationManager.sendMessageOrRotate({
          conversationId: sessionId,
          prompt,
          projectId: options.projectId,
          accountProfileId: options.accountProfileId,
          role: 'worker',
          workerId: options.workerId,
          runId: options.runId,
          model: options.model || 'flash',
          env: cleanEnv,
          promptId: options.promptId || meta.version,
          promptHash: options.promptHash || meta.hash
        });
        return { sessionId: sendRes.conversationId, rotated: sendRes.rotated };
      } catch (err: any) {
        const beforeCall = this.isPreDispatchGuardError(err);
        AgentTurnState.setPhase(sessionId, beforeCall ? 'NOT_SENT' : 'UNCERTAIN');
        if (!beforeCall) throw new Error('AGENT_TURN_UNCERTAIN: send-message result requires reconciliation');
        throw err;
      }
    }

    try {
      this.captureTurnStart(sessionId, taskInput.context.projectPath, taskInput.task.id);
      AgentTurnState.setPhase(sessionId, 'IN_FLIGHT');

      AgentApiGateway.sendMessage({
        conversationId: sessionId,
        prompt,
        env: cleanEnv,
        caller: 'AntigravityProvider.sendTask'
      });
      return { sessionId, rotated: false };
    } catch (err: any) {
      if (AgentTurnState.get(sessionId)?.phase === 'IN_FLIGHT') {
        const beforeCall = this.isPreDispatchGuardError(err);
        AgentTurnState.setPhase(sessionId, beforeCall ? 'NOT_SENT' : 'UNCERTAIN');
        if (!beforeCall) throw new Error('AGENT_TURN_UNCERTAIN: send-message result requires reconciliation');
      }
      const errStr = (err.stderr || err.stdout || err.message || '').toString();
      if (/RESOURCE_EXHAUSTED|code 429|Individual quota reached/i.test(errStr)) {
        throw new Error(`QUOTA_EXHAUSTED: ${errStr}`);
      }
      Logger.error(`[AntigravityProvider] Erro ao enviar tarefa: ${err.message}`);
      throw err;
    }
  }

  /**
   * Gets the live activity status of an agent session
   */
  async getStatus(sessionId: string): Promise<AgentSessionStatus> {
    const transcriptFile = path.join(this.appDataBrainDir, sessionId, '.system_generated', 'logs', 'transcript.jsonl');
    const observation = AgentTurnState.get(sessionId);
    const progress = observation ? AgentTurnState.progress(observation) : observeTranscript(transcriptFile);
    return {
      sessionId,
      state:
        progress.state === 'COMPLETE'
          ? 'completed'
          : progress.state === 'ERROR'
            ? 'error'
            : !observation && !progress.entries.length && !fs.existsSync(transcriptFile)
              ? 'idle'
              : 'running',
      lastActivityAt: new Date().toISOString(),
      stepsCount: progress.entries.length
    };
  }

  /**
   * Waits for the agent to finish its execution and parses the results
   */
  async getResult(
    sessionId: string,
    timeoutMs = 180000,
    projectPath?: string,
    shouldCancel?: () => boolean
  ): Promise<BuilderToSupervisorContract> {
    const transcriptPath = path.join(this.appDataBrainDir, sessionId, '.system_generated', 'logs', 'transcript.jsonl');
    const startTime = Date.now();

    Logger.info(
      `[AntigravityProvider] Aguardando conclusão do agente ${sessionId.slice(0, 8)} (timeout: ${timeoutMs / 1000}s)...`
    );

    const observation = AgentTurnState.get(sessionId);
    const initialLineCount =
      this.turnStarts.get(sessionId) ??
      observation?.baseline_lines ??
      (fs.existsSync(transcriptPath)
        ? fs.readFileSync(transcriptPath, 'utf-8').trim().split('\n').filter(Boolean).length
        : 0);

    let isComplete = false;

    do {
      if (shouldCancel?.() || TurnCancellationManager.isCancelled(sessionId)) {
        throw new Error('RUN_CANCELLED: a execução foi interrompida pelo usuário');
      }
      const progress = observeTranscript(transcriptPath, initialLineCount);
      if (progress.state === 'ERROR') {
        const detail = String(
          progress.entries.find(e => e.type === 'ERROR_MESSAGE')?.error || 'Native authentication/quota error'
        );
        throw new Error(
          /RESOURCE_EXHAUSTED|429|quota/i.test(detail) ? `QUOTA_EXHAUSTED: ${detail}` : `AUTH_ERROR: ${detail}`
        );
      }
      if (progress.state === 'COMPLETE') {
        isComplete = true;
        break;
      }

      if (Date.now() - startTime >= timeoutMs) break;
      await new Promise(r => setTimeout(r, Math.min(750, timeoutMs)));
    } while (Date.now() - startTime < timeoutMs);

    if (!isComplete) {
      Logger.warn(`[AntigravityProvider] Timeout atingido ou execução ainda em andamento para ${sessionId.slice(0, 8)}.`);
      const partial = this.parseTranscriptToReport(sessionId, projectPath);
      const progress = observeTranscript(transcriptPath, initialLineCount);
      return {
        ...partial,
        status: 'failure',
        problems: [
          ...(partial.problems || []),
          ...(progress.pendingTools.length
            ? ['AGENT_NATIVE_TOOL_PENDING: ' + progress.pendingTools.join(', ')]
            : []),
          'AGENT_EXECUTION_TIMEOUT: conversa não concluiu dentro do prazo'
        ]
      };
    }

    AgentTurnState.setPhase(sessionId, 'COMPLETE');
    return this.parseTranscriptToReport(sessionId, projectPath);
  }

  /**
   * Parses the transcript.jsonl and extracts all actual files modified, commands executed, and final text
   */
  private parseTranscriptToReport(sessionId: string, projectPath?: string): BuilderToSupervisorContract {
    const transcriptPath = path.join(this.appDataBrainDir, sessionId, '.system_generated', 'logs', 'transcript.jsonl');
    const filesChanged = new Set<string>();
    let toolCallsCount = 0;
    const commandsExecuted: string[] = [];
    let finalResponse = '';
    let agentThoughts = '';
    let hasErrors = false;

    if (!fs.existsSync(transcriptPath)) {
      return {
        status: 'failure',
        filesChanged: [],
        implemented: [],
        commandsExecuted: [],
        tests: { ran: false },
        buildStatus: 'Transcript não encontrado',
        problems: ['Transcript não gerado pelo agente'],
        decisions: []
      };
    }

    try {
      const content = fs.readFileSync(transcriptPath, 'utf-8');
      const startLine = this.turnStarts.get(sessionId) ?? AgentTurnState.get(sessionId)?.baseline_lines ?? 0;
      const lines = content.trim().split('\n').filter(Boolean).slice(startLine);

      for (const lineStr of lines) {
        try {
          const entry = JSON.parse(lineStr);

          if (entry.tool_calls && Array.isArray(entry.tool_calls)) {
            toolCallsCount += entry.tool_calls.length;
            for (const call of entry.tool_calls) {
              let args = call.args;
              if (typeof args === 'string') {
                try {
                  args = JSON.parse(args);
                } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "antigravityProvider",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:antigravityProvider]", err);
      }
    }
              }

              if (
                call.name === 'write_to_file' ||
                call.name === 'replace_file_content' ||
                call.name === 'multi_replace_file_content' ||
                call.name === 'edit_file' ||
                call.name === 'create_file' ||
                call.name === 'patch_file'
              ) {
                const target =
                  args?.TargetFile || args?.targetFile || args?.FilePath || args?.file_path || args?.path;
                if (typeof target === 'string' && target.trim()) {
                  filesChanged.add(target.replace(/"/g, '').trim());
                }
              } else if (call.name === 'run_command' || call.name === 'execute_command') {
                const cmd = args?.CommandLine || args?.commandLine || args?.command || args?.cmd;
                if (typeof cmd === 'string' && cmd.trim()) {
                  commandsExecuted.push(cmd.replace(/"/g, '').trim());
                }
              }
            }
          }

          if (entry.status === 'ERROR') {
            hasErrors = true;
          }

          if (entry.thinking) {
            agentThoughts = entry.thinking;
          }

          if (entry.type === 'PLANNER_RESPONSE' && entry.content) {
            let fullContent = entry.content;
            if (Array.isArray(entry.truncated_fields) && entry.truncated_fields.includes('content')) {
              const fullPath = path.join(
                this.appDataBrainDir,
                sessionId,
                '.system_generated',
                'logs',
                'transcript_full.jsonl'
              );
              if (fs.existsSync(fullPath)) {
                try {
                  const fullLines = fs.readFileSync(fullPath, 'utf-8').trim().split('\n').filter(Boolean);
                  for (let j = fullLines.length - 1; j >= 0; j--) {
                    const fe = JSON.parse(fullLines[j]);
                    if (fe.step_index === entry.step_index && fe.content) {
                      fullContent = fe.content;
                      break;
                    }
                  }
                } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "antigravityProvider",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:antigravityProvider]", err);
      }
    }
              }
            }
            finalResponse = fullContent;
          }
        } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "antigravityProvider",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:antigravityProvider]", err);
      }
    }
      }
    } catch (err: any) {
      Logger.error(`[AntigravityProvider] Erro ao parsear transcript: ${err.message}`);
    }

    const observation = AgentTurnState.get(sessionId);
    let baselineInventory: Record<string, any> | null = null;
    if (observation?.baseline_files_json) {
      try {
        baselineInventory = JSON.parse(observation.baseline_files_json);
      } catch {
        baselineInventory = null;
      }
    }

    if (projectPath && observation?.project_path === path.resolve(projectPath) && baselineInventory) {
      filesChanged.clear();
      for (const file of changedFiles(baselineInventory, captureFileInventory(projectPath))) {
        filesChanged.add(file);
      }
    }

    const filesArray = Array.from(filesChanged)
      .filter(file => {
        if (!projectPath) return false;
        const root = path.resolve(projectPath);
        const absolute = path.resolve(root, file);
        const relative = path.relative(root, absolute);
        const normRel = relative.replace(/\\/g, '/');
        if (
          relative === '..' ||
          relative.startsWith(`..${path.sep}`) ||
          path.isAbsolute(relative) ||
          normRel.startsWith('node_modules/') ||
          normRel.startsWith('.git/') ||
          normRel.startsWith('.playwright-cli/')
        ) {
          return false;
        }
        return (
          fs.existsSync(absolute) ||
          Boolean(baselineInventory && Object.hasOwn(baselineInventory, normRel))
        );
      })
      .map(file => path.relative(path.resolve(projectPath!), path.resolve(projectPath!, file)).replace(/\\/g, '/'));

    const testsRan = commandsExecuted.some(
      c => c.includes('test') || c.includes('npm test') || c.includes('node --test')
    );

    const hasSubstantiveReport = !hasErrors && finalResponse.trim().length > 50;
    const isSuccess =
      filesArray.length > 0 || testsRan || (!hasErrors && commandsExecuted.length > 0) || hasSubstantiveReport;

    let thinkBeforeCoding: BuilderToSupervisorContract['thinkBeforeCoding'];
    let simplicityCheck: BuilderToSupervisorContract['simplicityCheck'];

    try {
      const fencedBlocks = Array.from(finalResponse.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi));
      for (let i = fencedBlocks.length - 1; i >= 0; i--) {
        try {
          const parsed = JSON.parse(fencedBlocks[i][1].trim());
          if (parsed && typeof parsed === 'object') {
            if (parsed.thinkBeforeCoding && !thinkBeforeCoding) thinkBeforeCoding = parsed.thinkBeforeCoding;
            if (parsed.simplicityCheck && !simplicityCheck) simplicityCheck = parsed.simplicityCheck;
          }
        } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "antigravityProvider",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:antigravityProvider]", err);
      }
    }
      }
    } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "antigravityProvider",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:antigravityProvider]", err);
      }
    }

    return {
      status: isSuccess ? 'success' : 'failure',
      filesChanged: filesArray,
      toolCallsCount,
      implemented: filesArray.length > 0 ? ['Implementação realizada pelo Antigravity Builder'] : [],
      commandsExecuted,
      tests: {
        ran: testsRan,
        command: commandsExecuted.find(c => c.includes('test')),
        passed: false
      },
      buildStatus: filesArray.length > 0 ? 'Arquivos criados/modificados com sucesso' : 'Nenhum arquivo modificado',
      browserValidation: undefined,
      problems: hasErrors && !isSuccess ? ['O agente encontrou erros durante a execução de ferramentas'] : [],
      decisions: [
        {
          decision: 'Código implementado autonomamente pelo modelo Antigravity Builder',
          rationale: 'Estratégia determinada dinamicamente pelo raciocínio do modelo'
        }
      ],
      agentThoughts,
      rawResponse: finalResponse,
      thinkBeforeCoding,
      simplicityCheck,
      isSurgical: undefined
    };
  }

  async cancelTask(sessionId: string): Promise<void> {
    Logger.info(`[AntigravityProvider] Cancelando tarefa da sessão ${sessionId}...`);
    TurnCancellationManager.requestCancellation(sessionId);
    try {
      AgentTurnState.setPhase(sessionId, 'CONSUMED');
    } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "antigravityProvider",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:antigravityProvider]", err);
      }
    }
    try {
      const { ExecutionCoordinator } = await import('./executionCoordinator.js');
      ExecutionCoordinator.releaseByContext({ scope: sessionId });
      ExecutionCoordinator.reconcileDeadReservations();
    } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "antigravityProvider",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:antigravityProvider]", err);
      }
    }
  }
}