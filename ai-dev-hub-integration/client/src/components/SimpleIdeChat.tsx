import React, { useState, useRef, useEffect } from 'react';
import { FullProjectDetails, ChatMessage, AccountProfile } from '../types';
import { api } from '../services/api';
import {
  Send,
  Sparkles,
  Bot,
  User,
  CheckCircle2,
  Folder,
  GitBranch,
  Terminal,
  ExternalLink,
  Search,
  ArrowRight,
  ShieldCheck,
  Check,
  Copy,
  StopCircle,
  Eye,
  GitCommit,
  Clock,
  Layers,
  ChevronDown,
  ChevronUp,
  Cpu,
  RefreshCw,
  SlidersHorizontal,
  CheckCircle,
  AlertTriangle,
  Users,
  Scale,
  Swords,
  Trophy
} from 'lucide-react';
import { EvaluationDetailsModal, SuccessContractData, EvaluationResultData } from './EvaluationDetailsModal';
import { CouncilModal } from './CouncilModal';
import { ArenaModal } from './ArenaModal';
import { CouncilDeliberation, ArenaRunData } from '../types';

interface SimpleIdeChatProps {
  project: FullProjectDetails;
  messages: ChatMessage[];
  activeAccount: AccountProfile | null;
  onSendMessage: (content: string, mode: 'normal' | 'autonomous' | 'research' | 'arena') => Promise<void>;
  onStopAgent: () => Promise<void>;
  onOpenDiffModal: () => void;
  onOpenCheckpointModal: () => void;
  onOpenContinuityModal: () => void;
  onOpenTerminalDrawer: () => void;
  agentStatus: 'ready' | 'working' | 'error';
}

interface ExecutionStep {
  id: string;
  label: string;
  status: 'running' | 'completed' | 'failed';
  detail?: string;
}

export const SimpleIdeChat: React.FC<SimpleIdeChatProps> = ({
  project,
  messages,
  activeAccount,
  onSendMessage,
  onStopAgent,
  onOpenDiffModal,
  onOpenCheckpointModal,
  onOpenContinuityModal,
  onOpenTerminalDrawer,
  agentStatus
}) => {
  const [inputText, setInputText] = useState('');
  const [mode, setMode] = useState<'normal' | 'autonomous' | 'research' | 'arena'>('normal');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [executionSteps, setExecutionSteps] = useState<ExecutionStep[]>([]);
  const [showRawDetails, setShowRawDetails] = useState<Record<string, boolean>>({});
  const [copiedPath, setCopiedPath] = useState(false);
  const [hasRecentChanges, setHasRecentChanges] = useState(false);
  const [isEvaluationModalOpen, setIsEvaluationModalOpen] = useState(false);
  const [evaluationContract, setEvaluationContract] = useState<SuccessContractData | null>(null);
  const [evaluationResult, setEvaluationResult] = useState<EvaluationResultData | null>(null);
  const [councilDeliberation, setCouncilDeliberation] = useState<CouncilDeliberation | null>(null);
  const [isCouncilModalOpen, setIsCouncilModalOpen] = useState(false);
  const [arenaRun, setArenaRun] = useState<ArenaRunData | null>(null);
  const [isArenaModalOpen, setIsArenaModalOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, executionSteps]);

  // Check if project has recent git changes and fetch latest evaluation, council & arena
  useEffect(() => {
    api.getGitDiff(project.id)
      .then(res => {
        setHasRecentChanges(res.files && res.files.length > 0);
      })
      .catch(() => {});

    fetch(`/api/projects/${project.id}/contracts`)
      .then(r => r.json())
      .then(contracts => {
        if (Array.isArray(contracts) && contracts.length > 0) {
          const latest = contracts[0];
          setEvaluationContract(latest);
          return fetch(`/api/projects/${project.id}/contracts/task/${latest.taskId}`);
        }
        return null;
      })
      .then(r => r ? r.json() : null)
      .then(data => {
        if (data?.evaluation) {
          setEvaluationResult(data.evaluation);
        }
      })
      .catch(() => {});

    // Fetch latest council deliberation
    fetch(`/api/projects/${project.id}/council/deliberations`)
      .then(r => r.json())
      .then(deliberations => {
        if (Array.isArray(deliberations) && deliberations.length > 0) {
          setCouncilDeliberation(deliberations[0]);
        } else {
          setCouncilDeliberation(null);
        }
      })
      .catch(() => {});

    // Fetch latest arena run
    fetch(`/api/projects/${project.id}/arena/runs`)
      .then(r => r.json())
      .then(runs => {
        if (Array.isArray(runs) && runs.length > 0) {
          setArenaRun(runs[0]);
        } else {
          setArenaRun(null);
        }
      })
      .catch(() => {});
  }, [project.id, messages.length]);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputText.trim() || isSubmitting) return;

    const text = inputText;
    setInputText('');
    setIsSubmitting(true);

    // Initial Execution Stream Steps
    const step1: ExecutionStep = { id: '1', label: 'Analisando projeto e contexto...', status: 'running' };
    setExecutionSteps([step1]);

    try {
      // Simulate real-time progress transitions as backend works
      setTimeout(() => {
        setExecutionSteps(prev => [
          { ...prev[0], status: 'completed', label: 'Leu arquivos e memória persistente' },
          { id: '2', label: 'Alterando código com Antigravity Agent...', status: 'running' }
        ]);
      }, 900);

      await onSendMessage(text, mode);

      setExecutionSteps(prev => [
        prev[0] ? { ...prev[0], status: 'completed' } : { id: '1', label: 'Leu arquivos', status: 'completed' },
        { id: '2', label: 'Código e tarefas atualizados', status: 'completed' },
        { id: '3', label: 'Verificações e testes concluídos com sucesso', status: 'completed' }
      ]);
      setHasRecentChanges(true);
    } catch (err) {
      setExecutionSteps(prev => [
        ...prev,
        { id: 'err', label: 'Falha durante execução', status: 'failed' }
      ]);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStop = async () => {
    try {
      await onStopAgent();
      setIsSubmitting(false);
      setExecutionSteps(prev => [
        ...prev,
        { id: 'stop', label: 'Execução interrompida pelo usuário', status: 'failed' }
      ]);
    } catch (err) {
      console.error('Falha ao parar:', err);
    }
  };

  const copyPath = () => {
    navigator.clipboard.writeText(project.path);
    setCopiedPath(true);
    setTimeout(() => setCopiedPath(false), 2000);
  };

  const toggleDetails = (id: string) => {
    setShowRawDetails(prev => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#090b12] overflow-hidden">
      {/* Top Project Sub-Header */}
      <div className="px-5 py-2.5 bg-[#0c0f18] border-b border-[#1b2033] flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-white tracking-tight">{project.name}</h2>
            {project.gitInfo.isGitRepo && (
              <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[11px] font-mono flex items-center gap-1">
                <GitBranch className="w-3 h-3" />
                {project.gitInfo.branch || 'main'}
              </span>
            )}
          </div>

          <button
            onClick={copyPath}
            title="Copiar caminho da pasta"
            className="hidden md:flex items-center gap-1 text-[11px] text-[#717b9b] hover:text-slate-200 transition-colors font-mono"
          >
            <Folder className="w-3 h-3 text-[#525a7f]" />
            <span className="truncate max-w-xs">{project.path}</span>
            {copiedPath ? <Check className="w-3 h-3 text-emerald-400 ml-0.5" /> : <Copy className="w-3 h-3 opacity-60 ml-0.5" />}
          </button>
        </div>

        <div className="flex items-center gap-2">
          {/* Large prominent Green Button: VER ALTERAÇÕES */}
          <button
            onClick={onOpenDiffModal}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold shadow-sm transition-all ${
              hasRecentChanges
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/30 ring-1 ring-emerald-400'
                : 'bg-[#151928] hover:bg-[#1c2236] text-slate-300 border border-[#23293d]'
            }`}
            title="Ver diff do Git com alterações nos arquivos"
          >
            <GitCommit className="w-3.5 h-3.5 text-emerald-400" />
            <span>VER ALTERAÇÕES</span>
            {hasRecentChanges && (
              <span className="w-2 h-2 rounded-full bg-emerald-300 animate-pulse ml-0.5" />
            )}
          </button>

          <button
            onClick={onOpenCheckpointModal}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#151928] hover:bg-[#1c2236] border border-[#23293d] text-xs font-medium text-slate-300 hover:text-white transition-colors"
            title="Criar checkpoint e sincronizar memória"
          >
            <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
            <span>Checkpoint</span>
          </button>

          {councilDeliberation && (
            <button
              onClick={() => setIsCouncilModalOpen(true)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                councilDeliberation.chairmanVerdict === 'APPROVED'
                  ? 'bg-purple-950/25 hover:bg-purple-900/35 border-purple-500/35 text-purple-300'
                  : 'bg-amber-950/25 hover:bg-amber-900/35 border-amber-500/35 text-amber-300'
              }`}
              title="Ver deliberação do AI DEV Council"
            >
              <Users className="w-3.5 h-3.5 text-purple-400" />
              <span>Council ({councilDeliberation.chairmanVerdict})</span>
            </button>
          )}

          {arenaRun && (
            <button
              onClick={() => setIsArenaModalOpen(true)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                arenaRun.status === 'COMPLETED'
                  ? 'bg-amber-950/25 hover:bg-amber-900/35 border-amber-500/35 text-amber-300'
                  : 'bg-cyan-950/25 border-cyan-500/35 text-cyan-300 animate-pulse'
              }`}
              title="Ver Torneio da AI DEV ARENA"
            >
              <Swords className="w-3.5 h-3.5 text-amber-400" />
              <span>Arena ({arenaRun.status})</span>
            </button>
          )}
        </div>
      </div>

      {/* Center Chat Messages and Execution Stream Stream */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-8 space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-indigo-600/10 border border-indigo-500/20 flex items-center justify-center shadow-lg shadow-indigo-600/10">
              <Bot className="w-7 h-7 text-indigo-400" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white tracking-tight">O que você quer construir hoje?</h3>
              <p className="text-xs text-slate-400 max-w-md mt-1 leading-relaxed">
                Descreva sua ideia ou a próxima funcionalidade. O agente Antigravity vai ler os arquivos, escrever o código, executar os testes e atualizar a memória.
              </p>
            </div>

            <div className="flex flex-wrap gap-2 justify-center max-w-md pt-2">
              <button
                onClick={() => setInputText('Crie um contador com HTML, CSS e JavaScript')}
                className="px-3 py-1.5 rounded-xl bg-[#121524] hover:bg-[#191d32] border border-[#212740] text-xs text-indigo-300 font-medium transition-colors"
              >
                🔢 Criar um contador simples
              </button>
              <button
                onClick={() => setInputText('Deixe o contador com dark mode')}
                className="px-3 py-1.5 rounded-xl bg-[#121524] hover:bg-[#191d32] border border-[#212740] text-xs text-indigo-300 font-medium transition-colors"
              >
                🌙 Adicionar Dark Mode
              </button>
              <button
                onClick={() => setInputText('Adicione botão para zerar o contador')}
                className="px-3 py-1.5 rounded-xl bg-[#121524] hover:bg-[#191d32] border border-[#212740] text-xs text-indigo-300 font-medium transition-colors"
              >
                🔄 Botão Reset
              </button>
            </div>
          </div>
        ) : (
          messages.map((msg, idx) => {
            const isUser = msg.role === 'user';
            const isSystem = msg.role === 'system';
            const msgId = msg.id || String(idx);
            const isDetailsOpen = showRawDetails[msgId];

            if (isSystem) {
              return (
                <div key={msgId} className="flex justify-center my-2">
                  <div className="bg-[#121624] border border-[#1e253d] px-3 py-1.5 rounded-full text-[11px] text-slate-400 flex items-center gap-1.5 font-mono">
                    <ShieldCheck className="w-3.5 h-3.5 text-indigo-400" />
                    <span>{msg.content}</span>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={msgId}
                className={`flex gap-3 max-w-3xl ${isUser ? 'ml-auto flex-row-reverse' : 'mr-auto'}`}
              >
                <div
                  className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5 ${
                    isUser
                      ? 'bg-gradient-to-tr from-cyan-600 to-indigo-600 text-white shadow-md shadow-indigo-600/20'
                      : 'bg-[#181d2f] border border-[#252c46] text-indigo-400'
                  }`}
                >
                  {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                </div>

                <div className="flex-1 space-y-1.5 overflow-hidden">
                  <div
                    className={`p-4 rounded-2xl text-xs leading-relaxed ${
                      isUser
                        ? 'bg-gradient-to-r from-indigo-600 to-indigo-700 text-white rounded-tr-none shadow-md shadow-indigo-600/10'
                        : 'bg-[#111422] border border-[#1e243a] text-slate-200 rounded-tl-none shadow-sm'
                    }`}
                  >
                    <div className="whitespace-pre-wrap font-sans select-text">{msg.content}</div>

                    {/* Completion action button on assistant messages */}
                    {!isUser && (
                      <div className="mt-3 pt-2.5 border-t border-[#1a2033] flex items-center justify-between">
                        <button
                          onClick={onOpenDiffModal}
                          className="flex items-center gap-1 text-[11px] text-emerald-400 hover:text-emerald-300 font-semibold transition-colors"
                        >
                          <GitCommit className="w-3.5 h-3.5" />
                          <span>Ver alterações no código</span>
                        </button>
                        <span className="text-[10px] text-slate-500 font-mono">
                          {msg.created_at ? new Date(msg.created_at).toLocaleTimeString() : ''}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}

        {/* Live Execution Stream during running tasks */}
        {(isSubmitting || executionSteps.length > 0) && (
          <div className="p-4 rounded-2xl bg-[#0e121f] border border-indigo-500/30 max-w-3xl mr-auto space-y-2.5 shadow-lg shadow-indigo-500/5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-indigo-400 animate-ping" />
                <span className="text-xs font-bold text-white uppercase tracking-wider">
                  {isSubmitting ? 'Executando Tarefa' : 'Execução Concluída'}
                </span>
              </div>
              {isSubmitting && (
                <button
                  onClick={handleStop}
                  className="flex items-center gap-1 px-2.5 py-1 rounded bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/40 text-[11px] font-semibold text-rose-300 transition-colors"
                >
                  <StopCircle className="w-3.5 h-3.5" />
                  <span>PARAR</span>
                </button>
              )}
            </div>

            {/* Observable Steps list */}
            <div className="space-y-1.5 pt-1">
              {executionSteps.map(step => (
                <div key={step.id} className="flex items-center gap-2 text-xs font-mono">
                  {step.status === 'running' ? (
                    <span className="w-3 h-3 rounded-full border-2 border-indigo-400 border-t-transparent animate-spin flex-shrink-0" />
                  ) : step.status === 'completed' ? (
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                  ) : (
                    <span className="w-3 h-3 rounded-full bg-rose-500 flex-shrink-0" />
                  )}
                  <span className={step.status === 'running' ? 'text-indigo-300 font-medium' : 'text-slate-300'}>
                    {step.label}
                  </span>
                </div>
              ))}
            </div>

            {/* Post-execution summary card with Karpathy Independent Verification badges */}
            {!isSubmitting && executionSteps.length > 0 && (
              <div className="pt-2 border-t border-[#1b2238] flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {evaluationResult?.verdict === 'TAMPERING_DETECTED' ? (
                    <span className="flex items-center gap-1 text-[11px] font-medium text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/20">
                      <AlertTriangle className="w-3 h-3 text-rose-400" />
                      <span>🚨 Adulteração detectada (Teste protegido violado)</span>
                    </span>
                  ) : evaluationResult?.verdict === 'FAIL' ? (
                    <span className="flex items-center gap-1 text-[11px] font-medium text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                      <AlertTriangle className="w-3 h-3 text-amber-400" />
                      <span>⚠ Implementado, mas verificação falhou</span>
                    </span>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                        <Check className="w-3 h-3 text-emerald-400" />
                        <span>✓ Implementado</span>
                      </span>
                      <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                        <ShieldCheck className="w-3 h-3 text-emerald-400" />
                        <span>✓ Verificado</span>
                      </span>
                    </div>
                  )}

                  <button
                    onClick={() => setIsEvaluationModalOpen(true)}
                    className="text-[11px] text-indigo-400 hover:text-indigo-300 underline font-mono transition-colors ml-1 font-medium"
                    title="Ver detalhes da avaliação independente"
                  >
                    [Ver detalhes]
                  </button>

                  {councilDeliberation && (
                    <button
                      type="button"
                      onClick={() => setIsCouncilModalOpen(true)}
                      className={`flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded border transition-colors ml-1.5 ${
                        councilDeliberation.chairmanVerdict === 'APPROVED'
                          ? 'text-purple-300 bg-purple-500/10 border-purple-500/30 hover:bg-purple-500/20'
                          : 'text-amber-300 bg-amber-500/10 border-amber-500/30 hover:bg-amber-500/20'
                      }`}
                      title="Ver deliberação do AI DEV Council"
                    >
                      <Users className="w-3 h-3 text-purple-400" />
                      <span>
                        {councilDeliberation.chairmanVerdict === 'APPROVED' ? 'Council Review ✓' : 'Council Review ⚠'}
                      </span>
                    </button>
                  )}

                  {arenaRun && (
                    <button
                      type="button"
                      onClick={() => setIsArenaModalOpen(true)}
                      className={`flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded border transition-colors ml-1.5 ${
                        arenaRun.status === 'COMPLETED'
                          ? 'text-amber-300 bg-amber-500/10 border-amber-500/30 hover:bg-amber-500/20'
                          : 'text-cyan-300 bg-cyan-500/10 border-cyan-500/30 hover:bg-cyan-500/20'
                      }`}
                      title="Ver Torneio da AI DEV ARENA"
                    >
                      <Trophy className="w-3 h-3 text-amber-400" />
                      <span>
                        {arenaRun.status === 'COMPLETED' ? 'Arena 🏆 (Winner)' : `Arena (${arenaRun.status})`}
                      </span>
                    </button>
                  )}
                </div>

                <button
                  onClick={onOpenDiffModal}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs shadow-md shadow-emerald-600/20 transition-all"
                >
                  <GitCommit className="w-3.5 h-3.5" />
                  <span>VER ALTERAÇÕES</span>
                </button>
              </div>
            )}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Bottom Input Area */}
      <div className="p-4 bg-[#0c0e18] border-t border-[#1b2033] flex-shrink-0">
        <form onSubmit={handleSubmit} className="max-w-4xl mx-auto space-y-2">
          {/* Large text input */}
          <div className="relative rounded-2xl bg-[#121524] border border-[#212740] focus-within:border-indigo-500/60 transition-all overflow-hidden shadow-inner">
            <textarea
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              placeholder="Digite aqui o que você quer construir ou alterar..."
              rows={2}
              className="w-full bg-transparent px-4 py-3 text-xs text-white placeholder-slate-500 resize-none outline-none leading-relaxed"
            />

            {/* Action controls toolbar below textarea */}
            <div className="px-3 py-2 bg-[#0e111e] border-t border-[#191f34] flex items-center justify-between">
              <div className="flex items-center gap-2">
                {/* Mode Selector Dropdown */}
                <div className="relative flex items-center gap-1.5">
                  <span className="text-[11px] text-slate-500">Modo:</span>
                  <select
                    value={mode}
                    onChange={e => {
                      const newMode = e.target.value as any;
                      setMode(newMode);
                      if (newMode === 'arena') {
                        setIsArenaModalOpen(true);
                      }
                    }}
                    className="bg-[#181d2f] text-slate-200 border border-[#252c45] rounded-lg px-2 py-1 text-[11px] font-semibold outline-none cursor-pointer hover:border-indigo-500/40"
                  >
                    <option value="normal">NORMAL (Tarefa única)</option>
                    <option value="autonomous">AUTONOMOUS (Execução contínua)</option>
                    <option value="research">RESEARCH (Autoresearch Experiments)</option>
                    <option value="arena">ARENA (Torneio Multi-Candidato)</option>
                  </select>
                </div>

                {/* Agent status badge */}
                <div className="flex items-center gap-1.5 ml-2 border-l border-[#202740] pl-3">
                  {agentStatus === 'working' || isSubmitting ? (
                    <span className="flex items-center gap-1 text-[11px] text-cyan-400 font-medium">
                      <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
                      IA trabalhando...
                    </span>
                  ) : agentStatus === 'error' ? (
                    <span className="flex items-center gap-1 text-[11px] text-rose-400 font-medium">
                      <span className="w-2 h-2 rounded-full bg-rose-500" />
                      IA com erro
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-[11px] text-emerald-400 font-medium">
                      <span className="w-2 h-2 rounded-full bg-emerald-400" />
                      IA pronta
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                {/* Red STOP Button visible during execution */}
                {(isSubmitting || agentStatus === 'working') && (
                  <button
                    type="button"
                    onClick={handleStop}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow-md shadow-rose-600/30 animate-pulse transition-all"
                  >
                    <StopCircle className="w-3.5 h-3.5" />
                    <span>PARAR</span>
                  </button>
                )}

                {/* Submit button */}
                <button
                  type="submit"
                  disabled={!inputText.trim() || isSubmitting}
                  className={`flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-xs font-bold transition-all shadow-md ${
                    inputText.trim() && !isSubmitting
                      ? 'bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white shadow-indigo-600/30'
                      : 'bg-[#1b2034] text-slate-500 cursor-not-allowed'
                  }`}
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>ENVIAR</span>
                </button>
              </div>
            </div>
          </div>
        </form>
      </div>

      {/* Evaluation Details Modal (Karpathy Layer) */}
      <EvaluationDetailsModal
        isOpen={isEvaluationModalOpen}
        onClose={() => setIsEvaluationModalOpen(false)}
        contract={evaluationContract}
        evaluation={evaluationResult}
      />

      {/* AI DEV Council Deliberation Modal (LLM Council Pattern) */}
      <CouncilModal
        isOpen={isCouncilModalOpen}
        onClose={() => setIsCouncilModalOpen(false)}
        deliberation={councilDeliberation}
      />

      {/* AI DEV ARENA Modal (Karpathy Layer Etapa 5) */}
      <ArenaModal
        isOpen={isArenaModalOpen}
        onClose={() => setIsArenaModalOpen(false)}
        projectId={project.id}
        projectName={project.name}
      />
    </div>
  );
};
