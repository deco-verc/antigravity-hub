import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import { ArrowRight, Copy, Check, X, ShieldAlert, Sparkles, BookOpen } from 'lucide-react';

interface ContinuityModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  projectName: string;
}

export const ContinuityModal: React.FC<ContinuityModalProps> = ({
  isOpen,
  onClose,
  projectId,
  projectName
}) => {
  const [promptText, setPromptText] = useState('');
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (isOpen && projectId) {
      setLoading(true);
      api.getContinuityContext(projectId)
        .then(res => setPromptText(res.prompt))
        .catch(err => setPromptText(`Erro ao carregar contexto: ${err.message}`))
        .finally(() => setLoading(false));
    }
  }, [isOpen, projectId]);

  if (!isOpen) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(promptText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#0d0f17] border border-[#1e2233] w-full max-w-3xl rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="p-5 border-b border-[#1e2233] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 flex items-center justify-center">
              <ArrowRight className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Continuar Projeto — Handover para Nova Sessão de IA</h3>
              <p className="text-xs text-[#7e87aa]">Contexto completo pronto para colar no Cursor, Claude Code, Antigravity ou ChatGPT</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded-lg text-[#525a7f] hover:text-white hover:bg-[#181b28] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1">
          <div className="p-3 bg-indigo-950/20 border border-indigo-500/20 rounded-xl text-xs text-indigo-200 flex items-center gap-2.5">
            <BookOpen className="w-4 h-4 text-indigo-400 flex-shrink-0" />
            <span>
              Este texto consolida <strong>objetivo</strong>, <strong>arquitetura</strong>, <strong>decisões</strong>, <strong>últimas mudanças</strong>, <strong>tarefas</strong> e o <strong>último checkpoint</strong>. Basta colar no início do seu chat na nova IA.
            </span>
          </div>

          {loading ? (
            <div className="text-center py-12 text-xs text-[#525a7f]">Compilando contexto de continuidade...</div>
          ) : (
            <div className="relative">
              <textarea
                readOnly
                value={promptText}
                rows={16}
                className="w-full p-4 bg-[#090a0f] border border-[#1e2233] rounded-xl font-mono text-xs text-slate-200 resize-none focus:outline-none leading-relaxed select-all"
              />
            </div>
          )}

          {/* Action buttons */}
          <div className="pt-2 border-t border-[#1e2233] flex items-center justify-between">
            <span className="text-[11px] text-[#525a7f]">
              Clique no botão ao lado ou use <kbd className="px-1.5 py-0.5 rounded bg-[#181b28] border border-[#1e2233] text-[10px]">Ctrl+A</kbd> para copiar
            </span>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg bg-[#181b28] hover:bg-[#202538] text-xs text-slate-300 font-medium transition-colors"
              >
                Fechar
              </button>

              <button
                type="button"
                onClick={handleCopy}
                disabled={loading}
                className="px-5 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-md shadow-indigo-600/30 flex items-center gap-2 transition-all active:scale-[0.98]"
              >
                {copied ? (
                  <>
                    <Check className="w-4 h-4 text-emerald-300" />
                    <span>CONTEXTO COPIADO COM SUCESSO!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    <span>COPIAR CONTEXTO DE CONTINUIDADE</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
