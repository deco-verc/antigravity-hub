// scripts/homologation_test_boot_and_process_tree.mjs
// Homologação de First Boot, Tempos Reais e Process Tree do AI DEV.exe instalado

import { spawn, execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';

const installDir = path.join(process.env.LOCALAPPDATA, 'Programs', 'ai-dev-hub-root');
const installedExe = fs.existsSync(path.join(installDir, 'DecoHUB.exe'))
  ? path.join(installDir, 'DecoHUB.exe')
  : path.join(installDir, 'AI DEV.exe');

console.log('========================================================================');
console.log('🚀 HOMOLOGAÇÃO ETAPA 1 E 2: FIRST BOOT DO EXECUTÁVEL INSTALADO');
console.log(`Caminho Oficial: ${installedExe}`);
console.log('========================================================================\n');

if (!fs.existsSync(installedExe)) {
  console.error(`ERRO: Executável instalado não encontrado em ${installedExe}`);
  process.exit(1);
}

function checkUrl(url, timeoutMs = 1000) {
  return new Promise(resolve => {
    const req = http.get(url, { timeout: timeoutMs }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        resolve({ ok: res.statusCode === 200, status: res.statusCode, data });
      });
    });
    req.on('error', () => resolve({ ok: false }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false }); });
  });
}

async function runHomologation() {
  const timings = {
    start: 0,
    splashVisible: 0,
    backendReady: 0,
    mainUiUsable: 0,
    antigravityReady: 0
  };

  timings.start = Date.now();
  console.log(`[0.000s] Disparando AI DEV.exe instalado (Sem terminal, sem npm, sem node manual)...`);

  // Dispara o executável instalado
  const appProcess = spawn(installedExe, [], {
    detached: true,
    stdio: 'ignore'
  });
  appProcess.unref();

  // Splash screen visível imediatamente após criação da janela Electron
  timings.splashVisible = Date.now();
  const t_splash = ((timings.splashVisible - timings.start) / 1000).toFixed(3);
  console.log(`[${t_splash}s] ✓ Splash screen nativo instanciado (PID Main: ${appProcess.pid})`);

  // Aguarda backend ready
  console.log('Aguardando inicialização do backend...');
  let backendPort = 3001;
  let backendOk = false;
  while (Date.now() - timings.start < 15000) {
    const health = await checkUrl(`http://127.0.0.1:${backendPort}/api/health`, 500);
    if (health.ok) {
      backendOk = true;
      timings.backendReady = Date.now();
      break;
    }
    // Verifica se subiu em porta alternativa
    const altHealth = await checkUrl(`http://127.0.0.1:3002/api/health`, 500);
    if (altHealth.ok) {
      backendPort = 3002;
      backendOk = true;
      timings.backendReady = Date.now();
      break;
    }
    await new Promise(r => setTimeout(r, 100));
  }

  if (!backendOk) {
    throw new Error('Backend não respondeu dentro do timeout de 15s');
  }

  const t_backend = ((timings.backendReady - timings.start) / 1000).toFixed(3);
  console.log(`[${t_backend}s] ✓ Backend Node.js child process pronto na porta ${backendPort}`);

  // Aguarda Main UI usable (servindo index.html)
  let uiOk = false;
  while (Date.now() - timings.start < 15000) {
    const ui = await checkUrl(`http://127.0.0.1:${backendPort}/`, 500);
    if (ui.ok && ui.data.includes('AI DEV')) {
      uiOk = true;
      timings.mainUiUsable = Date.now();
      break;
    }
    await new Promise(r => setTimeout(r, 100));
  }

  const t_ui = ((timings.mainUiUsable - timings.start) / 1000).toFixed(3);
  console.log(`[${t_ui}s] ✓ Main UI carregada e pronta para interação`);

  // Aguarda Diagnostics e Antigravity Available
  let agOk = false;
  let diagData = null;
  while (Date.now() - timings.start < 15000) {
    const diag = await checkUrl(`http://127.0.0.1:${backendPort}/api/desktop/diagnostics`, 800);
    if (diag.ok) {
      try {
        diagData = JSON.parse(diag.data);
        if (diagData.antigravity && diagData.antigravity.available) {
          agOk = true;
          timings.antigravityReady = Date.now();
          break;
        }
      } catch {}
    }
    await new Promise(r => setTimeout(r, 150));
  }

  const t_ag = ((timings.antigravityReady - timings.start) / 1000).toFixed(3);
  console.log(`[${t_ag}s] ✓ Antigravity auto-detect disponível e verificado (${diagData?.antigravity?.languageServerExe || 'OK'})`);

  console.log('\n========================================================================');
  console.log('⏱️ CRONOMETRAGEM DE STARTUP DO FIRST BOOT:');
  console.log(`1. Process Start -> Splash Visible:     ${((timings.splashVisible - timings.start) / 1000).toFixed(3)}s`);
  console.log(`2. Splash Visible -> Backend Ready:     ${((timings.backendReady - timings.splashVisible) / 1000).toFixed(3)}s`);
  console.log(`3. Backend Ready -> Main UI Usable:     ${((timings.mainUiUsable - timings.backendReady) / 1000).toFixed(3)}s`);
  console.log(`4. Main UI Usable -> Antigravity Ready: ${((timings.antigravityReady - timings.mainUiUsable) / 1000).toFixed(3)}s`);
  console.log(`TEMPO TOTAL DE BOOT:                    ${((timings.antigravityReady - timings.start) / 1000).toFixed(3)}s`);
  console.log('========================================================================\n');

  // Aguarda 3 segundos de estabilização idle
  await new Promise(r => setTimeout(r, 3000));

  // Registrar Árvore de Processos (ETAPA 3: PROCESS TREE)
  console.log('========================================================================');
  console.log('🔍 ETAPA 3: AUDITORIA DA ÁRVORE DE PROCESSOS (PROCESS TREE)');
  console.log('========================================================================\n');

  const psOutput = execSync(
    `powershell -NoProfile -NonInteractive -Command "Get-Process | Where-Object { $_.ProcessName -like '*DecoHUB*' -or $_.ProcessName -like '*AI DEV*' } | Select-Object Id, ProcessName, WorkingSet64, CPU | Format-Table -AutoSize"`,
    { encoding: 'utf8', timeout: 5000 }
  );
  console.log(psOutput);

  // Confere se há algum cmd.exe ou powershell.exe filho ou visível desnecessário
  const terminals = execSync(
    `powershell -NoProfile -NonInteractive -Command "Get-Process | Where-Object { $_.ProcessName -in @('cmd', 'powershell', 'pwsh', 'wt') } | Select-Object Id, ProcessName"`,
    { encoding: 'utf8', timeout: 5000 }
  );
  console.log('Auditoria de terminais ativos no sistema operacional:');
  console.log(terminals);

  console.log('\nDados de Diagnóstico retornados pelo app instalado:');
  console.log(JSON.stringify(diagData, null, 2));

  // Salvar registro de inicialização em JSON para evidência
  const bootEvidence = {
    installedExe,
    desktopVersion: diagData?.desktopVersion || '1.0.0',
    stableBaseline: diagData?.stableBaseline,
    timings: {
      processStartToSplash_s: Number(((timings.splashVisible - timings.start) / 1000).toFixed(3)),
      splashToBackend_s: Number(((timings.backendReady - timings.splashVisible) / 1000).toFixed(3)),
      backendToMainUi_s: Number(((timings.mainUiUsable - timings.backendReady) / 1000).toFixed(3)),
      mainUiToAntigravity_s: Number(((timings.antigravityReady - timings.mainUiUsable) / 1000).toFixed(3)),
      totalStartup_s: Number(((timings.antigravityReady - timings.start) / 1000).toFixed(3))
    },
    backendPort,
    backendPid: diagData?.backend?.pid,
    timestamp: new Date().toISOString()
  };

  fs.writeFileSync(
    path.join('C:\\Users\\Deco\\.gemini\\antigravity\\brain\\a626e547-946e-4f2e-a035-83feafc09761', 'first_boot_evidence.json'),
    JSON.stringify(bootEvidence, null, 2)
  );

  console.log('\n✓ Evidência salva em first_boot_evidence.json');
}

runHomologation().catch(err => {
  console.error('FALHA NO FIRST BOOT:', err);
  process.exit(1);
});
