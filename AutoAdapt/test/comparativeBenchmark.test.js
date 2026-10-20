import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runComparativeBenchmark, generateComparativeReport } from '../src/comparativeBenchmark.js';

describe('Comparative Benchmark — Validação Independente Antes vs Depois', () => {

  it('deve executar benchmark comparativo e demonstrar ganho autônomo significativo', async () => {
    const benchmark = await runComparativeBenchmark();

    assert.ok(benchmark.timestamp);
    assert.ok(typeof benchmark.durationMs === 'number');
    assert.ok(benchmark.metrics);

    // Ganho deve ser de pelo menos +70%
    assert.ok(benchmark.metrics.autonomousDefectResolution.gainPct >= 70, `Ganho esperado >= 70%, obtido: ${benchmark.metrics.autonomousDefectResolution.gainPct}%`);
    assert.strictEqual(benchmark.metrics.worktreeCollisionRisk.improved, '0% (Prefixos dinâmicos únicos)');
    assert.strictEqual(benchmark.metrics.maxSelfHealingIterations.improved, '5 (Limite estrito RLVR)');

    // 4 cenários testados
    assert.strictEqual(benchmark.scenarios.length, 4);

    // 3 recuperados, 1 irrecuperável escalado
    const successes = benchmark.scenarios.filter(s => s.success);
    const failures = benchmark.scenarios.filter(s => !s.success);
    assert.strictEqual(successes.length, 3);
    assert.strictEqual(failures.length, 1);
  });

  it('deve gerar relatório comparativo em Markdown estruturado', async () => {
    const benchmark = await runComparativeBenchmark();
    const tempReportPath = path.join(os.tmpdir(), `relatorio-comp-test-${Date.now()}.md`);

    try {
      const reportContent = generateComparativeReport(benchmark, tempReportPath);

      assert.ok(fs.existsSync(tempReportPath));
      assert.ok(reportContent.includes('# Relatório de Validação Comparativa (Antes vs Depois)'));
      assert.ok(reportContent.includes('Tabela Comparativa de Métricas'));
      assert.ok(reportContent.includes('DEF-01'));
      assert.ok(reportContent.includes('APROVADO — Critérios M-1 e M-2 Plenamente Atendidos'));
      assert.ok(reportContent.includes('Zero dependências mantido'));
    } finally {
      if (fs.existsSync(tempReportPath)) {
        fs.unlinkSync(tempReportPath);
      }
    }
  });

  it('deve gerar o relatório comparativo oficial em docs/', async () => {
    const benchmark = await runComparativeBenchmark();
    const officialPath = path.resolve('docs/relatorio-validacao-comparativa.md');
    const content = generateComparativeReport(benchmark, officialPath);

    assert.ok(fs.existsSync(officialPath));
    assert.ok(content.length > 500);
  });
});
