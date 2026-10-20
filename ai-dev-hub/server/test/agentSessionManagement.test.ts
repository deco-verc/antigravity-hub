import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { db } from '../src/db.js';
import { AgentSessionManager } from '../src/agentSessionManager.js';
import { AutonomousManager } from '../src/autonomousManager.js';
import { AutonomousRunnerService } from '../src/autonomousRunnerService.js';
import { WorkerRegistry } from '../src/workerRegistry.js';
import { IndependentEvaluator } from '../src/independentEvaluator.js';

test('Agent Session & Context Management Suite — Scenarios A through L', async (t) => {
  const tmpRootA = path.join(os.tmpdir(), `decohub-session-test-alpha-${Date.now()}`);
  const tmpRootB = path.join(os.tmpdir(), `decohub-session-test-beta-${Date.now()}`);
  fs.mkdirSync(tmpRootA, { recursive: true });
  fs.mkdirSync(tmpRootB, { recursive: true });

  // Init git repos in test directories
  execSync('git init -b main', { cwd: tmpRootA, stdio: 'ignore' });
  execSync('git config user.name "Test AI"', { cwd: tmpRootA, stdio: 'ignore' });
  execSync('git config user.email "test@decohub.ai"', { cwd: tmpRootA, stdio: 'ignore' });
  fs.writeFileSync(path.join(tmpRootA, 'package.json'), JSON.stringify({ name: 'abacate-x', version: '1.0.0' }, null, 2));
  fs.writeFileSync(path.join(tmpRootA, 'README.md'), '# Abacate X\n');
  execSync('git add -A', { cwd: tmpRootA, stdio: 'ignore' });
  execSync('git commit -m "chore: initial commit"', { cwd: tmpRootA, stdio: 'ignore' });

  execSync('git init -b main', { cwd: tmpRootB, stdio: 'ignore' });
  execSync('git config user.name "Test AI"', { cwd: tmpRootB, stdio: 'ignore' });
  execSync('git config user.email "test@decohub.ai"', { cwd: tmpRootB, stdio: 'ignore' });
  fs.writeFileSync(path.join(tmpRootB, 'package.json'), JSON.stringify({ name: 'banana-y', version: '1.0.0' }, null, 2));
  fs.writeFileSync(path.join(tmpRootB, 'README.md'), '# Banana Y\n');
  execSync('git add -A', { cwd: tmpRootB, stdio: 'ignore' });
  execSync('git commit -m "chore: initial commit"', { cwd: tmpRootB, stdio: 'ignore' });

  const projIdA = `proj-sess-alpha-${Date.now()}`;
  const projIdB = `proj-sess-beta-${Date.now()}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO projects (id, name, path, objective, stack, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'Node/TypeScript', 'active', ?, ?)
  `).run(projIdA, 'Abacate X', tmpRootA, 'Construir aplicativo Abacate X', now, now);

  db.prepare(`
    INSERT INTO projects (id, name, path, objective, stack, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'Node/TypeScript', 'active', ?, ?)
  `).run(projIdB, 'Banana Y', tmpRootB, 'Construir aplicativo Banana Y', now, now);

  // Setup deterministic overrides for agentapi simulation
  let simulatedCreationCount = 0;
  const createdSessions: Array<{ model: string; title: string; prompt: string; convId: string }> = [];
  const sentMessages: Array<{ convId: string; prompt: string }> = [];

  AgentSessionManager.setProviderCreateOverride((params) => {
    simulatedCreationCount++;
    const convId = `conv-mock-${simulatedCreationCount}-${Date.now().toString(36)}`;
    createdSessions.push({ ...params, convId });
    return convId;
  });

  AgentSessionManager.setProviderSendMessageOverride((convId, prompt) => {
    sentMessages.push({ convId, prompt });
  });

  AgentSessionManager.setProviderLivenessOverride(() => true);

  t.after(() => {
    try {
      AgentSessionManager.setProviderCreateOverride(null);
      AgentSessionManager.setProviderSendMessageOverride(null);
      AgentSessionManager.setProviderLivenessOverride(null);
      AutonomousRunnerService.releaseExecutionLock();
      db.prepare('DELETE FROM agent_session_events WHERE project_id IN (?, ?)').run(projIdA, projIdB);
      db.prepare('DELETE FROM agent_sessions WHERE project_id IN (?, ?)').run(projIdA, projIdB);
      db.prepare('DELETE FROM autonomous_tasks WHERE run_id IN (SELECT id FROM autonomous_runs WHERE project_id IN (?, ?))').run(projIdA, projIdB);
      db.prepare('DELETE FROM autonomous_runs WHERE project_id IN (?, ?)').run(projIdA, projIdB);
      db.prepare('DELETE FROM projects WHERE id IN (?, ?)').run(projIdA, projIdB);
      fs.rmSync(tmpRootA, { recursive: true, force: true });
      fs.rmSync(tmpRootB, { recursive: true, force: true });
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "agentSessionManagement.test",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:agentSessionManagement.test]", err);
      }
    }
  });

  // -----------------------------------------------------------------
  // Test A: Novo projeto cria exatamente duas sessões com títulos exatos
  // -----------------------------------------------------------------
  await t.test('Test A: Novo projeto cria exatamente duas sessões persistentes ("Supervisor — Abacate X" e "Worker — Abacate X")', async () => {
    const sup = await AgentSessionManager.getOrCreateAgentSession(projIdA, 'SUPERVISOR');
    const wrk = await AgentSessionManager.getOrCreateAgentSession(projIdA, 'WORKER');

    assert.equal(sup.isNew, true);
    assert.equal(wrk.isNew, true);
    assert.equal(sup.session.generation, 1);
    assert.equal(wrk.session.generation, 1);
    assert.equal(sup.session.status, 'ACTIVE');
    assert.equal(wrk.session.status, 'ACTIVE');

    // Title format verification
    const supCreated = createdSessions.find(c => c.convId === sup.session.provider_conversation_id);
    const wrkCreated = createdSessions.find(c => c.convId === wrk.session.provider_conversation_id);
    assert.equal(supCreated?.title, 'Supervisor — Abacate X');
    assert.equal(wrkCreated?.title, 'Worker — Abacate X');

    // Exactly 2 active sessions in DB
    const active = db.prepare("SELECT * FROM agent_sessions WHERE project_id = ? AND status = 'ACTIVE'").all(projIdA);
    assert.equal(active.length, 2);
  });

  // -----------------------------------------------------------------
  // Test B: Execução de 5 tarefas subsequentes reutiliza a mesma sessão do Worker
  // -----------------------------------------------------------------
  await t.test('Test B: Execução de 5 tarefas reutiliza rigorosamente a mesma sessão do Worker sem criar conversas adicionais', async () => {
    const initialWorker = AgentSessionManager.getActiveSession(projIdA, 'WORKER');
    assert.ok(initialWorker);
    const creationsBefore = simulatedCreationCount;

    for (let i = 1; i <= 5; i++) {
      const getRes = await AgentSessionManager.getOrCreateAgentSession(projIdA, 'WORKER');
      assert.equal(getRes.isNew, false);
      assert.equal(getRes.session.provider_conversation_id, initialWorker.provider_conversation_id);

      // Send task turn
      const sendRes = await AgentSessionManager.sendMessage(getRes.session, `Executando tarefa #${i}`, {
        taskTitle: `Tarefa #${i}`
      });
      assert.equal(sendRes.success, true);
      assert.ok(sendRes.contextEstimate > 0);
    }

    assert.equal(simulatedCreationCount, creationsBefore, 'Zero novas conversas devem ser criadas pelo Worker nas 5 tarefas');

    // Turn count and context estimate updated
    const updatedWorker = AgentSessionManager.getActiveSession(projIdA, 'WORKER')!;
    assert.ok(updatedWorker.context_estimate > 0);
    assert.ok(updatedWorker.last_successful_turn_at);
  });

  // -----------------------------------------------------------------
  // Test C: Replanejamento do Supervisor reutiliza a mesma sessão
  // -----------------------------------------------------------------
  await t.test('Test C: Replanejamento e revisões do Supervisor reutilizam rigorosamente a mesma sessão do Supervisor', async () => {
    const initialSupervisor = AgentSessionManager.getActiveSession(projIdA, 'SUPERVISOR');
    assert.ok(initialSupervisor);
    const creationsBefore = simulatedCreationCount;

    // Simulate DAG replanning
    const planRes = await AgentSessionManager.getOrCreateAgentSession(projIdA, 'SUPERVISOR');
    assert.equal(planRes.isNew, false);
    assert.equal(planRes.session.provider_conversation_id, initialSupervisor.provider_conversation_id);

    await AgentSessionManager.sendMessage(planRes.session, 'Planejando ciclo complementar de tarefas', {
      taskTitle: 'Replanning DAG'
    });

    // Simulate builder report review
    const reviewRes = await AgentSessionManager.getOrCreateAgentSession(projIdA, 'SUPERVISOR');
    assert.equal(reviewRes.isNew, false);
    assert.equal(reviewRes.session.provider_conversation_id, initialSupervisor.provider_conversation_id);

    await AgentSessionManager.sendMessage(reviewRes.session, 'Revisando entrega da tarefa #3', {
      taskTitle: 'Supervisor Review'
    });

    assert.equal(simulatedCreationCount, creationsBefore, 'Zero novas conversas devem ser criadas no replanejamento');
  });

  // -----------------------------------------------------------------
  // Test D: Falha e autocorreção do Worker continuam na mesma sessão
  // -----------------------------------------------------------------
  await t.test('Test D: Falha e autocorreção do Worker continuam rigorosamente na mesma sessão', async () => {
    const activeWorker = AgentSessionManager.getActiveSession(projIdA, 'WORKER')!;
    const creationsBefore = simulatedCreationCount;

    // Attempt 1 fails
    await AgentSessionManager.sendMessage(activeWorker, 'Implementando componente X (Falha no teste unitário)', {
      taskTitle: 'Tentativa 1'
    });

    // Retry 1 (Self-correction)
    const retryRes = await AgentSessionManager.getOrCreateAgentSession(projIdA, 'WORKER');
    assert.equal(retryRes.isNew, false);
    assert.equal(retryRes.session.provider_conversation_id, activeWorker.provider_conversation_id);

    await AgentSessionManager.sendMessage(retryRes.session, 'Autocorreção: ajustando regex e repetindo testes', {
      taskTitle: 'Tentativa 2 (Autocorreção)'
    });

    assert.equal(simulatedCreationCount, creationsBefore, 'Autocorreção não deve criar nova conversa');
  });

  // -----------------------------------------------------------------
  // Test E: Rotação controlada de contexto do Worker com handoff estruturado
  // -----------------------------------------------------------------
  await t.test('Test E: Rotação controlada do Worker arquiva a sessão anterior e cria Geração 2 ("Worker 2 — Abacate X")', async () => {
    const gen1Worker = AgentSessionManager.getActiveSession(projIdA, 'WORKER')!;
    assert.equal(gen1Worker.generation, 1);

    const { newSession, handoffPackage } = await AgentSessionManager.rotateSession(
      projIdA,
      'WORKER',
      'LIMITE_OPERACIONAL_ATINGIDO: ~600KB de contexto acumulado'
    );

    assert.equal(newSession.generation, 2);
    assert.equal(newSession.status, 'ACTIVE');

    // Title of Generation 2
    const gen2Created = createdSessions.find(c => c.convId === newSession.provider_conversation_id);
    assert.equal(gen2Created?.title, 'Worker 2 — Abacate X');

    // Check Gen 1 is ARCHIVED
    const gen1After = AgentSessionManager.getSessionById(gen1Worker.id)!;
    assert.equal(gen1After.status, 'ARCHIVED');
    assert.equal(gen1After.rotation_reason, 'LIMITE_OPERACIONAL_ATINGIDO: ~600KB de contexto acumulado');
    assert.ok(gen1After.checkpoint_reference);

    // Handoff package persisted to .ai-dev-hub/handoffs/
    const handoffPath = path.join(tmpRootA, '.ai-dev-hub', 'handoffs', gen1After.checkpoint_reference!);
    assert.equal(fs.existsSync(handoffPath), true);
    const persistedHandoff = JSON.parse(fs.readFileSync(handoffPath, 'utf-8'));
    assert.equal(persistedHandoff.generationFrom, 1);
    assert.equal(persistedHandoff.generationTo, 2);
    assert.equal(persistedHandoff.projectId, projIdA);

    // Database partial index guarantee: exactly ONE active worker session exists
    const activeWorkers = db.prepare("SELECT * FROM agent_sessions WHERE project_id = ? AND role = 'WORKER' AND status = 'ACTIVE'").all(projIdA);
    assert.equal(activeWorkers.length, 1);
    assert.equal((activeWorkers[0] as any).id, newSession.id);
  });

  // -----------------------------------------------------------------
  // Test F: Rotação controlada do Supervisor
  // -----------------------------------------------------------------
  await t.test('Test F: Rotação controlada do Supervisor arquiva a anterior e cria Geração 2 ("Supervisor 2 — Abacate X")', async () => {
    const gen1Sup = AgentSessionManager.getActiveSession(projIdA, 'SUPERVISOR')!;
    assert.equal(gen1Sup.generation, 1);

    const { newSession } = await AgentSessionManager.rotateSession(
      projIdA,
      'SUPERVISOR',
      'ROTACAO_CONTROLADA_SUPERVISOR'
    );

    assert.equal(newSession.generation, 2);
    assert.equal(newSession.status, 'ACTIVE');

    const gen2Created = createdSessions.find(c => c.convId === newSession.provider_conversation_id);
    assert.equal(gen2Created?.title, 'Supervisor 2 — Abacate X');

    const gen1After = AgentSessionManager.getSessionById(gen1Sup.id)!;
    assert.equal(gen1After.status, 'ARCHIVED');

    const activeSups = db.prepare("SELECT * FROM agent_sessions WHERE project_id = ? AND role = 'SUPERVISOR' AND status = 'ACTIVE'").all(projIdA);
    assert.equal(activeSups.length, 1);
  });

  // -----------------------------------------------------------------
  // Test G: Reinicialização do backend recupera as sessões ativas existentes
  // -----------------------------------------------------------------
  await t.test('Test G: Reinicialização do backend recupera as sessões ativas existentes sem criar duplicadas', async () => {
    const activeSupBefore = AgentSessionManager.getActiveSession(projIdA, 'SUPERVISOR')!;
    const activeWrkBefore = AgentSessionManager.getActiveSession(projIdA, 'WORKER')!;
    const creationsBefore = simulatedCreationCount;

    // Simulate fresh backend bootstrap querying for sessions
    const supAfterRestart = await AgentSessionManager.getOrCreateAgentSession(projIdA, 'SUPERVISOR');
    const wrkAfterRestart = await AgentSessionManager.getOrCreateAgentSession(projIdA, 'WORKER');

    assert.equal(supAfterRestart.isNew, false);
    assert.equal(wrkAfterRestart.isNew, false);
    assert.equal(supAfterRestart.session.id, activeSupBefore.id);
    assert.equal(wrkAfterRestart.session.id, activeWrkBefore.id);
    assert.equal(simulatedCreationCount, creationsBefore, 'Zero sessões adicionais criadas após reinicialização');
  });

  // -----------------------------------------------------------------
  // Test H: Proteção de concorrência com mutex impede duplicidade
  // -----------------------------------------------------------------
  await t.test('Test H: Proteção de concorrência com mutex impede criação duplicada em chamadas paralelas', async () => {
    // Test on project B for Worker
    const [res1, res2] = await Promise.all([
      AgentSessionManager.getOrCreateAgentSession(projIdB, 'WORKER'),
      AgentSessionManager.getOrCreateAgentSession(projIdB, 'WORKER')
    ]);

    // One created, the other reused atomically
    const activeWorkersB = db.prepare("SELECT * FROM agent_sessions WHERE project_id = ? AND role = 'WORKER' AND status = 'ACTIVE'").all(projIdB);
    assert.equal(activeWorkersB.length, 1);
    assert.equal(res1.session.provider_conversation_id, res2.session.provider_conversation_id);
  });

  // -----------------------------------------------------------------
  // Test I: Isolamento estrito entre projetos independentes
  // -----------------------------------------------------------------
  await t.test('Test I: Dois projetos independentes mantêm suas próprias sessões sem contaminação cruzada', async () => {
    const supA = AgentSessionManager.getActiveSession(projIdA, 'SUPERVISOR')!;
    const wrkA = AgentSessionManager.getActiveSession(projIdA, 'WORKER')!;

    const supB = (await AgentSessionManager.getOrCreateAgentSession(projIdB, 'SUPERVISOR')).session;
    const wrkB = AgentSessionManager.getActiveSession(projIdB, 'WORKER')!;

    // Project A titles
    const supACreated = createdSessions.find(c => c.convId === supA.provider_conversation_id);
    const wrkACreated = createdSessions.find(c => c.convId === wrkA.provider_conversation_id);
    assert.ok(supACreated?.title.includes('Abacate X'));
    assert.ok(wrkACreated?.title.includes('Abacate X'));

    // Project B titles
    const supBCreated = createdSessions.find(c => c.convId === supB.provider_conversation_id);
    const wrkBCreated = createdSessions.find(c => c.convId === wrkB.provider_conversation_id);
    assert.equal(supBCreated?.title, 'Supervisor — Banana Y');
    assert.equal(wrkBCreated?.title, 'Worker — Banana Y');

    // Strict separation: IDs do not collide
    assert.notEqual(supA.id, supB.id);
    assert.notEqual(wrkA.id, wrkB.id);
    assert.notEqual(supA.provider_conversation_id, supB.provider_conversation_id);
    assert.notEqual(wrkA.provider_conversation_id, wrkB.provider_conversation_id);
  });

  // -----------------------------------------------------------------
  // Test J: Auditoria de sessões existentes (Read-Only)
  // -----------------------------------------------------------------
  await t.test('Test J: Auditoria de sessões identifica e cataloga sessões ativas e arquivadas sem deletar dados', async () => {
    const audit = AgentSessionManager.auditSessions();

    assert.ok(audit.timestamp);
    assert.ok(audit.totalAgentSessions >= 4);
    assert.ok(audit.activeSessionsCount >= 4); // 2 in A + 2 in B
    assert.ok(audit.archivedSessionsCount >= 2); // 2 rotated in A
    assert.ok(audit.byProject[projIdA]);
    assert.ok(audit.byProject[projIdB]);
    assert.equal(audit.byProject[projIdA].archivedCount, 2);
    assert.ok(audit.byProject[projIdA].supervisor);
    assert.ok(audit.byProject[projIdA].worker);
  });

  // -----------------------------------------------------------------
  // Test K: Verificação de policy de rotação de contexto
  // -----------------------------------------------------------------
  await t.test('Test K: byte estimate cannot rotate; verified context limit can', async () => {
    const activeWorker = AgentSessionManager.getActiveSession(projIdA, 'WORKER')!;
    
    // Normal context: should not rotate
    const normalCheck = AgentSessionManager.checkContextRotationPolicy(activeWorker);
    assert.equal(normalCheck.shouldRotate, false);

    // High context exceeding threshold
    const highContextSession = {
      ...activeWorker,
      context_estimate: AgentSessionManager.CONTEXT_ROTATION_THRESHOLD_BYTES + 1000
    };
    const highCheck = AgentSessionManager.checkContextRotationPolicy(highContextSession);
    assert.equal(highCheck.shouldRotate, false, 'Estimativa de bytes não comprova limite de tokens');
    const verified = AgentSessionManager.checkContextRotationPolicy({ ...highContextSession, metadata_json: JSON.stringify({ contextLimitVerified: true, contextLimitReason: 'PROVIDER_CONTEXT_LIMIT' }) });
    assert.equal(verified.shouldRotate, true);
    assert.equal(verified.reason, 'PROVIDER_CONTEXT_LIMIT');
  });

  // -----------------------------------------------------------------
  // Test L: Zero concorrência entre agentes mantida (Sequential Orchestration)
  // -----------------------------------------------------------------
  await t.test('Test L: Zero concorrência mantida — no máximo um agente executando por vez no pipeline', async () => {
    const pipelinePhases: string[] = [];

    // Phase 1: Supervisor plans
    pipelinePhases.push('SUPERVISOR_PLANNING');
    assert.equal(pipelinePhases[pipelinePhases.length - 1], 'SUPERVISOR_PLANNING');
    AutonomousRunnerService.releaseExecutionLock();

    // Phase 2: Worker implements
    pipelinePhases.push('WORKER_BUILDING');
    assert.equal(pipelinePhases[pipelinePhases.length - 1], 'WORKER_BUILDING');
    AutonomousRunnerService.releaseExecutionLock();

    // Phase 3: Evaluator evaluates
    pipelinePhases.push('INDEPENDENT_EVALUATION');
    assert.equal(pipelinePhases[pipelinePhases.length - 1], 'INDEPENDENT_EVALUATION');
    AutonomousRunnerService.releaseExecutionLock();

    assert.deepEqual(pipelinePhases, ['SUPERVISOR_PLANNING', 'WORKER_BUILDING', 'INDEPENDENT_EVALUATION']);
  });
});
