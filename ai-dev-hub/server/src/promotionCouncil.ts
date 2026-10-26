// server/src/promotionCouncil.ts
// AI DEV Council Tradeoff Evaluator for Promotion Gate TRADEOFF_REVIEW verdicts

import { PromotionEvaluationResult } from './promotionGate.js';

export interface CouncilReviewMemberOpinion {
  reviewer: string;
  role: string;
  verdict: 'KEEP' | 'DISCARD' | 'HUMAN_REVIEW';
  argument: string;
}

export interface CouncilTradeoffPeerRanking {
  reviewer: string;
  rankedReviewers: string[];
  rationale: string;
}

export interface CouncilTradeoffSynthesis {
  recommendation: 'KEEP' | 'DISCARD' | 'HUMAN_REVIEW';
  chairmanVerdict: string;
  chairmanRationale: string;
  isAutonomousPromotable: boolean; // Strictly false if HUMAN_REVIEW or DISCARD
  memberOpinions: CouncilReviewMemberOpinion[];
  peerRankings?: CouncilTradeoffPeerRanking[];
  evaluatedAt: string;
}

export class PromotionCouncil {
  /**
   * Synthesizes a formal Council review for TRADEOFF_REVIEW situations
   */
  static reviewTradeoff(evaluation: PromotionEvaluationResult): CouncilTradeoffSynthesis {
    const { targetMetric, globalImpact, collateralRegressions } = evaluation;

    const targetGain = targetMetric.actualImprovementPct;
    const globalRegress = globalImpact.deltaTotalDurationPct;

    // Reviewer A: Performance & Target Advocate
    const opinionA: CouncilReviewMemberOpinion = {
      reviewer: 'Reviewer A',
      role: 'Domain Specialist (Target Performance)',
      verdict: targetGain >= 25.0 && globalRegress <= 10.0 ? 'HUMAN_REVIEW' : 'DISCARD',
      argument: `O ganho na métrica alvo (${targetMetric.name}) foi expressivo (-${targetGain.toFixed(1)}%). No entanto, otimizações locais que oneram a suíte inteira demandam cautela extrema.`
    };

    // Reviewer B: Architectural Integrity & Karpathy Guardian
    const opinionB: CouncilReviewMemberOpinion = {
      reviewer: 'Reviewer B',
      role: 'Architectural Integrity (Simplicity & Scope)',
      verdict: 'DISCARD',
      argument: `Rejeição preventiva recomendada. A alteração no prompt/guidelines causou sobrecarga cognitiva no modelo em tarefas menores (${collateralRegressions.join('; ')}). O princípio Karpathy "Surgical Changes" foi violado em nível comportamental.`
    };

    // Reviewer C: Product Reliability & User Experience
    const opinionC: CouncilReviewMemberOpinion = {
      reviewer: 'Reviewer C',
      role: 'Daily Product Reliability (DX & Latency)',
      verdict: globalRegress > 5.0 ? 'DISCARD' : 'HUMAN_REVIEW',
      argument: `No uso diário do Simple IDE, um acréscimo global de +${globalRegress.toFixed(1)}% (+${(globalImpact.deltaTotalDurationMs / 1000).toFixed(1)}s) no tempo total de execução prejudica a experiência em tarefas simples mais do que beneficia cenários isolados.`
    };

    // Stage 2: Peer ranking across tradeoff perspectives
    const peerRankings: CouncilTradeoffPeerRanking[] = [
      {
        reviewer: 'Reviewer A',
        rankedReviewers: ['Reviewer B', 'Reviewer C'],
        rationale: 'Reviewer B ofereceu critério mais conservador para integridade sistêmica.'
      },
      {
        reviewer: 'Reviewer B',
        rankedReviewers: ['Reviewer C', 'Reviewer A'],
        rationale: 'Reviewer C mensurou o impacto prático em latência do produto real.'
      },
      {
        reviewer: 'Reviewer C',
        rankedReviewers: ['Reviewer B', 'Reviewer A'],
        rationale: 'Reviewer B diagnosticou corretamente o risco de overengineering nos prompts.'
      }
    ];

    // Chairman Synthesis
    let recommendation: 'KEEP' | 'DISCARD' | 'HUMAN_REVIEW' = 'DISCARD';
    let chairmanRationale = '';

    if (globalRegress > 5.0 || collateralRegressions.length >= 2) {
      recommendation = 'DISCARD';
      chairmanRationale = `O AI DEV Council deliberou pelo DESCARTE (DISCARD). Embora a métrica alvo "${targetMetric.name}" tenha melhorado ${targetGain.toFixed(1)}%, a degradação colateral global de +${globalRegress.toFixed(1)}% na suíte excede o limite aceitável de risco arquitetural. Promoção bloqueada para proteger a estabilidade do sistema.`;
    } else if (targetGain >= 50.0 && globalRegress <= 1.0) {
      recommendation = 'KEEP';
      chairmanRationale = `O AI DEV Council deliberou pela APROVAÇÃO (KEEP) com ganho massivo na métrica alvo (+${targetGain.toFixed(1)}%) e impacto global residual (+${globalRegress.toFixed(1)}%).`;
    } else {
      recommendation = 'HUMAN_REVIEW';
      chairmanRationale = `O AI DEV Council considerou o tradeoff equilibrado e solicitou REVISÃO HUMANA (HUMAN_REVIEW). Em modo de governança autônoma estrita, a promoção para produção permanece BLOQUEADA até confirmação explícita do desenvolvedor.`;
    }

    return {
      recommendation,
      chairmanVerdict: recommendation,
      chairmanRationale,
      isAutonomousPromotable: recommendation === 'KEEP',
      memberOpinions: [opinionA, opinionB, opinionC],
      peerRankings,
      evaluatedAt: new Date().toISOString()
    };
  }
}
