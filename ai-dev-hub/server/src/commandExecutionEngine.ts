import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { db, HUB_DATA_DIR } from './db.js';
import { ObservabilityService } from './observability/observabilityService.js';
import { Logger } from './logger.js';

export type CommandExecutionStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'TIMED_OUT' | 'CANCELLED';
export type CommandKind = 'generic' | 'test' | 'build' | 'typecheck' | 'lint' | 'git' | 'system';

export interface CommandExecutionOptions {
  id?: string;
  idempotencyKey?: string;
  command: string;
  args?: string[];
  cwd: string;
  kind?: CommandKind;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  shell?: boolean | string;
  reuseCachedMs?: number;
  metadata?: Record<string, any>;
}

export interface CommandExecutionRecord {
  id: string;
  idempotencyKey: string | null;
  command: string;
  args: string[];
  cwd: string;
  kind: CommandKind;
  status: CommandExecutionStatus;
  pid: number | null;
  ownerPid: number;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  errorMessage: string | null;
  timeoutMs: number;
  queueLatencyMs: number | null;
  durationMs: number | null;
  totalLatencyMs: number | null;
  logFilePath: string | null;
  metadata: Record<string, any> | null;
  requestedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  cached?: boolean;
}

const PREVIEW_MAX_BYTES = 8192; // 8 KB preview stored in SQLite

export class CommandExecutionEngine {
  private static activeProcesses = new Map<string, {
    child: any;
    timer: NodeJS.Timeout | null;
    cancelled?: boolean;
    cancelReason?: string;
  }>();

  private static getLogDir(): string {
    const dir = path.join(HUB_DATA_DIR, 'command-logs');
    if (!fs.existsSync(dir)) {
      try { fs.mkdirSync(dir, { recursive: true }); } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "commandExecutionEngine",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:commandExecutionEngine]", err);
      }
    }
    }
    return dir;
  }

  private static isPidAlive(pid: number | null): boolean {
    if (!pid || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (err: any) {
      return err.code !== 'ESRCH';
    }
  }

  private static sanitizeEnv(customEnv?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const clean: NodeJS.ProcessEnv = { ...(customEnv || process.env) };
    delete clean.ELECTRON_RUN_AS_NODE;
    delete clean.ELECTRON_NO_ASAR;
    delete clean.ELECTRON_OZONE_PLATFORM_HINT;
    delete clean.ELECTRON_ENABLE_LOGGING;
    delete clean.NODE_TEST_CONTEXT;
    return clean;
  }

  /**
   * Split a command string into executable and arguments safely respecting quotes.
   */
  static parseCommandLine(command: string): { executable: string; args: string[] } {
    const trimmed = command.trim();
    const parts: string[] = [];
    const regex = /[^\s"']+|"([^"]*)"|'([^']*)'/g;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(trimmed)) !== null) {
      if (match[1] !== undefined) {
        parts.push(match[1]);
      } else if (match[2] !== undefined) {
        parts.push(match[2]);
      } else {
        parts.push(match[0]);
      }
    }

    if (parts.length === 0) {
      return { executable: '', args: [] };
    }

    return {
      executable: parts[0],
      args: parts.slice(1)
    };
  }

  /**
   * Retrieves an execution by ID from database or active cache.
   */
  static getExecution(id: string): CommandExecutionRecord | null {
    try {
      const row: any = db.prepare('SELECT * FROM command_executions WHERE id = ?').get(id);
      if (!row) return null;
      return this.rowToRecord(row);
    } catch {
      return null;
    }
  }

  /**
   * Retrieves the most recent execution matching an idempotency key.
   */
  static getExecutionByIdempotencyKey(key: string): CommandExecutionRecord | null {
    try {
      const row: any = db.prepare('SELECT * FROM command_executions WHERE idempotency_key = ? ORDER BY requested_at DESC LIMIT 1').get(key);
      if (!row) return null;
      return this.rowToRecord(row);
    } catch {
      return null;
    }
  }

  private static rowToRecord(row: any): CommandExecutionRecord {
    let args: string[] = [];
    try { args = JSON.parse(row.args_json || '[]'); } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "commandExecutionEngine",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:commandExecutionEngine]", err);
      }
    }

    let metadata: Record<string, any> | null = null;
    try { metadata = row.metadata_json ? JSON.parse(row.metadata_json) : null; } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "commandExecutionEngine",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:commandExecutionEngine]", err);
      }
    }

    const logFile = path.join(this.getLogDir(), `${row.id}.log`);
    let fullStdout = row.stdout || row.stdout_preview || '';
    let fullStderr = row.stderr || row.stderr_preview || '';

    // If truncated preview was stored, attempt reading full disk log
    if (fs.existsSync(logFile)) {
      try {
        const fullContent = fs.readFileSync(logFile, 'utf-8');
        const sep = '--- [STDERR] ---';
        if (fullContent.includes(sep)) {
          const parts = fullContent.split(sep);
          let out = parts[0].replace(/^--- \[STDOUT\] ---\r?\n?/, '');
          if (out.endsWith('\r\n')) {
            out = out.slice(0, -2);
          } else if (out.endsWith('\n')) {
            out = out.slice(0, -1);
          }
          fullStdout = out;
          let err = (parts[1] || '').replace(/^\r?\n?/, '');
          if (err.endsWith('\r\n')) {
            err = err.slice(0, -2);
          } else if (err.endsWith('\n')) {
            err = err.slice(0, -1);
          }
          fullStderr = err;
        }
      } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "commandExecutionEngine",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:commandExecutionEngine]", err);
      }
    }
    }

    return {
      id: row.id,
      idempotencyKey: row.idempotency_key || null,
      command: row.command,
      args,
      cwd: row.cwd,
      kind: row.kind || 'generic',
      status: row.status as CommandExecutionStatus,
      pid: row.pid,
      ownerPid: row.owner_pid,
      exitCode: row.exit_code,
      stdout: fullStdout,
      stderr: fullStderr,
      errorMessage: row.error_message || null,
      timeoutMs: row.timeout_ms,
      queueLatencyMs: row.queue_latency_ms,
      durationMs: row.duration_ms,
      totalLatencyMs: row.total_latency_ms,
      logFilePath: fs.existsSync(logFile) ? logFile : null,
      metadata,
      requestedAt: row.requested_at,
      startedAt: row.started_at,
      completedAt: row.completed_at
    };
  }

  /**
   * Main execution method.
   * Enforces lifecycle states, non-interactive stdin, timeout guard, persistence and idempotency.
   */
  static async execute(options: CommandExecutionOptions): Promise<CommandExecutionRecord> {
    const id = options.id || crypto.randomUUID();
    const requestedAt = new Date().toISOString();
    const kind = options.kind || 'generic';
    const timeoutMs = options.timeoutMs && options.timeoutMs > 0 ? options.timeoutMs : 30000;
    const cwd = path.resolve(options.cwd);

    let executable = options.command;
    let args = options.args ? [...options.args] : [];

    // If args were not provided explicitly, parse the command string safely
    if (!options.args || options.args.length === 0) {
      const parsed = this.parseCommandLine(options.command);
      executable = parsed.executable;
      args = parsed.args;
    }

    // 1. Idempotency Check: Prevent duplicate concurrent or recent execution
    if (options.idempotencyKey) {
      const existing = this.getExecutionByIdempotencyKey(options.idempotencyKey);
      if (existing) {
        // If actively running and process still alive, attach and return existing
        if ((existing.status === 'RUNNING' || existing.status === 'QUEUED') && this.isPidAlive(existing.pid)) {
          Logger.info(`[CommandExecutionEngine] Idempotência ativa: anexando à execução em andamento "${existing.id}" (PID ${existing.pid})`);
          ObservabilityService.emit({
            level: 'INFO',
            event: 'command.deduplicated_active',
            message: `Execução duplicada prevenida: comando já em andamento com chave "${options.idempotencyKey}"`,
            service: 'execution-engine',
            metadata: { existingId: existing.id, pid: existing.pid, key: options.idempotencyKey }
          });
          return existing;
        }

        // If reuseCachedMs requested and completed successfully recently, reuse cached result
        if (options.reuseCachedMs && options.reuseCachedMs > 0 && existing.status === 'COMPLETED' && existing.exitCode === 0) {
          const completedEpoch = existing.completedAt ? new Date(existing.completedAt).getTime() : 0;
          const ageMs = Date.now() - completedEpoch;
          if (ageMs < options.reuseCachedMs) {
            Logger.info(`[CommandExecutionEngine] Idempotência em cache: reutilizando resultado de "${existing.id}" (${ageMs}ms atrás)`);
            return { ...existing, cached: true };
          }
        }
      }
    }

    // 2. Register initial QUEUED state in DB
    try {
      db.prepare(`
        INSERT INTO command_executions (
          id, idempotency_key, command, args_json, cwd, kind, status,
          owner_pid, timeout_ms, requested_at, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, 'QUEUED', ?, ?, ?, ?)
      `).run(
        id,
        options.idempotencyKey || null,
        options.command,
        JSON.stringify(args),
        cwd,
        kind,
        process.pid,
        timeoutMs,
        requestedAt,
        options.metadata ? JSON.stringify(options.metadata) : null
      );
    } catch (err: any) {
      Logger.warn(`[CommandExecutionEngine] Falha ao registrar fila no SQLite: ${err.message}`);
    }

    const startEpoch = Date.now();
    const startedAt = new Date(startEpoch).toISOString();
    const queueLatencyMs = Math.max(0, startEpoch - new Date(requestedAt).getTime());

    // 3. Prepare Environment & Windows Safety Flags
    const env = this.sanitizeEnv(options.env);

    // Guard: ensure PowerShell never enters interactive stdin
    if (executable.toLowerCase().includes('powershell') && !args.includes('-NonInteractive')) {
      args = ['-NoProfile', '-NonInteractive', ...args.filter(a => a !== '-NoProfile')];
    }

    ObservabilityService.emit({
      level: 'INFO',
      event: 'command.started',
      message: `Iniciando processo: ${executable} ${args.join(' ')} (timeout: ${timeoutMs}ms)`,
      service: 'execution-engine',
      metadata: { id, command: options.command, kind, cwd, timeoutMs }
    });

    return new Promise<CommandExecutionRecord>((resolve) => {
      let stdoutBuffer = '';
      let stderrBuffer = '';
      let timedOut = false;
      let child: any = null;

      const finishExecution = (
        finalStatus: CommandExecutionStatus,
        exitCode: number | null,
        errorMessage: string | null
      ) => {
        const completedEpoch = Date.now();
        const completedAt = new Date(completedEpoch).toISOString();
        const durationMs = Math.max(0, completedEpoch - startEpoch);
        const totalLatencyMs = Math.max(0, completedEpoch - new Date(requestedAt).getTime());

        // Clean up from active tracking map
        this.activeProcesses.delete(id);

        const stdoutPreview = stdoutBuffer.slice(0, PREVIEW_MAX_BYTES);
        const stderrPreview = stderrBuffer.slice(0, PREVIEW_MAX_BYTES);

        // Persist full output to log file on disk
        const logFile = path.join(this.getLogDir(), `${id}.log`);
        try {
          fs.writeFileSync(logFile, `--- [STDOUT] ---\n${stdoutBuffer}\n--- [STDERR] ---\n${stderrBuffer}\n`, 'utf-8');
        } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "commandExecutionEngine",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:commandExecutionEngine]", err);
      }
    }

        // Update record in SQLite
        try {
          db.prepare(`
            UPDATE command_executions SET
              status = ?,
              exit_code = ?,
              stdout_preview = ?,
              stderr_preview = ?,
              error_message = ?,
              started_at = ?,
              completed_at = ?,
              queue_latency_ms = ?,
              duration_ms = ?,
              total_latency_ms = ?
            WHERE id = ?
          `).run(
            finalStatus,
            exitCode,
            stdoutPreview,
            stderrPreview,
            errorMessage,
            startedAt,
            completedAt,
            queueLatencyMs,
            durationMs,
            totalLatencyMs,
            id
          );
        } catch (dbErr: any) {
          Logger.error(`[CommandExecutionEngine] Falha ao persistir conclusão no SQLite: ${dbErr.message}`);
        }

        const record: CommandExecutionRecord = {
          id,
          idempotencyKey: options.idempotencyKey || null,
          command: options.command,
          args,
          cwd,
          kind,
          status: finalStatus,
          pid: child?.pid || null,
          ownerPid: process.pid,
          exitCode,
          stdout: stdoutBuffer,
          stderr: stderrBuffer,
          errorMessage,
          timeoutMs,
          queueLatencyMs,
          durationMs,
          totalLatencyMs,
          logFilePath: fs.existsSync(logFile) ? logFile : null,
          metadata: options.metadata || null,
          requestedAt,
          startedAt,
          completedAt
        };

        ObservabilityService.emit({
          level: finalStatus === 'COMPLETED' ? 'INFO' : 'WARN',
          event: `command.${finalStatus.toLowerCase()}`,
          message: `Processo finalizado com status ${finalStatus} (código ${exitCode}, duração ${durationMs}ms)`,
          service: 'execution-engine',
          durationMs,
          status: finalStatus,
          metadata: { id, exitCode, durationMs, queueLatencyMs, totalLatencyMs }
        });

        resolve(record);
      };

      try {
        // Enforce stdio: ['ignore', 'pipe', 'pipe'] to completely prevent stdin hang on Windows
        child = spawn(executable, args, {
          cwd,
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
          shell: options.shell || false
        });

        const pid = child.pid || null;

        // Update state to RUNNING with child PID
        try {
          db.prepare(`
            UPDATE command_executions SET
              status = 'RUNNING',
              pid = ?,
              started_at = ?,
              queue_latency_ms = ?
            WHERE id = ?
          `).run(pid, startedAt, queueLatencyMs, id);
        } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "commandExecutionEngine",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:commandExecutionEngine]", err);
      }
    }

        // Timeout handler
        const timer = setTimeout(() => {
          timedOut = true;
          Logger.warn(`[CommandExecutionEngine] Comando "${id}" excedeu o timeout de ${timeoutMs}ms. Encerrando processo PID ${child.pid}...`);

          try {
            if (process.platform === 'win32' && child.pid) {
              spawn('taskkill', ['/F', '/PID', String(child.pid), '/T'], { stdio: 'ignore', windowsHide: true });
            } else {
              child.kill('SIGTERM');
              setTimeout(() => {
                try { child.kill('SIGKILL'); } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "commandExecutionEngine",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:commandExecutionEngine]", err);
      }
    }
              }, 2000).unref();
            }
          } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "commandExecutionEngine",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:commandExecutionEngine]", err);
      }
    }
        }, timeoutMs);

        timer.unref();

        const activeEntry = { child, timer, cancelled: false, cancelReason: '' };
        this.activeProcesses.set(id, activeEntry);

        child.stdout?.on('data', (data: Buffer) => {
          stdoutBuffer += data.toString('utf-8');
        });

        child.stderr?.on('data', (data: Buffer) => {
          stderrBuffer += data.toString('utf-8');
        });

        child.on('error', (err: any) => {
          if (timer) clearTimeout(timer);
          finishExecution('FAILED', null, err.message || 'Falha ao spawnar processo');
        });

        child.on('close', (code: number | null) => {
          if (timer) clearTimeout(timer);

          if (activeEntry.cancelled) {
            finishExecution('CANCELLED', code, activeEntry.cancelReason || 'Cancelado pelo usuário ou supervisor');
          } else if (timedOut) {
            finishExecution('TIMED_OUT', code ?? 124, `Comando excedeu o tempo limite configurado de ${timeoutMs}ms`);
          } else if (code === 0) {
            finishExecution('COMPLETED', 0, null);
          } else {
            finishExecution('FAILED', code ?? 1, `Processo encerrou com código de saída não zero: ${code}`);
          }
        });
      } catch (spawnErr: any) {
        finishExecution('FAILED', null, spawnErr.message || 'Exceção ao disparar comando');
      }
    });
  }

  /**
   * Cancels a running execution by ID.
   */
  static cancelExecution(id: string, reason = 'Cancelado pelo usuário ou supervisor'): boolean {
    const active = this.activeProcesses.get(id);
    if (!active) return false;

    active.cancelled = true;
    active.cancelReason = reason;
    if (active.timer) clearTimeout(active.timer);

    try {
      if (process.platform === 'win32' && active.child.pid) {
        spawn('taskkill', ['/F', '/PID', String(active.child.pid), '/T'], { stdio: 'ignore', windowsHide: true });
      } else {
        active.child.kill('SIGTERM');
      }
    } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "commandExecutionEngine",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:commandExecutionEngine]", err);
      }
    }

    const now = new Date().toISOString();
    try {
      db.prepare(`
        UPDATE command_executions SET
          status = 'CANCELLED',
          error_message = ?,
          completed_at = ?
        WHERE id = ?
      `).run(reason, now, id);
    } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "commandExecutionEngine",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:commandExecutionEngine]", err);
      }
    }

    return true;
  }

  /**
   * Reconciles executions left RUNNING or QUEUED across backend crashes / restarts.
   */
  static reconcileOrphanedExecutions(): number {
    try {
      const activeRows: any[] = db.prepare(`
        SELECT id, pid, owner_pid FROM command_executions
        WHERE status IN ('RUNNING', 'QUEUED')
      `).all();

      let reconciled = 0;
      const now = new Date().toISOString();

      for (const row of activeRows) {
        // If owner PID died or child PID died, mark CANCELLED with orphaned status
        const isOwnerAlive = this.isPidAlive(row.owner_pid);
        const isChildAlive = row.pid ? this.isPidAlive(row.pid) : false;

        if (!isOwnerAlive || !isChildAlive) {
          db.prepare(`
            UPDATE command_executions SET
              status = 'CANCELLED',
              error_message = 'PROCESS_ORPHANED_ON_RESTART',
              completed_at = ?
            WHERE id = ?
          `).run(now, row.id);
          reconciled++;
        }
      }

      if (reconciled > 0) {
        ObservabilityService.emit({
          level: 'INFO',
          event: 'execution.orphaned_reconciled',
          message: `${reconciled} execuções órfãs reconciliadas após reinicialização do sistema`,
          service: 'execution-engine',
          metadata: { count: reconciled }
        });
      }

      return reconciled;
    } catch {
      return 0;
    }
  }

  /**
   * Produces aggregated performance metrics for diagnosis.
   */
  static getPerformanceSummary(options?: { since?: string; limit?: number }) {
    try {
      const limit = options?.limit || 100;
      const sinceClause = options?.since ? "AND requested_at >= ?" : "";
      const params = options?.since ? [options.since] : [];

      const stats: any = db.prepare(`
        SELECT
          COUNT(*) as total_executions,
          SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) as completed_count,
          SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as failed_count,
          SUM(CASE WHEN status = 'TIMED_OUT' THEN 1 ELSE 0 END) as timeout_count,
          SUM(CASE WHEN status = 'CANCELLED' THEN 1 ELSE 0 END) as cancelled_count,
          AVG(duration_ms) as avg_duration_ms,
          AVG(queue_latency_ms) as avg_queue_latency_ms,
          AVG(total_latency_ms) as avg_total_latency_ms,
          MAX(duration_ms) as max_duration_ms
        FROM command_executions
        WHERE status NOT IN ('QUEUED', 'RUNNING') ${sinceClause}
      `).get(...params);

      const byKind: any[] = db.prepare(`
        SELECT
          kind,
          COUNT(*) as count,
          AVG(duration_ms) as avg_duration_ms,
          MAX(duration_ms) as max_duration_ms
        FROM command_executions
        WHERE status = 'COMPLETED' ${sinceClause}
        GROUP BY kind
      `).all(...params);

      const slowest: any[] = db.prepare(`
        SELECT id, command, kind, status, duration_ms, exit_code, requested_at
        FROM command_executions
        WHERE duration_ms IS NOT NULL ${sinceClause}
        ORDER BY duration_ms DESC
        LIMIT 10
      `).all(...params);

      const recent: any[] = db.prepare(`
        SELECT id, idempotency_key, command, kind, status, exit_code, duration_ms, queue_latency_ms, total_latency_ms, requested_at, completed_at
        FROM command_executions
        ORDER BY requested_at DESC
        LIMIT ${limit}
      `).all();

      return {
        total_executions: stats?.total_executions || 0,
        completed_count: stats?.completed_count || 0,
        failed_count: stats?.failed_count || 0,
        timeout_count: stats?.timeout_count || 0,
        cancelled_count: stats?.cancelled_count || 0,
        avg_duration_ms: Math.round(stats?.avg_duration_ms || 0),
        avg_queue_latency_ms: Math.round(stats?.avg_queue_latency_ms || 0),
        avg_total_latency_ms: Math.round(stats?.avg_total_latency_ms || 0),
        recent,
        summary: {
          totalExecutions: stats?.total_executions || 0,
          completed: stats?.completed_count || 0,
          failed: stats?.failed_count || 0,
          timeouts: stats?.timeout_count || 0,
          cancelled: stats?.cancelled_count || 0,
          avgDurationMs: Math.round(stats?.avg_duration_ms || 0),
          avgQueueLatencyMs: Math.round(stats?.avg_queue_latency_ms || 0),
          avgTotalLatencyMs: Math.round(stats?.avg_total_latency_ms || 0),
          maxDurationMs: stats?.max_duration_ms || 0
        },
        metricsByKind: byKind.map(k => ({
          kind: k.kind,
          count: k.count,
          avgDurationMs: Math.round(k.avg_duration_ms || 0),
          maxDurationMs: k.max_duration_ms || 0
        })),
        slowestCommands: slowest,
        recentExecutions: recent
      };
    } catch (err: any) {
      return {
        error: err.message,
        summary: { totalExecutions: 0, completed: 0, failed: 0, timeouts: 0, cancelled: 0 }
      };
    }
  }
}
