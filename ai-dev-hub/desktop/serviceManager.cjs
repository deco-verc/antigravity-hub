// desktop/serviceManager.cjs
// Central Service Supervision, Port Allocation, Crash Recovery and Health Management

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');
const EventEmitter = require('events');
const logger = require('./logger.cjs');
const { AntigravityDiscovery } = require('./antigravityDiscovery.cjs');
const { AppDataPaths } = require('./appDataPaths.cjs');

class ServiceManager extends EventEmitter {
  constructor(options = {}) {
    super();

    // App data paths
    this.appData = AppDataPaths.ensureDirectories();

    let serverDir = options.serverDir;
    let clientDir = null;

    // Prioridade 1 (Workspace Local Relativo): Sempre verificar primeiro path.resolve(__dirname, '..', 'server') e client/dist
    const localWorkspaceServer = path.resolve(__dirname, '..', 'server');
    const localWorkspaceClient = path.resolve(__dirname, '..', 'client', 'dist');
    const localServerDist = path.join(localWorkspaceServer, 'dist', 'index.js');
    const localClientHtml = path.join(localWorkspaceClient, 'index.html');

    if (fs.existsSync(localServerDist) && fs.existsSync(localClientHtml)) {
      serverDir = localWorkspaceServer;
      clientDir = localWorkspaceClient;
      logger.info(`[ServiceManager] Prioridade 1: Runtime do workspace local detectado: ${serverDir}`);
    } else if (process.resourcesPath) {
      // Prioridade 2 (Pacote ASAR descompactado): Se estiver sob process.resourcesPath, carregar de app.asar.unpacked
      const unpackedServer = path.join(process.resourcesPath, 'app.asar.unpacked', 'server');
      const unpackedClient = path.join(process.resourcesPath, 'app.asar.unpacked', 'client', 'dist');
      if (fs.existsSync(unpackedServer)) serverDir = unpackedServer;
      if (fs.existsSync(unpackedClient)) clientDir = unpackedClient;
      if (serverDir && clientDir) {
        logger.info(`[ServiceManager] Prioridade 2: Runtime app.asar.unpacked detectado: ${serverDir}`);
      }
    }

    if (!serverDir) {
      serverDir = localWorkspaceServer;
    }
    if (!clientDir) {
      clientDir = localWorkspaceClient;
    }

    let nodePath = null;
    if (process.resourcesPath) {
      const asarModules = path.join(process.resourcesPath, 'app.asar', 'node_modules');
      if (fs.existsSync(asarModules)) {
        nodePath = asarModules;
      }
    }
    if (!nodePath) {
      nodePath = path.resolve(__dirname, '..', 'node_modules');
    }

    this.serverDir = serverDir;
    this.clientDir = clientDir;
    this.nodePath = nodePath;
    this.distIndex = path.join(this.serverDir, 'dist', 'index.js');
    this.backendPort = options.backendPort || 3001;
    this.serverProcess = null;
    this.backendPid = null;
    this.startTime = null;
    this.isShuttingDown = false;
    this.restartCount = 0;
    this.maxRestarts = 50;
    this.isAttachedExisting = false;
    this.isStarting = false;
    this.lastStderr = '';

    // Conceptual Services State
    this.services = {
      BACKEND: { status: 'STOPPED', port: this.backendPort, pid: null, restarts: 0 },
      MCP: { status: 'STOPPED', info: 'ai-dev-hub MCP Server' },
      ANTIGRAVITY: { status: 'STOPPED', path: null },
      WORKERS: { status: 'STOPPED', count: 0 },
      AUTONOMOUS_ENGINE: { status: 'STOPPED', activeRun: null }
    };
  }

  getServiceStatus() {
    return {
      ...this.services,
      backendDetails: {
        port: this.backendPort,
        pid: this.backendPid,
        startTime: this.startTime,
        restarts: this.restartCount,
        maxRestarts: this.maxRestarts
      }
    };
  }

  isPortTaken(port) {
    return new Promise(resolve => {
      const tester = net.createServer()
        .once('error', err => {
          if (err.code === 'EADDRINUSE') resolve(true);
          else resolve(false);
        })
        .once('listening', () => {
          tester.once('close', () => {
            // Verifica também se 0.0.0.0 está em uso
            const tester2 = net.createServer()
              .once('error', err2 => {
                if (err2.code === 'EADDRINUSE') resolve(true);
                else resolve(false);
              })
              .once('listening', () => {
                tester2.once('close', () => resolve(false)).close();
              })
              .listen(port, '0.0.0.0');
          }).close();
        })
        .listen(port, '127.0.0.1');
    });
  }

  killProcessOnPort(port) {
    try {
      if (process.platform === 'win32') {
        const { execSync, execFileSync } = require('child_process');
        try {
          const out = execSync('netstat -ano -p tcp', { encoding: 'utf8', windowsHide: true });
          const lines = out.split(/\r?\n/);
          const pidsToKill = new Set();
          for (const line of lines) {
            if (!line.includes('LISTENING')) continue;
            const parts = line.trim().split(/\s+/);
            if (parts.length < 5) continue;
            // Exemplo de linha do netstat: TCP  0.0.0.0:3001  0.0.0.0:0  LISTENING  1234
            const localAddress = parts[1] || '';
            const isTargetPort =
              localAddress.endsWith(`:${port}`) ||
              localAddress === `0.0.0.0:${port}` ||
              localAddress === `127.0.0.1:${port}` ||
              localAddress === `[::]:${port}` ||
              line.includes(`:${port} `) ||
              line.includes(`:${port}\t`);

            if (isTargetPort) {
              const pidStr = parts[parts.length - 1];
              const pid = parseInt(pidStr, 10);
              if (pid && pid > 0 && pid !== process.pid) {
                pidsToKill.add(pid);
              }
            }
          }

          for (const pid of pidsToKill) {
            logger.info(`[ServiceManager] Limpando processo preso na porta ${port} (PID: ${pid})...`);
            try {
              execFileSync('taskkill', ['/F', '/PID', String(pid), '/T'], { stdio: 'ignore', timeout: 3000, windowsHide: true });
            } catch {}
          }
        } catch (netErr) {
          logger.warn(`[ServiceManager] Falha ao verificar netstat para porta ${port}: ${netErr.message}`);
        }
      } else {
        const { execSync } = require('child_process');
        try {
          const out = execSync(`lsof -t -i:${port}`, { encoding: 'utf8' });
          const pids = out.trim().split(/\s+/);
          for (const p of pids) {
            const pid = parseInt(p, 10);
            if (pid && pid > 0 && pid !== process.pid) {
              try { process.kill(pid, 'SIGKILL'); } catch {}
            }
          }
        } catch {}
      }
    } catch {}
  }

  async findAvailablePort(startPort) {
    let port = startPort;
    while (port < startPort + 40) {
      const taken = await this.isPortTaken(port);
      if (!taken) return port;
      port++;
    }
    return startPort;
  }

  checkHealth(port) {
    return new Promise(resolve => {
      const req = http.get(`http://127.0.0.1:${port}/api/health`, { timeout: 1500 }, res => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            const sameData = parsed.dataPath && path.resolve(parsed.dataPath).toLowerCase() === path.resolve(this.appData.dbPath).toLowerCase();
            const sameMode = parsed.offline === (process.env.DECOHUB_OFFLINE_MODE === 'true');
            resolve(parsed.status === 'ok' && sameData && sameMode);
          } catch {
            resolve(false);
          }
        });
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    });
  }

  async queryActiveWork() {
    if (!this.backendPort) return { hasActiveWork: false, runsCount: 0 };
    const getJson = endpoint => new Promise(resolve => {
      const req = http.get(`http://127.0.0.1:${this.backendPort}${endpoint}`, { timeout: 1500 }, res => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch { resolve(null); }
        });
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
    });
    const [selfImprovement, autonomous, workers] = await Promise.all([
      getJson('/api/self-improvement/runs/active'),
      getJson('/api/autonomous/runs/active'),
      getJson('/api/workers')
    ]);
    const selfActive = selfImprovement && selfImprovement.id &&
      !['COMPLETED', 'CANCELLED', 'STOPPED', 'FAILED'].includes(selfImprovement.status);
    const autonomousRuns = Array.isArray(autonomous) ? autonomous : [];
    const workersList = Array.isArray(workers) ? workers : [];
    const workingWorkers = workersList.filter(w => w.status === 'WORKING' || w.activeLease);
    const hasActive = Boolean(selfActive || autonomousRuns.length || workingWorkers.length);
    return {
      hasActiveWork: hasActive,
      runsCount: autonomousRuns.length + Number(Boolean(selfActive)) + workingWorkers.length,
      activeRun: autonomousRuns[0] || selfImprovement || (workingWorkers[0] ? { name: `Worker ${workingWorkers[0].name} em execução` } : null)
    };
  }

  async start() {
    this.isShuttingDown = false;
    this.isStarting = true;
    this.services.BACKEND.status = 'STARTING';

    // 1. Antigravity Discovery Check
    const agDiscovery = AntigravityDiscovery.discover();
    this.services.ANTIGRAVITY.status = agDiscovery.available ? 'READY' : 'NOT_FOUND';
    this.services.ANTIGRAVITY.path = agDiscovery.languageServerExe;
    logger.info(`[ServiceManager] Antigravity Status: ${this.services.ANTIGRAVITY.status} (${agDiscovery.languageServerExe || 'Nenhum'})`);

    // 2. Limpar qualquer processo zumbi anterior escutando em 0.0.0.0:3001 ou 127.0.0.1:3001 antes do spawn
    logger.info(`[ServiceManager] Verificando e liberando porta ${this.backendPort}...`);
    this.killProcessOnPort(this.backendPort);

    // Aguarda liberação da porta se estava presa
    let taken = false;
    for (let i = 0; i < 15; i++) {
      taken = await this.isPortTaken(this.backendPort);
      if (!taken) break;
      await new Promise(r => setTimeout(r, 100));
    }

    if (taken) {
      logger.warn(`[ServiceManager] Porta ${this.backendPort} ainda ocupada após limpeza inicial. Tentando segunda rodada forçada...`);
      this.killProcessOnPort(this.backendPort);
      for (let i = 0; i < 10; i++) {
        taken = await this.isPortTaken(this.backendPort);
        if (!taken) break;
        await new Promise(r => setTimeout(r, 100));
      }
    }

    // 3. Fallback Automático de Porta: Se a porta 3001 continuar presa por algum serviço do Windows,
    // aloque a porta 3002 ou 3003 e repasse a variável PORT para o processo filho e para a janela do Electron
    if (taken) {
      const fallbackPort = await this.findAvailablePort(this.backendPort + 1);
      logger.warn(`[ServiceManager] Porta ${this.backendPort} inamovível (ocupada por serviço do sistema). Aplicando fallback automático para porta ${fallbackPort}.`);
      this.backendPort = fallbackPort;
      this.killProcessOnPort(this.backendPort);
    }

    // 4. Garantir presença do server/dist/index.js antes do spawn
    if (!fs.existsSync(this.distIndex)) {
      logger.info(`[ServiceManager] server/dist/index.js não encontrado em ${this.distIndex}. Executando compilação rápida de emergência...`);
      try {
        const { execFileSync } = require('child_process');
        const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
        const targetServerDir = fs.existsSync(path.join(this.serverDir, 'package.json'))
          ? this.serverDir
          : path.resolve(__dirname, '..', 'server');

        execFileSync(npmCmd, ['--prefix', targetServerDir, 'run', 'build'], {
          stdio: 'inherit',
          timeout: 60000,
          windowsHide: true
        });

        if (!fs.existsSync(this.distIndex)) {
          const altDist = path.resolve(__dirname, '..', 'server', 'dist', 'index.js');
          if (fs.existsSync(altDist)) {
            this.distIndex = altDist;
            this.serverDir = path.dirname(path.dirname(altDist));
          }
        }
        logger.info(`[ServiceManager] Compilação de emergência concluída com sucesso.`);
      } catch (buildErr) {
        logger.error(`[ServiceManager] Falha na compilação de emergência: ${buildErr.message}`);
      }
    }

    // 5. Spawn Node backend child process
    const spawnProcess = (portToUse) => {
      logger.info(`Iniciando backend Node.js como child process isolado (porta ${portToUse})...`);
      this.serverProcess = spawn(
        process.execPath,
        [this.distIndex],
        {
          cwd: this.serverDir,
          env: {
            ...process.env,
            PORT: String(portToUse),
            CLIENT_DIST_PATH: this.clientDir,
            AI_DEV_HUB_DATA_DIR: this.appData.dataDir,
            NODE_PATH: this.nodePath,
            NODE_ENV: 'production',
            ELECTRON_RUN_AS_NODE: '1'
          },
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe']
        }
      );

      this.backendPid = this.serverProcess.pid;
      this.startTime = new Date().toISOString();
      this.services.BACKEND.pid = this.backendPid;
      this.services.BACKEND.port = portToUse;
      try {
        fs.writeFileSync(path.join(this.appData.dataDir, 'backend.pid'), String(this.backendPid));
      } catch {}

      this.serverProcess.stdout.on('data', data => {
        const str = data.toString();
        logger.logBackend(`[STDOUT] ${str.trim()}`);
      });

      this.serverProcess.stderr.on('data', data => {
        const str = data.toString();
        this.lastStderr = str.trim();
        logger.logBackend(`[STDERR] ${this.lastStderr}`);
      });

      this.serverProcess.on('exit', (code, signal) => {
        logger.warn(`Processo do backend encerrou (PID: ${this.backendPid}, code: ${code}, signal: ${signal})`);
        this.serverProcess = null;
        this.backendPid = null;

        if (!this.isShuttingDown && !this.isStarting) {
          this.services.BACKEND.status = 'RESTARTING';
          this.emit('crashed', { code, signal, errorType: 'INFRASTRUCTURE_FAILURE' });
          this.handleAutoRestart();
        } else {
          this.services.BACKEND.status = 'STOPPED';
        }
      });
    };

    this.lastStderr = '';
    spawnProcess(this.backendPort);

    // 6. Wait for readiness
    let ready = await this.waitForReady(this.backendPort, 15000);

    // Contingência: se falhou e a porta era 3001 ou 3002, tenta alocar imediatamente porta alternativa
    if (!ready && (this.backendPort === 3001 || this.backendPort === 3002)) {
      const nextPort = await this.findAvailablePort(this.backendPort + 1);
      logger.warn(`[ServiceManager] Falha ao inicializar na porta ${this.backendPort}. Tentando fallback secundário na porta ${nextPort}...`);
      if (this.serverProcess) {
        try { this.serverProcess.kill('SIGKILL'); } catch {}
        this.serverProcess = null;
      }
      this.killProcessOnPort(this.backendPort);
      this.backendPort = nextPort;
      this.killProcessOnPort(this.backendPort);

      spawnProcess(this.backendPort);
      ready = await this.waitForReady(this.backendPort, 15000);
    }

    this.isStarting = false;

    if (!ready) {
      this.services.BACKEND.status = 'FAILED';
      const detail = this.lastStderr ? ` (Stderr: ${this.lastStderr})` : '';
      throw new Error(`Timeout ao inicializar backend na porta ${this.backendPort}${detail}`);
    }

    this.services.BACKEND.status = 'READY';
    this.services.MCP.status = 'READY';
    logger.info(`✓ Backend online e saudável em http://127.0.0.1:${this.backendPort}`);
    this.emit('ready', { port: this.backendPort, attached: false });
    return { port: this.backendPort, attached: false };
  }

  async waitForReady(port, timeoutMs = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (!this.serverProcess || this.isShuttingDown) {
        logger.warn(`[ServiceManager] Processo do backend finalizou prematuramente durante waitForReady.`);
        return false;
      }
      const ok = await this.checkHealth(port);
      if (ok) return true;
      await new Promise(r => setTimeout(r, 400));
    }
    return false;
  }

  async handleAutoRestart() {
    if (this.restartCount < this.maxRestarts) {
      this.restartCount++;
      this.services.BACKEND.restarts = this.restartCount;
      const delay = this.restartCount * 1500;
      logger.warn(`[AutoRecovery] Tentativa ${this.restartCount}/${this.maxRestarts} de recuperação em ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));

      try {
        await this.start();
        this.emit('recovered', { port: this.backendPort });
        logger.info(`[AutoRecovery] Backend recuperado com sucesso na porta ${this.backendPort}`);
      } catch (err) {
        logger.error(`[AutoRecovery] Falha ao recuperar backend: ${err.message}`);
      }
    } else {
      this.services.BACKEND.status = 'DEGRADED';
      logger.error(`[AutoRecovery] Limite de tentativas de auto-restart atingido (${this.maxRestarts}). Estado: DEGRADED.`);
      this.emit('unrecoverable', { error: 'Backend falhou múltiplas vezes e está em estado DEGRADED.' });
    }
  }

  async stop() {
    this.isShuttingDown = true;
    try {
      const pidFile = path.join(this.appData.dataDir, 'backend.pid');
      if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile);
    } catch {}

    if (this.serverProcess && this.backendPid) {
      logger.info(`Encerrando processo do backend (PID: ${this.backendPid})...`);
      try {
        if (process.platform === 'win32') {
          const { execFileSync } = require('child_process');
          execFileSync('taskkill', ['/F', '/PID', String(this.backendPid), '/T'], { stdio: 'ignore', timeout: 3000, windowsHide: true });
        } else {
          this.serverProcess.kill('SIGTERM');
        }
      } catch (err) {
        try { this.serverProcess.kill('SIGKILL'); } catch {}
      }
      this.serverProcess = null;
      this.backendPid = null;
    }

    // Garante que o processo na porta do backend seja encerrado ao fechar o aplicativo
    if (this.backendPort) {
      this.killProcessOnPort(this.backendPort);
      // Gracefully wait up to 2 seconds for port release
      for (let i = 0; i < 20; i++) {
        const taken = await this.isPortTaken(this.backendPort);
        if (!taken) break;
        await new Promise(r => setTimeout(r, 100));
      }
    }

    this.services.BACKEND.status = 'STOPPED';
  }
}

module.exports = { ServiceManager };
