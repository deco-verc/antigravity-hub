// server/src/turnCancellationManager.ts
// Universal In-Flight Turn & Message Cancellation Manager for DecoHUB.
// Tracks active cancellations for projects, agent conversation sessions, and Meta-Chat.

import { Logger } from './logger.js';

export class TurnCancellationManager {
  private static readonly MAX_ENTRIES = 500;
  public static readonly CANCELLATION_TTL_MS = 60000; // 60 segundos
  private static readonly _cancellations = new Map<string, number>();

  /**
   * Registers a cancellation request for a given key (projectId, conversationId, or 'metachat').
   */
  static requestCancellation(key: string): void {
    if (!key || typeof key !== 'string') return;
    const cleanKey = key.trim();
    if (!cleanKey) return;
    if (this._cancellations.size >= this.MAX_ENTRIES) {
      const first = this._cancellations.keys().next().value;
      if (first) this._cancellations.delete(first);
    }
    this._cancellations.set(cleanKey, Date.now());
    Logger.info(`[TurnCancellationManager] Cancelamento registrado para token: "${cleanKey}"`);
  }

  /**
   * Checks whether any of the supplied keys have been marked for cancellation.
   * Discards cancellation entries older than 60 seconds (TTL) and returns false.
   */
  static isCancelled(...keys: (string | null | undefined)[]): boolean {
    const now = Date.now();
    for (const key of keys) {
      if (key && typeof key === 'string') {
        const cleanKey = key.trim();
        const timestamp = this._cancellations.get(cleanKey);
        if (timestamp !== undefined) {
          if (now - timestamp <= this.CANCELLATION_TTL_MS) {
            return true;
          } else {
            // Cancelamento expirado (> 60s)
            this._cancellations.delete(cleanKey);
            Logger.info(`[TurnCancellationManager] Cancelamento expirado (>60s) descartado para token: "${cleanKey}"`);
          }
        }
      }
    }
    return false;
  }

  /**
   * Clears cancellation status for the given keys.
   */
  static clearCancellation(...keys: (string | null | undefined)[]): void {
    for (const key of keys) {
      if (key && typeof key === 'string') {
        this._cancellations.delete(key.trim());
      }
    }
  }

  /**
   * Clears cancellation status for a project and any associated session keys.
   */
  static clearProjectCancellations(projectId: string, ...extraKeys: (string | null | undefined)[]): void {
    if (!projectId) return;
    this.clearCancellation(projectId, ...extraKeys);
    Logger.info(`[TurnCancellationManager] Cancelamento removido para projeto "${projectId}"`);
  }

  /**
   * Resets all active cancellations (useful for test resets).
   */
  static clearAll(): void {
    this._cancellations.clear();
  }

  /**
   * Direct access to the internal Map instance.
   */
  static get activeTurnCancellations(): Map<string, number> {
    return this._cancellations;
  }
}

/**
 * Direct Map reference indexable by projectId, conversationId, and 'metachat'.
 */
export const activeTurnCancellations = TurnCancellationManager.activeTurnCancellations;
