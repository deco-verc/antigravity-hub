// server/src/promptManager.ts
// Central manager for prompt loading, validation, hashing, dynamic runtime contract injection, and role overlay.
// Calibrated for Google Antigravity 2.0 (v2.25.0) & Gemini 3.8 XML Primacy-Recency Architecture.

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
   * Physical safety ceiling below Antigravity 2.0's strict 24,000-byte per-rule-file limit.
   */
  private static readonly MAX_RULE_FILE_BYTES = 23500;

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
   * Strips legacy placeholder blocks from base prompt markdown if present,
   * preventing duplicate XML blocks when bundling runtime and project context.
   */
  private static sanitizeBasePromptContent(rawContent: string): string {
    return rawContent
      .replace(/## Runtime context injection[\s\S]*$/i, '')
      .trim();
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
      if (typeof (globalThis as any).logger !== 'undefined' && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: 'server.handled_exception',
          file: 'promptManager',
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn('[WARN][server:promptManager]', err);
      }
    }

    const cached = this.promptCache.get(canonicalId);
    if (cached && cached.filePath === filePath && cached.mtimeMs === currentMtimeMs) {
      return { content: cached.content, hash: cached.hash };
    }

    const rawContent = fs.readFileSync(filePath, 'utf-8').trim().replace(/\r\n/g, '\n');
    const content = this.sanitizeBasePromptContent(rawContent);

    if (!content || content.length < 50) {
      throw new Error(`PROMPT_EMPTY: Prompt "${promptId}" em ${filePath} está vazio ou corrompido.`);
    }

    const hash = crypto.createHash('sha256').update(content).digest('hex');

    Logger.info(
      `[PromptManager] PROMPT_LOADED prompt_id=${canonicalId} prompt_hash=${hash.slice(0, 16)}... (bytes: ${Buffer.byteLength(content, 'utf-8')})`
    );

    this.promptCache.set(canonicalId, {
      content,
      hash,
      mtimeMs: currentMtimeMs,
      filePath
    });

    return { content, hash };
  }

  /**
   * Generates dynamic XML for runtime contract.
   * Invariant: Never fabricate actualModel. If not verifiable, use UNKNOWN.
   */
  static buildRuntimeContextXml(input: RuntimeContextInput): string {
    const actual =
      input.actualModel && input.actualModel.trim().length > 0
        ? input.actualModel.trim()
        : 'UNKNOWN';

    const requested =
      input.requestedModel && input.requestedModel.trim().length > 0
        ? input.requestedModel.trim()
        : 'UNKNOWN';

    return [
      '<DECOHUB_RUNTIME_CONTEXT>',
      `  <project_path>${input.projectPath}</project_path> <!-- project_path: ${input.projectPath} -->`,
      `  <run_id>${input.runId || 'N/A'}</run_id> <!-- run_id: ${input.runId || 'N/A'} -->`,
      `  <task_id>${input.taskId || 'N/A'}</task_id> <!-- task_id: ${input.taskId || 'N/A'} -->`,
      `  <worker_id>${input.workerId || 'N/A'}</worker_id> <!-- worker_id: ${input.workerId || 'N/A'} -->`,
      `  <account_profile_id>${input.accountProfileId || 'N/A'}</account_profile_id>`,
      `  <requested_model>${requested}</requested_model>`,
      `  <actual_model>${actual}</actual_model> <!-- actual_model: ${actual} -->`,
      `  <workspace_git_root>${input.workspaceGitRoot || input.projectPath}</workspace_git_root>`,
      `  <runtime_cwd>${input.runtimeCwd || input.projectPath}</runtime_cwd>`,
      '</DECOHUB_RUNTIME_CONTEXT>'
    ].join('\n');
  }

  /**
   * Generates Worker Role Overlay XML using affirmative operational constraints
   */
  static buildWorkerRoleOverlayXml(): string {
    return [
      '<DECOHUB_ROLE>',
      '  <role>WORKER</role> <!-- role: WORKER -->',
      '  <mission>Execute the assigned DecoHUB atomic task with surgical precision, native Antigravity 2.0 tools, and empirical verification.</mission>',
      '  <operational_invariants>',
      '    - Operate with 100% non-interactive autonomy (never call ask_question or open blocking modals).',
      '    - Use native file tools (view_file, replace_file_content, multi_replace_file_content, write_to_file); never create disposable .cjs/.mjs mutation scripts.',
      '    - Preserve protected evaluation tests intact (zero .skip, zero tautological assertions).',
      '    - Serve public/index.html on GET / and isolate JSON healthchecks strictly on GET /api/health.',
      '    - Bind server ports exclusively within 4000-4999 via Number(process.env.PORT) || 4000 (never 3000, 3001, or 5173).',
      '    - Enforce AppSec by default: parameterized SQLite queries (?), escapeHtml/textContent on DOM, and path.resolve bounds.',
      '    - Enforce Anti-Slop UI: :root semantic CSS tokens, inline Lucide SVGs (zero emojis), and font-variant-numeric: tabular-nums.',
      '    - Never perform Supervisor duties, manipulate task status in DB, or approve your own task.',
      '  </operational_invariants>',
      '</DECOHUB_ROLE>'
    ].join('\n');
  }

  /**
   * Generates Project Context XML from authoritative sources using canonical @ pointers
   * (avoiding @[label](path) inline splices that blow up the 24KB Antigravity rule limit).
   */
  static buildProjectContextXml(input: ProjectContextInput): string {
    const lines = [
      '<DECOHUB_PROJECT_CONTEXT>',
      `  <project_name>${input.projectName || 'N/A'}</project_name>`,
      `  <project_path>${input.projectPath || '.'}</project_path>`,
      `  <objective>${input.objective || 'N/A'}</objective>`
    ];

    if (input.techStack) {
      lines.push(`  <tech_stack>${input.techStack}</tech_stack>`);
    }

    if (input.projectPath) {
      try {
        const specsDir = path.join(path.resolve(input.projectPath), '.ai-dev-hub', 'specs');
        if (fs.existsSync(specsDir)) {
          lines.push('  <canonical_specification_pointers>');
          const canonicalSpecs = [
            'PRINCIPIOS.md',
            'CONTEUDO.md',
            'BACKEND.md',
            'DESIGN.md',
            'JORNADAS.md',
            'ARQUITETURA.md',
            'LIVING_SPEC.md'
          ];
          for (const specFile of canonicalSpecs) {
            if (fs.existsSync(path.join(specsDir, specFile))) {
              lines.push(`    - @.ai-dev-hub/specs/${specFile}`);
            }
          }
          lines.push('  </canonical_specification_pointers>');
        }
      } catch (err) {
        if (typeof (globalThis as any).logger !== 'undefined' && (globalThis as any).logger?.warn) {
          (globalThis as any).logger.warn({
            event: 'server.handled_exception',
            file: 'promptManager',
            error: (err as any)?.message || String(err)
          });
        } else {
          console.warn('[WARN][server:promptManager]', err);
        }
      }
    }

    if (input.memorySummary) {
      const clampedMemory =
        input.memorySummary.length > 2200
          ? `${input.memorySummary.slice(0, 2200)}... [truncated_for_24kb_budget]`
          : input.memorySummary;
      lines.push(`  <memory_summary>\n${clampedMemory}\n  </memory_summary>`);
    }

    if (input.apiContractsSummary) {
      lines.push(`  <api_contracts>\n${input.apiContractsSummary.slice(0, 1500)}\n  </api_contracts>`);
    }

    if (input.completedTasks && input.completedTasks.length > 0) {
      const recentCompleted = input.completedTasks.slice(-15);
      lines.push(`  <completed_tasks>\n    - ${recentCompleted.join('\n    - ')}\n  </completed_tasks>`);
    }

    if (input.recentDecisions && input.recentDecisions.length > 0) {
      const recentDecs = input.recentDecisions.slice(-10);
      lines.push(`  <recent_decisions>\n    - ${recentDecs.join('\n    - ')}\n  </recent_decisions>`);
    }

    lines.push('</DECOHUB_PROJECT_CONTEXT>');
    return lines.join('\n');
  }

  /**
   * Builds canonical Antigravity 2.0 YAML frontmatter for .agents/rules/decohub-worker.md.
   * Escapes colons inside double quotes to prevent v2.25.0 YAML parser rejection.
   */
  private static buildAntigravityRuleFrontmatter(promptId: string, promptHash: string): string {
    return [
      '---',
      'trigger: always_on',
      `description: "DecoHUB Autonomous Worker Invariants (${promptId} - SHA256 ${promptHash.slice(0, 12)})"`,
      '---'
    ].join('\n');
  }

  /**
   * Enforces the strict < 24KB Antigravity 2.0 rule file size limit.
   */
  private static enforceRuleByteBudget(content: string): string {
    const byteLength = Buffer.byteLength(content, 'utf-8');
    if (byteLength <= this.MAX_RULE_FILE_BYTES) {
      return content;
    }

    Logger.warn(
      `[PromptManager] Rule content (${byteLength} bytes) exceeded budget (${this.MAX_RULE_FILE_BYTES} bytes). Clamping <memory_summary> to prevent Antigravity auto-demotion.`
    );

    const compacted = content.replace(
      /<memory_summary>[\s\S]*?<\/memory_summary>/,
      '<memory_summary>[Compacted to respect Antigravity 24KB rule limit. Use view_file on @.ai-dev-hub/specs/ pointers.]</memory_summary>'
    );

    if (Buffer.byteLength(compacted, 'utf-8') <= this.MAX_RULE_FILE_BYTES) {
      return compacted;
    }

    return Buffer.from(compacted, 'utf-8').subarray(0, this.MAX_RULE_FILE_BYTES).toString('utf-8');
  }

  /**
   * Bundles the full Worker system instruction set using the Gemini 3.8 U-shaped attention geometry:
   * 1. YAML Frontmatter (Antigravity 2.0 .agents/rules/ requirement)
   * 2. Layer A (Primacy): Base System Invariants + Role Overlay
   * 3. Layer C (Middle): Workspace & Project Context + Canonical @ Pointers
   * 4. Layer B (Recency): Transition Anchor + Execution Directive
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

    let livingSpecsXml = '';
    if (params.project.projectPath) {
      try {
        const specsDir = path.join(path.resolve(params.project.projectPath), '.ai-dev-hub', 'specs');
        if (fs.existsSync(specsDir)) {
          livingSpecsXml = [
            '<canonical_living_specs_contract title="ESPECIFICAÇÕES VIVAS OBRIGATÓRIAS">',
            '  === ESPECIFICAÇÕES VIVAS OBRIGATÓRIAS (.ai-dev-hub/specs/) ===',
            '  Antes de iniciar qualquer microtarefa, inspecione via view_file os documentos canônicos em `.ai-dev-hub/specs/` (Fonte Única de Verdade do projeto):',
            '  - @.ai-dev-hub/specs/PRINCIPIOS.md: Invariantes Karpathy, PORT_GUARD (faixa 4000-4999) e blindagem AppSec.',
            '  - @.ai-dev-hub/specs/CONTEUDO.md: Seções canônicas (01-Dashboard, etc.), abas role="tab", KPIs e dados realistas de seed.',
            '  - @.ai-dev-hub/specs/BACKEND.md: Tabelas SQLite exatas, contratos REST e regras de validação HTTP 400.',
            '  - @.ai-dev-hub/specs/DESIGN.md: Tokens CSS semânticos :root, tipografia tabular-nums e ícones SVG inline.',
            '  É proibido criar arquivos intermediários em `.ai-dev-hub/notes/` ou divergir dos esquemas e rotas especificados.',
            '</canonical_living_specs_contract>'
          ].join('\n');
        }
      } catch (err) {
        if (typeof (globalThis as any).logger !== 'undefined' && (globalThis as any).logger?.warn) {
          (globalThis as any).logger.warn({
            event: 'server.handled_exception',
            file: 'promptManager',
            error: (err as any)?.message || String(err)
          });
        } else {
          console.warn('[WARN][server:promptManager]', err);
        }
      }
    }

    const promptTitle =
      promptId === 'fable-worker-v2-flash-max'
        ? 'Fable 5.1 MAX Velocity Flash'
        : promptId === 'fable-worker-v1-max'
        ? 'Fable 5.1 MAX Fidelity Port'
        : promptId === 'fable-worker-v2-flash'
        ? 'Fable Flash V2 Optimized'
        : 'Fable 5.1 Fidelity Port';

    const recencyExecutionDirective = [
      '<execution_directive>',
      '  Com base exclusivamente nas invariantes de sistema (<system_invariants>) e no estado do workspace (<workspace_context>) fornecidos acima, execute a microtarefa atribuída:',
      `  - Perfil Operacional Ativo: ${promptTitle} (${promptId}).`,
      '  - Ciclo Obrigatório: Inspect (Minimum Sufficient Context via view_file) -> Modify (replace_file_content / write_to_file) -> Test & Verify (run_command: npx tsc --noEmit + testes com exit code 0) -> Simplify -> Report (<worker_delivery_report>).',
      '</execution_directive>'
    ].join('\n');

    const yamlFrontmatter = this.buildAntigravityRuleFrontmatter(promptId, base.hash);

    // Full rule content for directory-level file (.agents/rules/decohub-worker.md)
    const rawFullRuleContent = [
      yamlFrontmatter,
      '',
      base.content,
      '',
      workerRoleOverlayXml,
      '',
      '<workspace_context>',
      runtimeContextXml,
      projectContextXml,
      livingSpecsXml,
      '</workspace_context>',
      '',
      recencyExecutionDirective
    ]
      .filter(Boolean)
      .join('\n');

    const fullRuleContent = this.enforceRuleByteBudget(rawFullRuleContent);

    // Concise XML bootstrap instructions for CLI / session initialization
    // Uses pure XML tags (no square-bracket parser headers) to prevent Instruction Injection
    const bootstrapInstructions = [
      `<decohub_worker_bootstrap prompt_id="${promptId}" sha256="${base.hash.slice(0, 16)}">`,
      `  Você é o Worker/Builder autônomo do DecoHUB. As diretrizes completas de engenharia (${promptTitle}) estão ativas em .agents/rules/decohub-worker.md.`,
      '</decohub_worker_bootstrap>',
      '',
      workerRoleOverlayXml,
      '',
      '<workspace_context>',
      runtimeContextXml,
      projectContextXml,
      '</workspace_context>',
      '',
      recencyExecutionDirective
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
   * Helper: Writes content to a file only if it doesn't exist or content changed (idempotent).
   */
  private static writeIfChanged(filePath: string, content: string): void {
    if (fs.existsSync(filePath)) {
      const current = fs.readFileSync(filePath, 'utf-8');
      if (current === content) {
        return;
      }
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
  }

  /**
   * Helper: Removes a file if it exists.
   */
  private static removeIfExists(filePath: string): void {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (err: any) {
      Logger.warn(`[PromptManager] Falha ao remover arquivo ${filePath}: ${err.message}`);
    }
  }

  /**
   * Helper: Removes directory if it exists and is empty.
   */
  private static removeDirectoryIfEmpty(dirPath: string): void {
    try {
      if (fs.existsSync(dirPath)) {
        const entries = fs.readdirSync(dirPath);
        if (entries.length === 0) {
          fs.rmdirSync(dirPath);
        }
      }
    } catch {
      // Ignore directory removal errors
    }
  }

  /**
   * Generates modular rule content for Backend SaaS (< 4 KB, trigger: glob).
   */
  static getBackendSaasRuleContent(): string {
    return [
      '---',
      'trigger: glob',
      'globs: "server/**, src/db/**, src/routes/**, src/services/**, *.sql"',
      'description: "DecoHUB Backend SaaS & Persistence Invariants (SQLite WAL, AppSec, Dual-Mode)"',
      '---',
      '',
      '# Backend SaaS & Persistence Invariants',
      '',
      '<backend_invariants>',
      '1. SQLite WAL & Concurrency:',
      '   - Always initialize SQLite connections with WAL mode and foreign keys enabled:',
      '     PRAGMA journal_mode = WAL;',
      '     PRAGMA foreign_keys = ON;',
      '     PRAGMA busy_timeout = 5000;',
      '   - Wrap multi-statement mutations in explicit transactions (`db.transaction(...)` or `BEGIN IMMEDIATE / COMMIT`).',
      '',
      '2. Deterministic Seeding (`seedIfEmpty`):',
      '   - Every database table must have an idempotent `seedIfEmpty()` routine that seeds 15-30 realistic domain records if the table is empty upon server boot.',
      '',
      '3. Dual-Mode DOCSIMP Architecture:',
      '   - Supabase Auth: Support live Supabase auth headers with automatic fallback to local JWT/session auth in offline/mock environments.',
      '   - Cloudflare Turnstile: Validate tokens via siteverify endpoint, with development bypass mode when secret keys are absent.',
      '   - PushinPay PIX: Enforce strict idempotency via UUIDv4 `idempotency_key`, storing QR code copy-paste string and base64 SVG representation.',
      '   - Upstash Redis: Implement distributed rate-limiting with in-memory TokenBucket fallback when UPSTASH_REDIS_REST_URL is unset.',
      '',
      '4. PORT_GUARD & Route Hygiene:',
      '   - Bind HTTP ports exclusively within 4000-4999: `const PORT = Number(process.env.PORT) || 4000;`. Never bind to 3000, 3001, or 5173.',
      '   - Route separation: `GET /` exclusively serves the static frontend HTML (`public/index.html` or compiled SPA).',
      '   - API Health: Healthchecks are strictly isolated at `GET /api/health` returning JSON `{ status: \'ok\', uptime: process.uptime() }`.',
      '',
      '5. AppSec by Default:',
      '   - Parameterized queries: 100% of SQL queries must use `?` parameter placeholders. Zero string interpolation in SQL.',
      '   - Path traversal defense: Always validate and bound filesystem paths with `path.resolve` and strict prefix checks.',
      '</backend_invariants>'
    ].join('\n');
  }

  /**
   * Generates modular rule content for Frontend Anti-Slop (< 4 KB, trigger: glob).
   */
  static getFrontendAntislopRuleContent(): string {
    return [
      '---',
      'trigger: glob',
      'globs: "client/**, public/**, src/components/**, src/pages/**, *.tsx, *.css, *.html"',
      'description: "DecoHUB Frontend Anti-Slop & UI Quality Standards (Design Tokens, Zero Emojis, REA)"',
      '---',
      '',
      '# Frontend Anti-Slop & UI Quality Standards',
      '',
      '<frontend_antislop_invariants>',
      '1. Zero Emojis Mandate:',
      '   - Strictly prohibit unicode emojis in UI copy, buttons, badges, headers, or alerts.',
      '   - Use standardized inline SVGs (e.g. Lucide icons) with uniform sizing (`h-4 w-4` or `h-5 w-5`).',
      '',
      '2. Zero Native Dialogs:',
      '   - Never call `window.alert()`, `window.confirm()`, or `window.prompt()`.',
      '   - Implement accessible UI dialogs and toast notifications with focus trapping and Escape key dismissal.',
      '',
      '3. Semantic Design Tokens (`:root`):',
      '   - Define and consume CSS custom properties for all colors, borders, and shadows:',
      '     `--bg-app`, `--bg-surface`, `--border-subtle`, `--text-primary`, `--text-muted`, `--accent-primary`.',
      '   - Never hardcode arbitrary hex colors directly inside component style attributes.',
      '',
      '4. Tabular Numbers & Typography:',
      '   - Apply `font-variant-numeric: tabular-nums` (or Tailwind `tabular-nums`) to all financial values, timestamps, timers, IDs, and data table columns.',
      '',
      '5. Accessible Tab Navigation:',
      '   - Tab containers must implement semantic roles: `role="tablist"`, `role="tab"`, `data-tab="..."`, `aria-selected="true|false"`.',
      '   - Tab panels must implement `role="tabpanel"` with appropriate `aria-labelledby`.',
      '',
      '6. REA Archetype Consistency:',
      '   - Attio Archetype: Input fields and action buttons standardized at `h-9` (36px height) with subtle 1px border.',
      '   - n8n Archetype: Visual execution status badges (`Active`, `Draft`, `Running`, `Failed`) with subtle pulsing status dot.',
      '   - Tally Archetype: Distraction-free PIX payment flow featuring one-click copy-paste input and countdown timer.',
      '',
      '7. Dual Viewport Responsiveness & State Persistence:',
      '   - Pixel-perfect layout verified at Desktop (`1440x900`) and Mobile (`390x844`).',
      '   - Zero horizontal scrollbar or overflow (`overflow-x: hidden`).',
      '   - Active tabs, filters, and display modes must persist across page reloads (F5) via `localStorage`.',
      '</frontend_antislop_invariants>'
    ].join('\n');
  }

  /**
   * Generates .agents/hooks.json content.
   */
  static getHooksJsonContent(): string {
    return JSON.stringify(
      {
        'decohub-pre-invocation-reminder': {
          PreInvocation: [
            {
              type: 'command',
              command: 'node ./hooks/pre-invocation-reminder.cjs',
              timeout: 15
            }
          ]
        },
        'decohub-pre-tool-guard': {
          PreToolUse: [
            {
              matcher: '*',
              hooks: [
                {
                  type: 'command',
                  command: 'node ./hooks/pre-tool-ownership-guard.cjs',
                  timeout: 15
                }
              ]
            }
          ]
        },
        'decohub-stop-typecheck-gate': {
          Stop: [
            {
              type: 'command',
              command: 'node ./hooks/stop-typecheck-gate.cjs',
              timeout: 30
            }
          ]
        }
      },
      null,
      2
    );
  }

  /**
   * Generates .agents/hooks/pre-invocation-reminder.cjs script.
   */
  static getPreInvocationReminderScript(): string {
    return [
      '// .agents/hooks/pre-invocation-reminder.cjs',
      '// Emits ephemeral reminders to reinforce Fable engineering invariants.',
      '',
      'let input = "";',
      'process.stdin.setEncoding("utf-8");',
      'process.stdin.on("data", (chunk) => { input += chunk; });',
      'process.stdin.on("end", () => {',
      '  const payload = {',
      '    injectSteps: [',
      '      {',
      '        ephemeralMessage: "[DecoHUB Invariant Reminder] Fable autonomous execution active: zero emojis, parameterized SQLite queries, PORT 4000-4999, GET / exclusively serves HTML, verified via tsc --noEmit."',
      '      }',
      '    ]',
      '  };',
      '  process.stdout.write(JSON.stringify(payload));',
      '});'
    ].join('\n');
  }

  /**
   * Generates .agents/hooks/pre-tool-ownership-guard.cjs script.
   */
  static getPreToolOwnershipGuardScript(): string {
    return [
      '// .agents/hooks/pre-tool-ownership-guard.cjs',
      '// Guards protected environment files and explicitly allows all other tool executions.',
      '',
      'let input = "";',
      'process.stdin.setEncoding("utf-8");',
      'process.stdin.on("data", (chunk) => { input += chunk; });',
      'process.stdin.on("end", () => {',
      '  try {',
      '    const payload = input.trim() ? JSON.parse(input) : {};',
      '    const toolCall = payload.toolCall || {};',
      '    const argsString = JSON.stringify(toolCall.args || {}).toLowerCase();',
      '',
      '    if (argsString.includes(".env.production")) {',
      '      process.stdout.write(JSON.stringify({',
      '        decision: "deny",',
      '        reason: "DecoHUB Security Guard: Direct modifications to .env.production are strictly blocked."',
      '      }));',
      '      return;',
      '    }',
      '',
      '    process.stdout.write(JSON.stringify({ decision: "allow" }));',
      '  } catch (_err) {',
      '    process.stdout.write(JSON.stringify({ decision: "allow" }));',
      '  }',
      '});'
    ].join('\n');
  }

  /**
   * Generates .agents/hooks/stop-typecheck-gate.cjs script.
   */
  static getStopTypecheckGateScript(): string {
    return [
      '// .agents/hooks/stop-typecheck-gate.cjs',
      '// Gates agent termination on clean TypeScript compilation (up to 3 retries).',
      '',
      'const fs = require("node:fs");',
      'const path = require("node:path");',
      'const { execSync } = require("node:child_process");',
      '',
      'let input = "";',
      'process.stdin.setEncoding("utf-8");',
      'process.stdin.on("data", (chunk) => { input += chunk; });',
      'process.stdin.on("end", () => {',
      '  const projectRoot = path.resolve(__dirname, "..", "..");',
      '  const tsconfigPath = path.join(projectRoot, "tsconfig.json");',
      '  const retryFile = path.join(projectRoot, ".ai-dev-hub", ".stop_hook_retries");',
      '',
      '  if (!fs.existsSync(tsconfigPath)) {',
      '    process.stdout.write(JSON.stringify({ decision: "allow" }));',
      '    return;',
      '  }',
      '',
      '  let retries = 0;',
      '  if (fs.existsSync(retryFile)) {',
      '    try {',
      '      retries = parseInt(fs.readFileSync(retryFile, "utf-8").trim(), 10) || 0;',
      '    } catch (_e) {',
      '      retries = 0;',
      '    }',
      '  }',
      '',
      '  try {',
      '    execSync("npx tsc --noEmit", {',
      '      cwd: projectRoot,',
      '      encoding: "utf-8",',
      '      stdio: ["ignore", "pipe", "pipe"],',
      '      timeout: 25000,',
      '      shell: true',
      '    });',
      '',
      '    try {',
      '      if (fs.existsSync(retryFile)) {',
      '        fs.unlinkSync(retryFile);',
      '      }',
      '    } catch (_e) {}',
      '',
      '    process.stdout.write(JSON.stringify({ decision: "allow" }));',
      '  } catch (err) {',
      '    if (retries < 3) {',
      '      const nextRetries = retries + 1;',
      '      try {',
      '        fs.mkdirSync(path.dirname(retryFile), { recursive: true });',
      '        fs.writeFileSync(retryFile, String(nextRetries), "utf-8");',
      '      } catch (_e) {}',
      '',
      '      const outputSummary = (err.stdout || err.stderr || err.message || "").toString().slice(0, 1000);',
      '      process.stdout.write(JSON.stringify({',
      '        decision: "continue",',
      '        reason: `DecoHUB Typecheck Gate: TypeScript compilation failed (${nextRetries}/3). Fix compilation errors:\\n${outputSummary}`',
      '      }));',
      '    } else {',
      '      try {',
      '        if (fs.existsSync(retryFile)) {',
      '          fs.unlinkSync(retryFile);',
      '        }',
      '      } catch (_e) {}',
      '      process.stdout.write(JSON.stringify({ decision: "allow" }));',
      '    }',
      '  }',
      '});'
    ].join('\n');
  }

  /**
   * Writes the project-level rule files (.agents/rules/decohub-worker.md, backend-saas.md, frontend-antislop.md)
   * and hooks (.agents/hooks.json, .agents/hooks/*.cjs) idempotently
   * or cleans them up if instructions is null/empty (guaranteeing no Fable leaks to Legacy/Native).
   */
  static ensureProjectRulesFile(projectPath: string, instructions?: string | null): string | null {
    if (!fs.existsSync(projectPath)) return null;
    try {
      const agentsDir = path.join(projectPath, '.agents');
      const rulesDir = path.join(agentsDir, 'rules');
      const hooksDir = path.join(agentsDir, 'hooks');
      const workerRuleFilePath = path.join(rulesDir, 'decohub-worker.md');
      const backendRuleFilePath = path.join(rulesDir, 'backend-saas.md');
      const frontendRuleFilePath = path.join(rulesDir, 'frontend-antislop.md');
      const hooksJsonFilePath = path.join(agentsDir, 'hooks.json');
      const preInvocationScriptPath = path.join(hooksDir, 'pre-invocation-reminder.cjs');
      const preToolGuardScriptPath = path.join(hooksDir, 'pre-tool-ownership-guard.cjs');
      const stopGateScriptPath = path.join(hooksDir, 'stop-typecheck-gate.cjs');

      if (!instructions || instructions.trim().length === 0) {
        this.removeIfExists(workerRuleFilePath);
        this.removeIfExists(backendRuleFilePath);
        this.removeIfExists(frontendRuleFilePath);
        this.removeIfExists(hooksJsonFilePath);
        this.removeIfExists(preInvocationScriptPath);
        this.removeIfExists(preToolGuardScriptPath);
        this.removeIfExists(stopGateScriptPath);

        this.removeDirectoryIfEmpty(hooksDir);
        this.removeDirectoryIfEmpty(rulesDir);
        this.removeDirectoryIfEmpty(agentsDir);

        Logger.info(`[PromptManager] Regras de workspace e hooks removidos para variante nativa/legacy em ${projectPath}`);
        return null;
      }

      fs.mkdirSync(rulesDir, { recursive: true });
      fs.mkdirSync(hooksDir, { recursive: true });

      const safeInstructions = this.enforceRuleByteBudget(instructions);
      this.writeIfChanged(workerRuleFilePath, safeInstructions);
      this.writeIfChanged(backendRuleFilePath, this.getBackendSaasRuleContent());
      this.writeIfChanged(frontendRuleFilePath, this.getFrontendAntislopRuleContent());
      this.writeIfChanged(hooksJsonFilePath, this.getHooksJsonContent());
      this.writeIfChanged(preInvocationScriptPath, this.getPreInvocationReminderScript());
      this.writeIfChanged(preToolGuardScriptPath, this.getPreToolOwnershipGuardScript());
      this.writeIfChanged(stopGateScriptPath, this.getStopTypecheckGateScript());

      return workerRuleFilePath;
    } catch (err: any) {
      Logger.warn(`[PromptManager] Falha ao gerenciar rule files e hooks em ${projectPath}: ${err.message}`);
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
    variant:
      | 'native'
      | 'legacy'
      | 'fable-worker-v1'
      | 'fable-worker-v2-flash'
      | 'fable-worker-v1-max'
      | 'fable-worker-v2-flash-max'
      | string
  ): { valid: boolean; reason?: string } {
    const normVariant = this.normalizePromptId(variant);
    const ruleFilePath = path.join(projectPath, '.agents', 'rules', 'decohub-worker.md');
    const backendRulePath = path.join(projectPath, '.agents', 'rules', 'backend-saas.md');
    const frontendRulePath = path.join(projectPath, '.agents', 'rules', 'frontend-antislop.md');
    const hooksJsonPath = path.join(projectPath, '.agents', 'hooks.json');
    const exists = fs.existsSync(ruleFilePath);

    if (normVariant === 'native' || normVariant === 'legacy' || normVariant === 'legacy-worker-v1') {
      if (exists) {
        const content = fs.readFileSync(ruleFilePath, 'utf-8');
        if (
          content.includes('fable-worker-v1') ||
          content.includes('fable-worker-v2-flash') ||
          content.includes('FABLE') ||
          content.includes('Fable')
        ) {
          return {
            valid: false,
            reason: `LEAK_DETECTED: Legacy/Native workspace contains Fable Worker rule file at ${ruleFilePath}`
          };
        }
      }
      if (fs.existsSync(backendRulePath) || fs.existsSync(frontendRulePath) || fs.existsSync(hooksJsonPath)) {
        return {
          valid: false,
          reason: `LEAK_DETECTED: Legacy/Native workspace contains Fable modular rules or hooks in .agents`
        };
      }
      return { valid: true };
    } else if (normVariant === 'fable-worker-v2-flash-max') {
      if (!exists) {
        return { valid: false, reason: `MISSING_RULE_FILE: Fable V2 Max workspace is missing ${ruleFilePath}` };
      }
      const content = fs.readFileSync(ruleFilePath, 'utf-8');
      if (
        !content.includes('fable-worker-v2-flash') &&
        !content.includes('Fable 5.1') &&
        !content.includes('Action Bias') &&
        !content.includes('Minimum Sufficient Context')
      ) {
        return {
          valid: false,
          reason: `INVALID_RULE_CONTENT: Rule file at ${ruleFilePath} does not contain Fable Worker V2 Flash Max instructions`
        };
      }
      return { valid: true };
    } else if (normVariant === 'fable-worker-v1-max') {
      if (!exists) {
        return { valid: false, reason: `MISSING_RULE_FILE: Fable V1 Max workspace is missing ${ruleFilePath}` };
      }
      const content = fs.readFileSync(ruleFilePath, 'utf-8');
      if (
        !content.includes('fable-worker-v1') &&
        !content.includes('Fable 5.1') &&
        !content.includes('Fidelity') &&
        !content.includes('reasoning_effort')
      ) {
        return {
          valid: false,
          reason: `INVALID_RULE_CONTENT: Rule file at ${ruleFilePath} does not contain Fable Worker V1 Max instructions`
        };
      }
      return { valid: true };
    } else if (normVariant === 'fable-worker-v2-flash') {
      if (!exists) {
        return { valid: false, reason: `MISSING_RULE_FILE: Fable V2 workspace is missing ${ruleFilePath}` };
      }
      const content = fs.readFileSync(ruleFilePath, 'utf-8');
      if (
        !content.includes('Minimum Sufficient Context') &&
        !content.includes('Action Bias') &&
        !content.includes('fable-worker-v2-flash')
      ) {
        return {
          valid: false,
          reason: `INVALID_RULE_CONTENT: Rule file at ${ruleFilePath} does not contain Fable Worker V2 Flash instructions`
        };
      }
      return { valid: true };
    } else {
      if (!exists) {
        return { valid: false, reason: `MISSING_RULE_FILE: Fable workspace is missing ${ruleFilePath}` };
      }
      const content = fs.readFileSync(ruleFilePath, 'utf-8');
      if (
        !content.includes('fable-worker-v1') &&
        !content.includes('Fable 5.1 Fidelity Port') &&
        !content.includes('## Instruction hierarchy')
      ) {
        return {
          valid: false,
          reason: `INVALID_RULE_CONTENT: Rule file at ${ruleFilePath} does not contain Fable Worker V1 instructions`
        };
      }
      return { valid: true };
    }
  }
}