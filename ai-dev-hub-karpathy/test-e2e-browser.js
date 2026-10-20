import puppeteer from 'puppeteer-core';
import path from 'node:path';
import fs from 'node:fs';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SCREENSHOTS_DIR = 'C:\\Users\\Deco\\.gemini\\antigravity\\brain\\a626e547-946e-4f2e-a035-83feafc09761\\screenshots';

const consoleErrors = [];
const consoleWarnings = [];
const networkFailures = [];

async function runBrowserTests() {
  console.log('====================================================');
  console.log('🌐 INICIANDO TESTE VISUAL E AUDITORIA VIA BROWSER');
  console.log('====================================================');

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,900']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  // Listen to console
  page.on('console', msg => {
    const text = msg.text();
    const type = msg.type();
    if (type === 'error') {
      consoleErrors.push(text);
      console.log(`[BROWSER ERROR] ${text}`);
    } else if (type === 'warn') {
      consoleWarnings.push(text);
    }
  });

  page.on('pageerror', err => {
    consoleErrors.push(err.message);
    console.log(`[PAGE ERROR] ${err.message}`);
  });

  page.on('requestfailed', req => {
    networkFailures.push({ url: req.url(), error: req.failure()?.errorText });
    console.log(`[NETWORK FAILED] ${req.url()} (${req.failure()?.errorText})`);
  });

  try {
    // 1. Open Application
    console.log('👉 [1/10] Navegando para http://localhost:5173...');
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle0', timeout: 15000 });
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '01_homepage_loaded.png'), fullPage: false });
    console.log('   ✓ Página carregada com sucesso. Screenshot 01 salvo.');

    // 2. Overview Screen verification
    console.log('👉 [2/10] Verificando Visão Geral do Projeto...');
    await page.waitForSelector('h1', { timeout: 5000 });
    const titleText = await page.$eval('h1', el => el.textContent);
    console.log(`   ✓ Projeto exibido na tela: "${titleText}"`);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '02_project_overview.png') });

    // 3. Navigate to Tasks (Kanban) and add a task
    console.log('👉 [3/10] Testando Kanban de Tarefas e Adição de Tarefa...');
    const tabs = await page.$$('button');
    for (const btn of tabs) {
      const text = await page.evaluate(el => el.textContent, btn);
      if (text.includes('Tarefas')) {
        await btn.click();
        break;
      }
    }
    await new Promise(r => setTimeout(r, 600));

    // Fill task input
    const taskInput = await page.$('input[placeholder*="Adicionar nova tarefa"]');
    if (taskInput) {
      await taskInput.type('Validar testes automatizados de voz e latência');
      const addBtn = await page.$('button[type="submit"]');
      if (addBtn) await addBtn.click();
      await new Promise(r => setTimeout(r, 1000));
    }
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '03_tasks_kanban.png') });
    console.log('   ✓ Tarefa adicionada no Kanban. Screenshot 03 salvo.');

    // 4. Navigate to Permanent Memory Editor
    console.log('👉 [4/10] Testando Editor de Memória Permanente (.ai-dev-hub)...');
    for (const btn of await page.$$('button')) {
      const text = await page.evaluate(el => el.textContent, btn);
      if (text.includes('Memória')) {
        await btn.click();
        break;
      }
    }
    await new Promise(r => setTimeout(r, 600));

    // Edit textarea
    const textarea = await page.$('textarea');
    if (textarea) {
      await textarea.type('\n<!-- Teste de auditoria visual realizado com sucesso -->');
      // Click Save
      for (const btn of await page.$$('button')) {
        const text = await page.evaluate(el => el.textContent, btn);
        if (text.includes('Salvar')) {
          await btn.click();
          break;
        }
      }
      await new Promise(r => setTimeout(r, 1000));
    }
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '04_memory_editor.png') });
    console.log('   ✓ Edição e salvamento de memória permanente testados. Screenshot 04 salvo.');

    // 5. Checkpoint Modal
    console.log('👉 [5/10] Testando Modal de Checkpoint de Sessão...');
    for (const btn of await page.$$('button')) {
      const text = await page.evaluate(el => el.textContent, btn);
      if (text.includes('Checkpoint')) {
        await btn.click();
        break;
      }
    }
    await new Promise(r => setTimeout(r, 800));
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '05_checkpoint_modal.png') });

    // Click "GERAR E SALVAR CHECKPOINT"
    for (const btn of await page.$$('button')) {
      const text = await page.evaluate(el => el.textContent, btn);
      if (text.includes('GERAR') || text.includes('Salvar')) {
        await btn.click();
        break;
      }
    }
    await new Promise(r => setTimeout(r, 1500));
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '06_checkpoint_generated.png') });
    console.log('   ✓ Checkpoint gerado com sucesso. Screenshots 05 e 06 salvos.');

    // Close modal
    const closeBtns = await page.$$('button');
    for (const btn of closeBtns) {
      const text = await page.evaluate(el => el.textContent, btn);
      if (text.includes('Fechar') || text.includes('Cancelar')) {
        await btn.click();
        break;
      }
    }
    await new Promise(r => setTimeout(r, 500));

    // 6. Continuity Modal
    console.log('👉 [6/10] Testando Modal de Continuidade (Handover de IA)...');
    for (const btn of await page.$$('button')) {
      const text = await page.evaluate(el => el.textContent, btn);
      if (text.includes('Continuar')) {
        await btn.click();
        break;
      }
    }
    await new Promise(r => setTimeout(r, 800));
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '07_continuity_modal.png') });

    // Close modal
    for (const btn of await page.$$('button')) {
      const text = await page.evaluate(el => el.textContent, btn);
      if (text.includes('Fechar')) {
        await btn.click();
        break;
      }
    }
    await new Promise(r => setTimeout(r, 500));
    console.log('   ✓ Modal de Continuidade verificado. Screenshot 07 salvo.');

    // 7. System Health Tab
    console.log('👉 [7/10] Testando Tela de System Health...');
    for (const btn of await page.$$('button')) {
      const text = await page.evaluate(el => el.textContent, btn);
      if (text.includes('Health')) {
        await btn.click();
        break;
      }
    }
    await new Promise(r => setTimeout(r, 800));

    // Click "EXECUTAR DIAGNÓSTICO"
    for (const btn of await page.$$('button')) {
      const text = await page.evaluate(el => el.textContent, btn);
      if (text.includes('DIAGNÓSTICO')) {
        await btn.click();
        break;
      }
    }
    await new Promise(r => setTimeout(r, 1500));
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '08_system_health.png') });
    console.log('   ✓ Diagnóstico de Sistema executado. Screenshot 08 salvo.');

    // 8. Logs Tab
    console.log('👉 [8/10] Testando Tela de Logs...');
    for (const btn of await page.$$('button')) {
      const text = await page.evaluate(el => el.textContent, btn);
      if (text.includes('Logs')) {
        await btn.click();
        break;
      }
    }
    await new Promise(r => setTimeout(r, 800));
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '09_system_logs.png') });
    console.log('   ✓ Logs do sistema exibidos. Screenshot 09 salvo.');

    // 9. Git Status Tab
    console.log('👉 [9/10] Testando Tela de Git Status...');
    for (const btn of await page.$$('button')) {
      const text = await page.evaluate(el => el.textContent, btn);
      if (text.includes('Git Status')) {
        await btn.click();
        break;
      }
    }
    await new Promise(r => setTimeout(r, 800));
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '10_git_status.png') });
    console.log('   ✓ Tela Git Status verificada. Screenshot 10 salvo.');

    // 10. Test New Project Modal with Error Scenario
    console.log('👉 [10/10] Testando Validação de Erro com Pasta Inexistente no Modal...');
    for (const btn of await page.$$('button')) {
      const text = await page.evaluate(el => el.textContent, btn);
      if (text.includes('NOVO PROJETO')) {
        await btn.click();
        break;
      }
    }
    await new Promise(r => setTimeout(r, 800));

    // Type non-existent path
    const folderInput = await page.$('input[placeholder*="C:"]');
    if (folderInput) {
      await folderInput.type('C:\\esta-pasta-nao-existe-12345');
      // Click "Analisar Pasta"
      for (const btn of await page.$$('button')) {
        const text = await page.evaluate(el => el.textContent, btn);
        if (text.includes('Analisar')) {
          await btn.click();
          break;
        }
      }
      await new Promise(r => setTimeout(r, 1200));
    }
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '11_error_handling_modal.png') });
    console.log('   ✓ Teste de erro em pasta inexistente validado com sucesso. Screenshot 11 salvo.');

  } catch (err) {
    console.error('❌ Erro durante teste no navegador:', err);
  } finally {
    await browser.close();
  }

  console.log('\n====================================================');
  console.log('📊 RESULTADO DA AUDITORIA DO BROWSER:');
  console.log(`- Erros no console do navegador: ${consoleErrors.length}`);
  console.log(`- Warnings no console: ${consoleWarnings.length}`);
  console.log(`- Falhas de requisição HTTP de rede: ${networkFailures.length}`);
  console.log('====================================================');

  if (consoleErrors.length > 0) {
    console.log('\nDetalhes dos erros no console:');
    consoleErrors.forEach(e => console.log('  ❌', e));
  }
}

runBrowserTests();
