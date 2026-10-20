'use strict';
const fs=require('node:fs');
const path=require('node:path');
const cp=require('node:child_process');
const {DatabaseSync}=require('node:sqlite');
const {Ledger,digest}=require('./ledger.cjs');
const {selectRuntime}=require('./runtime.cjs');
const sandbox='C:\\IA\\DecoHUB-native-sandbox-20261009';
const config=JSON.parse(fs.readFileSync(path.join(sandbox,'sandbox.json'),'utf8'));
const processes=JSON.parse(cp.execFileSync('powershell.exe',['-NoProfile','-File',path.join(__dirname,'runtime-evidence.ps1')],{encoding:'utf8',timeout:15000,windowsHide:true}));
const production=new DatabaseSync(config.productionDb,{readOnly:true});
const profiles=production.prepare('SELECT id,display_name,profile_name,environment_path,auth_status,last_tested FROM account_profiles').all();
const profileEvidence=profiles.map(profile=>{
  const dataDir=profile.id==='acc-pro-1'?profile.environment_path:path.join(profile.environment_path,'AppData','Roaming','Antigravity');
  const storage=path.join(dataDir,'app_storage.json');
  const meta=fs.existsSync(storage)?fs.statSync(storage,{bigint:true}):null;
  return {...profile,dataDir,realDataDir:fs.realpathSync.native(dataDir),directoryAttributesOnly:true,
    storageFileMetadataOnly:meta?{device:String(meta.dev),fileId:String(meta.ino),size:String(meta.size),mtime:String(meta.mtimeMs)}:null,
    runtime:selectRuntime(profile.environment_path,config.defaultAccountDataPath,processes)};
});
const concurrent=production.prepare("SELECT status,count(*) count FROM autonomous_runs WHERE status IN ('running','planning','building','testing','reviewing','waiting_for_worker') GROUP BY status").all();
const workers=production.prepare("SELECT id,status,pid,account_profile_id,current_run_id FROM workers WHERE status='WORKING' OR current_run_id IS NOT NULL").all();
const crossProfileReuse=production.prepare('SELECT COUNT(*) count FROM (SELECT conversation_id FROM account_project_sessions GROUP BY conversation_id HAVING COUNT(DISTINCT account_profile_id)>1)').get().count;
production.close();
const ledger=new Ledger(config.controlRoot,config.binding);
const state=ledger.snapshot();ledger.close();
const {db,DB_PATH}=(()=>{process.env.AI_DEV_HUB_DATA_DIR=config.dataRoot;process.env.DECOHUB_OFFLINE_MODE='true';return require(path.join(config.packagedServer,'db.js'));})();
const sandboxCounts={projects:db.prepare('SELECT count(*) n FROM projects').get().n,sessions:db.prepare('SELECT count(*) n FROM agent_sessions').get().n,runs:db.prepare('SELECT count(*) n FROM autonomous_runs').get().n};db.close();
const result={at:new Date().toISOString(),profiles:profileEvidence,processes,productionMetadataReadOnly:true,
  historicalLastLoginEquality:'Reported previously; not reread and not authentication evidence',concurrent,workingWorkers:workers,crossProfileReuse,
  sameRealDataDirectory:new Set(profileEvidence.map(p=>p.realDataDir.toLowerCase())).size!==profileEvidence.length,
  sameStorageFile:profileEvidence.length===2 && profileEvidence.every(p=>p.storageFileMetadataOnly) &&
    profileEvidence[0].storageFileMetadataOnly.fileId===profileEvidence[1].storageFileMetadataOnly.fileId && profileEvidence[0].storageFileMetadataOnly.device===profileEvidence[1].storageFileMetadataOnly.device,
  officialCliSettingsFileExists:fs.existsSync('C:\\Users\\Deco\\.gemini\\antigravity-cli\\settings.json'),
  officialCliInstalled:Boolean(cp.spawnSync('where.exe',['agy'],{encoding:'utf8',windowsHide:true}).status===0),
  sandbox:{root:sandbox,dbPath:DB_PATH,...sandboxCounts,ledger:state,integrity:config.packagedGatewayHash===digest(fs.readFileSync(path.join(config.packagedServer,'agentApiGateway.js')))},
  installerHash:digest(fs.readFileSync(path.resolve(__dirname,'../../dist-desktop/DecoHUB Setup 1.0.3.exe'))),
  credentialsRead:false,credentialsCopied:false,credentialsChanged:false,realInferenceCalls:0,realConversationsCreated:0};
fs.writeFileSync(path.join(sandbox,'logs','preflight-evidence.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({evidence:path.join(sandbox,'logs','preflight-evidence.json'),profiles:result.profiles.map(p=>({id:p.id,runtimePid:p.runtime?.pid || null,dataDir:p.dataDir})),sameRealDataDirectory:result.sameRealDataDirectory,sameStorageFile:result.sameStorageFile,concurrent,workingWorkers:workers.length,sandboxCounts,realInferenceCalls:0}));
