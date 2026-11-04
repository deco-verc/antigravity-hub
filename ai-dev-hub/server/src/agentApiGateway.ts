import { AccountProfileManager } from './accountProfileManager.js';
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Logger } from './logger.js';
import { SessionCircuitBreaker } from './sessionCircuitBreaker.js';
import { AntigravityDiscovery } from './antigravityDiscovery.js';
import { DevAutonomyService } from './devAutonomyService.js';
import { db } from './db.js';
import { NativeWorkspaceBinding } from './nativeWorkspaceBinding.js';
import { ObservabilityService } from './observability/observabilityService.js';

function getAccountProfileManager(): typeof import('./accountProfileManager.js').AccountProfileManager {
  return require('./accountProfileManager.js').AccountProfileManager;
}

export class FailClosedGuardError extends Error {
  public code = 'FAIL_CLOSED_GUARD';
  constructor(message: string) {
    super(message);
    this.name = 'FailClosedGuardError';
  }
}

export interface AgentApiMockProvider {
  newConversation(options: {
    model: string;
    title: string;
    prompt: string;
    projectId?: string | null;
    role?: string | null;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
  }): string | Promise<string>;
  sendMessage(options: {
    conversationId: string;
    prompt: string;
    projectId?: string | null;
    role?: string | null;
  }): void;
  getConversationMetadata(conversationId: string): any;
  getResponse?(conversationId: string, mode?: 'PLAN' | 'REVIEW' | 'CONVERSATIONAL'): string | undefined;
  reset?(): void;
}

export class DefaultFakeAgentApiProvider implements AgentApiMockProvider {
  public conversations: Array<{
    id: string;
    model: string;
    title: string;
    initialPrompt: string;
    projectId?: string | null;
    role?: string | null;
    messages: string[];
    createdAt: string;
  }> = [];

  public creationCount = 0;
  public messageCount = 0;
  public simulateFailure: Error | null = null;
  public responseProvider?: (conversationId: string, mode?: 'PLAN' | 'REVIEW') => string;
  getResponse(conversationId: string, mode?: 'PLAN' | 'REVIEW'): string | undefined {
    return this.responseProvider?.(conversationId, mode);
  }

  newConversation(options: {
    model: string;
    title: string;
    prompt: string;
    projectId?: string | null;
    role?: string | null;
  }): string {
    if (this.simulateFailure) {
      throw this.simulateFailure;
    }
    this.creationCount++;
    const roleSlug = (options.role || 'agent').toLowerCase();
    const id = `conv-fake-${roleSlug}-${this.creationCount}-${Date.now().toString(36)}`;
    this.conversations.push({
      id,
      model: options.model,
      title: options.title,
      initialPrompt: options.prompt,
      projectId: options.projectId,
      role: options.role,
      messages: [options.prompt],
      createdAt: new Date().toISOString()
    });
    return id;
  }

  sendMessage(options: {
    conversationId: string;
    prompt: string;
    projectId?: string | null;
    role?: string | null;
  }): void {
    if (this.simulateFailure) {
      throw this.simulateFailure;
    }
    this.messageCount++;
    const existing = this.conversations.find(c => c.id === options.conversationId);
    if (existing) {
      existing.messages.push(options.prompt);
    }
  }

  getConversationMetadata(conversationId: string): any {
    const existing = this.conversations.find(c => c.id === conversationId);
    return {
      rootConversationId: conversationId,
      status: existing ? 'ACTIVE' : 'NOT_FOUND',
      model: existing?.model,
      role: existing?.role
    };
  }

  reset(): void {
    this.conversations = [];
    this.creationCount = 0;
    this.messageCount = 0;
    this.simulateFailure = null;
  }
}

export class AgentApiGateway {
  private static _mockProvider: AgentApiMockProvider | null = null;
  private static _defaultMock = new DefaultFakeAgentApiProvider();

  /**
   * Evaluates if system is currently in forced offline/test mode.
   * In test environment or when DECOHUB_OFFLINE_MODE is 'true', mock is strictly enforced.
   */
  static isOfflineMode(): boolean {
    if (process.env.DECOHUB_OFFLINE_MODE === 'false') return false;
    if (process.env.DECOHUB_OFFLINE_MODE === 'true') return true;
    if (process.env.NODE_ENV === 'test' && process.env.DECOHUB_ALLOW_LIVE_AGENTAPI !== 'true') return true;
    return false;
  }

  static setMockProvider(provider: AgentApiMockProvider | null): void {
    if (provider && !this.isOfflineMode()) {
      throw new FailClosedGuardError('MOCK_PROVIDER_GUARD: provider simulado permitido somente em modo offline.');
    }
    this._mockProvider = provider;
  }

  static getMockProvider(): AgentApiMockProvider | null {
    return this._mockProvider;
  }

  static installDefaultMock(): DefaultFakeAgentApiProvider {
    if (!this.isOfflineMode()) {
      throw new FailClosedGuardError('MOCK_PROVIDER_GUARD: fixture não pode substituir execução nativa.');
    }
    this._defaultMock.reset();
    this._mockProvider = this._defaultMock;
    return this._defaultMock;
  }

  static restoreLiveGateway(): void {
    this._mockProvider = null;
  }

  /**
   * Sanitizes environment variables before spawning language server
   */
  static sanitizeEnv(customEnv?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const raw = customEnv || process.env;
    const clean: NodeJS.ProcessEnv = { ...raw };
    delete clean.ELECTRON_RUN_AS_NODE;
    delete clean.ELECTRON_NO_ASAR;
    delete clean.ELECTRON_OZONE_PLATFORM_HINT;
    delete clean.ELECTRON_ENABLE_LOGGING;
    return clean;
  }

  /**
   * Normalizes any Antigravity 2.0 model slug ('gemini-3.8-flash', 'claude-sonnet-4.6', 'gpt-oss-120b', etc.)
   * preserving full slugs for multi-family models (Claude, GPT/OSS) and mapping native tiers safely.
   */
  static normalizeCliModelFlag(rawModel: string | undefined | null): string {
    if (!rawModel || typeof rawModel !== 'string') return 'flash';
    const cleaned = rawModel.trim().toLowerCase();

    // 1. Preservar modelos Claude reais (ex: claude-sonnet-4.6, claude-opus-4.6, claude-sonnet-5.5)
    if (cleaned.includes('claude') || cleaned.includes('sonnet') || cleaned.includes('opus')) {
      return cleaned;
    }

    // 2. Preservar modelos GPT e Open Weights (ex: gpt-oss-120b, gpt-4o, o1, o3)
    if (cleaned.includes('gpt') || cleaned.includes('oss') || cleaned.includes('openai') || cleaned.startsWith('o1') || cleaned.startsWith('o3')) {
      return cleaned;
    }

    // 3. Tiers clássicos e versões Gemini
    if (cleaned === 'pro' || cleaned === 'gemini-3.1-pro' || cleaned === 'gemini-2.5-pro') {
      return 'pro';
    }
    if (cleaned === 'flash_lite' || cleaned === 'flash-lite' || cleaned === 'gemini-2.5-flash-lite') {
      return 'flash_lite';
    }
    if (cleaned === 'flash' || cleaned === 'gemini-3.8-flash' || cleaned === 'gemini-2.5-flash') {
      return 'flash';
    }

    // 4. Se for slug com hífen, preserva diretamente
    if (cleaned.includes('-')) {
      return cleaned;
    }

    return cleaned || 'flash';
  }

  /**
   * Checks whether a CLI error output corresponds to quota/credit exhaustion (HTTP 429 / RESOURCE_EXHAUSTED / G1 credits)
   */
  private static isQuotaOrCreditsError(errStr: string): boolean {
    return /RESOURCE_EXHAUSTED|code 429|HTTP 429|Individual quota reached|AI credits balance is too low|Out of credits|quota exhausted/i.test(
      errStr
    );
  }

  /**
   * Refreshes the running Language Server connection details (ANTIGRAVITY_LS_ADDRESS & ANTIGRAVITY_CSRF_TOKEN)
   * if a retry occurs after a transient connection drop or profile runtime restart.
   */
  private static tryRefreshProfileConnectionEnv(cleanEnv: NodeJS.ProcessEnv, projectId?: string | null): void {
    if (this.isOfflineMode()) return;
    try {
      const targetProfileId = this.resolveProfileIdForEnv(cleanEnv, projectId);
      try {
        const { RuntimeDaemonManager } = require('./runtimeDaemonManager.js');
        const daemonRes = RuntimeDaemonManager.ensureSingleRuntimeRunningSync(targetProfileId, 4000);
        if (daemonRes?.address && daemonRes?.csrfToken) {
          cleanEnv.ANTIGRAVITY_LS_ADDRESS = daemonRes.address;
          cleanEnv.ANTIGRAVITY_CSRF_TOKEN = daemonRes.csrfToken;
          process.env.ANTIGRAVITY_LS_ADDRESS = daemonRes.address;
          process.env.ANTIGRAVITY_CSRF_TOKEN = daemonRes.csrfToken;
          return;
        }
      } catch {}

      const userProfileDir = cleanEnv.USERPROFILE;
      if (!userProfileDir) return;
      const rows: any[] = db.prepare('SELECT id, environment_path, display_name FROM account_profiles').all();
      const matched = rows.find(
        r => r.environment_path && r.environment_path.toLowerCase() === userProfileDir.toLowerCase()
      );
      if (matched) {
        const apm = getAccountProfileManager();
        if (apm && typeof apm.ensureProfileRuntimeRunningSync === 'function') {
          const instance = apm.ensureProfileRuntimeRunningSync(matched, 8000);
          if (instance?.address && instance?.csrfToken) {
            cleanEnv.ANTIGRAVITY_LS_ADDRESS = instance.address;
            cleanEnv.ANTIGRAVITY_CSRF_TOKEN = instance.csrfToken;
            process.env.ANTIGRAVITY_LS_ADDRESS = instance.address;
            process.env.ANTIGRAVITY_CSRF_TOKEN = instance.csrfToken;
          }
        }
      }
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "agentApiGateway",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:agentApiGateway]", err);
      }
    }
  }

  /**
   * Helper to detect connection refused, closed socket, or LS communication failure
   */
  static isConnectionFailure(error: any): boolean {
    const errStr = (error?.stderr || error?.stdout || error?.message || String(error)).toLowerCase();
    return (
      errStr.includes('econnrefused') ||
      errStr.includes('econnreset') ||
      errStr.includes('epipe') ||
      errStr.includes('socket hang up') ||
      errStr.includes('closed socket') ||
      errStr.includes('socket closed') ||
      errStr.includes('connection refused') ||
      errStr.includes('failed to connect') ||
      errStr.includes('language server offline') ||
      errStr.includes('language_server offline') ||
      errStr.includes('channel is closed') ||
      errStr.includes('transport is closing') ||
      errStr.includes('actively refused') ||
      errStr.includes('agentapi_unavailable') ||
      errStr.includes('target machine actively refused')
    );
  }

  /**
   * Resolves the profile ID associated with current environment or project
   */
  private static resolveProfileIdForEnv(cleanEnv: NodeJS.ProcessEnv, projectId?: string | null): string | undefined {
    if (projectId) {
      try {
        const apm = getAccountProfileManager();
        const prof = apm.getActiveProfileForProject(projectId);
        if (prof?.id) return prof.id;
      } catch {}
    }
    if (cleanEnv.USERPROFILE) {
      try {
        const rows: any[] = db.prepare('SELECT id, environment_path FROM account_profiles').all();
        const matched = rows.find(
          r => r.environment_path && r.environment_path.toLowerCase() === cleanEnv.USERPROFILE!.toLowerCase()
        );
        if (matched?.id) return matched.id;
      } catch {}
    }
    return undefined;
  }

  /**
   * Resolves the Language Server binary if allowed, or throws fail-closed error
   */
  static resolveLanguageServerExe(): string {
    if (this.isOfflineMode()) {
      throw new FailClosedGuardError(
        '[FAIL_CLOSED_GUARD] Acesso ao executável do Language Server bloqueado em modo offline/teste.'
      );
    }
    const discovery = AntigravityDiscovery.discover();
    if (discovery.available && discovery.languageServerExe) {
      return discovery.languageServerExe;
    }
    throw new Error(`Antigravity language_server.exe não encontrado no sistema: ${discovery.errorMessage}`);
  }

  private static sleepSync(ms: number): void {
    try {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
    } catch {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        /* busy wait fallback */
      }
    }
  }

  private static resolveProjectPath(projectId?: string | null): string | undefined {
    if (!projectId) return undefined;
    try {
      const row: any = db.prepare('SELECT path FROM projects WHERE id = ?').get(projectId);
      if (row?.path && fs.existsSync(row.path)) {
        return row.path;
      }
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "agentApiGateway",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:agentApiGateway]", err);
      }
    }
    return undefined;
  }

  /**
   * Helper to launch Antigravity GUI application if Language Server / Antigravity is not responding
   */
  static async launchAntigravityAppIfNeeded(projectPath?: string): Promise<boolean> {
    if (this.isOfflineMode()) return false;
    try {
      const apm = getAccountProfileManager();
      const live = typeof apm.findAnyLiveLanguageServerInstance === 'function'
        ? apm.findAnyLiveLanguageServerInstance()
        : null;
      if (!live) {
        Logger.info('[AgentApiGateway] Nenhuma instância ativa do Language Server detectada. Iniciando Antigravity GUI...');
        const launched = AntigravityDiscovery.launchAntigravityApp(projectPath);
        if (launched) {
          await new Promise(r => setTimeout(r, 1500));
          return true;
        }
      }
    } catch (err: any) {
      Logger.warn(`[AgentApiGateway] Falha ao verificar/iniciar Antigravity GUI: ${err?.message || err}`);
    }
    return false;
  }

  /**
   * Centralized creation of conversations through agentapi new-conversation
   * Enforces fail-closed guard, circuit breaker, and audit logging.
   */
  static async newConversation(options: {
    model: string;
    title: string;
    prompt: string;
    projectId?: string | null;
    role?: string | null;
    runId?: string | null;
    taskId?: string | null;
    origin?: 'RUNNER' | 'TEST' | 'CLI' | 'API';
    caller?: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
    cwd?: string;
  }): Promise<string> {
    const origin = options.origin || (this.isOfflineMode() ? 'TEST' : 'API');
    const caller = options.caller || 'AgentApiGateway';
    const projectId = options.projectId || null;
    const role = options.role || null;

    // 1. Check if mock provider is active
    if (this._mockProvider) {
      if (projectId) {
        const evaluation = SessionCircuitBreaker.evaluateCreation(projectId, role || 'UNKNOWN', {
          taskId: options.taskId,
          caller,
          runId: options.runId
        });

        if (!evaluation.allowed) {
          const reusableConvId = SessionCircuitBreaker.findReusableConversation(projectId, role || 'UNKNOWN');
          if (reusableConvId) {
            SessionCircuitBreaker.logTelemetry({
              event: 'SESSION_REUSED',
              origin: 'TEST',
              projectId,
              role,
              caller,
              runId: options.runId,
              taskId: options.taskId,
              conversationId: reusableConvId,
              reason: `Anti-Storm Fallback: Reutilizando conversa existente [${reusableConvId}] em vez de falhar com storm.`
            });

            return reusableConvId;
          }

          SessionCircuitBreaker.assertCanCreate({
            projectId,
            role: role || 'UNKNOWN',
            origin: 'TEST',
            caller,
            taskId: options.taskId,
            runId: options.runId
          });
        }
      }
      SessionCircuitBreaker.logTelemetry({
        event: 'AGENT_CONVERSATION_CREATE_ATTEMPT',
        origin: 'TEST',
        projectId,
        role,
        caller,
        runId: options.runId,
        taskId: options.taskId
      });
      ObservabilityService.emit({
        level: 'INFO',
        event: 'agent.native_call_started',
        message: `Iniciando criação de conversa simulada via Mock Provider: "${options.title}"`,
        service: 'gateway',
        runId: options.runId,
        taskId: options.taskId,
        projectId,
        metadata: { model: options.model, title: options.title, isMock: true, role }
      });
      const convId = await this._mockProvider.newConversation({
        model: options.model,
        title: options.title,
        prompt: options.prompt,
        projectId,
        role,
        cwd: options.cwd,
        env: options.env
      });

      SessionCircuitBreaker.logTelemetry({
        event: 'CREATE_SUCCESS',
        origin: 'TEST',
        projectId,
        role,
        caller,
        conversationId: convId,
        reason: `Conversa sintética criada via Mock Provider: "${options.title}"`
      });
      ObservabilityService.emit({
        level: 'INFO',
        event: 'agent.native_call_completed',
        message: `Conversa simulada criada com sucesso: "${options.title}" (${convId})`,
        service: 'gateway',
        runId: options.runId,
        taskId: options.taskId,
        projectId,
        conversationId: convId,
        status: 'success',
        metadata: { model: options.model, title: options.title, isMock: true, role }
      });

      return convId;
    }

    // 2. FAIL-CLOSED GUARD: if in offline mode with no mock, REJECT IMMEDIATELY!
    if (this.isOfflineMode()) {
      const msg = `[FAIL_CLOSED_GUARD] Execução real de agentapi new-conversation BLOQUEADA em modo offline/teste. Título: "${options.title}". Nenhuma chamada foi enviada ao Language Server.`;

      SessionCircuitBreaker.logTelemetry({
        event: 'LIVE_TEST_DENIED',
        origin,
        projectId,
        role,
        caller,
        reason: msg
      });

      SessionCircuitBreaker.logTelemetry({
        event: 'CREATE_BLOCKED',
        origin,
        projectId,
        role,
        caller,
        reason: msg
      });

      ObservabilityService.emit({
        level: 'WARN',
        event: 'agent.native_call_blocked',
        message: msg,
        service: 'gateway',
        runId: options.runId,
        taskId: options.taskId,
        projectId,
        status: 'blocked',
        metadata: { reason: 'FAIL_CLOSED_GUARD', title: options.title, role }
      });

      throw new FailClosedGuardError(msg);
    }

    // 3. PERSISTENT PROJECT TRUST & AUTONOMY AUTHORIZATION CHECK
    const authCheck = DevAutonomyService.isProjectAuthorizedForLiveExecution(projectId, caller);
    if (!authCheck.authorized) {
      const msg = `[AUTHORIZATION_GUARD] Chamada real ao Antigravity negada para projeto "${projectId || 'global'}": ${authCheck.reason}`;
      SessionCircuitBreaker.logTelemetry({
        event: 'CREATE_BLOCKED',
        origin,
        projectId,
        role,
        caller,
        reason: msg
      });
      ObservabilityService.emit({
        level: 'WARN',
        event: 'agent.native_call_blocked',
        message: msg,
        service: 'gateway',
        runId: options.runId,
        taskId: options.taskId,
        projectId,
        status: 'blocked',
        metadata: { reason: 'AUTHORIZATION_GUARD', authReason: authCheck.reason, title: options.title, role }
      });
      throw new FailClosedGuardError(msg);
    }

    NativeWorkspaceBinding.assertEnvironment(projectId, options.env, caller);

    // 4. LIVE MODE: Assert Circuit Breaker with Anti-Storm Fallback
    if (projectId) {
      const evaluation = SessionCircuitBreaker.evaluateCreation(projectId, role || 'UNKNOWN', {
        taskId: options.taskId,
        caller,
        runId: options.runId
      });

      if (!evaluation.allowed) {
        const reusableConvId = SessionCircuitBreaker.findReusableConversation(projectId, role || 'UNKNOWN');
        if (reusableConvId) {
          SessionCircuitBreaker.logTelemetry({
            event: 'SESSION_REUSED',
            origin,
            projectId,
            role,
            caller,
            runId: options.runId,
            taskId: options.taskId,
            conversationId: reusableConvId,
            reason: `Anti-Storm Fallback: Reutilizando conversa existente [${reusableConvId}] em vez de falhar com storm.`
          });

          return reusableConvId;
        }

        SessionCircuitBreaker.assertCanCreate({
          projectId,
          role: role || 'UNKNOWN',
          origin,
          caller,
          taskId: options.taskId,
          runId: options.runId
        });
      }
    }

    // 5. Execute physical agentapi new-conversation
    let resolvedCwd = options.cwd || this.resolveProjectPath(projectId);
    let nativeProjectId: string | null = options.env?.ANTIGRAVITY_PROJECT_ID || options.env?.PROJECT_ID || null;

    if (projectId) {
      try {
        const projectRow = db
          .prepare('SELECT id, path, name, active_account_profile_id FROM projects WHERE id = ?')
          .get(projectId) as any;
        if (projectRow) {
          if (projectRow.path) {
            resolvedCwd = path.resolve(projectRow.path);
          }
          const accountProfileId = projectRow.active_account_profile_id || 'google_pro_1';
          const userProfileDir = options.env?.USERPROFILE || process.env.USERPROFILE || os.homedir();
          const binding = NativeWorkspaceBinding.resolve(projectId, accountProfileId, userProfileDir, true);
          if (binding?.nativeProjectId) {
            nativeProjectId = binding.nativeProjectId;
          }
        }
      } catch (bindErr: any) {
        Logger.warn(`[AgentApiGateway] Aviso ao resolver vínculo nativo do workspace para newConversation: ${bindErr.message}`);
      }
    }

    if (!this.isOfflineMode()) {
      try {
        AntigravityDiscovery.ensureAntigravityRunning(resolvedCwd);
      } catch (agErr: any) {
        Logger.warn(`[AgentApiGateway] Aviso ao verificar/iniciar Antigravity Desktop: ${agErr.message}`);
      }
    }

    const exe = this.resolveLanguageServerExe();
    let cleanEnv = this.sanitizeEnv(options.env);
    if (!cleanEnv.ANTIGRAVITY_LS_ADDRESS && cleanEnv.USERPROFILE) {
      this.tryRefreshProfileConnectionEnv(cleanEnv, projectId);
    }
    if (cleanEnv.ANTIGRAVITY_LS_ADDRESS) {
      cleanEnv.USERPROFILE = process.env.USERPROFILE || os.homedir();
      cleanEnv.HOME = process.env.USERPROFILE || os.homedir();
      cleanEnv.APPDATA = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
      cleanEnv.LOCALAPPDATA = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    }

    if (nativeProjectId) {
      cleanEnv.ANTIGRAVITY_PROJECT_ID = nativeProjectId;
      cleanEnv.PROJECT_ID = nativeProjectId;
    }
    const cliModelFlag = this.normalizeCliModelFlag(options.model);
    const timeout = Math.min(options.timeoutMs || 15000, 15000);
    const startTime = Date.now();

    SessionCircuitBreaker.logTelemetry({
      event: 'AGENT_CONVERSATION_CREATE_ATTEMPT',
      origin,
      projectId,
      role,
      caller,
      runId: options.runId,
      taskId: options.taskId
    });

    ObservabilityService.emit({
      level: 'INFO',
      event: 'agent.native_call_started',
      message: `Disparando comando físico: agentapi new-conversation`,
      service: 'gateway',
      runId: options.runId,
      taskId: options.taskId,
      projectId,
      metadata: {
        model: options.model,
        cliModelFlag,
        title: options.title,
        isMock: false,
        role,
        nativeProjectId,
        timeoutMs: timeout
      }
    });

    await this.launchAntigravityAppIfNeeded(resolvedCwd);

    Logger.info(
      `[AgentApiGateway] Disparando comando físico: agentapi new-conversation (timeout: ${timeout}ms)...`
    );

    let currentExe = exe;
    const maxAttempts = 2;
    let lastErr: any;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const safePrompt = this.clampPromptForCli(options.prompt);
        // Sintaxe oficial do Antigravity 2.0: agentapi new-conversation [--project=<nativeProjectId>] [--model=<slug>] <prompt>
        const cliArgs = ['agentapi', 'new-conversation'];
        if (nativeProjectId) {
          cliArgs.push(`--project=${nativeProjectId}`);
        }
        if (cliModelFlag) {
          cliArgs.push(`--model=${cliModelFlag}`);
        }
        cliArgs.push(safePrompt);
        const out = await new Promise<string>((resolve, reject) => {
          execFile(
            currentExe,
            cliArgs,
            {
              env: cleanEnv,
              encoding: 'utf-8',
              timeout: 15000,
              windowsHide: true,
              cwd: resolvedCwd,
              maxBuffer: 10 * 1024 * 1024
            },
            (error, stdout, stderr) => {
              if (error) {
                (error as any).stdout = stdout;
                (error as any).stderr = stderr;
                return reject(error);
              }
              resolve(stdout);
            }
          );
        });

        let convId: string | null = null;
        try {
          const parsed = JSON.parse(out);
          convId = parsed?.response?.newConversation?.conversationId || parsed?.conversation_id || parsed?.conversationId || parsed?.id;
        } catch {
          const uuidMatch = String(out).match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i);
          if (uuidMatch) convId = uuidMatch[0];
        }

        if (!convId) {
          throw new Error(`Falha ao obter conversationId do output: ${out}`);
        }

        const durationMs = Date.now() - startTime;
        SessionCircuitBreaker.logTelemetry({
          event: 'CREATE_SUCCESS',
          origin,
          projectId,
          role,
          caller,
          conversationId: convId,
          reason: `Conversa real criada com sucesso no Antigravity: "${options.title}"`
        });

        ObservabilityService.emit({
          level: 'INFO',
          event: 'agent.native_call_completed',
          message: `Conversa real criada com sucesso no Antigravity: "${options.title}" (${convId})`,
          service: 'gateway',
          runId: options.runId,
          taskId: options.taskId,
          projectId,
          conversationId: convId,
          durationMs,
          status: 'success',
          metadata: { model: options.model, cliModelFlag, title: options.title, isMock: false, role }
        });

        return convId;
      } catch (err: any) {
        lastErr = err;
        const errStr = (err.stderr || err.stdout || err.message || '').toString();
        const apm = getAccountProfileManager();
        const classification = apm.classifyAccountOrQuotaError(errStr);
        if (classification.isAccountOrQuotaError && projectId) {
          try {
            const failover = apm.handleAccountFailureAndRapidSwitchSync({
              projectId,
              error: errStr
            });
            if (failover.switched) {
              Logger.info(`[AgentApiGateway] Auto-Failover com sucesso (${classification.kind}) para conta "${failover.activeProfile.display_name}". Retentando com nova conta...`);
              const newEnv = apm.getExecutionEnvForProfile(failover.activeProfile, projectId);
              cleanEnv = this.sanitizeEnv(newEnv);
              if (nativeProjectId) {
                cleanEnv.ANTIGRAVITY_PROJECT_ID = nativeProjectId;
                cleanEnv.PROJECT_ID = nativeProjectId;
              }
              continue;
            }
          } catch (failoverErr: any) {
            Logger.warn(`[AgentApiGateway] Auto-failover síncrono falhou: ${failoverErr.message}`);
          }
        }
        if (this.isQuotaOrCreditsError(errStr)) {
          throw new Error(`QUOTA_EXHAUSTED: ${errStr}`);
        }

        const isProjectNotFoundError =
          errStr.includes('not_found: project') ||
          (errStr.includes('project') && errStr.includes('not found'));

        if (isProjectNotFoundError && cleanEnv.ANTIGRAVITY_PROJECT_ID) {
          Logger.warn(
            `[AgentApiGateway] Projeto nativo "${cleanEnv.ANTIGRAVITY_PROJECT_ID}" não reconhecido pelo Language Server. Removendo ANTIGRAVITY_PROJECT_ID e retentando diretamente no diretório do projeto.`
          );
          delete cleanEnv.ANTIGRAVITY_PROJECT_ID;
          continue;
        }

        if (
          err instanceof FailClosedGuardError ||
          err.code === 'FAIL_CLOSED_GUARD' ||
          err.message?.includes('FAIL_CLOSED_GUARD') ||
          err.message?.includes('AUTHORIZATION_GUARD')
        ) {
          throw err;
        }

        if (this.isConnectionFailure(err)) {
          Logger.warn(
            `[AgentApiGateway] Conexão recusada ou perdida com Language Server em new-conversation (${err.message}). Auto-iniciando processo em 2º plano via RuntimeDaemonManager...`
          );
          try {
            const { RuntimeDaemonManager } = await import('./runtimeDaemonManager.js');
            const targetProfileId = this.resolveProfileIdForEnv(cleanEnv, projectId);
            const daemonRes = await RuntimeDaemonManager.ensureSingleRuntimeRunning(targetProfileId);
            if (daemonRes?.address && daemonRes?.csrfToken) {
              cleanEnv.ANTIGRAVITY_LS_ADDRESS = daemonRes.address;
              cleanEnv.ANTIGRAVITY_CSRF_TOKEN = daemonRes.csrfToken;
              process.env.ANTIGRAVITY_LS_ADDRESS = daemonRes.address;
              process.env.ANTIGRAVITY_CSRF_TOKEN = daemonRes.csrfToken;
              Logger.success(
                `[AgentApiGateway] Language Server reativado em 2º plano em ${daemonRes.address}. Retentando new-conversation transparente...`
              );
              continue;
            }
          } catch (daemonErr: any) {
            Logger.warn(`[AgentApiGateway] Falha ao auto-reativar Language Server em new-conversation: ${daemonErr.message}`);
          }
        }

        if (attempt < maxAttempts) {
          Logger.warn(
            `[AgentApiGateway] Tentativa ${attempt}/${maxAttempts} falhou para new-conversation (${err.message}). Retentando em 500ms...`
          );
          await new Promise(r => setTimeout(r, 500));
          try {
            const rediscovery = AntigravityDiscovery.discover({ forceRefresh: true });
            if (rediscovery.available && rediscovery.languageServerExe) {
              currentExe = rediscovery.languageServerExe;
            }
            this.tryRefreshProfileConnectionEnv(cleanEnv, projectId);
          } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "agentApiGateway",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:agentApiGateway]", err);
      }
    }
          continue;
        }
      }
    }

    // Fallback: se agentapi falhou ou não retornou UUID, tenta via agy CLI oficial
    try {
      const agyFallback = await this.runViaAgyCli(options.prompt, projectId || undefined, options.model);
      if (agyFallback?.conversation_id) {
        const convId = agyFallback.conversation_id;
        const durationMs = Date.now() - startTime;
        SessionCircuitBreaker.logTelemetry({
          event: 'CREATE_SUCCESS',
          origin,
          projectId,
          role,
          caller,
          conversationId: convId,
          reason: `Conversa real criada com sucesso no Antigravity via agy CLI fallback: "${options.title}"`
        });

        ObservabilityService.emit({
          level: 'INFO',
          event: 'agent.native_call_completed',
          message: `Conversa real criada com sucesso no Antigravity via agy CLI: "${options.title}" (${convId})`,
          service: 'gateway',
          runId: options.runId,
          taskId: options.taskId,
          projectId,
          conversationId: convId,
          durationMs,
          status: 'success',
          metadata: { model: options.model, title: options.title, isMock: false, role }
        });

        return convId;
      }
    } catch (agyErr: any) {
      Logger.warn(`[AgentApiGateway] Fallback via agy CLI falhou: ${agyErr.message}`);
    }

    const durationMs = Date.now() - startTime;
    SessionCircuitBreaker.logTelemetry({
      event: 'CREATE_BLOCKED',
      origin,
      projectId,
      role,
      caller,
      reason: `Erro na execução do CLI agentapi após ${maxAttempts} tentativas: ${lastErr?.message}`
    });

    ObservabilityService.emit({
      level: 'ERROR',
      event: 'agent.native_call_failed',
      message: `Erro na execução do CLI agentapi new-conversation após ${maxAttempts} tentativas: ${lastErr?.message}`,
      service: 'gateway',
      runId: options.runId,
      taskId: options.taskId,
      projectId,
      durationMs,
      status: 'failed',
      error: lastErr,
      metadata: { model: options.model, title: options.title, isMock: false, role }
    });

    throw lastErr;
  }

  /**
   * Auxiliary / Fallback helper to run via official Antigravity CLI (agy).
   * Locates agy binary and runs: agy -p <prompt> --output-format json --dangerously-skip-permissions
   */
  static async runViaAgyCli(prompt: string, projectId?: string, model?: string): Promise<{ conversation_id: string; response?: string } | null> {
    const isWin = process.platform === 'win32';
    const candidatePaths = [
      path.join(process.env.LOCALAPPDATA || '', 'agy', 'bin', isWin ? 'agy.exe' : 'agy'),
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'agy', 'bin', isWin ? 'agy.exe' : 'agy'),
      path.join(process.env.APPDATA || '', 'Antigravity', 'bin', 'agy-node.cmd'),
      path.join(os.homedir(), '.gemini', 'antigravity-cli', 'bin', isWin ? 'agy.exe' : 'agy')
    ];

    let agyBinary: string | null = null;
    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        agyBinary = p;
        break;
      }
    }

    if (!agyBinary && isWin) {
      try {
        const out = execFileSync('where.exe', ['agy'], { encoding: 'utf-8', timeout: 3000, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true }).trim();
        const firstLine = out.split(/\r?\n/)[0]?.trim();
        if (firstLine && fs.existsSync(firstLine)) agyBinary = firstLine;
      } catch {}
    }

    if (!agyBinary) {
      Logger.warn('[AgentApiGateway] agy CLI não encontrado no sistema para fallback.');
      return null;
    }

    try {
      const args = ['-p', prompt, '--output-format', 'json', '--dangerously-skip-permissions'];
      if (projectId) {
        args.push(`--project=${projectId}`);
      }
      if (model) {
        args.push(`--model=${model}`);
      }

      const env: NodeJS.ProcessEnv = {
        ...process.env,
        USERPROFILE: process.env.USERPROFILE || os.homedir(),
        HOME: process.env.USERPROFILE || os.homedir(),
        APPDATA: process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
        LOCALAPPDATA: process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
      };

      Logger.info(`[AgentApiGateway] Executando fallback via agy CLI: ${agyBinary} ${args.join(' ')}`);
      const out = await new Promise<string>((resolve, reject) => {
        execFile(
          agyBinary!,
          args,
          {
            encoding: 'utf-8',
            timeout: 30000,
            env,
            windowsHide: true,
            maxBuffer: 10 * 1024 * 1024
          },
          (error, stdout, stderr) => {
            if (error) {
              (error as any).stdout = stdout;
              (error as any).stderr = stderr;
              return reject(error);
            }
            resolve(stdout);
          }
        );
      });

      try {
        const parsed = JSON.parse(out);
        const conversation_id = parsed?.conversation_id || parsed?.conversationId || parsed?.id || parsed?.session_id;
        const response = parsed?.response || parsed?.text || parsed?.content || '';
        if (conversation_id) {
          return { conversation_id, response };
        }
      } catch {
        const uuidMatch = out.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i);
        if (uuidMatch) {
          return { conversation_id: uuidMatch[0], response: out };
        }
      }
    } catch (agyErr: any) {
      Logger.warn(`[AgentApiGateway] Falha ao executar via agy CLI: ${agyErr.message}`);
    }

    return null;
  }

  /**
   * Centralized sending of messages through agentapi send-message
   */
  static sendMessage(options: {
    conversationId: string;
    prompt: string;
    projectId?: string | null;
    role?: string | null;
    caller?: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
    cwd?: string;
  }): void {
    const caller = options.caller || 'AgentApiGateway';

    // 1. Check if mock provider is active
    if (this._mockProvider) {
      ObservabilityService.emit({
        level: 'INFO',
        event: 'agent.native_call_started',
        message: `Enviando mensagem na sessão simulada ${options.conversationId.slice(0, 8)}`,
        service: 'gateway',
        conversationId: options.conversationId,
        projectId: options.projectId,
        metadata: { isMock: true, role: options.role }
      });

      this._mockProvider.sendMessage({
        conversationId: options.conversationId,
        prompt: options.prompt,
        projectId: options.projectId,
        role: options.role
      });

      SessionCircuitBreaker.logTelemetry({
        event: 'SESSION_REUSED',
        origin: 'TEST',
        projectId: options.projectId,
        role: options.role,
        caller,
        conversationId: options.conversationId,
        reason: `Mensagem enviada com sucesso na sessão simulada ${options.conversationId.slice(0, 8)}`
      });

      ObservabilityService.emit({
        level: 'INFO',
        event: 'agent.native_call_completed',
        message: `Mensagem enviada com sucesso na sessão simulada ${options.conversationId.slice(0, 8)}`,
        service: 'gateway',
        conversationId: options.conversationId,
        projectId: options.projectId,
        status: 'success',
        metadata: { isMock: true, role: options.role }
      });

      return;
    }

    // 2. FAIL-CLOSED GUARD
    if (this.isOfflineMode()) {
      const msg = `[FAIL_CLOSED_GUARD] Execução real de agentapi send-message BLOQUEADA em modo offline/teste para conv ${options.conversationId}.`;
      SessionCircuitBreaker.logTelemetry({
        event: 'LIVE_TEST_DENIED',
        origin: 'TEST',
        projectId: options.projectId,
        role: options.role,
        caller,
        conversationId: options.conversationId,
        reason: msg
      });
      ObservabilityService.emit({
        level: 'WARN',
        event: 'agent.native_call_blocked',
        message: msg,
        service: 'gateway',
        conversationId: options.conversationId,
        projectId: options.projectId,
        status: 'blocked',
        metadata: { reason: 'FAIL_CLOSED_GUARD', role: options.role }
      });
      throw new FailClosedGuardError(msg);
    }

    // 3. PERSISTENT PROJECT TRUST & AUTONOMY AUTHORIZATION CHECK
    const authCheck = DevAutonomyService.isProjectAuthorizedForLiveExecution(options.projectId, caller);
    if (!authCheck.authorized) {
      const msg = `[AUTHORIZATION_GUARD] Envio de mensagem real negado para projeto "${options.projectId || 'global'}": ${authCheck.reason}`;
      SessionCircuitBreaker.logTelemetry({
        event: 'LIVE_TEST_DENIED',
        origin: 'API',
        projectId: options.projectId,
        role: options.role,
        caller,
        conversationId: options.conversationId,
        reason: msg
      });
      ObservabilityService.emit({
        level: 'WARN',
        event: 'agent.native_call_blocked',
        message: msg,
        service: 'gateway',
        conversationId: options.conversationId,
        projectId: options.projectId,
        status: 'blocked',
        metadata: { reason: 'AUTHORIZATION_GUARD', authReason: authCheck.reason, role: options.role }
      });
      throw new FailClosedGuardError(msg);
    }

    NativeWorkspaceBinding.assertEnvironment(options.projectId || null, options.env, caller);

    // 4. LIVE MODE: Execute physical agentapi send-message
    const exe = this.resolveLanguageServerExe();
    let cleanEnv = this.sanitizeEnv(options.env);
    if (!cleanEnv.ANTIGRAVITY_LS_ADDRESS && cleanEnv.USERPROFILE) {
      this.tryRefreshProfileConnectionEnv(cleanEnv, options.projectId);
    }
    if (cleanEnv.ANTIGRAVITY_LS_ADDRESS) {
      cleanEnv.USERPROFILE = process.env.USERPROFILE || os.homedir();
      cleanEnv.HOME = process.env.USERPROFILE || os.homedir();
      cleanEnv.APPDATA = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
      cleanEnv.LOCALAPPDATA = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    }
    const timeout = options.timeoutMs || 45000;
    const startTime = Date.now();

    ObservabilityService.emit({
      level: 'INFO',
      event: 'agent.native_call_started',
      message: `Enviando mensagem física via agentapi send-message (${options.conversationId.slice(0, 8)})`,
      service: 'gateway',
      conversationId: options.conversationId,
      projectId: options.projectId,
      metadata: { isMock: false, role: options.role, timeoutMs: timeout }
    });

    let currentExe = exe;
    const maxAttempts = 3;
    let lastErr: any;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const safePrompt = this.clampPromptForCli(options.prompt, options.conversationId);
        const resolvedCwd = options.cwd || this.resolveProjectPath(options.projectId);
        execFileSync(currentExe, ['agentapi', 'send-message', options.conversationId, safePrompt], {
          encoding: 'utf-8',
          timeout,
          env: cleanEnv,
          cwd: resolvedCwd,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe']
        });

        const durationMs = Date.now() - startTime;
        SessionCircuitBreaker.logTelemetry({
          event: 'SESSION_REUSED',
          origin: 'API',
          projectId: options.projectId,
          role: options.role,
          caller,
          conversationId: options.conversationId,
          reason: `Sessão física ${options.conversationId.slice(0, 8)} reutilizada com sucesso via send-message.`
        });

        ObservabilityService.emit({
          level: 'INFO',
          event: 'agent.native_call_completed',
          message: `Mensagem física enviada com sucesso via agentapi send-message (${options.conversationId.slice(0, 8)})`,
          service: 'gateway',
          conversationId: options.conversationId,
          projectId: options.projectId,
          durationMs,
          status: 'success',
          metadata: { isMock: false, role: options.role }
        });
        return;
      } catch (err: any) {
        lastErr = err;
        const errStr = (err.stderr || err.stdout || err.message || '').toString();
        const apm = getAccountProfileManager();
        const classification = apm.classifyAccountOrQuotaError(errStr);
        if (classification.isAccountOrQuotaError && options.projectId) {
          try {
            const failover = apm.handleAccountFailureAndRapidSwitchSync({
              projectId: options.projectId,
              error: errStr
            });
            if (failover.switched) {
              Logger.info(`[AgentApiGateway] Auto-Failover com sucesso (${classification.kind}) para conta "${failover.activeProfile.display_name}". Retentando send-message com nova conta...`);
              const newEnv = apm.getExecutionEnvForProfile(failover.activeProfile, options.projectId);
              cleanEnv = this.sanitizeEnv(newEnv);
              continue;
            }
          } catch (failoverErr: any) {
            Logger.warn(`[AgentApiGateway] Auto-failover síncrono falhou: ${failoverErr.message}`);
          }
        }
        if (this.isQuotaOrCreditsError(errStr)) {
          throw new Error(`QUOTA_EXHAUSTED: ${errStr}`);
        }

        const isProjectNotFoundError =
          errStr.includes('not_found: project') ||
          (errStr.includes('project') && errStr.includes('not found'));

        if (isProjectNotFoundError && cleanEnv.ANTIGRAVITY_PROJECT_ID) {
          Logger.warn(
            `[AgentApiGateway] Projeto nativo "${cleanEnv.ANTIGRAVITY_PROJECT_ID}" não reconhecido pelo Language Server. Removendo ANTIGRAVITY_PROJECT_ID e retentando diretamente no diretório do projeto.`
          );
          delete cleanEnv.ANTIGRAVITY_PROJECT_ID;
          continue;
        }

        if (
          err instanceof FailClosedGuardError ||
          err.code === 'FAIL_CLOSED_GUARD' ||
          err.message?.includes('FAIL_CLOSED_GUARD') ||
          err.message?.includes('AUTHORIZATION_GUARD')
        ) {
          throw err;
        }

        if (this.isConnectionFailure(err)) {
          Logger.warn(
            `[AgentApiGateway] Conexão recusada ou perdida com Language Server em send-message (${err.message}). Auto-iniciando processo em 2º plano via RuntimeDaemonManager...`
          );
          try {
            const { RuntimeDaemonManager } = require('./runtimeDaemonManager.js');
            const targetProfileId = this.resolveProfileIdForEnv(cleanEnv, options.projectId);
            const daemonRes = RuntimeDaemonManager.ensureSingleRuntimeRunningSync(targetProfileId);
            if (daemonRes?.address && daemonRes?.csrfToken) {
              cleanEnv.ANTIGRAVITY_LS_ADDRESS = daemonRes.address;
              cleanEnv.ANTIGRAVITY_CSRF_TOKEN = daemonRes.csrfToken;
              process.env.ANTIGRAVITY_LS_ADDRESS = daemonRes.address;
              process.env.ANTIGRAVITY_CSRF_TOKEN = daemonRes.csrfToken;
              Logger.success(
                `[AgentApiGateway] Language Server reativado em 2º plano em ${daemonRes.address}. Retentando send-message transparente...`
              );
              continue;
            }
          } catch (daemonErr: any) {
            Logger.warn(`[AgentApiGateway] Falha ao auto-reativar Language Server em send-message: ${daemonErr.message}`);
          }
        }

        if (attempt < maxAttempts) {
          Logger.warn(
            `[AgentApiGateway] Tentativa ${attempt}/${maxAttempts} falhou para send-message (${err.message}). Retentando em 500ms...`
          );
          this.sleepSync(500);
          try {
            const rediscovery = AntigravityDiscovery.discover({ forceRefresh: true });
            if (rediscovery.available && rediscovery.languageServerExe) {
              currentExe = rediscovery.languageServerExe;
            }
            this.tryRefreshProfileConnectionEnv(cleanEnv, options.projectId);
          } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "agentApiGateway",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:agentApiGateway]", err);
      }
    }
          continue;
        }
      }
    }

    const durationMs = Date.now() - startTime;
    ObservabilityService.emit({
      level: 'ERROR',
      event: 'agent.native_call_failed',
      message: `Erro ao enviar mensagem física via agentapi send-message após ${maxAttempts} tentativas: ${lastErr?.message}`,
      service: 'gateway',
      conversationId: options.conversationId,
      projectId: options.projectId,
      durationMs,
      status: 'failed',
      error: lastErr,
      metadata: { isMock: false, role: options.role }
    });
    throw lastErr;
  }

  /**
   * Sanitizes and clamps prompt text to stay safely within OS command-line argument limits
   * (Windows lpCommandLine max 32,767 chars) and strips null/control bytes per Antigravity SDK 0.1.8 guidelines.
   * Employs smart middle-truncation: 100% preserves Camada A Core Invariants (head) and Camada C Task Contract (tail).
   */
  public static clampPromptForCli(prompt: string, conversationId?: string): string {
    if (!prompt) return '';
    // Strip null bytes (\x00) and non-printable control characters (excluding \t, \n, \r)
    const sanitized = prompt.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

    const MAX_PROMPT_CHARS = process.platform === 'win32' ? 28000 : 100000;
    if (sanitized.length <= MAX_PROMPT_CHARS) return sanitized;

    ObservabilityService.emit({
      level: 'WARN',
      event: 'agent.prompt_clamped',
      message: `Prompt excede o limite de argumentos do sistema operacional (${sanitized.length} > ${MAX_PROMPT_CHARS}). Truncando de forma segura preservando início e instruções finais.`,
      service: 'gateway',
      conversationId: conversationId || undefined,
      metadata: { originalLength: sanitized.length, clampedLength: MAX_PROMPT_CHARS }
    });

    Logger.warn(
      `[AgentApiGateway] Prompt de ${sanitized.length} caracteres excede limite do SO (${MAX_PROMPT_CHARS}). Truncado com segurança preservando regras e critérios finais.`
    );

    const notice = `\n\n[... AVISO: Conteúdo intermediário compactado defensivamente (${sanitized.length} -> ${MAX_PROMPT_CHARS} chars) para conformidade com limite de argumentos do SO ...]\n\n`;
    const preserveTailChars = 7000;
    const headChars = Math.max(1000, MAX_PROMPT_CHARS - preserveTailChars - notice.length);

    return sanitized.slice(0, headChars) + notice + sanitized.slice(-preserveTailChars);
  }

  /**
   * Retrieves conversation metadata (used for liveness checks and model verification)
   */
  static getConversationMetadata(conversationId: string, env?: NodeJS.ProcessEnv): any {
    if (this._mockProvider) {
      return this._mockProvider.getConversationMetadata(conversationId);
    }

    if (this.isOfflineMode()) {
      return {
        rootConversationId: conversationId,
        status: 'OFFLINE_MOCK_ACTIVE'
      };
    }

    const exe = this.resolveLanguageServerExe();
    const cleanEnv = this.sanitizeEnv(env);
    const output = execFileSync(exe, ['agentapi', 'get-conversation-metadata', conversationId], {
      encoding: 'utf-8',
      timeout: 8000,
      env: cleanEnv,
      windowsHide: true
    });
    const parsed = JSON.parse(output);
    return parsed?.response?.conversationMetadata?.metadata;
  }
}