import React, { useState, useEffect, useRef } from 'react';
import { Project, PreviewStatus, RuntimeLogsResponse } from '../types';
import { api } from '../services/api';
import {
  Play,
  Square,
  RefreshCw,
  ExternalLink,
  Monitor,
  Tablet,
  Smartphone,
  Globe,
  AlertCircle,
  CheckCircle2,
  Cpu,
  Terminal,
  Trash2,
  Database,
  Send,
  ChevronDown,
  ChevronUp,
  RotateCcw
} from 'lucide-react';

interface DecoHubLivePreviewViewProps {
  project: Project;
  onSendToChat?: (errorText: string) => void;
}

export const DecoHubLivePreviewView: React.FC<DecoHubLivePreviewViewProps> = ({ project, onSendToChat }) => {
  const [previewStatus, setPreviewStatus] = useState<PreviewStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [iframeKey, setIframeKey] = useState(1);
  const [viewport, setViewport] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Live Port Log Inspector State
  const [runtimeLogs, setRuntimeLogs] = useState<string[]>([]);
  const [lastFatalError, setLastFatalError] = useState<string | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const [isResettingDb, setIsResettingDb] = useState(false);
  const [dbResetNotice, setDbResetNotice] = useState<string | null>(null);
  const logContainerRef = useRef<HTMLDivElement | null>(null);

  const fetchStatus = async () => {
    try {
      const st = await api.getPreviewStatus(project.id);
      setPreviewStatus(st);
      if (!st.running && st.error) {
        setErrorMsg(st.error);
        setLastFatalError(st.error);
      }
    } catch {
      // Ignorar erros passageiros de status
    }
  };

  const fetchRuntimeLogs = async () => {
    try {
      const data: RuntimeLogsResponse = await api.getProjectRuntimeLogs(project.id, 200);
      if (Array.isArray(data.logs)) {
        setRuntimeLogs(data.logs);
      }
      if (data.lastFatalError) {
        setLastFatalError(data.lastFatalError);
      }
    } catch {
      // Silencioso em caso de polling falho
    }
  };

  useEffect(() => {
    fetchStatus();
    fetchRuntimeLogs();
    const interval = setInterval(() => {
      fetchStatus();
      fetchRuntimeLogs();
    }, previewStatus?.running ? 2500 : 5000);
    return () => clearInterval(interval);
  }, [project.id, previewStatus?.running]);

  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [runtimeLogs, autoScroll]);

  const handleStart = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const st = await api.startPreview(project.id);
      setPreviewStatus(st);
      if (!st.running && st.error) {
        setErrorMsg(st.error);
        setLastFatalError(st.error);
        setIsDrawerOpen(true);
      }
      await fetchRuntimeLogs();
    } catch (err: any) {
      setErrorMsg(err.message || 'Falha ao iniciar servidor de preview.');
      setIsDrawerOpen(true);
    } finally {
      setLoading(false);
    }
  };

  const handleStop = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      await api.stopPreview(project.id);
      setPreviewStatus(prev => prev ? { ...prev, running: false, status: 'STOPPED', url: undefined, pid: undefined } : null);
      await fetchRuntimeLogs();
    } catch (err: any) {
      setErrorMsg(err.message || 'Falha ao encerrar servidor.');
    } finally {
      setLoading(false);
    }
  };

  const handleClearLogs = async () => {
    try {
      await api.clearProjectRuntimeLogs(project.id);
      setRuntimeLogs([]);
      setLastFatalError(null);
    } catch (err: any) {
      setErrorMsg(err.message || 'Falha ao limpar logs da porta.');
    }
  };

  const handleResetDb = async () => {
    if (!confirm('Deseja realmente limpar/excluir todos os bancos de dados SQLite (.db, .sqlite) do projeto para recriar o schema limpo?')) return;
    setIsResettingDb(true);
    try {
      const res = await api.resetProjectDatabase(project.id);
      setDbResetNotice(res.message);
      setTimeout(() => setDbResetNotice(null), 5000);
      await fetchRuntimeLogs();
    } catch (err: any) {
      setErrorMsg(err.message || 'Falha ao resetar banco do projeto.');
    } finally {
      setIsResettingDb(false);
    }
  };

  const handleSendErrorToChat = () => {
    const errorTrace = lastFatalError || runtimeLogs.filter(l => l.includes('[STDERR]') || l.includes('[ERROR]')).slice(-10).join('\n') || errorMsg || 'O servidor encerrou inesperadamente.';
    if (onSendToChat) {
      onSendToChat(errorTrace);
    } else {
      window.dispatchEvent(new CustomEvent('decohub-fill-chat-input', {
        detail: {
          text: `[ERRO NA PORTA DO APP] Detectei o seguinte erro na execução do aplicativo e preciso que você diagnostique e corrija:\n\n\`\`\`text\n${errorTrace}\n\`\`\``
        }
      }));
    }
  };

  const isRunning = Boolean(previewStatus?.running && previewStatus?.url);
  const errorLinesCount = runtimeLogs.filter(l => l.includes('[STDERR]') || l.includes('[ERROR]') || l.includes('exit')).length;

  // Viewport container width constraints
  const getViewportContainerClass = () => {
    switch (viewport) {
      case 'mobile':
        return 'w-[375px] h-[667px] shadow-2xl rounded-2xl border-4 border-slate-700 overflow-hidden';
      case 'tablet':
        return 'w-[768px] h-[900px] shadow-2xl rounded-xl border-4 border-slate-700 overflow-hidden';
      case 'desktop':
      default:
        return 'w-full h-full border-0';
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#0a0d15] text-slate-100 overflow-hidden">
      {/* Top Preview Control Bar */}
      <div className="h-12 border-b border-[#1b2033] bg-[#0c101d] px-4 flex items-center justify-between flex-shrink-0">
        {/* Left: Status & URL */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                isRunning ? 'bg-emerald-500 animate-pulse' : 'bg-slate-600'
              }`}
            />
            <span className="text-xs font-semibold text-slate-300">
              {isRunning ? 'Online' : 'Parado'}
            </span>
          </div>

          {isRunning && previewStatus?.url ? (
            <div className="flex items-center gap-2 bg-[#121626] border border-[#232942] rounded-lg px-2.5 py-1 text-xs font-mono text-indigo-300">
              <Globe className="w-3.5 h-3.5 text-indigo-400" />
              <span>{previewStatus.url}</span>
              {previewStatus.port && (
                <span className="text-[10px] bg-indigo-950 text-indigo-400 px-1 rounded border border-indigo-800/40">
                  :{previewStatus.port}
                </span>
              )}
            </div>
          ) : (
            <span className="text-xs text-slate-500 italic">
              Servidor local desligado
            </span>
          )}
        </div>

        {/* Center: Viewport Switcher */}
        {isRunning && (
          <div className="flex items-center gap-1 bg-[#121626] p-1 rounded-lg border border-[#232942]">
            <button
              type="button"
              onClick={() => setViewport('desktop')}
              title="Visualização Desktop (100%)"
              className={`px-2.5 py-1 text-xs rounded font-medium flex items-center gap-1.5 transition-all ${
                viewport === 'desktop'
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Monitor className="w-3.5 h-3.5" />
              <span>Desktop</span>
            </button>
            <button
              type="button"
              onClick={() => setViewport('tablet')}
              title="Visualização Tablet (768px)"
              className={`px-2.5 py-1 text-xs rounded font-medium flex items-center gap-1.5 transition-all ${
                viewport === 'tablet'
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Tablet className="w-3.5 h-3.5" />
              <span>Tablet</span>
            </button>
            <button
              type="button"
              onClick={() => setViewport('mobile')}
              title="Visualização Mobile (375px)"
              className={`px-2.5 py-1 text-xs rounded font-medium flex items-center gap-1.5 transition-all ${
                viewport === 'mobile'
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Smartphone className="w-3.5 h-3.5" />
              <span>Mobile</span>
            </button>
          </div>
        )}

        {/* Right: Actions */}
        <div className="flex items-center gap-2">
          {isRunning ? (
            <>
              <button
                type="button"
                onClick={() => setIframeKey(k => k + 1)}
                title="Recarregar tela da aplicação"
                className="px-2.5 py-1.5 rounded-lg border border-[#232942] bg-[#121626] text-slate-300 hover:text-white hover:border-slate-600 text-xs flex items-center gap-1.5 transition-all"
              >
                <RefreshCw className="w-3.5 h-3.5 text-indigo-400" />
                <span>Recarregar</span>
              </button>

              <a
                href={previewStatus?.url}
                target="_blank"
                rel="noreferrer"
                title="Abrir em aba externa do navegador"
                className="px-2.5 py-1.5 rounded-lg border border-[#232942] bg-[#121626] text-slate-300 hover:text-white hover:border-slate-600 text-xs flex items-center gap-1.5 transition-all"
              >
                <ExternalLink className="w-3.5 h-3.5 text-indigo-400" />
                <span>Abrir Aba</span>
              </a>

              <button
                type="button"
                onClick={handleStop}
                disabled={loading}
                title="Encerrar servidor de preview"
                className="px-2.5 py-1.5 rounded-lg border border-rose-900/50 bg-rose-950/30 text-rose-300 hover:bg-rose-900/40 text-xs flex items-center gap-1.5 transition-all disabled:opacity-50"
              >
                <Square className="w-3.5 h-3.5 text-rose-400" />
                <span>Parar</span>
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={handleStart}
              disabled={loading}
              title="Iniciar servidor do aplicativo"
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow-lg shadow-emerald-950/40 transition-all disabled:opacity-50"
            >
              {loading ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-white" />
                  <span>Iniciando...</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5 text-white" />
                  <span>Iniciar App Preview</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Error alert if any */}
      {errorMsg && (
        <div className="bg-rose-950/40 border-b border-rose-900/50 px-4 py-2 flex items-center justify-between text-xs text-rose-300 flex-shrink-0">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400" />
            <span className="font-mono text-[11px] truncate">{errorMsg}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSendErrorToChat}
              className="px-2 py-0.5 rounded bg-rose-800/60 hover:bg-rose-700 text-white text-[10px] font-semibold flex items-center gap-1 transition-colors"
            >
              <Send className="w-3 h-3" />
              <span>Enviar para Chat</span>
            </button>
            <button
              type="button"
              onClick={() => setErrorMsg(null)}
              className="text-rose-400 hover:text-rose-200"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* DB Reset Notice */}
      {dbResetNotice && (
        <div className="bg-emerald-950/40 border-b border-emerald-900/50 px-4 py-2 flex items-center justify-between text-xs text-emerald-300 flex-shrink-0">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>{dbResetNotice}</span>
          </div>
        </div>
      )}

      {/* Body: Live Iframe or Empty State */}
      <div className="flex-1 overflow-auto bg-[#06080e] flex items-center justify-center p-4 min-h-0">
        {isRunning && previewStatus?.url ? (
          <div
            className={`transition-all duration-300 flex items-center justify-center ${getViewportContainerClass()} bg-white`}
          >
            <iframe
              key={iframeKey}
              src={previewStatus.url}
              title={`Preview: ${project.name}`}
              className="w-full h-full border-0 bg-white"
              sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
            />
          </div>
        ) : (
          <div className="max-w-md w-full text-center p-8 bg-[#0c101d] rounded-2xl border border-[#1b2033] shadow-xl">
            <div className="w-16 h-16 rounded-2xl bg-indigo-950/50 border border-indigo-800/40 flex items-center justify-center mx-auto mb-4 text-indigo-400">
              <Globe className="w-8 h-8" />
            </div>
            <h3 className="text-base font-semibold text-white mb-2">
              Live App Preview
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed mb-6">
              Inicie o servidor local do projeto <strong className="text-slate-200">{project.name}</strong> para visualizar a interface em tempo real dentro do DecoHUB sem precisar alternar de janela.
            </p>
            <button
              type="button"
              onClick={handleStart}
              disabled={loading}
              className="w-full py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs flex items-center justify-center gap-2 shadow-lg shadow-indigo-950/50 transition-all disabled:opacity-50"
            >
              {loading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin text-white" />
                  <span>Subindo servidor na porta livre...</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 text-white" />
                  <span>Iniciar Servidor e Carregar Tela</span>
                </>
              )}
            </button>
            <div className="mt-4 flex items-center justify-center gap-2 text-[11px] text-slate-500">
              <Cpu className="w-3.5 h-3.5" />
              <span>Detecta automaticamente scripts Vite, Express, Next ou estáticos SPA</span>
            </div>
          </div>
        )}
      </div>

      {/* PILAR 1: Gaveta / Painel de Console em Tempo Real ("Logs da Porta & Erros") */}
      <div className={`border-t border-[#1b2033] bg-[#070a12] flex flex-col transition-all duration-200 flex-shrink-0 ${isDrawerOpen ? 'h-52' : 'h-9'}`}>
        {/* Drawer Header */}
        <div className="h-9 px-4 bg-[#0a0d17] border-b border-[#191f33] flex items-center justify-between select-none">
          <div className="flex items-center gap-2.5 cursor-pointer" onClick={() => setIsDrawerOpen(prev => !prev)}>
            <Terminal className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-xs font-semibold text-slate-200">Logs da Porta & Erros</span>
            {previewStatus?.port && (
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-cyan-950 text-cyan-300 border border-cyan-800/40">
                Porta {previewStatus.port}
              </span>
            )}
            {errorLinesCount > 0 ? (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/40 animate-pulse">
                {errorLinesCount} erro(s)
              </span>
            ) : (
              <span className="text-[10px] font-mono text-slate-500">
                {runtimeLogs.length} linha(s)
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 text-xs">
            {/* Auto-Scroll Checkbox */}
            <label className="flex items-center gap-1.5 text-[11px] text-slate-400 cursor-pointer mr-1">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={e => setAutoScroll(e.target.checked)}
                className="rounded border-slate-700 bg-slate-900 text-indigo-500 w-3 h-3"
              />
              <span>Auto-scroll</span>
            </label>

            {/* Enviar Erro para o Chat Corrigir */}
            {(errorLinesCount > 0 || lastFatalError) && (
              <button
                type="button"
                onClick={handleSendErrorToChat}
                className="px-2 py-1 rounded-md bg-rose-600 hover:bg-rose-500 text-white text-[10px] font-bold flex items-center gap-1 shadow-sm transition-colors cursor-pointer"
                title="Copiar stack trace e enviar ao Chat do Projeto para correção cirúrgica"
              >
                <Send className="w-3 h-3" />
                <span>Enviar Erro para o Chat Corrigir</span>
              </button>
            )}

            {/* Resetar Banco */}
            <button
              type="button"
              onClick={handleResetDb}
              disabled={isResettingDb}
              className="px-2 py-1 rounded-md bg-[#131828] hover:bg-[#1a2238] border border-[#232b45] text-slate-300 text-[10px] font-medium flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-50"
              title="Excluir arquivos SQLite (.db) para recriar o schema limpo"
            >
              <Database className="w-3 h-3 text-amber-400" />
              <span>{isResettingDb ? 'Limpando...' : 'Zerar Banco'}</span>
            </button>

            {/* Limpar Logs */}
            <button
              type="button"
              onClick={handleClearLogs}
              className="p-1 rounded-md text-slate-400 hover:text-slate-200 hover:bg-[#131828] transition-colors"
              title="Limpar buffer de logs da porta"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>

            {/* Toggle Expand / Collapse */}
            <button
              type="button"
              onClick={() => setIsDrawerOpen(prev => !prev)}
              className="p-1 rounded-md text-slate-400 hover:text-slate-200 hover:bg-[#131828] transition-colors"
              title={isDrawerOpen ? 'Recolher console de logs' : 'Expandir console de logs'}
            >
              {isDrawerOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* Drawer Console Output */}
        {isDrawerOpen && (
          <div
            ref={logContainerRef}
            className="flex-1 p-2.5 overflow-y-auto font-mono text-[11px] leading-relaxed bg-[#05070d] space-y-0.5 select-text"
          >
            {runtimeLogs.length === 0 ? (
              <div className="text-slate-500 italic py-4 text-center">
                Nenhum log emitido na porta até o momento. Inicie o aplicativo para capturar stdout/stderr em tempo real.
              </div>
            ) : (
              runtimeLogs.map((logLine, idx) => {
                const isStderr = logLine.includes('[STDERR]') || logLine.includes('[ERROR]') || logLine.includes('Error:');
                const isExit = logLine.includes('[EXIT]') || logLine.includes('(exit)');
                const isInfo = logLine.includes('[INFO]') || logLine.includes('[DecoHUB Launcher]');

                let lineClass = 'text-slate-300';
                if (isStderr) {
                  lineClass = 'text-rose-300 bg-rose-950/25 px-1 rounded border-l-2 border-rose-500';
                } else if (isExit) {
                  lineClass = 'text-amber-300 bg-amber-950/20 px-1 rounded border-l-2 border-amber-500';
                } else if (isInfo) {
                  lineClass = 'text-cyan-400';
                }

                return (
                  <div key={idx} className={`whitespace-pre-wrap break-all ${lineClass}`}>
                    {logLine}
                  </div>
                );
              })
            )}

            {lastFatalError && !isRunning && (
              <div className="mt-2 p-2 rounded bg-rose-950/50 border border-rose-700/60 text-rose-200">
                <div className="font-bold flex items-center justify-between text-xs mb-1">
                  <span className="flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
                    Stack Trace de Encerramento:
                  </span>
                  <button
                    type="button"
                    onClick={handleSendErrorToChat}
                    className="px-2 py-0.5 rounded bg-rose-700 hover:bg-rose-600 text-white text-[10px] font-semibold transition-colors"
                  >
                    Enviar ao Chat Corrigir
                  </button>
                </div>
                <div className="text-[11px] font-mono break-all">{lastFatalError}</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
