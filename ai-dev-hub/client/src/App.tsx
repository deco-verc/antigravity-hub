import React, { useState, useEffect, useRef } from 'react';
import { Project, FullProjectDetails, ChatMessage, ToastMessage, AccountProfile, AutonomousRun } from './types';
import { api } from './services/api';
import { DecoHubSidebar } from './components/DecoHubSidebar';
import { DecoHubHeader } from './components/DecoHubHeader';
import { DecoHubOverview } from './components/DecoHubOverview';
import { DecoHubChatView } from './components/DecoHubChatView';
import { DecoHubTasksView } from './components/DecoHubTasksView';
import { DecoHubFilesView } from './components/DecoHubFilesView';
import { DecoHubActivityView } from './components/DecoHubActivityView';
import { DecoHubRightPanel } from './components/DecoHubRightPanel';
import { AdvancedDashboardModal } from './components/AdvancedDashboardModal';

import { DiffModal } from './components/DiffModal';
import { TerminalDrawer } from './components/TerminalDrawer';
import { AddAccountModal } from './components/AddAccountModal';
import { AccountManagerModal } from './components/AccountManagerModal';
import { ProjectOperationsBar } from './components/ProjectOperationsBar';
import { DecoHubMetaChatView } from './components/DecoHubMetaChatView';
import { NewProjectModal } from './components/NewProjectModal';
import { CheckpointModal } from './components/CheckpointModal';
import { ContinuityModal } from './components/ContinuityModal';
import { ToastContainer } from './components/ToastContainer';
import { HealthCheckModal } from './components/HealthCheckModal';
import { ProjectProgramModal } from './components/ProjectProgramModal';
import { ResearchModal } from './components/ResearchModal';
import { CouncilModal } from './components/CouncilModal';
import { ArenaModal } from './components/ArenaModal';
import { BenchmarkModal } from './components/BenchmarkModal';

import {
  WifiOff,
  FolderPlus,
  Layers,
  Sparkles
} from 'lucide-react';
import { CouncilDeliberation, ArenaRunData } from './types';

export const App: React.FC = () => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const activeProjectRef = useRef(activeProjectId);
  activeProjectRef.current = activeProjectId;
  const [projectDetails, setProjectDetails] = useState<FullProjectDetails | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [projectRun, setProjectRun] = useState<AutonomousRun | null>(null);
  const [projectExecutionError, setProjectExecutionError] = useState<string | null>(null);
  const [isOfflineExecution,setIsOfflineExecution] = useState(false);
  useEffect(()=>{api.getExecutionEnvironment().then(state=>setIsOfflineExecution(state.offline)).catch(()=>{});},[]);
  useEffect(() => {
    let mounted = true;
    setProjectRun(null);
    setProjectExecutionError(null);
    const refresh = () => {
      if (activeProjectId) {
        api.getActiveAutonomousRun(activeProjectId).then(run => { if (mounted) setProjectRun(run); }).catch(() => {});
        api.getMessages(activeProjectId).then(msgs => {
          if (mounted && activeProjectRef.current === activeProjectId) {
            setMessages(prev => {
              if (prev.length !== msgs.length || (msgs.length > 0 && prev[prev.length - 1]?.id !== msgs[msgs.length - 1]?.id)) {
                return msgs;
              }
              return prev;
            });
          }
        }).catch(() => {});
      }
    };
    refresh();
    const timer = setInterval(refresh, 2500);
    return () => { mounted = false; clearInterval(timer); };
  }, [activeProjectId]);

  const handleSelectProject = (id: string) => {
    setIsMetaChatActive(false);
    if (!id) return;
    activeProjectRef.current = id;
    setActiveProjectId(id);
    localStorage.setItem('ai_dev_last_project', id);

    // Optimistic reset: Immediately switch projectDetails to the newly selected project
    // from the projects list, ensuring 0ms immediate visual header/tab switch
    const baseProj = projects.find(p => p.id === id);
    if (baseProj) {
      setProjectDetails({
        ...baseProj,
        isAvailableOnDisk: true,
        memory: {
          projectMd: '',
          architectureMd: '',
          decisionsMd: '',
          tasksMd: '',
          changesMd: '',
          sessionSummaryMd: '',
        },
        gitInfo: {
          isGitRepo: false,
          branch: null,
          lastCommit: null,
          statusSummary: { modified: 0, newFiles: 0, deleted: 0, total: 0 },
          changedFiles: [],
        },
        parsedTasks: { pending: [], doing: [], done: [] },
      });
    } else {
      setProjectDetails(null);
    }

    setMessages([]);
    setProjectRun(null);
    setProjectExecutionError(null);

    loadProjectDetails(id);
    loadMessages(id);
    loadActiveAccountForProject(id);
  };

  // Navigation: 5 main tabs (Chat, Overview, Tasks, Files, Activity)
  const [activeMainTab, setActiveMainTab] = useState<'chat' | 'overview' | 'tasks' | 'files' | 'activity'>(() => {
    return (localStorage.getItem('ai_dev_last_tab') as any) || 'chat';
  });
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(false);

  const switchTab = (tab: 'chat' | 'overview' | 'tasks' | 'files' | 'activity') => {
    setActiveMainTab(tab);
    localStorage.setItem('ai_dev_last_tab', tab);
  };

  // Multi-Account state
  const [accounts, setAccounts] = useState<AccountProfile[]>([]);
  const [activeAccount, setActiveAccount] = useState<AccountProfile | null>(null);
  const [isMetaChatActive, setIsMetaChatActive] = useState(false);
  const [isAddAccountModalOpen, setIsAddAccountModalOpen] = useState(false);
  const [isAccountManagerOpen, setIsAccountManagerOpen] = useState(false);

  // Agent Status & Terminal / Diff
  const [agentStatus, setAgentStatus] = useState<'ready' | 'working' | 'error'>('ready');
  const [isTerminalOpen, setIsTerminalOpen] = useState(false);
  const [isDiffModalOpen, setIsDiffModalOpen] = useState(false);

  // Advanced Dashboard Modal
  const [isAdvancedModalOpen, setIsAdvancedModalOpen] = useState(false);

  // Other Modals (Preserved 100%)
  const [isNewProjectModalOpen, setIsNewProjectModalOpen] = useState(false);
  const [isCheckpointModalOpen, setIsCheckpointModalOpen] = useState(false);
  const [isContinuityModalOpen, setIsContinuityModalOpen] = useState(false);
  const [isHealthModalOpen, setIsHealthModalOpen] = useState(false);
  const [isProjectProgramModalOpen, setIsProjectProgramModalOpen] = useState(false);
  const [isResearchModalOpen, setIsResearchModalOpen] = useState(false);
  const [isCouncilModalOpen, setIsCouncilModalOpen] = useState(false);
  const [councilDeliberation, setCouncilDeliberation] = useState<CouncilDeliberation | null>(null);
  const [isArenaModalOpen, setIsArenaModalOpen] = useState(false);
  const [arenaRun, setArenaRun] = useState<ArenaRunData | null>(null);
  const [isBenchmarkModalOpen, setIsBenchmarkModalOpen] = useState(false);

  // Backend connection status
  const [isBackendOnline, setIsBackendOnline] = useState(true);
  const [recoveryStatus, setRecoveryStatus] = useState<{ type: 'crashed' | 'recovered'; message: string } | null>(null);

  // Toasts
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = (type: ToastMessage['type'], message: string) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3500);
  };

  const removeToast = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  // Desktop status listener
  useEffect(() => {
    if ((window as any).desktopAPI?.onStatusChange) {
      (window as any).desktopAPI.onStatusChange((event: any) => {
        if (event.type === 'backend_crashed') {
          setRecoveryStatus({
            type: 'crashed',
            message: '⚠️ Alerta Desktop: O processo backend foi interrompido. Auto-Recovery reiniciando o serviço...'
          });
        } else if (event.type === 'backend_recovered') {
          setRecoveryStatus({
            type: 'recovered',
            message: `✓ Auto-Recovery: Backend recuperado com sucesso e operacional na porta ${event.data?.port || 3001}.`
          });
          setTimeout(() => setRecoveryStatus(null), 6000);
        }
      });
    }
  }, []);

  // Initial load
  useEffect(() => {
    loadInitialData();
    const interval = setInterval(() => {
      api.getSystemHealth()
        .then(() => setIsBackendOnline(true))
        .catch(() => setIsBackendOnline(false));
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  const loadInitialData = async () => {
    try {
      const [projs, accs] = await Promise.all([
        api.getProjects(),
        api.getAccountProfiles()
      ]);
      setProjects(projs);
      setAccounts(accs);
      setIsBackendOnline(true);

      const savedProjectId = localStorage.getItem('ai_dev_last_project');
      const savedAccountId = localStorage.getItem('ai_dev_last_account');

      let initialProjId = projs.length > 0 ? projs[0].id : null;
      if (savedProjectId && projs.some(p => p.id === savedProjectId)) {
        initialProjId = savedProjectId;
      }

      if (initialProjId) {
        setActiveProjectId(initialProjId);
      }

      // Restore active account from backend system_settings or localStorage
      try {
        const activeGlobal = await api.getActiveAccountProfile();
        if (activeGlobal && accs.some(a => a.id === activeGlobal.id)) {
          setActiveAccount(activeGlobal);
          localStorage.setItem('ai_dev_last_account', activeGlobal.id);
        } else if (savedAccountId && accs.some(a => a.id === savedAccountId)) {
          const found = accs.find(a => a.id === savedAccountId);
          if (found) setActiveAccount(found);
        } else if (accs.length > 0) {
          setActiveAccount(accs[0]);
        }
      } catch {
        if (savedAccountId && accs.some(a => a.id === savedAccountId)) {
          const found = accs.find(a => a.id === savedAccountId);
          if (found) setActiveAccount(found);
        } else if (accs.length > 0) {
          setActiveAccount(accs[0]);
        }
      }
    } catch (err) {
      console.error('Falha ao carregar dados iniciais', err);
      setIsBackendOnline(false);
    }
  };

  // When activeProjectId changes
  useEffect(() => {
    if (activeProjectId) {
      localStorage.setItem('ai_dev_last_project', activeProjectId);
      loadProjectDetails(activeProjectId);
      loadMessages(activeProjectId);
      loadActiveAccountForProject(activeProjectId);
    } else {
      setProjectDetails(null);
      setMessages([]);
    }
  }, [activeProjectId]);

  const loadProjects = async () => {
    try {
      const projs = await api.getProjects();
      setProjects(projs);
      setIsBackendOnline(true);
      if (projs.length > 0 && !activeProjectId) {
        setActiveProjectId(projs[0].id);
      }
    } catch (err) {
      setIsBackendOnline(false);
      console.error('Falha ao carregar lista de projetos', err);
    }
  };

  const loadAccounts = async () => {
    try {
      const list = await api.getAccountProfiles();
      setAccounts(list);
    } catch (err) {
      console.error('Falha ao carregar perfis de contas', err);
    }
  };

  const loadActiveAccountForProject = async (projId: string) => {
    try {
      const res = await api.getActiveAccountForProject(projId);
      if (res.activeProfile) {
        setActiveAccount(res.activeProfile);
        localStorage.setItem('ai_dev_last_account', res.activeProfile.id);
      }
    } catch {
      if (accounts.length > 0 && !activeAccount) {
        setActiveAccount(accounts[0]);
      }
    }
  };

  const loadProjectDetails = async (id: string) => {
    try {
      const details = await api.getProject(id);
      if (activeProjectRef.current !== id) return;
      setProjectDetails(details);
      setIsBackendOnline(true);

      api.getCouncilDeliberations(id)
        .then(delibs => {
          if (delibs && delibs.length > 0) {
            setCouncilDeliberation(delibs[0]);
          } else {
            setCouncilDeliberation(null);
          }
        })
        .catch(() => setCouncilDeliberation(null));

      api.getArenaRuns(id)
        .then(runs => {
          if (runs && runs.length > 0) {
            setArenaRun(runs[0]);
          } else {
            setArenaRun(null);
          }
        })
        .catch(() => setArenaRun(null));
    } catch (err: any) {
      console.error('Falha ao carregar detalhes do projeto', err);
    }
  };

  const loadMessages = async (id: string) => {
    try {
      const msgs = await api.getMessages(id);
      if (activeProjectRef.current !== id) return;
      setMessages(msgs);
    } catch (err) {
      console.error('Falha ao carregar mensagens', err);
    }
  };

  const handleSendMessage = async (content: string, requestId?: string, options?: { signal?: AbortSignal }) => {
    if (!activeProjectId) return;
    setAgentStatus('working');
    try {
      const res = await api.sendMessage(activeProjectId, content, requestId, options);
      if (activeProjectRef.current !== activeProjectId) return;
      setMessages(prev => {const ids=new Set(prev.map(m=>m.id));return [...prev,...[res.userMessage,res.assistantReply].filter(m=>!ids.has(m.id))];});
      setProjectRun(res.autonomousRun || null);
      
      const isBlocked = res.execution?.status === 'blocked';
      const isQueued = res.execution?.status === 'queued';
      
      setProjectExecutionError(isBlocked ? res.execution.reason || 'Execução bloqueada' : null);
      setAgentStatus(isBlocked ? 'error' : 'ready');
      
      const toastType = isBlocked ? 'error' : isQueued ? 'info' : res.execution?.status === 'started' ? 'success' : 'info';
      const toastMsg = isBlocked 
        ? `Execução bloqueada: ${res.execution.reason}` 
        : isQueued 
        ? 'Instrução salva na fila do projeto com sucesso.' 
        : res.execution?.status === 'started' 
        ? 'Plano criado. Execução autônoma iniciada.' 
        : 'Instrução registrada.';
        
      addToast(toastType, toastMsg);
      await loadProjectDetails(activeProjectId);
    } catch (err: any) {
      if (err.name === 'AbortError' || err.message?.includes('aborted')) {
        setAgentStatus('ready');
        await loadMessages(activeProjectId);
        return;
      }
      if (err.isAlreadyRegistered) {
        addToast('info', err.message || 'Sua instrução já foi registrada e está sendo processada.');
        setAgentStatus('ready');
        await loadMessages(activeProjectId);
        await loadProjectDetails(activeProjectId);
        return;
      }
      setAgentStatus('error');
      addToast('error', `Erro ao enviar instrução: ${err.message}`);
      throw err;
    }
  };

  const handleStopAgent = async () => {
    if (!activeProjectId) return;
    try {
      const result = await api.stopAgent(activeProjectId);
      if (!result.pending) setAgentStatus('ready');
      addToast('info', result.message);
    } catch (err: any) {
      addToast('error', `Erro ao parar agente: ${err.message}`);
    }
  };

  const [isResuming, setIsResuming] = useState(false);
  const handleContinueRun = async () => {
    switchTab('chat');
    if (!activeProjectId || isResuming) return;
    setIsResuming(true);
    try {
      const current = await api.getActiveAutonomousRun(activeProjectId);
      if (!current) { addToast('info', 'Envie um objetivo no chat para criar uma execução.'); return; }
      const run = await api.resumeAutonomousRun(current.id);
      addToast(run.last_error ? 'error' : 'info', run.last_error ? `Execução bloqueada: ${run.last_error}` : run.next_action || 'Execução retomada.');
      await loadProjectDetails(activeProjectId);
    } catch (err: any) { addToast('error', err.message); }
    finally { setIsResuming(false); }
  };

  const handleSaveMemoryFile = async (fileName: string, content: string) => {
    if (!activeProjectId) return;
    try {
      await api.updateMemoryFile(activeProjectId, fileName, content);
      await loadProjectDetails(activeProjectId);
      addToast('success', `Arquivo ${fileName} salvo no disco.`);
    } catch (err: any) {
      addToast('error', `Erro ao salvar: ${err.message}`);
    }
  };

  const handleAddTask = async (text: string, column: 'pending' | 'doing' | 'done') => {
    if (!activeProjectId) return;
    try {
      await api.addTask(activeProjectId, text, column);
      await loadProjectDetails(activeProjectId);
      addToast('success', `Tarefa adicionada: "${text}"`);
    } catch (err: any) {
      addToast('error', `Erro ao adicionar tarefa: ${err.message}`);
    }
  };

  const handleMoveTask = async (taskText: string, from: 'pending' | 'doing' | 'done', to: 'pending' | 'doing' | 'done') => {
    if (!activeProjectId) return;
    try {
      await api.moveTask(activeProjectId, taskText, from, to);
      await loadProjectDetails(activeProjectId);
      addToast('info', `Tarefa movida para ${to}.`);
    } catch (err: any) {
      addToast('error', `Erro ao mover tarefa: ${err.message}`);
    }
  };

  const handleUpdateObjective = async (newObjective: string) => {
    if (!activeProjectId || !projectDetails) return;
    try {
      let content = projectDetails.memory?.projectMd || '# Projeto\n';
      if (content.includes('## Objetivo') || content.includes('# Objetivo')) {
        content = content.replace(/(##?\s*Objetivo[\s\S]*?)(?=\n##|$)/i, `## Objetivo\n${newObjective}\n\n`);
      } else {
        content += `\n\n## Objetivo\n${newObjective}\n`;
      }
      await api.updateMemoryFile(activeProjectId, 'project.md', content);
      await loadProjectDetails(activeProjectId);
      addToast('success', 'Objetivo do projeto atualizado.');
    } catch (err: any) {
      addToast('error', `Erro ao atualizar objetivo: ${err.message}`);
    }
  };

  const handleDeleteProject = async (id: string) => {
    if (!confirm('Deseja realmente desconectar este projeto do DecoHUB? (Os arquivos no disco não serão apagados)')) {
      return;
    }
    try {
      await api.deleteProject(id);
      addToast('info', 'Projeto desvinculado do DecoHUB.');
      const remaining = projects.filter(p => p.id !== id);
      setProjects(remaining);
      if (activeProjectId === id) {
        const nextId = remaining.length > 0 ? remaining[0].id : null;
        setActiveProjectId(nextId);
        if (nextId) localStorage.setItem('ai_dev_last_project', nextId);
      }
    } catch (err: any) {
      addToast('error', `Erro ao deletar projeto: ${err.message}`);
    }
  };

  const handleOpenFolder = async () => {
    if (!projectDetails) return;
    try {
      await api.openFolder(projectDetails.id);
      addToast('success', 'Pasta aberta no Windows Explorer.');
    } catch (err: any) {
      addToast('error', err.message);
    }
  };

  const handleOpenTerminal = async () => {
    if (!projectDetails) return;
    try {
      await api.openTerminal(projectDetails.id);
      addToast('success', 'Terminal aberto no diretório do projeto.');
    } catch (err: any) {
      addToast('error', err.message);
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-[#07090e] text-[#cbd1e1]">
      {/* Toast notifications */}
      <ToastContainer toasts={toasts} onDismiss={removeToast} />

      {/* Offline banner if backend disconnected */}
      {!isBackendOnline && (
        <div className="fixed top-0 inset-x-0 z-50 bg-rose-600 text-white text-xs font-semibold px-4 py-1.5 flex items-center justify-center gap-2 shadow-md">
          <WifiOff className="w-4 h-4" />
          <span>Servidor backend local (porta 3001) desconectado. Tentando reconectar...</span>
        </div>
      )}

      {/* Desktop Auto-Recovery banner */}
      {recoveryStatus && (
        <div
          id="desktop-recovery-banner"
          className={`fixed top-0 inset-x-0 z-50 text-white text-xs font-semibold px-4 py-2 flex items-center justify-center gap-2 shadow-xl transition-all ${
            recoveryStatus.type === 'crashed' ? 'bg-amber-600 animate-pulse' : 'bg-emerald-600'
          }`}
        >
          <span>{recoveryStatus.message}</span>
        </div>
      )}

      {/* Main Workspace Frame */}
      {isOfflineExecution && <div role="status" className="shrink-0 bg-indigo-950/50 border-b border-indigo-500/20 px-4 py-1.5 text-center text-xs text-indigo-200">Modo offline · modelos reais desativados</div>}
      <div className="flex-1 flex overflow-hidden">
        {/* 1. Left Sidebar: Minimalist DecoHUB Sidebar */}
        <DecoHubSidebar
          projects={projects}
          activeProjectId={isMetaChatActive ? null : activeProjectId}
          onSelectProject={handleSelectProject}
          onOpenMetaChat={() => setIsMetaChatActive(true)}
          isMetaChatActive={isMetaChatActive}
          onOpenNewProjectModal={() => setIsNewProjectModalOpen(true)}
          onOpenSettings={() => setIsAdvancedModalOpen(true)}
          onOpenModelsInfo={() => addToast('info', 'Modelos conectados: Google Antigravity & Agent API integrados.')}
          onOpenAdvanced={() => setIsAdvancedModalOpen(true)}
        />

        {/* 2. Main Content Center */}
        {isMetaChatActive ? (
          <DecoHubMetaChatView
            onBack={() => setIsMetaChatActive(false)}
            onShowToast={addToast}
            accounts={accounts}
            activeAccount={activeAccount}
            onAccountSwitched={async (acc) => {
              setActiveAccount(acc);
              localStorage.setItem('ai_dev_last_account', acc.id);
              try {
                await api.setGlobalActiveAccountProfile(acc.id);
                addToast('success', `Conta ativa alterada para "${acc.display_name}".`);
              } catch (err: any) {
                addToast('warn', `Conta selecionada: ${err.message}`);
              }
              loadAccounts();
            }}
            onOpenAccountManager={() => setIsAccountManagerOpen(true)}
            onOpenAddAccountModal={() => setIsAddAccountModalOpen(true)}
            onReloadAccounts={loadAccounts}
          />
        ) : projectDetails ? (
          <div key={activeProjectId || "no-project"} className="flex-1 flex flex-col h-full overflow-hidden">
            {/* Project Header */}
            <DecoHubHeader
              project={projectDetails}
              run={projectRun}
              executionError={projectExecutionError}
              activeAccount={activeAccount}
              accounts={accounts}
              onContinue={handleContinueRun}
              onOpenCheckpoint={() => setIsCheckpointModalOpen(true)}
              onOpenFolder={handleOpenFolder}
              onOpenTerminal={handleOpenTerminal}
              onOpenGitDiff={() => setIsDiffModalOpen(true)}
              onDeleteProject={() => handleDeleteProject(projectDetails.id)}
              onOpenAdvanced={() => setIsAdvancedModalOpen(true)}
              onAccountSwitched={async (acc) => {
                setActiveAccount(acc);
                localStorage.setItem('ai_dev_last_account', acc.id);
                try {
                  if (activeProjectId) {
                    await api.switchProjectAccount(activeProjectId, acc.id);
                  } else {
                    await api.setGlobalActiveAccountProfile(acc.id);
                  }
                  addToast('success', `Conta ativa alterada para "${acc.display_name}".`);
                } catch (err: any) {
                  addToast('warn', `Conta selecionada: ${err.message}`);
                }
                loadAccounts();
                if (activeProjectId) {
                  loadProjectDetails(activeProjectId);
                  loadMessages(activeProjectId);
                }
              }}
              onOpenAccountManager={() => setIsAccountManagerOpen(true)}
              onOpenAddAccountModal={() => setIsAddAccountModalOpen(true)}
              isRightPanelOpen={isRightPanelOpen}
              onToggleRightPanel={() => setIsRightPanelOpen(!isRightPanelOpen)}
            />

            {/* Content Area */}
            <div className="flex-1 flex flex-col h-full overflow-hidden">
              {/* Clean Tab Switcher (Chat, Overview, Tasks, Files, Activity) */}
              <div className="px-8 bg-[#0a0d15] border-b border-[#1b2033] flex items-center justify-between flex-shrink-0">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => switchTab('chat')}
                    className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-all flex items-center gap-2 ${
                      activeMainTab === 'chat'
                        ? 'border-indigo-500 text-white bg-indigo-600/10'
                        : 'border-transparent text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <span>💬 Chat</span>
                    {messages.length > 0 && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#1b2033] text-indigo-300 font-mono">
                        {messages.length}
                      </span>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => switchTab('overview')}
                    className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-all ${
                      activeMainTab === 'overview'
                        ? 'border-indigo-500 text-white bg-indigo-600/10'
                        : 'border-transparent text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Visão Geral
                  </button>

                  <button
                    type="button"
                    onClick={() => switchTab('tasks')}
                    className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-all flex items-center gap-2 ${
                      activeMainTab === 'tasks'
                        ? 'border-indigo-500 text-white bg-indigo-600/10'
                        : 'border-transparent text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <span>Tarefas</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#1b2033] text-slate-300 font-mono">
                      {projectRun?.tasks?.filter(task=>task.status!=='completed').length ?? (projectDetails.parsedTasks.pending.length + projectDetails.parsedTasks.doing.length)}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => switchTab('files')}
                    className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-all ${
                      activeMainTab === 'files'
                        ? 'border-indigo-500 text-white bg-indigo-600/10'
                        : 'border-transparent text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Arquivos
                  </button>

                  <button
                    type="button"
                    onClick={() => switchTab('activity')}
                    className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-all ${
                      activeMainTab === 'activity'
                        ? 'border-indigo-500 text-white bg-indigo-600/10'
                        : 'border-transparent text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Atividade
                  </button>
                </div>

                <ProjectOperationsBar
                  projectId={projectDetails.id}
                  projectName={projectDetails.name}
                  onShowToast={addToast}
                />
              </div>

              {/* Tab Body and Right Panel */}
              <div className="flex-1 flex overflow-hidden">
                <div className="flex-1 flex flex-col h-full overflow-hidden">
                  {activeMainTab === 'chat' && (
                    <DecoHubChatView
                      key={projectDetails.id}
                      project={projectDetails}
                      messages={messages}
                      activeAccount={activeAccount}
                      agentStatus={agentStatus}
                      onSendMessage={handleSendMessage}
                      onStopAgent={handleStopAgent}
                      onBackToOverview={() => switchTab('overview')}
                      onOpenAdvanced={() => setIsAdvancedModalOpen(true)}
                      onRefreshMessages={() => loadMessages(projectDetails.id)}
                    />
                  )}

                  {activeMainTab === 'overview' && (
                    <DecoHubOverview
                      project={projectDetails}
                      onContinue={() => switchTab('chat')}
                      onAddTask={handleAddTask}
                      onUpdateObjective={handleUpdateObjective}
                      onNavigateTab={tab => switchTab(tab)}
                    />
                  )}

                  {activeMainTab === 'tasks' && (
                    <DecoHubTasksView
                      tasks={projectDetails.parsedTasks}
                      run={projectRun}
                      onAddTask={handleAddTask}
                      onMoveTask={handleMoveTask}
                    />
                  )}

                  {activeMainTab === 'files' && (
                    <DecoHubFilesView
                      project={projectDetails}
                    />
                  )}

                  {activeMainTab === 'activity' && (
                    <DecoHubActivityView
                      project={projectDetails}
                    />
                  )}
                </div>

              {/* Collapsible Right Panel */}
              <DecoHubRightPanel
                project={projectDetails}
                activeAccount={activeAccount}
                isOpen={isRightPanelOpen}
                onClose={() => setIsRightPanelOpen(false)}
                onOpenFolder={handleOpenFolder}
                onOpenTerminal={handleOpenTerminal}
                onOpenCheckpoint={() => setIsCheckpointModalOpen(true)}
                onOpenGitDiff={() => setIsDiffModalOpen(true)}
              />
            </div>
          </div>
        </div>
      ) : (
          /* Empty / Welcome State */
          <main className="flex-1 flex flex-col items-center justify-center p-8 bg-[#07090e] text-center">
            <div className="max-w-md space-y-6">
              <div className="w-16 h-16 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 mx-auto flex items-center justify-center text-indigo-400 shadow-xl">
                <Sparkles className="w-8 h-8" />
              </div>

              <div>
                <h2 className="text-xl font-bold text-white tracking-tight">Bem-vindo ao DecoHUB</h2>
                <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                  Crie ou conecte um projeto para iniciar o desenvolvimento contínuo com histórico e memória organizada.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setIsNewProjectModalOpen(true)}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-lg transition-all hover:scale-[1.02]"
              >
                <FolderPlus className="w-4 h-4" />
                <span>+ Novo Projeto</span>
              </button>
            </div>
          </main>
        )}
      </div>

      {/* Unified Advanced Dashboard Modal (Hosting Autonomous Engine, Council, Arena, Benchmarks, Git, Memory, Logs) */}
      {projectDetails && (
        <AdvancedDashboardModal
          isOpen={isAdvancedModalOpen}
          onClose={() => setIsAdvancedModalOpen(false)}
          project={projectDetails}
          activeAccount={activeAccount}
          accounts={accounts}
          onRefreshProject={() => {
            if (activeProjectId) loadProjectDetails(activeProjectId);
          }}
          onSaveMemoryFile={handleSaveMemoryFile}
          onShowToast={addToast}
          onOpenCouncilModal={() => setIsCouncilModalOpen(true)}
          onOpenArenaModal={() => setIsArenaModalOpen(true)}
          onOpenBenchmarkModal={() => setIsBenchmarkModalOpen(true)}
          onOpenProjectProgramModal={() => setIsProjectProgramModalOpen(true)}
          onOpenResearchModal={() => setIsResearchModalOpen(true)}
          onOpenDiffModal={() => setIsDiffModalOpen(true)}
          onOpenTerminal={handleOpenTerminal}
        />
      )}

      {/* Visual Diff Modal */}
      <DiffModal
        isOpen={isDiffModalOpen}
        onClose={() => setIsDiffModalOpen(false)}
        projectId={activeProjectId}
        projectName={projectDetails?.name}
      />

      {/* Terminal Drawer */}
      {activeProjectId && (
        <TerminalDrawer
          projectId={activeProjectId}
          isOpen={isTerminalOpen}
          onToggle={() => setIsTerminalOpen(!isTerminalOpen)}
        />
      )}

      {/* New Project Modal */}
      <NewProjectModal
        isOpen={isNewProjectModalOpen}
        onClose={() => setIsNewProjectModalOpen(false)}
        accounts={accounts}
        activeAccount={activeAccount}
        onProjectCreated={(newProj) => {
          loadProjects();
          setActiveProjectId(newProj.id);
          addToast('success', `Projeto "${newProj.name}" conectado ao DecoHUB.`);
        }}
      />

      {/* Add Account Modal */}
      <AddAccountModal
        isOpen={isAddAccountModalOpen}
        onClose={() => setIsAddAccountModalOpen(false)}
        onAccountAdded={(newAcc) => {
          loadAccounts();
          setActiveAccount(newAcc);
          addToast('success', `Conta Google "${newAcc.display_name}" adicionada.`);
        }}
        onShowToast={addToast}
      />

      {/* Account Manager Modal */}
      <AccountManagerModal
        isOpen={isAccountManagerOpen}
        onClose={() => setIsAccountManagerOpen(false)}
        accounts={accounts}
        activeAccount={activeAccount}
        activeProjectId={activeProjectId}
        onAccountsChanged={() => {
          loadAccounts();
          if (activeProjectId) {
            loadActiveAccountForProject(activeProjectId);
          }
        }}
        onAccountSwitched={(newAcc) => {
          setActiveAccount(newAcc);
          localStorage.setItem('ai_dev_last_account', newAcc.id);
          loadAccounts();
          if (activeProjectId) {
            loadProjectDetails(activeProjectId);
            loadMessages(activeProjectId);
          }
        }}
        onShowToast={addToast}
      />

      {/* Checkpoint Modal */}
      {projectDetails && (
        <CheckpointModal
          isOpen={isCheckpointModalOpen}
          onClose={() => setIsCheckpointModalOpen(false)}
          project={projectDetails}
          onCheckpointGenerated={() => {
            if (activeProjectId) {
              loadProjectDetails(activeProjectId);
              loadMessages(activeProjectId);
            }
            addToast('success', 'Checkpoint criado e memória persistida no disco!');
          }}
        />
      )}

      {/* Continuity Modal */}
      {activeProjectId && projectDetails && (
        <ContinuityModal
          isOpen={isContinuityModalOpen}
          onClose={() => setIsContinuityModalOpen(false)}
          projectId={activeProjectId}
          projectName={projectDetails.name}
        />
      )}

      {/* Health Check Modal */}
      <HealthCheckModal
        isOpen={isHealthModalOpen}
        onClose={() => setIsHealthModalOpen(false)}
      />

      {/* Project Program Modal (Karpathy Execution Layer) */}
      {activeProjectId && (
        <ProjectProgramModal
          isOpen={isProjectProgramModalOpen}
          onClose={() => setIsProjectProgramModalOpen(false)}
          projectId={activeProjectId}
          projectName={projectDetails?.name || 'Projeto'}
          onShowToast={addToast}
        />
      )}

      {/* Research Run Modal (Autoresearch Mode) */}
      {activeProjectId && (
        <ResearchModal
          isOpen={isResearchModalOpen}
          onClose={() => setIsResearchModalOpen(false)}
          projectId={activeProjectId}
          projectName={projectDetails?.name || 'Projeto'}
        />
      )}

      {/* AI DEV Council Deliberation Modal */}
      <CouncilModal
        isOpen={isCouncilModalOpen}
        onClose={() => setIsCouncilModalOpen(false)}
        deliberation={councilDeliberation}
      />

      {/* AI DEV ARENA Modal */}
      {activeProjectId && (
        <ArenaModal
          isOpen={isArenaModalOpen}
          onClose={() => {
            setIsArenaModalOpen(false);
            if (activeProjectId) loadProjectDetails(activeProjectId);
          }}
          projectId={activeProjectId}
          projectName={projectDetails?.name || 'Projeto'}
        />
      )}

      {/* AI DEV BENCHMARK Modal */}
      <BenchmarkModal
        isOpen={isBenchmarkModalOpen}
        onClose={() => setIsBenchmarkModalOpen(false)}
      />
    </div>
  );
};

export default App;
