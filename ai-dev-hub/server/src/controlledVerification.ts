import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync, spawn } from 'node:child_process';
import { resolveVerificationCommand } from './verificationCommand.js';
import {getHubDataDir} from './db.js';

export interface VerificationOperation { executable:string;args:string[];cwd:string;requestedCommand:string;kind:'test'|'typecheck'|'build'|'lint'; }
const blocked=(reason:string):never=>{const error:any=Error(`COMMAND_REVIEW_REQUIRED: ${reason}`);error.code='COMMAND_REVIEW_REQUIRED';throw error;};
function inside(root:string,file:string):string {
  const target=path.resolve(root,file),relative=path.relative(root,target);
  if(!relative||relative.startsWith('..')||path.isAbsolute(relative))return blocked('caminho fora do projeto');
  let segment=root;
  for(const part of relative.split(path.sep)){segment=path.join(segment,part);if(fs.existsSync(segment)&&fs.lstatSync(segment).isSymbolicLink())return blocked('link de filesystem não autorizado');}
  return target;
}
function tokens(command:string):string[]{
  if(/[;&|<>`$\r\n]/.test(command))return blocked('composição de shell não é uma operação automática');
  const parts=command.match(/"[^"\r\n]*"|'[^'\r\n]*'|[^\s"']+/g);
  if(!parts||parts.join(' ').replace(/\s+/g,' ')!==command.trim().replace(/\s+/g,' '))return blocked('argumentos inválidos');
  return parts.map(p=>/^['"]/.test(p)?p.slice(1,-1):p);
}
/** Resolve a small explicit operation vocabulary. Never invoke a shell or inherit auth env. */
export function planVerification(command:string,projectPath:string):VerificationOperation{
  const root=path.resolve(projectPath);
  if(!fs.existsSync(root)||fs.lstatSync(root).isSymbolicLink())return blocked('diretório indisponível');
  let words=tokens(resolveVerificationCommand(command,root)),kind:VerificationOperation['kind']='test';
  if(words[0]==='npm'&&(words.length===2&&words[1]==='test'||words.length===3&&words[1]==='run'&&['test','typecheck','build','lint'].includes(words[2]))){
    const name=words.at(-1)!;kind=name==='test'?'test':name as VerificationOperation['kind'];
    const pkg=JSON.parse(fs.readFileSync(inside(root,'package.json'),'utf8'));
    if(pkg.scripts?.['pre'+name]||pkg.scripts?.['post'+name])return blocked('lifecycle do npm exige revisão');
    if(typeof pkg.scripts?.[name]!=='string')return blocked('script do projeto ausente');
    words=tokens(resolveVerificationCommand(pkg.scripts[name],root));
  }
  let args:string[];
  if(words[0]==='node'){
    args=words.slice(1);
    if(args[0]==='--test'){
      if(args.slice(1).some(a=>a.startsWith('-')))return blocked('flags de testes fora da allowlist');
      for(const file of args.slice(1))inside(root,file);
      args=['--test','--test-isolation=none',...args.slice(1)];
    }else{
      const file=args[0];if(!file||file.startsWith('-')||!/\.[cm]?js$/.test(file))return blocked('somente arquivos Node locais são permitidos');
      inside(root,file);
      if(args.slice(1).some(a=>!/^[-a-zA-Z0-9_.]+$/.test(a)||a.startsWith('--')))return blocked('argumento de script fora da allowlist');
    }
  }else if(words[0]==='tsc'&&words.slice(1).every(a=>a==='--noEmit')){
    kind=words.includes('--noEmit')?'typecheck':'build';args=[inside(root,'node_modules/typescript/bin/tsc'),...words.slice(1)];
  }else return blocked('ferramenta ou script não reconhecido como operação delimitada');
  return {executable:process.execPath,args:['--permission','--allow-fs-read='+root,...(kind==='build'?['--allow-fs-write='+root]:[]),...args],cwd:root,requestedCommand:command,kind};
}
type OperationCallback=(operation:VerificationOperation&{sourceProject:string;recordPath:string;durationMs:number})=>void;
function prepareVerification(command:string,projectPath:string,onStarted?:OperationCallback) {
  const operation=planVerification(command,projectPath),start=Date.now();
  const hubDataDir=getHubDataDir();
  const dataRelative=path.relative(operation.cwd,path.resolve(hubDataDir));
  if(!dataRelative||!dataRelative.startsWith('..')&&!path.isAbsolute(dataRelative))return blocked('o projeto contém o diretório de dados do controlador');
  const auditRoot=path.join(hubDataDir,'verification');fs.mkdirSync(auditRoot,{recursive:true});
  const snapshot=fs.mkdtempSync(path.join(auditRoot,'execution-'));
  const excluded=(name:string)=>['.git','node_modules','.npmrc','.netrc'].includes(name)||/^\.env(?:\.|$)/i.test(name)||/\.(pem|pfx|key)$/i.test(name);
  let bytes=0,count=0;
  const scan=(dir:string,result:Record<string,string>={})=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    if(excluded(entry.name))continue;
    const file=path.join(dir,entry.name);if(entry.isSymbolicLink())blocked('link de filesystem não autorizado');
    const stat=fs.lstatSync(file);
    if(!entry.isDirectory()&&(!stat.isFile()||stat.nlink>1))blocked('arquivo especial ou hardlink não autorizado');
    if(++count>10000||(bytes+=stat.isFile()?stat.size:0)>50*1024*1024)blocked('projeto excede os limites da verificação automática');
    if(entry.isDirectory())scan(file,result);else result[path.relative(operation.cwd,file)]=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  }return result;};
  const before=scan(operation.cwd);
  fs.cpSync(operation.cwd,snapshot,{recursive:true,filter:file=>!excluded(path.basename(file))});
  const guard=path.join(snapshot,'.decohub-verification-guard.cjs');
  fs.writeFileSync(guard,`const net=require('node:net'),ports=new Set(),listen=net.Server.prototype.listen,connect=net.Socket.prototype.connect;
    net.Server.prototype.listen=function(...a){const o=typeof a[0]==='object'?a[0]:{port:a[0],host:typeof a[1]==='string'?a[1]:'127.0.0.1'};
      if(o.port!==0||o.path||o.host&&!['127.0.0.1','localhost'].includes(o.host))throw Error('VERIFICATION_NETWORK_RESOURCE_REQUIRED');
      if(typeof a[0]==='object')a[0]={...o,host:'127.0.0.1'};else if(typeof a[1]!=='string')a.splice(1,0,'127.0.0.1');
      this.once('listening',()=>ports.add(this.address().port));return listen.apply(this,a);};
    net.Socket.prototype.connect=function(...a){const v=Array.isArray(a[0])?a[0]:a,o=typeof v[0]==='object'?v[0]:{port:v[0],host:v[1]};
      if(o.path||!['127.0.0.1','localhost'].includes(o.host)||!ports.has(Number(o.port)))throw Error('VERIFICATION_NETWORK_RESOURCE_REQUIRED');return connect.apply(this,a);};`);
  const args=operation.args.filter(a=>!a.startsWith('--allow-fs-'));
  args.unshift('--require',guard,'--max-old-space-size=256','--disallow-code-generation-from-strings','--no-addons');
  args.unshift('--allow-fs-read='+snapshot,'--allow-fs-write='+snapshot);
  const dependencies=path.join(operation.cwd,'node_modules');
  if(fs.existsSync(dependencies))args.unshift('--allow-fs-read='+dependencies);
  // Compiler entrypoint is a reviewed dependency; its configuration resolves from snapshot.
  const actual={...operation,args,cwd:snapshot,sourceProject:operation.cwd};
  const windows=process.env.SystemRoot||'C:\\Windows';
  const env:NodeJS.ProcessEnv={SystemRoot:windows,WINDIR:windows,TEMP:snapshot,TMP:snapshot,NODE_PATH:dependencies,DECOHUB_OFFLINE_MODE:'true',DECOHUB_ALLOW_LIVE_AGENTAPI:'false'};
  // Packaged backends use Electron's embedded Node, not a new desktop window.
  if(process.versions.electron)env.ELECTRON_RUN_AS_NODE='1';
  const recordPath=path.join(snapshot,'decohub-verification-result.json');
  fs.writeFileSync(recordPath,JSON.stringify({status:'prepared',operation:actual,startedAt:new Date(start).toISOString()},null,2));
  const finish=(result:{pid:number;status:number|null;stdout:string;stderr:string;error?:any}):string=>{
  if(result.pid>0)onStarted?.({...actual,recordPath:path.join(snapshot,'decohub-verification-result.json'),durationMs:Date.now()-start});
  bytes=0;count=0;
  const unchanged=JSON.stringify(before)===JSON.stringify(scan(operation.cwd));
  fs.writeFileSync(path.join(snapshot,'decohub-verification-result.json'),JSON.stringify({status:'finished',pid:result.pid,operation:actual,durationMs:Date.now()-start,exitCode:result.status,errorCode:result.error?.code,stdout:result.stdout,stderr:result.stderr,originalFilesUnchanged:unchanged,fileHashes:before,isolation:'Snapshot and Node process permissions; not an OS security sandbox'},null,2));
  if(!unchanged)return blocked('arquivos originais mudaram durante a verificação');
  if(result.error||result.status!==0){
    const error:any=result.error||Error('Verificação retornou falha');error.status=result.status||1;error.stdout=result.stdout||'';error.stderr=result.stderr||'';
    if(/ERR_ACCESS_DENIED|VERIFICATION_NETWORK_RESOURCE_REQUIRED/.test(error.stdout+error.stderr)){error.code='COMMAND_REVIEW_REQUIRED';error.message='COMMAND_REVIEW_REQUIRED: o teste requer recursos adicionais; não houve liberação automática';}
    error.durationMs=Date.now()-start;error.operation=actual;throw error;
  }
  return result.stdout;
  };
  return {actual,env,recordPath,finish};
}
/** Synchronous baseline compatibility; normal evaluations use the non-blocking executor. */
export function executeVerification(command:string,projectPath:string,timeout=45000,onStarted?:OperationCallback):string {
  const job=prepareVerification(command,projectPath,onStarted);
  const result=spawnSync(job.actual.executable,job.actual.args,{cwd:job.actual.cwd,env:job.env,encoding:'utf8',timeout,maxBuffer:2*1024*1024,shell:false,windowsHide:true});
  return job.finish({...result,pid:result.pid||0,stdout:result.stdout||'',stderr:result.stderr||''});
}
export async function executeVerificationAsync(command:string,projectPath:string,timeout=45000,onStarted?:OperationCallback):Promise<string> {
  const job=prepareVerification(command,projectPath,onStarted);
  return new Promise((resolve,reject)=>{
    const child=spawn(job.actual.executable,job.actual.args,{cwd:job.actual.cwd,env:job.env,shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});
    fs.writeFileSync(job.recordPath,JSON.stringify({status:'running',pid:child.pid,operation:job.actual,startedAt:new Date().toISOString()},null,2));
    let stdout='',stderr='',error:any,total=0;
    const timer=setTimeout(()=>{error=Object.assign(Error('Verificação excedeu o limite de tempo'),{code:'ETIMEDOUT'});child.kill();},Math.min(timeout,45000));
    const capture=(kind:'stdout'|'stderr',data:Buffer)=>{
      total+=data.length;
      if(total>2*1024*1024){error=Object.assign(Error('Saída da verificação excedeu 2 MiB'),{code:'VERIFICATION_OUTPUT_LIMIT'});child.kill();return;}
      if(kind==='stdout')stdout+=data.toString();else stderr+=data.toString();
    };
    child.stdout.on('data',data=>capture('stdout',data));child.stderr.on('data',data=>capture('stderr',data));
    child.on('error',e=>{error=e;});
    child.on('close',status=>{
      clearTimeout(timer);
      try{resolve(job.finish({pid:child.pid||0,status,stdout,stderr,error}));}catch(e){reject(e);}
    });
  });
}
