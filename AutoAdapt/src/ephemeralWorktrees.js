import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { parseWorktreePorcelain, normalizePath } from './worktreeIsolation.js';

/**
 * Prefixo padrão de branches efêmeros.
 */
export const DEFAULT_BRANCH_PREFIX = 'ephemeral';

/**
 * Cria um worktree efêmero isolado para execução de tarefas sem risco de conflito ou lock residual.
 * @param {object} options
 * @param {string} options.baseRepo - Repositório Git base
 * @param {string} options.taskId - Identificador da tarefa
 * @param {string} [options.branchPrefix='ephemeral'] - Prefixo da branch
 * @param {string} [options.targetDir] - Diretório de destino customizado (opcional)
 * @returns {{
 *   worktreePath: string,
 *   branch: string,
 *   baseRepo: string,
 *   createdAt: string,
 *   isGitPointerValid: boolean
 * }}
 */
export function createEphemeralWorktree({
  baseRepo,
  taskId,
  branchPrefix = DEFAULT_BRANCH_PREFIX,
  targetDir = null
}) {
  if (!baseRepo || !fs.existsSync(baseRepo)) {
    throw new Error(`Repositório base Git inválido ou inexistente: ${baseRepo}`);
  }
  if (!taskId) {
    throw new Error('taskId é obrigatório para instanciar worktree efêmero.');
  }

  const cleanTaskId = String(taskId).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 32);
  const timestamp = Date.now();
  const branchName = `${branchPrefix}/task-${cleanTaskId}-${timestamp}`;

  const worktreePath = targetDir
    ? path.resolve(targetDir)
    : path.resolve(os.tmpdir(), `autoadapt-ephemeral-${cleanTaskId}-${timestamp}`);

  // Verificar se há lock residual obsoleto no repositório base
  const lockFile = path.join(baseRepo, '.git', 'index.lock');
  if (fs.existsSync(lockFile)) {
    try {
      const lockStat = fs.statSync(lockFile);
      // Se lock tiver mais de 60 segundos, é provavelmente processo zumbi
      if (Date.now() - lockStat.mtimeMs > 60000) {
        fs.unlinkSync(lockFile);
      }
    } catch {}
  }

  // Executar criação atômica do worktree git
  try {
    execFileSync('git', ['-C', baseRepo, 'worktree', 'add', '-b', branchName, worktreePath, 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (error) {
    throw new Error(`Falha ao criar git worktree efêmero em ${worktreePath}: ${error.message}`);
  }

  // Validação imediata do ponteiro .git
  const gitPointerPath = path.join(worktreePath, '.git');
  let isGitPointerValid = false;
  if (fs.existsSync(gitPointerPath)) {
    const content = fs.readFileSync(gitPointerPath, 'utf8');
    isGitPointerValid = content.includes('gitdir:');
  }

  return {
    worktreePath,
    branch: branchName,
    baseRepo: path.resolve(baseRepo),
    createdAt: new Date().toISOString(),
    isGitPointerValid
  };
}

/**
 * Valida a saúde e isolamento de um sandbox efêmero.
 * @param {string} worktreePath
 * @returns {{ valid: boolean, dirExists: boolean, pointerValid: boolean, lockFree: boolean }}
 */
export function validateWorktreeSandbox(worktreePath) {
  const dirExists = fs.existsSync(worktreePath);
  if (!dirExists) {
    return { valid: false, dirExists: false, pointerValid: false, lockFree: false };
  }

  const gitEntry = path.join(worktreePath, '.git');
  let pointerValid = false;
  let gitDir = null;

  if (fs.existsSync(gitEntry)) {
    try {
      const stat = fs.statSync(gitEntry);
      if (stat.isFile()) {
        const content = fs.readFileSync(gitEntry, 'utf8');
        pointerValid = content.includes('gitdir:');
        const match = content.match(/gitdir:\s*(.+)/);
        if (match) {
          gitDir = path.resolve(worktreePath, match[1].trim());
        }
      } else if (stat.isDirectory()) {
        pointerValid = true;
        gitDir = gitEntry;
      }
    } catch {
      pointerValid = false;
    }
  }

  let lockFree = true;
  if (gitDir && fs.existsSync(gitDir)) {
    const lockFile = path.join(gitDir, 'index.lock');
    lockFree = !fs.existsSync(lockFile);
  }

  return {
    valid: dirExists && pointerValid && lockFree,
    dirExists,
    pointerValid,
    lockFree
  };
}

/**
 * Desmonta e remove com segurança um worktree efêmero, garantindo zero resíduos e liberação de locks.
 * @param {object} worktreeInfo
 * @param {string} worktreeInfo.baseRepo
 * @param {string} worktreeInfo.worktreePath
 * @param {string} [worktreeInfo.branch]
 * @param {object} [options]
 * @param {boolean} [options.deleteBranch=true]
 * @returns {{ cleaned: boolean, pathRemoved: boolean, branchDeleted: boolean }}
 */
export function finalizeEphemeralWorktree(worktreeInfo, options = {}) {
  const { baseRepo, worktreePath, branch } = worktreeInfo;
  const deleteBranch = options.deleteBranch ?? true;

  let pathRemoved = false;
  let branchDeleted = false;

  // 1. Remover worktree via git
  try {
    execFileSync('git', ['-C', baseRepo, 'worktree', 'remove', '--force', worktreePath], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    pathRemoved = !fs.existsSync(worktreePath);
  } catch {
    // Fallback: remoção recursiva se o git worktree remove falhar
    if (fs.existsSync(worktreePath)) {
      try {
        fs.rmSync(worktreePath, { recursive: true, force: true });
        pathRemoved = !fs.existsSync(worktreePath);
      } catch {
        pathRemoved = false;
      }
    }
  }

  // 2. Podar referências git administrativas
  try {
    execFileSync('git', ['-C', baseRepo, 'worktree', 'prune'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch {}

  // 3. Deletar branch temporária se requisitado
  if (deleteBranch && branch) {
    try {
      execFileSync('git', ['-C', baseRepo, 'branch', '-D', branch], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
      });
      branchDeleted = true;
    } catch {
      branchDeleted = false;
    }
  }

  return {
    cleaned: pathRemoved && (!deleteBranch || branchDeleted),
    pathRemoved,
    branchDeleted
  };
}

/**
 * Helper com padrão "Resource Acquisition Is Initialization" (RAII):
 * Cria worktree, executa tarefa isolada, e garante limpeza estrita no `finally`.
 * 
 * @param {object} createOptions
 * @param {(sandbox: object) => Promise<any> | any} taskFn
 * @returns {Promise<any>}
 */
export async function withEphemeralSandbox(createOptions, taskFn) {
  const sandbox = createEphemeralWorktree(createOptions);
  try {
    const result = await taskFn(sandbox);
    return result;
  } finally {
    finalizeEphemeralWorktree(sandbox, { deleteBranch: true });
  }
}

/**
 * Lista todos os worktrees efêmeros atualmente registrados no repositório.
 * @param {string} baseRepo
 * @param {string} [prefix='ephemeral/']
 * @returns {Array<object>}
 */
export function listEphemeralWorktrees(baseRepo, prefix = 'ephemeral/') {
  try {
    const stdout = execFileSync('git', ['-C', baseRepo, 'worktree', 'list', '--porcelain'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const worktrees = parseWorktreePorcelain(stdout);
    return worktrees.filter(w => w.branch && w.branch.includes(prefix));
  } catch {
    return [];
  }
}

// Execução direta CLI
if (process.argv[1] && (process.argv[1].endsWith('ephemeralWorktrees.js') || process.argv[1].endsWith('ephemeralWorktrees'))) {
  console.log('[AutoAdapt] Módulo Ephemeral Worktrees (IMP-02) carregado com sucesso.');
  process.exitCode = 0;
}
