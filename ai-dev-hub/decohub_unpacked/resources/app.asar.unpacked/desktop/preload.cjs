const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopAPI', {
  isDesktop: true,
  platform: process.platform,
  version: '1.0.0',
  getHealth: () => ipcRenderer.invoke('desktop:get-health'),
  getServices: () => ipcRenderer.invoke('desktop:get-services'),
  restartBackend: () => ipcRenderer.invoke('desktop:restart-backend'),
  restartApp: () => ipcRenderer.invoke('desktop:restart-app'),
  getDiagnostics: () => ipcRenderer.invoke('desktop:get-diagnostics'),
  getConfig: () => ipcRenderer.invoke('desktop:get-config'),
  updateConfig: (cfg) => ipcRenderer.invoke('desktop:update-config', cfg),
  selectDirectory: (options) => ipcRenderer.invoke('desktop:select-directory', options),
  createProjectDirect: (data) => ipcRenderer.invoke('desktop:create-project-direct', data),
  minimize: () => ipcRenderer.send('desktop:minimize'),
  maximize: () => ipcRenderer.send('desktop:maximize'),
  close: () => ipcRenderer.send('desktop:close'),
  onStatusChange: (callback) => {
    ipcRenderer.on('desktop:status-change', (_, data) => callback(data));
  }
});
