import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import { ExecutionCoordinator } from '../src/executionCoordinator.js';
import { AutonomousManager } from '../src/autonomousManager.js';
import { AutonomousRunnerService } from '../src/autonomousRunnerService.js';
import { AccountProfileManager } from '../src/accountProfileManager.js';
import { DevAutonomyService } from '../src/devAutonomyService.js';

test('HOTFIX: ExecutionCoordinator and AutonomousManager Force-Unlock Suite', async (t) => {
  const testProjectId = `proj-force-unlock-${Date.now()}`;
  const nowIso = new Date().toISOString();

  // Setup mock project in test database
  db.prepare(`
    INSERT OR REPLACE INTO projects (id, name, path, stack, status, is_trusted, full_dev_autonomy, created_at, updated_at)
    VALUES (?, 'Test Project Force Unlock', ?, 'TypeScript', 'active', 1, 1, ?, ?)
  `).run(testProjectId, process.cwd(), nowIso, nowIso);

  AccountProfileManager.initDefaultProfiles();

  t.after(() => {
    db.prepare('DELETE FROM execution_reservations').run();
    db.prepare('DELETE FROM autonomous_runs WHERE project_id = ?').run(testProjectId);
    db.prepare('DELETE FROM projects WHERE id = ?').run(testProjectId);
  });

  await t.test('1. ExecutionCoordinator: limpa automaticamente reserva com TTL expirado (> 5min), mesmo com PID vivo', () => {
    const scope = `test-ttl-expired-${Date.now()}`;
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

    // Inserir reserva antiga com PID atual (vivo)
    db.prepare(`
      INSERT INTO execution_reservations (scope, token, owner_pid, context_json, created_at, updated_at)
      VALUES (?, 'old-token', ?, '{}', ?, ?)
    `).run(scope, process.pid, tenMinutesAgo, tenMinutesAgo);

    assert.ok(db.prepare('SELECT 1 FROM execution_reservations WHERE scope=?').get(scope), 'Reserva antiga deve existir');

    // Ao tentar adquirir o mesmo scope, o TTL expirado deve ser detectado, expurgado e novo token gerado
    const newToken = ExecutionCoordinator.acquire(scope, { runId: 'new-run-ttl' });
    assert.ok(newToken, 'Deve adquirir novo token após auto-heal de TTL');
    assert.notEqual(newToken, 'old-token');

    const active: any = db.prepare('SELECT * FROM execution_reservations WHERE scope=?').get(scope);
    assert.equal(active.token, newToken);

    ExecutionCoordinator.release(scope, newToken);
  });

  await t.test('2. ExecutionCoordinator: limpa automaticamente reserva quando o run associado já está inativo/falho', () => {
    const scope = `test-run-inactive-${Date.now()}`;
    const deadRunId = `run-dead-${Date.now()}`;

    // Registrar run finalizado como failed
    db.prepare(`
      INSERT INTO autonomous_runs (id, project_id, name, objective, status, start_time, created_at, updated_at)
      VALUES (?, ?, 'Dead Run', 'Test', 'failed', ?, ?, ?)
    `).run(deadRunId, testProjectId, nowIso, nowIso, nowIso);

    // Inserir reserva vinculada ao run finalizado, com PID vivo e recente
    db.prepare(`
      INSERT INTO execution_reservations (scope, token, owner_pid, context_json, created_at, updated_at)
      VALUES (?, 'inactive-token', ?, ?, ?, ?)
    `).run(scope, process.pid, JSON.stringify({ runId: deadRunId }), nowIso, nowIso);

    // Deve detectar que o run está inativo e substituir sem lançar EXECUTION_BUSY
    const newToken = ExecutionCoordinator.acquire(scope, { runId: 'active-successor-run' });
    assert.ok(newToken);
    assert.notEqual(newToken, 'inactive-token');

    ExecutionCoordinator.release(scope, newToken);
  });

  await t.test('3. Auto-Heal em createRun: limpa reserva órfã de global-agent-execution sem travar com EXECUTION_BUSY', async () => {
    // Simular o caso exato da falha do usuário: reserva presa em global-agent-execution
    const stuckRunId = `stuck-run-${Date.now()}`;
    db.prepare(`
      INSERT INTO autonomous_runs (id, project_id, name, objective, status, last_error, start_time, created_at, updated_at)
      VALUES (?, ?, 'Stuck Run', 'Test', 'error', 'TURN_RECONCILIATION_REQUIRED', ?, ?, ?)
    `).run(stuckRunId, testProjectId, nowIso, nowIso, nowIso);

    db.prepare(`
      INSERT OR REPLACE INTO execution_reservations (scope, token, owner_pid, context_json, created_at, updated_at)
      VALUES ('global-agent-execution', 'stuck-token-user', ?, ?, ?, ?)
    `).run(process.pid, JSON.stringify({ runId: stuckRunId, projectId: testProjectId }), nowIso, nowIso);

    // Criar um novo run: não deve lançar EXECUTION_BUSY!
    const newRun = await AutonomousManager.createRun({
      projectId: testProjectId,
      name: 'Run Sucessor Após Destravamento',
      objective: 'Verificar ausência de EXECUTION_BUSY',
      forceNew: true
    });

    assert.ok(newRun, 'Novo run deve ser criado com sucesso');
    assert.ok(newRun.id, 'Novo run deve ter ID válido');
    assert.notEqual(newRun.id, stuckRunId, 'Deve ser um novo run');
  });

  await t.test('4. resumeRunInternal: limpa compulsoriamente global-agent-execution e retoma execução', async () => {
    const resumeRunId = `resume-test-run-${Date.now()}`;
    db.prepare(`
      INSERT INTO autonomous_runs (id, project_id, name, objective, status, last_error, start_time, created_at, updated_at)
      VALUES (?, ?, 'Paused Run to Resume', 'Test', 'paused', 'EXECUTION_BUSY', ?, ?, ?)
    `).run(resumeRunId, testProjectId, nowIso, nowIso, nowIso);

    // Trava global pendente
    db.prepare(`
      INSERT OR REPLACE INTO execution_reservations (scope, token, owner_pid, context_json, created_at, updated_at)
      VALUES ('global-agent-execution', 'lingering-token', ?, ?, ?, ?)
    `).run(process.pid, JSON.stringify({ runId: 'other-old-run' }), nowIso, nowIso);

    const resumed = await AutonomousManager.resumeRun(resumeRunId);
    assert.ok(resumed);
    assert.equal(resumed.status, 'running');
    assert.equal(resumed.last_error, null);

    // Reserva antiga deve ter sido limpa
    const lingering = db.prepare("SELECT * FROM execution_reservations WHERE token = 'lingering-token'").get();
    assert.equal(lingering, undefined);
  });

  await t.test('5. AutonomousManager.forceUnlockExecution: destrava reservas, turnos e runs', async () => {
    const lockedRunId = `locked-run-${Date.now()}`;
    const taskId = `task-locked-${Date.now()}`;

    db.prepare(`
      INSERT INTO autonomous_runs (id, project_id, name, objective, status, last_error, start_time, created_at, updated_at)
      VALUES (?, ?, 'Locked Run to Force Unlock', 'Test', 'failed', 'EXECUTION_BUSY: operação reservada', ?, ?, ?)
    `).run(lockedRunId, testProjectId, nowIso, nowIso, nowIso);

    db.prepare(`
      INSERT INTO autonomous_tasks (id, run_id, title, description, status, lifecycle_state, order_index, created_at, updated_at)
      VALUES (?, ?, 'Task in progress', 'desc', 'in_progress', 'IN_FLIGHT', 1, ?, ?)
    `).run(taskId, lockedRunId, nowIso, nowIso);

    db.prepare(`
      INSERT INTO agent_turn_observations (conversation_id, task_id, project_path, brain_dir, baseline_lines, baseline_files_json, phase, dispatched_at)
      VALUES ('conv-locked', ?, ?, '', 0, '[]', 'IN_FLIGHT', ?)
    `).run(taskId, process.cwd(), nowIso);

    db.prepare(`
      INSERT OR REPLACE INTO execution_reservations (scope, token, owner_pid, context_json, created_at, updated_at)
      VALUES ('global-agent-execution', 'tok-force-unlock', ?, ?, ?, ?)
    `).run(process.pid, JSON.stringify({ runId: lockedRunId }), nowIso, nowIso);

    const unlockResult = await AutonomousManager.forceUnlockExecution({ runId: lockedRunId });
    assert.equal(unlockResult.success, true);
    assert.ok(unlockResult.clearedReservations >= 1);
    assert.ok(unlockResult.clearedTurns >= 1);
    assert.ok(unlockResult.unlockedRuns.includes(lockedRunId));

    // Verificar que o run foi colocado em running e last_error zerado
    const updatedRun: any = db.prepare('SELECT status, last_error FROM autonomous_runs WHERE id = ?').get(lockedRunId);
    assert.equal(updatedRun.status, 'running');
    assert.equal(updatedRun.last_error, null);

    // Verificar que a tarefa foi reaberta para ready
    const updatedTask: any = db.prepare('SELECT status, lifecycle_state FROM autonomous_tasks WHERE id = ?').get(taskId);
    assert.equal(updatedTask.status, 'ready');
    assert.equal(updatedTask.lifecycle_state, 'READY');

    // Verificar que o turno foi marcado como CONSUMED
    const updatedTurn: any = db.prepare('SELECT phase FROM agent_turn_observations WHERE task_id = ?').get(taskId);
    assert.equal(updatedTurn.phase, 'CONSUMED');
  });
});
