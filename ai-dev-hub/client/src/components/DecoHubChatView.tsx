import React, { useState, useRef, useEffect } from 'react';
import {
  FullProjectDetails,
  ChatMessage,
  AccountProfile,
  AutonomousRun,
  HomologationEvidenceData
} from '../types';
import { api } from '../services/api';
import { createProjectSseClient } from '../services/sseClient';
import { DecoHubCurrentActivityWidget } from './DecoHubCurrentActivityWidget';
import { resolveRunProgressPct } from '../services/progressUtils';
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
  ChevronRight,
  ListTodo,
  Loader2,
  RefreshCw,
  ExternalLink,
  Shield,
  Zap,
  RotateCw,
  Sliders,
  Check,
  Image as ImageIcon,
  Maximize2,
  X,
  Terminal
} from 'lucide-react';
import { SlashCommandMenu } from './SlashCommandMenu';
import { SlashCommandItem } from '../types';

interface DecoHubChatViewProps {
  project: FullProjectDetails;
  messages: ChatMessage[];
  activeAccount: AccountProfile | null;
  agentStatus: 'ready' | 'working' | 'error';
  onSendMessage: (content: string, requestId?: string, options?: { signal?: AbortSignal }) => Promise<void>;
  onStopAgent: () => Promise<void>;
  onBackToOverview: () => void;
  onOpenAdvanced?: () => void;
  onRefreshMessages?: () => Promise<void>;
}

import { ImageCarouselLightbox, LightboxImageItem } from './ImageCarouselLightbox';

export const DecoHubChatView: React.FC<DecoHubChatViewProps> = ({
  project,
  messages,
  activeAccount,
  agentStatus,
  onSendMessage,
  onStopAgent,
  onBackToOverview,
  onOpenAdvanced,
  onRefreshMessages
}) => {
  const [inputText, setInputText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCommandMenuOpen, setIsCommandMenuOpen] = useState(false);
  const [commandFilter, setCommandFilter] = useState('');
  const submissionRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const pendingRequestRef = useRef<{ projectId: string; content: string; id: string } | null>(null);
  const currentProjectRef = useRef(project.id);
  currentProjectRef.current = project.id;

  const [activeRun, setActiveRun] = useState<AutonomousRun | null>(null);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [carouselLightbox, setCarouselLightbox] = useState<{
    isOpen: boolean;
    images: LightboxImageItem[];
    initialIndex: number;
  }>({
    isOpen: false,
    images: [],
    initialIndex: 0
  });
  const [isStartingPreview, setIsStartingPreview] = useState(false);
  const [homologationEvidence, setHomologationEvidence] = useState<HomologationEvidenceData | null>(null);

  const fetchEvidence = async () => {
    try {
      const ev = await api.getHomologationEvidence(project.id);
      if (currentProjectRef.current !== project.id) return;
      setHomologationEvidence(ev);
    } catch {
      // Non-blocking
    }
  };

  useEffect(() => {
    setHomologationEvidence(null);
    setActiveRun(null);
    fetchEvidence();
  }, [project.id, activeRun?.status]);

  const handleOpenLiveApp = async () => {
    setIsStartingPreview(true);
    try {
      const st = await api.startPreview(project.id);
      if (st.running && st.url) {
        window.open(st.url, '_blank');
      }
    } catch (err: any) {
      console.error('Falha ao abrir preview ao vivo:', err);
    } finally {
      setIsStartingPreview(false);
    }
  };

  // Smart scroll refs
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    pendingRequestRef.current = null;
    setInputText('');
    try {
      const saved = JSON.parse(localStorage.getItem('decohub.pendingSubmission:' + project.id) || 'null');
      if (saved && typeof saved.content === 'string' && typeof saved.id === 'string') {
        pendingRequestRef.current = { ...saved, projectId: project.id };
        setInputText(saved.content);
      }
    } catch {}
  }, [project.id]);

  const fetchActiveRun = async () => {
    try {
      const run = await api.getActiveAutonomousRun(project.id);
      if (currentProjectRef.current !== project.id) return;
      setActiveRun(run);
    } catch {
      // Non-blocking
    }
  };

  useEffect(() => {
    fetchActiveRun();

    const sseClient = createProjectSseClient(project.id);

    sseClient.on('message', async (data) => {
      if (currentProjectRef.current !== project.id) return;
      if (onRefreshMessages) {
        await onRefreshMessages();
      }
      if (data.autonomousRun) {
        setActiveRun(data.autonomousRun);
      }
      setIsSubmitting(false);
    });

    sseClient.on('activity', (data) => {
      if (currentProjectRef.current !== project.id) return;
      if (data.run) {
        setActiveRun(data.run);
      } else if (data.status) {
        setActiveRun(prev => prev ? { ...prev, status: data.status, next_action: data.message || prev.next_action } : prev);
      }
    });

    sseClient.on('tool_call', () => {
      if (currentProjectRef.current !== project.id) return;
      fetchEvidence();
    });

    sseClient.on('done', async () => {
      if (currentProjectRef.current !== project.id) return;
      setIsSubmitting(false);
      await fetchActiveRun();
      if (onRefreshMessages) {
        await onRefreshMessages();
      }
    });

    sseClient.on('error', () => {
      if (currentProjectRef.current !== project.id) return;
      setIsSubmitting(false);
    });

    return () => {
      sseClient.close();
    };
  }, [project.id]);

  // Handle scroll detection for smart scrolling
  const handleScroll = () => {
    if (!scrollContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    isNearBottomRef.current = distanceFromBottom < 120;
  };

  // Only scroll down when user is close to bottom
  useEffect(() => {
    if (isNearBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, agentStatus, isSubmitting]);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const content = inputText.trim();
    if (!content || submissionRef.current) return;
    submissionRef.current = true;
    if (pendingRequestRef.current?.content !== content || pendingRequestRef.current.projectId !== project.id) {
      pendingRequestRef.current = { projectId: project.id, content, id: crypto.randomUUID() };
    }
    const request = pendingRequestRef.current;
    try {
      localStorage.setItem('decohub.pendingSubmission:' + project.id, JSON.stringify({ content, id: request.id }));
    } catch {}

    setInputText('');
    setIsSubmitting(true);
    // User sent a message, ensure we will scroll to see the response
    isNearBottomRef.current = true;

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      await onSendMessage(content, request.id, { signal: controller.signal });
      try {
        localStorage.removeItem('decohub.pendingSubmission:' + request.projectId);
      } catch {}
      if (pendingRequestRef.current?.id === request.id) pendingRequestRef.current = null;
      await fetchActiveRun();
    } catch (submitErr: any) {
      if (submitErr?.name === 'AbortError' || submitErr?.message?.includes('aborted')) {
        if (currentProjectRef.current === request.projectId) setInputText(current => current || content);
        return;
      }
      if (submitErr?.isAlreadyRegistered) {
        try {
          localStorage.removeItem('decohub.pendingSubmission:' + request.projectId);
        } catch {}
        if (pendingRequestRef.current?.id === request.id) pendingRequestRef.current = null;
        await fetchActiveRun();
      } else {
        if (currentProjectRef.current === request.projectId) setInputText(current => current || content);
      }
    } finally {
      setIsSubmitting(false);
      submissionRef.current = false;
      abortControllerRef.current = null;
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  };

  const handleCancelInFlight = async () => {
    // 1. Abort controller immediately
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    const savedPrompt = pendingRequestRef.current?.content || inputText;
    const reqProjectId = pendingRequestRef.current?.projectId || project.id;
    try {
      localStorage.removeItem('decohub.pendingSubmission:' + reqProjectId);
    } catch {}
    pendingRequestRef.current = null;

    // 2. 0ms Immediate UI unlock: restore prompt and set submitting false before any await
    setIsSubmitting(false);
    submissionRef.current = false;
    if (savedPrompt) {
      setInputText(savedPrompt);
    }
    setTimeout(() => textareaRef.current?.focus(), 50);

    // 3. Notify backend and stop agent asynchronously in background
    try {
      const cancelPromise = api.cancelProjectMessage(project.id);
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 3000));
      await Promise.race([cancelPromise, timeoutPromise]);
    } catch (err) {
      console.warn('Erro ou timeout ao cancelar mensagem no servidor:', err);
    }

    if (onStopAgent) {
      try {
        await onStopAgent();
      } catch {}
    }

    try {
      await onRefreshMessages?.();
      await fetchActiveRun();
    } catch {}
  };

  const handleCancelQueuedMessage = async (messageId: string) => {
    try {
      await api.cancelProjectMessage(project.id, messageId);
      await onRefreshMessages?.();
      await fetchActiveRun();
    } catch (err: any) {
      alert(`Falha ao cancelar envio: ${err.message}`);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInputText(val);

    if (val.startsWith('/') && !val.includes(' ')) {
      setIsCommandMenuOpen(true);
      setCommandFilter(val.slice(1));
    } else if (!val.startsWith('/')) {
      setIsCommandMenuOpen(false);
      setCommandFilter('');
    }
  };

  const handleSelectSlashCommand = (cmd: SlashCommandItem) => {
    setInputText(`${cmd.command} `);
    setIsCommandMenuOpen(false);
    setCommandFilter('');
    setTimeout(() => {
      textareaRef.current?.focus();
    }, 50);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (isCommandMenuOpen && (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Tab')) {
      e.preventDefault();
      return;
    }
    if (isCommandMenuOpen && e.key === 'Enter' && !e.shiftKey) {
      // Deixa o listener do SlashCommandMenu cuidar
      return;
    }
    if (isCommandMenuOpen && e.key === 'Escape') {
      setIsCommandMenuOpen(false);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handlePauseResume = async () => {
    if (!activeRun || isActionLoading) return;
    setIsActionLoading(true);
    try {
      const updated = await api.resumeAutonomousRun(activeRun.id);
      setActiveRun(updated);
      await fetchActiveRun();
    } catch (err: any) {
      alert(`Falha na execução: ${err.message}`);
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleResolveApproval = async (decision: 'approved' | 'rejected') => {
    if (!activeRun || isActionLoading) return;
    setIsActionLoading(true);
    try {
      // Find pending approval or send resume
      const updated = await api.resumeAutonomousRun(activeRun.id);
      setActiveRun(updated);
    } catch (err: any) {
      alert(`Falha ao resolver aprovação: ${err.message}`);
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleStartNewPlan = async () => {
    if (isActionLoading) return;
    setIsActionLoading(true);
    try {
      const text = inputText.trim();
      if (text) {
        setInputText('');
        await api.sendMessage(project.id, text, crypto.randomUUID(), { forceNew: true });
      } else {
        const objective = activeRun?.objective || `Novo Plano de Desenvolvimento para ${project.name}`;
        const newRun = await api.createAutonomousRun({
          projectId: project.id,
          name: `Novo Plano #${new Date().toLocaleTimeString('pt-BR')}`,
          objective,
          briefing: objective,
          forceNew: true,
          autonomyMode: 'autonomous'
        });
        setActiveRun(newRun);
      }
      await fetchActiveRun();
      await onRefreshMessages?.();
    } catch (err: any) {
      alert(`Falha ao iniciar novo plano: ${err.message}`);
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleRetryRun = async () => {
    if (!activeRun || isActionLoading) return;
    setIsActionLoading(true);
    try {
      const updated = await api.resumeAutonomousRun(activeRun.id);
      setActiveRun(updated);
      await fetchActiveRun();
      await onRefreshMessages?.();
    } catch (err: any) {
      alert(`Falha ao tentar novamente: ${err.message}`);
    } finally {
      setIsActionLoading(false);
    }
  };

  // Derive honest status flags
  const isRunWaitingApproval = activeRun?.status === 'waiting_approval' || Boolean(activeRun?.last_error && /AGENT_NATIVE_TOOL_PENDING/.test(activeRun.last_error));
  const isRunWaitingResource = activeRun?.status === 'waiting_resource';
  const isRunBlocked = activeRun?.status === 'blocked';
  const isRunError = activeRun?.status === 'error' || agentStatus === 'error';
  const isRunPaused = activeRun?.status === 'paused';
  const isRunCompleted = activeRun?.status === 'completed';

  // Specific state distinctions: Self-Healing vs Reviewing vs Executing
  const hasReworkTask = activeRun?.tasks?.some(t =>
    t.status === 'needs_changes' ||
    t.lifecycle_state === 'REWORK_REQUIRED' ||
    t.review_decision === 'REJECTED' ||
    (t as any).reviewDecision === 'REJECTED'
  );
  const hasReviewTask = activeRun?.tasks?.some(t =>
    t.status === 'in_review' ||
    t.lifecycle_state === 'REVIEW_PENDING' ||
    t.lifecycle_state === 'COMMIT_PENDING'
  );
  const isRunSelfHealing = Boolean(hasReworkTask);
  const isRunReviewing = (activeRun?.status === 'reviewing' || Boolean(hasReviewTask)) && !isRunSelfHealing;
  const isRunActive = activeRun && ['running', 'building', 'testing', 'reviewing', 'planning', 'waiting_for_worker'].includes(activeRun.status);

  // Real progress calculation with strict 95% ceiling enforcement
  const totalTasks = activeRun?.tasks?.length || 0;
  const completedTasks = activeRun?.tasks?.filter(t => t.status === 'completed' || t.lifecycle_state === 'COMPLETED').length || 0;
  const progressPct = resolveRunProgressPct(activeRun);

  return (
    <div className="flex-1 flex flex-col h-full bg-[#080a10] overflow-hidden">
      {/* 1. Header do Chat Minimalista */}
      <div className="px-6 py-3 bg-[#0e111a] border-b border-[#1b2033] flex items-center justify-between gap-3 flex-shrink-0 z-20">
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
            <span className="text-[11px] text-slate-400">/ Chat do Projeto</span>
          </div>
        </div>

        {/* Status contextual do Chat */}
        <div className="flex items-center gap-2.5">
          {isRunWaitingApproval ? (
            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs font-medium">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              <span>Aprovação pendente</span>
            </div>
          ) : isRunWaitingResource ? (
            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-200 text-xs font-medium" title="Auto-Recovery ativo: reconectando ao runtime nativo">
              <RotateCw className="w-3.5 h-3.5 text-amber-400 animate-spin" />
              <span>Aguardando reconexão automática</span>
            </div>
          ) : isRunBlocked ? (
            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs font-medium">
              <span className="w-2 h-2 rounded-full bg-rose-400" />
              <span>Execução bloqueada</span>
            </div>
          ) : isRunError ? (
            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs font-medium">
              <span className="w-2 h-2 rounded-full bg-rose-400" />
              <span>Erro</span>
            </div>
          ) : isRunPaused ? (
            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-slate-800 border border-slate-700 text-slate-300 text-xs font-medium">
              <span className="w-2 h-2 rounded-full bg-slate-400" />
              <span>Pausado</span>
            </div>
          ) : isRunSelfHealing ? (
            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-orange-500/15 border border-orange-500/30 text-orange-300 text-xs font-medium">
              <RotateCw className="w-3.5 h-3.5 text-orange-400 animate-spin" />
              <span>Auto-correção (Retrabalho)</span>
            </div>
          ) : isRunReviewing ? (
            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-sky-500/15 border border-sky-500/30 text-sky-300 text-xs font-medium">
              <span className="w-2 h-2 rounded-full bg-sky-400 animate-pulse" />
              <span>Em revisão independente</span>
            </div>
          ) : isRunActive ? (
            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 text-xs font-medium">
              <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
              <span>{activeRun?.status === 'planning' ? 'Planejando' : 'Em execução'}</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-medium">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span>Pronto</span>
            </div>
          )}

          {(isRunBlocked || isRunError) && (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleRetryRun}
                disabled={isActionLoading}
                aria-label="Tentar novamente a execução"
                className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-200 text-xs font-medium transition-colors disabled:opacity-50"
                title="Tentar retomar a execução do plano atual"
              >
                <RotateCw className={`w-3.5 h-3.5 ${isActionLoading ? 'animate-spin' : ''}`} />
                <span>Tentar Novamente</span>
              </button>
              <button
                type="button"
                onClick={handleStartNewPlan}
                disabled={isActionLoading}
                aria-label="Iniciar novo plano"
                className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-sm transition-colors disabled:opacity-50"
                title="Iniciar um novo plano autônomo com forceNew"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Iniciar Novo Plano</span>
              </button>
            </div>
          )}

          {activeRun && totalTasks > 0 && (
            <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#141824] border border-[#23293d] text-xs font-mono text-slate-300">
              <span className="text-slate-400">Progresso:</span>
              <span className="text-indigo-400 font-bold tabular-nums">{progressPct}%</span>
            </div>
          )}

          {(isRunActive || agentStatus === 'working') && (
            <button
              type="button"
              onClick={onStopAgent}
              aria-label="Parar execução do agente"
              className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/30 text-rose-300 text-xs font-medium transition-colors"
            >
              <Square className="w-3 h-3 fill-current" />
              <span>Parar</span>
            </button>
          )}

          {onOpenAdvanced && (
            <button
              type="button"
              onClick={onOpenAdvanced}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#141824] hover:bg-[#1a2030] border border-[#23293d] text-slate-300 hover:text-white text-xs font-medium transition-colors"
              title="Abrir Painel Avançado de Diagnóstico"
            >
              <Sliders className="w-3.5 h-3.5 text-indigo-400" />
              <span className="hidden sm:inline">Avançado</span>
            </button>
          )}
        </div>
      </div>

      {/* 2. Área Compacta de Atividade Atual Fixa no Topo (HUD de Execução Real) */}
      <div className="px-6 pt-3 flex-shrink-0 max-w-4xl mx-auto w-full">
        <DecoHubCurrentActivityWidget
          run={activeRun}
          agentStatus={agentStatus}
          evidence={homologationEvidence}
          onContinueOrResume={handlePauseResume}
          onResolveApproval={handleResolveApproval}
          onOpenAdvanced={onOpenAdvanced}
          onOpenLightbox={({ url, label, index = 0 }) => {
            const screenshots: LightboxImageItem[] = (homologationEvidence?.screenshots || []).map((s, idx) => ({
              url: api.getEvidenceFileUrl(project.id, s.filename),
              label: s.label,
              filename: s.filename,
              title: s.title || s.label,
              sectionName: s.sectionName,
              index: s.index || idx + 1,
              total: s.total || homologationEvidence?.screenshots.length,
              sizeBytes: s.sizeBytes
            }));
            if (screenshots.length === 0) {
              screenshots.push({
                url,
                label,
                filename: 'screenshot.png',
                title: label,
                sectionName: label,
                index: 1,
                total: 1,
                sizeBytes: 0
              });
            }
            setCarouselLightbox({
              isOpen: true,
              images: screenshots,
              initialIndex: index
            });
          }}
          onOpenLiveApp={handleOpenLiveApp}
          isStartingPreview={isStartingPreview}
          isActionLoading={isActionLoading}
        />
      </div>

      {/* 3. Área Central com Rolagem Inteligente */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-6 py-4 space-y-6 max-w-4xl mx-auto w-full"
      >
        {/* Lista de Mensagens de Conversação Limpas */}
        {messages.length === 0 ? (
          <div className="py-16 text-center space-y-6">
            <div className="w-12 h-12 rounded-2xl bg-indigo-600/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center mx-auto">
              <Sparkles className="w-6 h-6" />
            </div>

            <div>
              <h2 className="text-xl font-bold text-white tracking-tight">
                Como posso ajudar no projeto hoje?
              </h2>
              <p className="text-xs text-slate-400 mt-2 max-w-md mx-auto leading-relaxed">
                Você pode tirar dúvidas, pedir diagnósticos sobre código ou solicitar novas funcionalidades completas com planejamento autônomo.
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-2 max-w-lg mx-auto pt-2">
              <button
                type="button"
                onClick={() => {
                  setInputText('Quais são as tarefas pendentes neste projeto e qual é o próximo passo?');
                  textareaRef.current?.focus();
                }}
                className="px-3.5 py-2 rounded-xl bg-[#10131d] hover:bg-[#161b29] border border-[#1e2333] hover:border-indigo-500/30 text-xs text-slate-300 hover:text-white transition-all flex items-center gap-2"
              >
                <ListTodo className="w-3.5 h-3.5 text-indigo-400" />
                <span>O que falta fazer no projeto?</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setInputText('Analise a arquitetura e componentes principais do projeto.');
                  textareaRef.current?.focus();
                }}
                className="px-3.5 py-2 rounded-xl bg-[#10131d] hover:bg-[#161b29] border border-[#1e2333] hover:border-indigo-500/30 text-xs text-slate-300 hover:text-white transition-all flex items-center gap-2"
              >
                <Bot className="w-3.5 h-3.5 text-cyan-400" />
                <span>Analisar arquivos e arquitetura</span>
              </button>
            </div>
          </div>
        ) : (
          messages.map(msg => {
            const isUser = msg.role === 'user';

            let metadataObj: any = null;
            if (msg.metadata) {
              try {
                metadataObj = typeof msg.metadata === 'string' ? JSON.parse(msg.metadata) : msg.metadata;
              } catch {}
            }

            // Extract screenshots from metadata or markdown images
            let screenshots: Array<{ filename: string; label: string; url: string; sizeBytes?: number }> = [];
            if (metadataObj?.screenshots && Array.isArray(metadataObj.screenshots) && metadataObj.screenshots.length > 0) {
              screenshots = metadataObj.screenshots;
            } else if (!isUser && msg.content && msg.content.includes('![')) {
              const imgRegex = /!\[(.*?)\]\((.*?)\)/g;
              let match: RegExpExecArray | null;
              while ((match = imgRegex.exec(msg.content)) !== null) {
                const label = match[1] || 'Captura de Tela';
                const url = match[2];
                const filename = url.split('/').pop() || 'screenshot.png';
                screenshots.push({ filename, label, url });
              }
            }

            const isCompletionMessage = metadataObj?.type === 'run_completion' || (screenshots.length > 0 && msg.content.includes('Homologad'));

            let cleanedText = msg.content;
            if (!isUser) {
              cleanedText = cleanedText
                .replace(/\[AI DEV Council\]:[^\n]*/gi, '')
                .replace(/\(NEEDS_EVIDENCE:[^\n]*/gi, '')
                .replace(/### (?:\u{1F4F8} )?Evidências Visuais Capturadas via Playwright:[^\n]*/giu, '')
                .replace(/!\[(.*?)\]\((.*?)\)/g, '')
                .trim();
            }

            const badgesMap = new Map<string, any>((metadataObj?.badges || []).map((b: any) => [b.id, b]));
            const devPassed = (badgesMap.get('dev_tests') as any)?.status !== 'FAILED';
            const designPassed = (badgesMap.get('ui_anti_slop') as any)?.status !== 'FAILED';
            const uxPassed = (badgesMap.get('ux_journey') as any)?.status !== 'FAILED';
            const appsecPassed = (badgesMap.get('appsec_pentest') as any)?.status !== 'FAILED';

            return (
              <div
                key={msg.id}
                className={`flex gap-3.5 animate-message-enter ${isUser ? 'justify-end' : 'justify-start'}`}
              >
                {!isUser && (
                  <div className="w-7 h-7 rounded-lg border bg-indigo-600/20 border-indigo-500/30 text-indigo-400 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Bot className="w-4 h-4" />
                  </div>
                )}

                <div
                  className={`rounded-2xl px-4 py-3 text-xs leading-relaxed ${
                    isUser
                      ? 'max-w-[85%] bg-indigo-600 text-white rounded-br-sm shadow-sm'
                      : isCompletionMessage || screenshots.length > 0
                      ? 'w-full max-w-3xl bg-[#10131d] border border-[#1e2333] text-slate-200 rounded-bl-sm'
                      : 'max-w-[85%] bg-[#10131d] border border-[#1e2333] text-slate-200 rounded-bl-sm'
                  }`}
                >
                  <div className="flex items-center justify-between gap-4 mb-1.5 opacity-80 text-[10px]">
                    <span className="font-semibold uppercase tracking-wider text-[9px]">
                      {isUser ? 'Você' : 'DecoHUB'}
                    </span>
                    <span>{new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>

                  <div className="whitespace-pre-wrap font-sans">
                    {cleanedText}
                  </div>

                  {/* Banner / Botão de Cancelamento para Instruções Enfileiradas */}
                  {metadataObj?.execution?.status === 'queued' && (
                    <div className="mt-2.5 pt-2 border-t border-[#1b2236] flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-amber-300">
                        <Clock className="w-3.5 h-3.5 text-amber-400" />
                        <span>Enfileirada para execução</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => handleCancelQueuedMessage(msg.id)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/40 text-rose-300 hover:text-white text-[11px] font-medium transition-colors"
                        title="Cancelar envio da instrução"
                      >
                        <X className="w-3 h-3" />
                        <span>Cancelar envio</span>
                      </button>
                    </div>
                  )}

                  {/* Card Visual de Entrega Final com Screenshots e 4 Selos de Homologação */}
                  {(screenshots.length > 0 || isCompletionMessage) && (
                    <div className="mt-3.5 rounded-xl border border-[#222a42] bg-[#0c101c] p-3.5 shadow-lg space-y-3">
                      {/* Cabeçalho do Card */}
                      <div className="flex items-center justify-between pb-2 border-b border-[#1b2236]">
                        <div className="flex items-center gap-2">
                          <div className="p-1.5 rounded-lg bg-indigo-500/15 text-indigo-400 border border-indigo-500/30">
                            <ImageIcon className="w-4 h-4" />
                          </div>
                          <div>
                            <h4 className="text-xs font-bold text-white tracking-tight flex items-center gap-1.5">
                              <span>Preview Visual da Aplicação</span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-mono font-normal">
                                Playwright Real
                              </span>
                            </h4>
                            <p className="text-[10px] text-slate-400">
                              Evidências de execução em navegador headless com interação real e F5
                            </p>
                          </div>
                        </div>
                        {metadataObj?.overallScore !== undefined && (
                          <div className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 font-mono text-[11px] font-bold">
                            <span>{metadataObj.overallScore}%</span>
                          </div>
                        )}
                      </div>

                      {/* Grid Responsivo de Screenshots */}
                      {screenshots.length > 0 && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                          {screenshots.map((s, idx) => {
                            const cleanFilename = s.filename || (s.url ? s.url.split('/').pop()?.split('?')[0] : '') || 'screenshot.png';
                            const cacheBuster = (s as any).timestamp ? new Date((s as any).timestamp).getTime() : Date.now();
                            const resolvedUrl = api.getEvidenceFileUrl(project.id, cleanFilename, cacheBuster);

                            return (
                              <div
                                key={s.filename || idx}
                                onClick={() => {
                                  const msgScreenshots = screenshots.map((item, i) => {
                                    const cFilename = item.filename || (item.url ? item.url.split('/').pop()?.split('?')[0] : '') || `screenshot-${i+1}.png`;
                                    const cUrl = api.getEvidenceFileUrl(project.id, cFilename);
                                    return {
                                      url: cUrl,
                                      label: item.label || cFilename,
                                      filename: cFilename,
                                      title: (item as any).title || item.label || cFilename,
                                      sectionName: (item as any).sectionName || item.label || cFilename,
                                      index: (item as any).index || i + 1,
                                      total: (item as any).total || screenshots.length,
                                      sizeBytes: item.sizeBytes
                                    };
                                  });
                                  setCarouselLightbox({
                                    isOpen: true,
                                    images: msgScreenshots,
                                    initialIndex: idx
                                  });
                                }}
                                className="group cursor-pointer rounded-lg overflow-hidden border border-[#1e2538] bg-[#080b12] hover:border-indigo-500/60 transition-all shadow-sm flex flex-col"
                              >
                                <div className="relative aspect-video bg-[#05070d] flex items-center justify-center overflow-hidden">
                                  <img
                                    src={resolvedUrl}
                                    alt={s.label || s.filename}
                                    className="w-full h-full object-cover object-top group-hover:scale-105 transition-transform duration-300"
                                    loading="lazy"
                                  />
                                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white">
                                    <Maximize2 className="w-4 h-4 drop-shadow" />
                                  </div>
                                </div>
                                <div className="p-2 text-[11px] bg-[#0c101c]">
                                  <p className="font-semibold text-slate-200 truncate" title={s.label || s.filename}>
                                    {s.label || s.filename}
                                  </p>
                                  {s.sizeBytes ? (
                                    <p className="text-[9px] text-slate-500 font-mono mt-0.5">
                                      {(s.sizeBytes / 1024).toFixed(0)} KB
                                    </p>
                                  ) : null}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Rodapé com 4 Selos e Botão de Ação Ao Vivo */}
                      <div className="pt-2 border-t border-[#1b2236] flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                            devPassed ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30' : 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                          }`}>
                            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                            <span>Dev {devPassed ? 'Aprovado' : 'Reprovado'}</span>
                          </span>
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                            designPassed ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30' : 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                          }`}>
                            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                            <span>Design {designPassed ? 'Aprovado' : 'Reprovado'}</span>
                          </span>
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                            uxPassed ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30' : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                          }`}>
                            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                            <span>UX F5 {uxPassed ? 'Aprovado' : 'Pendente'}</span>
                          </span>
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                            appsecPassed ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30' : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                          }`}>
                            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                            <span>AppSec {appsecPassed ? 'Aprovado' : 'Pendente'}</span>
                          </span>
                        </div>

                        <button
                          type="button"
                          onClick={handleOpenLiveApp}
                          disabled={isStartingPreview}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm transition-all ml-auto disabled:opacity-50"
                        >
                          {isStartingPreview ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <ExternalLink className="w-3.5 h-3.5" />
                          )}
                          <span>Abrir Aplicativo Ao Vivo</span>
                        </button>
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

        {/* Indicador sutil de pensamento com pulsing e respeito a reduced-motion */}
        {(isSubmitting || agentStatus === 'working') && (
          <div className="flex gap-3.5 justify-start animate-message-enter">
            <div className="w-7 h-7 rounded-lg border bg-indigo-600/20 border-indigo-500/30 text-indigo-400 flex items-center justify-center flex-shrink-0 mt-0.5">
              <Sparkles className="w-4 h-4 text-indigo-400" />
            </div>
            <div className="rounded-2xl px-4 py-3 bg-[#10131d] border border-indigo-500/30 text-indigo-300 text-xs flex items-center gap-2.5 motion-safe:animate-gentle-pulse">
              <span className="w-2 h-2 rounded-full bg-indigo-400 motion-safe:animate-pulse" />
              <span>Pensando e processando...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* 3. Rodapé com Entrada de Instrução */}
      <div className="p-4 bg-[#0e111a] border-t border-[#1b2033] flex-shrink-0">
        <form onSubmit={handleSubmit} className="max-w-4xl mx-auto space-y-2">
          <div className="relative flex items-end rounded-2xl bg-[#080a10] border border-[#21273d] focus-within:border-indigo-500/60 transition-all p-2 shadow-inner">
            {/* Popover / Command Menu flutuante de Slash Commands */}
            <SlashCommandMenu
              isOpen={isCommandMenuOpen}
              filterText={commandFilter}
              onSelectCommand={handleSelectSlashCommand}
              onClose={() => setIsCommandMenuOpen(false)}
            />

            <textarea
              ref={textareaRef}
              value={inputText}
              disabled={isSubmitting}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={isRunActive ? "Digite uma instrução complementar para enfileirar com segurança... (ou use / para comandos)" : "Digite uma dúvida, instrução ou / para acionar Slash Commands (/frontend, /image, /rea, /karpathy)..."}
              rows={2}
              className="flex-1 bg-transparent px-2.5 py-1 text-xs text-white placeholder-slate-500 resize-none focus:outline-none leading-relaxed disabled:opacity-60"
            />

            <button
              type="button"
              onClick={() => {
                setIsCommandMenuOpen(prev => {
                  const next = !prev;
                  if (next && !inputText.startsWith('/')) {
                    setInputText('/');
                    setCommandFilter('');
                  }
                  return next;
                });
                textareaRef.current?.focus();
              }}
              className={`p-2 px-2.5 rounded-xl border transition-all text-[11px] font-mono flex items-center gap-1.5 flex-shrink-0 ml-1.5 ${
                isCommandMenuOpen
                  ? 'bg-indigo-600/30 border-indigo-500/60 text-white shadow-sm'
                  : 'bg-[#111624] border-[#232a3e] hover:bg-[#181f33] text-indigo-300 hover:text-white'
              }`}
              title="Abrir menu de Slash Commands (/)"
            >
              <Terminal className="w-3.5 h-3.5 text-indigo-400" />
              <span>/ Skills</span>
            </button>

            {isSubmitting ? (
              <button
                type="button"
                onClick={handleCancelInFlight}
                className="px-3.5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 active:scale-95 text-white font-medium text-xs transition-all shadow-sm flex items-center gap-1.5 flex-shrink-0 ml-1.5"
                title="Cancelar envio da mensagem"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>Cancelar</span>
              </button>
            ) : (
              <button
                type="submit"
                disabled={!inputText.trim() || isSubmitting}
                className="p-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:hover:bg-indigo-600 text-white transition-all shadow-sm flex-shrink-0 ml-1.5"
                title={isRunActive ? "Enfileirar instrução para execução segura" : "Enviar mensagem"}
              >
                {isRunActive ? <Clock className="w-3.5 h-3.5 text-amber-300" /> : <Send className="w-3.5 h-3.5" />}
              </button>
            )}
          </div>

          <div className="flex items-center justify-between text-[11px] text-slate-500 px-1">
            <span>
              {isRunActive ? (
                <span className="text-amber-300/90 font-medium flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-amber-400 inline" />
                  <span>O executor está ativo. Mensagens enviadas serão <strong>enfileiradas sem conflito</strong>.</span>
                </span>
              ) : (
                <span>Pressione <strong>Enter</strong> para enviar, <strong>Shift + Enter</strong> para quebra de linha</span>
              )}
            </span>
            {activeAccount && (
              <span className="text-slate-400">
                Conta: <span className="text-indigo-300">{activeAccount.display_name}</span>
                {activeAccount.auth_status === 'QUOTA_EXHAUSTED' && (
                  <span className="ml-1 text-amber-400 font-semibold">(Cota em cooldown)</span>
                )}
              </span>
            )}
          </div>
        </form>
      </div>

      {/* Lightbox Carrossel com Navegação Lateral e Filmstrip */}
      <ImageCarouselLightbox
        isOpen={carouselLightbox.isOpen}
        onClose={() => setCarouselLightbox(prev => ({ ...prev, isOpen: false }))}
        images={carouselLightbox.images}
        initialIndex={carouselLightbox.initialIndex}
      />
    </div>
  );
};
