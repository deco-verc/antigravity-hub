import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { AgentProvider, AgentSessionStatus, BuilderToSupervisorContract, SupervisorToBuilderContract } from './agentProvider.js';
import { Logger } from './logger.js';
import { AntigravityDiscovery } from './antigravityDiscovery.js';
import { PromptArchitectureService, WorkerMode } from './promptArchitectureService.js';

export function getLanguageServerExe(): string {
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

  constructor(customEnv?: NodeJS.ProcessEnv) {
    const discovery = AntigravityDiscovery.discover();
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
      const output = execFileSync(this.exePath, ['agentapi', 'get-conversation-metadata', conversationId], {
        encoding: 'utf-8', timeout: 10000, env: this.defaultEnv || process.env
      });
      const metadata = JSON.parse(output)?.response?.conversationMetadata?.metadata;
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
    const model = options.model || 'flash';
    const title = options.title.replace(/"/g, "'");
    const prompt = options.initialPrompt || 'Você é o Builder Antigravity. Aguarde tarefas do Supervisor.';

    // Prepare clean environment: scrub dangerous Electron/headless variables
    const rawEnv = options.env || this.defaultEnv || process.env;
    const cleanEnv: NodeJS.ProcessEnv = { ...rawEnv };
    delete cleanEnv.ELECTRON_RUN_AS_NODE;
    delete cleanEnv.ELECTRON_NO_ASAR;
    delete cleanEnv.ELECTRON_OZONE_PLATFORM_HINT;
    delete cleanEnv.ELECTRON_ENABLE_LOGGING;

    Logger.info(`[AntigravityProvider] Iniciando novo agente Antigravity real (Model: ${model}, Title: "${title}")...`);

    let lastErr: any = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const out = execFileSync(
          this.exePath,
          ['agentapi', 'new-conversation', `--model=${model}`, `--title=${title}`, prompt],
          { encoding: 'utf-8', timeout: 60000, env: cleanEnv }
        );

        const parsed = JSON.parse(out);
        const conversationId = parsed?.response?.newConversation?.conversationId;
        if (!conversationId) {
          throw new Error(`Falha ao obter conversationId: ${out}`);
        }

        Logger.success(`[AntigravityProvider] Agente Antigravity iniciado com ID: ${conversationId}`);
        return conversationId;
      } catch (err: any) {
        lastErr = err;
        const errStr = (err.stderr || err.stdout || err.message || '').toString();
        if (/RESOURCE_EXHAUSTED|code 429|Individual quota reached/i.test(errStr)) {
          Logger.error(`[AntigravityProvider] Cota esgotada (429 / RESOURCE_EXHAUSTED). Abortando retries imediatos.`);
          throw new Error(`QUOTA_EXHAUSTED: ${errStr}`);
        }
        Logger.warn(`[AntigravityProvider] Tentativa ${attempt}/3 falhou ao iniciar agente: ${err.message}. Aguardando retry...`);
        if (attempt < 3) {
          const sleepMs = attempt * 2000;
          const end = Date.now() + sleepMs;
          while (Date.now() < end) {}
        }
      }
    }
    Logger.error(`[AntigravityProvider] Erro ao iniciar agente após 3 tentativas: ${lastErr?.message}`);
    throw lastErr;
  }

  /**
   * Sends a structured task to the Antigravity Builder agent with Karpathy Execution Layer hierarchy
   */
  async sendTask(sessionId: string, taskInput: SupervisorToBuilderContract, options?: {
    projectId?: string | null;
    accountProfileId?: string;
    workerId?: string | null;
    runId?: string | null;
    model?: string;
    promptId?: string | null;
    promptHash?: string | null;
  }): Promise<{ sessionId: string; rotated: boolean }> {
    const effectiveMode = taskInput.mode || taskInput.task.mode || PromptArchitectureService.detectWorkerMode(taskInput.task, {
      lastError: taskInput.previousError
    });

    const effectiveProjectId = options?.projectId || 'default-project';
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
      acceptanceCriteria: taskInput.acceptanceCriteria || [],
      verificationCommand: taskInput.task.verificationCommand,
      doneWhen: taskInput.task.doneWhen,
      expectedScopeFiles: taskInput.expectedScopeFiles,
      supervisorInstructions: taskInput.supervisorInstructions,
      programMd: taskInput.context.programMd,
      formattedEngineeringBlock: taskInput.engineeringPackage?.formattedPromptBlock,
      previousError: taskInput.previousError,
      previousEvaluatorOutput: taskInput.previousEvaluatorOutput,
      riskLevel: taskInput.riskLevel,
      protectedEvaluationWarning: taskInput.protectedEvaluationWarning
    });

    Logger.info(`[AntigravityProvider] Enviando tarefa "${taskInput.task.title}" (Modo: ${effectiveMode}, Versão: ${meta.version}) para o agente ${sessionId.slice(0, 8)}...`);

    const rawEnv = this.defaultEnv || process.env;

    if (options?.projectId) {
      const { AgentSessionManager } = await import('./agentSessionManager.js');
      const activeWorkerSession = AgentSessionManager.getActiveSession(options.projectId, 'WORKER');
      if (activeWorkerSession) {
        await AgentSessionManager.sendMessage(activeWorkerSession, prompt, {
          env: rawEnv,
          taskTitle: taskInput.task.title
        });
        return { sessionId: activeWorkerSession.provider_conversation_id, rotated: false };
      }
    }

    if (options?.accountProfileId) {
      const { ConversationManager } = await import('./conversationManager.js');
      const sendRes = ConversationManager.sendMessageOrRotate({
        conversationId: sessionId,
        prompt,
        projectId: options.projectId,
        accountProfileId: options.accountProfileId,
        role: 'worker',
        workerId: options.workerId,
        runId: options.runId,
        model: options.model || 'flash',
        env: rawEnv,
        promptId: options.promptId || meta.version,
        promptHash: options.promptHash || meta.hash
      });
      return { sessionId: sendRes.conversationId, rotated: sendRes.rotated };
    }

    try {
      const cleanEnv: NodeJS.ProcessEnv = { ...rawEnv };
      delete cleanEnv.ELECTRON_RUN_AS_NODE;
      delete cleanEnv.ELECTRON_NO_ASAR;
      delete cleanEnv.ELECTRON_OZONE_PLATFORM_HINT;
      delete cleanEnv.ELECTRON_ENABLE_LOGGING;

      execFileSync(
        this.exePath,
        ['agentapi', 'send-message', sessionId, prompt],
        { encoding: 'utf-8', timeout: 30000, env: cleanEnv }
      );
      return { sessionId, rotated: false };
    } catch (err: any) {
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
    const transcriptPath = path.join(this.appDataBrainDir, sessionId, '.system_generated', 'logs', 'transcript.jsonl');
    if (!fs.existsSync(transcriptPath)) {
      return {
        sessionId,
        state: 'idle',
        lastActivityAt: new Date().toISOString(),
        stepsCount: 0
      };
    }

    try {
      const content = fs.readFileSync(transcriptPath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      const stepsCount = lines.length;
      if (stepsCount === 0) {
        return { sessionId, state: 'idle', lastActivityAt: new Date().toISOString(), stepsCount: 0 };
      }

      const lastLine = JSON.parse(lines[lines.length - 1]);
      const isWorking = lastLine.status === 'RUNNING' || (lastLine.tool_calls && lastLine.tool_calls.length > 0 && lastLine.status !== 'DONE');

      return {
        sessionId,
        state: isWorking ? 'running' : 'completed',
        lastActivityAt: lastLine.created_at || new Date().toISOString(),
        stepsCount
      };
    } catch {
      return {
        sessionId,
        state: 'running',
        lastActivityAt: new Date().toISOString(),
        stepsCount: 0
      };
    }
  }

  /**
   * Waits for the agent to finish its execution and parses the results
   */
  async getResult(sessionId: string, timeoutMs = 180000, projectPath?: string, shouldCancel?: () => boolean): Promise<BuilderToSupervisorContract> {
    const transcriptPath = path.join(this.appDataBrainDir, sessionId, '.system_generated', 'logs', 'transcript.jsonl');
    const startTime = Date.now();

    Logger.info(`[AntigravityProvider] Aguardando conclusão do agente ${sessionId.slice(0, 8)} (timeout: ${timeoutMs / 1000}s)...`);

    // Track starting line count to inspect only NEW events from this turn
    const initialLineCount = fs.existsSync(transcriptPath)
      ? fs.readFileSync(transcriptPath, 'utf-8').trim().split('\n').filter(Boolean).length
      : 0;

    // Poll transcript until agent finishes thinking and all tools are resolved
    let isComplete = false;
    let lastStepCount = 0;
    let stableChecks = 0;

    while (Date.now() - startTime < timeoutMs) {
      if (shouldCancel?.()) throw new Error('RUN_CANCELLED: a execução foi interrompida pelo usuário');
      if (fs.existsSync(transcriptPath)) {
        try {
          const content = fs.readFileSync(transcriptPath, 'utf-8');
          const lines = content.trim().split('\n').filter(Boolean);

          if (lines.length > initialLineCount) {
            const newLines = lines.slice(initialLineCount);
            const lastLine = JSON.parse(newLines[newLines.length - 1]);

            // Check if transcript received an unrecoverable system ERROR_MESSAGE in this turn
            if (lastLine.type === 'ERROR_MESSAGE') {
              const errStr = String(lastLine.error || lastLine.content || '');
              if (/RESOURCE_EXHAUSTED|code 429|Individual quota reached/i.test(errStr)) {
                throw new Error(`QUOTA_EXHAUSTED: ${errStr}`);
              }
            }

            // Agent is completed when last line is PLANNER_RESPONSE with status DONE, has content, and no pending tool calls
            const hasActiveToolCalls = lastLine.tool_calls && Array.isArray(lastLine.tool_calls) && lastLine.tool_calls.length > 0;
            if (lastLine.type === 'PLANNER_RESPONSE' && lastLine.status === 'DONE' && lastLine.content && !hasActiveToolCalls) {
              if (lines.length === lastStepCount) {
                stableChecks++;
                if (stableChecks >= 2) {
                  isComplete = true;
                  break;
                }
              } else {
                lastStepCount = lines.length;
                stableChecks = 0;
              }
            } else {
              stableChecks = 0;
            }
          }
        } catch (e: any) {
          if (e.message?.startsWith('QUOTA_EXHAUSTED')) throw e;
          // ignore transient read lock
        }
      }

      await new Promise(r => setTimeout(r, 2000));
    }

    if (!isComplete) {
      if (fs.existsSync(transcriptPath)) {
        try {
          const content = fs.readFileSync(transcriptPath, 'utf-8');
          const lines = content.trim().split('\n').filter(Boolean);
          const newLines = lines.slice(initialLineCount);
          const newRaw = newLines.join('\n');
          if (/RESOURCE_EXHAUSTED|code 429|Individual quota reached/i.test(newRaw)) {
            const match = newRaw.match(/RESOURCE_EXHAUSTED[^\n\r"]*/i) || newRaw.match(/Individual quota reached[^\n\r"]*/i);
            const detail = match ? match[0] : 'RESOURCE_EXHAUSTED (code 429)';
            throw new Error(`QUOTA_EXHAUSTED: ${detail}`);
          }
        } catch (e: any) {
          if (e.message?.startsWith('QUOTA_EXHAUSTED')) throw e;
        }
      }
      Logger.warn(`[AntigravityProvider] Timeout atingido ou execução ainda em andamento para ${sessionId.slice(0, 8)}.`);
      const partial = this.parseTranscriptToReport(sessionId, projectPath);
      return {
        ...partial,
        status: 'failure',
        problems: [...(partial.problems || []), 'AGENT_EXECUTION_TIMEOUT: conversa não concluiu dentro do prazo']
      };
    }

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
      const lines = content.trim().split('\n').filter(Boolean);

      for (const lineStr of lines) {
        try {
          const entry = JSON.parse(lineStr);

          // Capture tools
          if (entry.tool_calls && Array.isArray(entry.tool_calls)) {
            toolCallsCount += entry.tool_calls.length;
            for (const call of entry.tool_calls) {
              let args = call.args;
              if (typeof args === 'string') {
                try { args = JSON.parse(args); } catch {}
              }

              if (call.name === 'write_to_file' || call.name === 'replace_file_content') {
                const target = args?.TargetFile || args?.targetFile || args?.path;
                if (target) filesChanged.add(target.replace(/"/g, ''));
              } else if (call.name === 'run_command') {
                const cmd = args?.CommandLine || args?.command;
                if (cmd) commandsExecuted.push(cmd.replace(/"/g, ''));
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
              const fullPath = path.join(this.appDataBrainDir, sessionId, '.system_generated', 'logs', 'transcript_full.jsonl');
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
                } catch {}
              }
            }
            finalResponse = fullContent;
          }
        } catch {}
      }
    } catch (err: any) {
      Logger.error(`[AntigravityProvider] Erro ao parsear transcript: ${err.message}`);
    }

    // Also inspect git status or actual files in projectPath to avoid dropping files created by terminal commands
    if (projectPath && fs.existsSync(projectPath)) {
      try {
        const { execFileSync } = require('node:child_process');
        const changed = execFileSync('git', [
          'ls-files', '--modified', '--others', '--exclude-standard', '-z'
        ], { cwd: projectPath, encoding: 'utf-8', timeout: 5000 });
        for (const rawFile of changed.split('\0').filter(Boolean)) {
          if (!rawFile.startsWith('.git') && !rawFile.startsWith('node_modules')) {
            filesChanged.add(path.resolve(projectPath, rawFile));
          }
        }
      } catch {}
    }

    const filesArray = Array.from(filesChanged).filter(file => {
      if (!projectPath) return false;
      const root = path.resolve(projectPath);
      const absolute = path.resolve(root, file);
      const relative = path.relative(root, absolute);
      return relative !== '..' && !relative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relative) && !relative.startsWith('node_modules' + path.sep) &&
        fs.existsSync(absolute);
    });
    const testsRan = commandsExecuted.some(c => c.includes('test') || c.includes('npm test') || c.includes('node --test'));

    // Check if the final steps or tests succeeded: transient tool errors (like permission probes)
    // that were overcome shouldn't fail an otherwise successful implementation.
    // Notice: for AUDIT or RESEARCH tasks, filesArray may be 0, but a substantive final report indicates success.
    const hasSubstantiveReport = !hasErrors && finalResponse.trim().length > 50;
    const isSuccess = filesArray.length > 0 || testsRan || (!hasErrors && commandsExecuted.length > 0) || hasSubstantiveReport;

    let thinkBeforeCoding: BuilderToSupervisorContract['thinkBeforeCoding'];
    let simplicityCheck: BuilderToSupervisorContract['simplicityCheck'];

    try {
      const match = finalResponse.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match) {
        const parsed = JSON.parse(match[1].trim());
        if (parsed.thinkBeforeCoding) thinkBeforeCoding = parsed.thinkBeforeCoding;
        if (parsed.simplicityCheck) simplicityCheck = parsed.simplicityCheck;
      }
    } catch {}

    if (!thinkBeforeCoding) {
      thinkBeforeCoding = {
        assumptions: ['Requisitos padrão do projeto'],
        ambiguities: ['Nenhuma ambiguidade impeditiva'],
        selectedApproach: 'Implementação direta e cirúrgica',
        reason: 'Menor caminho correto sem complexidade desnecessária',
        clarificationRequired: false
      };
    }

    if (!simplicityCheck) {
      simplicityCheck = {
        isSimplestSolution: true,
        explanation: 'Código implementado sem abstrações redundantes ou código morto.'
      };
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
        // The independent evaluator, not a file-change heuristic, determines test success.
        passed: false
      },
      buildStatus: filesArray.length > 0 ? 'Arquivos criados/modificados com sucesso' : 'Nenhum arquivo modificado',
      browserValidation: 'Componentes e arquivos prontos para inspeção',
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
      isSurgical: true
    };
  }

  async cancelTask(sessionId: string): Promise<void> {
    Logger.info(`[AntigravityProvider] Cancelando tarefa da sessão ${sessionId}...`);
    // Session is managed natively by Antigravity language_server
  }
}
