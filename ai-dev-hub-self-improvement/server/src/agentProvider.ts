export interface SupervisorToBuilderContract {
  task: {
    id: string;
    title: string;
    description: string;
    milestone: string;
    verificationCommand?: string;
    doneWhen?: string;
  };
  context: {
    projectName: string;
    projectPath: string;
    objective: string;
    stack?: string;
    programMd?: string;
  };
  requirements: string[];
  acceptanceCriteria: string[];
  constraints: string[];
  expectedScopeFiles?: string[];
  supervisorInstructions: string;
  engineeringPackage?: {
    contextHash?: string;
    formattedPromptBlock?: string;
  };
}

export interface BuilderToSupervisorContract {
  status: 'success' | 'failure';
  filesChanged: string[];
  implemented: string[];
  commandsExecuted: string[];
  toolCallsCount?: number;
  tests: {
    ran: boolean;
    command?: string;
    output?: string;
    passed?: boolean;
  };
  buildStatus: string;
  browserValidation?: string;
  screenshots?: string[];
  problems: string[];
  decisions: Array<{ decision: string; rationale: string }>;
  agentThoughts?: string;
  rawResponse?: string;
  thinkBeforeCoding?: {
    assumptions: string[];
    ambiguities: string[];
    selectedApproach: string;
    reason: string;
    clarificationRequired: boolean;
  };
  simplicityCheck?: {
    isSimplestSolution: boolean;
    explanation?: string;
  };
  isSurgical?: boolean;
}

export interface SupervisorReviewContract {
  verdict: 'APPROVED' | 'CHANGES_REQUESTED' | 'BLOCKED';
  feedback: string;
  nextAction: string;
  qualityScore?: number;
  criticisms?: string[];
  simplicityScore?: number;
  isSurgical?: boolean;
  unrelatedFilesDetected?: string[];
}

export interface AgentSessionStatus {
  sessionId: string;
  state: 'idle' | 'running' | 'completed' | 'error';
  lastActivityAt: string;
  stepsCount: number;
}

export interface AgentProvider {
  startAgent(options: { model?: 'flash' | 'pro' | 'flash_lite'; title: string; initialPrompt?: string }): Promise<string>;
  sendTask(sessionId: string, taskInput: SupervisorToBuilderContract, options?: any): Promise<{ sessionId: string; rotated: boolean } | void>;
  getStatus(sessionId: string): Promise<AgentSessionStatus>;
  getResult(sessionId: string, timeoutMs?: number, projectPath?: string, isCancelled?: () => boolean): Promise<BuilderToSupervisorContract>;
  cancelTask(sessionId: string): Promise<void>;
}
