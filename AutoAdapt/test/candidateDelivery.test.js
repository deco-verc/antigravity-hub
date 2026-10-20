import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { validateCandidateDelivery } from '../src/candidateDelivery.js';

describe('Entrega Candidata (M3) — Validação de Relatórios e Plano de Rollback', () => {

  it('deve validar com sucesso a entrega candidata oficial do AutoAdapt', () => {
    const result = validateCandidateDelivery();

    assert.strictEqual(result.valid, true, `Erros encontrados: ${result.errors.join(', ')}`);
    assert.strictEqual(result.deliveryReportValid, true);
    assert.strictEqual(result.rollbackPlanValid, true);
    assert.strictEqual(result.isMasterUntouched, true);
    assert.strictEqual(result.errors.length, 0);
  });

  it('deve conter diagnóstico, fontes, diffs e métricas no relatório de entrega', () => {
    const content = fs.readFileSync('docs/entrega-versao-candidata.md', 'utf8');

    assert.ok(content.includes('G-01 (Fragilidade de Passada Única)'));
    assert.ok(content.includes('SWE-bench'));
    assert.ok(content.includes('IMP-01'));
    assert.ok(content.includes('IMP-02'));
    assert.ok(content.includes('a47ef31'));
    assert.ok(content.includes('56 testes'));
  });

  it('deve conter comandos executáveis e seguros no plano de rollback', () => {
    const content = fs.readFileSync('docs/plano-de-rollback.md', 'utf8');

    assert.ok(content.includes('git reset --hard 523dcbc1be9671f851412c21df9407721fa324c6'));
    assert.ok(content.includes('git clean -fd'));
    assert.ok(content.includes('npm test'));
    assert.ok(content.includes('git worktree prune'));
  });

  it('deve acusar erro ao receber caminhos inexistentes', () => {
    const result = validateCandidateDelivery({
      deliveryPath: 'docs/inexistente.md',
      rollbackPath: 'docs/inexistente.md'
    });

    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.length >= 2);
  });
});
