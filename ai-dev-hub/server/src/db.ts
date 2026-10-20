import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

export function getHubDataDir(): string {
  if (process.env.AI_DEV_HUB_DATA_DIR) {
    return process.env.AI_DEV_HUB_DATA_DIR;
  }
  if (process.env.DECOHUB_DATA_DIR) {
    return process.env.DECOHUB_DATA_DIR;
  }
  const home = os.homedir();
  const marker = `${path.sep}.ai-dev-hub${path.sep}profiles`;
  const idx = home.indexOf(marker);
  if (idx !== -1) {
    return path.join(home.substring(0, idx), '.ai-dev-hub');
  }
  return path.join(home, '.ai-dev-hub');
}

export interface WorkspaceDataIsolationResult {
  valid: boolean;
  projectRoot: string;
  hubDataDir: string;
  relocated: boolean;
  reason?: string;
}

export function isPathInside(parentPath: string, childPath: string): boolean {
  const parent = path.resolve(parentPath);
  const child = path.resolve(childPath);
  const rel = path.relative(parent, child);
  return !rel || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function resolveSafeHubDataDir(projectRoot: string, requestedDataDir?: string): WorkspaceDataIsolationResult {
  const resolvedProjectRoot = path.resolve(projectRoot);
  const rawDataDir = path.resolve(requestedDataDir || getHubDataDir());

  if (isPathInside(resolvedProjectRoot, rawDataDir)) {
    const projectBaseName = path.basename(resolvedProjectRoot) || 'project';
    const parentDir = path.dirname(resolvedProjectRoot);
    const safeDataDir = path.join(parentDir, `.decohub-isolated-data-${projectBaseName}`);
    return {
      valid: false,
      projectRoot: resolvedProjectRoot,
      hubDataDir: safeDataDir,
      relocated: true,
      reason: `Diretório de dados (${rawDataDir}) está dentro do workspace do projeto (${resolvedProjectRoot}); realocado para diretório irmão seguro (${safeDataDir}).`
    };
  }



  return {
    valid: true,
    projectRoot: resolvedProjectRoot,
    hubDataDir: rawDataDir,
    relocated: false
  };
}

export function validateWorkspaceDataIsolation(
  projectRoot: string,
  options?: { dataDir?: string; autoRelocate?: boolean; otherProjectRoots?: string[] }
): WorkspaceDataIsolationResult {
  const resolvedProjectRoot = path.resolve(projectRoot);
  if (options?.otherProjectRoots) {
    for (const other of options.otherProjectRoots) {
      const resolvedOther = path.resolve(other);
      if (resolvedOther.toLowerCase() === resolvedProjectRoot.toLowerCase()) continue;
      if (isPathInside(resolvedProjectRoot, resolvedOther) || isPathInside(resolvedOther, resolvedProjectRoot)) {
        throw new Error(
          `WORKSPACE_ISOLATION_VIOLATION: O projeto (${resolvedProjectRoot}) colide ou se sobrepõe ao workspace de outro projeto (${resolvedOther}).`
        );
      }
    }
  }

  const res = resolveSafeHubDataDir(resolvedProjectRoot, options?.dataDir);
  if (!res.valid) {
    if (options?.autoRelocate && res.relocated) {
      return res;
    }
    throw new Error(`DATA_DIR_ISOLATION_VIOLATION: ${res.reason}`);
  }

  const strayDecoHubData = path.join(resolvedProjectRoot, '.decohub-data');
  if (fs.existsSync(strayDecoHubData)) {
    throw new Error(
      `DATA_DIR_ISOLATION_VIOLATION: Diretório operacional '.decohub-data' detectado dentro do workspace (${strayDecoHubData}). Remova ou mova para fora da árvore do projeto antes de iniciar a execução.`
    );
  }

  return res;
}

export function resolveProjectOperationalDataDir(projectId: string, baseDataDir: string = getHubDataDir()): string {
  const safeId = projectId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const dir = path.join(path.resolve(baseDataDir), 'projects-operational', safeId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
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
  db.exec(`CREATE TABLE IF NOT EXISTS native_execution_policies (
    project_id TEXT PRIMARY KEY, choice_json TEXT NOT NULL, updated_at TEXT NOT NULL
  ); CREATE TABLE IF NOT EXISTS native_execution_policy_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL,
    previous_json TEXT NOT NULL, choice_json TEXT NOT NULL, created_at TEXT NOT NULL
  );`);
  db.exec(`CREATE TABLE IF NOT EXISTS chat_submissions (
    project_id TEXT NOT NULL,request_id TEXT NOT NULL,content_hash TEXT NOT NULL,
    user_message_id TEXT NOT NULL,status TEXT NOT NULL,response_json TEXT,
    created_at TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(project_id,request_id)
  );CREATE TABLE IF NOT EXISTS run_control_requests (
    run_id TEXT PRIMARY KEY,action TEXT NOT NULL,status TEXT NOT NULL,
    requested_at TEXT NOT NULL,applied_at TEXT
  );`);
  db.exec(`CREATE TABLE IF NOT EXISTS agent_turn_observations (
    conversation_id TEXT PRIMARY KEY,task_id TEXT,project_path TEXT NOT NULL,brain_dir TEXT NOT NULL,
    baseline_lines INTEGER NOT NULL,baseline_files_json TEXT NOT NULL,phase TEXT NOT NULL,dispatched_at TEXT NOT NULL,
    updated_at TEXT
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS native_workspace_bindings (
    project_id TEXT PRIMARY KEY, account_profile_id TEXT NOT NULL, native_project_id TEXT NOT NULL,
    user_profile_dir TEXT NOT NULL, workspace_path TEXT NOT NULL, config_hash TEXT NOT NULL
  );`);
  db.exec(`CREATE TABLE IF NOT EXISTS execution_reservations (
    scope TEXT PRIMARY KEY, token TEXT NOT NULL, owner_pid INTEGER NOT NULL,
    context_json TEXT NOT NULL DEFAULT '{}', metadata_json TEXT DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT
  );
  CREATE TABLE IF NOT EXISTS agent_creation_reservations (
    project_id TEXT NOT NULL, role TEXT NOT NULL, operation_id TEXT NOT NULL,
    owner_pid INTEGER NOT NULL, status TEXT NOT NULL, conversation_id TEXT,
    created_at TEXT NOT NULL, PRIMARY KEY(project_id,role)
  );
  CREATE TABLE IF NOT EXISTS command_executions (
    id TEXT PRIMARY KEY,
    idempotency_key TEXT,
    project_id TEXT,
    run_id TEXT,
    task_id TEXT,
    command TEXT NOT NULL,
    args_json TEXT,
    cwd TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'generic',
    status TEXT NOT NULL,
    pid INTEGER,
    owner_pid INTEGER NOT NULL DEFAULT 0,
    exit_code INTEGER,
    stdout TEXT,
    stderr TEXT,
    stdout_preview TEXT,
    stderr_preview TEXT,
    error_message TEXT,
    timeout_ms INTEGER NOT NULL DEFAULT 30000,
    queue_latency_ms INTEGER,
    duration_ms INTEGER,
    total_latency_ms INTEGER,
    metadata_json TEXT,
    requested_at TEXT NOT NULL DEFAULT (datetime('now')),
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_cmd_exec_idemp ON command_executions(idempotency_key);
  CREATE INDEX IF NOT EXISTS idx_cmd_exec_status ON command_executions(status);
  CREATE INDEX IF NOT EXISTS idx_cmd_exec_requested ON command_executions(requested_at DESC);
  `);
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

    CREATE TABLE IF NOT EXISTS observability_events (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      level TEXT NOT NULL,
      event TEXT NOT NULL,
      message TEXT NOT NULL,
      service TEXT NOT NULL,
      environment TEXT NOT NULL,
      process_id INTEGER,
      session_id TEXT,
      correlation_id TEXT,
      trace_id TEXT,
      span_id TEXT,
      parent_span_id TEXT,
      run_id TEXT,
      task_id TEXT,
      milestone TEXT,
      project_id TEXT,
      conversation_id TEXT,
      attempt INTEGER,
      duration_ms INTEGER,
      status TEXT,
      error_json TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_obs_timestamp ON observability_events(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_obs_level_ts ON observability_events(level, timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_obs_event_ts ON observability_events(event, timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_obs_run ON observability_events(run_id, timestamp ASC);
    CREATE INDEX IF NOT EXISTS idx_obs_task ON observability_events(task_id, timestamp ASC);
    CREATE INDEX IF NOT EXISTS idx_obs_project ON observability_events(project_id, timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_obs_correlation ON observability_events(correlation_id);
    CREATE INDEX IF NOT EXISTS idx_obs_trace ON observability_events(trace_id, span_id);
    CREATE INDEX IF NOT EXISTS idx_obs_service ON observability_events(service, timestamp DESC);

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
      notes TEXT,
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
      evaluation_json TEXT,
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
      suite_id TEXT,
      mode TEXT DEFAULT 'FULL_DECOHUB',
      git_commit_sha TEXT,
      decohub_version TEXT,
      models_tested_json TEXT,
      overall_score REAL DEFAULT 0,
      overall_iq_score REAL DEFAULT 0,
      pass_at_1 REAL DEFAULT 0,
      pass_at_k REAL DEFAULT 0,
      avg_duration_ms INTEGER DEFAULT 0,
      summary_json TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING',
      version_label TEXT DEFAULT '1.0.0',
      git_commit TEXT,
      total_tasks INTEGER DEFAULT 0,
      passed_tasks INTEGER DEFAULT 0,
      pass_rate REAL DEFAULT 0,
      avg_surgical_score REAL DEFAULT 0,
      avg_simplicity_score REAL DEFAULT 0,
      avg_time_ms INTEGER DEFAULT 0,
      regression_count INTEGER DEFAULT 0,
      composite_score REAL DEFAULT 0,
      is_baseline INTEGER DEFAULT 0,
      benchmark_level TEXT DEFAULT 'FAST',
      created_at TEXT NOT NULL,
      updated_at TEXT,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS benchmark_model_results (
      id TEXT PRIMARY KEY,
      benchmark_run_id TEXT,
      model_id TEXT,
      effort_level TEXT DEFAULT 'HIGH',
      tier_id TEXT,
      harness_mode TEXT DEFAULT 'FULL_HARNESS',
      pass_at_1 INTEGER DEFAULT 0,
      pass_at_3 INTEGER DEFAULT 0,
      attempts_used INTEGER DEFAULT 1,
      dev_test_score REAL DEFAULT 0,
      visual_anti_slop_score REAL DEFAULT 0,
      ux_f5_score REAL DEFAULT 0,
      appsec_pentest_score REAL DEFAULT 0,
      rea_pillars_score REAL DEFAULT 0,
      surgical_diff_score REAL DEFAULT 0,
      composite_iq_score REAL DEFAULT 0,
      tool_calls_count INTEGER DEFAULT 0,
      duration_ms INTEGER DEFAULT 0,
      details_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(benchmark_run_id) REFERENCES benchmark_runs(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_bm_results_run ON benchmark_model_results(benchmark_run_id);
    CREATE INDEX IF NOT EXISTS idx_bm_results_model ON benchmark_model_results(model_id);
    CREATE INDEX IF NOT EXISTS idx_bm_results_tier ON benchmark_model_results(tier_id);

    CREATE TABLE IF NOT EXISTS benchmark_variant_results (
      id TEXT PRIMARY KEY,
      benchmark_run_id TEXT,
      variant_id TEXT,
      model_id TEXT,
      effort_level TEXT DEFAULT 'HIGH',
      tier_id TEXT,
      rule_file_bytes INTEGER DEFAULT 0,
      estimated_tokens INTEGER DEFAULT 0,
      context_rot_risk REAL DEFAULT 0,
      pass_at_1 REAL DEFAULT 0,
      pass_at_3 REAL DEFAULT 0,
      self_healing_gain REAL DEFAULT 0,
      dev_gate_score REAL DEFAULT 0,
      visual_rea_score REAL DEFAULT 0,
      ux_f5_score REAL DEFAULT 0,
      appsec_pentest_score REAL DEFAULT 0,
      four_gate_composite REAL DEFAULT 0,
      step_efficiency REAL DEFAULT 0,
      decohub_iq_score REAL DEFAULT 0,
      duration_ms INTEGER DEFAULT 0,
      details_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(benchmark_run_id) REFERENCES benchmark_runs(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_bm_var_results_run ON benchmark_variant_results(benchmark_run_id);
    CREATE INDEX IF NOT EXISTS idx_bm_var_results_variant ON benchmark_variant_results(variant_id);

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
      intelligence_level TEXT NOT NULL DEFAULT 'HIGH', -- HIGH, MEDIUM, LOW
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

    CREATE TABLE IF NOT EXISTS agent_sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      role TEXT NOT NULL, -- 'SUPERVISOR' | 'WORKER'
      logical_conversation_id TEXT NOT NULL,
      provider_conversation_id TEXT NOT NULL,
      generation INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'ACTIVE', -- 'ACTIVE' | 'ARCHIVED' | 'ROTATING' | 'INVALID'
      created_at TEXT NOT NULL,
      last_used_at TEXT NOT NULL,
      last_successful_turn_at TEXT,
      context_estimate INTEGER DEFAULT 0,
      rotation_reason TEXT,
      checkpoint_reference TEXT,
      metadata_json TEXT,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_sessions_active_project_role 
      ON agent_sessions(project_id, role) WHERE status = 'ACTIVE';

    CREATE INDEX IF NOT EXISTS idx_agent_sessions_lookup
      ON agent_sessions(project_id, role, status);

    CREATE TABLE IF NOT EXISTS agent_session_events (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      role TEXT NOT NULL,
      event_type TEXT NOT NULL, -- 'SESSION_CREATED' | 'SESSION_REUSED' | 'SESSION_ROTATION_STARTED' | 'SESSION_ROTATED' | 'SESSION_ARCHIVED' | 'SESSION_RECOVERED' | 'SESSION_INVALID' | 'SESSION_CREATION_RECONCILED'
      generation INTEGER NOT NULL,
      details TEXT NOT NULL,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(session_id) REFERENCES agent_sessions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_agent_session_events_proj
      ON agent_session_events(project_id, created_at);

    CREATE TABLE IF NOT EXISTS session_creation_telemetry (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      origin TEXT NOT NULL,
      project_id TEXT,
      role TEXT,
      run_id TEXT,
      task_id TEXT,
      caller TEXT,
      process_id INTEGER,
      conversation_id TEXT,
      previous_conversation_id TEXT,
      reason TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_telemetry_proj_created 
      ON session_creation_telemetry(project_id, created_at);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS operational_lessons (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      project_path TEXT,
      run_id TEXT,
      task_id TEXT,
      category TEXT NOT NULL,
      failure_classification TEXT NOT NULL,
      problem_summary TEXT NOT NULL,
      root_cause TEXT NOT NULL,
      failed_strategy TEXT,
      working_strategy TEXT,
      regression_test TEXT,
      environment_limitation TEXT,
      resolved INTEGER NOT NULL DEFAULT 0,
      occurrences INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_operational_lessons_proj
      ON operational_lessons(project_id, updated_at);

    CREATE TABLE IF NOT EXISTS autonomous_major_tasks (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      code TEXT NOT NULL DEFAULT 'GT-1',
      title TEXT NOT NULL,
      description TEXT,
      objective TEXT NOT NULL,
      expected_outcome TEXT,
      requirements_json TEXT DEFAULT '[]',
      acceptance_criteria_json TEXT DEFAULT '[]',
      dependencies_json TEXT DEFAULT '[]',
      order_index INTEGER DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'planned',
      lifecycle_state TEXT NOT NULL DEFAULT 'PLANNED',
      validation_evidence_json TEXT DEFAULT '{}',
      history_json TEXT DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(run_id) REFERENCES autonomous_runs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_major_tasks_run
      ON autonomous_major_tasks(run_id, order_index ASC);
    CREATE INDEX IF NOT EXISTS idx_major_tasks_project
      ON autonomous_major_tasks(project_id, status);

    CREATE TABLE IF NOT EXISTS task_state_transitions (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      project_id TEXT,
      entity_type TEXT NOT NULL DEFAULT 'microtask',
      major_task_id TEXT,
      task_id TEXT,
      from_status TEXT NOT NULL,
      to_status TEXT NOT NULL,
      from_lifecycle_state TEXT NOT NULL,
      to_lifecycle_state TEXT NOT NULL,
      actor TEXT NOT NULL,
      reason TEXT NOT NULL,
      metadata_json TEXT DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_state_transitions_run
      ON task_state_transitions(run_id, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_state_transitions_task
      ON task_state_transitions(task_id, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_state_transitions_major
      ON task_state_transitions(major_task_id, created_at ASC);

    CREATE TABLE IF NOT EXISTS agent_communications (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT UNIQUE,
      project_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      major_task_id TEXT,
      micro_task_id TEXT,
      execution_id TEXT,
      attempt INTEGER DEFAULT 1,
      from_agent TEXT NOT NULL,
      to_agent TEXT NOT NULL,
      message_type TEXT NOT NULL,
      content TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      processing_status TEXT NOT NULL DEFAULT 'processed',
      review_id TEXT,
      evaluation_id TEXT,
      commit_sha TEXT,
      created_at TEXT NOT NULL,
      processed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_agent_comm_run
      ON agent_communications(run_id, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_agent_comm_project
      ON agent_communications(project_id, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_agent_comm_micro
      ON agent_communications(micro_task_id, created_at ASC);

    CREATE TABLE IF NOT EXISTS project_requirements (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      code TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      category TEXT NOT NULL DEFAULT 'general',
      mandatory INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'pending',
      verification_status TEXT NOT NULL DEFAULT 'unverified',
      linked_major_task_ids_json TEXT DEFAULT '[]',
      linked_stage_codes_json TEXT DEFAULT '[]',
      linked_task_ids_json TEXT DEFAULT '[]',
      acceptance_criteria_json TEXT DEFAULT '[]',
      evidence_json TEXT DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(run_id) REFERENCES autonomous_runs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_project_requirements_run
      ON project_requirements(run_id, code ASC);
    CREATE INDEX IF NOT EXISTS idx_project_requirements_proj
      ON project_requirements(project_id, status);

    CREATE TABLE IF NOT EXISTS meta_chat_threads (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      provider_conversation_id TEXT,
      model TEXT DEFAULT 'gemini-3.8-flash',
      effort TEXT DEFAULT 'HIGH',
      account_id TEXT,
      status TEXT DEFAULT 'idle',
      files_modified_count INTEGER DEFAULT 0,
      last_message_preview TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_meta_chat_threads_updated
      ON meta_chat_threads(updated_at DESC);

    CREATE TABLE IF NOT EXISTS meta_chat_messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT,
      executed_steps_json TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_meta_chat_created
      ON meta_chat_messages(created_at ASC);
  `);

  const reportColumns = db.prepare('PRAGMA table_info(builder_reports)').all() as any[];
  if (!reportColumns.some(column => column.name === 'evaluation_json')) {
    db.exec('ALTER TABLE builder_reports ADD COLUMN evaluation_json TEXT');
  }

  for (const [col, colType] of [
    ['expected_threshold', 'TEXT'],
    ['actual_result', 'TEXT'],
    ['evaluated_at', 'TEXT']
  ]) {
    try {
      db.exec(`ALTER TABLE evaluation_results ADD COLUMN ${col} ${colType};`);
    } catch {}
  }

  for (const [col, colType] of [
    ['requirements_json', "TEXT DEFAULT '[]'"],
    ['success_criteria_json', "TEXT DEFAULT '[]'"],
    ['technical_context_json', "TEXT DEFAULT '{}'"],
    ['active_run_id', 'TEXT'],
    ['active_plan_run_id', 'TEXT']
  ]) {
    try {
      db.exec(`ALTER TABLE projects ADD COLUMN ${col} ${colType};`);
    } catch {}
  }

  for (const [col, colType] of [
    ['requirements_json', "TEXT DEFAULT '[]'"],
    ['success_criteria_json', "TEXT DEFAULT '[]'"],
    ['technical_context_json', "TEXT DEFAULT '{}'"],
    ['plan_version', 'INTEGER DEFAULT 1'],
    ['plan_history_json', "TEXT DEFAULT '[]'"],
    ['final_validation_json', 'TEXT'],
    ['complexity_analysis_json', "TEXT DEFAULT '{}'"]
  ]) {
    try {
      db.exec(`ALTER TABLE autonomous_runs ADD COLUMN ${col} ${colType};`);
    } catch {}
  }

  for (const [col, colType] of [
    ['stages_json', "TEXT DEFAULT '[]'"],
    ['requirement_ids_json', "TEXT DEFAULT '[]'"],
    ['complexity_tier', "TEXT DEFAULT 'MODERATE'"],
    ['blocking_reason', 'TEXT']
  ]) {
    try {
      db.exec(`ALTER TABLE autonomous_major_tasks ADD COLUMN ${col} ${colType};`);
    } catch {}
  }

  for (const [col, colType] of [
    ['major_task_id', 'TEXT'],
    ['project_id', 'TEXT'],
    ['code', 'TEXT'],
    ['objective', 'TEXT'],
    ['lifecycle_state', "TEXT DEFAULT 'PLANNED'"],
    ['allowed_scope_json', "TEXT DEFAULT '[]'"],
    ['constraints_json', "TEXT DEFAULT '[]'"],
    ['test_strategy', 'TEXT'],
    ['required_evidence_json', "TEXT DEFAULT '[]'"],
    ['attempt_history_json', "TEXT DEFAULT '[]'"],
    ['review_result_json', 'TEXT'],
    ['review_decision', 'TEXT'],
    ['max_retries', 'INTEGER DEFAULT 3'],
    ['replan_origin_task_id', 'TEXT'],
    ['replan_type', 'TEXT'],
    ['replan_reason', 'TEXT'],
    ['execution_id', 'TEXT'],
    ['commit_status', 'TEXT'],
    ['commit_error', 'TEXT'],
    ['stage_code', 'TEXT'],
    ['stage_title', 'TEXT'],
    ['parent_task_id', 'TEXT'],
    ['requirement_ids_json', "TEXT DEFAULT '[]'"],
    ['waived_reason', 'TEXT'],
    ['discovery_source', 'TEXT'],
    ['blocking_reason', 'TEXT'],
    ['subdivision_depth', 'INTEGER DEFAULT 0']
  ]) {
    try {
      db.exec(`ALTER TABLE autonomous_tasks ADD COLUMN ${col} ${colType};`);
    } catch {}
  }

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
  try {
    db.exec(`ALTER TABLE projects ADD COLUMN selected_model TEXT DEFAULT 'auto';`);
  } catch {}
  try {
    db.exec(`ALTER TABLE projects ADD COLUMN reasoning_level TEXT DEFAULT 'HIGH';`);
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
    ['github_epic_issue_url', 'TEXT'],
    ['plan_deliberation_id', 'TEXT'],
    ['research_summary_json', 'TEXT']
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
    ['github_last_synced_at', 'TEXT'],
    ['is_trusted', 'INTEGER DEFAULT 1'],
    ['full_dev_autonomy', 'INTEGER DEFAULT 1']
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
    ['preflight_status', 'TEXT DEFAULT "none"'],
    ['adaptive_effort_json', 'TEXT'],
    ['task_metrics_json', 'TEXT'],
    ['evidence_summary_json', 'TEXT'],
    ['skill_routed', 'TEXT'],
    ['skill_confidence', 'REAL DEFAULT 1.0'],
    ['skill_guidelines_json', 'TEXT'],
    ['council_deliberation_id', 'TEXT'],
    ['slop_preflight_json', 'TEXT'],
    ['research_findings_json', 'TEXT'],
    ['expected_files_json', 'TEXT'],
    ['protected_evaluation_files_json', 'TEXT'],
    ['notes', 'TEXT']
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
  for (const [col, colType] of expCols) {
    try {
      db.exec(`ALTER TABLE self_improvement_experiments ADD COLUMN ${col} ${colType};`);
    } catch {}
  }
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

  try { db.exec("ALTER TABLE model_preferences ADD COLUMN intelligence_level TEXT NOT NULL DEFAULT 'HIGH';"); } catch {}
  ensureDefensiveMigrations(db);

  if (process.env.MCP_STDIO !== 'true') {
    console.log(`[DB] SQLite database initialized at ${DB_PATH}`);
  }
}

// Auto-run schema initialization
/**
 * Ensures that critical tables have all required timestamp (updated_at, created_at) and metadata columns.
 * Fully idempotent and safe across legacy databases.
 */
export function ensureDefensiveMigrations(targetDb: any = db): void {
  const defensiveMigrations: Array<[string, string, string]> = [
    ['projects', 'active_account_profile_id', 'TEXT'],
    ['projects', 'selected_model', "TEXT DEFAULT 'flash'"],
    ['projects', 'reasoning_level', "TEXT DEFAULT 'HIGH'"],
    ['projects', 'github_repo', 'TEXT'],
    ['projects', 'github_branch', "TEXT DEFAULT 'main'"],
    ['projects', 'github_sync_status', "TEXT DEFAULT 'idle'"],
    ['projects', 'github_last_synced_at', 'TEXT'],
    ['projects', 'is_trusted', 'INTEGER DEFAULT 1'],
    ['projects', 'full_dev_autonomy', 'INTEGER DEFAULT 1'],
    ['projects', 'updated_at', 'TEXT'],
    ['projects', 'created_at', 'TEXT'],
    ['execution_reservations', 'updated_at', 'TEXT'],
    ['execution_reservations', 'created_at', 'TEXT'],
    ['execution_reservations', 'metadata_json', "TEXT DEFAULT '{}'"],
    ['autonomous_runs', 'updated_at', 'TEXT'],
    ['autonomous_runs', 'created_at', 'TEXT'],
    ['autonomous_runs', 'active_stage_code', 'TEXT'],
    ['autonomous_runs', 'active_stage_title', 'TEXT'],
    ['autonomous_runs', 'active_slash_command', 'TEXT'],
    ['autonomous_runs', 'active_profile_id', 'TEXT'],
    ['autonomous_runs', 'runtime_profile_id', 'TEXT'],
    ['autonomous_runs', 'selected_model', 'TEXT'],
    ['autonomous_runs', 'reasoning_level', 'TEXT'],
    ['autonomous_runs', 'paused_at', 'TEXT'],
    ['autonomous_runs', 'resumed_at', 'TEXT'],
    ['autonomous_runs', 'stopped_at', 'TEXT'],
    ['autonomous_runs', 'stop_reason', 'TEXT'],
    ['autonomous_runs', 'requirements_json', "TEXT DEFAULT '[]'"],
    ['autonomous_runs', 'success_criteria_json', "TEXT DEFAULT '[]'"],
    ['autonomous_runs', 'technical_context_json', "TEXT DEFAULT '{}'"],
    ['autonomous_runs', 'plan_version', 'INTEGER DEFAULT 1'],
    ['autonomous_runs', 'plan_history_json', "TEXT DEFAULT '[]'"],
    ['autonomous_runs', 'final_validation_json', 'TEXT'],
    ['autonomous_runs', 'complexity_analysis_json', "TEXT DEFAULT '{}'"],
    ['autonomous_runs', 'github_epic_issue_number', 'INTEGER'],
    ['autonomous_runs', 'github_epic_issue_url', 'TEXT'],
    ['autonomous_runs', 'plan_deliberation_id', 'TEXT'],
    ['autonomous_runs', 'research_summary_json', 'TEXT'],
    ['autonomous_runs', 'supervisor_model', 'TEXT'],
    ['autonomous_runs', 'builder_session_id', 'TEXT'],
    ['autonomous_runs', 'started_at', 'TEXT'],
    ['autonomous_runs', 'next_action', 'TEXT'],
    ['autonomous_runs', 'last_error', 'TEXT'],
    ['autonomous_runs', 'current_milestone', 'TEXT'],
    ['autonomous_runs', 'current_task', 'TEXT'],
    ['autonomous_runs', 'current_worker', 'TEXT'],
    ['autonomous_runs', 'iteration', 'INTEGER DEFAULT 0'],
    ['autonomous_runs', 'consecutive_failures', 'INTEGER DEFAULT 0'],
    ['autonomous_runs', 'last_success', 'TEXT'],
    ['autonomous_runs', 'briefing', 'TEXT'],
    ['autonomous_runs', 'autonomy_mode', 'TEXT'],
    ['autonomous_runs', 'branch_name', 'TEXT'],
    ['autonomous_runs', 'max_hours', 'INTEGER DEFAULT 24'],
    ['autonomous_runs', 'max_cycles', 'INTEGER DEFAULT 50'],
    ['autonomous_runs', 'current_cycle', 'INTEGER DEFAULT 0'],
    ['autonomous_runs', 'start_time', 'TEXT'],
    ['autonomous_runs', 'end_time', 'TEXT'],
    ['autonomous_runs', 'config_json', "TEXT DEFAULT '{}'"],
    ['autonomous_runs', 'summary_json', "TEXT DEFAULT '{}'"],
    ['autonomous_tasks', 'updated_at', 'TEXT'],
    ['autonomous_tasks', 'created_at', 'TEXT'],
    ['autonomous_tasks', 'skill_routed', 'TEXT'],
    ['autonomous_tasks', 'skill_confidence', 'REAL DEFAULT 1.0'],
    ['autonomous_tasks', 'skill_guidelines_json', 'TEXT'],
    ['autonomous_tasks', 'stage_code', 'TEXT'],
    ['autonomous_tasks', 'stage_title', 'TEXT'],
    ['autonomous_tasks', 'requirement_ids_json', "TEXT DEFAULT '[]'"],
    ['autonomous_tasks', 'slop_preflight_json', 'TEXT'],
    ['autonomous_tasks', 'research_findings_json', 'TEXT'],
    ['autonomous_tasks', 'council_deliberation_id', 'TEXT'],
    ['autonomous_tasks', 'github_issue_number', 'INTEGER'],
    ['autonomous_tasks', 'github_issue_url', 'TEXT'],
    ['autonomous_tasks', 'github_branch', 'TEXT'],
    ['autonomous_tasks', 'github_pr_number', 'INTEGER'],
    ['autonomous_tasks', 'github_pr_url', 'TEXT'],
    ['autonomous_tasks', 'pr_merged', 'INTEGER DEFAULT 0'],
    ['autonomous_tasks', 'github_state', 'TEXT'],
    ['autonomous_tasks', 'commit_status', 'TEXT'],
    ['autonomous_tasks', 'commit_error', 'TEXT'],
    ['autonomous_tasks', 'task_commit_sha', 'TEXT'],
    ['autonomous_tasks', 'commit_source', 'TEXT'],
    ['autonomous_tasks', 'replan_reason', 'TEXT'],
    ['autonomous_tasks', 'execution_id', 'TEXT'],
    ['autonomous_tasks', 'parent_task_id', 'TEXT'],
    ['autonomous_tasks', 'major_task_id', 'TEXT'],
    ['autonomous_tasks', 'verification_command', 'TEXT'],
    ['autonomous_tasks', 'expected_files_json', "TEXT DEFAULT '[]'"],
    ['autonomous_tasks', 'allowed_scope_json', "TEXT DEFAULT '[]'"],
    ['autonomous_tasks', 'constraints_json', "TEXT DEFAULT '[]'"],
    ['autonomous_tasks', 'required_evidence_json', "TEXT DEFAULT '[]'"],
    ['autonomous_tasks', 'attempt_history_json', "TEXT DEFAULT '[]'"],
    ['autonomous_tasks', 'review_result_json', 'TEXT'],
    ['autonomous_tasks', 'protected_evaluation_files_json', 'TEXT'],
    ['autonomous_tasks', 'lifecycle_state', "TEXT DEFAULT 'PLANNED'"],
    ['account_profiles', 'quota_resets_at', 'TEXT'],
    ['account_profiles', 'quota_exhausted_at', 'TEXT'],
    ['account_profiles', 'quota_message', 'TEXT'],
    ['account_profiles', 'quota_tier', 'TEXT'],
    ['account_profiles', 'is_active', 'INTEGER DEFAULT 1'],
    ['conversations', 'active_account_profile_id', 'TEXT'],
    ['conversations', 'model_name', 'TEXT'],
    ['autonomous_major_tasks', 'updated_at', 'TEXT'],
    ['autonomous_major_tasks', 'created_at', 'TEXT'],
    ['autonomous_major_tasks', 'requirement_ids_json', "TEXT DEFAULT '[]'"],
    ['project_requirements', 'updated_at', 'TEXT'],
    ['project_requirements', 'created_at', 'TEXT'],
    ['agent_turn_observations', 'updated_at', 'TEXT'],
    ['agent_turn_observations', 'created_at', 'TEXT'],
    ['worker_leases', 'updated_at', 'TEXT'],
    ['worker_leases', 'created_at', 'TEXT'],
    ['operational_lessons', 'updated_at', 'TEXT'],
    ['operational_lessons', 'created_at', 'TEXT'],
    ['meta_chat_messages', 'thread_id', 'TEXT'],
    ['meta_chat_messages', 'executed_steps_json', 'TEXT'],
    ['meta_chat_messages', 'updated_at', 'TEXT'],
    ['meta_chat_messages', 'created_at', 'TEXT'],
    ['meta_chat_threads', 'provider_conversation_id', 'TEXT'],
    ['meta_chat_threads', 'files_modified_count', 'INTEGER DEFAULT 0'],
    ['meta_chat_threads', 'last_message_preview', 'TEXT'],
    ['benchmark_runs', 'suite_id', 'TEXT'],
    ['benchmark_runs', 'mode', "TEXT DEFAULT 'FULL_DECOHUB'"],
    ['benchmark_runs', 'git_commit_sha', 'TEXT'],
    ['benchmark_runs', 'decohub_version', 'TEXT'],
    ['benchmark_runs', 'models_tested_json', "TEXT DEFAULT '[]'"],
    ['benchmark_runs', 'overall_score', 'REAL DEFAULT 0'],
    ['benchmark_runs', 'overall_iq_score', 'REAL DEFAULT 0'],
    ['benchmark_runs', 'pass_at_1', 'REAL DEFAULT 0'],
    ['benchmark_runs', 'pass_at_k', 'REAL DEFAULT 0'],
    ['benchmark_runs', 'avg_duration_ms', 'INTEGER DEFAULT 0'],
    ['benchmark_runs', 'updated_at', 'TEXT'],
    ['benchmark_model_results', 'created_at', 'TEXT'],
    ['benchmark_model_results', 'updated_at', 'TEXT'],
    ['benchmark_model_results', 'details_json', 'TEXT']
  ];

  for (const [table, col, colType] of defensiveMigrations) {
    try {
      const tableInfo = targetDb.prepare(`PRAGMA table_info(${table})`).all() as any[];
      if (tableInfo.length > 0 && !tableInfo.some((c: any) => c.name === col)) {
        targetDb.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${colType};`);
      }
    } catch {}
  }

  try {
    targetDb.exec(`
      CREATE TABLE IF NOT EXISTS meta_chat_threads (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        provider_conversation_id TEXT,
        model TEXT DEFAULT 'gemini-3.8-flash',
        effort TEXT DEFAULT 'HIGH',
        account_id TEXT,
        status TEXT DEFAULT 'idle',
        files_modified_count INTEGER DEFAULT 0,
        last_message_preview TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_meta_chat_threads_updated
        ON meta_chat_threads(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_meta_chat_thread_id
        ON meta_chat_messages(thread_id, created_at ASC);
    `);
  } catch {}

  // Auto-migrate legacy meta_chat_messages without thread_id into thread-default
  try {
    const orphanMsgs = targetDb.prepare("SELECT COUNT(*) as c FROM meta_chat_messages WHERE thread_id IS NULL OR thread_id = ''").get() as any;
    if (orphanMsgs && orphanMsgs.c > 0) {
      const now = new Date().toISOString();
      targetDb.prepare(`
        INSERT OR IGNORE INTO meta_chat_threads (id, title, model, effort, status, files_modified_count, created_at, updated_at)
        VALUES ('thread-default', 'Conversa Inicial de Auto-Evolução', 'gemini-3.8-flash', 'HIGH', 'idle', 0, ?, ?)
      `).run(now, now);
      targetDb.prepare("UPDATE meta_chat_messages SET thread_id = 'thread-default' WHERE thread_id IS NULL OR thread_id = ''").run();
    }
  } catch {}
}

initDatabase();
