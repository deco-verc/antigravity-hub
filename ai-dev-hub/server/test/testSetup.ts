/**
 * Test Environment Setup, Database Isolation & Fail-Closed Guard
 * 
 * 1. Ensures tests NEVER touch or pollute production ~/.ai-dev-hub/hub.db.
 * 2. Enforces FAIL-CLOSED offline mode: no real Language Server / Antigravity calls allowed.
 * 3. Installs a deterministic Fake/Mock AgentApiGateway by default for all test suites.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
// 1. Force offline mode and disable live agentapi
process.env.DECOHUB_OFFLINE_MODE = 'true';
process.env.DECOHUB_ALLOW_LIVE_AGENTAPI = 'false';

// 2. Isolate SQLite database in temporary folder BEFORE any db module imports
{
  const isolatedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-isolated-test-hub-'));
  process.env.AI_DEV_HUB_DATA_DIR = isolatedDir;
  
  // Register cleanup on process exit
  process.on('exit', () => {
    try {
      if (fs.existsSync(isolatedDir)) {
        fs.rmSync(isolatedDir, { recursive: true, force: true });
      }
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "testSetup",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:testSetup]", err);
      }
    }
  });
}

// Refuse physical agent processes even if a future provider bypasses the gateway.
for (const name of ['execFileSync', 'execFile', 'spawn', 'spawnSync'] as const) {
  const original: any = childProcess[name];
  (childProcess as any)[name] = (file: any, ...args: any[]) => {
    if (/language_server|antigravity\.exe/i.test(String(file)) || (Array.isArray(args[0]) && args[0].includes('agentapi'))) {
      throw new Error(`OFFLINE_PROCESS_GUARD: chamada física negada (${name}).`);
    }
    return original(file, ...args);
  };
}
syncBuiltinESMExports();

// 3. Import AgentApiGateway synchronously after env is set
const { AgentApiGateway } = require('../src/agentApiGateway.js');
const fixtureProvider = AgentApiGateway.installDefaultMock();
const defaultTestResponseProvider = (_id: string, mode: string) => {
  if (mode === 'REVIEW') {
    return JSON.stringify({ verdict: 'APPROVED', feedback: 'Revisão simulada explícita no fixture de teste', qualityScore: 9 });
  }
  return JSON.stringify([
    { title: 'Configurar estrutura e dependências base', description: 'Inicializar arquivos essenciais e ambiente', milestone: 'M1', criteria: ['Estrutura e dependências configuradas'], dependencies: [], orderIndex: 1 },
    { title: 'Implementar lógica principal do módulo', description: 'Construir código fonte e utilitários', milestone: 'M1', criteria: ['Módulo implementado de acordo com requisitos'], dependencies: ['Configurar estrutura e dependências base'], orderIndex: 2 },
    { title: 'Desenvolver interface visual e validação E2E', description: 'Implementar interface de usuário e validações', milestone: 'M1', criteria: ['Interface visual e validações completas'], dependencies: ['Implementar lógica principal do módulo'], orderIndex: 3 }
  ]);
};
(defaultTestResponseProvider as any).isDefaultTestFixture = true;
fixtureProvider.responseProvider = defaultTestResponseProvider;

