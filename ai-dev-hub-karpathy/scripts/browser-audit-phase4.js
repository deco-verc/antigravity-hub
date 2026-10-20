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
  console.error('Nenhum navegador encontrado em caminhos padrão.');
  process.exit(1);
}

const screenshotsDir = 'C:\\Users\\Deco\\.gemini\\antigravity\\brain\\a626e547-946e-4f2e-a035-83feafc09761\\screenshots';
if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}

async function runVisualAudit() {
  console.log(`🌐 [Fase 4] Iniciando auditoria visual com navegador: ${executablePath}`);
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    defaultViewport: { width: 1560, height: 1000 }
  });

  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });
  page.on('pageerror', err => {
    consoleErrors.push(err.message);
  });

  try {
    // 1. Open App
    console.log('1. Acessando http://localhost:5173...');
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 1500));

    // 2. Click Autonomous Build Tab
    console.log('2. Clicando na aba "Autonomous Build"...');
    const autonomousTabBtn = await page.waitForSelector('button ::-p-text(Autonomous Build)');
    await autonomousTabBtn.click();
    await new Promise(r => setTimeout(r, 1500));

    // 3. Screenshot: Autonomous Dashboard
    console.log('3. Capturando Dashboard Autônomo...');
    const dashPath = path.join(screenshotsDir, '18_autonomous_dashboard.png');
    await page.screenshot({ path: dashPath });
    console.log(`   📸 Screenshot salva: 18_autonomous_dashboard.png`);

    // 4. Inspecionar Approval Inbox
    console.log('4. Inspecionando Approval Inbox...');
    // We can evaluate in page whether the approval inbox is visible
    const hasInbox = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('h3')).some(h => h.textContent?.includes('Approval Inbox'));
    });

    if (hasInbox) {
      console.log('   -> Approval Inbox visível na interface.');
      await page.evaluate(() => {
        const el = Array.from(document.querySelectorAll('h3')).find(h => h.textContent?.includes('Approval Inbox'));
        el?.scrollIntoView({ behavior: 'instant', block: 'center' });
      });
      await new Promise(r => setTimeout(r, 600));
    }
    const inboxPath = path.join(screenshotsDir, '19_autonomous_approval_inbox.png');
    await page.screenshot({ path: inboxPath });
    console.log(`   📸 Screenshot salva: 19_autonomous_approval_inbox.png`);

    // 5. Open Overnight Report Modal
    console.log('5. Clicando em "Overnight Report"...');
    // Scroll back to top
    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise(r => setTimeout(r, 400));

    const reportBtn = await page.$('button ::-p-text(Overnight Report)');
    if (reportBtn) {
      await reportBtn.click();
      await new Promise(r => setTimeout(r, 1200));
      const reportPath = path.join(screenshotsDir, '20_autonomous_report.png');
      await page.screenshot({ path: reportPath });
      console.log(`   📸 Screenshot salva: 20_autonomous_report.png`);

      // Close modal
      const closeBtn = await page.$('button ::-p-text(Fechar)');
      if (closeBtn) {
        await closeBtn.click();
        await new Promise(r => setTimeout(r, 500));
      }
    } else {
      console.log('   ⚠️ Botão Overnight Report não encontrado.');
    }

    // 6. Test New Autonomous Build Modal with Preset Overnight
    console.log('6. Testando Modal de Novo Build...');
    // If no new build button is shown because activeRun is running, we can check or stop it
    const newBuildBtn = await page.$('button ::-p-text(NOVO BUILD AUTÔNOMO)');
    if (newBuildBtn) {
      await newBuildBtn.click();
      await new Promise(r => setTimeout(r, 1000));
      const modalPath = path.join(screenshotsDir, '21_autonomous_overnight_modal.png');
      await page.screenshot({ path: modalPath });
      console.log(`   📸 Screenshot salva: 21_autonomous_overnight_modal.png`);
    } else {
      console.log('   ℹ️ Build atual está em andamento (Active Run em execução).');
    }

    console.log('\n====================================================');
    console.log('✅ AUDITORIA VISUAL DA FASE 4 CONCLUÍDA COM SUCESSO!');
    console.log(`Console Errors detectados: ${consoleErrors.length}`);
    if (consoleErrors.length > 0) {
      console.warn('⚠️ Console errors:', consoleErrors);
    }
    console.log('====================================================');

  } catch (err) {
    console.error('❌ Erro na auditoria visual:', err);
  } finally {
    await browser.close();
  }
}

runVisualAudit();
