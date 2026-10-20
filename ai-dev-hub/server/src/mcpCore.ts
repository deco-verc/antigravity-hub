import { db } from './db.js';
import { MemoryManager } from './memoryManager.js';
import { GitManager } from './gitManager.js';
import { ProjectAnalyzer } from './analyzer.js';
import { CheckpointManager } from './checkpointManager.js';
import { SessionManager } from './sessionManager.js';
import { AutonomousManager } from './autonomousManager.js';
import { SecurityManager } from './security.js';
import { Logger } from './logger.js';
import { GitHubMcpClient } from './githubMcpClient.js';
import crypto from 'node:crypto';

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
  handler: (args: any) => Promise<any> | any;
}

export class McpCore {
  private static tools: Map<string, McpToolDefinition> = new Map();
  private static lastCallTimestamp: string | null = null;
  private static totalCalls = 0;

  static registerTool(def: McpToolDefinition) {
    this.tools.set(def.name, def);
  }

  static getToolsList() {
    return Array.from(this.tools.values()).map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema
    }));
  }

  static async handleToolCall(name: string, args: any) {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool "${name}" não encontrada no AI DEV HUB MCP Server.`);
    }

    const start = Date.now();
    this.lastCallTimestamp = new Date().toISOString();
    this.totalCalls++;

    try {
      const result = await tool.handler(args || {});
      const duration = Date.now() - start;

      // Track in mcp_stats
      try {
        db.prepare(`
          INSERT INTO mcp_stats (id, tool_name, timestamp, duration_ms, status, project_id)
          VALUES (?, ?, ?, ?, 'success', ?)
        `).run(crypto.randomUUID(), name, new Date().toISOString(), duration, args?.project_id || null);
      } catch {}

      return result;
    } catch (err: any) {
      const duration = Date.now() - start;
      try {
        db.prepare(`
          INSERT INTO mcp_stats (id, tool_name, timestamp, duration_ms, status, project_id)
          VALUES (?, ?, ?, ?, 'error', ?)
        `).run(crypto.randomUUID(), name, new Date().toISOString(), duration, args?.project_id || null);
      } catch {}

      Logger.error(`Erro ao executar tool MCP "${name}": ${err.message}`);
      throw err;
    }
  }

  static getStats() {
    return {
      status: 'online',
      toolsCount: this.tools.size,
      totalCalls: this.totalCalls,
      lastCallTimestamp: this.lastCallTimestamp
    };
  }

  static initTools() {
    this.tools.clear();

    // 1. get_projects
    this.registerTool({
      name: 'get_projects',
      description: 'Lista projetos registrados no AI DEV HUB com suporte a filtros, busca e paginação para reduzir payload.',
      inputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'Filtrar por status ("active", "archived", "all")' },
          search: { type: 'string', description: 'Termo de busca no nome ou caminho do projeto' },
          limit: { type: 'number', description: 'Limite de registros retornados (padrão: 50)' },
          offset: { type: 'number', description: 'Deslocamento para paginação (padrão: 0)' },
          summaryOnly: { type: 'boolean', description: 'Se verdadeiro, retorna contagens e os projetos mais recentes' }
        }
      },
      handler: (args?: any) => {
        const status = args?.status || 'active';
        const search = args?.search ? `%${args.search}%` : null;
        const limit = typeof args?.limit === 'number' ? Math.max(1, Math.min(100, args.limit)) : 50;
        const offset = typeof args?.offset === 'number' ? Math.max(0, args.offset) : 0;

        let query = 'SELECT id, name, path, stack, status, updated_at FROM projects WHERE 1=1';
        const params: any[] = [];

        if (status && status !== 'all') {
          query += ' AND status = ?';
          params.push(status);
        }

        if (search) {
          query += ' AND (name LIKE ? OR path LIKE ?)';
          params.push(search, search);
        }

        query += ' ORDER BY updated_at DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);

        const projects = db.prepare(query).all(...params);

        if (args?.summaryOnly) {
          const totalRow: any = db.prepare('SELECT count(*) as total FROM projects').get();
          return {
            total: totalRow?.total || 0,
            limit,
            offset,
            returned: projects.length,
            projects
          };
        }

        return projects;
      }
    });

    // 2. get_project_context (MAIN TOOL FOR LLM)
    this.registerTool({
      name: 'get_project_context',
      description: 'Retorna o contexto consolidado de desenvolvimento otimizado para IA (objetivo, arquitetura, tarefas, decisões, git e checkpoint). Suporta modes: compact, normal, full.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'ID ou caminho da pasta do projeto' },
          mode: { type: 'string', enum: ['compact', 'normal', 'full'], description: 'Modo de contexto (compact = bootstrap rápido; normal = padrão; full = com histórico longo)' }
        },
        required: ['project']
      },
      handler: (args) => {
        return SessionManager.getProjectContext(args.project, args.mode || 'normal');
      }
    });

    // 3. get_project_overview
    this.registerTool({
      name: 'get_project_overview',
      description: 'Retorna métricas executivas do projeto: stack, tarefas ativas, resumo de Git e última sessão.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'ID ou caminho da pasta do projeto' }
        },
        required: ['project']
      },
      handler: (args) => {
        const project = SessionManager.resolveProject(args.project);
        const memory = MemoryManager.readMemoryFiles(project.path);
        const parsedTasks = MemoryManager.parseTasks(memory.tasksMd);
        const gitInfo = GitManager.getGitInfo(project.path);
        const lastSession: any = db.prepare(
          'SELECT session_number, summary, next_step, created_at FROM sessions WHERE project_id = ? ORDER BY session_number DESC LIMIT 1'
        ).get(project.id);

        return {
          id: project.id,
          name: project.name,
          path: project.path,
          stack: project.stack,
          tasks: {
            pendingCount: parsedTasks.pending.length,
            doingCount: parsedTasks.doing.length,
            doneCount: parsedTasks.done.length,
            nextTask: parsedTasks.doing[0] || parsedTasks.pending[0] || 'Nenhuma'
          },
          git: {
            branch: gitInfo.branch,
            modified: gitInfo.statusSummary.modified,
            newFiles: gitInfo.statusSummary.newFiles,
            lastCommit: gitInfo.lastCommit
          },
          lastSession
        };
      }
    });

    // 4. get_project_memory
    this.registerTool({
      name: 'get_project_memory',
      description: 'Lê arquivos de memória permanente em .ai-dev-hub/ (project.md, architecture.md, decisions.md, tasks.md, changes.md, session-summary.md).',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'ID ou caminho da pasta do projeto' },
          file: {
            type: 'string',
            enum: ['all', 'project.md', 'architecture.md', 'decisions.md', 'tasks.md', 'changes.md', 'session-summary.md'],
            description: 'Nome do arquivo específico ou "all" para todos'
          }
        },
        required: ['project']
      },
      handler: (args) => {
        const project = SessionManager.resolveProject(args.project);
        const mem = MemoryManager.readMemoryFiles(project.path);
        const target = args.file || 'all';

        if (target === 'all') return mem;
        if (target === 'project.md') return mem.projectMd;
        if (target === 'architecture.md') return mem.architectureMd;
        if (target === 'decisions.md') return mem.decisionsMd;
        if (target === 'tasks.md') return mem.tasksMd;
        if (target === 'changes.md') return mem.changesMd;
        if (target === 'session-summary.md') return mem.sessionSummaryMd;
        return mem;
      }
    });

    // 5. get_tasks
    this.registerTool({
      name: 'get_tasks',
      description: 'Retorna a lista estruturada de tarefas com suporte a filtros por status, limite de concluídas e resumo compacto. Aceita project, project_id ou run_id.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'ID ou caminho da pasta do projeto' },
          project_id: { type: 'string', description: 'ID alternativo do projeto' },
          run_id: { type: 'string', description: 'ID da execução autônoma (resolve automaticamente o projeto e retorna também as microtarefas do run)' },
          status: { type: 'string', enum: ['pending', 'doing', 'done', 'active', 'all'], description: 'Filtrar por status ("active" = pendente e fazendo; "all" = todas)' },
          limitDone: { type: 'number', description: 'Limite de tarefas concluídas retornadas para evitar payloads gigantescos (padrão: 15)' },
          summaryOnly: { type: 'boolean', description: 'Se verdadeiro, retorna contagens e tarefas ativas resumidas' }
        }
      },
      handler: (args) => {
        let projectIdentifier = args?.project || args?.project_id;
        let runRow: any = null;
        if (args?.run_id) {
          runRow = db.prepare('SELECT id, project_id, status FROM autonomous_runs WHERE id = ? OR id LIKE ? ORDER BY created_at DESC LIMIT 1')
            .get(args.run_id, `${args.run_id}%`);
          if (!projectIdentifier && runRow?.project_id) {
            projectIdentifier = runRow.project_id;
          }
        }
        const project = SessionManager.resolveProject(projectIdentifier);
        const memory = MemoryManager.readMemoryFiles(project.path);
        const allTasks = MemoryManager.parseTasks(memory.tasksMd);
        const autonomousTasks = runRow
          ? db.prepare('SELECT id, title, status, order_index, major_task_id, retry_count FROM autonomous_tasks WHERE run_id = ? ORDER BY order_index ASC').all(runRow.id)
          : undefined;

        const statusFilter = args?.status || 'all';
        const pending = allTasks.pending || [];
        const doing = allTasks.doing || [];
        let done = allTasks.done || [];

        const limitDone = typeof args?.limitDone === 'number' ? Math.max(0, args.limitDone) : (statusFilter === 'all' && args?.limitDone === undefined ? 15 : undefined);

        if (typeof limitDone === 'number') {
          done = done.slice(0, limitDone);
        }

        if (args?.summaryOnly) {
          return {
            totalPending: pending.length,
            totalDoing: doing.length,
            totalDone: (allTasks.done || []).length,
            activeCount: pending.length + doing.length,
            doing,
            pending: pending.slice(0, 10),
            recentDone: done.slice(0, 5),
            ...(autonomousTasks ? { autonomousTasks } : {})
          };
        }

        if (statusFilter === 'active') {
          return { pending, doing, totalDone: (allTasks.done || []).length, ...(autonomousTasks ? { autonomousTasks } : {}) };
        } else if (statusFilter === 'pending') {
          return { pending, ...(autonomousTasks ? { autonomousTasks } : {}) };
        } else if (statusFilter === 'doing') {
          return { doing, ...(autonomousTasks ? { autonomousTasks } : {}) };
        } else if (statusFilter === 'done') {
          return { done: typeof limitDone === 'number' ? done : (allTasks.done || []), ...(autonomousTasks ? { autonomousTasks } : {}) };
        }

        return {
          pending,
          doing,
          done,
          totalDone: (allTasks.done || []).length,
          ...(autonomousTasks ? { autonomousTasks } : {})
        };
      }
    });

    // 6. get_git_status
    this.registerTool({
      name: 'get_git_status',
      description: 'Retorna o status atual do Git (branch atual, último commit local e contagem de alterações modificadas/novas/deletadas).',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'ID ou caminho da pasta do projeto' }
        },
        required: ['project']
      },
      handler: (args) => {
        const project = SessionManager.resolveProject(args.project);
        return GitManager.getGitInfo(project.path);
      }
    });

    // 7. get_recent_changes
    this.registerTool({
      name: 'get_recent_changes',
      description: 'Retorna o histórico de alterações recentes registradas em changes.md e no worktree do Git.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'ID ou caminho da pasta do projeto' }
        },
        required: ['project']
      },
      handler: (args) => {
        const project = SessionManager.resolveProject(args.project);
        const memory = MemoryManager.readMemoryFiles(project.path);
        const git = GitManager.getGitInfo(project.path);
        return {
          recordedChanges: memory.changesMd,
          uncommittedWorktreeFiles: git.changedFiles
        };
      }
    });

    // 8. get_session_history
    this.registerTool({
      name: 'get_session_history',
      description: 'Retorna o histórico cronológico de sessões anteriores de desenvolvimento gravadas no SQLite.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'ID ou caminho da pasta do projeto' },
          limit: { type: 'number', description: 'Limite de sessões (padrão: 10)' }
        },
        required: ['project']
      },
      handler: (args) => {
        const project = SessionManager.resolveProject(args.project);
        const limit = args.limit || 10;
        return db.prepare(
          'SELECT session_number, agent_name, created_at, summary, implemented, affected_files, next_step FROM sessions WHERE project_id = ? ORDER BY session_number DESC LIMIT ?'
        ).all(project.id, limit);
      }
    });

    // 9. get_last_checkpoint
    this.registerTool({
      name: 'get_last_checkpoint',
      description: 'Retorna o texto bruto do último checkpoint consolidado do projeto.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'ID ou caminho da pasta do projeto' }
        },
        required: ['project']
      },
      handler: (args) => {
        const project = SessionManager.resolveProject(args.project);
        const lastSession: any = db.prepare(
          'SELECT session_number, created_at, checkpoint_raw FROM sessions WHERE project_id = ? ORDER BY session_number DESC LIMIT 1'
        ).get(project.id);

        if (!lastSession) {
          const memory = MemoryManager.readMemoryFiles(project.path);
          return memory.sessionSummaryMd || 'Nenhum checkpoint anterior.';
        }
        return lastSession.checkpoint_raw;
      }
    });

    // 10. create_checkpoint
    this.registerTool({
      name: 'create_checkpoint',
      description: 'Gera e persiste um novo checkpoint no SQLite e em session-summary.md.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'ID ou caminho da pasta do projeto' },
          implemented: { type: 'array', items: { type: 'string' }, description: 'Itens concluídos na sessão' },
          recent_changes: { type: 'array', items: { type: 'string' }, description: 'Arquivos ou mudanças recentes' },
          problems: { type: 'array', items: { type: 'string' }, description: 'Problemas ou bloqueios conhecidos' },
          next_task: { type: 'string', description: 'Próxima tarefa recomendada' },
          decisions: { type: 'array', items: { type: 'string' }, description: 'Decisões tomadas' }
        },
        required: ['project']
      },
      handler: (args) => {
        const project = SessionManager.resolveProject(args.project);
        return CheckpointManager.createSessionCheckpoint(project.id, project.path, project.name, {
          implemented: args.implemented,
          recentChanges: args.recent_changes,
          problems: args.problems,
          nextTask: args.next_task,
          decisions: args.decisions
        });
      }
    });

    // 11. update_project_memory
    this.registerTool({
      name: 'update_project_memory',
      description: 'Atualiza o conteúdo de um arquivo Markdown de memória em .ai-dev-hub/ com validação e segurança.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'ID ou caminho da pasta do projeto' },
          filename: {
            type: 'string',
            enum: ['project.md', 'architecture.md', 'decisions.md', 'tasks.md', 'changes.md', 'session-summary.md'],
            description: 'Nome do arquivo de memória'
          },
          content: { type: 'string', description: 'Novo conteúdo Markdown completo' }
        },
        required: ['project', 'filename', 'content']
      },
      handler: (args) => {
        const project = SessionManager.resolveProject(args.project);
        const safe = SecurityManager.sanitizeMemoryFilename(args.filename);
        MemoryManager.updateMemoryFile(project.path, safe, args.content);
        db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), project.id);
        return { success: true, message: `Arquivo ${safe} atualizado com sucesso.` };
      }
    });

    // 12. add_task
    this.registerTool({
      name: 'add_task',
      description: 'Adiciona uma nova tarefa na memória tasks.md (coluna: pending, doing ou done).',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'ID ou caminho da pasta do projeto' },
          task: { type: 'string', description: 'Texto descritivo da tarefa' },
          column: { type: 'string', enum: ['pending', 'doing', 'done'], description: 'Estágio da tarefa' }
        },
        required: ['project', 'task']
      },
      handler: (args) => {
        const project = SessionManager.resolveProject(args.project);
        const col = args.column === 'doing' ? 'doing' : (args.column === 'done' ? 'done' : 'pending');
        const memory = MemoryManager.readMemoryFiles(project.path);
        const tasks = MemoryManager.parseTasks(memory.tasksMd);
        tasks[col].push(args.task.trim());
        const newMd = MemoryManager.formatTasks(tasks);
        MemoryManager.updateMemoryFile(project.path, 'tasks.md', newMd);
        return { success: true, message: `Tarefa adicionada em ${col}: "${args.task}"`, tasks };
      }
    });

    // 13. update_task
    this.registerTool({
      name: 'update_task',
      description: 'Move uma tarefa de coluna (pending -> doing -> done) ou edita seu status.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'ID ou caminho da pasta do projeto' },
          task: { type: 'string', description: 'Texto da tarefa existente' },
          from: { type: 'string', enum: ['pending', 'doing', 'done'] },
          to: { type: 'string', enum: ['pending', 'doing', 'done'] }
        },
        required: ['project', 'task', 'from', 'to']
      },
      handler: (args) => {
        const project = SessionManager.resolveProject(args.project);
        const memory = MemoryManager.readMemoryFiles(project.path);
        const tasks = MemoryManager.parseTasks(memory.tasksMd);

        const fromKey = args.from as keyof typeof tasks;
        const toKey = args.to as keyof typeof tasks;

        if (tasks[fromKey]) {
          tasks[fromKey] = tasks[fromKey].filter(t => t.toLowerCase() !== args.task.toLowerCase());
        }
        if (tasks[toKey]) {
          tasks[toKey].push(args.task);
        }

        const newMd = MemoryManager.formatTasks(tasks);
        MemoryManager.updateMemoryFile(project.path, 'tasks.md', newMd);
        return { success: true, message: `Tarefa movida para ${args.to}.`, tasks };
      }
    });

    // 14. add_decision
    this.registerTool({
      name: 'add_decision',
      description: 'Registra formalmente uma decisão técnica e seu motivo no arquivo decisions.md.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'ID ou caminho da pasta do projeto' },
          decision: { type: 'string', description: 'O que foi decidido' },
          rationale: { type: 'string', description: 'Por que foi tomada esta decisão' }
        },
        required: ['project', 'decision', 'rationale']
      },
      handler: (args) => {
        const project = SessionManager.resolveProject(args.project);
        const memory = MemoryManager.readMemoryFiles(project.path);
        const dateStr = new Date().toLocaleDateString('pt-BR');
        const entry = `\n- **[${dateStr}] ${args.decision}**\n  - **Decisão:** ${args.decision}\n  - **Motivo:** ${args.rationale}\n`;
        const updated = memory.decisionsMd.trim() + entry;
        MemoryManager.updateMemoryFile(project.path, 'decisions.md', updated);
        return { success: true, message: `Decisão técnica registrada em decisions.md: "${args.decision}"` };
      }
    });

    // 15. log_change
    this.registerTool({
      name: 'log_change',
      description: 'Registra alteração de arquivos no arquivo changes.md com notas explicativas.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'ID ou caminho da pasta do projeto' },
          files: { type: 'array', items: { type: 'string' }, description: 'Lista de arquivos alterados' },
          description: { type: 'string', description: 'Descrição das mudanças realizadas' }
        },
        required: ['project', 'files', 'description']
      },
      handler: (args) => {
        const project = SessionManager.resolveProject(args.project);
        const memory = MemoryManager.readMemoryFiles(project.path);
        const dateStr = new Date().toLocaleString('pt-BR');
        const entry = `\n### [${dateStr}] Alteração\n- **Descrição:** ${args.description}\n- **Arquivos:**\n${args.files.map((f: string) => `  * \`${f}\``).join('\n')}\n`;
        const updated = memory.changesMd.trim() + entry;
        MemoryManager.updateMemoryFile(project.path, 'changes.md', updated);
        return { success: true, message: 'Alterações registradas em changes.md' };
      }
    });

    // 16. add_problem
    this.registerTool({
      name: 'add_problem',
      description: 'Registra um problema ou bug conhecido na memória viva (session-summary.md).',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'ID ou caminho da pasta do projeto' },
          problem: { type: 'string', description: 'Descrição do problema ou bug' }
        },
        required: ['project', 'problem']
      },
      handler: (args) => {
        const project = SessionManager.resolveProject(args.project);
        const memory = MemoryManager.readMemoryFiles(project.path);
        let summary = memory.sessionSummaryMd;

        if (summary.includes('PROBLEMAS:')) {
          summary = summary.replace(/PROBLEMAS:\s*\n/, `PROBLEMAS:\n- ${args.problem}\n`);
        } else {
          summary += `\n\nPROBLEMAS:\n- ${args.problem}\n`;
        }

        MemoryManager.updateMemoryFile(project.path, 'session-summary.md', summary);
        return { success: true, message: `Problema registrado: "${args.problem}"` };
      }
    });

    // 17. resolve_problem
    this.registerTool({
      name: 'resolve_problem',
      description: 'Remove ou marca como resolvido um problema conhecido em session-summary.md.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'ID ou caminho da pasta do projeto' },
          problem: { type: 'string', description: 'Trecho do problema a remover ou resolver' }
        },
        required: ['project', 'problem']
      },
      handler: (args) => {
        const project = SessionManager.resolveProject(args.project);
        const memory = MemoryManager.readMemoryFiles(project.path);
        const lines = memory.sessionSummaryMd.split(/\r?\n/);
        const filtered = lines.filter(l => !l.toLowerCase().includes(args.problem.toLowerCase()));
        MemoryManager.updateMemoryFile(project.path, 'session-summary.md', filtered.join('\n'));
        return { success: true, message: `Problema resolvido e removido de session-summary.md` };
      }
    });

    // 18. set_next_task
    this.registerTool({
      name: 'set_next_task',
      description: 'Define a próxima tarefa prioritária na memória viva (session-summary.md).',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'ID ou caminho da pasta do projeto' },
          next_task: { type: 'string', description: 'Texto da próxima tarefa recomendada' }
        },
        required: ['project', 'next_task']
      },
      handler: (args) => {
        const project = SessionManager.resolveProject(args.project);
        const memory = MemoryManager.readMemoryFiles(project.path);
        let summary = memory.sessionSummaryMd;

        if (summary.includes('PRÓXIMA TAREFA:')) {
          summary = summary.replace(/PRÓXIMA TAREFA:[\s\S]*?(?=\n[A-Z_ ]+:|$)/, `PRÓXIMA TAREFA:\n${args.next_task}\n\n`);
        } else {
          summary += `\n\nPRÓXIMA TAREFA:\n${args.next_task}\n`;
        }

        MemoryManager.updateMemoryFile(project.path, 'session-summary.md', summary);
        return { success: true, message: `Próxima tarefa definida: "${args.next_task}"` };
      }
    });

    // 19. start_session
    this.registerTool({
      name: 'start_session',
      description: 'Inicia uma sessão de trabalho de agente no projeto. Captura Git HEAD inicial, tarefas em aberto e retorna session_id e contexto inicial.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'ID ou caminho da pasta do projeto' },
          agent_name: { type: 'string', description: 'Nome ou identificador do agente (opcional)' }
        },
        required: ['project']
      },
      handler: (args) => {
        return SessionManager.startSession(args.project, args.agent_name || 'Antigravity Agent');
      }
    });

    // 20. end_session
    this.registerTool({
      name: 'end_session',
      description: 'Finaliza a sessão do agente, atualizando atomicamente changes.md, decisions.md, tasks.md, session-summary.md e gravando no SQLite.',
      inputSchema: {
        type: 'object',
        properties: {
          session_id: { type: 'string', description: 'ID da sessão retornado por start_session' },
          implemented: { type: 'array', items: { type: 'string' }, description: 'Tarefas concluídas' },
          files_changed: { type: 'array', items: { type: 'string' }, description: 'Arquivos alterados' },
          problems: { type: 'array', items: { type: 'string' }, description: 'Problemas restantes' },
          decisions: { type: 'array', items: { type: 'string' }, description: 'Decisões tomadas' },
          next_task: { type: 'string', description: 'Próximo passo recomendado' },
          notes: { type: 'string', description: 'Notas da sessão' }
        },
        required: ['session_id']
      },
      handler: (args) => {
        return SessionManager.endSession({
          sessionId: args.session_id,
          implemented: args.implemented,
          filesChanged: args.files_changed,
          problems: args.problems,
          decisions: args.decisions,
          nextTask: args.next_task,
          notes: args.notes
        });
      }
    });

    // 21. search_project_context
    this.registerTool({
      name: 'search_project_context',
      description: 'Realiza busca textual inteligente em toda a memória permanente, decisões, tarefas, sessões anteriores e histórico do projeto.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'ID ou caminho da pasta do projeto' },
          query: { type: 'string', description: 'Termos de busca (ex: "por que escolhemos SQLite?", "chatterbox", "bugs")' }
        },
        required: ['project', 'query']
      },
      handler: (args) => {
        return SessionManager.searchProjectContext(args.project, args.query);
      }
    });

    // 22. smart_checkpoint
    this.registerTool({
      name: 'smart_checkpoint',
      description: 'Gera automaticamente um checkpoint inteligente analisando diffs reais do Git, tarefas concluídas e decisões recentes sem digitação manual.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'ID ou caminho da pasta do projeto' }
        },
        required: ['project']
      },
      handler: (args) => {
        return SessionManager.smartCheckpoint(args.project);
      }
    });

    // 23. generate_handover
    this.registerTool({
      name: 'generate_handover',
      description: 'Produz um handover prompt compacto e padronizado especialmente desenhado para outra sessão de agente assumir o projeto imediatamente.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'ID ou caminho da pasta do projeto' }
        },
        required: ['project']
      },
      handler: (args) => {
        return SessionManager.generateHandover(args.project);
      }
    });

    // 24. create_autonomous_run
    this.registerTool({
      name: 'create_autonomous_run',
      description: 'Cria e inicializa um novo ciclo de desenvolvimento autônomo multi-agente para o projeto.',
      inputSchema: {
        type: 'object',
        properties: {
          project_id: { type: 'string', description: 'ID do projeto' },
          name: { type: 'string', description: 'Nome descritivo do build' },
          objective: { type: 'string', description: 'Objetivo de alto nível do software' },
          briefing: { type: 'string', description: 'Briefing detalhado com requisitos' },
          autonomy_mode: { type: 'string', enum: ['safe', 'balanced', 'autonomous'] },
          max_hours: { type: 'number' },
          max_cycles: { type: 'number' },
          is_overnight: { type: 'boolean' }
        },
        required: ['project_id', 'objective', 'briefing']
      },
      handler: (args) => {
        return AutonomousManager.createRun({
          projectId: args.project_id,
          name: args.name,
          objective: args.objective,
          briefing: args.briefing,
          autonomyMode: args.autonomy_mode,
          maxHours: args.max_hours,
          maxCycles: args.max_cycles,
          isOvernight: args.is_overnight
        });
      }
    });

    // 25. get_autonomous_run
    this.registerTool({
      name: 'get_autonomous_run',
      description: 'Retorna o estado completo do build autônomo, tarefas, aprovações e progresso do MVP.',
      inputSchema: {
        type: 'object',
        properties: {
          run_id: { type: 'string', description: 'ID da execução autônoma' }
        },
        required: ['run_id']
      },
      handler: (args) => {
        return AutonomousManager.getRun(args.run_id);
      }
    });

    // 26. pause_autonomous_run
    this.registerTool({
      name: 'pause_autonomous_run',
      description: 'Pausa a execução do build autônomo.',
      inputSchema: {
        type: 'object',
        properties: {
          run_id: { type: 'string' }
        },
        required: ['run_id']
      },
      handler: (args) => {
        return AutonomousManager.pauseRun(args.run_id);
      }
    });

    // 27. resume_autonomous_run
    this.registerTool({
      name: 'resume_autonomous_run',
      description: 'Retoma um build autônomo pausado.',
      inputSchema: {
        type: 'object',
        properties: {
          run_id: { type: 'string' }
        },
        required: ['run_id']
      },
      handler: (args) => {
        return AutonomousManager.resumeRun(args.run_id);
      }
    });

    // 28. stop_autonomous_run
    this.registerTool({
      name: 'stop_autonomous_run',
      description: 'Encerra definitivamente um build autônomo.',
      inputSchema: {
        type: 'object',
        properties: {
          run_id: { type: 'string' }
        },
        required: ['run_id']
      },
      handler: (args) => {
        return AutonomousManager.stopRun(args.run_id);
      }
    });

    // 29. get_available_tasks
    this.registerTool({
      name: 'get_available_tasks',
      description: 'Retorna a lista de tarefas prontas para execução (cujas dependências no DAG foram concluídas).',
      inputSchema: {
        type: 'object',
        properties: {
          run_id: { type: 'string' }
        },
        required: ['run_id']
      },
      handler: (args) => {
        return AutonomousManager.getAvailableTasks(args.run_id);
      }
    });

    // 30. claim_task
    this.registerTool({
      name: 'claim_task',
      description: 'O agente Builder assume formalmente uma tarefa disponível para implementação.',
      inputSchema: {
        type: 'object',
        properties: {
          run_id: { type: 'string' },
          task_id: { type: 'string' },
          agent_name: { type: 'string' }
        },
        required: ['run_id', 'task_id']
      },
      handler: (args) => {
        return AutonomousManager.claimTask(args.run_id, args.task_id, args.agent_name || 'Antigravity Builder');
      }
    });

    // 31. submit_builder_report
    this.registerTool({
      name: 'submit_builder_report',
      description: 'O Builder envia o relatório estruturado de implementação com testes, build, browser QA e decisões para revisão do Supervisor.',
      inputSchema: {
        type: 'object',
        properties: {
          run_id: { type: 'string' },
          task_id: { type: 'string' },
          status: { type: 'string', enum: ['success', 'failure', 'partial'] },
          files_changed: { type: 'array', items: { type: 'string' } },
          implemented: { type: 'array', items: { type: 'string' } },
          tests_run: { type: 'string' },
          test_results: { type: 'string' },
          build_status: { type: 'string' },
          browser_validation: { type: 'string' },
          screenshots: { type: 'array', items: { type: 'string' } },
          known_problems: { type: 'array', items: { type: 'string' } },
          decisions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                decision: { type: 'string' },
                rationale: { type: 'string' }
              }
            }
          },
          recommendation: { type: 'string' }
        },
        required: ['run_id', 'task_id', 'status', 'files_changed', 'implemented']
      },
      handler: (args) => {
        return AutonomousManager.submitBuilderReport({
          runId: args.run_id,
          taskId: args.task_id,
          status: args.status,
          filesChanged: args.files_changed,
          implemented: args.implemented,
          testsRun: args.tests_run,
          testResults: args.test_results,
          buildStatus: args.build_status,
          browserValidation: args.browser_validation,
          screenshots: args.screenshots,
          knownProblems: args.known_problems,
          decisions: args.decisions,
          recommendation: args.recommendation
        });
      }
    });

    // 32. submit_supervisor_review
    this.registerTool({
      name: 'submit_supervisor_review',
      description: 'O Supervisor envia a avaliação formal do trabalho do Builder (APPROVED ou CHANGES_REQUESTED).',
      inputSchema: {
        type: 'object',
        properties: {
          run_id: { type: 'string' },
          task_id: { type: 'string' },
          verdict: { type: 'string', enum: ['APPROVED', 'CHANGES_REQUESTED'] },
          feedback: { type: 'string' },
          requirements_met: { type: 'boolean' },
          build_passed: { type: 'boolean' },
          tests_passed: { type: 'boolean' },
          ui_functional: { type: 'boolean' },
          quality_score: { type: 'number' }
        },
        required: ['run_id', 'task_id', 'verdict', 'feedback']
      },
      handler: (args) => {
        return AutonomousManager.submitSupervisorReview({
          runId: args.run_id,
          taskId: args.task_id,
          verdict: args.verdict,
          feedback: args.feedback,
          requirementsMet: args.requirements_met,
          buildPassed: args.build_passed,
          testsPassed: args.tests_passed,
          uiFunctional: args.ui_functional,
          qualityScore: args.quality_score
        });
      }
    });

    // 33. request_human_approval
    this.registerTool({
      name: 'request_human_approval',
      description: 'Submete uma decisão de alto risco (ORANGE ou RED) para a Approval Inbox do usuário.',
      inputSchema: {
        type: 'object',
        properties: {
          run_id: { type: 'string' },
          task_id: { type: 'string' },
          risk_level: { type: 'string', enum: ['green', 'yellow', 'orange', 'red'] },
          title: { type: 'string' },
          context: { type: 'string' },
          why_needed: { type: 'string' },
          supervisor_recommendation: { type: 'string' },
          alternatives: { type: 'array', items: { type: 'string' } },
          impact: { type: 'string' },
          risk: { type: 'string' }
        },
        required: ['run_id', 'risk_level', 'title', 'context', 'why_needed', 'supervisor_recommendation']
      },
      handler: (args) => {
        return AutonomousManager.requestHumanApproval({
          runId: args.run_id,
          taskId: args.task_id,
          riskLevel: args.risk_level,
          title: args.title,
          context: args.context,
          whyNeeded: args.why_needed,
          supervisorRecommendation: args.supervisor_recommendation,
          alternatives: args.alternatives,
          impact: args.impact,
          risk: args.risk
        });
      }
    });

    // 34. resolve_human_approval
    this.registerTool({
      name: 'resolve_human_approval',
      description: 'Registra a decisão tomada pelo usuário na Approval Inbox.',
      inputSchema: {
        type: 'object',
        properties: {
          approval_id: { type: 'string' },
          decision: { type: 'string', enum: ['approved', 'rejected', 'delegated'] }
        },
        required: ['approval_id', 'decision']
      },
      handler: (args) => {
        return AutonomousManager.resolveHumanApproval(args.approval_id, args.decision);
      }
    });

    // 35. get_pending_approvals
    this.registerTool({
      name: 'get_pending_approvals',
      description: 'Lista todas as aprovações aguardando decisão humana na Inbox.',
      inputSchema: {
        type: 'object',
        properties: {
          run_id: { type: 'string' }
        },
        required: ['run_id']
      },
      handler: (args) => {
        const run = AutonomousManager.getRun(args.run_id);
        return run.approvals.filter((a: any) => a.status === 'pending');
      }
    });

    // 36. record_artifact
    this.registerTool({
      name: 'record_artifact',
      description: 'Registra screenshot, log de teste ou artefato de validação gerado pelo Builder.',
      inputSchema: {
        type: 'object',
        properties: {
          run_id: { type: 'string' },
          task_id: { type: 'string' },
          artifact_type: { type: 'string', enum: ['screenshot', 'test_log', 'build_log', 'report'] },
          path: { type: 'string' },
          description: { type: 'string' }
        },
        required: ['run_id', 'artifact_type', 'path']
      },
      handler: (args) => {
        AutonomousManager.logEvent(args.run_id, args.task_id || null, 'builder', 'ARTIFACT_RECORDED', `Artefato (${args.artifact_type}) registrado: ${args.path}`, {
          artifactType: args.artifact_type,
          path: args.path,
          description: args.description
        });
        return { success: true, message: `Artefato registrado com sucesso.` };
      }
    });

    // 37. heartbeat
    this.registerTool({
      name: 'heartbeat',
      description: 'Sinal de vida emitido por um agente para evitar timeout pelo Watchdog.',
      inputSchema: {
        type: 'object',
        properties: {
          run_id: { type: 'string' },
          agent_role: { type: 'string', enum: ['supervisor', 'builder'] },
          status_note: { type: 'string' }
        },
        required: ['run_id', 'agent_role']
      },
      handler: (args) => {
        AutonomousManager.logEvent(args.run_id, null, args.agent_role, 'HEARTBEAT', args.status_note || 'Agente ativo');
        return { status: 'alive', time: new Date().toISOString() };
      }
    });

    // 38. link_github_repository
    this.registerTool({
      name: 'link_github_repository',
      description: 'Vincula um repositório GitHub (ex: owner/repo) a um projeto do AI DEV HUB.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'ID ou caminho da pasta do projeto' },
          repo: { type: 'string', description: 'Nome do repositório no formato owner/repo (ex: deco-verc/repo-name)' },
          branch: { type: 'string', description: 'Branch padrão (padrão: main)' }
        },
        required: ['project', 'repo']
      },
      handler: (args) => {
        const project = SessionManager.resolveProject(args.project);
        const branch = args.branch || 'main';
        const nowIso = new Date().toISOString();
        db.prepare(`
          UPDATE projects
          SET github_repo = ?, github_branch = ?, github_sync_status = 'linked', github_last_synced_at = ?, updated_at = ?
          WHERE id = ?
        `).run(args.repo.trim(), branch.trim(), nowIso, nowIso, project.id);
        return { success: true, message: `Projeto "${project.name}" vinculado ao repositório GitHub ${args.repo}.` };
      }
    });

    // 39. get_github_status
    this.registerTool({
      name: 'get_github_status',
      description: 'Retorna o status completo da integração com GitHub, issues abertas e pull requests.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'ID ou caminho da pasta do projeto' }
        },
        required: ['project']
      },
      handler: async (args) => {
        const project = SessionManager.resolveProject(args.project);
        if (!project.github_repo) {
          return { linked: false, message: 'Projeto não possui repositório GitHub vinculado.' };
        }
        const [owner, repo] = project.github_repo.split('/');
        const issues = await GitHubMcpClient.listIssues(owner, repo, 'all');
        const pullRequests = await GitHubMcpClient.listPullRequests(owner, repo, 'all');
        return {
          linked: true,
          repo: project.github_repo,
          branch: project.github_branch || 'main',
          issuesCount: issues.length,
          openIssues: issues.filter((i: any) => i.state === 'open').length,
          pullRequestsCount: pullRequests.length,
          openPRs: pullRequests.filter((p: any) => p.state === 'open').length
        };
      }
    });

    // 40. sync_github_tasks
    this.registerTool({
      name: 'sync_github_tasks',
      description: 'Sincroniza o estado das issues do GitHub com o Task Graph local do AI DEV HUB.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'ID ou caminho da pasta do projeto' }
        },
        required: ['project']
      },
      handler: async (args) => {
        const project = SessionManager.resolveProject(args.project);
        if (!project.github_repo) {
          throw new Error('Projeto sem repositório GitHub vinculado.');
        }
        const [owner, repo] = project.github_repo.split('/');
        const issues = await GitHubMcpClient.listIssues(owner, repo, 'all');
        for (const ghIssue of issues) {
          if (ghIssue.state === 'closed') {
            db.prepare('UPDATE autonomous_tasks SET github_state = "closed", status = "completed" WHERE github_issue_number = ?')
              .run(ghIssue.number);
          }
        }
        return { success: true, issuesSynced: issues.length };
      }
    });
  }

  // Handle standard JSON-RPC 2.0 messages (Used by both stdio and HTTP/SSE)
  static async handleJsonRpc(request: any): Promise<any> {
    if (!request || typeof request !== 'object') {
      return { jsonrpc: '2.0', error: { code: -32600, message: 'Invalid Request' }, id: null };
    }

    const { id, method, params } = request;

    try {
      if (method === 'initialize') {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: { listChanged: false }
            },
            serverInfo: {
              name: 'ai-dev-hub-mcp',
              version: '1.0.0'
            }
          }
        };
      }

      if (method === 'notifications/initialized' || method === 'initialized') {
        return null; // Notifications return no response
      }

      if (method === 'ping') {
        return { jsonrpc: '2.0', id, result: {} };
      }

      if (method === 'tools/list') {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            tools: this.getToolsList()
          }
        };
      }

      if (method === 'tools/call') {
        if (!params || !params.name) {
          return {
            jsonrpc: '2.0',
            id,
            error: { code: -32602, message: 'Parâmetro "name" da tool é obrigatório.' }
          };
        }

        const toolResult = await this.handleToolCall(params.name, params.arguments);
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult, null, 2)
              }
            ],
            isError: false
          }
        };
      }

      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Método desconhecido: ${method}` }
      };
    } catch (err: any) {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: `Erro ao executar tool: ${err.message}`
            }
          ],
          isError: true
        }
      };
    }
  }
}

// Auto-initialize tools on load
McpCore.initTools();
