'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {assertQaProjectPolicy,assertLivePolicyApproval,installVerificationTool}=require('./verification-tool.cjs');
const {assertApprovedBudget}=require('./normal-flow-policy.cjs');
test('default is Deny/Review; explicit ALLOW/EAGER choice uses the product validator',()=>{
  const project={settings:{fileAccessPolicy:'AGENT_SETTING_POLICY_DENY',autoExecutionPolicy:'CASCADE_COMMANDS_AUTO_EXECUTION_OFF'}};
  assert.doesNotThrow(()=>assertQaProjectPolicy(project));
  for(const [key,value] of [['fileAccessPolicy','AGENT_SETTING_POLICY_ALLOW'],['autoExecutionPolicy','CASCADE_COMMANDS_AUTO_EXECUTION_EAGER']])assert.throws(()=>assertQaProjectPolicy({settings:{...project.settings,[key]:value}}));
  const permissive={settings:{fileAccessPolicy:'AGENT_SETTING_POLICY_ALLOW',autoExecutionPolicy:'CASCADE_COMMANDS_AUTO_EXECUTION_EAGER'}};
  const config={executionPolicy:{mode:'permissive',acknowledgement:{userConsent:'User selected ALLOW/EAGER',outsideAccessAllowed:true,automaticCommandsAllowed:true,noFilesystemIsolation:true}}};
  assert.deepEqual(assertQaProjectPolicy(permissive,config),{mode:'permissive',outsideAccessDenied:false,manualCommandReview:false,filesystemIsolation:false});
  assert.throws(()=>assertQaProjectPolicy(permissive,{executionPolicy:{mode:'permissive'}}),/ACKNOWLEDGEMENT/);
  assert.throws(()=>assertQaProjectPolicy(project,config),/POLICY_MISMATCH/);
  assert.throws(()=>assertLivePolicyApproval(config,{executionPolicyMode:'restricted'}),/AUTHORIZATION_MISMATCH/);
  assert.throws(()=>assertLivePolicyApproval(config,{executionPolicyMode:'permissive'}),/RISK_ACKNOWLEDGEMENT/);
  assert.doesNotThrow(()=>assertLivePolicyApproval(config,{executionPolicyMode:'permissive',nativeOutsideScopeRiskAccepted:true}));
});
test('build-specific authorization is required; original authorization cannot release 1.0.6',()=>{
  assert.throws(()=>assertApprovedBudget({scope:'NORMAL_CHAT_1.0.5_ONE_REPAIR_RUN',authorizedSends:6},0,'PLANNING'));
  assert.doesNotThrow(()=>assertApprovedBudget({scope:'NORMAL_CHAT_1.0.6_ONE_REPAIR_RUN',authorizedSends:6},0,'PLANNING'));
  assert.throws(()=>assertApprovedBudget({scope:'NORMAL_CHAT_1.0.6_ONE_REPAIR_RUN',authorizedSends:6},6,'FINAL_REVIEW'));
});
test('unchanged 1.0.6 Evaluator detects the real protected HTTP failure through the restricted verification tool',async()=>{
  const isolated=fs.mkdtempSync(path.join(os.tmpdir(),'decohub-native106-evaluator-'));
  process.env.AI_DEV_HUB_DATA_DIR=isolated;process.env.DECOHUB_OFFLINE_MODE='true';process.env.DECOHUB_ALLOW_LIVE_AGENTAPI='false';
  const server=process.env.DECOHUB_PREPARATION_SERVER||path.resolve(__dirname,'../../../dist-desktop-1.0.6/win-unpacked/resources/app.asar.unpacked/server/dist');
  const config={packagedServer:server,projectRoot:'C:/IA/DecoHUB-native-sandbox-20261009/project',normalFlow:{safeExecutor:require.resolve('./qa-safe-executor.cjs')}};
  const verification=require(path.join(server,'controlledVerification.js'));
  const before=verification.executeVerification;
  const executor=require(config.normalFlow.safeExecutor),inventory=executor.inventory(config.projectRoot),events=[];
  const restore=installVerificationTool(config,{event:(name,data)=>events.push({name,...data})});
  const {IndependentEvaluator}=require(path.join(server,'independentEvaluator.js')),{db}=require(path.join(server,'db.js'));
  try{
    assert.throws(()=>verification.executeVerification('npm test && whoami',config.projectRoot),/EXACT_VERIFICATION/);
    assert.throws(()=>verification.executeVerification('npm test',config.projectRoot+'-other'),/EXACT_VERIFICATION/);
    const contract=IndependentEvaluator.createSuccessContract({taskId:'native106-preparation-only',projectId:'offline-evaluator',projectPath:config.projectRoot,objective:'Malformed URL returns 400 and subsequent health returns 200',acceptanceCriteria:['Malformed URL must not crash the HTTP API'],verificationCommand:'npm test',isBugFix:true});
    assert.equal(contract.baseline.ran,true);assert.equal(contract.baseline.passed,false);
    const result=await IndependentEvaluator.evaluate(contract.id,config.projectRoot,{status:'success',filesChanged:[],implemented:['Read-only diagnosis of the existing HTTP failure; no Worker repair']},{taskMode:'AUDIT'});
    assert.equal(result.verdict,'FAIL');assert.equal(result.taskIsDone,false);
    assert.match(result.evidence.output,/ERR_INVALID_URL|Malformed URL crashed/);
    assert.equal(events.filter(e=>e.name==='NORMAL_CONTROLLED_VERIFICATION').length,2);
    assert.deepEqual(executor.inventory(config.projectRoot),inventory);
    fs.writeFileSync(path.join(isolated,'proof.json'),JSON.stringify({scope:'Offline verification compatibility only, not native Chat/Runner proof',version:'1.0.6',result,events,originalProjectUnchanged:true,modelCalls:0},null,2));
  }finally{restore();assert.equal(verification.executeVerification,before);db.close();}
});
