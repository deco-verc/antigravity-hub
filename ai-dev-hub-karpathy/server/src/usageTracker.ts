import { db } from './db.js';
import crypto from 'node:crypto';
import { Logger } from './logger.js';

export interface UsageEventParams {
  accountProfileId?: string | null;
  modelId: string;
  role?: string;
  projectId?: string | null;
  conversationId?: string | null;
  taskId?: string | null;
  durationMs?: number;
  status?: 'success' | 'failure';
  toolCallsCount?: number | null;
  metadata?: Record<string, any>;
}

export interface UsageSummary {
  todayExecutions: number;
  todayDurationSeconds: number;
  byModelToday: Record<string, number>;
  byRoleToday: Record<string, number>;
  byAccountToday: Record<string, number>;
  allTimeExecutions: number;
  quotaDisclaimer: string;
}

export class UsageTracker {
  /**
   * Record a real execution usage event
   */
  static recordEvent(params: UsageEventParams): string {
    const id = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    const role = params.role || 'builder';
    const status = params.status || 'success';
    const durationMs = params.durationMs || 0;
    const toolCallsCount = params.toolCallsCount ?? null;
    const metaStr = params.metadata ? JSON.stringify(params.metadata) : null;

    try {
      db.prepare(`
        INSERT INTO usage_events (
          id, timestamp, account_profile_id, model_id, role, project_id, conversation_id, task_id, duration_ms, status, tool_calls_count, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        timestamp,
        params.accountProfileId || null,
        params.modelId,
        role,
        params.projectId || null,
        params.conversationId || null,
        params.taskId || null,
        durationMs,
        status,
        toolCallsCount,
        metaStr
      );

      Logger.info(`[UsageTracker] Execução registrada: Modelo ${params.modelId} (${role}) - ${durationMs}ms`);
      return id;
    } catch (err: any) {
      Logger.warn(`[UsageTracker] Erro ao registrar evento de uso: ${err.message}`);
      throw new Error(`USAGE_TELEMETRY_WRITE_FAILED: ${err.message}`);
    }
  }

  /**
   * Get total executions today (for "Uso: X execuções hoje")
   */
  static getTodayExecutionCount(accountProfileId?: string | null): number {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayIso = todayStart.toISOString();

    if (accountProfileId) {
      const row = db.prepare(`
        SELECT COUNT(*) as count FROM usage_events
        WHERE timestamp >= ? AND account_profile_id = ?
      `).get(todayIso, accountProfileId) as any;
      return row?.count || 0;
    } else {
      const row = db.prepare(`
        SELECT COUNT(*) as count FROM usage_events
        WHERE timestamp >= ?
      `).get(todayIso) as any;
      return row?.count || 0;
    }
  }

  /**
   * Get comprehensive usage summary
   */
  static getSummary(accountProfileId?: string | null): UsageSummary {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayIso = todayStart.toISOString();

    let todayEvents: any[];
    let allTimeCount = 0;

    if (accountProfileId) {
      todayEvents = db.prepare(`
        SELECT * FROM usage_events
        WHERE timestamp >= ? AND account_profile_id = ?
      `).all(todayIso, accountProfileId) as any[];

      const allRow = db.prepare(`
        SELECT COUNT(*) as count FROM usage_events
        WHERE account_profile_id = ?
      `).get(accountProfileId) as any;
      allTimeCount = allRow?.count || 0;
    } else {
      todayEvents = db.prepare(`
        SELECT * FROM usage_events
        WHERE timestamp >= ?
      `).all(todayIso) as any[];

      const allRow = db.prepare(`
        SELECT COUNT(*) as count FROM usage_events
      `).get() as any;
      allTimeCount = allRow?.count || 0;
    }

    const byModelToday: Record<string, number> = {};
    const byRoleToday: Record<string, number> = {};
    const byAccountToday: Record<string, number> = {};
    let totalDurationMs = 0;

    for (const ev of todayEvents) {
      byModelToday[ev.model_id] = (byModelToday[ev.model_id] || 0) + 1;
      byRoleToday[ev.role] = (byRoleToday[ev.role] || 0) + 1;
      const acc = ev.account_profile_id || 'global';
      byAccountToday[acc] = (byAccountToday[acc] || 0) + 1;
      totalDurationMs += ev.duration_ms || 0;
    }

    return {
      todayExecutions: todayEvents.length,
      todayDurationSeconds: Math.round(totalDurationMs / 1000),
      byModelToday,
      byRoleToday,
      byAccountToday,
      allTimeExecutions: allTimeCount,
      quotaDisclaimer: 'Contagem e cotas exatas de tokens não são disponibilizadas pela CLI do Antigravity neste runtime; o monitoramento registra execuções locais verificadas.'
    };
  }

  /**
   * Get recent execution history
   */
  static getRecentEvents(limit = 20, accountProfileId?: string | null): any[] {
    if (accountProfileId) {
      return db.prepare(`
        SELECT * FROM usage_events
        WHERE account_profile_id = ?
        ORDER BY timestamp DESC
        LIMIT ?
      `).all(accountProfileId, limit);
    }
    return db.prepare(`
      SELECT * FROM usage_events
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(limit);
  }
}
