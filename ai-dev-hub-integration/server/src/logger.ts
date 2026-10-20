import { db } from './db.js';
import crypto from 'node:crypto';

export interface LogEntry {
  id: string;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
  timestamp: string;
  metadata?: string;
}

export class Logger {
  static log(level: 'info' | 'warn' | 'error' | 'success', message: string, metadata?: any) {
    const id = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    const metaStr = metadata ? JSON.stringify(metadata) : null;

    try {
      db.prepare(`
        INSERT INTO system_logs (id, level, message, timestamp, metadata)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, level, message, timestamp, metaStr);
    } catch {
      // If table not ready yet, continue
    }

    const timeFormatted = new Date(timestamp).toLocaleTimeString('pt-BR');
    const prefix = level === 'error' ? '[ERRO]' : level === 'warn' ? '[AVISO]' : '[INFO]';
    if (process.env.MCP_STDIO === 'true') {
      console.error(`[${timeFormatted}] ${prefix} ${message}`);
    } else {
      console.log(`[${timeFormatted}] ${prefix} ${message}`);
    }
  }

  static info(message: string, metadata?: any) {
    this.log('info', message, metadata);
  }

  static warn(message: string, metadata?: any) {
    this.log('warn', message, metadata);
  }

  static error(message: string, metadata?: any) {
    this.log('error', message, metadata);
  }

  static success(message: string, metadata?: any) {
    this.log('success', message, metadata);
  }

  static getRecentLogs(limit = 100): LogEntry[] {
    try {
      const rows = db.prepare('SELECT * FROM system_logs ORDER BY timestamp DESC LIMIT ?').all(limit);
      return rows as unknown as LogEntry[];
    } catch {
      return [];
    }
  }

  static clearLogs() {
    try {
      db.prepare('DELETE FROM system_logs').run();
      this.info('Histórico de logs do sistema limpo');
    } catch {}
  }
}
