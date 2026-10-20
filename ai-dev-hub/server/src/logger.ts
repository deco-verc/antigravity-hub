import { db } from './db.js';
import crypto from 'node:crypto';
import { ObservabilityService } from './observability/observabilityService.js';
import { EmitEventInput, ObservabilityLogLevel, ObservabilityEvent } from './observability/types.js';
import { Sanitizer } from './observability/sanitizer.js';

export interface LogEntry {
  id: string;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
  timestamp: string;
  metadata?: string;
}

export class Logger {
  /**
   * Legacy log method - maintains 100% compatibility while emitting structured observability events
   */
  static log(level: 'info' | 'warn' | 'error' | 'success', message: string, metadata?: any): ObservabilityEvent {
    const id = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    const sanitizedMeta = metadata ? Sanitizer.sanitize(metadata) : null;
    const metaStr = sanitizedMeta ? JSON.stringify(sanitizedMeta) : null;
    const cleanMessage = Sanitizer.sanitizeString(message);

    // 1. Maintain backward-compatible system_logs SQLite table
    try {
      db.prepare(`
        INSERT INTO system_logs (id, level, message, timestamp, metadata)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, level, cleanMessage, timestamp, metaStr);
    } catch {
      // If table not ready yet, continue safely
    }

    // 2. Map level to ObservabilityLogLevel
    let obsLevel: ObservabilityLogLevel = 'INFO';
    if (level === 'error') obsLevel = 'ERROR';
    else if (level === 'warn') obsLevel = 'WARN';
    else if (level === 'info' || level === 'success') obsLevel = 'INFO';

    // 3. Emit structured observability event
    const event = ObservabilityService.emit({
      level: obsLevel,
      event: metadata?.event || (level === 'error' ? 'system.error' : level === 'warn' ? 'system.warn' : 'system.log'),
      message: cleanMessage,
      service: metadata?.service || 'core',
      runId: metadata?.runId,
      taskId: metadata?.taskId,
      projectId: metadata?.projectId,
      conversationId: metadata?.conversationId,
      correlationId: metadata?.correlationId,
      traceId: metadata?.traceId,
      spanId: metadata?.spanId,
      status: metadata?.status || (level === 'success' ? 'success' : level === 'error' ? 'failed' : undefined),
      error: metadata?.error,
      metadata: sanitizedMeta,
      timestamp
    });

    // 4. Output to terminal
    const timeFormatted = new Date(timestamp).toLocaleTimeString('pt-BR');
    const prefix = level === 'error' ? '[ERRO]' : level === 'warn' ? '[AVISO]' : '[INFO]';
    if (process.env.MCP_STDIO === 'true') {
      console.error(`[${timeFormatted}] ${prefix} ${cleanMessage}`);
    } else {
      console.log(`[${timeFormatted}] ${prefix} ${cleanMessage}`);
    }

    return event;
  }

  static info(message: string, metadata?: any): ObservabilityEvent {
    return this.log('info', message, metadata);
  }

  static warn(message: string, metadata?: any): ObservabilityEvent {
    return this.log('warn', message, metadata);
  }

  static error(message: string, metadata?: any): ObservabilityEvent {
    return this.log('error', message, metadata);
  }

  static success(message: string, metadata?: any): ObservabilityEvent {
    return this.log('success', message, metadata);
  }

  /**
   * Direct structured event emitter
   */
  static event(input: EmitEventInput): ObservabilityEvent {
    return ObservabilityService.emit(input);
  }

  static trace(message: string, metadata?: any): ObservabilityEvent {
    return ObservabilityService.emit({
      level: 'TRACE',
      event: metadata?.event || 'system.trace',
      message,
      metadata
    });
  }

  static debug(message: string, metadata?: any): ObservabilityEvent {
    return ObservabilityService.emit({
      level: 'DEBUG',
      event: metadata?.event || 'system.debug',
      message,
      metadata
    });
  }

  static fatal(message: string, error?: unknown, metadata?: any): ObservabilityEvent {
    return ObservabilityService.emit({
      level: 'FATAL',
      event: metadata?.event || 'system.fatal',
      message,
      error,
      metadata
    });
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
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "logger",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:logger]", err);
      }
    }
  }
}
