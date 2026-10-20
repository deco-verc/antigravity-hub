import test, { describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { CommandExecutionEngine } from '../src/commandExecutionEngine.js';
import { TestSelector } from '../src/testSelector.js';
import { db } from '../src/db.js';

describe('Command Execution Engine & Test Selector Suite', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-exec-engine-test-'));
  const nodeBin = process.execPath;

  after(() => {
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "commandExecutionEngine.test",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:commandExecutionEngine.test]", err);
      }
    }
  });

  test('1. Fast command normal exit (code 0) with latencies', async () => {
    const record = await CommandExecutionEngine.execute({
      command: nodeBin,
      args: ['-e', 'console.log("engine-fast-ok")'],
      cwd: tempDir,
      kind: 'test'
    });

    assert.equal(record.status, 'COMPLETED');
    assert.equal(record.exitCode, 0);
    assert.match(record.stdout, /engine-fast-ok/);
    assert.equal(record.stderr, '');
    assert.equal(record.errorMessage, null);
    assert.ok(typeof record.durationMs === 'number' && record.durationMs >= 0);
    assert.ok(typeof record.queueLatencyMs === 'number' && record.queueLatencyMs >= 0);
    assert.ok(typeof record.totalLatencyMs === 'number' && record.totalLatencyMs >= 0);
  });

  test('2. Non-zero exit code capture', async () => {
    const record = await CommandExecutionEngine.execute({
      command: nodeBin,
      args: ['-e', 'process.exit(42)'],
      cwd: tempDir,
      kind: 'generic'
    });

    assert.equal(record.status, 'FAILED');
    assert.equal(record.exitCode, 42);
    assert.match(record.errorMessage || '', /42/);
  });

  test('3. Stdout and stderr separation and capture', async () => {
    const record = await CommandExecutionEngine.execute({
      command: nodeBin,
      args: ['-e', 'console.log("standard-output"); console.error("standard-error")'],
      cwd: tempDir,
      kind: 'build'
    });

    assert.equal(record.status, 'COMPLETED');
    assert.equal(record.exitCode, 0);
    assert.match(record.stdout, /standard-output/);
    assert.match(record.stderr, /standard-error/);
  });

  test('4. Paths with spaces and special characters', async () => {
    const specialSubdir = path.join(tempDir, 'folder with spaces (special #1)');
    fs.mkdirSync(specialSubdir, { recursive: true });

    const record = await CommandExecutionEngine.execute({
      command: nodeBin,
      args: ['-e', 'console.log(process.cwd())'],
      cwd: specialSubdir,
      kind: 'generic'
    });

    assert.equal(record.status, 'COMPLETED');
    assert.equal(record.exitCode, 0);
    assert.equal(path.resolve(record.stdout.trim()), path.resolve(specialSubdir));
  });

  test('5. Controlled timeout exceeding limit', async () => {
    const record = await CommandExecutionEngine.execute({
      command: nodeBin,
      args: ['-e', 'setTimeout(() => {}, 10000)'],
      cwd: tempDir,
      timeoutMs: 300,
      kind: 'generic'
    });

    assert.equal(record.status, 'TIMED_OUT');
    assert.match(record.errorMessage || '', /tempo limite|excedeu/i);
  });

  test('6. Active execution cancellation by ID', async () => {
    const execPromise = CommandExecutionEngine.execute({
      command: nodeBin,
      args: ['-e', 'setTimeout(() => { console.log("should not finish"); }, 10000)'],
      cwd: tempDir,
      timeoutMs: 8000,
      kind: 'generic'
    });

    // Wait 50ms for process to spawn
    await new Promise(r => setTimeout(r, 50));

    // Find the active execution in DB
    const activeRow: any = db.prepare(`
      SELECT id FROM command_executions WHERE status = 'RUNNING' ORDER BY requested_at DESC LIMIT 1
    `).get();

    assert.ok(activeRow?.id, 'Deve encontrar execução ativa em RUNNING');
    const cancelled = CommandExecutionEngine.cancelExecution(activeRow.id, 'Teste de cancelamento');
    assert.equal(cancelled, true);

    const record = await execPromise;
    assert.equal(record.status, 'CANCELLED');
    assert.match(record.errorMessage || '', /Teste de cancelamento/);
  });

  test('7. Retrieval of execution by ID and SQLite persistence', async () => {
    const record = await CommandExecutionEngine.execute({
      command: nodeBin,
      args: ['-e', 'console.log("query-me")'],
      cwd: tempDir,
      kind: 'generic',
      metadata: { suite: 'query-test', flag: 123 }
    });

    const retrieved = CommandExecutionEngine.getExecution(record.id);
    assert.ok(retrieved !== null);
    assert.equal(retrieved.id, record.id);
    assert.equal(retrieved.status, 'COMPLETED');
    assert.equal(retrieved.exitCode, 0);
    assert.match(retrieved.stdout, /query-me/);
    assert.equal(retrieved.metadata?.flag, 123);
  });

  test('8. Idempotency Key - Deduplication and cached reuse', async () => {
    const key = `test-idemp-${Date.now()}`;

    // First execution
    const first = await CommandExecutionEngine.execute({
      idempotencyKey: key,
      command: nodeBin,
      args: ['-e', 'console.log("idemp-result")'],
      cwd: tempDir,
      reuseCachedMs: 5000,
      kind: 'generic'
    });

    assert.equal(first.status, 'COMPLETED');

    // Second execution with same idempotency key within cache window
    const second = await CommandExecutionEngine.execute({
      idempotencyKey: key,
      command: nodeBin,
      args: ['-e', 'console.log("idemp-result")'],
      cwd: tempDir,
      reuseCachedMs: 5000,
      kind: 'generic'
    });

    assert.equal(second.id, first.id);
    assert.equal(second.cached, true);
    assert.match(second.stdout, /idemp-result/);
  });

  test('9. Restart recovery / orphaned status cleanup', () => {
    const dummyId = `orphaned-test-${Date.now()}`;
    const now = new Date().toISOString();

    // Insert an orphaned execution with non-existent PIDs
    db.prepare(`
      INSERT INTO command_executions (
        id, idempotency_key, command, args_json, cwd, kind, status,
        owner_pid, pid, timeout_ms, requested_at, started_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'RUNNING', 99999999, 99999998, 30000, ?, ?)
    `).run(
      dummyId,
      'orphaned-key',
      'dummy-cmd',
      '[]',
      tempDir,
      'generic',
      now,
      now
    );

    const reconciledCount = CommandExecutionEngine.reconcileOrphanedExecutions();
    assert.ok(reconciledCount >= 1, 'Deve reconciliar pelo menos 1 execução órfã');

    const recovered = CommandExecutionEngine.getExecution(dummyId);
    assert.ok(recovered !== null);
    assert.equal(recovered.status, 'CANCELLED');
    assert.equal(recovered.errorMessage, 'PROCESS_ORPHANED_ON_RESTART');
  });

  test('10. Large output preview in SQLite while preserving full disk log', async () => {
    // Generate 16KB of stdout
    const record = await CommandExecutionEngine.execute({
      command: nodeBin,
      args: ['-e', 'process.stdout.write("Z".repeat(16384))'],
      cwd: tempDir,
      kind: 'generic'
    });

    assert.equal(record.status, 'COMPLETED');
    assert.equal(record.stdout.length, 16384);

    // Verify preview in SQLite was capped at 8192 bytes
    const row: any = db.prepare('SELECT stdout_preview FROM command_executions WHERE id = ?').get(record.id);
    assert.ok(row.stdout_preview.length <= 8192, 'Preview no banco não deve ultrapassar 8192 bytes');

    // Verify full log file on disk exists and contains all 16384 bytes
    assert.ok(record.logFilePath !== null && fs.existsSync(record.logFilePath));
    const logContent = fs.readFileSync(record.logFilePath, 'utf-8');
    assert.ok(logContent.includes('Z'.repeat(16384)), 'Arquivo de log em disco deve conter a saída completa');

    // Verify getExecution correctly reloads full content
    const reloaded = CommandExecutionEngine.getExecution(record.id);
    assert.equal(reloaded?.stdout.length, 16384);
  });

  test('11. TestSelector scoped planning for single module change', () => {
    // Create mock project structure
    const mockProj = path.join(tempDir, 'mock-project');
    const mockSrc = path.join(mockProj, 'src');
    const mockTest = path.join(mockProj, 'test');
    fs.mkdirSync(mockSrc, { recursive: true });
    fs.mkdirSync(mockTest, { recursive: true });

    fs.writeFileSync(path.join(mockProj, 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }));
    fs.writeFileSync(path.join(mockSrc, 'authService.ts'), 'export const auth = true;');
    fs.writeFileSync(path.join(mockTest, 'authService.test.ts'), 'test("auth", () => {});');
    fs.writeFileSync(path.join(mockTest, 'billingService.test.ts'), 'test("billing", () => {});');

    const plan = TestSelector.planVerification(mockProj, ['src/authService.ts']);

    assert.equal(plan.mode, 'FOCUSED');
    assert.equal(plan.requiresFullSuite, false);
    assert.equal(plan.matchedTests.length, 1);
    assert.match(plan.matchedTests[0], /authService\.test\.ts/);
    assert.match(plan.suggestedCommand, /authService\.test\.ts/);
  });

  test('12. TestSelector broad/core change planning & safety fallbacks', () => {
    const mockProj = path.join(tempDir, 'mock-project');

    // A. Core database file change -> FULL_SUITE
    const planDb = TestSelector.planVerification(mockProj, ['src/db.ts']);
    assert.equal(planDb.mode, 'FULL_SUITE');
    assert.equal(planDb.requiresFullSuite, true);
    assert.match(planDb.reason, /impacto estrutural amplo/);

    // B. More than 5 files changed -> FULL_SUITE
    const planMany = TestSelector.planVerification(mockProj, [
      'f1.ts', 'f2.ts', 'f3.ts', 'f4.ts', 'f5.ts', 'f6.ts'
    ]);
    assert.equal(planMany.mode, 'FULL_SUITE');
    assert.equal(planMany.requiresFullSuite, true);

    // C. Final gate flag -> FULL_SUITE
    const planGate = TestSelector.planVerification(mockProj, ['src/authService.ts'], { isFinalGate: true });
    assert.equal(planGate.mode, 'FULL_SUITE');
    assert.equal(planGate.requiresFullSuite, true);
    assert.match(planGate.reason, /Portão final/);

    // D. Empty files list fallback -> FULL_SUITE
    const planEmpty = TestSelector.planVerification(mockProj, []);
    assert.equal(planEmpty.mode, 'FULL_SUITE');
    assert.equal(planEmpty.requiresFullSuite, true);
  });

  test('13. Performance summary reporting aggregates execution stats', () => {
    const summary = CommandExecutionEngine.getPerformanceSummary();

    assert.ok(typeof summary.total_executions === 'number');
    assert.ok(summary.total_executions > 0);
    assert.ok(typeof summary.completed_count === 'number');
    assert.ok(summary.completed_count > 0);
    assert.ok(Array.isArray(summary.recent));
    assert.ok(summary.recent.length > 0);
  });
});
