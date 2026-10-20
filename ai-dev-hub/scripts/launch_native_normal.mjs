// Bootstrap only: all planning, task dispatch, evaluation and conclusion belong to the packaged product.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
const root='C:/IA/DecoHUB-native-sandbox-20261009';
const configFile=path.join(root,'control/native-normal-1.0.5.json');
if(!process.argv.includes('--authorized-start')){
  console.log('Prepared only. Requires specific user authorization and current live-approval.json; no backend, UI, inference or conversation started.');process.exit(0);
}
const config=JSON.parse(fs.readFileSync(configFile,'utf8'));
const approval=JSON.parse(fs.readFileSync(path.join(config.controlRoot,'live-approval.json'),'utf8'));
assert.equal(approval.scope,'NORMAL_CHAT_1.0.5_ONE_REPAIR_RUN');assert.equal(approval.authorization,'EXPLICIT_USER_AUTHORIZATION');
assert.ok([4,6].includes(approval.authorizedSends));
const checkedAt=Date.parse(approval.checkedAt);assert.ok(Number.isFinite(checkedAt)&&checkedAt<=Date.now()&&Date.now()-checkedAt<300000);assert.equal(approval.identityVerified,true);assert.equal(approval.creditOverages,'Never');assert.equal(approval.noOtherTasks,true);
const native=JSON.parse(fs.readFileSync(path.join('C:/Users/Deco/.gemini/config/projects',config.nativeProjectId+'.json'),'utf8'));
assert.equal(native.settings.fileAccessPolicy,'AGENT_SETTING_POLICY_DENY');assert.equal(native.settings.autoExecutionPolicy,'CASCADE_COMMANDS_AUTO_EXECUTION_OFF');
createRequire(import.meta.url)(path.join(root,'guard/qa-verification-bridge.cjs')).assertQaProjectPolicy(native);
await new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',reject);probe.listen(3001,'127.0.0.1',()=>probe.close(resolve));});
const env={...process.env,AI_DEV_HUB_DATA_DIR:config.dataRoot,DECOHUB_NATIVE_NORMAL_CONFIG:configFile,DECOHUB_OFFLINE_MODE:'false',DECOHUB_ALLOW_LIVE_AGENTAPI:'true'};
for(const key of Object.keys(env))if(/^(ANTIGRAVITY_|AGY_|CODEIUM_|ELECTRON_|NODE_OPTIONS|DECOHUB_TEST_PROVIDER_MODULE)/.test(key))delete env[key];
const output=path.join(root,'logs/native-normal-1.0.5');fs.mkdirSync(output,{recursive:true});
const fd=fs.openSync(path.join(output,'normal-backend.log'),'a');
const backend=spawn(process.execPath,['--require',path.join(root,'guard/native-normal-preload.cjs'),path.join(config.packagedServer,'index.js')],{env:{...env,ELECTRON_RUN_AS_NODE:'1',PORT:'3001',CLIENT_DIST_PATH:config.clientDist},windowsHide:true,stdio:['ignore',fd,fd,'ipc']});
let healthy=false;
for(let i=0;i<50;i++){try{const h=await fetch('http://127.0.0.1:3001/api/health').then(r=>r.json());assert.equal(path.resolve(h.dataPath),path.join(config.dataRoot,'hub.db'));assert.equal(h.offline,false);healthy=true;break;}catch{await new Promise(r=>setTimeout(r,300));}}
if(!healthy){if(backend.connected)backend.send({command:'native-normal-safe-shutdown'});throw Error('Guarded backend startup failed; no prompt sent');}
const app=spawn(path.join(config.artifactRoot,'DecoHUB.exe'),['--remote-debugging-port=19328'],{env,windowsHide:true,stdio:'ignore'});
fs.writeFileSync(path.join(output,'owned-processes.json'),JSON.stringify({backendPid:backend.pid,electronPid:app.pid,dataRoot:config.dataRoot,version:'1.0.5',bootstrapOnly:true,noPromptSubmittedByLauncher:true},null,2));
console.log(JSON.stringify({backendPid:backend.pid,electronPid:app.pid,version:'1.0.5',promptNotSent:true}));
process.on('SIGINT',()=>{if(backend.connected)backend.send({command:'native-normal-safe-shutdown'});});
backend.on('message',message=>{if(message.shutdownSafe===false)console.log('Shutdown refused: preserved Run or native turn still active.');});
backend.on('exit',code=>{fs.closeSync(fd);process.exitCode=code||0;});
