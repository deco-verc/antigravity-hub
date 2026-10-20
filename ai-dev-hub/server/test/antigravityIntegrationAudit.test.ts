import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { AccountProfileManager } from '../src/accountProfileManager.js';
import { ModelRegistry, DEFAULT_MODEL_ID, DEFAULT_INTELLIGENCE_LEVEL } from '../src/modelRegistry.js';
import { QuotaManager } from '../src/quotaManager.js';
import { UsageTracker } from '../src/usageTracker.js';
import { db } from '../src/db.js';

describe('Antigravity Integration Audit Suite (20 Scenarios)', () => {
  let tmpProfilesDir: string;

  before(() => {
    tmpProfilesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-antigravity-audit-'));
  });

  after(() => {
    try {
      fs.rmSync(tmpProfilesDir, { recursive: true, force: true });
    } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "antigravityIntegrationAudit.test",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:antigravityIntegrationAudit.test]", err);
      }
    }
  });

  // Scenario 1: Profile creation & local discovery
  test('1. Listagem e cadastro de perfis locais com persistência', () => {
    const uniqueName = `Audit Profile ${Date.now()}`;
    const profile = AccountProfileManager.createProfile({
      displayName: uniqueName,
      googleAccountLabel: 'audit.tester@gmail.com'
    });
    assert.ok(profile.id.startsWith('acc-pro-'));
    assert.strictEqual(profile.display_name, uniqueName);
    assert.strictEqual(profile.auth_status, 'WAITING_LOGIN');

    const retrieved = AccountProfileManager.getProfile(profile.id);
    assert.ok(retrieved);
    assert.strictEqual(retrieved?.id, profile.id);

    AccountProfileManager.deleteProfile(profile.id);
  });

  // Scenario 2: Valid auth evidence produces READY / DETECTED
  test('2. Inspeção de evidência local lê usuário autenticado de app_storage.json', () => {
    const fakeEnv = path.join(tmpProfilesDir, 'env-auth-valid');
    fs.mkdirSync(fakeEnv, { recursive: true });
    const storagePath = path.join(fakeEnv, 'app_storage.json');
    fs.writeFileSync(storagePath, JSON.stringify({
      'jetski.onboarding.lastLoginUsername': 'user.autenticado@gmail.com'
    }), 'utf-8');

    const evidence = AccountProfileManager.inspectLocalAuthEvidence(fakeEnv);
    assert.strictEqual(evidence.exists, true);
    assert.strictEqual(evidence.detectedUser, 'user.autenticado@gmail.com');
    assert.strictEqual(evidence.hasAuthEvidence, true);
  });

  // Scenario 3: Missing login in storage results in LOGIN_REQUIRED
  test('3. Inspeção de evidência sem login rejeita com hasAuthEvidence = false', () => {
    const fakeEnv = path.join(tmpProfilesDir, 'env-auth-empty');
    fs.mkdirSync(fakeEnv, { recursive: true });
    const storagePath = path.join(fakeEnv, 'app_storage.json');
    fs.writeFileSync(storagePath, JSON.stringify({}), 'utf-8');

    const evidence = AccountProfileManager.inspectLocalAuthEvidence(fakeEnv);
    assert.strictEqual(evidence.exists, true);
    assert.strictEqual(evidence.hasAuthEvidence, false);
    assert.strictEqual(evidence.detectedUser, null);
  });

  // Scenario 4: Nonexistent runtime returns RUNTIME_UNAVAILABLE
  test('4. verifyProfile retorna RUNTIME_UNAVAILABLE quando executável não existe', () => {
    const fakeEnv = path.join(tmpProfilesDir, 'env-no-bin');
    fs.mkdirSync(fakeEnv, { recursive: true });
    fs.writeFileSync(path.join(fakeEnv, 'app_storage.json'), JSON.stringify({
      'jetski.onboarding.lastLoginUsername': 'no.bin@gmail.com'
    }));

    const prevBin = process.env.ANTIGRAVITY_BIN_PATH;
    const prevOffline = process.env.DECOHUB_OFFLINE_MODE;
    process.env.ANTIGRAVITY_BIN_PATH = path.join(tmpProfilesDir, 'nonexistent', 'Antigravity.exe');
    process.env.DECOHUB_OFFLINE_MODE = 'false';

    const p = AccountProfileManager.createProfile({ displayName: 'No Bin Account' });
    db.prepare('UPDATE account_profiles SET environment_path = ? WHERE id = ?').run(fakeEnv, p.id);

    try {
      AccountProfileManager.setVerifyProbeOverrideForTest(null);
      const res = AccountProfileManager.verifyProfile(p.id);
      assert.strictEqual(res.profile.auth_status, 'RUNTIME_UNAVAILABLE');
    } finally {
      if (prevBin !== undefined) process.env.ANTIGRAVITY_BIN_PATH = prevBin;
      else delete process.env.ANTIGRAVITY_BIN_PATH;
      if (prevOffline !== undefined) process.env.DECOHUB_OFFLINE_MODE = prevOffline;
      else delete process.env.DECOHUB_OFFLINE_MODE;
      AccountProfileManager.deleteProfile(p.id);
    }
  });

  // Scenario 5: Quota cooldown returns QUOTA_EXHAUSTED
  test('5. verifyProfile retorna QUOTA_EXHAUSTED quando quota_resets_at está no futuro', () => {
    const fakeEnv = path.join(tmpProfilesDir, 'env-quota');
    fs.mkdirSync(fakeEnv, { recursive: true });
    fs.writeFileSync(path.join(fakeEnv, 'app_storage.json'), JSON.stringify({
      'jetski.onboarding.lastLoginUsername': 'quota.user@gmail.com'
    }));

    const p = AccountProfileManager.createProfile({ displayName: 'Quota Account' });
    const futureReset = new Date(Date.now() + 3600000).toISOString();
    db.prepare('UPDATE account_profiles SET environment_path = ?, quota_resets_at = ?, quota_message = ? WHERE id = ?')
      .run(fakeEnv, futureReset, 'Rate limit 429 ativo', p.id);

    try {
      AccountProfileManager.setVerifyProbeOverrideForTest(null);
      const res = AccountProfileManager.verifyProfile(p.id);
      assert.strictEqual(res.profile.auth_status, 'QUOTA_EXHAUSTED');
    } finally {
      AccountProfileManager.deleteProfile(p.id);
    }
  });

  // Scenario 6: Disconnect cleans credentials and sets LOGIN_REQUIRED
  test('6. disconnectProfile remove marcadores, limpa usuário e define LOGIN_REQUIRED', () => {
    const fakeEnv = path.join(tmpProfilesDir, 'env-disconnect');
    fs.mkdirSync(fakeEnv, { recursive: true });
    const storagePath = path.join(fakeEnv, 'app_storage.json');
    fs.writeFileSync(storagePath, JSON.stringify({
      'jetski.onboarding.lastLoginUsername': 'disconnect.me@gmail.com'
    }));

    const p = AccountProfileManager.createProfile({ displayName: 'To Disconnect' });
    db.prepare("UPDATE account_profiles SET environment_path = ?, auth_status = 'READY', google_account_label = ? WHERE id = ?")
      .run(fakeEnv, 'disconnect.me@gmail.com', p.id);

    try {
      const disc = AccountProfileManager.disconnectProfile(p.id);
      assert.strictEqual(disc.success, true);
      assert.strictEqual(disc.profile.auth_status, 'LOGIN_REQUIRED');
      assert.strictEqual(disc.profile.google_account_label, null);

      // Verify file marker was cleaned
      const fileContent = JSON.parse(fs.readFileSync(storagePath, 'utf-8'));
      assert.strictEqual(fileContent['jetski.onboarding.lastLoginUsername'], undefined);
    } finally {
      AccountProfileManager.deleteProfile(p.id);
    }
  });

  // Scenario 7: deleteProfile blocks deleting the last remaining profile
  test('7. deleteProfile bloqueia remoção da última conta do sistema', () => {
    const all = AccountProfileManager.getAllProfiles();
    if (all.length === 1) {
      assert.throws(() => {
        AccountProfileManager.deleteProfile(all[0].id);
      }, /Não é possível remover a única conta/);
    } else {
      assert.ok(all.length >= 2, 'Sistema possui contas cadastradas');
    }
  });

  // Scenario 8: ModelRegistry catalog discovery exposes official tiers
  test('8. ModelRegistry.discoverModels expõe os tiers suportados: flash_lite, flash, pro', () => {
    const models = ModelRegistry.discoverModels();
    assert.ok(Array.isArray(models));
    const ids = models.map(m => m.id);
    assert.ok(ids.includes('flash_lite'));
    assert.ok(ids.includes('flash'));
    assert.ok(ids.includes('pro'));
  });

  // Scenario 9: Default configuration is Gemini 3.8 Flash HIGH
  test('9. ModelRegistry.getDefaultConfig resolve Gemini 3.8 Flash com inteligência HIGH', () => {
    const def = ModelRegistry.getDefaultConfig();
    assert.strictEqual(def.modelId, 'flash');
    assert.strictEqual(def.canonicalName, 'Gemini 3.8 Flash');
    assert.strictEqual(def.intelligenceLevel, 'HIGH');
    assert.strictEqual(def.source, 'GLOBAL_DEFAULT');
  });

  // Scenario 10: ModelRegistry distinguishes requestedModel, selectedModel, confirmedModel
  test('10. ModelRegistry separa requestedModel, selectedModel, confirmedModel e modelConfirmation', () => {
    const config = ModelRegistry.resolveModelConfig({ preference: 'flash' });
    assert.strictEqual(config.modelId, 'flash');
    assert.strictEqual(config.selectedModel, 'flash');
    assert.ok(typeof config.requestedModel === 'string');
    assert.ok(['CONFIRMED', 'UNCONFIRMED', 'ESTIMATED'].includes(config.modelConfirmation));
  });

  // Scenario 11: Rejects invalid model with MODEL_UNAVAILABLE
  test('11. ModelRegistry rejeita modelo inexistente com erro MODEL_UNAVAILABLE', () => {
    assert.throws(() => {
      ModelRegistry.resolveModelConfig({ preference: 'modelo-fantasma-999' as any });
    }, /MODEL_UNAVAILABLE/);
  });

  // Scenario 12: Role-based overrides for supervisor and builder
  test('12. ModelRegistry aplica preferências distintas por papel (supervisor, builder)', () => {
    const supConfig = ModelRegistry.resolveModelConfig({ role: 'supervisor', preference: 'pro' });
    assert.strictEqual(supConfig.modelId, 'pro');
    assert.strictEqual(supConfig.selectedModel, 'pro');

    const builderConfig = ModelRegistry.resolveModelConfig({ role: 'builder', preference: 'flash' });
    assert.strictEqual(builderConfig.modelId, 'flash');
  });

  // Scenario 13: 429 reset error parsing
  test('13. QuotaManager.parseQuotaResetError extrai tempo de expiração de strings 429', () => {
    const parsed = QuotaManager.parseQuotaResetError('Resource exhausted: Resets in 1h30m15s');
    const expectedMs = (1 * 3600 + 30 * 60 + 15) * 1000;
    assert.strictEqual(parsed.durationMs, expectedMs);
    assert.ok(new Date(parsed.resetsAt).getTime() > Date.now());
  });

  // Scenario 14: Quota blocking when reset is in future
  test('14. QuotaManager.isBlockedByQuota bloqueia quando resetsAt está no futuro', () => {
    const p = AccountProfileManager.createProfile({ displayName: 'Blocked Profile' });
    const future = new Date(Date.now() + 60000).toISOString();
    db.prepare('UPDATE account_profiles SET quota_resets_at = ?, quota_message = ? WHERE id = ?')
      .run(future, 'Limite atingido', p.id);

    try {
      const check = QuotaManager.isBlockedByQuota(p.id, 'flash');
      assert.strictEqual(check.blocked, true);
      assert.strictEqual(check.resetsAt, future);
    } finally {
      AccountProfileManager.deleteProfile(p.id);
    }
  });

  // Scenario 15: AI Credits marked as NOT_EXPOSED with disclaimer
  test('15. QuotaManager expõe créditos como NOT_EXPOSED com disclaimer explicativo', () => {
    const all = AccountProfileManager.getAllProfiles();
    const target = all[0];
    const quota = QuotaManager.getQuotaForProfile(target.id, true);
    assert.ok(Array.isArray(quota));
    for (const q of quota) {
      assert.strictEqual(q.creditsStatus, 'NOT_EXPOSED');
      assert.ok(q.creditsDisclaimer && q.creditsDisclaimer.length > 10);
    }
  });

  // Scenario 16: UsageTracker records event with full provenance
  test('16. UsageTracker.recordEvent persiste evento com proveniência completa', () => {
    const all = AccountProfileManager.getAllProfiles();
    const profileId = all[0].id;
    const eventId = UsageTracker.recordEvent({
      accountProfileId: profileId,
      modelId: 'flash',
      role: 'builder',
      projectId: 'proj-audit-1',
      taskId: 'task-audit-1',
      durationMs: 450,
      status: 'success'
    });

    assert.ok(eventId && eventId.length > 10);
    const row: any = db.prepare('SELECT * FROM usage_events WHERE id = ?').get(eventId);
    assert.strictEqual(row.account_profile_id, profileId);
    assert.strictEqual(row.model_id, 'flash');
    assert.strictEqual(row.role, 'builder');
    assert.strictEqual(row.duration_ms, 450);
  });

  // Scenario 17: UsageTracker does not flip LOGIN_REQUIRED to READY on success
  test('17. UsageTracker não altera LOGIN_REQUIRED para READY indevidamente', () => {
    const p = AccountProfileManager.createProfile({ displayName: 'Unauthenticated User' });
    db.prepare("UPDATE account_profiles SET auth_status = 'LOGIN_REQUIRED' WHERE id = ?").run(p.id);

    try {
      UsageTracker.recordEvent({
        accountProfileId: p.id,
        modelId: 'flash',
        status: 'success'
      });

      const updated = AccountProfileManager.getProfile(p.id);
      assert.strictEqual(updated?.auth_status, 'LOGIN_REQUIRED');
    } finally {
      AccountProfileManager.deleteProfile(p.id);
    }
  });

  // Scenario 18: UsageTracker today executions calculation
  test('18. UsageTracker.getTodayExecutionCount retorna contagem numérica válida', () => {
    const count = UsageTracker.getTodayExecutionCount();
    assert.ok(typeof count === 'number');
    assert.ok(count >= 1);
  });

  // Scenario 19: UsageTracker summary returns structured statistics
  test('19. UsageTracker.getSummary retorna estatísticas consolidadas e disclaimer de cotas', () => {
    const summary = UsageTracker.getSummary();
    assert.ok(typeof summary.todayExecutions === 'number');
    assert.ok(typeof summary.allTimeExecutions === 'number');
    assert.ok(typeof summary.byModelToday === 'object');
    assert.ok(summary.quotaDisclaimer && summary.quotaDisclaimer.length > 10);
  });

  // Scenario 20: No credential leaks in usage events or telemetry
  test('20. Nenhum token, chave ou credencial privada é vazada na telemetria', () => {
    const events = UsageTracker.getRecentEvents(10);
    for (const ev of events) {
      const raw = JSON.stringify(ev);
      assert.ok(!raw.includes('ghp_'), 'Nenhum GitHub PAT em eventos de uso');
      assert.ok(!raw.includes('AIzaSy'), 'Nenhuma chave Gemini em eventos de uso');
      assert.ok(!raw.includes('password'), 'Nenhuma senha em eventos de uso');
    }
  });
});
