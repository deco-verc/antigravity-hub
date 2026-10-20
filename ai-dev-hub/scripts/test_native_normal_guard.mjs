import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {DatabaseSync,backup} from 'node:sqlite';
import puppeteer from 'puppeteer-core';
const native='C:/IA/DecoHUB-native-sandbox-20261009';
const config=JSON.parse(fs.readFileSync(path.join(native,'control/native-normal-1.0.5.json'),'utf8'));
const root=fs.mkdtempSync(path.join(os.tmpdir(),'decohub-normal-guard-'));fs.mkdirSync(path.join(root,'data'));fs.mkdirSync(path.join(root,'control'));
fs.cpSync(path.join(native,'guard'),path.join(root,'guard'),{recursive:true});fs.cpSync(config.projectRoot,path.join(root,'project'),{recursive:true,filter:f=>!['.git','node_modules','.ai-dev-hub'].includes(path.basename(f))});
for(const [source,destination]of [[path.join(config.dataRoot,'hub.db'),path.join(root,'data/hub.db')],[path.join(config.controlRoot,'control.sqlite'),path.join(root,'control/control.sqlite')]]){const d=new DatabaseSync(source,{readOnly:true});await backup(d,destination);d.close();}
for(const file of ['ledger.anchor.json','operations.jsonl'])fs.copyFileSync(path.join(config.controlRoot,file),path.join(root,'control',file));
const clone={...config,root,dataRoot:path.join(root,'data'),controlRoot:path.join(root,'control'),projectRoot:path.join(root,'project'),normalFlow:{...config.normalFlow,guardHashes:Object.fromEntries(Object.entries(config.normalFlow.guardHashes).map(([file,hash])=>[file.replace(path.resolve(native),root),hash]))}};
// Manifest hash keys use platform paths. Remap only files actually copied into the test guard.
clone.normalFlow.guardHashes=Object.fromEntries(Object.entries(config.normalFlow.guardHashes).map(([file,hash])=>[path.relative(path.resolve(native),file).startsWith('..')?file:path.join(root,path.relative(path.resolve(native),file)),hash]));
fs.mkdirSync(path.join(root,'verification'));fs.copyFileSync(path.join(native,'verification/verify-project.cjs'),path.join(root,'verification/verify-project.cjs'));
const configFile=path.join(root,'control/native-normal-1.0.5.json');fs.writeFileSync(configFile,JSON.stringify(clone,null,2));
const baselineData=new DatabaseSync(path.join(root,'data/hub.db'),{readOnly:true});
const baselineProfiles=baselineData.prepare('SELECT * FROM account_profiles ORDER BY id').all();baselineData.close();
const port=19327,appPath=path.join(config.artifactRoot,'DecoHUB.exe');
const env={...process.env,AI_DEV_HUB_DATA_DIR:clone.dataRoot,DECOHUB_NATIVE_NORMAL_CONFIG:configFile,DECOHUB_OFFLINE_MODE:'true',DECOHUB_ALLOW_LIVE_AGENTAPI:'false'};
delete env.DECOHUB_TEST_PROVIDER_MODULE;delete env.ELECTRON_RUN_AS_NODE;
delete env.NODE_OPTIONS;
let app,browser,page,log='';
const backend=spawn(process.execPath,['--require',path.join(root,'guard/native-normal-preload.cjs'),path.join(config.packagedServer,'index.js')],{env:{...env,ELECTRON_RUN_AS_NODE:'1',PORT:'3001',CLIENT_DIST_PATH:config.clientDist},windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});backend.stdout.on('data',d=>log+=d);backend.stderr.on('data',d=>log+=d);
const wait=ms=>new Promise(r=>setTimeout(r,ms)),output=path.join(native,'logs/finish-1.0.5');
try{
  let healthy=false;
  for(let i=0;i<50;i++){try{const h=await fetch('http://127.0.0.1:3001/api/health').then(r=>r.json());if(path.resolve(h.dataPath)!==path.join(root,'data/hub.db'))throw Error('Unrelated backend occupies 3001');healthy=true;break;}catch(e){if(e.message.includes('Unrelated'))throw e;await wait(300);}}
  assert.ok(healthy,'Guarded normal backend did not start');
  app=spawn(appPath,[`--remote-debugging-port=${port}`],{env,windowsHide:true,stdio:'pipe'});app.stdout.on('data',d=>log+=d);app.stderr.on('data',d=>log+=d);
  for(let i=0;i<70;i++){try{browser=await puppeteer.connect({browserURL:`http://127.0.0.1:${port}`});break;}catch{await wait(300);}}
  assert.ok(browser,'Guarded Electron did not start');
  for(let i=0;i<70;i++){page=(await browser.pages()).find(p=>/^http:\/\/127\.0\.0\.1:/.test(p.url()));if(page)break;await wait(300);}
  assert.ok(page,'Guarded renderer missing');
  const health=await fetch(new URL('/api/health',page.url())).then(r=>r.json());assert.equal(path.resolve(health.dataPath),path.join(root,'data/hub.db'));assert.equal(health.offline,true);
  const ledger=new DatabaseSync(path.join(root,'control/control.sqlite'),{readOnly:true});
  assert.ok(ledger.prepare("SELECT 1 FROM events WHERE event='NORMAL_ELECTRON_GUARD_READY'").get(),'Native preload did not install in actual packaged backend');
  assert.equal(ledger.prepare('SELECT COUNT(*) n FROM backend_lease').get().n,1);
  assert.equal(ledger.prepare('SELECT COUNT(*) n FROM creations').get().n,2);assert.equal(ledger.prepare('SELECT COUNT(*) n FROM sends').get().n,3);ledger.close();
  const data=new DatabaseSync(path.join(root,'data/hub.db'),{readOnly:true});
  assert.equal(data.prepare('SELECT COUNT(*) n FROM autonomous_runs').get().n,0);assert.equal(data.prepare("SELECT COUNT(*) n FROM agent_sessions WHERE status='ACTIVE'").get().n,2);assert.deepEqual(data.prepare('SELECT * FROM account_profiles ORDER BY id').all(),baselineProfiles);data.close();
  assert.equal(new URL(page.url()).port,'3001','Electron must attach to the guarded normal backend');
  const acknowledged=new Promise(resolve=>backend.once('message',resolve));backend.send({command:'native-normal-safe-shutdown'});
  assert.equal((await acknowledged).shutdownSafe,true);
  for(let i=0;i<40&&backend.exitCode===null;i++)await wait(100);
  assert.equal(backend.exitCode,0);
  const closed=new DatabaseSync(path.join(root,'control/control.sqlite'),{readOnly:true});assert.equal(closed.prepare('SELECT COUNT(*) n FROM backend_lease').get().n,0);closed.close();
  const result={status:'PASS',scope:'OFFLINE GUARD SMOKE ONLY; no prompt, no model/tool fixture',version:'1.0.5',guardInstalled:true,fixtureInstalled:false,gracefulOwnedShutdown:true,backendLeaseReleased:true,backendBootstrap:'Packaged index.js protected with explicit --require; Electron attaches through existing same-data/same-mode service support',tempData:root,health,physicalReservationsInCopiedLedger:2,continuationsInCopiedLedger:3,normalRuns:0,realAgentCalls:0,originalSandboxUnmodified:true};
  fs.writeFileSync(path.join(output,'native-normal-guard-smoke.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(e){fs.writeFileSync(path.join(output,'native-normal-guard-failure.json'),JSON.stringify({status:'FAIL',tempData:root,error:e.message},null,2));throw e;}
finally{if(browser)await browser.disconnect();if(app?.pid)try{execFileSync('taskkill',['/pid',String(app.pid),'/f','/t'],{stdio:'ignore',windowsHide:true});}catch{}if(backend.pid&&backend.exitCode===null)backend.kill();fs.writeFileSync(path.join(output,'native-normal-guard.log'),log);}
