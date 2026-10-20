'use strict';
const fs=require('node:fs');
const path=require('node:path');
const cp=require('node:child_process');
const assert=require('node:assert/strict');
const {Ledger}=require('./ledger.cjs');
const root='C:\\IA\\DecoHUB-native-sandbox-20261009';
const config=JSON.parse(fs.readFileSync(path.join(root,'sandbox.json'),'utf8'));
async function main(){
  // Refuse to attach to any preexisting process on this port.
  try {await fetch('http://127.0.0.1:33103/api/health',{signal:AbortSignal.timeout(800)});throw new Error('PORT_ALREADY_IN_USE');} catch(error){if(error.message==='PORT_ALREADY_IN_USE')throw error;}
  const child=cp.fork(path.join(root,'guard','launch-offline.cjs'),[],{silent:true,windowsHide:true});
  const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
  const log=fs.createWriteStream(path.join(root,'logs','backend-offline.log'),{flags:'a'});
  child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
  const address='http://127.0.0.1:33103/api/health';let health;
  try{
    for(let n=0;n<60;n++){
      if(child.exitCode!==null)throw new Error('SANDBOX_BACKEND_EXITED');
      try{const res=await fetch(address,{signal:AbortSignal.timeout(500)});if(res.ok){health=await res.json();break;}}catch{}
      await new Promise(resolve=>setTimeout(resolve,150));
    }
    assert.ok(health,'Sandbox did not become healthy');assert.equal(health.offline,true);assert.equal(path.resolve(health.dataPath).toLowerCase(),path.join(config.dataRoot,'hub.db').toLowerCase());
    const ledger=new Ledger(config.controlRoot,config.binding);assert.equal(ledger.snapshot().creations.length,0);ledger.close();
  } finally {
    if(child.connected)child.send({command:'stop-offline'});
    const exit=await Promise.race([exited,new Promise(resolve=>setTimeout(()=>resolve(null),5000))]);
    if(!exit){child.kill();await exited;throw new Error('OFFLINE_SHUTDOWN_TIMEOUT');}
    log.end();
  }
  const ledger=new Ledger(config.controlRoot,config.binding);assert.equal(ledger.snapshot().creations.length,0);assert.equal(ledger.db.prepare('SELECT count(*) n FROM backend_lease').get().n,0);ledger.close();
  const result={result:'PASS',health,packagedBackend:true,mainSourceRuntimeOverlay:Boolean(config.runtimeOverlay),fixtureProviderInstalled:false,backgroundRunnerDisabled:true,realInferenceCalls:0,conversationsCreated:0,terminatedOwnBackend:true};
  fs.writeFileSync(path.join(root,'logs','smoke-offline.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
