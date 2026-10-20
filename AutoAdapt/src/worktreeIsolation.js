import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/**
 * Normaliza caminhos para comparação independente de separadores de SO ou case.
 * @param {string} p
 * @returns {string}
 */
export function normalizePath(p) {
  if (!p) return '';
  return path.resolve(p).replace(/\\/g, '/').toLowerCase();
}

/**
 * Faz o parse da saída `git worktree list --porcelain`
 * @param {string} porcelainOutput
 * @returns {Array<{ worktree: string, head: string, branch: string, bare?: boolean }>}
 */
export function parseWorktreePorcelain(porcelainOutput) {
  const entries = [];
  const blocks = porcelainOutput.trim().split(/\r?\n\r?\n/);

  for (const block of blocks) {
    if (!block.trim()) continue;
    const lines = block.split(/\r?\n/);
    const entry = {};

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        entry.worktree = line.slice('worktree '.length).trim();
      } else if (line.startsWith('HEAD ')) {
        entry.head = line.slice('HEAD '.length).trim();
      } else if (line.startsWith('branch ')) {
        entry.branch = line.slice('branch '.length).trim();
      } else if (line === 'bare') {
        entry.bare = true;
      }
    }

    if (entry.worktree) {
      entries.push(entry);
    }
  }

  return entries;
}

/**
 * Obtém a lista de worktrees de um repositório git.
 * @param {string} repoPath
 * @returns {Array<{ worktree: string, head: string, branch: string, bare?: boolean }>}
 */
export function getWorktrees(repoPath) {
  try {
    const stdout = execFileSync('git', ['-C', repoPath, 'worktree', 'list', '--porcelain'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    return parseWorktreePorcelain(stdout);
  } catch (error) {
    throw new Error(`Falha ao listar worktrees em ${repoPath}: ${error.message}`);
  }
}

/**
 * Valida se um worktree específico está configurado e ativo.
 * @param {object} options
 * @param {string} options.baseRepo - Repositório base
 * @param {string} options.worktreePath - Caminho esperado do worktree
 * @param {string} [options.expectedBranch] - Branch esperado (ex: 'audit/self-improvement')
 * @returns {{ exists: boolean, branch: string|null, head: string|null, isGitPointerValid: boolean }}
 */
export function verifyWorktree({ baseRepo, worktreePath, expectedBranch }) {
  const normWorktreePath = normalizePath(worktreePath);
  const dirExists = fs.existsSync(worktreePath);

  let isGitPointerValid = false;
  const gitPath = path.join(worktreePath, '.git');
  if (fs.existsSync(gitPath)) {
    const gitStat = fs.statSync(gitPath);
    if (gitStat.isFile()) {
      const gitContent = fs.readFileSync(gitPath, 'utf8');
      isGitPointerValid = gitContent.includes('gitdir:');
    } else if (gitStat.isDirectory()) {
      isGitPointerValid = true;
    }
  }

  const worktrees = getWorktrees(baseRepo);
  const matched = worktrees.find(w => normalizePath(w.worktree) === normWorktreePath);

  let branchMatches = true;
  if (expectedBranch && matched) {
    const cleanBranch = matched.branch ? matched.branch.replace(/^refs\/heads\//, '') : '';
    const cleanExpected = expectedBranch.replace(/^refs\/heads\//, '');
    branchMatches = cleanBranch === cleanExpected;
  }

  return {
    exists: dirExists && Boolean(matched) && branchMatches,
    dirExists,
    registeredInGit: Boolean(matched),
    branch: matched?.branch ?? null,
    head: matched?.head ?? null,
    isGitPointerValid
  };
}

/**
 * Verifica se o npm install foi executado com sucesso e as dependências existem no diretório.
 * @param {string} targetDir
 * @returns {{ installed: boolean, packageJsonExists: boolean, nodeModulesExists: boolean, packageCount: number }}
 */
export function verifyNpmInstalled(targetDir) {
  const pkgJsonPath = path.join(targetDir, 'package.json');
  const nodeModulesPath = path.join(targetDir, 'node_modules');

  const packageJsonExists = fs.existsSync(pkgJsonPath);
  const nodeModulesExists = fs.existsSync(nodeModulesPath);

  let packageCount = 0;
  if (nodeModulesExists) {
    try {
      const entries = fs.readdirSync(nodeModulesPath);
      // Filtra entradas válidas (diretórios, excluindo .bin e .package-lock.json)
      packageCount = entries.filter(e => !e.startsWith('.')).length;
    } catch {
      packageCount = 0;
    }
  }

  return {
    installed: packageJsonExists && nodeModulesExists && packageCount > 0,
    packageJsonExists,
    nodeModulesExists,
    packageCount
  };
}

/**
 * Executa a auditoria completa de isolamento do worktree ai-dev-hub-self-improvement.
 * @param {object} [options]
 * @returns {{ success: boolean, worktree: object, npm: object }}
 */
export function auditWorktreeIsolation(options = {}) {
  const baseRepo = options.baseRepo || path.resolve('C:/IA/Antigravity HUB/ai-dev-hub');
  const worktreePath = options.worktreePath || path.resolve('C:/IA/Antigravity HUB/ai-dev-hub-self-improvement');
  const expectedBranch = options.expectedBranch || 'audit/self-improvement';

  const worktreeResult = verifyWorktree({ baseRepo, worktreePath, expectedBranch });
  const npmResult = verifyNpmInstalled(worktreePath);

  return {
    success: worktreeResult.exists && npmResult.installed,
    worktree: worktreeResult,
    npm: npmResult
  };
}

// Execução direta via CLI para inspeção rápida
if (process.argv[1] && (process.argv[1].endsWith('worktreeIsolation.js') || process.argv[1].endsWith('worktreeIsolation'))) {
  const result = auditWorktreeIsolation();
  console.log('[AutoAdapt] Auditoria de Isolamento Worktree:');
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.success ? 0 : 1;
}
