import { describe, it } from 'node:test';
import assert from 'node:assert';
import { db } from '../src/db';
import { ModelRegistry } from '../src/modelRegistry';
import { ChatIntentClassifier } from '../src/chatIntentClassifier';
import { AutonomousManager } from '../src/autonomousManager';

describe('System Simplification and Execution State Truth Suite', () => {
  it('should persist and isolate model, account and reasoning level strictly per project', async () => {
    const projId1 = 'proj-iso-1-' + Date.now();
    const projId2 = 'proj-iso-2-' + Date.now();
    const nowIso = new Date().toISOString();

    db.prepare(`
      INSERT INTO projects (id, name, path, active_account_profile_id, selected_model, reasoning_level, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(projId1, 'Project Alpha', 'C:\\dummy\\alpha', 'acc-alpha', 'flash', 'HIGH', nowIso, nowIso);

    db.prepare(`
      INSERT INTO projects (id, name, path, active_account_profile_id, selected_model, reasoning_level, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(projId2, 'Project Beta', 'C:\\dummy\\beta', 'acc-beta', 'pro', 'LOW', nowIso, nowIso);

    // Retrieve Alpha (accountProfileId, projectId)
    const alphaPrefs = ModelRegistry.getPreferences('acc-alpha', projId1);
    assert.strictEqual(alphaPrefs.default, 'flash');
    assert.strictEqual(alphaPrefs.reasoning_level, 'HIGH');

    // Retrieve Beta (accountProfileId, projectId)
    const betaPrefs = ModelRegistry.getPreferences('acc-beta', projId2);
    assert.strictEqual(betaPrefs.default, 'pro');
    assert.strictEqual(betaPrefs.reasoning_level, 'LOW');

    // Cross-isolation guarantee: Alpha's settings must never bleed into Beta
    assert.notStrictEqual(alphaPrefs.default, betaPrefs.default);
    assert.notStrictEqual(alphaPrefs.reasoning_level, betaPrefs.reasoning_level);
  });

  it('should classify conversational queries without creating execution tasks', () => {
    const q1 = 'Como está a arquitetura deste projeto?';
    const c1 = ChatIntentClassifier.classify(q1);
    assert.ok(c1.intent === 'CONVERSATION' || c1.intent === 'STATE_QUERY');
    assert.notStrictEqual(c1.intent, 'EXECUTION_INSTRUCTION');

    const q2 = 'Quais são os erros no log do backend?';
    const c2 = ChatIntentClassifier.classify(q2);
    assert.ok(c2.intent === 'CONVERSATION' || c2.intent === 'STATE_QUERY');
    assert.notStrictEqual(c2.intent, 'EXECUTION_INSTRUCTION');

    const q3 = 'Explique como funciona o motor de cálculos financeiros.';
    const c3 = ChatIntentClassifier.classify(q3);
    assert.strictEqual(c3.intent, 'CONVERSATION');
    assert.notStrictEqual(c3.intent, 'EXECUTION_INSTRUCTION');

    // Explicit command should be classified as EXECUTION_INSTRUCTION
    const cmd = 'Implemente o módulo de autenticação com JWT e testes';
    const cCmd = ChatIntentClassifier.classify(cmd);
    assert.strictEqual(cCmd.intent, 'EXECUTION_INSTRUCTION');
  });

  it('should support waiting_resource state and prevent crash loops on resume when runtime is offline', async () => {
    const projId = 'proj-run-res-' + Date.now();
    const nowIso = new Date().toISOString();

    db.prepare(`
      INSERT INTO projects (id, name, path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(projId, 'Run Test Proj', 'C:\\dummy\\run', nowIso, nowIso);

    const run = await AutonomousManager.createRun({
      projectId: projId,
      name: 'Test Run Resource Resilience',
      objective: 'Validar tratamento de waiting_resource'
    });
    assert.ok(run);
    assert.ok(run.id);

    // Simulate run entering waiting_resource state (e.g. AGENTAPI_UNAVAILABLE)
    db.prepare(`
      UPDATE autonomous_runs
      SET status = 'waiting_resource', last_error = 'AGENTAPI_UNAVAILABLE: Language Server offline'
      WHERE id = ?
    `).run(run.id);

    const updatedRun = AutonomousManager.getRun(run.id);
    assert.strictEqual(updatedRun?.status, 'waiting_resource');
    assert.match(updatedRun?.last_error || '', /AGENTAPI_UNAVAILABLE/);

    // Under live preflight check, verify that resuming without active runtime stays waiting_resource
    const origOffline = process.env.DECOHUB_OFFLINE_MODE;
    try {
      process.env.DECOHUB_OFFLINE_MODE = 'false';
      const resumed = await AutonomousManager.resumeRun(run.id);
      assert.strictEqual(resumed.status, 'waiting_resource');
      assert.ok(resumed.last_error?.includes('AGENTAPI_UNAVAILABLE') || resumed.last_error?.includes('Language Server') || resumed.last_error?.includes('ACCOUNT_UNAVAILABLE'));
    } finally {
      process.env.DECOHUB_OFFLINE_MODE = origOffline;
    }
  });
});
