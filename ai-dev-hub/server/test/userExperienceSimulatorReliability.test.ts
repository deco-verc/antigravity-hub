import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { UserExperienceSimulator } from '../src/userExperienceSimulator.js';

describe('HOTFIX: UserExperienceSimulator Resiliência, PORT_GUARD e Parser de Eval', () => {

  it('1. parseEvalJson faz parsing correto de múltiplos formatos e prefixos CLI sem lançar exceção', () => {
    // Caso 1: JSON direto
    const r1 = UserExperienceSimulator.parseEvalJson('{"title":"DecoHUB Test","navCount":3}');
    assert.strictEqual(r1.title, 'DecoHUB Test');
    assert.strictEqual(r1.navCount, 3);

    // Caso 2: String JSON com aspas externas e escapes
    const r2 = UserExperienceSimulator.parseEvalJson('"{\\"title\\":\\"YouTubeViralSearch 2\\",\\"navLabels\\":[\\"Home\\",\\"Search\\"]}"');
    assert.strictEqual(r2.title, 'YouTubeViralSearch 2');
    assert.deepStrictEqual(r2.navLabels, ['Home', 'Search']);

    // Caso 3: Saída do CLI com logs, prefixos [playwright] e timestamp
    const r3 = UserExperienceSimulator.parseEvalJson('[playwright] eval completed in 42ms\n{"filledCount":2,"buttonClicked":true,"buttonLabel":"Pesquisar"}\nDone.');
    assert.strictEqual(r3.filledCount, 2);
    assert.strictEqual(r3.buttonClicked, true);
    assert.strictEqual(r3.buttonLabel, 'Pesquisar');

    // Caso 4: Array com prefixos e colchetes externos
    const r4 = UserExperienceSimulator.parseEvalJson('[cli] debug: [session-123]\n["aba-1", "aba-2", "aba-3"]');
    assert.deepStrictEqual(r4, ['aba-1', 'aba-2', 'aba-3']);

    // Caso 5: Saída vazia ou undefined retorna objeto vazio sem erro
    const r5 = UserExperienceSimulator.parseEvalJson('');
    assert.deepStrictEqual(r5, {});

    const r6 = UserExperienceSimulator.parseEvalJson('undefined\n');
    assert.deepStrictEqual(r6, {});
  });

  it('2. findFreePort aloca portas compatíveis com PORT_GUARD (4100-4899)', async () => {
    const port = await UserExperienceSimulator.findFreePort();
    assert.ok(typeof port === 'number', 'Porta deve ser numérica');
    assert.ok(port >= 4000 && port <= 4999, `Porta ${port} deve estar no intervalo permitido PORT_GUARD (4000-4999)`);
    assert.notStrictEqual(port, 3000, 'Porta 3000 é estritamente proibida');
    assert.notStrictEqual(port, 3001, 'Porta 3001 é estritamente proibida');
    assert.notStrictEqual(port, 5173, 'Porta 5173 é estritamente proibida');
  });

  it('3. getSafeNodeExecutable retorna executável seguro com ELECTRON_RUN_AS_NODE ativado', () => {
    const { execPath, env } = UserExperienceSimulator.getSafeNodeExecutable();
    assert.ok(execPath && execPath.length > 0, 'ExecPath deve estar definido');
    assert.strictEqual(env.ELECTRON_RUN_AS_NODE, '1', 'ELECTRON_RUN_AS_NODE deve ser 1 para evitar saídas prematuras');
  });

  it('4. performOfflineSimulation gera resultado estruturado com booleanos estritos', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-ux-test-'));
    try {
      const publicDir = path.join(tempDir, 'public');
      fs.mkdirSync(publicDir, { recursive: true });
      fs.writeFileSync(
        path.join(publicDir, 'index.html'),
        `<!DOCTYPE html>
<html>
<head><title>App Teste</title></head>
<body>
  <nav><button class="tab">Home</button></nav>
  <form>
    <input type="text" name="q" placeholder="Buscar..." />
    <button type="submit">Pesquisar</button>
  </form>
</body>
</html>`,
        'utf-8'
      );

      const evidenceDir = path.join(tempDir, '.ai-dev-hub', 'evidence');
      const res = (UserExperienceSimulator as any).performOfflineSimulation(tempDir, evidenceDir);

      assert.strictEqual(typeof res.passed, 'boolean');
      assert.strictEqual(res.passed, true);
      assert.strictEqual(typeof res.score, 'number');
      assert.strictEqual(res.score, 100);
      assert.strictEqual(typeof res.journeys.firstImpression.passed, 'boolean');
      assert.strictEqual(typeof res.journeys.formInteraction.passed, 'boolean');
      assert.strictEqual(typeof res.journeys.f5Persistence.passed, 'boolean');
      assert.strictEqual(typeof res.journeys.deadButtons.passed, 'boolean');
      assert.strictEqual(res.deadInteractiveElements.length, 0);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('5. simulateRealUserJourney recorre graciosamente à validação offline se o servidor falhar ao iniciar', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-ux-fallback-'));
    try {
      const publicDir = path.join(tempDir, 'public');
      fs.mkdirSync(publicDir, { recursive: true });
      fs.writeFileSync(
        path.join(publicDir, 'index.html'),
        `<!DOCTYPE html>
<html>
<head><title>Fallback Test</title></head>
<body>
  <header><nav><a href="#dashboard">Dashboard</a></nav></header>
  <main>
    <button onclick="console.log(1)">Ação 1</button>
  </main>
</body>
</html>`,
        'utf-8'
      );

      // Chamada sem servidor funcional; deve recorrer à validação offline sem crashar
      const res = await UserExperienceSimulator.simulateRealUserJourney({
        projectPath: tempDir,
        timeoutMs: 1000
      });

      assert.strictEqual(typeof res.passed, 'boolean');
      assert.strictEqual(res.passed, true);
      assert.strictEqual(res.score, 100);
      assert.strictEqual(typeof res.journeys.formInteraction.passed, 'boolean');
      assert.ok(res.details.includes('Simulação offline') || res.details.includes('APROVADA'));
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('6. startEphemeralStaticServer serve arquivos em public/ e mocka rotas /api/*', async () => {
    const { PlaywrightVisualInspector } = await import('../src/playwrightVisualInspector.js');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-static-test-'));
    try {
      const publicDir = path.join(tempDir, 'public');
      fs.mkdirSync(publicDir, { recursive: true });
      fs.writeFileSync(path.join(publicDir, 'index.html'), '<html><body>Hello Public</body></html>', 'utf-8');
      fs.writeFileSync(path.join(publicDir, 'app.js'), 'console.log("App script OK");', 'utf-8');

      const server = await PlaywrightVisualInspector.startEphemeralStaticServer(tempDir);
      try {
        // Testa GET /
        const resIndex = await fetch(server.url);
        assert.strictEqual(resIndex.status, 200);
        const indexText = await resIndex.text();
        assert.ok(indexText.includes('Hello Public'));

        // Testa GET /app.js resolvido a partir de public/app.js
        const resJs = await fetch(`${server.url}/app.js`);
        assert.strictEqual(resJs.status, 200);
        const jsText = await resJs.text();
        assert.ok(jsText.includes('App script OK'));

        // Testa rota /api/* mockada com status 200 JSON
        const resApi = await fetch(`${server.url}/api/videos`);
        assert.strictEqual(resApi.status, 200);
        const apiJson = await resApi.json() as any;
        assert.strictEqual(apiJson.ok, true);
        assert.strictEqual(apiJson.status, 'mocked');
      } finally {
        await server.close();
      }
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('7. startTargetServer ativa fallback para servidor estatico se processo do servidor sair com codigo 0', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-exit0-test-'));
    try {
      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify({
          name: 'exit0-test',
          type: 'module',
          scripts: { start: 'node dist/src/index.js' }
        })
      );
      const distDir = path.join(tempDir, 'dist', 'src');
      fs.mkdirSync(distDir, { recursive: true });
      // Script que encerra imediatamente com codigo 0 (como modulos de export sem listen)
      fs.writeFileSync(path.join(distDir, 'index.js'), 'process.exit(0);', 'utf-8');

      const publicDir = path.join(tempDir, 'public');
      fs.mkdirSync(publicDir, { recursive: true });
      fs.writeFileSync(path.join(publicDir, 'index.html'), '<!DOCTYPE html><html><body><h1>SPA Ativa</h1></body></html>', 'utf-8');

      const serverInstance = await UserExperienceSimulator.startTargetServer(tempDir, 4000);
      try {
        assert.ok(serverInstance.url.startsWith('http://127.0.0.1:'));
        const res = await fetch(serverInstance.url);
        assert.strictEqual(res.status, 200);
        const body = await res.text();
        assert.ok(body.includes('SPA Ativa'));
      } finally {
        await serverInstance.close();
      }
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('8. Botoes de filtro avancado (7 Dias, 30 Dias, 90 Dias) com data-period nao sao reprovados como DEAD_INTERACTIVE_ELEMENTS', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-filter-test-'));
    try {
      const publicDir = path.join(tempDir, 'public');
      fs.mkdirSync(publicDir, { recursive: true });
      fs.writeFileSync(
        path.join(publicDir, 'index.html'),
        `<!DOCTYPE html>
<html>
<head><title>YouTube Viral Search 2</title></head>
<body>
  <div class="filter-bar">
    <button class="filter-btn active" data-period="7d">7 Dias</button>
    <button class="filter-btn" data-period="30d">30 Dias</button>
    <button class="filter-btn" data-period="90d">90 Dias</button>
  </div>
  <form id="search-form">
    <input type="text" name="niche" placeholder="Nicho" />
    <button type="submit">Filtrar</button>
  </form>
</body>
</html>`,
        'utf-8'
      );

      const evidenceDir = path.join(tempDir, '.ai-dev-hub', 'evidence');
      const res = (UserExperienceSimulator as any).performOfflineSimulation(tempDir, evidenceDir);

      assert.strictEqual(res.passed, true);
      assert.strictEqual(res.deadInteractiveElements.length, 0, 'Botoes de filtro validos nao devem ser reprovados');
      assert.strictEqual(res.journeys.deadButtons.passed, true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('9. findCandidateHtmlFile localiza arquivos HTML em client/, frontend/ e subdiretorios', async () => {
    const { PlaywrightVisualInspector } = await import('../src/playwrightVisualInspector.js');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-html-finder-'));
    try {
      const clientDir = path.join(tempDir, 'client', 'public');
      fs.mkdirSync(clientDir, { recursive: true });
      const htmlPath = path.join(clientDir, 'index.html');
      fs.writeFileSync(htmlPath, '<html><body>Client UI</body></html>', 'utf-8');

      const found = PlaywrightVisualInspector.findCandidateHtmlFile(tempDir);
      assert.ok(found !== null);
      assert.strictEqual(path.resolve(found), path.resolve(htmlPath));
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('10. startTargetServer ativa fallback para servidor estatico se o servidor atingir timeout de inicializacao', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-timeout-fallback-'));
    try {
      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify({
          name: 'timeout-fallback-test',
          type: 'module',
          scripts: { start: 'node src/hang.js' }
        })
      );
      const srcDir = path.join(tempDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });
      // Script que não escuta em porta nenhuma
      fs.writeFileSync(path.join(srcDir, 'hang.js'), 'setInterval(() => {}, 60000);', 'utf-8');

      const publicDir = path.join(tempDir, 'public');
      fs.mkdirSync(publicDir, { recursive: true });
      fs.writeFileSync(path.join(publicDir, 'index.html'), '<!DOCTYPE html><html><body><h1>Fallback OK</h1></body></html>', 'utf-8');

      // timeout curto de 1500ms
      const instance = await UserExperienceSimulator.startTargetServer(tempDir, 1500);
      try {
        assert.ok(instance.url.startsWith('http://127.0.0.1:'), 'Instancia estatica deve responder em 127.0.0.1');
        const res = await fetch(instance.url);
        assert.strictEqual(res.status, 200);
        const text = await res.text();
        assert.ok(text.includes('Fallback OK'), 'Deve servir o index.html da pasta public');
      } finally {
        await instance.close();
      }
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('11. startTargetServer auto-promove para src/index.ts quando dist/src/index.js nao existe', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-ts-autopromote-'));
    try {
      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify({
          name: 'ts-autopromote-test',
          type: 'module',
          scripts: { start: 'node dist/src/index.js' }
        })
      );
      const srcDir = path.join(tempDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });
      // src/index.ts com servidor nativo respondendo na porta enviada via PORT
      fs.writeFileSync(
        path.join(srcDir, 'index.ts'),
        `import http from 'node:http';
const port = process.env.PORT || 4880;
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<!DOCTYPE html><html><body><h1>TS Server Live</h1></body></html>');
});
server.listen(port, () => console.log('TS Server listening on ' + port));
`,
        'utf-8'
      );

      const instance = await UserExperienceSimulator.startTargetServer(tempDir, 8000);
      try {
        assert.ok(instance.url.startsWith('http://127.0.0.1:'));
        const res = await fetch(instance.url);
        assert.strictEqual(res.status, 200);
        const text = await res.text();
        assert.ok(text.includes('TS Server Live'));
      } finally {
        await instance.close();
      }
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('12. Filtros avancados empilhaveis e scripts com addEventListener nao disparam falso-positivo em deadButtons', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-filter-chips-'));
    try {
      const publicDir = path.join(tempDir, 'public');
      fs.mkdirSync(publicDir, { recursive: true });
      fs.writeFileSync(
        path.join(publicDir, 'index.html'),
        `<!DOCTYPE html>
<html>
<head><title>Filtros YouTube Viral Search 2</title></head>
<body>
  <div class="filter-pills">
    <button class="pill">7 Dias</button>
    <button class="pill">30 Dias</button>
    <button class="pill">90 Dias</button>
    <button class="chip">Outlier 3x</button>
    <button class="chip">Outlier 5x</button>
    <button class="btn-filter">Shorts</button>
  </div>
  <script>
    document.addEventListener('click', (e) => {
      if (e.target.matches('.pill, .chip, .btn-filter')) {
        console.log('Filtro aplicado:', e.target.textContent);
      }
    });
  </script>
</body>
</html>`,
        'utf-8'
      );

      const evidenceDir = path.join(tempDir, '.ai-dev-hub', 'evidence');
      const res = (UserExperienceSimulator as any).performOfflineSimulation(tempDir, evidenceDir);

      assert.strictEqual(res.passed, true);
      assert.strictEqual(res.deadInteractiveElements.length, 0, 'Nenhum filtro empilhavel deve ser marcado como botao morto');
      assert.strictEqual(res.journeys.deadButtons.passed, true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

});
