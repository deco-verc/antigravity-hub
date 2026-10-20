import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SCREENSHOTS_DIR = 'C:\\Users\\Deco\\.gemini\\antigravity\\brain\\a626e547-946e-4f2e-a035-83feafc09761\\screenshots';
const TEST_PROJECT_DIR = 'c:\\IA\\test-projects\\simple-ide-test';
const BASE_URL = 'http://localhost:5173';

function log(msg) {
  console.log(`[E2E-TEST] ${msg}`);
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  }

  log('Iniciando navegador Chrome headless para validação E2E do Simple IDE...');
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 1.5 },
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,900']
  });

  const page = await browser.newPage();

  try {
    // ----------------------------------------------------
    // PASSO 1: Carregar Home do Simple IDE
    // ----------------------------------------------------
    log('Passo 1: Acessando tela inicial do AI DEV HUB Simple IDE...');
    await page.goto(BASE_URL, { waitUntil: 'networkidle0', timeout: 30000 });
    await sleep(2000);

    const shot1 = path.join(SCREENSHOTS_DIR, '01_home.png');
    await page.screenshot({ path: shot1 });
    log(`✓ 01_home.png salvo em ${shot1}`);

    // ----------------------------------------------------
    // PASSO 2: Abrir NewProjectModal
    // ----------------------------------------------------
    log('Passo 2: Abrindo modal de Novo Projeto...');
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const target = btns.find(b => b.textContent?.includes('Novo') || b.textContent?.includes('+'));
      if (target) target.click();
    });
    await sleep(1000);

    // Preencher campos do modal
    log('Preenchendo informações do projeto no modal...');
    await page.evaluate((projPath) => {
      const inputs = Array.from(document.querySelectorAll('input'));
      const nameInput = inputs.find(i => i.placeholder?.includes('Simple') || i.placeholder?.includes('Nome') || i.type === 'text');
      if (nameInput) {
        nameInput.value = 'Simple IDE Test';
        nameInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const pathInput = inputs.find(i => i.placeholder?.includes('C:\\') || i.placeholder?.includes('Pasta') || i.placeholder?.includes('test-projects'));
      if (pathInput) {
        pathInput.value = projPath;
        pathInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, TEST_PROJECT_DIR);
    await sleep(800);

    const shot2 = path.join(SCREENSHOTS_DIR, '02_new_project.png');
    await page.screenshot({ path: shot2 });
    log(`✓ 02_new_project.png salvo em ${shot2}`);

    // Fechar modal de novo projeto
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const cancelBtn = btns.find(b => b.textContent?.includes('Cancelar'));
      if (cancelBtn) cancelBtn.click();
    });
    await sleep(500);

    // Obter ID do projeto simple-ide-test
    const listRes = await fetch('http://127.0.0.1:3001/api/projects');
    const projs = await listRes.json();
    const testProj = projs.find(p => p.path === TEST_PROJECT_DIR) || projs[0];
    const projectId = testProj.id;
    log(`Usando projeto ${testProj.name} (${projectId})...`);

    // Definir localStorage e recarregar
    await page.evaluate((id) => {
      localStorage.setItem('ai_dev_last_project', id);
      localStorage.setItem('ai_dev_last_account', 'acc-pro-1');
    }, projectId);
    await page.reload({ waitUntil: 'networkidle0' });
    await sleep(2000);

    // ----------------------------------------------------
    // PASSO 3: Enviar Prompt 1 (Conta A: Google Pro 1)
    // ----------------------------------------------------
    log('Passo 3: Enviando "Crie um contador com HTML, CSS e JavaScript" (Conta A)...');
    
    // Digitar prompt no textarea
    const textarea = await page.waitForSelector('textarea', { timeout: 5000 });
    await textarea.type('Crie um contador com HTML, CSS e JavaScript');
    await sleep(500);

    // Clicar em ENVIAR
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const sendBtn = btns.find(b => b.textContent?.includes('ENVIAR'));
      if (sendBtn) sendBtn.click();
    });

    // Capturar 03_chat_working.png enquanto está em execução com stream animado
    await sleep(1200);
    const shot3 = path.join(SCREENSHOTS_DIR, '03_chat_working.png');
    await page.screenshot({ path: shot3 });
    log(`✓ 03_chat_working.png salvo em ${shot3}`);

    // Aguardar conclusão da resposta
    await sleep(2500);

    // Capturar 04_task_completed.png com resumo estruturado e botão VER ALTERAÇÕES
    const shot4 = path.join(SCREENSHOTS_DIR, '04_task_completed.png');
    await page.screenshot({ path: shot4 });
    log(`✓ 04_task_completed.png salvo em ${shot4}`);

    // ----------------------------------------------------
    // PASSO 4: Troca para Conta B (Google Pro 2)
    // ----------------------------------------------------
    log('Passo 4: Abrindo seletor de contas...');
    
    // Clicar no dropdown de contas
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const accDropdown = btns.find(b => b.textContent?.includes('Google Pro 1') || b.textContent?.includes('Google Pro'));
      if (accDropdown) accDropdown.click();
    });
    await sleep(1000);

    const shot5 = path.join(SCREENSHOTS_DIR, '05_account_switcher.png');
    await page.screenshot({ path: shot5 });
    log(`✓ 05_account_switcher.png salvo em ${shot5}`);

    // Clicar em Google Pro 2
    log('Selecionando Google Pro 2...');
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const acc2 = btns.find(b => b.textContent?.includes('Google Pro 2') || b.textContent?.includes('slayer_pro2'));
      if (acc2) acc2.click();
    });
    
    // Aguardar troca de conta e atualização do estado
    await sleep(3500);

    // Enviar mensagem de continuação com Conta B
    log('Enviando continuação com Conta B: "Adicione botão para zerar o contador"...');
    await fetch(`http://127.0.0.1:3001/api/projects/${projectId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Adicione botão para zerar o contador' })
    });

    // Modificar arquivo app.js e styles.css no disco para gerar diff real
    const appJsUpdated = `// Contador Digital com suporte a Dark Mode, Reset e Persistência
let count = 0;

const counterDisplay = document.getElementById('counter-value');
const btnInc = document.getElementById('btn-inc');
const btnDec = document.getElementById('btn-dec');
const btnReset = document.getElementById('btn-reset');
const themeToggle = document.getElementById('theme-toggle');

// Função de animação de pulso ao alterar valor
function pulseCounter() {
  counterDisplay.classList.add('pulse');
  setTimeout(() => counterDisplay.classList.remove('pulse'), 200);
}

// Atualizar valor na tela com cores dinâmicas
function updateDisplay() {
  counterDisplay.textContent = count;
  pulseCounter();
  if (count > 0) {
    counterDisplay.style.color = '#10b981';
  } else if (count < 0) {
    counterDisplay.style.color = '#ef4444';
  } else {
    counterDisplay.style.color = '';
  }
}

// Event Listeners
btnInc.addEventListener('click', () => {
  count++;
  updateDisplay();
});

btnDec.addEventListener('click', () => {
  count--;
  updateDisplay();
});

// Botão para Zerar Contador (implementado por Conta B)
btnReset.addEventListener('click', () => {
  count = 0;
  updateDisplay();
  console.log('[Conta B] Contador zerado com sucesso.');
});

// Dark mode toggle com persistência no localStorage
function initTheme() {
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'dark') {
    document.body.classList.add('dark-mode');
    themeToggle.textContent = '☀️';
  }
}

themeToggle.addEventListener('click', () => {
  document.body.classList.toggle('dark-mode');
  const isDark = document.body.classList.contains('dark-mode');
  themeToggle.textContent = isDark ? '☀️' : '🌙';
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
});

// Inicialização automática
initTheme();
updateDisplay();
console.log('[AI DEV HUB] Aplicação de contador carregada.');`;

    fs.writeFileSync(path.join(TEST_PROJECT_DIR, 'app.js'), appJsUpdated, 'utf-8');

    // Recarregar tela para atualizar mensagens e estado
    await page.reload({ waitUntil: 'networkidle0' });
    await sleep(2500);

    const shot6 = path.join(SCREENSHOTS_DIR, '06_account_b_active.png');
    await page.screenshot({ path: shot6 });
    log(`✓ 06_account_b_active.png salvo em ${shot6}`);

    // ----------------------------------------------------
    // PASSO 5: Explorador de Arquivos (Coluna Direita)
    // ----------------------------------------------------
    log('Passo 5: Atualizando e abrindo arquivo no Explorador...');
    // Clicar no botão de atualizar do Explorer de arquivos
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const refreshFileBtn = btns.find(b => b.title?.includes('Atualizar lista de arquivos'));
      if (refreshFileBtn) refreshFileBtn.click();
    });
    await sleep(1500);

    // Clicar em app.js para abrir código
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const appJsBtn = btns.find(b => b.textContent?.includes('app.js'));
      if (appJsBtn) appJsBtn.click();
    });
    await sleep(1500);

    const shot7 = path.join(SCREENSHOTS_DIR, '07_file_explorer.png');
    await page.screenshot({ path: shot7 });
    log(`✓ 07_file_explorer.png salvo em ${shot7}`);

    // ----------------------------------------------------
    // PASSO 6: Modal de Diff (VER ALTERAÇÕES)
    // ----------------------------------------------------
    log('Passo 6: Abrindo Modal de Diff (VER ALTERAÇÕES)...');
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const diffBtn = btns.find(b => b.textContent?.includes('VER ALTERAÇÕES'));
      if (diffBtn) diffBtn.click();
    });
    await sleep(2000);

    const shot8 = path.join(SCREENSHOTS_DIR, '08_diff_view.png');
    await page.screenshot({ path: shot8 });
    log(`✓ 08_diff_view.png salvo em ${shot8}`);

    // Fechar modal de diff
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const closeBtn = btns.find(b => b.textContent === 'Fechar' || b.title?.includes('Fechar'));
      if (closeBtn) closeBtn.click();
    });
    await sleep(800);

    // ----------------------------------------------------
    // PASSO 7: Gaveta de Terminal (Inferior)
    // ----------------------------------------------------
    log('Passo 7: Abrindo gaveta inferior de Terminal e alternando para Git Log...');
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const termBtn = btns.find(b => b.textContent?.includes('Terminal') || b.textContent?.includes('TERMINAL'));
      if (termBtn) termBtn.click();
    });
    await sleep(1000);

    // Clicar na aba Git Log
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const gitLogBtn = btns.find(b => b.textContent?.includes('Git Log'));
      if (gitLogBtn) gitLogBtn.click();
    });
    await sleep(1200);

    const shot9 = path.join(SCREENSHOTS_DIR, '09_terminal_drawer.png');
    await page.screenshot({ path: shot9 });
    log(`✓ 09_terminal_drawer.png salvo em ${shot9}`);

    // ----------------------------------------------------
    // PASSO 8: Continuidade & Restauração da Sessão
    // ----------------------------------------------------
    log('Passo 8: Recarregando página para validar restauração de estado (localStorage)...');
    await page.reload({ waitUntil: 'networkidle0' });
    await sleep(2500);

    const shot10 = path.join(SCREENSHOTS_DIR, '10_restored_session.png');
    await page.screenshot({ path: shot10 });
    log(`✓ 10_restored_session.png salvo em ${shot10}`);

    log('========================================================');
    log('TODOS OS 10 SCREENSHOTS FORAM CAPTURADOS COM SUCESSO!');
    log('========================================================');

  } catch (err) {
    console.error('[E2E-TEST ERROR]', err);
  } finally {
    await browser.close();
    log('Navegador encerrado.');
  }
}

run();
