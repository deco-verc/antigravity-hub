// server/test/backendForensicHardening.test.ts
// Testes automatizados cobrindo o Hardening Forense do Backend

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import express from 'express';
import { apiRouter } from '../src/routes.js';
import { db } from '../src/db.js';
import { AutonomousManager } from '../src/autonomousManager.js';
import { IndependentEvaluator } from '../src/independentEvaluator.js';
import { TurnCancellationManager } from '../src/turnCancellationManager.js';
import { observeTranscript } from '../src/agentTurnState.js';

describe('Auditoria Forense e Hardening do Backend (server/src/)', () => {
  let server: any;
  let baseUrl: string;
  let testProjectId: string;
  let testProjectFolder: string;

  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DECOHUB_OFFLINE_MODE = 'true';

    // Iniciar app Express para testar as rotas endurecidas
    const app = express();
    app.use(express.json());
    app.use('/api', apiRouter);

    server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    const port = (server.address() as any).port;
    baseUrl = `http://127.0.0.1:${port}/api`;

    // Criar projeto temporário
    testProjectFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-forensic-test-'));
    const createRes = await fetch(`${baseUrl}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Projeto Forensic Hardening',
        folderPath: testProjectFolder,
        objective: 'Testar hardening forense',
        description: 'Projeto temporário',
        initGit: true
      })
    });
    const projectData: any = await createRes.json();
    testProjectId = projectData.id;
  });

  after(async () => {
    delete process.env.DECOHUB_OFFLINE_MODE;
    if (server) {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
    if (fs.existsSync(testProjectFolder)) {
      try { fs.rmSync(testProjectFolder, { recursive: true, force: true }); } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "backendForensicHardening.test",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:backendForensicHardening.test]", err);
      }
    }
    }
  });

  // =========================================================================
  // 1. Resiliência a JSON Corrompido no Banco de Dados
  // =========================================================================

  it('1.1 AutonomousManager.getRun tolera colunas JSON corrompidas sem lançar exceção', () => {
    const runId = `run-corrupt-${Date.now()}`;
    const nowIso = new Date().toISOString();

    db.prepare(`
      INSERT INTO autonomous_runs (id, project_id, name, objective, status, config_json, requirements_json, success_criteria_json, technical_context_json, plan_history_json, start_time, created_at, updated_at)
      VALUES (?, ?, 'Run com JSON Quebrado', 'Testar resiliência', 'running', '{bad-json', '{malformed[', 'invalid-json', 'not:a:json', '<<corrupt>>', ?, ?, ?)
    `).run(runId, testProjectId, nowIso, nowIso, nowIso);

    const taskId = `task-corrupt-${Date.now()}`;
    db.prepare(`
      INSERT INTO autonomous_tasks (id, run_id, title, status, dependencies_json, criteria_json, expected_files_json, allowed_scope_json, constraints_json, required_evidence_json, attempt_history_json, review_result_json, created_at, updated_at)
      VALUES (?, ?, 'Tarefa com JSON Quebrado', 'pending', '{broken-deps', '{bad-criteria', 'not-array', 'broken', 'bad-constraints', 'bad-ev', '{corrupt-hist', '{bad-review', ?, ?)
    `).run(taskId, runId, nowIso, nowIso);

    // Deve carregar o Run perfeitamente usando os fallbacks seguros sem estourar SyntaxError
    const run = AutonomousManager.getRun(runId);
    assert.ok(run);
    assert.equal(run.id, runId);
    assert.deepEqual(run.requirements, []);
    assert.deepEqual(run.successCriteria, []);
    assert.deepEqual(run.technicalContext, {});
    assert.deepEqual(run.planHistory, []);
    assert.equal(run.tasks.length, 1);
    assert.deepEqual(run.tasks[0].dependencies, []);
    assert.deepEqual(run.tasks[0].criteria, []);
    assert.deepEqual(run.tasks[0].expected_files, []);
  });

  it('1.2 AutonomousManager.getAvailableTasks não quebra com dependencies_json corrompido', () => {
    const runId = `run-avail-${Date.now()}`;
    const nowIso = new Date().toISOString();

    db.prepare(`
      INSERT INTO autonomous_runs (id, project_id, name, objective, status, start_time, created_at, updated_at)
      VALUES (?, ?, 'Run Teste Available', 'Testar getAvailableTasks', 'running', ?, ?, ?)
    `).run(runId, testProjectId, nowIso, nowIso, nowIso);

    const taskId = `task-avail-${Date.now()}`;
    db.prepare(`
      INSERT INTO autonomous_tasks (id, run_id, title, status, lifecycle_state, dependencies_json, criteria_json, created_at, updated_at)
      VALUES (?, ?, 'Tarefa Pronta', 'ready', 'READY', 'INVALID_JSON_DEPENDENCY', 'INVALID_CRITERIA', ?, ?)
    `).run(taskId, runId, nowIso, nowIso);

    // Não deve lançar SyntaxError, tratando como dependências vazias
    const available = AutonomousManager.getAvailableTasks(runId);
    assert.ok(Array.isArray(available));
    assert.equal(available.length, 1);
    assert.equal(available[0].id, taskId);
    assert.deepEqual(available[0].dependencies, []);
  });

  it('1.3 IndependentEvaluator tolera contratos e avaliações com colunas JSON malformadas', () => {
    const contractId = `contract-corrupt-${Date.now()}`;
    const taskId = `task-eval-corrupt-${Date.now()}`;
    const nowIso = new Date().toISOString();

    db.prepare(`
      INSERT INTO success_contracts (id, task_id, project_id, objective, acceptance_criteria_json, verification_steps_json, protected_evaluation_files_json, protected_file_hashes_json, baseline_json, success_thresholds_json, failure_conditions_json, status, created_at, updated_at)
      VALUES (?, ?, ?, 'Objetivo', '{bad-json', '{bad-steps', '{bad-files', '{bad-hashes', '{bad-base', '{bad-thresh', '{bad-fail', 'pending', ?, ?)
    `).run(contractId, taskId, testProjectId, nowIso, nowIso);

    const contract = IndependentEvaluator.getContract(contractId);
    assert.ok(contract);
    assert.deepEqual(contract.acceptanceCriteria, []);
    assert.deepEqual(contract.verificationSteps, []);
    assert.deepEqual(contract.protectedEvaluationFiles, []);
    assert.deepEqual(contract.protectedFileHashes, {});
    assert.equal(contract.baseline.passed, false);

    const evalId = `eval-corrupt-${Date.now()}`;
    db.prepare(`
      INSERT INTO evaluation_results (id, contract_id, task_id, verdict, builder_status, evaluator_verdict, task_is_done, passed_criteria_json, failed_criteria_json, evidence_json, evaluator_name, executed_commands_json, created_at)
      VALUES (?, ?, ?, 'PASS', 'COMPLETED', 'PASS', 1, '{bad-passed', '{bad-failed', '{bad-evidence', 'Evaluator', '{bad-cmds', ?)
    `).run(evalId, contractId, taskId, nowIso);

    const evaluation = IndependentEvaluator.getEvaluationByTaskId(taskId);
    assert.ok(evaluation);
    assert.deepEqual(evaluation.passedCriteria, []);
    assert.deepEqual(evaluation.failedCriteria, []);
    assert.deepEqual(evaluation.evidence, {});
    assert.deepEqual(evaluation.executedCommands, []);
  });

  // =========================================================================
  // 2. Defesa das Rotas REST contra Payloads Vazios ou Ausentes (400 vs 500)
  // =========================================================================

  it('2.1 POST /api/workers com body vazio retorna 400 Bad Request limpo (sem crash 500)', async () => {
    const res = await fetch(`${baseUrl}/workers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    assert.equal(res.status, 400);
    const data: any = await res.json();
    assert.ok(data.error.includes('Nome do worker'));
  });

  it('2.2 PUT /api/workers/:id com body vazio não derruba a requisição', async () => {
    const res = await fetch(`${baseUrl}/workers/inexistent-worker-id`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    assert.equal(res.status, 404);
  });

  it('2.3 POST /api/projects/analyze com body vazio retorna 400 Bad Request limpo', async () => {
    const res = await fetch(`${baseUrl}/projects/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    assert.equal(res.status, 400);
    const data: any = await res.json();
    assert.ok(data.error.includes('Caminho da pasta é obrigatório'));
  });

  it('2.4 POST /api/models/preferences com body vazio retorna 400 Bad Request limpo', async () => {
    const res = await fetch(`${baseUrl}/models/preferences`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    assert.equal(res.status, 400);
    const data: any = await res.json();
    assert.ok(data.error.includes('modelId é obrigatório'));
  });

  it('2.5 POST /api/projects/:id/env-keys com body vazio retorna 400 Bad Request limpo', async () => {
    const res = await fetch(`${baseUrl}/projects/${testProjectId}/env-keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    assert.equal(res.status, 400);
    const data: any = await res.json();
    assert.ok(data.error.includes('keys'));
  });

  // =========================================================================
  // 3. Capacidade Bounded e Eviction em Gerenciadores de Memória
  // =========================================================================

  it('3.1 TurnCancellationManager mantém limite máximo de entradas e expulsa FIFO', () => {
    TurnCancellationManager.clearAll();
    for (let i = 0; i < 550; i++) {
      TurnCancellationManager.requestCancellation(`token-test-${i}`);
    }
    // Deve respeitar a cota máxima de 500 sem vazamento infinito
    assert.ok(TurnCancellationManager.activeTurnCancellations.size <= 500);
    // Primeiro token deve ter sido expulso (FIFO)
    assert.equal(TurnCancellationManager.isCancelled('token-test-0'), false);
    // Último token deve estar presente
    assert.equal(TurnCancellationManager.isCancelled('token-test-549'), true);
    TurnCancellationManager.clearAll();
  });

  // =========================================================================
  // 4. Fechamento de Falso Negativo em Validação de Rotas com JSON na Raiz
  // =========================================================================

  it('4.1 IndependentEvaluator detecta rota raiz retornando JSON mesmo com blocos intermediários multilinhas', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-root-json-test-'));
    try {
      fs.mkdirSync(path.join(tempDir, 'public'), { recursive: true });
      fs.writeFileSync(path.join(tempDir, 'public', 'index.html'), '<!DOCTYPE html><html><body><h1>App</h1></body></html>', 'utf-8');

      fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true });
      // Servidor que possui bloco if/statements antes de res.json na rota /
      const serverCode = `
        import express from 'express';
        const app = express();
        app.get('/', (req, res) => {
          if (req.headers['x-custom']) {
            console.log('header present');
          }
          res.json({ status: 'hijacked_root' });
        });
      `;
      fs.writeFileSync(path.join(tempDir, 'src', 'server.js'), serverCode, 'utf-8');

      const result = IndependentEvaluator.validateFrontendDesignQuality(tempDir, ['src/server.js'], 'Criar interface web');
      const hijackedFinding = result.findings.find(f => f.type === 'ROOT_ROUTE_HIJACKED_BY_JSON');
      assert.ok(hijackedFinding, 'Deve detectar que GET / retorna JSON apesar de blocos multilinhas intermediários');
    } finally {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "backendForensicHardening.test",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:backendForensicHardening.test]", err);
      }
    }
    }
  });

  // =========================================================================
  // 5. Tolerância a Linha Parcial em observeTranscript
  // =========================================================================

  it('5.1 observeTranscript preserva entradas válidas quando a última linha foi gravada parcialmente', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-transcript-test-'));
    try {
      const logFile = path.join(tempDir, 'transcript.jsonl');
      const lines = [
        JSON.stringify({ step_index: 0, type: 'USER_INPUT', content: 'Começar trabalho' }),
        JSON.stringify({ step_index: 1, type: 'PLANNER_RESPONSE', status: 'RUNNING', tool_calls: [{ name: 'read_file' }] }),
        '{"step_index": 2, "type": "PLANNER_RES' // Linha parcial incompleta
      ];
      fs.writeFileSync(logFile, lines.join('\n'), 'utf-8');

      const result = observeTranscript(logFile, 0);
      assert.notEqual(result.state, 'UNAVAILABLE');
      assert.equal(result.entries.length, 2);
      assert.equal(result.lastStep, 1);
      assert.deepEqual(result.pendingTools, ['read_file']);
    } finally {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "backendForensicHardening.test",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:backendForensicHardening.test]", err);
      }
    }
    }
  });
});
