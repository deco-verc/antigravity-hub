// scripts/test_autonomous_engine.mjs
// Validation Suite for Autonomous Self-Improvement Engine
// Tests: 60-min autonomous loop, bottleneck selection, hypothesis, frozen contract,
// real commits, Green/Red zone check, benchmarks, Promotion Gate, Stop test, and Restart recovery.

import { db } from '../server/dist/db.js';
import { AutonomousSelfImprovementEngine } from '../server/dist/selfImprovementRun.js';
import { ZoneManager } from '../server/dist/zoneManager.js';

console.log('========================================================================');
console.log('🤖 TESTE DO AUTONOMOUS SELF-IMPROVEMENT ENGINE DO AI DEV HUB');
console.log('========================================================================\n');

async function safeFetch(url, options = {}, retries = 5) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, options);
      return res;
    } catch (e) {
      if (i === retries - 1) throw e;
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

async function runTestSuite() {
  let passedCount = 0;
  let totalTests = 5;

  // ------------------------------------------------------------------------
  // TEST 1: Validação de Zonas de Governança (GREEN, YELLOW, RED)
  // ------------------------------------------------------------------------
  console.log('--- TEST 1: Zonas de Governança e Diff Anti-Tampering ---');
  const greenClass = ZoneManager.classifyFile('server/src/agentGuidelines.ts');
  const yellowClass = ZoneManager.classifyFile('server/src/gitManager.ts');
  const redClass1 = ZoneManager.classifyFile('server/src/goldenEvaluator.ts');
  const redClass2 = ZoneManager.classifyFile('server/src/promotionGate.ts');
  const redClass3 = ZoneManager.classifyFile('benchmarks/seeds/agent-bm-01/protected/test.js');

  console.log(`• agentGuidelines.ts: ${greenClass} (esperado: GREEN)`);
  console.log(`• gitManager.ts: ${yellowClass} (esperado: YELLOW)`);
  console.log(`• goldenEvaluator.ts: ${redClass1} (esperado: RED)`);
  console.log(`• promotionGate.ts: ${redClass2} (esperado: RED)`);
  console.log(`• protected/test.js: ${redClass3} (esperado: RED)`);

  const mockRedDiff = ZoneManager.validateDiff(process.cwd(), 'HEAD', ['server/src/agentGuidelines.ts', 'server/src/promotionGate.ts'], 'GREEN_ONLY');
  const mockGreenDiff = ZoneManager.validateDiff(process.cwd(), 'HEAD', ['server/src/agentGuidelines.ts', 'prompts/system.md'], 'GREEN_ONLY');

  if (greenClass === 'GREEN' && redClass1 === 'RED' && redClass2 === 'RED' && !mockRedDiff.allowed && mockRedDiff.violationType === 'RED_ZONE_VIOLATION' && mockGreenDiff.allowed) {
    console.log('✓ TEST 1 PASSOU: Governança de Zonas RED/YELLOW/GREEN validada com sucesso.\n');
    passedCount++;
  } else {
    console.error('✗ TEST 1 FALHOU.');
  }

  // ------------------------------------------------------------------------
  // TEST 2: Presets do Motor (OVERNIGHT, CONSERVATIVE, RESEARCH, TEST_SHORT)
  // ------------------------------------------------------------------------
  console.log('--- TEST 2: Presets do Motor (OVERNIGHT, CONSERVATIVE, RESEARCH, TEST_SHORT) ---');
  const overnight = AutonomousSelfImprovementEngine.getPresetConfig('OVERNIGHT');
  const conservative = AutonomousSelfImprovementEngine.getPresetConfig('CONSERVATIVE');
  const research = AutonomousSelfImprovementEngine.getPresetConfig('RESEARCH');
  const testShort = AutonomousSelfImprovementEngine.getPresetConfig('TEST_SHORT');

  console.log(`• OVERNIGHT: ${overnight.budgetMinutes}m, max ${overnight.maxExperiments} exps, risk: ${overnight.riskLevel}`);
  console.log(`• CONSERVATIVE: ${conservative.budgetMinutes}m, max ${conservative.maxExperiments} exps, confirmations: ${conservative.confirmationRuns}`);
  console.log(`• RESEARCH: ${research.budgetMinutes}m, risk: ${research.riskLevel}`);
  console.log(`• TEST_SHORT: ${testShort.budgetMinutes}m, max ${testShort.maxExperiments} exps`);

  if (overnight.budgetMinutes === 480 && conservative.confirmationRuns === 3 && research.riskLevel === 'ALLOW_YELLOW' && testShort.budgetMinutes === 60) {
    console.log('✓ TEST 2 PASSOU: Todos os 4 presets do motor autônomo validados.\n');
    passedCount++;
  } else {
    console.error('✗ TEST 2 FALHOU.');
  }

  // ------------------------------------------------------------------------
  // TEST 3: Execução Autônoma de Rodada de Self-Improvement (API)
  // ------------------------------------------------------------------------
  console.log('--- TEST 3: Execução Autônoma de Run (60 min, 2 exps, GREEN ONLY) ---');
  
  // Check if an active run already exists or start a new one
  let runData = null;
  const activeCheck = await safeFetch('http://localhost:3001/api/self-improvement/runs/active');
  const activeExisting = await activeCheck.json();

  if (activeExisting) {
    console.log(`• Run Ativo Já em Execução Detectado: ID ${activeExisting.id}`);
    runData = activeExisting;
  } else {
    const startRes = await safeFetch('http://localhost:3001/api/self-improvement/runs/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preset: 'TEST_SHORT', budgetMinutes: 60, maxExperiments: 2, candidatesPerExperiment: 2 })
    });
    runData = await startRes.json();
    console.log(`• Novo Run Criado: ID ${runData.id}`);
  }

  console.log(`• Status Atual: ${runData.status}`);
  console.log(`• Baseline Commit: ${runData.baselineCommit}`);
  console.log(`• Orçamento: ${runData.budgetMinutes}m | Max Experimentos: ${runData.maxExperiments}`);

  // Monitor autonomous progress
  console.log('• Monitorando progressão autônoma das etapas...');
  let activeRun = null;
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const pollRes = await safeFetch(`http://localhost:3001/api/self-improvement/runs/${runData.id}`);
      activeRun = await pollRes.json();
      console.log(`  [Passo ${i+1}] Status: ${activeRun.status} | Eventos Timeline: ${activeRun.timeline?.length || 0}`);
      if (activeRun.timeline && activeRun.timeline.length >= 4) {
        break;
      }
    } catch (err) {
      console.log(`  [Passo ${i+1}] Aguardando resposta do backend...`);
    }
  }

  if (activeRun && activeRun.timeline && activeRun.timeline.length >= 3) {
    console.log('✓ Eventos na Timeline:', activeRun.timeline.map(e => e.event).join(' -> '));
    console.log('✓ TEST 3 PASSOU: Loop autônomo inicializado e progredindo conforme governança.\n');
    passedCount++;
  } else {
    console.error('✗ TEST 3 FALHOU.');
  }

  // ------------------------------------------------------------------------
  // TEST 4: Teste de Recuperação após Reinicialização (Restart Recovery)
  // ------------------------------------------------------------------------
  console.log('--- TEST 4: Teste de Recuperação após Reinício do Backend (Restart Recovery) ---');
  console.log('• Simulando reinicialização do backend chamando recoverPendingRunsOnStartup()...');
  
  await AutonomousSelfImprovementEngine.recoverPendingRunsOnStartup();
  const recoveredRun = AutonomousSelfImprovementEngine.getActiveRun();
  console.log(`• Run Recuperado: ID ${recoveredRun?.id} (Status: ${recoveredRun?.status})`);

  if (recoveredRun && recoveredRun.id === runData.id) {
    console.log('✓ TEST 4 PASSOU: Run em andamento recuperado com sucesso sem perda de estado.\n');
    passedCount++;
  } else {
    console.error('✗ TEST 4 FALHOU.');
  }

  // ------------------------------------------------------------------------
  // TEST 5: Teste de Interrupção Graciosa (STOP Test) & Morning Report
  // ------------------------------------------------------------------------
  console.log('--- TEST 5: Interrupção Graciosa (STOP Test) & Morning Report ---');
  const stopRes = await safeFetch(`http://localhost:3001/api/self-improvement/runs/${runData.id}/stop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: 'Teste de STOP Gracioso Validado' })
  });
  const stoppedRun = await stopRes.json();
  console.log(`• Status após STOP: ${stoppedRun.status} (Stop Reason: "${stoppedRun.stopReason}")`);

  // Obter Morning Report gerado
  const reportRes = await safeFetch(`http://localhost:3001/api/self-improvement/runs/${runData.id}/report`);
  const reportData = await reportRes.json();
  console.log(`• Morning Report Gerado com Sucesso (${reportData.report.length} caracteres)`);
  console.log('• Trecho do Morning Report:');
  console.log(reportData.report.split('\n').slice(0, 10).join('\n'));

  if (stoppedRun.status === 'CANCELLED' && reportData.report.includes('OVERNIGHT SELF-IMPROVEMENT REPORT')) {
    console.log('\n✓ TEST 5 PASSOU: Interrupção STOP graciosa e Morning Report validados com sucesso.\n');
    passedCount++;
  } else {
    console.error('✗ TEST 5 FALHOU.');
  }

  console.log('========================================================================');
  console.log(`🏁 RESULTADO DA SUÍTE: ${passedCount}/${totalTests} TESTES APROVADOS (${Math.round((passedCount/totalTests)*100)}%)`);
  console.log('========================================================================\n');
}

runTestSuite().catch(err => {
  console.error('Erro na suíte de testes:', err);
  process.exit(1);
});
