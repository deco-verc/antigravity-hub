// server/test/stagePromptsMatrix.test.ts
// Testes de Validação da Matriz de Prompts Especializados por Estágio (5 Estágios)

import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PromptArchitectureService, DevelopmentStage } from '../src/promptArchitectureService.js';

describe('Matriz de Prompts Especializados por Estágio de Desenvolvimento', () => {

  // 1. Verificação da existência e integridade dos 5 arquivos modulares
  it('1. Arquivos modulares em server/src/prompts/stages/ existem e possuem conteúdo denso', () => {
    const stagesDir = path.resolve(process.cwd(), 'src', 'prompts', 'stages');
    const expectedFiles = [
      'stage-scaffold.md',
      'stage-database.md',
      'stage-engine-api.md',
      'stage-frontend-ui.md',
      'stage-surgical-bugfix.md'
    ];

    for (const file of expectedFiles) {
      const fullPath = path.join(stagesDir, file);
      assert.ok(fs.existsSync(fullPath), `Arquivo ${file} deve existir em ${stagesDir}`);
      const content = fs.readFileSync(fullPath, 'utf-8');
      assert.ok(content.length > 500, `Arquivo ${file} deve ter conteúdo substancial (> 500 bytes)`);
      assert.ok(content.length < 5000, `Arquivo ${file} deve ser enxuto e ultraleve (< 5000 bytes)`);
    }
  });

  // 2. Seletor automático: arquivos .sql, database, schema, repository -> stage-database.md
  it('2. Seletor mapeia tarefas com .sql, database, schema, repository para "database"', () => {
    const stageFromSql = PromptArchitectureService.detectDevelopmentStage({
      mode: 'IMPLEMENT',
      projectId: 'proj-db-1',
      projectName: 'Test App',
      projectPath: '/test/app',
      projectObjective: 'Criar banco de dados',
      taskId: 'task-db-1',
      taskTitle: 'Criar tabelas e migrations do domínio',
      expectedScopeFiles: ['src/db/schema.sql', 'src/db/migrations.ts'],
      acceptanceCriteria: ['Tabelas criadas com integridade']
    });
    assert.equal(stageFromSql, 'database');

    const stageFromRepo = PromptArchitectureService.detectDevelopmentStage({
      mode: 'IMPLEMENT',
      projectId: 'proj-db-2',
      projectName: 'Test App',
      projectPath: '/test/app',
      projectObjective: 'Criar repositório',
      taskId: 'task-db-2',
      taskTitle: 'Implementar UserRepository com consultas parametrizadas',
      expectedScopeFiles: ['src/repositories/UserRepository.ts'],
      acceptanceCriteria: ['Consultas parametrizadas no banco']
    });
    assert.equal(stageFromRepo, 'database');
  });

  // 3. Seletor automático: arquivos .tsx, view, component, page, css, html -> stage-frontend-ui.md
  it('3. Seletor mapeia tarefas com .tsx, view, component, page, css, html para "frontend-ui"', () => {
    const stageFromTsx = PromptArchitectureService.detectDevelopmentStage({
      mode: 'IMPLEMENT',
      projectId: 'proj-ui-1',
      projectName: 'Test App',
      projectPath: '/test/app',
      projectObjective: 'Interface Web',
      taskId: 'task-ui-1',
      taskTitle: 'Construir formulário operacional de disparo rápido',
      expectedScopeFiles: ['src/components/DispatchForm.tsx', 'src/views/DashboardView.tsx'],
      acceptanceCriteria: ['Formulário com feedback otimista']
    });
    assert.equal(stageFromTsx, 'frontend-ui');

    const stageFromHtmlCss = PromptArchitectureService.detectDevelopmentStage({
      mode: 'IMPLEMENT',
      projectId: 'proj-ui-2',
      projectName: 'Test App',
      projectPath: '/test/app',
      projectObjective: 'Página de templates',
      taskId: 'task-ui-2',
      taskTitle: 'Estilização de templates e tabelas dinâmicas',
      expectedScopeFiles: ['public/index.html', 'public/styles.css'],
      acceptanceCriteria: ['Tokens :root e scrollbar 6px aplicados']
    });
    assert.equal(stageFromHtmlCss, 'frontend-ui');
  });

  // 4. Seletor automático: correção de falha (REPAIR ou rejeição do Reviewer) -> stage-surgical-bugfix.md
  it('4. Seletor mapeia REPAIR e rejeição do Reviewer para "surgical-bugfix"', () => {
    const stageFromRepairMode = PromptArchitectureService.detectDevelopmentStage({
      mode: 'REPAIR',
      projectId: 'proj-fix-1',
      projectName: 'Test App',
      projectPath: '/test/app',
      projectObjective: 'Corrigir bug',
      taskId: 'task-fix-1',
      taskTitle: 'Corrigir timeout na rota de pagamentos',
      previousError: 'TimeoutError: connection dropped at line 42',
      acceptanceCriteria: ['Timeout eliminado']
    });
    assert.equal(stageFromRepairMode, 'surgical-bugfix');

    const stageFromRejection = PromptArchitectureService.detectDevelopmentStage({
      mode: 'IMPLEMENT',
      projectId: 'proj-fix-2',
      projectName: 'Test App',
      projectPath: '/test/app',
      projectObjective: 'Corrigir falha',
      taskId: 'task-fix-2',
      taskTitle: 'Ajuste pós-revisão',
      previousEvaluatorOutput: 'Evaluator REJECTED: exit code 1 no teste de integração',
      acceptanceCriteria: ['Passar no gate de avaliação']
    });
    assert.equal(stageFromRejection, 'surgical-bugfix');
  });

  // 5. Seletor automático: webhook, api, server, socket, baileys, worker -> stage-engine-api.md
  it('5. Seletor mapeia webhook, api, server, socket, baileys, worker para "engine-api"', () => {
    const stageFromWebhook = PromptArchitectureService.detectDevelopmentStage({
      mode: 'IMPLEMENT',
      projectId: 'proj-api-1',
      projectName: 'Test App',
      projectPath: '/test/app',
      projectObjective: 'Webhooks WhatsApp',
      taskId: 'task-api-1',
      taskTitle: 'Implementar endpoint de webhook com resposta < 100ms e socket Baileys',
      expectedScopeFiles: ['src/api/webhook.ts', 'src/engine/baileysSocket.ts'],
      acceptanceCriteria: ['ACK em menos de 100ms']
    });
    assert.equal(stageFromWebhook, 'engine-api');
  });

  // 6. Seletor automático: bootstrap ou setup inicial -> stage-scaffold.md
  it('6. Seletor mapeia bootstrap ou setup inicial para "scaffold"', () => {
    const stageFromScaffold = PromptArchitectureService.detectDevelopmentStage({
      mode: 'IMPLEMENT',
      projectId: 'proj-scaffold-1',
      projectName: 'Test App',
      projectPath: '/test/app',
      projectObjective: 'Setup inicial',
      taskId: 'task-scaffold-1',
      taskTitle: 'Configurar estrutura e dependências base do projeto',
      expectedScopeFiles: ['package.json', 'tsconfig.json'],
      acceptanceCriteria: ['TypeScript strict e scripts definidos']
    });
    assert.equal(stageFromScaffold, 'scaffold');
  });

  // 7. Isolamento Estrito: tarefa de frontend NÃO recebe regras de SQLite
  it('7. Tarefa de frontend NÃO recebe regras de SQLite (zero ocorrências)', () => {
    const { prompt, meta } = PromptArchitectureService.buildWorkerPrompt({
      mode: 'IMPLEMENT',
      projectId: 'proj-ui-iso',
      projectName: 'Frontend Portal',
      projectPath: '/dummy/frontend-portal',
      projectObjective: 'Portal de Atendimento e Disparo',
      taskId: 'task-ui-iso',
      taskTitle: 'Construir interface de disparo rápido e edição de templates',
      taskDescription: 'Implementar ferramentas ativas, formulário com feedback otimista e Live Preview',
      expectedScopeFiles: ['src/components/DispatchTool.tsx', 'src/views/TemplateEditor.tsx'],
      acceptanceCriteria: [
        'Formulário funcional com validação inline',
        'Tabela operacional com data-action e data-id',
        'Anti-dashboard passivo cumprido'
      ]
    });

    assert.equal(meta.stage, 'frontend-ui');
    const matchingLines = prompt.split('\n').filter(l => l.toLowerCase().includes('sqlite'));
    if (matchingLines.length > 0) {
      console.log('SQLITE MATCHING LINES IN FRONTEND PROMPT:', matchingLines);
    }
    assert.equal(
      matchingLines.length,
      0,
      `Prompt de frontend não deve conter nenhuma menção ou regra de SQLite: ${matchingLines.join(' | ')}`
    );
    assert.ok(prompt.includes('stage="frontend-ui"'), 'Prompt deve identificar estágio frontend-ui');
    assert.ok(prompt.includes('Anti-Dashboard Passivo'), 'Prompt deve conter regra de anti-dashboard passivo');
    assert.ok(prompt.includes('Tokens :root'), 'Prompt deve conter tokens CSS');
  });

  // 8. Isolamento Estrito: tarefa de banco NÃO recebe regras de React
  it('8. Tarefa de banco de dados NÃO recebe regras de React (zero ocorrências)', () => {
    const { prompt, meta } = PromptArchitectureService.buildWorkerPrompt({
      mode: 'IMPLEMENT',
      projectId: 'proj-db-iso',
      projectName: 'Database Engine',
      projectPath: '/dummy/db-engine',
      projectObjective: 'Persistência Relacional',
      taskId: 'task-db-iso',
      taskTitle: 'Modelar esquemas DDL e tabelas do domínio',
      taskDescription: 'Criar migrações SQLite WAL, tabelas tipadas e rotina seedIfEmpty',
      expectedScopeFiles: ['src/db/schema.sql', 'src/db/database.ts'],
      acceptanceCriteria: [
        'Tabelas criadas com integridade referencial',
        'Queries 100% parametrizadas',
        'Rotina seedIfEmpty com dados relacionais'
      ]
    });

    assert.equal(meta.stage, 'database');
    assert.equal(
      prompt.toLowerCase().includes('react'),
      false,
      'Prompt de banco de dados não deve conter nenhuma menção ou regra de React'
    );
    assert.ok(prompt.includes('stage="database"'), 'Prompt deve identificar estágio database');
    assert.ok(prompt.includes('better-sqlite3'), 'Prompt de banco deve conter instruções de better-sqlite3');
    assert.ok(prompt.includes('journal_mode = WAL'), 'Prompt de banco deve conter journal_mode = WAL');
  });

  // 9. Orçamento Ultraleve: prompt com < 2.500 tokens de instrução
  it('9. Prompt de cada tarefa é ultraleve (< 2.500 tokens de instrução / < 12.000 chars)', () => {
    const stages: DevelopmentStage[] = ['scaffold', 'database', 'engine-api', 'frontend-ui', 'surgical-bugfix'];

    for (const st of stages) {
      const { prompt } = PromptArchitectureService.buildWorkerPrompt({
        mode: st === 'surgical-bugfix' ? 'REPAIR' : 'IMPLEMENT',
        stage: st,
        projectId: `proj-light-${st}`,
        projectName: 'Lightweight App',
        projectPath: '/dummy/app',
        projectObjective: 'Demonstração de performance',
        taskId: `task-${st}`,
        taskTitle: `Tarefa de teste do estágio ${st}`,
        acceptanceCriteria: ['Critério 1 atendido', 'Critério 2 verificado'],
        expectedScopeFiles: [`src/${st}/module.ts`]
      });

      // Em modelos Gemini/Claude, 1 token de instrução equivale a ~4,2 a 5 caracteres em código/português.
      const estimatedTokens = Math.ceil(prompt.length / 4.2);
      assert.ok(
        estimatedTokens < 2500,
        `Estágio ${st} deve gerar prompt ultraleve (< 2.500 tokens). Obtido: ~${estimatedTokens} tokens (${prompt.length} chars)`
      );
    }
  });

  // 10. Injeção na Camada C: tag <stage_specialized_rules> é incluída no contexto
  it('10. Conteúdo especializado é injetado na Camada C (<stage_specialized_rules>)', () => {
    const { prompt } = PromptArchitectureService.buildWorkerPrompt({
      mode: 'IMPLEMENT',
      projectId: 'proj-c-1',
      projectName: 'Test App',
      projectPath: '/test/app',
      projectObjective: 'Injeção Camada C',
      taskId: 'task-c-1',
      taskTitle: 'Configurar servidor API e webhooks',
      expectedScopeFiles: ['src/server.ts', 'src/api/webhooks.ts'],
      acceptanceCriteria: ['Webhooks processados em < 100ms']
    });

    assert.ok(prompt.includes('<stage_specialized_rules stage="engine-api">'), 'Camada C deve conter tag <stage_specialized_rules>');
    assert.ok(prompt.includes('Webhooks de Alta Performance (< 100ms)'), 'Camada C deve conter o conteúdo do arquivo stage-engine-api.md');
  });

});
