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
  console.log(`🌐 Iniciando auditoria visual com navegador: ${executablePath}`);
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    defaultViewport: { width: 1440, height: 900 }
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
    await page.screenshot({ path: path.join(screenshotsDir, '12_phase3_overview.png') });
    console.log('   📸 Screenshot salva: 12_phase3_overview.png');

    // 2. Click Agent Context Tab
    console.log('2. Clicando na aba "Agent Context (MCP)"...');
    const agentTabBtn = await page.waitForSelector('button ::-p-text(Agent Context)');
    await agentTabBtn.click();
    await new Promise(r => setTimeout(r, 1000));
    await page.screenshot({ path: path.join(screenshotsDir, '13_agent_context_tab.png') });
    console.log('   📸 Screenshot salva: 13_agent_context_tab.png');

    // 3. Switch to Compact mode
    console.log('3. Testando modo Compact...');
    const compactBtn = await page.waitForSelector('button ::-p-text(Compact)');
    await compactBtn.click();
    await new Promise(r => setTimeout(r, 500));
    await page.screenshot({ path: path.join(screenshotsDir, '14_agent_context_compact.png') });
    console.log('   📸 Screenshot salva: 14_agent_context_compact.png');

    // 4. Open Handover modal
    console.log('4. Clicando em "Handover Prompt"...');
    const handoverBtn = await page.waitForSelector('button ::-p-text(Handover Prompt)');
    await handoverBtn.click();
    await new Promise(r => setTimeout(r, 500));
    await page.screenshot({ path: path.join(screenshotsDir, '15_handover_prompt_modal.png') });
    console.log('   📸 Screenshot salva: 15_handover_prompt_modal.png');

    // Close Handover modal
    const closeBtn = await page.waitForSelector('button ::-p-text(Fechar)');
    await closeBtn.click();
    await new Promise(r => setTimeout(r, 500));

    // 5. Navigate to System Health
    console.log('5. Clicando na aba "System Health"...');
    const healthTabBtn = await page.waitForSelector('button ::-p-text(System Health)');
    await healthTabBtn.click();
    await new Promise(r => setTimeout(r, 1000));
    await page.screenshot({ path: path.join(screenshotsDir, '16_system_health_mcp.png') });
    console.log('   📸 Screenshot salva: 16_system_health_mcp.png');

    // 6. Test MCP Server button in UI
    console.log('6. Clicando no botão "[TESTAR SERVIDOR MCP]" na interface...');
    const testMcpBtn = await page.waitForSelector('button ::-p-text(TESTAR SERVIDOR MCP)');
    await testMcpBtn.click();
    await new Promise(r => setTimeout(r, 1500));
    await page.screenshot({ path: path.join(screenshotsDir, '17_mcp_tested_in_ui.png') });
    console.log('   📸 Screenshot salva: 17_mcp_tested_in_ui.png');

    console.log('\n📊 ERROS DETECTADOS NO CONSOLE DO NAVEGADOR:');
    if (consoleErrors.length === 0) {
      console.log('   🎉 ZERO ERROS NO CONSOLE! Interface 100% íntegra.');
    } else {
      console.log(`   ⚠️ ${consoleErrors.length} erros detectados:`);
      consoleErrors.forEach(e => console.log('     -', e));
    }
  } finally {
    await browser.close();
  }
}

runVisualAudit().catch(err => {
  console.error('Erro na auditoria visual:', err);
  process.exit(1);
});
