import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { runComparativeBenchmark, generateComparativeReport } from '../src/comparativeBenchmark.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTOADAPT_ROOT = path.resolve(__dirname, '..');

describe('Comparative Benchmark — Validação Independente Antes vs Depois', () => {

  it('deve executar benchmark comparativo e demonstrar ganho autônomo significativo', async () => {
    const benchmark = await runComparativeBenchmark();

    assert.ok(benchmark.timestamp);
    assert.ok(typeof benchmark.durationMs === 'number');
    assert.ok(benchmark.metrics);

    assert.ok(benchmark.metrics.autonomousDefectResolution.gainPct >= 70, `Ganho esperado >= 70%, obtido: ${benchmark.metrics.autonomousDefectResolution.gainPct}%`);
    assert.strictEqual(benchmark.metrics.worktreeCollisionRisk.improved, '0% (Prefixos dinâmicos únicos)');
    assert.strictEqual(benchmark.metrics.maxSelfHealingIterations.improved, '5 (Limite estrito RLVR)');

    assert.strictEqual(benchmark.scenarios.length, 4);

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

  it('deve confirmar existência e integridade do relatório comparativo oficial em docs/', () => {
    const officialPath = path.join(AUTOADAPT_ROOT, 'docs/relatorio-validacao-comparativa.md');
    assert.ok(fs.existsSync(officialPath), `Relatório oficial não encontrado em ${officialPath}`);
    const content = fs.readFileSync(officialPath, 'utf8');
    assert.ok(content.length > 500);
    assert.ok(content.includes('# Relatório de Validação Comparativa (Antes vs Depois)'));
  });
});