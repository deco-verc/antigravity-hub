import test from 'node:test';
import assert from 'node:assert/strict';
import { selectProfileRuntime, collectRuntimeProcessSnapshot, normalizeRuntimePath, RuntimeProcessSnapshot } from '../src/runtimeProfileSelector.js';
import childProcess from 'node:child_process';
import { AccountProfileManager } from '../src/accountProfileManager.js';
import { AgentApiGateway } from '../src/agentApiGateway.js';
import { AntigravityDiscovery } from '../src/antigravityDiscovery.js';

const defaultPath = 'C:\\Users\\Deco\\AppData\\Roaming\\Antigravity';
const profilePath = 'C:\\Profiles\\Account 2';
const dataPath = profilePath + '\\AppData\\Roaming\\Antigravity';
const appExecutable = 'C:\\Programs\\Antigravity\\Antigravity.exe';
const lsExecutable = 'C:\\Programs\\Antigravity\\resources\\bin\\language_server.exe';
const main = (dir: string|null = null): RuntimeProcessSnapshot => ({pid:10,parentPid:1,name:'Antigravity.exe',executable:appExecutable,started:'2026-10-09T10:00:00Z',userDataDir:dir,userDataFlagCount:dir?1:0});
const ls = (): RuntimeProcessSnapshot => ({pid:20,parentPid:10,name:'language_server.exe',executable:lsExecutable,started:'2026-10-09T10:00:01Z'});
const select = (processes: RuntimeProcessSnapshot[], profile=profilePath) => selectProfileRuntime({profilePath:profile,defaultPath,appExecutable,languageServerExecutable:lsExecutable,processes});

test('isolated runtime must match full normalized directory, never a substring',()=>{
  assert.equal(select([main(dataPath+'-copy'),ls()]),null);
  assert.equal(select([main(dataPath),ls()])?.pid,20);
  assert.equal(select([main(dataPath.toUpperCase().replaceAll('\\','/')+'/'),ls()])?.pid,20);
  assert.equal(select([main('C:\\Profiles\\Account 20\\AppData\\Roaming\\Antigravity'),ls()]),null);
});
test('default profile supports implicit or explicit exact data directory; isolated profile never falls back',()=>{
  assert.equal(select([main(),ls()],defaultPath)?.pid,20);
  assert.equal(select([main(defaultPath),ls()],defaultPath)?.pid,20);
  assert.equal(select([main(),ls()]),null);
  assert.equal(select([main(dataPath),ls()],defaultPath),null);
});
test('ambiguous main processes or language servers are rejected instead of taking first match',()=>{
  const otherMain={...main(dataPath),pid:11};
  assert.throws(()=>select([main(dataPath),otherMain,ls()]),{code:'RUNTIME_MULTIPLE_GUI_OWNERS'});
  assert.throws(()=>select([main(dataPath),ls(),{...ls(),pid:21}]),{code:'RUNTIME_MULTIPLE_LANGUAGE_SERVERS'});
  assert.throws(()=>select([main(dataPath),ls(),ls()]),{code:'RUNTIME_PROCESS_INVENTORY_AMBIGUOUS'});
});
test('orphan, renderer-parented and wrong-executable processes cannot own a runtime',()=>{
  assert.equal(select([ls()]),null);
  assert.equal(select([main(dataPath),{...main(dataPath),pid:11,parentPid:10},{...ls(),parentPid:11}]),null);
  assert.equal(select([{...main(dataPath),executable:'C:\\Elsewhere\\Antigravity.exe'},ls()]),null);
  assert.throws(()=>select([main(dataPath),{...ls(),executable:'C:\\Elsewhere\\language_server.exe'}]),{code:'RUNTIME_LANGUAGE_SERVER_EXECUTABLE_MISMATCH'});
});
test('invalid or repeated user-data-dir flags do not fall back to default account',()=>{
  assert.throws(()=>select([{...main(null),userDataFlagCount:1},ls()],defaultPath),{code:'RUNTIME_USER_DATA_ARGUMENT_AMBIGUOUS'});
  assert.throws(()=>select([{...main(dataPath),userDataFlagCount:2},ls()]),{code:'RUNTIME_USER_DATA_ARGUMENT_AMBIGUOUS'});
});
test('restart discovery returns current process identity, never a cached prior PID',()=>{
  const before=select([main(dataPath),ls()]);
  const after=select([{...main(dataPath),pid:30,started:'2026-10-09T11:00:00Z'},{...ls(),pid:40,parentPid:30,started:'2026-10-09T11:00:01Z'}]);
  assert.equal(before?.pid,20);assert.equal(after?.pid,40);assert.notEqual(before?.started,after?.started);
});
test('PID reused across inconsistent start times is not a valid parent association',()=>{
  assert.throws(()=>select([{...main(dataPath),started:'2026-10-09T11:00:00Z'},ls()]),{code:'RUNTIME_PROCESS_START_INVALID'});
  assert.throws(()=>select([main(dataPath),{...ls(),started:''}]),{code:'RUNTIME_PROCESS_START_INVALID'});
});
test('relative paths cannot resolve to whichever working directory the process uses',()=>{
  assert.throws(()=>normalizeRuntimePath('Account 2'),{code:'RUNTIME_PATH_NOT_ABSOLUTE'});
  assert.equal(normalizeRuntimePath('C:\\Profiles\\Account 2\\foo\\..\\'),normalizeRuntimePath('c:/profiles/account 2'));
});

test('main manager collects only safe metadata before unique binding; changed runtime prevents connection reuse',t=>{
  const originalExec=childProcess.execFileSync;
  const originalOffline=AgentApiGateway.isOfflineMode;
  const originalApp=AntigravityDiscovery.getAntigravityAppExe;
  const originalDefault=(AccountProfileManager as any).defaultRoamingPath;
  t.after(()=>{childProcess.execFileSync=originalExec;AgentApiGateway.isOfflineMode=originalOffline;AntigravityDiscovery.getAntigravityAppExe=originalApp;(AccountProfileManager as any).defaultRoamingPath=originalDefault;});
  AgentApiGateway.isOfflineMode=()=>false;
  AntigravityDiscovery.getAntigravityAppExe=()=>appExecutable;
  (AccountProfileManager as any).defaultRoamingPath=defaultPath;
  let snapshots=0,connections=0,changed=false;
  (childProcess as any).execFileSync=(file:string,args:string[])=>{
    assert.equal(file,'powershell.exe');const script=args.at(-1)!;
    if(script.includes('csrf_token')) {
      connections++;
      assert.ok(script.indexOf('RUNTIME_CHANGED')<script.indexOf('csrf_token'));
      return JSON.stringify({pid:20,parentPid:10,started:ls().started,parentStarted:main().started,port:12345,csrfToken:'OFFLINE-FIXTURE-NOT-A-CREDENTIAL'});
    }
    assert.ok(!script.includes('$p.CommandLine'));assert.ok(!script.includes('agentapi'));
    snapshots++;
    const processes=[main(dataPath),ls()];
    if(changed && snapshots>1)processes[1]={...ls(),pid:21,started:'2026-10-09T10:01:00Z'};
    return JSON.stringify(processes);
  };
  assert.equal(AccountProfileManager.getRuntimeBindingForProfile(profilePath)?.pid,20);
  assert.equal(connections,0);
  snapshots=0;
  assert.equal(AccountProfileManager.getRunningInstanceForProfile(profilePath)?.address,'127.0.0.1:12345');
  assert.equal(connections,1);
  snapshots=0;changed=true;
  assert.equal(AccountProfileManager.getRunningInstanceForProfile(profilePath),null);
});

test('main manager rejects multiple runtime owners before obtaining any connection material',t=>{
  const originalExec=childProcess.execFileSync,originalOffline=AgentApiGateway.isOfflineMode,originalApp=AntigravityDiscovery.getAntigravityAppExe;
  const originalDefault=(AccountProfileManager as any).defaultRoamingPath;
  t.after(()=>{childProcess.execFileSync=originalExec;AgentApiGateway.isOfflineMode=originalOffline;AntigravityDiscovery.getAntigravityAppExe=originalApp;(AccountProfileManager as any).defaultRoamingPath=originalDefault;});
  AgentApiGateway.isOfflineMode=()=>false;AntigravityDiscovery.getAntigravityAppExe=()=>appExecutable;(AccountProfileManager as any).defaultRoamingPath=defaultPath;
  (childProcess as any).execFileSync=(_file:string,args:string[])=>{assert.ok(!args.at(-1)!.includes('csrf_token'));return JSON.stringify([main(dataPath),{...main(dataPath),pid:11},ls()]);};
  assert.equal(AccountProfileManager.getRunningInstanceForProfile(profilePath),null);
});

test('PowerShell metadata collector parses quotes/spaces and counts malformed or duplicated flags using only fixtures',t=>{
  const originalExec=childProcess.execFileSync;
  t.after(()=>{childProcess.execFileSync=originalExec;});
  const commands=[
    `Antigravity.exe --user-data-dir="${dataPath}"`,
    `Antigravity.exe --user-data-dir "${dataPath}"`,
    `Antigravity.exe "--user-data-dir=${dataPath}"`,
    'Antigravity.exe --user-data-dir=',
    `Antigravity.exe --user-data-dir="${dataPath}" --user-data-dir=C:\\Other`
  ];
  const encoded=Buffer.from(JSON.stringify(commands)).toString('base64');
  (childProcess as any).execFileSync=(file:string,args:string[],options:any)=>{
    const stub=`$commands=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')) | ConvertFrom-Json;
      $global:fixtureProcesses=@(); $index=10;
      foreach($command in $commands){$global:fixtureProcesses += [PSCustomObject]@{ProcessId=$index;ParentProcessId=1;Name='Antigravity.exe';ExecutablePath='${appExecutable}';CreationDate=[DateTime]::Parse('2026-10-09T10:00:00Z');CommandLine=$command};$index++};
      function Get-CimInstance { $global:fixtureProcesses };`;
    return originalExec(file,[...args.slice(0,-1),stub+args.at(-1)],options);
  };
  const collected=collectRuntimeProcessSnapshot();
  for(const row of collected.slice(0,3)){assert.equal(row.userDataDir,dataPath);assert.equal(row.userDataFlagCount,1);}
  assert.equal(collected[3].userDataDir,null);assert.equal(collected[3].userDataFlagCount,1);
  assert.equal(collected[4].userDataFlagCount,2);
  assert.ok(collected.every(row=>!('CommandLine' in row)));
});
