// server/src/antigravityDiscovery.ts
// Dynamic Discovery and Validation of Antigravity Installation, language_server, and agy CLI

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { Logger } from './logger.js';

export interface AntigravityDiscoveryResult {
  available: boolean;
  status: 'READY' | 'DEGRADED' | 'NOT_FOUND';
  languageServerExe: string | null;
  agyCliExe?: string | null;
  brainDir: string;
  version?: string;
  source: 'ENV' | 'CONFIG' | 'LOCALAPPDATA' | 'PROGRAMFILES' | 'PATH' | 'NONE';
  errorMessage?: string;
}

interface CachedBinaryValidation {
  exePath: string;
  mtimeMs: number;
  validatedAt: number;
  status: 'READY' | 'DEGRADED';
  version?: string;
  errorMessage?: string;
}

export class AntigravityDiscovery {
  private static validationCache = new Map<string, CachedBinaryValidation>();
  private static readonly CACHE_TTL_MS = 60_000;

  /**
   * Resolves the user's brain directory dynamically (supports isolated profile home directories)
   */
  static getBrainDir(customUserProfileDir?: string): string {
    const home = customUserProfileDir && customUserProfileDir.trim().length > 0
      ? customUserProfileDir.trim()
      : (process.env.USERPROFILE || os.homedir());
    return path.join(home, '.gemini', 'antigravity', 'brain');
  }

  /**
   * Discovers the Antigravity CLI binary (agy / agy.exe) installed per official Antigravity 2.0 docs
   */
  static getAgyCliExe(customUserProfileDir?: string): string | null {
    if (process.env.ANTIGRAVITY_CLI_EXE && fs.existsSync(process.env.ANTIGRAVITY_CLI_EXE)) {
      return process.env.ANTIGRAVITY_CLI_EXE;
    }

    const home = customUserProfileDir || process.env.USERPROFILE || os.homedir();
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';

    const candidates = process.platform === 'win32'
      ? [
          path.join(localAppData, 'agy', 'bin', 'agy.exe'),
          path.join(home, 'AppData', 'Local', 'agy', 'bin', 'agy.exe'),
          path.join(programFiles, 'Google', 'antigravity-cli', 'agy.exe'),
          path.join(localAppData, 'Programs', 'antigravity', 'resources', 'bin', 'agy.exe')
        ]
      : [
          path.join(home, '.local', 'bin', 'agy'),
          '/usr/local/bin/agy'
        ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  /**
   * Discovers the language_server.exe binary across all known installation locations
   */
  static discover(
    optionsOrConfigPath?: string | { forceRefresh?: boolean; configPath?: string; userProfileDir?: string }
  ): AntigravityDiscoveryResult {
    const customConfigPath = typeof optionsOrConfigPath === 'string'
      ? optionsOrConfigPath
      : optionsOrConfigPath?.configPath;
    const forceRefresh = typeof optionsOrConfigPath === 'object' && Boolean(optionsOrConfigPath?.forceRefresh);
    const userProfileDir = typeof optionsOrConfigPath === 'object' ? optionsOrConfigPath?.userProfileDir : undefined;

    const brainDir = this.getBrainDir(userProfileDir);
    const agyCliExe = this.getAgyCliExe(userProfileDir);

    // 1. Check Environment Variable
    if (process.env.ANTIGRAVITY_LANGUAGE_SERVER_EXE && fs.existsSync(process.env.ANTIGRAVITY_LANGUAGE_SERVER_EXE)) {
      const exe = process.env.ANTIGRAVITY_LANGUAGE_SERVER_EXE;
      return { ...this.validateBinary(exe, brainDir, 'ENV', forceRefresh), agyCliExe };
    }

    // 2. Check Custom Config Path
    if (customConfigPath && fs.existsSync(customConfigPath)) {
      return { ...this.validateBinary(customConfigPath, brainDir, 'CONFIG', forceRefresh), agyCliExe };
    }

    // 3. Check known standard locations
    const candidatePaths: Array<{ path: string; source: 'LOCALAPPDATA' | 'PROGRAMFILES' }> = [];

    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const binaryNames = ['language_server.exe', 'language_server_windows_x64.exe'];
    const appFolderNames = ['antigravity', 'Antigravity', 'Antigravity 2'];

    for (const folder of appFolderNames) {
      for (const bin of binaryNames) {
        candidatePaths.push({
          path: path.join(localAppData, 'Programs', folder, 'resources', 'bin', bin),
          source: 'LOCALAPPDATA'
        });
      }
    }

    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    for (const folder of appFolderNames) {
      for (const bin of binaryNames) {
        candidatePaths.push({
          path: path.join(programFiles, folder, 'resources', 'bin', bin),
          source: 'PROGRAMFILES'
        });
      }
    }

    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    for (const folder of appFolderNames) {
      for (const bin of binaryNames) {
        candidatePaths.push({
          path: path.join(programFilesX86, folder, 'resources', 'bin', bin),
          source: 'PROGRAMFILES'
        });
      }
    }

    for (const candidate of candidatePaths) {
      if (fs.existsSync(candidate.path)) {
        return { ...this.validateBinary(candidate.path, brainDir, candidate.source, forceRefresh), agyCliExe };
      }
    }

    // 4. Check system PATH
    try {
      const whereCmd = process.platform === 'win32' ? 'where language_server.exe' : 'which language_server';
      const out = execSync(whereCmd, { encoding: 'utf-8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      const firstLine = out.split(/\r?\n/)[0];
      if (firstLine && fs.existsSync(firstLine)) {
        return { ...this.validateBinary(firstLine, brainDir, 'PATH', forceRefresh), agyCliExe };
      }
    } catch {}

    // Not found
    return {
      available: false,
      status: 'NOT_FOUND',
      languageServerExe: null,
      agyCliExe,
      brainDir,
      source: 'NONE',
      errorMessage: 'Instalação do Antigravity (language_server.exe) não localizada nos caminhos conhecidos do sistema.'
    };
  }

  /**
   * Validates if the binary is executable and responsive (with fast mtime + TTL cache)
   */
  private static validateBinary(
    exePath: string,
    brainDir: string,
    source: 'ENV' | 'CONFIG' | 'LOCALAPPDATA' | 'PROGRAMFILES' | 'PATH',
    forceRefresh = false
  ): AntigravityDiscoveryResult {
    let mtimeMs = 0;
    try {
      mtimeMs = fs.statSync(exePath).mtimeMs;
    } catch {}

    const cached = this.validationCache.get(exePath);
    if (
      !forceRefresh &&
      cached &&
      cached.mtimeMs === mtimeMs &&
      Date.now() - cached.validatedAt < this.CACHE_TTL_MS
    ) {
      return {
        available: true,
        status: cached.status,
        languageServerExe: exePath,
        brainDir,
        source,
        version: cached.version,
        errorMessage: cached.errorMessage
      };
    }

    try {
      const testOut = execSync(`"${exePath}" -stamp`, {
        encoding: 'utf-8',
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'ignore']
      });
      const version = testOut.includes('Built at CL') ? testOut.trim().split('\n')[0] : 'standard';

      this.validationCache.set(exePath, {
        exePath,
        mtimeMs,
        validatedAt: Date.now(),
        status: 'READY',
        version
      });

      return {
        available: true,
        status: 'READY',
        languageServerExe: exePath,
        brainDir,
        source,
        version
      };
    } catch (err: any) {
      const errorMessage = `Executável encontrado, porém com aviso na validação: ${err.message}`;
      this.validationCache.set(exePath, {
        exePath,
        mtimeMs,
        validatedAt: Date.now(),
        status: 'DEGRADED',
        errorMessage
      });

      return {
        available: true,
        status: 'DEGRADED',
        languageServerExe: exePath,
        brainDir,
        source,
        errorMessage
      };
    }
  }

  /**
   * Resolves the Antigravity GUI application binary (Antigravity.exe) dynamically
   */
  static getAntigravityAppExe(): string | null {
    if (process.env.ANTIGRAVITY_BIN_PATH) {
      return fs.existsSync(process.env.ANTIGRAVITY_BIN_PATH) ? process.env.ANTIGRAVITY_BIN_PATH : null;
    }
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const candidates = [
      path.join(localAppData, 'Programs', 'antigravity', 'Antigravity.exe'),
      path.join(localAppData, 'Programs', 'Antigravity 2', 'Antigravity.exe'),
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'antigravity', 'Antigravity.exe'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'antigravity', 'Antigravity.exe')
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    return null;
  }
}