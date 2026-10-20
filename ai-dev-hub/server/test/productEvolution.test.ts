import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';
import {db} from '../src/db.js';import {ChatSubmission} from '../src/chatSubmission.js';import {RunControl} from '../src/runControl.js';
import {planVerification,executeVerification,executeVerificationAsync} from '../src/controlledVerification.js';
import {AutonomousManager} from '../src/autonomousManager.js';
import {AutonomousRunnerService} from '../src/autonomousRunnerService.js';
import {IndependentEvaluator} from '../src/independentEvaluator.js';
import {AgentApiGateway} from '../src/agentApiGateway.js';
import {execFileSync} from 'node:child_process';
function seed(){const id=crypto.randomUUID(),now=new Date().toISOString();db.prepare('INSERT INTO projects(id,name,path,created_at,updated_at)VALUES(?,?,?,?,?)').run(id,'Offline Evolution',path.join(os.tmpdir(),id),now,now);return id;}
function run(project:string){const id=crypto.randomUUID(),now=new Date().toISOString();db.prepare("INSERT INTO autonomous_runs(id,project_id,name,objective,status,start_time,created_at,updated_at)VALUES(?,?,?,?,'building',?,?,?)").run(id,project,'Evolution','Independent execution',now,now,now);return id;}
test('durable chat intent suppresses duplicate submission and preserves lost responses',()=>{
  const p=seed(),id=crypto.randomUUID();const first=ChatSubmission.begin(p,id,'Implement a local module');assert.equal(first.isNew,true);
  assert.equal(ChatSubmission.begin(p,id,'Implement a local module').isNew,false);
  assert.equal((db.prepare('SELECT COUNT(*) n FROM messages WHERE project_id=?').get(p) as any).n,1);
  assert.throws(()=>ChatSubmission.begin(p,id,'different intent'),/CONTENT_CONFLICT/);
  const response={userMessage:{id:first.messageId},execution:{status:'started'}};ChatSubmission.complete(p,id,response);
  assert.deepEqual(ChatSubmission.begin(p,id,'Implement a local module').response,response);
  const uncertain=crypto.randomUUID();ChatSubmission.begin(p,uncertain,'second task');ChatSubmission.uncertain(p,uncertain);
  assert.equal(ChatSubmission.begin(p,uncertain,'second task').status,'uncertain');
});
test('pause/cancel preserve an in-flight reservation and completed history; cancellation cannot resume',()=>{
  const p=seed(),r=run(p),token=crypto.randomUUID();
  db.prepare('INSERT INTO execution_reservations (scope, token, owner_pid, context_json, created_at) VALUES(?,?,?,?,?)').run('global-agent-execution',token,process.pid,JSON.stringify({runId:r}),new Date().toISOString());
  RunControl.request(r,'cancel');assert.equal(RunControl.get(r).status,'pending');RunControl.apply(r);
  assert.equal((db.prepare('SELECT status FROM autonomous_runs WHERE id=?').get(r) as any).status,'paused');
  assert.ok(db.prepare('SELECT 1 FROM execution_reservations WHERE token=?').get(token));
  db.prepare('DELETE FROM execution_reservations WHERE token=?').run(token);RunControl.apply(r,true);
  assert.equal(RunControl.get(r).status,'applied');assert.equal((db.prepare('SELECT last_error FROM autonomous_runs WHERE id=?').get(r) as any).last_error,'RUN_CANCELLED');assert.throws(()=>RunControl.clearPause(r),/RUN_CANCELLED/);
  const paused=run(p);RunControl.request(paused,'pause');RunControl.apply(paused);assert.equal(RunControl.get(paused).status,'applied');RunControl.clearPause(paused);assert.equal(RunControl.get(paused),null);
});
test('a native ambiguous turn cannot be cleared by user cancellation',()=>{
  const p=seed(),r=run(p),task=crypto.randomUUID(),now=new Date().toISOString();
  db.prepare("INSERT INTO autonomous_tasks(id,run_id,title,description,status,created_at,updated_at)VALUES(?,?,?,?,'in_progress',?,?)").run(task,r,'Task','Task',now,now);
  db.prepare("INSERT INTO agent_turn_observations (conversation_id, task_id, project_path, brain_dir, baseline_lines, baseline_files_json, phase, dispatched_at) VALUES(?,?,?,?,?,?,'UNCERTAIN',?)").run(crypto.randomUUID(),task,os.tmpdir(),os.tmpdir(),0,'{}',now);
  RunControl.request(r,'cancel');RunControl.apply(r,true);assert.equal(RunControl.get(r).status,'pending');
  assert.equal((db.prepare('SELECT status FROM autonomous_tasks WHERE id=?').get(task) as any).status,'in_progress');
});
test('controlled verification rejects shell, escape, lifecycle and inline execution, and tests real code in a copy',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'decohub-operation-test-'));
  fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({scripts:{test:'node acceptance.cjs'}}));
  fs.writeFileSync(path.join(dir,'acceptance.cjs'),"const fs=require('node:fs');fs.writeFileSync('test-generated.txt','isolated');require('node:assert/strict').equal(2+3,5);console.log('ACTUAL_ASSERTIONS_PASS');");
  for(const cmd of ['node -e evil','npm test && whoami','node ../outside.cjs','npm install','node acceptance.cjs --eval=evil'])assert.throws(()=>planVerification(cmd,dir),/COMMAND_REVIEW_REQUIRED/);
  assert.match(executeVerification('npm test',dir),/ACTUAL_ASSERTIONS_PASS/);assert.equal(fs.existsSync(path.join(dir,'test-generated.txt')),false);
  fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({scripts:{test:'node acceptance.cjs',pretest:'evil'}}));assert.throws(()=>planVerification('npm test',dir),/lifecycle/);
  fs.writeFileSync(path.join(dir,'blocked.cjs'),"require('node:child_process').execFileSync(process.execPath,['--version']);");assert.throws(()=>executeVerification('node blocked.cjs',dir),/COMMAND_REVIEW_REQUIRED/);
});

test('queued intent survives failure in planning; its durable target is reused without another model call',async()=>{
  const p=seed(),source=run(p);fs.mkdirSync((db.prepare('SELECT path FROM projects WHERE id=?').get(p) as any).path,{recursive:true});
  db.prepare("UPDATE autonomous_runs SET status='completed' WHERE id=?").run(source);
  AutonomousManager.logEvent(source,null,'user','QUEUED_USER_INSTRUCTION','Next increment',{content:'Implement the next increment',durableContinuation:true});
  const provider=AgentApiGateway.installDefaultMock();let calls=0;
  provider.responseProvider=()=>{calls++;return '{invalid plan';};
  const config={projectId:p,name:'Continuation',objective:'ignored',briefing:'ignored',continuationSourceRunId:source};
  await assert.rejects(()=>AutonomousManager.createRun(config));
  const target:any=db.prepare("SELECT id FROM autonomous_runs WHERE project_id=? AND id<>?").get(p,source);assert.ok(target);
  const events:any[]=db.prepare("SELECT metadata_json FROM autonomous_events WHERE run_id=? AND event_type='QUEUED_USER_INSTRUCTION'").all(source);
  assert.equal(JSON.parse(events[0].metadata_json).targetRunId,target.id);
  const before=calls;assert.equal((await AutonomousManager.createRun(config)).id,target.id);assert.equal(calls,before);
  assert.equal(AutonomousManager.getQueuedContinuation(source).ids.length,0);
});

test('historical queued events are preserved without automatically reviving old instructions',()=>{
  const p=seed(),source=run(p);
  AutonomousManager.logEvent(source,null,'user','QUEUED_USER_INSTRUCTION','Historical request',{content:'Old unconfirmed request'});
  assert.equal(AutonomousManager.getQueuedContinuation(source).ids.length,0);
  const event:any=db.prepare("SELECT metadata_json FROM autonomous_events WHERE run_id=?").get(source);
  assert.equal(JSON.parse(event.metadata_json).consumed,undefined);
});

test('verification keeps the backend responsive, denies original writes and enforces deadlines',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'decohub-async-verification-'));
  fs.writeFileSync(path.join(dir,'delayed.cjs'),"setTimeout(()=>console.log('ASYNC_ASSERTION_PASS'),200);");
  let eventLoopAlive=false;const timer=setTimeout(()=>{eventLoopAlive=true;},20);
  assert.match(await executeVerificationAsync('node delayed.cjs',dir),/ASYNC_ASSERTION_PASS/);
  clearTimeout(timer);assert.equal(eventLoopAlive,true);
  fs.writeFileSync(path.join(dir,'deny-original.cjs'),`require('node:fs').writeFileSync(${JSON.stringify(path.join(dir,'forbidden.txt'))},'unsafe');`);
  await assert.rejects(()=>executeVerificationAsync('node deny-original.cjs',dir),/COMMAND_REVIEW_REQUIRED/);
  assert.equal(fs.existsSync(path.join(dir,'forbidden.txt')),false);
  fs.writeFileSync(path.join(dir,'deadline.cjs'),"setTimeout(()=>console.log('should not finish'),10000);");
  await assert.rejects(()=>executeVerificationAsync('node deadline.cjs',dir,100),(e:any)=>e.code==='ETIMEDOUT');
});

test('controlled tests run through embedded Electron Node without opening another desktop instance',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'decohub-embedded-node-'));
  const project=path.join(dir,'project');fs.mkdirSync(project);
  fs.writeFileSync(path.join(project,'proof.cjs'),"require('node:assert/strict').equal(2+3,5);console.log('EMBEDDED_NODE_PASS');");
  const entry=path.join(dir,'entry.cjs');
  fs.writeFileSync(entry,`const {executeVerification}=require(${JSON.stringify(path.resolve('src/controlledVerification.ts'))});console.log(executeVerification('node proof.cjs',${JSON.stringify(project)}));`);
  const electron=path.resolve('../node_modules/electron/dist/electron.exe');
  const output=execFileSync(electron,['--import','tsx',entry],{cwd:process.cwd(),env:{...process.env,AI_DEV_HUB_DATA_DIR:path.join(dir,'data'),ELECTRON_RUN_AS_NODE:'1'},encoding:'utf8',timeout:10000,windowsHide:true});
  assert.match(output,/EMBEDDED_NODE_PASS/);
});

test('unsupported verification pauses the real Runner without asking a model or resending the Worker',async()=>{
  const p=seed(),r=run(p),task=crypto.randomUUID(),now=new Date().toISOString(),dir=(db.prepare('SELECT path FROM projects WHERE id=?').get(p) as any).path;
  fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'implementation.cjs'),"exports.add=function(a,b){if(!Number.isFinite(a)||!Number.isFinite(b))throw new TypeError('invalid input');return a+b;};");
  db.prepare("INSERT INTO autonomous_tasks(id,run_id,title,description,status,created_at,updated_at)VALUES(?,?,?,?,'in_review',?,?)").run(task,r,'Verify real implementation','Actual code',now,now);
  const contract=IndependentEvaluator.createSuccessContract({taskId:task,runId:r,projectId:p,projectPath:dir,objective:'Actual code',acceptanceCriteria:['Tests pass'],verificationCommand:'npm install',isBugFix:true});
  assert.equal(contract.baseline.ran,false);assert.equal(contract.status,'pending');
  db.prepare('UPDATE autonomous_tasks SET contract_id=? WHERE id=?').run(contract.id,task);
  const evaluation=await IndependentEvaluator.evaluate(contract.id,dir,{status:'success',filesChanged:['implementation.cjs'],implemented:['Actual code'],problems:[]} as any);
  assert.equal(evaluation.verdict,'BLOCKED');assert.deepEqual(evaluation.executedCommands,[]);
  AutonomousManager.submitBuilderReport({runId:r,taskId:task,status:'success',filesChanged:['implementation.cjs'],implemented:['Actual code'],evaluation});
  const provider=AgentApiGateway.installDefaultMock();let calls=0;provider.responseProvider=()=>{calls++;throw Error('Model must not be called');};
  await AutonomousRunnerService.step(r);
  const state=AutonomousManager.getRun(r);assert.equal(state.status,'paused');assert.match(state.last_error,/VERIFICATION_BLOCKED/);assert.equal(calls,0);
  assert.equal(state.tasks[0].status,'in_review');assert.equal(provider.conversations.length,0);
});
