const cp = require('child_process');
const exe = 'C:\\Users\\Deco\\AppData\\Local\\Programs\\antigravity\\resources\\bin\\language_server.exe';

console.log('--- Testando porta 2108 ---');
try {
  const out1 = cp.execFileSync(exe, ['agentapi', 'new-conversation', '--model=flash_lite', 'OK'], {
    env: {
      ...process.env,
      ANTIGRAVITY_LS_ADDRESS: '127.0.0.1:2108',
      ANTIGRAVITY_CSRF_TOKEN: '4275f62c-0f0b-458b-a2a5-f44a62ca0643'
    },
    encoding: 'utf-8',
    timeout: 10000
  });
  console.log('Porta 2108 SUCESSO:', out1);
} catch (e) {
  console.log('Porta 2108 FALHA:', e.message, e.stdout?.toString(), e.stderr?.toString());
}

console.log('--- Testando porta 2109 ---');
try {
  const out2 = cp.execFileSync(exe, ['agentapi', 'new-conversation', '--model=flash_lite', 'OK'], {
    env: {
      ...process.env,
      ANTIGRAVITY_LS_ADDRESS: '127.0.0.1:2109',
      ANTIGRAVITY_CSRF_TOKEN: '4275f62c-0f0b-458b-a2a5-f44a62ca0643'
    },
    encoding: 'utf-8',
    timeout: 10000
  });
  console.log('Porta 2109 SUCESSO:', out2);
} catch (e) {
  console.log('Porta 2109 FALHA:', e.message, e.stdout?.toString(), e.stderr?.toString());
}
