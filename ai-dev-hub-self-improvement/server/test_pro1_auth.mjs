import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const lsExe = path.join(process.env.LOCALAPPDATA, 'Programs', 'antigravity', 'resources', 'bin', 'language_server.exe');

const testEnv = { ...process.env };
delete testEnv.ANTIGRAVITY_PROJECT_ID;

try {
  const out = execFileSync(lsExe, [
    'agentapi', 'new-conversation', '--model=flash', '--title=Auth Verification Test', 'ping'
  ], {
    encoding: 'utf-8',
    timeout: 15000,
    env: testEnv
  });
  console.log('SUCCESS WITHOUT PROJECT_ID:', out);
} catch (e) {
  console.log('WITHOUT PROJECT_ID FAILED:', e.message, e.stdout);
}

try {
  testEnv.ANTIGRAVITY_PROJECT_ID = 'd1b32495-fc9b-4473-baf3-ba86fe564882';
  const out = execFileSync(lsExe, [
    'agentapi', 'new-conversation', '--model=flash', '--title=Auth Verification Test', 'ping'
  ], {
    encoding: 'utf-8',
    timeout: 15000,
    env: testEnv
  });
  console.log('SUCCESS WITH MATCHING PROJECT_ID:', out);
} catch (e) {
  console.log('WITH MATCHING PROJECT_ID FAILED:', e.message, e.stdout);
}
