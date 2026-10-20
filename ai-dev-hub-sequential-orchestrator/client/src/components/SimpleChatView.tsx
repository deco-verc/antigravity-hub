import React, { useState, useRef, useEffect } from 'react';
import { FullProjectDetails, ChatMessage, AccountProfile } from '../types';
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
  Copy
} from 'lucide-react';

interface SimpleChatViewProps {
  project: FullProjectDetails;
  messages: ChatMessage[];
  activeAccount: AccountProfile | null;
  onSendMessage: (content: string) => Promise<void>;
  onOpenCheckpointModal: () => void;
  onOpenContinuityModal: () => void;
  onAnalyzeProject: () => void;
  onOpenFolder: () => void;
  onOpenTerminal: () => void;
}

export const SimpleChatView: React.FC<SimpleChatViewProps> = ({
  project,
  messages,
  activeAccount,
  onSendMessage,
  onOpenCheckpointModal,
  onOpenContinuityModal,
  onAnalyzeProject,
  onOpenFolder,
  onOpenTerminal,
}) => {
  const [inputText, setInputText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copiedPath, setCopiedPath] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

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

  return (
    <div className="flex-1 flex flex-col h-full bg-[#090a0f] overflow-hidden">
      {/* Top Bar for Simple Mode */}
      <header className="px-6 py-3.5 bg-[#0d0f17] border-b border-[#1e2233] flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-white tracking-tight">{project.name}</h2>
              {project.gitInfo.isGitRepo && (
                <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-mono flex items-center gap-1">
                  <GitBranch className="w-3 h-3" />
                  {project.gitInfo.branch || 'main'}
                </span>
              )}
              {activeAccount && (
                <span className="px-2 py-0.5 rounded-md bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 text-xs font-medium flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  {activeAccount.display_name}
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
                <span className="truncate max-w-sm">{project.path}</span>
                {copiedPath ? (
                  <Check className="w-3 h-3 text-emerald-400 ml-1" />
                ) : (
                  <Copy className="w-3 h-3 opacity-60 ml-0.5" />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Quick Project Actions */}
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
            title="Copiar handover de continuidade"
          >
            <ArrowRight className="w-3.5 h-3.5 text-indigo-400" />
            <span>Continuar</span>
          </button>

          <button
            onClick={onOpenFolder}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#181b28] hover:bg-[#202538] border border-[#2e344e] text-xs font-medium text-slate-300 hover:text-white transition-all"
            title="Abrir no Explorer"
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

      {/* Clean Chat Conversation Stream */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-8 space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center shadow-lg shadow-indigo-500/10">
              <Bot className="w-7 h-7 text-indigo-400" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white tracking-tight">Conversa Ativa: {project.name}</h3>
              <p className="text-xs text-[#7e87aa] max-w-md mt-1">
                Envie instruções para o assistente de programação. O código, os checkpoints e a memória continuam sincronizados no disco.
              </p>
            </div>

            <div className="flex flex-wrap gap-2 justify-center max-w-lg pt-2">
              <button
                onClick={() => onSendMessage('Crie os componentes principais do projeto')}
                className="px-3 py-1.5 rounded-xl bg-[#121520] hover:bg-[#181b28] border border-[#1e2233] text-xs text-indigo-300 font-medium transition-colors"
              >
                🚀 Iniciar desenvolvimento
              </button>
              <button
                onClick={() => onSendMessage('gerar checkpoint')}
                className="px-3 py-1.5 rounded-xl bg-[#121520] hover:bg-[#181b28] border border-[#1e2233] text-xs text-indigo-300 font-medium transition-colors"
              >
                ⚡ Salvar checkpoint
              </button>
            </div>
          </div>
        ) : (
          messages.map((msg, idx) => {
            const isUser = msg.role === 'user';
            return (
              <div
                key={msg.id || idx}
                className={`flex gap-3 max-w-3xl ${isUser ? 'ml-auto flex-row-reverse' : 'mr-auto'}`}
              >
                {/* Avatar */}
                <div
                  className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${
                    isUser
                      ? 'bg-indigo-600 text-white'
                      : 'bg-[#181d2e] border border-indigo-500/20 text-indigo-400'
                  }`}
                >
                  {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                </div>

                {/* Message Body */}
                <div
                  className={`p-4 rounded-2xl text-xs leading-relaxed ${
                    isUser
                      ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20 rounded-tr-none'
                      : 'bg-[#121520] border border-[#1e2233] text-slate-200 shadow-md rounded-tl-none'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3 mb-1 text-[10px] opacity-75 font-semibold">
                    <span>{isUser ? 'Você' : `IA (${activeAccount?.display_name || 'Antigravity'})`}</span>
                    <span>{new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>

                  <div className="whitespace-pre-wrap font-sans">{msg.content}</div>

                  {!isUser && msg.content.includes('Checkpoint') && (
                    <div className="mt-2 pt-2 border-t border-[#1e2233] flex items-center gap-1.5 text-emerald-400 text-[11px] font-medium">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>✓ Estado salvo no SQLite e disco</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Bottom Input Area */}
      <footer className="p-4 bg-[#0d0f17] border-t border-[#1e2233] flex-shrink-0">
        <form onSubmit={handleSubmit} className="max-w-4xl mx-auto flex gap-2">
          <input
            type="text"
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            placeholder="Digite sua instrução de código para a IA..."
            disabled={isSubmitting}
            className="flex-1 px-4 py-3 rounded-xl bg-[#08090e] border border-[#23293d] text-xs text-white placeholder-[#525a7f] focus:outline-none focus:border-indigo-500 transition-colors"
          />
          <button
            type="submit"
            disabled={isSubmitting || !inputText.trim()}
            className="px-5 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold shadow-lg shadow-indigo-600/30 flex items-center justify-center transition-all active:scale-95"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </footer>
    </div>
  );
};
