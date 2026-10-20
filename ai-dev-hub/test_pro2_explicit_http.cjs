const cp = require('child_process');
const readline = require('readline');
const exe = 'C:\\Users\\Deco\\AppData\\Local\\Programs\\antigravity\\resources\\bin\\language_server.exe';
const envPath = 'C:\\Users\\Deco\\.ai-dev-hub\\profiles\\google_pro_2';
const csrfToken = 'test-token-pro2-final';

console.log('Iniciando LS isolado com HTTP port 38300 e HTTPS port 38301...');
const child = cp.spawn(exe, [
  '--standalone',
  '--override_ide_name', 'antigravity',
  '--subclient_type', 'hub',
  '--override_ide_version', '2.19.1',
  '--override_user_agent_name', 'antigravity',
  '--http_server_port', '38300',
  '--https_server_port', '38301',
  '--csrf_token', csrfToken,
  '--app_data_dir', 'antigravity',
  '--api_server_url', 'https://generativelanguage.googleapis.com',
  '--cloud_code_endpoint', 'https://daily-cloudcode-pa.googleapis.com',
  '--enable_sidecars'
], {
  env: {
    ...process.env,
    USERPROFILE: envPath,
    APPDATA: envPath + '\\AppData\\Roaming',
    LOCALAPPDATA: envPath + '\\AppData\\Local',
    HOME: envPath
  }
});

const rl = readline.createInterface({ input: child.stderr, crlfDelay: Infinity });
let done = false;

rl.on('line', (line) => {
  if (line.includes('initialized server successfully') && !done) {
    done = true;
    console.log('LS pronto! Testando chamada agentapi na porta HTTP 38300...');
    testCall();
  }
});

function testCall() {
  try {
    const testEnv = { ...process.env };
    for (const key of Object.keys(testEnv)) {
      if (key.startsWith('ANTIGRAVITY_') || key.startsWith('AGY_') || key.startsWith('CODEIUM_')) {
        delete testEnv[key];
      }
    }
    testEnv.ANTIGRAVITY_LS_ADDRESS = '127.0.0.1:38300';
    testEnv.ANTIGRAVITY_CSRF_TOKEN = csrfToken;
    testEnv.USERPROFILE = envPath;
    testEnv.APPDATA = envPath + '\\AppData\\Roaming';
    testEnv.LOCALAPPDATA = envPath + '\\AppData\\Local';
    testEnv.HOME = envPath;
    testEnv.ANTIGRAVITY_PROJECT_ID = 'outside-of-project';

    const out = cp.execFileSync(exe, [
      'agentapi', 'new-conversation',
      '--model=flash_lite',
      '--title=Teste Google Pro 2 HTTP',
      'Responda OK'
    ], {
      env: testEnv,
      encoding: 'utf-8',
      timeout: 20000
    });
    console.log('RESULTADO FINAL PRO 2 SUCESSO:');
    console.log(out);
  } catch (err) {
    console.error('ERRO:', err.message, err.stdout?.toString());
  } finally {
    child.kill();
    process.exit(0);
  }
}

setTimeout(() => {
  if (!done) {
    console.log('TIMEOUT');
    child.kill();
    process.exit(1);
  }
}, 15000);
