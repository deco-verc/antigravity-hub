import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { db } from './db.js';
import { Logger } from './logger.js';
import { normalizeRuntimePath } from './runtimeProfileSelector.js';
import {
  NativeExecutionPolicy,
  assertNativeExecutionPolicy,
  NativeExecutionChoice
} from './nativeExecutionPolicy.js';

export interface NativeWorkspaceRecord {
  projectId: string;
  accountProfileId: string;
  nativeProjectId: string;
  userProfileDir: string;
  workspacePath: string;
  configHash: string;
  executionPolicy?: ReturnType<typeof assertNativeExecutionPolicy>;
}

export class NativeWorkspaceBinding {
  static resolve(
    projectId: string,
    accountProfileId: string,
    userProfileDir: string,
    autoProvision = true
  ): NativeWorkspaceRecord {
    const existing = db
      .prepare('SELECT * FROM native_workspace_bindings WHERE project_id=?')
      .get(projectId) as any;
    if (existing) {
      if (
        existing.account_profile_id === accountProfileId &&
        normalizeRuntimePath(existing.user_profile_dir) === normalizeRuntimePath(userProfileDir)
      ) {
        try {
          return this.get(projectId, accountProfileId);
        } catch (err: any) {
          if (!autoProvision || err.message !== 'NATIVE_WORKSPACE_PROJECT_NOT_FOUND') {
            throw err;
          }
        }
      } else {
        // Profile or directory has switched; ensure active_account_profile_id is aligned
        try {
          db.prepare('UPDATE projects SET active_account_profile_id = ?, updated_at = ? WHERE id = ?').run(
            accountProfileId,
            new Date().toISOString(),
            projectId
          );
        } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "nativeWorkspaceBinding",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:nativeWorkspaceBinding]", err);
      }
    }
      }
    }

    const project = db
      .prepare('SELECT path, active_account_profile_id FROM projects WHERE id=?')
      .get(projectId) as any;
    if (!project) throw new Error('NATIVE_WORKSPACE_HUB_PROJECT_MISMATCH');

    // If switching to a valid registered account profile via resolve, align project's active_account_profile_id
    if (project.active_account_profile_id !== accountProfileId) {
      const validProfile = db
        .prepare('SELECT id FROM account_profiles WHERE id = ?')
        .get(accountProfileId) as any;
      if (validProfile) {
        try {
          db.prepare('UPDATE projects SET active_account_profile_id = ?, updated_at = ? WHERE id = ?').run(
            accountProfileId,
            new Date().toISOString(),
            projectId
          );
          project.active_account_profile_id = accountProfileId;
        } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "nativeWorkspaceBinding",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:nativeWorkspaceBinding]", err);
      }
    }
      }
    }

    const directory = path.join(userProfileDir, '.gemini', 'config', 'projects');
    const candidates: string[] = [];
    if (fs.existsSync(directory)) {
      for (const name of fs.readdirSync(directory)) {
        // Official UI-generated IDs only; do not inspect arbitrary files or standalone/global state.
        if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.json$/i.test(name)) continue;
        const id = name.slice(0, -5);
        try {
          this.inspect(userProfileDir, id, project.path, NativeExecutionPolicy.get(projectId));
          candidates.push(id);
        } catch (err) {
          if ((err as any)?.message === 'NATIVE_WORKSPACE_FOLDER_MISMATCH' || (err as any)?.message?.includes('MISMATCH')) {
            continue;
          }
          if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
            (globalThis as any).logger.warn({
              event: "server.handled_exception",
              file: "nativeWorkspaceBinding",
              error: (err as any)?.message || String(err)
            });
          } else {
            console.warn("[WARN][server:nativeWorkspaceBinding]", err);
          }
        }
      }
    }

    if (!candidates.length) {
      if (autoProvision) return this.ensureBinding(projectId, accountProfileId, userProfileDir);
      throw new Error('NATIVE_WORKSPACE_UNBOUND');
    }
    if (candidates.length !== 1) throw new Error('NATIVE_WORKSPACE_PROJECT_AMBIGUOUS');

    return this.bind({
      projectId,
      accountProfileId,
      nativeProjectId: candidates[0],
      userProfileDir,
      workspacePath: project.path
    });
  }

  static ensureBinding(
    projectId: string,
    accountProfileId: string,
    userProfileDir: string,
    options?: { mode?: 'restricted' | 'permissive'; userConsent?: string }
  ): NativeWorkspaceRecord {
    const project = db
      .prepare('SELECT id, name, path, is_trusted, full_dev_autonomy, active_account_profile_id FROM projects WHERE id=?')
      .get(projectId) as any;
    if (!project) throw new Error('NATIVE_WORKSPACE_HUB_PROJECT_MISMATCH');

    // If switching to a valid registered account profile via ensureBinding, align project's active_account_profile_id
    if (project.active_account_profile_id !== accountProfileId) {
      const validProfile = db
        .prepare('SELECT id FROM account_profiles WHERE id = ?')
        .get(accountProfileId) as any;
      if (validProfile) {
        try {
          db.prepare('UPDATE projects SET active_account_profile_id = ?, updated_at = ? WHERE id = ?').run(
            accountProfileId,
            new Date().toISOString(),
            projectId
          );
        } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "nativeWorkspaceBinding",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:nativeWorkspaceBinding]", err);
      }
    }
      }
    }

    let targetMode: 'restricted' | 'permissive' = options?.mode || 'permissive';
    const existingPolicyRow = db
      .prepare('SELECT choice_json FROM native_execution_policies WHERE project_id=?')
      .get(projectId) as any;

    if (existingPolicyRow) {
      try {
        const parsed = JSON.parse(existingPolicyRow.choice_json);
        if (!options?.mode && parsed.mode) targetMode = parsed.mode;
      } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "nativeWorkspaceBinding",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:nativeWorkspaceBinding]", err);
      }
    }
    } else {
      targetMode = project.full_dev_autonomy === 1 || project.is_trusted === 1 ? 'permissive' : 'restricted';
      const hasActiveRun = db
        .prepare("SELECT 1 FROM autonomous_runs WHERE project_id=? AND status NOT IN ('completed','failed') LIMIT 1")
        .get(projectId);
      if (!hasActiveRun) {
        NativeExecutionPolicy.configure(
          projectId,
          targetMode === 'permissive'
            ? {
                mode: 'permissive',
                acknowledgement: {
                  userConsent:
                    options?.userConsent ||
                    'Escolha explícita na criação do projeto: aceitar ALLOW/EAGER conforme preferência do usuário.',
                  outsideAccessAllowed: true,
                  automaticCommandsAllowed: true,
                  noFilesystemIsolation: true
                }
              }
            : { mode: 'restricted' }
        );
      } else {
        const now = new Date().toISOString();
        const savedChoice =
          targetMode === 'permissive'
            ? {
                mode: 'permissive',
                acknowledgement: {
                  userConsent:
                    options?.userConsent ||
                    'Escolha explícita para desbloqueio: aceitar ALLOW/EAGER conforme preferência do usuário.',
                  outsideAccessAllowed: true,
                  automaticCommandsAllowed: true,
                  noFilesystemIsolation: true
                }
              }
            : { mode: 'restricted' };
        db.prepare(
          `INSERT INTO native_execution_policies(project_id, choice_json, updated_at)
           VALUES(?,?,?) ON CONFLICT(project_id) DO UPDATE SET choice_json=excluded.choice_json, updated_at=excluded.updated_at`
        ).run(projectId, JSON.stringify(savedChoice), now);
      }
    }

    const currentPolicy = NativeExecutionPolicy.get(projectId);

    if (db.prepare('SELECT 1 FROM native_workspace_bindings WHERE project_id=?').get(projectId)) {
      try {
        const existing = this.get(projectId, accountProfileId);
        if (normalizeRuntimePath(existing.userProfileDir) === normalizeRuntimePath(userProfileDir)) {
          return existing;
        }
      } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "nativeWorkspaceBinding",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:nativeWorkspaceBinding]", err);
      }
    }
    }

    const directory = path.join(userProfileDir, '.gemini', 'config', 'projects');
    if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory, { recursive: true });
    }

    const candidates: string[] = [];
    for (const name of fs.readdirSync(directory)) {
      if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.json$/i.test(name)) continue;
      const id = name.slice(0, -5);
      try {
        this.inspect(userProfileDir, id, project.path, currentPolicy);
        candidates.push(id);
      } catch (err) {
        if ((err as any)?.message === 'NATIVE_WORKSPACE_FOLDER_MISMATCH' || (err as any)?.message?.includes('MISMATCH')) {
          continue;
        }
        if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
          (globalThis as any).logger.warn({
            event: "server.handled_exception",
            file: "nativeWorkspaceBinding",
            error: (err as any)?.message || String(err)
          });
        } else {
          console.warn("[WARN][server:nativeWorkspaceBinding]", err);
        }
      }
    }

    // 1. Garante SEMPRE que o projeto seja um repositório Git válido (.git inicializado) antes de gravar gitFolder
    const gitDir = path.join(project.path, '.git');
    if (!fs.existsSync(gitDir)) {
      try {
        const { execFileSync } = require('child_process');
        execFileSync('git', ['init'], { cwd: project.path, windowsHide: true, timeout: 5000 });
        Logger.info(`[NativeWorkspaceBinding] Repositório Git inicializado na pasta do projeto: ${project.path}`);
      } catch (gitErr: any) {
        Logger.warn(`[NativeWorkspaceBinding] Aviso ao inicializar Git no projeto: ${gitErr.message}`);
      }
    }

    let nativeProjectId: string;
    if (candidates.length === 1) {
      nativeProjectId = candidates[0];
    } else if (candidates.length > 1) {
      throw new Error('NATIVE_WORKSPACE_PROJECT_AMBIGUOUS');
    } else {
      nativeProjectId = randomUUID();
      const configFile = path.join(directory, `${nativeProjectId}.json`);
      const nativeConfig = {
        id: nativeProjectId,
        name: project.name,
        projectResources: {
          resources: [
            {
              gitFolder: {
                folderUri: pathToFileURL(project.path).href
              }
            }
          ]
        },
        settings:
          currentPolicy.mode === 'permissive'
            ? {
                fileAccessPolicy: 'AGENT_SETTING_POLICY_ALLOW',
                sandboxMode: false,
                autoExecutionPolicy: 'CASCADE_COMMANDS_AUTO_EXECUTION_EAGER'
              }
            : {
                fileAccessPolicy: 'AGENT_SETTING_POLICY_DENY',
                sandboxMode: true,
                autoExecutionPolicy: 'CASCADE_COMMANDS_AUTO_EXECUTION_OFF'
              },
        isWorkspaceOnly: false
      };
      fs.writeFileSync(configFile, JSON.stringify(nativeConfig, null, 2), 'utf8');
    }

    // 2. Espelha SEMPRE o nativeProjectId.json para o diretório global do usuário e atualize cache do CLI
    try {
      const globalProjectsDir = path.join(os.homedir(), '.gemini', 'config', 'projects');
      fs.mkdirSync(globalProjectsDir, { recursive: true });
      const sourceConfigFile = path.join(directory, `${nativeProjectId}.json`);
      const globalConfigFile = path.join(globalProjectsDir, `${nativeProjectId}.json`);
      if (fs.existsSync(sourceConfigFile) && normalizeRuntimePath(sourceConfigFile) !== normalizeRuntimePath(globalConfigFile)) {
        fs.copyFileSync(sourceConfigFile, globalConfigFile);
      }

      // Atualiza também ~/.gemini/antigravity-cli/cache/projects.json
      const cliCacheDir = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'cache');
      fs.mkdirSync(cliCacheDir, { recursive: true });
      const cliProjectsFile = path.join(cliCacheDir, 'projects.json');
      let cacheData: any = {};
      if (fs.existsSync(cliProjectsFile)) {
        try { cacheData = JSON.parse(fs.readFileSync(cliProjectsFile, 'utf8')); } catch { cacheData = {}; }
      }
      if (Array.isArray(cacheData)) {
        const idx = cacheData.findIndex((p: any) => p.id === nativeProjectId || p.path === project.path);
        const entry = { id: nativeProjectId, name: project.name, path: project.path, folderUri: pathToFileURL(project.path).href };
        if (idx >= 0) cacheData[idx] = entry;
        else cacheData.push(entry);
      } else {
        cacheData[nativeProjectId] = {
          id: nativeProjectId,
          name: project.name,
          path: project.path,
          folderUri: pathToFileURL(project.path).href
        };
      }
      fs.writeFileSync(cliProjectsFile, JSON.stringify(cacheData, null, 2), 'utf8');
    } catch (mirrorErr: any) {
      Logger.warn(`[NativeWorkspaceBinding] Aviso ao espelhar manifesto no home global: ${mirrorErr.message}`);
    }

    return this.bind({
      projectId,
      accountProfileId,
      nativeProjectId,
      userProfileDir,
      workspacePath: project.path
    });
  }

  static inspectBinding(projectId: string, accountProfileId?: string, _userProfileDir?: string) {
    const project = db.prepare('SELECT id, name, path FROM projects WHERE id=?').get(projectId) as any;
    if (!project) return { isBound: false, error: 'PROJECT_NOT_FOUND', project: null, binding: null, policy: null };
    const row = db.prepare('SELECT * FROM native_workspace_bindings WHERE project_id=?').get(projectId) as any;
    let policy: any = null;
    try {
      policy = NativeExecutionPolicy.get(projectId);
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "nativeWorkspaceBinding",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:nativeWorkspaceBinding]", err);
      }
    }
    if (!row) {
      return { isBound: false, project, policy, binding: null, error: 'NATIVE_WORKSPACE_UNBOUND' };
    }
    try {
      const record = this.get(projectId, accountProfileId);
      return { isBound: true, project, policy, binding: record, error: null };
    } catch (err: any) {
      return { isBound: false, project, policy, binding: row, error: err.message };
    }
  }

  static inspect(
    userProfileDir: string,
    nativeProjectId: string,
    expectedWorkspace: string,
    choice: NativeExecutionChoice = { mode: 'restricted' }
  ) {
    if (!/^[a-zA-Z0-9_-]+$/.test(nativeProjectId) || nativeProjectId === 'outside-of-project') {
      throw new Error('NATIVE_WORKSPACE_PROJECT_REQUIRED');
    }
    const configFile = path.join(userProfileDir, '.gemini', 'config', 'projects', nativeProjectId + '.json');
    if (!fs.existsSync(configFile)) throw new Error('NATIVE_WORKSPACE_PROJECT_NOT_FOUND');
    const raw = fs.readFileSync(configFile);
    const config = JSON.parse(raw.toString('utf8'));
    if (config.id !== nativeProjectId) throw new Error('NATIVE_WORKSPACE_PROJECT_ID_MISMATCH');
    const resources = config.projectResources?.resources;
    if (!Array.isArray(resources) || resources.length !== 1) {
      throw new Error('NATIVE_WORKSPACE_SINGLE_FOLDER_REQUIRED');
    }
    const resource = resources[0];
    const uri = resource.gitFolder?.folderUri || resource.localFolder?.folderUri;
    if (typeof uri !== 'string' || !uri.startsWith('file:')) {
      throw new Error('NATIVE_WORKSPACE_LOCAL_FOLDER_REQUIRED');
    }
    const folder = fileURLToPath(uri);
    if (normalizeRuntimePath(folder) !== normalizeRuntimePath(expectedWorkspace)) {
      throw new Error('NATIVE_WORKSPACE_FOLDER_MISMATCH');
    }
    const executionPolicy = assertNativeExecutionPolicy(config.settings, choice);
    return {
      configFile,
      workspacePath: normalizeRuntimePath(folder),
      configHash: createHash('sha256').update(raw).digest('hex'),
      executionPolicy
    };
  }

  static bind(record: Omit<NativeWorkspaceRecord, 'configHash'>): NativeWorkspaceRecord {
    const project = db.prepare('SELECT path FROM projects WHERE id=?').get(record.projectId) as any;
    if (!project || normalizeRuntimePath(project.path) !== normalizeRuntimePath(record.workspacePath)) {
      throw new Error('NATIVE_WORKSPACE_HUB_PROJECT_MISMATCH');
    }
    const proof = this.inspect(
      record.userProfileDir,
      record.nativeProjectId,
      record.workspacePath,
      NativeExecutionPolicy.get(record.projectId)
    );
    const previous = db
      .prepare('SELECT * FROM native_workspace_bindings WHERE project_id=?')
      .get(record.projectId) as any;
    const projectRow = db
      .prepare('SELECT path, active_account_profile_id FROM projects WHERE id=?')
      .get(record.projectId) as any;

    const isLegitimateProjectAccountSwitch = Boolean(
      (projectRow?.active_account_profile_id === record.accountProfileId ||
        db.prepare('SELECT 1 FROM account_profiles WHERE id = ?').get(record.accountProfileId)) &&
        (previous?.account_profile_id !== record.accountProfileId ||
          (previous && normalizeRuntimePath(previous.user_profile_dir) !== normalizeRuntimePath(record.userProfileDir)))
    );

    if (isLegitimateProjectAccountSwitch) {
      try {
        db.prepare('UPDATE projects SET active_account_profile_id = ?, updated_at = ? WHERE id = ?').run(
          record.accountProfileId,
          new Date().toISOString(),
          record.projectId
        );
      } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "nativeWorkspaceBinding",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:nativeWorkspaceBinding]", err);
      }
    }
      try {
        db.prepare(
          "UPDATE agent_sessions SET status='ARCHIVED', rotation_reason='ACCOUNT_SWITCH' WHERE project_id=? AND status='ACTIVE'"
        ).run(record.projectId);
      } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "nativeWorkspaceBinding",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:nativeWorkspaceBinding]", err);
      }
    }
    }

    if (
      !isLegitimateProjectAccountSwitch &&
      previous &&
      (previous.native_project_id !== record.nativeProjectId ||
        previous.config_hash !== proof.configHash ||
        previous.account_profile_id !== record.accountProfileId ||
        normalizeRuntimePath(previous.user_profile_dir) !== normalizeRuntimePath(record.userProfileDir) ||
        previous.workspace_path !== proof.workspacePath) &&
      db.prepare("SELECT 1 FROM agent_sessions WHERE project_id=? AND status='ACTIVE' LIMIT 1").get(record.projectId)
    ) {
      throw new Error('NATIVE_WORKSPACE_SESSION_RECONCILIATION_REQUIRED');
    }

    db.prepare(
      `INSERT INTO native_workspace_bindings(project_id,account_profile_id,native_project_id,user_profile_dir,workspace_path,config_hash)
       VALUES(?,?,?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET account_profile_id=excluded.account_profile_id,
       native_project_id=excluded.native_project_id,user_profile_dir=excluded.user_profile_dir,workspace_path=excluded.workspace_path,config_hash=excluded.config_hash`
    ).run(
      record.projectId,
      record.accountProfileId,
      record.nativeProjectId,
      record.userProfileDir,
      proof.workspacePath,
      proof.configHash
    );
    return { ...record, ...proof };
  }

  static get(projectId: string, accountProfileId?: string): NativeWorkspaceRecord {
    const row = db.prepare('SELECT * FROM native_workspace_bindings WHERE project_id=?').get(projectId) as any;
    if (!row) throw new Error('NATIVE_WORKSPACE_UNBOUND');
    if (accountProfileId && row.account_profile_id !== accountProfileId) {
      throw new Error('NATIVE_WORKSPACE_ACCOUNT_MISMATCH');
    }
    const project = db.prepare('SELECT path FROM projects WHERE id=?').get(projectId) as any;
    const proof = this.inspect(
      row.user_profile_dir,
      row.native_project_id,
      project?.path || '',
      NativeExecutionPolicy.get(projectId)
    );
    if (proof.configHash !== row.config_hash || proof.workspacePath !== row.workspace_path) {
      throw new Error('NATIVE_WORKSPACE_CONFIGURATION_CHANGED');
    }
    return {
      projectId,
      accountProfileId: row.account_profile_id,
      nativeProjectId: row.native_project_id,
      userProfileDir: row.user_profile_dir,
      workspacePath: row.workspace_path,
      configHash: row.config_hash,
      executionPolicy: proof.executionPolicy
    };
  }

  static assertEnvironment(projectId: string | null, env?: NodeJS.ProcessEnv, caller?: string): NativeWorkspaceRecord {
    if ((caller && (caller.includes('MetaChat') || caller.includes('metachat'))) || projectId === '__decohub_metachat__' || projectId === 'decohub-meta') {
      const userProfileDir = env?.USERPROFILE || process.env.USERPROFILE || '';
      return {
        projectId: projectId || '__decohub_metachat__',
        accountProfileId: 'metachat',
        nativeProjectId: env?.ANTIGRAVITY_PROJECT_ID || 'hub-metachat',
        userProfileDir,
        workspacePath: process.cwd(),
        configHash: 'metachat',
        executionPolicy: {
          mode: 'permissive',
          outsideAccessDenied: false,
          manualCommandReview: false,
          filesystemIsolation: false
        }
      };
    }
    if (!projectId) throw new Error('NATIVE_WORKSPACE_PROJECT_REQUIRED');

    let record: NativeWorkspaceRecord;
    try {
      record = this.get(projectId);
    } catch (err: any) {
      const proj = db.prepare('SELECT active_account_profile_id FROM projects WHERE id = ?').get(projectId) as any;
      const effectiveAccount = proj?.active_account_profile_id || 'acc-pro-1';
      const targetHome = env?.USERPROFILE || process.env.USERPROFILE || os.homedir();
      try {
        record = this.ensureBinding(projectId, effectiveAccount, targetHome);
      } catch (ensureErr) {
        throw err;
      }
    }

    // Check if project has switched active account profile or profile home directory
    const projRow = db.prepare('SELECT active_account_profile_id FROM projects WHERE id = ?').get(projectId) as any;
    if (
      (projRow?.active_account_profile_id && projRow.active_account_profile_id !== record.accountProfileId) ||
      (env?.USERPROFILE && normalizeRuntimePath(env.USERPROFILE) !== normalizeRuntimePath(record.userProfileDir))
    ) {
      const effectiveAccount = projRow?.active_account_profile_id || record.accountProfileId;
      const activeProf = db.prepare('SELECT id, environment_path FROM account_profiles WHERE id = ?').get(effectiveAccount) as any;
      const targetHome = env?.USERPROFILE || activeProf?.environment_path || record.userProfileDir;
      try {
        record = this.resolve(projectId, effectiveAccount, targetHome, true);
      } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "nativeWorkspaceBinding",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:nativeWorkspaceBinding]", err);
      }
    }
    }

    if (
      env?.ANTIGRAVITY_PROJECT_ID &&
      env.ANTIGRAVITY_PROJECT_ID !== record.nativeProjectId
    ) {
      Logger.warn(`[NativeWorkspaceBinding] Alinhando nativeProjectId (${record.nativeProjectId} -> ${env.ANTIGRAVITY_PROJECT_ID}) para projeto ${projectId}`);
      try {
        db.prepare('UPDATE native_workspace_bindings SET native_project_id = ?, updated_at = ? WHERE project_id = ?')
          .run(env.ANTIGRAVITY_PROJECT_ID, new Date().toISOString(), projectId);
        record.nativeProjectId = env.ANTIGRAVITY_PROJECT_ID;
      } catch (bindErr: any) {
        Logger.warn(`[NativeWorkspaceBinding] Erro ao alinhar nativeProjectId: ${bindErr.message}`);
      }
    }

    if (
      !env?.USERPROFILE ||
      normalizeRuntimePath(env.USERPROFILE) !== normalizeRuntimePath(record.userProfileDir)
    ) {
      if (env?.USERPROFILE) {
        try {
          // Espelha o nativeProjectId.json para o diretório de destino se ainda não existir
          const sourceDir = path.join(record.userProfileDir, '.gemini', 'config', 'projects');
          const targetDir = path.join(env.USERPROFILE, '.gemini', 'config', 'projects');
          const sourceFile = path.join(sourceDir, `${record.nativeProjectId}.json`);
          const targetFile = path.join(targetDir, `${record.nativeProjectId}.json`);
          if (fs.existsSync(sourceFile) && !fs.existsSync(targetFile)) {
            fs.mkdirSync(targetDir, { recursive: true });
            fs.copyFileSync(sourceFile, targetFile);
          } else if (fs.existsSync(targetFile) && !fs.existsSync(sourceFile)) {
            fs.mkdirSync(sourceDir, { recursive: true });
            fs.copyFileSync(targetFile, sourceFile);
          }
          record = this.resolve(projectId, record.accountProfileId, env.USERPROFILE, true);
        } catch {
          // Se o runtime conectado for o global ou secundário, aceita e atualiza o userProfileDir sem lançar erro de mismatch
          record.userProfileDir = env.USERPROFILE;
        }
      } else {
        if (!record.userProfileDir) {
          record.userProfileDir = os.homedir();
        }
      }
    }
    return record;
  }
}