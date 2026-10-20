// Explicit offline fixture injected only into the PACKAGED backend by the sandbox test.
// This file is excluded from the installer; production has no synthetic response fallback.
if (process.env.DECOHUB_OFFLINE_MODE === 'true' && process.env.ELECTRON_RUN_AS_NODE === '1' && /server[\\/]dist[\\/]index\.js$/.test(process.argv[1] || '')) {
  const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
  const modules=path.dirname(process.argv[1]);
  const {db,HUB_DATA_DIR}=require(path.join(modules,'db.js'));
  if(!/decohub-electron-proof-/.test(HUB_DATA_DIR)) throw new Error('Sandbox data directory mismatch');
  const {AgentApiGateway,DefaultFakeAgentApiProvider}=require(path.join(modules,'agentApiGateway.js'));
  const {AccountProfileManager}=require(path.join(modules,'accountProfileManager.js'));
  const {WorkerRegistry}=require(path.join(modules,'workerRegistry.js'));
  // Prevent physical model launches independently of the gateway.
  for(const name of ['execFileSync','execFile','spawn','spawnSync']) {
    const original=cp[name];cp[name]=(file,...args)=>{
      if(/language_server|antigravity\.exe/i.test(String(file))||(Array.isArray(args[0])&&args[0].includes('agentapi')))throw new Error('SANDBOX_PHYSICAL_AGENT_DENIED');
      return original(file,...args);
    };
  }
  require('node:module').syncBuiltinESMExports();
  const fake=new DefaultFakeAgentApiProvider();
  // Hydrate only fixture sessions from the same isolated DB after restarting Electron.
  for(const session of db.prepare("SELECT * FROM agent_sessions WHERE status='ACTIVE'").all()) {
    if(!session.provider_conversation_id.startsWith('conv-fake-'))throw new Error('REAL_SESSION_IN_OFFLINE_FIXTURE');
    fake.conversations.push({id:session.provider_conversation_id,model:session.model||'flash',title:session.title,initialPrompt:'fixture restart',projectId:session.project_id,role:session.role,messages:[],createdAt:session.created_at});
  }
  fake.creationCount=db.prepare("SELECT COUNT(*) n FROM session_creation_telemetry WHERE event_type='CREATE_SUCCESS'").get().n;
  const attemptFile=path.join(HUB_DATA_DIR,'offline-worker-attempts.json');
  const attempts=new Map(fs.existsSync(attemptFile)?JSON.parse(fs.readFileSync(attemptFile,'utf8')):[]);
  const pendingFile=path.join(HUB_DATA_DIR,'offline-pending-turn.json');
  // Simulate an external turn finishing while this *offline* test backend was down.
  if(fs.existsSync(pendingFile)) {
    const pending=JSON.parse(fs.readFileSync(pendingFile,'utf8'));
    fs.appendFileSync(pending.transcript,JSON.stringify({type:'PLANNER_RESPONSE',status:'DONE',content:'Offline turn completed during backend interruption.',step_index:pending.step})+'\n');
    fs.renameSync(pendingFile,pendingFile+'.reconciled');
  }
  const now=new Date().toISOString();
  const cases=[['sandbox-main','Sandbox Pipeline',1],['sandbox-denied','Sandbox sem autorização',0],['sandbox-auth','Sandbox autenticação expirada',1],['sandbox-invalid','Sandbox plano inválido',1],['sandbox-unavailable','Sandbox provider indisponível',1],['sandbox-native-wait','Sandbox aprovação nativa pendente',1]];
  for(const [id,name,autonomy]of cases){
    const dir=path.join(HUB_DATA_DIR,'projects',id);fs.mkdirSync(dir,{recursive:true});
    db.prepare('INSERT OR IGNORE INTO projects(id,name,path,objective,is_trusted,full_dev_autonomy,created_at,updated_at) VALUES(?,?,?,?,1,?,?,?)').run(id,name,dir,'Soma verificada em sandbox',autonomy,now,now);
    if(id==='sandbox-main'){
      fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({name:'sandbox-example',scripts:{test:'node acceptance.test.cjs 1'}}));
      fs.writeFileSync(path.join(dir,'acceptance.test.cjs'),`const a=require('node:assert/strict');const i=process.argv[2]||1;const {add}=require('./step-'+i+'.cjs');a.equal(add(2,3),5);a.equal(add(-1,1),0);a.throws(()=>add(NaN,1),TypeError);console.log('acceptance step '+i);`);
    }
  }
  db.prepare("INSERT OR IGNORE INTO autonomous_runs(id,project_id,name,objective,status,last_error,start_time,created_at,updated_at) VALUES('sandbox-native-wait-run','sandbox-native-wait','Native wait fixture','Preservar turno pendente','waiting_approval','TURN_RECONCILIATION_REQUIRED: AGENT_NATIVE_TOOL_PENDING',?,?,?)").run(now,now,now);
  fake.responseProvider=(id,mode)=>{
    const project=fake.conversations.find(c=>c.id===id)?.projectId;
    if(project==='sandbox-auth')throw new Error('AUTH_ERROR: login expirado no perfil selecionado');
    if(project==='sandbox-invalid')return '{invalid JSON';
    if(mode==='REVIEW')return JSON.stringify({verdict:'APPROVED',feedback:'Supervisor explicitamente simulado; Evaluator executou testes reais.'});
    const projectRow=db.prepare('SELECT * FROM projects WHERE id=?').get(project);
    if(projectRow?.name==='Evolution QA App') {
      if(!projectRow.path.startsWith(HUB_DATA_DIR+path.sep))throw Error('OFFLINE_PROJECT_ESCAPE');
      const dir=projectRow.path;
      if(!fs.existsSync(path.join(dir,'acceptance.test.cjs'))) {
        fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({scripts:{test:'node acceptance.test.cjs 1'}}));
        fs.writeFileSync(path.join(dir,'acceptance.test.cjs'),`const a=require('node:assert/strict'),i=process.argv[2]||1,{add}=require('./step-'+i+'.cjs');a.equal(add(2,3),5);a.equal(add(-1,1),0);a.throws(()=>add(NaN,1),TypeError);console.log('independent acceptance '+i);`);
      }
    }
    return JSON.stringify([1,2].map(i=>({title:'Implementar incremento '+i,description:'Soma com validação de entradas no módulo step-'+i+'.cjs',milestone:'M1',dependencies:i===1?[]:['Implementar incremento 1'],criteria:['Soma positivos e negativos e rejeita valores inválidos'],verificationCommand:'node acceptance.test.cjs '+i,doneWhen:'Asserções independentes passam'})));
  };
  const create=fake.newConversation.bind(fake);
  fake.newConversation=opts=>{if(opts.projectId==='sandbox-unavailable')throw new Error('RUNTIME_UNAVAILABLE: provider desconectado');return create(opts);};
  const send=fake.sendMessage.bind(fake);
  fake.sendMessage=opts=>{
    send(opts);if(opts.role!=='WORKER')return;
    const projectRow=db.prepare('SELECT * FROM projects WHERE id=?').get(opts.projectId);
    if(opts.projectId!=='sandbox-main'&&projectRow?.name!=='Evolution QA App')throw new Error('Sandbox worker project mismatch');
    const indexMatch = opts.prompt.match(/TAREFA ATUAL:[^\n]*?incremento\s*(\d+)/i) || opts.prompt.match(/acceptance\.test\.cjs\s*(\d+)/i) || opts.prompt.match(/step-(\d+)\.cjs/i) || opts.prompt.match(/Implementar incremento (\d+)/i);
    const index=Number(indexMatch?.[1]);
    if(!index)throw new Error('Missing real task prompt');
    const key=opts.projectId+':'+index;
    const num=(attempts.get(key)||0)+1;attempts.set(key,num);fs.writeFileSync(attemptFile,JSON.stringify([...attempts]));
    const dir=projectRow.path;
    const file=path.join(dir,'step-'+index+'.cjs');
    fs.writeFileSync(file,`exports.add=function(a,b){if(!Number.isFinite(a)||!Number.isFinite(b))throw new TypeError('invalid');return a${index===1&&num===1?'-':'+'}b;};`);
    const brain=path.join(AccountProfileManager.getGlobalActiveProfile().environment_path,'.gemini','antigravity','brain',opts.conversationId,'.system_generated','logs');fs.mkdirSync(brain,{recursive:true});
    const transcript=path.join(brain,'transcript.jsonl');
    fs.appendFileSync(transcript,JSON.stringify({type:'TOOL_CALL',status:'DONE',tool_calls:[{name:'write_to_file',args:{TargetFile:file}}]})+'\n');
    if(projectRow.name==='Evolution QA App'&&index===1&&num===1) {
      fs.writeFileSync(pendingFile,JSON.stringify({transcript,step:num}));
      fs.appendFileSync(transcript,JSON.stringify({type:'TOOL_CALL',status:'PENDING',tool_calls:[{name:'offline_fixture_delayed_tool',args:{}}]})+'\n');
    } else fs.appendFileSync(transcript,JSON.stringify({type:'PLANNER_RESPONSE',status:'DONE',content:'Entrega simulada de código para avaliação real.',step_index:num})+'\n');
  };
  AgentApiGateway.setMockProvider(fake);
  AccountProfileManager.updateStatus('acc-pro-1','READY');
  WorkerRegistry.setProbeOverrideForTest(async()=>({conversationId:'conv-sandbox-runtime',pid:process.pid}));
  db.prepare("INSERT INTO model_preferences(role,model_id,project_id,updated_at) VALUES('builder','flash','sandbox-main',?)").run(now);
  console.log('PACKAGED_SANDBOX_FIXTURE_INSTALLED: '+HUB_DATA_DIR);
}
