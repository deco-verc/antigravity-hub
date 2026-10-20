// server/src/promotionGate.ts
// Promotion Gate Engine with Pareto Dominance, Regression Budget & Honest Veridicts

import { PromotionContract } from './promotionContract.js';

export type PromotionVerdict = 
  | 'KEEP' 
  | 'DISCARD' 
  | 'TRADEOFF_REVIEW' 
  | 'REGRESSION_REJECTED' 
  | 'INSUFFICIENT_EVIDENCE';

export interface TaskMetricsComparison {
  taskId: string;
  title: string;
  baselineDurationMs: number;
  candidateDurationMs: number;
  deltaDurationMs: number;
  deltaDurationPct: number;
  isTarget: boolean;
  baselineStatus: string;
  candidateStatus: string;
  statusRegressed: boolean;
  exceededIndividualBudget: boolean;
}

export interface PromotionEvaluationResult {
  verdict: PromotionVerdict;
  rationale: string;
  contract: PromotionContract;
  targetMetric: {
    name: string;
    direction: 'MINIMIZE' | 'MAXIMIZE';
    requiredImprovementPct: number;
    actualImprovementPct: number;
    baselineValue: number;
    candidateValue: number;
    achieved: boolean;
  };
  globalImpact: {
    baselineTotalDurationMs: number;
    candidateTotalDurationMs: number;
    deltaTotalDurationMs: number;
    deltaTotalDurationPct: number;
    baselineAvgDurationMs: number;
    candidateAvgDurationMs: number;
    baselineMedianDurationMs: number;
    candidateMedianDurationMs: number;
    baselineP95DurationMs: number;
    candidateP95DurationMs: number;
    exceededGlobalBudget: boolean;
  };
  invariants: {
    correctnessFloorPassed: boolean;
    surgicalFloorPassed: boolean;
    simplicityFloorPassed: boolean;
    zeroProtectedFailures: boolean;
  };
  taskComparisons: TaskMetricsComparison[];
  regressionsCount: number;
  collateralRegressions: string[];
  evaluatedAt: string;
}

export class PromotionGate {
  /**
   * Helper: Calculates consistent statistics from an array of numbers
   */
  static calculateStats(values: number[]): { sum: number; avg: number; median: number; p95: number } {
    if (!values || values.length === 0) return { sum: 0, avg: 0, median: 0, p95: 0 };
    const sum = values.reduce((acc, v) => acc + v, 0);
    const avg = Number((sum / values.length).toFixed(1));
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 !== 0 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
    const p95Idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
    const p95 = sorted[p95Idx];
    return { sum, avg, median, p95 };
  }

  /**
   * Evaluates a candidate against baseline under the PromotionContract
   */
  static evaluate(params: {
    contract: PromotionContract;
    baseline: any; // BenchmarkRunSummary | AgentBenchmarkRunSummary
    candidate: any; // BenchmarkRunSummary | AgentBenchmarkRunSummary
  }): PromotionEvaluationResult {
    const { contract, baseline, candidate } = params;
    const nowIso = new Date().toISOString();

    const baseResults: any[] = baseline.results || [];
    const candResults: any[] = candidate.results || [];

    const baseDurations = baseResults.map(r => r.durationMs || 0);
    const candDurations = candResults.map(r => r.durationMs || 0);

    const baseStats = this.calculateStats(baseDurations);
    const candStats = this.calculateStats(candDurations);

    // If overall stats not populated in run row, use consistent computed stats
    const baseTotalDuration = baseStats.sum;
    const candTotalDuration = candStats.sum;
    const deltaTotalDurationMs = candTotalDuration - baseTotalDuration;
    const deltaTotalDurationPct = baseTotalDuration > 0
      ? Number(((deltaTotalDurationMs / baseTotalDuration) * 100).toFixed(2))
      : 0;

    const baseMap = new Map<string, any>(baseResults.map(r => [r.taskId, r]));
    const candMap = new Map<string, any>(candResults.map(r => [r.taskId, r]));

    const allTaskIds = Array.from(new Set([...baseMap.keys(), ...candMap.keys()]));
    const taskComparisons: TaskMetricsComparison[] = [];
    const collateralRegressions: string[] = [];

    // 1. Per-task comparisons
    for (const taskId of allTaskIds) {
      const bTask = baseMap.get(taskId);
      const cTask = candMap.get(taskId);

      const bDur = bTask?.durationMs || 0;
      const cDur = cTask?.durationMs || 0;
      const deltaDurMs = cDur - bDur;
      const deltaDurPct = bDur > 0 ? Number(((deltaDurMs / bDur) * 100).toFixed(2)) : 0;

      const isTarget = contract.targetMetric.name.includes(taskId);
      const bStatus = bTask?.status || 'UNKNOWN';
      const cStatus = cTask?.status || 'UNKNOWN';

      const statusRegressed = bStatus === 'PASS' && cStatus !== 'PASS';
      const exceededIndividualBudget = !isTarget && deltaDurPct > contract.regressionBudget.maxIndividualBenchmarkDurationIncreasePct;

      if (statusRegressed) {
        collateralRegressions.push(`Falha funcional na tarefa ${taskId}: ${bStatus} -> ${cStatus}`);
      } else if (exceededIndividualBudget) {
        collateralRegressions.push(`Degradação de latência em ${taskId}: +${deltaDurPct}% (+${(deltaDurMs / 1000).toFixed(1)}s)`);
      }

      taskComparisons.push({
        taskId,
        title: cTask?.title || bTask?.title || taskId,
        baselineDurationMs: bDur,
        candidateDurationMs: cDur,
        deltaDurationMs: deltaDurMs,
        deltaDurationPct: deltaDurPct,
        isTarget,
        baselineStatus: bStatus,
        candidateStatus: cStatus,
        statusRegressed,
        exceededIndividualBudget
      });
    }

    // 2. Invariants evaluation
    const correctnessFloorPassed = candidate.passRate >= (contract.invariantMetrics.find(m => m.name === 'pass_rate')?.minimumFloor || 100.0);
    const noFunctionalRegressions = taskComparisons.filter(t => t.statusRegressed).length === 0;
    const noTampering = candResults.every(r => r.status !== 'TAMPERED');
    const zeroProtectedFailures = noFunctionalRegressions && noTampering;

    const baseSurgical = baseline.avgSurgicalScore ?? 100;
    const candSurgical = candidate.avgSurgicalScore ?? 100;
    const surgicalDrop = baseSurgical - candSurgical;
    const surgicalFloorPassed = surgicalDrop <= contract.regressionBudget.maxSurgicalDropPct;

    const baseSimplicity = baseline.avgSimplicityScore ?? 10;
    const candSimplicity = candidate.avgSimplicityScore ?? 10;
    const simplicityDrop = baseSimplicity - candSimplicity;
    const simplicityFloorPassed = simplicityDrop <= contract.regressionBudget.maxSimplicityDrop;

    // 3. Target Metric Evaluation
    let baselineTargetVal = 0;
    let candidateTargetVal = 0;

    const targetName = contract.targetMetric.name;
    if (targetName === 'total_suite_duration_ms') {
      baselineTargetVal = baseTotalDuration;
      candidateTargetVal = candTotalDuration;
    } else if (targetName === 'avg_time_ms') {
      baselineTargetVal = baseStats.avg;
      candidateTargetVal = candStats.avg;
    } else {
      // Per-task metric (e.g. agent-bm-04-multifile.duration_ms)
      const matchingTaskComp = taskComparisons.find(t => targetName.includes(t.taskId));
      if (matchingTaskComp) {
        baselineTargetVal = matchingTaskComp.baselineDurationMs;
        candidateTargetVal = matchingTaskComp.candidateDurationMs;
      } else {
        baselineTargetVal = baseTotalDuration;
        candidateTargetVal = candTotalDuration;
      }
    }

    let actualImprovementPct = 0;
    if (contract.targetMetric.direction === 'MINIMIZE') {
      actualImprovementPct = baselineTargetVal > 0
        ? Number((((baselineTargetVal - candidateTargetVal) / baselineTargetVal) * 100).toFixed(2))
        : 0;
    } else {
      actualImprovementPct = baselineTargetVal > 0
        ? Number((((candidateTargetVal - baselineTargetVal) / baselineTargetVal) * 100).toFixed(2))
        : 0;
    }

    const targetAchieved = actualImprovementPct >= contract.targetMetric.minimumImprovementPct;
    const exceededGlobalBudget = deltaTotalDurationPct > contract.regressionBudget.maxGlobalSuiteDurationIncreasePct;
    const individualRegressionsCount = taskComparisons.filter(t => t.exceededIndividualBudget).length;

    // 4. Decision Engine (Pareto Dominance & Gating)
    let verdict: PromotionVerdict = 'DISCARD';
    let rationale = '';

    // RULE 1: CORRECTNESS É ABSOLUTO (Sem negociação)
    if (!correctnessFloorPassed || !zeroProtectedFailures) {
      verdict = 'REGRESSION_REJECTED';
      rationale = `❌ REGRESSION_REJECTED: Piso absoluto de corretude violado. Pass Rate = ${candidate.passRate}% (mínimo exigido: 100%) ou falhas em testes protegidos detectadas (${collateralRegressions.filter(r => r.includes('Falha funcional')).join('; ')}).`;
    } 
    // RULE 2: INVARIANTES KARPATHY VIOLADOS
    else if (!surgicalFloorPassed || !simplicityFloorPassed) {
      verdict = 'REGRESSION_REJECTED';
      rationale = `❌ REGRESSION_REJECTED: Invariantes centrais violados. Queda Cirúrgica: ${surgicalDrop}% (máximo permitido: ${contract.regressionBudget.maxSurgicalDropPct}%) ou Queda de Simplicidade: ${simplicityDrop}pts.`;
    }
    // RULE 3: TARGET METRIC NÃO ALCANÇOU O MÍNIMO EXIGIDO
    else if (!targetAchieved) {
      verdict = 'INSUFFICIENT_EVIDENCE';
      rationale = `⚠️ INSUFFICIENT_EVIDENCE: A métrica alvo "${contract.targetMetric.name}" melhorou apenas ${actualImprovementPct}%, abaixo do limiar contratual mínimo de ${contract.targetMetric.minimumImprovementPct}%. Evidência insuficiente para justificar promoção de versão.`;
    }
    // RULE 4: PARETO TRADEOFF CHECK (Melhoria local alcançada, mas causou regressão global ou colateral acima do orçamento)
    else if (exceededGlobalBudget || individualRegressionsCount > 0) {
      verdict = 'TRADEOFF_REVIEW';
      rationale = `⚖️ TRADEOFF_REVIEW: A métrica alvo "${contract.targetMetric.name}" alcançou ${actualImprovementPct}% de melhoria (meta: >= ${contract.targetMetric.minimumImprovementPct}%), porém causou regressão colateral relevante: Duração Global aumentou +${deltaTotalDurationPct}% (orçamento: +${contract.regressionBudget.maxGlobalSuiteDurationIncreasePct}%) ou ${individualRegressionsCount} tarefas não-alvo sofreram degradação superior a +${contract.regressionBudget.maxIndividualBenchmarkDurationIncreasePct}%. Promoção automática bloqueada; submetido a Tradeoff Review pelo AI DEV Council.`;
    }
    // RULE 5: PARETO DOMINANCE ESTRITA (Alcançou alvo + respeitou orçamento + zero regressões)
    else {
      verdict = 'KEEP';
      rationale = `🏆 KEEP (Pareto Dominance): A métrica alvo "${contract.targetMetric.name}" melhorou expressivamente em ${actualImprovementPct}% (meta: >= ${contract.targetMetric.minimumImprovementPct}%), com zero regressões funcionais, invariantes 100% preservados e impacto global rigorosamente dentro do Regression Budget (Δ Total: ${deltaTotalDurationPct}% <= +${contract.regressionBudget.maxGlobalSuiteDurationIncreasePct}%). Versão aprovada para promoção.`;
    }

    return {
      verdict,
      rationale,
      contract,
      targetMetric: {
        name: contract.targetMetric.name,
        direction: contract.targetMetric.direction,
        requiredImprovementPct: contract.targetMetric.minimumImprovementPct,
        actualImprovementPct,
        baselineValue: baselineTargetVal,
        candidateValue: candidateTargetVal,
        achieved: targetAchieved
      },
      globalImpact: {
        baselineTotalDurationMs: baseTotalDuration,
        candidateTotalDurationMs: candTotalDuration,
        deltaTotalDurationMs,
        deltaTotalDurationPct,
        baselineAvgDurationMs: baseStats.avg,
        candidateAvgDurationMs: candStats.avg,
        baselineMedianDurationMs: baseStats.median,
        candidateMedianDurationMs: candStats.median,
        baselineP95DurationMs: baseStats.p95,
        candidateP95DurationMs: candStats.p95,
        exceededGlobalBudget
      },
      invariants: {
        correctnessFloorPassed,
        surgicalFloorPassed,
        simplicityFloorPassed,
        zeroProtectedFailures
      },
      taskComparisons,
      regressionsCount: collateralRegressions.length,
      collateralRegressions,
      evaluatedAt: nowIso
    };
  }
}
