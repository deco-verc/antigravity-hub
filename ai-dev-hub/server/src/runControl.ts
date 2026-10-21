import { db } from './db.js';

/** User control survives backend restart and is consumed only at a safe execution boundary. */
export class RunControl {
  static get(runId:string):any {return db.prepare('SELECT * FROM run_control_requests WHERE run_id=?').get(runId)||null;}
  static request(runId:string,action:'pause'|'cancel'){
    const run:any=db.prepare('SELECT status FROM autonomous_runs WHERE id=?').get(runId);
    if(!run)throw Error('RUN_NOT_FOUND');
    if(['completed','failed'].includes(run.status))return;
    if(this.get(runId)?.action==='cancel')return;
    const now=new Date().toISOString();
    db.exec('BEGIN IMMEDIATE');
    try {
    db.prepare(`INSERT INTO run_control_requests VALUES(?,?,'pending',?,NULL)
      ON CONFLICT(run_id) DO UPDATE SET action=excluded.action,status='pending',requested_at=excluded.requested_at,applied_at=NULL`).run(runId,action,now);
    db.prepare("UPDATE autonomous_runs SET status='paused',next_action=?,updated_at=? WHERE id=?").run(action==='cancel'?'Cancelamento solicitado; preservando a operação em andamento':'Pausa solicitada; preservando a operação em andamento',now,runId);
    if (action === 'cancel') {
      try {
        const projectIdRow: any = db.prepare('SELECT project_id FROM autonomous_runs WHERE id=?').get(runId);
        if (projectIdRow?.project_id) {
          db.prepare("DELETE FROM execution_reservations WHERE scope='global-agent-execution' OR scope=?").run(`run-create:${projectIdRow.project_id}`);
        }
        db.prepare("UPDATE agent_turn_observations SET phase='CONSUMED' WHERE task_id IN(SELECT id FROM autonomous_tasks WHERE run_id=?) AND phase IN ('IN_FLIGHT','UNCERTAIN')").run(runId);
        db.prepare("UPDATE worker_leases SET status='released' WHERE run_id=? AND status='active'").run(runId);
      } catch {}
    }
    db.exec('COMMIT');
    } catch(error) {db.exec('ROLLBACK');throw error;}
  }
  static apply(runId:string,atBoundary=false):boolean{
    const request=this.get(runId);if(!request)return false;
    if(request.status==='applied')return true;
    const reservation:any=db.prepare("SELECT context_json FROM execution_reservations WHERE scope='global-agent-execution' OR scope=('run-create:'||(SELECT project_id FROM autonomous_runs WHERE id=?))").get(runId);
    if(!atBoundary&&reservation)return true;
    const pending:any=db.prepare("SELECT 1 FROM agent_turn_observations WHERE task_id IN(SELECT id FROM autonomous_tasks WHERE run_id=?) AND phase IN ('IN_FLIGHT','UNCERTAIN') LIMIT 1").get(runId);
    if(pending)return true;
    const now=new Date().toISOString();db.exec('BEGIN IMMEDIATE');
    try{
      if(request.action==='cancel'){
        db.prepare("UPDATE autonomous_runs SET status='failed',last_error='RUN_CANCELLED',end_time=?,next_action='Cancelado pelo usuário; histórico e arquivos preservados',updated_at=? WHERE id=?").run(now,now,runId);
        db.prepare("UPDATE autonomous_tasks SET status='failed',updated_at=? WHERE run_id=? AND status='in_progress'").run(now,runId);
        db.prepare("UPDATE worker_leases SET status='released' WHERE run_id=? AND status='active'").run(runId);
        db.prepare("UPDATE workers SET status='READY',current_run_id=NULL,current_task_id=NULL,updated_at=? WHERE current_run_id=?").run(now,runId);
        try {
          db.prepare("DELETE FROM execution_reservations WHERE scope='global-agent-execution' OR scope LIKE 'run-create:%' OR scope LIKE 'task-exec:%'").run();
          db.prepare("UPDATE agent_turn_observations SET phase='CONSUMED' WHERE task_id IN(SELECT id FROM autonomous_tasks WHERE run_id=?) AND phase IN ('IN_FLIGHT','UNCERTAIN')").run(runId);
        } catch {}
      }else db.prepare("UPDATE autonomous_runs SET status='paused',next_action='Pausado pelo usuário; pronto para continuar do estado salvo',updated_at=? WHERE id=?").run(now,runId);
      db.prepare("UPDATE run_control_requests SET status='applied',applied_at=? WHERE run_id=?").run(now,runId);db.exec('COMMIT');return true;
    }catch(e){db.exec('ROLLBACK');throw e;}
  }
  static clearPause(runId:string):void{
    if(this.get(runId)?.action==='cancel')throw Error('RUN_CANCELLED');
    db.prepare("DELETE FROM run_control_requests WHERE run_id=? AND action='pause'").run(runId);
  }
}
