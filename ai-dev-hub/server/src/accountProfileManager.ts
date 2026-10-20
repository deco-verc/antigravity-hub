import { execFileSync, execSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { db, HUB_DATA_DIR } from './db.js';
import { Logger } from './logger.js';
import { GitManager } from './gitManager.js';
import { CheckpointManager } from './checkpointManager.js';
import { MemoryManager } from './memoryManager.js';
import { getLanguageServerExe } from './antigravityProvider.js';
import { AntigravityDiscovery } from './antigravityDiscovery.js';
import { ConversationManager } from './conversationManager.js';
import {
  selectProfileRuntime,
  collectRuntimeProcessSnapshot,
  profileUserDataDirectory,
  normalizeRuntimePath,
  ProfileRuntimeBinding,
  RuntimeProfileSelectionError
} from './runtimeProfileSelector.js';
import { NativeWorkspaceBinding } from './nativeWorkspaceBinding.js';

export type AuthStatus =
  | 'READY'
  | 'DETECTED'
  | 'WAITING_LOGIN'
  | 'VERIFYING'
  | 'LOGIN_REQUIRED'
  | 'ACTIVE'
  | 'ERROR'
  | 'OFFLINE'
  | 'NEEDS_LOGIN'
  | 'AUTHENTICATING'
  | 'QUOTA_EXHAUSTED'
  | 'NOT_CONFIGURED'
  | 'RATE_LIMITED'
  | 'AUTH_ERROR'
  | 'AUTH_UNKNOWN'
  | 'RUNTIME_UNAVAILABLE'
  | 'UNKNOWN';

export interface AccountProfile {
  id: string;
  name?: string;
  display_name: string;
  profile_name: string;
  email?: string | null;
  google_account_label: string | null;
  environment_path: string;
  auth_status: AuthStatus;
  is_active?: boolean;
  last_tested: string | null;
  quota_resets_at?: string | null;
  quota_message?: string | null;
  created_at: string;
  updated_at: string;
}

export interface AccountProjectSession {
  id: string;
  project_id: string;
  account_profile_id: string;
  conversation_id: string;
  last_active_at: string;
  metadata_json: string | null;
  created_at: string;
}

export interface RapidSwitchResult {
  switched: boolean;
  previousProfile: AccountProfile;
  activeProfile: AccountProfile;
  runtimeOnline: boolean;
  runtimeAddress: string | null;
  conversationId: string;
  checkpointCreated: boolean;
  message: string;
}

export interface AutoFailoverResult {
  switched: boolean;
  previousProfileId: string;
  activeProfile: AccountProfile;
  kind: 'QUOTA' | 'AUTH' | 'RUNTIME' | 'NONE';
  message: string;
}

const HUB_PROFILES_DIR = path.join(HUB_DATA_DIR, 'profiles');
if (!fs.existsSync(HUB_PROFILES_DIR)) {
  fs.mkdirSync(HUB_PROFILES_DIR, { recursive: true });
}

export class AccountProfileManager {
  private static _defaultRoamingPathOverride: string | null = null;

  static isOfflineMode(): boolean {
    try {
      const gateway = require('./agentApiGateway.js')?.AgentApiGateway;
      if (gateway && typeof gateway.isOfflineMode === 'function') {
        return gateway.isOfflineMode();
      }
    } catch {
      // fallback if require fails
    }
    if (process.env.DECOHUB_OFFLINE_MODE === 'false') return false;
    if (process.env.DECOHUB_OFFLINE_MODE === 'true') return true;
    if (process.env.NODE_ENV === 'test' && process.env.DECOHUB_ALLOW_LIVE_AGENTAPI !== 'true') return true;
    return false;
  }
  private static _verifyProbeOverride: ((profile: AccountProfile) => boolean) | null = null;
  private static runtimeBootLocks = new Map<string, number>();

  static setVerifyProbeOverrideForTest(probe: ((profile: AccountProfile) => boolean) | null): void {
    this._verifyProbeOverride = probe;
  }

  static get defaultRoamingPath(): string {
    if (this._defaultRoamingPathOverride) {
      return this._defaultRoamingPathOverride;
    }
    const isOffline = AccountProfileManager.isOfflineMode();
    return isOffline
      ? path.join(HUB_PROFILES_DIR, 'offline-default')
      : path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Antigravity');
  }

  static set defaultRoamingPath(value: string | null) {
    this._defaultRoamingPathOverride = value;
  }

  static isAutomatedTestRuntime(): boolean {
    return (
      AccountProfileManager.isOfflineMode() ||
      Boolean(this._verifyProbeOverride) ||
      process.env.NODE_ENV === 'test' ||
      process.execArgv.includes('--test')
    );
  }

  static getUserProfileDir(profile: AccountProfile): string {
    const isDefault = normalizeRuntimePath(profile.environment_path) === normalizeRuntimePath(this.defaultRoamingPath);
    return isDefault ? (process.env.USERPROFILE || os.homedir()) : profile.environment_path;
  }

  /**
   * Resolves the canonical --user-data-dir for a profile so launchLogin, auto-boot,
   * and runtimeProfileSelector always agree 100% on the exact directory path.
   */
  static resolveCanonicalUserDataDir(environmentPath: string): string {
    const isDefault = normalizeRuntimePath(environmentPath) === normalizeRuntimePath(this.defaultRoamingPath);
    if (isDefault) {
      return this.defaultRoamingPath;
    }
    try {
      const selected = profileUserDataDirectory(environmentPath, this.defaultRoamingPath);
      if (selected && selected.trim().length > 0) {
        return path.resolve(selected);
      }
    } catch {}
    return path.join(environmentPath, 'AppData', 'Roaming', 'Antigravity');
  }

  /**
   * Ensures all required profile subdirectories exist and synchronizes app_storage.json
   * across userData and AppData/Roaming/Antigravity so previously authenticated accounts
   * never lose their session due to directory path differences.
   */
  static ensureProfileDirectoriesAndSyncAuth(environmentPath: string): string {
    if (!environmentPath) return environmentPath;
    const isDefault = normalizeRuntimePath(environmentPath) === normalizeRuntimePath(this.defaultRoamingPath);
    if (isDefault) {
      return this.defaultRoamingPath;
    }

    const canonicalUserDataDir = this.resolveCanonicalUserDataDir(environmentPath);
    const appDataRoaming = path.join(environmentPath, 'AppData', 'Roaming');
    const appDataLocal = path.join(environmentPath, 'AppData', 'Local');
    const roamingAntigravity = path.join(appDataRoaming, 'Antigravity');
    const legacyUserData = path.join(environmentPath, 'userData');
    const geminiConfigDir = path.join(environmentPath, '.gemini', 'config', 'projects');
    const geminiCliDir = path.join(environmentPath, '.gemini', 'antigravity-cli', 'cache');
    const geminiBrainDir = path.join(environmentPath, '.gemini', 'antigravity', 'brain');

    try {
      fs.mkdirSync(environmentPath, { recursive: true });
      fs.mkdirSync(canonicalUserDataDir, { recursive: true });
      fs.mkdirSync(roamingAntigravity, { recursive: true });
      fs.mkdirSync(appDataLocal, { recursive: true });
      fs.mkdirSync(legacyUserData, { recursive: true });
      fs.mkdirSync(geminiConfigDir, { recursive: true });
      fs.mkdirSync(geminiCliDir, { recursive: true });
      fs.mkdirSync(geminiBrainDir, { recursive: true });

      const outsideProjFile = path.join(geminiConfigDir, 'outside-of-project.json');
      if (!fs.existsSync(outsideProjFile)) {
        fs.writeFileSync(
          outsideProjFile,
          JSON.stringify(
            {
              id: 'outside-of-project',
              name: 'Outside of Project',
              settings: {
                fileAccessPolicy: 'AGENT_SETTING_POLICY_ALLOW',
                sandboxMode: false,
                autoExecutionPolicy: 'CASCADE_COMMANDS_AUTO_EXECUTION_EAGER',
                artifactReviewMode: 'ARTIFACT_REVIEW_MODE_TURBO'
              }
            },
            null,
            2
          ),
          'utf-8'
        );
      }

      // Synchronize app_storage.json across candidate directories if present in one of them
      const storageCandidates = Array.from(
        new Set([
          path.join(canonicalUserDataDir, 'app_storage.json'),
          path.join(roamingAntigravity, 'app_storage.json'),
          path.join(legacyUserData, 'app_storage.json'),
          path.join(environmentPath, 'app_storage.json')
        ])
      );

      let validSourceStorage: string | null = null;
      for (const candidate of storageCandidates) {
        if (fs.existsSync(candidate)) {
          try {
            const parsed = JSON.parse(fs.readFileSync(candidate, 'utf-8'));
            const user =
              parsed['jetski.onboarding.lastLoginUsername'] ||
              parsed['antigravity.onboarding.lastLoginUsername'] ||
              parsed['account.email'];
            if (typeof user === 'string' && user.includes('@')) {
              validSourceStorage = candidate;
              break;
            }
          } catch {}
        }
      }

      if (validSourceStorage) {
        for (const target of [
          path.join(canonicalUserDataDir, 'app_storage.json'),
          path.join(roamingAntigravity, 'app_storage.json'),
          path.join(legacyUserData, 'app_storage.json')
        ]) {
          if (path.resolve(target) !== path.resolve(validSourceStorage) && !fs.existsSync(target)) {
            try {
              fs.copyFileSync(validSourceStorage, target);
            } catch {}
          }
        }
      }
    } catch {}

    return canonicalUserDataDir;
  }

  /**
   * Builds a clean, isolated environment for spawning or communicating with a profile's Antigravity runtime
   */
  private static buildIsolatedSpawnEnv(profile: AccountProfile): NodeJS.ProcessEnv {
    const cleanEnv: NodeJS.ProcessEnv = { ...process.env };
    delete cleanEnv.ELECTRON_RUN_AS_NODE;
    delete cleanEnv.ELECTRON_NO_ASAR;
    delete cleanEnv.ELECTRON_OZONE_PLATFORM_HINT;
    delete cleanEnv.ELECTRON_ENABLE_LOGGING;

    for (const k of Object.keys(cleanEnv)) {
      if (k.startsWith('ANTIGRAVITY_') || k.startsWith('AGY_') || k.startsWith('CODEIUM_')) {
        delete cleanEnv[k];
      }
    }

    const isLegacyDefault =
      normalizeRuntimePath(profile.environment_path) === normalizeRuntimePath(this.defaultRoamingPath);
    const userProfileDir = isLegacyDefault ? (process.env.USERPROFILE || os.homedir()) : profile.environment_path;
    const profileAppData = isLegacyDefault
      ? this.defaultRoamingPathParent()
      : path.join(profile.environment_path, 'AppData', 'Roaming');
    const profileLocalAppData = isLegacyDefault
      ? (process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'))
      : path.join(profile.environment_path, 'AppData', 'Local');

    cleanEnv.USERPROFILE = userProfileDir;
    cleanEnv.HOME = userProfileDir;
    cleanEnv.APPDATA = profileAppData;
    cleanEnv.LOCALAPPDATA = profileLocalAppData;
    cleanEnv.AGY_CLI_DISABLE_AUTO_UPDATE = 'true';

    if (process.platform === 'win32') {
      const parsedPath = path.parse(userProfileDir);
      if (parsedPath.root) {
        cleanEnv.HOMEDRIVE = parsedPath.root.replace(/[\\/]+$/, '');
        cleanEnv.HOMEPATH = userProfileDir.slice(cleanEnv.HOMEDRIVE.length) || '\\';
      }
    }

    return cleanEnv;
  }

  /**
   * Initializes default profiles if not present in the database.
   * Profile A: Main Google Account (dynamically detected)
   * Profile B: Secondary Account placeholder/prepared
   */
  static initDefaultProfiles(): void {
    const existing = this.getAllProfiles();
    const now = new Date().toISOString();

    let detectedUser: string | null = null;
    const storageFile = path.join(this.defaultRoamingPath, 'app_storage.json');
    if (fs.existsSync(storageFile)) {
      try {
        const content = JSON.parse(fs.readFileSync(storageFile, 'utf-8'));
        if (content['jetski.onboarding.lastLoginUsername']) {
          detectedUser = content['jetski.onboarding.lastLoginUsername'];
        }
      } catch {}
    }

    // Check Account A
    const profileA = existing.find(p => p.id === 'acc-pro-1' || p.profile_name === 'google_pro_1');
    if (!profileA) {
      db.prepare(`
        INSERT INTO account_profiles (id, display_name, profile_name, google_account_label, environment_path, auth_status, last_tested, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'acc-pro-1',
        'Google Pro 1',
        'google_pro_1',
        detectedUser,
        this.defaultRoamingPath,
        this.isOfflineMode() || this.isAutomatedTestRuntime() ? 'READY' : 'WAITING_LOGIN',
        now,
        now,
        now
      );
      Logger.info(`[AccountProfileManager] Perfil inicial Google Pro 1 (${detectedUser || 'pronto'}) registrado.`);
    } else if (detectedUser && profileA.google_account_label !== detectedUser) {
      db.prepare(`
        UPDATE account_profiles
        SET google_account_label = ?, updated_at = ?
        WHERE id = ?
      `).run(detectedUser, now, profileA.id);
      Logger.info(`[AccountProfileManager] Perfil Google Pro 1 sincronizado com conta real: ${detectedUser}`);
    }

    // Check Account B
    const profileB = existing.find(p => p.id === 'acc-pro-2' || p.profile_name === 'google_pro_2');
    if (!profileB) {
      const envPathB = path.join(HUB_PROFILES_DIR, 'google_pro_2');
      this.ensureProfileDirectoriesAndSyncAuth(envPathB);

      db.prepare(`
        INSERT INTO account_profiles (id, display_name, profile_name, google_account_label, environment_path, auth_status, last_tested, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'NEEDS_LOGIN', NULL, ?, ?)
      `).run('acc-pro-2', 'Google Pro 2', 'google_pro_2', null, envPathB, now, now);
      Logger.info(`[AccountProfileManager] Perfil secundário Google Pro 2 preparado em ${envPathB}.`);
    } else {
      this.ensureProfileDirectoriesAndSyncAuth(profileB.environment_path);
    }

    // Re-verify profiles with local OAuth evidence on startup in live mode
    if (!AccountProfileManager.isOfflineMode()) {
      try {
        const allRows: any[] = db.prepare('SELECT id, auth_status, environment_path FROM account_profiles').all();
        for (const r of allRows) {
          this.ensureProfileDirectoriesAndSyncAuth(r.environment_path);
          if (r.auth_status === 'WAITING_LOGIN' || r.auth_status === 'AUTH_UNKNOWN' || r.auth_status === 'NEEDS_LOGIN') {
            const evidence = this.inspectLocalAuthEvidence(r.environment_path);
            if (evidence.hasAuthEvidence) {
              this.verifyProfile(r.id);
            }
          }
        }
      } catch (err: any) {
        Logger.warn(`[AccountProfileManager] Aviso ao reconciliar perfis na inicialização: ${err.message}`);
      }
    }
  }

  static getAllProfiles(): AccountProfile[] {
    const rows: any[] = db.prepare('SELECT * FROM account_profiles ORDER BY created_at ASC').all();
    const profiles = rows.map(this._rowToProfile);
    return profiles.map(p => this.checkAndRefreshQuotaStatus(p.id) || p);
  }

  static getProfile(id: string): AccountProfile | null {
    const refreshed = this.checkAndRefreshQuotaStatus(id);
    if (refreshed) return refreshed;
    const row: any = db.prepare('SELECT * FROM account_profiles WHERE id = ? OR profile_name = ?').get(id, id);
    if (!row) return null;
    return this._rowToProfile(row);
  }

  /**
   * Returns all valid profiles that are authenticated and available for tasks
   */
  static getReadyProfiles(): AccountProfile[] {
    return this.getAllProfiles().filter(p => this.isAccountAvailableForTasks(p.id));
  }

  /**
   * Finds the next available READY profile in round-robin order for Rapid Switch / Quota Failover
   */
  static getNextAvailableProfile(excludeProfileId?: string): AccountProfile | null {
    const all = this.getAllProfiles();
    const readyList = all.filter(p => {
      if (excludeProfileId && p.id === excludeProfileId) return false;
      if (p.auth_status === 'QUOTA_EXHAUSTED' || p.auth_status === 'LOGIN_REQUIRED' || p.auth_status === 'ERROR') {
        return false;
      }
      if (p.quota_resets_at && new Date(p.quota_resets_at).getTime() > Date.now()) {
        return false;
      }
      const evidence = this.inspectLocalAuthEvidence(p.environment_path);
      return (p.auth_status === 'READY' || p.auth_status === 'ACTIVE') && (evidence.hasAuthEvidence || this.isAutomatedTestRuntime());
    });

    if (readyList.length === 0) return null;

    if (excludeProfileId) {
      const currentIdx = all.findIndex(p => p.id === excludeProfileId);
      if (currentIdx !== -1) {
        for (let offset = 1; offset <= all.length; offset++) {
          const candidate = all[(currentIdx + offset) % all.length];
          if (readyList.some(r => r.id === candidate.id)) {
            return candidate;
          }
        }
      }
    }

    return readyList[0];
  }

  static getGlobalActiveProfile(): AccountProfile {
    try {
      const setting: any = db.prepare("SELECT value FROM system_settings WHERE key = 'active_account_profile_id'").get();
      if (setting?.value) {
        const p = this.getProfile(setting.value);
        if (p) return p;
      }
    } catch {}
    const all = this.getAllProfiles();
    const ready = all.find(p => p.auth_status === 'READY') || all[0];
    return (
      ready || {
        id: 'acc-pro-1',
        display_name: 'Google Pro 1',
        profile_name: 'google_pro_1',
        google_account_label: null,
        environment_path: this.defaultRoamingPath,
        auth_status: 'WAITING_LOGIN',
        last_tested: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }
    );
  }

  static setGlobalActiveProfile(profileId: string): void {
    const profile = this.getProfile(profileId);
    if (!profile) {
      throw new Error(`Perfil ${profileId} não encontrado.`);
    }
    const now = new Date().toISOString();
    try {
      db.prepare(`
        INSERT INTO system_settings (key, value, updated_at)
        VALUES ('active_account_profile_id', ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `).run(profile.id, now);
      Logger.info(`[AccountProfileManager] Conta ativa global definida para: "${profile.display_name}" (${profile.id})`);
    } catch (e: any) {
      Logger.warn(`[AccountProfileManager] Erro ao salvar active_account_profile_id em system_settings: ${e.message}`);
    }
  }

  static getActiveProfileForProject(projectId?: string): AccountProfile {
    if (projectId) {
      try {
        const project: any = db.prepare('SELECT active_account_profile_id FROM projects WHERE id = ?').get(projectId);
        if (project?.active_account_profile_id) {
          const p = this.getProfile(project.active_account_profile_id);
          if (p) return p;
        }
        const defaultProf = this.getGlobalActiveProfile();
        db.prepare('UPDATE projects SET active_account_profile_id = ?, updated_at = ? WHERE id = ?')
          .run(defaultProf.id, new Date().toISOString(), projectId);
        return defaultProf;
      } catch {}
    }
    return this.getGlobalActiveProfile();
  }

  static createProfile(opts: {
    displayName: string;
    profileName?: string;
    googleAccountLabel?: string;
  }): AccountProfile {
    const trimmedDisplay = (opts.displayName || '').trim();
    if (!trimmedDisplay) {
      throw new Error('Nome da conta / perfil é obrigatório.');
    }

    const now = new Date().toISOString();
    const id = `acc-pro-${crypto.randomUUID().slice(0, 6)}`;

    let baseSafeName =
      opts.profileName || trimmedDisplay.toLowerCase().replace(/[^a-z0-9_]/g, '_') || `profile_${Date.now()}`;
    baseSafeName = baseSafeName.replace(/^_+|_+$/g, '') || `profile_${Date.now()}`;
    let safeName = baseSafeName;

    const existingByName = db.prepare('SELECT id FROM account_profiles WHERE profile_name = ?').get(safeName);
    if (existingByName) {
      safeName = `${baseSafeName}_${crypto.randomUUID().slice(0, 4)}`;
    }

    const envPath = path.join(HUB_PROFILES_DIR, safeName);
    this.ensureProfileDirectoriesAndSyncAuth(envPath);

    const accountLabel = opts.googleAccountLabel?.trim() || null;
    const initialStatus: AuthStatus = 'WAITING_LOGIN';

    db.prepare(`
      INSERT INTO account_profiles (id, display_name, profile_name, google_account_label, environment_path, auth_status, last_tested, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)
    `).run(id, trimmedDisplay, safeName, accountLabel, envPath, initialStatus, now, now);

    Logger.info(`[AccountProfileManager] Novo perfil criado: ${id} ("${trimmedDisplay}") em ${envPath}`);
    return this.getProfile(id)!;
  }

  static updateProfile(
    profileId: string,
    data: {
      displayName?: string;
      googleAccountLabel?: string | null;
      authStatus?: AuthStatus;
    }
  ): AccountProfile {
    const profile = this.getProfile(profileId);
    if (!profile) {
      throw new Error(`Perfil ${profileId} não encontrado.`);
    }

    const now = new Date().toISOString();
    const newDisplayName = data.displayName?.trim() || profile.display_name;
    const newAccountLabel =
      data.googleAccountLabel !== undefined
        ? data.googleAccountLabel
          ? data.googleAccountLabel.trim()
          : null
        : profile.google_account_label;
    // Profile metadata edits are never authentication evidence.
    const newStatus = profile.auth_status;

    db.prepare(`
      UPDATE account_profiles
      SET display_name = ?,
          google_account_label = ?,
          auth_status = ?,
          updated_at = ?
      WHERE id = ?
    `).run(newDisplayName, newAccountLabel, newStatus, now, profileId);

    Logger.info(
      `[AccountProfileManager] Perfil ${profileId} atualizado: "${newDisplayName}", conta=${newAccountLabel || 'não definida'}, status=${newStatus}`
    );
    return this.getProfile(profileId)!;
  }

  static deleteProfile(
    profileId: string,
    opts: { deleteData?: boolean } = {}
  ): { success: boolean; message: string; fallbackProfileId?: string } {
    const profile = this.getProfile(profileId);
    if (!profile) {
      throw new Error(`Perfil ${profileId} não encontrado.`);
    }

    const all = this.getAllProfiles();
    if (all.length <= 1) {
      throw new Error(
        `Não é possível remover a única conta cadastrada no sistema. Cadastre outra conta antes de remover esta.`
      );
    }

    const remaining = all.filter(p => p.id !== profileId);
    const fallback = remaining.find(p => p.auth_status === 'READY') || remaining[0];

    const globalActive = this.getGlobalActiveProfile();
    if (globalActive.id === profileId) {
      this.setGlobalActiveProfile(fallback.id);
    }

    db.prepare(`
      UPDATE projects
      SET active_account_profile_id = ?, updated_at = ?
      WHERE active_account_profile_id = ?
    `).run(fallback.id, new Date().toISOString(), profileId);

    try {
      const runningInstance = this.getRunningInstanceForProfile(profile.environment_path);
      if (runningInstance && runningInstance.pid) {
        try {
          process.kill(runningInstance.pid, 'SIGTERM');
        } catch {}
      }
    } catch {}

    db.prepare(`DELETE FROM account_project_sessions WHERE account_profile_id = ?`).run(profileId);
    db.prepare(`DELETE FROM account_profiles WHERE id = ?`).run(profileId);

    const resolvedProfilePath = path.resolve(profile.environment_path);
    const resolvedProfilesRoot = path.resolve(HUB_PROFILES_DIR);
    if (
      opts.deleteData &&
      path.dirname(resolvedProfilePath) === resolvedProfilesRoot &&
      fs.existsSync(resolvedProfilePath)
    ) {
      try {
        fs.rmSync(resolvedProfilePath, { recursive: true, force: true });
        Logger.info(`[AccountProfileManager] Diretório do perfil removido: ${profile.environment_path}`);
      } catch (e: any) {
        Logger.warn(`[AccountProfileManager] Aviso ao remover diretório ${profile.environment_path}: ${e.message}`);
      }
    }

    Logger.info(
      `[AccountProfileManager] Perfil "${profile.display_name}" (${profileId}) removido. Projetos reatribuídos para "${fallback.display_name}".`
    );

    return {
      success: true,
      message: `Perfil "${profile.display_name}" removido com sucesso. Projetos vinculados foram reatribuídos para "${fallback.display_name}".`,
      fallbackProfileId: fallback.id
    };
  }

  static launchLogin(profileId: string): { success: boolean; message: string; pid?: number } {
    if (AccountProfileManager.isOfflineMode()) throw new Error('OFFLINE_GUARD: login real bloqueado em sandbox/testes.');
    const profile = this.getProfile(profileId);
    if (!profile) {
      throw new Error(`Perfil ${profileId} não encontrado.`);
    }

    const antigravityExe = AntigravityDiscovery.getAntigravityAppExe();
    if (!antigravityExe) {
      throw new Error(
        `Executável do Antigravity (Antigravity.exe) não foi localizado nos diretórios padrão do sistema.`
      );
    }

    const canonicalUserDataDir = this.ensureProfileDirectoriesAndSyncAuth(profile.environment_path);
    const isLegacyDefault =
      normalizeRuntimePath(profile.environment_path) === normalizeRuntimePath(this.defaultRoamingPath);

    Logger.info(
      `[AccountProfileManager] Abrindo janela do Antigravity para autenticação no perfil "${profile.display_name}" (userDataDir: ${canonicalUserDataDir})...`
    );

    const cleanEnv = this.buildIsolatedSpawnEnv(profile);
    const args = isLegacyDefault ? [] : [`--user-data-dir=${canonicalUserDataDir}`];

    const child = spawn(antigravityExe, args, {
      detached: true,
      stdio: 'ignore',
      env: cleanEnv,
      windowsHide: false
    });
    child.on('error', err => {
      Logger.warn(`[AccountProfileManager] Falha ao spawnar processo Antigravity: ${err.message}`);
    });
    if (!child.pid) throw new Error('Falha ao iniciar Antigravity: processo sem PID.');
    child.unref();
    const launchedPid = child.pid;
    Logger.info(`[AccountProfileManager] Antigravity aberto para perfil ${profile.id} com PID ${launchedPid}`);
    this.updateStatus(profileId, 'WAITING_LOGIN');

    return {
      success: true,
      message: `Janela do Antigravity aberta em perfil isolado para autenticação da conta Google no perfil "${profile.display_name}". Realize o login no aplicativo.`,
      pid: launchedPid
    };
  }

  /**
   * Synchronously ensures that a valid/authenticated profile has its own isolated Antigravity + language_server
   * runtime running in the background, eliminating the need to keep that account's window manually open.
   */
  static ensureProfileRuntimeRunningSync(
    profile: AccountProfile,
    timeoutMs = 14000
  ): { address: string; csrfToken: string; pid: number } | null {
    if (this.isAutomatedTestRuntime()) return null;

    const existing = this.getRunningInstanceForProfile(profile.environment_path);
    if (existing) return existing;

    const antigravityExe = AntigravityDiscovery.getAntigravityAppExe();
    if (!antigravityExe) return null;

    const canonicalUserDataDir = this.ensureProfileDirectoriesAndSyncAuth(profile.environment_path);
    const evidence = this.inspectLocalAuthEvidence(profile.environment_path);
    if (!evidence.hasAuthEvidence) {
      return null;
    }

    const isLegacyDefault =
      normalizeRuntimePath(profile.environment_path) === normalizeRuntimePath(this.defaultRoamingPath);

    const lastBootAttempt = this.runtimeBootLocks.get(profile.id) || 0;
    if (Date.now() - lastBootAttempt > 8000) {
      this.runtimeBootLocks.set(profile.id, Date.now());
      try {
        const cleanEnv = this.buildIsolatedSpawnEnv(profile);
        const args = isLegacyDefault ? [] : [`--user-data-dir=${canonicalUserDataDir}`];
        Logger.info(
          `[AccountProfileManager] Auto-iniciando runtime isolado em background para a conta "${profile.display_name}" (${profile.id})...`
        );
        const child = spawn(antigravityExe, args, {
          detached: true,
          stdio: 'ignore',
          env: cleanEnv,
          windowsHide: true
        });
        child.on('error', err => {
          Logger.warn(`[AccountProfileManager] Aviso no auto-boot do perfil ${profile.id}: ${err.message}`);
        });
        child.unref();
      } catch (spawnErr: any) {
        Logger.warn(`[AccountProfileManager] Falha ao iniciar runtime do perfil ${profile.id}: ${spawnErr.message}`);
        return null;
      }
    }

    // Wait synchronously (zero CPU spin via Atomics.wait) for child language_server.exe to bind port & CSRF token
    const deadline = Date.now() + timeoutMs;
    const waitBuffer = new Int32Array(new SharedArrayBuffer(4));
    while (Date.now() < deadline) {
      Atomics.wait(waitBuffer, 0, 0, 600);
      this.ensureProfileDirectoriesAndSyncAuth(profile.environment_path);
      const instance = this.getRunningInstanceForProfile(profile.environment_path);
      if (instance) {
        Logger.success(
          `[AccountProfileManager] Runtime da conta "${profile.display_name}" (${profile.id}) ativo em ${instance.address} (PID ${instance.pid}).`
        );
        return instance;
      }
    }

    return this.getRunningInstanceForProfile(profile.environment_path);
  }

  /**
   * Asynchronous wrapper to boot or verify a profile's background runtime on demand
   */
  static async ensureProfileRuntimeRunning(
    profileOrId: string | AccountProfile,
    timeoutMs = 14000
  ): Promise<{ address: string; csrfToken: string; pid: number } | null> {
    const profile = typeof profileOrId === 'string' ? this.getProfile(profileOrId) : profileOrId;
    if (!profile || this.isAutomatedTestRuntime()) return null;

    const existing = this.getRunningInstanceForProfile(profile.environment_path);
    if (existing) return existing;

    return this.ensureProfileRuntimeRunningSync(profile, timeoutMs);
  }

  private static defaultRoamingPathParent(): string {
    return path.dirname(this.defaultRoamingPath);
  }

  static getDetectedSystemAccounts(): string[] {
    const detected = new Set<string>();

    try {
      const defaultStorage = path.join(this.defaultRoamingPath, 'app_storage.json');
      if (fs.existsSync(defaultStorage)) {
        const content = JSON.parse(fs.readFileSync(defaultStorage, 'utf-8'));
        if (content['jetski.onboarding.lastLoginUsername']) {
          detected.add(content['jetski.onboarding.lastLoginUsername']);
        }
      }
    } catch {}

    try {
      const rows: any[] = db
        .prepare('SELECT google_account_label, environment_path FROM account_profiles')
        .all();
      for (const r of rows) {
        if (r.google_account_label && r.google_account_label.includes('@')) {
          detected.add(r.google_account_label.trim());
        }
        if (r.environment_path) {
          const ev = this.inspectLocalAuthEvidence(r.environment_path);
          if (ev.detectedUser && ev.detectedUser.includes('@')) {
            detected.add(ev.detectedUser.trim());
          }
        }
      }
    } catch {}

    return Array.from(detected);
  }

  static inspectLocalAuthEvidence(environmentPath: string): {
    exists: boolean;
    detectedUser: string | null;
    onboardingCompleted: boolean;
    hasAuthEvidence: boolean;
    storagePath: string | null;
  } {
    if (!environmentPath || !fs.existsSync(environmentPath)) {
      return {
        exists: false,
        detectedUser: null,
        onboardingCompleted: false,
        hasAuthEvidence: false,
        storagePath: null
      };
    }

    const isDefault =
      path.resolve(environmentPath).toLowerCase() === path.resolve(this.defaultRoamingPath).toLowerCase();

    const canonicalUserData = this.resolveCanonicalUserDataDir(environmentPath);
    const candidatePaths: string[] = Array.from(
      new Set([
        path.join(canonicalUserData, 'app_storage.json'),
        path.join(environmentPath, 'AppData', 'Roaming', 'Antigravity', 'app_storage.json'),
        path.join(environmentPath, 'userData', 'app_storage.json'),
        path.join(environmentPath, 'app_storage.json'),
        ...(isDefault ? [path.join(this.defaultRoamingPath, 'app_storage.json')] : [])
      ])
    );

    let detectedUser: string | null = null;
    let matchedStoragePath: string | null = null;

    for (const storagePath of candidatePaths) {
      if (fs.existsSync(storagePath)) {
        try {
          const content = JSON.parse(fs.readFileSync(storagePath, 'utf-8'));
          const rawUser =
            content['jetski.onboarding.lastLoginUsername'] ||
            content['antigravity.onboarding.lastLoginUsername'] ||
            content['account.email'] ||
            content['user.email'];
          if (typeof rawUser === 'string' && rawUser.trim().length > 0 && rawUser.includes('@')) {
            detectedUser = rawUser.trim();
            matchedStoragePath = storagePath;
            break;
          }
        } catch {}
      }
    }

    let onboardingCompleted = false;
    try {
      const homeDir = isDefault ? (process.env.USERPROFILE || os.homedir()) : environmentPath;
      const stateFile = path.join(homeDir, '.gemini', 'antigravity', 'antigravity_state.pbtxt');
      if (fs.existsSync(stateFile)) {
        const pbtxt = fs.readFileSync(stateFile, 'utf-8');
        if (pbtxt.includes('AGENT_ONBOARDING_STATE_COMPLETED')) {
          onboardingCompleted = true;
          if (!detectedUser) {
            const emailMatch = pbtxt.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
            if (emailMatch && emailMatch[1]) {
              detectedUser = emailMatch[1].trim();
              matchedStoragePath = stateFile;
            }
          }
        }
      } else if (detectedUser) {
        onboardingCompleted = true;
      }

      // Check Antigravity 2.0 CLI settings.json (GEMINI_API_KEY mode per official docs)
      const cliSettingsPath = path.join(homeDir, '.gemini', 'antigravity-cli', 'settings.json');
      if (!detectedUser && fs.existsSync(cliSettingsPath)) {
        const cliSettings = JSON.parse(fs.readFileSync(cliSettingsPath, 'utf-8'));
        if (cliSettings?.modelProvider === 'gemini' && (process.env.GEMINI_API_KEY || cliSettings?.apiKey)) {
          detectedUser = 'gemini-api-key@antigravity.local';
          onboardingCompleted = true;
          matchedStoragePath = cliSettingsPath;
        }
      }
    } catch {}

    const hasAuthEvidence = Boolean(detectedUser && detectedUser.includes('@'));
    return {
      exists: true,
      detectedUser,
      onboardingCompleted,
      hasAuthEvidence,
      storagePath: matchedStoragePath
    };
  }

  static verifyProfile(
    profileId: string,
    _manualEmail?: string
  ): {
    profile: AccountProfile;
    tested: boolean;
    hasSession: boolean;
    account: string | null;
    status: AuthStatus;
    reason?: string;
  } {
    const profile = this.getProfile(profileId);
    if (!profile) {
      throw new Error(`Perfil ${profileId} não encontrado.`);
    }

    this.updateStatus(profile.id, 'VERIFYING');
    let determinedStatus: AuthStatus = 'LOGIN_REQUIRED';
    let statusReason = '';
    let hasSession = false;

    // 1. Mock Probe Override (for deterministic unit tests)
    if (this._verifyProbeOverride) {
      try {
        hasSession = this._verifyProbeOverride(profile);
        determinedStatus = hasSession ? 'READY' : 'LOGIN_REQUIRED';
        statusReason = hasSession ? 'Sessão mock verificada com sucesso' : 'Sessão mock não autorizada';
      } catch (err: any) {
        determinedStatus = 'ERROR';
        statusReason = `Verificação probe mock falhou: ${err.message}`;
      }
    } else {
      // Ensure profile folders & storage files are synced before inspecting
      if (fs.existsSync(profile.environment_path)) {
        this.ensureProfileDirectoriesAndSyncAuth(profile.environment_path);
      }
      const evidence = this.inspectLocalAuthEvidence(profile.environment_path);

      if (!evidence.exists) {
        determinedStatus = 'NOT_CONFIGURED';
        statusReason = `Diretório do perfil não existe: ${profile.environment_path}`;
        hasSession = false;
      } else {
        const detectedUser = evidence.detectedUser;

        const isQuotaExhausted = Boolean(
          profile.quota_resets_at && new Date(profile.quota_resets_at).getTime() > Date.now()
        );

        const appExe = AntigravityDiscovery.getAntigravityAppExe();
        const runningInstance = this.getRunningInstanceForProfile(profile.environment_path);

        if (!AccountProfileManager.isOfflineMode() && !appExe) {
          determinedStatus = 'RUNTIME_UNAVAILABLE';
          hasSession = false;
          statusReason = 'Executável do Antigravity não encontrado neste sistema.';
        } else if (!detectedUser || !evidence.hasAuthEvidence) {
          determinedStatus = 'LOGIN_REQUIRED';
          hasSession = false;
          statusReason =
            'Conta Google não autenticada no perfil (app_storage.json sem usuário logado). Conclua o login na janela do Antigravity.';
        } else if (isQuotaExhausted) {
          determinedStatus = 'QUOTA_EXHAUSTED';
          hasSession = true;
          statusReason =
            profile.quota_message ||
            `Limite de cota ativo até ${new Date(profile.quota_resets_at!).toLocaleTimeString()}`;
        } else {
          determinedStatus = 'READY';
          hasSession = true;
          statusReason = runningInstance
            ? `Conta Google "${detectedUser}" autenticada com sucesso e runtime Antigravity ativo em ${runningInstance.address}.`
            : `Conta Google "${detectedUser}" autenticada e pronta (runtime iniciará automaticamente sob demanda).`;
        }

        if (detectedUser && detectedUser !== profile.google_account_label) {
          try {
            db.prepare('UPDATE account_profiles SET google_account_label = ? WHERE id = ?').run(
              detectedUser,
              profile.id
            );
          } catch {}
        }
      }
    }

    const now = new Date().toISOString();
    db.prepare(`UPDATE account_profiles SET auth_status = ?, last_tested = ?, updated_at = ? WHERE id = ?`).run(
      determinedStatus,
      now,
      now,
      profile.id
    );
    const updated = this.getProfile(profile.id)!;
    return {
      profile: updated,
      tested: true,
      hasSession,
      account: updated.google_account_label,
      status: determinedStatus,
      reason: statusReason
    };
  }

  static disconnectProfile(profileId: string): {
    success: boolean;
    profile: AccountProfile;
    switchedToProfileId: string | null;
    message: string;
  } {
    const profile = this.getProfile(profileId);
    if (!profile) {
      throw new Error(`Perfil ${profileId} não encontrado.`);
    }

    const now = new Date().toISOString();
    const isDefault =
      path.resolve(profile.environment_path).toLowerCase() === path.resolve(this.defaultRoamingPath).toLowerCase();

    if (!isDefault || AccountProfileManager.isOfflineMode()) {
      const canonicalUserData = this.resolveCanonicalUserDataDir(profile.environment_path);
      const candidatePaths = Array.from(
        new Set([
          path.join(canonicalUserData, 'app_storage.json'),
          path.join(profile.environment_path, 'AppData', 'Roaming', 'Antigravity', 'app_storage.json'),
          path.join(profile.environment_path, 'userData', 'app_storage.json'),
          path.join(profile.environment_path, 'app_storage.json')
        ])
      );
      for (const storagePath of candidatePaths) {
        if (fs.existsSync(storagePath)) {
          try {
            const content = JSON.parse(fs.readFileSync(storagePath, 'utf-8'));
            delete content['jetski.onboarding.lastLoginUsername'];
            delete content['jetski.onboarding.lastLoginMethod'];
            delete content['antigravity.onboarding.lastLoginUsername'];
            fs.writeFileSync(storagePath, JSON.stringify(content, null, 2), 'utf-8');
          } catch {}
        }
      }

      const stateFile = path.join(profile.environment_path, '.gemini', 'antigravity', 'antigravity_state.pbtxt');
      if (fs.existsSync(stateFile)) {
        try {
          const pbtxt = fs.readFileSync(stateFile, 'utf-8');
          const cleaned = pbtxt.replace(/.*AGENT_ONBOARDING_STATE_COMPLETED.*\r?\n?/g, '');
          fs.writeFileSync(stateFile, cleaned, 'utf-8');
        } catch {}
      }
    }

    try {
      const runningInstance = this.getRunningInstanceForProfile(profile.environment_path);
      if (runningInstance && runningInstance.pid) {
        try {
          process.kill(runningInstance.pid, 'SIGTERM');
        } catch {}
      }
    } catch {}

    db.prepare(`
      UPDATE account_profiles
      SET auth_status = 'LOGIN_REQUIRED',
          google_account_label = NULL,
          quota_resets_at = NULL,
          quota_message = NULL,
          updated_at = ?
      WHERE id = ?
    `).run(now, profileId);

    try {
      db.prepare(`
        UPDATE agent_sessions
        SET status = 'ARCHIVED', last_used_at = ?, rotation_reason = 'ACCOUNT_DISCONNECTED'
        WHERE status = 'ACTIVE' AND json_valid(metadata_json) AND json_extract(metadata_json, '$.accountProfileId') = ?
      `).run(now, profileId);
      db.prepare('DELETE FROM account_project_sessions WHERE account_profile_id = ?').run(profileId);
    } catch {}

    let switchedToProfileId: string | null = null;
    const all = this.getAllProfiles();
    const fallback =
      all.find(p => p.id !== profileId && (p.auth_status === 'READY' || p.auth_status === 'ACTIVE')) || null;
    const globalActive = this.getGlobalActiveProfile();
    if (globalActive.id === profileId && fallback) {
      this.setGlobalActiveProfile(fallback.id);
      db.prepare(
        'UPDATE projects SET active_account_profile_id = ?, updated_at = ? WHERE active_account_profile_id = ?'
      ).run(fallback.id, now, profileId);
      switchedToProfileId = fallback.id;
    }

    const updated = this.getProfile(profileId)!;
    Logger.info(`[AccountProfileManager] Perfil "${profile.display_name}" (${profileId}) desconectado com sucesso.`);
    return {
      success: true,
      profile: updated,
      switchedToProfileId,
      message: switchedToProfileId
        ? `Conta "${profile.display_name}" desconectada. Conta ativa alternada automaticamente para "${fallback?.display_name}".`
        : `Conta "${profile.display_name}" desconectada com sucesso.`
    };
  }

  static updateStatus(profileId: string, status: AuthStatus): void {
    const current = this.getProfile(profileId);
    if (status === 'READY' && current?.quota_resets_at && new Date(current.quota_resets_at).getTime() > Date.now()) {
      return;
    }
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE account_profiles
      SET auth_status = ?, updated_at = ?
      WHERE id = ?
    `).run(status, now, profileId);
  }

  // ----------------------------------------------------------------
  // PROJECT SESSIONS PER ACCOUNT (Section 8)
  // ----------------------------------------------------------------

  static getProjectSession(projectId: string, accountProfileId: string): AccountProjectSession | null {
    const row: any = db
      .prepare(`
      SELECT * FROM account_project_sessions
      WHERE project_id = ? AND account_profile_id = ?
    `)
      .get(projectId, accountProfileId);
    if (!row) return null;
    return {
      id: row.id,
      project_id: row.project_id,
      account_profile_id: row.account_profile_id,
      conversation_id: row.conversation_id,
      last_active_at: row.last_active_at,
      metadata_json: row.metadata_json,
      created_at: row.created_at
    };
  }

  static setProjectSession(projectId: string, accountProfileId: string, conversationId: string): void {
    const now = new Date().toISOString();
    const existing = this.getProjectSession(projectId, accountProfileId);
    if (existing) {
      db.prepare(`
        UPDATE account_project_sessions
        SET conversation_id = ?, last_active_at = ?
        WHERE id = ?
      `).run(conversationId, now, existing.id);
    } else {
      const id = `sess-acc-${crypto.randomUUID().slice(0, 8)}`;
      db.prepare(`
        INSERT INTO account_project_sessions (id, project_id, account_profile_id, conversation_id, last_active_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, projectId, accountProfileId, conversationId, now, now);
    }
  }

  // ----------------------------------------------------------------
  // RUNNING INSTANCE & EXECUTION ENVIRONMENT DISCOVERY
  // ----------------------------------------------------------------

  /** Inspect a profile/process binding without reading credentials or calling agentapi. Never cached. */
  static getRuntimeBindingForProfile(envPath: string): ProfileRuntimeBinding | null {
    if (AccountProfileManager.isOfflineMode()) return null;
    const appExecutable = AntigravityDiscovery.getAntigravityAppExe();
    if (!appExecutable) return null;
    const expectedData = profileUserDataDirectory(envPath, this.defaultRoamingPath);
    const registered = db.prepare('SELECT environment_path FROM account_profiles').all() as Array<{
      environment_path: string;
    }>;
    const owners = registered.filter(
      p => profileUserDataDirectory(p.environment_path, this.defaultRoamingPath) === expectedData
    );
    if (owners.length > 1) throw new RuntimeProfileSelectionError('RUNTIME_DIRECTORY_SHARED_BY_PROFILES');
    const processes = collectRuntimeProcessSnapshot();
    const defaultLs = path.join(path.dirname(appExecutable), 'resources', 'bin', 'language_server.exe');
    let languageServerExecutable = defaultLs;
    try {
      const discovered = AntigravityDiscovery.discover();
      if (
        discovered.languageServerExe &&
        normalizeRuntimePath(discovered.languageServerExe).startsWith(normalizeRuntimePath(path.dirname(appExecutable)))
      ) {
        languageServerExecutable = discovered.languageServerExe;
      }
    } catch {}
    return selectProfileRuntime({
      profilePath: envPath,
      defaultPath: this.defaultRoamingPath,
      appExecutable,
      languageServerExecutable,
      processes
    });
  }

  static getRunningInstanceForProfile(envPath: string): { address: string; csrfToken: string; pid: number } | null {
    if (AccountProfileManager.isOfflineMode()) return null;
    try {
      const binding = this.getRuntimeBindingForProfile(envPath);
      if (!binding) return null;
      const script = `
        $ErrorActionPreference = 'Stop';
        $p = Get-CimInstance Win32_Process -Filter 'ProcessId = ${binding.pid}';
        $parent = Get-CimInstance Win32_Process -Filter 'ProcessId = ${binding.parentPid}';
        if (!$p -or !$parent -or $p.ParentProcessId -ne ${binding.parentPid}) { throw 'RUNTIME_CHANGED' };
        if ($p.CreationDate.ToString('o') -cne '${binding.started.replace(/'/g, "''")}' -or
            $parent.CreationDate.ToString('o') -cne '${binding.parentStarted.replace(/'/g, "''")}') { throw 'RUNTIME_CHANGED' };
        $ports = @(Get-NetTCPConnection -OwningProcess $p.ProcessId -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LocalPort -Unique);
        $port = if ($ports.Count) { ($ports | Measure-Object -Maximum).Maximum } else { $null };
        $match = [regex]::Match($p.CommandLine, '--csrf_token(?:=|\\s+)([a-zA-Z0-9_\\-]+)');
        [PSCustomObject]@{pid=$p.ProcessId; parentPid=$p.ParentProcessId; started=$p.CreationDate.ToString('o');
          parentStarted=$parent.CreationDate.ToString('o'); port=$port; csrfToken=if($match.Success){$match.Groups[1].Value}else{$null}} | ConvertTo-Json -Compress
      `;
      const connection = JSON.parse(
        execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
          encoding: 'utf8',
          timeout: 8000,
          windowsHide: true
        })
      );
      if (
        connection.pid !== binding.pid ||
        connection.parentPid !== binding.parentPid ||
        connection.started !== binding.started ||
        connection.parentStarted !== binding.parentStarted ||
        !Number.isInteger(connection.port) ||
        connection.port < 1 ||
        connection.port > 65535 ||
        !connection.csrfToken
      ) {
        return null;
      }
      const current = this.getRuntimeBindingForProfile(envPath);
      if (!current || JSON.stringify(current) !== JSON.stringify(binding)) return null;
      return { address: `127.0.0.1:${connection.port}`, csrfToken: connection.csrfToken, pid: binding.pid };
    } catch (error) {
      const code = error instanceof RuntimeProfileSelectionError ? error.code : 'RUNTIME_DISCOVERY_FAILED';
      Logger.warn(`[AccountProfileManager] Runtime indisponível ou ambíguo: ${code}`);
      return null;
    }
  }

  static getExecutionEnvForProfile(profile: AccountProfile, projectId?: string): NodeJS.ProcessEnv {
    if (AccountProfileManager.isOfflineMode()) {
      const relative = path.relative(HUB_DATA_DIR, profile.environment_path);
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error(`AGENTAPI_UNAVAILABLE: nenhum runtime Antigravity pertence ao perfil ${profile.id}`);
      }
      return {
        ...process.env,
        USERPROFILE: profile.environment_path,
        HOME: profile.environment_path,
        APPDATA: path.join(profile.environment_path, 'AppData', 'Roaming'),
        LOCALAPPDATA: path.join(profile.environment_path, 'AppData', 'Local')
      };
    }

    const cleanEnv: NodeJS.ProcessEnv = { ...process.env };
    const profileIsDefault =
      normalizeRuntimePath(profile.environment_path) === normalizeRuntimePath(this.defaultRoamingPath);
    const expectedHome = profileIsDefault ? (process.env.USERPROFILE || os.homedir()) : profile.environment_path;

    if (!profileIsDefault && fs.existsSync(profile.environment_path)) {
      this.ensureProfileDirectoriesAndSyncAuth(profile.environment_path);
    }

    let nativeBinding = projectId ? NativeWorkspaceBinding.resolve(projectId, profile.id, expectedHome) : null;
    for (const k of Object.keys(cleanEnv)) {
      if (
        k.startsWith('ANTIGRAVITY_') ||
        k.startsWith('AGY_') ||
        k.startsWith('CODEIUM_') ||
        k.startsWith('ELECTRON_')
      ) {
        delete cleanEnv[k];
      }
    }

    let instance = this.getRunningInstanceForProfile(profile.environment_path);
    if (!instance && !this.isAutomatedTestRuntime()) {
      instance = this.ensureProfileRuntimeRunningSync(profile);
    }
    if (!instance) {
      throw new Error(`AGENTAPI_UNAVAILABLE: nenhum runtime Antigravity pertence ao perfil ${profile.id}`);
    }

    cleanEnv.ANTIGRAVITY_LS_ADDRESS = instance.address;
    cleanEnv.ANTIGRAVITY_CSRF_TOKEN = instance.csrfToken;
    Logger.info(`[AccountProfileManager] Conectando ao LS do perfil ${profile.display_name} em ${instance.address}`);

    const isLegacyDefault =
      normalizeRuntimePath(profile.environment_path) === normalizeRuntimePath(this.defaultRoamingPath);
    const userProfileDir = isLegacyDefault ? (process.env.USERPROFILE || os.homedir()) : profile.environment_path;

    cleanEnv.USERPROFILE = userProfileDir;
    if (!isLegacyDefault) {
      cleanEnv.APPDATA = path.join(userProfileDir, 'AppData', 'Roaming');
      cleanEnv.LOCALAPPDATA = path.join(userProfileDir, 'AppData', 'Local');
      cleanEnv.HOME = userProfileDir;
    }
    if (nativeBinding) {
      if (normalizeRuntimePath(userProfileDir) !== normalizeRuntimePath(nativeBinding.userProfileDir)) {
        try {
          nativeBinding = NativeWorkspaceBinding.resolve(projectId!, profile.id, userProfileDir, true);
        } catch {
          try {
            nativeBinding = NativeWorkspaceBinding.ensureBinding(projectId!, profile.id, userProfileDir);
          } catch {
            try {
              db.prepare('UPDATE native_workspace_bindings SET user_profile_dir = ?, account_profile_id = ? WHERE project_id = ?')
                .run(userProfileDir, profile.id, projectId!);
              nativeBinding.userProfileDir = userProfileDir;
              nativeBinding.accountProfileId = profile.id;
            } catch {
              throw new Error('NATIVE_WORKSPACE_PROFILE_HOME_MISMATCH');
            }
          }
        }
      }
      cleanEnv.ANTIGRAVITY_PROJECT_ID = nativeBinding.nativeProjectId;
    }

    return cleanEnv;
  }

  // ----------------------------------------------------------------
  // ACCOUNT SWITCHING & RAPID SWITCH FLOW (Section 9)
  // ----------------------------------------------------------------

  static async switchAccount(opts: {
    projectId?: string;
    targetProfileId: string;
    autoStartRuntime?: boolean;
  }): Promise<{
    previousProfile: AccountProfile;
    activeProfile: AccountProfile;
    conversationId: string;
    bootstrapSent: boolean;
    checkpointCreated: boolean;
  }> {
    const { projectId, targetProfileId, autoStartRuntime } = opts;
    const targetProfile = this.getProfile(targetProfileId);
    if (!targetProfile) {
      throw new Error(`Perfil alvo ${targetProfileId} não encontrado.`);
    }

    this.ensureProfileDirectoriesAndSyncAuth(targetProfile.environment_path);

    const previousProfile = projectId ? this.getActiveProfileForProject(projectId) : this.getGlobalActiveProfile();

    Logger.info(
      `[AccountSwitch] Iniciando troca de conta: ${previousProfile.display_name} -> ${targetProfile.display_name}${projectId ? ` no projeto "${projectId}"` : ''}`
    );

    let checkpointCreated = false;
    let targetConvId = '';
    const bootstrapSent = false;

    if (projectId) {
      const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
      if (!project) throw new Error(`Projeto ${projectId} não encontrado.`);
      if (project) {
        try {
          CheckpointManager.createSessionCheckpoint(project.id, project.path, project.name, {
            objective: project.objective,
            customInstructions: `Checkpoint automático pré-troca de conta: ${previousProfile.display_name} -> ${targetProfile.display_name}`
          });
          checkpointCreated = true;
          Logger.info(`[AccountSwitch] Checkpoint de preservação gerado com sucesso.`);
        } catch (err: any) {
          Logger.warn(`[AccountSwitch] Checkpoint warning: ${err.message}`);
        }

        const currentSession = this.getProjectSession(projectId, previousProfile.id);
        Logger.info(
          `[AccountSwitch] Sessão preservada de ${previousProfile.display_name}: convId=${currentSession?.conversation_id || 'nenhum'}`
        );

        const targetSession = this.getProjectSession(projectId, targetProfile.id);
        targetConvId = targetSession?.conversation_id || '';

        if (previousProfile.id !== targetProfile.id) {
          try {
            db.prepare(`
              UPDATE agent_sessions
              SET status = 'ARCHIVED', last_used_at = ?, rotation_reason = 'ACCOUNT_SWITCH'
              WHERE project_id = ? AND status = 'ACTIVE' AND json_valid(metadata_json)
                AND json_extract(metadata_json, '$.accountProfileId') IS NOT NULL
                AND json_extract(metadata_json, '$.accountProfileId') != ?
            `).run(new Date().toISOString(), projectId, targetProfile.id);
          } catch {}

          // Ensure WorkerRegistry workers for this project/profile are aligned
          try {
            db.prepare(`
              UPDATE workers
              SET account_profile_id = ?, status = CASE WHEN status = 'COOLDOWN' THEN 'READY' ELSE status END, updated_at = ?
              WHERE id = 'worker-1'
            `).run(targetProfile.id, new Date().toISOString());
          } catch {}
        }
      }
    }

    if (!projectId) {
      this.setGlobalActiveProfile(targetProfile.id);
      if (previousProfile.id !== targetProfile.id) {
        try {
          db.prepare(`
            UPDATE agent_sessions
            SET status = 'ARCHIVED', last_used_at = ?, rotation_reason = 'GLOBAL_ACCOUNT_SWITCH'
            WHERE status = 'ACTIVE' AND json_valid(metadata_json) AND json_extract(metadata_json, '$.accountProfileId') = ?
          `).run(new Date().toISOString(), previousProfile.id);
        } catch {}

        try {
          db.prepare(`
            UPDATE workers
            SET account_profile_id = ?, status = CASE WHEN status = 'COOLDOWN' THEN 'READY' ELSE status END, updated_at = ?
            WHERE id = 'worker-1'
          `).run(targetProfile.id, new Date().toISOString());
        } catch {}
      }
    }

    if (projectId) {
      db.prepare('UPDATE projects SET active_account_profile_id = ?, updated_at = ? WHERE id = ?').run(
        targetProfile.id,
        new Date().toISOString(),
        projectId
      );
    }

    // Pre-warm target profile runtime if requested in production mode
    if (autoStartRuntime && !this.isAutomatedTestRuntime()) {
      await this.ensureProfileRuntimeRunning(targetProfile, 10000);
    }

    return {
      previousProfile,
      activeProfile: targetProfile,
      conversationId: targetConvId,
      bootstrapSent,
      checkpointCreated
    };
  }

  /**
   * RAPID SWITCH: Instantaneous 1-click (or automatic failover) switch to a specific account
   * or to the next READY account in the pool, auto-booting its background runtime and resuming paused runs.
   */
  static async rapidSwitchAccount(opts?: {
    projectId?: string;
    targetProfileId?: string;
    reason?: string;
    autoStartRuntime?: boolean;
  }): Promise<RapidSwitchResult> {
    const projectId = opts?.projectId;
    const currentProfile = projectId ? this.getActiveProfileForProject(projectId) : this.getGlobalActiveProfile();

    const targetProfile = opts?.targetProfileId
      ? this.getProfile(opts.targetProfileId)
      : this.getNextAvailableProfile(currentProfile.id);

    if (!targetProfile) {
      return {
        switched: false,
        previousProfile: currentProfile,
        activeProfile: currentProfile,
        runtimeOnline: Boolean(this.getRunningInstanceForProfile(currentProfile.environment_path)),
        runtimeAddress: this.getRunningInstanceForProfile(currentProfile.environment_path)?.address || null,
        conversationId: '',
        checkpointCreated: false,
        message: 'Nenhuma outra conta autenticada (READY) disponível para Rapid Switch no momento.'
      };
    }

    const switchRes = await this.switchAccount({
      projectId,
      targetProfileId: targetProfile.id,
      autoStartRuntime: opts?.autoStartRuntime ?? true
    });

    // Also update global active profile so the entire hub reflects the Rapid Switch
    this.setGlobalActiveProfile(targetProfile.id);

    let instance = this.getRunningInstanceForProfile(targetProfile.environment_path);
    if (!instance && !this.isAutomatedTestRuntime() && (opts?.autoStartRuntime ?? true)) {
      instance = await this.ensureProfileRuntimeRunning(targetProfile, 12000);
    }

    // Auto-resume any runs paused due to quota exhaustion on the previous account
    try {
      const nowIso = new Date().toISOString();
      if (projectId) {
        db.prepare(`
          UPDATE autonomous_runs
          SET status = 'running',
              last_error = NULL,
              next_action = ?,
              updated_at = ?
          WHERE project_id = ? AND status IN ('paused', 'waiting_resource')
            AND (last_error LIKE '%RESOURCE_EXHAUSTED%' OR last_error LIKE '%429%' OR last_error LIKE '%cota%' OR last_error LIKE '%AGENTAPI_UNAVAILABLE%')
        `).run(`Rapid Switch concluído para "${targetProfile.display_name}". Retomando execução.`, nowIso, projectId);
      } else {
        db.prepare(`
          UPDATE autonomous_runs
          SET status = 'running',
              last_error = NULL,
              next_action = ?,
              updated_at = ?
          WHERE status IN ('paused', 'waiting_resource')
            AND (last_error LIKE '%RESOURCE_EXHAUSTED%' OR last_error LIKE '%429%' OR last_error LIKE '%cota%' OR last_error LIKE '%AGENTAPI_UNAVAILABLE%')
        `).run(`Rapid Switch global concluído para "${targetProfile.display_name}". Retomando execução.`, nowIso);
      }
    } catch {}

    const refreshedTarget = this.getProfile(targetProfile.id) || targetProfile;
    const message = `Rapid Switch concluído: "${currentProfile.display_name}" -> "${refreshedTarget.display_name}"${instance ? ` (Runtime online em ${instance.address})` : ''}.`;
    Logger.success(`[RapidSwitch] ${message}`);

    return {
      switched: currentProfile.id !== refreshedTarget.id,
      previousProfile: currentProfile,
      activeProfile: refreshedTarget,
      runtimeOnline: Boolean(instance),
      runtimeAddress: instance?.address || null,
      conversationId: switchRes.conversationId,
      checkpointCreated: switchRes.checkpointCreated,
      message
    };
  }

  /**
   * Unified error classifier based on official Antigravity 2.0 / CLI documentation.
   * Detects quota limits (429, RESOURCE_EXHAUSTED, G1 credits), authentication issues
   * (LOGIN_REQUIRED, keyring locked, invalid_grant), and runtime mismatches.
   */
  static classifyAccountOrQuotaError(errorOrMessage: unknown): {
    isAccountOrQuotaError: boolean;
    kind: 'QUOTA' | 'AUTH' | 'RUNTIME' | 'NONE';
    reason: string;
  } {
    const rawMsg =
      errorOrMessage instanceof Error
        ? errorOrMessage.message
        : typeof errorOrMessage === 'string'
        ? errorOrMessage
        : errorOrMessage && typeof errorOrMessage === 'object' && 'message' in (errorOrMessage as any)
        ? String((errorOrMessage as any).message)
        : String(errorOrMessage || '');

    const quotaPattern = /RESOURCE_EXHAUSTED|QUOTA_EXHAUSTED|QUOTA_BLOCKED|\b429\b|Individual quota reached|AI credits balance is too low|Out of credits|rate limit|\bcota\b/i;
    const authPattern = /AUTH_ERROR|UNAUTHENTICATED|LOGIN_REQUIRED|Verify your account to continue|secret keyring is locked|OAuth|invalid_grant|missing license|not authenticated|ACCOUNT_UNAVAILABLE/i;
    const runtimePattern = /AGENTAPI_UNAVAILABLE.*perfil|NATIVE_WORKSPACE_PROFILE_HOME_MISMATCH/i;

    if (quotaPattern.test(rawMsg)) {
      return {
        isAccountOrQuotaError: true,
        kind: 'QUOTA',
        reason: rawMsg.trim() || 'Limite de cota individual atingido (RESOURCE_EXHAUSTED 429).'
      };
    }

    if (authPattern.test(rawMsg)) {
      return {
        isAccountOrQuotaError: true,
        kind: 'AUTH',
        reason: rawMsg.trim() || 'Erro de autenticação ou sessão da conta (LOGIN_REQUIRED).'
      };
    }

    if (runtimePattern.test(rawMsg)) {
      return {
        isAccountOrQuotaError: true,
        kind: 'RUNTIME',
        reason: rawMsg.trim() || 'Runtime Antigravity indisponível para o perfil ativo.'
      };
    }

    return {
      isAccountOrQuotaError: false,
      kind: 'NONE',
      reason: rawMsg.trim()
    };
  }

  /**
   * Autonomous Auto-Failover orchestrator:
   * Classifies error, updates failing profile status, performs Rapid Switch to next READY account,
   * reassigns workers pool, and emits audit event.
   */

  /**
   * Synchronous counterpart of switchAccount.
   */
  static switchAccountSync(opts: {
    projectId?: string;
    targetProfileId: string;
    autoStartRuntime?: boolean;
  }): {
    previousProfile: AccountProfile;
    activeProfile: AccountProfile;
    conversationId: string;
    bootstrapSent: boolean;
    checkpointCreated: boolean;
  } {
    const { projectId, targetProfileId, autoStartRuntime = true } = opts;
    const targetProfile = this.getProfile(targetProfileId);
    if (!targetProfile) {
      throw new Error(`Perfil alvo ${targetProfileId} não encontrado.`);
    }

    this.ensureProfileDirectoriesAndSyncAuth(targetProfile.environment_path);

    const previousProfile = projectId ? this.getActiveProfileForProject(projectId) : this.getGlobalActiveProfile();

    Logger.info(
      `[AccountSwitchSync] Iniciando troca de conta: ${previousProfile.display_name} -> ${targetProfile.display_name}${projectId ? ` no projeto "${projectId}"` : ''}`
    );

    let checkpointCreated = false;
    let targetConvId = '';
    const bootstrapSent = false;

    if (projectId) {
      const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
      if (!project) throw new Error(`Projeto ${projectId} não encontrado.`);
      if (project) {
        try {
          CheckpointManager.createSessionCheckpoint(project.id, project.path, project.name, {
            objective: project.objective,
            customInstructions: `Checkpoint automático pré-troca de conta: ${previousProfile.display_name} -> ${targetProfile.display_name}`
          });
          checkpointCreated = true;
          Logger.info('[AccountSwitchSync] Checkpoint de preservação gerado com sucesso.');
        } catch (err: any) {
          Logger.warn(`[AccountSwitchSync] Checkpoint warning: ${err.message}`);
        }

        const currentSession = this.getProjectSession(projectId, previousProfile.id);
        const targetSession = this.getProjectSession(projectId, targetProfile.id);
        targetConvId = targetSession?.conversation_id || '';

        if (previousProfile.id !== targetProfile.id) {
          try {
            db.prepare(`
              UPDATE agent_sessions
              SET status = 'ARCHIVED', last_used_at = ?, rotation_reason = 'ACCOUNT_SWITCH'
              WHERE project_id = ? AND status = 'ACTIVE' AND json_valid(metadata_json)
                AND json_extract(metadata_json, '$.accountProfileId') IS NOT NULL
                AND json_extract(metadata_json, '$.accountProfileId') != ?
            `).run(new Date().toISOString(), projectId, targetProfile.id);
          } catch {}

          try {
            db.prepare(`
              UPDATE workers
              SET account_profile_id = ?, status = CASE WHEN status = 'COOLDOWN' THEN 'READY' ELSE status END, updated_at = ?
              WHERE id = 'worker-1'
            `).run(targetProfile.id, new Date().toISOString());
          } catch {}
        }
      }
    }

    if (!projectId) {
      this.setGlobalActiveProfile(targetProfile.id);
      if (previousProfile.id !== targetProfile.id) {
        try {
          db.prepare(`
            UPDATE agent_sessions
            SET status = 'ARCHIVED', last_used_at = ?, rotation_reason = 'GLOBAL_ACCOUNT_SWITCH'
            WHERE status = 'ACTIVE' AND json_valid(metadata_json) AND json_extract(metadata_json, '$.accountProfileId') = ?
          `).run(new Date().toISOString(), previousProfile.id);
        } catch {}

        try {
          db.prepare(`
            UPDATE workers
            SET account_profile_id = ?, status = CASE WHEN status = 'COOLDOWN' THEN 'READY' ELSE status END, updated_at = ?
            WHERE id = 'worker-1'
          `).run(targetProfile.id, new Date().toISOString());
        } catch {}
      }
    }

    if (projectId) {
      db.prepare('UPDATE projects SET active_account_profile_id = ?, updated_at = ? WHERE id = ?').run(
        targetProfile.id,
        new Date().toISOString(),
        projectId
      );
    }

    if (autoStartRuntime && !this.isAutomatedTestRuntime()) {
      this.ensureProfileRuntimeRunningSync(targetProfile, 10000);
    }

    return {
      previousProfile,
      activeProfile: targetProfile,
      conversationId: targetConvId,
      bootstrapSent,
      checkpointCreated
    };
  }

  /**
   * Synchronous counterpart of rapidSwitchAccount.
   */
  static rapidSwitchAccountSync(opts?: {
    projectId?: string;
    targetProfileId?: string;
    reason?: string;
    autoStartRuntime?: boolean;
  }): RapidSwitchResult {
    const projectId = opts?.projectId;
    const currentProfile = projectId ? this.getActiveProfileForProject(projectId) : this.getGlobalActiveProfile();

    const targetProfile = opts?.targetProfileId
      ? this.getProfile(opts.targetProfileId)
      : this.getNextAvailableProfile(currentProfile.id);

    if (!targetProfile) {
      return {
        switched: false,
        previousProfile: currentProfile,
        activeProfile: currentProfile,
        runtimeOnline: Boolean(this.getRunningInstanceForProfile(currentProfile.environment_path)),
        runtimeAddress: this.getRunningInstanceForProfile(currentProfile.environment_path)?.address || null,
        conversationId: '',
        checkpointCreated: false,
        message: 'Nenhuma outra conta autenticada (READY) disponível para Rapid Switch no momento.'
      };
    }

    const switchRes = this.switchAccountSync({
      projectId,
      targetProfileId: targetProfile.id,
      autoStartRuntime: opts?.autoStartRuntime ?? true
    });

    this.setGlobalActiveProfile(targetProfile.id);

    let instance = this.getRunningInstanceForProfile(targetProfile.environment_path);
    if (!instance && !this.isAutomatedTestRuntime() && (opts?.autoStartRuntime ?? true)) {
      instance = this.ensureProfileRuntimeRunningSync(targetProfile, 12000);
    }

    try {
      const nowIso = new Date().toISOString();
      if (projectId) {
        db.prepare(`
          UPDATE autonomous_runs
          SET status = 'running',
              last_error = NULL,
              next_action = ?,
              updated_at = ?
          WHERE project_id = ? AND status IN ('paused', 'waiting_resource')
            AND (last_error LIKE '%RESOURCE_EXHAUSTED%' OR last_error LIKE '%429%' OR last_error LIKE '%cota%' OR last_error LIKE '%AGENTAPI_UNAVAILABLE%')
        `).run(`Rapid Switch concluído para "${targetProfile.display_name}". Retomando execução.`, nowIso, projectId);
      } else {
        db.prepare(`
          UPDATE autonomous_runs
          SET status = 'running',
              last_error = NULL,
              next_action = ?,
              updated_at = ?
          WHERE status IN ('paused', 'waiting_resource')
            AND (last_error LIKE '%RESOURCE_EXHAUSTED%' OR last_error LIKE '%429%' OR last_error LIKE '%cota%' OR last_error LIKE '%AGENTAPI_UNAVAILABLE%')
        `).run(`Rapid Switch global concluído para "${targetProfile.display_name}". Retomando execução.`, nowIso);
      }
    } catch {}

    const refreshedTarget = this.getProfile(targetProfile.id) || targetProfile;
    const message = `Rapid Switch concluído: "${currentProfile.display_name}" -> "${refreshedTarget.display_name}"${instance ? ` (Runtime online em ${instance.address})` : ''}.`;
    Logger.success(`[RapidSwitchSync] ${message}`);

    return {
      switched: currentProfile.id !== refreshedTarget.id,
      previousProfile: currentProfile,
      activeProfile: refreshedTarget,
      runtimeOnline: Boolean(instance),
      runtimeAddress: instance?.address || null,
      conversationId: switchRes.conversationId,
      checkpointCreated: switchRes.checkpointCreated,
      message
    };
  }

  /**
   * Synchronous counterpart of handleAccountFailureAndRapidSwitch.
   */
  static handleAccountFailureAndRapidSwitchSync(params: {
    failedProfileId?: string | null;
    projectId?: string | null;
    runId?: string | null;
    taskId?: string | null;
    error: unknown;
    autoStartRuntime?: boolean;
  }): AutoFailoverResult {
    const classification = this.classifyAccountOrQuotaError(params.error);

    let failedProfileId = params.failedProfileId;
    if (!failedProfileId && params.projectId) {
      try {
        const activeProj = this.getActiveProfileForProject(params.projectId);
        failedProfileId = activeProj?.id;
      } catch {}
    }
    if (!failedProfileId) {
      failedProfileId = this.getGlobalActiveProfile().id;
    }

    const currentActive = this.getProfile(failedProfileId) || this.getGlobalActiveProfile();

    if (!classification.isAccountOrQuotaError) {
      return {
        switched: false,
        previousProfileId: failedProfileId,
        activeProfile: currentActive,
        kind: 'NONE',
        message: `Erro não classificado como falha de conta ou cota: ${classification.reason}`
      };
    }

    Logger.warn(
      `[AccountAutoFailoverSync] Falha detectada (${classification.kind}) no perfil "${currentActive.display_name}" (${failedProfileId}): ${classification.reason}`
    );

    if (classification.kind === 'QUOTA') {
      this.markQuotaExhausted(failedProfileId, classification.reason);
    } else if (classification.kind === 'AUTH') {
      this.updateStatus(failedProfileId, 'LOGIN_REQUIRED');
    } else if (classification.kind === 'RUNTIME') {
      this.updateStatus(failedProfileId, 'RUNTIME_UNAVAILABLE');
    }

    const switchRes = this.rapidSwitchAccountSync({
      projectId: params.projectId || undefined,
      reason: `${classification.kind}_FAILOVER: ${classification.reason}`,
      autoStartRuntime: params.autoStartRuntime
    });

    if (switchRes.switched) {
      const nowIso = new Date().toISOString();
      const newProfileId = switchRes.activeProfile.id;

      try {
        db.prepare(`
          UPDATE workers
          SET account_profile_id = ?, status = 'READY', current_task_id = NULL, current_run_id = NULL, current_issue_number = NULL, updated_at = ?
          WHERE account_profile_id = ?
        `).run(newProfileId, nowIso, failedProfileId);
      } catch {}

      if (params.runId) {
        try {
          db.prepare(`
            UPDATE autonomous_runs
            SET last_error = NULL,
                next_action = ?,
                updated_at = ?
            WHERE id = ?
          `).run(`Failover automático executado: alternado para "${switchRes.activeProfile.display_name}".`, nowIso, params.runId);
        } catch {}
      }

      Logger.success(
        `[AccountAutoFailoverSync] Auto-Failover concluído com sucesso: "${switchRes.previousProfile.display_name}" -> "${switchRes.activeProfile.display_name}". Mantendo execução contínua.`
      );
    }

    return {
      switched: switchRes.switched,
      previousProfileId: failedProfileId,
      activeProfile: switchRes.activeProfile,
      kind: classification.kind,
      message: switchRes.message
    };
  }

  static async handleAccountFailureAndRapidSwitch(params: {
    failedProfileId?: string | null;
    projectId?: string | null;
    runId?: string | null;
    taskId?: string | null;
    error: unknown;
    autoStartRuntime?: boolean;
  }): Promise<AutoFailoverResult> {
    const classification = this.classifyAccountOrQuotaError(params.error);

    let failedProfileId = params.failedProfileId;
    if (!failedProfileId && params.projectId) {
      try {
        const activeProj = this.getActiveProfileForProject(params.projectId);
        failedProfileId = activeProj?.id;
      } catch {}
    }
    if (!failedProfileId) {
      failedProfileId = this.getGlobalActiveProfile().id;
    }

    const currentActive = this.getProfile(failedProfileId) || this.getGlobalActiveProfile();

    if (!classification.isAccountOrQuotaError) {
      return {
        switched: false,
        previousProfileId: failedProfileId,
        activeProfile: currentActive,
        kind: 'NONE',
        message: `Erro não classificado como falha de conta ou cota: ${classification.reason}`
      };
    }

    Logger.warn(
      `[AccountAutoFailover] Falha detectada (${classification.kind}) no perfil "${currentActive.display_name}" (${failedProfileId}): ${classification.reason}`
    );

    if (classification.kind === 'QUOTA') {
      this.markQuotaExhausted(failedProfileId, classification.reason);
    } else if (classification.kind === 'AUTH') {
      this.updateStatus(failedProfileId, 'LOGIN_REQUIRED');
    } else if (classification.kind === 'RUNTIME') {
      this.updateStatus(failedProfileId, 'RUNTIME_UNAVAILABLE');
    }

    const switchRes = await this.rapidSwitchAccount({
      projectId: params.projectId || undefined,
      reason: `${classification.kind}_FAILOVER: ${classification.reason}`,
      autoStartRuntime: params.autoStartRuntime
    });

    if (switchRes.switched) {
      const nowIso = new Date().toISOString();
      const newProfileId = switchRes.activeProfile.id;

      try {
        db.prepare(`
          UPDATE workers
          SET account_profile_id = ?, status = 'READY', current_task_id = NULL, current_run_id = NULL, current_issue_number = NULL, updated_at = ?
          WHERE account_profile_id = ?
        `).run(newProfileId, nowIso, failedProfileId);

        db.prepare(`
          UPDATE workers
          SET account_profile_id = ?, status = CASE WHEN status = 'COOLDOWN' THEN 'READY' ELSE status END, updated_at = ?
          WHERE id = 'worker-1'
        `).run(newProfileId, nowIso);
      } catch (workerErr: any) {
        Logger.warn(`[AccountAutoFailover] Aviso ao reatribuir workers: ${workerErr.message}`);
      }

      if (params.runId) {
        try {
          const { AutonomousManager } = await import('./autonomousManager.js');
          AutonomousManager.logEvent(
            params.runId,
            params.taskId || null,
            'system',
            'ACCOUNT_RAPID_SWITCH_FAILOVER',
            `Auto-Failover executado com sucesso (${classification.kind}): "${switchRes.previousProfile.display_name}" -> "${switchRes.activeProfile.display_name}". Motivo: ${classification.reason}`,
            {
              kind: classification.kind,
              previousProfileId: failedProfileId,
              newProfileId,
              reason: classification.reason
            }
          );
        } catch {}
      }

      Logger.success(
        `[AccountAutoFailover] Auto-Failover concluído com sucesso: "${switchRes.previousProfile.display_name}" -> "${switchRes.activeProfile.display_name}". Mantendo execução contínua.`
      );
    } else {
      Logger.warn(
        `[AccountAutoFailover] Nenhuma outra conta pronta disponível para Auto-Failover. Todas as contas foram esgotadas ou requerem login.`
      );
    }

    return {
      switched: switchRes.switched,
      previousProfileId: failedProfileId,
      activeProfile: switchRes.activeProfile,
      kind: classification.kind,
      message: switchRes.message
    };
  }

  static sendMessageToActiveAccount(_projectId: string, _content: string): never {
    throw new Error(
      'DIRECT_ACCOUNT_CHAT_DISABLED: envie instruções pelo Chat Autônomo para preservar autorização, sessões e avaliação.'
    );
  }

  static markQuotaExhausted(profileId: string, errorMsg?: string): AccountProfile {
    const now = new Date();
    const rawMsg = errorMsg || 'Limite de cota individual atingido (RESOURCE_EXHAUSTED 429).';
    let durationMs = 60 * 60 * 1000; // default 1h

    const match = rawMsg.match(/Resets in (?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/i);
    if (match) {
      const h = parseInt(match[1] || '0', 10);
      const m = parseInt(match[2] || '0', 10);
      const s = parseInt(match[3] || '0', 10);
      const calculated = (h * 3600 + m * 60 + s) * 1000;
      if (calculated > 0) durationMs = calculated;
    }

    const resetTime = new Date(now.getTime() + durationMs);
    const resetIso = resetTime.toISOString();
    const nowIso = now.toISOString();

    db.prepare(`
      UPDATE account_profiles
      SET auth_status = 'QUOTA_EXHAUSTED', quota_resets_at = ?, quota_message = ?, updated_at = ?
      WHERE id = ?
    `).run(resetIso, rawMsg, nowIso, profileId);

    try {
      db.prepare(`
        UPDATE workers
        SET status = 'COOLDOWN', updated_at = ?
        WHERE account_profile_id = ?
      `).run(nowIso, profileId);
    } catch {}

    Logger.warn(
      `[AccountProfileManager] Conta ${profileId} marcada como QUOTA_EXHAUSTED (Reseta às ${resetTime.toLocaleTimeString()}).`
    );
    return this.getProfile(profileId)!;
  }

  static checkAndRefreshQuotaStatus(profileId: string): AccountProfile | null {
    const row: any = db.prepare('SELECT * FROM account_profiles WHERE id = ?').get(profileId);
    if (!row) return null;
    const profile = this._rowToProfile(row);

    if (profile.auth_status === 'QUOTA_EXHAUSTED') {
      if (profile.quota_resets_at && Date.now() >= new Date(profile.quota_resets_at).getTime()) {
        const now = new Date().toISOString();
        db.prepare(`
          UPDATE account_profiles
          SET auth_status = 'AUTH_UNKNOWN', quota_resets_at = NULL, quota_message = ?, updated_at = ?
          WHERE id = ?
        `).run('Cooldown expirou. Elegível para tentativa; quota e OAuth ainda não confirmados.', now, profileId);

        try {
          db.prepare(`
            UPDATE workers
            SET status = 'WAITING', updated_at = ?
            WHERE account_profile_id = ? AND status = 'COOLDOWN'
          `).run(now, profileId);
        } catch {}

        Logger.info(
          `[AccountProfileManager] Cooldown expirou para "${profile.display_name}". Elegível para nova tentativa; quota permanece desconhecida.`
        );
        const updatedRow: any = db.prepare('SELECT * FROM account_profiles WHERE id = ?').get(profileId);
        return updatedRow ? this._rowToProfile(updatedRow) : profile;
      }
    }
    return profile;
  }

  static isAccountAvailableForTasks(profileId: string): boolean {
    const refreshed = this.checkAndRefreshQuotaStatus(profileId);
    let profile = refreshed || this.getProfile(profileId);
    if (!profile) return false;
    if (profile.quota_resets_at && new Date(profile.quota_resets_at).getTime() > Date.now()) {
      return false;
    }
    if (profile.auth_status === 'QUOTA_EXHAUSTED' || profile.auth_status === 'ERROR') {
      return false;
    }

    if (profile.auth_status === 'WAITING_LOGIN') {
      if (this._verifyProbeOverride || (!this.isAutomatedTestRuntime() && !this.isOfflineMode())) {
        try {
          profile = this.verifyProfile(profileId).profile;
        } catch {}
      }
    }

    if (
      profile.auth_status === 'LOGIN_REQUIRED' ||
      profile.auth_status === 'ERROR' ||
      profile.auth_status === 'QUOTA_EXHAUSTED'
    ) {
      return false;
    }

    if (this.isAutomatedTestRuntime() || this.isOfflineMode()) {
      return true;
    }

    return (
      profile.auth_status === 'READY' ||
      profile.auth_status === 'ACTIVE' ||
      profile.auth_status === 'AUTH_UNKNOWN'
    );
  }

  static getGlobalActiveProfileIdSafe(): string | null {
    try {
      const setting: any = db.prepare("SELECT value FROM system_settings WHERE key = 'active_account_profile_id'").get();
      if (setting?.value) return setting.value;
      const first: any = db.prepare("SELECT id FROM account_profiles WHERE auth_status IN ('READY', 'ACTIVE') ORDER BY created_at ASC LIMIT 1").get();
      if (first?.id) return first.id;
      const anyFirst: any = db.prepare("SELECT id FROM account_profiles ORDER BY created_at ASC LIMIT 1").get();
      return anyFirst?.id || null;
    } catch {
      return null;
    }
  }

  private static _rowToProfile(row: any): AccountProfile {
    let resolvedStatus = row.auth_status as AuthStatus;
    if (
      !AccountProfileManager.isAutomatedTestRuntime() &&
      ['READY', 'ACTIVE'].includes(row.auth_status)
    ) {
      const evidence = AccountProfileManager.inspectLocalAuthEvidence(row.environment_path);
      if (!evidence.hasAuthEvidence) {
        resolvedStatus = 'AUTH_UNKNOWN';
      }
    }
    const globalActiveId = AccountProfileManager.getGlobalActiveProfileIdSafe();
    const displayName = row.display_name || row.name || row.id;
    return {
      id: row.id,
      name: displayName,
      display_name: displayName,
      profile_name: row.profile_name || row.id,
      email: row.google_account_label || null,
      google_account_label: row.google_account_label || null,
      environment_path: row.environment_path,
      auth_status: resolvedStatus,
      is_active: Boolean(globalActiveId && row.id === globalActiveId),
      last_tested: row.last_tested,
      quota_resets_at: row.quota_resets_at || null,
      quota_message: row.quota_message || null,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }
}

// Auto-initialize default profiles on import
AccountProfileManager.initDefaultProfiles();