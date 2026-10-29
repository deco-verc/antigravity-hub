// desktop/antigravityDiscovery.cjs
// Dynamic Discovery and Validation of Antigravity Installation for Electron Desktop

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const logger = require('./logger.cjs');

class AntigravityDiscovery {
  static getBrainDir() {
    const home = os.homedir();
    return path.join(home, '.gemini', 'antigravity', 'brain');
  }

  static discover(customConfigPath) {
    const brainDir = this.getBrainDir();

    // 1. Env variable
    if (process.env.ANTIGRAVITY_LANGUAGE_SERVER_EXE && fs.existsSync(process.env.ANTIGRAVITY_LANGUAGE_SERVER_EXE)) {
      return this.validate(process.env.ANTIGRAVITY_LANGUAGE_SERVER_EXE, brainDir, 'ENV');
    }

    // 2. Custom config path
    if (customConfigPath && fs.existsSync(customConfigPath)) {
      return this.validate(customConfigPath, brainDir, 'CONFIG');
    }

    // 3. Known standard locations
    const candidatePaths = [];
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    candidatePaths.push({
      path: path.join(localAppData, 'Programs', 'antigravity', 'resources', 'bin', 'language_server.exe'),
      source: 'LOCALAPPDATA'
    });

    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    candidatePaths.push({
      path: path.join(programFiles, 'antigravity', 'resources', 'bin', 'language_server.exe'),
      source: 'PROGRAMFILES'
    });

    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    candidatePaths.push({
      path: path.join(programFilesX86, 'antigravity', 'resources', 'bin', 'language_server.exe'),
      source: 'PROGRAMFILES'
    });

    for (const cand of candidatePaths) {
      if (fs.existsSync(cand.path)) {
        return this.validate(cand.path, brainDir, cand.source);
      }
    }

    // 4. System PATH
    try {
      const whereCmd = process.platform === 'win32' ? 'where language_server.exe' : 'which language_server';
      const out = execSync(whereCmd, { encoding: 'utf-8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      const firstLine = out.split(/\r?\n/)[0];
      if (firstLine && fs.existsSync(firstLine)) {
        return this.validate(firstLine, brainDir, 'PATH');
      }
    } catch {}

    return {
      available: false,
      status: 'NOT_FOUND',
      languageServerExe: null,
      brainDir,
      source: 'NONE',
      errorMessage: 'Instalação do Antigravity (language_server.exe) não localizada nos caminhos conhecidos.'
    };
  }

  static validate(exePath, brainDir, source) {
    try {
      const testOut = execSync(`"${exePath}" --help`, {
        encoding: 'utf-8',
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'ignore']
      });

      return {
        available: true,
        status: 'READY',
        languageServerExe: exePath,
        brainDir,
        source,
        version: testOut.includes('agentapi') ? 'agentapi-ready' : 'standard'
      };
    } catch (err) {
      return {
        available: true,
        status: 'DEGRADED',
        languageServerExe: exePath,
        brainDir,
        source,
        errorMessage: `Executável encontrado com aviso na validação: ${err.message}`
      };
    }
  }
}

module.exports = { AntigravityDiscovery };
