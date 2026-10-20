import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { db } from '../src/db.js';
import { AgentTurnState } from '../src/agentTurnState.js';
import { AntigravityProvider } from '../src/antigravityProvider.js';
import { AgentApiGateway } from '../src/agentApiGateway.js';
import { AgentSessionManager } from '../src/agentSessionManager.js';
import { AutonomousManager } from '../src/autonomousManager.js';
import { AutonomousRunnerService } from '../src/autonomousRunnerService.js';
import { ExecutionCoordinator } from '../src/executionCoordinator.js';
import { WorkerRegistry } from '../src/workerRegistry.js';
import { IndependentEvaluator } from '../src/independentEvaluator.js';
import { installPipelineFixture } from './pipelineFixture.js';

function createTestWorkspace(t: any) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-native-auto-reconcile-'));
  const project = path.join(root, 'project');
  fs.mkdirSync(project, { recursive: true });
  const brain = path.join(root, '.gemini', 'antigravity', 'brain');
  fs.mkdirSync(brain, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, project, brain };
}

test('Estágio B: AGENT_NATIVE_TOOL_PENDING with passing files on disk auto-reconciles without waiting_approval', async t => {
  const { project } = createTestWorkspace(t);
  const id = 'reconcile-pass-project';
  const now = new Date().toISOString();
  db.prepare('INSERT INTO projects(id,name,path,objective,is_trusted,full_dev_autonomy,created_at,updated_at) VALUES(?,?,?,?,1,1,?,?)')
    .run(id, id, project, 'Soma Auto-Reconciliada', now, now);

  const fixture = installPipelineFixture(id, project, 1, false);
  const originalGetResult = AntigravityProvider.prototype.getResult;

  t.after(() => {
    AntigravityProvider.prototype.getResult = originalGetResult;
    AutonomousRunnerService.stop();
    WorkerRegistry.setProbeOverrideForTest(null);
    AgentApiGateway.installDefaultMock();
    const reservation: any = db.prepare("SELECT token FROM execution_reservations WHERE scope='global-agent-execution'").get();
    if (reservation) ExecutionCoordinator.release('global-agent-execution', reservation.token);
  });

  const run = await AutonomousManager.createRun({
    projectId: id,
    name: 'Auto-Reconcile Pass',
    objective: 'Soma validada',
    briefing: 'Soma validada'
  });

  // Mock getResult simulating timeout with AGENT_NATIVE_TOOL_PENDING while the agent actually wrote passing code
  AntigravityProvider.prototype.getResult = async () => ({
    status: 'failure',
    filesChanged: ['step-1.cjs'],
    implemented: ['Implementar incremento 1'],
    commandsExecuted: ['node acceptance.test.cjs 1'],
    tests: { ran: true, passed: true },
    buildStatus: 'SUCCESS',
    problems: ['AGENT_NATIVE_TOOL_PENDING: ask_question', 'AGENT_EXECUTION_TIMEOUT'],
    decisions: []
  });

  // Execute step: Estágio B should detect that step-1.cjs passes the IndependentEvaluator
  await AutonomousRunnerService.step(run.id);

  const updatedRun = AutonomousManager.getRun(run.id);
  // Status MUST NOT be waiting_approval! It must proceed to in_review or completed
  assert.notEqual(updatedRun.status, 'waiting_approval', 'Run never enters waiting_approval on native tool pending with passing tests');
  assert.ok(['in_review', 'completed'].includes(updatedRun.tasks[0].status), 'Task promotes to in_review or completed via IndependentEvaluator passing verdict');

  // Verify that an approval record was not left pending
  const pendingApprovals: any[] = db.prepare("SELECT * FROM autonomous_approvals WHERE run_id = ? AND status = 'pending'").all(run.id);
  assert.equal(pendingApprovals.length, 0, 'No approvals left pending');

  if (updatedRun.status !== 'completed') {
    await AutonomousRunnerService.step(run.id);
  }
  assert.equal(AutonomousManager.getRun(run.id).status, 'completed');
});

test('Estágio C: AGENT_NATIVE_TOOL_PENDING with failing tests sets waiting_resource, NEVER waiting_approval', async t => {
  const { project } = createTestWorkspace(t);
  const id = 'reconcile-fail-project';
  const now = new Date().toISOString();
  db.prepare('INSERT INTO projects(id,name,path,objective,is_trusted,full_dev_autonomy,created_at,updated_at) VALUES(?,?,?,?,1,1,?,?)')
    .run(id, id, project, 'Soma Falha Transitória', now, now);

  const fixture = installPipelineFixture(id, project, 1, false);
  const originalGetResult = AntigravityProvider.prototype.getResult;

  t.after(() => {
    AntigravityProvider.prototype.getResult = originalGetResult;
    AutonomousRunnerService.stop();
    WorkerRegistry.setProbeOverrideForTest(null);
    AgentApiGateway.installDefaultMock();
    const reservation: any = db.prepare("SELECT token FROM execution_reservations WHERE scope='global-agent-execution'").get();
    if (reservation) ExecutionCoordinator.release('global-agent-execution', reservation.token);
  });

  const send = fixture.provider.sendMessage.bind(fixture.provider);
  fixture.provider.sendMessage = (opts: any) => {
    send(opts);
    if (opts.role === 'WORKER') {
      const logs = path.join(fixture.brain, opts.conversationId, '.system_generated', 'logs');
      fs.writeFileSync(path.join(logs, 'transcript.jsonl'), JSON.stringify({
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        tool_calls: [{ name: 'run_command' }]
      }) + '\n');
      // Break the file on disk so Evaluator fails
      fs.writeFileSync(path.join(project, 'step-1.cjs'), 'exports.add = function() { throw new Error("not done"); };\n');
    }
  };

  const run = await AutonomousManager.createRun({
    projectId: id,
    name: 'Auto-Reconcile Fail',
    objective: 'Soma com falha transitória',
    briefing: 'Soma com falha transitória'
  });

  AntigravityProvider.prototype.getResult = async () => ({
    status: 'failure',
    filesChanged: [],
    implemented: [],
    commandsExecuted: [],
    tests: { ran: false },
    buildStatus: 'UNKNOWN',
    problems: ['AGENT_NATIVE_TOOL_PENDING: run_command', 'AGENT_EXECUTION_TIMEOUT'],
    decisions: []
  });

  await AutonomousRunnerService.step(run.id);

  const updatedRun = AutonomousManager.getRun(run.id);
  // Status MUST be waiting_resource with auto-recovery, NEVER waiting_approval
  assert.equal(updatedRun.status, 'waiting_resource', 'Run must be waiting_resource, not waiting_approval');
  assert.match(updatedRun.last_error || '', /TURN_RECONCILIATION_REQUIRED/, 'Records turn reconciliation requirement');
  assert.notEqual(updatedRun.status, 'waiting_approval', 'Forbidden from entering waiting_approval');
});

test('reconcileCompletedTurn and resumeRun unblock tasks when Evaluator verifies workspace code', async t => {
  const { project } = createTestWorkspace(t);
  const id = 'reconcile-turn-test';
  const now = new Date().toISOString();
  db.prepare('INSERT INTO projects(id,name,path,objective,is_trusted,full_dev_autonomy,created_at,updated_at) VALUES(?,?,?,?,1,1,?,?)')
    .run(id, id, project, 'Soma Teste Reconciliação', now, now);

  const fixture = installPipelineFixture(id, project, 1, false);

  t.after(() => {
    AutonomousRunnerService.stop();
    WorkerRegistry.setProbeOverrideForTest(null);
    AgentApiGateway.installDefaultMock();
    const reservation: any = db.prepare("SELECT token FROM execution_reservations WHERE scope='global-agent-execution'").get();
    if (reservation) ExecutionCoordinator.release('global-agent-execution', reservation.token);
  });

  const run = await AutonomousManager.createRun({
    projectId: id,
    name: 'Reconcile Turn Test',
    objective: 'Soma validada',
    briefing: 'Soma validada'
  });

  // Set the task to blocked (as occurred in ServiceFlow task 10)
  const task = run.tasks[0];
  db.prepare("UPDATE autonomous_tasks SET status = 'blocked', lifecycle_state = 'BLOCKED', updated_at = ? WHERE id = ?").run(now, task.id);
  db.prepare("UPDATE autonomous_runs SET status = 'waiting_approval', last_error = 'TURN_RECONCILIATION_REQUIRED: AGENT_NATIVE_TOOL_PENDING: ask_question', updated_at = ? WHERE id = ?").run(now, run.id);
  db.prepare("INSERT INTO autonomous_approvals (id, run_id, task_id, risk_level, title, context, why_needed, supervisor_recommendation, status, created_at) VALUES (?, ?, ?, 'yellow', 'Approval', 'Context', 'Why', 'Rec', 'pending', ?)").run('appr-test-1', run.id, task.id, now);

  // Write valid working code to disk matching acceptance criteria
  fs.writeFileSync(path.join(project, 'step-1.cjs'), 'exports.add = function add(a, b) { if (!Number.isFinite(a) || !Number.isFinite(b)) throw new TypeError("invalid"); return a + b; };\n');

  // Calling resumeRun should probe IndependentEvaluator and unblock the task to in_review and run to running
  const resumed = await AutonomousManager.resumeRun(run.id);
  assert.equal(resumed.status, 'running', 'Run resumed to running');
  assert.equal(resumed.tasks[0].status, 'in_review', 'Task promoted to in_review');

  const approval = db.prepare("SELECT status FROM autonomous_approvals WHERE id = ?").get('appr-test-1') as any;
  assert.equal(approval.status, 'approved', 'Incidental approval was auto-approved');
});
