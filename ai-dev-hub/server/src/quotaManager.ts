import { db } from './db.js';
import { Logger } from './logger.js';
import type { AccountProfile, AuthStatus } from './accountProfileManager.js';
import { AntigravityDiscovery } from './antigravityDiscovery.js';

export type QuotaSource = 'CLI' | 'AGENTAPI' | 'ESTIMATED';
export type QuotaUnit = 'REQUESTS' | 'TOKENS' | 'CREDITS' | 'UNKNOWN';
export type QuotaValidityState = 'VALID' | 'STALE' | 'UNKNOWN';

export interface NormalizedQuotaInfo {
  accountProfileId: string;
  authenticatedIdentity: string | null;
  source: QuotaSource;
  modelOrBucket: string;
  availableQuota: number | null;
  quotaUnit: QuotaUnit;
  resetsAt: string | null; // ISO Date string
  creditsAvailable: number | null;
  creditsStatus?: 'AVAILABLE' | 'UNKNOWN' | 'NOT_EXPOSED';
  creditsDisclaimer?: string;
  lastUpdated: string; // ISO Date string
  validityState: QuotaValidityState;
  queryError: string | null;
}

export interface CliUsageJsonPayload {
  models?: Array<{
    id?: string;
    slug?: string;
    name?: string;
    remainingRequests?: number;
    totalRequests?: number;
    remainingTokens?: number;
    resetsAt?: string;
    resetTimeSeconds?: number;
    disabled?: boolean;
  }>;
  credits?: {
    balance?: number;
    g1CreditsBalance?: number;
    currency?: string;
    resetsAt?: string;
  };
  account?: {
    email?: string;
    tier?: string;
  };
}

export class QuotaManager {
  private static cache: Map<string, { data: NormalizedQuotaInfo[]; timestamp: number }> = new Map();
  private static CACHE_TTL_MS = 60 * 1000; // 60s cache TTL

  /**
   * Resets internal cache (used in testing and after account status changes)
   */
  static clearCache(): void {
    this.cache.clear();
  }

  /**
   * Parses standard 429 quota exhaustion messages with duration format
   * (e.g. "Resets in 1h45m12s", "Resets in 45m", "retry after 120s", or AGY_ERROR payloads)
   */
  static parseQuotaResetError(errorMsg?: string): { durationMs: number; resetsAt: string } {
    const now = new Date();
    const raw = errorMsg || '';
    let durationMs = 60 * 60 * 1000; // 1 hour default fallback

    const resetsInMatch = raw.match(/Resets in (?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/i);
    if (resetsInMatch) {
      const h = parseInt(resetsInMatch[1] || '0', 10);
      const m = parseInt(resetsInMatch[2] || '0', 10);
      const s = parseInt(resetsInMatch[3] || '0', 10);
      const calculated = (h * 3600 + m * 60 + s) * 1000;
      if (calculated > 0) durationMs = calculated;
    } else {
      const retryAfterMatch = raw.match(/retry[-_\s]?after[:\s]+(\d+)\s*s?/i);
      if (retryAfterMatch && retryAfterMatch[1]) {
        const secs = parseInt(retryAfterMatch[1], 10);
        if (secs > 0) durationMs = secs * 1000;
      }
    }

    const resetDate = new Date(now.getTime() + durationMs);
    return {
      durationMs,
      resetsAt: resetDate.toISOString()
    };
  }

  /**
   * Defensive parser for simulated or real CLI `/usage` and `/credits` JSON payloads
   */
  static parseCliUsageJson(
    accountProfileId: string,
    authenticatedIdentity: string | null,
    jsonString: string
  ): NormalizedQuotaInfo[] {
    const now = new Date().toISOString();
    try {
      const parsed: CliUsageJsonPayload = JSON.parse(jsonString);
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('Payload JSON inválido ou vazio');
      }

      const results: NormalizedQuotaInfo[] = [];
      const identity = parsed.account?.email || authenticatedIdentity;
      const creditBalance =
        typeof parsed.credits?.balance === 'number'
          ? parsed.credits.balance
          : typeof parsed.credits?.g1CreditsBalance === 'number'
            ? parsed.credits.g1CreditsBalance
            : null;

      if (Array.isArray(parsed.models) && parsed.models.length > 0) {
        for (const m of parsed.models) {
          const modelIdentifier = m?.id || m?.slug;
          if (!m || typeof m !== 'object' || !modelIdentifier) continue;

          let availableQuota: number | null = null;
          let quotaUnit: QuotaUnit = 'UNKNOWN';

          if (typeof m.remainingRequests === 'number') {
            availableQuota = m.remainingRequests;
            quotaUnit = 'REQUESTS';
          } else if (typeof m.remainingTokens === 'number') {
            availableQuota = m.remainingTokens;
            quotaUnit = 'TOKENS';
          }

          let resetsAt: string | null = null;
          if (m.resetsAt) {
            resetsAt = m.resetsAt;
          } else if (typeof m.resetTimeSeconds === 'number' && m.resetTimeSeconds > 0) {
            resetsAt = new Date(Date.now() + m.resetTimeSeconds * 1000).toISOString();
          }

          results.push({
            accountProfileId,
            authenticatedIdentity: identity,
            source: 'CLI',
            modelOrBucket: modelIdentifier,
            availableQuota,
            quotaUnit,
            resetsAt,
            creditsAvailable: creditBalance,
            lastUpdated: now,
            validityState: 'VALID',
            queryError: null
          });
        }
      }

      if (results.length > 0) {
        return results;
      }

      // If no models array was found, return baseline credit/account record
      return [
        {
          accountProfileId,
          authenticatedIdentity: identity,
          source: 'CLI',
          modelOrBucket: 'default',
          availableQuota: null,
          quotaUnit: 'UNKNOWN',
          resetsAt: parsed.credits?.resetsAt || null,
          creditsAvailable: creditBalance,
          lastUpdated: now,
          validityState: 'VALID',
          queryError: null
        }
      ];
    } catch (err: any) {
      return [
        {
          accountProfileId,
          authenticatedIdentity,
          source: 'CLI',
          modelOrBucket: 'unknown',
          availableQuota: null,
          quotaUnit: 'UNKNOWN',
          resetsAt: null,
          creditsAvailable: null,
          lastUpdated: now,
          validityState: 'UNKNOWN',
          queryError: `Falha ao interpretar saída JSON do CLI: ${err.message}`
        }
      ];
    }
  }

  private static _getProfileRow(profileId: string): any {
    try {
      const row: any = db
        .prepare('SELECT * FROM account_profiles WHERE id = ? OR profile_name = ?')
        .get(profileId, profileId);
      if (!row) return null;

      // Auto-heal expired quota cooldown directly in DB so stale QUOTA_EXHAUSTED never blocks indefinitely
      if (
        (row.auth_status === 'QUOTA_EXHAUSTED' || row.auth_status === 'RATE_LIMITED') &&
        row.quota_resets_at &&
        Date.now() >= new Date(row.quota_resets_at).getTime()
      ) {
        const nowIso = new Date().toISOString();
        try {
          db.prepare(`
            UPDATE account_profiles
            SET auth_status = 'AUTH_UNKNOWN',
                quota_resets_at = NULL,
                quota_message = 'Cooldown expirou. Elegível para tentativa; quota e OAuth ainda não confirmados.',
                updated_at = ?
            WHERE id = ?
          `).run(nowIso, row.id);
          db.prepare(`
            UPDATE workers
            SET status = 'WAITING', updated_at = ?
            WHERE account_profile_id = ? AND status = 'COOLDOWN'
          `).run(nowIso, row.id);
          row.auth_status = 'AUTH_UNKNOWN';
          row.quota_resets_at = null;
          row.quota_message = 'Cooldown expirou. Elegível para tentativa; quota e OAuth ainda não confirmados.';
          this.cache.delete(profileId);
        } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "quotaManager",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:quotaManager]", err);
      }
    }
      }

      return row;
    } catch {
      return null;
    }
  }

  /**
   * Gets normalized quota info for an AccountProfile with read-only inspection, caching and TTL
   */
  static getQuotaForProfile(profileId: string, forceRefresh = false): NormalizedQuotaInfo[] {
    const now = Date.now();
    const cached = this.cache.get(profileId);

    if (!forceRefresh && cached && now - cached.timestamp < this.CACHE_TTL_MS) {
      return cached.data;
    }

    const profile = this._getProfileRow(profileId);
    if (!profile) {
      return [
        {
          accountProfileId: profileId,
          authenticatedIdentity: null,
          source: 'AGENTAPI',
          modelOrBucket: 'unknown',
          availableQuota: null,
          quotaUnit: 'UNKNOWN',
          resetsAt: null,
          creditsAvailable: null,
          lastUpdated: new Date().toISOString(),
          validityState: 'UNKNOWN',
          queryError: `Perfil ${profileId} não encontrado.`
        }
      ];
    }

    const quotaInfoList: NormalizedQuotaInfo[] = [];
    const models = ['pro', 'flash', 'flash_lite'];
    const nowIso = new Date().toISOString();

    const hasActiveCooldown = Boolean(
      profile.quota_resets_at && new Date(profile.quota_resets_at).getTime() > now
    );
    const isExhausted =
      hasActiveCooldown ||
      ((profile.auth_status === 'QUOTA_EXHAUSTED' || profile.auth_status === 'RATE_LIMITED') &&
        !profile.quota_resets_at);

    for (const model of models) {
      quotaInfoList.push({
        accountProfileId: profile.id,
        authenticatedIdentity: null,
        source: 'ESTIMATED',
        modelOrBucket: model,
        availableQuota: null,
        quotaUnit: 'UNKNOWN',
        resetsAt: isExhausted ? profile.quota_resets_at || null : null,
        creditsAvailable: null,
        creditsStatus: 'NOT_EXPOSED',
        creditsDisclaimer: 'Créditos de IA e cota de janela de 5 horas são acompanhados no Google Antigravity Desktop.',
        lastUpdated: nowIso,
        validityState: 'UNKNOWN',
        queryError: isExhausted
          ? profile.quota_message || 'Cooldown após 429; quota por modelo desconhecida'
          : 'QUOTA_TELEMETRY_UNAVAILABLE: /usage real não integrado; identidade OAuth não confirmada.'
      });
    }

    this.cache.set(profileId, { data: quotaInfoList, timestamp: now });
    return quotaInfoList;
  }

  /**
   * Checks if a specific model or profile is currently blocked by quota
   */
  static isBlockedByQuota(
    profileId: string,
    _modelId?: string
  ): { blocked: boolean; resetsAt: string | null; reason: string | null } {
    const profile = this._getProfileRow(profileId);
    if (!profile) {
      return { blocked: true, resetsAt: null, reason: 'Perfil inexistente' };
    }

    if (profile.quota_resets_at) {
      const resetTime = new Date(profile.quota_resets_at).getTime();
      if (Date.now() < resetTime) {
        return {
          blocked: true,
          resetsAt: profile.quota_resets_at,
          reason: profile.quota_message || 'Limite de cota ativo (aguardando reset)'
        };
      }
      // Reset time already passed (auto-healed in _getProfileRow)
      return { blocked: false, resetsAt: null, reason: null };
    }

    if (profile.auth_status === 'QUOTA_EXHAUSTED' || profile.auth_status === 'RATE_LIMITED') {
      return {
        blocked: true,
        resetsAt: profile.quota_resets_at || null,
        reason: profile.quota_message || 'Cota ou taxa limite atingida'
      };
    }

    return { blocked: false, resetsAt: null, reason: null };
  }

  /**
   * Finds the first available account profile that is not blocked by quota for the given model
   */
  static findAvailableProfileForModel(modelId?: string, excludeProfileId?: string): string | null {
    try {
      const rows: any[] = db.prepare('SELECT id, auth_status FROM account_profiles ORDER BY created_at ASC').all();
      for (const r of rows) {
        if (excludeProfileId && r.id === excludeProfileId) continue;
        if (r.auth_status === 'LOGIN_REQUIRED' || r.auth_status === 'ERROR' || r.auth_status === 'NOT_CONFIGURED') {
          continue;
        }
        const check = this.isBlockedByQuota(r.id, modelId);
        if (!check.blocked) {
          return r.id;
        }
      }
    } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "quotaManager",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:quotaManager]", err);
      }
    }
    return null;
  }
}