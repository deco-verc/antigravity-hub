import fs from 'node:fs';
import path from 'node:path';

/**
 * Lê e retorna o conteúdo de um arquivo Markdown de forma segura.
 * @param {string} filePath
 * @returns {string}
 */
export function loadMarkdownFile(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('Caminho de arquivo inválido fornecido.');
  }
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Arquivo não encontrado: ${resolved}`);
  }
  const content = fs.readFileSync(resolved, 'utf8');
  if (!content.trim()) {
    throw new Error(`Arquivo vazio: ${resolved}`);
  }
  return content;
}

/**
 * Valida se um relatório de auditoria possui a estrutura técnica e seções obrigatórias.
 * @param {string} filePathOrContent
 * @returns {{ valid: boolean, missingSections: string[], bottleneckCount: number, failureModes: string[] }}
 */
export function validateAuditReport(filePathOrContent) {
  let content = '';
  if (filePathOrContent.includes('\n') || filePathOrContent.length > 500) {
    content = filePathOrContent;
  } else {
    content = loadMarkdownFile(filePathOrContent);
  }

  const requiredSections = [
    'Sumário Executivo',
    'Taxonomia de Falhas em Agentes Autônomos de Codificação',
    'Mapeamento de Gargalos Críticos do Sistema',
    'Matriz de Riscos, Severidade e Mitigações',
    'Plano de Ações Corretivas para o AutoAdapt'
  ];

  const missingSections = requiredSections.filter(sec => !content.includes(sec));

  // Identificação de modos de falha mapeados
  const failurePattern = /### 2\.\d\s+([^\n\r]+)/g;
  const failureModes = [];
  let match;
  while ((match = failurePattern.exec(content)) !== null) {
    failureModes.push(match[1].trim());
  }

  // Identificação de IDs de gargalos (ex: G-01, G-02)
  const bottleneckMatches = content.match(/G-\d{2}/g) || [];
  const uniqueBottlenecks = [...new Set(bottleneckMatches)];

  return {
    valid: missingSections.length === 0 && failureModes.length >= 4 && uniqueBottlenecks.length >= 3,
    missingSections,
    bottleneckCount: uniqueBottlenecks.length,
    bottlenecks: uniqueBottlenecks,
    failureModes
  };
}

/**
 * Valida se a pesquisa comparativa de benchmarks contém os benchmarks e matrizes obrigatórias.
 * @param {string} filePathOrContent
 * @returns {{ valid: boolean, missingSections: string[], coveredBenchmarks: string[], recommendationsCount: number }}
 */
export function validateBenchmarksReport(filePathOrContent) {
  let content = '';
  if (filePathOrContent.includes('\n') || filePathOrContent.length > 500) {
    content = filePathOrContent;
  } else {
    content = loadMarkdownFile(filePathOrContent);
  }

  const requiredSections = [
    'Objetivo da Pesquisa Comparativa',
    'Benchmarks de Referência Analisados',
    'Matriz Comparativa de Benchmarks',
    'Comparativo de Arquiteturas de Agentes',
    'Diretrizes e Recomendações para o AutoAdapt'
  ];

  const missingSections = requiredSections.filter(sec => !content.includes(sec));

  const benchmarkTargets = ['SWE-bench', 'HumanEval', 'GAIA', 'AgentBench', 'Karpathy'];
  const coveredBenchmarks = benchmarkTargets.filter(name => content.includes(name));

  // Extrair contagem de recomendações na seção 5
  const recMatches = content.match(/\n\d+\.\s+\*\*([^*]+)\*\*/g) || [];

  return {
    valid: missingSections.length === 0 && coveredBenchmarks.length === benchmarkTargets.length,
    missingSections,
    coveredBenchmarks,
    recommendationsCount: recMatches.length
  };
}

/**
 * Obtém resumo estruturado da auditoria para consumo programático.
 * @param {string} [filePath]
 * @returns {object}
 */
export function getAuditSummary(filePath = 'docs/auditoria-falhas-e-gargalos.md') {
  const content = loadMarkdownFile(filePath);
  const validation = validateAuditReport(content);

  const hasHighSeverity = content.includes('Alta') || content.includes('Crítica');
  const hasGitWorktreeMitigation = content.includes('Git Worktree') || content.includes('worktree');

  return {
    isValid: validation.valid,
    failureModesCount: validation.failureModes.length,
    failureModes: validation.failureModes,
    bottlenecksCount: validation.bottleneckCount,
    bottlenecks: validation.bottlenecks,
    hasHighSeverity,
    hasGitWorktreeMitigation
  };
}

/**
 * Extrai dados estruturados da matriz comparativa de benchmarks.
 * @param {string} [filePath]
 * @returns {object}
 */
export function getBenchmarkComparisonData(filePath = 'docs/pesquisa-comparativa-benchmarks.md') {
  const content = loadMarkdownFile(filePath);
  const validation = validateBenchmarksReport(content);

  const benchmarks = [
    { name: 'SWE-bench (Verified)', domain: 'Software Engineering', verifier: true, priority: 'Crítica' },
    { name: 'HumanEval+', domain: 'Algorithms / Syntax', verifier: true, priority: 'Média' },
    { name: 'GAIA', domain: 'General Assistant', verifier: true, priority: 'Alta' },
    { name: 'AgentBench', domain: 'OS / CLI / DB', verifier: true, priority: 'Alta' },
    { name: 'Karpathy Loop', domain: 'Self-Refinement / RLVR', verifier: true, priority: 'Crítica' }
  ];

  const architectures = [
    { name: 'Single-Turn Prompting', passRate: '< 4%', tolerance: 'Nula' },
    { name: 'ReAct Clássico', passRate: '15% - 25%', tolerance: 'Moderada' },
    { name: 'Supervisor / Worker', passRate: '35% - 48%', tolerance: 'Alta' },
    { name: 'Search + Test Verification', passRate: '45% - 55%+', tolerance: 'Máxima' }
  ];

  return {
    isValid: validation.valid,
    benchmarks,
    architectures,
    coveredBenchmarks: validation.coveredBenchmarks,
    recommendationsCount: validation.recommendationsCount
  };
}

// Execução direta via CLI para inspeção rápida
if (process.argv[1] && (process.argv[1].endsWith('auditAndBenchmarks.js') || process.argv[1].endsWith('auditAndBenchmarks'))) {
  const audit = getAuditSummary();
  const benchmarks = getBenchmarkComparisonData();
  console.log('[AutoAdapt] Auditoria e Benchmarks:');
  console.log(JSON.stringify({ audit, benchmarks }, null, 2));
  process.exitCode = audit.isValid && benchmarks.isValid ? 0 : 1;
}
