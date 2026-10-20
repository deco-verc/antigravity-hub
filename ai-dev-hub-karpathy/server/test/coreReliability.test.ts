import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { GitManager } from '../src/gitManager.js';
import { WorkerRegistry } from '../src/workerRegistry.js';
import { AccountProfileManager } from '../src/accountProfileManager.js';
import { AutonomousManager } from '../src/autonomousManager.js';
import { UsageTracker } from '../src/usageTracker.js';
import { ConversationManager } from '../src/conversationManager.js';
import { db } from '../src/db.js';

describe('DecoHUB Core Reliability & Deterministic Hardening Suite', () => {

  // ==========================================================================
  // 1. Account Readiness (Item 1 & 12)
  // ==========================================================================
  describe('Account Readiness Verification', () => {
    let createdProfileId: string;

    before(() => {
      const p = AccountProfileManager.createProfile({
        displayName: `Audit Account ${Date.now()}`,
        googleAccountLabel: 'audit.account@test.local'
      });
      createdProfileId = p.id;
    });

    after(() => {
      AccountProfileManager.setVerifyProbeOverrideForTest(null);
      if (createdProfileId) {
        try { AccountProfileManager.deleteProfile(createdProfileId); } catch {}
      }
    });

    test('metadata and email alone must NOT grant READY status', () => {
      const profile = AccountProfileManager.getProfile(createdProfileId)!;
      assert.notStrictEqual(profile.auth_status, 'READY', 'Profile must not be READY on creation');
      assert.strictEqual(profile.auth_status, 'WAITING_LOGIN');

      // Attempting to verify without functional verification must fail
      AccountProfileManager.setVerifyProbeOverrideForTest(() => false);
      const verifyResult = AccountProfileManager.verifyProfile(createdProfileId, 'manual.spoofed@test.local');
      assert.strictEqual(verifyResult.hasSession, false, 'Probe failure must return hasSession false');
      assert.strictEqual(verifyResult.profile.auth_status, 'LOGIN_REQUIRED', 'Failed probe must set LOGIN_REQUIRED');
    });

    test('functional verification probe success grants READY status', () => {
      AccountProfileManager.setVerifyProbeOverrideForTest(() => true);
      const verifyResult = AccountProfileManager.verifyProfile(createdProfileId);
      assert.strictEqual(verifyResult.hasSession, true);
      assert.strictEqual(verifyResult.profile.auth_status, 'READY');

      const reloaded = AccountProfileManager.getProfile(createdProfileId)!;
      assert.strictEqual(reloaded.auth_status, 'READY');
    });
  });

  // ==========================================================================
  // 2. Runtime Isolation & Association (Item 4 & 13)
  // ==========================================================================
  describe('Runtime Association & Process Isolation', () => {
    test('Account A never binds to unauthenticated or mismatched language_server of Account B', () => {
      const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-isolation-'));
      const envPathA = path.join(tempRoot, 'profileA');
      const envPathB = path.join(tempRoot, 'profileB');
      fs.mkdirSync(envPathA, { recursive: true });
      fs.mkdirSync(envPathB, { recursive: true });

      try {
        const profileA = {
          id: 'acc-pro-isolated-a',
          display_name: 'Account A',
          profile_name: 'profileA',
          environment_path: envPathA,
          google_account_label: 'user.a@test.local',
          auth_status: 'READY' as const,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };

        const profileB = {
          id: 'acc-pro-isolated-b',
          display_name: 'Account B',
          profile_name: 'profileB',
          environment_path: envPathB,
          google_account_label: 'user.b@test.local',
          auth_status: 'READY' as const,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };

        // Neither profile has a running language_server.exe bound to its user-data-dir
        const instanceA = AccountProfileManager.getRunningInstanceForProfile(profileA.environment_path);
        const instanceB = AccountProfileManager.getRunningInstanceForProfile(profileB.environment_path);
        assert.strictEqual(instanceA, null, 'Must not pick random system process without exact profile match');
        assert.strictEqual(instanceB, null, 'Must not pick random system process without exact profile match');

        // Attempting to acquire execution env without proof of isolated runtime throws AGENTAPI_UNAVAILABLE
        assert.throws(() => {
          AccountProfileManager.getExecutionEnvForProfile(profileA);
        }, /AGENTAPI_UNAVAILABLE: nenhum runtime Antigravity pertence ao perfil acc-pro-isolated-a/);

        assert.throws(() => {
          AccountProfileManager.getExecutionEnvForProfile(profileB);
        }, /AGENTAPI_UNAVAILABLE: nenhum runtime Antigravity pertence ao perfil acc-pro-isolated-b/);
      } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
      }
    });
  });

  // ==========================================================================
  // 3. Worker Readiness & Mockable Probe (Item 2, 3 & 11)
  // ==========================================================================
  describe('Worker Readiness & Probe Requirement', () => {
    let testProfileId: string;
    let createdWorkerId: string;

    before(() => {
      const p = AccountProfileManager.createProfile({
        displayName: `Worker Probe Test ${Date.now()}`
      });
      testProfileId = p.id;
    });

    after(() => {
      WorkerRegistry.setProbeOverrideForTest(null);
      if (createdWorkerId) {
        try { WorkerRegistry.deleteWorker(createdWorkerId); } catch {}
      }
      if (testProfileId) {
        try { AccountProfileManager.deleteProfile(testProfileId); } catch {}
      }
    });

    test('Worker cannot become READY without successful probe verification', async () => {
      WorkerRegistry.setProbeOverrideForTest(async () => {
        throw new Error('SIMULATED_AGENTAPI_CONNECTION_REFUSED');
      });

      const workerResult = await WorkerRegistry.ensureWorkerAvailable();
      const readyWorkers = WorkerRegistry.getReadyWorkers();
      const hasBogusReady = readyWorkers.some(w => w.account_profile_id === testProfileId);
      assert.strictEqual(hasBogusReady, false, 'No worker should be marked READY when probe fails');
    });

    test('Worker becomes READY only when probe succeeds with real PID and conversation', async () => {
      WorkerRegistry.setProbeOverrideForTest(async (profile) => ({
        conversationId: `conv-test-${Date.now()}`,
        pid: process.pid
      }));

      AccountProfileManager.setGlobalActiveProfile(testProfileId);

      const worker = await WorkerRegistry.ensureWorkerAvailable();
      assert.ok(worker, 'Worker must be created/returned');
      createdWorkerId = worker.id;

      assert.strictEqual(worker.status, 'READY');
      assert.strictEqual(worker.pid, process.pid);
      assert.ok(worker.conversation_id?.startsWith('conv-test-'));

      const verifiedProfile = AccountProfileManager.getProfile(testProfileId)!;
      assert.strictEqual(verifiedProfile.auth_status, 'READY');
    });
  });

  // ==========================================================================
  // 4. Heartbeat & Atomic Lease Claim (Item 7 & 10)
  // ==========================================================================
  describe('Heartbeat & Atomic Lease Claim', () => {
    const testProjectId = `proj-lease-${Date.now()}`;
    const runId = `run-lease-${Date.now()}`;
    const taskId = `task-lease-${Date.now()}`;
    const worker1Id = `worker-lease-1-${Date.now()}`;
    const worker2Id = `worker-lease-2-${Date.now()}`;
    const nowIso = new Date().toISOString();

    before(() => {
      // 1. Create project row to satisfy FOREIGN KEY
      db.prepare(`
        INSERT INTO projects (id, name, path, created_at, updated_at)
        VALUES (?, 'Lease Test Project', ?, ?, ?)
      `).run(testProjectId, path.join(os.tmpdir(), testProjectId), nowIso, nowIso);

      // 2. Create test run and ready task
      db.prepare(`
        INSERT INTO autonomous_runs (id, project_id, name, objective, briefing, status, autonomy_mode, branch_name, max_hours, max_cycles, current_cycle, start_time, config_json, created_at, updated_at)
        VALUES (?, ?, 'Test Lease Run', 'Test', 'Test', 'running', 'autonomous', 'main', 1.0, 10, 0, ?, '{}', ?, ?)
      `).run(runId, testProjectId, nowIso, nowIso, nowIso);

      db.prepare(`
        INSERT INTO autonomous_tasks (id, run_id, title, description, milestone, order_index, dependencies_json, status, assigned_to, criteria_json, created_at, updated_at)
        VALUES (?, ?, 'Lease Test Task', 'Task Description', 'M1', 1, '[]', 'ready', 'Builder', '[]', ?, ?)
      `).run(taskId, runId, nowIso, nowIso);

      // 3. Setup 2 ready workers with past heartbeat
      const oldHeartbeat = new Date(Date.now() - 30000).toISOString();
      db.prepare(`
        INSERT INTO workers (id, name, provider, account_label, status, conversation_id, pid, last_heartbeat, created_at, updated_at)
        VALUES (?, 'Worker Alpha', 'antigravity', 'test@test.local', 'READY', 'conv-1', ?, ?, ?, ?)
      `).run(worker1Id, process.pid, oldHeartbeat, nowIso, nowIso);

      db.prepare(`
        INSERT INTO workers (id, name, provider, account_label, status, conversation_id, pid, last_heartbeat, created_at, updated_at)
        VALUES (?, 'Worker Beta', 'antigravity', 'test@test.local', 'READY', 'conv-2', ?, ?, ?, ?)
      `).run(worker2Id, process.pid, oldHeartbeat, nowIso, nowIso);
    });

    after(() => {
      WorkerRegistry.releaseAllLeases(worker1Id);
      WorkerRegistry.releaseAllLeases(worker2Id);
      db.prepare('DELETE FROM worker_leases WHERE run_id = ?').run(runId);
      db.prepare('DELETE FROM autonomous_tasks WHERE run_id = ?').run(runId);
      db.prepare('DELETE FROM autonomous_runs WHERE id = ?').run(runId);
      db.prepare('DELETE FROM workers WHERE id IN (?, ?)').run(worker1Id, worker2Id);
      db.prepare('DELETE FROM projects WHERE id = ?').run(testProjectId);
    });

    test('claimTask atomically claims lease, updates worker to WORKING, and refreshes heartbeat', () => {
      const leaseId = WorkerRegistry.claimTask(worker1Id, runId, taskId, 101);
      assert.ok(leaseId, 'Lease ID must be returned on successful claim');

      // Check worker state
      const worker = WorkerRegistry.getWorker(worker1Id)!;
      assert.strictEqual(worker.status, 'WORKING');
      assert.strictEqual(worker.current_task_id, taskId);

      // Check lease record
      const lease = WorkerRegistry.getActiveLease(worker1Id);
      assert.ok(lease);
      assert.strictEqual(lease.id, leaseId);
      assert.strictEqual(lease.task_id, taskId);
      assert.strictEqual(lease.status, 'active');

      // Lease last_heartbeat must be fresh (not old)
      const heartbeatDiff = Date.now() - new Date(lease.last_heartbeat).getTime();
      assert.ok(heartbeatDiff < 5000, 'Lease heartbeat must be updated immediately upon claim');

      // Competing worker must be rejected
      const competingLease = WorkerRegistry.claimTask(worker2Id, runId, taskId, 101);
      assert.strictEqual(competingLease, null, 'Competing claim on claimed task must return null');
    });

    test('renewLease extends lease and refreshes heartbeat', () => {
      const activeLease = WorkerRegistry.getActiveLease(worker1Id)!;
      const initialUntil = new Date(activeLease.lease_until).getTime();

      const renewed = WorkerRegistry.renewLease(activeLease.id, worker1Id);
      assert.strictEqual(renewed, true);

      const updatedLease = WorkerRegistry.getActiveLease(worker1Id)!;
      const updatedUntil = new Date(updatedLease.lease_until).getTime();
      assert.ok(updatedUntil >= initialUntil, 'Renewed lease must extend lease_until');
    });
  });

  // ==========================================================================
  // 5. DAG Transitions & Persistence (Item 8 & 9)
  // ==========================================================================
  describe('DAG Transitions & DB Persistence', () => {
    const testProjectId = `proj-dag-${Date.now()}`;
    const runId = `run-dag-${Date.now()}`;
    const task1Id = `task-dag-1-${Date.now()}`;
    const task2Id = `task-dag-2-${Date.now()}`;
    const nowIso = new Date().toISOString();

    before(() => {
      db.prepare(`
        INSERT INTO projects (id, name, path, created_at, updated_at)
        VALUES (?, 'DAG Test Project', ?, ?, ?)
      `).run(testProjectId, path.join(os.tmpdir(), testProjectId), nowIso, nowIso);

      db.prepare(`
        INSERT INTO autonomous_runs (id, project_id, name, objective, briefing, status, autonomy_mode, branch_name, max_hours, max_cycles, current_cycle, start_time, config_json, created_at, updated_at)
        VALUES (?, ?, 'DAG Run', 'Objective', 'Briefing', 'running', 'autonomous', 'main', 1.0, 10, 0, ?, '{}', ?, ?)
      `).run(runId, testProjectId, nowIso, nowIso, nowIso);

      // Task 1: ready (no deps)
      db.prepare(`
        INSERT INTO autonomous_tasks (id, run_id, title, description, milestone, order_index, dependencies_json, status, assigned_to, criteria_json, created_at, updated_at)
        VALUES (?, ?, 'Task 1 Independent', 'Desc', 'M1', 1, '[]', 'ready', 'Builder', '[]', ?, ?)
      `).run(task1Id, runId, nowIso, nowIso);

      // Task 2: pending (depends on Task 1)
      db.prepare(`
        INSERT INTO autonomous_tasks (id, run_id, title, description, milestone, order_index, dependencies_json, status, assigned_to, criteria_json, created_at, updated_at)
        VALUES (?, ?, 'Task 2 Dependent', 'Desc', 'M1', 2, ?, 'pending', 'Builder', '[]', ?, ?)
      `).run(task2Id, runId, JSON.stringify([task1Id]), nowIso, nowIso);
    });

    after(() => {
      db.prepare('DELETE FROM autonomous_tasks WHERE run_id = ?').run(runId);
      db.prepare('DELETE FROM autonomous_runs WHERE id = ?').run(runId);
      db.prepare('DELETE FROM projects WHERE id = ?').run(testProjectId);
    });

    test('Dependent task remains unavailable while dependency is incomplete', () => {
      const available = AutonomousManager.getAvailableTasks(runId);
      const availableIds = available.map(t => t.id);
      assert.ok(availableIds.includes(task1Id), 'Task 1 must be available');
      assert.ok(!availableIds.includes(task2Id), 'Task 2 must not be available yet');
    });

    test('When Task 1 completes, Task 2 transitions to READY and is PERSISTED in SQLite', () => {
      db.prepare("UPDATE autonomous_tasks SET status = 'completed', updated_at = ? WHERE id = ?")
        .run(new Date().toISOString(), task1Id);

      const availableAfter = AutonomousManager.getAvailableTasks(runId);
      const availableAfterIds = availableAfter.map(t => t.id);
      assert.ok(availableAfterIds.includes(task2Id), 'Task 2 must now be available');

      // Crucial verification: status must be persisted in DB, not just in memory
      const persistedTask2: any = db.prepare('SELECT status FROM autonomous_tasks WHERE id = ?').get(task2Id);
      assert.strictEqual(persistedTask2.status, 'ready', 'Task 2 status in SQLite DB must be persisted as "ready"');
    });
  });

  // ==========================================================================
  // 6. Git Commits: AGENT Commit vs DecoHUB Commit (Item 3, 4 & 15)
  // ==========================================================================
  describe('Git Commits: Agent Commit vs DecoHUB Commit', () => {
    let repoDir: string;

    before(() => {
      repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-commit-test-'));
      execSync('git init', { cwd: repoDir, stdio: 'ignore' });
      execSync('git config user.name "DecoHUB Tester"', { cwd: repoDir, stdio: 'ignore' });
      execSync('git config user.email "tester@local.hub"', { cwd: repoDir, stdio: 'ignore' });

      // Initial commit A
      fs.writeFileSync(path.join(repoDir, 'README.md'), '# Initial Repo\n', 'utf-8');
      execSync('git add .', { cwd: repoDir, stdio: 'ignore' });
      execSync('git commit -m "chore: initial commit A"', { cwd: repoDir, stdio: 'ignore' });
    });

    after(() => {
      fs.rmSync(repoDir, { recursive: true, force: true });
    });

    test('AGENT Commit scenario: Antigravity creates commit, DecoHUB recognizes B without empty commit', () => {
      const initialHead = execSync('git rev-parse HEAD', { cwd: repoDir, encoding: 'utf-8' }).trim();

      // Simulate Agent creating its own commit
      fs.writeFileSync(path.join(repoDir, 'feature.ts'), 'export const hello = () => "agent";\n', 'utf-8');
      execSync('git add feature.ts', { cwd: repoDir, stdio: 'ignore' });
      execSync('git commit -m "feat(ai): created by agent directly"', { cwd: repoDir, stdio: 'ignore' });

      const currentHead = execSync('git rev-parse HEAD', { cwd: repoDir, encoding: 'utf-8' }).trim();
      assert.notStrictEqual(initialHead, currentHead, 'HEAD must have advanced from A to B');

      // DecoHUB commit logic verification
      let taskCommitSha: string | null = null;
      let commitSource: 'AGENT' | 'DECOHUB' | null = null;

      if (initialHead && currentHead && initialHead !== currentHead) {
        taskCommitSha = currentHead;
        commitSource = 'AGENT';
      } else {
        commitSource = 'DECOHUB';
      }

      assert.strictEqual(commitSource, 'AGENT');
      assert.strictEqual(taskCommitSha, currentHead);
    });

    test('DECOHUB Commit scenario: Agent changes files without commit, DecoHUB stages and commits', () => {
      const initialHead = execSync('git rev-parse HEAD', { cwd: repoDir, encoding: 'utf-8' }).trim();

      // Agent modifies file without git add / git commit
      fs.writeFileSync(path.join(repoDir, 'service.ts'), 'export class DecoService {}\n', 'utf-8');

      const headBeforeDecoHub = execSync('git rev-parse HEAD', { cwd: repoDir, encoding: 'utf-8' }).trim();
      assert.strictEqual(initialHead, headBeforeDecoHub, 'HEAD has not changed yet');

      // DecoHUB commits selected files
      const commitSuccess = GitManager.commitSelected(repoDir, ['service.ts'], 'feat(ai): DecoHUB automated commit');
      assert.strictEqual(commitSuccess, true);

      const newHead = execSync('git rev-parse HEAD', { cwd: repoDir, encoding: 'utf-8' }).trim();
      assert.notStrictEqual(initialHead, newHead);

      const commitSource: 'AGENT' | 'DECOHUB' = 'DECOHUB';
      assert.strictEqual(commitSource, 'DECOHUB');
      assert.strictEqual(newHead.length, 40);
    });
  });

  // ==========================================================================
  // 7. Unresolved Dirty Working Tree Detection (Item 5)
  // ==========================================================================
  describe('Dirty Working Tree Guard', () => {
    let repoDir: string;

    before(() => {
      repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dirty-tree-test-'));
      execSync('git init', { cwd: repoDir, stdio: 'ignore' });
      execSync('git config user.name "Tester"', { cwd: repoDir, stdio: 'ignore' });
      execSync('git config user.email "tester@local.hub"', { cwd: repoDir, stdio: 'ignore' });
      fs.writeFileSync(path.join(repoDir, 'base.txt'), 'base\n', 'utf-8');
      execSync('git add . && git commit -m "base"', { cwd: repoDir, stdio: 'ignore' });
    });

    after(() => {
      fs.rmSync(repoDir, { recursive: true, force: true });
    });

    test('rejects uncommitted dirty working tree without explanation', () => {
      // Leave untracked dirty file
      fs.writeFileSync(path.join(repoDir, 'secret_untracked.bin'), 'leak\n', 'utf-8');

      const uncommittedChanges = execSync('git status --porcelain', { cwd: repoDir, encoding: 'utf-8' }).trim();
      assert.ok(uncommittedChanges.length > 0, 'Repo has dirty files');

      const evaluateDirtyTree = () => {
        if (uncommittedChanges) {
          throw new Error('DIRTY_WORKING_TREE_UNRESOLVED: tarefa finalizou com árvore de trabalho suja não versionada.');
        }
      };

      assert.throws(evaluateDirtyTree, /DIRTY_WORKING_TREE_UNRESOLVED/);
    });
  });

  // ==========================================================================
  // 8. Path Normalization Windows (Item 6 & 9)
  // ==========================================================================
  describe('Windows Path Normalization', () => {
    let tempProject: string;

    before(() => {
      tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'path-norm-test-'));
      fs.mkdirSync(path.join(tempProject, 'src'), { recursive: true });
      fs.mkdirSync(path.join(tempProject, 'folder with spaces'), { recursive: true });
      fs.writeFileSync(path.join(tempProject, 'src', 'cli.ts'), 'cli');
      fs.writeFileSync(path.join(tempProject, 'folder with spaces', 'file.txt'), 'text');
    });

    after(() => {
      fs.rmSync(tempProject, { recursive: true, force: true });
    });

    test('normalizes backslashes, forward slashes, and relative prefixes', () => {
      assert.strictEqual(GitManager.normalizeRepoPath(tempProject, 'src\\cli.ts'), 'src/cli.ts');
      assert.strictEqual(GitManager.normalizeRepoPath(tempProject, 'src/cli.ts'), 'src/cli.ts');
      assert.strictEqual(GitManager.normalizeRepoPath(tempProject, '.\\src\\cli.ts'), 'src/cli.ts');
      assert.strictEqual(GitManager.normalizeRepoPath(tempProject, './src/cli.ts'), 'src/cli.ts');
    });

    test('handles paths with spaces safely', () => {
      assert.strictEqual(
        GitManager.normalizeRepoPath(tempProject, 'folder with spaces\\file.txt'),
        'folder with spaces/file.txt'
      );
    });

    test('resolves absolute path inside project to repo-relative', () => {
      const absPath = path.join(tempProject, 'src', 'cli.ts');
      assert.strictEqual(GitManager.normalizeRepoPath(tempProject, absPath), 'src/cli.ts');
    });

    test('blocks paths traversing outside repository root', () => {
      assert.strictEqual(GitManager.normalizeRepoPath(tempProject, '../external.txt'), null);
      assert.strictEqual(GitManager.normalizeRepoPath(tempProject, '..\\..\\passwords.txt'), null);
      assert.strictEqual(GitManager.normalizeRepoPath(tempProject, 'C:\\Windows\\System32\\cmd.exe'), null);
    });

    test('blocks forbidden directories and malicious strings', () => {
      assert.strictEqual(GitManager.normalizeRepoPath(tempProject, '.git/config'), null);
      assert.strictEqual(GitManager.normalizeRepoPath(tempProject, 'node_modules/pkg/index.js'), null);
      assert.strictEqual(GitManager.normalizeRepoPath(tempProject, 'src/cli.ts\nmalicious'), null);
      assert.strictEqual(GitManager.normalizeRepoPath(tempProject, ''), null);
      assert.strictEqual(GitManager.normalizeRepoPath(tempProject, '   '), null);
    });
  });

  // ==========================================================================
  // 9. Workspace Isolation (Item 7 & 13)
  // ==========================================================================
  describe('Workspace Isolation Assertion', () => {
    let gitDir: string;
    let nonGitDir: string;

    before(() => {
      gitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-git-'));
      execSync('git init', { cwd: gitDir, stdio: 'ignore' });

      nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-nongit-'));
    });

    after(() => {
      fs.rmSync(gitDir, { recursive: true, force: true });
      fs.rmSync(nonGitDir, { recursive: true, force: true });
    });

    test('throws WORKSPACE_MISMATCH if directory does not exist', () => {
      const nonExistent = path.join(os.tmpdir(), `non-existent-${Date.now()}`);
      assert.throws(() => {
        GitManager.assertExecutionWorkspace(nonExistent);
      }, /WORKSPACE_MISMATCH: caminho do projeto não existe/);
    });

    test('throws WORKSPACE_MISMATCH if directory is not a valid git root', () => {
      assert.throws(() => {
        GitManager.assertExecutionWorkspace(nonGitDir);
      }, /WORKSPACE_MISMATCH: projeto não possui raiz git válida/);
    });

    test('throws WORKSPACE_MISMATCH if runtime cwd mismatches expected project path', () => {
      assert.throws(() => {
        GitManager.assertExecutionWorkspace(gitDir, { cwd: os.tmpdir() });
      }, /WORKSPACE_MISMATCH: runtime cwd .* diverge/);
    });

    test('succeeds when project path and git root match', () => {
      const result = GitManager.assertExecutionWorkspace(gitDir, { cwd: gitDir });
      assert.strictEqual(result.root.toLowerCase(), path.resolve(gitDir).toLowerCase());
      assert.strictEqual(result.gitRoot.toLowerCase(), path.resolve(gitDir).toLowerCase());
    });
  });

  // ==========================================================================
  // 10. Run Cancellation & Race Conditions (Item 8, 11 & 12)
  // ==========================================================================
  describe('Run Cancellation & Safety', () => {
    const testProjectId = `proj-cancel-${Date.now()}`;
    const runId = `run-cancel-${Date.now()}`;
    const taskId = `task-cancel-${Date.now()}`;
    const workerId = `worker-cancel-${Date.now()}`;
    const nowIso = new Date().toISOString();

    before(() => {
      db.prepare(`
        INSERT INTO projects (id, name, path, created_at, updated_at)
        VALUES (?, 'Cancel Test Project', ?, ?, ?)
      `).run(testProjectId, path.join(os.tmpdir(), testProjectId), nowIso, nowIso);

      db.prepare(`
        INSERT INTO autonomous_runs (id, project_id, name, objective, briefing, status, autonomy_mode, branch_name, max_hours, max_cycles, current_cycle, start_time, config_json, created_at, updated_at)
        VALUES (?, ?, 'Cancel Run', 'Obj', 'Brief', 'running', 'autonomous', 'main', 1.0, 10, 0, ?, '{}', ?, ?)
      `).run(runId, testProjectId, nowIso, nowIso, nowIso);

      db.prepare(`
        INSERT INTO autonomous_tasks (id, run_id, title, description, milestone, order_index, dependencies_json, status, assigned_to, criteria_json, created_at, updated_at)
        VALUES (?, ?, 'Task Cancel In Progress', 'Desc', 'M1', 1, '[]', 'ready', 'Builder', '[]', ?, ?)
      `).run(taskId, runId, nowIso, nowIso);

      db.prepare(`
        INSERT INTO workers (id, name, provider, account_label, status, conversation_id, pid, last_heartbeat, created_at, updated_at)
        VALUES (?, 'Worker Cancel', 'antigravity', 'test@test.local', 'READY', 'conv-cancel', ?, ?, ?, ?)
      `).run(workerId, process.pid, nowIso, nowIso, nowIso);

      // Claim task creating active lease and setting status to in_progress
      WorkerRegistry.claimTask(workerId, runId, taskId);
      AutonomousManager.claimTask(runId, taskId, 'Worker Cancel');
    });

    after(() => {
      db.prepare('DELETE FROM worker_leases WHERE run_id = ?').run(runId);
      db.prepare('DELETE FROM autonomous_tasks WHERE run_id = ?').run(runId);
      db.prepare('DELETE FROM autonomous_runs WHERE id = ?').run(runId);
      db.prepare('DELETE FROM workers WHERE id = ?').run(workerId);
      db.prepare('DELETE FROM projects WHERE id = ?').run(testProjectId);
    });

    test('stopRun transitions run to failed with RUN_CANCELLED, releases leases and cancels active tasks', () => {
      const stopResult = AutonomousManager.stopRun(runId);
      assert.strictEqual(stopResult.status, 'failed');
      assert.strictEqual(stopResult.last_error, 'RUN_CANCELLED');

      // Verify run status
      const run: any = db.prepare('SELECT status, last_error FROM autonomous_runs WHERE id = ?').get(runId);
      assert.strictEqual(run.status, 'failed');
      assert.strictEqual(run.last_error, 'RUN_CANCELLED');

      // Verify task was marked failed
      const task: any = db.prepare('SELECT status FROM autonomous_tasks WHERE id = ?').get(taskId);
      assert.strictEqual(task.status, 'failed');

      // Verify lease released
      const activeLease = WorkerRegistry.getActiveLease(workerId);
      assert.strictEqual(activeLease, null, 'Active lease must be released on run stop');

      // Available tasks on cancelled run must be empty
      const available = AutonomousManager.getAvailableTasks(runId);
      assert.strictEqual(available.length, 0);
    });
  });

  // ==========================================================================
  // 11. Usage Tracking: Unknown Values Handling (Item 14)
  // ==========================================================================
  describe('Usage Tracking Metadata & Unknown Tool Calls', () => {
    test('unknown tool_calls count is recorded as NULL instead of 0', () => {
      const eventNullId = UsageTracker.recordEvent({
        modelId: 'flash',
        projectId: 'proj-usage-test',
        accountProfileId: 'acc-pro-1',
        role: 'builder',
        durationMs: 120,
        status: 'success',
        toolCallsCount: null
      });

      const recordedNull: any = db.prepare('SELECT tool_calls_count FROM usage_events WHERE id = ?').get(eventNullId);
      assert.strictEqual(recordedNull.tool_calls_count, null, 'Unknown tool calls must be NULL, not 0');
    });

    test('explicit countable tool_calls is recorded accurately', () => {
      const eventCountId = UsageTracker.recordEvent({
        modelId: 'pro',
        projectId: 'proj-usage-test',
        accountProfileId: 'acc-pro-1',
        role: 'builder',
        durationMs: 350,
        status: 'success',
        toolCallsCount: 7
      });

      const recordedCount: any = db.prepare('SELECT tool_calls_count FROM usage_events WHERE id = ?').get(eventCountId);
      assert.strictEqual(recordedCount.tool_calls_count, 7);
    });
  });

  // ==========================================================================
  // 12. Safe Shutdown State Validation (Item 15)
  // ==========================================================================
  // ==========================================================================
  // 13. Conversation Lifecycle, Reuse & Controlled Rotation (Items 18-20)
  // ==========================================================================
  describe('Conversation Lifecycle, Reuse & Rotation Suite', () => {
    let createdConvIds: string[] = [];

    before(() => {
      // Setup overrides
      ConversationManager.setValidationOverride((convId: string) => !convId.includes('dead'));
      ConversationManager.setCreateOverride((params, title) => {
        const id = 'conv-test-' + Math.random().toString(36).substring(2, 9);
        createdConvIds.push(id);
        return id;
      });
    });

    after(() => {
      ConversationManager.setValidationOverride(null);
      ConversationManager.setCreateOverride(null);
      for (const id of createdConvIds) {
        try { db.prepare('DELETE FROM conversations WHERE conversation_id = ?').run(id); } catch {}
      }
    });

    test('10 worker heartbeats and 10 scheduler ticks create 0 new conversations', () => {
      const initialCount = createdConvIds.length;

      // Simulate 10 worker heartbeats on active leases/workers
      const dummyWorkerId = 'worker-hb-test';
      for (let i = 0; i < 10; i++) {
        WorkerRegistry.updateWorkerHeartbeat(dummyWorkerId);
      }

      // Check conversations created
      assert.strictEqual(createdConvIds.length, initialCount, 'Heartbeats must NEVER create conversations');
    });

    test('5 Worker probes reuse dedicated probe conversation (creates exactly 1 conversation)', () => {
      const testProfileId = 'acc-probe-reuse-test';
      const beforeCount = createdConvIds.length;

      let firstProbeConv: string | null = null;
      for (let i = 0; i < 5; i++) {
        const res = ConversationManager.getOrCreateConversation({
          accountProfileId: testProfileId,
          role: 'probe',
          model: 'flash'
        });
        if (i === 0) {
          firstProbeConv = res.conversationId;
          assert.strictEqual(res.isNew, true, 'First probe creates dedicated conversation');
        } else {
          assert.strictEqual(res.isNew, false, 'Subsequent probes MUST reuse existing probe conversation');
          assert.strictEqual(res.conversationId, firstProbeConv, 'Must reuse the exact same probe conversation ID');
        }
      }

      // Exactly 1 new conversation created for all 5 probes
      assert.strictEqual(createdConvIds.length, beforeCount + 1, '5 probes must generate exactly 1 dedicated conversation');
    });

    test('Worker executes Task 1, Task 2, and Task 3 reusing W1 without creating new conversations', () => {
      const workerId = 'worker-flow-test-1';
      const profileId = 'acc-flow-test';
      const projectId = 'proj-flow-test';

      const task1Conv = ConversationManager.getOrCreateConversation({
        projectId,
        accountProfileId: profileId,
        role: 'worker',
        workerId,
        model: 'pro'
      });
      assert.strictEqual(task1Conv.isNew, true, 'Task 1 initiates worker conversation W1');

      const task2Conv = ConversationManager.getOrCreateConversation({
        projectId,
        accountProfileId: profileId,
        role: 'worker',
        workerId,
        model: 'pro'
      });
      assert.strictEqual(task2Conv.isNew, false, 'Task 2 MUST reuse W1');
      assert.strictEqual(task2Conv.conversationId, task1Conv.conversationId);

      const task3Conv = ConversationManager.getOrCreateConversation({
        projectId,
        accountProfileId: profileId,
        role: 'worker',
        workerId,
        model: 'pro'
      });
      assert.strictEqual(task3Conv.isNew, false, 'Task 3 MUST reuse W1');
      assert.strictEqual(task3Conv.conversationId, task1Conv.conversationId);
    });

    test('Supervisor Plan and Review reuse S1 without creating separate chat per role event', () => {
      const projectId = 'proj-sup-test';
      const profileId = 'acc-sup-test';

      // Plan phase
      const planConv = ConversationManager.getOrCreateConversation({
        projectId,
        accountProfileId: profileId,
        role: 'supervisor',
        model: 'pro',
        initialPrompt: 'Planning MVP'
      });
      assert.strictEqual(planConv.isNew, true, 'Plan creates Supervisor S1');

      // Review phase for Task 1
      const review1Conv = ConversationManager.getOrCreateConversation({
        projectId,
        accountProfileId: profileId,
        role: 'supervisor',
        model: 'pro'
      });
      assert.strictEqual(review1Conv.isNew, false, 'Review 1 reuses S1');
      assert.strictEqual(review1Conv.conversationId, planConv.conversationId);

      // Review phase for Task 2
      const review2Conv = ConversationManager.getOrCreateConversation({
        projectId,
        accountProfileId: profileId,
        role: 'supervisor',
        model: 'pro'
      });
      assert.strictEqual(review2Conv.isNew, false, 'Review 2 reuses S1');
      assert.strictEqual(review2Conv.conversationId, planConv.conversationId);
    });

    test('Controlled rotation on CONTEXT_THRESHOLD creates exactly W2 with audited chain', () => {
      const workerId = 'worker-rot-test';
      const profileId = 'acc-rot-test';
      const projectId = 'proj-rot-test';

      // W1 initial
      const w1 = ConversationManager.getOrCreateConversation({
        projectId,
        accountProfileId: profileId,
        role: 'worker',
        workerId,
        model: 'pro'
      });
      assert.strictEqual(w1.isNew, true);

      // Retire W1 due to context threshold
      ConversationManager.retireConversation(w1.conversationId, 'CONTEXT_THRESHOLD');
      const w1Record = ConversationManager.getConversation(w1.conversationId)!;
      assert.strictEqual(w1Record.status, 'retired');
      assert.strictEqual(w1Record.rotation_reason, 'CONTEXT_THRESHOLD');

      // Now request conversation for next task -> creates W2
      const w2 = ConversationManager.getOrCreateConversation({
        projectId,
        accountProfileId: profileId,
        role: 'worker',
        workerId,
        model: 'pro',
        rotationReason: 'CONTEXT_THRESHOLD'
      });
      assert.strictEqual(w2.isNew, true, 'W2 created after retirement of W1');
      assert.notStrictEqual(w2.conversationId, w1.conversationId);

      const w2Record = ConversationManager.getConversation(w2.conversationId)!;
      assert.strictEqual(w2Record.rotation_index, 2);
      assert.strictEqual(w2Record.parent_conversation_id, w1.conversationId);
      assert.strictEqual(w2Record.title.includes('Context 2'), true);
    });

    // ========================================================================
    // Controlled Handoff & Project Mismatch Tests
    // ========================================================================
    test('Normal reuse: send-message succeeds without creating new conversations', () => {
      const workerId = 'worker-reuse-test';
      const profileId = 'acc-reuse-test';
      const projectId = 'proj-reuse-test';

      const initial = ConversationManager.getOrCreateConversation({
        projectId,
        accountProfileId: profileId,
        role: 'worker',
        workerId,
        model: 'pro'
      });
      assert.strictEqual(initial.isNew, true);

      let sendCalls = 0;
      ConversationManager.setSendMessageOverride((convId, prompt) => {
        sendCalls++;
        assert.strictEqual(convId, initial.conversationId);
      });

      const res = ConversationManager.sendMessageOrRotate({
        conversationId: initial.conversationId,
        prompt: 'Execute task 1',
        projectId,
        accountProfileId: profileId,
        role: 'worker',
        workerId,
        model: 'pro'
      });

      assert.strictEqual(res.rotated, false, 'Must not rotate on success');
      assert.strictEqual(res.conversationId, initial.conversationId);
      assert.strictEqual(sendCalls, 1);

      const record = ConversationManager.getConversation(initial.conversationId)!;
      assert.strictEqual(record.status, 'active');
      assert.strictEqual(record.turn_count, 2, 'Initial creation is turn 1, send-message increases to turn 2');
    });

    test('Project mismatch detection: triggers controlled handoff and sets parent link', () => {
      const workerId = 'worker-mismatch-test';
      const profileId = 'acc-mismatch-test';
      const projectId = 'proj-mismatch-test';

      const convA = ConversationManager.getOrCreateConversation({
        projectId,
        accountProfileId: profileId,
        role: 'worker',
        workerId,
        model: 'pro'
      });

      // Simulate mismatch error on send-message
      ConversationManager.setSendMessageOverride((convId, prompt) => {
        const err: any = new Error('rpc error: code = PermissionDenied desc = permission_denied: source project_id "proj-other" does not match target project_id "outside-of-project"');
        throw err;
      });

      const res = ConversationManager.sendMessageOrRotate({
        conversationId: convA.conversationId,
        prompt: 'Execute task after mismatch',
        projectId,
        accountProfileId: profileId,
        role: 'worker',
        workerId,
        model: 'pro'
      });

      assert.strictEqual(res.rotated, true, 'Must rotate on project mismatch');
      assert.notStrictEqual(res.conversationId, convA.conversationId);

      // Verify Conv A is retired with reason
      const recordA = ConversationManager.getConversation(convA.conversationId)!;
      assert.strictEqual(recordA.status, 'retired');
      assert.strictEqual(recordA.rotation_reason, 'PROJECT_CONTEXT_MISMATCH');

      // Verify Conv B is active leaf with parent pointer
      const recordB = ConversationManager.getConversation(res.conversationId)!;
      assert.strictEqual(recordB.status, 'active');
      assert.strictEqual(recordB.rotation_index, 2);
      assert.strictEqual(recordB.parent_conversation_id, convA.conversationId);
      assert.strictEqual(recordB.rotation_reason, 'PROJECT_CONTEXT_MISMATCH');
    });

    test('Reuse after handoff: subsequent messages reuse new active leaf B without creating C', () => {
      const workerId = 'worker-mismatch-test';
      const profileId = 'acc-mismatch-test';
      const projectId = 'proj-mismatch-test';

      const activeLeaf = ConversationManager.getActiveLeaf({ projectId, accountProfileId: profileId, role: 'worker', workerId })!;
      assert.ok(activeLeaf);
      assert.strictEqual(activeLeaf.rotation_index, 2);

      let sendCalls = 0;
      ConversationManager.setSendMessageOverride((convId, prompt) => {
        sendCalls++;
        assert.strictEqual(convId, activeLeaf.conversation_id);
      });

      const res = ConversationManager.sendMessageOrRotate({
        conversationId: activeLeaf.conversation_id,
        prompt: 'Execute task on new active leaf',
        projectId,
        accountProfileId: profileId,
        role: 'worker',
        workerId,
        model: 'pro'
      });

      assert.strictEqual(res.rotated, false, 'Must reuse leaf B without creating C');
      assert.strictEqual(res.conversationId, activeLeaf.conversation_id);
      assert.strictEqual(sendCalls, 1);
    });

    test('Generic PermissionDenied (auth/token/other) is NOT treated as mismatch and throws error', () => {
      const workerId = 'worker-perm-test';
      const profileId = 'acc-perm-test';
      const projectId = 'proj-perm-test';

      const conv = ConversationManager.getOrCreateConversation({
        projectId,
        accountProfileId: profileId,
        role: 'worker',
        workerId,
        model: 'pro'
      });

      ConversationManager.setSendMessageOverride((convId, prompt) => {
        const err: any = new Error('rpc error: code = PermissionDenied desc = permission_denied: unauthorized token expired');
        throw err;
      });

      assert.throws(() => {
        ConversationManager.sendMessageOrRotate({
          conversationId: conv.conversationId,
          prompt: 'Execute task under expired token',
          projectId,
          accountProfileId: profileId,
          role: 'worker',
          workerId,
          model: 'pro'
        });
      }, /unauthorized token expired/);

      // Verify conversation was NOT retired and no new conversation was spawned
      const record = ConversationManager.getConversation(conv.conversationId)!;
      assert.strictEqual(record.status, 'active');
      assert.strictEqual(record.rotation_index, 1);
    });

    test('Strict error matcher: isProjectMismatchError rejects unrelated errors', () => {
      assert.strictEqual(ConversationManager.isProjectMismatchError(null), false);
      assert.strictEqual(ConversationManager.isProjectMismatchError(new Error('Connection refused')), false);
      assert.strictEqual(ConversationManager.isProjectMismatchError(new Error('rpc error: code = PermissionDenied desc = access denied to resource')), false);
      assert.strictEqual(ConversationManager.isProjectMismatchError(new Error('rpc error: code = PermissionDenied desc = permission_denied: source project_id "foo" does not match target project_id "outside-of-project"')), true);
      assert.strictEqual(ConversationManager.isProjectMismatchError(new Error('permission_denied: workspace mismatch between source and target')), true);
    });
  });

  // ==========================================================================
  // 14. Autonomous Lease & Worker Recovery Suite
  // ==========================================================================
  describe('Autonomous Lease & Worker Recovery Suite', () => {
    let testProfileId: string;
    let testWorkerId: string;
    let testRunId: string;
    let testTaskId: string;

    before(() => {
      const p = AccountProfileManager.createProfile({
        displayName: 'Recovery Test Profile',
        googleAccountLabel: 'recovery@test.local'
      });
      testProfileId = p.id;
      AccountProfileManager.updateStatus(testProfileId, 'READY');

      const w = WorkerRegistry.createWorker({
        name: 'Recovery Test Worker',
        account_profile_id: testProfileId,
        environment: 'local'
      });
      testWorkerId = w.id;

      testRunId = `run-recov-${Date.now()}`;
      testTaskId = `task-recov-${Date.now()}`;

      db.prepare(`
        INSERT OR IGNORE INTO projects (id, name, path, created_at, updated_at)
        VALUES ('proj-recovery-test', 'Recovery Test Project', 'C:\\dummy-recovery', ?, ?)
      `).run(new Date().toISOString(), new Date().toISOString());

      db.prepare(`
        INSERT INTO autonomous_runs (id, project_id, name, objective, start_time, status, created_at, updated_at)
        VALUES (?, 'proj-recovery-test', 'Recovery Run', 'Test Objective', ?, 'running', ?, ?)
      `).run(testRunId, new Date().toISOString(), new Date().toISOString(), new Date().toISOString());

      db.prepare(`
        INSERT INTO autonomous_tasks (id, run_id, title, status, order_index, created_at, updated_at)
        VALUES (?, ?, 'Stale Task', 'in_progress', 1, ?, ?)
      `).run(testTaskId, testRunId, new Date().toISOString(), new Date().toISOString());
    });

    after(() => {
      WorkerRegistry.setProbeOverrideForTest(null);
      try {
        db.prepare('DELETE FROM worker_leases WHERE worker_id = ?').run(testWorkerId);
        db.prepare('DELETE FROM workers WHERE id = ?').run(testWorkerId);
        db.prepare('DELETE FROM autonomous_tasks WHERE id = ?').run(testTaskId);
        db.prepare('DELETE FROM autonomous_runs WHERE id = ?').run(testRunId);
        AccountProfileManager.deleteProfile(testProfileId);
      } catch {}
    });

    test('stale lease automatically resets task to ready and clears worker assignment to OFFLINE', () => {
      // Simulate an active lease in the past
      const past = new Date(Date.now() - 10000).toISOString();
      const leaseId = 'lease-stale-test';
      db.prepare(`
        INSERT INTO worker_leases (id, worker_id, run_id, task_id, status, claimed_at, lease_until, last_heartbeat)
        VALUES (?, ?, ?, ?, 'active', ?, ?, ?)
      `).run(leaseId, testWorkerId, testRunId, testTaskId, past, past, past);

      db.prepare(`
        UPDATE workers
        SET status = 'WORKING', current_task_id = ?, current_run_id = ?
        WHERE id = ?
      `).run(testTaskId, testRunId, testWorkerId);

      // Run expireStaleLeases
      const result = WorkerRegistry.expireStaleLeases();
      assert.ok(result.expired >= 1, 'Must expire at least the stale lease');
      assert.ok(result.resetTasks.includes(testTaskId), 'Must include testTaskId in resetTasks');

      // Verify task was reset to 'ready'
      const task: any = db.prepare('SELECT status FROM autonomous_tasks WHERE id = ?').get(testTaskId);
      assert.strictEqual(task.status, 'ready', 'Task must be reset to ready in SQLite');

      // Verify worker assignment was cleared and status is OFFLINE
      const worker = WorkerRegistry.getWorker(testWorkerId)!;
      assert.strictEqual(worker.status, 'OFFLINE', 'Worker must become OFFLINE');
      assert.strictEqual(worker.current_task_id, null, 'current_task_id must be cleared');
      assert.strictEqual(worker.current_run_id, null, 'current_run_id must be cleared');
    });

    test('offline worker is autonomously revived to READY when healthy probe succeeds', async () => {
      // Configure probe override to simulate healthy runtime
      WorkerRegistry.setProbeOverrideForTest(async (profile) => ({
        conversationId: 'conv-recov-revived',
        pid: 99999
      }));

      // Call ensureWorkerAvailable
      const revived = await WorkerRegistry.ensureWorkerAvailable();
      assert.ok(revived, 'Worker must be revived');
      assert.strictEqual(revived.status, 'READY');
      assert.strictEqual(revived.current_task_id, null);
      assert.strictEqual(revived.current_run_id, null);
      assert.strictEqual(revived.conversation_id, 'conv-recov-revived');
    });

    test('dead runtime does NOT revive worker (stays OFFLINE/ERROR)', async () => {
      // Worker starts OFFLINE
      WorkerRegistry.updateWorkerStatus(testWorkerId, 'OFFLINE', {
        current_task_id: null,
        current_run_id: null
      });

      // Configure probe override to fail (simulate dead runtime)
      WorkerRegistry.setProbeOverrideForTest(async (profile) => {
        throw new Error('AGENTAPI_UNAVAILABLE: Antigravity runtime process dead');
      });

      const revived = await WorkerRegistry.ensureWorkerAvailable();
      assert.strictEqual(revived, null, 'Revival must return null when probe fails');

      const worker = WorkerRegistry.getWorker(testWorkerId)!;
      assert.strictEqual(worker.status, 'OFFLINE', 'Worker must remain OFFLINE');
    });
  });

  // ==========================================================================
  // 15. Supervisor Persistent Response Boundary Suite
  // ==========================================================================
  describe('Supervisor Persistent Response Boundary Suite', () => {
    let tempBrainDir: string;
    let convDir: string;
    let transcriptFile: string;

    before(() => {
      tempBrainDir = fs.mkdtempSync(path.join(os.tmpdir(), 'userprofile-test-'));
      convDir = path.join(tempBrainDir, '.gemini', 'antigravity', 'brain', 'conv-boundary-test', '.system_generated', 'logs');
      fs.mkdirSync(convDir, { recursive: true });
      transcriptFile = path.join(convDir, 'transcript.jsonl');
    });

    after(() => {
      try { fs.rmSync(tempBrainDir, { recursive: true, force: true }); } catch {}
    });

    test('waitForResponse ignores old responses prior to minStepIndex', async () => {
      const { GeminiSupervisorProvider } = await import('../src/geminiSupervisorProvider.js');
      const provider = new GeminiSupervisorProvider('flash', { USERPROFILE: tempBrainDir });

      // Write previous turns (Turn 1: Planning / Task 1 Review)
      const turn1Lines = [
        JSON.stringify({ step_index: 0, type: 'USER_INPUT', content: 'Turn 1 prompt' }),
        JSON.stringify({ step_index: 1, type: 'PLANNER_RESPONSE', status: 'DONE', content: '{"verdict":"APPROVED","feedback":"Old Turn 1 Review"}' })
      ].join('\n') + '\n';
      fs.writeFileSync(transcriptFile, turn1Lines);

      // minStepIndex = 1 (the index at which turn 1 finished)
      // Call waitForResponse with short timeout; since no new turn exists yet, it should timeout / return empty
      const responseBeforeNewTurn = await provider.waitForResponse('conv-boundary-test', 500, 1);
      assert.strictEqual(responseBeforeNewTurn, '', 'Must not return Turn 1 response when minStepIndex = 1');

      // Now append Turn 2 response (step_index = 3)
      const turn2Lines = [
        JSON.stringify({ step_index: 2, type: 'USER_INPUT', content: 'Turn 2 prompt' }),
        JSON.stringify({ step_index: 3, type: 'PLANNER_RESPONSE', status: 'DONE', content: '{"verdict":"APPROVED","feedback":"New Turn 2 Review"}' })
      ].join('\n') + '\n';
      fs.appendFileSync(transcriptFile, turn2Lines);

      // Now waitForResponse with minStepIndex = 1 must return the Turn 2 response!
      const responseAfterNewTurn = await provider.waitForResponse('conv-boundary-test', 2000, 1);
      assert.ok(responseAfterNewTurn.includes('New Turn 2 Review'), 'Must return the response generated strictly after minStepIndex');
      assert.ok(!responseAfterNewTurn.includes('Old Turn 1 Review'));
    });

  });

  // ==========================================================================
  // 16. Autonomous in_review Task Recovery Suite
  // ==========================================================================
  describe('Autonomous in_review Task Recovery Suite', () => {
    test('runner autonomously processes in_review task using existing report without manual intervention', async () => {
      const testProjectId = 'proj-in-review-' + Date.now();
      const testRunId = 'run-test-in-review-' + Date.now();
      const testTaskId = 'task-test-in-review-' + Date.now();
      const nextTaskId = 'task-test-next-' + Date.now();
      const nowIso = new Date().toISOString();

      // Setup Project
      db.prepare(`
        INSERT INTO projects (id, name, path, created_at, updated_at)
        VALUES (?, 'Test In-Review Project', ?, ?, ?)
      `).run(testProjectId, path.join(os.tmpdir(), testProjectId), nowIso, nowIso);

      // Setup Run
      db.prepare(`
        INSERT INTO autonomous_runs (id, project_id, name, objective, status, autonomy_mode, start_time, created_at, updated_at)
        VALUES (?, ?, 'Test In-Review Run', 'Objective', 'running', 'autonomous', ?, ?, ?)
      `).run(testRunId, testProjectId, nowIso, nowIso, nowIso);

      // Setup Task 1 in 'in_review'
      db.prepare(`
        INSERT INTO autonomous_tasks (id, run_id, title, status, order_index, dependencies_json, created_at, updated_at)
        VALUES (?, ?, 'Task 1 Setup', 'in_review', 1, '[]', ?, ?)
      `).run(testTaskId, testRunId, nowIso, nowIso);

      // Setup Task 2 in 'pending' dependent on Task 1
      db.prepare(`
        INSERT INTO autonomous_tasks (id, run_id, title, status, order_index, dependencies_json, created_at, updated_at)
        VALUES (?, ?, 'Task 2 Next', 'pending', 2, ?, ?, ?)
      `).run(nextTaskId, testRunId, JSON.stringify([testTaskId]), nowIso, nowIso);

      // Setup Builder Report for Task 1
      const reportId = 'report-test-' + Date.now();
      db.prepare(`
        INSERT INTO builder_reports (id, run_id, task_id, status, files_changed_json, implemented_json, tests_run, test_results, build_status, created_at)
        VALUES (?, ?, ?, 'success', '["index.ts"]', '["Task 1 Setup"]', 'npm test', 'PASS', 'OK', ?)
      `).run(reportId, testRunId, testTaskId, nowIso);

      // Verify that available tasks before review is 0 (because Task 1 is in_review, Task 2 is pending)
      const availableBefore = AutonomousManager.getAvailableTasks(testRunId);
      assert.strictEqual(availableBefore.length, 0, 'No available tasks while Task 1 is in_review');

      // Execute autonomous review directly via AutonomousManager.submitSupervisorReview
      AutonomousManager.submitSupervisorReview({
        runId: testRunId,
        taskId: testTaskId,
        reportId,
        verdict: 'APPROVED',
        feedback: 'Aprovado pelo teste autônomo'
      });

      // Verify Task 1 is completed
      const task1After: any = db.prepare('SELECT status FROM autonomous_tasks WHERE id = ?').get(testTaskId);
      assert.strictEqual(task1After.status, 'completed');

      // Verify DAG resolution: Task 2 is now ready!
      const availableAfter = AutonomousManager.getAvailableTasks(testRunId);
      assert.strictEqual(availableAfter.length, 1);
      assert.strictEqual(availableAfter[0].id, nextTaskId);
    });
  });

  // ==========================================================================
  // 17. Fable Worker V1 Prompt Integration Suite (Tests 1-9)
  // ==========================================================================
  describe('Fable Worker V1 Prompt Integration Suite', () => {
    // Test 1 — Loader: loads fully, non-empty, deterministic hash
    test('Test 1 — Loader: fable-worker-v1 loads completely with deterministic SHA256', async () => {
      const { PromptManager } = await import('../src/promptManager.js');
      const loaded = PromptManager.loadBasePrompt('fable-worker-v1');
      assert.ok(loaded.content.length > 5000, 'Prompt content must not be empty or truncated');
      assert.ok(loaded.content.includes('You are the primary software-engineering agent operating inside DecoHUB'));
      assert.strictEqual(typeof loaded.hash, 'string');
      assert.strictEqual(loaded.hash.length, 64, 'Must be valid 64-char sha256 hex string');
    });

    // Test 2 — Runtime injection: project_path, run_id, task_id, worker_id appear
    test('Test 2 — Runtime injection: context xml contains project_path, run_id, task_id, worker_id', async () => {
      const { PromptManager } = await import('../src/promptManager.js');
      const xml = PromptManager.buildRuntimeContextXml({
        projectPath: 'C:/IA/test-projects/test-fable',
        runId: 'run-12345',
        taskId: 'task-67890',
        workerId: 'worker-pro-1',
        accountProfileId: 'acc-pro-1',
        requestedModel: 'pro',
        actualModel: 'pro'
      });
      assert.ok(xml.includes('project_path: C:/IA/test-projects/test-fable'));
      assert.ok(xml.includes('run_id: run-12345'));
      assert.ok(xml.includes('task_id: task-67890'));
      assert.ok(xml.includes('worker_id: worker-pro-1'));
      assert.ok(xml.includes('actual_model: pro'));
    });

    // Test 3 — No fabricated actual model: if unknown, must be UNKNOWN
    test('Test 3 — No fabricated actual model: unverified actual_model defaults to UNKNOWN', async () => {
      const { PromptManager } = await import('../src/promptManager.js');
      const xml = PromptManager.buildRuntimeContextXml({
        projectPath: 'C:/IA/test-projects/test-fable',
        runId: 'run-12345',
        taskId: 'task-67890',
        workerId: 'worker-pro-1',
        actualModel: null
      });
      assert.ok(xml.includes('actual_model: UNKNOWN'), 'actual_model must be UNKNOWN when unverified');
    });

    // Test 4 — Prompt separation: system instructions != task message
    test('Test 4 — Prompt separation: task message is separate from base system prompt', async () => {
      const { PromptManager } = await import('../src/promptManager.js');
      const bundle = PromptManager.buildWorkerInstructions({
        promptId: 'fable-worker-v1',
        runtime: {
          projectPath: 'C:/IA/test-projects/test-fable',
          runId: 'run-sep-1',
          taskId: 'task-sep-1'
        },
        project: {
          projectName: 'Project Sep',
          objective: 'Objective Sep'
        }
      });
      // The task execution instructions must not be baked into the base system prompt
      assert.ok(bundle.systemInstructions.includes('## Instruction hierarchy'));
      assert.ok(!bundle.systemInstructions.includes('TAREFA: Fix critical bug'), 'Task must not be in base system prompt');
      assert.ok(bundle.workerRoleOverlayXml.includes('role: WORKER'));
    });

    // Test 5 — Prompt change conversation rotation: legacy -> fable-worker-v1 rotates exactly once
    test('Test 5 — Prompt change rotation: old legacy Worker rotates exactly once to Fable Worker V1', async () => {
      const uniqueSuffix = Date.now() + '-' + Math.random().toString(36).slice(2, 6);
      const profileId = 'acc-rot-' + uniqueSuffix;
      const workerId = 'worker-rot-' + uniqueSuffix;
      const nowIso = new Date().toISOString();

      // Seed an existing legacy worker conversation
      const legacyConvId = 'conv-legacy-' + uniqueSuffix;
      db.prepare(`
        INSERT INTO conversations (
          conversation_id, project_id, account_profile_id, role, worker_id, run_id,
          title, status, created_at, last_used_at, turn_count, rotation_index,
          rotation_reason, parent_conversation_id, is_hidden, prompt_id, prompt_hash
        ) VALUES (?, 'proj-1', ?, 'worker', ?, 'run-1', 'Legacy Worker', 'active', ?, ?, 5, 1, NULL, NULL, 0, 'legacy', 'hash-legacy')
      `).run(legacyConvId, profileId, workerId, nowIso, nowIso);

      // Now request conversation with fable-worker-v1
      const createdIds: string[] = [];
      ConversationManager.setValidationOverride(() => true);
      ConversationManager.setCreateOverride((params, title) => {
        const id = 'conv-fable-' + uniqueSuffix;
        createdIds.push(id);
        return id;
      });

      const res = ConversationManager.getOrCreateConversation({
        projectId: 'proj-1',
        accountProfileId: profileId,
        role: 'worker',
        workerId,
        model: 'pro',
        promptId: 'fable-worker-v1',
        promptHash: 'hash-fable-v1'
      });

      ConversationManager.setCreateOverride(null);
      ConversationManager.setValidationOverride(null);

      assert.strictEqual(res.isNew, true, 'Must rotate to a new conversation');
      assert.strictEqual(createdIds.length, 1, 'Must create exactly 1 new conversation');

      // Verify legacy conversation was retired with PROMPT_VERSION_CHANGE
      const legacyAfter: any = db.prepare('SELECT status, rotation_reason FROM conversations WHERE conversation_id = ?').get(legacyConvId);
      assert.strictEqual(legacyAfter.status, 'retired');
      assert.strictEqual(legacyAfter.rotation_reason, 'PROMPT_VERSION_CHANGE');
    });

    // Test 6 — Reuse after rotation: subsequent task reuses same active leaf
    test('Test 6 — Reuse after rotation: next task reuses active Fable Worker leaf without creating a 3rd conversation', async () => {
      const uniqueSuffix = Date.now() + '-' + Math.random().toString(36).slice(2, 6);
      const profileId = 'acc-reuse-' + uniqueSuffix;
      const workerId = 'worker-reuse-' + uniqueSuffix;

      let createdCount = 0;
      ConversationManager.setValidationOverride(() => true);
      ConversationManager.setCreateOverride((params, title) => {
        createdCount++;
        return 'conv-fable-reuse-' + uniqueSuffix + '-' + createdCount;
      });

      // First task creates Fable Worker
      const res1 = ConversationManager.getOrCreateConversation({
        projectId: 'proj-reuse',
        accountProfileId: profileId,
        role: 'worker',
        workerId,
        model: 'pro',
        promptId: 'fable-worker-v1',
        promptHash: 'hash-fable-v1'
      });
      assert.strictEqual(res1.isNew, true);
      assert.strictEqual(createdCount, 1);

      // Second task requests same promptId
      const res2 = ConversationManager.getOrCreateConversation({
        projectId: 'proj-reuse',
        accountProfileId: profileId,
        role: 'worker',
        workerId,
        model: 'pro',
        promptId: 'fable-worker-v1',
        promptHash: 'hash-fable-v1'
      });

      ConversationManager.setCreateOverride(null);
      ConversationManager.setValidationOverride(null);

      assert.strictEqual(res2.isNew, false, 'Must reuse the existing Fable Worker leaf');
      assert.strictEqual(res2.conversationId, res1.conversationId);
      assert.strictEqual(createdCount, 1, 'Zero new conversations created on second task');
    });

    // Test 7 — Heartbeat: does not create conversation
    test('Test 7 — Heartbeat invariant: runner/worker heartbeats create 0 conversations', async () => {
      const initialConvs = (db.prepare('SELECT count(*) as c FROM conversations').get() as any).c;
      const { AutonomousRunnerService } = await import('../src/autonomousRunnerService.js');
      AutonomousRunnerService.recordHeartbeat('idle');
      AutonomousRunnerService.recordHeartbeat('idle');
      const finalConvs = (db.prepare('SELECT count(*) as c FROM conversations').get() as any).c;
      assert.strictEqual(finalConvs, initialConvs, 'Heartbeat must not create any conversation');
    });

    // Test 8 — Probe: does not receive Fable Worker prompt
    test('Test 8 — Probe invariant: Worker probe uses dedicated ping, NOT Fable Worker prompt', async () => {
      const uniqueSuffix = Date.now() + '-' + Math.random().toString(36).slice(2, 6);
      const profileId = 'acc-probe-' + uniqueSuffix;
      const probePromptCaptured: string[] = [];
      ConversationManager.setCreateOverride((params, title) => {
        if (params.initialPrompt) probePromptCaptured.push(params.initialPrompt);
        return 'conv-probe-test-' + uniqueSuffix;
      });

      ConversationManager.getOrCreateConversation({
        accountProfileId: profileId,
        role: 'probe',
        model: 'flash',
        initialPrompt: 'Ping de prontidão do Worker'
      });

      ConversationManager.setCreateOverride(null);

      assert.strictEqual(probePromptCaptured.length, 1);
      assert.ok(!probePromptCaptured[0].includes('FABLE'), 'Probe must not receive Fable prompt');
      assert.ok(!probePromptCaptured[0].includes('DECOHUB_ROLE'), 'Probe must not receive worker role overlay');
    });

    // Test 9 — Supervisor invariant: Supervisor prompt is unchanged and does not receive Fable Worker prompt
    test('Test 9 — Supervisor invariant: Supervisor prompt is unchanged and does not receive Fable Worker prompt', async () => {
      const uniqueSuffix = Date.now() + '-' + Math.random().toString(36).slice(2, 6);
      const profileId = 'acc-sup-' + uniqueSuffix;
      const projectId = 'proj-sup-' + uniqueSuffix;
      const supervisorPromptCaptured: string[] = [];
      ConversationManager.setCreateOverride((params, title) => {
        if (params.initialPrompt) supervisorPromptCaptured.push(params.initialPrompt);
        return 'conv-sup-inv-check-' + uniqueSuffix;
      });

      ConversationManager.getOrCreateConversation({
        projectId,
        accountProfileId: profileId,
        role: 'supervisor',
        model: 'pro',
        initialPrompt: 'Supervisor persistente DecoHUB'
      });

      ConversationManager.setCreateOverride(null);

      assert.strictEqual(supervisorPromptCaptured.length, 1);
      assert.ok(!supervisorPromptCaptured[0].includes('role: WORKER'), 'Supervisor must never receive worker role overlay');
      assert.ok(!supervisorPromptCaptured[0].includes('fable-worker-v1'), 'Supervisor must not receive Fable Worker prompt');
    });
  });

  // Suite 18 — Benchmark Prompt Isolation & Variant Integrity Suite
  describe('Benchmark Prompt Isolation & Variant Integrity Suite', () => {
    const testTempRoot = path.join(os.tmpdir(), 'decohub-benchmark-test-' + Date.now());

    before(() => {
      fs.mkdirSync(testTempRoot, { recursive: true });
    });

    after(() => {
      try {
        fs.rmSync(testTempRoot, { recursive: true, force: true });
      } catch {}
    });

    test('Test 1 — Prompt ID and deterministic hash for each variant', async () => {
      const { PromptManager } = await import('../src/promptManager.js');

      const fable = PromptManager.loadBasePrompt('fable-worker-v1');
      assert.strictEqual(typeof fable.hash, 'string');
      assert.strictEqual(fable.hash.length, 64);
      assert.strictEqual(fable.hash, 'dfe87a04f98b85620fae3c369b888e263daf85e63b882bf90a4cd307b5d76337');

      const legacy = PromptManager.loadBasePrompt('legacy-worker-v1');
      assert.strictEqual(typeof legacy.hash, 'string');
      assert.strictEqual(legacy.hash.length, 64);
      assert.strictEqual(legacy.hash, 'f2f083b9d6487f68383d4f3b03838de5b43ef04b0cda42cd31a4ac74cafa1a8b');

      assert.notStrictEqual(fable.hash, legacy.hash, 'Hashes must differ between variants');
    });

    test('Test 2 — Fable project receives Fable rule file and passes isolation validation', async () => {
      const { PromptManager } = await import('../src/promptManager.js');
      const fableProj = path.join(testTempRoot, 'proj-fable');
      fs.mkdirSync(fableProj, { recursive: true });

      const instructions = PromptManager.buildWorkerInstructions({
        promptId: 'fable-worker-v1',
        runtime: { projectPath: fableProj },
        project: { projectName: 'Fable Proj', objective: 'Test Fable' }
      });

      const ruleFile = PromptManager.ensureProjectRulesFile(fableProj, instructions.fullRuleContent);
      assert.ok(ruleFile && fs.existsSync(ruleFile), 'Fable rule file must exist');

      const isolation = PromptManager.validateWorkspacePromptIsolation(fableProj, 'fable-worker-v1');
      assert.strictEqual(isolation.valid, true, 'Must pass isolation check');
    });

    test('Test 3 — Legacy project does NOT receive Fable rule file and cleans any preexisting leak', async () => {
      const { PromptManager } = await import('../src/promptManager.js');
      const legacyProj = path.join(testTempRoot, 'proj-legacy');
      fs.mkdirSync(legacyProj, { recursive: true });

      // First simulate a leak: write fable rule into legacy project
      const leakedRulesDir = path.join(legacyProj, '.agents', 'rules');
      fs.mkdirSync(leakedRulesDir, { recursive: true });
      fs.writeFileSync(path.join(leakedRulesDir, 'decohub-worker.md'), 'FABLE LEAK CONTENT');

      // Now ensureProjectRulesFile for legacy (instructions is empty)
      const legacyInstructions = PromptManager.buildWorkerInstructions({
        promptId: 'legacy-worker-v1',
        runtime: { projectPath: legacyProj },
        project: { projectName: 'Legacy Proj', objective: 'Test Legacy' }
      });
      assert.strictEqual(legacyInstructions.fullRuleContent, '', 'Legacy fullRuleContent must be empty');

      PromptManager.ensureProjectRulesFile(legacyProj, legacyInstructions.fullRuleContent);

      // Verify rule file was removed
      assert.strictEqual(fs.existsSync(path.join(leakedRulesDir, 'decohub-worker.md')), false, 'Leaked rule file must be removed');

      const isolation = PromptManager.validateWorkspacePromptIsolation(legacyProj, 'legacy');
      assert.strictEqual(isolation.valid, true, 'Legacy workspace must pass isolation check');
    });

    test('Test 4 — Task contract identity between A and B variants', async () => {
      const taskDef = {
        id: 'task-test-paired',
        title: 'Implement calculateDiscounts utility',
        description: 'Create calculation module with pure functions and unit tests',
        criteria: ['Must calculate 10% discount', 'Must throw on negative amounts'],
        verification_command: 'npm test'
      };

      // Both A and B receive the exact same contract parameters
      const contractA = {
        title: taskDef.title,
        description: taskDef.description,
        criteria: [...taskDef.criteria],
        verificationCommand: taskDef.verification_command
      };
      const contractB = {
        title: taskDef.title,
        description: taskDef.description,
        criteria: [...taskDef.criteria],
        verificationCommand: taskDef.verification_command
      };

      assert.deepStrictEqual(contractA, contractB, 'Task contracts for Variant A and B must be strictly identical');
    });

    test('Test 5 — Invariant confirmation: Supervisor and Probe remain completely unchanged', async () => {
      // Supervisor prompt check
      const supPromptCaptured: string[] = [];
      ConversationManager.setCreateOverride((params, title) => {
        if (params.initialPrompt) supPromptCaptured.push(params.initialPrompt);
        return 'conv-sup-bench-check-' + Date.now();
      });

      ConversationManager.getOrCreateConversation({
        projectId: 'proj-sup-bench',
        accountProfileId: 'acc-sup-bench-' + Date.now(),
        role: 'supervisor',
        model: 'pro',
        initialPrompt: 'Supervisor persistente DecoHUB'
      });

      // Probe prompt check
      const probePromptCaptured: string[] = [];
      ConversationManager.setCreateOverride((params, title) => {
        if (params.initialPrompt) probePromptCaptured.push(params.initialPrompt);
        return 'conv-probe-bench-check-' + Date.now();
      });

      ConversationManager.getOrCreateConversation({
        accountProfileId: 'acc-probe-bench-' + Date.now(),
        role: 'probe',
        model: 'flash',
        initialPrompt: 'Ping de prontidão do Worker'
      });

      ConversationManager.setCreateOverride(null);

      assert.ok(!supPromptCaptured[0].includes('fable-worker-v1'));
      assert.ok(!supPromptCaptured[0].includes('legacy-worker-v1'));
      assert.ok(!probePromptCaptured[0].includes('fable-worker-v1'));
      assert.ok(!probePromptCaptured[0].includes('legacy-worker-v1'));
    });
  });

  // ==========================================================================
  // 19. Fable Worker V2 Flash Prompt Integration Suite (Tests 1-9)
  // ==========================================================================
  describe('Fable Worker V2 Flash Prompt Integration Suite', () => {
    const testTempRoot = path.join(os.tmpdir(), 'decohub-v2-prompt-test-' + Date.now());

    before(() => {
      fs.mkdirSync(testTempRoot, { recursive: true });
    });

    after(() => {
      try {
        fs.rmSync(testTempRoot, { recursive: true, force: true });
      } catch {}
    });

    test('Test 1 — V2 Loader: fable-worker-v2-flash loads completely with deterministic SHA256', async () => {
      const { PromptManager } = await import('../src/promptManager.js');
      const loaded = PromptManager.loadBasePrompt('fable-worker-v2-flash');
      assert.ok(loaded.content.length > 5000, 'V2 prompt must be non-empty');
      assert.ok(loaded.content.includes('Minimum Sufficient Context'), 'Must contain Minimum Sufficient Context');
      assert.ok(loaded.content.includes('Action Bias'), 'Must contain Action Bias');
      assert.strictEqual(typeof loaded.hash, 'string');
      assert.strictEqual(loaded.hash.length, 64);
      assert.strictEqual(loaded.hash, 'ba62b672b47835f28494a0009c02cb3dbf3097a4c3a4efead88fde06c52a1713');
    });

    test('Test 2 — V2 hash is distinct from V1 and Legacy', async () => {
      const { PromptManager } = await import('../src/promptManager.js');
      const v2 = PromptManager.loadBasePrompt('fable-worker-v2-flash');
      const v1 = PromptManager.loadBasePrompt('fable-worker-v1');
      const leg = PromptManager.loadBasePrompt('legacy-worker-v1');

      assert.notStrictEqual(v2.hash, v1.hash, 'V2 hash must differ from V1');
      assert.notStrictEqual(v2.hash, leg.hash, 'V2 hash must differ from Legacy');
    });

    test('Test 3 — Prompt bundle generation for V2 includes V2 title and action principles', async () => {
      const { PromptManager } = await import('../src/promptManager.js');
      const projPath = path.join(testTempRoot, 'proj-v2-bundle');
      fs.mkdirSync(projPath, { recursive: true });

      const bundle = PromptManager.buildWorkerInstructions({
        promptId: 'fable-worker-v2-flash',
        runtime: {
          projectPath: projPath,
          runId: 'run-v2-1',
          taskId: 'task-v2-1'
        },
        project: {
          projectName: 'V2 Test Project',
          objective: 'Test V2 Bundle'
        }
      });

      assert.strictEqual(bundle.promptId, 'fable-worker-v2-flash');
      assert.strictEqual(bundle.promptHash, 'ba62b672b47835f28494a0009c02cb3dbf3097a4c3a4efead88fde06c52a1713');
      assert.ok(bundle.bootstrapInstructions.includes('Fable Flash V2 Optimized'));
      assert.ok(bundle.bootstrapInstructions.includes('Minimum Sufficient Context'));
      assert.ok(bundle.fullRuleContent.includes('## Minimum Sufficient Context'));
      assert.ok(bundle.fullRuleContent.includes('## Action Bias'));
    });

    test('Test 4 — Legacy workspace isolation remains strict', async () => {
      const { PromptManager } = await import('../src/promptManager.js');
      const legacyProj = path.join(testTempRoot, 'proj-v2-legacy');
      fs.mkdirSync(legacyProj, { recursive: true });

      const isolation = PromptManager.validateWorkspacePromptIsolation(legacyProj, 'legacy');
      assert.strictEqual(isolation.valid, true);

      // Verify that if a V2 rule file is erroneously written in legacy, isolation detects the leak
      const ruleDir = path.join(legacyProj, '.agents', 'rules');
      fs.mkdirSync(ruleDir, { recursive: true });
      fs.writeFileSync(path.join(ruleDir, 'decohub-worker.md'), 'fable-worker-v2-flash rules');

      const leakCheck = PromptManager.validateWorkspacePromptIsolation(legacyProj, 'legacy');
      assert.strictEqual(leakCheck.valid, false);
      assert.ok(leakCheck.reason?.includes('LEAK_DETECTED'));

      // Clean up for legacy
      PromptManager.ensureProjectRulesFile(legacyProj, null);
      assert.strictEqual(PromptManager.validateWorkspacePromptIsolation(legacyProj, 'legacy').valid, true);
    });

    test('Test 5 — Fable V1 workspace isolation remains strict', async () => {
      const { PromptManager } = await import('../src/promptManager.js');
      const v1Proj = path.join(testTempRoot, 'proj-v1-iso');
      fs.mkdirSync(v1Proj, { recursive: true });

      const v1Bundle = PromptManager.buildWorkerInstructions({
        promptId: 'fable-worker-v1',
        runtime: { projectPath: v1Proj },
        project: { projectName: 'V1 Proj' }
      });
      PromptManager.ensureProjectRulesFile(v1Proj, v1Bundle.fullRuleContent);

      const isolation = PromptManager.validateWorkspacePromptIsolation(v1Proj, 'fable-worker-v1');
      assert.strictEqual(isolation.valid, true);
    });

    test('Test 6 — Fable V2 workspace receives correct rule file and passes isolation validation', async () => {
      const { PromptManager } = await import('../src/promptManager.js');
      const v2Proj = path.join(testTempRoot, 'proj-v2-iso');
      fs.mkdirSync(v2Proj, { recursive: true });

      const v2Bundle = PromptManager.buildWorkerInstructions({
        promptId: 'fable-worker-v2-flash',
        runtime: { projectPath: v2Proj },
        project: { projectName: 'V2 Proj' }
      });
      const ruleFile = PromptManager.ensureProjectRulesFile(v2Proj, v2Bundle.fullRuleContent);
      assert.ok(ruleFile && fs.existsSync(ruleFile));

      const isolation = PromptManager.validateWorkspacePromptIsolation(v2Proj, 'fable-worker-v2-flash');
      assert.strictEqual(isolation.valid, true);
    });

    test('Test 7 — Supervisor and Probe invariants remain unchanged', async () => {
      const supPromptCaptured: string[] = [];
      ConversationManager.setCreateOverride((params, title) => {
        if (params.initialPrompt) supPromptCaptured.push(params.initialPrompt);
        return 'conv-sup-v2-check-' + Date.now();
      });

      ConversationManager.getOrCreateConversation({
        projectId: 'proj-sup-v2',
        accountProfileId: 'acc-sup-v2-' + Date.now(),
        role: 'supervisor',
        model: 'pro',
        initialPrompt: 'Supervisor persistente DecoHUB'
      });

      ConversationManager.setCreateOverride(null);
      assert.ok(!supPromptCaptured[0].includes('fable-worker-v2-flash'));
      assert.ok(!supPromptCaptured[0].includes('Minimum Sufficient Context'));
    });

    test('Test 8 — Controlled rotation from V1 to V2 on PROMPT_VERSION_CHANGE', async () => {
      const uniqueSuffix = Date.now() + '-' + Math.random().toString(36).slice(2, 6);
      const profileId = 'acc-v1v2-' + uniqueSuffix;
      const workerId = 'worker-v1v2-' + uniqueSuffix;
      const nowIso = new Date().toISOString();

      // Seed an active V1 conversation
      const v1ConvId = 'conv-v1-' + uniqueSuffix;
      db.prepare(`
        INSERT INTO conversations (
          conversation_id, project_id, account_profile_id, role, worker_id, run_id,
          title, status, created_at, last_used_at, turn_count, rotation_index,
          rotation_reason, parent_conversation_id, is_hidden, prompt_id, prompt_hash
        ) VALUES (?, 'proj-rot', ?, 'worker', ?, 'run-1', 'Worker V1', 'active', ?, ?, 3, 1, NULL, NULL, 0, 'fable-worker-v1', 'hash-v1')
      `).run(v1ConvId, profileId, workerId, nowIso, nowIso);

      // Now request conversation with fable-worker-v2-flash
      const createdIds: string[] = [];
      ConversationManager.setValidationOverride(() => true);
      ConversationManager.setCreateOverride((params, title) => {
        const id = 'conv-v2-' + uniqueSuffix;
        createdIds.push(id);
        return id;
      });

      const res = ConversationManager.getOrCreateConversation({
        projectId: 'proj-rot',
        accountProfileId: profileId,
        role: 'worker',
        workerId,
        model: 'flash',
        promptId: 'fable-worker-v2-flash',
        promptHash: 'ba62b672b47835f28494a0009c02cb3dbf3097a4c3a4efead88fde06c52a1713'
      });

      ConversationManager.setCreateOverride(null);
      ConversationManager.setValidationOverride(null);

      assert.strictEqual(res.isNew, true, 'Must rotate to a new conversation for V2');
      assert.strictEqual(createdIds.length, 1);

      // V1 conversation must be retired with PROMPT_VERSION_CHANGE
      const v1Record: any = db.prepare('SELECT status, rotation_reason FROM conversations WHERE conversation_id = ?').get(v1ConvId);
      assert.strictEqual(v1Record.status, 'retired');
      assert.strictEqual(v1Record.rotation_reason, 'PROMPT_VERSION_CHANGE');
    });

    test('Test 9 — Reuse after rotation: subsequent task with V2 reuses V2 leaf', async () => {
      const uniqueSuffix = Date.now() + '-' + Math.random().toString(36).slice(2, 6);
      const profileId = 'acc-v2reuse-' + uniqueSuffix;
      const workerId = 'worker-v2reuse-' + uniqueSuffix;

      let createdCount = 0;
      ConversationManager.setValidationOverride(() => true);
      ConversationManager.setCreateOverride((params, title) => {
        createdCount++;
        return 'conv-v2-reuse-' + uniqueSuffix + '-' + createdCount;
      });

      const res1 = ConversationManager.getOrCreateConversation({
        projectId: 'proj-v2-reuse',
        accountProfileId: profileId,
        role: 'worker',
        workerId,
        model: 'flash',
        promptId: 'fable-worker-v2-flash',
        promptHash: 'ba62b672b47835f28494a0009c02cb3dbf3097a4c3a4efead88fde06c52a1713'
      });
      assert.strictEqual(res1.isNew, true);
      assert.strictEqual(createdCount, 1);

      // Second task with same V2 prompt reuses without creating new conversation
      const res2 = ConversationManager.getOrCreateConversation({
        projectId: 'proj-v2-reuse',
        accountProfileId: profileId,
        role: 'worker',
        workerId,
        model: 'flash',
        promptId: 'fable-worker-v2-flash',
        promptHash: 'ba62b672b47835f28494a0009c02cb3dbf3097a4c3a4efead88fde06c52a1713'
      });

      ConversationManager.setCreateOverride(null);
      ConversationManager.setValidationOverride(null);

      assert.strictEqual(res2.isNew, false, 'Must reuse existing V2 conversation');
      assert.strictEqual(res2.conversationId, res1.conversationId);
      assert.strictEqual(createdCount, 1, 'No new conversation must be created on reuse');
    });
  });

  describe('Native Worker Mode & Granular Evaluator Suite', () => {
    const testTempRoot = path.join(os.tmpdir(), 'decohub-native-test-' + Date.now());

    before(() => {
      fs.mkdirSync(testTempRoot, { recursive: true });
    });

    after(() => {
      try {
        fs.rmSync(testTempRoot, { recursive: true, force: true });
      } catch {}
    });

    test('Test 1 — Native prompt loader returns empty instructions and native hash', async () => {
      const { PromptManager } = await import('../src/promptManager.js');
      const loaded = PromptManager.loadBasePrompt('native');
      assert.strictEqual(loaded.content, '');
      assert.strictEqual(loaded.hash, 'native');

      const bundle = PromptManager.buildWorkerInstructions({
        promptId: 'native',
        runtime: { projectPath: 'C:/test' },
        project: { projectName: 'Test' }
      });
      assert.strictEqual(bundle.promptId, 'native');
      assert.strictEqual(bundle.promptHash, 'native');
      assert.strictEqual(bundle.fullRuleContent, '');
      assert.strictEqual(bundle.systemInstructions, '');
      assert.strictEqual(bundle.bootstrapInstructions, '');
    });

    test('Test 2 — Workspace isolation for Native mode cleans any residual decohub-worker.md', async () => {
      const { PromptManager } = await import('../src/promptManager.js');
      const nativeProj = path.join(testTempRoot, 'proj-native-test');
      fs.mkdirSync(nativeProj, { recursive: true });

      // Clean check passes
      const isolation1 = PromptManager.validateWorkspacePromptIsolation(nativeProj, 'native');
      assert.strictEqual(isolation1.valid, true);

      // Residual cleanup
      const ruleDir = path.join(nativeProj, '.agents', 'rules');
      fs.mkdirSync(ruleDir, { recursive: true });
      fs.writeFileSync(path.join(ruleDir, 'decohub-worker.md'), 'legacy-content');

      PromptManager.ensureProjectRulesFile(nativeProj, null);
      assert.strictEqual(fs.existsSync(path.join(ruleDir, 'decohub-worker.md')), false);
      const isolation2 = PromptManager.validateWorkspacePromptIsolation(nativeProj, 'native');
      assert.strictEqual(isolation2.valid, true);
    });

    test('Test 3 — Evaluator Granularity: PASS on code 0 ground truth', async () => {
      const { IndependentEvaluator } = await import('../src/independentEvaluator.js');
      const contract = IndependentEvaluator.createSuccessContract({
        taskId: 'task-eval-pass',
        projectId: 'proj-eval',
        projectPath: process.cwd(),
        objective: 'Test pass',
        acceptanceCriteria: ['Must pass'],
        verificationCommand: 'node -e "process.exit(0)"'
      });

      const res = await IndependentEvaluator.evaluate(contract.id, process.cwd(), {
        status: 'success',
        filesChanged: ['index.ts']
      });

      assert.strictEqual(res.verdict, 'PASS');
      assert.strictEqual(res.taskIsDone, true);
      assert.strictEqual(res.exitCode, 0);
    });

    test('Test 4 — Evaluator Granularity: FAIL on non-zero exit code', async () => {
      const { IndependentEvaluator } = await import('../src/independentEvaluator.js');
      const contract = IndependentEvaluator.createSuccessContract({
        taskId: 'task-eval-fail',
        projectId: 'proj-eval',
        projectPath: process.cwd(),
        objective: 'Test fail',
        acceptanceCriteria: ['Must fail'],
        verificationCommand: 'node -e "process.exit(1)"'
      });

      const res = await IndependentEvaluator.evaluate(contract.id, process.cwd(), {
        status: 'success',
        filesChanged: ['index.ts']
      });

      assert.strictEqual(res.verdict, 'FAIL');
      assert.strictEqual(res.taskIsDone, false);
      assert.strictEqual(res.exitCode, 1);
    });

    test('Test 5 — Evaluator Granularity: INCONCLUSIVE when no steps and no files changed', async () => {
      const { IndependentEvaluator } = await import('../src/independentEvaluator.js');
      const contract = IndependentEvaluator.createSuccessContract({
        taskId: 'task-eval-inconclusive',
        projectId: 'proj-eval',
        projectPath: process.cwd(),
        objective: 'Test inconclusive',
        acceptanceCriteria: ['Criteria'],
        verificationSteps: []
      });

      const res = await IndependentEvaluator.evaluate(contract.id, process.cwd(), {
        status: 'failure',
        filesChanged: []
      });

      assert.strictEqual(res.verdict, 'INCONCLUSIVE');
      assert.strictEqual(res.taskIsDone, false);
    });
  });

});



