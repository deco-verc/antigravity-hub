'use strict';
// Defense in depth for reviewed QA code. Node permissions are not an OS sandbox.
const net=require('node:net'),cp=require('node:child_process'),{EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');
const ports=new Set(),children=new Map();let sequence=0;
const deny=()=>{throw Error('QA_NETWORK_OR_PROCESS_NOT_ALLOWED');};
const listening=net.Server.prototype.listen,connecting=net.Socket.prototype.connect;
net.Server.prototype.listen=function(...args){
  const opts=typeof args[0]==='object'?args[0]:{port:args[0],host:typeof args[1]==='string'?args[1]:'127.0.0.1'};
  if(opts.port!==0||opts.path||!['127.0.0.1',undefined].includes(opts.host))deny();
  if(typeof args[0]==='object')args[0]={...opts,host:'127.0.0.1'};
  else if(typeof args[1]!=='string')args.splice(1,0,'127.0.0.1');
  this.once('listening',()=>ports.add(this.address().port));
  this.once('close',()=>{ /* Retain allocated test ports until this bounded process exits. */ });
  return listening.apply(this,args);
};
net.Socket.prototype.connect=function(...args){
  const values=Array.isArray(args[0])?args[0]:args;
  const opts=typeof values[0]==='object'?values[0]:{port:values[0],host:values[1]};
  if(opts.path||opts.host!=='127.0.0.1'||!ports.has(Number(opts.port)))deny();
  return connecting.apply(this,args);
};
// The protected acceptance test can request only its exact, fixed server child.
// The child itself has NO child-process permission. The owning executor validates IPC.
cp.spawn=function(file,args,options){
  if(!process.send)deny();
  const id=++sequence,child=new EventEmitter();
  child.stdout=new PassThrough();child.stderr=new PassThrough();child.exitCode=null;
  child.kill=()=>{process.send({type:'qa-child-stop',id});return true;};
  children.set(id,child);process.send({type:'qa-child-start',id,file,args,stdio:options?.stdio});return child;
};
process.on('message',message=>{
  const child=children.get(message?.id);if(!child)return;
  if(message.type==='qa-child-stdout'){
    try{const {port}=JSON.parse(message.text.trim());if(Number.isInteger(port)&&port>0&&port<65536)ports.add(port);}catch{}
    child.stdout.write(message.text);
  }
  if(message.type==='qa-child-stderr')child.stderr.write(message.text);
  if(message.type==='qa-child-exit'){child.exitCode=message.code;child.emit('exit',message.code);children.delete(message.id);}
  if(message.type==='qa-child-error')child.emit('error',Error(message.error));
});
require('node:module').syncBuiltinESMExports();
