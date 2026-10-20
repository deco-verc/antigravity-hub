import React, { useState, useRef, useEffect } from 'react';
import { FullProjectDetails, ChatMessage } from '../types';
import {
  Send,
  Sparkles,
  Bot,
  User,
  Terminal,
  Copy,
  Check,
  Folder,
  GitBranch,
  Search,
  ArrowRight,
  ListTodo,
  FileCode,
  History,
  LayoutDashboard,
  ExternalLink,
  Activity,
  FileText
} from 'lucide-react';

interface ChatConversationProps {
  project: FullProjectDetails;
  messages: ChatMessage[];
  activeTab: 'overview' | 'autonomous' | 'agent' | 'chat' | 'memory' | 'tasks' | 'sessions' | 'git' | 'health' | 'logs';
  onChangeTab: (tab: 'overview' | 'autonomous' | 'agent' | 'chat' | 'memory' | 'tasks' | 'sessions' | 'git' | 'health' | 'logs') => void;
  onSendMessage: (content: string) => Promise<void>;
  onOpenCheckpointModal: () => void;
  onOpenContinuityModal: () => void;
  onAnalyzeProject: () => void;
  onOpenFolder: () => void;
  onOpenTerminal: () => void;
}

export const ChatConversation: React.FC<ChatConversationProps> = ({
  project,
  messages,
  activeTab,
  onChangeTab,
  onSendMessage,
  onOpenCheckpointModal,
  onOpenContinuityModal,
  onAnalyzeProject,
  onOpenFolder,
  onOpenTerminal
}) => {
  const [inputText, setInputText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copiedPath, setCopiedPath] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (activeTab === 'chat') {
      scrollToBottom();
    }
  }, [messages, activeTab]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || isSubmitting) return;

    const text = inputText;
    setInputText('');
    setIsSubmitting(true);
    try {
      await onSendMessage(text);
    } finally {
      setIsSubmitting(false);
    }
  };

  const copyPath = () => {
    navigator.clipboard.writeText(project.path);
    setCopiedPath(true);
    setTimeout(() => setCopiedPath(false), 2000);
  };

  const copyMessageContent = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedMessageId(id);
    setTimeout(() => setCopiedMessageId(null), 2000);
  };

  return (
    <div className="flex flex-col h-full bg-[#090a0f] overflow-hidden flex-1">
      {/* Top Project Bar */}
      <header className="px-6 py-3 bg-[#0d0f17] border-b border-[#1e2233] flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-white tracking-tight">{project.name}</h2>
              {project.stack && (
                <span className="px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 text-xs font-mono font-medium">
                  {project.stack}
                </span>
              )}
              {project.gitInfo.isGitRepo && (
                <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-mono flex items-center gap-1">
                  <GitBranch className="w-3 h-3" />
                  {project.gitInfo.branch || 'main'}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 mt-0.5">
              <button
                onClick={copyPath}
                title="Clique para copiar caminho completo"
                className="flex items-center gap-1 text-[11px] text-[#7e87aa] hover:text-slate-200 transition-colors font-mono"
              >
                <Folder className="w-3 h-3 text-[#525a7f]" />
                <span className="truncate max-w-md">{project.path}</span>
                {copiedPath ? (
                  <Check className="w-3 h-3 text-emerald-400 ml-1" />
                ) : (
                  <Copy className="w-3 h-3 opacity-60 ml-0.5" />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Top Actions */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            onClick={onAnalyzeProject}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#181b28] hover:bg-[#202538] border border-[#2e344e] text-xs font-medium text-slate-300 transition-all"
            title="Escanear e analisar projeto"
          >
            <Search className="w-3.5 h-3.5 text-cyan-400" />
            <span>Analisar</span>
          </button>

          <button
            onClick={onOpenCheckpointModal}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white shadow-sm shadow-indigo-600/30 transition-all"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Checkpoint</span>
          </button>

          <button
            onClick={onOpenContinuityModal}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#181b28] hover:bg-[#202538] border border-indigo-500/40 text-xs font-semibold text-indigo-300 transition-all"
            title="Contexto pronto para nova sessão de IA"
          >
            <ArrowRight className="w-3.5 h-3.5 text-indigo-400" />
            <span>Continuar</span>
          </button>

          <button
            onClick={onOpenFolder}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#181b28] hover:bg-[#202538] border border-[#2e344e] text-xs font-medium text-slate-300 hover:text-white transition-all"
            title="Abrir no Windows Explorer"
          >
            <ExternalLink className="w-3.5 h-3.5 text-[#7e87aa]" />
            <span>Pasta</span>
          </button>

          <button
            onClick={onOpenTerminal}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#181b28] hover:bg-[#202538] border border-[#2e344e] text-xs font-medium text-slate-300 hover:text-white transition-all"
            title="Abrir terminal"
          >
            <Terminal className="w-3.5 h-3.5 text-emerald-400" />
            <span>Terminal</span>
          </button>
        </div>
      </header>

      {/* Navigation Tabs Bar */}
      <div className="px-6 bg-[#0d0f17] border-b border-[#1e2233] flex items-center gap-1 flex-shrink-0 overflow-x-auto">
        {[
          { id: 'overview', label: 'Visão Geral', icon: LayoutDashboard },
          { id: 'autonomous', label: 'Autonomous Build', icon: Sparkles },
          { id: 'agent', label: 'Agent Context (MCP)', icon: Bot },
          { id: 'chat', label: 'Conversa & Instruções', icon: Bot },
          { id: 'memory', label: 'Memória (.ai-dev-hub)', icon: FileCode },
          { id: 'tasks', label: 'Tarefas (Kanban)', icon: ListTodo },
          { id: 'sessions', label: 'Histórico de Sessões', icon: History },
          { id: 'git', label: 'Git Status', icon: GitBranch },
          { id: 'health', label: 'System Health', icon: Activity },
          { id: 'logs', label: 'Logs', icon: FileText }
        ].map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onChangeTab(tab.id as any)}
              className={`flex items-center gap-2 px-3.5 py-2.5 text-xs font-medium border-b-2 transition-all duration-150 whitespace-nowrap ${
                isActive
                  ? 'border-indigo-500 text-white font-semibold'
                  : 'border-transparent text-[#7e87aa] hover:text-slate-300 hover:border-[#2e344e]'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-indigo-400' : 'text-[#525a7f]'}`} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Main Tab Content: CHAT Area */}
      {activeTab === 'chat' && (
        <div className="flex-1 flex flex-col h-full overflow-hidden">
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-8 space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
                  <Bot className="w-6 h-6 text-indigo-400" />
                </div>
                <h3 className="text-sm font-semibold text-white">Central de Instruções: {project.name}</h3>
                <p className="text-xs text-[#7e87aa] max-w-md">
                  Envie instruções de programação, adicione tarefas com "tarefa: sua tarefa", gere checkpoints ou consulte comandos.
                </p>

                <div className="pt-2 flex flex-wrap gap-2 justify-center max-w-lg">
                  <button
                    onClick={() => onSendMessage('gerar checkpoint')}
                    className="px-2.5 py-1.5 rounded-md bg-[#121520] hover:bg-[#181b28] border border-[#1e2233] text-xs text-indigo-300 font-mono transition-colors"
                  >
                    ⚡ gerar checkpoint
                  </button>
                  <button
                    onClick={() => onSendMessage('tarefa: Validar testes e documentação')}
                    className="px-2.5 py-1.5 rounded-md bg-[#121520] hover:bg-[#181b28] border border-[#1e2233] text-xs text-amber-300 font-mono transition-colors"
                  >
                    📌 tarefa: Validar testes
                  </button>
                  <button
                    onClick={() => onSendMessage('continuar')}
                    className="px-2.5 py-1.5 rounded-md bg-[#121520] hover:bg-[#181b28] border border-[#1e2233] text-xs text-cyan-300 font-mono transition-colors"
                  >
                    📋 continuar
                  </button>
                </div>
              </div>
            ) : (
              messages.map(msg => {
                const isUser = msg.role === 'user';
                const isSystem = msg.role === 'system';

                return (
                  <div
                    key={msg.id}
                    className={`flex gap-3 max-w-4xl ${isUser ? 'ml-auto flex-row-reverse' : ''}`}
                  >
                    <div
                      className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${
                        isUser
                          ? 'bg-indigo-600 text-white'
                          : isSystem
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                          : 'bg-[#181b28] text-indigo-400 border border-[#2e344e]'
                      }`}
                    >
                      {isUser ? <User className="w-3.5 h-3.5" /> : isSystem ? <Terminal className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
                    </div>

                    <div className="group relative max-w-[85%]">
                      <div
                        className={`rounded-xl px-4 py-3 text-xs leading-relaxed ${
                          isUser
                            ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/10'
                            : isSystem
                            ? 'bg-[#121520] text-amber-200/90 border border-amber-500/20 font-mono'
                            : 'bg-[#121520] text-slate-200 border border-[#1e2233]'
                        }`}
                      >
                        <div className="whitespace-pre-wrap">{msg.content}</div>
                      </div>

                      <div className={`mt-1 flex items-center gap-2 text-[10px] text-[#525a7f] ${isUser ? 'justify-end' : 'justify-start'}`}>
                        <span>{new Date(msg.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                        <button
                          onClick={() => copyMessageContent(msg.id, msg.content)}
                          className="opacity-0 group-hover:opacity-100 hover:text-slate-300 transition-opacity"
                          title="Copiar mensagem"
                        >
                          {copiedMessageId === msg.id ? (
                            <Check className="w-3 h-3 text-emerald-400" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Bottom Prompt / Instruction Bar */}
          <div className="p-4 bg-[#0d0f17] border-t border-[#1e2233]">
            <form onSubmit={handleSubmit} className="flex gap-2 items-center">
              <div className="relative flex-1">
                <input
                  type="text"
                  value={inputText}
                  onChange={e => setInputText(e.target.value)}
                  placeholder="Digite uma instrução para o projeto (ex: 'tarefa: Criar autenticação', 'gerar checkpoint')..."
                  disabled={isSubmitting}
                  className="w-full bg-[#121520] border border-[#1e2233] focus:border-indigo-500 rounded-xl px-4 py-3 text-xs text-white placeholder-[#525a7f] focus:outline-none transition-all shadow-inner"
                />
              </div>

              <button
                type="submit"
                disabled={!inputText.trim() || isSubmitting}
                className="px-5 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold tracking-wide flex items-center gap-1.5 shadow-md shadow-indigo-600/20 active:scale-[0.98] transition-all flex-shrink-0"
              >
                <span>ENVIAR</span>
                <Send className="w-3.5 h-3.5" />
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
