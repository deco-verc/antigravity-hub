// server/test/agentBrainCouncil.test.ts
// Testes de Homologação do Cérebro Multi-Agente Conversacional Real (Supervisor, Worker e Reviewer Live)
// Zero Templates Estáticos • Zero Mock em Produção • Reset Cirúrgico de SQLite

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { db } from '../src/db.js';
import { AgentBrainCouncilService } from '../src/agentBrainCouncilService.js';
import { ProjectOperationsService } from '../src/projectOperationsService.js';
import { HierarchicalOrchestrationService } from '../src/hierarchicalOrchestrationService.js';

test('AgentBrainCouncilService: parseTargetAgent identifica menções e seletores corretamente', () => {
  assert.equal(AgentBrainCouncilService.parseTargetAgent('@supervisor analise a arquitetura'), 'supervisor');
  assert.equal(AgentBrainCouncilService.parseTargetAgent('@worker conserte o bug no banco'), 'worker');
  assert.equal(AgentBrainCouncilService.parseTargetAgent('@reviewer audite as rotas de api'), 'reviewer');
  assert.equal(AgentBrainCouncilService.parseTargetAgent('@council qual é o status geral?'), 'council');
  assert.equal(AgentBrainCouncilService.parseTargetAgent('@conselho o que devemos fazer agora?'), 'council');

  // Override explícito via seletor do UI
  assert.equal(AgentBrainCouncilService.parseTargetAgent('Olá agentes', 'worker'), 'worker');
  assert.equal(AgentBrainCouncilService.parseTargetAgent('Olá agentes', 'supervisor'), 'supervisor');
  assert.equal(AgentBrainCouncilService.parseTargetAgent('Olá agentes', 'reviewer'), 'reviewer');

  // Padrão sem menção e sem override é council
  assert.equal(AgentBrainCouncilService.parseTargetAgent('quando eu clico em minerar não faz nada'), 'council');
});

test('AgentBrainCouncilService: buildProjectSnapshot captura arquivos, logs da porta, SQLite e mascara .env', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-council-snapshot-'));
  const projectId = `proj-snap-${crypto.randomUUID().slice(0, 8)}`;

  try {
    // 1. Cadastra projeto no banco
    db.prepare(`
      INSERT INTO projects (id, name, path, status, created_at, updated_at)
      VALUES (?, ?, ?, 'ready', datetime('now'), datetime('now'))
    `).run(projectId, 'Projeto Snapshot Teste', tmpDir);

    // 2. Cria estrutura de arquivos de teste
    fs.writeFileSync(path.join(tmpDir, 'server.js'), 'const express = require("express");\napp.listen(3000);');
    fs.mkdirSync(path.join(tmpDir, 'public'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'public', 'app.js'), 'console.log("App iniciado");');

    // .env com chaves secretas para verificar mascaramento
    fs.writeFileSync(path.join(tmpDir, '.env'), 'SCRAPECREATORS_API_KEY=sk_live_123456789abcdef\nPORT=3000\nDATABASE_URL=sqlite:data.db');

    // Cria banco SQLite real com tabela e dados
    const sqlitePath = path.join(tmpDir, 'test_app.db');
    const localDb = new DatabaseSync(sqlitePath);
    localDb.exec(`
      CREATE TABLE ads (id TEXT PRIMARY KEY, page_name TEXT);
      INSERT INTO ads (id, page_name) VALUES ('ad-1', 'Viral Search Teste');
      INSERT INTO ads (id, page_name) VALUES ('ad-2', 'AdMiner Pro');
    `);
    localDb.close();

    // Grava logs de runtime
    ProjectOperationsService.appendRuntimeLog(projectId, tmpDir, 'STDOUT', 'Express listening on port 3000');
    ProjectOperationsService.appendRuntimeLog(projectId, tmpDir, 'STDERR', 'Warning: Deprecated API');

    // 3. Executa snapshot
    const snapshot = await AgentBrainCouncilService.buildProjectSnapshot(projectId, tmpDir);

    assert.equal(snapshot.projectId, projectId);
    assert.equal(snapshot.projectName, 'Projeto Snapshot Teste');
    assert.ok(snapshot.fileTree.length >= 3, 'Deve listar arquivos do projeto');
    assert.ok(snapshot.fileTree.some(f => f.includes('server.js')));
    assert.ok(snapshot.fileTree.some(f => f.includes('public/app.js')));

    // Verifica mascaramento de .env
    assert.ok(snapshot.envKeys.some(k => k.startsWith('SCRAPECREATORS_API_KEY=')));
    assert.ok(!snapshot.envKeys.some(k => k.includes('123456789abcdef')), 'Chave secreta não pode vazar em texto puro');

    // Verifica logs da porta capturados
    assert.ok(snapshot.runtimeLogs.length >= 2);
    assert.ok(snapshot.runtimeLogs.some(l => l.includes('Express listening on port 3000')));

    // Verifica resumo de tabelas e contagem SQLite
    assert.ok(snapshot.sqliteSummary.length >= 1);
    const adsTable = snapshot.sqliteSummary[0]?.tables.find(t => t.name === 'ads');
    assert.ok(adsTable, 'Tabela ads deve ser detectada');
    assert.equal(adsTable.count, 2, 'Contagem de linhas deve ser 2');
  } finally {
    try {
      db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
    } catch {}
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('AgentBrainCouncilService: handleUserMessage executa reset de banco SQLite quando solicitado', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-council-reset-'));
  const projectId = `proj-reset-${crypto.randomUUID().slice(0, 8)}`;

  try {
    db.prepare(`
      INSERT INTO projects (id, name, path, status, created_at, updated_at)
      VALUES (?, ?, ?, 'ready', datetime('now'), datetime('now'))
    `).run(projectId, 'Projeto Reset Teste', tmpDir);

    // Cria banco SQLite físico
    const dbDir = path.join(tmpDir, 'data');
    fs.mkdirSync(dbDir, { recursive: true });
    fs.writeFileSync(path.join(dbDir, 'app.db'), 'sqlite-binary-data');
    fs.writeFileSync(path.join(dbDir, 'app.db-wal'), 'sqlite-wal-data');

    assert.ok(fs.existsSync(path.join(dbDir, 'app.db')));

    // Envia mensagem pedindo para limpar/excluir o banco
    const result = await AgentBrainCouncilService.handleUserMessage({
      projectId,
      projectPath: tmpDir,
      content: 'quando eu clico em minerar não faz nada, exclua o banco e veja o que está acontecendo',
      agent: 'council'
    });

    assert.ok(result.success, 'handleUserMessage deve retornar sucesso');
    assert.equal(result.actionsExecuted?.databaseReset, true, 'databaseReset deve ser verdadeiro');
    assert.ok(!fs.existsSync(path.join(dbDir, 'app.db')), 'Arquivo de banco deve ter sido excluído fisicamente');

    // Verifica se as mensagens foram gravadas no banco com agent_role
    const savedMessages = db.prepare('SELECT role, content, agent_role FROM messages WHERE project_id = ?').all(projectId) as any[];
    assert.ok(savedMessages.length >= 2, 'Deve ter gravado mensagem do usuário e do conselho');
    assert.ok(savedMessages.some(m => m.agent_role === 'supervisor'), 'Deve ter gravado resposta do Supervisor');
    assert.ok(savedMessages.some(m => m.agent_role === 'worker'), 'Deve ter gravado resposta do Worker');
  } finally {
    try {
      db.prepare('DELETE FROM messages WHERE project_id = ?').run(projectId);
      db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
    } catch {}
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('AgentBrainCouncilService: modo de agente único direciona apenas ao agente solicitado', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-single-agent-'));
  const projectId = `proj-single-${crypto.randomUUID().slice(0, 8)}`;

  try {
    db.prepare(`
      INSERT INTO projects (id, name, path, status, created_at, updated_at)
      VALUES (?, ?, ?, 'ready', datetime('now'), datetime('now'))
    `).run(projectId, 'Projeto Agente Único', tmpDir);

    fs.writeFileSync(path.join(tmpDir, 'server.js'), 'console.log("running");');

    const result = await AgentBrainCouncilService.handleUserMessage({
      projectId,
      projectPath: tmpDir,
      content: '@worker corrija o manipulador da rota /api/mine',
      agent: 'worker'
    });

    assert.ok(result.success);
    assert.equal(result.targetAgent, 'worker');
    assert.equal(result.allReplies.length, 1, 'Modo direto deve emitir exatamente 1 resposta do agente alvo');
    assert.equal(result.primaryReply.agent_role, 'worker');

    const saved = db.prepare("SELECT * FROM messages WHERE project_id = ? AND agent_role = 'worker'").all(projectId) as any[];
    assert.equal(saved.length, 1);
  } finally {
    try {
      db.prepare('DELETE FROM messages WHERE project_id = ?').run(projectId);
      db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
    } catch {}
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('HierarchicalOrchestrationService: NUNCA gera planos estáticos de 36 etapas em instruções sem fases', () => {
  const briefing = 'quando eu clico em minerar não faz nada, veja o que está acontecendo e arrume a rota';
  const tasks = HierarchicalOrchestrationService.generateMultiPassPlannedTasks({
    briefing,
    projectName: 'ViralSearch',
    projectPath: 'C:\\IA\\Projetos\\ViralSearch'
  });

  assert.ok(tasks.length > 0, 'Deve gerar tarefas');
  assert.ok(tasks.length <= 4, `Esperado plano enxuto (1 a 4 tarefas), mas recebeu ${tasks.length} tarefas!`);
  assert.notEqual(tasks.length, 36, 'PROIBIDO gerar 36 etapas estáticas em instrução do chat!');

  const titles = tasks.map(t => t.title).join(' ');
  assert.ok(!titles.includes('Infra Dual-Mode DOCSIMP e Cloud Deploy Pack'), 'Não deve conter template estático de GT-1');
});
