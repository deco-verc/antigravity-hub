// scripts/test_desktop_reliability_suite.mjs
// Teste E2E de Confiabilidade da Camada Desktop do AI DEV HUB

import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import net from 'node:net';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { ServiceManager } = require('../desktop/serviceManager.cjs');
const { AntigravityDiscovery } = require('../desktop/antigravityDiscovery.cjs');
const { AppDataPaths } = require('../desktop/appDataPaths.cjs');
const config = require('../desktop/config.cjs');
const { runCheck } = require('../desktop/healthCheck.cjs');

console.log('========================================================================');
console.log('🧪 BATERIA DE TESTES DE CONFIABILIDADE DO AI DEV DESKTOP (FASE 8)');
console.log('========================================================================\n');

async function test1_antigravity_discovery() {
  console.log('--- TESTE 1: Antigravity Dynamic Discovery ---');
  const res = AntigravityDiscovery.discover();
  console.log(`[Discovery] Disponível: ${res.available}`);
  console.log(`[Discovery] Status: ${res.status}`);
  console.log(`[Discovery] Origem: ${res.source}`);
  console.log(`[Discovery] Executável: ${res.languageServerExe || 'Nenhum'}`);
  console.log(`[Discovery] Brain Dir: ${res.brainDir || 'Nenhum'}`);

  assert.strictEqual(res.available, true, 'Antigravity deve ser encontrado no ambiente');
  assert.ok(res.languageServerExe, 'languageServerExe deve estar definido');
  assert.ok(fs.existsSync(res.languageServerExe), 'languageServerExe deve existir no disco');
  assert.ok(res.brainDir && fs.existsSync(res.brainDir), 'Brain dir deve existir no disco');
  assert.ok(!res.languageServerExe.includes('${username}'), 'Não deve conter template não resolvido');
  console.log('✓ TESTE 1 APROVADO: Antigravity detectado dinamicamente com sucesso.\n');
}

async function test2_app_data_paths() {
  console.log('--- TESTE 2: AppData Paths & Diretórios Persistentes ---');
  const paths = AppDataPaths.ensureDirectories();
  console.log(`[AppData] Base: ${paths.baseDir}`);
  console.log(`[AppData] Data: ${paths.dataDir}`);
  console.log(`[AppData] Logs: ${paths.logsDir}`);
  console.log(`[AppData] Database: ${paths.dbPath}`);

  assert.ok(fs.existsSync(paths.baseDir), 'baseDir deve existir');
  assert.ok(fs.existsSync(paths.dataDir), 'dataDir deve existir');
  assert.ok(fs.existsSync(paths.logsDir), 'logsDir deve existir');
  assert.ok(fs.existsSync(paths.crashReportsDir), 'crashReportsDir deve existir');
  console.log('✓ TESTE 2 APROVADO: Estrutura de AppData verificada e garantida.\n');
}

async function test3_config_persistence() {
  console.log('--- TESTE 3: State Restoration & Config Persistence ---');
  const testBounds = { x: 150, y: 120, width: 1400, height: 850, isMaximized: false };
  config.set('windowBounds', testBounds);
  config.set('lastProject', 'AI DEV HUB');
  config.set('lastAccount', 'Google Pro 1');
  config.set('minimizeToTray', true);

  const restoredBounds = config.get('windowBounds');
  assert.deepStrictEqual(restoredBounds, testBounds, 'Bounds salvos devem ser iguais aos recuperados');
  assert.strictEqual(config.get('lastProject'), 'AI DEV HUB', 'lastProject restaurado');
  assert.strictEqual(config.get('lastAccount'), 'Google Pro 1', 'lastAccount restaurado');
  assert.strictEqual(config.get('minimizeToTray'), true, 'minimizeToTray restaurado');
  console.log('✓ TESTE 3 APROVADO: Configuração e estado da janela restaurados com precisão.\n');
}

async function test4_port_allocation_and_attach() {
  console.log('--- TESTE 4: Port Detection & Dynamic Allocation ---');
  const sm = new ServiceManager({ backendPort: 3001 });

  // Testa se a porta 3001 está aberta (backend já rodando)
  const is3001Taken = await sm.isPortTaken(3001);
  console.log(`[PortCheck] Porta 3001 ocupada: ${is3001Taken}`);

  // Testa findAvailablePort
  const nextPort = await sm.findAvailablePort(3001);
  console.log(`[PortCheck] Próxima porta livre a partir de 3001: ${nextPort}`);
  assert.ok(nextPort >= 3001, 'Próxima porta livre válida');

  // Testa checkHealth no backend existente
  const isHealthy = await sm.checkHealth(3001);
  console.log(`[PortCheck] Backend 3001 responde health check: ${isHealthy}`);
  assert.strictEqual(isHealthy, true, 'Backend na porta 3001 deve estar respondendo');
  console.log('✓ TESTE 4 APROVADO: Detecção de portas e health check validados.\n');
}

async function test5_diagnostics_endpoint() {
  console.log('--- TESTE 5: Diagnostics & System Metrics Endpoint ---');
  const response = await fetch('http://127.0.0.1:3001/api/desktop/diagnostics');
  assert.strictEqual(response.status, 200, 'HTTP 200 esperado em /api/desktop/diagnostics');
  const data = await response.json();

  console.log(`[Diagnostics] Desktop Version: ${data.desktopVersion}`);
  console.log(`[Diagnostics] Stable Baseline: ${data.stableBaseline.commit.slice(0, 8)} (${data.stableBaseline.versionLabel})`);
  console.log(`[Diagnostics] Backend Port: ${data.backend.port} (PID: ${data.backend.pid})`);
  console.log(`[Diagnostics] Antigravity Status: ${data.antigravity.available ? 'AVAILABLE' : 'UNAVAILABLE'}`);
  console.log(`[Diagnostics] Accounts: ${data.accounts.total} (Ativa: ${data.accounts.active})`);
  console.log(`[Diagnostics] Workers: ${data.workers.total}`);

  assert.ok(data.desktopVersion, 'desktopVersion presente');
  assert.ok(data.stableBaseline && data.stableBaseline.commit, 'stableBaseline dinâmico presente');
  assert.strictEqual(data.backend.port, 3001, 'backend port correto');
  assert.ok(data.system.totalMemoryMB > 0, 'Memória do sistema reportada');
  console.log('✓ TESTE 5 APROVADO: Endpoint de diagnósticos responde métricas completas.\n');
}

async function test6_crash_recovery_and_supervision() {
  console.log('--- TESTE 6: Crash Recovery do Backend & Auto-Restart ---');
  // Cria um ServiceManager isolado em porta temporária (ex: 3045)
  const tempPort = 3045;
  const isolatedSM = new ServiceManager({ backendPort: tempPort });

  console.log(`Iniciando instância isolada para teste de crash na porta ${tempPort}...`);
  const startRes = await isolatedSM.start();
  console.log(`[RecoveryTest] Instância isolada iniciada na porta ${startRes.port} (PID: ${isolatedSM.backendPid})`);
  assert.ok(isolatedSM.serverProcess, 'Processo filho deve estar ativo');
  const initialPid = isolatedSM.backendPid;

  let crashedEmitted = false;
  let recoveredEmitted = false;

  isolatedSM.on('crashed', (info) => {
    crashedEmitted = true;
    console.log(`[RecoveryTest] Evento CRASHED recebido com sucesso (code: ${info.code}, signal: ${info.signal})`);
  });

  isolatedSM.on('recovered', (info) => {
    recoveredEmitted = true;
    console.log(`[RecoveryTest] Evento RECOVERED recebido com sucesso na porta ${info.port}`);
  });

  // Simula crash matando o processo filho
  console.log(`Matando propositalmente o PID ${initialPid} para testar resiliência...`);
  isolatedSM.serverProcess.kill('SIGKILL');

  // Aguarda recuperação
  console.log('Aguardando supervisor detectar a queda e reiniciar o backend...');
  const startWait = Date.now();
  while (Date.now() - startWait < 10000) {
    if (crashedEmitted && recoveredEmitted) break;
    await new Promise(r => setTimeout(r, 400));
  }

  assert.strictEqual(crashedEmitted, true, 'Evento crashed deve ter sido emitido');
  assert.strictEqual(recoveredEmitted, true, 'Evento recovered deve ter sido emitido');
  assert.notStrictEqual(isolatedSM.backendPid, initialPid, 'Novo PID deve ter sido alocado');

  const healthyAfterRecovery = await isolatedSM.checkHealth(tempPort);
  console.log(`[RecoveryTest] Backend saudável após recuperação: ${healthyAfterRecovery} (Novo PID: ${isolatedSM.backendPid})`);
  assert.strictEqual(healthyAfterRecovery, true, 'Backend deve responder health check após auto-restart');

  // Limpa processo isolado
  console.log('Encerrando processo isolado de teste...');
  await isolatedSM.stop();
  console.log('✓ TESTE 6 APROVADO: Crash recovery automático validado com sucesso.\n');
}

async function test7_safe_shutdown_query_active_work() {
  console.log('--- TESTE 7: Safe Shutdown & Active Work Guard ---');
  const sm = new ServiceManager({ backendPort: 3001 });
  const activeWork = await sm.queryActiveWork();
  console.log(`[SafeShutdown] Trabalho ativo em execução: ${activeWork.hasActiveWork}`);
  assert.strictEqual(typeof activeWork.hasActiveWork, 'boolean', 'hasActiveWork deve ser booleano');
  console.log('✓ TESTE 7 APROVADO: Guard de trabalho ativo funcionando conforme esperado.\n');
}

async function runAll() {
  try {
    await test1_antigravity_discovery();
    await test2_app_data_paths();
    await test3_config_persistence();
    await test4_port_allocation_and_attach();
    await test5_diagnostics_endpoint();
    await test6_crash_recovery_and_supervision();
    await test7_safe_shutdown_query_active_work();

    console.log('========================================================================');
    console.log('🎉 TODOS OS 7 TESTES DA BATERIA DE CONFIABILIDADE FORAM APROVADOS!');
    console.log('========================================================================');
  } catch (err) {
    console.error('❌ FALHA NA BATERIA DE CONFIABILIDADE:', err);
    process.exit(1);
  }
}

runAll();
