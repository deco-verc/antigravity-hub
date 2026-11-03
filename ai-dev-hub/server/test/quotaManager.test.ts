import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { QuotaManager, CliUsageJsonPayload } from '../src/quotaManager.js';
import { db } from '../src/db.js';
import { ConversationManager } from '../src/conversationManager.js';
import { isFatalQuotaOrAuthError } from '../src/agentTurnState.js';

describe('QuotaManager Offline Suite', () => {
  const testProfileId = 'test-quota-prof-01';

  beforeEach(() => {
    QuotaManager.clearCache();
    const nowIso = new Date().toISOString();
    db.prepare(`
      INSERT OR REPLACE INTO account_profiles (
        id, display_name, profile_name, google_account_label, environment_path, auth_status, last_tested, quota_resets_at, quota_message, created_at, updated_at
      ) VALUES (?, 'Test Quota Account', 'test_quota_acc', 'tester@google.com', 'C:\\nonexistent\\path', 'READY', ?, NULL, NULL, ?, ?)
    `).run(testProfileId, nowIso, nowIso, nowIso);
  });

  test('1. parseQuotaResetError accurately parses durations from 429 messages', () => {
    const r1 = QuotaManager.parseQuotaResetError('RESOURCE_EXHAUSTED: Individual quota reached. Resets in 1h45m12s');
    assert.strictEqual(r1.durationMs, (1 * 3600 + 45 * 60 + 12) * 1000);
    assert.ok(new Date(r1.resetsAt).getTime() > Date.now());

    const r2 = QuotaManager.parseQuotaResetError('Rate limited: Resets in 30m');
    assert.strictEqual(r2.durationMs, 30 * 60 * 1000);

    const r3 = QuotaManager.parseQuotaResetError('code 429: Resets in 45s');
    assert.strictEqual(r3.durationMs, 45 * 1000);

    // Fallback when no duration pattern matches: 1 hour default
    const r4 = QuotaManager.parseQuotaResetError('Generic quota exhausted message without duration');
    assert.strictEqual(r4.durationMs, 60 * 60 * 1000);
  });

  test('2. parseCliUsageJson normalizes structured JSON payload from CLI /usage', () => {
    const fixture: CliUsageJsonPayload = {
      account: { email: 'verified.user@gmail.com' },
      models: [
        {
          id: 'flash',
          remainingRequests: 1450,
          totalRequests: 1500,
          resetTimeSeconds: 3600
        },
        {
          id: 'pro',
          remainingTokens: 500000,
          resetsAt: '2026-10-09T12:00:00Z'
        }
      ],
      credits: {
        balance: 25.5,
        currency: 'USD'
      }
    };

    const result = QuotaManager.parseCliUsageJson('acc-pro-1', 'fallback@gmail.com', JSON.stringify(fixture));
    assert.strictEqual(result.length, 2);

    const flash = result.find(r => r.modelOrBucket === 'flash');
    assert.ok(flash);
    assert.strictEqual(flash?.source, 'CLI');
    assert.strictEqual(flash?.authenticatedIdentity, 'verified.user@gmail.com');
    assert.strictEqual(flash?.availableQuota, 1450);
    assert.strictEqual(flash?.quotaUnit, 'REQUESTS');
    assert.strictEqual(flash?.creditsAvailable, 25.5);
    assert.strictEqual(flash?.validityState, 'VALID');
    assert.strictEqual(flash?.queryError, null);
    assert.ok(flash?.resetsAt);

    const pro = result.find(r => r.modelOrBucket === 'pro');
    assert.ok(pro);
    assert.strictEqual(pro?.availableQuota, 500000);
    assert.strictEqual(pro?.quotaUnit, 'TOKENS');
    assert.strictEqual(pro?.resetsAt, '2026-10-09T12:00:00Z');
  });

  test('3. parseCliUsageJson handles malformed and invalid inputs gracefully without throwing', () => {
    const invalidResult = QuotaManager.parseCliUsageJson('acc-pro-1', 'fallback@gmail.com', 'INVALID_NOT_JSON');
    assert.strictEqual(invalidResult.length, 1);
    assert.strictEqual(invalidResult[0].validityState, 'UNKNOWN');
    assert.ok(invalidResult[0].queryError?.includes('Falha ao interpretar saída JSON'));
    assert.strictEqual(invalidResult[0].availableQuota, null);
  });

  test('4. getQuotaForProfile respects 60s cache TTL and forceRefresh flag', () => {
    const q1 = QuotaManager.getQuotaForProfile(testProfileId);
    assert.strictEqual(q1.length, 3);
    assert.strictEqual(q1[0].accountProfileId, testProfileId);

    // Modify profile in database directly
    db.prepare("UPDATE account_profiles SET google_account_label = 'modified@google.com' WHERE id = ?").run(testProfileId);

    // Cached result should still return previous data
    const qCached = QuotaManager.getQuotaForProfile(testProfileId);
    assert.strictEqual(qCached[0].authenticatedIdentity, null, 'Nome salvo não comprova identidade OAuth');

    // Force refresh bypasses cache
    const qFresh = QuotaManager.getQuotaForProfile(testProfileId, true);
    assert.strictEqual(qFresh[0].authenticatedIdentity, null);
    assert.equal(qFresh[0].availableQuota, null);
    assert.equal(qFresh[0].validityState, 'UNKNOWN');
  });

  test('5. isBlockedByQuota accurately detects quota status and cooldown period', () => {
    // A. Healthy account
    const unblocked = QuotaManager.isBlockedByQuota(testProfileId);
    assert.strictEqual(unblocked.blocked, false);
    assert.strictEqual(unblocked.resetsAt, null);

    // B. Account in future cooldown period
    const futureReset = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    db.prepare(`
      UPDATE account_profiles
      SET auth_status = 'QUOTA_EXHAUSTED', quota_resets_at = ?, quota_message = 'Resets in 30m'
      WHERE id = ?
    `).run(futureReset, testProfileId);

    const blocked = QuotaManager.isBlockedByQuota(testProfileId);
    assert.strictEqual(blocked.blocked, true);
    assert.strictEqual(blocked.resetsAt, futureReset);
    assert.strictEqual(blocked.reason, 'Resets in 30m');

    // C. Non-existent profile
    const nonExistent = QuotaManager.isBlockedByQuota('non-existent-profile-xyz');
    assert.strictEqual(nonExistent.blocked, true);
    assert.strictEqual(nonExistent.reason, 'Perfil inexistente');
  });

  test('6. P0 Security Guard: Zero Antigravity conversations created during quota operations', () => {
    const initialConversations = db.prepare('SELECT COUNT(*) as count FROM conversations').get() as any;

    // Run multiple quota operations
    QuotaManager.getQuotaForProfile(testProfileId, true);
    QuotaManager.isBlockedByQuota(testProfileId);
    QuotaManager.parseCliUsageJson(testProfileId, 'test@test.local', '{}');
    QuotaManager.parseQuotaResetError('RESOURCE_EXHAUSTED: Resets in 10m');

    const finalConversations = db.prepare('SELECT COUNT(*) as count FROM conversations').get() as any;
    assert.strictEqual(
      finalConversations.count,
      initialConversations.count,
      'P0 VIOLATION: Zero conversations must be created by quota operations'
    );
  });

  test('7. Model-specific quota unblocking: Pro cooldown does not block Flash or Flash Lite', () => {
    const futureReset = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    // Simula esgotamento específico do modelo Gemini Pro
    db.prepare(`
      UPDATE account_profiles
      SET auth_status = 'QUOTA_EXHAUSTED',
          quota_resets_at = ?,
          quota_message = 'Resource exhausted for model gemini-2.5-pro: Resets in 1h'
      WHERE id = ?
    `).run(futureReset, testProfileId);

    // Gemini Pro deve estar bloqueado
    const proCheck = QuotaManager.isBlockedByQuota(testProfileId, 'pro');
    assert.strictEqual(proCheck.blocked, true, 'Gemini Pro deve estar bloqueado');
    assert.strictEqual(proCheck.resetsAt, futureReset);

    // Gemini Flash NÃO deve estar bloqueado!
    const flashCheck = QuotaManager.isBlockedByQuota(testProfileId, 'flash');
    assert.strictEqual(flashCheck.blocked, false, 'Gemini Flash deve permanecer DESBLOQUEADO');
    assert.strictEqual(flashCheck.resetsAt, null);

    // Gemini Flash Lite NÃO deve estar bloqueado!
    const flashLiteCheck = QuotaManager.isBlockedByQuota(testProfileId, 'flash_lite');
    assert.strictEqual(flashLiteCheck.blocked, false, 'Gemini Flash Lite deve permanecer DESBLOQUEADO');
    assert.strictEqual(flashLiteCheck.resetsAt, null);

    // Teste com AUTH_ERROR bloqueia todos os modelos
    db.prepare(`
      UPDATE account_profiles
      SET auth_status = 'AUTH_ERROR',
          quota_message = 'Token expirado'
      WHERE id = ?
    `).run(testProfileId);

    const authErrorFlash = QuotaManager.isBlockedByQuota(testProfileId, 'flash');
    assert.strictEqual(authErrorFlash.blocked, true, 'AUTH_ERROR deve bloquear mesmo o Flash');
  });

  test('8. isFatalQuotaOrAuthError: False positive shielding against tool/terminal outputs and positive quota left', () => {
    // 1. Saída de comando/ferramenta com Service.broadcast e Created At NÃO deve ser falso positivo
    const toolDump1 = `Created At: 2026-11-01T19:43:12-03:00\nSseStreamService.broadcast('metachat', 'activity', { message: 'rate limit test' });\nCommand exited with code 0.`;
    assert.strictEqual(isFatalQuotaOrAuthError(toolDump1), false, 'Saída de terminal com Created At e Service.broadcast deve ser ignorada');

    const toolDump2 = `Command output:\nserver/src/limiter.ts:25: // rate limit exceeded handler with code 429\nCommand exited with code 0.`;
    assert.strictEqual(isFatalQuotaOrAuthError(toolDump2), false, 'Saída de grep com 429 e rate limit deve ser ignorada');

    // 2. Telemetria com porcentagem positiva restante (% left / % remaining > 0) NÃO deve ser erro
    const telemetryMsg1 = 'Gemini Pro: 27% left weekly, 32% remaining in 5h window';
    assert.strictEqual(isFatalQuotaOrAuthError(telemetryMsg1), false, '27% left deve ser ignorado como falso positivo');

    const telemetryMsg2 = 'Usage status: 100% remaining for claude-3-7-sonnet';
    assert.strictEqual(isFatalQuotaOrAuthError(telemetryMsg2), false, '100% remaining deve ser ignorado');

    // 3. Erro fatal real DEVE ser detectado
    const realError1 = 'RESOURCE_EXHAUSTED: Individual quota reached. Resets in 2h';
    assert.strictEqual(isFatalQuotaOrAuthError(realError1), true, 'RESOURCE_EXHAUSTED com Resets in deve ser detectado');

    const realError2 = '429 rate limit exceeded';
    assert.strictEqual(isFatalQuotaOrAuthError(realError2), true, '429 rate limit puro deve ser detectado');
  });
});
