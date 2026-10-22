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
  RapidSwitchResult,
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
  SessionAuditReportClient,
  LogLevel,
  ObservabilityEvent,
  DetectedAnomaly,
  GroupedError,
  ObservabilityHealthReport,
  ObservabilityEventsResponse,
  PreviewStatus,
  ProjectEnvStudioData,
  HomologationEvidenceData,
  MetaChatThread,
  MetaChatLiveActivity,
  MetaChatMessageItem,
  MetaChatResponseData,
  MetaChatRecompileResult,
  MetaChatLiveStatus,
  MetaChatAutopilotStatus,
  DecoMindMlStatus,
  SlashCommandItem
} from '../types';

const API_BASE = '/api';

export const api = {
  async getExecutionEnvironment(): Promise<{offline:boolean}> {
    const response=await fetch(`${API_BASE}/health`);
    if(!response.ok)throw Error('Backend indisponível');
    return response.json();
  },
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
    folderPath?: string;
    objective?: string;
    description?: string;
    stack?: string;
    initGit?: boolean;
    initialProfileId?: string;
    selectedModel?: string;
    reasoningLevel?: string;
    githubAction?: 'none' | 'create_private' | 'link_existing';
    githubRepo?: string;
    githubToken?: string;
  }): Promise<Project> {
    const desktopAPI = typeof window !== 'undefined' ? (window as any).desktopAPI : undefined;

    // Fallback nativo ultra-resiliente no Electron: se o backend HTTP demorar mais de 6s ou falhar,
    // aciona desktopAPI.createProjectDirect para gravar diretamente sem depender do Event Loop
    if (desktopAPI && typeof desktopAPI.createProjectDirect === 'function') {
      try {
        const httpPromise = (async () => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 6000);
          try {
            const res = await fetch(`${API_BASE}/projects`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(data),
              signal: controller.signal
            });
            clearTimeout(timer);
            if (!res.ok) {
              const err = await res.json().catch(() => ({ error: 'Falha HTTP' }));
              throw new Error(err.error || 'Falha HTTP');
            }
            return await res.json();
          } finally {
            clearTimeout(timer);
          }
        })();

        return await httpPromise;
      } catch (httpErr) {
        console.warn('[api.createProject] HTTP backend ocupado ou timeout de 6s atingido. Acionando fallback nativo desktopAPI.createProjectDirect...');
        try {
          const directRes = await desktopAPI.createProjectDirect(data);
          if (directRes && directRes.success && directRes.data) {
            return directRes.data;
          }
          if (directRes && directRes.id) {
            return directRes;
          }
          if (directRes && directRes.error) {
            throw new Error(directRes.error);
          }
        } catch (ipcErr: any) {
          console.error('[api.createProject] Falha também no fallback nativo IPC:', ipcErr);
          throw ipcErr;
        }
      }
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000);

    try {
      const res = await fetch(`${API_BASE}/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        signal: controller.signal
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Erro desconhecido' }));
        throw new Error(err.error || 'Falha ao criar projeto');
      }
      return await res.json();
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new Error('Tempo limite esgotado ao criar projeto (timeout de 25 segundos). Verifique a conexão com o servidor.');
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
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

  async sendMessage(id: string, content: string, requestId: string = crypto.randomUUID(), options?: { signal?: AbortSignal; forceNew?: boolean; stream?: boolean }): Promise<{ userMessage: ChatMessage; assistantReply?: ChatMessage; autonomousRun?: AutonomousRun; execution?: { status: 'stored' | 'started' | 'queued' | 'blocked'; reason?: string; runStatus?: string }; turnId?: string; status?: string }> {
    const res = await fetch(`${API_BASE}/projects/${id}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Stream-Mode': 'sse'
      },
      body: JSON.stringify({ content, requestId, forceNew: options?.forceNew, stream: true }),
      signal: options?.signal
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: 'Falha ao enviar mensagem' }));
      if (res.status === 409) {
        if (error.code === 'CHAT_REQUEST_UNCONFIRMED' || error.persisted === false) {
          const unconfirmedErr: any = new Error(error.error || 'Mensagem não confirmada no banco. O texto foi preservado para reenvio.');
          unconfirmedErr.isAlreadyRegistered = false;
          throw unconfirmedErr;
        }
        if (error.code === 'CHAT_REQUEST_RECONCILIATION_REQUIRED' || /já foi registrada/i.test(error.error)) {
          if (error.persisted === true) {
            const handledError: any = new Error(error.error || 'Sua solicitação já foi registrada.');
            handledError.isAlreadyRegistered = true;
            throw handledError;
          }
          try {
            const msgsRes = await fetch(`${API_BASE}/projects/${id}/messages`);
            if (msgsRes.ok) {
              const msgs: ChatMessage[] = await msgsRes.json();
              if (msgs.some(m => m.content === content && m.role === 'user')) {
                const handledError: any = new Error(error.error || 'Sua solicitação já foi registrada.');
                handledError.isAlreadyRegistered = true;
                throw handledError;
              }
            }
          } catch {}
          const unconfirmedErr: any = new Error(error.error || 'Falha ao confirmar persistência da mensagem. O texto foi preservado.');
          unconfirmedErr.isAlreadyRegistered = false;
          throw unconfirmedErr;
        }
      }
      throw new Error(error.error || 'Falha ao enviar mensagem');
    }
    return res.json();
  },

  async cancelProjectMessage(id: string, messageId?: string): Promise<{ cancelled: boolean; dequeued?: boolean; message: string }> {
    const res = await fetch(`${API_BASE}/projects/${id}/messages/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Falha ao cancelar mensagem' }));
      throw new Error(err.error || 'Falha ao cancelar mensagem');
    }
    return res.json();
  },

  async deleteProjectMessage(id: string, messageId: string): Promise<{ success: boolean; message: string }> {
    const res = await fetch(`${API_BASE}/projects/${id}/messages/${messageId}`, {
      method: 'DELETE'
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Falha ao remover mensagem' }));
      throw new Error(err.error || 'Falha ao remover mensagem');
    }
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
    if (!res.ok) { const data = await res.json(); throw new Error(data.error || 'Falha ao retomar build autônomo'); }
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

  async getRunHierarchy(runId: string): Promise<any> {
    const res = await fetch(`${API_BASE}/autonomous/runs/${runId}/hierarchy`);
    if (!res.ok) throw new Error('Falha ao obter hierarquia de tarefas do Run');
    return res.json();
  },

  async replanAutonomousRun(
    runId: string,
    data: {
      instruction: string;
      changeType?: 'NEW_FEATURE' | 'DEFECT_FIX' | 'REQUIREMENT_CHANGE';
      originTaskId?: string;
    }
  ): Promise<{ replanResult: any; run: AutonomousRun }> {
    const res = await fetch(`${API_BASE}/autonomous/runs/${runId}/replan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Falha ao replanejar Run' }));
      throw new Error(err.error || 'Falha ao replanejar Run');
    }
    return res.json();
  },

  async transitionTaskState(
    taskId: string,
    data: {
      toState: string;
      actor?: string;
      reason: string;
      metadata?: Record<string, any>;
    }
  ): Promise<any> {
    const res = await fetch(`${API_BASE}/autonomous/tasks/${taskId}/transition`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Falha na transição de estado' }));
      throw new Error(err.error || 'Falha na transição de estado');
    }
    return res.json();
  },

  async getTaskContract(taskId: string): Promise<any> {
    const res = await fetch(`${API_BASE}/autonomous/tasks/${taskId}/contract`);
    if (!res.ok) throw new Error('Falha ao obter contrato de execução da microtarefa');
    return res.json();
  },

  async getRunCommunications(runId: string, taskId?: string): Promise<{ communications: any[] }> {
    const qs = taskId ? `?taskId=${encodeURIComponent(taskId)}` : '';
    const res = await fetch(`${API_BASE}/autonomous/runs/${runId}/communications${qs}`);
    if (!res.ok) throw new Error('Falha ao obter comunicações dos agentes');
    return res.json();
  },

  async validateFinalRun(runId: string): Promise<{ validation: any; run: AutonomousRun }> {
    const res = await fetch(`${API_BASE}/autonomous/runs/${runId}/validate-final`, {
      method: 'POST'
    });
    if (!res.ok) throw new Error('Falha ao executar validação final integrada');
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
    const data = await res.json();
    return Array.isArray(data) ? data : (data?.profiles || data?.accounts || data?.data || []);
  },

  async getAccounts(): Promise<AccountProfile[]> {
    return this.getAccountProfiles();
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
    reason?: string;
  }> {
    const res = await fetch(`${API_BASE}/account-profiles/${id}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    if (!res.ok) throw new Error('Falha ao verificar perfil');
    return res.json();
  },

  async disconnectAccountProfile(id: string): Promise<{
    success: boolean;
    profile: AccountProfile;
    message: string;
  }> {
    const res = await fetch(`${API_BASE}/account-profiles/${id}/disconnect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Falha ao desconectar conta' }));
      throw new Error(err.error || 'Falha ao desconectar conta');
    }
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

  async rapidSwitchAccount(data?: { projectId?: string; targetProfileId?: string }): Promise<RapidSwitchResult> {
    const res = await fetch(`${API_BASE}/accounts/rapid-switch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data || {})
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Falha ao executar Rapid Switch' }));
      throw new Error(err.error || 'Falha ao executar Rapid Switch');
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

  async stopAgent(projectId: string): Promise<{ success: boolean; message: string; pending?: boolean }> {
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

  async getRunCouncilDeliberation(runId: string): Promise<CouncilDeliberation | null> {
    const res = await fetch(`${API_BASE}/autonomous/runs/${runId}/council`);
    if (!res.ok) return null;
    return res.json();
  },

  async getTaskCouncilDeliberation(taskId: string): Promise<CouncilDeliberation | null> {
    const res = await fetch(`${API_BASE}/autonomous/tasks/${taskId}/deliberation`);
    if (!res.ok) return null;
    return res.json();
  },

  async getTaskSkill(taskId: string): Promise<{ skill: string; guidelines: string[] } | null> {
    const res = await fetch(`${API_BASE}/autonomous/tasks/${taskId}/skill`);
    if (!res.ok) return null;
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

  async getNativeExecutionPolicy(projectId: string): Promise<{mode:'restricted'|'permissive'}> {
    const res = await fetch(`${API_BASE}/projects/${projectId}/native-execution-policy`);
    if (!res.ok) throw new Error('Falha ao carregar política nativa');
    return res.json();
  },

  async setNativeExecutionPolicy(projectId: string, mode:'restricted'|'permissive') {
    const res = await fetch(`${API_BASE}/projects/${projectId}/native-execution-policy`, {
      method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({mode,
        ...(mode==='permissive'?{acknowledgement:{userConsent:'Escolha explícita na configuração do projeto: aceitar ALLOW/EAGER sem contenção do filesystem do agente.',outsideAccessAllowed:true,automaticCommandsAllowed:true,noFilesystemIsolation:true}}:{})})
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Falha ao salvar política nativa');
    return data;
  },

  async getNativeWorkspaceBinding(projectId: string) {
    const res = await fetch(`${API_BASE}/projects/${projectId}/native-workspace-binding`);
    if (!res.ok) throw new Error('Falha ao obter status do vínculo nativo');
    return res.json();
  },

  async establishNativeWorkspaceBinding(projectId: string, data?: { mode?: 'restricted'|'permissive' }) {
    const res = await fetch(`${API_BASE}/projects/${projectId}/native-workspace-binding/establish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data || {})
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Falha ao estabelecer vínculo nativo');
    return result;
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
  },

  async getObservabilityEvents(params?: {
    limit?: number;
    offset?: number;
    level?: LogLevel;
    service?: string;
    event?: string;
    runId?: string;
    taskId?: string;
    projectId?: string;
    search?: string;
    since?: string;
    until?: string;
  }): Promise<ObservabilityEventsResponse> {
    const query = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') query.append(k, String(v));
      });
    }
    const res = await fetch(`${API_BASE}/observability/events?${query.toString()}`);
    if (!res.ok) throw new Error('Falha ao carregar eventos de observabilidade');
    return res.json();
  },

  async getObservabilityEvent(id: string): Promise<ObservabilityEvent> {
    const res = await fetch(`${API_BASE}/observability/events/${id}`);
    if (!res.ok) throw new Error('Falha ao obter evento de observabilidade');
    return res.json();
  },

  async getRunTimeline(runId: string): Promise<ObservabilityEvent[]> {
    const res = await fetch(`${API_BASE}/observability/runs/${runId}/timeline`);
    if (!res.ok) throw new Error('Falha ao carregar linha do tempo do run');
    return res.json();
  },

  async getTaskObservabilityEvents(taskId: string): Promise<ObservabilityEvent[]> {
    const res = await fetch(`${API_BASE}/observability/tasks/${taskId}/events`);
    if (!res.ok) throw new Error('Falha ao carregar eventos da tarefa');
    return res.json();
  },

  async getDiagnosticAnomalies(): Promise<DetectedAnomaly[]> {
    const res = await fetch(`${API_BASE}/observability/diagnostics/anomalies`);
    if (!res.ok) throw new Error('Falha ao carregar anomalias de diagnóstico');
    return res.json();
  },

  async getDiagnosticErrors(since?: string): Promise<GroupedError[]> {
    const query = since ? `?since=${encodeURIComponent(since)}` : '';
    const res = await fetch(`${API_BASE}/observability/diagnostics/errors${query}`);
    if (!res.ok) throw new Error('Falha ao carregar erros agrupados');
    return res.json();
  },

  async getObservabilityHealth(): Promise<ObservabilityHealthReport> {
    const res = await fetch(`${API_BASE}/observability/health`);
    if (!res.ok) throw new Error('Falha ao carregar saúde de observabilidade');
    return res.json();
  },

  getObservabilityExportUrl(params?: Record<string, string>, format: 'json' | 'jsonl' = 'json'): string {
    const query = new URLSearchParams({ format, ...(params || {}) });
    return `${API_BASE}/observability/export?${query.toString()}`;
  },

  async cleanupObservabilityEvents(retentionDays = 30): Promise<{ success: boolean; deletedCount: number; retentionDays: number }> {
    const res = await fetch(`${API_BASE}/observability/cleanup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ retentionDays })
    });
    if (!res.ok) throw new Error('Falha ao limpar eventos antigos');
    return res.json();
  },

  async getPreviewStatus(id: string): Promise<PreviewStatus> {
    const res = await fetch(`${API_BASE}/projects/${id}/preview/status`);
    if (!res.ok) throw new Error('Falha ao obter status do preview');
    return res.json();
  },

  async startPreview(id: string, options?: { port?: number; timeoutMs?: number }): Promise<PreviewStatus> {
    const res = await fetch(`${API_BASE}/projects/${id}/preview/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options || {})
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Falha ao iniciar preview' }));
      throw new Error(err.error || 'Falha ao iniciar preview');
    }
    return res.json();
  },

  async stopPreview(id: string): Promise<{ success: boolean; message: string }> {
    const res = await fetch(`${API_BASE}/projects/${id}/preview/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    if (!res.ok) throw new Error('Falha ao parar preview');
    return res.json();
  },

  async getEnvKeys(id: string): Promise<ProjectEnvStudioData> {
    const res = await fetch(`${API_BASE}/projects/${id}/env-keys`);
    if (!res.ok) throw new Error('Falha ao carregar chaves de ambiente');
    return res.json();
  },

  async saveEnvKeys(id: string, keys: Record<string, string>): Promise<{ success: boolean; previewStatus: PreviewStatus }> {
    const res = await fetch(`${API_BASE}/projects/${id}/env-keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Falha ao salvar chaves' }));
      throw new Error(err.error || 'Falha ao salvar chaves');
    }
    return res.json();
  },

  async getHomologationEvidence(id: string): Promise<HomologationEvidenceData> {
    const res = await fetch(`${API_BASE}/projects/${id}/homologation-evidence`);
    if (!res.ok) throw new Error('Falha ao carregar evidências de homologação');
    return res.json();
  },

  getEvidenceFileUrl(id: string, filename: string, cacheBuster?: number | string): string {
    const base = typeof window !== 'undefined' && window.location.protocol === 'file:'
      ? 'http://127.0.0.1:3001/api'
      : API_BASE;
    const cleanFilename = filename ? filename.split('?')[0] : '';
    const t = cacheBuster !== undefined && cacheBuster !== null ? cacheBuster : Date.now();
    return `${base}/projects/${id}/evidence-file/${encodeURIComponent(cleanFilename)}?t=${t}`;
  },

  async getMetaChatStatus(): Promise<MetaChatLiveStatus> {
    const res = await fetch(`${API_BASE}/metachat/status`);
    if (!res.ok) throw new Error('Falha ao obter status do Meta-Chat');
    return res.json();
  },

  async getMetaChatLiveActivity(threadId?: string): Promise<MetaChatLiveActivity> {
    const url = threadId
      ? `${API_BASE}/metachat/live-activity?threadId=${encodeURIComponent(threadId)}`
      : `${API_BASE}/metachat/live-activity`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Falha ao carregar telemetria em tempo real do Meta-Chat');
    return res.json();
  },

  async getMetaChatThreads(): Promise<MetaChatThread[]> {
    const res = await fetch(`${API_BASE}/metachat/threads`);
    if (!res.ok) throw new Error('Falha ao carregar threads do Meta-Chat');
    return res.json();
  },

  async createMetaChatThread(payload?: {
    title?: string;
    model?: string;
    effort?: string;
    account_id?: string;
  }): Promise<MetaChatThread> {
    const res = await fetch(`${API_BASE}/metachat/threads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    });
    if (!res.ok) throw new Error('Falha ao criar nova thread no Meta-Chat');
    return res.json();
  },

  async getMetaChatActiveThread(): Promise<MetaChatThread> {
    const res = await fetch(`${API_BASE}/metachat/threads/active`);
    if (!res.ok) throw new Error('Falha ao carregar thread ativa');
    return res.json();
  },

  async setMetaChatActiveThread(threadId: string): Promise<{ success: boolean; activeThreadId: string }> {
    const res = await fetch(`${API_BASE}/metachat/threads/active`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadId })
    });
    if (!res.ok) throw new Error('Falha ao definir thread ativa');
    return res.json();
  },

  async getMetaChatThreadMessages(threadId: string, limit = 100): Promise<MetaChatMessageItem[]> {
    const res = await fetch(`${API_BASE}/metachat/threads/${encodeURIComponent(threadId)}/messages?limit=${limit}`);
    if (!res.ok) throw new Error('Falha ao carregar mensagens da thread');
    return res.json();
  },

  async updateMetaChatThread(threadId: string, updates: Partial<MetaChatThread>): Promise<MetaChatThread> {
    const res = await fetch(`${API_BASE}/metachat/threads/${encodeURIComponent(threadId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    });
    if (!res.ok) throw new Error('Falha ao atualizar thread');
    return res.json();
  },

  async deleteMetaChatThread(threadId: string): Promise<{ success: boolean }> {
    const res = await fetch(`${API_BASE}/metachat/threads/${encodeURIComponent(threadId)}`, {
      method: 'DELETE'
    });
    if (!res.ok) throw new Error('Falha ao excluir thread');
    return res.json();
  },

  async getMetaChatMessages(threadIdOrLimit?: string | number, maybeLimit = 100): Promise<MetaChatMessageItem[]> {
    let url = `${API_BASE}/metachat/messages`;
    if (typeof threadIdOrLimit === 'number') {
      url += `?limit=${threadIdOrLimit}`;
    } else if (typeof threadIdOrLimit === 'string' && threadIdOrLimit.trim()) {
      url += `?threadId=${encodeURIComponent(threadIdOrLimit.trim())}&limit=${maybeLimit}`;
    } else {
      url += `?limit=${maybeLimit}`;
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error('Falha ao carregar mensagens do Meta-Chat');
    return res.json();
  },

  async sendMetaChatMessage(
    message: string,
    options?: {
      threadId?: string;
      codeActions?: any[];
      runTests?: boolean;
      testFile?: string;
      model?: string;
      reasoningMode?: 'high' | 'medium' | 'low';
      accountId?: string;
      profileId?: string;
      attachments?: any[];
      stream?: boolean;
    },
    fetchOptions?: { signal?: AbortSignal }
  ): Promise<MetaChatResponseData> {
    const res = await fetch(`${API_BASE}/metachat/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Stream-Mode': 'sse'
      },
      body: JSON.stringify({ message, stream: true, ...options }),
      signal: fetchOptions?.signal
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Falha ao enviar mensagem ao Meta-Chat' }));
      throw new Error(err.error || 'Falha ao enviar mensagem ao Meta-Chat');
    }
    return res.json();
  },

  async cancelMetaChat(): Promise<{ cancelled: boolean; message: string }> {
    const res = await fetch(`${API_BASE}/metachat/cancel`, { method: 'POST' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Falha ao cancelar execução do Meta-Chat' }));
      throw new Error(err.error || 'Falha ao cancelar execução do Meta-Chat');
    }
    return res.json();
  },

  async deleteMetaChatMessage(id: string): Promise<{ success: boolean; message: string }> {
    const res = await fetch(`${API_BASE}/metachat/messages/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Falha ao remover mensagem do Meta-Chat' }));
      throw new Error(err.error || 'Falha ao remover mensagem do Meta-Chat');
    }
    return res.json();
  },

  async resetMetaChat(threadId?: string): Promise<{ success: boolean; message: string }> {
    const res = await fetch(`${API_BASE}/metachat/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadId })
    });
    if (!res.ok) throw new Error('Falha ao resetar histórico do Meta-Chat');
    return res.json();
  },

  async recompileMetaChat(): Promise<MetaChatRecompileResult> {
    const res = await fetch(`${API_BASE}/metachat/recompile`, { method: 'POST' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Falha ao recompilar DecoHUB' }));
      throw new Error(err.error || 'Falha ao recompilar DecoHUB');
    }
    return res.json();
  },

  async getMetaChatAutopilotStatus(): Promise<MetaChatAutopilotStatus> {
    const res = await fetch(`${API_BASE}/metachat/autopilot/status`);
    if (!res.ok) throw new Error('Falha ao obter status do Autopilot');
    return res.json();
  },

  async startMetaChatAutopilot(payload?: {
    maxCycles?: number;
    cooldownSeconds?: number;
    model?: string;
    accountId?: string;
    threadId?: string;
  }): Promise<MetaChatAutopilotStatus> {
    const res = await fetch(`${API_BASE}/metachat/autopilot/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Falha ao iniciar Autopilot' }));
      throw new Error(err.error || 'Falha ao iniciar Autopilot');
    }
    return res.json();
  },

  async stopMetaChatAutopilot(): Promise<MetaChatAutopilotStatus> {
    const res = await fetch(`${API_BASE}/metachat/autopilot/stop`, {
      method: 'POST'
    });
    if (!res.ok) throw new Error('Falha ao pausar Autopilot');
    return res.json();
  },

  async getMlStatus(): Promise<DecoMindMlStatus> {
    const res = await fetch(`${API_BASE}/ml/status`);
    if (!res.ok) throw new Error('Falha ao obter telemetria do DecoMind ML');
    return res.json();
  },

  async getSlashCommands(): Promise<SlashCommandItem[]> {
    const res = await fetch(`${API_BASE}/skills/slash-commands`);
    if (!res.ok) throw new Error('Falha ao carregar catálogo de slash commands');
    return res.json();
  }
};




