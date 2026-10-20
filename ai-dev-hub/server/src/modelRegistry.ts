import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { db } from './db.js';
import { getLanguageServerExe } from './antigravityProvider.js';
import { AgentApiGateway } from './agentApiGateway.js';
import { Logger } from './logger.js';
import { QuotaManager } from './quotaManager.js';

export type SupportedModelId = 'flash_lite' | 'flash' | 'pro';
export type ModelSelectorValue = 'auto' | SupportedModelId | string;
export type IntelligenceLevel = 'HIGH' | 'MEDIUM' | 'LOW';

export const DEFAULT_MODEL_ID: SupportedModelId = 'flash';
export const DEFAULT_MODEL_CANONICAL_NAME = 'Gemini 3.8 Flash';
export const DEFAULT_INTELLIGENCE_LEVEL: IntelligenceLevel = 'HIGH';

export interface ModelOption {
  id: string; // 'flash_lite' | 'flash' | 'pro'
  displayName: string;
  family: string;
  speed: 'fastest' | 'fast' | 'standard';
  reasoning: 'basic' | 'balanced' | 'deep';
  intelligenceLevel?: IntelligenceLevel;
  canonicalModel?: string;
  isSystemDefault?: boolean;
  description: string;
  available: boolean;
  selectionScope?: 'TIER';
  exactVariant?: null;
  accountAvailabilityVerified?: boolean;
  nominalContextWindow?: string;
  quotaBlocked?: boolean;
  quotaReason?: string | null;
  quotaResetsAt?: string | null;
  supportedEfforts?: IntelligenceLevel[];
  aliases?: string[];
}

export interface FrontierModelCatalogItem {
  slug: string;
  tierId: SupportedModelId;
  displayName: string;
  family: 'Gemini 3' | 'Claude Thinking' | 'Open Weights';
  defaultEffort: IntelligenceLevel;
  supportedEfforts: IntelligenceLevel[];
  nominalContextWindow: string;
  isDefault?: boolean;
  deprecatedAfter?: string | null;
}

export interface ModelPreferences {
  default: ModelSelectorValue;
  supervisor?: ModelSelectorValue;
  builder?: ModelSelectorValue;
  reviewer?: ModelSelectorValue;
  council?: ModelSelectorValue;
  intelligence_level?: IntelligenceLevel;
}

export interface ResolvedModelConfig {
  modelId: SupportedModelId;
  canonicalName: string;
  intelligenceLevel: IntelligenceLevel;
  source: 'GLOBAL_DEFAULT' | 'PROJECT_OVERRIDE' | 'ROLE_OVERRIDE' | 'EXPLICIT_PREFERENCE';
  requestedModel: string;
  selectedModel: SupportedModelId;
  confirmedModel: string | null;
  modelConfirmation: 'CONFIRMED' | 'UNCONFIRMED' | 'ESTIMATED';
  requestedIntelligence: string;
  available: boolean;
  reason?: string;
}

/**
 * Official Antigravity 2.0 Model Alias & Slug Mapping (per docs/models & CLI --model slugs)
 */
const RECOGNIZED_MODEL_ALIASES: Record<string, { tier: SupportedModelId; canonicalName: string; defaultEffort?: IntelligenceLevel }> = {
  // Core tiers
  flash: { tier: 'flash', canonicalName: DEFAULT_MODEL_CANONICAL_NAME, defaultEffort: 'HIGH' },
  pro: { tier: 'pro', canonicalName: 'Gemini Pro', defaultEffort: 'HIGH' },
  flash_lite: { tier: 'flash_lite', canonicalName: 'Gemini Flash Lite', defaultEffort: 'LOW' },
  'flash-lite': { tier: 'flash_lite', canonicalName: 'Gemini Flash Lite', defaultEffort: 'LOW' },

  // Official Antigravity 2.0 Gemini 3.x slugs
  'gemini-3.8-flash': { tier: 'flash', canonicalName: 'Gemini 3.8 Flash', defaultEffort: 'HIGH' },
  'gemini_3_8_flash': { tier: 'flash', canonicalName: 'Gemini 3.8 Flash', defaultEffort: 'HIGH' },
  'gemini 3.8 flash': { tier: 'flash', canonicalName: 'Gemini 3.8 Flash', defaultEffort: 'HIGH' },
  'gemini-3.7-flash': { tier: 'flash', canonicalName: 'Gemini 3.7 Flash', defaultEffort: 'HIGH' },
  'gemini 3.7 flash': { tier: 'flash', canonicalName: 'Gemini 3.7 Flash', defaultEffort: 'HIGH' },
  'gemini-3.6-flash': { tier: 'flash', canonicalName: 'Gemini 3.6 Flash', defaultEffort: 'HIGH' },
  'gemini 3.6 flash': { tier: 'flash', canonicalName: 'Gemini 3.6 Flash', defaultEffort: 'HIGH' },
  'gemini-3.5-flash': { tier: 'flash', canonicalName: 'Gemini 3.5 Flash', defaultEffort: 'HIGH' },
  'gemini-2.5-flash': { tier: 'flash', canonicalName: 'Gemini 2.5 Flash', defaultEffort: 'HIGH' },

  'gemini-3.1-pro': { tier: 'pro', canonicalName: 'Gemini 3.1 Pro', defaultEffort: 'HIGH' },
  'gemini_3_1_pro': { tier: 'pro', canonicalName: 'Gemini 3.1 Pro', defaultEffort: 'HIGH' },
  'gemini 3.1 pro': { tier: 'pro', canonicalName: 'Gemini 3.1 Pro', defaultEffort: 'HIGH' },
  'gemini-3.8-pro': { tier: 'pro', canonicalName: 'Gemini 3.8 Pro', defaultEffort: 'HIGH' },
  'gemini 3.8 pro': { tier: 'pro', canonicalName: 'Gemini 3.8 Pro', defaultEffort: 'HIGH' },
  'gemini-2.5-pro': { tier: 'pro', canonicalName: 'Gemini 2.5 Pro', defaultEffort: 'HIGH' },
  'gemini-pro': { tier: 'pro', canonicalName: 'Gemini Pro', defaultEffort: 'HIGH' },

  'gemini-3.1-flash-lite': { tier: 'flash_lite', canonicalName: 'Gemini Flash Lite', defaultEffort: 'LOW' },
  'gemini-flash-lite': { tier: 'flash_lite', canonicalName: 'Gemini Flash Lite', defaultEffort: 'LOW' },

  // Antigravity 2.0 Frontier Thinking Models (Pro / Ultra plans)
  'claude-sonnet-5.5': { tier: 'pro', canonicalName: 'Claude Sonnet 5.5 (thinking)', defaultEffort: 'HIGH' },
  'claude-sonnet-5-5': { tier: 'pro', canonicalName: 'Claude Sonnet 5.5 (thinking)', defaultEffort: 'HIGH' },
  'claude-opus-5.5': { tier: 'pro', canonicalName: 'Claude Opus 5.5 (thinking)', defaultEffort: 'HIGH' },
  'claude-opus-5-5': { tier: 'pro', canonicalName: 'Claude Opus 5.5 (thinking)', defaultEffort: 'HIGH' },
  'claude-sonnet-4.6': { tier: 'pro', canonicalName: 'Claude Sonnet 4.6 (thinking)', defaultEffort: 'HIGH' },
  'claude-sonnet-4-6': { tier: 'pro', canonicalName: 'Claude Sonnet 4.6 (thinking)', defaultEffort: 'HIGH' },
  'claude-opus-4.6': { tier: 'pro', canonicalName: 'Claude Opus 4.6 (thinking)', defaultEffort: 'HIGH' },
  'claude-opus-4-6': { tier: 'pro', canonicalName: 'Claude Opus 4.6 (thinking)', defaultEffort: 'HIGH' },
  'gpt-oss-120b': { tier: 'flash', canonicalName: 'GPT-OSS-120b', defaultEffort: 'MEDIUM' }
};

export class ModelRegistry {
  private static cachedModels: ModelOption[] | null = null;
  private static lastCheckTime = 0;
  private static lastOfflineState: boolean | null = null;
  private static CACHE_TTL_MS = 60000; // 1 min

  /**
   * Clears cached model discovery results (useful on runtime state transitions)
   */
  static invalidateCache(): void {
    this.cachedModels = null;
    this.lastCheckTime = 0;
    this.lastOfflineState = null;
  }

  /**
   * Normalizes and validates an intelligence / reasoning effort level ('HIGH' | 'MEDIUM' | 'LOW').
   * Supports lowercase inputs ('high', 'medium', 'low') and SDK 0.1.7 'extra_high' -> 'HIGH'.
   */
  static normalizeIntelligenceLevel(raw: unknown, fallback: IntelligenceLevel = DEFAULT_INTELLIGENCE_LEVEL): IntelligenceLevel {
    if (raw === undefined || raw === null || raw === '') {
      return fallback;
    }
    const norm = String(raw).trim().toUpperCase().replace(/[\s-]+/g, '_');
    if (norm === 'HIGH' || norm === 'EXTRA_HIGH') return 'HIGH';
    if (norm === 'MEDIUM' || norm === 'MED' || norm === 'BALANCED') return 'MEDIUM';
    if (norm === 'LOW' || norm === 'MINIMAL' || norm === 'BASIC') return 'LOW';
    throw new Error(`INVALID_INTELLIGENCE_LEVEL: nível de inteligência solicitado não é suportado: ${String(raw)}`);
  }

  /**
   * Normalizes a model selector or official Antigravity 2.0 slug to a canonical SupportedModelId ('flash_lite' | 'flash' | 'pro').
   * Returns null if unrecognized.
   */
  static normalizeModelSelector(raw: unknown): {
    tierId: SupportedModelId;
    canonicalName: string;
    defaultEffort?: IntelligenceLevel;
  } | null {
    if (typeof raw !== 'string') return null;
    const cleaned = raw.trim().toLowerCase();
    if (!cleaned || cleaned === 'auto') return null;
    const item = RECOGNIZED_MODEL_ALIASES[cleaned];
    if (!item) return null;
    return {
      tierId: item.tier,
      canonicalName: item.canonicalName,
      defaultEffort: item.defaultEffort
    };
  }

  /**
   * Maps internal runtime model identifiers returned by Antigravity get-conversation-metadata
   * to canonical DecoHUB model names and tiers.
   */
  static mapRuntimeModelId(rawRuntimeModel: string | null | undefined): {
    tierId: SupportedModelId | null;
    canonicalName: string | null;
    verified: boolean;
  } {
    if (!rawRuntimeModel || typeof rawRuntimeModel !== 'string') {
      return { tierId: null, canonicalName: null, verified: false };
    }
    const upper = rawRuntimeModel.trim().toUpperCase();
    const lower = rawRuntimeModel.trim().toLowerCase();

    if (RECOGNIZED_MODEL_ALIASES[lower]) {
      const entry = RECOGNIZED_MODEL_ALIASES[lower];
      return { tierId: entry.tier, canonicalName: entry.canonicalName, verified: true };
    }
    if (upper.includes('3_8_FLASH') || upper.includes('3.8_FLASH') || upper.includes('FLASH_3_8')) {
      return { tierId: 'flash', canonicalName: 'Gemini 3.8 Flash', verified: true };
    }
    if (upper.includes('3_7_FLASH') || upper.includes('3.7_FLASH')) {
      return { tierId: 'flash', canonicalName: 'Gemini 3.7 Flash', verified: true };
    }
    if (upper.includes('3_6_FLASH') || upper.includes('3.6_FLASH')) {
      return { tierId: 'flash', canonicalName: 'Gemini 3.6 Flash', verified: true };
    }
    if (upper.includes('FLASH_LITE') || upper.includes('LITE')) {
      return { tierId: 'flash_lite', canonicalName: 'Gemini Flash Lite', verified: true };
    }
    if (upper.includes('3_1_PRO') || upper.includes('3.1_PRO') || upper.includes('PRO')) {
      return { tierId: 'pro', canonicalName: 'Gemini Pro', verified: true };
    }
    if (upper.includes('FLASH')) {
      return { tierId: 'flash', canonicalName: DEFAULT_MODEL_CANONICAL_NAME, verified: true };
    }

    return { tierId: null, canonicalName: rawRuntimeModel, verified: false };
  }

  /**
   * Returns the extended Antigravity 2.0 Frontier Models catalog for UI selectors (Meta-Chat & Project Settings)
   */
  static getFrontierModelsCatalog(): FrontierModelCatalogItem[] {
    return [
      {
        slug: 'gemini-3.8-flash',
        tierId: 'flash',
        displayName: 'Gemini 3.8 Flash',
        family: 'Gemini 3',
        defaultEffort: 'HIGH',
        supportedEfforts: ['HIGH', 'MEDIUM', 'LOW'],
        nominalContextWindow: '1.000.000 tokens',
        isDefault: true
      },
      {
        slug: 'gemini-3.1-pro',
        tierId: 'pro',
        displayName: 'Gemini 3.1 Pro',
        family: 'Gemini 3',
        defaultEffort: 'HIGH',
        supportedEfforts: ['HIGH', 'MEDIUM', 'LOW'],
        nominalContextWindow: '2.000.000 tokens'
      },
      {
        slug: 'gemini-3.7-flash',
        tierId: 'flash',
        displayName: 'Gemini 3.7 Flash',
        family: 'Gemini 3',
        defaultEffort: 'HIGH',
        supportedEfforts: ['HIGH', 'MEDIUM', 'LOW'],
        nominalContextWindow: '1.000.000 tokens'
      },
      {
        slug: 'gemini-3.6-flash',
        tierId: 'flash',
        displayName: 'Gemini 3.6 Flash',
        family: 'Gemini 3',
        defaultEffort: 'HIGH',
        supportedEfforts: ['HIGH', 'MEDIUM', 'LOW'],
        nominalContextWindow: '1.000.000 tokens'
      },
      {
        slug: 'flash_lite',
        tierId: 'flash_lite',
        displayName: 'Gemini Flash Lite',
        family: 'Gemini 3',
        defaultEffort: 'LOW',
        supportedEfforts: ['LOW', 'MEDIUM'],
        nominalContextWindow: '1.000.000 tokens'
      },
      {
        slug: 'claude-sonnet-5.5',
        tierId: 'pro',
        displayName: 'Claude Sonnet 5.5 (thinking)',
        family: 'Claude Thinking',
        defaultEffort: 'HIGH',
        supportedEfforts: ['HIGH', 'MEDIUM', 'LOW'],
        nominalContextWindow: '200.000 tokens'
      },
      {
        slug: 'claude-opus-5.5',
        tierId: 'pro',
        displayName: 'Claude Opus 5.5 (thinking)',
        family: 'Claude Thinking',
        defaultEffort: 'HIGH',
        supportedEfforts: ['HIGH', 'MEDIUM', 'LOW'],
        nominalContextWindow: '200.000 tokens'
      }
    ];
  }

  /**
   * Returns global system default model configuration.
   * Standard: Gemini 3.8 Flash + Intelligence HIGH.
   */
  static getDefaultConfig(): ResolvedModelConfig {
    return {
      modelId: DEFAULT_MODEL_ID,
      canonicalName: DEFAULT_MODEL_CANONICAL_NAME,
      intelligenceLevel: DEFAULT_INTELLIGENCE_LEVEL,
      source: 'GLOBAL_DEFAULT',
      requestedModel: DEFAULT_MODEL_ID,
      selectedModel: DEFAULT_MODEL_ID,
      confirmedModel: DEFAULT_MODEL_ID,
      modelConfirmation: AgentApiGateway.isOfflineMode() ? 'ESTIMATED' : 'CONFIRMED',
      requestedIntelligence: DEFAULT_INTELLIGENCE_LEVEL,
      available: true
    };
  }

  /**
   * Real runtime discovery of models accepted by Antigravity CLI / Language Server.
   * Baseline catalog directly verified against agentapi CLI syntax:
   * agentapi new-conversation [--model=<flash_lite|flash|pro>]
   */
  static discoverModels(): ModelOption[] {
    const now = Date.now();
    const isOffline = AgentApiGateway.isOfflineMode();
    if (
      this.cachedModels &&
      this.lastOfflineState === isOffline &&
      now - this.lastCheckTime < this.CACHE_TTL_MS
    ) {
      return this.cachedModels;
    }

    const catalog: ModelOption[] = [
      {
        id: 'flash_lite',
        displayName: 'Flash Lite',
        family: 'Antigravity runtime tier',
        speed: 'fastest',
        reasoning: 'basic',
        intelligenceLevel: 'LOW',
        canonicalModel: 'Gemini Flash Lite',
        description: 'Ultrarrápido e econômico para tarefas rotineiras, pequenos ajustes e diagnósticos.',
        available: false,
        nominalContextWindow: '1.000.000 tokens (nominal)',
        supportedEfforts: ['LOW', 'MEDIUM'],
        aliases: ['flash_lite', 'gemini-3.1-flash-lite', 'gemini-flash-lite']
      },
      {
        id: 'flash',
        displayName: 'Gemini 3.8 Flash',
        family: 'Antigravity runtime tier',
        speed: 'fast',
        reasoning: 'deep',
        intelligenceLevel: 'HIGH',
        canonicalModel: DEFAULT_MODEL_CANONICAL_NAME,
        isSystemDefault: true,
        description:
          'Padrão global do DecoHUB: Gemini 3.8 Flash com nível de inteligência HIGH para máxima precisão, velocidade e raciocínio robusto.',
        available: false,
        nominalContextWindow: '1.000.000 tokens (nominal)',
        supportedEfforts: ['HIGH', 'MEDIUM', 'LOW'],
        aliases: ['flash', 'gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-2.5-flash']
      },
      {
        id: 'pro',
        displayName: 'Pro',
        family: 'Antigravity runtime tier',
        speed: 'standard',
        reasoning: 'deep',
        intelligenceLevel: 'HIGH',
        canonicalModel: 'Gemini Pro',
        description: 'Capacidade máxima de raciocínio, decomposição de tarefas complexas e análise de código.',
        available: false,
        nominalContextWindow: '2.000.000 tokens (nominal)',
        supportedEfforts: ['HIGH', 'MEDIUM', 'LOW'],
        aliases: ['pro', 'gemini-3.1-pro', 'gemini-3.8-pro', 'gemini-2.5-pro', 'claude-sonnet-5.5', 'claude-opus-5.5']
      }
    ];

    for (const model of catalog) {
      model.selectionScope = 'TIER';
      model.exactVariant = null;
      model.accountAvailabilityVerified = false;
      model.description += ' A variante exata é definida pelo Antigravity; este controle seleciona somente o nível.';
    }

    if (isOffline) {
      for (const model of catalog) model.available = true;
      this.cachedModels = catalog;
      this.lastCheckTime = now;
      this.lastOfflineState = isOffline;
      return catalog;
    }

    try {
      const exe = getLanguageServerExe();
      if (exe) {
        const cleanEnv: NodeJS.ProcessEnv = { ...process.env };
        delete cleanEnv.ELECTRON_RUN_AS_NODE;
        delete cleanEnv.ELECTRON_NO_ASAR;
        delete cleanEnv.ELECTRON_OZONE_PLATFORM_HINT;

        try {
          const helpOut = execFileSync(exe, ['agentapi', 'new-conversation', '--help'], {
            encoding: 'utf-8',
            timeout: 5000,
            env: cleanEnv,
            windowsHide: true
          });
          const hasGenericModelFlag = /--model\b/i.test(helpOut);
          for (const model of catalog) {
            model.available =
              helpOut.includes(model.id) ||
              (hasGenericModelFlag && !/flash_lite|flash|pro/.test(helpOut));
          }
        } catch (probeErr: any) {
          // Some CLI builds print --help output to stderr or exit with code 1/2 on --help
          const combinedOut = `${probeErr?.stdout || ''}\n${probeErr?.stderr || ''}`;
          if (combinedOut.trim().length > 0) {
            const hasGenericModelFlag = /--model\b/i.test(combinedOut);
            for (const model of catalog) {
              model.available =
                combinedOut.includes(model.id) ||
                (hasGenericModelFlag && !/flash_lite|flash|pro/.test(combinedOut));
            }
          } else if (fs.existsSync(exe)) {
            for (const model of catalog) model.available = true;
          }
        }
      }
    } catch (err: any) {
      Logger.warn(`[ModelRegistry] Verificação runtime do agentapi: ${err.message}`);
    }

    this.cachedModels = catalog;
    this.lastCheckTime = now;
    this.lastOfflineState = isOffline;
    return catalog;
  }

  /**
   * Get models catalog enriched with live quota status for a specific profile
   */
  static getModelsCatalog(accountProfileId?: string | null, _projectId?: string | null): ModelOption[] {
    const models = this.discoverModels();
    return models.map(m => {
      let quotaBlocked = false;
      let quotaReason: string | null = null;
      let quotaResetsAt: string | null = null;

      if (accountProfileId) {
        const quotaCheck = QuotaManager.isBlockedByQuota(accountProfileId, m.id);
        quotaBlocked = quotaCheck.blocked;
        quotaReason = quotaCheck.reason;
        quotaResetsAt = quotaCheck.resetsAt;
      }

      return {
        ...m,
        quotaBlocked,
        quotaReason,
        quotaResetsAt
      };
    });
  }

  /**
   * Resolves full structured model and intelligence configuration.
   * Central source of truth for Supervisor, Workers, Evaluator, Meta-Chat and internal tools.
   */
  static resolveModelConfig(options?: {
    preference?: string | null;
    role?: 'supervisor' | 'builder' | 'reviewer' | 'council' | 'default';
    taskComplexity?: 'low' | 'medium' | 'high';
    accountProfileId?: string | null;
    projectId?: string | null;
    requestedIntelligence?: IntelligenceLevel | string;
  }): ResolvedModelConfig {
    let resolvedIntelligenceOverride: IntelligenceLevel | null = null;
    if (options?.requestedIntelligence !== undefined && options?.requestedIntelligence !== null) {
      resolvedIntelligenceOverride = this.normalizeIntelligenceLevel(options.requestedIntelligence);
    }

    const role = options?.role || 'default';
    const prefs = this.getPreferences(options?.accountProfileId, options?.projectId);

    const explicitPref =
      options?.preference !== undefined && options?.preference !== null && String(options.preference).trim() !== ''
        ? String(options.preference).trim()
        : (prefs[role] || prefs.default || 'auto');

    let modelId: SupportedModelId = DEFAULT_MODEL_ID;
    let intelligenceLevel: IntelligenceLevel = DEFAULT_INTELLIGENCE_LEVEL;

    if (resolvedIntelligenceOverride) {
      intelligenceLevel = resolvedIntelligenceOverride;
    } else if (prefs[`${role}_intelligence_level`]) {
      try {
        intelligenceLevel = this.normalizeIntelligenceLevel(prefs[`${role}_intelligence_level`]);
      } catch {
        intelligenceLevel = DEFAULT_INTELLIGENCE_LEVEL;
      }
    } else if (prefs.intelligence_level) {
      try {
        intelligenceLevel = this.normalizeIntelligenceLevel(prefs.intelligence_level);
      } catch {
        intelligenceLevel = DEFAULT_INTELLIGENCE_LEVEL;
      }
    }

    let source: ResolvedModelConfig['source'] = 'GLOBAL_DEFAULT';
    let customCanonicalName: string | null = null;

    if (explicitPref && explicitPref.toLowerCase() !== 'auto') {
      const normalized = this.normalizeModelSelector(explicitPref);
      if (!normalized) {
        throw new Error(`MODEL_UNAVAILABLE: modelo solicitado não é reconhecido: ${explicitPref}`);
      }
      modelId = normalized.tierId;
      customCanonicalName = normalized.canonicalName;
      source = options?.projectId ? 'PROJECT_OVERRIDE' : 'EXPLICIT_PREFERENCE';
      if (modelId === 'flash_lite' && !resolvedIntelligenceOverride) {
        intelligenceLevel = 'LOW';
      }
    } else {
      // Default: Gemini 3.8 Flash while preserving any explicitly requested or persisted intelligenceLevel
      modelId = DEFAULT_MODEL_ID;
      source =
        options?.projectId && prefs[role] && prefs[role] !== 'auto' && prefs[role] !== 'flash'
          ? 'PROJECT_OVERRIDE'
          : 'GLOBAL_DEFAULT';
    }

    // Availability validation without silent fallback
    const catalog = this.discoverModels();
    const isAvail = catalog.some(m => m.id === modelId && m.available);
    if (!isAvail && !AgentApiGateway.isOfflineMode()) {
      throw new Error(
        `MODEL_UNAVAILABLE: Modelo "${modelId}" (${modelId === 'flash' ? DEFAULT_MODEL_CANONICAL_NAME : modelId}) não está disponível no runtime Antigravity instalado`
      );
    }

    // Quota-aware check without silent fallback
    if (options?.accountProfileId) {
      const quotaCheck = QuotaManager.isBlockedByQuota(options.accountProfileId, modelId);
      if (quotaCheck.blocked && quotaCheck.reason !== 'Perfil inexistente') {
        const resetNotice = quotaCheck.resetsAt
          ? ` (Reseta às ${new Date(quotaCheck.resetsAt).toLocaleTimeString()})`
          : '';
        throw new Error(`QUOTA_BLOCKED: Modelo "${modelId}" indisponível por limite de cota ativo no perfil.${resetNotice}`);
      }
    }

    const canonicalName =
      modelId === 'flash'
        ? customCanonicalName || DEFAULT_MODEL_CANONICAL_NAME
        : modelId === 'pro'
          ? 'Gemini Pro'
          : 'Gemini Flash Lite';

    const confirmedModel = isAvail ? modelId : null;
    const modelConfirmation = isAvail ? (AgentApiGateway.isOfflineMode() ? 'ESTIMATED' : 'CONFIRMED') : 'UNCONFIRMED';

    return {
      modelId,
      canonicalName,
      intelligenceLevel,
      source,
      requestedModel: explicitPref && explicitPref.toLowerCase() !== 'auto' ? modelId : DEFAULT_MODEL_ID,
      selectedModel: modelId,
      confirmedModel,
      modelConfirmation,
      requestedIntelligence: intelligenceLevel,
      available: true
    };
  }

  /**
   * Resolve an effective real model ID ('flash_lite' | 'flash' | 'pro') based on role and preference.
   * By default, resolves to 'flash' (Gemini 3.8 Flash) with Intelligence HIGH.
   */
  static resolveModel(options?: {
    preference?: string | null;
    role?: 'supervisor' | 'builder' | 'reviewer' | 'council' | 'default';
    taskComplexity?: 'low' | 'medium' | 'high';
    accountProfileId?: string | null;
    projectId?: string | null;
    requestedIntelligence?: IntelligenceLevel | string;
  }): SupportedModelId {
    const config = this.resolveModelConfig(options);
    return config.modelId;
  }

  /**
   * Get preferences for a given account profile or globally.
   * Default for all roles without overrides is Gemini 3.8 Flash ('flash') + HIGH.
   */
  static getPreferences(accountProfileId?: string | null, projectId?: string | null): Record<string, any> {
    const rows = db
      .prepare(`
      SELECT role, model_id, intelligence_level, account_profile_id, project_id FROM model_preferences
      WHERE (account_profile_id IS NULL OR account_profile_id = ?)
        AND (project_id IS NULL OR project_id = ?)
    `)
      .all(accountProfileId || null, projectId || null) as any[];

    const result: Record<string, any> = {
      default: DEFAULT_MODEL_ID,
      supervisor: DEFAULT_MODEL_ID,
      builder: DEFAULT_MODEL_ID,
      reviewer: DEFAULT_MODEL_ID,
      council: DEFAULT_MODEL_ID,
      intelligence_level: DEFAULT_INTELLIGENCE_LEVEL
    };

    if (projectId) {
      try {
        const proj: any = db.prepare('SELECT selected_model, reasoning_level FROM projects WHERE id = ?').get(projectId);
        if (proj?.selected_model && proj.selected_model !== 'auto') {
          const norm = this.normalizeModelSelector(proj.selected_model);
          result.default = norm ? norm.tierId : proj.selected_model;
        }
        if (proj?.reasoning_level) {
          try {
            result.intelligence_level = this.normalizeIntelligenceLevel(proj.reasoning_level);
          } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "modelRegistry",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:modelRegistry]", err);
      }
    }
        }
      } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "modelRegistry",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:modelRegistry]", err);
      }
    }
    }

    const scopeRank = (row: any) => (row.project_id ? 20 : 0) + (row.account_profile_id ? 10 : 0);
    const defaults = rows.filter(r => r.role === 'default').sort((a, b) => scopeRank(b) - scopeRank(a));
    if (defaults.length > 0) {
      const norm = this.normalizeModelSelector(defaults[0].model_id);
      result.default = norm ? norm.tierId : defaults[0].model_id || DEFAULT_MODEL_ID;
      if (defaults[0].intelligence_level) {
        try {
          result.intelligence_level = this.normalizeIntelligenceLevel(defaults[0].intelligence_level);
        } catch {
          result.intelligence_level = DEFAULT_INTELLIGENCE_LEVEL;
        }
      }
    }

    for (const role of ['supervisor', 'builder', 'reviewer', 'council']) {
      const roleRows = rows.filter(r => r.role === role).sort((a, b) => scopeRank(b) - scopeRank(a));
      if (roleRows.length > 0) {
        const norm = this.normalizeModelSelector(roleRows[0].model_id);
        result[role] = norm ? norm.tierId : roleRows[0].model_id || result.default;
        if (roleRows[0].intelligence_level) {
          try {
            result[`${role}_intelligence_level`] = this.normalizeIntelligenceLevel(roleRows[0].intelligence_level);
          } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "modelRegistry",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:modelRegistry]", err);
      }
    }
        }
      } else {
        result[role] = result.default;
      }
    }

    result.reasoning_level = result.intelligence_level;
    return result;
  }

  /**
   * Save preference for a specific role, model, and intelligence level.
   */
  static setPreference(params: {
    role?: string;
    modelId: ModelSelectorValue;
    intelligenceLevel?: IntelligenceLevel | string;
    accountProfileId?: string | null;
    projectId?: string | null;
  }) {
    const intelligenceLevel =
      params.intelligenceLevel !== undefined && params.intelligenceLevel !== null
        ? this.normalizeIntelligenceLevel(params.intelligenceLevel)
        : DEFAULT_INTELLIGENCE_LEVEL;

    let normalizedModelId: SupportedModelId | 'auto' = 'auto';
    if (params.modelId && String(params.modelId).trim().toLowerCase() !== 'auto') {
      const norm = this.normalizeModelSelector(params.modelId);
      if (!norm) {
        throw new Error(`MODEL_UNAVAILABLE: ${params.modelId} não está disponível no agentapi instalado`);
      }
      normalizedModelId = norm.tierId;
      if (!this.discoverModels().some(model => model.id === normalizedModelId && model.available)) {
        throw new Error(`MODEL_UNAVAILABLE: ${params.modelId} não está disponível no agentapi instalado`);
      }
    }

    const role = params.role || 'default';
    const accountProfileId = params.accountProfileId || null;
    const projectId = params.projectId || null;
    const nowIso = new Date().toISOString();
    const id = `${accountProfileId || 'global'}_${projectId || 'all'}_${role}`;

    db.prepare(`
      INSERT INTO model_preferences (id, account_profile_id, role, model_id, intelligence_level, project_id, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        model_id = excluded.model_id,
        intelligence_level = excluded.intelligence_level,
        updated_at = excluded.updated_at
    `).run(id, accountProfileId, role, normalizedModelId, intelligenceLevel, projectId, nowIso);

    if (projectId && role === 'default') {
      try {
        db.prepare('UPDATE projects SET selected_model = ?, reasoning_level = ?, updated_at = ? WHERE id = ?').run(
          normalizedModelId,
          intelligenceLevel,
          nowIso,
          projectId
        );
      } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "modelRegistry",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:modelRegistry]", err);
      }
    }
    }

    Logger.info(
      `[ModelRegistry] Preferência atualizada: [${role}] -> ${normalizedModelId} (Intelligence: ${intelligenceLevel}, Account: ${accountProfileId || 'Global'})`
    );
  }
}