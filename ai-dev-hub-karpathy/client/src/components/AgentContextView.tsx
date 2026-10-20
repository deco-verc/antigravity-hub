import React, { useState, useEffect } from 'react';
import { FullProjectDetails } from '../types';
import { api } from '../services/api';
import {
  Sparkles,
  Bot,
  Copy,
  Check,
  Play,
  Square,
  RefreshCw,
  Search,
  FileText,
  Zap,
  CheckCircle2,
  Clock,
  GitBranch,
  ShieldCheck,
  Share2
} from 'lucide-react';

interface AgentContextViewProps {
  project: FullProjectDetails;
  onRefreshProject: () => void;
  onShowToast: (type: 'success' | 'error' | 'info' | 'warn', message: string) => void;
}

export const AgentContextView: React.FC<AgentContextViewProps> = ({
  project,
  onRefreshProject,
  onShowToast
}) => {
  const [contextMode, setContextMode] = useState<'compact' | 'normal' | 'full'>('normal');
  const [contextText, setContextText] = useState<string>('');
  const [loadingContext, setLoadingContext] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  // Active Session State
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeSessionNumber, setActiveSessionNumber] = useState<number | null>(null);
  const [activeAgentName, setActiveAgentName] = useState<string>('Antigravity Agent');
  const [isStartModalOpen, setIsStartModalOpen] = useState(false);
  const [isEndModalOpen, setIsEndModalOpen] = useState(false);
  const [agentInputName, setAgentInputName] = useState('Antigravity Agent');

  // End Session form
  const [endImplemented, setEndImplemented] = useState('');
  const [endFiles, setEndFiles] = useState('');
  const [endNextTask, setEndNextTask] = useState('');

  // Handover modal/text
  const [handoverText, setHandoverText] = useState<string | null>(null);
  const [isHandoverModalOpen, setIsHandoverModalOpen] = useState(false);
  const [copiedHandover, setCopiedHandover] = useState(false);

  // Search Context
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);

  // MCP Status
  const [mcpStatus, setMcpStatus] = useState<any>(null);

  useEffect(() => {
    loadContext();
    loadMcpStatus();
  }, [project.id, contextMode]);

  const loadContext = async () => {
    setLoadingContext(true);
    try {
      const res = await api.callMcpTool('get_project_context', {
        project: project.id,
        mode: contextMode
      });
      setContextText(typeof res === 'string' ? res : JSON.stringify(res, null, 2));
    } catch (err: any) {
      console.error(err);
      onShowToast('error', `Falha ao carregar contexto: ${err.message}`);
    } finally {
      setLoadingContext(false);
    }
  };

  const loadMcpStatus = async () => {
    try {
      const status = await api.getMcpStatus();
      setMcpStatus(status);
    } catch {
      // ignore
    }
  };

  const handleCopyContext = () => {
    navigator.clipboard.writeText(contextText);
    setCopied(true);
    onShowToast('success', 'Contexto copiado para a área de transferência!');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleStartSession = async () => {
    try {
      const res = await api.callMcpTool('start_session', {
        project: project.id,
        agent_name: agentInputName
      });
      setActiveSessionId(res.sessionId || res.session_id);
      setActiveSessionNumber(res.sessionNumber || res.session_number);
      setActiveAgentName(agentInputName);
      setIsStartModalOpen(false);
      onShowToast('success', `Sessão #${res.sessionNumber || res.session_number} iniciada com sucesso via MCP!`);
      await loadContext();
      onRefreshProject();
    } catch (err: any) {
      onShowToast('error', `Erro ao iniciar sessão: ${err.message}`);
    }
  };

  const handleEndSession = async () => {
    if (!activeSessionId) return;
    try {
      const impl = endImplemented.split('\n').map(s => s.trim()).filter(Boolean);
      const files = endFiles.split('\n').map(s => s.trim()).filter(Boolean);

      const res = await api.callMcpTool('end_session', {
        session_id: activeSessionId,
        implemented: impl.length > 0 ? impl : ['Rotinas da sessão finalizadas'],
        files_changed: files,
        next_task: endNextTask.trim() || undefined
      });

      setActiveSessionId(null);
      setActiveSessionNumber(null);
      setIsEndModalOpen(false);
      setEndImplemented('');
      setEndFiles('');
      setEndNextTask('');
      onShowToast('success', `Sessão #${res.sessionNumber || res.session_number} encerrada e sincronizada!`);
      await loadContext();
      onRefreshProject();
    } catch (err: any) {
      onShowToast('error', `Erro ao encerrar sessão: ${err.message}`);
    }
  };

  const handleSmartCheckpoint = async () => {
    try {
      const res = await api.callMcpTool('smart_checkpoint', { project: project.id });
      onShowToast('success', `Smart Checkpoint #${res.sessionNumber} gerado e sincronizado!`);
      await loadContext();
      onRefreshProject();
    } catch (err: any) {
      onShowToast('error', `Erro ao gerar Smart Checkpoint: ${err.message}`);
    }
  };

  const handleGenerateHandover = async () => {
    try {
      const res = await api.callMcpTool('generate_handover', { project: project.id });
      setHandoverText(typeof res === 'string' ? res : JSON.stringify(res, null, 2));
      setIsHandoverModalOpen(true);
      onShowToast('success', 'Handover Prompt gerado com sucesso!');
    } catch (err: any) {
      onShowToast('error', `Erro ao gerar Handover: ${err.message}`);
    }
  };

  const handleSearchContext = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const results = await api.callMcpTool('search_project_context', {
        project: project.id,
        query: searchQuery.trim()
      });
      setSearchResults(Array.isArray(results) ? results : []);
    } catch (err: any) {
      onShowToast('error', `Erro na busca de contexto: ${err.message}`);
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#090a0f] p-6 overflow-y-auto space-y-6">
      {/* Top Banner & MCP Status */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#1e2233] pb-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 flex items-center justify-center">
              <Bot className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white uppercase tracking-wider flex items-center gap-2">
                Agent Context & MCP Memory Layer
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                  {mcpStatus?.toolsCount || 23} Tools Online
                </span>
              </h2>
              <p className="text-xs text-[#7e87aa]">
                Camada de contexto contínuo para agentes de IA (Cursor, Antigravity, Claude Code, ChatGPT)
              </p>
            </div>
          </div>
        </div>

        {/* Global Action Buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          {!activeSessionId ? (
            <button
              onClick={() => setIsStartModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-md shadow-emerald-600/20 active:scale-95 transition-all"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>INICIAR SESSÃO</span>
            </button>
          ) : (
            <button
              onClick={() => setIsEndModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow-md shadow-rose-600/20 active:scale-95 transition-all"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              <span>FINALIZAR SESSÃO (#{activeSessionNumber})</span>
            </button>
          )}

          <button
            onClick={handleSmartCheckpoint}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#181b28] hover:bg-[#202538] border border-indigo-500/30 text-indigo-300 text-xs font-semibold transition-all"
            title="Gera checkpoint automático usando diffs reais do Git e tarefas"
          >
            <Zap className="w-3.5 h-3.5 text-indigo-400" />
            <span>Smart Checkpoint</span>
          </button>

          <button
            onClick={handleGenerateHandover}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#181b28] hover:bg-[#202538] border border-cyan-500/30 text-cyan-300 text-xs font-semibold transition-all"
            title="Gera prompt padronizado para passar para o próximo agente"
          >
            <Share2 className="w-3.5 h-3.5 text-cyan-400" />
            <span>Handover Prompt</span>
          </button>
        </div>
      </div>

      {/* Active Session Card (if active) */}
      {activeSessionId && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="w-3 h-3 rounded-full bg-emerald-400 animate-pulse" />
            <div>
              <div className="text-xs font-bold text-white flex items-center gap-2">
                <span>Sessão #{activeSessionNumber} Ativa</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-black/40 text-emerald-300">
                  Agente: {activeAgentName}
                </span>
              </div>
              <p className="text-[11px] text-[#7e87aa] mt-0.5 font-mono">
                ID: {activeSessionId}
              </p>
            </div>
          </div>

          <button
            onClick={() => setIsEndModalOpen(true)}
            className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg shadow-sm"
          >
            Concluir & Arquivar
          </button>
        </div>
      )}

      {/* Context Viewer & Controls */}
      <div className="bg-[#0d0f17] border border-[#1e2233] rounded-2xl p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <span className="text-xs font-bold text-white uppercase tracking-wider">Visualização do Contexto LLM</span>
            {/* Mode Selector */}
            <div className="flex items-center bg-[#121520] p-1 rounded-lg border border-[#1e2233] text-xs font-medium">
              {(['compact', 'normal', 'full'] as const).map(mode => (
                <button
                  key={mode}
                  onClick={() => setContextMode(mode)}
                  className={`px-3 py-1 rounded-md capitalize transition-all ${
                    contextMode === mode
                      ? 'bg-indigo-600 text-white font-bold shadow-sm'
                      : 'text-[#7e87aa] hover:text-slate-200'
                  }`}
                >
                  {mode === 'compact' ? 'Compact (Rápido)' : mode === 'normal' ? 'Normal (Padrão)' : 'Full (Completo)'}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={loadContext}
              disabled={loadingContext}
              className="p-1.5 rounded-lg bg-[#181b28] hover:bg-[#202538] text-slate-300 border border-[#2e344e] transition-colors"
              title="Recarregar Contexto"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingContext ? 'animate-spin' : ''}`} />
            </button>

            <button
              onClick={handleCopyContext}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-md shadow-indigo-600/30 transition-all active:scale-95"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-300" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'COPIADO!' : 'COPIAR CONTEXTO'}</span>
            </button>
          </div>
        </div>

        {/* Textarea preview */}
        <div className="relative">
          <textarea
            readOnly
            value={loadingContext ? 'Carregando contexto compilado...' : contextText}
            rows={12}
            className="w-full bg-[#121520] border border-[#1e2233] rounded-xl p-4 text-xs font-mono text-slate-200 focus:outline-none resize-none leading-relaxed"
          />
          <div className="absolute bottom-3 right-4 text-[10px] font-mono text-[#525a7f] bg-[#0d0f17]/80 px-2 py-0.5 rounded border border-[#1e2233]">
            {contextText.length} caracteres (~{Math.round(contextText.length / 4)} tokens)
          </div>
        </div>
      </div>

      {/* Context Search */}
      <div className="bg-[#0d0f17] border border-[#1e2233] rounded-2xl p-5 shadow-sm space-y-4">
        <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
          <Search className="w-3.5 h-3.5 text-cyan-400" />
          <span>Busca Inteligente na Memória do Projeto</span>
        </h3>

        <form onSubmit={handleSearchContext} className="flex gap-2">
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Pesquise decisões, tarefas, palavras-chave ou componentes (ex: 'sqlite', 'audio', 'decisão')..."
            className="flex-1 bg-[#121520] border border-[#1e2233] rounded-xl px-4 py-2 text-xs text-white placeholder-[#525a7f] focus:outline-none focus:border-indigo-500"
          />
          <button
            type="submit"
            disabled={searching || !searchQuery.trim()}
            className="px-4 py-2 bg-[#181b28] hover:bg-[#202538] border border-[#2e344e] text-xs font-semibold text-slate-200 rounded-xl transition-all"
          >
            {searching ? 'Buscando...' : 'Buscar'}
          </button>
        </form>

        {searchResults.length > 0 && (
          <div className="space-y-2 pt-2">
            {searchResults.map((res, i) => (
              <div key={i} className="p-3 bg-[#121520] border border-[#1e2233] rounded-xl text-xs space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-indigo-300 font-mono">{res.title}</span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-black/40 text-[#7e87aa] uppercase">
                    {res.source}
                  </span>
                </div>
                <p className="text-slate-300 font-mono text-[11px] whitespace-pre-wrap">{res.excerpt}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Handover Modal */}
      {isHandoverModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-[#0d0f17] border border-[#1e2233] rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl">
            <div className="px-6 py-4 border-b border-[#1e2233] flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Share2 className="w-4 h-4 text-cyan-400" />
                <span>Handover Prompt para Nova Sessão de IA</span>
              </h3>
              <button
                onClick={() => setIsHandoverModalOpen(false)}
                className="text-[#7e87aa] hover:text-white text-xs font-mono"
              >
                ✕ Fechar
              </button>
            </div>

            <div className="p-6 flex-1 overflow-y-auto space-y-3">
              <p className="text-xs text-[#7e87aa]">
                Copie este prompt e cole no início da conversa com o novo modelo ou agente (Cursor, Claude, Antigravity, ChatGPT).
              </p>
              <textarea
                readOnly
                value={handoverText || ''}
                rows={14}
                className="w-full bg-[#121520] border border-[#1e2233] rounded-xl p-4 text-xs font-mono text-slate-200 focus:outline-none resize-none leading-relaxed"
              />
            </div>

            <div className="px-6 py-4 border-t border-[#1e2233] flex justify-end gap-2 bg-[#090a0f]">
              <button
                onClick={() => setIsHandoverModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-[#181b28] hover:bg-[#202538] text-xs text-slate-300 font-semibold"
              >
                Fechar
              </button>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(handoverText || '');
                  setCopiedHandover(true);
                  setTimeout(() => setCopiedHandover(false), 2000);
                  onShowToast('success', 'Handover copiado!');
                }}
                className="px-5 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-xs text-white font-bold flex items-center gap-1.5 shadow-md shadow-cyan-600/30"
              >
                {copiedHandover ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedHandover ? 'COPIADO!' : 'COPIAR HANDOVER'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Start Session Modal */}
      {isStartModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-[#0d0f17] border border-[#1e2233] rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Play className="w-4 h-4 text-emerald-400 fill-current" />
              <span>Iniciar Sessão de Agente</span>
            </h3>
            <p className="text-xs text-[#7e87aa]">
              A sessão capturará o estado inicial do Git HEAD, tarefas em andamento e gerará um session_id auditável.
            </p>

            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-300">Nome do Agente ou Modelo</label>
              <input
                type="text"
                value={agentInputName}
                onChange={e => setAgentInputName(e.target.value)}
                placeholder="Ex: Antigravity, Cursor, Claude Code"
                className="w-full bg-[#121520] border border-[#1e2233] rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setIsStartModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-[#181b28] hover:bg-[#202538] text-xs text-slate-300 font-semibold"
              >
                Cancelar
              </button>
              <button
                onClick={handleStartSession}
                className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs text-white font-bold shadow-md shadow-emerald-600/30"
              >
                INICIAR AGORA
              </button>
            </div>
          </div>
        </div>
      )}

      {/* End Session Modal */}
      {isEndModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-[#0d0f17] border border-[#1e2233] rounded-2xl w-full max-w-lg p-6 space-y-4 shadow-2xl">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Square className="w-4 h-4 text-rose-400 fill-current" />
              <span>Finalizar Sessão de Agente</span>
            </h3>
            <p className="text-xs text-[#7e87aa]">
              Finaliza a sessão ativa, atualizando atomicamente <code>changes.md</code>, <code>tasks.md</code> e o SQLite.
            </p>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-300">Tarefas Concluídas (1 por linha)</label>
                <textarea
                  value={endImplemented}
                  onChange={e => setEndImplemented(e.target.value)}
                  placeholder="Ex: Implementar rotas MCP&#10;Criar teste automatizado"
                  rows={3}
                  className="w-full bg-[#121520] border border-[#1e2233] rounded-xl p-3 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-slate-300">Arquivos Alterados (1 por linha)</label>
                <textarea
                  value={endFiles}
                  onChange={e => setEndFiles(e.target.value)}
                  placeholder="Ex: server/src/routes.ts&#10;mcp-stdio.js"
                  rows={2}
                  className="w-full bg-[#121520] border border-[#1e2233] rounded-xl p-3 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-slate-300">Próximo Passo Recomendado</label>
                <input
                  type="text"
                  value={endNextTask}
                  onChange={e => setEndNextTask(e.target.value)}
                  placeholder="Ex: Executar auditoria visual e testes no navegador"
                  className="w-full bg-[#121520] border border-[#1e2233] rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setIsEndModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-[#181b28] hover:bg-[#202538] text-xs text-slate-300 font-semibold"
              >
                Cancelar
              </button>
              <button
                onClick={handleEndSession}
                className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-xs text-white font-bold shadow-md shadow-rose-600/30"
              >
                FINALIZAR E GRAVAR
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
