'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const {assertQaProjectPolicy,installSafeVerification}=require('./qa-verification-bridge.cjs'),executor=require('./qa-safe-executor.cjs');
const safe=()=>({settings:{fileAccessPolicy:'AGENT_SETTING_POLICY_DENY',autoExecutionPolicy:'CASCADE_COMMANDS_AUTO_EXECUTION_OFF'},permissionGrants:{permissionGrants:{deny:['command(*)','mcp(*)']}}});
test('QA requires restrictive native policies and project overrides against global terminal/MCP grants',()=>{
  assert.doesNotThrow(()=>assertQaProjectPolicy(safe()));
  for(const key of ['fileAccessPolicy','autoExecutionPolicy']){const p=safe();p.settings[key]='ALLOW';assert.throws(()=>assertQaProjectPolicy(p));}
  for(const rule of ['command(*)','mcp(*)']){const p=safe();p.permissionGrants.permissionGrants.deny=p.permissionGrants.permissionGrants.deny.filter(r=>r!==rule);assert.throws(()=>assertQaProjectPolicy(p));}
  const p=safe();p.permissionGrants.permissionGrants.allow=['command(npm test)','mcp(ai-dev-hub/*)'];assert.doesNotThrow(()=>assertQaProjectPolicy(p));
});
test('bridge refuses another source project and arbitrary commands instead of dispatching a shell',()=>{
  const release=installSafeVerification({projectRoot:executor.PROJECT+'-other',normalFlow:{safeExecutor:require.resolve('./qa-safe-executor.cjs')}},{event(){}});
  try{assert.throws(()=>cp.execSync('npm test',{cwd:executor.PROJECT+'-other'}),/PROJECT_MISMATCH/);}finally{release();}
  const restore=installSafeVerification({projectRoot:executor.PROJECT,normalFlow:{safeExecutor:require.resolve('./qa-safe-executor.cjs')}},{event(){}});
  try{assert.throws(()=>cp.execSync('npm test && whoami',{cwd:executor.PROJECT}),/COMMAND_NOT_ALLOWED/);}finally{restore();}
});
test('packaged 1.0.5 IndependentEvaluator receives real controlled test output and rejects the known URL defect',async()=>{
  const output='C:/IA/DecoHUB-native-sandbox-20261009/logs/safe-executor';fs.mkdirSync(output,{recursive:true});
  process.env.AI_DEV_HUB_DATA_DIR=fs.mkdtempSync(path.join(output,'packaged-evaluator-'));process.env.DECOHUB_OFFLINE_MODE='true';process.env.DECOHUB_ALLOW_LIVE_AGENTAPI='false';
  const before=executor.inventory(executor.PROJECT),events=[];
  const restore=installSafeVerification({projectRoot:executor.PROJECT,normalFlow:{safeExecutor:require.resolve('./qa-safe-executor.cjs')}},{event:(event,details)=>events.push({event,...details})});
  const artifact=path.resolve(__dirname,'../../dist-desktop-1.0.5/win-unpacked/resources/app.asar.unpacked/server/dist');
  const {IndependentEvaluator}=require(path.join(artifact,'independentEvaluator.js')),{db}=require(path.join(artifact,'db.js'));
  try{
    const contract=IndependentEvaluator.createSuccessContract({taskId:'offline-safe-executor-proof',projectId:'offline-only',projectPath:executor.PROJECT,objective:'Known malformed URL must not crash HTTP server',acceptanceCriteria:['URL malformada retorna 400 sem derrubar o servidor'],verificationCommand:'npm test',isBugFix:true});
    assert.equal(contract.baseline.ran,true);assert.equal(contract.baseline.passed,false);assert.equal(contract.baseline.exitCode,1);
    assert.match(JSON.parse(fs.readFileSync(events[0].resultFile,'utf8')).stdout,/Malformed URL crashed|ERR_INVALID_URL/);
    const evaluation=await IndependentEvaluator.evaluate(contract.id,executor.PROJECT,{status:'success',filesChanged:[],implemented:['Offline diagnostic of existing code; controller made no Worker repair']},{taskMode:'AUDIT'});
    assert.equal(evaluation.verdict,'FAIL');assert.equal(evaluation.taskIsDone,false);assert.equal(events.length,2);assert.ok(events.every(e=>e.exitCode===1));
    assert.deepEqual(executor.inventory(executor.PROJECT),before);
    fs.writeFileSync(path.join(output,'packaged-evaluator-bridge.json'),JSON.stringify({status:'PASS',scope:'OFFLINE evaluator integration only; no Chat/Runner/model execution',artifact,events,evaluation,originalFilesUnchanged:true,physicalAgentCalls:0},null,2));
  }finally{restore();db.close();}
});
