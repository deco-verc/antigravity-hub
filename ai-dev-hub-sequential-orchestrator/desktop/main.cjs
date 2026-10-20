// desktop/main.cjs
// AI DEV Desktop Application - Electron Main Process

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const os = require('os');
const { ServiceManager } = require('./serviceManager.cjs');
const { runCheck } = require('./healthCheck.cjs');
const { createTray } = require('./tray.cjs');
const logger = require('./logger.cjs');
const config = require('./config.cjs');
const { AntigravityDiscovery } = require('./antigravityDiscovery.cjs');
const { AppDataPaths } = require('./appDataPaths.cjs');

// ----------------------------------------------------
// 1. SINGLE INSTANCE ENFORCEMENT (Requisito 8)
// ----------------------------------------------------
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
    }
  };

  if (savedBounds.x !== undefined && savedBounds.y !== undefined) {
    winOpts.x = savedBounds.x;
    winOpts.y = savedBounds.y;
  }

  mainWindow = new BrowserWindow(winOpts);

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
    desktopVersion: '1.0.0',
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

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    safeShutdown();
  }
});
