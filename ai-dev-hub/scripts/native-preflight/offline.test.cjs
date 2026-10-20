'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');
const {Ledger,Boundary,digest,SafetyError} = require('./ledger.cjs');
const {extractUserData,selectRuntime,assertStableRuntime} = require('./runtime.cjs');
const version=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../package.json'),'utf8')).version;
const packagedServer = process.env.DECOHUB_TEST_PACKAGED_SERVER || path.resolve(__dirname,'../../dist-desktop-'+version+'/win-unpacked/resources/app.asar.unpacked/server/dist');
const binding = {projectId:'offline-project',accountProfileId:'acc-pro-1',models:{SUPERVISOR:'pro',WORKER:'flash'}};
function fixture(options={}) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'decohub-preflight-offline-'));
  fs.mkdirSync(path.join(root,'project'));fs.writeFileSync(path.join(root,'fixture.json'),JSON.stringify({binding,packagedServer,...options}));
  Ledger.initialize(path.join(root,'control'),binding);
  return {root,ledger:new Ledger(path.join(root,'control'),binding)};
}
const req = (role='SUPERVISOR',extra={}) => ({verb:'new-conversation',role,model:binding.models[role],projectId:binding.projectId,accountProfileId:binding.accountProfileId,promptHash:digest(role),...extra});
const reply = id => JSON.stringify({response:{newConversation:{conversationId:id}}});
const run = (root,mode,...args) => {
  const output=cp.execFileSync(process.execPath,[path.join(__dirname,'fixture-child.cjs'),mode,root,...args],{encoding:'utf8',timeout:15000,windowsHide:true});
  return JSON.parse(output.trim().split(/\r?\n/).at(-1));
};

test('two reservations committed BEFORE simulated external callbacks; absolute third denial',()=>{
  const {ledger}=fixture();const boundary=new Boundary(ledger,()=>{});let count=0;
  for(const role of ['SUPERVISOR','WORKER']) boundary.invoke(req(role),()=>{count++;assert.equal(ledger.snapshot().creations.length,count);assert.equal(ledger.snapshot().activeCalls.length,1);return reply('fixture-'+role);});
  assert.throws(()=>boundary.invoke(req(),()=>{count++;return reply('unexpected');}),{code:'ABSOLUTE_CREATION_CAP'});
  assert.equal(count,2);assert.equal(ledger.snapshot().creations.length,2);assert.equal(ledger.snapshot().control.halt_reason,'ABSOLUTE_CREATION_CAP');ledger.close();
});
test('no expiry after eleven minutes or new run/task; restart retains cap',()=>{
  const {root,ledger}=fixture();const boundary=new Boundary(ledger,()=>{});
  const RealDate=Date;global.Date=class extends RealDate {constructor(...args){super(...(args.length?args:[RealDate.now()-660000]));}};
  try {boundary.invoke(req(),()=>reply('fixture-supervisor'));}finally{global.Date=RealDate;}ledger.close();
  const result=run(root,'attempt');assert.equal(result.code,'ABSOLUTE_CREATION_CAP');assert.equal(result.called,0);
  const after=new Ledger(path.join(root,'control'),binding);assert.equal(after.snapshot().creations.length,1);after.close();
});
test('another project/task cannot acquire a new budget',()=>{
  const {ledger}=fixture();let count=0;
  assert.throws(()=>new Boundary(ledger,()=>{}).invoke(req('SUPERVISOR',{projectId:'another-project',taskId:'new-task'}),()=>{count++;}),{code:'PROFILE_PROJECT_OR_MODEL_MISMATCH'});assert.equal(count,0);ledger.close();
});
test('ambiguous timeout consumes role and blocks BOTH roles across restart',()=>{
  const {root,ledger}=fixture();let count=0;assert.throws(()=>new Boundary(ledger,()=>{}).invoke(req(),()=>{count++;throw new Error('simulated timeout');}),{code:'EXTERNAL_RESULT_UNCERTAIN'});
  assert.equal(ledger.snapshot().creations[0].status,'UNCERTAIN');assert.equal(count,1);ledger.close();
  for(const role of ['SUPERVISOR','WORKER']) {const result=run(root,'attempt',role);assert.equal(result.code,'HALTED_RECONCILIATION_REQUIRED');assert.equal(result.called,0);}
});
test('missing ID and duplicate provider ID halt, without extra creation',()=>{
  for(const bad of ['not JSON','{}']) {const {ledger}=fixture();assert.throws(()=>new Boundary(ledger,()=>{}).invoke(req(),()=>bad),{code:'EXTERNAL_RESULT_UNCERTAIN'});assert.equal(ledger.snapshot().creations[0].status,'UNCERTAIN');ledger.close();}
  const {ledger}=fixture();const boundary=new Boundary(ledger,()=>{});boundary.invoke(req(),()=>reply('same-id'));
  assert.throws(()=>boundary.invoke(req('WORKER'),()=>reply('same-id')),{code:'EXTERNAL_RESULT_UNCERTAIN'});assert.equal(ledger.snapshot().creations.length,2);ledger.close();
});
test('crash after reservation does not clear owner lock on next process',()=>{
  const {root,ledger}=fixture();ledger.close();assert.equal(run(root,'reserve-crash').reserved,true);const result=run(root,'attempt','WORKER');assert.equal(result.code,'CONCURRENT_OR_UNRECONCILED_CALL');assert.equal(result.called,0);
});
test('missing ledger or anchor fail closed instead of reinitializing',()=>{
  for(const file of ['control.sqlite','ledger.anchor.json']) {const {root,ledger}=fixture();ledger.close();fs.renameSync(path.join(root,'control',file),path.join(root,'control',file+'.retained'));assert.throws(()=>Ledger.initialize(path.join(root,'control'),binding),{code:'LEDGER_MISSING_NO_AUTOMATIC_RESET'});}
});
test('repeated preparation keeps reservations and rejects changed binding',()=>{
  const {root,ledger}=fixture();new Boundary(ledger,()=>{}).invoke(req(),()=>reply('kept'));ledger.close();Ledger.initialize(path.join(root,'control'),binding);
  const after=new Ledger(path.join(root,'control'),binding);assert.equal(after.snapshot().creations[0].conversation_id,'kept');after.close();assert.throws(()=>new Ledger(path.join(root,'control'),{...binding,projectId:'new'}),{code:'SANDBOX_BINDING_CHANGED'});
});
test('separate backend lease refuses simultaneous backend, survives unreconciled crash',()=>{
  const {root,ledger}=fixture();ledger.claimBackend();const second=new Ledger(path.join(root,'control'),binding);assert.throws(()=>second.claimBackend(),{code:'SANDBOX_BACKEND_BUSY_OR_UNRECONCILED'});second.close();ledger.close();
  const clean=new Ledger(path.join(root,'control'),binding);clean.claimBackend();clean.close();
  const crash=fixture();crash.ledger.close();run(crash.root,'backend-crash');const after=new Ledger(path.join(crash.root,'control'),binding);assert.throws(()=>after.claimBackend(),{code:'SANDBOX_BACKEND_BUSY_OR_UNRECONCILED'});after.close();
});
test('direct SQL deletion cannot free creation budget',()=>{
  const {ledger}=fixture();new Boundary(ledger,()=>{}).invoke(req(),()=>reply('kept'));assert.throws(()=>ledger.db.exec('DELETE FROM creations'));assert.equal(ledger.snapshot().creations.length,1);ledger.close();
});
test('known sessions accept multiple distinct send-message tasks, duplicate suppressed',()=>{
  const {ledger}=fixture();const boundary=new Boundary(ledger,()=>{});boundary.invoke(req(),()=>reply('kept'));let count=0;
  for(const prompt of ['first','second']) boundary.invoke(req('SUPERVISOR',{verb:'send-message',conversationId:'kept',promptHash:digest(prompt)}),()=>{count++;return '';});
  assert.throws(()=>boundary.invoke(req('SUPERVISOR',{verb:'send-message',conversationId:'kept',promptHash:digest('second')}),()=>{count++;}),{code:'DUPLICATE_MESSAGE'});assert.equal(count,2);assert.equal(ledger.snapshot().creations.length,1);ledger.close();
});
test('unknown conversation and changed account/model denied before callback',()=>{
  for(const extra of [{verb:'send-message',conversationId:'foreign'},{accountProfileId:'foreign'},{model:'flash'}]) {const {ledger}=fixture();let called=0;assert.throws(()=>new Boundary(ledger,()=>{}).invoke(req('SUPERVISOR',extra),()=>{called++;}));assert.equal(called,0);ledger.close();}
});
test('missing identity, paid policy or authorization does not consume a slot',()=>{
  for(const code of ['IDENTITY_UNKNOWN','PAID_POLICY_UNKNOWN','LIVE_AUTHORIZATION_MISSING']) {const {ledger}=fixture();let called=0;assert.throws(()=>new Boundary(ledger,()=>{throw new SafetyError(code);}).invoke(req(),()=>{called++;}),{code});assert.equal(called,0);assert.equal(ledger.snapshot().creations.length,0);ledger.close();}
});
test('two independent processes race: at most one callback for the same role',async()=>{
  const {root,ledger}=fixture();ledger.close();
  const launch=()=>new Promise((resolve,reject)=>{const child=cp.spawn(process.execPath,[path.join(__dirname,'fixture-child.cjs'),'attempt',root],{windowsHide:true});let output='';child.stdout.on('data',v=>output+=v);child.stderr.on('data',()=>{});child.on('error',reject);child.on('close',()=>resolve(JSON.parse(output.trim().split(/\r?\n/).at(-1))));});
  const results=await Promise.all([launch(),launch()]);assert.equal(results.reduce((n,r)=>n+r.called,0),1);const after=new Ledger(path.join(root,'control'),binding);assert.equal(after.snapshot().creations.length,1);after.close();
});
test('packaged backend persists and reuses two sessions after process restart; rejects different account/model',()=>{
  const {root,ledger}=fixture();ledger.close();const first=run(root,'sessions-create');assert.ok(first.result.every(r=>r.isNew));assert.equal(first.snapshot.creations.length,2);
  const second=run(root,'sessions-reuse');assert.ok(second.result.every(r=>!r.isNew));assert.deepEqual(second.result.map(r=>r.id),first.result.map(r=>r.id));assert.equal(second.snapshot.creations.length,2);assert.equal(second.snapshot.sends.length,2);assert.equal(second.profileRejected,true);assert.equal(second.modelRejected,true);
});
test('packaged gateway physical LIVE branch with offline executable proxy blocks third call BEFORE proxy',()=>{
  const {root,ledger}=fixture();ledger.close();const result=run(root,'gateway-boundary');assert.equal(result.thirdCode,'ABSOLUTE_CREATION_CAP');assert.equal(result.called,result.beforeThird);assert.equal(result.snapshot.creations.length,2);assert.equal(result.snapshot.sends.length,2);assert.equal(result.realExecutableCalls,0);
});
test('actual sandbox preload denies raw sync, async, shell and auth launch bypasses',()=>{
  const {root,ledger}=fixture();ledger.close();const result=run(root,'guard-denial');assert.equal(result.codes.length,9);assert.ok(result.codes.slice(0,8).every(c=>c==='UNTRACKED_AGENT_PROCESS_DENIED'||c==='UNTRACKED_AGENT_CONTEXT_DENIED'));assert.equal(result.codes[8],'AUTH_OR_ACCOUNT_MUTATION_DENIED');assert.equal(result.realExecutableCalls,0);assert.equal(result.creations,0);
});
test('installed sandbox guard plus packaged gateway intercepts physical executor proxy and denies third creation',()=>{
  const {root,ledger}=fixture();ledger.close();const result=run(root,'installed-guard-boundary');assert.equal(result.deniedCode,'ABSOLUTE_CREATION_CAP');assert.equal(result.proxyCalls,2);assert.equal(result.snapshot.creations.length,2);assert.equal(result.realExecutableCalls,0);
});
test('packaged main-source selector preserves two-creation cap at installed guard boundary',()=>{
  const {root,ledger}=fixture();ledger.close();const result=run(root,'installed-guard-boundary','source-selector');assert.equal(result.mainSourceSelectorLoaded,true);assert.equal(result.deniedCode,'ABSOLUTE_CREATION_CAP');assert.equal(result.proxyCalls,2);assert.equal(result.snapshot.creations.length,2);assert.equal(result.realExecutableCalls,0);
});
test('installed guard blocks paid policy, identity, changed runtime and concurrent tasks BEFORE executor proxy',()=>{
  for(const variant of ['credits','identity','runtime','tasks']) {const {root,ledger}=fixture();ledger.close();const result=run(root,'installed-guard-boundary',variant);assert.ok(result.deniedCode);assert.equal(result.proxyCalls,0);assert.equal(result.snapshot.creations.length,0);assert.equal(result.realExecutableCalls,0);}
});
test('explicit ALLOW/EAGER retains third-creation barrier and readiness guards at the packaged boundary',()=>{
  const executionPolicy={mode:'permissive',acknowledgement:{userConsent:'Explicit offline permissive test',outsideAccessAllowed:true,automaticCommandsAllowed:true,noFilesystemIsolation:true}};
  const {root,ledger}=fixture({executionPolicy});ledger.close();const result=run(root,'installed-guard-boundary');
  assert.equal(result.deniedCode,'ABSOLUTE_CREATION_CAP');assert.equal(result.proxyCalls,2);assert.equal(result.snapshot.creations.length,2);assert.equal(result.realExecutableCalls,0);
  for(const variant of ['credits','identity','runtime','tasks']){const f=fixture({executionPolicy});f.ledger.close();const denied=run(f.root,'installed-guard-boundary',variant);assert.ok(denied.deniedCode);assert.equal(denied.proxyCalls,0);assert.equal(denied.realExecutableCalls,0);}
});
const defaults='C:\\Users\\Deco\\AppData\\Roaming\\Antigravity';
const isolated='C:\\Users\\Deco\\.ai-dev-hub\\profiles\\conta_02';
const tree=(dir=null)=>[{pid:1,parentPid:0,name:'Antigravity.exe',userDataDir:dir,started:'main-A'}, {pid:2,parentPid:1,name:'language_server.exe',started:'ls-A'}];
test('exact runtime mapping: default and separate secondary profile',()=>{
  assert.equal(selectRuntime(defaults,defaults,tree()).pid,2);assert.equal(selectRuntime(isolated,defaults,tree()),null);
  const second=tree(path.win32.join(isolated,'AppData','Roaming','Antigravity'));assert.equal(selectRuntime(defaults,defaults,second),null);assert.equal(selectRuntime(isolated,defaults,second).pid,2);
});
test('quoted/spaced/equals flags normalize correctly; duplicate flags refused',()=>{
  for(const text of ['Antigravity.exe --user-data-dir="C:\\My Profile"','Antigravity.exe --user-data-dir "C:\\My Profile"','Antigravity.exe "--user-data-dir=C:\\My Profile"'])assert.equal(extractUserData(text),'C:\\My Profile');
  assert.throws(()=>extractUserData('a --user-data-dir=a --user-data-dir=b'),{code:'AMBIGUOUS_USER_DATA_FLAGS'});
  assert.equal(selectRuntime(defaults,defaults,tree(defaults)).pid,2);
});
test('prefix collision cannot bind a neighboring profile (packaged matcher vulnerability reproduced)',()=>{
  const expected=path.win32.join(isolated,'AppData','Roaming','Antigravity');const neighbor=expected+'-copy';
  assert.equal(('Antigravity.exe --user-data-dir='+neighbor).toLowerCase().includes('--user-data-dir='+expected.toLowerCase()),true);
  assert.equal(selectRuntime(isolated,defaults,tree(neighbor)),null);
});
test('duplicate runtime, orphan LS and reused PID after restart fail closed',()=>{
  assert.throws(()=>selectRuntime(defaults,defaults,[...tree(),{pid:3,parentPid:1,name:'language_server.exe',started:'ls-B'}]),{code:'MULTIPLE_RUNTIMES_FOR_PROFILE'});
  assert.equal(selectRuntime(defaults,defaults,[{pid:2,parentPid:9,name:'language_server.exe'}]),null);
  const original=selectRuntime(defaults,defaults,tree());assertStableRuntime(original,{...original});assert.throws(()=>assertStableRuntime(original,{...original,started:'new-start'}),{code:'RUNTIME_CHANGED_REVERIFICATION_REQUIRED'});
  assert.throws(()=>assertStableRuntime(original,{...original,pid:9}),{code:'RUNTIME_CHANGED_REVERIFICATION_REQUIRED'});
});
