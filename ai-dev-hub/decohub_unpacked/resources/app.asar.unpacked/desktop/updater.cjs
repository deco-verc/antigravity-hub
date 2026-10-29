// desktop/updater.cjs
// Desktop Auto-Updater Integration with Electron IPC and Safe Application Lifecycle

const { ipcMain, dialog, app } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const logger = require('./logger.cjs');

class DesktopUpdater {
  static init(serviceManager, getBackendPort, getMainWindow) {
    logger.info('[DesktopUpdater] Inicializando subsistema de atualização automática do Desktop...');

    ipcMain.handle('desktop:get-update-status', async () => {
      try {
        const port = getBackendPort();
        const res = await fetch(`http://127.0.0.1:${port}/api/system/update/status`);
        if (res.ok) return await res.json();
      } catch (err) {
        logger.warn(`[DesktopUpdater] Falha ao consultar status de atualização: ${err.message}`);
      }
      return { status: 'IDLE', currentVersion: app.getVersion() || '1.0.8' };
    });

    ipcMain.handle('desktop:check-update', async (_, feedUrl) => {
      try {
        const port = getBackendPort();
        const res = await fetch(`http://127.0.0.1:${port}/api/system/update/check`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ feedUrl })
        });
        if (res.ok) return await res.json();
      } catch (err) {
        logger.error(`[DesktopUpdater] Erro ao verificar atualização: ${err.message}`);
        return { updateAvailable: false, error: err.message };
      }
      return { updateAvailable: false };
    });

    ipcMain.handle('desktop:download-update', async () => {
      try {
        const port = getBackendPort();
        const res = await fetch(`http://127.0.0.1:${port}/api/system/update/download`, {
          method: 'POST'
        });
        if (res.ok) return await res.json();
        const errJson = await res.json().catch(() => ({}));
        return { success: false, error: errJson.error || 'Falha no download' };
      } catch (err) {
        logger.error(`[DesktopUpdater] Erro no download: ${err.message}`);
        return { success: false, error: err.message };
      }
    });

    ipcMain.handle('desktop:apply-update', async (_, options = {}) => {
      try {
        const port = getBackendPort();
        // 1. Check with serviceManager if there is active work
        const activeWork = await serviceManager.queryActiveWork();
        if (activeWork.hasActiveWork && !options.force) {
          const win = getMainWindow();
          const choice = dialog.showMessageBoxSync(win, {
            type: 'warning',
            buttons: ['Aguardar conclusão do trabalho', 'Atualizar mesmo assim (Pausar trabalho)'],
            defaultId: 0,
            cancelId: 0,
            title: 'Trabalho em Andamento',
            message: 'Existe uma tarefa autônoma em execução ativa.',
            detail: 'Atualizar agora pausará o ciclo atual para evitar corrupção de estado.'
          });

          if (choice === 0) {
            return { success: false, reason: 'CANCELLED_BY_USER', message: 'Atualização cancelada pelo usuário para preservar o trabalho ativo.' };
          }
        }

        // 2. Fetch the downloaded file path from update status
        const statusRes = await fetch(`http://127.0.0.1:${port}/api/system/update/status`);
        const status = await statusRes.json();
        const filePath = status.downloadedFilePath;

        if (!filePath || !fs.existsSync(filePath)) {
          return { success: false, reason: 'FILE_NOT_FOUND', message: 'Arquivo do instalador não encontrado.' };
        }

        logger.info(`[DesktopUpdater] Aplicando atualização com instalador: ${filePath}`);

        // 3. Gracefully stop backend child process to release all Windows file locks
        await serviceManager.stop();

        // 4. Spawn NSIS silent installer with /S flag
        if (process.platform === 'win32') {
          const installer = spawn(filePath, ['/S'], {
            detached: true,
            stdio: 'ignore',
            windowsHide: false
          });
          installer.unref();
        }

        // 5. Quit current Electron app
        setTimeout(() => {
          app.quit();
        }, 800);

        return { success: true, message: 'Instalador iniciado. Reiniciando o aplicativo...' };
      } catch (err) {
        logger.error(`[DesktopUpdater] Falha ao aplicar atualização: ${err.message}`);
        return { success: false, error: err.message };
      }
    });
  }
}

module.exports = { DesktopUpdater };
