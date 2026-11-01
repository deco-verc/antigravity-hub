import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AntigravityProvider } from '../src/antigravityProvider.js';
import { MetaChatService } from '../src/metaChatService.js';
import { TurnCancellationManager } from '../src/turnCancellationManager.js';
import { AntigravityDiscovery } from '../src/antigravityDiscovery.js';

function workspace(t: any) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-metachat-fast-test-'));
  const project = path.join(root, 'project');
  fs.mkdirSync(project, { recursive: true });
  const brain = path.join(root, '.gemini', 'antigravity', 'brain');
  fs.mkdirSync(brain, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, project, brain };
}

function append(brain: string, id: string, entry: any) {
  const file = path.join(brain, id, '.system_generated', 'logs', 'transcript.jsonl');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(entry) + '\n');
  return file;
}

test('AntigravityProvider resolves quickly when last entry is assistant response with 0 pending tools', async t => {
  const { brain, project } = workspace(t);
  const sessionId = 'fast-completion-test-session';

  append(brain, sessionId, {
    type: 'USER_INPUT',
    role: 'user',
    content: 'Crie uma nova funcionalidade no DecoHUB'
  });

  append(brain, sessionId, {
    type: 'PLANNER_RESPONSE',
    role: 'assistant',
    status: 'DONE',
    content: 'Funcionalidade implementada com sucesso.',
    tool_calls: []
  });

  const provider = new AntigravityProvider({
    CUSTOM_USER_PROFILE_DIR: brain
  } as any);

  // Custom resolveTranscriptPath to point to test brain
  (provider as any).resolveTranscriptPath = () =>
    path.join(brain, sessionId, '.system_generated', 'logs', 'transcript.jsonl');

  const start = Date.now();
  const result = await provider.getResult(sessionId, 180000, project);
  const duration = Date.now() - start;

  assert.ok(result, 'Resultado deve existir');
  assert.ok(result.rawResponse.includes('Funcionalidade implementada com sucesso'));
  // Deve concluir de forma ágil (em teste, < 5 segundos)
  assert.ok(duration < 5000, `Duração deve ser < 5s (levou ${duration}ms)`);
});

test('TurnCancellationManager auto-clear at Meta-Chat turn start prevents ghost cancellations', t => {
  const threadId = 'test-thread-cancellation-reset';
  const convId = 'test-conv-cancellation-reset';

  // Simula cancelamento residual de um turno anterior
  TurnCancellationManager.requestCancellation('metachat');
  TurnCancellationManager.requestCancellation(threadId);
  TurnCancellationManager.requestCancellation(convId);

  assert.ok(TurnCancellationManager.isCancelled('metachat'));
  assert.ok(TurnCancellationManager.isCancelled(threadId));
  assert.ok(TurnCancellationManager.isCancelled(convId));

  // Limpeza que agora é executada no topo de handleUserMessage / executeTurn
  TurnCancellationManager.clearCancellation('metachat', convId, threadId);

  assert.equal(TurnCancellationManager.isCancelled('metachat'), false);
  assert.equal(TurnCancellationManager.isCancelled(threadId), false);
  assert.equal(TurnCancellationManager.isCancelled(convId), false);
});

test('Simplicity Criterion (Occam Razor) is informational and does not roll back multi-file expansion', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-occam-test-'));
  try {
    const file1 = path.join(root, 'server', 'src', 'newFeature1.ts');
    const file2 = path.join(root, 'server', 'src', 'newFeature2.ts');
    fs.mkdirSync(path.dirname(file1), { recursive: true });
    fs.writeFileSync(file1, 'export const f1 = 1;\nexport const f2 = 2;\n');
    fs.writeFileSync(file2, 'export const g1 = 1;\nexport const g2 = 2;\n');

    const filesChanged = ['server/src/newFeature1.ts', 'server/src/newFeature2.ts'];
    const baselineBefore = new Map<string, { size: number; content: string | null }>();

    const simplicity = MetaChatService.checkSimplicityCriterion(root, filesChanged, baselineBefore, {
      testsPassed: false
    });

    // Check that simplicity criterion calculates metrics
    assert.ok(simplicity);
    assert.equal(typeof simplicity.linesAdded, 'number');
    assert.equal(typeof simplicity.linesRemoved, 'number');
    assert.equal(typeof simplicity.delta, 'number');
    // Multi-file additions are expected in Meta-Chat and files must remain on disk
    assert.ok(fs.existsSync(file1));
    assert.ok(fs.existsSync(file2));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
