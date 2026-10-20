import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Sanitizer } from '../src/observability/sanitizer.js';
import { TraceContextManager } from '../src/observability/context.js';
import { ObservabilityService } from '../src/observability/observabilityService.js';
import { RotatingFileLogger } from '../src/observability/fileLogger.js';
import { Logger } from '../src/logger.js';
import { db } from '../src/db.js';
import { DiagnosticService } from '../src/observability/diagnosticService.js';

describe('Observability & Diagnostic System — Core Suite', () => {
  let tempLogsDir: string;
  let testFileLogger: RotatingFileLogger;

  before(() => {
    tempLogsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-test-obs-logs-'));
    testFileLogger = new RotatingFileLogger({
      logsDir: tempLogsDir,
      maxSizeBytes: 1024 * 1024,
      maxRotations: 3,
      enabled: true
    });
    ObservabilityService.setFileLogger(testFileLogger);

    const nowIso = new Date().toISOString();
    db.prepare(`
      INSERT OR IGNORE INTO projects (id, name, path, status, created_at, updated_at)
      VALUES ('test-proj', 'Test Project', 'C:/tmp/test-proj', 'active', ?, ?)
    `).run(nowIso, nowIso);
    db.prepare(`
      INSERT OR IGNORE INTO workers (id, name, created_at, updated_at)
      VALUES ('worker-1', 'Test Worker', ?, ?)
    `).run(nowIso, nowIso);
  });

  after(() => {
    try {
      if (fs.existsSync(tempLogsDir)) {
        fs.rmSync(tempLogsDir, { recursive: true, force: true });
      }
    } catch {}
  });

  describe('1. Sanitizer Security & Privacy Guard', () => {
    it('redacts Google API keys and GitHub tokens from strings', () => {
      const raw = 'Key: AIzaSyA1234567890abcdef1234567890abcdef, GitHub: ghp_1234567890abcdef1234567890abcdef1234';
      const clean = Sanitizer.sanitizeString(raw);
      assert.ok(!clean.includes('AIzaSyA1234567890abcdef1234567890abcdef'));
      assert.ok(clean.includes('AIza[REDACTED_GOOGLE_KEY]'));
      assert.ok(!clean.includes('ghp_1234567890abcdef1234567890abcdef1234'));
      assert.ok(clean.includes('gh*_[REDACTED_GITHUB_TOKEN]'));
    });

    it('redacts Bearer tokens and Authorization headers', () => {
      const raw = 'Header: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-ID1234567890abcdef';
      const clean = Sanitizer.sanitizeString(raw);
      assert.ok(!clean.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'));
      assert.ok(clean.includes('Bearer [REDACTED_TOKEN]'));
    });

    it('redacts passwords, secret parameters and cookies', () => {
      const raw = 'mysql://user:password123@localhost?secret=myTopSecretKey&cookie=session_id=abc123xyz';
      const clean = Sanitizer.sanitizeString(raw);
      assert.ok(!clean.includes('password123'));
      assert.ok(!clean.includes('myTopSecretKey'));
    });

    it('deep-sanitizes nested object keys and values', () => {
      const obj = {
        config: {
          apiKey: 'AIzaSySecretKeyHere1234567890abcdef',
          password: 'super_secret_password',
          publicSetting: 'enabled'
        },
        items: ['Bearer token-here-12345678', 'normal-value']
      };
      const clean: any = Sanitizer.sanitize(obj);
      assert.equal(clean.config.apiKey, '[REDACTED_SENSITIVE_FIELD]');
      assert.equal(clean.config.password, '[REDACTED_SENSITIVE_FIELD]');
      assert.equal(clean.config.publicSetting, 'enabled');
      assert.ok(clean.items[0].includes('Bearer [REDACTED_TOKEN]'));
      assert.equal(clean.items[1], 'normal-value');
    });

    it('handles circular object references without crashing', () => {
      const a: any = { name: 'node A' };
      const b: any = { name: 'node B', parent: a };
      a.child = b;

      const clean: any = Sanitizer.sanitize(a);
      assert.equal(clean.name, 'node A');
      assert.equal(clean.child.name, 'node B');
      assert.equal(clean.child.parent, '[CIRCULAR_REFERENCE]');
    });

    it('formats error with stack and cause, determining retryable status', () => {
      const cause = new Error('Connection reset');
      const err = new Error('Request to Antigravity API failed: ETIMEDOUT');
      err.cause = cause;
      (err as any).code = 'ETIMEDOUT';

      const formatted = Sanitizer.formatError(err);
      assert.equal(formatted.name, 'Error');
      assert.ok(formatted.message.includes('ETIMEDOUT'));
      assert.equal(formatted.code, 'ETIMEDOUT');
      assert.equal(formatted.retryable, true);
      assert.ok(formatted.stack?.includes('Error: Request to Antigravity API failed'));
      assert.ok(formatted.cause?.includes('Connection reset'));
    });

    it('summarizes prompt metadata without logging unlimited raw prompt text', () => {
      const longPrompt = 'A'.repeat(500) + ' secret_token=ghp_1234567890abcdef1234567890abcdef1234';
      const summary = Sanitizer.summarizePrompt(longPrompt, 200);
      assert.equal(summary.length, longPrompt.length);
      assert.ok(summary.hash.length >= 8);
      assert.ok(summary.summary.length <= 250);
      assert.ok(summary.summary.includes(`[Total ${longPrompt.length} chars]`));
    });
  });

  describe('2. Trace Context & End-to-End Correlation', () => {
    it('creates root trace context and retrieves via ambient storage', () => {
      const root = TraceContextManager.createRootContext({
        runId: 'run-100',
        projectId: 'proj-alpha',
        service: 'runner'
      });

      assert.ok(root.traceId.startsWith('trace-'));
      assert.equal(root.correlationId, root.traceId);
      assert.ok(root.spanId.startsWith('span-'));
      assert.equal(root.runId, 'run-100');

      TraceContextManager.run(root, () => {
        const active = TraceContextManager.getActiveContext();
        assert.ok(active);
        assert.equal(active?.traceId, root.traceId);
        assert.equal(active?.runId, 'run-100');
        assert.equal(active?.projectId, 'proj-alpha');
      });

      // Outside context, storage is undefined
      assert.equal(TraceContextManager.getActiveContext(), undefined);
    });

    it('creates child span linked to parent span', () => {
      const root = TraceContextManager.createRootContext({
        runId: 'run-parent',
        taskId: 'task-01'
      });

      TraceContextManager.run(root, () => {
        TraceContextManager.runInChildSpan({ taskId: 'task-02', service: 'builder' }, () => {
          const child = TraceContextManager.getActiveContext();
          assert.ok(child);
          assert.equal(child?.traceId, root.traceId);
          assert.equal(child?.correlationId, root.correlationId);
          assert.notEqual(child?.spanId, root.spanId);
          assert.equal(child?.parentSpanId, root.spanId);
          assert.equal(child?.taskId, 'task-02');
          assert.equal(child?.service, 'builder');
        });
      });
    });
  });

  describe('3. ObservabilityService Persistence & Querying', () => {
    const testRunId = `run-test-${Date.now()}`;
    const testTaskId = `task-test-${Date.now()}`;

    it('emits structured events and persists to SQLite observability_events', () => {
      const event = ObservabilityService.emit({
        level: 'INFO',
        event: 'run.started',
        message: 'Execução autônoma iniciada para testes',
        service: 'runner',
        runId: testRunId,
        metadata: { config: { maxCycles: 10 } }
      });

      assert.ok(event.id.startsWith('obs-'));
      assert.equal(event.event, 'run.started');
      assert.equal(event.runId, testRunId);

      const queried = ObservabilityService.getEventById(event.id);
      assert.ok(queried);
      assert.equal(queried?.id, event.id);
      assert.equal(queried?.event, 'run.started');
      assert.equal(queried?.metadata?.config?.maxCycles, 10);
    });

    it('automatically inherits ambient trace context when emitting', () => {
      const rootContext = TraceContextManager.createRootContext({
        runId: testRunId,
        taskId: testTaskId,
        service: 'supervisor'
      });

      let emittedEventId = '';
      TraceContextManager.run(rootContext, () => {
        const ev = ObservabilityService.emit({
          level: 'DEBUG',
          event: 'supervisor.plan_generated',
          message: 'Supervisor gerou 3 tarefas no plano'
        });
        emittedEventId = ev.id;
        assert.equal(ev.traceId, rootContext.traceId);
        assert.equal(ev.spanId, rootContext.spanId);
        assert.equal(ev.runId, testRunId);
        assert.equal(ev.taskId, testTaskId);
        assert.equal(ev.service, 'supervisor');
      });

      const retrieved = ObservabilityService.getEventById(emittedEventId);
      assert.ok(retrieved);
      assert.equal(retrieved?.traceId, rootContext.traceId);
      assert.equal(retrieved?.runId, testRunId);
    });

    it('reconstructs chronological timeline for a specific Run', () => {
      // Emit chronological sequence
      ObservabilityService.emit({ level: 'INFO', event: 'task.dispatched', message: 'Task despachada para worker', runId: testRunId, taskId: testTaskId });
      ObservabilityService.emit({ level: 'INFO', event: 'agent.native_call_started', message: 'Chamada nativa iniciada', runId: testRunId, taskId: testTaskId });
      ObservabilityService.emit({ level: 'INFO', event: 'agent.native_call_completed', message: 'Chamada nativa concluída com sucesso', runId: testRunId, taskId: testTaskId, durationMs: 250 });
      ObservabilityService.emit({ level: 'INFO', event: 'evaluation.started', message: 'Avaliação independente iniciada', runId: testRunId, taskId: testTaskId });
      ObservabilityService.emit({ level: 'INFO', event: 'evaluation.completed', message: 'Avaliação independente PASS', runId: testRunId, taskId: testTaskId, status: 'PASS' });

      const timeline = ObservabilityService.getTimelineForRun(testRunId);
      assert.ok(timeline.length >= 6); // run.started + supervisor.plan + 5 new events
      assert.equal(timeline[0].event, 'run.started');
      const eventsList = timeline.map(t => t.event);
      assert.ok(eventsList.includes('task.dispatched'));
      assert.ok(eventsList.includes('agent.native_call_started'));
      assert.ok(eventsList.includes('evaluation.completed'));
    });

    it('queries events with pagination, level and search filters', () => {
      const res = ObservabilityService.queryEvents({
        runId: testRunId,
        limit: 3,
        offset: 0
      });

      assert.equal(res.limit, 3);
      assert.equal(res.offset, 0);
      assert.ok(res.total >= 6);
      assert.equal(res.events.length, 3);
    });

    it('groups errors and identifies recurrence frequency', () => {
      const err = new Error('Antigravity connection timeout');
      (err as any).code = 'ETIMEDOUT';

      ObservabilityService.emit({ level: 'ERROR', event: 'agent.native_call_failed', message: 'Falha na conexão com Antigravity', error: err, runId: testRunId });
      ObservabilityService.emit({ level: 'ERROR', event: 'agent.native_call_failed', message: 'Falha na conexão com Antigravity', error: err, runId: testRunId });

      const grouped = ObservabilityService.getGroupedErrors();
      const match = grouped.find(g => g.errorKey.includes('Antigravity connection timeout'));
      assert.ok(match);
      assert.ok(match.count >= 2);
    });

    it('exports events as valid sanitized JSON and JSONL', () => {
      const jsonExport = ObservabilityService.exportEvents({ runId: testRunId }, 'json');
      const parsed = JSON.parse(jsonExport);
      assert.ok(Array.isArray(parsed));
      assert.ok(parsed.length > 0);

      const jsonlExport = ObservabilityService.exportEvents({ runId: testRunId }, 'jsonl');
      const lines = jsonlExport.trim().split('\n');
      assert.ok(lines.length > 0);
      const firstLineParsed = JSON.parse(lines[0]);
      assert.ok(firstLineParsed.id);
    });

    it('provides system health report reflecting DB and file logger status', () => {
      const health = ObservabilityService.getHealthReport();
      assert.equal(health.databaseConnected, true);
      assert.ok(health.totalEventsCount > 0);
      assert.ok(health.fileLogger.filesCount > 0);
      assert.ok(['healthy', 'degraded'].includes(health.status));
    });
  });

  describe('4. Logger Backward Compatibility', () => {
    it('maintains Logger.info, Logger.warn, Logger.error and populates system_logs table', () => {
      const testMsg = `Log compatibilidade teste ${Date.now()}`;
      const ev = Logger.info(testMsg, { service: 'test_compat' });

      assert.ok(ev);
      assert.equal(ev.message, testMsg);

      // Verify legacy table system_logs was also written
      const legacyRow: any = db.prepare('SELECT * FROM system_logs WHERE message = ?').get(testMsg);
      assert.ok(legacyRow);
      assert.equal(legacyRow.level, 'info');

      // Verify Logger.getRecentLogs retrieves it
      const recent = Logger.getRecentLogs(10);
      assert.ok(recent.some(r => r.message === testMsg));
    });
  });

  describe('5. Diagnostic Engine & Anomaly Detection', () => {
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

    it('detects stalled run when run is inactive without lease or active turn', () => {
      const stalledRunId = `test-stalled-run-${Date.now()}`;
      db.prepare(`
        INSERT INTO autonomous_runs (id, project_id, name, objective, status, start_time, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(stalledRunId, 'test-proj', 'Stalled Run Test', 'Objetivo do Run', 'running', tenMinAgo, tenMinAgo, tenMinAgo);

      const anomalies = DiagnosticService.detectAnomalies({ stalledRunThresholdMs: 5000 });
      const found = anomalies.find(a => a.type === 'STALLED_RUN' && a.affectedEntity.id === stalledRunId);
      assert.ok(found, 'Deveria detectar STALLED_RUN');
      assert.equal(found.severity, 'high');
      assert.ok(found.evidence.length > 0);
      assert.ok(found.hypotheses.some(h => h.includes('[HIPÓTESE]')));
      assert.ok(found.recommendedAction.length > 0);
    });

    it('detects stalled in-progress task without active worker lease', () => {
      const stalledRunId = `test-run-task-${Date.now()}`;
      const stalledTaskId = `test-stalled-task-${Date.now()}`;
      db.prepare(`
        INSERT INTO autonomous_runs (id, project_id, name, objective, status, start_time, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(stalledRunId, 'test-proj', 'Run Test Task', 'Objetivo do Run', 'running', tenMinAgo, tenMinAgo, tenMinAgo);
      db.prepare(`
        INSERT INTO autonomous_tasks (id, run_id, title, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(stalledTaskId, stalledRunId, 'Task Sem Lease', 'in_progress', tenMinAgo, tenMinAgo);

      const taskAnomalies = DiagnosticService.detectAnomalies({ stalledTaskThresholdMs: 5000 });
      const taskFound = taskAnomalies.find(a => a.type === 'STALLED_TASK_WITHOUT_LEASE' && a.affectedEntity.id === stalledTaskId);
      assert.ok(taskFound, 'Deveria detectar STALLED_TASK_WITHOUT_LEASE');
      assert.equal(taskFound.severity, 'high');
      assert.ok(taskFound.hypotheses.some(h => h.includes('[HIPÓTESE]')));
    });

    it('detects stuck review task without supervisor review', () => {
      const revRunId = `test-run-rev-${Date.now()}`;
      const stuckReviewTaskId = `test-stuck-rev-${Date.now()}`;
      db.prepare(`
        INSERT INTO autonomous_runs (id, project_id, name, objective, status, start_time, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(revRunId, 'test-proj', 'Run Test Review', 'Objetivo do Run', 'reviewing', tenMinAgo, tenMinAgo, tenMinAgo);
      db.prepare(`
        INSERT INTO autonomous_tasks (id, run_id, title, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(stuckReviewTaskId, revRunId, 'Task em Review Sem Fim', 'in_review', tenMinAgo, tenMinAgo);

      const revAnomalies = DiagnosticService.detectAnomalies({ stuckReviewThresholdMs: 5000 });
      const revFound = revAnomalies.find(a => a.type === 'TASK_STUCK_IN_REVIEW' && a.affectedEntity.id === stuckReviewTaskId);
      assert.ok(revFound, 'Deveria detectar TASK_STUCK_IN_REVIEW');
    });

    it('detects expired active worker lease', () => {
      const leaseRunId = `test-run-lease-${Date.now()}`;
      const leaseTaskId = `test-task-lease-${Date.now()}`;
      const expiredLeaseId = `test-exp-lease-${Date.now()}`;
      db.prepare(`
        INSERT INTO worker_leases (id, run_id, task_id, worker_id, lease_until, last_heartbeat, claimed_at, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(expiredLeaseId, leaseRunId, leaseTaskId, 'worker-1', tenMinAgo, tenMinAgo, tenMinAgo, 'active');

      const leaseAnomalies = DiagnosticService.detectAnomalies();
      const leaseFound = leaseAnomalies.find(a => a.type === 'EXPIRED_LEASE_NOT_RECONCILED' && a.affectedEntity.id === expiredLeaseId);
      assert.ok(leaseFound, 'Deveria detectar EXPIRED_LEASE_NOT_RECONCILED');
    });

    it('detects run-task state divergence (run completed with pending tasks)', () => {
      const divRunId = `test-div-run-${Date.now()}`;
      db.prepare(`
        INSERT INTO autonomous_runs (id, project_id, name, objective, status, start_time, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(divRunId, 'test-proj', 'Run Prematuramente Concluido', 'Objetivo do Run', 'completed', tenMinAgo, tenMinAgo, tenMinAgo);
      db.prepare(`
        INSERT INTO autonomous_tasks (id, run_id, title, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(`task-div-${Date.now()}`, divRunId, 'Tarefa Pendente', 'pending', tenMinAgo, tenMinAgo);

      const divAnomalies = DiagnosticService.detectAnomalies();
      const divFound = divAnomalies.find(a => a.type === 'RUN_TASK_STATE_DIVERGENCE' && a.affectedEntity.id === divRunId);
      assert.ok(divFound, 'Deveria detectar RUN_TASK_STATE_DIVERGENCE');
    });
  });

  describe('6. Controlled Failure Simulation & Trace Preservation', () => {
    it('records failed native call with cause, parent span, and secret redaction', () => {
      const failRunId = `fail-run-${Date.now()}`;
      const failTaskId = `fail-task-${Date.now()}`;
      const rootCtx = TraceContextManager.createRootContext({ runId: failRunId, taskId: failTaskId });

      TraceContextManager.run(rootCtx, () => {
        const childCtx = TraceContextManager.createChildContext(rootCtx, { service: 'agent-gateway' });
        TraceContextManager.run(childCtx, () => {
          ObservabilityService.emit({
            level: 'INFO',
            event: 'agent.native_call_started',
            message: 'Iniciando chamada para Antigravity',
            service: 'agent-gateway',
            runId: failRunId,
            taskId: failTaskId
          });

          // Simulate failure with sensitive header and api key
          const sensitiveErr = new Error('Antigravity API rejected token: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.token123');
          (sensitiveErr as any).code = 'UNAUTHORIZED';

          ObservabilityService.emit({
            level: 'ERROR',
            event: 'agent.native_call_failed',
            message: 'Falha na autenticação do agente nativo',
            service: 'agent-gateway',
            runId: failRunId,
            taskId: failTaskId,
            error: sensitiveErr,
            metadata: {
              apiKey: 'AIzaSyA1234567890abcdef1234567890abcdef',
              endpoint: 'http://127.0.0.1:45123/native'
            }
          });
        });
      });

      const failEvents = ObservabilityService.queryEvents({ runId: failRunId }).events;
      assert.equal(failEvents.length, 2);
      const failedEvent = failEvents.find(e => e.event === 'agent.native_call_failed');
      assert.ok(failedEvent);
      assert.equal(failedEvent.level, 'ERROR');
      assert.equal(failedEvent.service, 'agent-gateway');
      assert.equal(failedEvent.traceId, rootCtx.traceId);
      assert.ok(failedEvent.parentSpanId);

      // Verify secret redaction
      const dumped = JSON.stringify(failedEvent);
      assert.ok(!dumped.includes('AIzaSyA1234567890abcdef1234567890abcdef'), 'API Key não pode vazar');
      assert.ok(!dumped.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.token123'), 'JWT não pode vazar');
      assert.ok(dumped.includes('[REDACTED_'), 'Deveria conter marcadores de redação');
    });
  });
});

