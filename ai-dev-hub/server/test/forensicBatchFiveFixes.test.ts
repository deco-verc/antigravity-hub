import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import { QuotaManager } from '../src/quotaManager.js';
import { AgentApiGateway } from '../src/agentApiGateway.js';
import { TurnCancellationManager } from '../src/turnCancellationManager.js';
import { SseStreamService } from '../src/sseStreamService.js';
import { NativeExecutionPolicy } from '../src/nativeExecutionPolicy.js';

test('1. Cooldown expired returns account profile and workers to READY (no AUTH_UNKNOWN trap)', () => {
  const profileId = 'test-cooldown-heal-prof';
  const nowIso = new Date().toISOString();
  const pastResetIso = new Date(Date.now() - 60000).toISOString();

  db.prepare(`
    INSERT OR REPLACE INTO account_profiles (
      id, display_name, profile_name, google_account_label, environment_path, auth_status, quota_resets_at, quota_message, created_at, updated_at
    ) VALUES (?, 'Cooldown Test', 'cooldown_test', 'test@google.com', '', 'QUOTA_EXHAUSTED', ?, 'Rate limited', ?, ?)
  `).run(profileId, pastResetIso, nowIso, nowIso);

  db.prepare(`
    INSERT OR REPLACE INTO workers (
      id, name, provider, status, account_profile_id, current_task_id, created_at, updated_at
    ) VALUES ('worker-test-cd', 'Worker CD', 'antigravity', 'COOLDOWN', ?, 'task-123', ?, ?)
  `).run(profileId, nowIso, nowIso);

  // Invoca _getProfileRow via QuotaManager
  const row = (QuotaManager as any)._getProfileRow(profileId);
  assert.ok(row);
  assert.strictEqual(row.auth_status, 'READY', 'Status deve voltar para READY e não AUTH_UNKNOWN');
  assert.strictEqual(row.quota_resets_at, null);
  assert.strictEqual(row.quota_message, null);

  const workerRow = db.prepare('SELECT status, current_task_id FROM workers WHERE id = ?').get('worker-test-cd') as any;
  assert.strictEqual(workerRow.status, 'READY', 'Worker deve ser restabelecido para READY');
  assert.strictEqual(workerRow.current_task_id, null, 'current_task_id deve ser liberado');
});

test('2. Claude and GPT slugs are preserved directly and NOT forced to Gemini flash/pro', () => {
  // Claude models must preserve their exact slug
  assert.strictEqual(AgentApiGateway.normalizeCliModelFlag('claude-sonnet-4.6'), 'claude-sonnet-4.6');
  assert.strictEqual(AgentApiGateway.normalizeCliModelFlag('claude-opus-4.6'), 'claude-opus-4.6');
  assert.strictEqual(AgentApiGateway.normalizeCliModelFlag('Claude-Sonnet-5.5 (thinking)'), 'claude-sonnet-5.5 (thinking)');

  // GPT / Open weights models must preserve their exact slug
  assert.strictEqual(AgentApiGateway.normalizeCliModelFlag('gpt-oss-120b'), 'gpt-oss-120b');
  assert.strictEqual(AgentApiGateway.normalizeCliModelFlag('openai/gpt-4o'), 'openai/gpt-4o');

  // Native Gemini models map correctly
  assert.strictEqual(AgentApiGateway.normalizeCliModelFlag('pro'), 'pro');
  assert.strictEqual(AgentApiGateway.normalizeCliModelFlag('flash_lite'), 'flash_lite');
  assert.strictEqual(AgentApiGateway.normalizeCliModelFlag('flash'), 'flash');
  assert.strictEqual(AgentApiGateway.normalizeCliModelFlag(null), 'flash');
});

test('3. TurnCancellationManager detects metachat cancellation signal', () => {
  TurnCancellationManager.clearAll();

  // Solicita cancelamento com a chave 'metachat'
  TurnCancellationManager.requestCancellation('metachat');

  // A checagem do Meta-Chat com ('metachat', threadId, convId) deve retornar true imediatamente
  const isCancelled = TurnCancellationManager.isCancelled('metachat', 'thread-123', 'conv-abc');
  assert.strictEqual(isCancelled, true, "Sinal 'metachat' deve ser detectado");

  TurnCancellationManager.clearCancellation('metachat');
  assert.strictEqual(TurnCancellationManager.isCancelled('metachat', 'thread-123', 'conv-abc'), false);
});

test('4. SseStreamService.broadcast handles client disconnects and backpressure gracefully', () => {
  const channel = 'test-bp-channel';
  let writeCalled = false;

  const mockRes: any = {
    writableEnded: false,
    destroyed: false,
    setHeader: () => {},
    flushHeaders: () => {},
    socket: {
      destroyed: false,
      writable: true,
      bufferSize: 1024,
      setTimeout: () => {},
      setNoDelay: () => {},
      setKeepAlive: () => {},
      once: (evt: string, cb: any) => {}
    },
    on: () => {},
    write: (data: string) => {
      writeCalled = true;
      return true;
    }
  };

  SseStreamService.addClient(channel, mockRes);
  assert.strictEqual(SseStreamService.hasClients(channel), true);

  SseStreamService.broadcast(channel, 'activity', { test: true });
  assert.strictEqual(writeCalled, true);

  // Simula cliente desconectado
  mockRes.destroyed = true;
  SseStreamService.broadcast(channel, 'activity', { test: 2 });
  assert.strictEqual(SseStreamService.hasClients(channel), false, 'Cliente desconectado deve ser removido');
});

test('5. NativeExecutionPolicy.releaseStaleAmbiguousLocks clears stale reservations without json_valid crash', () => {
  // Insere reserva malformada e reserva válida
  db.prepare(`
    INSERT OR REPLACE INTO execution_reservations (scope, token, owner_pid, context_json, created_at, updated_at)
    VALUES ('res-malformed-scope', 'tok1', 1234, 'INVALID_JSON_NOT_AN_OBJECT', datetime('now', '-10 minutes'), datetime('now', '-10 minutes'))
  `).run();

  db.prepare(`
    INSERT OR REPLACE INTO execution_reservations (scope, token, owner_pid, context_json, created_at, updated_at)
    VALUES ('res-valid-scope', 'tok2', 1234, '{"valid":true}', datetime('now'), datetime('now'))
  `).run();

  // Executa liberação de travas (não deve lançar exceção)
  assert.doesNotThrow(() => {
    NativeExecutionPolicy.releaseStaleAmbiguousLocks();
  });

  const staleRow = db.prepare('SELECT 1 FROM execution_reservations WHERE scope = ?').get('res-malformed-scope');
  assert.strictEqual(staleRow, undefined, 'Reserva antiga/malformada deve ser removida');

  const validRow = db.prepare('SELECT 1 FROM execution_reservations WHERE scope = ?').get('res-valid-scope');
  assert.ok(validRow, 'Reserva recente e válida deve ser mantida');

  // Limpeza
  db.prepare("DELETE FROM execution_reservations WHERE scope IN ('res-malformed-scope', 'res-valid-scope')").run();
});
