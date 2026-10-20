import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { db } from './db.js';
import { Logger } from './logger.js';
import { IndependentEvaluator } from './independentEvaluator.js';

export interface ResearchRunConfig {
  projectId: string;
  objective: string;
  primaryMetric: string;
  direction?: 'MINIMIZE' | 'MAXIMIZE';
  measurementCommand: string;
  metricParserRegex?: string;
  maxExperimentTime?: number; // hours
  maxExperiments?: number;
  allowedFiles?: string[];
  protectedFiles?: string[];
  complexityPenalty?: number; // threshold factor, e.g. 0.05 (5%)
  stopConditions?: string[];
}

export interface ResearchExperimentRecord {
  id: string;
  researchRunId: string;
  sequence: number;
  hypothesis: string;
  branch: string;
  commitHash: string | null;
  metricBefore: number;
  metricAfter: number;
  delta: number;
  improvementPct: number;
  durationMs: number;
  filesChanged: string[];
  linesAdded: number;
  linesRemoved: number;
  complexityDelta: number;
  status: 'BASELINE' | 'KEEP' | 'DISCARD' | 'CRASH';
  reason: string;
  stdoutExcerpt: string;
  createdAt: string;
}

export class ResearchManager {
  /**
   * Helper to parse objective metric from shell output
   */
  static parseMetric(output: string, customRegex?: string): number | null {
    if (!output) return null;

    // 1. Try custom regex if provided
    if (customRegex) {
      try {
        const re = new RegExp(customRegex, 'i');
        const match = output.match(re);
        if (match && match[1]) {
          const val = parseFloat(match[1]);
          if (!isNaN(val)) return val;
        }
      } catch (err) {
        Logger.warn(`[ResearchManager] Falha ao aplicar regex customizada: ${err}`);
      }
    }

    // 2. Try JSON parse if output is JSON formatted
    try {
      const jsonMatch = output.match(/\{[\s\S]*?\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        for (const k of ['metric', 'val_bpb', 'latency', 'duration', 'ms', 'bytes', 'size', 'score', 'ops', 'value']) {
          if (parsed[k] !== undefined && typeof parsed[k] === 'number') {
            return parsed[k];
          }
        }
      }
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "researchManager",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:researchManager]", err);
      }
    }

    // 3. Try standard metric labels (e.g. "val_bpb: 0.99", "latency_ms: 120", "score: 95.5")
    const standardMatches = [
      /(?:val_bpb|metric|latency|duration|time|runtime|bytes|bundle_bytes|size|score|ops|result)\s*[:=]\s*([0-9]+(?:\.[0-9]+)?)/i,
      /([0-9]+(?:\.[0-9]+)?)\s*(?:ms|s|sec|seconds|bytes|kb|mb|ops\/sec|ops)/i
    ];

    for (const re of standardMatches) {
      const match = output.match(re);
      if (match && match[1]) {
        const val = parseFloat(match[1]);
        if (!isNaN(val)) return val;
      }
    }

    // 4. Fallback: find any stand-alone float/integer in the last lines
    const lines = output.trim().split(/\r?\n/).reverse();
    for (const line of lines) {
      const match = line.match(/\b([0-9]+(?:\.[0-9]+)?)\b/);
      if (match && match[1]) {
        const val = parseFloat(match[1]);
        if (!isNaN(val)) return val;
      }
    }

    return null;
  }

  /**
   * Initializes and starts a new Research Run with mandatory Baseline execution
   */
  static startResearchRun(config: ResearchRunConfig, projectPath: string) {
    const id = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    const direction = config.direction || 'MINIMIZE';
    const maxExperiments = config.maxExperiments || 20;
    const maxHours = config.maxExperimentTime || 8.0;
    const complexityPenalty = config.complexityPenalty !== undefined ? config.complexityPenalty : 0.05;

    Logger.info(`[ResearchManager] Iniciando novo RESEARCH RUN: "${config.objective}"...`);

    // 1. Ensure git repo exists and create dedicated research branch
    let initialCommit = 'HEAD';
    let branchName = `research/${Date.now().toString().slice(-6)}`;
    try {
      execSync('git status', { cwd: projectPath, stdio: 'pipe' });
      // Create and checkout research branch
      try {
        execSync(`git checkout -b ${branchName}`, { cwd: projectPath, stdio: 'pipe' });
      } catch {
        branchName = execSync('git rev-parse --abbrev-ref HEAD', { cwd: projectPath, encoding: 'utf-8' }).trim();
      }
      initialCommit = execSync('git rev-parse HEAD', { cwd: projectPath, encoding: 'utf-8' }).trim();
    } catch (err: any) {
      Logger.warn(`[ResearchManager] Alerta git no projeto: ${err.message}`);
    }

    // 2. Compute BASELINE (mandatory step before any experimental change)
    Logger.info(`[ResearchManager] Executando comando de medição do BASELINE: "${config.measurementCommand}"...`);
    const baselineStartTime = Date.now();
    let baselineOutput = '';
    let baselineMetric: number | null = null;

    try {
      baselineOutput = execSync(config.measurementCommand, {
        cwd: projectPath,
        encoding: 'utf-8',
        timeout: 60000,
        stdio: 'pipe'
      });
      baselineMetric = this.parseMetric(baselineOutput, config.metricParserRegex);
    } catch (cmdErr: any) {
      const errOut = (cmdErr.stdout || '') + (cmdErr.stderr || '') + (cmdErr.message || '');
      Logger.error(`[ResearchManager] CRASH no comando de medição do BASELINE! Saída: ${errOut.slice(0, 300)}`);
      throw new Error(`Falha crítica ao executar Baseline de medição: ${cmdErr.message}. Verifique o comando.`);
    }

    if (baselineMetric === null) {
      throw new Error(`Não foi possível extrair métrica numérica válida da saída do baseline: "${baselineOutput.slice(0, 200)}"`);
    }

    const baselineDuration = Date.now() - baselineStartTime;
    Logger.success(`[ResearchManager] BASELINE estabelecido com sucesso: ${baselineMetric} ${config.primaryMetric} (Duração: ${baselineDuration}ms)`);

    // 3. Save Research Run to SQLite
    db.prepare(`
      INSERT INTO research_runs (
        id, project_id, objective, primary_metric, direction, measurement_command,
        metric_parser_regex, max_experiment_time, max_experiments, current_experiment,
        status, baseline_metric, best_metric, best_commit, branch_name,
        allowed_files_json, protected_files_json, complexity_penalty, stop_conditions_json,
        keep_count, discard_count, crash_count, current_hypothesis,
        start_time, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'running', ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 'Baseline inicial estabelecido', ?, ?, ?)
    `).run(
      id,
      config.projectId,
      config.objective,
      config.primaryMetric,
      direction,
      config.measurementCommand,
      config.metricParserRegex || null,
      maxHours,
      maxExperiments,
      baselineMetric,
      baselineMetric,
      initialCommit,
      branchName,
      JSON.stringify(config.allowedFiles || []),
      JSON.stringify(config.protectedFiles || []),
      complexityPenalty,
      JSON.stringify(config.stopConditions || []),
      nowIso,
      nowIso,
      nowIso
    );

    // 4. Record Baseline Experiment (#0) in Experiment Ledger
    const baselineExpId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO research_experiments (
        id, research_run_id, sequence, hypothesis, branch, commit_hash,
        metric_before, metric_after, delta, improvement_pct, duration_ms,
        files_changed_json, lines_added, lines_removed, complexity_delta,
        status, reason, stdout_excerpt, created_at
      ) VALUES (?, ?, 0, 'Baseline de referência inicial', ?, ?, ?, ?, 0, 0, ?, '[]', 0, 0, 0, 'BASELINE', 'Baseline inicial estabelecido sem alterações', ?, ?)
    `).run(
      baselineExpId,
      id,
      branchName,
      initialCommit,
      baselineMetric,
      baselineMetric,
      baselineDuration,
      baselineOutput.slice(0, 1000),
      nowIso
    );

    return this.getResearchRun(id);
  }

  /**
   * Executes a single experiment cycle in the Research Run:
   * Hypothesis -> Change -> Commit -> Measure -> Keep / Discard / Crash -> Revert if worse
   */
  static async executeExperimentStep(params: {
    runId: string;
    projectPath: string;
    hypothesis: string;
    filesChanged?: string[];
    applyChanges?: () => Promise<void> | void;
  }): Promise<ResearchExperimentRecord> {
    const run: any = db.prepare('SELECT * FROM research_runs WHERE id = ?').get(params.runId);
    if (!run) throw new Error(`Research Run #${params.runId} não encontrado.`);
    if (run.status !== 'running') throw new Error(`Research Run não está ativo (status: ${run.status}).`);

    const nowIso = new Date().toISOString();
    const startTime = Date.now();
    const sequence = run.current_experiment + 1;
    const bestMetricBefore = run.best_metric;
    const bestCommitBefore = run.best_commit;
    const direction = run.direction as 'MINIMIZE' | 'MAXIMIZE';
    const complexityPenaltyFactor = run.complexity_penalty || 0.05;

    Logger.info(`[ResearchManager] Executando Experimento #${sequence}: "${params.hypothesis}"...`);

    // 1. Update current hypothesis
    db.prepare('UPDATE research_runs SET current_hypothesis = ?, current_experiment = ?, updated_at = ? WHERE id = ?')
      .run(params.hypothesis, sequence, nowIso, params.runId);

    // 2. Apply modifications if callback provided
    if (params.applyChanges) {
      await params.applyChanges();
    }

    // 3. Inspect git diff and changed files
    let linesAdded = 0;
    let linesRemoved = 0;
    let filesChanged: string[] = params.filesChanged || [];
    let commitHash: string | null = null;

    try {
      const numstat = execSync('git diff --numstat', { cwd: params.projectPath, encoding: 'utf-8' });
      const lines = numstat.trim().split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        const [add, del, file] = line.split(/\s+/);
        linesAdded += parseInt(add, 10) || 0;
        linesRemoved += parseInt(del, 10) || 0;
        if (!filesChanged.includes(file)) filesChanged.push(file);
      }
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "researchManager",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:researchManager]", err);
      }
    }

    const complexityDelta = linesAdded - linesRemoved;

    // 4. Validate that no protected files were altered (PROTECTED_EVALUATION)
    const protectedFiles: string[] = run.protected_files_json ? JSON.parse(run.protected_files_json) : [];
    const violatedProtected = filesChanged.filter(f => protectedFiles.some(pf => f.includes(pf)));
    if (violatedProtected.length > 0) {
      Logger.error(`🚨 [ResearchManager] Violação de arquivo protegido detectada: ${violatedProtected.join(', ')}`);
      // Revert immediately
      try { execSync(`git reset --hard ${bestCommitBefore}`, { cwd: params.projectPath }); } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "researchManager",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:researchManager]", err);
      }
    }
      const crashRecord: ResearchExperimentRecord = {
        id: crypto.randomUUID(),
        researchRunId: params.runId,
        sequence,
        hypothesis: params.hypothesis,
        branch: run.branch_name,
        commitHash: null,
        metricBefore: bestMetricBefore,
        metricAfter: bestMetricBefore,
        delta: 0,
        improvementPct: 0,
        durationMs: Date.now() - startTime,
        filesChanged,
        linesAdded,
        linesRemoved,
        complexityDelta,
        status: 'CRASH',
        reason: `CRASH / REJEITADO: Experimento violou arquivos protegidos (${violatedProtected.join(', ')}). Revertido.`,
        stdoutExcerpt: 'Tentativa de alteração em arquivos protegidos bloqueada.',
        createdAt: nowIso
      };
      this.saveExperimentRecord(crashRecord, run);
      return crashRecord;
    }

    // 5. Commit experiment to git
    try {
      execSync('git add -A', { cwd: params.projectPath });
      execSync(`git commit -m "Experiment #${sequence}: ${params.hypothesis.replace(/"/g, "'")}"`, {
        cwd: params.projectPath,
        stdio: 'pipe'
      });
      commitHash = execSync('git rev-parse HEAD', { cwd: params.projectPath, encoding: 'utf-8' }).trim();
    } catch (commitErr: any) {
      Logger.warn(`[ResearchManager] Commit git gerou aviso: ${commitErr.message}`);
      commitHash = bestCommitBefore;
    }

    // 6. Measure metric using measurement_command
    let commandOutput = '';
    let measuredMetric: number | null = null;
    let isCrash = false;

    try {
      Logger.info(`[ResearchManager] Executando medição: "${run.measurement_command}"...`);
      commandOutput = execSync(run.measurement_command, {
        cwd: params.projectPath,
        encoding: 'utf-8',
        timeout: 90000,
        stdio: 'pipe'
      });
      measuredMetric = this.parseMetric(commandOutput, run.metric_parser_regex);
      if (measuredMetric === null) isCrash = true;
    } catch (runErr: any) {
      isCrash = true;
      commandOutput = (runErr.stdout || '') + (runErr.stderr || '') + (runErr.message || '');
      Logger.warn(`[ResearchManager] Experimento #${sequence} CRASHOU: ${commandOutput.slice(0, 200)}`);
    }

    const durationMs = Date.now() - startTime;
    let status: 'KEEP' | 'DISCARD' | 'CRASH' = 'DISCARD';
    let reason = '';
    let improvementPct = 0;
    let delta = 0;

    // 7. Evaluate metric and apply Simplicity First criterion
    if (isCrash || measuredMetric === null) {
      status = 'CRASH';
      reason = 'Execução falhou ou encerrou com erro (CRASH). Código revertido para o último commit KEEP.';
      // REVERT TO BEST COMMIT
      try {
        Logger.info(`[ResearchManager] Revertendo CRASH para commit estável ${bestCommitBefore.slice(0, 7)}...`);
        execSync(`git reset --hard ${bestCommitBefore}`, { cwd: params.projectPath });
      } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "researchManager",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:researchManager]", err);
      }
    }
    } else {
      delta = measuredMetric - bestMetricBefore;

      if (direction === 'MINIMIZE') {
        // Lower is better
        improvementPct = ((bestMetricBefore - measuredMetric) / (bestMetricBefore || 1)) * 100;
        const improved = measuredMetric < bestMetricBefore;

        if (improved) {
          // Check Simplicity Penalty:
          // e.g. minor improvement (< 2%) with huge added complexity (> 100 LOC)
          if (complexityDelta > 50 && improvementPct < (complexityPenaltyFactor * 100)) {
            status = 'DISCARD';
            reason = `DISCARD (Simplicity Penalty): Ganho marginal de apenas ${improvementPct.toFixed(2)}% acompanhado de alta complexidade (+${complexityDelta} LOC). Princípio Simplicity First violado. Revertido.`;
            try {
              execSync(`git reset --hard ${bestCommitBefore}`, { cwd: params.projectPath });
            } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "researchManager",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:researchManager]", err);
      }
    }
          } else {
            status = 'KEEP';
            reason = `KEEP: Métrica otimizada com sucesso! (${bestMetricBefore} -> ${measuredMetric}, ganho de ${improvementPct.toFixed(2)}%). Commit mantido.`;
          }
        } else {
          status = 'DISCARD';
          reason = `DISCARD: Métrica piorou ou estagnou (${measuredMetric} vs melhor ${bestMetricBefore}). Código revertido.`;
          try {
            execSync(`git reset --hard ${bestCommitBefore}`, { cwd: params.projectPath });
          } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "researchManager",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:researchManager]", err);
      }
    }
        }
      } else {
        // MAXIMIZE (higher is better)
        improvementPct = ((measuredMetric - bestMetricBefore) / (bestMetricBefore || 1)) * 100;
        const improved = measuredMetric > bestMetricBefore;

        if (improved) {
          if (complexityDelta > 50 && improvementPct < (complexityPenaltyFactor * 100)) {
            status = 'DISCARD';
            reason = `DISCARD (Simplicity Penalty): Ganho marginal de apenas ${improvementPct.toFixed(2)}% com complexidade excessiva (+${complexityDelta} LOC). Revertido.`;
            try {
              execSync(`git reset --hard ${bestCommitBefore}`, { cwd: params.projectPath });
            } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "researchManager",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:researchManager]", err);
      }
    }
          } else {
            status = 'KEEP';
            reason = `KEEP: Métrica maximizada com sucesso! (${bestMetricBefore} -> ${measuredMetric}, ganho de ${improvementPct.toFixed(2)}%). Commit mantido.`;
          }
        } else {
          status = 'DISCARD';
          reason = `DISCARD: Métrica piorou ou estagnou (${measuredMetric} vs melhor ${bestMetricBefore}). Código revertido.`;
          try {
            execSync(`git reset --hard ${bestCommitBefore}`, { cwd: params.projectPath });
          } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "researchManager",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:researchManager]", err);
      }
    }
        }
      }
    }

    const expRecord: ResearchExperimentRecord = {
      id: crypto.randomUUID(),
      researchRunId: params.runId,
      sequence,
      hypothesis: params.hypothesis,
      branch: run.branch_name,
      commitHash: status === 'KEEP' ? commitHash : bestCommitBefore,
      metricBefore: bestMetricBefore,
      metricAfter: measuredMetric !== null ? measuredMetric : bestMetricBefore,
      delta,
      improvementPct: Math.round(improvementPct * 100) / 100,
      durationMs,
      filesChanged,
      linesAdded,
      linesRemoved,
      complexityDelta,
      status,
      reason,
      stdoutExcerpt: commandOutput.slice(0, 1000),
      createdAt: nowIso
    };

    this.saveExperimentRecord(expRecord, run);

    if (status === 'KEEP') {
      Logger.success(`[ResearchManager] ⭐ EXPERIMENTO #${sequence} KEEP! Métrica avançou para ${measuredMetric}.`);
    } else if (status === 'DISCARD') {
      Logger.warn(`[ResearchManager] ↩ EXPERIMENTO #${sequence} DISCARD. Revertido com sucesso para ${bestCommitBefore.slice(0, 7)}.`);
    } else {
      Logger.error(`[ResearchManager] 💥 EXPERIMENTO #${sequence} CRASH. Revertido com sucesso para ${bestCommitBefore.slice(0, 7)}.`);
    }

    return expRecord;
  }

  /**
   * Persists experiment record and updates run stats
   */
  private static saveExperimentRecord(exp: ResearchExperimentRecord, currentRun: any) {
    db.prepare(`
      INSERT INTO research_experiments (
        id, research_run_id, sequence, hypothesis, branch, commit_hash,
        metric_before, metric_after, delta, improvement_pct, duration_ms,
        files_changed_json, lines_added, lines_removed, complexity_delta,
        status, reason, stdout_excerpt, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      exp.id,
      exp.researchRunId,
      exp.sequence,
      exp.hypothesis,
      exp.branch,
      exp.commitHash,
      exp.metricBefore,
      exp.metricAfter,
      exp.delta,
      exp.improvementPct,
      exp.durationMs,
      JSON.stringify(exp.filesChanged),
      exp.linesAdded,
      exp.linesRemoved,
      exp.complexityDelta,
      exp.status,
      exp.reason,
      exp.stdoutExcerpt,
      exp.createdAt
    );

    let keepCount = currentRun.keep_count;
    let discardCount = currentRun.discard_count;
    let crashCount = currentRun.crash_count;
    let bestMetric = currentRun.best_metric;
    let bestCommit = currentRun.best_commit;

    if (exp.status === 'KEEP') {
      keepCount += 1;
      bestMetric = exp.metricAfter;
      bestCommit = exp.commitHash;
    } else if (exp.status === 'DISCARD') {
      discardCount += 1;
    } else if (exp.status === 'CRASH') {
      crashCount += 1;
    }

    const isComplete = exp.sequence >= currentRun.max_experiments;
    const finalStatus = isComplete ? 'completed' : currentRun.status;
    const nowIso = new Date().toISOString();

    db.prepare(`
      UPDATE research_runs
      SET keep_count = ?, discard_count = ?, crash_count = ?,
          best_metric = ?, best_commit = ?, status = ?,
          current_experiment = ?, updated_at = ?,
          end_time = CASE WHEN ? = 'completed' THEN ? ELSE end_time END
      WHERE id = ?
    `).run(
      keepCount,
      discardCount,
      crashCount,
      bestMetric,
      bestCommit,
      finalStatus,
      exp.sequence,
      nowIso,
      finalStatus,
      nowIso,
      exp.researchRunId
    );
  }

  /**
   * Stop active research run and guarantee working tree is at best KEEP commit
   */
  static stopResearchRun(runId: string, projectPath: string) {
    const run: any = db.prepare('SELECT * FROM research_runs WHERE id = ?').get(runId);
    if (!run) throw new Error('Research Run não encontrado.');

    const nowIso = new Date().toISOString();
    db.prepare("UPDATE research_runs SET status = 'stopped', end_time = ?, updated_at = ? WHERE id = ?")
      .run(nowIso, nowIso, runId);

    if (run.best_commit) {
      try {
        Logger.info(`[ResearchManager] Run finalizado. Garantindo que o working tree está no melhor commit ${run.best_commit.slice(0, 7)}...`);
        execSync(`git reset --hard ${run.best_commit}`, { cwd: projectPath });
      } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "researchManager",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:researchManager]", err);
      }
    }
    }

    return this.getResearchRun(runId);
  }

  /**
   * Retrieves full details and ledger of a Research Run
   */
  static getResearchRun(runId: string) {
    const run: any = db.prepare('SELECT * FROM research_runs WHERE id = ?').get(runId);
    if (!run) return null;

    const experiments: any[] = db.prepare('SELECT * FROM research_experiments WHERE research_run_id = ? ORDER BY sequence ASC').all(runId);

    const parsedExperiments = experiments.map(e => ({
      ...e,
      researchRunId: e.research_run_id,
      commitHash: e.commit_hash,
      metricBefore: e.metric_before,
      metricAfter: e.metric_after,
      improvementPct: e.improvement_pct,
      durationMs: e.duration_ms,
      linesAdded: e.lines_added,
      linesRemoved: e.lines_removed,
      complexityDelta: e.complexity_delta,
      stdoutExcerpt: e.stdout_excerpt,
      createdAt: e.created_at,
      filesChanged: e.files_changed_json ? JSON.parse(e.files_changed_json) : []
    }));

    // Calculate overall improvement from baseline to best
    let overallImprovementPct = 0;
    if (run.baseline_metric && run.best_metric) {
      if (run.direction === 'MINIMIZE') {
        overallImprovementPct = ((run.baseline_metric - run.best_metric) / run.baseline_metric) * 100;
      } else {
        overallImprovementPct = ((run.best_metric - run.baseline_metric) / run.baseline_metric) * 100;
      }
    }

    return {
      ...run,
      projectId: run.project_id,
      primaryMetric: run.primary_metric,
      measurementCommand: run.measurement_command,
      metricParserRegex: run.metric_parser_regex,
      maxExperimentTime: run.max_experiment_time,
      maxExperiments: run.max_experiments,
      currentExperiment: run.current_experiment,
      baselineMetric: run.baseline_metric,
      bestMetric: run.best_metric,
      bestCommit: run.best_commit,
      branchName: run.branch_name,
      keepCount: run.keep_count,
      discardCount: run.discard_count,
      crashCount: run.crash_count,
      currentHypothesis: run.current_hypothesis,
      startTime: run.start_time,
      endTime: run.end_time,
      createdAt: run.created_at,
      updatedAt: run.updated_at,
      allowedFiles: run.allowed_files_json ? JSON.parse(run.allowed_files_json) : [],
      protectedFiles: run.protected_files_json ? JSON.parse(run.protected_files_json) : [],
      stopConditions: run.stop_conditions_json ? JSON.parse(run.stop_conditions_json) : [],
      overallImprovementPct: Math.round(overallImprovementPct * 10) / 10,
      experiments: parsedExperiments
    };
  }

  /**
   * Get latest active or recent research run for project
   */
  static getActiveResearchRun(projectId: string) {
    const run: any = db.prepare(
      "SELECT id FROM research_runs WHERE project_id = ? ORDER BY created_at DESC LIMIT 1"
    ).get(projectId);

    if (!run) return null;
    return this.getResearchRun(run.id);
  }

  /**
   * List all research runs for project
   */
  static listResearchRuns(projectId: string) {
    const runs: any[] = db.prepare('SELECT * FROM research_runs WHERE project_id = ? ORDER BY created_at DESC').all(projectId);
    return runs.map(r => this.getResearchRun(r.id));
  }

  /**
   * Controlled experiment comparing two candidate skills or strategies against a measurable baseline.
   * Leverages Karpathy AutoResearch mechanics to evaluate and select the winning strategy objectively.
   */
  static async compareSkillStrategies(params: {
    projectId: string;
    projectPath: string;
    objective: string;
    primaryMetric: string;
    direction?: 'MINIMIZE' | 'MAXIMIZE';
    measurementCommand: string;
    metricParserRegex?: string;
    allowedFiles?: string[];
    protectedFiles?: string[];
    complexityPenalty?: number;
    candidateA: {
      skill: import('./skillRouter.js').TechnicalSkill;
      strategyName: string;
      hypothesis: string;
      apply: () => Promise<void> | void;
    };
    candidateB: {
      skill: import('./skillRouter.js').TechnicalSkill;
      strategyName: string;
      hypothesis: string;
      apply: () => Promise<void> | void;
    };
  }): Promise<{
    runId: string;
    baselineMetric: number;
    winner: 'CANDIDATE_A' | 'CANDIDATE_B' | 'BASELINE';
    winningSkill: import('./skillRouter.js').TechnicalSkill | null;
    winningStrategy: string;
    experimentA: ResearchExperimentRecord;
    experimentB: ResearchExperimentRecord;
    analysis: string;
  }> {
    const direction = params.direction || 'MINIMIZE';
    Logger.info(`[ResearchManager] Iniciando comparação experimental de skills: [${params.candidateA.skill}] vs [${params.candidateB.skill}] para "${params.objective}"`);

    // 1. Iniciar run de pesquisa estabelecendo baseline
    const researchRun = this.startResearchRun({
      projectId: params.projectId,
      objective: params.objective,
      primaryMetric: params.primaryMetric,
      direction,
      measurementCommand: params.measurementCommand,
      metricParserRegex: params.metricParserRegex,
      allowedFiles: params.allowedFiles,
      protectedFiles: params.protectedFiles,
      complexityPenalty: params.complexityPenalty,
      maxExperiments: 2
    }, params.projectPath);

    const baselineMetric = researchRun.baselineMetric!;
    const baselineCommit = researchRun.bestCommit!;

    // 2. Executar Experimento A (Candidato A)
    const expA = await this.executeExperimentStep({
      runId: researchRun.id,
      projectPath: params.projectPath,
      hypothesis: `[Skill: ${params.candidateA.skill}] ${params.candidateA.strategyName}: ${params.candidateA.hypothesis}`,
      applyChanges: params.candidateA.apply
    });

    // 3. Restaurar para o commit baseline antes de testar Candidato B
    try {
      execSync(`git reset --hard ${baselineCommit}`, { cwd: params.projectPath, stdio: 'pipe' });
      db.prepare('UPDATE research_runs SET best_metric = ?, best_commit = ? WHERE id = ?')
        .run(baselineMetric, baselineCommit, researchRun.id);
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "researchManager",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:researchManager]", err);
      }
    }

    // 4. Executar Experimento B (Candidato B) a partir do mesmo baseline
    const expB = await this.executeExperimentStep({
      runId: researchRun.id,
      projectPath: params.projectPath,
      hypothesis: `[Skill: ${params.candidateB.skill}] ${params.candidateB.strategyName}: ${params.candidateB.hypothesis}`,
      applyChanges: params.candidateB.apply
    });

    // 5. Comparação objetiva baseada em métrica e penalidade
    const isBetter = (candidateMetric: number, baseMetric: number) => {
      return direction === 'MINIMIZE' ? candidateMetric < baseMetric : candidateMetric > baseMetric;
    };

    const validA = expA.status === 'KEEP' || (expA.status !== 'CRASH' && isBetter(expA.metricAfter, baselineMetric));
    const validB = expB.status === 'KEEP' || (expB.status !== 'CRASH' && isBetter(expB.metricAfter, baselineMetric));

    let winner: 'CANDIDATE_A' | 'CANDIDATE_B' | 'BASELINE' = 'BASELINE';
    let winningSkill: import('./skillRouter.js').TechnicalSkill | null = null;
    let winningStrategy = 'Baseline de Referência';
    let winningCommit = baselineCommit;
    let winningMetric = baselineMetric;

    if (validA && validB) {
      if (isBetter(expA.metricAfter, expB.metricAfter)) {
        winner = 'CANDIDATE_A';
        winningSkill = params.candidateA.skill;
        winningStrategy = params.candidateA.strategyName;
        winningCommit = expA.commitHash || baselineCommit;
        winningMetric = expA.metricAfter;
      } else {
        winner = 'CANDIDATE_B';
        winningSkill = params.candidateB.skill;
        winningStrategy = params.candidateB.strategyName;
        winningCommit = expB.commitHash || baselineCommit;
        winningMetric = expB.metricAfter;
      }
    } else if (validA) {
      winner = 'CANDIDATE_A';
      winningSkill = params.candidateA.skill;
      winningStrategy = params.candidateA.strategyName;
      winningCommit = expA.commitHash || baselineCommit;
      winningMetric = expA.metricAfter;
    } else if (validB) {
      winner = 'CANDIDATE_B';
      winningSkill = params.candidateB.skill;
      winningStrategy = params.candidateB.strategyName;
      winningCommit = expB.commitHash || baselineCommit;
      winningMetric = expB.metricAfter;
    }

    // 6. Assegurar que o workspace físico reflete o vencedor final
    try {
      execSync(`git reset --hard ${winningCommit}`, { cwd: params.projectPath, stdio: 'pipe' });
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "researchManager",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:researchManager]", err);
      }
    }

    // 7. Atualizar status final do Run de pesquisa
    const nowIso = new Date().toISOString();
    db.prepare(`
      UPDATE research_runs
      SET status = 'completed', best_metric = ?, best_commit = ?, end_time = ?, updated_at = ?
      WHERE id = ?
    `).run(winningMetric, winningCommit, nowIso, nowIso, researchRun.id);

    const deltaA = Math.round((expA.metricAfter - baselineMetric) * 100) / 100;
    const deltaB = Math.round((expB.metricAfter - baselineMetric) * 100) / 100;
    const analysis = `AutoResearch Comparativo concluído. Baseline: ${baselineMetric}. Candidato A (${params.candidateA.skill}): ${expA.metricAfter} (delta: ${deltaA}, status: ${expA.status}). Candidato B (${params.candidateB.skill}): ${expB.metricAfter} (delta: ${deltaB}, status: ${expB.status}). Vencedor: ${winner} (${winningStrategy}).`;

    Logger.info(`[ResearchManager] ${analysis}`);

    return {
      runId: researchRun.id,
      baselineMetric,
      winner,
      winningSkill,
      winningStrategy,
      experimentA: expA,
      experimentB: expB,
      analysis
    };
  }
}
