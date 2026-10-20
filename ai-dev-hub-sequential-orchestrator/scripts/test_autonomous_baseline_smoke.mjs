// scripts/test_autonomous_baseline_smoke.mjs
// Validates that a new Autonomous Run reads the reconciled clean baseline (AI_DEV_STABLE_V1)

import { AutonomousSelfImprovementEngine } from '../server/dist/selfImprovementRun.js';
import { execSync } from 'node:child_process';

const expectedHead = execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();

console.log('========================================================================');
console.log('🧪 SMOKE TEST: AUTONOMOUS ENGINE BASELINE RECONCILIATION VALIDATION');
console.log(`Git HEAD Esperado: ${expectedHead}`);
console.log('========================================================================\n');

async function testSmoke() {
  console.log('1. Iniciando Autonomous Run no preset TEST_SHORT...');
  const run = await AutonomousSelfImprovementEngine.startRun({
    preset: 'TEST_SHORT',
    maxExperiments: 1
  });

  console.log(`✓ Run Criado: ID = ${run.id}`);
  console.log(`  - Baseline Commit Lido: ${run.baselineCommit}`);
  console.log(`  - Current Best Commit:  ${run.currentBestCommit}`);
  console.log(`  - Preset:               ${run.preset}`);
  console.log(`  - Status Inicial:       ${run.status}`);

  // Validação estrita
  const oldRejectedShaPrefix = '71ba345e';
  if (run.baselineCommit.startsWith(oldRejectedShaPrefix)) {
    console.error(`❌ FALHA CRÍTICA: O Autonomous Engine ainda leu o commit antigo rejeitado ${run.baselineCommit}!`);
    await AutonomousSelfImprovementEngine.stopRun(run.id, 'Smoke test falhou - commit antigo detectado');
    process.exit(1);
  }

  if (!run.baselineCommit.startsWith(expectedHead.slice(0, 8))) {
    console.error(`❌ FALHA: Baseline Commit ${run.baselineCommit} não corresponde ao HEAD reconciliado ${expectedHead}!`);
    await AutonomousSelfImprovementEngine.stopRun(run.id, 'Smoke test falhou - commit divergente');
    process.exit(1);
  }

  console.log('\n✓ VALIDAÇÃO BEM-SUCEDIDA: O motor autônomo agora lê a nova baseline limpa reconciliada!');
  console.log(`  SHA Confirmado: ${run.baselineCommit}`);

  // Parar o smoke test de forma limpa e segura
  console.log('\n2. Parando smoke test de forma segura...');
  const stoppedRun = AutonomousSelfImprovementEngine.stopRun(run.id, 'Smoke test de validação da nova baseline concluído com sucesso');
  console.log(`✓ Run parado com segurança. Status: ${stoppedRun.status}, Motivo: ${stoppedRun.stopReason}`);
  console.log('\n========================================================================');
  console.log('🎉 SMOKE TEST DO AUTONOMOUS ENGINE CONCLUÍDO COM SUCESSO!');
  console.log('========================================================================\n');
}

testSmoke().catch(err => {
  console.error('Erro no smoke test:', err);
  process.exit(1);
});
