import express from 'express';
import cors from 'cors';
import { initDatabase, HUB_DATA_DIR } from './db.js';
import { apiRouter } from './routes.js';

const app = express();
const PORT = process.env.PORT || 4000;

// Strict local security: allow localhost/127.0.0.1 only, allow non-browser clients (CLI, agents, curl)
const allowedOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3001',
  'http://127.0.0.1:3001'
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (
      allowedOrigins.includes(origin) ||
      /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
    ) {
      return callback(null, true);
    }
    return callback(new Error('Bloqueado pela política de segurança local do AI DEV HUB: Origem não permitida.'));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '10mb' }));

// API routes
app.use('/api', apiRouter);

import path from 'node:path';
import fs from 'node:fs';

// Serve client build if dist exists
const candidatePaths = [
  process.env.CLIENT_DIST_PATH,
  path.resolve(process.cwd(), '../client/dist'),
  path.resolve(__dirname, '../../client/dist'),
  path.resolve(__dirname, '../client/dist')
].filter(Boolean) as string[];

const clientDistPath = candidatePaths.find(p => fs.existsSync(p));
if (clientDistPath) {
  app.use(express.static(clientDistPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
  console.log(`[AI DEV HUB] Serving static client build from ${clientDistPath}`);
} else {
  console.warn('[AI DEV HUB] Static client build directory not found in candidate paths.');
}

// Startup
initDatabase();
// Explicit test injection is fail-closed and only allowed in a temporary, isolated data directory.
// No test provider or successful response is installed by production startup.
if (process.env.DECOHUB_TEST_PROVIDER_MODULE) {
  const tempRoot = require('node:os').tmpdir();
  const relative = path.relative(path.resolve(tempRoot), path.resolve(HUB_DATA_DIR));
  if (process.env.DECOHUB_OFFLINE_MODE !== 'true' || !process.env.AI_DEV_HUB_DATA_DIR || !relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('TEST_PROVIDER_GUARD: test provider requires offline mode and temporary isolated data.');
  }
  require(path.resolve(process.env.DECOHUB_TEST_PROVIDER_MODULE));
}
import { Logger } from './logger.js';
import { AutonomousRunnerService } from './autonomousRunnerService.js';

const HOST = '127.0.0.1';
const server = app.listen(Number(PORT), HOST, () => {
  Logger.info(`AI DEV HUB Backend rodando na porta ${PORT} (${HOST})`);
  console.log(`[AI DEV HUB] Server running at http://${HOST}:${PORT}`);
  console.log(`[AI DEV HUB] API available at http://${HOST}:${PORT}/api`);

  // Start Autonomous Runner persistent background engine
  AutonomousRunnerService.start();

  // Reconcile any orphaned command executions on startup
  import('./commandExecutionEngine.js').then(({ CommandExecutionEngine }) => {
    const recovered = CommandExecutionEngine.reconcileOrphanedExecutions();
    if (recovered > 0) {
      Logger.info(`[AI DEV HUB] ${recovered} execuções de comandos órfãs foram reconciliadas no startup.`);
    }
  }).catch(() => {});

  // Initialize Auto-Update background verification service
  import('./updateService.js').then(({ UpdateService }) => {
    UpdateService.init();
  }).catch(() => {});

  // Recover any pending Autonomous Self-Improvement runs on startup
  import('./selfImprovementRun.js').then(({ AutonomousSelfImprovementEngine }) => {
    AutonomousSelfImprovementEngine.recoverPendingRunsOnStartup().catch(err => {
      Logger.warn(`[AI DEV HUB] Erro na recuperação de runs de Self-Improvement: ${err.message}`);
    });
  });
});

function gracefulShutdown() {
  Logger.info('[AI DEV HUB] Encerrando servidor e Autonomous Runner...');
  try {
    AutonomousRunnerService.stop();
  } catch {}
  server.close(() => {
    process.exit(0);
  });
}

process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? (reason.stack || reason.message) : String(reason);
  Logger.error(`[AI DEV HUB] Unhandled Promise Rejection capturada: ${msg}`);
});

process.on('uncaughtException', (err) => {
  Logger.error(`[AI DEV HUB] Uncaught Exception capturada: ${err.stack || err.message}`);
});

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
