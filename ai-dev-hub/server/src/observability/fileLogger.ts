/**
 * Safe Rotating File Logger for Operational and Structured Output
 * Handles size-based rotation, retention limits, Windows file-lock resilience, and data sanitization.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Sanitizer } from './sanitizer.js';
import { ObservabilityEvent } from './types.js';

export interface FileLoggerConfig {
  logsDir?: string;
  maxSizeBytes?: number;
  maxRotations?: number;
  enabled?: boolean;
}

export class RotatingFileLogger {
  private logsDir: string;
  private maxSizeBytes: number;
  private maxRotations: number;
  private enabled: boolean;
  private lastRotationTimestamp?: string;

  constructor(config?: FileLoggerConfig) {
    const baseDir = process.env.AI_DEV_HUB_DATA_DIR || process.env.DECOHUB_DATA_DIR || path.join(os.homedir(), '.ai-dev-hub');
    this.logsDir = config?.logsDir || path.join(baseDir, 'logs');
    this.maxSizeBytes = config?.maxSizeBytes || 5 * 1024 * 1024; // 5 MB default
    this.maxRotations = config?.maxRotations || 5;
    this.enabled = config?.enabled ?? true;

    this.ensureDirectory();
  }

  private ensureDirectory() {
    try {
      if (!fs.existsSync(this.logsDir)) {
        fs.mkdirSync(this.logsDir, { recursive: true });
      }
    } catch (err: any) {
      console.error(`[RotatingFileLogger] Falha ao criar diretório de logs (${this.logsDir}):`, err.message);
    }
  }

  getLogsDir(): string {
    return this.logsDir;
  }

  getStats(): { directory: string; filesCount: number; totalSizeBytes: number; lastRotation?: string } {
    try {
      if (!fs.existsSync(this.logsDir)) {
        return { directory: this.logsDir, filesCount: 0, totalSizeBytes: 0 };
      }
      const files = fs.readdirSync(this.logsDir);
      let totalSize = 0;
      for (const file of files) {
        try {
          const stat = fs.statSync(path.join(this.logsDir, file));
          totalSize += stat.size;
        } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "fileLogger",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:fileLogger]", err);
      }
    }
      }
      return {
        directory: this.logsDir,
        filesCount: files.length,
        totalSizeBytes: totalSize,
        lastRotation: this.lastRotationTimestamp
      };
    } catch {
      return { directory: this.logsDir, filesCount: 0, totalSizeBytes: 0 };
    }
  }

  private rotateIfNeeded(filePath: string): void {
    try {
      if (!fs.existsSync(filePath)) return;
      const stats = fs.statSync(filePath);
      if (stats.size < this.maxSizeBytes) return;

      // Rotate existing rotated files
      for (let i = this.maxRotations - 1; i >= 1; i--) {
        const older = `${filePath}.${i}`;
        const newer = `${filePath}.${i + 1}`;
        if (fs.existsSync(older)) {
          if (i === this.maxRotations - 1 && fs.existsSync(newer)) {
            try { fs.unlinkSync(newer); } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "fileLogger",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:fileLogger]", err);
      }
    }
          }
          try {
            fs.renameSync(older, newer);
          } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "fileLogger",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:fileLogger]", err);
      }
    }
        }
      }

      // Rename current file to .1
      const targetFirst = `${filePath}.1`;
      if (fs.existsSync(targetFirst)) {
        try { fs.unlinkSync(targetFirst); } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "fileLogger",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:fileLogger]", err);
      }
    }
      }
      fs.renameSync(filePath, targetFirst);
      this.lastRotationTimestamp = new Date().toISOString();
    } catch (err: any) {
      // Non-fatal: do not crash if rotation is locked by another process
      // Will retry on next check
    }
  }

  appendLine(fileName: string, line: string): void {
    if (!this.enabled) return;
    try {
      this.ensureDirectory();
      const filePath = path.join(this.logsDir, fileName);
      this.rotateIfNeeded(filePath);
      const cleanLine = Sanitizer.sanitizeString(line);
      fs.appendFileSync(filePath, `${cleanLine}\n`, 'utf-8');
    } catch (err: any) {
      // Fallback: silently ignore file write error to prevent crashing host process
    }
  }

  appendEvent(event: ObservabilityEvent): void {
    if (!this.enabled) return;
    try {
      const sanitizedEvent = Sanitizer.sanitize(event);
      const jsonlLine = JSON.stringify(sanitizedEvent);
      this.appendLine('events.jsonl', jsonlLine);

      // Also append readable line to backend.log
      const timeStr = event.timestamp ? new Date(event.timestamp).toISOString() : new Date().toISOString();
      const humanLine = `[${timeStr}] [${event.level}] [${event.service}] [${event.event}] ${event.message}${event.error ? ` | ERROR: ${event.error.message}` : ''}`;
      this.appendLine('backend.log', humanLine);
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "fileLogger",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:fileLogger]", err);
      }
    }
  }
}

export const defaultFileLogger = new RotatingFileLogger();
