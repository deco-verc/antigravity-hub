'use strict';
// External model/tool boundary fixture for the copied existing sandbox ONLY.
// Never installed into the live sandbox, never creates a conversation, never calls a model.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root=process.env.AI_DEV_HUB_DATA_DIR;
if(process.env.DECOHUB_OFFLINE_MODE!=='true'||!root||!path.basename(root).startsWith('decohub-session-adoption-'))throw Error('ADOPTION_FIXTURE_SCOPE_DENIED');
const modules=path.dirname(process.argv[1]);
const {db}=require(path.join(modules,'db.js'));
const {AgentApiGateway}=require(path.join(modules,'agentApiGateway.js'));
const {AccountProfileManager}=require(path.join(modules,'accountProfileManager.js'));
const {WorkerRegistry}=require(path.join(modules,'workerRegistry.js'));
const {AntigravityProvider}=require(path.join(modules,'antigravityProvider.js'));
const projectId='native-homologation-20261009';
const ids={SUPERVISOR:'5489a5ca-40ad-431a-bbd7-f9dcea2b28e5',WORKER:'d4cbb8f9-a415-4693-876c-2105fc517212'};
const rows=db.prepare("SELECT * FROM agent_sessions WHERE project_id=? AND status='ACTIVE'").all(projectId);
if(rows.length!==2||rows.some(r=>ids[r.role]!==r.provider_conversation_id))throw Error('COPIED_SESSION_PAIR_MISMATCH');
for(const name of ['execFileSync','execFile','spawn','spawnSync']){
  const original=cp[name];cp[name]=(file,...args)=>{if(/language_server|antigravity\.exe/i.test(String(file))||(Array.isArray(args[0])&&args[0].includes('agentapi')))throw Error('ADOPTION_PHYSICAL_PROCESS_DENIED');return original(file,...args);};
}
require('node:module').syncBuiltinESMExports();
const project=db.prepare('SELECT * FROM projects WHERE id=?').get(projectId);
if(path.relative(root,project.path).startsWith('..'))throw Error('COPIED_PROJECT_PATH_DENIED');
const brain=path.join(root,'profile','.gemini','antigravity','brain');
const callsFile=path.join(root,'fixture-calls.json');
const calls=fs.existsSync(callsFile)?JSON.parse(fs.readFileSync(callsFile,'utf8')):[];
const append=(id,event)=>{const file=path.join(brain,id,'.system_generated/logs/transcript.jsonl');fs.mkdirSync(path.dirname(file),{recursive:true});fs.appendFileSync(file,JSON.stringify(event)+'\n');};
const provider={
  newConversation(){throw Error('ADOPTION_NEW_CONVERSATION_FORBIDDEN');},
  getConversationMetadata(id){if(!Object.values(ids).includes(id))throw Error('ADOPTION_UNKNOWN_SESSION');return {rootConversationId:id,status:'ACTIVE'};},
  getResponse(_id,mode){return mode==='REVIEW'?JSON.stringify({verdict:'APPROVED',feedback:'Explicit offline fixture: approval requires persisted independent PASS.'}):JSON.stringify([{title:'Corrigir URL HTTP malformada',description:'Reparar somente a exceção ERR_INVALID_URL, preservando calculadora e API existentes.',milestone:'M1',criteria:['URL malformada retorna 400 sem encerrar o servidor','Quatro operações, validação e corpo de 16 KiB preservados','npm test executa aceitação independente protegida'],verificationCommand:'npm test',doneWhen:'Aceitação independente PASS'}]);},
  sendMessage(options){
    if(options.projectId!==projectId||ids[options.role]!==options.conversationId)throw Error('ADOPTION_ROLE_OR_PROJECT_MISMATCH');
    if(calls.length>=6)throw Error('ADOPTION_CONTINUATION_BUDGET_EXHAUSTED');
    calls.push({id:options.conversationId,role:options.role,at:new Date().toISOString(),simulated:true});fs.writeFileSync(callsFile,JSON.stringify(calls,null,2));
    if(options.role!=='WORKER')return;
    if(calls.filter(c=>c.role==='WORKER').length!==1)throw Error('ADOPTION_DUPLICATE_WORKER_DISPATCH');
    const file=path.join(project.path,'src/server.cjs'),source=fs.readFileSync(file,'utf8');
    const original="  const parsedUrl = new URL(req.url, 'http://127.0.0.1');";
    if(!source.includes(original))throw Error('ADOPTION_FIXTURE_BASELINE_CHANGED');
    // This is a simulated edit in the disposable copy. Original Worker source is never edited.
    fs.writeFileSync(file,source.replace(original,"  let parsedUrl;\n  try { parsedUrl = new URL(req.url, 'http://127.0.0.1'); } catch {\n    res.writeHead(400, { 'Content-Type': 'application/json' });\n    res.end(JSON.stringify({ error: 'Invalid request URL' }));\n    return;\n  }"));
    append(ids.WORKER,{type:'PLANNER_RESPONSE',status:'DONE',step_index:58,content:'OFFLINE FIXTURE: awaiting simulated terminal approval',tool_calls:[{name:'run_command',args:{CommandLine:'npm test'}}]});
  }
};
AgentApiGateway.setMockProvider(provider);
WorkerRegistry.setProbeOverrideForTest(async()=>({conversationId:ids.WORKER,pid:process.pid}));
const getResult=AntigravityProvider.prototype.getResult;
AntigravityProvider.prototype.getResult=function(id,_timeout,projectPath,cancel){return getResult.call(this,id,5,projectPath,cancel);};
AccountProfileManager.updateStatus('acc-pro-1','READY');
console.log('OFFLINE_EXISTING_SESSION_ADOPTION_FIXTURE: '+root);
