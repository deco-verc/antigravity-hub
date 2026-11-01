import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db } from '../src/db.js';
import { AccountProfileManager } from '../src/accountProfileManager.js';
import { UsageTracker } from '../src/usageTracker.js';

describe('Telemetria Multi-Conta e Auto-Failover Suite (FASE 21)', () => {
  test('1. AccountProfileManager.getAccountTelemetry() retorna estrutura canônica completa', async () => {
    // Garantir ao menos 2 perfis no banco
    const profiles = AccountProfileManager.getAllProfiles();
    let acc1 = profiles[0];
    let acc2 = profiles[1];
    if (!acc1) {
      acc1 = AccountProfileManager.createProfile({
        displayName: 'Google Pro 1 Telemetry',
        googleAccountLabel: 'acc-pro-1@test.local'
      });
    }
    if (!acc2) {
      acc2 = AccountProfileManager.createProfile({
        displayName: 'Google Pro 2 Telemetry',
        googleAccountLabel: 'acc-pro-2@test.local'
      });
    }

    const telemetry = AccountProfileManager.getAccountTelemetry();

    // 1.1 Validações de alto nível
    assert.ok(telemetry, 'Telemetry deve retornar objeto não-nulo');
    assert.strictEqual(typeof telemetry.totalAccounts, 'number');
    assert.ok(telemetry.totalAccounts >= 2, 'Deve conter pelo menos 2 contas');
    assert.ok(Array.isArray(telemetry.accounts), 'accounts deve ser um array');
    assert.strictEqual(typeof telemetry.autoFailoverEnabled, 'boolean');
    assert.ok(telemetry.timestamp, 'timestamp deve estar presente');

    // 1.2 Validações por conta
    for (const item of telemetry.accounts) {
      assert.ok(item.id, 'id deve existir');
      assert.ok(item.displayName, 'displayName deve existir');
      assert.ok(
        ['READY', 'WAITING_LOGIN', 'QUOTA_EXHAUSTED', 'OFFLINE'].includes(item.authStatus),
        `Status ${item.authStatus} deve ser um dos canônicos`
      );
      assert.strictEqual(typeof item.isDefault, 'boolean');
      assert.strictEqual(typeof item.todayExecutions, 'number');

      // Validar objeto process
      assert.ok(item.process, 'process deve existir');
      assert.strictEqual(typeof item.process.isAlive, 'boolean');
      assert.ok(
        item.process.uptimeSeconds === null || typeof item.process.uptimeSeconds === 'number',
        'uptimeSeconds deve ser number ou null'
      );
      assert.strictEqual(typeof item.process.uptimeFormatted, 'string');
      if (item.process.pid !== null) {
        assert.strictEqual(typeof item.process.pid, 'number');
      }
      if (item.process.grpcPort !== null) {
        assert.strictEqual(typeof item.process.grpcPort, 'number');
      }
    }
  });

  test('2. Chaveamento e Persistência do Switch de Auto-Failover', async () => {
    // 2.1 Salvar estado original para restaurar no final
    const originalState = AccountProfileManager.isAutoFailoverEnabled();

    try {
      // 2.2 Desativar auto-failover
      const setFalseRes = AccountProfileManager.setAutoFailoverEnabled(false);
      assert.strictEqual(setFalseRes, false);
      assert.strictEqual(AccountProfileManager.isAutoFailoverEnabled(), false);

      // Verificar persistência no banco
      const rowFalse: any = db.prepare("SELECT value FROM system_settings WHERE key = 'auto_failover_enabled'").get();
      assert.strictEqual(rowFalse?.value, 'false');

      // 2.3 Ativar auto-failover
      const setTrueRes = AccountProfileManager.setAutoFailoverEnabled(true);
      assert.strictEqual(setTrueRes, true);
      assert.strictEqual(AccountProfileManager.isAutoFailoverEnabled(), true);

      // Verificar persistência no banco
      const rowTrue: any = db.prepare("SELECT value FROM system_settings WHERE key = 'auto_failover_enabled'").get();
      assert.strictEqual(rowTrue?.value, 'true');

      // 2.4 Validar que getAccountTelemetry() reflete a flag
      AccountProfileManager.setAutoFailoverEnabled(false);
      const teleFalse = AccountProfileManager.getAccountTelemetry();
      assert.strictEqual(teleFalse.autoFailoverEnabled, false);

      AccountProfileManager.setAutoFailoverEnabled(true);
      const teleTrue = AccountProfileManager.getAccountTelemetry();
      assert.strictEqual(teleTrue.autoFailoverEnabled, true);
    } finally {
      // Restaurar estado original
      AccountProfileManager.setAutoFailoverEnabled(originalState);
    }
  });

  test('3. Bloqueio de Auto-Failover quando a opção estiver desativada', async () => {
    const originalState = AccountProfileManager.isAutoFailoverEnabled();
    const all = AccountProfileManager.getAllProfiles();
    const acc1 = all[0];
    const acc2 = all[1] || AccountProfileManager.createProfile({
      displayName: 'Google Pro 2',
      googleAccountLabel: 'pro2@test.local'
    });

    try {
      // Desativar auto-failover
      AccountProfileManager.setAutoFailoverEnabled(false);

      const fakeProjectId = randomUUID();
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO projects (id, name, path, active_account_profile_id, is_trusted, full_dev_autonomy, created_at, updated_at)
        VALUES (?, 'Test Auto Failover Disabled', 'C:\\tmp\\test', ?, 1, 1, ?, ?)
      `).run(fakeProjectId, acc1.id, now, now);

      const result = await AccountProfileManager.handleAccountFailureAndRapidSwitch({
        failedProfileId: acc1.id,
        projectId: fakeProjectId,
        error: 'RESOURCE_EXHAUSTED: 429 quota reached'
      });

      // Não deve chavear a conta pois auto-failover está desativado
      assert.strictEqual(result.switched, false);
      assert.strictEqual(result.kind, 'QUOTA');
      assert.ok(result.message.includes('Auto-Failover desativado'));

      // Projeto deve manter a conta original intacta
      const proj: any = db.prepare('SELECT active_account_profile_id FROM projects WHERE id = ?').get(fakeProjectId);
      assert.strictEqual(proj.active_account_profile_id, acc1.id);
    } finally {
      AccountProfileManager.setAutoFailoverEnabled(originalState);
    }
  });

  test('4. Troca Manual (Rapid Switch) atualiza a sessão do projeto imediatamente', async () => {
    AccountProfileManager.setVerifyProbeOverrideForTest(() => true);
    const all = AccountProfileManager.getAllProfiles();
    let acc1 = all[0];
    let acc2 = all[1];
    if (!acc2) {
      acc2 = AccountProfileManager.createProfile({
        displayName: 'Google Pro 2 Rapid',
        googleAccountLabel: 'rapid.pro2@test.local'
      });
    }

    db.prepare("UPDATE account_profiles SET quota_resets_at = NULL, quota_message = NULL, auth_status = 'READY' WHERE id IN (?, ?)").run(acc1.id, acc2.id);

    const fakeProjectId = randomUUID();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO projects (id, name, path, active_account_profile_id, is_trusted, full_dev_autonomy, created_at, updated_at)
      VALUES (?, 'Test Manual Rapid Switch', 'C:\\tmp\\test-rapid', ?, 1, 1, ?, ?)
    `).run(fakeProjectId, acc1.id, now, now);

    // Executar troca manual direta apontando especificamente para acc2
    const switchRes = await AccountProfileManager.rapidSwitchAccount({
      projectId: fakeProjectId,
      targetProfileId: acc2.id
    });

    assert.ok(switchRes.activeProfile);
    assert.strictEqual(switchRes.activeProfile.id, acc2.id);

    // Conferir no banco se o projeto foi atualizado
    const updatedProject: any = db.prepare('SELECT active_account_profile_id FROM projects WHERE id = ?').get(fakeProjectId);
    assert.strictEqual(updatedProject.active_account_profile_id, acc2.id);

    // E conferir no telemetry que o activeAccountId reflete o switch
    const telemetry = AccountProfileManager.getAccountTelemetry();
    assert.ok(telemetry.accounts.some(a => a.id === acc2.id));
  });

  test('5. Contagem de chamadas diárias do UsageTracker reflete no Telemetry', async () => {
    const all = AccountProfileManager.getAllProfiles();
    const targetAccount = all[0];

    const currentCount = UsageTracker.getTodayExecutionCount(targetAccount.id);

    // Registrar evento de uso hoje para targetAccount
    UsageTracker.recordEvent({
      projectId: 'proj-telemetry-test',
      accountProfileId: targetAccount.id,
      modelId: 'gemini-3.8-flash',
      durationMs: 320,
      status: 'success'
    });

    const newCount = UsageTracker.getTodayExecutionCount(targetAccount.id);
    assert.strictEqual(newCount, currentCount + 1, 'Contagem de hoje deve incrementar em 1');

    // Verificar se getAccountTelemetry() exibe este novo valor
    const telemetry = AccountProfileManager.getAccountTelemetry();
    const item = telemetry.accounts.find(a => a.id === targetAccount.id);
    assert.ok(item, 'Conta deve estar na lista de telemetria');
    assert.strictEqual(item.todayExecutions, newCount);
  });

  test('6. Classificador de cota e ação Verificar Cota previnem falso positivo de telemetria', async () => {
    // 6.1 Telemetria informativa normal NÃO deve ser classificada como erro de cota
    const normalTelemetry1 = '5h limit: 53% left • Resets in 2h 22m';
    const c1 = AccountProfileManager.classifyAccountOrQuotaError(normalTelemetry1);
    assert.strictEqual(c1.kind, 'NONE', '53% left não deve ser classificado como QUOTA');
    assert.strictEqual(c1.isAccountOrQuotaError, false);

    const normalTelemetry2 = 'Weekly limit: 71% left • Resets in 4d 14h';
    const c2 = AccountProfileManager.classifyAccountOrQuotaError(normalTelemetry2);
    assert.strictEqual(c2.kind, 'NONE', '71% left não deve ser classificado como QUOTA');
    assert.strictEqual(c2.isAccountOrQuotaError, false);

    // 6.2 Esgotamento real (0% left ou 429 RESOURCE_EXHAUSTED) DEVE ser classificado como QUOTA
    const exhaustedZero = '5h limit: 0% left • Resets in 1h 45m';
    const c3 = AccountProfileManager.classifyAccountOrQuotaError(exhaustedZero);
    assert.strictEqual(c3.kind, 'QUOTA', '0% left deve ser classificado como QUOTA');
    assert.strictEqual(c3.isAccountOrQuotaError, true);

    const exhausted429 = 'RESOURCE_EXHAUSTED: 429 quota reached';
    const c4 = AccountProfileManager.classifyAccountOrQuotaError(exhausted429);
    assert.strictEqual(c4.kind, 'QUOTA', '429 RESOURCE_EXHAUSTED deve ser classificado como QUOTA');
    assert.strictEqual(c4.isAccountOrQuotaError, true);

    // 6.3 markQuotaExhausted ignora mensagens informativas com % left > 0
    const profile = AccountProfileManager.getAllProfiles()[0];
    AccountProfileManager.markQuotaExhausted(profile.id, normalTelemetry1);
    const afterIgnore = AccountProfileManager.getProfile(profile.id)!;
    assert.notStrictEqual(afterIgnore.auth_status, 'QUOTA_EXHAUSTED', 'markQuotaExhausted não deve travar com 53% left');

    // 6.4 verifyProfile reseta quota_resets_at e quota_message se houver probe válido
    // Simular conta previamente travada por cooldown antigo
    db.prepare(`
      UPDATE account_profiles
      SET auth_status = 'QUOTA_EXHAUSTED', quota_resets_at = '2099-01-01T00:00:00.000Z', quota_message = 'Cooldown antigo'
      WHERE id = ?
    `).run(profile.id);

    AccountProfileManager.setVerifyProbeOverrideForTest(() => true);
    try {
      const verifyRes = AccountProfileManager.verifyProfile(profile.id);
      assert.strictEqual(verifyRes.status, 'READY');
      assert.strictEqual(verifyRes.profile.auth_status, 'READY');
      assert.strictEqual(verifyRes.profile.quota_resets_at, null, 'quota_resets_at deve ser resetado para NULL');
      assert.strictEqual(verifyRes.profile.quota_message, null, 'quota_message deve ser resetado para NULL');
    } finally {
      AccountProfileManager.setVerifyProbeOverrideForTest(null);
    }
  });
});
