// server/test/sessionCircuitBreakerAndReuse.test.ts
// Testes unitários para validar limites do Circuit Breaker e Reuso Inteligente Anti-Storm

import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import { SessionCircuitBreaker, SessionCreationStormError } from '../src/sessionCircuitBreaker.js';
import { AgentApiGateway } from '../src/agentApiGateway.js';
import { ChatSubmission } from '../src/chatSubmission.js';
import { RunControl } from '../src/runControl.js';

test('SessionCircuitBreaker - Calibração de limites e anti-storm', async (t) => {
  const testProjectId = 'test-proj-circuit-breaker';

  t.beforeEach(() => {
    SessionCircuitBreaker.configure({
      windowMs: 5000,
      maxCreationsPerWindow: 4,
      taskWindowMs: 3000,
      maxCreationsPerTask: 2
    });
    SessionCircuitBreaker.resetProjectWindow(testProjectId);
  });

  t.afterEach(() => {
    SessionCircuitBreaker.resetConfiguration();
    SessionCircuitBreaker.resetProjectWindow(testProjectId);
  });

  await t.test('permite criações até o limite do projeto', () => {
    // 1ª, 2ª, 3ª criação com tarefas diferentes
    for (let i = 1; i <= 3; i++) {
      SessionCircuitBreaker.logTelemetry({
        event: 'AGENT_CONVERSATION_CREATE_ATTEMPT',
        origin: 'TEST',
        projectId: testProjectId,
        role: 'SUPERVISOR',
        taskId: `task-${i}`
      });
      const check = SessionCircuitBreaker.evaluateCreation(testProjectId, 'SUPERVISOR', { taskId: `task-${i + 1}` });
      assert.equal(check.allowed, true);
    }
  });

  await t.test('bloqueia quando atinge o limite do projeto configurado', () => {
    // Preenche as 4 tentativas
    for (let i = 1; i <= 4; i++) {
      SessionCircuitBreaker.logTelemetry({
        event: 'AGENT_CONVERSATION_CREATE_ATTEMPT',
        origin: 'TEST',
        projectId: testProjectId,
        role: 'SUPERVISOR',
        taskId: `task-${i}`
      });
    }

    const check = SessionCircuitBreaker.evaluateCreation(testProjectId, 'SUPERVISOR', { taskId: 'task-5' });
    assert.equal(check.allowed, false);
    assert.ok(check.reason?.includes('SESSION_CREATION_STORM'));
  });

  await t.test('bloqueia estritamente loop infinito na mesma tarefa (task storm)', () => {
    const loopingTaskId = 'task-stuck-infinite-loop';
    // 2 tentativas na mesma tarefa
    SessionCircuitBreaker.logTelemetry({
      event: 'AGENT_CONVERSATION_CREATE_ATTEMPT',
      origin: 'TEST',
      projectId: testProjectId,
      role: 'WORKER',
      taskId: loopingTaskId
    });
    SessionCircuitBreaker.logTelemetry({
      event: 'AGENT_CONVERSATION_CREATE_ATTEMPT',
      origin: 'TEST',
      projectId: testProjectId,
      role: 'WORKER',
      taskId: loopingTaskId
    });

    const check = SessionCircuitBreaker.evaluateCreation(testProjectId, 'WORKER', { taskId: loopingTaskId });
    assert.equal(check.allowed, false);
    assert.equal(check.isTaskStorm, true);
    assert.ok(check.reason?.includes('mesma tarefa'));
  });

  await t.test('resetProjectWindow zera histórico e permite novas criações', () => {
    for (let i = 1; i <= 4; i++) {
      SessionCircuitBreaker.logTelemetry({
        event: 'AGENT_CONVERSATION_CREATE_ATTEMPT',
        origin: 'TEST',
        projectId: testProjectId,
        role: 'SUPERVISOR',
        taskId: `task-${i}`
      });
    }
    assert.equal(SessionCircuitBreaker.evaluateCreation(testProjectId).allowed, false);

    SessionCircuitBreaker.resetProjectWindow(testProjectId);
    assert.equal(SessionCircuitBreaker.evaluateCreation(testProjectId).allowed, true);
  });

  await t.test('findReusableConversation localiza sessão existente e evita storm no AgentApiGateway', () => {
    const mockConvId = 'conv-reusable-12345';
    // Insere projeto simulado para satisfazer Foreign Key
    db.prepare(`
      INSERT OR IGNORE INTO projects (id, name, path, created_at, updated_at)
      VALUES (?, 'Test Project CB', 'C:\\dummy-test', datetime('now'), datetime('now'))
    `).run(testProjectId);

    // Insere sessão ativa simulada com logical_conversation_id obrigatório
    db.prepare(`
      INSERT OR REPLACE INTO agent_sessions (
        id, project_id, role, logical_conversation_id, provider_conversation_id, status, created_at, last_used_at
      ) VALUES (?, ?, ?, ?, ?, 'ACTIVE', datetime('now'), datetime('now'))
    `).run('session-test-cb', testProjectId, 'SUPERVISOR', 'logical-conv-1', mockConvId);

    const found = SessionCircuitBreaker.findReusableConversation(testProjectId, 'SUPERVISOR');
    assert.equal(found, mockConvId);

    // Limpa
    db.prepare('DELETE FROM agent_sessions WHERE id = ?').run('session-test-cb');
    db.prepare('DELETE FROM projects WHERE id = ?').run(testProjectId);
  });

  await t.test('ChatSubmission flexibiliza requestId inválido ou ausente com UUID seguro', () => {
    db.prepare(`
      INSERT OR IGNORE INTO projects (id, name, path, created_at, updated_at)
      VALUES (?, 'Test Project CB', 'C:\\dummy-test', datetime('now'), datetime('now'))
    `).run(testProjectId);

    try {
      // 1. Sem requestId (undefined)
      const sub1 = ChatSubmission.begin(testProjectId, undefined, 'Test msg 1');
      assert.equal(sub1.isNew, true);
      assert.ok(sub1.requestId);
      assert.match(sub1.requestId, /^[a-zA-Z0-9_-]{8,128}$/);

      // 2. RequestId inválido (curto demais)
      const sub2 = ChatSubmission.begin(testProjectId, 'short', 'Test msg 2');
      assert.equal(sub2.isNew, true);
      assert.ok(sub2.requestId);
      assert.notEqual(sub2.requestId, 'short');
      assert.match(sub2.requestId, /^[a-zA-Z0-9_-]{8,128}$/);

      // 3. RequestId válido preservado
      const validId = 'valid-request-id-12345678';
      const sub3 = ChatSubmission.begin(testProjectId, validId, 'Test msg 3');
      assert.equal(sub3.isNew, true);
      assert.equal(sub3.requestId, validId);
    } finally {
      db.prepare('DELETE FROM messages WHERE project_id = ?').run(testProjectId);
      db.prepare('DELETE FROM chat_submissions WHERE project_id = ?').run(testProjectId);
      db.prepare('DELETE FROM projects WHERE id = ?').run(testProjectId);
    }
  });

  await t.test('RunControl.apply cancela tarefas definitivamente e zera Circuit Breaker', () => {
    const runId = 'test-run-cancel-forensic';
    const taskId1 = 'task-in-prog-1';
    const taskId2 = 'task-ready-2';
    const taskId3 = 'task-pending-3';
    const now = new Date().toISOString();

    db.prepare(`
      INSERT OR IGNORE INTO projects (id, name, path, created_at, updated_at)
      VALUES (?, 'Test Project CB', 'C:\\dummy-test', datetime('now'), datetime('now'))
    `).run(testProjectId);

    db.prepare(`
      INSERT OR REPLACE INTO autonomous_runs (id, project_id, name, objective, status, start_time, created_at, updated_at)
      VALUES (?, ?, 'Test Run Forensic', 'Test Objective', 'running', ?, ?, ?)
    `).run(runId, testProjectId, now, now, now);

    db.prepare(`
      INSERT OR REPLACE INTO autonomous_tasks (id, run_id, project_id, title, status, lifecycle_state, created_at, updated_at)
      VALUES (?, ?, ?, 'Task 1', 'in_progress', 'IN_PROGRESS', ?, ?)
    `).run(taskId1, runId, testProjectId, now, now);

    db.prepare(`
      INSERT OR REPLACE INTO autonomous_tasks (id, run_id, project_id, title, status, lifecycle_state, created_at, updated_at)
      VALUES (?, ?, ?, 'Task 2', 'ready', 'READY', ?, ?)
    `).run(taskId2, runId, testProjectId, now, now);

    db.prepare(`
      INSERT OR REPLACE INTO autonomous_tasks (id, run_id, project_id, title, status, lifecycle_state, created_at, updated_at)
      VALUES (?, ?, ?, 'Task 3', 'pending', 'PENDING', ?, ?)
    `).run(taskId3, runId, testProjectId, now, now);

    // Simula telemetria de storm
    SessionCircuitBreaker.logTelemetry({
      event: 'AGENT_CONVERSATION_CREATE_ATTEMPT',
      origin: 'TEST',
      projectId: testProjectId,
      role: 'WORKER',
      taskId: taskId1
    });
    SessionCircuitBreaker.logTelemetry({
      event: 'SESSION_CREATION_STORM',
      origin: 'TEST',
      projectId: testProjectId,
      role: 'WORKER',
      taskId: taskId1
    });

    // Solicita e aplica cancelamento
    RunControl.request(runId, 'cancel');
    RunControl.apply(runId, true);

    // Tarefas devem estar como 'cancelled' e 'CANCELLED', NUNCA 'ready'
    const t1: any = db.prepare('SELECT status, lifecycle_state FROM autonomous_tasks WHERE id = ?').get(taskId1);
    const t2: any = db.prepare('SELECT status, lifecycle_state FROM autonomous_tasks WHERE id = ?').get(taskId2);
    const t3: any = db.prepare('SELECT status, lifecycle_state FROM autonomous_tasks WHERE id = ?').get(taskId3);

    assert.equal(t1.status, 'cancelled');
    assert.equal(t1.lifecycle_state, 'CANCELLED');
    assert.equal(t2.status, 'cancelled');
    assert.equal(t2.lifecycle_state, 'CANCELLED');
    assert.equal(t3.status, 'cancelled');
    assert.equal(t3.lifecycle_state, 'CANCELLED');

    // Telemetria do Circuit Breaker deve ter sido limpa
    const telemCount: any = db.prepare(`
      SELECT COUNT(*) as count FROM session_creation_telemetry 
      WHERE project_id = ? AND event_type IN ('AGENT_CONVERSATION_CREATE_ATTEMPT', 'SESSION_CREATION_STORM', 'CREATE_BLOCKED')
    `).get(testProjectId);
    assert.equal(telemCount.count, 0);

    // Limpa
    db.prepare('DELETE FROM autonomous_tasks WHERE run_id = ?').run(runId);
    db.prepare('DELETE FROM autonomous_runs WHERE id = ?').run(runId);
    db.prepare('DELETE FROM projects WHERE id = ?').run(testProjectId);
  });

  await t.test('Reuso no AgentApiGateway retorna reusableConvId sem disparar sendMessage internamente', async () => {
    const mockConvId = 'conv-reused-no-double-send';
    db.prepare(`
      INSERT OR IGNORE INTO projects (id, name, path, created_at, updated_at)
      VALUES (?, 'Test Project CB', 'C:\\dummy-test', datetime('now'), datetime('now'))
    `).run(testProjectId);

    db.prepare(`
      INSERT OR REPLACE INTO agent_sessions (
        id, project_id, role, logical_conversation_id, provider_conversation_id, status, created_at, last_used_at
      ) VALUES (?, ?, ?, ?, ?, 'ACTIVE', datetime('now'), datetime('now'))
    `).run('session-test-reuse', testProjectId, 'WORKER', 'logical-conv-reuse', mockConvId);

    // Ativa mock provider para permitir execução em modo teste
    const fakeMock = {
      newConversation: async () => 'conv-fake-mock-should-not-be-reached',
      sendMessage: async () => {},
      abortTurn: async () => {}
    };
    AgentApiGateway.setMockProvider(fakeMock as any);

    // Força storm no Circuit Breaker para acionar fallback
    for (let i = 1; i <= 5; i++) {
      SessionCircuitBreaker.logTelemetry({
        event: 'AGENT_CONVERSATION_CREATE_ATTEMPT',
        origin: 'TEST',
        projectId: testProjectId,
        role: 'WORKER',
        taskId: `task-storm-${i}`
      });
    }

    let sendMessageCalled = false;
    const originalSendMessage = AgentApiGateway.sendMessage;
    AgentApiGateway.sendMessage = () => {
      sendMessageCalled = true;
      return null as any;
    };

    try {
      const convId = await AgentApiGateway.newConversation({
        projectId: testProjectId,
        role: 'WORKER',
        caller: 'UNIT_TEST',
        title: 'Test Reuse No Double Send',
        prompt: 'Should NOT be sent inside newConversation'
      });

      assert.equal(convId, mockConvId);
      assert.equal(sendMessageCalled, false, 'sendMessage NÃO deve ser chamado pelo fallback de reuso em newConversation');
    } finally {
      AgentApiGateway.setMockProvider(null);
      AgentApiGateway.sendMessage = originalSendMessage;
      db.prepare('DELETE FROM agent_sessions WHERE id = ?').run('session-test-reuse');
      db.prepare('DELETE FROM projects WHERE id = ?').run(testProjectId);
    }
  });
});
