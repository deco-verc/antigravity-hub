'use strict';
const fs=require('node:fs'),path=require('node:path');
function assertQaProjectPolicy(project){
  if(project.settings?.fileAccessPolicy!=='AGENT_SETTING_POLICY_DENY'||project.settings?.autoExecutionPolicy!=='CASCADE_COMMANDS_AUTO_EXECUTION_OFF')throw Error('QA_NATIVE_DENY_REVIEW_REQUIRED');
  const denies=project.permissionGrants?.permissionGrants?.deny;
  if(!Array.isArray(denies)||!denies.includes('command(*)')||!denies.includes('mcp(*)'))throw Error('QA_PROJECT_COMMAND_AND_MCP_DENY_REQUIRED');
}
function installSafeVerification(config,ledger){
  const cp=require('node:child_process'),originalExecSync=cp.execSync;
  const executor=require(config.normalFlow.safeExecutor);
  cp.execSync=function(command,options={}){
    if(path.resolve(options.cwd||process.cwd()).toLowerCase()!==path.resolve(config.projectRoot).toLowerCase())return originalExecSync.call(this,command,options);
    // Existing Evaluator git evidence is read-only; no arbitrary verification shell.
    if(command==='git status --porcelain'||/^git show HEAD(?:~1)?:"[a-zA-Z0-9_./-]+"$/.test(command))return originalExecSync.call(this,command,options);
    if(path.resolve(executor.PROJECT).toLowerCase()!==path.resolve(config.projectRoot).toLowerCase())throw Error('QA_EXECUTOR_PROJECT_MISMATCH');
    const result=executor.runSync(command);
    ledger.event('NORMAL_CONTROLLED_VERIFICATION',{command,resultFile:result.resultFile,exitCode:result.exitCode,originalFilesUnchanged:result.originalFilesUnchanged,origin:'Product IndependentEvaluator/Runner verification; local safe executor',physicalAgentCalls:0});
    const stdout=options.encoding?result.stdout:Buffer.from(result.stdout),stderr=options.encoding?result.stderr:Buffer.from(result.stderr);
    if(result.exitCode!==0){const error=Error('QA verification failed');error.status=result.exitCode;error.stdout=stdout;error.stderr=stderr;throw error;}return stdout;
  };
  require('node:module').syncBuiltinESMExports();
  return ()=>{cp.execSync=originalExecSync;require('node:module').syncBuiltinESMExports();};
}
module.exports={assertQaProjectPolicy,installSafeVerification};
