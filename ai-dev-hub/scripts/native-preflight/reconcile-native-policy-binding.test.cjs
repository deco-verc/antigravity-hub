'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite'),path=require('node:path');
const {reconcile}=require('./reconcile-native-policy-binding.cjs');
function fixture(){
  const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE native_workspace_bindings(project_id, native_project_id,account_profile_id,workspace_path,config_hash); CREATE TABLE agent_sessions(project_id,role,provider_conversation_id,status,metadata_json); CREATE TABLE autonomous_runs(id)');
  const config={projectRoot:path.resolve('C:/QA/project'),nativeProjectId:'native',binding:{projectId:'qa',accountProfileId:'account'}};
  db.prepare('INSERT INTO native_workspace_bindings VALUES(?,?,?,?,?)').run('qa','native','account',config.projectRoot,'original-safe-proof');
  const creations=['SUPERVISOR','WORKER'].map((role,i)=>({role,model:i?'flash':'pro',status:'CONFIRMED',conversation_id:'existing-'+i}));
  for(const c of creations)db.prepare('INSERT INTO agent_sessions VALUES(?,?,?,?,?)').run('qa',c.role,c.conversation_id,'ACTIVE',JSON.stringify({accountProfileId:'account',model:c.model,nativeProjectId:'native'}));
  const evidence={at:new Date().toISOString(),legacyPid19248Alive:false,decohubProcesses:[],runtime:{pid:1},production:{activeLeases:0,activeWorkers:0},ledger:{control:{halt_reason:null},activeCalls:[],backendLeases:[],creations,sends:[{status:'CONFIRMED'},{status:'CONFIRMED'},{status:'CONFIRMED'}]},nativeNormalFlowRows:{runs:0,tasks:0},transcripts:[{done:true,pendingTools:[]},{done:true,pendingTools:[]}]};
  const native={id:'native',projectResources:{resources:[{gitFolder:{folderUri:require('node:url').pathToFileURL(config.projectRoot).href}}]},settings:{fileAccessPolicy:'AGENT_SETTING_POLICY_DENY',autoExecutionPolicy:'CASCADE_COMMANDS_AUTO_EXECUTION_OFF'},permissionGrants:{permissionGrants:{deny:['command(*)','mcp(*)']}}};
  return {db,config,evidence,native};
}
test('policy proof refresh preserves exactly the existing two sessions and accounts/models',()=>{
  const f=fixture(),sessions=f.db.prepare('SELECT * FROM agent_sessions').all();
  const r=reconcile(f.db,f.config,f.evidence,f.native,Buffer.from(JSON.stringify(f.native)));
  assert.equal(r.sessionsPreserved,true);assert.equal(r.providerSettingsChanged,false);assert.equal(r.additionalCalls,0);assert.deepEqual(f.db.prepare('SELECT * FROM agent_sessions').all(),sessions);assert.notEqual(r.currentHash,r.previousHash);f.db.close();
});
test('unsafe policies, pending tools, active calls, changed native ID and stale evidence cannot reconcile',()=>{
  for(const change of [f=>f.native.settings.fileAccessPolicy='ALLOW',f=>f.native.permissionGrants.permissionGrants.deny=[],f=>f.evidence.transcripts[0].done=false,f=>f.evidence.ledger.activeCalls.push({}),f=>f.native.id='other',f=>f.evidence.at='2000-01-01T00:00:00Z',f=>f.db.exec('INSERT INTO autonomous_runs VALUES(1)')]){
    const f=fixture();change(f);assert.throws(()=>reconcile(f.db,f.config,f.evidence,f.native,Buffer.from(JSON.stringify(f.native))));assert.equal(f.db.prepare('SELECT config_hash FROM native_workspace_bindings').get().config_hash,'original-safe-proof');f.db.close();
  }
});
