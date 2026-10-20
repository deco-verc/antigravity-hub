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
    },
    options?: {
      expectedScopeFiles?: string[];
    }
  ): Promise<EvaluationResult> {
    const contract = this.getContract(contractId);
    if (!contract) {
      throw new Error(`SuccessContract #${contractId} não encontrado no banco de dados`);
    }

    const nowIso = new Date().toISOString();
    const startTime = Date.now();
    Logger.info(`[IndependentEvaluator] Iniciando avaliação independente da tarefa "${contract.objective}"...`);

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
      // Default: check if files were changed and no syntax error
      overallPassed = builderReport.filesChanged.length > 0 && builderReport.status === 'success';
      combinedOutput = overallPassed ? 'Arquivos modificados com sucesso no escopo.' : 'Nenhum arquivo alterado.';
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
      } else if (builderReport.status === 'success') {
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
      if (verdict === 'TIMEOUT') {
        failedCriteria.push('Comando de verificação excedeu o tempo limite (TIMEOUT)');
      } else if (verdict === 'BLOCKED') {
        failedCriteria.push('Ambiente de execução ou dependências inacessíveis (BLOCKED)');
      } else if (verdict === 'INCONCLUSIVE') {
        failedCriteria.push('Nenhum comando de teste configurado e nenhum arquivo alterado (INCONCLUSIVE)');
      } else {
        failedCriteria.push('Todos os testes e comandos de verificação automatizados devem passar com código 0');
      }
      for (const c of contract.acceptanceCriteria) {
        failedCriteria.push(c);
      }
    }

    let notes = '';
    let actual = '';
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
        scopeValidation
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
