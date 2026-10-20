// scripts/run_anti_slop_benchmark.mjs
// Standalone Runner for Anti-Slop Benchmark: Baseline A vs Variant B

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Import AntiSlopBenchmarkRunner from server ts module
const { AntiSlopBenchmarkRunner } = await import('../server/src/antiSlopBenchmark.ts');

console.log('================================================================');
console.log('🏛️  DECOHUB — BENCHMARK ANTI-SLOP & AUTONOMOUS INTELLIGENCE');
console.log('================================================================');
console.log('Comparando:');
console.log('  [A] Linha de Base: DecoHUB 1.0.6 Padrão (Sem Council / Sem Anti-Slop / Sem Skills)');
console.log('  [B] Variante B: DecoHUB Autonomous Intelligence (Council + Research + Skills + Anti-Slop)');
console.log('----------------------------------------------------------------\n');

try {
  const summary = await AntiSlopBenchmarkRunner.runFullBenchmark();
  const reportMd = AntiSlopBenchmarkRunner.formatMarkdownReport(summary);

  console.log(reportMd);

  // Write report to persistent documentation
  const reportPath = path.join(rootDir, '.ai-dev-hub', 'anti-slop-benchmark-report.md');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, reportMd, 'utf-8');
  console.log(`\n✅ Relatório salvo com sucesso em: ${reportPath}`);
} catch (err) {
  console.error('❌ Erro durante execução do benchmark:', err);
  process.exit(1);
}
