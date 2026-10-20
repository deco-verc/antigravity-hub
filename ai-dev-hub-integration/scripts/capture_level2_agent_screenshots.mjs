import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const possibleChromePaths = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe'
];

let executablePath = possibleChromePaths.find(p => fs.existsSync(p));
if (!executablePath) {
  console.error('Navegador não encontrado.');
  process.exit(1);
}

const screenshotsDir = 'C:\\Users\\Deco\\.gemini\\antigravity\\brain\\a626e547-946e-4f2e-a035-83feafc09761\\screenshots';
const artifactsDir = 'C:\\Users\\Deco\\.gemini\\antigravity\\brain\\a626e547-946e-4f2e-a035-83feafc09761';
fs.mkdirSync(screenshotsDir, { recursive: true });

async function runCapture() {
  console.log('🚀 Iniciando captura dos screenshots de LEVEL 2 AGENT BENCHMARK & SELF-IMPROVEMENT...');
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    defaultViewport: { width: 1560, height: 1050 }
  });

  const page = await browser.newPage();

  try {
    console.log('1. Acessando http://127.0.0.1:3001...');
    await page.goto('http://127.0.0.1:3001', { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 2000));

    // Selecionar projeto
    console.log('1.5 Selecionando projeto...');
    await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('div, button, span'));
      const karpathyItem = items.find(el => el.textContent?.trim() === 'Karpathy Validation Test' || el.textContent?.trim() === 'AI DEV HUB');
      if (karpathyItem) karpathyItem.click();
    });
    await new Promise(r => setTimeout(r, 2000));

    // Abrir Modal de Benchmarks
    console.log('2. Abrindo Modal AI DEV BENCHMARK...');
    const benchBtn = await page.waitForSelector('#benchmark-modal-btn', { timeout: 5000 });
    await benchBtn.click();
    await new Promise(r => setTimeout(r, 1500));

    // Obter runs via API
    const runsRes = await page.evaluate(async () => {
      const res = await fetch('/api/benchmarks/runs');
      return await res.json();
    });

    console.log('Runs encontrados:', runsRes.map(r => `${r.versionLabel} (${r.benchmarkLevel})`).join(', '));

    const agentBaselineRun = runsRes.find(r => r.versionLabel === 'AI_DEV_AGENT_BASELINE_V1');
    const agentV2Run = runsRes.find(r => r.versionLabel === 'AI_DEV_AGENT_V2');

    // Selecionar AI_DEV_AGENT_V2 no dropdown
    if (agentV2Run) {
      console.log(`3. Selecionando run ${agentV2Run.versionLabel} (${agentV2Run.id})...`);
      await page.select('#benchmark-run-switcher', agentV2Run.id);
      await new Promise(r => setTimeout(r, 1500));
    }

    // 54: Scorecard do Level 2 Agent Benchmark
    console.log('4. Capturando 54_benchmark_modal_level2_agent_scorecard.png...');
    await page.screenshot({ path: path.join(screenshotsDir, '54_benchmark_modal_level2_agent_scorecard.png') });
    fs.copyFileSync(path.join(screenshotsDir, '54_benchmark_modal_level2_agent_scorecard.png'), path.join(artifactsDir, '54_benchmark_modal_level2_agent_scorecard.png'));

    // Clicar na aba Comparar Versões
    console.log('5. Clicando na aba Comparar Versões (V1 vs V2)...');
    const compTabBtn = await page.waitForSelector('#tab-btn-compare', { timeout: 5000 });
    await compTabBtn.click();
    await new Promise(r => setTimeout(r, 1500));

    if (agentBaselineRun && agentV2Run) {
      console.log('5.1 Configurando comparação Baseline V1 vs V2...');
      await page.select('#compare-version-a-select', agentBaselineRun.id);
      await page.select('#compare-version-b-select', agentV2Run.id);
      await new Promise(r => setTimeout(r, 500));

      const compareBtn = await page.waitForSelector('#btn-do-compare');
      await compareBtn.click();
      await new Promise(r => setTimeout(r, 2000));

      // 55: Comparação de Versões Level 2 com Regression Gate
      console.log('6. Capturando 55_benchmark_modal_agent_comparison_regression_gate.png...');
      await page.screenshot({ path: path.join(screenshotsDir, '55_benchmark_modal_agent_comparison_regression_gate.png') });
      fs.copyFileSync(path.join(screenshotsDir, '55_benchmark_modal_agent_comparison_regression_gate.png'), path.join(artifactsDir, '55_benchmark_modal_agent_comparison_regression_gate.png'));
    }

    // Clicar na aba Self-Improvement Loop
    console.log('7. Clicando na aba Self-Improvement Loop...');
    const selfImpTabBtn = await page.waitForSelector('#tab-btn-self-improvement', { timeout: 5000 });
    await selfImpTabBtn.click();
    await new Promise(r => setTimeout(r, 1500));

    // 56: Self-Improvement Loop com Experimento Real Level 2
    console.log('8. Capturando 56_benchmark_modal_agent_self_improvement_loop.png...');
    await page.screenshot({ path: path.join(screenshotsDir, '56_benchmark_modal_agent_self_improvement_loop.png') });
    fs.copyFileSync(path.join(screenshotsDir, '56_benchmark_modal_agent_self_improvement_loop.png'), path.join(artifactsDir, '56_benchmark_modal_agent_self_improvement_loop.png'));

    console.log('✅ Todas as capturas de Level 2 concluídas com sucesso!');
  } catch (err) {
    console.error('Erro na captura:', err);
  } finally {
    await browser.close();
  }
}

runCapture();
