// server/src/projectContextBridge.ts
// Authoritative bridge connecting the active project state, persistent memory, runs, logs, and evidence.

import path from 'node:path';
import fs from 'node:fs';
import { db, getHubDataDir } from './db.js';
import { MemoryManager } from './memoryManager.js';
import { GitManager } from './gitManager.js';
import { AutonomousManager } from './autonomousManager.js';

export interface ProjectContextSnapshot {
  project: {
    id: string;
    name: string;
    path: string;
    objective: string;
    stack: string | null;
    status: string;
  };
  memory: {
    projectMd: string;
    architectureMd: string;
    decisionsMd: string;
    tasksMd: string;
    recentDecisions: string[];
  };
  git: {
    branch: string | null;
    lastCommitHash: string | null;
    lastCommitMessage: string | null;
    changedFilesCount: number;
  };
  run: {
    id: string | null;
    status: string | null;
    objective: string | null;
    lastError: string | null;
    nextAction: string | null;
    currentTaskTitle: string | null;
    consecutiveFailures: number;
    tasksCount: number;
    completedCount: number;
    inProgressCount: number;
    failedOrBlockedCount: number;
  } | null;
  tasks: Array<{
    id: string;
    title: string;
    status: string;
    milestone: string;
    orderIndex: number;
    criteria: string[];
    dependencies: string[];
  }>;
  latestEvaluation: {
    verdict: string;
    taskIsDone: boolean;
    exitCode: number | null;
    failedCriteria: string[];
    passedCriteria: string[];
    notes: string | null;
    executedCommands: string[];
  } | null;
  latestReview: {
    verdict: string;
    feedback: string;
    qualityScore: number | null;
    createdAt: string;
  } | null;
  recentEvents: Array<{
    eventType: string;
    agentRole: string;
    message: string;
    createdAt: string;
  }>;
  logs: {
    backendLogPath: string;
    dbPath: string;
    terminalLogsDir: string;
    projectMemoryDir: string;
  };
  recentChatHistory: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
}

export class ProjectContextBridge {
  /**
   * Retrieves an authoritative, complete, isolated snapshot for a specific project
   */
  static getSnapshot(projectId: string): ProjectContextSnapshot | null {
    if (!projectId) return null;

    const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
    if (!project) return null;

    // 1. Read persistent memory markdown files
    const memory = MemoryManager.readMemoryFiles(project.path);
    const recentDecisions: string[] = [];
    if (memory.decisionsMd) {
      const lines = memory.decisionsMd.split('\n');
      for (const line of lines) {
        if (line.includes('DECISION_') || line.startsWith('- **Decisão:') || line.startsWith('- Decisão:')) {
          recentDecisions.push(line.trim());
        }
      }
    }

    // 2. Git status
    let gitInfo: { branch: string | null; lastCommit: any; changedFiles: any[] } = { branch: 'main', lastCommit: null, changedFiles: [] };
    try {
      gitInfo = GitManager.getGitInfo(project.path);
    } catch {}

    // 3. Autonomous Run (Active or Latest)
    const activeRun = AutonomousManager.getActiveRunForProject(projectId);
    const latestRun: any = activeRun || db.prepare(
      'SELECT * FROM autonomous_runs WHERE project_id = ? ORDER BY created_at DESC LIMIT 1'
    ).get(projectId);

    let runData: ProjectContextSnapshot['run'] = null;
    const taskList: ProjectContextSnapshot['tasks'] = [];
    let latestEvaluation: ProjectContextSnapshot['latestEvaluation'] = null;
    let latestReview: ProjectContextSnapshot['latestReview'] = null;
    let recentEvents: ProjectContextSnapshot['recentEvents'] = [];

    if (latestRun) {
      // Tasks breakdown
      const taskRows: any[] = db.prepare(
        'SELECT * FROM autonomous_tasks WHERE run_id = ? ORDER BY order_index ASC'
      ).all(latestRun.id);

      let completedCount = 0;
      let inProgressCount = 0;
      let failedOrBlockedCount = 0;
      let currentTaskTitle = latestRun.current_task || null;

      for (const t of taskRows) {
        let criteria: string[] = [];
        try {
          if (t.criteria_json) criteria = JSON.parse(t.criteria_json);
        } catch {}

        let dependencies: string[] = [];
        try {
          if (t.dependencies_json) dependencies = JSON.parse(t.dependencies_json);
        } catch {}

        taskList.push({
          id: t.id,
          title: t.title,
          status: t.status,
          milestone: t.milestone,
          orderIndex: t.order_index,
          criteria,
          dependencies
        });

        if (t.status === 'completed') completedCount++;
        else if (['in_progress', 'ready', 'in_review'].includes(t.status)) {
          inProgressCount++;
          if (!currentTaskTitle) currentTaskTitle = t.title;
        } else if (['error', 'blocked', 'needs_changes'].includes(t.status)) {
          failedOrBlockedCount++;
        }
      }

      runData = {
        id: latestRun.id,
        status: latestRun.status,
        objective: latestRun.objective,
        lastError: latestRun.last_error,
        nextAction: latestRun.next_action,
        currentTaskTitle,
        consecutiveFailures: latestRun.consecutive_failures || 0,
        tasksCount: taskRows.length,
        completedCount,
        inProgressCount,
        failedOrBlockedCount
      };

      // Evaluation Result
      const evalRow: any = db.prepare(
        'SELECT * FROM evaluation_results WHERE run_id = ? ORDER BY created_at DESC LIMIT 1'
      ).get(latestRun.id);

      if (evalRow) {
        let failedCrit: string[] = [];
        let passedCrit: string[] = [];
        let execCmds: string[] = [];
        try { if (evalRow.failed_criteria_json) failedCrit = JSON.parse(evalRow.failed_criteria_json); } catch {}
        try { if (evalRow.passed_criteria_json) passedCrit = JSON.parse(evalRow.passed_criteria_json); } catch {}
        try { if (evalRow.executed_commands_json) execCmds = JSON.parse(evalRow.executed_commands_json); } catch {}

        latestEvaluation = {
          verdict: evalRow.verdict,
          taskIsDone: Boolean(evalRow.task_is_done),
          exitCode: evalRow.exit_code,
          failedCriteria: failedCrit,
          passedCriteria: passedCrit,
          notes: evalRow.evaluator_notes || evalRow.actual,
          executedCommands: execCmds
        };
      }

      // Review Result
      const reviewRow: any = db.prepare(
        'SELECT * FROM supervisor_reviews WHERE run_id = ? ORDER BY created_at DESC LIMIT 1'
      ).get(latestRun.id);

      if (reviewRow) {
        latestReview = {
          verdict: reviewRow.verdict,
          feedback: reviewRow.feedback,
          qualityScore: reviewRow.quality_score,
          createdAt: reviewRow.created_at
        };
      }

      // Recent events
      const eventRows: any[] = db.prepare(
        'SELECT event_type, agent_role, message, created_at FROM autonomous_events WHERE run_id = ? ORDER BY created_at DESC LIMIT 6'
      ).all(latestRun.id);

      recentEvents = eventRows.map(e => ({
        eventType: e.event_type,
        agentRole: e.agent_role,
        message: e.message,
        createdAt: e.created_at
      }));
    }

    // 4. File and Logging paths
    const hubDataDir = getHubDataDir();
    const backendLogPath = path.join(hubDataDir, 'logs', 'backend.log');
    const dbPath = path.join(hubDataDir, 'hub.db');
    const projectMemoryDir = path.join(project.path, '.ai-dev-hub');
    const terminalLogsDir = path.join(projectMemoryDir, 'terminal-logs');

    // 5. Recent chat history (last 6 messages)
    const recentMsgs: any[] = db.prepare(
      'SELECT role, content FROM messages WHERE project_id = ? ORDER BY created_at DESC LIMIT 6'
    ).all(projectId);

    const recentChatHistory: Array<{ role: 'user' | 'assistant'; content: string }> = recentMsgs.reverse().map(m => ({
      role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: String(m.content || '')
    }));

    return {
      project: {
        id: project.id,
        name: project.name,
        path: project.path,
        objective: project.objective || 'Desenvolvimento contínuo de software',
        stack: project.stack || null,
        status: project.status || 'active'
      },
      memory: {
        projectMd: memory.projectMd || '',
        architectureMd: memory.architectureMd || '',
        decisionsMd: memory.decisionsMd || '',
        tasksMd: memory.tasksMd || '',
        recentDecisions
      },
      git: {
        branch: gitInfo.branch,
        lastCommitHash: gitInfo.lastCommit?.hash || null,
        lastCommitMessage: gitInfo.lastCommit?.message || null,
        changedFilesCount: gitInfo.changedFiles?.length || 0
      },
      run: runData,
      tasks: taskList,
      latestEvaluation,
      latestReview,
      recentEvents,
      logs: {
        backendLogPath,
        dbPath,
        terminalLogsDir,
        projectMemoryDir
      },
      recentChatHistory
    };
  }

  /**
   * Builds formatted engineering context to supply to the Antigravity Conversational Agent
   */
  static formatContextForAgent(snapshot: ProjectContextSnapshot): string {
    const p = snapshot.project;
    const r = snapshot.run;
    const g = snapshot.git;
    const evalRes = snapshot.latestEvaluation;
    const rev = snapshot.latestReview;

    const sections: string[] = [
      `=== CONTEXTO AUTORITATIVO DO PROJETO DECOHUB ===`,
      `PROJETO: ${p.name} (ID: ${p.id})`,
      `DIRETÓRIO: ${p.path}`,
      `OBJETIVO: ${p.objective}`,
      `STACK: ${p.stack || 'Não definida'}`,
      `GIT: Branch "${g.branch || 'main'}" | Último Commit: ${g.lastCommitHash?.slice(0, 7) || 'Nenhum'} | Arquivos Modificados: ${g.changedFilesCount}`,
      ``,
      `--- ESTADO OPERACIONAL DO RUN ---`
    ];

    if (!r) {
      sections.push(`Status: Nenhum ciclo autônomo registrado no momento. Sistema pronto para novo plano.`);
    } else {
      sections.push(
        `- Run ID: ${r.id?.slice(0, 8)}`,
        `- Status Atual: ${r.status?.toUpperCase()}`,
        `- Tarefa Ativa: ${r.currentTaskTitle ? `"${r.currentTaskTitle}"` : 'Nenhuma em execução'}`,
        `- Progresso: ${r.completedCount} de ${r.tasksCount} tarefas concluídas (${r.failedOrBlockedCount} com bloqueio/revisão pendente)`,
        `- Próxima Ação Planejada: ${r.nextAction || 'Aguardando ação'}`
      );
      if (r.lastError) {
        sections.push(`- ÚLTIMO ERRO / BLOQUEIO REGISTRADO: ${r.lastError}`);
      }
    }

    if (evalRes) {
      sections.push(
        ``,
        `--- EVIDÊNCIA INDEPENDENTE (EVALUATOR) ---`,
        `- Veredito: ${evalRes.verdict} (Task Concluída: ${evalRes.taskIsDone ? 'Sim' : 'Não'})`,
        `- Códigos de Saída: Exit Code ${evalRes.exitCode ?? 'N/A'}`,
        evalRes.failedCriteria.length > 0 ? `- Critérios Reprovados: ${evalRes.failedCriteria.join('; ')}` : `- Critérios Reprovados: Nenhum`,
        `- Observação do Avaliador: ${evalRes.notes || 'Sem observações'}`
      );
    }

    if (rev) {
      sections.push(
        ``,
        `--- PARECER DO REVIEW INDEPENDENTE ---`,
        `- Decisão: ${rev.verdict}`,
        `- Feedback: ${rev.feedback}`
      );
    }

    if (snapshot.memory.recentDecisions.length > 0) {
      sections.push(
        ``,
        `--- DECISÕES ARQUITETURAIS REGISTRADAS ---`,
        ...snapshot.memory.recentDecisions.slice(-5)
      );
    }

    sections.push(
      ``,
      `--- LOCALIZAÇÃO DE LOGS ---`,
      `- Log do Backend: ${snapshot.logs.backendLogPath}`,
      `- Banco SQLite: ${snapshot.logs.dbPath}`,
      `- Logs de Terminal de Testes: ${snapshot.logs.terminalLogsDir}`
    );

    return sections.join('\n');
  }
}
