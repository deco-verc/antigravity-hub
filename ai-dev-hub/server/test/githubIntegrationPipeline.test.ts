import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { execSync, execFileSync } from 'node:child_process';
import { GitManager } from '../src/gitManager.js';
import { db } from '../src/db.js';
import { HierarchicalOrchestrationService } from '../src/hierarchicalOrchestrationService.js';

describe('GitHub Integration Pipeline Suite', () => {
  let testRepoDir: string;

  before(() => {
    testRepoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-git-pipeline-test-'));
    // Initialize git repository
    execSync('git init -b main', { cwd: testRepoDir, stdio: 'ignore' });
    execSync('git config user.name "DecoHUB Tester"', { cwd: testRepoDir, stdio: 'ignore' });
    execSync('git config user.email "tester@decohub.local"', { cwd: testRepoDir, stdio: 'ignore' });

    // Create initial commit
    GitManager.ensureGitIgnore(testRepoDir);
    fs.writeFileSync(path.join(testRepoDir, 'README.md'), '# Test Pipeline\n');
    execSync('git add .', { cwd: testRepoDir, stdio: 'ignore' });
    execSync('git commit -m "chore: initial commit"', { cwd: testRepoDir, stdio: 'ignore' });
  });

  after(() => {
    try {
      fs.rmSync(testRepoDir, { recursive: true, force: true });
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "githubIntegrationPipeline.test",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:githubIntegrationPipeline.test]", err);
      }
    }
  });

  test('1. commitSelected ignora arquivos do .gitignore sem quebrar e comita arquivos rastreados', () => {
    // Create tracked file
    const srcDir = path.join(testRepoDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    const calcFile = path.join(srcDir, 'calculator.ts');
    fs.writeFileSync(calcFile, 'export const add = (a: number, b: number) => a + b;\n');

    // Create ignored file (dist/ is in .gitignore)
    const distDir = path.join(testRepoDir, 'dist');
    fs.mkdirSync(distDir, { recursive: true });
    const distFile = path.join(distDir, 'calculator.js');
    fs.writeFileSync(distFile, 'exports.add = function(a, b) { return a + b; };\n');

    // Attempt to commit both files
    const candidateFiles = ['src/calculator.ts', 'dist/calculator.js'];
    const commitMsg = 'feat: add calculator module';
    const committed = GitManager.commitSelected(testRepoDir, candidateFiles, commitMsg);

    assert.strictEqual(committed, true, 'Commit seletivo deve ter sucesso');

    // Verify git log contains commit
    const headMsg = execSync('git log -1 --pretty=%B', { cwd: testRepoDir, encoding: 'utf-8' }).trim();
    assert.strictEqual(headMsg, commitMsg);

    // Verify calculator.ts is tracked and committed
    const trackedFiles = execSync('git ls-files', { cwd: testRepoDir, encoding: 'utf-8' });
    assert.ok(trackedFiles.includes('src/calculator.ts'), 'src/calculator.ts deve estar rastreado');
    assert.ok(!trackedFiles.includes('dist/calculator.js'), 'dist/calculator.js NÃO deve estar rastreado no git');
  });

  test('2. commitSelected retorna false se apenas arquivos ignorados forem passados', () => {
    const distDir = path.join(testRepoDir, 'dist');
    const anotherDist = path.join(distDir, 'bundle.js');
    fs.writeFileSync(anotherDist, 'console.log("bundle");\n');

    const committed = GitManager.commitSelected(testRepoDir, ['dist/bundle.js'], 'feat: ignored only');
    assert.strictEqual(committed, false, 'Não deve comitar apenas arquivos ignorados');
  });

  test('3. getCommitDetails extrai corretamente metadados do commit', () => {
    const details = GitManager.getCommitDetails(testRepoDir, 'HEAD');
    assert.ok(details, 'Metadados do commit devem existir');
    assert.strictEqual(typeof details?.sha, 'string');
    assert.strictEqual(details?.sha.length, 40);
    assert.strictEqual(details?.author, 'DecoHUB Tester');
    assert.strictEqual(details?.message, 'feat: add calculator module');
    assert.ok(details?.date);
  });

  test('4. executePostReviewCommitGate não furta HEAD de outra tarefa se commitSelected falhar', () => {
    const projId = `test-proj-git-${Date.now()}`;
    const runId = `test-run-git-${Date.now()}`;
    const taskId = `test-task-git-${Date.now()}`;
    const now = new Date().toISOString();

    try {
      db.prepare(`
        INSERT INTO projects (id, name, path, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(projId, 'Test Git Proj 1', testRepoDir, now, now);

      db.prepare(`
        INSERT INTO autonomous_runs (id, project_id, name, objective, status, start_time, created_at, updated_at)
        VALUES (?, ?, 'Run Test 1', 'Objetivo de teste 1', 'running', ?, ?, ?)
      `).run(runId, projId, now, now, now);

      db.prepare(`
        INSERT INTO autonomous_tasks (
          id, run_id, project_id, title, status, lifecycle_state, code, milestone, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'in_review', 'APPROVED', '2.1', 'M2', ?, ?)
      `).run(taskId, runId, projId, 'Tarefa de Teste Git Gate', now, now);

      // Simulate no new files created, only ignored files
      const result = HierarchicalOrchestrationService.executePostReviewCommitGate({
        runId,
        taskId,
        projectPath: testRepoDir,
        filesChanged: ['dist/nonexistent.js'],
        requireCodeChanges: true
      });

      assert.strictEqual(result.success, false, 'Deve falhar o gate quando não há mudanças reais');
      assert.strictEqual(result.committed, false);
      assert.strictEqual(result.commitSha, null);

      // Verify task is marked BLOCKED
      const taskRow: any = db.prepare('SELECT lifecycle_state, commit_status FROM autonomous_tasks WHERE id = ?').get(taskId);
      assert.strictEqual(taskRow.lifecycle_state, 'BLOCKED');
      assert.strictEqual(taskRow.commit_status, 'commit_failed');
    } finally {
      db.prepare('DELETE FROM autonomous_tasks WHERE id = ?').run(taskId);
      db.prepare('DELETE FROM autonomous_runs WHERE id = ?').run(runId);
      db.prepare('DELETE FROM projects WHERE id = ?').run(projId);
    }
  });

  test('5. executePostReviewCommitGate comita arquivos válidos e registra SHA exclusivo', () => {
    const projId = `test-proj-git2-${Date.now()}`;
    const runId = `test-run-git2-${Date.now()}`;
    const taskId = `test-task-git2-${Date.now()}`;
    const now = new Date().toISOString();

    // Create a subfolder git repository for project 2 to ensure path uniqueness
    const subRepoDir = path.join(testRepoDir, 'subrepo');
    fs.mkdirSync(subRepoDir, { recursive: true });
    execSync('git init -b main', { cwd: subRepoDir, stdio: 'ignore' });
    execSync('git config user.name "DecoHUB Tester"', { cwd: subRepoDir, stdio: 'ignore' });
    execSync('git config user.email "tester@decohub.local"', { cwd: subRepoDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(subRepoDir, 'README.md'), '# Subrepo\n');
    execSync('git add .', { cwd: subRepoDir, stdio: 'ignore' });
    execSync('git commit -m "chore: init subrepo"', { cwd: subRepoDir, stdio: 'ignore' });

    try {
      db.prepare(`
        INSERT INTO projects (id, name, path, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(projId, 'Test Git Proj 2', subRepoDir, now, now);

      db.prepare(`
        INSERT INTO autonomous_runs (id, project_id, name, objective, status, start_time, created_at, updated_at)
        VALUES (?, ?, 'Run Test 2', 'Objetivo de teste 2', 'running', ?, ?, ?)
      `).run(runId, projId, now, now, now);

      db.prepare(`
        INSERT INTO autonomous_tasks (
          id, run_id, project_id, title, status, lifecycle_state, code, milestone, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'in_review', 'APPROVED', '3.1', 'M3', ?, ?)
      `).run(taskId, runId, projId, 'Módulo de Finanças', now, now);

      // Create a new code file in subrepo
      const srcSub = path.join(subRepoDir, 'src');
      fs.mkdirSync(srcSub, { recursive: true });
      const finFile = path.join(srcSub, 'finance.ts');
      fs.writeFileSync(finFile, 'export const formatCurrency = (v: number) => `R$ ${v.toFixed(2)}`;\n');

      const result = HierarchicalOrchestrationService.executePostReviewCommitGate({
        runId,
        taskId,
        projectPath: subRepoDir,
        filesChanged: ['src/finance.ts'],
        requireCodeChanges: true
      });

      assert.strictEqual(result.success, true, 'Commit gate deve ter sucesso');
      assert.strictEqual(result.committed, true);
      assert.ok(result.commitSha, 'Deve retornar commit SHA novo');

      // Verify commit is recorded on task in SQLite
      const taskRow: any = db.prepare('SELECT lifecycle_state, commit_status, task_commit_sha FROM autonomous_tasks WHERE id = ?').get(taskId);
      assert.strictEqual(taskRow.lifecycle_state, 'COMPLETED');
      assert.strictEqual(taskRow.commit_status, 'local_committed');
      assert.strictEqual(taskRow.task_commit_sha, result.commitSha);
    } finally {
      db.prepare('DELETE FROM autonomous_tasks WHERE id = ?').run(taskId);
      db.prepare('DELETE FROM autonomous_runs WHERE id = ?').run(runId);
      db.prepare('DELETE FROM projects WHERE id = ?').run(projId);
    }
  });
});
