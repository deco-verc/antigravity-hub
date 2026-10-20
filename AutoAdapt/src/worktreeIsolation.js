import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AUTOADAPT_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(AUTOADAPT_ROOT, '..');

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
  if (!porcelainOutput || typeof porcelainOutput !== 'string') return [];
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
 * @returns {{ exists: boolean, dirExists: boolean, registeredInGit: boolean, branch: string|null, head: string|null, isGitPointerValid: boolean }}
 */
export function verifyWorktree({ baseRepo, worktreePath, expectedBranch }) {
  const normWorktreePath = normalizePath(worktreePath);
  const dirExists = Boolean(worktreePath && fs.existsSync(worktreePath));

  let isGitPointerValid = false;
  if (dirExists) {
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
    exists: dirExists && Boolean(matched) && branchMatches && isGitPointerValid,
    dirExists,
    registeredInGit: Boolean(matched),
    branch: matched?.branch ?? null,
    head: matched?.head ?? null,
    isGitPointerValid
  };
}

/**
 * Verifica se as dependências do package.json estão satisfeitas no diretório.
 * Suporta pacotes zero-dependencies nativamente.
 * @param {string} targetDir
 * @returns {{ installed: boolean, packageJsonExists: boolean, nodeModulesExists: boolean, packageCount: number, zeroDependencies: boolean }}
 */
export function verifyNpmInstalled(targetDir) {
  const pkgJsonPath = path.join(targetDir, 'package.json');
  const nodeModulesPath = path.join(targetDir, 'node_modules');

  const packageJsonExists = fs.existsSync(pkgJsonPath);
  const nodeModulesExists = fs.existsSync(nodeModulesPath);

  let zeroDependencies = false;
  if (packageJsonExists) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
      const deps = Object.keys(pkg.dependencies || {}).length;
      const devDeps = Object.keys(pkg.devDependencies || {}).length;
      zeroDependencies = (deps + devDeps) === 0;
    } catch {
      zeroDependencies = false;
    }
  }

  let packageCount = 0;
  if (nodeModulesExists) {
    try {
      const entries = fs.readdirSync(nodeModulesPath);
      packageCount = entries.filter(e => !e.startsWith('.')).length;
    } catch {
      packageCount = 0;
    }
  }

  const installed = packageJsonExists && (
    (nodeModulesExists && packageCount > 0) || zeroDependencies
  );

  return {
    installed,
    packageJsonExists,
    nodeModulesExists,
    packageCount,
    zeroDependencies
  };
}

/**
 * Executa a auditoria completa de isolamento do worktree.
 * @param {object} [options]
 * @returns {{ success: boolean, worktree: object, npm: object }}
 */
export function auditWorktreeIsolation(options = {}) {
  const baseRepo = options.baseRepo || process.env.AUTOADAPT_BASE_REPO || REPO_ROOT;
  const worktreePath = options.worktreePath || process.env.AUTOADAPT_WORKTREE_PATH || REPO_ROOT;
  const expectedBranch = options.expectedBranch || process.env.AUTOADAPT_EXPECTED_BRANCH || undefined;

  const worktreeResult = verifyWorktree({ baseRepo, worktreePath, expectedBranch });
  const npmTarget = fs.existsSync(path.join(worktreePath, 'package.json'))
    ? worktreePath
    : AUTOADAPT_ROOT;
  const npmResult = verifyNpmInstalled(npmTarget);

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