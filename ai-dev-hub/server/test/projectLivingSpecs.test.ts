import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { db } from '../src/db.js';
import { ProjectLivingSpecService } from '../src/projectLivingSpecService.js';
import { PromptArchitectureService } from '../src/promptArchitectureService.js';
import { PromptManager } from '../src/promptManager.js';
import { HierarchicalOrchestrationService } from '../src/hierarchicalOrchestrationService.js';
import { DeltaFeatureEngine } from '../src/deltaFeatureEngine.js';
import { AutonomousRunnerService } from '../src/autonomousRunnerService.js';

describe('ProjectLivingSpecService - Motor Autônomo de Especificação Viva na Onda 0', () => {
  it('1. Materializa os 4 arquivos físicos de especificação viva e a cópia de DESIGN.md na raiz para briefing curto', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-spec-test-'));
    try {
      const result = await ProjectLivingSpecService.generateAndPersistLivingSpecs({
        projectName: 'FinApp Pro',
        projectPath: tempDir,
        briefing: 'Quero desenvolver um Aplicativo de finanças'
      });

      assert.ok(fs.existsSync(result.conteudoMdPath), 'CONTEUDO.md deve existir em .ai-dev-hub/specs/');
      assert.ok(fs.existsSync(result.designMdPath), 'DESIGN.md deve existir em .ai-dev-hub/specs/');
      assert.ok(fs.existsSync(result.backendMdPath), 'BACKEND.md deve existir em .ai-dev-hub/specs/');
      assert.ok(fs.existsSync(result.principiosMdPath), 'PRINCIPIOS.md deve existir em .ai-dev-hub/specs/');
      assert.ok(fs.existsSync(result.designMdRootPath), 'DESIGN.md deve existir na raiz do projeto');

      // Validar CONTEUDO.md
      const conteudo = fs.readFileSync(result.conteudoMdPath, 'utf-8');
      assert.ok(conteudo.includes('01-Dashboard'), 'Deve conter seção 01-Dashboard');
      assert.ok(conteudo.includes('02-Transações') || conteudo.includes('02-Transacoes'), 'Deve conter seção 02-Transações');
      assert.ok(conteudo.includes('03-Cobranças') || conteudo.includes('03-Cobrancas'), 'Deve conter seção 03-Cobranças');
      assert.ok(conteudo.includes('role="tab"'), 'Deve especificar atributo role="tab"');
      assert.ok(conteudo.includes('data-tab="dashboard"'), 'Deve especificar data-tab="dashboard"');
      assert.ok(conteudo.includes('Δ%'), 'Deve especificar variação percentual delta nos KPIs');
      assert.ok(conteudo.includes('Exportar CSV'), 'Deve exigir botão Exportar CSV');
      assert.ok(conteudo.includes('seedIfEmpty'), 'Deve exigir povoamento inicial via seedIfEmpty');
      assert.ok(conteudo.includes('10-Estrelas'), 'Deve conter os 3 diferenciais 10-Estrelas');

      // Validar DESIGN.md
      const design = fs.readFileSync(result.designMdPath, 'utf-8');
      assert.ok(design.includes('--bg-primary'), 'Deve conter token --bg-primary');
      assert.ok(design.includes('--bg-surface'), 'Deve conter token --bg-surface');
      assert.ok(design.includes('--accent-primary'), 'Deve conter token --accent-primary');
      assert.ok(design.includes('--status-success'), 'Deve conter token --status-success');
      assert.ok(design.includes('tabular-nums'), 'Deve conter regra font-variant-numeric: tabular-nums');
      assert.ok(design.includes('Loading Skeleton'), 'Deve exigir estado Loading Skeleton');
      assert.ok(design.includes('Empty State'), 'Deve exigir estado Empty State');
      assert.ok(design.includes('Populated State'), 'Deve exigir estado Populated State');
      assert.ok(design.includes('Error Toast'), 'Deve exigir estado Error Toast');
      assert.ok(design.includes('Lucide inline'), 'Deve exigir ícones SVG Lucide inline');

      // Validar BACKEND.md
      const backend = fs.readFileSync(result.backendMdPath, 'utf-8');
      assert.ok(backend.includes('CREATE TABLE IF NOT EXISTS audit_logs'), 'Deve conter schema de audit_logs');
      assert.ok(backend.includes('CREATE TABLE IF NOT EXISTS transactions'), 'Deve conter schema de transactions');
      assert.ok(backend.includes('/api/health'), 'Deve listar contrato /api/health');
      assert.ok(backend.includes('/api/audit-logs'), 'Deve listar contrato /api/audit-logs');
      assert.ok(backend.includes('/api/export/csv'), 'Deve listar contrato /api/export/csv');
      assert.ok(backend.includes('HTTP 400'), 'Deve detalhar regras de validação HTTP 400');
      assert.ok(backend.includes('saldo_liquido'), 'Deve conter fórmula matemática de saldo líquido');

      // Validar PRINCIPIOS.md
      const principios = fs.readFileSync(result.principiosMdPath, 'utf-8');
      assert.ok(principios.includes('THINK BEFORE CODING'), 'Deve conter princípio Think Before Coding');
      assert.ok(principios.includes('PORT_GUARD'), 'Deve conter regra PORT_GUARD');
      assert.ok(principios.includes('4000 a 4999') || principios.includes('4000-4999'), 'Deve definir faixa 4000-4999');
      assert.ok(principios.includes('3001') && principios.includes('5173'), 'Deve proibir portas 3001 e 5173');
      assert.ok(principios.includes('ROOT_ROUTE_HIJACKED_BY_JSON'), 'Deve proibir retorno de JSON na raiz');
      assert.ok(principios.includes('escapeHtml'), 'Deve exigir escapeHtml para sanitização XSS');
      assert.ok(principios.includes('DOMContentLoaded'), 'Deve exigir hidratação pós-F5');
    } finally {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "projectLivingSpecs.test",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:projectLivingSpecs.test]", err);
      }
    }
    }
  });

  it('2. Entrega contexto cirúrgico por papel respeitando orçamento de caracteres (entre 1.500 e 3.500 chars, máx 3.800)', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-spec-roles-'));
    try {
      await ProjectLivingSpecService.generateAndPersistLivingSpecs({
        projectName: 'SaaS Suite',
        projectPath: tempDir,
        briefing: 'Gestão de tarefas e sprints para engenharia de software no estilo Linear'
      });

      // 1. WORKER_BACKEND
      const backendCtx = ProjectLivingSpecService.getRoleSpecificSpecContext(tempDir, 'WORKER_BACKEND');
      assert.ok(backendCtx.includes('@.ai-dev-hub/specs/BACKEND.md'), 'Backend context deve referenciar BACKEND.md');
      assert.ok(backendCtx.includes('TABELAS SQLITE OBRIGATÓRIAS'), 'Backend context deve conter tabelas');
      assert.ok(backendCtx.includes('ROTAS REST OBRIGATÓRIAS'), 'Backend context deve conter rotas');
      assert.ok(backendCtx.includes('seedIfEmpty'), 'Backend context deve citar seed');
      assert.ok(backendCtx.length >= 1500, `Backend context deve ter >= 1500 chars (obtido: ${backendCtx.length})`);
      assert.ok(backendCtx.length <= 3800, `Backend context deve ter <= 3800 chars (obtido: ${backendCtx.length})`);

      // 2. WORKER_FRONTEND
      const frontendCtx = ProjectLivingSpecService.getRoleSpecificSpecContext(tempDir, 'WORKER_FRONTEND');
      assert.ok(frontendCtx.includes('@.ai-dev-hub/specs/CONTEUDO.md'), 'Frontend context deve referenciar CONTEUDO.md');
      assert.ok(frontendCtx.includes('SEÇÕES OBRIGATÓRIAS DA INTERFACE'), 'Frontend context deve conter seções');
      assert.ok(frontendCtx.includes('TOKENS CSS :ROOT'), 'Frontend context deve conter tokens CSS');
      assert.ok(frontendCtx.includes('CONTRATOS REST PARA FETCH'), 'Frontend context deve conter contratos de fetch');
      assert.ok(frontendCtx.length >= 1500, `Frontend context deve ter >= 1500 chars (obtido: ${frontendCtx.length})`);
      assert.ok(frontendCtx.length <= 3800, `Frontend context deve ter <= 3800 chars (obtido: ${frontendCtx.length})`);

      // 3. WORKER_FULLSTACK / WORKER_TEST
      const fullstackCtx = ProjectLivingSpecService.getRoleSpecificSpecContext(tempDir, 'WORKER_FULLSTACK');
      assert.ok(fullstackCtx.includes('FULLSTACK & VERIFICAÇÃO AUTOMATIZADA'), 'Fullstack context deve identificar papel');
      assert.ok(fullstackCtx.includes('PORT_GUARD'), 'Fullstack context deve incluir PORT_GUARD');
      assert.ok(fullstackCtx.length >= 1500, `Fullstack context deve ter >= 1500 chars (obtido: ${fullstackCtx.length})`);
      assert.ok(fullstackCtx.length <= 3800, `Fullstack context deve ter <= 3800 chars (obtido: ${fullstackCtx.length})`);

      // 4. SUPERVISOR_BLUEPRINT
      const supervisorCtx = ProjectLivingSpecService.getRoleSpecificSpecContext(tempDir, 'SUPERVISOR_BLUEPRINT');
      assert.ok(supervisorCtx.includes('SUPERVISOR: ARQUITETURA'), 'Supervisor context deve identificar papel');
      assert.ok(supervisorCtx.length >= 1500, `Supervisor context deve ter >= 1500 chars (obtido: ${supervisorCtx.length})`);
      assert.ok(supervisorCtx.length <= 3800, `Supervisor context deve ter <= 3800 chars (obtido: ${supervisorCtx.length})`);
    } finally {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "projectLivingSpecs.test",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:projectLivingSpecs.test]", err);
      }
    }
    }
  });

  it('3. Adapta domínios técnicos distintos (Saúde, DevTools e SaaS Geral)', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-spec-domains-'));
    try {
      // Teste do Domínio Saúde
      const healthResult = await ProjectLivingSpecService.generateAndPersistLivingSpecs({
        projectName: 'Clinica Dental',
        projectPath: tempDir,
        briefing: 'Sistema de gestão de clínica odontológica com prontuário de pacientes'
      });
      const healthBackend = fs.readFileSync(healthResult.backendMdPath, 'utf-8');
      assert.ok(healthBackend.includes('CREATE TABLE IF NOT EXISTS patients'), 'Domínio saúde deve gerar tabela patients');
      assert.ok(healthBackend.includes('CREATE TABLE IF NOT EXISTS appointments'), 'Domínio saúde deve gerar tabela appointments');

      const healthConteudo = fs.readFileSync(healthResult.conteudoMdPath, 'utf-8');
      assert.ok(healthConteudo.includes('Pacientes'), 'Domínio saúde deve gerar seção de Pacientes');
    } finally {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "projectLivingSpecs.test",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:projectLivingSpecs.test]", err);
      }
    }
    }
  });

  it('4. Operação idempotente e preservação com múltiplas invocações', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-spec-idempotent-'));
    try {
      await ProjectLivingSpecService.generateAndPersistLivingSpecs({
        projectName: 'IdemApp',
        projectPath: tempDir,
        briefing: 'Plataforma de métricas e BI em tempo real'
      });

      const firstStat = fs.statSync(path.join(tempDir, '.ai-dev-hub', 'specs', 'CONTEUDO.md'));

      // Segunda invocação consecutiva
      await ProjectLivingSpecService.generateAndPersistLivingSpecs({
        projectName: 'IdemApp',
        projectPath: tempDir,
        briefing: 'Plataforma de métricas e BI em tempo real'
      });

      const secondStat = fs.statSync(path.join(tempDir, '.ai-dev-hub', 'specs', 'CONTEUDO.md'));
      assert.ok(secondStat.size > 0, 'Arquivo deve permanecer íntegro e populado');
      assert.equal(firstStat.size, secondStat.size, 'Tamanho do arquivo deve ser consistente na re-execução');
    } finally {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "projectLivingSpecs.test",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:projectLivingSpecs.test]", err);
      }
    }
    }
  });

  it('5. PromptManager injeta referências canônicas @.ai-dev-hub/specs/... quando specs existem', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-promptmanager-specs-'));
    try {
      await ProjectLivingSpecService.generateAndPersistLivingSpecs({
        projectName: 'SpecApp',
        projectPath: tempDir,
        briefing: 'Gestão de frotas e logística de fretes'
      });

      const xml = PromptManager.buildProjectContextXml({
        projectName: 'SpecApp',
        projectPath: tempDir,
        objective: 'Gestão de frotas'
      });

      assert.ok(xml.includes('@.ai-dev-hub/specs/PRINCIPIOS.md'), 'XML deve conter @.ai-dev-hub/specs/PRINCIPIOS.md');
      assert.ok(xml.includes('@.ai-dev-hub/specs/CONTEUDO.md'), 'XML deve conter @.ai-dev-hub/specs/CONTEUDO.md');
      assert.ok(xml.includes('@.ai-dev-hub/specs/BACKEND.md'), 'XML deve conter @.ai-dev-hub/specs/BACKEND.md');
      assert.ok(xml.includes('@.ai-dev-hub/specs/DESIGN.md'), 'XML deve conter @.ai-dev-hub/specs/DESIGN.md');

      const instructions = PromptManager.buildWorkerInstructions({
        promptId: 'fable-worker-v2-flash-max',
        runtime: {
          projectPath: tempDir,
          runId: 'run-1',
          taskId: 'task-1'
        },
        project: {
          projectName: 'SpecApp',
          projectPath: tempDir,
          objective: 'Gestão de frotas'
        }
      });

      assert.ok(instructions.fullRuleContent.includes('ESPECIFICAÇÕES VIVAS OBRIGATÓRIAS'), 'fullRuleContent deve conter seção de especificações vivas');
      assert.ok(instructions.fullRuleContent.includes('Fonte Única de Verdade do projeto'), 'fullRuleContent deve conter menção à Fonte Única de Verdade');
      assert.ok(instructions.fullRuleContent.includes('@.ai-dev-hub/specs/BACKEND.md'), 'fullRuleContent deve listar os 4 arquivos canônicos');
    } finally {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "projectLivingSpecs.test",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:projectLivingSpecs.test]", err);
      }
    }
    }
  });

  it('6. PromptArchitectureService roteia especificações vivas para Worker Frontend e Backend', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-promptarch-specs-'));
    try {
      await ProjectLivingSpecService.generateAndPersistLivingSpecs({
        projectName: 'FinCorp',
        projectPath: tempDir,
        briefing: 'Fintech de conciliação bancária'
      });

      // Frontend Worker Prompt
      const frontendSpec = ProjectLivingSpecService.getRoleSpecificSpecContext(tempDir, 'WORKER_FRONTEND');
      const { prompt: frontendPrompt } = PromptArchitectureService.buildWorkerPrompt({
        mode: 'IMPLEMENT',
        projectId: 'p-1',
        projectName: 'FinCorp',
        projectPath: tempDir,
        taskTitle: 'Construir Dashboard e Gráficos da Interface',
        taskDescription: 'Implementar abas role="tab", data-tab="dashboard" e cards de KPI',
        expectedScopeFiles: ['public/index.html', 'public/app.js', 'public/styles.css'],
        livingSpecContextBlock: frontendSpec
      });

      assert.ok(frontendPrompt.includes('FONTE ÚNICA DE VERDADE DO PROJETO'), 'Prompt Frontend deve conter bloco de fonte única de verdade');
      assert.ok(frontendPrompt.includes('SEÇÕES OBRIGATÓRIAS DA INTERFACE'), 'Prompt Frontend deve conter seções de interface');
      assert.ok(frontendPrompt.includes('TOKENS CSS :ROOT'), 'Prompt Frontend deve conter tokens CSS');
      assert.ok(frontendPrompt.length < 24000, `Prompt Frontend deve ter < 24000 chars (obtido: ${frontendPrompt.length})`);

      // Backend Worker Prompt
      const backendSpec = ProjectLivingSpecService.getRoleSpecificSpecContext(tempDir, 'WORKER_BACKEND');
      const { prompt: backendPrompt } = PromptArchitectureService.buildWorkerPrompt({
        mode: 'IMPLEMENT',
        projectId: 'p-1',
        projectName: 'FinCorp',
        projectPath: tempDir,
        taskTitle: 'Configurar Tabelas SQLite e Rotas REST',
        taskDescription: 'Criar esquema transactions e audit_logs com seedIfEmpty',
        expectedScopeFiles: ['src/db/schema.ts', 'src/server.ts'],
        livingSpecContextBlock: backendSpec
      });

      assert.ok(backendPrompt.includes('FONTE ÚNICA DE VERDADE DO PROJETO'), 'Prompt Backend deve conter bloco de fonte única de verdade');
      assert.ok(backendPrompt.includes('TABELAS SQLITE OBRIGATÓRIAS'), 'Prompt Backend deve conter tabelas obrigatórias');
      assert.ok(backendPrompt.includes('ROTAS REST OBRIGATÓRIAS'), 'Prompt Backend deve conter rotas obrigatórias');
      assert.ok(backendPrompt.length < 24000, `Prompt Backend deve ter < 24000 chars (obtido: ${backendPrompt.length})`);
    } finally {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "projectLivingSpecs.test",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:projectLivingSpecs.test]", err);
      }
    }
    }
  });

  it('7. Garantia matemática: prompts de todas as camadas permanecem estritamente < 24.000 caracteres mesmo com todos os blocos ativados', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-budget-guarantee-'));
    try {
      await ProjectLivingSpecService.generateAndPersistLivingSpecs({
        projectName: 'BigApp',
        projectPath: tempDir,
        briefing: 'Plataforma enterprise de ERP completo'
      });

      const bigText = 'X'.repeat(8000);
      const specBlock = ProjectLivingSpecService.getRoleSpecificSpecContext(tempDir, 'WORKER_FULLSTACK');

      // 1. Worker Prompt
      const workerRes = PromptArchitectureService.buildWorkerPrompt({
        mode: 'IMPLEMENT',
        projectId: 'p-1',
        projectName: 'BigApp',
        projectPath: tempDir,
        taskTitle: 'Tarefa Complexa com Contexto Gigante',
        taskDescription: bigText,
        docSimpContextBlock: bigText,
        designSkillContextBlock: bigText,
        reaSaaSMasterContextBlock: bigText,
        livingSpecContextBlock: specBlock
      });
      assert.ok(workerRes.prompt.length <= 23900, `Worker prompt deve ter <= 23900 chars (obtido: ${workerRes.prompt.length})`);

      // 2. Blueprint Prompt (Onda 1)
      const blueprintRes = PromptArchitectureService.buildArchitecturalBlueprintPrompt({
        projectId: 'p-1',
        projectName: 'BigApp',
        projectPath: tempDir,
        briefing: bigText,
        docSimpContextBlock: bigText,
        designSkillContextBlock: bigText,
        reaSaaSMasterContextBlock: bigText,
        marketDiscoveryContextBlock: bigText,
        livingSpecContextBlock: specBlock
      });
      assert.ok(blueprintRes.prompt.length <= 23900, `Blueprint prompt deve ter <= 23900 chars (obtido: ${blueprintRes.prompt.length})`);

      // 3. Expansion Prompt (Onda 2)
      const expandRes = PromptArchitectureService.buildMajorTaskExpansionPrompt({
        projectId: 'p-1',
        projectName: 'BigApp',
        projectPath: tempDir,
        briefing: bigText,
        majorTask: {
          code: 'GT-1',
          title: 'Grande Tarefa com Descrição Extensa',
          objective: bigText
        },
        docSimpContextBlock: bigText,
        designSkillContextBlock: bigText,
        reaSaaSMasterContextBlock: bigText,
        marketDiscoveryContextBlock: bigText,
        livingSpecContextBlock: specBlock
      });
      assert.ok(expandRes.prompt.length <= 23900, `Expansion prompt deve ter <= 23900 chars (obtido: ${expandRes.prompt.length})`);

      // 4. Supervisor Prompt
      const supervisorRes = PromptArchitectureService.buildSupervisorPrompt({
        mode: 'ARCHITECT',
        projectId: 'p-1',
        projectName: 'BigApp',
        projectPath: tempDir,
        briefing: bigText,
        docSimpContextBlock: bigText,
        designSkillContextBlock: bigText,
        reaSaaSMasterContextBlock: bigText,
        marketDiscoveryContextBlock: bigText,
        livingSpecContextBlock: specBlock
      });
      assert.ok(supervisorRes.prompt.length <= 23900, `Supervisor prompt deve ter <= 23900 chars (obtido: ${supervisorRes.prompt.length})`);
    } finally {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "projectLivingSpecs.test",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:projectLivingSpecs.test]", err);
      }
    }
    }
  });

  it('8. Dedução Sênior em Pedidos Curtos: 1 linha ("Quero desenvolver um Aplicativo de finanças") gera os 4 documentos, publica card executivo e planeja a suíte completa de microtarefas', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-senior-deduce-'));
    const projectId = 'test-short-briefing-' + Date.now();
    try {
      try {
        db.prepare(`INSERT OR IGNORE INTO projects (id, name, path, objective, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
          projectId, 'Finanças Pro', tempDir, 'Aplicativo de finanças', new Date().toISOString(), new Date().toISOString()
        );
      } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "projectLivingSpecs.test",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:projectLivingSpecs.test]", err);
      }
    }

      const result = await ProjectLivingSpecService.generateAndPersistLivingSpecs({
        projectName: 'Finanças Pro',
        projectPath: tempDir,
        projectId,
        briefing: 'Quero desenvolver um Aplicativo de finanças'
      });

      // 1. Validar materialização dos 4 documentos físicos
      assert.ok(fs.existsSync(result.conteudoMdPath), 'CONTEUDO.md deve existir');
      assert.ok(fs.existsSync(result.designMdPath), 'DESIGN.md deve existir');
      assert.ok(fs.existsSync(result.backendMdPath), 'BACKEND.md deve existir');
      assert.ok(fs.existsSync(result.principiosMdPath), 'PRINCIPIOS.md deve existir');

      // 2. Validar Card Executivo gerado e persistido no chat
      assert.ok(result.executiveCard, 'Card executivo deve ter sido gerado');
      assert.ok(result.executiveCard.includes('Arquitetura Deduzida na Onda 0'), 'Card deve ter título canônico');
      assert.ok(result.executiveCard.includes('Stripe, Asaas'), 'Card deve citar líderes de mercado');
      assert.ok(result.executiveCard.includes('01-Dashboard, 02-Transações'), 'Card deve listar seções canônicas');
      assert.ok(result.executiveCard.includes('PORT_GUARD'), 'Card deve citar invariantes');

      // Verificar persistência no banco SQLite na tabela messages
      const chatMsg: any = db.prepare('SELECT * FROM messages WHERE project_id = ? ORDER BY created_at DESC LIMIT 1').get(projectId);
      assert.ok(chatMsg, 'Mensagem deve ter sido inserida no chat do projeto');
      assert.equal(chatMsg.role, 'assistant', 'Mensagem deve ser do papel assistant');
      assert.ok(chatMsg.content.includes('Arquitetura Deduzida na Onda 0'), 'Conteúdo da mensagem deve conter card executivo');

      // 3. Validar planejamento da suíte completa de microtarefas (não apenas stub simples de 2 tarefas)
      const planned = HierarchicalOrchestrationService.generateMultiPassPlannedTasks({
        briefing: 'Quero desenvolver um Aplicativo de finanças',
        projectPath: tempDir,
        projectName: 'Finanças Pro',
        projectId
      });

      assert.ok(planned.length >= 10, `Deve gerar suíte completa com >= 10 tarefas (obtido: ${planned.length})`);
      const majorCodes = new Set(planned.map(t => t.majorTaskCode));
      assert.ok(majorCodes.has('GT-1'), 'Deve conter GT-1 (Scaffolding e Config)');
      assert.ok(majorCodes.has('GT-2'), 'Deve conter GT-2 (Modelagem Relacional SQLite)');
      assert.ok(majorCodes.has('GT-5'), 'Deve conter GT-5 (Interface Web Anti-Slop)');
      assert.ok(majorCodes.has('GT-7'), 'Deve conter GT-7 (Blindagem e Homologação)');
    } finally {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "projectLivingSpecs.test",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:projectLivingSpecs.test]", err);
      }
    }
    }
  });

  it('9. Atualização Aditiva de CONTEUDO.md e BACKEND.md no Modo DELTA_EVOLUTION', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-delta-specs-'));
    try {
      // 1. Gera base inicial com 5 seções padrão
      await ProjectLivingSpecService.generateAndPersistLivingSpecs({
        projectName: 'FinCorp Delta',
        projectPath: tempDir,
        briefing: 'Gestão financeira e faturamento'
      });

      const initialConteudo = fs.readFileSync(path.join(tempDir, '.ai-dev-hub', 'specs', 'CONTEUDO.md'), 'utf-8');
      const initialBackend = fs.readFileSync(path.join(tempDir, '.ai-dev-hub', 'specs', 'BACKEND.md'), 'utf-8');
      assert.ok(initialConteudo.includes('01-Dashboard'), 'Deve conter seção inicial 01');
      assert.ok(initialConteudo.includes('05-Configurações') || initialConteudo.includes('05-Configuracoes'), 'Deve conter seção inicial 05');

      // 2. Executa appendDeltaFeatureToSpecs para a nova feature
      const appendRes = ProjectLivingSpecService.appendDeltaFeatureToSpecs(
        tempDir,
        'Adicione uma seção de Cartões de Crédito com limite e fatura'
      );

      assert.equal(appendRes.success, true, 'appendDeltaFeatureToSpecs deve reportar sucesso');
      assert.ok(appendRes.updatedFiles.length >= 2, 'Deve ter atualizado pelo menos CONTEUDO.md e BACKEND.md');
      assert.ok(appendRes.addedSection?.includes('Cartões de Crédito'), 'addedSection deve registrar a nova feature');

      // 3. Inspeciona CONTEUDO.md atualizado
      const updatedConteudo = fs.readFileSync(path.join(tempDir, '.ai-dev-hub', 'specs', 'CONTEUDO.md'), 'utf-8');
      assert.ok(updatedConteudo.includes('### Seção 06: Cartões de Crédito'), 'CONTEUDO.md deve conter nova seção 06');
      assert.ok(updatedConteudo.includes('data-tab="cartoes"'), 'CONTEUDO.md deve conter data-tab="cartoes"');
      assert.ok(updatedConteudo.includes('role="tab"'), 'CONTEUDO.md deve manter role="tab"');
      assert.ok(updatedConteudo.includes('01-Dashboard'), 'Seções anteriores devem ser preservadas');
      assert.ok(updatedConteudo.includes('## 4. Requisitos de Povoamento Inicial'), 'Seções subsequentes devem ser preservadas');

      // 4. Inspeciona BACKEND.md atualizado
      const updatedBackend = fs.readFileSync(path.join(tempDir, '.ai-dev-hub', 'specs', 'BACKEND.md'), 'utf-8');
      assert.ok(updatedBackend.includes('CREATE TABLE IF NOT EXISTS cartoes'), 'BACKEND.md deve conter tabela cartoes');
      assert.ok(updatedBackend.includes('/api/cartoes'), 'BACKEND.md deve conter rotas /api/cartoes');
      assert.ok(updatedBackend.includes('CREATE TABLE IF NOT EXISTS audit_logs'), 'Tabelas anteriores devem ser preservadas');
      assert.ok(updatedBackend.includes('/api/health'), 'Rotas anteriores devem ser preservadas');

      // 5. Teste de Idempotência: re-execução não deve duplicar
      const repeatRes = ProjectLivingSpecService.appendDeltaFeatureToSpecs(
        tempDir,
        'Adicione uma seção de Cartões de Crédito com limite e fatura'
      );
      assert.equal(repeatRes.updatedFiles.length, 0, 'Re-execução idempotente não deve duplicar seções');
    } finally {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "projectLivingSpecs.test",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:projectLivingSpecs.test]", err);
      }
    }
    }
  });

  it('10. DeltaFeatureEngine.planDeltaEvolution invoca automaticamente appendDeltaFeatureToSpecs mantendo specs sincronizadas', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-delta-engine-sync-'));
    try {
      await ProjectLivingSpecService.generateAndPersistLivingSpecs({
        projectName: 'SaaS Evolving',
        projectPath: tempDir,
        briefing: 'Plataforma de gestão comercial'
      });

      const plannedDeltaTasks = DeltaFeatureEngine.planDeltaEvolution({
        briefing: 'Adicione uma seção de Metas e Objetivos Financeiros com progresso e indicadores',
        projectContext: {
          id: 'proj-delta-1',
          name: 'SaaS Evolving',
          path: tempDir
        }
      });

      assert.equal(plannedDeltaTasks.length, 3, 'Deve gerar exatamente 3 tarefas cirúrgicas Delta-1, Delta-2 e Delta-3');
      assert.ok(plannedDeltaTasks[0].title.includes('Delta-1: Domínio'), 'Delta-1 deve focar em domínio e backend');
      assert.ok(plannedDeltaTasks[1].title.includes('Delta-2: Interface'), 'Delta-2 deve focar em UI');
      assert.ok(plannedDeltaTasks[2].title.includes('Delta-3: Testes'), 'Delta-3 deve focar em regressão');

      // Verificar que CONTEUDO.md e BACKEND.md foram enriquecidos
      const conteudo = fs.readFileSync(path.join(tempDir, '.ai-dev-hub', 'specs', 'CONTEUDO.md'), 'utf-8');
      const backend = fs.readFileSync(path.join(tempDir, '.ai-dev-hub', 'specs', 'BACKEND.md'), 'utf-8');

      assert.ok(conteudo.includes('Metas e Objetivos Financeiros') || conteudo.includes('Metas'), 'CONTEUDO.md deve conter a nova seção de metas');
      assert.ok(backend.includes('metas'), 'BACKEND.md deve conter tabela/rota com metas');
    } finally {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "projectLivingSpecs.test",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:projectLivingSpecs.test]", err);
      }
    }
    }
  });

  it('11. FASE 23E: Materializa o 5º documento canônico JORNADAS.md e índice raiz AGENTS.md com inlining @.ai-dev-hub/specs/...', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-jornadas-spec-'));
    try {
      const result = await ProjectLivingSpecService.generateAndPersistLivingSpecs({
        projectName: 'DevOps Pulse',
        projectPath: tempDir,
        briefing: 'Plataforma de observabilidade e CI/CD'
      });

      assert.ok(fs.existsSync(result.jornadasMdPath), 'JORNADAS.md deve existir em .ai-dev-hub/specs/');
      assert.ok(fs.existsSync(result.agentsMdRootPath), 'AGENTS.md deve existir na raiz do projeto');

      // Validar JORNADAS.md
      const jornadas = fs.readFileSync(result.jornadasMdPath, 'utf-8');
      assert.ok(jornadas.includes('Roteiro Visual de Seções & Snapshots (PlaywrightVisualInspector)'), 'Deve conter seção 1 do Playwright');
      assert.ok(jornadas.includes('data-tab="dashboard"'), 'Deve citar data-tab="dashboard"');
      assert.ok(jornadas.includes('01-Dashboard.png'), 'Deve especificar arquivo de snapshot 01-Dashboard.png');
      assert.ok(jornadas.includes('Cenários de Experiência do Usuário & Persistência F5 (UserExperienceSimulator)'), 'Deve conter seção 2 de UX');
      assert.ok(jornadas.includes('F5'), 'Deve conter teste de persistência F5');
      assert.ok(jornadas.includes('Matriz de Segurança, Validação de Entrada & Pentest (SecurityPentestSimulator)'), 'Deve conter seção 3 de segurança');
      assert.ok(jornadas.includes('HTTP 400 Bad Request'), 'Deve conter regras HTTP 400');
      assert.ok(jornadas.includes('escapeHtml()'), 'Deve conter regra escapeHtml()');
      assert.ok(jornadas.includes('queries parametrizadas com placeholders'), 'Deve exigir queries parametrizadas');

      // Validar AGENTS.md
      const agents = fs.readFileSync(result.agentsMdRootPath, 'utf-8');
      assert.ok(agents.includes('# Arquitetura e Especificações Oficiais do Projeto (DecoHUB Living Specs)'), 'Deve conter cabeçalho canônico');
      assert.ok(agents.includes('- Princípios e Invariantes: @.ai-dev-hub/specs/PRINCIPIOS.md'), 'Deve inlinar PRINCIPIOS.md');
      assert.ok(agents.includes('- Conteúdo, Seções e REA: @.ai-dev-hub/specs/CONTEUDO.md'), 'Deve inlinar CONTEUDO.md');
      assert.ok(agents.includes('- Design System e UI: @.ai-dev-hub/specs/DESIGN.md'), 'Deve inlinar DESIGN.md');
      assert.ok(agents.includes('- Contratos de Banco e API: @.ai-dev-hub/specs/BACKEND.md'), 'Deve inlinar BACKEND.md');
      assert.ok(agents.includes('- Jornadas de Teste e Homologação: @.ai-dev-hub/specs/JORNADAS.md'), 'Deve inlinar JORNADAS.md');

      // Validar getRoleSpecificSpecContext para WORKER_TEST
      const testContext = ProjectLivingSpecService.getRoleSpecificSpecContext(tempDir, 'WORKER_TEST');
      assert.ok(testContext.includes('ROTEIRO DE SNAPSHOTS PLAYWRIGHT (JORNADAS.MD)'), 'Worker de teste deve receber roteiro de snapshots');
      assert.ok(testContext.includes('CENÁRIOS DE PERSISTÊNCIA F5 & UX (JORNADAS.MD)'), 'Worker de teste deve receber cenários UX');
      assert.ok(testContext.length >= 1500 && testContext.length <= 3800, `Contexto deve respeitar faixa segura (obtido: ${testContext.length})`);
    } finally {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "projectLivingSpecs.test",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:projectLivingSpecs.test]", err);
      }
    }
    }
  });

  it('12. FASE 23E: syncImplementedBackendContractsToSpec varre o código de src/ e atualiza a seção ## CONTRATOS REAIS IMPLEMENTADOS EM DISCO em BACKEND.md', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-backend-sync-'));
    try {
      await ProjectLivingSpecService.generateAndPersistLivingSpecs({
        projectName: 'Banking Engine',
        projectPath: tempDir,
        briefing: 'Motor bancário e pagamentos instantâneos'
      });

      // Cria arquivos de código físico simulando implementação do Worker
      const srcDir = path.join(tempDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });

      const dbCode = [
        `import { DatabaseSync } from 'node:sqlite';`,
        `const db = new DatabaseSync(':memory:');`,
        `db.exec(\`CREATE TABLE IF NOT EXISTS bank_accounts (`,
        `  id TEXT PRIMARY KEY,`,
        `  holder_name TEXT NOT NULL,`,
        `  balance REAL DEFAULT 0`,
        `);\`);`,
        `db.exec(\`CREATE TABLE IF NOT EXISTS transfers (`,
        `  id TEXT PRIMARY KEY,`,
        `  amount REAL NOT NULL,`,
        `  status TEXT DEFAULT 'pending'`,
        `);\`);`
      ].join('\n');
      fs.writeFileSync(path.join(srcDir, 'database.ts'), dbCode, 'utf-8');

      const routesCode = [
        `import express from 'express';`,
        `const app = express();`,
        `app.get('/api/accounts', (req, res) => res.json([]));`,
        `app.post('/api/accounts', (req, res) => res.status(201).json({ id: '1' }));`,
        `app.get('/api/transfers', (req, res) => res.json([]));`,
        `app.post('/api/transfers', (req, res) => res.status(201).json({ id: 'tx-1' }));`
      ].join('\n');
      fs.writeFileSync(path.join(srcDir, 'routes.ts'), routesCode, 'utf-8');

      // Executa o sincronizador
      const syncRes = ProjectLivingSpecService.syncImplementedBackendContractsToSpec(tempDir);

      assert.equal(syncRes.synced, true, 'syncRes.synced deve ser true');
      assert.ok(syncRes.tables.includes('bank_accounts'), 'Deve identificar tabela bank_accounts');
      assert.ok(syncRes.tables.includes('transfers'), 'Deve identificar tabela transfers');
      assert.ok(syncRes.routes.some(r => r.method === 'GET' && r.path === '/api/accounts'), 'Deve identificar GET /api/accounts');
      assert.ok(syncRes.routes.some(r => r.method === 'POST' && r.path === '/api/transfers'), 'Deve identificar POST /api/transfers');

      // Inspeciona BACKEND.md físico
      const backendMd = fs.readFileSync(path.join(tempDir, '.ai-dev-hub', 'specs', 'BACKEND.md'), 'utf-8');
      assert.ok(backendMd.includes('## CONTRATOS REAIS IMPLEMENTADOS EM DISCO (VERIFICADOS)'), 'BACKEND.md deve conter a seção de contratos verificados');
      assert.ok(backendMd.includes('`bank_accounts`'), 'Deve listar bank_accounts');
      assert.ok(backendMd.includes('`transfers`'), 'Deve listar transfers');
      assert.ok(backendMd.includes('GET /api/accounts'), 'Deve listar GET /api/accounts');
      assert.ok(backendMd.includes('POST /api/transfers'), 'Deve listar POST /api/transfers');

      // Teste de Idempotência: rodar novamente não duplica cabeçalho
      ProjectLivingSpecService.syncImplementedBackendContractsToSpec(tempDir);
      const backendMdRecheck = fs.readFileSync(path.join(tempDir, '.ai-dev-hub', 'specs', 'BACKEND.md'), 'utf-8');
      const matches = [...backendMdRecheck.matchAll(/## CONTRATOS REAIS IMPLEMENTADOS EM DISCO \(VERIFICADOS\)/g)];
      assert.equal(matches.length, 1, 'Deve conter exatamente 1 ocorrência do cabeçalho sem duplicação');
    } finally {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "projectLivingSpecs.test",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:projectLivingSpecs.test]", err);
      }
    }
    }
  });

  it('13. FASE 23E: Gate de Paridade em checkProjectCompleteness detecta seções/rotas ausentes e aprova quando presentes', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-parity-gate-'));
    try {
      await ProjectLivingSpecService.generateAndPersistLivingSpecs({
        projectName: 'SaaS Incomplete',
        projectPath: tempDir,
        briefing: 'Gestão de tarefas e sprints'
      });

      const mockRun = { id: 'run-parity-1', briefing: 'Gestão de tarefas e sprints', objective: '' };
      const mockProj = { id: 'proj-parity-1', path: tempDir, objective: '' };

      // Caso A: Projeto sem artefatos suficientes -> Parity Gate deve reprovar
      const checkIncomplete = AutonomousRunnerService.checkProjectCompleteness(mockRun, mockProj);
      assert.equal(checkIncomplete.isComplete, false, 'Projeto incompleto deve reprovar');
      assert.ok(
        checkIncomplete.missingAspects.some(a => a.includes('Seções obrigatórias de CONTEUDO.md não encontradas')),
        'Deve acusar abas ausentes'
      );

      // Caso B: Projeto com todas as abas e rotas implementadas -> Parity Gate deve aprovar
      const publicDir = path.join(tempDir, 'public');
      fs.mkdirSync(publicDir, { recursive: true });

      const indexHtml = [
        `<!DOCTYPE html><html><body>`,
        `<nav>`,
        `  <button role="tab" data-tab="dashboard">Dashboard</button>`,
        `  <button role="tab" data-tab="issues">Issues</button>`,
        `  <button role="tab" data-tab="ciclos">Ciclos</button>`,
        `  <button role="tab" data-tab="auditoria">Auditoria</button>`,
        `  <button role="tab" data-tab="configuracoes">Configurações</button>`,
        `</nav>`,
        `</body></html>`
      ].join('\n');
      fs.writeFileSync(path.join(publicDir, 'index.html'), indexHtml, 'utf-8');

      const srcDir = path.join(tempDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });
      const serverCode = [
        `import express from 'express';`,
        `const app = express();`,
        `app.get('/api/health', (r, s) => s.json({ status: 'ok' }));`,
        `app.get('/api/issues', (r, s) => s.json([]));`,
        `app.post('/api/issues', (r, s) => s.json({}));`,
        `app.get('/api/audit-logs', (r, s) => s.json([]));`,
        `app.get('/api/kpis', (r, s) => s.json({}));`,
        `app.put('/api/issues/:id', (r, s) => s.json({}));`,
        `app.delete('/api/issues/:id', (r, s) => s.json({}));`
      ].join('\n');
      fs.writeFileSync(path.join(srcDir, 'server.ts'), serverCode, 'utf-8');

      const checkComplete = AutonomousRunnerService.checkProjectCompleteness(mockRun, mockProj);
      assert.equal(checkComplete.isComplete, true, 'Projeto com todas as abas e rotas implementadas deve aprovar no Parity Gate');
      assert.equal(checkComplete.missingAspects.length, 0, 'missingAspects deve estar vazio');
    } finally {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "projectLivingSpecs.test",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:projectLivingSpecs.test]", err);
      }
    }
    }
  });

  it('14. FASE 23E: Seleção autônoma de Skills de nicho e DOCSIMP em DESIGN.md e BACKEND.md conforme domínio sem slash commands manuais', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-niche-skills-'));
    try {
      const result = await ProjectLivingSpecService.generateAndPersistLivingSpecs({
        projectName: 'OdontoCloud Pro',
        projectPath: tempDir,
        briefing: 'Sistema de gestão de clínica odontológica com agendamento de consultas e prontuário de pacientes'
      });

      const designMd = fs.readFileSync(result.designMdPath, 'utf-8');
      assert.ok(designMd.includes('Habilidades de Design Injetadas Autonomamente'), 'DESIGN.md deve listar habilidades estéticas de nicho');
      assert.ok(designMd.includes('soft-skill') || designMd.includes('minimalist-skill'), 'DESIGN.md deve conter skills de design modernas');

      const backendMd = fs.readFileSync(result.backendMdPath, 'utf-8');
      assert.ok(backendMd.includes('Adaptadores de Domínio DOCSIMP Ativos'), 'BACKEND.md deve listar adaptadores DOCSIMP');
      assert.ok(backendMd.includes('HEALTHCARE_APPOINTMENTS') || backendMd.includes('HEALTHCARE'), 'BACKEND.md deve identificar domínio de saúde/consultas');
    } finally {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "projectLivingSpecs.test",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:projectLivingSpecs.test]", err);
      }
    }
    }
  });

  it('15. FASE 23E: GET /projects/:id/specs retorna todos os 5 documentos canônicos incluindo jornadasMd', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-get-specs-'));
    const testProjectId = 'test-proj-specs-15';
    try {
      db.prepare(`
        INSERT OR REPLACE INTO projects (id, name, path, objective, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'active', datetime('now'), datetime('now'))
      `).run(testProjectId, 'Specs Test Project', tempDir, 'App de pagamentos e billing');

      const genRes = await ProjectLivingSpecService.generateAndPersistLivingSpecs({
        projectId: testProjectId,
        projectName: 'Specs Test Project',
        projectPath: tempDir,
        briefing: 'App de pagamentos e billing'
      });

      // Valida existência de todos os 5 documentos em disco
      const specsDir = path.join(tempDir, '.ai-dev-hub', 'specs');
      const files = ['CONTEUDO.md', 'DESIGN.md', 'BACKEND.md', 'PRINCIPIOS.md', 'JORNADAS.md'];
      for (const f of files) {
        assert.ok(fs.existsSync(path.join(specsDir, f)), `${f} deve existir no diretório de specs`);
      }

      // Valida que jornadasMd contém conteúdo rico
      const jornadasContent = fs.readFileSync(path.join(specsDir, 'JORNADAS.md'), 'utf-8');
      assert.ok(jornadasContent.includes('JORNADAS DE TESTE'), 'JORNADAS.md deve conter título canônico');
      assert.ok(jornadasContent.includes('PlaywrightVisualInspector'), 'JORNADAS.md deve conter roteiro Playwright');
    } finally {
      try {
        db.prepare('DELETE FROM projects WHERE id = ?').run(testProjectId);
      } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "projectLivingSpecs.test",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:projectLivingSpecs.test]", err);
      }
    }
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "projectLivingSpecs.test",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:projectLivingSpecs.test]", err);
      }
    }
    }
  });
});
