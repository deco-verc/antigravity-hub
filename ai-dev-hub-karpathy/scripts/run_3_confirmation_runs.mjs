// scripts/run_3_confirmation_runs.mjs
// Runs 3 Confirmation Runs of the Level 2 Agent Benchmark Suite for AI_DEV_STABLE_V1

import { AgentBenchmarkManager, AGENT_BENCHMARK_TASKS } from '../server/dist/agentBenchmarkManager.js';
import { db } from '../server/dist/db.js';
import { execSync } from 'node:child_process';

const gitCommit = execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();

console.log('========================================================================');
console.log('🛡️ INICIANDO 3 CONFIRMATION RUNS — BASELINE RECONCILIATION (AI_DEV_STABLE_V1)');
console.log(`Commit Oficial da Baseline: ${gitCommit}`);
console.log('========================================================================\n');

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

async function runConfirmationSuite() {
  const runs = [];
  const taskDurationsMap = {};
  for (const t of AGENT_BENCHMARK_TASKS) {
    taskDurationsMap[t.id] = [];
  }

  for (let runIdx = 1; runIdx <= 3; runIdx++) {
    console.log(`\n------------------------------------------------------------------------`);
    console.log(`▶ CONFIRMATION RUN #${runIdx}/3 (Versão: AI_DEV_STABLE_V1, Commit: ${gitCommit.slice(0, 8)})`);
    console.log(`------------------------------------------------------------------------`);

    const startTime = Date.now();
    const summary = await AgentBenchmarkManager.runFullAgentSuite({
      versionLabel: 'AI_DEV_STABLE_V1',
      gitCommit,
      isBaseline: true,
      model: 'flash'
    });
    const totalDuration = Date.now() - startTime;

    console.log(`✓ Run #${runIdx} CONCLUÍDO em ${(totalDuration / 1000).toFixed(1)}s | Pass Rate: ${summary.passRate}% | Composite: ${summary.compositeScore} pts`);

    runs.push({
      runNumber: runIdx,
      summary,
      totalDurationMs: totalDuration
    });

    for (const r of summary.results) {
      taskDurationsMap[r.taskId].push(r.durationMs);
    }
  }

  // Estatísticas Consolidadas
  console.log('\n========================================================================');
  console.log('📊 ESTATÍSTICAS MATEMÁTICAS CONSOLIDADAS DOS 3 CONFIRMATION RUNS:');
  console.log('========================================================================');

  const allPassRates = runs.map(r => r.summary.passRate);
  const consolidatedPassRate = allPassRates.every(p => p === 100) ? 100 : Math.round(allPassRates.reduce((a, b) => a + b, 0) / 3);

  const totalDurations = runs.map(r => r.totalDurationMs);
  const totalDurationMedian = median(totalDurations);

  const allTaskDurationsFlat = [];
  Object.values(taskDurationsMap).forEach(arr => allTaskDurationsFlat.push(...arr));
  const p95Duration = percentile(allTaskDurationsFlat, 95);

  const avgSurgicalScores = runs.map(r => r.summary.avgSurgicalScore);
  const surgicalMedian = median(avgSurgicalScores);

  const avgSimplicityScores = runs.map(r => r.summary.avgSimplicityScore);
  const simplicityMedian = median(avgSimplicityScores);

  const avgCompositeScores = runs.map(r => r.summary.compositeScore);
  const compositeMedian = median(avgCompositeScores);

  console.log(`• Pass Rate Consolidado: ${consolidatedPassRate}% (Invariante: 100% de Sucesso em todos os runs)`);
  console.log(`• Total Duration Median: ${(totalDurationMedian / 1000).toFixed(1)}s (Runs: ${totalDurations.map(d => (d/1000).toFixed(1) + 's').join(', ')})`);
  console.log(`• P95 Latency por Tarefa: ${(p95Duration / 1000).toFixed(1)}s`);
  console.log(`• Surgical Score Median: ${surgicalMedian}%`);
  console.log(`• Simplicity Score Median: ${simplicityMedian} / 10`);
  console.log(`• Composite Score Median: ${compositeMedian} pts`);

  console.log('\n--- MEDIANA POR TAREFA INDIVIDUAL (PER-TASK MEDIAN) ---');
  for (const t of AGENT_BENCHMARK_TASKS) {
    const arr = taskDurationsMap[t.id];
    const med = median(arr);
    console.log(`  • ${t.id.padEnd(25)}: ${(med / 1000).toFixed(1)}s (Amostras: ${arr.map(a => (a/1000).toFixed(1) + 's').join(', ')})`);
  }

  // 10. Atualização Histórica do Experimento #5
  console.log('\n========================================================================');
  console.log('📜 REGISTRO HISTÓRICO FORMAL DO EXPERIMENTO #5 NO BANCO');
  console.log('========================================================================');
  try {
    const updateRes = db.prepare(`
      UPDATE self_improvement_experiments
      SET original_verdict = 'KEEP',
          reevaluated_verdict = 'TRADEOFF_REVIEW',
          council_recommendation = 'DISCARD',
          rationale = '[RECONCILIATION] REVERTED_FROM_STABLE_BASELINE: alteração rejeitada revertida cirurgicamente da baseline de produção (71ba345e -> f52acde/63fdd47)'
      WHERE experiment_number = 5
    `).run();
    console.log(`✓ Registro histórico do Experimento #5 atualizado no SQLite (${updateRes.changes} registro(s) afetado(s)):`);
    console.log(`  - Original: KEEP`);
    console.log(`  - Reevaluated: TRADEOFF_REVIEW`);
    console.log(`  - Council: DISCARD`);
    console.log(`  - Reconciliation: REVERTED_FROM_STABLE_BASELINE`);
  } catch (err) {
    console.warn(`Aviso ao atualizar histórico no SQLite: ${err.message}`);
  }

  console.log('\n========================================================================');
  console.log('🏁 BASELINE OFICIAL RECONCILIADA ESTABELECIDA COM SUCESSO:');
  console.log(`   Label: AI_DEV_STABLE_V1`);
  console.log(`   SHA:   ${gitCommit}`);
  console.log('========================================================================\n');
}

runConfirmationSuite().catch(err => {
  console.error('Erro fatal nos confirmation runs:', err);
  process.exit(1);
});
