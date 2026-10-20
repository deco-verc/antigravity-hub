import puppeteer from 'puppeteer-core';
import path from 'node:path';
import fs from 'node:fs';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SCREENSHOTS_DIR = 'C:\\Users\\Deco\\.gemini\\antigravity\\brain\\a626e547-946e-4f2e-a035-83feafc09761\\screenshots';

async function capture() {
  console.log('📸 Capturando visual do Habit Tracker no AI DEV HUB...');

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,900']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  try {
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle0', timeout: 15000 });
    await new Promise(r => setTimeout(r, 1500));

    // Click project selector or select Habit Tracker
    const select = await page.$('select');
    if (select) {
      const options = await page.$$eval('select option', opts => opts.map(o => ({ val: o.value, text: o.textContent })));
      const habitOpt = options.find(o => o.text && o.text.includes('Habit Tracker'));
      if (habitOpt) {
        await page.select('select', habitOpt.val);
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    // Click Autonomous Build tab
    const buttons = await page.$$('button');
    for (const btn of buttons) {
      const text = await page.evaluate(el => el.textContent, btn);
      if (text && (text.includes('Autonomous Build') || text.includes('Autônomo') || text.includes('Build Autônomo'))) {
        await btn.click();
        break;
      }
    }

    await new Promise(r => setTimeout(r, 2000));

    const p1 = path.join(SCREENSHOTS_DIR, '25_habit_tracker_completed_dag.png');
    await page.screenshot({ path: p1 });
    console.log(`✓ Salvo: ${p1}`);

    // Scroll to see Activity Stream & Supervisor Reviews
    await page.evaluate(() => {
      const els = document.querySelectorAll('main > div');
      const container = els[1] || els[0];
      if (container) {
        container.scrollTop = 700;
      }
    });
    await new Promise(r => setTimeout(r, 1000));

    const p2 = path.join(SCREENSHOTS_DIR, '26_habit_tracker_activity_stream.png');
    await page.screenshot({ path: p2 });
    console.log(`✓ Salvo: ${p2}`);

  } catch (err) {
    console.error('Erro:', err);
  } finally {
    await browser.close();
  }
}

capture();
