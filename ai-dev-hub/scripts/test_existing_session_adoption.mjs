import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import {DatabaseSync,backup} from 'node:sqlite';
import puppeteer from 'puppeteer-core';

const native='C:/IA/DecoHUB-native-sandbox-20261009';
const cfg=JSON.parse(fs.readFileSync(path.join(native,'sandbox.json'),'utf8'));
const root=fs.mkdtempSync(path.join(os.tmpdir(),'decohub-session-adoption-'));
const output=path.join(native,'logs/finish-1.0.5');fs.mkdirSync(output,{recursive:true});
const cloneProject=path.join(root,'project');
fs.cpSync(cfg.projectRoot,cloneProject,{recursive:true,filter:f=>!['.git','node_modules','.ai-dev-hub'].includes(path.basename(f))});
const source=new DatabaseSync(path.join(cfg.dataRoot,'hub.db'),{readOnly:true});
await backup(source,path.join(root,'hub.db'));source.close();
const db=new DatabaseSync(path.join(root,'hub.db'));
db.prepare('UPDATE projects SET path=?,active_account_profile_id=? WHERE id=?').run(cloneProject,'acc-pro-1',cfg.binding.projectId);
db.prepare('UPDATE account_profiles SET environment_path=?,auth_status=? WHERE id=?').run(path.join(root,'profile'),'READY','acc-pro-1');
const idsBefore=db.prepare('SELECT id,role,provider_conversation_id,status,metadata_json FROM agent_sessions ORDER BY role').all();
const creationsBefore=db.prepare("SELECT COUNT(*) n FROM session_creation_telemetry WHERE event_type='CREATE_SUCCESS'").get().n;
const originalHashes=Object.fromEntries(['src/server.cjs','src/calculator.cjs','test/calculator.test.cjs','test/calculator-regression.test.cjs','test/server.test.cjs','test/controller-http-acceptance.test.cjs'].map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(cfg.projectRoot,f))).digest('hex')]));
const appPath=path.resolve('dist-desktop-1.0.5/win-unpacked/DecoHUB.exe'),port=19326;
const env={...process.env,AI_DEV_HUB_DATA_DIR:root,DECOHUB_OFFLINE_MODE:'true',DECOHUB_ALLOW_LIVE_AGENTAPI:'false',DECOHUB_TEST_PROVIDER_MODULE:path.resolve('scripts/native-preflight/session-adoption-fixture.cjs')};
delete env.NODE_OPTIONS;delete env.ELECTRON_RUN_AS_NODE;
let app,browser,page,log='';const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function open(){
  app=spawn(appPath,[`--remote-debugging-port=${port}`],{env,windowsHide:true,stdio:'pipe'});app.stdout.on('data',d=>log+=d);app.stderr.on('data',d=>log+=d);
  for(let i=0;i<50;i++){try{browser=await puppeteer.connect({browserURL:`http://127.0.0.1:${port}`});break;}catch{await wait(300);}}
  assert.ok(browser,'Electron did not start');
  for(let i=0;i<50;i++){page=(await browser.pages()).find(p=>/^http:\/\/127\.0\.0\.1:/.test(p.url()));if(page)break;await wait(300);}
  await page.waitForFunction(()=>document.body.innerText.includes('Homologação nativa controlada'),{timeout:15000});
  const b=await page.waitForSelector('::-p-text(Homologação nativa controlada)');await b.click();await wait(300);
  await page.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.innerText.trim().startsWith('💬 Chat'));b.click();});
  await page.waitForSelector('textarea');
}
async function close(){if(browser){await browser.disconnect();browser=null;}if(app?.pid)try{execFileSync('taskkill',['/pid',String(app.pid),'/f','/t'],{stdio:'ignore',windowsHide:true});}catch{}await wait(700);}
try{
  await open();
  const health=await fetch(new URL('/api/health',page.url())).then(r=>r.json());assert.equal(health.offline,true);assert.equal(path.resolve(health.dataPath),path.join(root,'hub.db'));
  const prompt=fs.readFileSync(path.join(native,'control/normal-chat-prompt-1.0.5.txt'),'utf8').trim();
  const input=await page.$('textarea');await input.type(prompt);await input.press('Enter');
  let run;
  for(let i=0;i<100;i++){run=db.prepare('SELECT * FROM autonomous_runs WHERE project_id=?').get(cfg.binding.projectId);if(run?.status==='waiting_approval')break;await wait(300);}
  assert.equal(run.status,'waiting_approval');
  const runId=run.id;
  assert.equal(db.prepare('SELECT COUNT(*) n FROM autonomous_tasks WHERE run_id=?').get(runId).n,1);
  await page.waitForFunction(()=>document.body.innerText.includes('Ação pendente no Antigravity'),{timeout:10000});await page.screenshot({path:path.join(output,'adoption-native-wait.png'),fullPage:true});
  const count=()=>JSON.parse(fs.readFileSync(path.join(root,'fixture-calls.json'),'utf8')).length;
  assert.equal(count(),2);assert.equal(db.prepare('SELECT COUNT(*) n FROM evaluation_results WHERE task_id IN(SELECT id FROM autonomous_tasks WHERE run_id=?)').get(runId).n,0);
  await close();await open();
  assert.equal(db.prepare('SELECT status FROM autonomous_runs WHERE id=?').get(runId).status,'waiting_approval');assert.equal(count(),2);
  // Simulated manual approval resolves the already dispatched tool, without another message.
  const transcript=path.join(root,'profile/.gemini/antigravity/brain/d4cbb8f9-a415-4693-876c-2105fc517212/.system_generated/logs/transcript.jsonl');
  fs.appendFileSync(transcript,JSON.stringify({type:'GENERIC_TOOL_CALL_RESULT',status:'DONE',step_index:59})+'\n'+JSON.stringify({type:'PLANNER_RESPONSE',status:'DONE',step_index:60,content:'EXPLICIT OFFLINE FIXTURE: repaired URL handling in copied API; require independent evaluation.'})+'\n');
  await page.evaluate(()=>{const buttons=[...document.querySelectorAll('button')];const b=buttons.find(b=>b.innerText.trim()==='Retomar')||buttons.find(b=>b.innerText.trim()==='Continuar');if(!b)throw Error('Resume button missing');b.click();});
  for(let i=0;i<100;i++){run=db.prepare('SELECT * FROM autonomous_runs WHERE id=?').get(runId);if(run.status==='completed')break;await wait(300);}
  assert.equal(run.status,'completed','Recovered run failed: '+run.last_error);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM autonomous_runs WHERE project_id=?').get(cfg.binding.projectId).n,1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM autonomous_tasks WHERE run_id=?').get(runId).n,1);
  assert.deepEqual(db.prepare('SELECT id,role,provider_conversation_id,status,metadata_json FROM agent_sessions ORDER BY role').all(),idsBefore);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM session_creation_telemetry WHERE event_type='CREATE_SUCCESS'").get().n,creationsBefore);
  const calls=JSON.parse(fs.readFileSync(path.join(root,'fixture-calls.json'),'utf8'));assert.deepEqual(calls.map(c=>c.role),['SUPERVISOR','WORKER','SUPERVISOR','SUPERVISOR']);
  const report=db.prepare('SELECT * FROM builder_reports WHERE run_id=?').get(runId);assert.deepEqual(JSON.parse(report.files_changed_json),['src/server.cjs']);
  const evaluation=db.prepare('SELECT * FROM evaluation_results WHERE task_id IN(SELECT id FROM autonomous_tasks WHERE run_id=?)').get(runId);assert.equal(evaluation.verdict,'PASS');
  await page.waitForFunction(()=>document.body.innerText.includes('Concluído'),{timeout:10000});await page.screenshot({path:path.join(output,'adoption-completed.png'),fullPage:true});
  for(const [file,hash]of Object.entries(originalHashes))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(cfg.projectRoot,file))).digest('hex'),hash,'Original Worker/QA file changed: '+file);
  const result={status:'PASS',build:'1.0.5',scope:'OFFLINE ONLY: model responses, repair edit and manual tool approval simulated in temporary copy of existing sandbox',originalProjectUnchanged:true,originalLedgerUntouched:true,tempData:root,runId,runStatus:run.status,taskCount:1,sessions:idsBefore,calls,attributedFiles:JSON.parse(report.files_changed_json),evaluation:JSON.parse(report.evaluation_json),restartRecoveredWithoutResend:true,realAgentCalls:0,newPhysicalConversations:0};
  fs.writeFileSync(path.join(output,'existing-session-adoption-offline.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({status:result.status,runId,calls:calls.length,sameSessionIds:true,realAgentCalls:0,physicalCreations:0}));
}catch(e){if(page){await page.screenshot({path:path.join(output,'adoption-failed.png')}).catch(()=>{});log+='\n'+await page.evaluate(()=>document.body.innerText).catch(()=> '');}fs.writeFileSync(path.join(output,'existing-session-adoption-failure.json'),JSON.stringify({status:'FAIL',tempData:root,error:e.message},null,2));throw e;}
finally{await close();db.close();fs.writeFileSync(path.join(output,'existing-session-adoption.log'),log);}
