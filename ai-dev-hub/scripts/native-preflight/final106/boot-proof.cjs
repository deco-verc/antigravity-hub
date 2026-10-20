'use strict';
// Offline boot/adoption proof against a copy of the preserved state. No prompt,
// fake model, new project registration or operation against the original DB.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {DatabaseSync,backup}=require('node:sqlite');
async function proof(){
  const native='C:/IA/DecoHUB-native-sandbox-20261009',cfg=JSON.parse(fs.readFileSync(native+'/control/native-normal-1.0.6.json'));
  const temp=fs.mkdtempSync(path.join(process.env.TEMP||require('node:os').tmpdir(),'native106-boot-proof-'));
  fs.mkdirSync(temp+'/data');fs.mkdirSync(temp+'/control');fs.cpSync(native+'/guard',temp+'/guard',{recursive:true});
  fs.mkdirSync(temp+'/verification');fs.copyFileSync(native+'/verification/verify-project.cjs',temp+'/verification/verify-project.cjs');
  fs.cpSync(native+'/project',temp+'/project',{recursive:true,filter:file=>!['.git','node_modules'].includes(path.basename(file))});
  for(const [source,target] of [[cfg.dataRoot+'/hub.db',temp+'/data/hub.db'],[cfg.controlRoot+'/control.sqlite',temp+'/control/control.sqlite']]){const db=new DatabaseSync(source,{readOnly:true});await backup(db,target);db.close();}
  fs.copyFileSync(native+'/control/ledger.anchor.json',temp+'/control/ledger.anchor.json');
  const clone={...cfg,root:temp,dataRoot:temp+'/data',controlRoot:temp+'/control',projectRoot:temp+'/project',normalFlow:{...cfg.normalFlow,safeExecutor:temp+'/guard/final106/qa-safe-executor.cjs',guardHashes:Object.fromEntries(Object.entries(cfg.normalFlow.guardHashes).map(([file,hash])=>[path.resolve(file).toLowerCase().startsWith(path.resolve(native).toLowerCase()+path.sep)?path.join(temp,path.relative(native,file)):file,hash]))}};
  fs.writeFileSync(clone.normalFlow.safeExecutor,fs.readFileSync(clone.normalFlow.safeExecutor,'utf8').replace("ROOT='C:/IA/DecoHUB-native-sandbox-20261009'",'ROOT='+JSON.stringify(temp)));
  const executorHash=crypto.createHash('sha256').update(fs.readFileSync(clone.normalFlow.safeExecutor)).digest('hex');
  for(const file of Object.keys(clone.normalFlow.guardHashes))if(path.resolve(file).toLowerCase()===path.resolve(clone.normalFlow.safeExecutor).toLowerCase())clone.normalFlow.guardHashes[file]=executorHash;
  const db=new DatabaseSync(temp+'/data/hub.db');db.prepare('UPDATE projects SET path=? WHERE id=?').run(clone.projectRoot,cfg.binding.projectId);const sessions=db.prepare('SELECT * FROM agent_sessions ORDER BY role').all();db.close();
  const configFile=temp+'/control/config.json';fs.writeFileSync(configFile,JSON.stringify(clone));
  const env={...process.env,ELECTRON_RUN_AS_NODE:'1',AI_DEV_HUB_DATA_DIR:clone.dataRoot,DECOHUB_NATIVE_NORMAL_CONFIG:configFile,DECOHUB_OFFLINE_MODE:'true',DECOHUB_ALLOW_LIVE_AGENTAPI:'false',CLIENT_DIST_PATH:cfg.clientDist,PORT:'19329'};
  delete env.NODE_OPTIONS;delete env.DECOHUB_TEST_PROVIDER_MODULE;
  const child=cp.spawn(path.join(cfg.artifactRoot,'DecoHUB.exe'),['--require',temp+'/guard/final106/native-normal-preload.cjs',cfg.packagedServer+'/index.js'],{cwd:clone.projectRoot,env,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
  let log='';child.stdout.on('data',data=>log+=data);child.stderr.on('data',data=>log+=data);
  try{
    let health;for(let i=0;i<50;i++){if(child.exitCode!==null)throw Error('OFFLINE_BOOT_FAILED '+log.slice(-2000));try{health=await fetch('http://127.0.0.1:19329/api/health').then(r=>r.json());break;}catch{}await new Promise(resolve=>setTimeout(resolve,200));}
    assert.equal(health?.offline,true);assert.equal(path.resolve(health.dataPath),path.join(temp,'data/hub.db'));
    const data=new DatabaseSync(temp+'/data/hub.db',{readOnly:true});assert.deepEqual(data.prepare('SELECT * FROM agent_sessions ORDER BY role').all(),sessions);assert.equal(data.prepare('SELECT COUNT(*) n FROM autonomous_runs').get().n,0);data.close();
    const acknowledged=new Promise(resolve=>child.once('message',resolve));child.send({command:'native-normal-safe-shutdown'});assert.equal((await acknowledged).shutdownSafe,true);
    for(let i=0;i<30&&child.exitCode===null;i++)await new Promise(resolve=>setTimeout(resolve,100));assert.equal(child.exitCode,0);
    const ledger=new DatabaseSync(temp+'/control/control.sqlite',{readOnly:true});const physical=ledger.prepare('SELECT COUNT(*) n FROM creations').get().n,sends=ledger.prepare('SELECT COUNT(*) n FROM sends').get().n,leases=ledger.prepare('SELECT COUNT(*) n FROM backend_lease').get().n;ledger.close();assert.equal(physical,2);assert.equal(sends,3);assert.equal(leases,0);
    const result={status:'PASS',scope:'Guarded 1.0.6 backend boot/adoption only; not native Chat/Runner proof',temp,health,sessionsPreserved:true,originalDataNotUsedForWrites:true,copiedPhysicalReservations:physical,copiedSends:sends,safeShutdown:true,backendLeaseReleased:true,modelFixture:false,realCalls:0};
    fs.writeFileSync(native+'/control/native106-offline-boot.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  }finally{fs.writeFileSync(temp+'/backend.log',log);if(child.connected&&child.exitCode===null)child.send({command:'native-normal-safe-shutdown'});}
}
if(require.main===module)proof().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={proof};
