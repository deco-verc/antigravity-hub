// server/test/userExperienceSimulator.test.ts
// Testes automatizados da FASE 9: UserExperienceSimulator (Simulação de Jornada de Usuário Real)
// - Dynamic Port Allocation & Ephemeral Server Lifecycle Teardown
// - Offline Fallback Simulation (HTML / Forms / Nav / Anti-Slop)
// - Detection of Root Route Hijacked by JSON
// - Detection of Dead Buttons & Broken Wiring
// - Integration with IndependentEvaluator (Evidence-First Verification)

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import http from 'node:http';
import { UserExperienceSimulator, UserJourneyResult } from '../src/userExperienceSimulator.js';
import { IndependentEvaluator, SuccessContract } from '../src/independentEvaluator.js';

describe('FASE 9: UserExperienceSimulator', () => {
  let tempTestDir: string;

  before(() => {
    tempTestDir = path.join(os.tmpdir(), `decohub-ux-test-${Date.now()}`);
    fs.mkdirSync(tempTestDir, { recursive: true });
  });

  after(() => {
    try {
      if (fs.existsSync(tempTestDir)) {
        fs.rmSync(tempTestDir, { recursive: true, force: true });
      }
    } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "userExperienceSimulator.test",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:userExperienceSimulator.test]", err);
      }
    }
  });

  describe('1. Port Allocation & Server Lifecycle', () => {
    it('should allocate an available dynamic TCP port', async () => {
      const port = await UserExperienceSimulator.findFreePort();
      assert.ok(typeof port === 'number');
      assert.ok(port > 1024 && port < 65535);
    });

    it('should start an ephemeral Node server and cleanly close it', async () => {
      const appDir = path.join(tempTestDir, 'ephemeral-app');
      fs.mkdirSync(path.join(appDir, 'src'), { recursive: true });

      fs.writeFileSync(
        path.join(appDir, 'package.json'),
        JSON.stringify({
          name: 'ephemeral-app',
          type: 'module',
          scripts: { start: 'node src/server.js' }
        })
      );

      fs.writeFileSync(
        path.join(appDir, 'src', 'server.js'),
        `import http from 'node:http';
const port = process.env.PORT || 39123;
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<!DOCTYPE html><html><body><h1>App OK</h1></body></html>');
});
server.listen(port, () => console.log('Listening on ' + port));
`
      );

      const instance = await UserExperienceSimulator.startTargetServer(appDir, 5000);
      assert.ok(instance.url.startsWith('http://127.0.0.1:'));
      assert.ok(instance.port > 0);

      // Verify server is responding
      const res = await fetch(instance.url);
      assert.strictEqual(res.status, 200);
      const text = await res.text();
      assert.ok(text.includes('App OK'));

      // Close server
      await instance.close();

      // Verify connection refused or dead after close
      await new Promise((r) => setTimeout(r, 400));
      let isDead = false;
      try {
        await fetch(instance.url, { signal: AbortSignal.timeout(600) });
      } catch {
        isDead = true;
      }
      assert.ok(isDead, 'Server port should be freed after close()');
    });
  });

  describe('2. Offline Deterministic Simulation', () => {
    it('should pass simulation when project has complete HTML form and navigation', async () => {
      const validApp = path.join(tempTestDir, 'valid-app');
      fs.mkdirSync(path.join(validApp, 'public'), { recursive: true });

      fs.writeFileSync(
        path.join(validApp, 'public', 'index.html'),
        `<!DOCTYPE html>
<html>
<head><title>FocusDay Planner</title></head>
<body>
  <nav>
    <button class="tab" data-tab="hoje">Hoje</button>
    <button class="tab" data-tab="habitos">Hábitos</button>
  </nav>
  <main>
    <form id="task-form">
      <input type="text" id="title" placeholder="Nova tarefa" />
      <select id="priority"><option value="alta">Alta</option></select>
      <button type="submit" class="btn-primary">Criar Tarefa</button>
    </form>
    <div id="task-list"></div>
  </main>
</body>
</html>`
      );

      const oldEnv = process.env.DECOHUB_OFFLINE_MODE;
      process.env.DECOHUB_OFFLINE_MODE = 'true';
      try {
        const result = await UserExperienceSimulator.simulateRealUserJourney({
          projectPath: validApp
        });

        assert.strictEqual(result.passed, true);
        assert.strictEqual(result.score, 100);
        assert.strictEqual(result.journeys.firstImpression.passed, true);
        assert.strictEqual(result.journeys.formInteraction.passed, true);
        assert.strictEqual(result.journeys.f5Persistence.passed, true);
        assert.strictEqual(result.journeys.deadButtons.passed, true);
        assert.strictEqual(result.deadInteractiveElements.length, 0);

        // Verify evidence report written to disk
        const reportPath = path.join(validApp, '.ai-dev-hub', 'evidence', 'user-journey-report.json');
        assert.ok(fs.existsSync(reportPath));
      } finally {
        process.env.DECOHUB_OFFLINE_MODE = oldEnv;
      }
    });

    it('should reject when root route returns raw JSON instead of UI', async () => {
      const jsonApp = path.join(tempTestDir, 'json-app');
      fs.mkdirSync(jsonApp, { recursive: true });

      fs.writeFileSync(
        path.join(jsonApp, 'index.html'),
        `{"status":"ok","message":"Welcome to API v1","endpoints":["/api/tasks"]}`
      );

      const oldEnv = process.env.DECOHUB_OFFLINE_MODE;
      process.env.DECOHUB_OFFLINE_MODE = 'true';
      try {
        const result = await UserExperienceSimulator.simulateRealUserJourney({
          projectPath: jsonApp
        });

        assert.strictEqual(result.passed, false);
        assert.strictEqual(result.journeys.firstImpression.passed, false);
        assert.ok(result.details.includes('JSON'));
      } finally {
        process.env.DECOHUB_OFFLINE_MODE = oldEnv;
      }
    });

    it('should flag dead buttons when elements lack event handlers or actions', async () => {
      const deadBtnApp = path.join(tempTestDir, 'dead-btn-app');
      fs.mkdirSync(path.join(deadBtnApp, 'public'), { recursive: true });

      fs.writeFileSync(
        path.join(deadBtnApp, 'public', 'index.html'),
        `<!DOCTYPE html>
<html>
<body>
  <h1>Painel de Assinaturas</h1>
  <button data-dead="true">Exportar CSV Fantasma</button>
  <button class="dead-btn">Gerar Relatório Oculto</button>
</body>
</html>`
      );

      const oldEnv = process.env.DECOHUB_OFFLINE_MODE;
      process.env.DECOHUB_OFFLINE_MODE = 'true';
      try {
        const result = await UserExperienceSimulator.simulateRealUserJourney({
          projectPath: deadBtnApp
        });

        assert.strictEqual(result.passed, false);
        assert.strictEqual(result.journeys.deadButtons.passed, false);
        assert.ok(result.deadInteractiveElements.length >= 2);
      } finally {
        process.env.DECOHUB_OFFLINE_MODE = oldEnv;
      }
    });
  });

  describe('3. IndependentEvaluator Integration with UserExperienceSimulator', () => {
    it('should reject frontend task when UX simulation fails (REWORK_REQUIRED)', async () => {
      const failingProject = path.join(tempTestDir, 'eval-failing-project');
      fs.mkdirSync(path.join(failingProject, 'public'), { recursive: true });

      // Valid HTML but with dead buttons to trigger UX simulation rejection
      fs.writeFileSync(
        path.join(failingProject, 'public', 'index.html'),
        `<!DOCTYPE html>
<html>
<head><title>Dashboard de Planos</title></head>
<body>
  <style>:root { --bg: #fff; --text: #000; --accent: #5e6ad2; }</style>
  <nav><button class="tab">Planos</button></nav>
  <h1>Planos</h1>
  <button data-dead="true">Ação Fantasma Sem Ação</button>
</body>
</html>`
      );

      const contract = IndependentEvaluator.createSuccessContract({
        taskId: 'TASK-UX-FAIL-01',
        projectId: 'proj-ux-01',
        objective: 'Implementar interface frontend da tela de planos com formulário interativo',
        acceptanceCriteria: ['Interface funcional renderizada no navegador sem erros de runtime'],
        verificationSteps: [
          {
            name: 'Verificar HTML',
            command: 'node -e "process.exit(0)"'
          }
        ]
      });

      const oldEnv = process.env.DECOHUB_OFFLINE_MODE;
      process.env.DECOHUB_OFFLINE_MODE = 'true';
      try {
        const evalResult = await IndependentEvaluator.evaluate(
          contract.id,
          failingProject,
          {
            status: 'success',
            filesChanged: ['public/index.html'],
            implemented: ['Interface criada com sucesso'],
            finalResponse: 'Implementado com alta fidelidade.'
          }
        );

        assert.strictEqual(evalResult.verdict, 'FAIL');
        assert.strictEqual(evalResult.taskIsDone, false);
        assert.ok(evalResult.evidence.userJourney);
        assert.strictEqual(evalResult.evidence.userJourney?.passed, false);
        assert.ok(
          evalResult.failedCriteria.some(c =>
            c.includes('UserExperienceSimulator') ||
            c.includes('DEAD_INTERACTIVE_ELEMENTS')
          )
        );
      } finally {
        process.env.DECOHUB_OFFLINE_MODE = oldEnv;
      }
    });

    it('should pass frontend task when UX simulation and criteria succeed', async () => {
      const passingProject = path.join(tempTestDir, 'eval-passing-project');
      fs.mkdirSync(path.join(passingProject, 'public'), { recursive: true });
      fs.mkdirSync(path.join(passingProject, 'test'), { recursive: true });

      fs.writeFileSync(
        path.join(passingProject, 'package.json'),
        JSON.stringify({
          name: 'eval-passing-project',
          type: 'module',
          scripts: { test: 'node test/verify.js' }
        })
      );

      fs.writeFileSync(
        path.join(passingProject, 'test', 'verify.js'),
        `import fs from 'node:fs';
if (!fs.existsSync('public/index.html')) process.exit(1);
console.log('UI Verification passed');
`
      );

      fs.writeFileSync(
        path.join(passingProject, 'public', 'index.html'),
        `<!DOCTYPE html>
<html>
<head>
  <title>ServiceFlow Subscriptions</title>
  <style>
    :root { --bg: #0b0f17; --surface: #16181a; --accent: #5e6ad2; --border: #282b30; }
    ::-webkit-scrollbar { width: 6px; }
  </style>
  <!-- Interface web renderizada com design tokens e ícones SVG -->
</head>
<body>
  <nav>
    <button class="tab">
      <svg width="16" height="16" viewBox="0 0 24 24"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z"/></svg>
      <span>Planos</span>
    </button>
  </nav>
  <form id="plan-form">
    <input type="text" name="name" placeholder="Nome do plano" />
    <input type="number" name="price" placeholder="Preço" />
    <button type="submit">
      <svg width="16" height="16" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
      <span>Criar Plano</span>
    </button>
  </form>
</body>
</html>`
      );

      const contract = IndependentEvaluator.createSuccessContract({
        taskId: 'TASK-UX-PASS-01',
        projectId: 'proj-ux-02',
        objective: 'Implementar dashboard de interface web frontend',
        acceptanceCriteria: ['Renderizar interface web sem erros', 'Usar design tokens e ícones SVG'],
        verificationSteps: [
          {
            name: 'Verificar arquivo index.html',
            command: 'npm test'
          }
        ]
      });

      const oldEnv = process.env.DECOHUB_OFFLINE_MODE;
      process.env.DECOHUB_OFFLINE_MODE = 'true';
      try {
        const evalResult = await IndependentEvaluator.evaluate(
          contract.id,
          passingProject,
          {
            status: 'success',
            filesChanged: ['public/index.html'],
            implemented: [
              'Renderizar interface web sem erros no navegador.',
              'Usar design tokens semânticos e ícones SVG nativos.'
            ],
            finalResponse: 'Implementação 100% testada.'
          }
        );

        assert.strictEqual(evalResult.verdict, 'PASS');
        assert.strictEqual(evalResult.taskIsDone, true);
        assert.ok(evalResult.evidence.userJourney);
        assert.strictEqual(evalResult.evidence.userJourney?.passed, true);
        assert.strictEqual(evalResult.evidence.evidenceSummary?.userJourneyPassed, true);
      } finally {
        process.env.DECOHUB_OFFLINE_MODE = oldEnv;
      }
    });
  });
});
