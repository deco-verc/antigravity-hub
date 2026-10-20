'use strict';
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const Module = require('node:module');
const { Ledger,Boundary,SafetyError,digest,canonical } = require('./ledger.cjs');
const { selectRuntime,assertStableRuntime } = require('./runtime.cjs');
const {inspectLegacyController}=require('./legacy-controller.cjs');

function isValidReadOnlyInventoryQuery(file, args, method, evidenceScriptPath = path.join(__dirname, 'runtime-evidence.ps1')) {
  if (method !== 'execFileSync' && method !== 'execFile') return false;
  const base = path.basename(String(file)).toLowerCase();
  if (base !== 'powershell.exe' && base !== 'powershell' && base !== 'pwsh.exe' && base !== 'pwsh') return false;
  if (!Array.isArray(args) || args.length !== 3) return false;
  if (args[0] !== '-NoProfile') return false;
  if (args[1] === '-File') {
    try { return canonical(args[2]) === canonical(evidenceScriptPath); } catch { return false; }
  }
  if (args[1] !== '-Command') return false;
  const script = String(args[2]);
  const hasInventoryCmdlet = /(?:Get-CimInstance|Get-WmiObject)\s+Win32_Process/i.test(script) || /Get-NetTCPConnection\s+-OwningProcess/i.test(script);
  if (!hasInventoryCmdlet) return false;
  if (/(?:Start-Process|\bsaps\b|\bstart\s|Invoke-Expression|\biex\b|Invoke-Command|\bicm\b|\bStart-Job\b|Invoke-Item|\bii\b|System\.Diagnostics\.Process|\bNew-Object\b|\bAdd-Type\b|\[scriptblock\]|\bcmd(?:\.exe)?\b|\bbash\b|\bsh\b|\bwscript\b|\bcscript\b|\bmshta\b|\brundll32\b)/i.test(script)) return false;
  if (/(?:^|[\s;])\s*&(?:\s+|$)/.test(script)) return false;
  if (/(?:^|[\s;])\s*\.(?:\s+|$)/.test(script)) return false;
  if (/(?:Invoke-WebRequest|\biwr\b|Invoke-RestMethod|\birm\b|Net\.WebClient|Net\.Http|Net\.Sockets)/i.test(script)) return false;
  if (/(?:Set-Content|Out-File|Add-Content|Remove-Item|\bdel\b|\brm\b|New-Item|Copy-Item|Move-Item|Set-Variable|\bset\b|Set-Item|>|>>)/i.test(script)) return false;
  const stripped = script.replace(/['"][^'"]*['"]/g, '');
  if (/(?:language_server|antigravity|\bagy\b|agentapi)/i.test(stripped)) return false;
  return true;
}
const isDirectAgent = file => /(?:language_server|antigravity|agy)(?:\.exe)?$/i.test(path.basename(String(file)));
const isAgent = (file,args) => isDirectAgent(file) || (Array.isArray(args) && /language_server|agentapi|antigravity\.exe|\bagy\b/i.test(args.join(' ')));
const isPowerShellExecutable = file => ['powershell.exe', 'powershell', 'pwsh.exe', 'pwsh'].includes(path.basename(String(file)).toLowerCase());

function install(config) {
  if (canonical(process.env.AI_DEV_HUB_DATA_DIR || '.') !== canonical(config.dataRoot) || canonical(process.cwd()) !== canonical(config.projectRoot)) throw new SafetyError('SANDBOX_PATH_MISMATCH');
  const ledger = new Ledger(config.controlRoot,config.binding);
  ledger.claimBackend();
  process.once('exit',()=>ledger.close());
  if (config.runtimeOverlay) {
    const target=path.join(config.packagedServer,'accountProfileManager.js');
    const overlay=config.runtimeOverlay;
    for (const [file,hash] of [[overlay.manager,overlay.managerHash],[overlay.selector,overlay.selectorHash]]) {
      if (digest(fs.readFileSync(file)) !== hash) throw new SafetyError('SOURCE_RUNTIME_OVERLAY_INTEGRITY_CHANGED');
    }
    const originalResolve=Module._resolveFilename;
    Module._resolveFilename=function(request,parent,...rest) {
      if (request==='./runtimeProfileSelector.js' && parent?.filename?.toLowerCase()===target.toLowerCase()) return overlay.selector;
      return originalResolve.call(this,request,parent,...rest);
    };
    const originalJs=Module._extensions['.js'];
    Module._extensions['.js']=function(module,filename) {
      if (filename.toLowerCase()===target.toLowerCase()) return module._compile(fs.readFileSync(overlay.manager,'utf8'),filename);
      return originalJs(module,filename);
    };
    ledger.event('SOURCE_RUNTIME_OVERLAY_LOADED',{managerHash:overlay.managerHash,selectorHash:overlay.selectorHash});
  }
  const originalExec = cp.execFileSync;
  const snapshot = () => JSON.parse(originalExec('powershell.exe',['-NoProfile','-File',path.join(__dirname,'runtime-evidence.ps1')],{encoding:'utf8',timeout:8000,windowsHide:true}));
  let context = null;
  const readiness = request => {
    if (process.env.DECOHUB_OFFLINE_MODE === 'true') throw new SafetyError('OFFLINE_NO_REAL_AGENT_CALLS');
    const file = path.join(config.controlRoot,'live-approval.json');
    if (!fs.existsSync(file)) throw new SafetyError('LIVE_AUTHORIZATION_MISSING');
    const approval = JSON.parse(fs.readFileSync(file,'utf8'));
    const checkedAt = Date.parse(approval.checkedAt);
    if (approval.authorization !== 'EXPLICIT_USER_AUTHORIZATION' || approval.accountProfileId !== config.binding.accountProfileId ||
        approval.identityVerified !== true || approval.creditOverages !== 'Never' || approval.noOtherTasks !== true ||
        approval.effectiveWorkspace !== config.projectRoot || approval.nativeProjectBindingVerified !== true ||
        approval.proAvailable !== true || approval.flashAvailable !== true || !Number.isFinite(checkedAt) || checkedAt > Date.now()) throw new SafetyError('MANDATORY_LIVE_EVIDENCE_MISSING_OR_STALE');
    const sends = ledger.snapshot().sends;
    const additionalSends = sends.length - (config.normalFlow?.baselineSends || 0);
    const isContinuingActiveRun = additionalSends > 0 && additionalSends < (approval.authorizedSends || 6);
    const initialExpired = Date.now() - checkedAt > 300000;
    if (!isContinuingActiveRun && initialExpired) throw new SafetyError('MANDATORY_LIVE_EVIDENCE_MISSING_OR_STALE');
    if (!config.binding.models[request.role] || config.binding.models[request.role] !== request.model) throw new SafetyError('MODEL_SWITCH_DENIED');
    const processSnapshot=snapshot();
    const current = selectRuntime(config.accountEnvironmentPath,config.defaultAccountDataPath,processSnapshot);
    assertStableRuntime(approval.runtime,current);
    if (request.address !== approval.runtime.address) throw new SafetyError('RUNTIME_ADDRESS_MISMATCH');
    if (!inspectLegacyController(config.productionDb,processSnapshot).safe) throw new SafetyError('LEGACY_CONTROLLER_NOT_QUIESCENT');
    if (config.nativeProjectId && request.nativeProjectId!==config.nativeProjectId) throw new SafetyError('NATIVE_WORKSPACE_PROJECT_MISMATCH');
    if (approval.modelSelectionScope!=='TIER_ONLY') throw new SafetyError('EXACT_MODEL_VARIANT_NOT_SUPPORTED');
  };
  const boundary = new Boundary(ledger,readiness);
  for (const method of ['execFileSync','execFile','spawn','spawnSync','exec','execSync','fork']) {
    const original = cp[method];
    cp[method] = function(file,...rest) {
      const args = Array.isArray(rest[0]) ? rest[0] : [];
      const shellCmd = (method === 'exec' || method === 'execSync') ? String(file).trim() : '';
      const shellAgent = shellCmd && /language_server|antigravity|\bagy\b|agentapi/i.test(shellCmd);

      // 1. Strictly validated read-only inventory queries (PowerShell)
      if (isValidReadOnlyInventoryQuery(file, args, method)) {
        ledger.event('READ_ONLY_INVENTORY_QUERY', { executable: path.basename(String(file)) });
        return original.call(cp, file, ...rest);
      }

      // 2. Reject any unauthorized or generic PowerShell invocation
      if (isPowerShellExecutable(file)) {
        ledger.event('DENIED_BEFORE_EXTERNAL_CALL', { code: 'UNAUTHORIZED_POWERSHELL_DENIED', method });
        throw new SafetyError('UNAUTHORIZED_POWERSHELL_DENIED');
      }

      // 3. Read-only path lookup (where/which language_server)
      const readOnlyPathLookup = shellCmd && /^\s*(?:where(?:\.exe)?|which)\s+language_server(?:\.exe)?\s*$/i.test(shellCmd);
      if (readOnlyPathLookup) {
        ledger.event('READ_ONLY_PATH_LOOKUP', { command: shellCmd });
        return original.call(cp, file, ...rest);
      }

      // 4. Benign commands that do not touch agent binaries or commands
      if (!isAgent(file, args) && !shellAgent) return original.call(cp, file, ...rest);

      // 5. Read-only CLI help
      const readOnlyHelp = (method==='execFileSync' && ((args.length===1 && args[0]==='--help') || (args.length===2 && args[0]==='agentapi' && args[1]==='--help') || (args.length===3 && args[0]==='agentapi' && args[1]==='new-conversation' && args[2]==='--help')) && config.languageServerExe && canonical(file)===canonical(config.languageServerExe))
        || (shellCmd && /^"?.*(?:language_server|antigravity)\.exe"?\s+--help$/i.test(shellCmd));
      if (readOnlyHelp) {
        ledger.event('READ_ONLY_CLI_HELP',{createsConversation:false});return original.call(cp,file,...rest);
      }

      // 6. Metadata read for tracked conversations
      if (method === 'execFileSync' && args[0] === 'agentapi' && args[1] === 'get-conversation-metadata') {
        const session = ledger.snapshot().creations.find(c => c.conversation_id === args[2] && c.status === 'CONFIRMED');
        if (!session) throw new SafetyError('UNKNOWN_METADATA_CONVERSATION_DENIED');
        const opts = rest[1] || {};
        const request = {verb:args[1],role:session.role,model:session.model,address:opts.env?.ANTIGRAVITY_LS_ADDRESS,nativeProjectId:opts.env?.ANTIGRAVITY_PROJECT_ID};
        readiness(request);ledger.ready();
        if (canonical(file) !== canonical(config.languageServerExe)) throw new SafetyError('EXTERNAL_EXECUTABLE_MISMATCH');
        ledger.event('METADATA_READ',{role:session.role,conversationId:args[2]});
        try { return original.call(cp,file,...rest); } catch { ledger.halt('METADATA_READ_FAILED');throw new SafetyError('METADATA_READ_FAILED'); }
      }

      // 7. Tracked agent commands (new-conversation / send-message)
      if (method !== 'execFileSync' || args[0] !== 'agentapi' || !['new-conversation','send-message'].includes(args[1]) || args.includes('--help')) {
        ledger.event('DENIED_BEFORE_EXTERNAL_CALL',{code:'UNTRACKED_AGENT_PROCESS_DENIED',method});
        throw new SafetyError('UNTRACKED_AGENT_PROCESS_DENIED');
      }
      if (!context) throw new SafetyError('UNTRACKED_AGENT_CONTEXT_DENIED');
      const opts = rest[1] || {};
      if (canonical(opts.cwd || '.') !== canonical(config.projectRoot) || canonical(file) !== canonical(config.languageServerExe)) throw new SafetyError('EXTERNAL_EXECUTABLE_OR_CWD_MISMATCH');
      const physicalModel = args.find(a => String(a).startsWith('--model='))?.slice(8);
      if (args[1] === 'new-conversation' && physicalModel !== context.model) throw new SafetyError('PHYSICAL_MODEL_MISMATCH');
      if (args[1] === 'send-message' && args[2] !== context.conversationId) throw new SafetyError('PHYSICAL_CONVERSATION_MISMATCH');
      return boundary.invoke({...context,verb:args[1],address:opts.env?.ANTIGRAVITY_LS_ADDRESS,nativeProjectId:opts.env?.ANTIGRAVITY_PROJECT_ID},() => original.call(cp,file,...rest));
    };
  }
  require('node:module').syncBuiltinESMExports();
  const originalLoad = Module._load;
  Module._load = function(request,parent,isMain) {
    const exported = originalLoad.call(this, request, parent, isMain);
    let resolved;
    try { resolved = Module._resolveFilename(request, parent); } catch { return exported; }
    const serverDir = path.resolve(config.packagedServer).toLowerCase() + path.sep;
    if (typeof resolved !== 'string' || !path.resolve(resolved).toLowerCase().startsWith(serverDir)) return exported;
    if (path.basename(resolved) === 'agentApiGateway.js' && exported.AgentApiGateway && !exported.AgentApiGateway.__sandboxGuarded) {
      const gateway = exported.AgentApiGateway;
      for (const verb of ['newConversation','sendMessage']) {
        const original = gateway[verb];
        gateway[verb] = function(options) {
          if (context) throw new SafetyError('NESTED_AGENT_OPERATION_DENIED');
          const role = options.role;
          context = {role,projectId:options.projectId,accountProfileId:config.binding.accountProfileId,
            model:verb === 'newConversation' ? options.model : config.binding.models[role],conversationId:options.conversationId,
            promptHash:digest(String(options.prompt || ''))};
          try { return original.call(this,options); } finally { context = null; }
        };
      }
      gateway.__sandboxGuarded = true;
    }
    if (path.basename(resolved) === 'accountProfileManager.js' && exported.AccountProfileManager && !exported.AccountProfileManager.__sandboxGuarded) {
      const manager = exported.AccountProfileManager;
      manager.launchLogin = manager.switchAccount = () => { throw new SafetyError('AUTH_OR_ACCOUNT_MUTATION_DENIED'); };
      // The sandbox profile row is seeded explicitly. Do not scan historical login files in existing accounts.
      manager.initDefaultProfiles = () => {};
      manager.verifyProfile = () => { throw new SafetyError('OFFICIAL_UI_IDENTITY_REQUIRED'); };
      const original = manager.getRunningInstanceForProfile;
      manager.getRunningInstanceForProfile = function(envPath) {
        if (process.env.DECOHUB_OFFLINE_MODE === 'true') return null;
        if (path.resolve(envPath).toLowerCase() !== path.resolve(config.accountEnvironmentPath).toLowerCase()) throw new SafetyError('ACCOUNT_SWITCH_DENIED');
        const expected = selectRuntime(envPath,config.defaultAccountDataPath,snapshot());
        if (!expected) return null;
        const result = original.call(this,envPath);
        if (!result || result.pid !== expected.pid) throw new SafetyError('PACKAGED_RUNTIME_SELECTION_MISMATCH');
        return result;
      };
      manager.__sandboxGuarded = true;
    }
    if (path.basename(resolved) === 'agentSessionManager.js' && exported.AgentSessionManager && !exported.AgentSessionManager.__sandboxGuarded) {
      const manager = exported.AgentSessionManager;
      const original = manager.getOrCreateAgentSession;
      manager.getOrCreateAgentSession = function(projectId,role,options={}) {
        if (projectId !== config.binding.projectId || options.accountProfileId !== config.binding.accountProfileId || options.model !== config.binding.models[role] || options.forceNew) throw new SafetyError('SESSION_BINDING_OR_ROTATION_DENIED');
        return original.call(this,projectId,role,options);
      };
      manager.__sandboxGuarded = true;
    }
    if (path.basename(resolved) === 'selfImprovementRun.js' && exported.AutonomousSelfImprovementEngine) {
      exported.AutonomousSelfImprovementEngine.recoverPendingRunsOnStartup = async () => {};
      // Sandbox is dedicated to this temporary project, never AutoAdapt.
      for (const name of ['start','startRun','resumeRun']) if (typeof exported.AutonomousSelfImprovementEngine[name] === 'function') exported.AutonomousSelfImprovementEngine[name] = () => { throw new SafetyError('AUTOADAPT_DENIED'); };
    }
    if (path.basename(resolved) === 'autonomousRunnerService.js' && exported.AutonomousRunnerService && process.env.DECOHUB_OFFLINE_MODE === 'true') exported.AutonomousRunnerService.start = () => {};
    return exported;
  };
  ledger.event('SANDBOX_GUARD_INSTALLED',{offline:process.env.DECOHUB_OFFLINE_MODE === 'true',creationLimit:2});
  return ledger;
}

module.exports = { install, isValidReadOnlyInventoryQuery, isDirectAgent, isAgent, isPowerShellExecutable };
if (process.env.DECOHUB_SANDBOX_CONFIG) install(JSON.parse(fs.readFileSync(process.env.DECOHUB_SANDBOX_CONFIG,'utf8')));
