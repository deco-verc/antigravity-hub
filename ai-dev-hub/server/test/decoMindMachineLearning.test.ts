// server/test/decoMindMachineLearning.test.ts
// Testes unitários e matemáticos rigorosos para o DecoMind ML Engine (Online Machine Learning & Reinforcement Learning)

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DecoMindMlService, TaskFeatures } from '../src/decoMindMlService.js';
import { isRawToolOrCommandOutput } from '../src/agentTurnState.js';
import { db } from '../src/db.js';

describe('DecoMind ML — Motor de Online Machine Learning & Reinforcement Learning', () => {
  before(() => {
    process.env.NODE_ENV = 'test';
    DecoMindMlService.ensureTables();
  });

  after(() => {
    // Limpeza de categorias de teste isoladas
    try {
      db.prepare('DELETE FROM ml_bandit_arms WHERE category LIKE ?').run('TEST_%');
      db.prepare('DELETE FROM ml_episodic_memories WHERE task_category LIKE ?').run('TEST_%');
      db.prepare('DELETE FROM ml_training_samples WHERE task_category LIKE ?').run('TEST_%');
    } catch {
      // Ignora falhas em teardown
    }
  });

  describe('1. Extração de Features Numéricas Normalizadas (x ∈ [0, 1]⁸)', () => {
    it('deve extrair vetor de 8 dimensões com valores estritamente entre 0 e 1', () => {
      const taskInput = {
        taskTitle: 'Construir rota POST /api/auth/login com JWT e bcrypt',
        taskDescription: 'Implementar endpoint seguro de autenticação com validação de credenciais no banco SQLite.',
        expectedFiles: ['server/src/routes/auth.ts', 'server/src/models/user.ts'],
        dependencies: ['setup-database', 'install-bcrypt'],
        attempts: 1,
        category: 'BACKEND'
      };

      const features = DecoMindMlService.extractTaskFeatures(taskInput);

      assert.ok(features, 'Features não podem ser nulas');
      assert.strictEqual(typeof features.taskComplexityScore, 'number');
      assert.strictEqual(typeof features.expectedFilesCount, 'number');
      assert.strictEqual(typeof features.historicalAttempts, 'number');
      assert.strictEqual(typeof features.dependenciesCount, 'number');
      assert.strictEqual(typeof features.categoryRiskPrior, 'number');
      assert.strictEqual(typeof features.previousReworkHistory, 'number');
      assert.strictEqual(typeof features.instructionAmbiguityScore, 'number');
      assert.strictEqual(typeof features.contextRotIndex, 'number');

      for (const [key, val] of Object.entries(features)) {
        assert.ok(val >= 0 && val <= 1, `Feature ${key} = ${val} deve estar no intervalo [0, 1]`);
      }
    });

    it('deve pontuar maior complexidade e ambiguidade para tarefas vagas ou de alto risco', () => {
      const vagueTask = {
        taskTitle: 'Ajustar coisas diversas e verificar se funciona',
        taskDescription: '',
        expectedFiles: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts', 'g.ts', 'h.ts'],
        dependencies: ['t1', 't2', 't3', 't4'],
        attempts: 3,
        category: 'DEVOPS'
      };

      const cleanTask = {
        taskTitle: 'Adicionar helper formatCurrency em utils.ts',
        taskDescription: 'Função pura que recebe number e retorna string BRL com Intl.NumberFormat e testes unitários.',
        expectedFiles: ['src/utils.ts'],
        dependencies: [],
        attempts: 0,
        category: 'FRONTEND'
      };

      const vagueFeat = DecoMindMlService.extractTaskFeatures(vagueTask);
      const cleanFeat = DecoMindMlService.extractTaskFeatures(cleanTask);

      assert.ok(vagueFeat.instructionAmbiguityScore > cleanFeat.instructionAmbiguityScore, 'Tarefa vaga deve ter maior ambiguidade');
      assert.ok(vagueFeat.historicalAttempts > cleanFeat.historicalAttempts, 'Tarefa com tentativas deve pontuar histórico maior');
      assert.ok(vagueFeat.expectedFilesCount > cleanFeat.expectedFilesCount, 'Múltiplos arquivos devem pontuar mais arquivos esperados');
    });
  });

  describe('2. Regressão Logística Online com SGD e Regularização L2', () => {
    it('deve calcular probabilidade sigmoidal P(Rework | x) ∈ [0, 1] e classificar risco em tiers', () => {
      const cleanFeatures: TaskFeatures = {
        taskComplexityScore: 0.1,
        expectedFilesCount: 0.1,
        historicalAttempts: 0.0,
        dependenciesCount: 0.0,
        categoryRiskPrior: 0.2,
        previousReworkHistory: 0.0,
        instructionAmbiguityScore: 0.1,
        contextRotIndex: 0.1
      };

      const highRiskFeatures: TaskFeatures = {
        taskComplexityScore: 0.9,
        expectedFilesCount: 0.8,
        historicalAttempts: 0.8,
        dependenciesCount: 0.7,
        categoryRiskPrior: 0.8,
        previousReworkHistory: 0.9,
        instructionAmbiguityScore: 0.8,
        contextRotIndex: 0.7
      };

      const cleanRisk = DecoMindMlService.predictReworkRisk(cleanFeatures);
      const highRisk = DecoMindMlService.predictReworkRisk(highRiskFeatures);

      assert.ok(cleanRisk.probability >= 0 && cleanRisk.probability <= 1, 'Probabilidade deve estar em [0, 1]');
      assert.ok(highRisk.probability >= 0 && highRisk.probability <= 1, 'Probabilidade deve estar em [0, 1]');
      assert.ok(
        highRisk.probability > cleanRisk.probability,
        `Risco alto (${highRisk.probability}) deve ser maior que o limpo (${cleanRisk.probability})`
      );

      assert.ok(['LOW', 'MEDIUM', 'ELEVATED', 'HIGH', 'CRITICAL'].includes(cleanRisk.riskTier));
      assert.ok(['LOW', 'MEDIUM', 'ELEVATED', 'HIGH', 'CRITICAL'].includes(highRisk.riskTier));
    });

    it('deve convergir pesos via SGD com amostras positivas (rework=1) e negativas (clean=0)', () => {
      const initialWeightsSnapshot = [...DecoMindMlService.loadLogisticWeights().weights];
      const initialSamples = DecoMindMlService.loadLogisticWeights().samplesSeen;

      const reworkFeatures: TaskFeatures = {
        taskComplexityScore: 0.95,
        expectedFilesCount: 0.85,
        historicalAttempts: 0.9,
        dependenciesCount: 0.8,
        categoryRiskPrior: 0.9,
        previousReworkHistory: 0.95,
        instructionAmbiguityScore: 0.85,
        contextRotIndex: 0.8
      };

      // Treinar com 5 amostras consecutivas de Rework (y = 1)
      let trainRes = null;
      for (let i = 0; i < 5; i++) {
        trainRes = DecoMindMlService.trainOnlineSGD(reworkFeatures, 1);
      }

      assert.ok(trainRes, 'Treinamento deve retornar resultado');
      assert.ok(typeof trainRes.loss === 'number', 'Loss deve ser um número');
      assert.ok(trainRes.samplesSeen >= initialSamples + 5, 'Contador de amostras deve aumentar');

      const updatedWeights = DecoMindMlService.loadLogisticWeights();
      assert.notDeepStrictEqual(updatedWeights.weights, initialWeightsSnapshot, 'Pesos devem ser atualizados após treinamento SGD');

      // Probabilidade recalculada para o perfil de rework deve ser alta
      const updatedProb = DecoMindMlService.predictReworkRisk(reworkFeatures);
      assert.ok(updatedProb.probability >= 0.5, 'Probabilidade de risco após treino com rework deve ser substancial');
    });
  });

  describe('3. Contextual Multi-Armed Bandit (Thompson Sampling + UCB1)', () => {
    const testCategory = 'TEST_BANDIT_CATEGORY';

    it('deve inicializar braços padrão para uma nova categoria com hiperparâmetros alpha/beta válidos', () => {
      const arms = DecoMindMlService.getOrCreateBanditArms(testCategory);
      assert.ok(Array.isArray(arms) && arms.length >= 3, 'Deve gerar pelo menos 3 braços de bandit');

      for (const arm of arms) {
        assert.strictEqual(arm.category, testCategory);
        assert.ok(arm.alpha > 0, 'Alpha deve ser > 0');
        assert.ok(arm.beta > 0, 'Beta deve ser > 0');
        assert.ok(['flash', 'pro', 'flash_lite'].includes(arm.model_tier));
        assert.ok(['LOW', 'MEDIUM', 'HIGH'].includes(arm.effort_level));
      }
    });

    it('deve atualizar parâmetros Bayesianos (Beta distribution) e favorecer braço vencedor', () => {
      const arms = DecoMindMlService.getOrCreateBanditArms(testCategory);
      const armToBoost = arms[0];
      const armToPenalize = arms[1];

      // Recompensar armToBoost com 8 sucessos consecutivos (R = 1)
      for (let i = 0; i < 8; i++) {
        DecoMindMlService.updateBanditArm(testCategory, armToBoost.model_tier, armToBoost.effort_level, 1.0);
      }

      // Penalizar armToPenalize com 8 falhas consecutivas (R = 0)
      for (let i = 0; i < 8; i++) {
        DecoMindMlService.updateBanditArm(testCategory, armToPenalize.model_tier, armToPenalize.effort_level, 0.0);
      }

      const refreshedArms = DecoMindMlService.getOrCreateBanditArms(testCategory);
      const boosted = refreshedArms.find(a => a.arm_key === armToBoost.arm_key)!;
      const penalized = refreshedArms.find(a => a.arm_key === armToPenalize.arm_key)!;

      assert.ok(boosted.alpha > armToBoost.alpha, 'Alpha do braço vitorioso deve aumentar');
      assert.ok(penalized.beta > armToPenalize.beta, 'Beta do braço penalizado deve aumentar');
      assert.ok(boosted.success_rate > penalized.success_rate, 'Taxa de sucesso do vitorioso deve ser superior');

      // Seleção ótima de braço deve escolher o braço vitorioso ou com alto UCB
      const selected = DecoMindMlService.selectOptimalArm(testCategory);
      assert.ok(selected, 'Deve retornar um braço selecionado');
      assert.ok(typeof selected.thompsonSample === 'number', 'Thompson sample deve ser numérico');
      assert.ok(typeof selected.ucbScore === 'number', 'UCB score deve ser numérico');
    });
  });

  describe('4. Memória Episódica Vetorial (TF-IDF / Cosseno) & Q-Learning', () => {
    const memCategory = 'TEST_EPISODIC_CAT';

    it('deve registrar memória episódica com vetor de assinaturas e recuperá-la por similaridade semântica', () => {
      const recorded = DecoMindMlService.recordEpisodicLesson({
        taskCategory: memCategory,
        taskDescription: 'Configurar servidor Express com body parser JSON e tratamento de erro de sintaxe',
        errorPattern: 'SyntaxError: Unexpected token in JSON at position 42',
        resolutionVaccine: 'Adicionar middleware customizado de erro express.json({ verify: ... }) e captura de SyntaxError',
        targetFiles: ['server/src/index.ts', 'server/src/middlewares/errorHandler.ts'],
        qValue: 0.65
      });

      assert.ok(recorded && recorded.id, 'Memória registrada deve possuir ID');
      assert.strictEqual(recorded.task_category, memCategory);

      // Buscar com termos semanticamente próximos
      const vaccines = DecoMindMlService.retrieveTopEpisodicVaccines(
        'Falha ao processar payload com express body parser e syntax error no JSON',
        memCategory,
        2
      );

      assert.ok(vaccines.length > 0, 'Deve recuperar pelo menos uma vacina episódica relevante');
      const topMatch = vaccines[0];
      assert.ok(topMatch.resolution_vaccine.includes('express.json'), 'Vacina recuperada deve conter a solução registrada');
      assert.ok(topMatch.error_pattern.includes('SyntaxError'), 'Vacina deve identificar o padrão de erro correspondente');
    });

    it('deve reforçar o Q-Value via Equação de Bellman / TD-Learning quando a vacina tiver sucesso', () => {
      const memory = DecoMindMlService.recordEpisodicLesson({
        taskCategory: memCategory,
        taskDescription: 'Tratar corrida de arquivos concorrentes com mutex ou lock no disco',
        errorPattern: 'EBUSY: resource busy or locked',
        resolutionVaccine: 'Utilizar proper-lockfile com retry options de 100ms e 5 tentativas',
        targetFiles: ['src/fileLock.ts'],
        qValue: 0.50
      });

      // Reforço com Recompensa Positiva (R = 1.0)
      const reinforcedSuccess = DecoMindMlService.reinforceEpisodicMemories([memory.id], 1.0);
      assert.ok(reinforcedSuccess.length > 0);
      assert.ok(reinforcedSuccess[0].q_value > 0.50, `Q-value deve crescer após sucesso (atual: ${reinforcedSuccess[0].q_value})`);

      // Reforço com Penalidade (R = 0.0)
      const reinforcedFailure = DecoMindMlService.reinforceEpisodicMemories([memory.id], 0.0);
      assert.ok(reinforcedFailure.length > 0);
      assert.ok(reinforcedFailure[0].q_value < reinforcedSuccess[0].q_value, 'Q-value deve decrescer após falha');
    });
  });

  describe('5. Guardrail Anti-Vazamento de Saídas de Terminal (isRawToolOrCommandOutput)', () => {
    it('deve bloquear blocos de saída de terminal raw (Created At, Command exited, run_command)', () => {
      const rawOutput1 = `Created At: 2026-10-22T03:57:27-03:00\nCompleted At: 2026-10-22T03:57:34-03:00\nCommand exited with code 1.\n\nCommand output:\nsrc/foo.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.`;
      const rawOutput2 = `Tool is running as a background task with task id: task-9999\nTask logs are available at: file:///path/to/log.log`;
      const rawOutput3 = `Command exited with code 0.`;

      assert.strictEqual(isRawToolOrCommandOutput(rawOutput1), true, 'Deve identificar saída crua de compilação como raw tool output');
      assert.strictEqual(isRawToolOrCommandOutput(rawOutput2), true, 'Deve identificar background task launch como raw tool output');
      assert.strictEqual(isRawToolOrCommandOutput(rawOutput3), true, 'Deve identificar exit code sem texto como raw tool output');
    });

    it('deve permitir mensagens legítimas com conclusões estruturadas e explicativas', () => {
      const normalResponse1 = `### Conclusão da Tarefa\n\nImplementamos com sucesso a autenticação JWT em auth.ts. Os testes unitários passaram com 100% de cobertura.`;
      const normalResponse2 = `Vou analisar o arquivo de configuração e corrigir os tipos TypeScript conforme solicitado.`;

      assert.strictEqual(isRawToolOrCommandOutput(normalResponse1), false, 'Não deve bloquear resposta explicativa com markdown');
      assert.strictEqual(isRawToolOrCommandOutput(normalResponse2), false, 'Não deve bloquear explicação narrativa do agente');
    });
  });

  describe('6. Coordenador de Alto Nível (recordTaskOutcome) & Telemetria', () => {
    it('deve processar desfecho de tarefa, registrar amostra de treino e atualizar telemetria', () => {
      const sample = {
        taskId: 'test-task-outcome-001',
        taskTitle: 'Refatorar middleware de segurança com rate limiting',
        taskDescription: 'Adicionar express-rate-limit nas rotas sensíveis',
        expectedFiles: ['server/src/routes/api.ts'],
        dependencies: ['init-express'],
        category: 'SECURITY',
        modelTier: 'flash' as const,
        effortLevel: 'HIGH' as const,
        outcome: 'APPROVED' as const,
        attempts: 1
      };

      const result = DecoMindMlService.recordTaskOutcome(sample);

      assert.ok(result.recorded, 'Amostra deve ser gravada com sucesso');
      assert.ok(result.reward >= 0 && result.reward <= 1, 'Recompensa deve estar em [0, 1]');
      assert.ok(result.newWeights, 'Pesos devem ser retornados');
      assert.ok(result.updatedArm, 'Braço bandit atualizado deve ser retornado');

      // Verificar telemetria consolidada
      const telemetry = DecoMindMlService.getMlTelemetryStatus();
      assert.ok(telemetry, 'Telemetria deve existir');
      assert.ok(typeof telemetry.samplesCount === 'number' && telemetry.samplesCount > 0, 'Contagem de amostras deve ser > 0');
      assert.ok(Array.isArray(telemetry.banditArms) && telemetry.banditArms.length > 0, 'Braços de bandit devem estar listados');
      assert.ok(typeof telemetry.weights.bias === 'number', 'Bias deve ser numérico');
    });

    it('deve registrar vacina episódica automaticamente quando tarefa for aprovada após retry/rework', () => {
      const reworkSample = {
        taskId: 'test-task-rework-vaccine-002',
        taskTitle: 'Configurar middleware de validação e tratar CORS',
        taskDescription: 'Adicionar headers CORS e responder OPTIONS',
        expectedFiles: ['server/src/server.ts'],
        dependencies: ['init-server'],
        category: 'BACKEND',
        modelTier: 'flash' as const,
        effortLevel: 'HIGH' as const,
        outcome: 'APPROVED' as const,
        attempts: 2,
        actualRework: 1,
        reworkCause: 'OPTIONS request returning 404 without headers',
        errorPattern: 'CORS_POLICY_ERROR: No Access-Control-Allow-Origin header',
        solutionVaccine: 'Middleware customizado com res.setHeader("Access-Control-Allow-Origin", "*") e retorno 204 em OPTIONS'
      };

      const result = DecoMindMlService.recordTaskOutcome(reworkSample);
      assert.ok(result.recorded, 'Amostra com rework deve ser gravada');

      const telemetry = DecoMindMlService.getMlTelemetryStatus();
      assert.ok(telemetry.episodicMemoriesCount > 0, 'Deve contabilizar vacinas episódicas aprendidas');

      const topMemories = telemetry.topEpisodicMemories;
      assert.ok(topMemories.some(m => m.error_pattern.includes('CORS_POLICY_ERROR')), 'Deve encontrar vacina para o erro de CORS');
    });

    it('autoBootstrapHistoricalMemories deve carregar memórias a partir de autonomous_tasks concluídas com retry', () => {
      const { DatabaseSync } = require('node:sqlite');
      const testDb = new DatabaseSync(':memory:');
      DecoMindMlService.ensureTables(testDb);

      testDb.exec(`
        CREATE TABLE autonomous_tasks (
          id TEXT PRIMARY KEY,
          title TEXT,
          description TEXT,
          skill_routed TEXT,
          status TEXT,
          retry_count INTEGER,
          attempt_history_json TEXT,
          review_result_json TEXT,
          updated_at TEXT
        );
      `);

      testDb.prepare(`
        INSERT INTO autonomous_tasks (
          id, title, description, skill_routed, status, retry_count, attempt_history_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'hist-task-1',
        'Modelar tabelas SaaS de Login e PIX',
        'Criação de schemas SQLite e migrations',
        'DATABASE',
        'completed',
        1,
        JSON.stringify([
          { attempt: 1, workerStatus: 'failure', knownProblems: ['[LSP_SYNTAX_ERROR] test/db.test.ts:7 - Module "node:assert/strict"'] },
          { attempt: 2, workerStatus: 'success', implemented: ['Importação universal com named import assert'] }
        ]),
        new Date().toISOString()
      );

      DecoMindMlService.autoBootstrapHistoricalMemories(testDb);

      const count = testDb.prepare('SELECT count(*) as c FROM ml_episodic_memories').get() as any;
      assert.strictEqual(count.c, 1, 'Deve ter feito bootstrap de 1 memória episódica histórica');

      const mem = testDb.prepare('SELECT * FROM ml_episodic_memories LIMIT 1').get() as any;
      assert.ok(mem.error_pattern.includes('LSP_SYNTAX_ERROR'), 'Padrão de erro deve ser capturado do histórico');
      assert.ok(mem.surgical_vaccine.includes('named import assert'), 'Solução deve ser extraída da tentativa vitoriosa');
    });

    it('deve fechar o ciclo de Q-Learning end-to-end: buildWorkerPrompt extrai retrievedMemoryIds e recordTaskOutcome reforça Q-value', () => {
      const testLesson = DecoMindMlService.recordEpisodicLesson({
        taskCategory: 'BACKEND',
        taskText: 'Construir endpoint POST /api/payment/checkout com stripe',
        errorPattern: 'STRIPE_API_CONNECTION_ERROR',
        surgicalVaccine: 'Configurar retry com backoff exponencial no client Stripe',
        qValue: 0.60
      });

      const { PromptArchitectureService } = require('../src/promptArchitectureService.js');
      const { prompt, meta } = PromptArchitectureService.buildWorkerPrompt({
        mode: 'IMPLEMENT',
        projectId: 'test-proj-ml',
        projectName: 'Test Proj',
        projectPath: process.cwd(),
        projectObjective: 'Test ML integration',
        taskTitle: 'Construir endpoint POST /api/payment/checkout',
        taskDescription: 'Adicionar integração com stripe',
        expectedScopeFiles: ['server/src/routes/payment.ts'],
        skillCategory: 'BACKEND'
      });

      assert.ok(meta.retrievedMemoryIds, 'meta deve conter retrievedMemoryIds');
      assert.ok(Array.isArray(meta.retrievedMemoryIds), 'retrievedMemoryIds deve ser um array');
      assert.ok(meta.retrievedMemoryIds.includes(testLesson.id), 'ID da vacina deve ser capturado no prompt worker');

      const initialMem: any = db.prepare('SELECT q_value, successes_after_retrieval FROM ml_episodic_memories WHERE id = ?').get(testLesson.id);
      assert.strictEqual(initialMem.q_value, 0.60);

      DecoMindMlService.recordTaskOutcome({
        taskId: 'task-test-payment-1',
        projectId: 'test-proj-ml',
        category: 'BACKEND',
        outcome: 'APPROVED',
        verdict: 'PASS',
        retrievedMemoryIds: [testLesson.id]
      });

      const updatedMem: any = db.prepare('SELECT q_value, successes_after_retrieval FROM ml_episodic_memories WHERE id = ?').get(testLesson.id);
      assert.ok(updatedMem.q_value > 0.60, `Q-value deve ter sido reforçado positivamente (atual: ${updatedMem.q_value})`);
      assert.strictEqual(updatedMem.successes_after_retrieval, initialMem.successes_after_retrieval + 1, 'successes_after_retrieval deve ser incrementado');
    });
  });
});
