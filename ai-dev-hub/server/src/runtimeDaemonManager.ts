// server/src/runtimeDaemonManager.ts
// Headless Single-Process Background Daemon Manager and Resilient Connection Handshake

import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Logger } from './logger.js';
import { AntigravityDiscovery } from './antigravityDiscovery.js';
import {
  collectRuntimeProcessSnapshot,
  clearRuntimeProcessSnapshotCache,
  normalizeRuntimePath
} from './runtimeProfileSelector.js';
import { AccountProfileManager, AccountProfile } from './accountProfileManager.js';

export interface RuntimeDaemonCredentials {
  address: string;
  csrfToken: string;
  pid: number;
}

export class RuntimeDaemonManager {
  private static instance: RuntimeDaemonManager | null = null;

  // In-memory Mutex to prevent concurrent spawn storms across parallel requests
  private activeBootPromises = new Map<string, Promise<RuntimeDaemonCredentials | null>>();
  private syncBootLocks = new Set<string>();

  public static getInstance(): RuntimeDaemonManager {
    if (!RuntimeDaemonManager.instance) {
      RuntimeDaemonManager.instance = new RuntimeDaemonManager();
    }
    return RuntimeDaemonManager.instance;
  }

  /**
   * Resolves effective profile or fallback to active/default profile
   */
  private resolveProfile(profileId?: string): AccountProfile | null {
    if (profileId) {
      const found = AccountProfileManager.getProfile(profileId);
      if (found) return found;
    }
    try {
      return AccountProfileManager.getGlobalActiveProfile() || null;
    } catch {
      return null;
    }
  }

  /**
   * Resolves the environment path for profile inspection
   */
  private resolveEnvironmentPath(profile: AccountProfile | null): string {
    if (profile?.environment_path) {
      return profile.environment_path;
    }
    return AccountProfileManager.defaultRoamingPath;
  }

  /**
   * Inspects if an existing language_server or Antigravity is active and responding
   */
  public getActiveCredentials(profileId?: string): RuntimeDaemonCredentials | null {
    if (
      AccountProfileManager.isOfflineMode() ||
      (AccountProfileManager.isAutomatedTestRuntime() && process.env.DECOHUB_ALLOW_LIVE_AGENTAPI !== 'true')
    ) {
      return null;
    }
    const profile = this.resolveProfile(profileId);
    const envPath = this.resolveEnvironmentPath(profile);

    const instance = AccountProfileManager.getRunningInstanceForProfile(envPath);
    if (instance?.address && instance?.csrfToken) {
      return instance;
    }

    const fallback = AccountProfileManager.findAnyLiveLanguageServerInstance();
    if (fallback?.address && fallback?.csrfToken) {
      return fallback;
    }

    return null;
  }

  /**
   * Checks if language_server or Antigravity is alive
   */
  public isRuntimeAlive(profileId?: string): boolean {
    return Boolean(this.getActiveCredentials(profileId));
  }

  /**
   * Checks if any Antigravity GUI or Language Server process is already running in Win32_Process
   */
  private hasAliveProcessForProfile(profile: AccountProfile | null): boolean {
    try {
      const processes = collectRuntimeProcessSnapshot();
      if (!processes || processes.length === 0) return false;

      const appExe = AntigravityDiscovery.getAntigravityAppExe();
      const normExpectedApp = appExe ? normalizeRuntimePath(appExe) : null;
      const expectedUserData = profile
        ? normalizeRuntimePath(profile.environment_path)
        : normalizeRuntimePath(AccountProfileManager.defaultRoamingPath);

      for (const p of processes) {
        const name = (p.name || '').toLowerCase();
        if (name === 'language_server.exe' || name === 'language_server_windows_x64.exe') {
          return true;
        }
        if (name === 'antigravity.exe') {
          if (!normExpectedApp || (p.executable && normalizeRuntimePath(p.executable) === normExpectedApp)) {
            if (!p.userDataDir) {
              return true;
            }
            if (normalizeRuntimePath(p.userDataDir) === expectedUserData) {
              return true;
            }
          }
        }
      }
    } catch (err: any) {
      Logger.warn(`[RuntimeDaemonManager] Falha ao inspecionar snapshot de processos: ${err.message}`);
    }
    return false;
  }

  /**
   * Ensures a single headless background instance is running with concurrency mutex and port handshake.
   * If already responding, returns immediately.
   * If not responding, auto-boots in background (windowsHide: true, normal/below normal priority)
   * and awaits port/csrf handshake up to 10s.
   */
  public async ensureSingleRuntimeRunning(
    profileId?: string,
    timeoutMs = 10000
  ): Promise<RuntimeDaemonCredentials | null> {
    if (
      AccountProfileManager.isOfflineMode() ||
      (AccountProfileManager.isAutomatedTestRuntime() && process.env.DECOHUB_ALLOW_LIVE_AGENTAPI !== 'true')
    ) {
      return null;
    }

    const profile = this.resolveProfile(profileId);
    const lockKey = profile ? profile.id : 'global-default';

    // Concurrency Mutex: if another call is currently booting this runtime, join that promise
    const existingPromise = this.activeBootPromises.get(lockKey);
    if (existingPromise) {
      Logger.info(`[RuntimeDaemonManager] Aguardando inicialização de runtime já em andamento para "${lockKey}"...`);
      return existingPromise;
    }

    const bootPromise = (async (): Promise<RuntimeDaemonCredentials | null> => {
      try {
        const envPath = this.resolveEnvironmentPath(profile);

        // 1. Reutilização imediata se já houver processo respondendo na porta
        AccountProfileManager.clearRuntimeCaches();
        clearRuntimeProcessSnapshotCache();
        const active = this.getActiveCredentials(profileId);
        if (active) {
          process.env.ANTIGRAVITY_LS_ADDRESS = active.address;
          process.env.ANTIGRAVITY_CSRF_TOKEN = active.csrfToken;
          return active;
        }

        // 2. Se já existir processo vivo em inicialização, aguarda handshake sem abrir nova instância
        const processAlive = this.hasAliveProcessForProfile(profile);
        if (!processAlive) {
          const antigravityExe = AntigravityDiscovery.getAntigravityAppExe();
          if (!antigravityExe) {
            Logger.warn('[RuntimeDaemonManager] Executável do Antigravity não encontrado para auto-boot.');
            return null;
          }

          let cleanEnv: NodeJS.ProcessEnv = { ...process.env };
          let args: string[] = ['--headless'];

          if (profile) {
            const canonicalUserDataDir = AccountProfileManager.ensureProfileDirectoriesAndSyncAuth(profile.environment_path);
            cleanEnv = AccountProfileManager.buildIsolatedSpawnEnv(profile);
            const isLegacyDefault =
              normalizeRuntimePath(profile.environment_path) === normalizeRuntimePath(AccountProfileManager.defaultRoamingPath);
            args = isLegacyDefault
              ? ['--headless']
              : [`--user-data-dir=${canonicalUserDataDir}`, '--headless'];
          }

          const isSecondary = Boolean(
            profile &&
            (profile.id !== 'acc-pro-1' ||
             normalizeRuntimePath(profile.environment_path) !== normalizeRuntimePath(AccountProfileManager.defaultRoamingPath))
          );
          const hasAnyRunning = AntigravityDiscovery.isLanguageServerOrAntigravityRunning();

          let targetExe = antigravityExe;
          if (isSecondary && hasAnyRunning) {
            let lsExe: string | null = null;
            try {
              const { getLanguageServerExe } = await import('./antigravityProvider.js');
              lsExe = getLanguageServerExe();
            } catch {
              const disc = AntigravityDiscovery.discover();
              lsExe = disc.languageServerExe;
            }
            if (lsExe && fs.existsSync(lsExe)) {
              targetExe = lsExe;
              const csrfToken = crypto.randomUUID();
              args = ['--standalone', `--csrf_token=${csrfToken}`];
              Logger.info(
                `[RuntimeDaemonManager] Auto-boot de perfil secundário "${profile?.display_name}": executando language_server.exe headless diretamente para contornar single-instance lock do Electron.`
              );
            }
          }

          Logger.info(
            `[RuntimeDaemonManager] Iniciando processo único em 2º plano (Headless) do Antigravity para "${profile?.display_name || 'padrão'}"...`
          );

          try {
            const child = spawn(targetExe, args, {
              detached: true,
              stdio: 'ignore',
              env: cleanEnv,
              windowsHide: true
            });

            if (child.pid) {
              try {
                os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
              } catch {}
            }

            child.on('error', (spawnErr: any) => {
              Logger.warn(`[RuntimeDaemonManager] Erro no processo daemon do Antigravity: ${spawnErr.message}`);
            });

            child.unref();
          } catch (spawnError: any) {
            Logger.warn(`[RuntimeDaemonManager] Falha ao disparar processo background: ${spawnError.message}`);
            return null;
          }
        } else {
          Logger.info(
            `[RuntimeDaemonManager] Processo existente detectado para "${profile?.display_name || 'padrão'}". Aguardando handshake sem abrir duplicata...`
          );
        }

        // 3. Handshake defensivo de porta / CSRF (timeout até 10 segundos)
        const startTime = Date.now();
        const effectiveTimeout = Math.max(timeoutMs, 6000);

        while (Date.now() - startTime < effectiveTimeout) {
          await new Promise(resolve => setTimeout(resolve, 600));

          AccountProfileManager.clearRuntimeCaches();
          clearRuntimeProcessSnapshotCache();

          const ready = this.getActiveCredentials(profileId);
          if (ready?.address && ready?.csrfToken) {
            process.env.ANTIGRAVITY_LS_ADDRESS = ready.address;
            process.env.ANTIGRAVITY_CSRF_TOKEN = ready.csrfToken;
            Logger.success(
              `[RuntimeDaemonManager] Conexão com Language Server estabelecida com sucesso: ${ready.address} (PID ${ready.pid}).`
            );
            return ready;
          }
        }

        Logger.warn(
          `[RuntimeDaemonManager] Handshake expirou após ${effectiveTimeout}ms sem resposta na porta para perfil "${profile?.display_name || 'padrão'}".`
        );
        return this.getActiveCredentials(profileId);
      } finally {
        this.activeBootPromises.delete(lockKey);
      }
    })();

    this.activeBootPromises.set(lockKey, bootPromise);
    return bootPromise;
  }

  /**
   * Synchronous counterpart for contexts requiring non-async execution with mutex protection
   */
  public ensureSingleRuntimeRunningSync(
    profileId?: string,
    timeoutMs = 10000
  ): RuntimeDaemonCredentials | null {
    if (
      AccountProfileManager.isOfflineMode() ||
      (AccountProfileManager.isAutomatedTestRuntime() && process.env.DECOHUB_ALLOW_LIVE_AGENTAPI !== 'true')
    ) {
      return null;
    }

    const profile = this.resolveProfile(profileId);
    const lockKey = profile ? profile.id : 'global-default';

    if (this.syncBootLocks.has(lockKey)) {
      return this.getActiveCredentials(profileId);
    }

    this.syncBootLocks.add(lockKey);
    try {
      AccountProfileManager.clearRuntimeCaches();
      clearRuntimeProcessSnapshotCache();

      const existing = this.getActiveCredentials(profileId);
      if (existing) {
        process.env.ANTIGRAVITY_LS_ADDRESS = existing.address;
        process.env.ANTIGRAVITY_CSRF_TOKEN = existing.csrfToken;
        return existing;
      }

      const processAlive = this.hasAliveProcessForProfile(profile);
      if (!processAlive) {
        const antigravityExe = AntigravityDiscovery.getAntigravityAppExe();
        if (!antigravityExe) return null;

        let cleanEnv: NodeJS.ProcessEnv = { ...process.env };
        let args: string[] = ['--headless'];

        if (profile) {
          const canonicalUserDataDir = AccountProfileManager.ensureProfileDirectoriesAndSyncAuth(profile.environment_path);
          cleanEnv = AccountProfileManager.buildIsolatedSpawnEnv(profile);
          const isLegacyDefault =
            normalizeRuntimePath(profile.environment_path) === normalizeRuntimePath(AccountProfileManager.defaultRoamingPath);
          args = isLegacyDefault
            ? ['--headless']
            : [`--user-data-dir=${canonicalUserDataDir}`, '--headless'];
        }

        Logger.info(
          `[RuntimeDaemonManager] Auto-boot síncrono em 2º plano para perfil "${profile?.display_name || 'padrão'}"...`
        );

        try {
          const child = spawn(antigravityExe, args, {
            detached: true,
            stdio: 'ignore',
            env: cleanEnv,
            windowsHide: true
          });
          if (child.pid) {
            try {
              os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
            } catch {}
          }
          child.unref();
        } catch (err: any) {
          Logger.warn(`[RuntimeDaemonManager] Falha no spawn síncrono: ${err.message}`);
          return null;
        }
      }

      const startTime = Date.now();
      const effectiveTimeout = Math.max(timeoutMs, 6000);

      while (Date.now() - startTime < effectiveTimeout) {
        try {
          execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Start-Sleep -Milliseconds 600'], {
            windowsHide: true,
            stdio: 'ignore',
            timeout: 1500
          });
        } catch {
          const waitEnd = Date.now() + 600;
          while (Date.now() < waitEnd) {}
        }

        AccountProfileManager.clearRuntimeCaches();
        clearRuntimeProcessSnapshotCache();

        const ready = this.getActiveCredentials(profileId);
        if (ready?.address && ready?.csrfToken) {
          process.env.ANTIGRAVITY_LS_ADDRESS = ready.address;
          process.env.ANTIGRAVITY_CSRF_TOKEN = ready.csrfToken;
          Logger.success(
            `[RuntimeDaemonManager] Conexão síncrona com Language Server estabelecida: ${ready.address} (PID ${ready.pid}).`
          );
          return ready;
        }
      }

      return this.getActiveCredentials(profileId);
    } finally {
      this.syncBootLocks.delete(lockKey);
    }
  }

  /**
   * Static convenience methods for direct access
   */
  public static async ensureSingleRuntimeRunning(
    profileId?: string,
    timeoutMs = 10000
  ): Promise<RuntimeDaemonCredentials | null> {
    return RuntimeDaemonManager.getInstance().ensureSingleRuntimeRunning(profileId, timeoutMs);
  }

  public static ensureSingleRuntimeRunningSync(
    profileId?: string,
    timeoutMs = 10000
  ): RuntimeDaemonCredentials | null {
    return RuntimeDaemonManager.getInstance().ensureSingleRuntimeRunningSync(profileId, timeoutMs);
  }

  public static getActiveCredentials(profileId?: string): RuntimeDaemonCredentials | null {
    return RuntimeDaemonManager.getInstance().getActiveCredentials(profileId);
  }
}
