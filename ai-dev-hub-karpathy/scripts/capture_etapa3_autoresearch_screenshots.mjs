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
if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}

async function runCapture() {
  console.log('🚀 Iniciando captura de screenshots do Autoresearch com:', executablePath);
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

    // 1.5 Click on "Karpathy Validation Test" project in sidebar
    console.log('1.5 Selecionando projeto Karpathy Validation Test...');
    await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('div, button, span'));
      const karpathyItem = items.find(el => el.textContent?.trim() === 'Karpathy Validation Test');
      if (karpathyItem) {
        karpathyItem.click();
      }
    });
    await new Promise(r => setTimeout(r, 1500));

    // Capture 38: Simple IDE Header with Research button & mode dropdown
    console.log('2. Capturando Simple IDE com botão Research no header e modo de execução...');
    await page.screenshot({ path: path.join(screenshotsDir, '38_simple_ide_research_mode_button.png') });
    console.log('   📸 Salvo: 38_simple_ide_research_mode_button.png');

    // Click on Research button in header
    console.log('3. Abrindo Modal Autoresearch...');
    const researchBtn = await page.waitForSelector('#research-run-btn', { timeout: 5000 });
    await researchBtn.click();
    await new Promise(r => setTimeout(r, 2000));

    // Capture 39: Autoresearch Dashboard with real metrics and ledger
    console.log('4. Capturando Dashboard Autoresearch (Métricas, Baseline, KEEP, DISCARD, CRASH)...');
    await page.screenshot({ path: path.join(screenshotsDir, '39_autoresearch_dashboard_modal.png') });
    console.log('   📸 Salvo: 39_autoresearch_dashboard_modal.png');

    // Click "+ Novo Run" to show form
    console.log('5. Clicando em "+ Novo Run" para exibir formulário de configuração...');
    const novoRunBtn = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const target = btns.find(b => b.textContent?.includes('+ Novo Run'));
      if (target) {
        target.click();
        return true;
      }
      return false;
    });

    await new Promise(r => setTimeout(r, 1000));

    // Capture 40: New Research Run Configuration Form
    console.log('6. Capturando Formulário de Configuração de Novo Research Run...');
    await page.screenshot({ path: path.join(screenshotsDir, '40_autoresearch_new_run_config.png') });
    console.log('   📸 Salvo: 40_autoresearch_new_run_config.png');

    console.log('✨ Todas as screenshots da Etapa 3 foram capturadas com sucesso!');
  } catch (err) {
    console.error('Erro na captura:', err);
  } finally {
    await browser.close();
  }
}

runCapture();
