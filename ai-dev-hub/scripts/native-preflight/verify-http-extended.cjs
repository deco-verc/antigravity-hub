'use strict';
// Independent black-box checks. This script never edits the Worker's delivery.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const project=path.resolve(process.argv[2] || 'C:/IA/DecoHUB-native-sandbox-20261009/project');
const output=process.argv[3];
const childEnv={...process.env};delete childEnv.NODE_TEST_CONTEXT;
const child=spawn(process.execPath,['-e',"const s=require(process.argv[1]).createServer();s.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({port:s.address().port})));",path.join(project,'src/server.cjs')],{cwd:project,env:childEnv,windowsHide:true,stdio:['ignore','pipe','pipe']});
let stdout='',stderr='',exit=null;
child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);child.on('exit',code=>exit=code);
const checks=[],wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function main(){
  let port;
  for(let i=0;i<50;i++){try{port=JSON.parse(stdout.trim()).port;break;}catch{}if(exit!==null)throw Error('API_STARTUP_FAILED');await wait(50);}
  assert.ok(port,'API did not initialize');checks.push({name:'Exported server factory starts on loopback',pass:true});
  const request=(body,target='/calculate',method='POST',chunked=false)=>new Promise((resolve,reject)=>{
    const headers={'Content-Type':'application/json'};if(!chunked)headers['Content-Length']=Buffer.byteLength(body);
    const req=http.request({host:'127.0.0.1',port,path:target,method,headers,timeout:3000},res=>{let data='';res.on('data',d=>data+=d);res.on('end',()=>resolve({status:res.statusCode,body:data}));});
    req.on('error',reject);req.on('timeout',()=>req.destroy(Error('HTTP timeout')));
    if(chunked){req.write(body.slice(0,100));req.write(body.slice(100));req.end();}else req.end(body);
  });
  for(const [a,b]of [['-0','2'],['0','-2']]){
    const r=await request(`{"operation":"multiply","a":${a},"b":${b}}`);
    assert.equal(r.status,200);assert.deepEqual(JSON.parse(r.body),{result:0});
    checks.push({name:'Signed zero through JSON numeric transport '+a+' × '+b,pass:true,note:'JSON.stringify serializes -0 as 0; calculator sign verified separately.'});
  }
  const valid=JSON.stringify({operation:'add',a:1,b:2});
  const exact=valid+' '.repeat(16384-Buffer.byteLength(valid));
  assert.equal((await request(exact,'/calculate','POST',true)).status,200);checks.push({name:'Chunked body exactly 16 KiB',pass:true});
  assert.equal((await request(exact+' ','/calculate','POST',true)).status,413);checks.push({name:'Chunked body 16 KiB + 1 rejected with 413',pass:true});
  assert.equal((await request(exact+' ')).status,413);checks.push({name:'Content-Length oversized rejected with 413',pass:true});
  for(const [target,method,status]of [['/missing','GET',404],['/calculate','GET',405],['/health','POST',405]]){
    assert.equal((await request('',target,method)).status,status);checks.push({name:method+' '+target+' → '+status,pass:true});
  }
  let badResponse,badError;
  try{badResponse=await request('','http://[','GET');}catch(e){badError=e.message;}
  await wait(100);
  checks.push({name:'Malformed absolute request target does not crash HTTP server',pass:exit===null&&Boolean(badResponse&&badResponse.status>=400&&badResponse.status<500),response:badResponse||null,error:badError||null,childExit:exit});
  const result={status:checks.every(c=>c.pass)?'PASS':'FAIL',checks,stderr,project,modifiedWorkerFiles:false,realAgentApiCalls:0};
  if(output)fs.writeFileSync(output,JSON.stringify(result,null,2));console.log(JSON.stringify(result));if(result.status!=='PASS')process.exitCode=1;
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{if(child.exitCode===null)child.kill();});
