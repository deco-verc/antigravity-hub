// scripts/capture_reconciled_baseline_screenshots.mjs
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
  console.log('🚀 Capturando screenshots da RECONCILIAÇÃO DA BASELINE LIMPA (AI_DEV_STABLE_V1)...');
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    defaultViewport: { width: 1560, height: 1050 }
  });

  const page = await browser.newPage();

  try {
    await page.goto('http://127.0.0.1:3001', { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 2000));

    // Selecionar projeto
    await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('div, button, span'));
      const item = items.find(el => el.textContent?.trim() === 'Karpathy Validation Test' || el.textContent?.trim() === 'AI DEV HUB');
      if (item) item.click();
    });
    await new Promise(r => setTimeout(r, 2000));

    // Abrir Modal de Benchmarks
    const benchBtn = await page.waitForSelector('#benchmark-modal-btn', { timeout: 5000 });
    await benchBtn.click();
    await new Promise(r => setTimeout(r, 1500));

    // Screenshot 62: Scorecard de AI_DEV_STABLE_V1
    // Selecionar AI_DEV_STABLE_V1 no dropdown
    await page.evaluate(() => {
      const select = document.querySelector('select');
      if (select) {
        const opt = Array.from(select.options).find(o => o.text.includes('AI_DEV_STABLE_V1'));
        if (opt) {
          select.value = opt.value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    });
    await new Promise(r => setTimeout(r, 1500));

    const file62 = path.join(screenshotsDir, '62_reconciled_baseline_scorecard.png');
    await page.screenshot({ path: file62 });
    fs.copyFileSync(file62, path.join(artifactsDir, '62_reconciled_baseline_scorecard.png'));

    // Clicar na aba Autonomous Engine
    const engineTabBtn = await page.waitForSelector('#tab-btn-autonomous-engine', { timeout: 5000 });
    await engineTabBtn.click();
    await new Promise(r => setTimeout(r, 2000));

    // Screenshot 63: Autonomous Engine com Baseline Reconciliada
    const file63 = path.join(screenshotsDir, '63_reconciled_autonomous_dashboard.png');
    await page.screenshot({ path: file63 });
    fs.copyFileSync(file63, path.join(artifactsDir, '63_reconciled_autonomous_dashboard.png'));

    console.log('✅ Screenshots 62 e 63 capturados com sucesso!');
  } catch (err) {
    console.error('Erro na captura:', err);
  } finally {
    await browser.close();
  }
}

runCapture();
