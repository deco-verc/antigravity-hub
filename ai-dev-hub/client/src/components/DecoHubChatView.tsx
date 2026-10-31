import React, { useState, useRef, useEffect } from 'react';
import {
  FullProjectDetails,
  ChatMessage,
  AccountProfile,
  AutonomousRun,
  HomologationEvidenceData,
  ProjectProfileMode,
  ProjectCapabilities,
  DEFAULT_CAPABILITIES_LOCAL_PERSONAL,
  DEFAULT_CAPABILITIES_COMMERCIAL_SAAS
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
  Terminal,
  Database,
  CreditCard,
  Lock,
  Sprout,
  Wrench,
  Rocket,
  Users,
  Search
} from 'lucide-react';
import { SlashCommandMenu } from './SlashCommandMenu';
import { SlashCommandItem } from '../types';

interface DecoHubChatViewProps {
  project: FullProjectDetails;
  projectRun?: AutonomousRun | null;
  messages: ChatMessage[];
  activeAccount: AccountProfile | null;
  agentStatus: 'ready' | 'working' | 'error';
  onSendMessage: (content: string, requestId?: string, options?: { signal?: AbortSignal; planFirst?: boolean; approvePendingPlan?: boolean; agent?: 'council' | 'supervisor' | 'worker' | 'reviewer' }) => Promise<void>;
  onStopAgent: () => Promise<void>;
  onBackToOverview: () => void;
  onOpenAdvanced?: () => void;
  onRefreshMessages?: () => Promise<void>;
  onRunUpdated?: (run: AutonomousRun | null) => void;
}

import { ImageCarouselLightbox, LightboxImageItem } from './ImageCarouselLightbox';

export function cleanChatMessage(content: string, isUser: boolean): string {
  if (isUser || !content) return content || '';
  return content
    .replace(/The following is a <SYSTEM_MESSAGE>[\s\S]*?content=/gi, '')
    .replace(/<SYSTEM_MESSAGE>[\s\S]*?<\/SYSTEM_MESSAGE>/gi, '')
    .replace(/\[Message\]\s+timestamp=[^\n]*\s+sender=[^\n]*\s+priority=[^\n]*\s+content=/gi, '')
    .replace(/=== CAMADA [A-Z]:[^\n]*===/gi, '')
    .replace(/=== DIRETIVA DE [^\n]*===/gi, '')
    .replace(/<thought[\s\S]*?<\/thought>/gi, '')
    .replace(/<thinking[\s\S]*?<\/thinking>/gi, '')
    .replace(/<system_invariants[\s\S]*?<\/system_invariants>/gi, '')
    .replace(/<meta_engineer_identity[\s\S]*?<\/meta_engineer_identity>/gi, '')
    .replace(/<operational_safety_invariants[\s\S]*?<\/operational_safety_invariants>/gi, '')
    .replace(/<workspace_context[\s\S]*?<\/workspace_context>/gi, '')
    .replace(/<execution_directive[^>]*>[\s\S]*?<\/execution_directive>/gi, '')
    .replace(/<evolution_mission[\s\S]*?<\/evolution_mission>/gi, '')
    .replace(/<briefing_contract[\s\S]*?<\/briefing_contract>/gi, '')
    .replace(/<autonomous_evolution_cycle[\s\S]*?<\/autonomous_evolution_cycle>/gi, '')
    .replace(/<antigravity_output[\s\S]*?<\/antigravity_output>/gi, '')
    .replace(/<task_review[\s\S]*?<\/task_review>/gi, '')
    .replace(/<system_message[\s\S]*?<\/system_message>/gi, '')
    .replace(/<context_bridge[\s\S]*?<\/context_bridge>/gi, '')
    .replace(/<user_request[\s\S]*?<\/user_request>/gi, '')
    .replace(/<user_attachments[\s\S]*?<\/user_attachments>/gi, '')
    .replace(/<failure_diagnostics[\s\S]*?<\/failure_diagnostics>/gi, '')
    .replace(/<scoped_modified_files[\s\S]*?<\/scoped_modified_files>/gi, '')
    .replace(/<\/?(?:system_invariants|meta_engineer_identity|operational_safety_invariants|workspace_context|execution_directive|evolution_mission|briefing_contract|autonomous_evolution_cycle|thought|thinking|antigravity_output|task_review|system_message|context_bridge|user_request|user_attachments|scoped_modified_files|failure_diagnostics)[^>]*>/gi, '')
    .replace(/\[(?:FILE|ARQUIVO|CRIAR|MODIFICAR):\s*[^\]]+\][\s\S]*?\[ENDFILE\]/gi, '')
    .replace(/```(?:[a-zA-Z0-9_-]+)?\s*\[(?:FILE|ARQUIVO|CRIAR|MODIFICAR):[^\]]+\][\s\S]*?```/gi, '')
    .replace(/^Created At:\s+[^\r\n]+/gm, '')
    .replace(/^Completed At:\s+[^\r\n]+/gm, '')
    .replace(/Showing lines \d+-\d+ of \d+[^\r\n]*/gm, '')
    .replace(/Made \d+ replacements? in [^\r\n]*/gm, '')
    .replace(/^Command exited with code \d+[^\r\n]*/gm, '')
    .replace(/^Command output:[^\r\n]*/gm, '')
    .replace(/^Log output:[^\r\n]*/gm, '')
    .replace(/The tool's output was truncated[^\r\n]*/gi, '')
    .replace(/\[(?:TYPECHECK|VISUAL GATE|DOUBLE ORACLE|SIMPLICITY|APPLIED)\]\s*/gi, '')
    .replace(/\[AI DEV Council\]:[^\n]*/gi, '')
    .replace(/\(NEEDS_EVIDENCE:[^\n]*/gi, '')
    .replace(/### (?:\u{1F4F8} )?Evidências Visuais Capturadas via Playwright:[^\n]*/giu, '')
    .replace(/!\[(.*?)\]\((.*?)\)/g, '')
    .trim();
}

export const DecoHubChatView: React.FC<DecoHubChatViewProps> = ({
  project,
  projectRun,
  messages,
  activeAccount,
  agentStatus,
  onSendMessage,
  onStopAgent,
  onBackToOverview,
  onOpenAdvanced,
  onRefreshMessages,
  onRunUpdated
}) => {
  const [inputText, setInputText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCommandMenuOpen, setIsCommandMenuOpen] = useState(false);
  const [commandFilter, setCommandFilter] = useState('');
  const [sentNotice, setSentNotice] = useState<{ id: string; text: string; secondsLeft: number } | null>(null);
  const submissionRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const pendingRequestRef = useRef<{ projectId: string; content: string; id: string } | null>(null);
  const currentProjectRef = useRef(project.id);
  currentProjectRef.current = project.id;

  useEffect(() => {
    const handler = (e: any) => {
      if (e.detail?.text) {
        setInputText(e.detail.text);
      }
    };
    window.addEventListener('decohub-fill-chat-input', handler);
    return () => window.removeEventListener('decohub-fill-chat-input', handler);
  }, []);

  const [activeRun, setActiveRun] = useState<AutonomousRun | null>(null);
  const effectiveRun = activeRun || projectRun || null;
  const activeRunRef = useRef<AutonomousRun | null>(null);
  useEffect(() => {
    activeRunRef.current = effectiveRun;
  }, [effectiveRun]);
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
  const [planningMode, setPlanningMode] = useState<'interactive' | 'direct'>('interactive');
  const [selectedAgent, setSelectedAgent] = useState<'council' | 'supervisor' | 'worker' | 'reviewer'>('council');
  const [councilStatus, setCouncilStatus] = useState<{ agent?: string; status: string; detail?: string } | null>(null);

  // Perfil de Projeto & Capacidades Modulares
  const [projectCapabilities, setProjectCapabilities] = useState<ProjectCapabilities>(() => {
    return project.capabilities || (project.capabilities_json ? JSON.parse(project.capabilities_json) : DEFAULT_CAPABILITIES_LOCAL_PERSONAL);
  });
  const [projectProfileMode, setProjectProfileMode] = useState<ProjectProfileMode>(() => {
    return project.projectProfile || (project.project_profile as any) || 'local_personal';
  });

  useEffect(() => {
    if (project.capabilities) {
      setProjectCapabilities(project.capabilities);
    } else if (project.capabilities_json) {
      try {
        setProjectCapabilities(JSON.parse(project.capabilities_json));
      } catch {}
    }
    if (project.projectProfile || project.project_profile) {
      setProjectProfileMode((project.projectProfile || project.project_profile) as any);
    }
  }, [project.id, project.capabilities, project.projectProfile, project.project_profile, project.capabilities_json]);

  const handleToggleCapability = async (key: keyof ProjectCapabilities) => {
    const nextCaps = { ...projectCapabilities, [key]: !projectCapabilities[key] };
    const isCommercial = nextCaps.database && nextCaps.auth && nextCaps.payments && nextCaps.advancedSaas && nextCaps.demoSeed;
    const isLocal = nextCaps.database && !nextCaps.auth && !nextCaps.payments && !nextCaps.advancedSaas && !nextCaps.demoSeed;
    const nextProfile: ProjectProfileMode = isCommercial ? 'commercial_saas' : isLocal ? 'local_personal' : 'custom';

    setProjectCapabilities(nextCaps);
    setProjectProfileMode(nextProfile);

    try {
      await api.updateProject(project.id, {
        capabilities: nextCaps,
        projectProfile: nextProfile,
        project_profile: nextProfile,
        capabilities_json: JSON.stringify(nextCaps)
      });
    } catch (err) {
      console.warn('[DecoHubChatView] Falha ao atualizar capacidade do projeto:', err);
    }
  };

  const handleSelectProfileMode = async (mode: ProjectProfileMode) => {
    let nextCaps = { ...projectCapabilities };
    if (mode === 'local_personal') {
      nextCaps = { ...DEFAULT_CAPABILITIES_LOCAL_PERSONAL };
    } else if (mode === 'commercial_saas') {
      nextCaps = { ...DEFAULT_CAPABILITIES_COMMERCIAL_SAAS };
    }
    setProjectProfileMode(mode);
    setProjectCapabilities(nextCaps);

    try {
      await api.updateProject(project.id, {
        capabilities: nextCaps,
        projectProfile: mode,
        project_profile: mode,
        capabilities_json: JSON.stringify(nextCaps)
      });
    } catch (err) {
      console.warn('[DecoHubChatView] Falha ao atualizar perfil do projeto:', err);
    }
  };

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
    fetchActiveRun();
  }, [project.id]);

  useEffect(() => {
    if (effectiveRun?.status) {
      fetchEvidence();
    }
  }, [effectiveRun?.status]);

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
      setActiveRun(prevRun => {
        if (
          prevRun &&
          ['running', 'planning', 'building', 'testing', 'reviewing', 'waiting_for_worker'].includes(prevRun.status) &&
          run &&
          ['completed', 'error', 'blocked'].includes(run.status)
        ) {
          onRefreshMessages?.();
        }
        return run;
      });
      activeRunRef.current = run;
      onRunUpdated?.(run);
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
        onRunUpdated?.(data.autonomousRun);
      }
      setIsSubmitting(false);
    });

    sseClient.on('run_updated', async (data) => {
      if (currentProjectRef.current !== project.id) return;
      await fetchActiveRun();
      if (onRefreshMessages) {
        await onRefreshMessages();
      }
    });

    sseClient.on('activity', (data) => {
      if (currentProjectRef.current !== project.id) return;
      if (data.run) {
        setActiveRun(data.run);
        onRunUpdated?.(data.run);
      } else if (data.status) {
        setActiveRun(prev => {
          const next = prev ? { ...prev, status: data.status, next_action: data.message || prev.next_action } : prev;
          onRunUpdated?.(next);
          return next;
        });
      }
    });

    sseClient.on('tool_call', () => {
      if (currentProjectRef.current !== project.id) return;
      fetchEvidence();
    });

    sseClient.on('council_status', (data: any) => {
      if (currentProjectRef.current !== project.id) return;
      if (data?.status === 'idle') {
        setCouncilStatus(null);
      } else if (data) {
        setCouncilStatus({
          agent: data.agent,
          status: data.status,
          detail: data.detail
        });
      }
    });

    sseClient.on('chat_message', async () => {
      if (currentProjectRef.current !== project.id) return;
      if (onRefreshMessages) {
        await onRefreshMessages();
      }
    });

    sseClient.on('done', async () => {
      if (currentProjectRef.current !== project.id) return;
      setCouncilStatus(null);
      setIsSubmitting(false);
      await fetchActiveRun();
      if (onRefreshMessages) {
        await onRefreshMessages();
      }
    });

    sseClient.on('error', () => {
      if (currentProjectRef.current !== project.id) return;
      setCouncilStatus(null);
      setIsSubmitting(false);
    });

    // Dual-layer resilience: fallback periodic poll while component is mounted
    const pollTimer = setInterval(() => {
      if (currentProjectRef.current !== project.id) return;
      fetchActiveRun();
      if (
        activeRunRef.current &&
        ['running', 'building', 'testing', 'reviewing', 'planning', 'waiting_for_worker'].includes(activeRunRef.current.status)
      ) {
        onRefreshMessages?.();
      }
    }, 2500);

    return () => {
      clearInterval(pollTimer);
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
  }, [messages, isSubmitting]);

  // Auto-dismiss 3-second interactive dispatch banner
  useEffect(() => {
    if (!sentNotice) return;
    const timer = setInterval(() => {
      setSentNotice(prev => {
        if (!prev) return null;
        if (prev.secondsLeft <= 0.1) return null;
        return { ...prev, secondsLeft: Math.max(0, +(prev.secondsLeft - 0.1).toFixed(1)) };
      });
    }, 100);
    return () => clearInterval(timer);
  }, [sentNotice?.id]);

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

    const displaySnippet = content.length > 80 ? content.slice(0, 77) + '...' : content;
    setSentNotice({ id: request.id, text: displaySnippet, secondsLeft: 3 });

    setInputText('');
    setIsSubmitting(true);
    // User sent a message, ensure we will scroll to see the response
    isNearBottomRef.current = true;

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      await onSendMessage(content, request.id, {
        signal: controller.signal,
        planFirst: planningMode === 'interactive' && !isRunActive,
        agent: selectedAgent
      });
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

  const handleApprovePlan = async () => {
    if (isSubmitting || submissionRef.current) return;
    submissionRef.current = true;
    setIsSubmitting(true);
    const controller = new AbortController();
    abortControllerRef.current = controller;
    try {
      await onSendMessage('Aprovar e construir no Antigravity', crypto.randomUUID(), {
        signal: controller.signal,
        approvePendingPlan: true
      });
      await fetchActiveRun();
    } catch (err) {
      console.error('Erro ao aprovar plano:', err);
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
    if (!effectiveRun || isActionLoading) return;
    setIsActionLoading(true);
    try {
      const updated = await api.resumeAutonomousRun(effectiveRun.id);
      setActiveRun(updated);
      await fetchActiveRun();
    } catch (err: any) {
      alert(`Falha na execução: ${err.message}`);
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleResolveApproval = async (decision: 'approved' | 'rejected') => {
    if (!effectiveRun || isActionLoading) return;
    setIsActionLoading(true);
    try {
      // Find pending approval or send resume
      const updated = await api.resumeAutonomousRun(effectiveRun.id);
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
        const objective = effectiveRun?.objective || `Novo Plano de Desenvolvimento para ${project.name}`;
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
    if (!effectiveRun || isActionLoading) return;
    setIsActionLoading(true);
    try {
      const updated = await api.resumeAutonomousRun(effectiveRun.id);
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
  const isRunWaitingApproval = effectiveRun?.status === 'waiting_approval' || Boolean(effectiveRun?.last_error && /AGENT_NATIVE_TOOL_PENDING/.test(effectiveRun.last_error));
  const isRunWaitingResource = effectiveRun?.status === 'waiting_resource';
  const isRunBlocked = effectiveRun?.status === 'blocked';
  const isRunError = effectiveRun?.status === 'error' || agentStatus === 'error';
  const isRunPaused = effectiveRun?.status === 'paused';
  const isRunCompleted = effectiveRun?.status === 'completed';

  // Specific state distinctions: Self-Healing vs Reviewing vs Executing
  const hasReworkTask = effectiveRun?.tasks?.some(t =>
    t.status === 'needs_changes' ||
    t.lifecycle_state === 'REWORK_REQUIRED' ||
    t.review_decision === 'REJECTED' ||
    (t as any).reviewDecision === 'REJECTED'
  );
  const hasReviewTask = effectiveRun?.tasks?.some(t =>
    t.status === 'in_review' ||
    t.lifecycle_state === 'REVIEW_PENDING' ||
    t.lifecycle_state === 'COMMIT_PENDING'
  );
  const isRunSelfHealing = Boolean(hasReworkTask);
  const isRunReviewing = (effectiveRun?.status === 'reviewing' || Boolean(hasReviewTask)) && !isRunSelfHealing;
  const isRunActive = effectiveRun && ['running', 'building', 'testing', 'reviewing', 'planning', 'waiting_for_worker'].includes(effectiveRun.status);

  // Real progress calculation with strict 95% ceiling enforcement
  const totalTasks = effectiveRun?.tasks?.length || 0;
  const completedTasks = effectiveRun?.tasks?.filter(t => t.status === 'completed' || t.lifecycle_state === 'COMPLETED').length || 0;
  const progressPct = resolveRunProgressPct(effectiveRun);

  return (
    <div className="flex-1 flex flex-col h-full min-h-0 bg-[#080a10] overflow-hidden">
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
              <span>{effectiveRun?.status === 'planning' ? 'Planejando' : 'Em execução'}</span>
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

          {effectiveRun && totalTasks > 0 && (
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

      {/* 2. Contêiner de Rolagem Completa e Irrestrita (Status Cards + Histórico de Mensagens) */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex flex-col flex-1 min-h-0 overflow-y-auto scroll-smooth custom-scrollbar [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-slate-700/60"
      >
        {/* Área Compacta de Atividade Atual (Apenas quando houver execução ativa ou pendente) */}
        {Boolean(effectiveRun && (isRunActive || isRunSelfHealing || isRunReviewing || isRunWaitingApproval || isRunBlocked || isRunError || (totalTasks > 0 && !isRunCompleted))) && (
          <div className="px-6 pt-3 flex-shrink-0 max-w-4xl mx-auto w-full">
            <DecoHubCurrentActivityWidget
              run={effectiveRun}
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
        )}

        {/* Telinha bonita interativa de envio que some após 3 segundos */}
        {sentNotice && (
          <div
            onClick={() => setSentNotice(null)}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-message-enter cursor-pointer"
          >
            <div
              onClick={e => e.stopPropagation()}
              className="bg-[#0e1322]/95 border border-indigo-500/40 shadow-2xl shadow-indigo-950/80 rounded-2xl p-6 max-w-sm w-full mx-auto flex flex-col items-center text-center space-y-3.5 relative overflow-hidden transition-all duration-300 animate-scale-up"
            >
              <div className="absolute -top-10 left-1/2 -translate-x-1/2 w-36 h-36 bg-indigo-500/20 rounded-full blur-2xl pointer-events-none" />

              <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-indigo-600/30 to-cyan-500/20 border border-indigo-400/40 text-indigo-300 flex items-center justify-center shadow-lg shadow-indigo-500/20 relative">
                <Sparkles className="w-7 h-7 text-indigo-300 animate-pulse" />
                <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-emerald-500 border-2 border-[#0e1322] flex items-center justify-center">
                  <Check className="w-2.5 h-2.5 text-white" />
                </span>
              </div>

              <div className="space-y-1">
                <h3 className="text-sm font-bold text-white tracking-tight flex items-center justify-center gap-2">
                  <span>Mensagem Enviada!</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/25 border border-indigo-500/40 text-indigo-200 font-mono font-bold">
                    {Math.ceil(sentNotice.secondsLeft)}s
                  </span>
                </h3>
                <p className="text-xs text-slate-300 leading-relaxed font-sans line-clamp-2">
                  "{sentNotice.text}"
                </p>
              </div>

              {/* Barra de contagem regressiva de 3 segundos */}
              <div className="w-full bg-[#181f33] h-1.5 rounded-full overflow-hidden mt-1">
                <div
                  className="h-full bg-gradient-to-r from-indigo-500 via-purple-500 to-cyan-400 rounded-full transition-all duration-100 ease-linear shadow-[0_0_8px_rgba(99,102,241,0.6)]"
                  style={{ width: `${(sentNotice.secondsLeft / 3) * 100}%` }}
                />
              </div>

              <button
                type="button"
                onClick={() => setSentNotice(null)}
                className="text-[11px] text-slate-400 hover:text-white transition-colors pt-0.5"
              >
                Toque para fechar
              </button>
            </div>
          </div>
        )}

        {/* Lista de Mensagens de Conversação Limpas */}
        <div className="flex-1 px-6 py-4 space-y-6 max-w-4xl mx-auto w-full">

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

            let cleanedText = cleanChatMessage(msg.content, isUser);

            const badgesMap = new Map<string, any>((metadataObj?.badges || []).map((b: any) => [b.id, b]));
            const devPassed = (badgesMap.get('dev_tests') as any)?.status !== 'FAILED';
            const designPassed = (badgesMap.get('ui_anti_slop') as any)?.status !== 'FAILED';
            const uxPassed = (badgesMap.get('ux_journey') as any)?.status !== 'FAILED';
            const appsecPassed = (badgesMap.get('appsec_pentest') as any)?.status !== 'FAILED';

            const agentRole = msg.agent_role || metadataObj?.agentRole || metadataObj?.agent_role;
            const isSupervisor = agentRole === 'supervisor';
            const isWorker = agentRole === 'worker';
            const isReviewer = agentRole === 'reviewer';

            let avatarEl = <Bot className="w-4 h-4" />;
            let avatarBoxClass = "w-7 h-7 rounded-lg border bg-indigo-600/20 border-indigo-500/30 text-indigo-400 flex items-center justify-center flex-shrink-0 mt-0.5";
            let bubbleBorderClass = "bg-[#10131d] border border-[#1e2333] text-slate-200";
            let roleHeaderLabel = 'DecoHUB';
            let roleHeaderBadge: React.ReactNode = null;

            if (isSupervisor) {
              avatarBoxClass = "w-7 h-7 rounded-lg border bg-purple-900/40 border-purple-600/50 text-purple-300 flex items-center justify-center flex-shrink-0 mt-0.5 text-xs font-bold";
              avatarEl = <Shield className="w-4 h-4 text-purple-300" />;
              bubbleBorderClass = "bg-[#120d22] border border-purple-800/50 text-slate-200 shadow-md shadow-purple-950/20";
              roleHeaderLabel = 'Supervisor';
              roleHeaderBadge = (
                <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-purple-900/60 text-purple-200 border border-purple-600/60 flex items-center gap-1 shadow-sm">
                  <Shield className="w-3 h-3 text-purple-300" />
                  <span>SUPERVISOR</span>
                </span>
              );
            } else if (isWorker) {
              avatarBoxClass = "w-7 h-7 rounded-lg border bg-cyan-900/40 border-cyan-600/50 text-cyan-300 flex items-center justify-center flex-shrink-0 mt-0.5 text-xs font-bold";
              avatarEl = <Terminal className="w-4 h-4 text-cyan-300" />;
              bubbleBorderClass = "bg-[#0a1622] border border-cyan-800/50 text-slate-200 shadow-md shadow-cyan-950/20";
              roleHeaderLabel = 'Worker';
              roleHeaderBadge = (
                <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-cyan-900/60 text-cyan-200 border border-cyan-600/60 flex items-center gap-1 shadow-sm">
                  <Terminal className="w-3 h-3 text-cyan-300" />
                  <span>WORKER</span>
                </span>
              );
            } else if (isReviewer) {
              avatarBoxClass = "w-7 h-7 rounded-lg border bg-emerald-900/40 border-emerald-600/50 text-emerald-300 flex items-center justify-center flex-shrink-0 mt-0.5 text-xs font-bold";
              avatarEl = <CheckCircle2 className="w-4 h-4 text-emerald-300" />;
              bubbleBorderClass = "bg-[#081a16] border border-emerald-800/50 text-slate-200 shadow-md shadow-emerald-950/20";
              roleHeaderLabel = 'Reviewer';
              const verdict = metadataObj?.verdict || (/APROVADO/i.test(cleanedText) ? 'APROVADO' : 'AJUSTE_NECESSARIO');
              roleHeaderBadge = (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-emerald-900/60 text-emerald-200 border border-emerald-600/60 flex items-center gap-1 shadow-sm">
                    <CheckCircle2 className="w-3 h-3 text-emerald-300" />
                    <span>REVIEWER</span>
                  </span>
                  <span className={`px-2 py-0.5 rounded-full text-[9px] font-black border flex items-center gap-1 ${
                    verdict === 'APROVADO'
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                      : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                  }`}>
                    <span>{verdict === 'APROVADO' ? 'APROVADO' : 'AJUSTE NECESSÁRIO'}</span>
                  </span>
                </div>
              );
            }

            return (
              <div
                key={msg.id}
                className={`flex gap-3.5 animate-message-enter ${isUser ? 'justify-end' : 'justify-start'}`}
              >
                {!isUser && (
                  <div className={avatarBoxClass}>
                    {avatarEl}
                  </div>
                )}

                <div
                  className={`rounded-2xl px-4 py-3 text-xs leading-relaxed ${
                    isUser
                      ? 'max-w-[85%] bg-indigo-600 text-white rounded-br-sm shadow-sm'
                      : isCompletionMessage || screenshots.length > 0
                      ? `w-full max-w-3xl ${bubbleBorderClass} rounded-bl-sm`
                      : `max-w-[85%] ${bubbleBorderClass} rounded-bl-sm`
                  }`}
                >
                  <div className="flex items-center justify-between gap-4 mb-1.5 opacity-90 text-[10px]">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold uppercase tracking-wider text-[9px]">
                        {isUser ? 'Você' : roleHeaderLabel}
                      </span>
                      {roleHeaderBadge}
                    </div>
                    <span>{new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>

                  <div className="whitespace-pre-wrap font-sans">
                    {cleanedText}
                  </div>

                  {/* Card de Ações Executadas pelo Worker (Reset de Banco, etc.) */}
                  {isWorker && metadataObj?.actions?.databaseReset && (
                    <div className="mt-2.5 p-2.5 rounded-xl border border-cyan-500/40 bg-cyan-950/40 flex items-start gap-2 shadow-sm">
                      <Database className="w-4 h-4 text-cyan-400 flex-shrink-0 mt-0.5" />
                      <div className="text-[11px] space-y-0.5">
                        <span className="font-bold text-cyan-200 block">
                          Banco SQLite Zerado com Sucesso
                        </span>
                        <span className="text-[10px] text-cyan-300/80 font-mono block">
                          Arquivos removidos: {metadataObj.actions.deletedFiles?.join(', ') || 'data/app.db'}
                        </span>
                      </div>
                    </div>
                  )}

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

                  {/* Card de Proposta de Plano Interativo */}
                  {metadataObj?.pendingPlan && (
                    <div className="mt-3.5 rounded-xl border border-indigo-500/40 bg-[#090d19] p-3.5 shadow-xl space-y-3">
                      <div className="flex items-center justify-between pb-2 border-b border-[#1b233a]">
                        <div className="flex items-center gap-2">
                          <div className="p-1.5 rounded-lg bg-indigo-500/15 text-indigo-400 border border-indigo-500/30">
                            <Sparkles className="w-4 h-4" />
                          </div>
                          <div>
                            <h4 className="text-xs font-bold text-white tracking-tight flex items-center gap-2">
                              <span>Proposta de Plano Arquitetural</span>
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-mono font-medium">
                                {metadataObj.pendingPlan.proposedTasks?.length || 0} Etapas Coesas
                              </span>
                            </h4>
                            <p className="text-[10px] text-slate-400">
                              Stack: <span className="text-indigo-300 font-medium">{metadataObj.pendingPlan.stack?.framework || 'Next.js / TypeScript'}</span> • {metadataObj.pendingPlan.stack?.architecture || 'Arquitetura Modular'}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Lista numerada com pills de arquivos alvo */}
                      <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1 custom-scrollbar">
                        {metadataObj.pendingPlan.proposedTasks?.map((task: any, idx: number) => (
                          <div
                            key={task.code || idx}
                            className="rounded-lg border border-[#1d253c] bg-[#0d1222] p-2.5 transition-colors hover:border-indigo-500/30"
                          >
                            <div className="flex items-start gap-2">
                              <span className="flex-shrink-0 px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-mono text-[10px] font-bold">
                                {task.code || `ET-${idx + 1}`}
                              </span>
                              <div className="flex-1 min-w-0">
                                <h5 className="text-xs font-medium text-slate-200 leading-snug">
                                  {task.title}
                                </h5>
                                {task.expectedFiles && task.expectedFiles.length > 0 && (
                                  <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                                    {task.expectedFiles.map((file: string, fIdx: number) => (
                                      <span
                                        key={fIdx}
                                        className="inline-flex items-center px-1.5 py-0.5 rounded bg-[#151c30] border border-[#232d4b] text-[10px] font-mono text-cyan-300"
                                      >
                                        {file}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Alinhamento e Botão de Aprovação Destacado */}
                      <div className="pt-2.5 border-t border-[#1b233a] flex flex-col sm:flex-row items-center justify-between gap-3">
                        <p className="text-[11px] text-slate-300 flex-1">
                          O plano acima atende ao que você precisa? Deseja ajustar algo ou podemos começar?
                        </p>
                        <button
                          type="button"
                          disabled={Boolean(isSubmitting || isRunActive)}
                          onClick={() => handleApprovePlan()}
                          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-lg shadow-emerald-950/40 hover:shadow-emerald-900/50 transition-all cursor-pointer disabled:opacity-50"
                        >
                          <Check className="w-4 h-4" />
                          <span>Aprovar Estas {metadataObj.pendingPlan.proposedTasks?.length || 0} Etapas e Construir no Antigravity</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Card Visual de Entrega Final com Screenshots e 4 Selos de Homologação */}
                  {(screenshots.length > 0 || isCompletionMessage) && (
                    <div className="mt-3.5 rounded-xl border border-emerald-500/30 bg-[#080d18] p-3.5 shadow-lg space-y-3">
                      {/* Cabeçalho do Card */}
                      <div className="flex items-center justify-between pb-2 border-b border-[#182236]">
                        <div className="flex items-center gap-2">
                          <div className="p-1.5 rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                            <ImageIcon className="w-4 h-4" />
                          </div>
                          <div>
                            <h4 className="text-xs font-bold text-white tracking-tight flex items-center gap-1.5">
                              <span>Evidências Visuais do Pedido Concluído</span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono font-normal">
                                {screenshots.length} Captura{screenshots.length > 1 ? 's' : ''} Playwright Real
                              </span>
                            </h4>
                            <p className="text-[10px] text-slate-400">
                              Inspeção em navegador real com renderização visual, formulário, mobile e persistência F5
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {metadataObj?.overallScore !== undefined && (
                            <div className="flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 font-mono text-[11px] font-bold">
                              <span>{metadataObj.overallScore}% Homologado</span>
                            </div>
                          )}
                          {screenshots.length > 0 && (
                            <button
                              type="button"
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
                                  initialIndex: 0
                                });
                              }}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 text-xs font-medium transition-colors cursor-pointer"
                              title="Abrir galeria completa no visualizador carrossel"
                            >
                              <Maximize2 className="w-3.5 h-3.5" />
                              <span>Expandir Galeria</span>
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Grid Responsivo de Screenshots com Rolagem Interna */}
                      {screenshots.length > 0 && (
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 max-h-[360px] overflow-y-auto pr-1 custom-scrollbar [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-slate-700/60">
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
                                className="group cursor-pointer rounded-lg overflow-hidden border border-[#1e2538] bg-[#05070d] hover:scale-[1.02] hover:border-emerald-500/60 transition-all shadow-sm flex flex-col"
                                title="Clique para ampliar em tela cheia"
                              >
                                <div className="relative aspect-video bg-[#030508] flex items-center justify-center overflow-hidden">
                                  <img
                                    src={resolvedUrl}
                                    alt={s.label || s.filename}
                                    className="w-full h-full object-cover object-top group-hover:scale-105 transition-transform duration-200"
                                    loading="lazy"
                                  />
                                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white">
                                    <Maximize2 className="w-3.5 h-3.5 drop-shadow" />
                                  </div>
                                  <div className="absolute bottom-0 inset-x-0 bg-black/75 py-0.5 px-1 text-[9px] text-center text-emerald-300 opacity-0 group-hover:opacity-100 transition-opacity font-medium tracking-tight pointer-events-none">
                                    Clique para ampliar
                                  </div>
                                </div>
                                <div className="p-1.5 text-[10px] bg-[#0c101c]">
                                  <p className="font-medium text-slate-200 truncate" title={s.label || s.filename}>
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

        {/* Card Dinâmico de Execução Ativa do Worker no Fluxo Conversacional */}
        {isRunActive && (
          <div className="flex gap-3.5 justify-start animate-message-enter">
            <div className="w-7 h-7 rounded-lg border bg-cyan-950/60 border-cyan-500/50 text-cyan-300 flex items-center justify-center flex-shrink-0 mt-0.5 shadow-md shadow-cyan-950/50">
              <Zap className="w-4 h-4 text-cyan-400 animate-pulse" />
            </div>
            <div className="rounded-2xl px-4 py-3 bg-[#08111c] border border-cyan-500/40 text-cyan-100 text-xs w-full max-w-xl shadow-lg shadow-cyan-950/40 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
                  <span className="font-bold uppercase tracking-wider text-[11px] text-cyan-300 flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Worker Executando no Projeto...</span>
                  </span>
                </div>
                <span className="text-[10px] font-mono text-cyan-400/80 bg-cyan-950/80 px-2 py-0.5 rounded-md border border-cyan-800/50">
                  {progressPct}% ({completedTasks}/{totalTasks} etapas)
                </span>
              </div>

              <div className="text-[11px] text-slate-300">
                <span className="text-slate-400">Etapa Atual: </span>
                <span className="font-semibold text-white">
                  {effectiveRun?.current_task || effectiveRun?.next_action || 'Implementando alterações de código e testes...'}
                </span>
              </div>

              {/* Barra de Progresso Real */}
              <div className="w-full bg-slate-800/80 rounded-full h-1.5 overflow-hidden">
                <div
                  className="bg-gradient-to-r from-cyan-500 to-indigo-500 h-1.5 rounded-full transition-all duration-500"
                  style={{ width: `${Math.max(5, Math.min(100, progressPct))}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1 border-t border-cyan-900/30">
                <span className="flex items-center gap-1">
                  <Terminal className="w-3 h-3 text-cyan-400" />
                  <span>Aplicando patches cirúrgicos e validando runtime</span>
                </span>
                <span className="text-cyan-400/70 italic">O relatório final será entregue aqui</span>
              </div>
            </div>
          </div>
        )}

        {/* Indicador sutil de pensamento com pulsing e respeito a reduced-motion */}
        {/* Indicador de Pensamento em Tempo Real do Conselho Multi-Agente */}
        {councilStatus ? (
          <div className="flex gap-3.5 justify-start animate-message-enter">
            <div className={`w-7 h-7 rounded-lg border flex items-center justify-center flex-shrink-0 mt-0.5 text-xs font-bold ${
              councilStatus.agent === 'supervisor' ? 'bg-purple-900/40 border-purple-600/50 text-purple-300' :
              councilStatus.agent === 'worker' ? 'bg-cyan-900/40 border-cyan-600/50 text-cyan-300' :
              councilStatus.agent === 'reviewer' ? 'bg-emerald-900/40 border-emerald-600/50 text-emerald-300' :
              'bg-indigo-600/20 border-indigo-500/30 text-indigo-400'
            }`}>
              {councilStatus.agent === 'supervisor' ? <Shield className="w-4 h-4 text-purple-300" /> :
               councilStatus.agent === 'worker' ? <Terminal className="w-4 h-4 text-cyan-300" /> :
               councilStatus.agent === 'reviewer' ? <CheckCircle2 className="w-4 h-4 text-emerald-300" /> :
               <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />}
            </div>
            <div className={`rounded-2xl px-4 py-3 border text-xs flex items-center gap-3 shadow-lg ${
              councilStatus.agent === 'supervisor' ? 'bg-[#120d22] border-purple-600/50 text-purple-200' :
              councilStatus.agent === 'worker' ? 'bg-[#0a1622] border-cyan-600/50 text-cyan-200' :
              councilStatus.agent === 'reviewer' ? 'bg-[#081a16] border-emerald-600/50 text-emerald-200' :
              'bg-[#10131d] border-indigo-500/30 text-indigo-300'
            }`}>
              <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="font-bold uppercase tracking-wider text-[10px]">
                    {councilStatus.agent === 'supervisor' ? 'Supervisor Analisando' :
                     councilStatus.agent === 'worker' ? 'Worker Executando Ação' :
                     councilStatus.agent === 'reviewer' ? 'Reviewer Auditando' :
                     'Conselho Multi-Agente'}
                  </span>
                </div>
                <p className="text-[11px] opacity-90 font-medium">
                  {councilStatus.detail || 'Processando raciocínio técnico...'}
                </p>
              </div>
            </div>
          </div>
        ) : isSubmitting && (
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
      </div>

      {/* 3. Rodapé com Entrada de Instrução (Sempre Ancorado e Acessível) */}
      <div className="p-4 bg-[#0e111a] border-t border-[#1b2033] flex-shrink-0 sticky bottom-0 z-20">
        <form onSubmit={handleSubmit} className="max-w-4xl mx-auto space-y-2">
          {/* BARRA SELETORA DE AGENTES (Conselho Multi-Agente Real) */}
          <div className="flex items-center justify-between flex-wrap gap-2 px-1 pb-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider flex items-center gap-1 mr-1">
                <Users className="w-3.5 h-3.5 text-indigo-400" />
                <span>Agente:</span>
              </span>

              {/* Pill 1: Conselho Completo */}
              <button
                type="button"
                onClick={() => setSelectedAgent('council')}
                className={`px-2.5 py-1 rounded-xl border text-[11px] font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                  selectedAgent === 'council'
                    ? 'bg-gradient-to-r from-purple-600/30 via-indigo-600/30 to-cyan-600/30 border-indigo-400/80 text-white shadow-md shadow-indigo-950/60 ring-1 ring-indigo-400/40'
                    : 'bg-[#080b14] border-[#1c2338] text-slate-400 hover:text-slate-200 hover:border-slate-600'
                }`}
                title="Conselho Completo (Auto): Os 3 agentes interagem (Supervisor analisa e propõe, Worker executa e Reviewer audita)"
              >
                <Users className="w-3.5 h-3.5 text-indigo-400" />
                <span>Conselho Completo (Auto)</span>
              </button>

              {/* Pill 2: Supervisor */}
              <button
                type="button"
                onClick={() => setSelectedAgent('supervisor')}
                className={`px-2.5 py-1 rounded-xl border text-[11px] font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                  selectedAgent === 'supervisor'
                    ? 'bg-purple-900/50 border-purple-500/80 text-purple-200 shadow-md shadow-purple-950/60 ring-1 ring-purple-400/40'
                    : 'bg-[#080b14] border-[#1c2338] text-slate-400 hover:text-purple-300 hover:border-purple-800'
                }`}
                title="Falar diretamente com o Supervisor (Arquiteto & Cérebro)"
              >
                <Shield className="w-3.5 h-3.5 text-purple-400" />
                <span>Falar com Supervisor</span>
              </button>

              {/* Pill 3: Worker */}
              <button
                type="button"
                onClick={() => setSelectedAgent('worker')}
                className={`px-2.5 py-1 rounded-xl border text-[11px] font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                  selectedAgent === 'worker'
                    ? 'bg-cyan-900/50 border-cyan-500/80 text-cyan-200 shadow-md shadow-cyan-950/60 ring-1 ring-cyan-400/40'
                    : 'bg-[#080b14] border-[#1c2338] text-slate-400 hover:text-cyan-300 hover:border-cyan-800'
                }`}
                title="Falar diretamente com o Worker (Operário Executor & Banco de Dados)"
              >
                <Terminal className="w-3.5 h-3.5 text-cyan-400" />
                <span>Falar com Worker</span>
              </button>

              {/* Pill 4: Reviewer */}
              <button
                type="button"
                onClick={() => setSelectedAgent('reviewer')}
                className={`px-2.5 py-1 rounded-xl border text-[11px] font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                  selectedAgent === 'reviewer'
                    ? 'bg-emerald-900/50 border-emerald-500/80 text-emerald-200 shadow-md shadow-emerald-950/60 ring-1 ring-emerald-400/40'
                    : 'bg-[#080b14] border-[#1c2338] text-slate-400 hover:text-emerald-300 hover:border-emerald-800'
                }`}
                title="Falar diretamente com o Reviewer (Auditor de QA & Qualidade)"
              >
                <Search className="w-3.5 h-3.5 text-emerald-400" />
                <span>Falar com Reviewer</span>
              </button>
            </div>
          </div>

          {/* Seletor Visual de Modo: Planejar Etapas Primeiro vs Construir Direto */}
          <div className="flex items-center justify-between gap-2 px-1 text-[11px]">
            <div className="inline-flex items-center rounded-lg bg-[#080b12] border border-[#1c2338] p-0.5">
              <button
                type="button"
                onClick={() => setPlanningMode('interactive')}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
                  planningMode === 'interactive'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Apresenta um plano estruturado de etapas para alinhamento antes de codar"
              >
                <Sparkles className="w-3.5 h-3.5 text-indigo-300" />
                <span>Planejar Etapas Primeiro (Interativo)</span>
              </button>
              <button
                type="button"
                onClick={() => setPlanningMode('direct')}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
                  planningMode === 'direct'
                    ? 'bg-amber-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Inicia imediatamente a esteira de desenvolvimento autônomo no Antigravity"
              >
                <Zap className="w-3.5 h-3.5 text-amber-300" />
                <span>Construir Direto (Autônomo)</span>
              </button>
            </div>
            {!isRunActive && (
              <span className="text-[10px] text-slate-500 hidden sm:inline">
                {planningMode === 'interactive' ? 'Gera proposta de tarefas e aguarda aprovação' : 'Dispara a esteira autônoma imediatamente'}
              </span>
            )}
          </div>

          {/* Barra Rápida de Perfil de Projeto & Capacidades Modulares */}
          <div className="flex items-center justify-between flex-wrap gap-1.5 px-1 py-1 text-[11px] text-slate-300">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] uppercase font-semibold text-slate-500 tracking-wider">Modo do Projeto:</span>

              {/* Seletor Rápido de Perfil */}
              <div className="relative inline-flex items-center">
                <select
                  value={projectProfileMode}
                  onChange={(e) => handleSelectProfileMode(e.target.value as ProjectProfileMode)}
                  className={`text-[11px] font-semibold rounded-lg px-2 py-0.5 border cursor-pointer focus:outline-none transition-all ${
                    projectProfileMode === 'local_personal'
                      ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                      : projectProfileMode === 'commercial_saas'
                        ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-300'
                        : 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                  }`}
                  title="Alterar modo geral do projeto"
                >
                  <option value="local_personal" className="bg-[#0b0d16] text-white">Local / Pessoal</option>
                  <option value="commercial_saas" className="bg-[#0b0d16] text-white">SaaS Comercial</option>
                  <option value="custom" className="bg-[#0b0d16] text-white">Personalizado</option>
                </select>
              </div>

              <span className="text-slate-600">|</span>

              {/* Chip 1: Banco */}
              <button
                type="button"
                onClick={() => handleToggleCapability('database')}
                className={`px-2 py-0.5 rounded-lg border text-[11px] font-medium flex items-center gap-1 transition-all ${
                  projectCapabilities.database
                    ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300 shadow-sm'
                    : 'bg-[#101420] border-[#1f273d] text-slate-500 hover:text-slate-300 opacity-60'
                }`}
                title="Persistência SQLite no disco (Salvar dados localmente)"
              >
                <Database className="w-3 h-3" />
                <span>Banco: {projectCapabilities.database ? 'ON' : 'OFF'}</span>
              </button>

              {/* Chip 2: Login */}
              <button
                type="button"
                onClick={() => handleToggleCapability('auth')}
                className={`px-2 py-0.5 rounded-lg border text-[11px] font-medium flex items-center gap-1 transition-all ${
                  projectCapabilities.auth
                    ? 'bg-amber-500/15 border-amber-500/40 text-amber-300 shadow-sm'
                    : 'bg-[#101420] border-[#1f273d] text-slate-500 hover:text-slate-300 opacity-60'
                }`}
                title="Login, Cadastro e Sessão (Supabase Auth / Turnstile)"
              >
                <Lock className="w-3 h-3" />
                <span>Login: {projectCapabilities.auth ? 'ON' : 'OFF'}</span>
              </button>

              {/* Chip 3: PIX / Pagamentos */}
              <button
                type="button"
                onClick={() => handleToggleCapability('payments')}
                className={`px-2 py-0.5 rounded-lg border text-[11px] font-medium flex items-center gap-1 transition-all ${
                  projectCapabilities.payments
                    ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 shadow-sm'
                    : 'bg-[#101420] border-[#1f273d] text-slate-500 hover:text-slate-300 opacity-60'
                }`}
                title="Cobrança, Planos e Checkout PIX"
              >
                <CreditCard className="w-3 h-3" />
                <span>PIX: {projectCapabilities.payments ? 'ON' : 'OFF'}</span>
              </button>

              {/* Chip 4: Avançado (RBAC, API Keys, Webhooks) */}
              <button
                type="button"
                onClick={() => handleToggleCapability('advancedSaas')}
                className={`px-2 py-0.5 rounded-lg border text-[11px] font-medium flex items-center gap-1 transition-all ${
                  projectCapabilities.advancedSaas
                    ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-300 shadow-sm'
                    : 'bg-[#101420] border-[#1f273d] text-slate-500 hover:text-slate-300 opacity-60'
                }`}
                title="Recursos Avançados SaaS: Gestão de Equipe (RBAC), API Keys e Webhooks"
              >
                <Shield className="w-3 h-3" />
                <span>Avançado: {projectCapabilities.advancedSaas ? 'ON' : 'OFF'}</span>
              </button>

              {/* Chip 5: Demo Seed */}
              <button
                type="button"
                onClick={() => handleToggleCapability('demoSeed')}
                className={`px-2 py-0.5 rounded-lg border text-[11px] font-medium flex items-center gap-1 transition-all ${
                  projectCapabilities.demoSeed
                    ? 'bg-green-500/15 border-green-500/40 text-green-300 shadow-sm'
                    : 'bg-[#101420] border-[#1f273d] text-slate-500 hover:text-slate-300 opacity-60'
                }`}
                title="Popular dados fictícios de exemplo no boot (seedIfEmpty)"
              >
                <Sprout className="w-3 h-3" />
                <span>Dados Demo: {projectCapabilities.demoSeed ? 'ON' : 'OFF'}</span>
              </button>
            </div>
          </div>

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
