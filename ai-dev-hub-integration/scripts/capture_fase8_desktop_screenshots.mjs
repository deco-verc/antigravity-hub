// scripts/capture_fase8_desktop_screenshots.mjs
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

if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}

async function runCapture() {
  console.log('🚀 Capturando screenshots da FASE 8: DESKTOP PRODUCTIZATION & RELIABILITY...');
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    defaultViewport: { width: 1560, height: 1000 }
  });

  const page = await browser.newPage();

  try {
    // 1. Screenshot 64: Splash Screen Nativo do Desktop
    const splashFile = path.resolve('desktop', 'splash.html');
    await page.setViewport({ width: 520, height: 380 });
    await page.goto(`file:///${splashFile.replace(/\\/g, '/')}`, { waitUntil: 'load' });
    await new Promise(r => setTimeout(r, 1000));

    const file64 = path.join(screenshotsDir, '64_desktop_native_splash_screen.png');
    await page.screenshot({ path: file64 });
    fs.copyFileSync(file64, path.join(artifactsDir, '64_desktop_native_splash_screen.png'));
    console.log('✓ Screenshot 64 capturada: Splash Screen Nativo.');

    // 2. Screenshot 65: Tela Principal do AI DEV Desktop (Simple IDE sem terminal)
    await page.setViewport({ width: 1560, height: 1000 });
    await page.goto('http://127.0.0.1:3001', { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 2000));

    // Seleciona projeto
    await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('div, button, span'));
      const item = items.find(el => el.textContent?.trim() === 'AI DEV HUB');
      if (item) item.click();
    });
    await new Promise(r => setTimeout(r, 2000));

    const file65 = path.join(screenshotsDir, '65_desktop_simple_ide_main_window.png');
    await page.screenshot({ path: file65 });
    fs.copyFileSync(file65, path.join(artifactsDir, '65_desktop_simple_ide_main_window.png'));
    console.log('✓ Screenshot 65 capturada: Simple IDE Main Window.');

    // 3. Screenshot 66: Health Check & System Diagnostics Modal
    const healthBtn = await page.waitForSelector('#health-check-btn', { timeout: 5000 });
    await healthBtn.click();
    await new Promise(r => setTimeout(r, 1500));

    const file66 = path.join(screenshotsDir, '66_desktop_system_diagnostics_modal.png');
    await page.screenshot({ path: file66 });
    fs.copyFileSync(file66, path.join(artifactsDir, '66_desktop_system_diagnostics_modal.png'));
    console.log('✓ Screenshot 66 capturada: Health Checks Modal.');

    // 4. Screenshot 67: Aba System Diagnostics Ativa
    const diagTabBtn = await page.waitForSelector('#tab-btn-system-diagnostics', { timeout: 5000 });
    await diagTabBtn.click();
    await new Promise(r => setTimeout(r, 1500));

    const file67 = path.join(screenshotsDir, '67_desktop_advanced_diagnostics_tab.png');
    await page.screenshot({ path: file67 });
    fs.copyFileSync(file67, path.join(artifactsDir, '67_desktop_advanced_diagnostics_tab.png'));
    console.log('✓ Screenshot 67 capturada: Advanced System Diagnostics Tab.');

    console.log('🎉 Todas as screenshots da Fase 8 foram capturadas e salvas com sucesso!');
  } catch (err) {
    console.error('Erro na captura:', err);
  } finally {
    await browser.close();
  }
}

runCapture();
