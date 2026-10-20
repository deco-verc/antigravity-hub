import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { db, HUB_DATA_DIR } from './db.js';
import { ObservabilityService } from './observability/observabilityService.js';
import { Logger } from './logger.js';

export interface UpdateManifest {
  version: string;
  releaseDate?: string;
  releaseNotes?: string;
  downloadUrl: string;
  sha256?: string;
  size?: number;
  mandatory?: boolean;
}

export type UpdateStatus =
  | 'IDLE'
  | 'CHECKING'
  | 'AVAILABLE'
  | 'UP_TO_DATE'
  | 'DOWNLOADING'
  | 'DOWNLOADED'
  | 'APPLYING'
  | 'ERROR';

export interface UpdateState {
  status: UpdateStatus;
  currentVersion: string;
  latestVersion: string | null;
  manifest: UpdateManifest | null;
  downloadProgress: { downloadedBytes: number; totalBytes: number; percent: number } | null;
  downloadedFilePath: string | null;
  verified: boolean;
  lastCheckTime: string | null;
  error: string | null;
  feedUrl: string | null;
  autoCheck: boolean;
  checkIntervalMinutes: number;
}

export class UpdateService {
  private static state: UpdateState = {
    status: 'IDLE',
    currentVersion: UpdateService.resolveCurrentVersion(),
    latestVersion: null,
    manifest: null,
    downloadProgress: null,
    downloadedFilePath: null,
    verified: false,
    lastCheckTime: null,
    error: null,
    feedUrl: null,
    autoCheck: true,
    checkIntervalMinutes: 60
  };

  private static checkTimer: NodeJS.Timeout | null = null;

  static resolveCurrentVersion(): string {
    try {
      const pkgPath = path.resolve(process.cwd(), 'package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (pkg.version) return pkg.version;
      }
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "updateService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:updateService]", err);
      }
    }
    return '1.0.7';
  }

  static setCurrentVersionForTesting(version: string) {
    this.state.currentVersion = version;
  }

  static setDownloadedStateForTesting(filePath: string, version: string = '1.0.8') {
    this.state.status = 'DOWNLOADED';
    this.state.downloadedFilePath = filePath;
    this.state.manifest = {
      version,
      downloadUrl: filePath
    };
    this.state.verified = true;
    this.state.error = null;
  }

  static getStatus(): UpdateState {
    return { ...this.state };
  }

  static updateConfig(newConfig: Partial<{ feedUrl: string | null; autoCheck: boolean; checkIntervalMinutes: number }>) {
    if (newConfig.feedUrl !== undefined) this.state.feedUrl = newConfig.feedUrl;
    if (newConfig.autoCheck !== undefined) this.state.autoCheck = newConfig.autoCheck;
    if (newConfig.checkIntervalMinutes !== undefined) this.state.checkIntervalMinutes = Math.max(1, newConfig.checkIntervalMinutes);

    ObservabilityService.emit({
      level: 'INFO',
      event: 'update.config_updated',
      message: `Configuração do auto-updater atualizada: feed=${this.state.feedUrl}, autoCheck=${this.state.autoCheck}, interval=${this.state.checkIntervalMinutes}m`,
      service: 'updater',
      metadata: { feedUrl: this.state.feedUrl, autoCheck: this.state.autoCheck, checkIntervalMinutes: this.state.checkIntervalMinutes }
    });

    this.resetTimer();
    return this.getStatus();
  }

  static compareSemver(v1: string, v2: string): number {
    const clean1 = (v1 || '').replace(/^v/, '').trim();
    const clean2 = (v2 || '').replace(/^v/, '').trim();

    const parts1 = clean1.split('.').map(p => parseInt(p, 10) || 0);
    const parts2 = clean2.split('.').map(p => parseInt(p, 10) || 0);

    for (let i = 0; i < 3; i++) {
      const n1 = parts1[i] ?? 0;
      const n2 = parts2[i] ?? 0;
      if (n1 > n2) return 1;
      if (n1 < n2) return -1;
    }
    return 0;
  }

  static async checkForUpdates(overrideFeedUrl?: string): Promise<{ updateAvailable: boolean; currentVersion: string; latestVersion: string | null; manifest: UpdateManifest | null }> {
    const targetUrl = overrideFeedUrl || this.state.feedUrl;
    this.state.status = 'CHECKING';
    this.state.error = null;
    this.state.lastCheckTime = new Date().toISOString();

    ObservabilityService.emit({
      level: 'INFO',
      event: 'update.check_started',
      message: `Verificando atualizações no canal: ${targetUrl || 'default'}`,
      service: 'updater',
      metadata: { targetUrl, currentVersion: this.state.currentVersion }
    });

    try {
      if (!targetUrl) {
        // Without explicit feed configured, system is up to date (or awaiting configuration)
        this.state.status = 'UP_TO_DATE';
        this.state.latestVersion = this.state.currentVersion;
        this.state.manifest = null;
        ObservabilityService.emit({
          level: 'INFO',
          event: 'update.up_to_date',
          message: `Nenhum canal remoto configurado. Sistema considerado estável na versão ${this.state.currentVersion}`,
          service: 'updater'
        });
        return { updateAvailable: false, currentVersion: this.state.currentVersion, latestVersion: this.state.currentVersion, manifest: null };
      }

      let manifestContent = '';

      if (targetUrl.startsWith('file://')) {
        const filePath = targetUrl.replace(/^file:\/\//, '').replace(/^\/([a-zA-Z]:)/, '$1');
        manifestContent = await fs.promises.readFile(filePath, 'utf-8');
      } else if (path.isAbsolute(targetUrl) && fs.existsSync(targetUrl)) {
        manifestContent = await fs.promises.readFile(targetUrl, 'utf-8');
      } else {
        const response = await fetch(targetUrl, { signal: AbortSignal.timeout(10000) });
        if (!response.ok) {
          throw new Error(`Falha ao obter manifesto de atualização (HTTP ${response.status})`);
        }
        manifestContent = await response.text();
      }

      const manifest: UpdateManifest = JSON.parse(manifestContent);
      if (!manifest.version || !manifest.downloadUrl) {
        throw new Error('Manifesto de atualização inválido: campos "version" e "downloadUrl" são obrigatórios');
      }

      this.state.latestVersion = manifest.version;
      this.state.manifest = manifest;

      const isNewer = this.compareSemver(manifest.version, this.state.currentVersion) > 0;

      if (isNewer) {
        this.state.status = 'AVAILABLE';
        ObservabilityService.emit({
          level: 'INFO',
          event: 'update.available',
          message: `Nova versão estável encontrada: v${manifest.version} (atual: v${this.state.currentVersion})`,
          service: 'updater',
          metadata: { currentVersion: this.state.currentVersion, newVersion: manifest.version, releaseNotes: manifest.releaseNotes }
        });
        return { updateAvailable: true, currentVersion: this.state.currentVersion, latestVersion: manifest.version, manifest };
      } else {
        this.state.status = 'UP_TO_DATE';
        ObservabilityService.emit({
          level: 'INFO',
          event: 'update.up_to_date',
          message: `DecoHUB atualizado na versão estável mais recente (v${this.state.currentVersion})`,
          service: 'updater',
          metadata: { currentVersion: this.state.currentVersion, latestVersion: manifest.version }
        });
        return { updateAvailable: false, currentVersion: this.state.currentVersion, latestVersion: manifest.version, manifest };
      }
    } catch (err: any) {
      this.state.status = 'ERROR';
      this.state.error = err.message;
      ObservabilityService.emit({
        level: 'WARN',
        event: 'update.error',
        message: `Erro ao verificar atualizações: ${err.message}`,
        service: 'updater',
        metadata: { error: err.message, stack: err.stack }
      });
      return { updateAvailable: false, currentVersion: this.state.currentVersion, latestVersion: null, manifest: null };
    }
  }

  static async downloadUpdate(): Promise<{ success: boolean; filePath: string; verified: boolean; sha256: string }> {
    if (!this.state.manifest || !this.state.manifest.downloadUrl) {
      throw new Error('Nenhuma atualização disponível para download. Execute checkForUpdates primeiro.');
    }

    const manifest = this.state.manifest;
    const updatesDir = path.join(HUB_DATA_DIR, 'cache', 'updates');
    await fs.promises.mkdir(updatesDir, { recursive: true });

    const rawFilename = path.basename(manifest.downloadUrl.split('?')[0]) || `DecoHUB-Setup-${manifest.version}.exe`;
    const finalFilePath = path.join(updatesDir, rawFilename);
    const tempFilePath = `${finalFilePath}.downloading-${Date.now()}`;

    this.state.status = 'DOWNLOADING';
    this.state.downloadProgress = { downloadedBytes: 0, totalBytes: manifest.size || 0, percent: 0 };
    this.state.error = null;

    ObservabilityService.emit({
      level: 'INFO',
      event: 'update.download_started',
      message: `Iniciando download da versão v${manifest.version}...`,
      service: 'updater',
      metadata: { version: manifest.version, downloadUrl: manifest.downloadUrl, targetPath: finalFilePath }
    });

    try {
      const hasher = crypto.createHash('sha256');

      if (manifest.downloadUrl.startsWith('file://') || (path.isAbsolute(manifest.downloadUrl) && fs.existsSync(manifest.downloadUrl))) {
        const sourcePath = manifest.downloadUrl.replace(/^file:\/\//, '').replace(/^\/([a-zA-Z]:)/, '$1');
        const buffer = await fs.promises.readFile(sourcePath);
        hasher.update(buffer);
        await fs.promises.writeFile(tempFilePath, buffer);
        this.state.downloadProgress = { downloadedBytes: buffer.length, totalBytes: buffer.length, percent: 100 };
      } else {
        const response = await fetch(manifest.downloadUrl);
        if (!response.ok || !response.body) {
          throw new Error(`Falha no download da atualização (HTTP ${response.status})`);
        }

        const totalBytes = Number(response.headers.get('content-length')) || manifest.size || 0;
        let downloadedBytes = 0;
        const fileStream = fs.createWriteStream(tempFilePath);

        const reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            hasher.update(value);
            fileStream.write(Buffer.from(value));
            downloadedBytes += value.length;
            const percent = totalBytes > 0 ? Math.round((downloadedBytes / totalBytes) * 100) : 0;
            this.state.downloadProgress = { downloadedBytes, totalBytes, percent };
          }
        }
        await new Promise((resolve, reject) => {
          fileStream.end((err?: Error | null) => {
            if (err) reject(err);
            else resolve(null);
          });
        });
      }

      const calculatedSha = hasher.digest('hex');

      // Verify integrity against declared hash
      if (manifest.sha256) {
        const expectedSha = manifest.sha256.trim().toLowerCase();
        if (calculatedSha.toLowerCase() !== expectedSha) {
          try { await fs.promises.unlink(tempFilePath); } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "updateService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:updateService]", err);
      }
    }
          throw new Error(`Falha de integridade da atualização (SHA-256 divergente: esperado ${expectedSha}, obtido ${calculatedSha})`);
        }
      }

      // Rename temp file to final destination
      await fs.promises.rename(tempFilePath, finalFilePath);

      this.state.status = 'DOWNLOADED';
      this.state.downloadedFilePath = finalFilePath;
      this.state.verified = true;

      ObservabilityService.emit({
        level: 'INFO',
        event: 'update.download_completed',
        message: `Download da versão v${manifest.version} concluído e verificado com sucesso.`,
        service: 'updater',
        metadata: { version: manifest.version, filePath: finalFilePath, sha256: calculatedSha, verified: true }
      });

      return {
        success: true,
        filePath: finalFilePath,
        verified: true,
        sha256: calculatedSha
      };
    } catch (err: any) {
      try {
        if (fs.existsSync(tempFilePath)) await fs.promises.unlink(tempFilePath);
      } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "updateService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:updateService]", err);
      }
    }

      this.state.status = 'ERROR';
      this.state.error = err.message;

      ObservabilityService.emit({
        level: 'ERROR',
        event: 'update.download_failed',
        message: `Falha ao baixar atualização: ${err.message}`,
        service: 'updater',
        metadata: { error: err.message, stack: err.stack }
      });

      throw err;
    }
  }

  static hasActiveWork(): boolean {
    try {
      const activeRun = db.prepare(`
        SELECT count(*) as c FROM autonomous_runs
        WHERE status IN ('running', 'in_progress', 'building', 'testing', 'reviewing', 'planning', 'waiting_for_worker')
      `).get() as any;

      if (activeRun && activeRun.c > 0) return true;

      const activeReservation = db.prepare(`
        SELECT count(*) as c FROM execution_reservations
      `).get() as any;

      if (activeReservation && activeReservation.c > 0) return true;
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "updateService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:updateService]", err);
      }
    }
    return false;
  }

  static applyUpdate(options: { force?: boolean; dryRun?: boolean } = {}): { success: boolean; reason?: string; message: string; filePath?: string } {
    if (this.state.status !== 'DOWNLOADED' || !this.state.downloadedFilePath) {
      return {
        success: false,
        reason: 'NOT_READY',
        message: 'A atualização ainda não foi baixada ou verificada.'
      };
    }

    if (!fs.existsSync(this.state.downloadedFilePath)) {
      this.state.status = 'ERROR';
      this.state.error = 'Arquivo da atualização não foi encontrado no disco.';
      return {
        success: false,
        reason: 'FILE_NOT_FOUND',
        message: 'Arquivo do instalador não encontrado no disco.'
      };
    }

    // Safety guard against applying update during active orchestration
    if (!options.force && this.hasActiveWork()) {
      ObservabilityService.emit({
        level: 'WARN',
        event: 'update.apply_blocked',
        message: 'Aplicação da atualização retida: existe um ciclo autônomo ativo em andamento.',
        service: 'updater'
      });
      return {
        success: false,
        reason: 'ACTIVE_WORK_IN_PROGRESS',
        message: 'Existe um ciclo autônomo em execução ativa. Conclua ou pause o trabalho antes de reiniciar.'
      };
    }

    this.state.status = 'APPLYING';

    ObservabilityService.emit({
      level: 'INFO',
      event: 'update.apply_started',
      message: `Disparando instalador da versão v${this.state.manifest?.version || 'nova'} (${this.state.downloadedFilePath})...`,
      service: 'updater',
      metadata: { filePath: this.state.downloadedFilePath, dryRun: options.dryRun || false }
    });

    if (options.dryRun) {
      return {
        success: true,
        message: '[DRY-RUN] Instalador validado e pronto para execução.',
        filePath: this.state.downloadedFilePath
      };
    }

    try {
      if (process.platform === 'win32') {
        // Spawn NSIS installer detached with silent flag /S
        const child = spawn(this.state.downloadedFilePath, ['/S'], {
          detached: true,
          stdio: 'ignore',
          windowsHide: false
        });
        child.unref();
      }

      return {
        success: true,
        message: 'Instalador disparado com sucesso. O aplicativo pode ser encerrado com segurança.',
        filePath: this.state.downloadedFilePath
      };
    } catch (err: any) {
      this.state.status = 'ERROR';
      this.state.error = err.message;
      ObservabilityService.emit({
        level: 'ERROR',
        event: 'update.apply_failed',
        message: `Falha ao disparar instalador: ${err.message}`,
        service: 'updater',
        metadata: { error: err.message }
      });
      return {
        success: false,
        reason: 'SPAWN_FAILED',
        message: `Falha ao iniciar processo do instalador: ${err.message}`
      };
    }
  }

  static resetTimer() {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }

    if (this.state.autoCheck && this.state.checkIntervalMinutes > 0) {
      const ms = this.state.checkIntervalMinutes * 60 * 1000;
      this.checkTimer = setInterval(() => {
        this.checkForUpdates().catch((err) => {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "updateService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:updateService]", err);
      }
    });
      }, ms);
      if (this.checkTimer && typeof this.checkTimer.unref === 'function') {
        this.checkTimer.unref();
      }
    }
  }

  static stop() {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
  }

  static init() {
    this.resetTimer();
    if (this.state.autoCheck && this.state.feedUrl) {
      const initTimer = setTimeout(() => {
        this.checkForUpdates().catch((err) => {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "updateService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:updateService]", err);
      }
    });
      }, 5000);
      if (initTimer && typeof initTimer.unref === 'function') {
        initTimer.unref();
      }
    }
  }
}
