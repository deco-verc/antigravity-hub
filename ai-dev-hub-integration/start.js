import { spawn, exec } from 'node:child_process';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isWindows = process.platform === 'win32';
const npxCmd = isWindows ? 'npx.cmd' : 'npx';

console.log('====================================================');
console.log('🚀 INICIANDO AI DEV HUB');
console.log('====================================================');

const serverDir = path.join(__dirname, 'server');
const clientDir = path.join(__dirname, 'client');

function isPortTaken(port) {
  return new Promise(resolve => {
    const tester = net.createServer()
      .once('error', err => {
        if (err.code === 'EADDRINUSE') resolve(true);
        else resolve(false);
      })
      .once('listening', () => {
        tester.once('close', () => resolve(false)).close();
      })
      .listen(port);
  });
}

async function start() {
  const is3001Taken = await isPortTaken(3001);
  const is5173Taken = await isPortTaken(5173);

  let serverProc = null;
  let clientProc = null;

  // 1. Start Server if not already running
  if (is3001Taken) {
    console.log('[1/3] Porta 3001 já em uso. Utilizando servidor backend ativo.');
  } else {
    console.log('[1/3] Iniciando backend Node.js + SQLite...');
    serverProc = spawn(npxCmd, ['tsx', 'src/index.ts'], {
      cwd: serverDir,
      stdio: 'inherit',
      shell: true,
      env: { ...process.env, PORT: '3001' }
    });
  }

  // 2. Start Vite Client if not already running
  if (is5173Taken) {
    console.log('[2/3] Porta 5173 já em uso. Utilizando cliente frontend ativo.');
  } else {
    console.log('[2/3] Iniciando frontend React + Vite...');
    clientProc = spawn(npxCmd, ['vite', '--port', '5173'], {
      cwd: clientDir,
      stdio: 'inherit',
      shell: true
    });
  }

  function checkReady(port, cb) {
    const req = http.get(`http://localhost:${port}/`, () => cb(true));
    req.on('error', () => {
      setTimeout(() => checkReady(port, cb), 400);
    });
  }

  // 3. Wait for client to be ready and open browser
  console.log('[3/3] Aguardando aplicação responder...');
  checkReady(5173, () => {
    console.log('\n====================================================');
    console.log('✨ AI DEV HUB PRONTO E ONLINE!');
    console.log('🌐 Frontend:          http://localhost:5173');
    console.log('🔌 Backend API:       http://localhost:3001/api');
    console.log('🧠 Servidor MCP:      JSON-RPC 2.0 (stdio + HTTP)');
    console.log('🤖 Autonomous Runner: PERSISTENTE (Scheduler 3s + Heartbeat 15s + Watchdog)');
    console.log('====================================================\n');

    if (isWindows) {
      exec('start http://localhost:5173');
    }
  });

  function cleanup() {
    console.log('\nEncerrando AI DEV HUB...');
    try { if (serverProc) serverProc.kill(); } catch {}
    try { if (clientProc) clientProc.kill(); } catch {}
    process.exit(0);
  }

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

start();
