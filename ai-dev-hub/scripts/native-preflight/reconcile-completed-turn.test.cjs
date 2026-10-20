'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Ledger,Boundary}=require('./ledger.cjs'),{reconcile}=require('./reconcile-completed-turn.cjs');
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'decohub-reconcile-fixture-')),binding={projectId:'same',accountProfileId:'pro1',models:{SUPERVISOR:'pro',WORKER:'flash'}};Ledger.initialize(root,binding);const ledger=new Ledger(root,binding);t.after(()=>ledger.close());
  const b=new Boundary(ledger,()=>{});
  for(const role of ['SUPERVISOR','WORKER'])b.invoke({projectId:'same',accountProfileId:'pro1',role,model:binding.models[role],verb:'new-conversation',promptHash:role},()=>JSON.stringify({response:{newConversation:{conversationId:role}}}));
  ledger.halt('NATIVE_TURN_AMBIGUOUS');
  const proof={liveApprovalPresent:false,sessionsMatchLedger:true,originalWorkerFilesUnchanged:true,transcripts:['SUPERVISOR','WORKER'].map(role=>({id:role,role,done:true,pendingTools:[]}))};return {ledger,proof};
}
test('Completed-turn reconciliation preserves cap/history, authorizes no inference, and is idempotent',t=>{
  const {ledger,proof}=fixture(t),before=ledger.snapshot();assert.equal(reconcile(ledger,proof).liveAuthorized,false);assert.equal(ledger.snapshot().control.halt_reason,null);assert.deepEqual(ledger.snapshot().creations,before.creations);assert.deepEqual(ledger.snapshot().sends,before.sends);assert.equal(reconcile(ledger,proof).additionalCalls,0);
  assert.throws(()=>ledger.reserve({projectId:'same',accountProfileId:'pro1',role:'SUPERVISOR',model:'pro',verb:'new-conversation'}),/ABSOLUTE_CREATION_CAP/);
});
test('Pending native tool, stale association or live approval cannot clear the freeze',t=>{
  for(const variant of ['pending','association','approval']){const {ledger,proof}=fixture(t);if(variant==='pending')proof.transcripts[1].done=false;if(variant==='association')proof.sessionsMatchLedger=false;if(variant==='approval')proof.liveApprovalPresent=true;assert.throws(()=>reconcile(ledger,proof));assert.equal(ledger.snapshot().control.halt_reason,'NATIVE_TURN_AMBIGUOUS');}
});
test('Active calls and backend ownership remain blocked even with DONE',t=>{
  const {ledger,proof}=fixture(t);ledger.claimBackend();assert.throws(()=>reconcile(ledger,proof));ledger.db.prepare('DELETE FROM backend_lease').run();ledger.db.prepare('INSERT INTO active_call VALUES(1,?,?)').run('ambiguous',process.pid);assert.throws(()=>reconcile(ledger,proof));assert.equal(ledger.snapshot().control.halt_reason,'NATIVE_TURN_AMBIGUOUS');
});
