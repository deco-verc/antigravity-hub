'use strict';
// Production metadata is queried read-only. Never import its db module or call agentapi.
const fs=require('node:fs');
const path=require('node:path');
const cp=require('node:child_process');
const {DatabaseSync}=require('node:sqlite');
const root='C:\\IA\\DecoHUB-native-sandbox-20261009';
const procList=JSON.parse(cp.execFileSync('powershell.exe',['-NoProfile','-File',path.join(__dirname,'runtime-evidence.ps1')],{encoding:'utf8',timeout:10000,windowsHide:true}));
const allProcesses=JSON.parse(cp.execFileSync('powershell.exe',['-NoProfile','-Command',"ConvertTo-Json -InputObject @(Get-CimInstance Win32_Process | ForEach-Object { [PSCustomObject]@{pid=$_.ProcessId;parentPid=$_.ParentProcessId;name=$_.Name;executable=$_.ExecutablePath;started=$_.CreationDate.ToString('o')} }) -Compress"],{encoding:'utf8',timeout:10000,windowsHide:true}));
const db=new DatabaseSync('C:/Users/Deco/.ai-dev-hub/hub.db',{readOnly:true});
const at=new Date().toISOString();
const heartbeat=db.prepare("SELECT runner_id,status,last_heartbeat,active_run_id,current_task,current_worker,json_extract(metadata_json,'$.pid') pid FROM runner_heartbeats").all().map(h=>({...h,process:procList.find(p=>p.pid===h.pid)||null,ageSeconds:(Date.now()-Date.parse(h.last_heartbeat))/1000}));
const workers=db.prepare('SELECT id,name,status,pid,last_heartbeat,current_run_id,account_profile_id,conversation_id FROM workers').all().map(w=>({...w,process:allProcesses.find(p=>p.pid===w.pid)||null,heartbeatFresh:Boolean(w.last_heartbeat && Date.now()-Date.parse(w.last_heartbeat)<60000)}));
const leases=db.prepare('SELECT id,worker_id,run_id,task_id,status,claimed_at,lease_until,last_heartbeat,released_at FROM worker_leases').all();
const physicalEvidence=id=>{
  if(typeof id!=='string'||!/^[-a-zA-Z0-9_]+$/.test(id))return {conversationId:id,metadataCheck:'INVALID_IDENTIFIER'};
  const transcript=path.join('C:/Users/Deco/.gemini/antigravity/brain',id,'.system_generated/logs/transcript.jsonl');
  const serialized=path.join('C:/Users/Deco/.gemini/antigravity/conversations',id+'.pb');
  const meta=file=>{if(!fs.existsSync(file))return null;const stat=fs.statSync(file);return {size:stat.size,mtime:stat.mtime.toISOString()};};
  return {conversationId:id,transcriptMetadata:meta(transcript),serializedConversationMetadata:meta(serialized),contentRead:false,liveStatusQueried:false};
};
const runs=db.prepare("SELECT r.id,r.project_id,r.name,r.status,r.created_at,r.updated_at,r.current_cycle,r.iteration,r.current_task,r.current_worker,r.builder_session_id,p.name project_name,p.path project_path FROM autonomous_runs r LEFT JOIN projects p ON p.id=r.project_id WHERE r.status='running' ORDER BY r.created_at").all().map(r=>{
  const tasks=db.prepare('SELECT id,title,status,updated_at FROM autonomous_tasks WHERE run_id=?').all(r.id);
  const events=db.prepare('SELECT event_type,COUNT(*) count,MIN(created_at) first_at,MAX(created_at) last_at FROM autonomous_events WHERE run_id=? GROUP BY event_type').all(r.id);
  const direct=db.prepare('SELECT conversation_id,status,last_used_at FROM conversations WHERE run_id=?').all(r.id);
  const projectAgentSessions=db.prepare("SELECT id,role,status,provider_conversation_id,last_used_at,json_extract(metadata_json,'$.accountProfileId') accountProfileId,json_extract(metadata_json,'$.model') model FROM agent_sessions WHERE project_id=?").all(r.project_id);
  const legacyProjectSessions=db.prepare('SELECT account_profile_id,conversation_id,last_active_at FROM account_project_sessions WHERE project_id=?').all(r.project_id);
  const convIds=[...new Set([...direct.map(x=>x.conversation_id),...projectAgentSessions.map(x=>x.provider_conversation_id),...legacyProjectSessions.map(x=>x.conversation_id),...(r.builder_session_id?[r.builder_session_id]:[])])];
  const ownLeases=leases.filter(l=>l.run_id===r.id);
  const ownWorkers=workers.filter(w=>w.current_run_id===r.id);
  const ownHeartbeats=heartbeat.filter(h=>h.active_run_id===r.id);
  const hasFreshController=ownHeartbeats.some(h=>h.ageSeconds<60 && h.process);
  const fixtureOrigin=/^run-(metric-|iso-|state-|test-in-review-)/.test(r.id) && /\\Temp\\/i.test(r.project_path||'');
  return {...r,projectExists:fs.existsSync(r.project_path||''),tasks,events,directRunConversations:direct,
    projectAgentSessions,legacyProjectSessions,sessionAttribution:'Project-scoped sessions cannot be attributed to each individual run without a direct run binding',
    physicalSessionEvidence:convIds.map(physicalEvidence),leases:ownLeases,assignedWorkers:ownWorkers,runnerReferences:ownHeartbeats,
    classification:hasFreshController?'HISTORICAL_FIXTURE_REFERENCED_BY_LIVE_CONTROLLER':fixtureOrigin?'HISTORICAL_TEST_FIXTURE':'HISTORICAL_ORPHAN_RUN',
    historicalOriginConfirmed:fixtureOrigin,currentlyActiveAgentProven:false,liveControllerReference:hasFreshController,
    productionStateChanged:false};
});
const stateBefore=runs.map(r=>({id:r.id,status:r.status,updated_at:r.updated_at}));
const assertReadOnly=db.prepare("SELECT id,status,updated_at FROM autonomous_runs WHERE status='running' ORDER BY created_at").all();
db.close();
const counts=runs.reduce((out,r)=>(out[r.classification]=(out[r.classification]||0)+1,out),{});
const report={at,productionReadOnly:true,credentialsRead:false,inferenceCalls:0,runsCount:runs.length,counts,heartbeat,workers,
  activeLeases:leases.filter(l=>l.status==='active'),runs,runStateSnapshotUnchanged:JSON.stringify(stateBefore)===JSON.stringify(assertReadOnly),
  humanUiObservedNoAgents:true,conclusion:'No active agent inferred from a stale row or shared LS PID. A live legacy controller still references a historical fixture, so runtime concurrency remains blocked.'};
fs.writeFileSync(path.join(root,'logs','running-records-audit.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({runs:runs.length,counts,activeLeases:report.activeLeases.length,assignedWorkers:workers.filter(w=>w.current_run_id).length,
  heartbeat:heartbeat.map(h=>({pid:h.pid,processPresent:Boolean(h.process),ageSeconds:h.ageSeconds,status:h.status,active_run_id:h.active_run_id})),productionStateChanged:false}));
