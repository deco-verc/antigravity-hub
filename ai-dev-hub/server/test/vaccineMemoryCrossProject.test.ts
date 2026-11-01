import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import { EngineeringContextService } from '../src/engineeringContextService.js';
import { PromptArchitectureService } from '../src/promptArchitectureService.js';
import express from 'express';
import { apiRouter } from '../src/routes.js';

describe('UNIVERSAL VACCINE MEMORY (Vacinas de Código Cross-Project)', () => {
  const testTaskId = 'test-task-vaccine-101';
  const testProjectId = 'test-proj-vaccine-alpha';

  before(() => {
    try {
      db.prepare('DELETE FROM operational_lessons WHERE task_id = ? OR project_id = ?').run(testTaskId, testProjectId);
    } catch {}
  });

  after(() => {
    try {
      db.prepare('DELETE FROM operational_lessons WHERE task_id = ? OR project_id = ?').run(testTaskId, testProjectId);
    } catch {}
  });

  it('1. Migração defensiva: garante colunas stack_tags e is_global na tabela operational_lessons', () => {
    const tableInfo: any[] = db.prepare('PRAGMA table_info(operational_lessons)').all() as any[];
    const columnNames = tableInfo.map(c => c.name);

    assert.ok(columnNames.includes('stack_tags'), 'Coluna stack_tags deve existir em operational_lessons');
    assert.ok(columnNames.includes('is_global'), 'Coluna is_global deve existir em operational_lessons');
    assert.ok(columnNames.includes('resolved'), 'Coluna resolved deve existir em operational_lessons');
    assert.ok(columnNames.includes('occurrences'), 'Coluna occurrences deve existir em operational_lessons');
  });

  it('2. Registro de nova vacina: registerResolvedVaccine salva com resolved=1, is_global=1 e tags inferidas', () => {
    const vaccine = EngineeringContextService.registerResolvedVaccine({
      projectId: testProjectId,
      projectPath: '/test/projects/whatsapp-bot',
      taskId: testTaskId,
      problemSummary: 'Falha de conexão WebSocket no Baileys socket disconnect 428',
      rootCause: 'Falta de reconexão automática e gerenciamento de estado do socket',
      failedStrategy: 'Apenas relançar o erro sem backoff exponencial',
      workingStrategy: 'Implementar loop de reconexão com backoff e tratamento do DisconnectReason.loggedOut',
      affectedFiles: ['src/whatsapp/baileysAdapter.ts', 'src/whatsapp/connection.ts']
    });

    assert.ok(vaccine, 'Deveria retornar a vacina criada');
    assert.equal(vaccine.resolved, true);
    assert.equal(vaccine.isGlobal, true);
    assert.equal(vaccine.occurrences, 1);
    assert.ok(vaccine.stackTags && vaccine.stackTags.includes('whatsapp'), 'Deve conter tag whatsapp');
    assert.ok(vaccine.stackTags && vaccine.stackTags.includes('baileys'), 'Deve conter tag baileys');

    // Valida no banco de dados SQLite
    const row: any = db.prepare('SELECT * FROM operational_lessons WHERE id = ?').get(vaccine.id);
    assert.ok(row, 'Registro deve existir no banco');
    assert.equal(row.resolved, 1);
    assert.equal(row.is_global, 1);
    assert.equal(row.occurrences, 1);
    const savedTags = JSON.parse(row.stack_tags);
    assert.ok(savedTags.includes('whatsapp'));
    assert.ok(savedTags.includes('baileys'));
  });

  it('3. Reincidência de vacina: incrementa occurrences e mescla tags ao atualizar', () => {
    const updated = EngineeringContextService.registerResolvedVaccine({
      projectId: testProjectId,
      taskId: testTaskId,
      problemSummary: 'Falha de conexão WebSocket no Baileys socket disconnect 428',
      workingStrategy: 'Implementar loop de reconexão com backoff e tratamento do DisconnectReason.loggedOut',
      affectedFiles: ['src/whatsapp/baileysAdapter.ts', 'src/webhook/notify.ts']
    });

    assert.ok(updated);
    assert.equal(updated.occurrences, 2, 'Ocorrências devem ser incrementadas para 2');
    assert.ok(updated.stackTags.includes('webhook'), 'Nova tag webhook deve ser mesclada');
    assert.ok(updated.stackTags.includes('whatsapp'), 'Tag anterior whatsapp deve ser preservada');
  });

  it('4. Injeção preventiva: getPreventiveVaccinesBlock gera bloco formatado quando stack coincide', () => {
    const block = EngineeringContextService.getPreventiveVaccinesBlock(
      'Desenvolver integração com WhatsApp usando baileys para disparo de mensagens',
      ['src/whatsapp/service.ts']
    );

    assert.ok(block.length > 0, 'Bloco de vacinas preventivas não deve ser vazio');
    assert.ok(block.includes('=== 💉 VACINAS PREVENTIVAS DE CÓDIGO (APRENDA COM ERROS PASSADOS) ==='));
    assert.ok(block.includes('[Problema]:'));
    assert.ok(block.includes('Falha de conexão WebSocket no Baileys'));
    assert.ok(block.includes('[Causa Raiz]:'));
    assert.ok(block.includes('[Solução Comprovada Obrigatória]:'));
    assert.ok(block.includes('VOCÊ DEVE APLICAR ESSAS SOLUÇÕES PREVENTIVAMENTE PARA EVITAR REGRESSÕES.'));
  });

  it('5. Injeção preventiva: getPreventiveVaccinesBlock retorna vazio para stack não relacionada', () => {
    const block = EngineeringContextService.getPreventiveVaccinesBlock(
      'Criar script Python com pandas e matplotlib para plotar gráficos de ações',
      ['analytics.py']
    );

    assert.equal(block, '', 'Não deve injetar vacinas de WhatsApp em tarefas sem relação de stack');
  });

  it('6. Injeção no Supervisor Prompt: buildSupervisorPrompt inclui <preventive_code_vaccines>', () => {
    const { prompt } = PromptArchitectureService.buildSupervisorPrompt({
      mode: 'PLAN',
      projectId: 'proj-beta',
      projectName: 'Bot WhatsApp',
      projectPath: '/test/bot',
      briefing: 'Criar webhook e bot do WhatsApp usando baileys com armazenamento em sqlite',
      allTasks: []
    });

    assert.ok(prompt.includes('<preventive_code_vaccines>'), 'Supervisor deve conter tag <preventive_code_vaccines>');
    assert.ok(prompt.includes('=== 💉 VACINAS PREVENTIVAS DE CÓDIGO'));
    assert.ok(prompt.includes('Falha de conexão WebSocket no Baileys'));
  });

  it('7. Injeção no Worker Prompt: buildWorkerPrompt inclui <preventive_code_vaccines>', () => {
    const { prompt } = PromptArchitectureService.buildWorkerPrompt({
      mode: 'EXECUTE',
      projectId: 'proj-beta',
      projectName: 'Bot WhatsApp',
      projectPath: '/test/bot',
      projectObjective: 'Automatizar suporte via WhatsApp',
      taskId: 'task-102',
      taskTitle: 'Implementar conexão baileys para WhatsApp',
      taskDescription: 'Configurar socket e reconexão automática',
      acceptanceCriteria: ['Reconexão com backoff exponencial funcional'],
      expectedScopeFiles: ['src/baileysClient.ts']
    });

    assert.ok(prompt.includes('<preventive_code_vaccines>'), 'Worker deve conter tag <preventive_code_vaccines>');
    assert.ok(prompt.includes('=== 💉 VACINAS PREVENTIVAS DE CÓDIGO'));
    assert.ok(prompt.includes('Implementar loop de reconexão'));
  });

  it('8. API de consulta: GET /api/system/vaccines retorna vacinas resolvidas ativas com tags e ocorrências', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api', apiRouter);

    const server = app.listen(0);
    const port = (server.address() as any).port;

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/system/vaccines`);
      assert.equal(response.status, 200);

      const data = await response.json();
      assert.equal(data.success, true);
      assert.ok(data.total >= 1);
      assert.ok(Array.isArray(data.vaccines));

      const found = data.vaccines.find((v: any) => v.problemSummary.includes('Baileys'));
      assert.ok(found, 'Deveria conter a vacina registrada');
      assert.equal(found.resolved, true);
      assert.equal(found.isGlobal, true);
      assert.ok(found.occurrences >= 1);
      assert.ok(Array.isArray(found.stackTags));
      assert.ok(found.stackTags.includes('whatsapp'));
    } finally {
      server.close();
    }
  });
});
