'use strict';
const {SafetyError}=require('./ledger.cjs');
const deny=code=>{throw new SafetyError(code);};
/** Read-only gate before the gateway can dispatch a continuation. No scheduler replacements. */
function assertNormalFlow({role,config,sends,runs,tasks,evaluation,reviews}){
  const flow=config.normalFlow,tail=sends.slice(flow.baselineSends);
  if(tail.some(s=>s.status!=='CONFIRMED'))deny('NORMAL_FLOW_EXTERNAL_RESULT_UNCERTAIN');
  if(tail.length>=flow.maxSends)deny('NORMAL_FLOW_SEND_BUDGET_EXHAUSTED');
  if(runs.length!==1||runs[0].project_id!==config.binding.projectId)deny('NORMAL_FLOW_RUN_BINDING_MISMATCH');
  const run=runs[0];
  if(require('node:crypto').createHash('sha256').update(run.objective.replace(/\r\n/g,'\n').trim()).digest('hex')!==flow.objectiveHash)deny('NORMAL_FLOW_OBJECTIVE_MISMATCH');
  const roles=tail.map(s=>s.conversation_id===flow.ids.SUPERVISOR?'SUPERVISOR':s.conversation_id===flow.ids.WORKER?'WORKER':'UNKNOWN');
  const prefix=['SUPERVISOR','WORKER','SUPERVISOR'];
  if(roles.slice(0,3).some((r,i)=>r!==prefix[i]))deny('NORMAL_FLOW_CALL_SEQUENCE_MISMATCH');
  if(tail.length===0){if(role!=='SUPERVISOR'||run.status!=='planning'||tasks.length)deny('NORMAL_FLOW_PLANNING_ONLY');return 'PLANNING';}
  if(tasks.length!==1||!/URL|ERR_INVALID_URL/i.test(tasks[0].title+' '+tasks[0].description)||tasks[0].verification_command!=='npm test')deny('NORMAL_FLOW_EXPECTED_SINGLE_REPAIR_TASK');
  const task=tasks[0];
  if(tail.length===1){if(role!=='WORKER'||run.status!=='building'||task.status!=='in_progress')deny('NORMAL_FLOW_FIRST_REPAIR_ONLY');return 'REPAIR';}
  if(tail.length===2){if(role!=='SUPERVISOR'||run.status!=='reviewing'||task.status!=='in_review'||!evaluation)deny('NORMAL_FLOW_INDEPENDENT_EVIDENCE_REQUIRED');return 'TASK_REVIEW';}
  if(tail.length===3&&role==='WORKER'){
    if(run.status!=='building'||task.status!=='in_progress'||task.retry_count!==1||reviews.at(-1)?.verdict!=='CHANGES_REQUESTED')deny('NORMAL_FLOW_BOUNDED_REPAIR_ONLY');return 'REPAIR_ONCE_MORE';
  }
  if(tail.length===4){
    if(roles[3]!=='WORKER'||role!=='SUPERVISOR'||run.status!=='reviewing'||task.status!=='in_review'||!evaluation)deny('NORMAL_FLOW_SECOND_REVIEW_ONLY');return 'TASK_REVIEW';
  }
  if((tail.length===3||tail.length===5)&&role==='SUPERVISOR'){
    if(tail.length===5&&(roles[3]!=='WORKER'||roles[4]!=='SUPERVISOR'))deny('NORMAL_FLOW_CALL_SEQUENCE_MISMATCH');
    if(task.status!=='completed'||evaluation?.verdict!=='PASS'||!evaluation.taskIsDone)deny('NORMAL_FLOW_FINAL_ACCEPTANCE_NEEDS_PASS');return 'FINAL_REVIEW';
  }
  deny('NORMAL_FLOW_UNEXPECTED_CALL');
}
function assertApprovedBudget(approval,used,stage){
  if(approval.scope!=='NORMAL_CHAT_1.0.5_ONE_REPAIR_RUN'||![4,6].includes(approval.authorizedSends))deny('NORMAL_SPECIFIC_USER_AUTHORIZATION_REQUIRED');
  if(used>=approval.authorizedSends)deny('NORMAL_AUTHORIZED_SEND_BUDGET_EXHAUSTED');
  if(stage==='REPAIR_ONCE_MORE'&&approval.authorizedSends!==6)deny('NORMAL_ADDITIONAL_REPAIR_AUTHORIZATION_REQUIRED');
}
module.exports={assertNormalFlow,assertApprovedBudget};
