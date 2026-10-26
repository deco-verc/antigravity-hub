import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { db } from '../src/db.js';
import { CouncilManager } from '../src/councilManager.js';
import { PromotionCouncil } from '../src/promotionCouncil.js';
import { SkillSlashCommandService } from '../src/skillSlashCommandService.js';

test('AI DEV Council 3-Stage Deliberation Architecture Suite', async (t) => {
  const tmpRoot = path.join(os.tmpdir(), `decohub-council-3stage-${Date.now()}`);
  fs.mkdirSync(tmpRoot, { recursive: true });

  const projId = `proj-council-3stage-${Date.now()}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO projects (id, name, path, objective, stack, is_trusted, full_dev_autonomy, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'Node/TypeScript', 1, 1, 'active', ?, ?)
  `).run(projId, 'Council 3-Stage Test Project', tmpRoot, 'Validar arquitetura de 3 estágios do conselho', now, now);

  t.after(() => {
    try {
      db.prepare('DELETE FROM council_deliberations WHERE project_id = ?').run(projId);
      db.prepare('DELETE FROM projects WHERE id = ?').run(projId);
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {}
  });

  await t.test('1. parseRankingFromText: Extrai rankings estruturados e fallbacks em conformidade com council.py', () => {
    // 1. Formato canônico padrão do council.py com "FINAL RANKING:" e lista numerada
    const canonicalText = `
Response A has strong technical details on security.
Response B is ultra simple and adheres to Karpathy simplicity.
Response C catches regression edge cases.

FINAL RANKING:
1. Response B
2. Response A
3. Response C
    `;
    const parsedCanonical = CouncilManager.parseRankingFromText(canonicalText);
    assert.deepEqual(parsedCanonical, ['Response B', 'Response A', 'Response C']);

    // 2. Formato com prefixo "Review" em vez de "Response"
    const reviewPrefixText = `
Análise comparativa detalhada.
FINAL RANKING:
1. Review C
2. Review B
3. Review A
    `;
    const parsedReview = CouncilManager.parseRankingFromText(reviewPrefixText);
    assert.deepEqual(parsedReview, ['Review C', 'Review B', 'Review A']);

    // 3. Fallback no texto quando não há cabeçalho estrito "FINAL RANKING:"
    const fallbackText = `Revisando: Response C se destacou, seguida por Response A e depois Response B.`;
    const parsedFallback = CouncilManager.parseRankingFromText(fallbackText);
    assert.deepEqual(parsedFallback, ['Response C', 'Response A', 'Response B']);

    // 4. Texto sem menção de respostas
    const emptyText = `Nenhuma resposta mencionada explicitamente.`;
    const parsedEmpty = CouncilManager.parseRankingFromText(emptyText);
    assert.deepEqual(parsedEmpty, []);
  });

  await t.test('2. calculateAggregateRankings: Calcula média ponderada de posições e ordena menor rank primeiro', () => {
    const labelToRoleMap = {
      'Response A': 'Correctness',
      'Response B': 'Simplicity',
      'Response C': 'Regression'
    };

    // 3 revisores votando:
    // Rev 1: B (pos 1), A (pos 2), C (pos 3)
    // Rev 2: B (pos 1), C (pos 2), A (pos 3)
    // Rev 3: A (pos 1), B (pos 2), C (pos 3)
    //
    // Médias:
    // Simplicity (B): [1, 1, 2] -> 4/3 = 1.33
    // Correctness (A): [2, 3, 1] -> 6/3 = 2.00
    // Regression (C): [3, 2, 3] -> 8/3 = 2.67
    const stage2Results = [
      {
        reviewer: 'Reviewer A',
        ranking: 'FINAL RANKING:\n1. Response B\n2. Response A\n3. Response C'
      },
      {
        reviewer: 'Reviewer B',
        ranking: 'FINAL RANKING:\n1. Response B\n2. Response C\n3. Response A'
      },
      {
        reviewer: 'Reviewer C',
        ranking: 'FINAL RANKING:\n1. Response A\n2. Response B\n3. Response C'
      }
    ];

    const aggregate = CouncilManager.calculateAggregateRankings(stage2Results, labelToRoleMap);

    assert.equal(aggregate.length, 3);
    assert.equal(aggregate[0].role, 'Simplicity');
    assert.equal(aggregate[0].averageRank, 1.33);
    assert.equal(aggregate[1].role, 'Correctness');
    assert.equal(aggregate[1].averageRank, 2.0);
    assert.equal(aggregate[2].role, 'Regression');
    assert.equal(aggregate[2].averageRank, 2.67);
  });

  await t.test('3. Council Deliberation & SQLite Persistence: Salva e recupera actionItems fielmente', async () => {
    const taskId = `task-persist-${Date.now()}`;
    const diff = `+ function calculateTax(val) { return val * 0.15; }`;
    const evalEvidence = {
      taskIsDone: true,
      verdict: 'PASS',
      actual: 'Exit Code: 0 (PASS)'
    };

    const deliberation = await CouncilManager.deliberate({
      taskId,
      projectId: projId,
      task: { title: 'Implementar cálculo fiscal' },
      diff,
      filesChanged: ['src/tax.js'],
      evaluation: evalEvidence as any,
      riskLevel: 'medium',
      policyTrigger: 'CODE_REVIEW',
      options: { forceHeuristic: true }
    });

    assert.ok(deliberation.id);
    assert.equal(deliberation.chairmanVerdict, 'APPROVED');
    assert.equal(deliberation.reviews.length, 3);
    assert.equal(deliberation.peerRankings.length, 3);
    assert.ok(deliberation.actionItems.length > 0, 'Deliberação deve conter itens de ação');

    // Recuperar do banco via getDeliberation e verificar que actionItems NÃO foram perdidos
    const retrieved = CouncilManager.getDeliberation(deliberation.id);
    assert.ok(retrieved, 'Deliberação deve ser recuperada do SQLite');
    assert.equal(retrieved.id, deliberation.id);
    assert.equal(retrieved.chairmanVerdict, deliberation.chairmanVerdict);
    assert.deepEqual(retrieved.actionItems, deliberation.actionItems, 'actionItems devem ser preservados fielmente');
    assert.equal(retrieved.peerRankings.length, 3, 'peerRankings devem ser restaurados com exatidão');
  });

  await t.test('4. deliberateQuery: Conduz deliberação livre multi-perspectiva para propostas arquiteturais', async () => {
    const queryResult = await CouncilManager.deliberateQuery(
      'Adotar arquitetura de eventos assíncronos com Outbox Pattern no SQLite',
      { projectId: projId, forceHeuristic: true }
    );

    assert.ok(queryResult.query.includes('Outbox Pattern'));
    assert.equal(queryResult.stage1Reviews.length, 3);
    assert.equal(queryResult.stage2PeerRankings.length, 3);
    assert.ok(queryResult.aggregateRankings.length > 0);
    assert.ok(queryResult.chairmanVerdict);
    assert.ok(queryResult.actionItems.length > 0);
  });

  await t.test('5. PromotionCouncil: Tradeoff review contém pareceres e peer ranking cruzado', () => {
    const tradeoffEval = {
      targetMetric: {
        name: 'test_execution_speed',
        actualImprovementPct: 35.0
      },
      globalImpact: {
        deltaTotalDurationPct: 3.5,
        deltaTotalDurationMs: 350
      },
      collateralRegressions: []
    };

    const synthesis = PromotionCouncil.reviewTradeoff(tradeoffEval as any);
    assert.ok(synthesis.recommendation);
    assert.equal(synthesis.memberOpinions.length, 3);
    assert.ok(synthesis.peerRankings && synthesis.peerRankings.length === 3, 'Deve conter 3 avaliações de peer ranking');
  });

  await t.test('6. Slash Command /council e Provisionamento de Skills no Workspace', async () => {
    // 1. Verificar catálogo oficial de slash commands
    const councilDef = SkillSlashCommandService.SLASH_COMMANDS_REGISTRY.find(c => c.command === '/council');
    assert.ok(councilDef, 'Comando /council deve estar registrado no catálogo');
    assert.ok(councilDef.skillsUsed.includes('llm-council'));
    assert.ok(councilDef.skillsUsed.includes('karpathy-guidelines'));

    // 2. Provisionar skills para o projeto de teste
    const provRes = SkillSlashCommandService.provisionSkillsForProject(tmpRoot, ['karpathy-guidelines', 'llm-council']);
    assert.ok(provRes.copiedSkills.includes('karpathy-guidelines.md'));
    assert.ok(provRes.copiedSkills.includes('llm-council.md'));

    // 3. Validar arquivos nativos Antigravity 2.0 em .agents/skills/
    const karpathySkillFile = path.join(tmpRoot, '.agents', 'skills', 'karpathy-guidelines', 'SKILL.md');
    assert.ok(fs.existsSync(karpathySkillFile), 'Native SKILL.md de karpathy-guidelines deve existir');
    const karpathyContent = fs.readFileSync(karpathySkillFile, 'utf-8');
    assert.ok(karpathyContent.startsWith('---'), 'SKILL.md deve conter frontmatter YAML');
    assert.ok(/name:\s*karpathy-guidelines/.test(karpathyContent), 'Frontmatter deve conter name');

    const karpathyExamplesFile = path.join(tmpRoot, '.agents', 'skills', 'karpathy-guidelines', 'examples', 'EXAMPLES.md');
    assert.ok(fs.existsSync(karpathyExamplesFile), 'examples/EXAMPLES.md de karpathy-guidelines deve existir');

    const councilSkillFile = path.join(tmpRoot, '.agents', 'skills', 'llm-council', 'SKILL.md');
    assert.ok(fs.existsSync(councilSkillFile), 'Native SKILL.md de llm-council deve existir');
    const councilContent = fs.readFileSync(councilSkillFile, 'utf-8');
    assert.ok(councilContent.startsWith('---'), 'SKILL.md deve conter frontmatter YAML');
    assert.ok(/name:\s*llm-council/.test(councilContent), 'Frontmatter deve conter name');

    // 4. Executar comando /council via handleSlashCommand
    const cmdResult = await SkillSlashCommandService.handleSlashCommand({
      projectId: projId,
      projectPath: tmpRoot,
      command: '/council',
      args: 'Avaliar introdução de cache em memória para leituras frequentes',
      fullMessage: '/council Avaliar introdução de cache em memória para leituras frequentes'
    });

    assert.ok(cmdResult.replyContent.includes('AI DEV Council: Deliberação em 3 Estágios'));
    assert.ok(cmdResult.replyContent.includes('Estágio 1'));
    assert.ok(cmdResult.replyContent.includes('Estágio 2'));
    assert.ok(cmdResult.replyContent.includes('Estágio 3'));
    assert.ok(cmdResult.replyContent.includes('Ações Recomendadas'));
    assert.ok(cmdResult.metadata?.verdict);
  });
});
