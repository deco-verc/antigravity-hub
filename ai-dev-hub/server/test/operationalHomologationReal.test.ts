import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 1. ISOLAMENTO TOTAL DO BANCO DE DADOS: DECOHUB_DATA_DIR deve ser configurado
// ANTES de carregar o módulo db.js para garantir que o banco de produção (hub.db) nunca seja tocado.
const ISOLATED_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-homolog-data-'));
process.env.DECOHUB_DATA_DIR = ISOLATED_DATA_DIR;
process.env.DECOHUB_OFFLINE_MODE = 'true';

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import { execFileSync } from 'node:child_process';

function initGitWorkspace(dir: string, branch = 'main') {
  execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'homologacao@decohub.local'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'DecoHUB Homolog Auditor'], { cwd: dir, stdio: 'pipe' });
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify(
      {
        name: 'app-financeiro-homologacao',
        version: '1.0.0',
        scripts: {
          test: 'node --test test/*.test.cjs'
        }
      },
      null,
      2
    ),
    'utf-8'
  );
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'test'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', '.gitkeep'), '', 'utf-8');
  fs.writeFileSync(path.join(dir, 'test', '.gitkeep'), '', 'utf-8');
  execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'chore: initial repository structure for financial app'], { cwd: dir, stdio: 'pipe' });
  if (branch !== 'main') {
    execFileSync('git', ['checkout', '-b', branch], { cwd: dir, stdio: 'pipe' });
  }
}

test('HOMOLOGAÇÃO OPERACIONAL REAL — Orquestração Hierárquica Autônoma do DecoHUB', async (t) => {
  const { db, initDatabase } = await import('../src/db.js');
  const { apiRouter } = await import('../src/routes.js');
  const { AutonomousManager } = await import('../src/autonomousManager.js');
  const { HierarchicalOrchestrationService } = await import('../src/hierarchicalOrchestrationService.js');
  const { IndependentEvaluator } = await import('../src/independentEvaluator.js');
  const { DevAutonomyService } = await import('../src/devAutonomyService.js');
  const { AutonomousRunnerService } = await import('../src/autonomousRunnerService.js');
  const { AntigravityDiscovery } = await import('../src/antigravityDiscovery.js');
  const { AgentApiGateway } = await import('../src/agentApiGateway.js');

  initDatabase();

  // 1. Verificações preliminares de ambiente e isolamento
  const discovery = AntigravityDiscovery.discover();
  assert.equal(discovery.available, true, 'Antigravity discovery deve encontrar language_server.exe disponível');
  assert.equal(discovery.status, 'READY', 'Status do Antigravity deve ser READY');
  assert.ok(discovery.languageServerExe, 'Caminho do executável language_server.exe deve estar presente');

  // Workspace descartável e branch exclusiva
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-app-financeiro-homolog-'));
  const homologBranch = 'homologacao/hierarchical-autonomy';
  initGitWorkspace(workspaceDir, homologBranch);

  t.after(() => {
    try { fs.rmSync(workspaceDir, { recursive: true, force: true }); } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "operationalHomologationReal.test",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:operationalHomologationReal.test]", err);
      }
    }
    try { fs.rmSync(ISOLATED_DATA_DIR, { recursive: true, force: true }); } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "operationalHomologationReal.test",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:operationalHomologationReal.test]", err);
      }
    }
  });

  // Inicializa servidor express com rotas oficiais para teste HTTP real
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);

  const server = app.listen(0);
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}/api`;
  t.after(() => server.close());

  // Registros de telemetria da homologação
  const executionTelemetry: {
    projectId: string;
    runId: string;
    briefing: string;
    timestamps: Record<string, string>;
    commits: Array<{ taskId: string; code: string; title: string; sha: string; message: string }>;
    rejections: Array<{ taskId: string; attempt: number; feedback: string; verdict: string }>;
    approvals: Array<{ taskId: string; attempt: number; verdict: string; commitSha: string }>;
    stateTransitionsCount: number;
    agentMessagesCount: number;
  } = {
    projectId: '',
    runId: '',
    briefing: 'Quero um aplicativo financeiro simples para registrar receitas e despesas, categorizar transações e visualizar o saldo atualizado automaticamente em um painel.',
    timestamps: {},
    commits: [],
    rejections: [],
    approvals: [],
    stateTransitionsCount: 0,
    agentMessagesCount: 0
  };

  executionTelemetry.timestamps['homologation_start'] = new Date().toISOString();

  // Configura o Mock Provider com respostas específicas do Supervisor para planejamento e revisão
  const mock = AgentApiGateway.installDefaultMock();
  mock.responseProvider = (_convId, mode) => {
    if (mode === 'PLAN') {
      return JSON.stringify([
        {
          title: 'Implementar motor de receitas, despesas, categorias e saldo',
          description: 'Implementar cadastro de receitas e despesas por categoria e cálculo automático de saldo em src/financeEngine.cjs',
          milestone: 'GT-1',
          orderIndex: 1,
          dependencies: [],
          criteria: [
            'addTransaction registra receitas e despesas com categoria',
            'getSummary calcula totalIncome, totalExpense, balance e byCategory automaticamente'
          ],
          verificationCommand: 'npm test',
          doneWhen: 'Testes unitários do motor financeiro passando com exit code 0'
        },
        {
          title: 'Criar painel de resumo e formulário de lançamento',
          description: 'Criar gerador do painel de resumo HTML com cards de receitas, despesas, categorias e saldo em src/dashboardView.cjs e src/dashboard.html',
          milestone: 'GT-2',
          orderIndex: 2,
          dependencies: ['Implementar motor de receitas, despesas, categorias e saldo'],
          criteria: [
            'renderDashboardSummary gera HTML com total de receitas, despesas, categorias e saldo',
            'Arquivo src/dashboard.html contém estrutura do painel de resumo e formulário'
          ],
          verificationCommand: 'npm test',
          doneWhen: 'Painel de resumo e formulário gerados e validados por testes'
        }
      ]);
    }
    return JSON.stringify({
      verdict: 'APPROVED',
      feedback: 'Revisão aprovada com base em evidências verificáveis.',
      nextAction: 'Concluir projeto'
    });
  };

  // ETAPA 1: Criar projeto pelo fluxo oficial (POST /api/projects)
  const projectCreateRes = await fetch(`${baseUrl}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'App Financeiro Homologação Real',
      folderPath: workspaceDir,
      objective: executionTelemetry.briefing,
      isTrusted: true,
      fullDevAutonomy: true
    })
  });
  assert.equal(projectCreateRes.status, 201, 'POST /projects deve retornar 201 Created');
  const projectCreated: any = await projectCreateRes.json();
  const projectId = projectCreated.id;
  executionTelemetry.projectId = projectId;
  assert.ok(projectId, 'ID do projeto deve existir');

  // Configura autonomia total e projeto confiável via serviço oficial
  DevAutonomyService.setProjectAutonomy(projectId, true, true);

  // ETAPA 2: Usuário envia a descrição pelo chat do projeto (POST /api/projects/:id/messages)
  executionTelemetry.timestamps['user_chat_submitted'] = new Date().toISOString();
  const chatRes = await fetch(`${baseUrl}/projects/${projectId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: executionTelemetry.briefing,
      role: 'user'
    })
  });
  assert.equal(chatRes.status, 200, 'POST /projects/:id/messages deve retornar 200 OK');
  const chatBody: any = await chatRes.json();
  assert.ok(chatBody.userMessage, 'Mensagem do usuário deve ser persistida');
  assert.equal(chatBody.userMessage.content, executionTelemetry.briefing);

  // Verifica se o projeto e o Run preservaram a descrição original
  const projectRow: any = db.prepare('SELECT objective, description FROM projects WHERE id = ?').get(projectId);
  assert.equal(projectRow.objective, executionTelemetry.briefing, 'O projeto deve receber e preservar a descrição original');

  const runId = chatBody.autonomousRun?.id;
  assert.ok(runId, 'Autonomous Run deve ter sido gerado a partir do chat');
  executionTelemetry.runId = runId;

  const runRow: any = db.prepare('SELECT briefing, objective FROM autonomous_runs WHERE id = ?').get(runId);
  assert.equal(runRow.briefing, executionTelemetry.briefing, 'O Run deve receber e preservar o briefing original');

  // ETAPA 3: O Supervisor produz Grandes Tarefas e Microtarefas com critérios verificáveis
  executionTelemetry.timestamps['supervisor_plan_persisted'] = new Date().toISOString();
  const hierRes = await fetch(`${baseUrl}/autonomous/runs/${runId}/hierarchy`);
  assert.equal(hierRes.status, 200);
  const initialHierarchy: any = await hierRes.json();

  assert.ok(initialHierarchy.majorTasks.length >= 2, 'Supervisor deve gerar pelo menos 2 Grandes Tarefas (Regras de Negócio e Interface Visual)');
  assert.ok(initialHierarchy.tasks.length >= 2, 'Supervisor deve gerar pelo menos 2 Microtarefas correspondentes');

  // Valida que cada microtarefa possui critérios objetivos, comando de verificação e doneWhen
  for (const mt of initialHierarchy.tasks) {
    const criteria = JSON.parse(mt.criteria_json || '[]');
    assert.ok(criteria.length >= 1, `Microtarefa ${mt.code} deve ter critérios verificáveis`);
    assert.ok(mt.verification_command, `Microtarefa ${mt.code} deve ter verification_command`);
    assert.ok(mt.done_when, `Microtarefa ${mt.code} deve ter done_when explícito`);
    assert.ok(mt.contract_id, `Microtarefa ${mt.code} deve ter SuccessContract vinculado`);
  }

  const mt1_1 = initialHierarchy.tasks[0];
  const mt2_1 = initialHierarchy.tasks[1];

  // ETAPA 4: CASO OBRIGATÓRIO — Tentativa de avançar tarefa com dependência não satisfeita (DEVE SER BLOQUEADA)
  const availableInitial = AutonomousManager.getAvailableTasks(runId);
  assert.equal(availableInitial.length, 1, 'Apenas a primeira microtarefa (sem dependências) deve estar elegível inicialmente');
  assert.equal(availableInitial[0].id, mt1_1.id);
  assert.ok(
    !availableInitial.some((t: any) => t.id === mt2_1.id),
    'Microtarefa 2.1 não pode estar disponível enquanto 1.1 estiver pendente'
  );

  // Tentativa de reivindicação ou transição prematura da microtarefa dependente
  assert.throws(
    () => {
      HierarchicalOrchestrationService.transitionTaskState({
        taskId: mt2_1.id,
        toState: 'IN_PROGRESS',
        actor: 'worker',
        reason: 'Tentativa não autorizada de avançar tarefa com dependências pendentes'
      });
    },
    /DEPENDENCY_UNSATISFIED|INVALID_STATE_TRANSITION/,
    'Tentativa de transicionar microtarefa com dependência não satisfeita deve ser barrada pelo orquestrador'
  );

  // ETAPA 5: CASO OBRIGATÓRIO — Reprovação legítima do Review com ciclo de correção e posterior aprovação (Microtarefa 1.1)
  executionTelemetry.timestamps['mt1_1_dispatched'] = new Date().toISOString();
  AutonomousManager.claimTask(mt1_1.id, 'worker-finance-engine');

  // Tentativa 1: Worker entrega código incompleto com stub placeholder
  fs.mkdirSync(path.join(workspaceDir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(workspaceDir, 'test'), { recursive: true });

  fs.writeFileSync(
    path.join(workspaceDir, 'src', 'financeEngine.cjs'),
    '// TODO: implementar cálculo real de saldo\nmodule.exports = { createFinanceStore: () => ({}) };\n',
    'utf-8'
  );
  fs.writeFileSync(
    path.join(workspaceDir, 'test', 'finance.test.cjs'),
    "const test = require('node:test');\ntest('stub test placeholder', () => {});\n",
    'utf-8'
  );

  AutonomousManager.submitBuilderReport({
    runId,
    taskId: mt1_1.id,
    status: 'success',
    filesChanged: ['src/financeEngine.cjs', 'test/finance.test.cjs'],
    implemented: ['Tentativa 1 com stub incompleto']
  });

  const eval1_Attempt1 = await IndependentEvaluator.evaluate(mt1_1.contract_id, workspaceDir, {
    status: 'success',
    filesChanged: ['src/financeEngine.cjs', 'test/finance.test.cjs'],
    implemented: ['Tentativa 1 com stub incompleto']
  });

  const review1_Attempt1 = AutonomousManager.submitSupervisorReview({
    runId,
    taskId: mt1_1.id,
    verdict: 'CHANGES_REQUESTED',
    feedback: 'Reprovado pelo Review Independente: src/financeEngine.cjs contém placeholder TODO e não calcula receitas, despesas nem saldo.',
    criteriaMet: [],
    criteriaFailed: [
      'addTransaction registra receitas e despesas com categoria',
      'getSummary calcula totalIncome, totalExpense, balance e byCategory automaticamente'
    ],
    issuesFound: ['Placeholder TODO encontrado em src/financeEngine.cjs'],
    nextAction: 'Implementar createFinanceStore completo com addTransaction e getSummary reais',
    evaluation: eval1_Attempt1
  });

  assert.equal(review1_Attempt1.reviewDecision.decision, 'REJECTED', 'Tentativa 1 da MT-1.1 deve ser REJECTED pelo Review');
  assert.ok(!review1_Attempt1.commitGate || !review1_Attempt1.commitGate.committed, 'Nenhum commit pode ser gerado em caso de reprovação');
  assert.equal(review1_Attempt1.commitGate?.commitSha, undefined);
  const mt1RowAfterRejection: any = db.prepare('SELECT task_commit_sha FROM autonomous_tasks WHERE id = ?').get(mt1_1.id);
  assert.equal(mt1RowAfterRejection.task_commit_sha, null);

  executionTelemetry.rejections.push({
    taskId: mt1_1.id,
    attempt: 1,
    feedback: review1_Attempt1.reviewDecision.feedback,
    verdict: review1_Attempt1.reviewDecision.decision
  });

  // Verifica que o contrato de retrabalho foi gerado com as correções solicitadas
  const reworkContract = HierarchicalOrchestrationService.buildWorkerExecutionContract(runId, mt1_1.id);
  assert.equal(reworkContract.attemptNumber, 2, 'Contrato da tentativa 2 deve registrar attemptNumber = 2');
  assert.equal(reworkContract.reworkContext?.previousDecision, 'REJECTED');
  assert.ok(reworkContract.reworkContext?.failedCriteria?.length! >= 1);

  // Tentativa 2: Worker corrige com implementação completa e testes reais
  AutonomousManager.claimTask(mt1_1.id, 'worker-finance-engine');

  fs.writeFileSync(
    path.join(workspaceDir, 'src', 'financeEngine.cjs'),
    [
      'const fs = require("node:fs");',
      'function createFinanceStore() {',
      '  const transactions = [];',
      '  function addTransaction({ description, amount, type, category }) {',
      '    const val = Number(amount);',
      '    if (!description || Number.isNaN(val) || val <= 0) {',
      '      throw new Error("INVALID_TRANSACTION");',
      '    }',
      '    if (type !== "income" && type !== "expense") {',
      '      throw new Error("INVALID_TYPE");',
      '    }',
      '    const entry = {',
      '      id: String(transactions.length + 1),',
      '      description: String(description).trim(),',
      '      amount: val,',
      '      type,',
      '      category: String(category || "Geral").trim()',
      '    };',
      '    transactions.push(entry);',
      '    try { fs.writeFileSync("transactions.json", JSON.stringify(transactions)); } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "operationalHomologationReal.test",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:operationalHomologationReal.test]", err);
      }
    }',
      '    return entry;',
      '  }',
      '  function getSummary() {',
      '    let totalIncome = 0;',
      '    let totalExpense = 0;',
      '    const byCategory = {};',
      '    for (const tx of transactions) {',
      '      if (tx.type === "income") totalIncome += tx.amount;',
      '      else totalExpense += tx.amount;',
      '      byCategory[tx.category] = (byCategory[tx.category] || 0) + (tx.type === "income" ? tx.amount : -tx.amount);',
      '    }',
      '    return {',
      '      totalIncome,',
      '      totalExpense,',
      '      balance: totalIncome - totalExpense,',
      '      byCategory,',
      '      count: transactions.length,',
      '      transactions: [...transactions]',
      '    };',
      '  }',
      '  return { addTransaction, getSummary };',
      '}',
      'module.exports = { createFinanceStore };',
      ''
    ].join('\n'),
    'utf-8'
  );

  fs.writeFileSync(
    path.join(workspaceDir, 'test', 'finance.test.cjs'),
    [
      "const test = require('node:test');",
      "const assert = require('node:assert/strict');",
      "const { createFinanceStore } = require('../src/financeEngine.cjs');",
      "test('financeEngine addTransaction and automatic balance calculation', () => {",
      "  const store = createFinanceStore();",
      "  store.addTransaction({ description: 'Salário', amount: 5000, type: 'income', category: 'Renda' });",
      "  store.addTransaction({ description: 'Aluguel', amount: 1800, type: 'expense', category: 'Moradia' });",
      "  store.addTransaction({ description: 'Mercado', amount: 700, type: 'expense', category: 'Alimentação' });",
      "  const summary = store.getSummary();",
      "  assert.equal(summary.totalIncome, 5000);",
      "  assert.equal(summary.totalExpense, 2500);",
      "  assert.equal(summary.balance, 2500);",
      "  assert.equal(summary.byCategory['Renda'], 5000);",
      "  assert.equal(summary.byCategory['Moradia'], -1800);",
      "});",
      ""
    ].join('\n'),
    'utf-8'
  );

  AutonomousManager.submitBuilderReport({
    runId,
    taskId: mt1_1.id,
    status: 'success',
    filesChanged: ['src/financeEngine.cjs', 'test/finance.test.cjs'],
    implemented: ['Implementado createFinanceStore com addTransaction, categorias e cálculo automático de saldo'],
    testsRun: 'npm test',
    testResults: '1 passing'
  });

  const eval1_Attempt2 = await IndependentEvaluator.evaluate(mt1_1.contract_id, workspaceDir, {
    status: 'success',
    filesChanged: ['src/financeEngine.cjs', 'test/finance.test.cjs'],
    implemented: ['Implementado createFinanceStore com addTransaction, categorias e cálculo automático de saldo']
  });
  assert.equal(eval1_Attempt2.verdict, 'PASS', 'Evaluator deve aprovar a entrega corrigida');

  const review1_Attempt2 = AutonomousManager.submitSupervisorReview({
    runId,
    taskId: mt1_1.id,
    verdict: 'APPROVED',
    feedback: 'Microtarefa 1.1 aprovada com evidências verificáveis após retrabalho.',
    criteriaMet: [
      'addTransaction registra receitas e despesas com categoria',
      'getSummary calcula totalIncome, totalExpense, balance e byCategory automaticamente'
    ],
    criteriaFailed: [],
    evaluation: eval1_Attempt2
  });
  assert.equal(review1_Attempt2.reviewDecision.decision, 'APPROVED');
  assert.equal(review1_Attempt2.commitGate?.committed, true, 'Commit Git deve ser criado obrigatoriamente após aprovação');
  const sha1_1 = review1_Attempt2.commitGate?.commitSha!;
  assert.ok(sha1_1, 'SHA do commit deve existir');

  executionTelemetry.approvals.push({
    taskId: mt1_1.id,
    attempt: 2,
    verdict: 'APPROVED',
    commitSha: sha1_1
  });
  executionTelemetry.commits.push({
    taskId: mt1_1.id,
    code: mt1_1.code || '1.1',
    title: mt1_1.title,
    sha: sha1_1,
    message: review1_Attempt2.commitGate?.commitMessage || ''
  });

  // ETAPA 6: CASO OBRIGATÓRIO — Reinicialização / Recuperação de estado durante a execução para testar persistência
  executionTelemetry.timestamps['crash_recovery_tested'] = new Date().toISOString();
  AutonomousRunnerService.recoverInterruptedRuns();

  const reconstructed = HierarchicalOrchestrationService.reconstructPlanState(runId);
  assert.equal(reconstructed.run.id, runId);
  const recoveredMt1_1 = reconstructed.microtasks.find(t => t.id === mt1_1.id);
  assert.equal(recoveredMt1_1.status, 'completed', 'Microtarefa 1.1 deve permanecer completed após restart');
  assert.equal(recoveredMt1_1.task_commit_sha, sha1_1, 'Commit SHA deve ser preservado após reinicialização');

  // ETAPA 7: CASO OBRIGATÓRIO — Execução bem-sucedida de microtarefa na primeira tentativa (Microtarefa 2.1)
  executionTelemetry.timestamps['mt2_1_dispatched'] = new Date().toISOString();
  const availableForGt2 = AutonomousManager.getAvailableTasks(runId);
  assert.equal(availableForGt2.length, 1, 'Microtarefa 2.1 agora deve estar desbloqueada');
  assert.equal(availableForGt2[0].id, mt2_1.id);

  AutonomousManager.claimTask(mt2_1.id, 'worker-dashboard-ui');

  fs.writeFileSync(
    path.join(workspaceDir, 'src', 'dashboardView.cjs'),
    [
      'function renderDashboardSummary(summary) {',
      '  const cats = Object.entries(summary.byCategory || {})',
      '    .map(([k, v]) => `<li data-category="${k}">${k}: R$ ${Number(v).toFixed(2)}</li>`)',
      '    .join("");',
      '  return [',
      '    `<section id="summary-panel">`,',
      '    `  <div class="card income">Receitas: R$ ${Number(summary.totalIncome).toFixed(2)}</div>`,',
      '    `  <div class="card expense">Despesas: R$ ${Number(summary.totalExpense).toFixed(2)}</div>`,',
      '    `  <div class="card balance">Saldo: R$ ${Number(summary.balance).toFixed(2)}</div>`,',
      '    `  <ul class="categories">${cats}</ul>`,',
      '    `</section>`',
      '  ].join("\\n");',
      '}',
      'module.exports = { renderDashboardSummary };',
      ''
    ].join('\n'),
    'utf-8'
  );

  fs.writeFileSync(
    path.join(workspaceDir, 'src', 'dashboard.html'),
    [
      '<!DOCTYPE html>',
      '<html lang="pt-BR">',
      '<head><meta charset="UTF-8"><title>Painel Financeiro</title></head>',
      '<body>',
      '  <h1>Painel de Resumo Financeiro</h1>',
      '  <form id="transaction-form">',
      '    <input name="description" placeholder="Descrição" required />',
      '    <input name="amount" type="number" placeholder="Valor" required />',
      '    <select name="type"><option value="income">Receita</option><option value="expense">Despesa</option></select>',
      '    <input name="category" placeholder="Categoria" required />',
      '    <button type="submit">Lançar</button>',
      '  </form>',
      '  <div id="dashboard-root"></div>',
      '</body>',
      '</html>',
      ''
    ].join('\n'),
    'utf-8'
  );

  fs.writeFileSync(
    path.join(workspaceDir, 'test', 'dashboard.test.cjs'),
    [
      "const test = require('node:test');",
      "const assert = require('node:assert/strict');",
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "const { createFinanceStore } = require('../src/financeEngine.cjs');",
      "const { renderDashboardSummary } = require('../src/dashboardView.cjs');",
      "test('dashboard summary view and html structure', () => {",
      "  const store = createFinanceStore();",
      "  store.addTransaction({ description: 'Salário', amount: 5000, type: 'income', category: 'Renda' });",
      "  store.addTransaction({ description: 'Aluguel', amount: 1800, type: 'expense', category: 'Moradia' });",
      "  const summary = store.getSummary();",
      "  const html = renderDashboardSummary(summary);",
      "  assert.match(html, /Receitas: R\\$ 5000\\.00/);",
      "  assert.match(html, /Despesas: R\\$ 1800\\.00/);",
      "  assert.match(html, /Saldo: R\\$ 3200\\.00/);",
      "  const pageHtml = fs.readFileSync(path.join(__dirname, '../src/dashboard.html'), 'utf-8');",
      "  assert.match(pageHtml, /id=\"transaction-form\"/);",
      "});",
      ""
    ].join('\n'),
    'utf-8'
  );

  AutonomousManager.submitBuilderReport({
    runId,
    taskId: mt2_1.id,
    status: 'success',
    filesChanged: ['src/dashboardView.cjs', 'src/dashboard.html', 'test/dashboard.test.cjs'],
    implemented: ['Implementado painel de resumo HTML e formulário de transações'],
    testsRun: 'npm test',
    testResults: '2 passing'
  });

  const eval2_1 = await IndependentEvaluator.evaluate(mt2_1.contract_id, workspaceDir, {
    status: 'success',
    filesChanged: ['src/dashboardView.cjs', 'src/dashboard.html', 'test/dashboard.test.cjs'],
    implemented: ['Implementado painel de resumo HTML e formulário de transações']
  });
  assert.equal(eval2_1.verdict, 'PASS', 'Evaluator deve aprovar MT-2.1 na primeira tentativa');

  const review2_1 = AutonomousManager.submitSupervisorReview({
    runId,
    taskId: mt2_1.id,
    verdict: 'APPROVED',
    feedback: 'Painel de resumo e formulário aprovados na primeira tentativa pelo Review independente.',
    criteriaMet: [
      'renderDashboardSummary gera HTML com total de receitas, despesas, categorias e saldo',
      'Arquivo src/dashboard.html contém estrutura do painel de resumo e formulário'
    ],
    criteriaFailed: [],
    evaluation: eval2_1
  });
  assert.equal(review2_1.reviewDecision.decision, 'APPROVED');
  assert.equal(review2_1.commitGate?.committed, true, 'Commit Git deve ser gerado para MT-2.1');
  const sha2_1 = review2_1.commitGate?.commitSha!;
  assert.ok(sha2_1 && sha2_1 !== sha1_1);

  executionTelemetry.approvals.push({
    taskId: mt2_1.id,
    attempt: 1,
    verdict: 'APPROVED',
    commitSha: sha2_1
  });
  executionTelemetry.commits.push({
    taskId: mt2_1.id,
    code: mt2_1.code || '2.1',
    title: mt2_1.title,
    sha: sha2_1,
    message: review2_1.commitGate?.commitMessage || ''
  });

  // ETAPA 8: Mudança de Requisito Rastreável via API (POST /api/autonomous/runs/:id/replan)
  executionTelemetry.timestamps['requirement_change_replan'] = new Date().toISOString();
  const replanRes = await fetch(`${baseUrl}/autonomous/runs/${runId}/replan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instruction: 'Adicionar filtro de transações por categoria (filterByCategory) no motor financeiro',
      changeType: 'NEW_FEATURE'
    })
  });
  assert.equal(replanRes.status, 200);
  const replanBody: any = await replanRes.json();
  assert.equal(replanBody.replanResult.preservedCompletedCount, 2, 'As 2 microtarefas já concluídas devem ser preservadas');
  assert.equal(replanBody.replanResult.addedMicrotasks.length, 1, 'Nova microtarefa deve ser criada');

  const mt3_1 = replanBody.replanResult.addedMicrotasks[0];

  // Implementação e aprovação da microtarefa replanejada
  AutonomousManager.claimTask(mt3_1.id, 'worker-finance-filter');

  fs.writeFileSync(
    path.join(workspaceDir, 'src', 'financeEngine.cjs'),
    [
      'const fs = require("node:fs");',
      'function createFinanceStore() {',
      '  const transactions = [];',
      '  function addTransaction({ description, amount, type, category }) {',
      '    const val = Number(amount);',
      '    if (!description || Number.isNaN(val) || val <= 0) {',
      '      throw new Error("INVALID_TRANSACTION");',
      '    }',
      '    if (type !== "income" && type !== "expense") {',
      '      throw new Error("INVALID_TYPE");',
      '    }',
      '    const entry = {',
      '      id: String(transactions.length + 1),',
      '      description: String(description).trim(),',
      '      amount: val,',
      '      type,',
      '      category: String(category || "Geral").trim()',
      '    };',
      '    transactions.push(entry);',
      '    try { fs.writeFileSync("transactions.json", JSON.stringify(transactions)); } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "operationalHomologationReal.test",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:operationalHomologationReal.test]", err);
      }
    }',
      '    return entry;',
      '  }',
      '  function filterByCategory(category) {',
      '    return transactions.filter(t => t.category.toLowerCase() === String(category || "").trim().toLowerCase());',
      '  }',
      '  function getSummary() {',
      '    let totalIncome = 0;',
      '    let totalExpense = 0;',
      '    const byCategory = {};',
      '    for (const tx of transactions) {',
      '      if (tx.type === "income") totalIncome += tx.amount;',
      '      else totalExpense += tx.amount;',
      '      byCategory[tx.category] = (byCategory[tx.category] || 0) + (tx.type === "income" ? tx.amount : -tx.amount);',
      '    }',
      '    return {',
      '      totalIncome,',
      '      totalExpense,',
      '      balance: totalIncome - totalExpense,',
      '      byCategory,',
      '      count: transactions.length,',
      '      transactions: [...transactions]',
      '    };',
      '  }',
      '  return { addTransaction, filterByCategory, getSummary };',
      '}',
      'module.exports = { createFinanceStore };',
      ''
    ].join('\n'),
    'utf-8'
  );

  fs.writeFileSync(
    path.join(workspaceDir, 'test', 'filter.test.cjs'),
    [
      "const test = require('node:test');",
      "const assert = require('node:assert/strict');",
      "const { createFinanceStore } = require('../src/financeEngine.cjs');",
      "test('financeEngine filterByCategory replanned feature', () => {",
      "  const store = createFinanceStore();",
      "  store.addTransaction({ description: 'Salário', amount: 5000, type: 'income', category: 'Renda' });",
      "  store.addTransaction({ description: 'Aluguel', amount: 1800, type: 'expense', category: 'Moradia' });",
      "  store.addTransaction({ description: 'Condomínio', amount: 400, type: 'expense', category: 'Moradia' });",
      "  const moradia = store.filterByCategory('Moradia');",
      "  assert.equal(moradia.length, 2);",
      "  const summary = store.getSummary();",
      "  assert.equal(summary.balance, 2800);",
      "});",
      ""
    ].join('\n'),
    'utf-8'
  );

  AutonomousManager.submitBuilderReport({
    runId,
    taskId: mt3_1.id,
    status: 'success',
    filesChanged: ['src/financeEngine.cjs', 'test/filter.test.cjs'],
    implemented: ['Implementado filterByCategory conforme mudança de requisito'],
    testsRun: 'npm test',
    testResults: '1 passing'
  });

  const eval3_1 = await IndependentEvaluator.evaluate(mt3_1.contract_id, workspaceDir, {
    status: 'success',
    filesChanged: ['src/financeEngine.cjs', 'test/filter.test.cjs'],
    implemented: ['Implementado filterByCategory conforme mudança de requisito']
  });
  assert.equal(eval3_1.verdict, 'PASS');

  const review3_1 = AutonomousManager.submitSupervisorReview({
    runId,
    taskId: mt3_1.id,
    verdict: 'APPROVED',
    feedback: 'Requisito replanejado filterByCategory aprovado e testado pelo Review.',
    criteriaMet: mt3_1.criteria_json ? JSON.parse(mt3_1.criteria_json) : [],
    criteriaFailed: [],
    evaluation: eval3_1
  });
  assert.equal(review3_1.reviewDecision.decision, 'APPROVED');
  assert.equal(review3_1.commitGate?.committed, true);
  const sha3_1 = review3_1.commitGate?.commitSha!;
  assert.ok(sha3_1);

  executionTelemetry.approvals.push({
    taskId: mt3_1.id,
    attempt: 1,
    verdict: 'APPROVED',
    commitSha: sha3_1
  });
  executionTelemetry.commits.push({
    taskId: mt3_1.id,
    code: mt3_1.code || '3.1',
    title: mt3_1.title,
    sha: sha3_1,
    message: review3_1.commitGate?.commitMessage || ''
  });

  // ETAPA 9: Validação Integrada Final do Projeto (POST /api/autonomous/runs/:id/validate-final)
  executionTelemetry.timestamps['final_validation_executed'] = new Date().toISOString();
  const finalValRes = await fetch(`${baseUrl}/autonomous/runs/${runId}/validate-final`, {
    method: 'POST'
  });
  assert.equal(finalValRes.status, 200);
  const finalValBody: any = await finalValRes.json();

  assert.equal(finalValBody.validation.canCompleteProject, true, 'Validação integrada final deve autorizar a conclusão do projeto');
  assert.equal(finalValBody.validation.allMajorTasksCompleted, true, 'Todas as Grandes Tarefas devem estar concluídas');
  assert.equal(finalValBody.validation.allMicrotasksCompleted, true, 'Todas as Microtarefas devem estar concluídas');
  assert.equal(finalValBody.validation.allReviewsApproved, true, 'Todos os Reviews devem estar aprovados');
  assert.equal(finalValBody.validation.allCommitsVerified, true, 'Todos os commits devem estar verificados');

  // Consulta de auditoria final via GET /api/autonomous/runs/:id/hierarchy
  const auditHierRes = await fetch(`${baseUrl}/autonomous/runs/${runId}/hierarchy`);
  assert.equal(auditHierRes.status, 200);
  const auditHierarchy: any = await auditHierRes.json();

  executionTelemetry.stateTransitionsCount = auditHierarchy.stateTransitions.length;
  executionTelemetry.agentMessagesCount = auditHierarchy.agentCommunications.length;
  executionTelemetry.timestamps['homologation_completed'] = new Date().toISOString();

  // Exporta artefato consolidado de auditoria e telemetria da homologação
  const artifactPath = path.join(ISOLATED_DATA_DIR, 'homologation-audit-telemetry.json');
  fs.writeFileSync(artifactPath, JSON.stringify(executionTelemetry, null, 2), 'utf-8');

  console.log('\n======================================================');
  console.log('🏁 RESULTADO DA HOMOLOGAÇÃO REAL — AUTONOMIA HIERÁRQUICA:');
  console.log(`- Projeto ID: ${projectId}`);
  console.log(`- Run ID: ${runId}`);
  console.log(`- Grandes Tarefas Concluídas: ${auditHierarchy.majorTasks.length}/${auditHierarchy.majorTasks.length}`);
  console.log(`- Microtarefas Concluídas com Commit: ${auditHierarchy.tasks.length}/${auditHierarchy.tasks.length}`);
  console.log(`- Commits Git Gerados: ${executionTelemetry.commits.length} commits`);
  console.log(`- Transições de Estado Auditadas: ${executionTelemetry.stateTransitionsCount}`);
  console.log(`- Mensagens Inter-Agentes Trocadas: ${executionTelemetry.agentMessagesCount}`);
  console.log(`- Reprovações de Review com Correção: ${executionTelemetry.rejections.length}`);
  console.log(`- Aprovações de Review: ${executionTelemetry.approvals.length}`);
  console.log('======================================================\n');
});
