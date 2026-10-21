import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import {
  EphemeralWorktreeService,
  parseWorktreePorcelain
} from '../src/ephemeralWorktreeService.js';
import { AutonomousRunnerService } from '../src/autonomousRunnerService.js';
import { IndependentEvaluator } from '../src/independentEvaluator.js';

describe('FASE 4: EphemeralWorktreeService & Best-of-N Trajectories Concorrentes', () => {
  let tempRepoDir: string;

  before(() => {
    tempRepoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-worktree-test-'));

    // Initialize clean base git repo
    try {
      execSync('git init -b main', { cwd: tempRepoDir, stdio: 'ignore' });
      execSync('git config user.name "DecoHub Test"', { cwd: tempRepoDir, stdio: 'ignore' });
      execSync('git config user.email "test@decohub.local"', { cwd: tempRepoDir, stdio: 'ignore' });
    } catch {}

    // Initial files
    fs.mkdirSync(path.join(tempRepoDir, 'src'), { recursive: true });
    fs.mkdirSync(path.join(tempRepoDir, 'test'), { recursive: true });

    fs.writeFileSync(
      path.join(tempRepoDir, 'package.json'),
      JSON.stringify({ name: 'worktree-fixture', version: '1.0.0', scripts: { test: 'node --test' } }, null, 2)
    );

    fs.writeFileSync(
      path.join(tempRepoDir, 'src', 'service.js'),
      'exports.calculate = function(x) { return x * 2; };\n'
    );

    fs.writeFileSync(
      path.join(tempRepoDir, 'test', 'service.test.js'),
      `const { test } = require('node:test');\nconst assert = require('node:assert/strict');\nconst { calculate } = require('../src/service.js');\n\ntest('calculates correctly', () => {\n  assert.equal(calculate(5), 10);\n});\n`
    );

    try {
      execSync('git add -A && git commit -m "initial commit"', { cwd: tempRepoDir, stdio: 'ignore' });
    } catch {}
  });

  after(() => {
    delete AutonomousRunnerService.trajectoryRunnerHook;
    try {
      fs.rmSync(tempRepoDir, { recursive: true, force: true });
    } catch {}
  });

  it('1. parseWorktreePorcelain: Faz o parse de formato porcelain do git worktree', () => {
    const rawOutput = `worktree /path/to/main\nHEAD abc1234\nbranch refs/heads/main\n\nworktree /path/to/ephemeral\nHEAD def5678\nbranch refs/heads/ephemeral/task-1`;
    const parsed = parseWorktreePorcelain(rawOutput);
    assert.equal(parsed.length, 2);
    assert.equal(parsed[0].worktree, '/path/to/main');
    assert.equal(parsed[0].branch, 'refs/heads/main');
    assert.equal(parsed[1].worktree, '/path/to/ephemeral');
    assert.equal(parsed[1].branch, 'refs/heads/ephemeral/task-1');
  });

  it('2. createEphemeralWorktree & validateWorktreeSandbox: Cria e valida sandbox isolado com ponteiro .git válido', () => {
    const wt = EphemeralWorktreeService.createEphemeralWorktree({
      baseRepo: tempRepoDir,
      taskId: 'task-test-01',
      candidateLabel: 'candidate-A'
    });

    try {
      assert.ok(fs.existsSync(wt.worktreePath), 'Diretório do worktree deve existir');
      assert.ok(wt.branch.includes('candidate-a'), 'Branch deve conter slug do candidato');

      const status = EphemeralWorktreeService.validateWorktreeSandbox(wt.worktreePath);
      assert.equal(status.valid, true, 'Sandbox deve ser válido');
      assert.equal(status.dirExists, true);
      assert.equal(status.pointerValid, true);
      assert.equal(status.lockFree, true);

      // Checar se lista de worktrees inclui o novo sandbox
      const activeList = EphemeralWorktreeService.listEphemeralWorktrees(tempRepoDir);
      assert.ok(activeList.length >= 1, 'Deve listar o worktree efêmero criado');
    } finally {
      const res = EphemeralWorktreeService.removeWorktree(wt);
      assert.equal(res.pathRemoved, true, 'Caminho do worktree deve ter sido removido');
      assert.equal(res.branchDeleted, true, 'Branch temporário deve ter sido deletado');
    }
  });

  it('3. withEphemeralWorktree RAII: Executa ação isolada e garante limpeza estrita no finally', async () => {
    let capturedPath = '';
    const result = await EphemeralWorktreeService.withEphemeralWorktree(
      {
        baseRepo: tempRepoDir,
        taskId: 'task-raii',
        candidateLabel: 'candidate-raii'
      },
      async (sandbox) => {
        capturedPath = sandbox.worktreePath;
        assert.ok(fs.existsSync(capturedPath));
        return 'executed-in-sandbox';
      }
    );

    assert.equal(result, 'executed-in-sandbox');
    assert.ok(capturedPath.length > 0);
    assert.equal(fs.existsSync(capturedPath), false, 'Sandbox deve ter sido desfeito após término do RAII');
  });

  it('4. cleanStaleGitLocks: Detecta e remove locks obsoletos (>60s) preservando integridade', () => {
    const fakeLockFile = path.join(tempRepoDir, '.git', 'index.lock');
    fs.writeFileSync(fakeLockFile, 'lock-content');

    // Forçar mtime antigo (> 65s no passado)
    const oldTime = (Date.now() - 70000) / 1000;
    fs.utimesSync(fakeLockFile, oldTime, oldTime);

    assert.ok(fs.existsSync(fakeLockFile));
    EphemeralWorktreeService.cleanStaleGitLocks(tempRepoDir);
    assert.equal(fs.existsSync(fakeLockFile), false, 'Lock obsoleto deve ser unlinked');
  });

  it('5. calculateQualityGatesScore: Pontua com precisão os 4 portões de qualidade (Dev Tests, Visual/Anti-Slop, UX, AppSec)', () => {
    const mockPassingEval: any = {
      exitCode: 0,
      verdict: 'PASS',
      passedCriteria: ['Critério 1', 'Critério 2'],
      failedCriteria: [],
      evidence: {
        evidenceSummary: {
          antiSlopPassed: true,
          designQualityPassed: true,
          visualInspectionPassed: true,
          userJourneyPassed: true,
          securityPentestPassed: true,
          adversarialChecksPassed: true
        }
      }
    };

    const mockReport: any = {
      status: 'success',
      filesChanged: ['src/service.js']
    };

    const scorePassing = AutonomousRunnerService.calculateQualityGatesScore(mockPassingEval, mockReport);
    assert.equal(scorePassing.devTests, 10.0);
    assert.equal(scorePassing.visualAntiSlop, 10.0);
    assert.equal(scorePassing.uxJourney, 10.0);
    assert.equal(scorePassing.appSec, 10.0);
    assert.equal(scorePassing.simplicityBonus, 1.0); // <= 2 arquivos
    assert.equal(scorePassing.total, 11.0);

    const mockFailingEval: any = {
      exitCode: 1,
      verdict: 'FAIL',
      passedCriteria: [],
      failedCriteria: ['Critério falhou'],
      evidence: {
        evidenceSummary: {
          antiSlopPassed: false,
          designQualityPassed: false,
          userJourneyPassed: false,
          securityPentestPassed: false,
          adversarialChecksPassed: false
        }
      }
    };

    const scoreFailing = AutonomousRunnerService.calculateQualityGatesScore(mockFailingEval, { status: 'failure', filesChanged: ['a', 'b', 'c', 'd', 'e', 'f'] } as any);
    assert.ok(scoreFailing.total < scorePassing.total, 'Candidato com falhas deve ter nota significativamente inferior');
    assert.ok(scoreFailing.devTests < 5.0);
  });

  it('6. executeConcurrentRollout: Executa Best-of-N Rollout entre 2 candidatos em worktrees paralelos, elege vencedor e faz merge', async () => {
    // Definir hook de simulação de trajetórias para Candidate A e Candidate B
    AutonomousRunnerService.trajectoryRunnerHook = async ({ candidateLabel, worktreePath }) => {
      if (candidateLabel === 'candidate-A') {
        // Candidate A: Vencedor cirúrgico (Simplicity First)
        // Corrige a implementação em src/service.js para retornar x * 2 (sem alterar arquivos de teste protegidos)
        fs.writeFileSync(
          path.join(worktreePath, 'src', 'service.js'),
          'exports.calculate = function(x) { return x * 2; };\n'
        );
        return {
          status: 'success',
          filesChanged: ['src/service.js'],
          summary: 'Candidate A corrigiu a implementação de forma cirúrgica (x * 2).'
        };
      } else {
        // Candidate B: Solução com falha (retorna valor incorreto que falha a asserção)
        fs.writeFileSync(
          path.join(worktreePath, 'src', 'service.js'),
          'exports.calculate = function(x) { return x * 99; };\n'
        );
        return {
          status: 'success',
          filesChanged: ['src/service.js'],
          summary: 'Candidate B implementou com cálculo incorreto (x * 99).'
        };
      }
    };

    // Quebrar intencionalmente src/service.js no baseRepo para que Candidate A o conserte
    fs.writeFileSync(
      path.join(tempRepoDir, 'src', 'service.js'),
      'exports.calculate = function(x) { return 0; };\n'
    );
    try {
      execSync('git add src/service.js && git commit -m "break calculation for test"', { cwd: tempRepoDir, stdio: 'ignore' });
    } catch {}

    const mockProject = {
      id: 'proj-worktree-test',
      name: 'Worktree Test Project',
      path: tempRepoDir,
      objective: 'Validar Best-of-N Rollout'
    };

    const mockRun = {
      id: 'run-worktree-test',
      briefing: 'Testar motor de trajetórias concorrentes'
    };

    const mockTask = {
      id: 'task-high-complexity',
      title: 'Corrigir cálculo da função calculate',
      description: 'Garantir que calculate(5) retorne 10',
      retry_count: 0,
      expected_files: ['src/service.js'],
      verification_command: 'node --test test/service.test.js'
    };

    const mockEngineeringPackage = {
      adaptiveEffort: { effortLevel: 'HIGH', changeRisk: 'high' },
      taskContract: {
        acceptanceCriteria: ['O cálculo deve produzir x * 2'],
        verificationCommand: 'node --test test/service.test.js',
        doneWhen: 'Testes unitários aprovados com código 0'
      }
    };

    const contract = IndependentEvaluator.createSuccessContract({
      taskId: mockTask.id,
      runId: mockRun.id,
      projectId: mockProject.id,
      projectPath: tempRepoDir,
      objective: mockTask.title,
      acceptanceCriteria: mockEngineeringPackage.taskContract.acceptanceCriteria,
      verificationCommand: mockEngineeringPackage.taskContract.verificationCommand,
      protectedEvaluationFiles: ['test/service.test.js']
    });

    const rolloutRes = await AutonomousRunnerService.executeConcurrentRollout({
      project: mockProject,
      run: mockRun,
      task: mockTask,
      branchName: 'feat/best-of-n',
      worker: { id: 'worker-rollout-1', name: 'Rollout Worker' } as any,
      leaseId: 'lease-rollout-1',
      engineeringPackage: mockEngineeringPackage,
      contract
    });

    // Validar seleção de vencedor
    assert.ok(rolloutRes.reportData.implemented.some(i => i.includes('candidate-A')), 'Candidate A deve ser o vencedor');
    assert.equal(rolloutRes.evaluationResult.verdict, 'PASS', 'Vencedor deve ter obtido veredicto PASS no Evaluator');

    // Validar merge do código no repositório principal
    const mergedContent = fs.readFileSync(path.join(tempRepoDir, 'src', 'service.js'), 'utf8');
    assert.ok(mergedContent.includes('return x * 2;'), 'Código vencedor deve ter sido integrado no repositório principal');

    // Validar que os worktrees temporários foram removidos sem resíduos
    const remainingWorktrees = EphemeralWorktreeService.listEphemeralWorktrees(tempRepoDir);
    assert.equal(remainingWorktrees.length, 0, 'Nenhum worktree efêmero deve permanecer após o rollout');
  });
});
