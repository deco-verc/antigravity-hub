import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import puppeteer from 'puppeteer-core';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'decohub-electron-proof-'));
const output=path.resolve(process.env.DECOHUB_EVIDENCE_DIR || 'docs/recovery-evidence');fs.mkdirSync(output,{recursive:true});
const appPath=path.resolve(process.env.DECOHUB_TEST_ARTIFACT_EXE || 'dist-desktop/win-unpacked/DecoHUB.exe');
const port=19325;
const preload=path.resolve('scripts/electron_sandbox_preload.cjs');
const env={...process.env,AI_DEV_HUB_DATA_DIR:root,DECOHUB_OFFLINE_MODE:'true',DECOHUB_ALLOW_LIVE_AGENTAPI:'false',DECOHUB_TEST_PROVIDER_MODULE:preload};
delete env.NODE_OPTIONS;
delete env.ELECTRON_RUN_AS_NODE;
let log='';
const launch=()=>{const child=spawn(appPath,[...(process.env.DECOHUB_TEST_ENTRY?[path.resolve(process.env.DECOHUB_TEST_ENTRY)]:[]),`--remote-debugging-port=${port}`],{env,windowsHide:true,stdio:'pipe'});child.stdout.on('data',d=>log+=d);child.stderr.on('data',d=>log+=d);return child;};
let app=launch();
let browser;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
try {
  for(let i=0;i<40;i++){try{browser=await puppeteer.connect({browserURL:`http://127.0.0.1:${port}`,defaultViewport:{width:1440,height:900}});break;}catch{await wait(500);}}
  assert.ok(browser,'Electron debugging endpoint did not start');
  let page;
  for(let i=0;i<40;i++){page=(await browser.pages()).find(p=>/^http:\/\/127\.0\.0\.1:/.test(p.url()));if(page)break;await wait(500);}
  assert.ok(page,'Packaged main renderer missing');
  await page.waitForFunction(()=>document.body.innerText.includes('Sandbox Pipeline'),{timeout:20000});
  let base=new URL(page.url()).origin;
  const health=await fetch(`${base}/api/health`).then(r=>r.json());
  assert.equal(path.resolve(health.dataPath),path.join(root,'hub.db'));
  assert.equal(health.offline,true);
  await page.waitForFunction(()=>document.body.innerText.includes('Modo offline · modelos reais desativados'));
  const db=new DatabaseSync(path.join(root,'hub.db'),{readOnly:true});
  const choose=async name=>{
    const button=await page.waitForSelector(`::-p-text(${name})`,{timeout:10000});await button.click();await wait(400);
    await page.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Chat Autônomo'||b.innerText.trim().startsWith('💬 Chat'));if(!b)throw Error('Chat tab missing');b.click();});
    await page.waitForSelector('textarea',{timeout:10000});
  };
  const send=async text=>{const input=await page.$('textarea');await input.type(text);await input.press('Enter');};
  // Project is created through the shipped UI. Only external model/tools are fixtures.
  await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Novo Projeto'||b.textContent.trim()==='+ Novo Projeto').click());
  await page.waitForSelector('input[placeholder="Ex: Simple IDE Test"]');
  await page.type('input[placeholder="Ex: Simple IDE Test"]','Evolution QA App');
  const newProjectFolder=path.join(root,'ui-created-project');
  const folderInput=await page.$('input[placeholder^="Ex: C:"]');await folderInput.type(newProjectFolder);
  await page.select('select','acc-pro-1');
  await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Não Integrar').click());
  await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Criar Projeto').click());
  await page.waitForFunction(()=>!document.body.innerText.includes('Criar ou Conectar Projeto'),{timeout:15000});
  const createdProject=db.prepare("SELECT * FROM projects WHERE name='Evolution QA App'").get();
  assert.ok(createdProject);assert.equal(path.resolve(createdProject.path),newProjectFolder);
  await choose('Evolution QA App');
  // Persist the explicit permissive choice through the shipped React controls.
  // Provider settings are not edited and the external models remain offline fixtures.
  let nativePolicyUiProof=null;
  if(process.env.DECOHUB_ASSERT_PERMISSIVE_UI==='true'){
    await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.innerText.trim()==='Configurações').click());
    await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.innerText.trim()==='Autonomia & Segurança').click());
    await page.waitForSelector('select[aria-label="Modo nativo"]:not([disabled])');
    const policyUrl=`${base}/api/projects/${createdProject.id}/native-execution-policy`;
    const rejected=await fetch(policyUrl,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'permissive'})});
    assert.equal(rejected.status,409);
    await page.select('select[aria-label="Modo nativo"]','permissive');
    const section='section[aria-label="Política nativa do Antigravity"]';
    assert.equal(await page.$eval(section+' button',el=>el.disabled),true);
    await page.click(section+' input[type="checkbox"]');
    await page.click(section+' button');
    await page.waitForFunction(()=>document.body.innerText.includes('Escolha salva: Allow / Eager'));
    assert.match(await page.$eval(section,el=>el.innerText),/não impede alterações fora dela/);
    const choice=await fetch(policyUrl).then(r=>r.json());assert.equal(choice.mode,'permissive');assert.equal(choice.acknowledgement.noFilesystemIsolation,true);
    await page.screenshot({path:path.join(output,'electron-permissive-policy.png'),fullPage:true});
    await page.click('button[title="Fechar painel avançado"]');
    await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.innerText.trim()==='Configurações').click());
    await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.innerText.trim()==='Autonomia & Segurança').click());
    await page.waitForFunction(()=>document.body.innerText.includes('Escolha salva: Allow / Eager'));
    await page.click('button[title="Fechar painel avançado"]');
    nativePolicyUiProof={mode:choice.mode,persistedAfterRemount:true,implicitOptInRejected:true,explicitAcknowledgementRequired:true,providerSettingsChanged:false,filesystemIsolationClaimed:false};
  }
  let submittedRequest;
  page.on('request',request=>{if(request.method()==='POST'&&request.url().endsWith(`/api/projects/${createdProject.id}/messages`))submittedRequest=JSON.parse(request.postData());});
  await page.type('textarea','Implemente dois incrementos de soma com validação de entradas.');
  // Two Enter events in one tick must produce one durable user request.
  await page.evaluate(()=>{const el=document.querySelector('textarea');for(let i=0;i<2;i++)el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));});
  for(let i=0;i<60&&!fs.existsSync(path.join(root,'offline-pending-turn.json'));i++)await wait(500);
  assert.ok(fs.existsSync(path.join(root,'offline-pending-turn.json')),'Worker never reached pending tool boundary');
  const interruptedRun=db.prepare('SELECT * FROM autonomous_runs WHERE project_id=?').get(createdProject.id);
  const interruptedSessions=db.prepare('SELECT role,provider_conversation_id FROM agent_sessions WHERE project_id=? ORDER BY role').all(createdProject.id);
  assert.equal(interruptedSessions.length,2);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM autonomous_runs WHERE project_id=?').get(createdProject.id).n,1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM messages WHERE project_id=? AND role='user'").get(createdProject.id).n,1);
  // A lost-response retry uses the same public route and request key: no second Run.
  assert.ok(submittedRequest?.requestId);
  const duplicate=await fetch(`${base}/api/projects/${createdProject.id}/messages`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(submittedRequest)});
  assert.equal(duplicate.status,200);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM autonomous_runs WHERE project_id=?').get(createdProject.id).n,1);
  await page.screenshot({path:path.join(output,'electron-interrupted.png'),fullPage:true});
  await browser.disconnect();browser=null;
  execFileSync('taskkill',['/pid',String(app.pid),'/f','/t'],{stdio:'ignore',windowsHide:true});await wait(1200);app=launch();
  for(let i=0;i<40;i++){try{browser=await puppeteer.connect({browserURL:`http://127.0.0.1:${port}`,defaultViewport:{width:1440,height:900}});break;}catch{await wait(500);}}
  assert.ok(browser,'Restart during task failed');
  for(let i=0;i<40;i++){page=(await browser.pages()).find(p=>/^http:\/\/127\.0\.0\.1:/.test(p.url()));if(page)break;await wait(500);}
  await page.waitForFunction(()=>document.body.innerText.includes('Evolution QA App'),{timeout:20000});base=new URL(page.url()).origin;
  await choose('Evolution QA App');
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Retomar'),{timeout:12000});
  await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Retomar').click());
  for(let i=0;i<90;i++){
    const state=db.prepare('SELECT * FROM autonomous_runs WHERE id=?').get(interruptedRun.id);
    if(state.status==='completed')break;
    if(i===89)throw Error('Interrupted UI Run did not finish: '+JSON.stringify(state));
    await wait(500);
  }
  assert.deepEqual(db.prepare('SELECT role,provider_conversation_id FROM agent_sessions WHERE project_id=? ORDER BY role').all(createdProject.id),interruptedSessions);
  const recoveredEvaluations=db.prepare('SELECT verdict FROM evaluation_results WHERE task_id IN(SELECT id FROM autonomous_tasks WHERE run_id=?)').all(interruptedRun.id);
  assert.deepEqual(recoveredEvaluations.map(e=>e.verdict).sort(),['FAIL','PASS','PASS']);
  assert.equal(db.prepare('SELECT last_error FROM autonomous_runs WHERE id=?').get(interruptedRun.id).last_error,null);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM autonomous_tasks WHERE run_id=?').get(interruptedRun.id).n,2);
  const workerAttempts=JSON.parse(fs.readFileSync(path.join(root,'offline-worker-attempts.json'),'utf8')).filter(([key])=>key.startsWith(createdProject.id+':'));
  assert.deepEqual(workerAttempts.map(([key,count])=>[key.split(':')[1],count]).sort(),[['1',2],['2',1]]);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM autonomous_events WHERE run_id=? AND event_type='NATIVE_TURN_RECONCILED'").get(interruptedRun.id).n,1);
  await wait(2500);await page.screenshot({path:path.join(output,'electron-ui-created-recovered.png'),fullPage:true});
  const uiCreatedProof={projectId:createdProject.id,projectPath:newProjectFolder,runId:interruptedRun.id,sessions:interruptedSessions,evaluations:recoveredEvaluations,workerAttempts,restartDuringTurn:true,duplicateRequestSuppressed:true};
  await choose('Sandbox Pipeline');
  await send('Implemente dois incrementos de soma com validação de entradas e continue preservando o contexto.');
  await page.waitForFunction(()=>document.body.innerText.includes('Plano criado'),{timeout:20000});
  for(let i=0;i<80;i++){
    const run=db.prepare("SELECT * FROM autonomous_runs WHERE project_id='sandbox-main'").get();
    if(run?.status==='completed')break;
    if(i===79)throw Error('Sandbox run failed to complete: '+JSON.stringify(run));
    await wait(500);
  }
  await wait(2800);
  await page.screenshot({path:path.join(output,'electron-pipeline.png'),fullPage:true});
  assert.ok((await page.evaluate(()=>document.body.innerText)).includes('Concluído'));
  const run=db.prepare("SELECT * FROM autonomous_runs WHERE project_id='sandbox-main'").get();
  const sessions=db.prepare("SELECT role,provider_conversation_id FROM agent_sessions WHERE project_id='sandbox-main'").all();
  assert.equal(sessions.length,2);
  const evaluations=db.prepare('SELECT verdict FROM evaluation_results WHERE task_id IN (SELECT id FROM autonomous_tasks WHERE run_id=?)').all(run.id);
  assert.equal(evaluations.filter(e=>e.verdict==='PASS').length,2);assert.equal(evaluations.filter(e=>e.verdict==='FAIL').length,1);
  const tabs=[];
  for(const [name,text] of [['Tarefas','Implementar incremento 2'],['Atividade','Implementar incremento']]) {
    await page.evaluate(name=>{const b=[...document.querySelectorAll('button')].find(b=>b.innerText.trim().startsWith(name));if(!b)throw Error('Missing tab '+name);b.click();},name);
    await page.waitForFunction(text=>document.body.innerText.includes(text),{timeout:10000},text);
    await page.screenshot({path:path.join(output,`electron-${name==='Tarefas'?'tasks':'activity'}.png`),fullPage:true});tabs.push({name,visible:true});
  }
  const failures=[];
  for(const [name,error] of [['Sandbox sem autorização','AUTHORIZATION_GUARD'],['Sandbox autenticação expirada','AUTH_ERROR'],['Sandbox plano inválido','SUPERVISOR_UNAVAILABLE'],['Sandbox provider indisponível','RUNTIME_UNAVAILABLE']]){
    await choose(name);await send('Implemente soma validada neste projeto.');
    await page.waitForFunction(e=>document.body.innerText.includes(e),{timeout:12000},error);
    await page.waitForFunction(()=>document.querySelector('header')?.innerText.includes('Execução bloqueada'),{timeout:6000});
    failures.push({name,error,visible:true});
  }
  await page.screenshot({path:path.join(output,'electron-visible-block.png'),fullPage:true});
  let nativeWaitVisible=null;
  if(process.env.DECOHUB_ASSERT_NATIVE_WAIT_UI==='true'){
    await choose('Sandbox aprovação nativa pendente');
    await page.waitForFunction(()=>[...document.querySelectorAll('[role="status"]')].some(e=>e.innerText.includes('Ação pendente no Antigravity')),{timeout:10000});
    await page.screenshot({path:path.join(output,'electron-native-wait.png'),fullPage:true});nativeWaitVisible=true;
  }
  const creations=db.prepare("SELECT project_id,event_type,origin,conversation_id FROM session_creation_telemetry WHERE event_type='CREATE_SUCCESS'").all();
  assert.ok(creations.every(c=>c.origin==='TEST'));
  assert.equal(creations.filter(c=>c.project_id==='sandbox-main').length,2);
  assert.ok(!log.includes('Disparando comando físico'));
  await browser.disconnect();browser=null;
  // Terminate only the fixture instance owned by this test, then reopen the same isolated DB.
  execFileSync('taskkill',['/pid',String(app.pid),'/f','/t'],{stdio:'ignore',windowsHide:true});await wait(1200);app=launch();
  for(let i=0;i<40;i++){try{browser=await puppeteer.connect({browserURL:`http://127.0.0.1:${port}`,defaultViewport:{width:1440,height:900}});break;}catch{await wait(500);}}
  assert.ok(browser,'Restart failed');
  for(let i=0;i<40;i++){page=(await browser.pages()).find(p=>/^http:\/\/127\.0\.0\.1:/.test(p.url()));if(page)break;await wait(500);}
  await page.waitForFunction(()=>document.body.innerText.includes('Sandbox Pipeline'),{timeout:20000});await choose('Sandbox Pipeline');
  await page.waitForFunction(()=>document.body.innerText.includes('Concluído'),{timeout:12000});
  assert.deepEqual(db.prepare("SELECT role,provider_conversation_id FROM agent_sessions WHERE project_id='sandbox-main'").all(),sessions);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM session_creation_telemetry WHERE project_id='sandbox-main' AND event_type='CREATE_SUCCESS'").get().n,2);
  assert.equal(db.prepare('SELECT status FROM autonomous_runs WHERE id=?').get(run.id).status,'completed');
  await page.screenshot({path:path.join(output,'electron-restarted.png'),fullPage:true});
  const result={status:'PASS',executionMode:process.env.DECOHUB_TEST_ENTRY?'source-development':'packaged',nativePolicyUiProof,uiCreatedProof,executable:appPath,dataDir:root,backendUrl:base,health,runId:run.id,runStatus:run.status,sessions,evaluations,failures,tabs,nativeWaitVisible,restart:{sameRun:true,sameSessionIds:true,newFixtureCreations:0},realAgentApiCalls:0,realConversations:0,fixture:'External model responses and Worker tool boundary are simulated; product routes, UI, Runner, transcript parser and Evaluator are real.'};
  fs.writeFileSync(path.join(output,'electron-sandbox.json'),JSON.stringify(result,null,2));db.close();console.log(JSON.stringify(result,null,2));
} catch (error) {
  if(browser){for(const [i,page]of (await browser.pages()).entries()){
    await page.screenshot({path:path.join(output,`electron-failure-${i}.png`)}).catch(()=>{});
    log+=`\nPAGE ${page.url()}\n${await page.evaluate(()=>document.body.innerText).catch(()=> '')}`;
  }}
  fs.writeFileSync(path.join(output,'electron-sandbox-failure.json'),JSON.stringify({status:'FAIL',dataDir:root,error:error.message},null,2));
  throw error;
} finally {
  if(browser)await browser.disconnect();
  if(app.pid)try{execFileSync('taskkill',['/pid',String(app.pid),'/f','/t'],{stdio:'ignore',windowsHide:true});}catch{}
  fs.writeFileSync(path.join(output,'electron-sandbox.log'),log);
  // Evidence and isolated DB are retained for inspection. Production was never selected.
}
