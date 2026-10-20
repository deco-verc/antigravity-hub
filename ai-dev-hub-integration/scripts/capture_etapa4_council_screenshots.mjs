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
  console.log('🚀 Iniciando captura de screenshots do AI DEV Council com:', executablePath);
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
    await new Promise(r => setTimeout(r, 2000));

    // Capture 41: Simple IDE Header with Council button & indicators
    console.log('2. Capturando Simple IDE com botão do Council no header...');
    await page.screenshot({ path: path.join(screenshotsDir, '41_simple_ide_council_button_badge.png') });
    console.log('   📸 Salvo: 41_simple_ide_council_button_badge.png');

    // Click on Council button in top bar
    console.log('3. Abrindo Modal AI DEV Council Deliberation...');
    const councilBtn = await page.waitForSelector('#council-modal-btn', { timeout: 5000 });
    await councilBtn.click();
    await new Promise(r => setTimeout(r, 2000));

    // Capture 42: Council Deliberation Modal Overview (Scores, Chairman Synthesis, Stage 2 Peer Rankings)
    console.log('4. Capturando visão geral do Council Modal (Scores, Chairman, Peer Rankings)...');
    await page.screenshot({ path: path.join(screenshotsDir, '42_council_deliberation_modal_overview.png') });
    console.log('   📸 Salvo: 42_council_deliberation_modal_overview.png');

    // Click on Reviewer B tab (Simplicity - Karpathy)
    console.log('5. Clicando na aba do Reviewer B (Simplicity)...');
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const revB = buttons.find(b => b.textContent?.includes('Review B') || b.textContent?.includes('Simplicity'));
      if (revB) revB.click();
    });
    await new Promise(r => setTimeout(r, 1200));

    // Capture 43: Council Modal with Reviewer B details active
    console.log('6. Capturando detalhes do Reviewer B (Simplicidade & Anti-Bloat)...');
    await page.screenshot({ path: path.join(screenshotsDir, '43_council_modal_reviewer_b_simplicity_tab.png') });
    console.log('   📸 Salvo: 43_council_modal_reviewer_b_simplicity_tab.png');

    console.log('🎉 Todas as capturas de tela do AI DEV Council foram geradas com sucesso!');
  } catch (err) {
    console.error('❌ Erro na captura de tela:', err);
  } finally {
    await browser.close();
  }
}

runCapture();
