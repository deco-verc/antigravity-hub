const { spawn, execFileSync } = require('child_process');
const { getLanguageServerExe } = require('./server/dist/antigravityProvider.js');
const exe = getLanguageServerExe();

const envPath = 'C:\\Users\\Deco\\.ai-dev-hub\\profiles\\google_pro_2';
const path = require('path');
const csrfToken = 'test-token-123';
const fixedPort = 38102;

console.log('1. Subindo LS...');
const lsProcess = spawn(exe, [
  '--standalone',
  '--override_ide_name', 'antigravity',
  '--subclient_type', 'hub',
  '--override_ide_version', '2.19.1',
  '--override_user_agent_name', 'antigravity',
  '--https_server_port', String(fixedPort),
  '--csrf_token', csrfToken,
  '--app_data_dir', 'antigravity',
  '--api_server_url', 'https://generativelanguage.googleapis.com',
  '--cloud_code_endpoint', 'https://daily-cloudcode-pa.googleapis.com',
  '--enable_sidecars'
], {
  env: {
    ...process.env,
    USERPROFILE: envPath,
    APPDATA: path.join(envPath, 'AppData', 'Roaming'),
    LOCALAPPDATA: path.join(envPath, 'AppData', 'Local'),
    HOME: envPath
  }
});

let ready = false;
lsProcess.stderr.on('data', d => {
  const str = d.toString();
  if (str.includes('Auth succeeded')) {
    ready = true;
    console.log('2. LS autenticado e pronto!');
    testAgentApi();
  }
});

function testAgentApi() {
  console.log('3. Testando chamada agentapi conectada a 127.0.0.1:' + fixedPort);
  const clientEnv = {
    ...process.env,
    ANTIGRAVITY_LS_ADDRESS: '127.0.0.1:' + fixedPort,
    ANTIGRAVITY_CSRF_TOKEN: csrfToken,
    USERPROFILE: envPath,
    APPDATA: path.join(envPath, 'AppData', 'Roaming'),
    LOCALAPPDATA: path.join(envPath, 'AppData', 'Local'),
    HOME: envPath
  };

  try {
    const res = execFileSync(exe, [
      'agentapi', 'new-conversation',
      '--model=flash',
      '--title=Teste Google Pro 2',
      'Olá, confirme que você está operacional no perfil secundário ald.clothingg@gmail.com!'
    ], {
      env: clientEnv,
      encoding: 'utf-8',
      timeout: 30000
    });
    console.log('4. SUCESSO AGENTAPI NO PRO 2:');
    console.log(res);
  } catch (err) {
    console.error('ERRO AGENTAPI:', err.message);
    if (err.stdout) console.log('STDOUT:', err.stdout.toString());
    if (err.stderr) console.log('STDERR:', err.stderr.toString());
  } finally {
    lsProcess.kill();
    process.exit(0);
  }
}

setTimeout(() => {
  if (!ready) {
    console.error('TIMEOUT aguardando LS ficar pronto');
    lsProcess.kill();
    process.exit(1);
  }
}, 15000);
