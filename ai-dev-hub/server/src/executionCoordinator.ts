import crypto from 'node:crypto';
import { db } from './db.js';
import { ObservabilityService } from './observability/observabilityService.js';

/** A durable reservation is acquired BEFORE an external operation, across backend processes. */
export class ExecutionCoordinator {
  static readonly DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutos de TTL

  static acquire(scope: string, context: Record<string, any>): string {
    const token = crypto.randomUUID();
    const now = new Date().toISOString();
    const result = db.prepare('INSERT OR IGNORE INTO execution_reservations (scope,token,owner_pid,context_json,created_at,updated_at) VALUES (?,?,?,?,?,?)')
      .run(scope, token, process.pid, JSON.stringify(context), now, now);
    if (!result.changes) {
      const owner: any = db.prepare('SELECT * FROM execution_reservations WHERE scope=?').get(scope);
      if (!owner) {
        return this.acquire(scope, context);
      }
      let alive = true;
      try { process.kill(owner.owner_pid, 0); } catch (err: any) { if (err.code === 'ESRCH') alive = false; }

      const updatedOrCreated = owner.updated_at || owner.created_at;
      const ageMs = updatedOrCreated ? (Date.now() - new Date(updatedOrCreated).getTime()) : Infinity;
      const isTtlExpired = ageMs > this.DEFAULT_TTL_MS;

      let isRunInactive = false;
      let isSameRun = false;
      let isMalformedContext = false;
      try {
        const ctx = JSON.parse(owner.context_json || '{}');
        if (ctx && typeof ctx === 'object' && ctx.runId) {
          const run: any = db.prepare('SELECT status FROM autonomous_runs WHERE id = ?').get(ctx.runId);
          if (run && ['completed', 'failed', 'paused', 'cancelled', 'stopped', 'error'].includes(run.status)) {
            isRunInactive = true;
          }
          if (context?.runId && ctx.runId === context.runId) {
            isSameRun = true;
          }
        }
      } catch {
        isMalformedContext = true;
      }

      if (!alive || isTtlExpired || isRunInactive || isSameRun || isMalformedContext) {
        const reason = !alive
          ? `processo finalizado (PID ${owner.owner_pid})`
          : isTtlExpired
          ? `TTL expirado (${Math.round(ageMs / 1000)}s sem renovação)`
          : isSameRun
          ? `mesmo run (${context.runId}) renovando reserva`
          : isMalformedContext
          ? `contexto JSON malformado recuperado`
          : `run associado inativo ou finalizado`;

        db.prepare('DELETE FROM execution_reservations WHERE scope=?').run(scope);

        try {
          ObservabilityService.emit({
            level: 'WARN',
            event: 'reservation.orphaned_cleared',
            message: `Reserva órfã (${reason}) limpa automaticamente para escopo "${scope}"`,
            service: 'coordinator',
            runId: context?.runId,
            taskId: context?.taskId,
            projectId: context?.projectId,
            metadata: { scope, deadPid: owner.owner_pid, reason, priorContext: owner?.context_json }
          });
        } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "executionCoordinator",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:executionCoordinator]", err);
      }
    }

        const retryResult = db.prepare('INSERT OR IGNORE INTO execution_reservations (scope,token,owner_pid,context_json,created_at,updated_at) VALUES (?,?,?,?,?,?)')
          .run(scope, token, process.pid, JSON.stringify(context), now, now);
        if (retryResult.changes) {
          try {
            ObservabilityService.emit({
              level: 'INFO',
              event: 'reservation.acquired',
              message: `Reserva de execução adquirida para escopo "${scope}" após recuperação de reserva órfã (${reason})`,
              service: 'coordinator',
              runId: context?.runId,
              taskId: context?.taskId,
              projectId: context?.projectId,
              metadata: { scope, token, ownerPid: process.pid, context }
            });
          } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "executionCoordinator",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:executionCoordinator]", err);
      }
    }
          return token;
        }
      }

      throw new Error(`EXECUTION_BUSY: operação reservada em ${scope}; reconciliar antes de repetir (${owner?.context_json}).`);
    }

    try {
      ObservabilityService.emit({
        level: 'INFO',
        event: 'reservation.acquired',
        message: `Reserva de execução adquirida para escopo "${scope}"`,
        service: 'coordinator',
        runId: context?.runId,
        taskId: context?.taskId,
        projectId: context?.projectId,
        metadata: { scope, token, ownerPid: process.pid, context }
      });
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "executionCoordinator",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:executionCoordinator]", err);
      }
    }

    return token;
  }

  static touch(scope: string, token?: string, context?: Record<string, any> | string): void {
    const nowIso = new Date().toISOString();
    try {
      let serializedContext: string | null = null;
      if (context !== undefined && context !== null) {
        if (typeof context === 'string') {
          try {
            JSON.parse(context);
            serializedContext = context;
          } catch {
            serializedContext = JSON.stringify({ raw: context });
          }
        } else {
          try {
            serializedContext = JSON.stringify(context);
          } catch {
            serializedContext = '{}';
          }
        }
      }

      if (token) {
        if (serializedContext !== null) {
          db.prepare('UPDATE execution_reservations SET updated_at = ?, context_json = ? WHERE scope = ? AND token = ?')
            .run(nowIso, serializedContext, scope, token);
        } else {
          db.prepare('UPDATE execution_reservations SET updated_at = ? WHERE scope = ? AND token = ?')
            .run(nowIso, scope, token);
        }
      } else {
        if (serializedContext !== null) {
          db.prepare('UPDATE execution_reservations SET updated_at = ?, context_json = ? WHERE scope = ?')
            .run(nowIso, serializedContext, scope);
        } else {
          db.prepare('UPDATE execution_reservations SET updated_at = ? WHERE scope = ?')
            .run(nowIso, scope);
        }
      }
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "executionCoordinator",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:executionCoordinator]", err);
      }
    }
  }

  static release(scope: string, token: string): void {
    db.prepare('DELETE FROM execution_reservations WHERE scope=? AND token=?').run(scope, token);

    try {
      ObservabilityService.emit({
        level: 'INFO',
        event: 'reservation.released',
        message: `Reserva de execução liberada para escopo "${scope}"`,
        service: 'coordinator',
        metadata: { scope, token }
      });
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "executionCoordinator",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:executionCoordinator]", err);
      }
    }
  }

  /**
   * Safely releases any reservation matching a scope or context filters (projectId, runId).
   */
  static releaseByContext(filter: { projectId?: string; runId?: string; scope?: string }): number {
    let cleared = 0;
    try {
      const all: any[] = db.prepare('SELECT scope, token, context_json FROM execution_reservations').all();
      for (const res of all) {
        let match = false;
        if (filter.scope && res.scope === filter.scope) match = true;
        if (!match && (filter.projectId || filter.runId)) {
          try {
            const ctx = JSON.parse(res.context_json || '{}');
            if (filter.projectId && ctx.projectId === filter.projectId) match = true;
            if (filter.runId && ctx.runId === filter.runId) match = true;
          } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "executionCoordinator",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:executionCoordinator]", err);
      }
    }
        }
        if (match) {
          db.prepare('DELETE FROM execution_reservations WHERE scope=? AND token=?').run(res.scope, res.token);
          cleared++;
        }
      }
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "executionCoordinator",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:executionCoordinator]", err);
      }
    }
    return cleared;
  }

  /**
   * Forcing clean de reservas órfãs e estagnadas com escopo opcional e inclusão de global.
   */
  static forceClean(options?: { scope?: string; maxAgeMs?: number; includeGlobal?: boolean }): number {
    const maxAge = options?.maxAgeMs ?? this.DEFAULT_TTL_MS;
    const cutoffIso = new Date(Date.now() - maxAge).toISOString();
    let query = `
      DELETE FROM execution_reservations
      WHERE COALESCE(updated_at, created_at) < ?
    `;
    const params: any[] = [cutoffIso];

    if (options?.includeGlobal) {
      query += ` OR scope = 'global-agent-execution'`;
    }
    if (options?.scope) {
      query += ` OR scope = ?`;
      params.push(options.scope);
    }

    const res = db.prepare(query).run(...params);
    const deadPidsSwept = this.reconcileDeadReservations(options?.scope);
    return Number(res.changes) + deadPidsSwept;
  }

  /**
   * Reconciles and sweeps reservations held by dead processes or expired TTL across all scopes.
   * Safe to invoke on runner startup, watchdog, and recovery passes.
   */
  static reconcileDeadReservations(scope?: string): number {
    const reservations: any[] = scope
      ? db.prepare('SELECT * FROM execution_reservations WHERE scope=?').all(scope)
      : db.prepare('SELECT * FROM execution_reservations').all();

    let cleared = 0;
    for (const res of reservations) {
      let alive = true;
      try {
        process.kill(res.owner_pid, 0);
      } catch (err: any) {
        if (err.code === 'ESRCH') alive = false;
      }

      const updatedOrCreated = res.updated_at || res.created_at;
      const ageMs = updatedOrCreated ? (Date.now() - new Date(updatedOrCreated).getTime()) : Infinity;
      const isTtlExpired = ageMs > this.DEFAULT_TTL_MS;

      let isRunInactive = false;
      let isMalformedContext = false;
      try {
        if (res.context_json) {
          const ctx = JSON.parse(res.context_json);
          if (ctx && typeof ctx === 'object' && ctx.runId) {
            const run: any = db.prepare('SELECT status FROM autonomous_runs WHERE id = ?').get(ctx.runId);
            if (!run || ['completed', 'failed', 'paused', 'cancelled', 'stopped', 'error'].includes(run.status)) {
              isRunInactive = true;
            }
          }
        }
      } catch {
        isMalformedContext = true;
      }

      if (!alive || isTtlExpired || isRunInactive || isMalformedContext) {
        db.prepare('DELETE FROM execution_reservations WHERE scope=? AND token=?').run(res.scope, res.token);
        cleared++;
        try {
          ObservabilityService.emit({
            level: 'WARN',
            event: 'reservation.orphaned_cleared',
            message: `Reserva órfã varrida para escopo "${res.scope}" (PID morto: ${!alive}, TTL expirado: ${isTtlExpired}, Inativo: ${isRunInactive}, Contexto Malformado: ${isMalformedContext})`,
            service: 'coordinator',
            metadata: { scope: res.scope, deadPid: res.owner_pid, token: res.token, context: res.context_json }
          });
        } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "executionCoordinator",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:executionCoordinator]", err);
      }
    }
      }
    }
    return cleared;
  }

  /**
   * Resolves tasks for a run into independent execution waves (DAG Wave Execution).
   * Tasks in Wave 0 have no dependencies; tasks in Wave 1 depend only on Wave 0, etc.
   * Within each wave, tasks are verified for file-scope isolation so they can be dispatched concurrently.
   */
  static resolveExecutableWaves(runId: string): { waveIndex: number; tasks: any[] }[] {
    const allTasks: any[] = db.prepare('SELECT * FROM autonomous_tasks WHERE run_id = ? ORDER BY order_index ASC').all(runId);
    if (!allTasks || allTasks.length === 0) return [];

    const taskById = new Map<string, any>(allTasks.map(t => [t.id, t]));
    const taskByCode = new Map<string, any>(allTasks.filter(t => t.code).map(t => [t.code, t]));

    const depthCache = new Map<string, number>();
    const getTaskDepth = (taskId: string, visiting = new Set<string>()): number => {
      if (depthCache.has(taskId)) return depthCache.get(taskId)!;
      if (visiting.has(taskId)) return 0;
      visiting.add(taskId);

      const t = taskById.get(taskId) || taskByCode.get(taskId);
      if (!t) return 0;

      let deps: string[] = [];
      try {
        if (t.dependencies_json) deps = JSON.parse(t.dependencies_json);
      } catch {}

      if (!Array.isArray(deps) || deps.length === 0) {
        depthCache.set(taskId, 0);
        return 0;
      }

      let maxDepDepth = -1;
      for (const depId of deps) {
        const depDepth = getTaskDepth(depId, new Set(visiting));
        if (depDepth > maxDepDepth) maxDepDepth = depDepth;
      }

      const depth = maxDepDepth + 1;
      depthCache.set(taskId, depth);
      return depth;
    };

    const wavesMap = new Map<number, any[]>();
    for (const t of allTasks) {
      const depth = getTaskDepth(t.id);
      if (!wavesMap.has(depth)) wavesMap.set(depth, []);
      wavesMap.get(depth)!.push(t);
    }

    const sortedWaveIndices = Array.from(wavesMap.keys()).sort((a, b) => a - b);
    return sortedWaveIndices.map(waveIndex => ({
      waveIndex,
      tasks: wavesMap.get(waveIndex)!
    }));
  }

  /**
   * Resolves currently executable tasks in parallel (Wave Execution), ensuring:
   * 1. All dependencies are completed
   * 2. Status is ready or planned
   * 3. No two tasks in the returned batch have conflicting expected_files
   */
  static resolveExecutableWaveTasks(runId: string, maxParallel = 3): any[] {
    const waves = this.resolveExecutableWaves(runId);
    const completedTasks: any[] = db.prepare("SELECT id, code FROM autonomous_tasks WHERE run_id = ? AND status IN ('completed', 'skipped')").all(runId);
    const completedSet = new Set(completedTasks.flatMap(t => [t.id, t.code].filter(Boolean)));

    const inProgressTasks: any[] = db.prepare("SELECT id, expected_files_json FROM autonomous_tasks WHERE run_id = ? AND status = 'in_progress'").all(runId);
    const activeFiles = new Set<string>();
    for (const inProg of inProgressTasks) {
      try {
        const files = JSON.parse(inProg.expected_files_json || '[]');
        if (Array.isArray(files)) files.forEach(f => activeFiles.add(String(f).toLowerCase().replace(/\\/g, '/')));
      } catch {}
    }

    const executableBatch: any[] = [];
    const batchFiles = new Set<string>(activeFiles);

    for (const wave of waves) {
      for (const task of wave.tasks) {
        if (executableBatch.length >= maxParallel) break;
        if (task.status !== 'ready' && task.status !== 'pending' && task.status !== 'planned' && task.status !== 'needs_changes') {
          continue;
        }

        let deps: string[] = [];
        try {
          if (task.dependencies_json) deps = JSON.parse(task.dependencies_json);
        } catch {}
        const allMet = deps.every(dep => completedSet.has(dep));
        if (!allMet) continue;

        let expectedFiles: string[] = [];
        try {
          if (task.expected_files_json) expectedFiles = JSON.parse(task.expected_files_json);
        } catch {}

        let hasConflict = false;
        for (const ef of expectedFiles) {
          const normEf = String(ef).toLowerCase().replace(/\\/g, '/');
          if (batchFiles.has(normEf)) {
            hasConflict = true;
            break;
          }
        }
        if (hasConflict) continue;

        for (const ef of expectedFiles) {
          batchFiles.add(String(ef).toLowerCase().replace(/\\/g, '/'));
        }
        executableBatch.push(task);
      }

      if (executableBatch.length > 0) break;
    }

    return executableBatch;
  }
}
