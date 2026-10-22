import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { db } from './db.js';
import { MemoryManager } from './memoryManager.js';
import { GitManager } from './gitManager.js';
import { CheckpointManager } from './checkpointManager.js';
import { Logger } from './logger.js';
import { SecurityManager } from './security.js';

export interface StartSessionResult {
  sessionId: string;
  session_id: string;
  sessionNumber: number;
  projectId: string;
  projectName: string;
  startTime: string;
  initialGitHead: string | null;
  agentName: string;
  initialContext: string;
}

export interface EndSessionParams {
  sessionId?: string;
  session_id?: string;
  implemented?: string[];
  filesChanged?: string[];
  files_changed?: string[];
  problems?: string[];
  decisions?: string[];
  nextTask?: string;
  next_task?: string;
  notes?: string;
}

export interface SearchResultItem {
  source: 'project' | 'architecture' | 'decisions' | 'tasks' | 'changes' | 'session-summary' | 'session_history' | 'git_log';
  title: string;
  excerpt: string;
  matchScore: number;
}

export class SessionManager {
  static resolveProject(projectIdOrPath?: string): any {
    if (projectIdOrPath && projectIdOrPath.trim()) {
      const clean = projectIdOrPath.trim();
      // 1. Try finding by ID
      let project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(clean);
      if (project) return project;

      // 2. Try finding by path
      try {
        const resolved = path.resolve(clean);
        project = db.prepare('SELECT * FROM projects WHERE path = ?').get(resolved);
        if (project) return project;
      } catch {}

      // 3. Try finding by case-insensitive name
      project = db.prepare('SELECT * FROM projects WHERE LOWER(name) = LOWER(?)').get(clean);
      if (project) return project;

      // 4. Try finding if clean is a taskId
      try {
        const taskRow: any = db.prepare('SELECT project_id FROM autonomous_tasks WHERE id = ? OR id LIKE ? LIMIT 1').get(clean, `${clean}%`);
        if (taskRow?.project_id) {
          project = db.prepare('SELECT * FROM projects WHERE id = ?').get(taskRow.project_id);
          if (project) return project;
        }
      } catch {}
    }

    // Auto-fallback: Check active autonomous run
    try {
      const activeRun: any = db.prepare("SELECT project_id FROM autonomous_runs WHERE status = 'running' ORDER BY updated_at DESC LIMIT 1").get();
      if (activeRun?.project_id) {
        const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(activeRun.project_id);
        if (project) return project;
      }
    } catch {}

    // Fallback: Check if there is only 1 active project
    try {
      const activeProjects: any[] = db.prepare("SELECT * FROM projects WHERE status = 'active' LIMIT 2").all();
      if (activeProjects.length === 1) {
        return activeProjects[0];
      }
    } catch {}

    if (!projectIdOrPath) {
      throw new Error('ID ou caminho do projeto é obrigatório.');
    }
    throw new Error(`Projeto não encontrado para o identificador ou caminho: "${projectIdOrPath}"`);
  }

  static getGitHead(projectPath: string): string | null {
    try {
      if (!fs.existsSync(path.join(projectPath, '.git'))) return null;
      return execSync('git rev-parse HEAD', { cwd: projectPath, encoding: 'utf-8', timeout: 3000 }).trim();
    } catch {
      return null;
    }
  }

  static startSession(projectIdOrPath: string, agentName = 'AI Agent'): StartSessionResult {
    const project = this.resolveProject(projectIdOrPath);
    const nowIso = new Date().toISOString();
    const sessionId = crypto.randomUUID();

    // Determine session number
    const countRes: any = db.prepare('SELECT COUNT(*) as count FROM sessions WHERE project_id = ?').get(project.id);
    const sessionNumber = (countRes?.count || 0) + 1;

    // Initial git state
    const initialGitHead = this.getGitHead(project.path);
    const gitInfo = GitManager.getGitInfo(project.path);

    // Initial tasks snapshot
    const memory = MemoryManager.readMemoryFiles(project.path);
    const parsedTasks = MemoryManager.parseTasks(memory.tasksMd);

    // Read last checkpoint for baseline
    const lastSession: any = db.prepare(
      'SELECT checkpoint_raw FROM sessions WHERE project_id = ? ORDER BY session_number DESC LIMIT 1'
    ).get(project.id);
    const baselineCheckpoint = lastSession?.checkpoint_raw || memory.sessionSummaryMd || 'Nenhum checkpoint anterior.';

    // Insert active session in SQLite
    db.prepare(`
      INSERT INTO sessions (
        id, project_id, session_number, created_at, summary,
        implemented, changes, affected_files, completed_tasks, next_step,
        checkpoint_raw, agent_name, start_time, end_time, initial_git_head, final_git_head, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, 'active')
    `).run(
      sessionId,
      project.id,
      sessionNumber,
      nowIso,
      `Sessão #${sessionNumber} iniciada por ${agentName}`,
      JSON.stringify([]),
      JSON.stringify(gitInfo.changedFiles.map(f => f.path)),
      JSON.stringify([]),
      JSON.stringify(parsedTasks.done),
      parsedTasks.doing[0] || parsedTasks.pending[0] || 'Continuar backlog',
      baselineCheckpoint,
      agentName,
      nowIso,
      initialGitHead
    );

    Logger.info(`Sessão #${sessionNumber} iniciada para ${project.name} por ${agentName}`, { sessionId });

    // Initial context prompt (compact)
    const initialContext = this.getProjectContext(project.id, 'compact');

    return {
      sessionId,
      session_id: sessionId,
      sessionNumber,
      projectId: project.id,
      projectName: project.name,
      startTime: nowIso,
      initialGitHead,
      agentName,
      initialContext
    };
  }

  static endSession(params: EndSessionParams): {
    sessionId: string;
    session_id?: string;
    sessionNumber: number;
    session_number?: number;
    checkpointText: string;
    gitDiffSummary: string;
    updatedFiles: string[];
  } {
    const targetSessionId = params.sessionId || params.session_id;
    if (!targetSessionId) {
      throw new Error('Parâmetro "session_id" é obrigatório.');
    }

    const session: any = db.prepare('SELECT * FROM sessions WHERE id = ?').get(targetSessionId);
    if (!session) {
      throw new Error(`Sessão não encontrada: "${targetSessionId}"`);
    }

    const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(session.project_id);
    if (!project) throw new Error('Projeto da sessão não encontrado.');

    const nowIso = new Date().toISOString();
    const updatedFiles: string[] = [];

    const filesChanged = params.filesChanged || params.files_changed || [];
    const nextTask = params.nextTask || params.next_task;

    // 1. Update changes.md
    if (filesChanged && filesChanged.length > 0) {
      const memory = MemoryManager.readMemoryFiles(project.path);
      const changesBlock = `\n### [${new Date().toLocaleDateString('pt-BR')}] Sessão #${session.session_number} (${session.agent_name || 'AI'})\n` +
        filesChanged.map(f => `- \`${f}\``).join('\n') +
        (params.notes ? `\n*Nota:* ${params.notes}` : '') + '\n';

      const newChangesMd = memory.changesMd.trim() + '\n' + changesBlock;
      MemoryManager.updateMemoryFile(project.path, 'changes.md', newChangesMd);
      updatedFiles.push('changes.md');
    }

    // 2. Update decisions.md
    if (params.decisions && params.decisions.length > 0) {
      const memory = MemoryManager.readMemoryFiles(project.path);
      const decisionsBlock = `\n### [${new Date().toLocaleDateString('pt-BR')}] Decisões da Sessão #${session.session_number}\n` +
        params.decisions.map(d => `- **Decisão:** ${d}`).join('\n') + '\n';

      const newDecisionsMd = memory.decisionsMd.trim() + '\n' + decisionsBlock;
      MemoryManager.updateMemoryFile(project.path, 'decisions.md', newDecisionsMd);
      updatedFiles.push('decisions.md');
    }

    // 3. Update tasks.md
    if (params.implemented && params.implemented.length > 0) {
      const memory = MemoryManager.readMemoryFiles(project.path);
      const tasks = MemoryManager.parseTasks(memory.tasksMd);

      for (const impl of params.implemented) {
        // Move from doing/pending to done
        tasks.doing = tasks.doing.filter(t => t.toLowerCase() !== impl.toLowerCase());
        tasks.pending = tasks.pending.filter(t => t.toLowerCase() !== impl.toLowerCase());
        if (!tasks.done.some(t => t.toLowerCase() === impl.toLowerCase())) {
          tasks.done.push(impl);
        }
      }

      if (params.nextTask) {
        // Ensure next task is in doing or pending
        if (!tasks.doing.includes(params.nextTask) && !tasks.pending.includes(params.nextTask)) {
          tasks.doing.push(params.nextTask);
        }
      }

      const newTasksMd = MemoryManager.formatTasks(tasks);
      MemoryManager.updateMemoryFile(project.path, 'tasks.md', newTasksMd);
      updatedFiles.push('tasks.md');
    }

    // 4. Git diff and Final Git HEAD
    const finalGitHead = this.getGitHead(project.path);
    let gitDiffSummary = 'Sem repositório Git ou sem alterações commitadas.';
    try {
      if (session.initial_git_head && finalGitHead && session.initial_git_head !== finalGitHead) {
        gitDiffSummary = execSync(
          `git diff --stat ${session.initial_git_head}..${finalGitHead}`,
          { cwd: project.path, encoding: 'utf-8', timeout: 4000 }
        ).trim() || 'Commits realizados sem diff de worktree.';
      } else {
        const gitInfo = GitManager.getGitInfo(project.path);
        gitDiffSummary = `${gitInfo.statusSummary.modified} modificados, ${gitInfo.statusSummary.newFiles} novos, ${gitInfo.statusSummary.deleted} deletados.`;
      }
    } catch {
      // ignore
    }

    // 5. Generate Checkpoint & Update session-summary.md
    const checkpointResult = CheckpointManager.createSessionCheckpoint(
      project.id,
      project.path,
      project.name,
      {
        implemented: params.implemented || [],
        recentChanges: filesChanged,
        problems: params.problems || ['Nenhum bloqueio registrado'],
        nextTask: nextTask,
        decisions: params.decisions || []
      }
    );
    updatedFiles.push('session-summary.md');

    // 6. Update session record in SQLite to completed
    db.prepare(`
      UPDATE sessions
      SET summary = ?,
          implemented = ?,
          changes = ?,
          affected_files = ?,
          next_step = ?,
          checkpoint_raw = ?,
          end_time = ?,
          final_git_head = ?,
          status = 'completed'
      WHERE id = ?
    `).run(
      `Sessão #${session.session_number} finalizada: ${(params.implemented || []).slice(0, 2).join(', ') || 'Rotinas concluídas'}`,
      JSON.stringify(params.implemented || []),
      JSON.stringify(filesChanged),
      JSON.stringify(filesChanged),
      nextTask || 'Continuar backlog de tarefas',
      checkpointResult.checkpointText,
      nowIso,
      finalGitHead || null,
      targetSessionId
    );

    Logger.success(`Sessão #${session.session_number} finalizada para ${project.name}`, { sessionId: targetSessionId });

    return {
      sessionId: targetSessionId,
      session_id: targetSessionId,
      sessionNumber: session.session_number,
      session_number: session.session_number,
      checkpointText: checkpointResult.checkpointText,
      gitDiffSummary,
      updatedFiles
    };
  }

  static smartCheckpoint(projectIdOrPath: string): {
    sessionNumber: number;
    checkpointText: string;
    autoDetected: {
      implemented: string[];
      recentChanges: string[];
      problems: string[];
      nextTask: string;
      decisions: string[];
    };
  } {
    const project = this.resolveProject(projectIdOrPath);
    const memory = MemoryManager.readMemoryFiles(project.path);
    const parsedTasks = MemoryManager.parseTasks(memory.tasksMd);
    const gitInfo = GitManager.getGitInfo(project.path);

    // Auto-detect implemented
    const implemented = parsedTasks.done.slice(-4);
    if (implemented.length === 0) implemented.push('Estrutura e configurações base');

    // Auto-detect recent changes from git or changes.md
    let recentChanges: string[] = [];
    if (gitInfo.changedFiles.length > 0) {
      recentChanges = gitInfo.changedFiles.slice(0, 8).map(f => `${f.path} (${f.status})`);
    } else {
      recentChanges = ['.ai-dev-hub/tasks.md', '.ai-dev-hub/session-summary.md'];
    }

    // Auto-detect next task
    const nextTask = parsedTasks.doing[0] || parsedTasks.pending[0] || 'Revisão e testes de integração';

    // Auto-detect decisions from decisions.md
    const decisionMatches = memory.decisionsMd.match(/- \*\*Decisão:\*\* (.*?)(?=\n|$)/g);
    const decisions = decisionMatches ? decisionMatches.slice(-3).map(d => d.replace('- **Decisão:** ', '').trim()) : ['Arquitetura local desacoplada'];

    // Auto-detect problems from session-summary.md
    const problemsMatch = memory.sessionSummaryMd.match(/PROBLEMAS:\s*\n([\s\S]*?)(?=\n[A-Z_ ]+:|$)/);
    let problems: string[] = [];
    if (problemsMatch) {
      problems = problemsMatch[1].split(/\r?\n/).map(l => l.replace(/^-\s*/, '').trim()).filter(Boolean);
    }
    if (problems.length === 0) problems = ['Nenhum erro bloqueante identificado no momento'];

    const cp = CheckpointManager.createSessionCheckpoint(project.id, project.path, project.name, {
      implemented,
      recentChanges,
      problems,
      nextTask,
      decisions
    });

    return {
      sessionNumber: cp.sessionNumber,
      checkpointText: cp.checkpointText,
      autoDetected: {
        implemented,
        recentChanges,
        problems,
        nextTask,
        decisions
      }
    };
  }

  static generateHandover(projectIdOrPath: string): string {
    const project = this.resolveProject(projectIdOrPath);
    const memory = MemoryManager.readMemoryFiles(project.path);
    const parsedTasks = MemoryManager.parseTasks(memory.tasksMd);
    const gitInfo = GitManager.getGitInfo(project.path);

    // Extract objective
    const objMatch = memory.projectMd.match(/## Objetivo Principal\s*\n([\s\S]*?)(?=\n##|$)/);
    const objective = objMatch ? objMatch[1].trim() : (project.objective || 'Desenvolvimento contínuo da aplicação.');

    // Extract architecture
    const archMatch = memory.architectureMd.match(/## Stack Tecnológica\s*\n([\s\S]*?)(?=\n## Componentes|$)/);
    const currentArch = archMatch ? archMatch[1].trim() : `Stack: ${project.stack || 'Geral'}`;

    // Extract problems
    const problemsMatch = memory.sessionSummaryMd.match(/PROBLEMAS:\s*\n([\s\S]*?)(?=\n[A-Z_ ]+:|$)/);
    const currentProblems = problemsMatch ? problemsMatch[1].trim() : '- Nenhum erro crítico bloqueante.';

    // Extract decisions
    const decisionMatches = memory.decisionsMd.match(/- \*\*Decisão:\*\* (.*?)(?=\n|$)/g);
    const importantDecisions = decisionMatches ? decisionMatches.slice(-4).join('\n') : '- Decisões registradas em decisions.md.';

    // Implemented
    const implementedStr = parsedTasks.done.length > 0
      ? parsedTasks.done.slice(-5).map(t => `- ${t}`).join('\n')
      : '- Configuração inicial do projeto';

    // Git state
    const gitStr = gitInfo.isGitRepo
      ? `Branch: ${gitInfo.branch || 'main'} | Modificados: ${gitInfo.statusSummary.modified} | Novos: ${gitInfo.statusSummary.newFiles} | Último commit: ${gitInfo.lastCommit?.hash || 'N/A'}`
      : 'Repositório Git não inicializado.';

    const currentTask = parsedTasks.doing[0] || parsedTasks.pending[0] || 'Continuar implementação do backlog.';

    return `YOU ARE CONTINUING AN EXISTING SOFTWARE PROJECT.

PROJECT:
${project.name} (Local: ${project.path})

OBJECTIVE:
${objective}

CURRENT ARCHITECTURE:
${currentArch}

WHAT HAS ALREADY BEEN IMPLEMENTED:
${implementedStr}

CURRENT PROBLEMS:
${currentProblems}

IMPORTANT DECISIONS:
${importantDecisions}

GIT STATE:
${gitStr}

CURRENT TASK:
${currentTask}

DO NOT:
- refazer tarefas concluídas;
- alterar arquitetura sem necessidade;
- ignorar decisões registradas.

START BY:
1. ler a memória do Hub (.ai-dev-hub/);
2. verificar Git;
3. validar estado atual;
4. continuar a próxima tarefa.`;
  }

  static getProjectContext(projectIdOrPath: string, mode: 'compact' | 'normal' | 'full' = 'normal'): string {
    const project = this.resolveProject(projectIdOrPath);
    const memory = MemoryManager.readMemoryFiles(project.path);
    const parsedTasks = MemoryManager.parseTasks(memory.tasksMd);
    const gitInfo = GitManager.getGitInfo(project.path);

    // LEVEL 1: Project Memory (Hot / Stable)
    const level1 = `[PROJECT]
Name: ${project.name}
Path: ${project.path}
Objective: ${project.objective || 'Verificar project.md'}

[ARCHITECTURE]
Stack: ${project.stack || 'Geral'}
Portas: Frontend: 5173 | Backend: 3001`;

    // LEVEL 2: Working Memory (Warm / Current)
    const nextTask = parsedTasks.doing[0] || parsedTasks.pending[0] || 'Nenhuma tarefa pendente';
    const activeTasks = [
      ...parsedTasks.doing.map(t => `[EM ANDAMENTO] ${t}`),
      ...parsedTasks.pending.slice(0, 3).map(t => `[PENDENTE] ${t}`)
    ].join('\n') || '- Nenhuma tarefa ativa';

    const recentDecisions = memory.decisionsMd.split(/\r?\n/)
      .filter(l => l.includes('- **Decisão:**') || l.includes('### ['))
      .slice(-4)
      .join('\n') || '- Sem decisões registradas.';

    const level2 = `[CURRENT WORKING MEMORY]
Active Task / Next Priority:
${nextTask}

Tasks Snapshot:
${activeTasks}

Recent Decisions:
${recentDecisions}

Git Status:
Branch: ${gitInfo.branch || 'main'} | Modificados: ${gitInfo.statusSummary.modified} | Novos: ${gitInfo.statusSummary.newFiles}`;

    if (mode === 'compact') {
      return `${level1}\n\n${level2}\n\n[DIRECTIVE]\nConsulte MCP get_tasks ou get_project_memory para aprofundar se necessário.`;
    }

    // LEVEL 3: History (Cold)
    let level3 = '';
    if (mode === 'normal') {
      level3 = `[LAST SESSION CHECKPOINT]
${memory.sessionSummaryMd.trim().slice(0, 800)}`;
    } else if (mode === 'full') {
      const pastSessions: any[] = db.prepare(
        'SELECT session_number, created_at, summary, next_step FROM sessions WHERE project_id = ? ORDER BY session_number DESC LIMIT 8'
      ).all(project.id);

      const sessionsTimeline = pastSessions.map(
        s => `Sessão #${s.session_number} (${new Date(s.created_at).toLocaleDateString('pt-BR')}): ${s.summary} -> Próximo: ${s.next_step}`
      ).join('\n');

      level3 = `[RECENT CHANGES]
${memory.changesMd.trim().slice(0, 1000)}

[SESSION TIMELINE (HISTÓRICO)]
${sessionsTimeline || 'Nenhuma sessão anterior arquivada.'}

[LAST CHECKPOINT COMPLETO]
${memory.sessionSummaryMd.trim()}`;
    }

    return `${level1}\n\n${level2}\n\n${level3}`;
  }

  static searchProjectContext(projectIdOrPath: string, query: string): SearchResultItem[] {
    const project = this.resolveProject(projectIdOrPath);
    if (!query || !query.trim()) return [];

    const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
    if (terms.length === 0) return [];

    const memory = MemoryManager.readMemoryFiles(project.path);
    const results: SearchResultItem[] = [];

    const checkFile = (source: SearchResultItem['source'], filename: string, content: string) => {
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lower = line.toLowerCase();
        let matches = 0;
        for (const term of terms) {
          if (lower.includes(term)) matches++;
        }
        if (matches > 0) {
          // Grab context around match
          const start = Math.max(0, i - 1);
          const end = Math.min(lines.length, i + 3);
          const excerpt = lines.slice(start, end).join('\n').trim();
          results.push({
            source,
            title: `${filename} (linha ~${i + 1})`,
            excerpt,
            matchScore: matches * 10
          });
        }
      }
    };

    checkFile('project', 'project.md', memory.projectMd);
    checkFile('architecture', 'architecture.md', memory.architectureMd);
    checkFile('decisions', 'decisions.md', memory.decisionsMd);
    checkFile('tasks', 'tasks.md', memory.tasksMd);
    checkFile('changes', 'changes.md', memory.changesMd);
    checkFile('session-summary', 'session-summary.md', memory.sessionSummaryMd);

    // Search past sessions in SQLite
    const sessions: any[] = db.prepare('SELECT session_number, summary, checkpoint_raw, created_at FROM sessions WHERE project_id = ?').all(project.id);
    for (const s of sessions) {
      const combined = `${s.summary} ${s.checkpoint_raw}`.toLowerCase();
      let matches = 0;
      for (const term of terms) {
        if (combined.includes(term)) matches++;
      }
      if (matches > 0) {
        results.push({
          source: 'session_history',
          title: `Histórico: Sessão #${s.session_number} (${new Date(s.created_at).toLocaleDateString('pt-BR')})`,
          excerpt: s.summary,
          matchScore: matches * 8
        });
      }
    }

    // Sort by match score and deduplicate
    return results.sort((a, b) => b.matchScore - a.matchScore).slice(0, 10);
  }
}
