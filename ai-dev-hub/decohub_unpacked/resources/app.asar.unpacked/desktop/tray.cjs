const { Tray, Menu, nativeImage, app } = require('electron');
const path = require('path');

let tray = null;

function createTray(mainWindow, onQuitCallback) {
  if (tray) return tray;

  // Use icon if available or generate simple 16x16 icon
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  let icon;
  try {
    icon = nativeImage.createFromPath(iconPath);
  } catch {
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon.isEmpty() ? nativeImage.createFromNamedImage('NSStatusAvailable') : icon);
  tray.setToolTip('DecoHUB - Central de Projetos');

  function updateContextMenu(statusText = '● IA pronta') {
    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Abrir DecoHUB',
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          }
        }
      },
      {
        label: `Status: ${statusText}`,
        enabled: false
      },
      { type: 'separator' },
      {
        label: 'Ocultar na Barra de Tarefas',
        click: () => {
          if (mainWindow) mainWindow.hide();
        }
      },
      { type: 'separator' },
      {
        label: 'Sair do DecoHUB',
        click: () => {
          if (onQuitCallback) onQuitCallback();
          else app.quit();
        }
      }
    ]);

    tray.setContextMenu(contextMenu);
  }

  updateContextMenu();

  tray.on('double-click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.focus();
      } else {
        mainWindow.show();
      }
    }
  });

  return {
    tray,
    updateStatus: updateContextMenu
  };
}

module.exports = {
  createTray
};
