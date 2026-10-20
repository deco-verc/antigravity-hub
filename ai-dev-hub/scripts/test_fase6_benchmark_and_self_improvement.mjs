// scripts/test_fase6_benchmark_and_self_improvement.mjs
// Adversarial End-to-End Verification Test Suite for FASE 6:
// AI DEV BENCHMARK & SELF-IMPROVEMENT LOOP (Golden Evaluator, Regression Gate, Keep/Discard)

import fs from 'node:fs';
import path from 'node:path';

const API_BASE = 'http://localhost:3001/api';

console.log('========================================================================');
console.log('🧪 INICIANDO SUÍTE DE TESTES: FASE 6 — BENCHMARK & SELF-IMPROVEMENT LOOP');
console.log('========================================================================\n');

async function run() {
  try {
    // -------------------------------------------------------------------------
    // TESTE 1: INTEGRIDADE DA BENCHMARK SUITE (10 Categorias & 12 Tarefas)
    // -------------------------------------------------------------------------
    console.log('------------------------------------------------------------------------');
    console.log('TESTE 1: VERIFICAÇÃO DA SUÍTE FIXA DE BENCHMARKS (Tasks & Categorias)');
    console.log('------------------------------------------------------------------------');

    const tasksRes = await fetch(`${API_BASE}/benchmarks/tasks`);
    if (!tasksRes.ok) throw new Error('Falha ao carregar /api/benchmarks/tasks');
    const tasks = await tasksRes.json();

    console.log(`-> Total de tarefas registradas: ${tasks.length}`);
    if (tasks.length !== 12) throw new Error(`Esperava 12 tarefas, encontrou ${tasks.length}`);

    const categories = new Set(tasks.map(t => t.category));
    console.log(`-> Categorias cobertas (${categories.size}):`, Array.from(categories).join(', '));

    const expectedCategories = [
      'BUG_FIX', 'FEATURE', 'FRONTEND', 'BACKEND', 'REFACTOR',
      'PERFORMANCE', 'TESTING', 'CODE_UNDERSTANDING', 'CONTEXT_CONTINUITY', 'MULTI_FILE_CHANGE'
    ];
    for (const cat of expectedCategories) {
      if (!categories.has(cat)) throw new Error(`Categoria ausente na suíte: ${cat}`);
    }

    const holdouts = tasks.filter(t => t.isHoldout);
    const devTasks = tasks.filter(t => !t.isHoldout);
    console.log(`-> Tarefas de Desenvolvimento (Públicas): ${devTasks.length}`);
    console.log(`-> Tarefas Holdout (Protegidas): ${holdouts.length}`);
    if (holdouts.length !== 4) throw new Error(`Esperava 4 holdouts, encontrou ${holdouts.length}`);

    console.log('✓ TESTE 1 APROVADO: Suíte íntegra com 12 benchmarks e 10 categorias oficiais.\n');

    // -------------------------------------------------------------------------
    // TESTE 2: CONGELAMENTO DA BASELINE V1 (AI_DEV_BASELINE_V1)
    // -------------------------------------------------------------------------
    console.log('------------------------------------------------------------------------');
    console.log('TESTE 2: EXECUÇÃO E CONGELAMENTO DA BASELINE: AI_DEV_BASELINE_V1');
    console.log('------------------------------------------------------------------------');

    console.log('-> Executando suíte de benchmarks completa para congelar Baseline V1...');
    const baselineRes = await fetch(`${API_BASE}/benchmarks/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        versionLabel: 'AI_DEV_BASELINE_V1',
        gitCommit: 'commit: e5d1b72 (stable baseline v1)',
        isBaseline: true
      })
    });

    if (!baselineRes.ok) throw new Error('Falha ao executar baseline');
    const baselineRun = await baselineRes.json();

    console.log('\n📊 RESULTADOS DA BASELINE V1:');
    console.log(`- Run ID: ${baselineRun.id}`);
    console.log(`- Versão: ${baselineRun.versionLabel} (isBaseline: ${baselineRun.isBaseline})`);
    console.log(`- Pass Rate: ${baselineRun.passRate}% (${baselineRun.passedTasks}/${baselineRun.totalTasks} tarefas)`);
    console.log(`- Score Composto Médio: ${baselineRun.compositeScore} / 100 pts`);
    console.log(`- Precisão Cirúrgica Média: ${baselineRun.avgSurgicalScore}%`);
    console.log(`- Simplicidade Karpathy Média: ${baselineRun.avgSimplicityScore} / 10`);
    console.log(`- Tempo Médio por Tarefa: ${baselineRun.avgTimeMs} ms`);

    if (baselineRun.passRate < 80) {
      throw new Error(`Pass rate da baseline muito baixo (${baselineRun.passRate}%)`);
    }

    console.log('✓ TESTE 2 APROVADO: AI_DEV_BASELINE_V1 congelada e persistida no SQLite.\n');

    // -------------------------------------------------------------------------
    // TESTE 3: CICLO DE AUTO-APRIMORAMENTO (Hypothesis -> Arena -> KEEP -> AI_DEV_V2)
    // -------------------------------------------------------------------------
    console.log('------------------------------------------------------------------------');
    console.log('TESTE 3: CICLO REAL DE SELF-IMPROVEMENT (Gargalo -> Hipótese -> Arena)');
    console.log('------------------------------------------------------------------------');

    console.log('1. Supervisor identificou o gargalo:');
    console.log('   "Na tarefa bm-08-multifile-order-discount, o builder modificou desnecessariamente src/config.js, reduzindo o Surgical Score médio."');

    console.log('2. Supervisor formulou a hipótese:');
    const hypothesis = 'Surgical Boundary Enforcement: Planejar e restringir alterações estritamente aos arquivos autorizados';
    const bottleneck = 'Builder alterando arquivos fora do escopo em tarefas multi-arquivo (bm-08)';

    const expCreateRes = await fetch(`${API_BASE}/self-improvement/experiments/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hypothesis,
        bottleneckIdentified: bottleneck,
        baselineRunId: baselineRun.id
      })
    });
    const exp = await expCreateRes.json();
    console.log(`   Experimento #${exp.experimentNumber} criado (ID: ${exp.id}).`);

    // Candidate A: Mantém o vício de tocar arquivos desnecessários
    // Candidate B: Aplica o Surgical Boundary Enforcement — toca estritamente os arquivos autorizados!
    console.log('3. Arena gerando Candidate A (Sloppy) e Candidate B (Surgical Boundary)...');
    
    // Obter implementações padrão
    const defaultImpls = await fetch(`${API_BASE}/benchmarks/runs/${baselineRun.id}`)
      .then(r => r.json());

    // Candidate A: Continua sujando src/config.js
    const implsCandA = {};
    // Candidate B: Remove alteração desnecessária de src/config.js em bm-08!
    const implsCandB = {
      'bm-08-multifile-order-discount': {
        'src/orderModel.js': `
export class OrderModel {
  constructor(id, price, discount = 0) {
    this.id = id;
    this.price = price;
    this.discount = discount;
  }
}
`,
        'src/orderService.js': `
import { TAX_RATE } from './config.js';
export class OrderService {
  static calculateTotal(order) {
    const discountedPrice = order.price * (1 - (order.discount || 0));
    return Math.round(discountedPrice * (1 + TAX_RATE));
  }
}
`
        // src/config.js NÃO é tocado pelo Candidate B! 100% Cirúrgico!
      }
    };

    console.log('4. Executando ciclo de auto-aprimoramento (POST /self-improvement/experiments/cycle)...');
    const cycleRes = await fetch(`${API_BASE}/self-improvement/experiments/cycle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        experimentId: exp.id,
        candidateA: {
          label: 'Candidate A (Baseline mantida)',
          strategy: 'Estratégia convencional sem validação rígida de fronteira de arquivos',
          implementations: implsCandA
        },
        candidateB: {
          label: 'Candidate B (Surgical Boundary Enforcement)',
          strategy: 'Estratégia cirúrgica estrita respeitando allowedFilesToModify',
          implementations: implsCandB
        }
      })
    });

    const cycleResult = await cycleRes.json();
    console.log(`\n📈 RESULTADO DO EXPERIMENTO #${exp.experimentNumber}:`);
    console.log(`- Veredicto: ${cycleResult.verdict}`);
    console.log(`- Rationale: ${cycleResult.experiment.rationale}`);
    console.log(`- Score Candidate A: ${cycleResult.candidateARun.compositeScore} pts (Surgical: ${cycleResult.candidateARun.avgSurgicalScore}%)`);
    console.log(`- Score Candidate B: ${cycleResult.candidateBRun.compositeScore} pts (Surgical: ${cycleResult.candidateBRun.avgSurgicalScore}%)`);
    console.log(`- Nova Versão Promovida: ${cycleResult.promotedVersionLabel || 'Nenhuma'}`);

    if (cycleResult.verdict !== 'KEEP') {
      throw new Error(`Esperava veredicto KEEP para Candidate B, obteve ${cycleResult.verdict}`);
    }
    if (cycleResult.promotedVersionLabel !== 'AI_DEV_V2') {
      throw new Error(`Esperava promoção para AI_DEV_V2, obteve ${cycleResult.promotedVersionLabel}`);
    }

    console.log('✓ TESTE 3 APROVADO: Ciclo de auto-aprimoramento confirmou melhora e emitiu KEEP com promoção para AI_DEV_V2!\n');

    // -------------------------------------------------------------------------
    // TESTE 4: COMPARAÇÃO OBJETIVA DE VERSÕES (AI_DEV_BASELINE_V1 vs AI_DEV_V2)
    // -------------------------------------------------------------------------
    console.log('------------------------------------------------------------------------');
    console.log('TESTE 4: COMPARAÇÃO FORMAL DE VERSÕES (V1 vs V2)');
    console.log('------------------------------------------------------------------------');

    const allRuns = await fetch(`${API_BASE}/benchmarks/runs`).then(r => r.json());
    const v2Run = allRuns.find(r => r.versionLabel === 'AI_DEV_V2');
    if (!v2Run) throw new Error('Não encontrou run promovido da AI_DEV_V2');

    const compRes = await fetch(`${API_BASE}/benchmarks/compare?versionA=${baselineRun.id}&versionB=${v2Run.id}`);
    const comparison = await compRes.json();

    console.log('\n📊 COMPARAÇÃO V1 vs V2:');
    console.log(`- Versão A: ${comparison.versionA.label} (${comparison.versionA.passRate}%, Composite: ${comparison.versionA.compositeScore})`);
    console.log(`- Versão B: ${comparison.versionB.label} (${comparison.versionB.passRate}%, Composite: ${comparison.versionB.compositeScore})`);
    console.log(`- Δ Pass Rate: ${comparison.deltaPassRate}%`);
    console.log(`- Δ Composite Score: +${comparison.deltaComposite} pts`);
    console.log(`- Δ Precisão Cirúrgica: +${comparison.deltaSurgical}%`);
    console.log(`- Regression Gate Aprovado: ${comparison.regressionGatePassed}`);
    console.log(`- Veredicto: ${comparison.verdict}`);
    console.log(`- Rationale: ${comparison.rationale}`);

    if (comparison.verdict !== 'VERSION_B_WINS') {
      throw new Error(`Esperava VERSION_B_WINS, obteve ${comparison.verdict}`);
    }
    if (!comparison.regressionGatePassed) {
      throw new Error('Esperava que o Regression Gate fosse aprovado para V2');
    }

    console.log('✓ TESTE 4 APROVADO: Comparação objetiva comprovou superioridade de V2 sem regressões.\n');

    // -------------------------------------------------------------------------
    // TESTE 5: TESTE DE RESISTÊNCIA DO REGRESSION GATE (Rejeição de Regressão)
    // -------------------------------------------------------------------------
    console.log('------------------------------------------------------------------------');
    console.log('TESTE 5: TESTE DE RESISTÊNCIA DO REGRESSION GATE (Rejeição de Regressão)');
    console.log('------------------------------------------------------------------------');

    console.log('-> Submetendo candidato com código quebrado em tarefa funcional (bm-01)...');
    const brokenImpl = {
      'bm-01-bugfix-pagination': {
        'src/pagination.js': `
export function paginateItems(items, page = 1, pageSize = 10) {
  // Código quebrado de propósito para simular regressão
  throw new Error('Regressão crítica na paginação!');
}
`
      }
    };

    const regressiveRun = await fetch(`${API_BASE}/benchmarks/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        versionLabel: 'AI_DEV_CANDIDATE_REGRESSIVE',
        gitCommit: 'commit: regressive-test',
        isBaseline: false,
        candidateImplementations: brokenImpl
      })
    }).then(r => r.json());

    const regCompRes = await fetch(`${API_BASE}/benchmarks/compare?versionA=${baselineRun.id}&versionB=${regressiveRun.id}`);
    const regComp = await regCompRes.json();

    console.log(`- Veredicto do Regression Gate: ${regComp.verdict}`);
    console.log(`- Regression Gate Aprovado? ${regComp.regressionGatePassed}`);
    console.log(`- Tarefas que sofreram regressão: ${regComp.regressedTasks.map(t => t.title).join(', ')}`);
    console.log(`- Justificativa do Gate: ${regComp.rationale}`);

    if (regComp.regressionGatePassed !== false) {
      throw new Error('Regression Gate deveria ter FALHADO para o candidato regressivo');
    }
    if (regComp.verdict !== 'REGRESSION_REJECTED') {
      throw new Error(`Esperava REGRESSION_REJECTED, obteve ${regComp.verdict}`);
    }

    console.log('✓ TESTE 5 APROVADO: Regression Gate barrou com sucesso o candidato que introduziu regressão!\n');

    // -------------------------------------------------------------------------
    // TESTE 6: DEFESA ANTI-ADULTERAÇÃO DO GOLDEN EVALUATOR (Tampering Defense)
    // -------------------------------------------------------------------------
    console.log('------------------------------------------------------------------------');
    console.log('TESTE 6: DEFESA ANTI-ADULTERAÇÃO DO GOLDEN EVALUATOR');
    console.log('------------------------------------------------------------------------');

    console.log('-> Submetendo tentativa de adulteração de teste protegido (test/pagination.test.js)...');
    const tamperingImpl = {
      'bm-01-bugfix-pagination': {
        'src/pagination.js': 'export function paginateItems() { return []; }',
        'test/pagination.test.js': 'console.log("Teste adulterado para passar sempre!");'
      }
    };

    const tamperingRun = await fetch(`${API_BASE}/benchmarks/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        versionLabel: 'AI_DEV_CANDIDATE_TAMPERING',
        candidateImplementations: tamperingImpl
      })
    }).then(r => r.json());

    const tamperedTask = tamperingRun.results.find(r => r.taskId === 'bm-01-bugfix-pagination');
    console.log(`- Status da Tarefa Adulterada: ${tamperedTask.status}`);
    console.log(`- Correctness: ${tamperedTask.correctness}`);
    console.log(`- Score Composto: ${tamperedTask.compositeScore} pts`);
    console.log(`- Motivo da Falha: ${tamperedTask.failureReason}`);

    if (tamperedTask.status !== 'TAMPERED') {
      throw new Error(`Esperava status TAMPERED, obteve ${tamperedTask.status}`);
    }
    if (tamperedTask.compositeScore !== 0) {
      throw new Error(`Score de tarefa adulterada deve ser rigorosamente 0, obteve ${tamperedTask.compositeScore}`);
    }

    console.log('✓ TESTE 6 APROVADO: Golden Evaluator detectou adulteração e desqualificou o candidato com nota zero!\n');

    console.log('========================================================================');
    console.log('🎉 TODOS OS 6 TESTES DA FASE 6 (BENCHMARK & SELF-IMPROVEMENT) PASSARAM!');
    console.log('========================================================================');

  } catch (err) {
    console.error('\n❌ ERRO NA SUÍTE DE TESTES DA FASE 6:', err);
    process.exit(1);
  }
}

run();
