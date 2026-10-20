import puppeteer from 'puppeteer-core';
import path from 'node:path';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SCREENSHOTS_DIR = 'C:\\Users\\Deco\\.gemini\\antigravity\\brain\\a626e547-946e-4f2e-a035-83feafc09761\\screenshots';

async function capture() {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,850']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 850 });

  try {
    // 1. Capture AI DEV HUB Simple Mode UI
    console.log('Navigating to http://localhost:5173...');
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle0', timeout: 15000 });
    await new Promise(r => setTimeout(r, 2000));

    // Select the "Multi Account Test" project from sidebar if not active
    const projectItems = await page.$$('.space-y-1 button, nav button, aside button');
    for (const btn of projectItems) {
      const text = await page.evaluate(el => el.textContent, btn);
      if (text && text.includes('Multi Account Test')) {
        await btn.click();
        await new Promise(r => setTimeout(r, 1000));
        break;
      }
    }

    // 1. Screenshot: Simple Chat View with Account Dropdown in top bar
    const p1 = path.join(SCREENSHOTS_DIR, '28_simple_chat_mode_account_a.png');
    await page.screenshot({ path: p1 });
    console.log('Captured:', p1);

    // 2. Open Account Dropdown
    const dropdownBtn = await page.$('button[title*="conta"], header button.rounded-xl');
    // find dropdown trigger by looking for Google Pro text
    const buttons = await page.$$('header button');
    for (const b of buttons) {
      const t = await page.evaluate(el => el.textContent, b);
      if (t && (t.includes('Google Pro') || t.includes('Conta'))) {
        await b.click();
        await new Promise(r => setTimeout(r, 800));
        break;
      }
    }
    const p2 = path.join(SCREENSHOTS_DIR, '29_account_dropdown_open.png');
    await page.screenshot({ path: p2 });
    console.log('Captured:', p2);

    // 3. Open Add Account Modal
    const addAccountBtn = await page.$('button[title*="Adicionar"], button:has-text("+ ADICIONAR CONTA")');
    const allBtns = await page.$$('button');
    for (const b of allBtns) {
      const t = await page.evaluate(el => el.textContent, b);
      if (t && t.includes('ADICIONAR CONTA')) {
        await b.click();
        await new Promise(r => setTimeout(r, 800));
        break;
      }
    }
    const p3 = path.join(SCREENSHOTS_DIR, '30_add_account_modal.png');
    await page.screenshot({ path: p3 });
    console.log('Captured:', p3);

    // 4. Capture Live Multi-Account Task Manager App
    await page.goto('file:///C:/IA/test-projects/multi-account-test/index.html', { waitUntil: 'load' });
    await new Promise(r => setTimeout(r, 1000));

    // Add sample tasks to visually showcase badges and filters
    await page.type('#task-input', 'Configurar autenticação multi-conta Antigravity');
    await page.click('#add-btn');
    await new Promise(r => setTimeout(r, 400));

    await page.type('#task-input', 'Adicionar suporte a filtros e badges dinâmicos');
    await page.click('#add-btn');
    await new Promise(r => setTimeout(r, 400));

    await page.type('#task-input', 'Validar persistência e limpeza em lote');
    await page.click('#add-btn');
    await new Promise(r => setTimeout(r, 400));

    // Mark the second task as completed
    const checkboxes = await page.$$('.task-checkbox');
    if (checkboxes.length >= 2) {
      await checkboxes[1].click();
      await new Promise(r => setTimeout(r, 400));
    }

    const p4 = path.join(SCREENSHOTS_DIR, '31_multi_account_live_app.png');
    await page.screenshot({ path: p4 });
    console.log('Captured:', p4);

  } catch (err) {
    console.error('Error in capture:', err);
  } finally {
    await browser.close();
  }
}

capture();
