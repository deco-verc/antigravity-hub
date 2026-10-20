import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { db } from '../src/db.js';
import { AccountProfileManager } from '../src/accountProfileManager.js';
import { AgentApiGateway, DefaultFakeAgentApiProvider } from '../src/agentApiGateway.js';
import { AgentSessionManager } from '../src/agentSessionManager.js';
import { AgentTurnState, observeTranscript } from '../src/agentTurnState.js';
import { AutonomousManager } from '../src/autonomousManager.js';
import { AutonomousRunnerService } from '../src/autonomousRunnerService.js';
import { McpCore } from '../src/mcpCore.js';
import { WorkerRegistry } from '../src/workerRegistry.js';
import { ExecutionCoordinator } from '../src/executionCoordinator.js';
import { installPipelineFixture } from './pipelineFixture.js';

function createTempProject(id: string, dir: string) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT OR REPLACE INTO projects (id, name, path, objective, is_trusted, full_dev_autonomy, created_at, updated_at)
    VALUES (?, ?, ?, 'Projeto de homologação de login e autonomia', 1, 1, ?, ?)
  `).run(id, id, dir, now, now);
}

function writeAntigravityAuthEvidence(
  envPath: string,
  opts: { email?: string; onboardingCompleted?: boolean }
) {
  const roamingDir = path.join(envPath, 'AppData', 'Roaming', 'Antigravity');
  const geminiDir = path.join(envPath, '.gemini', 'antigravity');
  fs.mkdirSync(roamingDir, { recursive: true });
  fs.mkdirSync(geminiDir, { recursive: true });

  const storageObj: Record<string, any> = {};
  if (opts.email) {
    storageObj['jetski.onboarding.lastLoginUsername'] = opts.email;
  }
  fs.writeFileSync(path.join(roamingDir, 'app_storage.json'), JSON.stringify(storageObj, null, 2), 'utf8');

  if (opts.onboardingCompleted) {
    fs.writeFileSync(
      path.join(geminiDir, 'antigravity_state.pbtxt'),
      'onboarding_state: AGENT_ONBOARDING_STATE_COMPLETED\n',
      'utf8'
    );
  }
}

test('PARTE 3 — Suíte Completa de Regressão: Login Antigravity (1–5) e Autonomia/Aprovações (6–12)', async (t) => {
  await t.test('1. Login bem-sucedido pelo fluxo real suportado', () => {
    const tmpEnv = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-login-ok-'));
    const fakeExe = path.join(tmpEnv, 'Antigravity.exe');
    fs.writeFileSync(fakeExe, 'binary-stub');
    const prevOffline = process.env.DECOHUB_OFFLINE_MODE;
    const prevNodeEnv = process.env.NODE_ENV;
    const prevBin = process.env.ANTIGRAVITY_BIN_PATH;

    const created = AccountProfileManager.createProfile({
      displayName: 'Conta Teste Real 1',
      profileName: `login-ok-${Date.now()}`
    });
    db.prepare('UPDATE account_profiles SET environment_path = ? WHERE id = ?').run(tmpEnv, created.id);

    try {
      AccountProfileManager.setVerifyProbeOverrideForTest(null);
      process.env.DECOHUB_OFFLINE_MODE = 'false';
      process.env.NODE_ENV = 'production';
      process.env.ANTIGRAVITY_BIN_PATH = fakeExe;

      writeAntigravityAuthEvidence(tmpEnv, {
        email: 'dev.autenticado@gmail.com',
        onboardingCompleted: true
      });

      const verified = AccountProfileManager.verifyProfile(created.id);
      assert.equal(verified.tested, true);
      assert.equal(verified.hasSession, true);
      assert.equal(verified.account, 'dev.autenticado@gmail.com');
      assert.equal(verified.profile.auth_status, 'READY');
      assert.equal(verified.profile.google_account_label, 'dev.autenticado@gmail.com');
    } finally {
      if (prevOffline === undefined) delete process.env.DECOHUB_OFFLINE_MODE;
      else process.env.DECOHUB_OFFLINE_MODE = prevOffline;
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNodeEnv;
      if (prevBin === undefined) delete process.env.ANTIGRAVITY_BIN_PATH;
      else process.env.ANTIGRAVITY_BIN_PATH = prevBin;
      db.prepare('DELETE FROM account_profiles WHERE id = ?').run(created.id);
      fs.rmSync(tmpEnv, { recursive: true, force: true });
    }
  });

  await t.test('2. Falha de login com diagnóstico correto (OAuth incompleto vs Runtime indisponível)', () => {
    const tmpEnv = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-login-fail-'));
    const fakeExe = path.join(tmpEnv, 'Antigravity.exe');
    fs.writeFileSync(fakeExe, 'binary-stub');
    const prevOffline = process.env.DECOHUB_OFFLINE_MODE;
    const prevNodeEnv = process.env.NODE_ENV;
    const prevBin = process.env.ANTIGRAVITY_BIN_PATH;

    const created = AccountProfileManager.createProfile({
      displayName: 'Conta Login Incompleto',
      profileName: `login-fail-${Date.now()}`
    });
    db.prepare('UPDATE account_profiles SET environment_path = ? WHERE id = ?').run(tmpEnv, created.id);

    try {
      AccountProfileManager.setVerifyProbeOverrideForTest(null);
      process.env.DECOHUB_OFFLINE_MODE = 'false';
      process.env.NODE_ENV = 'production';
      process.env.ANTIGRAVITY_BIN_PATH = fakeExe;

      // Case 2a: Antigravity opened (app_storage.json exists) but user did not finish Google OAuth
      writeAntigravityAuthEvidence(tmpEnv, { email: undefined, onboardingCompleted: false });
      const resIncomplete = AccountProfileManager.verifyProfile(created.id);
      assert.equal(resIncomplete.hasSession, false);
      assert.ok(['WAITING_LOGIN', 'LOGIN_REQUIRED'].includes(resIncomplete.profile.auth_status));
      assert.match(resIncomplete.reason || '', /não autenticada|Conclua o login|ainda não concluído/i);

      // Case 2b: Antigravity binary does not exist on the machine
      process.env.ANTIGRAVITY_BIN_PATH = path.join(tmpEnv, 'nao-existe', 'Antigravity.exe');
      const resNoBin = AccountProfileManager.verifyProfile(created.id);
      assert.equal(resNoBin.hasSession, false);
      assert.equal(resNoBin.profile.auth_status, 'RUNTIME_UNAVAILABLE');
      assert.match(resNoBin.reason || '', /Executável do Antigravity não encontrado/i);
    } finally {
      if (prevOffline === undefined) delete process.env.DECOHUB_OFFLINE_MODE;
      else process.env.DECOHUB_OFFLINE_MODE = prevOffline;
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNodeEnv;
      if (prevBin === undefined) delete process.env.ANTIGRAVITY_BIN_PATH;
      else process.env.ANTIGRAVITY_BIN_PATH = prevBin;
      db.prepare('DELETE FROM account_profiles WHERE id = ?').run(created.id);
      fs.rmSync(tmpEnv, { recursive: true, force: true });
    }
  });

  await t.test('3. Desconexão e troca de conta sem conflito de sessão (SESSION_PROFILE_MISMATCH evitado)', async () => {
    const tmpA = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-acc-a-'));
    const tmpB = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-acc-b-'));
    const projDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-proj-switch-'));
    const projId = `proj-switch-${Date.now()}`;
    createTempProject(projId, projDir);

    const accA = AccountProfileManager.createProfile({ displayName: 'Conta A', profileName: `acc-a-${Date.now()}` });
    const accB = AccountProfileManager.createProfile({ displayName: 'Conta B', profileName: `acc-b-${Date.now()}` });
    db.prepare('UPDATE account_profiles SET environment_path = ? WHERE id = ?').run(tmpA, accA.id);
    db.prepare('UPDATE account_profiles SET environment_path = ? WHERE id = ?').run(tmpB, accB.id);

    writeAntigravityAuthEvidence(tmpA, { email: 'conta.a@gmail.com', onboardingCompleted: true });
    writeAntigravityAuthEvidence(tmpB, { email: 'conta.b@gmail.com', onboardingCompleted: true });

    const fakeProvider = new DefaultFakeAgentApiProvider();
    AgentApiGateway.setMockProvider(fakeProvider);

    try {
      AccountProfileManager.verifyProfile(accA.id, 'conta.a@gmail.com');
      AccountProfileManager.verifyProfile(accB.id, 'conta.b@gmail.com');

      await AccountProfileManager.switchAccount({ projectId: projId, targetProfileId: accA.id });
      const sessA = await AgentSessionManager.getOrCreateAgentSession(projId, 'WORKER', { accountProfileId: accA.id });
      assert.equal(JSON.parse(sessA.session.metadata_json || '{}').accountProfileId, accA.id);

      // Switch project account from accA to accB
      const switchRes = await AccountProfileManager.switchAccount({
        projectId: projId,
        targetProfileId: accB.id
      });
      assert.equal(switchRes.activeProfile.id, accB.id);

      // Subsequent Worker session lookup on projId must bind cleanly to accB without throwing SESSION_PROFILE_MISMATCH
      const sessB = await AgentSessionManager.getOrCreateAgentSession(projId, 'WORKER', { accountProfileId: accB.id });
      assert.equal(JSON.parse(sessB.session.metadata_json || '{}').accountProfileId, accB.id);
      assert.notEqual(sessB.session.id, sessA.session.id);

      // Disconnect accA
      const disc = AccountProfileManager.disconnectProfile(accA.id);
      assert.equal(disc.success, true);
      assert.equal(disc.profile.auth_status, 'LOGIN_REQUIRED');
      assert.equal(disc.profile.google_account_label, null);

      const evidenceAfter = AccountProfileManager.inspectLocalAuthEvidence(tmpA);
      assert.equal(evidenceAfter.hasAuthEvidence, false);
      assert.equal(evidenceAfter.detectedUser, null);
    } finally {
      AgentApiGateway.installDefaultMock();
      db.prepare('DELETE FROM agent_sessions WHERE project_id = ?').run(projId);
      db.prepare('DELETE FROM account_project_sessions WHERE project_id = ?').run(projId);
      db.prepare('DELETE FROM projects WHERE id = ?').run(projId);
      db.prepare('DELETE FROM account_profiles WHERE id IN (?, ?)').run(accA.id, accB.id);
      fs.rmSync(tmpA, { recursive: true, force: true });
      fs.rmSync(tmpB, { recursive: true, force: true });
      fs.rmSync(projDir, { recursive: true, force: true });
    }
  });

  await t.test('4. Persistência da autenticação após reiniciar o aplicativo e 5. Ausência de falsos estados de conta conectada', () => {
    const tmpValid = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-persist-ok-'));
    const tmpEmpty = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-persist-empty-'));
    const prevOffline = process.env.DECOHUB_OFFLINE_MODE;
    const prevNodeEnv = process.env.NODE_ENV;

    writeAntigravityAuthEvidence(tmpValid, { email: 'persistente@gmail.com', onboardingCompleted: true });

    const profValid = AccountProfileManager.createProfile({ displayName: 'Conta Persistente', profileName: `persist-ok-${Date.now()}` });
    const profFake = AccountProfileManager.createProfile({ displayName: 'Conta Falsa Ready', profileName: `persist-fake-${Date.now()}` });

    db.prepare("UPDATE account_profiles SET environment_path = ?, auth_status = 'READY', google_account_label = 'persistente@gmail.com' WHERE id = ?")
      .run(tmpValid, profValid.id);
    db.prepare("UPDATE account_profiles SET environment_path = ?, auth_status = 'READY', google_account_label = 'fantasma@gmail.com' WHERE id = ?")
      .run(tmpEmpty, profFake.id);

    try {
      AccountProfileManager.setVerifyProbeOverrideForTest(null);
      process.env.DECOHUB_OFFLINE_MODE = 'false';
      process.env.NODE_ENV = 'production';

      // Scenario 4: Account with real local OAuth evidence remains READY after restart/re-read in production mode
      const reloadedValid = AccountProfileManager.getProfile(profValid.id);
      assert.ok(reloadedValid);
      assert.equal(reloadedValid.auth_status, 'READY');
      assert.equal(reloadedValid.google_account_label, 'persistente@gmail.com');

      // Scenario 5: Account claiming READY in SQLite WITHOUT local OAuth evidence on disk is downgraded to AUTH_UNKNOWN
      const reloadedFake = AccountProfileManager.getProfile(profFake.id);
      assert.ok(reloadedFake);
      assert.equal(reloadedFake.auth_status, 'AUTH_UNKNOWN');
    } finally {
      if (prevOffline === undefined) delete process.env.DECOHUB_OFFLINE_MODE;
      else process.env.DECOHUB_OFFLINE_MODE = prevOffline;
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNodeEnv;
      db.prepare('DELETE FROM account_profiles WHERE id IN (?, ?)').run(profValid.id, profFake.id);
      fs.rmSync(tmpValid, { recursive: true, force: true });
      fs.rmSync(tmpEmpty, { recursive: true, force: true });
    }
  });

  await t.test('6. Solicitação de aprovação realmente pendente e 7. Aprovação válida seguida da retomada da execução', async () => {
    const projDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-approval-flow-'));
    const projId = `proj-approval-${Date.now()}`;
    createTempProject(projId, projDir);
    const fixture = installPipelineFixture(projId, projDir, 1, false);

    try {
      const run = await AutonomousManager.createRun({
        projectId: projId,
        name: 'Run Aprovação Real',
        objective: 'Validar pausa e retomada após aprovação',
        briefing: 'Validar pausa e retomada após aprovação'
      });
      const taskId = run.tasks[0].id;

      // Scenario 6: Request a genuinely pending human approval
      const approvalId = AutonomousManager.requestHumanApproval({
        runId: run.id,
        taskId,
        riskLevel: 'orange',
        title: 'Confirmar migração de schema sensível',
        context: 'Alteração estrutural solicitada na microtarefa 1',
        whyNeeded: 'Política de segurança requer confirmação',
        supervisorRecommendation: 'Aprovar após revisão'
      });

      const pausedRun = AutonomousManager.getRun(run.id);
      assert.equal(pausedRun.status, 'waiting_approval');
      assert.equal(pausedRun.tasks[0].status, 'blocked');
      assert.equal(pausedRun.approvals.find((a: any) => a.id === approvalId)?.status, 'pending');

      // Scenario 7: Valid approval unblocks task and resumes run execution to completion
      const unblockedRun = AutonomousManager.resolveHumanApproval(approvalId, 'approved');
      assert.equal(unblockedRun.status, 'running');
      assert.equal(unblockedRun.tasks[0].status, 'ready');
      assert.equal(unblockedRun.approvals.find((a: any) => a.id === approvalId)?.status, 'approved');

      await AutonomousRunnerService.step(run.id);
      await AutonomousRunnerService.step(run.id);
      const completedRun = AutonomousManager.getRun(run.id);
      assert.equal(completedRun.status, 'completed');
      assert.equal(completedRun.tasks[0].status, 'completed');
      assert.ok(fixture.dispatches.length >= 1);
    } finally {
      AutonomousRunnerService.stop();
      WorkerRegistry.setProbeOverrideForTest(null);
      AgentApiGateway.installDefaultMock();
      fs.rmSync(projDir, { recursive: true, force: true });
    }
  });

  await t.test('8. Conclusão da tarefa antes da chegada de evento de aprovação atrasado e 9. Evento de aprovação duplicado', async () => {
    const projDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-late-dup-approval-'));
    const projId = `proj-late-dup-${Date.now()}`;
    createTempProject(projId, projDir);
    installPipelineFixture(projId, projDir, 2, false);

    try {
      const run = await AutonomousManager.createRun({
        projectId: projId,
        name: 'Run Late & Duplicate Approval',
        objective: 'Validar proteção contra eventos atrasados e duplicados',
        briefing: 'Validar proteção contra eventos atrasados e duplicados'
      });
      const task1 = run.tasks[0];
      const task2 = run.tasks[1];

      // Scenario 9a: Duplicate approval request while task2 is pending creates only 1 pending record
      const dupId1 = AutonomousManager.requestHumanApproval({
        runId: run.id,
        taskId: task2.id,
        riskLevel: 'orange',
        title: 'Aprovação única para Task 2',
        context: 'Teste de idempotência',
        whyNeeded: 'Evitar duplicidade',
        supervisorRecommendation: 'Aprovar'
      });
      const dupId2 = AutonomousManager.requestHumanApproval({
        runId: run.id,
        taskId: task2.id,
        riskLevel: 'orange',
        title: 'Aprovação única para Task 2',
        context: 'Teste de idempotência duplicado',
        whyNeeded: 'Evitar duplicidade',
        supervisorRecommendation: 'Aprovar'
      });
      assert.equal(dupId1, dupId2, 'Chamada duplicada de requestHumanApproval deve retornar o mesmo ID pendente');

      // Scenario 9b: Duplicate approval resolution is idempotent
      AutonomousManager.resolveHumanApproval(dupId1, 'approved');
      const afterSecondResolve = AutonomousManager.resolveHumanApproval(dupId1, 'approved');
      assert.equal(afterSecondResolve.tasks.find((t: any) => t.id === task2.id)?.status, 'ready');
      const dupEvents = db.prepare("SELECT COUNT(*) as n FROM autonomous_events WHERE run_id = ? AND event_type = 'DUPLICATE_APPROVAL_EVENT_IGNORED'").get(run.id) as any;
      assert.ok(dupEvents.n >= 2, 'Deve registrar DUPLICATE_APPROVAL_EVENT_IGNORED para requisição e resolução duplicadas');

      // Complete Task 1 via normal execution
      await AutonomousRunnerService.step(run.id);
      const afterStep1 = AutonomousManager.getRun(run.id);
      assert.equal(afterStep1.tasks.find((t: any) => t.id === task1.id)?.status, 'completed');

      // Scenario 8: Late approval request arrives for Task 1 AFTER Task 1 is already completed
      const lateApprovalId = AutonomousManager.requestHumanApproval({
        runId: run.id,
        taskId: task1.id,
        riskLevel: 'red',
        title: 'Evento atrasado para Task 1 já concluída',
        context: 'Chegou após conclusão da tarefa',
        whyNeeded: 'Atraso de transporte',
        supervisorRecommendation: 'Ignorar'
      });
      const afterLateReq = AutonomousManager.getRun(run.id);
      const task1AfterLate = afterLateReq.tasks.find((t: any) => t.id === task1.id);
      assert.equal(task1AfterLate.status, 'completed', 'Tarefa concluída jamais pode voltar para blocked por evento atrasado');
      const lateApprovalRow = afterLateReq.approvals.find((a: any) => a.id === lateApprovalId);
      assert.equal(lateApprovalRow.status, 'superseded');
      const lateEvents = db.prepare("SELECT COUNT(*) as n FROM autonomous_events WHERE run_id = ? AND event_type = 'LATE_APPROVAL_IGNORED'").get(run.id) as any;
      assert.ok(lateEvents.n >= 1, 'Deve registrar LATE_APPROVAL_IGNORED');
    } finally {
      AutonomousRunnerService.stop();
      WorkerRegistry.setProbeOverrideForTest(null);
      AgentApiGateway.installDefaultMock();
      fs.rmSync(projDir, { recursive: true, force: true });
    }
  });

  await t.test('10. Falha ou timeout no fluxo de aprovação', async () => {
    const projDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-approval-timeout-'));
    const projId = `proj-timeout-${Date.now()}`;
    createTempProject(projId, projDir);
    installPipelineFixture(projId, projDir, 1, false);

    try {
      const run = await AutonomousManager.createRun({
        projectId: projId,
        name: 'Run Approval Timeout',
        objective: 'Validar expiração segura de aprovação',
        briefing: 'Validar expiração segura de aprovação'
      });
      const taskId = run.tasks[0].id;

      const approvalId = AutonomousManager.requestHumanApproval({
        runId: run.id,
        taskId,
        riskLevel: 'red',
        title: 'Aprovação sujeita a timeout',
        context: 'Teste de timeout',
        whyNeeded: 'Política',
        supervisorRecommendation: 'Aguardar'
      });

      // Backdate approval creation by 20 minutes to trigger timeout expiration
      const twentyMinAgo = new Date(Date.now() - 20 * 60 * 1000).toISOString();
      db.prepare('UPDATE autonomous_approvals SET created_at = ? WHERE id = ?').run(twentyMinAgo, approvalId);

      const expiredCount = AutonomousManager.expireStaleApprovals(run.id, 15 * 60 * 1000);
      assert.equal(expiredCount, 1);

      const updatedRun = AutonomousManager.getRun(run.id);
      assert.equal(updatedRun.status, 'blocked');
      assert.match(updatedRun.last_error || '', /APPROVAL_TIMEOUT/);
      assert.equal(updatedRun.tasks[0].status, 'blocked');
      assert.equal(updatedRun.approvals.find((a: any) => a.id === approvalId)?.status, 'expired');
    } finally {
      AutonomousRunnerService.stop();
      WorkerRegistry.setProbeOverrideForTest(null);
      AgentApiGateway.installDefaultMock();
      fs.rmSync(projDir, { recursive: true, force: true });
    }
  });

  await t.test('11. Retomada do Supervisor após pendência (incluindo turno encerrado por erro de tool após compactação) e 12. Encerramento correto quando não há mais trabalho', async () => {
    const projDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-compaction-recovery-'));
    const brainRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-brain-compaction-'));
    const projId = `proj-compaction-${Date.now()}`;
    createTempProject(projId, projDir);
    installPipelineFixture(projId, projDir, 1, false);

    try {
      const run = await AutonomousManager.createRun({
        projectId: projId,
        name: 'Run Recuperação de Turno Pós-Compactação',
        objective: 'Validar recuperação automática do incidente real dcb4b95d e encerramento final',
        briefing: 'Validar recuperação automática do incidente real dcb4b95d e encerramento final'
      });
      const task = run.tasks[0];

      // 11a: Prove MCP tool get_tasks({ run_id }) resolves project from run_id without throwing "ID ou caminho do projeto é obrigatório"
      McpCore.initTools();
      const tasksViaRunId: any = await McpCore.handleToolCall('get_tasks', { run_id: run.id.slice(0, 8), summaryOnly: true });
      assert.ok(tasksViaRunId, 'get_tasks({ run_id }) deve resolver o projeto automaticamente');
      assert.ok(Array.isArray(tasksViaRunId.autonomousTasks), 'get_tasks({ run_id }) deve incluir autonomousTasks do run');
      assert.equal(tasksViaRunId.autonomousTasks.length, 1);

      // 11b: Simulate the exact real incident from dcb4b95d:
      // Worker session is active, task is in_progress, transcript after baselineLines has a CHECKPOINT compaction followed by a GENERIC step with status='ERROR' and no pendingTools
      const workerSession = await AgentSessionManager.getOrCreateAgentSession(projId, 'WORKER');
      const convId = workerSession.session.provider_conversation_id;
      const brainDir = path.join(brainRoot, '.gemini', 'antigravity', 'brain');
      const transcriptFile = path.join(brainDir, convId, '.system_generated', 'logs', 'transcript.jsonl');
      fs.mkdirSync(path.dirname(transcriptFile), { recursive: true });

      // Line 1: previous completed task turn
      fs.writeFileSync(
        transcriptFile,
        JSON.stringify({ step_index: 1, type: 'PLANNER_RESPONSE', status: 'DONE', content: '### Relatório de Conclusão da Tarefa anterior' }) + '\n',
        'utf8'
      );

      // Begin turn observation for current task at baselineLines = 1
      const baseline = AgentTurnState.begin(convId, projDir, brainDir, task.id);
      assert.equal(baseline, 1);
      AgentTurnState.setPhase(convId, 'IN_FLIGHT');

      // Append compaction + tool error step (no pendingTools, turn aborted in Antigravity)
      fs.appendFileSync(
        transcriptFile,
        [
          JSON.stringify({ step_index: 2, type: 'USER_INPUT', status: 'DONE', content: 'Nova microtarefa' }),
          JSON.stringify({ step_index: 3, type: 'CHECKPOINT', status: 'DONE', content: '# Resuming from a compaction' }),
          JSON.stringify({ step_index: 4, type: 'GENERIC', status: 'ERROR', error: 'Erro ao executar tool' })
        ].join('\n') + '\n',
        'utf8'
      );

      const observed = observeTranscript(transcriptFile, baseline);
      assert.equal(observed.abortedOnStepError, true, 'observeTranscript deve detectar turno encerrado em step de erro sem ferramentas pendentes');
      assert.equal(observed.pendingTools.length, 0);

      // Mark task as in_progress and run as paused with LEASE_RECONCILIATION_REQUIRED (exact state of run 8300fcc5)
      const nowIso = new Date().toISOString();
      db.prepare("UPDATE autonomous_tasks SET status = 'in_progress', lifecycle_state = 'IN_PROGRESS', updated_at = ? WHERE id = ?")
        .run(nowIso, task.id);
      db.prepare("UPDATE autonomous_runs SET status = 'paused', last_error = 'LEASE_RECONCILIATION_REQUIRED', updated_at = ? WHERE id = ?")
        .run(nowIso, run.id);

      // Reconcile the turn: must recover task to READY, mark turn CONSUMED, clear last_error, and set run to running
      const reconciled = await AutonomousRunnerService.reconcileCompletedTurn(run.id);
      assert.equal(reconciled, true);

      const recoveredRun = AutonomousManager.getRun(run.id);
      assert.equal(recoveredRun.status, 'running');
      assert.equal(recoveredRun.last_error, null);
      assert.equal(recoveredRun.tasks[0].status, 'ready');
      assert.equal(AgentTurnState.get(convId).phase, 'CONSUMED');

      // Now execute the step: Worker implements, Evaluator verifies, Supervisor approves, and Scenario 12: Run closes cleanly as completed when no more work exists
      await AutonomousRunnerService.step(run.id);
      await AutonomousRunnerService.step(run.id);
      const finalRun = AutonomousManager.getRun(run.id);
      assert.equal(finalRun.status, 'completed');
      assert.equal(finalRun.tasks[0].status, 'completed');
      assert.ok(finalRun.end_time, 'Run concluído deve registrar end_time');

      // Also verify that if a completed run ever receives a stale TURN_RECONCILIATION_REQUIRED flag, reconcileCompletedTurn closes it cleanly as completed
      db.prepare("UPDATE autonomous_runs SET status = 'paused', last_error = 'TURN_RECONCILIATION_REQUIRED: stale' WHERE id = ?").run(run.id);
      const reconciledStale = await AutonomousRunnerService.reconcileCompletedTurn(run.id);
      assert.equal(reconciledStale, true);
      const afterStale = AutonomousManager.getRun(run.id);
      assert.equal(afterStale.status, 'completed');
      assert.equal(afterStale.last_error, null);
    } finally {
      AutonomousRunnerService.stop();
      WorkerRegistry.setProbeOverrideForTest(null);
      AgentApiGateway.installDefaultMock();
      const reservation: any = db.prepare("SELECT token FROM execution_reservations WHERE scope='global-agent-execution'").get();
      if (reservation) ExecutionCoordinator.release('global-agent-execution', reservation.token);
      fs.rmSync(projDir, { recursive: true, force: true });
      fs.rmSync(brainRoot, { recursive: true, force: true });
    }
  });
});
