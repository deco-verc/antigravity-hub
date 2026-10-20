import './testSetup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  db,
  validateWorkspaceDataIsolation,
  resolveSafeHubDataDir,
  resolveProjectOperationalDataDir
} from '../src/db.js';
import {
  validateVerificationCommand,
  normalizeOrRecoverVerificationCommand
} from '../src/verificationCommand.js';
import { planVerification, executeVerification } from '../src/controlledVerification.js';
import { AutonomousManager } from '../src/autonomousManager.js';
import { AutonomousRunnerService } from '../src/autonomousRunnerService.js';
import { IndependentEvaluator } from '../src/independentEvaluator.js';
import { GeminiSupervisorProvider } from '../src/geminiSupervisorProvider.js';
import { AgentApiGateway } from '../src/agentApiGateway.js';
import { WorkerRegistry } from '../src/workerRegistry.js';
import { AntigravityProvider } from '../src/antigravityProvider.js';
import { AgentTurnState } from '../src/agentTurnState.js';
import { AgentSessionManager } from '../src/agentSessionManager.js';
import express from 'express';
import { apiRouter } from '../src/routes.js';
import { AccountProfileManager } from '../src/accountProfileManager.js';
import { RotatingFileLogger } from '../src/observability/fileLogger.js';
import { GitManager } from '../src/gitManager.js';
import { installPipelineFixture } from './pipelineFixture.js';

function createTrustedProject(id: string, dir: string, objective = 'Construir sistema modular verificado') {
  const now = new Date().toISOString();
  fs.mkdirSync(dir, { recursive: true });
  db.prepare(
    'INSERT INTO projects (id, name, path, objective, is_trusted, full_dev_autonomy, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1, ?, ?)'
  ).run(id, id, dir, objective, now, now);
}

function initGitRepo(dir: string) {
  execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'test@decohub.local'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'DecoHUB Test'], { cwd: dir, stdio: 'pipe' });
  fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules/\n.decohub-data/\n');
  execFileSync('git', ['add', '.gitignore'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'chore: initial commit'], { cwd: dir, stdio: 'pipe' });
}

test('Cenário 1: Comando de verificação incompatível rejeitado antes da execução e normalizado no planejamento', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-pilot01-scen1-'));
  const projectId = `scen1-${crypto.randomUUID().slice(0, 8)}`;
  createTrustedProject(projectId, dir);

  // 1a. Validate strict grammar rejection of compound and inline commands
  const checkCompound = validateVerificationCommand('node --check a.js && npm test', dir, { allowUncreatedFiles: true });
  assert.equal(checkCompound.valid, false);
  assert.match(checkCompound.reason || '', /COMMAND_REVIEW_REQUIRED/);

  const checkInline = validateVerificationCommand('node -e "console.log(1)"', dir, { allowUncreatedFiles: true });
  assert.equal(checkInline.valid, false);
  assert.match(checkInline.reason || '', /COMMAND_REVIEW_REQUIRED/);

  // 1b. Supervisor plans tasks with incompatible commands; system detects, normalizes, and logs event before persisting
  const fixture = installPipelineFixture(projectId, dir, 2, false);
  const origWait = GeminiSupervisorProvider.prototype.waitForResponse;
  GeminiSupervisorProvider.prototype.waitForResponse = async function (_cid, _to, _min, mode) {
    if (mode === 'PLAN') {
      return JSON.stringify([
        {
          title: 'Implementar incremento 1',
          description: 'Módulo 1',
          milestone: 'M1',
          orderIndex: 1,
          dependencies: [],
          criteria: ['Testes passam'],
          verificationCommand: 'node --check step-1.cjs && npm test',
          doneWhen: 'Testes verdes'
        },
        {
          title: 'Implementar incremento 2',
          description: 'Módulo 2',
          milestone: 'M1',
          orderIndex: 2,
          dependencies: ['Implementar incremento 1'],
          criteria: ['Testes passam'],
          verificationCommand: 'node -e "require(\'./step-2.cjs\')"',
          doneWhen: 'Testes verdes'
        }
      ]);
    }
    return JSON.stringify({ verdict: 'APPROVED', feedback: 'OK', qualityScore: 10, simplicityScore: 9, isSurgical: true });
  };

  t.after(() => {
    GeminiSupervisorProvider.prototype.waitForResponse = origWait;
    WorkerRegistry.setProbeOverrideForTest(null);
    AgentApiGateway.installDefaultMock();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const run = await AutonomousManager.createRun({
    projectId,
    name: 'Scen1 Plan Validation',
    objective: 'Validar comandos no plano',
    briefing: 'Validar comandos no plano'
  });

  assert.equal(run.tasks.length, 2);
  for (const task of run.tasks) {
    assert.doesNotMatch(task.verification_command, /&&|-e|--check/);
    assert.doesNotThrow(() => planVerification(task.verification_command, dir));
  }

  const normEvents: any[] = db
    .prepare("SELECT * FROM autonomous_events WHERE run_id = ? AND event_type = 'VERIFICATION_COMMAND_NORMALIZED'")
    .all(run.id);
  assert.equal(normEvents.length, 2, 'Deve registrar evento de normalização para cada comando incompatível');
  assert.ok(fixture);
});

test('Cenário 2: Recuperação segura de comando inválido quando existe comando canônico seguro no projeto', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-pilot01-scen2-'));
  const projectId = `scen2-${crypto.randomUUID().slice(0, 8)}`;
  createTrustedProject(projectId, dir);
  t.after(() => {
    WorkerRegistry.setProbeOverrideForTest(null);
    AgentApiGateway.installDefaultMock();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  installPipelineFixture(projectId, dir, 1, false);

  // Create real code and real test file compatible with controlledVerification.ts
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'scen2-pkg', version: '1.0.0', scripts: { test: 'node --test test/math.test.cjs' } })
  );
  fs.mkdirSync(path.join(dir, 'test'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'math.cjs'), 'exports.double = (x) => x * 2;\n');
  fs.writeFileSync(
    path.join(dir, 'test', 'math.test.cjs'),
    "const test = require('node:test'); const assert = require('node:assert/strict'); const { double } = require('../math.cjs'); test('double', () => assert.equal(double(21), 42));\n"
  );

  // Verify normalizeOrRecoverVerificationCommand recovers to canonical 'npm test'
  const recovered = normalizeOrRecoverVerificationCommand('node -e "assert(true)"', dir, {
    allowUncreatedFiles: false,
    requireCanonicalEvidenceOnDisk: true
  });
  assert.equal(recovered.validInitially, false);
  assert.equal(recovered.recovered, true);
  assert.equal(recovered.command, 'npm test');
  assert.doesNotThrow(() => planVerification(recovered.command, dir));

  // Verify Runner auto-recovers an in_review task that was blocked by a legacy incompatible verification_command
  const now = new Date().toISOString();
  const runId = crypto.randomUUID();
  const taskId = crypto.randomUUID();
  db.prepare(
    "INSERT INTO autonomous_runs (id, project_id, name, objective, status, start_time, created_at, updated_at) VALUES (?, ?, 'Scen2 Run', 'Test Recovery', 'running', ?, ?, ?)"
  ).run(runId, projectId, now, now, now);

  db.prepare(
    "INSERT INTO autonomous_tasks (id, run_id, title, description, status, verification_command, criteria_json, created_at, updated_at) VALUES (?, ?, 'Implementar math', 'Dobrar valor', 'in_review', 'node --check math.cjs && npm test', ?, ?, ?)"
  ).run(taskId, runId, JSON.stringify(['double(21) === 42']), now, now);

  const contract = IndependentEvaluator.createSuccessContract({
    taskId,
    runId,
    projectId,
    projectPath: dir,
    objective: 'Implementar math',
    acceptanceCriteria: ['double(21) === 42'],
    verificationCommand: 'node --check math.cjs && npm test'
  });
  db.prepare('UPDATE autonomous_tasks SET contract_id = ? WHERE id = ?').run(contract.id, taskId);

  const blockedEval = await IndependentEvaluator.evaluate(contract.id, dir, {
    status: 'success',
    filesChanged: ['math.cjs', 'test/math.test.cjs'],
    implemented: ['Implementar math']
  });
  assert.equal(blockedEval.verdict, 'BLOCKED');

  AutonomousManager.submitBuilderReport({
    runId,
    taskId,
    status: 'success',
    filesChanged: ['math.cjs', 'test/math.test.cjs'],
    implemented: ['Implementar math'],
    evaluation: blockedEval
  });

  await AutonomousRunnerService.step(runId);

  const updatedRun = AutonomousManager.getRun(runId);
  assert.equal(updatedRun.tasks[0].status, 'completed', 'A tarefa deve ser recuperada com npm test e aprovada');
  assert.equal(updatedRun.tasks[0].verification_command, 'npm test');
  const latestEval = IndependentEvaluator.getEvaluationByTaskId(taskId);
  assert.equal(latestEval?.verdict, 'PASS');
});

test('Cenário 3: Diretório de dados fora do workspace e bloqueio preventivo antes da run', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-pilot01-scen3-'));
  const projectDir = path.join(root, 'workspace');
  fs.mkdirSync(projectDir, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  // 3a. Attempting to point dataDir inside projectDir is rejected by validateWorkspaceDataIsolation
  const insideDataDir = path.join(projectDir, '.decohub-data');
  assert.throws(
    () => validateWorkspaceDataIsolation(projectDir, { dataDir: insideDataDir }),
    /DATA_DIR_ISOLATION_VIOLATION/
  );

  // 3b. Auto-relocation moves dataDir to a safe sibling directory outside projectDir
  const relocated = resolveSafeHubDataDir(projectDir, insideDataDir);
  assert.equal(relocated.valid, false);
  assert.equal(relocated.relocated, true);
  assert.ok(!relocated.hubDataDir.startsWith(projectDir + path.sep));
  assert.equal(path.dirname(relocated.hubDataDir), root);

  // 3c. If a stray .decohub-data directory exists inside projectDir, createRun rejects before starting
  const projectId = `scen3-${crypto.randomUUID().slice(0, 8)}`;
  createTrustedProject(projectId, projectDir);
  fs.mkdirSync(insideDataDir, { recursive: true });
  await assert.rejects(
    () =>
      AutonomousManager.createRun({
        projectId,
        name: 'Forbidden Data Dir Run',
        objective: 'Teste',
        briefing: 'Teste'
      }),
    /DATA_DIR_ISOLATION_VIOLATION/
  );
  fs.rmSync(insideDataDir, { recursive: true, force: true });

  // 3d. With clean workspace and external HUB_DATA_DIR, controlledVerification executes without blocking
  fs.writeFileSync(
    path.join(projectDir, 'verify.test.cjs'),
    "const test = require('node:test'); const assert = require('node:assert/strict'); test('ok', () => assert.equal(1 + 1, 2));\n"
  );
  const out = executeVerification('node --test verify.test.cjs', projectDir);
  assert.match(out, /pass 1/i);
});

test('Cenário 4: Isolamento estrito entre dois projetos diferentes', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-pilot01-scen4-'));
  const projA = path.join(root, 'project-a');
  const projB = path.join(root, 'project-b');
  const nestedInA = path.join(projA, 'nested-project-b');
  fs.mkdirSync(projA, { recursive: true });
  fs.mkdirSync(projB, { recursive: true });
  fs.mkdirSync(nestedInA, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  // Overlapping workspaces are rejected
  assert.throws(
    () => validateWorkspaceDataIsolation(nestedInA, { otherProjectRoots: [projA] }),
    /WORKSPACE_ISOLATION_VIOLATION/
  );

  // Sibling workspaces pass isolation and receive distinct operational data directories outside both workspaces
  const isoA = validateWorkspaceDataIsolation(projA, { otherProjectRoots: [projB] });
  const isoB = validateWorkspaceDataIsolation(projB, { otherProjectRoots: [projA] });
  assert.equal(isoA.valid, true);
  assert.equal(isoB.valid, true);

  const opDirA = resolveProjectOperationalDataDir('proj-a', path.join(root, 'hub-data'));
  const opDirB = resolveProjectOperationalDataDir('proj-b', path.join(root, 'hub-data'));
  assert.notEqual(opDirA, opDirB);
  assert.ok(!opDirA.startsWith(projA));
  assert.ok(!opDirB.startsWith(projB));
});

test('Cenários 5, 6, 7 e 8: Transição automática entre tarefas, evaluation_results real, supervisor_reviews final e estado completed consistente', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-pilot01-scen5678-'));
  const projectId = `scen5678-${crypto.randomUUID().slice(0, 8)}`;
  createTrustedProject(projectId, dir, 'Construir dois módulos aritméticos verificados');
  initGitRepo(dir);
  const fixture = installPipelineFixture(projectId, dir, 2, false);

  t.after(() => {
    AutonomousRunnerService.stop();
    WorkerRegistry.setProbeOverrideForTest(null);
    AgentApiGateway.installDefaultMock();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const run = await AutonomousManager.createRun({
    projectId,
    name: 'Full Official Flow',
    objective: 'Implementar 2 módulos incrementais',
    briefing: 'Implementar 2 módulos incrementais'
  });

  assert.equal(run.tasks.length, 2);
  assert.equal(run.tasks[0].status, 'ready');
  assert.equal(run.tasks[1].status, 'pending');

  // Execute full run via official service method without any external resume script
  const finalRun = await AutonomousRunnerService.runUntilTerminal(run.id);

  // Scenario 5: Automatic task-to-task transition completed both tasks
  assert.equal(finalRun.status, 'completed');
  assert.equal(finalRun.tasks.every((tk: any) => tk.status === 'completed'), true);
  assert.equal(fixture.dispatches.length, 2);

  // Scenario 6: Real evaluation records persisted in evaluation_results for every task
  const evalRows: any[] = db
    .prepare('SELECT * FROM evaluation_results WHERE task_id IN (SELECT id FROM autonomous_tasks WHERE run_id = ?)')
    .all(run.id);
  assert.equal(evalRows.length, 2);
  for (const row of evalRows) {
    assert.equal(row.verdict, 'PASS');
    assert.equal(row.task_is_done, 1);
    assert.equal(row.exit_code, 0);
    const cmds = JSON.parse(row.executed_commands_json || '[]');
    assert.ok(cmds.length > 0, 'Deve registrar comando real executado pelo Evaluator');
  }

  // Scenario 7: Final project review persisted in supervisor_reviews alongside task reviews
  const reviewRows: any[] = db
    .prepare('SELECT * FROM supervisor_reviews WHERE run_id = ? ORDER BY created_at ASC')
    .all(run.id);
  assert.equal(reviewRows.length, 3, 'Deve conter as 2 revisões de tarefas + 1 revisão final do projeto');
  const finalReviewRow = reviewRows.find(r => r.task_id === 'FINAL_PROJECT_REVIEW');
  assert.ok(finalReviewRow, 'Revisão final do projeto deve estar persistida em supervisor_reviews');
  assert.equal(finalReviewRow.verdict, 'APPROVED');

  // Scenario 8: Run state is consistent with tasks, evaluations, and final review
  assert.ok(finalRun.end_time, 'Run concluído deve possuir end_time preenchido');
  assert.equal(finalRun.reviews.length, 3);
});

test('Cenários 9 e 10: Recuperação de tarefa interrompida sem reexecutar Builder e sem duplicar commits ou avaliações', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-pilot01-scen910-'));
  const projectId = `scen910-${crypto.randomUUID().slice(0, 8)}`;
  createTrustedProject(projectId, dir, 'Implementar módulo com recuperação idempotente');
  initGitRepo(dir);
  const fixture = installPipelineFixture(projectId, dir, 1, false);
  const origGetResult = AntigravityProvider.prototype.getResult;

  t.after(() => {
    AntigravityProvider.prototype.getResult = origGetResult;
    AutonomousRunnerService.stop();
    WorkerRegistry.setProbeOverrideForTest(null);
    AgentApiGateway.installDefaultMock();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const run = await AutonomousManager.createRun({
    projectId,
    name: 'Idempotent Recovery Run',
    objective: 'Implementar incremento 1',
    briefing: 'Implementar incremento 1'
  });

  // Simulate interruption/timeout right after Worker already wrote the file on disk
  AntigravityProvider.prototype.getResult = async () => ({
    status: 'failure',
    filesChanged: ['step-1.cjs'],
    implemented: [],
    commandsExecuted: [],
    tests: { ran: false },
    buildStatus: 'UNKNOWN',
    problems: ['AGENT_EXECUTION_TIMEOUT'],
    decisions: []
  });

  await AutonomousRunnerService.step(run.id);
  const interrupted = AutonomousManager.getRun(run.id);
  assert.equal(interrupted.status, 'paused');
  assert.equal(interrupted.tasks[0].status, 'in_progress');
  assert.equal(fixture.dispatches.length, 1, 'Worker foi despachado 1 vez antes da interrupção');

  // Restore getResult and reconcile completed turn via official resumeRun
  AntigravityProvider.prototype.getResult = origGetResult;
  const resumed = await AutonomousManager.resumeRun(run.id);
  assert.equal(resumed.status, 'running');
  assert.equal(resumed.tasks[0].status, 'in_review');
  assert.equal(fixture.dispatches.length, 1, 'Cenário 9: Não deve reenviar tarefa já concluída ao Builder');

  const taskId = resumed.tasks[0].id;
  const evalCountAfterFirstReconcile = (
    db.prepare('SELECT COUNT(*) as c FROM evaluation_results WHERE task_id = ?').get(taskId) as any
  ).c;
  assert.equal(evalCountAfterFirstReconcile, 1, 'Deve existir exatamente 1 avaliação PASS após reconciliação');

  const commitCountAfterFirstReconcile = Number(
    execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim()
  );

  // Scenario 10: Calling reconcileCompletedTurn again must NOT duplicate evaluation_results or git commits
  const workerSession = AgentSessionManager.getActiveSession(projectId, 'WORKER')!;
  AgentTurnState.setPhase(workerSession.provider_conversation_id, 'COMPLETE');
  await AutonomousRunnerService.reconcileCompletedTurn(run.id);

  const evalCountAfterSecondReconcile = (
    db.prepare('SELECT COUNT(*) as c FROM evaluation_results WHERE task_id = ?').get(taskId) as any
  ).c;
  assert.equal(evalCountAfterSecondReconcile, 1, 'Cenário 10: Reconciliação repetida não pode duplicar evaluation_results');

  const commitCountAfterSecondReconcile = Number(
    execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim()
  );
  assert.equal(commitCountAfterSecondReconcile, commitCountAfterFirstReconcile, 'Cenário 10: Não pode criar commit duplicado');

  // Finish the run via official runner
  const finalState = await AutonomousRunnerService.runUntilTerminal(run.id);
  assert.equal(finalState.status, 'completed');
  assert.equal(fixture.dispatches.length, 1, 'Total de despachos ao Worker permanece 1 do início ao fim');

  // Calling submitFinalProjectReview again must be idempotent
  const dupFinal = AutonomousManager.submitFinalProjectReview({
    runId: run.id,
    verdict: 'APPROVED',
    feedback: 'Chamada duplicada'
  });
  assert.equal(dupFinal.alreadyPersisted, true);
  const finalReviewsCount = (
    db.prepare("SELECT COUNT(*) as c FROM supervisor_reviews WHERE run_id = ? AND task_id = 'FINAL_PROJECT_REVIEW'").get(run.id) as any
  ).c;
  assert.equal(finalReviewsCount, 1, 'Cenário 10: Revisão final não pode ser duplicada em supervisor_reviews');

  // GitManager.commitAll consolidates once and is idempotent on subsequent calls
  assert.equal(GitManager.commitAll(dir, 'chore: consolidate workspace'), true);
  const commitsBeforeNoop = Number(
    execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim()
  );
  assert.equal(GitManager.commitAll(dir, 'noop commit'), true);
  const commitsAfterNoop = Number(
    execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim()
  );
  assert.equal(commitsAfterNoop, commitsBeforeNoop);
});

test('Validação Pré-Voo Piloto 02: POST /api/projects (folderPath + commit inicial HEAD), PUT /api/projects/:id/autonomy, auto-verificação de conta em WAITING_LOGIN e isolamento de logs', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-pilot02-preflight-'));
  const projectDir = path.join(root, 'piloto-autonomo-02');
  const customLogsBase = path.join(root, 'isolated-data-02');
  fs.mkdirSync(projectDir, { recursive: true });

  // 1. Verify RotatingFileLogger respects DECOHUB_DATA_DIR fallback
  const prevAiDir = process.env.AI_DEV_HUB_DATA_DIR;
  const prevDecoDir = process.env.DECOHUB_DATA_DIR;
  try {
    delete process.env.AI_DEV_HUB_DATA_DIR;
    process.env.DECOHUB_DATA_DIR = customLogsBase;
    const tempLogger = new RotatingFileLogger({ enabled: false });
    assert.equal(tempLogger.getLogsDir(), path.join(customLogsBase, 'logs'));
  } finally {
    if (prevAiDir !== undefined) process.env.AI_DEV_HUB_DATA_DIR = prevAiDir;
    else delete process.env.AI_DEV_HUB_DATA_DIR;
    if (prevDecoDir !== undefined) process.env.DECOHUB_DATA_DIR = prevDecoDir;
    else delete process.env.DECOHUB_DATA_DIR;
  }

  // 2. Verify AccountProfileManager.isAccountAvailableForTasks auto-verifies a profile in WAITING_LOGIN state
  const createdProf = AccountProfileManager.createProfile({
    displayName: `Preflight Profile ${Date.now()}`,
    googleAccountLabel: 'preflight@decohub.local'
  });
  assert.equal(createdProf.auth_status, 'WAITING_LOGIN');

  AccountProfileManager.setVerifyProbeOverrideForTest(() => true);
  const availableWhenProbePasses = AccountProfileManager.isAccountAvailableForTasks(createdProf.id);
  assert.equal(availableWhenProbePasses, true, 'Perfil em WAITING_LOGIN com sessão válida deve transicionar automaticamente e ficar disponível');
  assert.equal(AccountProfileManager.getProfile(createdProf.id)?.auth_status, 'READY');

  // Reset to WAITING_LOGIN and test when probe fails
  AccountProfileManager.updateStatus(createdProf.id, 'WAITING_LOGIN');
  AccountProfileManager.setVerifyProbeOverrideForTest(() => false);
  const availableWhenProbeFails = AccountProfileManager.isAccountAvailableForTasks(createdProf.id);
  assert.equal(availableWhenProbeFails, false, 'Perfil em WAITING_LOGIN sem sessão deve transicionar para LOGIN_REQUIRED e retornar false');
  assert.equal(AccountProfileManager.getProfile(createdProf.id)?.auth_status, 'LOGIN_REQUIRED');
  AccountProfileManager.setVerifyProbeOverrideForTest(null);
  AccountProfileManager.deleteProfile(createdProf.id);

  // 3. Verify official HTTP contract: POST /api/projects and PUT /api/projects/:id/autonomy
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  const server = await new Promise<import('node:http').Server>(resolve => {
    const srv = app.listen({ port: 0, host: '127.0.0.1', exclusive: true }, () => resolve(srv));
  });
  const addr = server.address() as import('node:net').AddressInfo;
  const baseUrl = `http://127.0.0.1:${addr.port}/api`;

  t.after(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    fs.rmSync(root, { recursive: true, force: true });
  });

  const createRes = await fetch(`${baseUrl}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Piloto Autonomo 02 Preflight',
      folderPath: projectDir,
      objective: 'Validar contrato oficial de criação de projeto',
      initGit: true
    })
  });
  assert.equal(createRes.status, 201);
  const createdProject: any = await createRes.json();
  assert.ok(createdProject.id, 'POST /api/projects deve gerar e retornar id UUID');
  assert.equal(createdProject.is_trusted, 1);
  assert.equal(createdProject.full_dev_autonomy, 1);

  // Verify initial git HEAD commit was created automatically on the empty directory
  const headHash = execFileSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: projectDir, encoding: 'utf8' }).trim();
  assert.match(headHash, /^[0-9a-f]{40}$/, 'POST /api/projects deve garantir commit inicial HEAD válido');

  // Verify PUT /api/projects/:id/autonomy official route
  const autonomyRes = await fetch(`${baseUrl}/projects/${createdProject.id}/autonomy`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ isTrusted: true, fullDevAutonomy: true })
  });
  assert.equal(autonomyRes.status, 200);
  const autonomyBody: any = await autonomyRes.json();
  assert.equal(autonomyBody.id, createdProject.id);
  assert.equal(autonomyBody.is_trusted, 1);
  assert.equal(autonomyBody.full_dev_autonomy, 1);

  // 4. Verify GET /api/health and GET /api/system/health isolation
  const healthRes = await fetch(`${baseUrl}/health`);
  assert.equal(healthRes.status, 200);
  const healthBody: any = await healthRes.json();
  assert.equal(healthBody.status, 'ok');
  assert.ok(healthBody.dataPath.endsWith('hub.db'));

  const sysHealthRes = await fetch(`${baseUrl}/system/health`);
  assert.equal(sysHealthRes.status, 200);
  const sysHealthBody: any = await sysHealthRes.json();
  assert.equal(sysHealthBody.database.path, healthBody.dataPath);
  assert.ok(!sysHealthBody.hubDataDir.toLowerCase().includes(path.join(os.homedir(), '.ai-dev-hub').toLowerCase()));

  // 5. Verify POST /api/projects/:id/messages contract on local command ('contexto') -> autonomousRun is null, execution.status is 'stored'
  const localCmdRes = await fetch(`${baseUrl}/projects/${createdProject.id}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'user', content: 'contexto' })
  });
  assert.equal(localCmdRes.status, 200);
  const localCmdBody: any = await localCmdRes.json();
  assert.equal(localCmdBody.execution.status, 'stored');
  assert.equal(localCmdBody.autonomousRun, null);

  // 6. Verify POST /api/projects/:id/messages when Supervisor planning fails -> returns HTTP 200 with execution.status = 'blocked'
  const origPlan = GeminiSupervisorProvider.prototype.planTasks;
  GeminiSupervisorProvider.prototype.planTasks = async () => {
    throw new Error('SIMULATED_SUPERVISOR_PLAN_FAILURE');
  };
  try {
    const failedPlanRes = await fetch(`${baseUrl}/projects/${createdProject.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'user', content: 'Construir modulo que falha no planejamento' })
    });
    assert.equal(failedPlanRes.status, 200);
    const failedPlanBody: any = await failedPlanRes.json();
    assert.equal(failedPlanBody.execution.status, 'blocked');
    assert.match(failedPlanBody.execution.reason, /SIMULATED_SUPERVISOR_PLAN_FAILURE/);
    assert.equal(failedPlanBody.autonomousRun.status, 'error');
    // Clean up failed run so we can test successful creation on the same project
    db.prepare('DELETE FROM autonomous_runs WHERE id = ?').run(failedPlanBody.autonomousRun.id);
  } finally {
    GeminiSupervisorProvider.prototype.planTasks = origPlan;
  }

  // 7. Verify POST /api/projects/:id/messages when Supervisor planning succeeds -> execution.status = 'started' and run persisted before response
  installPipelineFixture(createdProject.id, projectDir, 2, false);
  t.after(() => {
    AutonomousRunnerService.stop();
    WorkerRegistry.setProbeOverrideForTest(null);
    AgentApiGateway.installDefaultMock();
  });

  const msgRes = await fetch(`${baseUrl}/projects/${createdProject.id}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'user', content: 'Implementar 2 modulos incrementais verificados' })
  });
  assert.equal(msgRes.status, 200);
  const msgBody: any = await msgRes.json();
  assert.equal(msgBody.execution.status, 'started');
  assert.ok(msgBody.autonomousRun?.id, 'autonomousRun.id deve existir na resposta');
  assert.equal(msgBody.autonomousRun.status, 'running');
  assert.equal(msgBody.autonomousRun.tasks.length, 2);

  const runId = msgBody.autonomousRun.id;
  const dbRunRow: any = db.prepare('SELECT id, status FROM autonomous_runs WHERE id = ?').get(runId);
  assert.ok(dbRunRow, 'Run deve estar persistido no SQLite antes do retorno HTTP');

  // 8. Verify GET /api/autonomous/runs/:runId (existing and non-existent)
  const getRunRes = await fetch(`${baseUrl}/autonomous/runs/${runId}`);
  assert.equal(getRunRes.status, 200);
  const getRunBody: any = await getRunRes.json();
  assert.equal(getRunBody.id, runId);
  assert.equal(typeof getRunBody.iteration, 'number');
  assert.equal(typeof getRunBody.current_cycle, 'number');
  assert.equal(Array.isArray(getRunBody.tasks), true);
  assert.equal(getRunBody.tasks.length, 2);
  assert.equal(typeof getRunBody.tasks[0].order_index, 'number');
  assert.equal(typeof getRunBody.tasks[0].milestone, 'string');
  assert.equal(typeof getRunBody.tasks[0].retry_count, 'number');
  assert.equal(typeof getRunBody.tasks[0].verification_command, 'string');
  assert.equal(Array.isArray(getRunBody.reviews), true);
  assert.equal(Array.isArray(getRunBody.events), true);
  assert.equal(typeof getRunBody.stats.progressPct, 'number');

  const missingRunRes = await fetch(`${baseUrl}/autonomous/runs/run-inexistente-999`);
  assert.equal(missingRunRes.status, 404);
  const missingRunBody: any = await missingRunRes.json();
  assert.match(missingRunBody.error, /Autonomous Run não encontrado/);

  // 9. Verify Worker & Runner monitoring endpoints (and confirm /workers/summary is 404)
  const workersRes = await fetch(`${baseUrl}/workers`);
  assert.equal(workersRes.status, 200);
  const workersBody: any = await workersRes.json();
  assert.equal(Array.isArray(workersBody), true);

  const runnerStatusRes = await fetch(`${baseUrl}/autonomous/runner/status`);
  assert.equal(runnerStatusRes.status, 200);
  const runnerStatusBody: any = await runnerStatusRes.json();
  assert.equal(runnerStatusBody.runnerId, 'hub-runner-01');
  assert.equal(typeof runnerStatusBody.workerFleet.total, 'number');

  const workersSummaryRes = await fetch(`${baseUrl}/workers/summary`);
  assert.equal(workersSummaryRes.status, 200);
  const workersSummaryBody: any = await workersSummaryRes.json();
  assert.equal(typeof workersSummaryBody.total, 'number');
  assert.equal(typeof workersSummaryBody.ready, 'number');
  assert.equal(Array.isArray(workersSummaryBody.workers), true);

  // 10. Verify Observability monitoring endpoints (including /observability/summary)
  const obsHealthRes = await fetch(`${baseUrl}/observability/health`);
  assert.equal(obsHealthRes.status, 200);
  const obsHealthBody: any = await obsHealthRes.json();
  assert.ok(['healthy', 'degraded', 'critical'].includes(obsHealthBody.status));
  assert.equal(typeof obsHealthBody.activeAnomaliesCount, 'number');

  const obsEventsRes = await fetch(`${baseUrl}/observability/events?runId=${runId}&limit=20`);
  assert.equal(obsEventsRes.status, 200);
  const obsEventsBody: any = await obsEventsRes.json();
  assert.equal(Array.isArray(obsEventsBody.events), true);
  assert.equal(typeof obsEventsBody.total, 'number');

  const obsEmptyEventsRes = await fetch(`${baseUrl}/observability/events?runId=run-inexistente-999`);
  assert.equal(obsEmptyEventsRes.status, 200);
  const obsEmptyEventsBody: any = await obsEmptyEventsRes.json();
  assert.deepEqual(obsEmptyEventsBody, { events: [], total: 0, limit: 50, offset: 0 });

  const obsTimelineRes = await fetch(`${baseUrl}/observability/runs/${runId}/timeline`);
  assert.equal(obsTimelineRes.status, 200);
  const obsTimelineBody: any = await obsTimelineRes.json();
  assert.equal(Array.isArray(obsTimelineBody), true);

  const obsMissingEventRes = await fetch(`${baseUrl}/observability/events/evt-inexistente-999`);
  assert.equal(obsMissingEventRes.status, 404);

  const obsSummaryRes = await fetch(`${baseUrl}/observability/summary`);
  assert.equal(obsSummaryRes.status, 200);
  const obsSummaryBody: any = await obsSummaryRes.json();
  assert.ok(['healthy', 'degraded', 'critical'].includes(obsSummaryBody.status));
  assert.ok(obsSummaryBody.metrics);
  assert.equal(Array.isArray(obsSummaryBody.anomalies), true);

  db.prepare('DELETE FROM autonomous_runs WHERE id = ?').run(runId);
});

test('Autoaperfeiçoamento Noturno: Reconciliação automática no schedulerTick, recuperação de arquivo de teste divergente, cláusulas negativas no briefing e extração JSON multi-bloco', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-overnight-improvements-'));
  const projectId = `overnight-${crypto.randomUUID().slice(0, 8)}`;
  const cliBriefing = 'Criar biblioteca Node.js com interface de linha de comando (CLI), sem interface web, sem dashboard e sem banco de dados';
  createTrustedProject(projectId, dir, cliBriefing);
  initGitRepo(dir);
  const fixture = installPipelineFixture(projectId, dir, 1, false);
  const origGetResult = AntigravityProvider.prototype.getResult;

  t.after(() => {
    AntigravityProvider.prototype.getResult = origGetResult;
    AutonomousRunnerService.stop();
    WorkerRegistry.setProbeOverrideForTest(null);
    AgentApiGateway.installDefaultMock();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // 1. Negative clauses ("sem interface web", "sem banco de dados", "interface de linha de comando") must NOT trigger false visual/persistence requirements
  const completenessCheck = AutonomousRunnerService.checkProjectCompleteness(
    { briefing: cliBriefing, objective: cliBriefing },
    { path: dir, objective: cliBriefing }
  );
  assert.equal(completenessCheck.isComplete, true, 'Briefing com cláusulas negativas não deve exigir UI visual nem banco de dados');
  assert.deepEqual(completenessCheck.missingAspects, []);

  // 2. Multi-block / preceding prose JSON extraction in GeminiSupervisorProvider
  const supProvider = new GeminiSupervisorProvider('gemini-3.8-flash') as any;
  const multiBlockPlanResponse = [
    'Analisando a arquitetura solicitada:',
    '```bash',
    'npm test',
    '```',
    'Segue o plano final em JSON:',
    '```json',
    JSON.stringify([{ title: 'Tarefa 1', description: 'Desc', orderIndex: 1 }]),
    '```'
  ].join('\n');
  const extractedArray = supProvider.extractJsonArray(multiBlockPlanResponse);
  assert.equal(Array.isArray(extractedArray), true);
  assert.equal(extractedArray.length, 1);
  assert.equal(extractedArray[0].title, 'Tarefa 1');

  const multiBlockReviewResponse = [
    'Resumo de verificação [1, 2]:',
    '```txt',
    '{ rascunho não-json }',
    '```',
    'Veredito oficial:',
    '```json',
    JSON.stringify({ verdict: 'APPROVED', rationale: 'Todos os critérios atendidos com sucesso' }),
    '```'
  ].join('\n');
  const extractedObj = supProvider.extractJsonObject(multiBlockReviewResponse);
  assert.equal(extractedObj?.verdict, 'APPROVED');
  assert.equal(extractedObj?.rationale, 'Todos os critérios atendidos com sucesso');

  // 3. Post-implementation recovery when planned test file path does not exist on disk but package.json has canonical npm test
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'overnight-pkg', version: '1.0.0', scripts: { test: 'node --test step-1.test.cjs' } })
  );
  const missingPlannedFileCheck = validateVerificationCommand('node --test test/nonexistent-planned.test.cjs', dir, {
    allowUncreatedFiles: false
  });
  assert.equal(missingPlannedFileCheck.valid, false);
  assert.match(missingPlannedFileCheck.reason || '', /ausente no disco/);

  // 4. Automatic reconciliation in schedulerTick() when a run is paused with TURN_RECONCILIATION_REQUIRED
  const run = await AutonomousManager.createRun({
    projectId,
    name: 'Auto Reconcile Scheduler Run',
    objective: cliBriefing,
    briefing: cliBriefing
  });

  // First step: simulate timeout during getResult after Worker wrote step-1.cjs and step-1.test.cjs on disk
  AntigravityProvider.prototype.getResult = async () => ({
    status: 'failure',
    filesChanged: ['step-1.cjs'],
    implemented: [],
    commandsExecuted: [],
    tests: { ran: false },
    buildStatus: 'UNKNOWN',
    problems: ['AGENT_EXECUTION_TIMEOUT'],
    decisions: []
  });

  await AutonomousRunnerService.step(run.id);
  const pausedRun = AutonomousManager.getRun(run.id);
  assert.equal(pausedRun.status, 'paused');
  assert.match(pausedRun.last_error || '', /TURN_RECONCILIATION_REQUIRED/);
  assert.equal(fixture.dispatches.length, 1);

  // Restore getResult; first schedulerTick() automatically reconciles the completed turn AND executes the Supervisor task review!
  AntigravityProvider.prototype.getResult = origGetResult;
  (AutonomousRunnerService as any).isRunning = true;
  await (AutonomousRunnerService as any).schedulerTick();

  const afterFirstTickRun = AutonomousManager.getRun(run.id);
  assert.equal(afterFirstTickRun.tasks[0].status, 'completed', '1º schedulerTick reconcilia turno concluído e aprova a tarefa em revisão');

  // Second schedulerTick() executes the final project completion review and marks the run completed
  await (AutonomousRunnerService as any).schedulerTick();
  const afterSecondTickRun = AutonomousManager.getRun(run.id);
  assert.equal(afterSecondTickRun.status, 'completed', '2º schedulerTick executa a revisão final do projeto e conclui a run');
  assert.equal(fixture.dispatches.length, 1, 'Não deve reenviar a tarefa ao Worker após reconciliação automática');
});

test('Autodiagnóstico Profundo (D1–D6): Recuperação de success_contracts, expansão multi-tarefa de testes vs adulteração de valor, órfãos/deadlock no DAG, hidratação de expected_files e /terminal-logs', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-deep-autodiag-'));
  const projectId = `autodiag-${crypto.randomUUID().slice(0, 8)}`;
  createTrustedProject(projectId, dir, 'Construir biblioteca modular sem interface web e sem banco de dados');
  initGitRepo(dir);

  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  const server = await new Promise<import('node:http').Server>(resolve => {
    const srv = app.listen({ port: 0, host: '127.0.0.1', exclusive: true }, () => resolve(srv));
  });
  const baseUrl = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/api`;

  t.after(async () => {
    AutonomousRunnerService.stop();
    WorkerRegistry.setProbeOverrideForTest(null);
    AgentApiGateway.installDefaultMock();
    await new Promise<void>(resolve => server.close(() => resolve()));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // --- D2: Multi-task test expansion vs altered assertion value tampering ---
  fs.mkdirSync(path.join(dir, 'test'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'autodiag-pkg', version: '1.0.0', scripts: { test: 'node --test test/calc.test.cjs' } })
  );
  fs.writeFileSync(path.join(dir, 'calc.cjs'), 'exports.add = (a, b) => a + b;\nexports.mul = (a, b) => a * b;\n');
  const task1TestContent = [
    "const test = require('node:test');",
    "const assert = require('node:assert/strict');",
    "const { add } = require('../calc.cjs');",
    "test('add', () => {",
    "  assert.strictEqual(add(2, 3), 5);",
    "});",
    ""
  ].join('\n');
  fs.writeFileSync(path.join(dir, 'test', 'calc.test.cjs'), task1TestContent);
  execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'feat: task 1 base calc and test'], { cwd: dir, stdio: 'pipe' });

  // Contract for Task 2 automatically includes existing 'test/calc.test.cjs' in protectedEvaluationFiles
  const contractTask2 = IndependentEvaluator.createSuccessContract({
    taskId: `task-d2-${crypto.randomUUID().slice(0, 8)}`,
    runId: `run-d2-${crypto.randomUUID().slice(0, 8)}`,
    projectId,
    projectPath: dir,
    objective: 'Adicionar testes para mul mantendo add intacto',
    acceptanceCriteria: ['mul(2, 3) === 6'],
    verificationCommand: 'node --test test/calc.test.cjs',
    protectedEvaluationFiles: IndependentEvaluator.listEvaluationFiles(dir)
  });
  assert.ok(contractTask2.protectedEvaluationFiles.includes('test/calc.test.cjs'));

  // Case D2-A: Worker legitimately expands test/calc.test.cjs keeping original assertion intact -> PASS
  const expandedTestContent = [
    task1TestContent.trim(),
    "const { mul } = require('../calc.cjs');",
    "test('mul', () => {",
    "  assert.strictEqual(mul(2, 3), 6);",
    "});",
    ""
  ].join('\n');
  fs.writeFileSync(path.join(dir, 'test', 'calc.test.cjs'), expandedTestContent);

  const evalExpanded = await IndependentEvaluator.evaluate(contractTask2.id, dir, {
    status: 'success',
    filesChanged: ['calc.cjs', 'test/calc.test.cjs'],
    implemented: ['Adicionado teste mul mantendo add intacto']
  });
  assert.equal(evalExpanded.verdict, 'PASS', 'D2-A: Expansão legítima de arquivo de teste em run multi-tarefa deve aprovar');
  assert.equal(evalExpanded.taskIsDone, true);

  // Case D2-B: Worker alters the expected value of the original assertion (5 -> 999) without reducing assertion count -> TAMPERING_DETECTED
  const alteredValueContent = [
    "const test = require('node:test');",
    "const assert = require('node:assert/strict');",
    "const { add, mul } = require('../calc.cjs');",
    "test('add adulterado', () => {",
    "  assert.strictEqual(add(2, 3), 999);",
    "});",
    "test('mul', () => {",
    "  assert.strictEqual(mul(2, 3), 6);",
    "});",
    ""
  ].join('\n');
  fs.writeFileSync(path.join(dir, 'test', 'calc.test.cjs'), alteredValueContent);

  const evalAltered = await IndependentEvaluator.evaluate(contractTask2.id, dir, {
    status: 'success',
    filesChanged: ['test/calc.test.cjs'],
    implemented: ['Adulteração de valor esperado']
  });
  assert.equal(evalAltered.verdict, 'TAMPERING_DETECTED', 'D2-B: Alteração de valor de asserção existente deve ser bloqueada como TAMPERING_DETECTED');
  assert.equal(evalAltered.taskIsDone, false);

  // Restore valid expanded test file and commit
  fs.writeFileSync(path.join(dir, 'test', 'calc.test.cjs'), expandedTestContent);
  execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'feat: task 2 valid test expansion'], { cwd: dir, stdio: 'pipe' });

  // --- D1 & D4: Post-implementation verification command recovery updates success_contracts without SqliteError ---
  const now = new Date().toISOString();
  const runD1Id = crypto.randomUUID();
  const taskD1Id = crypto.randomUUID();
  db.prepare(
    "INSERT INTO autonomous_runs (id, project_id, name, objective, status, start_time, created_at, updated_at) VALUES (?, ?, 'Run D1 Recovery', 'Validar update em success_contracts', 'running', ?, ?, ?)"
  ).run(runD1Id, projectId, now, now, now);

  // Create contract with a verification command pointing to an uncreated test file name ('test/planned-uncreated.test.cjs')
  const contractD1 = IndependentEvaluator.createSuccessContract({
    taskId: taskD1Id,
    runId: runD1Id,
    projectId,
    projectPath: dir,
    objective: 'Validar recuperação pós-implementação em success_contracts',
    acceptanceCriteria: ['Testes passam via npm test recuperado'],
    verificationCommand: 'node --test test/planned-uncreated.test.cjs'
  });

  db.prepare(
    `INSERT INTO autonomous_tasks (
      id, run_id, title, description, status, verification_command, criteria_json,
      expected_files_json, protected_evaluation_files_json, contract_id, created_at, updated_at
    ) VALUES (?, ?, 'Tarefa D1', 'Recuperar comando na tabela success_contracts', 'in_progress', 'node --test test/planned-uncreated.test.cjs', ?, ?, ?, ?, ?, ?)`
  ).run(
    taskD1Id,
    runD1Id,
    JSON.stringify(['Testes passam']),
    JSON.stringify(['calc.cjs', 'test/calc.test.cjs']),
    JSON.stringify(['test/calc.test.cjs']),
    contractD1.id,
    now,
    now
  );

  // --- D5: Verify expected_files and protected_evaluation_files hydration ---
  const hydratedRun = AutonomousManager.getRun(runD1Id);
  assert.deepEqual(hydratedRun.tasks[0].expected_files, ['calc.cjs', 'test/calc.test.cjs']);
  assert.deepEqual(hydratedRun.tasks[0].protected_evaluation_files, ['test/calc.test.cjs']);

  // Trigger reconcileCompletedTurn for taskD1Id: planned file 'test/planned-uncreated.test.cjs' does not exist on disk,
  // so reconcileCompletedTurn recovers it to 'npm test' and updates success_contracts (D1)
  const convD1Id = `conv-d1-${crypto.randomUUID().slice(0, 8)}`;
  db.prepare(
    `INSERT INTO agent_sessions (
      id, project_id, role, logical_conversation_id, provider_conversation_id,
      generation, status, created_at, last_used_at, context_estimate
    ) VALUES (?, ?, 'WORKER', ?, ?, 1, 'ACTIVE', ?, ?, 0)`
  ).run(crypto.randomUUID(), projectId, convD1Id, convD1Id, now, now);

  AgentTurnState.begin(convD1Id, dir, dir, taskD1Id);
  AgentTurnState.setPhase(convD1Id, 'UNCERTAIN');

  AutonomousManager.submitBuilderReport({
    runId: runD1Id,
    taskId: taskD1Id,
    status: 'success',
    filesChanged: ['calc.cjs'],
    implemented: ['Implementado calc.cjs']
  });

  const reconciledOk = await AutonomousRunnerService.reconcileCompletedTurn(runD1Id);
  assert.equal(reconciledOk, true, 'D1: reconcileCompletedTurn deve atualizar success_contracts sem erro SQL e aprovar a tarefa');

  const updatedContractD1 = IndependentEvaluator.getContract(contractD1.id);
  assert.equal(updatedContractD1?.verificationSteps[0].command, 'npm test', 'D1: success_contracts deve persistir comando recuperado npm test');

  // --- D3: Orphaned in_progress task recovery & DAG_DEADLOCK detection ---
  const runD3Id = crypto.randomUUID();
  const orphanTaskId = crypto.randomUUID();
  db.prepare(
    "INSERT INTO autonomous_runs (id, project_id, name, objective, status, start_time, created_at, updated_at) VALUES (?, ?, 'Run D3 Orphan & Deadlock', 'Recuperar órfãs', 'running', ?, ?, ?)"
  ).run(runD3Id, projectId, now, now, now);

  db.prepare(
    "INSERT INTO autonomous_tasks (id, run_id, title, description, status, order_index, dependencies_json, created_at, updated_at) VALUES (?, ?, 'Tarefa Órfã', 'Sem lease ativa', 'in_progress', 1, '[]', ?, ?)"
  ).run(orphanTaskId, runD3Id, now, now);

  await AutonomousRunnerService.step(runD3Id);
  const recoveredTaskRow: any = db.prepare('SELECT status FROM autonomous_tasks WHERE id = ?').get(orphanTaskId);
  assert.equal(recoveredTaskRow.status, 'ready', 'D3-A: Tarefa órfã em in_progress sem lease ativa deve ser recuperada para ready');

  // Now simulate a DAG deadlock: mark orphanTask completed, and add a pending task with a non-existent dependency
  db.prepare("UPDATE autonomous_tasks SET status = 'completed' WHERE id = ?").run(orphanTaskId);
  const deadlockedTaskId = crypto.randomUUID();
  db.prepare(
    "INSERT INTO autonomous_tasks (id, run_id, title, description, status, order_index, dependencies_json, created_at, updated_at) VALUES (?, ?, 'Tarefa com Dependência Fantasma', 'Depende de ID inexistente', 'pending', 2, ?, ?, ?)"
  ).run(deadlockedTaskId, runD3Id, JSON.stringify(['non-existent-task-id-999']), now, now);

  await AutonomousRunnerService.step(runD3Id);
  const deadlockedRun = AutonomousManager.getRun(runD3Id);
  assert.equal(deadlockedRun.status, 'blocked', 'D3-B: Run com dependência órfã insolúvel deve transicionar para blocked');
  assert.match(deadlockedRun.last_error || '', /DAG_DEADLOCK/);

  // --- D6: GET /api/projects/:id/terminal-logs returns 200 OK with autonomous_events ---
  const termLogsRes = await fetch(`${baseUrl}/projects/${projectId}/terminal-logs`);
  assert.equal(termLogsRes.status, 200, 'D6: /api/projects/:id/terminal-logs deve responder 200 OK sem erro de activity_events');
  const termLogsBody: any = await termLogsRes.json();
  assert.equal(termLogsBody.project, projectId);
  assert.equal(Array.isArray(termLogsBody.logs), true);
  assert.ok(termLogsBody.logs.length > 0, 'Deve retornar eventos recentes da execução autônoma');
});

test('Missão 03 — Evolução Arquitetural e Inteligência Operacional (M3-1 a M3-5): aprendizado operacional, autodiagnóstico profundo, auto-remediação e auto-replanejamento', async (t) => {
  const { EngineeringContextService } = await import('../src/engineeringContextService.js');
  const { DiagnosticService } = await import('../src/observability/diagnosticService.js');
  const { PromptArchitectureService } = await import('../src/promptArchitectureService.js');

  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-m3-operational-intelligence-'));
  initGitRepo(projectDir);
  t.after(() => fs.rmSync(projectDir, { recursive: true, force: true }));
  const projectId = 'proj-m3-intelligence';
  const now = new Date().toISOString();

  fs.writeFileSync(
    path.join(projectDir, 'package.json'),
    JSON.stringify({ name: 'm3-app', version: '1.0.0', scripts: { test: 'node test/app.test.cjs' } }, null, 2)
  );
  fs.mkdirSync(path.join(projectDir, 'test'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'test', 'app.test.cjs'), 'const assert = require("node:assert"); assert.equal(2 + 2, 4);\n');

  createTrustedProject(projectId, projectDir, 'Construir dashboard web com persistência');

  // --- M3-1: Plan Quality Validator & Supervisor Review Scope Mapping ---
  const rawDirtyPlan: any[] = [
    {
      title: 'Implementar Módulo Base',
      description: 'Base',
      milestone: 'M1',
      orderIndex: 1,
      dependencies: ['Implementar Módulo Base', 'Tarefa Fantasma Inexistente'],
      criteria: [],
      verificationCommand: 'npm test',
      expected_files: ['src/base.ts']
    },
    {
      title: '  implementar módulo base  ', // duplicate title
      description: 'Duplicada',
      milestone: 'M1',
      orderIndex: 2,
      dependencies: [],
      criteria: ['Duplicado']
    },
    {
      title: 'Implementar API',
      description: 'Depende do Módulo Base',
      milestone: 'M2',
      orderIndex: 3,
      dependencies: ['Implementar Módulo Base', 'Outra Dependência Fantasma'],
      criteria: ['Endpoint /status responde 200']
    }
  ];

  const refinedPlan = GeminiSupervisorProvider.validateAndRefinePlanQuality(rawDirtyPlan);
  assert.equal(refinedPlan.length, 2, 'M3-1a: Plan validator deve remover tarefas duplicadas');
  assert.equal(refinedPlan[0].dependencies.length, 0, 'M3-1b: Auto-dependência e dependência fantasma devem ser podadas na tarefa 1');
  assert.ok(refinedPlan[0].criteria.length >= 2, 'M3-1c: Tarefa sem critérios deve receber critérios verificáveis padrão');
  assert.ok(refinedPlan[0].doneWhen && refinedPlan[0].doneWhen.length > 10, 'M3-1d: Tarefa sem doneWhen deve receber contrato explícito');
  assert.deepEqual(refinedPlan[0].expectedFiles, ['src/base.ts'], 'M3-1e: expected_files deve ser preservado em expectedFiles');
  assert.deepEqual(refinedPlan[1].dependencies, ['Implementar Módulo Base'], 'M3-1f: Dependência legítima preservada e fantasma removida');

  // Verify M3-1 reviewBuilderReport maps task.expected_files & task.verification_command from hydrated SQLite task
  let capturedSupervisorPrompt = '';
  const origBuildPrompt = PromptArchitectureService.buildSupervisorPrompt;
  PromptArchitectureService.buildSupervisorPrompt = (params: any) => {
    const res = origBuildPrompt.call(PromptArchitectureService, params);
    capturedSupervisorPrompt = res.prompt;
    return res;
  };
  try {
    const sup = new GeminiSupervisorProvider('flash', process.env, undefined, projectId);
    (sup as any).waitForResponse = async () => JSON.stringify({
      verdict: 'CHANGES_REQUESTED',
      feedback: 'Arquivo fora do escopo',
      qualityScore: 4
    });
    await sup.reviewBuilderReport(
      {
        id: 'task-hydrated-1',
        title: 'Tarefa Hidratada SQLite',
        criteria: ['Critério 1'],
        verification_command: 'node test/app.test.cjs',
        expected_files: ['src/allowed.ts']
      },
      {
        taskId: 'task-hydrated-1',
        status: 'COMPLETED',
        summary: 'Feito',
        filesChanged: ['src/allowed.ts', 'src/unrelated_hack.ts'],
        commandsExecuted: ['node test/app.test.cjs'],
        rawResponse: 'ok'
      },
      { id: projectId, name: 'M3', path: projectDir, objective: 'Teste' }
    );
    assert.match(capturedSupervisorPrompt, /node test\/app\.test\.cjs/, 'M3-1g: reviewBuilderReport deve injetar verification_command hidratado do SQLite');
    assert.match(capturedSupervisorPrompt, /src\/unrelated_hack\.ts/, 'M3-1h: reviewBuilderReport deve detectar arquivo fora de expected_files');
  } finally {
    PromptArchitectureService.buildSupervisorPrompt = origBuildPrompt;
  }

  // --- M3-2: Operational Learning Cycle (Failure -> Occurrence Increment -> Resolution -> Context Injection) ---
  const runM3Id = crypto.randomUUID();
  const taskM3Id = crypto.randomUUID();
  db.prepare(
    "INSERT INTO autonomous_runs (id, project_id, name, objective, briefing, status, start_time, created_at, updated_at) VALUES (?, ?, 'Run M3', 'Construir dashboard web', 'Dashboard web html', 'running', ?, ?, ?)"
  ).run(runM3Id, projectId, now, now, now);

  const contractM3 = IndependentEvaluator.createSuccessContract({
    taskId: taskM3Id,
    runId: runM3Id,
    projectId,
    projectPath: projectDir,
    objective: 'Implementar persistência SQLite sem bloqueio',
    acceptanceCriteria: ['Passar no teste automatizado'],
    verificationCommand: 'npm test'
  });

  db.prepare(
    "INSERT INTO autonomous_tasks (id, run_id, title, description, status, order_index, retry_count, contract_id, verification_command, created_at, updated_at) VALUES (?, ?, 'Implementar persistência SQLite', 'Persistência local', 'in_review', 1, 0, ?, 'npm test', ?, ?)"
  ).run(taskM3Id, runM3Id, contractM3.id, now, now);

  // Attempt 1: Builder submits failure report -> records operational lesson (unresolved, occurrences = 1)
  AutonomousManager.submitBuilderReport({
    runId: runM3Id,
    taskId: taskM3Id,
    status: 'failure',
    filesChanged: ['src/dbStore.ts'],
    implemented: ['Tentativa 1 com SQLITE_BUSY'],
    testResults: 'Error: SQLITE_BUSY: database is locked on Windows',
    recommendation: 'Usar conexão concorrente sem WAL lock'
  });

  // Supervisor requests changes -> increments occurrences on open lesson
  AutonomousManager.submitSupervisorReview({
    runId: runM3Id,
    taskId: taskM3Id,
    verdict: 'CHANGES_REQUESTED',
    feedback: 'Falha por SQLITE_BUSY ao abrir múltiplas conexões simultâneas sem timeout.'
  });

  const lessonsAfterFail = EngineeringContextService.getProjectLessons(projectId);
  assert.equal(lessonsAfterFail.length, 1, 'M3-2a: Deve existir 1 lição operacional consolidada para a tarefa');
  assert.equal(lessonsAfterFail[0].resolved, false, 'M3-2b: Lição deve estar em aberto antes da aprovação');
  assert.ok(lessonsAfterFail[0].occurrences >= 2, 'M3-2c: Ocorrências devem ser incrementadas ao repetir falha na mesma tarefa');
  assert.equal(fs.existsSync(path.join(projectDir, '.ai-dev-hub', 'lessons.md')), true, 'M3-2d: Arquivo .ai-dev-hub/lessons.md deve ser sincronizado em disco');

  // Verify context preparation injects the operational lesson into the prompt
  const ctxPkg = EngineeringContextService.prepareTaskContext({
    projectId,
    projectPath: projectDir,
    projectName: 'M3 Intelligence Project',
    projectObjective: 'Construir dashboard web',
    task: {
      id: taskM3Id,
      title: 'Implementar persistência SQLite',
      description: 'Corrigir SQLITE_BUSY na camada de banco',
      criteria: ['Passar no teste automatizado'],
      verificationCommand: 'npm test'
    }
  });
  assert.ok(ctxPkg.lessonsSummary && ctxPkg.lessonsSummary.includes('SQLITE_BUSY'), 'M3-2e: prepareTaskContext deve selecionar lições relevantes');
  assert.match(ctxPkg.formattedPromptBlock, /LIÇÕES OPERACIONAIS APRENDIDAS/, 'M3-2f: Bloco de prompt deve conter seção de Lições Operacionais Aprendidas');

  // Attempt 2: Builder fixes the issue, passes IndependentEvaluator, and Supervisor approves -> resolves the lesson!
  fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'src', 'dbStore.ts'), "import fs from 'node:fs'; export function save(d: string) { fs.writeFileSync('db.sqlite', d); }\n");
  const evalPass = await IndependentEvaluator.evaluate(contractM3.id, projectDir, {
    taskId: taskM3Id,
    status: 'COMPLETED',
    summary: 'Corrigido com busy_timeout e conexão única',
    filesChanged: ['src/dbStore.ts', 'test/app.test.cjs'],
    commandsExecuted: ['npm test'],
    rawResponse: 'Corrigido'
  });
  assert.equal(evalPass.verdict, 'PASS');

  AutonomousManager.submitBuilderReport({
    runId: runM3Id,
    taskId: taskM3Id,
    status: 'success',
    filesChanged: ['src/dbStore.ts', 'test/app.test.cjs'],
    implemented: ['Configurado busy_timeout e singleton'],
    recommendation: 'Usar singleton SQLite com busy_timeout = 5000ms',
    evaluation: evalPass
  });

  AutonomousManager.submitSupervisorReview({
    runId: runM3Id,
    taskId: taskM3Id,
    verdict: 'APPROVED',
    feedback: 'Excelente! Uso de singleton SQLite com busy_timeout resolveu o bloqueio e adicionou teste de regressão.'
  });

  const lessonsAfterResolve = EngineeringContextService.getProjectLessons(projectId);
  assert.equal(lessonsAfterResolve[0].resolved, true, 'M3-2g: Lição operacional deve ser marcada como resolved=true após aprovação na retentativa');
  assert.match(lessonsAfterResolve[0].workingStrategy || '', /busy_timeout/, 'M3-2h: Estratégia vencedora deve ser registrada na lição');
  assert.match(lessonsAfterResolve[0].regressionTest || '', /test\/app\.test\.cjs/, 'M3-2i: Arquivo de teste alterado na correção deve ser registrado como regressionTest');

  // --- M3-3 & M3-4: Deep Self-Diagnosis (Slow vs Stalled, Repetitive Error, Unexecuted Verification) & Smart Auto-Remediation ---
  const oldDateIso = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const recentDateIso = new Date(Date.now() - 15 * 1000).toISOString();

  // 1) Slow-but-active task (has recent command execution) vs Stalled task (no lease, no recent activity)
  const slowActiveTaskId = crypto.randomUUID();
  const stalledTaskId = crypto.randomUUID();
  const stuckApprovedReviewTaskId = crypto.randomUUID();
  const repeatFailTaskId = crypto.randomUUID();

  db.prepare(
    "INSERT INTO autonomous_tasks (id, run_id, title, description, status, order_index, retry_count, created_at, updated_at) VALUES (?, ?, 'Tarefa Lenta Mas Ativa', 'Compilando', 'in_progress', 2, 0, ?, ?)"
  ).run(slowActiveTaskId, runM3Id, oldDateIso, oldDateIso);

  db.prepare(
    "INSERT INTO command_executions (id, project_id, run_id, task_id, command, cwd, status, exit_code, duration_ms, created_at, completed_at) VALUES (?, ?, ?, ?, 'npm test', ?, 'COMPLETED', 0, 1200, ?, ?)"
  ).run(crypto.randomUUID(), projectId, runM3Id, slowActiveTaskId, projectDir, recentDateIso, recentDateIso);

  db.prepare(
    "INSERT INTO autonomous_tasks (id, run_id, title, description, status, order_index, retry_count, created_at, updated_at) VALUES (?, ?, 'Tarefa Travada Sem Lease', 'Stalled', 'in_progress', 3, 0, ?, ?)"
  ).run(stalledTaskId, runM3Id, oldDateIso, oldDateIso);

  // 2) Task stuck in `in_review` that already has PASS evaluation + APPROVED supervisor review
  db.prepare(
    "INSERT INTO autonomous_tasks (id, run_id, title, description, status, order_index, retry_count, created_at, updated_at) VALUES (?, ?, 'Tarefa Presa em Review Já Aprovada', 'Review concluído', 'in_review', 4, 0, ?, ?)"
  ).run(stuckApprovedReviewTaskId, runM3Id, oldDateIso, oldDateIso);

  db.prepare(
    "INSERT INTO builder_reports (id, run_id, task_id, status, files_changed_json, implemented_json, created_at) VALUES (?, ?, ?, 'success', '[]', '[]', ?)"
  ).run(crypto.randomUUID(), runM3Id, stuckApprovedReviewTaskId, oldDateIso);

  db.prepare(
    "INSERT INTO evaluation_results (id, contract_id, task_id, run_id, verdict, builder_status, evaluator_verdict, evaluator_name, task_is_done, passed_criteria_json, failed_criteria_json, evidence_json, expected_threshold, actual_result, evaluator_notes, executed_commands_json, exit_code, duration_ms, evaluated_at, created_at) VALUES (?, ?, ?, ?, 'PASS', 'COMPLETED', 'PASS', 'IndependentEvaluator', 1, '[]', '[]', '{}', 'ok', 'ok', 'ok', '[\"npm test\"]', 0, 100, ?, ?)"
  ).run(crypto.randomUUID(), contractM3.id, stuckApprovedReviewTaskId, runM3Id, oldDateIso, oldDateIso);

  db.prepare(
    "INSERT INTO supervisor_reviews (id, run_id, task_id, report_id, verdict, feedback, requirements_met, build_passed, tests_passed, ui_functional, quality_score, created_at) VALUES (?, ?, ?, 'latest', 'APPROVED', 'Aprovado', 1, 1, 1, 1, 10, ?)"
  ).run(crypto.randomUUID(), runM3Id, stuckApprovedReviewTaskId, oldDateIso);

  // 3) Task with repetitive error pattern (retry_count = 2)
  db.prepare(
    "INSERT INTO autonomous_tasks (id, run_id, title, description, status, order_index, retry_count, created_at, updated_at) VALUES (?, ?, 'Implementar persistência SQLite Repetida', 'Falha repetida', 'needs_changes', 5, 2, ?, ?)"
  ).run(repeatFailTaskId, runM3Id, oldDateIso, oldDateIso);

  // 4) Expired active worker lease + dead-PID reservation
  const expiredLeaseId = crypto.randomUUID();
  const stuckWorkerId = 'worker-stuck-m3';
  db.prepare(
    "INSERT INTO workers (id, name, provider, status, current_task_id, current_run_id, created_at, updated_at) VALUES (?, 'Worker Stuck M3', 'antigravity', 'BUSY', ?, ?, ?, ?)"
  ).run(stuckWorkerId, stalledTaskId, runM3Id, oldDateIso, oldDateIso);
  db.prepare(
    "INSERT INTO worker_leases (id, worker_id, run_id, task_id, claimed_at, lease_until, last_heartbeat, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'active')"
  ).run(expiredLeaseId, stuckWorkerId, runM3Id, stalledTaskId, oldDateIso, oldDateIso, oldDateIso);

  const deadScope = 'dead-pid-reservation-m3';
  db.prepare(
    "INSERT INTO execution_reservations (scope, token, owner_pid, metadata_json, created_at, updated_at) VALUES (?, 'tok-dead', 99999999, '{}', ?, ?)"
  ).run(deadScope, oldDateIso, oldDateIso);

  const anomalies = DiagnosticService.detectAnomalies({
    stalledTaskThresholdMs: 1000,
    stuckReviewThresholdMs: 1000,
    orphanReservationThresholdMs: 1000
  });

  const slowAnomaly = anomalies.find(a => a.affectedEntity.id === slowActiveTaskId);
  assert.ok(slowAnomaly, 'M3-3a: Deve detectar tarefa longa com comando recente');
  assert.equal(slowAnomaly?.type, 'SLOW_BUT_ACTIVE_EXECUTION', 'M3-3b: Tarefa com atividade recente deve ser classificada como SLOW_BUT_ACTIVE_EXECUTION e não travada');
  assert.equal(slowAnomaly?.failureClassification, 'SLOW_ACTIVE');

  const stalledAnomaly = anomalies.find(a => a.affectedEntity.id === stalledTaskId && a.type === 'STALLED_TASK_WITHOUT_LEASE');
  assert.ok(stalledAnomaly, 'M3-3c: Tarefa sem lease válida e sem atividade recente deve ser classificada como STALLED_TASK_WITHOUT_LEASE');
  assert.equal(stalledAnomaly?.failureClassification, 'STALLED');

  const repeatAnomaly = anomalies.find(a => a.affectedEntity.id === repeatFailTaskId && a.type === 'REPETITIVE_ERROR_PATTERN');
  assert.ok(repeatAnomaly, 'M3-3d: Tarefa com retry_count >= 2 deve gerar anomalia REPETITIVE_ERROR_PATTERN');
  assert.equal(repeatAnomaly?.failureClassification, 'PERSISTENT');
  assert.ok(repeatAnomaly?.relatedLessonId, 'M3-3e: REPETITIVE_ERROR_PATTERN deve correlacionar com lição operacional histórica do projeto');

  // Execute Smart Auto-Remediation
  const remediationResult = DiagnosticService.remediateAnomalies({
    stalledTaskThresholdMs: 1000,
    stuckReviewThresholdMs: 1000,
    orphanReservationThresholdMs: 1000
  });

  assert.ok(remediationResult.remediated.length >= 4, 'M3-4a: remediateAnomalies deve corrigir lease expirada, reserva de PID morto, tarefa órfã e tarefa presa em review aprovada');
  const leaseAfter: any = db.prepare('SELECT status FROM worker_leases WHERE id = ?').get(expiredLeaseId);
  assert.equal(leaseAfter.status, 'expired', 'M3-4b: Lease expirada deve ser marcada como expired');
  const workerAfter: any = db.prepare('SELECT status FROM workers WHERE id = ?').get(stuckWorkerId);
  assert.equal(workerAfter.status, 'READY', 'M3-4c: Worker preso em lease expirada deve voltar para READY');
  const resAfter: any = db.prepare('SELECT * FROM execution_reservations WHERE scope = ?').get(deadScope);
  assert.equal(resAfter, undefined, 'M3-4d: Reserva de PID morto deve ser removida');
  const stuckReviewAfter: any = db.prepare('SELECT status FROM autonomous_tasks WHERE id = ?').get(stuckApprovedReviewTaskId);
  assert.equal(stuckReviewAfter.status, 'completed', 'M3-4e: Tarefa presa em in_review com avaliação PASS e revisão APPROVED deve avançar para completed');
  const stalledAfter: any = db.prepare('SELECT status FROM autonomous_tasks WHERE id = ?').get(stalledTaskId);
  assert.equal(stalledAfter.status, 'ready', 'M3-4f: Tarefa órfã em in_progress deve voltar para ready');
  const slowActiveAfter: any = db.prepare('SELECT status FROM autonomous_tasks WHERE id = ?').get(slowActiveTaskId);
  assert.equal(slowActiveAfter.status, 'in_progress', 'M3-4g: Tarefa lenta mas ativa NÃO deve ser interrompida pela auto-remediação');

  // --- M3-5: Auto-Replanning on PROJECT_INCOMPLETE ---
  // Clean up extra tasks in runM3Id so only taskM3Id (completed) remains, while briefing asks for 'Dashboard web html' (missing visual UI on disk)
  db.prepare('DELETE FROM autonomous_tasks WHERE run_id = ? AND id != ?').run(runM3Id, taskM3Id);

  const origPlanM3 = GeminiSupervisorProvider.prototype.planTasks;
  let replanCalledWithMode = '';
  GeminiSupervisorProvider.prototype.planTasks = async (_briefing: string, _proj: any, opts?: any) => {
    replanCalledWithMode = opts?.mode || '';
    return [
      {
        title: 'Criar interface visual index.html do Dashboard',
        description: 'Adicionar dashboard web solicitado no briefing',
        milestone: 'M-REPLAN',
        orderIndex: 2,
        dependencies: [],
        criteria: ['Arquivo index.html criado'],
        verificationCommand: 'npm test',
        doneWhen: 'index.html presente e npm test passando'
      }
    ];
  };

  try {
    await AutonomousRunnerService.step(runM3Id);
    assert.equal(replanCalledWithMode, 'REPLAN', 'M3-5a: Runner deve acionar supervisor.planTasks em modo REPLAN quando checkProjectCompleteness detectar item faltante');

    const runAfterReplan = AutonomousManager.getRun(runM3Id);
    assert.equal(runAfterReplan.status, 'running', 'M3-5b: Run deve permanecer running após gerar tarefa incremental de replanejamento');
    assert.equal(runAfterReplan.tasks.length, 2, 'M3-5c: Nova tarefa incremental deve ser adicionada ao Run');
    assert.equal(runAfterReplan.tasks[1].status, 'ready', 'M3-5d: Nova tarefa incremental deve nascer como ready');
    assert.equal(
      runAfterReplan.events.some((e: any) => e.event_type === 'AUTO_REPLAN_INCOMPLETE'),
      true,
      'M3-5e: Evento AUTO_REPLAN_INCOMPLETE deve ser registrado'
    );

    // If the replanned task also finishes without creating index.html, the second completeness check must block (preventing infinite replanning loops)
    db.prepare("UPDATE autonomous_tasks SET status = 'completed' WHERE id = ?").run(runAfterReplan.tasks[1].id);
    await AutonomousRunnerService.step(runM3Id);
    const runSecondCheck = AutonomousManager.getRun(runM3Id);
    assert.equal(runSecondCheck.status, 'blocked', 'M3-5f: Se continuar incompleto após 1 auto-replanejamento, Run deve bloquear com segurança sem loop infinito');
    assert.match(runSecondCheck.last_error || '', /PROJECT_INCOMPLETE/);
  } finally {
    GeminiSupervisorProvider.prototype.planTasks = origPlanM3;
  }
});


