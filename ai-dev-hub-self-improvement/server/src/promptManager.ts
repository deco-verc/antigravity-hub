// server/src/promptManager.ts
// Central manager for prompt loading, validation, hashing, dynamic runtime contract injection, and role overlay.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Logger } from './logger.js';

export interface RuntimeContextInput {
  projectPath: string;
  runId?: string | null;
  taskId?: string | null;
  workerId?: string | null;
  accountProfileId?: string | null;
  requestedModel?: string | null;
  actualModel?: string | null;
  workspaceGitRoot?: string | null;
  runtimeCwd?: string | null;
}

export interface ProjectContextInput {
  projectName?: string;
  projectPath?: string;
  objective?: string;
  memorySummary?: string;
  recentDecisions?: string[];
  completedTasks?: string[];
}

export interface WorkerInstructionBundle {
  promptId: string;
  promptHash: string;
  systemInstructions: string;
  runtimeContextXml: string;
  workerRoleOverlayXml: string;
  projectContextXml: string;
  bootstrapInstructions: string;
  fullRuleContent: string;
}

export class PromptManager {
  private static promptCache = new Map<string, { content: string; hash: string }>();
  private static basePromptDir: string = path.resolve(process.cwd(), 'prompts', 'gemini');

  /**
   * Configure base prompt directory (useful for testing)
   */
  static setPromptDir(dir: string): void {
    this.basePromptDir = dir;
    this.promptCache.clear();
  }

  /**
   * Resolves the canonical path to a prompt template
   */
  static getPromptPath(promptId = 'fable-worker-v1'): string {
    // Try current working dir relative first, then __dirname relative if bundled/compiled
    const directPath = path.join(this.basePromptDir, `${promptId}.md`);
    if (fs.existsSync(directPath)) return directPath;

    // Fallback relative to repository root
    const rootPath = path.resolve('C:/IA/Antigravity HUB/ai-dev-hub/prompts/gemini', `${promptId}.md`);
    if (fs.existsSync(rootPath)) return rootPath;

    throw new Error(`PROMPT_NOT_FOUND: Arquivo de prompt "${promptId}.md" não encontrado em ${this.basePromptDir}`);
  }

  /**
   * Loads base prompt, validates integrity, and computes deterministic SHA256
   */
  static loadBasePrompt(promptId = 'native'): { content: string; hash: string } {
    if (promptId === 'native') {
      return { content: '', hash: 'native' };
    }

    const cached = this.promptCache.get(promptId);
    if (cached) {
      return cached;
    }

    const filePath = this.getPromptPath(promptId);
    const content = fs.readFileSync(filePath, 'utf-8').trim();

    if (!content || content.length < 50) {
      throw new Error(`PROMPT_EMPTY: Prompt "${promptId}" em ${filePath} está vazio ou corrompido.`);
    }

    const hash = crypto.createHash('sha256').update(content).digest('hex');

    Logger.info(`[PromptManager] PROMPT_LOADED prompt_id=${promptId} prompt_hash=${hash.slice(0, 16)}... (bytes: ${content.length})`);

    const loaded = { content, hash };
    this.promptCache.set(promptId, loaded);
    return loaded;
  }

  /**
   * Generates dynamic XML for runtime contract
   * Invariant: Never fabricate actualModel. If not verifiable, use UNKNOWN.
   */
  static buildRuntimeContextXml(input: RuntimeContextInput): string {
    const actual = input.actualModel && input.actualModel.trim().length > 0
      ? input.actualModel.trim()
      : 'UNKNOWN';

    const requested = input.requestedModel && input.requestedModel.trim().length > 0
      ? input.requestedModel.trim()
      : 'UNKNOWN';

    return [
      '<DECOHUB_RUNTIME_CONTEXT>',
      `project_path: ${input.projectPath}`,
      `run_id: ${input.runId || 'N/A'}`,
      `task_id: ${input.taskId || 'N/A'}`,
      `worker_id: ${input.workerId || 'N/A'}`,
      `account_profile_id: ${input.accountProfileId || 'N/A'}`,
      `requested_model: ${requested}`,
      `actual_model: ${actual}`,
      `workspace_git_root: ${input.workspaceGitRoot || input.projectPath}`,
      `runtime_cwd: ${input.runtimeCwd || input.projectPath}`,
      '</DECOHUB_RUNTIME_CONTEXT>'
    ].join('\n');
  }

  /**
   * Generates Worker Role Overlay XML
   */
  static buildWorkerRoleOverlayXml(): string {
    return [
      '<DECOHUB_ROLE>',
      'role: WORKER',
      '',
      'You are the implementation Worker for the current DecoHUB Task.',
      '',
      'Your responsibility is to:',
      '- inspect the real project;',
      '- implement the assigned Task;',
      '- run required commands;',
      '- test the implementation;',
      '- correct failures you introduced;',
      '- update project memory where appropriate;',
      '- report evidence accurately.',
      '',
      'Do not perform Supervisor duties.',
      'Do not approve your own Task.',
      'Do not manipulate Task status directly.',
      '</DECOHUB_ROLE>'
    ].join('\n');
  }

  /**
   * Generates Project Context XML from authoritative sources
   */
  static buildProjectContextXml(input: ProjectContextInput): string {
    const lines = [
      '<DECOHUB_PROJECT_CONTEXT>',
      `project_name: ${input.projectName || 'N/A'}`,
      `project_path: ${input.projectPath || '.'}`,
      `objective: ${input.objective || 'N/A'}`
    ];

    if (input.memorySummary) {
      lines.push(`memory_summary: ${input.memorySummary}`);
    }

    if (input.completedTasks && input.completedTasks.length > 0) {
      lines.push(`completed_tasks:\n- ${input.completedTasks.join('\n- ')}`);
    }

    if (input.recentDecisions && input.recentDecisions.length > 0) {
      lines.push(`recent_decisions:\n- ${input.recentDecisions.join('\n- ')}`);
    }

    lines.push('</DECOHUB_PROJECT_CONTEXT>');
    return lines.join('\n');
  }

  /**
   * Bundles the full Worker system instruction set in the strict conceptual order:
   * 1. FABLE FIDELITY BASE
   * 2. DECOHUB RUNTIME CONTRACT
   * 3. WORKER ROLE OVERLAY
   * 4. PROJECT CONTEXT
   */
  static buildWorkerInstructions(params: {
    promptId?: string;
    runtime: RuntimeContextInput;
    project: ProjectContextInput;
  }): WorkerInstructionBundle {
    const promptId = params.promptId || 'native';

    if (promptId === 'native') {
      return {
        promptId: 'native',
        promptHash: 'native',
        systemInstructions: '',
        runtimeContextXml: '',
        workerRoleOverlayXml: '',
        projectContextXml: '',
        bootstrapInstructions: '',
        fullRuleContent: ''
      };
    }

    const base = this.loadBasePrompt(promptId);

    if (promptId === 'legacy-worker-v1') {
      return {
        promptId,
        promptHash: base.hash,
        systemInstructions: base.content,
        runtimeContextXml: '',
        workerRoleOverlayXml: '',
        projectContextXml: '',
        bootstrapInstructions: 'Você é o Builder Antigravity. Aguarde tarefas do Supervisor.',
        fullRuleContent: ''
      };
    }

    const runtimeContextXml = this.buildRuntimeContextXml(params.runtime);
    const workerRoleOverlayXml = this.buildWorkerRoleOverlayXml();
    const projectContextXml = this.buildProjectContextXml(params.project);

    // Full rule content for directory-level file (.agents/rules/decohub-worker.md)
    const fullRuleContent = [
      base.content,
      '',
      '---',
      '',
      runtimeContextXml,
      '',
      workerRoleOverlayXml,
      '',
      projectContextXml
    ].join('\n');

    // Concise bootstrap instructions for agentapi new-conversation CLI argument
    // (kept well within Windows 32KB CreateProcess command-line limit)
    const promptTitle = promptId === 'fable-worker-v2-flash'
      ? 'Fable Flash V2 Optimized'
      : 'Fable 5.1 Fidelity Port';
    const loopSummary = promptId === 'fable-worker-v2-flash'
      ? 'Princípios centrais: Minimum Sufficient Context, Action Bias. Inspect -> Modify -> Test -> Verify.'
      : 'Siga o ciclo rigoroso de execução: Inspect -> Plan surgically -> Modify -> Run -> Test -> Verify.';

    const bootstrapInstructions = [
      `[DECOHUB WORKER BOOTSTRAP — PROMPT: ${promptId} (SHA256: ${base.hash.slice(0, 16)}...)]`,
      `Você é o Worker/Builder autônomo do DecoHUB. As diretrizes completas de engenharia (${promptTitle}) estão ativas e documentadas em .agents/rules/decohub-worker.md neste projeto.`,
      '',
      runtimeContextXml,
      '',
      workerRoleOverlayXml,
      '',
      projectContextXml,
      '',
      loopSummary
    ].join('\n');

    return {
      promptId,
      promptHash: base.hash,
      systemInstructions: base.content,
      runtimeContextXml,
      workerRoleOverlayXml,
      projectContextXml,
      bootstrapInstructions,
      fullRuleContent
    };
  }

  /**
   * Writes the project-level rule file (.agents/rules/decohub-worker.md)
   * or cleans it up if instructions is null/empty (guaranteeing no Fable leaks to Legacy).
   */
  static ensureProjectRulesFile(projectPath: string, instructions?: string | null): string | null {
    if (!fs.existsSync(projectPath)) return null;
    try {
      const rulesDir = path.join(projectPath, '.agents', 'rules');
      const ruleFilePath = path.join(rulesDir, 'decohub-worker.md');

      if (!instructions || instructions.trim().length === 0) {
        if (fs.existsSync(ruleFilePath)) {
          fs.unlinkSync(ruleFilePath);
          Logger.info(`[PromptManager] Regra de workspace removida para variante nativa/legacy em ${ruleFilePath}`);
        }
        return null;
      }

      fs.mkdirSync(rulesDir, { recursive: true });
      fs.writeFileSync(ruleFilePath, instructions, 'utf-8');
      return ruleFilePath;
    } catch (err: any) {
      Logger.warn(`[PromptManager] Falha ao gerenciar rule file em ${projectPath}: ${err.message}`);
      return null;
    }
  }

  /**
   * Validates that the workspace has strict prompt isolation:
   * - Native: .agents/rules/decohub-worker.md MUST NOT exist (cleaned if found).
   * - Legacy: .agents/rules/decohub-worker.md MUST NOT exist or must not contain Fable prompt.
   * - Fable V1: .agents/rules/decohub-worker.md MUST exist and match expected Fable V1 content.
   * - Fable V2: .agents/rules/decohub-worker.md MUST exist and match expected Fable V2 content.
   */
  static validateWorkspacePromptIsolation(
    projectPath: string,
    variant: 'native' | 'legacy' | 'fable-worker-v1' | 'fable-worker-v2-flash' | string
  ): { valid: boolean; reason?: string } {
    const ruleFilePath = path.join(projectPath, '.agents', 'rules', 'decohub-worker.md');
    const exists = fs.existsSync(ruleFilePath);

    if (variant === 'native' || variant === 'legacy' || variant === 'legacy-worker-v1') {
      if (exists) {
        const content = fs.readFileSync(ruleFilePath, 'utf-8');
        if (content.includes('fable-worker-v1') || content.includes('fable-worker-v2-flash') || content.includes('FABLE') || content.includes('Fable')) {
          return { valid: false, reason: `LEAK_DETECTED: Legacy/Native workspace contains Fable Worker rule file at ${ruleFilePath}` };
        }
      }
      return { valid: true };
    } else if (variant === 'fable-worker-v2-flash') {
      if (!exists) {
        return { valid: false, reason: `MISSING_RULE_FILE: Fable V2 workspace is missing ${ruleFilePath}` };
      }
      const content = fs.readFileSync(ruleFilePath, 'utf-8');
      if (!content.includes('Minimum Sufficient Context') && !content.includes('Action Bias') && !content.includes('fable-worker-v2-flash')) {
        return { valid: false, reason: `INVALID_RULE_CONTENT: Rule file at ${ruleFilePath} does not contain Fable Worker V2 Flash instructions` };
      }
      return { valid: true };
    } else {
      if (!exists) {
        return { valid: false, reason: `MISSING_RULE_FILE: Fable workspace is missing ${ruleFilePath}` };
      }
      const content = fs.readFileSync(ruleFilePath, 'utf-8');
      if (!content.includes('fable-worker-v1') && !content.includes('Fable 5.1 Fidelity Port') && !content.includes('## Instruction hierarchy')) {
        return { valid: false, reason: `INVALID_RULE_CONTENT: Rule file at ${ruleFilePath} does not contain Fable Worker V1 instructions` };
      }
      return { valid: true };
    }
  }
}
