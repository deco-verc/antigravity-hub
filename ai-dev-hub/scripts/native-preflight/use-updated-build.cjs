'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {Ledger,digest}=require('./ledger.cjs');
const root='C:\\IA\\DecoHUB-native-sandbox-20261009',file=path.join(root,'sandbox.json'),config=JSON.parse(fs.readFileSync(file,'utf8'));
const ledger=new Ledger(config.controlRoot,config.binding),before=ledger.snapshot();
assert.equal(before.activeCalls.length,0);assert.equal(ledger.db.prepare('SELECT COUNT(*) n FROM backend_lease').get().n,0);
assert.equal(fs.existsSync(path.join(config.controlRoot,'live-approval.json')),false);
const base=path.resolve(__dirname,'../../dist-desktop-1.0.4/win-unpacked');
assert.ok(fs.existsSync(path.join(base,'resources/app.asar.unpacked/server/dist/nativeWorkspaceBinding.js')));
config.originalArtifactRoot ||= config.artifactRoot;config.artifactRoot=base;config.version='1.0.4';
config.packagedServer=path.join(base,'resources','app.asar.unpacked','server','dist');config.clientDist=path.join(base,'resources','app.asar.unpacked','client','dist');
config.packagedGatewayHash=digest(fs.readFileSync(path.join(config.packagedServer,'agentApiGateway.js')));
delete config.runtimeOverlay;
for(const name of ['guard.cjs','legacy-controller.cjs']){const content=fs.readFileSync(path.join(__dirname,name));fs.writeFileSync(path.join(root,'guard',name),content);config.fileHashes[name]=digest(content);}
fs.writeFileSync(file,JSON.stringify(config,null,2));ledger.event('UPDATED_DISTRIBUTED_BUILD_SELECTED',{version:'1.0.4',originalAnchorPreserved:true,budgetReset:false});
const after=ledger.snapshot();assert.deepEqual(after.binding,before.binding);assert.deepEqual(after.control,before.control);assert.deepEqual(after.creations,before.creations);assert.deepEqual(after.sends,before.sends);
ledger.close();console.log(JSON.stringify({version:'1.0.4',sourceOverlayRequired:false,creationReservations:after.creations.length,budgetReset:false}));
