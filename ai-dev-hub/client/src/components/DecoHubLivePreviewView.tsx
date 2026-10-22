import React, { useState, useEffect } from 'react';
import { Project, PreviewStatus } from '../types';
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
  Cpu
} from 'lucide-react';

interface DecoHubLivePreviewViewProps {
  project: Project;
}

export const DecoHubLivePreviewView: React.FC<DecoHubLivePreviewViewProps> = ({ project }) => {
  const [previewStatus, setPreviewStatus] = useState<PreviewStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [iframeKey, setIframeKey] = useState(1);
  const [viewport, setViewport] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchStatus = async () => {
    try {
      const st = await api.getPreviewStatus(project.id);
      setPreviewStatus(st);
    } catch {
      // Ignorar erros passageiros de status
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, previewStatus?.running ? 4000 : 8000);
    return () => clearInterval(interval);
  }, [project.id, previewStatus?.running]);

  const handleStart = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const st = await api.startPreview(project.id);
      setPreviewStatus(st);
      if (!st.running && st.error) {
        setErrorMsg(st.error);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Falha ao iniciar servidor de preview.');
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
    } catch (err: any) {
      setErrorMsg(err.message || 'Falha ao encerrar servidor.');
    } finally {
      setLoading(false);
    }
  };

  const isRunning = Boolean(previewStatus?.running && previewStatus?.url);

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
            <span>{errorMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            className="text-rose-400 hover:text-rose-200"
          >
            ✕
          </button>
        </div>
      )}

      {/* Body: Live Iframe or Empty State */}
      <div className="flex-1 overflow-auto bg-[#06080e] flex items-center justify-center p-4">
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
    </div>
  );
};
