import React, { useState, useEffect, useRef } from 'react';
import {
  MetaChatMessageItem,
  MetaChatRecompileResult,
  MetaChatLiveStatus,
  MetaChatAutopilotStatus,
  DecoMindMlStatus,
  MetaChatThread,
  MetaChatLiveActivity,
  MetaChatLiveStep,
  AccountProfile,
  ModelOption
} from '../types';
import { api } from '../services/api';
import { createMetaChatSseClient } from '../services/sseClient';
import {
  Sparkles,
  Send,
  Loader2,
  CheckCircle2,
  AlertCircle,
  FileCode,
  ArrowLeft,
  Terminal,
  Shield,
  Hammer,
  Trash2,
  Check,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Paperclip,
  Image as ImageIcon,
  X,
  User,
  Cpu,
  Zap,
  HardDrive,
  Copy,
  Square,
  Clock,
  Plus,
  Settings,
  PanelLeft,
  PanelLeftClose,
  MessageSquare,
  Activity,
  CheckSquare,
  Play
} from 'lucide-react';
import { SlashCommandMenu } from './SlashCommandMenu';
import { SlashCommandItem } from '../types';

interface DecoHubMetaChatViewProps {
  onBack?: () => void;
  onShowToast?: (type: 'success' | 'warn' | 'error' | 'info', message: string) => void;
  accounts?: AccountProfile[];
  activeAccount?: AccountProfile | null;
  onAccountSwitched?: (acc: AccountProfile) => void;
  onOpenAccountManager?: () => void;
  onOpenAddAccountModal?: () => void;
  onReloadAccounts?: () => Promise<void>;
}

interface MetaAttachmentPreview {
  id: string;
  name: string;
  size: number;
  type: string;
  base64Content: string;
  previewUrl?: string;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}s`;
}

function formatInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith('**') && token.endsWith('**')) {
      parts.push(
        <strong key={`b-${match.index}`} className="font-semibold text-white">
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith('`') && token.endsWith('`')) {
      parts.push(
        <code key={`c-${match.index}`} className="px-1.5 py-0.5 rounded bg-[#101424] border border-[#222b45] font-mono text-[11px] text-cyan-300">
          {token.slice(1, -1)}
        </code>
      );
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : text;
}

function renderTextLines(textBlock: string, keyPrefix: string): React.ReactNode {
  const lines = textBlock.split(/\r?\n/);
  return (
    <div key={keyPrefix} className="space-y-1">
      {lines.map((line, idx) => {
        const trimmed = line.trim();
        if (!trimmed) {
          return <div key={idx} className="h-1.5" />;
        }
        if (trimmed === '---') {
          return <hr key={idx} className="border-[#222b45] my-2.5" />;
        }
        if (trimmed.startsWith('# ')) {
          return (
            <h1 key={idx} className="text-base font-bold text-white mt-3 mb-1">
              {formatInline(trimmed.slice(2))}
            </h1>
          );
        }
        if (trimmed.startsWith('## ')) {
          return (
            <h2 key={idx} className="text-sm font-bold text-slate-100 mt-2.5 mb-1">
              {formatInline(trimmed.slice(3))}
            </h2>
          );
        }
        if (trimmed.startsWith('### ')) {
          return (
            <h3 key={idx} className="text-xs font-bold text-indigo-300 mt-2 mb-0.5 uppercase tracking-wide">
              {formatInline(trimmed.slice(4))}
            </h3>
          );
        }
        if (trimmed.startsWith('#### ')) {
          return (
            <h4 key={idx} className="text-xs font-semibold text-slate-200 mt-1.5 mb-0.5">
              {formatInline(trimmed.slice(5))}
            </h4>
          );
        }
        if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
          return (
            <div key={idx} className="flex items-start gap-2 ml-2 text-slate-300 text-xs">
              <span className="text-indigo-400 mt-0.5">•</span>
              <span className="flex-1">{formatInline(trimmed.slice(2))}</span>
            </div>
          );
        }
        const numMatch = trimmed.match(/^(\d+)\.\s+(.*)$/);
        if (numMatch) {
          return (
            <div key={idx} className="flex items-start gap-2 ml-2 text-slate-300 text-xs">
              <span className="text-cyan-400 font-mono text-[11px] font-semibold">{numMatch[1]}.</span>
              <span className="flex-1">{formatInline(numMatch[2])}</span>
            </div>
          );
        }
        return (
          <p key={idx} className="text-xs leading-relaxed text-slate-300">
            {formatInline(line)}
          </p>
        );
      })}
    </div>
  );
}

function renderFormattedMetaChatContent(content: string, isUser: boolean): React.ReactNode {
  if (isUser) {
    return <div className="whitespace-pre-wrap font-sans">{content}</div>;
  }

  const codeBlockRegex = /```([a-zA-Z0-9_-]*)\r?\n([\s\S]*?)```/g;
  const sections: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      const textBlock = content.slice(lastIndex, match.index);
      sections.push(renderTextLines(textBlock, `txt-${lastIndex}`));
    }

    const lang = match[1] || 'code';
    const code = match[2];
    sections.push(
      <div key={`code-${match.index}`} className="my-2.5 rounded-xl border border-[#222b45] overflow-hidden bg-[#070a12]">
        <div className="flex items-center justify-between px-3 py-1 bg-[#0d1222] border-b border-[#222b45] text-[10px] font-mono text-slate-400">
          <span>{lang}</span>
        </div>
        <pre className="p-3 overflow-x-auto text-[11px] font-mono text-slate-200 leading-relaxed">
          <code>{code}</code>
        </pre>
      </div>
    );

    lastIndex = codeBlockRegex.lastIndex;
  }

  if (lastIndex < content.length) {
    const textBlock = content.slice(lastIndex);
    sections.push(renderTextLines(textBlock, `txt-${lastIndex}`));
  }

  return <div className="space-y-1.5 text-xs text-slate-200 leading-relaxed">{sections}</div>;
}

export const DecoHubMetaChatView: React.FC<DecoHubMetaChatViewProps> = ({
  onBack,
  onShowToast,
  accounts: propAccounts,
  activeAccount: propActiveAccount,
  onAccountSwitched,
  onOpenAccountManager,
  onOpenAddAccountModal,
  onReloadAccounts
}) => {
  const [messages, setMessages] = useState<MetaChatMessageItem[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [liveStatus, setLiveStatus] = useState<MetaChatLiveStatus | null>(null);
  const [isCommandMenuOpen, setIsCommandMenuOpen] = useState(false);
  const [commandFilter, setCommandFilter] = useState('');
  const [isRecompiling, setIsRecompiling] = useState(false);
  const [recompileResult, setRecompileResult] = useState<MetaChatRecompileResult | null>(null);

  // Autopilot State (Zero-Prompt Auto-Evolução)
  const [autopilotStatus, setAutopilotStatus] = useState<MetaChatAutopilotStatus | null>(null);
  const [autopilotTargetCycles, setAutopilotTargetCycles] = useState<number>(() => {
    return Number(localStorage.getItem('decohub_metachat_autopilot_cycles') || 1);
  });
  const [isStartingAutopilot, setIsStartingAutopilot] = useState(false);
  const [mlStatus, setMlStatus] = useState<DecoMindMlStatus | null>(null);

  // Multi-Threads State
  const [threads, setThreads] = useState<MetaChatThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string>(() => {
    return localStorage.getItem('decohub_active_metachat_thread_id') || 'thread-default';
  });
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(() => {
    return localStorage.getItem('decohub_metachat_sidebar_open') !== 'false';
  });

  // Real-Time Activity & Telemetry
  const [liveActivity, setLiveActivity] = useState<MetaChatLiveActivity | null>(null);
  const [expandedMessageSteps, setExpandedMessageSteps] = useState<Record<string, boolean>>({});
  const [expandedLongMessages, setExpandedLongMessages] = useState<Record<string, boolean>>({});

  const toggleSidebar = () => {
    setIsSidebarOpen(prev => {
      const next = !prev;
      localStorage.setItem('decohub_metachat_sidebar_open', String(next));
      return next;
    });
  };

  // Accounts & Profiles with LocalStorage Persistence and Shared Props
  const [localAccounts, setLocalAccounts] = useState<AccountProfile[]>([]);
  const [localActiveAccount, setLocalActiveAccount] = useState<AccountProfile | null>(null);

  const effectiveAccounts = (propAccounts && propAccounts.length > 0) ? propAccounts : localAccounts;
  const effectiveActiveAccount = propActiveAccount || localActiveAccount || effectiveAccounts[0] || null;

  const [isConfigMenuOpen, setIsConfigMenuOpen] = useState(false);
  const [isRapidSwitching, setIsRapidSwitching] = useState(false);
  const configMenuRef = useRef<HTMLDivElement>(null);

  const loadAccounts = async () => {
    try {
      const [profiles, active] = await Promise.all([
        api.getAccountProfiles().catch(() => []),
        api.getActiveAccountProfile().catch(() => null)
      ]);
      setLocalAccounts(profiles);
      const savedId = localStorage.getItem('decohub.metachat.accountId') || localStorage.getItem('ai_dev_last_account');
      if (savedId && profiles.some(p => p.id === savedId)) {
        setLocalActiveAccount(profiles.find(p => p.id === savedId) || null);
      } else if (active) {
        setLocalActiveAccount(active);
      } else if (profiles.length > 0) {
        setLocalActiveAccount(profiles[0]);
      }
    } catch (err: any) {
      console.error('Erro ao carregar contas do Meta-Chat:', err);
    }
  };

  const handleRapidSwitch = async (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (isRapidSwitching) return;
    setIsRapidSwitching(true);
    try {
      const res = await api.rapidSwitchAccount();
      if (res.activeProfile) {
        setLocalActiveAccount(res.activeProfile);
        localStorage.setItem('decohub.metachat.accountId', res.activeProfile.id);
        localStorage.setItem('ai_dev_last_account', res.activeProfile.id);
        onAccountSwitched?.(res.activeProfile);
        if (onReloadAccounts) {
          await onReloadAccounts();
        } else {
          await loadAccounts();
        }
      }
      if (res.switched) {
        onShowToast?.('success', res.message || `Rapid Switch concluído para ${res.activeProfile?.display_name}`);
      } else {
        onShowToast?.('warn', res.message || 'Nenhuma outra conta disponível para Rapid Switch no momento.');
      }
    } catch (err: any) {
      onShowToast?.('error', `Falha no Rapid Switch: ${err.message}`);
    } finally {
      setIsRapidSwitching(false);
    }
  };

  const handleSwitchAccount = async (acc: AccountProfile) => {
    setLocalActiveAccount(acc);
    localStorage.setItem('decohub.metachat.accountId', acc.id);
    localStorage.setItem('ai_dev_last_account', acc.id);
    onAccountSwitched?.(acc);
    try {
      await api.setGlobalActiveAccountProfile(acc.id);
      onShowToast?.('info', `Conta alterada para ${acc.display_name}`);
    } catch (err: any) {
      console.warn('Erro ao definir conta ativa global:', err);
    }
    if (onReloadAccounts) {
      await onReloadAccounts();
    } else {
      await loadAccounts();
    }
  };

  // Model Selector (Matching Projects Header: 'auto', 'pro', 'flash')
  const [selectedModel, setSelectedModel] = useState<string>(() => {
    return localStorage.getItem('decohub.metachat.model') || 'auto';
  });

  const getModelLabel = (m: string) => {
    if (m === 'auto') return 'Auto (3.8 Flash)';
    if (m === 'pro') return 'Gemini Pro';
    if (m === 'flash' || m === 'gemini-3.8-flash') return 'Gemini 3.8 Flash';
    if (m === 'gemini-3.8-pro') return 'Gemini Pro';
    if (m === 'flash_lite') return 'Flash Lite';
    return String(m);
  };

  const getAccountDot = (st?: string) => {
    if (st === 'READY' || st === 'ACTIVE') return 'bg-emerald-400';
    if (st === 'WAITING_LOGIN' || st === 'AUTHENTICATING' || st === 'NEEDS_LOGIN') return 'bg-amber-400 animate-pulse';
    if (st === 'QUOTA_EXHAUSTED') return 'bg-amber-400';
    if (st === 'ERROR') return 'bg-rose-400';
    return 'bg-slate-400';
  };

  const handleSelectModel = (modelValue: string) => {
    setSelectedModel(modelValue);
    localStorage.setItem('decohub.metachat.model', modelValue);
    setIsConfigMenuOpen(false);
    onShowToast?.('info', `Modelo do Meta-Chat alterado para ${getModelLabel(modelValue)}`);
  };

  // Live Timer, Stopwatch & Cancellation
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isCancelling, setIsCancelling] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const lastPromptRef = useRef<string>('');

  const handleCancelActiveExecution = async () => {
    if (isCancelling) return;
    setIsCancelling(true);
    try {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      await api.cancelMetaChat();
      onShowToast?.('info', 'Execução do Meta-Chat cancelada. Arquivos preservados no estado íntegro.');
      if (lastPromptRef.current) {
        setInputText(lastPromptRef.current);
      }
      await loadMessages(activeThreadId);
      await loadThreads(activeThreadId);
    } catch (err: any) {
      onShowToast?.('error', `Falha ao cancelar: ${err.message}`);
    } finally {
      setIsLoading(false);
      setIsCancelling(false);
      setLiveStatus(null);
      setLiveActivity(null);
    }
  };

  const handleReuseMessage = (content: string) => {
    setInputText(content);
    textareaRef.current?.focus();
    onShowToast?.('info', 'Mensagem copiada para o campo de texto.');
  };

  const handleDeleteMessage = async (id: string) => {
    if (!id || id.startsWith('temp-')) {
      setMessages(prev => prev.filter(m => m.id !== id));
      return;
    }
    try {
      await api.deleteMetaChatMessage(id);
      setMessages(prev => prev.filter(m => m.id !== id));
      onShowToast?.('info', 'Mensagem removida do histórico.');
    } catch (err: any) {
      onShowToast?.('error', `Falha ao remover mensagem: ${err.message}`);
    }
  };

  // Attachments State
  const [attachments, setAttachments] = useState<MetaAttachmentPreview[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadMessages = async (threadId?: string) => {
    const targetId = threadId || activeThreadId;
    try {
      const data = await api.getMetaChatMessages(targetId);
      setMessages(data);
    } catch (err: any) {
      console.error('Erro ao carregar mensagens do Meta-Chat:', err);
    }
  };

  const loadThreads = async (preferredThreadId?: string) => {
    try {
      const list = await api.getMetaChatThreads();
      setThreads(list);
      const savedId = preferredThreadId || activeThreadId || localStorage.getItem('decohub_active_metachat_thread_id');
      const matched = list.find(t => t.id === savedId);
      const chosenId = matched ? matched.id : (list[0]?.id || 'thread-default');
      setActiveThreadId(chosenId);
      localStorage.setItem('decohub_active_metachat_thread_id', chosenId);
      await loadMessages(chosenId);
    } catch (err: any) {
      console.error('Erro ao carregar conversas do Meta-Chat:', err);
    }
  };

  const handleSelectThread = async (threadId: string) => {
    if (threadId === activeThreadId) return;
    setActiveThreadId(threadId);
    localStorage.setItem('decohub_active_metachat_thread_id', threadId);
    try {
      await api.setMetaChatActiveThread(threadId);
    } catch {}
    await loadMessages(threadId);
  };

  const handleCreateThread = async () => {
    try {
      let modelForThread = 'gemini-3.8-flash';
      if (selectedModel === 'pro' || selectedModel === 'gemini-3.8-pro') modelForThread = 'gemini-3.8-pro';
      const newThread = await api.createMetaChatThread({
        title: 'Nova Conversa',
        model: modelForThread,
        account_id: effectiveActiveAccount?.id
      });
      setThreads(prev => [newThread, ...prev.filter(t => t.id !== newThread.id)]);
      setActiveThreadId(newThread.id);
      localStorage.setItem('decohub_active_metachat_thread_id', newThread.id);
      setMessages([]);
      onShowToast?.('info', 'Nova conversa iniciada.');
      textareaRef.current?.focus();
    } catch (err: any) {
      onShowToast?.('error', `Falha ao criar nova conversa: ${err.message}`);
    }
  };

  const handleDeleteThread = async (threadId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Deseja excluir esta conversa e todo o seu histórico?')) return;
    try {
      await api.deleteMetaChatThread(threadId);
      const remaining = threads.filter(t => t.id !== threadId);
      setThreads(remaining);
      onShowToast?.('info', 'Conversa excluída.');
      if (activeThreadId === threadId) {
        if (remaining.length > 0) {
          await handleSelectThread(remaining[0].id);
        } else {
          await handleCreateThread();
        }
      }
    } catch (err: any) {
      onShowToast?.('error', `Falha ao excluir conversa: ${err.message}`);
    }
  };

  useEffect(() => {
    loadThreads();
    loadAccounts();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  useEffect(() => {
    let timer: any = null;
    let pollInterval: any = null;

    if (isLoading) {
      setElapsedSeconds(0);
      timer = setInterval(() => {
        setElapsedSeconds(prev => prev + 1);
      }, 1000);

      pollInterval = setInterval(async () => {
        try {
          const [st, msgs] = await Promise.all([
            api.getMetaChatStatus().catch(() => null),
            api.getMetaChatMessages(activeThreadId).catch(() => null)
          ]);

          if (st) {
            setLiveStatus(prev => ({
              ...(prev || { phase: 'idle', currentPhase: 'idle' }),
              ...st
            }));
            if (!st.isRunning && msgs && msgs.length > 0) {
              const lastMsg = msgs[msgs.length - 1];
              if (lastMsg && lastMsg.role === 'assistant') {
                setMessages(msgs);
                setIsLoading(false);
              }
            }
          }

          if (msgs && msgs.length > 0) {
            setMessages(prev => {
              const tempUser = prev.find(m => m.id?.startsWith('temp-') || (m.role === 'user' && !msgs.some(dbM => dbM.id === m.id)));
              if (tempUser) {
                const existsInMsgs = msgs.some(m => m.id === tempUser.id || (m.role === 'user' && m.content === tempUser.content));
                if (!existsInMsgs || st?.isRunning) {
                  const filtered = msgs.filter(m => m.id !== tempUser.id);
                  return [...filtered, tempUser];
                }
              }
              return msgs;
            });
          }
        } catch {}
      }, 1500);
    } else {
      setElapsedSeconds(0);
    }

    return () => {
      if (timer) clearInterval(timer);
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [isLoading, activeThreadId]);

  useEffect(() => {
    const sseClient = createMetaChatSseClient();

    sseClient.on('activity', (data: any) => {
      if (data.telemetry) {
        setLiveActivity(data.telemetry);
      } else if (data.pipelineTasks || data.liveSteps || data.currentActionSummary) {
        setLiveActivity(data);
      }
      if (data.status) {
        setLiveStatus(prev => ({
          ...(prev || { isRunning: true, phase: 'idle', currentPhase: 'idle' }),
          isRunning: data.status !== 'completed' && data.status !== 'error',
          phase: data.message || data.status,
          currentPhase: data.message || data.status
        }));
      }
    });

    sseClient.on('tool_call', (data: any) => {
      setLiveActivity(prev => {
        if (!prev) return prev;
        const toolStr = String(data.tool || '').toLowerCase();
        const stepType: 'READ' | 'SEARCH' | 'EDIT' | 'COMMAND' | 'GUARD' =
          toolStr.includes('read') ? 'READ' :
          toolStr.includes('search') || toolStr.includes('find') ? 'SEARCH' :
          toolStr.includes('write') || toolStr.includes('edit') ? 'EDIT' :
          toolStr.includes('guard') ? 'GUARD' : 'COMMAND';

        const step: MetaChatLiveStep = {
          id: `step-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          type: stepType,
          target: data.tool || 'ferramenta',
          status: 'running',
          details: `Executando: ${data.tool || 'operação'}`,
          timestamp: data.timestamp || new Date().toISOString()
        };
        return {
          ...prev,
          liveSteps: [...(prev.liveSteps || []), step]
        };
      });
    });

    sseClient.on('message', (data: any) => {
      const msg = data.message || data.result?.message;
      if (msg) {
        setMessages(prev => {
          const exists = prev.some(m => m.id === msg.id);
          if (exists) return prev;
          return [...prev, msg];
        });
      }
      const tId = data.threadId || data.result?.threadId;
      if (tId) {
        loadThreads(tId);
      }
      setIsLoading(false);
    });

    sseClient.on('done', () => {
      setIsLoading(false);
      loadMessages(activeThreadId);
      loadThreads(activeThreadId);
    });

    sseClient.on('error', (data: any) => {
      setIsLoading(false);
      if (data?.error) {
        onShowToast?.('error', `Erro no Meta-Chat: ${data.error}`);
      }
    });

    return () => {
      sseClient.close();
    };
  }, [activeThreadId]);

  // Polling de 1200ms para sincronizar Autopilot, DecoMind ML e mensagens de ciclos autônomos
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const [status, ml] = await Promise.all([
          api.getMetaChatAutopilotStatus().catch(() => null),
          api.getMlStatus().catch(() => null)
        ]);
        if (ml) setMlStatus(ml);
        if (status) {
          setAutopilotStatus(prev => {
            if (
              status.completedCycles !== prev?.completedCycles ||
              status.isExecutingCycle !== prev?.isExecutingCycle ||
              status.enabled !== prev?.enabled
            ) {
              loadMessages(activeThreadId);
              loadThreads(activeThreadId);
            }
            return status;
          });
        }
      } catch {}
    }, 1200);

    return () => clearInterval(interval);
  }, [activeThreadId]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (configMenuRef.current && !configMenuRef.current.contains(target)) {
        setIsConfigMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Helper to read file to base64
  const readFileAsBase64 = (file: File): Promise<MetaAttachmentPreview> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result as string;
        const isImg = file.type.startsWith('image/');
        resolve({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          name: file.name,
          size: file.size,
          type: file.type || 'application/octet-stream',
          base64Content: base64,
          previewUrl: isImg ? base64 : undefined
        });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleAddFiles = async (fileList: FileList | File[]) => {
    const filesArray = Array.from(fileList);
    if (filesArray.length === 0) return;
    try {
      const loaded = await Promise.all(filesArray.map(f => readFileAsBase64(f)));
      setAttachments(prev => [...prev, ...loaded]);
      onShowToast?.('info', `${loaded.length} anexo(s) adicionado(s)`);
    } catch (err: any) {
      onShowToast?.('error', `Erro ao processar anexo: ${err.message}`);
    }
  };

  const handleRemoveAttachment = (id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (e.clipboardData.files && e.clipboardData.files.length > 0) {
      e.preventDefault();
      handleAddFiles(e.clipboardData.files);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleAddFiles(e.dataTransfer.files);
    }
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const text = inputText.trim();
    if ((!text && attachments.length === 0) || isLoading) return;

    const currentAttachments = [...attachments];
    lastPromptRef.current = text;
    setInputText('');
    setAttachments([]);
    setIsLoading(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const effectiveText = text || 'Analise os anexos enviados e execute as alterações necessárias.';

    let effectiveBackendModel = 'gemini-3.8-flash';
    let effectiveReasoningMode: 'high' | 'medium' | 'low' = 'high';

    if (selectedModel === 'pro' || selectedModel === 'gemini-3.8-pro') {
      effectiveBackendModel = 'gemini-3.8-pro';
      effectiveReasoningMode = 'high';
    } else if (selectedModel === 'flash' || selectedModel === 'gemini-3.8-flash' || selectedModel === 'auto') {
      effectiveBackendModel = 'gemini-3.8-flash';
      effectiveReasoningMode = 'high';
    }

    const effectiveAccountId = effectiveActiveAccount?.id || undefined;

    // Optimistic user message
    const tempUserMsg: MetaChatMessageItem = {
      id: `temp-${Date.now()}`,
      thread_id: activeThreadId,
      role: 'user',
      content: effectiveText,
      metadata: {
        model: effectiveBackendModel,
        reasoningMode: effectiveReasoningMode,
        accountId: effectiveAccountId,
        attachments: currentAttachments.map(a => ({
          name: a.name,
          size: a.size,
          type: a.type,
          isImage: Boolean(a.previewUrl)
        }))
      },
      created_at: new Date().toISOString()
    };
    setMessages(prev => [...prev, tempUserMsg]);

    try {
      const res = await api.sendMetaChatMessage(
        effectiveText,
        {
          threadId: activeThreadId,
          model: effectiveBackendModel,
          reasoningMode: effectiveReasoningMode,
          accountId: effectiveAccountId,
          attachments: currentAttachments.map(a => ({
            name: a.name,
            size: a.size,
            type: a.type,
            base64Content: a.base64Content
          }))
        },
        { signal: controller.signal }
      );

      setMessages(prev => {
        const withoutTemp = prev.filter(m => m.id !== tempUserMsg.id);
        return res.message ? [...withoutTemp, tempUserMsg, res.message] : [...withoutTemp, tempUserMsg];
      });
      await loadThreads(activeThreadId);
      if (res.message) {
        setIsLoading(false);
      }

      if (res.selfHealed) {
        onShowToast?.('warn', 'Autoproteção ativada: alteração desfeita devido a erro no Typecheck.');
      } else if (res.filesChanged && res.filesChanged.length > 0) {
        onShowToast?.('success', `${res.filesChanged.length} arquivo(s) modificado(s) com Typecheck validado!`);
      }
    } catch (err: any) {
      if (err.name === 'AbortError' || controller.signal.aborted) {
        // Cancelado pelo usuário
        return;
      }

      // In case of timeout or network disconnect, check if message is in DB
      try {
        const msgs = await api.getMetaChatMessages(activeThreadId);
        const hasAssistant = msgs.some(
          m => m.role === 'assistant' && new Date(m.created_at).getTime() > new Date(tempUserMsg.created_at).getTime() - 5000
        );
        if (hasAssistant) {
          setMessages(msgs);
          await loadThreads(activeThreadId);
          return;
        }
      } catch {}

      onShowToast?.('error', err.message || 'Falha ao processar comando');
    } finally {
      abortControllerRef.current = null;
      setIsLoading(false);
      setLiveStatus(null);
      setLiveActivity(null);
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  };

  const handleResetHistory = async () => {
    if (!confirm('Deseja realmente limpar as mensagens desta conversa?')) return;
    try {
      await api.resetMetaChat(activeThreadId);
      setMessages([]);
      onShowToast?.('info', 'Mensagens da conversa reiniciadas.');
      await loadThreads(activeThreadId);
    } catch (err: any) {
      onShowToast?.('error', err.message);
    }
  };

  const handleRecompile = async () => {
    setIsRecompiling(true);
    setRecompileResult(null);
    try {
      const res = await api.recompileMetaChat();
      setRecompileResult(res);
      if (res.success) {
        onShowToast?.('success', res.message);
      } else {
        onShowToast?.('error', res.message);
      }
    } catch (err: any) {
      onShowToast?.('error', err.message || 'Erro ao recompilar');
    } finally {
      setIsRecompiling(false);
    }
  };

  const handleToggleAutopilot = async (customCycles?: number) => {
    if (autopilotStatus?.enabled) {
      try {
        const stopped = await api.stopMetaChatAutopilot();
        setAutopilotStatus(stopped);
        onShowToast?.('info', 'Autopilot pausado com sucesso.');
      } catch (err: any) {
        onShowToast?.('error', `Falha ao pausar Autopilot: ${err.message}`);
      }
      return;
    }

    const cyclesToRun = customCycles !== undefined ? customCycles : autopilotTargetCycles;
    setIsStartingAutopilot(true);
    try {
      let modelForThread = 'gemini-3.8-flash';
      if (selectedModel === 'pro' || selectedModel === 'gemini-3.8-pro') modelForThread = 'gemini-3.8-pro';

      const started = await api.startMetaChatAutopilot({
        maxCycles: cyclesToRun,
        cooldownSeconds: 15,
        model: modelForThread,
        accountId: effectiveActiveAccount?.id,
        threadId: activeThreadId
      });
      setAutopilotStatus(started);
      onShowToast?.('success', `Autopilot ativado (${cyclesToRun === 0 ? 'Modo Contínuo' : `${cyclesToRun} ciclos`})!`);
      if (started.activeThreadId && started.activeThreadId !== activeThreadId) {
        await handleSelectThread(started.activeThreadId);
      }
    } catch (err: any) {
      onShowToast?.('error', `Falha ao iniciar Autopilot: ${err.message}`);
    } finally {
      setIsStartingAutopilot(false);
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
      handleSendMessage();
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#07090e] text-slate-200 overflow-hidden font-sans">
      {/* 1. Header do Meta-Chat */}
      <header className="px-5 py-3 bg-[#0a0d15] border-b border-[#1b2033] flex flex-wrap items-center justify-between gap-3 flex-shrink-0 z-20">
        <div className="flex items-center gap-3">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[#141824] transition-colors"
              title="Voltar"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}

          <button
            type="button"
            onClick={toggleSidebar}
            className={`p-1.5 rounded-lg border text-xs transition-colors ${
              isSidebarOpen
                ? 'bg-indigo-600/20 border-indigo-500/40 text-indigo-300'
                : 'text-slate-400 hover:text-white hover:bg-[#141824] border-transparent'
            }`}
            title={isSidebarOpen ? 'Ocultar Conversas Salvas' : 'Ver Conversas Salvas'}
          >
            {isSidebarOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeft className="w-4 h-4" />}
          </button>

          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-cyan-600 to-indigo-600 flex items-center justify-center text-white shadow-md">
            <Sparkles className="w-4 h-4" />
          </div>

          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-white tracking-tight">DecoHUB Meta-Chat</h2>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                Auto-Evolução Real
              </span>
              {threads.find(t => t.id === activeThreadId) && (
                <span className="hidden lg:inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-[#141824] border border-[#23293d] text-slate-300 max-w-[180px] truncate">
                  <MessageSquare className="w-2.5 h-2.5 text-indigo-400" />
                  <span className="truncate">{threads.find(t => t.id === activeThreadId)?.title}</span>
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-400 hidden sm:block">
              Motor Antigravity operando diretamente em <code className="text-cyan-300 font-mono text-[10px]">C:\IA\Antigravity HUB\ai-dev-hub</code>
            </p>
          </div>
        </div>

        {/* Controles de Conta, Modelo e Raciocínio */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Indicador e Seletor Unificado de IA (Conta + Modelo Oficial) */}
          <div className="relative" ref={configMenuRef}>
            <button
              type="button"
              onClick={() => setIsConfigMenuOpen(!isConfigMenuOpen)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#141824] hover:bg-[#1c2234] border border-[#23293d] text-xs text-slate-200 hover:text-white transition-colors"
              title="Configuração de Conta e Modelo de IA do Meta-Chat"
            >
              <span className={`w-2 h-2 rounded-full ${getAccountDot(effectiveActiveAccount?.auth_status)}`} />
              <span className="font-medium max-w-[110px] truncate">
                {effectiveActiveAccount?.display_name || 'Conta Antigravity'}
              </span>
              <span className="text-slate-500 font-mono">·</span>
              <span className="text-indigo-300 font-medium max-w-[110px] truncate">
                {getModelLabel(selectedModel)}
              </span>
              <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform ${isConfigMenuOpen ? 'rotate-180' : ''}`} />
            </button>

            {isConfigMenuOpen && (
              <div className="absolute right-0 mt-2 w-72 bg-[#10131d] border border-[#23293d] rounded-xl shadow-xl py-2 z-50 text-xs">
                {/* Seção 1: Conta do Meta-Chat */}
                <div className="px-3.5 pb-1 text-[10px] font-semibold text-slate-500 uppercase tracking-wider flex items-center justify-between">
                  <span>Conta do Meta-Chat</span>
                  <button
                    type="button"
                    disabled={isRapidSwitching}
                    onClick={handleRapidSwitch}
                    className="flex items-center gap-1 text-[10px] text-indigo-400 hover:text-indigo-300 font-medium transition-colors disabled:opacity-50"
                    title="Alternar em 1 clique para a próxima conta READY"
                  >
                    <Zap className={`w-3 h-3 ${isRapidSwitching ? 'animate-pulse text-amber-400' : ''}`} />
                    <span>Rapid Switch</span>
                  </button>
                </div>

                {effectiveAccounts.length === 0 ? (
                  <div className="px-3.5 py-2 text-slate-400 text-[11px]">Nenhuma conta encontrada</div>
                ) : (
                  effectiveAccounts.map(acc => {
                    const isCur = acc.id === effectiveActiveAccount?.id;
                    const isWaiting = acc.auth_status === 'WAITING_LOGIN' || acc.auth_status === 'NEEDS_LOGIN';
                    return (
                      <button
                        key={acc.id}
                        type="button"
                        onClick={() => {
                          handleSwitchAccount(acc);
                        }}
                        className={`w-full text-left px-3.5 py-1.5 flex items-center justify-between transition-colors ${
                          isCur
                            ? 'bg-indigo-600/10 text-white font-medium'
                            : 'text-slate-300 hover:bg-[#181d2e] hover:text-white'
                        }`}
                      >
                        <div className="flex items-center gap-2 truncate">
                          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${getAccountDot(acc.auth_status)}`} />
                          <span className="truncate">{acc.display_name}</span>
                          {isWaiting && <span className="text-[10px] text-amber-400 font-mono">(login necessário)</span>}
                        </div>
                        {isCur && <Check className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />}
                      </button>
                    );
                  })
                )}

                <div className="px-3.5 pt-1.5 pb-1 flex items-center justify-between text-[11px] border-t border-[#1e2333] mt-1.5">
                  <button
                    type="button"
                    onClick={() => { setIsConfigMenuOpen(false); onOpenAddAccountModal?.(); }}
                    className="text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Adicionar conta</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => { setIsConfigMenuOpen(false); onOpenAccountManager?.(); }}
                    className="text-slate-400 hover:text-slate-200 flex items-center gap-1"
                  >
                    <Settings className="w-3 h-3" />
                    <span>Gerenciar</span>
                  </button>
                </div>

                {/* Seção 2: Modelo do Meta-Chat */}
                <div className="border-t border-[#1e2333] my-1.5" />
                <div className="px-3.5 pb-1 text-[10px] font-semibold text-slate-500 uppercase tracking-wider flex items-center justify-between">
                  <span>Modelo de IA do Meta-Chat</span>
                  <span className="text-emerald-400 font-mono text-[9px]">Oficial</span>
                </div>

                <button
                  type="button"
                  onClick={() => handleSelectModel('auto')}
                  className={`w-full text-left px-3.5 py-1.5 flex items-center justify-between transition-colors ${
                    selectedModel === 'auto'
                      ? 'bg-indigo-600/10 text-white font-medium'
                      : 'text-slate-300 hover:bg-[#181d2e] hover:text-white'
                  }`}
                >
                  <div>
                    <div className="flex items-center gap-1">
                      <span>Automático</span>
                      <span className="text-[10px] px-1 py-0.2 rounded bg-indigo-500/20 text-indigo-300">Recomendado</span>
                    </div>
                    <p className="text-[10px] text-slate-400">Gemini 3.8 Flash · Raciocínio HIGH</p>
                  </div>
                  {selectedModel === 'auto' && <Check className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />}
                </button>

                <button
                  type="button"
                  onClick={() => handleSelectModel('pro')}
                  className={`w-full text-left px-3.5 py-1.5 flex items-center justify-between transition-colors ${
                    selectedModel === 'pro'
                      ? 'bg-indigo-600/10 text-white font-medium'
                      : 'text-slate-300 hover:bg-[#181d2e] hover:text-white'
                  }`}
                >
                  <div>
                    <div className="font-medium text-slate-200">Gemini Pro</div>
                    <p className="text-[10px] text-slate-400">Raciocínio analítico avançado</p>
                  </div>
                  {selectedModel === 'pro' && <Check className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />}
                </button>

                <button
                  type="button"
                  onClick={() => handleSelectModel('flash')}
                  className={`w-full text-left px-3.5 py-1.5 flex items-center justify-between transition-colors ${
                    selectedModel === 'flash'
                      ? 'bg-indigo-600/10 text-white font-medium'
                      : 'text-slate-300 hover:bg-[#181d2e] hover:text-white'
                  }`}
                >
                  <div>
                    <div className="font-medium text-slate-200">Gemini 3.8 Flash</div>
                    <p className="text-[10px] text-slate-400">Rápido, econômico e preciso</p>
                  </div>
                  {selectedModel === 'flash' && <Check className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />}
                </button>
              </div>
            )}
          </div>

          {/* Botão Rapid Switch 1-Clique */}
          <button
            type="button"
            disabled={isRapidSwitching}
            onClick={handleRapidSwitch}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-indigo-600/15 hover:bg-indigo-600/25 border border-indigo-500/30 text-xs text-indigo-300 hover:text-white transition-colors disabled:opacity-50"
            title="Troca Rápida de Conta (Rapid Switch 1-Clique para próxima conta READY)"
          >
            <Zap className={`w-3.5 h-3.5 ${isRapidSwitching ? 'animate-pulse text-amber-400' : 'text-indigo-400'}`} />
            <span className="text-[11px] font-medium hidden sm:inline">Rapid Switch</span>
          </button>

          {/* C2. Controle Autopilot Auto-Evolução (Zero-Prompt) */}
          <div className="flex items-center gap-1.5 p-1 rounded-xl bg-[#0f1320] border border-[#23293d]">
            <div className="flex items-center gap-1 pl-1 pr-0.5">
              <select
                value={autopilotTargetCycles}
                onChange={e => {
                  const val = Number(e.target.value);
                  setAutopilotTargetCycles(val);
                  localStorage.setItem('decohub_metachat_autopilot_cycles', String(val));
                }}
                disabled={autopilotStatus?.enabled}
                className="bg-[#141824] border border-[#23293d] text-slate-200 text-[11px] rounded-lg px-2 py-1 outline-none disabled:opacity-50 cursor-pointer"
                title="Meta de Ciclos do Autopilot"
              >
                <option value={1}>1 Ciclo</option>
                <option value={3}>3 Ciclos</option>
                <option value={5}>5 Ciclos</option>
                <option value={0}>Contínuo (Overnight)</option>
              </select>
            </div>

            <button
              type="button"
              onClick={() => handleToggleAutopilot()}
              disabled={isStartingAutopilot}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                autopilotStatus?.enabled
                  ? 'bg-emerald-600/20 border border-emerald-500/50 text-emerald-300 hover:bg-emerald-600/30 shadow-lg shadow-emerald-500/10'
                  : 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-sm'
              }`}
              title={autopilotStatus?.enabled ? 'Clique para pausar o Autopilot' : 'Ativar auto-evolução contínua zero-prompt'}
            >
              {autopilotStatus?.enabled ? (
                <>
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                  <span className="font-mono text-[11px]">
                    {autopilotStatus.isExecutingCycle ? 'Evoluindo' : 'Pausar'}
                    {autopilotStatus.maxCycles > 0 ? ` (${autopilotStatus.completedCycles}/${autopilotStatus.maxCycles})` : ' (Contínuo)'}
                  </span>
                  <span className="text-[10px] opacity-75 font-mono hidden lg:inline">
                    · +{autopilotStatus.keptEvolutions} / -{autopilotStatus.revertedEvolutions}
                  </span>
                </>
              ) : (
                <>
                  <Play className="w-3 h-3 fill-current" />
                  <span>Autopilot ML</span>
                </>
              )}
            </button>
          </div>

          {/* Indicador DecoMind ML Telemetria Compacta */}
          {mlStatus && (
            <div
              className="hidden xl:flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-[#0a0f1d] border border-cyan-500/25 text-[11px] text-cyan-300 font-mono shadow-sm"
              title={`DecoMind ML: ${mlStatus.samplesSeen} amostras observadas, ${(mlStatus.runningAccuracy * 100).toFixed(0)}% acurácia online, Brier Loss: ${mlStatus.runningBrierLoss.toFixed(3)}, ${mlStatus.episodicMemoriesCount} vacinas Q-Learning`}
            >
              <Cpu className="w-3.5 h-3.5 text-cyan-400" />
              <span className="font-semibold text-slate-300">DecoMind ML:</span>
              <span className="font-semibold text-white">{mlStatus.samplesSeen} N</span>
              <span className="text-slate-500">·</span>
              <span className="text-emerald-400 font-semibold">{(mlStatus.runningAccuracy * 100).toFixed(0)}% Acc</span>
              <span className="text-slate-500">·</span>
              <span className="text-indigo-300">{mlStatus.episodicMemoriesCount} Q-Mem</span>
            </div>
          )}

          {/* D. Recompilar e Atualizar Produção */}
          <button
            type="button"
            onClick={handleRecompile}
            disabled={isRecompiling}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold shadow-sm transition-all"
            title="Executa npm run build em server e client, e espelha para app.asar.unpacked"
          >
            {isRecompiling ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span className="hidden md:inline">Recompilando...</span>
              </>
            ) : (
              <>
                <Hammer className="w-3.5 h-3.5" />
                <span className="hidden md:inline">Recompilar Produção</span>
              </>
            )}
          </button>

          {/* E. Limpar Histórico */}
          <button
            type="button"
            onClick={handleResetHistory}
            className="p-2 rounded-lg text-slate-400 hover:text-rose-300 hover:bg-rose-500/10 transition-colors"
            title="Limpar histórico do Meta-Chat e iniciar nova sessão"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* 2. Banner de Resultado de Recompilação */}
      {recompileResult && (
        <div className={`px-6 py-2.5 text-xs flex items-center justify-between border-b ${
          recompileResult.success
            ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300'
            : 'bg-rose-950/40 border-rose-500/30 text-rose-300'
        }`}>
          <div className="flex items-center gap-2">
            {recompileResult.success ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
            )}
            <span>{recompileResult.message}</span>
            {recompileResult.synced && (
              <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-200 text-[10px] font-mono">
                app.asar.unpacked sincronizado
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setRecompileResult(null)}
            className="text-[10px] opacity-70 hover:opacity-100 uppercase font-mono tracking-wider ml-4"
          >
            Fechar
          </button>
        </div>
      )}

      {/* Main Body with Sidebar + Chat Cockpit */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar de Conversas Salvas */}
        {isSidebarOpen && (
          <aside className="w-64 sm:w-72 bg-[#090c14] border-r border-[#1b2033] flex flex-col flex-shrink-0 z-10 transition-all select-none">
            <div className="p-3 border-b border-[#1b2033] flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                <MessageSquare className="w-3.5 h-3.5 text-indigo-400" />
                <span>Conversas Salvas</span>
              </div>
              <button
                type="button"
                onClick={handleCreateThread}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/40 text-[11px] font-semibold text-indigo-300 hover:text-white transition-all shadow-sm"
                title="Nova Conversa (+)"
              >
                <Plus className="w-3 h-3" />
                <span>Nova Conversa</span>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
              {threads.length === 0 ? (
                <div className="p-4 text-center text-xs text-slate-500">
                  Nenhuma conversa salva
                </div>
              ) : (
                threads.map(t => {
                  const isCur = t.id === activeThreadId;
                  const isRunning = t.status === 'running';

                  return (
                    <div
                      key={t.id}
                      onClick={() => handleSelectThread(t.id)}
                      className={`group relative p-2.5 rounded-xl border text-xs cursor-pointer transition-all ${
                        isCur
                          ? 'bg-[#131726] border-indigo-500/50 text-white shadow-md'
                          : 'bg-[#0d101a] hover:bg-[#111522] border-[#181e30] text-slate-300 hover:text-white'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-1.5">
                        <div className="flex items-center gap-1.5 min-w-0 flex-1">
                          {isRunning ? (
                            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping flex-shrink-0" />
                          ) : (
                            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isCur ? 'bg-indigo-400' : 'bg-slate-600'}`} />
                          )}
                          <span className="font-semibold truncate text-[11px] leading-tight">
                            {t.title}
                          </span>
                        </div>

                        <button
                          type="button"
                          onClick={e => handleDeleteThread(t.id, e)}
                          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-rose-500/20 text-slate-500 hover:text-rose-400 transition-opacity flex-shrink-0"
                          title="Excluir conversa"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>

                      {t.last_message_preview && (
                        <p className="text-[10px] text-slate-400 truncate mt-1">
                          {t.last_message_preview}
                        </p>
                      )}

                      <div className="flex items-center justify-between text-[9px] text-slate-500 mt-2 font-mono">
                        <span>
                          {new Date(t.updated_at).toLocaleDateString([], { day: '2-digit', month: '2-digit' })}{' '}
                          {new Date(t.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <div className="flex items-center gap-1">
                          {t.provider_conversation_id && (
                            <span
                              className="px-1.5 py-0.5 rounded bg-cyan-950/60 text-cyan-300 border border-cyan-800/40 text-[9px] font-mono"
                              title={`Vinculado ao chat Antigravity: ${t.provider_conversation_id}`}
                            >
                              chat:{t.provider_conversation_id.slice(0, 6)}
                            </span>
                          )}
                          {t.files_modified_count > 0 && (
                            <span className="px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 flex items-center gap-1 font-sans">
                              <FileCode className="w-2.5 h-2.5" />
                              <span>{t.files_modified_count} modificado(s)</span>
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </aside>
        )}

        {/* Área Principal de Chat */}
        <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
          {/* 3. Feed de Mensagens */}
          <div
            ref={scrollContainerRef}
            className="flex-1 overflow-y-auto px-6 py-6 space-y-6 max-w-4xl mx-auto w-full"
          >
        {messages.length === 0 ? (
          <div className="py-14 text-center space-y-6">
            <div className="w-14 h-14 rounded-2xl bg-cyan-600/10 border border-cyan-500/20 text-cyan-400 flex items-center justify-center mx-auto shadow-lg">
              <Sparkles className="w-7 h-7" />
            </div>

            <div>
              <h3 className="text-lg font-bold text-white tracking-tight">
                DecoHUB Meta-Chat Ativo
              </h3>
              <p className="text-xs text-slate-400 mt-2 max-w-md mx-auto leading-relaxed">
                Conectado ao <strong>Antigravity Language Server</strong> para modificar, refatorar e testar o próprio código do DecoHUB.
                Todas as alterações passam pelo <strong>Typecheck Guard</strong> em tempo real.
              </p>
            </div>

            {/* Card em Destaque: Iniciar Auto-Evolução Autônoma (Zero-Prompt) */}
            <div className="max-w-md mx-auto p-4 rounded-2xl bg-gradient-to-b from-[#0e1628] to-[#0a0f1d] border border-emerald-500/30 shadow-xl space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                    <Zap className="w-4 h-4" />
                  </div>
                  <span className="text-xs font-bold text-white">Auto-Evolução Autônoma (Zero-Prompt)</span>
                </div>
                <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                  Karpathy + Gödel
                </span>
              </div>
              <p className="text-[11px] text-slate-300 text-left leading-relaxed">
                Caça gargalos empíricos no <code className="text-emerald-300 font-mono text-[10px]">hub.db</code>, projeta e aplica a correção cirúrgica, roda testes, recompila o <code className="text-emerald-300 font-mono text-[10px]">decohub_unpacked</code> e sincroniza em produção 100% sozinho.
              </p>
              <button
                type="button"
                onClick={() => handleToggleAutopilot(1)}
                disabled={autopilotStatus?.enabled || isStartingAutopilot}
                className="w-full py-2 px-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-semibold shadow-md transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Iniciar Auto-Evolução em 1 Clique (Zero-Prompt)</span>
              </button>
            </div>

            {/* Sugestões Rápidas */}
            <div className="flex flex-wrap items-center justify-center gap-2 max-w-lg mx-auto pt-2">
              <button
                type="button"
                onClick={() => {
                  setInputText('Adicione um utilitário em `server/src/utils/mathHelper.ts` com funções seguras de clamp e roundTo.');
                  textareaRef.current?.focus();
                }}
                className="px-3 py-2 rounded-xl bg-[#0f1320] hover:bg-[#151a2d] border border-[#1e2538] hover:border-indigo-500/40 text-xs text-slate-300 hover:text-white transition-all flex items-center gap-2"
              >
                <FileCode className="w-3.5 h-3.5 text-indigo-400" />
                <span>Adicionar utilitário no backend</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setInputText('Execute uma auditoria de integridade do código e verifique se o typecheck do DecoHUB passa com 0 erros.');
                  textareaRef.current?.focus();
                }}
                className="px-3 py-2 rounded-xl bg-[#0f1320] hover:bg-[#151a2d] border border-[#1e2538] hover:border-cyan-500/40 text-xs text-slate-300 hover:text-white transition-all flex items-center gap-2"
              >
                <Shield className="w-3.5 h-3.5 text-cyan-400" />
                <span>Auditar Typecheck do DecoHUB</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setInputText('Inspecione a arquitetura das rotas em `server/src/routes.ts` e me dê um resumo técnico dos módulos.');
                  textareaRef.current?.focus();
                }}
                className="px-3 py-2 rounded-xl bg-[#0f1320] hover:bg-[#151a2d] border border-[#1e2538] hover:border-emerald-500/40 text-xs text-slate-300 hover:text-white transition-all flex items-center gap-2"
              >
                <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                <span>Inspecionar arquitetura de rotas</span>
              </button>
            </div>
          </div>
        ) : (
          messages.map((msg, index) => {
            const isUser = msg.role === 'user';
            const meta = msg.metadata;
            const msgKey = msg.id || String(index);
            const lineCount = msg.content ? msg.content.split('\n').length : 1;
            const isLongUserMsg = isUser && (msg.content.length > 280 || lineCount > 4);
            const isExpanded = Boolean(expandedLongMessages[msgKey]);

            return (
              <div
                key={msg.id || index}
                className={`flex gap-3.5 animate-message-enter ${isUser ? 'justify-end' : 'justify-start'}`}
              >
                {!isUser && (
                  <div className="w-7 h-7 rounded-lg border bg-cyan-600/20 border-cyan-500/30 text-cyan-400 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Sparkles className="w-4 h-4" />
                  </div>
                )}

                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 text-xs leading-relaxed ${
                    isUser
                      ? 'bg-indigo-600 text-white rounded-br-sm shadow-sm'
                      : 'bg-[#0f1320] border border-[#1c2236] text-slate-200 rounded-bl-sm'
                  }`}
                >
                  <div className="flex items-center justify-between gap-4 mb-1.5 text-[10px]">
                    <span className="font-semibold uppercase tracking-wider text-[9px] opacity-80">
                      {isUser ? 'Você' : 'DecoHUB Meta-Agent (Antigravity)'}
                    </span>
                    <div className="flex items-center gap-1.5 opacity-80">
                      <span>{new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      <button
                        type="button"
                        onClick={() => handleReuseMessage(msg.content)}
                        className="p-1 rounded text-slate-400 hover:text-cyan-300 hover:bg-[#1a2136] transition-colors"
                        title="Copiar / Reutilizar no Input"
                      >
                        <Copy className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteMessage(msg.id)}
                        className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-[#1a2136] transition-colors"
                        title="Remover mensagem do histórico"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>

                  {/* Renderização de anexos se presentes no usuário */}
                  {isUser && meta?.attachments && meta.attachments.length > 0 && (
                    <div className="mb-2.5 flex flex-wrap gap-1.5">
                      {meta.attachments.map((att, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-black/30 border border-white/20 text-[11px]"
                        >
                          {att.isImage ? (
                            <ImageIcon className="w-3.5 h-3.5 text-cyan-300" />
                          ) : (
                            <FileCode className="w-3.5 h-3.5 text-indigo-200" />
                          )}
                          <span className="max-w-[140px] truncate">{att.name}</span>
                          {att.size && <span className="opacity-70 text-[9px]">({formatBytes(att.size)})</span>}
                        </div>
                      ))}
                    </div>
                  )}

                  {isLongUserMsg ? (
                    <div>
                      <div className={!isExpanded ? 'max-h-20 overflow-hidden relative' : ''}>
                        {renderFormattedMetaChatContent(msg.content, isUser)}
                        {!isExpanded && (
                          <div className="absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-indigo-600 to-transparent pointer-events-none" />
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setExpandedLongMessages(prev => ({
                            ...prev,
                            [msgKey]: !prev[msgKey]
                          }));
                        }}
                        className="mt-2 flex items-center gap-1.5 text-[11px] font-medium text-indigo-100 hover:text-white bg-indigo-700/60 hover:bg-indigo-700/90 px-2.5 py-1 rounded-md transition-colors"
                      >
                        {isExpanded ? (
                          <>
                            <ChevronUp className="w-3.5 h-3.5 flex-shrink-0" />
                            <span>Recolher mensagem</span>
                          </>
                        ) : (
                          <>
                            <ChevronDown className="w-3.5 h-3.5 flex-shrink-0" />
                            <span>Ver mensagem completa ({lineCount} linhas)</span>
                          </>
                        )}
                      </button>
                    </div>
                  ) : (
                    renderFormattedMetaChatContent(msg.content, isUser)
                  )}

                  {/* Badges e Relatório de Execução Técnica */}
                  {!isUser && meta && (
                    <div className="mt-3 pt-3 border-t border-[#1c2338] space-y-2">
                      {/* Metadados do Modelo e Sessão */}
                      <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                        {meta.model && (
                          <span className="px-2 py-0.5 rounded bg-cyan-950/60 border border-cyan-500/30 text-cyan-300 font-mono">
                            {meta.model}
                          </span>
                        )}
                        {meta.reasoningMode && (
                          <span className="px-2 py-0.5 rounded bg-amber-950/60 border border-amber-500/30 text-amber-300 uppercase font-semibold text-[9px]">
                            {meta.reasoningMode} Mode
                          </span>
                        )}
                        {meta.conversationId && (
                          <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-400 font-mono text-[9px]">
                            conv: {meta.conversationId.slice(0, 8)}
                          </span>
                        )}
                      </div>

                      {meta.files_changed && meta.files_changed.length > 0 && (
                        <div>
                          <p className="text-[10px] font-semibold text-slate-400 mb-1 flex items-center gap-1.5">
                            <FileCode className="w-3 h-3 text-indigo-400" />
                            <span>Arquivos Modificados no Repositório ({meta.files_changed.length}):</span>
                          </p>
                          <div className="flex flex-wrap gap-1">
                            {meta.files_changed.map(f => (
                              <span
                                key={f}
                                className="px-2 py-0.5 rounded bg-[#161c2d] border border-[#232b42] text-[10px] font-mono text-cyan-300"
                              >
                                {f}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {meta.typecheck && (
                        <div className="flex items-center justify-between pt-1 text-[11px]">
                          <span className="text-slate-400">Typecheck Guard:</span>
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                            meta.typecheck.passed
                              ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                              : 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                          }`}>
                            {meta.typecheck.passed ? (
                              <>
                                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                                <span>Aprovado ({meta.typecheck.duration_ms}ms)</span>
                              </>
                            ) : (
                              <>
                                <AlertCircle className="w-3 h-3 text-rose-400" />
                                <span>Falha (Revertido)</span>
                              </>
                            )}
                          </span>
                        </div>
                      )}

                      {/* Checklist de Passos e Ações Executadas pelo Agente */}
                      {(meta.executedSteps || msg.executed_steps_json) && (() => {
                        let steps: MetaChatLiveStep[] = [];
                        if (Array.isArray(meta.executedSteps)) {
                          steps = meta.executedSteps;
                        } else if (msg.executed_steps_json) {
                          try { steps = JSON.parse(msg.executed_steps_json); } catch {}
                        }
                        if (!steps || steps.length === 0) return null;
                        const isExpanded = expandedMessageSteps[msg.id] ?? false;

                        return (
                          <div className="pt-2 border-t border-[#1c2338]">
                            <button
                              type="button"
                              onClick={() => setExpandedMessageSteps(prev => ({ ...prev, [msg.id]: !isExpanded }))}
                              className="flex items-center justify-between w-full text-[11px] text-slate-300 hover:text-white font-medium py-1 transition-colors"
                            >
                              <div className="flex items-center gap-1.5">
                                <CheckSquare className="w-3.5 h-3.5 text-cyan-400" />
                                <span>Ações Executadas pelo Agente ({steps.length} passos)</span>
                              </div>
                              <ChevronRight className={`w-3.5 h-3.5 text-slate-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                            </button>

                            {isExpanded && (
                              <div className="mt-2 space-y-1 font-mono text-[10px]">
                                {steps.map((st, sIdx) => {
                                  const badgeClass =
                                    st.type === 'EDIT'
                                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                                      : st.type === 'READ'
                                      ? 'bg-blue-500/15 text-blue-300 border-blue-500/30'
                                      : st.type === 'SEARCH'
                                      ? 'bg-purple-500/15 text-purple-300 border-purple-500/30'
                                      : st.type === 'GUARD'
                                      ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
                                      : 'bg-amber-500/15 text-amber-300 border-amber-500/30';

                                  return (
                                    <div
                                      key={st.id || sIdx}
                                      className="flex items-center justify-between gap-2 px-2.5 py-1 rounded-lg bg-[#07090f] border border-[#1a2034]"
                                    >
                                      <div className="flex items-center gap-2 min-w-0">
                                        <span className={`px-1.5 py-0.2 rounded text-[9px] font-bold border ${badgeClass}`}>
                                          {st.type}
                                        </span>
                                        <span className="text-slate-300 truncate">{st.details || st.target}</span>
                                      </div>
                                      {st.durationMs ? (
                                        <span className="text-[9px] text-slate-500 flex-shrink-0">{st.durationMs}ms</span>
                                      ) : (
                                        <span className="text-[9px] text-emerald-400 flex-shrink-0 font-sans">ok</span>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })()}
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

        {/* Cockpit de Telemetria e Ações em Tempo Real */}
        {isLoading && (
          <div className="rounded-2xl bg-[#0b0e18] border border-cyan-500/40 p-4 shadow-xl space-y-3.5 my-2 animate-message-enter">
            {/* Top Bar do Cockpit */}
            <div className="flex items-center justify-between gap-3 border-b border-[#1b233a] pb-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-6 h-6 rounded-lg bg-cyan-500/20 text-cyan-300 flex items-center justify-center flex-shrink-0 animate-pulse">
                  <Activity className="w-3.5 h-3.5" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-white truncate">
                      {liveActivity?.currentActionSummary || liveStatus?.currentPhase || 'Processando no DecoHUB...'}
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[9px] font-mono bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 flex-shrink-0 animate-pulse">
                      AO VIVO
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono truncate">
                    {liveStatus?.lastStep || (liveActivity?.liveSteps && liveActivity.liveSteps.length > 0 ? liveActivity.liveSteps[liveActivity.liveSteps.length - 1].details : 'Pipeline autônomo de auto-evolução')}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                <div className="flex items-center gap-1 text-[11px] font-mono tabular-nums text-slate-300 bg-[#141a2c] px-2.5 py-1 rounded-lg border border-[#232b40]">
                  <Clock className="w-3 h-3 text-cyan-400" />
                  <span>{formatElapsed(elapsedSeconds)}</span>
                </div>
                <button
                  type="button"
                  onClick={handleCancelActiveExecution}
                  disabled={isCancelling}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/40 text-rose-300 hover:text-white transition-colors text-[11px] font-medium disabled:opacity-50"
                  title="Interromper execução do Meta-Chat"
                >
                  <Square className="w-3 h-3 fill-current" />
                  <span>{isCancelling ? 'Cancelando...' : 'Interromper'}</span>
                </button>
              </div>
            </div>

            {/* Os 4 Estágios do Pipeline */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {(liveActivity?.pipelineTasks || [
                { id: 'task-inspect', label: 'Mapeamento', status: 'in_progress', details: 'Análise de contexto' },
                { id: 'task-implement', label: 'Modificação', status: 'pending', details: 'Código cirúrgico' },
                { id: 'task-verify', label: 'Typecheck', status: 'pending', details: 'tsc --noEmit' },
                { id: 'task-guard', label: 'Testes', status: 'pending', details: 'Verificação final' }
              ]).map(t => {
                const isDone = t.status === 'completed';
                const isProg = t.status === 'in_progress';
                const isFail = t.status === 'failed';
                return (
                  <div
                    key={t.id}
                    className={`p-2 rounded-xl border text-[11px] flex items-center gap-2 transition-all ${
                      isDone
                        ? 'bg-emerald-950/20 border-emerald-500/30 text-emerald-300'
                        : isProg
                        ? 'bg-cyan-950/30 border-cyan-500/50 text-cyan-200 shadow-sm shadow-cyan-900/30'
                        : isFail
                        ? 'bg-rose-950/20 border-rose-500/30 text-rose-300'
                        : 'bg-[#101422] border-[#1e2538] text-slate-400'
                    }`}
                  >
                    {isDone ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                    ) : isProg ? (
                      <Loader2 className="w-3.5 h-3.5 text-cyan-400 animate-spin flex-shrink-0" />
                    ) : isFail ? (
                      <AlertCircle className="w-3.5 h-3.5 text-rose-400 flex-shrink-0" />
                    ) : (
                      <div className="w-3.5 h-3.5 rounded-full border border-slate-600 flex-shrink-0 flex items-center justify-center">
                        <div className="w-1 h-1 rounded-full bg-slate-500" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="font-medium truncate">{t.label}</div>
                      {t.details && <div className="text-[9px] opacity-70 truncate">{t.details}</div>}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Feed de Ações em Tempo Real */}
            {liveActivity?.liveSteps && liveActivity.liveSteps.length > 0 && (
              <div className="space-y-1.5 pt-1.5 border-t border-[#1b233a]">
                <div className="flex items-center justify-between text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
                  <span>Ações Executadas em Tempo Real</span>
                  <span className="font-mono">{liveActivity.liveSteps.length} passo(s)</span>
                </div>
                <div className="max-h-36 overflow-y-auto space-y-1 pr-1 font-mono text-[10px]">
                  {liveActivity.liveSteps.map((step, idx) => {
                    const badgeClass =
                      step.type === 'EDIT'
                        ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                        : step.type === 'READ'
                        ? 'bg-blue-500/15 text-blue-300 border-blue-500/30'
                        : step.type === 'SEARCH'
                        ? 'bg-purple-500/15 text-purple-300 border-purple-500/30'
                        : step.type === 'GUARD'
                        ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
                        : 'bg-amber-500/15 text-amber-300 border-amber-500/30';

                    return (
                      <div
                        key={step.id || idx}
                        className="flex items-center justify-between gap-2 px-2.5 py-1 rounded-lg bg-[#07090f] border border-[#1a2034]"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`px-1.5 py-0.2 rounded text-[9px] font-bold border ${badgeClass}`}>
                            {step.type}
                          </span>
                          <span className="text-slate-300 truncate">{step.details || step.target}</span>
                        </div>
                        {step.durationMs ? (
                          <span className="text-[9px] text-slate-500 flex-shrink-0">{step.durationMs}ms</span>
                        ) : (
                          <span className="text-[9px] text-emerald-400 flex-shrink-0 font-sans">ok</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Arquivos Modificados no Turno */}
            {liveActivity?.filesModified && liveActivity.filesModified.length > 0 && (
              <div className="pt-2 border-t border-[#1b233a] flex items-center gap-2 flex-wrap text-[10px]">
                <span className="text-slate-400 font-medium">Arquivos modificados ({liveActivity.filesModified.length}):</span>
                {liveActivity.filesModified.map(f => (
                  <span key={f} className="px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 font-mono">
                    {f}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* 4. Rodapé com Entrada, Botão de Anexo, Drag & Drop e Cola de Prints */}
      <footer className="p-4 bg-[#0a0d15] border-t border-[#1b2033] flex-shrink-0">
        <form
          onSubmit={handleSendMessage}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className="max-w-4xl mx-auto space-y-2"
        >
          {/* Input oculto para anexar arquivos */}
          <input
            type="file"
            ref={fileInputRef}
            multiple
            onChange={e => {
              if (e.target.files) handleAddFiles(e.target.files);
              e.target.value = '';
            }}
            className="hidden"
          />

          <div className={`relative rounded-2xl bg-[#0f1320] border transition-all shadow-inner ${
            isDragging
              ? 'border-2 border-dashed border-cyan-400 bg-cyan-950/20 shadow-cyan-900/20'
              : 'border-[#1f273d] focus-within:border-cyan-500/50'
          }`}>
            {/* Chips de Anexos Pendentes */}
            {attachments.length > 0 && (
              <div className="px-3.5 pt-3 pb-1 flex flex-wrap gap-2 border-b border-[#181e30]">
                {attachments.map(att => (
                  <div
                    key={att.id}
                    className="flex items-center gap-2 pl-2 pr-1.5 py-1 rounded-xl bg-[#141a2c] border border-cyan-500/30 text-xs text-slate-200"
                  >
                    {att.previewUrl ? (
                      <img
                        src={att.previewUrl}
                        alt={att.name}
                        className="w-5 h-5 rounded object-cover flex-shrink-0 border border-slate-700"
                      />
                    ) : (
                      <FileCode className="w-4 h-4 text-cyan-400 flex-shrink-0" />
                    )}
                    <span className="max-w-[150px] truncate text-[11px] font-medium">{att.name}</span>
                    <span className="text-[9px] text-slate-400 font-mono">({formatBytes(att.size)})</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveAttachment(att.id)}
                      className="p-0.5 rounded-full hover:bg-slate-700/60 text-slate-400 hover:text-white transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Popover / Command Menu flutuante de Slash Commands */}
            <SlashCommandMenu
              isOpen={isCommandMenuOpen}
              filterText={commandFilter}
              onSelectCommand={handleSelectSlashCommand}
              onClose={() => setIsCommandMenuOpen(false)}
            />

            <textarea
              ref={textareaRef}
              rows={2}
              value={inputText}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder="Peça para o Antigravity modificar ou refatorar o código do DecoHUB... (ou use / para Slash Commands)"
              className="w-full bg-transparent px-4 py-3 text-xs text-white placeholder-slate-500 focus:outline-none resize-none font-sans"
              disabled={isLoading}
            />

            <div className="px-3 py-2 border-t border-[#181e30] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#141a2c] hover:bg-[#1a233b] border border-[#242e47] text-slate-300 hover:text-white text-xs transition-colors"
                  title="Anexar arquivo ou imagem"
                >
                  <Paperclip className="w-3.5 h-3.5 text-cyan-400" />
                  <span className="text-[11px] font-medium">+ Anexar</span>
                </button>

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
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-mono transition-colors ${
                    isCommandMenuOpen
                      ? 'bg-cyan-600/30 border-cyan-500/60 text-white'
                      : 'bg-[#141a2c] hover:bg-[#1a233b] border-[#242e47] text-cyan-300 hover:text-white'
                  }`}
                  title="Abrir menu de Slash Commands (/)"
                >
                  <Terminal className="w-3.5 h-3.5 text-cyan-400" />
                  <span className="text-[11px]">/ Skills</span>
                </button>

                <div className="hidden sm:flex items-center gap-1.5 text-[10px] text-slate-400">
                  <Shield className="w-3 h-3 text-cyan-400" />
                  <span>Typecheck Guard Ativo</span>
                </div>

                <div className="hidden md:flex items-center gap-1 text-[10px] text-slate-400 font-mono">
                  <span>Modelo:</span>
                  <span className="text-indigo-300 font-semibold">{getModelLabel(selectedModel)}</span>
                </div>
              </div>

              {isLoading ? (
                <button
                  type="button"
                  onClick={handleCancelActiveExecution}
                  disabled={isCancelling}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 active:scale-95 text-white text-xs font-semibold shadow-md transition-all disabled:opacity-60"
                  title="Cancelar execução atual do Meta-Chat"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                  <span>{isCancelling ? 'Cancelando...' : 'Cancelar'}</span>
                  <span className="font-mono tabular-nums text-[11px] ml-1 opacity-90">
                    ({formatElapsed(elapsedSeconds)})
                  </span>
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={isLoading || (!inputText.trim() && attachments.length === 0)}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold shadow-md transition-all"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Enviar</span>
                </button>
              )}
            </div>
          </div>
        </form>
      </footer>
        </div>
      </div>
    </div>
  );
};
