import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { ResearchManager } from '../server/dist/researchManager.js';
import { db } from '../server/dist/db.js';

console.log('================================================================');
console.log('🧪 SUÍTE DE TESTES: ETAPA 3 - AUTORESEARCH MODE PARA SOFTWARE');
console.log('================================================================\n');

const testProjectDir = 'C:\\IA\\test-projects\\karpathy-validation-test';

// 1. Setup projeto de teste
if (!fs.existsSync(testProjectDir)) {
  fs.mkdirSync(testProjectDir, { recursive: true });
}
if (!fs.existsSync(path.join(testProjectDir, 'src'))) {
  fs.mkdirSync(path.join(testProjectDir, 'src'), { recursive: true });
}

// Garantir repositório Git limpo
try {
  execSync('git status', { cwd: testProjectDir });
} catch {
  execSync('git init -b main', { cwd: testProjectDir });
  execSync('git config user.name "AI DEV HUB"', { cwd: testProjectDir });
  execSync('git config user.email "aidev@local.hub"', { cwd: testProjectDir });
}

// Obter projeto no SQLite
let project = db.prepare('SELECT * FROM projects WHERE path = ?').get(testProjectDir);
if (!project) {
  const pId = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO projects (id, name, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
    pId, 'Karpathy Validation Test', testProjectDir, now, now
  );
  project = { id: pId, name: 'Karpathy Validation Test', path: testProjectDir };
}

console.log(`[Config] Projeto vinculado: "${project.name}" (ID: ${project.id})\n`);

// 2. Criar código inicial não otimizado em src/search.js
const initialSearchCode = `// Indexador de busca inicial (não otimizado - cria RegExp repetidamente)
export function searchDocuments(documents, query) {
  let matches = [];
  for (let i = 0; i < documents.length; i++) {
    const doc = documents[i];
    // Ineficiente: instancia novo RegExp para cada documento
    const regex = new RegExp(query, 'i');
    if (regex.test(doc)) {
      matches.push(doc);
    }
  }
  return matches;
}
`;
fs.writeFileSync(path.join(testProjectDir, 'src', 'search.js'), initialSearchCode, 'utf-8');

// 3. Criar script de medição real de benchmark: benchmark.js
const benchmarkScript = `import { searchDocuments } from './src/search.js';

const docs = Array.from({ length: 6000 }, (_, i) => \`doc_\${i}_payload_data_\${i % 100}\`);
const start = performance.now();

for (let q = 0; q < 80; q++) {
  searchDocuments(docs, \`data_\${q}\`);
}

const duration = Math.round((performance.now() - start) * 100) / 100;
console.log(\`latency_ms: \${duration}\`);
`;
fs.writeFileSync(path.join(testProjectDir, 'benchmark.js'), benchmarkScript, 'utf-8');

// Commit inicial para ter base limpa no git
execSync('git add -A', { cwd: testProjectDir });
try {
  execSync('git commit -m "chore: base search and benchmark"', { cwd: testProjectDir });
} catch {}

let passedTests = 0;
let totalTests = 4;

// ============================================================================
// TESTE 1: BASELINE OBRIGATÓRIO (SEM ALTERAÇÃO EXPERIMENTAL PRÉVIA)
// ============================================================================
console.log('----------------------------------------------------------------');
console.log('TESTE 1: BASELINE OBRIGATÓRIO (PONTO ZERO DA MÉTRICA)');
console.log('----------------------------------------------------------------');

const run = ResearchManager.startResearchRun({
  projectId: project.id,
  objective: 'Otimizar latência do algoritmo de busca de documentos',
  primaryMetric: 'latency_ms',
  direction: 'MINIMIZE',
  measurementCommand: 'node benchmark.js',
  allowedFiles: ['src/search.js'],
  protectedFiles: ['benchmark.js'],
  maxExperiments: 10,
  maxExperimentTime: 2.0,
  complexityPenalty: 0.05
}, testProjectDir);

console.log(`[Run Criado] ID: ${run.id}`);
console.log(`[Branch de Pesquisa] ${run.branchName}`);
console.log(`[Métrica do Baseline] ${run.baselineMetric} ${run.primaryMetric}`);
console.log(`[Melhor Commit Inicial] ${run.bestCommit?.slice(0, 7)}`);
console.log(`[Ledger Experimento #0] Status: ${run.experiments[0].status}, Razão: ${run.experiments[0].reason}`);

if (
  run.baselineMetric !== null &&
  run.baselineMetric > 0 &&
  run.bestMetric === run.baselineMetric &&
  run.experiments.length === 1 &&
  run.experiments[0].status === 'BASELINE'
) {
  console.log('✅ TESTE 1 PASSOU: Baseline estabelecido com sucesso sem alterações prévias!\n');
  passedTests++;
} else {
  console.error('❌ TESTE 1 FALHOU: Falha ao estabelecer baseline.');
}

// ============================================================================
// TESTE 2: EXPERIMENTO 1 (KEEP — OTIMIZAÇÃO REAL COM COMMIT MANTIDO)
// ============================================================================
console.log('----------------------------------------------------------------');
console.log('TESTE 2: EXPERIMENTO 1 (KEEP - MELHORIA COMPROVADA E COMMIT MANTIDO)');
console.log('----------------------------------------------------------------');

// Aplicar otimização cirúrgica: substituir RegExp por indexOf direto
const optimizedSearchCode = `// Indexador de busca otimizado (usa indexOf rápido sem RegExp)
export function searchDocuments(documents, query) {
  const matches = [];
  const qLower = query.toLowerCase();
  for (let i = 0; i < documents.length; i++) {
    const doc = documents[i];
    if (doc.toLowerCase().indexOf(qLower) !== -1) {
      matches.push(doc);
    }
  }
  return matches;
}
`;
fs.writeFileSync(path.join(testProjectDir, 'src', 'search.js'), optimizedSearchCode, 'utf-8');

const exp1 = await ResearchManager.executeExperimentStep({
  runId: run.id,
  projectPath: testProjectDir,
  hypothesis: 'Substituir instanciação de RegExp por indexOf normalizado',
  filesChanged: ['src/search.js']
});

console.log(`[Exp #1 Sequência] #${exp1.sequence}`);
console.log(`[Exp #1 Hipótese] ${exp1.hypothesis}`);
console.log(`[Exp #1 Métrica] Antes: ${exp1.metricBefore} -> Depois: ${exp1.metricAfter} ms`);
console.log(`[Exp #1 Ganho] ${exp1.improvementPct}% (Delta: ${exp1.delta} ms)`);
console.log(`[Exp #1 Veredicto] Status: ${exp1.status}`);
console.log(`[Exp #1 Razão] ${exp1.reason}`);

// Verificar se o arquivo no disco ainda contém a versão otimizada (não revertido!)
const diskContentAfterExp1 = fs.readFileSync(path.join(testProjectDir, 'src', 'search.js'), 'utf-8');
const isKeptOnDisk = diskContentAfterExp1.includes('indexOf(qLower)');

if (
  exp1.status === 'KEEP' &&
  exp1.metricAfter < exp1.metricBefore &&
  exp1.improvementPct > 0 &&
  isKeptOnDisk
) {
  console.log('✅ TESTE 2 PASSOU: Experimento melhorou métrica, status KEEP atribuído e commit mantido!\n');
  passedTests++;
} else {
  console.error('❌ TESTE 2 FALHOU: Falha ao validar KEEP.');
}

// ============================================================================
// TESTE 3: EXPERIMENTO 2 (DISCARD — REGRESSÃO DETECTADA E CÓDIGO REVERTIDO)
// ============================================================================
console.log('----------------------------------------------------------------');
console.log('TESTE 3: EXPERIMENTO 2 (DISCARD - PIORA DA MÉTRICA E REVERSÃO GIT)');
console.log('----------------------------------------------------------------');

// Inserir regressão intencional (deep clone + sort desnecessário que piora a latência)
const regressiveSearchCode = `// Experimento ruim: adiciona overhead desnecessário de JSON parse/stringify
export function searchDocuments(documents, query) {
  const clone = JSON.parse(JSON.stringify(documents));
  clone.sort();
  return clone.filter(d => d.includes(query));
}
`;
fs.writeFileSync(path.join(testProjectDir, 'src', 'search.js'), regressiveSearchCode, 'utf-8');

const exp2 = await ResearchManager.executeExperimentStep({
  runId: run.id,
  projectPath: testProjectDir,
  hypothesis: 'Adicionar ordenação e clone prévio dos documentos (hipótese ruim)',
  filesChanged: ['src/search.js']
});

console.log(`[Exp #2 Sequência] #${exp2.sequence}`);
console.log(`[Exp #2 Hipótese] ${exp2.hypothesis}`);
console.log(`[Exp #2 Métrica] Antes: ${exp2.metricBefore} -> Depois: ${exp2.metricAfter} ms`);
console.log(`[Exp #2 Veredicto] Status: ${exp2.status}`);
console.log(`[Exp #2 Razão] ${exp2.reason}`);

// VERIFICAÇÃO CRÍTICA DE REVERSÃO:
// O arquivo src/search.js no disco NÃO PODE CONTER a regressão JSON.parse! Deve ter voltado ao estado do Exp #1.
const diskContentAfterExp2 = fs.readFileSync(path.join(testProjectDir, 'src', 'search.js'), 'utf-8');
const isRegressiveCodeGone = !diskContentAfterExp2.includes('JSON.parse(JSON.stringify');
const isPreviousGoodCodeRestored = diskContentAfterExp2.includes('indexOf(qLower)');

console.log(`[Reversão Git Check] Código ruim removido do disco? ${isRegressiveCodeGone}`);
console.log(`[Reversão Git Check] Código KEEP anterior restaurado? ${isPreviousGoodCodeRestored}`);

if (
  exp2.status === 'DISCARD' &&
  exp2.metricAfter >= exp2.metricBefore &&
  isRegressiveCodeGone &&
  isPreviousGoodCodeRestored
) {
  console.log('✅ TESTE 3 PASSOU: Regressão rejeitada (DISCARD) e código revertido com perfeição!\n');
  passedTests++;
} else {
  console.error('❌ TESTE 3 FALHOU: Falha ao rejeitar ou reverter experimento ruim.');
}

// ============================================================================
// TESTE 4: EXPERIMENTO 3 (CRASH — EXCEÇÃO FATAL, DETECÇÃO E REVERSÃO GIT)
// ============================================================================
console.log('----------------------------------------------------------------');
console.log('TESTE 4: EXPERIMENTO 3 (CRASH CONTROLADO E REVERSÃO GIT)');
console.log('----------------------------------------------------------------');

// Inserir exceção de runtime que quebra a execução do benchmark
const crashingSearchCode = `// Código que crasha em tempo de execução
export function searchDocuments(documents, query) {
  throw new Error("FATAL_MEMORY_CORRUPTION_EXCEPTION");
}
`;
fs.writeFileSync(path.join(testProjectDir, 'src', 'search.js'), crashingSearchCode, 'utf-8');

const exp3 = await ResearchManager.executeExperimentStep({
  runId: run.id,
  projectPath: testProjectDir,
  hypothesis: 'Tentativa de otimização que quebra em tempo de execução',
  filesChanged: ['src/search.js']
});

console.log(`[Exp #3 Sequência] #${exp3.sequence}`);
console.log(`[Exp #3 Hipótese] ${exp3.hypothesis}`);
console.log(`[Exp #3 Veredicto] Status: ${exp3.status}`);
console.log(`[Exp #3 Razão] ${exp3.reason}`);

// VERIFICAÇÃO CRÍTICA DE REVERSÃO PÓS-CRASH:
const diskContentAfterExp3 = fs.readFileSync(path.join(testProjectDir, 'src', 'search.js'), 'utf-8');
const isCrashCodeGone = !diskContentAfterExp3.includes('FATAL_MEMORY_CORRUPTION_EXCEPTION');
const isGoodCodeStillIntact = diskContentAfterExp3.includes('indexOf(qLower)');

console.log(`[Reversão Crash Check] Código quebrado removido do disco? ${isCrashCodeGone}`);
console.log(`[Reversão Crash Check] Código estável preservado? ${isGoodCodeStillIntact}`);

// Finalizar run de pesquisa
const stoppedRun = ResearchManager.stopResearchRun(run.id, testProjectDir);
console.log(`[Run Finalizado] Status: ${stoppedRun.status}`);
console.log(`[Estatísticas Finais] KEEP: ${stoppedRun.keepCount} | DISCARD: ${stoppedRun.discardCount} | CRASH: ${stoppedRun.crashCount}`);
console.log(`[Melhoria Total sobre Baseline] +${stoppedRun.overallImprovementPct}%`);

if (
  exp3.status === 'CRASH' &&
  isCrashCodeGone &&
  isGoodCodeStillIntact &&
  stoppedRun.keepCount === 1 &&
  stoppedRun.discardCount === 1 &&
  stoppedRun.crashCount === 1
) {
  console.log('✅ TESTE 4 PASSOU: CRASH tratado com segurança, revertido e ledger consolidado!\n');
  passedTests++;
} else {
  console.error('❌ TESTE 4 FALHOU: Falha no tratamento ou reversão de CRASH.');
}

// ============================================================================
// RESULTADO FINAL DA SUÍTE
// ============================================================================
console.log('================================================================');
console.log(`📊 RESULTADO FINAL DA ETAPA 3: ${passedTests}/${totalTests} TESTES APROVADOS`);
console.log('================================================================');

if (passedTests === totalTests) {
  console.log('🎉 SUCESSO ABSOLUTO: ETAPA 3 (AUTORESEARCH MODE PARA SOFTWARE) VALIDADA COM EXCELÊNCIA!');
  process.exit(0);
} else {
  console.error('⚠️ ALGUNS TESTES FALHARAM.');
  process.exit(1);
}
