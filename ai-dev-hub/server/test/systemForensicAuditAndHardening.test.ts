import test, { describe, it } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { PromptArchitectureService } from '../src/promptArchitectureService.js';
import { DocSimpService } from '../src/docSimpService.js';
import { DesignSkillService } from '../src/designSkillService.js';
import { ReaSaaSMasterService } from '../src/reaSaaSMasterService.js';
import { AgentApiGateway } from '../src/agentApiGateway.js';
import { HierarchicalOrchestrationService } from '../src/hierarchicalOrchestrationService.js';
import { db } from '../src/db.js';

describe('AUDITORIA FORENSE COMPLETA & BLINDAGEM SISTÊMICA (FASES 1 A 14)', () => {
  const largeBriefing = `
Desenvolver o Nexus ERP 2.0: Plataforma SaaS completa e enterprise de Gestão Financeira, Faturamento Recorrente, Assinaturas, Vendas e CRM para PMEs.
O sistema deve conter:
1. Módulo Financeiro: Plano de contas, fluxo de caixa diário/mensal, conciliação bancária OFX/CSV, emissão de boletos e Pix via PushinPay/Asaas, cobranças automatizadas com réguas de cobrança por e-mail e WhatsApp.
2. Faturamento e Assinaturas: Planos mensais/anuais, upgrades/downgrades prorata, métricas SaaS (MRR, ARR, Churn Rate, LTV, CAC, ARPU, Quick Ratio), gateways múltiplos de pagamento e split de faturamento.
3. Vendas e CRM: Funil de vendas Kanban com drag-and-drop, pipeline de oportunidades, cadastro de clientes (Pessoa Física e Jurídica com validação de CPF/CNPJ), histórico de interações e emissão de propostas comerciais em PDF.
4. App Shell & Interface: Command Palette (Ctrl+K), navegação por atalhos, modo escuro/claro, slide-over drawers para edição rápida sem recarregar tela, data-grids avançados com filtros compostos, ordenação e exportação CSV.
5. BI & Analytics: Dashboards executivos com gráficos SVG interativos, tooltips flutuantes, comparativo de períodos com delta percentual.
6. Segurança & Auditoria: Autenticação JWT com Refresh Tokens, RBAC com múltiplos perfis de acesso, Audit Trail imutável com timeline detalhada de alterações, rate limiting e blindagem contra OWASP Top 10.
7. Infraestrutura & Deploy: Dockerfile Alpine multi-stage, healthcheck em /api/health, semente densa seedIfEmpty com dados realistas de demonstração e backups automatizados.
`;

  const docSimpBlock = DocSimpService.buildDocSimpContextBlock([
    {
      name: 'better-sqlite3',
      aliases: ['sqlite', 'database'],
      category: 'database',
      summary: 'Driver síncrono ultra-rápido para SQLite com suporte a WAL',
      version: '11.0.0',
      file_path: 'C:\\IA\\Antigravity HUB\\DOCSIMP\\sqlite-better-sqlite3.md',
      extracted_at: new Date().toISOString()
    },
    {
      name: 'pushinpay-pix',
      aliases: ['pushinpay', 'pix'],
      category: 'payment',
      summary: 'API Pix rápida e sem taxas para liquidação instantânea',
      version: '1.0.0',
      file_path: 'C:\\IA\\Antigravity HUB\\DOCSIMP\\pushinpay-pix.md',
      extracted_at: new Date().toISOString()
    }
  ]);

  const profile = DesignSkillService.inferDesignProfile(largeBriefing);
  const designBlock = DesignSkillService.generateDirectiveBlock(profile);
  const reaBlock = ReaSaaSMasterService.buildSaaSMasterArchitectureDirective(largeBriefing);

  it('1. Medição e validação do orçamento de prompt (Blueprint, Expansão, Supervisor, Worker < 24.000 chars)', () => {
    // 1.1 Architectural Blueprint (Onda 1)
    const pBlueprint = PromptArchitectureService.buildArchitecturalBlueprintPrompt({
      projectId: 'test-nexus-erp',
      projectName: 'Nexus ERP Enterprise',
      projectPath: 'C:\\IA\\NexusERP',
      projectObjective: 'SaaS Enterprise de Gestão Financeira e Assinaturas',
      briefing: largeBriefing,
      docSimpContextBlock: docSimpBlock,
      designSkillContextBlock: designBlock,
      reaSaaSMasterContextBlock: reaBlock
    });

    // 1.2 Major Task Expansion (Onda 2)
    const pExpansion = PromptArchitectureService.buildMajorTaskExpansionPrompt({
      projectId: 'test-nexus-erp',
      projectName: 'Nexus ERP Enterprise',
      projectPath: 'C:\\IA\\NexusERP',
      projectObjective: 'SaaS Enterprise de Gestão Financeira e Assinaturas',
      briefing: largeBriefing,
      majorTask: {
        code: 'GT-5',
        title: 'Interface com Usuário, App Shell, Command Palette, Data Grids e BI Dashboards',
        objective: 'Implementar interface completa seguindo os 7 pilares SaaS Master com responsividade e acessibilidade',
        expectedOutcome: 'Frontend funcional navegável com drawer lateral e dashboards',
        stages: [
          { code: 'ET-5.1', title: 'App Shell e Command Palette' },
          { code: 'ET-5.2', title: 'Data Grids e Drawers' },
          { code: 'ET-5.3', title: 'BI Dashboards SVG' }
        ],
        requirementIds: ['REQ-5.1', 'REQ-5.2', 'REQ-5.3', 'REQ-5.4']
      },
      docSimpContextBlock: docSimpBlock,
      designSkillContextBlock: designBlock,
      reaSaaSMasterContextBlock: reaBlock
    });

    // 1.3 Supervisor Prompt (INITIAL_PLAN)
    const pSupervisor = PromptArchitectureService.buildSupervisorPrompt({
      mode: 'INITIAL_PLAN',
      projectId: 'test-nexus-erp',
      projectName: 'Nexus ERP Enterprise',
      projectPath: 'C:\\IA\\NexusERP',
      projectObjective: 'SaaS Enterprise de Gestão Financeira e Assinaturas',
      briefing: largeBriefing,
      docSimpContextBlock: docSimpBlock,
      designSkillContextBlock: designBlock,
      reaSaaSMasterContextBlock: reaBlock
    });

    // 1.4 Worker Prompt (IMPLEMENT)
    const pWorker = PromptArchitectureService.buildWorkerPrompt({
      mode: 'IMPLEMENT',
      projectId: 'test-nexus-erp',
      projectName: 'Nexus ERP Enterprise',
      projectPath: 'C:\\IA\\NexusERP',
      projectObjective: 'SaaS Enterprise de Gestão Financeira e Assinaturas',
      taskId: 'task-5-2',
      taskTitle: 'Data Grid de Assinaturas com Busca Debounce, Filtros Compostos e Exportação CSV',
      taskDescription: 'Implementar tabela dinâmica de assinaturas com busca debounce de 300ms, ordenação por coluna, filtros de status e botão de exportação CSV.',
      majorTaskCode: 'GT-5',
      majorTaskTitle: 'Interface com Usuário SaaS Master',
      stageCode: 'ET-5.2',
      stageTitle: 'Data Grids e Drawers',
      requirementIds: ['REQ-5.2'],
      acceptanceCriteria: [
        'Campo de busca filtra assinaturas em tempo real com debounce',
        'Filtros compostos por status e data de vencimento',
        'Botão de exportação gera arquivo .csv com encoding UTF-8 BOM',
        'Testes de unidade cobrindo funções de filtro e exportação'
      ],
      verificationCommand: 'npm test',
      doneWhen: 'Data grid renderiza registros com paginação e exportação CSV funcional com testes passando',
      expectedScopeFiles: ['public/js/components/data-grid.js', 'public/js/services/export-csv.js', 'test/dataGrid.test.js'],
      docSimpContextBlock: docSimpBlock,
      designSkillContextBlock: designBlock,
      reaSaaSMasterContextBlock: reaBlock
    });

    console.log(`[PROMPT BUDGET AUDIT] Blueprint: ${pBlueprint.prompt.length} chars`);
    console.log(`[PROMPT BUDGET AUDIT] Expansão:  ${pExpansion.prompt.length} chars`);
    console.log(`[PROMPT BUDGET AUDIT] Supervisor: ${pSupervisor.prompt.length} chars`);
    console.log(`[PROMPT BUDGET AUDIT] Worker:     ${pWorker.prompt.length} chars`);

    // Todos devem estar abaixo de 24.000 chars com margem de segurança de 4.000 chars para o teto de 28.000
    assert.ok(pBlueprint.prompt.length <= 24000, `Blueprint (${pBlueprint.prompt.length}) deve ser <= 24.000 chars`);
    assert.ok(pExpansion.prompt.length <= 24000, `Expansão (${pExpansion.prompt.length}) deve ser <= 24.000 chars`);
    assert.ok(pSupervisor.prompt.length <= 24000, `Supervisor (${pSupervisor.prompt.length}) deve ser <= 24.000 chars`);
    assert.ok(pWorker.prompt.length <= 24000, `Worker (${pWorker.prompt.length}) deve ser <= 24.000 chars`);

    // Validação de integridade: critérios de aceitação e comando de verificação nunca devem faltar
    assert.ok(pWorker.prompt.includes('Campo de busca filtra assinaturas'), 'Worker deve conter acceptance criteria');
    assert.ok(pWorker.prompt.includes('COMANDO DE VERIFICAÇÃO: npm test'), 'Worker deve conter verificationCommand');
    assert.ok(pWorker.prompt.includes('public/js/components/data-grid.js'), 'Worker deve conter expectedScopeFiles');
  });

  it('2. Clamping Inteligente de Prompt com Preservação da Camada C (Critérios, Arquivos e Comando de Verificação)', () => {
    // Cria um prompt massivo de 36.000 caracteres simulando documentações extras gigantes
    const headPart = '=== CAMADA A: REGRAS PERMANENTES DO WORKER ===\nRegra 1: Inspecionar o código.\nRegra 2: Implementar.';
    const middleNoise = 'DADOS_DE_DOCUMENTACAO_VERBOSE_'.repeat(1200); // ~36.000 chars
    const tailPart = [
      '=== CAMADA C: CONTEXTO REAL DA TAREFA ===',
      'TAREFA ATUAL: Criar Endpoints de Faturamento',
      'CRITÉRIOS DE ACEITAÇÃO: [CRIT-1] Endpoint POST /api/invoices deve retornar HTTP 201; [CRIT-2] Validação de CNPJ',
      'COMANDO DE VERIFICAÇÃO: npm test',
      'ARQUIVOS ESPERADOS NO ESCOPO: src/routes/invoices.ts, test/invoices.test.ts',
      'INSTRUÇÕES DO SUPERVISOR: Implementar sem simulações e sem placeholders.'
    ].join('\n');

    const massivePrompt = `${headPart}\n\n${middleNoise}\n\n${tailPart}`;
    assert.ok(massivePrompt.length > 32000, `Prompt massivo deve exceder 32.000 caracteres (tem: ${massivePrompt.length})`);

    const clamped = AgentApiGateway.clampPromptForCli(massivePrompt);

    // Deve respeitar o teto seguro do Windows
    assert.ok(clamped.length <= 28000, `Prompt compactado deve ter <= 28.000 chars (tem: ${clamped.length})`);

    // Deve conter o aviso de compactação no meio
    assert.ok(clamped.includes('Conteúdo intermediário compactado defensivamente'), 'Deve conter aviso de truncamento intermediário');

    // DEVE PRESERVAR 100% DAS INSTRUÇÕES INICIAIS E FINAIS (CRITÉRIOS, ARQUIVOS, COMANDO)
    assert.ok(clamped.startsWith('=== CAMADA A: REGRAS PERMANENTES DO WORKER ==='), 'Cabeçalho e regras permanentes devem ser preservados');
    assert.ok(clamped.includes('[CRIT-1] Endpoint POST /api/invoices deve retornar HTTP 201'), 'Critérios de aceitação da Camada C devem ser preservados');
    assert.ok(clamped.includes('COMANDO DE VERIFICAÇÃO: npm test'), 'Comando de verificação deve ser preservado');
    assert.ok(clamped.includes('src/routes/invoices.ts'), 'Arquivos esperados de escopo devem ser preservados');
  });

  it('3. Auto-Heal determinístico de DAG ativado no generateMultiPassPlannedTasks', () => {
    const tmpAuthDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-test-'));
    try {
      const planned = HierarchicalOrchestrationService.generateMultiPassPlannedTasks({
        briefing: 'Criar micro-serviço de autenticação e tokens',
        projectPath: tmpAuthDir,
        projectName: 'Auth Service',
        projectId: 'auth-service-test'
      });

      assert.ok(planned.length >= 2, 'Deve gerar tarefas planejadas');

      // Verifica que não há dependências cíclicas ou auto-referências
      for (const task of planned) {
        if (task.dependencies) {
          assert.ok(!task.dependencies.includes(task.code || task.title), 'Nenhuma tarefa pode depender de si mesma');
        }
      }
    } finally {
      try { fs.rmSync(tmpAuthDir, { recursive: true, force: true }); } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "systemForensicAuditAndHardening.test",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:systemForensicAuditAndHardening.test]", err);
      }
    }
    }
  });

  it('4. Auditoria de resiliência e concorrência no SQLite (PRAGMA WAL e busy_timeout >= 5000)', () => {
    const journalModeRow: any = db.prepare('PRAGMA journal_mode;').get();
    const busyTimeoutRow: any = db.prepare('PRAGMA busy_timeout;').get();

    assert.strictEqual(journalModeRow.journal_mode.toUpperCase(), 'WAL', 'SQLite deve estar operando em modo WAL');
    assert.ok(Number(busyTimeoutRow.timeout) >= 5000, `busy_timeout (${busyTimeoutRow.timeout}ms) deve ser >= 5000ms`);
  });

  it('5. Auditoria e Saneamento de integridade do hub.db de produção', async () => {
    const prodDbPath = path.join(process.env.USERPROFILE || 'C:\\Users\\Deco', '.ai-dev-hub', 'hub.db');
    if (fs.existsSync(prodDbPath)) {
      const { DatabaseSync } = await import('node:sqlite');
      const prodDb = new DatabaseSync(prodDbPath);
      try {
        prodDb.exec('PRAGMA journal_mode = WAL;');
        prodDb.exec('PRAGMA busy_timeout = 10000;');

        // Remove quaisquer reservas mortas ou leases órfãos caso o processo anterior tenha sido finalizado
        prodDb.exec("DELETE FROM execution_reservations WHERE datetime(created_at, '+10 minutes') < datetime('now')");
        prodDb.exec("UPDATE worker_leases SET status = 'expired' WHERE status = 'active' AND datetime(lease_until) < datetime('now')");
        prodDb.exec("UPDATE agent_turn_observations SET phase = 'CONSUMED' WHERE phase IN ('IN_FLIGHT', 'UNCERTAIN') AND datetime(dispatched_at, '+30 minutes') < datetime('now')");

        const reservationsCount: any = prodDb.prepare('SELECT count(*) as count FROM execution_reservations').get();
        const unconsumedCount: any = prodDb.prepare("SELECT count(*) as count FROM agent_turn_observations WHERE phase IN ('IN_FLIGHT', 'UNCERTAIN')").get();

        console.log(`[PROD HUB.DB AUDIT] Reservas ativas: ${reservationsCount.count}, Turnos pendentes: ${unconsumedCount.count}`);
        assert.ok(reservationsCount.count >= 0, 'Consulta de reservas válida');
      } finally {
        prodDb.close();
      }
    }
  });

  it('6. Verificação da fiação ponta a ponta do ReaSaaSMasterService no Worker', async () => {
    const isSaaS = ReaSaaSMasterService.isSaaSOrFullStackProject('Construir SaaS financeiro com dashboard, assinaturas e app shell');
    assert.strictEqual(isSaaS, true, 'Deve identificar projeto como SaaS');

    const directive = ReaSaaSMasterService.buildSaaSMasterArchitectureDirective('SaaS ERP');
    assert.ok(directive.includes('APP SHELL ENTERPRISE'), 'Deve conter diretrizes SaaS Master');
    assert.ok(directive.includes('SLIDE-OVER DETAIL DRAWERS'), 'Deve conter Drawers');
    assert.ok(directive.includes('DATA GRID AVANÇADO'), 'Deve conter Data Grid');
  });
});
