const { spawn } = require('child_process');
const exe = 'C:\\Users\\Deco\\AppData\\Local\\Programs\\antigravity\\resources\\bin\\language_server.exe';
const p = spawn(exe, [
  '--standalone',
  '--override_ide_name', 'antigravity',
  '--subclient_type', 'hub',
  '--override_ide_version', '2.19.1',
  '--override_user_agent_name', 'antigravity',
  '--https_server_port', '38150',
  '--csrf_token', 'test-token',
  '--app_data_dir', 'antigravity',
  '--api_server_url', 'https://generativelanguage.googleapis.com',
  '--cloud_code_endpoint', 'https://daily-cloudcode-pa.googleapis.com',
  '--enable_sidecars'
]);

p.stderr.on('data', d => {
  const line = d.toString();
  if (line.includes('listening on')) {
    console.log('PORT LINE:', line.trim());
  }
});

setTimeout(() => { p.kill(); process.exit(0); }, 3000);
