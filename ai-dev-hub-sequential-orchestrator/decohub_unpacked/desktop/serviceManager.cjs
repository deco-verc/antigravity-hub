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
            resolve(parsed.status === 'ok');
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
    return new Promise(resolve => {
      const req = http.get(`http://127.0.0.1:${this.backendPort}/api/self-improvement/runs/active`, { timeout: 1500 }, res => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed && parsed.id && parsed.status && !['COMPLETED', 'CANCELLED', 'STOPPED', 'FAILED'].includes(parsed.status)) {
              resolve({ hasActiveWork: true, activeRun: parsed });
              return;
            }
          } catch {}
          resolve({ hasActiveWork: false });
        });
      });
      req.on('error', () => resolve({ hasActiveWork: false }));
      req.on('timeout', () => { req.destroy(); resolve({ hasActiveWork: false }); });
    });
  }

  async start() {
    this.isShuttingDown = false;
    this.services.BACKEND.status = 'STARTING';

    // 1. Antigravity Discovery Check
    const agDiscovery = AntigravityDiscovery.discover();
    this.services.ANTIGRAVITY.status = agDiscovery.available ? 'READY' : 'NOT_FOUND';
    this.services.ANTIGRAVITY.path = agDiscovery.languageServerExe;
    logger.info(`[ServiceManager] Antigravity Status: ${this.services.ANTIGRAVITY.status} (${agDiscovery.languageServerExe || 'Nenhum'})`);

    // 2. Check if configured port is already healthy
    const isAlreadyRunning = await this.checkHealth(this.backendPort);
    if (isAlreadyRunning) {
      logger.info(`Backend já ativo na porta ${this.backendPort}. Anexando ao serviço existente.`);
      this.isAttachedExisting = true;
      this.services.BACKEND.status = 'READY';
      this.services.MCP.status = 'READY';
      this.emit('ready', { port: this.backendPort, attached: true });
      return { port: this.backendPort, attached: true };
    }

    // 3. Dynamic Port Allocation
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
    if (this.isAttachedExisting) {
      logger.info('Serviço anexado mantido ativo ao fechar o Desktop.');
      return;
    }

    if (this.serverProcess) {
      logger.info(`Encerrando processo do backend (PID: ${this.backendPid})...`);
      try {
        if (process.platform === 'win32') {
          spawn('taskkill', ['/pid', String(this.backendPid), '/f', '/t']);
        } else {
          this.serverProcess.kill('SIGTERM');
        }
      } catch {}
      this.serverProcess = null;
      this.backendPid = null;
    }

    this.services.BACKEND.status = 'STOPPED';
  }
}

module.exports = { ServiceManager };
