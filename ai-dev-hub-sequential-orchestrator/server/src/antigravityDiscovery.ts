// server/src/antigravityDiscovery.ts
// Dynamic Discovery and Validation of Antigravity Installation and agentapi

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { Logger } from './logger.js';

export interface AntigravityDiscoveryResult {
  available: boolean;
  status: 'READY' | 'DEGRADED' | 'NOT_FOUND';
  languageServerExe: string | null;
  brainDir: string;
  version?: string;
  source: 'ENV' | 'CONFIG' | 'LOCALAPPDATA' | 'PROGRAMFILES' | 'PATH' | 'NONE';
  errorMessage?: string;
}

export class AntigravityDiscovery {
  /**
   * Resolves the user's brain directory dynamically without hardcoded usernames
   */
  static getBrainDir(): string {
    const home = os.homedir();
    return path.join(home, '.gemini', 'antigravity', 'brain');
  }

  /**
   * Discovers the language_server.exe binary across all known installation locations
   */
  static discover(customConfigPath?: string): AntigravityDiscoveryResult {
    const brainDir = this.getBrainDir();

    // 1. Check Environment Variable
    if (process.env.ANTIGRAVITY_LANGUAGE_SERVER_EXE && fs.existsSync(process.env.ANTIGRAVITY_LANGUAGE_SERVER_EXE)) {
      const exe = process.env.ANTIGRAVITY_LANGUAGE_SERVER_EXE;
      return this.validateBinary(exe, brainDir, 'ENV');
    }

    // 2. Check Custom Config Path
    if (customConfigPath && fs.existsSync(customConfigPath)) {
      return this.validateBinary(customConfigPath, brainDir, 'CONFIG');
    }

    // 3. Check known standard locations
    const candidatePaths: Array<{ path: string; source: 'LOCALAPPDATA' | 'PROGRAMFILES' }> = [];

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

    for (const candidate of candidatePaths) {
      if (fs.existsSync(candidate.path)) {
        return this.validateBinary(candidate.path, brainDir, candidate.source);
      }
    }

    // 4. Check system PATH
    try {
      const whereCmd = process.platform === 'win32' ? 'where language_server.exe' : 'which language_server';
      const out = execSync(whereCmd, { encoding: 'utf-8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      const firstLine = out.split(/\r?\n/)[0];
      if (firstLine && fs.existsSync(firstLine)) {
        return this.validateBinary(firstLine, brainDir, 'PATH');
      }
    } catch {}

    // Not found
    return {
      available: false,
      status: 'NOT_FOUND',
      languageServerExe: null,
      brainDir,
      source: 'NONE',
      errorMessage: 'Instalação do Antigravity (language_server.exe) não localizada nos caminhos conhecidos do sistema.'
    };
  }

  /**
   * Validates if the binary is executable and responsive
   */
  private static validateBinary(
    exePath: string,
    brainDir: string,
    source: 'ENV' | 'CONFIG' | 'LOCALAPPDATA' | 'PROGRAMFILES' | 'PATH'
  ): AntigravityDiscoveryResult {
    try {
      // Test basic responsiveness
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
    } catch (err: any) {
      // Binary exists but threw on --help, still present
      return {
        available: true,
        status: 'DEGRADED',
        languageServerExe: exePath,
        brainDir,
        source,
        errorMessage: `Executável encontrado, porém com aviso na validação: ${err.message}`
      };
    }
  }

  /**
   * Resolves the Antigravity GUI application binary (Antigravity.exe) dynamically
   */
  static getAntigravityAppExe(): string | null {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const candidates = [
      path.join(localAppData, 'Programs', 'antigravity', 'Antigravity.exe'),
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'antigravity', 'Antigravity.exe'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'antigravity', 'Antigravity.exe')
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    return null;
  }
}

