'use strict';
const {DatabaseSync}=require('node:sqlite');
// Running rows are history, not process ownership. Active owners must be absent or explicitly stopped.
function inspectLegacyController(dbPath,processes,now=Date.now()) {
  const db=new DatabaseSync(dbPath,{readOnly:true});
  try {
    const runners=db.prepare("SELECT runner_id,status,last_heartbeat,json_extract(metadata_json,'$.pid') pid FROM runner_heartbeats").all();
    const activeWorkers=db.prepare("SELECT COUNT(*) n FROM workers WHERE status='WORKING' OR current_run_id IS NOT NULL").get().n;
    const leases=db.prepare("SELECT COUNT(*) n FROM worker_leases WHERE status='active'").get().n;
    const selfRuns=db.prepare("SELECT COUNT(*) n FROM self_improvement_runs WHERE status NOT IN ('COMPLETED','CANCELLED','STOPPED','FAILED')").get().n;
    const owners=runners.map(r=>{
      const process=processes.find(p=>p.pid===r.pid);
      const sameProcess=Boolean(process && process.name.toLowerCase()==='decohub.exe' && Date.parse(process.started)<=Date.parse(r.last_heartbeat));
      return {...r,processPresent:sameProcess,stopped: r.status==='stopped' && sameProcess,active:sameProcess && r.status!=='stopped'};
    });
    const safe=!activeWorkers && !leases && !selfRuns && !owners.some(r=>r.active);
    return {safe,activeWorkers,leases,selfRuns,runners:owners,historicalRunning:db.prepare("SELECT COUNT(*) n FROM autonomous_runs WHERE status='running'").get().n,readOnly:true};
  } finally {db.close();}
}
module.exports={inspectLegacyController};
