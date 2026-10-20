// server/test/antiSlopBenchmark.test.ts
// Automated Test Suite for Anti-Slop Benchmark: Baseline A vs Variant B

import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import {
  AntiSlopBenchmarkRunner,
  ANTI_SLOP_BENCHMARK_TASKS
} from '../src/antiSlopBenchmark.js';

test('Anti-Slop Benchmark Suite: Comparative Validation between Baseline A and Variant B', async (t) => {
  await t.test('1. Task 1 (Math Utility): Baseline produces overengineered slop while Variant B is surgical and clean', async () => {
    const task1 = ANTI_SLOP_BENCHMARK_TASKS.find(t => t.id === 'anti-slop-01-math-utility')!;
    assert.ok(task1, 'Task 1 must exist in suite');

    const resultA = await AntiSlopBenchmarkRunner.runSingleTask(task1, 'BASELINE_A');
    const resultB = await AntiSlopBenchmarkRunner.runSingleTask(task1, 'VARIANT_B');

    // Baseline A validation
    assert.equal(resultA.variant, 'BASELINE_A');
    assert.ok(resultA.linesOfCode > 50, `Baseline LoC should reflect overengineering: got ${resultA.linesOfCode}`);
    assert.ok(resultA.slopFindingsCount >= 1, 'Baseline should trigger Anti-Slop detection for dummy/mock left in production');
    assert.ok(resultA.slopTypesFound.includes('PRODUCTION_MOCK'), 'Must identify PRODUCTION_MOCK');
    assert.equal(resultA.councilApproved, false, 'Council must reject Baseline due to slop and overengineering');
    assert.ok(resultA.councilScore <= 5, 'Council simplicity score must be <= 5');

    // Variant B validation
    assert.equal(resultB.variant, 'VARIANT_B');
    assert.ok(resultB.linesOfCode < resultA.linesOfCode, 'Variant B must be significantly more surgical than Baseline');
    assert.equal(resultB.slopFindingsCount, 0, 'Variant B must have zero slop findings');
    assert.equal(resultB.testsPassingPct, 100, 'Variant B must pass 100% of test cases');
    assert.equal(resultB.councilApproved, true, 'Council must approve Variant B');
    assert.ok(resultB.councilScore >= 8, 'Council score must be >= 8');
  });

  await t.test('2. Task 2 (Security API): Baseline misses RFC timestamp drift and has mock, Variant B is 100% compliant', async () => {
    const task2 = ANTI_SLOP_BENCHMARK_TASKS.find(t => t.id === 'anti-slop-02-security-api')!;
    assert.ok(task2, 'Task 2 must exist');

    const resultA = await AntiSlopBenchmarkRunner.runSingleTask(task2, 'BASELINE_A');
    const resultB = await AntiSlopBenchmarkRunner.runSingleTask(task2, 'VARIANT_B');

    // Baseline A misses timestamp drift validation
    assert.ok(resultA.regressionsCount >= 1, 'Baseline should fail at least 1 test due to missing RFC drift check');
    assert.ok(resultA.slopFindingsCount >= 1, 'Baseline must trigger slop for fakeResponse');
    assert.equal(resultA.councilApproved, false);

    // Variant B handles all edge cases
    assert.equal(resultB.regressionsCount, 0);
    assert.equal(resultB.testsPassingPct, 100);
    assert.equal(resultB.slopFindingsCount, 0);
    assert.equal(resultB.councilApproved, true);
  });

  await t.test('3. Task 3 (SQLite Transaction): Baseline violates atomic rollback, Variant B guarantees integrity', async () => {
    const task3 = ANTI_SLOP_BENCHMARK_TASKS.find(t => t.id === 'anti-slop-03-sqlite-transaction')!;
    assert.ok(task3, 'Task 3 must exist');

    const resultA = await AntiSlopBenchmarkRunner.runSingleTask(task3, 'BASELINE_A');
    const resultB = await AntiSlopBenchmarkRunner.runSingleTask(task3, 'VARIANT_B');

    // Baseline A leaves balance debited on failure
    assert.ok(resultA.regressionsCount >= 1, 'Baseline should fail rollback test');
    assert.ok(resultA.reworkCycles >= 2, 'Baseline requires multiple rework cycles');

    // Variant B uses db.transaction
    assert.equal(resultB.regressionsCount, 0);
    assert.equal(resultB.testsPassingPct, 100);
    assert.equal(resultB.reworkCycles, 0);
  });

  await t.test('4. Full Benchmark Execution: Aggregates metrics, calculates deltas, persists to DB and renders report', async () => {
    const summary = await AntiSlopBenchmarkRunner.runFullBenchmark();

    assert.ok(summary.runIdA.startsWith('bm-baseline-a-'));
    assert.ok(summary.runIdB.startsWith('bm-variant-b-'));
    assert.equal(summary.baselineMetrics.length, 3);
    assert.equal(summary.variantMetrics.length, 3);

    // Assert key deltas
    const deltas = summary.aggregate.deltas;
    assert.equal(deltas.slopReductionPct, 100, 'Must achieve 100% slop reduction');
    assert.ok(deltas.locReductionPct > 30, `Must achieve >30% LoC reduction: got ${deltas.locReductionPct}%`);
    assert.ok(deltas.reworkCyclesSaved > 0, 'Must save rework cycles');

    // Check DB persistence
    const rowA: any = db.prepare('SELECT * FROM benchmark_runs WHERE id = ?').get(summary.runIdA);
    const rowB: any = db.prepare('SELECT * FROM benchmark_runs WHERE id = ?').get(summary.runIdB);
    assert.ok(rowA, 'Baseline run must be persisted in SQLite');
    assert.ok(rowB, 'Variant B run must be persisted in SQLite');
    assert.equal(rowA.is_baseline, 1);
    assert.equal(rowB.is_baseline, 0);

    // Markdown report formatting
    const md = AntiSlopBenchmarkRunner.formatMarkdownReport(summary);
    assert.ok(md.includes('# Relatório de Benchmark Anti-Slop'));
    assert.ok(md.includes('Linha de Base A (DecoHUB 1.0.6 Padrão)'));
    assert.ok(md.includes('Variante B (Autonomous Intelligence)'));
    assert.ok(md.includes('Tarefa 1: Cálculo Financeiro'));
    assert.ok(md.includes('Tarefa 2: Sanitização e Validação'));
    assert.ok(md.includes('Tarefa 3: Transação Atômica'));
  });
});
