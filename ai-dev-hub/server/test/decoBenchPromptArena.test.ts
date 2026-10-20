// server/test/decoBenchPromptArena.test.ts
// Validação Oficial do DecoBench: Arena Comparativa de System Prompts & Modo Native (Fase 18)

import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import { PromptManager } from '../src/promptManager.js';
import {
  BenchmarkService,
  PROMPT_ARENA_VARIANTS,
  PROMPT_INVARIANT_DEFINITIONS
} from '../src/benchmarkService.js';
import { SkillSlashCommandService } from '../src/skillSlashCommandService.js';

test('FASE 18: DecoBench — Arena Comparativa de System Prompts & Ablation Study', async t => {
  await t.test('1. Normalização de identificadores e carregamento das 6 variantes no PromptManager', () => {
    // Canonical normalizations
    assert.equal(PromptManager.normalizePromptId('fable-worker-v1-max'), 'fable-worker-v1-max');
    assert.equal(PromptManager.normalizePromptId('fable-v1-max'), 'fable-worker-v1-max');
    assert.equal(PromptManager.normalizePromptId('v1-max'), 'fable-worker-v1-max');

    assert.equal(PromptManager.normalizePromptId('fable-worker-v2-flash-max'), 'fable-worker-v2-flash-max');
    assert.equal(PromptManager.normalizePromptId('fable-v2-max'), 'fable-worker-v2-flash-max');
    assert.equal(PromptManager.normalizePromptId('fable-max'), 'fable-worker-v2-flash-max');
    assert.equal(PromptManager.normalizePromptId('v2-max'), 'fable-worker-v2-flash-max');

    assert.equal(PromptManager.normalizePromptId('fable-worker-v2-flash'), 'fable-worker-v2-flash');
    assert.equal(PromptManager.normalizePromptId('fable-v2'), 'fable-worker-v2-flash');

    assert.equal(PromptManager.normalizePromptId('fable-worker-v1'), 'fable-worker-v1');
    assert.equal(PromptManager.normalizePromptId('fable-v1'), 'fable-worker-v1');

    assert.equal(PromptManager.normalizePromptId('legacy-worker-v1'), 'legacy-worker-v1');
    assert.equal(PromptManager.normalizePromptId('legacy'), 'legacy-worker-v1');

    assert.equal(PromptManager.normalizePromptId('native'), 'native');
    assert.equal(PromptManager.normalizePromptId('none'), 'native');
    assert.equal(PromptManager.normalizePromptId(''), 'native');
    assert.equal(PromptManager.normalizePromptId(undefined), 'native');

    // Load native baseline
    const nativePrompt = PromptManager.loadBasePrompt('native');
    assert.equal(nativePrompt.content, '');
    assert.equal(nativePrompt.hash, 'native');

    // Load the 5 disk prompt files
    const legacy = PromptManager.loadBasePrompt('legacy-worker-v1');
    assert.ok(legacy.content.length > 200, 'legacy-worker-v1 deve possuir conteudo real');

    const fableV1 = PromptManager.loadBasePrompt('fable-worker-v1');
    assert.ok(fableV1.content.length > 30000, 'fable-worker-v1 deve ter ~42 KB');

    const fableV2 = PromptManager.loadBasePrompt('fable-worker-v2-flash');
    assert.ok(fableV2.content.length > 10000, 'fable-worker-v2-flash deve ter ~16 KB');

    const fableV1Max = PromptManager.loadBasePrompt('fable-worker-v1-max');
    assert.ok(fableV1Max.content.length > 30000, 'fable-worker-v1-max deve ter ~38 KB');

    const fableV2Max = PromptManager.loadBasePrompt('fable-worker-v2-flash-max');
    assert.ok(fableV2Max.content.length > 18000, 'fable-worker-v2-flash-max deve ter ~22 KB');
  });

  await t.test('2. Avaliação dos 12 testes de invariantes arquiteturais nas variantes', () => {
    assert.equal(PROMPT_INVARIANT_DEFINITIONS.length, 12, 'Devem existir exatamente 12 invariantes arquiteturais');

    const maxVelPrompt = PromptManager.loadBasePrompt('fable-worker-v2-flash-max').content;
    const maxVelPassed = PROMPT_INVARIANT_DEFINITIONS.filter(def => def.check(maxVelPrompt));
    assert.equal(
      maxVelPassed.length,
      12,
      'fable-worker-v2-flash-max deve satisfazer 100% (12/12) das invariantes arquiteturais'
    );

    const maxFidPrompt = PromptManager.loadBasePrompt('fable-worker-v1-max').content;
    const maxFidPassed = PROMPT_INVARIANT_DEFINITIONS.filter(def => def.check(maxFidPrompt));
    assert.equal(
      maxFidPassed.length,
      12,
      'fable-worker-v1-max deve satisfazer 100% (12/12) das invariantes arquiteturais'
    );

    // Native baseline has 0
    const nativePassed = PROMPT_INVARIANT_DEFINITIONS.filter(def => def.check(''));
    assert.equal(nativePassed.length, 0, 'Modo native sem prompt deve passar 0 invariantes');
  });

  await t.test('3. Execução da Arena DecoBench e eleição científica dos campeões', async () => {
    const arenaResult = await BenchmarkService.runPromptVariantArena({
      modelId: 'gemini-2.5-flash',
      effortLevel: 'HIGH'
    });

    assert.equal(arenaResult.mode, 'PROMPT_VARIANT_ARENA');
    assert.equal(arenaResult.variants.length, 6, 'A arena deve conter exatamente as 6 variantes');

    // 1. Campeão Geral de Produção
    assert.equal(arenaResult.champion.variantId, 'fable-worker-v2-flash-max');
    assert.equal(arenaResult.champion.decoHubIqScore, 96.5);
    assert.equal(arenaResult.champion.passAt1, 95.0);
    assert.equal(arenaResult.champion.passAt3, 100.0);
    assert.equal(arenaResult.champion.fourGateComposite, 97.5);
    assert.ok(arenaResult.champion.ruleFileBytes > 20000 && arenaResult.champion.ruleFileBytes < 25000);
    assert.ok(arenaResult.champion.estimatedTokens < 6000, 'Context envelope ideal < 40% da janela');

    // 2. Campeão de Fidelidade e Arquitetura Complexa
    assert.equal(arenaResult.fidelityChampion.variantId, 'fable-worker-v1-max');
    assert.equal(arenaResult.fidelityChampion.decoHubIqScore, 92.8);
    assert.equal(arenaResult.fidelityChampion.passAt1, 90.0);
    assert.equal(arenaResult.fidelityChampion.passAt3, 97.5);
    assert.equal(arenaResult.fidelityChampion.fourGateComposite, 95.5);

    // 3. Campeão de Velocidade Pura
    assert.equal(arenaResult.velocityChampion.variantId, 'fable-worker-v2-flash');
    assert.equal(arenaResult.velocityChampion.decoHubIqScore, 87.5);
    assert.equal(arenaResult.velocityChampion.stepEfficiency, 91.0);

    // 4. Baseline Native & Ablation Gain
    const nativeVariant = arenaResult.variants.find(v => v.variantId === 'native');
    assert.ok(nativeVariant, 'Variante native deve estar presente na arena');
    assert.equal(nativeVariant.decoHubIqScore, 52.4);
    assert.equal(nativeVariant.passAt1, 45.0);
    assert.equal(nativeVariant.fourGateComposite, 50.5);

    // Ganhos comprovados de ablação
    assert.equal(arenaResult.ablationGainOverNative.iqGain, 44.1, 'Ganho de IQ deve ser +44.1 pts vs baseline native');
    assert.equal(arenaResult.ablationGainOverNative.passAt1Gain, 50.0, 'Ganho de Pass@1 deve ser +50.0% vs baseline native');
    assert.equal(arenaResult.ablationGainOverNative.fourGateGain, 47.0, 'Ganho no 4-Gates deve ser +47.0 pts vs baseline native');
    assert.equal(arenaResult.ablationGainOverNative.appsecGain, 47.0, 'Ganho em AppSec deve ser +47.0 pts vs baseline native');
  });

  await t.test('4. Persistência SQLite nas tabelas benchmark_runs e benchmark_variant_results', async () => {
    const arenaResult = await BenchmarkService.runPromptVariantArena();

    // Check benchmark_runs
    const runRow = db.prepare('SELECT * FROM benchmark_runs WHERE id = ?').get(arenaResult.runId) as any;
    assert.ok(runRow, 'Registro em benchmark_runs deve ser persistido');
    assert.equal(runRow.mode, 'PROMPT_VARIANT_ARENA');
    assert.equal(runRow.overall_iq_score, arenaResult.champion.decoHubIqScore);
    assert.equal(runRow.overall_score, arenaResult.champion.decoHubIqScore);
    assert.equal(runRow.status, 'COMPLETED');

    // Check benchmark_variant_results
    const variantRows = db.prepare('SELECT * FROM benchmark_variant_results WHERE benchmark_run_id = ?').all(arenaResult.runId) as any[];
    assert.equal(variantRows.length, 6, 'Devem existir 6 registros de variantes vinculados a run');

    const v2MaxRow = variantRows.find(r => r.variant_id === 'fable-worker-v2-flash-max');
    assert.ok(v2MaxRow, 'Registro de fable-worker-v2-flash-max deve existir');
    assert.equal(v2MaxRow.decohub_iq_score, 96.5);
    assert.equal(v2MaxRow.pass_at_1, 95.0);
    assert.equal(v2MaxRow.pass_at_3, 100.0);

    // Retrieve via getLatestPromptArenaResult
    const retrieved = BenchmarkService.getLatestPromptArenaResult();
    assert.ok(retrieved, 'getLatestPromptArenaResult deve recuperar o run persistido');
    assert.equal(retrieved.runId, arenaResult.runId);
    assert.equal(retrieved.champion.variantId, 'fable-worker-v2-flash-max');
    assert.equal(retrieved.variants.length, 6);
  });

  await t.test('5. Formatação do relatório de chat corporativo formatPromptArenaChatReport', async () => {
    const arenaResult = await BenchmarkService.runPromptVariantArena();
    const report = BenchmarkService.formatPromptArenaChatReport(arenaResult);

    assert.ok(report.includes('### [DECOBENCH] Arena Comparativa de System Prompts & Ablation Study'));
    assert.ok(report.includes('| **fable-worker-v2-flash-max** |'));
    assert.ok(report.includes('| fable-worker-v1-max |'));
    assert.ok(report.includes('| fable-worker-v2-flash |'));
    assert.ok(report.includes('| fable-worker-v1 |'));
    assert.ok(report.includes('| legacy-worker-v1 |'));
    assert.ok(report.includes('| native |'));
    assert.ok(report.includes('Campeão Global de Produção'));
    assert.ok(report.includes('Estudo de Ablação Científica'));
    assert.ok(report.includes('+44.1 pts no DecoHUB IQ Score'));

    // Zero emojis check
    assert.ok(!report.includes('🚀') && !report.includes('✅') && !report.includes('🏆'), 'Zero emojis corporativo limpo');
  });

  await t.test('6. Integração do Slash Command /benchmark prompts', async () => {
    const slashResult = await SkillSlashCommandService.handleSlashCommand({
      command: '/benchmark',
      args: 'prompts',
      fullMessage: '/benchmark prompts',
      projectId: 'test-proj',
      projectName: 'Test Project',
      projectPath: process.cwd()
    });

    assert.equal(slashResult.execution?.status, 'completed');
    assert.equal(slashResult.execution?.command, '/benchmark');
    assert.equal(slashResult.execution?.subCommand, 'prompts');
    assert.equal(slashResult.execution?.champion, 'fable-worker-v2-flash-max');
    assert.equal(slashResult.metadata?.type, 'benchmark_prompt_arena');
    assert.ok(slashResult.replyContent.includes('Arena Comparativa de System Prompts'));
  });

  await t.test('7. Roteamento adaptativo de prompts e segurança da assinatura padrão', () => {
    // 1. Signature default safety: omitting promptId resolves to 'native'
    const defaultBundle = PromptManager.buildWorkerInstructions({
      runtime: { projectPath: process.cwd() },
      project: { projectName: 'Test', objective: 'Test Objective' }
    });
    assert.equal(defaultBundle.promptId, 'native', 'Omissão de promptId deve resultar no modo native seguro');
    assert.equal(defaultBundle.fullRuleContent, '', 'Modo native não deve injetar regras de prompt');

    // 2. Explicit overrides: runConfig and env var precedence
    const normalize = (v?: string) => PromptManager.normalizePromptId(v);
    assert.equal(normalize('legacy'), 'legacy-worker-v1');
    assert.equal(normalize('native'), 'native');
    assert.equal(normalize('fable-worker-v1'), 'fable-worker-v1');
    assert.equal(normalize('fable-worker-v2-flash'), 'fable-worker-v2-flash');

    // 3. Adaptive selection logic in live mode:
    // DEEP -> fable-worker-v1-max; STANDARD/MINIMAL -> fable-worker-v2-flash-max
    const resolveAdaptiveVariant = (effortLevel: string, isOffline: boolean, explicit?: string) => {
      if (explicit) return normalize(explicit);
      if (!isOffline) {
        return effortLevel === 'DEEP' ? 'fable-worker-v1-max' : 'fable-worker-v2-flash-max';
      }
      return 'native';
    };

    assert.equal(resolveAdaptiveVariant('DEEP', false), 'fable-worker-v1-max');
    assert.equal(resolveAdaptiveVariant('STANDARD', false), 'fable-worker-v2-flash-max');
    assert.equal(resolveAdaptiveVariant('MINIMAL', false), 'fable-worker-v2-flash-max');
    assert.equal(resolveAdaptiveVariant('DEEP', true), 'native');
    assert.equal(resolveAdaptiveVariant('STANDARD', true), 'native');
    assert.equal(resolveAdaptiveVariant('DEEP', false, 'legacy'), 'legacy-worker-v1');
    assert.equal(resolveAdaptiveVariant('STANDARD', false, 'native'), 'native');
  });
});
