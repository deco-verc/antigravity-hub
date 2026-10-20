// scripts/reevaluate_exp5.mjs
// Retrospective Re-evaluation of Experiment #5 under the new Promotion Gate

import { db } from '../server/dist/db.js';
import { SelfImprovementManager } from '../server/dist/selfImprovementManager.js';
import { createDefaultPromotionContract } from '../server/dist/promotionContract.js';

console.log('========================================================================');
console.log('🔍 REAVALIAÇÃO RETROSPECTIVA DO EXPERIMENTO #5 (PROMOTION GATE)');
console.log('========================================================================\n');

// 1. Locate Experiment #5
const expRow = db.prepare(`
  SELECT * FROM self_improvement_experiments 
  ORDER BY experiment_number DESC LIMIT 1
`).get();

if (!expRow) {
  console.error('Nenhum experimento encontrado.');
  process.exit(1);
}

console.log(`Experimento Encontrado: #${expRow.experiment_number} (ID: ${expRow.id})`);
console.log(`Hipótese: "${expRow.hypothesis}"`);
console.log(`Veredito Original Histórico: ${expRow.verdict}`);
console.log(`Commit do Candidato: ${expRow.candidate_a_commit || expRow.winning_commit_sha}\n`);

// 2. Define strict PromotionContract
const contract = createDefaultPromotionContract({
  targetMetricName: 'agent-bm-04-multifile.duration_ms',
  targetDirection: 'MINIMIZE',
  targetImprovementPct: 15.0,
  maxGlobalDurationIncreasePct: 3.0,
  maxIndividualDurationIncreasePct: 20.0
});

console.log('--- CONTRATO DE PROMOÇÃO ATIVADO ---');
console.log(`- Métrica Alvo: ${contract.targetMetric.name} (Meta: >= ${contract.targetMetric.minimumImprovementPct}% de redução)`);
console.log(`- Teto de Regressão Global da Suíte: +${contract.regressionBudget.maxGlobalSuiteDurationIncreasePct}%`);
console.log(`- Teto de Regressão Individual Não-Alvo: +${contract.regressionBudget.maxIndividualBenchmarkDurationIncreasePct}%`);
console.log(`- Piso de Corretude: ${contract.invariantMetrics.find(m => m.name === 'pass_rate')?.minimumFloor}% (Zero Regressões)`);
console.log(`- Requer Aprovação do Council em Tradeoffs: ${contract.requireCouncilApprovalOnTradeoff}\n`);

// 3. Execute retrospective evaluation
const result = SelfImprovementManager.reevaluateExperimentWithPromotionGate(expRow.id, contract);
const evalRes = result.evaluation;

console.log('========================================================================');
console.log('📊 RESULTADO DA REAVALIAÇÃO DO PROMOTION GATE:');
console.log('========================================================================');
console.log(`• Veredito Original: ${result.originalVerdict}`);
console.log(`• Veredito Reavaliado (Gate): ${result.reevaluatedVerdict}`);
if (result.councilSynthesis) {
  console.log(`• Recomendação do AI DEV Council: ${result.councilSynthesis.recommendation}`);
  console.log(`• Promovível em Modo Autônomo?: ${result.councilSynthesis.isAutonomousPromotable}`);
}

console.log('\n--- IMPACTO NA MÉTRICA ALVO ---');
console.log(`- Baseline: ${(evalRes.targetMetric.baselineValue / 1000).toFixed(1)}s`);
console.log(`- Candidate A: ${(evalRes.targetMetric.candidateValue / 1000).toFixed(1)}s`);
console.log(`- Delta Alvo: -${evalRes.targetMetric.actualImprovementPct}% (Meta: >= 15%) -> ${evalRes.targetMetric.achieved ? '✓ ATINGIDO' : '✗ NÃO ATINGIDO'}`);

console.log('\n--- IMPACTO GLOBAL DA SUÍTE (REGRESSION BUDGET) ---');
console.log(`- Duração Total Baseline: ${(evalRes.globalImpact.baselineTotalDurationMs / 1000).toFixed(1)}s`);
console.log(`- Duração Total Candidate A: ${(evalRes.globalImpact.candidateTotalDurationMs / 1000).toFixed(1)}s`);
console.log(`- Delta Total Global: +${evalRes.globalImpact.deltaTotalDurationPct}% (Orçamento: +${contract.regressionBudget.maxGlobalSuiteDurationIncreasePct}%) -> ${evalRes.globalImpact.exceededGlobalBudget ? '⚠ EXCEDEU ORÇAMENTO' : '✓ DENTRO DO ORÇAMENTO'}`);
console.log(`- Duração Média: ${(evalRes.globalImpact.baselineAvgDurationMs / 1000).toFixed(1)}s -> ${(evalRes.globalImpact.candidateAvgDurationMs / 1000).toFixed(1)}s`);
console.log(`- Duração Mediana: ${(evalRes.globalImpact.baselineMedianDurationMs / 1000).toFixed(1)}s -> ${(evalRes.globalImpact.candidateMedianDurationMs / 1000).toFixed(1)}s`);

console.log('\n--- COMPARAÇÃO POR TAREFA INDIVIDUAL ---');
for (const t of evalRes.taskComparisons) {
  const flag = t.isTarget ? '[ALVO]' : (t.exceededIndividualBudget ? '[REGRESSÃO >20%]' : '[OK]');
  console.log(`  • ${t.taskId.padEnd(25)}: ${(t.baselineDurationMs/1000).toFixed(1)}s -> ${(t.candidateDurationMs/1000).toFixed(1)}s (${t.deltaDurationPct >= 0 ? '+' : ''}${t.deltaDurationPct}%) ${flag}`);
}

console.log('\n--- JUSTIFICATIVA DA REAVALIAÇÃO ---');
console.log(evalRes.rationale);
if (result.councilSynthesis) {
  console.log('\n--- PARECER DO CHAIRMAN DO COUNCIL ---');
  console.log(result.councilSynthesis.chairmanRationale);
}
console.log('========================================================================\n');
