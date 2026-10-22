import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentApiGateway, FailClosedGuardError, DefaultFakeAgentApiProvider } from '../src/agentApiGateway.js';
import { SessionCircuitBreaker, SessionCreationStormError } from '../src/sessionCircuitBreaker.js';
import { AgentSessionManager } from '../src/agentSessionManager.js';
import { ConversationManager } from '../src/conversationManager.js';
import { db } from '../src/db.js';

test('AgentApiGateway, Fail-Closed Guard & Circuit Breaker Suite', async (t) => {
  const fake = new DefaultFakeAgentApiProvider();
  AgentApiGateway.setMockProvider(fake);

  t.after(() => {
    AgentApiGateway.installDefaultMock();
    SessionCircuitBreaker.resetConfiguration();
  });

  // 1. FAIL-CLOSED GUARD: When no mock is installed in offline mode, real calls are BLOCKED immediately
  await t.test('1. FAIL-CLOSED GUARD: Block real execution before touching language_server.exe', async () => {
    AgentApiGateway.setMockProvider(null);
    process.env.DECOHUB_OFFLINE_MODE = 'true';
    process.env.DECOHUB_ALLOW_LIVE_AGENTAPI = 'false';

    await assert.rejects(
      async () => {
        await AgentApiGateway.newConversation({
          model: 'flash',
          title: 'Dangerous Real Call',
          prompt: 'This must never execute',
          projectId: 'proj-blocked-1'
        });
      },
      (err: any) => {
        assert.ok(err instanceof FailClosedGuardError);
        assert.ok(err.message.includes('[FAIL_CLOSED_GUARD]'));
        return true;
      },
      'Deve lançar FailClosedGuardError ao tentar criar conversa real no modo offline'
    );

    // Verify telemetry recorded CREATE_BLOCKED and LIVE_TEST_DENIED
    const blockedEvent: any = db.prepare(`
      SELECT * FROM session_creation_telemetry
      WHERE event_type = 'LIVE_TEST_DENIED' AND project_id = 'proj-blocked-1'
      ORDER BY created_at DESC LIMIT 1
    `).get();

    assert.ok(blockedEvent, 'Evento LIVE_TEST_DENIED deve ser gravado');
    assert.equal(blockedEvent.origin, 'TEST');

    // Re-install fake for subsequent tests
    AgentApiGateway.setMockProvider(fake);
  });

  // 2. FAKE PROVIDER: Generates deterministic synthetic sessions without external network/process
  await t.test('2. FAKE PROVIDER: Produces synthetic conversation IDs and records turn history in memory', async () => {
    fake.reset();
    const convId = await AgentApiGateway.newConversation({
      model: 'pro',
      title: 'Supervisor Synthetic Test',
      prompt: 'Olá Supervisor',
      projectId: 'proj-synth-1',
      role: 'SUPERVISOR'
    });

    assert.ok(convId.startsWith('conv-fake-supervisor-'));
    assert.equal(fake.creationCount, 1);
    assert.equal(fake.conversations.length, 1);
    assert.equal(fake.conversations[0].title, 'Supervisor Synthetic Test');

    // Send message to synthetic session
    AgentApiGateway.sendMessage({
      conversationId: convId,
      prompt: 'Segunda mensagem',
      projectId: 'proj-synth-1',
      role: 'SUPERVISOR'
    });

    assert.equal(fake.messageCount, 1);
    assert.equal(fake.conversations[0].messages.length, 2);
    assert.equal(fake.conversations[0].messages[1], 'Segunda mensagem');
  });

  // 3. ZERO CHURN IN MULTI-TASK PIPELINE: 10 tasks reuse the same 2 sessions (1 Supervisor, 1 Worker)
  await t.test('3. ZERO CHURN: 10 sequential tasks reuse 1 Supervisor and 1 Worker session without churn', async () => {
    fake.reset();
    const projId = 'proj-multitask-' + Date.now();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO projects (id, name, path, objective, created_at, updated_at)
      VALUES (?, 'MultiTask App', ?, 'Testar 10 tarefas', ?, ?)
    `).run(projId, '/dummy/multitask-' + Date.now(), now, now);

    // Initial session acquisition
    const { session: supSession, isNew: supIsNew } = await AgentSessionManager.getOrCreateAgentSession(projId, 'SUPERVISOR', { model: 'pro' });
    const { session: wrkSession, isNew: wrkIsNew } = await AgentSessionManager.getOrCreateAgentSession(projId, 'WORKER', { model: 'flash' });

    assert.equal(supIsNew, true);
    assert.equal(wrkIsNew, true);
    assert.equal(fake.creationCount, 2, 'Exatamente 2 conversas criadas inicialmente');

    // Simulate 10 tasks executing across the sessions
    for (let i = 1; i <= 10; i++) {
      const supReuse = await AgentSessionManager.getOrCreateAgentSession(projId, 'SUPERVISOR', { model: 'pro' });
      const wrkReuse = await AgentSessionManager.getOrCreateAgentSession(projId, 'WORKER', { model: 'flash' });

      assert.equal(supReuse.isNew, false, `Task ${i}: Supervisor deve ser reutilizado`);
      assert.equal(wrkReuse.isNew, false, `Task ${i}: Worker deve ser reutilizado`);
      assert.equal(supReuse.session.provider_conversation_id, supSession.provider_conversation_id);
      assert.equal(wrkReuse.session.provider_conversation_id, wrkSession.provider_conversation_id);

      await AgentSessionManager.sendMessage(supReuse.session, `Prompt da Task ${i} para Supervisor`);
      await AgentSessionManager.sendMessage(wrkReuse.session, `Instruções da Task ${i} para Worker`);
    }

    // Still exactly 2 conversations created! No mass creation!
    assert.equal(fake.creationCount, 2, 'Ao longo de 10 tarefas, TOTAL de conversas criadas deve permanecer rigorosamente 2');
    assert.equal(fake.messageCount, 20, '20 mensagens enviadas reutilizando as sessões existentes');
  });

  // 4. CIRCUIT BREAKER: Detects creation storm and trips when limit exceeded
  await t.test('4. CIRCUIT BREAKER: Blocks creation storm when threshold is exceeded', () => {
    const stormProjId = 'proj-storm-' + Date.now();
    SessionCircuitBreaker.configure({ windowMs: 60000, maxCreationsPerWindow: 3 });

    // Simulate 3 permitted creations
    for (let i = 1; i <= 3; i++) {
      SessionCircuitBreaker.assertCanCreate({
        projectId: stormProjId,
        role: 'WORKER',
        origin: 'TEST',
        caller: 'test-storm'
      });
      // Record simulated success in telemetry table
      SessionCircuitBreaker.logTelemetry({
        event: 'CREATE_SUCCESS',
        origin: 'TEST',
        projectId: stormProjId,
        role: 'WORKER',
        conversationId: `conv-storm-${i}`
      });
    }

    // 4th attempt must trip the breaker and throw SessionCreationStormError
    assert.throws(
      () => {
        SessionCircuitBreaker.assertCanCreate({
          projectId: stormProjId,
          role: 'WORKER',
          origin: 'TEST',
          caller: 'test-storm'
        });
      },
      (err: any) => {
        assert.ok(err instanceof SessionCreationStormError);
        assert.ok(err.message.includes('SESSION_CREATION_STORM'));
        return true;
      },
      '4ª criação no mesmo projeto dentro da janela deve disparar o circuit breaker'
    );

    // Verify telemetry event SESSION_CREATION_STORM recorded in SQLite
    const stormEvent: any = db.prepare(`
      SELECT * FROM session_creation_telemetry
      WHERE event_type = 'SESSION_CREATION_STORM' AND project_id = ?
    `).get(stormProjId);

    assert.ok(stormEvent, 'Evento SESSION_CREATION_STORM deve estar gravado no banco');
    assert.equal(stormEvent.project_id, stormProjId);
  });

  // 5. CONTROLLED ROTATION: Only creates 1 new synthetic conversation when explicitly rotated
  await t.test('5. CONTROLLED ROTATION: Rotation creates only the single requested new session', async () => {
    fake.reset();
    const projId = 'proj-rotation-' + Date.now();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO projects (id, name, path, objective, created_at, updated_at)
      VALUES (?, 'Rotate App', ?, 'Testar rotação', ?, ?)
    `).run(projId, '/dummy/rotate-' + Date.now(), now, now);

    const { session: gen1 } = await AgentSessionManager.getOrCreateAgentSession(projId, 'WORKER', { model: 'flash' });
    assert.equal(gen1.generation, 1);
    assert.equal(fake.creationCount, 1);

    // Perform controlled rotation
    const { newSession: gen2 } = await AgentSessionManager.rotateSession(
      projId,
      'WORKER',
      'CONTEXT_WINDOW_LIMIT'
    );

    assert.equal(gen2.generation, 2);
    assert.notEqual(gen2.provider_conversation_id, gen1.provider_conversation_id);
    assert.equal(fake.creationCount, 2, 'Rotação deve criar apenas a 2ª sessão legítima');

    // Subsequent retrieval reuses gen 2
    const reuse = await AgentSessionManager.getOrCreateAgentSession(projId, 'WORKER');
    assert.equal(reuse.isNew, false);
    assert.equal(reuse.session.generation, 2);
    assert.equal(fake.creationCount, 2);
  });
});
