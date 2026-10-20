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

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function apiRequest(endpoint, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL('http://127.0.0.1:3001/api' + endpoint);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json' }
    };
    const req = http.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = data ? JSON.parse(data) : {};
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(json);
          else reject(new Error(`HTTP ${res.statusCode}: ${json.error || data}`));
        } catch {
          resolve(data);
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runEtapa2And3() {
  console.log('\n================================================================');
  console.log('   DECOHUB HOMOLOGAÇÃO ETAPAS 2 & 3: ISOLAMENTO & PERSISTÊNCIA  ');
  console.log('================================================================\n');

  // Criar pastas limpas para os Projetos A e B
  const baseDir = path.resolve('C:\\IA\\test-projects');
  const dirProjA = path.join(baseDir, 'homologacao-teste-financeiro');
  const dirProjB = path.join(baseDir, 'homologacao-teste-tarefas');
  fs.mkdirSync(dirProjA, { recursive: true });
  fs.mkdirSync(dirProjB, { recursive: true });

  console.log('[1] Criando Projeto A (Teste Financeiro)...');
  let projA;
  try {
    projA = await apiRequest('/projects', 'POST', {
      name: 'Teste Financeiro',
      folderPath: dirProjA,
      objective: 'Aplicativo de controle financeiro com receitas e despesas',
      githubAction: 'none'
    });
  } catch (err) {
    const list = await apiRequest('/projects');
    projA = list.find(p => p.name === 'Teste Financeiro') || list[0];
  }

  console.log('[2] Criando Projeto B (Teste de Tarefas)...');
  let projB;
  try {
    projB = await apiRequest('/projects', 'POST', {
      name: 'Teste de Tarefas',
      folderPath: dirProjB,
      objective: 'Aplicativo Kanban de gerenciamento de tarefas',
      githubAction: 'none'
    });
  } catch (err) {
    const list = await apiRequest('/projects');
    projB = list.find(p => p.name === 'Teste de Tarefas') || list[1];
  }

  console.log(`Projeto A ID: ${projA.id} | Projeto B ID: ${projB.id}`);

  // Enviar mensagens distintas
  console.log('[3] Enviando mensagem no Projeto A...');
  await apiRequest(`/projects/${projA.id}/messages`, 'POST', {
    content: 'Implementar motor de cálculo financeiro e demonstrativo de fluxo de caixa no Teste Financeiro.'
  });

  console.log('[4] Enviando mensagem no Projeto B...');
  await apiRequest(`/projects/${projB.id}/messages`, 'POST', {
    content: 'Implementar quadro Kanban de tarefas com tags, prazos e prioridades no Teste de Tarefas.'
  });

  async function checkDebugPortReady(port, maxAttempts = 20) {
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

  // Conectar Puppeteer para navegar pela interface do Electron
  console.log('[5] Verificando se DecoHUB.exe está ativo na porta 9222...');
  let portReady = await checkDebugPortReady(DEBUG_PORT, 3);
  if (!portReady) {
    console.log('Iniciando DecoHUB.exe com porta de depuração 9222...');
    const appProcess = spawn(APP_PATH, [`--remote-debugging-port=${DEBUG_PORT}`], {
      detached: true,
      stdio: 'ignore'
    });
    appProcess.unref();
    portReady = await checkDebugPortReady(DEBUG_PORT, 25);
    if (!portReady) {
      throw new Error('Timeout aguardando Electron responder na porta 9222.');
    }
  }

  console.log('[5.1] Conectando Puppeteer à janela do DecoHUB...');
  const browser = await puppeteer.connect({
    browserURL: `http://127.0.0.1:${DEBUG_PORT}`,
    defaultViewport: { width: 1440, height: 900 }
  });

  const pages = await browser.pages();
  const page = pages.find(p => p.url().includes('3001') || p.url().includes('127.0.0.1')) || pages[0];

  // 1. Navegar para Projeto A no UI
  console.log('[6] Selecionando Projeto A no Electron...');
  await page.evaluate((id) => {
    // Carregar Projeto A pelo localStorage e disparar reload para forçar seleção
    localStorage.setItem('ai_dev_last_project', id);
    localStorage.setItem('ai_dev_last_tab', 'chat');
    window.location.reload();
  }, projA.id);

  await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 10000 }).catch(() => {});
  await wait(3000);

  // Capturar Screenshot do Projeto A
  const shotA = path.join(SCREENSHOTS_DIR, '07_desktop_projeto_a_financeiro.png');
  await page.screenshot({ path: shotA });
  console.log(`✓ Screenshot Projeto A salvo: ${shotA}`);

  // Verificar que mensagem de A está na tela e B NÃO está
  const pageAText = await page.evaluate(() => document.body.innerText);
  const hasFinanceiroInA = pageAText.includes('cálculo financeiro') || pageAText.includes('fluxo de caixa');
  const hasKanbanInA = pageAText.includes('Kanban de tarefas') || pageAText.includes('prazos e prioridades');

  console.log(`Projeto A contém mensagem financeira: ${hasFinanceiroInA} | Contém mensagem kanban (vazamento): ${hasKanbanInA}`);

  // 2. Navegar para Projeto B no UI
  console.log('[7] Selecionando Projeto B no Electron...');
  await page.evaluate((id) => {
    localStorage.setItem('ai_dev_last_project', id);
    localStorage.setItem('ai_dev_last_tab', 'chat');
    window.location.reload();
  }, projB.id);

  await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 10000 }).catch(() => {});
  await wait(3000);

  // Capturar Screenshot do Projeto B
  const shotB = path.join(SCREENSHOTS_DIR, '08_desktop_projeto_b_tarefas.png');
  await page.screenshot({ path: shotB });
  console.log(`✓ Screenshot Projeto B salvo: ${shotB}`);

  // Verificar que mensagem de B está na tela e A NÃO está
  const pageBText = await page.evaluate(() => document.body.innerText);
  const hasKanbanInB = pageBText.includes('Kanban de tarefas') || pageBText.includes('prazos e prioridades');
  const hasFinanceiroInB = pageBText.includes('cálculo financeiro') || pageBText.includes('fluxo de caixa');

  console.log(`Projeto B contém mensagem kanban: ${hasKanbanInB} | Contém mensagem financeira (vazamento): ${hasFinanceiroInB}`);

  // 3. Voltar para Projeto A e confirmar preservação
  console.log('[8] Retornando ao Projeto A no Electron para confirmar persistência...');
  await page.evaluate((id) => {
    localStorage.setItem('ai_dev_last_project', id);
    localStorage.setItem('ai_dev_last_tab', 'chat');
    window.location.reload();
  }, projA.id);

  await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 10000 }).catch(() => {});
  await wait(3000);

  const shotARevisit = path.join(SCREENSHOTS_DIR, '09_desktop_projeto_a_revisitado.png');
  await page.screenshot({ path: shotARevisit });
  console.log(`✓ Screenshot Projeto A Revisitado salvo: ${shotARevisit}`);

  const pageARevisitText = await page.evaluate(() => document.body.innerText);
  const stillHasFinanceiroInA = pageARevisitText.includes('cálculo financeiro') || pageARevisitText.includes('fluxo de caixa');
  const stillNoKanbanInA = !(pageARevisitText.includes('Kanban de tarefas') || pageARevisitText.includes('prazos e prioridades'));

  const isolationResult = hasFinanceiroInA && !hasKanbanInA && hasKanbanInB && !hasFinanceiroInB && stillHasFinanceiroInA && stillNoKanbanInA;

  console.log('\n================================================================');
  console.log(`RESULTADO DO ISOLAMENTO E PERSISTÊNCIA: ${isolationResult ? '✅ PASS' : '❌ FAIL'}`);
  console.log('================================================================\n');

  browser.disconnect();
}

runEtapa2And3().catch(err => {
  console.error('Erro:', err);
  process.exit(1);
});
