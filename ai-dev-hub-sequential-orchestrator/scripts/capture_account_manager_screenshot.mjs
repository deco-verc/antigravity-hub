// scripts/capture_account_manager_screenshot.mjs
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

async function run() {
  console.log('🚀 Capturando evidência do Gerenciador de Contas...');
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    defaultViewport: { width: 1560, height: 1000 }
  });

  const page = await browser.newPage();
  try {
    await page.goto('http://127.0.0.1:3002', { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 2000));

    // 1. Clicar no seletor de contas
    console.log('Abrindo dropdown de contas...');
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.title?.includes('Conta Google'));
      if (btn) btn.click();
    });
    await new Promise(r => setTimeout(r, 1000));

    // Capturar dropdown aberto com o botão "GERENCIADOR DE CONTAS"
    const fileDropdown = path.join(screenshotsDir, '68_account_dropdown_with_manager.png');
    await page.screenshot({ path: fileDropdown });
    fs.copyFileSync(fileDropdown, path.join(artifactsDir, '68_account_dropdown_with_manager.png'));
    console.log('✓ Screenshot 68 capturada: Dropdown de Contas com botão Gerenciador de Contas.');

    // 2. Clicar em "GERENCIADOR DE CONTAS"
    console.log('Abrindo modal Gerenciador de Contas...');
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('GERENCIADOR DE CONTAS'));
      if (btn) btn.click();
    });
    await new Promise(r => setTimeout(r, 1500));

    // Capturar modal Gerenciador de Contas
    const fileModal = path.join(screenshotsDir, '69_account_manager_modal.png');
    await page.screenshot({ path: fileModal });
    fs.copyFileSync(fileModal, path.join(artifactsDir, '69_account_manager_modal.png'));
    console.log('✓ Screenshot 69 capturada: Modal Gerenciador de Contas (Minhas Contas).');

    // 3. Clicar na aba "+ Adicionar Conta"
    console.log('Abrindo aba Adicionar Conta...');
    await page.evaluate(() => {
      const tab = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('Adicionar Conta'));
      if (tab) tab.click();
    });
    await new Promise(r => setTimeout(r, 1000));

    const fileAddTab = path.join(screenshotsDir, '70_account_manager_add_tab.png');
    await page.screenshot({ path: fileAddTab });
    fs.copyFileSync(fileAddTab, path.join(artifactsDir, '70_account_manager_add_tab.png'));
    console.log('✓ Screenshot 70 capturada: Modal Gerenciador de Contas (Aba Adicionar Conta).');

    console.log('🎉 Todas as evidências visuais capturadas com sucesso!');
  } finally {
    await browser.close();
  }
}

run().catch(err => {
  console.error('Erro na captura:', err);
  process.exit(1);
});
