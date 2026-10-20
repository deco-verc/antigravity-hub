// scripts/execute_e2e_proof_run.mjs
// Final E2E Proof Validation of the Autonomous Self-Improvement Engine
// Runs 1 complete autonomous round from start to finish naturally without STOP

import { db } from '../server/dist/db.js';

console.log('========================================================================');
console.log('🚀 VALIDAÇÃO FINAL E2E DO AUTONOMOUS SELF-IMPROVEMENT ENGINE');
console.log('========================================================================\n');

async function safeFetch(url, options = {}, retries = 5) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, options);
      return res;
    } catch (e) {
      if (i === retries - 1) throw e;
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

async function runE2EValidation() {
  // 1. Snapshot Baseline Inicial
  console.log('--- 1. SNAPSHOT DA BASELINE INICIAL ---');
  const baselineRunRow = db.prepare(`
    SELECT * FROM benchmark_runs 
    WHERE is_baseline = 1 AND benchmark_level = 'AGENT' 
    ORDER BY created_at DESC LIMIT 1
  `).get();

  if (!baselineRunRow) {
    console.error('Nenhum benchmark baseline AGENT encontrado.');
    process.exit(1);
  }

  const baselineSummary = JSON.parse(baselineRunRow.summary_json || '{}');
  const taskRows = db.prepare('SELECT * FROM benchmark_task_results WHERE run_id = ?').all(baselineRunRow.id);
  const totalDurationMs = taskRows.reduce((acc, r) => acc + (r.duration_ms || 0), 0);
  const durations = taskRows.map(r => r.duration_ms || 0).sort((a,b) => a - b);
  const medianMs = durations[Math.floor(durations.length / 2)] || 0;

  console.log(`• Baseline ID: ${baselineRunRow.id}`);
  console.log(`• Baseline SHA: ${baselineRunRow.git_commit}`);
  console.log(`• Pass Rate: ${baselineRunRow.pass_rate}% (${baselineRunRow.passed_tasks}/${baselineRunRow.total_tasks} tarefas)`);
  console.log(`• Composite Score: ${baselineRunRow.composite_score} pts`);
  console.log(`• Precisão Cirúrgica: ${baselineRunRow.avg_surgical_score}%`);
  console.log(`• Score de Simplicidade: ${baselineRunRow.avg_simplicity_score}/10`);
  console.log(`• Duração Total: ${(totalDurationMs / 1000).toFixed(1)}s (Mediana: ${(medianMs / 1000).toFixed(1)}s)\n`);

  // 2. Iniciar Run no preset E2E_PROOF
  console.log('--- 2. INICIANDO AUTONOMOUS ENGINE (PRESET: E2E_PROOF) ---');
  const startRes = await safeFetch('http://localhost:3001/api/self-improvement/runs/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      preset: 'E2E_PROOF',
      budgetMinutes: 90,
      maxExperiments: 1,
      candidatesPerExperiment: 2,
      riskLevel: 'GREEN_ONLY'
    })
  });

  const runData = await startRes.json();
  console.log(`• Run ID: ${runData.id}`);
  console.log(`• Preset: ${runData.preset}`);
  console.log(`• Status: ${runData.status}`);
  console.log(`• Orçamento: ${runData.budgetMinutes} minutos | Max Experimentos: ${runData.maxExperiments}\n`);

  // 3. Monitorar Execução Natural de Ponta a Ponta
  console.log('--- 3. MONITORANDO EXECUÇÃO NATURAL DO LOOP AUTÔNOMO ---');
  console.log('(Acompanhando transição de estados sem intervenção humana e SEM STOP...)\n');

  let currentRun = runData;
  let lastLoggedEventsCount = 0;
  const startTime = Date.now();

  while (true) {
    await new Promise(r => setTimeout(r, 6000));
    const pollRes = await safeFetch(`http://localhost:3001/api/self-improvement/runs/${runData.id}`);
    currentRun = await pollRes.json();

    const timeline = currentRun.timeline || [];
    if (timeline.length > lastLoggedEventsCount) {
      for (let i = lastLoggedEventsCount; i < timeline.length; i++) {
        const ev = timeline[i];
        const timeStr = new Date(ev.timestamp).toLocaleTimeString();
        console.log(`  [${timeStr}] 📌 [${ev.event}] ${ev.details || ''}`);
      }
      lastLoggedEventsCount = timeline.length;
    }

    // Verificar se atingiu estado terminal natural
    if (['COMPLETED', 'BLOCKED', 'FAILED', 'CANCELLED'].includes(currentRun.status)) {
      console.log(`\n• Estado terminal atingido: ${currentRun.status} (Stop Reason: ${currentRun.stopReason || 'Nenhum'})\n`);
      break;
    }

    // Safety timeout: 45 min
    if (Date.now() - startTime > 45 * 60 * 1000) {
      console.warn('⚠️ Tempo máximo de monitoramento atingido no script.');
      break;
    }
  }

  // 4. Auditoria de Dados no Banco
  console.log('========================================================================');
  console.log('📊 AUDITORIA DO BANCO DE DADOS (EVIDÊNCIAS REAIS):');
  console.log('========================================================================');

  const finalRunRow = db.prepare('SELECT * FROM self_improvement_runs WHERE id = ?').get(runData.id);
  const expRow = db.prepare('SELECT * FROM self_improvement_experiments WHERE run_id = ? ORDER BY experiment_number ASC LIMIT 1').get(runData.id);

  console.log(`\n• RUN ID: ${finalRunRow.id}`);
  console.log(`• STATUS FINAL: ${finalRunRow.status}`);
  console.log(`• COMPLETED_EXPERIMENTS: ${finalRunRow.completed_experiments} (Esperado: 1)`);
  console.log(`• STARTING BASELINE SHA: ${finalRunRow.baseline_commit}`);
  console.log(`• FINAL CURRENT BEST SHA: ${finalRunRow.current_best_commit}`);
  console.log(`• PLACAR: KEEP=${finalRunRow.kept_count} | DISCARD=${finalRunRow.discarded_count} | CRASH=${finalRunRow.crashed_count}`);

  if (expRow) {
    console.log(`\n--- EXPERIMENTO #1 DETALHES ---`);
    console.log(`• ID: ${expRow.id}`);
    console.log(`• Gargalo Identificado: ${expRow.bottleneck_identified}`);
    console.log(`• Hipótese Formulada: "${expRow.hypothesis}"`);
    console.log(`• Métrica Alvo: ${expRow.target_metric}`);
    console.log(`• Veredito da Governança: ${expRow.verdict}`);
    console.log(`• Vencedor da Arena: ${expRow.winner_candidate || 'DISCARD ALL (Sem vencedor)'}`);
    console.log(`• Candidate A Branch: ${expRow.candidate_a_branch}`);
    console.log(`• Candidate A Commit: ${expRow.candidate_a_commit}`);
    console.log(`• Candidate B Branch: ${expRow.candidate_b_branch}`);
    console.log(`• Candidate B Commit: ${expRow.candidate_b_commit}`);
    console.log(`• Score Candidate A: ${expRow.candidate_a_score}`);
    console.log(`• Score Candidate B: ${expRow.candidate_b_score}`);
    console.log(`• Justificativa: ${expRow.rationale}`);
  }

  // 5. Morning Report
  console.log(`\n--- MORNING REPORT CONSOLIDADO ---`);
  const reportRes = await safeFetch(`http://localhost:3001/api/self-improvement/runs/${runData.id}/report`);
  const reportData = await reportRes.json();
  console.log(reportData.report);

  console.log('========================================================================');
  if (finalRunRow.completed_experiments === 1 && (finalRunRow.status === 'COMPLETED' || finalRunRow.status === 'NEXT_ROUND')) {
    console.log('✅ VALIDAÇÃO E2E CONCLUÍDA COM SUCESSO ABSOLUTO (completed_experiments = 1)');
  } else {
    console.log(`⚠ Execução finalizada com completed_experiments = ${finalRunRow.completed_experiments}`);
  }
  console.log('========================================================================\n');
}

runE2EValidation().catch(err => {
  console.error('Erro na execução E2E:', err);
  process.exit(1);
});
