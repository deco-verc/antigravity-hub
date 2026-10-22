export interface Project {
  id: string;
  name: string;
  path: string;
  objective?: string;
  description?: string;
  stack?: string;
  status: string;
  created_at: string;
  updated_at: string;
  isAvailableOnDisk?: boolean;
  github_repo?: string;
  github_branch?: string;
  github_sync_status?: string;
  github_last_synced_at?: string;
  is_trusted?: boolean;
  full_dev_autonomy?: boolean;
  active_account_profile_id?: string;
  selected_model?: string;
  reasoning_level?: string;
}

export interface ProjectMemory {
  projectMd: string;
  architectureMd: string;
  decisionsMd: string;
  tasksMd: string;
  changesMd: string;
  sessionSummaryMd: string;
}

export interface ParsedTasks {
  pending: string[];
  doing: string[];
  done: string[];
}

export interface GitFileStatus {
  path: string;
  status: 'modified' | 'new' | 'deleted' | 'renamed' | 'other';
}

export interface GitInfo {
  isGitRepo: boolean;
  branch: string | null;
  lastCommit: {
    hash: string;
    message: string;
    author: string;
    date: string;
  } | null;
  statusSummary: {
    modified: number;
    newFiles: number;
    deleted: number;
    total: number;
  };
  changedFiles: GitFileStatus[];
  error?: string;
}

export interface SessionRecord {
  id: string;
  project_id: string;
  session_number: number;
  created_at: string;
  summary: string;
  implemented: string;
  changes: string;
  affected_files: string;
  completed_tasks: string;
  next_step: string;
  checkpoint_raw: string;
}

export interface ChatMessage {
  id: string;
  project_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: string;
  metadata?: string;
}

export interface AnalysisResult {
  projectName: string;
  folderPath: string;
  isEmpty: boolean;
  detectedCategories?: {
    frontend: string[];
    backend: string[];
    infra: string[];
    ai: string[];
  };
  detectedStack: string[];
  primaryStack: string;
  importantFiles: string[];
  scripts: Record<string, string>;
  hasGit: boolean;
  gitInfo: GitInfo;
  readmeExcerpt?: string;
  summary: string;
  fileTree: string[];
  scannedFilesCount?: number;
  packageDetails?: {
    name?: string;
    version?: string;
    description?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
}

export interface FullProjectDetails extends Project {
  isAvailableOnDisk: boolean;
  diskWarning?: string | null;
  memory: ProjectMemory;
  gitInfo: GitInfo;
  parsedTasks: ParsedTasks;
  lastSession?: SessionRecord;
}

export interface SystemHealthData {
  backendStatus: 'online' | 'offline';
  frontendStatus: 'online' | 'offline';
  database: {
    status: 'connected' | 'error';
    path: string;
    sizeBytes: number;
    sizeFormatted: string;
  };
  tools: {
    node: string;
    npm: string;
    python: string;
    git: string;
  };
  os: {
    platform: string;
    release: string;
    arch: string;
    hostname: string;
  };
  hubDataDir: string;
  uptimeSeconds: number;
}

export interface DiagnosticCheck {
  id: string;
  name: string;
  status: 'passed' | 'warning' | 'failed';
  message: string;
  details?: string;
}

export interface LogEntry {
  id: string;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
  timestamp: string;
  metadata?: string;
}

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info' | 'warn';
  message: string;
}

export interface McpStatusData {
  status: string;
  transports: string[];
  toolsCount: number;
  totalCalls: number;
  lastCallTimestamp: string | null;
  tools: Array<{ name: string; description: string }>;
}

export interface ActiveSessionData {
  sessionId: string;
  session_id?: string;
  sessionNumber: number;
  projectId: string;
  projectName: string;
  startTime: string;
  initialGitHead: string | null;
  agentName: string;
  initialContext: string;
}

export type TaskLifecycleState =
  | 'PLANNED'
  | 'READY'
  | 'IN_PROGRESS'
  | 'REVIEW_PENDING'
  | 'APPROVED'
  | 'COMMIT_PENDING'
  | 'COMPLETED'
  | 'REWORK_REQUIRED'
  | 'BLOCKED';

export interface TaskStage {
  code: string;
  title: string;
  objective?: string;
  orderIndex: number;
  status: string;
  totalMicrotasks: number;
  completedMicrotasks: number;
  completedCount?: number;
  progressPct: number;
  microtaskIds: string[];
  requirementIds: string[];
}

export interface ProjectRequirement {
  id: string;
  run_id?: string;
  runId?: string;
  project_id?: string;
  projectId?: string;
  code: string;
  title: string;
  description?: string;
  category: string;
  mandatory: boolean;
  status: 'pending' | 'in_progress' | 'implemented' | 'verified' | 'rejected' | 'blocked' | 'waived';
  verification_status?: 'unverified' | 'tested_passed' | 'tested_failed' | 'review_approved' | 'verified';
  verificationStatus?: 'unverified' | 'tested_passed' | 'tested_failed' | 'review_approved' | 'verified';
  linkedMajorTaskIds: string[];
  linkedStageCodes: string[];
  linkedTaskIds: string[];
  acceptanceCriteria: string[];
  evidence?: {
    passedTests?: string[];
    failedTests?: string[];
    commitShas?: string[];
    reviewIds?: string[];
    evaluationIds?: string[];
    lastVerifiedAt?: string;
  };
  created_at?: string;
  updated_at?: string;
}

export interface PlanDiagnostics {
  runId: string;
  generatedAt: string;
  whatIsMissingToCompleteProject: {
    summary: string;
    incompleteMajorTasks: Array<{ code: string; title: string; status: string; pendingMicrotasks: number; reason: string }>;
    incompleteMicrotasks: Array<{ code: string; title: string; status: string; lifecycleState: string; stageCode?: string | null }>;
    unverifiedRequirements: Array<{ code: string; title: string; status: string; verificationStatus: string }>;
    canCompleteProject: boolean;
  };
  unimplementedRequirements: Array<{
    code: string;
    title: string;
    category: string;
    mandatory: boolean;
    status: string;
    linkedTaskIds: string[];
  }>;
  implementedButUnverifiedFeatures: Array<{
    code: string;
    title: string;
    linkedTaskIds: string[];
    reason: string;
  }>;
  blockedTasksAnalysis: Array<{
    taskId: string;
    code: string;
    title: string;
    lifecycleState: string;
    blockingReason: string;
    unmetDependencies: Array<{ id: string; code: string; title: string; status: string }>;
    retryCount: number;
    maxRetries: number;
  }>;
  nextExecutableTask: {
    task: {
      id: string;
      code: string;
      title: string;
      majorTaskCode?: string;
      stageCode?: string | null;
      requirementIds?: string[];
    } | null;
    parallelEligibleTasks: Array<{
      id: string;
      code: string;
      title: string;
      allowedScope: string[];
    }>;
    scopeDeferredTasks: Array<{
      id: string;
      code: string;
      title: string;
      conflictingTaskId: string;
      conflictingFiles: string[];
      reason: string;
    }>;
    reason: string;
  };
  lastReviewRejection: {
    found: boolean;
    taskId?: string;
    taskCode?: string;
    taskTitle?: string;
    attempt?: number;
    verdict?: string;
    feedback?: string;
    failedCriteria?: string[];
    problemsFound?: string[];
    createdAt?: string;
  };
  completionEvidenceSummary: {
    projectCompleted: boolean;
    progressPct: number;
    taskCompletionPct: number;
    requirementCoveragePct: number;
    requirementVerificationPct: number;
    verifiedCommits: Array<{ taskId: string; code: string; title: string; sha: string }>;
    passedEvaluationsCount: number;
    approvedReviewsCount: number;
    justification: string;
  };
}

export interface MajorTask {
  id: string;
  run_id: string;
  project_id: string;
  code: string;
  title: string;
  objective: string;
  expected_outcome: string;
  requirements: string[];
  requirementIds?: string[];
  acceptanceCriteria: string[];
  dependencies: string[];
  order_index: number;
  status: string;
  lifecycle_state: TaskLifecycleState;
  complexityTier?: string;
  blockingReason?: string | null;
  progressPct: number;
  descendantsTotal?: number;
  descendantsCompleted?: number;
  descendantsPending?: number;
  descendantsBlocked?: number;
  stages?: TaskStage[];
  validationEvidence?: {
    totalMicrotasks?: number;
    completedMicrotasks?: number;
    waivedMicrotasks?: number;
    pendingMicrotasks?: number;
    progressPct?: number;
    commits?: string[];
    allApprovedAndCommitted?: boolean;
    allRequirementsVerified?: boolean;
    unverifiedRequirements?: string[];
    blockingReason?: string | null;
    updatedAt?: string;
  };
  history?: Array<{
    fromState: string;
    toState: string;
    at: string;
    actor: string;
    completedMicrotasks: string;
  }>;
  microtasks: Array<{
    id: string;
    code: string;
    title: string;
    objective: string;
    stageCode?: string | null;
    stageTitle?: string | null;
    parentTaskId?: string | null;
    requirementIds?: string[];
    discoverySource?: string | null;
    blockingReason?: string | null;
    waivedReason?: string | null;
    status: string;
    lifecycleState: TaskLifecycleState;
    retryCount: number;
    maxRetries: number;
    commitSha: string | null;
    reviewDecision: 'APPROVED' | 'REJECTED' | 'BLOCKED' | null;
    verificationCommand: string | null;
    dependencies: string[];
    criteria: string[];
    allowedScope?: string[];
  }>;
}

export interface AgentCommunication {
  id: string;
  idempotency_key?: string | null;
  project_id: string;
  run_id: string;
  major_task_id?: string | null;
  micro_task_id?: string | null;
  execution_id?: string | null;
  attempt: number;
  from_agent: 'supervisor' | 'worker' | 'review' | 'system' | 'user';
  to_agent: 'supervisor' | 'worker' | 'review' | 'system' | 'user';
  message_type: string;
  content: string;
  payload?: Record<string, any>;
  processing_status: string;
  review_id?: string | null;
  evaluation_id?: string | null;
  commit_sha?: string | null;
  created_at: string;
}

export interface TaskStateTransition {
  id: string;
  run_id: string;
  project_id?: string | null;
  entity_type: 'major_task' | 'microtask';
  major_task_id?: string | null;
  task_id?: string | null;
  from_status: string;
  to_status: string;
  from_lifecycle_state: TaskLifecycleState;
  to_lifecycle_state: TaskLifecycleState;
  actor: string;
  reason: string;
  metadata?: Record<string, any>;
  created_at: string;
}

export interface AutonomousTask {
  id: string;
  run_id: string;
  major_task_id?: string | null;
  stage_code?: string | null;
  stage_title?: string | null;
  parent_task_id?: string | null;
  requirement_ids?: string[];
  waived_reason?: string | null;
  discovery_source?: string | null;
  blocking_reason?: string | null;
  subdivision_depth?: number;
  code?: string;
  title: string;
  objective?: string;
  description: string;
  milestone: string;
  order_index: number;
  dependencies: string[];
  status: 'pending' | 'ready' | 'in_progress' | 'in_review' | 'approved' | 'commit_pending' | 'completed' | 'needs_changes' | 'blocked' | 'failed' | 'waived';
  lifecycle_state?: TaskLifecycleState;
  lifecycleState?: TaskLifecycleState;
  assigned_to: string;
  retry_count: number;
  max_retries?: number;
  attempt_history?: any[];
  criteria: string[];
  expected_files?: string[];
  allowed_scope?: string[];
  constraints?: string[];
  test_strategy?: string;
  required_evidence?: string[];
  verification_command?: string;
  review_decision?: 'APPROVED' | 'REJECTED' | 'BLOCKED' | null;
  review_result?: any;
  task_commit_sha?: string | null;
  commit_status?: string;
  commit_message?: string | null;
  replan_origin_task_id?: string | null;
  replan_type?: 'NEW_FEATURE' | 'DEFECT_FIX' | 'REQUIREMENT_CHANGE' | null;
  replan_reason?: string | null;
  created_at: string;
  updated_at: string;
  github_issue_number?: number;
  github_issue_url?: string;
  github_pr_number?: number;
  github_pr_url?: string;
  github_branch?: string;
  github_state?: string;
  skill_routed?: string;
  skill_guidelines_json?: string;
  skillGuidelines?: string[];
  council_deliberation_id?: string;
  slop_preflight_json?: string;
  slopPreflight?: any;
  research_findings_json?: string;
  researchFindings?: any;
}

export interface AutonomousApproval {
  id: string;
  run_id: string;
  task_id?: string;
  risk_level: 'green' | 'yellow' | 'orange' | 'red';
  title: string;
  context: string;
  why_needed: string;
  alternatives: string[];
  supervisor_recommendation: string;
  impact?: string;
  risk?: string;
  status: 'pending' | 'approved' | 'rejected' | 'delegated';
  decision?: string;
  decided_at?: string;
  created_at: string;
}

export interface AutonomousEvent {
  id: string;
  run_id: string;
  task_id?: string;
  agent_role: 'supervisor' | 'builder' | 'evaluator' | 'system' | 'user';
  event_type: string;
  message: string;
  metadata_json?: string;
  created_at: string;
}

export interface AutonomousRun {
  controlRequest?:{action:'pause'|'cancel';status:'pending'|'applied';requested_at:string}|null;
  id: string;
  project_id: string;
  name: string;
  objective: string;
  briefing: string;
  status: 'running' | 'paused' | 'waiting_approval' | 'waiting_resource' | 'completed' | 'failed' | 'building' | 'testing' | 'reviewing' | 'planning' | 'waiting_for_worker' | 'blocked' | 'error';
  autonomy_mode: 'safe' | 'balanced' | 'autonomous';
  branch_name: string;
  max_hours: number;
  max_cycles: number;
  current_cycle: number;
  progress_pct?: number;
  progressPct?: number;
  start_time: string;
  end_time?: string;
  current_milestone?: string | null;
  current_task?: string | null;
  current_worker?: string | null;
  next_action?: string | null;
  activeSlashCommand?: string | null;
  activeSkillsList?: string[];
  currentExecutionSpecialty?: string | null;
  last_error?: string | null;
  last_success?: string | null;
  github_epic_issue_number?: number;
  github_epic_issue_url?: string;
  plan_deliberation_id?: string;
  research_summary_json?: string;
  research_summary?: any;
  councilDeliberations?: CouncilDeliberation[];
  project?: Project;
  majorTasks?: MajorTask[];
  tasks: AutonomousTask[];
  stateTransitions?: TaskStateTransition[];
  agentCommunications?: AgentCommunication[];
  requirements?: string[];
  projectRequirements?: ProjectRequirement[];
  diagnostics?: PlanDiagnostics;
  complexityAnalysis?: any;
  successCriteria?: string[];
  planVersion?: number;
  planHistory?: any[];
  finalValidation?: any;
  approvals: AutonomousApproval[];
  events: AutonomousEvent[];
  reports: any[];
  reviews?: any[];
  stats: {
    total: number;
    completed: number;
    inProgress: number;
    inReview: number;
    pending: number;
    blocked: number;
    rejected?: number;
    waitingApproval: number;
    progressPct: number;
    activeSlashCommand?: string | null;
    currentExecutionSpecialty?: string | null;
    taskProgressPct?: number;
    majorTasksTotal?: number;
    majorTasksCompleted?: number;
    requirementsTotal?: number;
    requirementsImplemented?: number;
    requirementsVerified?: number;
    requirementsPending?: number;
    requirementsCoveragePct?: number;
    requirementsVerificationPct?: number;
  };
}

export type AuthStatus =
  | 'AUTH_UNKNOWN'
  | 'DETECTED'
  | 'READY'
  | 'WAITING_LOGIN'
  | 'VERIFYING'
  | 'LOGIN_REQUIRED'
  | 'ACTIVE'
  | 'ERROR'
  | 'OFFLINE'
  | 'NEEDS_LOGIN'
  | 'AUTHENTICATING'
  | 'QUOTA_EXHAUSTED'
  | 'NOT_CONFIGURED'
  | 'RATE_LIMITED'
  | 'AUTH_ERROR'
  | 'RUNTIME_UNAVAILABLE'
  | 'UNKNOWN';

export type QuotaSource = 'CLI' | 'AGENTAPI' | 'ESTIMATED';
export type QuotaUnit = 'REQUESTS' | 'TOKENS' | 'CREDITS' | 'UNKNOWN';
export type QuotaValidityState = 'VALID' | 'STALE' | 'UNKNOWN';

export interface NormalizedQuotaInfo {
  accountProfileId: string;
  authenticatedIdentity: string | null;
  source: QuotaSource;
  modelOrBucket: string;
  availableQuota: number | null;
  quotaUnit: QuotaUnit;
  resetsAt: string | null;
  creditsAvailable: number | null;
  creditsStatus?: 'AVAILABLE' | 'UNKNOWN' | 'NOT_EXPOSED';
  creditsDisclaimer?: string;
  lastUpdated: string;
  validityState: QuotaValidityState;
  queryError: string | null;
}

export interface AccountProfile {
  id: string;
  name?: string;
  display_name: string;
  profile_name: string;
  email?: string | null;
  google_account_label: string | null;
  environment_path: string;
  auth_status: AuthStatus;
  is_active?: boolean;
  last_tested: string | null;
  quota_resets_at?: string | null;
  quota_message?: string | null;
  created_at: string;
  updated_at: string;
}

export interface AccountProjectSession {
  id: string;
  project_id: string;
  account_profile_id: string;
  conversation_id: string;
  last_active_at: string;
  metadata_json?: string;
}

export interface RapidSwitchResult {
  switched: boolean;
  previousProfile: AccountProfile;
  activeProfile: AccountProfile;
  runtimeOnline: boolean;
  runtimeAddress: string | null;
  conversationId: string;
  checkpointCreated: boolean;
  message: string;
}

export interface FileNode {
  name: string;
  relativePath: string;
  isDirectory: boolean;
  size?: number;
  children?: FileNode[];
}

export interface FileContentResponse {
  content: string;
  path: string;
  size: number;
  extension: string;
}

export interface GitDiffFile {
  file: string;
  additions: number;
  deletions: number;
  status: string;
}

export interface GitDiffResponse {
  diff: string;
  files: GitDiffFile[];
  rawSummary: string;
}

export interface TerminalLogsResponse {
  project: string;
  path: string;
  logs: Array<{
    type: string;
    command: string;
    output: string;
    created_at: string;
  }>;
  gitLog: string;
}

export interface CouncilReviewerOutput {
  reviewerId: string;
  roleName: 'Correctness' | 'Simplicity' | 'Regression';
  anonymousLabel: string;
  verdict: 'APPROVED' | 'CHANGES_REQUESTED' | 'BLOCKED';
  score: number;
  findings: string[];
  blockingIssues: string[];
  suggestions: string[];
  rawAnalysis: string;
}

export interface CouncilPeerRankingResult {
  reviewerLabel: string;
  rankedReviews: string[];
  justification: string;
}

export interface CouncilDeliberation {
  id: string;
  taskId: string;
  projectId: string;
  runId?: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  policyTrigger: string;
  reviews: CouncilReviewerOutput[];
  peerRankings: CouncilPeerRankingResult[];
  consensusLevel: 'UNANIMOUS' | 'MAJORITY' | 'SPLIT' | 'CHAIRMAN_OVERRIDE';
  scores: {
    correctness: number;
    simplicity: number;
    regression: number;
    final: number;
  };
  chairmanVerdict: 'APPROVED' | 'CHANGES_REQUESTED' | 'BLOCKED';
  chairmanSynthesis: string;
  actionItems: string[];
  createdAt: string;
}

export interface ArenaActivityEvent {
  time: string;
  message: string;
  type: 'info' | 'candidate' | 'evaluator' | 'council' | 'winner' | 'error';
}

export interface ArenaCandidateData {
  id: string;
  arenaRunId: string;
  candidateLabel: string;
  strategyDescription: string;
  workerId: string;
  accountProfileId?: string | null;
  branch: string;
  workspace: string;
  status: 'CREATED' | 'WORKING' | 'COMPLETED' | 'FAILED' | 'EVALUATED' | 'DISCARDED' | 'WINNER';
  commitSha?: string | null;
  filesChanged: string[];
  linesAdded: number;
  linesRemoved: number;
  testResults?: {
    passed: number;
    total: number;
    exitCode: number;
    output: string;
  };
  metricResults?: {
    latencyMs?: number;
    durationMs?: number;
    throughput?: number;
    memoryMb?: number;
  };
  complexityCost: number;
  complexityScore: number;
  evaluationScore: number;
  councilScore: number;
  finalRank?: number | null;
  createdAt: string;
  completedAt?: string | null;
}

export interface ArenaRunData {
  id: string;
  projectId: string;
  taskId: string;
  taskTitle: string;
  taskDescription: string;
  successContractId?: string | null;
  status: 'PLANNING' | 'RUNNING' | 'EVALUATING' | 'COUNCIL' | 'SELECTING_WINNER' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  candidateCount: number;
  baselineCommit: string;
  winnerCandidateId?: string | null;
  chairmanReason?: string | null;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  resourcePolicy: {
    maxCandidates: number;
    maxMinutes: number;
    timeoutPerCandidateMs: number;
  };
  activityStream: ArenaActivityEvent[];
  candidates?: ArenaCandidateData[];
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
}

export interface ArenaCouncilResult {
  winnerCandidateLabel: string | null;
  verdict: 'WINNER' | 'NO_ACCEPTABLE_CANDIDATE';
  confidence: number;
  reason: string;
  peerRankings: Array<{
    reviewer: string;
    rankedOrder: string[];
    justification: string;
  }>;
  rejectedCandidates: Array<{
    candidate: string;
    reason: string;
  }>;
  candidateScores: Record<string, {
    correctness: number;
    simplicity: number;
    regression: number;
    overall: number;
  }>;
}

export interface BenchmarkTaskData {
  id: string;
  title: string;
  category: string;
  difficulty: 'simple' | 'medium' | 'hard';
  isHoldout: boolean;
  briefing: string;
  allowedFilesToModify: string[];
  expectedBehavior: string;
  timeLimitMs: number;
  riskLevel: 'low' | 'medium' | 'high';
}

export interface TaskRunResultData {
  id: string;
  runId: string;
  taskId: string;
  title: string;
  category: string;
  difficulty: string;
  isHoldout: boolean;
  status: 'PASS' | 'FAIL' | 'TAMPERED';
  correctness: boolean;
  testOutput: string;
  durationMs: number;
  filesChanged: string[];
  unnecessaryFilesCount: number;
  linesAdded: number;
  linesRemoved: number;
  surgicalScore: number;
  complexityScore: number;
  compositeScore: number;
  failureReason?: string;
  builderConversationId?: string;
  workerId?: string;
  resultCommit?: string | null;
  gitBranch?: string | null;
  commandsExecuted?: string[];
  createdAt: string;
}

export interface BenchmarkRunSummaryData {
  id: string;
  versionLabel: string;
  gitCommit: string | null;
  benchmarkLevel?: 'FAST' | 'AGENT';
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  totalTasks: number;
  passedTasks: number;
  passRate: number;
  avgSurgicalScore: number;
  avgSimplicityScore: number;
  avgTimeMs: number;
  regressionCount: number;
  compositeScore: number;
  isBaseline: boolean;
  summary: Record<string, any>;
  results?: TaskRunResultData[];
  createdAt: string;
  completedAt?: string;
}

export interface VersionComparisonResultData {
  versionA: { id: string; label: string; passRate: number; compositeScore: number; avgTimeMs: number; avgSurgical: number };
  versionB: { id: string; label: string; passRate: number; compositeScore: number; avgTimeMs: number; avgSurgical: number };
  deltaPassRate: number;
  deltaComposite: number;
  deltaSurgical: number;
  deltaTimeMs: number;
  regressedTasks: Array<{ taskId: string; title: string; failureReason?: string }>;
  improvedTasks: Array<{ taskId: string; title: string }>;
  regressionGatePassed: boolean;
  verdict: 'VERSION_B_WINS' | 'VERSION_A_WINS' | 'TIE' | 'REGRESSION_REJECTED';
  rationale: string;
}

export interface SelfImprovementExperimentData {
  id: string;
  experimentNumber: number;
  hypothesis: string;
  bottleneckIdentified: string;
  baselineRunId: string;
  status: 'PROPOSING' | 'ARENA_RUNNING' | 'BENCHMARKING' | 'EVALUATING' | 'KEEP' | 'DISCARD' | 'CRASH';
  benchmarkLevel?: 'FAST' | 'AGENT';
  candidateAScore: number;
  candidateBScore: number;
  winnerCandidate: string | null;
  winningCommitSha?: string | null;
  promotedVersionLabel?: string | null;
  candidateABranch?: string | null;
  candidateBBranch?: string | null;
  candidateACommit?: string | null;
  candidateBCommit?: string | null;
  verdict: 'KEEP' | 'DISCARD' | 'CRASH' | 'TRADEOFF_REVIEW' | 'REGRESSION_REJECTED' | 'INSUFFICIENT_EVIDENCE' | null;
  rationale: string | null;
  targetMetric?: string;
  targetImprovementPct?: number;
  globalImpactPct?: number;
  originalVerdict?: string;
  reevaluatedVerdict?: string;
  councilRecommendation?: string;
  createdAt: string;
  completedAt?: string;
  baselineRun?: BenchmarkRunSummaryData | null;
}

export type SelfImprovementRunStatus =
  | 'INITIALIZING'
  | 'BASELINING'
  | 'ANALYZING'
  | 'FORMING_HYPOTHESIS'
  | 'GENERATING_CANDIDATES'
  | 'BENCHMARKING'
  | 'PROMOTION_REVIEW'
  | 'PROMOTING'
  | 'NEXT_ROUND'
  | 'PAUSED'
  | 'COMPLETED'
  | 'BLOCKED'
  | 'FAILED'
  | 'CANCELLED';

export type SelfImprovementPreset = 'OVERNIGHT' | 'CONSERVATIVE' | 'RESEARCH' | 'TEST_SHORT' | 'E2E_PROOF';

export interface TimelineEvent {
  timestamp: string;
  event: string;
  details?: string;
  experimentNumber?: number;
}

export interface SelfImprovementRunData {
  id: string;
  baselineCommit: string;
  currentBestCommit: string;
  status: SelfImprovementRunStatus;
  startedAt: string;
  endedAt?: string | null;
  budgetMinutes: number;
  elapsedMinutes: number;
  maxExperiments: number;
  completedExperiments: number;
  candidatesPerExperiment: number;
  keptCount: number;
  discardedCount: number;
  crashedCount: number;
  blockedCount: number;
  initialMetrics: any;
  currentMetrics: any;
  stopReason: string | null;
  preset: SelfImprovementPreset;
  timeline: TimelineEvent[];
  config: any;
  createdAt: string;
  updatedAt: string;
}
export interface ModelOption {
  id: string; // 'flash_lite' | 'flash' | 'pro'
  displayName: string;
  family: string;
  speed: 'fastest' | 'fast' | 'standard';
  reasoning: 'basic' | 'balanced' | 'deep';
  description: string;
  available: boolean;
  intelligenceLevel?: 'HIGH' | 'MEDIUM' | 'LOW';
  canonicalModel?: string;
  isSystemDefault?: boolean;
}

export type ModelSelectorValue = 'auto' | 'flash_lite' | 'flash' | 'pro';

export interface ModelPreferences {
  default: ModelSelectorValue;
  supervisor?: ModelSelectorValue;
  builder?: ModelSelectorValue;
  reviewer?: ModelSelectorValue;
  council?: ModelSelectorValue;
  intelligence_level?: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface UsageSummary {
  todayExecutions: number;
  todayDurationSeconds: number;
  byModelToday: Record<string, number>;
  byRoleToday: Record<string, number>;
  byAccountToday: Record<string, number>;
  allTimeExecutions: number;
  quotaDisclaimer: string;
}

export interface UsageEvent {
  id: string;
  timestamp: string;
  account_profile_id?: string | null;
  model_id: string;
  role: string;
  project_id?: string | null;
  conversation_id?: string | null;
  task_id?: string | null;
  duration_ms: number;
  status: string;
  tool_calls_count: number;
  metadata_json?: string | null;
}

export interface ProjectAutonomy {
  projectId: string;
  projectName: string;
  projectPath: string;
  isTrusted: boolean;
  fullDevAutonomy: boolean;
  environment?: {
    packageManager: string;
    stack: string;
    testScript?: string;
    buildScript?: string;
    devScript?: string;
    startScript?: string;
    hasTests: boolean;
    lockfile?: string;
  };
  guidelinesBlock?: string;
}

export interface SystemSettingsResponse {
  settings: Record<string, string>;
  fullDevAutonomyDefault: boolean;
}

export type AgentRoleType = 'SUPERVISOR' | 'WORKER';
export type AgentSessionStatusType = 'ACTIVE' | 'ARCHIVED' | 'ROTATING' | 'INVALID';
export type AgentRuntimeState = 'IDLE' | 'RUNNING' | 'WAITING' | 'EVALUATING' | 'ROTATING' | 'BLOCKED' | 'ERROR';

export interface AgentSessionClientRecord {
  id: string;
  project_id: string;
  role: AgentRoleType;
  logical_conversation_id: string;
  provider_conversation_id: string;
  generation: number;
  status: AgentSessionStatusType;
  created_at: string;
  last_used_at: string;
  last_successful_turn_at: string | null;
  context_estimate: number;
  rotation_reason: string | null;
  checkpoint_reference: string | null;
  metadata_json: string | null;
}

export interface AgentSessionsResponse {
  projectId: string;
  projectName: string;
  activeSupervisor: AgentSessionClientRecord | null;
  activeWorker: AgentSessionClientRecord | null;
  archivedSessions: AgentSessionClientRecord[];
  states: {
    supervisor: 'IDLE' | 'RUNNING' | 'ROTATING' | 'ERROR';
    worker: 'IDLE' | 'RUNNING' | 'WAITING' | 'ROTATING' | 'BLOCKED' | 'ERROR';
    evaluator: 'IDLE' | 'EVALUATING';
  };
}

export interface SessionAuditReportClient {
  timestamp: string;
  totalAgentSessions: number;
  activeSessionsCount: number;
  archivedSessionsCount: number;
  invalidSessionsCount: number;
  byProject: Record<string, {
    projectName: string;
    supervisor?: AgentSessionClientRecord;
    worker?: AgentSessionClientRecord;
    archivedCount: number;
  }>;
  unassociatedLegacyCount: number;
  findings: string[];
}

export type LogLevel = 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';

export interface StructuredError {
  name: string;
  message: string;
  code?: string;
  stack?: string;
  cause?: string;
  isRetryable?: boolean;
}

export interface ObservabilityEvent {
  id: string;
  timestamp: string;
  level: LogLevel;
  event: string;
  message: string;
  service: string;
  environment: string;
  processId: number;
  sessionId?: string;
  correlationId?: string;
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  runId?: string;
  taskId?: string;
  milestone?: string;
  projectId?: string;
  conversationId?: string;
  attempt?: number;
  durationMs?: number;
  status?: string;
  error?: StructuredError;
  metadata?: Record<string, any>;
  createdAt: string;
}

export interface DetectedAnomaly {
  id: string;
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  affectedEntity: {
    type: 'run' | 'task' | 'lease' | 'reservation' | 'agent' | 'system';
    id: string;
    name?: string;
  };
  timeSinceLastProgressMs: number;
  lastKnownEvent?: string;
  currentPersistedState: Record<string, any>;
  evidence: string[];
  hypotheses: string[];
  recommendedAction: string;
  detectedAt: string;
}

export interface GroupedError {
  errorKey: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
  sampleEvent: ObservabilityEvent;
}

export interface ObservabilityHealthReport {
  status: 'healthy' | 'degraded' | 'unhealthy';
  databaseConnected: boolean;
  totalEventsCount: number;
  eventsLast24Hours: number;
  errorsLast24Hours: number;
  activeAnomaliesCount: number;
  fileLogger: {
    directory: string;
    eventsLogSize: number;
    eventsLogSizeBytes: number;
    backendLogSize: number;
    backendLogSizeBytes: number;
    rotatedFilesCount: number;
  };
  inMemoryQueue: {
    pendingEvents: number;
    droppedEventsCount: number;
  };
}

export interface ObservabilityEventsResponse {
  events: ObservabilityEvent[];
  total: number;
  limit: number;
  offset: number;
}

// -------------------------------------------------------------
// FASE 11: PROJECT OPERATIONS, PREVIEW LAUNCHER & DOCSIMP .ENV STUDIO
// -------------------------------------------------------------

export interface PreviewStatus {
  projectId: string;
  running: boolean;
  status?: 'STOPPED' | 'STARTING' | 'RUNNING' | 'ERROR';
  pid?: number;
  port?: number;
  url?: string;
  entrypoint?: string;
  startedAt?: string;
  logs: string[];
  error?: string;
}

export type EnvKeyCategory =
  | 'PAYMENTS'
  | 'DATABASE_AUTH'
  | 'CACHE_RATELIMIT'
  | 'BOT_PROTECTION'
  | 'AI_MODELS'
  | 'SERVER_CONFIG'
  | 'OTHER';

export interface EnvKeyItem {
  key: string;
  value: string;
  rawStatus: 'LIVE' | 'MOCK_FALLBACK';
  category: EnvKeyCategory;
  description: string;
  isSecret: boolean;
  defaultValue?: string;
}

export interface ProjectEnvStudioData {
  projectId: string;
  envPath: string;
  envExamplePath?: string;
  keys: EnvKeyItem[];
  totalKeys: number;
  liveCount: number;
  mockCount: number;
}

export interface HomologationBadge {
  id: 'dev_tests' | 'ui_anti_slop' | 'ux_journey' | 'appsec_pentest';
  title: string;
  subtitle: string;
  status: 'PASSED' | 'FAILED' | 'PENDING';
  score?: number;
  details: string;
  icon: string;
}

export interface HomologationScreenshotItem {
  filename: string;
  label: string;
  url: string;
  sizeBytes: number;
  updatedAt: string;
  title?: string;
  sectionName?: string;
  index?: number;
  total?: number;
}

export interface HomologationEvidenceData {
  projectId: string;
  projectName: string;
  overallPassed: boolean;
  overallScore: number;
  badges: HomologationBadge[];
  reports: {
    userJourney?: any;
    securityPentest?: any;
    visualInspection?: any;
  };
  screenshots: HomologationScreenshotItem[];
}

export interface MetaChatThread {
  id: string;
  title: string;
  provider_conversation_id?: string | null;
  model: string;
  effort: string;
  account_id?: string | null;
  status: 'idle' | 'running';
  files_modified_count: number;
  last_message_preview?: string | null;
  created_at: string;
  updated_at: string;
}

export interface MetaChatPipelineTask {
  id: 'task-inspect' | 'task-implement' | 'task-verify' | 'task-guard';
  label: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
  details?: string;
}

export interface MetaChatLiveStep {
  id: string;
  type: 'READ' | 'SEARCH' | 'EDIT' | 'COMMAND' | 'GUARD';
  target: string;
  status: 'running' | 'done' | 'failed';
  timestamp: string;
  durationMs?: number;
  details?: string;
}

export interface MetaChatLiveActivity {
  isExecuting: boolean;
  threadId?: string;
  activeAccount?: string;
  activeModel?: string;
  currentActionSummary: string;
  elapsedMs: number;
  pipelineTasks: MetaChatPipelineTask[];
  liveSteps: MetaChatLiveStep[];
  filesModified: string[];
}

export interface MetaChatAttachment {
  name: string;
  size?: number;
  type?: string;
  base64Content?: string;
  content?: string;
  diskPath?: string;
  isImage?: boolean;
}

export interface MetaChatMessageItem {
  id: string;
  thread_id?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  executed_steps_json?: string | null;
  metadata?: {
    files_changed?: string[];
    filesModified?: string[];
    typecheck?: {
      passed: boolean;
      duration_ms: number;
      output?: string;
    };
    tests?: {
      ran: boolean;
      passed: boolean;
      command?: string;
      output?: string;
    };
    recompiled?: boolean;
    synced?: boolean;
    error?: string;
    conversationId?: string;
    model?: string;
    reasoningMode?: 'high' | 'medium' | 'low';
    accountId?: string;
    attachments?: Array<{
      name: string;
      size?: number;
      type?: string;
      diskPath?: string;
      isImage?: boolean;
    }>;
    executedSteps?: MetaChatLiveStep[];
    pipelineTasks?: MetaChatPipelineTask[];
    [key: string]: any;
  } | null;
  created_at: string;
}

export interface MetaChatResponseData {
  success?: boolean;
  message?: MetaChatMessageItem;
  turnId?: string;
  status?: string;
  filesChanged?: string[];
  typecheck?: {
    passed: boolean;
    durationMs: number;
    output?: string;
  };
  tests?: {
    ran: boolean;
    passed: boolean;
    output?: string;
  };
  selfHealed?: boolean;
  conversationId?: string;
}

export interface MetaChatRecompileResult {
  success: boolean;
  message: string;
  durationMs: number;
  serverBuild?: string;
  clientBuild?: string;
  synced?: boolean;
}

export interface MetaChatLiveStatus {
  isRunning: boolean;
  isExecuting?: boolean;
  phase: string;
  currentPhase?: string;
  activeAccount?: string;
  activeAccountId?: string;
  activeModel?: string;
  startedAt?: string;
  elapsedSeconds?: number;
  lastStep?: string;
  cancelRequested?: boolean;
}

export interface MetaChatAutopilotStatus {
  enabled: boolean;
  isExecutingCycle: boolean;
  mode: 'CONTINUOUS' | 'BATCH';
  maxCycles: number;
  completedCycles: number;
  keptEvolutions: number;
  revertedEvolutions: number;
  cooldownSeconds: number;
  activeThreadId?: string;
  lastCycleSummary?: string;
  startedAt?: string;
}

export interface DecoMindMlStatus {
  samplesSeen: number;
  runningAccuracy: number;
  runningBrierLoss: number;
  weights: number[];
  topBanditArms: Array<{
    arm_key: string;
    category: string;
    model_tier: string;
    effort_level: string;
    pulls: number;
    mean_reward: number;
  }>;
  topEpisodicMemories: Array<{
    id: string;
    task_category: string;
    error_pattern: string;
    surgical_vaccine: string;
    q_value: number;
  }>;
  topUnderperformingArms?: Array<{
    arm_key: string;
    mean_reward: number;
  }>;
  episodicMemoriesCount: number;
}

export interface SlashCommandItem {
  command: string;
  aliases: string[];
  title: string;
  description: string;
  category: 'Design & UI' | 'Playwright Vision' | 'Architecture' | 'Security & QA' | 'Docs & Workflow' | 'Code Quality' | string;
  skillsUsed: string[];
  executionType: 'IMMEDIATE_TOOL' | 'AUTONOMOUS_DELTA';
  argHint?: string;
}



