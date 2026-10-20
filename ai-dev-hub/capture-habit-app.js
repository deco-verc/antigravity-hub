import puppeteer from 'puppeteer-core';
import path from 'node:path';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SCREENSHOTS_DIR = 'C:\\Users\\Deco\\.gemini\\antigravity\\brain\\a626e547-946e-4f2e-a035-83feafc09761\\screenshots';

async function capture() {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1200,800']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 800 });

  try {
    await page.goto('file:///C:/IA/test-projects/habit-tracker/index.html', { waitUntil: 'load' });
    await new Promise(r => setTimeout(r, 1000));

    // Interact with the app: Add a habit!
    await page.type('#habit-input', 'Estudar Inteligência Artificial');
    await page.select('#habit-category', 'estudos');
    await page.click('#add-habit-btn');
    await new Promise(r => setTimeout(r, 500));

    // Add another habit and mark it
    await page.type('#habit-input', 'Exercícios matinais 30 min');
    await page.select('#habit-category', 'saude');
    await page.click('#add-habit-btn');
    await new Promise(r => setTimeout(r, 500));

    // Click the toggle button for today on the first card
    const toggleBtns = await page.$$('.toggle-today-btn');
    if (toggleBtns.length > 0) {
      await toggleBtns[0].click();
      await new Promise(r => setTimeout(r, 500));
    }

    const p = path.join(SCREENSHOTS_DIR, '27_habit_tracker_live_app.png');
    await page.screenshot({ path: p });
    console.log(`✓ Screenshot do Habit Tracker salvo em: ${p}`);
  } catch (err) {
    console.error('Erro:', err);
  } finally {
    await browser.close();
  }
}

capture();
