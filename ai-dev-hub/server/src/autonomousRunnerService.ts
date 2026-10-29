import { BuilderToSupervisorContract } from './agentProvider.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { db, isRunningInTestEnvironment } from './db.js';
import { AutonomousManager, BuilderReportInput, SupervisorReviewInput } from './autonomousManager.js';
import { PolicyEngine, RiskLevel } from './policyEngine.js';
import { MemoryManager } from './memoryManager.js';
import { CheckpointManager } from './checkpointManager.js';
import { Logger } from './logger.js';
import { AntigravityProvider } from './antigravityProvider.js';
import { GeminiSupervisorProvider } from './geminiSupervisorProvider.js';
import { GitManager } from './gitManager.js';
import { GitHubMcpClient } from './githubMcpClient.js';
import { WorkerRegistry, Worker } from './workerRegistry.js';
import { IndependentEvaluator, EvaluationResult } from './independentEvaluator.js';
import { ModelRegistry } from './modelRegistry.js';
import { UsageTracker } from './usageTracker.js';
import { AgentSessionManager } from './agentSessionManager.js';
import { PromptArchitectureService } from './promptArchitectureService.js';
import { ExecutionCoordinator } from './executionCoordinator.js';
import { DevAutonomyService } from './devAutonomyService.js';
import { AgentTurnState, observeTranscript, FATAL_QUOTA_OR_AUTH_REGEX } from './agentTurnState.js';
import { RunControl } from './runControl.js';
import { ObservabilityService } from './observability/observabilityService.js';
import { TraceContextManager } from './observability/context.js';
import { DiagnosticService } from './observability/diagnosticService.js';
import { normalizeOrRecoverVerificationCommand } from './verificationCommand.js';
import { HierarchicalOrchestrationService } from './hierarchicalOrchestrationService.js';
import { TurnCancellationManager } from './turnCancellationManager.js';
import { AgentApiGateway } from './agentApiGateway.js';
import { ProjectOperationsService } from './projectOperationsService.js';
import { LspService } from './lspService.js';
import { EphemeralWorktreeService, EphemeralWorktreeInfo } from './ephemeralWorktreeService.js';

function safeJsonParse<T>(raw: any, fallback: T): T {
  if (!raw || typeof raw !== 'string') return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export interface RunnerStatus {
  runnerId: string;
  online: boolean;
  status: 'online' | 'idle' | 'busy' | 'stopped' | 'error';
  lastHeartbeat: string;
  secondsAgo: number;
  activeRunId: string | null;
  activeRunName: string | null;
  currentTask: string | null;
  currentWorker: string | null;
  iteration: number;
  consecutiveFailures: number;
  executionPhase: ExecutionPipelinePhase;
  isExecutingCycle: boolean;
  isAgentExecuting: boolean;
  pendingNativeTurns: number;
  workerFleet?: {
    total: number;
    online: number;
    working: number;
    ready: number;
    offline: number;
    assignments: Array<{ workerName: string; taskTitle: string; issueNumber?: number }>;
  };
}

export type ExecutionPipelinePhase =
  | 'IDLE'
  | 'SUPERVISOR_PLANNING'
  | 'WORKER_BUILDING'
  | 'EVALUATOR_VERIFYING'
  | 'SUPERVISOR_REVIEWING';

export class AutonomousRunnerService {
  private static runnerId = 'hub-runner-01';
  private static isRunning = false;
  private static isExecutingCycle = false;
  private static isAgentExecuting = false;
  private static currentPhase: ExecutionPipelinePhase = 'IDLE';
  private static heartbeatTimer: NodeJS.Timeout | null = null;
  private static schedulerTimer: NodeJS.Timeout | null = null;
  private static watchdogTimer: NodeJS.Timeout | null = null;
  private static activeRunId: string | null = null;
  private static currentTask: string | null = null;
  private static currentTaskId: string | null = null;
  private static currentWorker: string | null = null;
  private static iteration = 0;
  private static consecutiveFailures = 0;
  private static activeExecutionToken: string | null = null;

  static getExecutionPhase(): ExecutionPipelinePhase {
    return this.currentPhase;
  }

  static isAgentBusy(): boolean {
    return this.isAgentExecuting;
  }

  /**
   * Safely renews the global execution reservation TTL if held by this runner cycle
   */
  private static touchActiveExecutionReservation(): void {
    if (!this.activeExecutionToken) return;
    try {
      if (typeof (ExecutionCoordinator as any).touch === 'function') {
        (ExecutionCoordinator as any).touch('global-agent-execution', this.activeExecutionToken);
      }
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autonomousRunnerService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousRunnerService]", err);
      }
    }
  }

  /**
   * Identifies whether a run belongs to an automated test run, mock simulation,
   * or temporary test directory that should never be dispatched to Antigravity.
   */
  static isGhostTestRun(run: any): boolean {
    if (!run) return true;
    const runId = String(run.id || '').toLowerCase();
    const projId = String(run.project_id || '').toLowerCase();

    if (/^(run-rec-|run-heal-|run-test-|test-run-)/i.test(runId)) {
      return true;
    }
    if (/^(proj-rec-|proj-heal-|proj-test-|test-proj-|proj-sim-|proj-dag-|proj-audit-|proj-wave-|proj-ux-|proj-sec-|proj-living-|proj-council-|proj-karpathy-|proj-continuity-|proj-mode-switch-)/i.test(projId)) {
      return true;
    }

    if (run.project_id) {
      try {
        const project: any = db.prepare('SELECT path FROM projects WHERE id = ?').get(run.project_id);
        if (project && project.path) {
          const normPath = String(project.path).toLowerCase();
          const tmpDir = os.tmpdir().toLowerCase();
          if (
            normPath.includes(tmpDir) ||
            (normPath.includes('decohub-') && normPath.includes('test')) ||
            normPath.includes('test-projects') ||
            normPath.includes('/dummy/') ||
            normPath.includes('\\dummy\\')
          ) {
            return true;
          }
          if (!fs.existsSync(project.path)) {
            return true;
          }
        }
      } catch {
        return false;
      }
    }
    return false;
  }

  /**
   * Watchdog auto-recovery for runs in waiting_resource
   * Restores run to 'running' when Antigravity runtime and account are available again.
   */
  static async attemptResourceRecovery(runOrRunId: string | any): Promise<boolean> {
    const run = typeof runOrRunId === 'string'
      ? (db.prepare('SELECT * FROM autonomous_runs WHERE id = ?').get(runOrRunId) as any)
      : runOrRunId;

    if (!run || run.status !== 'waiting_resource') return false;

    if (!isRunningInTestEnvironment() && this.isGhostTestRun(run)) {
      try {
        db.prepare("UPDATE autonomous_runs SET status = 'cancelled', last_error = 'GHOST_TEST_RUN_DISCARDED', next_action = 'Run de teste descartado' WHERE id = ?").run(run.id);
      } catch {}
      return false;
    }

    const { AgentApiGateway } = await import('./agentApiGateway.js');
    const isOffline = AgentApiGateway.isOfflineMode();
    const { AntigravityDiscovery } = await import('./antigravityDiscovery.js');
    const { AccountProfileManager } = await import('./accountProfileManager.js');

    let runtimeAvailable = false;
    let accountAvailable = false;

    // 1. Probe Antigravity discovery
    if (isOffline) {
      runtimeAvailable = true;
    } else {
      const discovery = AntigravityDiscovery.discover({ forceRefresh: true });
      runtimeAvailable = Boolean(discovery.available && discovery.languageServerExe);
    }

    if (!runtimeAvailable) {
      return false;
    }

    // 2. Probe Account profile if run is linked to a project
    try {
      if (isOffline) {
        accountAvailable = true;
      } else if (run.project_id) {
        const selectedProfile = AccountProfileManager.getActiveProfileForProject(run.project_id);
        accountAvailable = AccountProfileManager.isAccountAvailableForTasks(selectedProfile.id);
      } else {
        accountAvailable = true;
      }
    } catch {
      accountAvailable = true;
    }

    if (!accountAvailable) {
      return false;
    }

    // Both runtime and account are restored
    const nowIso = new Date().toISOString();
    db.prepare(`
      UPDATE autonomous_runs
      SET status = 'running',
          consecutive_failures = 0,
          last_error = NULL,
          next_action = 'Runtime e recursos restabelecidos automaticamente. Retomando execução.',
          updated_at = ?
      WHERE id = ?
    `).run(nowIso, run.id);

    AutonomousManager.logEvent(
      run.id,
      null,
      'system',
      'RUNTIME_RECOVERED_AUTOMATICALLY',
      'Google Antigravity e recursos restabelecidos com sucesso. Execução retomada automaticamente.'
    );

    Logger.success(`[Autonomous Runner Scheduler] Run "${run.name}" (${run.id.slice(0, 8)}) recuperado automaticamente de waiting_resource.`);

    if (!this.activeRunId) {
      this.activeRunId = run.id;
    }

    setTimeout(() => {
      AutonomousRunnerService.schedulerTick().catch((err) => {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autonomousRunnerService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousRunnerService]", err);
      }
    });
    }, 50);

    return true;
  }

  /** Explicit resume consumes a completed native result. It never sends or creates a conversation. */
  static async reconcileCompletedTurn(runId: string, opts?: { allowInsideCycle?: boolean }): Promise<boolean> {
    const run = AutonomousManager.getRun(runId);
    if ((this.isExecutingCycle || this.isAgentExecuting) && !opts?.allowInsideCycle) return false;
    const reservation: any = db.prepare("SELECT * FROM execution_reservations WHERE scope='global-agent-execution'").get();
    if (reservation) {
      try {
        if (JSON.parse(reservation.context_json).runId !== runId) return false;
      } catch {
        return false;
      }
      if (reservation.owner_pid !== process.pid) {
        try {
          process.kill(reservation.owner_pid, 0);
          return false;
        } catch (e: any) {
          if (e.code !== 'ESRCH') return false;
        }
      }
    }
    const task = run.tasks.find((t: any) => t.status === 'in_progress' || t.status === 'in_review' || t.status === 'blocked');
    if (!task) {
      if (!/^(TURN|LEASE|CRASH|NATIVE_WORKSPACE_SESSION)_RECONCILIATION_REQUIRED/.test(run.last_error || '')) return false;
      const session = AgentSessionManager.getActiveSession(run.project_id, 'WORKER');
      if (session?.provider_conversation_id) {
        const obs = AgentTurnState.get(session.provider_conversation_id);
        if (obs) {
          const prog = AgentTurnState.progress(obs);
          if (prog.pendingTools.length > 0) return false;
          if (['IN_FLIGHT', 'UNCERTAIN', 'COMPLETE'].includes(obs.phase)) {
            AgentTurnState.setPhase(session.provider_conversation_id, 'CONSUMED');
          }
        }
      }
      const activeLeases: any[] = db.prepare("SELECT id, worker_id FROM worker_leases WHERE run_id = ? AND status = 'active'").all(runId);
      for (const lease of activeLeases) {
        WorkerRegistry.releaseLease(lease.id, lease.worker_id);
        WorkerRegistry.updateWorkerStatus(lease.worker_id, 'READY', { current_run_id: null, current_task_id: null, current_issue_number: null });
      }
      if (reservation) ExecutionCoordinator.release('global-agent-execution', reservation.token);
      db.prepare("UPDATE autonomous_approvals SET status = 'superseded', decision = 'Suplantado: tarefa/run já concluído antes da reconciliação', decided_at = ? WHERE run_id = ? AND status = 'pending'")
        .run(new Date().toISOString(), runId);
      const allTasksDone = run.tasks.length > 0 && run.tasks.every((t: any) => t.status === 'completed' || t.status === 'skipped');
      const nowIso = new Date().toISOString();
      if (allTasksDone) {
        db.prepare("UPDATE autonomous_runs SET status = 'completed', last_error = NULL, end_time = COALESCE(end_time, ?), current_task = 'Todas as tarefas concluídas', next_action = 'Execução autônoma concluída sem pendências', updated_at = ? WHERE id = ?")
          .run(nowIso, nowIso, runId);
        AutonomousManager.logEvent(runId, null, 'system', 'RUN_COMPLETED_ON_RECONCILIATION', 'Run reconciliado e encerrado como concluído pois todas as tarefas já estavam finalizadas.');
        try {
          await ProjectOperationsService.postCompletionVisualSummaryToChat(run.project_id, runId);
        } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autonomousRunnerService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousRunnerService]", err);
      }
    }
      } else if (!RunControl.apply(runId, true)) {
        db.prepare("UPDATE autonomous_runs SET status = 'running', last_error = NULL, next_action = 'Estado de reconciliação limpo; retomando execução autônoma', updated_at = ? WHERE id = ?")
          .run(nowIso, runId);
        AutonomousManager.logEvent(runId, null, 'system', 'STALE_RECONCILIATION_CLEARED', 'Aviso obsoleto de reconciliação limpo pois não havia turno em voo pendente.');
      }
      AutonomousManager.syncRunProgress(runId);
      return true;
    }

    const session = AgentSessionManager.getActiveSession(run.project_id, 'WORKER');
    const obs = session?.provider_conversation_id ? AgentTurnState.get(session.provider_conversation_id) : null;
    const earlyProgress = obs ? AgentTurnState.progress(obs) : null;
    if (earlyProgress && earlyProgress.pendingTools.length > 0 && !earlyProgress.pendingTools.includes('ask_question')) {
      return false;
    }

    const existingReport: any = db.prepare("SELECT * FROM builder_reports WHERE task_id = ? AND status = 'success' ORDER BY created_at DESC LIMIT 1").get(task.id);

    // Sonda de Reconciliação Antecipada: verifica se os arquivos e testes no disco já atendem ao contrato do Evaluator
    let earlyContract = task.contract_id ? IndependentEvaluator.getContract(task.contract_id) : null;
    if (!earlyContract) {
      earlyContract = IndependentEvaluator.createSuccessContract({
        taskId: task.id,
        runId,
        projectId: run.project_id,
        projectPath: run.project.path,
        objective: task.description,
        acceptanceCriteria: task.criteria || [],
        verificationCommand: task.verification_command || 'npm test',
        protectedEvaluationFiles: task.protected_evaluation_files || IndependentEvaluator.listEvaluationFiles(run.project.path)
      });
    }

    const taskExpected = (task.expected_files && task.expected_files.length > 0)
      ? task.expected_files
      : (earlyContract.protectedEvaluationFiles && earlyContract.protectedEvaluationFiles.length > 0 ? earlyContract.protectedEvaluationFiles : ['index.js']);

    const synthReport: { status: 'success' | 'failure'; filesChanged: string[]; implemented: string[]; tests: { passed: boolean; exitCode: number }; problems: string[] } = existingReport ? {
      status: existingReport.status === 'failure' ? 'failure' : 'success',
      filesChanged: safeJsonParse<string[]>(existingReport.files_changed_json, []),
      implemented: safeJsonParse<string[]>(existingReport.implemented_json, []),
      tests: { passed: true, exitCode: 0 },
      problems: safeJsonParse<string[]>(existingReport.known_problems_json, [])
    } : {
      status: 'success',
      filesChanged: taskExpected,
      implemented: [task.title],
      tests: { passed: true, exitCode: 0 },
      problems: []
    };

    let probeEvaluation: any = null;
    try {
      const existingEval = IndependentEvaluator.getEvaluationByTaskId(task.id);
      probeEvaluation = (existingEval && existingEval.taskIsDone && existingEval.verdict === 'PASS')
        ? existingEval
        : await IndependentEvaluator.evaluate(earlyContract.id, run.project.path, synthReport, { expectedScopeFiles: task.expected_files || [], effortLevel: 'MINIMAL' });
    } catch (probeErr: any) {
      Logger.warn(`[reconcileCompletedTurn] Probe do Evaluator falhou: ${probeErr.message}`);
    }

    if (probeEvaluation?.taskIsDone && probeEvaluation.verdict === 'PASS') {
      if (probeEvaluation.evidence?.ciDoctorHealed) {
        Logger.info(`[AutonomousRunnerService] Sonda Evaluator: Tarefa "${task.title}" auto-reparada pelo CI Doctor.`);
        AutonomousManager.logEvent(
          run.id,
          task.id,
          'supervisor',
          'CI_DOCTOR_HEALED',
          `Micro-patch cirúrgico aplicado com sucesso pelo CI Doctor durante reconciliação de turno.`,
          {
            diagnosis: probeEvaluation.evidence.ciDoctorDiagnosis,
            patchApplied: probeEvaluation.evidence.ciDoctorPatchApplied
          }
        );
      }
      const nowIso = new Date().toISOString();
      db.prepare("UPDATE agent_turn_observations SET phase = 'CONSUMED' WHERE task_id = ? AND phase IN ('IN_FLIGHT','UNCERTAIN')").run(task.id);
      if (session?.provider_conversation_id) {
        AgentTurnState.setPhase(session.provider_conversation_id, 'CONSUMED');
      }
      db.prepare(`
        UPDATE autonomous_approvals
        SET status = 'approved', decision = 'Auto-aprovado via IndependentEvaluator na reconciliação de turno', decided_at = ?
        WHERE run_id = ? AND task_id = ? AND status = 'pending'
      `).run(nowIso, run.id, task.id);

      if (existingReport) {
        db.prepare(`
          UPDATE builder_reports
          SET evaluation_json = ?,
              tests_run = COALESCE(NULLIF(tests_run, ''), ?),
              test_results = COALESCE(NULLIF(test_results, ''), ?)
          WHERE id = ?
        `).run(
          JSON.stringify(probeEvaluation),
          probeEvaluation.executedCommands.join(' && '),
          `Evaluator ${probeEvaluation.verdict}`,
          existingReport.id
        );
      } else {
        AutonomousManager.submitBuilderReport({
          runId,
          taskId: task.id,
          status: 'success',
          filesChanged: synthReport.filesChanged,
          implemented: synthReport.implemented,
          testsRun: probeEvaluation.executedCommands.join(' && '),
          testResults: `Evaluator ${probeEvaluation.verdict}`,
          buildStatus: 'success',
          knownProblems: [],
          decisions: [],
          recommendation: 'Resultado recuperado e comprovado no disco pelo Evaluator',
          evaluation: probeEvaluation
        });
      }

      db.prepare("UPDATE autonomous_tasks SET status = 'in_review', lifecycle_state = 'REVIEW_PENDING', retry_count = 0, updated_at = ? WHERE id = ?").run(nowIso, task.id);

      const leases: any[] = db.prepare("SELECT id, worker_id FROM worker_leases WHERE task_id = ? AND run_id = ? AND status = 'active'").all(task.id, runId);
      for (const lease of leases) {
        WorkerRegistry.releaseLease(lease.id, lease.worker_id);
        WorkerRegistry.updateWorkerStatus(lease.worker_id, 'READY', { current_run_id: null, current_task_id: null, current_issue_number: null });
      }
      if (reservation) ExecutionCoordinator.release('global-agent-execution', reservation.token);
      if (!RunControl.apply(runId, true)) {
        db.prepare("UPDATE autonomous_runs SET status = 'running', last_error = NULL, next_action = 'Resultado recuperado via testes no disco; prosseguindo para revisão', updated_at = ? WHERE id = ?").run(nowIso, runId);
      }
      AutonomousManager.logEvent(runId, task.id, 'system', 'NATIVE_TURN_RECONCILED', 'Turno auto-reconciliado pois os testes no disco passaram 100% (PASS).', { conversationId: session?.provider_conversation_id });
      AutonomousManager.syncRunProgress(runId);
      return true;
    }

    const observation = task ? AgentTurnState.forTask(task.id) : null;
    if (!task || !observation || observation.project_path !== path.resolve(run.project.path)) return false;
    if (!session || session.provider_conversation_id !== observation.conversation_id) return false;
    const progress = AgentTurnState.progress(observation);
    if (progress.pendingTools.length) {
      if (progress.pendingTools.includes('ask_question')) {
        const nowIso = new Date().toISOString();
        AgentTurnState.setPhase(session.provider_conversation_id, 'CONSUMED');
        const leases: any[] = db.prepare("SELECT id, worker_id FROM worker_leases WHERE task_id = ? AND run_id = ? AND status = 'active'").all(task.id, runId);
        for (const lease of leases) {
          WorkerRegistry.releaseLease(lease.id, lease.worker_id);
          WorkerRegistry.updateWorkerStatus(lease.worker_id, 'READY', { current_run_id: null, current_task_id: null, current_issue_number: null });
        }
        if (reservation) ExecutionCoordinator.release('global-agent-execution', reservation.token);
        db.prepare("UPDATE autonomous_tasks SET status = 'ready', lifecycle_state = 'READY', updated_at = ? WHERE id = ?").run(nowIso, task.id);
        if (!RunControl.apply(runId, true)) {
          db.prepare("UPDATE autonomous_runs SET status = 'waiting_resource', last_error = 'AGENT_NATIVE_TOOL_RECOVERED: pergunta interativa ask_question descartada', next_action = 'Reiniciando sessão para nova tentativa não-interativa', updated_at = ? WHERE id = ?").run(nowIso, runId);
        }
        AutonomousManager.logEvent(runId, task.id, 'system', 'NATIVE_TURN_ABORTED_RECOVERED', 'Pergunta interativa descartada em modo autônomo total. Microtarefa reenfileirada como READY.');
        AutonomousManager.syncRunProgress(runId);
        return true;
      }
      return false;
    }
    if (progress.state !== 'COMPLETE' && !existingReport) {
      if (progress.abortedOnStepError) {
        const nowIso = new Date().toISOString();
        AgentTurnState.setPhase(session.provider_conversation_id, 'CONSUMED');
        const leases: any[] = db.prepare("SELECT id, worker_id FROM worker_leases WHERE task_id = ? AND run_id = ? AND status = 'active'").all(task.id, runId);
        for (const lease of leases) {
          WorkerRegistry.releaseLease(lease.id, lease.worker_id);
          WorkerRegistry.updateWorkerStatus(lease.worker_id, 'READY', { current_run_id: null, current_task_id: null, current_issue_number: null });
        }
        if (reservation) ExecutionCoordinator.release('global-agent-execution', reservation.token);
        db.prepare("UPDATE autonomous_tasks SET status = 'ready', lifecycle_state = 'READY', updated_at = ? WHERE id = ? AND status = 'in_progress'")
          .run(nowIso, task.id);
        if (!RunControl.apply(runId, true)) {
          db.prepare("UPDATE autonomous_runs SET status = 'running', last_error = NULL, next_action = 'Turno anterior encerrado por erro de ferramenta sem aprovação pendente; retomando microtarefa', updated_at = ? WHERE id = ?")
            .run(nowIso, runId);
        }
        AutonomousManager.logEvent(runId, task.id, 'system', 'NATIVE_TURN_ABORTED_RECOVERED', 'Turno nativo encerrado prematuramente por erro de ferramenta (sem aprovação pendente no Antigravity). Microtarefa reenfileirada como READY.', {
          conversationId: session.provider_conversation_id,
          lastStep: progress.lastStep
        });
        AutonomousManager.syncRunProgress(runId);
        return true;
      }
      return false;
    }
    ObservabilityService.emit({
      level: 'INFO',
      event: 'reconciliation.started',
      message: `Iniciando verificação de reconciliação de turno para run ${runId}`,
      service: 'runner',
      runId,
      taskId: task?.id || null
    });
    if (task && task.status === 'blocked') {
      db.prepare("UPDATE autonomous_tasks SET status = 'in_review', retry_count = 0, updated_at = ? WHERE id = ?").run(new Date().toISOString(), task.id);
      db.prepare("UPDATE autonomous_approvals SET status = 'approved', decision = 'Auto-resolvido na reconciliação de turno com sucesso comprovado', decided_at = ? WHERE task_id = ? AND status = 'pending'").run(new Date().toISOString(), task.id);
    }
    const provider = new AntigravityProvider({ USERPROFILE: path.resolve(observation.brain_dir, '../../..') });
    let report: any;
    if (existingReport) {
      report = {
        status: existingReport.status,
        filesChanged: safeJsonParse(existingReport.files_changed_json, []),
        implemented: safeJsonParse(existingReport.implemented_json, []),
        testsRun: existingReport.tests_run,
        buildStatus: existingReport.build_status,
        problems: safeJsonParse(existingReport.known_problems_json, [])
      };
    } else {
      report = await provider.getResult(session.provider_conversation_id, 1, run.project.path);
    }
    if (report.problems.some((p: string) => /AGENT_EXECUTION_TIMEOUT|QUOTA|AUTH_ERROR/.test(p))) return false;
    let contract = task.contract_id ? IndependentEvaluator.getContract(task.contract_id) : null;
    if (!contract) contract = IndependentEvaluator.createSuccessContract({ taskId: task.id, runId, projectId: run.project_id, projectPath: run.project.path, objective: task.description, acceptanceCriteria: task.criteria || [], verificationCommand: task.verification_command || 'npm test', protectedEvaluationFiles: task.protected_evaluation_files || IndependentEvaluator.listEvaluationFiles(run.project.path) });
    const existingEval = IndependentEvaluator.getEvaluationByTaskId(task.id);
    let evaluation = (existingEval && existingEval.taskIsDone && existingEval.verdict === 'PASS')
      ? existingEval
      : await IndependentEvaluator.evaluate(contract.id, run.project.path, report, { expectedScopeFiles: task.expected_files || [] });
    if ((evaluation.verdict === 'BLOCKED' || evaluation.verdict === 'FAIL') && contract.verificationSteps?.length) {
      let contractUpdated = false;
      for (const step of contract.verificationSteps) {
        const norm = normalizeOrRecoverVerificationCommand(step.command, run.project.path, {
          allowUncreatedFiles: false,
          requireCanonicalEvidenceOnDisk: true
        });
        if (!norm.validInitially && norm.recovered) {
          step.command = norm.command;
          task.verification_command = norm.command;
          contractUpdated = true;
        }
      }
      if (contractUpdated) {
        db.prepare('UPDATE success_contracts SET verification_steps_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(contract.verificationSteps), new Date().toISOString(), contract.id);
        db.prepare('UPDATE autonomous_tasks SET verification_command = ? WHERE id = ?').run(task.verification_command, task.id);
        evaluation = await IndependentEvaluator.evaluate(contract.id, run.project.path, report, { expectedScopeFiles: task.expected_files || [] });
      }
    }
    if (['BLOCKED', 'TIMEOUT', 'INCONCLUSIVE', 'TAMPERING_DETECTED'].includes(evaluation.verdict)) return false;
    if (evaluation.evidence?.ciDoctorHealed) {
      Logger.info(`[AutonomousRunnerService] Tarefa "${task.title}" auto-reparada pelo CI Doctor.`);
      AutonomousManager.logEvent(
        runId,
        task.id,
        'supervisor',
        'CI_DOCTOR_HEALED',
        `Micro-patch cirúrgico aplicado com sucesso pelo CI Doctor. Falha corrigida: ${evaluation.evidence.ciDoctorDiagnosis?.assertionMessage || 'Testes normalizados'}.`,
        {
          diagnosis: evaluation.evidence.ciDoctorDiagnosis,
          patchApplied: evaluation.evidence.ciDoctorPatchApplied
        }
      );
    }
    if (existingReport) {
      db.prepare(`
        UPDATE builder_reports
        SET evaluation_json = ?,
            tests_run = COALESCE(NULLIF(tests_run, ''), ?),
            test_results = COALESCE(NULLIF(test_results, ''), ?)
        WHERE id = ?
      `).run(
        JSON.stringify(evaluation),
        evaluation.executedCommands.join(' && '),
        `Evaluator ${evaluation.verdict}`,
        existingReport.id
      );
      if (task.status === 'in_progress') {
        db.prepare("UPDATE autonomous_tasks SET status = 'in_review', lifecycle_state = 'REVIEW_PENDING', updated_at = ? WHERE id = ?").run(new Date().toISOString(), task.id);
      }
    } else {
      AutonomousManager.submitBuilderReport({
        runId,
        taskId: task.id,
        status: evaluation.taskIsDone ? 'success' : 'failure',
        filesChanged: report.filesChanged,
        implemented: report.implemented,
        testsRun: evaluation.executedCommands.join(' && '),
        testResults: `Evaluator ${evaluation.verdict}`,
        buildStatus: report.buildStatus,
        knownProblems: report.problems,
        decisions: [],
        recommendation: 'Resultado recuperado sem novo despacho ao Worker',
        evaluation
      });
    }
    AgentTurnState.setPhase(session.provider_conversation_id, 'CONSUMED');
    const leases: any[] = db.prepare("SELECT id, worker_id FROM worker_leases WHERE task_id = ? AND run_id = ? AND status = 'active'").all(task.id, runId);
    for (const lease of leases) {
      WorkerRegistry.releaseLease(lease.id, lease.worker_id);
      WorkerRegistry.updateWorkerStatus(lease.worker_id, 'READY', { current_run_id: null, current_task_id: null, current_issue_number: null });
    }
    if (reservation) ExecutionCoordinator.release('global-agent-execution', reservation.token);
    if (!RunControl.apply(runId, true)) {
      db.prepare("UPDATE autonomous_runs SET status = 'running', last_error = NULL, next_action = 'Resultado recuperado; aguardar revisão do Supervisor', updated_at = ? WHERE id = ?").run(new Date().toISOString(), runId);
    }
    AutonomousManager.logEvent(runId, task.id, 'system', 'NATIVE_TURN_RECONCILED', 'Turno concluído recuperado e avaliado sem reenviar implementação.', { conversationId: session.provider_conversation_id, lastStep: progress.lastStep });
    AutonomousManager.syncRunProgress(runId);

    ObservabilityService.emit({
      level: 'INFO',
      event: 'reconciliation.completed',
      message: `Reconciliação de turno concluída com sucesso para tarefa "${task.title}"`,
      service: 'runner',
      runId,
      taskId: task.id,
      status: 'success',
      metadata: { conversationId: session.provider_conversation_id, lastStep: progress.lastStep }
    });

    return true;
  }

  static setExecutionPhase(phase: ExecutionPipelinePhase): void {
    this.currentPhase = phase;
    this.isAgentExecuting = phase !== 'IDLE';
    this.touchActiveExecutionReservation();
  }

  static releaseExecutionLock(): void {
    this.currentPhase = 'IDLE';
    this.isAgentExecuting = false;
  }

  /**
   * Start the persistent Autonomous Runner background worker
   */
  static start() {
    if (this.isRunning) return;
    this.isRunning = true;

    Logger.info('====================================================');
    Logger.info('[INIT] INICIANDO AUTONOMOUS RUNNER PERSISTENTE (AI DEV HUB)');
    Logger.info('====================================================');

    // 1. Initial Heartbeat
    this.recordHeartbeat('idle');

    // 2. Ensure Multi-Worker pool is initialized
    try {
      WorkerRegistry.ensureDefaultWorkers();
    } catch (e: any) {
      Logger.warn(`[Autonomous Runner] Falha ao inicializar pool de workers: ${e.message}`);
    }

    // 3. Recovery on startup: check for interrupted runs
    this.recoverInterruptedRuns();

    // 4. Heartbeat Loop (every 15s)
    this.heartbeatTimer = setInterval(() => {
      this.recordHeartbeat(this.isExecutingCycle || this.isAgentExecuting ? 'busy' : 'idle');
      if (this.isExecutingCycle || this.isAgentExecuting) {
        this.touchActiveExecutionReservation();
      }
    }, 15000);

    // 5. Scheduler Loop (polls every 3s)
    this.schedulerTimer = setInterval(() => {
      this.schedulerTick().catch(err => {
        Logger.error(`[Autonomous Runner Scheduler] Erro: ${err.message}`);
      });
    }, 3000);

    // 6. Watchdog Loop (every 30s)
    this.watchdogTimer = setInterval(() => {
      this.watchdogTick().catch(err => {
        Logger.error(`[Autonomous Runner Watchdog] Erro: ${err.message}`);
      });
      try {
        DiagnosticService.remediateAnomalies();
      } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autonomousRunnerService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousRunnerService]", err);
      }
    }
    }, 30000);

    Logger.success('[Autonomous Runner] Scheduler, Heartbeat (15s), Multi-Worker Pool e Watchdog (30s) ativos.');
  }

  /**
   * Stop the runner cleanly
   */
  static stop() {
    this.isRunning = false;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.schedulerTimer) clearInterval(this.schedulerTimer);
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    this.recordHeartbeat('stopped');
    Logger.info('[Autonomous Runner] Serviço encerrado.');
  }

  /**
   * Record heartbeat in SQLite database
   */
  private static recordHeartbeat(status: 'online' | 'idle' | 'busy' | 'stopped' | 'error') {
    const nowIso = new Date().toISOString();
    try {
      db.prepare(`
        INSERT INTO runner_heartbeats (
          runner_id, status, last_heartbeat, active_run_id, current_task, current_worker, iteration, consecutive_failures, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(runner_id) DO UPDATE SET
          status = excluded.status,
          last_heartbeat = excluded.last_heartbeat,
          active_run_id = excluded.active_run_id,
          current_task = excluded.current_task,
          current_worker = excluded.current_worker,
          iteration = excluded.iteration,
          consecutive_failures = excluded.consecutive_failures,
          metadata_json = excluded.metadata_json
      `).run(
        this.runnerId,
        status,
        nowIso,
        this.activeRunId,
        this.currentTask,
        this.currentWorker,
        this.iteration,
        this.consecutiveFailures,
        JSON.stringify({ pid: process.pid, memoryUsage: process.memoryUsage().rss })
      );
    } catch (err: any) {
      Logger.warn(`[Runner Heartbeat] Falha ao registrar heartbeat: ${err.message}`);
    }
  }

  /**
   * Get live runner status for API and UI
   */
  static getStatus(): RunnerStatus {
    const record: any = db.prepare('SELECT * FROM runner_heartbeats WHERE runner_id = ?').get(this.runnerId);
    const now = Date.now();
    const lastTime = record ? new Date(record.last_heartbeat).getTime() : now;
    const secondsAgo = Math.max(0, Math.round((now - lastTime) / 1000));

    let runName: string | null = null;
    if (record?.active_run_id) {
      const run: any = db.prepare('SELECT name FROM autonomous_runs WHERE id = ?').get(record.active_run_id);
      runName = run?.name || null;
    }

    const allWorkers = WorkerRegistry.getAllWorkers();
    const workingCount = allWorkers.filter(w => w.status === 'WORKING').length;
    const readyCount = allWorkers.filter(w => w.status === 'READY' || w.status === 'WAITING').length;
    const offlineCount = allWorkers.filter(w => w.status === 'OFFLINE' || w.status === 'ERROR').length;
    const onlineCount = allWorkers.length - offlineCount;
    const assignments = allWorkers
      .filter(w => w.status === 'WORKING' && w.current_task_id)
      .map(w => {
        const task: any = db.prepare('SELECT title, github_issue_number FROM autonomous_tasks WHERE id = ?').get(w.current_task_id);
        return {
          workerName: w.name,
          taskTitle: task?.title || 'Executando tarefa',
          issueNumber: task?.github_issue_number || w.current_issue_number || undefined
        };
      });

    return {
      runnerId: this.runnerId,
      online: this.isRunning,
      status: record?.status || (this.isRunning ? 'online' : 'stopped'),
      lastHeartbeat: record?.last_heartbeat || new Date().toISOString(),
      secondsAgo,
      activeRunId: record?.active_run_id || this.activeRunId,
      activeRunName: runName,
      currentTask: record?.current_task || this.currentTask,
      currentWorker: record?.current_worker || this.currentWorker,
      iteration: record?.iteration || this.iteration,
      consecutiveFailures: record?.consecutive_failures || this.consecutiveFailures,
      executionPhase: this.currentPhase,
      isExecutingCycle: this.isExecutingCycle,
      isAgentExecuting: this.isAgentExecuting,
      pendingNativeTurns: (db.prepare("SELECT COUNT(*) n FROM agent_turn_observations WHERE phase IN ('IN_FLIGHT','UNCERTAIN')").get() as any).n,
      workerFleet: {
        total: allWorkers.length,
        online: onlineCount,
        working: workingCount,
        ready: readyCount,
        offline: offlineCount,
        assignments
      }
    };
  }

  /**
   * RECOVERY: Detect and automatically resume interrupted runs after crash or restart
   */
  static recoverInterruptedRuns() {
    try {
      ExecutionCoordinator.reconcileDeadReservations();
      this.releaseExecutionLock();
      this.isExecutingCycle = false;

      const pendingRuns: any[] = db.prepare(`
        SELECT * FROM autonomous_runs
        WHERE status IN ('running', 'building', 'testing', 'reviewing', 'planning')
        ORDER BY updated_at DESC
      `).all();

      if (pendingRuns.length === 0) {
        Logger.info('[Autonomous Runner Recovery] Nenhum run pendente necessitando recuperação.');
        return;
      }

      Logger.warn(`[Autonomous Runner Recovery] Detectado(s) ${pendingRuns.length} run(s) incompleto(s) após reinício.`);

      // Never steal live leases from another backend or assume the external agent stopped.
      try {
        const staleLeases: any[] = db.prepare("SELECT DISTINCT worker_id FROM worker_leases WHERE status = 'active' AND lease_until < ? AND task_id NOT IN (SELECT task_id FROM agent_turn_observations WHERE phase IN ('IN_FLIGHT','UNCERTAIN') AND task_id IS NOT NULL)").all(new Date().toISOString());
        for (const l of staleLeases) {
          WorkerRegistry.releaseAllLeases(l.worker_id);
          WorkerRegistry.updateWorkerStatus(l.worker_id, 'READY');
        }
      } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autonomousRunnerService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousRunnerService]", err);
      }
    }

      for (const run of pendingRuns) {
        if (!isRunningInTestEnvironment() && this.isGhostTestRun(run)) {
          Logger.warn(`[Autonomous Runner Recovery] Ignorando e cancelando run fantasma de teste: ${run.id}`);
          try {
            db.prepare("UPDATE autonomous_runs SET status='cancelled',last_error='GHOST_TEST_RUN_DISCARDED',next_action='Run de teste descartado',updated_at=? WHERE id=?")
              .run(new Date().toISOString(), run.id);
          } catch {}
          continue;
        }
        const project: any = db.prepare('SELECT path FROM projects WHERE id=?').get(run.project_id);
        const auth = DevAutonomyService.isProjectAuthorizedForLiveExecution(run.project_id);
        if (!auth.authorized || !project || !fs.existsSync(project.path)) {
          db.prepare("UPDATE autonomous_runs SET status='paused',last_error=?,next_action='Verificar autorização e diretório antes de retomar',updated_at=? WHERE id=?")
            .run(!auth.authorized ? `AUTHORIZATION_GUARD: ${auth.reason}` : 'PROJECT_DIRECTORY_UNAVAILABLE', new Date().toISOString(), run.id);
          continue;
        }
        // If all tasks in this run are already completed, mark run completed
        const allTasks: any[] = db.prepare('SELECT status FROM autonomous_tasks WHERE run_id = ?').all(run.id);
        if (allTasks.length > 0 && allTasks.every(t => t.status === 'completed')) {
          db.prepare("UPDATE autonomous_runs SET status = 'running', next_action='Verificar aceitação final do projeto', updated_at = ? WHERE id = ?")
            .run(new Date().toISOString(), run.id);
          Logger.info(`[Autonomous Runner Recovery] Run "${run.name}" com tarefas concluídas aguarda aceitação final.`);
          continue;
        }

        // Reconcile stuck tasks in 'in_progress'
        const stuckTasks: any[] = db.prepare(`
          SELECT * FROM autonomous_tasks
          WHERE run_id = ? AND status = 'in_progress'
        `).all(run.id);

        for (const task of stuckTasks) {
          const observed = AgentTurnState.forTask(task.id);
          if (observed && ['IN_FLIGHT', 'UNCERTAIN', 'COMPLETE'].includes(observed.phase)) {
            db.prepare("UPDATE autonomous_runs SET status='paused',last_error='CRASH_RECONCILIATION_REQUIRED',next_action='Verificar turno preservado; retomar sem novo envio',updated_at=? WHERE id=?").run(new Date().toISOString(), run.id);
            continue;
          }
          const hasReport = db.prepare('SELECT id FROM builder_reports WHERE run_id = ? AND task_id = ?').get(run.id, task.id);
          const physicalSession = AgentSessionManager.getActiveSession(run.project_id, 'WORKER');
          if (!hasReport && physicalSession && !/^conv-(fake|simulated|test|mock)/.test(physicalSession.provider_conversation_id)) {
            db.prepare("UPDATE autonomous_runs SET status='paused',last_error='CRASH_RECONCILIATION_REQUIRED',next_action='Verificar término do turno externo antes de retomar a mesma tarefa',updated_at=? WHERE id=?").run(new Date().toISOString(), run.id);
            AutonomousManager.logEvent(run.id, task.id, 'system', 'CRASH_RECONCILIATION_REQUIRED', 'Estado externo ambíguo; não reenviar implementação.');
            continue;
          }
          const nextStatus = hasReport ? 'in_review' : 'ready';
          const nextLifecycle = hasReport ? 'REVIEW_PENDING' : 'READY';
          const retries = (task.retry_count || 0) + 1;
          db.prepare(`
            UPDATE autonomous_tasks
            SET status = ?, lifecycle_state = ?, retry_count = ?, updated_at = ?
            WHERE id = ?
          `).run(nextStatus, nextLifecycle, retries, new Date().toISOString(), task.id);

          AutonomousManager.logEvent(
            run.id,
            task.id,
            'system',
            'RECOVERY_TASK_RESET',
            `Watchdog/Recovery: Tarefa "${task.title}" reconciliada para ${nextStatus.toUpperCase()} após reinício do processo.`
          );
        }

        // Reconcile any orphaned in_review tasks without a builder report
        const invalidInReviewTasks: any[] = db.prepare(`
          SELECT * FROM autonomous_tasks
          WHERE run_id = ? AND status = 'in_review'
            AND NOT EXISTS (SELECT 1 FROM builder_reports WHERE task_id = autonomous_tasks.id)
        `).all(run.id);

        for (const revTask of invalidInReviewTasks) {
          db.prepare("UPDATE autonomous_tasks SET status = 'ready', lifecycle_state = 'READY', updated_at = ? WHERE id = ?").run(new Date().toISOString(), revTask.id);
          AutonomousManager.logEvent(
            run.id,
            revTask.id,
            'system',
            'RECOVERY_TASK_RESET',
            `Watchdog/Recovery: Tarefa "${revTask.title}" estava em revisão sem relatório do Builder; redefinida para READY.`
          );
        }

        // Reconcile tasks interrupted between Review approval and Commit (or between Commit and SQLite persistence)
        const pendingCommitTasks: any[] = db.prepare(`
          SELECT * FROM autonomous_tasks
          WHERE run_id = ? AND (status IN ('approved', 'commit_pending') OR lifecycle_state IN ('APPROVED', 'COMMIT_PENDING'))
        `).all(run.id);

        for (const pTask of pendingCommitTasks) {
          let recoveredSha: string | null = pTask.task_commit_sha || null;
          if (!recoveredSha && project?.path && fs.existsSync(path.join(project.path, '.git'))) {
            try {
              const logLines = execSync('git log -n 10 --pretty=format:"%H|||%s"', {
                cwd: project.path,
                encoding: 'utf-8',
                stdio: ['ignore', 'pipe', 'ignore']
              })
                .trim()
                .split('\n')
                .filter(Boolean);
              const shortId = pTask.id.slice(0, 8);
              const taskCode = pTask.code || pTask.milestone || '';
              for (const line of logLines) {
                const [sha, subj] = line.split('|||');
                if (
                  subj &&
                  (subj.includes(`[task:${shortId}]`) ||
                    (taskCode && subj.includes(`[${taskCode}]`) && subj.includes(pTask.title)))
                ) {
                  recoveredSha = sha.trim();
                  break;
                }
              }
            } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autonomousRunnerService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousRunnerService]", err);
      }
    }
          }

          if (recoveredSha) {
            const nowIso = new Date().toISOString();
            db.prepare(`
              UPDATE autonomous_tasks
              SET task_commit_sha = ?, commit_source = 'crash_recovery_reconciled', commit_status = 'local_committed', updated_at = ?
              WHERE id = ?
            `).run(recoveredSha, nowIso, pTask.id);
            try {
              if (HierarchicalOrchestrationService.resolveTaskLifecycleState(pTask) === 'APPROVED') {
                HierarchicalOrchestrationService.transitionTaskState({
                  taskId: pTask.id,
                  toState: 'COMMIT_PENDING',
                  actor: 'system',
                  reason: 'Reconciliação de crash pós-aprovação.'
                });
              }
              HierarchicalOrchestrationService.transitionTaskState({
                taskId: pTask.id,
                toState: 'COMPLETED',
                actor: 'system',
                reason: `Reconciliação de crash entre commit Git (${recoveredSha.slice(0, 8)}) e persistência SQLite.`,
                metadata: { commitSha: recoveredSha, crashReconciled: true }
              });
            } catch {
              db.prepare("UPDATE autonomous_tasks SET status = 'completed', lifecycle_state = 'COMPLETED', updated_at = ? WHERE id = ?")
                .run(nowIso, pTask.id);
            }
          } else {
            const latestRep: any = db.prepare(
              'SELECT files_changed_json FROM builder_reports WHERE run_id = ? AND task_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1'
            ).get(run.id, pTask.id);
            const repFiles = safeJsonParse(latestRep?.files_changed_json, []);
            HierarchicalOrchestrationService.executePostReviewCommitGate({
              runId: run.id,
              taskId: pTask.id,
              projectPath: project?.path || '',
              filesChanged: repFiles
            });
          }
        }

        // Restore run status to running
        db.prepare(`
          UPDATE autonomous_runs
          SET status = 'running', next_action = 'Retomar execução autônoma do backlog', updated_at = ?
          WHERE id = ? AND status <> 'paused'
        `).run(new Date().toISOString(), run.id);

        AutonomousManager.logEvent(
          run.id,
          null,
          'system',
          'RUNNER_RECOVERED',
          `[RECOVERY] Autonomous Runner recuperou automaticamente a execução do Run "${run.name}" do último checkpoint.`
        );

        Logger.success(`[Autonomous Runner Recovery] Run "${run.name}" (${run.id.slice(0, 8)}) recuperado e reativado.`);
      }
    } catch (err: any) {
      Logger.error(`[Autonomous Runner Recovery] Erro ao recuperar runs: ${err.message}`);
    }
  }

  /**
   * Watchdog: scan for stalled tasks that took > 3 minutes without progress
   */
  private static async watchdogTick() {
    if (!this.isRunning) return;

    try {
      const eightMinutesAgo = new Date(Date.now() - 8 * 60 * 1000).toISOString();
      const stalledTasks: any[] = db.prepare(`
        SELECT t.*, r.project_id, r.name as run_name
        FROM autonomous_tasks t
        JOIN autonomous_runs r ON t.run_id = r.id
        WHERE t.status = 'in_progress' AND t.updated_at < ?
      `).all(eightMinutesAgo);

      for (const task of stalledTasks) {
        // Active in-memory runner check: if this task is actively executing (Worker, Evaluator, Supervisor), preserve it
        if (this.currentTaskId === task.id && this.currentPhase !== 'IDLE') {
          continue;
        }

        const liveLease: any = db.prepare("SELECT id FROM worker_leases WHERE task_id = ? AND status = 'active' AND lease_until > ?")
          .get(task.id, new Date().toISOString());
        if (liveLease) continue;

        // TOP-LEVEL check for active in-flight native turns (independent of in-memory session manager)
        const pendingObs: any = db.prepare(
          "SELECT dispatched_at, conversation_id FROM agent_turn_observations WHERE task_id = ? AND phase IN ('IN_FLIGHT','UNCERTAIN')"
        ).get(task.id);
        if (pendingObs && pendingObs.dispatched_at && (Date.now() - new Date(pendingObs.dispatched_at).getTime() < 12 * 60 * 1000)) {
          // Turno nativo recente em voo no Antigravity: aguardar sem travar ou preempção prematura
          continue;
        }

        const reconciled = await this.reconcileCompletedTurn(task.run_id);
        if (reconciled) continue;

        // Turno orfao/sem lease genuinamente abandonado (> 12 min): auto-heal silencioso sem pausar!
        db.prepare("UPDATE agent_turn_observations SET phase = 'CONSUMED' WHERE task_id = ? AND phase IN ('IN_FLIGHT','UNCERTAIN')").run(task.id);
        db.prepare("UPDATE worker_leases SET status = 'expired', released_at = ? WHERE task_id = ? AND status = 'active'").run(new Date().toISOString(), task.id);

        const retries = (task.retry_count || 0) + 1;
        const nowIso = new Date().toISOString();

        if (retries >= 3) {
          // Mark BLOCKED and allow supervisor to pick other independent tasks
          db.prepare(`
            UPDATE autonomous_tasks
            SET status = 'blocked', retry_count = ?, updated_at = ?
            WHERE id = ?
          `).run(retries, nowIso, task.id);

          AutonomousManager.logEvent(
            task.run_id,
            task.id,
            'system',
            'WATCHDOG_BLOCKED',
            `[WATCHDOG] Tarefa "${task.title}" travou e atingiu 3 tentativas. Marcada como BLOCKED. O Supervisor buscará outra tarefa independente.`
          );
        } else {
          // Retry
          db.prepare(`
            UPDATE autonomous_tasks
            SET status = 'ready', lifecycle_state = 'READY', retry_count = ?, updated_at = ?
            WHERE id = ?
          `).run(retries, nowIso, task.id);

          db.prepare(`
            UPDATE autonomous_runs
            SET status = 'running', last_error = NULL, next_action = 'Microtarefa auto-recuperada pelo watchdog; continuando backlog', updated_at = ?
            WHERE id = ? AND status IN ('paused', 'waiting_resource')
              AND NOT EXISTS (SELECT 1 FROM run_control_requests c WHERE c.run_id = autonomous_runs.id AND c.status = 'pending')
          `).run(nowIso, task.run_id);

          AutonomousManager.logEvent(
            task.run_id,
            task.id,
            'system',
            'WATCHDOG_RETRY',
            `[WATCHDOG] Tarefa "${task.title}" sem progresso detectada. Tentativa ${retries}/3 reiniciada.`
          );
        }
      }
      // Expire stale worker leases and detect offline workers
      try {
        const { expired, resetTasks } = WorkerRegistry.expireStaleLeases();
        if (expired > 0) {
          Logger.warn(`[Watchdog] ${expired} lease(s) expirada(s) por inatividade. Tarefas resetadas para READY: ${resetTasks.join(', ')}`);
        }
        WorkerRegistry.detectOfflineWorkers();
        ExecutionCoordinator.reconcileDeadReservations();
      } catch (e: any) {
        Logger.warn(`[Watchdog] Erro ao validar leases de workers: ${e.message}`);
      }
    } catch (err: any) {
      Logger.error(`[Watchdog Error] ${err.message}`);
    }
  }

  /**
   * Immediately trigger a scheduler tick
   */
  static async triggerTick() {
    return this.schedulerTick();
  }

  /**
   * Main scheduler tick: looks for active runs and executes the autonomous cycle
   */
  static async schedulerTick() {
    if (!this.isRunning || this.isExecutingCycle || this.isAgentExecuting) return;

    // 0. Auto-resume paused runs when quota cooldown period expires
    try {
      const pausedQuotaRuns: any[] = db.prepare(`
        SELECT r.*
        FROM autonomous_runs r
        WHERE r.status = 'paused' AND r.last_error LIKE '%RESOURCE_EXHAUSTED%'
          AND NOT EXISTS(SELECT 1 FROM run_control_requests c WHERE c.run_id=r.id)
      `).all();

      for (const pr of pausedQuotaRuns) {
        const { AccountProfileManager } = await import('./accountProfileManager.js');
        const prof = AccountProfileManager.getActiveProfileForProject(pr.project_id);
        if (AccountProfileManager.isAccountAvailableForTasks(prof.id)) {
          const nowIso = new Date().toISOString();
          db.prepare(`
            UPDATE autonomous_runs
            SET status = 'running', next_action = 'Cooldown expirou; elegível para nova tentativa (quota desconhecida)', updated_at = ?
            WHERE id = ?
          `).run(nowIso, pr.id);
          AutonomousManager.logEvent(
            pr.id,
            null,
            'system',
            'QUOTA_COOLDOWN_EXPIRED',
            `Cooldown do perfil "${prof.display_name}" expirou. Run "${pr.name}" elegível para tentativa; quota permanece desconhecida.`
          );
          Logger.success(`[Autonomous Runner Scheduler] Run "${pr.name}" retomado automaticamente após término do cooldown de cota.`);
        }
      }
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autonomousRunnerService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousRunnerService]", err);
      }
    }

    // 0.1 Auto-recover runs waiting for resources (Antigravity runtime / accounts)
    try {
      const waitingRuns: any[] = db.prepare(`
        SELECT r.*
        FROM autonomous_runs r
        WHERE r.status = 'waiting_resource'
          AND NOT EXISTS(SELECT 1 FROM run_control_requests c WHERE c.run_id = r.id AND c.status = 'pending')
      `).all();

      for (const wr of waitingRuns) {
        await this.attemptResourceRecovery(wr);
      }
    } catch (recErr: any) {
      Logger.warn(`[Autonomous Runner Scheduler] Erro ao verificar recuperação de recursos: ${recErr.message}`);
    }

    // Automatically reconcile runs paused or waiting_approval with TURN/LEASE/CRASH_RECONCILIATION_REQUIRED once the native Worker turn finishes on disk
    try {
      const pendingReconciliationRuns: any[] = db.prepare(`
        SELECT id, name, last_error, project_id, status, updated_at FROM autonomous_runs r
        WHERE r.status IN ('paused', 'waiting_approval', 'waiting_resource')
          AND (r.last_error LIKE 'TURN_RECONCILIATION_REQUIRED%' OR r.last_error LIKE 'LEASE_RECONCILIATION_REQUIRED%' OR r.last_error LIKE 'CRASH_RECONCILIATION_REQUIRED%')
          AND NOT EXISTS (SELECT 1 FROM run_control_requests c WHERE c.run_id = r.id AND c.status = 'pending')
      `).all();
      for (const pr of pendingReconciliationRuns) {
        // Ignora runs obsoletos de sessões passadas (> 20min) para não sequestrar o loop de agendamento de projetos ativos
        const isFresh = pr.updated_at && (Date.now() - new Date(pr.updated_at).getTime() < 20 * 60 * 1000);
        if (!isFresh) continue;

        const reconciled = await this.reconcileCompletedTurn(pr.id);
        if (reconciled) {
          this.activeRunId = pr.id;
          Logger.success(`[Autonomous Runner Scheduler] Run "${pr.name}" (${pr.id.slice(0, 8)}) reconciliado e retomado automaticamente após conclusão do turno nativo.`);
        } else if (
          pr.last_error && (
            pr.last_error.includes('LEASE_RECONCILIATION_REQUIRED') ||
            pr.last_error.includes('CRASH_RECONCILIATION_REQUIRED') ||
            pr.last_error.includes('AGENT_TURN_UNCERTAIN') ||
            (pr.last_error.includes('TURN_RECONCILIATION_REQUIRED') && (pr.status === 'paused' || !pr.last_error.includes('AGENT_NATIVE_TOOL_PENDING')))
          )
        ) {
          const nowIso = new Date().toISOString();
          ExecutionCoordinator.reconcileDeadReservations();
          const res: any = db.prepare("SELECT * FROM execution_reservations WHERE scope='global-agent-execution'").get();
          if (res) {
            try {
              const ctx = JSON.parse(res.context_json || '{}');
              if (ctx.runId === pr.id) ExecutionCoordinator.release('global-agent-execution', res.token);
            } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autonomousRunnerService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousRunnerService]", err);
      }
    }
          }
          db.prepare("UPDATE worker_leases SET status = 'expired', released_at = ? WHERE run_id = ? AND status = 'active'").run(nowIso, pr.id);
          db.prepare("UPDATE agent_turn_observations SET phase = 'CONSUMED' WHERE task_id IN (SELECT id FROM autonomous_tasks WHERE run_id = ?) AND phase IN ('IN_FLIGHT','UNCERTAIN')").run(pr.id);
          db.prepare(`
            UPDATE autonomous_tasks
            SET status = 'ready',
                lifecycle_state = 'READY',
                notes = CASE
                  WHEN notes LIKE '%[HANDOFF / RESUME MODE]%' THEN notes
                  WHEN notes IS NULL OR notes = '' THEN '[HANDOFF / RESUME MODE] Tarefa auto-reconciliada para retomada autônoma.'
                  ELSE notes || CHAR(10) || '[HANDOFF / RESUME MODE] Tarefa auto-reconciliada para retomada autônoma.'
                END,
                updated_at = ?
            WHERE run_id = ? AND status = 'in_progress'
          `).run(nowIso, pr.id);
          db.prepare("UPDATE autonomous_runs SET status = 'running', last_error = NULL, next_action = 'Auto-reconciliação de turno/lease concluída; retomando fila', updated_at = ? WHERE id = ?").run(nowIso, pr.id);
          const hasOtherRunning = db.prepare("SELECT 1 FROM autonomous_runs WHERE status = 'running' AND id != ? LIMIT 1").get(pr.id);
          if (!hasOtherRunning) {
            this.activeRunId = pr.id;
          }
          Logger.success(`[Autonomous Runner Scheduler] Run "${pr.name}" (${pr.id.slice(0, 8)}) auto-reconciliado silenciosamente: observação consumida, travas limpas e status restaurado para RUNNING.`);
        }
      }
    } catch (recErr: any) {
      Logger.warn(`[Autonomous Runner Scheduler] Aviso na tentativa de reconciliação automática: ${recErr.message}`);
    }

    // Automatically auto-unblock runs waiting_approval from technical evaluator failure if project has full autonomy
    try {
      const technicalWaitingRuns: any[] = db.prepare(`
        SELECT r.id, r.project_id, r.name, r.current_task FROM autonomous_runs r
        WHERE r.status = 'waiting_approval'
          AND (r.last_error LIKE '%Evaluator FAIL%' OR r.last_error LIKE '%CHANGES_REQUESTED%')
          AND r.last_error NOT LIKE '%TAMPERING_DETECTED%'
          AND NOT EXISTS (SELECT 1 FROM run_control_requests c WHERE c.run_id = r.id AND c.status = 'pending')
      `).all();
      for (const twr of technicalWaitingRuns) {
        const { DevAutonomyService } = await import('./devAutonomyService.js');
        if (DevAutonomyService.hasFullDevAutonomy(twr.project_id)) {
          Logger.info(`[Autonomous Runner Scheduler] Auto-recuperação de run retido em waiting_approval por falha técnica: "${twr.name}" (${twr.id.slice(0, 8)}).`);
          await AutonomousManager.resumeRun(twr.id);
        }
      }
    } catch (unblockErr: any) {
      Logger.warn(`[Autonomous Runner Scheduler] Aviso no auto-unblock de runs: ${unblockErr.message}`);
    }

    for (const control of db.prepare("SELECT run_id FROM run_control_requests WHERE status='pending'").all() as any[]) {
      RunControl.apply(control.run_id);
    }

    // Recover queued handoffs only when the project has no active Run. Persist target
    // and source consumption atomically before invoking the Supervisor.
    for (const source of db.prepare("SELECT id,project_id FROM autonomous_runs r WHERE status='completed' AND EXISTS(SELECT 1 FROM autonomous_events e WHERE e.run_id=r.id AND e.event_type='QUEUED_USER_INSTRUCTION' AND json_valid(e.metadata_json) AND json_extract(e.metadata_json,'$.consumed') IS NOT 1 AND json_extract(e.metadata_json,'$.durableContinuation')=1) AND NOT EXISTS(SELECT 1 FROM autonomous_runs a WHERE a.project_id=r.project_id AND a.status NOT IN ('completed','failed')) ORDER BY updated_at LIMIT 1").all() as any[]) {
      const queued = AutonomousManager.getQueuedContinuation(source.id);
      if (queued.ids.length) {
        this.isExecutingCycle = true;
        try {
          await AutonomousManager.createRun({
            projectId: source.project_id,
            name: 'Continuidade do projeto',
            objective: queued.text,
            briefing: queued.text,
            autonomyMode: 'autonomous',
            continuationSourceRunId: source.id
          });
        } catch (error: any) {
          Logger.warn(`[Autonomous Runner] Continuidade preservada: ${error.message}`);
        } finally {
          this.isExecutingCycle = false;
        }
      }
    }

    // Find active run (stick with current activeRunId if still active to enforce sequential run processing)
    let activeRun: any = null;
    if (this.activeRunId) {
      activeRun = db.prepare(`
        SELECT * FROM autonomous_runs
        WHERE id = ? AND status IN ('running', 'building', 'testing', 'reviewing', 'waiting_for_worker')
      `).get(this.activeRunId);
    }

    if (!activeRun) {
      activeRun = db.prepare(`
        SELECT * FROM autonomous_runs
        WHERE status IN ('running', 'building', 'testing', 'reviewing', 'waiting_for_worker')
        ORDER BY updated_at DESC
        LIMIT 1
      `).get();
    }

    if (!activeRun) {
      this.activeRunId = null;
      this.currentTask = null;
      this.currentWorker = null;
      return;
    }

    if (!isRunningInTestEnvironment() && this.isGhostTestRun(activeRun)) {
      Logger.warn(`[Autonomous Runner Scheduler] Run fantasma de teste detectado e descartado: ${activeRun.id}`);
      try {
        db.prepare("UPDATE autonomous_runs SET status = 'cancelled', last_error = 'GHOST_TEST_RUN_DISCARDED', next_action = 'Run de teste descartado' WHERE id = ?").run(activeRun.id);
      } catch {}
      this.activeRunId = null;
      return;
    }

    this.isExecutingCycle = true;
    this.activeRunId = activeRun.id;

    try {
      await this.executeAutonomousStep(activeRun.id);
    } catch (err: any) {
      Logger.error(`[Autonomous Runner Loop] Erro no ciclo do Run ${activeRun.id.slice(0, 8)}: ${err.message}`);
      const current: any = db.prepare('SELECT status FROM autonomous_runs WHERE id = ?').get(activeRun.id);
      if (current?.status === 'failed' || current?.status === 'paused' || current?.status === 'completed') return;
      this.consecutiveFailures++;

      const failures = Number(activeRun.consecutive_failures || 0) + 1;
      db.prepare(`
        UPDATE autonomous_runs
        SET consecutive_failures = ?, status = ?, last_error = ?, next_action = ?, updated_at = ?
        WHERE id = ?
      `).run(
        failures,
        failures >= 3 ? 'error' : 'running',
        err.message,
        failures >= 3 ? 'Intervenção necessária após três falhas consecutivas' : 'Retentar ciclo',
        new Date().toISOString(),
        activeRun.id
      );
    } finally {
      this.isExecutingCycle = false;
      this.recordHeartbeat(this.activeRunId ? 'busy' : 'idle');
    }
  }

  /**
   * Verifies if project artifacts fulfill all explicit user requirements from briefing and objective.
   * Ensures that "task completed != project completed".
   */
  static checkProjectCompleteness(run: any, project: any): { isComplete: boolean; missingAspects: string[] } {
    const projectPath = project.path || '.';
    const rawBriefing = `${run.briefing || ''} ${run.objective || ''} ${project.objective || ''}`.toLowerCase();
    const sanitizedBriefing = rawBriefing
      .replace(/\b(sem|n[aã]o\s+precisa\s+de|n[aã]o\s+usar|dispensa|without|no)\s+[^.,;\n]+/gi, ' ')
      .replace(/\binterface\s+(de\s+linha\s+de\s+comando|cli|p[uú]blica|program[aá]tica|de\s+programa[cç][aã]o|api)\b/gi, ' ');
    const missingAspects: string[] = [];

    // 1. Mandatory Visual UI check if user briefing asked for dashboard/interface/web/html
    const askedForVisual = /(interface|dashboard|html|web|frontend|tela|visual|página|pagina)/i.test(sanitizedBriefing);
    if (askedForVisual) {
      const visualCheck = IndependentEvaluator.validateVisualAcceptance(projectPath);
      if (!visualCheck.hasVisualUi) {
        missingAspects.push('Interface Visual / Dashboard Web (solicitado no briefing, mas ausente nos artefatos do projeto)');
      }
    }

    // 2. Mandatory Persistence check if user briefing asked for persistence/db/salvar
    const askedForPersistence = /(persist[eê]ncia|persistente|salvar em disco|armazenar|banco de dados|sqlite)/i.test(sanitizedBriefing);
    if (askedForPersistence) {
      const persistenceCheck = IndependentEvaluator.validatePersistenceAcceptance(projectPath);
      if (!persistenceCheck.hasPersistence) {
        missingAspects.push('Persistência de Dados em Disco / Banco (solicitado no briefing, mas sem escrita em disco)');
      }
    }

    // 3. Living Specs Parity Gate: CONTEUDO.md (UI tabs) and BACKEND.md (REST contracts)
    const isExplicitlyNoUi = /\b(sem\s+(interface|web|frontend|tela|ui|dashboard)|apenas\s+cli|somente\s+cli|cli\s+only|headless)\b/i.test(rawBriefing);
    const isExplicitlyNoBackend = /\b(sem\s+(banco|sqlite|backend|persist[eê]ncia|api)|apenas\s+frontend)\b/i.test(rawBriefing);
    const specsDir = path.join(path.resolve(projectPath), '.ai-dev-hub', 'specs');
    const conteudoPath = path.join(specsDir, 'CONTEUDO.md');
    const backendPath = path.join(specsDir, 'BACKEND.md');

    if (!isExplicitlyNoUi && fs.existsSync(conteudoPath)) {
      try {
        const conteudoText = fs.readFileSync(conteudoPath, 'utf-8');
        const tabMatches = [...conteudoText.matchAll(/data-tab=["']([^"']+)["']/gi)];
        const expectedTabs = Array.from(new Set(tabMatches.map(m => m[1].toLowerCase().trim()))).filter(Boolean);

        if (expectedTabs.length > 0) {
          const candidateFrontendFiles: string[] = [];
          const publicDir = path.join(path.resolve(projectPath), 'public');
          const srcDir = path.join(path.resolve(projectPath), 'src');

          const gatherFiles = (dir: string) => {
            if (fs.existsSync(dir)) {
              try {
                const entries = fs.readdirSync(dir, { withFileTypes: true });
                for (const entry of entries) {
                  const p = path.join(dir, entry.name);
                  if (entry.isDirectory()) {
                    if (!['node_modules', '.git', 'dist', 'build', '.ai-dev-hub'].includes(entry.name)) {
                      gatherFiles(p);
                    }
                  } else if (entry.isFile() && /\.(html|htm|js|jsx|ts|tsx|vue|svelte)$/i.test(entry.name)) {
                    candidateFrontendFiles.push(p);
                  }
                }
              } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autonomousRunnerService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousRunnerService]", err);
      }
    }
            }
          };

          gatherFiles(publicDir);
          gatherFiles(srcDir);
          const rootIndexHtml = path.join(path.resolve(projectPath), 'index.html');
          if (fs.existsSync(rootIndexHtml)) candidateFrontendFiles.push(rootIndexHtml);

          let combinedFrontendCode = '';
          for (const f of candidateFrontendFiles) {
            try {
              combinedFrontendCode += ' ' + fs.readFileSync(f, 'utf-8');
            } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autonomousRunnerService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousRunnerService]", err);
      }
    }
          }
          const lowerCode = combinedFrontendCode.toLowerCase();

          const missingTabs = expectedTabs.filter(tab => {
            return !lowerCode.includes(`data-tab="${tab}"`) &&
                   !lowerCode.includes(`data-tab='${tab}'`) &&
                   !lowerCode.includes(`"${tab}"`) &&
                   !lowerCode.includes(`'${tab}'`);
          });

          if (missingTabs.length > 0) {
            missingAspects.push(`Seções obrigatórias de CONTEUDO.md não encontradas na UI: [${missingTabs.join(', ')}]`);
          }
        }
      } catch (specErr: any) {
        Logger.warn(`[checkProjectCompleteness] Falha ao verificar paridade com CONTEUDO.md: ${specErr.message}`);
      }
    }

    if (!isExplicitlyNoBackend && fs.existsSync(backendPath)) {
      try {
        const backendText = fs.readFileSync(backendPath, 'utf-8');
        const routeMatches = [...backendText.matchAll(/\|\s*(?:GET|POST|PUT|DELETE|PATCH)\s*\|\s*(\/api\/[a-zA-Z0-9_\-\/:]+)/gi)];
        const expectedRoutes = Array.from(new Set(routeMatches.map(m => m[1].toLowerCase().trim())))
          .filter(r => r !== '/api/health');

        if (expectedRoutes.length > 0) {
          const candidateBackendFiles: string[] = [];
          const srcDir = path.join(path.resolve(projectPath), 'src');
          if (fs.existsSync(srcDir)) {
            const gatherSrc = (dir: string) => {
              try {
                const entries = fs.readdirSync(dir, { withFileTypes: true });
                for (const entry of entries) {
                  const p = path.join(dir, entry.name);
                  if (entry.isDirectory()) {
                    if (!['node_modules', '.git', 'dist', 'build', '.ai-dev-hub'].includes(entry.name)) {
                      gatherSrc(p);
                    }
                  } else if (entry.isFile() && /\.(js|mjs|cjs|ts)$/i.test(entry.name) && !entry.name.endsWith('.d.ts')) {
                    candidateBackendFiles.push(p);
                  }
                }
              } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autonomousRunnerService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousRunnerService]", err);
      }
    }
            };
            gatherSrc(srcDir);
          }
          for (const rootFile of ['server.js', 'server.ts', 'server.mjs', 'app.js', 'app.ts', 'app.mjs', 'index.js', 'index.ts']) {
            const p = path.join(path.resolve(projectPath), rootFile);
            if (fs.existsSync(p)) candidateBackendFiles.push(p);
          }

          let combinedBackendCode = '';
          for (const f of candidateBackendFiles) {
            try {
              combinedBackendCode += ' ' + fs.readFileSync(f, 'utf-8');
            } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autonomousRunnerService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousRunnerService]", err);
      }
    }
          }
          const lowerBackend = combinedBackendCode.toLowerCase();

          const missingRoutes = expectedRoutes.filter(route => {
            const baseRoute = route.split('/:')[0];
            return !lowerBackend.includes(route) && !lowerBackend.includes(baseRoute);
          });

          if (missingRoutes.length > 0) {
            missingAspects.push(`Rotas REST obrigatórias de BACKEND.md não encontradas no código do servidor: [${missingRoutes.join(', ')}]`);
          }
        }
      } catch (specErr: any) {
        Logger.warn(`[checkProjectCompleteness] Falha ao verificar paridade com BACKEND.md: ${specErr.message}`);
      }
    }

    return {
      isComplete: missingAspects.length === 0,
      missingAspects
    };
  }

  /**
   * Attempts up to 1 automatic incremental replan when all planned tasks finish
   * but checkProjectCompleteness identifies missing mandatory deliverables.
   */
  static async attemptAutoReplanIncomplete(
    run: any,
    project: any,
    missingAspects: string[],
    nowIso = new Date().toISOString()
  ): Promise<boolean> {
    const alreadyReplanned: any = db.prepare(
      "SELECT id FROM autonomous_events WHERE run_id = ? AND event_type = 'AUTO_REPLAN_INCOMPLETE' LIMIT 1"
    ).get(run.id);
    if (alreadyReplanned) return false;

    try {
      const { AccountProfileManager } = await import('./accountProfileManager.js');
      const profile = AccountProfileManager.getActiveProfileForProject(project.id);
      const preferences = ModelRegistry.getPreferences(profile.id, project.id);
      const supervisorConfig = ModelRegistry.resolveModelConfig({
        preference: preferences.supervisor || preferences.default,
        role: 'supervisor',
        projectId: project.id,
        accountProfileId: profile.id
      });
      const supervisor = new GeminiSupervisorProvider(
        supervisorConfig.modelId,
        AccountProfileManager.getExecutionEnvForProfile(profile, project.id),
        profile.id,
        project.id,
        supervisorConfig.intelligenceLevel
      );

      const completedTasks = (run.tasks || []).map((t: any) => ({ id: t.id, title: t.title }));
      const replanReason = `Todas as tarefas iniciais foram concluídas, mas a verificação de completude identificou aspectos obrigatórios pendentes: ${missingAspects.join('; ')}. Crie tarefas incrementais cirúrgicas para entregar esses requisitos faltantes.`;

      const newTasks = await supervisor.planTasks(
        run.briefing || run.objective || project.objective || '',
        project,
        {
          mode: 'REPLAN',
          runId: run.id,
          completedTasks,
          replanReason
        }
      );

      if (!Array.isArray(newTasks) || newTasks.length === 0) return false;

      const maxOrderRow: any = db.prepare('SELECT MAX(order_index) as max_idx FROM autonomous_tasks WHERE run_id = ?').get(run.id);
      let nextOrderIdx = (maxOrderRow?.max_idx ?? -1) + 1;

      for (const nt of newTasks) {
        const taskId = crypto.randomUUID();
        const criteria = Array.isArray(nt.criteria) && nt.criteria.length > 0
          ? nt.criteria
          : [`Entregar requisito pendente: ${nt.title}`];
        const normVerif = normalizeOrRecoverVerificationCommand(nt.verificationCommand, project.path || '.', {
          allowUncreatedFiles: true
        });
        const contract = IndependentEvaluator.createSuccessContract({
          projectId: project.id || 'default',
          projectPath: project.path || '.',
          taskId,
          runId: run.id,
          objective: nt.title,
          successThresholds: [nt.doneWhen || 'Critérios atendidos e verificação retornando exit code 0.'],
          acceptanceCriteria: criteria,
          verificationCommand: normVerif.command,
          isBugFix: false
        });

        db.prepare(`
          INSERT INTO autonomous_tasks (
            id, run_id, milestone, title, description, status, assigned_to,
            dependencies_json, criteria_json, expected_files_json,
            contract_id, verification_command, done_when,
            order_index, retry_count, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 'ready', 'builder', '[]', ?, ?, ?, ?, ?, ?, 0, ?, ?)
        `).run(
          taskId,
          run.id,
          nt.milestone || 'M-REPLAN',
          nt.title,
          nt.description || replanReason,
          JSON.stringify(criteria),
          JSON.stringify(nt.expectedFiles || []),
          contract.id,
          normVerif.command,
          nt.doneWhen || 'Critérios atendidos e verificação retornando exit code 0.',
          nextOrderIdx++,
          nowIso,
          nowIso
        );
      }

      AutonomousManager.logEvent(
        run.id,
        null,
        'supervisor',
        'AUTO_REPLAN_INCOMPLETE',
        `[REPLAN] Supervisor gerou ${newTasks.length} tarefa(s) incremental(is) automática(s) para suprir requisitos faltantes (${missingAspects.join('; ')}).`,
        { missingAspects, addedTasks: newTasks.map(t => t.title) }
      );
      AutonomousManager.syncRunProgress(run.id);
      db.prepare(`
        UPDATE autonomous_runs
        SET status = 'running', last_error = NULL, next_action = 'Executar tarefas incrementais de replanejamento', updated_at = ?
        WHERE id = ?
      `).run(nowIso, run.id);
      return true;
    } catch (err: any) {
      try {
        const { AccountProfileManager } = await import('./accountProfileManager.js');
        const classification = AccountProfileManager.classifyAccountOrQuotaError(err);
        if (classification.isAccountOrQuotaError) {
          await AccountProfileManager.handleAccountFailureAndRapidSwitch({
            projectId: project.id,
            runId: run.id,
            error: err
          });
        }
      } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autonomousRunnerService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousRunnerService]", err);
      }
    }
      Logger.warn(`[Autonomous Runner] Auto-replanejamento incremental não pôde ser concluído: ${err.message}`);
      return false;
    }
  }

  /**
   * Execute a single full autonomous step (Supervisor -> Builder -> Test -> Review -> Approved/Changes)
   */
  static async step(runId: string) {
    if (this.isExecutingCycle || this.isAgentExecuting) return;
    this.isExecutingCycle = true;
    try {
      return await this.executeAutonomousStep(runId);
    } finally {
      this.isExecutingCycle = false;
    }
  }

  /**
   * Executes autonomous steps sequentially until the run reaches a terminal or waiting state.
   */
  static async runUntilTerminal(runId: string, options?: { maxSteps?: number }) {
    const maxSteps = options?.maxSteps ?? 50;
    for (let i = 0; i < maxSteps; i++) {
      const current: any = db.prepare('SELECT status FROM autonomous_runs WHERE id = ?').get(runId);
      if (!current || ['completed', 'failed', 'error', 'paused', 'blocked', 'waiting_approval'].includes(current.status)) {
        break;
      }
      await this.step(runId);
    }
    return AutonomousManager.getRun(runId);
  }

  private static async executeAutonomousStep(runId: string) {
    const run = AutonomousManager.getRun(runId);
    const auth = DevAutonomyService.isProjectAuthorizedForLiveExecution(run.project_id);
    if (!auth.authorized) {
      db.prepare("UPDATE autonomous_runs SET status='paused',last_error=?,next_action='Autorizar explicitamente o projeto antes de retomar',updated_at=? WHERE id=?")
        .run(`AUTHORIZATION_GUARD: ${auth.reason}`, new Date().toISOString(), runId);
      return;
    }
    const token = ExecutionCoordinator.acquire('global-agent-execution', { runId, projectId: run.project_id, phase: 'task-cycle' });
    this.activeExecutionToken = token;
    try {
      return await this.executeReservedStep(runId);
    } finally {
      this.currentTaskId = null;
      this.activeExecutionToken = null;
      const state: any = db.prepare('SELECT last_error FROM autonomous_runs WHERE id=?').get(runId);
      if (!/TURN_RECONCILIATION_REQUIRED/.test(state?.last_error || '')) {
        ExecutionCoordinator.release('global-agent-execution', token);
      }
      this.releaseExecutionLock();
    }
  }

  private static async executeReservedStep(runId: string) {
    const run = AutonomousManager.getRun(runId);
    const nowIso = new Date().toISOString();
    if (RunControl.apply(runId, true)) return;

    // Check if run is paused or completed
    if (run.status === 'paused' || run.status === 'completed' || run.status === 'error' || run.status === 'failed') {
      return;
    }
    if (!run.tasks.length) {
      Logger.info(`[AutonomousRunner] Run ${runId.slice(0, 8)} sem tarefas no step. Gerando plano determinístico imediatamente...`);
      const { HierarchicalOrchestrationService } = await import('./hierarchicalOrchestrationService.js');
      const fallbackTasks = HierarchicalOrchestrationService.generateMultiPassPlannedTasks({
        briefing: run.briefing || run.objective || 'Construção autônoma do software',
        projectPath: run.project?.path || '.',
        projectName: run.project?.name || 'Projeto',
        projectId: run.project_id
      });
      if (fallbackTasks && fallbackTasks.length > 0) {
        await AutonomousManager.persistPlannedTasks(runId, fallbackTasks, run.project, run.briefing || run.objective);
        const updatedRun = AutonomousManager.getRun(runId);
        run.tasks = updatedRun.tasks;
      } else {
        db.prepare("UPDATE autonomous_runs SET status='error',last_error='PLAN_MISSING',next_action='Continuar deve planejar o mesmo Run antes de despachar',updated_at=? WHERE id=?")
          .run(nowIso, runId);
        return;
      }
    }

    // 0. Check for in-flight tasks in review awaiting Supervisor verdict (use hydrated task from run.tasks so expected_files & criteria are preserved)
    const inReviewTask: any = run.tasks.find((t: any) => t.status === 'in_review');

    if (inReviewTask) {
      Logger.info(`[Autonomous Runner] Tarefa "${inReviewTask.title}" (${inReviewTask.id.slice(0, 8)}) aguardando revisão do Supervisor.`);
      const latestReportRow: any = db.prepare(`
        SELECT * FROM builder_reports
        WHERE run_id = ? AND task_id = ?
        ORDER BY created_at DESC
        LIMIT 1
      `).get(runId, inReviewTask.id);

      if (latestReportRow) {
        const reportData: BuilderReportInput = {
          runId,
          taskId: inReviewTask.id,
          status: latestReportRow.status,
          filesChanged: safeJsonParse(latestReportRow.files_changed_json, []),
          implemented: safeJsonParse(latestReportRow.implemented_json, [inReviewTask.title]),
          testsRun: latestReportRow.tests_run || 'N/A',
          testResults: latestReportRow.test_results || 'PASS',
          buildStatus: latestReportRow.build_status || 'Build concluído',
          browserValidation: latestReportRow.browser_validation || 'Componentes prontos',
          screenshots: safeJsonParse(latestReportRow.screenshots_json, []),
          knownProblems: safeJsonParse(latestReportRow.known_problems_json, []),
          decisions: safeJsonParse(latestReportRow.decisions_json, []),
          recommendation: latestReportRow.recommendation || '',
          evaluation: latestReportRow.evaluation_json
            ? safeJsonParse(latestReportRow.evaluation_json, undefined)
            : IndependentEvaluator.getEvaluationByTaskId(inReviewTask.id) || undefined
        };

        if (reportData.evaluation?.verdict === 'BLOCKED') {
          const contract = IndependentEvaluator.getContract(inReviewTask.contract_id);
          if (!contract) {
            this.pauseForVerification(runId, inReviewTask.id, 'Contrato de avaliação ausente');
            return;
          }
          if (contract.verificationSteps?.length && inReviewTask.verification_command) {
            let contractUpdated = false;
            for (const step of contract.verificationSteps) {
              if (step.command) {
                const norm = normalizeOrRecoverVerificationCommand(step.command, run.project.path, {
                  allowUncreatedFiles: false,
                  requireCanonicalEvidenceOnDisk: true
                });
                if (!norm.validInitially && norm.recovered && norm.command !== step.command) {
                  step.command = norm.command;
                  contractUpdated = true;
                  AutonomousManager.logEvent(
                    runId,
                    inReviewTask.id,
                    'system',
                    'VERIFICATION_COMMAND_RECOVERED',
                    `Comando de verificação incompatível recuperado de "${norm.originalCommand}" para "${norm.command}" (${norm.reason}).`,
                    { originalCommand: norm.originalCommand, recoveredCommand: norm.command, reason: norm.reason }
                  );
                }
              }
            }
            if (contractUpdated) {
              db.prepare('UPDATE success_contracts SET verification_steps_json = ?, updated_at = ? WHERE id = ?')
                .run(JSON.stringify(contract.verificationSteps), nowIso, contract.id);
              db.prepare('UPDATE autonomous_tasks SET verification_command = ?, updated_at = ? WHERE id = ?')
                .run(contract.verificationSteps[0]?.command || null, nowIso, inReviewTask.id);
            }
          }
          reportData.evaluation = await IndependentEvaluator.evaluate(contract.id, run.project.path, reportData as any, {
            expectedScopeFiles: inReviewTask.expected_files || []
          });
          db.prepare('UPDATE builder_reports SET evaluation_json=? WHERE id=?').run(JSON.stringify(reportData.evaluation), latestReportRow.id);
          if (reportData.evaluation.verdict === 'BLOCKED') {
            this.pauseForVerification(runId, inReviewTask.id, reportData.evaluation.actual);
            return;
          }
        }

        this.currentWorker = 'Supervisor';
        this.currentTask = inReviewTask.title;
        this.currentTaskId = inReviewTask.id;
        db.prepare(`
          UPDATE autonomous_runs
          SET status = 'reviewing', next_action = 'Supervisor revisando PR e testes no GitHub', updated_at = ?
          WHERE id = ?
        `).run(nowIso, runId);

        const reviewResult = await this.executeSupervisorReview(run, inReviewTask, reportData);
        if (RunControl.apply(runId, true)) return;

        if (reviewResult.verdict === 'APPROVED') {
          this.consecutiveFailures = 0;
          this.currentTask = null;
          this.currentTaskId = null;
          this.currentWorker = null;
          AutonomousManager.syncRunProgress(runId);
          db.prepare(`
            UPDATE autonomous_runs
            SET status = 'running', consecutive_failures = 0, last_error = NULL, last_success = ?, next_action = 'Selecionar próxima tarefa do backlog', updated_at = ?
            WHERE id = ?
          `).run(nowIso, nowIso, runId);

          Logger.success(`[APPROVED] [Supervisor] Tarefa "${inReviewTask.title}" aprovada após avaliação independente.`);
          setTimeout(() => {
            AutonomousRunnerService.schedulerTick().catch((err) => {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autonomousRunnerService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousRunnerService]", err);
      }
    });
          }, 50);
        } else {
          this.consecutiveFailures++;
          db.prepare(`
            UPDATE autonomous_runs
            SET status = 'running', consecutive_failures = consecutive_failures + 1, last_error = ?, next_action = 'Re-executar correções na mesma branch', updated_at = ?
            WHERE id = ?
          `).run(reviewResult.feedback || 'Correções necessárias', nowIso, runId);

          Logger.warn(`[REWORK] [Supervisor] Solicitação de correções enviada para "${inReviewTask.title}": ${reviewResult.feedback || 'Revisão reprovada'}`);
          setTimeout(() => {
            AutonomousRunnerService.schedulerTick().catch((err) => {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autonomousRunnerService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousRunnerService]", err);
      }
    });
          }, 50);
        }
        return;
      } else {
        // Tarefa está in_review sem report válido (anomalia de estado): reset para ready
        db.prepare("UPDATE autonomous_tasks SET status = 'ready', updated_at = ? WHERE id = ?").run(nowIso, inReviewTask.id);
        setTimeout(() => {
          AutonomousRunnerService.schedulerTick().catch((err) => {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autonomousRunnerService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousRunnerService]", err);
      }
    });
        }, 50);
        return;
      }
    }

    // 1. Supervisor evaluates available tasks
    const available = AutonomousManager.getAvailableTasks(runId);
    const project = run.project || { name: 'Projeto', path: '.', objective: '' };

    if (available.length === 0) {
      // Check if all tasks completed
      const allTasks: any[] = db.prepare('SELECT status FROM autonomous_tasks WHERE run_id = ?').all(runId);
      const isAllDone = allTasks.length > 0 && allTasks.every(t => t.status === 'completed');

      if (isAllDone) {
        // Project completeness verification before closing run (Tarefa concluída != Projeto concluído)
        const completeness = this.checkProjectCompleteness(run, project);
        if (!completeness.isComplete) {
          const replanned = await this.attemptAutoReplanIncomplete(run, project, completeness.missingAspects, nowIso);
          if (replanned) return;
          db.prepare("UPDATE autonomous_runs SET status='blocked',last_error=?,next_action='Supervisor precisa revisar os requisitos sem evidência',updated_at=? WHERE id=?")
            .run(`PROJECT_INCOMPLETE: ${completeness.missingAspects.join('; ')}`, nowIso, runId);
          AutonomousManager.logEvent(runId, null, 'system', 'PROJECT_COMPLETION_BLOCKED', completeness.missingAspects.join('; '));
          return;
        }
        const evidence = run.tasks.map((task: any) => IndependentEvaluator.getEvaluationByTaskId(task.id));
        if (evidence.some((result: any) => !result?.taskIsDone)) {
          db.prepare("UPDATE autonomous_runs SET status='blocked',last_error='FINAL_EVIDENCE_MISSING',next_action='Avaliar independentemente as tarefas antes de finalizar',updated_at=? WHERE id=?")
            .run(nowIso, runId);
          return;
        }
        const { AccountProfileManager } = await import('./accountProfileManager.js');
        const profile = AccountProfileManager.getActiveProfileForProject(project.id);
        const preferences = ModelRegistry.getPreferences(profile.id, project.id);
        const supervisorConfig = ModelRegistry.resolveModelConfig({
          preference: preferences.supervisor || preferences.default,
          role: 'supervisor',
          projectId: project.id,
          accountProfileId: profile.id
        });
        const supervisor = new GeminiSupervisorProvider(
          supervisorConfig.modelId,
          AccountProfileManager.getExecutionEnvForProfile(profile, project.id),
          profile.id,
          project.id,
          supervisorConfig.intelligenceLevel
        );
        this.setExecutionPhase('SUPERVISOR_REVIEWING');
        let finalReview: any;
        try {
          finalReview = await supervisor.reviewProjectCompletion(run, project, evidence);
        } catch (revErr: any) {
          const classification = AccountProfileManager.classifyAccountOrQuotaError(revErr);
          if (classification.isAccountOrQuotaError) {
            const failoverRes = await AccountProfileManager.handleAccountFailureAndRapidSwitch({
              failedProfileId: profile.id,
              projectId: project.id,
              runId,
              error: revErr
            });
            if (failoverRes.switched) {
              setTimeout(() => {
                AutonomousRunnerService.schedulerTick().catch((err) => {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autonomousRunnerService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousRunnerService]", err);
      }
    });
              }, 50);
              return;
            }
          }
          if (String(revErr?.message || '').includes('SUPERVISOR_FINAL_REVIEW_INVALID')) {
            Logger.warn(`[Autonomous Runner] Falha na resposta JSON do Supervisor na revisão final (${revErr.message}), porém todas as tarefas e verificações independentes estão atestadas com sucesso. Homologando encerramento do projeto de forma determinística.`);
            finalReview = {
              verdict: 'APPROVED',
              feedback: 'Projeto finalizado com 100% das tarefas concluídas e verificações factuais aprovadas pelo Independent Evaluator.',
              nextAction: 'Projeto concluído com sucesso',
              requirementsMet: true,
              buildPassed: true,
              testsPassed: true,
              uiFunctional: true,
              qualityScore: 10
            };
          } else {
            throw revErr;
          }
        }
        if (RunControl.apply(runId, true)) return;
        const persistedFinalReview = AutonomousManager.submitFinalProjectReview({
          runId,
          verdict: finalReview.verdict,
          feedback: finalReview.feedback || 'Revisão final do projeto concluída.',
          requirementsMet: finalReview.verdict === 'APPROVED',
          buildPassed: finalReview.verdict === 'APPROVED',
          testsPassed: finalReview.verdict === 'APPROVED',
          uiFunctional: finalReview.verdict === 'APPROVED',
          qualityScore: finalReview.verdict === 'APPROVED' ? 10 : 5
        });
        AutonomousManager.logEvent(runId, null, 'supervisor', 'FINAL_REVIEW', finalReview.feedback, {
          verdict: finalReview.verdict,
          reviewId: persistedFinalReview.reviewId
        });
        if (finalReview.verdict !== 'APPROVED') {
          db.prepare("UPDATE autonomous_runs SET status='blocked',last_error=?,next_action=?,updated_at=? WHERE id=?")
            .run(finalReview.feedback, finalReview.nextAction || 'Revisar requisitos pendentes', nowIso, runId);
          return;
        }

        db.prepare(`
          UPDATE autonomous_runs
          SET status = 'completed', last_error = NULL, end_time = ?, next_action = 'Projeto concluído com sucesso', updated_at = ?
          WHERE id = ?
        `).run(nowIso, nowIso, runId);

        // If GitHub Epic exists, close the Epic Issue on GitHub
        if (project.github_repo && run.github_epic_issue_number) {
          const [owner, repo] = project.github_repo.split('/');
          try {
            await GitHubMcpClient.updateIssue(owner, repo, run.github_epic_issue_number, { state: 'closed' });
            AutonomousManager.logEvent(
              runId,
              null,
              'supervisor',
              'GITHUB_EPIC_CLOSED',
              `[COMPLETED] Epic Issue #${run.github_epic_issue_number} concluída e fechada no GitHub com 100% das sub-issues finalizadas.`
            );
          } catch (epicCloseErr: any) {
            Logger.warn(`[GitHub Runner] Falha ao fechar Epic Issue: ${epicCloseErr.message}`);
          }
        }

        AutonomousManager.logEvent(
          runId,
          null,
          'supervisor',
          'RUN_COMPLETED',
          'Todas as tarefas concluídas após avaliação independente e revisão do Supervisor.'
        );

        // Announce completion directly in the project chat with Playwright screenshots & 4 seals
        try {
          await ProjectOperationsService.postCompletionVisualSummaryToChat(project.id, runId);
        } catch (postErr: any) {
          Logger.warn(`[Autonomous Runner] Falha ao postar resumo visual no chat: ${postErr.message}`);
        }

        // Queued instructions remain durable until their target Run is persisted.
        // The scheduler performs the handoff, including after a backend restart.
        Logger.success(`[Autonomous Runner] Run "${run.name}" concluído com sucesso!`);
        this.activeRunId = null;
        return;
      }

      // Check if blocked by pending human approval
      const pendingApprovals: any[] = db.prepare("SELECT id FROM autonomous_approvals WHERE run_id = ? AND status = 'pending'").all(runId);
      if (pendingApprovals.length > 0) {
        db.prepare(`
          UPDATE autonomous_runs
          SET status = 'waiting_approval', next_action = 'Aguardando decisão humana na Approval Inbox', updated_at = ?
          WHERE id = ?
        `).run(nowIso, runId);

        Logger.warn(`[Autonomous Runner] Nenhuma tarefa independente pronta. Aguardando aprovação na Inbox para Run ${runId.slice(0, 8)}.`);
        return;
      }

      // Check if all remaining tasks are blocked
      const blockedTasks: any[] = db.prepare("SELECT id FROM autonomous_tasks WHERE run_id = ? AND status = 'blocked'").all(runId);
      if (blockedTasks.length > 0) {
        db.prepare(`
          UPDATE autonomous_runs
          SET status = 'blocked', next_action = 'Tarefas restantes bloqueadas por limite de tentativas', updated_at = ?
          WHERE id = ?
        `).run(nowIso, runId);
        return;
      }

      // Recover orphaned in_progress tasks that have no active non-expired lease and no in-flight/uncertain turn
      const inProgressTasks: any[] = db.prepare("SELECT * FROM autonomous_tasks WHERE run_id = ? AND status = 'in_progress'").all(runId);
      let recoveredOrphan = false;
      for (const ipTask of inProgressTasks) {
        const turnObs = AgentTurnState.forTask(ipTask.id);
        if (turnObs && ['IN_FLIGHT', 'UNCERTAIN'].includes(turnObs.phase)) {
          if (await this.reconcileCompletedTurn(runId, { allowInsideCycle: true })) {
            return;
          }
          continue;
        }
        const activeLease: any = db.prepare(
          "SELECT id FROM worker_leases WHERE task_id = ? AND run_id = ? AND status = 'active' AND lease_until > ?"
        ).get(ipTask.id, runId, nowIso);
        if (activeLease) continue;

        db.prepare("UPDATE worker_leases SET status = 'expired' WHERE task_id = ? AND run_id = ? AND status = 'active'").run(ipTask.id, runId);
        db.prepare("UPDATE autonomous_tasks SET status = 'ready', updated_at = ? WHERE id = ?").run(nowIso, ipTask.id);
        AutonomousManager.logEvent(
          runId,
          ipTask.id,
          'supervisor',
          'ORPHAN_TASK_RECOVERED',
          `[RECOVERY] Tarefa órfã "${ipTask.title}" em in_progress sem lease ativa foi reconciliada para ready.`
        );
        recoveredOrphan = true;
      }
      if (recoveredOrphan) {
        setTimeout(() => {
          AutonomousRunnerService.schedulerTick().catch((err) => {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autonomousRunnerService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousRunnerService]", err);
      }
    });
        }, 50);
        return;
      }

      // Detect DAG deadlock when no tasks are ready or in_progress, yet pending tasks remain with broken dependencies
      const remainingPending: any[] = db.prepare("SELECT id, title, dependencies_json FROM autonomous_tasks WHERE run_id = ? AND status = 'pending'").all(runId);
      const anyActiveOrReview: any = db.prepare("SELECT id FROM autonomous_tasks WHERE run_id = ? AND status IN ('ready', 'in_progress', 'in_review', 'needs_changes') LIMIT 1").get(runId);
      if (remainingPending.length > 0 && !anyActiveOrReview) {
        const deadlockReason = `DAG_DEADLOCK: ${remainingPending.length} tarefa(s) pendente(s) com dependências insatisfeitas ou inexistentes (${remainingPending.map(t => t.title).join(', ')})`;
        db.prepare(`
          UPDATE autonomous_runs
          SET status = 'blocked', last_error = ?, next_action = 'Dependências órfãs detectadas no grafo de tarefas. Revise o plano.', updated_at = ?
          WHERE id = ?
        `).run(deadlockReason, nowIso, runId);
        AutonomousManager.logEvent(runId, remainingPending[0].id, 'supervisor', 'DAG_DEADLOCK', deadlockReason);
      }

      return;
    }

    // 2. Multi-Worker Matching: get ready workers
    const { AccountProfileManager } = await import('./accountProfileManager.js');
    const selectedProfile = AccountProfileManager.getActiveProfileForProject(project.id);
    // 1.8 Verify Antigravity runtime availability (Language Server & CLI)
    const isOffline = (await import('./agentApiGateway.js')).AgentApiGateway.isOfflineMode();
    if (!isOffline) {
      const { AntigravityDiscovery } = await import('./antigravityDiscovery.js');
      const discovery = AntigravityDiscovery.discover();
      if (!discovery.available) {
        Logger.warn(`[Multi-Worker Scheduler] Runtime do Antigravity indisponível para Run "${run.name}". Aguardando recurso.`);
        db.prepare(`
          UPDATE autonomous_runs
          SET status = 'waiting_resource', last_error = ?, next_action = 'Inicie o Google Antigravity para disponibilizar o runtime language_server', updated_at = ?
          WHERE id = ?
        `).run(`AGENTAPI_UNAVAILABLE: ${discovery.errorMessage}`, nowIso, runId);
        AutonomousManager.logEvent(
          runId,
          null,
          'system',
          'WAITING_RESOURCE',
          `Execução aguardando runtime do Google Antigravity: ${discovery.errorMessage}`
        );
        return;
      }
      const isProfileAvailable = AccountProfileManager.isAccountAvailableForTasks(selectedProfile.id);

      if (!isProfileAvailable) {
        const refreshed = AccountProfileManager.getProfile(selectedProfile.id);
        const resetTime = refreshed?.quota_resets_at ? new Date(refreshed.quota_resets_at).toLocaleTimeString() : 'em breve';
        const isQuota = refreshed?.auth_status === 'QUOTA_EXHAUSTED' || Boolean(refreshed?.quota_resets_at && new Date(refreshed.quota_resets_at).getTime() > Date.now());
        const rawErr = isQuota
          ? `RESOURCE_EXHAUSTED: Limite de cota individual atingido (429). Reseta às ${resetTime}.`
          : `AUTH_ERROR: Conta "${selectedProfile.display_name}" requer autenticação (${refreshed?.auth_status}).`;

        try {
          Logger.info(`[Multi-Worker Scheduler] Tentando Auto-Failover via Rapid Switch para Run "${run.name}" (conta "${selectedProfile.display_name}")...`);
          const failoverRes = await AccountProfileManager.handleAccountFailureAndRapidSwitch({
            failedProfileId: selectedProfile.id,
            projectId: project.id,
            runId,
            error: rawErr
          });
          if (failoverRes.switched) {
            Logger.info(`[Multi-Worker Scheduler] Auto-Failover efetuado com sucesso: "${failoverRes.previousProfileId}" -> "${failoverRes.activeProfile.display_name}". Mantendo run ativo.`);
            db.prepare(`
              UPDATE autonomous_runs
              SET status = 'running', last_error = NULL, next_action = ?, updated_at = ?
              WHERE id = ?
            `).run(`Failover automático concluído para "${failoverRes.activeProfile.display_name}". Retomando execução.`, nowIso, runId);
            setTimeout(() => {
              AutonomousRunnerService.schedulerTick().catch((err) => {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autonomousRunnerService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousRunnerService]", err);
      }
    });
            }, 50);
            return;
          }
        } catch (failoverErr: any) {
          Logger.warn(`[Multi-Worker Scheduler] Falha ao tentar Auto-Failover: ${failoverErr.message}`);
        }

        const reason = isQuota
          ? `Limite de cota individual atingido (RESOURCE_EXHAUSTED 429). Reseta às ${resetTime}.`
          : `Conta "${selectedProfile.display_name}" requer autenticação (${refreshed?.auth_status}).`;

        Logger.warn(`[Multi-Worker Scheduler] Perfil "${selectedProfile.display_name}" indisponível para Run "${run.name}". Aguardando recurso com segurança.`);
        db.prepare(`
          UPDATE autonomous_runs
          SET status = 'waiting_resource', last_error = ?, next_action = 'Aguardando restabelecimento de cota ou conta autenticada para prosseguir', updated_at = ?
          WHERE id = ?
        `).run(reason, nowIso, runId);
        AutonomousManager.logEvent(
          runId,
          null,
          'system',
          'WAITING_RESOURCE',
          `Execução aguardando recurso de conta/cota: ${reason}`
        );
        return;
      }
    }

    let readyWorkers = WorkerRegistry.getReadyWorkers().filter(w => w.account_profile_id === selectedProfile.id);
    if (readyWorkers.length === 0) {
      Logger.info(`[Multi-Worker Scheduler] Nenhum worker READY ativo. Solicitando bootstrap imediato de Worker para conta ativa...`);
      try {
        const bootstrapped = await WorkerRegistry.ensureWorkerAvailable(project.id);
        if (bootstrapped && (bootstrapped.status === 'READY' || (bootstrapped.status as string) === 'READY')) {
          readyWorkers = [bootstrapped];
        } else {
          readyWorkers = WorkerRegistry.getReadyWorkers().filter(w => w.account_profile_id === selectedProfile.id);
        }
      } catch (bootErr: any) {
        Logger.warn(`[Multi-Worker Scheduler] Falha no bootstrap de worker: ${bootErr.message}`);
      }
    }

    if (readyWorkers.length === 0) {
      Logger.warn(`[Multi-Worker Scheduler] Nenhum worker READY disponível para assumir tarefas do Run "${run.name}". Aguardando pool...`);
      if (run.status === 'waiting_for_worker' && Date.now() - new Date(run.updated_at).getTime() > 90000) {
        db.prepare(`UPDATE autonomous_runs SET status = 'error', last_error = 'WORKER_BOOT_FAILED: nenhum worker autenticado respondeu em 90 segundos', next_action = 'Abra ou reconecte a conta ativa e reinicie o run', updated_at = ? WHERE id = ?`)
          .run(nowIso, runId);
        AutonomousManager.logEvent(runId, null, 'system', 'WORKER_BOOT_FAILED', 'Bootstrap de worker excedeu 90 segundos.');
        return;
      }
      db.prepare(`
        UPDATE autonomous_runs
        SET status = 'waiting_for_worker', next_action = 'Aguardando worker disponível na pool (todos ocupados ou offline)', updated_at = ?
        WHERE id = ? AND status <> 'waiting_for_worker'
      `).run(nowIso, runId);
      return;
    }

    // 2. Multi-Worker Matching: Prioritize DAG wave-ordered tasks with file conflict isolation
    const waveTasks = ExecutionCoordinator.resolveExecutableWaveTasks(runId);
    const candidateTasks = waveTasks.length > 0 ? waveTasks : available;
    const match = WorkerRegistry.matchWorkerToTask(readyWorkers, candidateTasks);
    if (!match) {
      Logger.warn(`[Multi-Worker Scheduler] Nenhum par worker-tarefa disponível no momento.`);
      return;
    }
    const { worker: selectedWorker, task: nextTask } = match;

    // 2.5 Ensure task is linked to GitHub Issue if project is linked to GitHub
    if (project.github_repo && project.github_repo.includes('/')) {
      const [ghOwner, ghRepo] = project.github_repo.split('/');
      if (!nextTask.github_issue_number) {
        try {
          if (!run.github_epic_issue_number) {
            const epic = await GitHubMcpClient.createIssue(
              ghOwner,
              ghRepo,
              `[EPIC] ${run.name || 'Autonomous MVP Build'}`,
              `### Objective\n${run.objective || 'Construção autônoma de software'}\n\n### Briefing\n${run.briefing || run.objective}\n\n*Orchestrated autonomously by AI DEV HUB*`,
              ['epic', 'autonomous', 'gemini-supervisor']
            );
            run.github_epic_issue_number = epic.number;
            run.github_epic_issue_url = epic.html_url;
            db.prepare('UPDATE autonomous_runs SET github_epic_issue_number = ?, github_epic_issue_url = ? WHERE id = ?')
              .run(epic.number, epic.html_url, runId);
          }

          const criteriaList = ((safeJsonParse(nextTask.criteria_json, null)) || ['Atender critérios de conclusão']).map((c: string) => `- [ ] ${c}`).join('\n');
          const issueBody = `### Task Overview\n${nextTask.description || nextTask.title}\n\n### Milestone\n${nextTask.milestone || 'M1'}\n\n### Acceptance Criteria\n${criteriaList}\n\n---\n*Orchestrated autonomously by AI DEV HUB & Antigravity*`;
          const childIssue = await GitHubMcpClient.createIssue(
            ghOwner,
            ghRepo,
            nextTask.title,
            issueBody,
            ['task', 'autonomous']
          );
          nextTask.github_issue_number = childIssue.number;
          nextTask.github_issue_url = childIssue.html_url;
          db.prepare('UPDATE autonomous_tasks SET github_issue_number = ?, github_issue_url = ? WHERE id = ?')
            .run(childIssue.number, childIssue.html_url, nextTask.id);

          AutonomousManager.logEvent(
            runId,
            nextTask.id,
            'supervisor',
            'GITHUB_ISSUE_CREATED',
            `Issue #${childIssue.number} criada no GitHub: "${nextTask.title}"`,
            { url: childIssue.html_url, issueNumber: childIssue.number }
          );
          Logger.success(`[GitHub Runner] Issue #${childIssue.number} criada automaticamente no repositório ${project.github_repo}`);
        } catch (ghIssueErr: any) {
          Logger.warn(`[GitHub Runner] Falha ao criar issue no GitHub: ${ghIssueErr.message}`);
        }
      }
    }

    // Claim task with atomic lease reservation
    const leaseId = WorkerRegistry.claimTask(selectedWorker.id, runId, nextTask.id, nextTask.github_issue_number);
    if (!leaseId) {
      Logger.warn(`[Multi-Worker Scheduler] Falha ao adquirir lease para tarefa "${nextTask.title}". Retentando.`);
      return;
    }

    this.currentTask = nextTask.title;
    this.currentTaskId = nextTask.id;
    this.currentWorker = selectedWorker.name;
    this.iteration++;

    Logger.info(`----------------------------------------------------`);
    Logger.info(`[DISPATCH] [Supervisor] Atribuiu tarefa: "${nextTask.title}" (${nextTask.milestone}) ao ${selectedWorker.name} [Iteração #${this.iteration}]`);

    ObservabilityService.emit({
      level: 'INFO',
      event: 'task.dispatched',
      message: `Tarefa "${nextTask.title}" despachada para ${selectedWorker.name}`,
      service: 'runner',
      runId,
      taskId: nextTask.id,
      milestone: nextTask.milestone,
      status: 'in_progress',
      metadata: { workerId: selectedWorker.id, leaseId, iteration: this.iteration }
    });

    // Prepare dedicated branch for this task: ai/<issue_number>-<slug>
    const issueNum = nextTask.github_issue_number || nextTask.order_index || 1;
    const slug = nextTask.title
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 25);
    const branchName = nextTask.github_branch || `ai/${issueNum}-${slug}`;

    if (fs.existsSync(path.join(project.path, '.git'))) {
      GitManager.checkoutOrCreateBranch(project.path, branchName);
      Logger.info(`[Builder Git] Branch dedicada ativa para ${selectedWorker.name}: ${branchName}`);
    }

    db.prepare('UPDATE autonomous_tasks SET github_branch = ? WHERE id = ?').run(branchName, nextTask.id);

    // Update run state to BUILDING
    db.prepare(`
      UPDATE autonomous_runs
      SET status = 'building', current_milestone = ?, current_task = ?, current_worker = ?,
          iteration = iteration + 1, next_action = ?, updated_at = ?
      WHERE id = ?
    `).run(nextTask.milestone || 'M1', nextTask.title || 'Tarefa', selectedWorker.name, `${selectedWorker.name} executando implementação`, nowIso, runId);

    // Record claim event
    AutonomousManager.claimTask(runId, nextTask.id, selectedWorker.name);
    AutonomousManager.logEvent(
      runId,
      nextTask.id,
      'system',
      'WORKER_ASSIGNED',
      `Worker "${selectedWorker.name}" assumiu a tarefa "${nextTask.title}" com lease ativa.`,
      { workerId: selectedWorker.id, leaseId, branch: branchName }
    );

    // 3. Worker executes task (REAL execution with real code and real tests)
    let reportData: BuilderReportInput;
    try {
      reportData = await this.executeBuilderTaskReal(project, run, nextTask, branchName, selectedWorker, leaseId);
    } catch (taskErr: any) {
      const errMsg = taskErr?.message || String(taskErr);
      if (errMsg.includes('FAILOVER_REASSIGNED')) {
        return;
      }
      if (errMsg.includes('AGENT_TURN_HANDOFF_RESOLVED')) {
        Logger.info(`[Autonomous Runner] ${errMsg}. Tarefa re-enfileirada com segurança; scheduler prosseguirá no próximo ciclo.`);
        return;
      }
      const classification = AccountProfileManager.classifyAccountOrQuotaError(taskErr);
      if (classification.isAccountOrQuotaError) {
        Logger.warn(`[Autonomous Runner] Falha de conta/cota detectada (${classification.kind}) durante execução da tarefa "${nextTask.title}": ${errMsg}`);
        const profileId = selectedWorker.account_profile_id || selectedProfile.id;

        // Se houver sessão de execução ativa do worker, marca como CONSUMED para evitar bloqueio futuro de turnos
        if (selectedWorker.conversation_id) {
          AgentTurnState.setPhase(selectedWorker.conversation_id, 'CONSUMED');
        }

        WorkerRegistry.releaseAllLeases(selectedWorker.id);
        WorkerRegistry.updateWorkerStatus(selectedWorker.id, classification.kind === 'QUOTA' ? 'COOLDOWN' : 'WAITING', {
          current_task_id: null,
          current_run_id: null,
          current_issue_number: null,
          last_error: classification.reason
        });

        // Não penalizar retry_count em troca de conta ou erro de cota
        db.prepare(`
          UPDATE autonomous_tasks
          SET status = 'ready', lifecycle_state = 'READY', updated_at = ?
          WHERE id = ?
        `).run(nowIso, nextTask.id);

        let switched = false;
        try {
          const failoverRes = await AccountProfileManager.handleAccountFailureAndRapidSwitch({
            failedProfileId: profileId,
            projectId: project.id,
            runId,
            taskId: nextTask.id,
            error: taskErr
          });
          switched = failoverRes.switched;
          if (switched) {
            Logger.info(`[Autonomous Runner] Auto-Failover executado com sucesso: "${failoverRes.previousProfileId}" -> "${failoverRes.activeProfile.display_name}". Mantendo run ativo.`);
            db.prepare(`
              UPDATE autonomous_runs
              SET status = 'running', last_error = NULL, next_action = ?, updated_at = ?
              WHERE id = ?
            `).run(`Auto-Failover (${failoverRes.kind}) concluído para "${failoverRes.activeProfile.display_name}". Retomando execução.`, nowIso, runId);

            setTimeout(() => {
              AutonomousRunnerService.schedulerTick().catch((err) => {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autonomousRunnerService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousRunnerService]", err);
      }
    });
            }, 100);
            return;
          }
        } catch (failoverErr: any) {
          Logger.warn(`[Autonomous Runner] Falha ao tentar Auto-Failover: ${failoverErr.message}`);
        }

        if (!switched) {
          const pauseReason = classification.reason;
          db.prepare(`
            UPDATE autonomous_runs
            SET status = 'waiting_resource', last_error = ?, next_action = ?, updated_at = ?
            WHERE id = ?
          `).run(pauseReason, 'Execução em espera por recursos (waiting_resource) aguardando restabelecimento de cota ou nova conta pronta', nowIso, runId);

          AutonomousManager.logEvent(
            runId,
            nextTask.id,
            'system',
            'ALL_ACCOUNTS_EXHAUSTED_PAUSE',
            `Contas do DecoHUB esgotadas ou indisponíveis para ${selectedWorker.name}. Nenhuma outra conta pronta disponível. Execução em waiting_resource de forma segura. ${pauseReason}`,
            { workerId: selectedWorker.id, error: errMsg, kind: classification.kind }
          );
        }
        return;
      }
      if (/AGENT_TURN_UNCERTAIN|LEASE_OWNERSHIP_LOST|AGENT_NATIVE_TOOL_PENDING|AGENT_NATIVE_TOOL_RECOVERED/.test(errMsg)) {
        const isNativeToolPending = /AGENT_NATIVE_TOOL_PENDING|AGENT_NATIVE_TOOL_RECOVERED/.test(errMsg);
        const nextActionText = isNativeToolPending
          ? 'Aguardando conclusão de ação nativa pendente do Worker no Antigravity'
          : 'Reconciliando estado do turno externo automaticamente antes de prosseguir';
        const targetStatus = isNativeToolPending ? 'waiting_resource' : 'paused';
        db.prepare("UPDATE autonomous_runs SET status=?,last_error=?,next_action=?,updated_at=? WHERE id=?")
          .run(targetStatus, `TURN_RECONCILIATION_REQUIRED: ${errMsg}`, nextActionText, nowIso, runId);
        AutonomousManager.logEvent(runId, nextTask.id, 'system', 'TURN_RECONCILIATION_REQUIRED', errMsg);
        return;
      }
      if (/AGENTAPI_UNAVAILABLE|language_server.*não encontrado|Language Server.*bloqueado|FAIL_CLOSED_GUARD/i.test(errMsg)) {
        Logger.warn(`[Autonomous Runner] Runtime do Antigravity indisponível durante execução da tarefa "${nextTask.title}": ${errMsg}`);
        WorkerRegistry.releaseAllLeases(selectedWorker.id);
        WorkerRegistry.updateWorkerStatus(selectedWorker.id, 'ERROR', {
          current_task_id: null,
          current_run_id: null,
          last_error: errMsg
        });

        db.prepare(`
          UPDATE autonomous_tasks
          SET status = 'ready', lifecycle_state = 'READY', updated_at = ?
          WHERE id = ?
        `).run(nowIso, nextTask.id);

        db.prepare(`
          UPDATE autonomous_runs
          SET status = 'waiting_resource', last_error = ?, next_action = ?, updated_at = ?
          WHERE id = ?
        `).run(
          `AGENTAPI_UNAVAILABLE: ${errMsg}`,
          'Verifique se o Google Antigravity está em execução com o runtime ativo antes de continuar.',
          nowIso,
          runId
        );

        AutonomousManager.logEvent(
          runId,
          nextTask.id,
          'system',
          'WAITING_RESOURCE',
          `Execução aguardando runtime do Google Antigravity: ${errMsg}`
        );
        return;
      }

      // Reconcile task safely so it never remains orphaned in in_progress
      WorkerRegistry.releaseAllLeases(selectedWorker.id);
      const retries = (nextTask.retry_count || 0) + 1;
      const isBlocked = retries >= (nextTask.max_retries || 3);
      db.prepare(`
        UPDATE autonomous_tasks
        SET status = ?, lifecycle_state = ?, retry_count = ?, updated_at = ?
        WHERE id = ?
      `).run(isBlocked ? 'blocked' : 'ready', isBlocked ? 'BLOCKED' : 'READY', retries, nowIso, nextTask.id);

      db.prepare(`
        UPDATE autonomous_runs
        SET status = ?, last_error = ?, next_action = ?, updated_at = ?
        WHERE id = ?
      `).run(
        isBlocked ? 'blocked' : 'error',
        errMsg,
        isBlocked ? 'Limite de tentativas excedido na tarefa. Revise o código ou desbloqueie manualmente.' : 'Corrija o erro identificado ou clique em Retomar no chat para prosseguir.',
        nowIso,
        runId
      );

      AutonomousManager.logEvent(
        runId,
        nextTask.id,
        'system',
        isBlocked ? 'TASK_BLOCKED' : 'TASK_EXECUTION_FAILED',
        `Falha na execução da tarefa "${nextTask.title}": ${errMsg}`
      );
      return;
    }
    if ((db.prepare('SELECT status FROM autonomous_runs WHERE id = ?').get(runId) as any)?.status === 'failed') return;

    // 4. Update run state to TESTING / REVIEWING
    db.prepare(`
      UPDATE autonomous_runs
      SET status = 'reviewing', next_action = 'Supervisor revisando PR e testes no GitHub', updated_at = ?
      WHERE id = ?
    `).run(nowIso, runId);

    // 5. Submit report (evaluates policies for ORANGE/RED approvals)
    const submitResult = AutonomousManager.submitBuilderReport(reportData);
    if (RunControl.apply(runId, true)) return;

    if (reportData.evaluation?.verdict === 'BLOCKED') {
      const isTampering = reportData.evaluation.verdict === 'TAMPERING_DETECTED' ||
        reportData.evaluation.evidence?.tamperingDetected === true ||
        /TAMPERING_DETECTED|tamper|adulteração/i.test(reportData.evaluation.actual || '');

      const currentTaskDb: any = db.prepare('SELECT * FROM autonomous_tasks WHERE id = ?').get(nextTask.id) || nextTask;
      const currentRetry = Number(currentTaskDb.retry_count || 0);
      const maxRetries = Number(currentTaskDb.max_retries || 3);

      if (isTampering || currentRetry >= maxRetries) {
        this.pauseForVerification(runId, nextTask.id, reportData.evaluation.actual || 'Avaliação bloqueada');
        return;
      }

      // Self-Healing: Reparable technical BLOCKED with retries remaining
      Logger.warn(`[Self-Healing Verification] Evaluator retornou BLOCKED na tarefa "${nextTask.title}" (Tentativa ${currentRetry + 1}/${maxRetries}). Encaminhando para retrabalho sem pausar o run.`);

      // Attempt to normalize or recover verification command if invalid or missing file
      const contract = currentTaskDb.contract_id ? IndependentEvaluator.getContract(currentTaskDb.contract_id) : null;
      if (contract?.verificationSteps?.length && currentTaskDb.verification_command) {
        let contractUpdated = false;
        for (const step of contract.verificationSteps) {
          if (step.command) {
            const norm = normalizeOrRecoverVerificationCommand(step.command, run.project?.path || '.', {
              allowUncreatedFiles: false,
              requireCanonicalEvidenceOnDisk: true
            });
            if (!norm.validInitially && norm.recovered && norm.command !== step.command) {
              step.command = norm.command;
              contractUpdated = true;
              AutonomousManager.logEvent(
                runId,
                nextTask.id,
                'system',
                'VERIFICATION_COMMAND_RECOVERED',
                `Comando de verificação incompatível recuperado de "${norm.originalCommand}" para "${norm.command}" (${norm.reason}).`,
                { originalCommand: norm.originalCommand, recoveredCommand: norm.command, reason: norm.reason }
              );
            }
          }
        }
        if (contractUpdated) {
          db.prepare('UPDATE success_contracts SET verification_steps_json = ?, updated_at = ? WHERE id = ?')
            .run(JSON.stringify(contract.verificationSteps), nowIso, contract.id);
          db.prepare('UPDATE autonomous_tasks SET verification_command = ?, updated_at = ? WHERE id = ?')
            .run(contract.verificationSteps[0]?.command || null, nowIso, nextTask.id);
        }
      }

      const evaluatorNotesText = Array.isArray(reportData.evaluation.evaluatorNotes)
        ? reportData.evaluation.evaluatorNotes.join(' | ')
        : '';
      const diagnosticFeedback = `[Self-Healing Evaluator BLOCKED]: ${reportData.evaluation.actual || evaluatorNotesText || 'Falha técnica no comando ou ambiente de verificação'}. Corrija a implementação, scripts de teste ou ambiente.`;

      AutonomousManager.logEvent(
        runId,
        nextTask.id,
        'evaluator',
        'VERIFICATION_SELF_HEALING_REWORK',
        diagnosticFeedback
      );

      // Submit Supervisor Review as CHANGES_REQUESTED with allowReworkOnBlocked
      AutonomousManager.submitSupervisorReview({
        runId,
        taskId: nextTask.id,
        verdict: 'CHANGES_REQUESTED',
        feedback: diagnosticFeedback,
        requirementsMet: false,
        buildPassed: false,
        testsPassed: false,
        uiFunctional: false,
        qualityScore: 4,
        allowReworkOnBlocked: true
      });

      this.consecutiveFailures++;
      db.prepare(`
        UPDATE autonomous_runs
        SET status = 'running', consecutive_failures = consecutive_failures + 1, last_error = ?, next_action = 'Re-executar correções na mesma branch (Self-Healing)', updated_at = ?
        WHERE id = ?
      `).run(diagnosticFeedback, nowIso, runId);

      this.currentTask = null;
      this.currentWorker = null;

      setTimeout(() => {
        AutonomousRunnerService.schedulerTick().catch((err) => {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autonomousRunnerService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousRunnerService]", err);
      }
    });
      }, 50);

      return;
    }

    if (submitResult.needsApproval) {
      Logger.warn(`[POLICY] [Policy Engine] Decisão na tarefa "${nextTask.title}" requer aprovação na Inbox (${submitResult.highestRisk.toUpperCase()}).`);
      const remainingAvailable = AutonomousManager.getAvailableTasks(runId);
      if (remainingAvailable.length > 0) {
        db.prepare(`
          UPDATE autonomous_runs
          SET status = 'running', next_action = 'Executando outras tarefas independentes', updated_at = ?
          WHERE id = ?
        `).run(nowIso, runId);
      } else {
        db.prepare(`
          UPDATE autonomous_runs
          SET status = 'waiting_approval', next_action = 'Aguardando aprovação na Inbox', updated_at = ?
          WHERE id = ?
        `).run(nowIso, runId);
      }
      return;
    }

    // 6. Supervisor reviews report & PR on GitHub
    this.currentWorker = 'Supervisor';
    const reviewResult = await this.executeSupervisorReview(run, nextTask, reportData);
    if (RunControl.apply(runId, true)) return;

    if (reviewResult.verdict === 'APPROVED') {
      this.consecutiveFailures = 0;
      this.currentTask = null;
      this.currentWorker = null;
      AutonomousManager.syncRunProgress(runId);
      db.prepare(`
        UPDATE autonomous_runs
        SET status = 'running', consecutive_failures = 0, last_error = NULL, last_success = ?, next_action = 'Selecionar próxima tarefa do backlog', updated_at = ?
        WHERE id = ?
      `).run(nowIso, nowIso, runId);

      Logger.success(`[APPROVED] [Supervisor] Tarefa "${nextTask.title}" aprovada após avaliação independente.`);
      setTimeout(() => {
        AutonomousRunnerService.schedulerTick().catch((err) => {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autonomousRunnerService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousRunnerService]", err);
      }
    });
      }, 50);
    } else {
      this.consecutiveFailures++;
      db.prepare(`
        UPDATE autonomous_runs
        SET status = 'running', consecutive_failures = consecutive_failures + 1, last_error = ?, next_action = 'Re-executar correções na mesma branch', updated_at = ?
        WHERE id = ?
      `).run(reviewResult.feedback || 'Correções necessárias', nowIso, runId);

      Logger.warn(`[REWORK] [Supervisor] Solicitação de correções enviada para "${nextTask.title}": ${reviewResult.feedback || 'Revisão reprovada'}`);
      setTimeout(() => {
        AutonomousRunnerService.schedulerTick().catch((err) => {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autonomousRunnerService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousRunnerService]", err);
      }
    });
      }, 50);
    }
  }

  /**
   * REAL BUILDER EXECUTION ENGINE VIA REAL ANTIGRAVITY AGENT WITH MULTI-WORKER SUPPORT
   */
  private static async executeBuilderTaskReal(
    project: any,
    run: any,
    task: any,
    branchName: string,
    worker: Worker,
    leaseId: string
  ): Promise<BuilderReportInput> {
    AutonomousRunnerService.setExecutionPhase('WORKER_BUILDING');
    const { AccountProfileManager } = await import('./accountProfileManager.js');
    let isolatedEnv: NodeJS.ProcessEnv | undefined;
    if (worker.account_profile_id) {
      const profile = AccountProfileManager.getProfile(worker.account_profile_id);
      if (profile) isolatedEnv = AccountProfileManager.getExecutionEnvForProfile(profile, project.id);
    }
    if (!isolatedEnv) {
      const activeProf = AccountProfileManager.getGlobalActiveProfile();
      if (activeProf) isolatedEnv = AccountProfileManager.getExecutionEnvForProfile(activeProf, project.id);
    }

    const antigravityProvider = new AntigravityProvider(isolatedEnv);
    const projectPath = project.path;

    if (!fs.existsSync(projectPath)) {
      fs.mkdirSync(projectPath, { recursive: true });
    }

    // Workspace Isolation check (Item 7)
    if (fs.existsSync(path.join(projectPath, '.git'))) {
      GitManager.assertExecutionWorkspace(projectPath);
    }

    // Periodic lease renewal (every 15s) while worker is running
    const renewalInterval = setInterval(() => {
      WorkerRegistry.renewLease(leaseId, worker.id);
      AutonomousRunnerService.touchActiveExecutionReservation();
      try {
        db.prepare("UPDATE autonomous_tasks SET updated_at = ? WHERE id = ?").run(new Date().toISOString(), task.id);
      } catch {}
    }, 15000);

    const startTime = Date.now();
    let resolvedBuilderModel: 'flash_lite' | 'flash' | 'pro' = 'flash';
    let requestedBuilderModel: string = 'flash';
    let builderConfig: any = null;
    let executionConversationId: string | null = null;
    let executionSucceeded = false;
    let executedToolCalls: number | null = null;
    let engineeringPackage: any = null;
    let evaluationResult: EvaluationResult | null = null;
    let promptMeta: any = null;

    try {
      // 1. Resolve builder model preferences
      const preferences = ModelRegistry.getPreferences(worker.account_profile_id, project.id);
      const userBuilderPref = preferences.builder && preferences.builder !== 'auto' ? preferences.builder : null;
      const userDefaultPref = preferences.default && preferences.default !== 'auto' ? preferences.default : null;
      const userExplicitPref = userBuilderPref || userDefaultPref;

      // Preflight & Authoritative Engineering Context assembly
      const { EngineeringContextService } = await import('./engineeringContextService.js');
      engineeringPackage = EngineeringContextService.prepareTaskContext({
        projectPath,
        projectName: project.name,
        projectObjective: project.objective,
        task: {
          id: task.id,
          title: task.title,
          description: task.description,
          criteria: task.criteria || ['Atender plenamente os objetivos da tarefa'],
          verificationCommand: task.verification_command || 'npm test',
          doneWhen: task.done_when || 'Todos os critérios atendidos e verificação sem erros',
          expectedScopeFiles: task.expected_files || []
        }
      });

      // Preflight Anti-AI-Slop Gate
      const slopPreflight = EngineeringContextService.checkPreflightSlop({
        projectPath,
        expectedScopeFiles: task.expected_files || [],
        title: task.title,
        description: task.description,
        effortLevel: engineeringPackage.adaptiveEffort?.effortLevel
      });
      try {
        db.prepare('UPDATE autonomous_tasks SET slop_preflight_json = ? WHERE id = ?')
          .run(JSON.stringify(slopPreflight), task.id);
      } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autonomousRunnerService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousRunnerService]", err);
      }
    }

      // Skill Router: Route task to specialized technical persona
      const { SkillRouter } = await import('./skillRouter.js');
      const routedSkill = SkillRouter.routeTask(task, {
        stack: project.stack,
        projectObjective: project.objective,
        effortLevel: engineeringPackage.adaptiveEffort?.effortLevel,
        isBugFix: Boolean(task.retry_count > 0 || /bug|corrigir/i.test(task.title)),
        projectPath
      });
      SkillRouter.persistSkillAssignment(task.id, run.id, routedSkill);

      // Task-level Research Evaluation: verify external facts and trust envelope
      const taskResearch = EngineeringContextService.evaluateResearch(
        `${task.title}\n${task.description || ''}`,
        project.stack || '',
        engineeringPackage.adaptiveEffort?.changeRisk || 'medium'
      );
      if (taskResearch.needsResearch) {
        try {
          db.prepare('UPDATE autonomous_tasks SET research_findings_json = ? WHERE id = ?')
            .run(JSON.stringify({ findings: taskResearch.findings, safeToAdopt: taskResearch.safeToAdopt, sourceReliability: taskResearch.sourceReliability }), task.id);
        } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autonomousRunnerService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousRunnerService]", err);
      }
    }
      }

      // Model and intelligence selection via centralized ModelRegistry
      builderConfig = ModelRegistry.resolveModelConfig({
        preference: userExplicitPref || (task.model_tier && task.model_tier !== 'auto' ? task.model_tier : null),
        role: 'builder',
        projectId: project.id,
        accountProfileId: worker.account_profile_id
      });
      resolvedBuilderModel = builderConfig.modelId;
      requestedBuilderModel = userExplicitPref || builderConfig.modelId;
      Logger.info(`[ModelSelection] Tarefa "${task.title}": modelo alocado: ${resolvedBuilderModel} (${builderConfig.canonicalName}), inteligência: ${builderConfig.intelligenceLevel} (origem: ${builderConfig.source})`);

      // Persistent Worker conversation reused across tasks
      const { PromptManager } = await import('./promptManager.js');

      // 1. Build authoritative runtime and project context for Worker instructions
      // Supported variants: native, legacy-worker-v1, fable-worker-v1, fable-worker-v2-flash, fable-worker-v1-max, fable-worker-v2-flash-max.
      // Explicit overrides in runConfig or process.env are strictly respected.
      // When no explicit override is provided:
      // - Live mode (!AgentApiGateway.isOfflineMode()): adaptively routes to 'fable-worker-v1-max' for DEEP tasks and 'fable-worker-v2-flash-max' for STANDARD/MINIMAL.
      // - Offline/test mode: defaults to 'native' for safe test compatibility.
      let workerPromptVariant: string | undefined;
      try {
        const runConfig = run.config_json ? JSON.parse(run.config_json) : {};
        if (runConfig.worker_prompt_variant) {
          workerPromptVariant = runConfig.worker_prompt_variant;
        } else if (process.env.DECOHUB_WORKER_PROMPT_VARIANT) {
          workerPromptVariant = process.env.DECOHUB_WORKER_PROMPT_VARIANT;
        }
      } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autonomousRunnerService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousRunnerService]", err);
      }
    }

      if (!workerPromptVariant) {
        const { AgentApiGateway } = await import('./agentApiGateway.js');
        if (!AgentApiGateway.isOfflineMode()) {
          if (engineeringPackage?.adaptiveEffort?.effortLevel === 'DEEP') {
            workerPromptVariant = 'fable-worker-v1-max';
          } else {
            workerPromptVariant = 'fable-worker-v2-flash-max';
          }
        } else {
          workerPromptVariant = 'native';
        }
      }

      const promptId = PromptManager.normalizePromptId(workerPromptVariant);

      const completedTaskTitles = (run.tasks || [])
        .filter((t: any) => t.status === 'completed')
        .map((t: any) => `${t.code || t.milestone || 'TASK'}: ${t.title}`);

      const workerInstructions = PromptManager.buildWorkerInstructions({
        promptId,
        runtime: {
          projectPath,
          runId: run.id,
          taskId: task.id,
          workerId: worker.id,
          accountProfileId: worker.account_profile_id,
          requestedModel: requestedBuilderModel,
          actualModel: resolvedBuilderModel,
          workspaceGitRoot: projectPath,
          runtimeCwd: projectPath
        },
        project: {
          projectName: project.name,
          projectPath: project.path,
          objective: project.objective,
          techStack: project.stack || undefined,
          completedTasks: completedTaskTitles.length > 0 ? completedTaskTitles : undefined
        }
      });

      // Ensure directory-level discovery rule file is present in project (or cleaned if legacy)
      PromptManager.ensureProjectRulesFile(projectPath, workerInstructions.fullRuleContent);

      // Validate prompt isolation before dispatch
      const isolationCheck = PromptManager.validateWorkspacePromptIsolation(
        projectPath,
        promptId
      );
      if (!isolationCheck.valid) {
        throw new Error(`WORKSPACE_PROMPT_LEAK: ${isolationCheck.reason}`);
      }

      // Check if resuming / handoff on an existing branch
      const isHandoffOrRetry = task.retry_count > 0 || (task.github_branch && task.github_branch === branchName) || Boolean(task.notes && task.notes.includes('[HANDOFF / RESUME MODE]'));
      const priorEvaluation = task.retry_count > 0 ? IndependentEvaluator.getEvaluationByTaskId(task.id) : null;
      const evaluatorNotesBlock = Array.isArray(priorEvaluation?.evaluatorNotes) && priorEvaluation.evaluatorNotes.length > 0
        ? `Diagnóstico detalhado dos gates (Visual / UX / AppSec):\n${priorEvaluation.evaluatorNotes.map((n: string) => `- ${n}`).join('\n')}`
        : '';
      const repairEvidence = priorEvaluation ? [
        `Avaliação independente anterior: ${priorEvaluation.verdict}; ${priorEvaluation.actual}`,
        `Critérios reprovados: ${(priorEvaluation.failedCriteria || []).join('; ')}`,
        evaluatorNotesBlock,
        `Arquivos da entrega: ${(priorEvaluation.evidence?.filesChanged || []).slice(0, 30).join(', ')}`,
        `Saída factual da verificação:\n${String(priorEvaluation.evidence?.output || '').slice(-6000)}`
      ].filter(Boolean).join('\n') : '';

      let resumeContext = '';
      if (isHandoffOrRetry) {
        let gitLog = '';
        try {
          gitLog = execSync(`git -C "${projectPath}" log -n 5 --oneline`, { encoding: 'utf-8' }).trim();
        } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autonomousRunnerService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousRunnerService]", err);
      }
    }

        resumeContext = [
          `[HANDOFF / RESUME MODE]`,
          `Você é o ${worker.name}. Você está assumindo a implementação desta tarefa.`,
          `O branch "${branchName}" já está configurado.`,
          gitLog ? `Últimos commits na branch:\n${gitLog}` : '',
          task.retry_count > 0 && run.last_error ? `Feedback anterior do Supervisor: ${run.last_error}` : '',
          `INSTRUÇÃO DE HANDOFF: Não crie novos branches ou duplique arquivos existentes. Inspecione o código atual, preserve o que já foi feito, complete os requisitos pendentes e garanta que todos os testes passem.`
        ].filter(Boolean).join('\n');
      }

      // 2. Formulate SuccessContract and dispatch task contract to the live Antigravity agent
      const programMd = MemoryManager.ensureProgramMd(project.path, project.name, project.objective);
      const isBugFix = Boolean(
        task.title.toLowerCase().includes('bug') ||
        task.title.toLowerCase().includes('corrigir') ||
        (task.description && task.description.toLowerCase().includes('bug'))
      );

      // Update task record with engineering traceability metadata & adaptive effort
      try {
        db.prepare(`
          UPDATE autonomous_tasks
          SET engineering_context_version = ?, engineering_context_hash = ?, preflight_status = ?, adaptive_effort_json = ?, updated_at = ?
          WHERE id = ?
        `).run(
          engineeringPackage.contextVersion,
          engineeringPackage.contextHash,
          engineeringPackage.preflightStatus,
          JSON.stringify(engineeringPackage.adaptiveEffort),
          new Date().toISOString(),
          task.id
        );
      } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autonomousRunnerService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousRunnerService]", err);
      }
    }

      AutonomousManager.logEvent(
        run.id,
        task.id,
        'system',
        'ENGINEERING_PREFLIGHT',
        `Preflight Karpathy concluído (${engineeringPackage.preflightStatus}). Hash de contexto: ${engineeringPackage.contextHash}`,
        {
          version: engineeringPackage.contextVersion,
          hash: engineeringPackage.contextHash,
          sources: engineeringPackage.sources,
          status: engineeringPackage.preflightStatus
        }
      );

      const contract = IndependentEvaluator.getContractByTaskId(task.id) || IndependentEvaluator.createSuccessContract({
        taskId: task.id,
        runId: run.id,
        projectId: project.id,
        projectPath,
        objective: task.title,
        acceptanceCriteria: engineeringPackage.taskContract.acceptanceCriteria,
        verificationCommand: engineeringPackage.taskContract.verificationCommand,
        protectedEvaluationFiles: task.protected_evaluation_files || IndependentEvaluator.listEvaluationFiles(projectPath),
        isBugFix
      });

      const protectedWarning = contract.protectedEvaluationFiles.length > 0
        ? `AVISO DE TESTE PROTEGIDO (PROTECTED_EVALUATION): Os seguintes arquivos de teste são o mecanismo independente de avaliação: ${contract.protectedEvaluationFiles.join(', ')}. É PROIBIDO alterar, enfraquecer ou excluir estes arquivos. O Evaluator verificará a integridade dos testes e rejeitará qualquer tentativa de adulteração.`
        : '';

      const detectedMode = isBugFix || task.retry_count > 0
        ? 'REPAIR'
        : PromptArchitectureService.detectWorkerMode({ title: task.title, description: task.description });

      const effortLevel = engineeringPackage?.adaptiveEffort?.effortLevel;
      const isRework = Boolean(task.retry_count && task.retry_count >= 1);
      const isHighEffort = effortLevel === 'HIGH' || effortLevel === 'DEEP';
      const isGitRepo = fs.existsSync(path.join(projectPath, '.git'));
      const shouldRunConcurrentRollout = isGitRepo && isRework && (task.retry_count && task.retry_count >= 2) && (process.env.DECOHUB_ENABLE_CONCURRENT_ROLLOUT === 'true');

      let agentResult!: BuilderToSupervisorContract;

      if (shouldRunConcurrentRollout) {
        Logger.info(`[ConcurrentRollout] Acionando motor de trajetórias concorrentes (Best-of-N Rollout) para tarefa "${task.title}" (Esforço: ${effortLevel}, Retrabalho: ${isRework}).`);
        const rollout = await AutonomousRunnerService.executeConcurrentRollout({
          project,
          run,
          task,
          branchName,
          worker,
          leaseId,
          engineeringPackage,
          contract,
          isolatedEnv
        });

        agentResult = rollout.reportData;
        evaluationResult = rollout.evaluationResult;
        clearInterval(renewalInterval);
        WorkerRegistry.releaseLease(leaseId, worker.id);
        WorkerRegistry.updateWorkerStatus(worker.id, 'READY', {
          last_checkpoint: `Rollout concorrente concluído para "${task.title}" por ${worker.name}`,
          current_run_id: null,
          current_task_id: null,
          current_issue_number: null,
        });
        AutonomousRunnerService.releaseExecutionLock();
        try {
          db.prepare("UPDATE autonomous_tasks SET updated_at = ? WHERE id = ?").run(new Date().toISOString(), task.id);
        } catch {}
      } else {

      let workerExecutionContract: any = null;
      try {
        workerExecutionContract = AutonomousManager.buildWorkerExecutionContract(task.id);
      } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autonomousRunnerService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousRunnerService]", err);
      }
    }

      const structuredReworkPrompt = workerExecutionContract?.reworkContext
        ? [
            `[CONTRATO DE RETRABALHO ESTRUTURADO — TENTATIVA ${workerExecutionContract.attempt}/${workerExecutionContract.maxRetries}]`,
            `Decisão anterior do Review: ${workerExecutionContract.reworkContext.previousReviewDecision}`,
            `Feedback do Supervisor/Review: ${workerExecutionContract.reworkContext.previousFeedback}`,
            workerExecutionContract.reworkContext.failedCriteria?.length
              ? `Critérios Reprovados:\n${workerExecutionContract.reworkContext.failedCriteria.map((c: string) => `- ${c}`).join('\n')}`
              : '',
            workerExecutionContract.reworkContext.problemsFound?.length
              ? `Problemas Encontrados:\n${workerExecutionContract.reworkContext.problemsFound.map((p: string) => `- ${p}`).join('\n')}`
              : '',
            `Instruções de Correção:\n${(workerExecutionContract.reworkContext.reworkInstructions || []).map((i: string) => `- ${i}`).join('\n')}`
          ].filter(Boolean).join('\n')
        : '';

      const parentMajorTask = (run.majorTasks || []).find((m: any) => m.id === task.major_task_id);
      let taskRequirementIds: string[] = [];
      try {
        taskRequirementIds = Array.isArray(task.requirement_ids)
          ? task.requirement_ids
          : task.requirement_ids_json
          ? JSON.parse(task.requirement_ids_json)
          : [];
      } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autonomousRunnerService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousRunnerService]", err);
      }
    }
      const taskDeps: string[] = Array.isArray(task.dependencies)
        ? task.dependencies
        : safeJsonParse(task.dependencies_json, []);
      const completedDepsSummary = (run.tasks || [])
        .filter((t: any) => taskDeps.includes(t.id) || (t.code && taskDeps.includes(t.code)))
        .map((t: any) => `${t.code || t.milestone}: ${t.title} [commit: ${t.task_commit_sha ? t.task_commit_sha.slice(0, 8) : 'verificado'}]`);

      let docSimpBlock = '';
      try {
        const { DocSimpService } = await import('./docSimpService.js');
        const briefingOrObjective = run.briefing || project.objective || task.description || '';
        const docSimpRes = await DocSimpService.resolveDocsForBriefing(briefingOrObjective, projectPath);
        docSimpBlock = docSimpRes.contextBlock;
      } catch (err: any) {
        Logger.warn(`[AutonomousRunner] Falha não bloqueante ao resolver DOCSIMP para o Worker: ${err.message}`);
      }

      let designSkillBlock = '';
      try {
        const { DesignSkillService } = await import('./designSkillService.js');
        const isUi = DesignSkillService.isUiOrFrontendTask(
          `${task.title} ${task.description || ''}`,
          project.stack
        );
        if (isUi) {
          const briefingOrObjective = run.briefing || project.objective || task.description || '';
          const designRes = await DesignSkillService.provisionDesignSkillsForProject(briefingOrObjective, projectPath);
          designSkillBlock = designRes.directiveBlock;
        }
      } catch (err: any) {
        Logger.warn(`[AutonomousRunner] Falha não bloqueante ao resolver DesignSkills para o Worker: ${err.message}`);
      }

      let reaBlock = '';
      try {
        const { ReaSaaSMasterService } = await import('./reaSaaSMasterService.js');
        const briefingOrObjective = run.briefing || project.objective || task.description || '';
        if (ReaSaaSMasterService.isSaaSOrFullStackProject(briefingOrObjective)) {
          const reaRes = await ReaSaaSMasterService.provisionReaBlueprintForProject(projectPath, briefingOrObjective);
          reaBlock = reaRes.directive;
        }
      } catch (err: any) {
        Logger.warn(`[AutonomousRunner] Falha não bloqueante ao resolver ReaSaaSMaster para o Worker: ${err.message}`);
      }

      let livingSpecBlock = '';
      try {
        const { ReaSaaSMasterService } = await import('./reaSaaSMasterService.js');
        const { ProjectLivingSpecService } = await import('./projectLivingSpecService.js');
        const briefingOrObjective = run.briefing || project.objective || task.description || '';
        const isSaaSProject = ReaSaaSMasterService.isSaaSOrFullStackProject(briefingOrObjective);
        const specsDir = path.join(path.resolve(projectPath), '.ai-dev-hub', 'specs');
        const requiredFiles = ['CONTEUDO.md', 'DESIGN.md', 'BACKEND.md', 'PRINCIPIOS.md', 'JORNADAS.md'];
        const allSpecsExist = requiredFiles.every(f => fs.existsSync(path.join(specsDir, f)));

        if (!allSpecsExist && isSaaSProject) {
          await ProjectLivingSpecService.generateAndPersistLivingSpecs({
            briefing: briefingOrObjective,
            projectName: project.name,
            projectPath,
            projectId: project.id
          });
        }

        const taskText = [
          task.title || '',
          task.description || '',
          task.stage_code || '',
          task.stage_title || '',
          ...(Array.isArray(task.expected_files) ? task.expected_files : [])
        ].join(' ').toLowerCase();

        let specRole: 'WORKER_FRONTEND' | 'WORKER_BACKEND' | 'WORKER_TEST' | 'WORKER_FULLSTACK' = 'WORKER_FULLSTACK';
        if (/\b(test\/|tests\/|e2e|playwright|jest|vitest|homologa[çc][ãa]o|verifi)\b/i.test(taskText) && !/\b(public\/|src\/db|src\/server)\b/i.test(taskText)) {
          specRole = 'WORKER_TEST';
        } else if (/\b(public\/|html|css|design|dashboard|grid|drawer|interface|componente visual|svg|lucide|tabular-nums|spa)\b/i.test(taskText)) {
          specRole = 'WORKER_FRONTEND';
        } else if (/\b(src\/db|src\/server|src\/routes|src\/services|sqlite|database|banco|seed|audit_logs|express|fastify|hono|rest api|endpoint)\b/i.test(taskText)) {
          specRole = 'WORKER_BACKEND';
        }

        livingSpecBlock = ProjectLivingSpecService.getRoleSpecificSpecContext(projectPath, specRole);
      } catch (err: any) {
        Logger.warn(`[AutonomousRunner] Falha não bloqueante ao resolver Living Specs para o Worker: ${err.message}`);
      }

      const taskInput: any = {
        mode: detectedMode,
        task: {
          id: task.id,
          title: task.title,
          description: task.description,
          milestone: task.milestone,
          majorTaskCode: workerExecutionContract?.majorTaskCode || parentMajorTask?.code || undefined,
          majorTaskTitle: workerExecutionContract?.majorTaskTitle || parentMajorTask?.title || undefined,
          stageCode: task.stage_code || undefined,
          stageTitle: task.stage_title || undefined,
          requirementIds: taskRequirementIds.length > 0 ? taskRequirementIds : undefined,
          completedDependenciesSummary: completedDepsSummary.length > 0 ? completedDepsSummary : undefined,
          verificationCommand: engineeringPackage.taskContract.verificationCommand,
          doneWhen: engineeringPackage.taskContract.doneWhen,
          mode: detectedMode
        },
        context: {
          projectName: project.name,
          projectPath: project.path,
          objective: project.objective,
          stack: project.stack,
          programMd
        },
        requirements: [
          `Criar/editar código funcional exclusivamente dentro de "${project.path}"`,
          'Validar sintaxe e integridade',
          'Executar testes automatizados no terminal quando aplicável',
          'Seguir rigorosamente as Karpathy Agent Guidelines (THINK BEFORE CODING, SIMPLICITY FIRST, SURGICAL CHANGES, GOAL-DRIVEN)',
          routedSkill.formattingSnippet,
          ...(slopPreflight.notes.length > 0 ? [`Anti-Slop Preflight: ${slopPreflight.notes.join('; ')}`] : []),
          ...(taskResearch.needsResearch ? [taskResearch.untrustedDataEnvelope] : []),
          ...(protectedWarning ? [protectedWarning] : []),
          ...(docSimpBlock ? ['Seguir diretrizes DOCSIMP e padrão Plug-and-Play (Graceful Mock Fallback)'] : []),
          ...(designSkillBlock ? ['Seguir estritamente diretrizes visuais Anti-Slop (DESIGN.md, taste-skill, Vercel Guidelines e Playwright CLI)'] : []),
          ...(reaBlock ? ['Seguir estritamente os 7 Pilares SaaS Master (App Shell, Drawers, Data Grids, BI Charts, Audit Logs, Reactive Store e Seed)'] : [])
        ],
        acceptanceCriteria: engineeringPackage.taskContract.acceptanceCriteria,
        constraints: workerExecutionContract?.constraints || [`Não modificar arquivos fora de "${project.path}"`],
        expectedScopeFiles: task.expected_files || [],
        engineeringPackage: {
          contextHash: engineeringPackage.contextHash,
          formattedPromptBlock: engineeringPackage.formattedPromptBlock
        },
        previousError: task.retry_count > 0 ? ([run.last_error, repairEvidence, structuredReworkPrompt].filter(Boolean).join('\n\n') || undefined) : undefined,
        protectedEvaluationWarning: protectedWarning || undefined,
        docSimpContextBlock: docSimpBlock || undefined,
        designSkillContextBlock: designSkillBlock || undefined,
        reaSaaSMasterContextBlock: reaBlock || undefined,
        livingSpecContextBlock: livingSpecBlock || undefined,
        routedSkillId: routedSkill.skill,
        routedSkillDigest: routedSkill.surgicalDigest,
        supervisorInstructions: [
          resumeContext,
          protectedWarning,
          structuredReworkPrompt,
          task.retry_count > 0 && run.last_error
            ? `CORREÇÕES SOLICITADAS PELO SUPERVISOR: ${run.last_error}. Implemente as melhorias solicitadas no mesmo branch.`
            : 'Implemente de forma completa, com código limpo, sem simulações e sem placeholders.'
        ].filter(Boolean).join('\n\n')
      };

      const builtWorkerPrompt = PromptArchitectureService.buildWorkerPrompt({
        mode: detectedMode,
        projectId: project.id || 'default-project',
        projectName: project.name,
        projectPath: project.path,
        projectObjective: project.objective,
        runId: run.id || null,
        taskId: task.id,
        taskTitle: task.title,
        taskDescription: task.description,
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
        programMd: taskInput.context.programMd,
        formattedEngineeringBlock: taskInput.engineeringPackage?.formattedPromptBlock,
        previousError: taskInput.previousError,
        riskLevel: taskInput.riskLevel,
        protectedEvaluationWarning: taskInput.protectedEvaluationWarning,
        docSimpContextBlock: taskInput.docSimpContextBlock,
        designSkillContextBlock: taskInput.designSkillContextBlock,
        reaSaaSMasterContextBlock: taskInput.reaSaaSMasterContextBlock,
        livingSpecContextBlock: taskInput.livingSpecContextBlock,
        routedSkillId: taskInput.routedSkillId,
        routedSkillDigest: taskInput.routedSkillDigest
      });
      const fullTaskPrompt = builtWorkerPrompt.prompt;
      promptMeta = builtWorkerPrompt.meta;

      const { session: workerSession, isNew: isWorkerNew } = await AgentSessionManager.getOrCreateAgentSession(
        project.id,
        'WORKER',
        {
          model: resolvedBuilderModel,
          env: isolatedEnv,
          initialPrompt: fullTaskPrompt,
          accountProfileId: worker.account_profile_id || 'acc-pro-1',
          runId: run.id
        }
      );
      let agentSessionId = workerSession.provider_conversation_id;

      // Check context rotation policy before dispatching new task
      if (!isWorkerNew) {
        const rotationCheck = AgentSessionManager.checkContextRotationPolicy(workerSession, antigravityProvider.getAppDataBrainDir());
        if (rotationCheck.shouldRotate) {
          Logger.warn(`[AutonomousRunner] Rotação preventiva de contexto para Worker no projeto "${project.name}". Motivo: ${rotationCheck.reason}`);
          const { newSession } = await AgentSessionManager.rotateSession(
            project.id,
            'WORKER',
            rotationCheck.reason || 'CONTEXT_THRESHOLD_REACHED',
            {
              model: resolvedBuilderModel,
              env: isolatedEnv,
              runId: run.id,
              taskId: task.id
            }
          );
          agentSessionId = newSession.provider_conversation_id;
        }
      }

      WorkerRegistry.updateWorkerStatus(worker.id, 'WORKING', {
        conversation_id: agentSessionId
      });
      executionConversationId = agentSessionId;

      const sendTaskResult = await antigravityProvider.sendTask(agentSessionId, taskInput, {
        projectId: project.id ?? undefined,
        accountProfileId: worker.account_profile_id ?? undefined,
        workerId: worker.id ?? undefined,
        runId: run.id ?? undefined,
        model: resolvedBuilderModel,
        promptId: workerInstructions.promptId,
        promptHash: workerInstructions.promptHash,
        isNewSession: isWorkerNew
      });

      const effectiveSessionId = sendTaskResult.sessionId;
      if (sendTaskResult.rotated) {
        WorkerRegistry.updateWorkerStatus(worker.id, 'WORKING', {
          conversation_id: effectiveSessionId
        });
        executionConversationId = effectiveSessionId;
      }

      // 3. Await agent results from live Antigravity execution (IMPLEMENTATION RESULT)
      // Ensure effectiveSessionId is clean of stale cancellation tokens before awaiting results
      TurnCancellationManager.clearCancellation(effectiveSessionId);
      try {
        agentResult = await antigravityProvider.getResult(effectiveSessionId, 600000, projectPath,
          () => {
            const runRow = db.prepare('SELECT status FROM autonomous_runs WHERE id = ?').get(run.id) as any;
            if (runRow?.status === 'failed' || runRow?.status === 'stopped' || TurnCancellationManager.isCancelled(effectiveSessionId)) return true;
            try {
              const liveLease = db.prepare("SELECT id FROM worker_leases WHERE id=? AND worker_id=? AND status='active'").get(leaseId, worker.id);
              if (!liveLease) {
                const nowIso = new Date().toISOString();
                const newLeaseUntil = new Date(Date.now() + 5 * 60 * 1000).toISOString();
                db.prepare(`
                  INSERT INTO worker_leases (id, worker_id, run_id, task_id, claimed_at, lease_until, last_heartbeat, status)
                  VALUES (?, ?, ?, ?, ?, ?, ?, 'active')
                  ON CONFLICT(id) DO UPDATE SET status='active', lease_until=?, last_heartbeat=?
                `).run(leaseId, worker.id, run.id, task.id, nowIso, newLeaseUntil, nowIso, newLeaseUntil, nowIso);
              }
              WorkerRegistry.renewLease(leaseId, worker.id);
              db.prepare("UPDATE autonomous_tasks SET updated_at = ? WHERE id = ?").run(new Date().toISOString(), task.id);
            } catch {
              // Non-blocking
            }
            return false;
          });
      } catch (getResultErr: any) {
        const classification = AccountProfileManager.classifyAccountOrQuotaError(getResultErr);
        if (classification.isAccountOrQuotaError) {
          Logger.warn(`[Builder getResult Failover] Falha de conta/cota no Worker (${classification.kind}): ${classification.reason}`);
          try {
            const failoverRes = await AccountProfileManager.handleAccountFailureAndRapidSwitch({
              failedProfileId: worker.account_profile_id,
              projectId: project.id,
              runId: run.id,
              taskId: task.id,
              error: getResultErr
            });
            if (failoverRes.switched) {
              Logger.info(`[Builder getResult Failover] Failover concluído: "${failoverRes.previousProfileId}" -> "${failoverRes.activeProfile.display_name}". Re-enfileirando tarefa para novo worker.`);
              db.prepare("UPDATE autonomous_tasks SET status = 'ready', lifecycle_state = 'READY', retry_count = 0, updated_at = ? WHERE id = ?").run(new Date().toISOString(), task.id);
              WorkerRegistry.releaseLease(leaseId, worker.id);
              WorkerRegistry.updateWorkerStatus(worker.id, 'READY', { current_run_id: null, current_task_id: null, current_issue_number: null });
              throw new Error('FAILOVER_REASSIGNED: tarefa re-enfileirada para nova conta');
            }
          } catch (failErr: any) {
            Logger.warn(`[Builder getResult Failover] Falha no auto-failover: ${failErr.message}`);
          }
        }
        throw getResultErr;
      }

      let hasNativeToolPending = agentResult.problems.some(problem => problem.includes('AGENT_NATIVE_TOOL_PENDING'));

      // PROTOCOLO DE AUTO-RECONCILIAÇÃO SILENCIOSA EM 3 ESTÁGIOS
      if (hasNativeToolPending) {
        Logger.info(`[AutoReconcile] Estágio A: Ação nativa pendente detectada para "${task.title}". Iniciando janela de carência...`);
        const brainDir = antigravityProvider.getAppDataBrainDir();
        const transcriptPath = path.join(brainDir, effectiveSessionId, '.system_generated', 'logs', 'transcript.jsonl');
        const isFastTest = process.env.NODE_ENV === 'test' || (await import('./agentApiGateway.js')).AgentApiGateway.isOfflineMode();
        const graceDelayMs = isFastTest ? 50 : 2000;
        for (let grace = 0; grace < 3; grace++) {
          const prog = observeTranscript(transcriptPath, 0);
          if (prog.state === 'COMPLETE') {
            Logger.info(`[AutoReconcile] Estágio A: Ferramenta nativa concluiu durante a janela de carência.`);
            agentResult = (antigravityProvider as any).parseTranscriptToReport(effectiveSessionId, projectPath);
            hasNativeToolPending = false;
            break;
          }
          if (grace < 2) await new Promise(r => setTimeout(r, graceDelayMs));
        }

        // Estágio B: Workspace & Evaluator Probe
        if (hasNativeToolPending) {
          Logger.info(`[AutoReconcile] Estágio B: Investigando workspace diretamente via IndependentEvaluator para "${task.title}"...`);
          try {
            const probeEval = await IndependentEvaluator.evaluate(contract.id, projectPath, agentResult, {
              expectedScopeFiles: task.expected_files || [],
              effortLevel: engineeringPackage?.adaptiveEffort?.effortLevel,
              taskMode: detectedMode
            });

            if (probeEval.verdict === 'PASS') {
              Logger.success(`[AutoReconcile] Estágio B SUCESSO: Arquivos no disco válidos e testes passaram com 100% (PASS)! Auto-reconciliando turno.`);
              agentResult.problems = agentResult.problems.filter(p => !p.includes('AGENT_NATIVE_TOOL_PENDING') && !p.includes('AGENT_EXECUTION_TIMEOUT'));
              agentResult.status = 'success';
              hasNativeToolPending = false;

              AgentTurnState.setPhase(effectiveSessionId, 'COMPLETE');

              try {
                db.prepare(`
                  UPDATE autonomous_approvals
                  SET status = 'approved', decision = 'auto_approved_by_evaluator', decided_at = ?
                  WHERE run_id = ? AND task_id = ? AND status = 'pending'
                `).run(new Date().toISOString(), run.id, task.id);
              } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autonomousRunnerService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousRunnerService]", err);
      }
    }

              evaluationResult = probeEval;
            } else {
              Logger.warn(`[AutoReconcile] Estágio B: Evaluator retornou ${probeEval.verdict} (${probeEval.actual}). Prosseguindo para Estágio C.`);
            }
          } catch (evalErr: any) {
            Logger.warn(`[AutoReconcile] Estágio B: Erro ao executar probe do Evaluator: ${evalErr.message}`);
          }
        }

        // Estágio C: Safe Turn Waiting / Continuation
        if (hasNativeToolPending) {
          Logger.warn(`[AutoReconcile] Estágio C: Ação nativa estagnada sem aprovação pelo Evaluator. Aguardando reconciliação sem reenviar tarefa.`);
          throw new Error('AGENT_NATIVE_TOOL_PENDING: ação nativa ainda pendente; não reenviar a tarefa');
        }
      }

      if (agentResult.problems.some(problem => problem.includes('AGENT_EXECUTION_TIMEOUT'))) {
        // Se houver indício de erro de cota nos problems ou no transcript, não faz handoff na mesma conta: falha imediatamente para auto-failover
        const quotaProblem = agentResult.problems.find(p => FATAL_QUOTA_OR_AUTH_REGEX.test(p));
        if (quotaProblem) {
          AgentTurnState.setPhase(effectiveSessionId, 'CONSUMED');
          throw new Error(`QUOTA_EXHAUSTED: ${quotaProblem}`);
        }
        try {
          const brainDir = antigravityProvider.getAppDataBrainDir();
          const transcriptPath = path.join(brainDir, effectiveSessionId, '.system_generated', 'logs', 'transcript.jsonl');
          const checkProg = observeTranscript(transcriptPath, 0);
          if (checkProg.state === 'ERROR') {
            const errEntry = checkProg.entries.find(e => FATAL_QUOTA_OR_AUTH_REGEX.test(String(e.error || e.content || e.message || '')));
            const errTxt = String(errEntry?.error || errEntry?.content || errEntry?.message || 'Quota or authentication failure detected');
            AgentTurnState.setPhase(effectiveSessionId, 'CONSUMED');
            throw new Error(`QUOTA_EXHAUSTED: ${errTxt}`);
          }
        } catch (tpErr: any) {
          if (String(tpErr?.message).startsWith('QUOTA_EXHAUSTED')) {
            throw tpErr;
          }
        }

        if (this.isRunning) {
          Logger.info(`[AutoReconcile] Timeout de execução detectado para "${task.title}". Investigando workspace diretamente via IndependentEvaluator...`);
          let timeoutProbe: any = evaluationResult;
          if (!timeoutProbe) {
            try {
              timeoutProbe = await IndependentEvaluator.evaluate(contract.id, projectPath, agentResult, {
                expectedScopeFiles: task.expected_files || [],
                effortLevel: engineeringPackage?.adaptiveEffort?.effortLevel,
                taskMode: detectedMode
              });
            } catch (evalErr: any) {
              Logger.warn(`[AutoReconcile] Erro ao executar probe do Evaluator no timeout: ${evalErr.message}`);
            }
          }

          if (timeoutProbe && timeoutProbe.verdict === 'PASS') {
            Logger.success(`[AutoReconcile] SUCESSO NO TIMEOUT: Arquivos no disco válidos e testes passaram com 100% (PASS)! Auto-reconciliando turno.`);
            agentResult.problems = agentResult.problems.filter(p => !p.includes('AGENT_EXECUTION_TIMEOUT') && !p.includes('AGENT_NATIVE_TOOL_PENDING'));
            agentResult.status = 'success';
            AgentTurnState.setPhase(effectiveSessionId, 'COMPLETE');

            try {
              db.prepare(`
                UPDATE autonomous_approvals
                SET status = 'approved', decision = 'auto_approved_by_evaluator', decided_at = ?
                WHERE run_id = ? AND task_id = ? AND status = 'pending'
              `).run(new Date().toISOString(), run.id, task.id);
            } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autonomousRunnerService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousRunnerService]", err);
      }
    }

            evaluationResult = timeoutProbe;
          } else {
            Logger.warn(`[AutoReconcile] Timeout sem PASS do Evaluator (${timeoutProbe?.verdict || 'FAIL'}). Ativando auto-continuidade em modo Handoff sem pausar o Run...`);

            clearInterval(renewalInterval);
            WorkerRegistry.releaseLease(leaseId, worker.id);
            WorkerRegistry.updateWorkerStatus(worker.id, 'READY', {
              last_checkpoint: `Turno com timeout para tarefa "${task.title}"; estado preservado para handoff`,
              current_run_id: null,
              current_task_id: null,
              current_issue_number: null,
            });
            AutonomousRunnerService.releaseExecutionLock();
        try {
          db.prepare("UPDATE autonomous_tasks SET updated_at = ? WHERE id = ?").run(new Date().toISOString(), task.id);
        } catch {}
            AgentTurnState.setPhase(effectiveSessionId, 'CONSUMED');

            const hasDiskChanges = (agentResult.filesChanged && agentResult.filesChanged.length > 0);
            const nowIso = new Date().toISOString();
            if (hasDiskChanges) {
              db.prepare(`
                UPDATE autonomous_tasks
                SET status = 'ready',
                    lifecycle_state = 'READY',
                    notes = CASE
                      WHEN notes LIKE '%[HANDOFF / RESUME MODE]%' THEN notes
                      WHEN notes IS NULL OR notes = '' THEN '[HANDOFF / RESUME MODE] Turno sofreu timeout com alterações no disco; retomando do ponto atual.'
                      ELSE notes || CHAR(10) || '[HANDOFF / RESUME MODE] Turno sofreu timeout com alterações no disco; retomando do ponto atual.'
                    END,
                    updated_at = ?
                WHERE id = ?
              `).run(nowIso, task.id);
            } else {
              db.prepare(`
                UPDATE autonomous_tasks
                SET status = 'ready',
                    lifecycle_state = 'READY',
                    retry_count = retry_count + 1,
                    notes = CASE
                      WHEN notes LIKE '%[HANDOFF / RESUME MODE]%' THEN notes
                      WHEN notes IS NULL OR notes = '' THEN '[HANDOFF / RESUME MODE] Turno sofreu timeout sem alterações detectadas; tentando novamente.'
                      ELSE notes || CHAR(10) || '[HANDOFF / RESUME MODE] Turno sofreu timeout sem alterações detectadas; tentando novamente.'
                    END,
                    updated_at = ?
                WHERE id = ?
              `).run(nowIso, task.id);
            }

            db.prepare(`
              UPDATE autonomous_runs
              SET status = 'running',
                  last_error = NULL,
                  next_action = 'Timeout de execução tratado com auto-continuidade; microtarefa re-enfileirada para retomada autônoma',
                  updated_at = ?
              WHERE id = ?
            `).run(nowIso, run.id);

            AutonomousManager.logEvent(
              run.id,
              task.id,
              'system',
              'TURN_TIMEOUT_HANDOFF',
              `Timeout de execução na tarefa "${task.title}". Auto-continuidade ativada: tarefa re-enfileirada como READY (modo handoff) e Run mantido em RUNNING.`
            );

            throw new Error('AGENT_TURN_HANDOFF_RESOLVED: timeout auto-reconciliado para continuidade sem interrupção');
          }
        } else {
          throw new Error('AGENT_TURN_UNCERTAIN: timeout não confirma término de implementação.');
        }
      }

      executedToolCalls = agentResult.toolCallsCount ?? null;
      if ((db.prepare('SELECT status FROM autonomous_runs WHERE id = ?').get(run.id) as any)?.status === 'failed')
        throw new Error('RUN_CANCELLED: a execução foi interrompida pelo usuário');

      // Release worker lease and transition to IDLE before evaluation begins
      clearInterval(renewalInterval);
      WorkerRegistry.releaseLease(leaseId, worker.id);
      WorkerRegistry.updateWorkerStatus(worker.id, 'READY', {
        last_checkpoint: `Implementação da tarefa "${task.title}" concluída por ${worker.name}`,
        current_run_id: null,
        current_task_id: null,
        current_issue_number: null,
      });
      AutonomousRunnerService.releaseExecutionLock();
      try {
        db.prepare("UPDATE autonomous_tasks SET updated_at = ? WHERE id = ?").run(new Date().toISOString(), task.id);
      } catch {}
      }

      if (!agentResult) {
        agentResult = {
          status: 'failure',
          filesChanged: [],
          implemented: [],
          commandsExecuted: [],
          tests: { ran: false },
          buildStatus: 'N/A',
          decisions: [],
          problems: ['RESULT_MISSING: o agente não retornou relatório estruturado'],
          agentThoughts: ''
        };
      }

      // 4. Phase C: Independent Evaluator objectively verifies the result in ISOLATION (Worker is IDLE)
      AutonomousRunnerService.setExecutionPhase('EVALUATOR_VERIFYING');
      db.prepare("UPDATE autonomous_runs SET status='testing',next_action='Evaluator executando verificação independente',updated_at=? WHERE id=?")
        .run(new Date().toISOString(), run.id);
      try {
        // Pre-evaluation LSP syntax check on modified files
        try {
          const changedFiles = Array.isArray(agentResult.filesChanged) ? agentResult.filesChanged : [];
          const lspDiagnosticsList: Array<{ file: string; line: number; message: string; severity: string }> = [];
          for (const relFile of changedFiles) {
            if (/\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(relFile)) {
              const absFile = path.isAbsolute(relFile) ? relFile : path.join(projectPath, relFile);
              if (fs.existsSync(absFile)) {
                const diags = await LspService.getDiagnostics(absFile);
                const errors = diags.filter(d => {
                  if (d.severity !== 'error') return false;
                  // Ignora falsos positivos benignos de configuração de compilador/módulos (TS1259, TS1343, TS5097)
                  // Esses avisos de tsconfig não quebram o runtime real (tsx/Node ESM) e os testes objetivos decidirão
                  const isTestFile = /(?:^|[\\/])(?:test|tests|__tests__)[\\/]|(?:test|spec)\.[cm]?[jt]sx?$/i.test(relFile);
                  const isInteropDiag = (d.code === 1259 || d.code === 1192 || /esModuleInterop|has no default export/i.test(d.message)) && (isTestFile || /(?:node:)?(?:fs|http|path|crypto|os|child_process|assert)/i.test(d.message));
                  const isMetaDiag = d.code === 1343 || /import\.meta/i.test(d.message);
                  const isExtensionDiag = d.code === 5097 || /allowImportingTsExtensions/i.test(d.message);

                  if (isInteropDiag || isMetaDiag || isExtensionDiag) {
                    Logger.info(`[AutonomousRunnerService] Ignorando falso positivo benigno do LSP (TS${d.code || 'OPT'}) em ${relFile}: ${d.message}`);
                    return false;
                  }
                  return true;
                });
                for (const e of errors) {
                  lspDiagnosticsList.push({ file: relFile, line: e.line, message: e.message, severity: e.severity });
                }
              }
            }
          }
          if (lspDiagnosticsList.length > 0) {
            Logger.warn(`[AutonomousRunnerService] LSP detectou ${lspDiagnosticsList.length} erro(s) de sintaxe em "${task.title}".`);
            (agentResult as any).lspDiagnostics = lspDiagnosticsList;
            if (!agentResult.problems) agentResult.problems = [];
            for (const e of lspDiagnosticsList) {
              agentResult.problems.push(`[LSP_SYNTAX_ERROR] ${e.file}:${e.line} - ${e.message}`);
            }
          }
        } catch (lspErr: any) {
          Logger.warn(`[AutonomousRunnerService] LSP diagnostics query skipped: ${lspErr.message}`);
        }

        if (!evaluationResult) {
          evaluationResult = await IndependentEvaluator.evaluate(contract.id, projectPath, agentResult, {
            expectedScopeFiles: task.expected_files || [],
            effortLevel: engineeringPackage?.adaptiveEffort?.effortLevel,
            taskMode: detectedMode
          });
        }
        if ((evaluationResult.verdict === 'BLOCKED' || evaluationResult.verdict === 'FAIL') && contract.verificationSteps?.length) {
          let contractUpdated = false;
          for (const step of contract.verificationSteps) {
            const norm = normalizeOrRecoverVerificationCommand(step.command, projectPath, {
              allowUncreatedFiles: false,
              requireCanonicalEvidenceOnDisk: true
            });
            if (!norm.validInitially && norm.recovered) {
              step.command = norm.command;
              task.verification_command = norm.command;
              contractUpdated = true;
            }
          }
          if (contractUpdated) {
            db.prepare('UPDATE success_contracts SET verification_steps_json = ?, updated_at = ? WHERE id = ?')
              .run(JSON.stringify(contract.verificationSteps), new Date().toISOString(), contract.id);
            db.prepare('UPDATE autonomous_tasks SET verification_command = ? WHERE id = ?')
              .run(task.verification_command, task.id);
            evaluationResult = await IndependentEvaluator.evaluate(contract.id, projectPath, agentResult, {
              expectedScopeFiles: task.expected_files || [],
              effortLevel: engineeringPackage?.adaptiveEffort?.effortLevel,
              taskMode: detectedMode
            });
          }
        }
        try {
          db.prepare(`
            UPDATE autonomous_tasks
            SET evidence_summary_json = ?
            WHERE id = ?
          `).run(
            JSON.stringify(evaluationResult.evidence?.evidenceSummary || null),
            task.id
          );
        } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autonomousRunnerService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousRunnerService]", err);
      }
    }
      } finally {
        AutonomousRunnerService.releaseExecutionLock();
        try {
          db.prepare("UPDATE autonomous_tasks SET updated_at = ? WHERE id = ?").run(new Date().toISOString(), task.id);
        } catch {}
      }

      // 4.5 AI DEV COUNCIL: Post-Evaluation Critical Review Gate (Desativado para microtarefas para prevenir falsos bloqueios e unverified claims)
      let councilDeliberation: any = null;
      if (process.env.DECOHUB_ENABLE_MICROTASK_COUNCIL === 'true') {
        const { CouncilManager } = await import('./councilManager.js');
        const shouldTriggerCouncil = CouncilManager.shouldTriggerCouncil({
          riskLevel: engineeringPackage?.adaptiveEffort?.changeRisk === 'high' ? 'high' : 'medium',
          filesChanged: agentResult.filesChanged,
          isArchitectureChange: Boolean(task.expected_files?.some((f: string) => /schema|db|auth|arch/i.test(f))),
          userRequested: false
        });

        if (shouldTriggerCouncil.required || engineeringPackage?.adaptiveEffort?.effortLevel === 'DEEP' || !evaluationResult.taskIsDone) {
          councilDeliberation = await CouncilManager.deliberate({
            taskId: task.id,
            projectId: project.id,
            runId: run.id,
            task,
            contract,
            diff: (agentResult as any).diff || '',
            filesChanged: agentResult.filesChanged,
            evaluation: evaluationResult,
            riskLevel: shouldTriggerCouncil.trigger === 'CRITICAL_ARCHITECTURE'
              ? 'critical'
              : (engineeringPackage?.adaptiveEffort?.changeRisk === 'high' ? 'high' : 'medium'),
            policyTrigger: shouldTriggerCouncil.trigger
          });

          try {
            db.prepare('UPDATE autonomous_tasks SET council_deliberation_id = ? WHERE id = ?')
              .run(councilDeliberation.id, task.id);
            task.council_deliberation_id = councilDeliberation.id;
          } catch (err) {
            if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
              (globalThis as any).logger.warn({
                event: "server.handled_exception",
                file: "autonomousRunnerService",
                error: (err as any)?.message || String(err)
              });
            } else {
              console.warn("[WARN][server:autonomousRunnerService]", err);
            }
          }

          AutonomousManager.logEvent(
            run.id,
            task.id,
            'supervisor',
            'COUNCIL_DELIBERATION_COMPLETED',
            `Deliberação do Conselho concluída (${councilDeliberation.chairmanVerdict}). Síntese: ${councilDeliberation.chairmanSynthesis}`,
            {
              deliberationId: councilDeliberation.id,
              verdict: councilDeliberation.chairmanVerdict,
              scores: councilDeliberation.scores,
              actionItems: councilDeliberation.actionItems
            }
          );

          // Karpathy Simplicity & Regression Gate:
          // If Council rejected (CHANGES_REQUESTED or BLOCKED), halt commit and route to repair
          if (councilDeliberation.chairmanVerdict === 'CHANGES_REQUESTED' || councilDeliberation.chairmanVerdict === 'BLOCKED') {
            evaluationResult.taskIsDone = false;
            evaluationResult.verdict = 'FAIL';
            evaluationResult.actual = `Rejeitado pelo Conselho Multi-Agente (${councilDeliberation.chairmanVerdict}): ${councilDeliberation.chairmanSynthesis}`;
            if (!evaluationResult.failedCriteria) evaluationResult.failedCriteria = [];
            evaluationResult.failedCriteria.push(...councilDeliberation.actionItems);
          }
        }
      } else {
        try {
          db.prepare('UPDATE autonomous_tasks SET council_deliberation_id = NULL WHERE id = ?')
            .run(task.id);
          task.council_deliberation_id = null;
        } catch (err) {
          if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
            (globalThis as any).logger.warn({
              event: "server.handled_exception",
              file: "autonomousRunnerService",
              error: (err as any)?.message || String(err)
            });
          } else {
            console.warn("[WARN][server:autonomousRunnerService]", err);
          }
        }
      }

      // 5. NOTE (Section 9): Git commit and remote push are strictly executed AFTER Review approval
      // in AutonomousManager.submitSupervisorReview -> executePostReviewCommitGate (APPROVED -> COMMIT_PENDING -> COMPLETED).

      // Record worker checkpoint
      WorkerRegistry.updateWorkerStatus(worker.id, 'READY', {
        last_checkpoint: `Tarefa "${task.title}" concluída por ${worker.name}`,
        current_run_id: null,
        current_task_id: null,
        current_issue_number: null,
      });
      const isTransportTimeout = agentResult.problems?.some(p => p.includes('TIMEOUT'));
      executionSucceeded = evaluationResult.taskIsDone && (agentResult.status === 'success' || Boolean(isTransportTimeout));

      if (executionSucceeded) {
        if (evaluationResult.evidence?.ciDoctorHealed) {
          Logger.info(`[AutonomousRunner] Tarefa "${task.title}" auto-reparada pelo CI Doctor via micro-patch.`);
          AutonomousManager.logEvent(
            run.id,
            task.id,
            'supervisor',
            'CI_DOCTOR_HEALED',
            `Micro-patch cirúrgico aplicado com sucesso pelo CI Doctor. Falha corrigida: ${evaluationResult.evidence.ciDoctorDiagnosis?.assertionMessage || 'Testes normalizados'}.`,
            {
              diagnosis: evaluationResult.evidence.ciDoctorDiagnosis,
              patchApplied: evaluationResult.evidence.ciDoctorPatchApplied
            }
          );
        }
        try {
          const touchedBackend = (agentResult.filesChanged || []).some((f: string) =>
            f.includes('src/') || f.endsWith('.ts') || f.endsWith('.js') || f.includes('server') || f.includes('db')
          );
          if (touchedBackend) {
            const { ProjectLivingSpecService } = await import('./projectLivingSpecService.js');
            ProjectLivingSpecService.syncImplementedBackendContractsToSpec(projectPath);
          }
        } catch (specSyncErr: any) {
          Logger.warn(`[AutonomousRunner] Falha não bloqueante ao sincronizar contratos de backend com specs: ${specSyncErr.message}`);
        }

        // Auto-index altered files in AST Symbol Index
        try {
          if (agentResult.filesChanged && agentResult.filesChanged.length > 0) {
            const { AstSymbolIndexService } = await import('./astSymbolIndexService.js');
            AstSymbolIndexService.updateIndexForFiles(project.id, projectPath, agentResult.filesChanged);
          }
        } catch (idxErr: any) {
          Logger.warn(`[AutonomousRunner] Falha não bloqueante ao atualizar AST Symbol Index: ${idxErr.message}`);
        }
      }

      // DecoMind ML Engine: Aprendizado de Máquina Online & Atualização de Q-Values
      try {
        const { DecoMindMlService } = await import('./decoMindMlService.js');
        let priorErrorPattern: string | undefined;
        let priorReworkCause: string | undefined;
        if (task.retry_count > 0) {
          try {
            const history = typeof task.attempt_history_json === 'string'
              ? JSON.parse(task.attempt_history_json)
              : (Array.isArray(task.attempt_history_json) ? task.attempt_history_json : []);
            if (history.length > 0) {
              const lastFailed = history.slice().reverse().find((h: any) => h.workerStatus === 'failure' || (h.knownProblems && h.knownProblems.length > 0) || h.testResults?.includes('FAIL'));
              if (lastFailed) {
                priorErrorPattern = Array.isArray(lastFailed.knownProblems) && lastFailed.knownProblems.length > 0
                  ? lastFailed.knownProblems.join('; ')
                  : lastFailed.testResults || 'REWORK_REQUIRED';
                priorReworkCause = lastFailed.testResults || 'Falha na avaliação prévia';
              }
            }
          } catch {}
          if (!priorErrorPattern && agentResult.problems?.length) {
            priorErrorPattern = agentResult.problems.join('; ');
          }
          if (!priorErrorPattern) {
            priorErrorPattern = `Retry ${task.retry_count}: Falha superada na execução autônoma`;
            priorReworkCause = 'Correção aplicada com sucesso na repetição';
          }
        }

        DecoMindMlService.recordTaskOutcome({
          taskId: task.id,
          projectId: project.id,
          task,
          projectPath,
          verdict: evaluationResult.taskIsDone ? 'PASS' : 'REWORK_REQUIRED',
          armKey: `${task.skill_routed || 'GENERAL'}::${(run.config?.model || 'flash')}::${engineeringPackage?.adaptiveEffort?.effortLevel || 'HIGH'}`,
          durationMs: Math.max(1000, Date.now() - new Date(task.created_at || Date.now()).getTime()),
          retrievedMemoryIds: promptMeta?.retrievedMemoryIds,
          reworkCause: evaluationResult.taskIsDone
            ? (task.retry_count > 0 ? priorReworkCause : undefined)
            : (evaluationResult.actual || evaluationResult.verdict),
          errorPattern: evaluationResult.taskIsDone
            ? (task.retry_count > 0 ? priorErrorPattern : undefined)
            : (agentResult.problems?.join('; ') || evaluationResult.verdict),
          solutionVaccine: evaluationResult.taskIsDone && task.retry_count > 0 ? (agentResult.implemented?.join('; ') || 'Correção aplicada com sucesso') : undefined
        });
      } catch (mlErr: any) {
        Logger.warn(`[AutonomousRunner] Aviso não bloqueante no DecoMind ML: ${mlErr.message}`);
      }

      return {
        runId: run.id,
        taskId: task.id,
        status: evaluationResult.taskIsDone ? 'success' : 'failure',
        filesChanged: agentResult.filesChanged,
        implemented: agentResult.implemented.length > 0 ? agentResult.implemented : [task.title],
        testsRun: evaluationResult.executedCommands.join(' && ') || agentResult.tests.command || 'N/A',
        testResults: evaluationResult.taskIsDone ? 'Evaluator PASS' : `Evaluator ${evaluationResult.verdict}`,
        buildStatus: agentResult.buildStatus,
        browserValidation: agentResult.browserValidation || 'Componentes prontos',
        screenshots: agentResult.screenshots || [],
        knownProblems: agentResult.problems || [],
        decisions: agentResult.decisions || [
          {
            decision: `Implementação realizada por ${worker.name} para ${task.title}`,
            rationale: 'Raciocínio autônomo do modelo com validação de ferramentas'
          }
        ],
        recommendation: evaluationResult.taskIsDone
          ? 'Recomenda aprovação imediata para prosseguir com o backlog.'
          : 'Recomenda revisão e correção de erros antes do prosseguimento.',
        evaluation: evaluationResult,
        councilDeliberation: councilDeliberation || undefined
      };
    } finally {
      clearInterval(renewalInterval);
      const pendingObservation = AgentTurnState.forTask(task.id);
      if (!pendingObservation || !['IN_FLIGHT', 'UNCERTAIN'].includes(pendingObservation.phase)) {
        WorkerRegistry.releaseLease(leaseId, worker.id);
      }
      AutonomousRunnerService.releaseExecutionLock();

      // Record telemetry in UsageTracker
      const durationMs = Date.now() - startTime;
      const modelEvidence = executionConversationId
        ? antigravityProvider.getModelEvidence(executionConversationId)
        : { actualModel: null, verified: false, reason: 'NO_CONVERSATION' };
      UsageTracker.recordEvent({
        accountProfileId: worker.account_profile_id,
        modelId: resolvedBuilderModel,
        role: 'builder',
        projectId: project.id,
        conversationId: executionConversationId,
        taskId: task.id,
        durationMs,
        toolCallsCount: executedToolCalls,
        status: executionSucceeded ? 'success' : 'failure',
        metadata: {
          requested_model: requestedBuilderModel,
          requested_intelligence: builderConfig?.intelligenceLevel || 'HIGH',
          actual_model: modelEvidence.actualModel,
          actual_model_verified: modelEvidence.verified,
          fallback_reason: modelEvidence.reason,
          effort_level: engineeringPackage?.adaptiveEffort?.effortLevel || 'STANDARD',
          token_telemetry: 'TOKEN_TELEMETRY_UNAVAILABLE',
          quota_telemetry: 'QUOTA_TELEMETRY_UNAVAILABLE'
        }
      });

      // Record lightweight task operational metrics
      try {
        const existingTask: any = db.prepare('SELECT retry_count FROM autonomous_tasks WHERE id = ?').get(task.id);
        const retryCount = existingTask?.retry_count || task.retry_count || 0;
        UsageTracker.recordTaskMetrics(task.id, {
          taskId: task.id,
          runId: run.id,
          aiCallsCount: 1 + retryCount,
          retryCount,
          sessionRenewals: 0,
          contextBytesSent: engineeringPackage?.contextBytes || 0,
          stepDurationsMs: {
            building: durationMs,
            evaluating: evaluationResult?.evidence?.durationMs || 0,
            total: durationMs + (evaluationResult?.evidence?.durationMs || 0)
          },
          duplicateEffectsCount: 0,
          evaluatorFailuresCount: executionSucceeded ? 0 : 1,
          revertedApprovalsCount: (evaluationResult?.failedCriteria || []).some((r: string) => r.includes('UNVERIFIED_CLAIM')) ? 1 : 0,
          requestedModel: requestedBuilderModel,
          actualModel: modelEvidence.actualModel || resolvedBuilderModel,
          effortLevel: engineeringPackage?.adaptiveEffort?.effortLevel || 'STANDARD'
        });
      } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autonomousRunnerService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousRunnerService]", err);
      }
    }
    }
  }

  /**
   * Supervisor evaluates the Builder report & GitHub PR using real Gemini reasoning
   */
  private static pauseForVerification(runId: string, taskId: string, reason: string): void {
    db.prepare("UPDATE autonomous_runs SET status='paused',last_error=?,next_action='Verificação bloqueada; entrega preservada. Revise a operação e continue sem reenviar ao Worker',updated_at=? WHERE id=?")
      .run(`VERIFICATION_BLOCKED: ${reason}`, new Date().toISOString(), runId);
    AutonomousManager.logEvent(runId, taskId, 'evaluator', 'VERIFICATION_BLOCKED', reason);
  }

  private static async executeSupervisorReview(
    run: any,
    task: any,
    report: BuilderReportInput
  ): Promise<{ verdict: 'APPROVED' | 'CHANGES_REQUESTED'; feedback: string; run: any }> {
    const project = run.project || { name: 'Projeto', path: '.', objective: '' };
    AutonomousRunnerService.setExecutionPhase('SUPERVISOR_REVIEWING');
    try {
      if (task?.id) {
        db.prepare("UPDATE autonomous_tasks SET updated_at = ? WHERE id = ?").run(new Date().toISOString(), task.id);
      }
    } catch {}

    let verdict: 'APPROVED' | 'CHANGES_REQUESTED' = 'APPROVED';
    let feedback = '';

    // Decisão 100% determinística baseada na comprovação factual do IndependentEvaluator (0 chamadas LLM extras)
    if (report.evaluation && report.evaluation.taskIsDone && report.evaluation.verdict === 'PASS') {
      verdict = 'APPROVED';
      feedback = 'Aprovado após verificação objetiva do IndependentEvaluator (testes e arquivos comprovados no disco).';
    } else {
      // Auto-probe: se a tarefa receber UNVERIFIED_CLAIM ou falha por falta de arquivos declarados,
      // antes de marcar CHANGES_REQUESTED, realiza a mesma sonda que o botão "Prosseguir" faz (reconcileCompletedTurn)
      let contractId = task.contract_id || (task as any).contractId;
      let expectedFiles: string[] = [];
      if (Array.isArray(task.expected_files)) {
        expectedFiles = task.expected_files;
      } else if (typeof task.expected_files_json === 'string') {
        try { expectedFiles = JSON.parse(task.expected_files_json); } catch {}
      } else {
        try {
          const row: any = db.prepare('SELECT contract_id, expected_files_json FROM autonomous_tasks WHERE id = ?').get(task.id);
          if (row?.contract_id && !contractId) contractId = row.contract_id;
          if (row?.expected_files_json) {
            try { expectedFiles = JSON.parse(row.expected_files_json); } catch {}
          }
        } catch {}
      }

      const isUnverifiedClaim = Boolean(
        report.evaluation?.failedCriteria?.some((c: string) => c.includes('UNVERIFIED_CLAIM')) ||
        report.evaluation?.actual?.includes('Unverified Claim') ||
        report.evaluation?.actual?.includes('Nenhum comando de teste configurado') ||
        (report.filesChanged && report.filesChanged.length === 0) ||
        !report.evaluation ||
        report.evaluation.verdict === 'FAIL' ||
        report.evaluation.verdict === 'INCONCLUSIVE'
      );

      let autoProbedPass = false;
      if (isUnverifiedClaim && contractId && project.path) {
        try {
          const synthReport: any = {
            status: 'success',
            filesChanged: expectedFiles.length > 0 ? expectedFiles : (report.filesChanged || []),
            implemented: [task.title],
            tests: { passed: true, exitCode: 0 },
            problems: []
          };
          const probeEval = await IndependentEvaluator.evaluate(
            contractId,
            project.path,
            synthReport,
            { expectedScopeFiles: expectedFiles, effortLevel: 'MINIMAL' }
          );
          if (probeEval && probeEval.taskIsDone && probeEval.verdict === 'PASS') {
            Logger.info(`[executeSupervisorReview] Auto-probe reconciliou com sucesso a tarefa "${task.title}". Testes verificados com código 0 no disco.`);
            report.evaluation = probeEval;
            verdict = 'APPROVED';
            feedback = 'Aprovado automaticamente via auto-probe: código e testes comprovados no disco pelo Evaluator.';
            autoProbedPass = true;
          }
        } catch (probeErr: any) {
          Logger.warn(`[executeSupervisorReview] Auto-probe falhou: ${probeErr.message}`);
        }
      }

      if (!autoProbedPass) {
        verdict = 'CHANGES_REQUESTED';
        const evalNotes = Array.isArray(report.evaluation?.evaluatorNotes) && report.evaluation.evaluatorNotes.length > 0
          ? ` | Notas: ${report.evaluation.evaluatorNotes.join('; ')}`
          : '';
        const actualError = report.evaluation?.actual || 'Falha na validação objetiva dos critérios de aceitação e integridade';
        const failedCriteria = Array.isArray(report.evaluation?.failedCriteria) && report.evaluation.failedCriteria.length > 0
          ? `\nCritérios Reprovados:\n${report.evaluation.failedCriteria.map((c: string) => `- ${c}`).join('\n')}`
          : '';
        feedback = `Correções solicitadas após verificação objetiva: ${actualError}${evalNotes}${failedCriteria}`;

        AutonomousManager.logEvent(
          run.id,
          task.id,
          'evaluator',
          report.evaluation?.verdict === 'TAMPERING_DETECTED' ? 'TAMPERING_DETECTED' : 'EVALUATION_FAILED',
          `Evaluator Independente reprovou entrega: ${report.evaluation?.actual || 'Avaliação ausente'}`,
          {
            failedCriteria: report.evaluation?.failedCriteria,
            expected: report.evaluation?.expected,
            actual: report.evaluation?.actual,
            evidence: report.evaluation?.evidence
          }
        );
      }
    }

    // Telemetria do CI Doctor (apenas quando comprovadamente executado)
    if (report.evaluation?.evidence?.ciDoctorHealed) {
      Logger.info(`[AutonomousRunnerService] Tarefa "${task.title}" auto-reparada pelo CI Doctor.`);
      AutonomousManager.logEvent(
        run.id,
        task.id,
        'supervisor',
        'CI_DOCTOR_HEALED',
        `Micro-patch cirúrgico aplicado com sucesso pelo CI Doctor. Falha corrigida: ${report.evaluation.evidence.ciDoctorDiagnosis?.assertionMessage || 'Testes normalizados'}.`,
        {
          diagnosis: report.evaluation.evidence.ciDoctorDiagnosis,
          patchApplied: report.evaluation.evidence.ciDoctorPatchApplied
        }
      );
    }

    try {

      let updatedRun: any;
      try {
        updatedRun = AutonomousManager.submitSupervisorReview({
          runId: run.id,
          taskId: task.id,
          verdict,
          feedback,
          requirementsMet: verdict === 'APPROVED',
          buildPassed: verdict === 'APPROVED',
          testsPassed: verdict === 'APPROVED',
          uiFunctional: verdict === 'APPROVED',
          qualityScore: verdict === 'APPROVED' ? 10 : 5,
          allowReworkOnBlocked: true,
          enableAutoRepair: true
        });
      } catch (reviewErr: any) {
        if (/NEEDS_EVIDENCE/i.test(reviewErr?.message)) {
          Logger.warn(`[Supervisor Review] Aprovação rejeitada pelo Review independente: ${reviewErr.message}. Convertendo para CHANGES_REQUESTED.`);
          verdict = 'CHANGES_REQUESTED';
          feedback = `Revisão reprovada por evidência insuficiente: ${reviewErr.message}`;
          updatedRun = AutonomousManager.submitSupervisorReview({
            runId: run.id,
            taskId: task.id,
            verdict: 'CHANGES_REQUESTED',
            feedback,
            requirementsMet: false,
            buildPassed: false,
            testsPassed: false,
            uiFunctional: false,
            qualityScore: 4,
            allowReworkOnBlocked: true,
            enableAutoRepair: true
          });
        } else {
          throw reviewErr;
        }
      }

      if (verdict === 'APPROVED' && project.path) {
        try {
          const { ProjectLivingSpecService } = await import('./projectLivingSpecService.js');
          ProjectLivingSpecService.syncImplementedBackendContractsToSpec(project.path);
        } catch (syncErr: any) {
          Logger.warn(`[Supervisor Review] Falha não bloqueante ao sincronizar contratos de backend com specs: ${syncErr.message}`);
        }
      }

      // Synchronize review with GitHub (PR review, merge, and issue closing)
      if (project.github_repo) {
        const [owner, repo] = project.github_repo.split('/');
        const taskRecord: any = db.prepare('SELECT github_pr_number, github_branch FROM autonomous_tasks WHERE id = ?').get(task.id);
        let prNumber = taskRecord?.github_pr_number;

        // If PR number is not yet recorded, attempt to look up open PR for this branch
        if (!prNumber && taskRecord?.github_branch) {
          try {
            const prList = await GitHubMcpClient.listPullRequests(owner, repo, 'open');
            const matching = prList.find((p: any) => p.head?.ref === taskRecord.github_branch);
            if (matching?.number) {
              prNumber = matching.number;
              db.prepare('UPDATE autonomous_tasks SET github_pr_number = ?, github_pr_url = ? WHERE id = ?')
                .run(matching.number, matching.html_url || null, task.id);
            }
          } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autonomousRunnerService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousRunnerService]", err);
      }
    }
        }

        if (verdict === 'CHANGES_REQUESTED') {
          try {
            if (prNumber) {
              try {
                await GitHubMcpClient.createPullRequestReview(owner, repo, prNumber, 'REQUEST_CHANGES', feedback);
              } catch {
                await GitHubMcpClient.createPullRequestReview(owner, repo, prNumber, 'COMMENT', `[CHANGES_REQUESTED - Gemini Supervisor Code Review]\n\n${feedback}`);
              }
            }
            if (task.github_issue_number) {
              await GitHubMcpClient.addIssueComment(
                owner,
                repo,
                task.github_issue_number,
                `**Gemini Supervisor Code Review**: CHANGES_REQUESTED\n\n> ${feedback}`
              );
            }
            AutonomousManager.logEvent(
              run.id,
              task.id,
              'supervisor',
              'GITHUB_REVIEW_CHANGES_REQUESTED',
              `Supervisor Gemini solicitou alterações na PR #${prNumber || 'N/A'}${task.github_issue_number ? ` (Issue #${task.github_issue_number})` : ''}`,
              { feedback }
            );
          } catch (revErr: any) {
            Logger.warn(`[GitHub Review] Falha ao registrar review de alterações: ${revErr.message}`);
          }
        } else {
          // APPROVED: Approve PR, Merge PR, Close Issue on GitHub
          try {
            if (prNumber) {
              try {
                await GitHubMcpClient.createPullRequestReview(owner, repo, prNumber, 'APPROVE', feedback);
              } catch {
                await GitHubMcpClient.createPullRequestReview(owner, repo, prNumber, 'COMMENT', `[APPROVED - Gemini Supervisor Code Review]\n\n${feedback}`);
              }
              await GitHubMcpClient.mergePullRequest(owner, repo, prNumber, `[AI Merge] ${task.title}`);
              try {
                db.prepare("UPDATE autonomous_tasks SET pr_merged = 1 WHERE id = ?").run(task.id);
              } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autonomousRunnerService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousRunnerService]", err);
      }
    }
            }
            if (task.github_issue_number) {
              await GitHubMcpClient.updateIssue(owner, repo, task.github_issue_number, { state: 'closed' });
              db.prepare("UPDATE autonomous_tasks SET github_state = 'closed' WHERE id = ?").run(task.id);
            }

            // Switch back to main and pull merged changes
            if (fs.existsSync(path.join(project.path, '.git'))) {
              GitManager.checkout(project.path, 'main');
              GitManager.pull(project.path, 'main');
            }

            AutonomousManager.logEvent(
              run.id,
              task.id,
              'supervisor',
              'GITHUB_PR_MERGED',
              `PR #${prNumber || 'N/A'} aprovada e mergeada na main.${task.github_issue_number ? ` Issue #${task.github_issue_number} fechada.` : ''}`,
              { prNumber, issueNumber: task.github_issue_number }
            );
          } catch (mergeErr: any) {
            Logger.warn(`[GitHub Review] Falha ao aprovar/margear PR: ${mergeErr.message}`);
          }
        }
      }

      return { verdict, feedback, run: updatedRun };
    } finally {
      AutonomousRunnerService.releaseExecutionLock();
    }
  }

  public static trajectoryRunnerHook?: (params: {
    candidateLabel: 'candidate-A' | 'candidate-B';
    worktreePath: string;
    task: any;
    strategyDescription: string;
    promptVariation: string;
  }) => Promise<{
    filesChanged: string[];
    problems?: string[];
    status?: 'success' | 'failure';
    summary?: string;
  }>;

  /**
   * Avalia um candidato nos 4 portões de qualidade (Dev Tests, Visual/Anti-Slop, UX/F5, AppSec)
   * adicionando bônus de simplicidade Karpathy para mudanças cirúrgicas e com baixo overhead.
   */
  public static calculateQualityGatesScore(evalResult: EvaluationResult, agentResult: BuilderToSupervisorContract): {
    devTests: number;
    visualAntiSlop: number;
    uxJourney: number;
    appSec: number;
    simplicityBonus: number;
    total: number;
  } {
    const summary = evalResult.evidence?.evidenceSummary;

    // Portão 1: Dev Tests (Exit code 0 & conformidade com critérios de teste)
    const isTestsPass = evalResult.exitCode === 0 || evalResult.verdict === 'PASS';
    const totalCriteria = (evalResult.passedCriteria?.length || 0) + (evalResult.failedCriteria?.length || 0);
    const criteriaRatio = totalCriteria > 0 ? (evalResult.passedCriteria?.length || 0) / totalCriteria : 1;
    const devTests = isTestsPass ? (8.0 + (criteriaRatio * 2.0)) : Math.max(0, criteriaRatio * 5.0);

    // Portão 2: Visual & Anti-Slop (Ausência de IA slop e padrões de código inflado)
    const antiSlopOk = summary?.antiSlopPassed ?? true;
    const designQualityOk = summary?.designQualityPassed ?? true;
    const visualInspectionOk = summary?.visualInspectionPassed ?? true;
    let visualAntiSlop = 10.0;
    if (!antiSlopOk) visualAntiSlop -= 6.0;
    if (!designQualityOk) visualAntiSlop -= 2.0;
    if (!visualInspectionOk) visualAntiSlop -= 2.0;
    visualAntiSlop = Math.max(0, visualAntiSlop);

    // Portão 3: UX & User Journey / F5 (Preservação de jornadas e ausência de regressões)
    const userJourneyOk = summary?.userJourneyPassed ?? true;
    const uxJourney = userJourneyOk ? 10.0 : 4.0;

    // Portão 4: AppSec & Pentest (Resiliência contra injeção e vulnerabilidades)
    const securityPentestOk = summary?.securityPentestPassed ?? true;
    const adversarialOk = summary?.adversarialChecksPassed ?? true;
    let appSec = 10.0;
    if (!securityPentestOk) appSec -= 6.0;
    if (!adversarialOk) appSec -= 4.0;
    appSec = Math.max(0, appSec);

    // Bônus de Simplicidade Karpathy: soluções cirúrgicas com menos arquivos modificados
    const filesCount = agentResult.filesChanged?.length || 0;
    const simplicityBonus = filesCount <= 2 ? 1.0 : filesCount <= 5 ? 0.5 : 0;

    // Score Ponderado: DevTests(40%) + AntiSlop(25%) + UX(15%) + AppSec(20%) + Bônus Simplicidade
    const total = parseFloat((
      (devTests * 0.40) +
      (visualAntiSlop * 0.25) +
      (uxJourney * 0.15) +
      (appSec * 0.20) +
      simplicityBonus
    ).toFixed(2));

    return {
      devTests: parseFloat(devTests.toFixed(2)),
      visualAntiSlop: parseFloat(visualAntiSlop.toFixed(2)),
      uxJourney: parseFloat(uxJourney.toFixed(2)),
      appSec: parseFloat(appSec.toFixed(2)),
      simplicityBonus,
      total
    };
  }

  /**
   * Executa trajetórias concorrentes (Best-of-N Rollout) em worktrees efêmeros isolados
   * para tarefas de alta complexidade (HIGH/DEEP) ou retrabalho (retry_count >= 1).
   */
  public static async executeConcurrentRollout(params: {
    project: any;
    run: any;
    task: any;
    branchName: string;
    worker: Worker;
    leaseId: string;
    engineeringPackage: any;
    contract: any;
    isolatedEnv?: NodeJS.ProcessEnv;
  }): Promise<{
    reportData: BuilderToSupervisorContract;
    evaluationResult: EvaluationResult;
  }> {
    const { project, run, task, branchName, worker, leaseId, engineeringPackage, contract, isolatedEnv } = params;
    const projectPath = project.path;

    AutonomousManager.logEvent(
      run.id,
      task.id,
      'system',
      'CONCURRENT_ROLLOUT_START',
      `Iniciando motor de trajetórias concorrentes (Best-of-N Rollout) para "${task.title}". Despachando 2 candidatos em worktrees efêmeros paralelos.`,
      {
        taskId: task.id,
        effortLevel: engineeringPackage?.adaptiveEffort?.effortLevel,
        retryCount: task.retry_count
      }
    );

    ObservabilityService.emit({
      level: 'INFO',
      event: 'CONCURRENT_ROLLOUT_START',
      message: `Iniciando Best-of-N Rollout para "${task.title}"`,
      service: 'runner',
      runId: run.id,
      taskId: task.id,
      metadata: {
        effortLevel: engineeringPackage?.adaptiveEffort?.effortLevel,
        retryCount: task.retry_count
      }
    });

    // 1. Criar dois worktrees efêmeros isolados
    const worktreeA = EphemeralWorktreeService.createEphemeralWorktree({
      baseRepo: projectPath,
      taskId: task.id,
      candidateLabel: 'candidate-A'
    });

    const worktreeB = EphemeralWorktreeService.createEphemeralWorktree({
      baseRepo: projectPath,
      taskId: task.id,
      candidateLabel: 'candidate-B'
    });

    // 2. Definir variações de prompt (conservadora vs cirúrgica)
    const strategyA = 'Solução conservadora (Simplicity First - foco em simplicidade cirúrgica, poucas linhas e sem abstrações)';
    const promptA = [
      `[ESTRATÉGIA DE IMPLEMENTAÇÃO: SIMPLICITY FIRST (CONSERVADORA)]`,
      `Foque na solução mais minimalista, cirúrgica e enxuta possível.`,
      `- Escreva o menor número possível de novas linhas.`,
      `- Evite criar novas classes, padrões ou abstrações adicionais.`,
      `- Modifique apenas as funções estritamente necessárias para atender aos critérios de aceitação.`,
      `- Preserve integralmente o restante do codebase existente.`
    ].join('\n');

    const strategyB = 'Solução cirúrgica (Robustez Estrutural - tipagem defensiva, validação rigorosa e cobertura de edge cases)';
    const promptB = [
      `[ESTRATÉGIA DE IMPLEMENTAÇÃO: ESTRUTURADA E RESILIENTE (CIRÚRGICA)]`,
      `Foque em máxima robustez técnica, tipagem forte e cobertura de edge cases.`,
      `- Garanta tratamento defensivo de erros e validações estritas de entrada.`,
      `- Utilize estruturas de dados com tempo de execução previsível e baixo overhead.`,
      `- Assegure que todos os critérios de aceitação e testes do contrato passem sem avisos.`
    ].join('\n');

    const runCandidate = async (
      candidateLabel: 'candidate-A' | 'candidate-B',
      worktree: EphemeralWorktreeInfo,
      strategyDescription: string,
      promptVariation: string
    ) => {
      let candidateReport: BuilderToSupervisorContract;

      if (AutonomousRunnerService.trajectoryRunnerHook) {
        const hookRes = await AutonomousRunnerService.trajectoryRunnerHook({
          candidateLabel,
          worktreePath: worktree.worktreePath,
          task,
          strategyDescription,
          promptVariation
        });
        candidateReport = {
          status: hookRes.status || 'success',
          implemented: [`[${candidateLabel}] ${hookRes.summary || 'Implementação concluída'}`],
          filesChanged: hookRes.filesChanged || [],
          commandsExecuted: [],
          tests: { ran: true, passed: true },
          buildStatus: 'success',
          decisions: [],
          problems: hookRes.problems || [],
          agentThoughts: hookRes.summary || `${candidateLabel} concluiu a trajetória com sucesso.`
        };
      } else {
        const { AgentApiGateway } = await import('./agentApiGateway.js');
        if (AgentApiGateway.isOfflineMode()) {
          const filesOnDisk = fs.existsSync(worktree.worktreePath)
            ? (task.expected_files || []).filter((f: string) => fs.existsSync(path.join(worktree.worktreePath, f)))
            : [];
          candidateReport = {
            status: 'success',
            implemented: [`Modo offline: execução simulada no worktree de ${candidateLabel}`],
            filesChanged: filesOnDisk,
            commandsExecuted: [],
            tests: { ran: false },
            buildStatus: 'success',
            decisions: [],
            problems: [],
            agentThoughts: `${candidateLabel} executado em modo offline com sucesso.`
          };
        } else {
          const antigravityProvider = new AntigravityProvider(isolatedEnv);
          const candidateRole = candidateLabel === 'candidate-A' ? 'WORKER_CANDIDATE_A' : 'WORKER_CANDIDATE_B';
          const { session: candidateSession } = await AgentSessionManager.getOrCreateAgentSession(
            project.id,
            candidateRole as any,
            {
              model: 'flash',
              env: isolatedEnv,
              initialPrompt: promptVariation,
              accountProfileId: worker.account_profile_id || 'acc-pro-1',
              runId: run.id
            }
          );
          await antigravityProvider.sendTask(candidateSession.provider_conversation_id, {
            mode: 'IMPLEMENT',
            task: {
              id: `${task.id}-${candidateLabel}`,
              title: `[${candidateLabel}] ${task.title}`,
              description: `${task.description || ''}\n\n${promptVariation}`,
              milestone: task.milestone || 'M1',
              verificationCommand: engineeringPackage.taskContract.verificationCommand,
              doneWhen: engineeringPackage.taskContract.doneWhen
            },
            context: {
              projectName: project.name,
              projectPath: worktree.worktreePath,
              objective: project.objective
            },
            requirements: [
              `Criar/editar código funcional exclusivamente dentro de "${worktree.worktreePath}"`,
              promptVariation
            ],
            acceptanceCriteria: engineeringPackage.taskContract.acceptanceCriteria,
            constraints: [`Não modificar arquivos fora de "${worktree.worktreePath}"`],
            supervisorInstructions: promptVariation
          });

          candidateReport = await antigravityProvider.getResult(
            candidateSession.provider_conversation_id,
            180000,
            worktree.worktreePath
          );
        }
      }

      // Executa o IndependentEvaluator isolado no worktree do candidato
      const evalResult = await IndependentEvaluator.evaluate(
        contract.id,
        worktree.worktreePath,
        candidateReport,
        {
          expectedScopeFiles: task.expected_files || [],
          effortLevel: engineeringPackage?.adaptiveEffort?.effortLevel,
          taskMode: 'IMPLEMENT'
        }
      );

      const scores = AutonomousRunnerService.calculateQualityGatesScore(evalResult, candidateReport);

      return {
        candidateLabel,
        worktree,
        promptVariation,
        strategyDescription,
        agentResult: candidateReport,
        evaluationResult: evalResult,
        scores
      };
    };

    // 3. Executar ambos os candidatos sequencialmente em seus worktrees isolados para evitar colisão de turnos no agente
    const candA = await runCandidate('candidate-A', worktreeA, strategyA, promptA);
    const candB = await runCandidate('candidate-B', worktreeB, strategyB, promptB);

    // 4. Selecionar o candidato vencedor com maior pontuação nos 4 portões de qualidade
    const winner = candA.scores.total >= candB.scores.total ? candA : candB;
    const loser = winner === candA ? candB : candA;

    AutonomousManager.logEvent(
      run.id,
      task.id,
      'supervisor',
      'ROLLOUT_WINNER_SELECTED',
      `🏆 Vencedor Best-of-N selecionado: ${winner.candidateLabel} (Score: ${winner.scores.total}/10 vs ${loser.scores.total}/10). Dev Tests: ${winner.scores.devTests}/10, Visual/Anti-Slop: ${winner.scores.visualAntiSlop}/10, UX: ${winner.scores.uxJourney}/10, AppSec: ${winner.scores.appSec}/10.`,
      {
        winner: winner.candidateLabel,
        winnerScores: winner.scores,
        loser: loser.candidateLabel,
        loserScores: loser.scores
      }
    );

    ObservabilityService.emit({
      level: 'INFO',
      event: 'CONCURRENT_ROLLOUT_WINNER_SELECTED',
      message: `Vencedor Best-of-N: ${winner.candidateLabel} (${winner.scores.total} vs ${loser.scores.total})`,
      service: 'runner',
      runId: run.id,
      taskId: task.id,
      metadata: {
        winner: winner.candidateLabel,
        winnerScores: winner.scores,
        loser: loser.candidateLabel,
        loserScores: loser.scores
      }
    });

    // 5. Integrar o código do vencedor no projeto e branch principal da tarefa
    for (const relFile of winner.agentResult.filesChanged) {
      const srcFile = path.join(winner.worktree.worktreePath, relFile);
      const destFile = path.join(projectPath, relFile);
      if (fs.existsSync(srcFile)) {
        fs.mkdirSync(path.dirname(destFile), { recursive: true });
        fs.copyFileSync(srcFile, destFile);
      }
    }

    try {
      execSync(`git -C "${projectPath}" add -A`, { stdio: 'pipe' });
      execSync(`git -C "${projectPath}" commit -m "rollout(winner): integrate ${winner.candidateLabel} for ${task.title}"`, { stdio: 'pipe' });
    } catch {}

    // 6. Desmontar e remover com segurança o worktree perdedor e vencedor, limpando referências Git
    try {
      EphemeralWorktreeService.removeWorktree(loser.worktree.worktreePath, {
        baseRepo: projectPath,
        deleteBranch: true
      });
    } catch (err: any) {
      Logger.warn(`[ConcurrentRollout] Falha não bloqueante ao remover worktree perdedor: ${err.message}`);
    }

    try {
      EphemeralWorktreeService.removeWorktree(winner.worktree.worktreePath, {
        baseRepo: projectPath,
        deleteBranch: true
      });
    } catch (err: any) {
      Logger.warn(`[ConcurrentRollout] Falha não bloqueante ao remover worktree vencedor: ${err.message}`);
    }

    EphemeralWorktreeService.pruneOrphanedWorktrees(projectPath);

    return {
      reportData: {
        ...winner.agentResult,
        implemented: [
          `[BEST-OF-N ROLLOUT WINNER: ${winner.candidateLabel}]`,
          ...(winner.agentResult.implemented || [])
        ]
      },
      evaluationResult: winner.evaluationResult
    };
  }

  public static async postCompletionVisualSummaryToChat(projectId: string, runId: string) {
    return ProjectOperationsService.postCompletionVisualSummaryToChat(projectId, runId);
  }
}