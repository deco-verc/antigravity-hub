// desktop/appDataPaths.cjs
// AppData Directory Organization, Isolation and Preservation

const path = require('path');
const os = require('os');
const fs = require('fs');
const logger = require('./logger.cjs');

class AppDataPaths {
  static getRoot() {
    if (process.env.AI_DEV_HUB_DATA_DIR) return path.resolve(process.env.AI_DEV_HUB_DATA_DIR);
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const root = path.join(localAppData, 'AI DEV');
    return root;
  }

  static getLegacyHubDir() {
    const home = os.homedir();
    return path.join(home, '.ai-dev-hub');
  }

  static getPaths() {
    const root = this.getRoot();
    const legacy = this.getLegacyHubDir();

    // Use legacy hub dir for database if it exists, or local app data
    const dataDir = process.env.AI_DEV_HUB_DATA_DIR ? path.resolve(process.env.AI_DEV_HUB_DATA_DIR) : (fs.existsSync(legacy) ? legacy : path.join(root, 'data'));

    return {
      root,
      baseDir: root,
      dataDir,
      dbPath: path.join(dataDir, 'hub.db'),
      logsDir: path.join(root, 'logs'),
      profilesDir: path.join(dataDir, 'profiles'),
      cacheDir: path.join(root, 'cache'),
      recoveryDir: path.join(root, 'recovery'),
      crashReportsDir: path.join(root, 'crash-reports'),
      configPath: path.join(dataDir, 'config.json')
    };
  }

  static ensureDirectories() {
    const paths = this.getPaths();
    const dirs = [
      paths.root,
      paths.dataDir,
      paths.logsDir,
      paths.profilesDir,
      paths.cacheDir,
      paths.recoveryDir,
      paths.crashReportsDir
    ];

    for (const d of dirs) {
      try {
        if (!fs.existsSync(d)) {
          fs.mkdirSync(d, { recursive: true });
        }
      } catch (err) {
        logger.error(`Falha ao criar diretório ${d}: ${err.message}`);
      }
    }

    return paths;
  }
}

module.exports = { AppDataPaths };
