'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const ROOT='C:/IA/DecoHUB-native-sandbox-20261009',PROJECT=path.join(ROOT,'project'),OUTPUT=path.join(ROOT,'logs/safe-executor');
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const canonical=p=>path.resolve(p).toLowerCase();
const denied=reason=>{throw Error(reason);};
const fixedServerCode="const s=require(process.argv[1]).createServer();s.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({port:s.address().port})));";
function inventory(root){
  const files={};
  const walk=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    const full=path.join(dir,entry.name),stat=fs.lstatSync(full);
    if(stat.isSymbolicLink())denied('QA_REPARSE_POINT_DENIED');
    if(entry.isDirectory())walk(full);
    else if(entry.isFile()){if(stat.nlink!==1)denied('QA_HARD_LINK_DENIED');files[path.relative(root,full).replace(/\\/g,'/')]=digest(fs.readFileSync(full));}
    else denied('QA_SPECIAL_FILE_DENIED');
  }};walk(root);return files;
}
function validateSource(root,manifest){
  const packageJson=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  if(packageJson.scripts?.test!=='node --test'||Object.keys(packageJson.scripts).some(k=>k!=='test')||packageJson.dependencies||packageJson.devDependencies)denied('QA_NPM_SCRIPT_OR_DEPENDENCY_NOT_ALLOWED');
  const ts=require('../../server/node_modules/typescript');
  const modules=new Set(['node:http','http','node:test','node:assert/strict','node:path','../src/server.cjs','../src/calculator.cjs','./calculator.cjs']);
  for(const file of Object.keys(manifest).filter(f=>/\.[cm]?js$/.test(f))){
    if(!/^(src|test)\/[A-Za-z0-9_.\/-]+\.cjs$/.test(file))denied('QA_UNREVIEWED_EXECUTABLE_FILE');
    // Controller test has a fixed, hashed implementation and an exact delegated spawn.
    if(file==='test/controller-http-acceptance.test.cjs'){
      const expected=fs.readFileSync(path.join(__dirname,'http-independent-acceptance.template.cjs'));
      if(manifest[file]!==digest(expected))denied('QA_CONTROLLER_TEST_CHANGED');continue;
    }
    const source=ts.createSourceFile(file,fs.readFileSync(path.join(root,file),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
    const visit=node=>{
      if(ts.isIdentifier(node)&&['process','global','globalThis','eval','Function','WebAssembly','fetch','requireFromString','importScripts'].includes(node.text))denied('QA_UNREVIEWED_RUNTIME_ACCESS:'+file);
      if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==='require'){
        if(node.arguments.length!==1||!ts.isStringLiteral(node.arguments[0])||!modules.has(node.arguments[0].text))denied('QA_MODULE_NOT_ALLOWED:'+file);
      }
      if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword)denied('QA_DYNAMIC_IMPORT_DENIED');
      if(ts.isPropertyAccessExpression(node)&&['constructor','__proto__','binding','_linkedBinding'].includes(node.name.text))denied('QA_DYNAMIC_RUNTIME_ACCESS_DENIED');
      if(ts.isElementAccessExpression(node)){
        // Only numeric/static indexing; computed property lookup requires human review.
        const a=node.argumentExpression;
        const arrayLast=ts.isBinaryExpression(a)&&a.operatorToken.kind===ts.SyntaxKind.MinusToken&&ts.isNumericLiteral(a.right)&&ts.isPropertyAccessExpression(a.left)&&a.left.name.text==='length';
        if(ts.isStringLiteral(a)&&['constructor','__proto__','binding','_linkedBinding'].includes(a.text))denied('QA_DYNAMIC_RUNTIME_ACCESS_DENIED');
        if(!(ts.isNumericLiteral(a)||ts.isStringLiteral(a)||arrayLast||ts.isIdentifier(a)&&['i','j','operation'].includes(a.text)))denied('QA_COMPUTED_ACCESS_REQUIRES_REVIEW:'+file);
      }
      ts.forEachChild(node,visit);
    };visit(source);
  }
}
function plan(command,cwd,manifest){
  if(canonical(cwd)!==canonical(PROJECT))denied('QA_WORKING_DIRECTORY_MISMATCH');
  if(command==='npm test'||command==='node --test')return Object.keys(manifest).filter(f=>/^test\/[A-Za-z0-9_.\/-]+\.test\.cjs$/.test(f)).sort();
  const match=/^node --test (test\/[A-Za-z0-9_.-]+\.test\.cjs)$/.exec(command);
  if(!match||!manifest[match[1]])denied('QA_COMMAND_NOT_ALLOWED');return [match[1]];
}
function minimalEnv(snapshot){
  return {SystemRoot:process.env.SystemRoot||'C:\\Windows',WINDIR:process.env.WINDIR||'C:\\Windows',TEMP:snapshot,TMP:snapshot,DECOHUB_OFFLINE_MODE:'true',DECOHUB_ALLOW_LIVE_AGENTAPI:'false'};
}
async function runUnlocked(command,{cwd=PROJECT,timeoutMs=30000,maxOutput=1024*1024}={}){
  const before=inventory(PROJECT),files=plan(command,cwd,before);if(!files.length)denied('QA_NO_TEST_FILES');validateSource(PROJECT,before);
  fs.mkdirSync(OUTPUT,{recursive:true});const snapshot=fs.mkdtempSync(path.join(OUTPUT,'execution-')),project=path.join(snapshot,'project');
  fs.mkdirSync(project);for(const file of Object.keys(before)){
    const target=path.join(project,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(PROJECT,file),target,fs.constants.COPYFILE_EXCL);
  }
  if(JSON.stringify(inventory(project))!==JSON.stringify(before))denied('QA_SNAPSHOT_CHANGED');
  const guard=path.join(snapshot,'process-guard.cjs');fs.copyFileSync(path.join(__dirname,'qa-process-guard.cjs'),guard);
  const flags=['--permission','--allow-fs-read='+project,'--allow-fs-read='+guard,'--require',guard,'--disallow-code-generation-from-strings','--no-addons'];
  const env=minimalEnv(snapshot),children=new Map();let stdout='',stderr='',timedOut=false,overflow=false;
  const child=cp.spawn(process.execPath,[...flags,'--test','--test-isolation=none','--test-force-exit',...files],{cwd:project,env,shell:false,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
  const append=(stream,text)=>{if(stdout.length+stderr.length+text.length>maxOutput){overflow=true;child.kill();return;}if(stream==='stdout')stdout+=text;else stderr+=text;};
  child.stdout.on('data',d=>append('stdout',d.toString()));child.stderr.on('data',d=>append('stderr',d.toString()));
  child.on('message',message=>{
    if(message?.type==='qa-child-stop'){const owned=children.get(message.id);if(owned)owned.kill();return;}
    if(message?.type!=='qa-child-start')return;
    const valid=Number.isInteger(message.id)&&message.id>0&&!children.has(message.id)&&canonical(message.file)===canonical(process.execPath)&&
      Array.isArray(message.args)&&message.args.length===3&&message.args[0]==='-e'&&message.args[1]===fixedServerCode&&
      canonical(message.args[2])===canonical(path.join(project,'src/server.cjs'))&&JSON.stringify(message.stdio)===JSON.stringify(['ignore','pipe','pipe'])&&children.size<4;
    if(!valid){append('stderr','QA_DELEGATED_PROCESS_DENIED');child.kill();return;}
    const owned=cp.spawn(process.execPath,[...flags,...message.args],{cwd:project,env,shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});children.set(message.id,owned);
    let ownedOutput=0;
    const send=m=>{if(child.connected)child.send({...m,id:message.id});};
    const relay=(type,d)=>{ownedOutput+=d.length;if(ownedOutput>maxOutput){overflow=true;owned.kill();child.kill();return;}send({type,text:d.toString()});};
    owned.stdout.on('data',d=>relay('qa-child-stdout',d));owned.stderr.on('data',d=>relay('qa-child-stderr',d));
    owned.on('exit',code=>{children.delete(message.id);send({type:'qa-child-exit',code});});owned.on('error',e=>send({type:'qa-child-error',error:e.message}));
  });
  const timer=setTimeout(()=>{timedOut=true;child.kill();},timeoutMs);
  const result=await new Promise(resolve=>{child.once('exit',(code,signal)=>resolve({exitCode:code,signal}));child.once('error',e=>resolve({exitCode:null,error:e.message}));});
  clearTimeout(timer);
  await Promise.all([...children.values()].filter(owned=>owned.pid&&owned.exitCode===null).map(owned=>new Promise((resolve,reject)=>{
    const deadline=setTimeout(()=>reject(Error('QA_OWNED_PROCESS_SHUTDOWN_AMBIGUOUS')),5000);
    owned.once('exit',()=>{clearTimeout(deadline);resolve();});owned.kill();
  })));
  const after=inventory(PROJECT),snapshotAfter=inventory(project);
  const record={at:new Date().toISOString(),requestedCommand:command,actualExecutable:process.execPath,actualArguments:[...flags,'--test','--test-isolation=none','--test-force-exit',...files],cwd:project,sourceProject:PROJECT,
    ...result,timedOut,overflow,stdout,stderr,originalFilesUnchanged:JSON.stringify(before)===JSON.stringify(after),snapshotUnchanged:JSON.stringify(before)===JSON.stringify(snapshotAfter),filesBefore:before,
    isolation:{shell:false,environment:'minimal-no-auth',fileRead:'snapshot-only',fileWrite:false,arbitraryChildProcess:false,network:'same-execution-loopback-ports-only',osSandbox:false,scope:'Reviewed QA code; Node permission model and network checks are defense in depth, not a hostile-code security boundary'},physicalAgentCalls:0};
  fs.writeFileSync(path.join(snapshot,'result.json'),JSON.stringify(record,null,2));
  if(!record.originalFilesUnchanged||!record.snapshotUnchanged)denied('QA_FILES_CHANGED_DURING_TEST');
  return {...record,resultFile:path.join(snapshot,'result.json')};
}
async function run(command,options){
  fs.mkdirSync(OUTPUT,{recursive:true});const lock=path.join(OUTPUT,'execution.lock'),identity=crypto.randomUUID();
  let fd;try{fd=fs.openSync(lock,'wx');}catch{denied('QA_EXECUTOR_BUSY_OR_UNRECONCILED');}
  fs.writeFileSync(fd,JSON.stringify({pid:process.pid,identity,startedAt:new Date().toISOString()}));fs.closeSync(fd);
  let ambiguous=false;
  try{return await runUnlocked(command,options);}catch(e){ambiguous=/SHUTDOWN_AMBIGUOUS/.test(e.message);throw e;}
  finally{if(!ambiguous&&JSON.parse(fs.readFileSync(lock,'utf8')).identity===identity)fs.unlinkSync(lock);}
}
function runSync(command){
  let output;
  try{output=cp.execFileSync(process.execPath,[__filename,command],{cwd:path.resolve(__dirname,'../..'),env:minimalEnv(OUTPUT),encoding:'utf8',timeout:45000,maxBuffer:1024*1024,shell:false,windowsHide:true});}
  catch(e){if(!e.stdout)throw e;output=String(e.stdout);}
  const summary=JSON.parse(output.trim());
  if(!summary.resultFile||!canonical(summary.resultFile).startsWith(canonical(OUTPUT)+path.sep))denied('QA_RESULT_LOCATION_INVALID');
  const result=JSON.parse(fs.readFileSync(summary.resultFile,'utf8'));
  if(result.requestedCommand!==command||!result.originalFilesUnchanged||!result.snapshotUnchanged||result.timedOut||result.overflow)denied('QA_RESULT_NOT_RECONCILED');
  return {...result,resultFile:summary.resultFile};
}
module.exports={run,runSync,plan,inventory,validateSource,minimalEnv,PROJECT};
if(require.main===module){
  if(process.argv.length!==3){console.error('QA_ONE_EXACT_COMMAND_ARGUMENT_REQUIRED');process.exitCode=2;}
  else run(process.argv[2]).then(r=>{console.log(JSON.stringify({requestedCommand:r.requestedCommand,exitCode:r.exitCode,resultFile:r.resultFile,originalFilesUnchanged:r.originalFilesUnchanged,physicalAgentCalls:0}));process.exitCode=r.exitCode===0&&!r.timedOut&&!r.overflow?0:1;}).catch(e=>{console.error(e.message);process.exitCode=2;});
}
