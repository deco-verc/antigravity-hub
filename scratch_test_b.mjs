import { execFileSync } from 'node:child_process';
import path from 'node:path';

const exe = 'C:\\Users\\Deco\\AppData\\Local\\Programs\\antigravity\\resources\\bin\\language_server.exe';

try {
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if (k.startsWith('ANTIGRAVITY_')) {
      delete env[k];
    }
  }
  env.ANTIGRAVITY_PROJECT_ID = 'outside-of-project';
  env.ANTIGRAVITY_LS_ADDRESS = '127.0.0.1:38308';
  env.ANTIGRAVITY_CSRF_TOKEN = '016eeaf5-0b01-49b1-ab3f-6aa0869699a3';
  env.USERPROFILE = 'C:\\Users\\Deco\\.ai-dev-hub\\profiles\\google_pro_2';

  const result = execFileSync(
    exe,
    ['agentapi', 'send-message', 'b9cf2be3-36ef-4a20-b000-7d91ce009706', 'Continue e adicione filtros: Todos, Pendentes e Concluídos.'],
    {
      encoding: 'utf-8',
      env
    }
  );
  console.log('SEND SUCCESS:', result);
} catch (e) {
  console.error('ERROR:', e.message, e.stdout, e.stderr);
}
