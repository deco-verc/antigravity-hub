/**
 * Central Observability & Diagnostic Service
 * Handles structured logging, correlation propagation, SQLite persistence,
 * query filtering, timeline reconstruction, and safe in-memory fallback.
 */
import crypto from 'node:crypto';
import { db } from '../db.js';
import { Sanitizer } from './sanitizer.js';
import { TraceContextManager } from './context.js';
import { defaultFileLogger, RotatingFileLogger } from './fileLogger.js';
import {
  ObservabilityEvent,
  EmitEventInput,
  EventQueryParams,
  ObservabilityHealthReport,
  ObservabilityLogLevel
} from './types.js';

export class ObservabilityService {
  private static fallbackBuffer: ObservabilityEvent[] = [];
  private static MAX_FALLBACK_BUFFER_SIZE = 1000;
  private static droppedEventsCount = 0;
  private static fileLogger: RotatingFileLogger = defaultFileLogger;
  private static isWritingToDb = false;

  static setFileLogger(logger: RotatingFileLogger) {
    this.fileLogger = logger;
  }

  /**
   * Emits a structured observability event.
   * Resolves ambient trace context, sanitizes sensitive data,
   * writes to SQLite and file logger without ever throwing.
   */
  static emit(input: EmitEventInput): ObservabilityEvent {
    const id = `obs-${crypto.randomUUID().slice(0, 12)}`;
    const timestamp = input.timestamp || new Date().toISOString();
    const level: ObservabilityLogLevel = input.level || 'INFO';
    const environment = input.environment || process.env.NODE_ENV || (process.env.DECOHUB_OFFLINE_MODE === 'true' ? 'offline' : 'production');
    const processId = process.pid;

    // Resolve ambient trace context if not explicitly provided
    const context = TraceContextManager.resolveContext({
      traceId: input.traceId || undefined,
      correlationId: input.correlationId || undefined,
      spanId: input.spanId || undefined,
      parentSpanId: input.parentSpanId || undefined,
      runId: input.runId || undefined,
      taskId: input.taskId || undefined,
      milestone: input.milestone || undefined,
      projectId: input.projectId || undefined,
      conversationId: input.conversationId || undefined,
      service: input.service || undefined
    });

    const service = input.service || context.service || 'core';
    const traceId = input.traceId || context.traceId || null;
    const correlationId = input.correlationId || context.correlationId || traceId || null;
    const spanId = input.spanId || context.spanId || null;
    const parentSpanId = input.parentSpanId || context.parentSpanId || null;
    const runId = input.runId || context.runId || null;
    const taskId = input.taskId || context.taskId || null;
    const milestone = input.milestone || context.milestone || null;
    const projectId = input.projectId || context.projectId || null;
    const conversationId = input.conversationId || context.conversationId || null;

    // Sanitize message, error, metadata
    const cleanMessage = Sanitizer.sanitizeString(input.message);
    const structuredError = input.error ? Sanitizer.formatError(input.error) : null;
    const cleanMetadata = input.metadata ? Sanitizer.sanitize(input.metadata) : null;

    const event: ObservabilityEvent = {
      id,
      timestamp,
      level,
      event: input.event,
      message: cleanMessage,
      service,
      environment,
      processId,
      sessionId: input.sessionId || null,
      correlationId,
      traceId,
      spanId,
      parentSpanId,
      runId,
      taskId,
      milestone,
      projectId,
      conversationId,
      attempt: input.attempt ?? null,
      durationMs: input.durationMs ?? null,
      status: input.status || null,
      error: structuredError,
      metadata: cleanMetadata,
      createdAt: timestamp
    };

    // 1. Output to file logger
    try {
      this.fileLogger.appendEvent(event);
    } catch {}

    // 2. Persist to SQLite database with safe recursion prevention and fallback buffer
    if (!this.isWritingToDb) {
      this.isWritingToDb = true;
      try {
        db.prepare(`
          INSERT INTO observability_events (
            id, timestamp, level, event, message, service, environment,
            process_id, session_id, correlation_id, trace_id, span_id, parent_span_id,
            run_id, task_id, milestone, project_id, conversation_id, attempt,
            duration_ms, status, error_json, metadata_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          event.id,
          event.timestamp,
          event.level,
          event.event,
          event.message,
          event.service,
          event.environment,
          event.processId,
          event.sessionId || null,
          event.correlationId || null,
          event.traceId || null,
          event.spanId || null,
          event.parentSpanId || null,
          event.runId || null,
          event.taskId || null,
          event.milestone || null,
          event.projectId || null,
          event.conversationId || null,
          event.attempt ?? null,
          event.durationMs ?? null,
          event.status ?? null,
          event.error ? JSON.stringify(event.error) : null,
          event.metadata ? JSON.stringify(event.metadata) : null,
          event.createdAt
        );

        // If there were any fallback buffered events, attempt to flush them
        if (this.fallbackBuffer.length > 0) {
          const toFlush = this.fallbackBuffer.splice(0, 50);
          for (const fb of toFlush) {
            try {
              db.prepare(`
                INSERT INTO observability_events (
                  id, timestamp, level, event, message, service, environment,
                  process_id, session_id, correlation_id, trace_id, span_id, parent_span_id,
                  run_id, task_id, milestone, project_id, conversation_id, attempt,
                  duration_ms, status, error_json, metadata_json, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              `).run(
                fb.id, fb.timestamp, fb.level, fb.event, fb.message, fb.service, fb.environment,
                fb.processId, fb.sessionId || null, fb.correlationId || null, fb.traceId || null,
                fb.spanId || null, fb.parentSpanId || null, fb.runId || null, fb.taskId || null,
                fb.milestone || null, fb.projectId || null, fb.conversationId || null, fb.attempt ?? null,
                fb.durationMs ?? null, fb.status ?? null, fb.error ? JSON.stringify(fb.error) : null,
                fb.metadata ? JSON.stringify(fb.metadata) : null, fb.createdAt
              );
            } catch {}
          }
        }
      } catch (dbErr: any) {
        // Fallback buffer
        if (this.fallbackBuffer.length >= this.MAX_FALLBACK_BUFFER_SIZE) {
          this.fallbackBuffer.shift();
          this.droppedEventsCount++;
        }
        this.fallbackBuffer.push(event);
      } finally {
        this.isWritingToDb = false;
      }
    } else {
      // Re-entrant write prevention: buffer event
      if (this.fallbackBuffer.length >= this.MAX_FALLBACK_BUFFER_SIZE) {
        this.fallbackBuffer.shift();
        this.droppedEventsCount++;
      }
      this.fallbackBuffer.push(event);
    }

    // 3. Console output for development / stdio
    if (process.env.DECOHUB_LOG_CONSOLE === 'true' || level === 'ERROR' || level === 'FATAL') {
      const timeFormatted = new Date(timestamp).toLocaleTimeString('pt-BR');
      const errSuffix = event.error ? ` [ERRO: ${event.error.message}]` : '';
      const formatted = `[${timeFormatted}] [${event.level}] [${event.service}] ${event.message}${errSuffix}`;
      if (level === 'ERROR' || level === 'FATAL') {
        console.error(formatted);
      } else {
        console.log(formatted);
      }
    }

    return event;
  }

  // -------------------------------------------------------------
  // QUERY & RETRIEVAL API
  // -------------------------------------------------------------

  static queryEvents(params: EventQueryParams): {
    events: ObservabilityEvent[];
    total: number;
    limit: number;
    offset: number;
  } {
    const limit = Math.min(Math.max(1, params.limit || 50), 500);
    const offset = Math.max(0, params.offset || 0);

    const conditions: string[] = [];
    const values: any[] = [];

    if (params.level) {
      conditions.push('level = ?');
      values.push(params.level);
    }
    if (params.service) {
      conditions.push('service = ?');
      values.push(params.service);
    }
    if (params.event) {
      conditions.push('event = ?');
      values.push(params.event);
    }
    if (params.runId) {
      conditions.push('run_id = ?');
      values.push(params.runId);
    }
    if (params.taskId) {
      conditions.push('task_id = ?');
      values.push(params.taskId);
    }
    if (params.projectId) {
      conditions.push('project_id = ?');
      values.push(params.projectId);
    }
    if (params.conversationId) {
      conditions.push('conversation_id = ?');
      values.push(params.conversationId);
    }
    if (params.correlationId) {
      conditions.push('correlation_id = ?');
      values.push(params.correlationId);
    }
    if (params.traceId) {
      conditions.push('trace_id = ?');
      values.push(params.traceId);
    }
    if (params.status) {
      conditions.push('status = ?');
      values.push(params.status);
    }
    if (params.since) {
      conditions.push('timestamp >= ?');
      values.push(params.since);
    }
    if (params.until) {
      conditions.push('timestamp <= ?');
      values.push(params.until);
    }
    if (params.search) {
      conditions.push('(message LIKE ? OR error_json LIKE ? OR metadata_json LIKE ?)');
      const term = `%${params.search}%`;
      values.push(term, term, term);
    }
    if (params.errorCode) {
      conditions.push("error_json LIKE ?");
      values.push(`%"code":"${params.errorCode}"%`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    let total = 0;
    try {
      const countRow: any = db.prepare(`SELECT COUNT(*) as count FROM observability_events ${whereClause}`).get(...values);
      total = countRow?.count || 0;
    } catch {
      total = 0;
    }

    let rows: any[] = [];
    try {
      rows = db.prepare(`
        SELECT * FROM observability_events
        ${whereClause}
        ORDER BY timestamp DESC
        LIMIT ? OFFSET ?
      `).all(...values, limit, offset);
    } catch {
      rows = [];
    }

    const events: ObservabilityEvent[] = rows.map(r => this.mapRowToEvent(r));
    return { events, total, limit, offset };
  }

  static getEventById(id: string): ObservabilityEvent | null {
    try {
      const row: any = db.prepare('SELECT * FROM observability_events WHERE id = ?').get(id);
      return row ? this.mapRowToEvent(row) : null;
    } catch {
      return null;
    }
  }

  static getTimelineForRun(runId: string): ObservabilityEvent[] {
    try {
      const rows: any[] = db.prepare(`
        SELECT * FROM observability_events
        WHERE run_id = ?
        ORDER BY timestamp ASC
      `).all(runId);
      return rows.map(r => this.mapRowToEvent(r));
    } catch {
      return [];
    }
  }

  static getEventsForTask(taskId: string): ObservabilityEvent[] {
    try {
      const rows: any[] = db.prepare(`
        SELECT * FROM observability_events
        WHERE task_id = ?
        ORDER BY timestamp ASC
      `).all(taskId);
      return rows.map(r => this.mapRowToEvent(r));
    } catch {
      return [];
    }
  }

  static getGroupedErrors(since?: string): Array<{
    errorKey: string;
    count: number;
    firstSeen: string;
    lastSeen: string;
    sampleEvent: ObservabilityEvent;
  }> {
    const sinceFilter = since ? 'AND timestamp >= ?' : '';
    const params = since ? [since] : [];

    try {
      const rows: any[] = db.prepare(`
        SELECT * FROM observability_events
        WHERE (level IN ('ERROR', 'FATAL') OR error_json IS NOT NULL)
        ${sinceFilter}
        ORDER BY timestamp DESC
        LIMIT 200
      `).all(...params);

      const map = new Map<string, { count: number; firstSeen: string; lastSeen: string; sample: any }>();
      for (const row of rows) {
        let errKey = row.message;
        if (row.error_json) {
          try {
            const parsed = JSON.parse(row.error_json);
            errKey = `${parsed.name || 'Error'}: ${parsed.message || row.message}`;
          } catch {}
        }

        const existing = map.get(errKey);
        if (!existing) {
          map.set(errKey, {
            count: 1,
            firstSeen: row.timestamp,
            lastSeen: row.timestamp,
            sample: row
          });
        } else {
          existing.count++;
          if (row.timestamp < existing.firstSeen) existing.firstSeen = row.timestamp;
          if (row.timestamp > existing.lastSeen) existing.lastSeen = row.timestamp;
        }
      }

      return Array.from(map.entries()).map(([errorKey, data]) => ({
        errorKey,
        count: data.count,
        firstSeen: data.firstSeen,
        lastSeen: data.lastSeen,
        sampleEvent: this.mapRowToEvent(data.sample)
      })).sort((a, b) => b.count - a.count);
    } catch {
      return [];
    }
  }

  static getHealthReport(): ObservabilityHealthReport {
    let dbConnected = true;
    let totalEvents = 0;
    let events24h = 0;
    let errors24h = 0;

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    try {
      const totalRow: any = db.prepare('SELECT COUNT(*) as c FROM observability_events').get();
      totalEvents = totalRow?.c || 0;

      const recentRow: any = db.prepare('SELECT COUNT(*) as c FROM observability_events WHERE timestamp >= ?').get(oneDayAgo);
      events24h = recentRow?.c || 0;

      const errRow: any = db.prepare("SELECT COUNT(*) as c FROM observability_events WHERE timestamp >= ? AND level IN ('ERROR', 'FATAL')").get(oneDayAgo);
      errors24h = errRow?.c || 0;
    } catch {
      dbConnected = false;
    }

    const fileStats = this.fileLogger.getStats();

    return {
      status: !dbConnected ? 'unhealthy' : this.droppedEventsCount > 0 ? 'degraded' : 'healthy',
      databaseConnected: dbConnected,
      totalEventsCount: totalEvents,
      eventsLast24Hours: events24h,
      errorsLast24Hours: errors24h,
      activeAnomaliesCount: 0, // Injected by DiagnosticService
      fileLogger: fileStats,
      inMemoryQueue: {
        pendingEvents: this.fallbackBuffer.length,
        droppedEventsCount: this.droppedEventsCount
      }
    };
  }

  static exportEvents(params: EventQueryParams, format: 'json' | 'jsonl' = 'json'): string {
    const { events } = this.queryEvents({ ...params, limit: 1000, offset: 0 });
    // Sanitization is already applied at insertion and verified here
    const cleanEvents = Sanitizer.sanitize(events);

    if (format === 'jsonl') {
      return cleanEvents.map((e: any) => JSON.stringify(e)).join('\n');
    }
    return JSON.stringify(cleanEvents, null, 2);
  }

  static cleanupOldEvents(retentionDays = 30): number {
    try {
      const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
      const result = db.prepare('DELETE FROM observability_events WHERE timestamp < ?').run(cutoff);
      return Number(result.changes);
    } catch {
      return 0;
    }
  }

  private static mapRowToEvent(r: any): ObservabilityEvent {
    let error: any = null;
    if (r.error_json) {
      try { error = JSON.parse(r.error_json); } catch {}
    }
    let metadata: any = null;
    if (r.metadata_json) {
      try { metadata = JSON.parse(r.metadata_json); } catch {}
    }

    return {
      id: r.id,
      timestamp: r.timestamp,
      level: r.level as ObservabilityLogLevel,
      event: r.event,
      message: r.message,
      service: r.service,
      environment: r.environment,
      processId: r.process_id,
      sessionId: r.session_id,
      correlationId: r.correlation_id,
      traceId: r.trace_id,
      spanId: r.span_id,
      parentSpanId: r.parent_span_id,
      runId: r.run_id,
      taskId: r.task_id,
      milestone: r.milestone,
      projectId: r.project_id,
      conversationId: r.conversation_id,
      attempt: r.attempt,
      durationMs: r.duration_ms,
      status: r.status,
      error,
      metadata,
      createdAt: r.created_at
    };
  }
}
