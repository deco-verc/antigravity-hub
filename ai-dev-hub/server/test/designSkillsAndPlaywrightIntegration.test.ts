// server/test/designSkillsAndPlaywrightIntegration.test.ts
// Testes automatizados para a Fase 6:
// Motor de Design Anti-Slop & Validação Visual
// (taste-skill + vercel-web-guidelines + awesome-design-md + playwright-cli + skills.sh + IndependentEvaluator)

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DesignSkillService } from '../src/designSkillService.js';
import { DocSimpService } from '../src/docSimpService.js';
import { PromptArchitectureService } from '../src/promptArchitectureService.js';
import { IndependentEvaluator } from '../src/independentEvaluator.js';

test('1. Presença dos artefatos oficiais em DOCSIMP/design-skills', () => {
  const root = DesignSkillService.getDesignSkillsDir();
  assert.ok(fs.existsSync(root), `Diretório raiz de design-skills deve existir: ${root}`);

  // Taste-Skill
  const tasteSkillRepo = path.join(root, 'taste-skill');
  assert.ok(fs.existsSync(tasteSkillRepo), 'Repositório taste-skill clonado deve existir');
  assert.ok(
    fs.existsSync(path.join(tasteSkillRepo, 'skills', 'taste-skill', 'SKILL.md')) ||
    fs.existsSync(path.join(tasteSkillRepo, 'skills', 'taste-skill-v2-experimental', 'SKILL.md')),
    'SKILL.md do taste-skill deve estar presente'
  );
  assert.ok(fs.existsSync(path.join(root, 'taste-skill.md')), 'Guia compilado taste-skill.md deve existir');

  // Vercel Web Interface Guidelines
  const vercelGuidelines = path.join(root, 'vercel-web-design-guidelines.md');
  assert.ok(fs.existsSync(vercelGuidelines), 'vercel-web-design-guidelines.md deve existir');
  const vercelContent = fs.readFileSync(vercelGuidelines, 'utf-8');
  assert.ok(vercelContent.includes('tabular-nums') || vercelContent.includes('aria-label'), 'Deve conter regras de acessibilidade e números tabulares da Vercel');

  // Awesome DESIGN.md
  const awesomeRepo = path.join(root, 'awesome-design-md');
  assert.ok(fs.existsSync(awesomeRepo), 'Repositório awesome-design-md clonado deve existir');

  const designSystemsDir = path.join(root, 'design-systems');
  assert.ok(fs.existsSync(designSystemsDir), 'Diretório design-systems deve existir');
  const expectedSystems = ['linear.md', 'stripe.md', 'vercel.md', 'notion.md', 'clean-saas.md', 'fintech.md', 'dark-telemetry.md'];
  for (const sys of expectedSystems) {
    const sysPath = path.join(designSystemsDir, sys);
    assert.ok(fs.existsSync(sysPath), `Sistema de design ${sys} deve existir em ${sysPath}`);
    assert.ok(fs.statSync(sysPath).size > 500, `Sistema ${sys} deve possuir conteúdo substancial`);
  }

  // Playwright Agent CLI guidelines
  const playwrightCli = path.join(root, 'playwright-agent-cli.md');
  assert.ok(fs.existsSync(playwrightCli), 'playwright-agent-cli.md deve existir');
  const pwContent = fs.readFileSync(playwrightCli, 'utf-8');
  assert.ok(pwContent.includes('playwright-cli open'), 'Deve conter comando open');
  assert.ok(pwContent.includes('playwright-cli snapshot'), 'Deve conter comando snapshot');
  assert.ok(pwContent.includes('playwright-cli console'), 'Deve conter comando console error audit');
  assert.ok(pwContent.includes('Graceful Fallback'), 'Deve documentar diretriz de graceful fallback');

  // Skills.sh arsenal adicional
  const additionalSkills = [
    'find-skills.md',
    'frontend-design.md',
    'modern-frontend-design.md',
    'ui-ux-pro-max.md',
    'vercel-react-best-practices.md',
    'vercel-composition-patterns.md',
    'web-animation-design.md'
  ];
  for (const ask of additionalSkills) {
    const askPath = path.join(root, ask);
    assert.ok(fs.existsSync(askPath), `Skill adicional ${ask} deve existir em ${askPath}`);
    assert.ok(fs.statSync(askPath).size > 1000, `Skill ${ask} deve possuir documentação completa`);
  }

  // Catalog.json
  const catalog = DocSimpService.getCatalog();
  const ids = catalog.documents.map(d => d.id);
  assert.ok(ids.includes('taste_skill'), 'catalog.json deve conter taste_skill');
  assert.ok(ids.includes('vercel_guidelines'), 'catalog.json deve conter vercel_guidelines');
  assert.ok(ids.includes('awesome_design_md'), 'catalog.json deve conter awesome_design_md');
  assert.ok(ids.includes('playwright_cli'), 'catalog.json deve conter playwright_cli');
  assert.ok(ids.includes('find_skills'), 'catalog.json deve conter find_skills');
  assert.ok(ids.includes('frontend_design'), 'catalog.json deve conter frontend_design');
  assert.ok(ids.includes('modern_frontend_design'), 'catalog.json deve conter modern_frontend_design');
  assert.ok(ids.includes('ui_ux_pro_max'), 'catalog.json deve conter ui_ux_pro_max');
  assert.ok(ids.includes('vercel_react_best_practices'), 'catalog.json deve conter vercel_react_best_practices');
  assert.ok(ids.includes('vercel_composition_patterns'), 'catalog.json deve conter vercel_composition_patterns');
  assert.ok(ids.includes('web_animation_design'), 'catalog.json deve conter web_animation_design');
});

test('2. Inferência precisa de arquétipo e dos 3 dials (VARIANCE, MOTION, DENSITY)', () => {
  // Linear / Minimalist
  const linearProfile = DesignSkillService.inferDesignProfile('Quero um SaaS minimalista estilo Linear para gerenciamento de sprints');
  assert.equal(linearProfile.archetype, 'linear');
  assert.equal(linearProfile.dials.variance, 5);
  assert.equal(linearProfile.dials.motion, 3);
  assert.equal(linearProfile.dials.density, 3);

  // Stripe
  const stripeProfile = DesignSkillService.inferDesignProfile('Gateway de pagamento com checkout transparente e cobrança PIX');
  assert.equal(stripeProfile.archetype, 'stripe');
  assert.equal(stripeProfile.dials.variance, 6);
  assert.equal(stripeProfile.dials.motion, 4);

  // Brutalist
  const brutalistProfile = DesignSkillService.inferDesignProfile('Landing page brutalista industrial com grid geométrico suíço e alto contraste');
  assert.equal(brutalistProfile.archetype, 'brutalist');
  assert.equal(brutalistProfile.dials.variance, 9);
  assert.equal(brutalistProfile.dials.density, 7);

  // Dark Telemetry
  const telemetryProfile = DesignSkillService.inferDesignProfile('Painel de telemetria dark mode com alta densidade de métricas e cockpit Raycast');
  assert.equal(telemetryProfile.archetype, 'dark-telemetry');
  assert.equal(telemetryProfile.dials.variance, 5);
  assert.equal(telemetryProfile.dials.density, 8);

  // Vercel / Cloud
  const vercelProfile = DesignSkillService.inferDesignProfile('Plataforma de infraestrutura cloud serverless e devops');
  assert.equal(vercelProfile.archetype, 'vercel');
  assert.equal(vercelProfile.dials.density, 6);
});

test('3. Provisionamento real de DESIGN.md e skills no workspace do projeto', async () => {
  const tempProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-design-test-'));

  try {
    const res = await DesignSkillService.provisionDesignSkillsForProject(
      'Plataforma de cobranças recorrentes com layout estilo Stripe',
      tempProjectDir
    );

    assert.equal(res.profile.archetype, 'stripe');
    assert.ok(fs.existsSync(res.designMdPath), 'DESIGN.md deve ter sido criado na raiz do projeto');
    assert.ok(fs.statSync(res.designMdPath).size > 200, 'DESIGN.md deve ter conteúdo substantivo');

    const expectedSkillFiles = [
      'taste-skill.md',
      'vercel-web-design-guidelines.md',
      'playwright-agent-cli.md',
      'frontend-design.md',
      'ui-ux-pro-max.md'
    ];
    for (const sf of expectedSkillFiles) {
      const sfPath = path.join(res.skillsDir, sf);
      assert.ok(fs.existsSync(sfPath), `Arquivo de skill ${sf} deve ter sido copiado para .ai-dev-hub/skills/`);
    }

    assert.ok(res.directiveBlock.includes('ZERO AI-SLOP'), 'Directive block deve exigir Zero AI-Slop');
    assert.ok(res.directiveBlock.includes('tabular-nums'), 'Directive block deve exigir tabular-nums');
    assert.ok(res.directiveBlock.includes('playwright-cli'), 'Directive block deve mencionar playwright-cli');
    assert.ok(res.directiveBlock.length >= 700 && res.directiveBlock.length <= 1600, `Tamanho do directive block (${res.directiveBlock.length}) deve ser conciso`);
  } finally {
    fs.rmSync(tempProjectDir, { recursive: true, force: true });
  }
});

test('4. Injeção de diretrizes de design no PromptArchitectureService respeitando limite de caracteres', () => {
  const profile = DesignSkillService.inferDesignProfile('Dashboard analítico em modo dark telemetry');
  const directiveBlock = DesignSkillService.generateDirectiveBlock(profile, 'C:\\projetos\\dashboard');

  // Teste de buildWorkerPrompt com bloco de design
  const workerResult = PromptArchitectureService.buildWorkerPrompt({
    mode: 'IMPLEMENT',
    projectId: 'proj-ui-123',
    projectName: 'Dashboard Telemetria',
    projectPath: 'C:\\projetos\\dashboard',
    projectObjective: 'Criar dashboard de monitoramento de servidores',
    taskId: 'task-ui-1',
    taskTitle: 'Desenvolver componente de métricas em tempo real',
    acceptanceCriteria: ['Renderizar gráficos com SVG ou Canvas', 'Exibir taxas com font-variant tabular-nums'],
    verificationCommand: 'npm test',
    doneWhen: 'Componente validado sem erros de console',
    expectedScopeFiles: ['src/components/MetricsDashboard.tsx'],
    designSkillContextBlock: directiveBlock
  });

  assert.ok(workerResult.prompt.includes('ZERO AI-SLOP'), 'Prompt do worker deve conter diretrizes Anti-Slop');
  assert.ok(workerResult.prompt.includes('tabular-nums'), 'Prompt do worker deve conter Vercel Guidelines');
  assert.ok(workerResult.prompt.includes('DARK-TELEMETRY'), 'Prompt do worker deve referenciar o arquétipo correto');
  assert.ok(workerResult.prompt.length < 28000, `Prompt do worker (${workerResult.prompt.length} chars) deve respeitar o limite de 28k do CLI`);

  // Teste de buildArchitecturalBlueprintPrompt
  const blueprintResult = PromptArchitectureService.buildArchitecturalBlueprintPrompt({
    projectId: 'proj-ui-123',
    projectName: 'Dashboard Telemetria',
    projectPath: 'C:\\projetos\\dashboard',
    projectObjective: 'Criar dashboard de monitoramento',
    briefing: 'Criar dashboard analítico com estilo dark telemetry e Linear',
    designSkillContextBlock: directiveBlock
  });

  assert.ok(blueprintResult.prompt.includes('ZERO AI-SLOP'), 'Prompt do blueprint deve conter diretrizes Anti-Slop');
  assert.ok(blueprintResult.prompt.length < 28000, `Prompt do blueprint (${blueprintResult.prompt.length} chars) deve respeitar o limite de 28k`);

  // Teste de buildMajorTaskExpansionPrompt
  const expansionResult = PromptArchitectureService.buildMajorTaskExpansionPrompt({
    projectId: 'proj-ui-123',
    projectName: 'Dashboard Telemetria',
    projectPath: 'C:\\projetos\\dashboard',
    projectObjective: 'Criar dashboard de monitoramento',
    majorTask: {
      code: 'GT-5',
      title: 'Interface com Usuário e Componentes Visuais',
      objective: 'Implementar telas e controles interativos'
    },
    designSkillContextBlock: directiveBlock
  });

  assert.ok(expansionResult.prompt.includes('ZERO AI-SLOP'), 'Prompt de expansão deve conter diretrizes Anti-Slop');
  assert.ok(expansionResult.prompt.length < 28000, `Prompt de expansão (${expansionResult.prompt.length} chars) deve respeitar o limite de 28k`);
});

test('5. Detecção assertiva de tarefas de UI/Frontend versus tarefas puras de backend', () => {
  // Tarefas UI
  assert.equal(DesignSkillService.isUiOrFrontendTask('Desenvolver tela de login e formulário com validação'), true);
  assert.equal(DesignSkillService.isUiOrFrontendTask('Criar componente React de card de produto com Tailwind'), true);
  assert.equal(DesignSkillService.isUiOrFrontendTask('Implementar modal de checkout com visual refinado'), true);
  assert.equal(DesignSkillService.isUiOrFrontendTask('Construir dashboard executivo com gráficos e tabelas'), true);

  // Tarefas de Backend puro
  assert.equal(DesignSkillService.isUiOrFrontendTask('Configurar esquema SQLite e migrações de dados em src/db/schema.cjs'), false);
  assert.equal(DesignSkillService.isUiOrFrontendTask('Implementar algoritmo de hash SHA-256 e validação de tokens JWT'), false);
  assert.equal(DesignSkillService.isUiOrFrontendTask('Serviço de cálculo de juros compostos e amortização SAC'), false);
});

test('6. Anti-Slop Visual Gate no IndependentEvaluator (detecção de proliferação de emojis e tokens ausentes)', () => {
  const tempProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-eval-slop-'));

  try {
    // 1. Caso com Slop: uso de emojis como ícones e CSS sem :root
    const badHtml = `
      <!DOCTYPE html>
      <html>
      <body>
        <nav><a class="nav-item">⚡ Início</a></nav>
        <button class="btn-primary">⭐ Favoritar</button>
        <h2 class="section-title">📋 Minhas Tarefas</h2>
      </body>
      </html>
    `;
    const badCss = `
      body { background: #000; color: #fff; }
      .btn-primary { padding: 10px; }
    `;
    fs.writeFileSync(path.join(tempProjectDir, 'index.html'), badHtml, 'utf-8');
    fs.writeFileSync(path.join(tempProjectDir, 'styles.css'), badCss, 'utf-8');

    const evalBad = IndependentEvaluator.validateFrontendDesignQuality(
      tempProjectDir,
      ['index.html', 'styles.css'],
      'Desenvolver tela inicial da aplicação'
    );

    assert.equal(evalBad.passed, false, 'Deve reprovar UI com slop visual');
    assert.ok(evalBad.findings.some(f => f.type === 'EMOJI_ICON_PROLIFERATION'), 'Deve detectar proliferação de emojis como ícones');
    assert.ok(evalBad.findings.some(f => f.type === 'MISSING_DESIGN_TOKENS'), 'Deve detectar ausência de tokens em :root');
    assert.ok(evalBad.score < 100, 'Score deve ser reduzido');

    // 2. Caso Limpo / Profissional: ícones SVG e :root semântico com custom scrollbar
    const goodHtml = `
      <!DOCTYPE html>
      <html>
      <body>
        <nav>
          <a class="nav-item">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="10"/></svg>
            <span>Início</span>
          </a>
        </nav>
        <button class="btn-primary">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15 8 22 9 17 14 18 21 12 17 5 21 7 14 2 9 9 8 12 2"/></svg>
          <span>Favoritar</span>
        </button>
      </body>
      </html>
    `;
    const goodCss = `
      :root {
        --bg: #090a0f;
        --surface: #11131a;
        --accent: #5e6ad2;
        --border: rgba(255, 255, 255, 0.08);
      }
      ::-webkit-scrollbar { width: 6px; }
      body { background: var(--bg); color: #fff; }
    `;
    fs.writeFileSync(path.join(tempProjectDir, 'index.html'), goodHtml, 'utf-8');
    fs.writeFileSync(path.join(tempProjectDir, 'styles.css'), goodCss, 'utf-8');

    const evalGood = IndependentEvaluator.validateFrontendDesignQuality(
      tempProjectDir,
      ['index.html', 'styles.css'],
      'Desenvolver tela inicial da aplicação'
    );

    assert.equal(evalGood.passed, true, 'Deve aprovar UI com padrão limpo');
    assert.equal(evalGood.findings.length, 0, 'Não deve haver violações de design slop');
    assert.equal(evalGood.score, 100, 'Score deve ser 100');
  } finally {
    fs.rmSync(tempProjectDir, { recursive: true, force: true });
  }
});

test('7. Validação de excelência visual no projeto redesenhado FocusDay Planner', () => {
  const rotinaPath = 'C:\\IA\\test-projects\\rotinateste';
  if (!fs.existsSync(rotinaPath)) return;

  const result = IndependentEvaluator.validateFrontendDesignQuality(
    rotinaPath,
    ['public/index.html', 'public/styles.css', 'public/js/dayView.js'],
    'Visão do Dia do FocusDay Planner'
  );

  assert.equal(result.passed, true, `FocusDay Planner redesenhado deve passar no Anti-Slop Visual Gate: ${result.details}`);
  assert.equal(result.findings.length, 0, 'FocusDay Planner redesenhado não deve ter findings de slop visual');
  assert.equal(result.score, 100, 'Score de qualidade de design do FocusDay Planner deve ser 100');
});
