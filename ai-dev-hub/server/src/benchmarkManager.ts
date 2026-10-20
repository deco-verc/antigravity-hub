// server/src/benchmarkManager.ts
// Golden Evaluator, Sandbox Execution, Regression Gate & Version Comparison for AI DEV (Fase 6)

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { db } from './db.js';
import { Logger } from './logger.js';
import { BENCHMARK_TASKS, BenchmarkTask } from './benchmarkSuite.js';

export interface TaskRunResult {
  id: string;
  runId: string;
  taskId: string;
  title: string;
  category: string;
  difficulty: string;
  isHoldout: boolean;
  status: 'PASS' | 'FAIL' | 'TAMPERED';
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
  builderConversationId?: string;
  workerId?: string;
  resultCommit?: string | null;
  gitBranch?: string | null;
  createdAt: string;
}

export interface BenchmarkRunSummary {
  id: string;
  versionLabel: string;
  gitCommit: string | null;
  benchmarkLevel?: 'FAST' | 'AGENT';
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  totalTasks: number;
  passedTasks: number;
  passRate: number;
  avgSurgicalScore: number;
  avgSimplicityScore: number;
  avgTimeMs: number;
  regressionCount: number;
  compositeScore: number;
  isBaseline: boolean;
  summary: Record<string, any>;
  results?: TaskRunResult[];
  createdAt: string;
  completedAt?: string;
}

export interface VersionComparisonResult {
  versionA: { id: string; label: string; passRate: number; compositeScore: number; avgTimeMs: number; avgSurgical: number };
  versionB: { id: string; label: string; passRate: number; compositeScore: number; avgTimeMs: number; avgSurgical: number };
  deltaPassRate: number;
  deltaComposite: number;
  deltaSurgical: number;
  deltaTimeMs: number;
  regressedTasks: Array<{ taskId: string; title: string; failureReason?: string }>;
  improvedTasks: Array<{ taskId: string; title: string }>;
  regressionGatePassed: boolean;
  verdict: 'VERSION_B_WINS' | 'VERSION_A_WINS' | 'TIE' | 'REGRESSION_REJECTED';
  rationale: string;
}

export class BenchmarkManager {
  private static benchmarksRootDir = path.resolve(process.cwd(), '.ai-dev-benchmarks');

  /**
   * Returns all official benchmark tasks
   */
  static getAllTasks(): BenchmarkTask[] {
    return BENCHMARK_TASKS;
  }

  /**
   * Returns a specific benchmark task by ID
   */
  static getTaskById(taskId: string): BenchmarkTask | undefined {
    return BENCHMARK_TASKS.find(t => t.id === taskId);
  }

  /**
   * Executes a single benchmark task in an isolated workspace
   */
  static async executeSingleBenchmark(
    task: BenchmarkTask,
    candidateFiles: Record<string, string>,
    runId: string
  ): Promise<TaskRunResult> {
    const resultId = crypto.randomUUID();
    const sandboxDir = path.join(this.benchmarksRootDir, runId, task.id);

    // 1. Setup clean isolated sandbox directory
    if (fs.existsSync(sandboxDir)) {
      try { fs.rmSync(sandboxDir, { recursive: true, force: true }); } catch {}
    }
    fs.mkdirSync(sandboxDir, { recursive: true });

    // 2. Inject initial seed files
    for (const [relPath, content] of Object.entries(task.projectSeed.files)) {
      const fullPath = path.join(sandboxDir, relPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content, 'utf-8');
    }

    // 3. Inject protected tests & record original protected hashes for Golden Evaluator
    const protectedHashes: Record<string, string> = {};
    for (const [relPath, content] of Object.entries(task.protectedTests)) {
      const fullPath = path.join(sandboxDir, relPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content, 'utf-8');
      protectedHashes[relPath] = crypto.createHash('sha256').update(content).digest('hex');
    }

    // 4. Measure initial LOC before candidate implementation
    const initialFileLines: Record<string, number> = {};
    for (const [relPath, content] of Object.entries(task.projectSeed.files)) {
      initialFileLines[relPath] = content.split('\n').length;
    }

    // 5. Apply candidate's modifications
    const filesChanged: string[] = [];
    let linesAdded = 0;
    let linesRemoved = 0;
    let abstractionIndicators = 0;

    for (const [relPath, newContent] of Object.entries(candidateFiles)) {
      const fullPath = path.join(sandboxDir, relPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });

      const oldLines = initialFileLines[relPath] || 0;
      const newLines = newContent.split('\n').length;
      linesAdded += Math.max(0, newLines - oldLines);
      linesRemoved += Math.max(0, oldLines - newLines);

      fs.writeFileSync(fullPath, newContent, 'utf-8');
      filesChanged.push(relPath);

      // Detect unnecessary abstraction bloat (classes, proxies, factories)
      const classMatches = newContent.match(/class\s+/g) || [];
      const factoryMatches = newContent.match(/Factory/g) || [];
      const proxyMatches = newContent.match(/Proxy/g) || [];
      abstractionIndicators += classMatches.length + factoryMatches.length + proxyMatches.length;
    }

    // 6. GOLDEN EVALUATOR: Defense against test tampering
    let tampered = false;
    for (const [relPath, origHash] of Object.entries(protectedHashes)) {
      const fullPath = path.join(sandboxDir, relPath);
      if (!fs.existsSync(fullPath)) {
        tampered = true;
        break;
      }
      const currentContent = fs.readFileSync(fullPath, 'utf-8');
      const currentHash = crypto.createHash('sha256').update(currentContent).digest('hex');
      if (currentHash !== origHash) {
        tampered = true;
        break;
      }
    }

    if (tampered) {
      return {
        id: resultId,
        runId,
        taskId: task.id,
        title: task.title,
        category: task.category,
        difficulty: task.difficulty,
        isHoldout: task.isHoldout,
        status: 'TAMPERED',
        correctness: false,
        testOutput: 'CRITICAL: Tentativa de adulteração detectada em testes protegidos pelo Golden Evaluator. Desqualificado.',
        durationMs: 0,
        filesChanged,
        unnecessaryFilesCount: filesChanged.length,
        linesAdded,
        linesRemoved,
        surgicalScore: 0,
        complexityScore: 1,
        compositeScore: 0,
        failureReason: 'Adulteração detectada em arquivos protegidos',
        createdAt: new Date().toISOString()
      };
    }

    // 7. GOLDEN EVALUATOR: Run protected verification commands
    let testOutput = '';
    let exitCode = 0;
    const startTime = Date.now();

    for (const step of task.successContract.verificationSteps) {
      try {
        const out = execSync(step.command, {
          cwd: sandboxDir,
          encoding: 'utf-8',
          timeout: task.timeLimitMs,
          stdio: 'pipe'
        });
        testOutput += out;
      } catch (err: any) {
        exitCode = err.status || 1;
        testOutput += (err.stdout || '') + (err.stderr || '') + (err.message || '');
        break;
      }
    }
    const durationMs = Date.now() - startTime;

    // 8. Compute Non-Functional Metrics (Surgical Scope & Simplicity)
    const unnecessaryFiles = filesChanged.filter(f => !task.allowedFilesToModify.includes(f));
    const unnecessaryFilesCount = unnecessaryFiles.length;

    // Surgical Score: 100% if only allowed files were changed, minus 35 pts per extra unnecessary file
    const surgicalScore = Math.max(0, 100 - (unnecessaryFilesCount * 35));

    // Complexity Score (Karpathy Simplicity First): 1 to 10
    let complexityScore = 8.5;
    if (abstractionIndicators > 2 || linesAdded > 50) complexityScore = 3.5;
    else if (abstractionIndicators === 2 || linesAdded > 30) complexityScore = 5.5;
    else if (abstractionIndicators === 0 && linesAdded < 15) complexityScore = 9.8;
    else complexityScore = 8.5;

    // Correctness requirement: MUST pass protected tests
    const correctness = exitCode === 0;
    const status: 'PASS' | 'FAIL' = correctness ? 'PASS' : 'FAIL';

    // 9. Composite Score calculation
    // If correctness is false, score is STRICTLY 0 (Correctness is mandatory!)
    let compositeScore = 0;
    if (correctness) {
      // 50% correctness (100 pts)
      // 20% surgical discipline (0-100)
      // 15% simplicity (0-100)
      // 15% execution speed (scaled by duration)
      const speedScore = Math.max(20, Math.min(100, Math.round(100 - (durationMs / 300))));
      compositeScore = Math.round(
        (0.50 * 100) +
        (0.20 * surgicalScore) +
        (0.15 * (complexityScore * 10)) +
        (0.15 * speedScore)
      );
    }

    return {
      id: resultId,
      runId,
      taskId: task.id,
      title: task.title,
      category: task.category,
      difficulty: task.difficulty,
      isHoldout: task.isHoldout,
      status,
      correctness,
      testOutput: testOutput.slice(0, 800),
      durationMs,
      filesChanged,
      unnecessaryFilesCount,
      linesAdded,
      linesRemoved,
      surgicalScore,
      complexityScore,
      compositeScore,
      failureReason: correctness ? undefined : `Falha nos testes (Exit code ${exitCode})`,
      createdAt: new Date().toISOString()
    };
  }

  /**
   * Executes complete benchmark suite across all 12 tasks for a specific version
   */
  static async runBenchmarkSuite(params: {
    versionLabel: string;
    gitCommit?: string;
    candidateImplementations?: Record<string, Record<string, string>>; // taskId -> files
    isBaseline?: boolean;
  }): Promise<BenchmarkRunSummary> {
    const runId = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    const isBaseline = params.isBaseline ?? false;

    // Default implementations for Baseline V1 merged with candidate overrides
    const defaultImpls = this.getDefaultBaselineImplementations();
    const implementations = {
      ...defaultImpls,
      ...(params.candidateImplementations || {})
    };

    // 1. Create run in database
    db.prepare(`
      INSERT INTO benchmark_runs (
        id, version_label, git_commit, status, total_tasks, is_baseline, created_at
      ) VALUES (?, ?, ?, 'RUNNING', ?, ?, ?)
    `).run(
      runId,
      params.versionLabel,
      params.gitCommit || null,
      BENCHMARK_TASKS.length,
      isBaseline ? 1 : 0,
      nowIso
    );

    Logger.info(`[AI DEV BENCHMARK] Iniciando suíte para versão ${params.versionLabel} (Run: ${runId})`);

    const results: TaskRunResult[] = [];
    let passedTasks = 0;
    let totalSurgical = 0;
    let totalSimplicity = 0;
    let totalDuration = 0;
    let totalComposite = 0;

    // 2. Execute each benchmark task
    for (const task of BENCHMARK_TASKS) {
      const candidateFiles = implementations[task.id] || {};
      const res = await this.executeSingleBenchmark(task, candidateFiles, runId);

      // Persist task result
      db.prepare(`
        INSERT INTO benchmark_task_results (
          id, run_id, task_id, title, category, difficulty, is_holdout,
          status, correctness, test_output, duration_ms, files_changed_json,
          unnecessary_files_count, lines_added, lines_removed, surgical_score,
          complexity_score, composite_score, failure_reason, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        res.id,
        runId,
        res.taskId,
        res.title,
        res.category,
        res.difficulty,
        res.isHoldout ? 1 : 0,
        res.status,
        res.correctness ? 1 : 0,
        res.testOutput,
        res.durationMs,
        JSON.stringify(res.filesChanged),
        res.unnecessaryFilesCount,
        res.linesAdded,
        res.linesRemoved,
        res.surgicalScore,
        res.complexityScore,
        res.compositeScore,
        res.failureReason || null,
        res.createdAt
      );

      results.push(res);
      if (res.status === 'PASS') passedTasks++;
      totalSurgical += res.surgicalScore;
      totalSimplicity += res.complexityScore;
      totalDuration += res.durationMs;
      totalComposite += res.compositeScore;

      Logger.info(`  • [${task.category}] ${task.title}: ${res.status} (${res.compositeScore} pts)`);
    }

    const totalCount = BENCHMARK_TASKS.length;
    const passRate = Math.round((passedTasks / totalCount) * 100);
    const avgSurgical = Math.round(totalSurgical / totalCount);
    const avgSimplicity = Number((totalSimplicity / totalCount).toFixed(1));
    const avgTimeMs = Math.round(totalDuration / totalCount);
    const avgComposite = Number((totalComposite / totalCount).toFixed(1));

    const summaryObj = {
      totalTasks: totalCount,
      passedTasks,
      passRate,
      avgSurgicalScore: avgSurgical,
      avgSimplicityScore: avgSimplicity,
      avgTimeMs,
      compositeScore: avgComposite,
      holdoutPassed: results.filter(r => r.isHoldout && r.status === 'PASS').length,
      holdoutTotal: results.filter(r => r.isHoldout).length
    };

    // 3. Update benchmark run status
    const completedAt = new Date().toISOString();
    db.prepare(`
      UPDATE benchmark_runs
      SET status = 'COMPLETED', passed_tasks = ?, pass_rate = ?,
          avg_surgical_score = ?, avg_simplicity_score = ?, avg_time_ms = ?,
          composite_score = ?, summary_json = ?, completed_at = ?
      WHERE id = ?
    `).run(
      passedTasks,
      passRate,
      avgSurgical,
      avgSimplicity,
      avgTimeMs,
      avgComposite,
      JSON.stringify(summaryObj),
      completedAt,
      runId
    );

    Logger.info(`[AI DEV BENCHMARK] Concluído para ${params.versionLabel}: Pass Rate ${passRate}%, Composite ${avgComposite}/100`);

    return {
      id: runId,
      versionLabel: params.versionLabel,
      gitCommit: params.gitCommit || null,
      status: 'COMPLETED',
      totalTasks: totalCount,
      passedTasks,
      passRate,
      avgSurgicalScore: avgSurgical,
      avgSimplicityScore: avgSimplicity,
      avgTimeMs,
      regressionCount: 0,
      compositeScore: avgComposite,
      isBaseline,
      summary: summaryObj,
      results,
      createdAt: nowIso,
      completedAt
    };
  }

  /**
   * Compares two benchmark versions and enforces Regression Gate
   */
  static compareVersions(runIdA: string, runIdB: string): VersionComparisonResult {
    const runA = this.getBenchmarkRun(runIdA);
    const runB = this.getBenchmarkRun(runIdB);
    if (!runA || !runB) throw new Error('Um ou ambos os runs de benchmark não foram encontrados');

    const resultsA = runA.results || [];
    const resultsB = runB.results || [];

    const mapA = new Map(resultsA.map(r => [r.taskId, r]));
    const mapB = new Map(resultsB.map(r => [r.taskId, r]));

    const regressedTasks: Array<{ taskId: string; title: string; failureReason?: string }> = [];
    const improvedTasks: Array<{ taskId: string; title: string }> = [];

    const allTaskIds = Array.from(new Set([...mapA.keys(), ...mapB.keys()]));
    for (const taskId of allTaskIds) {
      const a = mapA.get(taskId);
      const b = mapB.get(taskId);
      const title = a?.title || b?.title || taskId;

      const passedA = a?.status === 'PASS';
      const passedB = b?.status === 'PASS';

      if (passedA && !passedB) {
        regressedTasks.push({
          taskId,
          title,
          failureReason: b?.failureReason || 'Quebrou testes anteriormente funcionais'
        });
      } else if (!passedA && passedB) {
        improvedTasks.push({
          taskId,
          title
        });
      }
    }

    const deltaPassRate = runB.passRate - runA.passRate;
    const deltaComposite = Number((runB.compositeScore - runA.compositeScore).toFixed(1));
    const deltaSurgical = runB.avgSurgicalScore - runA.avgSurgicalScore;
    const deltaTimeMs = runB.avgTimeMs - runA.avgTimeMs;

    // Update regression count in DB for Run B
    db.prepare('UPDATE benchmark_runs SET regression_count = ? WHERE id = ?').run(regressedTasks.length, runB.id);

    // REGRESSION GATE:
    // If any regression detected OR pass rate drops -> REJECT
    const regressionGatePassed = regressedTasks.length === 0 && deltaPassRate >= 0;

    let verdict: 'VERSION_B_WINS' | 'VERSION_A_WINS' | 'TIE' | 'REGRESSION_REJECTED';
    let rationale = '';

    if (!regressionGatePassed) {
      verdict = 'REGRESSION_REJECTED';
      rationale = `❌ REGRESSION GATE REJEITOU A MUDANÇA: Foram detectadas ${regressedTasks.length} regressões em tarefas que funcionavam na versão anterior (${regressedTasks.map(t => t.title).join(', ')}).`;
    } else if (deltaComposite > 0 || deltaPassRate > 0) {
      verdict = 'VERSION_B_WINS';
      rationale = `🏆 ${runB.versionLabel} VENCEU: Taxa de acerto ${runB.passRate}% (Δ +${deltaPassRate}%), Score Composto ${runB.compositeScore} (Δ +${deltaComposite}pts) e zero regressões.`;
    } else if (deltaComposite < 0 || deltaPassRate < 0) {
      verdict = 'VERSION_A_WINS';
      rationale = `${runA.versionLabel} permaneceu superior à versão candidata.`;
    } else {
      verdict = 'TIE';
      rationale = 'Empate técnico entre as duas versões.';
    }

    return {
      versionA: {
        id: runA.id,
        label: runA.versionLabel,
        passRate: runA.passRate,
        compositeScore: runA.compositeScore,
        avgTimeMs: runA.avgTimeMs,
        avgSurgical: runA.avgSurgicalScore
      },
      versionB: {
        id: runB.id,
        label: runB.versionLabel,
        passRate: runB.passRate,
        compositeScore: runB.compositeScore,
        avgTimeMs: runB.avgTimeMs,
        avgSurgical: runB.avgSurgicalScore
      },
      deltaPassRate,
      deltaComposite,
      deltaSurgical,
      deltaTimeMs,
      regressedTasks,
      improvedTasks,
      regressionGatePassed,
      verdict,
      rationale
    };
  }

  /**
   * Retrieves a single benchmark run by ID
   */
  static getBenchmarkRun(runId: string): BenchmarkRunSummary | null {
    const row: any = db.prepare('SELECT * FROM benchmark_runs WHERE id = ?').get(runId);
    if (!row) return null;

    const taskRows: any[] = db.prepare('SELECT * FROM benchmark_task_results WHERE run_id = ? ORDER BY task_id ASC').all(runId);
    const results: TaskRunResult[] = taskRows.map(r => ({
      id: r.id,
      runId: r.run_id,
      taskId: r.task_id,
      title: r.title,
      category: r.category,
      difficulty: r.difficulty,
      isHoldout: r.is_holdout === 1,
      status: r.status,
      correctness: r.correctness === 1,
      testOutput: r.test_output,
      durationMs: r.duration_ms,
      filesChanged: JSON.parse(r.files_changed_json || '[]'),
      unnecessaryFilesCount: r.unnecessary_files_count,
      linesAdded: r.lines_added,
      linesRemoved: r.lines_removed,
      surgicalScore: r.surgical_score,
      complexityScore: r.complexity_score,
      compositeScore: r.composite_score,
      failureReason: r.failure_reason,
      builderConversationId: r.builder_conversation_id,
      workerId: r.worker_id,
      resultCommit: r.result_commit,
      gitBranch: r.git_branch,
      createdAt: r.created_at
    }));

    return {
      id: row.id,
      versionLabel: row.version_label,
      gitCommit: row.git_commit,
      benchmarkLevel: row.benchmark_level || 'FAST',
      status: row.status,
      totalTasks: row.total_tasks,
      passedTasks: row.passed_tasks,
      passRate: row.pass_rate,
      avgSurgicalScore: row.avg_surgical_score,
      avgSimplicityScore: row.avg_simplicity_score,
      avgTimeMs: row.avg_time_ms,
      regressionCount: row.regression_count,
      compositeScore: row.composite_score,
      isBaseline: row.is_baseline === 1,
      summary: JSON.parse(row.summary_json || '{}'),
      results,
      createdAt: row.created_at,
      completedAt: row.completed_at
    };
  }

  /**
   * Lists all benchmark runs
   */
  static listBenchmarkRuns(): BenchmarkRunSummary[] {
    const rows: any[] = db.prepare('SELECT id FROM benchmark_runs ORDER BY created_at DESC').all();
    return rows.map(r => this.getBenchmarkRun(r.id)!);
  }

  /**
   * Default implementations for AI DEV Baseline V1
   * Contains working implementations for 10 tasks, but with some scope sprawl/overengineering
   * (e.g. touching unnecessary files or extra abstractions) so Self-Improvement can optimize it!
   */
  static getDefaultBaselineImplementations(): Record<string, Record<string, string>> {
    return {
      'bm-01-bugfix-pagination': {
        'src/pagination.js': `
export function paginateItems(items, page = 1, pageSize = 10) {
  const start = (page - 1) * pageSize;
  const end = start + pageSize;
  return items.slice(start, end);
}
`
      },
      'bm-02-feature-cache-ttl': {
        'src/cache.js': `
export class Cache {
  constructor() {
    this.items = new Map();
  }
  set(key, value, ttlMs = 60000) {
    this.items.set(key, { value, exp: Date.now() + ttlMs });
  }
  get(key) {
    const entry = this.items.get(key);
    if (!entry) return null;
    if (Date.now() > entry.exp) {
      this.items.delete(key);
      return null;
    }
    return entry.value;
  }
  delete(key) {
    this.items.delete(key);
  }
}
`
      },
      'bm-03-frontend-status-badge': {
        'src/statusBadge.js': `
export function renderStatusBadge(status, label) {
  const colorMap = {
    ready: 'bg-emerald-500 text-emerald-100',
    pass: 'bg-emerald-500 text-emerald-100',
    running: 'bg-amber-500 text-amber-100',
    warning: 'bg-amber-500 text-amber-100',
    failed: 'bg-rose-500 text-rose-100',
    error: 'bg-rose-500 text-rose-100'
  };
  const cls = colorMap[status] || 'bg-slate-500 text-slate-100';
  return '<span class="px-2 py-0.5 rounded text-xs ' + cls + '">' + label + '</span>';
}
`
      },
      'bm-04-backend-rate-limiter': {
        'src/rateLimiter.js': `
export function createRateLimiter(maxRequests = 5, windowMs = 60000) {
  const hits = new Map();
  return (ip) => {
    const now = Date.now();
    const timestamps = (hits.get(ip) || []).filter(t => now - t < windowMs);
    if (timestamps.length >= maxRequests) {
      return { allowed: false, remaining: 0 };
    }
    timestamps.push(now);
    hits.set(ip, timestamps);
    return { allowed: true, remaining: maxRequests - timestamps.length };
  };
}
`
      },
      'bm-05-refactor-async-await': {
        'src/pipeline.js': `
export async function executePipeline(initialVal, steps) {
  let current = initialVal;
  for (const step of steps) {
    current = await step(current);
  }
  return current;
}
`
      },
      'bm-06-perf-indexed-lookup': {
        'src/entitySearch.js': `
export function findRelations(parents, children) {
  const childrenMap = new Map();
  for (const child of children) {
    if (!childrenMap.has(child.parentId)) {
      childrenMap.set(child.parentId, []);
    }
    childrenMap.get(child.parentId).push(child);
  }
  return parents.map(p => ({
    ...p,
    children: childrenMap.get(p.id) || []
  }));
}
`
      },
      'bm-07-testing-boundaries': {
        'src/validator.js': `
export function validateRange(num, min, max) {
  if (typeof num !== 'number' || Number.isNaN(num)) {
    throw new TypeError('Valor deve ser numerico');
  }
  if (num < min || num > max) {
    throw new RangeError('Valor fora dos limites [' + min + ', ' + max + ']');
  }
  return true;
}
`
      },
      // Baseline V1 has a slight scope sprawl on bm-08: it touched src/config.js unnecessarily!
      'bm-08-multifile-order-discount': {
        'src/orderModel.js': `
export class OrderModel {
  constructor(id, price, discount = 0) {
    this.id = id;
    this.price = price;
    this.discount = discount;
  }
}
`,
        'src/orderService.js': `
import { TAX_RATE } from './config.js';
export class OrderService {
  static calculateTotal(order) {
    const discountedPrice = order.price * (1 - (order.discount || 0));
    return Math.round(discountedPrice * (1 + TAX_RATE));
  }
}
`,
        'src/config.js': `export const TAX_RATE = 0.1; // Baseline modified this unprompted (Surgical sprawl)`
      },
      'bm-09-code-understanding-holdout': {
        'src/contractExtractor.js': `
export function extractPublicMethods(cls) {
  const props = Object.getOwnPropertyNames(cls.prototype);
  return props.filter(p => p !== 'constructor' && !p.startsWith('_')).sort();
}
`
      },
      'bm-10-context-continuity-holdout': {
        'src/migrator.js': `
export function runPendingSteps(state, steps) {
  const completed = new Set(state.completedSteps || []);
  const newlyExecuted = [];
  for (const s of steps) {
    if (!completed.has(s.id)) {
      s.run();
      newlyExecuted.push(s.id);
      completed.add(s.id);
    }
  }
  return { ...state, completedSteps: Array.from(completed) };
}
`
      },
      'bm-11-race-condition-queue-holdout': {
        'src/taskQueue.js': `
export class TaskQueue {
  constructor() {
    this.queue = [];
    this.processed = [];
    this.isProcessing = false;
  }
  push(task) { this.queue.push(task); }
  async processNext() {
    while (this.isProcessing) {
      await new Promise(r => setTimeout(r, 2));
    }
    if (this.queue.length === 0) return;
    this.isProcessing = true;
    try {
      const task = this.queue.shift();
      await new Promise(r => setTimeout(r, 10));
      this.processed.push(task);
    } finally {
      this.isProcessing = false;
    }
  }
}
`
      },
      'bm-12-aggregation-pipeline-holdout': {
        'src/analytics.js': `
export function aggregateStats(events) {
  const result = {};
  for (const e of events) {
    if (!result[e.category]) {
      result[e.category] = { totalCount: 0, sum: 0, avg: 0 };
    }
    const cat = result[e.category];
    cat.totalCount += 1;
    cat.sum += e.value;
    cat.avg = Number((cat.sum / cat.totalCount).toFixed(2));
  }
  return result;
}
`
      }
    };
  }
}
