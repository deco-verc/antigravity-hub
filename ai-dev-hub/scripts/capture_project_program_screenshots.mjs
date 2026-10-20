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
  console.log('🚀 Iniciando captura de screenshots com:', executablePath);
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

    // Capture 1: Simple IDE with Project Program button visible in header
    console.log('2. Capturando Simple IDE com botão Project Program...');
    await page.screenshot({ path: path.join(screenshotsDir, '32_simple_ide_project_program_button.png') });
    console.log('   📸 Salvo: 32_simple_ide_project_program_button.png');

    // Click Project Program button
    console.log('3. Abrindo modal Settings → Project Program...');
    const programBtn = await page.waitForSelector('#project-program-btn', { timeout: 5000 });
    await programBtn.click();
    await new Promise(r => setTimeout(r, 1500));

    // Capture 2: Project Program Modal (program.md active tab)
    console.log('4. Capturando Project Program Modal...');
    await page.screenshot({ path: path.join(screenshotsDir, '33_project_program_modal.png') });
    console.log('   📸 Salvo: 33_project_program_modal.png');

    // Click tab Global Agent Guidelines
    console.log('5. Clicando na aba Global Agent Guidelines...');
    const guidelinesTabBtn = await page.waitForSelector('button ::-p-text(Global Agent Guidelines)');
    await guidelinesTabBtn.click();
    await new Promise(r => setTimeout(r, 1000));

    // Capture 3: Global Guidelines tab
    console.log('6. Capturando aba Global Agent Guidelines...');
    await page.screenshot({ path: path.join(screenshotsDir, '34_global_guidelines_tab.png') });
    console.log('   📸 Salvo: 34_global_guidelines_tab.png');

    console.log('✅ Todas as screenshots foram capturadas com sucesso!');
  } catch (err) {
    console.error('❌ Erro na captura:', err);
  } finally {
    await browser.close();
  }
}

runCapture();
