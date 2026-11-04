import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { GitManager } from '../src/gitManager.js';

describe('GitManager Suite', () => {
  const currentRepoPath = path.resolve(__dirname, '../..');

  test('should detect current project as a valid git repository', () => {
    const gitInfo = GitManager.getGitInfo(currentRepoPath);
    assert.strictEqual(gitInfo.isGitRepo, true, 'Current project should be recognized as a Git repository');
    assert.strictEqual(typeof gitInfo.branch, 'string', 'Current branch should be a string');
    assert.ok(gitInfo.branch && gitInfo.branch.length > 0, 'Branch name must not be empty');
    assert.ok(gitInfo.lastCommit !== null, 'Last commit should be present after initial commit');
    assert.ok(typeof gitInfo.statusSummary.total === 'number', 'Status summary total must be numeric');
  });

  test('should correctly report non-git directory', () => {
    const tempEmptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'non-git-test-'));
    try {
      const gitInfo = GitManager.getGitInfo(tempEmptyDir);
      assert.strictEqual(gitInfo.isGitRepo, false, 'Temporary empty folder must not be a git repo');
      assert.strictEqual(gitInfo.branch, null);
      assert.strictEqual(gitInfo.lastCommit, null);
    } finally {
      fs.rmSync(tempEmptyDir, { recursive: true, force: true });
    }
  });

  test('should obtain unified diff structure without crashing', () => {
    const diffResult = GitManager.getUnifiedDiff(currentRepoPath);
    assert.ok(typeof diffResult.diff === 'string', 'diff should be a string');
    assert.ok(Array.isArray(diffResult.files), 'files should be an array');
    assert.ok(typeof diffResult.rawSummary === 'string', 'rawSummary should be a string');
  });

  test('should detect remotes and handle shouldSkipPush for local repos without remotes', () => {
    const tempGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-remote-test-'));
    try {
      // Inicializar git repo limpo sem remotes
      GitManager.safeExecFileSync('git', ['init'], { cwd: tempGitDir });
      GitManager.safeExecFileSync('git', ['config', 'user.email', 'test@decohub.local'], { cwd: tempGitDir });
      GitManager.safeExecFileSync('git', ['config', 'user.name', 'DecoHub Test'], { cwd: tempGitDir });

      const remotesEmpty = GitManager.getRemotes(tempGitDir);
      assert.deepStrictEqual(remotesEmpty, [], 'Fresh git repo must have no remotes');
      assert.strictEqual(GitManager.hasRemote(tempGitDir, 'origin'), false);

      const skipCheck = GitManager.shouldSkipPush(tempGitDir);
      assert.strictEqual(skipCheck.skip, true, 'Push must be skipped when repo has no remotes');
      assert.strictEqual(skipCheck.hasRemote, false);

      // pushBranch deve retornar false (pushed: false) sem lançar exceção
      const pushResult = GitManager.pushBranch(tempGitDir, 'master');
      assert.strictEqual(pushResult, false, 'pushBranch should return false when push is skipped');

      // Adiciona remote e verifica detecção
      GitManager.safeExecFileSync('git', ['remote', 'add', 'origin', 'https://github.com/example/repo.git'], { cwd: tempGitDir });
      const remotesWithOrigin = GitManager.getRemotes(tempGitDir);
      assert.ok(remotesWithOrigin.includes('origin'), 'Should detect origin remote');
      assert.strictEqual(GitManager.hasRemote(tempGitDir, 'origin'), true);
    } finally {
      fs.rmSync(tempGitDir, { recursive: true, force: true });
    }
  });

  test('should safely rollback uncommitted modifications and untracked files via rollbackUncommittedChanges', () => {
    const tempGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-rollback-test-'));
    try {
      // 1. Inicializar git repo e fazer primeiro commit
      GitManager.safeExecFileSync('git', ['init'], { cwd: tempGitDir });
      const trackedFile = path.join(tempGitDir, 'src.txt');
      fs.writeFileSync(trackedFile, 'initial content\n', 'utf-8');
      GitManager.safeExecFileSync('git', ['add', 'src.txt'], { cwd: tempGitDir });
      GitManager.safeExecFileSync('git', ['commit', '-m', 'initial commit'], { cwd: tempGitDir });

      const stableCommitSha = GitManager.safeExecFileSync('git', ['rev-parse', 'HEAD'], { cwd: tempGitDir }).trim();

      // 2. Simular worker corrompendo o arquivo rastreado e criando arquivo lixo não rastreado
      fs.writeFileSync(trackedFile, 'corrupted dirty content\n', 'utf-8');
      const junkFile = path.join(tempGitDir, 'junk_untracked.ts');
      fs.writeFileSync(junkFile, 'export const broken = 123;\n', 'utf-8');
      assert.strictEqual(fs.existsSync(junkFile), true);

      // 3. Executar rollback seguro
      const rolledBack = GitManager.rollbackUncommittedChanges(tempGitDir, stableCommitSha);
      assert.strictEqual(rolledBack, true, 'Rollback deve retornar true');

      // 4. Verificar restauração da árvore de trabalho
      assert.strictEqual(fs.readFileSync(trackedFile, 'utf-8').trim(), 'initial content', 'Arquivo rastreado deve ser restaurado');
      assert.strictEqual(fs.existsSync(junkFile), false, 'Arquivo não rastreado deve ser removido');

      const currentHead = GitManager.safeExecFileSync('git', ['rev-parse', 'HEAD'], { cwd: tempGitDir }).trim();
      assert.strictEqual(currentHead, stableCommitSha, 'HEAD deve estar alinhado com o commit estável');
    } finally {
      fs.rmSync(tempGitDir, { recursive: true, force: true });
    }
  });

  test('should execute atomic commit with standardized message and update tasks.md via executePostReviewCommitGate', async () => {
    const tempGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-atomic-gate-test-'));
    const { db } = await import('../src/db.js');
    const { HierarchicalOrchestrationService } = await import('../src/hierarchicalOrchestrationService.js');

    const projId = `proj-atomic-${Date.now()}`;
    const runId = `run-atomic-${Date.now()}`;
    const taskId = `task-atomic-${Date.now()}`;
    const nowIso = new Date().toISOString();

    try {
      // 1. Inicializar git repo e commit inicial
      GitManager.safeExecFileSync('git', ['init'], { cwd: tempGitDir });
      const initialFile = path.join(tempGitDir, 'README.md');
      fs.writeFileSync(initialFile, '# Atomic Gate\n', 'utf-8');
      GitManager.safeExecFileSync('git', ['add', 'README.md'], { cwd: tempGitDir });
      GitManager.safeExecFileSync('git', ['commit', '-m', 'chore: initial'], { cwd: tempGitDir });

      // 2. Inserir projeto, run e task no SQLite
      db.prepare('INSERT INTO projects (id, name, path, objective, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(projId, 'AtomicProj', tempGitDir, 'Testar commit atômico', nowIso, nowIso);

      db.prepare('INSERT INTO autonomous_runs (id, project_id, name, objective, briefing, status, start_time, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(runId, projId, 'AtomicRun', 'Testar commit atômico', 'Briefing', 'running', nowIso, nowIso, nowIso);

      db.prepare(`
        INSERT INTO autonomous_tasks (id, run_id, project_id, title, description, milestone, code, status, lifecycle_state, order_index, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(taskId, runId, projId, 'Criar Endpoint de Métricas', 'Implementar GET /metrics', 'GT-1', '1.1', 'in_review', 'APPROVED', 1, nowIso, nowIso);

      // 3. Modificar código e preparar kanban
      const featureFile = path.join(tempGitDir, 'metrics.ts');
      fs.writeFileSync(featureFile, 'export function getMetrics() { return { ok: true }; }\n', 'utf-8');

      const aiDir = path.join(tempGitDir, '.ai-dev-hub');
      fs.mkdirSync(aiDir, { recursive: true });
      fs.writeFileSync(path.join(aiDir, 'tasks.md'), '# Gerenciamento de Tarefas\n\n## Pendente\n- [ ] Criar Endpoint de Métricas\n', 'utf-8');

      // 4. Executar executePostReviewCommitGate
      const gateResult = HierarchicalOrchestrationService.executePostReviewCommitGate({
        runId,
        taskId,
        projectPath: tempGitDir,
        filesChanged: ['metrics.ts']
      });

      assert.strictEqual(gateResult.success, true);
      assert.strictEqual(gateResult.committed, true);
      assert.ok(gateResult.commitSha && gateResult.commitSha.length >= 7, 'Commit SHA deve ser gerado');
      assert.strictEqual(gateResult.commitMessage, 'feat(1.1): Criar Endpoint de Métricas', 'Mensagem padronizada feat(code): title');

      // 5. Verificar persistência em autonomous_tasks
      const taskInDb: any = db.prepare('SELECT task_commit_sha, status, lifecycle_state FROM autonomous_tasks WHERE id = ?').get(taskId);
      assert.strictEqual(taskInDb.task_commit_sha, gateResult.commitSha, 'task_commit_sha deve ser persistido no banco');
      assert.strictEqual(taskInDb.status, 'completed');
      assert.strictEqual(taskInDb.lifecycle_state, 'COMPLETED');

      // 6. Verificar atualização de Kanban em .ai-dev-hub/tasks.md
      const tasksMdAfter = fs.readFileSync(path.join(aiDir, 'tasks.md'), 'utf-8');
      assert.ok(tasksMdAfter.includes('- [x] Criar Endpoint de Métricas'), 'tasks.md deve marcar a tarefa como [x]');

      // 7. Testar rollbackToLastStableCommit no AutonomousRunnerService
      const { AutonomousRunnerService } = await import('../src/autonomousRunnerService.js');
      // Criar lixo não commitado para simular tarefa subsequente que falha
      const dirtySubsequent = path.join(tempGitDir, 'dirty.ts');
      fs.writeFileSync(dirtySubsequent, 'syntax error !!!', 'utf-8');
      assert.strictEqual(fs.existsSync(dirtySubsequent), true);

      const rollbackOk = AutonomousRunnerService.rollbackToLastStableCommit(runId, taskId, 'Teste de regressão subsequente');
      assert.strictEqual(rollbackOk, true, 'rollbackToLastStableCommit deve retornar true');
      assert.strictEqual(fs.existsSync(dirtySubsequent), false, 'Arquivo sujo deve ser eliminado pelo rollback automático');
    } finally {
      fs.rmSync(tempGitDir, { recursive: true, force: true });
    }
  });
});
