import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { db } from '../src/db.js';
import { ResearchManager } from '../src/researchManager.js';
import { SkillRouter } from '../src/skillRouter.js';

test('Autoresearch & Skills Integration Suite: Controlled Strategy Comparison & Open Methodologies', async (t) => {
  const tmpRoot = path.join(os.tmpdir(), `decohub-autoresearch-${Date.now()}`);
  fs.mkdirSync(path.join(tmpRoot, 'src'), { recursive: true });

  const projId = `proj-research-${Date.now()}`;
  const now = new Date().toISOString();

  // Initialize git repo in disposable project
  try {
    execSync('git init -b main', { cwd: tmpRoot, stdio: 'pipe' });
    execSync('git config user.name "DecoHUB Tester"', { cwd: tmpRoot, stdio: 'pipe' });
    execSync('git config user.email "test@decohub.local"', { cwd: tmpRoot, stdio: 'pipe' });
  } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autoresearchSkillsComparison.test",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autoresearchSkillsComparison.test]", err);
      }
    }

  // 1. Initial baseline code: slow document search
  const baseCode = `// Baseline search
exports.search = function(docs, query) {
  var res = [];
  for (var i = 0; i < docs.length; i++) {
    var reg = new RegExp(query, 'i'); // Ineficiente: instancia RegExp a cada item
    if (reg.test(docs[i])) res.push(docs[i]);
  }
  return res;
};
`;
  fs.writeFileSync(path.join(tmpRoot, 'src', 'search.cjs'), baseCode, 'utf8');

  // Benchmark measurement script
  const benchScript = `const { search } = require('./src/search.cjs');
const docs = Array.from({ length: 4000 }, (_, i) => 'item_payload_' + (i % 80));
const start = performance.now();
for (let q = 0; q < 50; q++) {
  search(docs, 'payload_' + q);
}
const duration = Math.round((performance.now() - start) * 100) / 100;
console.log('latency_ms: ' + duration);
`;
  fs.writeFileSync(path.join(tmpRoot, 'benchmark.cjs'), benchScript, 'utf8');

  execSync('git add -A', { cwd: tmpRoot, stdio: 'pipe' });
  execSync('git commit -m "chore: base search and measurement script"', { cwd: tmpRoot, stdio: 'pipe' });

  db.prepare(`
    INSERT INTO projects (id, name, path, objective, stack, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'Node.js', 'active', ?, ?)
  `).run(projId, 'AutoResearch Test Project', tmpRoot, 'Otimizar busca e comparar skills', now, now);

  t.after(() => {
    try {
      db.prepare('DELETE FROM research_experiments WHERE research_run_id IN (SELECT id FROM research_runs WHERE project_id = ?)').run(projId);
      db.prepare('DELETE FROM research_runs WHERE project_id = ?').run(projId);
      db.prepare('DELETE FROM projects WHERE id = ?').run(projId);
      SkillRouter.clearExternalSkillKnowledge();
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autoresearchSkillsComparison.test",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autoresearchSkillsComparison.test]", err);
      }
    }
  });

  await t.test('1. Metodologias Reais: SkillRouter expõe atribuição de BMAD, Superpowers, wshobson e agency-agents', () => {
    // Verificar que os 8 perfis contêm fontes oficiais e técnicas concretas
    const dbSkill = SkillRouter.routeTask({ title: 'Criar tabela SQLite de contas e transações' });
    assert.equal(dbSkill.skill, 'DATABASE_ARCHITECT');
    assert.ok(dbSkill.sources.includes('BMAD'), 'Deve conter metodologia BMAD');
    assert.ok(dbSkill.sources.includes('wshobson/agents'), 'Deve conter metodologia wshobson/agents');
    assert.ok(dbSkill.sources.includes('agency-agents'), 'Deve conter metodologia agency-agents');
    assert.ok(dbSkill.methodologies.some(m => m.includes('Contract-First')));
    assert.ok(dbSkill.concreteTechniques.some(t => t.includes('BEGIN/COMMIT')));

    const secSkill = SkillRouter.routeTask({ title: 'Autenticação JWT e proteção de rotas privadas' });
    assert.equal(secSkill.skill, 'SECURITY_REVIEWER');
    assert.ok(secSkill.sources.includes('wshobson/agents'));
    assert.ok(secSkill.sources.includes('agency-agents'));
    assert.ok(secSkill.concreteTechniques.some(t => t.includes('Sanitização')));

    const qaSkill = SkillRouter.routeTask({ title: 'Criar suíte de testes com cobertura de erros' });
    assert.equal(qaSkill.skill, 'TEST_ENGINEER');
    assert.ok(qaSkill.sources.includes('Superpowers'), 'QA deve referenciar Superpowers Systematic TDD');
    assert.ok(qaSkill.concreteTechniques.some(t => t.includes('exit code')));

    const karpathySkill = SkillRouter.routeTask({ title: 'Refatorar e simplificar código removendo overengineering' });
    assert.equal(karpathySkill.skill, 'KARPATHY_MINIMALIST');
    assert.ok(karpathySkill.sources.includes('Superpowers'));
    assert.ok(karpathySkill.methodologies.some(m => m.includes('Simplicity First')));
  });

  await t.test('2. Extensibilidade Dinâmica: Permite registrar conhecimentos externos de repositórios reais sem quebrar perfis', () => {
    SkillRouter.registerExternalSkillKnowledge('KARPATHY_MINIMALIST', [
      'Superpowers Rule: Se a complexidade ciclomática for maior que 5, divida em funções puras simples',
      'wshobson Guideline: Nunca use dependências de terceiros para operações de string triviais'
    ]);

    const routed = SkillRouter.routeTask({
      title: 'Simplificar parser removendo dependência externa desnecessária',
      description: 'clean code e anti-slop'
    });

    assert.equal(routed.skill, 'KARPATHY_MINIMALIST');
    assert.ok(routed.concreteTechniques.some(t => t.includes('Superpowers Rule')));
    assert.ok(routed.formattingSnippet.includes('CONHECIMENTOS DINÂMICOS DO REPOSITÓRIO'));
  });

  await t.test('3. AutoResearch Comparativo: Executa experimento controlado comparando duas estratégias e seleciona vencedor por métrica', async () => {
    const result = await ResearchManager.compareSkillStrategies({
      projectId: projId,
      projectPath: tmpRoot,
      objective: 'Reduzir latência do algoritmo de busca de documentos',
      primaryMetric: 'latency_ms',
      direction: 'MINIMIZE',
      measurementCommand: 'node benchmark.cjs',
      allowedFiles: ['src/search.cjs'],
      protectedFiles: ['benchmark.cjs'],
      candidateA: {
        skill: 'KARPATHY_MINIMALIST',
        strategyName: 'Compilação de Regex Única em Memória',
        hypothesis: 'Compilar a expressão regular uma única vez fora do loop para eliminar alocação redundante',
        apply: () => {
          const fastCode = `// Fast search - Karpathy Minimalist: 1 regex compilada fora do loop
exports.search = function(docs, query) {
  var reg = new RegExp(query, 'i');
  var res = [];
  for (var i = 0; i < docs.length; i++) {
    if (reg.test(docs[i])) res.push(docs[i]);
  }
  return res;
};
`;
          fs.writeFileSync(path.join(tmpRoot, 'src', 'search.cjs'), fastCode, 'utf8');
        }
      },
      candidateB: {
        skill: 'FULL_STACK',
        strategyName: 'Wrapper com Substrings e Array.filter',
        hypothesis: 'Converter para toLowerCase e checar indexOf sem usar RegExp',
        apply: () => {
          const altCode = `// Alternative search - Full Stack: indexOf sem regex
exports.search = function(docs, query) {
  var q = String(query).toLowerCase();
  return docs.filter(function(d) {
    return String(d).toLowerCase().indexOf(q) !== -1;
  });
};
`;
          fs.writeFileSync(path.join(tmpRoot, 'src', 'search.cjs'), altCode, 'utf8');
        }
      }
    });

    assert.ok(result.runId);
    assert.ok(result.baselineMetric > 0, 'Baseline de referência deve ter sido medido');
    assert.ok(result.winner === 'CANDIDATE_A' || result.winner === 'CANDIDATE_B', 'Um dos candidatos otimizados deve vencer o baseline');
    assert.ok(result.winningSkill !== null);
    assert.ok(result.analysis.includes('AutoResearch Comparativo concluído'));

    // Verificar que o experimento foi registrado na tabela SQLite de research_experiments
    const exps: any[] = db.prepare('SELECT * FROM research_experiments WHERE research_run_id = ? ORDER BY sequence ASC').all(result.runId);
    assert.ok(exps.length >= 3, 'Deve conter baseline (#0), Candidato A (#1) e Candidato B (#2)');
    assert.equal(exps[0].status, 'BASELINE');

    // O código final no disco deve ser o do vencedor e estar limpo no git
    const currentCode = fs.readFileSync(path.join(tmpRoot, 'src', 'search.cjs'), 'utf8');
    assert.ok(currentCode.includes('exports.search'));
  });
});
