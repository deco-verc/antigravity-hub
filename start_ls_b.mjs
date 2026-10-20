import { spawn } from 'node:child_process';
import path from 'node:path';

const exe = 'C:\\Users\\Deco\\AppData\\Local\\Programs\\antigravity\\resources\\bin\\language_server.exe';

const child = spawn(
  exe,
  [
    '--standalone',
    '--override_ide_name', 'antigravity',
    '--subclient_type', 'hub',
    '--override_ide_version', '2.19.1',
    '--override_user_agent_name', 'antigravity',
    '--https_server_port', '37811',
    '--csrf_token', '016eeaf5-0b01-49b1-ab3f-6aa0869699a3',
    '--app_data_dir', 'antigravity',
    '--api_server_url', 'https://generativelanguage.googleapis.com',
    '--cloud_code_endpoint', 'https://daily-cloudcode-pa.googleapis.com',
    '--enable_sidecars'
  ],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      USERPROFILE: 'C:\\Users\\Deco\\.ai-dev-hub\\profiles\\google_pro_2'
    }
  }
);

console.log('Account B Language Server started with PID:', child.pid);
