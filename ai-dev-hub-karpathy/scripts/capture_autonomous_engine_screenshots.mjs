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
  console.log('🚀 Iniciando captura dos screenshots do AUTONOMOUS SELF-IMPROVEMENT ENGINE...');
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

    // Clicar na aba Autonomous Engine
    console.log('4. Clicando na aba Autonomous Engine...');
    const engineTabBtn = await page.waitForSelector('#tab-btn-autonomous-engine', { timeout: 5000 });
    await engineTabBtn.click();
    await new Promise(r => setTimeout(r, 2000));

    // 58: Dashboard do Autonomous Engine
    const targetFile58 = path.join(screenshotsDir, '58_autonomous_engine_dashboard.png');
    console.log(`5. Capturando screenshot em ${targetFile58}...`);
    await page.screenshot({ path: targetFile58 });
    fs.copyFileSync(targetFile58, path.join(artifactsDir, '58_autonomous_engine_dashboard.png'));

    // Clicar no botão "Morning Report"
    console.log('6. Abrindo Morning Report modal...');
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const reportBtn = buttons.find(b => b.textContent?.includes('Morning Report'));
      if (reportBtn) reportBtn.click();
    });
    await new Promise(r => setTimeout(r, 1500));

    // 59: Morning Report Overlay Modal
    const targetFile59 = path.join(screenshotsDir, '59_autonomous_engine_timeline_report.png');
    console.log(`7. Capturando screenshot em ${targetFile59}...`);
    await page.screenshot({ path: targetFile59 });
    fs.copyFileSync(targetFile59, path.join(artifactsDir, '59_autonomous_engine_timeline_report.png'));

    console.log('✅ Screenshots 58 e 59 capturados com sucesso!');
  } catch (err) {
    console.error('Erro na captura:', err);
  } finally {
    await browser.close();
  }
}

runCapture();
