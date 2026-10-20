import { execSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { db } from './db.js';
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
        branch = execSync('git branch --show-current', {
          cwd: projectPath,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'ignore'],
          timeout: 4000
        }).trim();
        if (!branch) {
          branch = execSync('git rev-parse --abbrev-ref HEAD', {
            cwd: projectPath,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'ignore'],
            timeout: 4000
          }).trim();
        }
      } catch {
        branch = 'HEAD (detached or initial)';
      }

      // 2. Last commit
      let lastCommit = null;
      try {
        const logOutput = execSync('git log -1 --pretty=format:"%h|%s|%an|%ad" --date=short', {
          cwd: projectPath,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'ignore'],
          timeout: 4000
        }).trim();

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
        porcelain = execSync('git status --porcelain', {
          cwd: projectPath,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'ignore'],
          timeout: 5000
        }).trim();
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
      execSync(`git checkout -B "${branchName}"`, { cwd: projectPath, stdio: 'pipe', timeout: 8000 });
      return true;
    } catch {
      return false;
    }
  }

  static commitAll(projectPath: string, message: string): boolean {
    try {
      execSync('git add .', { cwd: projectPath, stdio: 'pipe', timeout: 8000 });
      const diff = execSync('git diff --cached --name-only', { cwd: projectPath, encoding: 'utf-8', timeout: 5000 }).trim();
      if (!diff) return true;
      execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, { cwd: projectPath, stdio: 'pipe', timeout: 8000 });
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

    if (rel.startsWith('.git/') || rel.startsWith('node_modules/')) {
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
      gitRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
        cwd: resolvedPath,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 5000
      }).trim();
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
        if (fs.existsSync(path.join(root, file))) return true;
        try {
          execFileSync('git', ['ls-files', '--error-unmatch', '--', file], { cwd: root, stdio: 'ignore' });
          return true;
        } catch { return false; }
      });

      if (selected.length === 0) return false;
      execFileSync('git', ['add', '--', ...selected], { cwd: root, timeout: 10000 });
      try {
        execFileSync('git', ['diff', '--cached', '--check'], { cwd: root, timeout: 10000 });
      } catch {}
      const staged = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: root, encoding: 'utf-8', timeout: 10000 }).trim();
      if (!staged) return false;
      execFileSync('git', ['commit', '-m', message], { cwd: root, timeout: 15000 });
      return true;
    } catch (err: any) {
      Logger.warn(`[GitManager] Commit seletivo falhou: ${err.message}`);
      return false;
    }
  }

  static pushBranch(projectPath: string, branchName: string): boolean {
    try {
      execSync(`git push -u origin "${branchName}"`, { cwd: projectPath, stdio: 'pipe', timeout: 15000 });
      return true;
    } catch {
      return false;
    }
  }

  static checkout(projectPath: string, branchName: string): boolean {
    try {
      execSync(`git checkout "${branchName}"`, { cwd: projectPath, stdio: 'pipe', timeout: 8000 });
      return true;
    } catch {
      return false;
    }
  }

  static pull(projectPath: string, branchName: string = 'main'): boolean {
    try {
      execSync(`git pull origin "${branchName}"`, { cwd: projectPath, stdio: 'pipe', timeout: 15000 });
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
        execSync('git rev-parse --verify HEAD', { cwd: projectPath, stdio: 'pipe', timeout: 3000 });
        hasHead = true;
      } catch {
        hasHead = false;
      }

      const diffCmd = filePath
        ? (hasHead ? `git diff HEAD -- "${filePath}"` : `git diff -- "${filePath}"`)
        : (hasHead ? 'git diff HEAD' : 'git diff');

      let diff = '';
      try {
        diff = execSync(diffCmd, { cwd: projectPath, encoding: 'utf-8', timeout: 5000 });
      } catch {
        diff = '';
      }

      let numstatOutput = '';
      try {
        const numstatCmd = hasHead ? 'git diff HEAD --numstat' : 'git diff --numstat';
        numstatOutput = execSync(numstatCmd, { cwd: projectPath, encoding: 'utf-8', timeout: 5000 });
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
        const untracked = execSync('git ls-files --others --exclude-standard', { cwd: projectPath, encoding: 'utf-8', timeout: 5000 });
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
              } catch {}
              files.push({ file: u, additions: lineCount, deletions: 0, status: 'untracked' });

              if (!filePath || filePath === u) {
                try {
                  const fullP = path.join(projectPath, u);
                  if (fs.existsSync(fullP) && !fs.statSync(fullP).isDirectory()) {
                    const c = fs.readFileSync(fullP, 'utf-8');
                    diff += `\n--- /dev/null\n+++ b/${u}\n@@ -0,0 +1,${lineCount} @@\n` + c.split('\n').map(l => `+${l}`).join('\n');
                  }
                } catch {}
              }
            }
          }
        }
      } catch {}

      let rawSummary = '';
      try {
        rawSummary = execSync(hasHead ? 'git diff HEAD --stat' : 'git status -s', { cwd: projectPath, encoding: 'utf-8', timeout: 5000 });
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
    const encrypted = this.encryptToken(token.trim());
    const nowIso = new Date().toISOString();
    db.prepare(`
      INSERT INTO system_settings (key, value, updated_at)
      VALUES ('github_pat_encrypted', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(encrypted, nowIso);
  }

  static getStoredGitHubToken(): string | null {
    try {
      const row: any = db.prepare("SELECT value FROM system_settings WHERE key = 'github_pat_encrypted'").get();
      if (row?.value) {
        const decrypted = this.decryptToken(row.value);
        if (decrypted) return decrypted;
      }
    } catch {}

    if (process.env.GITHUB_PERSONAL_ACCESS_TOKEN) {
      return process.env.GITHUB_PERSONAL_ACCESS_TOKEN.trim();
    }
    if (process.env.GITHUB_TOKEN) {
      return process.env.GITHUB_TOKEN.trim();
    }

    try {
      const token = execSync('gh auth token', { encoding: 'utf-8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (token) return token;
    } catch {}

    return null;
  }

  static getGitHubStatus(): { configured: boolean; authenticated: boolean; source: string; username: string | null; scopes: string[] } {
    let token = '';
    let source = 'NONE';

    try {
      const row: any = db.prepare("SELECT value FROM system_settings WHERE key = 'github_pat_encrypted'").get();
      if (row?.value) {
        token = this.decryptToken(row.value);
        if (token) source = 'STORED_TOKEN';
      }
    } catch {}

    if (!token && process.env.GITHUB_PERSONAL_ACCESS_TOKEN) {
      token = process.env.GITHUB_PERSONAL_ACCESS_TOKEN.trim();
      source = 'ENV';
    }

    if (!token) {
      try {
        const ghToken = execSync('gh auth token', { encoding: 'utf-8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        if (ghToken) {
          token = ghToken;
          source = 'GH_CLI';
        }
      } catch {}
    }

    if (!token) {
      return { configured: false, authenticated: false, source: 'NONE', username: null, scopes: [] };
    }

    try {
      let username: string | null = null;
      const scopes: string[] = ['repo', 'workflow'];

      try {
        const res = execSync('gh api user --jq .login', { encoding: 'utf-8', timeout: 5000, env: { ...process.env, GITHUB_TOKEN: token }, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        if (res) username = res;
      } catch {}

      return {
        configured: true,
        authenticated: Boolean(username || token.startsWith('gh')),
        source,
        username: username || 'deco-verc',
        scopes
      };
    } catch {
      return { configured: true, authenticated: false, source, username: null, scopes: [] };
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
      execSync('git init -b main', { cwd: projectPath, stdio: 'pipe' });
    }

    // Always protect secrets BEFORE staging or pushing
    this.ensureGitIgnore(projectPath);

    let repoFullName = repoNameOrUrl.trim().replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '');

    if (action === 'create_private') {
      try {
        let ghUser = 'deco-verc';
        try {
          const userOut = execSync('gh api user --jq .login', { encoding: 'utf-8', timeout: 6000, env: envWithToken, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
          if (userOut) ghUser = userOut;
        } catch {}

        const cleanRepoName = repoFullName.includes('/') ? repoFullName.split('/')[1] : repoFullName;
        repoFullName = `${ghUser}/${cleanRepoName}`;

        Logger.info(`[GitManager] Criando repositório privado no GitHub: ${repoFullName}...`);
        try {
          execSync(`gh repo create "${repoFullName}" --private`, { cwd: projectPath, encoding: 'utf-8', timeout: 20000, env: envWithToken, stdio: 'pipe' });
        } catch (createErr: any) {
          if (!createErr.message?.includes('already exists')) {
            Logger.warn(`[GitManager] Aviso ao criar repo via gh: ${createErr.message}`);
          }
        }

        const remoteUrl = `https://github.com/${repoFullName}.git`;
        try {
          execSync(`git remote add origin "${remoteUrl}"`, { cwd: projectPath, stdio: 'pipe' });
        } catch {
          execSync(`git remote set-url origin "${remoteUrl}"`, { cwd: projectPath, stdio: 'pipe' });
        }

        // Commit initial state safely
        execSync('git add .', { cwd: projectPath, stdio: 'pipe' });
        try {
          execSync('git commit -m "chore: initial project structure with DecoHUB memory"', { cwd: projectPath, stdio: 'pipe' });
        } catch {}

        // Push to main WITHOUT --force
        try {
          execSync('git push -u origin main', { cwd: projectPath, encoding: 'utf-8', timeout: 20000, env: envWithToken, stdio: 'pipe' });
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
          execSync(`git remote add origin "${remoteUrl}"`, { cwd: projectPath, stdio: 'pipe' });
        } catch {
          execSync(`git remote set-url origin "${remoteUrl}"`, { cwd: projectPath, stdio: 'pipe' });
        }

        // Commit and push check
        execSync('git add .', { cwd: projectPath, stdio: 'pipe' });
        try {
          execSync('git commit -m "chore: link project with DecoHUB"', { cwd: projectPath, stdio: 'pipe' });
        } catch {}

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
}
