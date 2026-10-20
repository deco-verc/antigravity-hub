'use strict';
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const { Ledger,digest } = require('./ledger.cjs');
const root = 'C:\\IA\\DecoHUB-native-sandbox-20261009';
const artifactRoot = path.resolve(__dirname,'../../dist-desktop/win-unpacked');
const manifestFile = path.join(root,'sandbox.json');
if (fs.existsSync(manifestFile)) {
  const config = JSON.parse(fs.readFileSync(manifestFile,'utf8'));
  const ledger = new Ledger(config.controlRoot,config.binding);
  console.log(JSON.stringify({existingSandbox:true,reset:false,snapshot:ledger.snapshot()}));
  ledger.close();
  process.exit(0);
}
if (fs.existsSync(root)) throw new Error('Partial preparation exists; reconcile it without replacing the ledger.');
const packagedServer = path.join(artifactRoot,'resources','app.asar.unpacked','server','dist');
if (!fs.existsSync(path.join(packagedServer,'index.js'))) throw new Error('Packaged 1.0.3 backend not found');
const dataRoot = path.join(root,'data');
const projectRoot = path.join(root,'project');
const controlRoot = path.join(root,'control');
for (const dir of [dataRoot,projectRoot,controlRoot,path.join(root,'guard'),path.join(root,'logs'),path.join(root,'verification'),path.join(projectRoot,'src'),path.join(projectRoot,'test')]) fs.mkdirSync(dir,{recursive:true});
const fileHashes = {};
for (const name of ['ledger.cjs','runtime.cjs','runtime-evidence.ps1','guard.cjs','launch-offline.cjs','verify-project.cjs']) {
  const bytes = fs.readFileSync(path.join(__dirname,name));
  fs.writeFileSync(path.join(root,name === 'verify-project.cjs' ? 'verification' : 'guard',name),bytes,{flag:'wx'});
  fileHashes[name] = digest(bytes);
}
const config = {version:'1.0.3',artifactRoot,packagedServer,dataRoot,projectRoot,controlRoot,root,fileHashes,
  packagedGatewayHash:digest(fs.readFileSync(path.join(packagedServer,'agentApiGateway.js'))),
  clientDist:path.join(artifactRoot,'resources','app.asar.unpacked','client','dist'),
  defaultAccountDataPath:'C:\\Users\\Deco\\AppData\\Roaming\\Antigravity',accountEnvironmentPath:'C:\\Users\\Deco\\AppData\\Roaming\\Antigravity',
  productionDb:'C:\\Users\\Deco\\.ai-dev-hub\\hub.db',languageServerExe:'C:\\Users\\Deco\\AppData\\Local\\Programs\\antigravity\\resources\\bin\\language_server.exe',
  binding:{projectId:'native-homologation-20261009',accountProfileId:'acc-pro-1',models:{SUPERVISOR:'pro',WORKER:'flash'},
    sandboxRoot:root,projectRoot,dataRoot,artifactRoot,accountEnvironmentPath:'C:\\Users\\Deco\\AppData\\Roaming\\Antigravity'}};
Ledger.initialize(controlRoot,config.binding);
fs.writeFileSync(manifestFile,JSON.stringify(config,null,2),{flag:'wx'});
// Import only the immutable packaged db module, after pinning a new isolated directory.
process.env.AI_DEV_HUB_DATA_DIR = dataRoot;
process.env.DECOHUB_OFFLINE_MODE = 'true';
const {db} = require(path.join(packagedServer,'db.js'));
const now = new Date().toISOString();
db.prepare('INSERT INTO projects(id,name,path,objective,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
  .run(config.binding.projectId,'Homologação nativa controlada',projectRoot,'Validar cálculo, API e testes com evidências reais','active',now,now);
db.prepare('INSERT INTO account_profiles(id,display_name,profile_name,environment_path,auth_status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
  .run('acc-pro-1','Google Pro 1 — identidade pendente','google_pro_1',config.accountEnvironmentPath,'AUTH_UNKNOWN',now,now);
db.close();
fs.writeFileSync(path.join(projectRoot,'BRIEFING.md'),`# Projeto temporário de homologação\n\nCriar src/calculator.cjs exportando calculate({operation,a,b}). Operações add, subtract, multiply, divide. Aceitar somente números finitos; recusar operação desconhecida, valores não numéricos, divisão por zero e resultado não finito.\n\nCriar src/server.cjs exportando createServer(), um servidor HTTP local. GET /health devolve 200. POST /calculate recebe JSON e devolve {result}; dados inválidos devolvem 400. Limitar o corpo a 16 KiB. Não abrir listener fora de 127.0.0.1.\n\nCriar testes automatizados independentes com node:test. Executar e apresentar evidências de alterações reais. Verificação adversarial externa está em ../verification/verify-project.cjs. Corrigir somente falhas reais encontradas, sem introduzir erro artificial.\n\nNão acessar FinanceFlow, AutoAdapt, bancos existentes, autenticação ou configurações financeiras. Este diretório não comprova ainda o workspace efetivo do Language Server.\n`);
cp.execFileSync('git',['init','--quiet',projectRoot],{windowsHide:true});
fs.writeFileSync(path.join(controlRoot,'live-approval.example.json'),JSON.stringify({authorization:null,checkedAt:null,identityVerified:false,accountProfileId:'acc-pro-1',creditOverages:null,proAvailable:false,flashAvailable:false,noOtherTasks:false,effectiveWorkspace:projectRoot,nativeProjectBindingVerified:false,runtime:null},null,2));
const ledger = new Ledger(controlRoot,config.binding);
ledger.event('PREPARATION_COMPLETE',{realCalls:0,creations:0,authorized:false});
console.log(JSON.stringify({sandbox:root,dataRoot,projectRoot,creationReservations:ledger.snapshot().creations.length,liveAuthorization:false}));
ledger.close();
