import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DocSimpService } from '../src/docSimpService.js';
import { ReaSaaSMasterService } from '../src/reaSaaSMasterService.js';
import { HierarchicalOrchestrationService } from '../src/hierarchicalOrchestrationService.js';
import { IndependentEvaluator } from '../src/independentEvaluator.js';
import { AgentApiGateway } from '../src/agentApiGateway.js';

describe('FASE 13: Integração morluto/rea e Arquitetura SaaS Master', () => {
  test('1. Presença dos Blueprints REA em DOCSIMP/rea-blueprints e catalog.json', () => {
    const docSimpDir = DocSimpService.getDocSimpDir();
    const blueprintsDir = path.join(docSimpDir, 'rea-blueprints');
    const engineDir = path.join(docSimpDir, 'rea-engine');

    assert.ok(fs.existsSync(blueprintsDir), 'Diretório DOCSIMP/rea-blueprints deve existir');
    assert.ok(fs.existsSync(engineDir), 'Diretório DOCSIMP/rea-engine deve existir');

    const shellBlueprint = path.join(blueprintsDir, 'saas-master-shell-and-state.md');
    const tablesBlueprint = path.join(blueprintsDir, 'saas-master-data-tables-and-bi.md');
    const backendBlueprint = path.join(blueprintsDir, 'saas-master-backend-and-workflows.md');
    const engineReadme = path.join(engineDir, 'README.md');

    assert.ok(fs.existsSync(shellBlueprint), 'saas-master-shell-and-state.md deve existir');
    assert.ok(fs.existsSync(tablesBlueprint), 'saas-master-data-tables-and-bi.md deve existir');
    assert.ok(fs.existsSync(backendBlueprint), 'saas-master-backend-and-workflows.md deve existir');
    assert.ok(fs.existsSync(engineReadme), 'rea-engine/README.md deve existir');

    const shellContent = fs.readFileSync(shellBlueprint, 'utf-8');
    assert.ok(shellContent.includes('Command Palette'), 'Blueprint deve conter Command Palette Ctrl+K');
    assert.ok(shellContent.includes('Slide-Over Detail Drawers'), 'Blueprint deve conter Slide-Over Detail Drawers');
    assert.ok(shellContent.includes('Reactive Client Store'), 'Blueprint deve conter Reactive Client Store');

    const tablesContent = fs.readFileSync(tablesBlueprint, 'utf-8');
    assert.ok(tablesContent.includes('Exportar CSV'), 'Blueprint deve conter Exportar CSV');
    assert.ok(tablesContent.includes('KPIs Executivos'), 'Blueprint deve conter KPIs Executivos');
    assert.ok(tablesContent.includes('SVG'), 'Blueprint deve conter gráficos interativos SVG/Canvas');

    const backendContent = fs.readFileSync(backendBlueprint, 'utf-8');
    assert.ok(backendContent.includes('audit_logs'), 'Blueprint deve conter audit_logs');
    assert.ok(backendContent.includes('/api/audit-logs'), 'Blueprint deve conter /api/audit-logs');
    assert.ok(backendContent.includes('seedIfEmpty'), 'Blueprint deve conter seedIfEmpty');

    // Verifica catalog.json
    const catalogPath = path.join(docSimpDir, 'catalog.json');
    assert.ok(fs.existsSync(catalogPath), 'catalog.json deve existir');
    const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));
    const docIds = catalog.documents.map((d: any) => d.id);
    assert.ok(docIds.includes('rea_saas_master'), 'catalog.json deve conter rea_saas_master');
    assert.ok(docIds.includes('rea_data_tables_bi'), 'catalog.json deve conter rea_data_tables_bi');
    assert.ok(docIds.includes('rea_backend_workflows'), 'catalog.json deve conter rea_backend_workflows');
  });

  test('2. Provisionamento do Blueprint REA e Diretriz dos 7 Pilares SaaS Master', async () => {
    const tempProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-rea-test-'));

    try {
      const briefing = 'Plataforma SaaS de Cobrança e Gestão Financeira com Assinaturas Recorrentes';
      const result = await ReaSaaSMasterService.provisionReaBlueprintForProject(tempProjectDir, briefing);

      // Verifica arquivo copiado para o projeto
      const projectBlueprint = path.join(tempProjectDir, '.ai-dev-hub', 'rea-blueprint.md');
      assert.ok(fs.existsSync(projectBlueprint), '.ai-dev-hub/rea-blueprint.md deve ter sido gerado');
      assert.equal(result.blueprintPath, projectBlueprint);

      // Valida que o dossiê completo foi copiado
      const content = fs.readFileSync(projectBlueprint, 'utf-8');
      assert.ok(content.length > 1000, 'Dossiê em disco deve ter profundidade técnica');
      assert.ok(content.toUpperCase().includes('APP SHELL'), 'Dossiê deve cobrir App Shell');
      assert.ok(content.includes('audit_logs'), 'Dossiê deve cobrir audit_logs');

      // Valida a diretriz sintetizada de alta densidade cobrindo os 8 pilares
      assert.ok(result.directive.includes('APP SHELL ENTERPRISE'), 'Diretriz deve conter Pilar 1');
      assert.ok(result.directive.includes('SLIDE-OVER DETAIL DRAWERS'), 'Diretriz deve conter Pilar 2');
      assert.ok(result.directive.includes('DATA GRID AVANÇADO'), 'Diretriz deve conter Pilar 3');
      assert.ok(result.directive.includes('BI & ANALYTICS REAL'), 'Diretriz deve conter Pilar 4');
      assert.ok(result.directive.includes('BILLING CENTER'), 'Diretriz deve conter Pilar 5 (Billing)');
      assert.ok(result.directive.includes('/docs'), 'Diretriz deve conter Pilar 6 (/docs & Developer Hub)');
      assert.ok(result.directive.includes('RBAC DE EQUIPE'), 'Diretriz deve conter Pilar 7 (RBAC & Audit Trail)');
      assert.ok(result.directive.includes('REACTIVE CLIENT STORE'), 'Diretriz deve conter Pilar 8 (Reactive Store & Seed Rico)');

      // Respeito estrito ao limite do CLI (clampPromptForCli < 28.000 chars)
      assert.ok(
        result.directive.length < 1800,
        `Síntese injetada no prompt deve ser concisa (~1.200 chars). Atual: ${result.directive.length}`
      );
    } finally {
      fs.rmSync(tempProjectDir, { recursive: true, force: true });
    }
  });

  test('3. Decomposição de tarefas no Supervisor/Orquestrador nível SaaS Master', () => {
    const briefing = 'Construir SaaS completo de Faturamento, Clientes, Transações e Relatórios com Dashboard Web';
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-saas-decomp-'));

    try {
      // 1. Geração Multi-Pass para projeto SaaS: 12 Grandes Tarefas e grafo profundo de 35+ a 60+ microtarefas
      const plannedTasks = HierarchicalOrchestrationService.generateMultiPassPlannedTasks({
        briefing,
        projectPath: tempDir,
        projectName: 'SaaS Finance Pro',
        projectId: 'test-saas-proj'
      });

      assert.ok(
        plannedTasks.length >= 35 && plannedTasks.length <= 60,
        `Deve gerar grafo profundo de 35 a 60+ tarefas (gerou: ${plannedTasks.length})`
      );

      // Verifica presença dos pilares fundamentais no grafo de tarefas
      const titles = plannedTasks.map(t => t.title);
      const majorTitles = plannedTasks.map(t => t.majorTaskTitle);
      assert.ok(
        titles.some(t => t.includes('Command Palette')) && (titles.some(t => t.includes('Sidebar')) || majorTitles.some(t => t.includes('App Shell'))),
        'Deve incluir tarefa de Enterprise App Shell & Command Palette'
      );
      assert.ok(
        titles.some(t => t.includes('SVG')) || majorTitles.some(t => t.includes('BI')),
        'Deve incluir tarefa de Dashboard Analítico BI com Gráficos SVG'
      );
      assert.ok(
        titles.some(t => t.includes('Data Grid')),
        'Deve incluir tarefa de Data Grid Avançado'
      );
      assert.ok(
        titles.some(t => t.includes('Bulk Actions') || t.includes('operações em massa')),
        'Deve incluir tarefa de Bulk Actions / operações em lote'
      );
      assert.ok(
        titles.some(t => t.includes('Kanban')),
        'Deve incluir tarefa de visão Kanban'
      );
      assert.ok(
        titles.some(t => t.includes('Drawer') || t.includes('Slide-Over')),
        'Deve incluir tarefa de Slide-Over Detail Drawers'
      );
      assert.ok(
        titles.some(t => t.includes('Billing') || t.includes('Planos') || t.includes('PIX')),
        'Deve incluir tarefa de Billing, Planos e PIX'
      );
      assert.ok(
        titles.some(t => t.includes('/docs') || t.includes('documentação') || majorTitles.some(t => t.includes('/docs'))),
        'Deve incluir tarefa do Portal de Documentação (/docs)'
      );
      assert.ok(
        titles.some(t => t.includes('API Keys') || t.includes('Webhooks') || majorTitles.some(t => t.includes('Developer Hub'))),
        'Deve incluir tarefa do Developer Hub (API Keys & Webhooks)'
      );
      assert.ok(
        titles.some(t => t.includes('RBAC') || t.includes('equipe')),
        'Deve incluir tarefa de RBAC e gestão de equipe'
      );
      assert.ok(
        titles.some(t => t.includes('audit_logs') || t.includes('/api/audit-logs')),
        'Deve incluir tarefa de Audit Trail (/api/audit-logs)'
      );

      // Validação de ausência de ciclos no DAG
      const dagCheck = HierarchicalOrchestrationService.detectCircularDependencies(
        plannedTasks.map(t => ({
          id: t.code || t.title,
          title: t.title,
          code: t.code,
          dependencies: t.dependencies || []
        }))
      );
      assert.equal(dagCheck.hasCycle, false, 'Grafo de tarefas SaaS gerado deve ser um DAG acíclico');

      // 2. Validação da suíte de 10 microtarefas ricas de Frontend/Produto
      const reqMicrotasks = ReaSaaSMasterService.getRequiredSaaSMasterMicrotasks('SaaS Pro');
      assert.equal(reqMicrotasks.length, 10, 'getRequiredSaaSMasterMicrotasks deve retornar exatamente 10 frentes de UI/Produto');
      assert.equal(reqMicrotasks[0].subCode, 'UI-1');
      assert.equal(reqMicrotasks[9].subCode, 'UI-10');
      assert.ok(reqMicrotasks.some(t => t.subCode === 'UI-7' && t.title.includes('Billing Center')));
      assert.ok(reqMicrotasks.some(t => t.subCode === 'UI-8' && t.title.includes('Developer Hub')));
      assert.ok(reqMicrotasks.some(t => t.subCode === 'UI-9' && t.title.includes('/docs')));
      assert.ok(reqMicrotasks.some(t => t.subCode === 'UI-10' && t.title.includes('RBAC')));

      // 3. Subdivisão Semântica de tarefa monolítica marcada como SaaS Master em 10 microtarefas
      const saasMasterMonolith = {
        title: 'Construir Interface SaaS Master Completa',
        description: 'SPA corporativa com App Shell, Data Grid, Drawer e BI Analytics seguindo REA Blueprint',
        milestone: 'GT-5',
        majorTaskCode: 'GT-5',
        criteria: [
          'Interface completa implementada',
          'Navegação entre telas funcional',
          'Testes passando com exitCode 0'
        ],
        allowedScope: ['public/index.html', 'public/app.js', 'public/style.css'],
        expectedFiles: ['public/index.html', 'public/app.js', 'public/style.css']
      };

      const subdivided = HierarchicalOrchestrationService.validateAndSubdivideMicrotasks([saasMasterMonolith], {
        subdivideOversized: true,
        maxSubdivisionDepth: 2
      });

      assert.equal(subdivided.length, 10, 'Monolito SaaS Master deve ser expandido nas 10 microtarefas UI-1 a UI-10');
      for (let i = 0; i < 10; i++) {
        assert.ok(subdivided[i].title.includes(`Task UI-${i + 1}`), `Microtarefa ${i} deve conter Task UI-${i + 1}`);
      }

      // Valida encadeamento sequencial determinístico do DAG (UI-1 -> UI-2 -> ... -> UI-10)
      for (let i = 1; i < 10; i++) {
        assert.deepEqual(subdivided[i].dependencies, [subdivided[i - 1].title], `UI-${i + 1} deve depender de UI-${i}`);
      }
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('4. validateSaaSMasterComplexity rejeita interfaces rasas e aprova completas', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-saas-eval-'));

    try {
      // Caso 1: Interface "Rasa" (CRUD básico sem filtros, sem drawer, sem métricas)
      const shallowHtml = `
        <!DOCTYPE html>
        <html>
        <head><title>CRUD Simples</title></head>
        <body>
          <h1>Minhas Tarefas</h1>
          <table>
            <thead><tr><th>Nome</th><th>Ação</th></tr></thead>
            <tbody><tr><td>Item 1</td><td><button>Excluir</button></td></tr></tbody>
          </table>
        </body>
        </html>
      `;

      const evalShallow = IndependentEvaluator.validateSaaSMasterComplexity(tempDir, {
        taskObjective: 'SaaS Master Enterprise SPA',
        htmlContent: shallowHtml,
        jsContent: 'console.log("ready");'
      });

      assert.equal(evalShallow.passed, false, 'Deve rejeitar interface rasa');
      assert.ok(evalShallow.findings.some(f => f.type === 'SHALLOW_SAAS_INTERFACE'), 'Deve emitir finding SHALLOW_SAAS_INTERFACE');
      assert.ok(evalShallow.score < 100, 'Score deve ser reduzido');
      assert.ok(evalShallow.details.includes('Rejeitado pelo SaaS Master Quality Gate'), 'Deve conter feedback claro');

      // Caso 2: Interface SaaS Master Completa (App Shell + Command Palette Ctrl+K + Drawer + Data Grid + BI + Reactive Store)
      const masterHtml = `
        <!DOCTYPE html>
        <html>
        <head><title>Nexus SaaS Master</title></head>
        <body>
          <aside class="sidebar">
            <div class="sidebar-header">DecoHub SaaS</div>
            <nav class="sidebar-nav">
              <a class="nav-item">Dashboard <span class="badge">12</span></a>
              <a class="nav-item">Transações</a>
              <a class="nav-item">Auditoria</a>
            </nav>
          </aside>
          <main class="app-shell">
            <header class="topbar">
              <input class="global-search search-input" placeholder="Buscar ou executar comando... (Ctrl+K)" />
              <div class="system-status">Online • Sync</div>
            </header>

            <section class="bi-dashboard">
              <div class="kpi-card">
                <span class="metric-value">R$ 48.250,00</span>
                <span class="trend badge-delta">+14.2% vs mês anterior</span>
              </div>
              <div class="svg-chart-container">
                <svg class="chart-svg" viewBox="0 0 600 200"><path d="M 0 100 Q 150 50 300 80 T 600 20" /></svg>
                <div class="chart-tooltip">12 Out: R$ 5.400</div>
              </div>
            </section>

            <section class="data-grid-section">
              <div class="grid-controls">
                <input class="table-filter" placeholder="Filtrar com debounce..." />
                <button class="btn export-csv" onclick="downloadCSV()">Exportar CSV</button>
              </div>
              <table class="sortable-table">
                <thead><tr><th class="sortable">ID</th><th class="sortable">Cliente</th></tr></thead>
                <tbody><tr onclick="openDrawer('tx-1')"><td>TX-1</td><td>Acme Corp</td></tr></tbody>
              </table>
            </section>

            <!-- Slide-Over Detail Drawer -->
            <div id="detail-drawer" class="slide-over detail-drawer hidden">
              <div class="drawer-header">Detalhes do Registro</div>
              <div class="drawer-content">
                <div class="timeline-activity">Audit Log: Atualizado por admin</div>
              </div>
            </div>

            <!-- Command Palette Modal -->
            <div id="command-palette" class="command-palette modal hidden">
              <input placeholder="Digite um comando (Ctrl+K)..." />
            </div>
          </main>
        </body>
        </html>
      `;

      const masterJs = `
        const Store = {
          state: { items: [], metrics: {}, auditLogs: [] },
          dispatch(action, payload) { this.state[action] = payload; },
          subscribe(fn) { this.listener = fn; }
        };
        function openDrawer(id) { document.getElementById('detail-drawer').classList.remove('hidden'); }
        function downloadCSV() { /* Export CSV format RFC-4180 */ }
        window.addEventListener('keydown', (e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            document.getElementById('command-palette').classList.toggle('hidden');
          }
        });
      `;

      const evalMaster = IndependentEvaluator.validateSaaSMasterComplexity(tempDir, {
        taskObjective: 'SaaS Master Enterprise SPA',
        htmlContent: masterHtml,
        jsContent: masterJs
      });

      assert.equal(evalMaster.passed, true, 'Deve aprovar interface SaaS Master rica');
      assert.equal(evalMaster.findings.length, 0, 'Não deve haver findings de interface rasa');
      assert.equal(evalMaster.score, 100, 'Score deve ser 100');
      assert.equal(evalMaster.metrics.totalFeaturesDetected, 5, 'Todos os 5 pilares devem ser detectados');
      assert.ok(evalMaster.metrics.hasShellOrSearch, 'Deve detectar Shell / Busca / Ctrl+K');
      assert.ok(evalMaster.metrics.hasDetailDrawer, 'Deve detectar Detail Drawer');
      assert.ok(evalMaster.metrics.hasDataGridControls, 'Deve detectar Data Grid com CSV e Filtros');
      assert.ok(evalMaster.metrics.hasAnalyticsOrKpis, 'Deve detectar BI, KPIs e gráficos');
      assert.ok(evalMaster.metrics.hasReactiveStoreOrAudit, 'Deve detectar Store e Audit Trail');

      // Verifica integração direta em validateFrontendDesignQuality
      fs.mkdirSync(path.join(tempDir, 'public'), { recursive: true });
      fs.writeFileSync(path.join(tempDir, 'public', 'index.html'), masterHtml, 'utf-8');
      fs.writeFileSync(path.join(tempDir, 'public', 'styles.css'), ':root { --bg: #000; } ::-webkit-scrollbar { width: 6px; }', 'utf-8');
      const fullQualityResult = IndependentEvaluator.validateFrontendDesignQuality(
        tempDir,
        ['public/index.html', 'public/styles.css'],
        'SaaS Master Enterprise SPA Dashboard'
      );
      assert.equal(fullQualityResult.passed, true, 'validateFrontendDesignQuality deve aprovar SaaS Master');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('5. Fallback determinístico offline e resiliência sem dependências externas', async () => {
    const isOffline = AgentApiGateway.isOfflineMode();
    assert.ok(typeof isOffline === 'boolean', 'isOfflineMode deve retornar booleano');

    // Em modo offline ou sem alvos externos, análise gera dossiê a partir dos Master Blueprints
    const result = await ReaSaaSMasterService.analyzeTargetOrReference({
      targetOrBriefing: 'Offline Test App Briefing'
    });

    assert.ok(result.blueprintContent.length > 500, 'Deve gerar conteúdo dos Master Blueprints locais');
    assert.ok(result.directive.includes('APP SHELL ENTERPRISE'), 'Diretriz deve ser produzida com sucesso');
    assert.ok(result.slug.length > 0, 'Slug deve ser gerado');
  });
});
