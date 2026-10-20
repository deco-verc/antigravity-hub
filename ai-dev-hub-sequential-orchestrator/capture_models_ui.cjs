const puppeteer = require('puppeteer-core');
const fs = require('fs');

(async () => {
  const chromePaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe'
  ];
  let exePath = '';
  for (const p of chromePaths) {
    if (fs.existsSync(p)) { exePath = p; break; }
  }
  if (!exePath) {
    console.log('Chrome não encontrado');
    return;
  }

  const browser = await puppeteer.launch({
    executablePath: exePath,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto('http://localhost:3001', { waitUntil: 'networkidle0', timeout: 15000 });

  await page.screenshot({ path: 'C:\\Users\\Deco\\.gemini\\antigravity\\brain\\a626e547-946e-4f2e-a035-83feafc09761\\90_header_model_and_usage.png' });
  console.log('Screenshot 90 salvo');

  // Open model selector
  const modelBtn = await page.$('button[title="Selecionar modelo de IA"]');
  if (modelBtn) {
    await modelBtn.click();
    await new Promise(r => setTimeout(r, 600));
    await page.screenshot({ path: 'C:\\Users\\Deco\\.gemini\\antigravity\\brain\\a626e547-946e-4f2e-a035-83feafc09761\\91_model_dropdown_open.png' });
    console.log('Screenshot 91 salvo');
  }

  // Open Advanced Dashboard -> Modelos & Uso
  const menuBtn = await page.$('button[title="Mais opções do projeto"]');
  if (menuBtn) {
    await menuBtn.click();
    await new Promise(r => setTimeout(r, 500));
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const found = btns.find(b => b.textContent && b.textContent.includes('Painel Avançado'));
      if (found) found.click();
    });
    await new Promise(r => setTimeout(r, 800));
    await page.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll('button'));
      const mTab = tabs.find(t => t.textContent && t.textContent.includes('Modelos & Uso'));
      if (mTab) mTab.click();
    });
    await new Promise(r => setTimeout(r, 1000));
    await page.screenshot({ path: 'C:\\Users\\Deco\\.gemini\\antigravity\\brain\\a626e547-946e-4f2e-a035-83feafc09761\\92_advanced_models_usage_tab.png' });
    console.log('Screenshot 92 salvo');
  }

  await browser.close();
  console.log('Finalizado com sucesso');
})();
