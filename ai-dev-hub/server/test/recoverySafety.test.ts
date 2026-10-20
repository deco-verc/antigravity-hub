import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { db } from '../src/db.js';
import { AgentSessionManager } from '../src/agentSessionManager.js';
import { AgentApiGateway, DefaultFakeAgentApiProvider } from '../src/agentApiGateway.js';
import { ExecutionCoordinator } from '../src/executionCoordinator.js';
import { AutonomousManager } from '../src/autonomousManager.js';
import { AutonomousRunnerService } from '../src/autonomousRunnerService.js';
import { AccountProfileManager } from '../src/accountProfileManager.js';
import { WorkerRegistry } from '../src/workerRegistry.js';
import { GeminiSupervisorProvider } from '../src/geminiSupervisorProvider.js';
import { IndependentEvaluator } from '../src/independentEvaluator.js';
import { installPipelineFixture } from './pipelineFixture.js';
import { AntigravityProvider } from '../src/antigravityProvider.js';

function project(id:string,dir:string,trusted=1,autonomy=1) {
  const now=new Date().toISOString();
  db.prepare('INSERT INTO projects (id,name,path,objective,is_trusted,full_dev_autonomy,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(id,id,dir,'Somas verificadas',trusted,autonomy,now,now);
}

test('Crash during creation stays uncertain across processes; no blind second creation',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'decohub-crash-reservation-'));project('crash-session',dir);
  let creates=0;
  AgentSessionManager.setProviderCreateOverride(()=>{creates++;throw new Error('ETIMEDOUT: resultado externo ambíguo');});
  t.after(()=>{AgentSessionManager.setProviderCreateOverride(null);fs.rmSync(dir,{recursive:true,force:true});});
  await assert.rejects(()=>AgentSessionManager.getOrCreateAgentSession('crash-session','WORKER'),/ETIMEDOUT/);
  await assert.rejects(()=>AgentSessionManager.getOrCreateAgentSession('crash-session','WORKER'),/SESSION_CREATION_UNCERTAIN/);
  assert.equal(creates,1);
  const output=execFileSync(process.execPath,['--import','tsx','-e',`const {AgentSessionManager}=require('./src/agentSessionManager.ts');AgentSessionManager.getOrCreateAgentSession('crash-session','WORKER').then(()=>process.exit(1)).catch(e=>{if(!e.message.includes('SESSION_CREATION_UNCERTAIN'))process.exit(2);console.log('RECOVERY_BLOCKED_WITHOUT_DUPLICATION');});`],{cwd:process.cwd(),env:{...process.env,MCP_STDIO:'true'},encoding:'utf8'});
  assert.match(output,/RECOVERY_BLOCKED_WITHOUT_DUPLICATION/);
  assert.equal((db.prepare('SELECT status FROM agent_creation_reservations WHERE project_id=?').get('crash-session') as any).status,'UNCERTAIN');
});

test('Global execution lock is durable and cannot be stolen by another process',()=>{
  const token=ExecutionCoordinator.acquire('global-test',{projectId:'one'});
  try{
    assert.throws(()=>ExecutionCoordinator.acquire('global-test',{projectId:'two'}),/EXECUTION_BUSY/);
    const output=execFileSync(process.execPath,['--import','tsx','-e',`const {ExecutionCoordinator}=require('./src/executionCoordinator.ts');try{ExecutionCoordinator.acquire('global-test',{});process.exit(1);}catch(e){if(!e.message.includes('EXECUTION_BUSY'))process.exit(2);console.log('LOCK_PRESERVED');}`],{cwd:process.cwd(),env:{...process.env,MCP_STDIO:'true'},encoding:'utf8'});
    assert.match(output,/LOCK_PRESERVED/);
  }finally{ExecutionCoordinator.release('global-test',token);}
});

test('Historical READY in SQLite is AUTH_UNKNOWN in native mode without current OAuth evidence',()=>{
  const offline=process.env.DECOHUB_OFFLINE_MODE;const nodeEnv=process.env.NODE_ENV;
  try {
    process.env.DECOHUB_OFFLINE_MODE='false';process.env.NODE_ENV='production';
    const profile=(AccountProfileManager as any)._rowToProfile({id:'historical',auth_status:'READY',google_account_label:'previous-login@example.test',environment_path:'C:/isolated',created_at:'2026-10-09',updated_at:'2026-10-09'});
    assert.equal(profile.auth_status,'AUTH_UNKNOWN');
  } finally {
    if(offline===undefined)delete process.env.DECOHUB_OFFLINE_MODE;else process.env.DECOHUB_OFFLINE_MODE=offline;
    if(nodeEnv===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=nodeEnv;
  }
});

test('Selected account and concurrent session requests cannot cross project/profile boundaries',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'decohub-binding-'));project('binding-a',dir);project('binding-b',path.join(dir,'b'));
  const fake=new DefaultFakeAgentApiProvider();AgentApiGateway.setMockProvider(fake);
  t.after(()=>{AgentApiGateway.installDefaultMock();fs.rmSync(dir,{recursive:true,force:true});});
  const sessions=await Promise.all(Array.from({length:10},()=>AgentSessionManager.getOrCreateAgentSession('binding-a','WORKER',{accountProfileId:'profile-a'})));
  assert.equal(fake.creationCount,1);
  assert.equal(new Set(sessions.map(r=>r.session.id)).size,1);
  await assert.rejects(()=>AgentSessionManager.getOrCreateAgentSession('binding-a','WORKER',{accountProfileId:'profile-b'}),/SESSION_PROFILE_MISMATCH/);
  const b=await AgentSessionManager.getOrCreateAgentSession('binding-b','WORKER',{accountProfileId:'profile-b'});
  assert.notEqual(b.session.provider_conversation_id,sessions[0].session.provider_conversation_id);
});

test('Authorization blocks planning even with an explicit offline provider; no implicit full autonomy',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'decohub-auth-denied-'));project('trust-only',dir,1,0);
  const fake=new DefaultFakeAgentApiProvider();AgentApiGateway.setMockProvider(fake);
  t.after(()=>{AgentApiGateway.installDefaultMock();fs.rmSync(dir,{recursive:true,force:true});});
  await assert.rejects(()=>AutonomousManager.createRun({projectId:'trust-only',name:'denied',objective:'Construir',briefing:'Construir'}),/AUTHORIZATION_GUARD/);
  assert.equal(fake.creationCount,0);
  assert.equal((db.prepare('SELECT COUNT(*) n FROM autonomous_runs WHERE project_id=?').get('trust-only') as any).n,0);
});

test('Provider unavailable and invalid planning responses stay visible, with no fictitious plan',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'decohub-plan-errors-'));project('invalid-plan',dir);
  const fake=new DefaultFakeAgentApiProvider();fake.responseProvider=()=>'{invalid JSON';AgentApiGateway.setMockProvider(fake);
  t.after(()=>{AgentApiGateway.installDefaultMock();fs.rmSync(dir,{recursive:true,force:true});});
  await assert.rejects(()=>AutonomousManager.createRun({projectId:'invalid-plan',name:'invalid',objective:'Construir',briefing:'Construir'}),/SUPERVISOR_UNAVAILABLE/);
  const run=AutonomousManager.getActiveRunForProject('invalid-plan');assert.equal(run.tasks.length,0);assert.equal(run.status,'error');
  fake.responseProvider=undefined;
  await assert.rejects(()=>new GeminiSupervisorProvider().waitForResponse('unconfigured',1,-1,'REVIEW'),/OFFLINE_RESPONSE_UNCONFIGURED/);
});

test('429 during Worker continuation preserves Run, Task and sessions across backend restart',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'decohub-quota-pipeline-'));project('quota-pipeline',dir);
  const fixture=installPipelineFixture('quota-pipeline',dir,2,false);
  t.after(()=>{AutonomousRunnerService.stop();WorkerRegistry.setProbeOverrideForTest(null);AgentApiGateway.installDefaultMock();fs.rmSync(dir,{recursive:true,force:true});});
  const run=await AutonomousManager.createRun({projectId:'quota-pipeline',name:'quota',objective:'Dois incrementos',briefing:'Implementar dois incrementos'});
  await AutonomousRunnerService.step(run.id);
  const session=AgentSessionManager.getActiveSession('quota-pipeline','WORKER')!;
  fixture.provider.simulateFailure=new Error('QUOTA_EXHAUSTED: RESOURCE_EXHAUSTED code 429 Resets in 1s');
  await AutonomousRunnerService.step(run.id);
  const paused=AutonomousManager.getRun(run.id);assert.equal(paused.status,'paused');assert.equal(paused.tasks[1].status,'ready');
  AutonomousRunnerService.stop();AutonomousRunnerService.recoverInterruptedRuns();
  assert.equal(AutonomousManager.getRun(run.id).status,'paused');
  const output=execFileSync(process.execPath,['--import','tsx','-e',`const {AgentSessionManager}=require('./src/agentSessionManager.ts');AgentSessionManager.setProviderLivenessOverride(()=>true);AgentSessionManager.getOrCreateAgentSession('quota-pipeline','WORKER').then(r=>{if(r.isNew)process.exit(1);console.log(r.session.provider_conversation_id);});`],{cwd:process.cwd(),env:{...process.env,MCP_STDIO:'true'},encoding:'utf8'});
  assert.match(output,new RegExp(session.provider_conversation_id));
  db.prepare('UPDATE account_profiles SET quota_resets_at=? WHERE id=?').run(new Date(Date.now()-1000).toISOString(),'acc-pro-1');
  fixture.provider.simulateFailure=null;
  const resumed=await AutonomousManager.resumeRun(run.id);assert.equal(resumed.id,run.id);
  assert.equal(AccountProfileManager.getProfile('acc-pro-1')?.auth_status,'AUTH_UNKNOWN');
  await AutonomousRunnerService.step(run.id);await AutonomousRunnerService.step(run.id);
  assert.equal(AutonomousManager.getRun(run.id).status,'completed');
  assert.equal(AgentSessionManager.getActiveSession('quota-pipeline','WORKER')?.id,session.id);
  assert.equal(fixture.provider.creationCount,2);
});

test('Evaluator really checks file steps and rejects facade commands',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'decohub-evaluator-evidence-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const report={status:'success' as const,filesChanged:['actual.cjs'],implemented:['Função implementada']};
  const contract=IndependentEvaluator.createSuccessContract({taskId:'file-step',projectId:'test',projectPath:dir,objective:'Arquivo de configuração',acceptanceCriteria:['Arquivo deve existir'],verificationSteps:[{name:'Arquivo factual',checkType:'file_exists',targetPath:'actual.cjs'}]});
  assert.equal((await IndependentEvaluator.evaluate(contract.id,dir,report)).taskIsDone,false);
  fs.writeFileSync(path.join(dir,'actual.cjs'),'exports.makeConfiguration=function makeConfiguration(){return {value:42,enabled:true,mode:"local"};};\n');
  assert.equal((await IndependentEvaluator.evaluate(contract.id,dir,report)).verdict,'PASS');
  const facade=IndependentEvaluator.createSuccessContract({taskId:'facade-step',projectId:'test',projectPath:dir,objective:'Verificação de comportamento',acceptanceCriteria:['Resultado calculado'],verificationCommand:'node -e "process.exit(0)"'});
  assert.equal((await IndependentEvaluator.evaluate(facade.id,dir,report)).taskIsDone,false);
});

test('Supervisor API cannot approve a Worker claim without persisted independent evidence',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'decohub-no-approval-'));project('no-approval',dir);
  const fixture=installPipelineFixture('no-approval',dir,1,false);
  t.after(()=>{WorkerRegistry.setProbeOverrideForTest(null);AgentApiGateway.installDefaultMock();fs.rmSync(dir,{recursive:true,force:true});});
  const run=await AutonomousManager.createRun({projectId:'no-approval',name:'verification',objective:'Soma verificada',briefing:'Soma verificada'});
  assert.throws(()=>AutonomousManager.submitSupervisorReview({runId:run.id,taskId:run.tasks[0].id,verdict:'APPROVED',feedback:'Worker escreveu concluído'}),/NEEDS_EVIDENCE/);
  assert.equal(AutonomousManager.getRun(run.id).tasks[0].status,'ready');
  assert.equal(fixture.provider.creationCount,1);
});

test('Transport timeout cannot advance even when the partially written code passes tests',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'decohub-turn-timeout-'));project('turn-timeout',dir);
  const fixture=installPipelineFixture('turn-timeout',dir,1,false);
  const original=AntigravityProvider.prototype.getResult;
  AntigravityProvider.prototype.getResult=async()=>({status:'failure',filesChanged:['step-1.cjs'],implemented:[],commandsExecuted:[],tests:{ran:false},buildStatus:'UNKNOWN',problems:['AGENT_EXECUTION_TIMEOUT'],decisions:[]});
  t.after(()=>{AntigravityProvider.prototype.getResult=original;AutonomousRunnerService.stop();WorkerRegistry.setProbeOverrideForTest(null);AgentApiGateway.installDefaultMock();
    const reservation:any=db.prepare("SELECT token FROM execution_reservations WHERE scope='global-agent-execution'").get();
    if(reservation)ExecutionCoordinator.release('global-agent-execution',reservation.token);
    fs.rmSync(dir,{recursive:true,force:true});});
  const run=await AutonomousManager.createRun({projectId:'turn-timeout',name:'timeout',objective:'Soma verificada',briefing:'Soma verificada'});
  await AutonomousRunnerService.step(run.id);
  const paused=AutonomousManager.getRun(run.id);
  assert.equal(paused.status,'paused');assert.match(paused.last_error,/TURN_RECONCILIATION_REQUIRED/);
  assert.equal(paused.tasks[0].status,'in_progress');
  assert.equal((db.prepare('SELECT COUNT(*) n FROM evaluation_results WHERE task_id=?').get(paused.tasks[0].id) as any).n,0,'Não avaliar enquanto turno externo pode estar trabalhando');
  execFileSync(process.execPath,['acceptance.test.cjs','1'],{cwd:dir,stdio:'pipe'});
  AntigravityProvider.prototype.getResult=original;
  const resumed=await AutonomousManager.resumeRun(run.id);assert.equal(resumed.status,'running');
  assert.equal(resumed.tasks[0].status,'in_review');
  assert.equal(fixture.dispatches.length,1,'Retomada não pode reenviar a implementação concluída');
  assert.equal(fixture.provider.creationCount,2);
  assert.ok(!db.prepare("SELECT token FROM execution_reservations WHERE scope='global-agent-execution'").get(),'DONE reconciliado e avaliado libera somente a reserva própria');
});
