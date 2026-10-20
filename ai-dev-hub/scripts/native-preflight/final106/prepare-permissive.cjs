'use strict';
// Offline preparation of the EXISTING QA sandbox. No provider settings, model
// messages, physical reservations or prior continuation budget are changed.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {DatabaseSync,backup}=require('node:sqlite');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function controlSnapshot(file){const db=new DatabaseSync(file,{readOnly:true});try{return {
  control:db.prepare('SELECT * FROM control').all(),creations:db.prepare('SELECT * FROM creations ORDER BY role').all(),
  sends:db.prepare('SELECT * FROM sends ORDER BY operation_id').all(),budget:db.prepare('SELECT * FROM continuation_policy').all(),
  active:db.prepare('SELECT * FROM active_call').all(),leases:db.prepare('SELECT * FROM backend_lease').all()
};}finally{db.close();}}
async function prepare(){
  process.env.DECOHUB_OFFLINE_MODE='true';process.env.DECOHUB_ALLOW_LIVE_AGENTAPI='false';
  const repo=path.resolve(__dirname,'../../..'),root='C:/IA/DecoHUB-native-sandbox-20261009',file=root+'/control/native-normal-1.0.6.json';
  const previous=JSON.parse(fs.readFileSync(file)),config=structuredClone(previous);
  const artifact=path.join(repo,'dist-desktop-1.0.6-permissive','win-unpacked');
  assert.ok(fs.existsSync(artifact+'/resources/app.asar'));
  const ledgerFile=root+'/control/control.sqlite',before=controlSnapshot(ledgerFile),anchorHash=hash(root+'/control/ledger.anchor.json');
  assert.equal(before.creations.length,2);assert.equal(before.sends.length,3);assert.equal(before.active.length,0);assert.equal(before.leases.length,0);assert.equal(before.control[0].halt_reason,null);
  assert.ok(before.sends.every(s=>s.status==='CONFIRMED'));assert.ok(before.creations.every(s=>s.status==='CONFIRMED'));
  assert.equal(fs.existsSync(root+'/control/live-approval.json'),false);
  const metadataFile=path.join(config.nativeUserProfile,'.gemini/config/projects',config.nativeProjectId+'.json'),metadataHash=hash(metadataFile);
  const data=new DatabaseSync(root+'/data/hub.db',{readOnly:true});const sessions=data.prepare('SELECT * FROM agent_sessions ORDER BY role').all();
  assert.equal(sessions.length,2);assert.equal(data.prepare('SELECT COUNT(*) n FROM autonomous_runs').get().n,0);assert.equal(data.prepare('SELECT COUNT(*) n FROM autonomous_tasks').get().n,0);
  const destination=root+'/backups/before-allow-eager-1.0.6';assert.ok(!fs.existsSync(destination),'Do not overwrite a prior preparation backup');fs.mkdirSync(destination,{recursive:true});
  await backup(data,destination+'/hub.db');data.close();const ledger=new DatabaseSync(ledgerFile,{readOnly:true});await backup(ledger,destination+'/control.sqlite');ledger.close();
  fs.copyFileSync(file,destination+'/native-normal-1.0.6.json');fs.copyFileSync(root+'/control/ledger.anchor.json',destination+'/ledger.anchor.json');
  fs.cpSync(root+'/guard/final106',destination+'/final106-guards',{recursive:true});
  config.artifactRoot=artifact;config.packagedServer=artifact+'/resources/app.asar.unpacked/server/dist';config.clientDist=artifact+'/resources/app.asar.unpacked/client/dist';
  config.buildRevision='1.0.6-explicit-allow-eager';
  config.executionPolicy={mode:'permissive',acknowledgement:{userConsent:'Decisão explícita do usuário: minhas configurações globais são ALLOW/EAGER intencionalmente; o DecoHUB deve aceitar esse modo sem alterá-las.',outsideAccessAllowed:true,automaticCommandsAllowed:true,noFilesystemIsolation:true}};
  require('./verification-tool.cjs').assertQaProjectPolicy(JSON.parse(fs.readFileSync(metadataFile)),config);
  assert.equal(JSON.parse(fs.readFileSync(path.join(config.packagedServer,'../package.json'))).version,'1.0.6');
  const copied=['native-normal-preload.cjs','normal-flow-policy.cjs','verification-tool.cjs','qa-safe-executor.cjs','qa-process-guard.cjs','http-independent-acceptance.template.cjs','launch.cjs','reconcile-policy.cjs'];
  for(const name of copied)fs.copyFileSync(path.join(__dirname,name),path.join(root,'guard/final106',name));
  for(const key of Object.keys(config.normalFlow.guardHashes))config.normalFlow.guardHashes[key]=hash(key);
  config.normalFlow.productHashes=Object.fromEntries([...fs.readdirSync(config.packagedServer).filter(n=>n.endsWith('.js')).map(n=>path.join(config.packagedServer,n)),artifact+'/DecoHUB.exe',artifact+'/resources/app.asar'].map(f=>[f,hash(f)]));
  config.packagedGatewayHash=hash(config.packagedServer+'/agentApiGateway.js');config.normalFlow.accountManagerHash=hash(config.packagedServer+'/accountProfileManager.js');
  assert.deepEqual(config.binding,previous.binding);assert.equal(config.normalFlow.baselineSends,3);assert.equal(config.normalFlow.maxSends,6);
  for(const [name,expected]of Object.entries(config.normalFlow.preserveFileHashes))assert.equal(hash(path.join(config.projectRoot,name)),expected);
  fs.writeFileSync(file+'.prepared',JSON.stringify(config,null,2));fs.renameSync(file+'.prepared',file);
  const reconciliation=require('./reconcile-policy.cjs').reconcile(config);
  const finalData=new DatabaseSync(root+'/data/hub.db',{readOnly:true});assert.deepEqual(finalData.prepare('SELECT * FROM agent_sessions ORDER BY role').all(),sessions);finalData.close();
  assert.deepEqual(controlSnapshot(ledgerFile),before);assert.equal(hash(root+'/control/ledger.anchor.json'),anchorHash);assert.equal(hash(metadataFile),metadataHash);
  const receipt={at:new Date().toISOString(),status:'PASS',buildRevision:config.buildRevision,artifactRoot:artifact,metadataUnchanged:true,reconciliation,sessionsPreserved:true,ledgerRowsPreserved:true,anchorPreserved:true,physicalReservations:2,priorSends:3,remainingSends:6,newRealCalls:0,newPhysicalConversations:0,backup:destination,readyForInference:false,remainingHumanRequirements:['Fresh account/plan/credits/no active agents confirmation','Specific authorization for revised 1.0.6 acknowledging native outside-scope risk']};
  fs.writeFileSync(root+'/control/native106-permissive-preparation.json',JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));return receipt;
}
if(require.main===module)prepare().catch(error=>{console.error(error.stack);process.exitCode=1;});
module.exports={prepare,controlSnapshot};
