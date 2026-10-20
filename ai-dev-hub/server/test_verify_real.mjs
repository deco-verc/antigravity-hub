import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const lsExe = path.join(process.env.LOCALAPPDATA, 'Programs', 'antigravity', 'resources', 'bin', 'language_server.exe');

function testProfileAuth(envPath, isDefault = false) {
  let detectedUser = null;
  const storagePaths = [
    path.join(envPath, 'AppData', 'Roaming', 'Antigravity', 'app_storage.json'),
    path.join(envPath, 'app_storage.json')
  ];
  if (isDefault) {
    storagePaths.push(path.join(process.env.APPDATA, 'Antigravity', 'app_storage.json'));
  }

  for (const p of storagePaths) {
    if (fs.existsSync(p)) {
      try {
        const content = JSON.parse(fs.readFileSync(p, 'utf-8'));
        if (content['jetski.onboarding.lastLoginUsername']) {
          detectedUser = content['jetski.onboarding.lastLoginUsername'];
          break;
        }
      } catch (err) {
      if (typeof globalThis.logger !== "undefined" && globalThis.logger?.warn) {
        globalThis.logger.warn({
          event: "server.handled_exception",
          file: "test_verify_real",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:test_verify_real]", err);
      }
    }
    }
  }

  console.log('Detected user from storage:', detectedUser);

  // Now test agentapi
  const testEnv = { ...process.env };
  if (!isDefault) {
    testEnv.USERPROFILE = envPath;
    testEnv.APPDATA = path.join(envPath, 'AppData', 'Roaming');
    testEnv.LOCALAPPDATA = path.join(envPath, 'AppData', 'Local');
    testEnv.HOME = envPath;
  }
  testEnv.ANTIGRAVITY_PROJECT_ID = 'outside-of-project';

  let authenticated = false;
  try {
    const out = execFileSync(lsExe, [
      'agentapi', 'new-conversation', '--model=flash', '--title=Verify Auth Check', 'ping'
    ], {
      encoding: 'utf-8',
      timeout: 10000,
      env: testEnv
    });
    const parsed = JSON.parse(out);
    if (parsed?.response?.newConversation?.conversationId) {
      authenticated = true;
      console.log('agentapi authenticated on first attempt, convId:', parsed.response.newConversation.conversationId);
    }
  } catch (err) {
    const msg = err.stdout || err.message || '';
    const match = msg.match(/source project_id "([^"]+)"/);
    if (match && match[1]) {
      console.log('Retrying with source project_id:', match[1]);
      try {
        testEnv.ANTIGRAVITY_PROJECT_ID = match[1];
        const out = execFileSync(lsExe, [
          'agentapi', 'new-conversation', '--model=flash', '--title=Verify Auth Check', 'ping'
        ], {
          encoding: 'utf-8',
          timeout: 10000,
          env: testEnv
        });
        const parsed = JSON.parse(out);
        if (parsed?.response?.newConversation?.conversationId) {
          authenticated = true;
          console.log('agentapi authenticated on second attempt, convId:', parsed.response.newConversation.conversationId);
        }
      } catch (err2) {
        console.log('agentapi failed on second attempt:', err2.message);
      }
    } else {
      console.log('agentapi failed:', msg.slice(0, 150));
    }
  }

  const finalStatus = (detectedUser || authenticated) ? 'READY' : 'WAITING_LOGIN';
  return { finalStatus, detectedUser, authenticated };
}

console.log('--- Testing Default Profile (Account 1) ---');
console.log(testProfileAuth(path.join(process.env.APPDATA, 'Antigravity'), true));

console.log('\n--- Testing test_isolated_probe (Unauthenticated Account) ---');
console.log(testProfileAuth(path.join(os.homedir(), '.ai-dev-hub', 'profiles', 'test_isolated_probe'), false));
