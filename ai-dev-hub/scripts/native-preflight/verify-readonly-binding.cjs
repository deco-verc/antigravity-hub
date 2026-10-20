'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const root='C:\\IA\\DecoHUB-native-sandbox-20261009';
const {selectProfileRuntime,collectRuntimeProcessSnapshot,normalizeRuntimePath}=require(path.join(root,'runtime-fix-build','runtimeProfileSelector.js'));
const db=new DatabaseSync('C:/Users/Deco/.ai-dev-hub/hub.db',{readOnly:true});
const profiles=db.prepare('SELECT id,environment_path,google_account_label FROM account_profiles').all();db.close();
const processes=collectRuntimeProcessSnapshot();
const appExecutable='C:\\Users\\Deco\\AppData\\Local\\Programs\\antigravity\\Antigravity.exe';
const languageServerExecutable=path.join(path.dirname(appExecutable),'resources','bin','language_server.exe');
const defaultPath='C:\\Users\\Deco\\AppData\\Roaming\\Antigravity';
const bindings=profiles.map(profile=>({...profile,binding:selectProfileRuntime({profilePath:profile.environment_path,defaultPath,appExecutable,languageServerExecutable,processes})}));
const expectedFolder=path.join(root,'project');
const resourcePaths=value=>{
  if(typeof value==='string'){
    let text=value;
    if(text.startsWith('file:')){try{text=require('node:url').fileURLToPath(text);}catch{return [];}}
    try{return normalizeRuntimePath(text)===normalizeRuntimePath(expectedFolder)?[text]:[];}catch{return [];}
  }
  if(Array.isArray(value))return value.flatMap(resourcePaths);
  if(value && typeof value==='object')return Object.values(value).flatMap(resourcePaths);
  return [];
};
const directory='C:\\Users\\Deco\\.gemini\\config\\projects';
const nativeProjects=fs.readdirSync(directory).filter(n=>n.endsWith('.json')).map(name=>{
  // Project configuration only, not login/account storage. Emit whitelisted project metadata only.
  const entry=JSON.parse(fs.readFileSync(path.join(directory,name),'utf8'));
  return {id:entry.id,name:entry.name,tempFolderReferences:resourcePaths(entry.projectResources)};
});
const report={at:new Date().toISOString(),method:'Corrected main-source selector, safe process inventory, read-only registered profile metadata',
  bindings,nativeProjects,tempFolderRegistered:nativeProjects.some(p=>p.tempFolderReferences.length),
  sourceProviderProjectId:'outside-of-project',effectiveNativeWorkspace:'NOT_VERIFIED',
  humanEmail:'aldxmir.s2@gmail.com',humanEmailMatchesRegisteredLabel:bindings.find(p=>p.id==='acc-pro-1')?.google_account_label==='aldxmir.s2@gmail.com',
  automaticOAuthVerified:false,accountFilesRead:false,languageServerCommandLineRead:false,credentialsRead:false,agentApiCalls:0,inferenceCalls:0};
fs.writeFileSync(path.join(root,'logs','runtime-binding-readonly.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({binding:bindings.map(x=>({profile:x.id,guiPid:x.binding?.parentPid,lsPid:x.binding?.pid})),tempFolderRegistered:report.tempFolderRegistered,effectiveNativeWorkspace:report.effectiveNativeWorkspace,automaticOAuthVerified:false,inferenceCalls:0}));
