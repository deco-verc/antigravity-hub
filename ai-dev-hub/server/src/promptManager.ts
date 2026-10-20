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
  techStack?: string;
  apiContractsSummary?: string;
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

interface CachedPromptEntry {
  content: string;
  hash: string;
  mtimeMs: number;
  filePath: string;
}

export class PromptManager {
  private static promptCache = new Map<string, CachedPromptEntry>();
  private static basePromptDir: string = path.resolve(process.cwd(), 'prompts', 'gemini');

  /**
   * Configure base prompt directory (useful for testing)
   */
  static setPromptDir(dir: string): void {
    this.basePromptDir = dir;
    this.promptCache.clear();
  }

  /**
   * Normalizes prompt identifier and aliases to canonical IDs:
   * - 'fable-worker-v1-max' (alias: 'fable-v1-max', 'v1-max')
   * - 'fable-worker-v2-flash-max' (alias: 'fable-v2-max', 'fable-max', 'v2-max')
   * - 'fable-worker-v2-flash' (alias: 'fable-v2', 'v2')
   * - 'fable-worker-v1' (alias: 'fable-v1', 'fable')
   * - 'legacy-worker-v1' (alias: 'legacy')
   * - 'native' (alias: 'none', '')
   */
  static normalizePromptId(id?: string): string {
    const raw = (id || 'native').trim().toLowerCase();
    if (raw === 'fable-worker-v1-max' || raw === 'fable-v1-max' || raw === 'v1-max') {
      return 'fable-worker-v1-max';
    }
    if (
      raw === 'fable-worker-v2-flash-max' ||
      raw === 'fable-v2-max' ||
      raw === 'fable-max' ||
      raw === 'v2-max'
    ) {
      return 'fable-worker-v2-flash-max';
    }
    if (raw === 'fable-worker-v2-flash' || raw === 'fable-v2' || raw === 'v2') {
      return 'fable-worker-v2-flash';
    }
    if (raw === 'fable-worker-v1' || raw === 'fable-v1' || raw === 'fable') {
      return 'fable-worker-v1';
    }
    if (raw === 'legacy-worker-v1' || raw === 'legacy') {
      return 'legacy-worker-v1';
    }
    if (raw === 'native' || raw === 'none' || !raw) {
      return 'native';
    }
    return raw;
  }

  /**
   * Resolves the canonical path to a prompt template across dev, server cwd, and packaged environments
   */
  static getPromptPath(promptId = 'fable-worker-v1'): string {
    const canonicalId = this.normalizePromptId(promptId);
    const fileName = `${canonicalId}.md`;

    // 1. Priority: configured basePromptDir (supports setPromptDir in unit tests)
    const directPath = path.join(this.basePromptDir, fileName);
    if (fs.existsSync(directPath)) return directPath;

    // 2. Parent directory fallback (when process.cwd() is ai-dev-hub/server)
    const parentPromptDir = path.resolve(process.cwd(), '..', 'prompts', 'gemini', fileName);
    if (fs.existsSync(parentPromptDir)) return parentPromptDir;

    // 3. Canonical repository root fallback
    const rootPath = path.resolve('C:/IA/Antigravity HUB/ai-dev-hub/prompts/gemini', fileName);
    if (fs.existsSync(rootPath)) return rootPath;

    throw new Error(`PROMPT_NOT_FOUND: Arquivo de prompt "${canonicalId}.md" não encontrado em ${this.basePromptDir}`);
  }

  /**
   * Loads base prompt, validates integrity, checks disk mtime for hot-reload, and computes deterministic SHA256
   */
  static loadBasePrompt(promptId = 'native'): { content: string; hash: string } {
    const canonicalId = this.normalizePromptId(promptId);
    if (canonicalId === 'native') {
      return { content: '', hash: 'native' };
    }

    const filePath = this.getPromptPath(canonicalId);
    let currentMtimeMs = 0;
    try {
      currentMtimeMs = fs.statSync(filePath).mtimeMs;
    } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "promptManager",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:promptManager]", err);
      }
    }

    const cached = this.promptCache.get(promptId);
    if (cached && cached.filePath === filePath && cached.mtimeMs === currentMtimeMs) {
      return { content: cached.content, hash: cached.hash };
    }

    const content = fs.readFileSync(filePath, 'utf-8').trim().replace(/\r\n/g, '\n');

    if (!content || content.length < 50) {
      throw new Error(`PROMPT_EMPTY: Prompt "${promptId}" em ${filePath} está vazio ou corrompido.`);
    }

    const hash = crypto.createHash('sha256').update(content).digest('hex');

    Logger.info(`[PromptManager] PROMPT_LOADED prompt_id=${promptId} prompt_hash=${hash.slice(0, 16)}... (bytes: ${content.length})`);

    this.promptCache.set(promptId, {
      content,
      hash,
      mtimeMs: currentMtimeMs,
      filePath
    });

    return { content, hash };
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
      '- maintain code integrity in implementation files;',
      '- report evidence accurately.',
      '',
      'Operational & Quality Invariants:',
      '- operate with 100% non-interactive autonomy (never invoke ask_question or blocking prompts);',
      '- never weaken, skip, or modify protected evaluation test files to force a pass;',
      '- in full-stack/web apps, serve public/index.html on GET / and isolate JSON healthchecks on GET /api/health;',
      '- never bind default fallback ports to 3001/3000/5173 (use 4000-4999 via process.env.PORT || 4000);',
      '- enforce AppSec by default: parameterized SQLite queries (?), escapeHtml/textContent on DOM, and path traversal bounds;',
      '- in frontend tasks, use semantic CSS tokens (:root), inline SVG icons (zero emojis as icons), and tabular-nums.',
      '',
      'Do not perform Supervisor duties.',
      'Do not approve your own Task.',
      'Do not manipulate Task status directly.',
      '</DECOHUB_ROLE>'
    ].join('\n');
  }

  /**
   * Generates Project Context XML from authoritative sources with defensive length clamping
   */
  static buildProjectContextXml(input: ProjectContextInput): string {
    const lines = [
      '<DECOHUB_PROJECT_CONTEXT>',
      `project_name: ${input.projectName || 'N/A'}`,
      `project_path: ${input.projectPath || '.'}`,
      `objective: ${input.objective || 'N/A'}`
    ];

    if (input.techStack) {
      lines.push(`tech_stack: ${input.techStack}`);
    }

    if (input.projectPath) {
      try {
        const specsDir = path.join(path.resolve(input.projectPath), '.ai-dev-hub', 'specs');
        if (fs.existsSync(specsDir)) {
          lines.push('canonical_specifications:');
          const canonicalSpecs = [
            'PRINCIPIOS.md',
            'CONTEUDO.md',
            'BACKEND.md',
            'DESIGN.md',
            'JORNADAS.md'
          ];
          for (const specFile of canonicalSpecs) {
            if (fs.existsSync(path.join(specsDir, specFile))) {
              lines.push(`- @.ai-dev-hub/specs/${specFile}`);
            }
          }
        }
      } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "promptManager",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:promptManager]", err);
      }
    }
    }

    if (input.memorySummary) {
      const clampedMemory = input.memorySummary.length > 3500
        ? `${input.memorySummary.slice(0, 3500)}... [truncated]`
        : input.memorySummary;
      lines.push(`memory_summary: ${clampedMemory}`);
    }

    if (input.apiContractsSummary) {
      lines.push(`api_contracts: ${input.apiContractsSummary.slice(0, 2000)}`);
    }

    if (input.completedTasks && input.completedTasks.length > 0) {
      const recentCompleted = input.completedTasks.slice(-25);
      lines.push(`completed_tasks:\n- ${recentCompleted.join('\n- ')}`);
    }

    if (input.recentDecisions && input.recentDecisions.length > 0) {
      const recentDecs = input.recentDecisions.slice(-15);
      lines.push(`recent_decisions:\n- ${recentDecs.join('\n- ')}`);
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
    const promptId = this.normalizePromptId(params.promptId);

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

    let livingSpecsSection = '';
    if (params.project.projectPath) {
      try {
        const specsDir = path.join(path.resolve(params.project.projectPath), '.ai-dev-hub', 'specs');
        if (fs.existsSync(specsDir)) {
          livingSpecsSection = [
            '',
            '---',
            '',
            '## ESPECIFICAÇÕES VIVAS OBRIGATÓRIAS (FONTE ÚNICA DE VERDADE)',
            'Antes de iniciar qualquer microtarefa, leia e consulte os 4 documentos canônicos em `.ai-dev-hub/specs/` (`PRINCIPIOS.md`, `CONTEUDO.md`, `BACKEND.md`, `DESIGN.md`). Eles constituem a Fonte Única de Verdade do projeto.',
            '- `@.ai-dev-hub/specs/PRINCIPIOS.md`: Invariantes Karpathy, PORT_GUARD (faixa 4000-4999) e blindagem AppSec.',
            '- `@.ai-dev-hub/specs/CONTEUDO.md`: Seções canônicas (01-Dashboard, etc.), abas role="tab", KPIs e dados realistas de seed.',
            '- `@.ai-dev-hub/specs/BACKEND.md`: Tabelas SQLite exatas, contratos REST e regras de validação HTTP 400.',
            '- `@.ai-dev-hub/specs/DESIGN.md`: Tokens CSS semânticos :root, tipografia tabular-nums e ícones SVG inline.',
            'É estritamente proibido criar arquivos intermediários em `.ai-dev-hub/notes/` ou inventar rotas e tabelas divergentes.'
          ].join('\n');
        }
      } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "promptManager",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:promptManager]", err);
      }
    }
    }

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
      projectContextXml,
      livingSpecsSection
    ].filter(Boolean).join('\n');

    // Concise bootstrap instructions for agentapi new-conversation CLI argument
    // (kept well within Windows 32KB CreateProcess command-line limit)
    const promptTitle = promptId === 'fable-worker-v2-flash-max'
      ? 'Fable 5.1 MAX Velocity Flash'
      : promptId === 'fable-worker-v1-max'
      ? 'Fable 5.1 MAX Fidelity Port'
      : promptId === 'fable-worker-v2-flash'
      ? 'Fable Flash V2 Optimized'
      : 'Fable 5.1 Fidelity Port';

    const loopSummary = promptId === 'fable-worker-v2-flash-max'
      ? 'Princípios centrais: Minimum Sufficient Context, Action Bias com calibração cognitiva MAX. Inspect -> Modify -> Test -> Verify.'
      : promptId === 'fable-worker-v1-max'
      ? 'Siga o ciclo rigoroso de execução com calibração cognitiva MAX: Inspect -> Plan surgically -> Modify -> Run -> Test -> Verify.'
      : promptId === 'fable-worker-v2-flash'
      ? 'Princípios centrais: Minimum Sufficient Context, Action Bias. Inspect -> Modify -> Test -> Verify.'
      : 'Siga o ciclo rigoroso de execução: Inspect -> Plan surgically -> Modify -> Run -> Test -> Verify.';

    const bootstrapInstructions = [
      `[DECOHUB WORKER BOOTSTRAP — PROMPT: ${promptId} (SHA256: ${base.hash.slice(0, 16)}...)]`,
      `Você é o Worker/Builder autônomo do DecoHUB. As diretrizes completas de engenharia (${promptTitle}) estão ativas.`,
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
   * Writes the project-level rule file (.agents/rules/decohub-worker.md) idempotently
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
      if (fs.existsSync(ruleFilePath)) {
        const existing = fs.readFileSync(ruleFilePath, 'utf-8');
        if (existing === instructions) {
          return ruleFilePath;
        }
      }
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
    variant: 'native' | 'legacy' | 'fable-worker-v1' | 'fable-worker-v2-flash' | 'fable-worker-v1-max' | 'fable-worker-v2-flash-max' | string
  ): { valid: boolean; reason?: string } {
    const normVariant = this.normalizePromptId(variant);
    const ruleFilePath = path.join(projectPath, '.agents', 'rules', 'decohub-worker.md');
    const exists = fs.existsSync(ruleFilePath);

    if (normVariant === 'native' || normVariant === 'legacy' || normVariant === 'legacy-worker-v1') {
      if (exists) {
        const content = fs.readFileSync(ruleFilePath, 'utf-8');
        if (content.includes('fable-worker-v1') || content.includes('fable-worker-v2-flash') || content.includes('FABLE') || content.includes('Fable')) {
          return { valid: false, reason: `LEAK_DETECTED: Legacy/Native workspace contains Fable Worker rule file at ${ruleFilePath}` };
        }
      }
      return { valid: true };
    } else if (normVariant === 'fable-worker-v2-flash-max') {
      if (!exists) {
        return { valid: false, reason: `MISSING_RULE_FILE: Fable V2 Max workspace is missing ${ruleFilePath}` };
      }
      const content = fs.readFileSync(ruleFilePath, 'utf-8');
      if (!content.includes('fable-worker-v2-flash') && !content.includes('Fable 5.1') && !content.includes('Action Bias') && !content.includes('Minimum Sufficient Context')) {
        return { valid: false, reason: `INVALID_RULE_CONTENT: Rule file at ${ruleFilePath} does not contain Fable Worker V2 Flash Max instructions` };
      }
      return { valid: true };
    } else if (normVariant === 'fable-worker-v1-max') {
      if (!exists) {
        return { valid: false, reason: `MISSING_RULE_FILE: Fable V1 Max workspace is missing ${ruleFilePath}` };
      }
      const content = fs.readFileSync(ruleFilePath, 'utf-8');
      if (!content.includes('fable-worker-v1') && !content.includes('Fable 5.1') && !content.includes('Fidelity') && !content.includes('reasoning_effort')) {
        return { valid: false, reason: `INVALID_RULE_CONTENT: Rule file at ${ruleFilePath} does not contain Fable Worker V1 Max instructions` };
      }
      return { valid: true };
    } else if (normVariant === 'fable-worker-v2-flash') {
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