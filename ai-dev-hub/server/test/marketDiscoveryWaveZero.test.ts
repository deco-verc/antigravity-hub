// server/test/marketDiscoveryWaveZero.test.ts
// Testes de Validação da Onda 0: Market Research, Reference Apps & REA Discovery (FASE 22)

import test, { describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { db } from '../src/db.js';
import { MarketDiscoveryService } from '../src/marketDiscoveryService.js';
import { PromptArchitectureService } from '../src/promptArchitectureService.js';
import { SkillSlashCommandService } from '../src/skillSlashCommandService.js';
import { HierarchicalOrchestrationService } from '../src/hierarchicalOrchestrationService.js';

describe('FASE 22: Onda 0 (Market Research, Reference Apps & REA Discovery)', () => {
  let testProjectDir: string;
  let testProjectId: string;

  beforeEach(() => {
    testProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-wave0-test-'));
    testProjectId = 'test-proj-' + crypto.randomUUID().slice(0, 8);

    fs.mkdirSync(path.join(testProjectDir, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(testProjectDir, 'package.json'),
      JSON.stringify({ name: 'test-wave0-app', version: '1.0.0' }, null, 2),
      'utf-8'
    );

    try {
      db.prepare(`
        INSERT INTO projects (id, name, path, status, created_at, updated_at)
        VALUES (?, ?, ?, 'active', ?, ?)
      `).run(testProjectId, 'Test Project Wave0', testProjectDir, new Date().toISOString(), new Date().toISOString());
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "marketDiscoveryWaveZero.test",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:marketDiscoveryWaveZero.test]", err);
      }
    }
  });

  afterEach(() => {
    try {
      db.prepare('DELETE FROM messages WHERE project_id = ?').run(testProjectId);
      db.prepare('DELETE FROM autonomous_runs WHERE project_id = ?').run(testProjectId);
      db.prepare('DELETE FROM projects WHERE id = ?').run(testProjectId);
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "marketDiscoveryWaveZero.test",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:marketDiscoveryWaveZero.test]", err);
      }
    }

    try {
      fs.rmSync(testProjectDir, { recursive: true, force: true });
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "marketDiscoveryWaveZero.test",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:marketDiscoveryWaveZero.test]", err);
      }
    }
  });

  test('Deve inferir perfis de domínio de mercado com alta precisão a partir do briefing', () => {
    const fintech = MarketDiscoveryService.inferDomainProfile('Plataforma de emissão de cobranças Pix, faturas e conciliação');
    assert.equal(fintech.domainName.includes('Fintech'), true);

    const crm = MarketDiscoveryService.inferDomainProfile('Sistema de gestão de leads, pipeline de vendas e funil de oportunidades');
    assert.equal(crm.domainName.includes('CRM'), true);

    const devtools = MarketDiscoveryService.inferDomainProfile('Gerenciador de sprints, backlog de engenharia e bug tracker');
    assert.ok(/Developer Tools|DevTools/i.test(devtools.domainName));

    const health = MarketDiscoveryService.inferDomainProfile('Prontuário eletrônico para médicos, agendamento de consultas e telemedicina');
    assert.equal(health.domainName.includes('Saúde'), true);

    const ecommerce = MarketDiscoveryService.inferDomainProfile('Loja virtual de vestuário com catálogo de produtos e checkout integrado');
    assert.ok(/e-commerce/i.test(ecommerce.domainName));

    const general = MarketDiscoveryService.inferDomainProfile('SaaS moderno corporativo para auditoria de processos internos');
    assert.ok(/saas moderno/i.test(general.domainName));
  });

  test('Deve conduzir Onda 0 pré-blueprint gerando dossiê completo e reconhecendo referências explícitas', async () => {
    const briefing = 'Plataforma financeira de cobrança recorrente com inspiração visual em Asaas e ContaAzul';
    const discovery = await MarketDiscoveryService.conductPreBlueprintDiscovery({
      briefing,
      projectName: 'Fintech Hub',
      projectPath: testProjectDir
    });

    assert.ok(discovery.fullReportPath);
    assert.ok(fs.existsSync(discovery.fullReportPath));

    const dossierContent = fs.readFileSync(discovery.fullReportPath, 'utf-8');
    assert.ok(dossierContent.includes('ESTUDO DE MERCADO, APLICATIVOS DE REFERÊNCIA & ENGENHARIA REVERSA REA'));
    assert.ok(dossierContent.includes('Fintech'));
    assert.ok(dossierContent.includes('Asaas'));
    assert.ok(dossierContent.includes('ContaAzul'));
    assert.ok(dossierContent.includes('Entidades Recomendadas'));
    assert.ok(dossierContent.includes('Fórmulas Matemáticas de Negócio'));
    assert.ok(dossierContent.includes('Diferenciais "10-Estrelas"'));

    assert.ok(discovery.referenceApps.includes('Asaas'));
    assert.ok(discovery.referenceApps.includes('ContaAzul'));
    assert.ok(discovery.coreEntities.length >= 3);
    assert.ok(discovery.calculationFormulas.length >= 2);
    assert.ok(discovery.killerFeatures.length >= 2);
  });

  test('Bloco compacto de Onda 0 deve respeitar estritamente o orçamento de 800 a 1.400 caracteres', async () => {
    const discovery = await MarketDiscoveryService.conductPreBlueprintDiscovery({
      briefing: 'SaaS de Telemedicina com Prontuário e Agendamento',
      projectName: 'TeleMed PRO',
      projectPath: testProjectDir
    });

    const block = discovery.compactDiscoveryBlock;
    assert.ok(block.length >= 800, `Bloco deve ter pelo menos 800 caracteres (atual: ${block.length})`);
    assert.ok(block.length <= 1400, `Bloco deve ter no máximo 1.400 caracteres (atual: ${block.length})`);
    assert.ok(block.includes('ONDA 0: ESTUDO DE MERCADO, REFERÊNCIAS & REA DISCOVERY'));
    assert.ok(/f[oó]rmulas\s*matem[aá]ticas/i.test(block));
    assert.ok(/diferenciais\s*10-(estrelas|star)/i.test(block));
  });

  test('Prompts de Blueprint, Expansão e Worker com Onda 0 devem permanecer estritamente abaixo do teto de 24.000 chars', async () => {
    const discovery = await MarketDiscoveryService.conductPreBlueprintDiscovery({
      briefing: 'CRM Comercial para Construtoras e Imobiliárias com Funil de Vendas',
      projectName: 'ImobCRM',
      projectPath: testProjectDir
    });

    // 1. Architectural Blueprint Prompt
    const bpResult = PromptArchitectureService.buildArchitecturalBlueprintPrompt({
      projectId: testProjectId,
      projectName: 'ImobCRM',
      projectPath: testProjectDir,
      projectObjective: 'CRM comercial para imobiliárias',
      briefing: 'CRM Comercial para Construtoras e Imobiliárias com Funil de Vendas',
      marketDiscoveryContextBlock: discovery.compactDiscoveryBlock
    });
    assert.ok(bpResult.prompt.length < 24000, `Blueprint prompt (${bpResult.prompt.length}) deve ser < 24.000`);
    assert.ok(bpResult.prompt.includes('CAMADA C: ESTUDO DE MERCADO, BENCHMARKING & REA DISCOVERY (ONDA 0)'));

    // 2. Major Task Expansion Prompt
    const expResult = PromptArchitectureService.buildMajorTaskExpansionPrompt({
      projectId: testProjectId,
      projectName: 'ImobCRM',
      projectPath: testProjectDir,
      projectObjective: 'CRM comercial para imobiliárias',
      briefing: 'CRM Comercial para Construtoras e Imobiliárias',
      majorTask: {
        code: 'GT-2',
        title: 'Modelo de Dados, Schemas SQLite e Seed Realista',
        objective: 'Criar persistência local e seed com 25 leads',
        expectedOutcome: 'Tabelas criadas e migradas sem erros'
      },
      marketDiscoveryContextBlock: discovery.compactDiscoveryBlock
    });
    assert.ok(expResult.prompt.length < 24000, `Expansion prompt (${expResult.prompt.length}) deve ser < 24.000`);
    assert.ok(expResult.prompt.includes('CAMADA C: ESTUDO DE MERCADO & REA DISCOVERY (ONDA 0)'));

    // 3. Worker Prompt
    const workerResult = PromptArchitectureService.buildWorkerPrompt({
      task: {
        id: 'task-1',
        title: 'Implementar tabelas de leads e deals',
        description: 'Criar migrations e persistência',
        code: '2.1',
        verification_command: 'npm test'
      },
      projectPath: testProjectDir,
      projectName: 'ImobCRM',
      marketDiscoveryContextBlock: discovery.compactDiscoveryBlock
    });
    assert.ok(workerResult.prompt.length < 24000, `Worker prompt (${workerResult.prompt.length}) deve ser < 24.000`);
    assert.ok(workerResult.prompt.includes('DIRETRIZES DA ONDA 0 (MARKET RESEARCH & REA)'));
  });

  test('Slash Command /research deve estar registrado no catálogo com aliases e hints corretos', () => {
    const catalog = SkillSlashCommandService.getSlashCommandsCatalog();
    const researchCmd = catalog.find(c => c.command === '/research');

    assert.ok(researchCmd, 'Comando /research deve existir no catálogo de slash commands');
    assert.equal(researchCmd.executionType, 'IMMEDIATE_TOOL');
    assert.ok(researchCmd.aliases.includes('/discovery'));
    assert.ok(researchCmd.aliases.includes('/market-rea'));
    assert.ok(researchCmd.argHint?.includes('--build'));
  });

  test('Execução de /research via SlashCommandService deve gerar resposta formatada e dossiê', async () => {
    const result = await SkillSlashCommandService.handleSlashCommand({
      projectId: testProjectId,
      projectPath: testProjectDir,
      projectName: 'EducaHub',
      command: '/research',
      args: 'SaaS de Gestão de Cursos e Certificados',
      fullMessage: '/research SaaS de Gestão de Cursos e Certificados'
    });

    assert.equal(result.execution?.status, 'completed');
    assert.equal(result.execution?.command, '/research');
    assert.ok(result.replyContent.includes('Estudo de Mercado & Engenharia Reversa REA'));
    assert.ok(result.replyContent.includes('Dossiê Gerado:'));
    assert.ok(result.execution?.dossierPath);
    assert.ok(fs.existsSync(result.execution.dossierPath));
  });

  test('Execução de /research com flag --build deve iniciar execução autônoma do projeto', async () => {
    const result = await SkillSlashCommandService.handleSlashCommand({
      projectId: testProjectId,
      projectPath: testProjectDir,
      projectName: 'FinPro',
      command: '/research',
      args: 'SaaS de Conciliação Bancária --build',
      fullMessage: '/research SaaS de Conciliação Bancária --build'
    });

    assert.equal(result.execution?.status, 'completed');
    assert.equal(result.execution?.shouldBuild, true);
    assert.ok(result.autonomousRun);
    assert.ok(result.replyContent.includes('[AUTÔNOMO ATIVADO]'));
  });

  test('HierarchicalOrchestrationService.generateMultiPassPlannedTasks deve disparar Onda 0 sem bloquear fluxo', () => {
    const tasks = HierarchicalOrchestrationService.generateMultiPassPlannedTasks({
      briefing: `
Construir SaaS completo de gestão para escritórios de advocacia:
1. Scaffolding, TypeScript strict e configuração unificada
2. Modelagem SQLite de clientes, processos e audiências
3. API RESTful com rotas de processos e honorários
4. Dashboard analítico com KPIs e visualização de prazos
5. Suíte de testes automatizados e homologação
      `.trim(),
      projectPath: testProjectDir,
      projectName: 'JusHub'
    });

    assert.ok(Array.isArray(tasks));
    assert.ok(tasks.length >= 10, `Deve gerar plano hierárquico enciclopédico de tarefas (gerou: ${tasks.length})`);
  });
});
