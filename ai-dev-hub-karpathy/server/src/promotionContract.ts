// server/src/promotionContract.ts
// Promotion Contract & Regression Budget Schema for AI DEV Self-Improvement

export type MetricDirection = 'MINIMIZE' | 'MAXIMIZE';

export interface TargetMetricDefinition {
  name: string; // e.g. 'agent-bm-04-multifile.duration_ms', 'total_suite_duration_ms', 'avg_time_ms'
  direction: MetricDirection;
  minimumImprovementPct: number; // e.g. 15.0 for 15%
  description?: string;
}

export interface InvariantMetricRule {
  name: string; // e.g. 'pass_rate', 'surgical_score', 'simplicity_score'
  minimumFloor?: number; // absolute floor required (e.g. 100 for pass_rate)
  maxAllowedRegressionPct?: number; // max allowable degradation relative to baseline (e.g. 0% for pass_rate, 2% for surgical)
  description?: string;
}

export interface RegressionBudget {
  maxCorrectnessRegressionPct: number; // Strictly 0.0%
  maxProtectedFailures: number; // Strictly 0
  maxSurgicalDropPct: number; // e.g. 2.0%
  maxSimplicityDrop: number; // e.g. 0.3 points
  maxGlobalSuiteDurationIncreasePct: number; // e.g. 3.0%
  maxIndividualBenchmarkDurationIncreasePct: number; // e.g. 20.0% for non-target benchmarks
}

export interface StatisticalPolicy {
  runsCount: number; // e.g. 1 or 3
  metricAggregator: 'MEAN' | 'MEDIAN' | 'P50' | 'TRIMMED_MEAN';
  varianceTolerancePct: number; // e.g. 5.0%
}

export interface PromotionContract {
  id: string;
  experimentId?: string;
  title: string;
  targetMetric: TargetMetricDefinition;
  invariantMetrics: InvariantMetricRule[];
  regressionBudget: RegressionBudget;
  statisticalPolicy?: StatisticalPolicy;
  requireHoldoutsPass: boolean;
  requireCouncilApprovalOnTradeoff: boolean;
  createdAt: string;
}

/**
 * Creates a default, rigorous Promotion Contract for Software Engineering Self-Improvement
 */
export function createDefaultPromotionContract(opts?: {
  targetMetricName?: string;
  targetDirection?: MetricDirection;
  targetImprovementPct?: number;
  maxGlobalDurationIncreasePct?: number;
  maxIndividualDurationIncreasePct?: number;
}): PromotionContract {
  return {
    id: `contract-${Date.now()}`,
    title: 'Standard Autonomous Self-Improvement Promotion Contract',
    targetMetric: {
      name: opts?.targetMetricName || 'total_suite_duration_ms',
      direction: opts?.targetDirection || 'MINIMIZE',
      minimumImprovementPct: opts?.targetImprovementPct ?? 15.0,
      description: 'Métrica alvo que a hipótese formulada visa otimizar comprovadamente'
    },
    invariantMetrics: [
      {
        name: 'pass_rate',
        minimumFloor: 100.0,
        maxAllowedRegressionPct: 0.0,
        description: 'Corretude obrigatória: 100% de testes devem passar sem regressão'
      },
      {
        name: 'surgical_score',
        minimumFloor: 95.0,
        maxAllowedRegressionPct: 2.0,
        description: 'Disciplina cirúrgica Karpathy: modificações apenas em arquivos permitidos'
      },
      {
        name: 'simplicity_score',
        minimumFloor: 8.5,
        maxAllowedRegressionPct: 0.3,
        description: 'Simplicidade First: código conciso sem overengineering'
      }
    ],
    regressionBudget: {
      maxCorrectnessRegressionPct: 0.0,
      maxProtectedFailures: 0,
      maxSurgicalDropPct: 2.0,
      maxSimplicityDrop: 0.3,
      maxGlobalSuiteDurationIncreasePct: opts?.maxGlobalDurationIncreasePct ?? 3.0,
      maxIndividualBenchmarkDurationIncreasePct: opts?.maxIndividualDurationIncreasePct ?? 20.0
    },
    statisticalPolicy: {
      runsCount: 1,
      metricAggregator: 'MEDIAN',
      varianceTolerancePct: 5.0
    },
    requireHoldoutsPass: true,
    requireCouncilApprovalOnTradeoff: true,
    createdAt: new Date().toISOString()
  };
}
