import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { BuilderToSupervisorContract, SupervisorReviewContract } from './agentProvider.js';
import { getLanguageServerExe } from './antigravityProvider.js';
import { AgentApiGateway } from './agentApiGateway.js';
import { Logger } from './logger.js';
import { getGlobalAgentGuidelines, validateSurgicalDiff } from './agentGuidelines.js';
import { EvaluationResult } from './independentEvaluator.js';
import { PromptArchitectureService, SupervisorMode } from './promptArchitectureService.js';
import { ProjectAnalyzer } from './analyzer.js';
import { GitManager } from './gitManager.js';
import { normalizeOrRecoverVerificationCommand, NormalizedVerificationCommandResult } from './verificationCommand.js';
import { DagAutoHealer } from './dagAutoHealer.js';

export interface PlannedTask {
  id?: string;
  code?: string;
  majorTaskCode?: string;
  majorTaskTitle?: string;
  stageCode?: string;
  stageTitle?: string;
  requirementIds?: string[];
  allowedScope?: string[];
  title: string;
  description: string;
  milestone: string;
  orderIndex: number;
  dependencies: string[];
  criteria: string[];
  verificationCommand?: string;
  verificationCommandMeta?: NormalizedVerificationCommandResult;
  doneWhen?: string;
  expectedFiles?: string[];
  expectedScopeFiles?: string[];
  skillRouted?: string;
  skillConfidence?: number;
  skillGuidelines?: string[];
}

export class GeminiSupervisorProvider {
  private exePath: string;
  private appDataBrainDir: string;
  private model: 'flash' | 'pro' | 'flash_lite';

  private env?: NodeJS.ProcessEnv;
  private lastConversationId: string | null = null;
  private accountProfileId?: string;
  private projectId?: string;
  private intelligenceLevel: 'HIGH' | 'MEDIUM' | 'LOW';

  constructor(
    model: 'flash' | 'pro' | 'flash_lite' = 'flash',
    env?: NodeJS.ProcessEnv,
    accountProfileId?: string,
    projectId?: string,
    intelligenceLevel: 'HIGH' | 'MEDIUM' | 'LOW' = 'HIGH'
  ) {
    try {
      this.exePath = getLanguageServerExe();
    } catch {
      this.exePath = '';
    }
    this.appDataBrainDir = path.join(env?.USERPROFILE || process.env.USERPROFILE || '', '.gemini', 'antigravity', 'brain');
    this.model = model;
    this.env = env;
    this.accountProfileId = accountProfileId;
    this.projectId = projectId;
    this.intelligenceLevel = intelligenceLevel;
  }

  getExecutionEvidence() {
    let actualModel: string | null = null;
    if (this.lastConversationId) {
      if (AgentApiGateway.isOfflineMode() || !this.exePath) {
        actualModel = this.model;
      } else {
        try {
          const output = execFileSync(this.exePath, ['agentapi', 'get-conversation-metadata', this.lastConversationId], {
            encoding: 'utf-8', timeout: 10000, env: this.env
          });
          const metadata = JSON.parse(output)?.response?.conversationMetadata?.metadata;
          if (metadata?.rootConversationId === this.lastConversationId) {
            actualModel = metadata?.staticConfig?.cascadeConfig?.plannerConfig?.planModel || null;
          }
        } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "geminiSupervisorProvider",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:geminiSupervisorProvider]", err);
      }
    }
      }
    }
    return {
      conversationId: this.lastConversationId,
      requestedModel: this.model,
      requestedIntelligence: this.intelligenceLevel,
      actualModel,
      actualModelVerified: false,
      fallbackReason: actualModel ? 'RUNTIME_MODEL_ID_UNMAPPED' : 'ACTUAL_MODEL_UNAVAILABLE'
    };
  }

  /**
   * Helper to inspect the latest step_index in a conversation transcript before dispatching a new prompt
   */
  private getLatestTranscriptStepIndex(conversationId: string | null | undefined): number {
    if (!conversationId) return -1;
    const activeTranscriptPath = path.join(this.appDataBrainDir, conversationId, '.system_generated', 'logs', 'transcript.jsonl');
    if (!fs.existsSync(activeTranscriptPath)) return -1;
    try {
      const lines = fs.readFileSync(activeTranscriptPath, 'utf-8').trim().split('\n').filter(Boolean);
      for (let i = lines.length - 1; i >= 0; i--) {
        const entry = JSON.parse(lines[i]);
        if (typeof entry.step_index === 'number') {
          return entry.step_index;
        }
      }
    } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "geminiSupervisorProvider",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:geminiSupervisorProvider]", err);
      }
    }
    return -1;
  }

  /**
   * Resolves DOCSIMP, DesignSkills, and ReaSaaSMaster context blocks once per planning cycle
   */
  private async resolveContextualSkillBlocks(
    briefing: string,
    projectPath: string,
    projectName = 'Projeto',
    requirements?: string[]
  ): Promise<{
    docSimpContextBlock: string;
    designSkillContextBlock: string;
    reaSaaSMasterContextBlock: string;
    marketDiscoveryContextBlock: string;
    livingSpecContextBlock: string;
  }> {
    let docSimpContextBlock = '';
    try {
      const { DocSimpService } = await import('./docSimpService.js');
      const docSimpRes = await DocSimpService.resolveDocsForBriefing(briefing, projectPath);
      docSimpContextBlock = docSimpRes.contextBlock;
    } catch (err: any) {
      Logger.warn(`[GeminiSupervisor] Falha não bloqueante ao resolver DOCSIMP: ${err.message}`);
    }

    let designSkillContextBlock = '';
    try {
      const { DesignSkillService } = await import('./designSkillService.js');
      if (DesignSkillService.isUiOrFrontendTask(briefing)) {
        const designRes = await DesignSkillService.provisionDesignSkillsForProject(briefing, projectPath);
        designSkillContextBlock = designRes.directiveBlock;
      }
    } catch (err: any) {
      Logger.warn(`[GeminiSupervisor] Falha não bloqueante ao resolver DesignSkills: ${err.message}`);
    }

    let reaSaaSMasterContextBlock = '';
    const { ReaSaaSMasterService } = await import('./reaSaaSMasterService.js');
    try {
      if (ReaSaaSMasterService.isSaaSOrFullStackProject(briefing)) {
        const reaRes = await ReaSaaSMasterService.provisionReaBlueprintForProject(projectPath, briefing);
        reaSaaSMasterContextBlock = reaRes.directive;
      }
    } catch (err: any) {
      Logger.warn(`[GeminiSupervisor] Falha não bloqueante ao resolver ReaSaaSMaster: ${err.message}`);
    }

    let marketDiscoveryContextBlock = '';
    let livingSpecContextBlock = '';
    const isSaaSOrSpec = ReaSaaSMasterService.isSaaSOrFullStackProject(briefing) ||
      (projectPath ? fs.existsSync(path.join(path.resolve(projectPath), '.ai-dev-hub', 'specs', 'CONTEUDO.md')) : false);

    if (isSaaSOrSpec) {
      try {
        const { MarketDiscoveryService } = await import('./marketDiscoveryService.js');
        const discovery = await MarketDiscoveryService.conductPreBlueprintDiscovery({
          briefing,
          projectName,
          projectPath,
          model: this.model
        });
        marketDiscoveryContextBlock = discovery.compactDiscoveryBlock;
      } catch (err: any) {
        Logger.warn(`[GeminiSupervisor] Falha não bloqueante na Onda 0 (Market Discovery): ${err.message}`);
      }

      try {
        const { ProjectLivingSpecService } = await import('./projectLivingSpecService.js');
        await ProjectLivingSpecService.generateAndPersistLivingSpecs({
          briefing,
          projectName,
          projectPath,
          requirements,
          model: this.model
        });
        livingSpecContextBlock = ProjectLivingSpecService.getRoleSpecificSpecContext(projectPath, 'SUPERVISOR_BLUEPRINT');
      } catch (err: any) {
        Logger.warn(`[GeminiSupervisor] Falha não bloqueante na geração de Living Specs: ${err.message}`);
      }
    }

    return {
      docSimpContextBlock,
      designSkillContextBlock,
      reaSaaSMasterContextBlock,
      marketDiscoveryContextBlock,
      livingSpecContextBlock
    };
  }

  /**
   * FASE 20: Filters and specializes contextual skill blocks for a specific Major Task.
   * Pure backend, infra, or database tasks (GT-1 to GT-4) omit CSS/design tokens,
   * saving context budget and directing the model with domain-specific invariants.
   */
  static filterSkillBlocksForMajorTask(
    majorTask: {
      code?: string;
      title?: string;
      objective?: string;
      expectedOutcome?: string;
    },
    preResolvedBlocks?: {
      docSimpContextBlock?: string;
      designSkillContextBlock?: string;
      reaSaaSMasterContextBlock?: string;
      marketDiscoveryContextBlock?: string;
      livingSpecContextBlock?: string;
    }
  ): {
    docSimpContextBlock: string;
    designSkillContextBlock: string;
    reaSaaSMasterContextBlock: string;
    marketDiscoveryContextBlock: string;
    livingSpecContextBlock: string;
  } {
    const docSimp = preResolvedBlocks?.docSimpContextBlock || '';
    const design = preResolvedBlocks?.designSkillContextBlock || '';
    const rea = preResolvedBlocks?.reaSaaSMasterContextBlock || '';
    const market = preResolvedBlocks?.marketDiscoveryContextBlock || '';
    const livingSpec = preResolvedBlocks?.livingSpecContextBlock || '';

    const text = [
      majorTask.code || '',
      majorTask.title || '',
      majorTask.objective || '',
      majorTask.expectedOutcome || ''
    ].join(' ').toLowerCase();

    // Check if task is explicit UI / Frontend / SaaS Master / Visual
    const isUiTask =
      /(gt[-_]?(5|6)|interface|frontend|front-end|\bui\b|\bux\b|dashboard|layout|css|html|drawer|tela|componente visual|svg|lucide|command palette|tabular-nums)/i.test(text);

    // If pure infrastructure, database, domain or backend (GT-1 to GT-4 and no UI terms)
    if (!isUiTask) {
      // Filter reaSaaSMasterContextBlock to retain only Backend / Seed / Audit pillars
      let backendReaBlock = '';
      if (rea) {
        const lines = rea.split('\n');
        const relevantLines: string[] = [];
        let inBackendPillar = false;

        for (const line of lines) {
          if (/=== FIM/i.test(line)) {
            inBackendPillar = false;
            relevantLines.push(line);
            continue;
          }
          if (/===.*?===/i.test(line)) {
            relevantLines.push(line);
            continue;
          }
          if (/pilar\s*(2|3|5|7)|backend|sqlite|banco|seed|audit|dados|persist|api|rest/i.test(line)) {
            inBackendPillar = true;
          } else if (/pilar\s*(1|4|6)|app\s+shell|command\s+palette|drawer|slide-over|data-?grid|bi\s+chart|gr[aá]fico|layout/i.test(line)) {
            inBackendPillar = false;
          }
          if (inBackendPillar) {
            relevantLines.push(line);
          }
        }
        backendReaBlock = relevantLines.join('\n').trim();
        if (!backendReaBlock || backendReaBlock.length < 60) {
          backendReaBlock = [
            `=== DIRETRIZES SAAS MASTER DE BACKEND, PERSISTÊNCIA & AUDITORIA ===`,
            `- Persistência SQLite 100% parametrizada (?) com seedIfEmpty() populando 15-30 registros realistas no boot.`,
            `- Tabela audit_logs obrigatória registrando id, timestamp, action, entity e details_json.`,
            `- PORT_GUARD 4000-4999 e rotas REST consistentes rejeitando valores negativos ou NaN com HTTP 400.`,
            `=== FIM DAS DIRETRIZES DE BACKEND ===`
          ].join('\n');
        }
      }

      return {
        docSimpContextBlock: docSimp,
        designSkillContextBlock: '', // OMITTED to prevent CSS pollution and save ~1.500 chars
        reaSaaSMasterContextBlock: backendReaBlock,
        marketDiscoveryContextBlock: market,
        livingSpecContextBlock: livingSpec
      };
    }

    // UI / Frontend / SaaS Master tasks receive 100% of design and SaaS master blocks
    return {
      docSimpContextBlock: docSimp,
      designSkillContextBlock: design,
      reaSaaSMasterContextBlock: rea,
      marketDiscoveryContextBlock: market,
      livingSpecContextBlock: livingSpec
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
      multiPass?: boolean;
      deepPlanning?: boolean;
      requirements?: string[];
      retryAfterFailover?: boolean;
    }
  ): Promise<PlannedTask[]> {
    const isExplicitMultiPass = options?.multiPass === true || options?.deepPlanning === true;
    const isMultiPassDisabled = options?.multiPass === false;
    const isInitialPlanMode = options?.mode === 'INITIAL_PLAN' || !options?.mode;
    const { ReaSaaSMasterService } = await import('./reaSaaSMasterService.js');
    const isSubstantialBriefing = Boolean(
      (briefing && briefing.trim().length >= 40) ||
      (briefing && ReaSaaSMasterService.isSaaSOrFullStackProject(briefing))
    );

    if (options?.mode === 'DELTA_EVOLUTION') {
      const { DeltaFeatureEngine } = await import('./deltaFeatureEngine.js');
      const inventory = DeltaFeatureEngine.scanProjectInventory(projectContext.path, projectContext.id);
      if (AgentApiGateway.isOfflineMode() || !this.exePath) {
        return DeltaFeatureEngine.planDeltaEvolution({ briefing, projectContext, inventory, runId: options?.runId });
      }
    }

    if (options?.mode !== 'DELTA_EVOLUTION' && !isMultiPassDisabled && (isExplicitMultiPass || (isInitialPlanMode && isSubstantialBriefing))) {
      return this.planTwoPassHierarchy(briefing, projectContext, options);
    }

    const mode: SupervisorMode = options?.mode || 'INITIAL_PLAN';
    Logger.info(`[GeminiSupervisor] Planejando arquitetura e tarefas com modelo Gemini (${this.model}) no modo [${mode}]...`);

    let existingMemorySnippet = '';
    let constitutionSnippet = '';
    try {
      const { MemoryManager } = await import('./memoryManager.js');
      const memory = MemoryManager.readMemoryFiles(projectContext.path);
      const parsed = MemoryManager.parseTasks(memory.tasksMd);
      const doneList = parsed.done;
      if (doneList.length > 0) {
        existingMemorySnippet = `TAREFAS ANTERIORES JÁ PRONTAS (PRESERVAR): ${doneList.join(' | ')}. Construa novas tarefas adicionais incrementais sem refazer o que já existe.`;
      }
      if (memory.decisionsMd) {
        existingMemorySnippet += ` DECISÕES TÉCNICAS A RESPEITAR: ${memory.decisionsMd}.`;
      }
      if (memory.programMd) {
        constitutionSnippet = memory.programMd;
      }
      existingMemorySnippet += `\nARQUITETURA: ${memory.architectureMd || ''}\nGIT: ${JSON.stringify(GitManager.getGitInfo(projectContext.path))}\nARQUIVOS E STACK: ${JSON.stringify(ProjectAnalyzer.analyze(projectContext.path))}`;
      const { EngineeringContextService } = await import('./engineeringContextService.js');
      const lessonsBlock = EngineeringContextService.selectRelevantLessons(this.projectId || projectContext.id, projectContext.path, briefing.split(/\s+/), 1200);
      if (lessonsBlock) {
        existingMemorySnippet += `\nLIÇÕES OPERACIONAIS APRENDIDAS (NÃO REPETIR FALHAS ANTERIORES):\n${lessonsBlock}`;
      }
    } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "geminiSupervisorProvider",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:geminiSupervisorProvider]", err);
      }
    }

    const {
      docSimpContextBlock,
      designSkillContextBlock,
      reaSaaSMasterContextBlock,
      marketDiscoveryContextBlock,
      livingSpecContextBlock
    } = await this.resolveContextualSkillBlocks(briefing, projectContext.path, projectContext.name, options?.requirements);

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
      docSimpContextBlock,
      designSkillContextBlock,
      reaSaaSMasterContextBlock,
      marketDiscoveryContextBlock,
      livingSpecContextBlock,
      completedTasks: options?.completedTasks,
      pendingTasks: options?.pendingTasks,
      replanReason: options?.replanReason
    });

    try {
      const { AgentSessionManager } = await import('./agentSessionManager.js');
      const { ConversationManager } = await import('./conversationManager.js');
      let conversationId = this.lastConversationId;
      const sessionProjectId = this.projectId;
      let minStepIndex = -1;

      if (sessionProjectId) {
        const { session, isNew } = await AgentSessionManager.getOrCreateAgentSession(sessionProjectId, 'SUPERVISOR', {
          model: this.model,
          env: this.env,
          initialPrompt: prompt,
          accountProfileId: this.accountProfileId
        });
        conversationId = session.provider_conversation_id;

        if (!isNew) {
          const rotationCheck = AgentSessionManager.checkContextRotationPolicy(session, this.appDataBrainDir);
          if (rotationCheck.shouldRotate) {
            Logger.info(`[GeminiSupervisor] Rotação de contexto acionada para Supervisor no projeto ${sessionProjectId}. Motivo: ${rotationCheck.reason}`);
            const { newSession } = await AgentSessionManager.rotateSession(sessionProjectId, 'SUPERVISOR', rotationCheck.reason || 'CONTEXT_LIMIT_REACHED', {
              model: this.model,
              env: this.env
            });
            conversationId = newSession.provider_conversation_id;
            await AgentSessionManager.sendMessage(newSession, prompt, {
              env: this.env,
              taskTitle: 'Planejamento de Tarefas (Pós-Rotação)'
            });
          } else {
            minStepIndex = this.getLatestTranscriptStepIndex(conversationId);
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
          minStepIndex = this.getLatestTranscriptStepIndex(conversationId);
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
        conversationId = AgentApiGateway.newConversation({
          model: this.model,
          title: `DecoHUB — Supervisor`,
          prompt,
          projectId: this.projectId,
          role: 'supervisor',
          caller: 'GeminiSupervisorProvider.createPlan',
          env: this.env
        });
      } else {
        minStepIndex = this.getLatestTranscriptStepIndex(conversationId);
        AgentApiGateway.sendMessage({
          conversationId,
          prompt,
          projectId: this.projectId,
          role: 'supervisor',
          caller: 'GeminiSupervisorProvider.createPlan',
          env: this.env
        });
      }

      if (!conversationId) {
        throw new Error('Falha ao iniciar sessão de planejamento com Gemini');
      }
      this.lastConversationId = conversationId;

      const responseText = await this.waitForResponse(conversationId, 180000, minStepIndex, 'PLAN');
      const rawTasks = this.extractJsonArray<PlannedTask>(responseText);

      if (rawTasks && Array.isArray(rawTasks) && rawTasks.length > 0) {
        const sanitizedTasks: PlannedTask[] = [];
        let droppedCount = 0;
        rawTasks.forEach((raw, idx) => {
          const repaired = GeminiSupervisorProvider.sanitizeAndRepairPlannedTask(raw, projectContext.path || '.', idx + 1);
          if (repaired) {
            sanitizedTasks.push(repaired);
          } else {
            droppedCount++;
          }
        });

        if (sanitizedTasks.length > 0) {
          if (droppedCount > 0) {
            Logger.warn(
              `[GeminiSupervisor] Resposta continha ${droppedCount} tarefa(s) irrecuperáveis que foram descartadas. ${sanitizedTasks.length} tarefas reparadas e preservadas.`
            );
          }
          Logger.success(
            `[GeminiSupervisor] Gemini planejou com sucesso ${sanitizedTasks.length} tarefas estruturadas! (Modo: ${mode}, Versão: ${meta.version})`
          );
          return GeminiSupervisorProvider.validateAndRefinePlanQuality(sanitizedTasks, options?.completedTasks);
        }
        Logger.warn(`[GeminiSupervisor] Nenhuma tarefa válida pôde ser recuperada das ${rawTasks.length} tarefas brutas.`);
      }
    } catch (err: any) {
      if (!options?.retryAfterFailover) {
        try {
          const { AccountProfileManager } = await import('./accountProfileManager.js');
          const classification = AccountProfileManager.classifyAccountOrQuotaError(err);
          if (classification.isAccountOrQuotaError) {
            Logger.warn(`[GeminiSupervisor] Erro de conta/cota detectado durante planejamento (${classification.kind}): ${classification.reason}. Tentando Auto-Failover...`);
            const failoverRes = await AccountProfileManager.handleAccountFailureAndRapidSwitch({
              failedProfileId: this.accountProfileId,
              projectId: this.projectId || projectContext.id,
              runId: options?.runId,
              error: err
            });
            if (failoverRes.switched) {
              this.accountProfileId = failoverRes.activeProfile.id;
              this.env = AccountProfileManager.getExecutionEnvForProfile(failoverRes.activeProfile, this.projectId || projectContext.id);
              Logger.info(`[GeminiSupervisor] Auto-Failover concluído com sucesso. Retentando planejamento com nova conta "${failoverRes.activeProfile.display_name}"...`);
              return this.planTasks(briefing, projectContext, { ...options, retryAfterFailover: true });
            }
          }
        } catch (failoverErr: any) {
          Logger.warn(`[GeminiSupervisor] Falha no Auto-Failover de planejamento: ${failoverErr.message}`);
        }
      }
      if (mode === 'DELTA_EVOLUTION') {
        Logger.warn(`[GeminiSupervisor] Usando fallback resiliente do DeltaFeatureEngine para evolução cirúrgica: ${err.message}`);
        const { DeltaFeatureEngine } = await import('./deltaFeatureEngine.js');
        return DeltaFeatureEngine.planDeltaEvolution({ briefing, projectContext, runId: options?.runId });
      }
      Logger.error(`[GeminiSupervisor] Erro no planejamento via Gemini: ${err.message}`);
      throw err;
    }

    if (mode === 'DELTA_EVOLUTION') {
      const { DeltaFeatureEngine } = await import('./deltaFeatureEngine.js');
      return DeltaFeatureEngine.planDeltaEvolution({ briefing, projectContext, runId: options?.runId });
    }

    throw new Error('SUPERVISOR_UNAVAILABLE: o agentapi não retornou um plano de tarefas válido.');
  }

  /**
   * Sanitizes and repairs a raw task payload from Gemini, preventing destructive all-or-nothing drops.
   * Fills in missing fields (criteria, verificationCommand, doneWhen, orderIndex, milestone) with safe defaults,
   * normalizes verification commands, and only returns null for unrecoverable entries (missing title/object).
   */
  static sanitizeAndRepairPlannedTask(
    raw: any,
    projectPath?: string,
    fallbackOrderIndex?: number
  ): PlannedTask | null {
    if (!raw || typeof raw !== 'object') return null;

    const rawTitle = typeof raw.title === 'string'
      ? raw.title
      : typeof raw.name === 'string'
      ? raw.name
      : typeof raw.taskTitle === 'string'
      ? raw.taskTitle
      : '';
    // Deduplicate accidental nested "(Parte 1...) (Parte 1...)" suffixes while preserving single semantic labels
    const cleanTitle = rawTitle
      .trim()
      .replace(/(\((?:Parte|Part)\s*[\d.]+[^)]*\))\s*\1+/gi, '$1')
      .trim();
    if (!cleanTitle) return null;

    const cleanDesc = typeof raw.description === 'string' && raw.description.trim().length > 0
      ? raw.description.trim()
      : typeof raw.objective === 'string' && raw.objective.trim().length > 0
      ? raw.objective.trim()
      : cleanTitle;

    const milestone = typeof raw.milestone === 'string' && raw.milestone.trim().length > 0
      ? raw.milestone.trim()
      : typeof raw.majorTaskCode === 'string' && raw.majorTaskCode.trim().length > 0
      ? raw.majorTaskCode.trim()
      : 'M1';

    const orderIndex = typeof raw.orderIndex === 'number' && !Number.isNaN(raw.orderIndex)
      ? raw.orderIndex
      : (fallbackOrderIndex ?? 1);

    const rawCriteria = Array.isArray(raw.criteria)
      ? raw.criteria
      : (Array.isArray(raw.acceptanceCriteria) ? raw.acceptanceCriteria : []);
    const criteria = rawCriteria.map((c: any) => String(c || '').trim()).filter(Boolean);
    if (criteria.length === 0) {
      criteria.push(`Implementar "${cleanTitle}" atendendo aos requisitos funcionais`);
      criteria.push('Executar comando de verificação automatizada com código de saída 0');
    }

    const rawCmd = typeof raw.verificationCommand === 'string' && raw.verificationCommand.trim().length > 0
      ? raw.verificationCommand.trim()
      : typeof raw.verification_command === 'string' && raw.verification_command.trim().length > 0
      ? raw.verification_command.trim()
      : 'npm test';

    const norm = normalizeOrRecoverVerificationCommand(rawCmd, projectPath || '.', {
      allowUncreatedFiles: true
    });

    const doneWhen = typeof raw.doneWhen === 'string' && raw.doneWhen.trim().length > 0
      ? raw.doneWhen.trim()
      : `Critérios verificados e comando "${norm.command}" retornando exitCode 0.`;

    const rawExpected = Array.isArray(raw.expectedFiles)
      ? raw.expectedFiles
      : Array.isArray(raw.expected_files)
      ? raw.expected_files
      : Array.isArray(raw.allowedScope)
      ? raw.allowedScope
      : Array.isArray(raw.scopeFiles)
      ? raw.scopeFiles
      : [];
    const expectedFiles = Array.from(new Set<string>(rawExpected.map((f: any) => String(f || '').trim()).filter(Boolean)));

    const rawScope = Array.isArray(raw.allowedScope)
      ? raw.allowedScope
      : Array.isArray(raw.expectedFiles)
      ? raw.expectedFiles
      : Array.isArray(raw.expected_files)
      ? raw.expected_files
      : [];
    const allowedScope = Array.from(new Set<string>(rawScope.map((f: any) => String(f || '').trim()).filter(Boolean)));

    const rawDeps = Array.isArray(raw.dependencies) ? raw.dependencies : [];
    const dependencies = Array.from(new Set<string>(rawDeps.map((d: any) => String(d || '').trim()).filter(Boolean)));

    const rawReqIds = Array.isArray(raw.requirementIds)
      ? raw.requirementIds
      : Array.isArray(raw.requirements)
      ? raw.requirements
      : [];
    const requirementIds = Array.from(new Set<string>(rawReqIds.map((r: any) => String(r || '').trim()).filter(Boolean)));

    const task: PlannedTask = {
      title: cleanTitle,
      description: cleanDesc,
      milestone,
      orderIndex,
      dependencies,
      criteria,
      verificationCommand: norm.command,
      verificationCommandMeta: norm,
      doneWhen,
      expectedFiles,
      expectedScopeFiles: allowedScope,
      allowedScope
    };

    if (raw.id) task.id = String(raw.id);
    if (raw.code) task.code = String(raw.code);
    if (raw.majorTaskCode) task.majorTaskCode = String(raw.majorTaskCode);
    if (raw.majorTaskTitle) task.majorTaskTitle = String(raw.majorTaskTitle);
    if (raw.stageCode) task.stageCode = String(raw.stageCode);
    if (raw.stageTitle) task.stageTitle = String(raw.stageTitle);
    if (requirementIds.length > 0) task.requirementIds = requirementIds;

    // FASE 20: Pre-classify skill at plan generation time
    try {
      const { SkillRouter } = require('./skillRouter.js');
      const routed = SkillRouter.routeTask(task, { projectPath });
      task.skillRouted = raw.skillRouted || raw.skill_routed || routed.skill;
      task.skillConfidence = typeof raw.skillConfidence === 'number' ? raw.skillConfidence : 1.0;
      task.skillGuidelines = Array.isArray(raw.skillGuidelines)
        ? raw.skillGuidelines
        : (routed.guidelines || routed.priorityInvariants);
    } catch {
      task.skillRouted = raw.skillRouted || raw.skill_routed;
      task.skillConfidence = typeof raw.skillConfidence === 'number' ? raw.skillConfidence : 1.0;
      task.skillGuidelines = raw.skillGuidelines;
    }

    return task;
  }

  /**
   * Deterministic Plan Quality Validator:
   * - Deduplicates tasks with identical normalized titles (or already in completedTasks)
   * - Guarantees non-empty verifiable criteria and explicit doneWhen contract
   * - Cleans self-dependencies or dangling dependency references so DAG cannot deadlock
   */
  static validateAndRefinePlanQuality(
    tasks: PlannedTask[],
    completedTasks?: Array<{ id: string; title: string }>
  ): PlannedTask[] {
    if (!Array.isArray(tasks) || tasks.length === 0) return [];

    const completedTitles = new Set(
      (completedTasks || []).map(t => (t.title || '').trim().toLowerCase()).filter(Boolean)
    );
    const seenTitles = new Set<string>();
    const deduplicated: PlannedTask[] = [];

    for (const raw of tasks) {
      const titleNorm = (raw.title || '').trim().toLowerCase();
      if (!titleNorm) continue;
      if (seenTitles.has(titleNorm)) continue;
      if (completedTitles.has(titleNorm) && tasks.length > 1) continue;
      seenTitles.add(titleNorm);

      const criteria = Array.isArray(raw.criteria)
        ? raw.criteria.map(c => String(c || '').trim()).filter(Boolean)
        : [];
      if (criteria.length === 0) {
        criteria.push(`Implementar "${raw.title.trim()}" atendendo aos requisitos funcionais`);
        criteria.push('Executar comando de verificação automatizada com código de saída 0');
      }

      const doneWhen = (raw.doneWhen && String(raw.doneWhen).trim().length > 0)
        ? String(raw.doneWhen).trim()
        : `Critérios verificados e comando "${raw.verificationCommand || 'npm test'}" retornando exitCode 0.`;

      deduplicated.push({
        ...raw,
        title: raw.title.trim(),
        milestone: raw.milestone || 'M1',
        criteria,
        doneWhen,
        expectedFiles: Array.isArray(raw.expectedFiles)
          ? raw.expectedFiles
          : (Array.isArray((raw as any).expected_files) ? (raw as any).expected_files : []),
        skillRouted: (raw as any).skillRouted || (raw as any).skill_routed,
        skillConfidence: (raw as any).skillConfidence ?? 1.0,
        skillGuidelines: (raw as any).skillGuidelines
      });
    }

    // Auto-heal DAG, resolve multi-key dependencies and remove orphans
    const healed = DagAutoHealer.autoHealAndNormalizeTaskGraph(deduplicated, { breakCycles: false, completedTasks });
    try {
      const { SkillRouter } = require('./skillRouter.js');
      for (const t of healed) {
        if (!t.skillRouted) {
          const routed = SkillRouter.routeTask(t);
          t.skillRouted = routed.skill;
          t.skillConfidence = 1.0;
          t.skillGuidelines = routed.guidelines || routed.priorityInvariants;
        }
      }
    } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "geminiSupervisorProvider",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:geminiSupervisorProvider]", err);
      }
    }
    return healed;
  }

  /**
   * Wave 1: Generates the Architectural Blueprint (Major Tasks + Requirements + Stages).
   */
  async planArchitecturalBlueprint(
    briefing: string,
    projectContext: { name: string; path: string; objective: string; id?: string },
    options?: {
      runId?: string | null;
      requirements?: string[];
      constitutionSnippet?: string;
      existingMemorySnippet?: string;
      preResolvedBlocks?: {
        docSimpContextBlock?: string;
        designSkillContextBlock?: string;
        reaSaaSMasterContextBlock?: string;
        marketDiscoveryContextBlock?: string;
        livingSpecContextBlock?: string;
      };
    }
  ): Promise<{
    requirements: Array<{ code: string; title: string; description: string; category?: string; mandatory?: boolean }>;
    majorTasks: Array<{
      code: string;
      title: string;
      objective: string;
      expectedOutcome?: string;
      requirementIds?: string[];
      stages?: Array<{ code: string; title: string; objective?: string }>;
      dependencies?: string[];
    }>;
  }> {
    const resolvedBlocks = options?.preResolvedBlocks ?? await this.resolveContextualSkillBlocks(briefing, projectContext.path, projectContext.name, options?.requirements);

    const { prompt } = PromptArchitectureService.buildArchitecturalBlueprintPrompt({
      projectId: this.projectId || projectContext.id || 'default-project',
      projectName: projectContext.name,
      projectPath: projectContext.path,
      projectObjective: projectContext.objective,
      briefing,
      requirements: options?.requirements,
      constitutionSnippet: options?.constitutionSnippet,
      existingMemorySnippet: options?.existingMemorySnippet,
      docSimpContextBlock: resolvedBlocks.docSimpContextBlock,
      designSkillContextBlock: resolvedBlocks.designSkillContextBlock,
      reaSaaSMasterContextBlock: resolvedBlocks.reaSaaSMasterContextBlock,
      marketDiscoveryContextBlock: resolvedBlocks.marketDiscoveryContextBlock,
      livingSpecContextBlock: resolvedBlocks.livingSpecContextBlock
    });

    let conversationId = this.lastConversationId;
    const effectiveProjectId = this.projectId || projectContext.id;
    let minStepIndex = -1;
    let messageDispatched = false;

    try {
      const { AgentSessionManager } = await import('./agentSessionManager.js');
      if (effectiveProjectId) {
        const { session, isNew } = await AgentSessionManager.getOrCreateAgentSession(effectiveProjectId, 'SUPERVISOR', {
          model: this.model,
          env: this.env,
          initialPrompt: prompt,
          accountProfileId: this.accountProfileId,
          runId: options?.runId
        });
        conversationId = session.provider_conversation_id;
        messageDispatched = true;

        if (!isNew) {
          const rotationCheck = AgentSessionManager.checkContextRotationPolicy(session, this.appDataBrainDir);
          if (rotationCheck.shouldRotate) {
            const { newSession } = await AgentSessionManager.rotateSession(effectiveProjectId, 'SUPERVISOR', rotationCheck.reason || 'CONTEXT_LIMIT_REACHED', {
              model: this.model,
              env: this.env,
              runId: options?.runId
            });
            conversationId = newSession.provider_conversation_id;
            await AgentSessionManager.sendMessage(newSession, prompt, {
              env: this.env,
              taskTitle: 'Blueprint Arquitetural (Pós-Rotação)'
            });
          } else {
            minStepIndex = this.getLatestTranscriptStepIndex(conversationId);
            await AgentSessionManager.sendMessage(session, prompt, {
              env: this.env,
              taskTitle: 'Blueprint Arquitetural'
            });
          }
        }
      }
    } catch (sessionErr: any) {
      Logger.warn(`[GeminiSupervisor] Aviso ao obter sessão do Supervisor para Blueprint: ${sessionErr.message}`);
    }

    if (!messageDispatched) {
      if (!conversationId) {
        conversationId = AgentApiGateway.newConversation({
          model: this.model,
          title: `DecoHUB — Blueprint Arquitetural`,
          prompt,
          projectId: this.projectId || projectContext.id,
          role: 'supervisor',
          caller: 'GeminiSupervisorProvider.planArchitecturalBlueprint',
          runId: options?.runId,
          env: this.env
        });
      } else {
        minStepIndex = this.getLatestTranscriptStepIndex(conversationId);
        AgentApiGateway.sendMessage({
          conversationId,
          prompt,
          projectId: this.projectId || projectContext.id,
          role: 'supervisor',
          caller: 'GeminiSupervisorProvider.planArchitecturalBlueprint',
          env: this.env
        });
      }
    }

    if (!conversationId) {
      throw new Error('Falha ao iniciar conversa de Blueprint Arquitetural');
    }
    this.lastConversationId = conversationId;

    const responseText = await this.waitForResponse(conversationId, 180000, minStepIndex, 'PLAN');
    const parsed = this.extractJsonObject<{
      requirements?: Array<{ code: string; title: string; description: string; category?: string; mandatory?: boolean }>;
      majorTasks?: Array<{
        code: string;
        title: string;
        objective: string;
        expectedOutcome?: string;
        requirementIds?: string[];
        stages?: Array<{ code: string; title: string; objective?: string }>;
        dependencies?: string[];
      }>;
    }>(responseText);

    if (parsed && Array.isArray(parsed.majorTasks) && parsed.majorTasks.length > 0) {
      const healedMajorTasks = DagAutoHealer.autoHealAndNormalizeTaskGraph(parsed.majorTasks.map((m, idx) => ({
        ...m,
        code: m.code || `GT-${idx + 1}`,
        title: m.title || `Grande Tarefa ${idx + 1}`,
        objective: m.objective || m.title || `Entrega da fase ${idx + 1}`,
        expectedOutcome: m.expectedOutcome || m.objective || m.title,
        requirementIds: Array.isArray(m.requirementIds) ? m.requirementIds : [],
        stages: Array.isArray(m.stages) ? m.stages : [],
        dependencies: Array.isArray(m.dependencies) ? m.dependencies : []
      })));
      return {
        requirements: Array.isArray(parsed.requirements) ? parsed.requirements : [],
        majorTasks: healedMajorTasks
      };
    }

    const parsedArray = this.extractJsonArray<any>(responseText);
    if (Array.isArray(parsedArray) && parsedArray.length > 0) {
      const mapped = parsedArray.map((m, idx) => ({
        code: m.code || `GT-${idx + 1}`,
        title: m.title || `Grande Tarefa ${idx + 1}`,
        objective: m.objective || m.title || `Entrega da fase ${idx + 1}`,
        expectedOutcome: m.expectedOutcome || m.objective || m.title,
        requirementIds: Array.isArray(m.requirementIds) ? m.requirementIds : [],
        stages: Array.isArray(m.stages) ? m.stages : [],
        dependencies: Array.isArray(m.dependencies) ? m.dependencies : (idx > 0 ? [`GT-${idx}`] : [])
      }));
      const synthesizedReqs = (options?.requirements || []).map((r, i) => ({
        code: `REQ-${i + 1}`,
        title: String(r),
        description: String(r),
        mandatory: true
      }));
      return {
        requirements: synthesizedReqs,
        majorTasks: DagAutoHealer.autoHealAndNormalizeTaskGraph(mapped)
      };
    }

    throw new Error('BLUEPRINT_UNAVAILABLE: O agentapi não retornou um blueprint arquitetural válido.');
  }

  /**
   * Wave 2: Expands a single Major Task into atomic microtasks with explicit files, criteria, and verification commands.
   */
  async expandMajorTaskIntoMicrotasks(
    majorTask: {
      code: string;
      title: string;
      objective: string;
      expectedOutcome?: string;
      requirementIds?: string[];
      stages?: Array<{ code: string; title: string; objective?: string }>;
      dependencies?: string[];
    },
    projectContext: { name: string; path: string; objective: string; id?: string },
    context: {
      briefing: string;
      previousMajorTaskCode?: string;
      allMajorTasksSummary?: Array<{ code: string; title: string }>;
      priorMajorTaskLastMicrotaskCode?: string;
      projectRequirements?: Array<{ code: string; title: string }>;
      startOrderIndex?: number;
      preResolvedBlocks?: {
        docSimpContextBlock?: string;
        designSkillContextBlock?: string;
        reaSaaSMasterContextBlock?: string;
        marketDiscoveryContextBlock?: string;
        livingSpecContextBlock?: string;
      };
    }
  ): Promise<PlannedTask[]> {
    let docSimpContextBlock = context.preResolvedBlocks?.docSimpContextBlock || '';
    let designSkillContextBlock = context.preResolvedBlocks?.designSkillContextBlock || '';
    let reaSaaSMasterContextBlock = context.preResolvedBlocks?.reaSaaSMasterContextBlock || '';
    let marketDiscoveryContextBlock = context.preResolvedBlocks?.marketDiscoveryContextBlock || '';
    let livingSpecContextBlock = context.preResolvedBlocks?.livingSpecContextBlock || '';

    if (!context.preResolvedBlocks) {
      const blocks = await this.resolveContextualSkillBlocks(
        `${majorTask.title} ${majorTask.objective} ${context.briefing}`,
        projectContext.path,
        projectContext.name,
        context.projectRequirements?.map(r => r.title)
      );
      docSimpContextBlock = blocks.docSimpContextBlock;
      designSkillContextBlock = blocks.designSkillContextBlock;
      reaSaaSMasterContextBlock = blocks.reaSaaSMasterContextBlock;
      marketDiscoveryContextBlock = blocks.marketDiscoveryContextBlock;
      livingSpecContextBlock = blocks.livingSpecContextBlock;
    }

    const filtered = GeminiSupervisorProvider.filterSkillBlocksForMajorTask(majorTask, {
      docSimpContextBlock,
      designSkillContextBlock,
      reaSaaSMasterContextBlock,
      marketDiscoveryContextBlock,
      livingSpecContextBlock
    });
    docSimpContextBlock = filtered.docSimpContextBlock;
    designSkillContextBlock = filtered.designSkillContextBlock;
    reaSaaSMasterContextBlock = filtered.reaSaaSMasterContextBlock;
    marketDiscoveryContextBlock = filtered.marketDiscoveryContextBlock;
    livingSpecContextBlock = filtered.livingSpecContextBlock;

    const { prompt } = PromptArchitectureService.buildMajorTaskExpansionPrompt({
      projectId: this.projectId || projectContext.id || 'default-project',
      projectName: projectContext.name,
      projectPath: projectContext.path,
      projectObjective: projectContext.objective || '',
      briefing: context.briefing,
      majorTask,
      previousMajorTaskCode: context.previousMajorTaskCode,
      lastMicrotaskOfPreviousMajor: context.priorMajorTaskLastMicrotaskCode,
      priorMajorTaskLastMicrotaskCode: context.priorMajorTaskLastMicrotaskCode,
      allMajorTasksSummary: context.allMajorTasksSummary,
      projectRequirements: context.projectRequirements,
      docSimpContextBlock,
      designSkillContextBlock,
      reaSaaSMasterContextBlock,
      marketDiscoveryContextBlock,
      livingSpecContextBlock
    });

    let conversationId = this.lastConversationId;
    const effectiveProjectId = this.projectId || projectContext.id;
    let minStepIndex = -1;
    let messageDispatched = false;

    try {
      const { AgentSessionManager } = await import('./agentSessionManager.js');
      if (effectiveProjectId) {
        const { session, isNew } = await AgentSessionManager.getOrCreateAgentSession(effectiveProjectId, 'SUPERVISOR', {
          model: this.model,
          env: this.env,
          initialPrompt: prompt,
          accountProfileId: this.accountProfileId
        });
        conversationId = session.provider_conversation_id;
        messageDispatched = true;

        if (!isNew) {
          const rotationCheck = AgentSessionManager.checkContextRotationPolicy(session, this.appDataBrainDir);
          if (rotationCheck.shouldRotate) {
            const { newSession } = await AgentSessionManager.rotateSession(effectiveProjectId, 'SUPERVISOR', rotationCheck.reason || 'CONTEXT_LIMIT_REACHED', {
              model: this.model,
              env: this.env
            });
            conversationId = newSession.provider_conversation_id;
            await AgentSessionManager.sendMessage(newSession, prompt, {
              env: this.env,
              taskTitle: `Expansão ${majorTask.code} (Pós-Rotação)`
            });
          } else {
            minStepIndex = this.getLatestTranscriptStepIndex(conversationId);
            await AgentSessionManager.sendMessage(session, prompt, {
              env: this.env,
              taskTitle: `Expansão ${majorTask.code}`
            });
          }
        }
      }
    } catch (sessionErr: any) {
      Logger.warn(`[GeminiSupervisor] Aviso ao obter sessão do Supervisor para expansão ${majorTask.code}: ${sessionErr.message}`);
    }

    if (!messageDispatched) {
      if (!conversationId) {
        conversationId = AgentApiGateway.newConversation({
          model: this.model,
          title: `DecoHUB — Expansão ${majorTask.code}`,
          prompt,
          projectId: this.projectId || projectContext.id,
          role: 'supervisor',
          caller: 'GeminiSupervisorProvider.expandMajorTaskIntoMicrotasks',
          env: this.env
        });
      } else {
        minStepIndex = this.getLatestTranscriptStepIndex(conversationId);
        AgentApiGateway.sendMessage({
          conversationId,
          prompt,
          projectId: this.projectId || projectContext.id,
          role: 'supervisor',
          caller: 'GeminiSupervisorProvider.expandMajorTaskIntoMicrotasks',
          env: this.env
        });
      }
    }

    if (!conversationId) {
      throw new Error(`Falha ao iniciar expansão da Grande Tarefa ${majorTask.code}`);
    }
    this.lastConversationId = conversationId;

    const responseText = await this.waitForResponse(conversationId, 180000, minStepIndex, 'PLAN');
    const rawArray = this.extractJsonArray<any>(responseText);

    if (Array.isArray(rawArray) && rawArray.length > 0) {
      const sanitized: PlannedTask[] = [];
      const baseOrder = context.startOrderIndex ?? 1;
      rawArray.forEach((raw, i) => {
        const repaired = GeminiSupervisorProvider.sanitizeAndRepairPlannedTask(raw, projectContext.path, baseOrder + i);
        if (repaired) {
          repaired.majorTaskCode = repaired.majorTaskCode || majorTask.code;
          repaired.majorTaskTitle = repaired.majorTaskTitle || majorTask.title;
          if ((!repaired.requirementIds || repaired.requirementIds.length === 0) && Array.isArray(majorTask.requirementIds) && majorTask.requirementIds.length > 0) {
            repaired.requirementIds = [...majorTask.requirementIds];
          }
          sanitized.push(repaired);
        }
      });
      if (sanitized.length > 0) {
        return sanitized;
      }
    }

    throw new Error(`TASK_EXPANSION_UNAVAILABLE: O agentapi não retornou microtarefas válidas para ${majorTask.code}.`);
  }

  /**
   * Builds deterministic atomic microtasks for a single Major Task if LLM Wave 2 expansion fails for that specific GT
   */
  private buildFallbackMicrotasksForMajorTask(
    majorTask: {
      code: string;
      title: string;
      objective: string;
      requirementIds?: string[];
      stages?: Array<{ code: string; title: string; objective?: string }>;
    },
    projectPath: string,
    startOrderIndex: number,
    priorLastMicroCode?: string
  ): PlannedTask[] {
    const stages = Array.isArray(majorTask.stages) && majorTask.stages.length > 0
      ? majorTask.stages
      : [{ code: `${majorTask.code}-ET-1`, title: majorTask.title, objective: majorTask.objective }];

    const results: PlannedTask[] = [];
    let prevDep = priorLastMicroCode;

    stages.forEach((st, idx) => {
      const code = `${majorTask.code}-TK-${idx + 1}`;
      const title = st.title && st.title !== majorTask.title
        ? `${majorTask.title}: ${st.title}`
        : `${majorTask.title} (${st.code || `Etapa ${idx + 1}`})`;
      const repaired = GeminiSupervisorProvider.sanitizeAndRepairPlannedTask(
        {
          code,
          title,
          description: st.objective || majorTask.objective || title,
          milestone: majorTask.code,
          majorTaskCode: majorTask.code,
          majorTaskTitle: majorTask.title,
          stageCode: st.code || `ET-${idx + 1}`,
          stageTitle: st.title || majorTask.title,
          requirementIds: majorTask.requirementIds || ['REQ-1'],
          orderIndex: startOrderIndex + idx,
          dependencies: prevDep ? [prevDep] : [],
          criteria: [
            `Implementar "${title}" cumprindo os contratos de "${majorTask.objective}"`,
            `Garantir cobertura de testes automatizados passando com exit code 0`
          ],
          verificationCommand: 'npm test'
        },
        projectPath,
        startOrderIndex + idx
      );
      if (repaired) {
        results.push(repaired);
        prevDep = repaired.code || repaired.title;
      }
    });

    return results;
  }

  /**
   * Two-Pass / Multi-Pass Hierarchical Planning Pipeline:
   * Wave 1: Architectural Blueprint (Major Tasks + Requirements)
   * Wave 2: Atomic Microtask Expansion per Major Task
   * Chaining and cycle validation
   */
  async planTwoPassHierarchy(
    briefing: string,
    projectContext: { name: string; path: string; objective: string; id?: string },
    options?: {
      runId?: string | null;
      completedTasks?: Array<{ id: string; title: string }>;
      pendingTasks?: Array<{ id: string; title: string }>;
      replanReason?: string;
      requirements?: string[];
      multiPass?: boolean;
      deepPlanning?: boolean;
    }
  ): Promise<PlannedTask[]> {
    Logger.info(`[GeminiSupervisor] Iniciando Planejamento Hierárquico Multi-Pass (Duas Ondas) para "${projectContext.name}"...`);

    // In offline or language-server-unavailable mode:
    if (AgentApiGateway.isOfflineMode() || !this.exePath) {
      let conversationId = this.lastConversationId;
      const effectiveProjectId = this.projectId || projectContext.id;
      if (effectiveProjectId) {
        const { AgentSessionManager } = await import('./agentSessionManager.js');
        const { session } = await AgentSessionManager.getOrCreateAgentSession(effectiveProjectId, 'SUPERVISOR', {
          model: this.model,
          env: this.env,
          initialPrompt: briefing,
          accountProfileId: this.accountProfileId
        });
        conversationId = session.provider_conversation_id;
      } else {
        conversationId = AgentApiGateway.newConversation({
          model: this.model,
          title: `DecoHUB — Supervisor Multi-Pass`,
          prompt: briefing,
          projectId: this.projectId || projectContext.id,
          role: 'supervisor',
          caller: 'GeminiSupervisorProvider.planTwoPassHierarchy',
          env: this.env
        });
      }
      if (conversationId) {
        this.lastConversationId = conversationId;
      }

      // If test has explicitly overridden waitForResponse on instance or prototype:
      const isCustomWait = this.waitForResponse !== (GeminiSupervisorProvider as any)._defaultWaitForResponse;
      if (isCustomWait) {
        const responseText = await this.waitForResponse(conversationId, 180000, -1, 'PLAN');
        const rawTasks = this.extractJsonArray<PlannedTask>(responseText);
        if (rawTasks && Array.isArray(rawTasks) && rawTasks.length > 0) {
          const sanitizedTasks: PlannedTask[] = [];
          rawTasks.forEach((raw, idx) => {
            const repaired = GeminiSupervisorProvider.sanitizeAndRepairPlannedTask(raw, projectContext.path || '.', idx + 1);
            if (repaired) sanitizedTasks.push(repaired);
          });
          if (sanitizedTasks.length > 0) {
            return GeminiSupervisorProvider.validateAndRefinePlanQuality(sanitizedTasks, options?.completedTasks);
          }
        }
        throw new Error('SUPERVISOR_UNAVAILABLE: o agentapi não retornou um plano de tarefas válido.');
      }

      const mockProvider = AgentApiGateway.getMockProvider();
      const isDefaultTestMock = Boolean((mockProvider as any)?.responseProvider?.isDefaultTestFixture);
      const mockResp = !isDefaultTestMock
        ? ((conversationId ? mockProvider?.getResponse?.(conversationId, 'PLAN') : undefined) ?? mockProvider?.getResponse?.('custom-multi-pass', 'PLAN'))
        : undefined;
      if (mockResp !== undefined) {
        const rawArray = this.extractJsonArray<PlannedTask>(mockResp);
        if (rawArray && rawArray.length > 0) {
          const sanitized = rawArray
            .map((r, i) => GeminiSupervisorProvider.sanitizeAndRepairPlannedTask(r, projectContext.path, i + 1))
            .filter((t): t is PlannedTask => t !== null);
          if (sanitized.length > 0) {
            return GeminiSupervisorProvider.validateAndRefinePlanQuality(sanitized, options?.completedTasks);
          }
        }
        throw new Error('SUPERVISOR_UNAVAILABLE: o agentapi não retornou um plano de tarefas válido.');
      }

      // Delegate to deterministic high-fidelity multi-pass generator:
      const { HierarchicalOrchestrationService } = await import('./hierarchicalOrchestrationService.js');
      const generated = HierarchicalOrchestrationService.generateMultiPassPlannedTasks({
        briefing,
        projectPath: projectContext.path,
        projectName: projectContext.name,
        projectId: this.projectId || projectContext.id,
        requirements: options?.requirements
      });
      return GeminiSupervisorProvider.validateAndRefinePlanQuality(generated, options?.completedTasks);
    }

    // Live mode:
    try {
      let existingMemorySnippet = '';
      let constitutionSnippet = '';
      try {
        const { MemoryManager } = await import('./memoryManager.js');
        const memory = MemoryManager.readMemoryFiles(projectContext.path);
        if (memory.decisionsMd) existingMemorySnippet += ` DECISÕES TÉCNICAS A RESPEITAR: ${memory.decisionsMd}.`;
        if (memory.programMd) constitutionSnippet = memory.programMd;
        existingMemorySnippet += `\nARQUITETURA: ${memory.architectureMd || ''}\nGIT: ${JSON.stringify(GitManager.getGitInfo(projectContext.path))}\nARQUIVOS E STACK: ${JSON.stringify(ProjectAnalyzer.analyze(projectContext.path))}`;
      } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "geminiSupervisorProvider",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:geminiSupervisorProvider]", err);
      }
    }

      const preResolvedBlocks = await this.resolveContextualSkillBlocks(briefing, projectContext.path, projectContext.name, options?.requirements);
      Logger.info(`[GeminiSupervisor] Onda 0: Estudo de Mercado, Referências e Engenharia Reversa REA concluído.`);

      // Wave 1: Blueprint
      Logger.info(`[GeminiSupervisor] Onda 1: Gerando Blueprint Arquitetural (Grandes Tarefas)...`);
      const blueprint = await this.planArchitecturalBlueprint(briefing, projectContext, {
        runId: options?.runId,
        requirements: options?.requirements,
        constitutionSnippet,
        existingMemorySnippet,
        preResolvedBlocks
      });

      const majorTasks = blueprint.majorTasks || [];
      if (majorTasks.length === 0) {
        throw new Error('Nenhuma Grande Tarefa retornada no Blueprint.');
      }

      // Wave 2: Atomic Expansion
      Logger.info(`[GeminiSupervisor] Onda 2: Expandindo ${majorTasks.length} Grandes Tarefas em microtarefas atômicas...`);
      const allMicrotasks: PlannedTask[] = [];
      const majorTasksSummary = majorTasks.map(m => ({ code: m.code, title: m.title }));
      let priorLastMicroCode: string | undefined = undefined;

      for (let mIdx = 0; mIdx < majorTasks.length; mIdx++) {
        const major = majorTasks[mIdx];
        const prevMajorCode = mIdx > 0 ? majorTasks[mIdx - 1].code : undefined;
        let expanded: PlannedTask[] = [];

        const filteredBlocks = GeminiSupervisorProvider.filterSkillBlocksForMajorTask(major, preResolvedBlocks);
        try {
          expanded = await this.expandMajorTaskIntoMicrotasks(major, projectContext, {
            briefing,
            previousMajorTaskCode: prevMajorCode,
            allMajorTasksSummary: majorTasksSummary,
            priorMajorTaskLastMicrotaskCode: priorLastMicroCode,
            projectRequirements: blueprint.requirements.map(r => ({ code: r.code, title: r.title })),
            startOrderIndex: allMicrotasks.length + 1,
            preResolvedBlocks: filteredBlocks
          });
        } catch (expandErr: any) {
          Logger.warn(`[GeminiSupervisor] Aviso na expansão de ${major.code} (${expandErr.message}). Sintetizando microtarefas da etapa para preservar o plano.`);
          expanded = this.buildFallbackMicrotasksForMajorTask(
            major,
            projectContext.path,
            allMicrotasks.length + 1,
            priorLastMicroCode
          );
        }

        // Inter-Major Task DAG Chaining: first microtask of GT-n depends on priorLastMicroCode if not already chained
        if (expanded.length > 0) {
          if (priorLastMicroCode && (!expanded[0].dependencies || expanded[0].dependencies.length === 0)) {
            expanded[0].dependencies = [priorLastMicroCode];
          }
          priorLastMicroCode = expanded[expanded.length - 1].code || expanded[expanded.length - 1].title;
          allMicrotasks.push(...expanded);
        }
      }

      if (allMicrotasks.length === 0) {
        throw new Error('Nenhuma microtarefa gerada após a Onda 2.');
      }

      // Heal and normalize microtask DAG (resolves GT-x, numeric refs, breaks cycles, removes orphans)
      const healedMicrotasks = DagAutoHealer.autoHealAndNormalizeTaskGraph(allMicrotasks);
      Logger.success(`[GeminiSupervisor] Planejamento Multi-Pass concluído: ${healedMicrotasks.length} microtarefas distribuídas em ${majorTasks.length} Grandes Tarefas.`);
      return GeminiSupervisorProvider.validateAndRefinePlanQuality(healedMicrotasks, options?.completedTasks);
    } catch (err: any) {
      Logger.error(`[GeminiSupervisor] Falha no pipeline Multi-Pass: ${err.message}. Recorrendo à geração determinística de alta fidelidade.`);
      const { HierarchicalOrchestrationService } = await import('./hierarchicalOrchestrationService.js');
      const generated = HierarchicalOrchestrationService.generateMultiPassPlannedTasks({
        briefing,
        projectPath: projectContext.path,
        projectName: projectContext.name,
        projectId: this.projectId || projectContext.id,
        requirements: options?.requirements
      });
      return GeminiSupervisorProvider.validateAndRefinePlanQuality(generated, options?.completedTasks);
    }
  }

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
      Logger.error(`[GeminiSupervisor] REJEITADO POR ADULTERAÇÃO: O Builder modificou arquivos de teste protegidos (${tamperedList})!`);
      return {
        verdict: 'CHANGES_REQUESTED',
        feedback: `REJEITADO POR ADULTERAÇÃO (INDEPENDENT EVALUATOR): Tentativa de adulteração detectada nos arquivos de avaliação protegidos: ${tamperedList}. O agente que implementa o código NÃO pode modificar os testes de avaliação para contornar falhas. A aprovação deve decorrer da correção do código da aplicação.`,
        nextAction: 'Reverter imediatamente as alterações nos arquivos de teste protegidos para o estado original e corrigir o código de produção.',
        qualityScore: 1,
        simplicityScore: 1,
        isSurgical: false,
        unrelatedFilesDetected: evaluation.evidence?.tamperedFiles || []
      };
    }

    const expectedScope = task.expectedScopeFiles || task.expected_files || [];
    const diffValidation = validateSurgicalDiff(report.filesChanged || [], expectedScope);

    const evaluatorCombinedOutput = [
      evaluation?.evidence?.output || '',
      Array.isArray(evaluation?.evaluatorNotes) ? evaluation.evaluatorNotes.join('\n') : ''
    ].filter(Boolean).join('\n---\n');

    let skillRouted = task.skill_routed || task.skillRouted;
    let skillGuidelines: string[] = [];
    if (task.skill_guidelines_json) {
      try {
        skillGuidelines = JSON.parse(task.skill_guidelines_json);
      } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "geminiSupervisorProvider",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:geminiSupervisorProvider]", err);
      }
    }
    } else if (Array.isArray(task.skillGuidelines)) {
      skillGuidelines = task.skillGuidelines;
    }
    if (!skillRouted) {
      try {
        const { SkillRouter } = await import('./skillRouter.js');
        const routed = SkillRouter.routeTask(task, { projectPath: projectContext?.path });
        skillRouted = routed.skill;
        if (skillGuidelines.length === 0) {
          skillGuidelines = routed.guidelines || routed.priorityInvariants;
        }
      } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "geminiSupervisorProvider",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:geminiSupervisorProvider]", err);
      }
    }
    }

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
        verificationCommand: task.verificationCommand || task.verification_command,
        expectedScopeFiles: expectedScope,
        skillRouted,
        skillGuidelines
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
        failedCriteria: evaluation.failedCriteria,
        output: evaluatorCombinedOutput || evaluation.evidence?.output,
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

      let minStepIndex = this.getLatestTranscriptStepIndex(conversationId);

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
            minStepIndex = this.getLatestTranscriptStepIndex(conversationId);
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
          minStepIndex = this.getLatestTranscriptStepIndex(conversationId);
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
        conversationId = AgentApiGateway.newConversation({
          model: this.model,
          title: `DecoHUB — Supervisor`,
          prompt,
          projectId: this.projectId || projectContext?.id,
          role: 'supervisor',
          caller: 'GeminiSupervisorProvider.reviewTask',
          env: this.env
        });
      } else {
        minStepIndex = this.getLatestTranscriptStepIndex(conversationId);
        AgentApiGateway.sendMessage({
          conversationId,
          prompt,
          projectId: this.projectId || projectContext?.id,
          role: 'supervisor',
          caller: 'GeminiSupervisorProvider.reviewTask',
          env: this.env
        });
      }

      if (conversationId) {
        this.lastConversationId = conversationId;
        const responseText = await this.waitForResponse(conversationId, 180000, minStepIndex, 'REVIEW');
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
      throw err;
    }

    throw new Error('SUPERVISOR_REVIEW_UNAVAILABLE: agentapi não retornou revisão verificável.');
  }

  /**
   * Final project completion review
   */
  async reviewProjectCompletion(run: any, project: any, evidence: any[]): Promise<SupervisorReviewContract> {
    const { AgentSessionManager } = await import('./agentSessionManager.js');
    const { session: initialSession, isNew } = await AgentSessionManager.getOrCreateAgentSession(project.id, 'SUPERVISOR', {
      model: this.model,
      env: this.env,
      accountProfileId: this.accountProfileId,
      runId: run.id
    });
    let session = initialSession;
    if (!isNew) {
      const rotationCheck = AgentSessionManager.checkContextRotationPolicy(session, this.appDataBrainDir);
      if (rotationCheck.shouldRotate) {
        const rotated = await AgentSessionManager.rotateSession(project.id, 'SUPERVISOR', rotationCheck.reason || 'CONTEXT_LIMIT_REACHED', {
          model: this.model,
          env: this.env,
          runId: run.id
        });
        session = rotated.newSession;
      }
    }
    this.lastConversationId = session.provider_conversation_id;
    const minStep = this.getLatestTranscriptStepIndex(session.provider_conversation_id);

    const { prompt } = PromptArchitectureService.buildSupervisorPrompt({
      mode: 'FINAL_REVIEW',
      projectId: project.id,
      projectName: project.name,
      projectPath: project.path,
      projectObjective: run.objective,
      runId: run.id
    });
    const taskSummary = (run.tasks || []).map((t: any) => ({
      title: t.title,
      milestone: t.milestone,
      status: t.status,
      issue: t.github_issue_number
    }));
    const evidenceSummary = (evidence || []).map((e: any) => ({
      verdict: e?.verdict,
      taskIsDone: e?.taskIsDone,
      exitCode: e?.exitCode,
      notes: e?.evaluatorNotes,
      summary: e?.evidence?.evidenceSummary
    }));
    await AgentSessionManager.sendMessage(
      session,
      `${prompt}\nOBJETIVO INTEGRAL DO USUÁRIO:\n${run.briefing}\nPLANO E ESTADO:\n${JSON.stringify(taskSummary)}\nEVIDÊNCIAS INDEPENDENTES:\n${JSON.stringify(evidenceSummary)}\nInspecione os artefatos reais. Aprove somente se TODOS os requisitos originais têm evidência proporcional (UI com interação, APIs e persistência real quando exigidos). Não infira funcionamento só por nomes de arquivos. Responda JSON {verdict: APPROVED|CHANGES_REQUESTED|BLOCKED, feedback, nextAction}.`,
      { env: this.env, taskTitle: 'Aceitação final do projeto' }
    );
    const response = await this.waitForResponse(session.provider_conversation_id, 240000, minStep, 'REVIEW');
    const result = this.extractJsonObject<any>(response);
    if (!result) throw new Error('SUPERVISOR_FINAL_REVIEW_INVALID: resposta JSON inválida.');
    if (!result.feedback && (result.rationale || result.summary || result.reason)) {
      result.feedback = String(result.rationale || result.summary || result.reason);
    }
    if (!['APPROVED', 'CHANGES_REQUESTED', 'BLOCKED'].includes(result?.verdict) || !result.feedback) {
      throw new Error('SUPERVISOR_FINAL_REVIEW_INVALID: veredito e evidência obrigatórios.');
    }
    return result;
  }

  /**
   * Helper to wait for the conversation transcript to complete.
   * If transcript.jsonl contains truncated content, this reads the full
   * content from transcript_full.jsonl to eliminate artificial text truncation.
   */
  async waitForResponse(conversationId: string, timeoutMs: number, minStepIndex = -1, expectedMode?: 'PLAN' | 'REVIEW'): Promise<string> {
    const transcriptPath = path.join(this.appDataBrainDir, conversationId, '.system_generated', 'logs', 'transcript.jsonl');
    const transcriptFullPath = path.join(this.appDataBrainDir, conversationId, '.system_generated', 'logs', 'transcript_full.jsonl');

    // If no transcript file exists on disk and we are in offline mode, return synthetic mock response
    if (!fs.existsSync(transcriptPath) && AgentApiGateway.isOfflineMode()) {
      const response = AgentApiGateway.getMockProvider()?.getResponse?.(conversationId, expectedMode);
      if (response === undefined) throw new Error('OFFLINE_RESPONSE_UNCONFIGURED: provider de teste sem resposta explícita.');
      return response;
    }

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

  private unwrapArrayFromParsed<T>(parsed: any): T[] | null {
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object') {
      const candidate = parsed.tasks || parsed.microtasks || parsed.majorTasks || parsed.plan || parsed.items;
      if (Array.isArray(candidate)) return candidate;
    }
    return null;
  }

  private extractJsonArray<T>(text: string): T[] | null {
    if (!text) return null;
    const fencedMatches = Array.from(text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi));
    for (let i = fencedMatches.length - 1; i >= 0; i--) {
      try {
        const rawBlock = fencedMatches[i][1].trim();
        const parsed = JSON.parse(rawBlock);
        const unwrapped = this.unwrapArrayFromParsed<T>(parsed);
        if (unwrapped) return unwrapped;
      } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "geminiSupervisorProvider",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:geminiSupervisorProvider]", err);
      }
    }
    }

    try {
      const parsed = JSON.parse(text.trim());
      const unwrapped = this.unwrapArrayFromParsed<T>(parsed);
      if (unwrapped) return unwrapped;
    } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "geminiSupervisorProvider",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:geminiSupervisorProvider]", err);
      }
    }

    // Fallback: search for valid JSON array candidates ending at the last ']'
    const lastBracket = text.lastIndexOf(']');
    if (lastBracket !== -1) {
      let searchFrom = 0;
      while (searchFrom < lastBracket) {
        const bracketIdx = text.indexOf('[', searchFrom);
        if (bracketIdx === -1 || bracketIdx >= lastBracket) break;
        try {
          const candidate = text.substring(bracketIdx, lastBracket + 1);
          const parsed = JSON.parse(candidate);
          if (Array.isArray(parsed)) return parsed;
        } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "geminiSupervisorProvider",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:geminiSupervisorProvider]", err);
      }
    }
        searchFrom = bracketIdx + 1;
      }
    }

    return null;
  }

  private extractJsonObject<T>(text: string): T | null {
    if (!text) return null;
    const fencedMatches = Array.from(text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi));
    for (let i = fencedMatches.length - 1; i >= 0; i--) {
      try {
        const parsed = JSON.parse(fencedMatches[i][1].trim());
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return parsed;
      } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "geminiSupervisorProvider",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:geminiSupervisorProvider]", err);
      }
    }
    }

    try {
      const parsed = JSON.parse(text.trim());
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return parsed;
    } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "geminiSupervisorProvider",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:geminiSupervisorProvider]", err);
      }
    }

    // Fallback: search for valid JSON object candidates ending at the last '}'
    const lastBrace = text.lastIndexOf('}');
    if (lastBrace !== -1) {
      let searchFrom = 0;
      while (searchFrom < lastBrace) {
        const braceIdx = text.indexOf('{', searchFrom);
        if (braceIdx === -1 || braceIdx >= lastBrace) break;
        try {
          const candidate = text.substring(braceIdx, lastBrace + 1);
          const parsed = JSON.parse(candidate);
          if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return parsed;
        } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "geminiSupervisorProvider",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:geminiSupervisorProvider]", err);
      }
    }
        searchFrom = braceIdx + 1;
      }
    }

    return null;
  }
}

(GeminiSupervisorProvider as any)._defaultWaitForResponse = GeminiSupervisorProvider.prototype.waitForResponse;