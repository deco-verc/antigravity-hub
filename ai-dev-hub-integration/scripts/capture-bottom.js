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
const screenshotsDir = 'C:\\Users\\Deco\\.gemini\\antigravity\\brain\\a626e547-946e-4f2e-a035-83feafc09761\\screenshots';

async function run() {
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    defaultViewport: { width: 1560, height: 1100 }
  });

  const page = await browser.newPage();
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1200));

  const autonomousTabBtn = await page.waitForSelector('button ::-p-text(Autonomous Build)');
  await autonomousTabBtn.click();
  await new Promise(r => setTimeout(r, 1200));

  // Scroll down to the Task Graph & Activity Stream
  await page.evaluate(() => {
    const scrollables = Array.from(document.querySelectorAll('*')).filter(el => {
      const style = window.getComputedStyle(el);
      return (style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight;
    });
    scrollables.forEach(s => s.scrollTop = 900);
    window.scrollBy(0, 900);
  });
  await new Promise(r => setTimeout(r, 600));

  const bottomPath = path.join(screenshotsDir, '21_autonomous_dag_and_stream.png');
  await page.screenshot({ path: bottomPath });
  console.log(`Saved: 21_autonomous_dag_and_stream.png`);

  await browser.close();
}

run();
