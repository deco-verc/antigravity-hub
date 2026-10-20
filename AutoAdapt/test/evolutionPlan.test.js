import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import {
  loadEvolutionPlan,
  extractImprovements,
  validateEvolutionPlan,
  getBaselineMetrics,
  getPrioritizedImprovements
} from '../src/evolutionPlan.js';

describe('Plano de Evolução — Criar backlog priorizado com baseline limitando a 2 melhorias', () => {
  const planPath = path.resolve('docs/plano-de-evolucao.md');

  describe('Critério 1: Baseline documentada', () => {
    it('Arquivo docs/plano-de-evolucao.md deve existir e ser acessível', () => {
      assert.ok(fs.existsSync(planPath), `Arquivo não encontrado: ${planPath}`);
      const stats = fs.statSync(planPath);
      assert.ok(stats.size > 1000, `O plano de evolução deve conter documentação detalhada (tamanho: ${stats.size} bytes)`);
    });

    it('Deve documentar a baseline do sistema e tabela de métricas de referência', () => {
      const content = fs.readFileSync(planPath, 'utf8');
      assert.ok(content.includes('Baseline Documentada do Sistema'), 'Deve conter seção de baseline');
      assert.ok(content.includes('Tempo de Execução de Testes'), 'Deve documentar métrica de tempo de testes');
      assert.ok(content.includes('24 testes'), 'Deve documentar suite existente de 24 testes');
      assert.ok(content.includes('Zero third-party dependencies') || content.includes('0 (Zero'), 'Deve documentar zero dependências externas');
      assert.ok(content.includes('node:test'), 'Deve documentar o runner nativo');
    });

    it('Deve documentar as capacidades estabelecidas e limitações da baseline', () => {
      const content = fs.readFileSync(planPath, 'utf8');
      assert.ok(content.includes('Capacidades Estabelecidas'), 'Deve listar capacidades');
      assert.ok(content.includes('Gargalos e Limitações da Baseline'), 'Deve explicitar limitações atuais');
      assert.ok(content.includes('Ausência de Self-Healing'), 'Deve diagnosticar ausência de self-healing');
    });

    it('getBaselineMetrics() deve retornar métricas estruturadas válidas da baseline', () => {
      const metrics = getBaselineMetrics(planPath);
      assert.equal(metrics.isDocumented, true);
      assert.equal(metrics.automatedTestCount, 24);
      assert.equal(metrics.externalDependenciesCount, 0);
      assert.ok(metrics.testExecutionTimeMs.includes('ms'));
      assert.ok(metrics.worktreeIsolationStatus.includes('ai-dev-hub-self-improvement'));
    });
  });

  describe('Critério 2: Maximo 2 melhorias de alto impacto escolhidas', () => {
    it('Deve conter estritamente no máximo 2 melhorias no backlog priorizado', () => {
      const content = fs.readFileSync(planPath, 'utf8');
      const improvements = extractImprovements(content);

      assert.equal(improvements.length, 2, `O backlog deve conter exatamente 2 melhorias de alto impacto. Encontrado: ${improvements.length}`);
      assert.ok(improvements.length <= 2, 'Restrição inviolável: máximo 2 melhorias');
    });

    it('Deve identificar as melhorias prioritárias IMP-01 (Self-Healing) e IMP-02 (Ephemeral Worktrees)', () => {
      const improvements = getPrioritizedImprovements(planPath);
      assert.equal(improvements.length, 2);

      const imp1 = improvements.find(i => i.id.includes('IMP-01') || i.title.includes('Autocorreção'));
      const imp2 = improvements.find(i => i.id.includes('IMP-02') || i.title.includes('Worktrees Efêmeros'));

      assert.ok(imp1, 'Melhoria 1 (Self-Healing Debug Loop) deve estar presente');
      assert.ok(imp2, 'Melhoria 2 (Worktrees Efêmeros) deve estar presente');
      assert.equal(imp1.priority, 'P0 (Crítica)');
      assert.equal(imp2.priority, 'P0 (Crítica)');
    });

    it('Ambas as melhorias devem conter justificativa de alto ROI e critérios de aceitação binários', () => {
      const content = fs.readFileSync(planPath, 'utf8');
      assert.ok(content.includes('IMP-01-SELF-HEALING-LOOP'), 'Deve conter ID formal IMP-01');
      assert.ok(content.includes('IMP-02-EPHEMERAL-WORKTREES'), 'Deve conter ID formal IMP-02');
      assert.ok(content.includes('Justificativa Técnica (Alto ROI)'), 'Deve explicitar justificativa de alto retorno');
      assert.ok(content.includes('Critérios Binários de Aceitação'), 'Deve ter critérios binários');
    });

    it('Deve registrar formalmente matriz de rejeição para iniciativas fora de escopo', () => {
      const content = fs.readFileSync(planPath, 'utf8');
      assert.ok(content.includes('Matriz de Rejeição / Itens Postergados'), 'Deve documentar iniciativas rejeitadas para manter foco');
      assert.ok(content.includes('Postergado'), 'Deve conter itens explicitamente postergados');
    });
  });

  describe('Validação Estrutural e Regras de Negócio', () => {
    it('validateEvolutionPlan() deve confirmar conformidade total do plano oficial', () => {
      const validation = validateEvolutionPlan(planPath);
      assert.equal(validation.valid, true);
      assert.equal(validation.missingSections.length, 0);
      assert.equal(validation.baselineDocumented, true);
      assert.equal(validation.improvementCount, 2);
      assert.equal(validation.isStrictLimitRespected, true);
    });

    it('validateEvolutionPlan() deve rejeitar planos com mais de 2 melhorias', () => {
      const invalidPlanContent = `
# Sumário Executivo
## Baseline Documentada do Sistema
Tempo de Execução de Testes: 200ms
Cobertura de Testes Automatizados: 20
## Métricas de Referência da Baseline
## Backlog Priorizado: As 2 Melhorias de Alto Impacto
### 3.1 Melhoria 1: Teste A
### 3.2 Melhoria 2: Teste B
### 3.3 Melhoria 3: Teste C Violação
## Matriz de Rejeição / Itens Postergados
## Próximos Passos Imediatos
`;
      const validation = validateEvolutionPlan(invalidPlanContent);
      assert.equal(validation.isStrictLimitRespected, false, 'Deve rejeitar mais de 2 melhorias');
      assert.equal(validation.valid, false);
      assert.equal(validation.improvementCount, 3);
    });

    it('loadEvolutionPlan() deve falhar defensivamente para arquivo inexistente ou inválido', () => {
      assert.throws(() => loadEvolutionPlan('docs/inexistente.md'), /não encontrado/);
      assert.throws(() => loadEvolutionPlan(''), /inválido/);
      assert.throws(() => loadEvolutionPlan(null), /inválido/);
    });
  });
});
