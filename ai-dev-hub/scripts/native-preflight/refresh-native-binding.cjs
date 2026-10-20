'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root='C:\\IA\\DecoHUB-native-sandbox-20261009',config=JSON.parse(fs.readFileSync(path.join(root,'sandbox.json'),'utf8'));
process.env.AI_DEV_HUB_DATA_DIR=config.dataRoot;process.env.DECOHUB_OFFLINE_MODE='true';
const {db}=require(path.join(config.packagedServer,'db.js'));
const {NativeWorkspaceBinding}=require(path.join(config.packagedServer,'nativeWorkspaceBinding.js'));
const {inspectLegacyController}=require('./legacy-controller.cjs');
const processes=JSON.parse(cp.execFileSync('powershell.exe',['-NoProfile','-File',path.join(__dirname,'runtime-evidence.ps1')],{encoding:'utf8',timeout:8000,windowsHide:true}));
const legacy=inspectLegacyController(config.productionDb,processes);
let binding=null,error;
try {binding=NativeWorkspaceBinding.resolve(config.binding.projectId,config.binding.accountProfileId,'C:\\Users\\Deco');}
catch(e){error=e.message;}
db.close();
if(binding){config.nativeProjectId=binding.nativeProjectId;fs.writeFileSync(path.join(root,'sandbox.json'),JSON.stringify(config,null,2));}
const result={legacy,binding,bindingError:error||null,nativeProjectCreatedByAgent:false,productionStatesChanged:false,inferenceCalls:0};
fs.writeFileSync(path.join(root,'logs','remaining-blockers-1.0.4.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({legacySchedulerIsolated:legacy.safe,nativeBinding:Boolean(binding),bindingError:error||null,inferenceCalls:0}));
