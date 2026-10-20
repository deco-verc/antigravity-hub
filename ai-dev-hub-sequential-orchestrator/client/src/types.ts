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

export interface AutonomousTask {
  id: string;
  run_id: string;
  title: string;
  description: string;
  milestone: string;
  order_index: number;
  dependencies: string[];
  status: 'pending' | 'ready' | 'in_progress' | 'in_review' | 'completed' | 'blocked' | 'failed';
  assigned_to: string;
  retry_count: number;
  criteria: string[];
  created_at: string;
  updated_at: string;
  github_issue_number?: number;
  github_issue_url?: string;
  github_pr_number?: number;
  github_pr_url?: string;
  github_branch?: string;
  github_state?: string;
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
  agent_role: 'supervisor' | 'builder' | 'system' | 'user';
  event_type: string;
  message: string;
  metadata_json?: string;
  created_at: string;
}

export interface AutonomousRun {
  id: string;
  project_id: string;
  name: string;
  objective: string;
  briefing: string;
  status: 'running' | 'paused' | 'waiting_approval' | 'completed' | 'failed' | 'building' | 'testing' | 'reviewing' | 'planning' | 'waiting_for_worker' | 'error';
  autonomy_mode: 'safe' | 'balanced' | 'autonomous';
  branch_name: string;
  max_hours: number;
  max_cycles: number;
  current_cycle: number;
  start_time: string;
  end_time?: string;
  current_milestone?: string | null;
  current_task?: string | null;
  current_worker?: string | null;
  next_action?: string | null;
  last_error?: string | null;
  last_success?: string | null;
  github_epic_issue_number?: number;
  github_epic_issue_url?: string;
  project?: Project;
  tasks: AutonomousTask[];
  approvals: AutonomousApproval[];
  events: AutonomousEvent[];
  reports: any[];
  stats: {
    total: number;
    completed: number;
    inProgress: number;
    inReview: number;
    pending: number;
    blocked: number;
    waitingApproval: number;
    progressPct: number;
  };
}

export type AuthStatus = 'READY' | 'WAITING_LOGIN' | 'VERIFYING' | 'LOGIN_REQUIRED' | 'ACTIVE' | 'ERROR' | 'OFFLINE' | 'NEEDS_LOGIN' | 'AUTHENTICATING' | 'QUOTA_EXHAUSTED';

export interface AccountProfile {
  id: string;
  display_name: string;
  profile_name: string;
  google_account_label: string | null;
  environment_path: string;
  auth_status: AuthStatus;
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
}

export type ModelSelectorValue = 'auto' | 'flash_lite' | 'flash' | 'pro';

export interface ModelPreferences {
  default: ModelSelectorValue;
  supervisor?: ModelSelectorValue;
  builder?: ModelSelectorValue;
  reviewer?: ModelSelectorValue;
  council?: ModelSelectorValue;
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
