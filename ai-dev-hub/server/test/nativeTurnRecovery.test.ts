import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync, execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { db } from '../src/db.js';
import { AgentTurnState, captureFileInventory, changedFiles, observeTranscript } from '../src/agentTurnState.js';
import { AntigravityProvider } from '../src/antigravityProvider.js';
import { resolveVerificationCommand } from '../src/verificationCommand.js';
import { AgentApiGateway } from '../src/agentApiGateway.js';
import { AgentSessionManager } from '../src/agentSessionManager.js';
import { AutonomousManager } from '../src/autonomousManager.js';
import { AutonomousRunnerService } from '../src/autonomousRunnerService.js';
import { ExecutionCoordinator } from '../src/executionCoordinator.js';
import { WorkerRegistry } from '../src/workerRegistry.js';
import { DevAutonomyService } from '../src/devAutonomyService.js';
import { installPipelineFixture } from './pipelineFixture.js';

function workspace(t:any) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'decohub-native-turn-regression-'));
  const project=path.join(root,'project');fs.mkdirSync(project);
  const brain=path.join(root,'.gemini','antigravity','brain');
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  return {root,project,brain};
}
function append(brain:string,id:string,entry:any) {
  const file=path.join(brain,id,'.system_generated','logs','transcript.jsonl');
  fs.mkdirSync(path.dirname(file),{recursive:true});fs.appendFileSync(file,JSON.stringify(entry)+'\n');return file;
}
const done={type:'PLANNER_RESPONSE',status:'DONE',content:'Implementação concluída para avaliação independente dos arquivos e comportamento.'};

test('Hash attribution excludes preexisting untracked files and same-byte rewrites',t=>{
  const {project}=workspace(t);
  fs.writeFileSync(path.join(project,'preexisting.cjs'),'old');fs.writeFileSync(path.join(project,'deleted.cjs'),'remove');
  fs.mkdirSync(path.join(project,'node_modules'));fs.writeFileSync(path.join(project,'node_modules','ignored'),'old');
  const before=captureFileInventory(project);
  fs.writeFileSync(path.join(project,'preexisting.cjs'),'old');fs.unlinkSync(path.join(project,'deleted.cjs'));
  fs.writeFileSync(path.join(project,'new.cjs'),'real delivery');fs.writeFileSync(path.join(project,'node_modules','ignored'),'new');
  assert.deepEqual(changedFiles(before,captureFileInventory(project)),['deleted.cjs','new.cjs']);
});

test('Inventory and test discovery refuse junctions outside the project',t=>{
  const {root,project}=workspace(t);const outside=path.join(root,'outside');fs.mkdirSync(outside);
  fs.symlinkSync(outside,path.join(project,'test'),'junction');
  assert.throws(()=>captureFileInventory(project),/SYMLINK_DENIED/);
  // The test directory itself must not be a junction, not only its children.
  assert.throws(()=>resolveVerificationCommand('node --test test',project),/SYMLINK_DENIED/);
});

test('captureFileInventory ignores dist-desktop, app.asar and packaging build artifacts safely', t => {
  const { project } = workspace(t);
  const srcFile = path.join(project, 'src', 'index.ts');
  fs.mkdirSync(path.dirname(srcFile), { recursive: true });
  fs.writeFileSync(srcFile, 'console.log("hello");');

  // Create mock dist-desktop and app.asar artifacts that would otherwise cause ENOENT
  const distDesktopResources = path.join(project, 'dist-desktop', 'win-unpacked', 'resources');
  fs.mkdirSync(distDesktopResources, { recursive: true });
  fs.writeFileSync(path.join(distDesktopResources, 'app.asar'), 'mock-asar-content');
  fs.mkdirSync(path.join(distDesktopResources, 'app.asar.unpacked'), { recursive: true });
  fs.writeFileSync(path.join(distDesktopResources, 'app.asar.unpacked', 'server.js'), 'mock');

  // Create other packaging & build folders
  const distDir = path.join(project, 'dist');
  fs.mkdirSync(distDir, { recursive: true });
  fs.writeFileSync(path.join(distDir, 'bundle.js'), 'dist-code');

  const buildDir = path.join(project, 'build');
  fs.mkdirSync(buildDir, { recursive: true });
  fs.writeFileSync(path.join(buildDir, 'binary.exe'), 'exe');

  const coverageDir = path.join(project, 'coverage');
  fs.mkdirSync(coverageDir, { recursive: true });
  fs.writeFileSync(path.join(coverageDir, 'lcov.info'), 'coverage');

  // Create large file (> 2MB) and binary files
  const largeFile = path.join(project, 'large-dataset.dat');
  const buffer2MBPlus = Buffer.alloc(2 * 1024 * 1024 + 100);
  fs.writeFileSync(largeFile, buffer2MBPlus);
  fs.writeFileSync(path.join(project, 'image.png'), 'png-bytes');
  fs.writeFileSync(path.join(project, 'database.db'), 'sqlite-bytes');

  // Must not throw and must only inventory actual source files
  const inventory = captureFileInventory(project);
  assert.ok(inventory['src/index.ts'], 'src/index.ts deve constar no inventário');
  assert.equal(inventory['dist-desktop/win-unpacked/resources/app.asar'], undefined, 'app.asar deve ser ignorado');
  assert.equal(inventory['dist/bundle.js'], undefined, 'dist deve ser ignorado');
  assert.equal(inventory['build/binary.exe'], undefined, 'build e .exe devem ser ignorados');
  assert.equal(inventory['coverage/lcov.info'], undefined, 'coverage deve ser ignorado');
  assert.equal(inventory['large-dataset.dat'], undefined, 'Arquivos > 2MB devem ser ignorados');
  assert.equal(inventory['image.png'], undefined, '.png deve ser ignorado');
  assert.equal(inventory['database.db'], undefined, '.db deve ser ignorado');
});

test('DONE with a pending native command is not a completed turn; restart retains baseline',async t=>{
  const {root,project,brain}=workspace(t),id='pending-command';
  append(brain,id,{...done,step_index:1});fs.writeFileSync(path.join(project,'unchanged.cjs'),'baseline');
  AgentTurnState.begin(id,project,brain,'pending-task');AgentTurnState.setPhase(id,'IN_FLIGHT');
  const file=append(brain,id,{...done,step_index:2,tool_calls:[{name:'run_command',args:{CommandLine:'node --test test/calculator.test.cjs'}}]});
  assert.equal(observeTranscript(file,1).state,'PENDING_TOOL');
  const provider=new AntigravityProvider({USERPROFILE:root});
  assert.equal((await provider.getStatus(id)).state,'running');
  assert.match((await provider.getResult(id,0,project)).problems.join(' '),/AGENT_NATIVE_TOOL_PENDING/);
  assert.equal(AgentTurnState.get(id).phase,'IN_FLIGHT');
  assert.throws(()=>AgentTurnState.begin(id,project,brain),/AGENT_TURN_UNCERTAIN/);
  fs.writeFileSync(path.join(project,'new.cjs'),'exports.result=42;');
  append(brain,id,{type:'GENERIC_TOOL_CALL_RESULT',status:'DONE',step_index:3});append(brain,id,{...done,step_index:4});
  const restarted=new AntigravityProvider({USERPROFILE:root});
  assert.equal((await restarted.getStatus(id)).state,'completed');
  const report=await restarted.getResult(id,1,project);
  assert.deepEqual(report.filesChanged,['new.cjs']);assert.equal(AgentTurnState.get(id).phase,'COMPLETE');
  const child=execFileSync(process.execPath,['--import','tsx','-e',`const {AgentTurnState}=require('./src/agentTurnState.ts');const r=AgentTurnState.get('pending-command');if(r.baseline_lines!==1||r.phase!=='COMPLETE')process.exit(2);console.log('BASELINE_SURVIVED_PROCESS_RESTART');`],{cwd:process.cwd(),encoding:'utf8',env:{...process.env,MCP_STDIO:'true'}});
  assert.match(child,/BASELINE_SURVIVED_PROCESS_RESTART/);
});

test('Fatal authentication/quota errors never become successful completion',async t=>{
  const {root,project,brain}=workspace(t);
  for(const [id,error] of [['auth-failure','UNAUTHENTICATED'],['quota-failure','RESOURCE_EXHAUSTED']]) {
    AgentTurnState.begin(id,project,brain);AgentTurnState.setPhase(id,'IN_FLIGHT');
    append(brain,id,{type:'ERROR_MESSAGE',error});append(brain,id,done);
    await assert.rejects(()=>new AntigravityProvider({USERPROFILE:root}).getResult(id,0,project),/AUTH_ERROR|QUOTA_EXHAUSTED/);
  }
});

test('Unknown send outcome is durable and blocks another message before external dispatch',async t=>{
  const {root,project}=workspace(t),fake=AgentApiGateway.installDefaultMock();let sends=0;
  fake.sendMessage=()=>{sends++;throw new Error('transport ended without acknowledgement');};
  t.after(()=>AgentApiGateway.installDefaultMock());
  const provider=new AntigravityProvider({USERPROFILE:root});
  const input:any={task:{id:'ambiguous-task',title:'Implementar soma',description:'Soma validada'},context:{projectPath:project,projectName:'Isolated QA',objective:'Math'},acceptanceCriteria:['Soma correta']};
  await assert.rejects(()=>provider.sendTask('ambiguous-send',input),/AGENT_TURN_UNCERTAIN/);
  assert.equal(AgentTurnState.get('ambiguous-send').phase,'UNCERTAIN');
  await assert.rejects(()=>new AntigravityProvider({USERPROFILE:root}).sendTask('ambiguous-send',input),/AGENT_TURN_UNCERTAIN/);
  assert.equal(sends,1);
});

test('Invalid Node test directory is normalized into real tests, including meaningful failures',t=>{
  const {project}=workspace(t);fs.mkdirSync(path.join(project,'test'));
  assert.throws(()=>resolveVerificationCommand('node --test test',project),/HAS_NO_TEST_FILES/);
  const file=path.join(project,'test','calculator.test.cjs');
  fs.writeFileSync(file,"const test=require('node:test');const assert=require('node:assert/strict');test('arithmetic',()=>assert.equal(2+3,5));");
  const command=resolveVerificationCommand('node --test test/',project);
  assert.equal(command,'node --test "test/calculator.test.cjs"');
  const childEnv={...process.env};delete childEnv.NODE_TEST_CONTEXT;
  assert.match(execSync(command,{cwd:project,encoding:'utf8',env:childEnv}),/pass 1/);
  fs.writeFileSync(file,"const test=require('node:test');const assert=require('node:assert/strict');test('arithmetic',()=>assert.equal(2+3,4));");
  assert.throws(()=>execSync(command,{cwd:project,stdio:'pipe',env:childEnv}));
  assert.equal(resolveVerificationCommand('npm test',project),'npm test');
  fs.writeFileSync(path.join(project,'test','bad&name.test.cjs'),'');
  assert.throws(()=>resolveVerificationCommand('node --test test',project),/SHELL_CHARACTERS_DENIED/);
});

test('Explicit resume reconciles a delayed native completion without resending or creating sessions',async t=>{
  const {project}=workspace(t),id='late-native-result',now=new Date().toISOString();
  db.prepare('INSERT INTO projects(id,name,path,objective,is_trusted,full_dev_autonomy,created_at,updated_at) VALUES(?,?,?,?,1,1,?,?)').run(id,id,project,'Soma',now,now);
  const fixture=installPipelineFixture(id,project,1,false),original=AntigravityProvider.prototype.getResult;
  t.after(()=>{AntigravityProvider.prototype.getResult=original;AutonomousRunnerService.stop();WorkerRegistry.setProbeOverrideForTest(null);AgentApiGateway.installDefaultMock();const reservation:any=db.prepare("SELECT token FROM execution_reservations WHERE scope='global-agent-execution'").get();if(reservation)ExecutionCoordinator.release('global-agent-execution',reservation.token);});
  const run=await AutonomousManager.createRun({projectId:id,name:'Delayed tool',objective:'Soma validada',briefing:'Soma validada'});
  const send = fixture.provider.sendMessage.bind(fixture.provider);
  let completedTranscript = '';
  fixture.provider.sendMessage = (opts: any) => {
    send(opts);
    if (opts.role === 'WORKER') {
      const logs = path.join(fixture.brain, opts.conversationId, '.system_generated', 'logs');
      const tPath = path.join(logs, 'transcript.jsonl');
      completedTranscript = fs.readFileSync(tPath, 'utf8');
      fs.writeFileSync(tPath, JSON.stringify({ ...done, tool_calls: [{ name: 'run_command' }] }) + '\n');
      fs.writeFileSync(path.join(project, 'step-1.cjs'), 'exports.add=function(){throw new Error("pending");};\n');
    }
  };
  AntigravityProvider.prototype.getResult=async()=>({status:'failure',filesChanged:[],implemented:[],commandsExecuted:[],tests:{ran:false},buildStatus:'UNKNOWN',problems:['AGENT_NATIVE_TOOL_PENDING: run_command','AGENT_EXECUTION_TIMEOUT'],decisions:[]});
  await AutonomousRunnerService.step(run.id);
  AntigravityProvider.prototype.getResult=original;
  fixture.provider.sendMessage=send;
  assert.equal(AutonomousManager.getRun(run.id).status,'waiting_resource');
  db.prepare("UPDATE worker_leases SET lease_until='2000-01-01T00:00:00.000Z' WHERE task_id=?").run(run.tasks[0].id);
  db.prepare("UPDATE workers SET last_heartbeat='2000-01-01T00:00:00.000Z' WHERE current_task_id=?").run(run.tasks[0].id);
  assert.equal(WorkerRegistry.expireStaleLeases().expired,0);
  assert.deepEqual(WorkerRegistry.detectOfflineWorkers(),[]);
  assert.equal(AutonomousManager.getRun(run.id).tasks[0].status,'in_progress');
  assert.equal((await AutonomousManager.resumeRun(run.id)).status,'waiting_resource');
  assert.equal(fixture.dispatches.length,1);
  const worker=AgentSessionManager.getActiveSession(id,'WORKER')!,observation=AgentTurnState.get(worker.provider_conversation_id);
  const transcript=path.join(observation.brain_dir,observation.conversation_id,'.system_generated/logs/transcript.jsonl');
  fs.writeFileSync(transcript, completedTranscript);
  fs.writeFileSync(path.join(project,'step-1.cjs'),'exports.add=function add(a,b){if(!Number.isFinite(a)||!Number.isFinite(b))throw new TypeError("invalid");return a+b;};\n');
  db.prepare("UPDATE execution_reservations SET owner_pid=? WHERE scope='global-agent-execution'").run(process.ppid);
  assert.equal(await AutonomousRunnerService.reconcileCompletedTurn(run.id),false,'Não tomar reserva de outro processo ativo');
  db.prepare("UPDATE execution_reservations SET owner_pid=? WHERE scope='global-agent-execution'").run(process.pid);
  AutonomousRunnerService.recoverInterruptedRuns();
  const resumed=await AutonomousManager.resumeRun(run.id);
  assert.equal(resumed.status,'running');assert.equal(resumed.tasks[0].status,'in_review');
  assert.equal(fixture.dispatches.length,1);
  assert.equal(AgentTurnState.get(worker.provider_conversation_id).phase,'CONSUMED');
  assert.equal((db.prepare('SELECT verdict FROM evaluation_results WHERE task_id=? ORDER BY created_at DESC LIMIT 1').get(run.tasks[0].id) as any).verdict,'PASS');
  await AutonomousRunnerService.step(run.id);
  await AutonomousRunnerService.step(run.id);
  assert.equal(AutonomousManager.getRun(run.id).status,'completed');
});

test('Idle execution status and generated prompts preserve native approval policies',t=>{
  const {project}=workspace(t);AutonomousRunnerService.releaseExecutionLock();
  const status=AutonomousRunnerService.getStatus();
  assert.equal(status.isAgentExecuting,false);assert.equal(status.executionPhase,'IDLE');
  const block=DevAutonomyService.buildAutonomyGuidelinesBlock(project);
  assert.match(block,/Require Review/);assert.doesNotMatch(block,/NÃO aguarde aprovação humana/);
});

test('Migration of an older isolated report database preserves its existing records',t=>{
  const {root}=workspace(t),file=path.join(root,'hub.db'),old=new DatabaseSync(file);
  old.exec(`CREATE TABLE builder_reports(id TEXT PRIMARY KEY,run_id TEXT,task_id TEXT,status TEXT,created_at TEXT);
    INSERT INTO builder_reports VALUES('preserved-report','historical-run','historical-task','success','2026-01-01');`);old.close();
  const child=execFileSync(process.execPath,['--import','tsx','-e',`const {db}=require('./src/db.ts');const r=db.prepare('SELECT * FROM builder_reports WHERE id=?').get('preserved-report');if(r.run_id!=='historical-run'||r.status!=='success'||r.evaluation_json!==null)process.exit(2);console.log('OLDER_REPORT_PRESERVED');db.close();`],{cwd:process.cwd(),encoding:'utf8',env:{...process.env,AI_DEV_HUB_DATA_DIR:root,MCP_STDIO:'true'}});
  assert.match(child,/OLDER_REPORT_PRESERVED/);
});
