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

async function runCapture() {
  console.log('🚀 Iniciando captura detalhada do AI DEV ARENA...');
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    defaultViewport: { width: 1560, height: 1000 }
  });

  const page = await browser.newPage();

  try {
    console.log('1. Acessando http://127.0.0.1:3001...');
    await page.goto('http://127.0.0.1:3001', { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 2000));

    // Selecionar projeto Karpathy Validation Test
    console.log('1.5 Selecionando projeto Karpathy Validation Test...');
    await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('div, button, span'));
      const karpathyItem = items.find(el => el.textContent?.trim() === 'Karpathy Validation Test');
      if (karpathyItem) karpathyItem.click();
    });
    await new Promise(r => setTimeout(r, 2000));

    // Capturar tela do Simple IDE com botão Arena
    console.log('2. Capturando 45_simple_ide_arena_button_badge.png...');
    await page.screenshot({ path: path.join(screenshotsDir, '45_simple_ide_arena_button_badge.png') });
    fs.copyFileSync(path.join(screenshotsDir, '45_simple_ide_arena_button_badge.png'), path.join(artifactsDir, '45_simple_ide_arena_button_badge.png'));

    // Abrir Modal Arena
    console.log('3. Abrindo Modal AI DEV ARENA...');
    const arenaBtn = await page.waitForSelector('#arena-modal-btn', { timeout: 5000 });
    await arenaBtn.click();
    await new Promise(r => setTimeout(r, 1500));

    // Selecionar o Run COMPLETED do Torneio (c270ed17-5ac4-4f1f-a30a-286904d8b098)
    console.log('4. Selecionando Arena Run COMPLETED (Torneio com Vencedor)...');
    await page.select('#arena-run-switcher', 'c270ed17-5ac4-4f1f-a30a-286904d8b098');
    await new Promise(r => setTimeout(r, 1500));

    // Capturar Tab 1: Torneio de Candidatos com Vencedor
    console.log('5. Capturando 46_arena_modal_tournament_winner.png...');
    await page.screenshot({ path: path.join(screenshotsDir, '46_arena_modal_tournament_winner.png') });
    fs.copyFileSync(path.join(screenshotsDir, '46_arena_modal_tournament_winner.png'), path.join(artifactsDir, '46_arena_modal_tournament_winner.png'));

    // Clicar na aba Tabela Comparativa
    console.log('6. Selecionando aba Tabela Comparativa...');
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const compBtn = buttons.find(b => b.textContent?.includes('Tabela Comparativa'));
      if (compBtn) compBtn.click();
    });
    await new Promise(r => setTimeout(r, 1500));

    console.log('7. Capturando 47_arena_modal_comparison_table.png...');
    await page.screenshot({ path: path.join(screenshotsDir, '47_arena_modal_comparison_table.png') });
    fs.copyFileSync(path.join(screenshotsDir, '47_arena_modal_comparison_table.png'), path.join(artifactsDir, '47_arena_modal_comparison_table.png'));

    // Clicar na aba Activity Stream
    console.log('8. Selecionando aba Activity Stream...');
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const actBtn = buttons.find(b => b.textContent?.includes('Activity Stream'));
      if (actBtn) actBtn.click();
    });
    await new Promise(r => setTimeout(r, 1500));

    console.log('9. Capturando 48_arena_modal_activity_stream.png...');
    await page.screenshot({ path: path.join(screenshotsDir, '48_arena_modal_activity_stream.png') });
    fs.copyFileSync(path.join(screenshotsDir, '48_arena_modal_activity_stream.png'), path.join(artifactsDir, '48_arena_modal_activity_stream.png'));

    // Selecionar o Run FAILED do Teste de Integridade No-Winner (5f03b34c-2f16-4eea-8857-6175e7b8371e)
    console.log('10. Selecionando Run No-Acceptable-Candidate...');
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const tourBtn = buttons.find(b => b.textContent?.includes('Torneio de Candidatos'));
      if (tourBtn) tourBtn.click();
    });
    await new Promise(r => setTimeout(r, 1000));
    await page.select('#arena-run-switcher', '5f03b34c-2f16-4eea-8857-6175e7b8371e');
    await new Promise(r => setTimeout(r, 1500));

    console.log('11. Capturando 49_arena_modal_no_acceptable_candidate.png...');
    await page.screenshot({ path: path.join(screenshotsDir, '49_arena_modal_no_acceptable_candidate.png') });
    fs.copyFileSync(path.join(screenshotsDir, '49_arena_modal_no_acceptable_candidate.png'), path.join(artifactsDir, '49_arena_modal_no_acceptable_candidate.png'));

    console.log('\n🎉 Capturas refinadas concluídas com sucesso total!');
  } catch (err) {
    console.error('Erro na captura:', err);
  } finally {
    await browser.close();
  }
}

runCapture();
