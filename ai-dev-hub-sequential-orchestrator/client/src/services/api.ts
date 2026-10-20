import {
  Project,
  FullProjectDetails,
  ProjectMemory,
  AnalysisResult,
  SessionRecord,
  ChatMessage,
  GitInfo,
  SystemHealthData,
  DiagnosticCheck,
  LogEntry,
  McpStatusData,
  AutonomousRun,
  AccountProfile,
  AccountProjectSession,
  AuthStatus,
  FileNode,
  FileContentResponse,
  GitDiffResponse,
  TerminalLogsResponse,
  CouncilDeliberation,
  ArenaRunData,
  ArenaCandidateData,
  ArenaCouncilResult,
  BenchmarkTaskData,
  BenchmarkRunSummaryData,
  VersionComparisonResultData,
  SelfImprovementExperimentData,
  ModelOption,
  ModelPreferences,
  ModelSelectorValue,
  UsageSummary,
  UsageEvent,
  ProjectAutonomy,
  SystemSettingsResponse,
  AgentSessionsResponse,
  SessionAuditReportClient
} from '../types';

const API_BASE = '/api';

export const api = {
  async getProjects(): Promise<Project[]> {
    const res = await fetch(`${API_BASE}/projects`);
    if (!res.ok) throw new Error('Falha ao carregar projetos');
    return res.json();
  },

  async getProject(id: string): Promise<FullProjectDetails> {
    const res = await fetch(`${API_BASE}/projects/${id}`);
    if (!res.ok) throw new Error('Falha ao carregar detalhes do projeto');
    return res.json();
  },

  async createProject(data: {
    name: string;
    folderPath: string;
    objective?: string;
    description?: string;
    stack?: string;
    initGit?: boolean;
    initialProfileId?: string;
    githubAction?: 'none' | 'create_private' | 'link_existing';
    githubRepo?: string;
    githubToken?: string;
  }): Promise<Project> {
    const res = await fetch(`${API_BASE}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Erro desconhecido' }));
      throw new Error(err.error || 'Falha ao criar projeto');
    }
    return res.json();
  },

  async updateProject(id: string, data: Partial<Project>): Promise<Project> {
    const res = await fetch(`${API_BASE}/projects/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error('Falha ao atualizar projeto');
    return res.json();
  },

  async deleteProject(id: string): Promise<void> {
    const res = await fetch(`${API_BASE}/projects/${id}`, {
      method: 'DELETE'
    });
    if (!res.ok) throw new Error('Falha ao remover projeto');
  },

  async analyzeFolder(folderPath: string): Promise<AnalysisResult> {
    const res = await fetch(`${API_BASE}/projects/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderPath })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Erro ao analisar pasta' }));
      throw new Error(err.error || 'Falha ao analisar diretório');
    }
    return res.json();
  },

  async validatePath(targetPath: string): Promise<{
    isValid: boolean;
    exists: boolean;
    isDirectory: boolean;
    isEmpty: boolean;
    resolvedPath: string;
    errorMessage?: string;
    subDirs: string[];
  }> {
    const res = await fetch(`${API_BASE}/fs/validate-path`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetPath })
    });
    if (!res.ok) throw new Error('Falha ao validar caminho');
    return res.json();
  },

  async getQuickPaths(): Promise<{ suggestions: Array<{ label: string; path: string }> }> {
    const res = await fetch(`${API_BASE}/fs/quick-paths`);
    if (!res.ok) return { suggestions: [] };
    return res.json();
  },

  async getMemory(id: string): Promise<ProjectMemory> {
    const res = await fetch(`${API_BASE}/projects/${id}/memory`);
    if (!res.ok) throw new Error('Falha ao obter arquivos de memória');
    return res.json();
  },

  async updateMemoryFile(id: string, filename: string, content: string): Promise<void> {
    const res = await fetch(`${API_BASE}/projects/${id}/memory/${filename}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Falha ao salvar' }));
      throw new Error(err.error || `Falha ao salvar ${filename}`);
    }
  },

  async addTask(id: string, text: string, column: 'pending' | 'doing' | 'done'): Promise<any> {
    const res = await fetch(`${API_BASE}/projects/${id}/tasks/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, column })
    });
    if (!res.ok) throw new Error('Falha ao adicionar tarefa');
    return res.json();
  },

  async moveTask(id: string, taskText: string, from: string, to: string): Promise<any> {
    const res = await fetch(`${API_BASE}/projects/${id}/tasks/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskText, from, to })
    });
    if (!res.ok) throw new Error('Falha ao mover tarefa');
    return res.json();
  },

  async generateCheckpoint(id: string, overrides?: any): Promise<{
    sessionId: string;
    sessionNumber: number;
    checkpointText: string;
    created_at: string;
  }> {
    const res = await fetch(`${API_BASE}/projects/${id}/checkpoint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(overrides || {})
    });
    if (!res.ok) throw new Error('Falha ao gerar checkpoint');
    return res.json();
  },

  async getContinuityContext(id: string): Promise<{ projectName: string; prompt: string }> {
    const res = await fetch(`${API_BASE}/projects/${id}/continuity`);
    if (!res.ok) throw new Error('Falha ao obter contexto de continuidade');
    return res.json();
  },

  async getSessions(id: string): Promise<SessionRecord[]> {
    const res = await fetch(`${API_BASE}/projects/${id}/sessions`);
    if (!res.ok) throw new Error('Falha ao obter histórico de sessões');
    return res.json();
  },

  async getGitInfo(id: string): Promise<GitInfo> {
    const res = await fetch(`${API_BASE}/projects/${id}/git`);
    if (!res.ok) throw new Error('Falha ao consultar Git');
    return res.json();
  },

  async getMessages(id: string): Promise<ChatMessage[]> {
    const res = await fetch(`${API_BASE}/projects/${id}/messages`);
    if (!res.ok) throw new Error('Falha ao obter mensagens');
    return res.json();
  },

  async sendMessage(id: string, content: string): Promise<{ userMessage: ChatMessage; assistantReply: ChatMessage }> {
    const res = await fetch(`${API_BASE}/projects/${id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });
    if (!res.ok) throw new Error('Falha ao enviar mensagem');
    return res.json();
  },

  async openFolder(id: string): Promise<{ success: boolean; message: string }> {
    const res = await fetch(`${API_BASE}/projects/${id}/open-folder`, { method: 'POST' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Falha ao abrir pasta' }));
      throw new Error(err.error || 'Falha ao abrir pasta no Windows Explorer');
    }
    return res.json();
  },

  async openTerminal(id: string): Promise<{ success: boolean; message: string }> {
    const res = await fetch(`${API_BASE}/projects/${id}/open-terminal`, { method: 'POST' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Falha ao abrir terminal' }));
      throw new Error(err.error || 'Falha ao abrir terminal');
    }
    return res.json();
  },

  async getSystemHealth(): Promise<SystemHealthData> {
    const res = await fetch(`${API_BASE}/system/health`);
    if (!res.ok) throw new Error('Falha ao consultar saúde do sistema');
    return res.json();
  },

  async runDiagnostics(): Promise<{ diagnostics: DiagnosticCheck[]; time: string }> {
    const res = await fetch(`${API_BASE}/system/diagnostics`, { method: 'POST' });
    if (!res.ok) throw new Error('Falha ao executar diagnóstico');
    return res.json();
  },

  async getLogs(limit = 100): Promise<LogEntry[]> {
    const res = await fetch(`${API_BASE}/system/logs?limit=${limit}`);
    if (!res.ok) throw new Error('Falha ao carregar logs');
    return res.json();
  },

  async clearLogs(): Promise<void> {
    const res = await fetch(`${API_BASE}/system/logs`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Falha ao limpar logs');
  },

  async getMcpStatus(): Promise<McpStatusData> {
    const res = await fetch(`${API_BASE}/mcp/status`);
    if (!res.ok) throw new Error('Falha ao consultar status do MCP');
    return res.json();
  },

  async testMcp(): Promise<{
    status: string;
    latencyMs: number;
    toolsAvailable: number;
    testCallResult: string;
    sampleProjectsCount: number;
  }> {
    const res = await fetch(`${API_BASE}/mcp/test`, { method: 'POST' });
    if (!res.ok) throw new Error('Falha ao testar servidor MCP');
    return res.json();
  },

  async callMcpTool(name: string, args: any): Promise<any> {
    const res = await fetch(`${API_BASE}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/call',
        params: { name, arguments: args }
      })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Falha no MCP' }));
      throw new Error(err.error?.message || err.error || 'Falha ao executar MCP tool');
    }
    const data = await res.json();
    if (data.error) {
      throw new Error(data.error.message || 'Erro MCP');
    }
    const content = data.result?.content?.[0]?.text;
    if (content) {
      try {
        return JSON.parse(content);
      } catch {
        return content;
      }
    }
    return data.result;
  },

  async createAutonomousRun(data: any): Promise<AutonomousRun> {
    const res = await fetch(`${API_BASE}/autonomous/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Falha ao criar run' }));
      throw new Error(err.error || 'Erro ao criar Autonomous Run');
    }
    return res.json();
  },

  async getAutonomousRun(id: string): Promise<AutonomousRun> {
    const res = await fetch(`${API_BASE}/autonomous/runs/${id}`);
    if (!res.ok) throw new Error('Falha ao obter Autonomous Run');
    return res.json();
  },

  async getActiveAutonomousRun(projectId: string): Promise<AutonomousRun | null> {
    const res = await fetch(`${API_BASE}/autonomous/projects/${projectId}/active`);
    if (!res.ok) return null;
    return res.json();
  },

  async pauseAutonomousRun(id: string): Promise<AutonomousRun> {
    const res = await fetch(`${API_BASE}/autonomous/runs/${id}/pause`, { method: 'POST' });
    if (!res.ok) throw new Error('Falha ao pausar build autônomo');
    return res.json();
  },

  async resumeAutonomousRun(id: string): Promise<AutonomousRun> {
    const res = await fetch(`${API_BASE}/autonomous/runs/${id}/resume`, { method: 'POST' });
    if (!res.ok) throw new Error('Falha ao retomar build autônomo');
    return res.json();
  },

  async stopAutonomousRun(id: string): Promise<AutonomousRun> {
    const res = await fetch(`${API_BASE}/autonomous/runs/${id}/stop`, { method: 'POST' });
    if (!res.ok) throw new Error('Falha ao encerrar build autônomo');
    return res.json();
  },

  async stepAutonomousRun(id: string): Promise<{ cycleResult: any; run: AutonomousRun }> {
    const res = await fetch(`${API_BASE}/autonomous/runs/${id}/step`, { method: 'POST' });
    if (!res.ok) throw new Error('Falha ao avançar ciclo autônomo');
    return res.json();
  },

  async startAutonomousLoop(id: string, maxIterations = 20): Promise<{ success: boolean; message: string }> {
    const res = await fetch(`${API_BASE}/autonomous/runs/${id}/loop/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxIterations })
    });
    if (!res.ok) throw new Error('Falha ao iniciar loop contínuo');
    return res.json();
  },

  async stopAutonomousLoop(id: string): Promise<{ success: boolean; message: string }> {
    const res = await fetch(`${API_BASE}/autonomous/runs/${id}/loop/stop`, { method: 'POST' });
    if (!res.ok) throw new Error('Falha ao parar loop contínuo');
    return res.json();
  },

  async resolveAutonomousApproval(approvalId: string, decision: 'approved' | 'rejected' | 'delegated'): Promise<AutonomousRun> {
    const res = await fetch(`${API_BASE}/autonomous/approvals/${approvalId}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision })
    });
    if (!res.ok) throw new Error('Falha ao resolver aprovação');
    return res.json();
  },

  async getAutonomousReport(runId: string): Promise<{ reportMd: string }> {
    const res = await fetch(`${API_BASE}/autonomous/runs/${runId}/report`);
    if (!res.ok) throw new Error('Falha ao obter Overnight Report');
    return res.json();
  },

  async getRunnerStatus(): Promise<{
    runnerId: string;
    online: boolean;
    status: 'online' | 'idle' | 'busy' | 'stopped' | 'error';
    lastHeartbeat: string;
    secondsAgo: number;
    activeRunId: string | null;
    activeRunName: string | null;
    currentTask: string | null;
    currentWorker: string | null;
    iteration: number;
    consecutiveFailures: number;
  }> {
    const res = await fetch(`${API_BASE}/autonomous/runner/status`);
    if (!res.ok) throw new Error('Falha ao obter status do Runner');
    return res.json();
  },

  async getProjectGitHub(projectId: string): Promise<any> {
    const res = await fetch(`${API_BASE}/projects/${projectId}/github`);
    if (!res.ok) throw new Error('Falha ao consultar GitHub do projeto');
    return res.json();
  },

  async linkProjectGitHub(projectId: string, repo: string, branch = 'main'): Promise<any> {
    const res = await fetch(`${API_BASE}/projects/${projectId}/github`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo, branch })
    });
    if (!res.ok) throw new Error('Falha ao vincular repositório GitHub');
    return res.json();
  },

  async syncProjectGitHub(projectId: string): Promise<any> {
    const res = await fetch(`${API_BASE}/projects/${projectId}/github/sync`, {
      method: 'POST'
    });
    if (!res.ok) throw new Error('Falha ao sincronizar com GitHub');
    return res.json();
  },

  // -------------------------------------------------------------
  // MULTI-WORKER API METHODS
  // -------------------------------------------------------------
  async getWorkers(): Promise<any[]> {
    const res = await fetch(`${API_BASE}/workers`);
    if (!res.ok) throw new Error('Falha ao obter lista de workers');
    return res.json();
  },

  async getWorkerActivity(): Promise<any[]> {
    const res = await fetch(`${API_BASE}/workers/activity`);
    if (!res.ok) throw new Error('Falha ao obter atividades dos workers');
    return res.json();
  },

  async createWorker(data: { name: string; provider?: string; account_label?: string; environment?: string; capabilities?: string[] }): Promise<any> {
    const res = await fetch(`${API_BASE}/workers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error('Falha ao criar worker');
    return res.json();
  },

  async pauseWorker(workerId: string): Promise<any> {
    const res = await fetch(`${API_BASE}/workers/${workerId}/pause`, { method: 'POST' });
    if (!res.ok) throw new Error('Falha ao pausar worker');
    return res.json();
  },

  async resumeWorker(workerId: string): Promise<any> {
    const res = await fetch(`${API_BASE}/workers/${workerId}/resume`, { method: 'POST' });
    if (!res.ok) throw new Error('Falha ao retomar worker');
    return res.json();
  },

  async testWorker(workerId: string): Promise<{ success: boolean; message: string; conversationId?: string }> {
    const res = await fetch(`${API_BASE}/workers/${workerId}/test`, { method: 'POST' });
    if (!res.ok) throw new Error('Falha ao testar worker');
    return res.json();
  },

  async deleteWorker(workerId: string): Promise<any> {
    const res = await fetch(`${API_BASE}/workers/${workerId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Falha ao remover worker');
    return res.json();
  },

  async assignWorker(workerId: string, runId: string, taskId: string, issueNumber?: number): Promise<any> {
    const res = await fetch(`${API_BASE}/workers/${workerId}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId, taskId, issueNumber })
    });
    if (!res.ok) throw new Error('Falha ao atribuir tarefa ao worker');
    return res.json();
  },

  // -------------------------------------------------------------
  // ACCOUNT PROFILES (MULTI-ACCOUNT)
  // -------------------------------------------------------------

  async getAccountProfiles(): Promise<AccountProfile[]> {
    const res = await fetch(`${API_BASE}/account-profiles`);
    if (!res.ok) throw new Error('Falha ao carregar perfis de conta');
    return res.json();
  },

  async createAccountProfile(data: { displayName: string; profileName?: string; googleAccountLabel?: string; autoLaunch?: boolean }): Promise<AccountProfile> {
    const res = await fetch(`${API_BASE}/account-profiles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Falha ao criar perfil' }));
      throw new Error(err.error || 'Falha ao criar perfil');
    }
    return res.json();
  },

  async updateAccountProfile(id: string, data: { displayName?: string; googleAccountLabel?: string | null; authStatus?: AuthStatus }): Promise<AccountProfile> {
    const res = await fetch(`${API_BASE}/account-profiles/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Falha ao atualizar perfil' }));
      throw new Error(err.error || 'Falha ao atualizar perfil');
    }
    return res.json();
  },

  async deleteAccountProfile(id: string, opts?: { deleteData?: boolean }): Promise<{ success: boolean; message: string; fallbackProfileId?: string }> {
    const query = opts?.deleteData ? '?deleteData=true' : '';
    const res = await fetch(`${API_BASE}/account-profiles/${id}${query}`, {
      method: 'DELETE'
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Falha ao remover perfil' }));
      throw new Error(err.error || 'Falha ao remover perfil');
    }
    return res.json();
  },

  async getActiveAccountProfile(): Promise<AccountProfile> {
    const res = await fetch(`${API_BASE}/account-profiles/active`);
    if (!res.ok) throw new Error('Falha ao carregar conta ativa');
    return res.json();
  },

  async setGlobalActiveAccountProfile(profileId: string): Promise<AccountProfile> {
    const res = await fetch(`${API_BASE}/account-profiles/active`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId })
    });
    if (!res.ok) throw new Error('Falha ao definir conta ativa global');
    return res.json();
  },

  async getDetectedAccounts(): Promise<string[]> {
    try {
      const res = await fetch(`${API_BASE}/account-profiles-detected`);
      if (!res.ok) return [];
      const data = await res.json().catch(() => ({ accounts: [] }));
      return data.accounts || [];
    } catch {
      return [];
    }
  },

  async launchAccountProfileLogin(id: string): Promise<{ success: boolean; message: string; pid?: number }> {
    const res = await fetch(`${API_BASE}/account-profiles/${id}/launch-login`, { method: 'POST' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Falha ao iniciar login' }));
      throw new Error(err.error || 'Falha ao iniciar login');
    }
    return res.json();
  },

  async verifyAccountProfile(id: string, email?: string): Promise<{
    profile: AccountProfile;
    tested: boolean;
    hasSession: boolean;
    account: string | null;
  }> {
    const res = await fetch(`${API_BASE}/account-profiles/${id}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    if (!res.ok) throw new Error('Falha ao verificar perfil');
    return res.json();
  },

  async getActiveAccountForProject(projectId: string): Promise<{
    activeProfile: AccountProfile;
    session: AccountProjectSession | null;
  }> {
    const res = await fetch(`${API_BASE}/projects/${projectId}/active-account`);
    if (!res.ok) throw new Error('Falha ao obter conta ativa do projeto');
    return res.json();
  },

  async switchProjectAccount(projectId: string, targetProfileId: string): Promise<{
    previousProfile: AccountProfile;
    activeProfile: AccountProfile;
    conversationId: string;
    bootstrapSent: boolean;
    checkpointCreated: boolean;
  }> {
    const res = await fetch(`${API_BASE}/projects/${projectId}/switch-account`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetProfileId })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Falha ao alternar conta' }));
      throw new Error(err.error || 'Falha ao alternar conta');
    }
    return res.json();
  },

  async switchGlobalAccount(targetProfileId: string, projectId?: string): Promise<any> {
    const res = await fetch(`${API_BASE}/account-profiles/switch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetProfileId, projectId })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Falha ao alternar conta' }));
      throw new Error(err.error || 'Falha ao alternar conta');
    }
    return res.json();
  },

  async getProjectFiles(projectId: string): Promise<{ files: FileNode[]; rootPath: string }> {
    const res = await fetch(`${API_BASE}/projects/${projectId}/files`);
    if (!res.ok) throw new Error('Falha ao listar arquivos');
    return res.json();
  },

  async getFileContent(projectId: string, filePath: string): Promise<FileContentResponse> {
    const res = await fetch(`${API_BASE}/projects/${projectId}/file-content?path=${encodeURIComponent(filePath)}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Falha ao ler arquivo' }));
      throw new Error(err.error || 'Falha ao ler arquivo');
    }
    return res.json();
  },

  async getGitDiff(projectId: string, file?: string): Promise<GitDiffResponse> {
    const url = file
      ? `${API_BASE}/projects/${projectId}/git-diff?file=${encodeURIComponent(file)}`
      : `${API_BASE}/projects/${projectId}/git-diff`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Falha ao obter Git Diff');
    return res.json();
  },

  async stopAgent(projectId: string): Promise<{ success: boolean; message: string }> {
    const res = await fetch(`${API_BASE}/projects/${projectId}/agent-stop`, { method: 'POST' });
    if (!res.ok) throw new Error('Falha ao interromper agente');
    return res.json();
  },

  async getTerminalLogs(projectId: string): Promise<TerminalLogsResponse> {
    const res = await fetch(`${API_BASE}/projects/${projectId}/terminal-logs`);
    if (!res.ok) throw new Error('Falha ao carregar logs do terminal');
    return res.json();
  },

  async triggerCouncilDeliberation(projectId: string, data: any): Promise<CouncilDeliberation> {
    const res = await fetch(`${API_BASE}/projects/${projectId}/council/deliberate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Falha ao deliberar conselho' }));
      throw new Error(err.error || 'Falha na deliberação do conselho');
    }
    return res.json();
  },

  async getCouncilDeliberation(projectId: string, id: string): Promise<CouncilDeliberation> {
    const res = await fetch(`${API_BASE}/projects/${projectId}/council/${id}`);
    if (!res.ok) throw new Error('Falha ao carregar deliberação do conselho');
    return res.json();
  },

  async getCouncilDeliberations(projectId: string): Promise<CouncilDeliberation[]> {
    const res = await fetch(`${API_BASE}/projects/${projectId}/council/deliberations`);
    if (!res.ok) throw new Error('Falha ao listar deliberações do conselho');
    return res.json();
  },

  async getArenaRuns(projectId: string): Promise<ArenaRunData[]> {
    const res = await fetch(`${API_BASE}/projects/${projectId}/arena/runs`);
    if (!res.ok) throw new Error('Falha ao listar ArenaRuns');
    return res.json();
  },

  async getArenaRun(projectId: string, runId: string): Promise<ArenaRunData> {
    const res = await fetch(`${API_BASE}/projects/${projectId}/arena/${runId}`);
    if (!res.ok) throw new Error('Falha ao carregar ArenaRun');
    return res.json();
  },

  async createArenaRun(projectId: string, data: any): Promise<ArenaRunData> {
    const res = await fetch(`${API_BASE}/projects/${projectId}/arena/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Falha ao criar Arena' }));
      throw new Error(err.error || 'Falha ao criar Arena');
    }
    return res.json();
  },

  async runArenaTournament(projectId: string, data: any): Promise<{
    arenaRun: ArenaRunData;
    councilResult: ArenaCouncilResult;
    promotedWinner?: ArenaCandidateData;
  }> {
    const res = await fetch(`${API_BASE}/projects/${projectId}/arena/tournament`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Falha ao executar torneio Arena' }));
      throw new Error(err.error || 'Falha no torneio da Arena');
    }
    return res.json();
  },

  async evaluateArenaCandidates(projectId: string, runId: string, customTestCommand?: string): Promise<ArenaCandidateData[]> {
    const res = await fetch(`${API_BASE}/projects/${projectId}/arena/${runId}/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customTestCommand })
    });
    if (!res.ok) throw new Error('Falha ao avaliar candidatos');
    return res.json();
  },

  async deliberateArenaCouncil(projectId: string, runId: string): Promise<ArenaCouncilResult> {
    const res = await fetch(`${API_BASE}/projects/${projectId}/arena/${runId}/council`, {
      method: 'POST'
    });
    if (!res.ok) throw new Error('Falha na deliberação do conselho da Arena');
    return res.json();
  },

  async integrateArenaWinner(projectId: string, runId: string): Promise<{ success: boolean; promotedCandidate: ArenaCandidateData }> {
    const res = await fetch(`${API_BASE}/projects/${projectId}/arena/${runId}/integrate`, {
      method: 'POST'
    });
    if (!res.ok) throw new Error('Falha ao integrar vencedor da Arena');
    return res.json();
  },

  async cancelArenaRun(projectId: string, runId: string): Promise<{ success: boolean }> {
    const res = await fetch(`${API_BASE}/projects/${projectId}/arena/${runId}/cancel`, {
      method: 'POST'
    });
    if (!res.ok) throw new Error('Falha ao cancelar Arena');
    return res.json();
  },

  async getArenaCandidateDiff(projectId: string, candidateId: string): Promise<{ diff: string; files: string[] }> {
    const res = await fetch(`${API_BASE}/projects/${projectId}/arena/candidate/${candidateId}/diff`);
    if (!res.ok) throw new Error('Falha ao carregar diff do candidato');
    return res.json();
  },

  async getArenaRecommendation(projectId: string, title: string, description?: string): Promise<{ recommended: boolean; reason: string }> {
    const url = `${API_BASE}/projects/${projectId}/arena/recommendation?title=${encodeURIComponent(title)}&description=${encodeURIComponent(description || '')}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Falha ao verificar recomendação da Arena');
    return res.json();
  },

  // Benchmarks & Self-Improvement (Fase 6)
  async getBenchmarkTasks(): Promise<BenchmarkTaskData[]> {
    const res = await fetch(`${API_BASE}/benchmarks/tasks`);
    if (!res.ok) throw new Error('Falha ao carregar tarefas de benchmark');
    return res.json();
  },

  async getBenchmarkRuns(): Promise<BenchmarkRunSummaryData[]> {
    const res = await fetch(`${API_BASE}/benchmarks/runs`);
    if (!res.ok) throw new Error('Falha ao listar execuções de benchmark');
    return res.json();
  },

  async getBenchmarkRun(id: string): Promise<BenchmarkRunSummaryData> {
    const res = await fetch(`${API_BASE}/benchmarks/runs/${id}`);
    if (!res.ok) throw new Error('Falha ao carregar execução de benchmark');
    return res.json();
  },

  async runBenchmarkSuite(params: {
    versionLabel: string;
    gitCommit?: string;
    isBaseline?: boolean;
    candidateImplementations?: Record<string, Record<string, string>>;
  }): Promise<BenchmarkRunSummaryData> {
    const res = await fetch(`${API_BASE}/benchmarks/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });
    if (!res.ok) throw new Error('Falha ao executar suíte de benchmark');
    return res.json();
  },

  async compareBenchmarkVersions(versionA: string, versionB: string): Promise<VersionComparisonResultData> {
    const res = await fetch(`${API_BASE}/benchmarks/compare?versionA=${encodeURIComponent(versionA)}&versionB=${encodeURIComponent(versionB)}`);
    if (!res.ok) throw new Error('Falha ao comparar versões de benchmark');
    return res.json();
  },

  async getSelfImprovementExperiments(): Promise<SelfImprovementExperimentData[]> {
    const res = await fetch(`${API_BASE}/self-improvement/experiments`);
    if (!res.ok) throw new Error('Falha ao carregar experimentos de auto-melhoria');
    return res.json();
  },

  async getSelfImprovementExperiment(id: string): Promise<SelfImprovementExperimentData> {
    const res = await fetch(`${API_BASE}/self-improvement/experiments/${id}`);
    if (!res.ok) throw new Error('Falha ao carregar experimento de auto-melhoria');
    return res.json();
  },

  async createSelfImprovementExperiment(params: {
    hypothesis: string;
    bottleneckIdentified: string;
    baselineRunId?: string;
  }): Promise<SelfImprovementExperimentData> {
    const res = await fetch(`${API_BASE}/self-improvement/experiments/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });
    if (!res.ok) throw new Error('Falha ao criar experimento de auto-melhoria');
    return res.json();
  },

  async executeSelfImprovementCycle(params: {
    experimentId: string;
    candidateA: { label: string; strategy: string; implementations: Record<string, Record<string, string>> };
    candidateB: { label: string; strategy: string; implementations: Record<string, Record<string, string>> };
  }): Promise<any> {
    const res = await fetch(`${API_BASE}/self-improvement/experiments/cycle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });
    if (!res.ok) throw new Error('Falha ao executar ciclo de auto-melhoria');
    return res.json();
  },

  async startSelfImprovementRun(config?: any): Promise<any> {
    const res = await fetch(`${API_BASE}/self-improvement/runs/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config || {})
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Falha ao iniciar run' }));
      throw new Error(err.error || 'Falha ao iniciar Self-Improvement Run');
    }
    return res.json();
  },

  async getActiveSelfImprovementRun(): Promise<any> {
    const res = await fetch(`${API_BASE}/self-improvement/runs/active`);
    if (!res.ok) return null;
    return res.json();
  },

  async getSelfImprovementRun(id: string): Promise<any> {
    const res = await fetch(`${API_BASE}/self-improvement/runs/${id}`);
    if (!res.ok) throw new Error('Falha ao obter Self-Improvement Run');
    return res.json();
  },

  async listSelfImprovementRuns(): Promise<any[]> {
    const res = await fetch(`${API_BASE}/self-improvement/runs`);
    if (!res.ok) throw new Error('Falha ao listar Self-Improvement Runs');
    return res.json();
  },

  async stopSelfImprovementRun(id: string, reason?: string): Promise<any> {
    const res = await fetch(`${API_BASE}/self-improvement/runs/${id}/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason })
    });
    if (!res.ok) throw new Error('Falha ao interromper run');
    return res.json();
  },

  async getSelfImprovementRunReport(id: string): Promise<{ report: string }> {
    const res = await fetch(`${API_BASE}/self-improvement/runs/${id}/report`);
    if (!res.ok) throw new Error('Falha ao obter relatório matinal');
    return res.json();
  },

  // Model & Usage Telemetry API
  async getModels(): Promise<ModelOption[]> {
    const res = await fetch(`${API_BASE}/models`);
    if (!res.ok) throw new Error('Falha ao carregar catálogo de modelos');
    return res.json();
  },

  async getModelPreferences(accountProfileId?: string, projectId?: string): Promise<Record<string, ModelSelectorValue>> {
    const params = new URLSearchParams();
    if (accountProfileId) params.append('accountProfileId', accountProfileId);
    if (projectId) params.append('projectId', projectId);
    const query = params.toString() ? `?${params.toString()}` : '';
    const res = await fetch(`${API_BASE}/models/preferences${query}`);
    if (!res.ok) throw new Error('Falha ao obter preferências de modelo');
    return res.json();
  },

  async setModelPreference(data: {
    role?: string;
    modelId: ModelSelectorValue;
    accountProfileId?: string;
    projectId?: string;
  }): Promise<{ success: boolean; preferences: Record<string, ModelSelectorValue> }> {
    const res = await fetch(`${API_BASE}/models/preferences`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error('Falha ao salvar preferência de modelo');
    return res.json();
  },

  async getTodayUsage(accountProfileId?: string): Promise<{ todayExecutions: number }> {
    const query = accountProfileId ? `?accountProfileId=${encodeURIComponent(accountProfileId)}` : '';
    const res = await fetch(`${API_BASE}/models/usage/today${query}`);
    if (!res.ok) return { todayExecutions: 0 };
    return res.json();
  },

  async getUsageStats(accountProfileId?: string): Promise<{ summary: UsageSummary; recent: UsageEvent[] }> {
    const query = accountProfileId ? `?accountProfileId=${encodeURIComponent(accountProfileId)}` : '';
    const res = await fetch(`${API_BASE}/models/usage/stats${query}`);
    if (!res.ok) throw new Error('Falha ao carregar estatísticas de uso');
    return res.json();
  },

  async getGitHubGlobalStatus(): Promise<{
    configured: boolean;
    authenticated: boolean;
    source: string;
    username: string | null;
    scopes: string[];
  }> {
    const res = await fetch(`${API_BASE}/github/status`);
    if (!res.ok) return { configured: false, authenticated: false, source: 'NONE', username: null, scopes: [] };
    return res.json();
  },

  async configureGitHubToken(token: string): Promise<{ success: boolean; status: any }> {
    const res = await fetch(`${API_BASE}/github/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Falha ao configurar token' }));
      throw new Error(err.error || 'Falha ao configurar GitHub');
    }
    return res.json();
  },

  async getProjectAutonomy(projectId: string): Promise<ProjectAutonomy> {
    const res = await fetch(`${API_BASE}/projects/${projectId}/autonomy`);
    if (!res.ok) throw new Error('Falha ao carregar autonomia do projeto');
    return res.json();
  },

  async updateProjectAutonomy(projectId: string, data: { isTrusted: boolean; fullDevAutonomy: boolean }): Promise<any> {
    const res = await fetch(`${API_BASE}/projects/${projectId}/autonomy`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error('Falha ao atualizar autonomia do projeto');
    return res.json();
  },

  async getSettings(): Promise<SystemSettingsResponse> {
    const res = await fetch(`${API_BASE}/settings`);
    if (!res.ok) throw new Error('Falha ao carregar configurações');
    return res.json();
  },

  async updateSettings(data: { fullDevAutonomyDefault?: boolean; settings?: Record<string, string> }): Promise<any> {
    const res = await fetch(`${API_BASE}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error('Falha ao salvar configurações');
    return res.json();
  },

  async getProjectAgentSessions(projectId: string): Promise<AgentSessionsResponse> {
    const res = await fetch(`${API_BASE}/projects/${projectId}/agent-sessions`);
    if (!res.ok) throw new Error('Falha ao carregar sessões de agentes');
    return res.json();
  },

  async auditProjectAgentSessions(projectId: string): Promise<SessionAuditReportClient> {
    const res = await fetch(`${API_BASE}/projects/${projectId}/agent-sessions/audit`);
    if (!res.ok) throw new Error('Falha ao auditar sessões de agentes');
    return res.json();
  },

  async rotateProjectAgentSession(projectId: string, role: 'SUPERVISOR' | 'WORKER', reason?: string): Promise<any> {
    const res = await fetch(`${API_BASE}/projects/${projectId}/agent-sessions/rotate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, reason })
    });
    if (!res.ok) throw new Error('Falha ao rotacionar sessão do agente');
    return res.json();
  }
};




