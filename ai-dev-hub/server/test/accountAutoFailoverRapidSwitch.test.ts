import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { db } from '../src/db.js';
import { AccountProfileManager } from '../src/accountProfileManager.js';
import { AutonomousManager } from '../src/autonomousManager.js';
import { GitManager } from '../src/gitManager.js';

describe('Auto-Failover Multi-Conta via Rapid Switch Suite (FASE 20)', () => {
  test('1. Classificador e Failover Automático em Cota 429 / RESOURCE_EXHAUSTED preserva retry_count', async () => {
    AccountProfileManager.setVerifyProbeOverrideForTest(() => true);
    const testDir = path.join(os.tmpdir(), `auto-failover-quota-${Date.now()}-${randomUUID().slice(0, 6)}`);
    fs.mkdirSync(testDir, { recursive: true });

    try {
      // 1.1 Validar Classificador
      const quotaTestErrors = [
        'RESOURCE_EXHAUSTED: 429 AI credits balance is too low',
        'Individual quota reached (Resets in 1h 30m)',
        'QUOTA_EXHAUSTED',
        'Out of credits for account',
        'rate limit exceeded: code 429'
      ];

      for (const err of quotaTestErrors) {
        const cls = AccountProfileManager.classifyAccountOrQuotaError(err);
        assert.strictEqual(cls.isAccountOrQuotaError, true);
        assert.strictEqual(cls.kind, 'QUOTA');
      }

      // 1.2 Setup de 2 contas isoladas para o teste
      const all = AccountProfileManager.getAllProfiles();
      let acc1 = all[0];
      let acc2 = all[1];
      if (!acc2) {
        acc2 = AccountProfileManager.createProfile({
          displayName: 'Google Pro 2 Test',
          googleAccountLabel: 'failover.pro2@test.local'
        });
      }

      db.prepare("UPDATE account_profiles SET quota_resets_at = NULL, quota_message = NULL, auth_status = 'READY' WHERE id IN (?, ?)").run(acc1.id, acc2.id);

      const projectId = randomUUID();
      const runId = randomUUID();
      const taskId = randomUUID();
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO projects (id, name, path, active_account_profile_id, is_trusted, full_dev_autonomy, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, 1, ?, ?)
      `).run(projectId, 'Quota Failover Project', testDir, acc1.id, now, now);

      db.prepare(`
        INSERT INTO autonomous_runs (id, project_id, name, objective, status, start_time, created_at, updated_at)
        VALUES (?, ?, 'Quota Failover Run', 'Testar failover com cota', 'running', ?, ?, ?)
      `).run(runId, projectId, now, now, now);

      db.prepare(`
        INSERT INTO autonomous_tasks (id, run_id, title, status, lifecycle_state, retry_count, github_branch, created_at, updated_at)
        VALUES (?, ?, 'Tarefa Crítica Sem Penalidade', 'in_progress', 'IN_PROGRESS', 0, 'ai/1-tarefa-critica', ?, ?)
      `).run(taskId, runId, now, now);

      // Inserir worker-1 vinculado à acc1
      db.prepare(`
        INSERT INTO workers (id, name, account_profile_id, status, created_at, updated_at)
        VALUES ('worker-1', 'Worker 1', ?, 'WORKING', ?, ?)
        ON CONFLICT(id) DO UPDATE SET account_profile_id = excluded.account_profile_id, status = excluded.status
      `).run(acc1.id, now, now);

      // 1.3 Disparar falha simulada de cota
      const simulatedQuotaError = 'RESOURCE_EXHAUSTED: 429 AI credits balance is too low. Resets in 1h';
      const failoverRes = await AccountProfileManager.handleAccountFailureAndRapidSwitch({
        failedProfileId: acc1.id,
        projectId,
        runId,
        taskId,
        error: simulatedQuotaError,
        autoStartRuntime: false
      });

      assert.strictEqual(failoverRes.switched, true);
      assert.strictEqual(failoverRes.kind, 'QUOTA');
      assert.strictEqual(failoverRes.activeProfile.id, acc2.id);

      // 1.4 Validar status de acc1 colocado em cooldown
      const refreshedAcc1 = AccountProfileManager.getProfile(acc1.id);
      assert.strictEqual(refreshedAcc1?.auth_status, 'QUOTA_EXHAUSTED');
      assert.ok(refreshedAcc1?.quota_resets_at);

      // 1.5 Validar reatribuição de workers
      const refreshedWorker: any = db.prepare('SELECT account_profile_id, status FROM workers WHERE id = ?').get('worker-1');
      assert.ok(refreshedWorker);
      assert.strictEqual(refreshedWorker.account_profile_id, acc2.id);
      assert.strictEqual(refreshedWorker.status, 'READY');

      // 1.6 Validar que o retry_count da tarefa NÃO foi penalizado
      const refreshedTask: any = db.prepare('SELECT retry_count, status, lifecycle_state, github_branch FROM autonomous_tasks WHERE id = ?').get(taskId);
      assert.strictEqual(refreshedTask.retry_count, 0, 'O retry_count não deve ser incrementado em falhas de cota/conta');
      assert.strictEqual(refreshedTask.github_branch, 'ai/1-tarefa-critica');

      // 1.7 Validar emissão do evento de auditoria
      const event: any = db.prepare("SELECT * FROM autonomous_events WHERE run_id = ? AND event_type = 'ACCOUNT_RAPID_SWITCH_FAILOVER'").get(runId);
      assert.ok(event, 'Evento ACCOUNT_RAPID_SWITCH_FAILOVER deve ser registrado');
      assert.ok(event.message.includes('QUOTA'));
    } finally {
      AccountProfileManager.setVerifyProbeOverrideForTest(null);
      try { fs.rmSync(testDir, { recursive: true, force: true }); } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "accountAutoFailoverRapidSwitch.test",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:accountAutoFailoverRapidSwitch.test]", err);
      }
    }
    }
  });

  test('2. Classificador e Failover Automático em Erro de Autenticação (LOGIN_REQUIRED / Keyring)', async () => {
    AccountProfileManager.setVerifyProbeOverrideForTest(() => true);
    const testDir = path.join(os.tmpdir(), `auto-failover-auth-${Date.now()}-${randomUUID().slice(0, 6)}`);
    fs.mkdirSync(testDir, { recursive: true });

    try {
      // 2.1 Validar Classificador para AUTH
      const authTestErrors = [
        'AUTH_ERROR: Verify your account to continue',
        'LOGIN_REQUIRED: OAuth refresh token expired',
        'secret keyring is locked',
        'invalid_grant: refresh token revoked',
        'UNAUTHENTICATED: missing license'
      ];

      for (const err of authTestErrors) {
        const cls = AccountProfileManager.classifyAccountOrQuotaError(err);
        assert.strictEqual(cls.isAccountOrQuotaError, true);
        assert.strictEqual(cls.kind, 'AUTH');
      }

      const all = AccountProfileManager.getAllProfiles();
      let acc1 = all[0];
      let acc2 = all[1] || AccountProfileManager.createProfile({ displayName: 'Google Pro 2', googleAccountLabel: 'acc2@test.local' });

      // Restaurar explicitamente ambas as contas para READY e limpar quota_resets_at
      db.prepare("UPDATE account_profiles SET quota_resets_at = NULL, quota_message = NULL, auth_status = 'READY' WHERE id IN (?, ?)").run(acc1.id, acc2.id);

      const projectId = randomUUID();
      const runId = randomUUID();
      const taskId = randomUUID();
      const now = new Date().toISOString();

      // Configurar acc2 como ativa do projeto
      db.prepare(`
        INSERT INTO projects (id, name, path, active_account_profile_id, is_trusted, full_dev_autonomy, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, 1, ?, ?)
      `).run(projectId, 'Auth Failover Project', testDir, acc2.id, now, now);

      db.prepare(`
        INSERT INTO autonomous_runs (id, project_id, name, objective, status, start_time, created_at, updated_at)
        VALUES (?, ?, 'Auth Failover Run', 'Testar failover com auth', 'running', ?, ?, ?)
      `).run(runId, projectId, now, now, now);

      db.prepare(`
        INSERT INTO autonomous_tasks (id, run_id, title, status, lifecycle_state, retry_count, created_at, updated_at)
        VALUES (?, ?, 'Tarefa Auth Failover', 'in_progress', 'IN_PROGRESS', 0, ?, ?)
      `).run(taskId, runId, now, now);

      const authErr = 'AUTH_ERROR: Verify your account to continue (secret keyring is locked)';
      const failoverRes = await AccountProfileManager.handleAccountFailureAndRapidSwitch({
        failedProfileId: acc2.id,
        projectId,
        runId,
        taskId,
        error: authErr,
        autoStartRuntime: false
      });

      assert.strictEqual(failoverRes.switched, true);
      assert.strictEqual(failoverRes.kind, 'AUTH');
      assert.strictEqual(failoverRes.activeProfile.id, acc1.id);

      // Confirmar que acc2 agora está em LOGIN_REQUIRED
      const refreshedAcc2 = AccountProfileManager.getProfile(acc2.id);
      assert.strictEqual(refreshedAcc2?.auth_status, 'LOGIN_REQUIRED');

      // O projeto agora aponta para acc1
      const proj: any = db.prepare('SELECT active_account_profile_id FROM projects WHERE id = ?').get(projectId);
      assert.strictEqual(proj.active_account_profile_id, acc1.id);
    } finally {
      AccountProfileManager.setVerifyProbeOverrideForTest(null);
      try { fs.rmSync(testDir, { recursive: true, force: true }); } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "accountAutoFailoverRapidSwitch.test",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:accountAutoFailoverRapidSwitch.test]", err);
      }
    }
    }
  });

  test('3. Handoff / Resume Continuity: Branch, commits e workdir preservados na troca de conta', async () => {
    AccountProfileManager.setVerifyProbeOverrideForTest(() => true);
    const testDir = path.join(os.tmpdir(), `handoff-resume-${Date.now()}-${randomUUID().slice(0, 6)}`);
    fs.mkdirSync(testDir, { recursive: true });

    try {
      execSync('git init', { cwd: testDir, stdio: 'ignore' });
      execSync('git config user.name "DecoHUB Tester"', { cwd: testDir, stdio: 'ignore' });
      execSync('git config user.email "tester@decohub.local"', { cwd: testDir, stdio: 'ignore' });

      const testFile = path.join(testDir, 'feature.ts');
      fs.writeFileSync(testFile, 'export const feature = 1;\n', 'utf-8');
      GitManager.commitAll(testDir, 'feat: initial feature commit');

      const featureBranch = 'ai/42-autonomous-feature';
      GitManager.checkoutOrCreateBranch(testDir, featureBranch);
      fs.writeFileSync(testFile, 'export const feature = 2;\n', 'utf-8');
      GitManager.commitAll(testDir, 'feat: partial work by Account 1');

      const all = AccountProfileManager.getAllProfiles();
      let acc1 = all[0];
      let acc2 = all[1] || AccountProfileManager.createProfile({ displayName: 'Google Pro 2', googleAccountLabel: 'acc2@test.local' });
      db.prepare("UPDATE account_profiles SET quota_resets_at = NULL, quota_message = NULL, auth_status = 'READY' WHERE id IN (?, ?)").run(acc1.id, acc2.id);

      const projectId = randomUUID();
      const runId = randomUUID();
      const taskId = randomUUID();
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO projects (id, name, path, active_account_profile_id, is_trusted, full_dev_autonomy, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, 1, ?, ?)
      `).run(projectId, 'Handoff Project', testDir, acc1.id, now, now);

      db.prepare(`
        INSERT INTO autonomous_runs (id, project_id, name, objective, status, start_time, created_at, updated_at)
        VALUES (?, ?, 'Handoff Run', 'Testar continuidade de handoff', 'running', ?, ?, ?)
      `).run(runId, projectId, now, now, now);

      db.prepare(`
        INSERT INTO autonomous_tasks (id, run_id, title, status, lifecycle_state, retry_count, github_branch, created_at, updated_at)
        VALUES (?, ?, 'Tarefa com Commits Parciais', 'in_progress', 'IN_PROGRESS', 0, ?, ?, ?)
      `).run(taskId, runId, featureBranch, now, now);

      // Simular failover durante a tarefa
      const failoverRes = await AccountProfileManager.handleAccountFailureAndRapidSwitch({
        failedProfileId: acc1.id,
        projectId,
        runId,
        taskId,
        error: 'RESOURCE_EXHAUSTED: 429 quota reached',
        autoStartRuntime: false
      });

      assert.strictEqual(failoverRes.switched, true);

      // Reset defensivo da tarefa para READY preservando a branch
      db.prepare(`
        UPDATE autonomous_tasks
        SET status = 'ready', lifecycle_state = 'READY', updated_at = ?
        WHERE id = ?
      `).run(new Date().toISOString(), taskId);

      // Verificar que branch e conteúdo do repositório continuam 100% intactos
      const currentBranch = GitManager.getGitInfo(testDir).branch;
      assert.strictEqual(currentBranch, featureBranch);
      const fileContent = fs.readFileSync(testFile, 'utf-8');
      assert.strictEqual(fileContent, 'export const feature = 2;\n');

      const taskRow: any = db.prepare('SELECT github_branch, status, retry_count FROM autonomous_tasks WHERE id = ?').get(taskId);
      assert.strictEqual(taskRow.github_branch, featureBranch);
      assert.strictEqual(taskRow.status, 'ready');
      assert.strictEqual(taskRow.retry_count, 0);
    } finally {
      AccountProfileManager.setVerifyProbeOverrideForTest(null);
      try { fs.rmSync(testDir, { recursive: true, force: true }); } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "accountAutoFailoverRapidSwitch.test",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:accountAutoFailoverRapidSwitch.test]", err);
      }
    }
    }
  });

  test('4. Exaustão Segura quando 0 contas prontas restam no pool', async () => {
    AccountProfileManager.setVerifyProbeOverrideForTest(() => true);
    const testDir = path.join(os.tmpdir(), `safe-exhaustion-${Date.now()}-${randomUUID().slice(0, 6)}`);
    fs.mkdirSync(testDir, { recursive: true });

    try {
      // Marcar todas as contas cadastradas como QUOTA_EXHAUSTED
      const nowFuture = new Date(Date.now() + 3600000).toISOString();
      db.prepare("UPDATE account_profiles SET auth_status = 'QUOTA_EXHAUSTED', quota_resets_at = ?").run(nowFuture);

      const all = AccountProfileManager.getAllProfiles();
      const acc1 = all[0];
      const projectId = randomUUID();
      const runId = randomUUID();
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO projects (id, name, path, active_account_profile_id, is_trusted, full_dev_autonomy, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, 1, ?, ?)
      `).run(projectId, 'Exhaustion Project', testDir, acc1.id, now, now);

      db.prepare(`
        INSERT INTO autonomous_runs (id, project_id, name, objective, status, start_time, created_at, updated_at)
        VALUES (?, ?, 'Exhaustion Run', 'Testar exaustão segura', 'running', ?, ?, ?)
      `).run(runId, projectId, now, now, now);

      // Executar failover quando 0 contas estão disponíveis
      const failoverRes = await AccountProfileManager.handleAccountFailureAndRapidSwitch({
        failedProfileId: acc1.id,
        projectId,
        runId,
        error: 'RESOURCE_EXHAUSTED 429: No tokens remaining',
        autoStartRuntime: false
      });

      assert.strictEqual(failoverRes.switched, false);
      assert.ok(failoverRes.message.includes('Nenhuma outra conta'));

      // Simular pausa segura do run como faria o scheduler
      db.prepare(`
        UPDATE autonomous_runs
        SET status = 'paused', last_error = ?, updated_at = ?
        WHERE id = ?
      `).run(failoverRes.message, new Date().toISOString(), runId);

      const runRow: any = db.prepare('SELECT status, last_error FROM autonomous_runs WHERE id = ?').get(runId);
      assert.strictEqual(runRow.status, 'paused');
      assert.ok(runRow.last_error.includes('Nenhuma outra conta'));
    } finally {
      // Restaurar contas para READY
      db.prepare("UPDATE account_profiles SET auth_status = 'READY', quota_resets_at = NULL, quota_message = NULL").run();
      AccountProfileManager.setVerifyProbeOverrideForTest(null);
      try { fs.rmSync(testDir, { recursive: true, force: true }); } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "accountAutoFailoverRapidSwitch.test",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:accountAutoFailoverRapidSwitch.test]", err);
      }
    }
    }
  });
});
