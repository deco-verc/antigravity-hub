// server/src/zoneManager.ts
// Architectural Governance Zones: GREEN, YELLOW, and RED Zone Enforcement

import path from 'node:path';
import { execSync } from 'node:child_process';
import { Logger } from './logger.js';

export type ZoneType = 'GREEN' | 'YELLOW' | 'RED';

export interface ZoneValidationResult {
  allowed: boolean;
  violationType?: 'RED_ZONE_VIOLATION' | 'YELLOW_ZONE_PROHIBITED';
  greenFiles: string[];
  yellowFiles: string[];
  redFiles: string[];
  rationale: string;
}

export class ZoneManager {
  // Patterns for RED Zone (NEVER modify autonomously)
  private static readonly RED_PATTERNS: RegExp[] = [
    /goldenEvaluator/i,
    /benchmarkSuite/i,
    /promotionGate/i,
    /promotionContract/i,
    /zoneManager/i, // Protected self-definition
    /securityManager/i,
    /protected/i,
    /holdout/i,
    /\.env/i,
    /credential/i,
    /auth/i,
    /token/i,
    /secrets?/i
  ];

  // Patterns for YELLOW Zone (Requires Council & stricter evaluation; blocked in GREEN_ONLY mode)
  private static readonly YELLOW_PATTERNS: RegExp[] = [
    /gitManager/i,
    /mcp/i,
    /db\.ts/i,
    /database/i,
    /recoveryManager/i,
    /accountProcess/i,
    /scheduler/i
  ];

  // Patterns for GREEN Zone (Freely optimizable by autonomous engine)
  private static readonly GREEN_PATTERNS: RegExp[] = [
    /agentGuidelines/i,
    /agent-guidelines\.md/i,
    /supervisorProvider/i,
    /antigravityProvider/i,
    /taskPlanner/i,
    /reviewPrompts/i,
    /prompts/i,
    /workerRegistry/i,
    /workerLease/i,
    /contextInjector/i
  ];

  /**
   * Classifies a file path into GREEN, YELLOW, or RED zone
   */
  static classifyFile(filePath: string): ZoneType {
    const normalized = filePath.replace(/\\/g, '/');

    // 1. Strict RED Zone check first
    for (const pattern of this.RED_PATTERNS) {
      if (pattern.test(normalized)) {
        return 'RED';
      }
    }

    // 2. YELLOW Zone check
    for (const pattern of this.YELLOW_PATTERNS) {
      if (pattern.test(normalized)) {
        return 'YELLOW';
      }
    }

    // 3. GREEN Zone check
    for (const pattern of this.GREEN_PATTERNS) {
      if (pattern.test(normalized)) {
        return 'GREEN';
      }
    }

    // Default: If inside prompts, guidelines, or doc, GREEN. Otherwise conservatively YELLOW.
    if (normalized.endsWith('.md') || normalized.includes('prompt') || normalized.includes('guidelines')) {
      return 'GREEN';
    }

    return 'YELLOW';
  }

  /**
   * Validates git diff between baseline and candidate against zone policies
   */
  static validateDiff(
    repoPath: string,
    baseCommit: string,
    candidateCommitOrFiles: string | string[],
    preset: 'GREEN_ONLY' | 'ALLOW_YELLOW' = 'GREEN_ONLY'
  ): ZoneValidationResult {
    let changedFiles: string[] = [];

    if (Array.isArray(candidateCommitOrFiles)) {
      changedFiles = candidateCommitOrFiles;
    } else {
      try {
        const out = execSync(`git diff --name-only ${baseCommit} ${candidateCommitOrFiles}`, {
          cwd: repoPath,
          encoding: 'utf-8',
          stdio: 'pipe'
        });
        changedFiles = out.split('\n').map(s => s.trim()).filter(s => s.length > 0);
      } catch (err: any) {
        Logger.warn(`[ZONE MANAGER] Falha ao calcular diff com git: ${err.message}. Usando lista vazia.`);
      }
    }

    const greenFiles: string[] = [];
    const yellowFiles: string[] = [];
    const redFiles: string[] = [];

    for (const file of changedFiles) {
      const zone = this.classifyFile(file);
      if (zone === 'RED') redFiles.push(file);
      else if (zone === 'YELLOW') yellowFiles.push(file);
      else greenFiles.push(file);
    }

    // 1. Check for RED zone violation (Automatic Failure)
    if (redFiles.length > 0) {
      const rationale = `[VIOLAÇÃO DE ZONA VERMELHA] O candidato modificou arquivos protegidos por governança: ${redFiles.join(', ')}. Rejeição sumária (REGRESSION_REJECTED).`;
      Logger.error(rationale);
      return {
        allowed: false,
        violationType: 'RED_ZONE_VIOLATION',
        greenFiles,
        yellowFiles,
        redFiles,
        rationale
      };
    }

    // 2. Check for YELLOW zone violation if in GREEN_ONLY mode
    if (preset === 'GREEN_ONLY' && yellowFiles.length > 0) {
      const rationale = `[VIOLAÇÃO DE MODO CONSERVADOR] O candidato modificou componentes da Zona Amarela no modo GREEN_ONLY: ${yellowFiles.join(', ')}. Permitido apenas no preset RESEARCH.`;
      Logger.warn(rationale);
      return {
        allowed: false,
        violationType: 'YELLOW_ZONE_PROHIBITED',
        greenFiles,
        yellowFiles,
        redFiles,
        rationale
      };
    }

    return {
      allowed: true,
      greenFiles,
      yellowFiles,
      redFiles,
      rationale: `Modificações em conformidade com as zonas de governança (${greenFiles.length} arquivos Green, ${yellowFiles.length} arquivos Yellow).`
    };
  }
}
