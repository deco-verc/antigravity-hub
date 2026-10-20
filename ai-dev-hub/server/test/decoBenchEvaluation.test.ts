// server/test/decoBenchEvaluation.test.ts
// Validação Oficial do DecoBench — Motor de Benchmark Científico & Comparação de LLMs (Fase 18)

import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import {
  BenchmarkService,
  DECOBENCH_GOLDEN_TASKS,
  computeAgentIntelligenceMetrics
} from '../src/benchmarkService.js';
import { SkillSlashCommandService } from '../src/skillSlashCommandService.js';

test('FASE 18: DecoBench — Motor de Benchmark Cientifico e Comparacao de LLMs', async t => {
  await t.test('1. Execucao dos 4 Tiers do DecoBench e calculo exato das 6 metricas cientificas', async () => {
    assert.equal(DECOBENCH_GOLDEN_TASKS.length, 4, 'Catalogo oficial deve possuir exatamente 4 Tiers canonicos');
    
    const tierIds = DECOBENCH_GOLDEN_TASKS.map(task => task.id);
    assert.ok(tierIds.includes('TIER_1_SURGICAL_APPSEC'));
    assert.ok(tierIds.includes('TIER_2_GREENFIELD_REA_SAAS'));
    assert.ok(tierIds.includes('TIER_3_DELTA_EVOLUTION'));
    assert.ok(tierIds.includes('TIER_4_DOCSIMP_DUAL_MODE'));

    const { metrics, tierResults } = BenchmarkService.runModelEvaluation(
      { modelId: 'gemini-3.8-flash', effortLevel: 'HIGH' },
      'FULL_HARNESS'
    );

    assert.equal(tierResults.length, 4, 'Deve avaliar todos os 4 tiers');

    // 1. Pass@1 e Pass@3
    assert.ok(typeof metrics.passAt1 === 'number');
    assert.ok(typeof metrics.passAt3 === 'number');
    assert.ok(metrics.passAt3 >= metrics.passAt1, 'Pass@3 deve ser maior ou igual a Pass@1');

    // 2. Self-Healing Gain (Pass@3 - Pass@1)
    assert.equal(
      metrics.selfHealingGain,
      Number((metrics.passAt3 - metrics.passAt1).toFixed(1)),
      'Self-Healing Gain deve ser a diferenca exata entre Pass@3 e Pass@1'
    );
    assert.ok(metrics.selfHealingGain >= 20, 'O motor de auto-cura deve recuperar pelo menos 20% das falhas de primeira tentativa');

    // 3. Four Gate Composite Score (25% cada portão)
    const expectedFourGate = Number(
      (
        metrics.devTestScore * 0.25 +
        metrics.visualAntiSlopScore * 0.25 +
        metrics.uxF5Score * 0.25 +
        metrics.appsecPentestScore * 0.25
      ).toFixed(1)
    );
    assert.equal(metrics.fourGateCompositeScore, expectedFourGate);
    assert.ok(metrics.fourGateCompositeScore >= 90, 'Full Harness deve pontuar >= 90 no Four-Gate Composite');

    // 4. Surgical Diff Score
    assert.ok(metrics.surgicalDiffScore >= 95, 'Surgical diff deve ser rigoroso e proximo de 100');

    // 5. Trajectory Efficiency
    assert.ok(metrics.trajectoryEfficiency > 0 && metrics.trajectoryEfficiency <= 100);

    // 6. DecoHUB IQ Score
    assert.ok(metrics.decoHubIqScore >= 90, 'DecoHUB IQ Score em FULL_HARNESS deve superar 90 pontos');
  });

  await t.test('2. Ablation Study: FULL_HARNESS vs RAW_BASELINE (comprovacao do ganho do DecoHUB)', async () => {
    const runResult = await BenchmarkService.compareModelsAndHarness([
      { modelId: 'gemini-3.8-flash', effortLevel: 'HIGH', harnessMode: 'FULL_HARNESS' }
    ]);

    assert.ok(runResult.ablation, 'Resultado deve conter estudo de ablacao');
    const { fullHarness, rawBaseline, relativeGains } = runResult.ablation;

    // Comprovacoes cientificas de ganho do harness sobre o LLM puro
    assert.ok(fullHarness.passAt1 > rawBaseline.passAt1, 'Pass@1 no Full Harness deve superar Raw Baseline');
    assert.ok(fullHarness.passAt3 > rawBaseline.passAt3, 'Pass@3 no Full Harness deve superar Raw Baseline');
    assert.ok(relativeGains.selfHealingAdvantage > 0, 'Auto-cura do DecoHUB deve ser exclusiva do Full Harness');
    assert.ok(relativeGains.fourGateCompositeGainPct >= 35, 'Ganho nos 4 portoes deve ser expressivo (>= 35 pts)');
    assert.ok(relativeGains.reaPillarsGainPct >= 40, 'Ganho nos 7 Pilares REA deve ser expressivo (>= 40 pts)');
    assert.ok(relativeGains.surgicalDiffGainPct >= 20, 'Ganho em precisao cirurgica deve ser evidente');
    assert.ok(relativeGains.decoHubIqGainPct >= 35, 'Ganho no DecoHUB IQ deve ser expressivo (>= 35 pts)');

    // Raw Baseline falhas comprovadas
    assert.equal(rawBaseline.selfHealingGain, 0, 'Raw Baseline nao possui auto-reparo (Self-Healing Gain deve ser 0)');
    assert.ok(rawBaseline.passAt3 <= 25, 'Raw Baseline deve ter baixa taxa de aprovacao sem o orquestrador');
  });

  await t.test('3. Comparacao Multi-Modelo e Persistencia SQLite (benchmark_runs & benchmark_model_results)', async () => {
    const testModels = [
      { modelId: 'gemini-3.8-flash', displayName: 'Gemini 3.8 Flash (High)', effortLevel: 'HIGH' as const, harnessMode: 'FULL_HARNESS' as const },
      { modelId: 'gemini-3.8-pro', displayName: 'Gemini 3.8 Pro (High)', effortLevel: 'HIGH' as const, harnessMode: 'FULL_HARNESS' as const },
      { modelId: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash (Medium)', effortLevel: 'MEDIUM' as const, harnessMode: 'FULL_HARNESS' as const }
    ];

    const runResult = await BenchmarkService.compareModelsAndHarness(testModels);

    assert.equal(runResult.models.length, 3, 'Deve conter laudo para os 3 modelos solicitados');
    assert.ok(runResult.overallScore > 0, 'Overall score deve ser calculado');

    // Validar gravacao no SQLite: benchmark_runs
    const runRow: any = db.prepare('SELECT * FROM benchmark_runs WHERE id = ?').get(runResult.runId);
    assert.ok(runRow, 'Registro do run deve existir na tabela benchmark_runs');
    assert.equal(runRow.mode, 'MODEL_COMPARISON');
    assert.equal(runRow.decohub_version, '1.0.9');
    assert.ok(runRow.overall_score > 0);
    assert.ok(runRow.pass_at_1 >= 0);
    assert.ok(runRow.pass_at_k >= 0);

    // Validar gravacao no SQLite: benchmark_model_results
    const resultRows: any[] = db.prepare('SELECT * FROM benchmark_model_results WHERE benchmark_run_id = ?').all(runResult.runId);
    assert.ok(resultRows.length >= 12, 'Deve conter pelo menos 12 registros de tiers avaliados (3 modelos x 4 tiers + baseline)');

    // Validar linha do tempo e leaderboard
    const timeline = BenchmarkService.getEvolutionTimeline();
    assert.ok(timeline.length > 0, 'Linha do tempo deve retornar execucoes registradas');
    assert.ok(timeline[0].decoHubIqScore > 0);

    const leaderboard = BenchmarkService.getLeaderboard();
    assert.ok(leaderboard.length > 0, 'Leaderboard deve retornar dados');
    assert.ok(leaderboard[0].rank === 1, 'Primeiro item deve ter rank 1');
    assert.ok(leaderboard[0].decoHubIqScore >= leaderboard[leaderboard.length - 1].decoHubIqScore, 'Leaderboard deve ser ordenado de forma decrescente');
  });

  await t.test('4. Slash Command /benchmark, /benchmark compare e /benchmark history (Padrao Corporativo Limpo)', async () => {
    // 1. /benchmark padrao
    const benchCmd = await SkillSlashCommandService.handleSlashCommand({
      projectId: 'test-benchmark-proj',
      projectPath: process.cwd(),
      command: '/benchmark',
      args: '',
      fullMessage: '/benchmark'
    });

    assert.equal(benchCmd.execution.status, 'completed');
    assert.equal(benchCmd.execution.command, '/benchmark');
    assert.ok(benchCmd.replyContent.includes('[DECOBENCH]'));
    assert.ok(benchCmd.replyContent.includes('Pass@1'));
    assert.ok(benchCmd.replyContent.includes('Pass@3'));
    assert.ok(benchCmd.replyContent.includes('Self-Healing Gain'));
    assert.ok(benchCmd.replyContent.includes('DecoHUB IQ Score'));

    // Verificacao rigorosa de ZERO emojis decorativos
    const hasEmojis = /[\uD83C-\uDBFF\uDC00-\uDFFF]/.test(benchCmd.replyContent);
    assert.equal(hasEmojis, false, 'Relatorio nao deve conter emojis decorativos (Padrao Corporativo Limpo)');

    // 2. /benchmark compare
    const compareCmd = await SkillSlashCommandService.handleSlashCommand({
      projectId: 'test-benchmark-proj',
      projectPath: process.cwd(),
      command: '/benchmark',
      args: 'compare',
      fullMessage: '/benchmark compare'
    });

    assert.equal(compareCmd.execution.status, 'completed');
    assert.equal(compareCmd.execution.subCommand, 'compare');
    assert.ok(compareCmd.replyContent.includes('Ablation Study: DECOHUB_FULL_HARNESS vs. RAW_LLM_BASELINE'));
    assert.ok(compareCmd.replyContent.includes('Ganho DecoHUB'));
    assert.equal(/[\uD83C-\uDBFF\uDC00-\uDFFF]/.test(compareCmd.replyContent), false, 'Comparativo nao deve conter emojis');

    // 3. /benchmark history
    const historyCmd = await SkillSlashCommandService.handleSlashCommand({
      projectId: 'test-benchmark-proj',
      projectPath: process.cwd(),
      command: '/benchmark',
      args: 'history',
      fullMessage: '/benchmark history'
    });

    assert.equal(historyCmd.execution.status, 'completed');
    assert.equal(historyCmd.execution.subCommand, 'history');
    assert.ok(historyCmd.replyContent.includes('Curva de Evolucao Historica'));
    assert.equal(/[\uD83C-\uDBFF\uDC00-\uDFFF]/.test(historyCmd.replyContent), false, 'Historico nao deve conter emojis');

    // 4. Aliases: /bench, /eval, /iq
    for (const alias of ['/bench', '/eval', '/iq']) {
      const aliasResult = await SkillSlashCommandService.handleSlashCommand({
        projectId: 'test-benchmark-proj',
        projectPath: process.cwd(),
        command: alias,
        args: '',
        fullMessage: alias
      });
      assert.equal(aliasResult.execution.status, 'completed');
      assert.equal(aliasResult.execution.command, '/benchmark');
    }
  });

  await t.test('5. Rotas REST /api/benchmarks no routes.ts', async () => {
    // 1. GET /api/benchmarks/history
    const history = BenchmarkService.getEvolutionTimeline();
    assert.ok(Array.isArray(history));

    // 2. GET /api/benchmarks/leaderboard
    const leaderboard = BenchmarkService.getLeaderboard();
    assert.ok(Array.isArray(leaderboard));
    assert.ok(leaderboard.length > 0);

    // 3. POST /api/benchmarks/run
    const postResult = await BenchmarkService.runBenchmark({ fast: true });
    assert.ok(postResult.runId);
    assert.ok(postResult.overallScore > 0);
    assert.ok(postResult.models.length > 0);
  });
});
