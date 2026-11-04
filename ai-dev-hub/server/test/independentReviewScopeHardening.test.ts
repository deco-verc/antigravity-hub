import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { db } from '../src/db.js';
import { HierarchicalOrchestrationService } from '../src/hierarchicalOrchestrationService.js';
import { DeltaFeatureEngine } from '../src/deltaFeatureEngine.js';
import { IndependentEvaluator } from '../src/independentEvaluator.js';

test('Independent Review Scope Hardening & Anti-Slop Precision Suite', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-scope-test-'));
  const projectId = 'proj-scope-' + crypto.randomUUID().slice(0, 8);
  const runId = 'run-scope-' + crypto.randomUUID().slice(0, 8);
  const now = new Date().toISOString();

  t.before(() => {
    db.prepare(`
      INSERT INTO projects (id, name, path, objective, created_at, updated_at)
      VALUES (?, 'Projeto Teste Escopo', ?, 'Testar resiliência de escopo do review', ?, ?)
    `).run(projectId, tmpDir, now, now);

    db.prepare(`
      INSERT INTO autonomous_runs (id, project_id, name, objective, status, start_time, created_at, updated_at)
      VALUES (?, ?, 'Run Teste Escopo', 'Testar escopo', 'running', ?, ?, ?)
    `).run(runId, projectId, now, now, now);
  });

  t.after(() => {
    try {
      db.prepare('DELETE FROM autonomous_tasks WHERE project_id = ?').run(projectId);
      db.prepare('DELETE FROM autonomous_runs WHERE id = ?').run(runId);
      db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  await t.test('1. Scope expansion extrai arquivos contidos no titulo da tarefa (ex: app/page.tsx)', () => {
    const taskId = 'task-scope-title-' + crypto.randomUUID().slice(0, 8);

    // Cria task que menciona app/page.tsx no título mas com allowed_scope_json restrito
    db.prepare(`
      INSERT INTO autonomous_tasks (
        id, run_id, project_id, title, objective, description,
        status, criteria_json, allowed_scope_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(
      taskId,
      runId,
      projectId,
      'Implementar Pagina Principal + Estatisticas (app/page.tsx) (Parte 2.1)',
      'Construir a pagina principal e layout base',
      'Criar os componentes essenciais',
      'in_review',
      JSON.stringify(['Pagina principal renderiza sem erros']),
      JSON.stringify(['components/Stats.tsx']) // allowed_scope_json restrito
    );

    // Worker alterou app/page.tsx (mencionado no título) e components/Stats.tsx
    const review = HierarchicalOrchestrationService.evaluateIndependentReviewDecision({
      runId,
      taskId,
      projectPath: tmpDir,
      supervisorVerdict: 'APPROVED',
      evaluationResult: {
        id: 'eval-1',
        contractId: 'contract-1',
        taskId,
        runId,
        verdict: 'PASS',
        builderStatus: 'COMPLETED',
        evaluatorVerdict: 'PASS',
        taskIsDone: true,
        passedCriteria: ['Pagina principal renderiza sem erros'],
        failedCriteria: [],
        evidence: { output: 'All tests passed' },
        expected: 'Page works',
        actual: 'OK',
        evaluatorNotes: 'Testes aprovados',
        evaluatorName: 'Evaluator',
        executedCommands: ['npm test'],
        exitCode: 0,
        durationMs: 50,
        createdAt: new Date().toISOString()
      },
      workerReport: {
        filesChanged: ['app/page.tsx', 'components/Stats.tsx'],
        implemented: ['Pagina principal'],
        testsRun: true,
        testResults: 'Pass',
        buildStatus: 'success'
      }
    });

    assert.equal(review.decision, 'APPROVED', 'Decisao deve ser APPROVED pois app/page.tsx estava no titulo');
    assert.equal(review.problemsFound.length, 0, 'Nenhum problema de escopo deve ser reportado');
  });

  await t.test('2. Intervencao Cirurgica permite edicoes em arquivos reais da raiz e backend (ex: server.js)', () => {
    const taskId = 'task-surgical-server-' + crypto.randomUUID().slice(0, 8);

    db.prepare(`
      INSERT INTO autonomous_tasks (
        id, run_id, project_id, title, objective, description,
        milestone, status, criteria_json, allowed_scope_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(
      taskId,
      runId,
      projectId,
      'Intervenção Cirúrgica: Diagnosticar e Corrigir — Chat, eu quero que tenha como limpar anuncios',
      'Corrigir rota de limpeza de dados',
      'Ajustar backend e frontend',
      'Intervenção Cirúrgica',
      'in_review',
      JSON.stringify(['Rota DELETE operacional']),
      JSON.stringify(['public/app.js'])
    );

    const review = HierarchicalOrchestrationService.evaluateIndependentReviewDecision({
      runId,
      taskId,
      projectPath: tmpDir,
      supervisorVerdict: 'APPROVED',
      evaluationResult: {
        id: 'eval-2',
        contractId: 'contract-2',
        taskId,
        runId,
        verdict: 'PASS',
        builderStatus: 'COMPLETED',
        evaluatorVerdict: 'PASS',
        taskIsDone: true,
        passedCriteria: ['Rota DELETE operacional'],
        failedCriteria: [],
        evidence: { output: 'All tests passed' },
        expected: 'Clean ads works',
        actual: 'OK',
        evaluatorNotes: 'Testes aprovados',
        evaluatorName: 'Evaluator',
        executedCommands: ['npm test'],
        exitCode: 0,
        durationMs: 40,
        createdAt: new Date().toISOString()
      },
      workerReport: {
        filesChanged: ['server.js', 'public/app.js'],
        implemented: ['Limpeza de anuncios'],
        testsRun: true,
        testResults: 'Pass',
        buildStatus: 'success'
      }
    });

    assert.equal(review.decision, 'APPROVED', 'Intervencao cirurgica em server.js deve ser APPROVED');
  });

  await t.test('3. Karpathy Principle: Testes com PASS nao sao reprovados por alteracoes em modulos auxiliares do projeto', () => {
    const taskId = 'task-karpathy-pass-' + crypto.randomUUID().slice(0, 8);

    db.prepare(`
      INSERT INTO autonomous_tasks (
        id, run_id, project_id, title, objective, description,
        status, criteria_json, allowed_scope_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(
      taskId,
      runId,
      projectId,
      'Motor WhatsApp Baileys, JID Resolver do 9º Digito e Dispatcher com Simulacao Humana e PTT',
      'Conectar Baileys e persistir no banco',
      'Implementar servico completo',
      'in_review',
      JSON.stringify(['Mensagens enviadas e registradas no banco']),
      JSON.stringify(['src/services/whatsapp.ts'])
    );

    // Worker alterou whatsapp.ts e arquivos necessarios para funcionamento real: catalog.ts, env.ts, repositories.ts
    const review = HierarchicalOrchestrationService.evaluateIndependentReviewDecision({
      runId,
      taskId,
      projectPath: tmpDir,
      supervisorVerdict: 'APPROVED',
      evaluationResult: {
        id: 'eval-3',
        contractId: 'contract-3',
        taskId,
        runId,
        verdict: 'PASS',
        builderStatus: 'COMPLETED',
        evaluatorVerdict: 'PASS',
        taskIsDone: true,
        passedCriteria: ['Mensagens enviadas e registradas no banco'],
        failedCriteria: [],
        evidence: { output: 'All tests passed' },
        expected: 'WhatsApp works',
        actual: 'OK',
        evaluatorNotes: 'Testes aprovados',
        evaluatorName: 'Evaluator',
        executedCommands: ['npm test'],
        exitCode: 0,
        durationMs: 80,
        createdAt: new Date().toISOString()
      },
      workerReport: {
        filesChanged: [
          'src/services/whatsapp.ts',
          'src/config/catalog.ts',
          'src/config/env.ts',
          'src/database/repositories.ts',
          'src/utils/phoneNormalizer.ts'
        ],
        implemented: ['Servico WhatsApp'],
        testsRun: true,
        testResults: 'Pass',
        buildStatus: 'success'
      }
    });

    assert.equal(review.decision, 'APPROVED', 'Com testes reais em PASS, deve ser APPROVED');
    assert.match(review.justification, /escopo adaptativo/i, 'Justificativa deve registrar o escopo adaptativo');
  });

  await t.test('4. DeltaFeatureEngine.planSurgicalIteration descobre pastas ativas e entrypoints na raiz', () => {
    // Cria pasta com server.js e app/
    const subProj = path.join(tmpDir, 'next-proj');
    fs.mkdirSync(path.join(subProj, 'app'), { recursive: true });
    fs.mkdirSync(path.join(subProj, 'public'), { recursive: true });
    fs.writeFileSync(path.join(subProj, 'server.js'), '// server entrypoint');
    fs.writeFileSync(path.join(subProj, 'app', 'page.tsx'), '// next page');

    const [planned] = DeltaFeatureEngine.planSurgicalIteration({
      projectPath: subProj,
      projectName: 'Next Proj',
      briefing: 'Corrigir renderizacao do feed'
    });

    assert.ok(planned.expectedScopeFiles?.includes('app/'), 'Deve incluir app/ no escopo');
    assert.ok(planned.expectedScopeFiles?.includes('server.js'), 'Deve incluir server.js no escopo');
  });

  await t.test('5. detectAntiSlop nao gera falso positivo PRODUCTION_MOCK em frontend com seed state e logica real', () => {
    const testFile = path.join(tmpDir, 'app.js');
    const richClientCode = `
      // Cliente de visualizacao de anuncios
      const mockAds = [
        { id: 1, title: 'Anuncio Teste 1', price: 99 },
        { id: 2, title: 'Anuncio Teste 2', price: 149 }
      ];

      async function loadLiveAds() {
        try {
          const res = await fetch('/api/ads');
          const data = await res.json();
          renderAds(data.items || mockAds);
        } catch (err) {
          console.error('Erro ao buscar dados:', err);
          renderAds(mockAds);
        }
      }

      function renderAds(items) {
        const container = document.getElementById('ads-container');
        if (!container) return;
        container.innerHTML = '';
        items.forEach(item => {
          const el = document.createElement('div');
          el.className = 'ad-card';
          el.innerText = item.title;
          container.appendChild(el);
        });
      }

      document.addEventListener('DOMContentLoaded', () => {
        loadLiveAds();
      });
    `;
    fs.writeFileSync(testFile, richClientCode);

    const slop = IndependentEvaluator.detectAntiSlop(tmpDir, ['app.js']);
    assert.equal(slop.hasSlop, false, 'Frontend com fetch e renderizacao real nao deve ser marcado com hasSlop');
  });

  await t.test('6. Tolerancia de escopo para arquivos auxiliares (src/models, src/services, src/helpers, src/types)', () => {
    const taskId = 'task-aux-scope-' + crypto.randomUUID().slice(0, 8);

    db.prepare(`
      INSERT INTO autonomous_tasks (
        id, run_id, project_id, title, objective, description,
        status, criteria_json, allowed_scope_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(
      taskId,
      runId,
      projectId,
      'Criar Endpoint de Faturamento e Modelagem',
      'Implementar faturamento',
      'Implementar rotas e modelos auxiliares',
      'in_review',
      JSON.stringify(['Endpoint de faturamento operacional']),
      JSON.stringify(['src/routes/billing.ts'])
    );

    const review = HierarchicalOrchestrationService.evaluateIndependentReviewDecision({
      runId,
      taskId,
      projectPath: tmpDir,
      supervisorVerdict: 'APPROVED',
      evaluationResult: {
        id: 'eval-aux',
        contractId: 'contract-aux',
        taskId,
        runId,
        verdict: 'PASS',
        builderStatus: 'COMPLETED',
        evaluatorVerdict: 'PASS',
        taskIsDone: true,
        passedCriteria: ['Endpoint de faturamento operacional'],
        failedCriteria: [],
        evidence: { output: 'All tests passed' },
        expected: 'Billing works',
        actual: 'OK',
        evaluatorNotes: 'Testes aprovados',
        evaluatorName: 'Evaluator',
        executedCommands: ['npm test'],
        exitCode: 0,
        durationMs: 60,
        createdAt: new Date().toISOString()
      },
      workerReport: {
        filesChanged: [
          'src/routes/billing.ts',
          'src/models/invoice.ts',
          'src/services/billingService.ts',
          'src/helpers/currency.ts',
          'src/types/billingTypes.ts'
        ],
        implemented: ['Faturamento'],
        testsRun: true,
        testResults: 'Pass',
        buildStatus: 'success'
      }
    });

    assert.equal(review.outOfScopeFiles.length, 0, 'Arquivos em src/models/, src/services/, src/helpers/, src/types/ nunca devem ir para outOfScopeFiles');
    assert.equal(review.decision, 'APPROVED', 'Decisao deve ser APPROVED com escopo tolerante para modulos auxiliares');
  });

  await t.test('7. Factual Proof Audit: exit code 0 sobrepoe queixas visuais subjetivas (APPROVED com nota alta)', () => {
    const taskId = 'task-factual-proof-' + crypto.randomUUID().slice(0, 8);

    db.prepare(`
      INSERT INTO autonomous_tasks (
        id, run_id, project_id, title, objective, description,
        status, criteria_json, allowed_scope_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(
      taskId,
      runId,
      projectId,
      'Motor de Exportacao CSV e Relatorios',
      'Exportar dados em CSV',
      'Criar exportador com testes unitarios',
      'in_review',
      JSON.stringify(['Testes unitarios passam com codigo 0']),
      JSON.stringify(['src/exporter.ts'])
    );

    // Supervisor tentou reprovar alegando falta de detalhes visuais, mas testes passaram com exit code 0
    const review = HierarchicalOrchestrationService.evaluateIndependentReviewDecision({
      runId,
      taskId,
      projectPath: tmpDir,
      supervisorVerdict: 'CHANGES_REQUESTED',
      supervisorFeedback: 'Reprovado por falta de detalhes visuais no dashboard e paleta de cores.',
      evaluationResult: {
        id: 'eval-factual',
        contractId: 'contract-factual',
        taskId,
        runId,
        verdict: 'PASS',
        builderStatus: 'COMPLETED',
        evaluatorVerdict: 'PASS',
        taskIsDone: true,
        passedCriteria: ['Testes unitarios passam com codigo 0'],
        failedCriteria: [],
        evidence: { output: 'All unit tests passed with exit code 0' },
        expected: 'Exporter works',
        actual: 'OK',
        evaluatorNotes: 'Testes aprovados com codigo 0',
        evaluatorName: 'Evaluator',
        executedCommands: ['npm test'],
        exitCode: 0,
        durationMs: 45,
        createdAt: new Date().toISOString()
      },
      workerReport: {
        filesChanged: ['src/exporter.ts'],
        implemented: ['Exportador CSV'],
        testsRun: true,
        testResults: 'Pass',
        buildStatus: 'success'
      }
    });

    assert.equal(review.decision, 'APPROVED', 'Proibicao de reprovar tarefa aprovada nos testes por falta de detalhes visuais');
  });

  await t.test('8. Formatacao obrigatoria de root-cause em CHANGES_REQUESTED contem os 3 blocos estruturados', () => {
    const formatted = IndependentEvaluator.formatStructuredFeedback({
      falha: 'Compilacao falhou',
      causaRaiz: "Type 'null' is not assignable to type 'string'",
      acaoRequerida: 'Tipar variavel como string | null',
      fileAndLine: 'src/user.ts:42',
      realError: "Type 'null' is not assignable to type 'string'",
      surgicalDirective: 'Ajustar a tipagem em src/user.ts:42 para aceitar null.'
    });

    assert.ok(formatted.includes('[ARQUIVO E LINHA]: src/user.ts:42'), 'Deve conter [ARQUIVO E LINHA]');
    assert.ok(formatted.includes("[ERRO REAL]: Type 'null' is not assignable to type 'string'"), 'Deve conter [ERRO REAL]');
    assert.ok(formatted.includes('[DIRETRIZ CIRÚRGICA]: Ajustar a tipagem em src/user.ts:42 para aceitar null.'), 'Deve conter [DIRETRIZ CIRÚRGICA]');
  });

  await t.test('9. Varredura ativa de placeholders e mocks em producao sob src/ emite CHANGES_REQUESTED', () => {
    const todoFile = path.join(tmpDir, 'src', 'todoEndpoint.ts');
    fs.mkdirSync(path.dirname(todoFile), { recursive: true });
    fs.writeFileSync(todoFile, `
      // TODO: implementar depois
      export function getItems() {
        return [];
      }
    `);

    const slopCheck = IndependentEvaluator.detectAntiSlop(tmpDir, ['src/todoEndpoint.ts']);
    assert.equal(slopCheck.hasSlop, true, 'Deve identificar hasSlop como true');
    assert.ok(
      slopCheck.findings.some(f => f.details.includes('[FALHA ANTI-SLOP]: Arquivo src/todoEndpoint.ts contém código estático/placeholder. Implemente a lógica real antes de submeter.')),
      'Mensagem exata de [FALHA ANTI-SLOP] deve constar nos findings'
    );

    const taskId = 'task-anti-slop-prod-' + crypto.randomUUID().slice(0, 8);
    db.prepare(`
      INSERT INTO autonomous_tasks (
        id, run_id, project_id, title, objective, description,
        status, criteria_json, allowed_scope_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(
      taskId,
      runId,
      projectId,
      'Criar Endpoint Real',
      'Persistência SQLite de Itens',
      'Criar rota real',
      'in_review',
      JSON.stringify(['Rota operacional']),
      JSON.stringify(['src/todoEndpoint.ts'])
    );

    const review = HierarchicalOrchestrationService.evaluateIndependentReviewDecision({
      runId,
      taskId,
      projectPath: tmpDir,
      workerReport: {
        filesChanged: ['src/todoEndpoint.ts'],
        implemented: ['Endpoint'],
        testsRun: true,
        testResults: 'Pass',
        buildStatus: 'success'
      }
    });

    assert.equal(review.decision, 'REJECTED', 'Deve rejeitar entrega com placeholder');
    assert.equal(review.verdict, 'CHANGES_REQUESTED', 'Veredicto estruturado deve ser CHANGES_REQUESTED');
    assert.ok(
      review.problemsFound.some(p => p.includes('[FALHA ANTI-SLOP]: Arquivo src/todoEndpoint.ts contém código estático/placeholder. Implemente a lógica real antes de submeter.')),
      'problemsFound deve incluir a mensagem factual de [FALHA ANTI-SLOP]'
    );
  });

  await t.test('10. Auditoria factual de testes: rejeita testes ocos com apenas process.exit(0) ou try/catch vazios', () => {
    const hollowTestFile = path.join(tmpDir, 'test', 'hollow.test.js');
    fs.mkdirSync(path.dirname(hollowTestFile), { recursive: true });
    fs.writeFileSync(hollowTestFile, `
      // Teste oco sem assercoes
      try {
        console.log('Running hollow test');
        process.exit(0);
      } catch (err) {
      }
    `);

    const slopCheck = IndependentEvaluator.detectAntiSlop(tmpDir, ['test/hollow.test.js']);
    assert.equal(slopCheck.hasSlop, true, 'Teste sem assercoes reais deve ser marcado com hasSlop');
    assert.ok(
      slopCheck.findings.some(f => f.type === 'HOLLOW_TEST'),
      'Deve catalogar como HOLLOW_TEST'
    );
    assert.ok(
      slopCheck.findings.some(f => f.details.includes('[FALHA ANTI-SLOP]: Arquivo de teste test/hollow.test.js é oco ou não contém asserções reais')),
      'Deve detalhar que o arquivo de teste e oco'
    );
  });
});
