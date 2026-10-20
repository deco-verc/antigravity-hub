'use strict';
// Process launcher only. The Chat and Autonomous Runner create the Run and dispatch
// every model call. This launcher never sends a prompt or creates a conversation.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const {assertApprovedBudget}=require('./normal-flow-policy.cjs');
function launch(configFile){
  if(process.argv[2]!=='--live')throw Error('LIVE_LAUNCH_REQUIRES_SPECIFIC_AUTHORIZATION');
  const config=JSON.parse(fs.readFileSync(configFile,'utf8'));
  const approval=JSON.parse(fs.readFileSync(path.join(config.controlRoot,'live-approval.json'),'utf8'));
  assertApprovedBudget(approval,0,null);
  if(approval.authorization!=='EXPLICIT_USER_AUTHORIZATION'||Date.now()-Date.parse(approval.checkedAt)>300000||approval.creditOverages!=='Never'||!approval.identityVerified||!approval.noOtherTasks)throw Error('MANDATORY_FRESH_HUMAN_CONFIRMATION_REQUIRED');
  const {assertQaProjectPolicy,assertLivePolicyApproval}=require('./verification-tool.cjs');
  assertLivePolicyApproval(config,approval);
  assertQaProjectPolicy(JSON.parse(fs.readFileSync(path.join(config.nativeUserProfile,'.gemini/config/projects',config.nativeProjectId+'.json'),'utf8')),config);
  const logRoot=path.join(config.root,'logs/native-final-1.0.6');fs.mkdirSync(logRoot,{recursive:true});
  const exe=path.join(config.artifactRoot,'DecoHUB.exe');
  const env={...process.env,AI_DEV_HUB_DATA_DIR:config.dataRoot,CLIENT_DIST_PATH:config.clientDist,DECOHUB_NATIVE_NORMAL_CONFIG:configFile,DECOHUB_OFFLINE_MODE:'false',DECOHUB_ALLOW_LIVE_AGENTAPI:'true',PORT:'3001'};
  delete env.NODE_OPTIONS;delete env.DECOHUB_TEST_PROVIDER_MODULE;
  const backend=cp.spawn(exe,['--require',path.join(__dirname,'native-normal-preload.cjs'),path.join(config.packagedServer,'index.js')],{cwd:config.projectRoot,env:{...env,ELECTRON_RUN_AS_NODE:'1'},windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
  backend.stdout.on('data',d=>fs.appendFileSync(path.join(logRoot,'backend.log'),d));backend.stderr.on('data',d=>fs.appendFileSync(path.join(logRoot,'backend-errors.log'),d));
  const receipt={at:new Date().toISOString(),backendPid:backend.pid,configFile,phase:'BACKEND_STARTED_NO_PROMPT_SENT',physicalCreationsAllowed:0,maxAdditionalSends:6};
  fs.writeFileSync(path.join(logRoot,'launch.json'),JSON.stringify(receipt,null,2));
  return {backend,env,exe,logRoot};
}
module.exports={launch};
if(require.main===module){
  const configFile=path.join('C:/IA/DecoHUB-native-sandbox-20261009/control/native-normal-1.0.6.json');
  const state=launch(configFile);
  (async()=>{
    for(let i=0;i<40;i++){
      if(state.backend.exitCode!==null)throw Error('GUARDED_BACKEND_EXITED_BEFORE_READY');
      try{
        const response=await fetch('http://127.0.0.1:3001/api/health'),health=await response.json();
        if(path.resolve(health.dataPath)!==path.join(JSON.parse(fs.readFileSync(configFile)).dataRoot,'hub.db')||health.offline!==false)throw Error('GUARDED_BACKEND_IDENTITY_MISMATCH');
        const env={...state.env};delete env.ELECTRON_RUN_AS_NODE;
        const app=cp.spawn(state.exe,[],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
        app.stdout.on('data',d=>fs.appendFileSync(path.join(state.logRoot,'electron.log'),d));app.stderr.on('data',d=>fs.appendFileSync(path.join(state.logRoot,'electron-errors.log'),d));
        console.log(JSON.stringify({backendPid:state.backend.pid,electronPid:app.pid,modelsStarted:false,instruction:'Use normal Chat only after authorization; guarded Runner performs all calls'}));return;
      }catch(error){if(error.message==='GUARDED_BACKEND_IDENTITY_MISMATCH')throw error;}
      await new Promise(resolve=>setTimeout(resolve,250));
    }
    throw Error('GUARDED_BACKEND_READY_TIMEOUT');
  })().catch(error=>{
    console.error(error.message);process.exitCode=1;
    if(state.backend.connected)state.backend.send({command:'native-normal-safe-shutdown'});
  });
}
