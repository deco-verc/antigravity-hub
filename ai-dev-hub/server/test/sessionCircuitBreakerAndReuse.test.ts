// server/test/sessionCircuitBreakerAndReuse.test.ts
// Testes unitários para validar limites do Circuit Breaker e Reuso Inteligente Anti-Storm

import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import { SessionCircuitBreaker, SessionCreationStormError } from '../src/sessionCircuitBreaker.js';
import { AgentApiGateway } from '../src/agentApiGateway.js';

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
});
