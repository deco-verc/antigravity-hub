import { execFileSync, execSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { db } from './db.js';
import { Logger } from './logger.js';
import { GitManager } from './gitManager.js';
import { CheckpointManager } from './checkpointManager.js';
import { MemoryManager } from './memoryManager.js';
import { getLanguageServerExe } from './antigravityProvider.js';
import { AntigravityDiscovery } from './antigravityDiscovery.js';
import { ConversationManager } from './conversationManager.js';

export type AuthStatus = 'READY' | 'WAITING_LOGIN' | 'VERIFYING' | 'LOGIN_REQUIRED' | 'ACTIVE' | 'ERROR' | 'OFFLINE' | 'NEEDS_LOGIN' | 'AUTHENTICATING' | 'QUOTA_EXHAUSTED';

export interface AccountProfile {
  id: string;
  display_name: string;
  profile_name: string;
  google_account_label: string | null;
  environment_path: string;
  auth_status: AuthStatus;
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

const HUB_PROFILES_DIR = path.join(os.homedir(), '.ai-dev-hub', 'profiles');
if (!fs.existsSync(HUB_PROFILES_DIR)) {
  fs.mkdirSync(HUB_PROFILES_DIR, { recursive: true });
}

export class AccountProfileManager {
  private static _verifyProbeOverride: ((profile: AccountProfile) => boolean) | null = null;

  static setVerifyProbeOverrideForTest(probe: ((profile: AccountProfile) => boolean) | null): void {
    this._verifyProbeOverride = probe;
  }

  private static defaultRoamingPath = path.join(
    process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
    'Antigravity'
  );

  /**
   * Initializes default profiles if not present in the database.
   * Profile A: Main Google Account (dynamically detected)
   * Profile B: Secondary Account placeholder/prepared
   */
  static initDefaultProfiles(): void {
    const existing = this.getAllProfiles();
    const now = new Date().toISOString();

    // Detect real username from AppData app_storage.json
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
    let profileA = existing.find(p => p.id === 'acc-pro-1' || p.profile_name === 'google_pro_1');
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
        'WAITING_LOGIN',
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
    let profileB = existing.find(p => p.id === 'acc-pro-2' || p.profile_name === 'google_pro_2');
    if (!profileB) {
      const envPathB = path.join(HUB_PROFILES_DIR, 'google_pro_2');
      if (!fs.existsSync(envPathB)) {
        fs.mkdirSync(envPathB, { recursive: true });
      }

      db.prepare(`
        INSERT INTO account_profiles (id, display_name, profile_name, google_account_label, environment_path, auth_status, last_tested, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'NEEDS_LOGIN', NULL, ?, ?)
      `).run(
        'acc-pro-2',
        'Google Pro 2',
        'google_pro_2',
        null,
        envPathB,
        now,
        now
      );
      Logger.info(`[AccountProfileManager] Perfil secundário Google Pro 2 preparado em ${envPathB}.`);
    }

    // Existing READY values are historical claims. Worker bootstrap must probe agentapi.
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
    return ready || {
      id: 'acc-pro-1',
      display_name: 'Google Pro 1',
      profile_name: 'google_pro_1',
      google_account_label: null,
      environment_path: this.defaultRoamingPath,
      auth_status: 'WAITING_LOGIN',
      last_tested: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
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
          if (p) {
            const isQuotaExhausted = p.auth_status === 'QUOTA_EXHAUSTED' ||
              Boolean(p.quota_resets_at && new Date(p.quota_resets_at).getTime() > Date.now());
            if (!isQuotaExhausted) return p;
          }
        }
      } catch {}
    }
    const globalActive = this.getGlobalActiveProfile();
    const isGlobalQuotaExhausted = globalActive && (
      globalActive.auth_status === 'QUOTA_EXHAUSTED' ||
      Boolean(globalActive.quota_resets_at && new Date(globalActive.quota_resets_at).getTime() > Date.now())
    );
    if (globalActive && !isGlobalQuotaExhausted) {
      return globalActive;
    }
    // Check if any other configured profile is available for fallback
    const all = this.getAllProfiles();
    const available = all.find(p => this.isAccountAvailableForTasks(p.id));
    if (available) {
      Logger.info(`[AccountProfileManager] Alternando automaticamente para perfil com cota disponível: "${available.display_name}" (${available.id})`);
      return available;
    }
    return globalActive || all[0];
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

    // Generate safe and guaranteed-unique profileName
    let baseSafeName = (opts.profileName || trimmedDisplay.toLowerCase().replace(/[^a-z0-9_]/g, '_')) || `profile_${Date.now()}`;
    baseSafeName = baseSafeName.replace(/^_+|_+$/g, '') || `profile_${Date.now()}`;
    let safeName = baseSafeName;

    const existingByName = db.prepare('SELECT id FROM account_profiles WHERE profile_name = ?').get(safeName);
    if (existingByName) {
      safeName = `${baseSafeName}_${crypto.randomUUID().slice(0, 4)}`;
    }

    const envPath = path.join(HUB_PROFILES_DIR, safeName);
    if (!fs.existsSync(envPath)) {
      fs.mkdirSync(envPath, { recursive: true });
    }

    // Ensure AppData and userData directories are created to prevent runtime startup errors
    const appDataRoaming = path.join(envPath, 'AppData', 'Roaming');
    const appDataLocal = path.join(envPath, 'AppData', 'Local');
    const isolatedUserDataDir = path.join(appDataRoaming, 'Antigravity');
    fs.mkdirSync(isolatedUserDataDir, { recursive: true });
    fs.mkdirSync(appDataLocal, { recursive: true });

    const userDataDir = path.join(envPath, 'userData');
    if (!fs.existsSync(userDataDir)) {
      fs.mkdirSync(userDataDir, { recursive: true });
    }

    const geminiConfigDir = path.join(envPath, '.gemini', 'config', 'projects');
    if (!fs.existsSync(geminiConfigDir)) {
      fs.mkdirSync(geminiConfigDir, { recursive: true });
    }
    const outsideProjFile = path.join(geminiConfigDir, 'outside-of-project.json');
    if (!fs.existsSync(outsideProjFile)) {
      try {
        fs.writeFileSync(outsideProjFile, JSON.stringify({
          id: "outside-of-project",
          name: "Outside of Project",
          settings: {
            fileAccessPolicy: "AGENT_SETTING_POLICY_ALLOW",
            sandboxMode: false,
            autoExecutionPolicy: "CASCADE_COMMANDS_AUTO_EXECUTION_EAGER",
            artifactReviewMode: "ARTIFACT_REVIEW_MODE_TURBO"
          }
        }, null, 2), 'utf-8');
      } catch {}
    }

    const accountLabel = opts.googleAccountLabel?.trim() || null;
    const initialStatus: AuthStatus = 'WAITING_LOGIN';

    db.prepare(`
      INSERT INTO account_profiles (id, display_name, profile_name, google_account_label, environment_path, auth_status, last_tested, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)
    `).run(
      id,
      trimmedDisplay,
      safeName,
      accountLabel,
      envPath,
      initialStatus,
      now,
      now
    );

    Logger.info(`[AccountProfileManager] Novo perfil criado: ${id} ("${trimmedDisplay}") em ${envPath}`);
    return this.getProfile(id)!;
  }

  static updateProfile(profileId: string, data: {
    displayName?: string;
    googleAccountLabel?: string | null;
    authStatus?: AuthStatus;
  }): AccountProfile {
    const profile = this.getProfile(profileId);
    if (!profile) {
      throw new Error(`Perfil ${profileId} não encontrado.`);
    }

    const now = new Date().toISOString();
    const newDisplayName = data.displayName?.trim() || profile.display_name;
    const newAccountLabel = data.googleAccountLabel !== undefined ? (data.googleAccountLabel ? data.googleAccountLabel.trim() : null) : profile.google_account_label;
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

    Logger.info(`[AccountProfileManager] Perfil ${profileId} atualizado: "${newDisplayName}", conta=${newAccountLabel || 'não definida'}, status=${newStatus}`);
    return this.getProfile(profileId)!;
  }

  static deleteProfile(profileId: string, opts: { deleteData?: boolean } = {}): { success: boolean; message: string; fallbackProfileId?: string } {
    const profile = this.getProfile(profileId);
    if (!profile) {
      throw new Error(`Perfil ${profileId} não encontrado.`);
    }

    const all = this.getAllProfiles();
    if (all.length <= 1) {
      throw new Error(`Não é possível remover a única conta cadastrada no sistema. Cadastre outra conta antes de remover esta.`);
    }

    const remaining = all.filter(p => p.id !== profileId);
    const fallback = remaining.find(p => p.auth_status === 'READY') || remaining[0];

    // If active profile is being deleted, switch active profile first
    const globalActive = this.getGlobalActiveProfile();
    if (globalActive.id === profileId) {
      this.setGlobalActiveProfile(fallback.id);
    }

    // Reassign any projects using this profile
    db.prepare(`
      UPDATE projects
      SET active_account_profile_id = ?, updated_at = ?
      WHERE active_account_profile_id = ?
    `).run(fallback.id, new Date().toISOString(), profileId);

    // Delete project sessions for this account profile
    db.prepare(`
      DELETE FROM account_project_sessions WHERE account_profile_id = ?
    `).run(profileId);

    // Delete the account profile
    db.prepare(`
      DELETE FROM account_profiles WHERE id = ?
    `).run(profileId);

    // If requested and safe, remove local directory
    const resolvedProfilePath = path.resolve(profile.environment_path);
    const resolvedProfilesRoot = path.resolve(HUB_PROFILES_DIR);
    if (opts.deleteData && path.dirname(resolvedProfilePath) === resolvedProfilesRoot && fs.existsSync(resolvedProfilePath)) {
      try {
        fs.rmSync(resolvedProfilePath, { recursive: true, force: true });
        Logger.info(`[AccountProfileManager] Diretório do perfil removido: ${profile.environment_path}`);
      } catch (e: any) {
        Logger.warn(`[AccountProfileManager] Aviso ao remover diretório ${profile.environment_path}: ${e.message}`);
      }
    }

    Logger.info(`[AccountProfileManager] Perfil "${profile.display_name}" (${profileId}) removido. Projetos reatribuídos para "${fallback.display_name}".`);

    return {
      success: true,
      message: `Perfil "${profile.display_name}" removido com sucesso. Projetos vinculados foram reatribuídos para "${fallback.display_name}".`,
      fallbackProfileId: fallback.id
    };
  }

  static launchLogin(profileId: string): { success: boolean; message: string; pid?: number } {
    const profile = this.getProfile(profileId);
    if (!profile) {
      throw new Error(`Perfil ${profileId} não encontrado.`);
    }

    const antigravityExe = AntigravityDiscovery.getAntigravityAppExe();
    if (!antigravityExe) {
      throw new Error(`Executável do Antigravity (Antigravity.exe) não foi localizado nos diretórios padrão do sistema.`);
    }

    const profileAppData = path.join(profile.environment_path, 'AppData', 'Roaming');
    const profileLocalAppData = path.join(profile.environment_path, 'AppData', 'Local');
    const userDataDir = path.join(profileAppData, 'Antigravity');

    if (!fs.existsSync(userDataDir)) {
      fs.mkdirSync(userDataDir, { recursive: true });
    }
    if (!fs.existsSync(profileLocalAppData)) {
      fs.mkdirSync(profileLocalAppData, { recursive: true });
    }

    const legacyUserData = path.join(profile.environment_path, 'userData');
    if (!fs.existsSync(legacyUserData)) {
      fs.mkdirSync(legacyUserData, { recursive: true });
    }

    // Ensure .gemini outside-of-project.json exists
    const geminiProjDir = path.join(profile.environment_path, '.gemini', 'config', 'projects');
    if (!fs.existsSync(geminiProjDir)) {
      fs.mkdirSync(geminiProjDir, { recursive: true });
    }
    const projFile = path.join(geminiProjDir, 'outside-of-project.json');
    if (!fs.existsSync(projFile)) {
      try {
        fs.writeFileSync(projFile, JSON.stringify({
          id: "outside-of-project",
          name: "Outside of Project",
          settings: {
            fileAccessPolicy: "AGENT_SETTING_POLICY_ALLOW",
            sandboxMode: false,
            autoExecutionPolicy: "CASCADE_COMMANDS_AUTO_EXECUTION_EAGER",
            artifactReviewMode: "ARTIFACT_REVIEW_MODE_TURBO"
          }
        }, null, 2), 'utf-8');
      } catch {}
    }

    Logger.info(`[AccountProfileManager] Abrindo janela do Antigravity para autenticação no perfil "${profile.display_name}" (${profile.environment_path})...`);

    // Prepare clean environment for isolated process
    const cleanEnv: NodeJS.ProcessEnv = { ...process.env };
    delete cleanEnv.ELECTRON_RUN_AS_NODE;
    delete cleanEnv.ELECTRON_NO_ASAR;
    delete cleanEnv.ELECTRON_OZONE_PLATFORM_HINT;
    for (const k of Object.keys(cleanEnv)) {
      if (k.startsWith('ANTIGRAVITY_') || k.startsWith('AGY_')) {
        delete cleanEnv[k];
      }
    }
    const isLegacyDefault = path.resolve(profile.environment_path).toLowerCase() === path.resolve(this.defaultRoamingPath).toLowerCase();
    cleanEnv.USERPROFILE = isLegacyDefault ? os.homedir() : profile.environment_path;
    cleanEnv.APPDATA = isLegacyDefault ? this.defaultRoamingPathParent() : profileAppData;
    cleanEnv.LOCALAPPDATA = isLegacyDefault
      ? (process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'))
      : profileLocalAppData;
    cleanEnv.HOME = cleanEnv.USERPROFILE;

    const child = spawn(antigravityExe, isLegacyDefault ? [] : [`--user-data-dir=${userDataDir}`], {
      detached: true,
      stdio: 'ignore',
      env: cleanEnv,
      windowsHide: false
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

  private static defaultRoamingPathParent(): string {
    return path.dirname(this.defaultRoamingPath);
  }

  static getDetectedSystemAccounts(): string[] {
    const detected = new Set<string>();

    // 1. Check default Roaming app_storage.json
    try {
      const defaultStorage = path.join(this.defaultRoamingPath, 'app_storage.json');
      if (fs.existsSync(defaultStorage)) {
        const content = JSON.parse(fs.readFileSync(defaultStorage, 'utf-8'));
        if (content['jetski.onboarding.lastLoginUsername']) {
          detected.add(content['jetski.onboarding.lastLoginUsername']);
        }
      }
    } catch {}

    // 2. Check all existing profiles in DB
    try {
      const rows: any[] = db.prepare('SELECT google_account_label FROM account_profiles WHERE google_account_label IS NOT NULL').all();
      for (const r of rows) {
        if (r.google_account_label && r.google_account_label.includes('@')) {
          detected.add(r.google_account_label.trim());
        }
      }
    } catch {}

    return Array.from(detected);
  }

  static verifyProfile(profileId: string, _manualEmail?: string): {
    profile: AccountProfile;
    tested: boolean;
    hasSession: boolean;
    account: string | null;
  } {
    const profile = this.getProfile(profileId);
    if (!profile) {
      throw new Error(`Perfil ${profileId} não encontrado.`);
    }

    this.updateStatus(profile.id, 'VERIFYING');
    let hasSession = false;
    if (this._verifyProbeOverride) {
      try {
        hasSession = this._verifyProbeOverride(profile);
      } catch (err: any) {
        Logger.warn(`[AccountProfileManager] Verificação probe mock falhou para ${profile.id}: ${err.message}`);
      }
    } else {
      try {
        const env = this.getExecutionEnvForProfile(profile);
        const { conversationId } = ConversationManager.getOrCreateConversation({
          accountProfileId: profile.id,
          role: 'probe',
          model: 'flash',
          env,
          initialPrompt: 'Ping de verificação de autenticação do perfil DecoHUB.'
        });
        hasSession = typeof conversationId === 'string' && conversationId.length > 0;
        if (hasSession) Logger.info(`[AccountProfileManager] Perfil ${profile.id} comprovado por probe persistente ${conversationId}`);
      } catch (err: any) {
        Logger.warn(`[AccountProfileManager] Verificação agentapi falhou para ${profile.id}: ${err.message}`);
      }
    }

    const now = new Date().toISOString();
    db.prepare(`UPDATE account_profiles SET auth_status = ?, last_tested = ?, updated_at = ? WHERE id = ?`)
      .run(hasSession ? 'READY' : 'LOGIN_REQUIRED', now, now, profile.id);
    const updated = this.getProfile(profile.id)!;
    return { profile: updated, tested: true, hasSession, account: updated.google_account_label };
  }

  static updateStatus(profileId: string, status: AuthStatus): void {
    const current = this.getProfile(profileId);
    if (status === 'READY' && current?.quota_resets_at && new Date(current.quota_resets_at).getTime() > Date.now()) {
      // Do not clear QUOTA_EXHAUSTED while cooldown period is still active
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
    const row: any = db.prepare(`
      SELECT * FROM account_project_sessions
      WHERE project_id = ? AND account_profile_id = ?
    `).get(projectId, accountProfileId);
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



  static getRunningInstanceForProfile(envPath: string): { address: string; csrfToken: string; pid: number } | null {
    try {
      const psScript = `
        $procs = Get-CimInstance Win32_Process -Filter "Name = 'language_server.exe'";
        $list = @();
        foreach ($p in $procs) {
          $parent = Get-CimInstance Win32_Process -Filter ("ProcessId = " + $p.ParentProcessId);
          $ports = Get-NetTCPConnection -OwningProcess $p.ProcessId -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LocalPort;
          $grpcPort = if ($ports) { ($ports | Measure-Object -Maximum).Maximum } else { $null };
          $list += [PSCustomObject]@{
            Pid = $p.ProcessId;
            Cmd = $p.CommandLine;
            ParentCmd = if ($parent) { $parent.CommandLine } else { "" };
            Port = $grpcPort;
          };
        };
        $list | ConvertTo-Json -Compress
      `;

      const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', psScript], { encoding: 'utf-8', timeout: 8000 });
      const items = JSON.parse(out);
      const list = Array.isArray(items) ? items : [items];

      const isDefault = path.resolve(envPath).toLowerCase() === path.resolve(this.defaultRoamingPath).toLowerCase();

      for (const item of list) {
        const csrfMatch = item.Cmd?.match(/--csrf_token\s+([a-zA-Z0-9\-]+)/);
        const csrf = csrfMatch ? csrfMatch[1] : null;
        if (!csrf || !item.Port) continue;

        const parentCommand = String(item.ParentCmd || '').toLowerCase();
        if (isDefault && parentCommand.includes('antigravity.exe') && !parentCommand.includes('--user-data-dir')) {
          return { address: `127.0.0.1:${item.Port}`, csrfToken: csrf, pid: item.Pid };
        }

        if (!isDefault) {
          const expectedUserData = path.join(envPath, 'AppData', 'Roaming', 'Antigravity').toLowerCase();
          if (parentCommand.includes('antigravity.exe') && parentCommand.includes(`--user-data-dir=${expectedUserData}`)) {
            return { address: `127.0.0.1:${item.Port}`, csrfToken: csrf, pid: item.Pid };
          }
        }
      }
    } catch (e: any) {
      Logger.warn(`[AccountProfileManager] Falha ao descobrir instância para ${envPath}: ${e.message}`);
    }

    // A detached language server is not evidence of the GUI profile's login.
    return null;
  }

  static getExecutionEnvForProfile(profile: AccountProfile): NodeJS.ProcessEnv {
    const cleanEnv: NodeJS.ProcessEnv = { ...process.env };
    for (const k of Object.keys(cleanEnv)) {
      if (k.startsWith('ANTIGRAVITY_') || k.startsWith('AGY_') || k.startsWith('CODEIUM_') || k.startsWith('ELECTRON_')) {
        delete cleanEnv[k];
      }
    }

    const instance = this.getRunningInstanceForProfile(profile.environment_path);
    if (!instance) throw new Error(`AGENTAPI_UNAVAILABLE: nenhum runtime Antigravity pertence ao perfil ${profile.id}`);
    cleanEnv.ANTIGRAVITY_LS_ADDRESS = instance.address;
    cleanEnv.ANTIGRAVITY_CSRF_TOKEN = instance.csrfToken;
    Logger.info(`[AccountProfileManager] Conectando ao LS do perfil ${profile.display_name} em ${instance.address}`);

    const userProfileDir = profile.id === 'acc-pro-1'
      ? (process.env.USERPROFILE || os.homedir())
      : profile.environment_path;

    cleanEnv.USERPROFILE = userProfileDir;
    if (profile.id !== 'acc-pro-1') {
      cleanEnv.APPDATA = path.join(userProfileDir, 'AppData', 'Roaming');
      cleanEnv.LOCALAPPDATA = path.join(userProfileDir, 'AppData', 'Local');
      cleanEnv.HOME = userProfileDir;
    }
    cleanEnv.ANTIGRAVITY_PROJECT_ID = 'outside-of-project';

    // Ensure outside-of-project.json exists in this profile's .gemini/config/projects/
    try {
      const projDir = path.join(userProfileDir, '.gemini', 'config', 'projects');
      if (!fs.existsSync(projDir)) {
        fs.mkdirSync(projDir, { recursive: true });
      }
      const projFile = path.join(projDir, 'outside-of-project.json');
      if (!fs.existsSync(projFile)) {
        const defaultContent = {
          id: "outside-of-project",
          name: "Outside of Project",
          settings: {
            fileAccessPolicy: "AGENT_SETTING_POLICY_ALLOW",
            sandboxMode: false,
            autoExecutionPolicy: "CASCADE_COMMANDS_AUTO_EXECUTION_EAGER",
            artifactReviewMode: "ARTIFACT_REVIEW_MODE_TURBO"
          }
        };
        fs.writeFileSync(projFile, JSON.stringify(defaultContent, null, 2), 'utf-8');
      }
    } catch (err: any) {
      Logger.warn(`[AccountProfileManager] Falha ao verificar outside-of-project.json: ${err.message}`);
    }

    return cleanEnv;
  }

  // ----------------------------------------------------------------
  // ACCOUNT SWITCHING FLOW (Section 9)
  // ----------------------------------------------------------------

  static async switchAccount(opts: {
    projectId?: string;
    targetProfileId: string;
  }): Promise<{
    previousProfile: AccountProfile;
    activeProfile: AccountProfile;
    conversationId: string;
    bootstrapSent: boolean;
    checkpointCreated: boolean;
  }> {
    const { projectId, targetProfileId } = opts;
    const targetProfile = this.getProfile(targetProfileId);
    if (!targetProfile) {
      throw new Error(`Perfil alvo ${targetProfileId} não encontrado.`);
    }
    if (!this.verifyProfile(targetProfile.id).hasSession) {
      throw new Error(`ACCOUNT_LOGIN_REQUIRED: perfil ${targetProfile.id} não passou na verificação real do agentapi.`);
    }

    const previousProfile = projectId
      ? this.getActiveProfileForProject(projectId)
      : this.getGlobalActiveProfile();

    Logger.info(`[AccountSwitch] Iniciando troca de conta: ${previousProfile.display_name} -> ${targetProfile.display_name}${projectId ? ` no projeto "${projectId}"` : ''}`);

    let checkpointCreated = false;
    let targetConvId = '';
    let bootstrapSent = false;

    if (projectId) {
      const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
      if (!project) throw new Error(`Projeto ${projectId} não encontrado.`);
      if (project) {
        // 1. Block new prompts for previous profile
        // 2. Generate checkpoint
        try {
          CheckpointManager.createSessionCheckpoint(
            project.id,
            project.path,
            project.name,
            {
              objective: project.objective,
              customInstructions: `Checkpoint automático pré-troca de conta: ${previousProfile.display_name} -> ${targetProfile.display_name}`
            }
          );
          checkpointCreated = true;
          Logger.info(`[AccountSwitch] Checkpoint de preservação gerado com sucesso.`);
        } catch (err: any) {
          Logger.warn(`[AccountSwitch] Checkpoint warning: ${err.message}`);
        }

        // Git working tree is preserved as-is; switching accounts must not commit user files.

        // 4. Save conversation_id of previous profile
        const currentSession = this.getProjectSession(projectId, previousProfile.id);
        Logger.info(`[AccountSwitch] Sessão preservada de ${previousProfile.display_name}: convId=${currentSession?.conversation_id || 'nenhum'}`);

        // 5. Get or create conversation B before changing the active route.
        const targetSession = this.getProjectSession(projectId, targetProfile.id);
        targetConvId = targetSession?.conversation_id || '';

        const lsExe = getLanguageServerExe();
        const isolatedEnv = this.getExecutionEnvForProfile(targetProfile);

        if (!targetConvId) {
          // Spawn new conversation in target account
          try {
            Logger.info(`[AccountSwitch] Criando nova conversation para ${targetProfile.display_name}...`);
            const title = `Projeto ${project.name} (${targetProfile.display_name})`;
            const initialPrompt = `Você é o agente responsável pelo projeto ${project.name} usando o perfil ${targetProfile.display_name}.`;
            
            const out = execFileSync(
              lsExe,
              ['agentapi', 'new-conversation', '--model=flash', `--title=${title}`, initialPrompt],
              { encoding: 'utf-8', timeout: 30000, env: isolatedEnv }
            );
            const parsed = JSON.parse(out);
            targetConvId = parsed?.response?.newConversation?.conversationId || '';

            if (targetConvId) {
              this.setProjectSession(projectId, targetProfile.id, targetConvId);
              Logger.success(`[AccountSwitch] Nova conversation criada para ${targetProfile.display_name}: ${targetConvId}`);
            }
          } catch (err: any) {
            Logger.error(`[AccountSwitch] Erro ao criar conversation para ${targetProfile.display_name}: ${err.message}`);
            throw new Error(`AGENTAPI_UNAVAILABLE: não foi possível criar conversa no perfil ${targetProfile.id}: ${err.message}`);
          }
        }

        // 7-10. Recuperar contexto do Hub, Git, tarefa atual e enviar BOOTSTRAP para B
        if (targetConvId) {
          try {
            const memory = MemoryManager.readMemoryFiles(project.path);
            const bootstrapMsg = [
              `=== BOOTSTRAP DE CONTINUIDADE (AI DEV HUB) ===`,
              `PROJETO: ${project.name}`,
              `DIRETÓRIO: ${project.path}`,
              `CONTA ATIVA: ${targetProfile.display_name} (${targetProfile.google_account_label || 'Autenticada'})`,
              `CONTA ANTERIOR: ${previousProfile.display_name}`,
              ``,
              `Você está continuando um projeto existente.`,
              `Leia o contexto fornecido pelo AI DEV HUB.`,
              `Verifique o Git.`,
              `Não refaça tarefas concluídas.`,
              `Continue exatamente do estado atual.`,
              ``,
              `--- RESUMO DO PROJETO ---`,
              memory.projectMd ? memory.projectMd.slice(0, 500) : project.objective || 'Em desenvolvimento',
              ``,
              `--- TAREFAS / KANBAN ---`,
              memory.tasksMd ? memory.tasksMd.slice(0, 800) : 'Sem tarefas registradas',
            ].join('\n');

            execFileSync(
              lsExe,
              ['agentapi', 'send-message', targetConvId, bootstrapMsg],
              { encoding: 'utf-8', timeout: 30000, env: isolatedEnv }
            );
            bootstrapSent = true;
          } catch (err: any) {
            Logger.warn(`[AccountSwitch] Falha ao enviar bootstrap via send-message: ${err.message}`);
          }
        }
      }
    }

    this.setGlobalActiveProfile(targetProfile.id);
    if (projectId) {
      db.prepare('UPDATE projects SET active_account_profile_id = ?, updated_at = ? WHERE id = ?')
        .run(targetProfile.id, new Date().toISOString(), projectId);
    }

    return {
      previousProfile,
      activeProfile: targetProfile,
      conversationId: targetConvId,
      bootstrapSent,
      checkpointCreated
    };
  }

  static sendMessageToActiveAccount(projectId: string, content: string): { success: boolean; conversationId?: string; reply?: any } {
    const activeProfile = this.getActiveProfileForProject(projectId);
    let session = this.getProjectSession(projectId, activeProfile.id);
    const lsExe = getLanguageServerExe();
    const isolatedEnv = this.getExecutionEnvForProfile(activeProfile);

    // If no existing conversation for this account, create one now
    if (!session || !session.conversation_id) {
      try {
        const title = `Projeto ${projectId.slice(0, 8)} (${activeProfile.display_name})`;
        Logger.info(`[AccountProfileManager] Criando conversa automática para ${activeProfile.display_name}...`);
        const out = execFileSync(
          lsExe,
          ['agentapi', 'new-conversation', '--model=flash', `--title=${title}`, content],
          { encoding: 'utf-8', timeout: 30000, env: isolatedEnv }
        );
        const parsed = JSON.parse(out);
        const convId = parsed?.response?.newConversation?.conversationId;
        if (convId) {
          this.setProjectSession(projectId, activeProfile.id, convId);
          Logger.success(`[AccountProfileManager] Conversa criada: ${convId.slice(0, 8)}`);
          return { success: true, conversationId: convId, reply: parsed };
        }
      } catch (err: any) {
        Logger.warn(`[AccountProfileManager] Falha ao criar conversa: ${err.message}`);
        return { success: false };
      }
    }

    if (!session || !session.conversation_id) {
      return { success: false };
    }

    try {
      const out = execFileSync(
        lsExe,
        ['agentapi', 'send-message', session.conversation_id, content],
        { encoding: 'utf-8', timeout: 30000, env: isolatedEnv }
      );
      return { success: true, conversationId: session.conversation_id, reply: JSON.parse(out) };
    } catch (err: any) {
      Logger.warn(`[AccountProfileManager] Erro ao enviar mensagem para sessão ativa: ${err.message}`);
      return { success: false, conversationId: session.conversation_id };
    }
  }

  static markQuotaExhausted(profileId: string, errorMsg?: string): AccountProfile {
    const now = new Date();
    const rawMsg = errorMsg || 'Limite de cota individual atingido (RESOURCE_EXHAUSTED 429).';
    let durationMs = 60 * 60 * 1000; // default 1h

    // Parse "Resets in 1h45m12s" or "Resets in 45m" or similar
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

    // Set associated workers to COOLDOWN
    try {
      db.prepare(`
        UPDATE workers
        SET status = 'COOLDOWN', updated_at = ?
        WHERE account_profile_id = ?
      `).run(nowIso, profileId);
    } catch {}

    Logger.warn(`[AccountProfileManager] Conta ${profileId} marcada como QUOTA_EXHAUSTED (Reseta às ${resetTime.toLocaleTimeString()}).`);
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
          SET auth_status = 'READY', quota_resets_at = NULL, quota_message = NULL, updated_at = ?
          WHERE id = ?
        `).run(now, profileId);

        try {
          db.prepare(`
            UPDATE workers
            SET status = 'READY', updated_at = ?
            WHERE account_profile_id = ? AND status = 'COOLDOWN'
          `).run(now, profileId);
        } catch {}

        Logger.info(`[AccountProfileManager] Período de restabelecimento de cota atingido para "${profile.display_name}". Status restaurado para READY.`);
        const updatedRow: any = db.prepare('SELECT * FROM account_profiles WHERE id = ?').get(profileId);
        return updatedRow ? this._rowToProfile(updatedRow) : profile;
      }
    }
    return profile;
  }

  static isAccountAvailableForTasks(profileId: string): boolean {
    const refreshed = this.checkAndRefreshQuotaStatus(profileId);
    const profile = refreshed || this.getProfile(profileId);
    if (!profile) return false;
    if (profile.auth_status === 'QUOTA_EXHAUSTED' || profile.auth_status === 'LOGIN_REQUIRED' || profile.auth_status === 'ERROR') {
      return false;
    }
    if (profile.quota_resets_at && new Date(profile.quota_resets_at).getTime() > Date.now()) {
      return false;
    }
    return profile.auth_status === 'READY' || profile.auth_status === 'ACTIVE';
  }

  private static _rowToProfile(row: any): AccountProfile {
    return {
      id: row.id,
      display_name: row.display_name,
      profile_name: row.profile_name,
      google_account_label: row.google_account_label,
      environment_path: row.environment_path,
      auth_status: row.auth_status as AuthStatus,
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
