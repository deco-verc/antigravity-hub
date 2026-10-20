import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execSync, execFileSync } from 'node:child_process';
import { db } from './db.js';
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
import { SelfImprovementManager } from './selfImprovementManager.js';
import { AgentBenchmarkManager } from './agentBenchmarkManager.js';
import { AutonomousSelfImprovementEngine } from './selfImprovementRun.js';
import { AntigravityDiscovery } from './antigravityDiscovery.js';
import { StableBaselineResolver } from './stableBaselineResolver.js';
import { ModelRegistry } from './modelRegistry.js';
import { UsageTracker } from './usageTracker.js';

export const apiRouter = Router();

// -------------------------------------------------------------
// SYSTEM & HEALTH ENDPOINTS
// -------------------------------------------------------------

apiRouter.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
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
      sampleProjectsCount: JSON.parse(callRes.result?.content?.[0]?.text || '[]').length
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
    const { name, provider, account_label, environment, capabilities } = req.body;
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
    const { status, account_label, environment, name } = req.body;
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
    const { runId, taskId, issueNumber } = req.body;
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
      AutonomousRunnerService.schedulerTick().catch(() => {});
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

apiRouter.post('/autonomous/runs/:id/pause', (req, res) => {
  try {
    const run = AutonomousManager.pauseRun(req.params.id);
    res.json(run);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.post('/autonomous/runs/:id/resume', (req, res) => {
  try {
    const run = AutonomousManager.resumeRun(req.params.id);
    setTimeout(() => {
      AutonomousRunnerService.schedulerTick().catch(() => {});
    }, 50);
    res.json(run);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
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

apiRouter.post('/autonomous/runs/:id/loop/start', (req, res) => {
  try {
    const run = AutonomousManager.getRun(req.params.id);
    if (run && (run.status === 'paused' || run.status === 'error')) {
      AutonomousManager.resumeRun(req.params.id);
    }
    setTimeout(() => {
      AutonomousRunnerService.schedulerTick().catch(() => {});
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
    const { decision } = req.body;
    if (!decision || !['approved', 'rejected', 'delegated'].includes(decision)) {
      return res.status(400).json({ error: 'Decisão inválida. Use: approved, rejected ou delegated.' });
    }
    const run = AutonomousManager.resolveHumanApproval(req.params.id, decision);
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
    const { title, description, milestone, dependencies = [], acceptanceCriteria = [], riskLevel = 'GREEN' } = req.body;

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
    const { summary, filesCreated, filesModified, testsAdded, testsPassed, testOutput, browserValidation, acceptanceCriteriaMet, decisions } = req.body;
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
    const { decision, notes, requiredChanges } = req.body;
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
    const { taskId, riskLevel, actionType, description, command, impact } = req.body;
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

// -------------------------------------------------------------
// FILESYSTEM & PATH VALIDATION
// -------------------------------------------------------------

apiRouter.post('/fs/validate-path', (req, res) => {
  try {
    const { targetPath } = req.body;
    const val = SecurityManager.validateProjectFolder(targetPath);

    let subDirs: string[] = [];
    if (val.isValid && val.exists) {
      try {
        subDirs = fs.readdirSync(val.resolvedPath, { withFileTypes: true })
          .filter(d => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'node_modules')
          .slice(0, 15)
          .map(d => d.name);
      } catch {}
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
    const { folderPath } = req.body;
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
        isAvailableOnDisk = fs.existsSync(p.path) && fs.statSync(p.path).isDirectory();
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

apiRouter.post('/projects', async (req, res) => {
  try {
    const { name, folderPath, objective, description, stack, initGit = true, initialProfileId, githubAction, githubRepo, githubToken } = req.body;
    if (!name || !folderPath) {
      return res.status(400).json({ error: 'Nome do projeto e caminho da pasta são obrigatórios.' });
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

    // Initialize Git repo if requested
    if (initGit) {
      const gitDir = path.join(resolvedPath, '.git');
      if (!fs.existsSync(gitDir)) {
        try {
          execSync('git init -b main', { cwd: resolvedPath, stdio: 'pipe' });
          Logger.info(`Git inicializado em ${resolvedPath}`);
        } catch (e: any) {
          try {
            execSync('git init', { cwd: resolvedPath, stdio: 'pipe' });
            execSync('git branch -M main', { cwd: resolvedPath, stdio: 'pipe' });
          } catch {}
          Logger.info(`Git inicializado em ${resolvedPath}`);
        }
      }
    }

    // Ensure .gitignore protects secrets before anything is committed or linked
    GitManager.ensureGitIgnore(resolvedPath);

    const val = SecurityManager.validateProjectFolder(resolvedPath);
    if (!val.isValid) {
      return res.status(400).json({ error: val.errorMessage || 'Caminho inválido para projeto.' });
    }

    // Check duplicate path
    const existing: any = db.prepare('SELECT * FROM projects WHERE path = ?').get(val.resolvedPath);
    if (existing) {
      return res.status(409).json({ error: 'Esta pasta já está registrada no AI DEV HUB.', project: existing });
    }

    const id = crypto.randomUUID();
    const nowIso = new Date().toISOString();

    // 1. Ensure memory files
    MemoryManager.ensureMemoryStructure(val.resolvedPath, {
      name: name.trim(),
      objective: objective?.trim(),
      description: description?.trim(),
      stack: stack?.trim()
    });

    // 2. Insert into DB
    db.prepare(`
      INSERT INTO projects (id, name, path, objective, description, stack, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(
      id,
      name.trim(),
      val.resolvedPath,
      objective?.trim() || '',
      description?.trim() || '',
      stack?.trim() || 'Geral',
      nowIso,
      nowIso
    );

    // 3. GitHub repository setup if requested
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
          `).run(ghResult.repoFullName, nowIso, id);
          Logger.success(`[POST /projects] Repositório GitHub configurado: ${ghResult.repoFullName}`);
        } else {
          Logger.warn(`[POST /projects] Aviso na configuração do GitHub: ${ghResult.error}`);
        }
      } catch (ghErr: any) {
        Logger.warn(`[POST /projects] Falha ao configurar GitHub no projeto: ${ghErr.message}`);
      }
    }

    // 4. Create initial session
    CheckpointManager.createSessionCheckpoint(id, val.resolvedPath, name.trim(), {
      objective: objective?.trim() || 'Inicialização do projeto',
      implemented: ['Estruturação do repositório', 'Criação da memória permanente .ai-dev-hub/'],
      recentChanges: ['.ai-dev-hub/project.md', '.ai-dev-hub/architecture.md', '.ai-dev-hub/tasks.md'],
      nextTask: 'Definir requisitos e primeiros componentes',
      decisions: ['Configuração de memória permanente em Markdown local']
    });

    // Initial system message
    db.prepare(`
      INSERT INTO messages (id, project_id, role, content, created_at)
      VALUES (?, ?, 'system', ?, ?)
    `).run(
      crypto.randomUUID(),
      id,
      `Projeto **${name.trim()}** registrado com sucesso. A memória permanente foi inicializada em \`${path.join(val.resolvedPath, '.ai-dev-hub')}\`.`,
      nowIso
    );

    // Associate initial profile if provided
    if (initialProfileId) {
      try {
        await AccountProfileManager.switchAccount({
          projectId: id,
          targetProfileId: initialProfileId
        });
      } catch (e: any) {
        Logger.warn(`Falha ao vincular conta inicial ${initialProfileId}: ${e.message}`);
      }
    }

    Logger.success(`Projeto cadastrado no Hub: ${name} (${val.resolvedPath})`);
    const createdProject = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    res.status(201).json(createdProject);
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
    const { token } = req.body;
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
    const { repo, branch } = req.body;
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

apiRouter.put('/projects/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { name, objective, description, stack, status } = req.body;
    const nowIso = new Date().toISOString();

    db.prepare(`
      UPDATE projects
      SET name = COALESCE(?, name),
          objective = COALESCE(?, objective),
          description = COALESCE(?, description),
          stack = COALESCE(?, stack),
          status = COALESCE(?, status),
          updated_at = ?
      WHERE id = ?
    `).run(name, objective, description, stack, status, nowIso, id);

    const updated = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.delete('/projects/:id', (req, res) => {
  try {
    const { id } = req.params;
    const proj: any = db.prepare('SELECT name FROM projects WHERE id = ?').get(id);
    db.prepare('DELETE FROM messages WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM sessions WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM projects WHERE id = ?').run(id);

    Logger.info(`Projeto removido do Hub: ${proj?.name || id}`);
    res.json({ success: true });
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
    const { content } = req.body;
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

apiRouter.post('/projects/:id/tasks/add', (req, res) => {
  try {
    const { id } = req.params;
    const { text, column } = req.body;
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
    const { taskText, from, to } = req.body;
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
      `🎯 **Novo Checkpoint de Sessão Gerado (Sessão #${result.sessionNumber})**\n\n\`\`\`text\n${result.checkpointText}\n\`\`\``,
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

apiRouter.get('/projects/:id/messages', (req, res) => {
  try {
    const { id } = req.params;
    const messages = db.prepare('SELECT * FROM messages WHERE project_id = ? ORDER BY created_at ASC').all(id);
    res.json(messages);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/projects/:id/messages', async (req, res) => {
  try {
    const { id } = req.params;
    const { content, role = 'user' } = req.body;
    if (!content) return res.status(400).json({ error: 'Mensagem vazia' });

    const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });

    const msgId = crypto.randomUUID();
    const nowIso = new Date().toISOString();

    db.prepare(`
      INSERT INTO messages (id, project_id, role, content, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(msgId, id, role, content, nowIso);

    // Local Assistant logic
    let replyContent = '';
    let autonomousRun: any = null;
    const trimmed = content.trim().toLowerCase();

    if (trimmed.includes('checkpoint') || trimmed.includes('gerar checkpoint')) {
      const cpResult = CheckpointManager.createSessionCheckpoint(project.id, project.path, project.name);
      replyContent = `✅ Checkpoint da Sessão #${cpResult.sessionNumber} gerado e salvo em \`.ai-dev-hub/session-summary.md\`!\n\nVocê pode copiá-lo diretamente no botão no topo ou no painel de contexto.`;
    } else if (trimmed.includes('continuar') || trimmed.includes('contexto')) {
      replyContent = `📋 O contexto de continuidade está pronto. Use o botão **Continuar Projeto** no canto superior direito para copiar todo o resumo estruturado e colar em uma nova sessão do Cursor, Claude Code, Antigravity ou ChatGPT.`;
    } else if (trimmed.startsWith('tarefa:') || trimmed.startsWith('add tarefa:') || trimmed.startsWith('todo:')) {
      const taskText = content.replace(/^(tarefa:|add tarefa:|todo:)/i, '').trim();
      const memory = MemoryManager.readMemoryFiles(project.path);
      const tasks = MemoryManager.parseTasks(memory.tasksMd);
      tasks.pending.push(taskText);
      MemoryManager.updateMemoryFile(project.path, 'tasks.md', MemoryManager.formatTasks(tasks));
      replyContent = `📌 Nova tarefa adicionada às pendências: **"${taskText}"** (sincronizada com \`tasks.md\`).`;
    } else {
      // Connect to Autonomous Development Engine
      try {
        const activeExistingRun = AutonomousManager.getActiveRunForProject(id);
        const isRunBusy = activeExistingRun && ['running', 'building', 'reviewing', 'planning', 'waiting_for_worker'].includes(activeExistingRun.status);
        const isRunPaused = activeExistingRun && activeExistingRun.status === 'paused';

        if (isRunBusy) {
          autonomousRun = activeExistingRun;
          AutonomousManager.logEvent(
            activeExistingRun.id,
            activeExistingRun.current_task || null,
            'user',
            'QUEUED_USER_INSTRUCTION',
            `Instrução enfileirada: "${content}"`,
            { content, queuedAt: nowIso, messageId: msgId, consumed: false }
          );
          replyContent = `⏳ **Mensagem Registrada e Enfileirada com Segurança!**\n\nO Worker está executando tarefas no momento para **${project.name}**. Sua instrução foi salva na memória permanente do projeto e colocada na fila de prioridades para ser incorporada pelo Supervisor Gemini assim que o ciclo atual for concluído, evitando qualquer conflito de concorrência.`;
        } else if (isRunPaused) {
          autonomousRun = activeExistingRun;
          AutonomousManager.logEvent(
            activeExistingRun.id,
            activeExistingRun.current_task || null,
            'user',
            'QUEUED_USER_INSTRUCTION',
            `Instrução enfileirada: "${content}"`,
            { content, queuedAt: nowIso, messageId: msgId, consumed: false }
          );
          replyContent = `⏳ **Instrução Salva na Fila de Continuidade!**\n\nO projeto está temporariamente em cooldown ou pausado (${activeExistingRun.last_error || 'aguardando restabelecimento de cota'}). Sua instrução foi salva com segurança e será executada assim que a cota for liberada ou a conta restabelecida.`;
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
            AutonomousRunnerService.schedulerTick().catch(() => {});
          }, 100);
          replyContent = `🚀 **Execução Autônoma Iniciada!**\n\nO **Supervisor Gemini** decompôs sua solicitação em um plano estruturado de tarefas (DAG). O **Worker** está implementando o código e executando os testes automatizados com governança e aprovação direta.`;
        }
      } catch (runErr: any) {
        Logger.warn(`[Routes] Não foi possível iniciar Autonomous Run via chat: ${runErr.message}`);
        replyContent = `Instrução registrada para o projeto **${project.name}**.\n\n${runErr.message?.includes('QUOTA') ? '⚠️ Cota do provedor temporariamente em cooldown. Acompanhe no Gerenciador de Contas.' : 'Memória do projeto sincronizada.'}`;
      }
    }

    const replyId = crypto.randomUUID();
    const replyTime = new Date().toISOString();

    db.prepare(`
      INSERT INTO messages (id, project_id, role, content, created_at)
      VALUES (?, ?, 'assistant', ?, ?)
    `).run(replyId, id, replyContent, replyTime);

    res.json({
      userMessage: { id: msgId, project_id: id, role, content, created_at: nowIso },
      assistantReply: { id: replyId, project_id: id, role: 'assistant', content: replyContent, created_at: replyTime },
      autonomousRun
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// ACCOUNT PROFILES & MULTI-ACCOUNT MANAGEMENT
// -------------------------------------------------------------

apiRouter.get('/account-profiles', (req, res) => {
  try {
    const profiles = AccountProfileManager.getAllProfiles();
    res.json(profiles);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/account-profiles-detected', (req, res) => {
  try {
    const accounts = AccountProfileManager.getDetectedSystemAccounts();
    res.json({ accounts });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/account-profiles/active', (req, res) => {
  try {
    const activeProfile = AccountProfileManager.getGlobalActiveProfile();
    res.json(activeProfile);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/account-profiles/active', (req, res) => {
  try {
    const { profileId } = req.body;
    if (!profileId) return res.status(400).json({ error: 'profileId é obrigatório' });
    AccountProfileManager.setGlobalActiveProfile(profileId);
    const active = AccountProfileManager.getGlobalActiveProfile();
    res.json(active);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/account-profiles/switch', async (req, res) => {
  try {
    const { projectId, targetProfileId } = req.body;
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

apiRouter.post('/account-profiles', (req, res) => {
  try {
    const { displayName, profileName, googleAccountLabel, autoLaunch = true } = req.body;
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

apiRouter.get('/account-profiles/:id', (req, res) => {
  try {
    const profile = AccountProfileManager.getProfile(req.params.id);
    if (!profile) return res.status(404).json({ error: 'Perfil não encontrado' });
    res.json(profile);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.patch('/account-profiles/:id', (req, res) => {
  try {
    const updated = AccountProfileManager.updateProfile(req.params.id, req.body);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.put('/account-profiles/:id', (req, res) => {
  try {
    const updated = AccountProfileManager.updateProfile(req.params.id, req.body);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.delete('/account-profiles/:id', (req, res) => {
  try {
    const deleteData = req.query.deleteData === 'true' || req.body?.deleteData === true;
    const result = AccountProfileManager.deleteProfile(req.params.id, { deleteData });
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.post('/account-profiles/:id/launch-login', (req, res) => {
  try {
    const result = AccountProfileManager.launchLogin(req.params.id);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/account-profiles/:id/verify', (req, res) => {
  try {
    const { email } = req.body || {};
    const result = AccountProfileManager.verifyProfile(req.params.id, email);
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
    const { targetProfileId } = req.body;
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
    const models = ModelRegistry.discoverModels();
    res.json(models);
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

apiRouter.post('/models/preferences', (req, res) => {
  try {
    const { role, modelId, accountProfileId, projectId } = req.body;
    if (!modelId) {
      return res.status(400).json({ error: 'modelId é obrigatório' });
    }
    ModelRegistry.setPreference({ role, modelId, accountProfileId, projectId });
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
      const ignore = new Set(['.git', '.ai-dev-hub', '.gemini', 'node_modules', 'dist', 'build', '.next', '.vscode']);
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
          try { size = fs.statSync(full).size; } catch {}
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

apiRouter.get('/projects/:id/file-content', (req, res) => {
  try {
    const { id } = req.params;
    const filePath = req.query.path as string;
    if (!filePath) {
      return res.status(400).json({ error: 'Parâmetro path é obrigatório' });
    }

    const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
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

    // 1. Stop any active autonomous run
    const runs = db.prepare("SELECT id FROM autonomous_runs WHERE project_id = ? AND status IN ('active', 'running', 'waiting_approval')").all(id) as any[];
    for (const r of runs) {
      try {
        AutonomousManager.stopRun(r.id);
      } catch {}
    }

    Logger.info(`[AgentStop] Execução interrompida para o projeto "${project.name}"`);
    res.json({
      success: true,
      message: 'Execução do agente interrompida com segurança'
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

    // Collect recent terminal/system logs and events
    const logs = db.prepare(`
      SELECT 'event' as type, title as command, description as output, created_at
      FROM activity_events
      WHERE project_id = ?
      ORDER BY created_at DESC
      LIMIT 30
    `).all(id) as any[];

    // Add recent git log as terminal reference
    let gitLog = '';
    try {
      gitLog = execSync('git log -5 --oneline', { cwd: project.path, encoding: 'utf-8', timeout: 3000 });
    } catch {}

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
    const { content } = req.body;
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
    } = req.body;

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
    } = req.body;

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

    const { hypothesis, filesChanged = [] } = req.body;
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
    } = req.body;

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
    } = req.body;

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
    } = req.body;

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
    const { customTestCommand } = req.body;
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

apiRouter.post('/benchmarks/run', async (req, res) => {
  try {
    const { versionLabel, gitCommit, isBaseline, candidateImplementations } = req.body;
    const run = await BenchmarkManager.runBenchmarkSuite({
      versionLabel: versionLabel || 'AI_DEV_V1',
      gitCommit,
      isBaseline: Boolean(isBaseline),
      candidateImplementations
    });
    res.json(run);
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
    const { versionLabel, gitCommit, isBaseline, model } = req.body;
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
    const { hypothesis, bottleneckIdentified, baselineRunId } = req.body;
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
    const { experimentId, candidateA, candidateB } = req.body;
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
    const { experimentId, candidateA, candidateB } = req.body;
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
    const { contract } = req.body;
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






