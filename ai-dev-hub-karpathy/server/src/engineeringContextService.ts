import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getGlobalAgentGuidelines } from './agentGuidelines.js';
import { MemoryManager } from './memoryManager.js';
import { Logger } from './logger.js';

export interface EngineeringContextSources {
  guidelinesSource: string;
  programSource: string;
  projectSource?: string;
  architectureSource?: string;
  decisionsSource?: string;
}

export interface TaskEngineeringPackage {
  contextVersion: string;
  contextHash: string;
  sources: EngineeringContextSources;
  preflightStatus: 'READY' | 'RECOVERED_DEFAULTS' | 'FAILED';
  preflightErrors?: string[];
  
  // Compact packaged prompt parts
  globalGuidelinesSummary: string;
  projectProgramSummary: string;
  architectureSummary?: string;
  decisionsSummary?: string;
  
  // Goal-driven task specifics
  taskContract: {
    objective: string;
    acceptanceCriteria: string[];
    verificationCommand: string;
    doneWhen: string;
    expectedScopeFiles?: string[];
  };
  
  // Formatted compact text block ready for Native Gemini task prompt injection
  formattedPromptBlock: string;
}

export class EngineeringContextService {
  private static readonly MAX_SECTION_LENGTH = 1200;

  /**
   * Truncates text cleanly if it exceeds maximum allowed length
   */
  private static compactText(text: string, maxLen = this.MAX_SECTION_LENGTH): string {
    if (!text) return '';
    const trimmed = text.trim();
    if (trimmed.length <= maxLen) return trimmed;
    return trimmed.slice(0, maxLen) + '\n... [conteúdo condensado para economia de tokens]';
  }

  /**
   * Assembles an authoritative Engineering Context Package for a project and task.
   * Completely isolated per projectPath.
   */
  static prepareTaskContext(params: {
    projectPath: string;
    projectName: string;
    projectObjective?: string;
    task: {
      id?: string;
      title: string;
      description?: string;
      criteria?: string[];
      verificationCommand?: string;
      doneWhen?: string;
      expectedScopeFiles?: string[];
    };
  }): TaskEngineeringPackage {
    const { projectPath, projectName, projectObjective, task } = params;
    const errors: string[] = [];
    let preflightStatus: 'READY' | 'RECOVERED_DEFAULTS' | 'FAILED' = 'READY';

    // 1. Verify project directory
    if (!fs.existsSync(projectPath)) {
      errors.push(`Diretório do projeto não encontrado: ${projectPath}`);
      preflightStatus = 'FAILED';
    }

    // 2. Global Agent Guidelines
    const guidelines = getGlobalAgentGuidelines();
    const guidelinesSource = 'server/src/agent-guidelines.md';

    // 3. Project Program (.ai-dev-hub/program.md)
    let programContent = '';
    const memDir = path.join(projectPath, '.ai-dev-hub');
    const programPath = path.join(memDir, 'program.md');

    try {
      programContent = MemoryManager.ensureProgramMd(projectPath, projectName, projectObjective);
    } catch (err: any) {
      errors.push(`Erro ao carregar ou gerar program.md: ${err.message}`);
      preflightStatus = 'RECOVERED_DEFAULTS';
    }

    // 4. Project context files (read without crashing if missing)
    let memoryFiles = {
      projectMd: '',
      architectureMd: '',
      decisionsMd: '',
      tasksMd: ''
    };

    try {
      if (fs.existsSync(projectPath)) {
        memoryFiles = MemoryManager.readMemoryFiles(projectPath);
      }
    } catch (err: any) {
      Logger.warn(`[EngineeringContextService] Falha ao ler arquivos de memória adicionais: ${err.message}`);
    }

    // Extract recent decisions (last 3 decisions to keep context lean)
    let decisionsSnippet = '';
    if (memoryFiles.decisionsMd) {
      const decisionLines = memoryFiles.decisionsMd
        .split('\n')
        .filter(l => l.trim().startsWith('-') || l.trim().startsWith('###') || l.trim().startsWith('*'))
        .slice(-8)
        .join('\n');
      decisionsSnippet = this.compactText(decisionLines, 600);
    }

    // Architecture snippet
    let archSnippet = '';
    if (memoryFiles.architectureMd) {
      archSnippet = this.compactText(memoryFiles.architectureMd, 600);
    }

    // 5. Build Goal-Driven task contract with fallback defaults
    const objective = task.title.trim() || 'Implementar tarefa solicitada';
    const acceptanceCriteria = (task.criteria && task.criteria.length > 0)
      ? task.criteria.map(c => c.trim()).filter(Boolean)
      : [`Atender integralmente o objetivo da tarefa: "${objective}"`, 'Garantir que testes automatizados executem com sucesso'];

    const verificationCommand = task.verificationCommand?.trim() || 'npm test';
    const doneWhen = task.doneWhen?.trim() || 'Todos os critérios atendidos e verificação retornando código de saída 0.';
    const expectedScopeFiles = task.expectedScopeFiles || [];

    // 6. Compact and summarize sections
    const compactGuidelines = this.compactText(guidelines, 800);
    const compactProgram = this.compactText(programContent, 900);

    // 7. Calculate deterministic hash (fingerprint) of the context package
    const hashPayload = JSON.stringify({
      projectPath,
      projectName,
      compactGuidelines,
      compactProgram,
      decisionsSnippet,
      objective,
      acceptanceCriteria,
      verificationCommand
    });
    const contextHash = crypto.createHash('sha256').update(hashPayload).digest('hex').slice(0, 16);
    const contextVersion = 'karpathy-v1';

    // 8. Generate compact prompt block (safe for Native Gemini prompt injection)
    const promptParts = [
      `[CONSTITUIÇÃO DO PROJETO & DIRETRIZES DE ENGENHARIA — KARPATHY LAYER (Hash: ${contextHash})]`,
      `PRINCÍPIOS INVIOLÁVEIS:`,
      `1. THINK BEFORE CODING: Declare premissas e opções antes de escrever código; não presuma em silêncio.`,
      `2. SIMPLICITY FIRST: Menor código correto que resolve o problema. Zero abstrações especulativas.`,
      `3. SURGICAL CHANGES: Modifique apenas os arquivos necessários da tarefa. Sem refatorações adjacentes.`,
      `4. GOAL-DRIVEN: Toda tarefa tem objetivo declarado, critérios binários e comando de teste automatizado.`,
      ``,
      decisionsSnippet ? `DECISÕES TÉCNICAS RECENTES (PRESERVAR):\n${decisionsSnippet}\n` : '',
      archSnippet ? `ARQUITETURA & CONVENÇÕES:\n${archSnippet}\n` : '',
      `CONTRATO DA TAREFA:`,
      `OBJETIVO: ${objective}`,
      task.description ? `DETALHES: ${task.description}` : '',
      `CRITÉRIOS DE ACEITAÇÃO:`,
      ...acceptanceCriteria.map(c => ` - ${c}`),
      `VERIFICAÇÃO: ${verificationCommand}`,
      `DONE WHEN: ${doneWhen}`,
      expectedScopeFiles.length > 0 ? `ARQUIVOS NO ESCOPO: ${expectedScopeFiles.join(', ')}` : ''
    ].filter(Boolean);

    const formattedPromptBlock = promptParts.join('\n');

    return {
      contextVersion,
      contextHash,
      sources: {
        guidelinesSource,
        programSource: programPath,
        projectSource: path.join(memDir, 'project.md'),
        architectureSource: path.join(memDir, 'architecture.md'),
        decisionsSource: path.join(memDir, 'decisions.md')
      },
      preflightStatus,
      preflightErrors: errors.length > 0 ? errors : undefined,
      globalGuidelinesSummary: compactGuidelines,
      projectProgramSummary: compactProgram,
      architectureSummary: archSnippet || undefined,
      decisionsSummary: decisionsSnippet || undefined,
      taskContract: {
        objective,
        acceptanceCriteria,
        verificationCommand,
        doneWhen,
        expectedScopeFiles
      },
      formattedPromptBlock
    };
  }
}
