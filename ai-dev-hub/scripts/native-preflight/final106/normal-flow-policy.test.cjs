'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {assertNormalFlow,assertApprovedBudget}=require('./normal-flow-policy.cjs');
const config={binding:{projectId:'existing'},normalFlow:{ids:{SUPERVISOR:'sup',WORKER:'worker'},baselineSends:3,maxSends:6,objectiveHash:crypto.createHash('sha256').update('Repair URL').digest('hex')}};
function state(roles,role,status,taskStatus='in_progress'){
  return {role,config,sends:[{},{},{}].concat(roles.map(r=>({conversation_id:r==='SUPERVISOR'?'sup':'worker',status:'CONFIRMED'}))),runs:[{id:'same-run',project_id:'existing',objective:'Repair URL',status}],tasks:roles.length?[{title:'Corrigir URL',description:'ERR_INVALID_URL',status:taskStatus,verification_command:'npm test',retry_count:1}]:[],evaluation:{verdict:'PASS',taskIsDone:true},reviews:[{verdict:'CHANGES_REQUESTED'}]};
}
test('Normal flow permits exactly planning, repair, independent review and final acceptance',()=>{
  assert.equal(assertNormalFlow(state([],'SUPERVISOR','planning')),'PLANNING');
  assert.equal(assertNormalFlow(state(['SUPERVISOR'],'WORKER','building')),'REPAIR');
  assert.equal(assertNormalFlow(state(['SUPERVISOR','WORKER'],'SUPERVISOR','reviewing','in_review')),'TASK_REVIEW');
  assert.equal(assertNormalFlow(state(['SUPERVISOR','WORKER','SUPERVISOR'],'SUPERVISOR','running','completed')),'FINAL_REVIEW');
});
test('A single evidence-backed corrective attempt fits six calls; no seventh call',()=>{
  const r=['SUPERVISOR','WORKER','SUPERVISOR'];
  assert.equal(assertNormalFlow(state(r,'WORKER','building')),'REPAIR_ONCE_MORE');r.push('WORKER');
  assert.equal(assertNormalFlow(state(r,'SUPERVISOR','reviewing','in_review')),'TASK_REVIEW');r.push('SUPERVISOR');
  assert.equal(assertNormalFlow(state(r,'SUPERVISOR','running','completed')),'FINAL_REVIEW');r.push('SUPERVISOR');
  assert.throws(()=>assertNormalFlow(state(r,'SUPERVISOR','planning')),/SEND_BUDGET_EXHAUSTED/);
});
test('Extra tasks, wrong objective, unapproved repair and absent PASS are refused before dispatch',()=>{
  const s=state(['SUPERVISOR'],'WORKER','building');s.tasks.push({...s.tasks[0]});assert.throws(()=>assertNormalFlow(s),/SINGLE_REPAIR_TASK/);
  const wrong=state([],'SUPERVISOR','planning');wrong.runs[0].objective='new project';assert.throws(()=>assertNormalFlow(wrong),/OBJECTIVE_MISMATCH/);
  const repair=state(['SUPERVISOR','WORKER','SUPERVISOR'],'WORKER','building');repair.reviews=[];assert.throws(()=>assertNormalFlow(repair),/BOUNDED_REPAIR_ONLY/);
  const final=state(['SUPERVISOR','WORKER','SUPERVISOR'],'SUPERVISOR','running','completed');final.evaluation={verdict:'FAIL',taskIsDone:false};assert.throws(()=>assertNormalFlow(final),/ACCEPTANCE_NEEDS_PASS/);
});
test('Ambiguity, unexpected roles, repeated final review and wrong test command remain blocked',()=>{
  const s=state(['SUPERVISOR'],'WORKER','building');s.sends.at(-1).status='UNCERTAIN';assert.throws(()=>assertNormalFlow(s),/RESULT_UNCERTAIN/);
  assert.throws(()=>assertNormalFlow(state(['WORKER'],'WORKER','building')),/SEQUENCE_MISMATCH/);
  assert.throws(()=>assertNormalFlow(state(['SUPERVISOR','WORKER','SUPERVISOR','SUPERVISOR'],'SUPERVISOR','reviewing','in_review')),/SECOND_REVIEW_ONLY/);
  const t=state(['SUPERVISOR'],'WORKER','building');t.tasks[0].verification_command='node --test test/server.test.cjs';assert.throws(()=>assertNormalFlow(t),/SINGLE_REPAIR_TASK/);
});
test('Four-call authorization does not silently authorize the six-call corrective branch',()=>{
  const approval={scope:'NORMAL_CHAT_1.0.6_ONE_REPAIR_RUN',authorizedSends:4};
  assert.doesNotThrow(()=>assertApprovedBudget(approval,3,'FINAL_REVIEW'));
  assert.throws(()=>assertApprovedBudget(approval,3,'REPAIR_ONCE_MORE'),/ADDITIONAL_REPAIR_AUTHORIZATION/);
  assert.throws(()=>assertApprovedBudget(approval,4,'FINAL_REVIEW'),/SEND_BUDGET_EXHAUSTED/);
  assert.throws(()=>assertApprovedBudget({...approval,scope:'old-controller-authorization'},0,'PLANNING'),/SPECIFIC_USER_AUTHORIZATION/);
  assert.doesNotThrow(()=>assertApprovedBudget({...approval,authorizedSends:6},3,'REPAIR_ONCE_MORE'));
});
