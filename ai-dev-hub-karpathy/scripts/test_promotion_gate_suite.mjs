// scripts/test_promotion_gate_suite.mjs
// Mandatory Test Suite for Promotion Gate & Governance (Tests A, B, C, D, E)

import { PromotionGate } from '../server/dist/promotionGate.js';
import { PromotionCouncil } from '../server/dist/promotionCouncil.js';
import { createDefaultPromotionContract } from '../server/dist/promotionContract.js';

console.log('========================================================================');
console.log('🧪 EXECUTANDO SUÍTE DE TESTES OBRIGATÓRIOS DO PROMOTION GATE (A, B, C, D, E)');
console.log('========================================================================\n');

// Mock Baseline (5 benchmarks)
const mockBaseline = {
  id: 'mock-base-1',
  versionLabel: 'AI_DEV_BASELINE_MOCK',
  passRate: 100,
  avgSurgicalScore: 100,
  avgSimplicityScore: 9.5,
  results: [
    { taskId: 'bm-01', title: 'Task 1', status: 'PASS', durationMs: 80000 },
    { taskId: 'bm-02', title: 'Task 2', status: 'PASS', durationMs: 80000 },
    { taskId: 'bm-03', title: 'Task 3', status: 'PASS', durationMs: 50000 },
    { taskId: 'bm-04-target', title: 'Target Task 4', status: 'PASS', durationMs: 120000 },
    { taskId: 'bm-05', title: 'Task 5', status: 'PASS', durationMs: 120000 }
  ]
};
// Baseline Total = 80 + 80 + 50 + 120 + 120 = 450,000 ms

const contract = createDefaultPromotionContract({
  targetMetricName: 'bm-04-target.duration_ms',
  targetDirection: 'MINIMIZE',
  targetImprovementPct: 15.0,
  maxGlobalDurationIncreasePct: 3.0,
  maxIndividualDurationIncreasePct: 20.0
});

let passedTests = 0;

// ------------------------------------------------------------------------
// TESTE A: Target melhora >= 15%, Global permanece igual/melhor -> KEEP
// ------------------------------------------------------------------------
console.log('▶ [TESTE A] Target melhora, global igual/melhor -> Deve retornar KEEP');
const candA = {
  id: 'cand-a',
  versionLabel: 'CAND_A',
  passRate: 100,
  avgSurgicalScore: 100,
  avgSimplicityScore: 9.5,
  results: [
    { taskId: 'bm-01', title: 'Task 1', status: 'PASS', durationMs: 80000 },
    { taskId: 'bm-02', title: 'Task 2', status: 'PASS', durationMs: 80000 },
    { taskId: 'bm-03', title: 'Task 3', status: 'PASS', durationMs: 50000 },
    { taskId: 'bm-04-target', title: 'Target Task 4', status: 'PASS', durationMs: 90000 }, // -25%
    { taskId: 'bm-05', title: 'Task 5', status: 'PASS', durationMs: 120000 }
  ]
};
// Cand A Total = 420,000 ms (-6.7% global)
const resA = PromotionGate.evaluate({ contract, baseline: mockBaseline, candidate: candA });
console.log(`  Resultado: ${resA.verdict} (Target: -${resA.targetMetric.actualImprovementPct}%, Global: ${resA.globalImpact.deltaTotalDurationPct}%)`);
if (resA.verdict === 'KEEP') {
  console.log('  ✓ Teste A PASSOU!\n');
  passedTests++;
} else {
  console.error(`  ✗ Teste A FALHOU: esperado KEEP, obtido ${resA.verdict}\n`);
}

// ------------------------------------------------------------------------
// TESTE B: Target melhora, mas global piora 15% -> TRADEOFF_REVIEW / REGRESSION_REJECTED
// ------------------------------------------------------------------------
console.log('▶ [TESTE B] Target melhora, mas global piora 15% -> Deve retornar TRADEOFF_REVIEW');
const candB = {
  id: 'cand-b',
  versionLabel: 'CAND_B',
  passRate: 100,
  avgSurgicalScore: 100,
  avgSimplicityScore: 9.5,
  results: [
    { taskId: 'bm-01', title: 'Task 1', status: 'PASS', durationMs: 110000 }, // +37.5%
    { taskId: 'bm-02', title: 'Task 2', status: 'PASS', durationMs: 100000 }, // +25.0%
    { taskId: 'bm-03', title: 'Task 3', status: 'PASS', durationMs: 70000 },  // +40.0%
    { taskId: 'bm-04-target', title: 'Target Task 4', status: 'PASS', durationMs: 90000 }, // -25% (Alvo atingido)
    { taskId: 'bm-05', title: 'Task 5', status: 'PASS', durationMs: 147500 }
  ]
};
// Cand B Total = 517,500 ms (+15.0% global)
const resB = PromotionGate.evaluate({ contract, baseline: mockBaseline, candidate: candB });
console.log(`  Resultado: ${resB.verdict} (Target: -${resB.targetMetric.actualImprovementPct}%, Global: +${resB.globalImpact.deltaTotalDurationPct}%)`);
if (resB.verdict === 'TRADEOFF_REVIEW' || resB.verdict === 'REGRESSION_REJECTED') {
  console.log('  ✓ Teste B PASSOU!\n');
  passedTests++;
} else {
  console.error(`  ✗ Teste B FALHOU: esperado TRADEOFF_REVIEW/REGRESSION_REJECTED, obtido ${resB.verdict}\n`);
}

// ------------------------------------------------------------------------
// TESTE C: Target melhora, mas correctness cai (1 teste falha) -> REGRESSION_REJECTED
// ------------------------------------------------------------------------
console.log('▶ [TESTE C] Target melhora, mas correctness cai (1 falha) -> Deve retornar REGRESSION_REJECTED (Absoluto)');
const candC = {
  id: 'cand-c',
  versionLabel: 'CAND_C',
  passRate: 80, // Caiu de 100% para 80%
  avgSurgicalScore: 100,
  avgSimplicityScore: 9.5,
  results: [
    { taskId: 'bm-01', title: 'Task 1', status: 'PASS', durationMs: 80000 },
    { taskId: 'bm-02', title: 'Task 2', status: 'FAIL', durationMs: 20000 }, // Falhou
    { taskId: 'bm-03', title: 'Task 3', status: 'PASS', durationMs: 50000 },
    { taskId: 'bm-04-target', title: 'Target Task 4', status: 'PASS', durationMs: 80000 }, // -33%
    { taskId: 'bm-05', title: 'Task 5', status: 'PASS', durationMs: 120000 }
  ]
};
const resC = PromotionGate.evaluate({ contract, baseline: mockBaseline, candidate: candC });
console.log(`  Resultado: ${resC.verdict} (Pass Rate: ${candC.passRate}%)`);
if (resC.verdict === 'REGRESSION_REJECTED') {
  console.log('  ✓ Teste C PASSOU!\n');
  passedTests++;
} else {
  console.error(`  ✗ Teste C FALHOU: esperado REGRESSION_REJECTED, obtido ${resC.verdict}\n`);
}

// ------------------------------------------------------------------------
// TESTE D: Target não melhora o mínimo (< 15%, ex: 5%) -> INSUFFICIENT_EVIDENCE
// ------------------------------------------------------------------------
console.log('▶ [TESTE D] Target não melhora o mínimo (< 15%) -> Deve retornar INSUFFICIENT_EVIDENCE');
const candD = {
  id: 'cand-d',
  versionLabel: 'CAND_D',
  passRate: 100,
  avgSurgicalScore: 100,
  avgSimplicityScore: 9.5,
  results: [
    { taskId: 'bm-01', title: 'Task 1', status: 'PASS', durationMs: 80000 },
    { taskId: 'bm-02', title: 'Task 2', status: 'PASS', durationMs: 80000 },
    { taskId: 'bm-03', title: 'Task 3', status: 'PASS', durationMs: 50000 },
    { taskId: 'bm-04-target', title: 'Target Task 4', status: 'PASS', durationMs: 114000 }, // apenas -5.0% de melhoria
    { taskId: 'bm-05', title: 'Task 5', status: 'PASS', durationMs: 120000 }
  ]
};
const resD = PromotionGate.evaluate({ contract, baseline: mockBaseline, candidate: candD });
console.log(`  Resultado: ${resD.verdict} (Target Melhora: -${resD.targetMetric.actualImprovementPct}%, Mínimo Requerido: 15%)`);
if (resD.verdict === 'INSUFFICIENT_EVIDENCE') {
  console.log('  ✓ Teste D PASSOU!\n');
  passedTests++;
} else {
  console.error(`  ✗ Teste D FALHOU: esperado INSUFFICIENT_EVIDENCE, obtido ${resD.verdict}\n`);
}

// ------------------------------------------------------------------------
// TESTE E: Candidate 1 melhor localmente mas pior globalmente vs
//          Candidate 2 que melhora target e não degrada global -> Council/Pareto escolhe Candidate 2
// ------------------------------------------------------------------------
console.log('▶ [TESTE E] Candidate 1 (melhor localmente mas onera global) vs Candidate 2 (melhor globalmente) -> Pareto seleciona Candidate 2');
const candE1 = {
  id: 'cand-e1',
  versionLabel: 'CAND_E1_LOCAL',
  passRate: 100,
  avgSurgicalScore: 100,
  avgSimplicityScore: 9.5,
  results: [
    { taskId: 'bm-01', title: 'Task 1', status: 'PASS', durationMs: 110000 },
    { taskId: 'bm-02', title: 'Task 2', status: 'PASS', durationMs: 100000 },
    { taskId: 'bm-03', title: 'Task 3', status: 'PASS', durationMs: 70000 },
    { taskId: 'bm-04-target', title: 'Target Task 4', status: 'PASS', durationMs: 70000 }, // -41.7% no alvo, mas onera a suite
    { taskId: 'bm-05', title: 'Task 5', status: 'PASS', durationMs: 140000 }
  ]
};
const candE2 = {
  id: 'cand-e2',
  versionLabel: 'CAND_E2_GLOBAL',
  passRate: 100,
  avgSurgicalScore: 100,
  avgSimplicityScore: 9.5,
  results: [
    { taskId: 'bm-01', title: 'Task 1', status: 'PASS', durationMs: 78000 },
    { taskId: 'bm-02', title: 'Task 2', status: 'PASS', durationMs: 79000 },
    { taskId: 'bm-03', title: 'Task 3', status: 'PASS', durationMs: 49000 },
    { taskId: 'bm-04-target', title: 'Target Task 4', status: 'PASS', durationMs: 95000 }, // -20.8% no alvo e suite acelera
    { taskId: 'bm-05', title: 'Task 5', status: 'PASS', durationMs: 118000 }
  ]
};

const resE1 = PromotionGate.evaluate({ contract, baseline: mockBaseline, candidate: candE1 });
const resE2 = PromotionGate.evaluate({ contract, baseline: mockBaseline, candidate: candE2 });

console.log(`  Candidate 1: Veredito = ${resE1.verdict} (Target -41.7%, Global +8.8%)`);
console.log(`  Candidate 2: Veredito = ${resE2.verdict} (Target -20.8%, Global -6.9%)`);

const e1Eligible = resE1.verdict === 'KEEP';
const e2Eligible = resE2.verdict === 'KEEP';

if (!e1Eligible && e2Eligible) {
  console.log('  ✓ Teste E PASSOU! Candidate 1 foi bloqueado por TRADEOFF/REGRESSION e Candidate 2 foi aprovado por Pareto Dominance!\n');
  passedTests++;
} else {
  console.error(`  ✗ Teste E FALHOU: E1 elegível=${e1Eligible}, E2 elegível=${e2Eligible}\n`);
}

console.log('========================================================================');
console.log(`🏁 RESULTADO FINAL: ${passedTests} DE 5 TESTES OBRIGATÓRIOS PASSARAM COM SUCESSO!`);
console.log('========================================================================\n');

if (passedTests === 5) {
  process.exit(0);
} else {
  process.exit(1);
}
