import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import {
  normalizePath,
  parseWorktreePorcelain,
  getWorktrees,
  verifyWorktree,
  verifyNpmInstalled,
  auditWorktreeIsolation
} from '../src/worktreeIsolation.js';

describe('Isolamento Worktree — Criar git worktree isolado de ai-dev-hub em ai-dev-hub-self-improvement para auditoria', () => {

  describe('Funções Auxiliares e Parsing', () => {
    it('normalizePath deve normalizar separadores e casing de forma idempotente', () => {
      const p1 = 'C:\\IA\\Antigravity HUB\\ai-dev-hub';
      const p2 = 'c:/ia/antigravity hub/ai-dev-hub';
      assert.equal(normalizePath(p1), normalizePath(p2));
    });

    it('parseWorktreePorcelain deve fazer parsing correto de saídas git porcelain', () => {
      const mockPorcelain = [
        'worktree C:/repo/main',
        'HEAD abc123def456',
        'branch refs/heads/main',
        '',
        'worktree C:/repo/isolated',
        'HEAD def456abc123',
        'branch refs/heads/audit/self-improvement'
      ].join('\n');

      const parsed = parseWorktreePorcelain(mockPorcelain);
      assert.equal(parsed.length, 2);
      assert.equal(parsed[0].worktree, 'C:/repo/main');
      assert.equal(parsed[0].head, 'abc123def456');
      assert.equal(parsed[0].branch, 'refs/heads/main');
      assert.equal(parsed[1].worktree, 'C:/repo/isolated');
      assert.equal(parsed[1].head, 'def456abc123');
      assert.equal(parsed[1].branch, 'refs/heads/audit/self-improvement');
    });
  });

  describe('Critério 1: Worktree isolado criado', () => {
    const baseRepo = 'C:/IA/Antigravity HUB/ai-dev-hub';
    const worktreePath = 'C:/IA/Antigravity HUB/ai-dev-hub-self-improvement';

    it('Diretório do worktree isolado deve existir no sistema de arquivos', () => {
      assert.ok(fs.existsSync(worktreePath), `Diretório não encontrado: ${worktreePath}`);
      const stat = fs.statSync(worktreePath);
      assert.ok(stat.isDirectory(), `${worktreePath} deve ser um diretório válido.`);
    });

    it('Worktree deve conter ponteiro .git apontando para o gitdir do repositório base', () => {
      const gitPath = path.join(worktreePath, '.git');
      assert.ok(fs.existsSync(gitPath), `Arquivo .git não encontrado em ${worktreePath}`);
      const content = fs.readFileSync(gitPath, 'utf8');
      assert.ok(content.startsWith('gitdir:'), `Arquivo .git deve conter ponteiro gitdir. Conteúdo: ${content}`);
      assert.ok(content.includes('ai-dev-hub-self-improvement'), 'Ponteiro deve referenciar o worktree ai-dev-hub-self-improvement');
    });

    it('Worktree deve estar devidamente registrado no git worktree list do ai-dev-hub com branch audit/self-improvement', () => {
      const worktrees = getWorktrees(baseRepo);
      const matched = worktrees.find(w => normalizePath(w.worktree) === normalizePath(worktreePath));

      assert.ok(matched, `Worktree ${worktreePath} não encontrado na lista de worktrees de ${baseRepo}`);
      assert.equal(matched.branch, 'refs/heads/audit/self-improvement', 'Branch associado deve ser refs/heads/audit/self-improvement');
      assert.ok(matched.head && matched.head.length >= 7, 'HEAD do worktree deve apontar para um commit válido');
    });

    it('verifyWorktree deve retornar status afirmativo para ai-dev-hub-self-improvement', () => {
      const result = verifyWorktree({
        baseRepo,
        worktreePath,
        expectedBranch: 'audit/self-improvement'
      });

      assert.equal(result.exists, true);
      assert.equal(result.dirExists, true);
      assert.equal(result.registeredInGit, true);
      assert.equal(result.isGitPointerValid, true);
      assert.equal(result.branch, 'refs/heads/audit/self-improvement');
    });
  });

  describe('Critério 2: Npm install executado sem erros no novo dir', () => {
    const worktreePath = 'C:/IA/Antigravity HUB/ai-dev-hub-self-improvement';

    it('package.json deve existir no diretório isolado', () => {
      const pkgPath = path.join(worktreePath, 'package.json');
      assert.ok(fs.existsSync(pkgPath), `package.json não encontrado em ${pkgPath}`);
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      assert.ok(pkg.name, 'package.json deve ter a propriedade name');
    });

    it('node_modules deve existir e conter dependências instaladas', () => {
      const nodeModulesPath = path.join(worktreePath, 'node_modules');
      assert.ok(fs.existsSync(nodeModulesPath), `node_modules não encontrado em ${nodeModulesPath}`);
      const entries = fs.readdirSync(nodeModulesPath);
      assert.ok(entries.length > 50, `node_modules deve conter dependências instaladas (encontrados: ${entries.length})`);
    });

    it('verifyNpmInstalled deve retornar installed = true com contagem de pacotes válida', () => {
      const result = verifyNpmInstalled(worktreePath);
      assert.equal(result.installed, true);
      assert.equal(result.packageJsonExists, true);
      assert.equal(result.nodeModulesExists, true);
      assert.ok(result.packageCount > 50, `Esperado mais de 50 pacotes em node_modules, encontrado: ${result.packageCount}`);
    });
  });

  describe('Auditoria Integrada do Worktree', () => {
    it('auditWorktreeIsolation deve validar 100% dos critérios com sucesso', () => {
      const audit = auditWorktreeIsolation({
        baseRepo: 'C:/IA/Antigravity HUB/ai-dev-hub',
        worktreePath: 'C:/IA/Antigravity HUB/ai-dev-hub-self-improvement',
        expectedBranch: 'audit/self-improvement'
      });

      assert.equal(audit.success, true, 'A auditoria completa de isolamento deve ser bem sucedida');
      assert.equal(audit.worktree.exists, true, 'Critério 1 atendido: worktree existe e registrado');
      assert.equal(audit.npm.installed, true, 'Critério 2 atendido: npm install concluído com dependências presentes');
    });
  });

});
