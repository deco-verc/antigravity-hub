import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { apiRouter } from '../src/routes.js';
import { SseStreamService } from '../src/sseStreamService.js';
import { ObservabilityService } from '../src/observability/observabilityService.js';
import { db } from '../src/db.js';
import { Server } from 'node:http';

describe('FASE 1: Streaming Reativo com Server-Sent Events (SSE)', () => {
  let server: Server;
  let baseUrl: string;
  const testProjectId = 'test-sse-proj-' + Date.now();

  before(async () => {
    // Iniciar servidor express de testes
    const app = express();
    app.use(express.json());
    app.use('/api', apiRouter);

    server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    const port = (server.address() as any).port;
    baseUrl = `http://127.0.0.1:${port}/api`;

    // Criar projeto no banco para testes
    const nowIso = new Date().toISOString();
    db.prepare(`
      INSERT OR REPLACE INTO projects (id, name, path, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(testProjectId, 'Projeto Teste SSE', 'C:\\dummy\\sse-test', 'Teste SSE', nowIso, nowIso);
  });

  after(() => {
    SseStreamService.resetForTesting();
    if (server) server.close();
  });

  beforeEach(() => {
    SseStreamService.resetForTesting();
    SseStreamService.initialize();
  });

  it('1. SseStreamService: Gerencia registro de clientes, broadcast e heartbeat', () => {
    const writtenData: string[] = [];
    const mockRes: any = {
      setHeader: () => {},
      flushHeaders: () => {},
      write: (chunk: string) => { writtenData.push(chunk); },
      on: () => {}
    };

    assert.equal(SseStreamService.hasClients('proj-1'), false);
    SseStreamService.addClient('proj-1', mockRes);
    assert.equal(SseStreamService.hasClients('proj-1'), true);
    assert.equal(SseStreamService.getClientCount('proj-1'), 1);

    // Initial connected event was sent
    assert.ok(writtenData.some(d => d.includes('event: connected')));

    // Broadcast message
    SseStreamService.broadcast('proj-1', 'activity', { status: 'running' });
    assert.ok(writtenData.some(d => d.includes('event: activity') && d.includes('"status":"running"')));

    // Heartbeat ping
    SseStreamService.sendHeartbeat();
    assert.ok(writtenData.some(d => d === ': ping\n\n'));

    // Remove client
    SseStreamService.removeClient('proj-1', mockRes);
    assert.equal(SseStreamService.hasClients('proj-1'), false);
  });

  it('2. ObservabilityService: Emissão de eventos é automaticamente transmitida para o canal SSE', () => {
    const channelLogs: any[] = [];
    const mockRes: any = {
      setHeader: () => {},
      flushHeaders: () => {},
      write: (chunk: string) => {
        if (chunk.includes('event: log')) {
          const match = chunk.match(/data: (.*)\n\n/);
          if (match) channelLogs.push(JSON.parse(match[1]));
        }
      },
      on: () => {}
    };

    SseStreamService.addClient(testProjectId, mockRes);

    // Emit event with projectId
    ObservabilityService.emit({
      projectId: testProjectId,
      service: 'test-service',
      message: 'Mensagem de teste de observabilidade SSE',
      level: 'INFO'
    });

    assert.ok(channelLogs.length > 0);
    assert.ok(channelLogs.some(l => l.message === 'Mensagem de teste de observabilidade SSE'));

    SseStreamService.removeClient(testProjectId, mockRes);
  });

  it('3. GET /api/projects/:id/stream abre conexão SSE com headers corretos', async () => {
    const controller = new AbortController();
    const res = await fetch(`${baseUrl}/projects/${testProjectId}/stream`, {
      signal: controller.signal
    });

    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'text/event-stream');
    assert.ok(res.headers.get('cache-control')?.includes('no-cache'));
    assert.equal(res.headers.get('connection'), 'keep-alive');

    // Abort client connection
    controller.abort();
  });

  it('4. GET /api/metachat/stream abre conexão SSE com headers corretos', async () => {
    const controller = new AbortController();
    const res = await fetch(`${baseUrl}/metachat/stream`, {
      signal: controller.signal
    });

    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'text/event-stream');
    assert.ok(res.headers.get('cache-control')?.includes('no-cache'));

    controller.abort();
  });

  it('5. POST /api/projects/:id/messages com X-Stream-Mode retorna 202 com turnId imediatamente', async () => {
    const res = await fetch(`${baseUrl}/projects/${testProjectId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Stream-Mode': 'sse'
      },
      body: JSON.stringify({
        content: 'Nova instrução reativa via SSE',
        stream: true
      })
    });

    assert.equal(res.status, 202);
    const data: any = await res.json();
    assert.equal(data.success, true);
    assert.ok(data.turnId);
    assert.equal(data.status, 'accepted');
    assert.ok(data.userMessage);
    assert.equal(data.userMessage.content, 'Nova instrução reativa via SSE');
  });

  it('6. POST /api/metachat/chat com stream: true retorna 202 com turnId imediatamente', async () => {
    const res = await fetch(`${baseUrl}/metachat/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Stream-Mode': 'sse'
      },
      body: JSON.stringify({
        message: 'Instrução do Meta-Chat com streaming reativo',
        stream: true
      })
    });

    assert.equal(res.status, 202);
    const data: any = await res.json();
    assert.equal(data.success, true);
    assert.ok(data.turnId);
    assert.equal(data.status, 'accepted');
  });
});
