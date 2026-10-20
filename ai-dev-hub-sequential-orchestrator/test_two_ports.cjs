const cp = require('child_process');
const exe = 'C:\\Users\\Deco\\AppData\\Local\\Programs\\antigravity\\resources\\bin\\language_server.exe';
const envPath = 'C:\\Users\\Deco\\.ai-dev-hub\\profiles\\google_pro_2';

const p = cp.spawn(exe, [
  '--standalone',
  '--override_ide_name', 'antigravity',
  '--subclient_type', 'hub',
  '--override_ide_version', '2.19.1',
  '--override_user_agent_name', 'antigravity',
  '--http_server_port', '38200',
  '--https_server_port', '38201',
  '--csrf_token', 'test-token',
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

p.stderr.on('data', d => {
  const s = d.toString();
  if (s.includes('listening on')) console.log(s.trim());
});

setTimeout(() => { p.kill(); process.exit(0); }, 3000);
