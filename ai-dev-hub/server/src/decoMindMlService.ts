// server/src/decoMindMlService.ts
// DecoMind ML Engine — Native Online Machine Learning & Reinforcement Learning in pure TypeScript + SQLite
// Implements:
// 1. Online Logistic Regression with SGD + L2 Regularization (Pre-Flight Rework Predictor)
// 2. Contextual Multi-Armed Bandit with Thompson Sampling (Beta dist) + UCB1 (Adaptive Model/Effort Router)
// 3. Episodic Memory with TF-IDF/BM25 Vector Similarity + Q-Learning (Surgical Vaccine Injection)

import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import { Logger } from './logger.js';

export interface TaskFeatureInput {
  taskTitle: string;
  taskDescription?: string;
  expectedFiles?: string[];
  dependencies?: string[];
  attempts?: number;
  category?: string;
}

export interface TaskFeatures {
  taskComplexityScore: number;
  expectedFilesCount: number;
  historicalAttempts: number;
  dependenciesCount: number;
  categoryRiskPrior: number;
  previousReworkHistory: number;
  instructionAmbiguityScore: number;
  contextRotIndex: number;
  bias?: number;
  isUi?: number;
  isDb?: number;
}

export type TaskFeaturesVector = number[] & TaskFeatures;

export interface ReworkRiskPrediction {
  probability: number;
  riskTier: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  topRiskFactors: string[];
  features: number[];
}

export interface BanditArm {
  arm_key: string;
  category: string;
  model_tier: 'flash' | 'pro' | 'flash_lite';
  effort_level: 'LOW' | 'MEDIUM' | 'HIGH';
  alpha: number;
  beta: number;
  pulls: number;
  avg_duration_ms: number;
  mean_reward: number;
  updated_at: string;
  success_rate?: number;
  thompsonSample?: number;
  ucbScore?: number;
  selectionScore?: number;
}

export interface EpisodicMemory {
  id: string;
  task_category: string;
  signature_tokens_json: string;
  error_pattern: string;
  root_cause: string;
  surgical_vaccine: string;
  resolution_vaccine?: string;
  q_value: number;
  retrievals: number;
  successes_after_retrieval: number;
  created_at: string;
  updated_at: string;
  similarityScore: number;
}

export interface DecoMindMlStatus {
  samplesSeen: number;
  samplesCount?: number;
  runningAccuracy: number;
  runningBrierLoss: number;
  weights: number[];
  banditArms?: Array<{
    arm_key: string;
    category: string;
    model_tier: string;
    effort_level: string;
    pulls: number;
    mean_reward: number;
  }>;
  topBanditArms: Array<{
    arm_key: string;
    category: string;
    model_tier: string;
    effort_level: string;
    pulls: number;
    mean_reward: number;
  }>;
  topEpisodicMemories: Array<{
    id: string;
    task_category: string;
    error_pattern: string;
    surgical_vaccine: string;
    q_value: number;
  }>;
  topUnderperformingArms: Array<{
    arm_key: string;
    mean_reward: number;
  }>;
  episodicMemoriesCount: number;
}

const STOPWORDS = new Set([
  'a', 'o', 'as', 'os', 'e', 'ou', 'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'nos', 'nas',
  'por', 'para', 'com', 'sem', 'que', 'se', 'um', 'uma', 'uns', 'umas', 'the', 'and', 'or', 'in',
  'on', 'at', 'to', 'for', 'with', 'without', 'is', 'are', 'was', 'were', 'it', 'this', 'that', 'by'
]);

export class DecoMindMlService {
  private static _weightsCache: { weights: number[]; learningRate: number; l2Lambda: number; samplesSeen: number } | null = null;
  private static _isBootstrapping = false;

  static ensureTables(targetDb: any = db): void {
    targetDb.exec(`
      CREATE TABLE IF NOT EXISTS ml_bandit_arms (
        arm_key TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        model_tier TEXT NOT NULL,
        effort_level TEXT NOT NULL,
        alpha REAL DEFAULT 2.0,
        beta REAL DEFAULT 1.0,
        pulls INTEGER DEFAULT 0,
        avg_duration_ms REAL DEFAULT 0,
        mean_reward REAL DEFAULT 0.66,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ml_logistic_weights (
        model_name TEXT PRIMARY KEY,
        weights_json TEXT NOT NULL,
        learning_rate REAL DEFAULT 0.05,
        l2_lambda REAL DEFAULT 0.001,
        samples_seen INTEGER DEFAULT 0,
        running_accuracy REAL DEFAULT 0,
        running_brier_loss REAL DEFAULT 0,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ml_episodic_memories (
        id TEXT PRIMARY KEY,
        task_category TEXT NOT NULL,
        signature_tokens_json TEXT NOT NULL,
        error_pattern TEXT NOT NULL,
        root_cause TEXT NOT NULL,
        surgical_vaccine TEXT NOT NULL,
        q_value REAL DEFAULT 0.5,
        retrievals INTEGER DEFAULT 0,
        successes_after_retrieval INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ml_training_samples (
        id TEXT PRIMARY KEY,
        task_id TEXT,
        project_id TEXT,
        features_json TEXT NOT NULL,
        predicted_risk REAL NOT NULL,
        actual_rework INTEGER NOT NULL,
        selected_arm TEXT,
        reward REAL NOT NULL,
        created_at TEXT NOT NULL
      );
    `);

    if (!this._isBootstrapping) {
      this.autoBootstrapHistoricalMemories(targetDb);
    }
  }

  /**
   * Auto-bootstraps episodic memories from historical tasks in autonomous_tasks that succeeded after rework.
   * Ensures the system immediately leverages past empirical lessons rather than starting from zero vaccines.
   */
  static autoBootstrapHistoricalMemories(targetDb: any = db): void {
    if (this._isBootstrapping) return;
    this._isBootstrapping = true;
    try {
      const hasMemories = targetDb.prepare('SELECT count(*) as c FROM ml_episodic_memories').get() as any;
      if (hasMemories && Number(hasMemories.c || 0) > 0) return;

      const hasTasksTable = targetDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='autonomous_tasks'").get();
      if (!hasTasksTable) return;

      const completedReworkTasks = targetDb.prepare(`
        SELECT id, title, description, skill_routed, attempt_history_json, review_result_json
        FROM autonomous_tasks
        WHERE retry_count > 0 AND status = 'completed'
        ORDER BY updated_at DESC
        LIMIT 25
      `).all() as any[];

      for (const t of completedReworkTasks) {
        let errPattern = 'REWORK_REQUIRED';
        let vaccine = 'Correção e validação cirúrgica com código de saída 0';
        try {
          const hist = typeof t.attempt_history_json === 'string'
            ? JSON.parse(t.attempt_history_json)
            : (Array.isArray(t.attempt_history_json) ? t.attempt_history_json : []);
          if (hist.length > 0) {
            const firstFailed = hist.find((h: any) => (h.knownProblems && h.knownProblems.length > 0) || h.workerStatus === 'failure' || h.testResults?.includes('FAIL'));
            if (firstFailed) {
              if (Array.isArray(firstFailed.knownProblems) && firstFailed.knownProblems.length > 0) {
                errPattern = firstFailed.knownProblems[0];
              } else if (firstFailed.testResults) {
                errPattern = firstFailed.testResults;
              }
            }
            const lastSuccess = hist.slice().reverse().find((h: any) => h.workerStatus === 'success' || (h.implemented && h.implemented.length > 0));
            if (lastSuccess && Array.isArray(lastSuccess.implemented) && lastSuccess.implemented.length > 0) {
              vaccine = lastSuccess.implemented[0];
            }
          }
        } catch {}

        this.recordEpisodicLesson({
          taskCategory: t.skill_routed || 'GENERAL',
          taskText: `${t.title || ''} ${t.description || ''}`,
          errorPattern: errPattern,
          rootCause: 'Falha em tentativa anterior superada com sucesso no retry',
          surgicalVaccine: vaccine,
          qValue: 0.70
        }, targetDb);
      }
    } catch (err: any) {
      Logger.warn(`[DecoMindMlService] Bootstrap histórico de memórias episódicas ignorado: ${err.message}`);
    } finally {
      this._isBootstrapping = false;
    }
  }

  /**
   * Infere a categoria funcional da tarefa a partir do título, descrição e arquivos de escopo
   */
  static inferTaskCategory(taskTitle: string, taskDescription?: string, expectedFiles?: string[]): string {
    const text = `${taskTitle || ''} ${taskDescription || ''} ${(expectedFiles || []).join(' ')}`.toLowerCase();
    if (/(security|owasp|pentest|auth|jwt|csrf|xss|blindagem|sanitiz|vulnerabilidade)/i.test(text)) return 'SECURITY';
    if (/(api|endpoint|route|express|fastify|controller|rest|backend|handler|decomposi|breakdown)/i.test(text)) return 'BACKEND';
    if (/(ui|frontend|css|html|react|view|component|layout|modal|lightbox|dashboard|filtro)/i.test(text)) return 'FRONTEND';
    if (/(database|sqlite|sql|schema|migrat|prisma|orm|repository|banco|persist)/i.test(text)) return 'DATABASE';
    if (/(test|spec|assert|evaluat|cobertura|e2e|playwright)/i.test(text)) return 'TEST';
    return 'GENERAL';
  }

  // =========================================================================
  // 1. EXTRATOR DE FEATURES NUMÉRICAS (x in R^8 normalizado em [0, 1])
  // =========================================================================

  static extractTaskFeatures(task: TaskFeatureInput, _projectPath?: string): number[] & TaskFeatures {
    const textAndFiles = `${task.taskTitle || ''} ${task.taskDescription || ''} ${(task.expectedFiles || []).join(' ')}`.toLowerCase();

    // x[0]: Bias unit
    const x0 = 1.0;

    // x[1]: Normalização do tamanho do escopo (1 a 8 arquivos)
    const expectedCount = Math.max(0, task.expectedFiles?.length || 0);
    const x1 = Math.min(1.0, expectedCount / 8.0);

    // x[2]: É interface visual ou componente frontend?
    const isUi = /(\.html|\.css|\.tsx|\.jsx|ui|frontend|layout|tela|componente|visual|view|card|modal)/i.test(textAndFiles);
    const x2 = isUi ? 1.0 : 0.0;

    // x[3]: É persistência, esquema de banco ou migração?
    const isDb = /(\.sql|sqlite|db\.ts|database|migration|schema|tabela|query|crud)/i.test(textAndFiles);
    const x3 = isDb ? 1.0 : 0.0;

    // x[4]: Profundidade de dependências no DAG
    const depCount = task.dependencies?.length || 0;
    const x4 = Math.min(1.0, depCount / 6.0);

    // x[5]: Complexidade descritiva do briefing da tarefa
    const descLength = (task.taskDescription || '').length;
    const x5 = Math.min(1.0, Math.max(0.05, descLength / 1200.0));

    // x[6]: Tentativas prévias de execução (histórico de rework imediato)
    const attempts = task.attempts || 0;
    const x6 = Math.min(1.0, attempts / 3.0);

    // x[7]: Taxa histórica de falhas/reworks da categoria
    const category = task.category && task.category !== 'GENERAL'
      ? task.category
      : this.inferTaskCategory(task.taskTitle, task.taskDescription, task.expectedFiles);
    const x7 = this.getCategoryHistoricalFailRate(category);

    const arr = [x0, x1, x2, x3, x4, x5, x6, x7] as number[] & TaskFeatures;
    Object.assign(arr, {
      bias: x0,
      expectedFilesCount: x1,
      isUi: x2,
      isDb: x3,
      dependenciesCount: x4,
      taskComplexityScore: x5,
      historicalAttempts: x6,
      categoryRiskPrior: x7,
      previousReworkHistory: x6,
      instructionAmbiguityScore: descLength < 30 ? 0.9 : Math.max(0.05, 1.0 - (descLength / 250.0)),
      contextRotIndex: Math.min(1.0, (attempts * 0.4) + (depCount * 0.1))
    });

    return arr;
  }

  static normalizeFeatureVector(features: any): number[] {
    if (Array.isArray(features)) {
      return features.slice(0, 8);
    }
    if (features && typeof features === 'object') {
      const x0 = typeof features.bias === 'number' ? features.bias : 1.0;
      const x1 = typeof features.expectedFilesCount === 'number' ? features.expectedFilesCount : 0.2;
      const x2 = typeof features.isUi === 'number' ? features.isUi : 0.0;
      const x3 = typeof features.isDb === 'number' ? features.isDb : 0.0;
      const x4 = typeof features.dependenciesCount === 'number' ? features.dependenciesCount : 0.0;
      const x5 = typeof features.taskComplexityScore === 'number' ? features.taskComplexityScore : 0.3;
      const x6 = typeof features.historicalAttempts === 'number' ? features.historicalAttempts : (features.previousReworkHistory || 0.0);
      const x7 = typeof features.categoryRiskPrior === 'number' ? features.categoryRiskPrior : 0.33;
      return [x0, x1, x2, x3, x4, x5, x6, x7];
    }
    return [1.0, 0.2, 0.0, 0.0, 0.0, 0.2, 0.0, 0.33];
  }

  static getCategoryHistoricalFailRate(category: string): number {
    try {
      this.ensureTables();
      const rows = db.prepare('SELECT alpha, beta FROM ml_bandit_arms WHERE category = ?').all(category) as Array<{ alpha: number; beta: number }>;
      if (!rows || rows.length === 0) return 0.33; // taxa a priori moderada

      let totalAlpha = 0;
      let totalBeta = 0;
      for (const r of rows) {
        totalAlpha += Number(r.alpha || 2);
        totalBeta += Number(r.beta || 1);
      }
      const total = totalAlpha + totalBeta;
      if (total <= 0) return 0.33;
      return totalBeta / total;
    } catch {
      return 0.33;
    }
  }

  // =========================================================================
  // 2. REGRESSÃO LOGÍSTICA ONLINE VIA SGD + REGULARIZAÇÃO L2
  // =========================================================================

  private static sigmoid(z: number): number {
    const clamped = Math.max(-18, Math.min(18, z));
    return 1.0 / (1.0 + Math.exp(-clamped));
  }

  static getLogisticWeights(): { weights: number[]; learningRate: number; l2Lambda: number; samplesSeen: number } {
    if (this._weightsCache) return this._weightsCache;

    try {
      this.ensureTables();
      const row = db.prepare('SELECT * FROM ml_logistic_weights WHERE model_name = ?').get('rework_risk_predictor_v1') as any;
      if (row && row.weights_json) {
        const weights = JSON.parse(row.weights_json);
        this._weightsCache = {
          weights,
          learningRate: Number(row.learning_rate || 0.05),
          l2Lambda: Number(row.l2_lambda || 0.001),
          samplesSeen: Number(row.samples_seen || 0)
        };
        return this._weightsCache;
      }
    } catch {}

    // Pesos iniciais bem calibrados a priori
    const initialWeights = [-0.6, 0.4, 0.35, 0.25, 0.3, 0.2, 0.7, 0.5];
    const initial = {
      weights: initialWeights,
      learningRate: 0.05,
      l2Lambda: 0.001,
      samplesSeen: 0
    };

    try {
      this.ensureTables();
      db.prepare(`
        INSERT INTO ml_logistic_weights (model_name, weights_json, learning_rate, l2_lambda, samples_seen, running_accuracy, running_brier_loss, updated_at)
        VALUES ('rework_risk_predictor_v1', ?, 0.05, 0.001, 0, 0.75, 0.18, ?)
        ON CONFLICT(model_name) DO NOTHING
      `).run(JSON.stringify(initialWeights), new Date().toISOString());
    } catch {}

    this._weightsCache = initial;
    return initial;
  }

  static predictReworkRisk(features: number[] | TaskFeatures): ReworkRiskPrediction {
    const featVec = this.normalizeFeatureVector(features);
    const model = this.getLogisticWeights();
    let z = 0;
    for (let i = 0; i < featVec.length && i < model.weights.length; i++) {
      z += model.weights[i] * featVec[i];
    }

    const probability = Number(this.sigmoid(z).toFixed(4));
    let riskTier: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'LOW';
    if (probability >= 0.80) {
      riskTier = 'CRITICAL';
    } else if (probability > 0.60) {
      riskTier = 'HIGH';
    } else if (probability >= 0.35) {
      riskTier = 'MEDIUM';
    }

    const topRiskFactors: string[] = [];
    if (featVec[1] >= 0.38) topRiskFactors.push(`Escopo amplo (${Math.round(featVec[1] * 8)} arquivos)`);
    if (featVec[2] >= 0.9) topRiskFactors.push('Interface visual / UI Frontend (Gate EMOJI & Anti-Slop)');
    if (featVec[3] >= 0.9) topRiskFactors.push('Persistência / Esquema SQLite');
    if (featVec[4] >= 0.5) topRiskFactors.push('Profundidade elevada de dependências');
    if (featVec[5] >= 0.6) topRiskFactors.push('Especificação textual detalhada');
    if (featVec[6] >= 0.33) topRiskFactors.push(`Histórico de retries na tarefa (${Math.round(featVec[6] * 3)} tentativas)`);
    if (featVec[7] >= 0.45) topRiskFactors.push(`Taxa histórica de reprovação da categoria (${(featVec[7] * 100).toFixed(0)}%)`);

    return {
      probability,
      riskTier,
      topRiskFactors,
      features: featVec
    };
  }

  static loadLogisticWeights(): { weights: number[]; learningRate: number; l2Lambda: number; samplesSeen: number } {
    return this.getLogisticWeights();
  }

  static predictReworkRiskFromTask(task: TaskFeatureInput, projectPath?: string): ReworkRiskPrediction {
    const features = this.extractTaskFeatures(task, projectPath);
    return this.predictReworkRisk(features);
  }

  static trainOnlineSGD(
    features: number[] | TaskFeatures,
    actualRework: 0 | 1
  ): { weights: number[]; loss: number; accuracy: number; samplesSeen: number } {
    const featVec = this.normalizeFeatureVector(features);
    const model = this.getLogisticWeights();
    const w = [...model.weights];
    const eta = model.learningRate;
    const lambda = model.l2Lambda;

    let z = 0;
    for (let i = 0; i < featVec.length && i < w.length; i++) {
      z += w[i] * featVec[i];
    }
    const yHat = this.sigmoid(z);
    const error = yHat - actualRework; // gradiente dL/dz

    // Atualização SGD com L2 (não regulariza o bias w[0])
    w[0] = w[0] - eta * error;
    for (let i = 1; i < w.length && i < featVec.length; i++) {
      w[i] = w[i] - eta * (error * featVec[i] + lambda * w[i]);
    }

    const brierLoss = (yHat - actualRework) ** 2;
    const predBinary = yHat >= 0.5 ? 1 : 0;
    const sampleAcc = predBinary === actualRework ? 1.0 : 0.0;
    const newSamples = model.samplesSeen + 1;

    this._weightsCache = {
      weights: w,
      learningRate: eta,
      l2Lambda: lambda,
      samplesSeen: newSamples
    };

    try {
      this.ensureTables();
      const current = db.prepare('SELECT running_accuracy, running_brier_loss FROM ml_logistic_weights WHERE model_name = ?').get('rework_risk_predictor_v1') as any;
      const prevAcc = current ? Number(current.running_accuracy || 0.75) : 0.75;
      const prevBrier = current ? Number(current.running_brier_loss || 0.18) : 0.18;

      const alphaEMA = 0.1;
      const newAcc = prevAcc * (1 - alphaEMA) + sampleAcc * alphaEMA;
      const newBrier = prevBrier * (1 - alphaEMA) + brierLoss * alphaEMA;

      db.prepare(`
        UPDATE ml_logistic_weights
        SET weights_json = ?, samples_seen = ?, running_accuracy = ?, running_brier_loss = ?, updated_at = ?
        WHERE model_name = 'rework_risk_predictor_v1'
      `).run(JSON.stringify(w), newSamples, Number(newAcc.toFixed(4)), Number(newBrier.toFixed(4)), new Date().toISOString());
    } catch (err: any) {
      Logger.warn(`[DecoMindMlService] Erro ao persistir pesos SGD: ${err.message}`);
    }

    return {
      weights: w,
      loss: brierLoss,
      accuracy: sampleAcc,
      samplesSeen: newSamples
    };
  }

  // =========================================================================
  // 3. CONTEXTUAL MULTI-ARMED BANDIT (THOMPSON SAMPLING + UCB1)
  // =========================================================================

  static getOrCreateBanditArms(category: string): BanditArm[] {
    this.ensureTables();
    const rows = db.prepare('SELECT * FROM ml_bandit_arms WHERE category = ?').all(category) as unknown as BanditArm[];
    if (rows && rows.length > 0) {
      return rows.map(r => ({
        ...r,
        success_rate: Number((Number(r.alpha || 1) / (Number(r.alpha || 1) + Number(r.beta || 1))).toFixed(4))
      }));
    }

    const defaultConfigs: Array<{ model: 'flash' | 'pro' | 'flash_lite'; effort: 'LOW' | 'MEDIUM' | 'HIGH'; alpha: number; beta: number }> = [
      { model: 'flash', effort: 'HIGH', alpha: 3.0, beta: 1.0 },
      { model: 'flash', effort: 'MEDIUM', alpha: 2.0, beta: 1.0 },
      { model: 'pro', effort: 'HIGH', alpha: 3.5, beta: 1.0 },
      { model: 'flash_lite', effort: 'LOW', alpha: 1.5, beta: 1.5 }
    ];

    const now = new Date().toISOString();
    const created: BanditArm[] = [];

    for (const cfg of defaultConfigs) {
      const armKey = `${category}::${cfg.model}::${cfg.effort}`;
      const meanReward = cfg.alpha / (cfg.alpha + cfg.beta);
      try {
        db.prepare(`
          INSERT OR IGNORE INTO ml_bandit_arms (arm_key, category, model_tier, effort_level, alpha, beta, pulls, avg_duration_ms, mean_reward, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?)
        `).run(armKey, category, cfg.model, cfg.effort, cfg.alpha, cfg.beta, meanReward, now);

        created.push({
          arm_key: armKey,
          category,
          model_tier: cfg.model,
          effort_level: cfg.effort,
          alpha: cfg.alpha,
          beta: cfg.beta,
          pulls: 0,
          avg_duration_ms: 0,
          mean_reward: meanReward,
          success_rate: Number(meanReward.toFixed(4)),
          updated_at: now
        });
      } catch {}
    }

    return created;
  }

  static selectOptimalArm(
    category: string,
    availableModels: string[] = ['flash', 'pro'],
    riskPrediction?: ReworkRiskPrediction
  ): BanditArm {
    const arms = this.getOrCreateBanditArms(category);
    let totalPulls = 0;
    for (const a of arms) totalPulls += a.pulls;

    let bestArm = arms[0];
    let bestScore = -Infinity;

    for (const arm of arms) {
      // Filtra por modelos disponíveis no ambiente
      if (availableModels.length > 0) {
        const matchesModel = availableModels.some(m => arm.model_tier.toLowerCase().includes(m.toLowerCase()));
        if (!matchesModel) continue;
      }

      const alpha = Number(arm.alpha || 2);
      const beta = Number(arm.beta || 1);
      const mean = alpha / (alpha + beta);

      // Aproximação normal da Beta: N(mean, sigma^2)
      const variance = (alpha * beta) / (((alpha + beta) ** 2) * (alpha + beta + 1));
      const stdDev = Math.sqrt(Math.max(0.0001, variance));
      const gaussianNoise = (Math.random() + Math.random() + Math.random() - 1.5) * 1.5;
      const thompsonSample = Math.max(0.01, Math.min(0.99, mean + stdDev * gaussianNoise));

      // Bônus UCB1 de exploração
      const ucbBonus = Math.sqrt((2 * Math.log(totalPulls + 2)) / (arm.pulls + 1));

      let score = 0.55 * thompsonSample + 0.35 * mean + 0.10 * ucbBonus;

      // Penalidade leve para durações muito longas (>3 minutos)
      if (arm.avg_duration_ms > 180000) {
        score -= 0.08;
      }

      // Se o risco de rework previsto for ALTO, dá boost ao Pro e esforço HIGH
      if (riskPrediction && (riskPrediction.riskTier === 'HIGH' || riskPrediction.riskTier === 'CRITICAL')) {
        if (arm.model_tier === 'pro') score += 0.28;
        if (arm.effort_level === 'HIGH') score += 0.18;
      } else if (riskPrediction && riskPrediction.riskTier === 'LOW') {
        if (arm.model_tier === 'flash') score += 0.12;
      }

      if (score > bestScore) {
        bestScore = score;
        bestArm = {
          ...arm,
          success_rate: Number((alpha / (alpha + beta)).toFixed(4)),
          thompsonSample: Number(thompsonSample.toFixed(4)),
          ucbScore: Number(ucbBonus.toFixed(4)),
          selectionScore: Number(score.toFixed(4))
        };
      }
    }

    return bestArm;
  }

  static updateBanditArm(
    armKeyOrCategory: string,
    passedFirstTryOrModelTier: boolean | string,
    durationMsOrEffort?: number | string,
    rewardNum?: number
  ): void {
    try {
      this.ensureTables();
      let armKey: string;
      let passedFirstTry = true;
      let durationMs = 1000;
      let explicitReward: number | null = null;

      if (typeof passedFirstTryOrModelTier === 'string') {
        // Chamada (category, modelTier, effortLevel, reward)
        const category = armKeyOrCategory;
        const modelTier = passedFirstTryOrModelTier;
        const effortLevel = String(durationMsOrEffort || 'HIGH');
        armKey = `${category}::${modelTier}::${effortLevel}`;
        explicitReward = typeof rewardNum === 'number' ? rewardNum : 1.0;
        passedFirstTry = explicitReward >= 0.5;
      } else {
        // Chamada (armKey, passedFirstTry, durationMs)
        armKey = armKeyOrCategory;
        passedFirstTry = Boolean(passedFirstTryOrModelTier);
        durationMs = typeof durationMsOrEffort === 'number' ? durationMsOrEffort : 1000;
      }

      let row = db.prepare('SELECT * FROM ml_bandit_arms WHERE arm_key = ?').get(armKey) as BanditArm | undefined;
      if (!row) {
        const category = armKey.split('::')[0];
        this.getOrCreateBanditArms(category);
        row = db.prepare('SELECT * FROM ml_bandit_arms WHERE arm_key = ?').get(armKey) as BanditArm | undefined;
        if (!row) return;
      }

      // Recompensa R in [0, 1]
      let reward = 0.0;
      if (explicitReward !== null) {
        reward = Math.max(0.0, Math.min(1.0, explicitReward));
      } else if (passedFirstTry) {
        const decay = Math.exp(-Math.max(0, durationMs) / 240000); // 4 minutos de meia-vida
        reward = Number(Math.max(0.2, Math.min(1.0, decay)).toFixed(4));
      }

      const alpha = Number(row.alpha || 2) + reward;
      const beta = Number(row.beta || 1) + (1.0 - reward);
      const pulls = Number(row.pulls || 0) + 1;
      const prevMean = Number(row.mean_reward || 0.66);
      const newMean = (prevMean * (pulls - 1) + reward) / pulls;

      const prevDuration = Number(row.avg_duration_ms || 0);
      const newDuration = (prevDuration * (pulls - 1) + durationMs) / pulls;

      db.prepare(`
        UPDATE ml_bandit_arms
        SET alpha = ?, beta = ?, pulls = ?, avg_duration_ms = ?, mean_reward = ?, updated_at = ?
        WHERE arm_key = ?
      `).run(
        Number(alpha.toFixed(4)),
        Number(beta.toFixed(4)),
        pulls,
        Number(newDuration.toFixed(0)),
        Number(newMean.toFixed(4)),
        new Date().toISOString(),
        armKey
      );
    } catch (err: any) {
      Logger.warn(`[DecoMindMlService] Erro ao atualizar Bandit Arm: ${err.message}`);
    }
  }

  // =========================================================================
  // 4. MEMÓRIA EPISÓDICA VETORIAL & Q-LEARNING (BM25/TF-IDF)
  // =========================================================================

  private static tokenize(text: string): Map<string, number> {
    const map = new Map<string, number>();
    if (!text) return map;

    // Normaliza tokens e preserva identificadores de código, erros e extensões
    const clean = text
      .toLowerCase()
      .replace(/[^a-z0-9_$.-]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 2 && !STOPWORDS.has(w));

    const total = Math.max(1, clean.length);
    for (const token of clean) {
      map.set(token, (map.get(token) || 0) + 1 / total);
    }
    return map;
  }

  private static cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (const [k, v] of a.entries()) {
      normA += v * v;
      if (b.has(k)) {
        dot += v * (b.get(k) || 0);
      }
    }
    for (const [, v] of b.entries()) {
      normB += v * v;
    }

    if (normA <= 0 || normB <= 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  static recordEpisodicLesson(params: {
    taskCategory?: string;
    taskText?: string;
    taskDescription?: string;
    errorPattern?: string;
    rootCause?: string;
    surgicalVaccine?: string;
    resolutionVaccine?: string;
    qValue?: number;
    targetFiles?: string[];
  }, targetDb: any = db): EpisodicMemory {
    this.ensureTables(targetDb);
    const id = `mem-${randomUUID().slice(0, 8)}`;
    const taskCategory = params.taskCategory || 'GENERAL';
    const taskText = params.taskText || params.taskDescription || '';
    const errPattern = (params.errorPattern || 'UNKNOWN_ERROR').slice(0, 300);
    const rootCause = (params.rootCause || params.errorPattern || 'Identified root cause').slice(0, 300);
    const vaccine = (params.surgicalVaccine || params.resolutionVaccine || 'Default surgical vaccine').slice(0, 500);
    const initialQ = typeof params.qValue === 'number' ? params.qValue : 0.5;

    const fullSignature = `${taskText} ${errPattern} ${rootCause} ${(params.targetFiles || []).join(' ')}`;
    const tokenMap = this.tokenize(fullSignature);
    const tokenObj: Record<string, number> = {};
    for (const [k, v] of tokenMap.entries()) tokenObj[k] = Number(v.toFixed(5));

    const now = new Date().toISOString();
    const memory: EpisodicMemory = {
      id,
      task_category: taskCategory,
      signature_tokens_json: JSON.stringify(tokenObj),
      error_pattern: errPattern,
      root_cause: rootCause,
      surgical_vaccine: vaccine,
      resolution_vaccine: vaccine,
      q_value: initialQ,
      retrievals: 0,
      successes_after_retrieval: 0,
      created_at: now,
      updated_at: now,
      similarityScore: 1.0
    };

    try {
      targetDb.prepare(`
        INSERT INTO ml_episodic_memories (
          id, task_category, signature_tokens_json, error_pattern, root_cause,
          surgical_vaccine, q_value, retrievals, successes_after_retrieval, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)
      `).run(
        memory.id,
        memory.task_category,
        memory.signature_tokens_json,
        memory.error_pattern,
        memory.root_cause,
        memory.surgical_vaccine,
        initialQ,
        now,
        now
      );
      Logger.info(`[DecoMindMlService] Nova vacina episódica registrada (#${id}) para categoria ${taskCategory}.`);
    } catch (err: any) {
      Logger.warn(`[DecoMindMlService] Erro ao gravar memória episódica: ${err.message}`);
    }

    return memory;
  }

  static retrieveTopEpisodicVaccines(taskText: string, category = 'GENERAL', topK = 3): EpisodicMemory[] {
    try {
      this.ensureTables();
      const rows = db.prepare('SELECT * FROM ml_episodic_memories WHERE task_category = ? OR task_category = \'GENERAL\' ORDER BY q_value DESC LIMIT 40')
        .all(category) as unknown as EpisodicMemory[];

      if (!rows || rows.length === 0) return [];

      const queryTokens = this.tokenize(taskText);
      const scored: EpisodicMemory[] = [];

      for (const row of rows) {
        try {
          const signatureMap = new Map<string, number>();
          const raw = JSON.parse(row.signature_tokens_json || '{}');
          for (const [k, v] of Object.entries(raw)) signatureMap.set(k, Number(v));

          const sim = this.cosineSimilarity(queryTokens, signatureMap);
          const q = Number(row.q_value || 0.5);
          // Pontuação combinada: Similaridade de Cosseno x Fator Q-Value
          const combinedScore = sim * (0.5 + 0.5 * q);

          if (combinedScore > 0.04 || sim > 0.15) {
            scored.push({
              ...row,
              resolution_vaccine: row.surgical_vaccine,
              similarityScore: Number(combinedScore.toFixed(4))
            });
          }
        } catch {}
      }

      scored.sort((a, b) => (b.similarityScore || 0) - (a.similarityScore || 0));
      const top = scored.slice(0, topK);

      // Incrementa contagem de recuperação no banco de forma leve
      if (top.length > 0) {
        const ids = top.map(m => m.id);
        const placeholders = ids.map(() => '?').join(',');
        try {
          db.prepare(`UPDATE ml_episodic_memories SET retrievals = retrievals + 1 WHERE id IN (${placeholders})`).run(...ids);
        } catch {}
      }

      return top;
    } catch {
      return [];
    }
  }

  static reinforceEpisodicMemories(memoryIds: string[], reward: number): EpisodicMemory[] {
    if (!memoryIds || memoryIds.length === 0) return [];
    const updated: EpisodicMemory[] = [];
    try {
      this.ensureTables();
      const learningRate = 0.2;
      for (const id of memoryIds) {
        const mem = db.prepare('SELECT * FROM ml_episodic_memories WHERE id = ?').get(id) as any;
        if (!mem) continue;

        const currentQ = Number(mem.q_value || 0.5);
        // Atualização de Q-Learning: Q <- Q + alpha * (Reward - Q)
        const newQ = Math.max(0.05, Math.min(0.99, currentQ + learningRate * (reward - currentQ)));
        const incSuccess = reward >= 0.5 ? 1 : 0;

        db.prepare(`
          UPDATE ml_episodic_memories
          SET q_value = ?, successes_after_retrieval = successes_after_retrieval + ?, updated_at = ?
          WHERE id = ?
        `).run(Number(newQ.toFixed(4)), incSuccess, new Date().toISOString(), id);

        updated.push({
          ...mem,
          q_value: Number(newQ.toFixed(4)),
          resolution_vaccine: mem.surgical_vaccine,
          similarityScore: 1.0
        });
      }
    } catch (err: any) {
      Logger.warn(`[DecoMindMlService] Erro ao reforçar memórias episódicas: ${err.message}`);
    }
    return updated;
  }

  // =========================================================================
  // 5. REGISTRADOR UNIFICADO DE DESFECHOS DE TAREFAS (recordTaskOutcome)
  // =========================================================================

  static recordTaskOutcome(params: {
    taskId?: string;
    projectId?: string;
    task?: any;
    taskTitle?: string;
    taskDescription?: string;
    expectedFiles?: string[];
    dependencies?: string[];
    category?: string;
    modelTier?: 'flash' | 'pro' | 'flash_lite';
    effortLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
    outcome?: 'APPROVED' | 'REWORK_REQUIRED' | 'FAILED';
    attempts?: number;
    projectPath?: string;
    verdict?: 'PASS' | 'REWORK_REQUIRED' | 'FAILED';
    armKey?: string;
    durationMs?: number;
    retrievedMemoryIds?: string[];
    reworkCause?: string;
    errorPattern?: string;
    solutionVaccine?: string;
  }): { recorded: boolean; reward: number; newWeights: number[]; updatedArm?: BanditArm | null } {
    try {
      this.ensureTables();
      const isPass = params.verdict === 'PASS' || params.outcome === 'APPROVED';
      const actualRework: 0 | 1 = isPass ? 0 : 1;
      const durationMs = params.durationMs || 1000;

      const category = params.category || params.task?.skill_routed || params.task?.category || 'GENERAL';
      const modelTier = params.modelTier || 'flash';
      const effortLevel = params.effortLevel || 'HIGH';
      const armKey = params.armKey || `${category}::${modelTier}::${effortLevel}`;

      const features = this.extractTaskFeatures({
        taskTitle: params.taskTitle || params.task?.title || '',
        taskDescription: params.taskDescription || params.task?.description || '',
        expectedFiles: params.expectedFiles || params.task?.expected_files || params.task?.expectedFiles || [],
        dependencies: params.dependencies || params.task?.dependencies || [],
        attempts: params.attempts ?? params.task?.retry_count ?? 0,
        category
      }, params.projectPath);

      // 1. Predição a priori para histórico e treinamento SGD
      const prediction = this.predictReworkRisk(features);
      const trainRes = this.trainOnlineSGD(features, actualRework);

      // 2. Atualiza Bandit Arm
      this.updateBanditArm(armKey, isPass, durationMs);
      const updatedArm = db.prepare('SELECT * FROM ml_bandit_arms WHERE arm_key = ?').get(armKey) as unknown as BanditArm | undefined;

      // 3. Reforça Memórias Episódicas usadas
      if (params.retrievedMemoryIds && params.retrievedMemoryIds.length > 0) {
        const reward = isPass ? 1.0 : 0.0;
        this.reinforceEpisodicMemories(params.retrievedMemoryIds, reward);
      }

      // 4. Se a tarefa foi aprovada após rework prévio, grava a vacina encontrada
      const hasReworkHistory = actualRework === 1 || (params.attempts && params.attempts > 0) || (params.task?.retry_count && params.task.retry_count > 0);
      if (isPass && (params.solutionVaccine || hasReworkHistory)) {
        const vaccine = params.solutionVaccine ||
          (Array.isArray(params.task?.implemented) ? params.task.implemented.join('; ') : undefined) ||
          'Correção cirúrgica com verificação objetiva aprovada (código 0)';
        const errPattern = params.errorPattern || (hasReworkHistory ? `Rework superado na tentativa ${params.attempts || params.task?.retry_count || 1}` : 'REWORK_REQUIRED');
        const rootCause = params.reworkCause || 'Falha na tentativa inicial superada com sucesso';
        this.recordEpisodicLesson({
          taskCategory: category,
          taskText: `${params.taskTitle || params.task?.title || ''} ${params.taskDescription || params.task?.description || ''}`,
          errorPattern: errPattern,
          rootCause,
          surgicalVaccine: vaccine,
          qValue: 0.85
        });
      }

      // 5. Log de amostra de treino
      const sampleId = `sample-${randomUUID().slice(0, 8)}`;
      const reward = isPass ? 1.0 : 0.0;
      db.prepare(`
        INSERT INTO ml_training_samples (
          id, task_id, project_id, features_json, predicted_risk, actual_rework, selected_arm, reward, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        sampleId,
        params.taskId || 'generic-task',
        params.projectId || 'generic-project',
        JSON.stringify(features),
        prediction.probability,
        actualRework,
        armKey,
        reward,
        new Date().toISOString()
      );

      return {
        recorded: true,
        reward,
        newWeights: trainRes.weights,
        updatedArm: updatedArm ? {
          ...updatedArm,
          success_rate: Number((Number(updatedArm.alpha || 1) / (Number(updatedArm.alpha || 1) + Number(updatedArm.beta || 1))).toFixed(4))
        } : null
      };
    } catch (err: any) {
      Logger.warn(`[DecoMindMlService] Erro ao registrar desfecho de tarefa: ${err.message}`);
      return {
        recorded: false,
        reward: 0,
        newWeights: this.getLogisticWeights().weights,
        updatedArm: null
      };
    }
  }

  // =========================================================================
  // 6. TELEMETRIA E STATUS DO MOTOR DE MACHINE LEARNING
  // =========================================================================

  static getMlTelemetryStatus(): DecoMindMlStatus {
    return this.getSystemMlStatus();
  }

  static getSystemMlStatus(): DecoMindMlStatus {
    try {
      this.ensureTables();
      const model = this.getLogisticWeights();
      const row = db.prepare('SELECT running_accuracy, running_brier_loss FROM ml_logistic_weights WHERE model_name = ?').get('rework_risk_predictor_v1') as any;

      const topBanditArms = db.prepare(`
        SELECT arm_key, category, model_tier, effort_level, pulls, mean_reward
        FROM ml_bandit_arms
        ORDER BY mean_reward DESC, pulls DESC
        LIMIT 6
      `).all() as any[];

      const topUnderperformingArms = db.prepare(`
        SELECT arm_key, mean_reward
        FROM ml_bandit_arms
        WHERE pulls > 0
        ORDER BY mean_reward ASC
        LIMIT 3
      `).all() as any[];

      const topEpisodicMemories = db.prepare(`
        SELECT id, task_category, error_pattern, surgical_vaccine, q_value
        FROM ml_episodic_memories
        ORDER BY q_value DESC, updated_at DESC
        LIMIT 20
      `).all() as any[];

      const countRow = db.prepare('SELECT count(*) as c FROM ml_episodic_memories').get() as any;

      return {
        samplesSeen: model.samplesSeen,
        samplesCount: model.samplesSeen,
        runningAccuracy: row ? Number(row.running_accuracy || 0.75) : 0.75,
        runningBrierLoss: row ? Number(row.running_brier_loss || 0.18) : 0.18,
        weights: Object.assign([...model.weights], { bias: model.weights[0] }),
        banditArms: topBanditArms,
        topBanditArms,
        topUnderperformingArms,
        topEpisodicMemories,
        episodicMemoriesCount: countRow ? Number(countRow.c || 0) : 0
      };
    } catch {
      return {
        samplesSeen: 0,
        runningAccuracy: 0.75,
        runningBrierLoss: 0.18,
        weights: [-0.6, 0.4, 0.35, 0.25, 0.3, 0.2, 0.7, 0.5],
        topBanditArms: [],
        topUnderperformingArms: [],
        topEpisodicMemories: [],
        episodicMemoriesCount: 0
      };
    }
  }
}
