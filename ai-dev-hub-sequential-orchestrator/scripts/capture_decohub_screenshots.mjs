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
  console.error('Navegador não encontrado.');
  process.exit(1);
}

const screenshotsDir = 'C:\\Users\\Deco\\.gemini\\antigravity\\brain\\a626e547-946e-4f2e-a035-83feafc09761\\screenshots';
const artifactsDir = 'C:\\Users\\Deco\\.gemini\\antigravity\\brain\\a626e547-946e-4f2e-a035-83feafc09761';

if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}

async function run() {
  console.log('🚀 Iniciando captura das telas do DecoHUB...');
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    defaultViewport: { width: 1560, height: 980 }
  });

  const page = await browser.newPage();
  try {
    await page.goto('http://127.0.0.1:3002', { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 2000));

    // 1. Tela Principal: Visão Geral do DecoHUB
    console.log('Capturando Tela 1: Visão Geral...');
    const fileOverview = path.join(screenshotsDir, '71_decohub_main_overview.png');
    await page.screenshot({ path: fileOverview });
    fs.copyFileSync(fileOverview, path.join(artifactsDir, '71_decohub_main_overview.png'));
    console.log('✓ Screenshot 71 salva: Visão Geral do DecoHUB.');

    // 2. Aba Tarefas
    console.log('Acessando Aba Tarefas...');
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('Tarefas'));
      if (btn) btn.click();
    });
    await new Promise(r => setTimeout(r, 1000));
    const fileTasks = path.join(screenshotsDir, '72_decohub_tasks_tab.png');
    await page.screenshot({ path: fileTasks });
    fs.copyFileSync(fileTasks, path.join(artifactsDir, '72_decohub_tasks_tab.png'));
    console.log('✓ Screenshot 72 salva: Aba Tarefas.');

    // 3. Aba Arquivos
    console.log('Acessando Aba Arquivos...');
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('Arquivos'));
      if (btn) btn.click();
    });
    await new Promise(r => setTimeout(r, 1500));
    // Click on project.md in memory section
    await page.evaluate(() => {
      const docBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('project.md'));
      if (docBtn) docBtn.click();
    });
    await new Promise(r => setTimeout(r, 800));
    const fileFiles = path.join(screenshotsDir, '73_decohub_files_tab.png');
    await page.screenshot({ path: fileFiles });
    fs.copyFileSync(fileFiles, path.join(artifactsDir, '73_decohub_files_tab.png'));
    console.log('✓ Screenshot 73 salva: Aba Arquivos com Memória do Projeto.');

    // 4. Aba Atividade
    console.log('Acessando Aba Atividade...');
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('Atividade'));
      if (btn) btn.click();
    });
    await new Promise(r => setTimeout(r, 1000));
    const fileActivity = path.join(screenshotsDir, '74_decohub_activity_tab.png');
    await page.screenshot({ path: fileActivity });
    fs.copyFileSync(fileActivity, path.join(artifactsDir, '74_decohub_activity_tab.png'));
    console.log('✓ Screenshot 74 salva: Aba Atividade.');

    // 5. Painel Lateral Direito ("Sobre o Projeto")
    console.log('Abrindo Painel Lateral Direito...');
    await page.evaluate(() => {
      const toggleBtn = Array.from(document.querySelectorAll('button')).find(b => b.title?.includes('Sobre o projeto') || b.querySelector('svg'));
      // Find right panel toggle
      const headerBtns = Array.from(document.querySelectorAll('header button'));
      if (headerBtns.length > 0) {
        const lastBtn = headerBtns[headerBtns.length - 1];
        lastBtn.click();
      }
    });
    await new Promise(r => setTimeout(r, 800));
    const fileRightPanel = path.join(screenshotsDir, '75_decohub_right_panel.png');
    await page.screenshot({ path: fileRightPanel });
    fs.copyFileSync(fileRightPanel, path.join(artifactsDir, '75_decohub_right_panel.png'));
    console.log('✓ Screenshot 75 salva: Painel Lateral Direito (Sobre o Projeto).');

    // Fechar painel direito se aberto
    await page.evaluate(() => {
      const closeBtn = document.querySelector('aside button[title="Fechar painel"]');
      if (closeBtn) closeBtn.click();
    });
    await new Promise(r => setTimeout(r, 500));

    // 6. Modo de Trabalho: Clicar no botão "Continuar"
    console.log('Entrando no modo Continuar...');
    await page.evaluate(() => {
      const contBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('Continuar'));
      if (contBtn) contBtn.click();
    });
    await new Promise(r => setTimeout(r, 1000));
    const fileChat = path.join(screenshotsDir, '76_decohub_chat_execution_view.png');
    await page.screenshot({ path: fileChat });
    fs.copyFileSync(fileChat, path.join(artifactsDir, '76_decohub_chat_execution_view.png'));
    console.log('✓ Screenshot 76 salva: Modo Continuar (DecoHUB Chat & Execução).');

    // Voltar à Visão Geral
    await page.evaluate(() => {
      const backBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('Voltar'));
      if (backBtn) backBtn.click();
    });
    await new Promise(r => setTimeout(r, 1000));

    // 7. Modal Avançado
    console.log('Abrindo Painel Avançado...');
    await page.evaluate(() => {
      const advBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('Avançado') || b.title?.includes('Avançado'));
      if (advBtn) advBtn.click();
    });
    await new Promise(r => setTimeout(r, 1500));
    const fileAdvanced = path.join(screenshotsDir, '77_decohub_advanced_dashboard.png');
    await page.screenshot({ path: fileAdvanced });
    fs.copyFileSync(fileAdvanced, path.join(artifactsDir, '77_decohub_advanced_dashboard.png'));
    console.log('✓ Screenshot 77 salva: Painel Avançado (Power Tools).');

    console.log('🎉 Todas as screenshots do DecoHUB capturadas com sucesso!');
  } finally {
    await browser.close();
  }
}

run().catch(err => {
  console.error('Erro na captura:', err);
  process.exit(1);
});
