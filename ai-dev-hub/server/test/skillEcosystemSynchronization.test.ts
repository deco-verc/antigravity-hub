// server/test/skillEcosystemSynchronization.test.ts
// Suíte de Testes Automatizados da FASE 20: Sincronização Total do Ecossistema de Skills
// Validação de G-01 a G-05, Proteção de Orçamento (< 24k chars) e Sincronia Supervisor <-> Worker

import test, { describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { db } from '../src/db.js';
import { SkillRouter } from '../src/skillRouter.js';
import { GeminiSupervisorProvider } from '../src/geminiSupervisorProvider.js';
import { PromptArchitectureService } from '../src/promptArchitectureService.js';

describe('FASE 20: Sincronização Total do Ecossistema de Skills (DecoHUB)', () => {
  let testProjectDir: string;
  let testProjectId: string;

  beforeEach(() => {
    testProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-skill-sync-test-'));
    testProjectId = 'sync-proj-' + crypto.randomUUID().slice(0, 8);

    fs.mkdirSync(path.join(testProjectDir, 'public'), { recursive: true });
    fs.mkdirSync(path.join(testProjectDir, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(testProjectDir, 'package.json'),
      JSON.stringify({ name: 'skill-sync-test', version: '1.0.0' }, null, 2),
      'utf-8'
    );

    try {
      db.prepare(`
        INSERT INTO projects (id, name, path, status, created_at, updated_at)
        VALUES (?, ?, ?, 'active', ?, ?)
      `).run(testProjectId, 'Skill Sync Test Project', testProjectDir, new Date().toISOString(), new Date().toISOString());
    } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "skillEcosystemSynchronization.test",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:skillEcosystemSynchronization.test]", err);
      }
    }

    SkillRouter.clearPhysicalSkillsCache();
  });

  afterEach(() => {
    try {
      db.prepare('DELETE FROM autonomous_tasks WHERE run_id IN (SELECT id FROM autonomous_runs WHERE project_id = ?)').run(testProjectId);
      db.prepare('DELETE FROM autonomous_runs WHERE project_id = ?').run(testProjectId);
      db.prepare('DELETE FROM projects WHERE id = ?').run(testProjectId);
    } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "skillEcosystemSynchronization.test",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:skillEcosystemSynchronization.test]", err);
      }
    }

    try {
      fs.rmSync(testProjectDir, { recursive: true, force: true });
    } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "skillEcosystemSynchronization.test",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:skillEcosystemSynchronization.test]", err);
      }
    }

    SkillRouter.clearPhysicalSkillsCache();
  });

  test('1. [G-01 & G-05] SkillRouter resolve arquivos físicos em disco, copia sob demanda para .ai-dev-hub/skills/ e injeta digest cirúrgico', () => {
    const task = {
      title: 'Construir Dashboard SaaS com Abas, Command Palette Ctrl+K e Gráficos BI SVG',
      description: 'Implementar App Shell enterprise com data-grid e contadores reativos',
      criteria: [
        'Adicionar navegação com role="tab" e data-tab',
        'Implementar gráficos SVG com tabular-nums',
        'Garantir persistência pós-F5'
      ],
      expectedScopeFiles: ['public/index.html', 'public/app.js', 'public/style.css']
    };

    const routed = SkillRouter.routeTask(task, { projectPath: testProjectDir });

    assert.equal(routed.skill, 'FRONTEND_SPECIALIST', 'Deve classificar como FRONTEND_SPECIALIST');
    assert.ok(routed.physicalSkills && routed.physicalSkills.length > 0, 'Deve resolver arquivos físicos da skill');

    // Verifica se os arquivos foram copiados sob demanda para .ai-dev-hub/skills/
    const targetSkillsDir = path.join(testProjectDir, '.ai-dev-hub', 'skills');
    assert.ok(fs.existsSync(targetSkillsDir), 'Diretório .ai-dev-hub/skills/ deve ser criado automaticamente no projeto');
    const copiedFiles = fs.readdirSync(targetSkillsDir);
    assert.ok(copiedFiles.length > 0, 'Deve ter copiado pelo menos 1 arquivo físico de skill');

    // Verifica diretiva e digest cirúrgico injetados
    assert.ok(routed.formattingSnippet.includes('ARQUIVOS DE SKILL PROVISIONADOS PARA ESTA TAREFA: .ai-dev-hub/skills/'));
    assert.ok(routed.formattingSnippet.includes('RECEITA CIRÚRGICA CONDENSADA (REGRAS DE OURO):'));
    assert.ok(routed.surgicalDigest && routed.surgicalDigest.length >= 40 && routed.surgicalDigest.length <= 700,
      `Digest cirúrgico deve ter tamanho adequado (atual: ${routed.surgicalDigest?.length} chars)`);

    // Invariantes prioritárias e guidelines devem conter a diretiva e a receita
    assert.ok(routed.priorityInvariants.some(inv => inv.includes('ARQUIVOS DE SKILL PROVISIONADOS')));
    assert.ok(routed.guidelines?.some(g => g.includes('RECEITA CIRÚRGICA FÍSICA')));
  });

  test('2. [G-02] Filtragem contextual de blocos na Onda 2: tarefas de banco/backend omitem CSS e tarefas de UI recebem 100%', () => {
    const preResolvedBlocks = {
      docSimpContextBlock: '=== DOCSIMP ADAPTERS ===\n- SQLite Database Adapter\n- Node 22 Mock Fallback',
      designSkillContextBlock: '=== DESIGN TOKENS CSS :ROOT ===\n--bg: #09090b;\n--surface: #18181b;\nAnti-Slop Visual Checklist: zero emojis, tabular-nums',
      reaSaaSMasterContextBlock: '=== SAAS MASTER 7 PILARES ===\nPilar 1: App Shell Ctrl+K\n\nPilar 5: Audit Trail & Logs\nTabela audit_logs obrigatória\n\nPilar 7: Seed & Persistência Idempotente\nseedIfEmpty com 15-30 registros'
    };

    // Cenário A: Grande Tarefa de Banco de Dados / SQLite (GT-2)
    const dbMajorTask = {
      code: 'GT-2',
      title: 'Modelagem de Dados SQLite, Persistência e Smart Demo Seeding',
      objective: 'Criar tabelas relacionais parametrizadas, tabela audit_logs e rotina seedIfEmpty'
    };

    const filteredDb = GeminiSupervisorProvider.filterSkillBlocksForMajorTask(dbMajorTask, preResolvedBlocks);
    assert.equal(filteredDb.designSkillContextBlock, '', 'Grande Tarefa de Banco NÃO deve receber designSkillContextBlock (zero poluição de CSS/tokens)');
    assert.ok(filteredDb.docSimpContextBlock.includes('SQLite Database Adapter'), 'Deve preservar docSimpContextBlock');
    assert.ok(!filteredDb.reaSaaSMasterContextBlock.includes('Pilar 1: App Shell Ctrl+K'), 'Não deve poluir banco com App Shell visual');
    assert.ok(filteredDb.reaSaaSMasterContextBlock.includes('audit_logs') || filteredDb.reaSaaSMasterContextBlock.includes('seedIfEmpty'),
      'Deve preservar os pilares de backend/seed/audit');

    // Cenário B: Grande Tarefa de Interface / Frontend (GT-5)
    const uiMajorTask = {
      code: 'GT-5',
      title: 'Interface Web SaaS Master com BI Gráficos, App Shell e Drawers',
      objective: 'Implementar interface completa com tokens :root, abas e navegação semântica'
    };

    const filteredUi = GeminiSupervisorProvider.filterSkillBlocksForMajorTask(uiMajorTask, preResolvedBlocks);
    assert.equal(filteredUi.designSkillContextBlock, preResolvedBlocks.designSkillContextBlock, 'Grande Tarefa de UI DEVE receber 100% de designSkillContextBlock');
    assert.equal(filteredUi.reaSaaSMasterContextBlock, preResolvedBlocks.reaSaaSMasterContextBlock, 'Grande Tarefa de UI DEVE receber 100% do SaaS Master');
  });

  test('3. [G-03] Antecipação do SkillRouter: microtarefas planejadas já saem com skillRouted e skillGuidelines pré-classificados', () => {
    const rawTasks = [
      {
        title: 'Criar tabelas SQLite parametrizadas e rotina seedIfEmpty',
        description: 'Tabela audit_logs e índices em chaves estrangeiras',
        criteria: ['Queries parametrizadas com ?', 'seedIfEmpty idempotente']
      },
      {
        title: 'Construir Dashboard com Abas data-tab e Gráficos SVG',
        description: 'Componentes de alta fidelidade visual com tokens :root',
        criteria: ['Role tab semântico', 'Ícones SVG inline']
      },
      {
        title: 'Criar endpoints HTTP REST e rotas /api/health',
        description: 'Servir SPA em GET / e JSON em /api/health com PORT_GUARD',
        criteria: ['Headers nosniff', 'Status HTTP 200/400']
      }
    ];

    const plannedTasks = GeminiSupervisorProvider.validateAndRefinePlanQuality(rawTasks as any);

    assert.equal(plannedTasks.length, 3);
    assert.equal(plannedTasks[0].skillRouted, 'DATABASE_ARCHITECT');
    assert.equal(plannedTasks[0].skillConfidence, 1.0);
    assert.ok(plannedTasks[0].skillGuidelines && plannedTasks[0].skillGuidelines.length > 0);

    assert.equal(plannedTasks[1].skillRouted, 'FRONTEND_SPECIALIST');
    assert.equal(plannedTasks[1].skillConfidence, 1.0);
    assert.ok(plannedTasks[1].skillGuidelines && plannedTasks[1].skillGuidelines.length > 0);

    assert.equal(plannedTasks[2].skillRouted, 'BACKEND_API');
    assert.equal(plannedTasks[2].skillConfidence, 1.0);
    assert.ok(plannedTasks[2].skillGuidelines && plannedTasks[2].skillGuidelines.length > 0);
  });

  test('4. [G-04] Cobrança de diretrizes no TASK_REVIEW: prompt do Supervisor exige conformidade com a skill alocada', () => {
    const { prompt } = PromptArchitectureService.buildSupervisorPrompt({
      mode: 'TASK_REVIEW',
      projectId: testProjectId,
      projectName: 'Test Sync App',
      projectPath: testProjectDir,
      projectObjective: 'SaaS Financeiro',
      task: {
        id: 'task-review-001',
        title: 'Implementar App Shell e Navegação por Abas',
        criteria: ['role="tab" semântico', 'SVG inline'],
        verificationCommand: 'npm test',
        expectedScopeFiles: ['public/index.html'],
        skillRouted: 'FRONTEND_SPECIALIST',
        skillGuidelines: [
          'Design Tokens CSS em :root',
          'Zero emojis como ícones visuais',
          'Store reativa com sobrevivência pós-F5'
        ]
      },
      builderReport: {
        status: 'completed',
        filesChanged: ['public/index.html'],
        commandsExecuted: ['npm test'],
        finalResponse: 'Implementação realizada com sucesso.'
      },
      diffValidation: {
        isSurgical: true,
        unrelatedFiles: []
      },
      evaluation: {
        verdict: 'PASS',
        exitCode: 0,
        actual: '100% dos testes passando.'
      }
    });

    // Camada B: Diretiva de conformidade de skill
    assert.ok(prompt.includes('DIRETRIZES DA ESPECIALIDADE / SKILL ALOCADA'),
      'Camada B deve orientar o Supervisor a verificar a conformidade com a skill alocada');

    // Camada C: Injeção estruturada da skill e guidelines
    assert.ok(prompt.includes('ESPECIALIDADE / SKILL ALOCADA AO WORKER: [FRONTEND_SPECIALIST]'),
      'Camada C deve registrar a especialidade alocada');
    assert.ok(prompt.includes('DIRETRIZES DA SKILL EXIGIDAS NESTA ENTREGA:'),
      'Camada C deve registrar as diretrizes exigidas');
    assert.ok(prompt.includes('Zero emojis como ícones visuais'));
  });

  test('5. [Orçamento < 24.000 chars & Tag <skill>] Prompts do Worker e do Supervisor respeitam estritamente o budget de contexto', () => {
    // 5.1 Worker Prompt com injeção cirúrgica de skill e XML <skill> no <gsd_atomic_task>
    const workerRes = PromptArchitectureService.buildWorkerPrompt({
      mode: 'IMPLEMENT',
      projectId: testProjectId,
      projectName: 'Test Budget App',
      projectPath: testProjectDir,
      projectObjective: 'Construir SaaS Enterprise de Gestão',
      taskId: 'task-budget-001',
      taskTitle: 'Construir App Shell com Command Palette e Reactive Store',
      taskDescription: 'Criar layout principal linear com paleta escura, atalhos de teclado e estado reativo',
      acceptanceCriteria: [
        'Layout com CSS Tokens semânticos',
        'Atalho Ctrl+K abrindo a Command Palette',
        'Persistência em localStorage e backend'
      ],
      verificationCommand: 'npm test',
      doneWhen: 'Critérios atendidos e testes passando com exit code 0',
      expectedScopeFiles: ['public/index.html', 'public/app.js', 'public/style.css'],
      routedSkillId: 'FRONTEND_SPECIALIST',
      routedSkillDigest: 'Design Tokens CSS em :root, scrollbar customizada 6px, navegação com role="tab" e data-tab, ícones SVG inline (zero emojis), Store reativa e persistência F5.',
      docSimpContextBlock: 'DOCSIMP Guidelines: Graceful Mock Fallback habilitado.',
      designSkillContextBlock: 'DESIGN.md: Paleta escura zinc-950, botões com role="tab", SVG Lucide inline.',
      reaSaaSMasterContextBlock: 'REA SaaS Master: 7 Pilares operacionais ativos.'
    });

    // Verificação da tag <skill> dentro de <gsd_atomic_task>
    assert.ok(workerRes.prompt.includes('<skill persona="FRONTEND_SPECIALIST">Design Tokens CSS em :root'),
      'Worker prompt deve conter a tag <skill persona="..."> com o digest cirúrgico dentro de <gsd_atomic_task>');

    // Verificação de orçamento rígido (< 24.000 caracteres)
    assert.ok(
      workerRes.prompt.length < 24000,
      `Worker prompt deve ter menos de 24.000 chars (atual: ${workerRes.prompt.length})`
    );

    // 5.2 Supervisor Prompts (< 24.000 caracteres)
    const supPlanRes = PromptArchitectureService.buildSupervisorPrompt({
      mode: 'INITIAL_PLAN',
      projectId: testProjectId,
      projectName: 'Test Budget App',
      projectPath: testProjectDir,
      projectObjective: 'Construir SaaS Enterprise',
      briefing: 'Criar aplicação SaaS completa com backend Node.js, SQLite, API REST e SPA Frontend'
    });
    assert.ok(
      supPlanRes.prompt.length < 24000,
      `Supervisor Plan prompt deve ter menos de 24.000 chars (atual: ${supPlanRes.prompt.length})`
    );

    const supReviewRes = PromptArchitectureService.buildSupervisorPrompt({
      mode: 'TASK_REVIEW',
      projectId: testProjectId,
      projectName: 'Test Budget App',
      projectPath: testProjectDir,
      projectObjective: 'Construir SaaS Enterprise',
      task: {
        id: 'task-test-budget',
        title: 'Criar tabelas SQLite e seedIfEmpty',
        skillRouted: 'DATABASE_ARCHITECT',
        skillGuidelines: ['Queries parametrizadas (?)', 'seedIfEmpty com 20 registros']
      },
      evaluation: {
        verdict: 'PASS',
        actual: 'Testes aprovados'
      }
    });
    assert.ok(
      supReviewRes.prompt.length < 24000,
      `Supervisor Review prompt deve ter menos de 24.000 chars (atual: ${supReviewRes.prompt.length})`
    );
  });
});
