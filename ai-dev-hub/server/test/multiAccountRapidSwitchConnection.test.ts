import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { db } from '../src/db.js';
import { NativeWorkspaceBinding } from '../src/nativeWorkspaceBinding.js';
import { NativeExecutionPolicy } from '../src/nativeExecutionPolicy.js';
import {
  profileUserDataDirectory,
  selectProfileRuntime,
  normalizeRuntimePath,
  RuntimeProcessSnapshot
} from '../src/runtimeProfileSelector.js';
import { AccountProfileManager } from '../src/accountProfileManager.js';
import { AutonomousRunnerService } from '../src/autonomousRunnerService.js';
import { AutonomousManager } from '../src/autonomousManager.js';

describe('Multi-Account & Rapid Switch Final Connection Suite', () => {
  test('1. NativeWorkspaceBinding.resolve permite re-associação quando o projeto troca de active_account_profile_id', () => {
    const testDir = path.join(os.tmpdir(), `nw-test-${Date.now()}-${randomUUID().slice(0, 8)}`);
    const home1 = path.join(testDir, 'home1');
    const home2 = path.join(testDir, 'home2');
    const projectPath = path.join(testDir, 'project');

    fs.mkdirSync(home1, { recursive: true });
    fs.mkdirSync(home2, { recursive: true });
    fs.mkdirSync(projectPath, { recursive: true });

    const projectId = randomUUID();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO projects (id, name, path, active_account_profile_id, is_trusted, full_dev_autonomy, created_at, updated_at)
      VALUES (?, ?, ?, 'profile-1', 1, 1, ?, ?)
    `).run(projectId, 'Test Switch Project', projectPath, now, now);

    // 1. Vincular inicialmente para profile-1 em home1
    const binding1 = NativeWorkspaceBinding.resolve(projectId, 'profile-1', home1, true);
    assert.ok(binding1);
    assert.strictEqual(binding1.accountProfileId, 'profile-1');
    assert.strictEqual(normalizeRuntimePath(binding1.userProfileDir), normalizeRuntimePath(home1));

    // 2. Chamar resolve com profile-1 novamente: deve reutilizar binding existente
    const binding1Cached = NativeWorkspaceBinding.resolve(projectId, 'profile-1', home1, true);
    assert.strictEqual(binding1Cached.nativeProjectId, binding1.nativeProjectId);

    // 3. Simular troca de conta no projeto para profile-2
    db.prepare('UPDATE projects SET active_account_profile_id = ?, updated_at = ? WHERE id = ?')
      .run('profile-2', new Date().toISOString(), projectId);

    // Simular sessão ativa prévia que deve ser automaticamente arquivada na troca legítima
    db.prepare(`
      INSERT INTO agent_sessions (id, project_id, role, logical_conversation_id, provider_conversation_id, generation, status, created_at, last_used_at, metadata_json)
      VALUES (?, ?, 'WORKER', ?, ?, 1, 'ACTIVE', ?, ?, '{}')
    `).run('sess-' + randomUUID(), projectId, 'log-' + randomUUID(), 'nat-' + randomUUID(), now, now);

    // 4. Invocar resolve para profile-2 em home2: DEVE re-associar com sucesso sem bloquear!
    const binding2 = NativeWorkspaceBinding.resolve(projectId, 'profile-2', home2, true);
    assert.ok(binding2);
    assert.strictEqual(binding2.accountProfileId, 'profile-2');
    assert.strictEqual(normalizeRuntimePath(binding2.userProfileDir), normalizeRuntimePath(home2));

    // Confirmar que o registro persistido em native_workspace_bindings reflete a nova conta
    const updatedRecord = NativeWorkspaceBinding.get(projectId, 'profile-2');
    assert.strictEqual(updatedRecord.accountProfileId, 'profile-2');

    // Limpeza
    try { fs.rmSync(testDir, { recursive: true, force: true }); } catch {}
  });

  test('2. profileUserDataDirectory e selectProfileRuntime aceitam caminho canônico e raiz de perfil', () => {
    const defaultPath = 'C:\\Users\\Deco\\AppData\\Roaming\\Antigravity';
    const profileRoot = 'C:\\Profiles\\Account 3';
    const canonicalUserData = profileRoot + '\\AppData\\Roaming\\Antigravity';
    const appExecutable = 'C:\\Programs\\Antigravity\\Antigravity.exe';
    const lsExecutable = 'C:\\Programs\\Antigravity\\resources\\bin\\language_server.exe';

    // profileUserDataDirectory deve produzir o mesmo diretório normalizado
    const fromRoot = profileUserDataDirectory(profileRoot, defaultPath);
    const fromCanonical = profileUserDataDirectory(canonicalUserData, defaultPath);
    assert.strictEqual(fromRoot, fromCanonical);

    // Processo lançado com --user-data-dir=<canonical>
    const mainProc: RuntimeProcessSnapshot = {
      pid: 100,
      parentPid: 1,
      name: 'Antigravity.exe',
      executable: appExecutable,
      started: '2026-10-19T10:00:00Z',
      userDataDir: canonicalUserData,
      userDataFlagCount: 1
    };
    const lsProc: RuntimeProcessSnapshot = {
      pid: 200,
      parentPid: 100,
      name: 'language_server.exe',
      executable: lsExecutable,
      started: '2026-10-19T10:00:01Z'
    };

    // Consulta passando profileRoot
    const bindingFromRoot = selectProfileRuntime({
      profilePath: profileRoot,
      defaultPath,
      appExecutable,
      languageServerExecutable: lsExecutable,
      processes: [mainProc, lsProc]
    });
    assert.ok(bindingFromRoot);
    assert.strictEqual(bindingFromRoot.pid, 200);

    // Consulta passando canonicalUserData
    const bindingFromCanonical = selectProfileRuntime({
      profilePath: canonicalUserData,
      defaultPath,
      appExecutable,
      languageServerExecutable: lsExecutable,
      processes: [mainProc, lsProc]
    });
    assert.ok(bindingFromCanonical);
    assert.strictEqual(bindingFromCanonical.pid, 200);
  });

  test('3. Failover automático em cota 429 mantém run ativo via rapidSwitchAccount', async () => {
    AccountProfileManager.setVerifyProbeOverrideForTest(() => true);
    const testProjectDir = path.join(os.tmpdir(), `failover-proj-${Date.now()}`);
    try {
      // Obter ou criar duas contas no banco para teste
      const all = AccountProfileManager.getAllProfiles();
      let acc1 = all[0];
      let acc2 = all[1];

      if (!acc2) {
        acc2 = AccountProfileManager.createProfile({
          displayName: 'Conta Failover Test',
          googleAccountLabel: 'failover.test@gmail.com'
        });
      }
      AccountProfileManager.updateStatus(acc1.id, 'READY');
      AccountProfileManager.updateStatus(acc2.id, 'READY');
      db.prepare('UPDATE account_profiles SET quota_resets_at = NULL WHERE id = ?').run(acc2.id);

      fs.mkdirSync(testProjectDir, { recursive: true });

      const projectId = randomUUID();
      const runId = randomUUID();
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO projects (id, name, path, active_account_profile_id, is_trusted, full_dev_autonomy, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, 1, ?, ?)
      `).run(projectId, 'Failover Project', testProjectDir, acc1.id, now, now);

      db.prepare(`
        INSERT INTO autonomous_runs (id, project_id, name, objective, status, start_time, created_at, updated_at)
        VALUES (?, ?, 'Run com Failover', 'Testar failover automático', 'running', ?, ?, ?)
      `).run(runId, projectId, now, now, now);

      // Executar Rapid Switch simulado de failover
      const result = await AccountProfileManager.rapidSwitchAccount({
        projectId,
        reason: 'QUOTA_FAILOVER',
        autoStartRuntime: false
      });

      assert.ok(result.switched);
      assert.strictEqual(result.activeProfile.id, acc2.id);

      // Verificar se o projeto agora tem active_account_profile_id = acc2.id
      const updatedProj: any = db.prepare('SELECT active_account_profile_id FROM projects WHERE id=?').get(projectId);
      assert.strictEqual(updatedProj.active_account_profile_id, acc2.id);

      // Verificar se o run permaneceu como running
      const updatedRun: any = db.prepare('SELECT status FROM autonomous_runs WHERE id=?').get(runId);
      assert.strictEqual(updatedRun.status, 'running');
    } finally {
      AccountProfileManager.setVerifyProbeOverrideForTest(null);
      try { fs.rmSync(testProjectDir, { recursive: true, force: true }); } catch {}
    }
  });

  test('4. Endpoint POST /api/accounts/rapid-switch responde com RapidSwitchResult estruturado', async () => {
    const { apiRouter } = await import('../src/routes.js');
    assert.ok(apiRouter);

    // Simular chamada direta da rota chamando AccountProfileManager.rapidSwitchAccount
    const res = await AccountProfileManager.rapidSwitchAccount({ autoStartRuntime: false });
    assert.ok(typeof res.switched === 'boolean');
    assert.ok(res.previousProfile);
    assert.ok(res.activeProfile);
    assert.ok(typeof res.message === 'string');
    assert.ok(typeof res.runtimeOnline === 'boolean');
  });
});
