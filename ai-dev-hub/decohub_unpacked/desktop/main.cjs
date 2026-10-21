// desktop/main.cjs
// AI DEV Desktop Application - Electron Main Process

const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const os = require('os');
const { ServiceManager } = require('./serviceManager.cjs');
const { runCheck } = require('./healthCheck.cjs');
const { createTray } = require('./tray.cjs');
const logger = require('./logger.cjs');
const config = require('./config.cjs');
const { AntigravityDiscovery } = require('./antigravityDiscovery.cjs');
const { AppDataPaths } = require('./appDataPaths.cjs');
const { DesktopUpdater } = require('./updater.cjs');

// Remove redundant default Electron application menu (File, Edit, View, Window, Help)
Menu.setApplicationMenu(null);

// ----------------------------------------------------
// 1. SINGLE INSTANCE ENFORCEMENT (Requisito 8)
// ----------------------------------------------------
if (process.env.AI_DEV_HUB_DATA_DIR) {
  app.setPath('userData', path.join(path.resolve(process.env.AI_DEV_HUB_DATA_DIR), 'electron-user-data'));
}
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  logger.warn('[SingleInstance] Segunda instância detectada. Focando na existente e saindo.');
  app.quit();
  process.exit(0);
}

let mainWindow = null;
let splashWindow = null;
let trayController = null;
let serviceManager = null;
let backendPort = 3001;
let isQuitting = false;

app.on('second-instance', () => {
  logger.info('[SingleInstance] Segunda instância tentou abrir. Focando janela existente.');
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  }
});

// ----------------------------------------------------
// 2. WINDOWS CREATION & LIFECYCLE (Requisitos 4 e 18)
// ----------------------------------------------------
function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 520,
    height: 380,
    frame: false,
    transparent: false,
    backgroundColor: '#080a10',
    alwaysOnTop: true,
    resizable: false,
    center: true,
    show: true,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  splashWindow.loadFile(path.join(__dirname, 'splash.html'));
  splashWindow.on('closed', () => {
    splashWindow = null;
  });
}

function saveWindowBounds() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const isMaximized = mainWindow.isMaximized();
  if (!isMaximized) {
    const bounds = mainWindow.getBounds();
    config.set('windowBounds', {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      isMaximized: false
    });
  } else {
    const current = config.get('windowBounds') || {};
    config.set('windowBounds', {
      ...current,
      isMaximized: true
    });
  }
}

function createMainWindow(port) {
  backendPort = port;
  const savedBounds = config.get('windowBounds') || { width: 1440, height: 900, isMaximized: false };

  const winOpts = {
    width: savedBounds.width || 1440,
    height: savedBounds.height || 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#07090e',
    show: false,
    title: 'DecoHUB',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true
    },
    autoHideMenuBar: true
  };

  if (savedBounds.x !== undefined && savedBounds.y !== undefined) {
    winOpts.x = savedBounds.x;
    winOpts.y = savedBounds.y;
  }

  mainWindow = new BrowserWindow(winOpts);
  mainWindow.removeMenu();
  mainWindow.setMenuBarVisibility(false);

  if (savedBounds.isMaximized) {
    mainWindow.maximize();
  }

  // Intercept external links (Requisito 32)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    logger.info(`[ExternalLink] Abrindo link externo no browser padrão: ${url}`);
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`http://127.0.0.1:${port}`) && !url.startsWith(`http://localhost:${port}`)) {
      event.preventDefault();
      logger.info(`[Navigation] Interceptada navegação externa para ${url}`);
      shell.openExternal(url);
    }
  });

  // Track window bounds
  mainWindow.on('resize', saveWindowBounds);
  mainWindow.on('move', saveWindowBounds);

  // Load the web app served directly by local backend
  const targetUrl = `http://127.0.0.1:${port}/`;
  logger.info(`Carregando Simple IDE a partir de ${targetUrl}`);
  mainWindow.loadURL(targetUrl);

  mainWindow.once('ready-to-show', () => {
    setTimeout(() => {
      if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.destroy();
      }
      mainWindow.show();
      mainWindow.focus();
      logger.info('Janela principal do AI DEV exibida.');
    }, 1200);
  });

  // Safe closing protection (Requisito 23)
  mainWindow.on('close', async (e) => {
    if (isQuitting) return;
    e.preventDefault();

    if (config.get('minimizeToTray')) {
      e.preventDefault();
      mainWindow.hide();
      return;
    }

    // Check if there is active work
    if (serviceManager) {
      const activeWork = await serviceManager.queryActiveWork();
      if (activeWork.hasActiveWork) {
        const choice = dialog.showMessageBoxSync(mainWindow, {
          type: 'warning',
          buttons: ['Minimizar para Tray e continuar', 'Parar com segurança e sair', 'Cancelar'],
          defaultId: 0,
          cancelId: 2,
          title: 'AI DEV ainda está trabalhando',
          message: 'Existe um ciclo autônomo ou tarefa em execução ativa.',
          detail: 'Você deseja manter o trabalho rodando em segundo plano no Tray ou encerrar com segurança?'
        });

        if (choice === 0) {
          mainWindow.hide();
          if (trayController) {
            trayController.displayBalloon?.({
              title: 'AI DEV em Execução',
              content: 'O sistema continua operando em segundo plano.'
            });
          }
          return;
        } else if (choice === 1) {
          saveWindowBounds();
          safeShutdown();
          return;
        } else {
          return; // Cancelled
        }
      }
    }

    saveWindowBounds();
    safeShutdown();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Setup System Tray (Requisito 24)
  trayController = createTray(mainWindow, () => safeShutdown());
}

// ----------------------------------------------------
// 3. SAFE SHUTDOWN (Requisito 22)
// ----------------------------------------------------
async function safeShutdown() {
  if (isQuitting) return;
  isQuitting = true;
  logger.info('[SafeShutdown] Iniciando encerramento seguro do AI DEV...');

  try {
    saveWindowBounds();
    if (serviceManager) {
      await serviceManager.stop();
    }
  } catch (err) {
    logger.error(`[SafeShutdown] Erro ao parar serviços: ${err.message}`);
  }

  logger.info('[SafeShutdown] Processos limpos. Encerrando aplicação Electron.');
  app.quit();
}

// ----------------------------------------------------
// 4. IPC HANDLERS (Requisitos 26 e 30)
// ----------------------------------------------------
ipcMain.handle('desktop:get-health', async () => {
  return runCheck();
});

ipcMain.handle('desktop:get-services', () => {
  return serviceManager ? serviceManager.getServiceStatus() : null;
});

ipcMain.handle('desktop:restart-backend', async () => {
  logger.info('Reiniciando backend via IPC...');
  if (serviceManager) {
    await serviceManager.stop();
    const res = await serviceManager.start();
    return res;
  }
  return { success: false };
});

ipcMain.handle('desktop:restart-app', () => {
  logger.info('Reiniciando aplicativo AI DEV...');
  saveWindowBounds();
  app.relaunch();
  app.exit(0);
});

ipcMain.handle('desktop:get-diagnostics', async () => {
  const health = runCheck();
  const services = serviceManager ? serviceManager.getServiceStatus() : {};
  const agDiscovery = AntigravityDiscovery.discover();
  const paths = AppDataPaths.getPaths();

  let backendDiag = null;
  try {
    const res = await fetch(`http://127.0.0.1:${backendPort}/api/desktop/diagnostics`);
    if (res.ok) {
      backendDiag = await res.json();
    }
  } catch (e) {
    // backend offline or restarting
  }

  return {
    desktopVersion: (app && typeof app.getVersion === 'function' ? app.getVersion() : null) || require('../package.json').version || '1.0.8',
    stableBaseline: backendDiag?.stableBaseline || { commit: 'DYNAMIC_RESOLVING', versionLabel: 'AI_DEV_STABLE', source: 'DESKTOP' },
    stableSha: backendDiag?.stableBaseline?.commit || 'DYNAMIC_RESOLVING',
    versionLabel: backendDiag?.stableBaseline?.versionLabel || 'AI_DEV_STABLE',
    timestamp: new Date().toISOString(),
    os: {
      platform: process.platform,
      release: os.release(),
      arch: process.arch,
      totalMemMB: Math.round(os.totalmem() / 1024 / 1024),
      freeMemMB: Math.round(os.freemem() / 1024 / 1024)
    },
    backend: backendDiag?.backend || services.backendDetails || { port: backendPort, pid: null },
    antigravity: {
      status: agDiscovery.status,
      exePath: agDiscovery.languageServerExe,
      source: agDiscovery.source
    },
    paths: {
      dataPath: paths.dataDir,
      dbPath: paths.dbPath,
      logsPath: paths.logsDir
    },
    healthSummary: health.checks
  };
});

ipcMain.handle('desktop:select-directory', async (_, options) => {
  if (!mainWindow) return { canceled: true, filePaths: [] };
  return await dialog.showOpenDialog(mainWindow, {
    title: options?.title || 'Selecionar Pasta do Projeto',
    defaultPath: options?.defaultPath || 'C:\\IA',
    properties: ['openDirectory', 'createDirectory']
  });
});

ipcMain.handle('desktop:create-project-direct', async (_, payload) => {
  logger.info(`[IPC] create-project-direct acionado para: ${payload?.name || 'sem nome'}`);
  // a) Tenta fazer POST http://127.0.0.1:${backendPort}/api/projects com timeout de 5s
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`http://127.0.0.1:${backendPort}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    if (res.ok) {
      const data = await res.json();
      logger.info(`[IPC] Projeto criado via HTTP backend com sucesso (${data.id})`);
      return { success: true, data };
    }
  } catch (httpErr) {
    logger.warn(`[IPC] Backend HTTP indisponível ou timeout (>5s) ao criar projeto: ${httpErr.message}. Acionando fallback nativo direto no SQLite...`);
  }

  // b) Fallback nativo direto no SQLite do Hub e arquivos .ai-dev-hub/
  try {
    const fs = require('fs');
    const path = require('path');
    const crypto = require('crypto');
    let DatabaseSync;
    try {
      DatabaseSync = require('node:sqlite').DatabaseSync;
    } catch {
      DatabaseSync = require('better-sqlite3');
    }

    const name = (payload?.name || 'Novo Projeto').trim();
    let folderPath = (payload?.folderPath || '').trim();
    if (!folderPath) {
      const slug = name.toLowerCase().replace(/[^a-z0-9-_]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'novo-projeto';
      folderPath = path.join('C:\\IA\\test-projects', slug);
    }
    const resolvedPath = path.resolve(folderPath);
    if (!fs.existsSync(resolvedPath)) {
      fs.mkdirSync(resolvedPath, { recursive: true });
    }

    // Criar arquivos de memória .ai-dev-hub/
    const memDir = path.join(resolvedPath, '.ai-dev-hub');
    if (!fs.existsSync(memDir)) {
      fs.mkdirSync(memDir, { recursive: true });
    }
    const files = {
      'project.md': `# Projeto: ${name}\n\n## Objetivo Principal\n${payload?.objective || 'Definir o objetivo principal do projeto.'}\n\n## Contexto do Produto\n${payload?.description || 'Contexto e propósito da aplicação para os usuários.'}\n`,
      'architecture.md': `# Arquitetura do Sistema\n\n## Stack Tecnológica\n- **Stack:** ${payload?.stack || 'Geral'}\n`,
      'decisions.md': `# Registro de Decisões Técnicas\n\n## Decisões Tomadas\n- **[${new Date().toLocaleDateString('pt-BR')}] Estrutura Inicial**\n  - **Decisão:** Uso de arquivos Markdown locais para memória permanente do projeto.\n`,
      'tasks.md': `# Gerenciamento de Tarefas\n\n## Pendente\n\n## Fazendo\n\n## Concluído\n- [x] Inicialização da memória .ai-dev-hub\n`,
      'changes.md': `# Histórico de Mudanças\n\n## Arquivos Alterados Recentemente\n- \`.ai-dev-hub/project.md\`\n`,
      'session-summary.md': `# Resumo da Sessão Atual\n\n## Estado Atual do Projeto\nProjeto inicializado com sucesso via Desktop Native IPC.\n`
    };
    for (const [filename, content] of Object.entries(files)) {
      const fp = path.join(memDir, filename);
      if (!fs.existsSync(fp)) {
        fs.writeFileSync(fp, content, 'utf-8');
      }
    }

    const gitignorePath = path.join(resolvedPath, '.gitignore');
    if (!fs.existsSync(gitignorePath)) {
      fs.writeFileSync(gitignorePath, 'node_modules/\n.env\n.env.local\ndist/\n', 'utf-8');
    }

    const dbPath = AppDataPaths.getPaths().dbPath;
    const db = new DatabaseSync(dbPath);

    try {
      const existing = db.prepare('SELECT * FROM projects WHERE path = ?').get(resolvedPath);
      const nowIso = new Date().toISOString();
      const normalizedModel = (payload?.selectedModel && typeof payload.selectedModel === 'string')
        ? (payload.selectedModel.includes('pro') ? 'pro' : payload.selectedModel.includes('lite') ? 'flash_lite' : 'flash')
        : 'flash';
      const normalizedReasoning = (['HIGH', 'MEDIUM', 'LOW'].includes(payload?.reasoningLevel) ? payload.reasoningLevel : 'HIGH');

      if (existing) {
        db.prepare(`
          UPDATE projects
          SET name = ?, selected_model = ?, reasoning_level = ?, updated_at = ?
          WHERE id = ?
        `).run(name, normalizedModel, normalizedReasoning, nowIso, existing.id);
        const updated = db.prepare('SELECT * FROM projects WHERE id = ?').get(existing.id);
        db.close();
        logger.info(`[IPC] Projeto recuperado/atualizado via fallback nativo SQLite: ${existing.id}`);
        return { success: true, data: updated };
      }

      let effectiveProfileId = null;
      if (payload?.initialProfileId && typeof payload.initialProfileId === 'string' && payload.initialProfileId.trim()) {
        const prof = db.prepare('SELECT id FROM account_profiles WHERE id = ?').get(payload.initialProfileId.trim());
        if (prof?.id) effectiveProfileId = prof.id;
      }
      if (!effectiveProfileId) {
        const setting = db.prepare("SELECT value FROM system_settings WHERE key = 'active_account_profile_id'").get();
        if (setting?.value) effectiveProfileId = setting.value;
      }
      if (!effectiveProfileId) {
        const firstActive = db.prepare("SELECT id FROM account_profiles WHERE auth_status IN ('READY', 'ACTIVE') ORDER BY created_at ASC LIMIT 1").get();
        if (firstActive?.id) effectiveProfileId = firstActive.id;
      }
      if (!effectiveProfileId) {
        const anyProf = db.prepare('SELECT id FROM account_profiles ORDER BY created_at ASC LIMIT 1').get();
        if (anyProf?.id) effectiveProfileId = anyProf.id;
      }

      const id = crypto.randomUUID();
      const isTrusted = payload?.isTrusted !== undefined ? (payload.isTrusted ? 1 : 0) : 1;
      const fullDevAutonomy = payload?.fullDevAutonomy !== undefined ? (payload.fullDevAutonomy ? 1 : 0) : 1;

      db.prepare(`
        INSERT INTO projects (id, name, path, objective, description, stack, status, is_trusted, full_dev_autonomy, active_account_profile_id, selected_model, reasoning_level, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        name,
        resolvedPath,
        payload?.objective || '',
        payload?.description || '',
        payload?.stack || 'Geral',
        isTrusted,
        fullDevAutonomy,
        effectiveProfileId,
        normalizedModel,
        normalizedReasoning,
        nowIso,
        nowIso
      );

      const created = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
      db.close();
      logger.info(`[IPC] Projeto inserido com sucesso via fallback nativo SQLite (${id})`);
      return { success: true, data: created };
    } catch (dbErr) {
      try { db.close(); } catch {}
      throw dbErr;
    }
  } catch (nativeErr) {
    logger.error(`[IPC] Falha no fallback nativo de criação de projeto: ${nativeErr.message}`);
    return { success: false, error: nativeErr.message };
  }
});

ipcMain.handle('desktop:get-config', () => {
  return config.getAll();
});

ipcMain.handle('desktop:update-config', (_, partial) => {
  return config.update(partial);
});

ipcMain.on('desktop:minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('desktop:maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  }
});

ipcMain.on('desktop:close', () => {
  if (mainWindow) mainWindow.close();
});

// ----------------------------------------------------
// 5. APP LIFECYCLE (Requisito 17)
// ----------------------------------------------------
app.whenReady().then(async () => {
  logger.info('====================================================');
  logger.info('INICIANDO AI DEV DESKTOP APPLICATION');
  logger.info('====================================================');

  // Ensure AppData directories
  AppDataPaths.ensureDirectories();

  createSplashWindow();

  // Run initial health check
  const initialHealth = runCheck();
  logger.info(`Status do sistema: ${initialHealth.allPassed ? 'OK' : 'AVISOS DETECTADOS'}`);

  // Initialize Service Manager
  serviceManager = new ServiceManager({ backendPort: config.get('backendPort') || 3001 });

  serviceManager.on('crashed', (data) => {
    logger.warn(`ServiceManager emitiu crash (Tipo: ${data.errorType || 'INFRASTRUCTURE_FAILURE'})`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('desktop:status-change', {
        type: 'backend_crashed',
        data
      });
    }
  });

  serviceManager.on('recovered', (data) => {
    logger.info(`ServiceManager recuperado na porta ${data.port}`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('desktop:status-change', {
        type: 'backend_recovered',
        data
      });
    }
  });

  try {
    const { port } = await serviceManager.start();
    createMainWindow(port);
    DesktopUpdater.init(serviceManager, () => backendPort, () => mainWindow);
  } catch (err) {
    logger.error(`Falha fatal ao iniciar serviços: ${err.message}`);
    if (splashWindow && !splashWindow.isDestroyed()) {
      dialog.showErrorBox(
        'Erro ao Iniciar AI DEV',
        `Não foi possível inicializar os serviços do sistema.\n\nDetalhes: ${err.message}`
      );
      splashWindow.destroy();
    }
    app.quit();
  }
});

app.on('before-quit', (e) => {
  if (!isQuitting) {
    e.preventDefault();
    safeShutdown();
  }
});

app.on('will-quit', () => {
  if (serviceManager && serviceManager.serverProcess) {
    try {
      if (process.platform === 'win32' && serviceManager.backendPid) {
        require('child_process').execFileSync('taskkill', ['/pid', String(serviceManager.backendPid), '/f', '/t'], { stdio: 'ignore' });
      } else if (serviceManager.serverProcess) {
        serviceManager.serverProcess.kill('SIGKILL');
      }
    } catch {}
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    safeShutdown();
  }
});

process.on('SIGINT', () => safeShutdown());
process.on('SIGTERM', () => safeShutdown());
