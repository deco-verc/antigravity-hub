'use strict';
const cp=require('node:child_process'),path=require('node:path');
for(const method of ['exec','execSync','execFile','execFileSync','spawn','spawnSync','fork']){
  const original=cp[method];cp[method]=function(file,...rest){
    const agent=/^(language_server|antigravity|agy)(?:\.exe)?$/i.test(path.basename(String(file)));
    const shellAgent=['exec','execSync'].includes(method)&&/(?:^|[\s;&|])(?:language_server|antigravity\.exe|agy|agentapi)(?:\s|$)/i.test(String(file));
    if(agent||shellAgent||Array.isArray(rest[0])&&rest[0].some(a=>a==='agentapi'))throw Error('OFFLINE_PRODUCT_JOB_AGENT_PROCESS_DENIED');
    return original.call(this,file,...rest);
  };
}
require('node:module').syncBuiltinESMExports();
