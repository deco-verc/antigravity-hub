import fs from 'node:fs';
import path from 'node:path';
import { getDefaultProjectProgram } from './agentGuidelines.js';

export const MEMORY_DIR_NAME = '.ai-dev-hub';

export interface ProjectMemory {
  projectMd: string;
  architectureMd: string;
  decisionsMd: string;
  tasksMd: string;
  changesMd: string;
  sessionSummaryMd: string;
  programMd: string;
  lessonsMd?: string;
}

export interface ParsedTasks {
  pending: string[];
  doing: string[];
  done: string[];
}

export class MemoryManager {
  static getMemoryDir(projectPath: string): string {
    return path.join(projectPath, MEMORY_DIR_NAME);
  }

  static ensureMemoryStructure(
    projectPath: string,
    initialData: {
      name: string;
      objective?: string;
      description?: string;
      stack?: string;
    }
  ): void {
    const memDir = this.getMemoryDir(projectPath);
    if (!fs.existsSync(memDir)) {
      fs.mkdirSync(memDir, { recursive: true });
    }

    const files = {
      'project.md': `# Projeto: ${initialData.name}

## Objetivo Principal
${initialData.objective || 'Definir o objetivo principal do projeto.'}

## Contexto do Produto
${initialData.description || 'Contexto e propósito da aplicação para os usuários.'}

## Funcionamento Esperado
- Operação local rápida e confiável.
- Preservação permanente de contexto e estado entre sessões.
`,

      'architecture.md': `# Arquitetura do Sistema

## Stack Tecnológica
- **Stack:** ${initialData.stack || 'Não especificada'}

## Componentes
- Frontend: Interface do usuário
- Backend: API e serviços locais
- Banco de Dados: SQLite / Armazenamento local
- Portas: 5173 (Frontend), 3001 (Backend)

## Fluxo de Dados
1. O usuário interage com a interface.
2. O backend gerencia o sistema de arquivos local e git.
3. A memória é persistida em arquivos Markdown na pasta \`.ai-dev-hub/\`.
`,

      'decisions.md': `# Registro de Decisões Técnicas

## Decisões Tomadas
- **[${new Date().toLocaleDateString('pt-BR')}] Estrutura Inicial**
  - **Decisão:** Uso de arquivos Markdown locais para memória permanente do projeto.
  - **Motivo:** Leitura direta por qualquer agente de IA, controle de versão transparente via Git e independência de provedores em nuvem.
`,

      'tasks.md': `# Gerenciamento de Tarefas

## Pendente

## Fazendo

## Concluído
- [x] Inicialização da memória .ai-dev-hub
`,

      'changes.md': `# Histórico de Mudanças

## Arquivos Alterados Recentemente
- \`.ai-dev-hub/project.md\`
- \`.ai-dev-hub/architecture.md\`
- \`.ai-dev-hub/decisions.md\`
- \`.ai-dev-hub/tasks.md\`
- \`.ai-dev-hub/changes.md\`
- \`.ai-dev-hub/session-summary.md\`

## Detalhes das Alterações
- Criação da estrutura de memória permanente do AI DEV HUB.
`,

      'session-summary.md': `# Resumo da Sessão Atual

## Estado Atual do Projeto
Projeto inicializado com sucesso e memória permanente configurada.

## Último Problema Resolvido
Configuração inicial do ambiente e pastas.

## Próximo Passo Recomendado
Analisar arquivos existentes ou iniciar desenvolvimento da primeira funcionalidade.
`,

      'program.md': getDefaultProjectProgram(initialData.name, initialData.objective)
    };

    for (const [filename, defaultContent] of Object.entries(files)) {
      const filePath = path.join(memDir, filename);
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, defaultContent, 'utf-8');
      }
    }
  }

  static ensureProgramMd(projectPath: string, projectName: string, objective?: string): string {
    const memDir = this.getMemoryDir(projectPath);
    if (!fs.existsSync(memDir)) {
      fs.mkdirSync(memDir, { recursive: true });
    }
    const programPath = path.join(memDir, 'program.md');
    if (!fs.existsSync(programPath)) {
      const defaultContent = getDefaultProjectProgram(projectName, objective);
      fs.writeFileSync(programPath, defaultContent, 'utf-8');
      return defaultContent;
    }
    return fs.readFileSync(programPath, 'utf-8');
  }

  static readMemoryFiles(projectPath: string): ProjectMemory {
    const memDir = this.getMemoryDir(projectPath);
    const read = (filename: string): string => {
      const filePath = path.join(memDir, filename);
      if (fs.existsSync(filePath)) {
        try {
          return fs.readFileSync(filePath, 'utf-8');
        } catch {
          return '';
        }
      }
      return '';
    };

    return {
      projectMd: read('project.md'),
      architectureMd: read('architecture.md'),
      decisionsMd: read('decisions.md'),
      tasksMd: read('tasks.md'),
      changesMd: read('changes.md'),
      sessionSummaryMd: read('session-summary.md'),
      programMd: read('program.md') || getDefaultProjectProgram(path.basename(projectPath)),
      lessonsMd: read('lessons.md')
    };
  }

  static updateMemoryFile(projectPath: string, filename: string, content: string): boolean {
    const memDir = this.getMemoryDir(projectPath);
    if (!fs.existsSync(memDir)) {
      fs.mkdirSync(memDir, { recursive: true });
    }
    const safeFilename = path.basename(filename);
    const filePath = path.join(memDir, safeFilename);
    fs.writeFileSync(filePath, content, 'utf-8');
    return true;
  }

  static syncLessonsMd(projectPath: string, lessons: Array<{
    category: string;
    failureClassification: string;
    problemSummary: string;
    rootCause: string;
    failedStrategy?: string | null;
    workingStrategy?: string | null;
    regressionTest?: string | null;
    environmentLimitation?: string | null;
    resolved: boolean | number;
    occurrences: number;
    updatedAt: string;
  }>): void {
    if (!projectPath || !fs.existsSync(projectPath)) return;
    const lines = [
      '# Lições Operacionais Aprendidas (Memória Autônoma)',
      '',
      '> Registro estruturado de causas-raiz confirmadas, estratégias que falharam e reparos validados em produção.',
      ''
    ];
    for (const l of lessons) {
      const statusBadge = l.resolved ? 'RESOLVIDO' : 'EM ABERTO';
      lines.push(`### [${statusBadge}] [${l.category}/${l.failureClassification}] ${l.problemSummary}`);
      lines.push(`- **Causa-raiz confirmada:** ${l.rootCause}`);
      if (l.failedStrategy) lines.push(`- **Estratégia que falhou (EVITAR):** ${l.failedStrategy}`);
      if (l.workingStrategy) lines.push(`- **Estratégia que funcionou (APLICAR):** ${l.workingStrategy}`);
      if (l.regressionTest) lines.push(`- **Teste de regressão:** \`${l.regressionTest}\``);
      if (l.environmentLimitation) lines.push(`- **Limitação do ambiente:** ${l.environmentLimitation}`);
      lines.push(`- **Ocorrências:** ${l.occurrences} | **Atualizado em:** ${l.updatedAt}`);
      lines.push('');
    }
    try {
      this.updateMemoryFile(projectPath, 'lessons.md', lines.join('\n'));
    } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "memoryManager",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:memoryManager]", err);
      }
    }
  }

  static parseTasks(tasksMdContent: string): ParsedTasks {
    const result: ParsedTasks = {
      pending: [],
      doing: [],
      done: []
    };

    let currentSection: 'pending' | 'doing' | 'done' | null = null;
    const lines = tasksMdContent.split(/\r?\n/);

    for (const line of lines) {
      const trimmed = line.trim();
      const lower = trimmed.toLowerCase();

      if (lower.includes('## pendente') || lower.includes('# pendente')) {
        currentSection = 'pending';
        continue;
      } else if (lower.includes('## fazendo') || lower.includes('# fazendo') || lower.includes('em andamento')) {
        currentSection = 'doing';
        continue;
      } else if (lower.includes('## concluído') || lower.includes('## concluido') || lower.includes('# concluído') || lower.includes('# concluido')) {
        currentSection = 'done';
        continue;
      }

      if (trimmed.startsWith('- [ ]') || trimmed.startsWith('- [x]') || trimmed.startsWith('- [*]') || trimmed.startsWith('- ')) {
        const taskText = trimmed.replace(/^-\s*(\[[ x*]\]\s*)?/, '').trim();
        if (taskText) {
          if (currentSection === 'pending') {
            result.pending.push(taskText);
          } else if (currentSection === 'doing') {
            result.doing.push(taskText);
          } else if (currentSection === 'done') {
            result.done.push(taskText);
          } else {
            // Default to pending if not in a section
            result.pending.push(taskText);
          }
        }
      }
    }

    return result;
  }

  static formatTasks(tasks: ParsedTasks): string {
    return `# Gerenciamento de Tarefas

## Pendente
${tasks.pending.length ? tasks.pending.map(t => `- [ ] ${t}`).join('\n') : '- (Nenhuma tarefa pendente)'}

## Fazendo
${tasks.doing.length ? tasks.doing.map(t => `- [ ] ${t}`).join('\n') : '- (Nenhuma tarefa em andamento)'}

## Concluído
${tasks.done.length ? tasks.done.map(t => `- [x] ${t}`).join('\n') : '- (Nenhuma tarefa concluída)'}
`;
  }
}
