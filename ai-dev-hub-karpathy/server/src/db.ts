import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

export function getHubDataDir(): string {
  if (process.env.AI_DEV_HUB_DATA_DIR) {
    return process.env.AI_DEV_HUB_DATA_DIR;
  }
  const home = os.homedir();
  const marker = `${path.sep}.ai-dev-hub${path.sep}profiles`;
  const idx = home.indexOf(marker);
  if (idx !== -1) {
    return path.join(home.substring(0, idx), '.ai-dev-hub');
  }
  return path.join(home, '.ai-dev-hub');
}

export const HUB_DATA_DIR = getHubDataDir();
if (!fs.existsSync(HUB_DATA_DIR)) {
  fs.mkdirSync(HUB_DATA_DIR, { recursive: true });
}

export const DB_PATH = path.join(HUB_DATA_DIR, 'hub.db');
export const db = new DatabaseSync(DB_PATH);

// Enable WAL mode and busy_timeout for robust concurrent access
try {
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 10000;');
  db.exec('PRAGMA synchronous = NORMAL;');
} catch {}

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      objective TEXT,
      description TEXT,
      stack TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      session_number INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      summary TEXT,
      implemented TEXT,
      changes TEXT,
      affected_files TEXT,
      completed_tasks TEXT,
      next_step TEXT,
      checkpoint_raw TEXT,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      metadata TEXT,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS system_logs (
      id TEXT PRIMARY KEY,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      metadata TEXT
    );

    CREATE TABLE IF NOT EXISTS mcp_stats (
      id TEXT PRIMARY KEY,
      tool_name TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      duration_ms INTEGER,
      status TEXT NOT NULL,
      project_id TEXT
    );

    CREATE TABLE IF NOT EXISTS autonomous_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      objective TEXT NOT NULL,
      briefing TEXT,
      status TEXT NOT NULL DEFAULT 'running', -- running, paused, waiting_approval, completed, failed
      autonomy_mode TEXT NOT NULL DEFAULT 'balanced', -- safe, balanced, autonomous
      branch_name TEXT,
      max_hours REAL DEFAULT 8.0,
      max_cycles INTEGER DEFAULT 25,
      current_cycle INTEGER DEFAULT 0,
      start_time TEXT NOT NULL,
      end_time TEXT,
      config_json TEXT,
      summary_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS autonomous_tasks (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      milestone TEXT DEFAULT 'MVP',
      order_index INTEGER DEFAULT 0,
      dependencies_json TEXT, -- array of task IDs
      status TEXT NOT NULL DEFAULT 'pending', -- pending, ready, in_progress, in_review, completed, blocked, failed
      assigned_to TEXT DEFAULT 'builder',
      retry_count INTEGER DEFAULT 0,
      criteria_json TEXT, -- array of acceptance criteria
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(run_id) REFERENCES autonomous_runs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS autonomous_approvals (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      task_id TEXT,
      risk_level TEXT NOT NULL, -- green, yellow, orange, red
      title TEXT NOT NULL,
      context TEXT NOT NULL,
      why_needed TEXT NOT NULL,
      alternatives_json TEXT,
      supervisor_recommendation TEXT NOT NULL,
      impact TEXT,
      risk TEXT,
      status TEXT NOT NULL DEFAULT 'pending', -- pending, approved, rejected, delegated
      decision TEXT,
      decided_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(run_id) REFERENCES autonomous_runs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS autonomous_events (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      task_id TEXT,
      agent_role TEXT NOT NULL, -- supervisor, builder, system, user
      event_type TEXT NOT NULL,
      message TEXT NOT NULL,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(run_id) REFERENCES autonomous_runs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS builder_reports (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      status TEXT NOT NULL, -- success, failure, partial
      files_changed_json TEXT,
      implemented_json TEXT,
      tests_run TEXT,
      test_results TEXT,
      build_status TEXT,
      browser_validation TEXT,
      screenshots_json TEXT,
      known_problems_json TEXT,
      decisions_json TEXT,
      recommendation TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(run_id) REFERENCES autonomous_runs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS supervisor_reviews (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      report_id TEXT NOT NULL,
      verdict TEXT NOT NULL, -- APPROVED, CHANGES_REQUESTED
      feedback TEXT NOT NULL,
      requirements_met INTEGER DEFAULT 1,
      build_passed INTEGER DEFAULT 1,
      tests_passed INTEGER DEFAULT 1,
      ui_functional INTEGER DEFAULT 1,
      quality_score INTEGER DEFAULT 10,
      created_at TEXT NOT NULL,
      FOREIGN KEY(run_id) REFERENCES autonomous_runs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS success_contracts (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      run_id TEXT,
      project_id TEXT NOT NULL,
      objective TEXT NOT NULL,
      acceptance_criteria_json TEXT NOT NULL,
      verification_steps_json TEXT NOT NULL,
      protected_evaluation_files_json TEXT NOT NULL,
      protected_file_hashes_json TEXT NOT NULL,
      baseline_json TEXT NOT NULL,
      success_thresholds_json TEXT NOT NULL,
      failure_conditions_json TEXT NOT NULL,
      status TEXT DEFAULT 'pending', -- pending, baseline_failed, in_evaluation, passed, failed, tampered
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS evaluation_results (
      id TEXT PRIMARY KEY,
      contract_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      run_id TEXT,
      verdict TEXT NOT NULL, -- PASS, FAIL, TAMPERING_DETECTED
      builder_status TEXT NOT NULL, -- COMPLETED, FAILED
      evaluator_verdict TEXT NOT NULL, -- PASS, FAIL, TAMPERING_DETECTED
      task_is_done INTEGER DEFAULT 0,
      passed_criteria_json TEXT NOT NULL,
      failed_criteria_json TEXT NOT NULL,
      evidence_json TEXT NOT NULL,
      expected TEXT,
      actual TEXT,
      evaluator_notes TEXT,
      evaluator_name TEXT NOT NULL,
      executed_commands_json TEXT NOT NULL,
      exit_code INTEGER,
      duration_ms INTEGER,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS runner_heartbeats (
      runner_id TEXT PRIMARY KEY,
      status TEXT NOT NULL, -- online, idle, busy, stopped, error
      last_heartbeat TEXT NOT NULL,
      active_run_id TEXT,
      current_task TEXT,
      current_worker TEXT,
      iteration INTEGER DEFAULT 0,
      consecutive_failures INTEGER DEFAULT 0,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS research_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      objective TEXT NOT NULL,
      primary_metric TEXT NOT NULL,
      direction TEXT NOT NULL DEFAULT 'MINIMIZE', -- MINIMIZE, MAXIMIZE
      measurement_command TEXT NOT NULL,
      metric_parser_regex TEXT,
      max_experiment_time REAL DEFAULT 8.0,
      max_experiments INTEGER DEFAULT 20,
      current_experiment INTEGER DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'running', -- running, paused, completed, stopped
      baseline_metric REAL,
      best_metric REAL,
      best_commit TEXT,
      branch_name TEXT NOT NULL,
      allowed_files_json TEXT,
      protected_files_json TEXT,
      complexity_penalty REAL DEFAULT 0.05,
      stop_conditions_json TEXT,
      keep_count INTEGER DEFAULT 0,
      discard_count INTEGER DEFAULT 0,
      crash_count INTEGER DEFAULT 0,
      current_hypothesis TEXT,
      start_time TEXT NOT NULL,
      end_time TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS research_experiments (
      id TEXT PRIMARY KEY,
      research_run_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      hypothesis TEXT NOT NULL,
      branch TEXT NOT NULL,
      commit_hash TEXT,
      metric_before REAL,
      metric_after REAL,
      delta REAL,
      improvement_pct REAL,
      duration_ms INTEGER,
      files_changed_json TEXT,
      lines_added INTEGER DEFAULT 0,
      lines_removed INTEGER DEFAULT 0,
      complexity_delta INTEGER DEFAULT 0,
      status TEXT NOT NULL, -- BASELINE, KEEP, DISCARD, CRASH
      reason TEXT NOT NULL,
      stdout_excerpt TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(research_run_id) REFERENCES research_runs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS council_deliberations (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      run_id TEXT,
      risk_level TEXT NOT NULL, -- low, medium, high, critical
      policy_trigger TEXT NOT NULL, -- CRITICAL_ARCHITECTURE, HIGH_RISK, MANUAL_TRIGGER
      reviews_json TEXT NOT NULL,
      peer_rankings_json TEXT NOT NULL,
      chairman_verdict TEXT NOT NULL, -- APPROVED, CHANGES_REQUESTED, BLOCKED
      chairman_synthesis TEXT NOT NULL,
      correctness_score INTEGER,
      simplicity_score INTEGER,
      regression_score INTEGER,
      final_score INTEGER,
      consensus_level TEXT, -- UNANIMOUS, MAJORITY, SPLIT, CHAIRMAN_OVERRIDE
      created_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS arena_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      task_title TEXT NOT NULL,
      task_description TEXT,
      success_contract_id TEXT,
      status TEXT NOT NULL DEFAULT 'PLANNING',
      candidate_count INTEGER DEFAULT 3,
      baseline_commit TEXT,
      winner_candidate_id TEXT,
      chairman_reason TEXT,
      risk_level TEXT DEFAULT 'high',
      resource_policy_json TEXT,
      activity_stream_json TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS arena_candidates (
      id TEXT PRIMARY KEY,
      arena_run_id TEXT NOT NULL,
      candidate_label TEXT NOT NULL,
      strategy_description TEXT NOT NULL,
      worker_id TEXT,
      account_profile_id TEXT,
      branch TEXT NOT NULL,
      workspace TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'CREATED',
      commit_sha TEXT,
      files_changed_json TEXT,
      lines_added INTEGER DEFAULT 0,
      lines_removed INTEGER DEFAULT 0,
      test_results_json TEXT,
      metric_results_json TEXT,
      complexity_cost REAL DEFAULT 0,
      complexity_score REAL DEFAULT 5,
      evaluation_score REAL DEFAULT 0,
      council_score REAL DEFAULT 0,
      final_rank INTEGER,
      created_at TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY(arena_run_id) REFERENCES arena_runs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS benchmark_runs (
      id TEXT PRIMARY KEY,
      version_label TEXT NOT NULL,
      git_commit TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING',
      total_tasks INTEGER DEFAULT 0,
      passed_tasks INTEGER DEFAULT 0,
      pass_rate REAL DEFAULT 0,
      avg_surgical_score REAL DEFAULT 0,
      avg_simplicity_score REAL DEFAULT 0,
      avg_time_ms INTEGER DEFAULT 0,
      regression_count INTEGER DEFAULT 0,
      composite_score REAL DEFAULT 0,
      is_baseline INTEGER DEFAULT 0,
      summary_json TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS benchmark_task_results (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      difficulty TEXT NOT NULL,
      is_holdout INTEGER DEFAULT 0,
      status TEXT NOT NULL,
      correctness INTEGER DEFAULT 0,
      test_output TEXT,
      duration_ms INTEGER DEFAULT 0,
      files_changed_json TEXT,
      unnecessary_files_count INTEGER DEFAULT 0,
      lines_added INTEGER DEFAULT 0,
      lines_removed INTEGER DEFAULT 0,
      surgical_score REAL DEFAULT 0,
      complexity_score REAL DEFAULT 5,
      composite_score REAL DEFAULT 0,
      failure_reason TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(run_id) REFERENCES benchmark_runs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS self_improvement_experiments (
      id TEXT PRIMARY KEY,
      experiment_number INTEGER NOT NULL,
      hypothesis TEXT NOT NULL,
      bottleneck_identified TEXT NOT NULL,
      baseline_run_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PROPOSING',
      candidate_a_score REAL DEFAULT 0,
      candidate_b_score REAL DEFAULT 0,
      winner_candidate TEXT,
      verdict TEXT,
      rationale TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY(baseline_run_id) REFERENCES benchmark_runs(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS self_improvement_runs (
      id TEXT PRIMARY KEY,
      baseline_commit TEXT NOT NULL,
      current_best_commit TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'INITIALIZING',
      started_at TEXT NOT NULL,
      ended_at TEXT,
      budget_minutes REAL DEFAULT 480.0,
      elapsed_minutes REAL DEFAULT 0,
      max_experiments INTEGER DEFAULT 10,
      completed_experiments INTEGER DEFAULT 0,
      candidates_per_experiment INTEGER DEFAULT 2,
      kept_count INTEGER DEFAULT 0,
      discarded_count INTEGER DEFAULT 0,
      crashed_count INTEGER DEFAULT 0,
      blocked_count INTEGER DEFAULT 0,
      initial_metrics_json TEXT,
      current_metrics_json TEXT,
      stop_reason TEXT,
      preset TEXT DEFAULT 'OVERNIGHT',
      timeline_json TEXT,
      config_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

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

  // Workers registry and leases (multi-worker support)
  db.exec(`
    CREATE TABLE IF NOT EXISTS workers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'antigravity',
      account_label TEXT,
      status TEXT NOT NULL DEFAULT 'READY',
      conversation_id TEXT,
      current_run_id TEXT,
      current_issue_number INTEGER,
      current_task_id TEXT,
      workspace TEXT,
      pid INTEGER,
      last_heartbeat TEXT,
      last_activity TEXT,
      last_checkpoint TEXT,
      last_error TEXT,
      capabilities_json TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS worker_leases (
      id TEXT PRIMARY KEY,
      worker_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      issue_number INTEGER,
      claimed_at TEXT NOT NULL,
      lease_until TEXT NOT NULL,
      last_heartbeat TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      released_at TEXT,
      FOREIGN KEY(worker_id) REFERENCES workers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS worker_activity (
      id TEXT PRIMARY KEY,
      worker_id TEXT NOT NULL,
      run_id TEXT,
      task_id TEXT,
      issue_number INTEGER,
      event_type TEXT NOT NULL,
      message TEXT NOT NULL,
      metadata_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS account_profiles (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      profile_name TEXT NOT NULL UNIQUE,
      google_account_label TEXT,
      environment_path TEXT,
      auth_status TEXT NOT NULL DEFAULT 'NEEDS_LOGIN',
      last_tested TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS account_project_sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      account_profile_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      last_active_at TEXT NOT NULL,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(project_id, account_profile_id)
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS model_preferences (
      id TEXT PRIMARY KEY,
      account_profile_id TEXT,
      role TEXT NOT NULL DEFAULT 'default', -- default, supervisor, builder, reviewer, council
      model_id TEXT NOT NULL, -- auto, flash_lite, flash, pro
      project_id TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS usage_events (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      account_profile_id TEXT,
      model_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'builder',
      project_id TEXT,
      conversation_id TEXT,
      task_id TEXT,
      duration_ms INTEGER DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'success',
      tool_calls_count INTEGER DEFAULT 0,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS conversations (
      conversation_id TEXT PRIMARY KEY,
      project_id TEXT,
      account_profile_id TEXT NOT NULL,
      role TEXT NOT NULL, -- 'supervisor' | 'worker' | 'probe'
      worker_id TEXT,
      run_id TEXT,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active', -- 'active' | 'retired' | 'invalid'
      created_at TEXT NOT NULL,
      last_used_at TEXT NOT NULL,
      turn_count INTEGER DEFAULT 0,
      rotation_index INTEGER DEFAULT 1,
      rotation_reason TEXT,
      parent_conversation_id TEXT,
      is_hidden INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_conversations_lookup 
      ON conversations(project_id, account_profile_id, role, worker_id, status);
  `);

  // Safe migration for conversations table prompt versioning
  const conversationCols: Array<[string, string]> = [
    ['prompt_id', 'TEXT'],
    ['prompt_hash', 'TEXT']
  ];
  for (const [col, colType] of conversationCols) {
    try {
      db.exec(`ALTER TABLE conversations ADD COLUMN ${col} ${colType};`);
    } catch {}
  }

  // Safe migration for workers table columns
  const workerCols: Array<[string, string]> = [
    ['environment', 'TEXT DEFAULT "local"'],
    ['account_profile_id', 'TEXT']
  ];
  for (const [col, colType] of workerCols) {
    try {
      db.exec(`ALTER TABLE workers ADD COLUMN ${col} ${colType};`);
    } catch {}
  }

  // Safe migration for projects table active account profile
  try {
    db.exec(`ALTER TABLE projects ADD COLUMN active_account_profile_id TEXT;`);
  } catch {}

  // Safe migration for sessions table lifecycle columns
  const sessionCols = ['agent_name', 'start_time', 'end_time', 'initial_git_head', 'final_git_head', 'status'];
  for (const col of sessionCols) {
    try {
      db.exec(`ALTER TABLE sessions ADD COLUMN ${col} TEXT;`);
    } catch {
      // Column already exists
    }
  }

  // Safe migration for autonomous_runs state tracking columns
  const runCols: Array<[string, string]> = [
    ['current_milestone', 'TEXT'],
    ['current_task', 'TEXT'],
    ['current_worker', 'TEXT'],
    ['iteration', 'INTEGER DEFAULT 0'],
    ['consecutive_failures', 'INTEGER DEFAULT 0'],
    ['last_success', 'TEXT'],
    ['last_error', 'TEXT'],
    ['next_action', 'TEXT'],
    ['started_at', 'TEXT'],
    ['builder_session_id', 'TEXT'],
    ['supervisor_model', 'TEXT'],
    ['github_epic_issue_number', 'INTEGER'],
    ['github_epic_issue_url', 'TEXT']
  ];
  for (const [col, colType] of runCols) {
    try {
      db.exec(`ALTER TABLE autonomous_runs ADD COLUMN ${col} ${colType};`);
    } catch {
      // Column already exists
    }
  }

  // GitHub integration columns for projects
  const projectCols: Array<[string, string]> = [
    ['github_repo', 'TEXT'],
    ['github_branch', 'TEXT DEFAULT "main"'],
    ['github_sync_status', 'TEXT DEFAULT "idle"'],
    ['github_last_synced_at', 'TEXT']
  ];
  for (const [col, colType] of projectCols) {
    try {
      db.exec(`ALTER TABLE projects ADD COLUMN ${col} ${colType};`);
    } catch {}
  }

  // GitHub & Karpathy Layer integration columns for autonomous_tasks
  const taskCols: Array<[string, string]> = [
    ['github_issue_number', 'INTEGER'],
    ['github_issue_id', 'TEXT'],
    ['github_issue_url', 'TEXT'],
    ['github_pr_number', 'INTEGER'],
    ['github_pr_url', 'TEXT'],
    ['github_branch', 'TEXT'],
    ['github_state', 'TEXT DEFAULT "open"'],
    ['contract_id', 'TEXT'],
    ['evaluation_status', 'TEXT DEFAULT "none"'],
    ['verification_command', 'TEXT'],
    ['done_when', 'TEXT'],
    ['task_commit_sha', 'TEXT'],
    ['commit_source', 'TEXT'],
    ['engineering_context_version', 'TEXT'],
    ['engineering_context_hash', 'TEXT'],
    ['preflight_status', 'TEXT DEFAULT "none"']
  ];
  for (const [col, colType] of taskCols) {
    try {
      db.exec(`ALTER TABLE autonomous_tasks ADD COLUMN ${col} ${colType};`);
    } catch {}
  }

  // Safe migration for benchmark tables Level 2 (AGENT BENCHMARK)
  try {
    db.exec(`ALTER TABLE benchmark_runs ADD COLUMN benchmark_level TEXT DEFAULT 'FAST';`);
  } catch {}

  const benchResultCols: Array<[string, string]> = [
    ['supervisor_session_id', 'TEXT'],
    ['builder_conversation_id', 'TEXT'],
    ['worker_id', 'TEXT'],
    ['account_profile_id', 'TEXT'],
    ['commands_executed_json', 'TEXT'],
    ['git_branch', 'TEXT'],
    ['result_commit', 'TEXT']
  ];
  for (const [col, colType] of benchResultCols) {
    try {
      db.exec(`ALTER TABLE benchmark_task_results ADD COLUMN ${col} ${colType};`);
    } catch {}
  }

  const expCols: Array<[string, string]> = [
    ['benchmark_level', "TEXT DEFAULT 'FAST'"],
    ['winning_commit_sha', 'TEXT'],
    ['promoted_version_label', 'TEXT'],
    ['candidate_a_branch', 'TEXT'],
    ['candidate_b_branch', 'TEXT'],
    ['candidate_a_commit', 'TEXT'],
    ['candidate_b_commit', 'TEXT'],
    ['promotion_contract_json', 'TEXT'],
    ['target_metric', 'TEXT'],
    ['target_improvement_pct', 'REAL DEFAULT 0'],
    ['global_impact_pct', 'REAL DEFAULT 0'],
    ['original_verdict', 'TEXT'],
    ['reevaluated_verdict', 'TEXT'],
    ['council_recommendation', 'TEXT'],
    ['run_id', 'TEXT']
  ];
  // Safe migration for account_profiles table quota tracking
  const profileCols: Array<[string, string]> = [
    ['quota_resets_at', 'TEXT'],
    ['quota_message', 'TEXT']
  ];
  for (const [col, colType] of profileCols) {
    try {
      db.exec(`ALTER TABLE account_profiles ADD COLUMN ${col} ${colType};`);
    } catch {}
  }

  if (process.env.MCP_STDIO !== 'true') {
    console.log(`[DB] SQLite database initialized at ${DB_PATH}`);
  }
}

// Auto-run schema initialization
initDatabase();
