/**
 * Test Environment Setup, Database Isolation & Fail-Closed Guard
 * 
 * 1. Ensures tests NEVER touch or pollute production ~/.ai-dev-hub/hub.db.
 * 2. Enforces FAIL-CLOSED offline mode: no real Language Server / Antigravity calls allowed.
 * 3. Installs a deterministic Fake/Mock AgentApiGateway by default for all test suites.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports, createRequire } from 'node:module';
const req = createRequire(__filename);

// 1. Save real user profile and isolate USERPROFILE / HOME before any imports or test logic
const realUserProfile = process.env.USERPROFILE || process.env.HOME || os.homedir();
if (!process.env.REAL_USERPROFILE && realUserProfile) {
  process.env.REAL_USERPROFILE = realUserProfile;
}

const testUserProfile = path.join(os.tmpdir(), 'decohub-test-userprofile');
if (!fs.existsSync(testUserProfile)) {
  fs.mkdirSync(testUserProfile, { recursive: true });
}
fs.mkdirSync(path.join(testUserProfile, '.gemini', 'config', 'projects'), { recursive: true });
fs.mkdirSync(path.join(testUserProfile, '.gemini', 'antigravity-cli', 'cache'), { recursive: true });

process.env.USERPROFILE = testUserProfile;
process.env.HOME = testUserProfile;
process.env.DECOHUB_TEST_USERPROFILE = testUserProfile;
if (process.platform === 'win32') {
  const parsed = path.parse(testUserProfile);
  process.env.HOMEDRIVE = parsed.root.replace(/[\\/]$/, '');
  process.env.HOMEPATH = testUserProfile.slice(process.env.HOMEDRIVE.length) || '\\';
}
os.homedir = () => testUserProfile;
syncBuiltinESMExports();

// 2. Force offline mode and disable live agentapi
process.env.NODE_ENV = 'test';
process.env.DECOHUB_OFFLINE_MODE = 'true';
process.env.DECOHUB_ALLOW_LIVE_AGENTAPI = 'false';

// 3. Isolate SQLite database in temporary folder BEFORE any db module imports
{
  const isolatedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-isolated-test-hub-'));
  process.env.AI_DEV_HUB_DATA_DIR = isolatedDir;
  
  // Register cleanup on process exit
  process.on('exit', () => {
    try {
      try {
        const dbModule = req('../src/db');
        if (dbModule?.db && typeof dbModule.db.close === 'function') {
          dbModule.db.close();
        }
      } catch {}
      if (fs.existsSync(isolatedDir)) {
        fs.rmSync(isolatedDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
      }
      if (fs.existsSync(testUserProfile)) {
        fs.rmSync(testUserProfile, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
      }
    } catch (err: any) {
      // In Windows, SQLite WAL locks may be freed only after process teardown; suppress benign EPERM
      if (err?.code !== 'EPERM' && err?.code !== 'EBUSY') {
        if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
          (globalThis as any).logger.warn({
            event: "server.handled_exception",
            file: "testSetup",
            error: err?.message || String(err)
          });
        } else {
          console.warn("[WARN][server:testSetup]", err);
        }
      }
    }
  });
}

// Refuse physical agent processes even if a future provider bypasses the gateway.
for (const name of ['execFileSync', 'execFile', 'spawn', 'spawnSync'] as const) {
  const original: any = childProcess[name];
  (childProcess as any)[name] = (file: any, ...args: any[]) => {
    if (/language_server|antigravity\.exe/i.test(String(file)) || (Array.isArray(args[0]) && args[0].includes('agentapi'))) {
      throw new Error(`OFFLINE_PROCESS_GUARD: chamada física negada (${name}).`);
    }
    return original(file, ...args);
  };
}

// 2.1 Git CLI fallback shim when git is not installed on test host
const originalExecSync: any = childProcess.execSync;
let gitCliAvailable = false;
try {
  originalExecSync('git --version', { stdio: 'ignore' });
  gitCliAvailable = true;
} catch {
  gitCliAvailable = false;
}

if (!gitCliAvailable) {
  const repoStore = new Map<string, { currentBranch: string; commits: Array<{ hash: string; msg: string; files: Record<string, string> }> }>();

  (childProcess as any).execSync = function(cmd: string, options: any) {
    const cmdStr = String(cmd).trim();
    if (cmdStr.startsWith('git ') || cmdStr === 'git' || cmdStr.includes('git add') || cmdStr.includes('git commit')) {
      const cwd = options?.cwd || process.cwd();
      let repo = repoStore.get(cwd);
      if (!repo) {
        repo = { currentBranch: 'main', commits: [] };
        repoStore.set(cwd, repo);
      }

      if (cmdStr.includes('init')) {
        fs.mkdirSync(path.join(cwd, '.git'), { recursive: true });
        return options?.encoding === 'utf-8' ? 'Initialized empty Git repository' : Buffer.from('');
      }
      if (cmdStr.includes('config')) {
        return options?.encoding === 'utf-8' ? '' : Buffer.from('');
      }
      if (cmdStr.includes('checkout')) {
        const m = cmdStr.match(/checkout\s+(?:-[bB]\s+)?["']?([^"'\s]+)["']?/);
        if (m && m[1]) repo.currentBranch = m[1];
        return options?.encoding === 'utf-8' ? '' : Buffer.from('');
      }
      if (cmdStr.includes('branch --show-current') || cmdStr.includes('rev-parse --abbrev-ref HEAD')) {
        return options?.encoding === 'utf-8' ? repo.currentBranch : Buffer.from(repo.currentBranch);
      }
      if (cmdStr.includes('rev-parse --verify HEAD')) {
        if (repo.commits.length === 0) throw new Error('fatal: Needed a single revision');
        return options?.encoding === 'utf-8' ? repo.commits[repo.commits.length - 1].hash : Buffer.from('abc1234');
      }
      if (cmdStr.includes('commit')) {
        const snapshot: Record<string, string> = {};
        const scan = (d: string, base: string) => {
          if (!fs.existsSync(d)) return;
          for (const item of fs.readdirSync(d, { withFileTypes: true })) {
            if (item.name === '.git' || item.name === 'node_modules') continue;
            const full = path.join(d, item.name);
            const rel = path.relative(base, full).replace(/\\/g, '/');
            if (item.isDirectory()) scan(full, base);
            else if (item.isFile()) {
              try { snapshot[rel] = fs.readFileSync(full, 'utf-8'); } catch {}
            }
          }
        };
        scan(cwd, cwd);
        repo.commits.push({ hash: 'c' + Math.random().toString(36).slice(2, 9), msg: 'commit', files: snapshot });
        return options?.encoding === 'utf-8' ? '[main commit]' : Buffer.from('');
      }
      if (cmdStr.includes('show HEAD:')) {
        const filePart = cmdStr.split('show HEAD:')[1]?.replace(/["']/g, '').trim();
        const normRel = filePart?.replace(/\\/g, '/');
        const lastCommit = repo.commits[repo.commits.length - 1];
        if (lastCommit && normRel && lastCommit.files[normRel] !== undefined) {
          return options?.encoding === 'utf-8' ? lastCommit.files[normRel] : Buffer.from(lastCommit.files[normRel]);
        }
        if (normRel && fs.existsSync(path.join(cwd, normRel))) {
          const val = fs.readFileSync(path.join(cwd, normRel), 'utf-8');
          return options?.encoding === 'utf-8' ? val : Buffer.from(val);
        }
        throw new Error(`fatal: path '${filePart}' does not exist in 'HEAD'`);
      }
      if (cmdStr.includes('show HEAD~1:')) {
        const filePart = cmdStr.split('show HEAD~1:')[1]?.replace(/["']/g, '').trim();
        const normRel = filePart?.replace(/\\/g, '/');
        const prevCommit = repo.commits[repo.commits.length - 2];
        if (prevCommit && normRel && prevCommit.files[normRel] !== undefined) {
          return options?.encoding === 'utf-8' ? prevCommit.files[normRel] : Buffer.from(prevCommit.files[normRel]);
        }
        throw new Error(`fatal: path '${filePart}' does not exist in 'HEAD~1'`);
      }
      if (cmdStr.includes('status')) {
        return options?.encoding === 'utf-8' ? '' : Buffer.from('');
      }
      if (cmdStr.includes('--version')) {
        return options?.encoding === 'utf-8' ? 'git version 2.44.0.windows.1' : Buffer.from('git version 2.44.0.windows.1');
      }
      if (cmdStr.includes('log')) {
        return options?.encoding === 'utf-8' ? 'abc1234|commit|tester|2026-01-01' : Buffer.from('');
      }
      if (cmdStr.includes('diff')) {
        return options?.encoding === 'utf-8' ? '' : Buffer.from('');
      }
      return options?.encoding === 'utf-8' ? '' : Buffer.from('');
    }
    return originalExecSync.apply(this, arguments as any);
  };
}
syncBuiltinESMExports();

// 3. Import AgentApiGateway after env is set
const { AgentApiGateway } = req('../src/agentApiGateway.js');
const fixtureProvider = AgentApiGateway.installDefaultMock();
const defaultTestResponseProvider = (_id: string, mode: string) => {
  if (mode === 'REVIEW') {
    return JSON.stringify({ verdict: 'APPROVED', feedback: 'Revisão simulada explícita no fixture de teste', qualityScore: 9 });
  }
  return JSON.stringify([
    { title: 'Configurar estrutura e dependências base', description: 'Inicializar arquivos essenciais e ambiente', milestone: 'M1', criteria: ['Estrutura e dependências configuradas'], dependencies: [], orderIndex: 1 },
    { title: 'Implementar lógica principal do módulo', description: 'Construir código fonte e utilitários', milestone: 'M1', criteria: ['Módulo implementado de acordo com requisitos'], dependencies: ['Configurar estrutura e dependências base'], orderIndex: 2 },
    { title: 'Desenvolver interface visual e validação E2E', description: 'Implementar interface de usuário e validações', milestone: 'M1', criteria: ['Interface visual e validações completas'], dependencies: ['Implementar lógica principal do módulo'], orderIndex: 3 }
  ]);
};
(defaultTestResponseProvider as any).isDefaultTestFixture = true;
fixtureProvider.responseProvider = defaultTestResponseProvider;

