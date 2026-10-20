// server/src/stableBaselineResolver.ts
// Dynamic Source of Truth for Stable Baseline and Version Registry

import { db } from './db.js';
import { execSync } from 'node:child_process';
import path from 'node:path';
import crypto from 'node:crypto';
import { Logger } from './logger.js';

export interface StableBaselineEntry {
  id: string;
  versionLabel: string;
  gitCommit: string;
  promotedAt: string;
  source: 'REGISTRY' | 'GIT_HEAD' | 'PROMOTION_KEEP' | 'BENCHMARK_CONGELADO' | 'TEST_OVERRIDE';
  runId?: string | null;
  experimentId?: string | null;
  isActive: boolean;
  metadata?: any;
}

export class StableBaselineResolver {
  private static repoRoot = path.resolve(process.cwd(), '..');

  /**
   * Ensures the stable_version_registry table exists in SQLite
   */
  static initTable(): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS stable_version_registry (
        id TEXT PRIMARY KEY,
        version_label TEXT NOT NULL,
        git_commit TEXT NOT NULL,
        promoted_at TEXT NOT NULL,
        source TEXT NOT NULL,
        run_id TEXT,
        experiment_id TEXT,
        is_active INTEGER DEFAULT 1,
        metadata_json TEXT
      );
    `);
  }

  /**
   * Resolves the current stable baseline dynamically.
   * Priority:
   * 1. Active entry in stable_version_registry table
   * 2. Live Git HEAD via 'git rev-parse HEAD'
   * 3. Latest baseline run in benchmark_runs table (is_baseline = 1)
   * 4. Error if no dynamic source of truth can be determined
   */
  static resolveStableBaseline(): { commit: string; versionLabel: string; source: string } {
    this.initTable();

    // 1. Check persistent registry in SQLite
    try {
      const activeRow: any = db.prepare(`
        SELECT * FROM stable_version_registry 
        WHERE is_active = 1 
        ORDER BY promoted_at DESC LIMIT 1
      `).get();

      if (activeRow && activeRow.git_commit && /^[0-9a-f]{40}$/i.test(activeRow.git_commit.trim())) {
        return {
          commit: activeRow.git_commit.trim(),
          versionLabel: activeRow.version_label,
          source: `REGISTRY (${activeRow.source})`
        };
      }
    } catch (err: any) {
      Logger.warn(`[StableBaselineResolver] Falha ao consultar stable_version_registry: ${err.message}`);
    }

    // 2. Query live Git repository HEAD
    try {
      const gitHead = execSync('git rev-parse HEAD', { cwd: this.repoRoot, encoding: 'utf-8' }).trim();
      if (/^[0-9a-f]{40}$/i.test(gitHead)) {
        // Auto-seed registry so subsequent calls resolve consistently
        this.setStableBaseline(gitHead, 'AI_DEV_STABLE_V1', 'GIT_HEAD');
        return {
          commit: gitHead,
          versionLabel: 'AI_DEV_STABLE_V1',
          source: 'GIT_HEAD'
        };
      }
    } catch (gitErr: any) {
      Logger.warn(`[StableBaselineResolver] Git rev-parse HEAD indisponível: ${gitErr.message}`);
    }

    // 3. Fallback to latest frozen baseline in benchmark_runs
    try {
      const benchRow: any = db.prepare(`
        SELECT git_commit, version_label FROM benchmark_runs 
        WHERE is_baseline = 1 AND git_commit IS NOT NULL 
        ORDER BY created_at DESC LIMIT 1
      `).get();

      if (benchRow && benchRow.git_commit && /^[0-9a-f]{40}$/i.test(benchRow.git_commit.trim())) {
        return {
          commit: benchRow.git_commit.trim(),
          versionLabel: benchRow.version_label || 'AI_DEV_STABLE_V1',
          source: 'BENCHMARK_CONGELADO'
        };
      }
    } catch (dbErr: any) {
      Logger.warn(`[StableBaselineResolver] Falha ao consultar benchmark_runs: ${dbErr.message}`);
    }

    throw new Error('Não foi possível determinar dinamicamente a stable baseline: nenhum Git HEAD válido ou registro persistido encontrado no banco.');
  }

  /**
   * Promotes or registers a new stable baseline commit dynamically
   */
  static setStableBaseline(
    commit: string,
    versionLabel: string,
    source: 'REGISTRY' | 'GIT_HEAD' | 'PROMOTION_KEEP' | 'BENCHMARK_CONGELADO' | 'TEST_OVERRIDE',
    runId?: string,
    experimentId?: string,
    metadata?: any
  ): StableBaselineEntry {
    this.initTable();

    const cleanCommit = commit.trim();
    if (!/^[0-9a-f]{40}$/i.test(cleanCommit)) {
      throw new Error(`Commit SHA inválido para stable baseline: "${commit}" (deve ter 40 caracteres hexadecimais)`);
    }

    const id = crypto.randomUUID();
    const nowIso = new Date().toISOString();

    // Deactivate previous active baselines
    db.prepare('UPDATE stable_version_registry SET is_active = 0 WHERE is_active = 1').run();

    // Insert new active baseline
    db.prepare(`
      INSERT INTO stable_version_registry (
        id, version_label, git_commit, promoted_at, source,
        run_id, experiment_id, is_active, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
    `).run(
      id,
      versionLabel,
      cleanCommit,
      nowIso,
      source,
      runId || null,
      experimentId || null,
      metadata ? JSON.stringify(metadata) : null
    );

    Logger.info(`[StableBaselineResolver] Nova stable baseline registrada: ${versionLabel} (${cleanCommit.slice(0, 8)}) [Fonte: ${source}]`);

    return {
      id,
      versionLabel,
      gitCommit: cleanCommit,
      promotedAt: nowIso,
      source,
      runId,
      experimentId,
      isActive: true,
      metadata
    };
  }

  /**
   * Returns complete history of registered baselines
   */
  static getHistory(): StableBaselineEntry[] {
    this.initTable();
    const rows: any[] = db.prepare(`
      SELECT * FROM stable_version_registry ORDER BY promoted_at DESC
    `).all();

    return rows.map(r => ({
      id: r.id,
      versionLabel: r.version_label,
      gitCommit: r.git_commit,
      promotedAt: r.promoted_at,
      source: r.source,
      runId: r.run_id,
      experimentId: r.experiment_id,
      isActive: Boolean(r.is_active),
      metadata: r.metadata_json ? JSON.parse(r.metadata_json) : undefined
    }));
  }
}
