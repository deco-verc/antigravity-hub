'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process'),{DatabaseSync}=require('node:sqlite');
const {selectRuntime}=require('./runtime.cjs');
const root='C:/IA/DecoHUB-native-sandbox-20261009';
const cfg=JSON.parse(fs.readFileSync(path.join(root,'sandbox.json'),'utf8'));
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const processes=JSON.parse(cp.execFileSync('powershell.exe',['-NoProfile','-File',path.join(__dirname,'runtime-evidence.ps1')],{encoding:'utf8',windowsHide:true,timeout:15000}));
const control=new DatabaseSync(path.join(cfg.controlRoot,'control.sqlite'),{readOnly:true});
const ledger={control:control.prepare('SELECT * FROM control').get(),creations:control.prepare('SELECT role,operation_id,model,project_id,status,conversation_id,reserved_at FROM creations ORDER BY role').all(),sends:control.prepare('SELECT operation_id,conversation_id,status FROM sends ORDER BY operation_id').all(),continuationPolicy:control.prepare('SELECT * FROM continuation_policy').get(),activeCalls:control.prepare('SELECT * FROM active_call').all(),backendLeases:control.prepare('SELECT * FROM backend_lease').all(),triggers:control.prepare("SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name").all()};
ledger.remainingSends=ledger.continuationPolicy.baseline_sends+ledger.continuationPolicy.max_additional_sends-ledger.sends.length;control.close();
const sandbox=new DatabaseSync(path.join(cfg.dataRoot,'hub.db'),{readOnly:true});
const sessions=sandbox.prepare('SELECT role,project_id,provider_conversation_id,status,metadata_json FROM agent_sessions').all().map(row=>{const m=JSON.parse(row.metadata_json||'{}');return {role:row.role,projectId:row.project_id,id:row.provider_conversation_id,status:row.status,accountProfileId:m.accountProfileId,model:m.model,nativeProjectId:m.nativeProjectId};});
const project=sandbox.prepare('SELECT id,name,path,active_account_profile_id FROM projects WHERE id=?').get(cfg.binding.projectId);
const nativeNormalFlowRows={runs:sandbox.prepare('SELECT COUNT(*) n FROM autonomous_runs').get().n,tasks:sandbox.prepare('SELECT COUNT(*) n FROM autonomous_tasks').get().n};sandbox.close();
const prod=new DatabaseSync(cfg.productionDb,{readOnly:true});
const profile=prod.prepare('SELECT id,display_name,environment_path FROM account_profiles WHERE id=?').get('acc-pro-1');
const historical=prod.prepare("SELECT * FROM autonomous_runs WHERE status='running' ORDER BY id").all();
const production={runningCount:historical.length,historicalRowsSha256:hash(JSON.stringify(historical)),activeLeases:prod.prepare("SELECT COUNT(*) n FROM worker_leases WHERE status='active'").get().n,activeWorkers:prod.prepare("SELECT COUNT(*) n FROM workers WHERE status='WORKING' OR current_run_id IS NOT NULL").get().n};prod.close();
const native=JSON.parse(fs.readFileSync(path.join('C:/Users/Deco/.gemini/config/projects',cfg.nativeProjectId+'.json'),'utf8'));
const nativeBinding={id:native.id,name:native.name,folders:native.projectResources.resources.map(r=>r.gitFolder?.folderUri).filter(Boolean),settings:native.settings};
const transcripts=ledger.creations.map(c=>{
  const file=path.join('C:/Users/Deco/.gemini/antigravity/brain',c.conversation_id,'.system_generated/logs/transcript.jsonl');
  const rows=fs.readFileSync(file,'utf8').split(/\r?\n/).filter(Boolean).map(l=>JSON.parse(l));const last=rows.at(-1);
  return {id:c.conversation_id,role:c.role,lastStep:last.step_index,lastType:last.type,lastStatus:last.status,pendingTools:(last.tool_calls||[]).map(t=>t.name),done:last.type==='PLANNER_RESPONSE'&&last.status==='DONE'&&Boolean(last.content)&&!last.tool_calls?.length};
});
const currentFiles={};
for(const name of ['BRIEFING.md','package.json','src/calculator.cjs','src/server.cjs','test/calculator.test.cjs','test/calculator-regression.test.cjs','test/server.test.cjs'])currentFiles[name]=hash(fs.readFileSync(path.join(cfg.projectRoot,name)));
const evaluated=JSON.parse(fs.readFileSync(path.join(root,'logs/full-system-qa/packaged-1.0.4-http-evaluation.json'),'utf8'));
const workerFilesUnchangedSinceEvaluation=[...new Set([...Object.keys(currentFiles),...Object.keys(evaluated.after)])].every(name=>currentFiles[name]===evaluated.after[name]);
const result={at:new Date().toISOString(),productionReadOnly:true,credentialsRead:false,newRealAgentCalls:0,newPhysicalConversations:0,legacyPid19248Alive:processes.some(p=>p.pid===19248),decohubProcesses:processes.filter(p=>p.name.toLowerCase()==='decohub.exe'),profile,runtime:selectRuntime(profile.environment_path,cfg.defaultAccountDataPath,processes),production,project,nativeNormalFlowRows,nativeBinding,ledger,sessions,transcripts,currentFiles,workerFilesUnchangedSinceEvaluation,nativeSandboxVersion:cfg.version,nativeArtifactRoot:cfg.artifactRoot,originalBuildSha256:hash(fs.readFileSync(path.join(path.dirname(cfg.artifactRoot),'DecoHUB Setup 1.0.4.exe'))),nativePolicySatisfiesGuard:native.settings.fileAccessPolicy==='AGENT_SETTING_POLICY_DENY'&&native.settings.autoExecutionPolicy==='CASCADE_COMMANDS_AUTO_EXECUTION_OFF',accountIdentityEvidence:'Human confirmation; runtime directory/process binding is separate evidence. No automatic OAuth or billing guarantee.'};
const finalConfig=path.join(cfg.controlRoot,'native-normal-1.0.6.json');
const normalFile=fs.existsSync(finalConfig)?finalConfig:path.join(cfg.controlRoot,'native-normal-1.0.5.json');
if(fs.existsSync(normalFile)){
  const normal=JSON.parse(fs.readFileSync(normalFile,'utf8'));
  result.preparedNormalBuild={version:normal.version,artifactRoot:normal.artifactRoot,packagedServer:normal.packagedServer,safeExecutor:normal.normalFlow.safeExecutor,started:false,historicalManifestPreserved:true};
  try{
    if(normal.version==='1.0.6') result.effectiveNativeExecutionPolicy=require('./final106/verification-tool.cjs').assertQaProjectPolicy(native,normal);
    else require('./qa-verification-bridge.cjs').assertQaProjectPolicy(native);
    result.safeAutomationProjectPolicy=true;result.nativePolicySatisfiesGuard=true;
  }catch(e){result.safeAutomationProjectPolicy=false;result.nativePolicySatisfiesGuard=false;result.safeAutomationPolicyError=e.message;}
  result.nativeBinding.projectPermissionDenies=native.permissionGrants?.permissionGrants?.deny||[];
}
const output=process.env.DECOHUB_READONLY_EVIDENCE_OUTPUT||path.join(root,'logs/full-system-qa/final-readonly-evidence.json');fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(result,null,2));
console.log(JSON.stringify({output,reservations:ledger.creations.length,activeCalls:ledger.activeCalls.length,backendLeases:ledger.backendLeases.length,runtimePid:result.runtime?.pid,production,transcripts,workerFilesUnchangedSinceEvaluation:result.workerFilesUnchangedSinceEvaluation,nativePolicySatisfiesGuard:result.nativePolicySatisfiesGuard}));
