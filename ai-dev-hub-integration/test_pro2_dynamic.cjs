const { spawn, execFileSync } = require('child_process');
const path = require('path');
const readline = require('readline');

const exe = 'C:\\Users\\Deco\\AppData\\Local\\Programs\\antigravity\\resources\\bin\\language_server.exe';
const envPath = 'C:\\Users\\Deco\\.ai-dev-hub\\profiles\\google_pro_2';
const csrfToken = 'test-token-pro2-123';

console.log('1. Iniciando language_server isolado para Google Pro 2 com porta dinâmica 0...');
const child = spawn(exe, [
  '--standalone',
  '--override_ide_name', 'antigravity',
  '--subclient_type', 'hub',
  '--override_ide_version', '2.19.1',
  '--override_user_agent_name', 'antigravity',
  '--https_server_port', '0',
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

let grpcPort = null;
let httpPort = null;
let initialized = false;

const rl = readline.createInterface({ input: child.stderr, crlfDelay: Infinity });

rl.on('line', (line) => {
  // Exemplo: Language server listening on random port at 6873 for HTTPS (gRPC)
  const grpcMatch = line.match(/listening on random port at (\d+) for HTTPS \(gRPC\)/i);
  if (grpcMatch) {
    grpcPort = parseInt(grpcMatch[1], 10);
    console.log(`-> gRPC Port detectada: ${grpcPort}`);
  }
  const httpMatch = line.match(/listening on random port at (\d+) for HTTP\b/i);
  if (httpMatch) {
    httpPort = parseInt(httpMatch[1], 10);
    console.log(`-> HTTP Port detectada: ${httpPort}`);
  }

  if (line.includes('initialized server successfully') && !initialized) {
    initialized = true;
    console.log('-> Servidor totalmente inicializado! Testando agentapi...');
    runAgentApiTest();
  }
});

function runAgentApiTest() {
  console.log(`2. Executando agentapi apontando para gRPC port: ${grpcPort}...`);
  const clientEnv = {
    ...process.env,
    ANTIGRAVITY_LS_ADDRESS: `127.0.0.1:${grpcPort}`,
    ANTIGRAVITY_CSRF_TOKEN: csrfToken,
    USERPROFILE: envPath,
    APPDATA: path.join(envPath, 'AppData', 'Roaming'),
    LOCALAPPDATA: path.join(envPath, 'AppData', 'Local'),
    HOME: envPath,
    ANTIGRAVITY_PROJECT_ID: 'outside-of-project'
  };

  try {
    const res = execFileSync(exe, [
      'agentapi', 'new-conversation',
      '--model=flash_lite',
      '--title=Teste Google Pro 2 Isolado',
      'Responda OK e confirme isolamento.'
    ], {
      env: clientEnv,
      encoding: 'utf-8',
      timeout: 30000
    });

    console.log('3. SUCESSO AGENTAPI NO PRO 2:');
    console.log(res);
  } catch (err) {
    console.error('ERRO AGENTAPI:', err.message);
    if (err.stdout) console.log('STDOUT:', err.stdout.toString());
    if (err.stderr) console.log('STDERR:', err.stderr.toString());
  } finally {
    console.log('Finalizando processo de teste...');
    child.kill();
    process.exit(0);
  }
}

setTimeout(() => {
  if (!initialized) {
    console.error('TIMEOUT aguardando inicialização do LS');
    child.kill();
    process.exit(1);
  }
}, 20000);
