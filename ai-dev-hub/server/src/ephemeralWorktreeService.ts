import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync, execSync } from 'node:child_process';
import { Logger } from './logger.js';
import { ObservabilityService } from './observability/observabilityService.js';

export const DEFAULT_BRANCH_PREFIX = 'ephemeral';

export interface CreateWorktreeOptions {
  baseRepo: string;
  taskId?: string;
  branchPrefix?: string;
  branchName?: string;
  targetDir?: string;
  candidateLabel?: string;
  baseCommit?: string;
}

export interface EphemeralWorktreeInfo {
  worktreePath: string;
  branch: string;
  baseRepo: string;
  createdAt: string;
  isGitPointerValid: boolean;
}

export interface RemoveWorktreeOptions {
  baseRepo?: string;
  deleteBranch?: boolean;
  force?: boolean;
}

export interface WorktreeSandboxStatus {
  valid: boolean;
  dirExists: boolean;
  pointerValid: boolean;
  lockFree: boolean;
}

export interface WorktreePorcelainEntry {
  worktree: string;
  head: string;
  branch?: string;
  bare?: boolean;
}

/**
 * Normaliza caminhos para comparação independente de separadores de SO ou case.
 */
export function normalizePath(p: string): string {
  if (!p) return '';
  return path.resolve(p).replace(/\\/g, '/').toLowerCase();
}

/**
 * Faz o parse da saída `git worktree list --porcelain`.
 */
export function parseWorktreePorcelain(porcelainOutput: string): WorktreePorcelainEntry[] {
  if (!porcelainOutput || typeof porcelainOutput !== 'string') return [];
  const entries: WorktreePorcelainEntry[] = [];
  const blocks = porcelainOutput.trim().split(/\r?\n\r?\n/);

  for (const block of blocks) {
    if (!block.trim()) continue;
    const lines = block.split(/\r?\n/);
    const entry: Partial<WorktreePorcelainEntry> = {};

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

    if (entry.worktree && entry.head) {
      entries.push(entry as WorktreePorcelainEntry);
    }
  }

  return entries;
}

export class EphemeralWorktreeService {
  /**
   * Remove arquivos de lock obsoletos (.git/index.lock) caso tenham mais de 60 segundos.
   */
  static cleanStaleGitLocks(gitDirOrRepo: string): void {
    if (!gitDirOrRepo || !fs.existsSync(gitDirOrRepo)) return;

    const possibleLockFiles = [
      path.join(gitDirOrRepo, 'index.lock'),
      path.join(gitDirOrRepo, '.git', 'index.lock')
    ];

    for (const lockFile of possibleLockFiles) {
      if (fs.existsSync(lockFile)) {
        try {
          const lockStat = fs.statSync(lockFile);
          if (Date.now() - lockStat.mtimeMs > 60000) {
            fs.unlinkSync(lockFile);
            Logger.info(`[EphemeralWorktreeService] Lock obsoleto removido com sucesso: ${lockFile}`);
          }
        } catch (err: any) {
          Logger.warn(`[EphemeralWorktreeService] Falha ao verificar/remover lock ${lockFile}: ${err.message}`);
        }
      }
    }
  }

  /**
   * Valida a integridade, o ponteiro .git e a ausência de locks no sandbox.
   */
  static validateWorktreeSandbox(worktreePath: string): WorktreeSandboxStatus {
    const dirExists = Boolean(worktreePath && fs.existsSync(worktreePath));
    if (!dirExists) {
      return { valid: false, dirExists: false, pointerValid: false, lockFree: false };
    }

    const gitEntry = path.join(worktreePath, '.git');
    let pointerValid = false;
    let gitDir: string | null = null;

    if (fs.existsSync(gitEntry)) {
      try {
        const stat = fs.statSync(gitEntry);
        if (stat.isFile()) {
          const content = fs.readFileSync(gitEntry, 'utf8');
          const match = content.match(/gitdir:\s*(.+)/);
          if (match) {
            gitDir = path.resolve(worktreePath, match[1].trim());
            pointerValid = fs.existsSync(gitDir);
          }
        } else if (stat.isDirectory()) {
          gitDir = gitEntry;
          pointerValid = true;
        }
      } catch {
        pointerValid = false;
      }
    }

    let lockFree = false;
    if (pointerValid && gitDir && fs.existsSync(gitDir)) {
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
   * Cria um worktree efêmero isolado para execuções concorrentes ou isolamento de tarefas.
   * Suporta chamada flexível:
   *  - createEphemeralWorktree(projectPath, branchName)
   *  - createEphemeralWorktree(options)
   */
  static createEphemeralWorktree(
    baseRepoOrOptions: string | CreateWorktreeOptions,
    branchNameParam?: string,
    optionsParam?: Partial<CreateWorktreeOptions>
  ): EphemeralWorktreeInfo {
    const options: CreateWorktreeOptions = typeof baseRepoOrOptions === 'string'
      ? {
          baseRepo: baseRepoOrOptions,
          branchName: branchNameParam,
          ...optionsParam
        }
      : baseRepoOrOptions;

    const { baseRepo } = options;
    if (!baseRepo || !fs.existsSync(baseRepo)) {
      throw new Error(`Repositório base Git inválido ou inexistente: ${baseRepo}`);
    }

    const taskId = options.taskId || `task-${crypto.randomUUID().slice(0, 8)}`;
    const branchPrefix = options.branchPrefix || DEFAULT_BRANCH_PREFIX;
    const cleanTaskId = String(taskId).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 32);
    const candidateSlug = options.candidateLabel
      ? options.candidateLabel.toLowerCase().replace(/[^a-zA-Z0-9_-]/g, '-')
      : '';
    const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;

    const branchName = options.branchName || (
      candidateSlug
        ? `${branchPrefix}/${cleanTaskId}-${candidateSlug}-${uniqueSuffix}`
        : `${branchPrefix}/${cleanTaskId}-${uniqueSuffix}`
    );

    const worktreePath = options.targetDir
      ? path.resolve(options.targetDir)
      : path.resolve(os.tmpdir(), `decohub-ephemeral-${cleanTaskId}-${candidateSlug || 'sub'}-${uniqueSuffix}`);

    // Limpar locks obsoletos no repositório base
    this.cleanStaleGitLocks(baseRepo);

    // Se o diretório alvo já existe de execuções anteriores abortadas, removemos primeiro
    if (fs.existsSync(worktreePath)) {
      try {
        execFileSync('git', ['-C', baseRepo, 'worktree', 'remove', '--force', worktreePath], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe']
        });
      } catch {}
      try {
        fs.rmSync(worktreePath, { recursive: true, force: true });
      } catch {}
    }

    // Se o branch já existe, deletamos para garantir criação atômica limpa
    try {
      execFileSync('git', ['-C', baseRepo, 'branch', '-D', branchName], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch {}

    const baseCommit = options.baseCommit || 'HEAD';

    try {
      execFileSync(
        'git',
        ['-C', baseRepo, 'worktree', 'add', '-b', branchName, worktreePath, baseCommit],
        {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe']
        }
      );
    } catch (error: any) {
      // Fallback: tentar criar sem flag -b caso branch já exista
      try {
        execFileSync(
          'git',
          ['-C', baseRepo, 'worktree', 'add', worktreePath, branchName],
          {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe']
          }
        );
      } catch (fbErr: any) {
        throw new Error(`Falha ao criar git worktree efêmero em ${worktreePath}: ${error.message} (Fallback: ${fbErr.message})`);
      }
    }

    const sandboxStatus = this.validateWorktreeSandbox(worktreePath);

    ObservabilityService.emit({
      level: 'INFO',
      event: 'WORKTREE_CREATED',
      message: `Worktree efêmero criado em ${worktreePath} (branch: ${branchName})`,
      service: 'worktree',
      metadata: {
        worktreePath,
        branch: branchName,
        baseRepo: path.resolve(baseRepo),
        valid: sandboxStatus.valid
      }
    });

    return {
      worktreePath,
      branch: branchName,
      baseRepo: path.resolve(baseRepo),
      createdAt: new Date().toISOString(),
      isGitPointerValid: sandboxStatus.pointerValid
    };
  }

  /**
   * Desmonta e remove com segurança um worktree efêmero, garantindo zero resíduos e liberação de locks.
   */
  static removeWorktree(
    worktreePathOrInfo: string | EphemeralWorktreeInfo,
    options: RemoveWorktreeOptions = {}
  ): { cleaned: boolean; pathRemoved: boolean; branchDeleted: boolean } {
    let worktreePath: string;
    let baseRepo: string | undefined = options.baseRepo;
    let branch: string | undefined;

    if (typeof worktreePathOrInfo === 'string') {
      worktreePath = path.resolve(worktreePathOrInfo);
    } else {
      worktreePath = path.resolve(worktreePathOrInfo.worktreePath);
      baseRepo = baseRepo || worktreePathOrInfo.baseRepo;
      branch = branch || worktreePathOrInfo.branch;
    }

    const deleteBranch = options.deleteBranch ?? true;

    // Se o baseRepo não foi informado, tentar descobrir lendo o ponteiro .git
    if (!baseRepo && fs.existsSync(worktreePath)) {
      const gitEntry = path.join(worktreePath, '.git');
      if (fs.existsSync(gitEntry)) {
        try {
          const stat = fs.statSync(gitEntry);
          if (stat.isFile()) {
            const content = fs.readFileSync(gitEntry, 'utf8');
            const match = content.match(/gitdir:\s*(.+)/);
            if (match) {
              const gitDir = path.resolve(worktreePath, match[1].trim());
              // gitDir é <baseRepo>/.git/worktrees/<name>
              const worktreesDir = path.dirname(gitDir);
              const dotGitDir = path.dirname(worktreesDir);
              baseRepo = path.dirname(dotGitDir);
            }
          }
        } catch {}
      }
    }

    let pathRemoved = false;
    let branchDeleted = false;

    // 1. Remover worktree via git
    if (baseRepo && fs.existsSync(baseRepo)) {
      try {
        execFileSync('git', ['-C', baseRepo, 'worktree', 'remove', '--force', worktreePath], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe']
        });
        pathRemoved = !fs.existsSync(worktreePath);
      } catch {
        // Fallback para remoção direta do diretório
        if (fs.existsSync(worktreePath)) {
          try {
            fs.rmSync(worktreePath, { recursive: true, force: true });
            pathRemoved = !fs.existsSync(worktreePath);
          } catch {
            pathRemoved = false;
          }
        } else {
          pathRemoved = true;
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
    } else {
      // Sem baseRepo conhecido, tentar exclusão direta
      if (fs.existsSync(worktreePath)) {
        try {
          fs.rmSync(worktreePath, { recursive: true, force: true });
          pathRemoved = !fs.existsSync(worktreePath);
        } catch {
          pathRemoved = false;
        }
      } else {
        pathRemoved = true;
      }
    }

    ObservabilityService.emit({
      level: 'INFO',
      event: 'WORKTREE_REMOVED',
      message: `Worktree efêmero removido em ${worktreePath}`,
      service: 'worktree',
      metadata: {
        worktreePath,
        baseRepo,
        branch,
        pathRemoved,
        branchDeleted
      }
    });

    return {
      cleaned: pathRemoved && (!deleteBranch || !branch || branchDeleted),
      pathRemoved,
      branchDeleted
    };
  }

  /**
   * Helper RAII: Cria worktree, executa tarefa isolada, e garante limpeza estrita no `finally`.
   */
  static async withEphemeralWorktree<T>(
    options: CreateWorktreeOptions,
    taskFn: (sandbox: EphemeralWorktreeInfo) => Promise<T>
  ): Promise<T> {
    const sandbox = this.createEphemeralWorktree(options);
    try {
      return await taskFn(sandbox);
    } finally {
      this.removeWorktree(sandbox, { deleteBranch: true });
    }
  }

  /**
   * Lista todos os worktrees efêmeros atualmente registrados no repositório base.
   */
  static listEphemeralWorktrees(baseRepo: string, prefix = 'ephemeral/'): WorktreePorcelainEntry[] {
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

  /**
   * Executa poda de worktrees órfãos e limpeza de metadados.
   */
  static pruneOrphanedWorktrees(baseRepo: string): void {
    if (!baseRepo || !fs.existsSync(baseRepo)) return;
    try {
      execFileSync('git', ['-C', baseRepo, 'worktree', 'prune'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (err: any) {
      Logger.warn(`[EphemeralWorktreeService] Aviso ao podar worktrees em ${baseRepo}: ${err.message}`);
    }
  }
}
