'use strict';
// Read-only prerequisite for the user's conditional scheduler-stop authorization.
// No POST, provider call, authentication material, or production mutation is performed.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const {DatabaseSync}=require('node:sqlite');
const root='C:\\IA\\DecoHUB-native-sandbox-20261009';
const config=JSON.parse(fs.readFileSync(path.join(root,'sandbox.json'),'utf8'));
async function main(){
  const processes=JSON.parse(cp.execFileSync('powershell.exe',['-NoProfile','-File',path.join(__dirname,'runtime-evidence.ps1')],{encoding:'utf8',timeout:10000,windowsHide:true}));
  const response=await fetch('http://127.0.0.1:3001/api/autonomous/runner/status',{signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error('RUNNER_STATUS_UNAVAILABLE');
  const status=await response.json();
  const db=new DatabaseSync(config.productionDb,{readOnly:true});
  const heartbeat=db.prepare("SELECT runner_id,status,last_heartbeat,active_run_id,current_task,current_worker,json_extract(metadata_json,'$.pid') pid FROM runner_heartbeats WHERE runner_id=?").get(status.runnerId);
  const workers=db.prepare("SELECT id,status,pid,current_run_id,current_task_id FROM workers WHERE status='WORKING' OR current_run_id IS NOT NULL OR current_task_id IS NOT NULL").all();
  const leases=db.prepare("SELECT id,worker_id,run_id,task_id,lease_until,last_heartbeat FROM worker_leases WHERE status='active'").all();
  const runTasks=db.prepare('SELECT id,status,updated_at FROM autonomous_tasks WHERE run_id=?').all(status.activeRunId);
  const events=db.prepare('SELECT event_type,MAX(created_at) latest,COUNT(*) count FROM autonomous_events WHERE run_id=? GROUP BY event_type').all(status.activeRunId);
  // Do not return log messages or metadata, which may contain user/provider content.
  const logs=db.prepare("SELECT level,MAX(timestamp) latest,COUNT(*) count FROM system_logs WHERE message LIKE '%Autonomous Runner%' OR message LIKE '%Supervisor%' OR message LIKE '%Worker%' GROUP BY level").all();
  const preserved={runningRuns:db.prepare("SELECT COUNT(*) n FROM autonomous_runs WHERE status='running'").get().n,runStateWritesPerformed:false,taskWritesPerformed:false,sessionWritesPerformed:false};
  db.close();
  const owner=processes.find(p=>p.pid===heartbeat?.pid && p.name.toLowerCase()==='decohub.exe');
  const phaseReported=Object.hasOwn(status,'executionPhase')||Object.hasOwn(status,'currentPhase');
  const inFlightReported=typeof status.isAgentExecuting==='boolean' && typeof status.isExecutingCycle==='boolean';
  // Absence of leases/working workers does not prove absence of a Supervisor turn.
  const noTurnConfirmed=Boolean(owner && inFlightReported && phaseReported && !status.isAgentExecuting && !status.isExecutingCycle && !workers.length && !leases.length);
  const report={at:new Date().toISOString(),conditionalStopAuthorized:true,runnerStatus:status,heartbeat,owner:owner||null,activeWorkers:workers,activeLeases:leases,referencedRunTasks:runTasks,referencedRunEvents:events,logMetadata:logs,inFlightStateExposed:inFlightReported,phaseExposed:phaseReported,noRealTurnConfirmed:noTurnConfirmed,stopEndpointCalled:false,stopDecision:noTurnConfirmed?'PREREQUISITE_CONFIRMED_REVALIDATE_AT_STOP':'BLOCKED_UNVERIFIABLE_IN_FLIGHT_STATE',preserved,credentialsRead:false,inferenceCalls:0};
  fs.writeFileSync(path.join(root,'logs','legacy-stop-prerequisite.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({decision:report.stopDecision,pid:owner?.pid,status:status.status,activeRunId:status.activeRunId,activeWorkers:workers.length,activeLeases:leases.length,runTaskCount:runTasks.length,inFlightStateExposed:inFlightReported,phaseExposed:phaseReported,stopEndpointCalled:false,preserved}));
}
main().catch(()=>{console.error('STOP_PREREQUISITE_UNAVAILABLE_NO_STOP_PERFORMED');process.exitCode=1;});
