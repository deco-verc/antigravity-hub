import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execSync, execFileSync } from 'node:child_process';
import { ChatSubmission } from './chatSubmission.js';
import { RunControl } from './runControl.js';
import { NativeExecutionPolicy } from './nativeExecutionPolicy.js';
import { NativeWorkspaceBinding } from './nativeWorkspaceBinding.js';
import { normalizeRuntimePath } from './runtimeProfileSelector.js';
import { db, DB_PATH, deleteProjectCascading, purgeGhostTestProjectsFromProductionDb } from './db.js';
import { MemoryManager } from './memoryManager.js';
import { GitManager, GitInfo } from './gitManager.js';
import { ProjectAnalyzer } from './analyzer.js';
import { CheckpointManager } from './checkpointManager.js';
import { SecurityManager } from './security.js';
import { SystemManager } from './systemManager.js';
import { Logger } from './logger.js';
import { McpCore } from './mcpCore.js';
import { AutonomousManager } from './autonomousManager.js';
import { AutonomousRunnerService } from './autonomousRunnerService.js';
import { GitHubMcpClient } from './githubMcpClient.js';
import { WorkerRegistry } from './workerRegistry.js';
import { AccountProfileManager } from './accountProfileManager.js';
import { getLanguageServerExe } from './antigravityProvider.js';
import { getGlobalAgentGuidelines } from './agentGuidelines.js';
import { IndependentEvaluator } from './independentEvaluator.js';
import { ResearchManager } from './researchManager.js';
import { CouncilManager } from './councilManager.js';
import { ArenaManager } from './arenaManager.js';
import { BenchmarkManager } from './benchmarkManager.js';
import { BenchmarkService } from './benchmarkService.js';
import { SelfImprovementManager } from './selfImprovementManager.js';
import { AgentBenchmarkManager } from './agentBenchmarkManager.js';
import { AutonomousSelfImprovementEngine } from './selfImprovementRun.js';
import { AntigravityDiscovery } from './antigravityDiscovery.js';
import { StableBaselineResolver } from './stableBaselineResolver.js';
import { ModelRegistry } from './modelRegistry.js';
import { UsageTracker } from './usageTracker.js';
import { DevAutonomyService } from './devAutonomyService.js';
import { QuotaManager } from './quotaManager.js';
import { AgentSessionManager } from './agentSessionManager.js';
import { ObservabilityService } from './observability/observabilityService.js';
import { DiagnosticService } from './observability/diagnosticService.js';
import { ProjectLivingSpecService } from './projectLivingSpecService.js';
import { UpdateService } from './updateService.js';
import { CommandExecutionEngine } from './commandExecutionEngine.js';
import { EngineeringContextService } from './engineeringContextService.js';
import { ChatIntentClassifier } from './chatIntentClassifier.js';
import { ProjectChatService } from './projectChatService.js';
import { ProjectOperationsService } from './projectOperationsService.js';
import { MetaChatService } from './metaChatService.js';
import { SkillSlashCommandService } from './skillSlashCommandService.js';
import { TurnCancellationManager } from './turnCancellationManager.js';
import { ExecutionCoordinator } from './executionCoordinator.js';
import { AgentTurnState } from './agentTurnState.js';
import { SseStreamService } from './sseStreamService.js';
import { LspService } from './lspService.js';

export const apiRouter = Router();

// -------------------------------------------------------------
// SYSTEM & HEALTH ENDPOINTS
// -------------------------------------------------------------

apiRouter.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString(), dataPath: DB_PATH, offline: process.env.DECOHUB_OFFLINE_MODE === 'true' });
});

apiRouter.get('/system/health', (req, res) => {
  try {
    const health = SystemManager.getHealth();
    res.json(health);
  } catch (err: any) {
    Logger.error(`Erro ao consultar System Health: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/system/diagnostics', (req, res) => {
  try {
    const diagnostics = SystemManager.runDiagnostics();
    res.json({ diagnostics, time: new Date().toISOString() });
  } catch (err: any) {
    Logger.error(`Erro ao rodar diagnóstico: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/system/logs', (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string, 10) || 100;
    const logs = Logger.getRecentLogs(limit);
    res.json(logs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.delete('/system/logs', (req, res) => {
  try {
    Logger.clearLogs();
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// AUTO-UPDATE & DISTRIBUTION ENDPOINTS
// -------------------------------------------------------------

apiRouter.get('/system/update/status', (req, res) => {
  try {
    res.json(UpdateService.getStatus());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/system/update/config', (req, res) => {
  try {
    const updated = UpdateService.updateConfig(req.body);
    res.json(updated);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.post('/system/update/check', async (req, res) => {
  try {
    const feedUrl = req.body?.feedUrl;
    const result = await UpdateService.checkForUpdates(feedUrl);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/system/update/download', async (req, res) => {
  try {
    const result = await UpdateService.downloadUpdate();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/system/update/apply', (req, res) => {
  try {
    const options = {
      force: req.body?.force === true,
      dryRun: req.body?.dryRun === true
    };
    const result = UpdateService.applyUpdate(options);
    if (!result.success && result.reason === 'ACTIVE_WORK_IN_PROGRESS') {
      return res.status(409).json(result);
    }
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// PERFORMANCE & EXECUTION ENGINE ENDPOINTS
// -------------------------------------------------------------

apiRouter.get('/system/performance/summary', (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
    const since = req.query.since as string | undefined;
    const summary = CommandExecutionEngine.getPerformanceSummary({ limit, since });
    res.json(summary);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/system/executions', (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
    const summary = CommandExecutionEngine.getPerformanceSummary({ limit });
    res.json(summary.recentExecutions);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/system/executions/:id', (req, res) => {
  try {
    const execution = CommandExecutionEngine.getExecution(req.params.id);
    if (!execution) return res.status(404).json({ error: 'Execução não encontrada' });
    res.json(execution);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/system/executions/:id/cancel', (req, res) => {
  try {
    const reason = req.body?.reason || 'Cancelado pelo usuário';
    const success = CommandExecutionEngine.cancelExecution(req.params.id, reason);
    res.json({ success, id: req.params.id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// OBSERVABILITY & DIAGNOSTICS ENDPOINTS
// -------------------------------------------------------------

apiRouter.get('/observability/events', (req, res) => {
  try {
    const params = {
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
      level: req.query.level as any,
      service: req.query.service as string,
      event: req.query.event as string,
      runId: req.query.runId as string,
      taskId: req.query.taskId as string,
      projectId: req.query.projectId as string,
      conversationId: req.query.conversationId as string,
      correlationId: req.query.correlationId as string,
      traceId: req.query.traceId as string,
      status: req.query.status as string,
      since: req.query.since as string,
      until: req.query.until as string,
      search: req.query.search as string,
      errorCode: req.query.errorCode as string,
    };
    const result = ObservabilityService.queryEvents(params);
    res.json(result);
  } catch (err: any) {
    Logger.error(`Erro ao consultar eventos de observabilidade: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/observability/events/:id', (req, res) => {
  try {
    const event = ObservabilityService.getEventById(req.params.id);
    if (!event) {
      return res.status(404).json({ error: 'Evento de observabilidade não encontrado' });
    }
    res.json(event);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/observability/runs/:runId/timeline', (req, res) => {
  try {
    const timeline = ObservabilityService.getTimelineForRun(req.params.runId);
    res.json(timeline);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/observability/tasks/:taskId/events', (req, res) => {
  try {
    const events = ObservabilityService.getEventsForTask(req.params.taskId);
    res.json(events);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/observability/diagnostics/anomalies', (req, res) => {
  try {
    const anomalies = DiagnosticService.detectAnomalies();
    res.json(anomalies);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/observability/diagnostics/errors', (req, res) => {
  try {
    const since = req.query.since as string;
    const errors = ObservabilityService.getGroupedErrors(since);
    res.json(errors);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/observability/health', (req, res) => {
  try {
    const health = ObservabilityService.getHealthReport();
    const anomalies = DiagnosticService.detectAnomalies();
    health.activeAnomaliesCount = anomalies.length;
    res.json(health);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/observability/summary', (req, res) => {
  try {
    const health = ObservabilityService.getHealthReport();
    const anomalies = DiagnosticService.detectAnomalies();
    const groupedErrors = ObservabilityService.getGroupedErrors(req.query.since as string);
    const totalLessonsRow: any = db.prepare('SELECT count(*) as c FROM operational_lessons').get();
    const resolvedLessonsRow: any = db.prepare('SELECT count(*) as c FROM operational_lessons WHERE resolved = 1').get();
    const autoRemediationsRow: any = db.prepare("SELECT count(*) as c FROM observability_events WHERE event = 'diagnostic.anomaly_auto_remediated'").get();
    health.activeAnomaliesCount = anomalies.length;
    res.json({
      ...health,
      metrics: {
        totalEventsCount: health.totalEventsCount,
        eventsLast24Hours: health.eventsLast24Hours,
        errorsLast24Hours: health.errorsLast24Hours,
        activeAnomaliesCount: anomalies.length,
        operationalLessonsTotal: totalLessonsRow?.c || 0,
        operationalLessonsResolved: resolvedLessonsRow?.c || 0,
        autoRemediatedAnomaliesCount: autoRemediationsRow?.c || 0
      },
      operationalLessons: {
        total: totalLessonsRow?.c || 0,
        resolved: resolvedLessonsRow?.c || 0,
        open: (totalLessonsRow?.c || 0) - (resolvedLessonsRow?.c || 0),
        autoRemediatedCount: autoRemediationsRow?.c || 0
      },
      anomalies,
      groupedErrors
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/observability/export', (req, res) => {
  try {
    const format = (req.query.format as string) === 'jsonl' ? 'jsonl' : 'json';
    const params = {
      level: req.query.level as any,
      service: req.query.service as string,
      event: req.query.event as string,
      runId: req.query.runId as string,
      taskId: req.query.taskId as string,
      projectId: req.query.projectId as string,
      search: req.query.search as string,
      since: req.query.since as string,
      until: req.query.until as string,
    };
    const content = ObservabilityService.exportEvents(params, format);
    const filename = `decohub-events-${Date.now()}.${format === 'jsonl' ? 'jsonl' : 'json'}`;
    res.setHeader('Content-Type', format === 'jsonl' ? 'application/x-ndjson; charset=utf-8' : 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(content);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/observability/cleanup', (req, res) => {
  try {
    const retentionDays = parseInt(req.body?.retentionDays, 10) || 30;
    const deletedCount = ObservabilityService.cleanupOldEvents(retentionDays);
    res.json({ success: true, deletedCount, retentionDays });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// MCP (MODEL CONTEXT PROTOCOL) ENDPOINTS
// -------------------------------------------------------------

apiRouter.post('/mcp', async (req, res) => {
  try {
    const jsonRpcResponse = await McpCore.handleJsonRpc(req.body);
    if (jsonRpcResponse === null) {
      return res.status(204).send();
    }
    res.json(jsonRpcResponse);
  } catch (err: any) {
    res.status(500).json({
      jsonrpc: '2.0',
      error: { code: -32603, message: err.message },
      id: req.body?.id || null
    });
  }
});

apiRouter.get('/mcp/status', (req, res) => {
  try {
    const stats = McpCore.getStats();
    const tools = McpCore.getToolsList();
    res.json({
      ...stats,
      transports: ['stdio', 'http'],
      tools: tools.map(t => ({ name: t.name, description: t.description }))
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/mcp/test', async (req, res) => {
  try {
    const start = Date.now();
    const initRes = await McpCore.handleJsonRpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    const listRes = await McpCore.handleJsonRpc({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const callRes = await McpCore.handleJsonRpc({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'get_projects', arguments: {} }
    });
    const totalTime = Date.now() - start;

    res.json({
      status: 'ok',
      latencyMs: totalTime,
      toolsAvailable: listRes.result?.tools?.length || 0,
      testCallResult: 'success',
      sampleProjectsCount: (() => {
        try {
          return JSON.parse(callRes.result?.content?.[0]?.text || '[]').length;
        } catch {
          return 0;
        }
      })()
    });
  } catch (err: any) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

// -------------------------------------------------------------
// AUTONOMOUS MULTI-AGENT BUILD ENDPOINTS
// -------------------------------------------------------------

apiRouter.get('/autonomous/runner/status', (req, res) => {
  try {
    const status = AutonomousRunnerService.getStatus();
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/runner/status', (req, res) => {
  try {
    const status = AutonomousRunnerService.getStatus();
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/autonomous/runner/start', (req, res) => {
  try {
    AutonomousRunnerService.start();
    res.json({ success: true, message: 'Autonomous Runner iniciado.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/autonomous/runner/stop', (req, res) => {
  try {
    AutonomousRunnerService.stop();
    res.json({ success: true, message: 'Autonomous Runner parado.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/autonomous/runner/trigger', async (req, res) => {
  try {
    await AutonomousRunnerService.schedulerTick();
    res.json({ success: true, message: 'Ciclo do Scheduler disparado.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// MULTI-WORKER REGISTRY & MANAGEMENT ENDPOINTS
// -------------------------------------------------------------

apiRouter.get('/workers', (req, res) => {
  try {
    WorkerRegistry.ensureDefaultWorkers();
    const workers = WorkerRegistry.getAllWorkers();
    const withLeases = workers.map(w => {
      const activeLease = WorkerRegistry.getActiveLease(w.id);
      return { ...w, activeLease };
    });
    res.json(withLeases);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/workers', (req, res) => {
  try {
    const { name, provider, account_label, environment, capabilities } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Nome do worker é obrigatório' });
    const worker = WorkerRegistry.createWorker({ name, provider, account_label, environment, capabilities });
    res.json(worker);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/workers/activity', (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string, 10) || 100;
    const activities = WorkerRegistry.getAllActivity(limit);
    res.json(activities);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/workers/summary', (req, res) => {
  try {
    WorkerRegistry.ensureDefaultWorkers();
    const workers = WorkerRegistry.getAllWorkers();
    const summary = {
      total: workers.length,
      online: workers.filter(w => w.status !== 'OFFLINE' && w.status !== 'ERROR').length,
      ready: workers.filter(w => w.status === 'READY' || w.status === 'WAITING').length,
      working: workers.filter(w => w.status === 'WORKING').length,
      paused: workers.filter(w => w.status === 'PAUSED' || w.status === 'COOLDOWN').length,
      offlineOrError: workers.filter(w => w.status === 'OFFLINE' || w.status === 'ERROR' || w.status === 'NEEDS_AUTH').length,
      workers: workers.map(w => ({
        id: w.id,
        name: w.name,
        status: w.status,
        provider: w.provider,
        account_label: w.account_label,
        current_run_id: w.current_run_id,
        current_task_id: w.current_task_id,
        last_heartbeat: w.last_heartbeat
      }))
    };
    res.json(summary);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/workers/:id', (req, res) => {
  try {
    const worker = WorkerRegistry.getWorker(req.params.id);
    if (!worker) return res.status(404).json({ error: 'Worker não encontrado' });
    const activeLease = WorkerRegistry.getActiveLease(worker.id);
    const activity = WorkerRegistry.getActivityLog(worker.id, 50);
    res.json({ ...worker, activeLease, activity });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.put('/workers/:id', (req, res) => {
  try {
    const { status, account_label, environment, name } = req.body || {};
    const worker = WorkerRegistry.getWorker(req.params.id);
    if (!worker) return res.status(404).json({ error: 'Worker não encontrado' });

    if (status) WorkerRegistry.updateWorkerStatus(worker.id, status);
    if (account_label !== undefined || environment !== undefined || name !== undefined) {
      db.prepare(`
        UPDATE workers
        SET name = COALESCE(?, name),
            account_label = COALESCE(?, account_label),
            environment = COALESCE(?, environment),
            updated_at = ?
        WHERE id = ?
      `).run(name || null, account_label || null, environment || null, new Date().toISOString(), worker.id);
    }

    res.json(WorkerRegistry.getWorker(worker.id));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.delete('/workers/:id', (req, res) => {
  try {
    WorkerRegistry.deleteWorker(req.params.id);
    res.json({ success: true, message: 'Worker removido' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/projects/:id/lessons', (req, res) => {
  try {
    const project: any = db.prepare('SELECT id, path FROM projects WHERE id = ?').get(req.params.id);
    const lessons = EngineeringContextService.getProjectLessons(req.params.id, 50);
    if (lessons.length === 0 && project?.path) {
      return res.json({ projectId: req.params.id, lessons: EngineeringContextService.getProjectLessons(project.path, 50) });
    }
    res.json({ projectId: req.params.id, lessons });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/observability/remediate', (_req, res) => {
  try {
    const result = DiagnosticService.remediateAnomalies();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.delete('/workers/:id/_placeholder', (_req, res) => {
  try {
    res.json({ success: true, message: 'Worker removido' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/workers/:id/pause', (req, res) => {
  try {
    WorkerRegistry.pauseWorker(req.params.id);
    res.json({ success: true, message: 'Worker pausado' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/workers/:id/resume', (req, res) => {
  try {
    WorkerRegistry.resumeWorker(req.params.id);
    res.json({ success: true, message: 'Worker retomado para READY' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/workers/:id/test', async (req, res) => {
  try {
    const result = await WorkerRegistry.testWorker(req.params.id);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/workers/:id/assign', (req, res) => {
  try {
    const { runId, taskId, issueNumber } = req.body || {};
    if (!runId || !taskId) return res.status(400).json({ error: 'runId e taskId são obrigatórios' });
    const leaseId = WorkerRegistry.claimTask(req.params.id, runId, taskId, issueNumber);
    if (!leaseId) return res.status(409).json({ error: 'Não foi possível atribuir: lease já ocupada ou conflito' });
    res.json({ success: true, leaseId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/autonomous/runs', async (req, res) => {
  try {
    const run = await AutonomousManager.createRun(req.body);
    // Immediate trigger for autonomous runner
    setTimeout(() => {
      AutonomousRunnerService.schedulerTick().catch((err) => {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "routes",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:routes]", err);
      }
    });
    }, 100);
    res.status(201).json(run);
  } catch (err: any) {
    Logger.error(`Erro ao criar autonomous run: ${err.message}`);
    res.status(400).json({ error: err.message });
  }
});

apiRouter.get('/autonomous/runs/active', (req, res) => {
  try {
    const runs = db.prepare("SELECT id, name, status FROM autonomous_runs WHERE status IN ('running', 'planning', 'building', 'testing', 'reviewing', 'waiting_for_worker') ORDER BY updated_at DESC").all();
    res.json(runs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/autonomous/runs/:id', (req, res) => {
  try {
    const run = AutonomousManager.getRun(req.params.id);
    res.json(run);
  } catch (err: any) {
    res.status(404).json({ error: err.message });
  }
});

apiRouter.get('/autonomous/projects/:projectId/active', (req, res) => {
  try {
    const active = AutonomousManager.getActiveRunForProject(req.params.projectId);
    res.json(active);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/projects/:id/autonomous-status', (req, res) => {
  try {
    const activeRun = AutonomousManager.getActiveRunForProject(req.params.id);
    const runnerStatus = AutonomousRunnerService.getStatus();
    res.json({
      activeRun,
      runnerStatus
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/autonomous/runs/:id/pause', (req, res) => {
  try {
    const run = AutonomousManager.pauseRun(req.params.id);
    res.json(run);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.post('/autonomous/runs/:id/resume', async (req, res) => {
  try {
    const run = await AutonomousManager.resumeRun(req.params.id);
    setTimeout(() => {
      AutonomousRunnerService.schedulerTick().catch((err) => {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "routes",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:routes]", err);
      }
    });
    }, 50);
    res.json(run);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.post('/autonomous/runs/force-unlock', async (req, res) => {
  try {
    const { runId, projectId } = req.body || {};
    const result = await AutonomousManager.forceUnlockExecution({ runId, projectId });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/autonomous/runs/:id/force-unlock', async (req, res) => {
  try {
    const runId = req.params.id;
    const result = await AutonomousManager.forceUnlockExecution({ runId });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/autonomous/runs/:id/stop', (req, res) => {
  try {
    const activeWorkers: any[] = db.prepare(`SELECT account_profile_id, conversation_id FROM workers
      WHERE current_run_id = ? AND status = 'WORKING' AND conversation_id IS NOT NULL`).all(req.params.id);
    const run = AutonomousManager.stopRun(req.params.id);
    for (const worker of activeWorkers) {
      try {
        const profile = AccountProfileManager.getProfile(worker.account_profile_id);
        if (!profile) continue;
        const env = AccountProfileManager.getExecutionEnvForProfile(profile);
        execFileSync(getLanguageServerExe(), ['agentapi', 'send-message', worker.conversation_id,
          'O run foi interrompido pelo usuário. Pare imediatamente e não execute mais ferramentas ou alterações.'],
        { env, timeout: 10000, stdio: 'ignore' });
      } catch (err: any) {
        Logger.warn(`[Autonomous Stop] Conversa não confirmou parada: ${err.message}`);
      }
    }
    res.json(run);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.post('/autonomous/runs/:id/step', async (req, res) => {
  try {
    await AutonomousRunnerService.step(req.params.id);
    const updatedRun = AutonomousManager.getRun(req.params.id);
    res.json({ success: true, run: updatedRun });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/autonomous/runs/:id/loop/start', async (req, res) => {
  try {
    const run = AutonomousManager.getRun(req.params.id);
    if (run && (run.status === 'paused' || run.status === 'error')) {
      await AutonomousManager.resumeRun(req.params.id);
    }
    setTimeout(() => {
      AutonomousRunnerService.schedulerTick().catch((err) => {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "routes",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:routes]", err);
      }
    });
    }, 50);
    res.json({ success: true, message: 'Loop contínuo autônomo iniciado.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/autonomous/runs/:id/loop/stop', (req, res) => {
  try {
    const run = AutonomousManager.pauseRun(req.params.id);
    res.json({ success: true, message: 'Loop contínuo interrompido.', run });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/autonomous/approvals/:id/resolve', (req, res) => {
  try {
    const { decision } = req.body || {};
    if (!decision || !['approved', 'rejected', 'delegated'].includes(decision)) {
      return res.status(400).json({ error: 'Decisão inválida. Use: approved, rejected ou delegated.' });
    }
    const run = AutonomousManager.resolveHumanApproval(req.params.id, decision);
    setTimeout(() => {
      AutonomousRunnerService.schedulerTick().catch((err) => {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "routes",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:routes]", err);
      }
    });
    }, 50);
    res.json(run);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.get('/autonomous/runs/:id/report', (req, res) => {
  try {
    const reportMd = AutonomousManager.generateOvernightReport(req.params.id);
    res.json({ report: reportMd, reportMd });
  } catch (err: any) {
    res.status(404).json({ error: err.message });
  }
});

apiRouter.get('/autonomous/runs/:id/tasks', (req, res) => {
  try {
    const run = AutonomousManager.getRun(req.params.id);
    const available = AutonomousManager.getAvailableTasks(req.params.id);
    const availableIds = new Set(available.map(a => a.id));
    const tasksWithAvailability = run.tasks.map((t: any) => ({
      ...t,
      isAvailable: availableIds.has(t.id)
    }));
    res.json(tasksWithAvailability);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/autonomous/runs/:id/tasks', (req, res) => {
  try {
    const taskId = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    const { title, description, milestone, dependencies = [], acceptanceCriteria = [], riskLevel = 'GREEN' } = req.body || {};

    db.prepare(`
      INSERT INTO autonomous_tasks (id, run_id, title, description, milestone, order_index, dependencies_json, status, assigned_to, criteria_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 99, ?, 'pending', 'builder', ?, ?, ?)
    `).run(
      taskId,
      req.params.id,
      title,
      description,
      milestone || 'General',
      JSON.stringify(dependencies),
      JSON.stringify(acceptanceCriteria),
      nowIso,
      nowIso
    );
    res.status(201).json({ id: taskId, title, status: 'pending', dependencies, milestone, riskLevel });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/autonomous/tasks/:id/claim', (req, res) => {
  try {
    const { agent = 'Antigravity Builder' } = req.body || {};
    const task: any = db.prepare('SELECT * FROM autonomous_tasks WHERE id = ?').get(req.params.id);
    if (!task) return res.status(404).json({ error: 'Tarefa não encontrada' });
    const run = AutonomousManager.claimTask(task.run_id, task.id, agent);
    res.json(run);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/autonomous/tasks/:id/report', (req, res) => {
  try {
    const task: any = db.prepare('SELECT * FROM autonomous_tasks WHERE id = ?').get(req.params.id);
    if (!task) return res.status(404).json({ error: 'Tarefa não encontrada' });
    const { summary, filesCreated, filesModified, testsAdded, testsPassed, testOutput, browserValidation, acceptanceCriteriaMet, decisions } = req.body || {};
    const filesChanged = [...(filesCreated || []), ...(filesModified || [])];

    const result = AutonomousManager.submitBuilderReport({
      runId: task.run_id,
      taskId: task.id,
      status: testsPassed === false ? 'failure' : 'success',
      filesChanged,
      implemented: [summary || task.title],
      testsRun: testsAdded ? `${testsAdded.length} testes` : undefined,
      testResults: testsPassed === false ? (testOutput || 'Tests failed') : 'Passed',
      browserValidation: typeof browserValidation === 'object' ? browserValidation.visualObservations : browserValidation,
      decisions: decisions || []
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/autonomous/tasks/:id/review', (req, res) => {
  try {
    const task: any = db.prepare('SELECT * FROM autonomous_tasks WHERE id = ?').get(req.params.id);
    if (!task) return res.status(404).json({ error: 'Tarefa não encontrada' });
    const { decision, notes, requiredChanges } = req.body || {};
    const result = AutonomousManager.submitSupervisorReview({
      runId: task.run_id,
      taskId: task.id,
      verdict: decision === 'APPROVED' ? 'APPROVED' : 'CHANGES_REQUESTED',
      feedback: notes || (requiredChanges ? requiredChanges.join(', ') : 'Revisão concluída'),
      requirementsMet: decision === 'APPROVED',
      buildPassed: decision === 'APPROVED',
      testsPassed: decision === 'APPROVED'
    });
    res.json({ decision, result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/autonomous/runs/:id/approvals', (req, res) => {
  try {
    const { taskId, riskLevel, actionType, description, command, impact } = req.body || {};
    const id = AutonomousManager.requestHumanApproval({
      runId: req.params.id,
      taskId,
      riskLevel: (riskLevel || 'orange').toLowerCase() as any,
      title: `${actionType}: ${description}`,
      context: `Comando proposto: ${command || 'N/A'}. Ação requer confirmação.`,
      whyNeeded: `Ação classificada como ${(riskLevel || 'orange').toUpperCase()}`,
      supervisorRecommendation: 'Revisar impacto no sistema antes de autorizar.',
      alternatives: ['Rejeitar e cancelar ação', 'Aprovar execução'],
      impact: impact || 'Impacto relevante no ambiente',
      risk: riskLevel === 'RED' ? 'Crítico' : 'Alto'
    });
    res.json({ id, risk_level: riskLevel, status: 'pending' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/autonomous/runs/:id/approvals', (req, res) => {
  try {
    const run = AutonomousManager.getRun(req.params.id);
    res.json(run.approvals);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/autonomous/runs/:id/events', (req, res) => {
  try {
    const run = AutonomousManager.getRun(req.params.id);
    res.json(run.events);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/autonomous/runs/:id/watchdog', (req, res) => {
  try {
    const run = AutonomousManager.getRun(req.params.id);
    res.json({
      status: 'active',
      runStatus: run.status,
      maxHours: run.max_hours,
      maxCycles: run.max_cycles,
      currentCycle: run.current_cycle,
      isOvernight: run.max_hours >= 8
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/autonomous/runs/:id/hierarchy', (req, res) => {
  try {
    const run = AutonomousManager.getRun(req.params.id);
    const diagnostics = AutonomousManager.queryPlanDiagnostics(req.params.id);
    res.json({
      runId: run.id,
      projectId: run.project_id,
      planVersion: run.planVersion || 1,
      planHistory: run.planHistory || [],
      requirements: run.requirements || [],
      projectRequirements: run.projectRequirements || [],
      complexityAnalysis: run.complexityAnalysis || null,
      successCriteria: run.successCriteria || [],
      technicalContext: run.technicalContext || {},
      majorTasks: run.majorTasks || [],
      tasks: run.tasks || [],
      stateTransitions: run.stateTransitions || [],
      agentCommunications: run.agentCommunications || [],
      finalValidation: run.finalValidation || null,
      diagnostics,
      stats: run.stats
    });
  } catch (err: any) {
    res.status(404).json({ error: err.message });
  }
});

apiRouter.get('/autonomous/runs/:id/diagnostics', (req, res) => {
  try {
    const question = typeof req.query.q === 'string' ? req.query.q : undefined;
    const diagnostics = AutonomousManager.queryPlanDiagnostics(req.params.id, question);
    res.json(diagnostics);
  } catch (err: any) {
    res.status(404).json({ error: err.message });
  }
});

apiRouter.get('/autonomous/runs/:id/requirements', (req, res) => {
  try {
    const requirements = AutonomousManager.getProjectRequirements(req.params.id);
    res.json(requirements);
  } catch (err: any) {
    res.status(404).json({ error: err.message });
  }
});

apiRouter.post('/autonomous/runs/:id/ensure-coverage', (req, res) => {
  try {
    const result = AutonomousManager.ensureRequirementCoverage(req.params.id, req.body || {});
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.post('/autonomous/runs/:id/discover-subtasks', (req, res) => {
  try {
    const result = AutonomousManager.discoverDynamicSubtasks({
      runId: req.params.id,
      ...(req.body || {})
    });
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.post('/autonomous/runs/:id/replan', (req, res) => {
  try {
    const {
      userRequest,
      instruction,
      replanType,
      changeType,
      originTaskId,
      affectedTaskId,
      newMajorTaskTitle,
      newMajorTaskObjective,
      newMicrotasks,
      newTasks,
      targetMajorTaskId
    } = req.body || {};
    const effectiveRequest = (userRequest || instruction || '').trim();
    if (!effectiveRequest) {
      return res.status(400).json({ error: 'userRequest ou instruction é obrigatório para replanejamento.' });
    }
    const result = AutonomousManager.replanRun({
      runId: req.params.id,
      userRequest: effectiveRequest,
      replanType: replanType || changeType,
      originTaskId: originTaskId || affectedTaskId,
      newMajorTaskTitle,
      newMajorTaskObjective,
      newMicrotasks: newMicrotasks || newTasks,
      targetMajorTaskId
    });
    res.json({
      ...result,
      replanResult: result
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.post('/autonomous/tasks/:id/transition', (req, res) => {
  try {
    const { toLifecycleState, toState, actor = 'supervisor', reason = 'Transição solicitada via API', metadata } = req.body || {};
    const targetState = toLifecycleState || toState;
    if (!targetState) {
      return res.status(400).json({ error: 'toLifecycleState é obrigatório.' });
    }
    const transition = AutonomousManager.transitionTaskState(
      req.params.id,
      targetState,
      actor,
      reason,
      { ...(metadata || {}), viaHttpApi: true, enforceReviewEvidence: true }
    );
    res.json(transition);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.get('/autonomous/tasks/:id/contract', (req, res) => {
  try {
    const contract = AutonomousManager.buildWorkerExecutionContract(req.params.id);
    res.json(contract);
  } catch (err: any) {
    res.status(404).json({ error: err.message });
  }
});

apiRouter.get('/autonomous/runs/:id/communications', (req, res) => {
  try {
    const microTaskId = typeof req.query.taskId === 'string' ? req.query.taskId : undefined;
    const communications = AutonomousManager.getAgentCommunications(req.params.id, microTaskId);
    res.json(communications);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/autonomous/runs/:id/validate-final', (req, res) => {
  try {
    const validation = AutonomousManager.validateProjectFinalCompletion(req.params.id);
    res.json({
      ...validation,
      validation
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// FILESYSTEM & PATH VALIDATION
// -------------------------------------------------------------

apiRouter.post('/fs/validate-path', (req, res) => {
  try {
    const { targetPath } = req.body || {};
    const val = SecurityManager.validateProjectFolder(targetPath);

    let subDirs: string[] = [];
    if (val.isValid && val.exists) {
      try {
        subDirs = fs.readdirSync(val.resolvedPath, { withFileTypes: true })
          .filter(d => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'node_modules')
          .slice(0, 15)
          .map(d => d.name);
      } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "routes",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:routes]", err);
      }
    }
    }

    res.json({
      isValid: val.isValid,
      exists: val.exists,
      isDirectory: val.isDirectory,
      isEmpty: val.isEmpty,
      resolvedPath: val.resolvedPath,
      errorMessage: val.errorMessage,
      subDirs
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.get('/fs/quick-paths', (req, res) => {
  try {
    const userHome = os.homedir();
    const suggestions = [
      { label: 'Pasta Atual do Hub', path: path.resolve(process.cwd(), '..') },
      { label: 'C:\\IA', path: 'C:\\IA' },
      { label: 'C:\\IA\\test-projects\\ai-voice-studio', path: 'C:\\IA\\test-projects\\ai-voice-studio' },
      { label: 'Repositórios do Usuário', path: path.join(userHome, 'source', 'repos') },
      { label: 'Documentos', path: path.join(userHome, 'Documents') },
      { label: 'Área de Trabalho', path: path.join(userHome, 'Desktop') }
    ].filter(s => {
      try { return fs.existsSync(s.path); } catch { return false; }
    });

    res.json({ suggestions });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// PROJECTS MANAGEMENT
// -------------------------------------------------------------

apiRouter.post('/projects/analyze', (req, res) => {
  try {
    const { folderPath } = req.body || {};
    if (!folderPath) {
      return res.status(400).json({ error: 'Caminho da pasta é obrigatório.' });
    }

    const val = SecurityManager.validateProjectFolder(folderPath);
    if (!val.isValid || !val.exists) {
      return res.status(400).json({ error: val.errorMessage || 'Pasta inexistente ou inválida.' });
    }

    const analysis = ProjectAnalyzer.analyze(val.resolvedPath);
    res.json(analysis);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.get('/projects', (req, res) => {
  try {
    const projects: any[] = db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all();

    // Check disk availability for each project
    const enhanced = projects.map(p => {
      let isAvailableOnDisk = false;
      try {
        isAvailableOnDisk = Boolean(p.path && typeof p.path === 'string' && fs.existsSync(p.path));
      } catch {
        isAvailableOnDisk = false;
      }
      return {
        ...p,
        isAvailableOnDisk
      };
    });

    res.json(enhanced);
  } catch (err: any) {
    Logger.error(`Erro ao listar projetos: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// Helper fail-safe e instantâneo (< 0.2ms) de resolução de conta via SQLite puro sem tocar disco ou processos
function resolveProfileIdDirect(initialProfileId?: any): string | null {
  try {
    if (initialProfileId && typeof initialProfileId === 'string' && initialProfileId.trim()) {
      const row: any = db.prepare('SELECT id FROM account_profiles WHERE id = ?').get(initialProfileId.trim());
      if (row?.id) return row.id;
    }
    const setting: any = db.prepare("SELECT value FROM system_settings WHERE key = 'active_account_profile_id'").get();
    if (setting?.value) {
      const row: any = db.prepare('SELECT id FROM account_profiles WHERE id = ?').get(setting.value);
      if (row?.id) return row.id;
    }
    const firstActive: any = db.prepare("SELECT id FROM account_profiles WHERE auth_status IN ('READY', 'ACTIVE') ORDER BY created_at ASC LIMIT 1").get();
    if (firstActive?.id) return firstActive.id;
    const firstAny: any = db.prepare('SELECT id FROM account_profiles ORDER BY created_at ASC LIMIT 1').get();
    return firstAny?.id || null;
  } catch {
    return null;
  }
}

apiRouter.post('/projects', async (req, res) => {
  try {
    let {
      name,
      folderPath,
      objective,
      description,
      stack,
      initGit = true,
      initialProfileId,
      selectedModel,
      reasoningLevel,
      githubAction,
      githubRepo,
      githubToken
    } = req.body || {};

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Nome do projeto é obrigatório.' });
    }

    if (!folderPath || !folderPath.trim()) {
      const slug = name.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'novo-projeto';
      const defaultBaseDir = process.env.AI_DEV_TEST_PROJECTS_DIR || 'C:\\IA\\test-projects';
      folderPath = path.join(defaultBaseDir, slug);
    }

    // Validate path
    let resolvedPath = path.resolve(folderPath.trim());
    if (!fs.existsSync(resolvedPath)) {
      try {
        fs.mkdirSync(resolvedPath, { recursive: true });
        Logger.info(`Nova pasta criada para o projeto: ${resolvedPath}`);
      } catch (err: any) {
        return res.status(400).json({ error: `Não foi possível criar a pasta no disco: ${err.message}` });
      }
    }

    const val = SecurityManager.validateProjectFolder(resolvedPath);
    if (!val.isValid) {
      return res.status(400).json({ error: val.errorMessage || 'Caminho inválido para projeto.' });
    }

    // Idempotência amigável: se o projeto já existir pelo caminho, atualiza e responde 200 imediatamente
    const existing: any = db.prepare('SELECT * FROM projects WHERE path = ?').get(val.resolvedPath);
    if (existing) {
      const effectiveProfileId = resolveProfileIdDirect(initialProfileId) || existing.active_account_profile_id;
      const normalizedModel = (selectedModel && typeof selectedModel === 'string')
        ? (selectedModel.includes('pro') ? 'pro' : selectedModel.includes('lite') ? 'flash_lite' : 'flash')
        : (existing.selected_model || 'flash');
      const normalizedReasoning = (['HIGH', 'MEDIUM', 'LOW'].includes(reasoningLevel) ? reasoningLevel : (existing.reasoning_level || 'HIGH')) as any;
      const nowIso = new Date().toISOString();

      db.prepare(`
        UPDATE projects
        SET name = ?, active_account_profile_id = ?, selected_model = ?, reasoning_level = ?, updated_at = ?
        WHERE id = ?
      `).run(name.trim(), effectiveProfileId, normalizedModel, normalizedReasoning, nowIso, existing.id);

      try {
        ModelRegistry.setPreference({
          role: 'default',
          modelId: normalizedModel,
          intelligenceLevel: normalizedReasoning,
          accountProfileId: effectiveProfileId || undefined,
          projectId: existing.id
        });
      } catch (e: any) {
        Logger.warn(`[POST /projects] Aviso ao atualizar preferência de modelo: ${e.message}`);
      }

      const updatedProject = db.prepare('SELECT * FROM projects WHERE id = ?').get(existing.id);
      Logger.info(`[POST /projects] Projeto já registrado reutilizado com idempotência amigável: ${name.trim()} (${existing.id})`);
      return res.status(200).json(updatedProject);
    }

    const id = crypto.randomUUID();
    const nowIso = new Date().toISOString();

    // 1. Ensure memory files and gitignore (operações síncronas puras em disco < 20ms)
    MemoryManager.ensureMemoryStructure(val.resolvedPath, {
      name: name.trim(),
      objective: objective?.trim(),
      description: description?.trim(),
      stack: stack?.trim()
    });
    GitManager.ensureGitIgnore(val.resolvedPath);

    const isTrusted = req.body?.isTrusted !== undefined ? (req.body.isTrusted ? 1 : 0) : 1;
    const fullDevAutonomy = req.body?.fullDevAutonomy !== undefined ? (req.body.fullDevAutonomy ? 1 : 0) : 1;
    const normalizedModel = (selectedModel && typeof selectedModel === 'string')
      ? (selectedModel.includes('pro') ? 'pro' : selectedModel.includes('lite') ? 'flash_lite' : 'flash')
      : 'flash';
    const normalizedReasoning = (['HIGH', 'MEDIUM', 'LOW'].includes(reasoningLevel) ? reasoningLevel : 'HIGH') as any;

    // Fast-path fail-safe account profile resolution: pure SQLite query < 0.2ms
    const effectiveProfileId = resolveProfileIdDirect(initialProfileId);

    // 2. Insert into DB
    db.prepare(`
      INSERT INTO projects (id, name, path, objective, description, stack, status, is_trusted, full_dev_autonomy, active_account_profile_id, selected_model, reasoning_level, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      name.trim(),
      val.resolvedPath,
      objective?.trim() || '',
      description?.trim() || '',
      stack?.trim() || 'Geral',
      isTrusted,
      fullDevAutonomy,
      effectiveProfileId,
      normalizedModel,
      normalizedReasoning,
      nowIso,
      nowIso
    );

    // Ensure autonomy authorization is active
    DevAutonomyService.setProjectAutonomy(id, Boolean(isTrusted), Boolean(fullDevAutonomy));

    // Save model preference for project
    try {
      ModelRegistry.setPreference({
        role: 'default',
        modelId: normalizedModel,
        intelligenceLevel: normalizedReasoning,
        accountProfileId: effectiveProfileId || undefined,
        projectId: id
      });
    } catch (e: any) {
      Logger.warn(`[POST /projects] Aviso ao definir preferência de modelo: ${e.message}`);
    }

    Logger.success(`Projeto cadastrado no Hub: ${name} (${val.resolvedPath})`);
    const createdProject = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);

    // Send immediate response to unlock client UI instantly (< 20ms)
    res.status(201).json(createdProject);

    // 3. Asynchronous background secondary/heavy operations (Git init, Checkpoint, Git remote, Binding)
    // Executado exclusivamente em background via setImmediate para garantir flush instantâneo (< 10ms) ao cliente HTTP
    setImmediate(async () => {
      try {
        // Inicialização rápida do Git em background sem travar o Event Loop da requisição HTTP
        if (initGit) {
          try {
            const gitDir = path.join(val.resolvedPath, '.git');
            if (!fs.existsSync(gitDir)) {
              try {
                execSync('git init -b main', { cwd: val.resolvedPath, stdio: 'pipe', timeout: 3000 });
                Logger.info(`Git inicializado em ${val.resolvedPath}`);
              } catch {
                try {
                  execSync('git init', { cwd: val.resolvedPath, stdio: 'pipe', timeout: 3000 });
                  execSync('git branch -M main', { cwd: val.resolvedPath, stdio: 'pipe', timeout: 3000 });
                } catch (err) {
                  const _logger = (globalThis as any).logger;
                  if (_logger && typeof _logger.warn === 'function') {
                    _logger.warn({
                      event: 'server.handled_exception',
                      file: 'routes',
                      error: (err as any)?.message || String(err)
                    });
                  } else {
                    console.warn('[WARN][server:routes]', err);
                  }
                }
                Logger.info(`Git inicializado em ${val.resolvedPath}`);
              }
            }

            // Ensure initial HEAD commit exists when Git is initialized on an empty repo
            let hasHead = false;
            try {
              execSync('git rev-parse --verify HEAD', { cwd: val.resolvedPath, stdio: 'pipe', timeout: 3000 });
              hasHead = true;
            } catch {
              hasHead = false;
            }
            if (!hasHead) {
              try {
                execSync('git add -A', { cwd: val.resolvedPath, stdio: 'pipe', timeout: 4000 });
                execSync('git commit -m "chore: initial project structure with DecoHUB memory"', { cwd: val.resolvedPath, stdio: 'pipe', timeout: 5000 });
              } catch {
                try {
                  execSync('git config user.email "agent@decohub.local" && git config user.name "DecoHUB Agent"', { cwd: val.resolvedPath, stdio: 'pipe', timeout: 3000 });
                  execSync('git commit -m "chore: initial project structure with DecoHUB memory"', { cwd: val.resolvedPath, stdio: 'pipe', timeout: 5000 });
                } catch (err) {
                  const _logger = (globalThis as any).logger;
                  if (_logger && typeof _logger.warn === 'function') {
                    _logger.warn({
                      event: 'server.handled_exception',
                      file: 'routes',
                      error: (err as any)?.message || String(err)
                    });
                  } else {
                    console.warn('[WARN][server:routes]', err);
                  }
                }
              }
            }
          } catch (gitErr: any) {
            Logger.warn(`[POST /projects] Aviso na inicialização rápida do Git em background: ${gitErr.message}`);
          }
        }

        // Checkpoint inicial em background (execSync do GitManager.getGitInfo agora roda fora do ciclo HTTP)
        try {
          CheckpointManager.createSessionCheckpoint(id, val.resolvedPath, name.trim(), {
            objective: objective?.trim() || 'Inicialização do projeto',
            implemented: ['Estruturação do repositório', 'Criação da memória permanente .ai-dev-hub/'],
            recentChanges: ['.ai-dev-hub/project.md', '.ai-dev-hub/architecture.md', '.ai-dev-hub/tasks.md'],
            nextTask: 'Definir requisitos e primeiros componentes',
            decisions: ['Configuração de memória permanente em Markdown local']
          });
        } catch (chkErr: any) {
          Logger.warn(`[POST /projects] Aviso ao criar checkpoint de sessão: ${chkErr.message}`);
        }

        // Initial system message
        try {
          db.prepare(`
            INSERT INTO messages (id, project_id, role, content, created_at)
            VALUES (?, ?, 'system', ?, ?)
          `).run(
            crypto.randomUUID(),
            id,
            `Projeto **${name.trim()}** registrado com sucesso. A memória permanente foi inicializada em \`${path.join(val.resolvedPath, '.ai-dev-hub')}\`.`,
            nowIso
          );
        } catch (msgErr: any) {
          Logger.warn(`[POST /projects] Aviso ao registrar mensagem de sistema: ${msgErr.message}`);
        }

        // Pre-warm / switch account runtime if requested
        if (effectiveProfileId) {
          try {
            await AccountProfileManager.switchAccount({
              projectId: id,
              targetProfileId: effectiveProfileId
            });
          } catch (e: any) {
            Logger.warn(`[POST /projects] Falha ao vincular conta inicial ${effectiveProfileId}: ${e.message}`);
          }
        }

        // Auto-establish native workspace binding for seamless development
        try {
          const activeProf = AccountProfileManager.getActiveProfileForProject(id);
          const userProfileDir = AccountProfileManager.getUserProfileDir(activeProf);
          NativeWorkspaceBinding.ensureBinding(id, activeProf.id, userProfileDir, {
            mode: fullDevAutonomy ? 'permissive' : 'restricted'
          });
          Logger.success(`[POST /projects] Vínculo nativo estabelecido com sucesso para ${name.trim()}`);
        } catch (bindErr: any) {
          Logger.warn(`[POST /projects] Aviso ao estabelecer vínculo nativo: ${bindErr.message}`);
        }

        // GitHub repository setup if requested (network call)
        if (githubAction && githubAction !== 'none') {
          try {
            const ghResult = await GitManager.setupGitHubRepository(val.resolvedPath, {
              action: githubAction as 'create_private' | 'link_existing',
              repoNameOrUrl: githubRepo || name.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-'),
              token: githubToken
            });
            if (ghResult.success) {
              db.prepare(`
                UPDATE projects
                SET github_repo = ?, github_branch = 'main', github_sync_status = 'linked', github_last_synced_at = ?
                WHERE id = ?
              `).run(ghResult.repoFullName, new Date().toISOString(), id);
              Logger.success(`[POST /projects] Repositório GitHub configurado: ${ghResult.repoFullName}`);
            } else {
              Logger.warn(`[POST /projects] Aviso na configuração do GitHub: ${ghResult.error}`);
            }
          } catch (ghErr: any) {
            Logger.warn(`[POST /projects] Falha ao configurar GitHub no projeto: ${ghErr.message}`);
          }
        }
      } catch (bgErr: any) {
        Logger.error(`[POST /projects] Erro inesperado em operações assíncronas em background: ${bgErr?.message || bgErr}`);
      }
    });
  } catch (err: any) {
    Logger.error(`Erro ao criar projeto: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/projects/:id', (req, res) => {
  try {
    const { id } = req.params;
    const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!project) {
      return res.status(404).json({ error: 'Projeto não encontrado' });
    }

    const isAvailableOnDisk = fs.existsSync(project.path) && fs.statSync(project.path).isDirectory();

    let memory = {
      projectMd: '',
      architectureMd: '',
      decisionsMd: '',
      tasksMd: '',
      changesMd: '',
      sessionSummaryMd: ''
    };
    let gitInfo: GitInfo = {
      isGitRepo: false,
      branch: null,
      lastCommit: null,
      statusSummary: { modified: 0, newFiles: 0, deleted: 0, total: 0 },
      changedFiles: []
    };
    let parsedTasks: { pending: string[]; doing: string[]; done: string[] } = { pending: [], doing: [], done: [] };

    if (isAvailableOnDisk) {
      if (!fs.existsSync(path.join(project.path, '.git'))) {
        GitManager.ensureRepository(project.path);
      }
      memory = MemoryManager.readMemoryFiles(project.path);
      gitInfo = GitManager.getGitInfo(project.path);
      parsedTasks = MemoryManager.parseTasks(memory.tasksMd);
    }

    const lastSession: any = db.prepare('SELECT * FROM sessions WHERE project_id = ? ORDER BY session_number DESC LIMIT 1').get(id);

    res.json({
      ...project,
      isAvailableOnDisk,
      diskWarning: !isAvailableOnDisk ? `A pasta deste projeto não foi encontrada no disco: "${project.path}"` : null,
      memory,
      gitInfo,
      parsedTasks,
      lastSession
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// GITHUB INTEGRATION ENDPOINTS
// -------------------------------------------------------------

apiRouter.get('/github/status', (_req, res) => {
  try {
    const status = GitManager.getGitHubStatus();
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/github/config', (req, res) => {
  try {
    const { token } = req.body || {};
    if (!token) {
      return res.status(400).json({ error: 'Token do GitHub é obrigatório' });
    }
    GitManager.storeGitHubToken(token);
    const status = GitManager.getGitHubStatus();
    res.json({ success: true, status });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/projects/:id/github', async (req, res) => {
  try {
    const { id } = req.params;
    const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });

    const githubRepo = project.github_repo;
    if (!githubRepo || !githubRepo.includes('/')) {
      return res.json({
        linked: false,
        repo: null,
        branch: project.github_branch || 'main',
        syncStatus: 'unlinked',
        issues: [],
        pullRequests: []
      });
    }

    const [owner, repo] = githubRepo.split('/');
    let issues: any[] = [];
    let pullRequests: any[] = [];
    let error: string | null = null;

    try {
      issues = await GitHubMcpClient.listIssues(owner, repo, 'all');
      pullRequests = await GitHubMcpClient.listPullRequests(owner, repo, 'all');
    } catch (err: any) {
      error = err.message;
    }

    res.json({
      linked: true,
      repo: githubRepo,
      repoUrl: `https://github.com/${githubRepo}`,
      branch: project.github_branch || 'main',
      syncStatus: error ? 'error' : (project.github_sync_status || 'synced'),
      lastSyncedAt: project.github_last_synced_at || new Date().toISOString(),
      issuesCount: issues.length,
      openIssuesCount: issues.filter(i => i.state === 'open').length,
      closedIssuesCount: issues.filter(i => i.state === 'closed').length,
      pullRequestsCount: pullRequests.length,
      openPrsCount: pullRequests.filter(p => p.state === 'open').length,
      issues,
      pullRequests,
      error
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/projects/:id/github', (req, res) => {
  try {
    const { id } = req.params;
    const { repo, branch } = req.body || {};
    const nowIso = new Date().toISOString();

    db.prepare(`
      UPDATE projects
      SET github_repo = ?,
          github_branch = COALESCE(?, github_branch, 'main'),
          github_sync_status = 'linked',
          github_last_synced_at = ?,
          updated_at = ?
      WHERE id = ?
    `).run(repo ? repo.trim() : null, branch ? branch.trim() : 'main', nowIso, nowIso, id);

    const updated: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/projects/:id/github/sync', async (req, res) => {
  try {
    const { id } = req.params;
    const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!project || !project.github_repo) {
      return res.status(400).json({ error: 'Projeto sem repositório GitHub vinculado.' });
    }

    const [owner, repo] = project.github_repo.split('/');
    const issues = await GitHubMcpClient.listIssues(owner, repo, 'all');
    const pullRequests = await GitHubMcpClient.listPullRequests(owner, repo, 'all');
    const nowIso = new Date().toISOString();

    for (const ghIssue of issues) {
      if (ghIssue.state === 'closed') {
        db.prepare('UPDATE autonomous_tasks SET github_state = "closed", status = "completed" WHERE github_issue_number = ?')
          .run(ghIssue.number);
      }
    }

    db.prepare(`
      UPDATE projects
      SET github_sync_status = 'synced', github_last_synced_at = ?, updated_at = ?
      WHERE id = ?
    `).run(nowIso, nowIso, id);

    res.json({
      success: true,
      syncedAt: nowIso,
      issuesCount: issues.length,
      pullRequestsCount: pullRequests.length
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.put('/projects/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, objective, description, stack, status, is_trusted, full_dev_autonomy, active_account_profile_id, selected_model, reasoning_level } = req.body || {};
    const nowIso = new Date().toISOString();

    const isTrustedVal = is_trusted !== undefined ? (is_trusted ? 1 : 0) : null;
    const fullAutonomyVal = full_dev_autonomy !== undefined ? (full_dev_autonomy ? 1 : 0) : null;

    db.prepare(`
      UPDATE projects
      SET name = COALESCE(?, name),
          objective = COALESCE(?, objective),
          description = COALESCE(?, description),
          stack = COALESCE(?, stack),
          status = COALESCE(?, status),
          is_trusted = COALESCE(?, is_trusted),
          full_dev_autonomy = COALESCE(?, full_dev_autonomy),
          active_account_profile_id = COALESCE(?, active_account_profile_id),
          selected_model = COALESCE(?, selected_model),
          reasoning_level = COALESCE(?, reasoning_level),
          updated_at = ?
      WHERE id = ?
    `).run(name, objective, description, stack, status, isTrustedVal, fullAutonomyVal, active_account_profile_id || null, selected_model || null, reasoning_level || null, nowIso, id);

    if (active_account_profile_id) {
      try {
        await AccountProfileManager.switchAccount({ targetProfileId: active_account_profile_id, projectId: id });
      } catch (e: any) {
        Logger.warn(`[PUT /projects/:id] Aviso na troca de perfil: ${e.message}`);
      }
    }

    if (selected_model) {
      try {
        ModelRegistry.setPreference({
          role: 'default',
          modelId: selected_model,
          intelligenceLevel: reasoning_level || 'HIGH',
          projectId: id,
          accountProfileId: active_account_profile_id || null
        });
      } catch (e: any) {
        Logger.warn(`[PUT /projects/:id] Aviso ao salvar preferência de modelo: ${e.message}`);
      }
    }

    const updated = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// DEVELOPMENT AUTONOMY & ENVIRONMENT ENDPOINTS
// -------------------------------------------------------------
apiRouter.get('/projects/:id/native-execution-policy', (req, res) => {
  if (!db.prepare('SELECT 1 FROM projects WHERE id=?').get(req.params.id)) return res.status(404).json({error:'Projeto não encontrado.'});
  try { res.json(NativeExecutionPolicy.get(req.params.id)); } catch (error: any) { res.status(409).json({error:error.message}); }
});
apiRouter.put('/projects/:id/native-execution-policy', (req, res) => {
  try { res.json(NativeExecutionPolicy.configure(req.params.id,req.body)); } catch (error: any) { res.status(409).json({error:error.message}); }
});

apiRouter.get('/projects/:id/native-workspace-binding', (req, res) => {
  try {
    const { id } = req.params;
    const project: any = db.prepare('SELECT id, name, path FROM projects WHERE id = ?').get(id);
    if (!project) return res.status(404).json({ error: 'Projeto não encontrado.' });
    const profile = AccountProfileManager.getActiveProfileForProject(id);
    const userProfileDir = AccountProfileManager.getUserProfileDir(profile);
    const status = NativeWorkspaceBinding.inspectBinding(id, profile.id, userProfileDir);
    res.json(status);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

apiRouter.post('/projects/:id/native-workspace-binding/establish', (req, res) => {
  try {
    const { id } = req.params;
    const project: any = db.prepare('SELECT id, name, path FROM projects WHERE id = ?').get(id);
    if (!project) return res.status(404).json({ error: 'Projeto não encontrado.' });
    const profile = AccountProfileManager.getActiveProfileForProject(id);
    const userProfileDir = AccountProfileManager.getUserProfileDir(profile);
    const record = NativeWorkspaceBinding.ensureBinding(id, profile.id, userProfileDir, req.body);
    res.json({ success: true, binding: record });
  } catch (error: any) {
    res.status(409).json({ error: error.message });
  }
});

apiRouter.get('/projects/:id/autonomy', (req, res) => {
  try {
    const { id } = req.params;
    const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!project) return res.status(404).json({ error: 'Projeto não encontrado.' });

    const isTrusted = DevAutonomyService.isProjectTrusted(id);
    const fullDevAutonomy = DevAutonomyService.hasFullDevAutonomy(id);
    const environment = DevAutonomyService.detectEnvironment(project.path);

    res.json({
      projectId: id,
      projectName: project.name,
      projectPath: project.path,
      isTrusted,
      fullDevAutonomy,
      environment,
      guidelinesBlock: DevAutonomyService.buildAutonomyGuidelinesBlock(project.path, project.name)
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.put('/projects/:id/autonomy', (req, res) => {
  try {
    const { id } = req.params;
    const { isTrusted = true, fullDevAutonomy = true } = req.body || {};
    const project: any = db.prepare('SELECT id FROM projects WHERE id = ?').get(id);
    if (!project) return res.status(404).json({ error: 'Projeto não encontrado.' });

    DevAutonomyService.setProjectAutonomy(id, Boolean(isTrusted), Boolean(fullDevAutonomy));
    const updated: any = db.prepare('SELECT id, is_trusted, full_dev_autonomy FROM projects WHERE id = ?').get(id);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Global settings
apiRouter.get('/settings', (req, res) => {
  try {
    const rows = db.prepare('SELECT key, value, updated_at FROM system_settings').all();
    const settingsMap: Record<string, string> = {};
    rows.forEach((r: any) => { settingsMap[r.key] = r.value; });
    res.json({
      settings: settingsMap,
      fullDevAutonomyDefault: DevAutonomyService.getGlobalDefaultAutonomy()
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.put('/settings', (req, res) => {
  try {
    const { fullDevAutonomyDefault, settings } = req.body || {};
    if (fullDevAutonomyDefault !== undefined) {
      DevAutonomyService.setGlobalDefaultAutonomy(Boolean(fullDevAutonomyDefault));
    }
    if (settings && typeof settings === 'object') {
      const nowIso = new Date().toISOString();
      for (const [k, v] of Object.entries(settings)) {
        db.prepare(`
          INSERT INTO system_settings (key, value, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        `).run(k, String(v), nowIso);
      }
    }
    res.json({ success: true, fullDevAutonomyDefault: DevAutonomyService.getGlobalDefaultAutonomy() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.delete('/projects/:id', (req, res) => {
  try {
    const { id } = req.params;
    const proj: any = db.prepare('SELECT name FROM projects WHERE id = ?').get(id);
    const result = deleteProjectCascading(id);
    if (!result.success) {
      return res.status(500).json({ error: result.error || 'Falha ao remover projeto com cascata' });
    }

    Logger.info(`Projeto removido do Hub: ${proj?.name || id}`);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/system/purge-test-projects', (_req, res) => {
  try {
    const result = purgeGhostTestProjectsFromProductionDb(db);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// OPEN FOLDER & OPEN TERMINAL (Windows Native)
// -------------------------------------------------------------

apiRouter.post('/projects/:id/open-folder', (req, res) => {
  try {
    const { id } = req.params;
    const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });

    const result = SystemManager.openFolder(project.path);
    res.json(result);
  } catch (err: any) {
    Logger.error(`Erro ao abrir pasta: ${err.message}`);
    res.status(400).json({ error: err.message });
  }
});

apiRouter.post('/projects/:id/open-terminal', (req, res) => {
  try {
    const { id } = req.params;
    const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });

    const result = SystemManager.openTerminal(project.path);
    res.json(result);
  } catch (err: any) {
    Logger.error(`Erro ao abrir terminal: ${err.message}`);
    res.status(400).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// MEMORY & TASKS
// -------------------------------------------------------------

apiRouter.get('/projects/:id/memory', (req, res) => {
  try {
    const { id } = req.params;
    const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });

    if (!fs.existsSync(project.path)) {
      return res.status(404).json({ error: 'Pasta do projeto não encontrada no disco.' });
    }

    const memory = MemoryManager.readMemoryFiles(project.path);
    res.json(memory);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.put('/projects/:id/memory/:filename', (req, res) => {
  try {
    const { id, filename } = req.params;
    const { content } = req.body || {};
    if (typeof content !== 'string') {
      return res.status(400).json({ error: 'Conteúdo deve ser uma string' });
    }

    const safeFilename = SecurityManager.sanitizeMemoryFilename(filename);

    const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });

    if (!fs.existsSync(project.path)) {
      return res.status(404).json({ error: 'Pasta do projeto não encontrada no disco.' });
    }

    MemoryManager.updateMemoryFile(project.path, safeFilename, content);
    db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), id);

    Logger.info(`Arquivo de memória atualizado: ${safeFilename} (${project.name})`);
    res.json({ success: true, filename: safeFilename });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.get('/projects/:id/specs', (req, res) => {
  try {
    const { id } = req.params;
    const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });

    if (!fs.existsSync(project.path)) {
      return res.status(404).json({ error: 'Pasta do projeto não encontrada no disco.' });
    }

    const specsDir = path.join(project.path, '.ai-dev-hub', 'specs');
    const readSafe = (file: string) => {
      const p = path.join(specsDir, file);
      return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '';
    };

    const conteudoMd = readSafe('CONTEUDO.md');
    const designMd = readSafe('DESIGN.md');
    const backendMd = readSafe('BACKEND.md');
    const principiosMd = readSafe('PRINCIPIOS.md');
    const jornadasMd = readSafe('JORNADAS.md');
    const hasSpecs = Boolean(conteudoMd && designMd && backendMd && principiosMd && jornadasMd);

    res.json({
      projectId: id,
      projectName: project.name,
      hasSpecs,
      conteudoMd,
      designMd,
      backendMd,
      principiosMd,
      jornadasMd
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/projects/:id/specs/generate', async (req, res) => {
  try {
    const { id } = req.params;
    const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });

    if (!fs.existsSync(project.path)) {
      return res.status(404).json({ error: 'Pasta do projeto não encontrada no disco.' });
    }

    const briefing = (req.body?.briefing as string) || project.objective || project.description || project.name;
    const result = await ProjectLivingSpecService.generateAndPersistLivingSpecs({
      projectId: project.id,
      projectName: project.name,
      projectPath: project.path,
      briefing
    });

    res.json({
      success: true,
      result
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/projects/:id/tasks/add', (req, res) => {
  try {
    const { id } = req.params;
    const { text, column } = req.body || {};
    if (!text) return res.status(400).json({ error: 'Texto da tarefa é obrigatório' });

    const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });

    const memory = MemoryManager.readMemoryFiles(project.path);
    const tasks = MemoryManager.parseTasks(memory.tasksMd);

    const targetCol = column === 'doing' ? 'doing' : (column === 'done' ? 'done' : 'pending');
    tasks[targetCol].push(text.trim());

    const newMd = MemoryManager.formatTasks(tasks);
    MemoryManager.updateMemoryFile(project.path, 'tasks.md', newMd);

    Logger.info(`Tarefa adicionada em ${project.name}: "${text.trim()}" (${targetCol})`);
    res.json({ success: true, tasks });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/projects/:id/tasks/move', (req, res) => {
  try {
    const { id } = req.params;
    const { taskText, from, to } = req.body || {};
    if (!taskText || !from || !to) {
      return res.status(400).json({ error: 'Parâmetros incompletos' });
    }

    const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });

    const memory = MemoryManager.readMemoryFiles(project.path);
    const tasks = MemoryManager.parseTasks(memory.tasksMd);

    const srcKey = from as keyof typeof tasks;
    const dstKey = to as keyof typeof tasks;

    if (tasks[srcKey]) {
      tasks[srcKey] = tasks[srcKey].filter(t => t !== taskText);
    }
    if (tasks[dstKey]) {
      tasks[dstKey].push(taskText);
    }

    const newMd = MemoryManager.formatTasks(tasks);
    MemoryManager.updateMemoryFile(project.path, 'tasks.md', newMd);

    Logger.info(`Tarefa movida em ${project.name}: "${taskText}" (${from} -> ${to})`);
    res.json({ success: true, tasks });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// CHECKPOINTS & CONTINUITY
// -------------------------------------------------------------

apiRouter.post('/projects/:id/checkpoint', (req, res) => {
  try {
    const { id } = req.params;
    const overrides = req.body || {};

    const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });

    const result = CheckpointManager.createSessionCheckpoint(
      project.id,
      project.path,
      project.name,
      overrides
    );

    // Chat announcement
    db.prepare(`
      INSERT INTO messages (id, project_id, role, content, created_at, metadata)
      VALUES (?, ?, 'assistant', ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      id,
      `**Novo Checkpoint de Sessão Gerado (Sessão #${result.sessionNumber})**\n\n\`\`\`text\n${result.checkpointText}\n\`\`\``,
      new Date().toISOString(),
      JSON.stringify({ type: 'checkpoint', sessionNumber: result.sessionNumber })
    );

    Logger.success(`Checkpoint da Sessão #${result.sessionNumber} gerado para ${project.name}`);
    res.json(result);
  } catch (err: any) {
    Logger.error(`Erro ao gerar checkpoint: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/projects/:id/continuity', (req, res) => {
  try {
    const { id } = req.params;
    const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });

    const prompt = CheckpointManager.generateContinuityPrompt(
      project.id,
      project.path,
      project.name
    );

    Logger.info(`Contexto de continuidade gerado para ${project.name}`);
    res.json({
      projectName: project.name,
      prompt
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/projects/:id/sessions', (req, res) => {
  try {
    const { id } = req.params;
    const sessions = db.prepare('SELECT * FROM sessions WHERE project_id = ? ORDER BY session_number DESC').all(id);
    res.json(sessions);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/projects/:id/agent-sessions', (req, res) => {
  try {
    const { id } = req.params;
    const project: any = db.prepare('SELECT id, name FROM projects WHERE id = ?').get(id);
    if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });

    const sessions = AgentSessionManager.getProjectSessions(id);
    const activeSupervisor = sessions.find(s => s.role === 'SUPERVISOR' && s.status === 'ACTIVE') || null;
    const activeWorker = sessions.find(s => s.role === 'WORKER' && s.status === 'ACTIVE') || null;
    const archivedSessions = sessions.filter(s => s.status === 'ARCHIVED');

    // Live execution state determination
    const activeRun: any = db.prepare(`
      SELECT status, current_worker, current_task, last_error FROM autonomous_runs
      WHERE project_id = ?
      ORDER BY created_at DESC LIMIT 1
    `).get(id);

    let supervisorState: 'IDLE' | 'RUNNING' | 'ROTATING' | 'ERROR' = 'IDLE';
    let workerState: 'IDLE' | 'RUNNING' | 'WAITING' | 'ROTATING' | 'BLOCKED' | 'ERROR' = 'IDLE';
    let evaluatorState: 'IDLE' | 'EVALUATING' = 'IDLE';

    if (activeRun) {
      if (activeRun.status === 'planning') {
        supervisorState = 'RUNNING';
      } else if (activeRun.status === 'reviewing') {
        supervisorState = 'RUNNING';
      } else if (activeRun.status === 'testing') {
        evaluatorState = 'EVALUATING';
      } else if (activeRun.status === 'building') {
        workerState = 'RUNNING';
      } else if (activeRun.status === 'waiting_for_worker' || activeRun.status === 'running') {
        workerState = 'WAITING';
      } else if (['error','paused','blocked'].includes(activeRun.status) && activeRun.last_error) {
        supervisorState = 'ERROR'; workerState = 'BLOCKED';
      }
    }

    res.json({
      projectId: id,
      projectName: project.name,
      activeSupervisor,
      activeWorker,
      archivedSessions,
      states: {
        supervisor: supervisorState,
        worker: workerState,
        evaluator: evaluatorState
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/projects/:id/agent-sessions/audit', (req, res) => {
  try {
    const { id } = req.params;
    const auditReport = AgentSessionManager.auditSessions(id);
    res.json(auditReport);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/projects/:id/agent-sessions/rotate', async (req, res) => {
  try {
    const { id } = req.params;
    const { role, reason } = req.body || {};
    if (!role || (role !== 'SUPERVISOR' && role !== 'WORKER')) {
      return res.status(400).json({ error: 'Papel inválido. Deve ser SUPERVISOR ou WORKER.' });
    }
    const result = await AgentSessionManager.rotateSession(id, role, reason || 'MANUAL_USER_ROTATION');
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/projects/:id/git', (req, res) => {
  try {
    const { id } = req.params;
    const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });

    const gitInfo = GitManager.getGitInfo(project.path);
    res.json(gitInfo);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// CHAT & INSTRUCTIONS
// -------------------------------------------------------------

apiRouter.get(['/projects/:id/messages', '/projects/:id/chat'], (req, res) => {
  try {
    const id = String(req.params.id);
    const messages = db.prepare('SELECT * FROM messages WHERE project_id = ? ORDER BY created_at ASC').all(id);
    res.json(messages);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/projects/:id/stream', (req, res) => {
  const id = String(req.params.id);
  SseStreamService.addClient(id, res, req);
});

apiRouter.get('/projects/:id/lsp/diagnostics', async (req, res) => {
  try {
    const file = req.query.file as string;
    if (!file) return res.status(400).json({ error: 'file is required' });
    const diags = await LspService.getDiagnostics(file);
    res.json({ file, diagnostics: diags });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/projects/:id/lsp/definition', async (req, res) => {
  try {
    const file = req.query.file as string;
    const line = parseInt(req.query.line as string, 10) || 1;
    const col = parseInt(req.query.col as string, 10) || 1;
    if (!file) return res.status(400).json({ error: 'file is required' });
    const def = await LspService.getDefinition(file, line, col);
    res.json({ file, line, col, definition: def });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/projects/:id/lsp/references', async (req, res) => {
  try {
    const file = req.query.file as string;
    const line = parseInt(req.query.line as string, 10) || 1;
    const col = parseInt(req.query.col as string, 10) || 1;
    if (!file) return res.status(400).json({ error: 'file is required' });
    const refs = await LspService.findReferences(file, line, col);
    res.json({ file, line, col, references: refs });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post(['/projects/:id/messages', '/projects/:id/chat'], async (req, res) => {
  try {
    const id = String(req.params.id);
    const { content, role = 'user', requestId } = req.body || {};
    if (typeof content !== 'string' || !content.trim()) return res.status(400).json({ error: 'Mensagem vazia ou inválida' });
    if (role !== 'user') return res.status(400).json({ error: 'O chat aceita somente instruções do usuário.' });

    const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });

    if(requestId!==undefined&&typeof requestId!=='string')return res.status(400).json({error:'CHAT_REQUEST_ID_INVALID'});
    let submission;
    if(requestId!==undefined){
      try{submission=ChatSubmission.begin(id,requestId,content);}catch(e:any){return res.status(409).json({error:e.message});}
      if(!submission.isNew){
        if (!submission.persisted) {
          try { db.prepare('DELETE FROM chat_submissions WHERE project_id=? AND request_id=?').run(id, requestId); } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "routes",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:routes]", err);
      }
    }
          return res.status(409).json({
            error: 'Mensagem anterior não foi confirmada no banco de dados. Seu texto foi preservado para reenvio seguro.',
            code: 'CHAT_REQUEST_UNCONFIRMED',
            persisted: false
          });
        }
        if (submission.response) return res.json(submission.response);
        const activeExistingRun: any = db.prepare(
          "SELECT * FROM autonomous_runs WHERE project_id = ? ORDER BY created_at DESC LIMIT 1"
        ).get(id);
        const existingAssistantReply: any = db.prepare(
          "SELECT * FROM messages WHERE project_id = ? AND role = 'assistant' AND created_at >= ? ORDER BY created_at ASC LIMIT 1"
        ).get(id, submission.persistedMessage.created_at);
        const formatStatusNatural = (st: string) => {
          if (st === 'running' || st === 'building' || st === 'testing' || st === 'reviewing') return 'em execução ativa';
          if (st === 'planning') return 'em planejamento de etapas';
          if (st === 'waiting_approval') return 'aguardando aprovação';
          if (st === 'waiting_resource') return 'aguardando recurso externo';
          if (st === 'blocked') return 'bloqueado aguardando ação';
          if (st === 'error') return 'com pendência de erro para resolução';
          if (st === 'paused') return 'pausado';
          if (st === 'completed') return 'concluído';
          return st;
        };
        const fallbackReplyText = activeExistingRun
          ? `Instrução confirmada no projeto. O trabalho atual está ${formatStatusNatural(activeExistingRun.status)}.`
          : 'Instrução confirmada e registrada com sucesso no projeto.';
        const reconciledReply = existingAssistantReply || {
          id: crypto.randomUUID(),
          project_id: id,
          role: 'assistant',
          content: fallbackReplyText,
          created_at: new Date().toISOString()
        };
        const reconciledResponse = {
          userMessage: submission.persistedMessage,
          assistantReply: reconciledReply,
          autonomousRun: activeExistingRun,
          execution: { status: 'queued', reconciled: true }
        };
        ChatSubmission.complete(id, requestId, reconciledResponse);
        return res.json(reconciledResponse);
      }
    }
    const msgId = submission?.messageId || crypto.randomUUID();
    const nowIso = new Date().toISOString();

    if(!submission)db.prepare(`
      INSERT INTO messages (id, project_id, role, content, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(msgId, id, role, content, nowIso);

    const userMessagePayload = { id: msgId, project_id: id, role, content, created_at: nowIso };

    const processMessageTurn = async () => {
      // Local Assistant logic
      let replyContent = '';
      let autonomousRun: any = null;
      let execution: any = { status: 'stored' };
      let intentResult: any = null;
      const trimmed = content.trim().toLowerCase();

      // Universal Slash Command Interception (/frontend, /image, /rea, /karpathy, /style, /ux, /pentest, etc.)
      if (content.trim().startsWith('/')) {
        const slashResult = await SkillSlashCommandService.handleSlashCommand({
          projectId: id,
          projectPath: project.path,
          projectName: project.name,
          command: content.trim().split(/\s+/)[0],
          args: content.trim().slice(content.trim().split(/\s+/)[0].length).trim(),
          fullMessage: content.trim(),
          requestId
        });

        replyContent = slashResult.replyContent;
        execution = slashResult.execution;
        autonomousRun = slashResult.autonomousRun || null;

        const replyId = crypto.randomUUID();
        const replyTime = new Date().toISOString();
        const metadataPayload: any = {
          agentRole: 'system',
          execution,
          runId: autonomousRun?.id || null,
          ...(slashResult.metadata || {})
        };
        if (slashResult.screenshots && slashResult.screenshots.length > 0) {
          metadataPayload.screenshots = slashResult.screenshots;
        }
        const replyMetadata = JSON.stringify(metadataPayload);

        db.prepare(`
          INSERT INTO messages (id, project_id, role, content, created_at, metadata)
          VALUES (?, ?, 'assistant', ?, ?, ?)
        `).run(replyId, id, replyContent, replyTime, replyMetadata);

        const response = {
          userMessage: userMessagePayload,
          assistantReply: { id: replyId, project_id: id, role: 'assistant', content: replyContent, created_at: replyTime, metadata: replyMetadata },
          autonomousRun,
          execution,
          classification: null,
          actionTaken: execution?.status || 'started'
        };
        if (requestId) ChatSubmission.complete(id, requestId, response);
        return response;
      }

    if (/^(checkpoint|gerar checkpoint)[.!]?$/.test(trimmed)) {
      const cpResult = CheckpointManager.createSessionCheckpoint(project.id, project.path, project.name);
      replyContent = `Checkpoint da Sessão #${cpResult.sessionNumber} gerado e salvo em \`.ai-dev-hub/session-summary.md\`.\n\nVocê pode copiá-lo diretamente no botão no topo ou no painel de contexto.`;
      execution = { status: 'stored', command: 'checkpoint' };
    } else if (/^contexto[.!]?$/.test(trimmed)) {
      replyContent = `O contexto de continuidade está pronto. Use o botão **Continuar Projeto** no canto superior direito para copiar todo o resumo estruturado e colar em uma nova sessão do Cursor, Claude Code, Antigravity ou ChatGPT.`;
      execution = { status: 'stored', command: 'contexto' };
    } else if (trimmed.startsWith('tarefa:') || trimmed.startsWith('add tarefa:') || trimmed.startsWith('todo:')) {
      const taskText = content.replace(/^(tarefa:|add tarefa:|todo:)/i, '').trim();
      const memory = MemoryManager.readMemoryFiles(project.path);
      const tasks = MemoryManager.parseTasks(memory.tasksMd);
      tasks.pending.push(taskText);
      MemoryManager.updateMemoryFile(project.path, 'tasks.md', MemoryManager.formatTasks(tasks));
      replyContent = `Nova tarefa adicionada às pendências: **"${taskText}"** (sincronizada com \`tasks.md\`).`;
      execution = { status: 'stored', command: 'task_added' };
    } else {
      // 0. Auto-clear stale cancellation tokens for this project on user message dispatch
      TurnCancellationManager.clearProjectCancellations(id);

      // 1. Centralized Intent Classification Layer
      intentResult = ChatIntentClassifier.classify(content);
      const activeExistingRun = AutonomousManager.getActiveRunForProject(id);
      autonomousRun = activeExistingRun;

      const forceNew = Boolean(req.body?.forceNew);
      const isContinue = !forceNew && (
        intentResult.subType === 'CONTINUE_COMMAND' ||
        intentResult.subType === 'FIX_AND_CONTINUE' ||
        /^(continuar|retomar|desbloquear|aprovar|resolver|tentar novamente)[.!]?$/i.test(trimmed)
      );

      if (!forceNew && !isContinue && (intentResult.intent === 'CONVERSATION' || intentResult.intent === 'STATE_QUERY' || intentResult.intent === 'AMBIGUOUS')) {
        const chatRes = await ProjectChatService.handleConversationalMessageAsync({
          projectId: id,
          content,
          intentResult
        });
        replyContent = chatRes.replyContent;
        execution = {
          status: 'answered',
          intent: intentResult.intent,
          subType: intentResult.subType,
          confidence: intentResult.confidence,
          source: chatRes.source
        };
      } else if (isContinue) {
        if (activeExistingRun) {
          const pendingApproval: any = db.prepare("SELECT id FROM autonomous_approvals WHERE run_id = ? AND status = 'pending' LIMIT 1").get(activeExistingRun.id);
          if (pendingApproval) {
            autonomousRun = AutonomousManager.resolveHumanApproval(pendingApproval.id, 'approved');
            execution = { status: 'started' };
            replyContent = `Aprovação confirmada com sucesso. A execução foi liberada e o sistema está dando prosseguimento às tarefas planejadas.`;
          } else {
            // If run was in error, blocked or paused, recover safely: reset consecutive_failures and last_error
            if (['error', 'blocked', 'paused', 'waiting_resource'].includes(activeExistingRun.status)) {
              db.prepare(`
                UPDATE autonomous_runs
                SET consecutive_failures = 0, last_error = NULL, next_action = 'Reconciliando recursos e continuidade solicitada no chat', updated_at = ?
                WHERE id = ?
              `).run(nowIso, activeExistingRun.id);

              // Re-enable blocked or needs_changes microtasks to ready
              db.prepare(`
                UPDATE autonomous_tasks
                SET status = 'ready', lifecycle_state = 'READY', retry_count = 0, updated_at = ?
                WHERE run_id = ? AND status IN ('blocked', 'needs_changes', 'error')
              `).run(nowIso, activeExistingRun.id);

              AutonomousManager.logEvent(
                activeExistingRun.id,
                null,
                'user',
                'RUN_RESUMED',
                `Build autônomo retomado pelo usuário para correção: "${content}"`
              );
            }
            autonomousRun = await AutonomousManager.resumeRun(activeExistingRun.id);
            if (autonomousRun.status === 'waiting_resource') {
              execution = { status: 'waiting_resource', reason: autonomousRun.last_error };
              replyContent = `A execução parou porque o runtime do Antigravity ficou indisponível ou a cota está em espera. A última tarefa não foi validada. Consulte o diagnóstico ou tente novamente quando o runtime estiver disponível.`;
            } else if (autonomousRun.status === 'blocked') {
              execution = { status: 'blocked', reason: autonomousRun.last_error };
              replyContent = `A execução está bloqueada porque: ${autonomousRun.last_error || 'uma condição impede a continuação'}. Nenhuma etapa pendente foi dada como concluída. Você pode consultar os detalhes no diagnóstico ou tentar novamente.`;
            } else {
              execution = { status: 'started' };
              replyContent = `Execução retomada. O sistema está dando continuidade ao trabalho a partir da última etapa validada.`;
              setTimeout(() => { AutonomousRunnerService.schedulerTick().catch(err => Logger.warn(`[Chat resume] ${err.message}`)); }, 50);
            }
          }
        } else {
          replyContent = 'Nenhuma execução em andamento no momento. Envie o objetivo desejado no chat para que eu organize o plano de trabalho.';
          execution = { status: 'answered', command: 'no_active_run' };
        }
      } else {
        // Connect to Autonomous Development Engine for execution instructions
        try {
          const explicitReplan = !forceNew && (Boolean(req.body?.replan) || /^(replanejar|novo requisito|alterar requisito|defeito):/i.test(content.trim()));
          const isFullProjectPrompt = content.trim().length > 500 || /^(?:#?\s*PROJETO:|OBJETIVO DO PRODUTO:)/i.test(content.trim());
          const taskCounts: any = activeExistingRun
            ? db.prepare(`SELECT COUNT(*) as total, SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed FROM autonomous_tasks WHERE run_id = ?`).get(activeExistingRun.id)
            : null;
          const completedCount = Number(taskCounts?.completed || 0);

          const isRunStalledOrBlocked = activeExistingRun && (
            ['blocked', 'error', 'paused', 'waiting_resource', 'waiting_approval'].includes(activeExistingRun.status) ||
            (!activeExistingRun.tasks || activeExistingRun.tasks.length === 0) ||
            (completedCount === 0 && ['stopped', 'waiting_for_worker', 'planning', 'waiting_approval'].includes(activeExistingRun.status)) ||
            (isFullProjectPrompt && completedCount === 0)
          );
          const isRunBusy = !isRunStalledOrBlocked && activeExistingRun && ['running', 'building', 'testing', 'reviewing', 'planning', 'waiting_for_worker'].includes(activeExistingRun.status) && Boolean(activeExistingRun.tasks?.length);

          if (activeExistingRun && (forceNew || isRunStalledOrBlocked)) {
            // Se o projeto possuir um run anterior bloqueado, pausado, sem progresso ou se for um novo briefing completo:
            // Não prenda em QUEUED_USER_INSTRUCTION.
            // Arquive/finalize o run anterior e crie imediatamente um NOVO Autonomous Run.
            const prevFinalStatus = ['error', 'blocked', 'waiting_resource', 'waiting_approval', 'paused'].includes(activeExistingRun.status) ? 'failed' : 'completed';
            const { RunControl } = await import('./runControl.js');
            RunControl.clear(activeExistingRun.id);
            TurnCancellationManager.clearProjectCancellations(id);

            db.prepare(`
              UPDATE autonomous_runs
              SET status = ?, end_time = COALESCE(end_time, ?), next_action = 'Finalizado para iniciar novo plano solicitado pelo usuário', updated_at = ?
              WHERE id = ?
            `).run(prevFinalStatus, nowIso, nowIso, activeExistingRun.id);
            db.prepare("UPDATE worker_leases SET status = 'released' WHERE run_id = ? AND status = 'active'").run(activeExistingRun.id);
            db.prepare(`
              DELETE FROM execution_reservations
              WHERE json_extract(CASE WHEN json_valid(context_json) THEN context_json ELSE '{}' END, '$.runId') = ?
            `).run(activeExistingRun.id);
            AutonomousManager.logEvent(
              activeExistingRun.id,
              null,
              'system',
              'RUN_SUPERSEDED',
              `Run anterior [${activeExistingRun.id.slice(0, 8)}] finalizado como '${prevFinalStatus}'. Novo run iniciado com a instrução: "${content}"`
            );

            autonomousRun = await AutonomousManager.createRun({
              projectId: id,
              name: `Solicitação: ${content.slice(0, 35)}`,
              objective: content,
              briefing: content,
              autonomyMode: 'autonomous',
              forceNew: true
            });
            setTimeout(() => {
              AutonomousRunnerService.schedulerTick().catch((err) => {
                if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
                  (globalThis as any).logger.warn({
                    event: "server.handled_exception",
                    file: "routes",
                    error: (err as any)?.message || String(err)
                  });
                } else {
                  console.warn("[WARN][server:routes]", err);
                }
              });
            }, 100);
            execution = { status: 'started' };
            replyContent = autonomousRun?.status === 'planning'
              ? 'Estou organizando o novo trabalho em etapas e conectando ao agente de desenvolvimento. O planejamento inicial está em andamento.'
              : `Estou organizando o novo trabalho em etapas e verificando as dependências. Criei um novo plano com ${autonomousRun?.tasks?.length || 0} etapas estruturadas para atender ao seu objetivo.`;
          } else if (activeExistingRun && explicitReplan) {
            const cleanReq = content.trim().replace(/^(replanejar|novo requisito|alterar requisito|defeito):/i, '').trim() || content.trim();
            const replanType = /^defeito:/i.test(content.trim())
              ? 'DEFECT_FIX'
              : /^novo requisito:/i.test(content.trim())
              ? 'NEW_FEATURE'
              : (req.body?.replanType || 'REQUIREMENT_CHANGE');
            const replanRes = AutonomousManager.replanRun({
              runId: activeExistingRun.id,
              userRequest: cleanReq,
              replanType,
              originTaskId: req.body?.originTaskId
            });
            autonomousRun = replanRes.run;
            execution = {
              status: 'replanned',
              planVersion: replanRes.planVersion,
              addedMajorTaskId: replanRes.addedMajorTaskId,
              addedMicrotaskIds: replanRes.addedMicrotaskIds
            };
            replyContent = `Plano atualizado com sucesso. As etapas já concluídas foram preservadas e ${replanRes.addedMicrotaskIds.length} nova(s) tarefa(s) foram adicionadas ao planejamento.`;
          } else if (isRunBusy) {
            execution = { status: 'queued', runStatus: activeExistingRun.status };
            autonomousRun = activeExistingRun;
            AutonomousManager.logEvent(
              activeExistingRun.id,
              activeExistingRun.current_task || null,
              'user',
              'QUEUED_USER_INSTRUCTION',
              `Instrução enfileirada: "${content}"`,
              { content, queuedAt: nowIso, messageId: msgId, consumed: false, durableContinuation: true }
            );
            replyContent = `Sua instrução foi registrada na fila do projeto. O trabalho ativo está sendo executado e a continuidade será aplicada assim que a etapa atual for concluída.`;
          } else if (activeExistingRun && activeExistingRun.status === 'waiting_approval') {
            execution = { status: 'queued', runStatus: activeExistingRun.status };
            autonomousRun = activeExistingRun;
            AutonomousManager.logEvent(
              activeExistingRun.id,
              activeExistingRun.current_task || null,
              'user',
              'QUEUED_USER_INSTRUCTION',
              `Instrução enfileirada: "${content}"`,
              { content, queuedAt: nowIso, messageId: msgId, consumed: false, durableContinuation: true }
            );
            replyContent = `Sua instrução foi registrada com segurança na fila de continuidade do projeto. A execução está aguardando ação de aprovação para prosseguir.`;
          } else {
            // Launch real autonomous build
            autonomousRun = await AutonomousManager.createRun({
              projectId: id,
              name: `Solicitação: ${content.slice(0, 35)}`,
              objective: content,
              briefing: content,
              autonomyMode: 'autonomous'
            });
            setTimeout(() => {
              AutonomousRunnerService.schedulerTick().catch((err) => {
                if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
                  (globalThis as any).logger.warn({
                    event: "server.handled_exception",
                    file: "routes",
                    error: (err as any)?.message || String(err)
                  });
                } else {
                  console.warn("[WARN][server:routes]", err);
                }
              });
            }, 100);
            execution = { status: 'started' };
            replyContent = autonomousRun?.status === 'planning'
              ? 'Estou organizando o trabalho em etapas e conectando ao agente de desenvolvimento. O planejamento inicial está em andamento.'
              : `Estou organizando o trabalho em etapas e verificando as dependências. Criei um plano com ${autonomousRun?.tasks?.length || 0} etapas estruturadas para atender ao seu objetivo.`;
          }
        } catch (runErr: any) {
          Logger.warn(`[Routes] Não foi possível iniciar Autonomous Run via chat: ${runErr.message}`);
          autonomousRun = AutonomousManager.getActiveRunForProject(id);
          execution = { status: 'blocked', reason: runErr.message, component: 'Supervisor', occurredAt: new Date().toISOString(), action: 'Resolva a causa indicada e clique em Continuar para retomar este Run.' };
          replyContent = `A execução não pôde iniciar porque: ${runErr.message}. Nenhuma etapa foi iniciada. Consulte o diagnóstico ou tente novamente.`;
        }
      }
    }

    if (execution.status === 'blocked' && !replyContent) {
      replyContent = `Instrução salva. **Execução bloqueada:** ${execution.reason}\n\n${execution.action || 'Resolva a causa indicada e retome o mesmo Run.'}`;
    }

    const replyId = crypto.randomUUID();
    const replyTime = new Date().toISOString();

    const replyMetadata = JSON.stringify({agentRole:'system',execution,runId:autonomousRun?.id || null});
    db.prepare(`
      INSERT INTO messages (id, project_id, role, content, created_at, metadata)
      VALUES (?, ?, 'assistant', ?, ?, ?)
    `).run(replyId, id, replyContent, replyTime, replyMetadata);

    const response = {
      userMessage: userMessagePayload,
      assistantReply: { id: replyId, project_id: id, role: 'assistant', content: replyContent, created_at: replyTime, metadata: replyMetadata },
      autonomousRun,
      execution,
      classification: typeof intentResult !== 'undefined' ? intentResult : null,
      actionTaken: execution?.status || 'started'
    };
    if (requestId) ChatSubmission.complete(id, requestId, response);
    return response;
    };

    const isAsync = req.headers['prefer'] === 'respond-async' ||
      req.headers['x-stream-mode'] === 'sse' ||
      req.query.async === 'true' ||
      req.body?.async === true ||
      req.body?.stream === true;

    if (isAsync) {
      const turnId = 'turn-' + crypto.randomUUID();
      SseStreamService.broadcast(id, 'message', { userMessage: userMessagePayload, turnId });

      res.status(202).json({
        success: true,
        turnId,
        messageId: msgId,
        status: 'accepted',
        userMessage: userMessagePayload,
        execution: { status: 'started' }
      });

      setImmediate(async () => {
        try {
          const response = await processMessageTurn();
          SseStreamService.broadcast(id, 'message', { ...response, turnId });
          if (response.autonomousRun) {
            SseStreamService.broadcast(id, 'activity', { run: response.autonomousRun, execution: response.execution, turnId });
          }
          SseStreamService.broadcast(id, 'done', { turnId, status: 'completed' });
        } catch (bgErr: any) {
          SseStreamService.broadcast(id, 'error', { turnId, error: bgErr.message });
          if (typeof requestId === 'string') ChatSubmission.uncertain(id, requestId);
        }
      });
      return;
    }

    const response = await processMessageTurn();
    SseStreamService.broadcast(id, 'message', response);
    if (response.autonomousRun) {
      SseStreamService.broadcast(id, 'activity', { run: response.autonomousRun, execution: response.execution });
    }
    res.status(200).json(response);
  } catch (err: any) {
    if(typeof req.body?.requestId==='string')ChatSubmission.uncertain(String(req.params.id),req.body.requestId);
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/projects/:id/messages/cancel', async (req, res) => {
  try {
    const { id } = req.params;
    const { messageId } = req.body || {};

    // 1. Mark cancellation in TurnCancellationManager for this project
    TurnCancellationManager.requestCancellation(id);

    // 2. If active sessions exist for any role, mark conversation cancelled
    for (const role of ['CONVERSATIONAL', 'SUPERVISOR', 'WORKER'] as const) {
      try {
        const activeSession = AgentSessionManager.getActiveSession(id, role);
        if (activeSession) {
          TurnCancellationManager.requestCancellation(activeSession.provider_conversation_id);
          AgentTurnState.setPhase(activeSession.provider_conversation_id, 'CONSUMED');
        }
      } catch (err) {
        if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
          (globalThis as any).logger.warn({
            event: "server.handled_exception",
            file: "routes",
            error: (err as any)?.message || String(err)
          });
        } else {
          console.warn("[WARN][server:routes]", err);
        }
      }
    }

    // 3. Release any execution reservations and execution lock for this project
    try {
      ExecutionCoordinator.releaseByContext({ projectId: id });
      ExecutionCoordinator.reconcileDeadReservations();
      db.prepare("DELETE FROM execution_reservations WHERE scope='global-agent-execution' OR scope=?").run(`run-create:${id}`);
      db.prepare("UPDATE agent_turn_observations SET phase='CONSUMED' WHERE task_id IN (SELECT id FROM autonomous_tasks WHERE run_id IN (SELECT id FROM autonomous_runs WHERE project_id=?)) AND phase IN ('IN_FLIGHT','UNCERTAIN')").run(id);
      AutonomousRunnerService.releaseExecutionLock();
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "routes",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:routes]", err);
      }
    }

    // 4. Cancel or dequeue any queued instruction
    let dequeued = false;
    const cancelRes = AutonomousManager.cancelQueuedInstructions(id, messageId);
    if (cancelRes.cancelledCount > 0) {
      dequeued = true;
    }

    // 5. Update or mark queued message in messages table
    if (messageId) {
      db.prepare(`
        UPDATE messages
        SET content = '[CANCELADA] Mensagem cancelada pelo usuário.',
            metadata = json_set(COALESCE(metadata, '{}'), '$.execution.status', 'cancelled')
        WHERE id = ? AND project_id = ?
      `).run(messageId, id);
      dequeued = true;
    } else {
      const queuedRows = db.prepare(`
        SELECT id, metadata FROM messages
        WHERE project_id = ? AND json_extract(metadata, '$.execution.status') = 'queued'
        ORDER BY created_at DESC LIMIT 5
      `).all(id) as any[];

      for (const row of queuedRows) {
        try {
          db.prepare(`
            UPDATE messages
            SET content = '[CANCELADA] Mensagem cancelada pelo usuário da fila de execução.',
                metadata = json_set(metadata, '$.execution.status', 'cancelled')
            WHERE id = ?
          `).run(row.id);
          dequeued = true;
        } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "routes",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:routes]", err);
      }
    }
      }
    }

    // 6. Clear chat submissions that might be in flight
    try {
      ChatSubmission.cancel(id);
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "routes",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:routes]", err);
      }
    }

    res.json({
      cancelled: true,
      dequeued,
      message: 'Mensagem cancelada com sucesso.'
    });
  } catch (err: any) {
    Logger.error(`[Routes] Erro ao cancelar mensagem: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

apiRouter.delete('/projects/:id/messages/:messageId', (req, res) => {
  try {
    const { id, messageId } = req.params;

    const msg: any = db.prepare('SELECT * FROM messages WHERE id = ? AND project_id = ?').get(messageId, id);
    if (!msg) {
      return res.status(404).json({ error: 'Mensagem não encontrada.' });
    }

    // Also remove from queued instructions if any
    AutonomousManager.cancelQueuedInstructions(id, messageId);

    // Delete message
    db.prepare('DELETE FROM messages WHERE id = ? AND project_id = ?').run(messageId, id);

    // Release any orphan locks in execution reservations
    try {
      ExecutionCoordinator.releaseByContext({ projectId: id });
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "routes",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:routes]", err);
      }
    }

    res.json({ success: true, message: 'Mensagem removida com sucesso.' });
  } catch (err: any) {
    Logger.error(`[Routes] Erro ao remover mensagem: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// ACCOUNT PROFILES & MULTI-ACCOUNT MANAGEMENT (with /accounts aliasing)
// -------------------------------------------------------------

apiRouter.get(['/account-profiles', '/accounts'], (req, res) => {
  try {
    const profiles = AccountProfileManager.getAllProfiles();
    res.json(profiles);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get(['/account-profiles-detected', '/accounts-detected'], (req, res) => {
  try {
    const accounts = AccountProfileManager.getDetectedSystemAccounts();
    res.json({ accounts });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get(['/account-profiles/active', '/accounts/active'], (req, res) => {
  try {
    const activeProfile = AccountProfileManager.getGlobalActiveProfile();
    res.json(activeProfile);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post(['/account-profiles/active', '/accounts/active'], (req, res) => {
  try {
    const { profileId } = req.body || {};
    if (!profileId) return res.status(400).json({ error: 'profileId é obrigatório' });
    AccountProfileManager.setGlobalActiveProfile(profileId);
    const active = AccountProfileManager.getGlobalActiveProfile();
    res.json(active);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post(['/account-profiles/switch', '/accounts/switch'], async (req, res) => {
  try {
    const { projectId, targetProfileId } = req.body || {};
    if (!targetProfileId) {
      return res.status(400).json({ error: 'targetProfileId é obrigatório' });
    }
    const result = await AccountProfileManager.switchAccount({
      projectId,
      targetProfileId
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post(['/account-profiles/rapid-switch', '/accounts/rapid-switch'], async (req, res) => {
  try {
    const { projectId, targetProfileId, reason, autoStartRuntime } = req.body || {};
    const result = await AccountProfileManager.rapidSwitchAccount({
      projectId,
      targetProfileId,
      reason: reason || 'MANUAL_RAPID_SWITCH',
      autoStartRuntime: autoStartRuntime ?? true
    });
    res.json({
      success: result.switched,
      ...result
    });
  } catch (err: any) {
    const isClientErr = err.message?.includes('não encontrado') || err.message?.includes('inválid') || err.message?.includes('not found');
    res.status(isClientErr ? 404 : 500).json({ success: false, error: err.message });
  }
});

apiRouter.post(['/account-profiles', '/accounts'], (req, res) => {
  try {
    const { displayName, profileName, googleAccountLabel, autoLaunch = true } = req.body || {};
    if (!displayName || !displayName.trim()) {
      return res.status(400).json({ error: 'Nome do perfil é obrigatório' });
    }
    const profile = AccountProfileManager.createProfile({
      displayName: displayName.trim(),
      profileName,
      googleAccountLabel
    });

    let launchResult: any = null;
    if (autoLaunch) {
      try {
        launchResult = AccountProfileManager.launchLogin(profile.id);
      } catch (launchErr: any) {
        Logger.warn(`[Routes] Auto-launch warning for ${profile.id}: ${launchErr.message}`);
      }
    }

    res.status(201).json({
      ...profile,
      launched: !!launchResult?.success,
      launchMessage: launchResult?.message
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get(['/account-profiles/:id', '/accounts/:id'], (req, res) => {
  try {
    const id = String(req.params.id);
    const profile = AccountProfileManager.getProfile(id);
    if (!profile) return res.status(404).json({ error: 'Perfil não encontrado' });
    res.json(profile);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.patch(['/account-profiles/:id', '/accounts/:id'], (req, res) => {
  try {
    const id = String(req.params.id);
    const updated = AccountProfileManager.updateProfile(id, req.body);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.put(['/account-profiles/:id', '/accounts/:id'], (req, res) => {
  try {
    const id = String(req.params.id);
    const updated = AccountProfileManager.updateProfile(id, req.body);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.delete(['/account-profiles/:id', '/accounts/:id'], (req, res) => {
  try {
    const id = String(req.params.id);
    const deleteData = req.query.deleteData === 'true' || req.body?.deleteData === true;
    const result = AccountProfileManager.deleteProfile(id, { deleteData });
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.post(['/account-profiles/:id/launch-login', '/accounts/:id/launch-login'], (req, res) => {
  try {
    const id = String(req.params.id);
    const result = AccountProfileManager.launchLogin(id);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post(['/account-profiles/:id/verify', '/accounts/:id/verify'], (req, res) => {
  try {
    const id = String(req.params.id);
    const { email } = req.body || {};
    const result = AccountProfileManager.verifyProfile(id, email);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post(['/account-profiles/:id/disconnect', '/accounts/:id/disconnect'], (req, res) => {
  try {
    const id = String(req.params.id);
    const result = AccountProfileManager.disconnectProfile(id);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/projects/:id/active-account', (req, res) => {
  try {
    const { id } = req.params;
    const activeProfile = AccountProfileManager.getActiveProfileForProject(id);
    const session = AccountProfileManager.getProjectSession(id, activeProfile.id);
    res.json({
      activeProfile,
      session
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/projects/:id/switch-account', async (req, res) => {
  try {
    const { id } = req.params;
    const { targetProfileId } = req.body || {};
    if (!targetProfileId) {
      return res.status(400).json({ error: 'targetProfileId é obrigatório' });
    }
    const result = await AccountProfileManager.switchAccount({
      projectId: id,
      targetProfileId
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// MODEL REGISTRY & USAGE TELEMETRY ENDPOINTS
// -------------------------------------------------------------

apiRouter.get('/models', (req, res) => {
  try {
    const accountProfileId = req.query.accountProfileId as string | undefined;
    const projectId = req.query.projectId as string | undefined;
    const models = ModelRegistry.getModelsCatalog(accountProfileId, projectId);
    res.json(models);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/accounts/quotas', (req, res) => {
  try {
    const accountProfileId = req.query.accountProfileId as string | undefined;
    if (accountProfileId) {
      const quota = QuotaManager.getQuotaForProfile(accountProfileId);
      return res.json(quota);
    }
    const all = AccountProfileManager.getAllProfiles();
    const result: Record<string, any> = {};
    for (const p of all) {
      result[p.id] = QuotaManager.getQuotaForProfile(p.id);
    }
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/accounts/quotas/refresh', (req, res) => {
  try {
    const { accountProfileId } = req.body || {};
    if (!accountProfileId) {
      return res.status(400).json({ error: 'accountProfileId é obrigatório' });
    }
    const quota = QuotaManager.getQuotaForProfile(accountProfileId, true);
    res.json({ success: true, quota });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/models/preferences', (req, res) => {
  try {
    const accountProfileId = req.query.accountProfileId as string | undefined;
    const projectId = req.query.projectId as string | undefined;
    const preferences = ModelRegistry.getPreferences(accountProfileId, projectId);
    res.json(preferences);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/models/default', (req, res) => {
  try {
    const config = ModelRegistry.getDefaultConfig();
    res.json(config);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/models/preferences', (req, res) => {
  try {
    const { role, modelId, intelligenceLevel, accountProfileId, projectId } = req.body || {};
    if (!modelId) {
      return res.status(400).json({ error: 'modelId é obrigatório' });
    }
    ModelRegistry.setPreference({ role, modelId, intelligenceLevel, accountProfileId, projectId });
    const updated = ModelRegistry.getPreferences(accountProfileId, projectId);
    res.json({ success: true, preferences: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/models/usage/today', (req, res) => {
  try {
    const accountProfileId = req.query.accountProfileId as string | undefined;
    const count = UsageTracker.getTodayExecutionCount(accountProfileId);
    res.json({ todayExecutions: count, accountProfileId: accountProfileId || null });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/models/usage/stats', (req, res) => {
  try {
    const accountProfileId = req.query.accountProfileId as string | undefined;
    const summary = UsageTracker.getSummary(accountProfileId);
    const recent = UsageTracker.getRecentEvents(25, accountProfileId);
    res.json({ summary, recent });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// SIMPLE IDE ENDPOINTS: FILES, DIFF, TERMINAL & STOP
// -------------------------------------------------------------

apiRouter.get('/projects/:id/files', (req, res) => {
  try {
    const { id } = req.params;
    const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });

    function buildTree(currentDir: string, rootDir: string, depth = 0): any[] {
      if (depth > 6) return [];
      if (!fs.existsSync(currentDir)) return [];
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      const ignore = new Set(['.git', '.gemini', 'node_modules', 'dist', 'build', '.next', '.vscode']);
      const list: any[] = [];

      for (const entry of entries) {
        if (ignore.has(entry.name)) continue;
        const full = path.join(currentDir, entry.name);
        const rel = path.relative(rootDir, full).replace(/\\/g, '/');
        if (entry.isDirectory()) {
          list.push({
            name: entry.name,
            relativePath: rel,
            isDirectory: true,
            children: buildTree(full, rootDir, depth + 1)
          });
        } else {
          let size = 0;
          try { size = fs.statSync(full).size; } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "routes",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:routes]", err);
      }
    }
          list.push({
            name: entry.name,
            relativePath: rel,
            isDirectory: false,
            size
          });
        }
      }

      return list.sort((a, b) => {
        if (a.isDirectory === b.isDirectory) return a.name.localeCompare(b.name);
        return a.isDirectory ? -1 : 1;
      });
    }

    const tree = buildTree(project.path, project.path);
    res.json({ files: tree, rootPath: project.path });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get(['/projects/:id/file-content', '/projects/:id/files/content'], (req, res) => {
  try {
    const { id } = req.params;
    const projectId = Array.isArray(id) ? id[0] : (id as string);
    const filePath = req.query.path as string;
    if (!filePath) {
      return res.status(400).json({ error: 'Parâmetro path é obrigatório' });
    }

    const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(String(projectId));
    if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });

    const normalizedProject = path.resolve(project.path);
    const targetFile = path.resolve(project.path, filePath);

    // Strict path traversal defense
    if (!targetFile.startsWith(normalizedProject)) {
      return res.status(403).json({ error: 'Acesso negado: tentativa de path traversal detectada' });
    }

    if (!fs.existsSync(targetFile)) {
      return res.status(404).json({ error: 'Arquivo não encontrado' });
    }

    const stat = fs.statSync(targetFile);
    if (stat.isDirectory()) {
      return res.status(400).json({ error: 'O caminho especificado é um diretório, não um arquivo' });
    }

    // Limit to 2 MB for UI viewing
    if (stat.size > 2 * 1024 * 1024) {
      return res.status(400).json({ error: 'Arquivo muito grande para visualização direta (> 2MB)' });
    }

    const content = fs.readFileSync(targetFile, 'utf-8');
    const ext = path.extname(targetFile).replace('.', '') || 'txt';

    res.json({
      content,
      path: filePath,
      size: stat.size,
      extension: ext
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/projects/:id/git-diff', (req, res) => {
  try {
    const { id } = req.params;
    const file = req.query.file as string | undefined;
    const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });

    const diffResult = GitManager.getUnifiedDiff(project.path, file);
    res.json(diffResult);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/projects/:id/agent-stop', (req, res) => {
  try {
    const { id } = req.params;
    const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });

    // 1. Mark cancellation in TurnCancellationManager for this project and active sessions
    TurnCancellationManager.requestCancellation(id);
    for (const role of ['CONVERSATIONAL', 'SUPERVISOR', 'WORKER'] as const) {
      try {
        const s = AgentSessionManager.getActiveSession(id, role);
        if (s) {
          TurnCancellationManager.requestCancellation(s.provider_conversation_id);
          AgentTurnState.setPhase(s.provider_conversation_id, 'CONSUMED');
        }
      } catch (err) {
        if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
          (globalThis as any).logger.warn({
            event: "server.handled_exception",
            file: "routes",
            error: (err as any)?.message || String(err)
          });
        } else {
          console.warn("[WARN][server:routes]", err);
        }
      }
    }

    // 2. Stop any active autonomous run
    const runs = db.prepare("SELECT id FROM autonomous_runs WHERE project_id = ? AND status NOT IN ('completed', 'failed')").all(id) as any[];
    for (const r of runs) {
      try {
        AutonomousManager.stopRun(r.id);
      } catch (err) {
        if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
          (globalThis as any).logger.warn({
            event: "server.handled_exception",
            file: "routes",
            error: (err as any)?.message || String(err)
          });
        } else {
          console.warn("[WARN][server:routes]", err);
        }
      }
    }

    // 3. Clear reservations, release locks, update observations and cancel submissions
    try {
      ExecutionCoordinator.releaseByContext({ projectId: id });
      ExecutionCoordinator.reconcileDeadReservations();
      db.prepare("DELETE FROM execution_reservations WHERE scope='global-agent-execution' OR scope=?").run(`run-create:${id}`);
      db.prepare("UPDATE agent_turn_observations SET phase='CONSUMED' WHERE task_id IN (SELECT id FROM autonomous_tasks WHERE run_id IN (SELECT id FROM autonomous_runs WHERE project_id=?)) AND phase IN ('IN_FLIGHT','UNCERTAIN')").run(id);
      db.prepare("UPDATE worker_leases SET status='released' WHERE run_id IN (SELECT id FROM autonomous_runs WHERE project_id=?) AND status='active'").run(id);
      AutonomousRunnerService.releaseExecutionLock();
      ChatSubmission.cancel(id);
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "routes",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:routes]", err);
      }
    }

    Logger.info(`[AgentStop] Cancelamento solicitado para o projeto "${project.name}"`);
    res.json({
      success: true,
      pending: runs.some(r=>RunControl.get(r.id)?.status==='pending'),
      message: 'Cancelamento solicitado; histórico preservado e operação atual aguardando parada segura'
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/projects/:id/terminal-logs', (req, res) => {
  try {
    const { id } = req.params;
    const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });

    // Collect recent autonomous events and command executions for this project
    const eventLogs = db.prepare(`
      SELECT 'event' as type, e.event_type as command, e.message as output, e.created_at
      FROM autonomous_events e
      INNER JOIN autonomous_runs r ON r.id = e.run_id
      WHERE r.project_id = ?
      ORDER BY e.created_at DESC
      LIMIT 20
    `).all(id) as any[];

    const cmdLogs = db.prepare(`
      SELECT 'command' as type, command, COALESCE(NULLIF(stdout, ''), stderr, status) as output, started_at as created_at
      FROM command_executions
      WHERE cwd = ?
      ORDER BY started_at DESC
      LIMIT 15
    `).all(project.path) as any[];

    const logs = [...eventLogs, ...cmdLogs]
      .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
      .slice(0, 30);

    // Add recent git log as terminal reference
    let gitLog = '';
    try {
      gitLog = execSync('git log -5 --oneline', { cwd: project.path, encoding: 'utf-8', timeout: 3000 });
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "routes",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:routes]", err);
      }
    }

    res.json({
      project: project.name,
      path: project.path,
      logs: logs.reverse(),
      gitLog: gitLog.trim()
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// PROJECT PROGRAM (KARPATHY EXECUTION LAYER) ENDPOINTS
// -------------------------------------------------------------

apiRouter.get('/projects/:id/program', (req, res) => {
  try {
    const { id } = req.params;
    const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });

    const programMd = MemoryManager.ensureProgramMd(project.path, project.name, project.objective);
    res.json({
      projectId: id,
      projectName: project.name,
      programPath: path.join(project.path, '.ai-dev-hub', 'program.md'),
      content: programMd,
      globalGuidelines: getGlobalAgentGuidelines()
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.put('/projects/:id/program', (req, res) => {
  try {
    const { id } = req.params;
    const { content } = req.body || {};
    if (typeof content !== 'string') {
      return res.status(400).json({ error: 'Conteúdo program.md inválido' });
    }

    const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });

    MemoryManager.updateMemoryFile(project.path, 'program.md', content);
    Logger.success(`[ProjectProgram] program.md atualizado com sucesso para ${project.name}`);

    res.json({
      success: true,
      projectId: id,
      content
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/projects/:id/engineering-context', async (req, res) => {
  try {
    const { id } = req.params;
    const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });

    const { EngineeringContextService } = await import('./engineeringContextService.js');
    const pkg = EngineeringContextService.prepareTaskContext({
      projectPath: project.path,
      projectName: project.name,
      projectObjective: project.objective,
      task: {
        title: (req.query.taskTitle as string) || 'Visão Geral do Projeto',
        description: (req.query.taskDescription as string) || '',
        criteria: req.query.criteria ? (Array.isArray(req.query.criteria) ? req.query.criteria as string[] : [req.query.criteria as string]) : undefined,
        verificationCommand: (req.query.verificationCommand as string) || undefined
      }
    });

    res.json({
      success: true,
      projectId: id,
      context: pkg
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// SUCCESS CONTRACT & INDEPENDENT EVALUATOR ENDPOINTS (ETAPA 2)
// -------------------------------------------------------------

apiRouter.get('/projects/:id/contracts', (req, res) => {
  try {
    const { id } = req.params;
    const contracts = IndependentEvaluator.listContractsByProject(id);
    res.json(contracts);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/projects/:id/contracts/task/:taskId', (req, res) => {
  try {
    const { taskId } = req.params;
    const contract = IndependentEvaluator.getContractByTaskId(taskId);
    const evaluation = IndependentEvaluator.getEvaluationByTaskId(taskId);
    res.json({
      contract,
      evaluation
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/projects/:id/contracts/:contractId', (req, res) => {
  try {
    const { contractId } = req.params;
    const contract = IndependentEvaluator.getContract(contractId);
    if (!contract) return res.status(404).json({ error: 'Contrato não encontrado' });
    const evaluation = IndependentEvaluator.getEvaluationByTaskId(contract.taskId);
    res.json({
      contract,
      evaluation
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/projects/:id/contracts', (req, res) => {
  try {
    const { id } = req.params;
    const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });

    const {
      taskId,
      runId,
      objective,
      acceptanceCriteria = [],
      verificationSteps = [],
      verificationCommand,
      protectedEvaluationFiles = [],
      isBugFix = false
    } = req.body || {};

    if (!taskId || !objective) {
      return res.status(400).json({ error: 'taskId e objective são obrigatórios' });
    }

    const contract = IndependentEvaluator.createSuccessContract({
      taskId,
      runId,
      projectId: id,
      projectPath: project.path,
      objective,
      acceptanceCriteria,
      verificationSteps,
      verificationCommand,
      protectedEvaluationFiles,
      isBugFix
    });

    res.status(201).json(contract);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/projects/:id/evaluate/:contractId', async (req, res) => {
  try {
    const { id, contractId } = req.params;
    const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });

    const builderReport = req.body.builderReport || {
      status: req.body.status || 'success',
      filesChanged: req.body.filesChanged || [],
      implemented: req.body.implemented || []
    };

    const evaluation = await IndependentEvaluator.evaluate(contractId, project.path, builderReport);
    res.json(evaluation);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// KARPATHY EXECUTION LAYER — ETAPA 3: RESEARCH RUN (AUTORESEARCH)
// -------------------------------------------------------------

apiRouter.post('/projects/:id/research/start', (req, res) => {
  try {
    const { id } = req.params;
    const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });

    const {
      objective,
      primaryMetric,
      direction = 'MINIMIZE',
      measurementCommand,
      metricParserRegex,
      maxExperimentTime = 8.0,
      maxExperiments = 20,
      allowedFiles = [],
      protectedFiles = [],
      complexityPenalty = 0.05,
      stopConditions = []
    } = req.body || {};

    if (!objective || !primaryMetric || !measurementCommand) {
      return res.status(400).json({ error: 'objective, primaryMetric e measurementCommand são obrigatórios' });
    }

    const run = ResearchManager.startResearchRun({
      projectId: id,
      objective,
      primaryMetric,
      direction,
      measurementCommand,
      metricParserRegex,
      maxExperimentTime,
      maxExperiments,
      allowedFiles,
      protectedFiles,
      complexityPenalty,
      stopConditions
    }, project.path);

    res.status(201).json(run);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/projects/:id/research/active', (req, res) => {
  try {
    const { id } = req.params;
    const run = ResearchManager.getActiveResearchRun(id);
    res.json(run || null);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/projects/:id/research/runs', (req, res) => {
  try {
    const { id } = req.params;
    const runs = ResearchManager.listResearchRuns(id);
    res.json(runs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/projects/:id/research/runs/:runId', (req, res) => {
  try {
    const { runId } = req.params;
    const run = ResearchManager.getResearchRun(runId);
    if (!run) return res.status(404).json({ error: 'Research Run não encontrado' });
    res.json(run);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/projects/:id/research/:runId/experiment', async (req, res) => {
  try {
    const { id, runId } = req.params;
    const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });

    const { hypothesis, filesChanged = [] } = req.body || {};
    if (!hypothesis) return res.status(400).json({ error: 'hypothesis é obrigatório' });

    const exp = await ResearchManager.executeExperimentStep({
      runId,
      projectPath: project.path,
      hypothesis,
      filesChanged
    });

    res.json(exp);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/projects/:id/research/:runId/stop', (req, res) => {
  try {
    const { id, runId } = req.params;
    const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });

    const run = ResearchManager.stopResearchRun(runId, project.path);
    res.json(run);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// KARPATHY EXECUTION LAYER — ETAPA 4: AI DEV COUNCIL
// -------------------------------------------------------------

apiRouter.post('/projects/:id/council/deliberate', async (req, res) => {
  try {
    const { id } = req.params;
    const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });

    const {
      taskId = crypto.randomUUID(),
      runId,
      task = { title: 'Revisão Arquitetural' },
      contractId,
      diff = '',
      filesChanged = [],
      riskLevel = 'high',
      policyTrigger
    } = req.body || {};

    const contract = contractId ? IndependentEvaluator.getContract(contractId) : null;
    const evaluation = contract ? IndependentEvaluator.getEvaluationByTaskId(contract.taskId) : null;

    const deliberation = await CouncilManager.deliberate({
      taskId,
      projectId: id,
      runId,
      task,
      contract,
      diff,
      filesChanged,
      evaluation,
      riskLevel,
      policyTrigger
    });

    res.json(deliberation);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/projects/:id/council/deliberations', (req, res) => {
  try {
    const { id } = req.params;
    const list = CouncilManager.listDeliberationsByProject(id);
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/projects/:id/council/task/:taskId', (req, res) => {
  try {
    const { taskId } = req.params;
    const deliberation = CouncilManager.getDeliberationByTaskId(taskId);
    res.json(deliberation || null);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/projects/:id/council/:deliberationId', (req, res) => {
  try {
    const { deliberationId } = req.params;
    const deliberation = CouncilManager.getDeliberation(deliberationId);
    if (!deliberation) return res.status(404).json({ error: 'Deliberação do Conselho não encontrada' });
    res.json(deliberation);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/runs/:runId/council', (req, res) => {
  try {
    const { runId } = req.params;
    const list = CouncilManager.listDeliberationsByRun(runId);
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/tasks/:taskId/deliberation', (req, res) => {
  try {
    const { taskId } = req.params;
    const deliberation = CouncilManager.getDeliberationByTaskId(taskId);
    res.json(deliberation || null);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/tasks/:taskId/skill', async (req, res) => {
  try {
    const { taskId } = req.params;
    const { SkillRouter } = await import('./skillRouter.js');
    const skill = SkillRouter.getSkillForTask(taskId);
    res.json(skill || null);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// AI DEV ARENA ENDPOINTS (KARPATHY EXECUTION LAYER — ETAPA 5)
// -------------------------------------------------------------

apiRouter.get('/projects/:id/arena/recommendation', (req, res) => {
  try {
    const { title = '', description = '', riskLevel = 'normal' } = req.query as any;
    const rec = ArenaManager.shouldRecommendArena({
      title,
      description,
      riskLevel
    });
    res.json(rec);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/projects/:id/arena/runs', (req, res) => {
  try {
    const { id } = req.params;
    const runs = ArenaManager.listArenaRunsByProject(id);
    res.json(runs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/projects/:id/arena/candidate/:candidateId/diff', (req, res) => {
  try {
    const { candidateId } = req.params;
    const diffData = ArenaManager.getCandidateDiff(candidateId);
    res.json(diffData);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/projects/:id/arena/:runId', (req, res) => {
  try {
    const { runId } = req.params;
    const run = ArenaManager.getArenaRun(runId);
    if (!run) return res.status(404).json({ error: 'ArenaRun não encontrada' });
    res.json(run);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/projects/:id/arena/create', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      taskId,
      taskTitle,
      taskDescription,
      candidateCount = 3,
      riskLevel = 'high',
      contractId,
      maxMinutes = 30
    } = req.body || {};

    if (!taskTitle) {
      return res.status(400).json({ error: 'taskTitle é obrigatório para criar uma Arena' });
    }

    const arena = await ArenaManager.createArenaRun({
      projectId: id,
      taskId,
      taskTitle,
      taskDescription,
      candidateCount,
      riskLevel,
      contractId,
      maxMinutes
    });

    res.json(arena);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/projects/:id/arena/tournament', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      taskTitle,
      taskDescription,
      candidateCount = 3,
      candidateImplementations = [],
      customTestCommand
    } = req.body || {};

    if (!taskTitle) {
      return res.status(400).json({ error: 'taskTitle é obrigatório' });
    }

    const result = await ArenaManager.executeTournament({
      projectId: id,
      taskTitle,
      taskDescription,
      candidateCount,
      candidateImplementations,
      customTestCommand
    });

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/projects/:id/arena/:runId/evaluate', async (req, res) => {
  try {
    const { runId } = req.params;
    const { customTestCommand } = req.body || {};
    const candidates = await ArenaManager.evaluateAllCandidates(runId, customTestCommand);
    res.json(candidates);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/projects/:id/arena/:runId/council', async (req, res) => {
  try {
    const { runId } = req.params;
    const result = await ArenaManager.deliberateCouncil(runId);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/projects/:id/arena/:runId/integrate', async (req, res) => {
  try {
    const { runId } = req.params;
    const result = await ArenaManager.integrateWinner(runId);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/projects/:id/arena/:runId/cancel', (req, res) => {
  try {
    const { runId } = req.params;
    ArenaManager.cancelArenaRun(runId);
    res.json({ success: true, message: 'Arena cancelada com sucesso' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// BENCHMARKS & SELF-IMPROVEMENT LOOP (FASE 6)
// -------------------------------------------------------------

apiRouter.get('/benchmarks/tasks', (req, res) => {
  try {
    const tasks = BenchmarkManager.getAllTasks();
    res.json(tasks);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/benchmarks/runs', (req, res) => {
  try {
    const runs = BenchmarkManager.listBenchmarkRuns();
    res.json(runs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/benchmarks/runs/:id', (req, res) => {
  try {
    const run = BenchmarkManager.getBenchmarkRun(req.params.id);
    if (!run) return res.status(404).json({ error: 'Benchmark run não encontrado' });
    res.json(run);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/benchmarks/history', (req, res) => {
  try {
    const history = BenchmarkService.getEvolutionTimeline();
    res.json({ success: true, history });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/benchmarks/leaderboard', (req, res) => {
  try {
    const leaderboard = BenchmarkService.getLeaderboard();
    res.json({ success: true, leaderboard });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/benchmarks/run', async (req, res) => {
  try {
    const { candidateImplementations } = req.body || {};
    if (candidateImplementations) {
      const { versionLabel, gitCommit, isBaseline } = req.body || {};
      const run = await BenchmarkManager.runBenchmarkSuite({
        versionLabel: versionLabel || 'AI_DEV_V1',
        gitCommit,
        isBaseline: Boolean(isBaseline),
        candidateImplementations
      });
      return res.json(run);
    }

    const { suiteId, mode, models, fast, modelId, effortLevel } = req.body || {};
    if (mode === 'PROMPT_VARIANT_ARENA') {
      const arenaResult = await BenchmarkService.runPromptVariantArena({ modelId, effortLevel });
      return res.json(arenaResult);
    }

    const run = await BenchmarkService.runBenchmark({
      suiteId,
      mode,
      models,
      fast: fast !== false
    });
    res.json(run);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/benchmarks/prompts-comparison', async (req, res) => {
  try {
    const cached = BenchmarkService.getLatestPromptArenaResult();
    if (cached && req.query.fresh !== 'true') {
      return res.json({ success: true, ...cached });
    }
    const fresh = await BenchmarkService.runPromptVariantArena();
    res.json({ success: true, ...fresh });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/benchmarks/compare', (req, res) => {
  try {
    const { versionA, versionB } = req.query as { versionA?: string; versionB?: string };
    if (!versionA || !versionB) {
      return res.status(400).json({ error: 'Parâmetros versionA e versionB são obrigatórios' });
    }
    const comparison = BenchmarkManager.compareVersions(versionA, versionB);
    res.json(comparison);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// LEVEL 2: AGENT BENCHMARK ENDPOINTS
// -------------------------------------------------------------

apiRouter.get('/agent-benchmarks/tasks', (req, res) => {
  try {
    const tasks = AgentBenchmarkManager.getAllTasks();
    res.json(tasks);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/agent-benchmarks/run', async (req, res) => {
  try {
    const { versionLabel, gitCommit, isBaseline, model } = req.body || {};
    const run = await AgentBenchmarkManager.runFullAgentSuite({
      versionLabel: versionLabel || 'AI_DEV_AGENT_V1',
      gitCommit,
      isBaseline: Boolean(isBaseline),
      model: model || 'flash'
    });
    res.json(run);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/self-improvement/experiments', (req, res) => {
  try {
    const exps = SelfImprovementManager.listExperiments();
    res.json(exps);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/self-improvement/experiments/:id', (req, res) => {
  try {
    const exp = SelfImprovementManager.getExperiment(req.params.id);
    if (!exp) return res.status(404).json({ error: 'Experimento não encontrado' });
    res.json(exp);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/self-improvement/experiments/create', (req, res) => {
  try {
    const { hypothesis, bottleneckIdentified, baselineRunId } = req.body || {};
    if (!hypothesis || !bottleneckIdentified) {
      return res.status(400).json({ error: 'Campos hypothesis e bottleneckIdentified são obrigatórios' });
    }
    const exp = SelfImprovementManager.createExperiment({ hypothesis, bottleneckIdentified, baselineRunId });
    res.json(exp);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/self-improvement/experiments/cycle', async (req, res) => {
  try {
    const { experimentId, candidateA, candidateB } = req.body || {};
    if (!experimentId || !candidateA || !candidateB) {
      return res.status(400).json({ error: 'Parâmetros experimentId, candidateA e candidateB são obrigatórios' });
    }
    const result = await SelfImprovementManager.executeExperimentCycle({
      experimentId,
      candidateA,
      candidateB
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/self-improvement/experiments/agent-cycle', async (req, res) => {
  try {
    const { experimentId, candidateA, candidateB } = req.body || {};
    if (!experimentId || !candidateA) {
      return res.status(400).json({ error: 'Parâmetros experimentId e candidateA são obrigatórios' });
    }
    const result = await SelfImprovementManager.executeAgentSelfImprovementCycle({
      experimentId,
      candidateA,
      candidateB
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/self-improvement/experiments/:id/reevaluate', (req, res) => {
  try {
    const { contract } = req.body || {};
    const result = SelfImprovementManager.reevaluateExperimentWithPromotionGate(req.params.id, contract);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// AUTONOMOUS SELF-IMPROVEMENT ENGINE RUNS
// -------------------------------------------------------------

apiRouter.post('/self-improvement/runs/start', async (req, res) => {
  try {
    const config = req.body || {};
    const run = await AutonomousSelfImprovementEngine.startRun(config);
    res.json(run);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.get('/self-improvement/runs/active', (req, res) => {
  try {
    const run = AutonomousSelfImprovementEngine.getActiveRun();
    res.json(run);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/self-improvement/runs/:id', (req, res) => {
  try {
    const run = AutonomousSelfImprovementEngine.getRun(req.params.id);
    if (!run) return res.status(404).json({ error: 'Run não encontrado' });
    res.json(run);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/self-improvement/runs', (req, res) => {
  try {
    const runs = AutonomousSelfImprovementEngine.listRuns();
    res.json(runs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/self-improvement/runs/:id/stop', (req, res) => {
  try {
    const reason = req.body?.reason || 'Interrompido pelo usuário';
    const run = AutonomousSelfImprovementEngine.stopRun(req.params.id, reason);
    res.json(run);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.get('/self-improvement/runs/:id/report', (req, res) => {
  try {
    const report = AutonomousSelfImprovementEngine.generateMorningReport(req.params.id);
    res.json({ report });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// DESKTOP & SYSTEM DIAGNOSTICS (Fase 8)
// -------------------------------------------------------------

apiRouter.get('/desktop/diagnostics', (req, res) => {
  try {
    const agDiscovery = AntigravityDiscovery.discover();
    const stable = StableBaselineResolver.resolveStableBaseline();
    const activeRun = AutonomousSelfImprovementEngine.getActiveRun();
    const workers = WorkerRegistry.getAllWorkers();
    const accounts = AccountProfileManager.getAllProfiles();
    const activeAccountName = accounts[0]?.display_name || accounts[0]?.profile_name || 'Conta Principal';

    const memUsage = process.memoryUsage();

    res.json({
      desktopVersion: '1.0.0',
      stableBaseline: stable,
      backend: {
        port: process.env.PORT || 3001,
        pid: process.pid,
        uptimeSeconds: Math.round(process.uptime()),
        memoryRssMB: Math.round(memUsage.rss / 1024 / 1024),
        memoryHeapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024)
      },
      antigravity: agDiscovery,
      workers: {
        total: workers.length,
        available: workers.filter(w => w.status === 'READY').length
      },
      accounts: {
        total: accounts.length,
        active: activeAccountName
      },
      activeAutonomousRun: activeRun ? { id: activeRun.id, status: activeRun.status, preset: activeRun.preset } : null,
      system: {
        platform: process.platform,
        arch: process.arch,
        totalMemoryMB: Math.round(os.totalmem() / 1024 / 1024),
        freeMemoryMB: Math.round(os.freemem() / 1024 / 1024)
      },
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// FASE 11: PROJECT OPERATIONS, PREVIEW LAUNCHER & DOCSIMP .ENV STUDIO
// -------------------------------------------------------------

apiRouter.get('/projects/:id/preview/status', (req, res) => {
  try {
    const { id } = req.params;
    const status = ProjectOperationsService.getPreviewStatus(id);
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/projects/:id/preview/start', async (req, res) => {
  try {
    const { id } = req.params;
    const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });

    const { port, timeoutMs } = req.body || {};
    const status = await ProjectOperationsService.startPreview(id, project.path, { port, timeoutMs });
    res.json(status);
  } catch (err: any) {
    Logger.error(`[Routes] Erro ao iniciar preview do projeto "${req.params.id}": ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/projects/:id/preview/stop', async (req, res) => {
  try {
    const { id } = req.params;
    const stopped = await ProjectOperationsService.stopPreview(id);
    res.json({ success: stopped, message: stopped ? 'Preview encerrado com sucesso' : 'Nenhum preview em execução' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/projects/:id/env-keys', (req, res) => {
  try {
    const { id } = req.params;
    const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });

    const envData = ProjectOperationsService.getEnvKeys(id, project.path);
    res.json(envData);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/projects/:id/env-keys', async (req, res) => {
  try {
    const { id } = req.params;
    const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });

    const { keys } = req.body || {};
    if (!keys || typeof keys !== 'object') {
      return res.status(400).json({ error: 'Objeto de chaves "keys" é obrigatório.' });
    }

    const result = await ProjectOperationsService.saveEnvKeys(id, project.path, keys);
    res.json(result);
  } catch (err: any) {
    Logger.error(`[Routes] Erro ao salvar chaves .env do projeto "${req.params.id}": ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/projects/:id/homologation-evidence', (req, res) => {
  try {
    const { id } = req.params;
    const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });

    const evidence = ProjectOperationsService.getHomologationEvidence({
      id: project.id,
      name: project.name,
      path: project.path
    });
    res.json(evidence);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/projects/:id/evidence-file/:filename', (req, res) => {
  try {
    const { id, filename } = req.params;
    const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });

    const { filePath, mimeType } = ProjectOperationsService.getEvidenceFilePath(project.path, filename);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// SKILLS & SLASH COMMANDS REGISTRY
// -------------------------------------------------------------

apiRouter.get('/skills/slash-commands', (req, res) => {
  try {
    const catalog = SkillSlashCommandService.getSlashCommandsCatalog();
    res.json(catalog);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// META-CHAT (AUTO-EVOLUÇÃO & MODIFICAÇÃO DO DECOHUB)
// -------------------------------------------------------------

apiRouter.get('/metachat/status', (_req, res) => {
  try {
    const status = MetaChatService.getLiveStatus();
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.get('/metachat/live-activity', (req, res) => {
  try {
    const threadId = (req.query.threadId as string) || undefined;
    const activity = MetaChatService.getLiveActivity(threadId);
    res.json(activity);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.get('/metachat/threads', (_req, res) => {
  try {
    const threads = MetaChatService.listThreads();
    res.json(threads);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/metachat/threads', (req, res) => {
  try {
    const thread = MetaChatService.createThread(req.body);
    res.status(201).json(thread);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.get('/metachat/threads/active', (_req, res) => {
  try {
    const active = MetaChatService.getOrCreateActiveThread();
    res.json(active);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/metachat/threads/active', (req, res) => {
  try {
    const { threadId } = req.body || {};
    if (!threadId) {
      return res.status(400).json({ success: false, error: 'threadId é obrigatório.' });
    }
    MetaChatService.setActiveThreadId(threadId);
    res.json({ success: true, activeThreadId: threadId });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.get('/metachat/threads/:threadId', (req, res) => {
  try {
    const { threadId } = req.params;
    const thread = MetaChatService.getThread(threadId);
    if (!thread) {
      return res.status(404).json({ success: false, error: 'Thread não encontrada.' });
    }
    res.json(thread);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.get('/metachat/threads/:threadId/messages', (req, res) => {
  try {
    const { threadId } = req.params;
    const limit = parseInt(req.query.limit as string, 10) || 500;
    const messages = MetaChatService.getMessages(threadId, limit);
    res.json(messages);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.patch('/metachat/threads/:threadId', (req, res) => {
  try {
    const { threadId } = req.params;
    const updated = MetaChatService.updateThread(threadId, req.body);
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Thread não encontrada.' });
    }
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.delete('/metachat/threads/:threadId', (req, res) => {
  try {
    const { threadId } = req.params;
    const deleted = MetaChatService.deleteThread(threadId);
    res.json({ success: deleted });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/metachat/cancel', (_req, res) => {
  try {
    const result = MetaChatService.cancelActiveExecution();
    res.json(result);
  } catch (err: any) {
    Logger.error(`[Routes] Erro ao cancelar execução no Meta-Chat: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.delete('/metachat/messages/:id', (req, res) => {
  try {
    const { id } = req.params;
    const deleted = MetaChatService.deleteMessage(id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Mensagem não encontrada no Meta-Chat.' });
    }
    res.json({ success: true, message: 'Mensagem removida com sucesso.' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.get('/metachat/messages', (req, res) => {
  try {
    const threadId = (req.query.threadId as string) || undefined;
    const limit = parseInt(req.query.limit as string, 10) || 500;
    const messages = MetaChatService.getMessages(threadId, limit);
    res.json(messages);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.get('/metachat/stream', (req, res) => {
  SseStreamService.addClient('metachat', res, req);
});

apiRouter.post('/metachat/chat', async (req, res) => {
  try {
    const {
      message,
      threadId,
      codeActions,
      runTests,
      testFile,
      model,
      reasoningMode,
      accountId,
      profileId,
      attachments,
      stream,
      async: isAsyncBody
    } = req.body || {};

    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ success: false, error: 'Campo "message" é obrigatório.' });
    }

    const isAsync = req.headers['x-stream-mode'] === 'sse' ||
      req.query.stream === 'true' ||
      stream === true ||
      req.headers['prefer'] === 'respond-async' ||
      isAsyncBody === true ||
      req.query.async === 'true' ||
      SseStreamService.hasClients('metachat');

    if (isAsync) {
      const turnId = 'meta-turn-' + crypto.randomUUID();

      res.status(202).json({
        success: true,
        turnId,
        status: 'accepted'
      });

      setImmediate(async () => {
        try {
          SseStreamService.broadcast('metachat', 'activity', {
            turnId,
            status: 'started',
            message: 'Iniciando processamento no Meta-Chat...'
          });

          const result = await MetaChatService.handleUserMessage(message, {
            threadId,
            codeActions,
            runTests: Boolean(runTests),
            testFile,
            model,
            reasoningMode,
            accountId: accountId || profileId,
            profileId: profileId || accountId,
            attachments
          });

          SseStreamService.broadcast('metachat', 'message', {
            turnId,
            result,
            message: result.message,
            threadId: result.message?.thread_id || threadId
          });

          SseStreamService.broadcast('metachat', 'activity', {
            turnId,
            status: 'completed',
            telemetry: MetaChatService.getLiveActivity(result.message?.thread_id || threadId)
          });

          SseStreamService.broadcast('metachat', 'done', {
            turnId,
            status: 'completed'
          });
        } catch (bgErr: any) {
          SseStreamService.broadcast('metachat', 'error', {
            turnId,
            error: bgErr.message
          });
        }
      });
      return;
    }

    const result = await MetaChatService.handleUserMessage(message, {
      threadId,
      codeActions,
      runTests: Boolean(runTests),
      testFile,
      model,
      reasoningMode,
      accountId: accountId || profileId,
      profileId: profileId || accountId,
      attachments
    });

    SseStreamService.broadcast('metachat', 'message', {
      result,
      message: result.message,
      threadId: result.message?.thread_id || threadId
    });

    res.json(result);
  } catch (err: any) {
    Logger.error(`[Routes] Erro no Meta-Chat: ${err.message}`);
    const isSecurity = err.message?.includes('SECURITY_SCOPE_VIOLATION');
    const isNotFound = err.message?.includes('não encontrado') || err.message?.includes('not found');
    const isBadRequest = err.message?.includes('inválid') || err.message?.includes('obrigatório');
    const status = isSecurity ? 403 : isNotFound ? 404 : isBadRequest ? 400 : 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

apiRouter.post('/metachat/reset', (req, res) => {
  try {
    const threadId = (req.body?.threadId || req.query?.threadId) as string | undefined;
    MetaChatService.resetMessages(threadId);
    res.json({ success: true, message: 'Histórico do Meta-Chat reiniciado.' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/metachat/recompile', async (req, res) => {
  try {
    const result = await MetaChatService.recompileAndSync();
    if (result.restarted) {
      Logger.info('[Routes] Recompilação com sincronização concluída. Reinício limpo do serviço agendado no Desktop Electron.');
    }
    res.json(result);
  } catch (err: any) {
    Logger.error(`[Routes] Erro ao recompilar DecoHUB via Meta-Chat: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/metachat/restart', async (_req, res) => {
  try {
    const isDesktop = process.env.ELECTRON_RUN_AS_NODE === '1' || Boolean(process.env.AI_DEV_HUB_DATA_DIR);
    res.json({
      success: true,
      isDesktop,
      message: isDesktop
        ? 'Reiniciando serviço backend no Desktop Electron...'
        : 'Reinício de processo solicitado com sucesso.'
    });
    setTimeout(() => {
      try {
        process.exit(0);
      } catch {}
    }, 800);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.get('/metachat/autopilot/status', (_req, res) => {
  try {
    res.json(MetaChatService.getAutopilotStatus());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/metachat/autopilot/start', async (req, res) => {
  try {
    const { maxCycles, cooldownSeconds, model, accountId, threadId } = req.body || {};
    const status = await MetaChatService.startAutopilot({
      maxCycles: typeof maxCycles === 'number' ? maxCycles : undefined,
      cooldownSeconds: typeof cooldownSeconds === 'number' ? cooldownSeconds : undefined,
      model: typeof model === 'string' ? model : undefined,
      accountId: typeof accountId === 'string' ? accountId : undefined,
      threadId: typeof threadId === 'string' ? threadId : undefined
    });
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/metachat/autopilot/stop', (_req, res) => {
  try {
    res.json(MetaChatService.stopAutopilot());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/ml/status', (_req, res) => {
  try {
    const { DecoMindMlService } = require('./decoMindMlService.js');
    res.json(DecoMindMlService.getSystemMlStatus());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});








