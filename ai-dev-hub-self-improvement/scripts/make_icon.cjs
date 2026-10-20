const puppeteer = require('puppeteer-core');
const path = require('path');

async function makeIcon() {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new',
    args: ['--no-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 256, height: 256 });
  const html = `
    <!DOCTYPE html>
    <html>
      <body style="margin:0;padding:0;background:transparent;display:flex;align-items:center;justify-content:center;height:256px;">
        <div style="width:220px;height:220px;border-radius:48px;background:linear-gradient(135deg, #4f46e5 0%, #06b6d4 100%);display:flex;align-items:center;justify-content:center;box-shadow:0 12px 32px rgba(79,70,229,0.5);">
          <svg width="120" height="120" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
          </svg>
        </div>
      </body>
    </html>
  `;
  await page.setContent(html);
  const outPath = path.resolve(__dirname, '..', 'desktop', 'assets', 'icon.png');
  await page.screenshot({ path: outPath, omitBackground: true });
  await browser.close();
  console.log(`Icon created at ${outPath}`);
}

makeIcon();
