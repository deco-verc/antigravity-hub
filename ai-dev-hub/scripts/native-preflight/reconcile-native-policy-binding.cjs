'use strict';
// Reconcile ONLY the sandbox's cached proof after an official UI policy update.
// Never writes Antigravity settings or changes conversations, account/model or cap.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite');
const {assertQaProjectPolicy}=require('./qa-verification-bridge.cjs');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function reconcile(data,config,evidence,native,raw){
  assertQaProjectPolicy(native);
  assert.ok(Date.now()-Date.parse(evidence.at)<60000&&Date.parse(evidence.at)<=Date.now(),'Fresh evidence required');
  assert.equal(evidence.legacyPid19248Alive,false);assert.equal(evidence.decohubProcesses.length,0);assert.ok(evidence.runtime);
  assert.equal(evidence.production.activeLeases,0);assert.equal(evidence.production.activeWorkers,0);
  assert.equal(evidence.ledger.activeCalls.length,0);assert.equal(evidence.ledger.backendLeases.length,0);assert.equal(evidence.ledger.control.halt_reason,null);
  assert.equal(evidence.ledger.creations.length,2);assert.ok(evidence.ledger.creations.every(c=>c.status==='CONFIRMED'));
  assert.equal(evidence.ledger.sends.length,3);assert.ok(evidence.ledger.sends.every(s=>s.status==='CONFIRMED'));
  assert.equal(evidence.nativeNormalFlowRows.runs,0);assert.equal(evidence.nativeNormalFlowRows.tasks,0);
  assert.equal(evidence.transcripts.length,2);assert.ok(evidence.transcripts.every(t=>t.done&&t.pendingTools.length===0));
  assert.equal(native.id,config.nativeProjectId);
  const resources=native.projectResources?.resources;assert.equal(resources?.length,1);
  const folder=require('node:url').fileURLToPath(resources[0].gitFolder?.folderUri||resources[0].localFolder?.folderUri);
  assert.equal(path.resolve(folder).toLowerCase(),path.resolve(config.projectRoot).toLowerCase());
  const binding=data.prepare('SELECT * FROM native_workspace_bindings WHERE project_id=?').get(config.binding.projectId);
  assert.ok(binding);assert.equal(binding.native_project_id,native.id);assert.equal(binding.account_profile_id,config.binding.accountProfileId);
  assert.equal(binding.workspace_path.toLowerCase(),path.resolve(config.projectRoot).toLowerCase());
  const sessions=data.prepare('SELECT * FROM agent_sessions ORDER BY role').all();assert.equal(sessions.length,2);
  for(const session of sessions){
    const metadata=JSON.parse(session.metadata_json||'{}'),creation=evidence.ledger.creations.find(c=>c.role===session.role);
    assert.equal(session.project_id,config.binding.projectId);assert.equal(session.provider_conversation_id,creation.conversation_id);assert.equal(session.status,'ACTIVE');
    assert.equal(metadata.accountProfileId,config.binding.accountProfileId);assert.equal(metadata.model,creation.model);assert.equal(metadata.nativeProjectId,native.id);
  }
  assert.equal(data.prepare('SELECT COUNT(*) n FROM autonomous_runs').get().n,0);
  const nextHash=hash(raw);
  data.prepare('UPDATE native_workspace_bindings SET config_hash=? WHERE project_id=? AND config_hash=?').run(nextHash,config.binding.projectId,binding.config_hash);
  assert.deepEqual(data.prepare('SELECT * FROM agent_sessions ORDER BY role').all(),sessions);
  return {previousHash:binding.config_hash,currentHash:nextHash,unchanged:binding.config_hash===nextHash,nativeProjectId:native.id,physicalCreations:2,additionalCalls:0,sessionsPreserved:true,providerSettingsChanged:false};
}
module.exports={reconcile};
if(require.main===module){
  const root='C:/IA/DecoHUB-native-sandbox-20261009',config=JSON.parse(fs.readFileSync(path.join(root,'control/native-normal-1.0.5.json'),'utf8'));
  const file=path.join('C:/Users/Deco/.gemini/config/projects',config.nativeProjectId+'.json'),raw=fs.readFileSync(file),native=JSON.parse(raw);
  // Refuse unsafe official settings before opening the sandbox DB for writing.
  assertQaProjectPolicy(native);assert.equal(fs.existsSync(path.join(config.controlRoot,'live-approval.json')),false);
  const evidence=JSON.parse(fs.readFileSync(path.join(root,'logs/full-system-qa/final-readonly-evidence.json'),'utf8'));
  for(const t of evidence.transcripts){const rows=fs.readFileSync(path.join('C:/Users/Deco/.gemini/antigravity/brain',t.id,'.system_generated/logs/transcript.jsonl'),'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse);const last=rows.at(-1);assert.equal(last.step_index,t.lastStep);assert.equal(last.type,'PLANNER_RESPONSE');assert.equal(last.status,'DONE');assert.ok(last.content&&!last.tool_calls?.length);}
  const data=new DatabaseSync(path.join(config.dataRoot,'hub.db'));data.exec('BEGIN IMMEDIATE');
  try{
    const result=reconcile(data,config,evidence,native,raw);assert.equal(hash(fs.readFileSync(file)),hash(raw),'Native settings changed during reconciliation');
    fs.appendFileSync(path.join(config.controlRoot,'policy-reconciliation.jsonl'),JSON.stringify({at:new Date().toISOString(),phase:'PREPARED',scope:'Prepared sandbox only',...result})+'\n');
    data.exec('COMMIT');fs.appendFileSync(path.join(config.controlRoot,'policy-reconciliation.jsonl'),JSON.stringify({at:new Date().toISOString(),phase:'COMMITTED',...result})+'\n');console.log(JSON.stringify(result));
  }catch(e){data.exec('ROLLBACK');throw e;}finally{data.close();}
}
