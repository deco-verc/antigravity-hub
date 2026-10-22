const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');
const EventEmitter = require('events');
const logger = require('./logger.cjs');

class ProcessManager extends EventEmitter {
  constructor(options = {}) {
    super();
    let serverDir = options.serverDir;
    let clientDir = null;

    // Prioridade 1: Sempre priorizar o código-fonte real compilado em C:\IA\Antigravity HUB\ai-dev-hub
    const canonicalServer = 'C:\\IA\\Antigravity HUB\\ai-dev-hub\\server';
    const canonicalClient = 'C:\\IA\\Antigravity HUB\\ai-dev-hub\\client\\dist';
    const canonicalServerDist = path.join(canonicalServer, 'dist', 'index.js');
    const canonicalClientHtml = path.join(canonicalClient, 'index.html');

    const localWorkspaceServer = path.resolve(__dirname, '..', 'server');
    const localWorkspaceClient = path.resolve(__dirname, '..', 'client', 'dist');
    const localServerDist = path.join(localWorkspaceServer, 'dist', 'index.js');
    const localClientHtml = path.join(localWorkspaceClient, 'index.html');

    if (fs.existsSync(canonicalServerDist) && fs.existsSync(canonicalClientHtml)) {
      serverDir = canonicalServer;
      clientDir = canonicalClient;
      logger.info(`[ProcessManager] Priorizando runtime do workspace canônico: ${serverDir}`);
    } else if (fs.existsSync(localServerDist) && fs.existsSync(localClientHtml)) {
      serverDir = localWorkspaceServer;
      clientDir = localWorkspaceClient;
      logger.info(`[ProcessManager] Priorizando runtime do workspace local: ${serverDir}`);
    } else if (process.resourcesPath) {
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
    this.isShuttingDown = false;
    this.restartCount = 0;
    this.maxRestarts = 50;
    this.isAttachedExisting = false;
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
    while (port < startPort + 30) {
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

  async start() {
    this.isShuttingDown = false;

    // 1. Limpar processo órfão na porta 3001 para que o build recém-compilado seja carregado limpo
    const portTakenBefore = await this.isPortTaken(this.backendPort);
    if (portTakenBefore) {
      logger.info(`[ProcessManager] Porta ${this.backendPort} em uso por processo anterior. Limpando processo órfão...`);
      this.killProcessOnPort(this.backendPort);
      for (let i = 0; i < 20; i++) {
        const stillBusy = await this.isPortTaken(this.backendPort);
        if (!stillBusy) break;
        await new Promise(r => setTimeout(r, 100));
      }
    }

    // 2. If port taken by another service, find free port
    const taken = await this.isPortTaken(this.backendPort);
    if (taken) {
      this.backendPort = await this.findAvailablePort(this.backendPort + 1);
      logger.info(`Porta padrão ocupada. Utilizando nova porta disponível: ${this.backendPort}`);
    }

    // 3. Spawn Node process silently
    logger.info(`Iniciando backend Node.js em background (porta ${this.backendPort})...`);
    this.serverProcess = spawn(
      process.execPath, // uses electron's node or system node
      [this.distIndex],
      {
        cwd: this.serverDir,
        env: {
          ...process.env,
          PORT: String(this.backendPort),
          CLIENT_DIST_PATH: this.clientDir,
          NODE_PATH: this.nodePath,
          NODE_ENV: 'production',
          ELECTRON_RUN_AS_NODE: '1'
        },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      }
    );

    this.serverProcess.stdout.on('data', data => {
      const str = data.toString();
      logger.logBackend(`[STDOUT] ${str.trim()}`);
    });

    this.serverProcess.stderr.on('data', data => {
      const str = data.toString();
      logger.logBackend(`[STDERR] ${str.trim()}`);
    });

    this.serverProcess.on('exit', (code, signal) => {
      logger.warn(`Processo do backend encerrou com código ${code}, sinal ${signal}`);
      this.serverProcess = null;

      if (!this.isShuttingDown) {
        this.emit('crashed', { code, signal });
        this.handleAutoRestart();
      }
    });

    // 4. Wait for backend to be ready
    const ready = await this.waitForReady(this.backendPort, 15000);
    if (!ready) {
      throw new Error(`Timeout ao iniciar backend na porta ${this.backendPort}`);
    }

    logger.info(`✓ Backend iniciado e respondendo em http://127.0.0.1:${this.backendPort}`);
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
      const delay = this.restartCount * 1500;
      logger.warn(`[AutoRecovery] Tentativa ${this.restartCount}/${this.maxRestarts} de recuperação do backend em ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
      try {
        await this.start();
        this.emit('recovered', { port: this.backendPort });
        logger.info(`[AutoRecovery] Backend recuperado com sucesso na porta ${this.backendPort}`);
      } catch (err) {
        logger.error(`[AutoRecovery] Falha ao recuperar backend: ${err.message}`);
      }
    } else {
      logger.error(`[AutoRecovery] Limite de tentativas excedido (${this.maxRestarts}).`);
      this.emit('unrecoverable', { error: 'Backend falhou múltiplas vezes' });
    }
  }

  async stop() {
    this.isShuttingDown = true;
    if (this.isAttachedExisting) {
      logger.info('Serviço anexado. Mantendo processo ativo.');
      return;
    }

    if (this.serverProcess) {
      logger.info('Encerrando processo do backend de forma segura...');
      return new Promise(resolve => {
        const timeout = setTimeout(() => {
          try {
            if (this.serverProcess) this.serverProcess.kill('SIGKILL');
          } catch {}
          resolve();
        }, 3000);

        this.serverProcess.once('exit', () => {
          clearTimeout(timeout);
          resolve();
        });

        try {
          this.serverProcess.kill('SIGTERM');
        } catch {
          clearTimeout(timeout);
          resolve();
        }
      });
    }
  }
}

module.exports = {
  ProcessManager
};
