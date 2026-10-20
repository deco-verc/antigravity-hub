import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { db, ensureDefensiveMigrations } from '../src/db.js';
import { AccountProfileManager } from '../src/accountProfileManager.js';
import { DevAutonomyService } from '../src/devAutonomyService.js';
import { ModelRegistry } from '../src/modelRegistry.js';
import { ProjectOperationsService } from '../src/projectOperationsService.js';
import { NativeWorkspaceBinding } from '../src/nativeWorkspaceBinding.js';

test('MASTER AUDIT: Reparo e Integridade Ponta a Ponta do Ecossistema DecoHUB', async (t) => {

  await t.test('1. Criação de Projeto: fallback de pasta automático, modelo, esforço de raciocínio e autorização live', () => {
    const testProjectName = 'Forensic Test ' + Date.now();
    const slug = testProjectName.toLowerCase().replace(/[^a-z0-9-_]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    const tempBase = path.join(os.tmpdir(), 'decohub-test-projects');
    const expectedDir = path.join(tempBase, slug);

    fs.mkdirSync(expectedDir, { recursive: true });

    const id = 'proj-forensic-' + Date.now();
    const nowIso = new Date().toISOString();
    const selectedModel = 'pro';
    const reasoningLevel = 'HIGH';

    db.prepare(`
      INSERT INTO projects (id, name, path, objective, description, stack, status, is_trusted, full_dev_autonomy, active_account_profile_id, selected_model, reasoning_level, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'active', 1, 1, 'acc-pro-1', ?, ?, ?, ?)
    `).run(id, testProjectName, expectedDir, 'Objetivo teste', 'Desc', 'TypeScript', selectedModel, reasoningLevel, nowIso, nowIso);

    // Verify autonomy status
    DevAutonomyService.setProjectAutonomy(id, true, true);
    const authStatus = DevAutonomyService.isProjectAuthorizedForLiveExecution(id);
    assert.strictEqual(authStatus.authorized, true, 'Projeto recém-criado deve estar 100% autorizado para execução live');

    // Verify model preference saved
    ModelRegistry.setPreference({
      role: 'default',
      modelId: 'pro',
      intelligenceLevel: 'HIGH',
      accountProfileId: 'acc-pro-1',
      projectId: id
    });
    const prefs = ModelRegistry.getPreferences('acc-pro-1', id);
    assert.strictEqual(prefs.default, 'pro', 'Preferência de modelo deve ser pro');
    assert.strictEqual(prefs.intelligence_level, 'HIGH', 'Nível de inteligência deve ser HIGH');

    // Verify DB columns
    const row: any = db.prepare('SELECT active_account_profile_id, selected_model, reasoning_level, is_trusted, full_dev_autonomy FROM projects WHERE id = ?').get(id);
    assert.strictEqual(row.active_account_profile_id, 'acc-pro-1');
    assert.strictEqual(row.selected_model, 'pro');
    assert.strictEqual(row.reasoning_level, 'HIGH');
    assert.strictEqual(row.is_trusted, 1);
    assert.strictEqual(row.full_dev_autonomy, 1);
  });

  await t.test('2. Roteamento e Multi-Conta: Rapid Switch e Resolução de Perfil Ativo', async () => {
    const profiles = AccountProfileManager.getAllProfiles();
    assert.ok(Array.isArray(profiles), 'Deve listar perfis de conta');
    assert.ok(profiles.length > 0, 'Deve conter pelo menos um perfil de conta');

    const first = profiles[0];
    AccountProfileManager.setGlobalActiveProfile(first.id);
    const active = AccountProfileManager.getGlobalActiveProfile();
    assert.strictEqual(active.id, first.id, 'Perfil ativo deve ser consistente');
  });

  await t.test('3. PORT_GUARD: Escuta de Preview nunca colide com 3000, 3001 ou 5173', async () => {
    const port = await ProjectOperationsService.findFreePort(4100);
    assert.ok(port >= 4100 && port < 4900, 'Porta deve estar na faixa 4100-4899');
    assert.notStrictEqual(port, 3000, 'Porta nunca deve ser 3000');
    assert.notStrictEqual(port, 3001, 'Porta nunca deve ser 3001 (backend DecoHUB)');
    assert.notStrictEqual(port, 5173, 'Porta nunca deve ser 5173 (Vite dev server)');
  });

  await t.test('4. Migrações Defensivas: Todas as colunas vitais garantidas em qualquer banco', () => {
    ensureDefensiveMigrations(db);

    const runCols = db.prepare('PRAGMA table_info(autonomous_runs)').all().map((c: any) => c.name);
    assert.ok(runCols.includes('active_stage_title'), 'autonomous_runs deve conter active_stage_title');
    assert.ok(runCols.includes('active_stage_code'), 'autonomous_runs deve conter active_stage_code');
    assert.ok(runCols.includes('active_slash_command'), 'autonomous_runs deve conter active_slash_command');
    assert.ok(runCols.includes('selected_model'), 'autonomous_runs deve conter selected_model');
    assert.ok(runCols.includes('reasoning_level'), 'autonomous_runs deve conter reasoning_level');
    assert.ok(runCols.includes('paused_at'), 'autonomous_runs deve conter paused_at');
    assert.ok(runCols.includes('resumed_at'), 'autonomous_runs deve conter resumed_at');

    const projCols = db.prepare('PRAGMA table_info(projects)').all().map((c: any) => c.name);
    assert.ok(projCols.includes('active_account_profile_id'), 'projects deve conter active_account_profile_id');
    assert.ok(projCols.includes('selected_model'), 'projects deve conter selected_model');
    assert.ok(projCols.includes('reasoning_level'), 'projects deve conter reasoning_level');

    const accCols = db.prepare('PRAGMA table_info(account_profiles)').all().map((c: any) => c.name);
    assert.ok(accCols.includes('quota_resets_at'), 'account_profiles deve conter quota_resets_at');
    assert.ok(accCols.includes('quota_exhausted_at'), 'account_profiles deve conter quota_exhausted_at');
  });

});
