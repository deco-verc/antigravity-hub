'use strict';
// Independent contract verification. Never repair code or manufacture a failure.
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname,'..','project');
async function main() {
  const {calculate} = require(path.join(root,'src','calculator.cjs'));
  assert.equal(calculate({operation:'add',a:2,b:3}),5);
  assert.equal(calculate({operation:'subtract',a:-2,b:3}),-5);
  assert.equal(calculate({operation:'multiply',a:-7,b:6}),-42);
  assert.equal(calculate({operation:'divide',a:9,b:2}),4.5);
  for (const input of [null,{}, {operation:'evil',a:1,b:2},{operation:'divide',a:1,b:0},{operation:'add',a:'2',b:1},
    {operation:'add',a:NaN,b:1},{operation:'add',a:Infinity,b:1},{operation:'multiply',a:Number.MAX_VALUE,b:2}]) assert.throws(() => calculate(input));
  for (let a=-20;a<=20;a++) for(let b=-20;b<=20;b++) {
    assert.equal(calculate({operation:'add',a,b}),a+b);
    assert.equal(calculate({operation:'multiply',a,b}),a*b);
  }
  const {createServer} = require(path.join(root,'src','server.cjs'));
  const server = createServer();
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    const health = await fetch(url+'/health',{signal:AbortSignal.timeout(4000)}); assert.equal(health.status,200);
    const post = body => fetch(url+'/calculate',{method:'POST',headers:{'Content-Type':'application/json'},body,signal:AbortSignal.timeout(4000)});
    const good = await post(JSON.stringify({operation:'add',a:4,b:5})); assert.equal(good.status,200);assert.equal((await good.json()).result,9);
    for (const body of ['{',JSON.stringify({operation:'divide',a:1,b:0}),JSON.stringify({operation:'add',a:'2',b:3})]) assert.equal((await post(body)).status,400);
    assert.ok([400,413].includes((await post(' '.repeat(17000))).status));
    console.log(JSON.stringify({result:'PASS',adversarialChecks:true,combinations:1681}));
  } finally { await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(JSON.stringify({result:'FAIL',reason:error.message}));process.exitCode=1; });
