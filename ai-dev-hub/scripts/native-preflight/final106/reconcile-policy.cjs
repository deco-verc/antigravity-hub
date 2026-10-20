'use strict';
// Refresh sandbox proof only after official settings are actually persisted.
// Provider settings, physical reservations and session metadata remain untouched.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {assertQaProjectPolicy}=require('./verification-tool.cjs');
function reconcile(config){
  const file=path.join(config.nativeUserProfile,'.gemini/config/projects',config.nativeProjectId+'.json'),raw=fs.readFileSync(file),native=JSON.parse(raw);
  const effectivePolicy=assertQaProjectPolicy(native,config);assert.equal(native.id,config.nativeProjectId);
  assert.equal(native.projectResources?.resources.length,1);
  const folder=require('node:url').fileURLToPath(native.projectResources.resources[0].gitFolder?.folderUri||native.projectResources.resources[0].localFolder?.folderUri);
  assert.equal(path.resolve(folder).toLowerCase(),path.resolve(config.projectRoot).toLowerCase());
  assert.equal(fs.existsSync(path.join(config.controlRoot,'live-approval.json')),false);
  const processSnapshot=JSON.parse(cp.execFileSync('powershell.exe',['-NoProfile','-File',path.join(config.root,'guard/runtime-evidence.ps1')],{encoding:'utf8',windowsHide:true}));
  assert.ok(!processSnapshot.some(p=>p.name.toLowerCase()==='decohub.exe'));
  assert.ok(require('../runtime.cjs').selectRuntime(config.accountEnvironmentPath,config.defaultAccountDataPath,processSnapshot));
  assert.equal(require('../legacy-controller.cjs').inspectLegacyController(config.productionDb,processSnapshot).safe,true);
  const control=new DatabaseSync(path.join(config.controlRoot,'control.sqlite'),{readOnly:true});
  try{
    assert.equal(control.prepare('SELECT COUNT(*) n FROM creations').get().n,2);assert.equal(control.prepare('SELECT COUNT(*) n FROM sends').get().n,config.normalFlow.baselineSends);
    assert.equal(control.prepare('SELECT COUNT(*) n FROM active_call').get().n,0);assert.equal(control.prepare('SELECT COUNT(*) n FROM backend_lease').get().n,0);
    assert.equal(control.prepare('SELECT halt_reason FROM control').get().halt_reason,null);
    const sessions=control.prepare('SELECT role,conversation_id,status,model FROM creations').all();
    for(const session of sessions){
      assert.equal(session.status,'CONFIRMED');assert.equal(session.conversation_id,config.normalFlow.ids[session.role]);
      const transcript=path.join(config.nativeUserProfile,'.gemini/antigravity/brain',session.conversation_id,'.system_generated/logs/transcript.jsonl');
      const rows=fs.readFileSync(transcript,'utf8').trim().split(/\r?\n/);const last=JSON.parse(rows.at(-1));assert.equal(last.type,'PLANNER_RESPONSE');assert.equal(last.status,'DONE');assert.ok(last.content&&!last.tool_calls?.length);
    }
  }finally{control.close();}
  // Persist the user's DecoHUB choice through the product service, not by editing
  // official metadata. The service refuses any active/ambiguous native operation.
  process.env.AI_DEV_HUB_DATA_DIR=config.dataRoot;
  const productDb=require(path.join(config.packagedServer,'db.js')).db;
  const {NativeExecutionPolicy}=require(path.join(config.packagedServer,'nativeExecutionPolicy.js'));
  NativeExecutionPolicy.configure(config.binding.projectId,config.executionPolicy||{mode:'restricted'});
  productDb.close();
  const data=new DatabaseSync(path.join(config.dataRoot,'hub.db'));
  data.exec('BEGIN IMMEDIATE');
  try{
    assert.equal(data.prepare('SELECT COUNT(*) n FROM autonomous_runs').get().n,0);
    const sessions=data.prepare('SELECT * FROM agent_sessions ORDER BY role').all();assert.equal(sessions.length,2);
    for(const session of sessions){const m=JSON.parse(session.metadata_json);assert.equal(session.provider_conversation_id,config.normalFlow.ids[session.role]);assert.equal(session.status,'ACTIVE');assert.equal(m.accountProfileId,config.binding.accountProfileId);assert.equal(m.nativeProjectId,native.id);assert.equal(m.model,config.binding.models[session.role]);}
    const binding=data.prepare('SELECT * FROM native_workspace_bindings WHERE project_id=?').get(config.binding.projectId);assert.equal(binding.native_project_id,native.id);
    const hash=crypto.createHash('sha256').update(raw).digest('hex');
    data.prepare('UPDATE native_workspace_bindings SET config_hash=? WHERE project_id=? AND config_hash=?').run(hash,config.binding.projectId,binding.config_hash);
    data.prepare('UPDATE projects SET active_account_profile_id=? WHERE id=?').run(config.binding.accountProfileId,config.binding.projectId);
    assert.deepEqual(data.prepare('SELECT * FROM agent_sessions ORDER BY role').all(),sessions);
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),hash);
    const receipt={at:new Date().toISOString(),previousProof:binding.config_hash,currentProof:hash,effectivePolicy,providerConfigurationChanged:false,sessionsPreserved:true,accountSelected:config.binding.accountProfileId,authenticationClaimed:false,physicalCount:2,newSends:0};
    fs.appendFileSync(path.join(config.controlRoot,'native106-policy-reconciliation.jsonl'),JSON.stringify({phase:'PREPARED',...receipt})+'\n');data.exec('COMMIT');
    fs.appendFileSync(path.join(config.controlRoot,'native106-policy-reconciliation.jsonl'),JSON.stringify({phase:'COMMITTED',...receipt})+'\n');return receipt;
  }catch(error){data.exec('ROLLBACK');throw error;}finally{data.close();}
}
module.exports={reconcile};
if(require.main===module)console.log(JSON.stringify(reconcile(JSON.parse(fs.readFileSync('C:/IA/DecoHUB-native-sandbox-20261009/control/native-normal-1.0.6.json')))));
