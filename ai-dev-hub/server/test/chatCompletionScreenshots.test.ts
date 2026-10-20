// server/test/chatCompletionScreenshots.test.ts
// Testes automatizados da FASE 14:
// - Entrega Automática de Screenshots do Playwright no Chat do DecoHUB ao Concluir o Pedido
// - Idempotência por runId (chamadas repetidas nunca duplicam mensagens)
// - Servir arquivos .png via rota segura /api/projects/:id/evidence-file/:filename com Content-Type correto

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import http from 'node:http';
import express from 'express';
import { db } from '../src/db.js';
import { apiRouter } from '../src/routes.js';
import { ProjectOperationsService } from '../src/projectOperationsService.js';
import { AutonomousRunnerService } from '../src/autonomousRunnerService.js';

describe('FASE 14: Entrega Automática de Screenshots do Playwright no Chat', () => {
  let tempTestDir: string;
  let projectId: string;
  let runId: string;
  let samplePngBuffer: Buffer;
  let server: http.Server;
  let serverPort: number;

  before(async () => {
    // 1. Diretório temporário do projeto isolado
    tempTestDir = path.join(os.tmpdir(), `decohub-chat-evidence-test-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`);
    const evidenceDir = path.join(tempTestDir, '.ai-dev-hub', 'evidence');
    fs.mkdirSync(evidenceDir, { recursive: true });

    // 2. Criar mock de PNG válido (1x1 transparent PNG)
    samplePngBuffer = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
      'base64'
    );

    fs.writeFileSync(path.join(evidenceDir, '01-initial-load.png'), samplePngBuffer);
    fs.writeFileSync(path.join(evidenceDir, '02-after-user-interaction.png'), samplePngBuffer);
    fs.writeFileSync(path.join(evidenceDir, '03-after-f5-reload.png'), samplePngBuffer);

    // Relatórios de homologação
    fs.writeFileSync(
      path.join(evidenceDir, 'user-journey-report.json'),
      JSON.stringify({
        passed: true,
        score: 100,
        summary: 'Jornada interativa concluída sem erros e com dados persistidos no F5.'
      }, null, 2)
    );

    fs.writeFileSync(
      path.join(evidenceDir, 'security-pentest-report.json'),
      JSON.stringify({
        passed: true,
        score: 100,
        summary: 'Blindagem ofensiva OWASP Top 10 validada com sucesso.'
      }, null, 2)
    );

    fs.writeFileSync(
      path.join(evidenceDir, 'visual-inspection-report.json'),
      JSON.stringify({
        passed: true,
        score: 100,
        details: 'Design Linear/Raycast dark mode validado com tokens semânticos.'
      }, null, 2)
    );

    // 3. Cadastrar projeto e run no banco de dados SQLite
    projectId = `proj-evidence-${Date.now()}`;
    runId = `run-evidence-${Date.now()}`;
    const nowIso = new Date().toISOString();

    db.prepare(`
      INSERT INTO projects (id, name, path, objective, created_at, updated_at)
      VALUES (?, 'Projeto Homologação Visual Chat', ?, 'Validar entrega de screenshots no chat', ?, ?)
    `).run(projectId, tempTestDir, nowIso, nowIso);

    db.prepare(`
      INSERT INTO autonomous_runs (id, project_id, name, objective, status, start_time, created_at, updated_at)
      VALUES (?, ?, 'Ciclo de Entrega Visual', 'Finalizar tarefas com selos e screenshots', 'running', ?, ?, ?)
    `).run(runId, projectId, nowIso, nowIso, nowIso);

    db.prepare(`
      INSERT INTO autonomous_tasks (id, run_id, title, description, status, created_at, updated_at)
      VALUES (?, ?, 'Task UI-1 (Enterprise App Shell)', 'Construir shell', 'completed', ?, ?)
    `).run(crypto.randomUUID(), runId, nowIso, nowIso);

    db.prepare(`
      INSERT INTO autonomous_tasks (id, run_id, title, description, status, created_at, updated_at)
      VALUES (?, ?, 'Task UI-2 (BI Analytics)', 'Construir dashboards', 'completed', ?, ?)
    `).run(crypto.randomUUID(), runId, nowIso, nowIso);

    // 4. Iniciar servidor Express de teste para validar a rota de evidence-file
    const app = express();
    app.use(express.json());
    app.use('/api', apiRouter);

    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as any;
        serverPort = addr.port;
        resolve();
      });
    });
  });

  after(async () => {
    try {
      if (server) {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
      db.prepare('DELETE FROM messages WHERE project_id = ?').run(projectId);
      db.prepare('DELETE FROM autonomous_tasks WHERE run_id = ?').run(runId);
      db.prepare('DELETE FROM autonomous_runs WHERE id = ?').run(runId);
      db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
      if (fs.existsSync(tempTestDir)) {
        fs.rmSync(tempTestDir, { recursive: true, force: true });
      }
    } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "chatCompletionScreenshots.test",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:chatCompletionScreenshots.test]", err);
      }
    }
  });

  it('1. Deve registrar automaticamente a mensagem de conclusão no chat com screenshots e 4 selos de homologação', async () => {
    const result = await ProjectOperationsService.postCompletionVisualSummaryToChat(projectId, runId);
    assert.equal(result.posted, true);
    assert.ok(result.messageId);

    // Verificar se a mensagem foi persistida na tabela `messages`
    const message: any = db.prepare('SELECT * FROM messages WHERE id = ?').get(result.messageId);
    assert.ok(message);
    assert.equal(message.project_id, projectId);
    assert.equal(message.role, 'assistant');

    // Validar conteúdo textual da mensagem
    assert.ok(message.content.includes('Pedido Concluído e Homologado com Sucesso'));
    assert.ok(message.content.includes('Dev Tests'));
    assert.ok(message.content.includes('UI Anti-Slop'));
    assert.ok(message.content.includes('User Journey F5'));
    assert.ok(message.content.includes('AppSec Pentest'));

    // Validar referências de imagens Markdown
    assert.ok(message.content.includes(`/api/projects/${projectId}/evidence-file/01-initial-load.png`));
    assert.ok(message.content.includes(`/api/projects/${projectId}/evidence-file/02-after-user-interaction.png`));
    assert.ok(message.content.includes(`/api/projects/${projectId}/evidence-file/03-after-f5-reload.png`));

    // Validar estrutura rica de metadata
    const metadata = JSON.parse(message.metadata);
    assert.equal(metadata.type, 'run_completion');
    assert.equal(metadata.runId, runId);
    assert.equal(metadata.overallPassed, true);
    assert.equal(metadata.overallScore, 100);
    assert.ok(Array.isArray(metadata.badges));
    assert.equal(metadata.badges.length, 4);

    assert.ok(Array.isArray(metadata.screenshots));
    assert.equal(metadata.screenshots.length, 3);
    assert.equal(metadata.screenshots[0].filename, '01-initial-load.png');
    assert.ok(metadata.screenshots[0].url.includes(`/api/projects/${projectId}/evidence-file/01-initial-load.png`));
  });

  it('2. A chamada a postCompletionVisualSummaryToChat deve ser estritamente idempotente por runId', async () => {
    // Chamar novamente com o mesmo runId
    const secondCall = await ProjectOperationsService.postCompletionVisualSummaryToChat(projectId, runId);
    assert.equal(secondCall.posted, false);
    assert.equal(secondCall.reason, 'ALREADY_POSTED');

    // Chamar também pelo wrapper do AutonomousRunnerService
    const thirdCall = await AutonomousRunnerService.postCompletionVisualSummaryToChat(projectId, runId);
    assert.equal(thirdCall.posted, false);
    assert.equal(thirdCall.reason, 'ALREADY_POSTED');

    // Confirmar que existe exatamente 1 mensagem no banco de dados para este run
    const messages: any[] = db.prepare('SELECT * FROM messages WHERE project_id = ?').all(projectId);
    assert.equal(messages.length, 1);
  });

  it('3. A rota /api/projects/:id/evidence-file/:filename deve servir os arquivos .png referenciados com Content-Type image/png', async () => {
    const url = `http://127.0.0.1:${serverPort}/api/projects/${projectId}/evidence-file/01-initial-load.png`;

    const response = await new Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
      http.get(url, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode || 0,
            headers: res.headers,
            body: Buffer.concat(chunks)
          });
        });
      }).on('error', reject);
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['content-type'], 'image/png');
    assert.equal(response.headers['cache-control'], 'no-cache, no-store, must-revalidate');
    assert.equal(response.headers['pragma'], 'no-cache');
    assert.equal(response.body.length, samplePngBuffer.length);
    assert.deepEqual(response.body, samplePngBuffer);
  });

  it('4. Deve enriquecer mensagens legadas sem screenshots in-place sem duplicar registros no SQLite', async () => {
    const legacyRunId = `run-legacy-${Date.now()}`;
    const legacyMsgId = crypto.randomUUID();

    // Inserir mensagem de conclusão legada (sem screenshots)
    db.prepare(`
      INSERT INTO messages (id, project_id, role, content, created_at, metadata)
      VALUES (?, ?, 'assistant', 'Ciclo Concluído (Legado sem imagens)', datetime('now'), ?)
    `).run(legacyMsgId, projectId, JSON.stringify({ type: 'run_completion', runId: legacyRunId }));

    // Executar postCompletionVisualSummaryToChat
    const res = await ProjectOperationsService.postCompletionVisualSummaryToChat(projectId, legacyRunId);
    assert.equal(res.posted, true);
    assert.equal(res.messageId, legacyMsgId, 'Deve atualizar o mesmo ID da mensagem legada');

    // Verificar se a mensagem foi enriquecida com os screenshots
    const updated: any = db.prepare('SELECT * FROM messages WHERE id = ?').get(legacyMsgId);
    const meta = JSON.parse(updated.metadata);
    assert.ok(Array.isArray(meta.screenshots));
    assert.equal(meta.screenshots.length, 3);
    assert.ok(updated.content.includes('Pedido Concluído e Homologado com Sucesso'));

    // Chamar novamente deve respeitar idempotência e retornar ALREADY_POSTED
    const secondCall = await ProjectOperationsService.postCompletionVisualSummaryToChat(projectId, legacyRunId);
    assert.equal(secondCall.posted, false);
    assert.equal(secondCall.reason, 'ALREADY_POSTED');

    // Limpeza
    db.prepare('DELETE FROM messages WHERE id = ?').run(legacyMsgId);
  });
});

