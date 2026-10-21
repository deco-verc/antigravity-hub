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

    if (process.resourcesPath) {
      const unpackedServer = path.join(process.resourcesPath, 'app.asar.unpacked', 'server');
      if (fs.existsSync(unpackedServer)) serverDir = unpackedServer;

      const unpackedClient = path.join(process.resourcesPath, 'app.asar.unpacked', 'client', 'dist');
      if (fs.existsSync(unpackedClient)) clientDir = unpackedClient;
    }

    if (!serverDir) {
      serverDir = path.resolve(__dirname, '..', 'server');
    }
    if (!clientDir) {
      clientDir = path.resolve(__dirname, '..', 'client', 'dist');
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
    this.maxRestarts = 3;
    this.isAttachedExisting = false;

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
          tester.once('close', () => resolve(false)).close();
        })
        .listen(port, '127.0.0.1');
    });
  }

  killProcessOnPort(port) {
    try {
      if (process.platform === 'win32') {
        const { execSync, execFileSync } = require('child_process');
        const out = execSync(`netstat -ano -p tcp | findstr :${port}`, { encoding: 'utf8', windowsHide: true });
        const lines = out.split('\n');
        for (const line of lines) {
          if (line.includes('LISTENING')) {
            const parts = line.trim().split(/\s+/);
            const pid = parseInt(parts[parts.length - 1], 10);
            if (pid && pid > 0 && pid !== process.pid) {
              logger.info(`[ServiceManager] Limpando processo preso na porta ${port} (PID: ${pid})...`);
              try {
                execFileSync('taskkill', ['/pid', String(pid), '/f', '/t'], { stdio: 'ignore' });
              } catch {}
            }
          }
        }
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
    this.services.BACKEND.status = 'STARTING';

    // 1. Antigravity Discovery Check
    const agDiscovery = AntigravityDiscovery.discover();
    this.services.ANTIGRAVITY.status = agDiscovery.available ? 'READY' : 'NOT_FOUND';
    this.services.ANTIGRAVITY.path = agDiscovery.languageServerExe;
    logger.info(`[ServiceManager] Antigravity Status: ${this.services.ANTIGRAVITY.status} (${agDiscovery.languageServerExe || 'Nenhum'})`);

    // 2. Limpar qualquer processo órfão na porta 3001 para que o server/dist/index.js recém-compilado seja carregado do zero
    const portTakenBefore = await this.isPortTaken(this.backendPort);
    if (portTakenBefore) {
      logger.info(`[ServiceManager] Porta ${this.backendPort} em uso por processo anterior. Limpando processo órfão para carregar build atualizado...`);
      this.killProcessOnPort(this.backendPort);
      for (let i = 0; i < 20; i++) {
        const stillBusy = await this.isPortTaken(this.backendPort);
        if (!stillBusy) break;
        await new Promise(r => setTimeout(r, 100));
      }
    }

    // 3. Dynamic Port Allocation se a porta ainda estiver ocupada por serviço externo
    const taken = await this.isPortTaken(this.backendPort);
    if (taken) {
      this.backendPort = await this.findAvailablePort(this.backendPort + 1);
      logger.info(`Porta padrão ocupada. Alocada nova porta dinâmica: ${this.backendPort}`);
    }

    // 4. Spawn Node backend child process
    logger.info(`Iniciando backend Node.js como child process isolado (porta ${this.backendPort})...`);
    this.serverProcess = spawn(
      process.execPath,
      [this.distIndex],
      {
        cwd: this.serverDir,
        env: {
          ...process.env,
          PORT: String(this.backendPort),
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
    this.services.BACKEND.port = this.backendPort;
    try {
      fs.writeFileSync(path.join(this.appData.dataDir, 'backend.pid'), String(this.backendPid));
    } catch {}

    this.serverProcess.stdout.on('data', data => {
      const str = data.toString();
      logger.logBackend(`[STDOUT] ${str.trim()}`);
    });

    this.serverProcess.stderr.on('data', data => {
      const str = data.toString();
      logger.logBackend(`[STDERR] ${str.trim()}`);
    });

    this.serverProcess.on('exit', (code, signal) => {
      logger.warn(`Processo do backend encerrou (PID: ${this.backendPid}, code: ${code}, signal: ${signal})`);
      this.serverProcess = null;
      this.backendPid = null;

      if (!this.isShuttingDown) {
        this.services.BACKEND.status = 'RESTARTING';
        this.emit('crashed', { code, signal, errorType: 'INFRASTRUCTURE_FAILURE' });
        this.handleAutoRestart();
      } else {
        this.services.BACKEND.status = 'STOPPED';
      }
    });

    // 5. Wait for readiness
    const ready = await this.waitForReady(this.backendPort, 15000);
    if (!ready) {
      this.services.BACKEND.status = 'FAILED';
      throw new Error(`Timeout ao inicializar backend na porta ${this.backendPort}`);
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
          execFileSync('taskkill', ['/pid', String(this.backendPid), '/f', '/t'], { stdio: 'ignore' });
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
