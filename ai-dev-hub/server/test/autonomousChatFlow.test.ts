import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { db } from '../src/db.js';
import { ProjectOperationsService } from '../src/projectOperationsService.js';
import { AutonomousRunnerService } from '../src/autonomousRunnerService.js';

test('Fluxo Conversacional Autônomo: Output 1 e Output 2 com eliminação total de frases estáticas', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-chat-flow-test-'));
  const projectId = `proj-chat-flow-${Date.now()}`;
  const runId = `run-chat-flow-${Date.now()}`;
  const nowIso = new Date().toISOString();

  // Cria estrutura mínima de projeto no diretório temporário
  fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'test-app', version: '1.0.0' }));
  fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'src', 'server.ts'), '// Server file');
  fs.writeFileSync(path.join(tmpDir, 'src', 'index.ts'), '// Index file');

  try {
    // 1. Cadastra projeto e run no banco SQLite
    db.prepare(`
      INSERT INTO projects (id, name, path, objective, stack, created_at, updated_at)
      VALUES (?, 'Test App Chat Flow', ?, 'Testar fluxo conversacional autônomo', 'Full-Stack (Node.js)', ?, ?)
    `).run(projectId, tmpDir, nowIso, nowIso);

    db.prepare(`
      INSERT INTO autonomous_runs (id, project_id, name, objective, status, start_time, created_at, updated_at)
      VALUES (?, ?, 'Run Chat Flow Test', 'Corrigir botão de minerar e limpar o banco', 'running', ?, ?, ?)
    `).run(runId, projectId, nowIso, nowIso, nowIso);

    const task1Id = crypto.randomUUID();
    const task2Id = crypto.randomUUID();

    db.prepare(`
      INSERT INTO autonomous_tasks (id, run_id, title, description, status, order_index, created_at, updated_at)
      VALUES (?, ?, 'Task 1: Limpeza do Banco', 'Remover banco SQLite para zerar o estado', 'completed', 1, ?, ?)
    `).run(task1Id, runId, nowIso, nowIso);

    db.prepare(`
      INSERT INTO autonomous_tasks (id, run_id, title, description, status, order_index, created_at, updated_at)
      VALUES (?, ?, 'Task 2: Correção do Botão', 'Corrigir manipulador da rota de mineração', 'completed', 2, ?, ?)
    `).run(task2Id, runId, nowIso, nowIso);

    // Registra builder_report com arquivos modificados
    db.prepare(`
      INSERT INTO builder_reports (id, task_id, run_id, status, files_changed_json, created_at)
      VALUES (?, ?, ?, 'success', ?, ?)
    `).run(crypto.randomUUID(), task2Id, runId, JSON.stringify(['src/server.ts', 'src/routes/mine.ts']), nowIso);

    // =========================================================================
    // ETAPA 1: Validar Output 1 (generateInitialDiagnosticMessage)
    // =========================================================================
    await t.test('Output 1: Deve gerar diagnóstico técnico contextual sem frase estática fixa', async () => {
      const mockRun = {
        id: runId,
        tasks: [
          { title: 'Limpeza do Banco', description: 'Remover banco SQLite antigo' },
          { title: 'Correção da Mineração', description: 'Ajustar rota de mineração' }
        ]
      };

      const userInstruction = 'quando eu clico em minerar ele não faz nada, exclua o banco e veja o que está acontecendo';
      const output1 = await ProjectOperationsService.generateInitialDiagnosticMessage(projectId, tmpDir, userInstruction, mockRun);

      // Asserções obrigatórias de conteúdo técnico real
      assert.ok(output1.includes('### 🧠 Diagnóstico Inicial & Plano de Ação Autônomo'), 'Deve conter cabeçalho de diagnóstico');
      assert.ok(output1.includes('Arquitetura Detectada'), 'Deve conter arquitetura');
      assert.ok(output1.includes('Status do Servidor / Porta'), 'Deve conter status da porta');
      assert.ok(output1.includes('Limpeza de banco de dados SQLite identificada'), 'Deve detectar pedido de reset do banco');
      assert.ok(output1.includes('Plano de Execução Imediata'), 'Deve listar plano de execução');
      assert.ok(output1.includes('Etapa 1 (Limpeza do Banco)'), 'Deve listar a etapa 1');
      assert.ok(output1.includes('Etapa 2 (Correção da Mineração)'), 'Deve listar a etapa 2');

      // PROIBIDO conter a frase estática antiga
      assert.equal(output1.includes('Estou organizando o trabalho em etapas e verificando as dependências'), false, 'NÃO pode conter a frase genérica antiga');
      assert.equal(output1.includes('Criei um plano com'), false, 'NÃO pode conter texto antigo');
    });

    // =========================================================================
    // ETAPA 2: Validar Output 2 de Conclusão (postExecutionReportToProjectChat - completed)
    // =========================================================================
    await t.test('Output 2 (Completed): Deve publicar relatório final detalhado no chat com arquivos modificados e 4 selos', async () => {
      const result = await ProjectOperationsService.postExecutionReportToProjectChat(projectId, runId, 'completed');
      assert.equal(result.posted, true);
      assert.ok(result.messageId);

      const msg: any = db.prepare('SELECT * FROM messages WHERE id = ?').get(result.messageId);
      assert.ok(msg);
      assert.equal(msg.project_id, projectId);
      assert.equal(msg.role, 'assistant');

      // Validar conteúdo técnico obrigatório
      assert.ok(msg.content.includes('### ✅ Pedido Concluído e Homologado com Sucesso!'));
      assert.ok(msg.content.includes('#### 📝 Resumo do que foi Executado:'));
      assert.ok(msg.content.includes('Task 1: Limpeza do Banco'));
      assert.ok(msg.content.includes('Task 2: Correção do Botão'));
      assert.ok(msg.content.includes('#### 📂 Arquivos Modificados / Criados:'));
      assert.ok(msg.content.includes('`src/server.ts`'));
      assert.ok(msg.content.includes('`src/routes/mine.ts`'));
      assert.ok(msg.content.includes('#### 🔍 Validação, Testes & Porta da Aplicação:'));
      assert.ok(msg.content.includes('Homologado em 4 Camadas'));
      assert.ok(msg.content.includes('Dev Tests'));
      assert.ok(msg.content.includes('UI Anti-Slop'));
      assert.ok(msg.content.includes('User Journey F5'));
      assert.ok(msg.content.includes('AppSec Pentest'));

      // Validar metadados ricos
      const meta = JSON.parse(msg.metadata);
      assert.equal(meta.type, 'run_completion');
      assert.equal(meta.outcome, 'completed');
      assert.equal(meta.runId, runId);
      assert.equal(meta.overallPassed, true);
      assert.ok(meta.filesChanged.includes('src/server.ts'));
      assert.ok(meta.filesChanged.includes('src/routes/mine.ts'));

      // Testar idempotência
      const repeat = await ProjectOperationsService.postExecutionReportToProjectChat(projectId, runId, 'completed');
      assert.equal(repeat.posted, false);
      assert.equal(repeat.reason, 'ALREADY_POSTED');

      // Wrapper em AutonomousRunnerService também deve respeitar idempotência
      const wrapperRepeat = await AutonomousRunnerService.postExecutionReportToProjectChat(projectId, runId, 'completed');
      assert.equal(wrapperRepeat.posted, false);
      assert.equal(wrapperRepeat.reason, 'ALREADY_POSTED');
    });

    // =========================================================================
    // ETAPA 3: Validar Output 2 de Erro/Interrupção (postExecutionReportToProjectChat - error)
    // =========================================================================
    await t.test('Output 2 (Error): Deve publicar relatório de falha com diagnóstico e etapas concluídas', async () => {
      const errorRunId = `run-error-${Date.now()}`;
      db.prepare(`
        INSERT INTO autonomous_runs (id, project_id, name, objective, status, last_error, start_time, created_at, updated_at)
        VALUES (?, ?, 'Run Com Erro', 'Testar relatório de erro', 'error', 'SINTAXE_INVALIDA: erro de compilação em mine.ts:25', ?, ?, ?)
      `).run(errorRunId, projectId, nowIso, nowIso, nowIso);

      const errResult = await ProjectOperationsService.postExecutionReportToProjectChat(
        projectId,
        errorRunId,
        'error',
        'SINTAXE_INVALIDA: erro de compilação em mine.ts:25'
      );
      assert.equal(errResult.posted, true);
      assert.ok(errResult.messageId);

      const errMsg: any = db.prepare('SELECT * FROM messages WHERE id = ?').get(errResult.messageId);
      assert.ok(errMsg);
      assert.ok(errMsg.content.includes('### ⚠️ Relatório de Execução Interrompida'));
      assert.ok(errMsg.content.includes('#### ⚠️ Diagnóstico da Falha:'));
      assert.ok(errMsg.content.includes('SINTAXE_INVALIDA: erro de compilação em mine.ts:25'));

      const errMeta = JSON.parse(errMsg.metadata);
      assert.equal(errMeta.type, 'execution_report');
      assert.equal(errMeta.outcome, 'error');
      assert.equal(errMeta.runId, errorRunId);
    });

  } finally {
    // Limpeza
    db.prepare('DELETE FROM builder_reports WHERE run_id LIKE ?').run(`%${projectId}%`);
    db.prepare('DELETE FROM messages WHERE project_id = ?').run(projectId);
    db.prepare('DELETE FROM autonomous_tasks WHERE run_id LIKE ?').run(`%${projectId}%`);
    db.prepare('DELETE FROM autonomous_runs WHERE project_id = ?').run(projectId);
    db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
