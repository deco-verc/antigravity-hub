import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ProjectOperationsService } from '../src/projectOperationsService.js';
import { DeltaFeatureEngine } from '../src/deltaFeatureEngine.js';
import { HierarchicalOrchestrationService } from '../src/hierarchicalOrchestrationService.js';

test('LivePortLogBuffer: grava logs em memória e em disco, respeita limite e limpa', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-port-logs-test-'));
  const projectId = 'test-proj-log-1';

  try {
    // 1. Grava linhas de log
    ProjectOperationsService.appendRuntimeLog(projectId, tmpDir, 'STDOUT', 'Iniciando servidor na porta 4100');
    ProjectOperationsService.appendRuntimeLog(projectId, tmpDir, 'STDERR', 'Aviso transitório de deprecation');
    ProjectOperationsService.appendRuntimeLog(projectId, tmpDir, 'STDOUT', 'Rota /api/mine chamada com sucesso');

    // 2. Consulta logs
    const result = ProjectOperationsService.getRuntimeLogs(projectId, tmpDir, 10);
    assert.equal(result.logs.length, 3);
    assert.ok(result.logs[0].includes('Iniciando servidor na porta 4100'));
    assert.ok(result.logs[1].includes('Aviso transitório'));
    assert.ok(result.logs[2].includes('/api/mine'));

    // 3. Verifica persistência em disco
    const logFilePath = path.join(tmpDir, '.ai-dev-hub', 'logs', 'port-runtime.log');
    assert.ok(fs.existsSync(logFilePath), 'Arquivo de log em disco deve existir');
    const diskContent = fs.readFileSync(logFilePath, 'utf8');
    assert.ok(diskContent.includes('Iniciando servidor'));

    // 4. Limpa logs
    const cleared = ProjectOperationsService.clearRuntimeLogs(projectId, tmpDir);
    assert.ok(cleared);
    const afterClear = ProjectOperationsService.getRuntimeLogs(projectId, tmpDir);
    assert.equal(afterClear.logs.length, 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('LivePortLogBuffer: resetProjectDatabase localiza e exclui arquivos de banco SQLite de forma segura', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-db-reset-test-'));
  const projectId = 'test-proj-db-1';

  try {
    const dataDir = path.join(tmpDir, 'data');
    fs.mkdirSync(dataDir, { recursive: true });

    const dbFile1 = path.join(dataDir, 'app.db');
    const dbFile2 = path.join(dataDir, 'app.db-wal');
    const dbFile3 = path.join(tmpDir, 'local.sqlite3');
    fs.writeFileSync(dbFile1, 'mock-db-content');
    fs.writeFileSync(dbFile2, 'mock-wal-content');
    fs.writeFileSync(dbFile3, 'mock-sqlite-content');

    assert.ok(fs.existsSync(dbFile1));
    assert.ok(fs.existsSync(dbFile2));
    assert.ok(fs.existsSync(dbFile3));

    const resetResult = ProjectOperationsService.resetProjectDatabase(projectId, tmpDir);
    assert.ok(resetResult.success);
    assert.equal(resetResult.deletedFiles.length, 3);
    assert.ok(!fs.existsSync(dbFile1), 'app.db deve ser removido');
    assert.ok(!fs.existsSync(dbFile2), 'app.db-wal deve ser removido');
    assert.ok(!fs.existsSync(dbFile3), 'local.sqlite3 deve ser removido');

    // Verifica que o evento foi registrado nos logs de runtime
    const logs = ProjectOperationsService.getRuntimeLogs(projectId, tmpDir);
    assert.ok(logs.logs.some(l => l.includes('DATABASE_RESET') || l.includes('Banco(s) de dados limpo(s)')));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('DeltaFeatureEngine: isSurgicalOrBugfixPrompt detecta cirurgias vs projetos novos', () => {
  // Prompts cirúrgicos/correções de bugs
  const bugPrompts = [
    'quando eu clico em minerar ele não faz nada, exclua o banco e veja o que está acontecendo',
    'não funciona o botão de download no card',
    'o app está dando erro 500 ao chamar a api',
    'corrija a porta do servidor e reinicie',
    'veja o que está acontecendo no console',
    'limpe o banco de dados e teste novamente',
    'conserte o layout que quebrou no mobile',
    'ajuste o filtro para aceitar maiúsculas'
  ];

  for (const p of bugPrompts) {
    assert.equal(
      DeltaFeatureEngine.isSurgicalOrBugfixPrompt(p),
      true,
      `Deveria classificar como cirúrgico: "${p}"`
    );
  }

  // Prompts de novos projetos completos
  const newProjectPrompts = [
    'Crie um SaaS completo de Ad Intelligence e mineração com 20 etapas de backend e frontend',
    'Construa uma plataforma nova do zero de agendamento médico com pagamentos Stripe',
    'Desenvolva um sistema completo de gestão de estoque'
  ];

  for (const p of newProjectPrompts) {
    assert.equal(
      DeltaFeatureEngine.isSurgicalOrBugfixPrompt(p),
      false,
      `Não deveria classificar como cirúrgico: "${p}"`
    );
  }
});

test('DeltaFeatureEngine: planSurgicalIteration gera exatamente 1 tarefa focada com contexto injetado', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-surgical-test-'));

  try {
    // Cria arquivos mock no projeto
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'server.js'), 'console.log("running");');
    fs.writeFileSync(path.join(tmpDir, '.env'), 'SCRAPECREATORS_API_KEY=testkey123\nPORT=4100');

    // Injeta logs no buffer
    ProjectOperationsService.appendRuntimeLog('test-proj', tmpDir, 'STDERR', 'ReferenceError: SCRAPECREATORS_API_KEY is not defined');

    const tasks = DeltaFeatureEngine.planSurgicalIteration({
      briefing: 'quando eu clico em minerar ele não faz nada, exclua o banco e veja o que está acontecendo',
      projectPath: tmpDir,
      projectId: 'test-proj'
    });

    assert.equal(tasks.length, 1, 'Deve conter exatamente 1 tarefa cirúrgica');

    const task = tasks[0];
    assert.ok(task.title.includes('Intervenção Cirúrgica') || task.title.includes('Diagnóstico'));
    assert.ok(task.description.includes('ReferenceError'), 'Descrição da tarefa deve conter logs da porta');
    assert.ok(task.description.includes('SCRAPECREATORS_API_KEY'), 'Descrição deve mencionar chaves de .env');
    assert.ok(task.description.includes('quando eu clico em minerar'), 'Descrição deve conter a instrução do usuário');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('HierarchicalOrchestrationService: delega para intervenção cirúrgica e impede 36 etapas em projetos existentes', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-hierarchical-surgical-test-'));

  try {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'my-existing-app' }));
    fs.writeFileSync(path.join(tmpDir, 'server.js'), 'console.log("active");');

    const userPrompt = 'quando eu clico em minerar ele não faz nada, exclua o banco e veja o que está acontecendo';

    const plannedTasks = HierarchicalOrchestrationService.generateMultiPassPlannedTasks(
      userPrompt,
      'Meu App',
      tmpDir
    );

    // Deve retornar 1 tarefa cirúrgica, NUNCA 36 etapas de SaaS genérico
    assert.equal(plannedTasks.length, 1, 'Deve gerar exatamente 1 tarefa cirúrgica para bugfix em projeto existente');
    assert.ok(
      plannedTasks[0].title.includes('Intervenção Cirúrgica') ||
      plannedTasks[0].title.includes('Diagnóstico') ||
      plannedTasks[0].description.includes('quando eu clico em minerar')
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
