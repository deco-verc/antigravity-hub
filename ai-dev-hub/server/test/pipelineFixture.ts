import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { AgentApiGateway, DefaultFakeAgentApiProvider } from '../src/agentApiGateway.js';
import { AccountProfileManager } from '../src/accountProfileManager.js';
import { WorkerRegistry } from '../src/workerRegistry.js';
import { db, HUB_DATA_DIR } from '../src/db.js';

/** Only the external model/tool boundary is simulated. The HTTP routes, session management,
 * transcript parser, Runner, actual filesystem and independent command evaluation are real. */
export function installPipelineFixture(projectId: string, projectPath: string, count = 10, failFirst = true) {
  if (!AgentApiGateway.isOfflineMode()) throw new Error('Fixture requires fail-closed offline mode');
  const provider = new DefaultFakeAgentApiProvider();
  const brain = path.join(AccountProfileManager.getGlobalActiveProfile().environment_path, '.gemini', 'antigravity', 'brain');
  const attempts = new Map<number, number>();
  const dispatches: Array<{ task: number; conversationId: string; cwd: string; exitCode: number }> = [];
  const tasks = Array.from({ length: count }, (_,i) => ({
    title: `Implementar incremento ${i+1}`, description: `Implementar soma validada no módulo step-${i+1}.cjs`, milestone: 'M1', orderIndex: i+1,
    dependencies: i ? [`Implementar incremento ${i}`] : [], criteria: [`Incremento ${i+1} soma positivos e negativos e rejeita entradas inválidas`],
    verificationCommand: `node acceptance.test.cjs ${i+1}`, doneWhen: 'Verificação independente passa'
  }));
  fs.writeFileSync(path.join(projectPath,'package.json'), JSON.stringify({ name:'decohub-pipeline-fixture', scripts:{test:'node acceptance.test.cjs 1'} }));
  fs.writeFileSync(path.join(projectPath,'acceptance.test.cjs'), `const assert=require('node:assert/strict');const i=Number(process.argv[2]||1);const {add}=require('./step-'+i+'.cjs');assert.equal(add(2,3),5);assert.equal(add(-1,1),0);assert.throws(()=>add(NaN,1),TypeError);console.log('acceptance verified step '+i);`);
  provider.responseProvider = (_id, mode) => mode === 'REVIEW'
    ? JSON.stringify({ verdict:'APPROVED',feedback:'Revisão explicitamente simulada; avanço depende do Evaluator real',qualityScore:9 })
    : JSON.stringify(tasks);
  const send = provider.sendMessage.bind(provider);
  provider.sendMessage = options => {
    send(options);
    if (options.role !== 'WORKER') return;
    if (options.projectId !== projectId) throw new Error('Fixture cross-project violation');
    const task = Number(options.prompt.match(/TAREFA ATUAL:\s*Implementar incremento (\d+)/i)?.[1] || options.prompt.match(/Implementar incremento (\d+)/)?.[1]) || 1;
    const attempt = (attempts.get(task)||0)+1; attempts.set(task,attempt);
    const broken = failFirst && task===1 && attempt===1;
    const file = path.join(projectPath,`step-${task}.cjs`);
    fs.writeFileSync(file, `exports.add=function add(a,b){if(!Number.isFinite(a)||!Number.isFinite(b))throw new TypeError('invalid');return a${broken ? '-' : '+'}b;};\n`);
    let exitCode = 0;
    let output = '';
    try { output=execFileSync(process.execPath,['acceptance.test.cjs',String(task)],{cwd:projectPath,encoding:'utf8',stdio:'pipe'}); }
    catch(err:any){exitCode=err.status||1;output=String(err.stdout||err.stderr||err.message);}
    dispatches.push({task,conversationId:options.conversationId,cwd:projectPath,exitCode});
    const logs=path.join(brain,options.conversationId,'.system_generated','logs');fs.mkdirSync(logs,{recursive:true});
    const transcript=path.join(logs,'transcript.jsonl');
    const events = [
      {type:'TOOL_CALL',status:'DONE',tool_calls:[{name:'write_to_file',args:{TargetFile:file}},{name:'run_command',args:{CommandLine:`node acceptance.test.cjs ${task}`},exit_code:exitCode,output}]},
      {type:'PLANNER_RESPONSE',status:'DONE',content:`Entrega simulada do incremento ${task}. Verificar independentemente o resultado.`,step_index:attempt}
    ];
    fs.appendFileSync(transcript,events.map(e=>JSON.stringify(e)).join('\n')+'\n');
  };
  AgentApiGateway.setMockProvider(provider);
  AccountProfileManager.updateStatus('acc-pro-1','READY');
  WorkerRegistry.setProbeOverrideForTest(async () => ({conversationId:'conv-fixture-runtime',pid:process.pid}));
  db.prepare("INSERT INTO model_preferences (role,model_id,project_id,updated_at) VALUES ('builder','flash',?,?)").run(projectId,new Date().toISOString());
  return { provider, dispatches, tasks, brain, dataDir:HUB_DATA_DIR };
}
