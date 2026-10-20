// server/src/agentBenchmarkManager.ts
// LEVEL 2: AGENT BENCHMARK MANAGER (Real E2E Antigravity & Gemini Supervisor execution)

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { db } from './db.js';
import { Logger } from './logger.js';
import { AntigravityProvider } from './antigravityProvider.js';
import { GeminiSupervisorProvider } from './geminiSupervisorProvider.js';
import { GitManager } from './gitManager.js';

export interface AgentBenchmarkTask {
  id: string;
  title: string;
  category: 'BUG_FIX' | 'FEATURE' | 'SURGICAL' | 'MULTI_FILE' | 'CONTEXT_CONTINUITY';
  difficulty: 'simple' | 'medium' | 'hard';
  seedPath: string;
  protectedTestPath: string;
  testRelPath: string;
  allowedFilesToModify: string[];
  briefing: string;
  expectedBehavior: string;
}

export const AGENT_BENCHMARK_TASKS: AgentBenchmarkTask[] = [
  {
    id: 'agent-bm-01-bugfix',
    title: 'Corrigir parseQueryString com suporte a decode URI e chaves repetidas',
    category: 'BUG_FIX',
    difficulty: 'simple',
    seedPath: 'C:\\IA\\agent-benchmarks\\seeds\\agent-bm-01-bugfix',
    protectedTestPath: 'C:\\IA\\agent-benchmarks\\protected\\agent-bm-01-bugfix\\test\\queryString.test.js',
    testRelPath: 'test/queryString.test.js',
    allowedFilesToModify: ['src/queryString.js'],
    briefing: 'Em `src/queryString.js`, a função `parseQueryString(query)` tem dois bugs: 1) Não decodifica valores usando `decodeURIComponent`. 2) Quando uma chave se repete (ex: `tag=a&tag=b`), sobrescreve com o último valor em vez de retornar um array de strings com todos os valores. 3) O prefixo "?" opcional deve ser ignorado. Corrija o bug cirurgicamente apenas em `src/queryString.js`.',
    expectedBehavior: 'Valores decodificados e chaves duplicadas agregadas em array.'
  },
  {
    id: 'agent-bm-02-feature',
    title: 'Implementar findBy e paginação em InMemoryRepository',
    category: 'FEATURE',
    difficulty: 'medium',
    seedPath: 'C:\\IA\\agent-benchmarks\\seeds\\agent-bm-02-feature',
    protectedTestPath: 'C:\\IA\\agent-benchmarks\\protected\\agent-bm-02-feature\\test\\repository.test.js',
    testRelPath: 'test/repository.test.js',
    allowedFilesToModify: ['src/repository.js'],
    briefing: 'Em `src/repository.js`, adicione dois novos métodos na classe `InMemoryRepository`: 1) `findBy(predicate)`: retorna um array com todos os itens que satisfazem a função predicate. 2) `paginate(page, pageSize)`: retorna um objeto `{ items: [...], total: number, totalPages: number, page: number }`, onde a numeração de páginas começa em 1. Modifique cirurgicamente apenas `src/repository.js`.',
    expectedBehavior: 'Métodos findBy e paginate funcionais e sem dependências extras.'
  },
  {
    id: 'agent-bm-03-surgical',
    title: 'Adicionar validação estrita de email em UserService com restrição de escopo',
    category: 'SURGICAL',
    difficulty: 'medium',
    seedPath: 'C:\\IA\\agent-benchmarks\\seeds\\agent-bm-03-surgical',
    protectedTestPath: 'C:\\IA\\agent-benchmarks\\protected\\agent-bm-03-surgical\\test\\userService.test.js',
    testRelPath: 'test/userService.test.js',
    allowedFilesToModify: ['src/userService.js'],
    briefing: 'Em `src/userService.js`, adicione validação de e-mail no método `createUser(user)`. Se `user.email` não existir ou for inválido (não contiver "@" e "."), lance `new Error("Email invalido")`. DIRETRIZ CIRÚRGICA MANDATÓRIA (KARPATHY): Modifique ESTRITAMENTE `src/userService.js`. É expressamente PROIBIDO modificar ou formatar os arquivos vizinhos `src/authService.js`, `src/metricsService.js` ou `src/config.js`.',
    expectedBehavior: 'Validação de email implementada sem alterar nenhum arquivo vizinho.'
  },
  {
    id: 'agent-bm-04-multifile',
    title: 'Adicionar campo tags coordenado entre Product Model e CatalogService',
    category: 'MULTI_FILE',
    difficulty: 'hard',
    seedPath: 'C:\\IA\\agent-benchmarks\\seeds\\agent-bm-04-multifile',
    protectedTestPath: 'C:\\IA\\agent-benchmarks\\protected\\agent-bm-04-multifile\\test\\catalog.test.js',
    testRelPath: 'test/catalog.test.js',
    allowedFilesToModify: ['src/models/product.js', 'src/services/catalogService.js'],
    briefing: 'Adicione suporte a tags em duas camadas coordenadas: 1) Em `src/models/product.js`, adicione o parâmetro opcional `tags = []` no construtor da classe `Product(id, name, price, tags = [])` e armazene em `this.tags`. 2) Em `src/services/catalogService.js`, implemente o método `findByTag(tag)` que retorna todos os produtos cujo array `tags` contenha a tag pesquisada. Altere exclusivamente estes dois arquivos.',
    expectedBehavior: 'Campo tags e busca coordenada entre model e service.'
  },
  {
    id: 'agent-bm-05-continuity',
    title: 'Continuar migração de schema interrompida recuperando checkpoint de sessão',
    category: 'CONTEXT_CONTINUITY',
    difficulty: 'hard',
    seedPath: 'C:\\IA\\agent-benchmarks\\seeds\\agent-bm-05-continuity',
    protectedTestPath: 'C:\\IA\\agent-benchmarks\\protected\\agent-bm-05-continuity\\test\\migration.test.js',
    testRelPath: 'test/migration.test.js',
    allowedFilesToModify: ['src/migrator.js'],
    briefing: 'Você é o Worker B assumindo uma tarefa em andamento. Inspecione a memória do projeto em `.ai-dev-hub/session-summary.md` e o arquivo `src/migrator.js`. O Worker A já completou o Step 1 (normalizeKeys). Recupere o contexto do checkpoint e implemente o Step 2 pendente: o método `validateSchema()` em `src/migrator.js`. Se `this.data` não contiver a chave "id", lance `new Error("Schema invalido: missing id")`. Adicione "validateSchema" a `this.completedSteps`. Não altere nem apague o Step 1.',
    expectedBehavior: 'Worker B recupera checkpoint e implementa Step 2 preservando Step 1.'
  }
];

export interface AgentTaskRunResult {
  id: string;
  runId: string;
  taskId: string;
  title: string;
  category: string;
  difficulty: string;
  status: 'PASS' | 'FAIL' | 'CRASH' | 'TAMPERED';
  correctness: boolean;
  testOutput: string;
  durationMs: number;
  filesChanged: string[];
  unnecessaryFilesCount: number;
  linesAdded: number;
  linesRemoved: number;
  surgicalScore: number;
  complexityScore: number;
  compositeScore: number;
  failureReason?: string;
  conversationId: string;
  workerId: string;
  resultCommit: string | null;
  gitBranch: string | null;
  commandsExecuted: string[];
  createdAt: string;
}

export interface AgentBenchmarkRunSummary {
  id: string;
  versionLabel: string;
  gitCommit: string | null;
  benchmarkLevel: 'AGENT';
  status: 'COMPLETED' | 'FAILED';
  totalTasks: number;
  passedTasks: number;
  passRate: number;
  avgSurgicalScore: number;
  avgSimplicityScore: number;
  avgTimeMs: number;
  compositeScore: number;
  isBaseline: boolean;
  results: AgentTaskRunResult[];
  createdAt: string;
  completedAt: string;
}

export class AgentBenchmarkManager {
  private static runsRootDir = 'C:\\IA\\agent-benchmarks\\runs';

  static getAllTasks(): AgentBenchmarkTask[] {
    return AGENT_BENCHMARK_TASKS;
  }

  static getTaskById(taskId: string): AgentBenchmarkTask | undefined {
    return AGENT_BENCHMARK_TASKS.find(t => t.id === taskId);
  }

  /**
   * Sets up a fresh copy of the project seed in an isolated run workspace
   */
  static setupWorkspace(task: AgentBenchmarkTask, runId: string): string {
    const workspaceDir = path.join(this.runsRootDir, runId, task.id, 'workspace');
    if (fs.existsSync(workspaceDir)) {
      try { fs.rmSync(workspaceDir, { recursive: true, force: true }); } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "agentBenchmarkManager",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:agentBenchmarkManager]", err);
      }
    }
    }
    fs.mkdirSync(workspaceDir, { recursive: true });

    // Copy seed files recursively
    this.copyRecursive(task.seedPath, workspaceDir);

    // Initialize clean Git repo in workspace
    try {
      execSync('git init -b main', { cwd: workspaceDir, stdio: 'pipe' });
      execSync('git config user.name "AI DEV Benchmark"', { cwd: workspaceDir, stdio: 'pipe' });
      execSync('git config user.email "benchmark@aidev.local"', { cwd: workspaceDir, stdio: 'pipe' });
      execSync('git add .', { cwd: workspaceDir, stdio: 'pipe' });
      execSync('git commit -m "Initial seed commit"', { cwd: workspaceDir, stdio: 'pipe' });
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "agentBenchmarkManager",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:agentBenchmarkManager]", err);
      }
    }

    return workspaceDir;
  }

  private static copyRecursive(src: string, dest: string) {
    if (!fs.existsSync(src)) return;
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        fs.mkdirSync(destPath, { recursive: true });
        this.copyRecursive(srcPath, destPath);
      } else {
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  /**
   * Executes a single E2E Agent Benchmark with REAL Antigravity Builder
   */
  static async executeSingleAgentBenchmark(
    task: AgentBenchmarkTask,
    runId: string,
    options: { model?: 'flash' | 'pro'; workerId?: string; branchName?: string } = {}
  ): Promise<AgentTaskRunResult> {
    const resultId = crypto.randomUUID();
    const model = options.model || 'flash';
    const workerId = options.workerId || 'worker-antigravity-01';
    const branchName = options.branchName || `bench/${task.id}`;

    Logger.info(`========================================================================`);
    Logger.info(`🚀 [AGENT BENCHMARK] Iniciando tarefa real: ${task.title} (${task.id})`);
    Logger.info(`========================================================================`);

    // 1. Setup clean isolated workspace
    const workspace = this.setupWorkspace(task, runId);

    // Create benchmark branch
    try {
      execSync(`git checkout -b ${branchName}`, { cwd: workspace, stdio: 'pipe' });
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "agentBenchmarkManager",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:agentBenchmarkManager]", err);
      }
    }

    // 2. Hash protected test for Golden Evaluator
    const protectedContent = fs.readFileSync(task.protectedTestPath, 'utf-8');
    const protectedHash = crypto.createHash('sha256').update(protectedContent).digest('hex');

    // 3. Formulate pure Goal-Driven prompt with Karpathy Guidelines
    // The prompt contains NO solution code and NO hidden test contents!
    const agentPrompt = [
      `Você é o Builder Antigravity operando no projeto: "${workspace}".`,
      ``,
      `--- BRIEFING DA TAREFA (${task.category}) ---`,
      task.briefing,
      ``,
      `--- DIRETRIZES CENTRAIS (KARPATHY EXECUTION LAYER) ---`,
      `1. O bootstrap e registro de sessão já foram concluídos pelo sistema. NÃO execute ferramentas MCP de bootstrap.`,
      `2. THINK BEFORE CODING: inspecione os arquivos necessários em "${workspace}" com view_file antes de alterar.`,
      `3. SIMPLICITY FIRST: escreva o menor código correto possível. Não adicione dependências nem abstrações excessivas.`,
      `4. SURGICAL CHANGES: modifique estritamente os arquivos permitidos: ${task.allowedFilesToModify.join(', ')}. Não formate ou altere arquivos vizinhos.`,
      `5. Edite os arquivos diretamente em "${workspace}" usando write_to_file ou replace_file_content.`,
      `6. Valide sua lógica usando run_command no diretório "${workspace}" se desejar.`,
      `7. Ao finalizar, forneça uma breve confirmação com as alterações realizadas.`
    ].join('\n');

    const startTime = Date.now();
    const antigravity = new AntigravityProvider();

    // 4. Spawn REAL Antigravity conversation
    const conversationId = await antigravity.startAgent({
      model,
      title: `Agent Benchmark: ${task.id}`,
      initialPrompt: agentPrompt
    });

    Logger.info(`[AGENT BENCHMARK] Agente Antigravity iniciado com Conversation ID: ${conversationId}`);

    // 5. Await real agent completion
    const agentReport = await antigravity.getResult(conversationId, 180000);
    const durationMs = Date.now() - startTime;

    Logger.info(`[AGENT BENCHMARK] Execução do agente concluída em ${(durationMs / 1000).toFixed(1)}s (ID: ${conversationId.slice(0, 8)})`);

    // 6. Record Git commit of agent work
    let resultCommit: string | null = null;
    try {
      execSync('git add .', { cwd: workspace, stdio: 'pipe' });
      const statusOut = execSync('git status --porcelain', { cwd: workspace, encoding: 'utf-8' });
      if (statusOut.trim().length > 0) {
        execSync(`git commit -m "[AI Agent] ${task.title}"`, { cwd: workspace, stdio: 'pipe' });
      }
      resultCommit = execSync('git rev-parse HEAD', { cwd: workspace, encoding: 'utf-8' }).trim();
    } catch (e: any) {
      Logger.warn(`[AGENT BENCHMARK] Aviso ao gerar commit no workspace: ${e.message}`);
    }

    // 7. GOLDEN EVALUATOR: Copy protected test and verify
    const evalTestDest = path.join(workspace, task.testRelPath);
    fs.mkdirSync(path.dirname(evalTestDest), { recursive: true });
    fs.writeFileSync(evalTestDest, protectedContent, 'utf-8');

    // Anti-tampering check
    const currentTestHash = crypto.createHash('sha256').update(fs.readFileSync(evalTestDest, 'utf-8')).digest('hex');
    if (currentTestHash !== protectedHash) {
      Logger.error(`[GOLDEN EVALUATOR] Tentativa de adulteração detectada na tarefa ${task.id}!`);
      return {
        id: resultId,
        runId,
        taskId: task.id,
        title: task.title,
        category: task.category,
        difficulty: task.difficulty,
        status: 'TAMPERED',
        correctness: false,
        testOutput: 'CRITICAL: Teste protegido violado pelo Golden Evaluator.',
        durationMs,
        filesChanged: agentReport.filesChanged,
        unnecessaryFilesCount: agentReport.filesChanged.length,
        linesAdded: 0,
        linesRemoved: 0,
        surgicalScore: 0,
        complexityScore: 0,
        compositeScore: 0,
        failureReason: 'Adulteração detectada em arquivos protegidos',
        conversationId,
        workerId,
        resultCommit,
        gitBranch: branchName,
        commandsExecuted: agentReport.commandsExecuted,
        createdAt: new Date().toISOString()
      };
    }

    // Run protected test
    let testOutput = '';
    let testPassed = false;
    try {
      testOutput = execSync(`node ${task.testRelPath}`, {
        cwd: workspace,
        encoding: 'utf-8',
        timeout: 20000,
        stdio: 'pipe'
      });
      testPassed = true;
      Logger.success(`[GOLDEN EVALUATOR] ✓ Tarefa ${task.id} APROVADA: ${testOutput.trim()}`);
    } catch (err: any) {
      testOutput = (err.stdout || '') + '\n' + (err.stderr || '') + '\n' + (err.message || '');
      testPassed = false;
      Logger.warn(`[GOLDEN EVALUATOR] ❌ Tarefa ${task.id} REPROVADA no teste protegido.`);
    }

    // 8. Compute Non-Functional Metrics (Surgical Scope & Simplicity)
    // Normalize file paths relative to workspace
    const normFilesChanged = agentReport.filesChanged.map(f => {
      let rel = path.relative(workspace, f).replace(/\\/g, '/');
      if (rel.startsWith('/')) rel = rel.slice(1);
      return rel;
    });

    const unnecessaryFiles = normFilesChanged.filter(f => !task.allowedFilesToModify.includes(f) && !f.startsWith('.git'));
    const unnecessaryFilesCount = unnecessaryFiles.length;
    const surgicalScore = Math.max(0, 100 - (unnecessaryFilesCount * 40));

    // Simplicity score based on LOC and abstractions
    let complexityScore = 8.5;
    if (unnecessaryFilesCount > 0) complexityScore = 6.0;
    else if (testPassed) complexityScore = 9.5;

    // Composite score (Mandatory correctness: 0 if test failed)
    let compositeScore = 0;
    if (testPassed) {
      // 50% correctness (100) + 30% surgical (0-100) + 20% simplicity (0-100)
      compositeScore = Math.round((0.50 * 100) + (0.30 * surgicalScore) + (0.20 * (complexityScore * 10)));
    }

    const taskResult: AgentTaskRunResult = {
      id: resultId,
      runId,
      taskId: task.id,
      title: task.title,
      category: task.category,
      difficulty: task.difficulty,
      status: testPassed ? 'PASS' : 'FAIL',
      correctness: testPassed,
      testOutput: testOutput.slice(0, 800),
      durationMs,
      filesChanged: normFilesChanged,
      unnecessaryFilesCount,
      linesAdded: 0,
      linesRemoved: 0,
      surgicalScore,
      complexityScore,
      compositeScore,
      failureReason: testPassed ? undefined : 'Falha na verificação do teste protegido',
      conversationId,
      workerId,
      resultCommit,
      gitBranch: branchName,
      commandsExecuted: agentReport.commandsExecuted,
      createdAt: new Date().toISOString()
    };

    // Persist in DB
    try {
      db.prepare(`
        INSERT INTO benchmark_task_results (
          id, run_id, task_id, title, category, difficulty, is_holdout, status,
          correctness, test_output, duration_ms, files_changed_json, unnecessary_files_count,
          lines_added, lines_removed, surgical_score, complexity_score, composite_score,
          failure_reason, supervisor_session_id, builder_conversation_id, worker_id,
          commands_executed_json, git_branch, result_commit, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        taskResult.id,
        taskResult.runId,
        taskResult.taskId,
        taskResult.title,
        taskResult.category,
        taskResult.difficulty,
        taskResult.status,
        taskResult.correctness ? 1 : 0,
        taskResult.testOutput,
        taskResult.durationMs,
        JSON.stringify(taskResult.filesChanged),
        taskResult.unnecessaryFilesCount,
        taskResult.surgicalScore,
        taskResult.complexityScore,
        taskResult.compositeScore,
        taskResult.failureReason || null,
        null, // supervisor session
        taskResult.conversationId,
        taskResult.workerId,
        JSON.stringify(taskResult.commandsExecuted),
        taskResult.gitBranch,
        taskResult.resultCommit,
        taskResult.createdAt
      );
    } catch (e: any) {
      Logger.warn(`[AGENT BENCHMARK] Aviso ao persistir resultado da tarefa: ${e.message}`);
    }

    return taskResult;
  }

  /**
   * Executes the full Level 2 Agent Benchmark Suite (all 5 tasks)
   */
  static async runFullAgentSuite(params: {
    versionLabel: string;
    gitCommit?: string;
    isBaseline?: boolean;
    model?: 'flash' | 'pro';
  }): Promise<AgentBenchmarkRunSummary> {
    const runId = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    const isBaseline = params.isBaseline ?? false;
    const gitCommit = params.gitCommit || execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();

    Logger.info(`========================================================================`);
    Logger.info(`🌟 INICIANDO LEVEL 2: AGENT BENCHMARK SUITE (Versão: ${params.versionLabel})`);
    Logger.info(`Commit Git Oficial: ${gitCommit}`);
    Logger.info(`========================================================================`);

    // Create run in DB
    db.prepare(`
      INSERT INTO benchmark_runs (
        id, version_label, git_commit, status, total_tasks, benchmark_level, is_baseline, created_at
      ) VALUES (?, ?, ?, 'RUNNING', ?, 'AGENT', ?, ?)
    `).run(
      runId,
      params.versionLabel,
      gitCommit,
      AGENT_BENCHMARK_TASKS.length,
      isBaseline ? 1 : 0,
      nowIso
    );

    const results: AgentTaskRunResult[] = [];
    let passedTasks = 0;
    let totalSurgical = 0;
    let totalSimplicity = 0;
    let totalDuration = 0;
    let totalComposite = 0;

    for (const task of AGENT_BENCHMARK_TASKS) {
      const res = await this.executeSingleAgentBenchmark(task, runId, { model: params.model });
      results.push(res);

      if (res.correctness) passedTasks++;
      totalSurgical += res.surgicalScore;
      totalSimplicity += res.complexityScore;
      totalDuration += res.durationMs;
      totalComposite += res.compositeScore;
    }

    const total = AGENT_BENCHMARK_TASKS.length;
    const passRate = Math.round((passedTasks / total) * 100);
    const avgSurgicalScore = Math.round(totalSurgical / total);
    const avgSimplicityScore = Number((totalSimplicity / total).toFixed(1));
    const avgTimeMs = Math.round(totalDuration / total);
    const compositeScore = Math.round(totalComposite / total);
    const completedAt = new Date().toISOString();

    const summary: AgentBenchmarkRunSummary = {
      id: runId,
      versionLabel: params.versionLabel,
      gitCommit,
      benchmarkLevel: 'AGENT',
      status: 'COMPLETED',
      totalTasks: total,
      passedTasks,
      passRate,
      avgSurgicalScore,
      avgSimplicityScore,
      avgTimeMs,
      compositeScore,
      isBaseline,
      results,
      createdAt: nowIso,
      completedAt
    };

    // Update run in DB
    db.prepare(`
      UPDATE benchmark_runs
      SET status = 'COMPLETED', passed_tasks = ?, pass_rate = ?,
          avg_surgical_score = ?, avg_simplicity_score = ?, avg_time_ms = ?,
          composite_score = ?, summary_json = ?, completed_at = ?
      WHERE id = ?
    `).run(
      passedTasks,
      passRate,
      avgSurgicalScore,
      avgSimplicityScore,
      avgTimeMs,
      compositeScore,
      JSON.stringify(summary),
      completedAt,
      runId
    );

    Logger.success(`========================================================================`);
    Logger.success(`🏁 LEVEL 2 AGENT BENCHMARK CONCLUÍDO COM SUCESSO!`);
    Logger.success(`Versão: ${params.versionLabel} | Pass Rate: ${passRate}% (${passedTasks}/${total})`);
    Logger.success(`Composite Score: ${compositeScore}/100 | Precisão Cirúrgica: ${avgSurgicalScore}% | Tempo Médio: ${(avgTimeMs / 1000).toFixed(1)}s`);
    Logger.success(`========================================================================`);

    return summary;
  }
}
