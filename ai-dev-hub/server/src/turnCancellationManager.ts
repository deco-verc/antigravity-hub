// server/src/turnCancellationManager.ts
// Universal In-Flight Turn & Message Cancellation Manager for DecoHUB.
// Tracks active cancellations for projects, agent conversation sessions, and Meta-Chat.

import { Logger } from './logger.js';

export class TurnCancellationManager {
  private static readonly MAX_ENTRIES = 500;
  private static readonly _cancellations = new Set<string>();

  /**
   * Registers a cancellation request for a given key (projectId, conversationId, or 'metachat').
   */
  static requestCancellation(key: string): void {
    if (!key || typeof key !== 'string') return;
    const cleanKey = key.trim();
    if (!cleanKey) return;
    if (this._cancellations.size >= this.MAX_ENTRIES) {
      const first = this._cancellations.values().next().value;
      if (first) this._cancellations.delete(first);
    }
    this._cancellations.add(cleanKey);
    Logger.info(`[TurnCancellationManager] Cancelamento registrado para token: "${cleanKey}"`);
  }

  /**
   * Checks whether any of the supplied keys have been marked for cancellation.
   */
  static isCancelled(...keys: (string | null | undefined)[]): boolean {
    for (const key of keys) {
      if (key && typeof key === 'string' && this._cancellations.has(key.trim())) {
        return true;
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
   * Resets all active cancellations (useful for test resets).
   */
  static clearAll(): void {
    this._cancellations.clear();
  }

  /**
   * Direct access to the internal Set instance.
   */
  static get activeTurnCancellations(): Set<string> {
    return this._cancellations;
  }
}

/**
 * Direct Set reference indexable by projectId, conversationId, and 'metachat'.
 */
export const activeTurnCancellations = TurnCancellationManager.activeTurnCancellations;
