import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {db} from '../src/db.js';
import {NativeWorkspaceBinding} from '../src/nativeWorkspaceBinding.js';
import {ModelRegistry} from '../src/modelRegistry.js';
import {randomUUID} from 'node:crypto';
import {NativeExecutionPolicy,assertNativeExecutionPolicy,NativeExecutionChoice} from '../src/nativeExecutionPolicy.js';

function fixture(){
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'decohub-native-binding-'));const folder=path.join(home,'project');fs.mkdirSync(folder);
  const configs=path.join(home,'.gemini/config/projects');fs.mkdirSync(configs,{recursive:true});
  const id=randomUUID();const file=path.join(configs,id+'.json');
  const config={id,projectResources:{resources:[{gitFolder:{folderUri:pathToFileURL(folder).href}}]},settings:{fileAccessPolicy:'AGENT_SETTING_POLICY_DENY',autoExecutionPolicy:'CASCADE_COMMANDS_AUTO_EXECUTION_OFF'}};
  fs.writeFileSync(file,JSON.stringify(config));const hubId='hub-'+id,now=new Date().toISOString();
  db.prepare('INSERT INTO projects(id,name,path,created_at,updated_at) VALUES(?,?,?,?,?)').run(hubId,hubId,folder,now,now);
  return {home,folder,file,config,record:{projectId:hubId,accountProfileId:'profile-1',nativeProjectId:id,userProfileDir:home,workspacePath:folder}};
}
test('native project association derives folder from provider configuration, independently of prompt/cwd',()=>{
  const f=fixture();const record=NativeWorkspaceBinding.bind(f.record);assert.equal(record.nativeProjectId,f.config.id);
  assert.equal(NativeWorkspaceBinding.assertEnvironment(f.record.projectId,{USERPROFILE:f.home,ANTIGRAVITY_PROJECT_ID:f.config.id}).configHash,record.configHash);
  assert.throws(()=>NativeWorkspaceBinding.assertEnvironment(f.record.projectId,{USERPROFILE:f.home,ANTIGRAVITY_PROJECT_ID:'outside-of-project'}),/ENVIRONMENT_MISMATCH/);
});
test('missing, standalone, additional folders and wrong folder are rejected before external execution',()=>{
  const f=fixture();assert.throws(()=>NativeWorkspaceBinding.inspect(f.home,'outside-of-project',f.folder),/PROJECT_REQUIRED/);
  assert.throws(()=>NativeWorkspaceBinding.inspect(f.home,'absent',f.folder),/NOT_FOUND/);
  f.config.projectResources.resources.push({gitFolder:{folderUri:pathToFileURL(f.home).href}});fs.writeFileSync(f.file,JSON.stringify(f.config));assert.throws(()=>NativeWorkspaceBinding.bind(f.record),/SINGLE_FOLDER/);
  f.config.projectResources.resources=f.config.projectResources.resources.slice(1);fs.writeFileSync(f.file,JSON.stringify(f.config));assert.throws(()=>NativeWorkspaceBinding.bind(f.record),/FOLDER_MISMATCH/);
});
test('outside write access, eager commands and changed configuration block binding/reuse',()=>{
  const f=fixture();f.config.settings.fileAccessPolicy='AGENT_SETTING_POLICY_ALLOW';fs.writeFileSync(f.file,JSON.stringify(f.config));assert.throws(()=>NativeWorkspaceBinding.bind(f.record),/OUTSIDE_ACCESS/);
  f.config.settings.fileAccessPolicy='AGENT_SETTING_POLICY_DENY';f.config.settings.autoExecutionPolicy='CASCADE_COMMANDS_AUTO_EXECUTION_EAGER';fs.writeFileSync(f.file,JSON.stringify(f.config));assert.throws(()=>NativeWorkspaceBinding.bind(f.record),/COMMAND_REVIEW/);
  f.config.settings.autoExecutionPolicy='CASCADE_COMMANDS_AUTO_EXECUTION_OFF';fs.writeFileSync(f.file,JSON.stringify(f.config));NativeWorkspaceBinding.bind(f.record);
  fs.appendFileSync(f.file,'\n');assert.throws(()=>NativeWorkspaceBinding.get(f.record.projectId),/CONFIGURATION_CHANGED/);
});
test('another account cannot reuse a native folder binding',()=>{
  const f=fixture();NativeWorkspaceBinding.bind(f.record);assert.throws(()=>NativeWorkspaceBinding.get(f.record.projectId,'profile-2'),/ACCOUNT_MISMATCH/);
  assert.throws(()=>NativeWorkspaceBinding.assertEnvironment(f.record.projectId,{USERPROFILE:path.dirname(f.home),ANTIGRAVITY_PROJECT_ID:f.config.id}),/ENVIRONMENT_MISMATCH/);
});
test('official project metadata resolves automatically only with a unique exact safe folder',()=>{
  const f=fixture();assert.equal(NativeWorkspaceBinding.resolve(f.record.projectId,'profile-1',f.home).nativeProjectId,f.config.id);
  const g=fixture();const second={...g.config,id:randomUUID()};fs.writeFileSync(path.join(path.dirname(g.file),second.id+'.json'),JSON.stringify(second));
  assert.throws(()=>NativeWorkspaceBinding.resolve(g.record.projectId,'profile-1',g.home),/PROJECT_AMBIGUOUS/);
});
test('model discovery declares tier scope, never verified exact variant or account quota',()=>{
  for(const m of ModelRegistry.discoverModels()){assert.equal(m.selectionScope,'TIER');assert.equal(m.exactVariant,null);assert.equal(m.accountAvailabilityVerified,false);}
  assert.throws(()=>ModelRegistry.resolveModel({preference:'gemini-3.8-flash-high' as any}),/MODEL_UNAVAILABLE/);
});

const permissive:NativeExecutionChoice={mode:'permissive',acknowledgement:{userConsent:'Explicit project choice from user: accept ALLOW/EAGER',outsideAccessAllowed:true,automaticCommandsAllowed:true,noFilesystemIsolation:true}};
function allowEager(f:ReturnType<typeof fixture>){
  f.config.settings={fileAccessPolicy:'AGENT_SETTING_POLICY_ALLOW',autoExecutionPolicy:'CASCADE_COMMANDS_AUTO_EXECUTION_EAGER'};
  fs.writeFileSync(f.file,JSON.stringify(f.config));
}
test('permissive mode requires explicit acknowledgement; full autonomy cannot opt in implicitly',()=>{
  const f=fixture();allowEager(f);
  db.prepare('UPDATE projects SET full_dev_autonomy=1 WHERE id=?').run(f.record.projectId);
  assert.deepEqual(NativeExecutionPolicy.get(f.record.projectId),{mode:'restricted'});
  assert.throws(()=>NativeWorkspaceBinding.bind(f.record),/OUTSIDE_ACCESS/);
  for(const acknowledgement of [undefined,{}, {...permissive.acknowledgement,userConsent:''},{...permissive.acknowledgement,noFilesystemIsolation:false}]){
    assert.throws(()=>NativeExecutionPolicy.configure(f.record.projectId,{mode:'permissive',acknowledgement} as any),/EXPLICIT_ACKNOWLEDGEMENT/);
  }
  assert.throws(()=>NativeExecutionPolicy.configure(f.record.projectId,{mode:'auto'} as any),/MODE_INVALID/);
  assert.deepEqual(NativeExecutionPolicy.get(f.record.projectId),{mode:'restricted'});
});
test('explicit permissive choice persists, truthfully accepts official metadata and never writes it',()=>{
  const f=fixture();allowEager(f);const before=fs.readFileSync(f.file);
  NativeExecutionPolicy.configure(f.record.projectId,permissive);
  assert.deepEqual(NativeExecutionPolicy.get(f.record.projectId),permissive);
  const proof=NativeWorkspaceBinding.resolve(f.record.projectId,'profile-1',f.home);
  assert.deepEqual(proof.executionPolicy,{mode:'permissive',outsideAccessDenied:false,manualCommandReview:false,filesystemIsolation:false});
  assert.equal(NativeWorkspaceBinding.get(f.record.projectId).configHash,proof.configHash);
  assert.deepEqual(fs.readFileSync(f.file),before);
  assert.equal((db.prepare('SELECT COUNT(*) n FROM native_execution_policy_audit WHERE project_id=?').get(f.record.projectId) as any).n,1);
});
test('permissive choice does not accept mixed or unknown official policies',()=>{
  for(const settings of [undefined,{}, {fileAccessPolicy:'AGENT_SETTING_POLICY_DENY',autoExecutionPolicy:'CASCADE_COMMANDS_AUTO_EXECUTION_EAGER'}, {fileAccessPolicy:'AGENT_SETTING_POLICY_ALLOW',autoExecutionPolicy:'CASCADE_COMMANDS_AUTO_EXECUTION_OFF'},{fileAccessPolicy:'UNKNOWN',autoExecutionPolicy:'UNKNOWN'}]){
    assert.throws(()=>assertNativeExecutionPolicy(settings,permissive),/OFFICIAL_POLICY_MISMATCH/);
  }
});
test('permissive mode preserves folder, account, environment and metadata drift protections',()=>{
  const f=fixture();allowEager(f);NativeExecutionPolicy.configure(f.record.projectId,permissive);NativeWorkspaceBinding.bind(f.record);
  assert.throws(()=>NativeWorkspaceBinding.get(f.record.projectId,'profile-2'),/ACCOUNT_MISMATCH/);
  assert.throws(()=>NativeWorkspaceBinding.assertEnvironment(f.record.projectId,{USERPROFILE:f.home,ANTIGRAVITY_PROJECT_ID:'outside-of-project'}),/ENVIRONMENT_MISMATCH/);
  f.config.projectResources.resources.push({gitFolder:{folderUri:pathToFileURL(f.home).href}});fs.writeFileSync(f.file,JSON.stringify(f.config));
  assert.throws(()=>NativeWorkspaceBinding.get(f.record.projectId),/SINGLE_FOLDER/);
  f.config.projectResources.resources=f.config.projectResources.resources.slice(1);fs.writeFileSync(f.file,JSON.stringify(f.config));
  assert.throws(()=>NativeWorkspaceBinding.get(f.record.projectId),/FOLDER_MISMATCH/);
  f.config.projectResources.resources=[{gitFolder:{folderUri:pathToFileURL(f.folder).href}}];fs.writeFileSync(f.file,JSON.stringify(f.config)+'\n');
  assert.throws(()=>NativeWorkspaceBinding.get(f.record.projectId),/CONFIGURATION_CHANGED/);
});
test('active or uncertain turns cannot change native execution policy',()=>{
  const f=fixture();
  db.prepare("INSERT INTO agent_turn_observations(conversation_id,project_path,brain_dir,baseline_lines,baseline_files_json,phase,dispatched_at) VALUES(?,?,?,0,'{}','UNCERTAIN',?)")
    .run('uncertain-'+f.config.id,f.folder,f.home,new Date().toISOString());
  assert.throws(()=>NativeExecutionPolicy.configure(f.record.projectId,permissive),/ACTIVE_OR_AMBIGUOUS/);
  assert.deepEqual(NativeExecutionPolicy.get(f.record.projectId),{mode:'restricted'});
  db.prepare('DELETE FROM agent_turn_observations WHERE conversation_id=?').run('uncertain-'+f.config.id);
  db.prepare('INSERT INTO execution_reservations(scope,token,owner_pid,context_json,created_at) VALUES(?,?,?,?,?)').run('policy-test','token',process.pid,'{}',new Date().toISOString());
  try{assert.throws(()=>NativeExecutionPolicy.configure(f.record.projectId,permissive),/ACTIVE_OR_AMBIGUOUS/);}finally{db.prepare('DELETE FROM execution_reservations WHERE scope=?').run('policy-test');}
  const now=new Date().toISOString(),runId=randomUUID();
  db.prepare("INSERT INTO autonomous_runs(id,project_id,name,objective,status,start_time,created_at,updated_at)VALUES(?,?,?,?,'paused',?,?,?)")
    .run(runId,f.record.projectId,'Existing Run','Must preserve its execution policy',now,now,now);
  assert.throws(()=>NativeExecutionPolicy.configure(f.record.projectId,permissive),/ACTIVE_OR_AMBIGUOUS/);
  assert.equal((db.prepare('SELECT status FROM autonomous_runs WHERE id=?').get(runId) as any).status,'paused');
  db.prepare('DELETE FROM autonomous_runs WHERE id=?').run(runId);
});
test('existing native sessions cannot be rebound to another account even in permissive mode',()=>{
  const f=fixture();allowEager(f);NativeExecutionPolicy.configure(f.record.projectId,permissive);NativeWorkspaceBinding.bind(f.record);
  const now=new Date().toISOString();
  db.prepare(`INSERT INTO agent_sessions(id,project_id,role,logical_conversation_id,provider_conversation_id,generation,status,created_at,last_used_at,metadata_json)
    VALUES(?,?,'WORKER',?,?,1,'ACTIVE',?,?,'{}')`).run('session-'+f.config.id,f.record.projectId,'logical-'+f.config.id,'native-'+f.config.id,now,now);
  const before=db.prepare('SELECT * FROM agent_sessions WHERE project_id=?').all(f.record.projectId);
  assert.throws(()=>NativeWorkspaceBinding.bind({...f.record,accountProfileId:'profile-2'}),/SESSION_RECONCILIATION/);
  assert.deepEqual(db.prepare('SELECT * FROM agent_sessions WHERE project_id=?').all(f.record.projectId),before);
  assert.equal(NativeWorkspaceBinding.get(f.record.projectId).accountProfileId,'profile-1');
});
test('permissive mode cannot relax the independent local executor',()=>{
  const f=fixture();NativeExecutionPolicy.configure(f.record.projectId,permissive);
  const {executeVerification}=require('../src/controlledVerification.js');
  assert.throws(()=>executeVerification('npm test && whoami',f.folder,1000),/COMMAND_REVIEW_REQUIRED|allowlist|blocked|not allowed|UNSUPPORTED/i);
});
