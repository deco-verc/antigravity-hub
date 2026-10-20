import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { db } from './db.js';
import { Logger } from './logger.js';
import { validateSurgicalDiff } from './agentGuidelines.js';

export interface VerificationStep {
  name: string;
  command?: string;
  expectedExitCode?: number;
  expectedOutputPattern?: string;
  checkType?: 'command' | 'file_exists' | 'content_match';
  targetPath?: string;
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

export interface EvidenceSummary {
  codeDiffAvailable: boolean;
  filesChangedCount: number;
  independentCommandExecuted: boolean;
  independentCommandExitCode: number;
  requirementsVerifiedCount: number;
  adversarialChecksPassed: boolean;
  antiSlopPassed: boolean;
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
    evidenceSummary?: EvidenceSummary;
    stepsResults?: Array<{
      step: string;
      passed: boolean;
      detail: string;
    }>;
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

    const verificationSteps: VerificationStep[] = params.verificationSteps || (
      params.verificationCommand
        ? [{ name: 'Verificação automatizada', command: params.verificationCommand, expectedExitCode: 0 }]
        : []
    );

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
      try {
        const out = execSync(cmd, { cwd: params.projectPath, encoding: 'utf-8', timeout: 30000, stdio: 'pipe' });
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
          ran: true,
          passed: false,
          command: cmd,
          exitCode: err.status || 1,
          output: (err.stdout || err.stderr || err.message).slice(0, 1000),
          timestamp: new Date().toISOString()
        };
        Logger.success(`[Evaluator Baseline] BASELINE = FAIL estabelecido com sucesso! O teste falhou como esperado comprovando a existência do bug.`);
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
    } catch {}

    Logger.info(`[Evaluator] SuccessContract #${id.slice(0, 8)} gerado para a tarefa "${params.objective}". (${protectedEvaluationFiles.length} arquivos protegidos)`);
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

    // 1. Check if builder explicitly reported changing a protected file
    const normalizedBuilderFiles = builderFilesChanged.map(f => this.normalizeRelativePath(f, projectPath));
    for (const protFile of contract.protectedEvaluationFiles) {
      if (normalizedBuilderFiles.includes(protFile)) {
        tamperedFiles.push(protFile);
      }
    }

    // 2. Check disk integrity against recorded hashes
    for (const protFile of contract.protectedEvaluationFiles) {
      const fullPath = path.join(projectPath, protFile);
      if (!fs.existsSync(fullPath)) {
        if (!tamperedFiles.includes(protFile)) tamperedFiles.push(protFile);
        continue;
      }

      const recordedHash = contract.protectedFileHashes[protFile];
      if (recordedHash) {
        const currentHash = this.computeFileHash(fullPath);
        if (currentHash !== recordedHash) {
          if (!tamperedFiles.includes(protFile)) tamperedFiles.push(protFile);
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
    } catch {}

    try {
      return execSync(`git show HEAD:"${normRel}"`, {
        cwd: projectPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore']
      });
    } catch {}

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
    } catch {}

    for (const relFile of candidateFiles) {
      const fullPath = path.join(projectPath, relFile);
      if (!fs.existsSync(fullPath)) continue;

      let contentAfter = '';
      try {
        contentAfter = fs.readFileSync(fullPath, 'utf-8');
      } catch {
        continue;
      }

      const contentBefore = this.getFileContentBefore(projectPath, relFile);
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
        } catch {}
      }
    }

    if (isHighRisk) {
      const irreversible = riskFactors.some(r => r.includes('.sql') || r.includes('migration') || r.includes('DROP') || r.includes('DELETE'));
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
      if (/\.(test|spec)\.(js|ts|jsx|tsx|mjs)$/i.test(f)) {
        testFiles.push(f);
      }
    }

    if (testFiles.length === 0 && fs.existsSync(projectPath)) {
      const scanTests = (dir: string, depth = 0) => {
        if (depth > 2) return;
        try {
          for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
            if (ent.name === 'node_modules' || ent.name === '.git' || ent.name === '.ai-dev-hub') continue;
            const full = path.join(dir, ent.name);
            if (ent.isDirectory()) {
              scanTests(full, depth + 1);
            } else if (/\.(test|spec)\.(js|ts|jsx|tsx|mjs)$/i.test(ent.name)) {
              testFiles.push(path.relative(projectPath, full).replace(/\\/g, '/'));
            }
          }
        } catch {}
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
      } catch {}
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
        : (hasTestFiles
            ? `Validação Adversarial PARCIAL: ${findings.length} achado(s) de teste superficial/happy-path.`
            : 'Nenhum arquivo de teste para validação adversarial.')
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
      const isTestFile = /\.(test|spec)\.(js|ts|jsx|tsx|mjs)$/i.test(rel) || rel.includes('test/') || rel.includes('tests/');

      try {
        const content = fs.readFileSync(full, 'utf-8');
        const trimmed = content.trim();

        // 1. Empty Placeholder check
        const commentOnlyRegex = /^(\s*(\/\/.*|\/\*[\s\S]*?\*\/)\s*)*$/;
        if (trimmed.length < 20 || commentOnlyRegex.test(trimmed)) {
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
      } catch {}
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
          if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.ai-dev-hub') continue;
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
                if (content.length > 50 && (content.includes('<body') || content.includes('<div') || content.includes('<html') || content.includes('<!DOCTYPE html>'))) {
                  matchedFiles.push(relPath);
                }
              } catch {}
            }
            // 2. React / Vue / Svelte frontend components
            else if (['.jsx', '.tsx', '.vue', '.svelte'].includes(ext)) {
              matchedFiles.push(relPath);
            }
            // 3. Server or frontend JS/TS files that serve/render HTML strings
            else if (['.js', '.mjs', '.ts'].includes(ext)) {
              try {
                const content = fs.readFileSync(fullPath, 'utf-8');
                if (
                  (content.includes('<!DOCTYPE html>') || content.includes('<html') || content.includes('<div id="app"')) &&
                  (content.includes('res.send(') || content.includes('res.end(') || content.includes('innerHTML') || content.includes('document.'))
                ) {
                  matchedFiles.push(relPath);
                }
              } catch {}
            }
          }
        }
      } catch {}
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
          if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.ai-dev-hub') continue;
          const fullPath = path.join(dir, entry.name);
          const relPath = path.relative(projectPath, fullPath).replace(/\\/g, '/');

          if (entry.isDirectory()) {
            scanDir(fullPath, depth + 1);
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (['.sqlite', '.db', '.sqlite3'].includes(ext) || (ext === '.json' && !['package.json', 'package-lock.json', 'tsconfig.json'].includes(entry.name))) {
              matchedFiles.push(relPath);
            } else if (['.js', '.mjs', '.ts'].includes(ext)) {
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
              } catch {}
            }
          }
        }
      } catch {}
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
    }
  ): Promise<EvaluationResult> {
    const contract = this.getContract(contractId);
    if (!contract) {
      throw new Error(`SuccessContract #${contractId} não encontrado no banco de dados`);
    }

    const nowIso = new Date().toISOString();
    const startTime = Date.now();
    Logger.info(`[IndependentEvaluator] Iniciando avaliação independente da tarefa "${contract.objective}"...`);

    // Principle 3: Evidence-First Engineering
    // An agent claim of success is NEVER sufficient without verifiable proof.
    const hasFilesChanged = builderReport.filesChanged && builderReport.filesChanged.length > 0;
    const agentTestsPassed = Boolean(builderReport.tests && builderReport.tests.passed && builderReport.tests.exitCode === 0);

    const contractText = `${contract.objective} ${(contract.acceptanceCriteria || []).join(' ')}`.toLowerCase();
    const isAuditOrInvestigationTask = Boolean(
      options?.taskMode === 'AUDIT' ||
      options?.taskMode === 'RESEARCH' ||
      (/(auditar|auditoria|inspecionar|inspe[çc][aã]o|investigar|investiga[çc][aã]o|diagn[oó]stico|diagnosticar|avaliar|levantamento|an[aá]lise|analisar|relat[oó]rio|pesquisa|pesquisar|research)/i.test(contractText) &&
      !/(implementar|criar|codificar|desenvolver|refatorar|corrigir|fix|adicionar c[oó]digo)/i.test(contractText))
    );

    // Audit tasks provide value via substantive findings/reports rather than file modifications
    const hasSubstantiveAuditFindings = isAuditOrInvestigationTask && Boolean(
      (builderReport.implemented && builderReport.implemented.length > 0 && builderReport.implemented.some((i: string) => i.length > 15)) ||
      (builderReport.recommendation && builderReport.recommendation.length > 30) ||
      (builderReport.knownProblems && builderReport.knownProblems.length > 0) ||
      (builderReport.finalResponse && builderReport.finalResponse.length > 50) ||
      (builderReport.rawResponse && builderReport.rawResponse.length > 50)
    );

    if (builderReport.status === 'success' && !hasFilesChanged && !agentTestsPassed && !hasSubstantiveAuditFindings) {
      Logger.warn(`[IndependentEvaluator] UNVERIFIED_CLAIM: O agente declarou sucesso sem apresentar evidências factuais (0 arquivos, sem testes e sem relatório substantivo de auditoria).`);

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
        failedCriteria: ['UNVERIFIED_CLAIM: Apresentar evidências factuais de implementação (código alterado ou testes passando)'],
        evidence: {
          output: 'UNVERIFIED_CLAIM: O agente declarou conclusão sem apresentar evidências factuais (sem arquivos modificados, sem diff e sem testes executados).',
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
        evaluatorNotes: 'REJEITADO (Evidence-First): Nenhuma afirmação do Worker é prova suficiente de conclusão sem evidências factuais.',
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

    // 1. Tampering check (Proteção estrita de testes)
    const tamperingCheck = this.checkTampering(contract, projectPath, builderReport.filesChanged);
    if (tamperingCheck.tampered) {
      Logger.error(`🚨 [IndependentEvaluator] TENTATIVA DE ADULTERAÇÃO DETECTADA! ${tamperingCheck.reason}`);

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
        evaluatorNotes: 'REJEITADO: O agente tentou resolver o problema adulterando ou enfraquecendo o harness de avaliação.',
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
      Logger.error(`🚨 [IndependentEvaluator] ENFRAQUECIMENTO DE TESTES DETECTADO! ${weakeningCheck.reason}`);

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
      const severeSlop = antiSlopCheck.findings.some(f => f.type === 'EMPTY_PLACEHOLDER' || f.type === 'PRODUCTION_MOCK');
      if (severeSlop) {
        Logger.error(`🚨 [IndependentEvaluator] SLOP DETECTADO! ${antiSlopCheck.reason}`);

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

    // 2. Real objective verification execution
    const executedCommands: string[] = [];
    const stepsResults: Array<{ step: string; passed: boolean; detail: string }> = [];
    let overallPassed = true;
    let lastExitCode = 0;
    let combinedOutput = '';

    if (contract.verificationSteps && contract.verificationSteps.length > 0) {
      for (const step of contract.verificationSteps) {
        if (step.command) {
          executedCommands.push(step.command);
          try {
            Logger.info(`[IndependentEvaluator] Executando verificação objetiva: "${step.command}" em "${projectPath}"...`);
            const out = execSync(step.command, {
              cwd: projectPath,
              encoding: 'utf-8',
              timeout: 45000,
              stdio: 'pipe',
              shell: process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : '/bin/sh'
            });
            lastExitCode = 0;
            combinedOutput += `\n[${step.name} - OK]:\n${out.trim()}`;
            stepsResults.push({ step: step.name, passed: true, detail: 'Comando executado com código 0' });
          } catch (err: any) {
            overallPassed = false;
            lastExitCode = err.status || 1;
            const isTimeout = err.code === 'ETIMEDOUT' || err.signal === 'SIGTERM';
            const isBlocked = err.code === 'ENOENT' || (err.message && (err.message.includes('not recognized') || err.message.includes('não é reconhecido')));
            const errOut = (err.stdout || '') + (err.stderr || '') + (err.message || '');
            combinedOutput += `\n[${step.name} - FALHA (código ${lastExitCode}${isTimeout ? ' - TIMEOUT' : ''})]:\n${errOut.trim()}`;
            stepsResults.push({
              step: step.name,
              passed: false,
              detail: isTimeout ? 'TIMEOUT: Execução excedeu 45s' : (isBlocked ? 'BLOCKED: Comando ou ambiente inacessível' : `Código de saída: ${lastExitCode}`)
            });
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
        overallPassed = builderReport.filesChanged.length > 0 && builderReport.status === 'success';
        combinedOutput = overallPassed ? 'Arquivos modificados com sucesso no escopo.' : 'Nenhum arquivo alterado.';
      }
    }

    // 2.1 Additional Factual Checks for Visual and Persistence Requirements
    const mandatesVisual = /(interface|dashboard|html|web|frontend|tela|visual|página|pagina)/i.test(contractText);
    const mandatesPersistence = /(persist[eê]ncia|persistente|salvar em disco|armazenar|banco de dados|sqlite|arquivo json)/i.test(contractText);

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
        Logger.warn(`[IndependentEvaluator] Falha de Aceitação Visual: A tarefa requer interface visual, mas nenhum artefato HTML/UI web foi gerado.`);
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
        Logger.warn(`[IndependentEvaluator] Falha de Aceitação de Persistência: A tarefa requer persistência, mas nenhuma escrita em arquivo/banco foi encontrada.`);
      }
    }

    // 2.2 Substantive criteria fulfillment check:
    // Do not accept merely exit code 0 or touched files if acceptance criteria were completely unaddressed in code
    const missingEvidenceCriteria: string[] = [];
    if (!isAuditOrInvestigationTask && builderReport.filesChanged && builderReport.filesChanged.length > 0) {
      // Check if commands are dummy/trivial (e.g. process.exit(0) or echo)
      const hasOnlyTrivialVerification = (contract.verificationSteps || []).every(s =>
        !s.command || /^(node\s+-e\s+["']process\.exit\(0\)["']|exit\s+0|true|echo\b)/i.test(s.command.trim())
      );

      const implementedText = (builderReport.implemented || []).join(' ').toLowerCase();

      for (const criterion of contract.acceptanceCriteria) {
        // Skip generic catch-all or testing criteria
        if (/^(todos|código limpo|sem erros|testes passam|atender plenamente|must pass|pass|passar|teste|test|isolamento|valida[çc][aã]o|executar)/i.test(criterion.trim())) {
          continue;
        }

        const tokens = criterion
          .toLowerCase()
          .replace(/[^a-zA-Z0-9_\-\/]/g, ' ')
          .split(/\s+/)
          .filter(t => t.length > 3 && !['deve', 'para', 'como', 'estar', 'pelo', 'pela', 'sobre', 'mais', 'menos', 'quando', 'funcional', 'corretamente'].includes(t));

        if (tokens.length >= 2) {
          // Check filesChanged names or stems
          let tokenFound = builderReport.filesChanged.some(f => {
            const fLower = f.toLowerCase();
            return tokens.some(tok => fLower.includes(tok) || (tok.length > 4 && fLower.includes(tok.slice(0, 4))));
          });

          // Check files content on disk
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
                } catch {}
              }
            }
          }

          // Check combined test output
          if (!tokenFound && tokens.some(tok => combinedOutput.toLowerCase().includes(tok))) {
            tokenFound = true;
          }

          // Check builderReport.implemented descriptions
          if (!tokenFound && tokens.some(tok => implementedText.includes(tok) || (tok.length > 4 && implementedText.includes(tok.slice(0, 4))))) {
            tokenFound = true;
          }

          // Check visual or persistence validations if criterion relates to visual or persistence
          if (!tokenFound) {
            if (/visual|dashboard|html|ui/i.test(criterion) && visualCheckPassed) {
              tokenFound = true;
            } else if (/persist[eê]ncia|armazenar|salvar|banco/i.test(criterion) && persistenceCheckPassed) {
              tokenFound = true;
            }
          }

          // Only flag missing evidence if verification was trivial/mock AND no tokens were found anywhere
          if (!tokenFound && hasOnlyTrivialVerification) {
            missingEvidenceCriteria.push(`Critério sem evidência factual no código ou execução: "${criterion}"`);
          }
        }
      }
    }

    if (missingEvidenceCriteria.length > 0) {
      overallPassed = false;
      Logger.warn(`[IndependentEvaluator] Falso negativo evitado: Critérios sem evidência factual: ${missingEvidenceCriteria.join('; ')}`);
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
        if (isAuditOrInvestigationTask && hasSubstantiveAuditFindings) {
          verdict = 'PASS';
        } else {
          verdict = 'INCONCLUSIVE';
        }
      } else if (builderReport.status === 'success' && overallPassed) {
        verdict = 'PASS';
      } else {
        verdict = 'FAIL';
      }
    }

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
    if (!visualCheckPassed) {
      notes = 'Reprovado pelo Evaluator: Critério de interface visual/dashboard não atendido (nenhum artefato HTML ou UI web encontrado no projeto).';
      actual = 'Artefato visual HTML/UI ausente no projeto';
    } else if (!persistenceCheckPassed) {
      notes = 'Reprovado pelo Evaluator: Critério de persistência não atendido (nenhum mecanismo de escrita em disco ou banco encontrado).';
      actual = 'Persistência em disco/banco ausente no projeto';
    } else {
      switch (verdict) {
        case 'PASS':
          notes = 'Aprovado pelo Evaluator: Evidência objetiva comprovada via execução real dos testes no terminal com código 0.';
          actual = 'Todos os comandos executados com código 0 e critérios factuais atendidos';
          break;
        case 'TIMEOUT':
          notes = 'Reprovado pelo Evaluator (TIMEOUT): Comando de verificação excedeu o tempo limite no ambiente de teste.';
          actual = 'Timeout durante execução dos testes de verificação';
          break;
        case 'BLOCKED':
          notes = 'Reprovado pelo Evaluator (BLOCKED): Ambiente, diretório ou comandos pré-requisito inacessíveis.';
          actual = `Execução bloqueada por ambiente/pré-requisitos: código de saída ${lastExitCode}`;
          break;
        case 'INCONCLUSIVE':
          notes = 'Reprovado pelo Evaluator (INCONCLUSIVE): Sem evidências objetivas ou arquivos modificados para comprovar a entrega.';
          actual = 'Nenhum comando de teste configurado e nenhum arquivo alterado no escopo';
          break;
        case 'FAIL':
        default:
          notes = 'Reprovado pelo Evaluator (FAIL): Testes ou comandos de validação falharam no ambiente real.';
          actual = `Comando de verificação falhou com código ${lastExitCode}`;
          break;
      }
    }

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
        exitCode: lastExitCode,
        output: combinedOutput.trim().slice(0, 2000),
        durationMs: Date.now() - startTime,
        stepsResults,
        scopeValidation,
        dynamicRiskAssessment: options?.effortLevel === 'MINIMAL' ? undefined : this.assessDynamicRisk(projectPath, builderReport.filesChanged || [], executedCommands),
        adversarialValidation: options?.effortLevel === 'MINIMAL' ? undefined : this.validateAdversarialResilience(projectPath, builderReport.filesChanged || [], contract.acceptanceCriteria || []),
        antiSlop: antiSlopCheck,
        evidenceSummary: {
          codeDiffAvailable: (builderReport.filesChanged || []).length > 0,
          filesChangedCount: (builderReport.filesChanged || []).length,
          independentCommandExecuted: executedCommands.length > 0,
          independentCommandExitCode: lastExitCode,
          requirementsVerifiedCount: stepsResults.filter(s => s.passed).length,
          adversarialChecksPassed: true,
          antiSlopPassed: !antiSlopCheck?.hasSlop,
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

    const newContractStatus = result.verdict === 'PASS'
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
    } catch {}
  }

  static getContract(contractId: string): SuccessContract | null {
    const row: any = db.prepare('SELECT * FROM success_contracts WHERE id = ?').get(contractId);
    if (!row) return null;
    return this.mapContractRow(row);
  }

  static getContractByTaskId(taskId: string): SuccessContract | null {
    const row: any = db.prepare('SELECT * FROM success_contracts WHERE task_id = ? ORDER BY created_at DESC LIMIT 1').get(taskId);
    if (!row) return null;
    return this.mapContractRow(row);
  }

  static getEvaluationByTaskId(taskId: string): EvaluationResult | null {
    const row: any = db.prepare('SELECT * FROM evaluation_results WHERE task_id = ? ORDER BY created_at DESC LIMIT 1').get(taskId);
    if (!row) return null;
    return this.mapEvaluationRow(row);
  }

  static listContractsByProject(projectId: string): SuccessContract[] {
    const rows: any[] = db.prepare('SELECT * FROM success_contracts WHERE project_id = ? ORDER BY created_at DESC').all(projectId);
    return rows.map(r => this.mapContractRow(r));
  }

  private static mapContractRow(r: any): SuccessContract {
    return {
      id: r.id,
      taskId: r.task_id,
      runId: r.run_id || undefined,
      projectId: r.project_id,
      objective: r.objective,
      acceptanceCriteria: JSON.parse(r.acceptance_criteria_json || '[]'),
      verificationSteps: JSON.parse(r.verification_steps_json || '[]'),
      protectedEvaluationFiles: JSON.parse(r.protected_evaluation_files_json || '[]'),
      protectedFileHashes: JSON.parse(r.protected_file_hashes_json || '{}'),
      baseline: JSON.parse(r.baseline_json || '{}'),
      successThresholds: JSON.parse(r.success_thresholds_json || '[]'),
      failureConditions: JSON.parse(r.failure_conditions_json || '[]'),
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
      passedCriteria: JSON.parse(r.passed_criteria_json || '[]'),
      failedCriteria: JSON.parse(r.failed_criteria_json || '[]'),
      evidence: JSON.parse(r.evidence_json || '{}'),
      expected: r.expected,
      actual: r.actual,
      evaluatorNotes: r.evaluator_notes,
      evaluatorName: r.evaluator_name,
      executedCommands: JSON.parse(r.executed_commands_json || '[]'),
      exitCode: r.exit_code,
      durationMs: r.duration_ms,
      createdAt: r.created_at
    };
  }
}
