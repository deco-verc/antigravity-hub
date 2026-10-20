'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
const {plan,inventory,validateSource,minimalEnv,PROJECT}=require('./qa-safe-executor.cjs');
const manifest={'test/calculator.test.cjs':'abc','test/server.test.cjs':'def'};
test('exact command plans; extra arguments, shell syntax and other directories rejected',()=>{
  assert.deepEqual(plan('npm test',PROJECT,manifest),Object.keys(manifest));
  assert.deepEqual(plan('node --test',PROJECT,manifest),Object.keys(manifest));
  assert.deepEqual(plan('node --test test/server.test.cjs',PROJECT,manifest),['test/server.test.cjs']);
  for(const command of ['npm test -- --eval evil','npm test && whoami','npm test; whoami','node --test ../evil.cjs','node --test test/missing.test.cjs','node --test --require evil','node -e evil','npm install','cmd /c npm test','powershell npm test','node --test test/server.test.cjs | whoami','npm test\nwhoami'])assert.throws(()=>plan(command,PROJECT,manifest));
  for(const dir of [PROJECT+'-other',path.dirname(PROJECT),'C:/IA/FinanceFlow'])assert.throws(()=>plan('npm test',dir,manifest));
});
test('environment does not inherit auth, model, preload, PATH, npm or shell overrides',()=>{
  const result=minimalEnv(PROJECT);assert.deepEqual(Object.keys(result).sort(),['DECOHUB_ALLOW_LIVE_AGENTAPI','DECOHUB_OFFLINE_MODE','SystemRoot','TEMP','TMP','WINDIR'].sort());
  assert.equal(result.DECOHUB_ALLOW_LIVE_AGENTAPI,'false');
});
test('source gate rejects lifecycle scripts, dependencies and executable modules',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'qa-source-gate-'));fs.mkdirSync(path.join(root,'test'));
  fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({scripts:{test:'node --test'}}));
  const source=path.join(root,'test/example.test.cjs');
  for(const code of ["require('node:child_process').execSync('whoami')", "require('node:fs')",'process.binding("fs")','eval("evil")','import("node:fs")','[].constructor.constructor("evil")()','[]["constructor"]']){
    fs.writeFileSync(source,code);assert.throws(()=>validateSource(root,inventory(root)),code);
  }
  fs.writeFileSync(source,"require('node:test')('safe',()=>{});");validateSource(root,inventory(root));
  fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({scripts:{test:'node --test',pretest:'evil'}}));assert.throws(()=>validateSource(root,inventory(root)));
  fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({scripts:{test:'node --test'},dependencies:{evil:'*'}}));assert.throws(()=>validateSource(root,inventory(root)));
});
test('hard links are rejected before copying files',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'qa-hardlink-gate-'));const original=path.join(root,'first');fs.writeFileSync(original,'safe');fs.linkSync(original,path.join(root,'linked'));
  assert.throws(()=>inventory(root),/HARD_LINK/);
});
test('actual child denies outside read, all writes, native child/worker access, external and host-service networking',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'qa-permission-probe-'));
  const outside=path.join(os.tmpdir(),'qa-owned-outside-'+Date.now());fs.writeFileSync(outside,'owned test fixture; no private data');
  const guard=path.join(__dirname,'qa-process-guard.cjs');
  const code=`const a=require('node:assert/strict'),fs=require('node:fs'),cp=require('node:child_process'),net=require('node:net');
    a.throws(()=>fs.readFileSync(${JSON.stringify(outside)}),/restricted/);
    a.throws(()=>fs.writeFileSync(${JSON.stringify(path.join(root,'denied-write'))},'x'),/restricted/);
    a.throws(()=>cp.execFileSync(process.execPath,['--version']),/restricted/);
    a.throws(()=>net.connect(3001,'127.0.0.1'),/NOT_ALLOWED/);
    a.throws(()=>net.connect(443,'example.com'),/NOT_ALLOWED/);
    a.throws(()=>net.createServer().listen(0,'0.0.0.0'),/NOT_ALLOWED/);
    a.throws(()=>new(require('node:worker_threads').Worker)('x',{eval:true}),/restricted/);console.log('ALL_DENIALS_VERIFIED');`;
  const result=cp.spawnSync(process.execPath,['--permission','--allow-fs-read='+root,'--allow-fs-read='+guard,'--require',guard,'--disallow-code-generation-from-strings','--no-addons','-e',code],{cwd:root,env:minimalEnv(root),encoding:'utf8',shell:false,windowsHide:true,timeout:10000});
  assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/ALL_DENIALS_VERIFIED/);assert.equal(fs.existsSync(path.join(root,'denied-write')),false);
});
