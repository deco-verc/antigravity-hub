import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PlaywrightVisualInspector } from '../src/playwrightVisualInspector.js';
import { ProjectOperationsService } from '../src/projectOperationsService.js';

describe('FASE 17: Captura Automatizada de Todas as Secções e Lightbox Carrossel', () => {
  const tempTestDir = path.join(os.tmpdir(), `decohub-crawler-test-${Date.now()}`);

  it('1. Deve sanitizar corretamente nomes de secções e abas para Pascal-Kebab slug', () => {
    assert.strictEqual(PlaywrightVisualInspector.sanitizeSectionName('Dashboard'), 'Dashboard');
    assert.strictEqual(PlaywrightVisualInspector.sanitizeSectionName('Planos & Preços'), 'Planos-Precos');
    assert.strictEqual(PlaywrightVisualInspector.sanitizeSectionName('Top 3 Prioridades'), 'Top-3-Prioridades');
    assert.strictEqual(PlaywrightVisualInspector.sanitizeSectionName('Tarefas do Dia'), 'Tarefas-Do-Dia');
    assert.strictEqual(PlaywrightVisualInspector.sanitizeSectionName('Timeblocking'), 'Timeblocking');
    assert.strictEqual(PlaywrightVisualInspector.sanitizeSectionName('1. Carga Inicial'), 'Carga-Inicial');
    assert.strictEqual(PlaywrightVisualInspector.sanitizeSectionName(''), 'Secao');
  });

  it('2. Deve descobrir abas em HTML estático e gerar screenshots enumerados 01-Secao.png no crawler offline', () => {
    const projDir = path.join(tempTestDir, 'proj-tabs');
    const pubDir = path.join(projDir, 'public');
    const evidenceDir = path.join(projDir, '.ai-dev-hub', 'evidence');
    fs.mkdirSync(pubDir, { recursive: true });
    fs.mkdirSync(evidenceDir, { recursive: true });

    const html = `<!DOCTYPE html>
<html>
<head><title>Tabbed App</title></head>
<body>
  <nav class="tabs">
    <button data-tab="dashboard">Dashboard</button>
    <button data-tab="plans">Planos</button>
    <button data-tab="copies">Copies</button>
    <button data-tab="subscriptions">Assinaturas</button>
  </nav>
  <main>
    <section id="pane-dashboard"><h1>Dashboard</h1></section>
  </main>
</body>
</html>`;
    const htmlPath = path.join(pubDir, 'index.html');
    fs.writeFileSync(htmlPath, html, 'utf-8');

    const captured = PlaywrightVisualInspector.performOfflineSectionCapture(htmlPath, projDir, evidenceDir);

    assert.strictEqual(captured.length, 5); // 4 abas + 1 mobile
    assert.strictEqual(captured[0].filename, '01-Dashboard.png');
    assert.strictEqual(captured[0].sectionName, 'Dashboard');
    assert.strictEqual(captured[0].title, '01. Dashboard');
    assert.strictEqual(captured[0].index, 1);
    assert.strictEqual(captured[0].total, 5);

    assert.strictEqual(captured[1].filename, '02-Planos.png');
    assert.strictEqual(captured[1].sectionName, 'Planos');

    assert.strictEqual(captured[2].filename, '03-Copies.png');
    assert.strictEqual(captured[2].sectionName, 'Copies');

    assert.strictEqual(captured[3].filename, '04-Assinaturas.png');
    assert.strictEqual(captured[3].sectionName, 'Assinaturas');

    assert.strictEqual(captured[4].filename, '05-Mobile-View.png');
    assert.strictEqual(captured[4].sectionName, 'Mobile View');

    for (const item of captured) {
      assert.ok(fs.existsSync(item.fullPath), `Arquivo ${item.filename} deve existir no disco`);
    }
  });

  it('3. ProjectOperationsService.getHomologationEvidence deve ordenar numericamente e expor metadados canônicos', () => {
    const projDir = path.join(tempTestDir, 'proj-evidence');
    const evidenceDir = path.join(projDir, '.ai-dev-hub', 'evidence');
    fs.mkdirSync(evidenceDir, { recursive: true });

    const dummyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    fs.writeFileSync(path.join(evidenceDir, '03-Copies.png'), dummyPng);
    fs.writeFileSync(path.join(evidenceDir, '01-Dashboard.png'), dummyPng);
    fs.writeFileSync(path.join(evidenceDir, '02-Planos.png'), dummyPng);
    fs.writeFileSync(path.join(evidenceDir, '04-Assinaturas.png'), dummyPng);

    const evidence = ProjectOperationsService.getHomologationEvidence({
      id: 'proj-123',
      name: 'Test Project',
      path: projDir
    });

    assert.strictEqual(evidence.screenshots.length, 4);

    // Deve estar estritamente ordenado por prefixo numérico (01, 02, 03, 04)
    assert.strictEqual(evidence.screenshots[0].filename, '01-Dashboard.png');
    assert.strictEqual(evidence.screenshots[0].title, '01. Dashboard');
    assert.strictEqual(evidence.screenshots[0].sectionName, 'Dashboard');
    assert.strictEqual(evidence.screenshots[0].index, 1);
    assert.strictEqual(evidence.screenshots[0].total, 4);

    assert.strictEqual(evidence.screenshots[1].filename, '02-Planos.png');
    assert.strictEqual(evidence.screenshots[1].title, '02. Planos');
    assert.strictEqual(evidence.screenshots[1].sectionName, 'Planos');
    assert.strictEqual(evidence.screenshots[1].index, 2);

    assert.strictEqual(evidence.screenshots[2].filename, '03-Copies.png');
    assert.strictEqual(evidence.screenshots[2].index, 3);

    assert.strictEqual(evidence.screenshots[3].filename, '04-Assinaturas.png');
    assert.strictEqual(evidence.screenshots[3].index, 4);
  });

  it('4. Deve executar captura de secções no projeto de teste real serviceflow2', async () => {
    const serviceflowPath = 'C:\\IA\\test-projects\\serviceflow2';
    if (!fs.existsSync(serviceflowPath)) return;

    const captured = await PlaywrightVisualInspector.captureAllAppSections({
      projectPath: serviceflowPath,
      offlineFallback: true
    });

    assert.ok(captured.length >= 4, `serviceflow2 deve ter pelo menos 4 secções capturadas (obteve ${captured.length})`);
    const filenames = captured.map(c => c.filename);
    assert.ok(filenames.includes('01-Dashboard.png'), 'Deve conter 01-Dashboard.png');
    assert.ok(filenames.includes('02-Planos.png'), 'Deve conter 02-Planos.png');
    assert.ok(filenames.includes('03-Copies.png'), 'Deve conter 03-Copies.png');
    assert.ok(filenames.includes('04-Assinaturas.png'), 'Deve conter 04-Assinaturas.png');
  });

  it('5. Deve executar captura de secções no projeto de teste real rotinateste', async () => {
    const rotinatestePath = 'C:\\IA\\test-projects\\rotinateste';
    if (!fs.existsSync(rotinatestePath)) return;

    const captured = await PlaywrightVisualInspector.captureAllAppSections({
      projectPath: rotinatestePath,
      offlineFallback: true
    });

    assert.ok(captured.length >= 3, `rotinateste deve ter pelo menos 3 secções capturadas (obteve ${captured.length})`);
    const filenames = captured.map(c => c.filename);
    assert.ok(filenames.some(f => f.includes('Top-3') || f.includes('Tarefas') || f.includes('01-')), 'Deve conter secções enumeradas de rotinateste');
  });
});
