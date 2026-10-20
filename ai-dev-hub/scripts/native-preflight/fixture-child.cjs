'use strict';
// Explicit offline fixture. No provider executable is ever allowed through this process.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const {Ledger,Boundary,digest} = require('./ledger.cjs');
const mode = process.argv[2];
const root = process.argv[3];
const config = JSON.parse(fs.readFileSync(path.join(root,'fixture.json'),'utf8'));
const ledger = new Ledger(path.join(root,'control'),config.binding);
const boundary = new Boundary(ledger,() => {});
const base = {projectId:config.binding.projectId,accountProfileId:config.binding.accountProfileId};
const request = role => ({...base,role,model:config.binding.models[role],verb:'new-conversation',promptHash:digest(role)});
function bindFixtureWorkspace(db) {
  const home=root,folder=path.join(root,'project'),id='native-fixture';
  const dir=path.join(home,'.gemini','config','projects');fs.mkdirSync(dir,{recursive:true});
  const permissive=config.executionPolicy?.mode==='permissive';
  fs.writeFileSync(path.join(dir,id+'.json'),JSON.stringify({id,projectResources:{resources:[{gitFolder:{folderUri:require('node:url').pathToFileURL(folder).href}}]},settings:{fileAccessPolicy:permissive?'AGENT_SETTING_POLICY_ALLOW':'AGENT_SETTING_POLICY_DENY',autoExecutionPolicy:permissive?'CASCADE_COMMANDS_AUTO_EXECUTION_EAGER':'CASCADE_COMMANDS_AUTO_EXECUTION_OFF'}}));
  const now=new Date().toISOString();db.prepare('INSERT OR IGNORE INTO projects(id,name,path,created_at,updated_at) VALUES(?,?,?,?,?)').run(base.projectId,'Offline fixture',folder,now,now);
  if(permissive)require(path.join(config.packagedServer,'nativeExecutionPolicy.js')).NativeExecutionPolicy.configure(base.projectId,config.executionPolicy);
  const moduleFile=path.join(config.packagedServer,'nativeWorkspaceBinding.js');
  if(fs.existsSync(moduleFile))require(moduleFile).NativeWorkspaceBinding.bind({projectId:base.projectId,accountProfileId:base.accountProfileId,nativeProjectId:id,userProfileDir:home,workspacePath:folder});
  return {USERPROFILE:home,ANTIGRAVITY_PROJECT_ID:id};
}
async function main() {
  if (mode === 'reserve-crash') { ledger.reserve(request('SUPERVISOR')); console.log(JSON.stringify({reserved:true}));return; }
  if (mode === 'backend-crash') { ledger.claimBackend(); console.log(JSON.stringify({reserved:true}));process.exit(0); }
  if (mode === 'attempt') {
    let called=0;
    try {boundary.invoke(request(process.argv[4] || 'SUPERVISOR'),() => {called++;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,200);return JSON.stringify({response:{newConversation:{conversationId:'fixture-'+process.pid}}});});console.log(JSON.stringify({result:'PASS',called}));}
    catch(error){console.log(JSON.stringify({result:'BLOCKED',code:error.code,called}));}return;
  }
  if (mode.startsWith('sessions')) {
    process.env.AI_DEV_HUB_DATA_DIR=path.join(root,'data');process.env.DECOHUB_OFFLINE_MODE='true';process.env.DECOHUB_ALLOW_LIVE_AGENTAPI='false';
    for(const method of ['execFileSync','execFile','spawn','spawnSync','exec','execSync']) {
      const original=cp[method];cp[method]=function(file,...rest){if(/language_server|agentapi|antigravity\.exe/i.test(String(file)+(Array.isArray(rest[0])?rest[0].join(' '):'')))throw new Error('OFFLINE_PHYSICAL_PROCESS_DENIED');return original.call(cp,file,...rest);};
    }
    const {db}=require(path.join(config.packagedServer,'db.js'));
    const {AgentApiGateway}=require(path.join(config.packagedServer,'agentApiGateway.js'));
    AgentApiGateway.setMockProvider({
      newConversation(options){return boundary.invoke({...base,...options,verb:'new-conversation',promptHash:digest(options.prompt)},() => JSON.stringify({response:{newConversation:{conversationId:'fixture-'+options.role}}})) && 'fixture-'+options.role;},
      sendMessage(options){boundary.invoke({...base,...options,model:config.binding.models[options.role],verb:'send-message',promptHash:digest(options.prompt)},() => '');},
      getConversationMetadata(id){return {rootConversationId:id,status:'ACTIVE'};}
    });
    const {AgentSessionManager}=require(path.join(config.packagedServer,'agentSessionManager.js'));
    if (mode === 'sessions-create') {
      const now=new Date().toISOString();db.prepare('INSERT INTO projects(id,name,path,objective,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(base.projectId,'Offline fixture',path.join(root,'project'),'Offline fixture','active',now,now);
    }
    const result=[];
    for(const role of ['SUPERVISOR','WORKER']) {
      const item=await AgentSessionManager.getOrCreateAgentSession(base.projectId,role,{accountProfileId:base.accountProfileId,model:config.binding.models[role],initialPrompt:'Explicit offline fixture'});
      if(mode==='sessions-reuse') await AgentSessionManager.sendMessage(item.session,'Offline subsequent task '+role);
      result.push({role,id:item.session.provider_conversation_id,isNew:item.isNew});
    }
    let profileRejected=false,modelRejected=false;
    try {await AgentSessionManager.getOrCreateAgentSession(base.projectId,'WORKER',{accountProfileId:'different-account',model:'flash'});}catch(error){profileRejected=error.message.includes('SESSION_PROFILE_MISMATCH');}
    try {await AgentSessionManager.getOrCreateAgentSession(base.projectId,'WORKER',{accountProfileId:base.accountProfileId,model:'pro'});}catch(error){modelRejected=error.message.includes('SESSION_MODEL_MISMATCH');}
    console.log(JSON.stringify({result,profileRejected,modelRejected,snapshot:ledger.snapshot()}));db.close();return;
  }
  if (mode === 'gateway-boundary') {
    process.env.AI_DEV_HUB_DATA_DIR=path.join(root,'data');process.env.DECOHUB_OFFLINE_MODE='true';process.env.DECOHUB_ALLOW_LIVE_AGENTAPI='false';
    let context;let called=0;
    const original=cp.execFileSync;
    cp.execFileSync=function(file,args,options){
      if(file==='fixture-language_server.exe') return boundary.invoke(context,()=>{called++;return args[1]==='new-conversation'?replyFor(context.role):'';});
      if(/language_server|agentapi|antigravity\.exe/i.test(String(file)+(Array.isArray(args)?args.join(' '):'')))throw new Error('REAL_EXECUTABLE_DENIED_IN_FIXTURE');
      return original.call(cp,file,args,options);
    };
    for(const method of ['execFile','spawn','spawnSync','exec','execSync']) cp[method]=()=>{throw new Error('SUBPROCESS_DENIED_IN_FIXTURE');};
    const {db}=require(path.join(config.packagedServer,'db.js'));
    const {AgentApiGateway}=require(path.join(config.packagedServer,'agentApiGateway.js'));
    const {DevAutonomyService}=require(path.join(config.packagedServer,'devAutonomyService.js'));
    const nativeEnv=bindFixtureWorkspace(db);
    // Exercise packaged LIVE branch only against the in-memory executable proxy above.
    AgentApiGateway.isOfflineMode=()=>false;AgentApiGateway.resolveLanguageServerExe=()=> 'fixture-language_server.exe';
    DevAutonomyService.isProjectAuthorizedForLiveExecution=()=>({authorized:true,reason:'Explicit offline fixture proxy'});
    const replyFor=role=>JSON.stringify({response:{newConversation:{conversationId:'fixture-'+role}}});
    for(const role of ['SUPERVISOR','WORKER']) {context=request(role);AgentApiGateway.newConversation({...context,title:role,prompt:'Explicit offline fixture',origin:'TEST',env:nativeEnv});}
    for(const role of ['SUPERVISOR','WORKER']) {context={...request(role),verb:'send-message',conversationId:'fixture-'+role,promptHash:digest('continue-'+role)};AgentApiGateway.sendMessage({...context,prompt:'continue-'+role,env:nativeEnv});}
    const beforeThird=called;let thirdCode;
    try {context=request('WORKER');AgentApiGateway.newConversation({...context,title:'unexpected third',prompt:'Explicit offline fixture',origin:'TEST',env:nativeEnv});}catch(error){thirdCode=error.code;}
    console.log(JSON.stringify({called,beforeThird,thirdCode,realExecutableCalls:0,snapshot:ledger.snapshot()}));db.close();return;
  }
  if (mode === 'guard-denial') {
    const dataRoot=path.join(root,'data');fs.mkdirSync(dataRoot,{recursive:true});
    const sandboxConfig={...config,root,dataRoot,projectRoot:path.join(root,'project'),controlRoot:path.join(root,'control'),accountEnvironmentPath:'C:\\Profile',defaultAccountDataPath:'C:\\Default'};
    process.env.AI_DEV_HUB_DATA_DIR=dataRoot;process.env.DECOHUB_OFFLINE_MODE='true';process.chdir(sandboxConfig.projectRoot);
    const guarded=require('./guard.cjs').install(sandboxConfig);const codes=[];
    for(const method of ['execFileSync','execFile','spawn','spawnSync','fork']) {
      try{cp[method]('language_server.exe',['agentapi','new-conversation','--model=pro','do not execute']);}catch(error){codes.push(error.code);}
    }
    for(const method of ['exec','execSync']){try{cp[method]('language_server.exe agentapi new-conversation');}catch(error){codes.push(error.code);}}
    try{cp.execFileSync('Antigravity.exe',[]);}catch(error){codes.push(error.code);}
    const {AccountProfileManager}=require(path.join(config.packagedServer,'accountProfileManager.js'));
    try{AccountProfileManager.launchLogin('acc-pro-1');}catch(error){codes.push(error.code);}
    console.log(JSON.stringify({codes,realExecutableCalls:0,creations:guarded.snapshot().creations.length}));guarded.close();return;
  }
  if (mode === 'installed-guard-boundary') {
    // The installed guard and packaged gateway are exercised against a proxy, not a real executable or account.
    const dataRoot=path.join(root,'data');fs.mkdirSync(dataRoot,{recursive:true});
    const fakeExe=path.join(root,'fixture-language_server.exe');fs.writeFileSync(fakeExe,'OFFLINE FIXTURE — NEVER EXECUTE');
    const sandboxConfig={...config,root,dataRoot,projectRoot:path.join(root,'project'),controlRoot:path.join(root,'control'),
      accountEnvironmentPath:'C:\\FixtureProfile',defaultAccountDataPath:'C:\\FixtureProfile',languageServerExe:fakeExe,productionDb:path.join(dataRoot,'hub.db')};
    const variant=process.argv[4] || 'cap';
    process.env.AI_DEV_HUB_DATA_DIR=dataRoot;process.env.DECOHUB_OFFLINE_MODE='true';process.chdir(sandboxConfig.projectRoot);
    const processes=[{pid:601,parentPid:0,name:'Antigravity.exe',userDataDir:null,started:'gui-fixture'},
      {pid:602,parentPid:601,name:'language_server.exe',started:'ls-fixture'}];
    let proxyCalls=0;
    cp.execFileSync=function(file,args){
      if(file==='powershell.exe')return JSON.stringify(processes);
      if(file===fakeExe){proxyCalls++;const role=args.find(a=>String(a).startsWith('--model='))==='--model=pro'?'SUPERVISOR':'WORKER';return JSON.stringify({response:{newConversation:{conversationId:'fixture-'+role}}});}
      throw new Error('ALL_OTHER_EXECUTABLES_DENIED_IN_FIXTURE');
    };
    for(const method of ['execFile','spawn','spawnSync','exec','execSync','fork'])cp[method]=()=>{throw new Error('SUBPROCESS_DENIED_IN_FIXTURE');};
    const guarded=require('./guard.cjs').install(sandboxConfig);
    const {db}=require(path.join(config.packagedServer,'db.js'));
    const {AgentApiGateway}=require(path.join(config.packagedServer,'agentApiGateway.js'));
    const {DevAutonomyService}=require(path.join(config.packagedServer,'devAutonomyService.js'));
    const mainSourceSelectorLoaded=typeof require(path.join(config.packagedServer,'accountProfileManager.js')).AccountProfileManager.getRuntimeBindingForProfile==='function';
    const now=new Date().toISOString();const nativeEnv=bindFixtureWorkspace(db);
    AgentApiGateway.resolveLanguageServerExe=()=>fakeExe;DevAutonomyService.isProjectAuthorizedForLiveExecution=()=>({authorized:true,reason:'Explicit offline fixture'});
    const approval={authorization:'EXPLICIT_USER_AUTHORIZATION',checkedAt:now,identityVerified:true,accountProfileId:bindingAccount(),creditOverages:'Never',
      proAvailable:true,flashAvailable:true,noOtherTasks:true,effectiveWorkspace:sandboxConfig.projectRoot,nativeProjectBindingVerified:true,modelSelectionScope:'TIER_ONLY',
      runtime:{pid:602,mainPid:601,started:'ls-fixture',userDataDir:'c:\\fixtureprofile',address:'127.0.0.1:12345'}};
    function bindingAccount(){return config.binding.accountProfileId;}
    if(variant==='credits')approval.creditOverages='Always';
    if(variant==='identity')approval.identityVerified=false;
    if(variant==='runtime')approval.runtime.started='older-process';
    if(variant==='tasks') {
      processes.push({pid:606,parentPid:0,name:'DecoHUB.exe',started:new Date(Date.now()-10000).toISOString()});
      db.prepare("INSERT INTO runner_heartbeats(runner_id,status,last_heartbeat,metadata_json) VALUES(?,?,?,?)").run('fixture-controller','busy',now,JSON.stringify({pid:606}));
    }
    fs.writeFileSync(path.join(root,'control','live-approval.json'),JSON.stringify(approval));
    // Changing only a test-local flag cannot reach a real process: every underlying executor is the deny-all proxy above.
    process.env.DECOHUB_OFFLINE_MODE='false';let deniedCode;
    try{
      for(const role of ['SUPERVISOR','WORKER'])AgentApiGateway.newConversation({...request(role),title:role,prompt:'Explicit offline fixture',origin:'TEST',env:{...nativeEnv,ANTIGRAVITY_LS_ADDRESS:'127.0.0.1:12345'}});
      AgentApiGateway.newConversation({...request('WORKER'),title:'third fixture',prompt:'Explicit offline fixture',origin:'TEST',env:{...nativeEnv,ANTIGRAVITY_LS_ADDRESS:'127.0.0.1:12345'}});
    }catch(error){deniedCode=error.code;}
    console.log(JSON.stringify({deniedCode,proxyCalls,mainSourceSelectorLoaded,realExecutableCalls:0,snapshot:guarded.snapshot()}));db.close();guarded.close();return;
  }
  throw new Error('Unknown fixture mode');
}
main().catch(error=>{console.log(JSON.stringify({fatal:error.code || error.message}));process.exitCode=1;}).finally(()=>ledger.close());
