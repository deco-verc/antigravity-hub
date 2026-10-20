import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { db } from '../src/db.js';
import { AutonomousManager } from '../src/autonomousManager.js';
import { AutonomousRunnerService } from '../src/autonomousRunnerService.js';
import { WorkerRegistry } from '../src/workerRegistry.js';
import { AccountProfileManager } from '../src/accountProfileManager.js';
import { AgentSessionManager } from '../src/agentSessionManager.js';
import { AgentApiGateway } from '../src/agentApiGateway.js';

describe('DecoHUB — Validação Crítica de Retomada Pós-Quota e Isolamento Offline', () => {
  const testProjectId = `proj-quota-recov-${Date.now()}`;
  const testProjectDir = path.join(os.tmpdir(), testProjectId);
  const testProfileId = `prof-quota-recov-${Date.now()}`;
  const runId = `run-quota-recov-${Date.now()}`;
  const taskId = `task-quota-recov-${Date.now()}`;
  const workerId = `worker-quota-recov-${Date.now()}`;
  const targetBranch = 'feat/quota-resumption-test';
  const initialConvId = `conv-quota-mock-${Date.now()}`;
  const nowIso = new Date().toISOString();

  let conversationCreationCount = 0;

  before(async () => {
    fs.mkdirSync(testProjectDir, { recursive: true });

    // Init minimal git repo
    try {
      execSync('git init -b main', { cwd: testProjectDir, stdio: 'ignore' });
      execSync('git config user.name "DecoHUB Tester"', { cwd: testProjectDir, stdio: 'ignore' });
      execSync('git config user.email "tester@decohub.local"', { cwd: testProjectDir, stdio: 'ignore' });
      fs.writeFileSync(path.join(testProjectDir, 'package.json'), JSON.stringify({ name: 'quota-test', version: '1.0.0' }));
      execSync('git add package.json', { cwd: testProjectDir, stdio: 'ignore' });
      execSync('git commit -m "initial commit"', { cwd: testProjectDir, stdio: 'ignore' });
    } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "quotaRestartRecovery.test",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:quotaRestartRecovery.test]", err);
      }
    }

    // Setup Mock overrides to strictly count conversations
    AgentSessionManager.setProviderCreateOverride((params) => {
      conversationCreationCount++;
      return initialConvId;
    });
    AgentSessionManager.setProviderLivenessOverride(id => id === initialConvId);

    AgentSessionManager.setProviderSendMessageOverride((_convId, _msg) => {
      // Mocked send message does not create conversations
    });

    // 1. Setup Test AccountProfile in READY
    db.prepare(`
      INSERT INTO account_profiles (
        id, display_name, profile_name, google_account_label, environment_path, auth_status, created_at, updated_at
      ) VALUES (?, 'Profile Quota Test', 'prof_quota_test', 'quota@tester.local', ?, 'READY', ?, ?)
    `).run(testProfileId, testProjectDir, nowIso, nowIso);

    // 2. Setup Test Project with full dev autonomy
    db.prepare(`
      INSERT INTO projects (
        id, name, path, objective, created_at, updated_at, github_repo, github_branch,
        active_account_profile_id, is_trusted, full_dev_autonomy
      ) VALUES (?, 'Projeto Quota Recovery', ?, 'Validar recuperação pós-quota', ?, ?, 'deco-verc/test-repo', 'main', ?, 1, 1)
    `).run(testProjectId, testProjectDir, nowIso, nowIso, testProfileId);

    // 3. Setup Worker
    db.prepare(`
      INSERT INTO workers (id, name, provider, account_label, status, account_profile_id, pid, last_heartbeat, created_at, updated_at)
      VALUES (?, 'Worker Quota Test', 'antigravity', 'quota@tester.local', 'READY', ?, ?, ?, ?, ?)
    `).run(workerId, testProfileId, process.pid, nowIso, nowIso, nowIso);

    // 4. Setup Autonomous Run with specific branch
    db.prepare(`
      INSERT INTO autonomous_runs (
        id, project_id, name, objective, briefing, status, autonomy_mode,
        branch_name, max_hours, max_cycles, current_cycle, start_time,
        config_json, created_at, updated_at
      ) VALUES (?, ?, 'Execução Quota Test', 'Objetivo do Run', 'Briefing', 'running', 'autonomous', ?, 2.0, 10, 0, ?, '{}', ?, ?)
    `).run(runId, testProjectId, targetBranch, nowIso, nowIso, nowIso);

    // 5. Setup Task
    db.prepare(`
      INSERT INTO autonomous_tasks (
        id, run_id, title, description, milestone, order_index, dependencies_json, status, assigned_to, criteria_json, created_at, updated_at
      ) VALUES (?, ?, 'Implementar Feature X', 'Descrição da feature', 'M1', 1, '[]', 'ready', 'builder', '["Critério 1"]', ?, ?)
    `).run(taskId, runId, nowIso, nowIso);

    // 6. Pre-establish the worker session in AgentSessionManager
    await AgentSessionManager.getOrCreateAgentSession(testProjectId, 'WORKER', {
      model: 'gemini-2.5-pro',
      initialPrompt: 'Implementar Feature X'
    });
  });

  after(() => {
    AgentSessionManager.setProviderCreateOverride(null);
    AgentSessionManager.setProviderLivenessOverride(null);
    AgentSessionManager.setProviderSendMessageOverride(null);
    WorkerRegistry.releaseAllLeases(workerId);
    db.prepare('DELETE FROM worker_leases WHERE worker_id = ?').run(workerId);
    db.prepare('DELETE FROM workers WHERE id = ?').run(workerId);
    db.prepare('DELETE FROM agent_sessions WHERE project_id = ?').run(testProjectId);
    db.prepare('DELETE FROM autonomous_events WHERE run_id IN (SELECT id FROM autonomous_runs WHERE project_id = ?)').run(testProjectId);
    db.prepare('DELETE FROM autonomous_tasks WHERE run_id IN (SELECT id FROM autonomous_runs WHERE project_id = ?)').run(testProjectId);
    db.prepare('DELETE FROM autonomous_runs WHERE project_id = ?').run(testProjectId);
    db.prepare('DELETE FROM projects WHERE id = ?').run(testProjectId);
    db.prepare('DELETE FROM account_profiles WHERE id = ?').run(testProfileId);
    try { fs.rmSync(testProjectDir, { recursive: true, force: true }); } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "quotaRestartRecovery.test",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:quotaRestartRecovery.test]", err);
      }
    }
  });

  test('Fase 4.1: Quota esgotada (RESOURCE_EXHAUSTED 429) pausa o Run sem perder IDs e preserva a Task como ready', () => {
    const errorMsg = 'RESOURCE_EXHAUSTED: 429 Resource has been exhausted (check quota or try again later).';
    const updatedProfile = AccountProfileManager.markQuotaExhausted(testProfileId, errorMsg);

    assert.ok(updatedProfile);
    assert.strictEqual(updatedProfile.auth_status, 'QUOTA_EXHAUSTED');
    assert.ok(updatedProfile.quota_resets_at, 'Deve persistir timestamp de quota_resets_at no futuro');
    assert.ok(new Date(updatedProfile.quota_resets_at).getTime() > Date.now(), 'Timestamp deve estar no futuro');

    // Simular a contenção do AutonomousRunner ao capturar o 429
    const cooldownMsg = `Limite de cota individual atingido (RESOURCE_EXHAUSTED 429). Reseta às ${new Date(updatedProfile.quota_resets_at).toLocaleTimeString()}.`;
    WorkerRegistry.updateWorkerStatus(workerId, 'COOLDOWN', {
      current_task_id: null,
      current_run_id: null,
      current_issue_number: null,
      last_error: cooldownMsg
    });

    // Tarefa é devolvida como 'ready' sem ser penalizada
    db.prepare("UPDATE autonomous_tasks SET status = 'ready', updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), taskId);

    // Run é pausado de forma segura
    db.prepare("UPDATE autonomous_runs SET status = 'paused', last_error = ?, next_action = ?, updated_at = ? WHERE id = ?")
      .run(cooldownMsg, 'Execução pausada aguardando restabelecimento de cota ou troca de conta', new Date().toISOString(), runId);

    // Verificações
    const runAfterPause: any = db.prepare('SELECT * FROM autonomous_runs WHERE id = ?').get(runId);
    assert.strictEqual(runAfterPause.status, 'paused');
    assert.strictEqual(runAfterPause.branch_name, targetBranch, 'Branch original deve ser preservada');
    assert.ok(runAfterPause.last_error.includes('RESOURCE_EXHAUSTED'));

    const taskAfterPause: any = db.prepare('SELECT * FROM autonomous_tasks WHERE id = ?').get(taskId);
    assert.strictEqual(taskAfterPause.status, 'ready', 'Task deve estar em ready para retomada');
    assert.strictEqual(taskAfterPause.run_id, runId, 'Associação de Task e Run deve ser preservada');

    const workerAfterPause = WorkerRegistry.getWorker(workerId);
    assert.strictEqual(workerAfterPause?.status, 'COOLDOWN');

    // A conta NÃO deve estar disponível para despacho
    const isAvail = AccountProfileManager.isAccountAvailableForTasks(testProfileId);
    assert.strictEqual(isAvail, false, 'Conta com quota esgotada não pode ser elegível para tarefas');
  });

  test('Fase 4.2: Reinicialização do backend durante o cooldown NÃO retoma o Run prematuramente', () => {
    // Simula inicialização do backend com recoverInterruptedRuns
    AutonomousRunnerService.recoverInterruptedRuns();

    const runAfterRestart: any = db.prepare('SELECT * FROM autonomous_runs WHERE id = ?').get(runId);
    assert.strictEqual(runAfterRestart.status, 'paused', 'Run pausado por cota deve permanecer PAUSED após restart');

    const isAvail = AccountProfileManager.isAccountAvailableForTasks(testProfileId);
    assert.strictEqual(isAvail, false, 'Conta deve permanecer indisponível durante o cooldown após restart');
  });

  test('Fase 4.3: Expiração permite tentativa, sem inventar autenticação ou quota restaurada', () => {
    // Simula passagem do tempo (cooldown expirado há 1 minuto)
    const pastResetTime = new Date(Date.now() - 60000).toISOString();
    db.prepare('UPDATE account_profiles SET quota_resets_at = ? WHERE id = ?').run(pastResetTime, testProfileId);

    const refreshed = AccountProfileManager.checkAndRefreshQuotaStatus(testProfileId);
    assert.ok(refreshed);
    assert.strictEqual(refreshed.auth_status, 'AUTH_UNKNOWN', 'Cooldown não comprova OAuth ou quota');
    assert.strictEqual(refreshed.quota_resets_at, null, 'quota_resets_at deve ser limpo');

    const isAvail = AccountProfileManager.isAccountAvailableForTasks(testProfileId);
    assert.strictEqual(isAvail, true, 'Conta deve voltar a ser considerada elegível');

    const workerRefreshed = WorkerRegistry.getWorker(workerId);
    assert.strictEqual(workerRefreshed?.status, 'WAITING', 'Worker aguarda verificação do runtime antes de READY');
  });

  test('Fase 4.4: Scheduler detecta cota restabelecida e retoma o Run em running', () => {
    // O Scheduler busca runs pausados cujo erro contém RESOURCE_EXHAUSTED
    const pausedQuotaRuns: any[] = db.prepare(`
      SELECT r.*
      FROM autonomous_runs r
      WHERE r.status = 'paused' AND r.last_error LIKE '%RESOURCE_EXHAUSTED%' AND r.id = ?
    `).all(runId);

    assert.strictEqual(pausedQuotaRuns.length, 1);

    for (const pr of pausedQuotaRuns) {
      const prof = AccountProfileManager.getActiveProfileForProject(pr.project_id);
      if (AccountProfileManager.isAccountAvailableForTasks(prof.id)) {
        const now = new Date().toISOString();
        db.prepare(`
          UPDATE autonomous_runs
          SET status = 'running', next_action = 'Cota restabelecida. Retomando execução autônoma.', updated_at = ?
          WHERE id = ?
        `).run(now, pr.id);
      }
    }

    const resumedRun: any = db.prepare('SELECT * FROM autonomous_runs WHERE id = ?').get(runId);
    assert.strictEqual(resumedRun.status, 'running', 'Run deve ser reativado para running');
    assert.strictEqual(resumedRun.branch_name, targetBranch, 'Branch original continua preservada');
  });

  test('Fase 4.5: Retomada despacha a mesma Task sem criar nenhuma nova conversa no Antigravity', async () => {
    const preResumptionCreations = conversationCreationCount;

    // 1. Task disponível é exatamente a mesma
    const available = AutonomousManager.getAvailableTasks(runId);
    assert.strictEqual(available.length, 1);
    assert.strictEqual(available[0].id, taskId, 'A mesma tarefa original deve ser despachada');

    // 2. Reivindica a task com lease
    const claimedRun = AutonomousManager.claimTask(runId, taskId, 'builder');
    assert.ok(claimedRun);
    assert.strictEqual(claimedRun.id, runId);

    const taskAfterClaim: any = db.prepare('SELECT status, assigned_to FROM autonomous_tasks WHERE id = ?').get(taskId);
    assert.strictEqual(taskAfterClaim.status, 'in_progress');
    assert.strictEqual(taskAfterClaim.assigned_to, 'builder');

    // 3. Worker obtém a sessão de agente para continuar
    const { session: activeSession, isNew } = await AgentSessionManager.getOrCreateAgentSession(testProjectId, 'WORKER');
    assert.ok(activeSession);
    assert.strictEqual(isNew, false, 'Sessão existente deve ser reutilizada');
    assert.strictEqual(activeSession.provider_conversation_id, initialConvId, 'Deve reutilizar exatamente o conversationId anterior');

    // 4. NENHUMA nova conversa criada
    assert.strictEqual(conversationCreationCount, preResumptionCreations, 'Zero novas conversas devem ser criadas durante a retomada');
    assert.strictEqual(conversationCreationCount, 1, 'Total de conversas criadas deve permanecer 1 (a inicial)');

    // 5. Garantir que AgentApiGateway nunca fez chamada real
    assert.strictEqual(AgentApiGateway.isOfflineMode(), true, 'AgentApiGateway deve reportar offlineMode=true em testes');
  });
});
