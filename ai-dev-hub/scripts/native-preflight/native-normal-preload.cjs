'use strict';
// Guard for the uninstalled Electron 1.0.5 backend. No model/tool fixture is used here.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),Module=require('node:module');
if(process.env.DECOHUB_NATIVE_NORMAL_CONFIG&&process.env.ELECTRON_RUN_AS_NODE==='1'){
  const config=JSON.parse(fs.readFileSync(process.env.DECOHUB_NATIVE_NORMAL_CONFIG,'utf8'));
  const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
  if(path.resolve(process.argv[1]||'').toLowerCase()!==path.join(config.packagedServer,'index.js').toLowerCase())throw Error('NORMAL_BACKEND_ARTIFACT_MISMATCH');
  if(process.env.DECOHUB_TEST_PROVIDER_MODULE)throw Error('NORMAL_NATIVE_FIXTURE_FORBIDDEN');
  if(JSON.parse(fs.readFileSync(path.join(config.packagedServer,'..','package.json'),'utf8')).version!=='1.0.5')throw Error('NORMAL_BUILD_VERSION_MISMATCH');
  for(const [file,expected]of Object.entries(config.normalFlow.guardHashes))if(hash(fs.readFileSync(file))!==expected)throw Error('NORMAL_GUARD_INTEGRITY_CHANGED');
  if(hash(fs.readFileSync(path.join(config.packagedServer,'agentApiGateway.js')))!==config.packagedGatewayHash)throw Error('NORMAL_GATEWAY_ARTIFACT_CHANGED');
  process.chdir(config.projectRoot);
  // Use the explicitly prepared account row; never scan account storage on module initialization.
  const target=path.join(config.packagedServer,'accountProfileManager.js'),originalJs=Module._extensions['.js'];
  Module._extensions['.js']=function(module,filename){
    if(filename.toLowerCase()===target.toLowerCase()){
      const bytes=fs.readFileSync(filename);if(hash(bytes)!==config.normalFlow.accountManagerHash)throw Error('NORMAL_ACCOUNT_MODULE_CHANGED');
      const code=bytes.toString('utf8');if(!/^AccountProfileManager\.initDefaultProfiles\(\);$/m.test(code))throw Error('NORMAL_ACCOUNT_BOOTSTRAP_UNKNOWN');
      return module._compile(code.replace(/^AccountProfileManager\.initDefaultProfiles\(\);$/m,'// Prepared sandbox account: automatic profile initialization disabled.'),filename);
    }
    return originalJs(module,filename);
  };
  const ledger=require(path.join(config.root,'guard/guard.cjs')).install(config);
  if(config.normalFlow.safeExecutor){
    require(path.join(config.root,'guard/qa-verification-bridge.cjs')).installSafeVerification(config,ledger);
  }
  // Only an owning launcher with IPC can request shutdown; active work remains protected.
  process.on('message',message=>{
    if(message?.command!=='native-normal-safe-shutdown')return;
    const {db}=require(path.join(config.packagedServer,'db.js'));
    const pending=db.prepare("SELECT COUNT(*) n FROM autonomous_runs WHERE status NOT IN ('completed','failed')").get().n;
    const nativeTurns=db.prepare("SELECT COUNT(*) n FROM agent_turn_observations WHERE phase IN ('IN_FLIGHT','UNCERTAIN')").get().n;
    if(pending||nativeTurns||ledger.snapshot().activeCalls.length){process.send?.({shutdownSafe:false});return;}
    ledger.event('NORMAL_BACKEND_SAFE_SHUTDOWN',{activeRuns:0,activeCalls:0});process.send?.({shutdownSafe:true});process.emit('SIGTERM');
  });
  const {assertNormalFlow,assertApprovedBudget}=require(path.join(config.root,'guard/normal-flow-policy.cjs'));
  const priorLoad=Module._load;
  Module._load=function(request,parent,isMain){
    const exported=priorLoad.call(this,request,parent,isMain);let resolved;
    try{resolved=Module._resolveFilename(request,parent);}catch{return exported;}
    if(resolved===path.join(config.packagedServer,'agentApiGateway.js')&&!exported.AgentApiGateway.__normalFlowGuarded){
      const gateway=exported.AgentApiGateway,send=gateway.sendMessage;
      gateway.newConversation=()=>{ledger.event('NORMAL_FLOW_CREATION_DENIED',{physicalCount:2});ledger.halt('CONTINUATION_SEND_ONLY_NO_CREATION');throw Error('CONTINUATION_SEND_ONLY_NO_CREATION');};
      gateway.sendMessage=function(options){
        try{
          if(process.env.DECOHUB_OFFLINE_MODE==='true')throw Error('NORMAL_OFFLINE_NO_REAL_MESSAGE');
          const approval=JSON.parse(fs.readFileSync(path.join(config.controlRoot,'live-approval.json'),'utf8'));
          assertApprovedBudget(approval,0,null);
          if(options.projectId!==config.binding.projectId||options.conversationId!==config.normalFlow.ids[options.role])throw Error('NORMAL_SESSION_PAIR_MISMATCH');
          const {NativeWorkspaceBinding}=require(path.join(config.packagedServer,'nativeWorkspaceBinding.js'));
          const binding=NativeWorkspaceBinding.get(options.projectId,config.binding.accountProfileId);
          const nativeProject=JSON.parse(fs.readFileSync(path.join(binding.userProfileDir,'.gemini/config/projects',binding.nativeProjectId+'.json'),'utf8'));
          require(path.join(config.root,'guard/qa-verification-bridge.cjs')).assertQaProjectPolicy(nativeProject);
          const {db}=require(path.join(config.packagedServer,'db.js'));
          const runs=db.prepare('SELECT * FROM autonomous_runs WHERE project_id=?').all(config.binding.projectId);
          const tasks=runs.length===1?db.prepare('SELECT * FROM autonomous_tasks WHERE run_id=? ORDER BY order_index').all(runs[0].id):[];
          const {IndependentEvaluator}=require(path.join(config.packagedServer,'independentEvaluator.js'));
          const evaluation=tasks.length===1?IndependentEvaluator.getEvaluationByTaskId(tasks[0].id):null;
          const reviews=runs.length===1?db.prepare('SELECT verdict FROM supervisor_reviews WHERE run_id=? ORDER BY created_at').all(runs[0].id):[];
          const sends=ledger.snapshot().sends;
          const stage=assertNormalFlow({role:options.role,config,sends,runs,tasks,evaluation,reviews});
          assertApprovedBudget(approval,sends.length-config.normalFlow.baselineSends,stage);
          for(const [file,expected]of Object.entries(config.normalFlow.preserveFileHashes))if(hash(fs.readFileSync(path.join(config.projectRoot,file)))!==expected)throw Error('NORMAL_PROTECTED_FILE_CHANGED');
          ledger.event('NORMAL_FLOW_STAGE_VALIDATED',{stage,runId:runs[0].id,role:options.role,conversationId:options.conversationId});
          return send.call(this,options);
        }catch(e){
          // Offline denial is preparation only; do not mutate the live ledger's safety state.
          if(!String(e.message).startsWith('NORMAL_OFFLINE_'))ledger.halt(e.code||e.message||'NORMAL_FLOW_ANOMALY');
          throw e;
        }
      };
      gateway.__normalFlowGuarded=true;
    }
    return exported;
  };
  ledger.event('NORMAL_ELECTRON_GUARD_READY',{version:'1.0.5',fixture:false,offline:process.env.DECOHUB_OFFLINE_MODE==='true',physicalLimit:2,remainingCalls:6});
}
