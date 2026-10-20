// scripts/run_agent_benchmark_suite.mjs
// Runs the Level 2 Agent Benchmark Suite with REAL Antigravity Builder conversations

import { AgentBenchmarkManager, AGENT_BENCHMARK_TASKS } from '../server/dist/agentBenchmarkManager.js';
import { execSync } from 'node:child_process';

const gitCommit = execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();

console.log('========================================================================');
console.log('🌟 EXECUTANDO LEVEL 2: AGENT BENCHMARK SUITE (E2E COM AGENTES REAIS)');
console.log(`Commit Oficial da Versão: ${gitCommit}`);
console.log('========================================================================\n');

async function run() {
  const startTime = Date.now();

  try {
    const summary = await AgentBenchmarkManager.runFullAgentSuite({
      versionLabel: 'AI_DEV_AGENT_BASELINE_V1',
      gitCommit,
      isBaseline: true,
      model: 'flash'
    });

    console.log('\n========================================================================');
    console.log('📊 RESULTADOS CONSOLIDADOS DA BASELINE REAL (AI_DEV_AGENT_BASELINE_V1):');
    console.log('========================================================================');
    console.log(`- Versão Label: ${summary.versionLabel}`);
    console.log(`- Commit Git: ${summary.gitCommit}`);
    console.log(`- Taxa de Aprovação: ${summary.passRate}% (${summary.passedTasks}/${summary.totalTasks} tarefas)`);
    console.log(`- Score Composto Médio: ${summary.compositeScore} / 100 pts`);
    console.log(`- Precisão Cirúrgica Média: ${summary.avgSurgicalScore}%`);
    console.log(`- Simplicidade Média: ${summary.avgSimplicityScore} / 10`);
    console.log(`- Duração Média por Tarefa: ${(summary.avgTimeMs / 1000).toFixed(1)} segundos`);
    console.log(`- Duração Total da Suíte: ${((Date.now() - startTime) / 1000).toFixed(1)} segundos`);
    console.log('------------------------------------------------------------------------');
    console.log('DETALHAMENTO POR TAREFA REAL:');
    for (const r of summary.results) {
      console.log(`\n▶ [${r.status}] ${r.title} (${r.taskId})`);
      console.log(`  - Conversation ID: ${r.conversationId}`);
      console.log(`  - Duração: ${(r.durationMs / 1000).toFixed(1)}s`);
      console.log(`  - Arquivos Alterados: ${r.filesChanged.join(', ') || 'Nenhum'}`);
      console.log(`  - Arquivos Supérfluos: ${r.unnecessaryFilesCount}`);
      console.log(`  - Surgical Score: ${r.surgicalScore}% | Simplicity: ${r.complexityScore}/10 | Composite: ${r.compositeScore}`);
      console.log(`  - Commit no Workspace: ${r.resultCommit || 'Nenhum'}`);
      console.log(`  - Output do Evaluator: ${r.testOutput.trim().replace(/\n/g, ' ')}`);
    }
    console.log('\n========================================================================\n');
  } catch (err) {
    console.error('Erro na execução da suíte de agentes:', err);
    process.exit(1);
  }
}

run();
