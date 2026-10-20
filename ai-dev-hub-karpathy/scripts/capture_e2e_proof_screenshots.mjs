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
  console.log('🚀 Capturando screenshots da VALIDAÇÃO E2E FINAL CONCLUÍDA (COMPLETED)...');
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

    // Clicar na aba Autonomous Engine
    const engineTabBtn = await page.waitForSelector('#tab-btn-autonomous-engine', { timeout: 5000 });
    await engineTabBtn.click();
    await new Promise(r => setTimeout(r, 2000));

    // Screenshot 60: Dashboard com Status COMPLETED e completed_experiments = 1
    const file60 = path.join(screenshotsDir, '60_e2e_proof_run_completed_dashboard.png');
    await page.screenshot({ path: file60 });
    fs.copyFileSync(file60, path.join(artifactsDir, '60_e2e_proof_run_completed_dashboard.png'));

    // Clicar no botão "Morning Report"
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const reportBtn = buttons.find(b => b.textContent?.includes('Morning Report'));
      if (reportBtn) reportBtn.click();
    });
    await new Promise(r => setTimeout(r, 1500));

    // Screenshot 61: Morning Report da Rodada E2E Concluída
    const file61 = path.join(screenshotsDir, '61_e2e_proof_morning_report_modal.png');
    await page.screenshot({ path: file61 });
    fs.copyFileSync(file61, path.join(artifactsDir, '61_e2e_proof_morning_report_modal.png'));

    console.log('✅ Screenshots 60 e 61 capturados com sucesso!');
  } catch (err) {
    console.error('Erro na captura:', err);
  } finally {
    await browser.close();
  }
}

runCapture();
