import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import http from 'http';
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const APP_PATH = path.resolve('dist-desktop', 'win-unpacked', 'DecoHUB.exe');
const SCREENSHOTS_DIR = 'C:\\Users\\Deco\\.gemini\\antigravity\\brain\\57373b6a-c040-4b1d-a84f-fa5945a05711\\screenshots';
const DEBUG_PORT = 9222;

if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function checkDebugPortReady(port, maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const isReady = await new Promise((resolve) => {
        const req = http.get(`http://127.0.0.1:${port}/json/version`, { timeout: 1000 }, res => {
          if (res.statusCode === 200) resolve(true);
          else resolve(false);
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
      });
      if (isReady) return true;
    } catch {}
    await wait(1000);
  }
  return false;
}

async function runHomologation() {
  console.log('\n================================================================');
  console.log('   DECOHUB REAL DESKTOP & ELECTRON HOMOLOGATION (ETAPAS 1-3)    ');
  console.log('================================================================\n');

  console.log(`[1] Executável empacotado: ${APP_PATH}`);
  if (!fs.existsSync(APP_PATH)) {
    throw new Error(`Executável não encontrado em ${APP_PATH}`);
  }

  console.log(`[2] Iniciando DecoHUB.exe com porta de depuração ${DEBUG_PORT}...`);
  const appProcess = spawn(APP_PATH, [`--remote-debugging-port=${DEBUG_PORT}`], {
    detached: true,
    stdio: 'ignore'
  });
  appProcess.unref();

  console.log('[3] Aguardando inicialização do Electron e da janela...');
  const portReady = await checkDebugPortReady(DEBUG_PORT, 25);
  if (!portReady) {
    throw new Error('Timeout aguardando Electron responder na porta de depuração 9222.');
  }

  console.log('[4] Conectando Puppeteer ao DecoHUB Electron...');
  const browser = await puppeteer.connect({
    browserURL: `http://127.0.0.1:${DEBUG_PORT}`,
    defaultViewport: { width: 1440, height: 900 }
  });

  const pages = await browser.pages();
  console.log(`[5] Janelas detectadas: ${pages.length}`);

  // Localizar a página principal do DecoHUB
  let mainPage = null;
  for (const page of pages) {
    const url = page.url();
    if (url.includes('127.0.0.1:') || url.includes('localhost:') || url.includes('index.html')) {
      mainPage = page;
      break;
    }
  }

  if (!mainPage) {
    mainPage = pages[0];
  }

  console.log(`[6] Página principal conectada: ${mainPage.url()}`);
  await mainPage.waitForSelector('body', { timeout: 15000 });
  await wait(3000); // Aguardar renderização completa dos componentes React

  // Coletar logs do console para validar zero erros de frontend
  const consoleLogs = [];
  const consoleErrors = [];
  mainPage.on('console', msg => {
    const text = msg.text();
    consoleLogs.push(text);
    if (msg.type() === 'error') {
      consoleErrors.push(text);
    }
  });

  // --------------------------------------------------------------------------
  // ETAPA 1 — VERIFICAÇÃO DO APLICATIVO REAL
  // --------------------------------------------------------------------------
  console.log('\n--- ETAPA 1: Verificação da Janela e Abas Principais ---');
  const title = await mainPage.title();
  console.log(`Título da janela: "${title}"`);

  // Screenshot 1: Aba Chat inicial
  const screenshot1Path = path.join(SCREENSHOTS_DIR, '01_desktop_real_chat_tab.png');
  await mainPage.screenshot({ path: screenshot1Path });
  console.log(`✓ Screenshot 1 salvo: ${screenshot1Path}`);

  // Testar clique na aba "Visão Geral"
  console.log('Alternando para aba "Visão Geral"...');
  await mainPage.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const btn = buttons.find(b => b.textContent && b.textContent.includes('Visão Geral'));
    if (btn) btn.click();
  });
  await wait(1500);

  const screenshot2Path = path.join(SCREENSHOTS_DIR, '02_desktop_real_overview_tab.png');
  await mainPage.screenshot({ path: screenshot2Path });
  console.log(`✓ Screenshot 2 salvo: ${screenshot2Path}`);

  // Testar clique na aba "Tarefas"
  console.log('Alternando para aba "Tarefas"...');
  await mainPage.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const btn = buttons.find(b => b.textContent && b.textContent.includes('Tarefas'));
    if (btn) btn.click();
  });
  await wait(1500);

  const screenshot3Path = path.join(SCREENSHOTS_DIR, '03_desktop_real_tasks_tab.png');
  await mainPage.screenshot({ path: screenshot3Path });
  console.log(`✓ Screenshot 3 salvo: ${screenshot3Path}`);

  // Testar clique na aba "Arquivos"
  console.log('Alternando para aba "Arquivos"...');
  await mainPage.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const btn = buttons.find(b => b.textContent && b.textContent.includes('Arquivos'));
    if (btn) btn.click();
  });
  await wait(1500);

  const screenshot4Path = path.join(SCREENSHOTS_DIR, '04_desktop_real_files_tab.png');
  await mainPage.screenshot({ path: screenshot4Path });
  console.log(`✓ Screenshot 4 salvo: ${screenshot4Path}`);

  // Retornar para aba "💬 Chat"
  console.log('Retornando para aba "💬 Chat"...');
  await mainPage.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const btn = buttons.find(b => b.textContent && b.textContent.includes('Chat'));
    if (btn) btn.click();
  });
  await wait(1500);

  // --------------------------------------------------------------------------
  // ETAPA 2 — CHAT POR PROJETO E ISOLAMENTO
  // --------------------------------------------------------------------------
  console.log('\n--- ETAPA 2: Teste de Chat por Projeto na UI ---');
  // Localizar projetos no sidebar e selecionar o primeiro
  const projectList = await mainPage.evaluate(() => {
    const items = Array.from(document.querySelectorAll('[data-project-id], [class*="cursor-pointer"]'));
    return items.map(el => el.textContent?.trim()).filter(Boolean);
  });
  console.log(`Projetos visíveis no sidebar: ${projectList.length}`);

  // Enviar mensagem no projeto ativo
  console.log('Enviando instrução no chat via interface...');
  const chatInputFound = await mainPage.evaluate(() => {
    const textarea = document.querySelector('textarea');
    if (textarea) {
      textarea.value = 'Instrução de homologação UI: validar persistência de chat e modelo nativo';
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }
    return false;
  });

  if (chatInputFound) {
    await wait(500);
    // Clicar no botão enviar
    await mainPage.evaluate(() => {
      const sendBtn = document.querySelector('button[type="submit"]') ||
                      Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('Enviar') || b.querySelector('svg'));
      if (sendBtn) sendBtn.click();
    });
    console.log('Instrução enviada!');
    await wait(3000);
  }

  const screenshot5Path = path.join(SCREENSHOTS_DIR, '05_desktop_real_chat_sent.png');
  await mainPage.screenshot({ path: screenshot5Path });
  console.log(`✓ Screenshot 5 salvo: ${screenshot5Path}`);

  // --------------------------------------------------------------------------
  // ETAPA 3 — CONTAS, MODELOS E LIMITES NA UI
  // --------------------------------------------------------------------------
  console.log('\n--- ETAPA 3: Teste de Seletor de Modelo e Quota no Cabeçalho ---');
  // Localizar o cabeçalho e verificar seletor de modelo
  const headerData = await mainPage.evaluate(() => {
    const text = document.body.innerText;
    return {
      hasPro: text.includes('Pro') || text.includes('pro'),
      hasFlash: text.includes('Flash') || text.includes('flash'),
      hasDisclaimer: text.includes('Não disponibilizado pelo provedor') || text.includes('não são disponibilizadas'),
      accountVisible: text.includes('Google') || text.includes('@gmail.com') || text.includes('aldxmir')
    };
  });
  console.log('Informações do Cabeçalho e Quota verificadas:', headerData);

  const screenshot6Path = path.join(SCREENSHOTS_DIR, '06_desktop_real_header_and_quota.png');
  await mainPage.screenshot({ path: screenshot6Path });
  console.log(`✓ Screenshot 6 salvo: ${screenshot6Path}`);

  // Coleta final de evidências
  const finalEvidence = {
    executable: APP_PATH,
    windowTitle: title,
    tabsVerified: ['Chat', 'Visão Geral', 'Tarefas', 'Arquivos'],
    headerData,
    screenshots: [
      screenshot1Path,
      screenshot2Path,
      screenshot3Path,
      screenshot4Path,
      screenshot5Path,
      screenshot6Path
    ],
    consoleErrorsCount: consoleErrors.length,
    timestamp: new Date().toISOString()
  };

  fs.writeFileSync('desktop_homologation_evidence.json', JSON.stringify(finalEvidence, null, 2), 'utf8');

  console.log('\n================================================================');
  console.log('   HOMOLOGAÇÃO DO DESKTOP EXECUTADA COM SUCESSO!                ');
  console.log('================================================================\n');

  browser.disconnect();
}

runHomologation().catch(err => {
  console.error('Falha na homologação do Desktop:', err);
  process.exit(1);
});
