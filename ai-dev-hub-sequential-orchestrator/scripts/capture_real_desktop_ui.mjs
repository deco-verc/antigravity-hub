import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const possibleChromePaths = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  (process.env.LOCALAPPDATA || '') + '\\Google\\Chrome\\Application\\chrome.exe'
];

const executablePath = possibleChromePaths.find(p => fs.existsSync(p));
if (!executablePath) {
  console.error('Navegador não encontrado nos caminhos padrão.');
  process.exit(1);
}

const artifactsDir = 'C:\\Users\\Deco\\.gemini\\antigravity\\brain\\57373b6a-c040-4b1d-a84f-fa5945a05711';
const screenshotsDir = path.join(artifactsDir, 'screenshots');
if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function run() {
  console.log('🚀 Iniciando validação visual e captura de telas reais do DecoHUB UI...');
  console.log(`Usando navegador: ${executablePath}`);

  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    defaultViewport: { width: 1560, height: 980 },
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

  try {
    console.log('Carregando DecoHUB em http://127.0.0.1:3001...');
    await page.goto('http://127.0.0.1:3001', { waitUntil: 'networkidle2' });
    await sleep(2500);

    // 1. Selecionar Projeto "Aplicativo de Tarefas"
    console.log('Selecionando projeto Aplicativo de Tarefas na barra lateral...');
    await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('button, div'));
      const projItem = items.find(el => el.textContent?.includes('Aplicativo de Tarefas'));
      if (projItem) projItem.click();
    });
    await sleep(2000);

    // Screen 1: Visão Geral do Projeto
    console.log('Capturando Tela 1: Visão Geral do Projeto...');
    const f1 = path.join(screenshotsDir, '01_decohub_gui_overview.png');
    await page.screenshot({ path: f1 });
    fs.copyFileSync(f1, path.join(artifactsDir, '01_decohub_gui_overview.png'));
    console.log('  ✔ Salva Tela 1: 01_decohub_gui_overview.png');

    // Screen 2: Aba Tarefas
    console.log('Navegando para Aba Tarefas...');
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const btn = btns.find(b => b.textContent?.trim() === 'Tarefas');
      if (btn) btn.click();
    });
    await sleep(1500);
    const f2 = path.join(screenshotsDir, '02_decohub_gui_tasks.png');
    await page.screenshot({ path: f2 });
    fs.copyFileSync(f2, path.join(artifactsDir, '02_decohub_gui_tasks.png'));
    console.log('  ✔ Salva Tela 2: 02_decohub_gui_tasks.png');

    // Screen 3: Aba Arquivos
    console.log('Navegando para Aba Arquivos...');
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const btn = btns.find(b => b.textContent?.trim() === 'Arquivos');
      if (btn) btn.click();
    });
    await sleep(1500);
    const f3 = path.join(screenshotsDir, '03_decohub_gui_files.png');
    await page.screenshot({ path: f3 });
    fs.copyFileSync(f3, path.join(artifactsDir, '03_decohub_gui_files.png'));
    console.log('  ✔ Salva Tela 3: 03_decohub_gui_files.png');

    // Screen 4: Aba Atividade
    console.log('Navegando para Aba Atividade...');
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const btn = btns.find(b => b.textContent?.trim() === 'Atividade');
      if (btn) btn.click();
    });
    await sleep(1500);
    const f4 = path.join(screenshotsDir, '04_decohub_gui_activity.png');
    await page.screenshot({ path: f4 });
    fs.copyFileSync(f4, path.join(artifactsDir, '04_decohub_gui_activity.png'));
    console.log('  ✔ Salva Tela 4: 04_decohub_gui_activity.png');

    // Screen 5: Gerenciador de Contas (Modal)
    console.log('Abrindo Gerenciador de Contas Google...');
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const btn = btns.find(b => b.textContent?.includes('GERENCIADOR') || b.textContent?.includes('Contas') || b.title?.includes('Gerenciador de Contas'));
      if (btn) btn.click();
    });
    await sleep(1500);
    const f5 = path.join(screenshotsDir, '05_decohub_gui_account_manager.png');
    await page.screenshot({ path: f5 });
    fs.copyFileSync(f5, path.join(artifactsDir, '05_decohub_gui_account_manager.png'));
    console.log('  ✔ Salva Tela 5: 05_decohub_gui_account_manager.png');

    // Fechar Modal de Contas
    await page.evaluate(() => {
      const closeBtn = document.querySelector('button[aria-label="Fechar"], button:has(svg.lucide-x)');
      if (closeBtn) closeBtn.click();
    });
    await sleep(1000);

    // Screen 6: Modo Continuar / Chat e DAG Autônomo
    console.log('Abrindo Modo Continuar / Chat e DAG Autônomo...');
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const btn = btns.find(b => b.textContent?.includes('Continuar'));
      if (btn) btn.click();
    });
    await sleep(2000);
    const f6 = path.join(screenshotsDir, '06_decohub_gui_chat_and_autonomous_dag.png');
    await page.screenshot({ path: f6 });
    fs.copyFileSync(f6, path.join(artifactsDir, '06_decohub_gui_chat_and_autonomous_dag.png'));
    console.log('  ✔ Salva Tela 6: 06_decohub_gui_chat_and_autonomous_dag.png');

    // Screen 7: Painel Avançado
    console.log('Abrindo Painel Avançado...');
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const btn = btns.find(b => b.textContent?.includes('Painel Avançado'));
      if (btn) btn.click();
    });
    await sleep(1500);
    const f7 = path.join(screenshotsDir, '07_decohub_gui_advanced_dashboard.png');
    await page.screenshot({ path: f7 });
    fs.copyFileSync(f7, path.join(artifactsDir, '07_decohub_gui_advanced_dashboard.png'));
    console.log('  ✔ Salva Tela 7: 07_decohub_gui_advanced_dashboard.png');

    console.log('\n======================================================');
    console.log('🎉 TODAS AS 7 TELAS DO DECOHUB FORAM CAPTURADAS COM SUCESSO!');
    console.log('======================================================');
  } catch (err) {
    console.error('❌ Erro durante a captura de telas:', err);
    throw err;
  } finally {
    await browser.close();
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
