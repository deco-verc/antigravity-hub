'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {Ledger}=require('./ledger.cjs');
function reconcile(ledger,proof){
  const before=ledger.snapshot();
  assert.equal(proof.liveApprovalPresent,false,'Reconciliation must not coexist with live authorization');
  assert.equal(before.activeCalls.length,0,'Active external call cannot be reconciled automatically');
  assert.equal(ledger.db.prepare('SELECT COUNT(*) n FROM backend_lease').get().n,0,'Backend owner must be absent');
  assert.equal(before.creations.length,2);assert.ok(before.creations.every(c=>c.status==='CONFIRMED'));
  assert.ok(before.sends.every(s=>s.status==='CONFIRMED'),'Ambiguous transport receipt remains blocked');
  assert.ok(proof.transcripts.length===2&&proof.transcripts.every(t=>t.done&&t.pendingTools.length===0));
  for(const c of before.creations){const t=proof.transcripts.find(t=>t.id===c.conversation_id);assert.ok(t&&t.role===c.role);}
  assert.ok(proof.sessionsMatchLedger);assert.ok(proof.originalWorkerFilesUnchanged);
  assert.ok([null,'NATIVE_TURN_AMBIGUOUS'].includes(before.control.halt_reason),'Unrelated halts require separate investigation');
  if(before.control.halt_reason){
    ledger.db.exec('BEGIN IMMEDIATE');
    try{
      ledger.db.prepare("UPDATE control SET halt_reason=NULL WHERE id=1 AND halt_reason='NATIVE_TURN_AMBIGUOUS'").run();
      ledger.event('COMPLETED_NATIVE_TURN_RECONCILED',{previousReason:before.control.halt_reason,transcripts:proof.transcripts,proofHash:crypto.createHash('sha256').update(JSON.stringify(proof)).digest('hex'),physicalReservationsPreserved:2,newAuthorization:false,sendOnly:true});
      ledger.db.exec('COMMIT');
    }catch(e){ledger.db.exec('ROLLBACK');throw e;}
  }
  const after=ledger.snapshot();assert.deepEqual(after.creations,before.creations);assert.deepEqual(after.sends,before.sends);assert.deepEqual(after.binding,before.binding);
  return {previousReason:before.control.halt_reason,currentReason:after.control.halt_reason,physicalCount:2,additionalCalls:0,liveAuthorized:false};
}
module.exports={reconcile};
if(require.main===module){
  const root='C:/IA/DecoHUB-native-sandbox-20261009',cfg=JSON.parse(fs.readFileSync(path.join(root,'sandbox.json'),'utf8'));
  const evidence=JSON.parse(fs.readFileSync(path.join(root,'logs/full-system-qa/final-readonly-evidence.json'),'utf8'));
  assert.ok(Date.now()-Date.parse(evidence.at)<60000,'Refresh read-only evidence first');
  assert.equal(evidence.decohubProcesses.length,0);assert.equal(evidence.production.activeLeases,0);assert.equal(evidence.production.activeWorkers,0);assert.ok(evidence.runtime);
  const proof={transcripts:evidence.transcripts,transcriptHashes:evidence.transcripts.map(t=>({id:t.id,hash:crypto.createHash('sha256').update(fs.readFileSync(path.join('C:/Users/Deco/.gemini/antigravity/brain',t.id,'.system_generated/logs/transcript.jsonl'))).digest('hex')})),sessionsMatchLedger:evidence.sessions.length===2&&evidence.sessions.every(s=>evidence.ledger.creations.some(c=>c.conversation_id===s.id&&c.role===s.role&&c.model===s.model)&&s.status==='ACTIVE'&&s.accountProfileId===cfg.binding.accountProfileId&&s.nativeProjectId===cfg.nativeProjectId),originalWorkerFilesUnchanged:evidence.workerFilesUnchangedSinceEvaluation,liveApprovalPresent:fs.existsSync(path.join(cfg.controlRoot,'live-approval.json'))};
  // Re-read the final event just before the transaction; no stale DONE is accepted.
  for(const t of proof.transcripts){const rows=fs.readFileSync(path.join('C:/Users/Deco/.gemini/antigravity/brain',t.id,'.system_generated/logs/transcript.jsonl'),'utf8').split(/\r?\n/).filter(Boolean).map(l=>JSON.parse(l));const last=rows.at(-1);assert.equal(last.step_index,t.lastStep);assert.equal(last.type,'PLANNER_RESPONSE');assert.equal(last.status,'DONE');assert.ok(last.content&&!last.tool_calls?.length);}
  const ledger=new Ledger(cfg.controlRoot,cfg.binding);try{const result=reconcile(ledger,proof);fs.writeFileSync(path.join(cfg.controlRoot,'reconciliation-1.0.5.json'),JSON.stringify({at:new Date().toISOString(),...result,proof},null,2));console.log(JSON.stringify(result));}finally{ledger.close();}
}
