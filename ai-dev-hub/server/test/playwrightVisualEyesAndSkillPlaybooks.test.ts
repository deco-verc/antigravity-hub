// server/test/playwrightVisualEyesAndSkillPlaybooks.test.ts
// Testes automatizados da FASE 7: Operacionalização Efetiva das Skills no DecoHUB
// - Product Matrix Recipes (SaaS, Fintech, Planner, Telemetry)
// - Role-Specific Skill Playbooks (Supervisor, Worker, Evaluator)
// - Dynamic Skill Discovery (DOCSIMP / design-skills)
// - PlaywrightVisualInspector ("Olhos Reais" & Offline Fallback)
// - IndependentEvaluator rejection of fatal runtime console errors & empty root

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { DesignSkillService } from '../src/designSkillService.js';
import { PlaywrightVisualInspector } from '../src/playwrightVisualInspector.js';
import { IndependentEvaluator } from '../src/independentEvaluator.js';

describe('FASE 7: Playwright Visual Inspector & Skill Playbooks', () => {
  let tempTestDir: string;

  before(() => {
    tempTestDir = path.join(os.tmpdir(), `decohub-fase7-test-${Date.now()}`);
    fs.mkdirSync(tempTestDir, { recursive: true });
  });

  after(() => {
    try {
      if (fs.existsSync(tempTestDir)) {
        fs.rmSync(tempTestDir, { recursive: true, force: true });
      }
    } catch {}
  });

  describe('1. Product Matrix Recipes (DesignSkillService.getProductMatrixRecipe)', () => {
    it('should generate accurate recipe for SaaS Subscriptions domain', () => {
      const recipe = DesignSkillService.getProductMatrixRecipe('SaaS de assinaturas com faturas recorrentes e cobrança');
      assert.strictEqual(recipe.domain, 'saas-subscriptions');
      assert.strictEqual(recipe.archetype, 'linear');
      assert.strictEqual(recipe.dials.density, 6);
      assert.ok(recipe.cssTokens['--bg']);
      assert.ok(recipe.cssTokens['--accent']);
      assert.strictEqual(recipe.cssTokens['--accent'], '#5e6ad2');
      assert.ok(recipe.antiSlopChecklist.some(c => c.includes('SVG')));
      assert.ok(recipe.antiSlopChecklist.some(c => c.includes('tabular-nums')));
    });

    it('should generate accurate recipe for Fintech & Payments domain', () => {
      const recipe = DesignSkillService.getProductMatrixRecipe('Gateway de pagamentos via Pix e checkout transparente');
      assert.strictEqual(recipe.domain, 'fintech-payments');
      assert.strictEqual(recipe.archetype, 'stripe');
      assert.strictEqual(recipe.cssTokens['--accent'], '#10b981');
      assert.strictEqual(recipe.dials.density, 7);
    });

    it('should generate accurate recipe for Productivity & Daily Planner domain', () => {
      const recipe = DesignSkillService.getProductMatrixRecipe('FocusDay Planner: rotina diária, hábitos e tarefas com foco');
      assert.strictEqual(recipe.domain, 'productivity-planner');
      assert.strictEqual(recipe.archetype, 'linear');
      assert.strictEqual(recipe.cssTokens['--accent'], '#6366f1');
    });

    it('should generate accurate recipe for DevOps & Dark Telemetry domain', () => {
      const recipe = DesignSkillService.getProductMatrixRecipe('Cockpit dark telemetry com logs em tempo real e terminal');
      assert.strictEqual(recipe.domain, 'devops-telemetry');
      assert.strictEqual(recipe.archetype, 'dark-telemetry');
      assert.strictEqual(recipe.cssTokens['--bg'], '#010102');
      assert.strictEqual(recipe.cssTokens['--accent'], '#06b6d4');
      assert.strictEqual(recipe.dials.density, 9);
    });
  });

  describe('2. Role-Specific Skill Playbooks (DesignSkillService.buildRoleSpecificSkillPlaybook)', () => {
    it('should generate Supervisor playbook with Step 0 Foundation, SVG ban on emojis and 4 UI states', () => {
      const playbook = DesignSkillService.buildRoleSpecificSkillPlaybook('SUPERVISOR', 'SaaS Subscriptions');
      assert.ok(playbook.includes('PLAYBOOK DE SKILL PARA O SUPERVISOR'));
      assert.ok(playbook.includes('TAREFA 0 - FOUNDATION OBRIGATÓRIA'));
      assert.ok(playbook.includes('BANIMENTO DE EMOJIS'));
      assert.ok(playbook.includes('4 ESTADOS DE INTERFACE'));
      assert.ok(playbook.includes('CRITÉRIOS DE AUDITORIA'));
    });

    it('should generate Worker playbook with 4-Step Frontend Protocol and Vercel Polish', () => {
      const playbook = DesignSkillService.buildRoleSpecificSkillPlaybook('WORKER', 'SaaS Subscriptions');
      assert.ok(playbook.includes('PROTOCOLO 4-PASSOS FRONTEND'));
      assert.ok(playbook.includes('PASSO 1: FUNDAÇÃO (DESIGN TOKENS)'));
      assert.ok(playbook.includes('PASSO 2: COMPOSIÇÃO ANTI-SLOP'));
      assert.ok(playbook.includes('PASSO 3: POLIMENTO VERCEL & ACESSIBILIDADE'));
      assert.ok(playbook.includes('PASSO 4: AUTO-INSPEÇÃO ("OLHOS DO AGENTE")'));
      assert.ok(playbook.includes('playwright-cli open'));
    });

    it('should generate Evaluator playbook with objective quality gates and screenshot evidence', () => {
      const playbook = DesignSkillService.buildRoleSpecificSkillPlaybook('EVALUATOR', 'SaaS Subscriptions');
      assert.ok(playbook.includes('PLAYBOOK DE AUDITORIA VISUAL PARA O INDEPENDENT EVALUATOR'));
      assert.ok(playbook.includes('ZERO CONSOLE ERRORS'));
      assert.ok(playbook.includes('EMPTY ROOT DETECTION'));
      assert.ok(playbook.includes('OVERFLOW & RESPONSIVIDADE'));
      assert.ok(playbook.includes('EVIDÊNCIA EM SCREENSHOTS'));
    });
  });

  describe('3. Dynamic Skill Discovery (DesignSkillService.discoverSkillsForDomain)', () => {
    it('should discover animation skill for motion queries', () => {
      const skills = DesignSkillService.discoverSkillsForDomain('animation and motion transitions');
      assert.ok(skills.some(s => s.includes('animation')));
    });

    it('should discover taste and anti-slop skills for taste queries', () => {
      const skills = DesignSkillService.discoverSkillsForDomain('taste visual anti-slop');
      assert.ok(skills.some(s => s.includes('taste')));
    });

    it('should discover playwright cli skill for browser automation queries', () => {
      const skills = DesignSkillService.discoverSkillsForDomain('playwright browser cli');
      assert.ok(skills.some(s => s.includes('playwright')));
    });
  });

  describe('4. PlaywrightVisualInspector (Offline & Structural Mode)', () => {
    it('should inspect clean HTML fixture and pass with interactive elements and tokens', async () => {
      const cleanProjectDir = path.join(tempTestDir, 'clean-project');
      const publicDir = path.join(cleanProjectDir, 'public');
      fs.mkdirSync(publicDir, { recursive: true });

      const htmlContent = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Clean UI App</title>
  <style>
    :root {
      --bg: #0f1011;
      --surface: #16181a;
      --accent: #5e6ad2;
      --border: #282b30;
    }
    body { font-family: sans-serif; background: var(--bg); color: #fff; }
    .btn { background: var(--accent); color: #fff; padding: 8px 16px; border-radius: 6px; }
  </style>
</head>
<body>
  <div id="app">
    <h1>Dashboard Principal</h1>
    <button class="btn" aria-label="Criar item">Criar Item</button>
    <a href="/details">Ver Detalhes</a>
    <input type="text" placeholder="Filtrar..." />
  </div>
</body>
</html>`;

      fs.writeFileSync(path.join(publicDir, 'index.html'), htmlContent, 'utf-8');

      const result = await PlaywrightVisualInspector.inspectRenderedApp({
        projectPath: cleanProjectDir,
        taskId: 'task-clean',
        offlineFallback: true
      });

      assert.strictEqual(result.passed, true);
      assert.strictEqual(result.isEmptyRoot, false);
      assert.strictEqual(result.interactiveElementsCount.buttons, 1);
      assert.strictEqual(result.interactiveElementsCount.links, 1);
      assert.strictEqual(result.interactiveElementsCount.inputs, 1);
      assert.strictEqual(result.computedTokens.hasRootTokens, true);
      assert.strictEqual(result.consoleErrors.length, 0);
      assert.ok(result.evidenceScreenshots.length > 0);
    });

    it('should detect empty root and fail inspection', async () => {
      const emptyProjectDir = path.join(tempTestDir, 'empty-project');
      fs.mkdirSync(emptyProjectDir, { recursive: true });

      const emptyHtml = `<!DOCTYPE html><html><head></head><body></body></html>`;
      fs.writeFileSync(path.join(emptyProjectDir, 'index.html'), emptyHtml, 'utf-8');

      const result = await PlaywrightVisualInspector.inspectRenderedApp({
        projectPath: emptyProjectDir,
        taskId: 'task-empty',
        offlineFallback: true
      });

      assert.strictEqual(result.passed, false);
      assert.strictEqual(result.isEmptyRoot, true);
      assert.strictEqual(result.interactiveElementsCount.total, 0);
    });

    it('should detect runtime console errors and fail inspection', async () => {
      const errorProjectDir = path.join(tempTestDir, 'error-project');
      fs.mkdirSync(errorProjectDir, { recursive: true });

      const errorHtml = `<!DOCTYPE html><html><head></head><body>
        <div id="root"><h1>Erro Test</h1></div>
        <script>throw new Error("Fatal runtime error");</script>
      </body></html>`;
      fs.writeFileSync(path.join(errorProjectDir, 'index.html'), errorHtml, 'utf-8');

      const result = await PlaywrightVisualInspector.inspectRenderedApp({
        projectPath: errorProjectDir,
        taskId: 'task-error',
        offlineFallback: true
      });

      assert.strictEqual(result.passed, false);
      assert.ok(result.consoleErrors.length > 0);
      assert.ok(result.consoleErrors[0].includes('Fatal runtime error'));
    });
  });

  describe('5. PlaywrightVisualInspector (Browser Telemetry & Screenshot Evidence)', () => {
    it('should evaluate page, collect viewport audit and save screenshot evidence', async () => {
      const liveProjectDir = path.join(tempTestDir, 'live-project');
      const publicDir = path.join(liveProjectDir, 'public');
      fs.mkdirSync(publicDir, { recursive: true });

      const liveHtml = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Live Headless Test</title>
  <style>
    :root {
      --bg: #090a0f;
      --surface: #12141c;
      --accent: #10b981;
      --border: #202436;
    }
    body { background: var(--bg); color: #fff; margin: 0; padding: 20px; font-family: sans-serif; }
    .btn { background: var(--accent); color: #fff; border: 0; padding: 10px 16px; border-radius: 6px; }
  </style>
</head>
<body>
  <h1>Live Playwright Inspection</h1>
  <button class="btn" aria-label="Confirmar">Confirmar</button>
</body>
</html>`;
      fs.writeFileSync(path.join(publicDir, 'index.html'), liveHtml, 'utf-8');

      const result = await PlaywrightVisualInspector.inspectRenderedApp({
        projectPath: liveProjectDir,
        taskId: 'live-test',
        offlineFallback: true
      });

      assert.strictEqual(result.passed, true);
      assert.strictEqual(result.consoleErrors.length, 0);
      assert.strictEqual(result.isEmptyRoot, false);
      assert.strictEqual(result.interactiveElementsCount.buttons, 1);
      assert.strictEqual(result.computedTokens.hasRootTokens, true);
      assert.ok(result.evidenceScreenshots.length > 0);
      for (const s of result.evidenceScreenshots) {
        assert.ok(fs.existsSync(s));
      }
    });

    it('should capture runtime console error from browser inspection', async () => {
      const liveErrorDir = path.join(tempTestDir, 'live-error-project');
      fs.mkdirSync(liveErrorDir, { recursive: true });

      const liveErrorHtml = `<!DOCTYPE html>
<html>
<head><title>Console Error Test</title></head>
<body>
  <div id="app"><h1>Error Page</h1></div>
  <script>
    console.error("Uncaught TypeError: Cannot read properties of undefined (reading 'render')");
  </script>
</body>
</html>`;
      fs.writeFileSync(path.join(liveErrorDir, 'index.html'), liveErrorHtml, 'utf-8');

      const result = await PlaywrightVisualInspector.inspectRenderedApp({
        projectPath: liveErrorDir,
        taskId: 'live-error-test',
        offlineFallback: true
      });

      assert.strictEqual(result.passed, false);
      assert.ok(result.consoleErrors.length > 0);
      assert.ok(result.consoleErrors.some(e => e.includes('Cannot read properties of undefined')));
    });
  });

  describe('6. IndependentEvaluator Visual Quality Integration', () => {
    it('should pass evaluation when frontend implementation satisfies visual quality and anti-slop', async () => {
      const evalProjectDir = path.join(tempTestDir, 'eval-pass-project');
      const publicDir = path.join(evalProjectDir, 'public');
      fs.mkdirSync(publicDir, { recursive: true });

      const htmlContent = `<!DOCTYPE html><html><head>
        <style>
          :root { --bg: #0f1011; --surface: #16181a; --accent: #5e6ad2; --border: #282b30; }
          ::-webkit-scrollbar { width: 6px; }
        </style>
      </head><body>
        <button><svg width="16" height="16"><circle cx="8" cy="8" r="6"/></svg> Confirmar</button>
      </body></html>`;
      fs.writeFileSync(path.join(publicDir, 'index.html'), htmlContent, 'utf-8');

      // Create a test contract in IndependentEvaluator
      const contract = IndependentEvaluator.createSuccessContract({
        taskId: 'eval-task-pass',
        projectId: 'proj-fase7',
        objective: 'Implementar dashboard de interface web frontend',
        acceptanceCriteria: ['Renderizar interface web sem erros', 'Usar design tokens e ícones SVG'],
        verificationSteps: [{
          name: 'Verificação básica',
          command: 'node -e "process.exit(0)"'
        }]
      });

      const report = {
        status: 'success' as const,
        filesChanged: ['public/index.html'],
        implemented: ['Interface dashboard']
      };

      const result = await IndependentEvaluator.evaluate(contract.id, evalProjectDir, report);
      assert.ok(result.evidence.visualInspection);
      assert.strictEqual(result.evidence.evidenceSummary?.visualInspectionPassed, true);
    });

    it('should reject evaluation when severe visual slop (emoji as button icons) is detected', async () => {
      const slopProjectDir = path.join(tempTestDir, 'eval-slop-project');
      fs.mkdirSync(slopProjectDir, { recursive: true });

      const slopHtml = `<!DOCTYPE html><html><body>
        <button>⚡ Salvar</button>
      </body></html>`;
      fs.writeFileSync(path.join(slopProjectDir, 'index.html'), slopHtml, 'utf-8');

      const contract = IndependentEvaluator.createSuccessContract({
        taskId: 'eval-task-slop',
        projectId: 'proj-fase7',
        objective: 'Criar tela de configurações de frontend',
        acceptanceCriteria: ['Criar botão de salvar'],
        verificationSteps: []
      });

      const report = {
        status: 'success' as const,
        filesChanged: ['index.html'],
        implemented: ['Botão salvar']
      };

      const result = await IndependentEvaluator.evaluate(contract.id, slopProjectDir, report);
      assert.strictEqual(result.verdict, 'FAIL');
      assert.ok(result.evaluatorNotes.includes('Anti-Slop Visual'));
      assert.ok(result.evaluatorNotes.includes('EMOJI_ICON_PROLIFERATION'));
    });

    it('should reject evaluation with ROOT_ROUTE_HIJACKED_BY_JSON when server returns JSON at GET / and public/index.html exists', async () => {
      const hijackedProjectDir = path.join(tempTestDir, 'eval-hijacked-project');
      const publicDir = path.join(hijackedProjectDir, 'public');
      const srcDir = path.join(hijackedProjectDir, 'src');
      fs.mkdirSync(publicDir, { recursive: true });
      fs.mkdirSync(srcDir, { recursive: true });

      // Valid frontend files exist
      const validHtml = `<!DOCTYPE html><html><head>
        <style>:root { --bg: #0f1011; --surface: #16181a; --accent: #5e6ad2; --border: #282b30; } ::-webkit-scrollbar { width: 6px; }</style>
      </head><body><main><h1>ServiceFlow Subscriptions</h1><button>Acessar</button></main></body></html>`;
      fs.writeFileSync(path.join(publicDir, 'index.html'), validHtml, 'utf-8');

      // Server hijacked root route with JSON
      const serverCode = `
        import http from 'node:http';
        export function createServer() {
          return http.createServer((req, res) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ message: "Service Flow Sub - Dual-Mode Core Active" }));
          });
        }
      `;
      fs.writeFileSync(path.join(srcDir, 'server.js'), serverCode, 'utf-8');

      const contract = IndependentEvaluator.createSuccessContract({
        taskId: 'eval-task-hijack',
        projectId: 'proj-fase7',
        objective: 'Implementar interface web frontend e servidor HTTP',
        acceptanceCriteria: ['Servir aplicação web no navegador'],
        verificationSteps: []
      });

      const report = {
        status: 'success' as const,
        filesChanged: ['src/server.js', 'public/index.html'],
        implemented: ['Servidor e frontend']
      };

      const result = await IndependentEvaluator.evaluate(contract.id, hijackedProjectDir, report);
      assert.strictEqual(result.verdict, 'FAIL');
      assert.strictEqual(result.taskIsDone, false);
      assert.ok(
        result.evaluatorNotes.includes('ROOT_ROUTE_HIJACKED_BY_JSON') ||
        (result.failedCriteria && result.failedCriteria.some(c => c.includes('ROOT_ROUTE_HIJACKED_BY_JSON'))),
        'Deve conter falha ROOT_ROUTE_HIJACKED_BY_JSON nas notas ou critérios'
      );
    });

    it('should detect raw JSON body in PlaywrightVisualInspector and flag ROOT_ROUTE_HIJACKED_BY_JSON', async () => {
      const rawJsonProjectDir = path.join(tempTestDir, 'raw-json-project');
      fs.mkdirSync(rawJsonProjectDir, { recursive: true });

      const jsonAsHtml = `{"message":"API Active","status":"ok"}`;
      fs.writeFileSync(path.join(rawJsonProjectDir, 'index.html'), jsonAsHtml, 'utf-8');

      const result = await PlaywrightVisualInspector.inspectRenderedApp({
        projectPath: rawJsonProjectDir,
        taskId: 'task-raw-json',
        offlineFallback: true
      });

      assert.strictEqual(result.passed, false);
      assert.strictEqual(result.rootRouteHijackedByJson, true);
      assert.ok(result.details.includes('ROOT_ROUTE_HIJACKED_BY_JSON'));
    });

    it('should validate serviceflow2 project passing visual inspection with tokens and zero emojis', async () => {
      const serviceflowPath = 'C:\\IA\\test-projects\\serviceflow2';
      if (!fs.existsSync(serviceflowPath)) return;

      const result = await PlaywrightVisualInspector.inspectRenderedApp({
        projectPath: serviceflowPath,
        taskId: 'homologation-serviceflow2',
        offlineFallback: true
      });

      assert.strictEqual(result.passed, true);
      assert.strictEqual(result.rootRouteHijackedByJson, false);
      assert.strictEqual(result.isEmptyRoot, false);
      assert.strictEqual(result.computedTokens.hasRootTokens, true);
      assert.strictEqual(result.consoleErrors.length, 0);
      assert.ok(result.interactiveElementsCount.total > 0);
    });

    it('should auto-normalize hardcoded port 3001 to 4000 (PORT_GUARD) in server files and .env.example', async () => {
      const portProjectDir = path.join(tempTestDir, 'port-guard-project');
      const srcDir = path.join(portProjectDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });

      const serverWith3001 = `
        import http from 'node:http';
        const port = process.env.PORT || 3001;
        export const server = http.createServer();
      `;
      fs.writeFileSync(path.join(srcDir, 'server.js'), serverWith3001, 'utf-8');

      const envExampleWith3001 = `
        PORT=3001
        NODE_ENV=development
      `;
      fs.writeFileSync(path.join(portProjectDir, '.env.example'), envExampleWith3001, 'utf-8');

      const contract = IndependentEvaluator.createSuccessContract({
        taskId: 'eval-task-port-guard',
        projectId: 'proj-fase7',
        objective: 'Configurar servidor backend',
        acceptanceCriteria: ['Inicializar servidor'],
        verificationSteps: []
      });

      const report = {
        status: 'success' as const,
        filesChanged: ['src/server.js', '.env.example'],
        implemented: ['Servidor configurado']
      };

      await IndependentEvaluator.evaluate(contract.id, portProjectDir, report);

      // Verify that 3001 was replaced with 4000
      const updatedServer = fs.readFileSync(path.join(srcDir, 'server.js'), 'utf-8');
      const updatedEnv = fs.readFileSync(path.join(portProjectDir, '.env.example'), 'utf-8');

      assert.ok(updatedServer.includes('process.env.PORT || 4000'), 'Deveria normalizar porta 3001 para 4000 no server.js');
      assert.ok(!updatedServer.includes('3001'), 'Não deve conter 3001 no server.js');
      assert.ok(updatedEnv.includes('PORT=4000'), 'Deveria normalizar porta 3001 para 4000 no .env.example');
      assert.ok(!updatedEnv.includes('3001'), 'Não deve conter 3001 no .env.example');
    });
  });
});
