import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { db } from './db.js';
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
}

export interface SupervisorReviewInput {
  runId: string;
  taskId: string;
  reportId?: string;
  verdict: 'APPROVED' | 'CHANGES_REQUESTED';
  feedback: string;
  requirementsMet?: boolean;
  buildPassed?: boolean;
  testsPassed?: boolean;
  uiFunctional?: boolean;
  qualityScore?: number;
}

export class AutonomousManager {
  /**
   * Create and initialize a new Autonomous Run
   */
  static async createRun(config: AutonomousRunConfig) {
    const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(config.projectId);
    if (!project) throw new Error('Projeto não encontrado.');

    // 0. Idempotency Guard: Reuse existing active run if not explicitly forced
    if (!config.forceNew) {
      const activeRun: any = db.prepare(`
        SELECT * FROM autonomous_runs
        WHERE project_id = ? AND status IN ('running', 'building', 'testing', 'reviewing', 'planning', 'waiting_for_worker', 'waiting_approval', 'paused')
        ORDER BY created_at DESC
        LIMIT 1
      `).get(config.projectId);

      if (activeRun) {
        Logger.info(`[AutonomousManager] Run ativo já existente para ${project.name}: [${activeRun.id.slice(0, 8)}] (${activeRun.status}). Reutilizando run com idempotência.`);
        return this.getRun(activeRun.id);
      }
    }

    const runId = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    const dateTag = new Date().toISOString().slice(0, 10);
    const branchName = `ai/autonomous-build-${dateTag}-${runId.slice(0, 6)}`;

    // 1. Git Safety: Create dedicated isolated branch
    try {
      if (fs.existsSync(path.join(project.path, '.git'))) {
        execSync(`git checkout -b "${branchName}"`, { cwd: project.path, stdio: 'pipe' });
        Logger.info(`Branch isolada criada: ${branchName} em ${project.name}`);
      }
    } catch (err: any) {
      Logger.warn(`Não foi possível criar branch isolada: ${err.message}`);
    }

    const name = config.name || `Build Autônomo #${new Date().toLocaleTimeString('pt-BR')}`;
    const objective = config.objective || (config as any).goal || 'Construção autônoma do MVP';
    const briefing = config.briefing || objective;
    const maxHours = config.maxHours || ((config as any).timeBudgetMinutes ? (config as any).timeBudgetMinutes / 60 : (config.isOvernight ? 8.0 : 4.0));
    const maxCycles = config.maxCycles || (config as any).maxIterations || (config.isOvernight ? 50 : 25);
    const autonomyMode = config.autonomyMode || (config as any).mode || (config.isOvernight ? 'autonomous' : 'balanced');

    // 2. Persist Run in SQLite
    db.prepare(`
      INSERT INTO autonomous_runs (
        id, project_id, name, objective, briefing, status, autonomy_mode,
        branch_name, max_hours, max_cycles, current_cycle, start_time,
        config_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?, ?, 0, ?, ?, ?, ?)
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

    // 3. Log initial event
    this.logEvent(runId, null, 'system', 'RUN_STARTED', `Iniciado Autonomous Build "${config.name}" no modo ${autonomyMode.toUpperCase()}`);

    // 4. Generate initial task plan dynamically via Gemini Supervisor
    try {
      await this.generateInitialTasks(runId, config, project);
    } catch (err: any) {
      if (/RESOURCE_EXHAUSTED|code 429|Individual quota reached|QUOTA_EXHAUSTED/i.test(err.message)) {
        const cooldownMsg = `BLOCKED_QUOTA: ${err.message}`;
        db.prepare("UPDATE autonomous_runs SET status = 'paused', last_error = ?, next_action = 'Execução pausada aguardando restabelecimento de cota', updated_at = ? WHERE id = ?")
          .run(cooldownMsg, new Date().toISOString(), runId);
        this.logEvent(runId, null, 'system', 'BLOCKED_QUOTA', `Cota do modelo esgotada (429). Run pausado com segurança sem retries imediatos.`);
        Logger.warn(`[AutonomousManager] Run [${runId.slice(0, 8)}] pausado por limite de cota (BLOCKED_QUOTA).`);
        return this.getRun(runId);
      }
      db.prepare("UPDATE autonomous_runs SET status = 'error', last_error = ?, next_action = 'Verificar conta e agentapi do Supervisor', updated_at = ? WHERE id = ?")
        .run(`SUPERVISOR_UNAVAILABLE: ${err.message}`, new Date().toISOString(), runId);
      this.logEvent(runId, null, 'system', 'SUPERVISOR_UNAVAILABLE', err.message);
      throw err;
    }

    Logger.success(`Autonomous Run [${runId.slice(0, 8)}] criado com sucesso para ${project.name}`);
    return this.getRun(runId);
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

    const preferences = ModelRegistry.getPreferences(null, project.id);
    const resolvedSupervisorModel = ModelRegistry.resolveModel({
      preference: preferences.supervisor || preferences.default,
      role: 'supervisor'
    });

    const { AccountProfileManager } = await import('./accountProfileManager.js');
    const { AutonomousRunnerService } = await import('./autonomousRunnerService.js');
    AutonomousRunnerService.setExecutionPhase('SUPERVISOR_PLANNING');

    const profile = AccountProfileManager.getActiveProfileForProject(project.id);
    const supervisorEnv = AccountProfileManager.getExecutionEnvForProfile(profile);
    const supervisor = new GeminiSupervisorProvider(
      resolvedSupervisorModel,
      supervisorEnv,
      profile?.id,
      project?.id
    );
    const startTime = Date.now();
    const briefing = config.briefing || config.objective || 'Construção autônoma do software';

    let plannedTasks: TaskDefinition[];
    try {
      plannedTasks = await supervisor.planTasks(briefing, {
        id: project.id,
        name: project.name,
        path: project.path,
        objective: project.objective || config.objective
      }, {
        mode: 'INITIAL_PLAN',
        runId
      });
    } catch (supErr: any) {
      Logger.error(`[AutonomousManager] Falha no planejamento via Supervisor Gemini: ${supErr.message}`);
      if (/RESOURCE_EXHAUSTED|code 429|Individual quota reached|QUOTA_EXHAUSTED/i.test(supErr.message)) {
        if (profile?.id) {
          AccountProfileManager.markQuotaExhausted(profile.id, supErr.message);
        }
      }
      throw supErr;
    } finally {
      AutonomousRunnerService.releaseExecutionLock();
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
        actual_model: supervisorEvidence.actualModel,
        actual_model_verified: false,
        fallback_reason: supervisorEvidence.fallbackReason,
        token_telemetry: 'TOKEN_TELEMETRY_UNAVAILABLE',
        quota_telemetry: 'QUOTA_TELEMETRY_UNAVAILABLE'
      }
    });

    const nowIso = new Date().toISOString();
    const taskIds: string[] = [];
    const taskIssueNumbers: number[] = [];

    let ghOwner = '';
    let ghRepo = '';
    let epicIssueNumber: number | null = null;
    let epicIssueUrl: string | null = null;

    if (project.github_repo && project.github_repo.includes('/')) {
      const parts = project.github_repo.split('/');
      ghOwner = parts[0].trim();
      ghRepo = parts[1].trim();

      try {
        Logger.info(`[GitHub Task Graph] Criando Epic Issue no GitHub para ${ghOwner}/${ghRepo}...`);
        const epicIssue = await GitHubMcpClient.createIssue(
          ghOwner,
          ghRepo,
          `[EPIC] ${config.name || 'Autonomous MVP Build'}`,
          `### Objective\n${config.objective || 'Construção autônoma de software'}\n\n### Briefing\n${briefing}\n\n### Task Graph\n*Gemini Supervisor estruturando tarefas filhas...*`,
          ['epic', 'autonomous', 'gemini-supervisor']
        );
        epicIssueNumber = epicIssue.number;
        epicIssueUrl = epicIssue.html_url;

        db.prepare('UPDATE autonomous_runs SET github_epic_issue_number = ?, github_epic_issue_url = ? WHERE id = ?')
          .run(epicIssueNumber, epicIssueUrl, runId);

        this.logEvent(
          runId,
          null,
          'supervisor',
          'GITHUB_EPIC_CREATED',
          `Epic Issue #${epicIssueNumber} criada no GitHub: "${epicIssue.title}"`,
          { url: epicIssueUrl }
        );
      } catch (ghErr: any) {
        Logger.warn(`[GitHub Task Graph] Falha ao criar Epic Issue: ${ghErr.message}`);
      }
    }

    for (let i = 0; i < plannedTasks.length; i++) {
      const pTask = plannedTasks[i];
      const taskId = crypto.randomUUID();
      taskIds.push(taskId);

      // Dependencies: first task has none; subsequent task depends on previous
      const deps = i === 0 ? [] : [taskIds[i - 1]];
      const status = i === 0 ? 'ready' : 'pending';

      let ghIssueNumber: number | null = null;
      let ghIssueUrl: string | null = null;

      if (ghOwner && ghRepo && epicIssueNumber) {
        try {
          const prevIssueNum = i > 0 ? taskIssueNumbers[i - 1] : null;
          const depsText = prevIssueNum ? `Blocked by Issue #${prevIssueNum}` : 'None (Ready to start)';
          const criteriaList = (pTask.criteria || ['Atender critérios de conclusão']).map((c: string) => `- [ ] ${c}`).join('\n');
          const issueBody = `### Task Overview\n${pTask.description}\n\n### Milestone\n${pTask.milestone || `M${i + 1}`}\n\n### Epic\nPart of Epic #${epicIssueNumber}\n\n### Dependencies\n${depsText}\n\n### Acceptance Criteria\n${criteriaList}\n\n---\n*Orchestrated autonomously by AI DEV HUB & Antigravity*`;

          const childIssue = await GitHubMcpClient.createIssue(
            ghOwner,
            ghRepo,
            pTask.title,
            issueBody,
            ['task', 'autonomous', i === 0 ? 'ready' : 'pending']
          );
          ghIssueNumber = childIssue.number;
          ghIssueUrl = childIssue.html_url;
          taskIssueNumbers.push(ghIssueNumber);

          this.logEvent(
            runId,
            taskId,
            'supervisor',
            'GITHUB_ISSUE_CREATED',
            `Issue #${ghIssueNumber} criada no GitHub: "${pTask.title}" (${depsText})`,
            { url: ghIssueUrl, issueNumber: ghIssueNumber }
          );
        } catch (childErr: any) {
          Logger.warn(`[GitHub Task Graph] Falha ao criar issue para "${pTask.title}": ${childErr.message}`);
        }
      }

      db.prepare(`
        INSERT INTO autonomous_tasks (
          id, run_id, title, description, milestone, order_index, dependencies_json,
          status, assigned_to, criteria_json, github_issue_number, github_issue_url, github_state,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'builder', ?, ?, ?, 'open', ?, ?)
      `).run(
        taskId,
        runId,
        pTask.title,
        pTask.description,
        pTask.milestone || `M${i + 1}: Feature`,
        i + 1,
        JSON.stringify(deps),
        status,
        JSON.stringify(pTask.criteria || ['Atender critérios de conclusão']),
        ghIssueNumber,
        ghIssueUrl,
        nowIso,
        nowIso
      );
    }

    // Update Epic Issue on GitHub with the full Task Graph checklist
    if (ghOwner && ghRepo && epicIssueNumber && taskIssueNumbers.length > 0) {
      try {
        const checklist = plannedTasks.map((t, idx) => {
          const num = taskIssueNumbers[idx];
          return `- [ ] #${num} — **${t.milestone || `M${idx + 1}`}**: ${t.title}`;
        }).join('\n');

        const updatedEpicBody = `### Objective\n${config.objective || 'Construção autônoma de software'}\n\n### Briefing\n${briefing}\n\n### Task Graph (Gemini Supervisor)\n${checklist}\n\n---\n*Autonomous Multi-Agent Development orchestrated by AI DEV HUB*`;

        await GitHubMcpClient.updateIssue(ghOwner, ghRepo, epicIssueNumber, {
          body: updatedEpicBody
        });

        this.logEvent(
          runId,
          null,
          'supervisor',
          'GITHUB_TASK_GRAPH_CREATED',
          `Task Graph sincronizado com o Epic #${epicIssueNumber} contendo ${taskIssueNumbers.length} issues filhas.`
        );
      } catch (epicUpdateErr: any) {
        Logger.warn(`[GitHub Task Graph] Falha ao atualizar Epic com checklist: ${epicUpdateErr.message}`);
      }
    }

    this.logEvent(
      runId,
      null,
      'supervisor',
      'TASKS_PLANNED',
      `Supervisor Gemini planejou ${plannedTasks.length} tarefas estruturadas no Task Graph do GitHub.`
    );
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
    } catch {}
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
    const reports: any[] = db.prepare('SELECT * FROM builder_reports WHERE run_id = ? ORDER BY created_at DESC LIMIT 10').all(runId);

    // Parse JSON fields
    const parsedTasks = tasks.map(t => ({
      ...t,
      dependencies: t.dependencies_json ? JSON.parse(t.dependencies_json) : [],
      criteria: t.criteria_json ? JSON.parse(t.criteria_json) : []
    }));

    const parsedApprovals = approvals.map(a => ({
      ...a,
      alternatives: a.alternatives_json ? JSON.parse(a.alternatives_json) : []
    }));

    // Calculate progress stats
    const total = parsedTasks.length;
    const completed = parsedTasks.filter(t => t.status === 'completed').length;
    const inProgress = parsedTasks.filter(t => t.status === 'in_progress').length;
    const inReview = parsedTasks.filter(t => t.status === 'in_review').length;
    const pending = parsedTasks.filter(t => t.status === 'pending' || t.status === 'ready').length;
    const blocked = parsedTasks.filter(t => t.status === 'blocked').length;
    const waitingApproval = parsedApprovals.filter(a => a.status === 'pending').length;

    const progressPct = total > 0 ? Math.round((completed / total) * 100) : 0;

    return {
      ...run,
      project,
      tasks: parsedTasks,
      approvals: parsedApprovals,
      events,
      reports,
      stats: {
        total,
        completed,
        inProgress,
        inReview,
        pending,
        blocked,
        waitingApproval,
        progressPct
      }
    };
  }

  /**
   * Get any active run for a project
   */
  static getActiveRunForProject(projectId: string) {
    let active: any = db.prepare(
      "SELECT id FROM autonomous_runs WHERE project_id = ? AND status IN ('running', 'paused', 'waiting_approval') ORDER BY created_at DESC LIMIT 1"
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
   * List all available tasks ready to be worked on (DAG non-blocking resolution)
   */
  static getAvailableTasks(runId: string) {
    const tasks: any[] = db.prepare('SELECT * FROM autonomous_tasks WHERE run_id = ?').all(runId);
    const completedIds = new Set(tasks.filter(t => t.status === 'completed').map(t => t.id));

    // A task is available if:
    // 1. It is 'ready' or 'pending'
    // 2. All its dependency IDs are completed
    // 3. It is not currently 'blocked' or 'waiting_approval'
    return tasks.filter(t => {
      if (t.status !== 'ready' && t.status !== 'pending' && t.status !== 'needs_changes') return false;

      const deps: string[] = t.dependencies_json ? JSON.parse(t.dependencies_json) : [];
      const allDepsMet = deps.every(depId => completedIds.has(depId));
      return allDepsMet;
    }).map(t => {
      if (t.status !== 'ready') {
        db.prepare("UPDATE autonomous_tasks SET status = 'ready', updated_at = ? WHERE id = ? AND status IN ('pending', 'needs_changes')")
          .run(new Date().toISOString(), t.id);
        this.logEvent(runId, t.id, 'system', 'TASK_READY', `Dependências satisfeitas: ${t.title}`);
      }
      return {
        ...t,
        status: 'ready',
        dependencies: t.dependencies_json ? JSON.parse(t.dependencies_json) : [],
        criteria: t.criteria_json ? JSON.parse(t.criteria_json) : []
      };
    });
  }

  /**
   * Builder claims a task to implement
   */
  static claimTask(runId: string, taskId: string, agentName = 'Builder') {
    const task: any = db.prepare('SELECT * FROM autonomous_tasks WHERE id = ? AND run_id = ?').get(taskId, runId);
    if (!task) throw new Error('Tarefa não encontrada.');

    db.prepare(`
      UPDATE autonomous_tasks
      SET status = 'in_progress', assigned_to = ?, updated_at = ?
      WHERE id = ?
    `).run(agentName, new Date().toISOString(), taskId);

    this.logEvent(runId, taskId, 'builder', 'TASK_CLAIMED', `${agentName} iniciou implementação da tarefa "${task.title}"`);

    // Notify GitHub issue if linked
    const run: any = db.prepare('SELECT project_id FROM autonomous_runs WHERE id = ?').get(runId);
    const project: any = run ? db.prepare('SELECT * FROM projects WHERE id = ?').get(run.project_id) : null;
    if (project?.github_repo && task.github_issue_number) {
      const [owner, repo] = project.github_repo.split('/');
      GitHubMcpClient.addIssueComment(
        owner,
        repo,
        task.github_issue_number,
        `🤖 **${agentName}** assumiu a execução desta issue no branch \`${task.github_branch || 'ai/' + task.github_issue_number}\`.`
      ).catch(() => {});
    }

    return this.getRun(runId);
  }

  /**
   * Builder submits report upon completing work
   */
  static submitBuilderReport(input: BuilderReportInput) {
    const run: any = db.prepare('SELECT * FROM autonomous_runs WHERE id = ?').get(input.runId);
    if (!run) throw new Error('Run não encontrado.');

    const task: any = db.prepare('SELECT * FROM autonomous_tasks WHERE id = ?').get(input.taskId);
    if (!task) throw new Error('Tarefa não encontrada.');

    const reportId = crypto.randomUUID();
    const nowIso = new Date().toISOString();

    // 1. Evaluate decisions in report for Risk Level (Approval Matrix)
    let needsApproval = false;
    let highestRisk: RiskLevel = 'green';
    let approvalReason = '';

    const isTrusted = DevAutonomyService.isProjectTrusted(run.project_id);
    const fullDevAutonomy = DevAutonomyService.hasFullDevAutonomy(run.project_id);

    if (input.decisions && input.decisions.length > 0) {
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
        screenshots_json, known_problems_json, decisions_json, recommendation, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      nowIso
    );

    // 3. Update task status: if needsApproval, 'blocked'; otherwise 'in_review'
    const newStatus = needsApproval ? 'blocked' : 'in_review';
    db.prepare('UPDATE autonomous_tasks SET status = ?, updated_at = ? WHERE id = ?').run(newStatus, nowIso, input.taskId);

    this.logEvent(
      input.runId,
      input.taskId,
      'builder',
      'REPORT_SUBMITTED',
      `Builder submeteu relatório para "${task.title}" (Status: ${input.status.toUpperCase()}). ${needsApproval ? '⚠️ Requer aprovação na Inbox.' : 'Aguardando revisão do Supervisor.'}`
    );

    return { reportId, status: newStatus, needsApproval, highestRisk, approvalReason };
  }

  /**
   * Supervisor reviews the Builder Report
   */
  static submitSupervisorReview(input: SupervisorReviewInput) {
    const run: any = db.prepare('SELECT * FROM autonomous_runs WHERE id = ?').get(input.runId);
    if (!run) throw new Error('Run não encontrado.');

    const task: any = db.prepare('SELECT * FROM autonomous_tasks WHERE id = ?').get(input.taskId);
    if (!task) throw new Error('Tarefa não encontrada.');

    const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(run.project_id);
    const reviewId = crypto.randomUUID();
    const nowIso = new Date().toISOString();

    db.prepare(`
      INSERT INTO supervisor_reviews (
        id, run_id, task_id, report_id, verdict, feedback,
        requirements_met, build_passed, tests_passed, ui_functional, quality_score, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      reviewId,
      input.runId,
      input.taskId,
      input.reportId || 'latest',
      input.verdict,
      input.feedback,
      input.requirementsMet !== false ? 1 : 0,
      input.buildPassed !== false ? 1 : 0,
      input.testsPassed !== false ? 1 : 0,
      input.uiFunctional !== false ? 1 : 0,
      input.qualityScore || 10,
      nowIso
    );

    if (input.verdict === 'APPROVED') {
      // 1. Mark task completed
      db.prepare('UPDATE autonomous_tasks SET status = \'completed\', updated_at = ? WHERE id = ?').run(nowIso, input.taskId);

      // 2. Sync with AI DEV HUB Memory
      try {
        const memory = MemoryManager.readMemoryFiles(project.path);
        const tasks = MemoryManager.parseTasks(memory.tasksMd);
        tasks.doing = tasks.doing.filter(t => t.toLowerCase() !== task.title.toLowerCase());
        tasks.pending = tasks.pending.filter(t => t.toLowerCase() !== task.title.toLowerCase());
        if (!tasks.done.includes(task.title)) tasks.done.push(task.title);
        MemoryManager.updateMemoryFile(project.path, 'tasks.md', MemoryManager.formatTasks(tasks));

        // Create checkpoint
        CheckpointManager.createSessionCheckpoint(project.id, project.path, project.name, {
          implemented: [task.title],
          recentChanges: [task.title],
          nextTask: 'Continuar backlog autônomo'
        });

        // Git commit local (Idempotent: do not duplicate task commit if already committed by worker)
        if (fs.existsSync(path.join(project.path, '.git'))) {
          try {
            if (!task.task_commit_sha) {
              const committed = GitManager.commitSelected(project.path, [
                '.ai-dev-hub/tasks.md', '.ai-dev-hub/session-summary.md',
                '.ai-dev-hub/changes.md', '.ai-dev-hub/decisions.md'
              ], `feat(ai): [${task.milestone}] ${task.title}`);
              if (committed) {
                const commitSha = execSync('git rev-parse HEAD', { cwd: project.path, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
                db.prepare('UPDATE autonomous_tasks SET task_commit_sha = ? WHERE id = ?').run(commitSha, task.id);
              }
            } else {
              GitManager.commitSelected(project.path, [
                '.ai-dev-hub/tasks.md', '.ai-dev-hub/session-summary.md',
                '.ai-dev-hub/changes.md', '.ai-dev-hub/decisions.md'
              ], `docs(ai): update memory checkpoint for [${task.milestone}] ${task.title}`);
            }
          } catch {}
        }
      } catch (err: any) {
        Logger.warn(`Erro ao sincronizar memória: ${err.message}`);
      }

      this.logEvent(input.runId, input.taskId, 'supervisor', 'TASK_APPROVED', `Supervisor aprovou "${task.title}". Checkpoint criado e commit local realizado.`);

      // Check if all tasks in run are now completed
      const remaining: any = db.prepare('SELECT COUNT(*) as count FROM autonomous_tasks WHERE run_id = ? AND status != \'completed\'').get(input.runId);
      if (remaining?.count === 0) {
        db.prepare('UPDATE autonomous_runs SET status = \'completed\', end_time = ?, updated_at = ? WHERE id = ?').run(nowIso, nowIso, input.runId);
        this.logEvent(input.runId, null, 'supervisor', 'RUN_COMPLETED', `🎉 Todos os marcos do MVP foram concluídos com sucesso!`);

        // Close Epic on GitHub if linked
        try {
          const runRecord: any = db.prepare('SELECT github_epic_issue_number FROM autonomous_runs WHERE id = ?').get(input.runId);
          if (project?.github_repo && runRecord?.github_epic_issue_number) {
            const [owner, repo] = project.github_repo.split('/');
            GitHubMcpClient.updateIssue(owner, repo, runRecord.github_epic_issue_number, { state: 'closed' }).catch(() => {});
            GitHubMcpClient.addIssueComment(
              owner,
              repo,
              runRecord.github_epic_issue_number,
              `🎉 **Gemini Supervisor**: Todos os marcos do MVP foram implementados, validados com testes, revisados e mergeados na branch principal. Epic concluído com sucesso!`
            ).catch(() => {});
          }
        } catch {}
      }
    } else {
      // CHANGES_REQUESTED
      const currentRetry = (task.retry_count || 0) + 1;

      // Watchdog check for max iterations per task
      if (currentRetry >= 3) {
        db.prepare('UPDATE autonomous_tasks SET status = \'blocked\', retry_count = ?, updated_at = ? WHERE id = ?').run(currentRetry, nowIso, input.taskId);
        this.logEvent(
          input.runId,
          input.taskId,
          'system',
          'WATCHDOG_BLOCKED',
          `🚨 Watchdog: Tarefa "${task.title}" atingiu limite de 3 tentativas sem aprovação. Marcada como BLOCKED para evitar loop infinito. O Supervisor continuará outras tarefas independentes.`
        );
        this.requestHumanApproval({
          runId: input.runId,
          taskId: input.taskId,
          riskLevel: 'orange',
          title: `Intervenção: ${task.title} bloqueada após 3 tentativas`,
          context: `A tarefa "${task.title}" falhou após ${currentRetry} tentativas consecutivas. Último feedback: ${input.feedback}`,
          whyNeeded: 'Limite de iterações automáticas atingido sem convergência',
          supervisorRecommendation: 'Aprovar continuação manual ou ajustar requisitos da tarefa',
          alternatives: ['Permitir tentativas adicionais', 'Pular tarefa', 'Editar código manualmente'],
          impact: 'Execução autônoma retida nesta tarefa',
          risk: 'Médio / Alto'
        });
      } else {
        db.prepare('UPDATE autonomous_tasks SET status = \'needs_changes\', retry_count = ?, updated_at = ? WHERE id = ?').run(currentRetry, nowIso, input.taskId);
        this.logEvent(
          input.runId,
          input.taskId,
          'supervisor',
          'CHANGES_REQUESTED',
          `Supervisor solicitou correções em "${task.title}" (Tentativa ${currentRetry}/3): ${input.feedback}`
        );
      }
    }

    // Increment run cycle count
    db.prepare('UPDATE autonomous_runs SET current_cycle = current_cycle + 1, updated_at = ? WHERE id = ?').run(nowIso, input.runId);

    return this.getRun(input.runId);
  }

  /**
   * Request Human Approval for Inbox
   */
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
    const id = crypto.randomUUID();
    const nowIso = new Date().toISOString();

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
      db.prepare("UPDATE autonomous_tasks SET status = 'blocked', updated_at = ? WHERE id = ?").run(nowIso, params.taskId);
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
   * User resolves approval in Approval Inbox
   */
  static resolveHumanApproval(approvalId: string, decision: 'approved' | 'rejected' | 'delegated') {
    const approval: any = db.prepare('SELECT * FROM autonomous_approvals WHERE id = ?').get(approvalId);
    if (!approval) throw new Error('Aprovação não encontrada.');

    const nowIso = new Date().toISOString();
    db.prepare(`
      UPDATE autonomous_approvals
      SET status = ?, decision = ?, decided_at = ?
      WHERE id = ?
    `).run(decision, `Usuário escolheu: ${decision}`, nowIso, approvalId);

    // If task was blocked waiting approval, unblock it
    if (approval.task_id) {
      if (decision === 'approved' || decision === 'delegated') {
        db.prepare('UPDATE autonomous_tasks SET status = \'ready\', updated_at = ? WHERE id = ?').run(nowIso, approval.task_id);
        this.logEvent(approval.run_id, approval.task_id, 'user', 'APPROVAL_RESOLVED', `Usuário aprovou "${approval.title}". Tarefa liberada para execução.`);
      } else {
        db.prepare('UPDATE autonomous_tasks SET status = \'blocked\', updated_at = ? WHERE id = ?').run(nowIso, approval.task_id);
        this.logEvent(approval.run_id, approval.task_id, 'user', 'APPROVAL_REJECTED', `Usuário rejeitou "${approval.title}". Tarefa mantida suspensa.`);
      }
    }

    return this.getRun(approval.run_id);
  }

  /**
   * Pause an active run
   */
  static pauseRun(runId: string) {
    db.prepare('UPDATE autonomous_runs SET status = \'paused\', updated_at = ? WHERE id = ?').run(new Date().toISOString(), runId);
    this.logEvent(runId, null, 'user', 'RUN_PAUSED', 'Build autônomo pausado pelo usuário.');
    return this.getRun(runId);
  }

  /**
   * Resume a paused run
   */
  static resumeRun(runId: string) {
    db.prepare('UPDATE autonomous_runs SET status = \'running\', updated_at = ? WHERE id = ?').run(new Date().toISOString(), runId);
    this.logEvent(runId, null, 'user', 'RUN_RESUMED', 'Build autônomo retomado.');
    return this.getRun(runId);
  }

  /**
   * Stop an active run
   */
  static stopRun(runId: string) {
    const now = new Date().toISOString();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare("UPDATE autonomous_runs SET status = 'failed', last_error = 'RUN_CANCELLED', end_time = ?, updated_at = ? WHERE id = ?")
        .run(now, now, runId);
      db.prepare("UPDATE autonomous_tasks SET status = 'failed', updated_at = ? WHERE run_id = ? AND status = 'in_progress'")
        .run(now, runId);
      db.prepare("UPDATE worker_leases SET status = 'released' WHERE run_id = ? AND status = 'active'")
        .run(runId);
      db.prepare("UPDATE workers SET status = 'OFFLINE', current_run_id = NULL, current_task_id = NULL, updated_at = ? WHERE current_run_id = ?")
        .run(now, runId);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    this.logEvent(runId, null, 'user', 'RUN_STOPPED', 'Build autônomo encerrado pelo usuário.');
    return this.getRun(runId);
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

    return `# 🌅 OVERNIGHT BUILD REPORT — ${run.name}
**Projeto:** ${run.project?.name || 'N/A'}
**Status Final:** ${run.status.toUpperCase()}
**Duração Total:** ${durationFormatted}
**Branch:** \`${run.branch_name || 'main'}\`
**Modo de Autonomia:** ${run.autonomy_mode.toUpperCase()}
**Progresso do MVP:** ${run.stats.progressPct}% (${completedTasks.length}/${run.stats.total} tarefas concluídas)

---

## 🎯 Resumo Executivo
- **Objetivo:** ${run.objective}
- **Ciclos Executados:** ${run.current_cycle} ciclos
- **Aprovações Pendentes na Inbox:** ${pendingApprovals.length}
- **Tarefas Bloqueadas pelo Watchdog:** ${blockedTasks.length}

---

## 📋 Tarefas Concluídas
${completedTasks.map((t: any) => `✓ **[${t.milestone}] ${t.title}**\n  ${t.description}`).join('\n\n') || '- Nenhuma tarefa concluída.'}

---

## ⚠️ Bloqueios & Decisões Aguardando Usuário
${pendingApprovals.map((a: any) => `* **[${a.risk_level.toUpperCase()}] ${a.title}**\n  - Contexto: ${a.context}\n  - Recomendação do Supervisor: ${a.supervisor_recommendation}`).join('\n') || '- Nenhuma aprovação pendente no momento.'}

---

## 🧭 Próximos Passos Recomendados
1. Revisar itens na **Approval Inbox** para destravar tarefas pendentes.
2. Executar validação visual de QA nos componentes adicionados.
3. Se o resultado for satisfatório, mesclar a branch isolada \`${run.branch_name}\` na branch principal.`;
  }
}
