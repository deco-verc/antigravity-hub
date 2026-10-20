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

async function runCapture() {
  console.log('🚀 Iniciando captura refinada da FASE 6...');
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    defaultViewport: { width: 1560, height: 1000 }
  });

  const page = await browser.newPage();

  try {
    console.log('1. Acessando http://127.0.0.1:3001...');
    await page.goto('http://127.0.0.1:3001', { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 2000));

    // Selecionar projeto Karpathy Validation Test
    console.log('1.5 Selecionando projeto Karpathy Validation Test...');
    await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('div, button, span'));
      const karpathyItem = items.find(el => el.textContent?.trim() === 'Karpathy Validation Test');
      if (karpathyItem) karpathyItem.click();
    });
    await new Promise(r => setTimeout(r, 2000));

    // 50: Header do Simple IDE com o botão Benchmarks
    console.log('2. Capturando 50_simple_ide_benchmark_button_header.png...');
    await page.screenshot({ path: path.join(screenshotsDir, '50_simple_ide_benchmark_button_header.png') });
    fs.copyFileSync(path.join(screenshotsDir, '50_simple_ide_benchmark_button_header.png'), path.join(artifactsDir, '50_simple_ide_benchmark_button_header.png'));

    // Abrir Modal de Benchmarks
    console.log('3. Abrindo Modal AI DEV BENCHMARK...');
    const benchBtn = await page.waitForSelector('#benchmark-modal-btn', { timeout: 5000 });
    await benchBtn.click();
    await new Promise(r => setTimeout(r, 1500));

    // 51: Scorecard da Versão & Lista de Tarefas
    console.log('4. Capturando 51_benchmark_modal_scorecard_overview.png...');
    await page.screenshot({ path: path.join(screenshotsDir, '51_benchmark_modal_scorecard_overview.png') });
    fs.copyFileSync(path.join(screenshotsDir, '51_benchmark_modal_scorecard_overview.png'), path.join(artifactsDir, '51_benchmark_modal_scorecard_overview.png'));

    // Clicar na aba Comparar Versões
    console.log('5. Clicando na aba Comparar Versões (V1 vs V2)...');
    const compTabBtn = await page.waitForSelector('#tab-btn-compare', { timeout: 5000 });
    await compTabBtn.click();
    await new Promise(r => setTimeout(r, 1500));

    // Obter IDs dos runs via API
    const runsRes = await page.evaluate(async () => {
      const res = await fetch('/api/benchmarks/runs');
      return await res.json();
    });

    const v1Run = runsRes.find(r => r.versionLabel === 'AI_DEV_BASELINE_V1' && r.passRate === 100);
    const v2Run = runsRes.find(r => r.versionLabel === 'AI_DEV_V2' && r.passRate === 100);
    const regRun = runsRes.find(r => r.versionLabel === 'AI_DEV_CANDIDATE_REGRESSIVE');

    console.log(`Runs identificados: V1=${v1Run?.id}, V2=${v2Run?.id}, Reg=${regRun?.id}`);

    // Selecionar Versão A (V1) e Versão B (V2)
    console.log('5.1 Configurando comparação V1 vs V2...');
    await page.waitForSelector('#compare-version-a-select');
    await page.select('#compare-version-a-select', v1Run.id);
    await page.select('#compare-version-b-select', v2Run.id);
    await new Promise(r => setTimeout(r, 500));

    // Clicar no botão Comparar Versões
    const compareBtn = await page.waitForSelector('#btn-do-compare');
    await compareBtn.click();
    await new Promise(r => setTimeout(r, 2000));

    // 52: V2 WINS (Regression Gate Aprovado)
    console.log('6. Capturando 52_benchmark_modal_v2_wins.png...');
    await page.screenshot({ path: path.join(screenshotsDir, '52_benchmark_modal_v2_wins.png') });
    fs.copyFileSync(path.join(screenshotsDir, '52_benchmark_modal_v2_wins.png'), path.join(artifactsDir, '52_benchmark_modal_v2_wins.png'));

    // Configurar comparação com Versão Regressiva
    console.log('6.1 Configurando comparação com candidato regressivo...');
    await page.select('#compare-version-b-select', regRun.id);
    await new Promise(r => setTimeout(r, 500));

    await compareBtn.click();
    await new Promise(r => setTimeout(r, 2000));

    // 52b: Regression Gate Rejeitado
    console.log('6.2 Capturando 52b_benchmark_modal_regression_gate_rejected.png...');
    await page.screenshot({ path: path.join(screenshotsDir, '52b_benchmark_modal_regression_gate_rejected.png') });
    fs.copyFileSync(path.join(screenshotsDir, '52b_benchmark_modal_regression_gate_rejected.png'), path.join(artifactsDir, '52b_benchmark_modal_regression_gate_rejected.png'));

    // Clicar na aba Self-Improvement Loop
    console.log('7. Clicando na aba Self-Improvement Loop...');
    const selfTabBtn = await page.waitForSelector('#tab-btn-self-improvement', { timeout: 5000 });
    await selfTabBtn.click();
    await new Promise(r => setTimeout(r, 1500));

    // 53: Self-Improvement Loop com Experimento e Decisão KEEP
    console.log('8. Capturando 53_benchmark_modal_self_improvement_loop.png...');
    await page.screenshot({ path: path.join(screenshotsDir, '53_benchmark_modal_self_improvement_loop.png') });
    fs.copyFileSync(path.join(screenshotsDir, '53_benchmark_modal_self_improvement_loop.png'), path.join(artifactsDir, '53_benchmark_modal_self_improvement_loop.png'));

    console.log('\n🎉 Todas as capturas visuais refinadas da FASE 6 foram concluídas com sucesso total!');
  } catch (err) {
    console.error('Erro na captura:', err);
  } finally {
    await browser.close();
  }
}

runCapture();
