'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {digest} = require('./ledger.cjs');
const configFile = path.join(__dirname,'..','sandbox.json');
const config = JSON.parse(fs.readFileSync(configFile,'utf8'));
for (const [name,hash] of Object.entries(config.fileHashes)) {
  const folder = name === 'verify-project.cjs' ? 'verification' : 'guard';
  if (digest(fs.readFileSync(path.join(config.root,folder,name))) !== hash) throw new Error('SANDBOX_GUARD_INTEGRITY_CHANGED');
}
if (digest(fs.readFileSync(path.join(config.packagedServer,'agentApiGateway.js'))) !== config.packagedGatewayHash) throw new Error('PACKAGED_ARTIFACT_CHANGED');
// Explicitly remove inherited provider routing. Never log its values.
for (const key of Object.keys(process.env)) if (/^(ANTIGRAVITY_|AGY_|CODEIUM_|ELECTRON_)/.test(key)) delete process.env[key];
process.env.DECOHUB_OFFLINE_MODE = 'true';
process.env.DECOHUB_ALLOW_LIVE_AGENTAPI = 'false';
delete process.env.DECOHUB_TEST_PROVIDER_MODULE;
process.env.AI_DEV_HUB_DATA_DIR = config.dataRoot;
process.env.CLIENT_DIST_PATH = config.clientDist;
process.env.PORT = '33103';
process.chdir(config.projectRoot);
require('./guard.cjs').install(config);
require(path.join(config.packagedServer,'index.js'));
process.on('message',message=>{if(message?.command==='stop-offline')process.emit('SIGTERM');});
