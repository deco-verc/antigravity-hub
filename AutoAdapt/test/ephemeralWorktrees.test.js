import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import {
  createEphemeralWorktree,
  validateWorktreeSandbox,
  finalizeEphemeralWorktree,
  withEphemeralSandbox,
  listEphemeralWorktrees
} from '../src/ephemeralWorktrees.js';

describe('Ephemeral Worktrees (IMP-02) — Ciclo de Vida de Sandboxes Efêmeros', () => {
  let tempBaseRepo;

  before(() => {
    // Cria um repositório git temporário para testes isolados
    tempBaseRepo = path.join(os.tmpdir(), `autoadapt-test-repo-${Date.now()}`);
    fs.mkdirSync(tempBaseRepo, { recursive: true });
    execFileSync('git', ['init'], { cwd: tempBaseRepo, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'AutoAdapt Tester'], { cwd: tempBaseRepo, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'test@autoadapt.ai'], { cwd: tempBaseRepo, stdio: 'ignore' });

    // Criar commit inicial
    fs.writeFileSync(path.join(tempBaseRepo, 'README.md'), '# Base Repo', 'utf8');
    execFileSync('git', ['add', '.'], { cwd: tempBaseRepo, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'Initial commit'], { cwd: tempBaseRepo, stdio: 'ignore' });
  });

  after(() => {
    if (tempBaseRepo && fs.existsSync(tempBaseRepo)) {
      try {
        fs.rmSync(tempBaseRepo, { recursive: true, force: true });
      } catch {}
    }
  });

  describe('Validação Estática de Sandbox (validateWorktreeSandbox)', () => {
    it('deve retornar valid = false para diretório inexistente', () => {
      const result = validateWorktreeSandbox(path.join(os.tmpdir(), 'non-existing-dir-xyz'));
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.dirExists, false);
    });

    it('deve identificar presença de lock indesejado no sandbox', () => {
      const mockDir = path.join(os.tmpdir(), `mock-sandbox-${Date.now()}`);
      fs.mkdirSync(path.join(mockDir, '.git'), { recursive: true });
      fs.writeFileSync(path.join(mockDir, '.git', 'index.lock'), 'locked', 'utf8');

      try {
        const result = validateWorktreeSandbox(mockDir);
        assert.strictEqual(result.lockFree, false);
        assert.strictEqual(result.valid, false);
      } finally {
        fs.rmSync(mockDir, { recursive: true, force: true });
      }
    });
  });

  describe('Criação e Finalização Atômica de Worktree Efêmero', () => {
    it('deve instanciar worktree efêmero com branch isolada e ponteiro válido', () => {
      const taskId = 'test-unit-01';
      const sandbox = createEphemeralWorktree({
        baseRepo: tempBaseRepo,
        taskId
      });

      assert.ok(fs.existsSync(sandbox.worktreePath));
      assert.ok(sandbox.branch.startsWith('ephemeral/task-test-unit-01'));
      assert.strictEqual(sandbox.isGitPointerValid, true);

      // Validação do sandbox
      const validation = validateWorktreeSandbox(sandbox.worktreePath);
      assert.strictEqual(validation.valid, true);
      assert.strictEqual(validation.pointerValid, true);
      assert.strictEqual(validation.lockFree, true);

      // Limpeza atômica
      const cleanup = finalizeEphemeralWorktree(sandbox);
      assert.strictEqual(cleanup.cleaned, true);
      assert.strictEqual(fs.existsSync(sandbox.worktreePath), false);
    });

    it('deve executar tarefa e garantir desmonte via withEphemeralSandbox (RAII)', async () => {
      let executedPath = null;

      const result = await withEphemeralSandbox(
        { baseRepo: tempBaseRepo, taskId: 'raii-task-02' },
        (sandbox) => {
          executedPath = sandbox.worktreePath;
          assert.ok(fs.existsSync(executedPath));
          // Criar arquivo dentro do sandbox
          fs.writeFileSync(path.join(executedPath, 'ephemeral-artifact.txt'), 'conteudo', 'utf8');
          return 'sucesso-executado';
        }
      );

      assert.strictEqual(result, 'sucesso-executado');
      // O diretório deve ter sido destruído após o fim do bloco
      assert.strictEqual(fs.existsSync(executedPath), false);
    });

    it('deve listar worktrees efêmeros ativos', () => {
      const sandbox = createEphemeralWorktree({
        baseRepo: tempBaseRepo,
        taskId: 'list-task-03'
      });

      try {
        const active = listEphemeralWorktrees(tempBaseRepo);
        assert.ok(active.length >= 1);
        assert.ok(active.some(w => w.worktree === sandbox.worktreePath || w.branch.includes('list-task-03')));
      } finally {
        finalizeEphemeralWorktree(sandbox);
      }
    });
  });
});
