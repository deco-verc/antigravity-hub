const cp = require('child_process');
const readline = require('readline');
const exe = 'C:\\Users\\Deco\\AppData\\Local\\Programs\\antigravity\\resources\\bin\\language_server.exe';

console.log('Iniciando LS com --https_server_port 0...');
const child = cp.spawn(exe, [
  '--standalone',
  '--override_ide_name', 'antigravity',
  '--subclient_type', 'hub',
  '--override_ide_version', '2.19.1',
  '--override_user_agent_name', 'antigravity',
  '--https_server_port', '0',
  '--csrf_token', 'test-token-fixed',
  '--app_data_dir', 'antigravity',
  '--api_server_url', 'https://generativelanguage.googleapis.com',
  '--cloud_code_endpoint', 'https://daily-cloudcode-pa.googleapis.com',
  '--enable_sidecars'
]);

let grpcPort = null;
let httpPort = null;

const rl = readline.createInterface({ input: child.stderr, crlfDelay: Infinity });
rl.on('line', (line) => {
  const mGrpc = line.match(/listening on random port at (\d+) for HTTPS \(gRPC\)/i);
  if (mGrpc) grpcPort = parseInt(mGrpc[1], 10);
  const mHttp = line.match(/listening on random port at (\d+) for HTTP\b/i);
  if (mHttp) httpPort = parseInt(mHttp[1], 10);

  if (line.includes('initialized server successfully')) {
    console.log(`Portas detectadas: gRPC=${grpcPort}, HTTP=${httpPort}`);
    testBothPorts(grpcPort, httpPort);
  }
});

function testBothPorts(grpc, http) {
  console.log(`Testando HTTP port (${http})...`);
  try {
    const resHttp = cp.execFileSync(exe, ['agentapi', 'new-conversation', '--model=flash_lite', 'OK via HTTP'], {
      env: {
        ...process.env,
        ANTIGRAVITY_LS_ADDRESS: `127.0.0.1:${http}`,
        ANTIGRAVITY_CSRF_TOKEN: 'test-token-fixed'
      },
      encoding: 'utf-8',
      timeout: 10000
    });
    console.log('HTTP SUCESSO:', resHttp);
  } catch (e) {
    console.log('HTTP FALHA:', e.message, e.stdout?.toString());
  }

  console.log(`Testando gRPC port (${grpc})...`);
  try {
    const resGrpc = cp.execFileSync(exe, ['agentapi', 'new-conversation', '--model=flash_lite', 'OK via gRPC'], {
      env: {
        ...process.env,
        ANTIGRAVITY_LS_ADDRESS: `127.0.0.1:${grpc}`,
        ANTIGRAVITY_CSRF_TOKEN: 'test-token-fixed'
      },
      encoding: 'utf-8',
      timeout: 10000
    });
    console.log('gRPC SUCESSO:', resGrpc);
  } catch (e) {
    console.log('gRPC FALHA:', e.message, e.stdout?.toString());
  }

  child.kill();
  process.exit(0);
}
