'use strict';
// Compatibility tool for the existing protected QA suite. The product's Evaluator
// retains its own contracts, verdicts and persistence. No model or Runner is replaced.
const path=require('node:path');
function assertQaProjectPolicy(project,config={}){
  const server=config.packagedServer||path.resolve(__dirname,'../../../server/dist');
  const {assertNativeExecutionPolicy}=require(path.join(server,'nativePolicyValidation.js'));
  return assertNativeExecutionPolicy(project.settings,config.executionPolicy);
}
function assertLivePolicyApproval(config,approval){
  const mode=config.executionPolicy?.mode||'restricted';
  if(approval.executionPolicyMode!==mode)throw Error('NORMAL_EXECUTION_POLICY_AUTHORIZATION_MISMATCH');
  if(mode==='permissive'&&approval.nativeOutsideScopeRiskAccepted!==true)throw Error('NORMAL_NATIVE_OUTSIDE_SCOPE_RISK_ACKNOWLEDGEMENT_REQUIRED');
}
function installVerificationTool(config,ledger){
  const verification=require(path.join(config.packagedServer,'controlledVerification.js'));
  const executor=require(config.normalFlow.safeExecutor);
  if(path.resolve(executor.PROJECT).toLowerCase()!==path.resolve(config.projectRoot).toLowerCase())throw Error('QA_EXECUTOR_PROJECT_MISMATCH');
  const saved={executeVerification:verification.executeVerification,executeVerificationAsync:verification.executeVerificationAsync};
  const validate=(command,project)=>{
    if(command!=='npm test'||path.resolve(project).toLowerCase()!==path.resolve(config.projectRoot).toLowerCase())throw Error('QA_EXACT_VERIFICATION_ONLY');
  };
  const finish=(command,result,onStarted)=>{
    if(result.timedOut||result.overflow||!result.originalFilesUnchanged||!result.snapshotUnchanged)throw Error('QA_RESULT_NOT_RECONCILED');
    const operation={executable:result.actualExecutable,args:result.actualArguments,cwd:result.cwd,sourceProject:result.sourceProject,recordPath:result.resultFile,durationMs:result.durationMs||0};
    onStarted?.(operation);
    ledger.event('NORMAL_CONTROLLED_VERIFICATION',{command,...operation,exitCode:result.exitCode,origin:'1.0.6 product IndependentEvaluator -> hash-pinned local QA verification tool',physicalAgentCalls:0});
    if(result.exitCode!==0){const error=Error('QA verification failed');error.status=result.exitCode;error.stdout=result.stdout;error.stderr=result.stderr;throw error;}
    return result.stdout;
  };
  const blocked=error=>{if(error.message==='QA verification failed')return error;error.code='COMMAND_REVIEW_REQUIRED';return error;};
  verification.executeVerification=function(command,project,timeout,onStarted){try{validate(command,project);return finish(command,executor.runSync(command),onStarted);}catch(error){throw blocked(error);}};
  verification.executeVerificationAsync=async function(command,project,timeout,onStarted){try{validate(command,project);return finish(command,await executor.run(command,{timeoutMs:Math.min(timeout||30000,30000)}),onStarted);}catch(error){throw blocked(error);}};
  ledger.event('QA_LOCAL_VERIFICATION_TOOL_READY',{scope:'Only protected existing npm test; no shell or agent messages',stockExecutorReplacedForQA:true,productEvaluatorUnmodified:true});
  return ()=>Object.assign(verification,saved);
}
module.exports={assertQaProjectPolicy,assertLivePolicyApproval,installVerificationTool};
