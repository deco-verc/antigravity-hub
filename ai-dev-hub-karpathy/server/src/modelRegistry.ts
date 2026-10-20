import { execFileSync } from 'node:child_process';
import { db } from './db.js';
import { getLanguageServerExe } from './antigravityProvider.js';
import { Logger } from './logger.js';

export interface ModelOption {
  id: string; // 'flash_lite' | 'flash' | 'pro'
  displayName: string;
  family: string;
  speed: 'fastest' | 'fast' | 'standard';
  reasoning: 'basic' | 'balanced' | 'deep';
  description: string;
  available: boolean;
}

export type SupportedModelId = 'flash_lite' | 'flash' | 'pro';
export type ModelSelectorValue = 'auto' | SupportedModelId;

export interface ModelPreferences {
  default: ModelSelectorValue;
  supervisor?: ModelSelectorValue;
  builder?: ModelSelectorValue;
  reviewer?: ModelSelectorValue;
  council?: ModelSelectorValue;
}

export class ModelRegistry {
  private static cachedModels: ModelOption[] | null = null;
  private static lastCheckTime = 0;
  private static CACHE_TTL_MS = 60000; // 1 min

  /**
   * Real runtime discovery of models accepted by Antigravity CLI / Language Server
   */
  static discoverModels(): ModelOption[] {
    const now = Date.now();
    if (this.cachedModels && now - this.lastCheckTime < this.CACHE_TTL_MS) {
      return this.cachedModels;
    }

    // Baseline catalog directly verified against agentapi CLI syntax
    // agentapi new-conversation [--model=<flash_lite|flash|pro>]
    const catalog: ModelOption[] = [
      {
        id: 'flash_lite',
        displayName: 'Flash Lite',
        family: 'Antigravity runtime tier',
        speed: 'fastest',
        reasoning: 'basic',
        description: 'Ultrarrápido e econômico para tarefas rotineiras, pequenos ajustes e diagnósticos.',
        available: false
      },
      {
        id: 'flash',
        displayName: 'Flash',
        family: 'Antigravity runtime tier',
        speed: 'fast',
        reasoning: 'balanced',
        description: 'Equilíbrio ideal entre alta velocidade, raciocínio robusto e precisão cirúrgica.',
        available: false
      },
      {
        id: 'pro',
        displayName: 'Pro',
        family: 'Antigravity runtime tier',
        speed: 'standard',
        reasoning: 'deep',
        description: 'Capacidade máxima de raciocínio, decomposição de tarefas complexas e análise de código.',
        available: false
      }
    ];

    try {
      const exe = getLanguageServerExe();
      if (exe) {
        // Quick help probe to verify agentapi availability
        const helpOut = execFileSync(exe, ['agentapi', 'new-conversation', '--help'], { encoding: 'utf-8', timeout: 5000 });
        for (const model of catalog) model.available = helpOut.includes(model.id);
      }
    } catch (err: any) {
      Logger.warn(`[ModelRegistry] Verificação runtime do agentapi: ${err.message}`);
    }

    this.cachedModels = catalog;
    this.lastCheckTime = now;
    return catalog;
  }

  /**
   * Resolve an effective real model ID ('flash_lite' | 'flash' | 'pro') based on role and preference
   */
  static resolveModel(options: {
    preference?: string | null;
    role?: 'supervisor' | 'builder' | 'reviewer' | 'council' | 'default';
    taskComplexity?: 'low' | 'medium' | 'high';
  }): SupportedModelId {
    const pref = options.preference || 'auto';

    if (pref !== 'auto' && pref !== 'pro' && pref !== 'flash' && pref !== 'flash_lite') {
      throw new Error(`MODEL_UNAVAILABLE: modelo solicitado não é reconhecido: ${pref}`);
    }
    if (pref === 'pro' || pref === 'flash' || pref === 'flash_lite') {
      if (!this.discoverModels().some(model => model.id === pref && model.available)) {
        throw new Error(`MODEL_UNAVAILABLE: ${pref} não está disponível no agentapi instalado`);
      }
      return pref;
    }

    // 'auto' mode: role-based heuristic matching real strengths
    const role = options.role || 'builder';
    if (role === 'supervisor' || role === 'council') {
      // Supervisor and Council benefit from deeper reasoning
      return 'pro';
    }

    if (role === 'reviewer') {
      return 'pro';
    }

    if (options.taskComplexity === 'high') {
      return 'pro';
    }

    if (options.taskComplexity === 'low') {
      return 'flash_lite';
    }

    // Default builder worker
    return 'flash';
  }

  /**
   * Get preferences for a given account profile or globally
   */
  static getPreferences(accountProfileId?: string | null, projectId?: string | null): Record<string, ModelSelectorValue> {
    const rows = db.prepare(`
      SELECT role, model_id, account_profile_id, project_id FROM model_preferences
      WHERE (account_profile_id IS NULL OR account_profile_id = ?)
        AND (project_id IS NULL OR project_id = ?)
    `).all(accountProfileId || null, projectId || null) as any[];

    const result: Record<string, ModelSelectorValue> = {
      default: 'auto',
      supervisor: 'auto',
      builder: 'auto',
      reviewer: 'auto',
      council: 'auto'
    };

    const scopeRank = (row: any) => (row.project_id ? 20 : 0) + (row.account_profile_id ? 10 : 0);
    const defaults = rows.filter(r => r.role === 'default').sort((a, b) => scopeRank(b) - scopeRank(a));
    result.default = (defaults[0]?.model_id || 'auto') as ModelSelectorValue;
    for (const role of ['supervisor', 'builder', 'reviewer', 'council']) {
      const roleRows = rows.filter(r => r.role === role).sort((a, b) => scopeRank(b) - scopeRank(a));
      result[role] = (roleRows[0]?.model_id || result.default) as ModelSelectorValue;
    }

    return result;
  }

  /**
   * Save preference for a specific role and account profile
   */
  static setPreference(params: {
    role?: string;
    modelId: ModelSelectorValue;
    accountProfileId?: string | null;
    projectId?: string | null;
  }) {
    if (params.modelId !== 'auto' && !this.discoverModels().some(model => model.id === params.modelId && model.available)) {
      throw new Error(`MODEL_UNAVAILABLE: ${params.modelId} não está disponível no agentapi instalado`);
    }
    const role = params.role || 'default';
    const accountProfileId = params.accountProfileId || null;
    const projectId = params.projectId || null;
    const nowIso = new Date().toISOString();
    const id = `${accountProfileId || 'global'}_${projectId || 'all'}_${role}`;

    db.prepare(`
      INSERT INTO model_preferences (id, account_profile_id, role, model_id, project_id, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        model_id = excluded.model_id,
        updated_at = excluded.updated_at
    `).run(id, accountProfileId, role, params.modelId, projectId, nowIso);

    Logger.info(`[ModelRegistry] Preferência de modelo atualizada: [${role}] -> ${params.modelId} (Account: ${accountProfileId || 'Global'})`);
  }
}
