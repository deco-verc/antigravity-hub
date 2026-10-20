'use strict';
// Independent controller acceptance test, installed BEFORE the Worker repair.
// This file is not a Worker deliverable and must remain unchanged during repair.
const test=require('node:test'),assert=require('node:assert/strict');
const path=require('node:path'),http=require('node:http'),{spawn}=require('node:child_process');
const serverModule=path.resolve(__dirname,'../src/server.cjs');
async function start(t){
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  const child=spawn(process.execPath,['-e',"const s=require(process.argv[1]).createServer();s.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({port:s.address().port})));",serverModule],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='',exit=null;child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);child.on('exit',code=>exit=code);
  t.after(()=>{if(child.exitCode===null)child.kill();});
  for(let i=0;i<60;i++){
    if(exit!==null)throw Error('API exited before listening: '+stderr);
    try {const {port}=JSON.parse(stdout.trim());if(port)return {child,port,getFailure:()=>({exit,stderr})};}catch{}
    await new Promise(r=>setTimeout(r,50));
  }
  throw Error('API startup timed out');
}
function request(port,target,method='GET',body='',chunked=false){return new Promise((resolve,reject)=>{
  const headers={'Content-Type':'application/json'};if(!chunked)headers['Content-Length']=Buffer.byteLength(body);
  const req=http.request({host:'127.0.0.1',port,path:target,method,headers,timeout:3000},res=>{
    let data='';res.on('data',d=>data+=d);res.on('end',()=>resolve({status:res.statusCode,body:data}));
  });req.on('error',reject);req.on('timeout',()=>req.destroy(Error('HTTP timeout')));
  if(chunked){req.write(body.slice(0,100));req.write(body.slice(100));req.end();}else req.end(body);
});}
test('controller QA: malformed request target returns 400 and API remains available',async t=>{
  const api=await start(t);let response,error;
  try{response=await request(api.port,'http://[');}catch(e){error=e.message;}
  assert.ok(response,'Malformed URL crashed/reset API: '+JSON.stringify({error,...api.getFailure()}));
  assert.equal(response.status,400);
  const health=await request(api.port,'/health');assert.equal(health.status,200);assert.deepEqual(JSON.parse(health.body),{status:'ok'});
});
test('controller QA: all four operations and invalid/non-finite inputs',async t=>{
  const api=await start(t);
  for(const [operation,a,b,result]of [['add',2,3,5],['subtract',-2,3,-5],['multiply',-7,6,-42],['divide',9,2,4.5]]){
    const r=await request(api.port,'/calculate','POST',JSON.stringify({operation,a,b}));assert.equal(r.status,200);assert.deepEqual(JSON.parse(r.body),{result});
  }
  for(const body of ['null','[]','{}','{','{"operation":"divide","a":1,"b":0}','{"operation":"add","a":1e309,"b":1}','{"operation":"add","a":"2","b":3}','{"operation":"multiply","a":1.7976931348623157e308,"b":2}'])assert.equal((await request(api.port,'/calculate','POST',body)).status,400);
});
test('controller QA: exact 16 KiB accepted and oversized bodies rejected with 413',async t=>{
  const api=await start(t),valid=JSON.stringify({operation:'add',a:1,b:2});
  const exact=valid+' '.repeat(16384-Buffer.byteLength(valid));
  assert.equal((await request(api.port,'/calculate','POST',exact)).status,200);
  assert.equal((await request(api.port,'/calculate','POST',exact+' ')).status,413);
  assert.equal((await request(api.port,'/calculate','POST',exact,true)).status,200);
  assert.equal((await request(api.port,'/calculate','POST',exact+' ',true)).status,413);
  assert.equal((await request(api.port,'/calculate','POST',JSON.stringify({operation:'add',a:1,b:2,padding:'é'.repeat(8500)}),true)).status,413);
});
test('controller QA: route/method errors and JSON signed-zero transport',async t=>{
  const api=await start(t);
  for(const [target,method,status]of [['/missing','GET',404],['/calculate','GET',405],['/health','POST',405]])assert.equal((await request(api.port,target,method)).status,status);
  const r=await request(api.port,'/calculate','POST','{"operation":"multiply","a":-0,"b":2}');assert.equal(r.status,200);assert.deepEqual(JSON.parse(r.body),{result:0});
});
