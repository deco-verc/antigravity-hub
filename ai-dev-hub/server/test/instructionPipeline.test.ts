import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { db } from '../src/db.js';
import { apiRouter } from '../src/routes.js';
import { AgentApiGateway, DefaultFakeAgentApiProvider } from '../src/agentApiGateway.js';
import { SessionCircuitBreaker } from '../src/sessionCircuitBreaker.js';
import { GeminiSupervisorProvider } from '../src/geminiSupervisorProvider.js';
import { AutonomousManager } from '../src/autonomousManager.js';
import { AutonomousRunnerService } from '../src/autonomousRunnerService.js';
import { WorkerRegistry } from '../src/workerRegistry.js';
import { AgentSessionManager } from '../src/agentSessionManager.js';
import { installPipelineFixture } from './pipelineFixture.js';

test('FinanceFlow regression: breaker counts a physical operation once', () => {
  const id = 'breaker-finance-regression';
  for (let i = 0; i < 2; i++) {
    SessionCircuitBreaker.assertCanCreate({ projectId: id, role: i ? 'SUPERVISOR' : 'WORKER' });
    SessionCircuitBreaker.logTelemetry({ event: 'AGENT_CONVERSATION_CREATE_ATTEMPT', origin: 'API', projectId: id, role: i ? 'SUPERVISOR' : 'WORKER', caller: 'regression' });
    SessionCircuitBreaker.logTelemetry({ event: 'CREATE_SUCCESS', origin: 'API', projectId: id, role: i ? 'SUPERVISOR' : 'WORKER', caller: 'regression', conversationId: `regression-${i}` });
    assert.equal(SessionCircuitBreaker.evaluateCreation(id).recentCount, i + 1);
  }
});

test('Production HTTP → plan → 10 real file deliveries → independent repair → completion reuses two sessions', async t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'decohub-full-pipeline-'));
  const id='full-pipeline'; const now=new Date().toISOString();
  db.prepare('INSERT INTO projects (id,name,path,objective,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(id,'Executable pipeline',dir,'Incrementos aritméticos',now,now);
  const fixture=installPipelineFixture(id,dir);
  const app=express();app.use(express.json());app.use('/api',apiRouter);
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
  t.after(async()=>{AutonomousRunnerService.stop();WorkerRegistry.setProbeOverrideForTest(null);AgentApiGateway.installDefaultMock();await new Promise<void>(r=>server.close(()=>r()));fs.rmSync(dir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${(server.address() as any).port}/api`;
  const response=await fetch(`${base}/projects/${id}/messages`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:'Implemente dez módulos incrementais de soma validada, preservando o contexto entre tarefas.'})});
  const body:any=await response.json();
  assert.equal(body.execution.status,'started');
  const runId=body.autonomousRun.id;
  assert.equal(body.autonomousRun.tasks.length,10);
  await AutonomousRunnerService.step(runId);
  let run=AutonomousManager.getRun(runId);
  assert.equal(run.tasks[0].status,'needs_changes','Reprovação independente deve impedir avanço');
  assert.equal(run.tasks[1].status,'pending');
  await AutonomousRunnerService.step(runId);
  assert.equal(AutonomousManager.getRun(runId).tasks[0].status,'completed');
  for(let i=0;i<9;i++) await AutonomousRunnerService.step(runId);
  await AutonomousRunnerService.step(runId);
  run=AutonomousManager.getRun(runId);
  assert.equal(run.status,'completed');
  assert.equal(run.tasks.filter((x:any)=>x.status==='completed').length,10);
  assert.equal(fixture.provider.creationCount,2,'Uma conversa Supervisor e uma Worker, incluindo reparo');
  assert.equal(fixture.dispatches.length,11);
  assert.equal(new Set(fixture.dispatches.map(d=>d.conversationId)).size,1);
  assert.ok(fixture.dispatches.every(d=>d.cwd===dir));
  assert.equal(AgentSessionManager.getProjectSessions(id).length,2);
  const results:any[]=db.prepare('SELECT verdict FROM evaluation_results WHERE task_id IN (SELECT id FROM autonomous_tasks WHERE run_id=?)').all(runId);
  assert.equal(results.filter(r=>r.verdict==='PASS').length,10);
  assert.equal(results.filter(r=>r.verdict==='FAIL').length,1);
  const contracts:any[]=db.prepare('SELECT protected_evaluation_files_json FROM success_contracts WHERE run_id=?').all(runId);
  assert.ok(contracts.every(c=>JSON.parse(c.protected_evaluation_files_json).includes('acceptance.test.cjs')),'Critérios independentes são protegidos antes de despachar o Worker');
  const tasksResponse=await fetch(`${base}/autonomous/runs/${runId}`);
  assert.equal((await tasksResponse.json() as any).tasks.length,10);
});

test('Chat HTTP: preserve run, display original planning failure, resume without duplicates', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-http-regression-'));
  const now = new Date().toISOString();
  const id = 'http-finance-regression';
  db.prepare('INSERT INTO projects (id,name,path,objective,is_trusted,full_dev_autonomy,created_at,updated_at) VALUES (?,?,?,?,1,1,?,?)').run(id, 'FinanceFlow sandbox', dir, 'Finanças', now, now);
  const fake = new DefaultFakeAgentApiProvider();
  AgentApiGateway.setMockProvider(fake);
  const original = GeminiSupervisorProvider.prototype.waitForResponse;
  let fail = true;
  GeminiSupervisorProvider.prototype.waitForResponse = async () => {
    if (fail) throw new Error('AUTH_ERROR: login expirado no perfil selecionado');
    return JSON.stringify([{ title: 'Implementar cadastro de transações SQLite', description: 'Validar valores e persistir transações', milestone: 'M1', dependencies: [], criteria: ['Persistência após reinício'], verificationCommand: 'node --test', orderIndex: 1 }]);
  };
  const app = express();
  app.use(express.json()); app.use('/api', apiRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const port = (server.address() as any).port;
  const post = async (url: string, body: any = {}) => {
    const response = await fetch(`http://127.0.0.1:${port}/api${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() as any };
  };
  t.after(async () => {
    GeminiSupervisorProvider.prototype.waitForResponse = original;
    AgentApiGateway.installDefaultMock();
    await new Promise<void>(resolve => server.close(() => resolve()));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const first = await post(`/projects/${id}/messages`, { content: 'Crie FinanceFlow com React, Node e SQLite. Preserve o contexto e permita continuar editando.' });
  assert.ok(first.data.autonomousRun, 'Falha deve retornar o Run persistido');
  assert.match(first.data.assistantReply.content, /AUTH_ERROR: login expirado/);
  assert.equal(first.data.execution.status, 'blocked');
  const runId = first.data.autonomousRun.id;
  fail = false;
  const resumed = await Promise.all(Array.from({ length: 5 }, () => post(`/autonomous/runs/${runId}/resume`)));
  assert.ok(resumed.every(r => r.status === 200));
  assert.equal((db.prepare('SELECT COUNT(*) n FROM autonomous_runs WHERE project_id=?').get(id) as any).n, 1);
  const run = AutonomousManager.getRun(runId);
  assert.equal(run.tasks.length, 1);
  assert.equal(run.tasks[0].title, 'Implementar cadastro de transações SQLite');
  assert.equal(run.tasks[0].verification_command, 'node --test');
  assert.equal(fake.creationCount, 1, 'Replanejamento reutiliza Supervisor');
});
