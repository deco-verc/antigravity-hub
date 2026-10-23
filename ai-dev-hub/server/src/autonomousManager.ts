import crypto from 'node:crypto';
import { RunControl } from './runControl.js';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { db, validateWorkspaceDataIsolation } from './db.js';
import { normalizeOrRecoverVerificationCommand } from './verificationCommand.js';
import { MemoryManager } from './memoryManager.js';
import { GitManager } from './gitManager.js';
import { CheckpointManager } from './checkpointManager.js';
import { PolicyEngine, RiskLevel } from './policyEngine.js';
import { Logger } from './logger.js';
import { GeminiSupervisorProvider } from './geminiSupervisorProvider.js';
import { GitHubMcpClient } from './githubMcpClient.js';
import { ModelRegistry } from './modelRegistry.js';
import { UsageTracker } from './usageTracker.js';
import { DevAutonomyService } from './devAutonomyService.js';
import { ExecutionCoordinator } from './executionCoordinator.js';
import { QuotaManager } from './quotaManager.js';
import { IndependentEvaluator } from './independentEvaluator.js';
import { WorkerRegistry } from './workerRegistry.js';
import { ObservabilityService } from './observability/observabilityService.js';
import { EngineeringContextService } from './engineeringContextService.js';
import {
  HierarchicalOrchestrationService,
  TaskLifecycleState,
  MicrotaskLifecycleState,
  AgentRole,
  AgentRoleType,
  ReviewDecisionVerdict,
  ReplanType,
  MicrotaskSpec,
  AgentCommunicationInput,
  HierarchicalMicrotaskInput,
  HierarchicalMajorTaskInput
} from './hierarchicalOrchestrationService.js';

function safeJsonParse<T>(raw: any, fallback: T): T {
  if (!raw || typeof raw !== 'string') return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export interface AutonomousRunConfig {
  projectId: string;
  name: string;
  objective: string;
  briefing: string;
  completionCriteria?: string;
  maxHours?: number;
  maxCycles?: number;
  autonomyMode?: 'safe' | 'balanced' | 'autonomous';
  allowBrowser?: boolean;
  allowTerminal?: boolean;
  allowInstall?: boolean;
  isOvernight?: boolean;
  forceNew?: boolean;
  /** Internal durable handoff from a completed run, never a new model session. */
  continuationSourceRunId?: string;
  majorTasks?: HierarchicalMajorTaskInput[];
  requirements?: string[];
  successCriteria?: string[];
}

export interface TaskDefinition {
  title: string;
  description: string;
  milestone: string;
  dependencies?: string[]; // IDs or titles
  criteria?: string[];
}

export interface BuilderReportInput {
  runId: string;
  taskId: string;
  executionId?: string;
  attempt?: number;
  status: 'success' | 'failure' | 'partial';
  filesChanged: string[];
  implemented: string[];
  testsRun?: string;
  testResults?: string;
  buildStatus?: string;
  browserValidation?: string;
  screenshots?: string[];
  knownProblems?: string[];
  decisions?: Array<{ decision: string; rationale: string }>;
  recommendation?: string;
  evaluation?: any;
  councilDeliberation?: any;
}

export interface SupervisorReviewInput {
  runId: string;
  taskId: string;
  reportId?: string;
  executionId?: string;
  attempt?: number;
  verdict: 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED' | 'BLOCKED';
  feedback: string;
  requirementsMet?: boolean;
  buildPassed?: boolean;
  testsPassed?: boolean;
  uiFunctional?: boolean;
  qualityScore?: number;
  criteriaMet?: string[];
  criteriaFailed?: string[];
  issuesFound?: string[];
  nextAction?: string;
  evaluation?: any;
  enforceScopeCheck?: boolean;
  requireGitCommit?: boolean;
  requireCodeChanges?: boolean;
  simulateCommitFailure?: boolean;
  allowReworkOnBlocked?: boolean;
  enableAutoRepair?: boolean;
}

export class AutonomousManager {
  /**
   * Helper alias to trigger a scheduler tick across all running projects
   */
  public static async processRuns() {
    const { AutonomousRunnerService } = await import('./autonomousRunnerService.js');
    return AutonomousRunnerService.schedulerTick();
  }

  /**
   * Create and initialize a new Autonomous Run
   */
  static async createRun(config: AutonomousRunConfig) {
    ExecutionCoordinator.forceClean({ includeGlobal: true });
    ExecutionCoordinator.reconcileDeadReservations();
    let token: string;
    try { token = ExecutionCoordinator.acquire(`run-create:${config.projectId}`, { projectId:config.projectId }); }
    catch (err) {
      const existing: any = db.prepare("SELECT id FROM autonomous_runs WHERE project_id=? AND status NOT IN ('completed','failed') ORDER BY created_at DESC LIMIT 1").get(config.projectId);
      if (existing && !config.forceNew) return this.getRun(existing.id);
      throw err;
    }
    try { return await this.createReservedRun(config); }
    finally { ExecutionCoordinator.release(`run-create:${config.projectId}`,token); }
  }

  private static async createReservedRun(config: AutonomousRunConfig) {
    const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(config.projectId);
    if (!project) throw new Error('Projeto não encontrado.');
    if (project.path) {
      validateWorkspaceDataIsolation(project.path);
    }
    const queued = config.continuationSourceRunId ? this.getQueuedContinuation(config.continuationSourceRunId) : null;
    if (config.continuationSourceRunId) {
      const source: any = db.prepare('SELECT project_id,status FROM autonomous_runs WHERE id=?').get(config.continuationSourceRunId);
      if (!source || source.project_id !== project.id || source.status !== 'completed') throw Error('INVALID_CONTINUATION_SOURCE');
      const linked: any = db.prepare("SELECT id FROM autonomous_runs WHERE json_extract(CASE WHEN json_valid(config_json) THEN config_json ELSE '{}' END,'$.continuationSourceRunId')=? LIMIT 1").get(config.continuationSourceRunId);
      if (linked) return this.getRun(linked.id);
      if (!queued?.ids.length) throw Error('CONTINUATION_ALREADY_CONSUMED');
      config = {...config, objective:queued.text, briefing:queued.text};
    }
    const authorization = DevAutonomyService.isProjectAuthorizedForLiveExecution(project.id);
    if (!authorization.authorized) throw new Error(`AUTHORIZATION_GUARD: ${authorization.reason}`);

    // 0. Idempotency Guard: Reuse existing active run if not explicitly forced,
    // unless the existing active run is in error, blocked or has no pending tasks.
    const activeRun: any = db.prepare(`
      SELECT * FROM autonomous_runs
      WHERE project_id = ? AND status NOT IN ('completed', 'failed')
      ORDER BY created_at DESC
      LIMIT 1
    `).get(config.projectId);

    if (activeRun) {
      const taskCounts: any = db.prepare(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN status NOT IN ('completed', 'skipped') THEN 1 ELSE 0 END) as pending
        FROM autonomous_tasks
        WHERE run_id = ?
      `).get(activeRun.id);

      const totalTasks = Number(taskCounts?.total || 0);
      const pendingTasks = Number(taskCounts?.pending || 0);
      const hasNoPendingTasks = totalTasks > 0 ? (pendingTasks === 0) : true;
      const isStalledOrErrored = ['error', 'blocked', 'paused', 'waiting_resource'].includes(activeRun.status) || totalTasks === 0;

      if (config.forceNew || isStalledOrErrored || hasNoPendingTasks) {
        const finalStatus = isStalledOrErrored ? 'failed' : 'completed';
        const nowIso = new Date().toISOString();
        db.prepare(`
          UPDATE autonomous_runs
          SET status = ?, end_time = COALESCE(end_time, ?), next_action = 'Finalizado para permitir nova execução', updated_at = ?
          WHERE id = ?
        `).run(finalStatus, nowIso, nowIso, activeRun.id);
        db.prepare("UPDATE worker_leases SET status = 'released' WHERE run_id = ? AND status = 'active'").run(activeRun.id);
        db.prepare(`
          DELETE FROM execution_reservations
          WHERE json_extract(CASE WHEN json_valid(context_json) THEN context_json ELSE '{}' END, '$.runId') = ?
        `).run(activeRun.id);
        Logger.info(`[AutonomousManager] Run ativo anterior [${activeRun.id.slice(0, 8)}] (${activeRun.status}, total: ${totalTasks}, pendentes: ${pendingTasks}, forceNew: ${Boolean(config.forceNew)}) finalizado automaticamente como '${finalStatus}'. Criando novo run sem rejeição.`);
      } else {
        Logger.info(`[AutonomousManager] Run ativo já existente para ${project.name}: [${activeRun.id.slice(0, 8)}] (${activeRun.status}). Reutilizando run com idempotência.`);
        return this.getRun(activeRun.id);
      }
    }

    const runId = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    const dateTag = new Date().toISOString().slice(0, 10);
    const branchName = `ai/autonomous-build-${dateTag}-${runId.slice(0, 6)}`;

    const name = config.name || `Build Autônomo #${new Date().toLocaleTimeString('pt-BR')}`;
    const objective = config.objective || (config as any).goal || 'Construção autônoma do MVP';
    const briefing = config.briefing || objective;
    const maxHours = config.maxHours || ((config as any).timeBudgetMinutes ? (config as any).timeBudgetMinutes / 60 : (config.isOvernight ? 8.0 : 4.0));
    const maxCycles = config.maxCycles || (config as any).maxIterations || (config.isOvernight ? 50 : 25);
    const autonomyMode = config.autonomyMode || (config as any).mode || (config.isOvernight ? 'autonomous' : 'balanced');

    // 1. Persist Run in SQLite immediately so concurrent callers observe active run
    db.exec('BEGIN IMMEDIATE');
    try { db.prepare(`
      INSERT INTO autonomous_runs (
        id, project_id, name, objective, briefing, status, autonomy_mode,
        branch_name, max_hours, max_cycles, current_cycle, start_time,
        config_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'planning', ?, ?, ?, ?, 0, ?, ?, ?, ?)
    `).run(
      runId,
      project.id,
      name,
      objective,
      briefing,
      autonomyMode,
      branchName,
      maxHours,
      maxCycles,
      nowIso,
      JSON.stringify(config),
      nowIso,
      nowIso
    );
      // Intent is consumed only in the same transaction as its durable target Run.
      for (const id of queued?.ids || []) {
        const event: any = db.prepare('SELECT metadata_json FROM autonomous_events WHERE id=? AND run_id=?').get(id, config.continuationSourceRunId!);
        if (event && event.metadata_json) {
          try {
            const metadata = JSON.parse(event.metadata_json);
            db.prepare('UPDATE autonomous_events SET metadata_json=? WHERE id=?').run(JSON.stringify({...metadata, consumed:true, consumedAt:nowIso, targetRunId:runId}),id);
          } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autonomousManager",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousManager]", err);
      }
    }
        }
      }
      db.exec('COMMIT');
    } catch(error) { db.exec('ROLLBACK'); throw error; }

    // 2. Git Safety: Create dedicated isolated branch
    try {
      if (fs.existsSync(path.join(project.path, '.git'))) {
        execSync(`git checkout -b "${branchName}"`, { cwd: project.path, stdio: 'pipe' });
        Logger.info(`Branch isolada criada: ${branchName} em ${project.name}`);
      }
    } catch (err: any) {
      Logger.warn(`Não foi possível criar branch isolada: ${err.message}`);
    }

    // 3. Log initial event
    this.logEvent(runId, null, 'system', 'RUN_CREATED', `Run registrado; aguardando planejamento: "${config.name}" (${autonomyMode.toUpperCase()})`);

    ObservabilityService.emit({
      level: 'INFO',
      event: 'run.created',
      message: `Run autônomo "${config.name}" criado (${runId.slice(0, 8)}) [Modo: ${autonomyMode}]`,
      service: 'manager',
      runId,
      projectId: project.id,
      status: 'planning',
      metadata: { name: config.name, autonomyMode, branchName, maxHours, maxCycles }
    });

    // 4. Generate initial task plan dynamically via Gemini Supervisor
    const isTestRuntime =
      process.env.NODE_ENV === 'test' ||
      Boolean(process.env.NODE_TEST_CONTEXT) ||
      process.execArgv.some(a => a.startsWith('--test')) ||
      Boolean((globalThis as any).__DECOHUB_TEST_RUNTIME__);
    const isOffline =
      process.env.DECOHUB_OFFLINE_MODE === 'true' ||
      (await import('./agentApiGateway.js')).AgentApiGateway.isOfflineMode();

    try {
      let plannedTasks: TaskDefinition[] | null = null;
      const { AgentApiGateway } = await import('./agentApiGateway.js');
      if (AgentApiGateway.isOfflineMode()) {
        const mockProvider = AgentApiGateway.getMockProvider();
        const customPlan = mockProvider?.getResponse?.(project.id, 'PLAN');
        if (customPlan) {
          try {
            const raw = JSON.parse(customPlan);
            if (Array.isArray(raw) && raw.length > 0) {
              plannedTasks = raw;
            }
          } catch {}
        }
      }

      if (!plannedTasks || plannedTasks.length === 0) {
        const { HierarchicalOrchestrationService } = await import('./hierarchicalOrchestrationService.js');
        plannedTasks = HierarchicalOrchestrationService.generateMultiPassPlannedTasks({
          briefing: briefing || 'Construção autônoma do software',
          projectPath: project.path,
          projectName: project.name,
          projectId: project.id,
          requirements: config.requirements
        }) as any;
      }

      if (plannedTasks && plannedTasks.length > 0) {
        await this.persistPlannedTasks(runId, plannedTasks, project, briefing, config);
        db.prepare("UPDATE autonomous_runs SET status='running',last_error=NULL,next_action='Plano criado com sucesso; aguardando despacho ao Worker',updated_at=? WHERE id=?")
          .run(new Date().toISOString(), runId);

        ObservabilityService.emit({
          level: 'INFO',
          event: 'run.tasks_planned',
          message: `Tarefas planejadas imediatamente para run ${runId.slice(0, 8)} (${plannedTasks.length} tarefas)`,
          service: 'manager',
          runId,
          projectId: project.id,
          status: 'running'
        });

        try {
          const { SseStreamService } = await import('./sseStreamService.js');
          SseStreamService.broadcast(project.id, 'run_updated', { runId, status: 'running', taskCount: plannedTasks.length });
        } catch {}

        // Disparo assíncrono não-bloqueante do scheduler em 100ms para permitir resposta HTTP imediata em < 200ms
        setTimeout(async () => {
          try {
            const { AutonomousRunnerService } = await import('./autonomousRunnerService.js');
            AutonomousRunnerService.schedulerTick();
          } catch (tickErr: any) {
            Logger.warn(`[AutonomousManager] Aviso ao disparar schedulerTick: ${tickErr.message}`);
          }
        }, 100);

        Logger.success(`[AutonomousManager] Run [${runId.slice(0, 8)}] criado e planejado instantaneamente (${plannedTasks.length} tarefas prontas) para ${project.name}`);
        return this.getRun(runId);
      }
    } catch (err: any) {
      if (RunControl.get(runId)) {
        this.logEvent(runId, null, 'system', 'RUN_OPERATION_FAILURE', err.message);
        if (RunControl.apply(runId, true)) return this.getRun(runId);
      }
      Logger.error(`[AutonomousManager] Falha ao planejar tarefas para Run [${runId.slice(0, 8)}]: ${err.message}`);
      db.prepare("UPDATE autonomous_runs SET status = 'error', last_error = ?, next_action = 'Verificar configuração do projeto', updated_at = ? WHERE id = ?")
        .run(err.message, new Date().toISOString(), runId);
      this.logEvent(runId, null, 'system', 'PLAN_GENERATION_FAILED', err.message);
      throw err;
    }

    Logger.success(`Autonomous Run [${runId.slice(0, 8)}] criado com sucesso para ${project.name}`);
    return this.getRun(runId);
  }

  static getQueuedContinuation(runId:string): {ids:string[];text:string} {
    const ids:string[]=[], texts:string[]=[];
    for(const event of db.prepare("SELECT id,metadata_json FROM autonomous_events WHERE run_id=? AND event_type='QUEUED_USER_INSTRUCTION' ORDER BY created_at,id").all(runId) as any[]){
      try {const meta=JSON.parse(event.metadata_json);if(typeof meta.content==='string'&&meta.content&&!meta.consumed&&!meta.cancelled&&meta.durableContinuation===true){ids.push(event.id);texts.push(meta.content);}}catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autonomousManager",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousManager]", err);
      }
    }
    }
    return {ids,text:texts.join('\n\n')};
  }

  static cancelQueuedInstructions(projectId: string, messageId?: string): { cancelledCount: number } {
    let cancelledCount = 0;
    const activeRun = this.getActiveRunForProject(projectId);
    if (activeRun) {
      const events = db.prepare("SELECT id, metadata_json FROM autonomous_events WHERE run_id = ? AND event_type = 'QUEUED_USER_INSTRUCTION'").all(activeRun.id) as any[];
      for (const ev of events) {
        try {
          const meta = JSON.parse(ev.metadata_json || '{}');
          const matches = !messageId || meta.messageId === messageId;
          if (matches && !meta.consumed && !meta.cancelled) {
            meta.consumed = true;
            meta.cancelled = true;
            db.prepare('UPDATE autonomous_events SET metadata_json = ? WHERE id = ?').run(JSON.stringify(meta), ev.id);
            cancelledCount++;
          }
        } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autonomousManager",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousManager]", err);
      }
    }
      }
    }
    return { cancelledCount };
  }

  /**
   * Helper to decompose initial briefing into a structured DAG using real Gemini Supervisor
   */
  private static async generateInitialTasks(runId: string, config: AutonomousRunConfig, project: any) {
    const existingCount = (db.prepare('SELECT COUNT(*) as count FROM autonomous_tasks WHERE run_id = ?').get(runId) as any)?.count || 0;
    if (existingCount > 0) {
      Logger.info(`[AutonomousManager] Tarefas já planejadas para o Run [${runId.slice(0, 8)}] (${existingCount} tarefas). Pulando geração de DAG duplicada.`);
      return;
    }

    const { AccountProfileManager } = await import('./accountProfileManager.js');
    const { AutonomousRunnerService } = await import('./autonomousRunnerService.js');
    const auth = DevAutonomyService.isProjectAuthorizedForLiveExecution(project.id);
    if (!auth.authorized) throw new Error(`AUTHORIZATION_GUARD: ${auth.reason}`);
    try {
      const { SessionCircuitBreaker } = await import('./sessionCircuitBreaker.js');
      SessionCircuitBreaker.resetProjectWindow(project.id);
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autonomousManager",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousManager]", err);
      }
    }
    ExecutionCoordinator.forceClean({ scope: 'global-agent-execution', includeGlobal: true });
    ExecutionCoordinator.reconcileDeadReservations('global-agent-execution');
    const reservation = ExecutionCoordinator.acquire('global-agent-execution', { projectId: project.id, runId, phase: 'planning' });
    AutonomousRunnerService.setExecutionPhase('SUPERVISOR_PLANNING');

    const profile = AccountProfileManager.getActiveProfileForProject(project.id);
    const preferences = ModelRegistry.getPreferences(profile?.id, project.id);
    const modelConfig = ModelRegistry.resolveModelConfig({
      preference: preferences.supervisor || preferences.reviewer || preferences.default,
      role: 'supervisor',
      projectId: project.id,
      accountProfileId: profile?.id
    });
    const resolvedSupervisorModel = modelConfig.modelId;

    let supervisorEnv: NodeJS.ProcessEnv;
    try { supervisorEnv = AccountProfileManager.getExecutionEnvForProfile(profile, project.id); }
    catch (err) { AutonomousRunnerService.releaseExecutionLock(); ExecutionCoordinator.release('global-agent-execution', reservation); throw err; }
    const supervisor = new GeminiSupervisorProvider(
      resolvedSupervisorModel,
      supervisorEnv,
      profile?.id,
      project?.id,
      modelConfig.intelligenceLevel
    );
    const startTime = Date.now();
    const briefing = config.briefing || config.objective || 'Construção autônoma do software';

    // 1. Research Gate: Investigate context, assumptions, and constraints
    const { EngineeringContextService } = await import('./engineeringContextService.js');
    const researchResult = EngineeringContextService.evaluateResearch(
      briefing,
      project.stack || '',
      config.autonomyMode === 'safe' ? 'high' : 'medium'
    );
    if (researchResult.needsResearch) {
      this.logEvent(
        runId,
        null,
        'system',
        'RESEARCH_COMPLETED',
        `Investigação de contexto concluída: ${researchResult.findings.length} constatações (${researchResult.safeToAdopt ? 'fontes seguras' : 'hipóteses pendentes'}).`,
        {
          findingsCount: researchResult.findings.length,
          safeToAdopt: researchResult.safeToAdopt,
          sourceReliability: researchResult.sourceReliability
        }
      );
      try {
        db.prepare('UPDATE autonomous_runs SET research_summary_json = ? WHERE id = ?')
          .run(JSON.stringify({ findings: researchResult.findings, safeToAdopt: researchResult.safeToAdopt }), runId);
      } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autonomousManager",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousManager]", err);
      }
    }
    }

    // 1.5. Detect if project is greenfield or an existing structured project (DELTA_EVOLUTION mode)
    const { DeltaFeatureEngine } = await import('./deltaFeatureEngine.js');
    const existingDetection = DeltaFeatureEngine.isExistingProject(project.path, project.id);
    const supervisorPlanningMode = existingDetection.isExisting ? 'DELTA_EVOLUTION' : 'INITIAL_PLAN';

    // FASE 23C: Onda 0 Executive Specifications & Chat Announcement
    const { ReaSaaSMasterService } = await import('./reaSaaSMasterService.js');
    const isSaaSOrSpecApp = ReaSaaSMasterService.isSaaSOrFullStackProject(briefing) ||
      (project.path ? fs.existsSync(path.join(path.resolve(project.path), '.ai-dev-hub', 'specs', 'CONTEUDO.md')) : false);

    if (supervisorPlanningMode === 'INITIAL_PLAN' && isSaaSOrSpecApp) {
      try {
        const { ProjectLivingSpecService } = await import('./projectLivingSpecService.js');
        await ProjectLivingSpecService.generateAndPersistLivingSpecs({
          projectName: project.name,
          projectPath: project.path,
          projectId: project.id,
          briefing,
          runId
        });
      } catch (specErr: any) {
        Logger.warn(`[AutonomousManager] Falha não bloqueante na Onda 0 (Living Specs): ${specErr.message}`);
      }
    } else if (supervisorPlanningMode === 'DELTA_EVOLUTION' && isSaaSOrSpecApp) {
      try {
        const { ProjectLivingSpecService } = await import('./projectLivingSpecService.js');
        ProjectLivingSpecService.appendDeltaFeatureToSpecs(project.path, briefing);
      } catch (specErr: any) {
        Logger.warn(`[AutonomousManager] Falha não bloqueante na atualização de specs vivas em DELTA_EVOLUTION: ${specErr.message}`);
      }
    }

    if (existingDetection.isExisting) {
      Logger.info(`[AutonomousManager] Projeto existente detectado para o Run [${runId.slice(0, 8)}] (${existingDetection.reason}). Ativando modo DELTA_EVOLUTION.`);
      this.logEvent(
        runId,
        null,
        'supervisor',
        'DELTA_EVOLUTION_DETECTED',
        `Projeto existente detectado: ${existingDetection.reason}. Ativando planejamento cirúrgico aditivo (DELTA_EVOLUTION).`,
        { completedRunCount: existingDetection.completedRunCount, reason: existingDetection.reason }
      );
    }

    const { HierarchicalOrchestrationService } = await import('./hierarchicalOrchestrationService.js');
    let plannedTasks: TaskDefinition[] = [];
    try {
      const planPromise = supervisor.planTasks(briefing, {
        id: project.id,
        name: project.name,
        path: project.path,
        objective: config.objective || project.objective
      }, {
        mode: supervisorPlanningMode,
        runId,
        multiPass: supervisorPlanningMode === 'INITIAL_PLAN',
        deepPlanning: supervisorPlanningMode === 'INITIAL_PLAN'
      });

      const timeoutPromise = new Promise<TaskDefinition[]>((_, reject) => {
        setTimeout(() => reject(new Error('SUPERVISOR_PLAN_TIMEOUT_5S')), 5000);
      });

      plannedTasks = await Promise.race([planPromise, timeoutPromise]);
    } catch (supErr: any) {
      if (/RESOURCE_EXHAUSTED|code 429|Individual quota reached|QUOTA_EXHAUSTED/i.test(supErr.message)) {
        if (profile?.id) {
          AccountProfileManager.markQuotaExhausted(profile.id, supErr.message);
        }
        throw supErr;
      }
      Logger.warn(`[AutonomousManager] Supervisor não concluiu planejamento em 5s ou falhou (${supErr.message}). Acionando fallback determinístico.`);
      plannedTasks = HierarchicalOrchestrationService.generateMultiPassPlannedTasks({
        briefing,
        projectId: project.id,
        projectName: project.name,
        projectPath: project.path
      }) as any;
    } finally {
      AutonomousRunnerService.releaseExecutionLock();
      ExecutionCoordinator.release('global-agent-execution', reservation);
    }

    // Persistência imediata das tarefas e disparo da execução
    await this.persistPlannedTasks(runId, plannedTasks, project, briefing, config);

    db.prepare("UPDATE autonomous_runs SET status='running',last_error=NULL,next_action='Plano criado; aguardando despacho ao Worker',updated_at=? WHERE id=? AND status='planning'")
      .run(new Date().toISOString(), runId);
    Logger.success(`[AutonomousManager] Run [${runId.slice(0, 8)}] planejado com sucesso; disparando schedulerTick...`);
    try {
      const { SseStreamService } = await import('./sseStreamService.js');
      SseStreamService.broadcast(project.id, 'run_updated', { runId, status: 'running' });
    } catch {}
    try {
      const { AutonomousRunnerService } = await import('./autonomousRunnerService.js');
      AutonomousRunnerService.schedulerTick();
    } catch (tickErr: any) {
      Logger.warn(`[AutonomousManager] Aviso ao disparar schedulerTick em background: ${tickErr.message}`);
    }

    const supervisorEvidence = supervisor.getExecutionEvidence();
    UsageTracker.recordEvent({
      accountProfileId: profile.id,
      modelId: resolvedSupervisorModel,
      role: 'supervisor',
      projectId: project.id,
      conversationId: supervisorEvidence.conversationId,
      durationMs: Date.now() - startTime,
      status: 'success',
      metadata: {
        requested_model: resolvedSupervisorModel,
        requested_intelligence: supervisorEvidence.requestedIntelligence || 'HIGH',
        actual_model: supervisorEvidence.actualModel,
        actual_model_verified: false,
        fallback_reason: supervisorEvidence.fallbackReason,
        token_telemetry: 'TOKEN_TELEMETRY_UNAVAILABLE',
        quota_telemetry: 'QUOTA_TELEMETRY_UNAVAILABLE'
      }
    });

    // Deliberação do Conselho não-bloqueante em background com timeout de 15s
    const { CouncilManager } = await import('./councilManager.js');
    const planTrigger = CouncilManager.shouldTriggerCouncil({
      riskLevel: config.autonomyMode === 'safe' ? 'high' : 'medium',
      isArchitectureChange: true,
      filesChanged: []
    });

    if (planTrigger.required || config.autonomyMode === 'safe') {
      const deliberateBackground = async () => {
        try {
          const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('COUNCIL_TIMEOUT_15S')), 15000));
          const planDeliberation = await Promise.race([
            CouncilManager.deliberate({
              taskId: `plan-${runId.slice(0, 8)}`,
              projectId: project.id,
              runId,
              task: {
                title: `Plano Arquitetural: ${config.name}`,
                description: briefing,
                plannedTasks
              },
              riskLevel: 'high',
              policyTrigger: 'PLAN_ARCHITECTURE_CRITIQUE'
            }),
            timeoutPromise
          ]) as any;

          this.logEvent(
            runId,
            null,
            'supervisor',
            'COUNCIL_PLAN_CRITIQUE',
            `[CONSELHO] Conselho deliberou sobre o plano: ${planDeliberation.chairmanVerdict} (Consenso: ${planDeliberation.consensusLevel}, Simplicidade: ${planDeliberation.scores?.simplicity}/10, Corretude: ${planDeliberation.scores?.correctness}/10)`,
            {
              deliberationId: planDeliberation.id,
              verdict: planDeliberation.chairmanVerdict,
              scores: planDeliberation.scores,
              actionItems: planDeliberation.actionItems
            }
          );

          try {
            db.prepare('UPDATE autonomous_runs SET plan_deliberation_id = ? WHERE id = ?')
              .run(planDeliberation.id, runId);
          } catch {}
        } catch (councilErr: any) {
          Logger.warn(`[AutonomousManager] Conselho não concluiu crítica do plano (não-bloqueante): ${councilErr.message}`);
        }
      };
      deliberateBackground().catch(() => {});
    }
  }

  public static async persistPlannedTasks(
    runId: string,
    rawTasks: any[],
    project: any,
    briefing?: string,
    config?: any
  ): Promise<void> {
    const { HierarchicalOrchestrationService } = await import('./hierarchicalOrchestrationService.js');
    let plannedTasks = (rawTasks || []).map((t, idx) => {
      const title = (t.title || `Tarefa ${idx + 1}`).trim();
      const description = (t.description || title || `Implementação de ${title}`).trim();
      const criteria = Array.isArray(t.criteria) && t.criteria.length > 0
        ? t.criteria.map((c: any) => String(c).trim()).filter(Boolean)
        : [`Implementar ${title} atendendo aos requisitos funcionais com testes passando.`];
      return {
        ...t,
        title,
        description,
        criteria,
        milestone: t.milestone || 'MVP'
      };
    });

    if (!plannedTasks.length) {
      throw new Error('SUPERVISOR_INVALID_PLAN: tarefas exigem título, descrição e critérios de aceitação.');
    }

    // Automatically subdivide any oversized microtasks before persisting so no monolithic task bypasses decomposition
    // Mas se o plano já vier decomposto (>= 10 microtarefas atômicas), proíbe a subdivisão duplicada/mecânica
    const shouldSubdivide = plannedTasks.length < 10;
    plannedTasks = HierarchicalOrchestrationService.validateAndSubdivideMicrotasks(
      plannedTasks as any,
      { subdivideOversized: shouldSubdivide }
    ) as any;

    // Apply Deterministic DAG Auto-Healer to normalize multi-key dependencies and break any cycles
    plannedTasks = HierarchicalOrchestrationService.autoHealAndNormalizeTaskGraph(plannedTasks as any) as any;

    const nowIso = new Date().toISOString();
    const ids = plannedTasks.map((t: any) => t.id || crypto.randomUUID());
    const titleToId = new Map<string, string>();
    const codeToId = new Map<string, string>();
    const idToId = new Map<string, string>();
    plannedTasks.forEach((t, i) => {
      titleToId.set(t.title.trim().toLowerCase(), ids[i]);
      if ((t as any).code) codeToId.set(String((t as any).code).trim().toLowerCase(), ids[i]);
      if ((t as any).id) idToId.set(String((t as any).id).trim().toLowerCase(), ids[i]);
    });

    const dependencies = plannedTasks.map((task, index) => {
      const taskDeps = Array.isArray(task.dependencies) ? task.dependencies : [];
      const resolved: string[] = [];
      for (const rawDep of taskDeps) {
        const depKey = String(rawDep || '').trim().toLowerCase();
        if (!depKey) continue;
        const target = titleToId.get(depKey)
          || codeToId.get(depKey)
          || idToId.get(depKey)
          || null;
        if (target && target !== ids[index] && !resolved.includes(target)) {
          resolved.push(target);
        }
      }
      // Encadeamento sequencial estrito por onda:
      // Se não for a tarefa de fundação inicial (index > 0) e não tiver dependência resolvida,
      // encadeia obrigatoriamente na tarefa imediatamente anterior para impedir tarefas órfãs em 'ready'
      if (index > 0 && resolved.length === 0) {
        resolved.push(ids[index - 1]);
      }
      return resolved;
    });

    const visited = new Set<number>();
    const visiting = new Set<number>();
    const visit = (index: number): void => {
      if (visited.has(index)) return;
      if (visiting.has(index)) {
        Logger.warn(`[AutonomousManager] Ciclo residual prevenido no índice ${index}.`);
        return;
      }
      visiting.add(index);
      for (const depId of dependencies[index]) {
        const depIdx = ids.indexOf(depId);
        if (depIdx >= 0) visit(depIdx);
      }
      visiting.delete(index);
      visited.add(index);
    };
    plannedTasks.forEach((_task, i) => visit(i));
    // Persist the complete plan atomically. GitHub synchronization occurs on task dispatch.
    db.exec('BEGIN IMMEDIATE');
    try {
      const count = (db.prepare('SELECT COUNT(*) n FROM autonomous_tasks WHERE run_id=?').get(runId) as any).n;
      if (!count) {
        const { SkillRouter } = await import('./skillRouter.js');
        plannedTasks.forEach((task, i) => {
          const routed = SkillRouter.routeTask(task, { stack: project.stack, projectObjective: project.objective, projectPath: project.path });
          const normCmd = (task as any).verificationCommandMeta || normalizeOrRecoverVerificationCommand((task as any).verificationCommand, project.path || '.', { allowUncreatedFiles: true });
          (task as any).verificationCommand = normCmd.command;
          if (!normCmd.validInitially || normCmd.recovered) {
            this.logEvent(
              runId,
              ids[i],
              'system',
              'VERIFICATION_COMMAND_NORMALIZED',
              `Comando de verificação incompatível na tarefa "${task.title}" normalizado de "${normCmd.originalCommand}" para "${normCmd.command}" (${normCmd.reason || 'gramática controlada'}).`,
              {
                taskId: ids[i],
                originalCommand: normCmd.originalCommand,
                normalizedCommand: normCmd.command,
                reason: normCmd.reason
              }
            );
          }
          const expectedFiles = Array.isArray((task as any).expectedFiles)
            ? (task as any).expectedFiles
            : (Array.isArray((task as any).expected_files) ? (task as any).expected_files : []);
          const protectedEvalFiles = Array.isArray((task as any).protectedEvaluationFiles)
            ? (task as any).protectedEvaluationFiles
            : (Array.isArray((task as any).protected_evaluation_files) ? (task as any).protected_evaluation_files : null);
          const initialStatus = i === 0 && dependencies[i].length === 0 ? 'ready' : 'pending';
          try {
            db.prepare(`INSERT INTO autonomous_tasks (id,run_id,title,description,milestone,order_index,dependencies_json,status,assigned_to,criteria_json,created_at,updated_at,verification_command,done_when,skill_routed,skill_confidence,skill_guidelines_json,expected_files_json,protected_evaluation_files_json)
              VALUES (?,?,?,?,?,?,?,?, 'builder',?,?,?,?,?, ?, ?, ?, ?, ?)`).run(
                ids[i],runId,task.title,task.description,task.milestone || 'MVP',i+1,
                JSON.stringify(dependencies[i]),initialStatus,
                JSON.stringify(task.criteria),nowIso,nowIso,
                (task as any).verificationCommand || null,(task as any).doneWhen || null,
                routed.skill, 1.0, JSON.stringify(routed.guidelines || routed.priorityInvariants),
                JSON.stringify(expectedFiles),
                protectedEvalFiles ? JSON.stringify(protectedEvalFiles) : null
            );
          } catch {
            try {
              db.prepare(`INSERT INTO autonomous_tasks (id,run_id,title,description,milestone,order_index,dependencies_json,status,assigned_to,criteria_json,created_at,updated_at,verification_command,done_when,skill_routed,skill_guidelines_json,expected_files_json,protected_evaluation_files_json)
                VALUES (?,?,?,?,?,?,?,?, 'builder',?,?,?,?,?, ?, ?, ?, ?)`).run(
                  ids[i],runId,task.title,task.description,task.milestone || 'MVP',i+1,
                  JSON.stringify(dependencies[i]),initialStatus,
                  JSON.stringify(task.criteria),nowIso,nowIso,
                  (task as any).verificationCommand || null,(task as any).doneWhen || null,
                  routed.skill, JSON.stringify(routed.guidelines || routed.priorityInvariants),
                  JSON.stringify(expectedFiles),
                  protectedEvalFiles ? JSON.stringify(protectedEvalFiles) : null
              );
            } catch {
              // Fallback if migration columns not in active table
              db.prepare(`INSERT INTO autonomous_tasks (id,run_id,title,description,milestone,order_index,dependencies_json,status,assigned_to,criteria_json,created_at,updated_at,verification_command,done_when)
                VALUES (?,?,?,?,?,?,?,?, 'builder',?,?,?,?,?)`).run(
                  ids[i],runId,task.title,task.description,task.milestone || 'MVP',i+1,
                  JSON.stringify(dependencies[i]),initialStatus,
                  JSON.stringify(task.criteria),nowIso,nowIso,
                  (task as any).verificationCommand || null,(task as any).doneWhen || null
              );
            }
          }
        });
      }
      this.logEvent(runId,null,'supervisor','TASKS_PLANNED',`Supervisor criou plano específico com ${plannedTasks.length} tarefas.`, { source: 'supervisor', taskIds: ids });
      db.exec('COMMIT');
      try {
        HierarchicalOrchestrationService.persistHierarchicalPlan({
          projectId: project.id,
          runId,
          projectPath: project.path || '.',
          originalDescription: briefing || project.objective || project.description || '',
          requirements: config?.requirements,
          successCriteria: config?.successCriteria,
          majorTasks: config?.majorTasks,
          flatTasks: plannedTasks.map((t, idx) => ({
            ...(t as any),
            id: ids[idx],
            dependencies: dependencies[idx],
            orderIndex: idx + 1
          })),
          subdivideOversized: plannedTasks.length < 10,
          autoHealGraph: true
        });
      } catch (hierErr: any) {
        Logger.warn(`[AutonomousManager] Aviso ao enriquecer hierarquia do plano: ${hierErr.message}`);
      }
    } catch (err) { try { db.exec('ROLLBACK'); } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autonomousManager",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousManager]", err);
      }
    } throw err; }
  }

  /**
   * Log an event to the Activity Stream
   */
  static logEvent(runId: string, taskId: string | null, agentRole: 'supervisor' | 'builder' | 'evaluator' | 'system' | 'user', eventType: string, message: string, metadata?: any) {
    const id = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    try {
      db.prepare(`
        INSERT INTO autonomous_events (id, run_id, task_id, agent_role, event_type, message, metadata_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, runId, taskId, agentRole, eventType, message, metadata ? JSON.stringify(metadata) : null, nowIso);
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autonomousManager",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousManager]", err);
      }
    }
  }

  /**
   * Resolves active slash command, provisioned skills list, and worker specialty for a run.
   */
  static resolveRunSkillsMetadata(run: any, parsedTasks: any[] = [], projectPath?: string): {
    activeSlashCommand: string | null;
    activeSkillsList: string[];
    currentExecutionSpecialty: string | null;
  } {
    const COMMAND_CATALOG: Array<{ command: string; title: string; skills: string[]; pattern?: RegExp }> = [
      {
        command: '/frontend',
        title: 'Frontend & UI Craft Elevado',
        skills: ['taste-skill', 'ui-styling', 'design-system', 'stitch-skill', 'vercel-web-design-guidelines'],
        pattern: /\/frontend|\/ui|\/taste|frontend/i
      },
      {
        command: '/redesign',
        title: 'Redesign Integral & Modernização UI',
        skills: ['redesign-skill', 'design', 'ui-styling', 'design-system', 'brandkit'],
        pattern: /\/redesign|\/refactor-ui|redesign/i
      },
      {
        command: '/style',
        title: 'Arquétipo Estético & Sistema de Cores',
        skills: ['minimalist-skill', 'brutalist-skill', 'soft-skill', 'design-system'],
        pattern: /\/style|estilo:|arquétipo estético/i
      },
      {
        command: '/image',
        title: 'Captura Visual Real Playwright',
        skills: ['playwright-agent-cli'],
        pattern: /\/image|\/shot|\/screenshot|\/print/i
      },
      {
        command: '/img2code',
        title: 'Conversão de Print para Código (Image-to-Code)',
        skills: ['image-to-code-skill', 'imagegen-frontend-web', 'imagegen-frontend-mobile', 'stitch-skill'],
        pattern: /\/img2code|\/vision-ui|image-to-code/i
      },
      {
        command: '/rea',
        title: 'Arquitetura SaaS Resiliente (REA Master)',
        skills: ['rea-saas-master', 'resilience', 'saas-architecture'],
        pattern: /\/rea|rea-saas|saas-master/i
      },
      {
        command: '/karpathy',
        title: 'Engenharia de Prompt & Arquitetura Karpathy',
        skills: ['karpathy-prompting', 'reasoning-patterns'],
        pattern: /\/karpathy|karpathy/i
      },
      {
        command: '/security',
        title: 'Auditoria de Segurança & Pentest',
        skills: ['security-pentest', 'vulnerability-scanner'],
        pattern: /\/security|\/pentest|pentest/i
      },
      {
        command: '/ux',
        title: 'Simulação de Experiência do Usuário (UX/A11y)',
        skills: ['ux-simulator', 'accessibility-a11y'],
        pattern: /\/ux|acessibilidade|a11y/i
      },
      {
        command: '/docs',
        title: 'Documentação Técnica & API Specs',
        skills: ['docsimp-generator', 'api-docs'],
        pattern: /\/docs|documentação/i
      },
      {
        command: '/plan-ceo',
        title: 'Planejamento Estratégico de Produto (CEO Mode)',
        skills: ['strategic-planning'],
        pattern: /\/plan-ceo|plan-ceo/i
      },
      {
        command: '/plan-eng',
        title: 'Especificação de Engenharia & Arquitetura (Eng Mode)',
        skills: ['engineering-spec'],
        pattern: /\/plan-eng|plan-eng/i
      }
    ];

    const runName = String(run?.name || '');
    const runBriefing = String(run?.briefing || '');
    const runObjective = String(run?.objective || '');
    const combinedText = `${runName}\n${runBriefing}\n${runObjective}`;

    // 1. Direct match on command name or "COMANDO DISPARADO: /cmd"
    let matchedCmd = COMMAND_CATALOG.find(c => {
      if (runName.startsWith(`${c.command}:`) || runName.startsWith(c.command)) return true;
      if (combinedText.includes(`COMANDO DISPARADO: ${c.command}`)) return true;
      return false;
    });

    if (!matchedCmd) {
      // 2. Name regex pattern
      matchedCmd = COMMAND_CATALOG.find(c => c.pattern && c.pattern.test(runName));
    }

    if (!matchedCmd) {
      // 3. Objective regex pattern
      matchedCmd = COMMAND_CATALOG.find(c => c.pattern && c.pattern.test(runObjective));
    }

    const activeSlashCommand = matchedCmd ? `${matchedCmd.command} — ${matchedCmd.title}` : null;

    // Collect skills
    const skillsSet = new Set<string>();
    if (matchedCmd) {
      matchedCmd.skills.forEach(s => skillsSet.add(s));
    }

    // Add skills from tasks (skillGuidelines and skill_routed)
    for (const t of parsedTasks) {
      if (Array.isArray(t.skillGuidelines)) {
        for (const g of t.skillGuidelines) {
          if (typeof g === 'string') {
            const trimmed = g.trim();
            if (trimmed.length > 0 && trimmed.length <= 40 && !trimmed.includes('\n') && !trimmed.startsWith('[')) {
              skillsSet.add(trimmed);
            }
          }
          else if (g?.name && typeof g.name === 'string' && g.name.length <= 40) skillsSet.add(g.name);
          else if (g?.skill && typeof g.skill === 'string' && g.skill.length <= 40) skillsSet.add(g.skill);
        }
      }
      if (t.skill_routed && typeof t.skill_routed === 'string' && t.skill_routed.length <= 40) {
        skillsSet.add(t.skill_routed);
      }
    }

    // Add provisioned skills from disk (.ai-dev-hub/skills/)
    if (projectPath && fs.existsSync(projectPath)) {
      const skillsDir = path.join(projectPath, '.ai-dev-hub', 'skills');
      if (fs.existsSync(skillsDir)) {
        try {
          const files = fs.readdirSync(skillsDir);
          for (const f of files) {
            const clean = f.replace(/\.md$/i, '').trim();
            if (clean && clean !== 'README' && clean.length <= 40) skillsSet.add(clean);
          }
        } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autonomousManager",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousManager]", err);
      }
    }
      }
    }

    // Resolve current specialty from active task
    const activeTask = parsedTasks.find((t: any) =>
      ['in_progress', 'in_review', 'needs_changes', 'ready'].includes(t.status)
    ) || parsedTasks[0];

    let currentExecutionSpecialty = activeTask?.skill_routed || null;
    if (!currentExecutionSpecialty && matchedCmd) {
      if (matchedCmd.command === '/frontend' || matchedCmd.command === '/redesign' || matchedCmd.command === '/style') {
        currentExecutionSpecialty = 'FRONTEND_SPECIALIST';
      } else if (matchedCmd.command === '/rea') {
        currentExecutionSpecialty = 'REA_SPECIALIST';
      } else if (matchedCmd.command === '/security') {
        currentExecutionSpecialty = 'SECURITY_AUDITOR';
      } else if (matchedCmd.command === '/karpathy') {
        currentExecutionSpecialty = 'KARPATHY_PROMPT_ENGINEER';
      }
    }

    const cleanSkills = Array.from(skillsSet)
      .map(s => String(s || '').trim())
      .filter(s => s.length > 0 && s.length <= 40 && !s.includes('\n') && !s.includes('\r') && !s.startsWith('[') && !s.startsWith('{'));

    return {
      activeSlashCommand,
      activeSkillsList: cleanSkills,
      currentExecutionSpecialty
    };
  }

  /**
   * Retrieve full details of an Autonomous Run
   */
  static getRun(runId: string) {
    const run: any = db.prepare('SELECT * FROM autonomous_runs WHERE id = ?').get(runId);
    if (!run) throw new Error(`Autonomous Run não encontrado: "${runId}"`);

    const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(run.project_id);
    const tasks: any[] = db.prepare('SELECT * FROM autonomous_tasks WHERE run_id = ? ORDER BY order_index ASC').all(runId);
    const approvals: any[] = db.prepare('SELECT * FROM autonomous_approvals WHERE run_id = ? ORDER BY created_at DESC').all(runId);
    const events: any[] = db.prepare('SELECT * FROM autonomous_events WHERE run_id = ? ORDER BY created_at DESC LIMIT 50').all(runId);
    const reports: any[] = db.prepare('SELECT * FROM builder_reports WHERE run_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 20').all(runId);
    const reviews: any[] = db.prepare('SELECT * FROM supervisor_reviews WHERE run_id = ? ORDER BY created_at DESC, rowid DESC').all(runId);
    const majorTasks = HierarchicalOrchestrationService.getMajorTasksForRun(runId);
    const projectRequirements = HierarchicalOrchestrationService.getProjectRequirements(runId);
    const stateTransitions: any[] = db.prepare('SELECT * FROM task_state_transitions WHERE run_id = ? ORDER BY created_at ASC, rowid ASC').all(runId);
    const agentCommunications: any[] = db.prepare('SELECT * FROM agent_communications WHERE run_id = ? ORDER BY created_at ASC, rowid ASC').all(runId);

    // Parse JSON fields
    const deliberations: any[] = db.prepare('SELECT * FROM council_deliberations WHERE run_id = ? ORDER BY created_at DESC').all(runId);
    const parsedTasks = tasks.map(t => {
      const effectiveLifecycle = HierarchicalOrchestrationService.resolveTaskLifecycleState(t);
      let reqIds: string[] = [];
      try {
        reqIds = t.requirement_ids_json ? JSON.parse(t.requirement_ids_json) : [];
      } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autonomousManager",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousManager]", err);
      }
    }
      return {
        ...t,
        lifecycle_state: effectiveLifecycle,
        lifecycleState: effectiveLifecycle,
        stage_code: t.stage_code || null,
        stage_title: t.stage_title || null,
        parent_task_id: t.parent_task_id || null,
        requirement_ids: reqIds,
        discovery_source: t.discovery_source || 'initial_plan',
        blocking_reason: t.blocking_reason || null,
        waived_reason: t.waived_reason || null,
        subdivision_depth: t.subdivision_depth || 0,
        dependencies: safeJsonParse(t.dependencies_json, []),
        criteria: safeJsonParse(t.criteria_json, []),
        expected_files: safeJsonParse(t.expected_files_json, []),
        allowed_scope: safeJsonParse(t.allowed_scope_json, []),
        constraints: safeJsonParse(t.constraints_json, []),
        required_evidence: safeJsonParse(t.required_evidence_json, []),
        attempt_history: safeJsonParse(t.attempt_history_json, []),
        review_result: safeJsonParse(t.review_result_json, null),
        protected_evaluation_files: safeJsonParse(t.protected_evaluation_files_json, undefined),
        skill_routed: t.skill_routed || null,
        skill_confidence: typeof t.skill_confidence === 'number' ? t.skill_confidence : 1.0,
        skill_guidelines_json: t.skill_guidelines_json || '[]',
        skillGuidelines: safeJsonParse(t.skill_guidelines_json, []),
        researchFindings: safeJsonParse(t.research_findings_json, null),
        slopPreflight: safeJsonParse(t.slop_preflight_json, null)
      };
    });

    const parsedApprovals = approvals.map(a => ({
      ...a,
      alternatives: safeJsonParse(a.alternatives_json, [])
    }));

    // Calculate progress stats bounded by requirement verification
    const total = parsedTasks.length;
    const completed = parsedTasks.filter(t => t.status === 'completed').length;
    const inProgress = parsedTasks.filter(t => t.status === 'in_progress').length;
    const inReview = parsedTasks.filter(t => t.status === 'in_review' || t.status === 'approved' || t.status === 'commit_pending').length;
    const pending = parsedTasks.filter(t => t.status === 'pending' || t.status === 'ready' || t.status === 'needs_changes').length;
    const blocked = parsedTasks.filter(t => t.status === 'blocked').length;
    const rejected = parsedTasks.filter(t => t.review_decision === 'REJECTED' || t.status === 'needs_changes').length;
    const waitingApproval = parsedApprovals.filter(a => a.status === 'pending').length;

    const mandatoryReqs = projectRequirements.filter(r => r.mandatory);
    const requirementsTotal = projectRequirements.length;
    const requirementsImplemented = projectRequirements.filter(r => r.status === 'implemented' || r.status === 'verified').length;
    const requirementsVerified = projectRequirements.filter(r => r.status === 'verified' || r.verificationStatus === 'review_approved').length;
    const requirementsPending = projectRequirements.filter(r => r.status !== 'verified' && r.status !== 'waived').length;
    const requirementsCoveragePct = mandatoryReqs.length > 0
      ? Math.round((mandatoryReqs.filter(r => r.linkedTaskIds.length > 0 || r.status === 'waived').length / mandatoryReqs.length) * 100)
      : 100;
    const requirementsVerificationPct = mandatoryReqs.length > 0
      ? Math.round((mandatoryReqs.filter(r => r.status === 'verified' || r.status === 'waived').length / mandatoryReqs.length) * 100)
      : 100;

    const rawTaskPct = total > 0 ? Math.round((completed / total) * 100) : 0;
    // Project progress cannot reach 100% if mandatory requirements remain unverified, unless run is completed
    const isRunCompleted = run.status === 'completed' && rawTaskPct === 100;
    const progressPct = isRunCompleted
      ? 100
      : (rawTaskPct === 100 && mandatoryReqs.length > 0 && requirementsVerificationPct < 100)
      ? Math.min(95, Math.round(rawTaskPct * 0.7 + requirementsVerificationPct * 0.3))
      : rawTaskPct;

    let complexityAnalysis: any = null;
    try {
      complexityAnalysis = run.complexity_analysis_json ? JSON.parse(run.complexity_analysis_json) : null;
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autonomousManager",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousManager]", err);
      }
    }

    const skillsMetadata = this.resolveRunSkillsMetadata(run, parsedTasks, project?.path);

    return {
      ...run,
      activeSlashCommand: skillsMetadata.activeSlashCommand,
      activeSkillsList: skillsMetadata.activeSkillsList,
      currentExecutionSpecialty: skillsMetadata.currentExecutionSpecialty,
      progress_pct: progressPct,
      progressPct,
      controlRequest:RunControl.get(runId),
      project,
      majorTasks,
      projectRequirements,
      complexityAnalysis,
      tasks: parsedTasks,
      stateTransitions,
      agentCommunications,
      requirements: safeJsonParse(run.requirements_json, []),
      successCriteria: safeJsonParse(run.success_criteria_json, []),
      technicalContext: safeJsonParse(run.technical_context_json, {}),
      planVersion: run.plan_version || 1,
      planHistory: safeJsonParse(run.plan_history_json, []),
      finalValidation: safeJsonParse(run.final_validation_json, null),
      approvals: parsedApprovals,
      councilDeliberations: deliberations.map(d => ({
        ...d,
        reviews: safeJsonParse(d.reviews_json, []),
        peerRankings: safeJsonParse(d.peer_rankings_json, [])
      })),
      events,
      reports,
      reviews,
      stats: {
        total,
        completed,
        inProgress,
        inReview,
        pending,
        blocked,
        rejected,
        waitingApproval,
        progressPct,
        activeSlashCommand: skillsMetadata.activeSlashCommand,
        currentExecutionSpecialty: skillsMetadata.currentExecutionSpecialty,
        majorTasksTotal: majorTasks.length,
        majorTasksCompleted: majorTasks.filter((m: any) => m.status === 'completed').length,
        requirementsTotal,
        requirementsImplemented,
        requirementsVerified,
        requirementsPending,
        requirementsCoveragePct,
        requirementsVerificationPct
      }
    };
  }

  /**
   * Get any active run for a project
   */
  static getActiveRunForProject(projectId: string) {
    let active: any = db.prepare(
      "SELECT id FROM autonomous_runs WHERE project_id = ? AND status NOT IN ('completed','failed') ORDER BY created_at DESC LIMIT 1"
    ).get(projectId);

    if (!active) {
      active = db.prepare(
        "SELECT id FROM autonomous_runs WHERE project_id = ? ORDER BY created_at DESC LIMIT 1"
      ).get(projectId);
    }

    if (!active) return null;
    return this.getRun(active.id);
  }

  /**
   * List all available tasks ready to be worked on (DAG non-blocking resolution + file-scope conflict guard)
   */
  static getAvailableTasks(runId: string) {
    const tasks: any[] = db.prepare('SELECT * FROM autonomous_tasks WHERE run_id = ? ORDER BY order_index ASC').all(runId);
    const completedIds = new Set(
      tasks
        .filter(t => t.status === 'completed' || t.status === 'skipped' || HierarchicalOrchestrationService.resolveTaskLifecycleState(t) === 'COMPLETED')
        .flatMap(t => [t.id, t.code].filter(Boolean))
    );

    const inProgressTasks = tasks.filter(
      t => t.status === 'in_progress' || HierarchicalOrchestrationService.resolveTaskLifecycleState(t) === 'IN_PROGRESS'
    );

    const majorTasks: any[] = db.prepare('SELECT * FROM autonomous_major_tasks WHERE run_id = ? ORDER BY order_index ASC').all(runId);
    const majorById = new Map<string, any>(majorTasks.map(m => [m.id, m]));
    const completedMajorKeys = new Set(
      majorTasks
        .filter(m => m.status === 'completed' || HierarchicalOrchestrationService.resolveTaskLifecycleState(m) === 'COMPLETED')
        .flatMap(m => [m.id, m.code].filter(Boolean))
    );

    // A task is available if:
    // 1. It is 'ready', 'pending', or 'needs_changes' (lifecycle: READY, PLANNED, REWORK_REQUIRED)
    // 2. All its microtask dependency IDs/codes are completed
    // 3. Its parent Major Task (if any) has all its Major Task dependencies completed
    // 4. It is not currently 'blocked' or 'waiting_approval'
    // 5. It does NOT have a file-scope conflict with any currently IN_PROGRESS task
    const availableList = tasks.filter(t => {
      const lifecycle = HierarchicalOrchestrationService.resolveTaskLifecycleState(t);
      if (
        lifecycle !== 'READY' &&
        lifecycle !== 'PLANNED' &&
        lifecycle !== 'REWORK_REQUIRED'
      ) {
        return false;
      }

      const deps: string[] = safeJsonParse(t.dependencies_json, []);
      const allDepsMet = deps.every(depId => completedIds.has(depId));
      if (!allDepsMet) return false;

      if (t.major_task_id && majorById.has(t.major_task_id)) {
        const major = majorById.get(t.major_task_id);
        const majorDeps: string[] = safeJsonParse(major.dependencies_json, []);
        const allMajorDepsMet = majorDeps.every(depKey => completedMajorKeys.has(depKey));
        if (!allMajorDepsMet) return false;
      }

      // File-scope conflict check against active IN_PROGRESS tasks
      for (const activeTask of inProgressTasks) {
        if (activeTask.id === t.id) continue;
        const scopeCheck = HierarchicalOrchestrationService.detectScopeConflicts(activeTask, t);
        if (scopeCheck.hasConflict) {
          return false;
        }
      }

      return true;
    }).map(t => {
      const currentLifecycle = HierarchicalOrchestrationService.resolveTaskLifecycleState(t);
      if (t.status !== 'ready' || currentLifecycle !== 'READY') {
        try {
          HierarchicalOrchestrationService.transitionTaskState(
            t.id,
            'READY',
            'supervisor',
            currentLifecycle === 'REWORK_REQUIRED'
              ? 'Tarefa liberada para retrabalho pelo Supervisor'
              : `Dependências satisfeitas: ${t.title}`
          );
        } catch {
          db.prepare("UPDATE autonomous_tasks SET status = 'ready', lifecycle_state = 'READY', updated_at = ? WHERE id = ?")
            .run(new Date().toISOString(), t.id);
        }
        this.logEvent(runId, t.id, 'system', 'TASK_READY', `Dependências satisfeitas: ${t.title}`);
      }
      return {
        ...t,
        status: 'ready',
        lifecycle_state: 'READY',
        dependencies: safeJsonParse(t.dependencies_json, []),
        criteria: safeJsonParse(t.criteria_json, []),
        expected_files: safeJsonParse(t.expected_files_json, []),
        allowed_scope: safeJsonParse(t.allowed_scope_json, []),
        constraints: safeJsonParse(t.constraints_json, []),
        required_evidence: safeJsonParse(t.required_evidence_json, []),
        protected_evaluation_files: safeJsonParse(t.protected_evaluation_files_json, undefined)
      };
    });

    this.syncRunProgress(runId);
    return availableList;
  }

  /**
   * Synchronize run progress, aligning milestone and active task with DAG state
   */
  static syncRunProgress(runId: string) {
    const tasks: any[] = db.prepare('SELECT * FROM autonomous_tasks WHERE run_id = ? ORDER BY order_index ASC').all(runId);
    if (!tasks.length) return;

    const firstIncomplete = tasks.find(t => t.status !== 'completed');
    const nowIso = new Date().toISOString();

    if (firstIncomplete) {
      const newMilestone = firstIncomplete.milestone || 'M1';
      const newTask = firstIncomplete.title;
      db.prepare(`
        UPDATE autonomous_runs
        SET current_milestone = ?, current_task = ?, updated_at = ?
        WHERE id = ?
      `).run(newMilestone, newTask, nowIso, runId);
    } else {
      const lastMilestone = tasks[tasks.length - 1]?.milestone || 'M5';
      db.prepare(`
        UPDATE autonomous_runs
        SET current_milestone = ?, current_task = 'Todas as tarefas concluídas', updated_at = ?
        WHERE id = ?
      `).run(lastMilestone, nowIso, runId);
    }

    // Atualiza arquivos físicos de progresso em .ai-dev-hub/
    try {
      const runRow: any = db.prepare('SELECT project_id, status FROM autonomous_runs WHERE id = ?').get(runId);
      if (runRow?.project_id) {
        const project: any = db.prepare('SELECT path, name FROM projects WHERE id = ?').get(runRow.project_id);
        if (project?.path && fs.existsSync(project.path)) {
          const aiDevHubDir = path.join(project.path, '.ai-dev-hub');
          if (!fs.existsSync(aiDevHubDir)) {
            fs.mkdirSync(aiDevHubDir, { recursive: true });
          }

          const completed = tasks.filter(t => t.status === 'completed');
          const doing = tasks.filter(t => t.status === 'in_progress' || t.status === 'in_review');
          const pending = tasks.filter(t => t.status !== 'completed' && t.status !== 'in_progress' && t.status !== 'in_review');

          // 1. tasks.md
          const tasksMdContent = [
            `# Kanban de Tarefas Autônomas — ${project.name}`,
            `*Atualizado em: ${nowIso} | Total: ${tasks.length} tarefas (${completed.length} concluídas)*\n`,
            `## Concluído (${completed.length})`,
            completed.length > 0 ? completed.map(t => `- [x] **${t.title}** \`[${t.milestone || 'M'}]\``).join('\n') : '_Nenhuma tarefa concluída ainda_',
            `\n## Fazendo (${doing.length})`,
            doing.length > 0 ? doing.map(t => `- [/] **${t.title}** \`[${t.milestone || 'M'} - ${t.status}]\``).join('\n') : '_Nenhuma tarefa em andamento_',
            `\n## Pendente (${pending.length})`,
            pending.length > 0 ? pending.map(t => `- [ ] **${t.title}** \`[${t.milestone || 'M'}]\``).join('\n') : '_Todas as tarefas foram concluídas_'
          ].join('\n');
          fs.writeFileSync(path.join(aiDevHubDir, 'tasks.md'), tasksMdContent, 'utf-8');

          // 2. changes.md
          const filesChangedSet = new Set<string>();
          for (const t of completed) {
            try {
              const files = JSON.parse(t.expected_files_json || '[]');
              if (Array.isArray(files)) files.forEach(f => filesChangedSet.add(f));
            } catch {}
          }
          const changesMdContent = [
            `# Histórico de Arquivos Criados/Alterados — ${project.name}`,
            `*Atualizado em: ${nowIso} | Arquivos rastreados: ${filesChangedSet.size}*\n`,
            filesChangedSet.size > 0
              ? Array.from(filesChangedSet).map(f => `- \`${f}\``).join('\n')
              : '_Nenhum arquivo modificado registrado ainda_'
          ].join('\n');
          fs.writeFileSync(path.join(aiDevHubDir, 'changes.md'), changesMdContent, 'utf-8');

          // 3. session-summary.md
          const lastCompleted = completed[completed.length - 1];
          const pct = Math.round((completed.length / tasks.length) * 100);
          const sessionSummaryContent = [
            `# Resumo da Sessão / Checkpoint Consolidado`,
            `**Projeto:** ${project.name}`,
            `**Progresso:** ${completed.length} de ${tasks.length} tarefas (${pct}%)`,
            `**Status do Run:** ${runRow.status.toUpperCase()}`,
            `**Última tarefa entregue:** ${lastCompleted ? lastCompleted.title : 'Nenhuma'}`,
            `**Próxima tarefa na fila:** ${firstIncomplete ? firstIncomplete.title : 'Todas as tarefas concluídas'}`,
            `**Data/Hora do Checkpoint:** ${nowIso}`
          ].join('\n');
          fs.writeFileSync(path.join(aiDevHubDir, 'session-summary.md'), sessionSummaryContent, 'utf-8');
        }
      }
    } catch (diskErr: any) {
      Logger.warn(`[AutonomousManager] Falha não bloqueante ao sincronizar arquivos de progresso em .ai-dev-hub: ${diskErr.message}`);
    }
  }

  /**
   * Builder claims a task to implement
   */
  static claimTask(runIdOrTaskId: string, taskIdOrAgentName?: string, agentNameArg = 'Builder') {
    let runId = runIdOrTaskId;
    let taskId = taskIdOrAgentName || '';
    let agentName = agentNameArg;

    let task: any = db.prepare('SELECT * FROM autonomous_tasks WHERE id = ? AND run_id = ?').get(taskId, runId);
    if (!task) {
      const byTaskIdOnly: any = db.prepare('SELECT * FROM autonomous_tasks WHERE id = ?').get(runIdOrTaskId);
      if (byTaskIdOnly) {
        task = byTaskIdOnly;
        taskId = byTaskIdOnly.id;
        runId = byTaskIdOnly.run_id;
        agentName = taskIdOrAgentName || 'Builder';
      }
    }
    if (!task) throw new Error('Tarefa não encontrada.');

    // Explicit file-scope conflict check against IN_PROGRESS tasks before claiming
    const activeInProgress: any[] = db.prepare(
      "SELECT * FROM autonomous_tasks WHERE run_id = ? AND id <> ? AND (status = 'in_progress' OR lifecycle_state = 'IN_PROGRESS')"
    ).all(runId, taskId);
    for (const activeTask of activeInProgress) {
      const conflict = HierarchicalOrchestrationService.detectScopeConflicts(activeTask, task);
      if (conflict.hasConflict) {
        throw new Error(
          `TASK_SCOPE_CONFLICT: conflito de escopo de arquivos (${conflict.overlappingFiles.join(', ')}) com a tarefa em execução "${activeTask.title}".`
        );
      }
    }

    if (!this.getAvailableTasks(runId).some(t => t.id === taskId)) {
      throw new Error('TASK_NOT_AVAILABLE: tarefa concluída, em execução ou com dependências pendentes.');
    }

    const refreshedTask: any = db.prepare('SELECT * FROM autonomous_tasks WHERE id = ? AND run_id = ?').get(taskId, runId);
    if (HierarchicalOrchestrationService.resolveTaskLifecycleState(refreshedTask) === 'IN_PROGRESS') {
      throw new Error('TASK_ALREADY_CLAIMED: outra execução reivindicou esta tarefa.');
    }

    const attempt = (refreshedTask.retry_count || 0) + 1;
    const executionId = `exec-${taskId}-attempt-${attempt}-${Date.now()}`;
    const nowIso = new Date().toISOString();

    HierarchicalOrchestrationService.transitionTaskState(
      taskId,
      'IN_PROGRESS',
      'supervisor',
      `${agentName} reivindicou a microtarefa (tentativa ${attempt})`,
      { agentName, attempt, executionId }
    );

    const claimed = db.prepare(`
      UPDATE autonomous_tasks
      SET status = 'in_progress', lifecycle_state = 'IN_PROGRESS', assigned_to = ?, execution_id = ?, updated_at = ?
      WHERE id = ?
    `).run(agentName, executionId, nowIso, taskId);
    if (!claimed.changes) throw new Error('TASK_ALREADY_CLAIMED: outra execução reivindicou esta tarefa.');

    const run: any = db.prepare('SELECT project_id FROM autonomous_runs WHERE id = ?').get(runId);
    const contract = HierarchicalOrchestrationService.buildWorkerExecutionContract(taskId);

    HierarchicalOrchestrationService.recordAgentCommunication({
      projectId: run?.project_id || refreshedTask.project_id,
      runId,
      majorTaskId: refreshedTask.major_task_id || null,
      microTaskId: taskId,
      executionId,
      attempt,
      fromAgent: 'supervisor',
      toAgent: 'worker',
      messageType: 'TASK_DISPATCHED_TO_WORKER',
      content: `Supervisor despachou microtarefa "${refreshedTask.code || refreshedTask.milestone}: ${refreshedTask.title}" para ${agentName} (tentativa ${attempt}).`,
      payload: { contract },
      idempotencyKey: `dispatch:${runId}:${taskId}:attempt:${attempt}`
    });

    HierarchicalOrchestrationService.recordAgentCommunication({
      projectId: run?.project_id || refreshedTask.project_id,
      runId,
      majorTaskId: refreshedTask.major_task_id || null,
      microTaskId: taskId,
      executionId,
      attempt,
      fromAgent: 'worker',
      toAgent: 'supervisor',
      messageType: 'WORKER_EXECUTION_STARTED',
      content: `${agentName} iniciou a execução da microtarefa "${refreshedTask.title}" (tentativa ${attempt}).`,
      payload: { agentName, executionId, attempt },
      idempotencyKey: `worker_start:${runId}:${taskId}:attempt:${attempt}`
    });

    this.logEvent(runId, taskId, 'builder', 'TASK_CLAIMED', `${agentName} iniciou implementação da tarefa "${task.title}"`);

    // Notify GitHub issue if linked
    const project: any = run ? db.prepare('SELECT * FROM projects WHERE id = ?').get(run.project_id) : null;
    if (project?.github_repo && task.github_issue_number) {
      const [owner, repo] = project.github_repo.split('/');
      GitHubMcpClient.addIssueComment(
        owner,
        repo,
        task.github_issue_number,
        `[WORKER] **${agentName}** assumiu a execução desta issue no branch \`${task.github_branch || 'ai/' + task.github_issue_number}\`.`
      ).catch((err) => {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autonomousManager",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousManager]", err);
      }
    });
    }

    return this.getRun(runId);
  }

  /**
   * Builder submits report upon completing work
   */
  static submitBuilderReport(input: BuilderReportInput) {
    const run: any = db.prepare('SELECT * FROM autonomous_runs WHERE id = ?').get(input.runId);
    if (!run) throw new Error('Run não encontrado.');

    const task: any = db.prepare('SELECT * FROM autonomous_tasks WHERE id = ? AND run_id=?').get(input.taskId, input.runId);
    if (!task) throw new Error('Tarefa não encontrada.');
    if (task.status === 'completed' || task.lifecycle_state === 'COMPLETED') {
      throw new Error('TASK_ALREADY_COMPLETED: relatório não pode reabrir tarefa concluída.');
    }

    const reportId = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    const attempt = (task.retry_count || 0) + 1;
    const executionId = task.execution_id || `exec-${task.id}-attempt-${attempt}`;

    if (input.executionId && task.execution_id && input.executionId !== task.execution_id) {
      throw new Error(
        `STALE_EXECUTION_RESULT: O relatório submetido pertence a uma execução antiga (${input.executionId}) diferente da execução ativa (${task.execution_id}).`
      );
    }
    if (input.attempt !== undefined && input.attempt !== attempt) {
      throw new Error(
        `STALE_EXECUTION_RESULT: O relatório submetido pertence à tentativa ${input.attempt}, mas a tarefa está na tentativa ${attempt}.`
      );
    }

    // 1. Evaluate decisions in report for Risk Level (Approval Matrix)
    let needsApproval = false;
    let highestRisk: RiskLevel = 'green';
    let approvalReason = '';

    const isTrusted = DevAutonomyService.isProjectTrusted(run.project_id);
    const fullDevAutonomy = DevAutonomyService.hasFullDevAutonomy(run.project_id);

    if (isTrusted || fullDevAutonomy) {
      needsApproval = false;
    } else if (input.decisions && input.decisions.length > 0) {
      for (const dec of input.decisions) {
        const evalRes = PolicyEngine.evaluateDecision(dec.decision, dec.rationale, {
          isTrusted,
          fullDevAutonomy
        });
        if (evalRes.riskLevel === 'red' || evalRes.riskLevel === 'orange') {
          needsApproval = true;
          highestRisk = evalRes.riskLevel;
          approvalReason = `Decisão "${dec.decision}" classificada como ${evalRes.riskLevel.toUpperCase()}: ${evalRes.ruleMatched}`;

          // Create approval request in Inbox
          this.requestHumanApproval({
            runId: input.runId,
            taskId: input.taskId,
            riskLevel: evalRes.riskLevel,
            title: `Aprovação de Decisão: ${dec.decision}`,
            context: `Durante a implementação de "${task.title}", o Builder propôs: "${dec.decision}" (Motivo: ${dec.rationale})`,
            whyNeeded: evalRes.ruleMatched,
            supervisorRecommendation: `Avaliar impacto antes de prosseguir com alteração classificada como ${evalRes.riskLevel.toUpperCase()}.`,
            alternatives: ['Manter padrão atual sem alteração', 'Aprovar modificação proposta'],
            impact: 'Pode afetar arquitetura ou integridade',
            risk: evalRes.riskLevel === 'red' ? 'Crítico / Irreversível' : 'Médio / Alto'
          });
        }
      }
    }

    // 2. Insert report
    db.prepare(`
      INSERT INTO builder_reports (
        id, run_id, task_id, status, files_changed_json, implemented_json,
        tests_run, test_results, build_status, browser_validation,
        screenshots_json, known_problems_json, decisions_json, recommendation, created_at, evaluation_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      reportId,
      input.runId,
      input.taskId,
      input.status,
      JSON.stringify(input.filesChanged || []),
      JSON.stringify(input.implemented || []),
      input.testsRun || 'Sem testes específicos',
      input.testResults || 'Passed',
      input.buildStatus || 'Passed',
      input.browserValidation || 'Validado localmente',
      JSON.stringify(input.screenshots || []),
      JSON.stringify(input.knownProblems || []),
      JSON.stringify(input.decisions || []),
      input.recommendation || 'Recomenda aprovação',
      nowIso,
      input.evaluation ? JSON.stringify(input.evaluation) : null
    );

    // Update attempt_history_json on microtask
    let attemptHistory: any[] = [];
    try {
      attemptHistory = task.attempt_history_json ? JSON.parse(task.attempt_history_json) : [];
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autonomousManager",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousManager]", err);
      }
    }
    attemptHistory.push({
      attempt,
      reportId,
      executionId,
      workerStatus: input.status,
      filesChanged: input.filesChanged || [],
      implemented: input.implemented || [],
      testsRun: input.testsRun || 'Sem testes específicos',
      testResults: input.testResults || 'Passed',
      buildStatus: input.buildStatus || 'Passed',
      knownProblems: input.knownProblems || [],
      submittedAt: nowIso
    });
    db.prepare('UPDATE autonomous_tasks SET attempt_history_json = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(attemptHistory), nowIso, input.taskId);

    ObservabilityService.emit({
      level: 'INFO',
      event: 'builder.report_received',
      message: `Relatório do Builder recebido para tarefa "${task.title}": status=${input.status}`,
      service: 'manager',
      runId: input.runId,
      taskId: input.taskId,
      status: input.status,
      metadata: {
        reportId,
        filesChangedCount: input.filesChanged?.length || 0,
        testsRun: input.testsRun,
        buildStatus: input.buildStatus,
        needsApproval
      }
    });

    // 3. Update task status via State Machine: if needsApproval, 'BLOCKED'; otherwise 'REVIEW_PENDING'
    const targetLifecycle = needsApproval ? 'BLOCKED' : 'REVIEW_PENDING';
    const newStatus = needsApproval ? 'blocked' : 'in_review';
    try {
      HierarchicalOrchestrationService.transitionTaskState(
        input.taskId,
        targetLifecycle,
        'worker',
        needsApproval
          ? `Aguardando aprovação humana: ${approvalReason}`
          : `Relatório submetido pelo Worker (tentativa ${attempt}), aguardando verificação independente do Review`,
        { reportId, attempt, needsApproval }
      );
    } catch {
      db.prepare('UPDATE autonomous_tasks SET status = ?, lifecycle_state = ?, updated_at = ? WHERE id = ?')
        .run(newStatus, targetLifecycle, nowIso, input.taskId);
    }

    HierarchicalOrchestrationService.recordAgentCommunication({
      projectId: run.project_id,
      runId: input.runId,
      majorTaskId: task.major_task_id || null,
      microTaskId: input.taskId,
      executionId,
      attempt,
      fromAgent: 'worker',
      toAgent: 'supervisor',
      messageType: 'WORKER_REPORT_SUBMITTED',
      content: `Worker submeteu relatório da microtarefa "${task.title}" (status: ${input.status}, arquivos: ${(input.filesChanged || []).length}).`,
      payload: {
        reportId,
        status: input.status,
        filesChanged: input.filesChanged || [],
        implemented: input.implemented || [],
        testsRun: input.testsRun,
        testResults: input.testResults,
        buildStatus: input.buildStatus,
        knownProblems: input.knownProblems || []
      },
      idempotencyKey: `worker_report:${input.runId}:${input.taskId}:${reportId}`
    });

    if (needsApproval) {
      HierarchicalOrchestrationService.recordAgentCommunication({
        projectId: run.project_id,
        runId: input.runId,
        majorTaskId: task.major_task_id || null,
        microTaskId: input.taskId,
        executionId,
        attempt,
        fromAgent: 'supervisor',
        toAgent: 'user',
        messageType: 'TASK_BLOCKED',
        content: `Microtarefa "${task.title}" bloqueada aguardando aprovação humana (${highestRisk.toUpperCase()}): ${approvalReason}`,
        payload: { highestRisk, approvalReason, reportId }
      });
    } else {
      HierarchicalOrchestrationService.recordAgentCommunication({
        projectId: run.project_id,
        runId: input.runId,
        majorTaskId: task.major_task_id || null,
        microTaskId: input.taskId,
        executionId,
        attempt,
        fromAgent: 'supervisor',
        toAgent: 'review',
        messageType: 'REVIEW_REQUESTED',
        content: `Supervisor solicitou verificação independente do Review para a microtarefa "${task.title}".`,
        payload: {
          reportId,
          criteria: task.criteria_json ? JSON.parse(task.criteria_json) : [],
          expectedFiles: task.expected_files_json ? JSON.parse(task.expected_files_json) : [],
          filesChanged: input.filesChanged || []
        },
        idempotencyKey: `review_req:${input.runId}:${input.taskId}:${reportId}`
      });
    }

    this.logEvent(
      input.runId,
      input.taskId,
      'builder',
      'REPORT_SUBMITTED',
      `Builder submeteu relatório para "${task.title}" (Status: ${input.status.toUpperCase()}). ${needsApproval ? '[APROVACAO] Requer aprovação na Inbox.' : 'Aguardando revisão do Supervisor.'}`
    );

    if (input.status !== 'success' || (input.evaluation && !input.evaluation.taskIsDone)) {
      try {
        const proj: any = db.prepare('SELECT id, path FROM projects WHERE id = ?').get(run.project_id);
        EngineeringContextService.recordOperationalFailure({
          projectId: run.project_id,
          projectPath: proj?.path,
          runId: input.runId,
          taskId: input.taskId,
          taskTitle: task.title,
          problemSummary: `Falha na avaliação de "${task.title}"`,
          rootCause: input.evaluation?.actual || (input.knownProblems && input.knownProblems[0]) || input.testResults || 'Falha na verificação da tarefa',
          failedStrategy: input.recommendation || (input.filesChanged?.length ? `Arquivos alterados: ${input.filesChanged.join(', ')}` : 'Sem alterações em arquivos esperados'),
          commandOutput: input.evaluation?.commandOutputSummary,
          failedCriteria: input.evaluation?.failedCriteria
        });
      } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autonomousManager",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousManager]", err);
      }
    }
    }

    return { reportId, status: newStatus, taskStatus: newStatus, lifecycleState: targetLifecycle, needsApproval, highestRisk, approvalReason };
  }

  /**
   * Supervisor & Independent Review evaluate the Builder Report
   */
  static submitSupervisorReview(input: SupervisorReviewInput) {
    const run: any = db.prepare('SELECT * FROM autonomous_runs WHERE id = ?').get(input.runId);
    if (!run) throw new Error('Run não encontrado.');

    const task: any = db.prepare('SELECT * FROM autonomous_tasks WHERE id = ? AND run_id=?').get(input.taskId, input.runId);
    if (!task) throw new Error('Tarefa não encontrada.');
    if ((task.status === 'completed' || task.lifecycle_state === 'COMPLETED') && input.verdict === 'APPROVED') {
      const existingRun = this.getRun(input.runId);
      const parsedReview = safeJsonParse(task.review_result_json, { decision: 'APPROVED' });
      return {
        ...existingRun,
        reviewDecision: parsedReview,
        commitGate: {
          committed: Boolean(task.task_commit_sha),
          commitSha: task.task_commit_sha || null
        }
      };
    }

    const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(run.project_id);
    const attempt = (task.retry_count || 0) + 1;
    const executionId = task.execution_id || `exec-${task.id}-attempt-${attempt}`;

    if (input.executionId && task.execution_id && input.executionId !== task.execution_id) {
      throw new Error(
        `STALE_EXECUTION_RESULT: A revisão submetida pertence a uma execução antiga (${input.executionId}) diferente da execução ativa (${task.execution_id}).`
      );
    }
    if (input.attempt !== undefined && input.attempt !== attempt) {
      throw new Error(
        `STALE_EXECUTION_RESULT: A revisão submetida pertence à tentativa ${input.attempt}, mas a tarefa está na tentativa ${attempt}.`
      );
    }

    const latestRep: any = db.prepare(
      'SELECT * FROM builder_reports WHERE run_id = ? AND task_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1'
    ).get(input.runId, task.id);
    if (input.reportId && latestRep && input.reportId !== latestRep.id && input.reportId !== 'latest') {
      throw new Error(
        `STALE_EXECUTION_RESULT: O reportId revisado (${input.reportId}) pertence a uma tentativa anterior (último relatório: ${latestRep.id}).`
      );
    }
    const reportFiles: string[] = safeJsonParse(latestRep?.files_changed_json, []);

    // Independent Review evaluation (checks real evidence, scope, mocks/placeholders, tamper protection, criteria)
    const structuredReview = HierarchicalOrchestrationService.evaluateIndependentReviewDecision({
      runId: input.runId,
      taskId: input.taskId,
      projectPath: project?.path || '',
      evaluationResult: input.evaluation,
      supervisorVerdict: input.verdict,
      supervisorFeedback: input.feedback,
      enforceScopeCheck: input.enforceScopeCheck,
      allowReworkOnBlocked: input.allowReworkOnBlocked,
      workerReport: latestRep
        ? {
            filesChanged: reportFiles,
            implemented: latestRep.implemented_json ? JSON.parse(latestRep.implemented_json) : [],
            testsRun: latestRep.tests_run,
            testResults: latestRep.test_results,
            buildStatus: latestRep.build_status
          }
        : undefined
    });

    if (input.verdict === 'APPROVED') {
      const evaluation = input.evaluation || IndependentEvaluator.getEvaluationByTaskId(input.taskId);
      if (!evaluation?.taskIsDone || evaluation.verdict !== 'PASS') {
        throw new Error('NEEDS_EVIDENCE: aprovação exige avaliação independente PASS persistida para esta tarefa.');
      }
      if (structuredReview.decision !== 'APPROVED') {
        throw new Error(
          `NEEDS_EVIDENCE: O Review independente reprovou a aprovação (${structuredReview.decision}): ${structuredReview.justification}`
        );
      }
    }

    HierarchicalOrchestrationService.recordAgentCommunication({
      projectId: run.project_id,
      runId: input.runId,
      majorTaskId: task.major_task_id || null,
      microTaskId: input.taskId,
      executionId,
      attempt,
      fromAgent: 'review',
      toAgent: 'supervisor',
      messageType: 'REVIEW_STARTED',
      content: `Review iniciou inspeção independente da microtarefa "${task.title}" (tentativa ${attempt}).`,
      payload: { evaluationId: structuredReview.evaluationId }
    });

    const reviewId = crypto.randomUUID();
    const nowIso = new Date().toISOString();

    const effectiveVerdict: 'APPROVED' | 'CHANGES_REQUESTED' | 'BLOCKED' =
      input.verdict === 'APPROVED'
        ? 'APPROVED'
        : (input.verdict === 'BLOCKED' || (!input.allowReworkOnBlocked && structuredReview.decision === 'BLOCKED'))
        ? 'BLOCKED'
        : 'CHANGES_REQUESTED';

    const reviewDecisionLabel: ReviewDecisionVerdict =
      effectiveVerdict === 'APPROVED'
        ? 'APPROVED'
        : effectiveVerdict === 'BLOCKED'
        ? 'BLOCKED'
        : 'REJECTED';

    const finalReviewPayload = {
      ...structuredReview,
      decision: reviewDecisionLabel,
      supervisorVerdict: effectiveVerdict,
      supervisorFeedback: input.feedback,
      reviewId,
      evaluatedAt: nowIso
    };

    db.prepare(`
      UPDATE autonomous_tasks
      SET review_result_json = ?, review_decision = ?, updated_at = ?
      WHERE id = ?
    `).run(JSON.stringify(finalReviewPayload), reviewDecisionLabel, nowIso, input.taskId);

    db.prepare(`
      INSERT INTO supervisor_reviews (
        id, run_id, task_id, report_id, verdict, feedback,
        requirements_met, build_passed, tests_passed, ui_functional, quality_score, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      reviewId,
      input.runId,
      input.taskId,
      input.reportId || latestRep?.id || 'latest',
      effectiveVerdict,
      input.feedback,
      input.requirementsMet !== false ? 1 : 0,
      input.buildPassed !== false ? 1 : 0,
      input.testsPassed !== false ? 1 : 0,
      input.uiFunctional !== false ? 1 : 0,
      input.qualityScore || 10,
      nowIso
    );

    ObservabilityService.emit({
      level: effectiveVerdict === 'APPROVED' ? 'INFO' : 'WARN',
      event: 'supervisor.review_received',
      message: `Revisão do Supervisor para tarefa "${task.title}": ${effectiveVerdict} (Score: ${input.qualityScore || 10})`,
      service: 'supervisor',
      runId: input.runId,
      taskId: input.taskId,
      status: effectiveVerdict,
      metadata: {
        reviewId,
        verdict: effectiveVerdict,
        reviewDecision: reviewDecisionLabel,
        qualityScore: input.qualityScore || 10,
        feedback: input.feedback?.slice(0, 200)
      }
    });

    let lastCommitGate: any = null;

    if (effectiveVerdict === 'APPROVED') {
      HierarchicalOrchestrationService.recordAgentCommunication({
        projectId: run.project_id,
        runId: input.runId,
        majorTaskId: task.major_task_id || null,
        microTaskId: input.taskId,
        executionId,
        attempt,
        fromAgent: 'review',
        toAgent: 'supervisor',
        messageType: 'REVIEW_APPROVED',
        content: `Review APROVOU a microtarefa "${task.title}": ${structuredReview.justification}`,
        payload: finalReviewPayload,
        reviewId,
        evaluationId: structuredReview.evaluationId || null
      });

      // Ensure task is in REVIEW_PENDING before transitioning to APPROVED
      const currentTaskRow: any = db.prepare('SELECT status, lifecycle_state FROM autonomous_tasks WHERE id = ?').get(input.taskId);
      let currentLifecycle = HierarchicalOrchestrationService.resolveTaskLifecycleState(currentTaskRow || {});
      if (currentLifecycle === 'PLANNED') {
        try {
          HierarchicalOrchestrationService.transitionTaskState(input.taskId, 'READY', 'system', 'Sincronização de estado (PLANNED -> READY)');
          currentLifecycle = 'READY';
        } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autonomousManager",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousManager]", err);
      }
    }
      }
      if (currentLifecycle === 'READY' || currentLifecycle === 'REWORK_REQUIRED') {
        try {
          HierarchicalOrchestrationService.transitionTaskState(input.taskId, 'IN_PROGRESS', 'system', 'Sincronização de estado para execução verificada');
          currentLifecycle = 'IN_PROGRESS';
        } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autonomousManager",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousManager]", err);
      }
    }
      }
      if (currentLifecycle === 'IN_PROGRESS' || currentLifecycle === 'BLOCKED') {
        try {
          HierarchicalOrchestrationService.transitionTaskState(
            input.taskId,
            'REVIEW_PENDING',
            'system',
            'Sincronização de estado para revisão independente'
          );
        } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autonomousManager",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousManager]", err);
      }
    }
      }

      // Transition REVIEW_PENDING -> APPROVED
      HierarchicalOrchestrationService.transitionTaskState(
        input.taskId,
        'APPROVED',
        'review',
        `Review independente aprovou todos os critérios obrigatórios: ${structuredReview.justification}`,
        { reviewId, evaluationId: structuredReview.evaluationId }
      );

      // Sync with AI DEV HUB Memory before commit so memory files are included in the commit
      try {
        if (project?.path) {
          const memory = MemoryManager.readMemoryFiles(project.path);
          const tasks = MemoryManager.parseTasks(memory.tasksMd);
          tasks.doing = tasks.doing.filter(t => t.toLowerCase() !== task.title.toLowerCase());
          tasks.pending = tasks.pending.filter(t => t.toLowerCase() !== task.title.toLowerCase());
          if (!tasks.done.includes(task.title)) tasks.done.push(task.title);
          MemoryManager.updateMemoryFile(project.path, 'tasks.md', MemoryManager.formatTasks(tasks));

          CheckpointManager.createSessionCheckpoint(project.id, project.path, project.name, {
            implemented: [task.title],
            recentChanges: [task.title],
            nextTask: 'Continuar backlog autônomo'
          });
        }
      } catch (err: any) {
        Logger.warn(`Erro ao sincronizar memória: ${err.message}`);
      }

      // Execute Post-Review Commit Gate: APPROVED -> COMMIT_PENDING -> COMPLETED (or BLOCKED if commit fails)
      const commitGate = HierarchicalOrchestrationService.executePostReviewCommitGate({
        runId: input.runId,
        taskId: input.taskId,
        projectPath: project?.path || '',
        filesChanged: reportFiles,
        commitMessage: `feat(ai): [${task.code || task.milestone}] ${task.title}`,
        requireGitCommit: Boolean(input.requireGitCommit),
        requireCodeChanges: Boolean(input.requireCodeChanges),
        simulateCommitFailure: Boolean(input.simulateCommitFailure)
      });
      lastCommitGate = commitGate;

      if (!commitGate.committed || !commitGate.commitSha) {
        throw new Error(`COMMIT_GATE_BLOCKED: ${commitGate.error || 'Falha ao criar commit pós-revisão.'}`);
      }

      ObservabilityService.emit({
        level: 'INFO',
        event: 'task.completed',
        message: `Tarefa "${task.title}" concluída com sucesso (commit: ${commitGate.commitSha})`,
        service: 'manager',
        runId: input.runId,
        taskId: input.taskId,
        status: 'completed',
        metadata: { milestone: task.milestone, commitSha: commitGate.commitSha }
      });

      this.logEvent(
        input.runId,
        input.taskId,
        'supervisor',
        'TASK_APPROVED',
        `Supervisor aprovou "${task.title}" após avaliação independente (commit: ${commitGate.commitSha.slice(0, 12)}).`
      );

      try {
        EngineeringContextService.recordOperationalResolution({
          projectId: run.project_id,
          projectPath: project?.path,
          runId: input.runId,
          taskId: input.taskId,
          taskTitle: task.title,
          workingStrategy: input.feedback || latestRep?.recommendation || 'Implementação corrigida e validada pela verificação independente.',
          filesChanged: reportFiles
        });
      } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autonomousManager",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousManager]", err);
      }
    }

      // Release any active worker leases for this task
      try {
        const leases: any[] = db.prepare("SELECT id, worker_id FROM worker_leases WHERE task_id = ? AND status = 'active'").all(input.taskId);
        for (const l of leases) {
          WorkerRegistry.releaseLease(l.id, l.worker_id);
          WorkerRegistry.updateWorkerStatus(l.worker_id, 'READY', {
            current_task_id: null,
            current_run_id: null,
            current_issue_number: null
          });
        }
      } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autonomousManager",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousManager]", err);
      }
    }

      // Resolve DAG and promote dependent tasks
      this.getAvailableTasks(input.runId);

      // Synchronize milestone and active task progression
      this.syncRunProgress(input.runId);

    } else if (effectiveVerdict === 'BLOCKED') {
      HierarchicalOrchestrationService.recordAgentCommunication({
        projectId: run.project_id,
        runId: input.runId,
        majorTaskId: task.major_task_id || null,
        microTaskId: input.taskId,
        executionId,
        attempt,
        fromAgent: 'review',
        toAgent: 'supervisor',
        messageType: 'REVIEW_BLOCKED',
        content: `Review BLOQUEOU a avaliação da microtarefa "${task.title}": ${input.feedback || structuredReview.justification}`,
        payload: finalReviewPayload,
        reviewId,
        evaluationId: structuredReview.evaluationId || null
      });

      try {
        HierarchicalOrchestrationService.transitionTaskState(
          input.taskId,
          'BLOCKED',
          'review',
          input.feedback || structuredReview.justification,
          { reviewId }
        );
      } catch {
        db.prepare("UPDATE autonomous_tasks SET status = 'blocked', lifecycle_state = 'BLOCKED', updated_at = ? WHERE id = ?")
          .run(nowIso, input.taskId);
      }

      HierarchicalOrchestrationService.recordAgentCommunication({
        projectId: run.project_id,
        runId: input.runId,
        majorTaskId: task.major_task_id || null,
        microTaskId: input.taskId,
        executionId,
        attempt,
        fromAgent: 'supervisor',
        toAgent: 'user',
        messageType: 'TASK_BLOCKED',
        content: `Microtarefa "${task.title}" bloqueada na revisão: ${input.feedback || structuredReview.justification}`,
        payload: finalReviewPayload,
        reviewId
      });

      this.logEvent(
        input.runId,
        input.taskId,
        'supervisor',
        'TASK_BLOCKED',
        `Tarefa "${task.title}" bloqueada durante revisão: ${input.feedback || structuredReview.justification}`
      );
    } else {
      // CHANGES_REQUESTED / REJECTED
      const currentRetry = (task.retry_count || 0) + 1;
      const maxRetries = task.max_retries || 3;

      HierarchicalOrchestrationService.recordAgentCommunication({
        projectId: run.project_id,
        runId: input.runId,
        majorTaskId: task.major_task_id || null,
        microTaskId: input.taskId,
        executionId,
        attempt,
        fromAgent: 'review',
        toAgent: 'supervisor',
        messageType: 'REVIEW_REJECTED',
        content: `Review REPROVOU a microtarefa "${task.title}" (Tentativa ${currentRetry}/${maxRetries}): ${input.feedback || structuredReview.justification}`,
        payload: finalReviewPayload,
        reviewId,
        evaluationId: structuredReview.evaluationId || null
      });

      let evaluation: any = null;
      try {
        evaluation = IndependentEvaluator.getEvaluationByTaskId(input.taskId);
        EngineeringContextService.recordOperationalFailure({
          projectId: run.project_id,
          projectPath: project?.path,
          runId: input.runId,
          taskId: input.taskId,
          taskTitle: task.title,
          problemSummary: `Revisão reprovada em "${task.title}" (Tentativa ${currentRetry}/${maxRetries})`,
          rootCause: input.feedback || evaluation?.actual || 'Requisitos ou testes da tarefa não atendidos',
          failedStrategy: latestRep?.recommendation || (reportFiles.length ? `Arquivos alterados: ${reportFiles.join(', ')}` : 'Implementação sem cobertura suficiente'),
          commandOutput: evaluation?.evidence?.output,
          failedCriteria: evaluation?.failedCriteria
        });
      } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autonomousManager",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousManager]", err);
      }
    }

      // Watchdog check for max iterations per task
      if (currentRetry >= maxRetries) {
        const isSecurityTampering = evaluation?.verdict === 'TAMPERING_DETECTED' ||
          (Array.isArray(structuredReview?.securityOrIsolationIssues) && structuredReview.securityOrIsolationIssues.length > 0);
        const alreadyAutoUnblocked = Boolean(
          task.replan_reason?.includes('AUTO_UNBLOCK') ||
          (task.attempt_history_json && task.attempt_history_json.includes('AUTO_UNBLOCK'))
        );

        const canAutoRepair = Boolean(
          input.enableAutoRepair ||
          input.allowReworkOnBlocked ||
          (run && (run.autonomy_mode === 'full' || run.autonomy_mode === 'autonomous'))
        );

        if (!isSecurityTampering && !alreadyAutoUnblocked && canAutoRepair) {
          Logger.info(`[AutonomousManager] [RECOVERY] Ativando Supervisor Task Repair (Auto-Unblock) para "${task.title}" (Tentativa ${currentRetry}/${maxRetries})...`);

          let currentExpected: string[] = [];
          try {
            currentExpected = Array.isArray(task.expected_files)
              ? task.expected_files
              : (task.expected_files_json ? JSON.parse(task.expected_files_json) : []);
          } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autonomousManager",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousManager]", err);
      }
    }

          const projectPath = run.project?.path || '.';
          const reconciledExpected = currentExpected.map(expFile => {
            const cleanExp = expFile.replace(/\\/g, '/').trim();
            if (fs.existsSync(path.join(projectPath, cleanExp))) return cleanExp;
            const ext = path.extname(cleanExp).toLowerCase();
            if (['.js', '.cjs', '.mjs'].includes(ext)) {
              const base = cleanExp.slice(0, -ext.length);
              for (const alt of ['.js', '.cjs', '.mjs']) {
                if (fs.existsSync(path.join(projectPath, `${base}${alt}`))) {
                  return `${base}${alt}`;
                }
              }
            }
            return cleanExp;
          });

          let reconciledCommand = task.verification_command;
          if (reconciledCommand) {
            const normCmd = normalizeOrRecoverVerificationCommand(reconciledCommand, projectPath, { allowUncreatedFiles: true });
            if (normCmd.recovered) reconciledCommand = normCmd.command;
          }

          const extraMaxRetries = maxRetries + 1;
          const autoUnblockFeedback = `[SUPERVISOR AUTO-UNBLOCK] Reconciliação automática de contrato aplicada. Arquivos de escopo: ${reconciledExpected.join(', ')}. Comando: ${reconciledCommand}. Foque na implementação cirúrgica dos arquivos de escopo e no sucesso do teste.`;

          try {
            HierarchicalOrchestrationService.transitionTaskState(
              input.taskId,
              'REWORK_REQUIRED',
              'supervisor',
              `Auto-Unblock concedido: ${autoUnblockFeedback}`,
              { retryCount: currentRetry, maxRetries: extraMaxRetries, reviewId, autoUnblock: true }
            );
          } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autonomousManager",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousManager]", err);
      }
    }

          db.prepare(`
            UPDATE autonomous_tasks
            SET status = 'needs_changes',
                lifecycle_state = 'REWORK_REQUIRED',
                retry_count = ?,
                max_retries = ?,
                replan_reason = 'AUTO_UNBLOCK_APPLIED',
                expected_files_json = ?,
                allowed_scope_json = ?,
                verification_command = ?,
                updated_at = ?
            WHERE id = ?
          `).run(
            currentRetry,
            extraMaxRetries,
            JSON.stringify(reconciledExpected),
            JSON.stringify(reconciledExpected),
            reconciledCommand,
            nowIso,
            input.taskId
          );

          HierarchicalOrchestrationService.recordAgentCommunication({
            projectId: run.project_id,
            runId: input.runId,
            majorTaskId: task.major_task_id || null,
            microTaskId: input.taskId,
            executionId,
            attempt: currentRetry,
            fromAgent: 'supervisor',
            toAgent: 'worker',
            messageType: 'REWORK_DISPATCHED',
            content: `Supervisor acionou Auto-Unblock para "${task.title}": ${autoUnblockFeedback}`,
            payload: {
              retryCount: currentRetry,
              maxRetries: extraMaxRetries,
              feedback: autoUnblockFeedback,
              autoUnblock: true,
              expectedFiles: reconciledExpected
            },
            reviewId
          });

          this.logEvent(
            input.runId,
            input.taskId,
            'supervisor',
            'SUPERVISOR_TASK_REPAIRED',
            `[RECOVERY] Supervisor Auto-Unblock: Contrato da tarefa "${task.title}" auto-reconciliado e ciclo extra concedido (${currentRetry}/${extraMaxRetries}) sem necessidade de intervenção humana.`
          );
          return;
        }

        try {
          HierarchicalOrchestrationService.transitionTaskState(
            input.taskId,
            'BLOCKED',
            'supervisor',
            `Limite de ${maxRetries} tentativas atingido sem aprovação. Último feedback: ${input.feedback}`,
            { retryCount: currentRetry, maxRetries, reviewId }
          );
        } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autonomousManager",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousManager]", err);
      }
    }
        db.prepare("UPDATE autonomous_tasks SET status = 'blocked', lifecycle_state = 'BLOCKED', retry_count = ?, updated_at = ? WHERE id = ?")
          .run(currentRetry, nowIso, input.taskId);

        HierarchicalOrchestrationService.recordAgentCommunication({
          projectId: run.project_id,
          runId: input.runId,
          majorTaskId: task.major_task_id || null,
          microTaskId: input.taskId,
          executionId,
          attempt: currentRetry,
          fromAgent: 'supervisor',
          toAgent: 'user',
          messageType: 'TASK_BLOCKED',
          content: `Watchdog bloqueou a microtarefa "${task.title}" após ${currentRetry}/${maxRetries} tentativas sem convergência.`,
          payload: { retryCount: currentRetry, maxRetries, lastFeedback: input.feedback, reviewResult: finalReviewPayload },
          reviewId
        });

        this.logEvent(
          input.runId,
          input.taskId,
          'system',
          'WATCHDOG_BLOCKED',
          `[WATCHDOG] Tarefa "${task.title}" atingiu limite de ${maxRetries} tentativas sem aprovação. Marcada como BLOCKED para evitar loop infinito. O Supervisor continuará outras tarefas independentes.`
        );
        this.requestHumanApproval({
          runId: input.runId,
          taskId: input.taskId,
          riskLevel: isSecurityTampering ? 'red' : 'orange',
          title: `Intervenção: ${task.title} bloqueada após ${maxRetries} tentativas`,
          context: `A tarefa "${task.title}" falhou após ${currentRetry} tentativas consecutivas. Último feedback: ${input.feedback}`,
          whyNeeded: isSecurityTampering ? 'Violação de segurança ou adulteração detectada' : 'Limite de iterações automáticas atingido sem convergência',
          supervisorRecommendation: 'Aprovar continuação manual ou ajustar requisitos da tarefa',
          alternatives: ['Permitir tentativas adicionais', 'Pular tarefa', 'Editar código manualmente'],
          impact: 'Execução autônoma retida nesta tarefa',
          risk: isSecurityTampering ? 'Alto' : 'Médio / Alto'
        });
      } else {
        try {
          HierarchicalOrchestrationService.transitionTaskState(
            input.taskId,
            'REWORK_REQUIRED',
            'supervisor',
            `Correções solicitadas na tentativa ${currentRetry}/${maxRetries}: ${input.feedback}`,
            { retryCount: currentRetry, maxRetries, reviewId }
          );
        } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autonomousManager",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousManager]", err);
      }
    }
        db.prepare("UPDATE autonomous_tasks SET status = 'needs_changes', lifecycle_state = 'REWORK_REQUIRED', retry_count = ?, updated_at = ? WHERE id = ?")
          .run(currentRetry, nowIso, input.taskId);

        HierarchicalOrchestrationService.recordAgentCommunication({
          projectId: run.project_id,
          runId: input.runId,
          majorTaskId: task.major_task_id || null,
          microTaskId: input.taskId,
          executionId,
          attempt: currentRetry,
          fromAgent: 'supervisor',
          toAgent: 'worker',
          messageType: 'REWORK_DISPATCHED',
          content: `Supervisor encaminhou instruções estruturadas de retrabalho para "${task.title}" (Tentativa ${currentRetry}/${maxRetries}): ${input.feedback}`,
          payload: {
            retryCount: currentRetry,
            maxRetries,
            feedback: input.feedback,
            problemsFound: structuredReview.problemsFound,
            evaluatedCriteria: structuredReview.evaluatedCriteria.filter(c => !c.passed)
          },
          reviewId
        });

        this.logEvent(
          input.runId,
          input.taskId,
          'supervisor',
          'CHANGES_REQUESTED',
          `Supervisor solicitou correções em "${task.title}" (Tentativa ${currentRetry}/${maxRetries}): ${input.feedback}`
        );
      }
    }

    // Increment run cycle count
    db.prepare('UPDATE autonomous_runs SET current_cycle = current_cycle + 1, updated_at = ? WHERE id = ?').run(nowIso, input.runId);

    const updatedRun = this.getRun(input.runId);
    return {
      ...updatedRun,
      reviewId,
      reviewDecision: finalReviewPayload,
      commitGate: lastCommitGate
    };
  }

  /**
   * Request Human Approval for Inbox
   */
  static submitFinalProjectReview(input: {
    runId: string;
    verdict: 'APPROVED' | 'CHANGES_REQUESTED' | 'BLOCKED';
    feedback: string;
    requirementsMet?: boolean;
    buildPassed?: boolean;
    testsPassed?: boolean;
    uiFunctional?: boolean;
    qualityScore?: number;
  }) {
    const run: any = db.prepare('SELECT id, project_id FROM autonomous_runs WHERE id = ?').get(input.runId);
    if (!run) throw new Error('Run não encontrado.');

    if (input.verdict === 'APPROVED') {
      const existing: any = db.prepare(
        "SELECT id FROM supervisor_reviews WHERE run_id = ? AND task_id = 'FINAL_PROJECT_REVIEW' AND verdict = 'APPROVED' ORDER BY created_at DESC LIMIT 1"
      ).get(input.runId);
      if (existing) {
        const validation = HierarchicalOrchestrationService.validateProjectFinalCompletion(input.runId);
        return { reviewId: existing.id, alreadyPersisted: true, ...validation };
      }
    }

    const reviewId = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    db.prepare(`
      INSERT INTO supervisor_reviews (
        id, run_id, task_id, report_id, verdict, feedback,
        requirements_met, build_passed, tests_passed, ui_functional, quality_score, created_at
      ) VALUES (?, ?, 'FINAL_PROJECT_REVIEW', 'final-project-completion', ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      reviewId,
      input.runId,
      input.verdict,
      input.feedback,
      input.requirementsMet !== false ? 1 : 0,
      input.buildPassed !== false ? 1 : 0,
      input.testsPassed !== false ? 1 : 0,
      input.uiFunctional !== false ? 1 : 0,
      input.qualityScore ?? (input.verdict === 'APPROVED' ? 10 : 5),
      nowIso
    );

    const validation = HierarchicalOrchestrationService.submitFinalProjectReview({
      runId: input.runId,
      verdict: input.verdict,
      feedback: input.feedback
    });
    this.syncRunProgress(input.runId);

    return { reviewId, alreadyPersisted: false, ...validation };
  }

  static requestHumanApproval(params: {
    runId: string;
    taskId?: string;
    riskLevel: RiskLevel;
    title: string;
    context: string;
    whyNeeded: string;
    supervisorRecommendation: string;
    alternatives?: string[];
    impact?: string;
    risk?: string;
  }) {
    const nowIso = new Date().toISOString();
    const runRow: any = db.prepare('SELECT id, status FROM autonomous_runs WHERE id = ?').get(params.runId);
    const taskRow: any = params.taskId
      ? db.prepare('SELECT id, title, status, lifecycle_state FROM autonomous_tasks WHERE id = ?').get(params.taskId)
      : null;

    // Guard against late approval events arriving after the task or run is already completed
    const isTaskAlreadyDone = Boolean(
      taskRow && (
        taskRow.status === 'completed' ||
        taskRow.status === 'skipped' ||
        ['COMPLETED', 'APPROVED', 'COMMIT_PENDING', 'SKIPPED'].includes(String(taskRow.lifecycle_state || ''))
      )
    );
    const isRunAlreadyDone = Boolean(runRow && runRow.status === 'completed');

    if (isTaskAlreadyDone || isRunAlreadyDone) {
      const supersededId = crypto.randomUUID();
      db.prepare(`
        INSERT INTO autonomous_approvals (
          id, run_id, task_id, risk_level, title, context, why_needed,
          alternatives_json, supervisor_recommendation, impact, risk, status, decision, created_at, decided_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'superseded', ?, ?, ?)
      `).run(
        supersededId,
        params.runId,
        params.taskId || null,
        params.riskLevel,
        params.title,
        params.context,
        params.whyNeeded,
        JSON.stringify(params.alternatives || []),
        params.supervisorRecommendation,
        params.impact || 'Médio',
        params.risk || 'Requer atenção',
        'Ignorado: tarefa/run já concluído antes da chegada do evento de aprovação',
        nowIso,
        nowIso
      );

      this.logEvent(
        params.runId,
        params.taskId || null,
        'system',
        'LATE_APPROVAL_IGNORED',
        `Evento de aprovação atrasado ignorado para "${params.title}": a tarefa ou execução já estava concluída.`
      );
      return supersededId;
    }

    // Guard against duplicate pending approval events for the same (run_id, task_id, title)
    const existingPending: any = db.prepare(`
      SELECT id FROM autonomous_approvals
      WHERE run_id = ? AND COALESCE(task_id, '') = COALESCE(?, '') AND title = ? AND status = 'pending'
      ORDER BY created_at DESC LIMIT 1
    `).get(params.runId, params.taskId || '', params.title);

    if (existingPending) {
      this.logEvent(
        params.runId,
        params.taskId || null,
        'system',
        'DUPLICATE_APPROVAL_EVENT_IGNORED',
        `Solicitação de aprovação duplicada ignorada para "${params.title}" (ID pendente preservado: ${existingPending.id}).`
      );
      return existingPending.id;
    }

    const id = crypto.randomUUID();

    db.prepare(`
      INSERT INTO autonomous_approvals (
        id, run_id, task_id, risk_level, title, context, why_needed,
        alternatives_json, supervisor_recommendation, impact, risk, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `).run(
      id,
      params.runId,
      params.taskId || null,
      params.riskLevel,
      params.title,
      params.context,
      params.whyNeeded,
      JSON.stringify(params.alternatives || []),
      params.supervisorRecommendation,
      params.impact || 'Médio',
      params.risk || 'Requer atenção',
      nowIso
    );

    if (params.taskId) {
      db.prepare("UPDATE autonomous_tasks SET status = 'blocked', lifecycle_state = 'BLOCKED', updated_at = ? WHERE id = ?").run(nowIso, params.taskId);
    }

    const activeOrReadyOther: any = db.prepare(`
      SELECT id FROM autonomous_tasks
      WHERE run_id = ? AND status IN ('ready', 'in_progress', 'in_review')
      LIMIT 1
    `).get(params.runId);
    const isProjectTrusted = DevAutonomyService.isProjectTrusted(runRow?.project_id);
    const hasAutonomy = DevAutonomyService.hasFullDevAutonomy(runRow?.project_id);
    if (!isProjectTrusted && !hasAutonomy && !activeOrReadyOther && runRow && !['completed', 'failed'].includes(runRow.status)) {
      db.prepare(`
        UPDATE autonomous_runs
        SET status = 'waiting_approval', next_action = ?, updated_at = ?
        WHERE id = ?
      `).run(`Aguardando decisão humana na Approval Inbox: "${params.title}"`, nowIso, params.runId);
    }

    this.logEvent(
      params.runId,
      params.taskId || null,
      'supervisor',
      'APPROVAL_REQUESTED',
      `[${params.riskLevel.toUpperCase()}] Nova aprovação requerida na Inbox: "${params.title}". Tarefas independentes continuam normalmente.`
    );

    return id;
  }

  /**
   * User or system resolves approval in Approval Inbox
   */
  static resolveHumanApproval(
    approvalId: string,
    decision: 'approved' | 'rejected' | 'delegated' | 'expired' | 'failed',
    reason?: string
  ) {
    const approval: any = db.prepare('SELECT * FROM autonomous_approvals WHERE id = ?').get(approvalId);
    if (!approval) throw new Error('Aprovação não encontrada.');

    const nowIso = new Date().toISOString();

    // Idempotency guard against duplicate approval resolution events
    if (approval.status !== 'pending') {
      this.logEvent(
        approval.run_id,
        approval.task_id || null,
        'system',
        'DUPLICATE_APPROVAL_EVENT_IGNORED',
        `Evento de resolução duplicado ignorado para "${approval.title}" (status atual já era ${approval.status}).`
      );
      return this.getRun(approval.run_id);
    }

    const taskRow: any = approval.task_id
      ? db.prepare('SELECT id, title, status, lifecycle_state FROM autonomous_tasks WHERE id = ?').get(approval.task_id)
      : null;
    const isTaskAlreadyDone = Boolean(
      taskRow && (
        taskRow.status === 'completed' ||
        taskRow.status === 'skipped' ||
        ['COMPLETED', 'APPROVED', 'COMMIT_PENDING', 'SKIPPED'].includes(String(taskRow.lifecycle_state || ''))
      )
    );

    if (isTaskAlreadyDone) {
      db.prepare(`
        UPDATE autonomous_approvals
        SET status = 'superseded', decision = ?, decided_at = ?
        WHERE id = ?
      `).run('Suplantado: tarefa já concluída antes da resolução da aprovação', nowIso, approvalId);

      this.logEvent(
        approval.run_id,
        approval.task_id,
        'system',
        'LATE_APPROVAL_IGNORED',
        `Resolução de aprovação atrasada ignorada para "${approval.title}": a tarefa já estava concluída.`
      );

      const remainingPending: any[] = db.prepare("SELECT id FROM autonomous_approvals WHERE run_id = ? AND status = 'pending'").all(approval.run_id);
      if (remainingPending.length === 0) {
        const allTasks: any[] = db.prepare('SELECT status FROM autonomous_tasks WHERE run_id = ?').all(approval.run_id);
        const allDone = allTasks.length > 0 && allTasks.every(t => t.status === 'completed' || t.status === 'skipped');
        if (allDone) {
          db.prepare("UPDATE autonomous_runs SET status = 'completed', last_error = NULL, end_time = COALESCE(end_time, ?), next_action = 'Execução autônoma concluída', updated_at = ? WHERE id = ? AND status IN ('waiting_approval', 'blocked', 'paused')")
            .run(nowIso, nowIso, approval.run_id);
          try {
            const runRow: any = db.prepare('SELECT project_id FROM autonomous_runs WHERE id = ?').get(approval.run_id);
            if (runRow?.project_id) {
              import('./projectOperationsService.js').then(({ ProjectOperationsService }) => {
                ProjectOperationsService.postCompletionVisualSummaryToChat(runRow.project_id, approval.run_id).catch((err) => {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autonomousManager",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousManager]", err);
      }
    });
              }).catch((err) => {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autonomousManager",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousManager]", err);
      }
    });
            }
          } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autonomousManager",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousManager]", err);
      }
    }
        } else {
          db.prepare("UPDATE autonomous_runs SET status = 'running', last_error = NULL, next_action = 'Retomando execução autônoma', updated_at = ? WHERE id = ? AND status IN ('waiting_approval', 'blocked', 'paused')")
            .run(nowIso, approval.run_id);
        }
      }
      this.syncRunProgress(approval.run_id);
      return this.getRun(approval.run_id);
    }

    const decisionLabel = reason || (
      decision === 'expired'
        ? 'Expirado por timeout no fluxo de aprovação'
        : decision === 'failed'
        ? 'Falha registrada no fluxo de aprovação'
        : `Usuário escolheu: ${decision}`
    );

    db.prepare(`
      UPDATE autonomous_approvals
      SET status = ?, decision = ?, decided_at = ?
      WHERE id = ?
    `).run(decision, decisionLabel, nowIso, approvalId);

    // If task was blocked waiting approval, unblock or keep safely blocked according to decision
    if (approval.task_id) {
      if (decision === 'approved' || decision === 'delegated') {
        const taskRow: any = db.prepare("SELECT * FROM autonomous_tasks WHERE id = ?").get(approval.task_id);
        const existingReport: any = db.prepare("SELECT * FROM builder_reports WHERE task_id = ? AND status = 'success' ORDER BY created_at DESC LIMIT 1").get(approval.task_id);
        const evalResult = IndependentEvaluator.getEvaluationByTaskId(approval.task_id);
        const reportEval = safeJsonParse<any>(existingReport?.evaluation_json, null);
        const isVerifiedDone = Boolean((evalResult?.taskIsDone && evalResult.verdict === 'PASS') || (reportEval?.taskIsDone && reportEval.verdict === 'PASS') || existingReport?.build_status === 'passed');
        
        let nextStatus = 'ready';
        let nextLifecycle = 'READY';
        if (existingReport && isVerifiedDone) {
          nextStatus = 'in_review';
          nextLifecycle = 'REVIEW_PENDING';
        } else if (taskRow && (taskRow.retry_count > 0 || taskRow.replan_reason?.includes('AUTO_UNBLOCK') || approval.type === 'RISK_GATE' || approval.type === 'TAMPERING_ALERT')) {
          nextStatus = 'needs_changes';
          nextLifecycle = 'REWORK_REQUIRED';
        }

        try {
          HierarchicalOrchestrationService.transitionTaskState(
            approval.task_id,
            nextLifecycle === 'REVIEW_PENDING' ? 'READY' : (nextLifecycle === 'REWORK_REQUIRED' ? 'REWORK_REQUIRED' : 'READY'),
            'user',
            `Bloqueio resolvido pelo usuário (${decision}): "${approval.title}"`
          );
          db.prepare("UPDATE autonomous_tasks SET status = ?, lifecycle_state = ?, retry_count = 0, max_retries = CASE WHEN max_retries < 4 THEN 4 ELSE max_retries END, replan_reason = 'UNBLOCKED_BY_APPROVAL', updated_at = ? WHERE id = ?")
            .run(nextStatus, nextLifecycle, nowIso, approval.task_id);
        } catch {
          db.prepare("UPDATE autonomous_tasks SET status = ?, lifecycle_state = ?, retry_count = 0, max_retries = CASE WHEN max_retries < 4 THEN 4 ELSE max_retries END, replan_reason = 'UNBLOCKED_BY_APPROVAL', updated_at = ? WHERE id = ?")
            .run(nextStatus, nextLifecycle, nowIso, approval.task_id);
        }
        this.logEvent(approval.run_id, approval.task_id, 'user', 'APPROVAL_RESOLVED', `Usuário aprovou "${approval.title}". Tarefa liberada para ${nextStatus === 'in_review' ? 'revisão' : (nextStatus === 'needs_changes' ? 'auto-correção (REWORK_REQUIRED)' : 'execução')}.`);
      } else if (decision === 'expired' || decision === 'failed') {
        db.prepare("UPDATE autonomous_tasks SET status = 'blocked', lifecycle_state = 'BLOCKED', updated_at = ? WHERE id = ?").run(nowIso, approval.task_id);
        const evtType = decision === 'expired' ? 'APPROVAL_TIMEOUT' : 'APPROVAL_FAILED';
        this.logEvent(approval.run_id, approval.task_id, 'system', evtType, `Fluxo de aprovação para "${approval.title}" encerrado com ${decision.toUpperCase()}: ${decisionLabel}. Tarefa mantida bloqueada com segurança.`);
      } else {
        db.prepare("UPDATE autonomous_tasks SET status = 'blocked', lifecycle_state = 'BLOCKED', updated_at = ? WHERE id = ?").run(nowIso, approval.task_id);
        this.logEvent(approval.run_id, approval.task_id, 'user', 'APPROVAL_REJECTED', `Usuário rejeitou "${approval.title}". Tarefa mantida suspensa.`);
      }
    }

    const remainingPending: any[] = db.prepare("SELECT id FROM autonomous_approvals WHERE run_id = ? AND status = 'pending'").all(approval.run_id);
    if (remainingPending.length === 0) {
      if (decision === 'approved' || decision === 'delegated') {
        db.prepare(`
          UPDATE autonomous_runs
          SET status = 'running', last_error = NULL, next_action = 'Aprovação concedida; prosseguindo com execução autônoma', updated_at = ?
          WHERE id = ? AND status IN ('waiting_approval', 'blocked', 'paused')
        `).run(nowIso, approval.run_id);
        this.logEvent(approval.run_id, null, 'system', 'RUN_UNBLOCKED_BY_APPROVAL', 'Todas as aprovações pendentes foram resolvidas. Run retomado.');
      } else {
        const availableOther = this.getAvailableTasks(approval.run_id);
        const inReviewOrProgress: any = db.prepare("SELECT id FROM autonomous_tasks WHERE run_id = ? AND status IN ('in_progress', 'in_review') LIMIT 1").get(approval.run_id);
        if (availableOther.length > 0 || inReviewOrProgress) {
          db.prepare(`
            UPDATE autonomous_runs
            SET status = 'running', last_error = NULL, next_action = 'Prosseguindo com tarefas independentes disponíveis', updated_at = ?
            WHERE id = ? AND status = 'waiting_approval'
          `).run(nowIso, approval.run_id);
        } else {
          const errCode = decision === 'expired'
            ? `APPROVAL_TIMEOUT: ${decisionLabel}`
            : decision === 'failed'
            ? `APPROVAL_FAILED: ${decisionLabel}`
            : `APPROVAL_REJECTED: ${decisionLabel}`;
          db.prepare(`
            UPDATE autonomous_runs
            SET status = 'blocked', last_error = ?, next_action = 'Aprovação não concedida ou expirada; revise a tarefa bloqueada para retomar', updated_at = ?
            WHERE id = ? AND status IN ('waiting_approval', 'running', 'paused')
          `).run(errCode, nowIso, approval.run_id);
        }
      }
    }

    this.syncRunProgress(approval.run_id);
    return this.getRun(approval.run_id);
  }

  /**
   * Expire pending approvals that exceeded timeoutMs
   */
  static expireStaleApprovals(runId?: string, timeoutMs = 15 * 60 * 1000): number {
    const cutoffIso = new Date(Date.now() - timeoutMs).toISOString();
    const staleRows: any[] = runId
      ? db.prepare("SELECT id FROM autonomous_approvals WHERE run_id = ? AND status = 'pending' AND created_at <= ?").all(runId, cutoffIso)
      : db.prepare("SELECT id FROM autonomous_approvals WHERE status = 'pending' AND created_at <= ?").all(cutoffIso);
    let count = 0;
    for (const row of staleRows) {
      this.resolveHumanApproval(row.id, 'expired', `Tempo limite de aprovação (${Math.round(timeoutMs / 1000)}s) excedido sem resposta`);
      count++;
    }
    return count;
  }

  /**
   * Pause an active run
   */
  static pauseRun(runId: string) {
    RunControl.request(runId,'pause');RunControl.apply(runId);
    this.logEvent(runId, null, 'user', 'RUN_PAUSED', 'Build autônomo pausado pelo usuário.');
    return this.getRun(runId);
  }

  /**
   * Resume a paused run
   */
  private static resumeOperations = new Map<string, Promise<any>>();

  static async resumeRun(runId: string): Promise<any> {
    const existing = this.resumeOperations.get(runId);
    if (existing) return existing;
    const operation = this.resumeRunInternal(runId);
    this.resumeOperations.set(runId, operation);
    try { return await operation; } finally { this.resumeOperations.delete(runId); }
  }

  private static async resumeRunInternal(runId: string) {
    const run = this.getRun(runId);
    if (run.status === 'completed' || run.status === 'failed') return run;
    if(RunControl.get(runId)?.action==='cancel')return run;
    const { ExecutionCoordinator } = await import('./executionCoordinator.js');
    ExecutionCoordinator.reconcileDeadReservations();

    // Se o run está com ferramenta nativa legitimamente em voo no Antigravity, preservar estado e reserva
    const { AgentSessionManager } = await import('./agentSessionManager.js');
    const session = AgentSessionManager.getActiveSession(run.project_id, 'WORKER');
    const { AgentTurnState } = await import('./agentTurnState.js');
    const obs = session?.provider_conversation_id ? AgentTurnState.get(session.provider_conversation_id) : null;
    const progress = obs ? AgentTurnState.progress(obs) : null;
    if (progress && progress.pendingTools.length > 0 && !progress.pendingTools.includes('ask_question') && (run.last_error && run.last_error.includes('AGENT_NATIVE_TOOL_PENDING'))) {
      return this.getRun(runId);
    }

    // FORCE CLEAN DE RECONCILIAÇÃO:
    // 1. Limpar travas órfãs de execução compulsoriamente (global, por TTL > 5min ou pertencente a este run)
    db.prepare(`
      DELETE FROM execution_reservations
      WHERE scope = 'global-agent-execution'
         OR datetime(COALESCE(updated_at, created_at), '+5 minutes') < datetime('now')
         OR NOT json_valid(context_json)
         OR json_extract(CASE WHEN json_valid(context_json) THEN context_json ELSE '{}' END, '$.runId') = ?
         OR json_extract(CASE WHEN json_valid(context_json) THEN context_json ELSE '{}' END, '$.runId') NOT IN (SELECT id FROM autonomous_runs WHERE status NOT IN ('completed', 'failed', 'paused', 'cancelled', 'stopped', 'error'))
    `).run(runId);

    // 2. Limpar leases ativas e resetar workers associados a este run
    const { WorkerRegistry } = await import('./workerRegistry.js');
    const activeLeases: any[] = db.prepare("SELECT id, worker_id FROM worker_leases WHERE run_id = ? AND status = 'active'").all(runId);
    for (const lease of activeLeases) {
      WorkerRegistry.releaseLease(lease.id, lease.worker_id);
      WorkerRegistry.updateWorkerStatus(lease.worker_id, 'READY', { current_run_id: null, current_task_id: null, current_issue_number: null });
    }
    db.prepare("UPDATE worker_leases SET status = 'expired', released_at = ? WHERE run_id = ? AND status = 'active'").run(new Date().toISOString(), runId);

    // 3. Tentar auto-reconciliar se a tarefa atual já terminou comprovadamente no disco
    const { AutonomousRunnerService } = await import('./autonomousRunnerService.js');
    try {
      const reconciled = await AutonomousRunnerService.reconcileCompletedTurn(runId, { allowInsideCycle: true });
      if (reconciled) {
        db.prepare("UPDATE autonomous_runs SET status = 'running', last_error = NULL, next_action = 'Turno reconciliado com sucesso; prosseguindo', updated_at = ? WHERE id = ?").run(new Date().toISOString(), runId);
        setTimeout(() => { AutonomousRunnerService.triggerTick().catch((err) => {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autonomousManager",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousManager]", err);
      }
    }); }, 50);
        return this.getRun(runId);
      }
    } catch (e: any) {
      Logger.warn(`[AutonomousManager] Aviso na reconciliação de turno ao retomar: ${e.message}`);
    }

    // 4. Limpar observações presas em IN_FLIGHT ou UNCERTAIN para as tarefas desse run
    db.prepare(`
      UPDATE agent_turn_observations
      SET phase = 'CONSUMED'
      WHERE task_id IN (SELECT id FROM autonomous_tasks WHERE run_id = ?)
        AND phase IN ('IN_FLIGHT', 'UNCERTAIN')
    `).run(runId);

    // 5. Se houver tarefa presa em in_progress que não concluiu, repor para 'ready' para re-execução limpa
    const inProgressTasks: any[] = db.prepare("SELECT id, title FROM autonomous_tasks WHERE run_id = ? AND status = 'in_progress'").all(runId);
    for (const ipt of inProgressTasks) {
      db.prepare("UPDATE autonomous_tasks SET status = 'ready', lifecycle_state = 'READY', updated_at = ? WHERE id = ?").run(new Date().toISOString(), ipt.id);
      this.logEvent(runId, ipt.id, 'system', 'TASK_RESET_ON_RESUME', `Tarefa "${ipt.title}" redefinida para READY após force-clean de retomada.`);
    }

    // 6. Limpar last_error de lease ou reconciliação técnica e destravar circuit breaker
    try {
      const { SessionCircuitBreaker } = await import('./sessionCircuitBreaker.js');
      SessionCircuitBreaker.resetProjectWindow(run.project_id);
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autonomousManager",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousManager]", err);
      }
    }

    if (/^(TURN|LEASE|CRASH|NATIVE_WORKSPACE_SESSION)_RECONCILIATION_REQUIRED|EXECUTION_(BUSY|RECOVERY_REQUIRED)|SESSION_CREATION_STORM|SESSION_CREATION_UNCERTAIN/.test(run.last_error || '')) {
      db.prepare("UPDATE autonomous_runs SET last_error = NULL, updated_at = ? WHERE id = ?").run(new Date().toISOString(), runId);
    }
    const auth = DevAutonomyService.isProjectAuthorizedForLiveExecution(run.project_id);
    if (!auth.authorized) throw new Error(`AUTHORIZATION_GUARD: ${auth.reason}`);
    const { AccountProfileManager } = await import('./accountProfileManager.js');
    let profile = AccountProfileManager.getActiveProfileForProject(run.project_id);

    // Passo C: Auto-failover se a conta estiver em cooldown, quota ou requerendo login
    const isProfileAvailable = AccountProfileManager.isAccountAvailableForTasks(profile.id);
    const isQuotaBlocked = QuotaManager.isBlockedByQuota(profile.id).blocked;
    if (!isProfileAvailable || isQuotaBlocked) {
      try {
        Logger.info(`[AutonomousManager] Perfil "${profile.display_name}" indisponível ou esgotado. Tentando Auto-Failover na retomada...`);
        const failover = await AccountProfileManager.handleAccountFailureAndRapidSwitch({
          failedProfileId: profile.id,
          projectId: run.project_id,
          runId,
          error: new Error('RESOURCE_EXHAUSTED: 429 Limite de cota atingido ou conta requer autenticação na retomada.')
        });
        if (failover.switched) {
          Logger.info(`[AutonomousManager] Auto-Failover na retomada de run: "${failover.previousProfileId}" -> "${failover.activeProfile.display_name}".`);
          profile = failover.activeProfile;
        }
      } catch (fErr: any) {
        Logger.warn(`[AutonomousManager] Falha ao tentar auto-failover na retomada: ${fErr.message}`);
      }
    }

    if (/NATIVE_WORKSPACE_UNBOUND/.test(run.last_error || '')) {
      const { NativeWorkspaceBinding } = await import('./nativeWorkspaceBinding.js');
      const userProfileDir = AccountProfileManager.getUserProfileDir(profile);
      try {
        NativeWorkspaceBinding.ensureBinding(run.project_id, profile.id, userProfileDir);
        Logger.info(`[AutonomousManager] Vínculo nativo auto-reparado com sucesso para o Run [${runId.slice(0, 8)}]`);
      } catch (bindErr: any) {
        Logger.warn(`[AutonomousManager] Falha ao auto-reparar vínculo nativo: ${bindErr.message}`);
      }
    }

    const isOffline = (await import('./agentApiGateway.js')).AgentApiGateway.isOfflineMode();
    if (!isOffline) {
      const { AntigravityDiscovery } = await import('./antigravityDiscovery.js');
      const discovery = AntigravityDiscovery.discover();
      const runningInstance = AccountProfileManager.getRunningInstanceForProfile(profile.environment_path);
      if (!discovery.available || !runningInstance) {
        const errorMsg = !discovery.available
          ? `AGENTAPI_UNAVAILABLE: ${discovery.errorMessage}`
          : 'AGENTAPI_UNAVAILABLE: Language Server offline (Nenhuma instância ativa do Antigravity encontrada para este perfil)';
        db.prepare("UPDATE autonomous_runs SET status = 'waiting_resource', last_error = ?, next_action = 'Inicie o Google Antigravity e verifique se o processo está em execução para continuar', updated_at = ? WHERE id = ?")
          .run(errorMsg, new Date().toISOString(), runId);
        this.logEvent(runId, null, 'system', 'WAITING_RESOURCE', `Execução não pôde ser retomada: runtime do Antigravity indisponível (${errorMsg})`);
        return this.getRun(runId);
      }
    }

    // If the run has blocked tasks, check if IndependentEvaluator verifies the files on disk
    const blockedTasks: any[] = db.prepare(`
      SELECT id, title, contract_id, description, criteria_json, verification_command, expected_files_json FROM autonomous_tasks
      WHERE run_id = ? AND status = 'blocked'
    `).all(runId);
    for (const bt of blockedTasks) {
      let evalRes = IndependentEvaluator.getEvaluationByTaskId(bt.id);
      if (!evalRes || evalRes.verdict !== 'PASS') {
        try {
          let contract = bt.contract_id ? IndependentEvaluator.getContract(bt.contract_id) : null;
          if (!contract) {
            const criteria = safeJsonParse(bt.criteria_json, []);
            contract = IndependentEvaluator.createSuccessContract({
              taskId: bt.id,
              runId,
              projectId: run.project_id,
              projectPath: run.project.path,
              objective: bt.description,
              acceptanceCriteria: criteria,
              verificationCommand: bt.verification_command || 'npm test',
              protectedEvaluationFiles: IndependentEvaluator.listEvaluationFiles(run.project.path)
            });
          }
          const expectedFiles = safeJsonParse(bt.expected_files_json, []);
          const filesChanged = expectedFiles.length > 0 ? expectedFiles : (contract.protectedEvaluationFiles && contract.protectedEvaluationFiles.length > 0 ? contract.protectedEvaluationFiles : ['index.js']);
          evalRes = await IndependentEvaluator.evaluate(
            contract.id,
            run.project.path,
            {
              status: 'success',
              filesChanged,
              implemented: [bt.title],
              tests: { passed: true, exitCode: 0 },
              problems: []
            },
            { expectedScopeFiles: expectedFiles }
          );
        } catch (probeErr: any) {
          Logger.warn(`[AutonomousManager] Falha ao testar contrato do avaliador na retomada: ${probeErr.message}`);
        }
      }
      if (evalRes?.taskIsDone && evalRes.verdict === 'PASS') {
        db.prepare("UPDATE autonomous_tasks SET status = 'in_review', lifecycle_state = 'REVIEW_PENDING', retry_count = 0, updated_at = ? WHERE id = ?").run(new Date().toISOString(), bt.id);
        db.prepare("UPDATE autonomous_approvals SET status = 'approved', decision = 'Auto-resolvido: código e testes validados pelo IndependentEvaluator no disco', decided_at = ? WHERE task_id = ? AND status = 'pending'").run(new Date().toISOString(), bt.id);
        this.logEvent(runId, bt.id, 'system', 'APPROVAL_AUTO_RESOLVED', `Tarefa "${bt.title}" unblocked para revisão: IndependentEvaluator comprovou sucesso no disco.`);
      }
    }

    // Reopen any remaining blocked tasks into REWORK_REQUIRED upon resumption
    const remainingBlockedTasks: any[] = db.prepare(`
      SELECT id, title, retry_count, max_retries FROM autonomous_tasks
      WHERE run_id = ? AND status = 'blocked'
    `).all(runId);
    for (const rbt of remainingBlockedTasks) {
      db.prepare(`
        UPDATE autonomous_tasks
        SET status = 'needs_changes',
            lifecycle_state = 'REWORK_REQUIRED',
            retry_count = 0,
            max_retries = CASE WHEN max_retries < 4 THEN 4 ELSE max_retries END,
            replan_reason = 'RESUME_AUTO_REWORK',
            updated_at = ?
        WHERE id = ?
      `).run(new Date().toISOString(), rbt.id);
      db.prepare(`
        UPDATE autonomous_approvals
        SET status = 'approved', decision = 'Retomado com reabertura para auto-correção', decided_at = ?
        WHERE task_id = ? AND status = 'pending'
      `).run(new Date().toISOString(), rbt.id);
      this.logEvent(runId, rbt.id, 'system', 'TASK_REOPENED_FOR_REWORK', `Tarefa "${rbt.title}" reaberta em auto-correção (REWORK_REQUIRED) com contador de tentativas resetado para conclusão autônoma.`);
    }

    // Reset any errored tasks back to ready
    const erroredTasks: any[] = db.prepare("SELECT id, title FROM autonomous_tasks WHERE run_id = ? AND status = 'error'").all(runId);
    for (const et of erroredTasks) {
      db.prepare("UPDATE autonomous_tasks SET status = 'ready', lifecycle_state = 'READY', retry_count = 0, updated_at = ? WHERE id = ?").run(new Date().toISOString(), et.id);
      this.logEvent(runId, et.id, 'system', 'TASK_RESET_ON_RESUME', `Tarefa "${et.title}" redefinida para READY após retomada.`);
    }

    // Reset retry_count on exhausted rework tasks
    const exhaustedRework: any[] = db.prepare("SELECT id, title FROM autonomous_tasks WHERE run_id = ? AND status = 'needs_changes' AND retry_count >= max_retries").all(runId);
    for (const er of exhaustedRework) {
      db.prepare("UPDATE autonomous_tasks SET retry_count = 0, max_retries = CASE WHEN max_retries < 4 THEN 4 ELSE max_retries END, updated_at = ? WHERE id = ?").run(new Date().toISOString(), er.id);
      this.logEvent(runId, er.id, 'system', 'TASK_RETRIES_RESET_ON_RESUME', `Contador de tentativas da tarefa "${er.title}" resetado para 0.`);
    }

    if (!run.tasks.length) {
      db.prepare("UPDATE autonomous_runs SET status='planning',updated_at=? WHERE id=?").run(new Date().toISOString(), runId);
      try {
        await this.generateInitialTasks(runId, { name: run.name || 'Continuação', ...safeJsonParse<any>(run.config_json, {}), projectId: run.project_id, objective: run.objective, briefing: run.briefing }, run.project);
      } catch (err: any) {
        const quota = /429|RESOURCE_EXHAUSTED|QUOTA_EXHAUSTED/.test(err.message);
        db.prepare("UPDATE autonomous_runs SET status=?,last_error=?,next_action='Resolver bloqueio e retomar o mesmo Run',updated_at=? WHERE id=?").run(quota ? 'paused' : 'error',err.message, new Date().toISOString(), runId);
        this.logEvent(runId, null, 'system', 'RESUME_BLOCKED', err.message);
        return this.getRun(runId);
      }
    }
    db.prepare("UPDATE autonomous_runs SET status='running',last_error=NULL,next_action='Retomar execução do backlog existente',updated_at=? WHERE id=?").run(new Date().toISOString(), runId);
    this.logEvent(runId, null, 'user', 'RUN_RESUMED', 'Build autônomo retomado.');
    this.syncRunProgress(runId);
    const { AutonomousRunnerService: Runner } = await import('./autonomousRunnerService.js');
    setTimeout(() => {
      Runner.triggerTick().catch((err) => {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autonomousManager",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousManager]", err);
      }
    });
    }, 50);
    return this.getRun(runId);
  }

  /**
   * Stop an active run
   */
  static stopRun(runId: string) {
    RunControl.request(runId,'cancel');RunControl.apply(runId);
    this.logEvent(runId, null, 'user', 'RUN_CANCEL_REQUESTED', 'Cancelamento solicitado; a operação atual será preservada até uma fronteira segura.');
    return this.getRun(runId);
  }

  /**
   * Forcing clean de emergência de reservas órfãs e destravamento de runs estagnados.
   */
  static async forceUnlockExecution(options?: { runId?: string; projectId?: string }): Promise<{
    success: boolean;
    clearedReservations: number;
    clearedTurns: number;
    unlockedRuns: string[];
    message: string;
  }> {
    const { WorkerRegistry } = await import('./workerRegistry.js');
    const { AutonomousRunnerService } = await import('./autonomousRunnerService.js');
    const nowIso = new Date().toISOString();

    // 1. Limpeza de execution_reservations (global, TTL > 5min ou run específico)
    let clearedReservations = 0;
    const delRes = db.prepare(`
      DELETE FROM execution_reservations
      WHERE scope = 'global-agent-execution'
         OR datetime(COALESCE(updated_at, created_at), '+5 minutes') < datetime('now')
         OR NOT json_valid(context_json)
         OR (? IS NOT NULL AND json_extract(CASE WHEN json_valid(context_json) THEN context_json ELSE '{}' END, '$.runId') = ?)
    `).run(options?.runId || null, options?.runId || null);
    clearedReservations += Number(delRes.changes);

    // 2. Limpeza de observações de turno presas
    let turnQuery = `
      UPDATE agent_turn_observations
      SET phase = 'CONSUMED'
      WHERE phase IN ('IN_FLIGHT', 'UNCERTAIN')
        AND (dispatched_at < datetime('now', '-5 minutes')
    `;
    const turnParams: any[] = [];
    if (options?.runId) {
      turnQuery += ` OR task_id IN (SELECT id FROM autonomous_tasks WHERE run_id = ?)`;
      turnParams.push(options.runId);
    }
    turnQuery += `)`;
    const delTurns = db.prepare(turnQuery).run(...turnParams);
    const clearedTurns = Number(delTurns.changes);

    // 3. Reset de leases de workers
    if (options?.runId) {
      const activeLeases: any[] = db.prepare("SELECT id, worker_id FROM worker_leases WHERE run_id = ? AND status = 'active'").all(options.runId);
      for (const lease of activeLeases) {
        WorkerRegistry.releaseLease(lease.id, lease.worker_id);
        WorkerRegistry.updateWorkerStatus(lease.worker_id, 'READY', { current_run_id: null, current_task_id: null, current_issue_number: null });
      }
      db.prepare("UPDATE worker_leases SET status = 'expired', released_at = ? WHERE run_id = ? AND status = 'active'").run(nowIso, options.runId);
    } else {
      const staleLeases: any[] = db.prepare("SELECT id, worker_id FROM worker_leases WHERE status = 'active' AND lease_until < ?").all(nowIso);
      for (const lease of staleLeases) {
        WorkerRegistry.releaseLease(lease.id, lease.worker_id);
        WorkerRegistry.updateWorkerStatus(lease.worker_id, 'READY', { current_run_id: null, current_task_id: null, current_issue_number: null });
      }
      db.prepare("UPDATE worker_leases SET status = 'expired', released_at = ? WHERE status = 'active' AND lease_until < ?").run(nowIso, nowIso);
    }

    // 4. Destravar runs em estado de falha ou pausa
    const unlockedRuns: string[] = [];
    let runsToUnlock: any[] = [];
    if (options?.runId) {
      const r: any = db.prepare("SELECT id, project_id, status FROM autonomous_runs WHERE id = ?").get(options.runId);
      if (r) runsToUnlock.push(r);
    } else if (options?.projectId) {
      runsToUnlock = db.prepare("SELECT id, project_id, status FROM autonomous_runs WHERE project_id = ? AND status IN ('failed', 'paused', 'error')").all(options.projectId);
    } else {
      runsToUnlock = db.prepare("SELECT id, project_id, status FROM autonomous_runs WHERE status IN ('failed', 'paused', 'error') AND (last_error LIKE '%EXECUTION_BUSY%' OR last_error LIKE '%RECONCILIATION_REQUIRED%')").all();
    }

    for (const r of runsToUnlock) {
      db.prepare(`
        UPDATE autonomous_runs
        SET status = 'running', last_error = NULL, next_action = 'Execução destravada via Force-Unlock', updated_at = ?
        WHERE id = ?
      `).run(nowIso, r.id);
      unlockedRuns.push(r.id);

      // Reabrir tarefas presas em in_progress para ready
      db.prepare(`
        UPDATE autonomous_tasks
        SET status = 'ready', lifecycle_state = 'READY', updated_at = ?
        WHERE run_id = ? AND status = 'in_progress'
      `).run(nowIso, r.id);

      try {
        const { SessionCircuitBreaker } = await import('./sessionCircuitBreaker.js');
        SessionCircuitBreaker.resetProjectWindow(r.project_id);
      } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autonomousManager",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousManager]", err);
      }
    }

      AutonomousManager.logEvent(r.id, null, 'system', 'FORCE_UNLOCK_APPLIED', 'Execução destravada via Force-Unlock; bloqueios e reservas órfãs limpos.');
    }

    if (unlockedRuns.length > 0) {
      setTimeout(() => {
        AutonomousRunnerService.schedulerTick().catch((err) => {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autonomousManager",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousManager]", err);
      }
    });
      }, 50);
    }

    return {
      success: true,
      clearedReservations,
      clearedTurns,
      unlockedRuns,
      message: `Force-Unlock concluído com sucesso (${clearedReservations} reservas limpas, ${clearedTurns} turnos liberados, ${unlockedRuns.length} run(s) destravados).`
    };
  }

  /**
   * Hierarchical Orchestration Delegating Methods
   */
  static transitionTaskState(
    taskId: string,
    toLifecycleState: MicrotaskLifecycleState,
    actor: AgentRole,
    reason: string,
    metadata?: Record<string, any>
  ) {
    return HierarchicalOrchestrationService.transitionTaskState(taskId, toLifecycleState, actor, reason, metadata);
  }

  static replanRun(params: {
    runId: string;
    userRequest: string;
    replanType: ReplanType;
    originTaskId?: string;
    newMajorTaskTitle?: string;
    newMajorTaskObjective?: string;
    newMicrotasks?: MicrotaskSpec[];
    targetMajorTaskId?: string;
  }) {
    const result = HierarchicalOrchestrationService.replanRunForRequirementChange(params);
    this.getAvailableTasks(params.runId);
    this.syncRunProgress(params.runId);
    return {
      ...result,
      run: this.getRun(params.runId)
    };
  }

  static buildWorkerExecutionContract(taskId: string) {
    const contract = HierarchicalOrchestrationService.buildWorkerExecutionContract(taskId);
    try {
      const evalRow: any = db
        .prepare('SELECT evaluator_notes, actual, verdict FROM evaluation_results WHERE task_id = ? ORDER BY created_at DESC LIMIT 1')
        .get(taskId);
      const evalNotes = evalRow?.evaluator_notes || evalRow?.actual;
      if (evalNotes && contract.reworkContext) {
        if (!Array.isArray(contract.reworkContext.problemsFound)) {
          contract.reworkContext.problemsFound = [];
        }
        const noteStr = typeof evalNotes === 'string' ? evalNotes : JSON.stringify(evalNotes);
        if (noteStr.trim() && !contract.reworkContext.problemsFound.some((p: string) => p.includes(noteStr) || noteStr.includes(p))) {
          contract.reworkContext.problemsFound.unshift(`[EVALUATOR_NOTES] ${noteStr.trim()}`);
        }
      }
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autonomousManager",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousManager]", err);
      }
    }
    return contract;
  }

  static recordAgentCommunication(input: AgentCommunicationInput) {
    return HierarchicalOrchestrationService.recordAgentCommunication(input);
  }

  static validateProjectFinalCompletion(runId: string) {
    return HierarchicalOrchestrationService.validateProjectFinalCompletion(runId);
  }

  static getMajorTasksForRun(runId: string) {
    return HierarchicalOrchestrationService.getMajorTasksForRun(runId);
  }

  static getAgentCommunications(runId: string, microTaskId?: string) {
    return HierarchicalOrchestrationService.getAgentCommunications(runId, microTaskId);
  }

  static getStateTransitions(runId: string, taskId?: string) {
    return HierarchicalOrchestrationService.getStateTransitions(runId, taskId);
  }

  static queryPlanDiagnostics(runId: string, question?: string) {
    return HierarchicalOrchestrationService.queryPlanDiagnostics(runId, question);
  }

  static getProjectRequirements(runId: string) {
    return HierarchicalOrchestrationService.getProjectRequirements(runId);
  }

  static ensureRequirementCoverage(runId: string, options?: { projectPath?: string }) {
    const res = HierarchicalOrchestrationService.ensureRequirementCoverage(runId, options);
    this.getAvailableTasks(runId);
    this.syncRunProgress(runId);
    return res;
  }

  static discoverDynamicSubtasks(params: {
    runId: string;
    originTaskId?: string;
    targetMajorTaskId?: string;
    discoveredFrom?: 'execution_gap' | 'review_feedback' | 'evaluator_failure' | 'missing_dependency' | 'requirement_gap' | string;
    discoverySource?: string;
    reason: string;
    subtasks?: HierarchicalMicrotaskInput[];
    discoveredTasks?: HierarchicalMicrotaskInput[];
    maxSubtasksPerDiscovery?: number;
    maxAllowedDepth?: number;
  }) {
    const res = HierarchicalOrchestrationService.discoverDynamicSubtasks(params);
    this.getAvailableTasks(params.runId);
    this.syncRunProgress(params.runId);
    return res;
  }

  static decomposeProjectAdaptively(params: {
    projectId: string;
    runId: string;
    projectPath: string;
    briefing?: string;
    originalDescription?: string;
    requirements?: string[];
    initialFlatTasks?: HierarchicalMicrotaskInput[];
    initialMajorTasks?: HierarchicalMajorTaskInput[];
    ensureFullCoverage?: boolean;
  }) {
    const res = HierarchicalOrchestrationService.decomposeProjectAdaptively(params);
    this.getAvailableTasks(params.runId);
    this.syncRunProgress(params.runId);
    return res;
  }

  /**
   * Compile the Overnight / Morning Final Report
   */
  static generateOvernightReport(runId: string): string {
    const run = this.getRun(runId);
    const completedTasks = run.tasks.filter((t: any) => t.status === 'completed');
    const blockedTasks = run.tasks.filter((t: any) => t.status === 'blocked');
    const pendingApprovals = run.approvals.filter((a: any) => a.status === 'pending');

    const durationMinutes = Math.round((Date.now() - new Date(run.start_time).getTime()) / 60000);
    const durationFormatted = `${Math.floor(durationMinutes / 60)}h ${durationMinutes % 60}m`;

    return `# [RELATORIO] OVERNIGHT BUILD REPORT — ${run.name}
**Projeto:** ${run.project?.name || 'N/A'}
**Status Final:** ${run.status.toUpperCase()}
**Duração Total:** ${durationFormatted}
**Branch:** \`${run.branch_name || 'main'}\`
**Modo de Autonomia:** ${run.autonomy_mode.toUpperCase()}
**Progresso do MVP:** ${run.stats.progressPct}% (${completedTasks.length}/${run.stats.total} tarefas concluídas)

---

## [RESUMO] Resumo Executivo
- **Objetivo:** ${run.objective}
- **Ciclos Executados:** ${run.current_cycle} ciclos
- **Aprovações Pendentes na Inbox:** ${pendingApprovals.length}
- **Tarefas Bloqueadas pelo Watchdog:** ${blockedTasks.length}

---

## [TAREFAS] Tarefas Concluídas
${completedTasks.map((t: any) => `- **[${t.milestone}] ${t.title}**\n  ${t.description}`).join('\n\n') || '- Nenhuma tarefa concluída.'}

---

## [BLOQUEIOS] Bloqueios & Decisões Aguardando Usuário
${pendingApprovals.map((a: any) => `* **[${a.risk_level.toUpperCase()}] ${a.title}**\n  - Contexto: ${a.context}\n  - Recomendação do Supervisor: ${a.supervisor_recommendation}`).join('\n') || '- Nenhuma aprovação pendente no momento.'}

---

## [PROXIMOS_PASSOS] Próximos Passos Recomendados
1. Revisar itens na **Approval Inbox** para destravar tarefas pendentes.
2. Executar validação visual de QA nos componentes adicionados.
3. Se o resultado for satisfatório, mesclar a branch isolada \`${run.branch_name}\` na branch principal.`;
  }

  public static async postCompletionVisualSummaryToChat(projectId: string, runId: string) {
    const { ProjectOperationsService } = await import('./projectOperationsService.js');
    return ProjectOperationsService.postCompletionVisualSummaryToChat(projectId, runId);
  }
}
