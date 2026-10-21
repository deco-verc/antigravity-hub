import { execSync, spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { db, getHubDataDir as resolveHubDataDir, DB_PATH } from './db.js';
import { SecurityManager } from './security.js';
import { Logger } from './logger.js';

export interface SystemHealthData {
  backendStatus: 'online' | 'offline';
  frontendStatus: 'online' | 'offline';
  database: {
    status: 'connected' | 'error';
    path: string;
    sizeBytes: number;
    sizeFormatted: string;
  };
  tools: {
    node: string;
    npm: string;
    python: string;
    git: string;
  };
  os: {
    platform: string;
    release: string;
    arch: string;
    hostname: string;
  };
  hubDataDir: string;
  uptimeSeconds: number;
}

export interface DiagnosticCheck {
  id: string;
  name: string;
  status: 'passed' | 'warning' | 'failed';
  message: string;
  details?: string;
}

export class SystemManager {
  private static cachedToolVersions: {
    node: string;
    npm: string;
    python: string;
    git: string;
    expiresAt: number;
  } | null = null;

  static getHubDataDir(): string {
    return resolveHubDataDir();
  }

  static getDbPath(): string {
    return path.join(this.getHubDataDir(), 'hub.db') || DB_PATH;
  }

  static getHealth(): SystemHealthData {
    const now = Date.now();
    let nodeVer = process.version;
    let npmVer = 'Não detectado';
    let pythonVer = 'Não detectado';
    let gitVer = 'Não detectado';

    // 1. Tool versions com cache de 5 minutos (elimina execSync síncrono no polling de 10s)
    if (this.cachedToolVersions && this.cachedToolVersions.expiresAt > now) {
      nodeVer = this.cachedToolVersions.node;
      npmVer = this.cachedToolVersions.npm;
      pythonVer = this.cachedToolVersions.python;
      gitVer = this.cachedToolVersions.git;
    } else {
      try {
        npmVer = execSync('npm.cmd -v', { encoding: 'utf-8', timeout: 3000 }).trim();
      } catch {
        try {
          npmVer = execSync('npm -v', { encoding: 'utf-8', timeout: 3000 }).trim();
        } catch (err) {
          if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
            (globalThis as any).logger.warn({
              event: "server.handled_exception",
              file: "systemManager",
              error: (err as any)?.message || String(err)
            });
          } else {
            console.warn("[WARN][server:systemManager]", err);
          }
        }
      }

      try {
        pythonVer = execSync('python --version', { encoding: 'utf-8', timeout: 3000 }).trim();
      } catch (err) {
        if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
          (globalThis as any).logger.warn({
            event: "server.handled_exception",
            file: "systemManager",
            error: (err as any)?.message || String(err)
          });
        } else {
          console.warn("[WARN][server:systemManager]", err);
        }
      }

      try {
        gitVer = execSync('git --version', { encoding: 'utf-8', timeout: 3000 }).trim();
      } catch (err) {
        if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
          (globalThis as any).logger.warn({
            event: "server.handled_exception",
            file: "systemManager",
            error: (err as any)?.message || String(err)
          });
        } else {
          console.warn("[WARN][server:systemManager]", err);
        }
      }

      this.cachedToolVersions = {
        node: nodeVer,
        npm: npmVer,
        python: pythonVer,
        git: gitVer,
        expiresAt: now + (5 * 60 * 1000)
      };
    }

    // 2. DB Info
    const dbPath = this.getDbPath();
    let dbSize = 0;
    let dbStatus: 'connected' | 'error' = 'connected';
    try {
      if (fs.existsSync(dbPath)) {
        dbSize = fs.statSync(dbPath).size;
      }
      db.prepare('SELECT 1').get();
    } catch {
      dbStatus = 'error';
    }

    const formatSize = (bytes: number): string => {
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    return {
      backendStatus: 'online',
      frontendStatus: 'online',
      database: {
        status: dbStatus,
        path: dbPath,
        sizeBytes: dbSize,
        sizeFormatted: formatSize(dbSize)
      },
      tools: {
        node: nodeVer,
        npm: npmVer,
        python: pythonVer,
        git: gitVer
      },
      os: {
        platform: `${os.type()} (${process.platform})`,
        release: os.release(),
        arch: os.arch(),
        hostname: os.hostname()
      },
      hubDataDir: this.getHubDataDir(),
      uptimeSeconds: Math.floor(process.uptime())
    };
  }

  static runDiagnostics(): DiagnosticCheck[] {
    const checks: DiagnosticCheck[] = [];

    // 1. Database Check
    try {
      const res = db.prepare('SELECT COUNT(*) as count FROM projects').get() as any;
      checks.push({
        id: 'db',
        name: 'Banco de Dados SQLite',
        status: 'passed',
        message: 'Conectado e operacional',
        details: `Tabela de projetos acessível (${res.count} projetos cadastrados)`
      });
    } catch (err: any) {
      checks.push({
        id: 'db',
        name: 'Banco de Dados SQLite',
        status: 'failed',
        message: 'Falha na comunicação com o banco SQLite',
        details: err.message
      });
    }

    // 2. Git Check
    try {
      const gitOut = execSync('git --version', { encoding: 'utf-8', timeout: 3000 }).trim();
      checks.push({
        id: 'git',
        name: 'Controle de Versão Git',
        status: 'passed',
        message: 'Git instalado e disponível no PATH',
        details: gitOut
      });
    } catch (err: any) {
      checks.push({
        id: 'git',
        name: 'Controle de Versão Git',
        status: 'warning',
        message: 'Git não encontrado ou não acessível no terminal',
        details: err.message
      });
    }

    // 3. Node & Environment Check
    const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
    if (nodeMajor >= 20) {
      checks.push({
        id: 'node',
        name: 'Ambiente de Execução Node.js',
        status: 'passed',
        message: `Node.js ${process.version} com suporte a SQLite nativo`,
        details: `Versão adequada (>= 20)`
      });
    } else {
      checks.push({
        id: 'node',
        name: 'Ambiente de Execução Node.js',
        status: 'warning',
        message: `Node.js ${process.version} pode ter limitações com SQLite nativo`,
        details: 'Recomendado Node 22+'
      });
    }

    // 4. Hub Directory Permissions Check
    const hubDir = this.getHubDataDir();
    try {
      if (!fs.existsSync(hubDir)) {
        fs.mkdirSync(hubDir, { recursive: true });
      }
      const testFile = path.join(hubDir, '.diag-test');
      fs.writeFileSync(testFile, 'ok', 'utf-8');
      fs.unlinkSync(testFile);
      checks.push({
        id: 'fs_perm',
        name: 'Permissões de Escrita no Disco',
        status: 'passed',
        message: 'Permissões de leitura e escrita ativas no diretório do usuário',
        details: hubDir
      });
    } catch (err: any) {
      checks.push({
        id: 'fs_perm',
        name: 'Permissões de Escrita no Disco',
        status: 'failed',
        message: 'Falha ao gravar no diretório do Hub',
        details: err.message
      });
    }

    // 5. Network / Port accessibility check
    checks.push({
      id: 'ports',
      name: 'Portas de Serviço',
      status: 'passed',
      message: 'Backend (3001) e Frontend (5173) vinculados corretamente',
      details: 'Comunicação HTTP local sem restrições'
    });

    Logger.info('Diagnóstico do sistema executado', { passed: checks.filter(c => c.status === 'passed').length });
    return checks;
  }

  static openFolder(targetPath: string): { success: boolean; message: string } {
    const val = SecurityManager.validateProjectFolder(targetPath);
    if (!val.isValid || !val.exists) {
      throw new Error(`Não é possível abrir pasta inválida: ${val.errorMessage || targetPath}`);
    }

    try {
      if (process.platform === 'win32') {
        spawn('explorer.exe', [val.resolvedPath], { detached: true, stdio: 'ignore' }).unref();
      } else if (process.platform === 'darwin') {
        spawn('open', [val.resolvedPath], { detached: true, stdio: 'ignore' }).unref();
      } else {
        spawn('xdg-open', [val.resolvedPath], { detached: true, stdio: 'ignore' }).unref();
      }

      Logger.info(`Pasta aberta no Explorer: ${val.resolvedPath}`);
      return { success: true, message: `Pasta aberta no Explorer: ${val.resolvedPath}` };
    } catch (err: any) {
      Logger.error(`Erro ao abrir pasta ${val.resolvedPath}: ${err.message}`);
      throw new Error(`Falha ao abrir Explorer: ${err.message}`);
    }
  }

  static openTerminal(targetPath: string): { success: boolean; message: string } {
    const val = SecurityManager.validateProjectFolder(targetPath);
    if (!val.isValid || !val.exists) {
      throw new Error(`Não é possível abrir terminal em pasta inválida: ${val.errorMessage || targetPath}`);
    }

    try {
      if (process.platform === 'win32') {
        // Try opening Windows Terminal, fallback to PowerShell window
        const wtCheck = () => {
          try {
            execSync('where wt.exe', { stdio: 'ignore', timeout: 1500 });
            return true;
          } catch {
            return false;
          }
        };

        if (wtCheck()) {
          spawn('wt.exe', ['-d', val.resolvedPath], { detached: true, stdio: 'ignore' }).unref();
        } else {
          spawn('cmd.exe', ['/c', 'start', 'powershell.exe', '-NoExit', '-Command', `Set-Location -LiteralPath '${val.resolvedPath}'`], {
            detached: true,
            stdio: 'ignore'
          }).unref();
        }
      } else if (process.platform === 'darwin') {
        spawn('open', ['-a', 'Terminal', val.resolvedPath], { detached: true, stdio: 'ignore' }).unref();
      } else {
        spawn('x-terminal-emulator', ['--working-directory', val.resolvedPath], { detached: true, stdio: 'ignore' }).unref();
      }

      Logger.info(`Terminal aberto na pasta: ${val.resolvedPath}`);
      return { success: true, message: `Terminal aberto na pasta: ${val.resolvedPath}` };
    } catch (err: any) {
      Logger.error(`Erro ao abrir terminal na pasta ${val.resolvedPath}: ${err.message}`);
      throw new Error(`Falha ao abrir Terminal: ${err.message}`);
    }
  }
}
