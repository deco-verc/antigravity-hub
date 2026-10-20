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
  console.log('🚀 Capturando 57_benchmark_modal_promotion_gate_tradeoff_review.png...');
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
    console.log('2. Selecionando projeto...');
    await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('div, button, span'));
      const karpathyItem = items.find(el => el.textContent?.trim() === 'Karpathy Validation Test' || el.textContent?.trim() === 'AI DEV HUB');
      if (karpathyItem) karpathyItem.click();
    });
    await new Promise(r => setTimeout(r, 2000));

    // Abrir Modal de Benchmarks
    console.log('3. Abrindo Modal AI DEV BENCHMARK...');
    const benchBtn = await page.waitForSelector('#benchmark-modal-btn', { timeout: 5000 });
    await benchBtn.click();
    await new Promise(r => setTimeout(r, 1500));

    // Clicar na aba Self-Improvement Loop
    console.log('4. Clicando na aba Self-Improvement Loop...');
    const selfImpTabBtn = await page.waitForSelector('#tab-btn-self-improvement', { timeout: 5000 });
    await selfImpTabBtn.click();
    await new Promise(r => setTimeout(r, 2000));

    // 57: Self-Improvement com Governance Gate e TRADEOFF_REVIEW
    const targetFile = path.join(screenshotsDir, '57_benchmark_modal_promotion_gate_tradeoff_review.png');
    console.log(`5. Capturando screenshot em ${targetFile}...`);
    await page.screenshot({ path: targetFile });
    fs.copyFileSync(targetFile, path.join(artifactsDir, '57_benchmark_modal_promotion_gate_tradeoff_review.png'));

    console.log('✅ Screenshot 57 capturado com sucesso!');
  } catch (err) {
    console.error('Erro na captura:', err);
  } finally {
    await browser.close();
  }
}

runCapture();
