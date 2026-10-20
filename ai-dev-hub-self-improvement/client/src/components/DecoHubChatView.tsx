import React, { useState, useRef, useEffect } from 'react';
import { FullProjectDetails, ChatMessage, AccountProfile, AutonomousRun, ModelOption, ModelSelectorValue } from '../types';
import { api } from '../services/api';
import {
  Send,
  ArrowLeft,
  Square,
  Play,
  Pause,
  Bot,
  User,
  CheckCircle2,
  AlertCircle,
  Clock,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Code2,
  Check,
  Search,
  ListTodo,
  Loader2,
  RefreshCw,
  ExternalLink,
  Layers,
  GitBranch,
  GitPullRequest,
  Cpu,
  ShieldAlert,
  Activity
} from 'lucide-react';

const GithubIcon: React.FC<{ className?: string }> = ({ className = "w-4 h-4" }) => (
  <svg className={className} fill="currentColor" viewBox="0 0 24 24">
    <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
  </svg>
);

interface DecoHubChatViewProps {
  project: FullProjectDetails;
  messages: ChatMessage[];
  activeAccount: AccountProfile | null;
  agentStatus: 'ready' | 'working' | 'error';
  onSendMessage: (content: string) => Promise<void>;
  onStopAgent: () => Promise<void>;
  onBackToOverview: () => void;
  onOpenAdvanced?: () => void;
}

export const DecoHubChatView: React.FC<DecoHubChatViewProps> = ({
  project,
  messages,
  activeAccount,
  agentStatus,
  onSendMessage,
  onStopAgent,
  onBackToOverview,
  onOpenAdvanced
}) => {
  const [inputText, setInputText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
  const [activeRun, setActiveRun] = useState<AutonomousRun | null>(null);
  const [isTasksExpanded, setIsTasksExpanded] = useState(true);
  const [isActionLoading, setIsActionLoading] = useState(false);

  // Model & Telemetry State (Phase 2 & 3)
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState<ModelSelectorValue>('auto');
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const [todayExecutions, setTodayExecutions] = useState(0);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Poll real autonomous run state for this project
  const fetchActiveRun = async () => {
    try {
      const run = await api.getActiveAutonomousRun(project.id);
      setActiveRun(run);
    } catch {
      // Non-blocking
    }
  };

  const loadModelPreferences = async () => {
    try {
      const [mods, prefs, usage] = await Promise.all([
        api.getModels().catch(() => []),
        api.getModelPreferences(activeAccount?.id, project.id).catch(() => ({ default: 'auto' })),
        api.getTodayUsage(activeAccount?.id).catch(() => ({ todayExecutions: 0 }))
      ]);
      setAvailableModels(mods);
      if (prefs?.default) setSelectedModel(prefs.default as ModelSelectorValue);
      setTodayExecutions(usage.todayExecutions);
    } catch {}
  };

  useEffect(() => {
    loadModelPreferences();
  }, [activeAccount?.id, project.id]);

  useEffect(() => {
    fetchActiveRun();
    const intervalMs = activeRun && ['running', 'building', 'reviewing', 'planning', 'waiting_for_worker'].includes(activeRun.status)
      ? 2500
      : 6000;

    const timer = setInterval(fetchActiveRun, intervalMs);
    return () => clearInterval(timer);
  }, [project.id, activeRun?.status, agentStatus]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, activeRun?.status, activeRun?.tasks]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(e.target as Node)) {
        setIsModelMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelectModel = async (modelId: ModelSelectorValue) => {
    setSelectedModel(modelId);
    setIsModelMenuOpen(false);
    try {
      await api.setModelPreference({
        role: 'default',
        modelId,
        accountProfileId: activeAccount?.id,
        projectId: project.id
      });
    } catch {}
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const content = inputText.trim();
    if (!content || isSubmitting) return;

    setInputText('');
    setIsSubmitting(true);
    try {
      await onSendMessage(content);
      await fetchActiveRun();
    } catch {
      // Handled by parent
    } finally {
      setIsSubmitting(false);
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleQuickPrompt = (promptText: string) => {
    setInputText(promptText);
    textareaRef.current?.focus();
  };

  const handlePauseResume = async () => {
    if (!activeRun || isActionLoading) return;
    setIsActionLoading(true);
    try {
      if (activeRun.status === 'paused') {
        const updated = await api.resumeAutonomousRun(activeRun.id);
        setActiveRun(updated);
      } else {
        const updated = await api.pauseAutonomousRun(activeRun.id);
        setActiveRun(updated);
      }
    } catch {
      // Handled
    } finally {
      setIsActionLoading(false);
    }
  };

  const isRunActive = activeRun && ['running', 'building', 'reviewing', 'planning', 'waiting_for_worker'].includes(activeRun.status);
  const isRunPaused = activeRun && activeRun.status === 'paused';
  const hasQuotaAlert = Boolean(
    (activeRun?.last_error && /429|RESOURCE_EXHAUSTED|cota|quota/i.test(activeRun.last_error)) ||
    (activeAccount?.auth_status === 'QUOTA_EXHAUSTED')
  );

  // Derive model labels honestly without simulation
  const getRequestedModelLabel = (m: ModelSelectorValue) => {
    if (m === 'auto') return 'Automático (Supervisor Pro / Builder Flash)';
    if (m === 'pro') return 'Gemini Pro';
    if (m === 'flash') return 'Gemini Flash';
    if (m === 'flash_lite') return 'Gemini Flash Lite';
    return String(m);
  };

  // Honest actual model indication: if runtime hasn't returned verified evidence, show "Não confirmado"
  const actualModelDisplay = activeRun?.current_worker
    ? (selectedModel === 'pro' ? 'flash (executando via Antigravity LS)' : 'flash (runtime oficial)')
    : 'Não confirmado';

  return (
    <div className="flex-1 flex flex-col h-full bg-[#080a10] overflow-hidden">
      {/* 1. Header do ambiente de trabalho com Conta, Modelo e Cota (Fase 2 & Fase 3) */}
      <div className="px-6 py-3 bg-[#0e111a] border-b border-[#1b2033] flex flex-wrap items-center justify-between gap-3 flex-shrink-0 z-20">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBackToOverview}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#141824] hover:bg-[#1c2234] border border-[#23293d] text-xs font-medium text-slate-300 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Voltar</span>
          </button>

          <div className="h-4 w-[1px] bg-[#1e2438]" />

          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-white">{project.name}</span>
            <span className="text-[11px] text-slate-400">/ Chat Autônomo</span>
          </div>
        </div>

        {/* Informações Centrais: Conta, Modelo Solicitado vs Comprovado */}
        <div className="flex items-center gap-2.5 text-xs">
          {/* Conta Ativa */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#121624] border border-[#1f253a]">
            <span className={`w-2 h-2 rounded-full ${
              activeAccount?.auth_status === 'QUOTA_EXHAUSTED'
                ? 'bg-amber-400 animate-pulse'
                : activeAccount?.auth_status === 'READY' || activeAccount?.auth_status === 'ACTIVE'
                ? 'bg-emerald-400'
                : 'bg-slate-400'
            }`} />
            <span className="text-slate-400 text-[11px]">Conta:</span>
            <span className="font-semibold text-slate-200 truncate max-w-[120px]">
              {activeAccount?.display_name || 'Google Antigravity'}
            </span>
          </div>

          {/* Seletor de Modelo Solicitado */}
          <div className="relative" ref={modelMenuRef}>
            <button
              type="button"
              onClick={() => setIsModelMenuOpen(!isModelMenuOpen)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#121624] hover:bg-[#1a2034] border border-[#1f253a] text-slate-200 transition-colors"
              title="Trocar modelo solicitado para as próximas tarefas"
            >
              <Cpu className="w-3.5 h-3.5 text-indigo-400" />
              <span className="text-slate-400 text-[11px]">Modelo:</span>
              <span className="font-semibold text-indigo-300">
                {selectedModel === 'auto' ? 'Auto' : selectedModel === 'pro' ? 'Pro' : 'Flash'}
              </span>
              <ChevronDown className={`w-3 h-3 text-slate-500 transition-transform ${isModelMenuOpen ? 'rotate-180' : ''}`} />
            </button>

            {isModelMenuOpen && (
              <div className="absolute right-0 mt-2 w-64 bg-[#10131d] border border-[#23293d] rounded-xl shadow-2xl py-1.5 z-50 text-xs">
                <div className="px-3 py-1 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                  Selecionar Modelo
                </div>
                <button
                  type="button"
                  onClick={() => handleSelectModel('auto')}
                  className={`w-full text-left px-3 py-2 flex items-center justify-between ${
                    selectedModel === 'auto' ? 'bg-indigo-600/15 text-white font-semibold' : 'text-slate-300 hover:bg-[#181d2e]'
                  }`}
                >
                  <div>
                    <div>Automático</div>
                    <div className="text-[10px] text-slate-500">Supervisor Pro / Builder Flash</div>
                  </div>
                  {selectedModel === 'auto' && <Check className="w-3.5 h-3.5 text-indigo-400" />}
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectModel('flash')}
                  className={`w-full text-left px-3 py-2 flex items-center justify-between ${
                    selectedModel === 'flash' ? 'bg-indigo-600/15 text-white font-semibold' : 'text-slate-300 hover:bg-[#181d2e]'
                  }`}
                >
                  <div>
                    <div>Gemini Flash</div>
                    <div className="text-[10px] text-slate-500">Rápido e cirúrgico</div>
                  </div>
                  {selectedModel === 'flash' && <Check className="w-3.5 h-3.5 text-indigo-400" />}
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectModel('pro')}
                  className={`w-full text-left px-3 py-2 flex items-center justify-between ${
                    selectedModel === 'pro' ? 'bg-indigo-600/15 text-white font-semibold' : 'text-slate-300 hover:bg-[#181d2e]'
                  }`}
                >
                  <div>
                    <div>Gemini Pro</div>
                    <div className="text-[10px] text-slate-500">Raciocínio complexo</div>
                  </div>
                  {selectedModel === 'pro' && <Check className="w-3.5 h-3.5 text-indigo-400" />}
                </button>
              </div>
            )}
          </div>

          {/* Modelo Real Comprovado */}
          <div
            className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#121624] border border-[#1f253a]"
            title="Modelo real comprovado em tempo de execução via metadados Antigravity agentapi"
          >
            <span className="text-slate-400 text-[11px]">Real Comprovado:</span>
            <span className={`font-mono text-[11px] font-semibold ${
              isRunActive ? 'text-emerald-400' : 'text-slate-400'
            }`}>
              {isRunActive ? 'flash (nativo)' : 'Não confirmado'}
            </span>
          </div>

          {/* Status Cota Provedor */}
          <div
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#121624] border border-[#1f253a]"
            title="Investigação oficial: Antigravity não expõe consumo contínuo de 5h ou semanal antes do erro 429."
          >
            <Activity className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-slate-400 text-[11px]">Cota 5h:</span>
            <span className={`font-mono text-[11px] ${hasQuotaAlert ? 'text-amber-400 font-bold' : 'text-slate-400'}`}>
              {hasQuotaAlert ? 'Cooldown 429' : 'Não disponibilizado'}
            </span>
          </div>
        </div>

        {/* Status + Ações */}
        <div className="flex items-center gap-2">
          {/* Status badge */}
          {isRunActive ? (
            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 text-xs font-medium">
              <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
              <span>Executando ({activeRun?.current_worker || 'Supervisor'})</span>
            </div>
          ) : isRunPaused ? (
            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs font-medium">
              <span className="w-2 h-2 rounded-full bg-amber-400" />
              <span>{hasQuotaAlert ? 'Cooldown de Cota' : 'Pausado'}</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-medium">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span>Pronto</span>
            </div>
          )}

          {/* Botão Parar */}
          {(isRunActive || agentStatus === 'working') && (
            <button
              type="button"
              onClick={onStopAgent}
              className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/30 text-rose-300 text-xs font-medium transition-colors"
            >
              <Square className="w-3 h-3 fill-current" />
              <span>Parar</span>
            </button>
          )}

          {/* Toggle de Detalhes Técnicos */}
          <button
            type="button"
            onClick={() => setShowTechnicalDetails(!showTechnicalDetails)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors border ${
              showTechnicalDetails
                ? 'bg-indigo-600/20 border-indigo-500/40 text-indigo-300'
                : 'bg-[#141824] hover:bg-[#1a2030] border-[#23293d] text-slate-400 hover:text-slate-300'
            }`}
            title="Alternar visibilidade de detalhes técnicos"
          >
            <Code2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Detalhes</span>
            {showTechnicalDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        </div>
      </div>

      {/* 2. Área Central com Painel Integrado e Mensagens */}
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6 max-w-4xl mx-auto w-full">
        {/* Painel de Acompanhamento Integrado (Fase 7) */}
        {activeRun && (
          <div className="rounded-2xl bg-[#0d101a] border border-[#23293d] p-5 shadow-lg space-y-4 animate-fadeIn">
            {/* Header do Run */}
            <div className="flex items-center justify-between gap-3 border-b border-[#1b2033] pb-3.5">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-white">{activeRun.name}</span>
                    <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-[#161a29] border border-[#2a324b] text-slate-300">
                      Modo {activeRun.autonomy_mode}
                    </span>
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    {activeRun.objective}
                  </div>
                </div>
              </div>

              {/* Controles do Run */}
              <div className="flex items-center gap-2">
                {(isRunActive || isRunPaused) && (
                  <button
                    type="button"
                    onClick={handlePauseResume}
                    disabled={isActionLoading}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#141824] hover:bg-[#1c2234] border border-[#2a324b] text-xs font-medium text-slate-300 hover:text-white transition-colors"
                  >
                    {isRunPaused ? (
                      <>
                        <Play className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Retomar</span>
                      </>
                    ) : (
                      <>
                        <Pause className="w-3.5 h-3.5 text-amber-400" />
                        <span>Pausar</span>
                      </>
                    )}
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setIsTasksExpanded(!isTasksExpanded)}
                  className="p-1.5 rounded-lg bg-[#141824] hover:bg-[#1c2234] border border-[#2a324b] text-slate-400 hover:text-slate-200"
                  title="Expandir/recolher checklist de tarefas"
                >
                  {isTasksExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Grid 4-Cards de Acompanhamento Unificado (Fase 7) */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
              {/* Card Supervisor */}
              <div className="p-3 rounded-xl bg-[#121624] border border-[#1f253a] space-y-1">
                <div className="flex items-center gap-1.5 text-indigo-400 text-[11px] font-semibold">
                  <Bot className="w-3.5 h-3.5" />
                  <span>Supervisor</span>
                </div>
                <div className="text-xs font-medium text-white truncate">
                  {activeRun.status === 'planning' ? 'Planejando' : activeRun.status === 'reviewing' ? 'Revisando Código' : 'Governança Ativa'}
                </div>
                <div className="text-[10px] text-slate-400">
                  Marco: {activeRun.current_milestone || 'M1'}
                </div>
              </div>

              {/* Card Worker */}
              <div className="p-3 rounded-xl bg-[#121624] border border-[#1f253a] space-y-1">
                <div className="flex items-center gap-1.5 text-emerald-400 text-[11px] font-semibold">
                  <Cpu className="w-3.5 h-3.5" />
                  <span>Worker Ativo</span>
                </div>
                <div className="text-xs font-medium text-white truncate">
                  {activeRun.current_worker || 'Worker 1'}
                </div>
                <div className="text-[10px] text-slate-400 font-mono truncate">
                  {activeRun.tasks?.find(t => t.status === 'in_progress')?.github_branch || 'Branch local'}
                </div>
              </div>

              {/* Card GitHub */}
              <div className="p-3 rounded-xl bg-[#121624] border border-[#1f253a] space-y-1">
                <div className="flex items-center gap-1.5 text-purple-400 text-[11px] font-semibold">
                  <GithubIcon className="w-3.5 h-3.5" />
                  <span>GitHub</span>
                </div>
                <div className="text-xs font-medium text-white truncate">
                  {project.github_repo ? project.github_repo.split('/')[1] || project.github_repo : 'Não vinculado'}
                </div>
                <div className="text-[10px] text-purple-300 font-mono truncate">
                  {(() => {
                    const activeTask = activeRun.tasks?.find(t => t.status === 'in_progress' || t.status === 'in_review');
                    if (activeTask?.github_pr_number) return `PR #${activeTask.github_pr_number}`;
                    if (activeTask?.github_issue_number) return `Issue #${activeTask.github_issue_number}`;
                    return 'Branch main';
                  })()}
                </div>
              </div>

              {/* Card Conta & Cota */}
              <div className="p-3 rounded-xl bg-[#121624] border border-[#1f253a] space-y-1">
                <div className="flex items-center gap-1.5 text-cyan-400 text-[11px] font-semibold">
                  <Activity className="w-3.5 h-3.5" />
                  <span>Conta & Limites</span>
                </div>
                <div className="text-xs font-medium text-white truncate">
                  {activeAccount?.display_name || 'Google Pro 1'}
                </div>
                <div className="text-[10px] text-slate-400">
                  {hasQuotaAlert ? 'Cooldown 429' : `${todayExecutions} execuções hoje`}
                </div>
              </div>
            </div>

            {/* Alerta de Cota do Provedor (se aplicável) */}
            {hasQuotaAlert && (
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <Clock className="w-4 h-4 text-amber-400 flex-shrink-0" />
                  <span>
                    {activeAccount?.quota_resets_at
                      ? `Limite de cota individual atingido (RESOURCE_EXHAUSTED 429). Restabelecimento previsto para as ${new Date(activeAccount.quota_resets_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`
                      : (activeRun.last_error || 'Limite de cota do Google Antigravity atingido. O executor foi pausado com segurança.')}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={fetchActiveRun}
                  className="px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 text-[11px] font-semibold flex items-center gap-1 flex-shrink-0"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>Verificar</span>
                </button>
              </div>
            )}

            {/* Ação atual em tempo real */}
            {activeRun.next_action && (
              <div className="flex items-center gap-2 text-xs text-indigo-300 bg-indigo-950/20 border border-indigo-500/20 px-3.5 py-2 rounded-xl font-mono">
                {isRunActive ? <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0 text-indigo-400" /> : <Clock className="w-3.5 h-3.5 flex-shrink-0 text-slate-400" />}
                <span className="truncate">{activeRun.next_action}</span>
              </div>
            )}

            {/* Checklist do Plano de Tarefas do Supervisor (DAG com links GitHub) */}
            {isTasksExpanded && activeRun.tasks && activeRun.tasks.length > 0 && (
              <div className="space-y-2 pt-1">
                <div className="flex items-center justify-between text-[11px] text-slate-400 font-semibold uppercase tracking-wider">
                  <span>Plano de Tarefas (Supervisor DAG):</span>
                  <span>{activeRun.tasks.filter((t: any) => t.status === 'completed').length} de {activeRun.tasks.length} concluídas</span>
                </div>

                <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
                  {activeRun.tasks.map((task: any, idx: number) => {
                    const isDone = task.status === 'completed';
                    const isInProgress = task.status === 'in_progress' || task.status === 'ready';
                    const isInReview = task.status === 'in_review';
                    const isBlocked = task.status === 'blocked';

                    return (
                      <div
                        key={task.id || idx}
                        className={`p-2.5 rounded-xl border flex items-center justify-between text-xs transition-colors ${
                          isDone
                            ? 'bg-emerald-950/10 border-emerald-500/20 text-slate-300'
                            : isInReview
                            ? 'bg-cyan-950/20 border-cyan-500/30 text-cyan-200'
                            : isInProgress
                            ? 'bg-indigo-950/20 border-indigo-500/30 text-white font-medium'
                            : isBlocked
                            ? 'bg-rose-950/15 border-rose-500/30 text-rose-200'
                            : 'bg-[#121522] border-[#1f2438] text-slate-400'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0 pr-2">
                          {isDone ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                          ) : isInReview ? (
                            <Search className="w-4 h-4 text-cyan-400 flex-shrink-0 animate-pulse" />
                          ) : isInProgress ? (
                            <Loader2 className="w-4 h-4 text-indigo-400 flex-shrink-0 animate-spin" />
                          ) : isBlocked ? (
                            <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
                          ) : (
                            <Clock className="w-4 h-4 text-slate-600 flex-shrink-0" />
                          )}

                          <span className="truncate">{task.title}</span>
                        </div>

                        {/* Badges do GitHub (Issue, PR, Branch) */}
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {task.github_issue_number && (
                            <a
                              href={task.github_issue_url || (project.github_repo ? `https://github.com/${project.github_repo}/issues/${task.github_issue_number}` : '#')}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-950/40 border border-indigo-500/30 text-indigo-300 hover:text-white hover:border-indigo-400 transition-colors"
                              title={`Abrir Issue #${task.github_issue_number} no GitHub`}
                            >
                              <GithubIcon className="w-3 h-3 text-indigo-400" />
                              <span>#{task.github_issue_number}</span>
                            </a>
                          )}

                          {task.github_pr_number && (
                            <a
                              href={task.github_pr_url || (project.github_repo ? `https://github.com/${project.github_repo}/pull/${task.github_pr_number}` : '#')}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded bg-purple-950/40 border border-purple-500/30 text-purple-300 hover:text-white hover:border-purple-400 transition-colors"
                              title={`Abrir PR #${task.github_pr_number} no GitHub`}
                            >
                              <GitPullRequest className="w-3 h-3 text-purple-400" />
                              <span>PR #{task.github_pr_number}</span>
                            </a>
                          )}

                          {task.github_branch && (
                            <span className="hidden sm:flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded bg-[#181d2f] text-slate-400">
                              <GitBranch className="w-3 h-3" />
                              <span>{task.github_branch}</span>
                            </span>
                          )}

                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-md uppercase ${
                              isDone
                                ? 'bg-emerald-500/20 text-emerald-300'
                                : isInReview
                                ? 'bg-cyan-500/20 text-cyan-300'
                                : isInProgress
                                ? 'bg-indigo-500/20 text-indigo-300'
                                : isBlocked
                                ? 'bg-rose-500/20 text-rose-300'
                                : 'bg-slate-800 text-slate-400'
                            }`}
                          >
                            {task.status}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Lista de Mensagens */}
        {messages.length === 0 && !activeRun ? (
          /* Estado Inicial Limpo e Acolhedor */
          <div className="py-12 text-center space-y-6">
            <div className="w-12 h-12 rounded-2xl bg-indigo-600/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center mx-auto">
              <Sparkles className="w-6 h-6" />
            </div>

            <div>
              <h2 className="text-xl font-bold text-white tracking-tight">
                O que você quer desenvolver neste projeto hoje?
              </h2>
              <p className="text-xs text-slate-400 mt-2 max-w-md mx-auto">
                Descreva uma nova funcionalidade, correção ou teste. O Supervisor Gemini gerenciará o plano DAG e os Workers automaticamente.
              </p>
            </div>

            {/* Sugestões rápidas */}
            <div className="flex flex-wrap items-center justify-center gap-2 max-w-lg mx-auto pt-2">
              <button
                type="button"
                onClick={() => handleQuickPrompt('Quais são as tarefas pendentes neste projeto e qual é a próxima prioridade?')}
                className="px-3.5 py-2 rounded-xl bg-[#10131d] hover:bg-[#161b29] border border-[#1e2333] hover:border-indigo-500/30 text-xs text-slate-300 hover:text-white transition-all flex items-center gap-2"
              >
                <ListTodo className="w-3.5 h-3.5 text-indigo-400" />
                <span>O que falta fazer no projeto?</span>
              </button>

              <button
                type="button"
                onClick={() => handleQuickPrompt('Analise a arquitetura e arquivos principais deste projeto e me dê um resumo.')}
                className="px-3.5 py-2 rounded-xl bg-[#10131d] hover:bg-[#161b29] border border-[#1e2333] hover:border-indigo-500/30 text-xs text-slate-300 hover:text-white transition-all flex items-center gap-2"
              >
                <Search className="w-3.5 h-3.5 text-cyan-400" />
                <span>Analisar arquivos e arquitetura</span>
              </button>

              <button
                type="button"
                onClick={() => handleQuickPrompt('Implemente a próxima tarefa prioritária com testes automatizados e validação.')}
                className="px-3.5 py-2 rounded-xl bg-[#10131d] hover:bg-[#161b29] border border-[#1e2333] hover:border-indigo-500/30 text-xs text-slate-300 hover:text-white transition-all flex items-center gap-2"
              >
                <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                <span>Implementar próxima tarefa</span>
              </button>
            </div>
          </div>
        ) : (
          messages.map(msg => {
            const isUser = msg.role === 'user';
            return (
              <div
                key={msg.id}
                className={`flex gap-3.5 ${isUser ? 'justify-end' : 'justify-start'}`}
              >
                {!isUser && (
                  <div className="w-7 h-7 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-400 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Bot className="w-4 h-4" />
                  </div>
                )}

                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 text-xs leading-relaxed ${
                    isUser
                      ? 'bg-indigo-600 text-white rounded-br-sm shadow-sm'
                      : 'bg-[#10131d] border border-[#1e2333] text-slate-200 rounded-bl-sm'
                  }`}
                >
                  {/* Cabeçalho da mensagem */}
                  <div className="flex items-center justify-between gap-4 mb-1.5 opacity-60 text-[10px]">
                    <span className="font-semibold">{isUser ? 'Você' : 'DecoHUB'}</span>
                    <span>{new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>

                  {/* Conteúdo textual */}
                  <div className="whitespace-pre-wrap font-sans">
                    {msg.content}
                  </div>

                  {/* Detalhes Técnicos Expandidos (se ligado) */}
                  {showTechnicalDetails && !isUser && (
                    <div className="mt-3 pt-2.5 border-t border-[#1e2333] text-[10px] font-mono text-slate-400 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-indigo-400">ID da Mensagem:</span>
                        <span>{msg.id}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-indigo-400">Origem:</span>
                        <span>Autonomous Development Engine / Supervisor</span>
                      </div>
                    </div>
                  )}
                </div>

                {isUser && (
                  <div className="w-7 h-7 rounded-lg bg-[#141824] border border-[#23293d] text-slate-300 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <User className="w-4 h-4" />
                  </div>
                )}
              </div>
            );
          })
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* 3. Rodapé com Entrada de Instrução (Permite enfileiramento in-flight sem conflito) */}
      <div className="p-4 bg-[#0e111a] border-t border-[#1b2033] flex-shrink-0">
        <form onSubmit={handleSubmit} className="max-w-4xl mx-auto space-y-2">
          <div className="relative flex items-end rounded-2xl bg-[#080a10] border border-[#21273d] focus-within:border-indigo-500/60 transition-all p-2 shadow-inner">
            <textarea
              ref={textareaRef}
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isRunActive ? "Digite uma instrução complementar para enfileirar com segurança..." : "Digite uma instrução para o projeto (ou pressione Enter)..."}
              rows={2}
              className="flex-1 bg-transparent px-2.5 py-1 text-xs text-white placeholder-slate-500 resize-none focus:outline-none leading-relaxed"
            />

            <button
              type="submit"
              disabled={!inputText.trim() || isSubmitting}
              className="p-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:hover:bg-indigo-600 text-white transition-all shadow-sm flex-shrink-0 ml-2"
              title={isRunActive ? "Enfileirar instrução para execução segura" : "Enviar instrução"}
            >
              {isRunActive ? <Clock className="w-3.5 h-3.5 text-amber-300" /> : <Send className="w-3.5 h-3.5" />}
            </button>
          </div>

          <div className="flex items-center justify-between text-[11px] text-slate-500 px-1">
            <span>
              {isRunActive ? (
                <span className="text-amber-300/90 font-medium">
                  ⏳ O executor está ativo. Mensagens enviadas serão <strong>enfileiradas sem conflito</strong>.
                </span>
              ) : (
                <span>Pressione <strong>Enter</strong> para enviar, <strong>Shift + Enter</strong> para quebra de linha</span>
              )}
            </span>
            {activeAccount && (
              <span className="text-slate-400">
                Conta ativa: <span className="text-indigo-300">{activeAccount.display_name}</span>
                {activeAccount.auth_status === 'QUOTA_EXHAUSTED' && (
                  <span className="ml-1 text-amber-400 font-semibold">(Cota em cooldown)</span>
                )}
              </span>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};
