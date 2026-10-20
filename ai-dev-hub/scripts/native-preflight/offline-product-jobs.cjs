'use strict';
// Separate reviewed product operations; never authorize these in the QA agent terminal.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const repo=path.resolve(__dirname,'../..'),qa='C:/IA/DecoHUB-native-sandbox-20261009';
const npm=path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
const jobs={test:['--prefix','server','run','test'],typecheck:['run','typecheck'],build:['run','build']};
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
function run(job){
  if(!Object.hasOwn(jobs,job))throw Error('OFFLINE_PRODUCT_JOB_NOT_ALLOWED');
  const rootPackage=JSON.parse(fs.readFileSync(path.join(repo,'package.json'))),serverPackage=JSON.parse(fs.readFileSync(path.join(repo,'server/package.json'))),clientPackage=JSON.parse(fs.readFileSync(path.join(repo,'client/package.json')));
  if(rootPackage.version!=='1.0.5'||rootPackage.scripts.build!=='npm --prefix server run build && npm --prefix client run build'||rootPackage.scripts.typecheck!=='npm --prefix server run typecheck && npm --prefix client run typecheck'||serverPackage.scripts.build!=='tsc'||serverPackage.scripts.typecheck!=='tsc --noEmit'||clientPackage.scripts.typecheck!=='tsc --noEmit'||clientPackage.scripts.build!=='tsc && vite build'||!/^node --import tsx --import \.\/test\/testSetup\.ts --test --test-concurrency=1(?: test\/[A-Za-z0-9]+\.test\.ts)+$/.test(serverPackage.scripts.test))throw Error('OFFLINE_PRODUCT_SCRIPT_CHANGED');
  for(const pkg of [rootPackage,serverPackage,clientPackage])for(const key of Object.keys(pkg.scripts))if(/^(pre|post)(test|typecheck|build)$/.test(key))throw Error('OFFLINE_PRODUCT_LIFECYCLE_SCRIPT_DENIED');
  const output=path.join(qa,'logs/safe-executor/product');fs.mkdirSync(output,{recursive:true});
  const temporary=fs.mkdtempSync(path.join(output,job+'-'));
  const windows=process.env.SystemRoot||'C:\\Windows';
  const env={SystemRoot:windows,WINDIR:windows,PATH:[path.dirname(process.execPath),path.join(windows,'System32'),path.join(windows,'System32/WindowsPowerShell/v1.0'),'C:/Program Files/Git/cmd'].join(';'),TEMP:temporary,TMP:temporary,
    DECOHUB_OFFLINE_MODE:'true',DECOHUB_ALLOW_LIVE_AGENTAPI:'false',AI_DEV_HUB_DATA_DIR:path.join(temporary,'data'),NODE_OPTIONS:'--require '+JSON.stringify(path.join(__dirname,'offline-product-process-guard.cjs')),
    GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'NUL',GIT_CEILING_DIRECTORIES:path.resolve(qa),GIT_TERMINAL_PROMPT:'0',npm_config_cache:path.join(temporary,'npm-cache'),npm_config_audit:'false',npm_config_fund:'false',npm_config_offline:'true',npm_config_update_notifier:'false'};
  const result=cp.spawnSync(process.execPath,[npm,...jobs[job]],{cwd:repo,env,encoding:'utf8',timeout:180000,maxBuffer:8*1024*1024,shell:false,windowsHide:true});
  const report={at:new Date().toISOString(),job,cwd:repo,executable:process.execPath,args:[npm,...jobs[job]],exitCode:result.status,error:result.error?.message,stdout:result.stdout,stderr:result.stderr,physicalAgentCalls:0,productionDbUsed:false,scope:'Reviewed product code, fixed scripts, isolated test data; separate from restricted QA execution',packageHashes:Object.fromEntries(['package.json','server/package.json','client/package.json'].map(f=>[f,hash(path.join(repo,f))]))};
  const file=path.join(temporary,'result.json');fs.writeFileSync(file,JSON.stringify(report,null,2));return {...report,resultFile:file};
}
module.exports={run};
if(require.main===module){if(process.argv.length!==3){console.error('OFFLINE_PRODUCT_ONE_JOB_REQUIRED');process.exitCode=2;}else try{const r=run(process.argv[2]);console.log(JSON.stringify({job:r.job,exitCode:r.exitCode,resultFile:r.resultFile}));process.exitCode=r.exitCode===0?0:1;}catch(e){console.error(e.message);process.exitCode=2;}}
