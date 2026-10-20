import { MemoryManager } from './memoryManager.js';
import { GitManager } from './gitManager.js';
import { db } from './db.js';
import crypto from 'node:crypto';

export interface CheckpointData {
  projectName: string;
  projectPath: string;
  objective?: string;
  implemented?: string[];
  recentChanges?: string[];
  problems?: string[];
  nextTask?: string;
  decisions?: string[];
  customInstructions?: string;
}

export class CheckpointManager {
  static generateCheckpointText(data: CheckpointData): string {
    const implementedStr = (data.implemented && data.implemented.length > 0)
      ? data.implemented.map(i => `- ${i}`).join('\n')
      : '- Estrutura inicial e rotinas base configuradas';

    const recentChangesStr = (data.recentChanges && data.recentChanges.length > 0)
      ? data.recentChanges.map(c => `- ${c}`).join('\n')
      : '- Atualização de arquivos de contexto e persistência';

    const problemsStr = (data.problems && data.problems.length > 0)
      ? data.problems.map(p => `- ${p}`).join('\n')
      : '- Nenhum bug crítico bloqueante no momento';

    const nextTaskStr = data.nextTask || 'Continuar implementação das tarefas pendentes';

    const decisionsStr = (data.decisions && data.decisions.length > 0)
      ? data.decisions.map(d => `- ${d}`).join('\n')
      : '- Arquitetura local desacoplada para máxima portabilidade';

    const instructionStr = data.customInstructions || 
`Analise primeiro os arquivos de memória e o Git.
Não refaça tarefas concluídas.
Continue do estado atual.`;

    return `----------------------------------
ESTADO ATUAL DO PROJETO

Projeto:
${data.projectName}

Objetivo:
${data.objective || 'Desenvolver a aplicação conforme especificações'}

IMPLEMENTADO:
${implementedStr}

ALTERAÇÕES RECENTES:
${recentChangesStr}

PROBLEMAS:
${problemsStr}

PRÓXIMA TAREFA:
${nextTaskStr}

DECISÕES IMPORTANTES:
${decisionsStr}

INSTRUÇÃO PARA O PRÓXIMO AGENTE:
${instructionStr}
----------------------------------`;
  }

  static createSessionCheckpoint(
    projectId: string,
    projectPath: string,
    projectName: string,
    overrides?: Partial<CheckpointData>
  ) {
    const memory = MemoryManager.readMemoryFiles(projectPath);
    const parsedTasks = MemoryManager.parseTasks(memory.tasksMd);
    const gitInfo = GitManager.getGitInfo(projectPath);

    // Count existing sessions for this project
    const sessionCountStmt = db.prepare('SELECT COUNT(*) as count FROM sessions WHERE project_id = ?');
    const countRes: any = sessionCountStmt.get(projectId);
    const sessionNumber = (countRes?.count || 0) + 1;

    // Determine implemented items from done tasks
    const implemented = overrides?.implemented && overrides.implemented.length > 0
      ? overrides.implemented
      : (parsedTasks.done.length > 0 ? parsedTasks.done : ['Estrutura e configuração base']);

    // Determine recent changes from git or changes.md
    let recentChanges = overrides?.recentChanges;
    if (!recentChanges || recentChanges.length === 0) {
      if (gitInfo.changedFiles.length > 0) {
        recentChanges = gitInfo.changedFiles.slice(0, 10).map(f => `${f.path} (${f.status})`);
      } else {
        recentChanges = ['.ai-dev-hub/session-summary.md', '.ai-dev-hub/tasks.md'];
      }
    }

    // Determine next task from doing or pending
    let nextTask = overrides?.nextTask;
    if (!nextTask) {
      if (parsedTasks.doing.length > 0) {
        nextTask = parsedTasks.doing[0];
      } else if (parsedTasks.pending.length > 0) {
        nextTask = parsedTasks.pending[0];
      } else {
        nextTask = 'Revisão geral e próximos aprimoramentos';
      }
    }

    // Determine objective from overrides or memory
    const objectiveMatch = memory.projectMd.match(/## Objetivo Principal\s*\n([\s\S]*?)(?=\n##|$)/);
    const objective = overrides?.objective || (objectiveMatch ? objectiveMatch[1].trim() : '');

    // Extract decisions
    let decisions = overrides?.decisions;
    if (!decisions || decisions.length === 0) {
      const decisionMatches = memory.decisionsMd.match(/- \*\*Decisão:\*\* (.*?)(?=\n|$)/g);
      if (decisionMatches && decisionMatches.length > 0) {
        decisions = decisionMatches.map(d => d.replace('- **Decisão:** ', '').trim());
      } else {
        decisions = ['Arquitetura desacoplada e memória local versionada'];
      }
    }

    const checkpointText = this.generateCheckpointText({
      projectName,
      projectPath,
      objective,
      implemented,
      recentChanges,
      problems: overrides?.problems || ['Nenhum bloqueio registrado'],
      nextTask,
      decisions,
      customInstructions: overrides?.customInstructions
    });

    // 1. Update session-summary.md
    const newSessionSummary = `# Resumo da Sessão Atual — Sessão #${sessionNumber}
Data: ${new Date().toLocaleString('pt-BR')}

${checkpointText}
`;
    MemoryManager.updateMemoryFile(projectPath, 'session-summary.md', newSessionSummary);

    // 2. Save session to database
    const sessionId = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    const insertSession = db.prepare(`
      INSERT INTO sessions (
        id, project_id, session_number, created_at, summary,
        implemented, changes, affected_files, completed_tasks, next_step, checkpoint_raw
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertSession.run(
      sessionId,
      projectId,
      sessionNumber,
      nowIso,
      `Sessão #${sessionNumber}: ${implemented.slice(0, 2).join(', ')}`,
      JSON.stringify(implemented),
      JSON.stringify(recentChanges),
      JSON.stringify(recentChanges),
      JSON.stringify(parsedTasks.done),
      nextTask,
      checkpointText
    );

    // Update project updated_at
    db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(nowIso, projectId);

    return {
      sessionId,
      sessionNumber,
      checkpointText,
      created_at: nowIso
    };
  }

  static generateContinuityPrompt(projectId: string, projectPath: string, projectName: string): string {
    const memory = MemoryManager.readMemoryFiles(projectPath);
    const parsedTasks = MemoryManager.parseTasks(memory.tasksMd);
    const gitInfo = GitManager.getGitInfo(projectPath);

    return `=====================================================
CONTEXTO DE CONTINUIDADE DO PROJETO: ${projectName.toUpperCase()}
=====================================================

Você é o engenheiro de software assumindo esta nova sessão de desenvolvimento.
Abaixo está a memória viva e estruturada do projeto, obtida de .ai-dev-hub/.

[1. OBJETIVO E CONTEXTO]
${memory.projectMd.trim() || 'Verifique os requisitos do projeto.'}

[2. ARQUITETURA E STACK TÉCNICA]
${memory.architectureMd.trim() || 'Stack local.'}

[3. DECISÕES TÉCNICAS REGISTRADAS]
${memory.decisionsMd.trim() || 'Nenhuma decisão formal registrada.'}

[4. STATUS ATUAL DAS TAREFAS]
- PENDENTES:
${parsedTasks.pending.length ? parsedTasks.pending.map(t => `  * ${t}`).join('\n') : '  * Nenhuma tarefa pendente'}

- EM ANDAMENTO (FAZENDO):
${parsedTasks.doing.length ? parsedTasks.doing.map(t => `  * ${t}`).join('\n') : '  * Nenhuma tarefa em andamento'}

- CONCLUÍDAS:
${parsedTasks.done.length ? parsedTasks.done.map(t => `  * ${t}`).join('\n') : '  * Nenhuma tarefa concluída'}

[5. ESTADO DO GIT]
- Branch atual: ${gitInfo.branch || 'Não detectado'}
- Arquivos modificados: ${gitInfo.statusSummary.modified}
- Arquivos novos: ${gitInfo.statusSummary.newFiles}
- Arquivos deletados: ${gitInfo.statusSummary.deleted}
${gitInfo.lastCommit ? `- Último commit: "${gitInfo.lastCommit.message}" (${gitInfo.lastCommit.hash})` : ''}

[6. ÚLTIMO CHECKPOINT REGISTRADO]
${memory.sessionSummaryMd.trim()}

=====================================================
DIRETRIZES PARA ESTA SESSÃO:
1. Respeite todas as decisões e arquitetura definidas acima.
2. Não refaça tarefas já marcadas como concluídas.
3. Foque prioritariamente na tarefa em andamento ou na próxima tarefa pendente.
4. Mantenha os arquivos de memória em .ai-dev-hub/ sempre sincronizados.
=====================================================`;
  }
}
