import { execSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { db, resolveProjectProfileMode } from './db.js';
import { Logger } from './logger.js';

export interface GitFileStatus {
  path: string;
  status: 'modified' | 'new' | 'deleted' | 'renamed' | 'other';
}

export interface GitInfo {
  isGitRepo: boolean;
  branch: string | null;
  lastCommit: {
    hash: string;
    message: string;
    author: string;
    date: string;
  } | null;
  statusSummary: {
    modified: number;
    newFiles: number;
    deleted: number;
    total: number;
  };
  changedFiles: GitFileStatus[];
  error?: string;
}

export class GitManager {
  private static githubStatusCache: {
    data: { configured: boolean; authenticated: boolean; source: string; username: string | null; scopes: string[] };
    expiresAt: number;
  } | null = null;

  public static getSafeGitEnv(extraEnv?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    return {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GIT_PAGER: 'cat',
      GCM_INTERACTIVE: 'never',
      GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME || 'DecoHUB Agent',
      GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL || 'agent@decohub.local',
      GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME || 'DecoHUB Agent',
      GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL || 'agent@decohub.local',
      ...(extraEnv || {})
    };
  }

  public static cleanupOrphanIndexLock(repoPath: string, maxAgeMs = 1500): boolean {
    try {
      if (!repoPath || !fs.existsSync(repoPath)) return false;

      const directGitDir = path.join(repoPath, '.git');
      const lockFiles: string[] = [];

      // Checa se o repoPath já é o próprio .git
      if (fs.existsSync(path.join(repoPath, 'index.lock'))) {
        lockFiles.push(path.join(repoPath, 'index.lock'));
      }
      if (fs.existsSync(path.join(repoPath, 'HEAD.lock'))) {
        lockFiles.push(path.join(repoPath, 'HEAD.lock'));
      }

      if (fs.existsSync(directGitDir)) {
        const stat = fs.statSync(directGitDir);
        if (stat.isDirectory()) {
          lockFiles.push(path.join(directGitDir, 'index.lock'));
          lockFiles.push(path.join(directGitDir, 'HEAD.lock'));
          const worktreesDir = path.join(directGitDir, 'worktrees');
          if (fs.existsSync(worktreesDir) && fs.statSync(worktreesDir).isDirectory()) {
            for (const sub of fs.readdirSync(worktreesDir)) {
              lockFiles.push(path.join(worktreesDir, sub, 'index.lock'));
              lockFiles.push(path.join(worktreesDir, sub, 'HEAD.lock'));
            }
          }
        } else if (stat.isFile()) {
          const content = fs.readFileSync(directGitDir, 'utf-8').trim();
          const match = content.match(/^gitdir:\s*(.+)$/i);
          if (match && match[1]) {
            const resolvedGitDir = path.isAbsolute(match[1]) ? match[1] : path.resolve(repoPath, match[1]);
            lockFiles.push(path.join(resolvedGitDir, 'index.lock'));
            lockFiles.push(path.join(resolvedGitDir, 'HEAD.lock'));
          }
        }
      }

      let removedAny = false;
      const now = Date.now();
      for (const lockPath of lockFiles) {
        if (fs.existsSync(lockPath)) {
          try {
            const lockStat = fs.statSync(lockPath);
            const ageMs = now - lockStat.mtimeMs;
            if (ageMs > maxAgeMs) {
              fs.unlinkSync(lockPath);
              Logger.warn(`[GitManager] Trava órfã de Git removida: ${lockPath} (idade: ${Math.round(ageMs / 1000)}s)`);
              removedAny = true;
            }
          } catch (e: any) {
            Logger.warn(`[GitManager] Falha ao tentar remover trava órfã ${lockPath}: ${e.message}`);
          }
        }
      }
      return removedAny;
    } catch {
      return false;
    }
  }

  public static safeExecSync(cmd: string, options: { cwd?: string; timeout?: number; env?: NodeJS.ProcessEnv; stdio?: any; encoding?: BufferEncoding } = {}): string {
    const cwd = options.cwd || process.cwd();
    this.cleanupOrphanIndexLock(cwd);
    const env = this.getSafeGitEnv(options.env);
    const timeout = options.timeout ?? 8000;
    return execSync(cmd, {
      cwd,
      timeout,
      env,
      stdio: options.stdio ?? ['pipe', 'pipe', 'ignore'],
      encoding: options.encoding ?? 'utf-8'
    }).toString().trim();
  }

  public static safeExecFileSync(file: string, args: string[], options: { cwd?: string; timeout?: number; env?: NodeJS.ProcessEnv; stdio?: any; encoding?: BufferEncoding } = {}): string {
    const cwd = options.cwd || process.cwd();
    if (file === 'git' || file.endsWith('git') || file.endsWith('git.exe')) {
      this.cleanupOrphanIndexLock(cwd);
    }
    const env = this.getSafeGitEnv(options.env);
    const timeout = options.timeout ?? 10000;
    return execFileSync(file, args, {
      cwd,
      timeout,
      env,
      stdio: options.stdio ?? 'pipe',
      encoding: options.encoding ?? 'utf-8'
    }).toString().trim();
  }
  static getGitInfo(projectPath: string): GitInfo {
    const gitDir = path.join(projectPath, '.git');
    if (!fs.existsSync(gitDir)) {
      return {
        isGitRepo: false,
        branch: null,
        lastCommit: null,
        statusSummary: { modified: 0, newFiles: 0, deleted: 0, total: 0 },
        changedFiles: []
      };
    }

    try {
      // 1. Branch
      let branch = 'unknown';
      try {
        branch = this.safeExecSync('git branch --show-current', {
          cwd: projectPath,
          timeout: 4000
        });
        if (!branch) {
          branch = this.safeExecSync('git rev-parse --abbrev-ref HEAD', {
            cwd: projectPath,
            timeout: 4000
          });
        }
      } catch {
        branch = 'HEAD (detached or initial)';
      }

      // 2. Last commit
      let lastCommit = null;
      try {
        const logOutput = this.safeExecSync('git log -1 --pretty=format:"%h|%s|%an|%ad" --date=short', {
          cwd: projectPath,
          timeout: 4000
        });

        if (logOutput) {
          const [hash, message, author, date] = logOutput.split('|');
          lastCommit = {
            hash: hash || '',
            message: message || '',
            author: author || '',
            date: date || ''
          };
        }
      } catch {
        // May have no commits yet
        lastCommit = null;
      }

      // 3. Status porcelain
      let porcelain = '';
      try {
        porcelain = this.safeExecSync('git status --porcelain', {
          cwd: projectPath,
          timeout: 5000
        });
      } catch {
        porcelain = '';
      }

      const changedFiles: GitFileStatus[] = [];
      let modified = 0;
      let newFiles = 0;
      let deleted = 0;

      if (porcelain) {
        const lines = porcelain.split(/\r?\n/);
        for (const line of lines) {
          if (!line || line.length < 3) continue;
          const indexCode = line[0];
          const workTreeCode = line[1];
          const filePath = line.substring(3).trim();

          let statusType: GitFileStatus['status'] = 'other';

          if (indexCode === '?' || workTreeCode === '?') {
            statusType = 'new';
            newFiles++;
          } else if (indexCode === 'D' || workTreeCode === 'D') {
            statusType = 'deleted';
            deleted++;
          } else if (indexCode === 'M' || workTreeCode === 'M') {
            statusType = 'modified';
            modified++;
          } else if (indexCode === 'A' || workTreeCode === 'A') {
            statusType = 'new';
            newFiles++;
          } else if (indexCode === 'R' || workTreeCode === 'R') {
            statusType = 'renamed';
            modified++;
          } else {
            statusType = 'other';
            modified++;
          }

          changedFiles.push({
            path: filePath,
            status: statusType
          });
        }
      }

      return {
        isGitRepo: true,
        branch,
        lastCommit,
        statusSummary: {
          modified,
          newFiles,
          deleted,
          total: modified + newFiles + deleted
        },
        changedFiles
      };
    } catch (err: any) {
      return {
        isGitRepo: true,
        branch: null,
        lastCommit: null,
        statusSummary: { modified: 0, newFiles: 0, deleted: 0, total: 0 },
        changedFiles: [],
        error: err.message
      };
    }
  }

  static checkoutOrCreateBranch(projectPath: string, branchName: string): boolean {
    try {
      this.safeExecSync(`git checkout -B "${branchName}"`, { cwd: projectPath, timeout: 8000 });
      return true;
    } catch {
      return false;
    }
  }

  static commitAll(projectPath: string, message: string): boolean {
    try {
      const root = path.resolve(projectPath);
      this.safeExecFileSync('git', ['add', '-A'], { cwd: root, timeout: 10000 });
      if (fs.existsSync(path.join(root, '.decohub-data'))) {
        try {
          this.safeExecFileSync('git', ['reset', 'HEAD', '--', '.decohub-data'], { cwd: root, timeout: 5000 });
        } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "gitManager",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:gitManager]", err);
      }
    }
      }
      const diff = this.safeExecFileSync('git', ['diff', '--cached', '--name-only'], { cwd: root, timeout: 5000 });
      if (!diff) return true;
      this.safeExecFileSync('git', ['commit', '-m', message], { cwd: root, timeout: 10000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Normalizes a file path to be repo-relative using forward slashes.
   * Returns null if path is outside project, points to forbidden directories, or is not a real project file.
   */
  static normalizeRepoPath(projectPath: string, rawFile: string): string | null {
    if (!rawFile || typeof rawFile !== 'string') return null;
    const trimmed = rawFile.trim();
    if (!trimmed || trimmed.includes('\n') || trimmed.includes('\r')) return null;

    const root = path.resolve(projectPath);
    let resolved: string;
    if (path.isAbsolute(trimmed)) {
      resolved = path.resolve(trimmed);
    } else {
      resolved = path.resolve(root, trimmed);
    }

    // Must be inside the repository root
    const rel = path.relative(root, resolved).replace(/\\/g, '/');
    if (!rel || rel === '.' || rel === '..' || rel.startsWith('../') || path.isAbsolute(rel)) {
      return null;
    }

    if (rel.startsWith('.git/') || rel.startsWith('node_modules/') || rel.startsWith('.decohub-data/') || rel === '.decohub-data') {
      return null;
    }

    return rel;
  }

  /**
   * Asserts workspace isolation before worker begins work on a project.
   * Throws WORKSPACE_MISMATCH if checks fail.
   */
  static assertExecutionWorkspace(projectPath: string, runtime?: { cwd?: string }): { root: string; gitRoot: string } {
    const resolvedPath = path.resolve(projectPath);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`WORKSPACE_MISMATCH: caminho do projeto não existe: "${projectPath}"`);
    }

    let gitRoot: string;
    try {
      gitRoot = this.safeExecFileSync('git', ['rev-parse', '--show-toplevel'], {
        cwd: resolvedPath,
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 5000
      });
    } catch {
      throw new Error(`WORKSPACE_MISMATCH: projeto não possui raiz git válida: "${projectPath}"`);
    }

    if (path.resolve(gitRoot).toLowerCase() !== resolvedPath.toLowerCase()) {
      throw new Error(`WORKSPACE_MISMATCH: raiz git "${gitRoot}" diverge do caminho esperado "${resolvedPath}"`);
    }

    if (runtime?.cwd) {
      const runtimeCwd = path.resolve(runtime.cwd);
      if (runtimeCwd.toLowerCase() !== resolvedPath.toLowerCase()) {
        throw new Error(`WORKSPACE_MISMATCH: runtime cwd "${runtimeCwd}" diverge do projeto "${resolvedPath}"`);
      }
    }

    return { root: resolvedPath, gitRoot: path.resolve(gitRoot) };
  }

  static commitSelected(projectPath: string, files: string[], message: string): boolean {
    try {
      const root = path.resolve(projectPath);
      const selected = [...new Set(
        files
          .map(f => this.normalizeRepoPath(root, f))
          .filter((f): f is string => Boolean(f))
      )].filter(file => {
        // Exclude explicitly protected and forbidden patterns
        if (
          file.startsWith('dist/') ||
          file.startsWith('node_modules/') ||
          file.startsWith('.git/') ||
          file.startsWith('.decohub-data/') ||
          /(^|\/)\.env(\.|$)/i.test(file) ||
          /\.(pem|key)$/i.test(file) ||
          /(^|\/)hub\.db(-wal|-shm)?$/i.test(file)
        ) {
          return false;
        }

        const fullPath = path.join(root, file);
        if (fs.existsSync(fullPath)) {
          // Check if file is ignored by git (.gitignore)
          try {
            this.safeExecFileSync('git', ['check-ignore', '-q', '--', file], { cwd: root, stdio: 'ignore' });
            return false; // Exit code 0 means file IS ignored
          } catch {
            return true; // Exit code 1 means NOT ignored
          }
        }
        try {
          this.safeExecFileSync('git', ['ls-files', '--error-unmatch', '--', file], { cwd: root, stdio: 'ignore' });
          return true;
        } catch { return false; }
      });

      if (selected.length === 0) return false;

      // Add files with --ignore-errors
      try {
        this.safeExecFileSync('git', ['add', '--ignore-errors', '--', ...selected], { cwd: root, timeout: 15000 });
      } catch (addErr: any) {
        Logger.warn(`[GitManager] Adição em lote falhou (${addErr.message}), tentando individualmente...`);
        for (const file of selected) {
          try {
            this.safeExecFileSync('git', ['add', '--ignore-errors', '--', file], { cwd: root, timeout: 5000, stdio: 'ignore' });
          } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "gitManager",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:gitManager]", err);
      }
    }
        }
      }

      try {
        this.safeExecFileSync('git', ['diff', '--cached', '--check'], { cwd: root, timeout: 10000 });
      } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "gitManager",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:gitManager]", err);
      }
    }

      const staged = this.safeExecFileSync('git', ['diff', '--cached', '--name-only'], { cwd: root, timeout: 10000 });
      if (!staged) return false;

      this.safeExecFileSync('git', ['commit', '-m', message], { cwd: root, timeout: 20000 });
      return true;
    } catch (err: any) {
      Logger.warn(`[GitManager] Commit seletivo falhou: ${err.message}`);
      return false;
    }
  }

  /**
   * Executa rollback seguro de alterações corrompidas / não commitadas
   * restaurando a árvore de trabalho para o último estado íntegro conhecido.
   * Executa:
   * 1. git checkout -- . (descarta modificações em arquivos rastreados)
   * 2. git clean -fd (remove arquivos e diretórios não rastreados criados pelo worker)
   * 3. Se targetCommitSha for especificado e HEAD estiver divergente, alinha ao commit indicado.
   */
  static rollbackUncommittedChanges(projectPath: string, targetCommitSha?: string | null): boolean {
    const root = path.resolve(projectPath);
    if (!fs.existsSync(path.join(root, '.git'))) return false;

    this.cleanupOrphanIndexLock(root);

    try {
      // 1. Restaurar arquivos rastreados modificados
      this.safeExecFileSync('git', ['checkout', '--', '.'], { cwd: root, timeout: 15000 });

      // 2. Limpar arquivos e diretórios não rastreados
      this.safeExecFileSync('git', ['clean', '-fd'], { cwd: root, timeout: 15000 });

      // 3. Se targetCommitSha for especificado e HEAD estiver divergente, restaurar para o targetCommitSha
      if (targetCommitSha) {
        try {
          const currentHead = this.safeExecFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, timeout: 5000 }).trim();
          if (currentHead && currentHead !== targetCommitSha) {
            this.safeExecFileSync('git', ['reset', '--hard', targetCommitSha], { cwd: root, timeout: 15000 });
            this.safeExecFileSync('git', ['clean', '-fd'], { cwd: root, timeout: 15000 });
          }
        } catch {}
      }

      Logger.info(`[GitManager] Rollback seguro executado com sucesso em ${root}`);
      return true;
    } catch (err: any) {
      Logger.warn(`[GitManager] Falha no rollback seguro em ${root}: ${err.message}`);
      return false;
    }
  }

  /**
   * Retorna a lista de remotes configurados no repositório Git.
   */
  static getRemotes(projectPath: string): string[] {
    try {
      const out = this.safeExecFileSync('git', ['remote'], {
        cwd: projectPath,
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      return out.split(/\r?\n/).map(r => r.trim()).filter(Boolean);
    } catch {
      return [];
    }
  }

  /**
   * Verifica se o repositório Git possui o remote especificado (padrão: 'origin').
   */
  static hasRemote(projectPath: string, remoteName = 'origin'): boolean {
    const remotes = this.getRemotes(projectPath);
    return remotes.includes(remoteName);
  }

  /**
   * Determina se operações de push devem ser ignoradas (sem remote configurado ou projeto local_personal).
   */
  static shouldSkipPush(projectPath: string, projectId?: string): { skip: boolean; reason: string; isLocal: boolean; hasRemote: boolean } {
    let isLocal = false;
    try {
      const profile = projectId ? resolveProjectProfileMode(projectId) : resolveProjectProfileMode(projectPath);
      if (profile === 'local_personal') isLocal = true;
    } catch {}

    const remotes = this.getRemotes(projectPath);
    const hasOrigin = remotes.includes('origin');
    const hasAnyRemote = remotes.length > 0;

    if (isLocal) {
      return {
        skip: true,
        reason: 'Projeto classificado como Ferramenta Local / Meu Trabalho (local_personal). Push ignorado.',
        isLocal: true,
        hasRemote: hasAnyRemote
      };
    }

    if (!hasAnyRemote) {
      return {
        skip: true,
        reason: 'Nenhum remote Git configurado no repositório.',
        isLocal: false,
        hasRemote: false
      };
    }

    if (!hasOrigin) {
      return {
        skip: true,
        reason: 'Remote "origin" não encontrado no repositório.',
        isLocal: false,
        hasRemote: false
      };
    }

    return {
      skip: false,
      reason: 'Remote origin válido e configurado.',
      isLocal: false,
      hasRemote: true
    };
  }

  static pushBranch(projectPath: string, branchName: string): boolean {
    try {
      const skipCheck = this.shouldSkipPush(projectPath);
      if (skipCheck.skip) {
        Logger.info(`[GitManager] Push ignorado para branch "${branchName}" em "${projectPath}": ${skipCheck.reason}`);
        return false;
      }

      const token = this.getStoredGitHubToken();
      const envWithToken = token
        ? { ...process.env, GITHUB_TOKEN: token, GH_TOKEN: token, GITHUB_PERSONAL_ACCESS_TOKEN: token }
        : process.env;

      this.safeExecFileSync('git', ['push', '-u', 'origin', branchName], {
        cwd: projectPath,
        timeout: 30000,
        env: envWithToken,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      return true;
    } catch (err: any) {
      Logger.warn(`[GitManager] Push branch ${branchName} falhou: ${err.message}`);
      return false;
    }
  }

  static verifyRemoteBranch(projectPath: string, branchName: string, expectedSha?: string): boolean {
    try {
      const token = this.getStoredGitHubToken();
      const envWithToken = token
        ? { ...process.env, GITHUB_TOKEN: token, GH_TOKEN: token, GITHUB_PERSONAL_ACCESS_TOKEN: token }
        : process.env;

      const out = execFileSync('git', ['ls-remote', '--heads', 'origin', branchName], {
        cwd: projectPath,
        encoding: 'utf-8',
        timeout: 15000,
        env: envWithToken,
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim();

      if (!out) return false;
      if (expectedSha) {
        return out.toLowerCase().startsWith(expectedSha.toLowerCase());
      }
      return true;
    } catch {
      return false;
    }
  }

  static getCommitDetails(projectPath: string, commitSha = 'HEAD'): { sha: string; message: string; author: string; date: string } | null {
    try {
      const sha = this.safeExecFileSync('git', ['rev-parse', '--verify', commitSha], {
        cwd: projectPath,
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 5000
      });
      const message = this.safeExecFileSync('git', ['log', '-1', '--pretty=format:%B', sha], {
        cwd: projectPath,
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 5000
      });
      const author = this.safeExecFileSync('git', ['log', '-1', '--pretty=format:%an', sha], {
        cwd: projectPath,
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 5000
      });
      const date = this.safeExecFileSync('git', ['log', '-1', '--pretty=format:%cI', sha], {
        cwd: projectPath,
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 5000
      });
      return { sha, message, author, date };
    } catch {
      return null;
    }
  }

  static checkout(projectPath: string, branchName: string): boolean {
    try {
      this.safeExecSync(`git checkout "${branchName}"`, { cwd: projectPath, timeout: 8000 });
      return true;
    } catch {
      return false;
    }
  }

  static pull(projectPath: string, branchName: string = 'main'): boolean {
    try {
      this.safeExecSync(`git pull origin "${branchName}"`, { cwd: projectPath, timeout: 15000 });
      return true;
    } catch {
      return false;
    }
  }

  static getUnifiedDiff(projectPath: string, filePath?: string): {
    diff: string;
    files: Array<{ file: string; additions: number; deletions: number; status: string }>;
    rawSummary: string;
  } {
    const gitDir = path.join(projectPath, '.git');
    if (!fs.existsSync(gitDir)) {
      return { diff: '', files: [], rawSummary: 'Não é um repositório Git' };
    }

    try {
      let hasHead = false;
      try {
        this.safeExecSync('git rev-parse --verify HEAD', { cwd: projectPath, timeout: 3000 });
        hasHead = true;
      } catch {
        hasHead = false;
      }

      const diffCmd = filePath
        ? (hasHead ? `git diff HEAD -- "${filePath}"` : `git diff -- "${filePath}"`)
        : (hasHead ? 'git diff HEAD' : 'git diff');

      let diff = '';
      try {
        diff = this.safeExecSync(diffCmd, { cwd: projectPath, timeout: 5000 });
      } catch {
        diff = '';
      }

      let numstatOutput = '';
      try {
        const numstatCmd = hasHead ? 'git diff HEAD --numstat' : 'git diff --numstat';
        numstatOutput = this.safeExecSync(numstatCmd, { cwd: projectPath, timeout: 5000 });
      } catch {
        numstatOutput = '';
      }

      const files: Array<{ file: string; additions: number; deletions: number; status: string }> = [];
      if (numstatOutput) {
        const lines = numstatOutput.split(/\r?\n/).filter(Boolean);
        for (const line of lines) {
          const parts = line.split('\t');
          if (parts.length >= 3) {
            const add = parseInt(parts[0], 10) || 0;
            const del = parseInt(parts[1], 10) || 0;
            const fName = parts[2];
            files.push({ file: fName, additions: add, deletions: del, status: 'modified' });
          }
        }
      }

      // Include untracked files
      try {
        const untracked = this.safeExecSync('git ls-files --others --exclude-standard', { cwd: projectPath, timeout: 5000 });
        if (untracked) {
          const uLines = untracked.split(/\r?\n/).filter(Boolean);
          for (const u of uLines) {
            if (!files.some(f => f.file === u)) {
              let lineCount = 0;
              try {
                const fullP = path.join(projectPath, u);
                if (fs.existsSync(fullP) && !fs.statSync(fullP).isDirectory()) {
                  const content = fs.readFileSync(fullP, 'utf-8');
                  lineCount = content.split('\n').length;
                }
              } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "gitManager",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:gitManager]", err);
      }
    }
              files.push({ file: u, additions: lineCount, deletions: 0, status: 'untracked' });

              if (!filePath || filePath === u) {
                try {
                  const fullP = path.join(projectPath, u);
                  if (fs.existsSync(fullP) && !fs.statSync(fullP).isDirectory()) {
                    const c = fs.readFileSync(fullP, 'utf-8');
                    diff += `\n--- /dev/null\n+++ b/${u}\n@@ -0,0 +1,${lineCount} @@\n` + c.split('\n').map(l => `+${l}`).join('\n');
                  }
                } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "gitManager",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:gitManager]", err);
      }
    }
              }
            }
          }
        }
      } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "gitManager",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:gitManager]", err);
      }
    }

      let rawSummary = '';
      try {
        rawSummary = this.safeExecSync(hasHead ? 'git diff HEAD --stat' : 'git status -s', { cwd: projectPath, timeout: 5000 });
      } catch {
        rawSummary = `${files.length} arquivo(s) modificado(s)`;
      }

      return { diff: diff.trim(), files, rawSummary: rawSummary.trim() };
    } catch (err: any) {
      return { diff: '', files: [], rawSummary: `Erro ao obter diff: ${err.message}` };
    }
  }

  // --- SECURE TOKEN STORAGE (AES-256-GCM) ---
  private static getMasterKey(): Buffer {
    const machineSeed = `${os.hostname()}-${os.userInfo().username}-decohub-secure-master-key`;
    return crypto.scryptSync(machineSeed, 'decohub-salt-v1', 32);
  }

  static encryptToken(plainText: string): string {
    if (!plainText) return '';
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.getMasterKey(), iv);
    const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
  }

  static decryptToken(cipherText: string): string {
    if (!cipherText || !cipherText.includes(':')) return '';
    try {
      const parts = cipherText.split(':');
      if (parts.length !== 3) return '';
      const iv = Buffer.from(parts[0], 'hex');
      const tag = Buffer.from(parts[1], 'hex');
      const encrypted = Buffer.from(parts[2], 'hex');
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.getMasterKey(), iv);
      decipher.setAuthTag(tag);
      return decipher.update(encrypted) + decipher.final('utf8');
    } catch {
      return '';
    }
  }

  static storeGitHubToken(token: string): void {
    this.githubStatusCache = null; // Invalida cache de status GitHub
    const encrypted = this.encryptToken(token.trim());
    const nowIso = new Date().toISOString();
    db.prepare(`
      INSERT INTO system_settings (key, value, updated_at)
      VALUES ('github_pat_encrypted', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(encrypted, nowIso);
  }

  static getStoredGitHubToken(): string | null {
    // 1. Prioritize official GitHub CLI auth if logged in
    try {
      const token = execSync('gh auth token', { encoding: 'utf-8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (token && token.length > 5) return token;
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "gitManager",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:gitManager]", err);
      }
    }

    // 2. Fallback to encrypted stored token in system_settings
    try {
      const row: any = db.prepare("SELECT value FROM system_settings WHERE key = 'github_pat_encrypted'").get();
      if (row?.value) {
        const decrypted = this.decryptToken(row.value);
        if (decrypted) return decrypted;
      }
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "gitManager",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:gitManager]", err);
      }
    }

    // 3. Fallback to environment variables
    if (process.env.GITHUB_PERSONAL_ACCESS_TOKEN) {
      return process.env.GITHUB_PERSONAL_ACCESS_TOKEN.trim();
    }
    if (process.env.GITHUB_TOKEN) {
      return process.env.GITHUB_TOKEN.trim();
    }

    return null;
  }

  static getGitHubStatus(): { configured: boolean; authenticated: boolean; source: string; username: string | null; scopes: string[] } {
    const now = Date.now();
    if (this.githubStatusCache && this.githubStatusCache.expiresAt > now) {
      return { ...this.githubStatusCache.data };
    }

    let token = '';
    let source = 'NONE';

    try {
      const row: any = db.prepare("SELECT value FROM system_settings WHERE key = 'github_pat_encrypted'").get();
      if (row?.value) {
        token = this.decryptToken(row.value);
        if (token) source = 'STORED_TOKEN';
      }
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "gitManager",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:gitManager]", err);
      }
    }

    if (!token && process.env.GITHUB_PERSONAL_ACCESS_TOKEN) {
      token = process.env.GITHUB_PERSONAL_ACCESS_TOKEN.trim();
      source = 'ENV';
    }

    // Se o token já existe no banco (STORED_TOKEN) ou em process.env (ENV), NÃO executa execSync bloqueante
    if (token && (source === 'STORED_TOKEN' || source === 'ENV')) {
      const result = {
        configured: true,
        authenticated: true,
        source,
        username: 'deco-verc',
        scopes: ['repo', 'workflow']
      };
      this.githubStatusCache = { data: result, expiresAt: now + 60000 };
      return result;
    }

    if (!token) {
      try {
        const ghToken = execSync('gh auth token', { encoding: 'utf-8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        if (ghToken) {
          token = ghToken;
          source = 'GH_CLI';
        }
      } catch (err) {
        if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
          (globalThis as any).logger.warn({
            event: "server.handled_exception",
            file: "gitManager",
            error: (err as any)?.message || String(err)
          });
        } else {
          console.warn("[WARN][server:gitManager]", err);
        }
      }
    }

    if (!token) {
      const result = { configured: false, authenticated: false, source: 'NONE', username: null, scopes: [] };
      this.githubStatusCache = { data: result, expiresAt: now + 60000 };
      return result;
    }

    try {
      let username: string | null = null;
      const scopes: string[] = ['repo', 'workflow'];

      try {
        const res = execSync('gh api user --jq .login', { encoding: 'utf-8', timeout: 3000, env: { ...process.env, GITHUB_TOKEN: token }, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        if (res) username = res;
      } catch (err) {
        if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
          (globalThis as any).logger.warn({
            event: "server.handled_exception",
            file: "gitManager",
            error: (err as any)?.message || String(err)
          });
        } else {
          console.warn("[WARN][server:gitManager]", err);
        }
      }

      const result = {
        configured: true,
        authenticated: Boolean(username || token.startsWith('gh')),
        source,
        username: username || 'deco-verc',
        scopes
      };
      this.githubStatusCache = { data: result, expiresAt: now + 60000 };
      return result;
    } catch {
      const fallbackResult = { configured: true, authenticated: false, source, username: null, scopes: [] };
      this.githubStatusCache = { data: fallbackResult, expiresAt: now + 60000 };
      return fallbackResult;
    }
  }

  // --- GIT HYGIENE (.gitignore) ---
  static ensureGitIgnore(projectPath: string): void {
    const gitignorePath = path.join(projectPath, '.gitignore');
    let existing = '';
    if (fs.existsSync(gitignorePath)) {
      existing = fs.readFileSync(gitignorePath, 'utf-8');
    }

    const lines = existing.split(/\r?\n/).map(l => l.trim());
    const criticalRules = [
      '.env',
      '*.env',
      '.env.*',
      '*.key',
      '*.pem',
      'credentials.json',
      'token.json',
      'hub.db',
      'hub.db-wal',
      'hub.db-shm',
      'node_modules/',
      'dist/',
      '.gemini/'
    ];

    const missing = criticalRules.filter(r => !lines.includes(r));
    if (missing.length > 0 || !fs.existsSync(gitignorePath)) {
      const addition = (existing && !existing.endsWith('\n') ? '\n\n' : existing ? '\n' : '') +
        '# Segredos e Cache protegidos pelo DecoHUB\n' +
        missing.join('\n') + '\n';
      fs.appendFileSync(gitignorePath, addition, 'utf-8');
      Logger.info(`[GitManager] .gitignore atualizado com proteção de segredos em ${projectPath}`);
    }
  }

  // --- GIT REPOSITORY INTEGRITY ---
  static ensureRepository(projectPath: string): boolean {
    if (!projectPath || !fs.existsSync(projectPath)) return false;
    this.ensureGitIgnore(projectPath);

    const gitDir = path.join(projectPath, '.git');
    if (!fs.existsSync(gitDir)) {
      try {
        try {
          this.safeExecSync('git init -b main', { cwd: projectPath, timeout: 5000 });
        } catch {
          this.safeExecSync('git init', { cwd: projectPath, timeout: 5000 });
          try {
            this.safeExecSync('git branch -M main', { cwd: projectPath, timeout: 5000 });
          } catch {}
        }
        Logger.info(`[GitManager] Repositório Git inicializado em ${projectPath}`);
      } catch (err: any) {
        Logger.warn(`[GitManager] Falha ao inicializar git em ${projectPath}: ${err.message}`);
        return false;
      }
    }

    // Ensure initial HEAD commit exists
    let hasHead = false;
    try {
      this.safeExecSync('git rev-parse --verify HEAD', { cwd: projectPath, timeout: 3000 });
      hasHead = true;
    } catch {
      hasHead = false;
    }

    if (!hasHead) {
      try {
        this.safeExecSync('git add -A', { cwd: projectPath, timeout: 4000 });
        this.safeExecSync('git commit -m "chore: initial project structure with DecoHUB memory"', { cwd: projectPath, timeout: 5000 });
      } catch {
        try {
          this.safeExecSync('git config user.email "agent@decohub.local" && git config user.name "DecoHUB Agent"', { cwd: projectPath, timeout: 3000 });
          this.safeExecSync('git commit -m "chore: initial project structure with DecoHUB memory"', { cwd: projectPath, timeout: 5000 });
        } catch (err: any) {
          Logger.warn(`[GitManager] Aviso ao criar commit inicial em ${projectPath}: ${err.message}`);
        }
      }
    }

    return true;
  }

  // --- GITHUB REPO SETUP ---
  static async setupGitHubRepository(projectPath: string, options: {
    action: 'create_private' | 'link_existing';
    repoNameOrUrl: string;
    token?: string;
  }): Promise<{ success: boolean; repoFullName: string; repoUrl: string; error?: string }> {
    const { action, repoNameOrUrl, token } = options;

    if (token) {
      this.storeGitHubToken(token);
    }

    const effectiveToken = token || this.getStoredGitHubToken();
    const envWithToken = effectiveToken ? { ...process.env, GITHUB_TOKEN: effectiveToken, GITHUB_PERSONAL_ACCESS_TOKEN: effectiveToken } : process.env;

    const gitDir = path.join(projectPath, '.git');
    if (!fs.existsSync(gitDir)) {
      this.safeExecSync('git init -b main', { cwd: projectPath, timeout: 5000 });
    }

    // Always protect secrets BEFORE staging or pushing
    this.ensureGitIgnore(projectPath);

    let repoFullName = repoNameOrUrl.trim().replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '');

    if (action === 'create_private') {
      try {
        let ghUser = 'deco-verc';
        try {
          const userOut = this.safeExecSync('gh api user --jq .login', { timeout: 6000, env: envWithToken });
          if (userOut) ghUser = userOut;
        } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "gitManager",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:gitManager]", err);
      }
    }

        const cleanRepoName = repoFullName.includes('/') ? repoFullName.split('/')[1] : repoFullName;
        repoFullName = `${ghUser}/${cleanRepoName}`;

        Logger.info(`[GitManager] Criando repositório privado no GitHub: ${repoFullName}...`);
        try {
          this.safeExecSync(`gh repo create "${repoFullName}" --private`, { cwd: projectPath, timeout: 20000, env: envWithToken });
        } catch (createErr: any) {
          if (!createErr.message?.includes('already exists')) {
            Logger.warn(`[GitManager] Aviso ao criar repo via gh: ${createErr.message}`);
          }
        }

        const remoteUrl = `https://github.com/${repoFullName}.git`;
        try {
          this.safeExecSync(`git remote add origin "${remoteUrl}"`, { cwd: projectPath, timeout: 5000 });
        } catch {
          this.safeExecSync(`git remote set-url origin "${remoteUrl}"`, { cwd: projectPath, timeout: 5000 });
        }

        // Commit initial state safely
        this.safeExecSync('git add .', { cwd: projectPath, timeout: 5000 });
        try {
          this.safeExecSync('git commit -m "chore: initial project structure with DecoHUB memory"', { cwd: projectPath, timeout: 5000 });
        } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "gitManager",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:gitManager]", err);
      }
    }

        // Push to main WITHOUT --force
        try {
          this.safeExecSync('git push -u origin main', { cwd: projectPath, timeout: 20000, env: envWithToken });
          Logger.success(`[GitManager] Push inicial concluído para https://github.com/${repoFullName}`);
        } catch (pushErr: any) {
          Logger.warn(`[GitManager] Aviso ao realizar push inicial: ${pushErr.message}`);
        }

        return {
          success: true,
          repoFullName,
          repoUrl: `https://github.com/${repoFullName}`
        };
      } catch (err: any) {
        return {
          success: false,
          repoFullName,
          repoUrl: `https://github.com/${repoFullName}`,
          error: err.message
        };
      }
    } else {
      // link_existing
      try {
        const remoteUrl = repoNameOrUrl.startsWith('http')
          ? repoNameOrUrl.trim()
          : `https://github.com/${repoFullName}.git`;

        try {
          this.safeExecSync(`git remote add origin "${remoteUrl}"`, { cwd: projectPath, timeout: 5000 });
        } catch {
          this.safeExecSync(`git remote set-url origin "${remoteUrl}"`, { cwd: projectPath, timeout: 5000 });
        }

        // Commit and push check
        this.safeExecSync('git add .', { cwd: projectPath, timeout: 5000 });
        try {
          this.safeExecSync('git commit -m "chore: link project with DecoHUB"', { cwd: projectPath, timeout: 5000 });
        } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "gitManager",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:gitManager]", err);
      }
    }

        return {
          success: true,
          repoFullName,
          repoUrl: `https://github.com/${repoFullName}`
        };
      } catch (err: any) {
        return {
          success: false,
          repoFullName,
          repoUrl: `https://github.com/${repoFullName}`,
          error: err.message
        };
      }
    }
  }

  static ensurePullRequest(
    projectPath: string,
    repoFullName: string,
    headBranch: string,
    title: string,
    body: string
  ): { prNumber: number; prUrl: string } | null {
    try {
      const token = this.getStoredGitHubToken();
      const envWithToken = token
        ? { ...process.env, GITHUB_TOKEN: token, GH_TOKEN: token, GITHUB_PERSONAL_ACCESS_TOKEN: token }
        : process.env;

      // 1. Check if PR already exists for headBranch
      try {
        const listOut = this.safeExecFileSync('gh', ['pr', 'list', '--repo', repoFullName, '--head', headBranch, '--state', 'open', '--json', 'number,url'], {
          cwd: projectPath,
          timeout: 15000,
          env: envWithToken,
          stdio: ['ignore', 'pipe', 'ignore']
        });

        if (listOut) {
          const parsed = JSON.parse(listOut);
          if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].number) {
            return { prNumber: parsed[0].number, prUrl: parsed[0].url };
          }
        }
      } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "gitManager",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:gitManager]", err);
      }
    }

      // 2. Create PR
      const createOut = this.safeExecFileSync('gh', [
        'pr', 'create',
        '--repo', repoFullName,
        '--head', headBranch,
        '--base', 'main',
        '--title', title,
        '--body', body
      ], {
        cwd: projectPath,
        timeout: 25000,
        env: envWithToken,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      const match = createOut.match(/\/pull\/(\d+)/);
      if (match) {
        return { prNumber: parseInt(match[1], 10), prUrl: createOut };
      }
      return null;
    } catch (err: any) {
      const match = (err.message || '').match(/\/pull\/(\d+)/);
      if (match) {
        const num = parseInt(match[1], 10);
        return { prNumber: num, prUrl: `https://github.com/${repoFullName}/pull/${num}` };
      }
      Logger.warn(`[GitManager] ensurePullRequest falhou para "${headBranch}": ${err.message}`);
      return null;
    }
  }
}
