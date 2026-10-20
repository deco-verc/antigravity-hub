// server/src/selfImprovementManager.ts
// Autonomous Self-Improvement Loop (Hypothesis -> Arena -> Benchmark -> Regression Gate -> Keep/Discard)

import crypto from 'node:crypto';
import { db } from './db.js';
import { Logger } from './logger.js';
import { BenchmarkManager, BenchmarkRunSummary, VersionComparisonResult } from './benchmarkManager.js';
import { AgentBenchmarkManager, AgentBenchmarkRunSummary } from './agentBenchmarkManager.js';
import { PromotionContract, createDefaultPromotionContract } from './promotionContract.js';
import { PromotionGate, PromotionEvaluationResult, PromotionVerdict } from './promotionGate.js';
import { PromotionCouncil, CouncilTradeoffSynthesis } from './promotionCouncil.js';

export interface SelfImprovementExperimentData {
  id: string;
  experimentNumber: number;
  hypothesis: string;
  bottleneckIdentified: string;
  baselineRunId: string;
  status: 'PROPOSING' | 'ARENA_RUNNING' | 'BENCHMARKING' | 'EVALUATING' | 'KEEP' | 'DISCARD' | 'CRASH' | 'TRADEOFF_REVIEW' | 'REGRESSION_REJECTED' | 'INSUFFICIENT_EVIDENCE';
  benchmarkLevel?: 'FAST' | 'AGENT';
  candidateAScore: number;
  candidateBScore: number;
  winnerCandidate: string | null;
  winningCommitSha?: string | null;
  promotedVersionLabel?: string | null;
  candidateABranch?: string | null;
  candidateBBranch?: string | null;
  candidateACommit?: string | null;
  candidateBCommit?: string | null;
  verdict: 'KEEP' | 'DISCARD' | 'CRASH' | 'TRADEOFF_REVIEW' | 'REGRESSION_REJECTED' | 'INSUFFICIENT_EVIDENCE' | null;
  rationale: string | null;
  promotionContract?: PromotionContract;
  targetMetric?: string;
  targetImprovementPct?: number;
  globalImpactPct?: number;
  originalVerdict?: string;
  reevaluatedVerdict?: string;
  councilRecommendation?: string;
  createdAt: string;
  completedAt?: string;
  baselineRun?: BenchmarkRunSummary | AgentBenchmarkRunSummary | null;
  promotedRunId?: string;
}

export class SelfImprovementManager {
  /**
   * Creates a new Self-Improvement experiment from an identified bottleneck
   */
  static createExperiment(params: {
    hypothesis: string;
    bottleneckIdentified: string;
    baselineRunId?: string;
    benchmarkLevel?: 'FAST' | 'AGENT';
  }): SelfImprovementExperimentData {
    const id = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    const level = params.benchmarkLevel || 'FAST';

    // Get latest baseline or specified baseline
    let baselineRunId: string = params.baselineRunId || '';
    if (!baselineRunId) {
      const query = level === 'AGENT'
        ? "SELECT id FROM benchmark_runs WHERE is_baseline = 1 AND benchmark_level = 'AGENT' ORDER BY created_at DESC LIMIT 1"
        : "SELECT id FROM benchmark_runs WHERE is_baseline = 1 ORDER BY created_at DESC LIMIT 1";
      const row: any = db.prepare(query).get();
      if (!row) {
        throw new Error('Nenhum benchmark baseline encontrado. Execute primeiro a suíte baseline correspondente.');
      }
      baselineRunId = row.id;
    }

    const countRow: any = db.prepare('SELECT COUNT(*) as count FROM self_improvement_experiments').get();
    const experimentNumber = (countRow?.count || 0) + 1;

    db.prepare(`
      INSERT INTO self_improvement_experiments (
        id, experiment_number, hypothesis, bottleneck_identified, baseline_run_id,
        status, benchmark_level, candidate_a_score, candidate_b_score, created_at
      ) VALUES (?, ?, ?, ?, ?, 'PROPOSING', ?, 0, 0, ?)
    `).run(
      id,
      experimentNumber,
      params.hypothesis,
      params.bottleneckIdentified,
      baselineRunId,
      level,
      nowIso
    );

    Logger.info(`[SELF-IMPROVEMENT] Experimento #${experimentNumber} criado: "${params.hypothesis}"`);

    return this.getExperiment(id)!;
  }

  /**
   * Executes a complete Self-Improvement cycle
   * Evaluates Candidate A vs Candidate B on isolated branches against the full Benchmark Suite
   */
  static async executeExperimentCycle(params: {
    experimentId: string;
    candidateA: {
      label: string;
      strategy: string;
      implementations: Record<string, Record<string, string>>;
    };
    candidateB: {
      label: string;
      strategy: string;
      implementations: Record<string, Record<string, string>>;
    };
  }): Promise<{
    experiment: SelfImprovementExperimentData;
    candidateARun: BenchmarkRunSummary;
    candidateBRun: BenchmarkRunSummary;
    comparisonA: VersionComparisonResult;
    comparisonB: VersionComparisonResult;
    verdict: 'KEEP' | 'DISCARD' | 'CRASH';
    promotedVersionLabel?: string;
  }> {
    const exp = this.getExperiment(params.experimentId);
    if (!exp) throw new Error(`Experimento #${params.experimentId} não encontrado`);

    const baselineRun = BenchmarkManager.getBenchmarkRun(exp.baselineRunId);
    if (!baselineRun) throw new Error(`Baseline run #${exp.baselineRunId} não encontrado`);

    db.prepare("UPDATE self_improvement_experiments SET status = 'BENCHMARKING' WHERE id = ?").run(exp.id);
    Logger.info(`[SELF-IMPROVEMENT] Executando benchmark para Candidate A e Candidate B no Exp #${exp.experimentNumber}...`);

    // 1. Run Candidate A in isolated benchmark run
    const runA = await BenchmarkManager.runBenchmarkSuite({
      versionLabel: `self-improve-exp-${exp.experimentNumber}-cand-a`,
      gitCommit: `branch: self-improve/exp-${exp.experimentNumber}/candidate-a`,
      candidateImplementations: params.candidateA.implementations,
      isBaseline: false
    });

    // 2. Run Candidate B in isolated benchmark run
    const runB = await BenchmarkManager.runBenchmarkSuite({
      versionLabel: `self-improve-exp-${exp.experimentNumber}-cand-b`,
      gitCommit: `branch: self-improve/exp-${exp.experimentNumber}/candidate-b`,
      candidateImplementations: params.candidateB.implementations,
      isBaseline: false
    });

    // 3. Compare both candidates against Baseline
    const compA = BenchmarkManager.compareVersions(baselineRun.id, runA.id);
    const compB = BenchmarkManager.compareVersions(baselineRun.id, runB.id);

    db.prepare("UPDATE self_improvement_experiments SET status = 'EVALUATING' WHERE id = ?").run(exp.id);

    // 4. Decision Engine (Keep / Discard / Crash)
    // Check Regression Gate for both
    let verdict: 'KEEP' | 'DISCARD' | 'CRASH' = 'DISCARD';
    let winnerLabel: string | null = null;
    let rationale = '';
    let promotedVersionLabel: string | undefined = undefined;

    // Favor Candidate B if it improves surgical precision and has 0 regressions
    if (compB.regressionGatePassed && compB.deltaComposite > 0 && compB.deltaComposite >= compA.deltaComposite) {
      verdict = 'KEEP';
      winnerLabel = params.candidateB.label;
      promotedVersionLabel = 'AI_DEV_V2';
      rationale = `🏆 KEEP (Promover para ${promotedVersionLabel}): ${params.candidateB.label} superou a Baseline V1 com Delta Composite +${compB.deltaComposite}pts, melhora no Surgical Score de ${compB.deltaSurgical}pts e 0 regressões.`;
    } else if (compA.regressionGatePassed && compA.deltaComposite > 0) {
      verdict = 'KEEP';
      winnerLabel = params.candidateA.label;
      promotedVersionLabel = 'AI_DEV_V2';
      rationale = `🏆 KEEP: ${params.candidateA.label} superou a Baseline V1 com Delta Composite +${compA.deltaComposite}pts e 0 regressões.`;
    } else {
      verdict = 'DISCARD';
      winnerLabel = null;
      rationale = `❌ DISCARD: Nenhum candidato superou a Baseline de forma segura sem violar o Regression Gate (Regressões: Cand A = ${compA.regressedTasks.length}, Cand B = ${compB.regressedTasks.length}). Hipótese descartada.`;
    }

    const completedAt = new Date().toISOString();
    db.prepare(`
      UPDATE self_improvement_experiments
      SET status = ?, candidate_a_score = ?, candidate_b_score = ?,
          winner_candidate = ?, verdict = ?, rationale = ?, completed_at = ?
      WHERE id = ?
    `).run(
      verdict,
      runA.compositeScore,
      runB.compositeScore,
      winnerLabel,
      verdict,
      rationale,
      completedAt,
      exp.id
    );

    // If KEEP and promoted, update the winning candidate's benchmark run to the promoted version label
    if (verdict === 'KEEP' && promotedVersionLabel) {
      const winnerRunId = winnerLabel === params.candidateA.label ? runA.id : runB.id;
      db.prepare("UPDATE benchmark_runs SET version_label = ? WHERE id = ?").run(promotedVersionLabel, winnerRunId);
    }

    Logger.info(`[SELF-IMPROVEMENT] Decisão Final do Experimento #${exp.experimentNumber}: ${verdict} (${rationale})`);

    return {
      experiment: this.getExperiment(exp.id)!,
      candidateARun: runA,
      candidateBRun: runB,
      comparisonA: compA,
      comparisonB: compB,
      verdict,
      promotedVersionLabel
    };
  }

  /**
   * Executes a complete Real Agent Self-Improvement cycle (Level 2)
   * Candidate A vs Candidate B under the strict Promotion Contract & Governance Gate
   */
  static async executeAgentSelfImprovementCycle(params: {
    experimentId: string;
    contract?: PromotionContract;
    candidateA: {
      label: string;
      branch: string;
      strategy: string;
      commitSha: string;
    };
    candidateB?: {
      label: string;
      branch: string;
      strategy: string;
      commitSha: string;
    };
  }): Promise<{
    experiment: SelfImprovementExperimentData;
    candidateARun: AgentBenchmarkRunSummary;
    candidateBRun?: AgentBenchmarkRunSummary | null;
    promotionEvaluation: PromotionEvaluationResult;
    councilSynthesis?: CouncilTradeoffSynthesis | null;
    verdict: PromotionVerdict;
    winningCommitSha?: string;
    promotedVersionLabel?: string;
  }> {
    const exp = this.getExperiment(params.experimentId);
    if (!exp) throw new Error(`Experimento #${params.experimentId} não encontrado`);

    const baselineRun = BenchmarkManager.getBenchmarkRun(exp.baselineRunId);
    if (!baselineRun) throw new Error(`Baseline run #${exp.baselineRunId} não encontrado`);

    const contract = params.contract || createDefaultPromotionContract({
      targetMetricName: 'agent-bm-04-multifile.duration_ms',
      targetDirection: 'MINIMIZE',
      targetImprovementPct: 15.0,
      maxGlobalDurationIncreasePct: 3.0,
      maxIndividualDurationIncreasePct: 20.0
    });

    db.prepare("UPDATE self_improvement_experiments SET status = 'BENCHMARKING', benchmark_level = 'AGENT' WHERE id = ?").run(exp.id);
    Logger.info(`[SELF-IMPROVEMENT] Executando Level 2 Agent Benchmark para Candidate A (${params.candidateA.label}) sob Promotion Contract no Exp #${exp.experimentNumber}...`);

    // 1. Run Candidate A in isolated agent benchmark run
    const runA = await AgentBenchmarkManager.runFullAgentSuite({
      versionLabel: `self-improve-exp-${exp.experimentNumber}-cand-a`,
      gitCommit: params.candidateA.commitSha,
      isBaseline: false,
      model: 'flash'
    });

    db.prepare("UPDATE self_improvement_experiments SET status = 'EVALUATING' WHERE id = ?").run(exp.id);

    // 2. Promotion Gate Evaluation (Pareto Dominance + Regression Budget + Invariants)
    const promotionEvaluation = PromotionGate.evaluate({
      contract,
      baseline: baselineRun,
      candidate: runA
    });

    let councilSynthesis: CouncilTradeoffSynthesis | null = null;
    let finalVerdict: PromotionVerdict = promotionEvaluation.verdict;
    let winnerLabel: string | null = null;
    let winningCommitSha: string | null = null;
    let promotedVersionLabel: string | undefined = undefined;

    // 3. Tradeoff review with AI DEV Council if needed
    if (promotionEvaluation.verdict === 'TRADEOFF_REVIEW' && contract.requireCouncilApprovalOnTradeoff) {
      Logger.info(`[SELF-IMPROVEMENT] Veredito TRADEOFF_REVIEW acionado. Convocando AI DEV Council...`);
      councilSynthesis = PromotionCouncil.reviewTradeoff(promotionEvaluation);
      if (councilSynthesis.recommendation === 'KEEP') {
        finalVerdict = 'KEEP';
      } else {
        finalVerdict = 'TRADEOFF_REVIEW';
      }
    }

    if (finalVerdict === 'KEEP') {
      winnerLabel = params.candidateA.label;
      winningCommitSha = params.candidateA.commitSha;
      promotedVersionLabel = 'AI_DEV_AGENT_V2';
    }

    const completedAt = new Date().toISOString();
    db.prepare(`
      UPDATE self_improvement_experiments
      SET status = ?, candidate_a_score = ?, candidate_b_score = ?,
          winner_candidate = ?, verdict = ?, rationale = ?, completed_at = ?,
          winning_commit_sha = ?, promoted_version_label = ?,
          candidate_a_branch = ?, candidate_a_commit = ?,
          candidate_b_branch = ?, candidate_b_commit = ?,
          promotion_contract_json = ?, target_metric = ?,
          target_improvement_pct = ?, global_impact_pct = ?,
          original_verdict = ?, reevaluated_verdict = ?, council_recommendation = ?
      WHERE id = ?
    `).run(
      finalVerdict,
      runA.compositeScore,
      0,
      winnerLabel,
      finalVerdict,
      promotionEvaluation.rationale,
      completedAt,
      winningCommitSha,
      promotedVersionLabel || null,
      params.candidateA.branch,
      params.candidateA.commitSha,
      params.candidateB?.branch || null,
      params.candidateB?.commitSha || null,
      JSON.stringify(contract),
      contract.targetMetric.name,
      promotionEvaluation.targetMetric.actualImprovementPct,
      promotionEvaluation.globalImpact.deltaTotalDurationPct,
      finalVerdict,
      finalVerdict,
      councilSynthesis?.recommendation || null,
      exp.id
    );

    // If KEEP and promoted, update the winning candidate's benchmark run to the promoted version label
    if (finalVerdict === 'KEEP' && promotedVersionLabel) {
      db.prepare("UPDATE benchmark_runs SET version_label = ? WHERE id = ?").run(promotedVersionLabel, runA.id);
    }

    Logger.info(`[SELF-IMPROVEMENT] Decisão Final da Governança no Exp #${exp.experimentNumber}: ${finalVerdict} (${promotionEvaluation.rationale})`);

    return {
      experiment: this.getExperiment(exp.id)!,
      candidateARun: runA,
      candidateBRun: null,
      promotionEvaluation,
      councilSynthesis,
      verdict: finalVerdict,
      winningCommitSha: winningCommitSha || undefined,
      promotedVersionLabel
    };
  }

  /**
   * Retrospectively re-evaluates an experiment under the Promotion Gate & Contract
   * without mutating raw run data.
   */
  static reevaluateExperimentWithPromotionGate(
    experimentId: string,
    customContract?: PromotionContract
  ): {
    experiment: SelfImprovementExperimentData;
    evaluation: PromotionEvaluationResult;
    councilSynthesis?: CouncilTradeoffSynthesis | null;
    originalVerdict: string;
    reevaluatedVerdict: PromotionVerdict;
  } {
    const exp = this.getExperiment(experimentId);
    if (!exp) throw new Error(`Experimento #${experimentId} não encontrado`);

    const baselineRun = BenchmarkManager.getBenchmarkRun(exp.baselineRunId);
    if (!baselineRun) throw new Error(`Baseline run #${exp.baselineRunId} não encontrada`);

    // Find candidate run associated with this experiment
    const candRow: any = db.prepare(`
      SELECT id FROM benchmark_runs 
      WHERE (version_label = ? OR git_commit = ? OR version_label = 'AI_DEV_AGENT_V2' OR version_label LIKE '%CAND_A%')
        AND id != ?
      ORDER BY created_at DESC LIMIT 1
    `).get(exp.promotedVersionLabel || 'AI_DEV_AGENT_V2', exp.candidateACommit || '', exp.baselineRunId);

    if (!candRow) throw new Error('Run correspondente do candidato não encontrada no banco');
    const candRun = BenchmarkManager.getBenchmarkRun(candRow.id);
    if (!candRun) throw new Error('Dados do run do candidato não encontrados');

    const contract = customContract || createDefaultPromotionContract({
      targetMetricName: 'agent-bm-04-multifile.duration_ms',
      targetDirection: 'MINIMIZE',
      targetImprovementPct: 15.0,
      maxGlobalDurationIncreasePct: 3.0,
      maxIndividualDurationIncreasePct: 20.0
    });

    const evaluation = PromotionGate.evaluate({
      contract,
      baseline: baselineRun,
      candidate: candRun
    });

    let councilSynthesis: CouncilTradeoffSynthesis | null = null;
    if (evaluation.verdict === 'TRADEOFF_REVIEW') {
      councilSynthesis = PromotionCouncil.reviewTradeoff(evaluation);
    }

    const originalVerdict = exp.originalVerdict || exp.verdict || 'KEEP';
    const reevaluatedVerdict = evaluation.verdict;

    db.prepare(`
      UPDATE self_improvement_experiments
      SET promotion_contract_json = ?,
          target_metric = ?,
          target_improvement_pct = ?,
          global_impact_pct = ?,
          original_verdict = ?,
          reevaluated_verdict = ?,
          council_recommendation = ?
      WHERE id = ?
    `).run(
      JSON.stringify(contract),
      contract.targetMetric.name,
      evaluation.targetMetric.actualImprovementPct,
      evaluation.globalImpact.deltaTotalDurationPct,
      originalVerdict,
      reevaluatedVerdict,
      councilSynthesis?.recommendation || null,
      exp.id
    );

    return {
      experiment: this.getExperiment(exp.id)!,
      evaluation,
      councilSynthesis,
      originalVerdict,
      reevaluatedVerdict
    };
  }

  /**
   * Retrieves single experiment
   */
  static getExperiment(id: string): SelfImprovementExperimentData | null {
    const row: any = db.prepare('SELECT * FROM self_improvement_experiments WHERE id = ?').get(id);
    if (!row) return null;

    const baselineRun = row.baseline_run_id ? BenchmarkManager.getBenchmarkRun(row.baseline_run_id) : null;

    let promotionContract: PromotionContract | undefined = undefined;
    if (row.promotion_contract_json) {
      try { promotionContract = JSON.parse(row.promotion_contract_json); } catch {}
    }

    return {
      id: row.id,
      experimentNumber: row.experiment_number,
      hypothesis: row.hypothesis,
      bottleneckIdentified: row.bottleneck_identified,
      baselineRunId: row.baseline_run_id,
      status: row.status,
      benchmarkLevel: row.benchmark_level || 'FAST',
      candidateAScore: row.candidate_a_score,
      candidateBScore: row.candidate_b_score,
      winnerCandidate: row.winner_candidate,
      winningCommitSha: row.winning_commit_sha,
      promotedVersionLabel: row.promoted_version_label,
      candidateABranch: row.candidate_a_branch,
      candidateBBranch: row.candidate_b_branch,
      candidateACommit: row.candidate_a_commit,
      candidateBCommit: row.candidate_b_commit,
      verdict: row.verdict,
      rationale: row.rationale,
      promotionContract,
      targetMetric: row.target_metric,
      targetImprovementPct: row.target_improvement_pct,
      globalImpactPct: row.global_impact_pct,
      originalVerdict: row.original_verdict,
      reevaluatedVerdict: row.reevaluated_verdict,
      councilRecommendation: row.council_recommendation,
      createdAt: row.created_at,
      completedAt: row.completed_at,
      baselineRun
    };
  }

  /**
   * Lists all self-improvement experiments
   */
  static listExperiments(): SelfImprovementExperimentData[] {
    const rows: any[] = db.prepare('SELECT id FROM self_improvement_experiments ORDER BY experiment_number DESC').all();
    return rows.map(r => this.getExperiment(r.id)!);
  }
}
