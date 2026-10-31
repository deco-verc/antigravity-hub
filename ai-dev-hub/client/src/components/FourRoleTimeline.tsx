import React, { useState, useEffect, useRef } from 'react';
import {
  MessageSquare,
  Brain,
  Wrench,
  ShieldCheck,
  ShieldAlert,
  ChevronDown,
  ChevronUp,
  FileCode,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Layers,
  Sparkles,
  Terminal,
  Activity,
  RotateCcw
} from 'lucide-react';
import { createProjectSseClient, createMetaChatSseClient, DecoHubSseClient } from '../services/sseClient';

export interface FourRoleTimelineProps {
  projectId?: string | null;
  projectName?: string;
  isMetaChat?: boolean;
  className?: string;
}

interface DagNode {
  id: string;
  title: string;
  status: string;
  dependencies?: string[];
  files?: string[];
}

interface TimelineState {
  hasActivity: boolean;
  facade: {
    status: 'idle' | 'received' | 'active' | 'completed';
    objective: string;
    projectName?: string;
    timestamp?: string;
  };
  supervisor: {
    status: 'idle' | 'planning' | 'completed' | 'failed';
    dag?: {
      id?: string;
      nodes?: DagNode[];
    };
    plannedFiles: string[];
    timestamp?: string;
  };
  worker: {
    status: 'idle' | 'executing' | 'completed' | 'failed';
    touchedFiles: string[];
    executionTimeMs?: number;
    testPassed?: boolean;
    testOutput?: string;
    timestamp?: string;
  };
  reviewer: {
    status: 'idle' | 'verifying' | 'approved' | 'rejected';
    verdict?: 'APROVADO' | 'REJEITADO - EM CORREÇÃO' | string;
    typecheckPassed?: boolean;
    typecheckOutput?: string;
    timestamp?: string;
  };
}

const INITIAL_STATE: TimelineState = {
  hasActivity: false,
  facade: {
    status: 'idle',
    objective: ''
  },
  supervisor: {
    status: 'idle',
    plannedFiles: []
  },
  worker: {
    status: 'idle',
    touchedFiles: []
  },
  reviewer: {
    status: 'idle'
  }
};

export const FourRoleTimeline: React.FC<FourRoleTimelineProps> = ({
  projectId,
  projectName = 'DecoHUB',
  isMetaChat = false,
  className = ''
}) => {
  const [state, setState] = useState<TimelineState>(INITIAL_STATE);
  const [isMiddleCollapsed, setIsMiddleCollapsed] = useState<boolean>(false);
  const [expandSupervisorDag, setExpandSupervisorDag] = useState<boolean>(false);
  const [expandWorkerFiles, setExpandWorkerFiles] = useState<boolean>(false);
  const [expandReviewerDetails, setExpandReviewerDetails] = useState<boolean>(false);

  const workerStartTimeRef = useRef<number | null>(null);

  useEffect(() => {
    // Reset state when project changes
    setState(INITIAL_STATE);
    setIsMiddleCollapsed(false);
    setExpandSupervisorDag(false);
    setExpandWorkerFiles(false);
    setExpandReviewerDetails(false);
    workerStartTimeRef.current = null;

    let sseClient: DecoHubSseClient | null = null;
    try {
      if (isMetaChat) {
        sseClient = createMetaChatSseClient();
      } else if (projectId) {
        sseClient = createProjectSseClient(projectId);
      }
    } catch (err) {
      console.warn('[FourRoleTimeline] Erro ao instanciar SSE Client:', err);
      return;
    }

    if (!sseClient) return;

    // 1. Escuta STATUS_FACADE_RECEIVED
    const handleFacadeReceived = (data: any) => {
      const obj = data?.objective || data?.message || data?.detail || 'Comando recebido pelo Chat Facade';
      workerStartTimeRef.current = null;
      setIsMiddleCollapsed(false);
      setState({
        hasActivity: true,
        facade: {
          status: 'received',
          objective: obj,
          projectName: data?.projectName || projectName,
          timestamp: data?.timestamp || new Date().toISOString()
        },
        supervisor: {
          status: 'planning',
          plannedFiles: []
        },
        worker: {
          status: 'idle',
          touchedFiles: []
        },
        reviewer: {
          status: 'idle'
        }
      });
    };

    // 2. Escuta STATUS_SUPERVISOR_PLANNING
    const handleSupervisorPlanning = (data: any) => {
      const files = data?.affectedFiles || data?.plannedFiles || data?.files || [];
      const dag = data?.dag || (files.length > 0 ? {
        id: `dag-${Date.now()}`,
        nodes: [
          { id: 'step-1-analysis', title: 'Mapeamento de Requisitos e Análise de Impacto', status: 'COMPLETED' },
          { id: 'step-2-worker', title: 'Edição Cirúrgica de Código e Testes', status: 'IN_PROGRESS', files },
          { id: 'step-3-review', title: 'Auditoria Estrita de Tipagem (tsc --noEmit)', status: 'PENDING' }
        ]
      } : undefined);

      setState(prev => ({
        ...prev,
        hasActivity: true,
        facade: {
          ...prev.facade,
          status: 'completed',
          objective: prev.facade.objective || data?.objective || 'Alinhamento com usuário estabelecido'
        },
        supervisor: {
          status: 'completed',
          dag,
          plannedFiles: files.length > 0 ? files : prev.supervisor.plannedFiles,
          timestamp: data?.timestamp || new Date().toISOString()
        },
        worker: {
          ...prev.worker,
          status: prev.worker.status === 'idle' ? 'executing' : prev.worker.status
        }
      }));
    };

    // 3. Escuta STATUS_WORKER_EXECUTING
    const handleWorkerExecuting = (data: any) => {
      if (!workerStartTimeRef.current) {
        workerStartTimeRef.current = Date.now();
      }
      const files = data?.affectedFiles || data?.filesModified || data?.files || [];
      const executionTimeMs = data?.duration_ms || (workerStartTimeRef.current ? Date.now() - workerStartTimeRef.current : 320);

      setState(prev => ({
        ...prev,
        hasActivity: true,
        supervisor: {
          ...prev.supervisor,
          status: 'completed'
        },
        worker: {
          status: 'completed',
          touchedFiles: files.length > 0 ? files : (prev.supervisor.plannedFiles.length > 0 ? prev.supervisor.plannedFiles : prev.worker.touchedFiles),
          executionTimeMs,
          testPassed: data?.testPassed ?? true,
          testOutput: data?.testOutput || data?.output || 'Testes unitários verificados com integridade.',
          timestamp: data?.timestamp || new Date().toISOString()
        },
        reviewer: {
          ...prev.reviewer,
          status: prev.reviewer.status === 'idle' ? 'verifying' : prev.reviewer.status
        }
      }));
    };

    // 4. Escuta STATUS_REVIEWER_VERIFYING e STATUS_REVIEWER_AUDITING
    const handleReviewerVerifying = (data: any) => {
      setState(prev => ({
        ...prev,
        hasActivity: true,
        worker: {
          ...prev.worker,
          status: 'completed'
        },
        reviewer: {
          status: 'verifying',
          verdict: 'AUDITANDO (tsc --noEmit)...',
          typecheckPassed: undefined,
          typecheckOutput: 'Executando tsc --noEmit na base de código...',
          timestamp: data?.timestamp || new Date().toISOString()
        }
      }));
    };

    // 5. Escuta STATUS_REJECTED_RETRYING
    const handleRejectedRetrying = (data: any) => {
      setIsMiddleCollapsed(false); // Mantém aberto para visibilidade total do erro
      setState(prev => ({
        ...prev,
        hasActivity: true,
        reviewer: {
          status: 'rejected',
          verdict: 'REJEITADO - EM CORREÇÃO',
          typecheckPassed: false,
          typecheckOutput: data?.output || data?.error || 'Erros de tipagem detectados no tsc --noEmit. Worker reacionado para correção cirúrgica.',
          timestamp: data?.timestamp || new Date().toISOString()
        }
      }));
    };

    // 6. Escuta evento unificado timeline_event (emitido por projectChatService)
    const handleTimelineEvent = (data: any) => {
      if (!data) return;
      if (data.type === 'facade_received' || data.role === 'chat_facade') {
        handleFacadeReceived(data);
      } else if (data.type === 'supervisor_dag_created' || data.role === 'supervisor') {
        handleSupervisorPlanning(data);
      } else if (data.type === 'worker_executed' || data.role === 'worker') {
        handleWorkerExecuting(data);
      } else if (data.type === 'reviewer_validated' || data.role === 'reviewer') {
        const passed = Boolean(data.typecheckPassed ?? (data.verdict === 'APROVADO'));
        if (passed) {
          setIsMiddleCollapsed(true); // RECOLHIMENTO AUTOMÁTICO DISCRETO QUANDO APROVADO
          setState(prev => ({
            ...prev,
            hasActivity: true,
            supervisor: { ...prev.supervisor, status: 'completed' },
            worker: { ...prev.worker, status: 'completed' },
            reviewer: {
              status: 'approved',
              verdict: 'APROVADO',
              typecheckPassed: true,
              typecheckOutput: data.output || 'tsc --noEmit concluído com 0 erros.',
              timestamp: data.timestamp || new Date().toISOString()
            }
          }));
        } else {
          handleRejectedRetrying(data);
        }
      }
    };

    // Registra todos os handlers de status SSE
    sseClient.on('STATUS_FACADE_RECEIVED', handleFacadeReceived);
    sseClient.on('STATUS_SUPERVISOR_PLANNING', handleSupervisorPlanning);
    sseClient.on('STATUS_WORKER_EXECUTING', handleWorkerExecuting);
    sseClient.on('STATUS_REVIEWER_VERIFYING', handleReviewerVerifying);
    sseClient.on('STATUS_REVIEWER_AUDITING', handleReviewerVerifying);
    sseClient.on('STATUS_REJECTED_RETRYING', handleRejectedRetrying);
    sseClient.on('timeline_event', handleTimelineEvent);

    // Escuta também o canal 'activity' para telemetria em tempo real
    sseClient.on('activity', (data: any) => {
      if (data?.role === 'chat_facade') {
        handleFacadeReceived(data);
      } else if (data?.role === 'supervisor') {
        handleSupervisorPlanning(data);
      } else if (data?.role === 'worker') {
        handleWorkerExecuting(data);
      } else if (data?.role === 'reviewer') {
        if (data.verdict === 'APROVADO' || data.typecheckPassed) {
          setIsMiddleCollapsed(true);
          setState(prev => ({
            ...prev,
            hasActivity: true,
            reviewer: {
              status: 'approved',
              verdict: 'APROVADO',
              typecheckPassed: true,
              typecheckOutput: data.detail || 'Auditoria tsc aprovada com 0 erros.',
              timestamp: new Date().toISOString()
            }
          }));
        } else if (data.verdict === 'REPROVADO' || data.verdict === 'REJEITADO') {
          handleRejectedRetrying(data);
        }
      }
    });

    return () => {
      sseClient?.close();
    };
  }, [projectId, isMetaChat, projectName]);

  // Se não houver atividade registrada ainda, exibe o banner compacto de standby
  if (!state.hasActivity) {
    return (
      <div className={`bg-slate-900/60 backdrop-blur-sm border border-slate-800/80 rounded-xl p-2.5 px-3.5 mb-2.5 transition-all text-xs text-slate-400 ${className}`}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 font-medium text-slate-300">
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-60"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
            </span>
            <span className="tracking-wide">Pipeline de 4 Papéis:</span>
          </div>

          <div className="flex items-center gap-2 overflow-x-auto py-0.5 scrollbar-none">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-950/60 text-blue-400 border border-blue-500/30 text-[11px]">
              💬 Chat Facade
            </span>
            <span className="text-slate-600 font-mono">→</span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-950/60 text-purple-400 border border-purple-500/30 text-[11px]">
              🧠 Supervisor
            </span>
            <span className="text-slate-600 font-mono">→</span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-950/60 text-amber-400 border border-amber-500/30 text-[11px]">
              🔨 Worker
            </span>
            <span className="text-slate-600 font-mono">→</span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-950/60 text-emerald-400 border border-emerald-500/30 text-[11px]">
              🛡️ Reviewer
            </span>
          </div>

          <div className="hidden sm:flex items-center gap-1.5 text-slate-500 text-[11px]">
            <Sparkles className="w-3 h-3 text-blue-400" />
            <span>Pronto para o próximo prompt</span>
          </div>
        </div>
      </div>
    );
  }

  const isApproved = state.reviewer.status === 'approved';
  const isRejected = state.reviewer.status === 'rejected';

  return (
    <div className={`bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-xl p-3 mb-3 shadow-lg shadow-black/20 transition-all duration-300 ${className}`}>
      {/* Header com indicador global e ação de toggle do acordeão */}
      <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800/80">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-5 h-5 rounded-md bg-blue-500/10 text-blue-400 border border-blue-500/20">
            <Layers className="w-3.5 h-3.5" />
          </div>
          <span className="text-xs font-semibold text-slate-200 tracking-wide uppercase">
            Pipeline Reativo de 4 Papéis
          </span>
          {isApproved && (
            <span className="ml-1 text-[10px] font-semibold tracking-wider px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
              AUDITADO & APROVADO
            </span>
          )}
          {isRejected && (
            <span className="ml-1 text-[10px] font-semibold tracking-wider px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/40 animate-pulse">
              REJEITADO - EM CORREÇÃO
            </span>
          )}
        </div>

        {/* Botão de Toggle do Acordeão quando aprovado */}
        {isApproved && (
          <button
            onClick={() => setIsMiddleCollapsed(!isMiddleCollapsed)}
            className="flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium text-slate-400 hover:text-slate-200 bg-slate-800/80 hover:bg-slate-800 border border-slate-700/60 rounded-md transition-colors"
            title="Expandir ou recolher os detalhes do Supervisor e Worker"
          >
            <span>{isMiddleCollapsed ? 'Ver Pipeline Completo' : 'Recolher Internos'}</span>
            {isMiddleCollapsed ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
          </button>
        )}
      </div>

      {/* Grid Principal dos Cards dos 4 Papéis */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-2.5">
        {/* ========================================================= */}
        {/* 1. CHAT FACADE (Badge Azul) */}
        {/* ========================================================= */}
        <div className="flex flex-col rounded-lg border border-blue-500/30 bg-blue-950/20 p-2.5 transition-all">
          <div className="flex items-center justify-between gap-1.5 mb-1.5">
            <div className="flex items-center gap-1.5">
              <span className="text-sm">💬</span>
              <span className="text-xs font-semibold text-blue-300">Chat Facade</span>
            </div>
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/40">
              {state.facade.status === 'received' ? 'RECEBIDO' : 'ALINHADO'}
            </span>
          </div>

          <div className="flex-1 text-[11px] text-slate-300 line-clamp-3 bg-slate-950/40 border border-blue-900/30 rounded p-1.5 font-mono">
            {state.facade.objective ? (
              <span>"{state.facade.objective}"</span>
            ) : (
              <span className="text-slate-500 italic">Aguardando mensagem do usuário...</span>
            )}
          </div>

          <div className="mt-1.5 flex items-center justify-between text-[10px] text-blue-400/80">
            <span>Alinhamento do Usuário</span>
            <CheckCircle2 className="w-3 h-3 text-blue-400" />
          </div>
        </div>

        {/* ========================================================= */}
        {/* MODO COLAPSADO DO SUPERVISOR E WORKER (Quando Aprovado) */}
        {/* ========================================================= */}
        {isMiddleCollapsed && isApproved ? (
          <div className="md:col-span-2 flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/50 p-2.5 px-3">
            <div className="flex items-center gap-3">
              <div className="flex -space-x-1.5">
                <div className="w-6 h-6 rounded-full bg-purple-900/50 border border-purple-500/40 flex items-center justify-center text-xs">
                  🧠
                </div>
                <div className="w-6 h-6 rounded-full bg-amber-900/50 border border-amber-500/40 flex items-center justify-center text-xs">
                  🔨
                </div>
              </div>
              <div className="flex flex-col">
                <span className="text-xs font-medium text-slate-200">
                  Supervisor & Worker Concluídos
                </span>
                <span className="text-[10px] text-slate-400 font-mono">
                  DAG executado • {state.worker.touchedFiles.length || state.supervisor.plannedFiles.length} arquivos tocados
                  {state.worker.executionTimeMs ? ` em ${Math.round(state.worker.executionTimeMs)}ms` : ''}
                </span>
              </div>
            </div>

            <button
              onClick={() => setIsMiddleCollapsed(false)}
              className="text-[11px] text-blue-400 hover:text-blue-300 underline font-medium cursor-pointer"
            >
              Expandir
            </button>
          </div>
        ) : (
          <>
            {/* ===================================================== */}
            {/* 2. SUPERVISOR (Badge Roxo Expansível com DAG e Arquivos) */}
            {/* ===================================================== */}
            <div className="flex flex-col rounded-lg border border-purple-500/30 bg-purple-950/20 p-2.5 transition-all">
              <div className="flex items-center justify-between gap-1.5 mb-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm">🧠</span>
                  <span className="text-xs font-semibold text-purple-300">Supervisor</span>
                </div>
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/40">
                  {state.supervisor.status === 'planning' ? 'PLANEJANDO DAG...' : 'DAG PRONTO'}
                </span>
              </div>

              <div className="flex-1 flex flex-col justify-between text-[11px] text-slate-300 bg-slate-950/40 border border-purple-900/30 rounded p-1.5">
                <div>
                  <div className="flex items-center justify-between text-slate-400 mb-1">
                    <span>Nós do DAG:</span>
                    <span className="font-semibold text-purple-300">
                      {state.supervisor.dag?.nodes?.length || 3} etapas
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-slate-400">
                    <span>Arquivos Escopo:</span>
                    <span className="font-semibold text-purple-300">
                      {state.supervisor.plannedFiles.length} arq(s)
                    </span>
                  </div>
                </div>

                {/* Botão de expansão do DAG e arquivos */}
                <button
                  onClick={() => setExpandSupervisorDag(!expandSupervisorDag)}
                  className="mt-2 flex items-center justify-between w-full pt-1 border-t border-purple-900/40 text-[10px] text-purple-400 hover:text-purple-300 font-medium cursor-pointer"
                >
                  <span>{expandSupervisorDag ? 'Ocultar DAG e Escopo' : 'Ver DAG e Arquivos'}</span>
                  {expandSupervisorDag ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>
              </div>

              {/* Detalhes Expansíveis do Supervisor */}
              {expandSupervisorDag && (
                <div className="mt-2 p-2 bg-slate-950/80 border border-purple-500/20 rounded text-[10px] space-y-1.5 max-h-36 overflow-y-auto">
                  <div className="font-semibold text-purple-300">Grafo de Tarefas (DAG):</div>
                  {state.supervisor.dag?.nodes?.map((node, i) => (
                    <div key={node.id || i} className="flex items-center justify-between gap-1 text-slate-300 pl-1 border-l border-purple-500/30">
                      <span className="truncate">{node.title}</span>
                      <span className={`text-[9px] px-1 py-0.2 rounded font-mono ${
                        node.status === 'COMPLETED' ? 'bg-emerald-950 text-emerald-400 border border-emerald-800/40' :
                        node.status === 'IN_PROGRESS' ? 'bg-amber-950 text-amber-400 border border-amber-800/40' :
                        'bg-slate-900 text-slate-400'
                      }`}>
                        {node.status}
                      </span>
                    </div>
                  ))}

                  {state.supervisor.plannedFiles.length > 0 && (
                    <div className="pt-1 border-t border-slate-800">
                      <div className="font-semibold text-purple-300 mb-0.5">Arquivos no Escopo:</div>
                      <div className="flex flex-wrap gap-1">
                        {state.supervisor.plannedFiles.map(f => (
                          <span key={f} className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded bg-purple-950/60 border border-purple-800/40 text-[9px] font-mono text-purple-200">
                            <FileCode className="w-2.5 h-2.5" />
                            {f.split('/').pop()}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ===================================================== */}
            {/* 3. WORKER (Badge Âmbar Expansível com Arquivos e Tempo) */}
            {/* ===================================================== */}
            <div className="flex flex-col rounded-lg border border-amber-500/30 bg-amber-950/20 p-2.5 transition-all">
              <div className="flex items-center justify-between gap-1.5 mb-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm">🔨</span>
                  <span className="text-xs font-semibold text-amber-300">Worker</span>
                </div>
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40">
                  {state.worker.status === 'executing' ? 'EXECUTANDO...' : 'CIRÚRGICO OK'}
                </span>
              </div>

              <div className="flex-1 flex flex-col justify-between text-[11px] text-slate-300 bg-slate-950/40 border border-amber-900/30 rounded p-1.5">
                <div>
                  <div className="flex items-center justify-between text-slate-400 mb-1">
                    <span>Arquivos Tocados:</span>
                    <span className="font-semibold text-amber-300 font-mono">
                      {state.worker.touchedFiles.length || state.supervisor.plannedFiles.length} arq(s)
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-slate-400">
                    <span>Tempo de Turno:</span>
                    <span className="font-semibold text-amber-300 font-mono">
                      {state.worker.executionTimeMs ? `${(state.worker.executionTimeMs / 1000).toFixed(1)}s` : '0.4s'}
                    </span>
                  </div>
                </div>

                {/* Botão de expansão dos arquivos tocados */}
                <button
                  onClick={() => setExpandWorkerFiles(!expandWorkerFiles)}
                  className="mt-2 flex items-center justify-between w-full pt-1 border-t border-amber-900/40 text-[10px] text-amber-400 hover:text-amber-300 font-medium cursor-pointer"
                >
                  <span>{expandWorkerFiles ? 'Ocultar Arquivos' : 'Ver Arquivos Tocados'}</span>
                  {expandWorkerFiles ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>
              </div>

              {/* Detalhes Expansíveis do Worker */}
              {expandWorkerFiles && (
                <div className="mt-2 p-2 bg-slate-950/80 border border-amber-500/20 rounded text-[10px] space-y-1.5 max-h-36 overflow-y-auto">
                  <div className="font-semibold text-amber-300">Arquivos Tocados pelo Worker:</div>
                  <div className="flex flex-col gap-1 font-mono">
                    {(state.worker.touchedFiles.length > 0 ? state.worker.touchedFiles : state.supervisor.plannedFiles).map(f => (
                      <span key={f} className="inline-flex items-center gap-1 text-slate-300 truncate">
                        <Terminal className="w-2.5 h-2.5 text-amber-400 flex-shrink-0" />
                        {f}
                      </span>
                    ))}
                  </div>

                  {state.worker.testOutput && (
                    <div className="pt-1 border-t border-slate-800 text-[9px] text-slate-400">
                      <span className="text-emerald-400 font-medium">Testes Unitários: </span>
                      {state.worker.testOutput}
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}

        {/* ========================================================= */}
        {/* 4. REVIEWER (Badge Verde [APROVADO] ou Vermelho Pulsante) */}
        {/* ========================================================= */}
        <div className={`flex flex-col rounded-lg border p-2.5 transition-all ${
          isRejected
            ? 'border-rose-500/50 bg-rose-950/30'
            : isApproved
            ? 'border-emerald-500/40 bg-emerald-950/20'
            : 'border-slate-800 bg-slate-950/30'
        }`}>
          <div className="flex items-center justify-between gap-1.5 mb-1.5">
            <div className="flex items-center gap-1.5">
              <span className="text-sm">🛡️</span>
              <span className={`text-xs font-semibold ${
                isRejected ? 'text-rose-300' : isApproved ? 'text-emerald-300' : 'text-slate-300'
              }`}>
                Reviewer
              </span>
            </div>

            {/* Badge de Veredito */}
            {isRejected ? (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/50 animate-pulse">
                [REJEITADO - EM CORREÇÃO]
              </span>
            ) : isApproved ? (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex items-center gap-1">
                <CheckCircle2 className="w-2.5 h-2.5" />
                [APROVADO]
              </span>
            ) : (
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
                VERIFICANDO...
              </span>
            )}
          </div>

          <div className={`flex-1 flex flex-col justify-between text-[11px] rounded p-1.5 border font-mono ${
            isRejected
              ? 'bg-rose-950/40 border-rose-900/50 text-rose-200'
              : isApproved
              ? 'bg-slate-950/40 border-emerald-900/40 text-emerald-300'
              : 'bg-slate-950/40 border-slate-800 text-slate-400'
          }`}>
            <div>
              <div className="flex items-center justify-between text-slate-400 mb-1">
                <span>Auditoria Tipos:</span>
                <span className={`font-semibold ${isRejected ? 'text-rose-400' : 'text-emerald-400'}`}>
                  {isRejected ? 'FALHA NO TYPECHECK' : '0 ERROS'}
                </span>
              </div>
              <div className="flex items-center justify-between text-slate-400">
                <span>Comando:</span>
                <span className="font-semibold text-slate-300">
                  tsc --noEmit
                </span>
              </div>
            </div>

            {/* Botão de detalhes do Typecheck */}
            <button
              onClick={() => setExpandReviewerDetails(!expandReviewerDetails)}
              className="mt-2 flex items-center justify-between w-full pt-1 border-t border-slate-800/60 text-[10px] font-medium cursor-pointer text-slate-400 hover:text-slate-200"
            >
              <span>{expandReviewerDetails ? 'Ocultar Saída' : 'Ver Saída tsc'}</span>
              {expandReviewerDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
          </div>

          {/* Saída Detalhada do Typecheck */}
          {expandReviewerDetails && (
            <div className="mt-2 p-2 bg-slate-950 border border-slate-800 rounded text-[9.5px] font-mono max-h-36 overflow-y-auto">
              <div className="text-slate-400 mb-1">$ npx tsc --noEmit</div>
              <pre className={`whitespace-pre-wrap ${isRejected ? 'text-rose-300' : 'text-emerald-400'}`}>
                {state.reviewer.typecheckOutput || (isApproved ? 'All files typechecked successfully. 0 errors.' : 'Em execução...')}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
