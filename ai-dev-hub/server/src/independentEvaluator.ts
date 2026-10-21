import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { db } from './db.js';
import { Logger } from './logger.js';
import { validateSurgicalDiff } from './agentGuidelines.js';
import { PolicyEngine } from './policyEngine.js';
import { resolveVerificationCommand, normalizeOrRecoverVerificationCommand } from './verificationCommand.js';
import { executeVerification, executeVerificationAsync } from './controlledVerification.js';
import { ObservabilityService } from './observability/observabilityService.js';
import { CommandExecutionEngine } from './commandExecutionEngine.js';
import { TestSelector } from './testSelector.js';
import { PlaywrightVisualInspector, VisualInspectionResult } from './playwrightVisualInspector.js';
import { UserExperienceSimulator, UserJourneyResult } from './userExperienceSimulator.js';
import { SecurityPentestSimulator, SecurityPentestResult } from './securityPentestSimulator.js';
import { CiDoctorService, FailureDiagnosis } from './ciDoctorService.js';

export interface VerificationStep {
  name: string;
  command?: string;
  expectedExitCode?: number;
  expectedOutputPattern?: string;
  checkType?: 'command' | 'file_exists' | 'content_match';
  targetPath?: string;
  criteria?: string[];
}

export interface BaselineResult {
  ran: boolean;
  passed: boolean;
  command?: string;
  exitCode?: number;
  output?: string;
  timestamp?: string;
}

export interface SuccessContract {
  id: string;
  taskId: string;
  runId?: string;
  projectId: string;
  objective: string;
  acceptanceCriteria: string[];
  verificationSteps: VerificationStep[];
  protectedEvaluationFiles: string[];
  protectedFileHashes: Record<string, string>;
  baseline: BaselineResult;
  successThresholds: string[];
  failureConditions: string[];
  status: 'pending' | 'baseline_failed' | 'in_evaluation' | 'passed' | 'failed' | 'tampered';
  createdAt: string;
  updatedAt: string;
}

export type EvaluatorVerdict = 'PASS' | 'FAIL' | 'TIMEOUT' | 'INCONCLUSIVE' | 'BLOCKED' | 'TAMPERING_DETECTED';

export interface TestWeakeningFinding {
  file: string;
  assertionsBefore: number;
  assertionsAfter: number;
  removedAssertionsCount: number;
  skippedFound: string[];
  trivializedFound: string[];
  description: string;
}

export interface TestWeakeningAnalysis {
  isWeakened: boolean;
  weakenedFiles: string[];
  findings: TestWeakeningFinding[];
  reason?: string;
}

export interface DynamicRiskAssessment {
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  reversibility: 'REVERSIBLE' | 'PARTIALLY_REVERSIBLE' | 'IRREVERSIBLE';
  blastRadius: 'LOCAL' | 'MODULE' | 'SYSTEM';
  worstCaseScenario: string;
  rollbackPlan: string;
  riskFactors: string[];
}

export interface AdversarialFinding {
  testFile: string;
  category: 'MISSING_NEGATIVE_TESTS' | 'MISSING_EDGE_CASES' | 'MISSING_INJECTION_CHECKS';
  description: string;
}

export interface AdversarialValidationResult {
  passed: boolean;
  score: number;
  adversarialCovered: boolean;
  findings: AdversarialFinding[];
  details: string;
}

export interface AntiSlopFinding {
  file: string;
  type: 'EMPTY_PLACEHOLDER' | 'PRODUCTION_MOCK' | 'UNCHANGED_CORE_CLAIM' | 'TAUTOLOGICAL_ASSERTION';
  details: string;
}

export interface AntiSlopAnalysis {
  hasSlop: boolean;
  findings: AntiSlopFinding[];
  reason?: string;
}

export interface FrontendDesignQualityFinding {
  file: string;
  type:
    | 'EMOJI_ICON_PROLIFERATION'
    | 'MISSING_DESIGN_TOKENS'
    | 'RAW_UNSTYLED_CONTROLS'
    | 'ROOT_ROUTE_HIJACKED_BY_JSON'
    | 'SHALLOW_SAAS_INTERFACE'
    | 'MISSING_SAAS_MASTER_COMPLEXITY';
  details: string;
}

export interface FrontendDesignQualityResult {
  passed: boolean;
  score: number;
  findings: FrontendDesignQualityFinding[];
  details?: string;
}

export interface SaaSMasterComplexityResult {
  passed: boolean;
  score: number;
  findings: FrontendDesignQualityFinding[];
  details: string;
  metrics: {
    hasShellOrSearch: boolean;
    hasDetailDrawer: boolean;
    hasDataGridControls: boolean;
    hasAnalyticsOrKpis: boolean;
    hasReactiveStoreOrAudit: boolean;
    totalFeaturesDetected: number;
  };
}

export interface EvidenceSummary {
  codeDiffAvailable: boolean;
  filesChangedCount: number;
  independentCommandExecuted: boolean;
  independentCommandExitCode: number;
  requirementsVerifiedCount: number;
  adversarialChecksPassed: boolean;
  antiSlopPassed: boolean;
  designQualityPassed?: boolean;
  visualInspectionPassed?: boolean;
  userJourneyPassed?: boolean;
  securityPentestPassed?: boolean;
  groundTruthVerified: boolean;
  effortLevel?: 'MINIMAL' | 'STANDARD' | 'DEEP';
}

export interface EvaluationResult {
  id: string;
  contractId: string;
  taskId: string;
  runId?: string;
  verdict: EvaluatorVerdict;
  builderStatus: 'COMPLETED' | 'FAILED';
  evaluatorVerdict: EvaluatorVerdict;
  taskIsDone: boolean;
  passedCriteria: string[];
  failedCriteria: string[];
  evidence: {
    filesChanged?: string[];
    controlledOperations?: Array<{
      executable: string;
      args: string[];
      cwd: string;
      sourceProject: string;
      recordPath: string;
      durationMs: number;
    }>;
    command?: string;
    exitCode?: number;
    output?: string;
    durationMs?: number;
    tamperingDetected?: boolean;
    tamperedFiles?: string[];
    testWeakening?: TestWeakeningAnalysis;
    dynamicRiskAssessment?: DynamicRiskAssessment;
    adversarialValidation?: AdversarialValidationResult;
    antiSlop?: AntiSlopAnalysis;
    designQuality?: FrontendDesignQualityResult;
    visualInspection?: VisualInspectionResult;
    userJourney?: UserJourneyResult;
    securityPentest?: SecurityPentestResult;
    evidenceSummary?: EvidenceSummary;
    stepsResults?: Array<{
      step: string;
      passed: boolean;
      detail: string;
    }>;
    ciDoctorHealed?: boolean;
    ciDoctorDiagnosis?: FailureDiagnosis | null;
    ciDoctorPatchApplied?: string;
    scopeValidation?: {
      isSurgical: boolean;
      unrelatedFiles: string[];
      explanation: string;
    };
  };
  expected: string;
  actual: string;
  evaluatorNotes: string;
  evaluatorName: string;
  executedCommands: string[];
  exitCode: number;
  durationMs: number;
  createdAt: string;
}

export class IndependentEvaluator {
  private static evaluatorName = 'Independent Evaluator (Karpathy Layer)';

  private static buildCleanExecutionEnv(): NodeJS.ProcessEnv {
    const cleanEnv: NodeJS.ProcessEnv = { ...process.env };
    delete cleanEnv.ELECTRON_RUN_AS_NODE;
    delete cleanEnv.ELECTRON_NO_ASAR;
    delete cleanEnv.ELECTRON_OZONE_PLATFORM_HINT;
    delete cleanEnv.ELECTRON_ENABLE_LOGGING;
    delete cleanEnv.NODE_TEST_CONTEXT;
    return cleanEnv;
  }

  static listEvaluationFiles(projectPath: string): string[] {
    const files: string[] = [];
    const scan = (dir: string, depth: number) => {
      if (depth > 8) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!['.git', 'node_modules', 'dist', 'build', '.ai-dev-hub', '.agents', '.playwright-cli'].includes(entry.name)) {
            scan(full, depth + 1);
          }
        } else if (
          entry.isFile() &&
          /(?:\.(test|spec)\.[cm]?[jt]sx?$|(?:^|[\\/])(test|tests)[\\/].*\.[cm]?[jt]sx?$)/i.test(full)
        ) {
          files.push(path.relative(projectPath, full).replace(/\\/g, '/'));
        }
      }
    };
    if (fs.existsSync(projectPath)) scan(projectPath, 0);
    return files;
  }

  /**
   * Computes a normalized SHA-256 hash of a file's content (ignoring CRLF vs LF line endings)
   */
  static computeFileHash(filePath: string): string | null {
    if (!fs.existsSync(filePath)) return null;
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const normalized = content.replace(/\r\n/g, '\n').trim();
      return crypto.createHash('sha256').update(normalized).digest('hex');
    } catch {
      return null;
    }
  }

  /**
   * Normalizes path relative to project
   */
  private static normalizeRelativePath(p: string, projectPath: string): string {
    const full = path.isAbsolute(p) ? p : path.join(projectPath, p);
    return path.relative(projectPath, full).replace(/\\/g, '/');
  }

  /**
   * Creates a formal SuccessContract for a task
   */
  static createSuccessContract(params: {
    taskId: string;
    runId?: string;
    projectId: string;
    projectPath: string;
    objective: string;
    acceptanceCriteria: string[];
    verificationSteps?: VerificationStep[];
    verificationCommand?: string;
    protectedEvaluationFiles?: string[];
    successThresholds?: string[];
    failureConditions?: string[];
    isBugFix?: boolean;
  }): SuccessContract {
    const id = crypto.randomUUID();
    const nowIso = new Date().toISOString();

    const verificationSteps: VerificationStep[] =
      params.verificationSteps ||
      (params.verificationCommand
        ? [{ name: 'Verificação automatizada', command: params.verificationCommand, expectedExitCode: 0 }]
        : []);

    const protectedEvaluationFiles = (params.protectedEvaluationFiles || []).map(f =>
      this.normalizeRelativePath(f, params.projectPath)
    );

    // Compute hashes for all protected evaluation files currently on disk
    const protectedFileHashes: Record<string, string> = {};
    for (const relFile of protectedEvaluationFiles) {
      const fullPath = path.join(params.projectPath, relFile);
      const hash = this.computeFileHash(fullPath);
      if (hash) {
        protectedFileHashes[relFile] = hash;
      }
    }

    const successThresholds = params.successThresholds || [
      'Código de saída 0 no comando de verificação',
      '100% dos testes da suíte passando sem erros',
      'Zero exceções não tratadas'
    ];

    const failureConditions = params.failureConditions || [
      'Código de saída diferente de 0',
      'Alteração em arquivos de teste protegidos (PROTECTED_EVALUATION)',
      'Falha de compilação ou execução'
    ];

    let baseline: BaselineResult = {
      ran: false,
      passed: false
    };

    // If it's a bug fix or has an initial verification step, establish baseline
    if (params.isBugFix && verificationSteps.length > 0 && verificationSteps[0].command) {
      const cmd = verificationSteps[0].command;
      Logger.info(`[Evaluator] Estabelecendo BASELINE para a tarefa de bugfix: "${cmd}"...`);
      let baselineProcessStarted = false;
      try {
        const out = executeVerification(cmd, params.projectPath, 30000, () => {
          baselineProcessStarted = true;
        });
        baseline = {
          ran: true,
          passed: true,
          command: cmd,
          exitCode: 0,
          output: out.slice(0, 1000),
          timestamp: new Date().toISOString()
        };
        Logger.warn(`[Evaluator Baseline] Alerta: O teste já passou antes da alteração (esperava-se falha inicial na reprodução).`);
      } catch (err: any) {
        baseline = {
          ran: baselineProcessStarted && !err.code,
          passed: false,
          command: cmd,
          exitCode: err.status || 1,
          output: (err.stdout || err.stderr || err.message).slice(0, 1000),
          timestamp: new Date().toISOString()
        };
        if (baseline.ran) {
          Logger.info(`[Evaluator Baseline] Verificação executada retornou falha; saída registrada para análise do defeito.`);
        } else {
          Logger.warn(`[Evaluator Baseline] Baseline não comprovada: operação bloqueada, indisponível ou interrompida. ${err.message}`);
        }
      }
    }

    const contract: SuccessContract = {
      id,
      taskId: params.taskId,
      runId: params.runId,
      projectId: params.projectId,
      objective: params.objective,
      acceptanceCriteria: params.acceptanceCriteria,
      verificationSteps,
      protectedEvaluationFiles,
      protectedFileHashes,
      baseline,
      successThresholds,
      failureConditions,
      status: baseline.ran && !baseline.passed ? 'baseline_failed' : 'pending',
      createdAt: nowIso,
      updatedAt: nowIso
    };

    // Persist in SQLite
    db.prepare(`
      INSERT INTO success_contracts (
        id, task_id, run_id, project_id, objective, acceptance_criteria_json,
        verification_steps_json, protected_evaluation_files_json, protected_file_hashes_json,
        baseline_json, success_thresholds_json, failure_conditions_json, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      contract.id,
      contract.taskId,
      contract.runId || null,
      contract.projectId,
      contract.objective,
      JSON.stringify(contract.acceptanceCriteria),
      JSON.stringify(contract.verificationSteps),
      JSON.stringify(contract.protectedEvaluationFiles),
      JSON.stringify(contract.protectedFileHashes),
      JSON.stringify(contract.baseline),
      JSON.stringify(contract.successThresholds),
      JSON.stringify(contract.failureConditions),
      contract.status,
      contract.createdAt,
      contract.updatedAt
    );

    // Update autonomous_tasks
    try {
      db.prepare(`
        UPDATE autonomous_tasks
        SET contract_id = ?, evaluation_status = 'pending', updated_at = ?
        WHERE id = ?
      `).run(contract.id, nowIso, contract.taskId);
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "independentEvaluator",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:independentEvaluator]", err);
      }
    }

    Logger.info(
      `[Evaluator] SuccessContract #${id.slice(0, 8)} gerado para a tarefa "${params.objective}". (${protectedEvaluationFiles.length} arquivos protegidos)`
    );
    return contract;
  }

  /**
   * Inspects if the Builder modified or deleted any PROTECTED_EVALUATION files
   */
  static checkTampering(
    contract: SuccessContract,
    projectPath: string,
    builderFilesChanged: string[]
  ): { tampered: boolean; tamperedFiles: string[]; reason?: string } {
    if (!contract.protectedEvaluationFiles || contract.protectedEvaluationFiles.length === 0) {
      return { tampered: false, tamperedFiles: [] };
    }

    const tamperedFiles: string[] = [];
    const normalizedBuilderFiles = builderFilesChanged.map(f => this.normalizeRelativePath(f, projectPath));

    for (const protFile of contract.protectedEvaluationFiles) {
      const fullPath = path.join(projectPath, protFile);
      if (!fs.existsSync(fullPath)) {
        if (!tamperedFiles.includes(protFile)) tamperedFiles.push(protFile);
        continue;
      }

      const recordedHash = contract.protectedFileHashes?.[protFile];
      const currentHash = this.computeFileHash(fullPath);
      const hashChanged = recordedHash ? currentHash !== recordedHash : normalizedBuilderFiles.includes(protFile);

      if (hashChanged) {
        const contentBefore = this.getFileContentBefore(projectPath, protFile);
        if (contentBefore === null) {
          if (!tamperedFiles.includes(protFile)) tamperedFiles.push(protFile);
        } else {
          const assertionsBefore = this.countAssertions(contentBefore);
          const weakening = this.detectTestWeakening(projectPath, [protFile]);
          if (assertionsBefore === 0 || weakening.isWeakened) {
            if (!tamperedFiles.includes(protFile)) tamperedFiles.push(protFile);
          }
        }
      }
    }

    const tampered = tamperedFiles.length > 0;
    return {
      tampered,
      tamperedFiles,
      reason: tampered
        ? `Violação de Avaliação Independente: O Builder modificou ou removeu arquivo(s) de teste protegido(s): ${tamperedFiles.join(', ')}. Não é permitido enfraquecer ou alterar testes de validação para forçar aprovação.`
        : undefined
    };
  }

  /**
   * Helper: Counts active assertions in a test file (assert.*, expect(...).*, should.*), excluding comments.
   */
  static countAssertions(content: string): number {
    if (!content) return 0;
    const lines = content.split('\n');
    let count = 0;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
      const assertMatches = trimmed.match(/\bassert(\.[a-zA-Z0-9_]+)?\s*\(/g);
      if (assertMatches) count += assertMatches.length;
      const expectMatches = trimmed.match(/\bexpect\s*\([^)]*\)\s*\.[a-zA-Z0-9_]+\s*\(/g);
      if (expectMatches) count += expectMatches.length;
    }
    return count;
  }

  /**
   * Helper: Extracts active assertion lines (normalized by whitespace) and their occurrence counts.
   */
  static extractAssertionLines(content: string): Map<string, number> {
    const counts = new Map<string, number>();
    if (!content) return counts;
    for (const rawLine of content.split('\n')) {
      const trimmed = rawLine.trim();
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
      if (/\bassert(\.[a-zA-Z0-9_]+)?\s*\(/.test(trimmed) || /\bexpect\s*\([^)]*\)\s*\.[a-zA-Z0-9_]+\s*\(/.test(trimmed)) {
        const normalized = trimmed.replace(/\s+/g, ' ');
        counts.set(normalized, (counts.get(normalized) || 0) + 1);
      }
    }
    return counts;
  }

  /**
   * Helper: Detects disabled or skipped test calls (e.g. test.skip, it.skip, xit, commented-out assertions).
   */
  static detectSkippedTests(content: string): string[] {
    if (!content) return [];
    const lines = content.split('\n');
    const skipped: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (/\b(test|it|describe)\.skip\s*\(/.test(line)) {
        skipped.push(`Linha ${i + 1}: ${line.slice(0, 80)}`);
      } else if (/\b(xit|xtest|xdescribe)\s*\(/.test(line)) {
        skipped.push(`Linha ${i + 1}: ${line.slice(0, 80)}`);
      } else if (/^\/\/\s*(?:assert\.|expect\s*\()/.test(line)) {
        skipped.push(`Linha ${i + 1} (asserção comentada): ${line.slice(0, 80)}`);
      }
    }
    return skipped;
  }

  /**
   * Helper: Detects trivial or tautological assertions that cannot fail (e.g. assert.ok(true), 1 === 1).
   */
  static detectTrivialAssertions(content: string): string[] {
    if (!content) return [];
    const lines = content.split('\n');
    const trivial: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('//')) continue;
      if (/\bassert\.ok\(\s*true\s*\)/.test(line)) {
        trivial.push(`Linha ${i + 1}: assert.ok(true)`);
      } else if (/\bassert\.(?:strictEqual|equal)\(\s*(?:1|0|true|false)\s*,\s*(?:1|0|true|false)\s*\)/.test(line)) {
        trivial.push(`Linha ${i + 1}: asserção tautológica`);
      } else if (/\bexpect\(\s*true\s*\)\.toBe\(\s*true\s*\)/.test(line)) {
        trivial.push(`Linha ${i + 1}: expect(true).toBe(true)`);
      } else if (/\bexpect\(\s*1\s*\)\.toBe\(\s*1\s*\)/.test(line)) {
        trivial.push(`Linha ${i + 1}: expect(1).toBe(1)`);
      }
    }
    return trivial;
  }

  /**
   * Reads the prior version of a file from Git (HEAD~1 or HEAD before working tree changes).
   */
  static getFileContentBefore(projectPath: string, relFile: string): string | null {
    const normRel = relFile.replace(/\\/g, '/');
    try {
      return execSync(`git show HEAD~1:"${normRel}"`, {
        cwd: projectPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore']
      });
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "independentEvaluator",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:independentEvaluator]", err);
      }
    }

    try {
      return execSync(`git show HEAD:"${normRel}"`, {
        cwd: projectPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore']
      });
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "independentEvaluator",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:independentEvaluator]", err);
      }
    }

    return null;
  }

  /**
   * Detects if the Builder modified existing test files to weaken checks,
   * remove assertions, skip failing tests, or add trivialized assertions.
   */
  static detectTestWeakening(
    projectPath: string,
    builderFilesChanged: string[]
  ): TestWeakeningAnalysis {
    const findings: TestWeakeningFinding[] = [];
    const weakenedFiles: string[] = [];

    const isTestFile = (f: string) => {
      const lower = f.toLowerCase().replace(/\\/g, '/');
      return (
        lower.includes('/test/') ||
        lower.startsWith('test/') ||
        lower.includes('/tests/') ||
        lower.startsWith('tests/') ||
        /\.(test|spec)\.[a-zA-Z0-9]+$/.test(lower)
      );
    };

    const candidateFiles = new Set<string>();
    for (const f of builderFilesChanged) {
      if (isTestFile(f)) {
        candidateFiles.add(this.normalizeRelativePath(f, projectPath));
      }
    }

    try {
      const gitStatusOut = execSync('git status --porcelain', {
        cwd: projectPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore']
      });
      for (const line of gitStatusOut.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const filePath = trimmed.slice(3).trim();
        if (isTestFile(filePath)) {
          candidateFiles.add(this.normalizeRelativePath(filePath, projectPath));
        }
      }
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "independentEvaluator",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:independentEvaluator]", err);
      }
    }

    for (const relFile of candidateFiles) {
      const fullPath = path.join(projectPath, relFile);
      const contentBefore = this.getFileContentBefore(projectPath, relFile);

      if (!fs.existsSync(fullPath)) {
        if (contentBefore !== null) {
          const assertionsBefore = this.countAssertions(contentBefore);
          weakenedFiles.push(relFile);
          findings.push({
            file: relFile,
            assertionsBefore,
            assertionsAfter: 0,
            removedAssertionsCount: assertionsBefore,
            skippedFound: [],
            trivializedFound: [],
            description: `Arquivo de teste existente (${assertionsBefore} asserções) foi removido.`
          });
        }
        continue;
      }

      let contentAfter = '';
      try {
        contentAfter = fs.readFileSync(fullPath, 'utf-8');
      } catch {
        continue;
      }

      const assertionsAfter = this.countAssertions(contentAfter);
      const skippedAfter = this.detectSkippedTests(contentAfter);
      const trivialAfter = this.detectTrivialAssertions(contentAfter);

      let isWeakened = false;
      const fileFindings: string[] = [];
      let removedAssertionsCount = 0;
      let assertionsBefore = assertionsAfter;

      if (contentBefore !== null) {
        assertionsBefore = this.countAssertions(contentBefore);
        const skippedBefore = this.detectSkippedTests(contentBefore);
        const trivialBefore = this.detectTrivialAssertions(contentBefore);

        // 1. Check for reduced assertion count
        if (assertionsAfter < assertionsBefore) {
          removedAssertionsCount = assertionsBefore - assertionsAfter;
          isWeakened = true;
          fileFindings.push(
            `Remoção de asserções detectada: continha ${assertionsBefore} asserções e agora contém ${assertionsAfter} (redução de ${removedAssertionsCount}).`
          );
        }

        // 2. Check for newly introduced skipped tests
        const newSkipped = skippedAfter.filter(s => !skippedBefore.includes(s));
        if (newSkipped.length > 0) {
          isWeakened = true;
          fileFindings.push(
            `Testes ignorados ou desativados (.skip / xit / asserções comentadas): ${newSkipped.join('; ')}`
          );
        }

        // 3. Check for newly introduced trivial assertions
        const newTrivial = trivialAfter.filter(t => !trivialBefore.includes(t));
        if (newTrivial.length > 0) {
          isWeakened = true;
          fileFindings.push(
            `Asserções triviais ou tautológicas adicionadas para mascarar falhas: ${newTrivial.join('; ')}`
          );
        }

        // 4. Check that all original active assertion lines were preserved intact
        const beforeLines = this.extractAssertionLines(contentBefore);
        const afterLines = this.extractAssertionLines(contentAfter);
        let alteredOrRemovedOriginal = 0;
        for (const [lineText, countBefore] of beforeLines.entries()) {
          const countAfter = afterLines.get(lineText) || 0;
          if (countAfter < countBefore) {
            alteredOrRemovedOriginal += countBefore - countAfter;
          }
        }
        if (alteredOrRemovedOriginal > 0 && assertionsAfter >= assertionsBefore) {
          removedAssertionsCount = Math.max(removedAssertionsCount, alteredOrRemovedOriginal);
          isWeakened = true;
          fileFindings.push(
            `Adulteração de asserções originais detectada: ${alteredOrRemovedOriginal} asserção(ões) original(is) foram modificadas ou substituídas.`
          );
        }
      } else {
        // Newly created test file: reject if it contains skipped or trivial assertions
        if (skippedAfter.length > 0) {
          isWeakened = true;
          fileFindings.push(`Novo arquivo de teste criado já com testes desativados/skip: ${skippedAfter.join('; ')}`);
        }
        if (trivialAfter.length > 0) {
          isWeakened = true;
          fileFindings.push(`Novo arquivo de teste criado com asserções triviais: ${trivialAfter.join('; ')}`);
        }
      }

      if (isWeakened) {
        weakenedFiles.push(relFile);
        findings.push({
          file: relFile,
          assertionsBefore,
          assertionsAfter,
          removedAssertionsCount,
          skippedFound: skippedAfter,
          trivializedFound: trivialAfter,
          description: fileFindings.join(' | ')
        });
      }
    }

    const isWeakened = weakenedFiles.length > 0;
    return {
      isWeakened,
      weakenedFiles,
      findings,
      reason: isWeakened
        ? `Proteção de Critérios de Aceitação & Testes: Enfraquecimento indevido detectado em ${weakenedFiles.join(', ')}. Detalhes: ${findings.map(f => f.description).join('; ')}`
        : undefined
    };
  }

  /**
   * Phase 5: Dynamic Risk Assessment Matrix
   */
  static assessDynamicRisk(
    projectPath: string,
    filesChanged: string[],
    commandsExecuted: string[] = []
  ): DynamicRiskAssessment {
    const riskFactors: string[] = [];
    let isHighRisk = false;
    let isMediumRisk = false;

    // Check files
    for (const f of filesChanged) {
      const lower = f.toLowerCase();
      if (
        lower.includes('migration') ||
        lower.includes('schema') ||
        lower.includes('db.ts') ||
        lower.endsWith('.sqlite') ||
        lower.endsWith('.sql') ||
        lower.includes('.env') ||
        lower.includes('security') ||
        lower.includes('auth') ||
        lower === 'package.json' ||
        lower === 'package-lock.json' ||
        lower === 'tsconfig.json' ||
        lower.includes('docker')
      ) {
        isHighRisk = true;
        riskFactors.push(`Arquivo de infraestrutura/dados alterado: ${f}`);
      } else if (
        lower.includes('service') ||
        lower.includes('routes') ||
        lower.includes('engine') ||
        lower.includes('manager')
      ) {
        isMediumRisk = true;
        riskFactors.push(`Arquivo central de lógica de negócio: ${f}`);
      }
    }

    // Check commands and file contents
    const destructivePatterns = [/DROP\s+TABLE/i, /DELETE\s+FROM/i, /rm\s+-rf/i, /unlinkSync/i, /rmdir/i, /eval\(/i, /process\.exit/i];
    for (const cmd of commandsExecuted) {
      for (const pat of destructivePatterns) {
        if (pat.test(cmd)) {
          isHighRisk = true;
          riskFactors.push(`Comando de alta volatilidade detectado: ${cmd}`);
        }
      }
    }

    for (const f of filesChanged) {
      const full = path.isAbsolute(f) ? f : path.join(projectPath, f);
      if (fs.existsSync(full)) {
        try {
          if (fs.statSync(full).isFile()) {
            const content = fs.readFileSync(full, 'utf-8');
            for (const pat of destructivePatterns) {
              if (pat.test(content)) {
                isHighRisk = true;
                riskFactors.push(`Padrão destrutivo/crítico encontrado em ${f}: ${pat.source}`);
              }
            }
          }
        } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "independentEvaluator",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:independentEvaluator]", err);
      }
    }
      }
    }

    if (isHighRisk) {
      const irreversible = riskFactors.some(
        r => r.includes('.sql') || r.includes('migration') || r.includes('DROP') || r.includes('DELETE')
      );
      return {
        riskLevel: 'HIGH',
        reversibility: irreversible ? 'IRREVERSIBLE' : 'PARTIALLY_REVERSIBLE',
        blastRadius: 'SYSTEM',
        worstCaseScenario: 'Corrupção de esquema de dados, vazamento de credenciais ou indisponibilidade global do runtime',
        rollbackPlan: 'Executar rollback imediato via git revert HEAD, restaurar backup do SQLite e invalidar cache local',
        riskFactors
      };
    }

    if (isMediumRisk) {
      return {
        riskLevel: 'MEDIUM',
        reversibility: 'REVERSIBLE',
        blastRadius: 'MODULE',
        worstCaseScenario: 'Regressão em módulo funcional ou falha de integração entre serviços internos',
        rollbackPlan: 'Descartar alterações cirúrgicas do módulo via git checkout HEAD~1 -- <arquivos>',
        riskFactors
      };
    }

    return {
      riskLevel: 'LOW',
      reversibility: 'REVERSIBLE',
      blastRadius: 'LOCAL',
      worstCaseScenario: 'Falha isolada em componente folha ou erro em teste unitário específico',
      rollbackPlan: 'Reverter arquivo específico cirurgicamente',
      riskFactors: riskFactors.length > 0 ? riskFactors : ['Alteração localizada de baixo impacto']
    };
  }

  /**
   * Phase 6: Adversarial Validation
   * Detects whether test suites verify edge cases, invalid inputs (BANANA, NaN, null), injections and error handling.
   */
  static validateAdversarialResilience(
    projectPath: string,
    filesChanged: string[],
    criteria: string[] = []
  ): AdversarialValidationResult {
    const findings: AdversarialFinding[] = [];
    let hasTestFiles = false;
    let foundAdversarialInputs = false;
    let foundErrorAssertions = false;

    // Look for test files among filesChanged, or scan test directory
    const testFiles: string[] = [];
    for (const f of filesChanged) {
      if (/\.(test|spec)\.(js|cjs|mjs|ts|jsx|tsx)$/i.test(f)) {
        testFiles.push(f);
      }
    }

    if (testFiles.length === 0 && fs.existsSync(projectPath)) {
      const scanTests = (dir: string, depth = 0) => {
        if (depth > 2) return;
        try {
          for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
            if (ent.name === 'node_modules' || ent.name === '.git' || ent.name === '.ai-dev-hub' || ent.name === '.agents') continue;
            const full = path.join(dir, ent.name);
            if (ent.isDirectory()) {
              scanTests(full, depth + 1);
            } else if (/\.(test|spec)\.(js|cjs|mjs|ts|jsx|tsx)$/i.test(ent.name)) {
              testFiles.push(path.relative(projectPath, full).replace(/\\/g, '/'));
            }
          }
        } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "independentEvaluator",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:independentEvaluator]", err);
      }
    }
      };
      scanTests(projectPath, 0);
    }

    const negativeInputPatterns = [
      /['"](BANANA|INVALID|UNKNOWN|MALFORMED|TEST_INVALID)['"]/i,
      /\b(NaN|null|undefined)\b/,
      /['"]\s*['"]/, // empty string or whitespace
      /-\d+/, // negative numbers
      /Infinity/,
      /<script[\s\S]*?>/i,
      /;\s*DROP\s+TABLE/i,
      /\.\.\// // path traversal
    ];

    const errorAssertionPatterns = [
      /\b(toThrow|rejects|assert\.throws|throws|toThrowError)\b/,
      /\b(status\((400|422|404|500)\)|statusCode\s*===?\s*(400|422|404|500))\b/,
      /\b(try\s*\{[\s\S]*?\}\s*catch\s*\()/
    ];

    for (const tf of testFiles) {
      hasTestFiles = true;
      const full = path.isAbsolute(tf) ? tf : path.join(projectPath, tf);
      if (!fs.existsSync(full)) continue;
      try {
        const content = fs.readFileSync(full, 'utf-8');
        const hasNeg = negativeInputPatterns.some(p => p.test(content));
        const hasErr = errorAssertionPatterns.some(p => p.test(content));

        if (hasNeg && hasErr) {
          foundAdversarialInputs = true;
          foundErrorAssertions = true;
        } else if (!hasNeg) {
          findings.push({
            testFile: tf,
            category: 'MISSING_NEGATIVE_TESTS',
            description: `Arquivo ${tf} testa apenas caminhos felizes (happy path). Faltam entradas negativas/anômalas (ex: 'BANANA', NaN, strings vazias ou nulos).`
          });
        } else if (!hasErr) {
          findings.push({
            testFile: tf,
            category: 'MISSING_EDGE_CASES',
            description: `Arquivo ${tf} inclui entradas anômalas mas não verifica asserções explícitas de erro (assert.throws/toThrow/status de erro).`
          });
        }
      } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "independentEvaluator",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:independentEvaluator]", err);
      }
    }
    }

    const adversarialCovered = foundAdversarialInputs && foundErrorAssertions;
    const criteriaRequiresAdversarial = criteria.some(c =>
      /adversarial|resili[eê]ncia|entradas inv[aá]lidas|erros?|limite|borda/i.test(c)
    );

    let passed = true;
    let score = 8;

    if (!hasTestFiles) {
      score = 5;
      passed = true;
    } else if (adversarialCovered) {
      score = 10;
      passed = true;
    } else {
      score = criteriaRequiresAdversarial ? 4 : 6;
      passed = !criteriaRequiresAdversarial;
    }

    return {
      passed,
      score,
      adversarialCovered,
      findings,
      details: adversarialCovered
        ? 'Validação Adversarial PASS: Testes cobrem cenários negativos, entradas inválidas e tratamento robusto de erros.'
        : hasTestFiles
          ? `Validação Adversarial PARCIAL: ${findings.length} achado(s) de teste superficial/happy-path.`
          : 'Nenhum arquivo de teste para validação adversarial.'
    };
  }

  /**
   * Phase 7: Anti-Slop / Anti-Superficiality Detection
   * Detects empty placeholders, dummy mocks in production code, unchanged core claims and tautological assertions.
   */
  static detectAntiSlop(
    projectPath: string,
    filesChanged: string[]
  ): AntiSlopAnalysis {
    const findings: AntiSlopFinding[] = [];

    for (const f of filesChanged) {
      const full = path.isAbsolute(f) ? f : path.join(projectPath, f);
      if (!fs.existsSync(full) || !fs.statSync(full).isFile()) continue;

      const rel = path.relative(projectPath, full).replace(/\\/g, '/');
      const isTestFile = /\.(test|spec)\.[cm]?[jt]sx?$/i.test(rel) || rel.includes('test/') || rel.includes('tests/');

      // Ignore compiled build artifacts, governance folders, type definitions and source maps
      if (
        /^(dist|build|out|\.next|\.ai-dev-hub|\.agents|\.playwright-cli|node_modules)\//i.test(rel) ||
        /\.(d\.ts|map)$/i.test(rel)
      ) {
        continue;
      }

      try {
        const content = fs.readFileSync(full, 'utf-8');
        const trimmed = content.trim();

        // 1. Empty Placeholder check
        const commentOnlyRegex = /^(\s*(\/\/.*|\/\*[\s\S]*?\*\/)\s*)*$/;
        if (trimmed.length < 20 || commentOnlyRegex.test(trimmed)) {
          if (trimmed === 'export {};') continue;
          findings.push({
            file: rel,
            type: 'EMPTY_PLACEHOLDER',
            details: `Arquivo ${rel} é vazio ou contém apenas comentários/TODOs sem implementação funcional.`
          });
          continue;
        }

        // 2. Production Mock check (dummy implementations inside production code)
        if (!isTestFile) {
          const mockIndicators = [
            /\/\/\s*(TODO\s*:?\s*)?mock\s+implementation/i,
            /return\s*\{\s*\}\s*;\s*\/\/\s*mock/i,
            /const\s+mock[A-Z0-9_]+\s*=/i,
            /\bfake(Implementation|Data|Response|Users|Records)\b/i,
            /\bdummy(Data|Value|Response)\b/i
          ];

          for (const m of mockIndicators) {
            if (m.test(content)) {
              findings.push({
                file: rel,
                type: 'PRODUCTION_MOCK',
                details: `Simulação/mock vazio detectado em código de produção em ${rel}: ${m.source}`
              });
              break;
            }
          }
        }

        // 3. Tautological assertions in test files
        if (isTestFile) {
          const tautologicalPatterns = [
            /assert\.ok\(\s*true\s*\)/i,
            /expect\(\s*true\s*\)\.to(Be|Equal)\(\s*true\s*\)/i,
            /expect\(\s*1\s*\)\.to(Be|Equal)\(\s*1\s*\)/i,
            /assert\.(strictEqual|equal)\(\s*1\s*,\s*1\s*\)/i,
            /assert\.(strictEqual|equal)\(\s*['"]a['"]\s*,\s*['"]a['"]\s*\)/i
          ];

          for (const tp of tautologicalPatterns) {
            if (tp.test(content)) {
              findings.push({
                file: rel,
                type: 'TAUTOLOGICAL_ASSERTION',
                details: `Asserção tautológica/trivial encontrada no teste ${rel}: ${tp.source}`
              });
              break;
            }
          }
        }
      } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "independentEvaluator",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:independentEvaluator]", err);
      }
    }
    }

    const hasSlop = findings.length > 0;
    return {
      hasSlop,
      findings,
      reason: hasSlop
        ? `Anti-Slop Guard: Código superficial ou simulado detectado em ${findings.map(f => `${f.file} (${f.type})`).join('; ')}`
        : undefined
    };
  }

  /**
   * Validates if a project has visual UI assets (HTML, web templates, or routes serving HTML)
   */
  static validateVisualAcceptance(projectPath: string): { hasVisualUi: boolean; details: string; matchedFiles: string[] } {
    if (!fs.existsSync(projectPath)) {
      return { hasVisualUi: false, details: 'Diretório do projeto não existe', matchedFiles: [] };
    }

    const matchedFiles: string[] = [];

    // Helper recursive search (up to depth 3, skipping node_modules, .git, .ai-dev-hub)
    const scanDir = (dir: string, depth = 0) => {
      if (depth > 3) return;
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (['node_modules', '.git', '.ai-dev-hub', '.agents', '.playwright-cli'].includes(entry.name)) continue;
          const fullPath = path.join(dir, entry.name);
          const relPath = path.relative(projectPath, fullPath).replace(/\\/g, '/');

          if (entry.isDirectory()) {
            scanDir(fullPath, depth + 1);
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            // 1. Direct HTML files
            if (ext === '.html') {
              try {
                const content = fs.readFileSync(fullPath, 'utf-8');
                if (
                  content.length > 50 &&
                  (content.includes('<body') ||
                    content.includes('<div') ||
                    content.includes('<html') ||
                    content.includes('<!DOCTYPE html>'))
                ) {
                  matchedFiles.push(relPath);
                }
              } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "independentEvaluator",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:independentEvaluator]", err);
      }
    }
            }
            // 2. React / Vue / Svelte frontend components
            else if (['.jsx', '.tsx', '.vue', '.svelte'].includes(ext)) {
              matchedFiles.push(relPath);
            }
            // 3. Server or frontend JS/TS files that serve/render HTML strings
            else if (['.js', '.cjs', '.mjs', '.ts'].includes(ext)) {
              try {
                const content = fs.readFileSync(fullPath, 'utf-8');
                if (
                  (content.includes('<!DOCTYPE html>') ||
                    content.includes('<html') ||
                    content.includes('<div id="app"')) &&
                  (content.includes('res.send(') ||
                    content.includes('res.end(') ||
                    content.includes('innerHTML') ||
                    content.includes('document.'))
                ) {
                  matchedFiles.push(relPath);
                }
              } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "independentEvaluator",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:independentEvaluator]", err);
      }
    }
            }
          }
        }
      } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "independentEvaluator",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:independentEvaluator]", err);
      }
    }
    };

    scanDir(projectPath, 0);

    const hasVisualUi = matchedFiles.length > 0;
    return {
      hasVisualUi,
      details: hasVisualUi
        ? `Artefatos visuais identificados (${matchedFiles.length} arquivo(s)): ${matchedFiles.slice(0, 5).join(', ')}`
        : 'Nenhum artefato visual (HTML, componente de interface web ou rota servindo UI) foi encontrado no projeto.',
      matchedFiles
    };
  }

  /**
   * Validates if project code or tests implement persistent storage (files, sqlite, db)
   */
  static validatePersistenceAcceptance(projectPath: string): { hasPersistence: boolean; details: string; matchedFiles: string[] } {
    if (!fs.existsSync(projectPath)) {
      return { hasPersistence: false, details: 'Diretório do projeto não existe', matchedFiles: [] };
    }

    const matchedFiles: string[] = [];

    const scanDir = (dir: string, depth = 0) => {
      if (depth > 3) return;
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (['node_modules', '.git', '.ai-dev-hub', '.agents', '.playwright-cli'].includes(entry.name)) continue;
          const fullPath = path.join(dir, entry.name);
          const relPath = path.relative(projectPath, fullPath).replace(/\\/g, '/');

          if (entry.isDirectory()) {
            scanDir(fullPath, depth + 1);
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (
              ['.sqlite', '.db', '.sqlite3'].includes(ext) ||
              (ext === '.json' && !['package.json', 'package-lock.json', 'tsconfig.json'].includes(entry.name))
            ) {
              matchedFiles.push(relPath);
            } else if (['.js', '.cjs', '.mjs', '.ts'].includes(ext)) {
              try {
                const content = fs.readFileSync(fullPath, 'utf-8');
                if (
                  content.includes('writeFileSync') ||
                  content.includes('writeFile') ||
                  content.includes('sqlite') ||
                  content.includes('localStorage') ||
                  content.includes('indexedDB')
                ) {
                  matchedFiles.push(relPath);
                }
              } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "independentEvaluator",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:independentEvaluator]", err);
      }
    }
            }
          }
        }
      } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "independentEvaluator",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:independentEvaluator]", err);
      }
    }
    };

    scanDir(projectPath, 0);

    const hasPersistence = matchedFiles.length > 0;
    return {
      hasPersistence,
      details: hasPersistence
        ? `Mecanismos ou dados persistentes identificados (${matchedFiles.length} referência(s)): ${matchedFiles.slice(0, 5).join(', ')}`
        : 'Nenhum mecanismo de persistência em disco ou banco de dados foi encontrado no projeto.',
      matchedFiles
    };
  }

  /**
   * Validates frontend design quality: anti-slop check for emojis used as icons,
   * missing design tokens in :root, and unstyled raw native controls.
   */
  static validateFrontendDesignQuality(
    projectPath: string,
    filesChanged: string[] = [],
    taskObjective?: string
  ): FrontendDesignQualityResult {
    const findings: FrontendDesignQualityFinding[] = [];
    const frontendExts = ['.html', '.css', '.jsx', '.tsx', '.vue', '.svelte'];
    const candidates = new Set<string>();

    for (const f of filesChanged) {
      const ext = path.extname(f).toLowerCase();
      if (frontendExts.includes(ext) || (ext === '.js' && /(public|client|views|ui)/i.test(f))) {
        candidates.add(f);
      }
    }

    const isUiTask = Boolean(
      taskObjective &&
        /frontend|front-end|\bui\b|interface|layout|tela|dashboard|component|page|view|estilo|css|html/i.test(taskObjective)
    );
    if (candidates.size === 0 && !isUiTask) {
      return {
        passed: true,
        score: 100,
        findings: [],
        details: 'Nenhuma alteração de interface de usuário no escopo avaliado.'
      };
    }

    if (candidates.size === 0) {
      const publicDir = path.join(projectPath, 'public');
      if (fs.existsSync(publicDir)) {
        try {
          const files = fs.readdirSync(publicDir, { withFileTypes: true });
          for (const entry of files) {
            if (entry.isFile()) {
              candidates.add(path.join('public', entry.name));
            } else if (entry.isDirectory()) {
              for (const sub of fs.readdirSync(path.join(publicDir, entry.name))) {
                candidates.add(path.join('public', entry.name, sub));
              }
            }
          }
        } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "independentEvaluator",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:independentEvaluator]", err);
      }
    }
      }
    }

    let inspectedHtmlOrJs = 0;
    let inspectedCss = 0;
    let hasRootTokens = false;
    let hasCustomScrollbar = false;

    // Emojis commonly misused as icons in UI navigation, buttons, titles, cards
    const emojiIconRegex =
      /(<button[^>]*>[^<]*|[<](?:span|h[1-6]|a|div|li|th|td)[^>]*class=["'][^"']*(?:icon|badge|nav|item|title|btn)[^"']*["'][^>]*>)[^<]*[⚡⭐📋🏆🎯💡🔥✨🚀📌✅❌➕🗑️✏️⚙️📊📅🕒📁🔍🔔👤🛠️]/i;
    const bareEmojiInControlRegex =
      /<(?:button|h[1-6]|summary)[^>]*>[^<]*[⚡⭐📋🏆🎯💡🔥✨🚀📌✅❌➕🗑️✏️⚙️📊📅🕒📁🔍🔔👤🛠️]/i;

    for (const rel of candidates) {
      const full = path.isAbsolute(rel) ? rel : path.join(projectPath, rel);
      if (!fs.existsSync(full) || !fs.statSync(full).isFile()) continue;

      const ext = path.extname(full).toLowerCase();
      try {
        const content = fs.readFileSync(full, 'utf-8');

        if (['.html', '.jsx', '.tsx', '.vue', '.svelte'].includes(ext) || (ext === '.js' && /(public|ui|views)/i.test(rel))) {
          inspectedHtmlOrJs++;
          if (emojiIconRegex.test(content) || bareEmojiInControlRegex.test(content)) {
            findings.push({
              file: rel,
              type: 'EMOJI_ICON_PROLIFERATION',
              details: `Uso de emojis de sistema como ícones em ${rel}. Substitua por ícones SVG limpos (Lucide ou inline SVG com stroke-width 1.5-2px).`
            });
          }
          // Check inline <style> blocks inside HTML files for tokens/scrollbars as well
          if (ext === '.html' && /<style[\s\S]*?>/i.test(content)) {
            if (/:root\s*\{[^}]*--(?:bg|surface|accent|border|primary|color|text)/i.test(content)) {
              hasRootTokens = true;
            }
            if (/::-webkit-scrollbar|scrollbar-width/i.test(content)) {
              hasCustomScrollbar = true;
            }
          }
        }

        if (ext === '.css') {
          inspectedCss++;
          if (/:root\s*\{[^}]*--(?:bg|surface|accent|border|primary|color|text)/i.test(content)) {
            hasRootTokens = true;
          }
          if (/::-webkit-scrollbar|scrollbar-width/i.test(content)) {
            hasCustomScrollbar = true;
          }
        }
      } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "independentEvaluator",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:independentEvaluator]", err);
      }
    }
    }

    // If a modified CSS file did not contain :root or scrollbar directly, check sibling CSS files in public/
    if (inspectedCss > 0 && (!hasRootTokens || !hasCustomScrollbar)) {
      const publicDir = path.join(projectPath, 'public');
      if (fs.existsSync(publicDir)) {
        try {
          for (const entry of fs.readdirSync(publicDir, { withFileTypes: true })) {
            if (entry.isFile() && entry.name.toLowerCase().endsWith('.css')) {
              const cssText = fs.readFileSync(path.join(publicDir, entry.name), 'utf-8');
              if (/:root\s*\{[^}]*--(?:bg|surface|accent|border|primary|color|text)/i.test(cssText)) {
                hasRootTokens = true;
              }
              if (/::-webkit-scrollbar|scrollbar-width/i.test(cssText)) {
                hasCustomScrollbar = true;
              }
            }
          }
        } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "independentEvaluator",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:independentEvaluator]", err);
      }
    }
      }
    }

    if (inspectedCss > 0 && !hasRootTokens) {
      findings.push({
        file: 'css',
        type: 'MISSING_DESIGN_TOKENS',
        details:
          'Ausência de variáveis CSS semânticas em :root (--bg, --surface, --accent, --border, etc.). Defina os tokens de design no :root.'
      });
    }

    if (inspectedHtmlOrJs > 0 && inspectedCss > 0 && !hasCustomScrollbar) {
      findings.push({
        file: 'css',
        type: 'RAW_UNSTYLED_CONTROLS',
        details:
          'Controles nativos ou scrollbar do Windows não estilizados. Adicione scrollbar customizada (::-webkit-scrollbar { width: 6px }).'
      });
    }

    // Gate Anti-JSON na Raiz: se o projeto possui interface web (public/index.html ou HTML estático),
    // arquivos de servidor (src/server.*, src/index.*, src/app.*) NÃO PODEM interceptar req.url === '/' retornando JSON.
    const hasPublicIndexHtml =
      fs.existsSync(path.join(projectPath, 'public', 'index.html')) ||
      fs.existsSync(path.join(projectPath, 'index.html'));
    if (hasPublicIndexHtml) {
      const serverFileCandidates = [
        path.join(projectPath, 'src', 'server.js'),
        path.join(projectPath, 'src', 'server.ts'),
        path.join(projectPath, 'src', 'index.js'),
        path.join(projectPath, 'src', 'index.ts'),
        path.join(projectPath, 'src', 'app.js'),
        path.join(projectPath, 'src', 'app.ts'),
        path.join(projectPath, 'server.js'),
        path.join(projectPath, 'server.ts'),
        path.join(projectPath, 'index.js'),
        path.join(projectPath, 'index.ts'),
        path.join(projectPath, 'app.js'),
        path.join(projectPath, 'app.ts')
      ];

      for (const sFile of serverFileCandidates) {
        if (fs.existsSync(sFile) && fs.statSync(sFile).isFile()) {
          try {
            const sContent = fs.readFileSync(sFile, 'utf-8');
            const hasExplicitRootExpressJson =
              /(?:app|router)\.get\(\s*['"]\/['"]\s*,(?:(?!\b(?:app|router)\.(?:get|post|put|delete|use)\b)[\s\S]){0,1000}?res\.(?:json|send)\s*\(/i.test(
                sContent
              );
            const hasExplicitRootIfJson =
              /if\s*\(\s*(?:req\.url|pathname)\s*===\s*['"]\/['"][^)]*\)\s*\{[^}]*res\.(?:json|writeHead\([^)]*json[^)]*\)|end\(JSON\.stringify)/i.test(
                sContent
              ) ||
              /if\s*\(\s*(?:req\.url|pathname)\s*===\s*['"]\/['"][^)]*\)\s*\{[^}]*(?:'application\/json'|"application\/json")/i.test(
                sContent
              );
            const hasExplicitRootJson = hasExplicitRootExpressJson || hasExplicitRootIfJson;

            const hasHijackingCatchAllJson =
              /res\.writeHead\(\s*200\s*,\s*\{\s*['"]Content-Type['"]\s*:\s*['"]application\/json['"]\s*\}\s*\);\s*res\.end\(\s*JSON\.stringify/i.test(
                sContent
              ) &&
              !sContent.includes('public') &&
              !sContent.includes('index.html') &&
              !sContent.includes('serveStatic');

            if (hasExplicitRootJson || hasHijackingCatchAllJson) {
              const relServerFile = path.relative(projectPath, sFile).replace(/\\/g, '/');
              findings.push({
                file: relServerFile,
                type: 'ROOT_ROUTE_HIJACKED_BY_JSON',
                details: `A rota raiz GET / está configurada para retornar JSON da API em ${relServerFile} em vez de servir public/index.html. Mova o healthcheck JSON para GET /api/health e sirva public/index.html em GET /.`
              });
              break;
            }
          } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "independentEvaluator",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:independentEvaluator]", err);
      }
    }
        }
      }
    }

    // Gate Anti-Colisão de Porta (PORT_GUARD): as portas 3001, 3000 e 5173 são reservadas ao DecoHUB.
    IndependentEvaluator.normalizePortGuard(projectPath);

    // Gate SaaS Master Complexity (quando for tarefa SaaS Master ou projeto SaaS)
    const isSaaSMasterTask = Boolean(
      taskObjective && /saas\s*master|enterprise\s*spa|rea\s*blueprint|saas\s*complexo/i.test(taskObjective)
    );
    if (isSaaSMasterTask) {
      const saasCheck = IndependentEvaluator.validateSaaSMasterComplexity(projectPath, { taskObjective });
      if (!saasCheck.passed) {
        findings.push(...saasCheck.findings);
      }
    }

    const passed = findings.length === 0;
    const score = Math.max(0, 100 - findings.length * 30);
    const details = passed
      ? 'Aprovado pelo Anti-Slop Visual Gate: Design limpo com SVG icons, tokens semânticos e acabamento profissional.'
      : `Anti-Slop Visual Gate: ${findings.map(f => `${f.type} (${f.details})`).join('; ')}`;

    return {
      passed,
      score,
      findings,
      details
    };
  }

  /**
   * Validação de Densidade Funcional SaaS Master (morluto/rea):
   * Verifica se a SPA possui os componentes canônicos de uma interface corporativa líder:
   * 1. App Shell com Sidebar e Busca / Command Palette (Ctrl+K);
   * 2. Slide-Over Detail Drawer ou Modal Rico de detalhes;
   * 3. Data Grid com busca, filtros compostos e exportação CSV;
   * 4. Dashboard Analítico / BI com KPIs (Δ%) e gráficos SVG/Canvas;
   * 5. Reactive Store e Audit Trail / Atividades.
   *
   * Detecta e rejeita interfaces "rasas" (CRUD vazio sem filtros/drawers/métricas).
   */
  static validateSaaSMasterComplexity(
    projectPath: string,
    options?: {
      taskObjective?: string;
      htmlContent?: string;
      jsContent?: string;
      filesChanged?: string[];
    }
  ): SaaSMasterComplexityResult {
    const findings: FrontendDesignQualityFinding[] = [];

    let html = options?.htmlContent || '';
    let js = options?.jsContent || '';

    if (!html || !js) {
      const candidates = [
        path.join(projectPath, 'public', 'index.html'),
        path.join(projectPath, 'index.html'),
        path.join(projectPath, 'public', 'app.js'),
        path.join(projectPath, 'public', 'main.js'),
        path.join(projectPath, 'public', 'js', 'app.js'),
        path.join(projectPath, 'src', 'ui', 'App.tsx'),
        path.join(projectPath, 'src', 'App.tsx')
      ];
      for (const c of candidates) {
        if (fs.existsSync(c)) {
          try {
            const content = fs.readFileSync(c, 'utf-8');
            if (c.endsWith('.html') && !html) html = content;
            if ((c.endsWith('.js') || c.endsWith('.ts') || c.endsWith('.tsx')) && !js) js += '\n' + content;
          } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "independentEvaluator",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:independentEvaluator]", err);
      }
    }
        }
      }
    }

    const combined = `${html}\n${js}`.toLowerCase();

    // 1. Shell & Busca / Command Palette (Ctrl+K)
    const hasShellOrSearch = /(sidebar|topbar|command-palette|commandpalette|ctrl\+k|cmd\+k|search-input|global-search)/i.test(
      combined
    );

    // 2. Slide-Over Detail Drawer ou modal rico de detalhe
    const hasDetailDrawer = /(drawer|slide-over|slideover|detail-drawer|detaildrawer|side-panel|opendrawer|drawer-content)/i.test(
      combined
    );

    // 3. Data Grid com Busca/Filtros/Export CSV
    const hasDataGridControls = /(debounce|filter|export-csv|downloadcsv|exportcsv|sortable|grid-controls|table-filter)/i.test(
      combined
    );

    // 4. BI Analytics / KPIs / Gráficos SVG/Canvas
    const hasAnalyticsOrKpis = /(svg|canvas|kpi|metric|chart|variação|variacao|percentual|trend|sparkline|tooltips?)/i.test(
      combined
    );

    // 5. Reactive Store / Audit Trail
    const hasReactiveStoreOrAudit = /(store|dispatch|subscribe|audit|activity|timeline|audit_logs|\/api\/audit-logs)/i.test(
      combined
    );

    let featuresDetected = 0;
    if (hasShellOrSearch) featuresDetected++;
    if (hasDetailDrawer) featuresDetected++;
    if (hasDataGridControls) featuresDetected++;
    if (hasAnalyticsOrKpis) featuresDetected++;
    if (hasReactiveStoreOrAudit) featuresDetected++;

    const isShallow = featuresDetected < 3 || (!hasDetailDrawer && !hasDataGridControls && !hasAnalyticsOrKpis);

    if (isShallow) {
      const missing: string[] = [];
      if (!hasShellOrSearch) missing.push('App Shell com Busca / Command Palette (Ctrl+K)');
      if (!hasDetailDrawer) missing.push('Slide-Over Detail Drawer para inspeção de itens');
      if (!hasDataGridControls) missing.push('Data Grid com filtros, busca debounce e exportação CSV');
      if (!hasAnalyticsOrKpis) missing.push('Painel BI com KPIs (Δ%) e gráficos SVG/Canvas');
      if (!hasReactiveStoreOrAudit) missing.push('Reactive Client Store ou Audit Trail');

      findings.push({
        file: 'public/index.html',
        type: 'SHALLOW_SAAS_INTERFACE',
        details: `Interface com densidade insuficiente (${featuresDetected}/5 pilares detectados). Ausentes: ${missing.join(', ')}. Diretriz SaaS Master (REA) exige interfaces densas nível Enterprise.`
      });
    }

    const passed = findings.length === 0;
    const score = Math.max(0, 100 - findings.length * 40);
    const details = passed
      ? `Aprovado pelo SaaS Master Quality Gate (REA): ${featuresDetected}/5 pilares enterprise identificados (App Shell, Data Grid, Drawer e BI Analytics).`
      : `Rejeitado pelo SaaS Master Quality Gate (REA): ${findings.map(f => f.details).join('; ')}`;

    return {
      passed,
      score,
      findings,
      details,
      metrics: {
        hasShellOrSearch,
        hasDetailDrawer,
        hasDataGridControls,
        hasAnalyticsOrKpis,
        hasReactiveStoreOrAudit,
        totalFeaturesDetected: featuresDetected
      }
    };
  }

  /**
   * Gate Anti-Colisão de Porta (PORT_GUARD): as portas 3001, 3000 e 5173 são reservadas ao DecoHUB.
   * Se arquivos de servidor ou .env.example usarem 3001/3000/5173 como padrão de fallback, auto-normaliza para 4000.
   */
  static normalizePortGuard(projectPath: string): number {
    let normalizedCount = 0;
    const portFilesToCheck = [
      path.join(projectPath, 'src', 'server.js'),
      path.join(projectPath, 'src', 'server.ts'),
      path.join(projectPath, 'src', 'index.js'),
      path.join(projectPath, 'src', 'index.ts'),
      path.join(projectPath, 'src', 'app.js'),
      path.join(projectPath, 'src', 'app.ts'),
      path.join(projectPath, 'src', 'config', 'env.js'),
      path.join(projectPath, 'src', 'config', 'env.ts'),
      path.join(projectPath, 'server.js'),
      path.join(projectPath, 'server.ts'),
      path.join(projectPath, 'index.js'),
      path.join(projectPath, 'index.ts'),
      path.join(projectPath, 'app.js'),
      path.join(projectPath, 'app.ts'),
      path.join(projectPath, '.env.example'),
      path.join(projectPath, '.env')
    ];

    const reservedPortRegex =
      /(?:PORT\s*=\s*(?:3001|3000|5173)\b|PORT\s*\|\|\s*(?:3001|3000|5173)\b|port\s*=\s*(?:3001|3000|5173)\b|Number\(source\.PORT\)\s*\|\|\s*(?:3001|3000|5173)\b|Number\(process\.env\.PORT\)\s*\|\|\s*(?:3001|3000|5173)\b)/i;

    for (const pFile of portFilesToCheck) {
      if (fs.existsSync(pFile) && fs.statSync(pFile).isFile()) {
        try {
          const content = fs.readFileSync(pFile, 'utf-8');
          if (reservedPortRegex.test(content)) {
            const relFile = path.relative(projectPath, pFile).replace(/\\/g, '/');
            Logger.warn(
              `[PORT_GUARD] [IndependentEvaluator] Porta reservada (3001/3000/5173) detectada em ${relFile}. Auto-normalizando para 4000...`
            );
            const normalized = content
              .replace(/(PORT\s*=\s*)(?:3001|3000|5173)\b/g, '$14000')
              .replace(/(PORT\s*\|\|\s*)(?:3001|3000|5173)\b/g, '$14000')
              .replace(/(port\s*=\s*)(?:3001|3000|5173)\b/g, '$14000')
              .replace(/(Number\(source\.PORT\)\s*\|\|\s*)(?:3001|3000|5173)\b/g, '$14000')
              .replace(/(Number\(process\.env\.PORT\)\s*\|\|\s*)(?:3001|3000|5173)\b/g, '$14000');
            fs.writeFileSync(pFile, normalized, 'utf-8');
            normalizedCount++;
          }
        } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "independentEvaluator",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:independentEvaluator]", err);
      }
    }
      }
    }
    return normalizedCount;
  }

  /**
   * Independent Evaluator evaluates the implementation objectively
   */
  static async evaluate(
    contractId: string,
    projectPath: string,
    builderReport: {
      status: 'success' | 'failure';
      filesChanged: string[];
      implemented?: string[];
      rawResponse?: string;
      tests?: {
        command?: string;
        passed?: boolean;
        exitCode?: number;
        output?: string;
      };
      recommendation?: string;
      knownProblems?: string[];
      problems?: any[];
      decisions?: any[];
      finalResponse?: string;
    },
    options?: {
      expectedScopeFiles?: string[];
      effortLevel?: 'MINIMAL' | 'STANDARD' | 'DEEP';
      taskMode?: 'IMPLEMENT' | 'REPAIR' | 'RESEARCH' | 'AUDIT' | 'TEST';
      forceLiveBrowser?: boolean;
    }
  ): Promise<EvaluationResult> {
    const contract = this.getContract(contractId);
    if (!contract) {
      throw new Error(`SuccessContract #${contractId} não encontrado no banco de dados`);
    }

    const nowIso = new Date().toISOString();
    const startTime = Date.now();
    ObservabilityService.emit({
      level: 'INFO',
      event: 'evaluation.started',
      message: `Iniciando avaliação independente da tarefa "${contract.objective}"`,
      service: 'evaluator',
      runId: contract.runId,
      taskId: contract.taskId,
      metadata: { contractId, projectPath }
    });
    Logger.info(`[IndependentEvaluator] Iniciando avaliação independente da tarefa "${contract.objective}"...`);

    // Principle 3: Evidence-First Engineering
    // An agent claim of success is NEVER sufficient without verifiable proof.
    const hasFilesChanged = builderReport.filesChanged && builderReport.filesChanged.length > 0;
    const agentTestsPassed = Boolean(builderReport.tests && builderReport.tests.passed && builderReport.tests.exitCode === 0);

    const contractText = `${contract.objective} ${(contract.acceptanceCriteria || []).join(' ')}`.toLowerCase();
    const isInitialMilestoneTask = Boolean(
      /(?:m1|mvp\s*setup|funda[çc][aã]o|setup\s*inicial|configura[çc][aã]o\s*inicial|estrutura\s*b[aá]sica|initial\s*setup|foundation|project\s*setup|scaffold|scaffolding|bootstrap)/i.test(
        contractText
      ) ||
      (contract.acceptanceCriteria && contract.acceptanceCriteria.some(c =>
        /(?:setup\s*inicial|criar\s*estrutura|funda[çc][aã]o|bootstrap)/i.test(c)
      )) ||
      Boolean(contract.taskId && /(?:setup|foundation|m1)/i.test(contract.taskId))
    );
    const isAuditOrInvestigationTask = Boolean(
      options?.taskMode === 'AUDIT' ||
        options?.taskMode === 'RESEARCH' ||
        (/(auditar|auditoria|inspecionar|inspe[çc][aã]o|investigar|investiga[çc][aã]o|diagn[oó]stico|diagnosticar|avaliar|levantamento|an[aá]lise|analisar|relat[oó]rio|pesquisa|pesquisar|research)/i.test(
          contractText
        ) &&
          !/(implementar|criar|codificar|desenvolver|refatorar|corrigir|fix|adicionar c[oó]digo)/i.test(contractText))
    );

    // Audit tasks provide value via substantive findings/reports rather than file modifications
    const hasSubstantiveAuditFindings =
      isAuditOrInvestigationTask &&
      Boolean(
        (builderReport.implemented &&
          builderReport.implemented.length > 0 &&
          builderReport.implemented.some((i: string) => i.length > 15)) ||
          (builderReport.recommendation && builderReport.recommendation.length > 30) ||
          (builderReport.knownProblems && builderReport.knownProblems.length > 0) ||
          (builderReport.finalResponse && builderReport.finalResponse.length > 50) ||
          (builderReport.rawResponse && builderReport.rawResponse.length > 50)
      );

    if (builderReport.status === 'success' && !hasFilesChanged && !agentTestsPassed && !hasSubstantiveAuditFindings) {
      Logger.warn(
        `[IndependentEvaluator] UNVERIFIED_CLAIM: O agente declarou sucesso sem apresentar evidências factuais (0 arquivos, sem testes e sem relatório substantivo de auditoria).`
      );

      const evalResult: EvaluationResult = {
        id: crypto.randomUUID(),
        contractId: contract.id,
        taskId: contract.taskId,
        runId: contract.runId,
        verdict: 'FAIL',
        builderStatus: 'COMPLETED',
        evaluatorVerdict: 'FAIL',
        taskIsDone: false,
        passedCriteria: [],
        failedCriteria: [
          'UNVERIFIED_CLAIM: Apresentar evidências factuais de implementação (código alterado ou testes passando)'
        ],
        evidence: {
          output:
            'UNVERIFIED_CLAIM: O agente declarou conclusão sem apresentar evidências factuais (sem arquivos modificados, sem diff e sem testes executados).',
          evidenceSummary: {
            codeDiffAvailable: false,
            filesChangedCount: 0,
            independentCommandExecuted: false,
            independentCommandExitCode: 422,
            requirementsVerifiedCount: 0,
            adversarialChecksPassed: false,
            antiSlopPassed: false,
            groundTruthVerified: false,
            effortLevel: options?.effortLevel || 'STANDARD'
          }
        },
        expected: 'Código real alterado ou comandos executados com sucesso',
        actual: 'Afirmação sem evidências comprobatórias (Unverified Claim)',
        evaluatorNotes:
          'REJEITADO (Evidence-First): Nenhuma afirmação do Worker é prova suficiente de conclusão sem evidências factuais.',
        evaluatorName: this.evaluatorName,
        executedCommands: [],
        exitCode: 422,
        durationMs: Date.now() - startTime,
        createdAt: nowIso
      };

      this.persistEvaluationResult(evalResult, contract);
      return evalResult;
    }

    // Scope check: evaluate if changes adhered to expected scope files
    const scopeValidation = validateSurgicalDiff(builderReport.filesChanged || [], options?.expectedScopeFiles || []);

    // Gate Anti-Colisão de Porta (PORT_GUARD): as portas 3001/3000/5173 são reservadas ao DecoHUB.
    IndependentEvaluator.normalizePortGuard(projectPath);

    // 1. Tampering check (Proteção estrita de testes)
    const tamperingCheck = this.checkTampering(contract, projectPath, builderReport.filesChanged);
    if (tamperingCheck.tampered) {
      Logger.error(`[SECURITY_ALERT] [IndependentEvaluator] TENTATIVA DE ADULTERAÇÃO DETECTADA: ${tamperingCheck.reason}`);

      const evalResult: EvaluationResult = {
        id: crypto.randomUUID(),
        contractId: contract.id,
        taskId: contract.taskId,
        runId: contract.runId,
        verdict: 'TAMPERING_DETECTED',
        builderStatus: builderReport.status === 'success' ? 'COMPLETED' : 'FAILED',
        evaluatorVerdict: 'TAMPERING_DETECTED',
        taskIsDone: false,
        passedCriteria: [],
        failedCriteria: ['Integridade dos arquivos de avaliação protegidos mantida'],
        evidence: {
          tamperingDetected: true,
          tamperedFiles: tamperingCheck.tamperedFiles,
          output: tamperingCheck.reason
        },
        expected: 'Arquivos de teste protegidos inalterados',
        actual: `Adulteração detectada nos arquivos: ${tamperingCheck.tamperedFiles.join(', ')}`,
        evaluatorNotes:
          'REJEITADO: O agente tentou resolver o problema adulterando ou enfraquecendo o harness de avaliação.',
        evaluatorName: this.evaluatorName,
        executedCommands: [],
        exitCode: 403,
        durationMs: Date.now() - startTime,
        createdAt: nowIso
      };

      this.persistEvaluationResult(evalResult, contract);
      return evalResult;
    }

    // 1.5. Anti-weakening check (Proteção contra enfraquecimento de testes e critérios)
    const weakeningCheck = this.detectTestWeakening(projectPath, builderReport.filesChanged || []);
    if (weakeningCheck.isWeakened) {
      Logger.error(`[SECURITY_ALERT] [IndependentEvaluator] ENFRAQUECIMENTO DE TESTES DETECTADO: ${weakeningCheck.reason}`);

      const evalResult: EvaluationResult = {
        id: crypto.randomUUID(),
        contractId: contract.id,
        taskId: contract.taskId,
        runId: contract.runId,
        verdict: 'TAMPERING_DETECTED',
        builderStatus: builderReport.status === 'success' ? 'COMPLETED' : 'FAILED',
        evaluatorVerdict: 'TAMPERING_DETECTED',
        taskIsDone: false,
        passedCriteria: [],
        failedCriteria: ['Critérios de aceitação e testes originais preservados sem enfraquecimento'],
        evidence: {
          tamperingDetected: true,
          tamperedFiles: weakeningCheck.weakenedFiles,
          output: weakeningCheck.reason,
          testWeakening: weakeningCheck
        },
        expected: 'Testes mantidos íntegros com todas as asserções originais',
        actual: weakeningCheck.reason || 'Enfraquecimento de testes detectado',
        evaluatorNotes: `REJEITADO: ${weakeningCheck.reason}`,
        evaluatorName: this.evaluatorName,
        executedCommands: [],
        exitCode: 403,
        durationMs: Date.now() - startTime,
        createdAt: nowIso
      };

      this.persistEvaluationResult(evalResult, contract);
      return evalResult;
    }

    // 1.8. Anti-Slop check (Detecção de placeholders, mocks vazios em produção e asserções triviais)
    const antiSlopCheck = this.detectAntiSlop(projectPath, builderReport.filesChanged || []);
    if (antiSlopCheck.hasSlop) {
      const severeSlop = antiSlopCheck.findings.some(
        f => f.type === 'EMPTY_PLACEHOLDER' || f.type === 'PRODUCTION_MOCK'
      );
      if (severeSlop) {
        Logger.error(`[ANTI_SLOP_GATE] [IndependentEvaluator] SLOP DETECTADO: ${antiSlopCheck.reason}`);

        const evalResult: EvaluationResult = {
          id: crypto.randomUUID(),
          contractId: contract.id,
          taskId: contract.taskId,
          runId: contract.runId,
          verdict: 'FAIL',
          builderStatus: builderReport.status === 'success' ? 'COMPLETED' : 'FAILED',
          evaluatorVerdict: 'FAIL',
          taskIsDone: false,
          passedCriteria: [],
          failedCriteria: ['Código funcional de alta fidelidade sem simulações vazias ou código morto (Anti-Slop)'],
          evidence: {
            antiSlop: antiSlopCheck,
            output: antiSlopCheck.reason
          },
          expected: 'Implementação real sem mocks simulados em produção ou placeholders vazios',
          actual: antiSlopCheck.reason || 'Código superficial detectado',
          evaluatorNotes: `REJEITADO (Anti-Slop): ${antiSlopCheck.reason}`,
          evaluatorName: this.evaluatorName,
          executedCommands: [],
          exitCode: 422,
          durationMs: Date.now() - startTime,
          createdAt: nowIso
        };

        this.persistEvaluationResult(evalResult, contract);
        return evalResult;
      }
    }

    // 1.8.1. Anti-Slop Visual Quality Gate (detecção de proliferação de emojis como ícones e tokens ausentes)
    const designQualityCheck = this.validateFrontendDesignQuality(
      projectPath,
      builderReport.filesChanged || [],
      contract.objective
    );
    if (!designQualityCheck.passed) {
      const severeDesignSlop = designQualityCheck.findings.some(
        f =>
          f.type === 'EMOJI_ICON_PROLIFERATION' ||
          f.type === 'MISSING_DESIGN_TOKENS' ||
          f.type === 'ROOT_ROUTE_HIJACKED_BY_JSON'
      );
      if (severeDesignSlop) {
        const rootHijacked = designQualityCheck.findings.find(f => f.type === 'ROOT_ROUTE_HIJACKED_BY_JSON');
        Logger.error(`[VISUAL_GATE] [IndependentEvaluator] SLOP VISUAL / ROTA RAIZ DETECTADO: ${designQualityCheck.details}`);
        const evalResult: EvaluationResult = {
          id: crypto.randomUUID(),
          contractId: contract.id,
          taskId: contract.taskId,
          runId: contract.runId,
          verdict: 'FAIL',
          builderStatus: builderReport.status === 'success' ? 'COMPLETED' : 'FAILED',
          evaluatorVerdict: 'FAIL',
          taskIsDone: false,
          passedCriteria: [],
          failedCriteria: [
            rootHijacked
              ? 'A rota raiz GET / deve servir public/index.html (HTML) e não retornar JSON da API (ROOT_ROUTE_HIJACKED_BY_JSON)'
              : 'Qualidade de design anti-slop (zero emojis de sistema como ícones e design tokens semânticos)'
          ],
          evidence: {
            antiSlop: antiSlopCheck,
            designQuality: designQualityCheck,
            output: designQualityCheck.details
          },
          expected: rootHijacked
            ? 'Rota raiz GET / servindo public/index.html e endpoints de status em /api/health'
            : 'Interface profissional padrão Linear/Raycast com ícones SVG e tokens semânticos',
          actual: designQualityCheck.details || 'Slop visual de interface detectado',
          evaluatorNotes: `REJEITADO: ${designQualityCheck.details || 'Falha de qualidade de interface'}`,
          evaluatorName: this.evaluatorName,
          executedCommands: [],
          exitCode: 422,
          durationMs: Date.now() - startTime,
          createdAt: nowIso
        };

        this.persistEvaluationResult(evalResult, contract);
        return evalResult;
      }
    }

    // 1.8.2. Playwright Visual Inspector & Browser Probe ("Olhos Reais")
    let visualInspectionResult: VisualInspectionResult | undefined = undefined;
    let userJourneyResult: UserJourneyResult | undefined = undefined;
    let securityPentestResult: SecurityPentestResult | undefined = undefined;
    const isFrontendTask = Boolean(
      (contract.objective &&
        /frontend|front-end|\bui\b|interface|layout|tela|dashboard|component|page|view|estilo|css|html/i.test(
          contract.objective
        )) ||
        (builderReport.filesChanged &&
          builderReport.filesChanged.some(f => /\.(html|css|jsx|tsx|vue|svelte)$/i.test(f))) ||
        PlaywrightVisualInspector.findCandidateHtmlFile(projectPath)
    );

    const shouldRunSecurityPentest = Boolean(
      isFrontendTask ||
        options?.forceLiveBrowser ||
        /pentest|appsec|owasp|sql\s*injection|xss|path\s*traversal|homologa[çc][aã]o\s+de\s+seguran[çc]a/i.test(
          contractText
        )
    );

    if (isFrontendTask) {
      try {
        visualInspectionResult = await PlaywrightVisualInspector.inspectRenderedApp({
          projectPath,
          taskId: contract.taskId
        });

        if (!visualInspectionResult.passed) {
          const fatalConsole = visualInspectionResult.consoleErrors.length > 0;
          const fatalEmptyRoot = visualInspectionResult.isEmptyRoot;
          const fatalRootJson = Boolean(visualInspectionResult.rootRouteHijackedByJson);

          if (fatalConsole || fatalEmptyRoot || fatalRootJson) {
            Logger.error(
              `[PLAYWRIGHT_INSPECTOR] [IndependentEvaluator] FALHA CRÍTICA EM INSPEÇÃO VISUAL PLAYWRIGHT: ${visualInspectionResult.details}`
            );
            const evalResult: EvaluationResult = {
              id: crypto.randomUUID(),
              contractId: contract.id,
              taskId: contract.taskId,
              runId: contract.runId,
              verdict: 'FAIL',
              builderStatus: builderReport.status === 'success' ? 'COMPLETED' : 'FAILED',
              evaluatorVerdict: 'FAIL',
              taskIsDone: false,
              passedCriteria: [],
              failedCriteria: [
                fatalRootJson
                  ? 'A rota raiz GET / deve servir public/index.html (HTML) e não retornar JSON da API (ROOT_ROUTE_HIJACKED_BY_JSON)'
                  : fatalConsole
                    ? 'Execução em navegador sem erros de runtime no console (Playwright Visual Probe)'
                    : 'Renderização de elementos interativos e estrutura DOM não-vazia (Empty Root Detection)'
              ],
              evidence: {
                antiSlop: antiSlopCheck,
                designQuality: designQualityCheck,
                visualInspection: visualInspectionResult,
                output: visualInspectionResult.details
              },
              expected: fatalRootJson
                ? 'Rota raiz GET / servindo public/index.html e endpoints de status em /api/health'
                : 'Aplicação web renderizada em navegador headless sem erros de console e com elementos interativos',
              actual: visualInspectionResult.details,
              evaluatorNotes: `REJEITADO (Playwright Visual Eyes): ${visualInspectionResult.details}`,
              evaluatorName: this.evaluatorName,
              executedCommands: [],
              exitCode: fatalConsole ? 500 : 422,
              durationMs: Date.now() - startTime,
              createdAt: nowIso
            };

            this.persistEvaluationResult(evalResult, contract);
            return evalResult;
          }
        }
      } catch (err: any) {
        Logger.warn(`[IndependentEvaluator] Erro não bloqueante ao executar inspeção visual Playwright: ${err.message}`);
      }

      // 1.8.3. User Experience Simulator (Navegador Real: Click, Type, Network & F5 Persistence)
      try {
        userJourneyResult = await UserExperienceSimulator.simulateRealUserJourney({
          projectPath,
          taskId: contract.taskId,
          runId: contract.runId,
          forceLiveBrowser: options?.forceLiveBrowser
        });

        if (!userJourneyResult.passed) {
          const hasApiErrors = userJourneyResult.apiErrorsDetected.length > 0;
          const hasDeadButtons = userJourneyResult.deadInteractiveElements.length > 0;
          const failedF5 = !userJourneyResult.journeys.f5Persistence.passed;

          Logger.error(
            `[UX_SIMULATOR] [IndependentEvaluator] FALHA EM SIMULAÇÃO DE EXPERIÊNCIA DO USUÁRIO: ${userJourneyResult.details}`
          );
          const evalResult: EvaluationResult = {
            id: crypto.randomUUID(),
            contractId: contract.id,
            taskId: contract.taskId,
            runId: contract.runId,
            verdict: 'FAIL',
            builderStatus: builderReport.status === 'success' ? 'COMPLETED' : 'FAILED',
            evaluatorVerdict: 'FAIL',
            taskIsDone: false,
            passedCriteria: [],
            failedCriteria: [
              failedF5
                ? 'Persistência de dados confirmada após F5/Reload completo (DATA_LOST_AFTER_RELOAD)'
                : hasApiErrors
                  ? 'Operações de formulário sem erros HTTP 4xx/5xx de API (API_ERROR_DURING_USER_ACTION)'
                  : hasDeadButtons
                    ? 'Zero botões mortos ou elementos interativos sem fiação funcional (DEAD_INTERACTIVE_ELEMENTS)'
                    : 'Jornada interativa de usuário no navegador concluída com sucesso (UserExperienceSimulator)'
            ],
            evidence: {
              antiSlop: antiSlopCheck,
              designQuality: designQualityCheck,
              visualInspection: visualInspectionResult,
              userJourney: userJourneyResult,
              output: userJourneyResult.details
            },
            expected:
              'Aplicação funcional de ponta a ponta: formulários salvam no backend, dados persistem no F5 e zero erros de API',
            actual: userJourneyResult.details,
            evaluatorNotes: `REJEITADO (UserExperienceSimulator): ${userJourneyResult.details}`,
            evaluatorName: this.evaluatorName,
            executedCommands: [],
            exitCode: hasApiErrors ? 500 : 422,
            durationMs: Date.now() - startTime,
            createdAt: nowIso
          };

          this.persistEvaluationResult(evalResult, contract);
          return evalResult;
        }
      } catch (err: any) {
        Logger.warn(`[IndependentEvaluator] Erro não bloqueante ao executar simulação de usuário: ${err.message}`);
      }
    }

    // 1.8.4. Security Pentest Simulator — Red Team Gate (SQLi, XSS, Path Traversal, Secrets & Fuzzing)
    if (shouldRunSecurityPentest) {
      try {
        securityPentestResult = await SecurityPentestSimulator.runAutonomousPentest({
          projectPath,
          taskId: contract.taskId,
          runId: contract.runId,
          forceLiveAttack: options?.forceLiveBrowser
        });

        if (!securityPentestResult.passed) {
          const criticalVulns = securityPentestResult.vulnerabilities.filter(
            v => v.severity === 'CRITICAL' || v.severity === 'HIGH'
          );
          const firstVuln = criticalVulns[0] || securityPentestResult.vulnerabilities[0];
          const vulnReason = firstVuln ? `${firstVuln.code}: ${firstVuln.details}` : securityPentestResult.summary;

          Logger.error(
            `[APPSEC_PENTEST] [IndependentEvaluator] VULNERABILIDADE DETECTADA PELO PENTEST SIMULATOR: ${vulnReason}`
          );
          const evalResult: EvaluationResult = {
            id: crypto.randomUUID(),
            contractId: contract.id,
            taskId: contract.taskId,
            runId: contract.runId,
            verdict: 'FAIL',
            builderStatus: builderReport.status === 'success' ? 'COMPLETED' : 'FAILED',
            evaluatorVerdict: 'FAIL',
            taskIsDone: false,
            passedCriteria: [],
            failedCriteria: [
              `Segurança da aplicação verificada e aprovada pelo Red Team Gate (${firstVuln ? firstVuln.code : 'SECURITY_PENTEST_FAILED'})`
            ],
            evidence: {
              antiSlop: antiSlopCheck,
              designQuality: designQualityCheck,
              visualInspection: visualInspectionResult,
              userJourney: userJourneyResult,
              securityPentest: securityPentestResult,
              output: securityPentestResult.summary
            },
            expected:
              'Aplicação imune a vulnerabilidades OWASP Top 10: sem Path Traversal, sem SQL Injection, sem XSS, sem vazamento de segredos e com validação de input',
            actual: securityPentestResult.summary,
            evaluatorNotes: `REJEITADO (SecurityPentestSimulator): ${vulnReason}. Remediação: ${firstVuln?.remediation || 'Sanitizar inputs e restringir rotas.'}`,
            evaluatorName: this.evaluatorName,
            executedCommands: [],
            exitCode: 403,
            durationMs: Date.now() - startTime,
            createdAt: nowIso
          };

          this.persistEvaluationResult(evalResult, contract);
          return evalResult;
        }
      } catch (err: any) {
        Logger.warn(`[IndependentEvaluator] Erro não bloqueante ao executar SecurityPentestSimulator: ${err.message}`);
      }
    }

    // 2. Real objective verification execution
    const executedCommands: string[] = [];
    const stepsResults: Array<{ step: string; passed: boolean; detail: string }> = [];
    let overallPassed = true;
    let lastExitCode = 0;
    let combinedOutput = '';
    let verifiedSteps = 0;
    const controlledOperations: Array<{
      executable: string;
      args: string[];
      cwd: string;
      sourceProject: string;
      recordPath: string;
      durationMs: number;
    }> = [];

    if (contract.verificationSteps && contract.verificationSteps.length > 0) {
      for (const step of contract.verificationSteps) {
        if (step.command) {
          const normStep = normalizeOrRecoverVerificationCommand(step.command, projectPath, {
            allowUncreatedFiles: false,
            requireCanonicalEvidenceOnDisk: true,
            scopeFiles: builderReport.filesChanged
          });
          const rawCommandToUse = normStep.recovered ? normStep.command : step.command;

          const policy = PolicyEngine.evaluateCommand(rawCommandToUse);
          if (policy.isHardBlocked || policy.riskLevel === 'red') {
            overallPassed = false;
            stepsResults.push({
              step: step.name,
              passed: false,
              detail: 'BLOCKED: comando de verificação proibido pela política de segurança.'
            });
            continue;
          }
          if (/^(?:node\s+-e\s+["']\s*process\.exit\(0\)["']|exit\s+0|true|echo\b)/i.test(rawCommandToUse.trim())) {
            if (isInitialMilestoneTask) {
              verifiedSteps++;
              stepsResults.push({
                step: step.name,
                passed: true,
                detail: 'Milestone inicial aprovado: validação estrutural de presença de arquivos e sintaxe.'
              });
              continue;
            }
            overallPassed = false;
            stepsResults.push({
              step: step.name,
              passed: false,
              detail: 'NEEDS_EVIDENCE: comando trivial não verifica o comportamento exigido.'
            });
            continue;
          }
          verifiedSteps++;
          try {
            const command = resolveVerificationCommand(rawCommandToUse, projectPath);
            Logger.info(`[IndependentEvaluator] Executando verificação objetiva: "${command}" em "${projectPath}"...`);
            let out: string;
            try {
              out = await executeVerificationAsync(command, projectPath, 45000, operation => {
                executedCommands.push(command);
                controlledOperations.push(operation);
              });
            } catch (cvErr: any) {
              const isReviewRequired = cvErr?.code === 'COMMAND_REVIEW_REQUIRED';
              const isTestOrCheckCommand =
                /^(?:npm\s+(?:test|run\s+(?:test|typecheck|build|lint)(?::[a-zA-Z0-9_-]+)?)|(?:npx\s+)?tsx\s+--test|(?:node|npx)\s+--test)/i.test(
                  command.trim()
                );
              const { DevAutonomyService } = await import('./devAutonomyService.js');
              const isTrusted = DevAutonomyService.isProjectTrusted(contract.projectId);
              const fullAutonomy = DevAutonomyService.hasFullDevAutonomy(contract.projectId);
              if (isReviewRequired && isTestOrCheckCommand && isTrusted && fullAutonomy) {
                Logger.info(
                  `[IndependentEvaluator] Projeto possui autonomia total (ALLOW/EAGER). Executando comando de verificação via CommandExecutionEngine: "${command}"...`
                );
                const cleanEnv = this.buildCleanExecutionEnv();

                const execResult = await CommandExecutionEngine.execute({
                  command,
                  cwd: projectPath,
                  kind: 'test',
                  timeoutMs: 45000,
                  env: cleanEnv,
                  shell: true,
                  idempotencyKey: `eval-${contract.runId || 'run'}-${contract.taskId || 'task'}-${step.name}-${Date.now()}`,
                  metadata: { contractId: contract.id, taskId: contract.taskId, runId: contract.runId, step: step.name }
                });

                if (execResult.status === 'TIMED_OUT') {
                  const toErr: any = new Error('TIMEOUT: Execução excedeu 45s');
                  toErr.code = 'ETIMEDOUT';
                  toErr.stdout = execResult.stdout;
                  toErr.stderr = execResult.stderr;
                  throw toErr;
                } else if (execResult.exitCode !== 0) {
                  const failErr: any = new Error(
                    execResult.errorMessage || `Processo encerrou com código ${execResult.exitCode}`
                  );
                  failErr.status = execResult.exitCode;
                  failErr.stdout = execResult.stdout;
                  failErr.stderr = execResult.stderr;
                  throw failErr;
                }

                out = execResult.stdout + (execResult.stderr ? `\n${execResult.stderr}` : '');
                executedCommands.push(command);
              } else {
                throw cvErr;
              }
            }
            lastExitCode = 0;
            combinedOutput += `\n[${step.name} - OK]:\n${out.trim()}`;
            stepsResults.push({ step: step.name, passed: true, detail: 'Comando executado com código 0' });
          } catch (err: any) {
            overallPassed = false;
            lastExitCode = err.status || 1;
            const isTimeout = err.code === 'ETIMEDOUT' || err.signal === 'SIGTERM';
            const isBlocked =
              err.code === 'COMMAND_REVIEW_REQUIRED' ||
              err.code === 'ENOENT' ||
              (err.message && (err.message.includes('not recognized') || err.message.includes('não é reconhecido')));
            const errOut = (err.stdout || '') + (err.stderr || '') + (err.message || '');
            combinedOutput += `\n[${step.name} - FALHA (código ${lastExitCode}${isTimeout ? ' - TIMEOUT' : ''})]:\n${errOut.trim()}`;
            stepsResults.push({
              step: step.name,
              passed: false,
              detail: isTimeout
                ? 'TIMEOUT: Execução excedeu 45s'
                : isBlocked
                  ? 'BLOCKED: Comando ou ambiente inacessível'
                  : `Código de saída: ${lastExitCode}`
            });
          }
        } else if (step.checkType === 'file_exists' || step.checkType === 'content_match') {
          let target = path.resolve(projectPath, step.targetPath || '');
          const relative = path.relative(path.resolve(projectPath), target);
          const withinProject = relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
          let passed = Boolean(step.targetPath && withinProject && fs.existsSync(target) && fs.statSync(target).isFile());

          // Extension Equivalence: check .js <-> .cjs <-> .mjs
          if (!passed && step.targetPath && withinProject) {
            const ext = path.extname(target).toLowerCase();
            if (['.js', '.cjs', '.mjs'].includes(ext)) {
              const baseWithoutExt = target.slice(0, -ext.length);
              for (const altExt of ['.js', '.cjs', '.mjs']) {
                const altTarget = `${baseWithoutExt}${altExt}`;
                if (fs.existsSync(altTarget) && fs.statSync(altTarget).isFile()) {
                  target = altTarget;
                  passed = true;
                  break;
                }
              }
            }
          }

          if (passed && step.checkType === 'content_match') {
            passed = Boolean(
              step.expectedOutputPattern && new RegExp(step.expectedOutputPattern).test(fs.readFileSync(target, 'utf-8'))
            );
          }
          verifiedSteps++;
          overallPassed &&= passed;
          stepsResults.push({
            step: step.name,
            passed,
            detail: passed
              ? 'Artefato verificado no disco pelo Evaluator'
              : 'Arquivo ausente, conteúdo divergente ou caminho fora do projeto'
          });
        } else {
          overallPassed = false;
          stepsResults.push({ step: step.name, passed: false, detail: 'NEEDS_EVIDENCE: etapa sem verificação executável.' });
        }
      }

      // Gate 1 Fail-Safe para tarefas de Milestone Inicial (M1 / MVP Setup / Fundação):
      if (!overallPassed && isInitialMilestoneTask && builderReport.status === 'success') {
        const changedFiles = builderReport.filesChanged || [];
        const validFiles: string[] = [];
        let syntaxErrors = 0;
        for (const relFile of changedFiles) {
          const fullPath = path.resolve(projectPath, relFile);
          if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
            const stat = fs.statSync(fullPath);
            if (stat.size > 0) {
              validFiles.push(relFile);
              if (/\.[cm]?js$/i.test(relFile)) {
                try {
                  const { execFileSync } = require('node:child_process');
                  execFileSync('node', ['--check', fullPath], { timeout: 5000, stdio: 'ignore' });
                } catch {
                  syntaxErrors++;
                }
              }
            }
          }
        }

        if (validFiles.length > 0 && syntaxErrors === 0) {
          Logger.info(
            `[IndependentEvaluator] Milestone inicial aprovado no Gate 1: ${validFiles.length} arquivo(s) criado(s) com conteúdo substantivo e sem erros de sintaxe (${validFiles.join(', ')}).`
          );
          overallPassed = true;
          lastExitCode = 0;
          combinedOutput += `\n[Milestone Inicial - Gate 1 OK]: ${validFiles.length} arquivo(s) criado(s) com conteúdo substantivo e sintaxe válida (${validFiles.join(', ')}).`;
          for (const sr of stepsResults) {
            if (!sr.passed) {
              sr.passed = true;
              sr.detail = 'Milestone inicial aprovado: arquivos de escopo criados com conteúdo substantivo e sintaxe válida.';
            }
          }
        }
      }
    } else {
      // Default: check if files were changed and no syntax error (or audit task with findings)
      if (isAuditOrInvestigationTask && hasSubstantiveAuditFindings) {
        overallPassed = true;
        combinedOutput = 'Tarefa de auditoria/diagnóstico validada com relatório substantivo de descobertas.';
        stepsResults.push({
          step: 'Validação Factual de Relatório de Auditoria',
          passed: true,
          detail: 'Descobertas e recomendações substantivas verificadas'
        });
      } else {
        const testPlan = TestSelector.planVerification(projectPath, builderReport.filesChanged || []);
        if (testPlan.matchedTests.length > 0) {
          try {
            Logger.info(
              `[IndependentEvaluator] Seleção cirúrgica de testes acionada: "${testPlan.suggestedCommand}" (${testPlan.reason})`
            );
            const cleanEnv = this.buildCleanExecutionEnv();
            const execResult = await CommandExecutionEngine.execute({
              command: testPlan.suggestedCommand,
              cwd: projectPath,
              kind: 'test',
              timeoutMs: 45000,
              env: cleanEnv,
              shell: true,
              idempotencyKey: `eval-fallback-${contract.runId || 'run'}-${contract.taskId || 'task'}`,
              metadata: { contractId: contract.id, taskId: contract.taskId, testPlan }
            });
            const passed = execResult.status === 'COMPLETED' && execResult.exitCode === 0;
            overallPassed = passed && builderReport.status === 'success';
            combinedOutput = execResult.stdout + (execResult.stderr ? `\n${execResult.stderr}` : '');
            stepsResults.push({
              step: `Verificação Focada de Testes (${testPlan.matchedTests.join(', ')})`,
              passed,
              detail: passed
                ? 'Testes cirúrgicos aprovados com código 0'
                : execResult.errorMessage || 'Falha na execução dos testes'
            });
            executedCommands.push(testPlan.suggestedCommand);
          } catch (selErr: any) {
            overallPassed = false;
            stepsResults.push({
              step: 'Execução de Testes Selecionados',
              passed: false,
              detail: selErr.message
            });
          }
        } else {
          overallPassed = builderReport.filesChanged.length > 0 && builderReport.status === 'success';
          combinedOutput = overallPassed ? 'Arquivos modificados com sucesso no escopo.' : 'Nenhum arquivo alterado.';
        }
      }
    }

    // Gate 1 Fail-Safe & Auto-Healing via CI Doctor:
    // Quando o GATE_1_DEV_TESTS falhar mas os arquivos esperados existirem:
    // Em vez de rejeitar imediatamente com verdict = 'FAIL', invoque CiDoctorService.
    let ciDoctorHealed = false;
    let ciDoctorDiagnosis: FailureDiagnosis | null = null;
    let ciDoctorPatchApplied: string | undefined = undefined;

    const expectedFilesList = (options?.expectedScopeFiles && options.expectedScopeFiles.length > 0)
      ? options.expectedScopeFiles
      : (builderReport.filesChanged && builderReport.filesChanged.length > 0)
        ? builderReport.filesChanged
        : [];
    const expectedFilesExist = expectedFilesList.length > 0 && expectedFilesList.some(f => {
      try {
        return fs.existsSync(path.resolve(projectPath, f));
      } catch {
        return false;
      }
    });

    if (!overallPassed && expectedFilesExist && builderReport.status === 'success') {
      try {
        const failureDiagnosis = CiDoctorService.diagnoseFailure(combinedOutput, projectPath);
        if (failureDiagnosis) {
          Logger.info(
            `[IndependentEvaluator] Falha de teste detectada no Gate 1. Invocando CI Doctor para diagnóstico cirúrgico... (${failureDiagnosis.assertionMessage})`
          );
          const healCommand = executedCommands[executedCommands.length - 1] || contract.verificationSteps?.[0]?.command || 'npm test';
          const healResult = await CiDoctorService.attemptQuickHeal({
            projectPath,
            task: {
              id: contract.taskId,
              runId: contract.runId,
              title: contract.objective,
              criteria: contract.acceptanceCriteria,
              protectedEvaluationFiles: contract.protectedEvaluationFiles
            },
            failureDiagnosis,
            verificationCommand: healCommand
          });

          if (healResult.healed) {
            Logger.info(
              `[IndependentEvaluator] CI Doctor auto-reparou a falha no Gate 1 com sucesso via micro-patch!`
            );
            overallPassed = true;
            lastExitCode = 0;
            ciDoctorHealed = true;
            ciDoctorDiagnosis = failureDiagnosis;
            ciDoctorPatchApplied = healResult.patchApplied;

            for (const sr of stepsResults) {
              if (!sr.passed) {
                sr.passed = true;
                sr.detail = `Auto-reparado pelo CI Doctor: ${healResult.patchApplied || 'Micro-patch aplicado com sucesso'}`;
              }
            }

            combinedOutput += `\n[CI DOCTOR - HEALED]: Micro-patch cirúrgico aplicado com sucesso.\n${healResult.output || ''}`;

            ObservabilityService.emit({
              level: 'INFO',
              event: 'CI_DOCTOR_HEALED',
              message: `CI Doctor corrigiu com sucesso falha em ${failureDiagnosis.failedFile || 'projeto'} via micro-patch`,
              service: 'evaluator',
              runId: contract.runId,
              taskId: contract.taskId,
              metadata: {
                contractId: contract.id,
                diagnosis: failureDiagnosis,
                patchApplied: healResult.patchApplied
              }
            });
          }
        }
      } catch (doctorErr: any) {
        Logger.warn(`[IndependentEvaluator] Tentativa de reparo via CI Doctor falhou: ${doctorErr.message}`);
      }
    }

    // 2.1 Additional Factual Checks for Visual and Persistence Requirements
    const sanitizedContractText = contractText
      .replace(
        /\b(?:sem|n[aã]o\s+(?:ter[aá]|possui|precisa\s+de|usar|utilizar|exige|requer)|dispensa)\s+(?:interface(?:\s+visual|\s+gr[aá]fica|\s+web)?|dashboard|html|web|frontend|tela|visual|p[aá]gina|pagina|persist[eê]ncia|persistente|banco\s+de\s+dados|sqlite|salvar\s+em\s+disco|arquivo\s+json)/gi,
        ' '
      )
      .replace(
        /\binterface\s+(?:de\s+linha\s+de\s+comando|cli|p[uú]blica|program[aá]tica|de\s+programa[çc][aã]o|fluente|typescript|m[oó]dulo)\b/gi,
        ' '
      )
      .replace(
        /\b(?:content-type|mime-?type|mimes?|entrega de est[aá]ticos|servi[çc]o de est[aá]ticos|arquivos est[aá]ticos|arquivos css|arquivos js|arquivos html)\b/gi,
        ' '
      )
      .replace(/\b(?:servidor http|servidor web|api rest|endpoints? rest|rotas? http|rotas? api)\b/gi, ' ');

    const hasVisualScopeFiles =
      Array.isArray(options?.expectedScopeFiles) &&
      options.expectedScopeFiles.some(
        f => /\.(html|jsx|tsx|vue|svelte|css)$/i.test(f) || /(^|\/)public\/.*index/i.test(f)
      );
    const scopeExplicitlyGiven = Array.isArray(options?.expectedScopeFiles) && options.expectedScopeFiles.length > 0;
    const mandatesVisual =
      (!scopeExplicitlyGiven || hasVisualScopeFiles) &&
      (hasVisualScopeFiles ||
        /(?:(?:criar|construir|desenvolver|implementar|renderizar)\s+(?:a\s+|o\s+)?(?:interface(?:\s+(?:visual|web|gr[aá]fica|spa))?|dashboard|frontend|tela|p[aá]gina|pagina|ui|layout)|interface\s+visual|dashboard\s+web|interface\s+spa|frontend\s+spa)\b/i.test(
          sanitizedContractText
        ));
    const mandatesPersistence = /(persist[eê]ncia|persistente|salvar em disco|armazenar|banco de dados|sqlite|arquivo json)/i.test(
      sanitizedContractText
    );

    let visualCheckPassed = true;
    let persistenceCheckPassed = true;

    if (mandatesVisual) {
      const visualCheck = this.validateVisualAcceptance(projectPath);
      stepsResults.push({
        step: 'Validação Factual Visual (HTML / Dashboard / UI)',
        passed: visualCheck.hasVisualUi,
        detail: visualCheck.details
      });
      if (!visualCheck.hasVisualUi) {
        visualCheckPassed = false;
        overallPassed = false;
        Logger.warn(
          `[IndependentEvaluator] Falha de Aceitação Visual: A tarefa requer interface visual, mas nenhum artefato HTML/UI web foi gerado.`
        );
      }
    }

    if (mandatesPersistence) {
      const persistenceCheck = this.validatePersistenceAcceptance(projectPath);
      stepsResults.push({
        step: 'Validação Factual de Persistência (Disco / SQLite / Storage)',
        passed: persistenceCheck.hasPersistence,
        detail: persistenceCheck.details
      });
      if (!persistenceCheck.hasPersistence) {
        persistenceCheckPassed = false;
        overallPassed = false;
        Logger.warn(
          `[IndependentEvaluator] Falha de Aceitação de Persistência: A tarefa requer persistência, mas nenhuma escrita em arquivo/banco foi encontrada.`
        );
      }
    }

    // 2.2 Substantive criteria fulfillment check:
    // Do not accept merely exit code 0 or touched files if acceptance criteria were completely unaddressed in code
    const missingEvidenceCriteria: string[] = [];
    if (!isAuditOrInvestigationTask && builderReport.filesChanged && builderReport.filesChanged.length > 0) {
      const hasOnlyTrivialVerification = (contract.verificationSteps || []).every(
        s => !s.command || /^(node\s+-e\s+["']process\.exit\(0\)["']|exit\s+0|true|echo\b)/i.test(s.command.trim())
      );

      const implementedText = (builderReport.implemented || []).join(' ').toLowerCase();

      for (const criterion of contract.acceptanceCriteria) {
        if (
          /^(todos|código limpo|sem erros|testes passam|atender plenamente|must pass|pass|passar|teste|test|isolamento|valida[çc][aã]o|executar)/i.test(
            criterion.trim()
          )
        ) {
          continue;
        }

        const tokens = criterion
          .toLowerCase()
          .replace(/[^a-zA-Z0-9_\-\/]/g, ' ')
          .split(/\s+/)
          .filter(
            t =>
              t.length > 3 &&
              ![
                'deve',
                'para',
                'como',
                'estar',
                'pelo',
                'pela',
                'sobre',
                'mais',
                'menos',
                'quando',
                'funcional',
                'corretamente'
              ].includes(t)
          );

        if (tokens.length >= 2) {
          let tokenFound = builderReport.filesChanged.some(f => {
            const fLower = f.toLowerCase();
            return tokens.some(tok => fLower.includes(tok) || (tok.length > 4 && fLower.includes(tok.slice(0, 4))));
          });

          if (!tokenFound) {
            for (const f of builderReport.filesChanged) {
              const fullP = path.join(projectPath, f);
              if (fs.existsSync(fullP)) {
                try {
                  const content = fs.readFileSync(fullP, 'utf-8').toLowerCase();
                  if (tokens.some(tok => content.includes(tok) || (tok.length > 4 && content.includes(tok.slice(0, 4))))) {
                    tokenFound = true;
                    break;
                  }
                } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "independentEvaluator",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:independentEvaluator]", err);
      }
    }
              }
            }
          }

          if (!tokenFound && tokens.some(tok => combinedOutput.toLowerCase().includes(tok))) {
            tokenFound = true;
          }

          if (
            !tokenFound &&
            tokens.some(tok => implementedText.includes(tok) || (tok.length > 4 && implementedText.includes(tok.slice(0, 4))))
          ) {
            tokenFound = true;
          }

          if (!tokenFound) {
            if (/visual|dashboard|html|ui/i.test(criterion) && visualCheckPassed) {
              tokenFound = true;
            } else if (/persist[eê]ncia|armazenar|salvar|banco/i.test(criterion) && persistenceCheckPassed) {
              tokenFound = true;
            }
          }

          if (!tokenFound && hasOnlyTrivialVerification) {
            missingEvidenceCriteria.push(`Critério sem evidência factual no código ou execução: "${criterion}"`);
          }
        }
      }
    }

    if (missingEvidenceCriteria.length > 0) {
      overallPassed = false;
      Logger.warn(
        `[IndependentEvaluator] Falso negativo evitado: Critérios sem evidência factual: ${missingEvidenceCriteria.join('; ')}`
      );
    }

    // 3. Compute Granular Verdict reflecting factual truth of project
    let verdict: EvaluatorVerdict = 'FAIL';

    if (contract.verificationSteps && contract.verificationSteps.length > 0) {
      if (overallPassed) {
        verdict = 'PASS';
      } else {
        const hasTimeoutStep = stepsResults.some(s => s.detail.includes('TIMEOUT'));
        const hasBlockedStep = stepsResults.some(s => s.detail.includes('BLOCKED'));
        if (hasTimeoutStep) {
          verdict = 'TIMEOUT';
        } else if (hasBlockedStep) {
          verdict = 'BLOCKED';
        } else {
          verdict = 'FAIL';
        }
      }
    } else {
      if (builderReport.filesChanged.length === 0) {
        verdict = 'INCONCLUSIVE';
      } else if (builderReport.status === 'success' && overallPassed) {
        verdict = 'INCONCLUSIVE';
      } else {
        verdict = 'FAIL';
      }
    }

    if (!verifiedSteps && overallPassed) verdict = 'INCONCLUSIVE';
    if (!verifiedSteps && stepsResults.every(s => s.detail.startsWith('NEEDS_EVIDENCE:'))) verdict = 'INCONCLUSIVE';
    const taskIsDone = verdict === 'PASS';

    // 4. Determine criteria pass/fail
    const passedCriteria: string[] = [];
    const failedCriteria: string[] = [];

    if (verdict === 'PASS') {
      passedCriteria.push(...contract.acceptanceCriteria);
    } else {
      if (missingEvidenceCriteria.length > 0) {
        failedCriteria.push(...missingEvidenceCriteria);
      }
      if (!visualCheckPassed) {
        failedCriteria.push('Interface visual e dashboard web devem possuir artefatos HTML/UI funcionais no projeto');
      }
      if (!persistenceCheckPassed) {
        failedCriteria.push('Persistência de dados em disco ou banco deve ser implementada no projeto');
      }
      if (verdict === 'TIMEOUT') {
        failedCriteria.push('Comando de verificação excedeu o tempo limite (TIMEOUT)');
      } else if (verdict === 'BLOCKED') {
        failedCriteria.push('Ambiente de execução ou dependências inacessíveis (BLOCKED)');
      } else if (verdict === 'INCONCLUSIVE') {
        failedCriteria.push('Nenhum comando de teste configurado e nenhum arquivo alterado (INCONCLUSIVE)');
      } else if (visualCheckPassed && persistenceCheckPassed) {
        failedCriteria.push('Todos os testes e comandos de verificação automatizados devem passar com código 0');
      }
      for (const c of contract.acceptanceCriteria) {
        failedCriteria.push(c);
      }
    }

    let notes = '';
    let actual = '';
    const failedStepsSummary = stepsResults
      .filter(s => !s.passed)
      .map(s => `${s.step}: ${s.detail}`)
      .join(' | ');

    if (!visualCheckPassed) {
      notes =
        'Reprovado pelo Evaluator: Critério de interface visual/dashboard não atendido (nenhum artefato HTML ou UI web encontrado no projeto).';
      actual = 'Artefato visual HTML/UI ausente no projeto';
    } else if (!persistenceCheckPassed) {
      notes =
        'Reprovado pelo Evaluator: Critério de persistência não atendido (nenhum mecanismo de escrita em disco ou banco encontrado).';
      actual = 'Persistência em disco/banco ausente no projeto';
    } else {
      switch (verdict) {
        case 'PASS':
          notes = ciDoctorHealed
            ? `Aprovado pelo Evaluator: Evidência objetiva comprovada após auto-reparo cirúrgico pelo CI Doctor (${ciDoctorPatchApplied || 'micro-patch aplicado com código 0'}).`
            : 'Aprovado pelo Evaluator: Evidência objetiva comprovada via execução real dos testes no terminal com código 0.';
          actual = ciDoctorHealed
            ? 'Auto-reparado pelo CI Doctor: todos os comandos executados com código 0'
            : 'Todos os comandos executados com código 0 e critérios factuais atendidos';
          break;
        case 'TIMEOUT':
          notes = `Reprovado pelo Evaluator (TIMEOUT): Comando de verificação excedeu o tempo limite no ambiente de teste.${failedStepsSummary ? ` Detalhes: ${failedStepsSummary}` : ''}`;
          actual = 'Timeout durante execução dos testes de verificação';
          break;
        case 'BLOCKED':
          notes = `Reprovado pelo Evaluator (BLOCKED): Ambiente, diretório ou comandos pré-requisito inacessíveis.${failedStepsSummary ? ` Detalhes: ${failedStepsSummary}` : ''}`;
          actual = `Execução bloqueada por ambiente/pré-requisitos: código de saída ${lastExitCode}`;
          break;
        case 'INCONCLUSIVE':
          notes =
            'Reprovado pelo Evaluator (INCONCLUSIVE): Sem evidências objetivas ou arquivos modificados para comprovar a entrega.';
          actual = 'Nenhum comando de teste configurado e nenhum arquivo alterado no escopo';
          break;
        case 'FAIL':
        default:
          notes = `Reprovado pelo Evaluator (FAIL): Testes ou comandos de validação falharam no ambiente real.${failedStepsSummary ? ` Etapas reprovadas: ${failedStepsSummary}` : ''}`;
          actual = `Comando de verificação falhou com código ${lastExitCode}`;
          break;
      }
    }

    const dynamicRiskAssessment =
      options?.effortLevel === 'MINIMAL'
        ? undefined
        : this.assessDynamicRisk(projectPath, builderReport.filesChanged || [], executedCommands);

    const adversarialValidation =
      options?.effortLevel === 'MINIMAL'
        ? undefined
        : this.validateAdversarialResilience(
            projectPath,
            builderReport.filesChanged || [],
            contract.acceptanceCriteria || []
          );

    const evalResult: EvaluationResult = {
      id: crypto.randomUUID(),
      contractId: contract.id,
      taskId: contract.taskId,
      runId: contract.runId,
      verdict,
      builderStatus: builderReport.status === 'success' ? 'COMPLETED' : 'FAILED',
      evaluatorVerdict: verdict,
      taskIsDone,
      passedCriteria,
      failedCriteria,
      evidence: {
        command: executedCommands.join(' && '),
        filesChanged: builderReport.filesChanged || [],
        controlledOperations,
        exitCode: lastExitCode,
        output:
          combinedOutput.length > 8000
            ? combinedOutput.slice(0, 1000) +
              '\n… saída completa no registro de execução …\n' +
              combinedOutput.slice(-6000)
            : combinedOutput.trim(),
        durationMs: Date.now() - startTime,
        stepsResults,
        ciDoctorHealed,
        ciDoctorDiagnosis,
        ciDoctorPatchApplied,
        scopeValidation,
        dynamicRiskAssessment,
        adversarialValidation,
        antiSlop: antiSlopCheck,
        designQuality: designQualityCheck,
        visualInspection: visualInspectionResult,
        userJourney: userJourneyResult,
        securityPentest: securityPentestResult,
        evidenceSummary: {
          codeDiffAvailable: (builderReport.filesChanged || []).length > 0,
          filesChangedCount: (builderReport.filesChanged || []).length,
          independentCommandExecuted: executedCommands.length > 0,
          independentCommandExitCode: lastExitCode,
          requirementsVerifiedCount: stepsResults.filter(s => s.passed).length,
          adversarialChecksPassed: adversarialValidation ? adversarialValidation.passed : true,
          antiSlopPassed: !antiSlopCheck?.hasSlop,
          designQualityPassed: designQualityCheck?.passed,
          visualInspectionPassed: visualInspectionResult ? visualInspectionResult.passed : true,
          userJourneyPassed: userJourneyResult ? userJourneyResult.passed : true,
          securityPentestPassed: securityPentestResult ? securityPentestResult.passed : true,
          groundTruthVerified: taskIsDone,
          effortLevel: options?.effortLevel || 'STANDARD'
        }
      },
      expected: 'Código de saída 0 no comando de verificação e todos os critérios atendidos',
      actual,
      evaluatorNotes: notes,
      evaluatorName: this.evaluatorName,
      executedCommands,
      exitCode: lastExitCode,
      durationMs: Date.now() - startTime,
      createdAt: nowIso
    };

    this.persistEvaluationResult(evalResult, contract);

    if (verdict === 'PASS') {
      Logger.success(`[IndependentEvaluator] AVALIAÇÃO CONCLUÍDA: PASS (Task is DONE)`);
    } else {
      Logger.warn(`[IndependentEvaluator] AVALIAÇÃO CONCLUÍDA: ${verdict} (Task is NOT DONE)`);
    }

    return evalResult;
  }

  /**
   * Persists evaluation result and updates status in SQLite
   */
  private static persistEvaluationResult(result: EvaluationResult, contract: SuccessContract) {
    db.prepare(`
      INSERT INTO evaluation_results (
        id, contract_id, task_id, run_id, verdict, builder_status, evaluator_verdict,
        task_is_done, passed_criteria_json, failed_criteria_json, evidence_json,
        expected, actual, evaluator_notes, evaluator_name, executed_commands_json,
        exit_code, duration_ms, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      result.id,
      result.contractId,
      result.taskId,
      result.runId || null,
      result.verdict,
      result.builderStatus,
      result.evaluatorVerdict,
      result.taskIsDone ? 1 : 0,
      JSON.stringify(result.passedCriteria),
      JSON.stringify(result.failedCriteria),
      JSON.stringify(result.evidence),
      result.expected,
      result.actual,
      result.evaluatorNotes,
      result.evaluatorName,
      JSON.stringify(result.executedCommands),
      result.exitCode,
      result.durationMs,
      result.createdAt
    );

    ObservabilityService.emit({
      level: result.verdict === 'PASS' ? 'INFO' : 'WARN',
      event: 'evaluation.completed',
      message: `Avaliação independente concluída com veredicto: ${result.verdict} (Task is Done: ${result.taskIsDone})`,
      service: 'evaluator',
      runId: result.runId,
      taskId: result.taskId,
      durationMs: result.durationMs,
      status: result.verdict,
      metadata: {
        contractId: result.contractId,
        verdict: result.verdict,
        taskIsDone: result.taskIsDone,
        exitCode: result.exitCode,
        evaluatorName: result.evaluatorName
      }
    });

    const newContractStatus =
      result.verdict === 'PASS'
        ? 'passed'
        : result.verdict === 'TAMPERING_DETECTED'
          ? 'tampered'
          : 'failed';

    db.prepare(`
      UPDATE success_contracts
      SET status = ?, updated_at = ?
      WHERE id = ?
    `).run(newContractStatus, result.createdAt, contract.id);

    try {
      db.prepare(`
        UPDATE autonomous_tasks
        SET evaluation_status = ?, updated_at = ?
        WHERE id = ?
      `).run(newContractStatus, result.createdAt, contract.taskId);
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "independentEvaluator",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:independentEvaluator]", err);
      }
    }
  }

  static getContract(contractId: string): SuccessContract | null {
    const row: any = db.prepare('SELECT * FROM success_contracts WHERE id = ?').get(contractId);
    if (!row) return null;
    return this.mapContractRow(row);
  }

  static getContractByTaskId(taskId: string): SuccessContract | null {
    const row: any = db
      .prepare('SELECT * FROM success_contracts WHERE task_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(taskId);
    if (!row) return null;
    return this.mapContractRow(row);
  }

  static getEvaluationByTaskId(taskId: string): EvaluationResult | null {
    const row: any = db
      .prepare('SELECT * FROM evaluation_results WHERE task_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(taskId);
    if (!row) return null;
    return this.mapEvaluationRow(row);
  }

  static listContractsByProject(projectId: string): SuccessContract[] {
    const rows: any[] = db
      .prepare('SELECT * FROM success_contracts WHERE project_id = ? ORDER BY created_at DESC')
      .all(projectId);
    return rows.map(r => this.mapContractRow(r));
  }

  private static safeJson<T>(raw: any, fallback: T): T {
    if (!raw || typeof raw !== 'string') return fallback;
    try {
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  private static mapContractRow(r: any): SuccessContract {
    return {
      id: r.id,
      taskId: r.task_id,
      runId: r.run_id || undefined,
      projectId: r.project_id,
      objective: r.objective,
      acceptanceCriteria: this.safeJson(r.acceptance_criteria_json, []),
      verificationSteps: this.safeJson(r.verification_steps_json, []),
      protectedEvaluationFiles: this.safeJson(r.protected_evaluation_files_json, []),
      protectedFileHashes: this.safeJson(r.protected_file_hashes_json, {}),
      baseline: this.safeJson<BaselineResult>(r.baseline_json, { ran: false, passed: false }),
      successThresholds: this.safeJson(r.success_thresholds_json, []),
      failureConditions: this.safeJson(r.failure_conditions_json, []),
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    };
  }

  private static mapEvaluationRow(r: any): EvaluationResult {
    return {
      id: r.id,
      contractId: r.contract_id,
      taskId: r.task_id,
      runId: r.run_id || undefined,
      verdict: r.verdict,
      builderStatus: r.builder_status,
      evaluatorVerdict: r.evaluator_verdict,
      taskIsDone: Boolean(r.task_is_done),
      passedCriteria: this.safeJson(r.passed_criteria_json, []),
      failedCriteria: this.safeJson(r.failed_criteria_json, []),
      evidence: this.safeJson(r.evidence_json, {}),
      expected: r.expected,
      actual: r.actual,
      evaluatorNotes: r.evaluator_notes,
      evaluatorName: r.evaluator_name,
      executedCommands: this.safeJson(r.executed_commands_json, []),
      exitCode: r.exit_code,
      durationMs: r.duration_ms,
      createdAt: r.created_at
    };
  }
}