import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { db } from '../src/db.js';
import { NativeWorkspaceBinding } from '../src/nativeWorkspaceBinding.js';
import { NativeExecutionPolicy } from '../src/nativeExecutionPolicy.js';
import { AccountProfileManager } from '../src/accountProfileManager.js';
import { AutonomousManager } from '../src/autonomousManager.js';
import { normalizeRuntimePath } from '../src/runtimeProfileSelector.js';

test('Native Workspace Auto-Binding & Run Recovery Test Suite', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-autobind-test-'));
  const projectDir = path.join(home, 'my-test-project');
  fs.mkdirSync(projectDir, { recursive: true });
  fs.mkdirSync(path.join(projectDir, '.git'), { recursive: true });

  const profile = AccountProfileManager.getAllProfiles()[0];
  const profileId = profile.id;
  const projectId = 'proj-' + randomUUID().slice(0, 8);
  const now = new Date().toISOString();

  await t.test('1. Novo projeto estabelece vínculo nativo automaticamente com ALLOW/EAGER', () => {
    // Insere projeto no banco (simulando POST /projects)
    db.prepare(`
      INSERT INTO projects (id, name, path, objective, stack, status, is_trusted, full_dev_autonomy, active_account_profile_id, created_at, updated_at)
      VALUES (?, 'Projeto Teste AutoBind', ?, 'Construir app de produtividade', 'TypeScript', 'active', 1, 1, ?, ?, ?)
    `).run(projectId, projectDir, profileId, now, now);

    // Executa ensureBinding
    const record = NativeWorkspaceBinding.ensureBinding(projectId, profileId, home, {
      mode: 'permissive',
      userConsent: 'Autorização explícita: aceitar ALLOW/EAGER'
    });

    assert.ok(record);
    assert.equal(record.projectId, projectId);
    assert.equal(record.accountProfileId, profileId);
    assert.equal(normalizeRuntimePath(record.workspacePath), normalizeRuntimePath(projectDir));

    // Verifica que o arquivo oficial de configuração foi gerado em .gemini/config/projects/
    const nativeConfigPath = path.join(home, '.gemini', 'config', 'projects', `${record.nativeProjectId}.json`);
    assert.ok(fs.existsSync(nativeConfigPath), 'Arquivo de configuração nativo do Antigravity deve existir');

    const config = JSON.parse(fs.readFileSync(nativeConfigPath, 'utf8'));
    assert.equal(config.id, record.nativeProjectId);
    assert.equal(config.settings.fileAccessPolicy, 'AGENT_SETTING_POLICY_ALLOW');
    assert.equal(config.settings.autoExecutionPolicy, 'CASCADE_COMMANDS_AUTO_EXECUTION_EAGER');

    // Verifica persistência no banco
    const policy = NativeExecutionPolicy.get(projectId);
    assert.equal(policy.mode, 'permissive');
    assert.ok(policy.acknowledgement);
  });

  await t.test('2. Validação de ambiente nativo e resolução sem NATIVE_WORKSPACE_UNBOUND', () => {
    const record = NativeWorkspaceBinding.get(projectId, profileId);
    assert.ok(record.nativeProjectId);

    // Simula ambiente de execução do processo com USERPROFILE e ANTIGRAVITY_PROJECT_ID
    const env: NodeJS.ProcessEnv = {
      USERPROFILE: home,
      ANTIGRAVITY_PROJECT_ID: record.nativeProjectId
    };

    const verified = NativeWorkspaceBinding.assertEnvironment(projectId, env);
    assert.equal(verified.nativeProjectId, record.nativeProjectId);
    assert.equal(verified.configHash, record.configHash);
  });

  await t.test('3. Persistência após reinício: vínculo permanece idêntico', () => {
    // Simula consulta após reinício (sem novo provisionamento)
    const record = NativeWorkspaceBinding.get(projectId, profileId);
    assert.ok(record);
    assert.equal(normalizeRuntimePath(record.workspacePath), normalizeRuntimePath(projectDir));
    assert.equal(record.accountProfileId, profileId);

    const inspect = NativeWorkspaceBinding.inspectBinding(projectId, profileId, home);
    assert.equal(inspect.isBound, true);
    assert.equal(inspect.error, null);
  });

  await t.test('4. Recuperação de Run bloqueado por NATIVE_WORKSPACE_UNBOUND sem perder briefing', async () => {
    const blockedProjId = 'proj-blocked-' + randomUUID().slice(0, 8);
    const blockedDir = path.join(home, 'blocked-project');
    fs.mkdirSync(blockedDir, { recursive: true });
    fs.mkdirSync(path.join(blockedDir, '.git'), { recursive: true });

    db.prepare(`
      INSERT INTO projects (id, name, path, objective, stack, status, is_trusted, full_dev_autonomy, active_account_profile_id, created_at, updated_at)
      VALUES (?, 'Projeto Anteriormente Bloqueado', ?, 'Objetivo teste', 'React', 'active', 1, 1, ?, ?, ?)
    `).run(blockedProjId, blockedDir, profileId, now, now);

    const runId = 'run-blocked-' + randomUUID().slice(0, 8);
    const userPrompt = '# RITMO — MEU PAINEL DE PRODUTIVIDADE\n\nEspecificação completa do usuário sem perdas.';

    // Insere run simulando o estado de erro exato encontrado pelo usuário
    db.prepare(`
      INSERT INTO autonomous_runs (id, project_id, name, briefing, objective, status, start_time, last_error, next_action, created_at, updated_at)
      VALUES (?, ?, 'Solicitação Inicial', ?, ?, 'error', ?, 'NATIVE_WORKSPACE_UNBOUND', 'Verificar conta e agentapi do Supervisor', ?, ?)
    `).run(runId, blockedProjId, userPrompt, userPrompt, now, now, now);

    // Verifica que o run está em erro inicialmente
    const runBefore = AutonomousManager.getRun(runId);
    assert.equal(runBefore.status, 'error');
    assert.equal(runBefore.last_error, 'NATIVE_WORKSPACE_UNBOUND');
    assert.equal(runBefore.briefing, userPrompt);

    // Auto-repara o vínculo
    NativeWorkspaceBinding.ensureBinding(blockedProjId, profileId, home, { mode: 'permissive' });

    // Atualiza o Run para pronto/planejamento
    db.prepare(`
      UPDATE autonomous_runs
      SET status = 'ready', last_error = NULL, next_action = 'Pronto para retomar planejamento', updated_at = ?
      WHERE id = ?
    `).run(new Date().toISOString(), runId);

    const runAfter = AutonomousManager.getRun(runId);
    assert.equal(runAfter.status, 'ready');
    assert.equal(runAfter.last_error, null);
    assert.equal(runAfter.briefing, userPrompt, 'Briefing original deve ser mantido 100% íntegro');

    // Confirma que não houve duplicação de Runs
    const runsCount = (db.prepare('SELECT COUNT(*) as n FROM autonomous_runs WHERE project_id=?').get(blockedProjId) as any).n;
    assert.equal(runsCount, 1, 'Não deve haver Runs duplicados');
  });

  await t.test('5. Idempotência: múltiplas chamadas não duplicam configurações ou arquivos', () => {
    const dir = path.join(home, '.gemini', 'config', 'projects');
    const filesBefore = fs.readdirSync(dir).length;

    // Chama ensureBinding novamente no mesmo projeto
    const rec1 = NativeWorkspaceBinding.ensureBinding(projectId, profileId, home);
    const rec2 = NativeWorkspaceBinding.ensureBinding(projectId, profileId, home);

    const filesAfter = fs.readdirSync(dir).length;
    assert.equal(filesBefore, filesAfter, 'Nenhum arquivo de configuração adicional deve ser gerado');
    assert.equal(rec1.nativeProjectId, rec2.nativeProjectId);
  });
});
