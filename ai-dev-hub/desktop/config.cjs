const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_PATH = path.join(process.env.AI_DEV_HUB_DATA_DIR || path.join(os.homedir(), '.ai-dev-hub'), 'config.json');

const DEFAULT_CONFIG = {
  autoOpenLastProject: true,
  restoreLastAccount: true,
  confirmExitWhileWorking: true,
  minimizeToTray: false,
  gitAutoCheckpoint: true,
  backendPort: 3001,
  logLevel: 'info',
  lastProject: null,
  lastAccount: 'google-pro-1',
  antigravityCustomPath: null,
  windowBounds: {
    width: 1440,
    height: 900,
    isMaximized: false
  }
};

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      return { ...DEFAULT_CONFIG, ...data };
    }
  } catch (err) {
    console.error('Falha ao ler config.json:', err);
  }
  return { ...DEFAULT_CONFIG };
}

function saveConfig(cfg) {
  try {
    const dir = path.dirname(CONFIG_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf-8');
  } catch (err) {
    console.error('Falha ao salvar config.json:', err);
  }
}

let currentConfig = loadConfig();

module.exports = {
  CONFIG_PATH,
  get(key) {
    return currentConfig[key];
  },
  getAll() {
    return { ...currentConfig };
  },
  set(key, value) {
    currentConfig[key] = value;
    saveConfig(currentConfig);
  },
  update(partial) {
    currentConfig = { ...currentConfig, ...partial };
    saveConfig(currentConfig);
    return currentConfig;
  }
};
