import { db } from './db.js';

/** User control survives backend restart and is consumed immediately on cancel or at a safe execution boundary. */
export class RunControl {
  static get(runId: string): any {
    return db.prepare('SELECT * FROM run_control_requests WHERE run_id=?').get(runId) || null;
  }

  static request(runId: string, action: 'pause' | 'cancel') {
    const run: any = db.prepare('SELECT status, project_id FROM autonomous_runs WHERE id=?').get(runId);
    if (!run) throw Error('RUN_NOT_FOUND');
    const now = new Date().toISOString();

    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(`INSERT INTO run_control_requests VALUES(?,?,'pending',?,NULL)
        ON CONFLICT(run_id) DO UPDATE SET action=excluded.action,status='pending',requested_at=excluded.requested_at,applied_at=NULL`).run(runId, action, now);

      if (action === 'cancel') {
        // Limpa imediatamente reservas e turnos órfãos para que o cancelamento NUNCA trave
        db.prepare(`
          DELETE FROM execution_reservations
          WHERE scope = 'global-agent-execution'
             OR scope = ('run-create:' || ?)
             OR (json_valid(context_json) AND json_extract(context_json, '$.runId') = ?)
        `).run(run.project_id || '', runId);

        db.prepare(`
          UPDATE agent_turn_observations
          SET phase = 'CONSUMED'
          WHERE task_id IN (SELECT id FROM autonomous_tasks WHERE run_id = ?)
            AND phase IN ('IN_FLIGHT', 'UNCERTAIN')
        `).run(runId);
      }

      db.prepare("UPDATE autonomous_runs SET status='paused',next_action=?,updated_at=? WHERE id=?").run(
        action === 'cancel'
          ? 'Cancelamento solicitado; encerrando operação imediatamente'
          : 'Pausa solicitada; preservando a operação em andamento',
        now,
        runId
      );
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch {}
      throw error;
    }

    if (action === 'cancel') {
      this.apply(runId, true);
    }
  }

  static apply(runId: string, atBoundary = false): boolean {
    const request = this.get(runId);
    if (!request) return false;
    if (request.status === 'applied' && request.action !== 'cancel') return true;

    if (request.action !== 'cancel') {
      const reservation: any = db
        .prepare("SELECT context_json FROM execution_reservations WHERE scope='global-agent-execution' OR scope=('run-create:'||(SELECT project_id FROM autonomous_runs WHERE id=?))")
        .get(runId);
      if (!atBoundary && reservation) return true;
      const pending: any = db
        .prepare("SELECT 1 FROM agent_turn_observations WHERE task_id IN(SELECT id FROM autonomous_tasks WHERE run_id=?) AND phase IN ('IN_FLIGHT','UNCERTAIN') LIMIT 1")
        .get(runId);
      if (pending) return true;
    }

    const now = new Date().toISOString();
    db.exec('BEGIN IMMEDIATE');
    try {
      if (request.action === 'cancel') {
        db.prepare("UPDATE agent_turn_observations SET phase='CONSUMED' WHERE task_id IN (SELECT id FROM autonomous_tasks WHERE run_id=?) AND phase IN ('IN_FLIGHT','UNCERTAIN')").run(runId);
        db.prepare("DELETE FROM execution_reservations WHERE scope='global-agent-execution' OR (json_valid(context_json) AND json_extract(context_json, '$.runId') = ?)").run(runId);
        db.prepare("UPDATE autonomous_runs SET status='failed',last_error='RUN_CANCELLED',end_time=?,next_action='Cancelado pelo usuário; histórico e arquivos preservados',updated_at=? WHERE id=?").run(now, now, runId);
        db.prepare("UPDATE autonomous_tasks SET status='ready',lifecycle_state='READY',updated_at=? WHERE run_id=? AND status='in_progress'").run(now, runId);
        db.prepare("UPDATE worker_leases SET status='released',released_at=? WHERE run_id=? AND status='active'").run(now, runId);
        db.prepare("UPDATE workers SET status='READY',current_run_id=NULL,current_task_id=NULL,updated_at=? WHERE current_run_id=?").run(now, runId);
      } else {
        db.prepare("UPDATE autonomous_runs SET status='paused',next_action='Pausado pelo usuário; pronto para continuar do estado salvo',updated_at=? WHERE id=?").run(now, runId);
      }
      db.prepare("UPDATE run_control_requests SET status='applied',applied_at=? WHERE run_id=?").run(now, runId);
      db.exec('COMMIT');
      return true;
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch {}
      throw e;
    }
  }

  static clearPause(runId: string): void {
    db.prepare('DELETE FROM run_control_requests WHERE run_id=?').run(runId);
  }
}
