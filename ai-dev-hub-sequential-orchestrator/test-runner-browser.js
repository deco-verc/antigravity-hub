import puppeteer from 'puppeteer-core';
import path from 'node:path';
import fs from 'node:fs';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SCREENSHOTS_DIR = 'C:\\Users\\Deco\\.gemini\\antigravity\\brain\\a626e547-946e-4f2e-a035-83feafc09761\\screenshots';

async function captureAutonomousRunner() {
  console.log('====================================================');
  console.log('📸 CAPTURANDO EVIDÊNCIAS DO AUTONOMOUS RUNNER PERSISTENTE');
  console.log('====================================================');

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,900']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  page.on('console', msg => {
    if (msg.type() === 'error') console.log(`[BROWSER ERROR] ${msg.text()}`);
  });

  try {
    // 1. Navigate to Hub
    console.log('👉 [1/3] Acessando http://localhost:5173...');
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle0', timeout: 15000 });
    await new Promise(r => setTimeout(r, 1000));

    // 2. Select Runner Test Product in project switcher or sidebar if available
    console.log('👉 [2/3] Navegando para a aba Autonomous Build...');
    // Find tab button with text "Autonomous Build" or "Autonomous"
    const buttons = await page.$$('button');
    for (const btn of buttons) {
      const text = await page.evaluate(el => el.textContent, btn);
      if (text && (text.includes('Autonomous Build') || text.includes('Autônomo') || text.includes('Build Autônomo'))) {
        await btn.click();
        break;
      }
    }

    await new Promise(r => setTimeout(r, 2000));

    // Capture main autonomous runner view
    const p1 = path.join(SCREENSHOTS_DIR, '22_autonomous_runner_live_badge.png');
    await page.screenshot({ path: p1 });
    console.log(`   ✓ Screenshot 22 salvo em ${p1}`);

    // Scroll second child of main (AutonomousBuildView) to show DAG and Activity Stream
    await page.evaluate(() => {
      const els = document.querySelectorAll('main > div');
      const container = els[1] || els[0];
      if (container) {
        container.scrollTop = 550;
      }
    });
    await new Promise(r => setTimeout(r, 1000));

    const p2 = path.join(SCREENSHOTS_DIR, '23_autonomous_runner_completed_run.png');
    await page.screenshot({ path: p2 });
    console.log(`   ✓ Screenshot 23 salvo em ${p2}`);

    // Scroll further down to Activity Stream with recovery event
    await page.evaluate(() => {
      const els = document.querySelectorAll('main > div');
      const container = els[1] || els[0];
      if (container) {
        container.scrollTop = 1100;
      }
    });
    await new Promise(r => setTimeout(r, 1000));

    const p3 = path.join(SCREENSHOTS_DIR, '24_autonomous_runner_recovery_event.png');
    await page.screenshot({ path: p3 });
    console.log(`   ✓ Screenshot 24 salvo em ${p3}`);

    console.log('✨ Capturas visuais concluídas com sucesso!');

  } catch (err) {
    console.error('Erro na captura:', err);
  } finally {
    await browser.close();
  }
}

captureAutonomousRunner();
