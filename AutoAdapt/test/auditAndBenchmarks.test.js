import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import {
  loadMarkdownFile,
  validateAuditReport,
  validateBenchmarksReport,
  getAuditSummary,
  getBenchmarkComparisonData
} from '../src/auditAndBenchmarks.js';

describe('Auditoria e Benchmarks — Analisar sistema atual e pesquisar benchmarks de agentes autônomos', () => {
  const auditPath = path.resolve('docs/auditoria-falhas-e-gargalos.md');
  const benchmarksPath = path.resolve('docs/pesquisa-comparativa-benchmarks.md');

  describe('Critério 1: Falhas e gargalos documentados', () => {
    it('Arquivo docs/auditoria-falhas-e-gargalos.md deve existir e ser acessível', () => {
      assert.ok(fs.existsSync(auditPath), `Arquivo não encontrado: ${auditPath}`);
      const stats = fs.statSync(auditPath);
      assert.ok(stats.size > 1000, `O documento de auditoria deve ser detalhado (tamanho atual: ${stats.size} bytes)`);
    });

    it('Deve documentar os modos de falha estruturados na taxonomia', () => {
      const content = fs.readFileSync(auditPath, 'utf8');
      assert.ok(content.includes('Context Drift'), 'Deve abordar deriva de contexto');
      assert.ok(content.includes('Silent Assumption'), 'Deve abordar suposições tácitas');
      assert.ok(content.includes('Feedback Loop Collapse'), 'Deve abordar colapso do loop de feedback');
      assert.ok(content.includes('Over-Engineering') || content.includes('Simplicity First'), 'Deve abordar complexidade excessiva');
      assert.ok(content.includes('Worktrees Git') || content.includes('Concorrência'), 'Deve abordar contenção de recursos git');
      assert.ok(content.includes('Harness Gaming') || content.includes('Falsos Positivos'), 'Deve abordar verificações fracas');
    });

    it('Deve conter mapeamento de gargalos críticos com identificadores (G-01 a G-05)', () => {
      const content = fs.readFileSync(auditPath, 'utf8');
      assert.ok(content.includes('G-01'), 'Gargalo G-01 deve estar presente');
      assert.ok(content.includes('G-02'), 'Gargalo G-02 deve estar presente');
      assert.ok(content.includes('G-03'), 'Gargalo G-03 deve estar presente');
      assert.ok(content.includes('G-04'), 'Gargalo G-04 deve estar presente');
      assert.ok(content.includes('G-05'), 'Gargalo G-05 deve estar presente');
    });

    it('Deve conter matriz de riscos, severidades e plano de ações corretivas para o AutoAdapt', () => {
      const content = fs.readFileSync(auditPath, 'utf8');
      assert.ok(content.includes('MATRIZ DE RISCO E MITIGAÇÕES OPERACIONAIS'), 'Matriz de risco deve estar formatada');
      assert.ok(content.includes('Plano de Ações Corretivas para o AutoAdapt'), 'Plano de ações deve estar documentado');
      assert.ok(content.includes('Built-in First'), 'Mitigação Built-in First deve constar no plano');
      assert.ok(content.includes('Git Worktree'), 'Isolamento de Git Worktree deve constar no plano');
    });

    it('validateAuditReport() deve validar com sucesso o relatório oficial', () => {
      const result = validateAuditReport(auditPath);
      assert.equal(result.valid, true, 'O relatório de auditoria deve ser 100% válido');
      assert.equal(result.missingSections.length, 0, `Nenhuma seção deve faltar: ${result.missingSections.join(', ')}`);
      assert.ok(result.failureModes.length >= 5, `Esperado >= 5 modos de falha, encontrado: ${result.failureModes.length}`);
      assert.ok(result.bottleneckCount >= 4, `Esperado >= 4 gargalos mapeados, encontrado: ${result.bottleneckCount}`);
    });

    it('getAuditSummary() deve retornar objeto consolidado válido com flags operacionais', () => {
      const summary = getAuditSummary(auditPath);
      assert.equal(summary.isValid, true);
      assert.equal(summary.hasHighSeverity, true);
      assert.equal(summary.hasGitWorktreeMitigation, true);
      assert.ok(summary.bottlenecksCount >= 5);
    });
  });

  describe('Critério 2: Pesquisa comparativa registrada em markdown', () => {
    it('Arquivo docs/pesquisa-comparativa-benchmarks.md deve existir e ser acessível', () => {
      assert.ok(fs.existsSync(benchmarksPath), `Arquivo não encontrado: ${benchmarksPath}`);
      const stats = fs.statSync(benchmarksPath);
      assert.ok(stats.size > 1500, `O documento de benchmarks deve ser detalhado (tamanho atual: ${stats.size} bytes)`);
    });

    it('Deve cobrir os principais benchmarks da literatura e indústria', () => {
      const content = fs.readFileSync(benchmarksPath, 'utf8');
      assert.ok(content.includes('SWE-bench'), 'Deve cobrir SWE-bench');
      assert.ok(content.includes('HumanEval'), 'Deve cobrir HumanEval');
      assert.ok(content.includes('GAIA'), 'Deve cobrir GAIA');
      assert.ok(content.includes('AgentBench'), 'Deve cobrir AgentBench');
      assert.ok(content.includes('Karpathy'), 'Deve cobrir paradigma Karpathy / RLVR');
    });

    it('Deve conter matriz comparativa de benchmarks e comparativo de arquiteturas de agentes', () => {
      const content = fs.readFileSync(benchmarksPath, 'utf8');
      assert.ok(content.includes('Matriz Comparativa de Benchmarks'), 'Deve conter matriz comparativa');
      assert.ok(content.includes('Comparativo de Arquiteturas de Agentes'), 'Deve conter comparativo de arquiteturas');
      assert.ok(content.includes('Supervisor / Worker'), 'Deve analisar arquitetura Supervisor / Worker');
      assert.ok(content.includes('Search-Based'), 'Deve analisar arquitetura Search-based + Test Verification');
    });

    it('Deve definir diretrizes e recomendações acionáveis para o AutoAdapt', () => {
      const content = fs.readFileSync(benchmarksPath, 'utf8');
      assert.ok(content.includes('Diretrizes e Recomendações para o AutoAdapt'), 'Deve ter seção de diretrizes');
      assert.ok(content.includes('Verifier-Driven'), 'Deve recomendar abordagem Verifier-Driven');
      assert.ok(content.includes('Self-Healing Debug Loop'), 'Deve definir loop de autocorreção');
      assert.ok(content.includes('Worktree Sandbox'), 'Deve prescrever sandbox de worktrees');
    });

    it('validateBenchmarksReport() deve confirmar presença de todos os benchmarks chave', () => {
      const result = validateBenchmarksReport(benchmarksPath);
      assert.equal(result.valid, true, 'O relatório comparativo deve ser 100% válido');
      assert.equal(result.missingSections.length, 0);
      assert.equal(result.coveredBenchmarks.length, 5, 'Todos os 5 benchmarks alvo devem ser cobertos');
      assert.ok(result.recommendationsCount >= 3, 'Deve haver ao menos 3 recomendações chave');
    });

    it('getBenchmarkComparisonData() deve extrair estruturas de dados consistentes', () => {
      const data = getBenchmarkComparisonData(benchmarksPath);
      assert.equal(data.isValid, true);
      assert.equal(data.benchmarks.length, 5);
      assert.equal(data.architectures.length, 4);
      assert.ok(data.benchmarks.some(b => b.name.includes('SWE-bench') && b.verifier === true));
    });
  });

  describe('Robustez e Tratamento de Erros', () => {
    it('loadMarkdownFile deve lançar erro ao receber arquivo inexistente ou vazio', () => {
      assert.throws(() => loadMarkdownFile('docs/arquivo-que-nao-existe.md'), /Arquivo não encontrado/);
      assert.throws(() => loadMarkdownFile(''), /Caminho de arquivo inválido/);
      assert.throws(() => loadMarkdownFile(null), /Caminho de arquivo inválido/);
    });

    it('validateAuditReport deve apontar seções faltantes em documento truncado', () => {
      const snippet = '# Incompleto\nSem seções.';
      const result = validateAuditReport(snippet);
      assert.equal(result.valid, false);
      assert.ok(result.missingSections.length > 0);
    });
  });
});
