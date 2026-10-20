import React, { useState, useEffect } from 'react';
import {
  Play,
  Square,
  ExternalLink,
  Key,
  ShieldCheck,
  RotateCw,
  Sparkles
} from 'lucide-react';
import { api } from '../services/api';
import { PreviewStatus } from '../types';
import { EnvStudioModal } from './EnvStudioModal';
import { HomologationModal } from './HomologationModal';

interface ProjectOperationsBarProps {
  projectId: string;
  projectName: string;
  onShowToast?: (type: 'success' | 'warn' | 'error', msg: string) => void;
  className?: string;
}

export const ProjectOperationsBar: React.FC<ProjectOperationsBarProps> = ({
  projectId,
  projectName,
  onShowToast,
  className = ''
}) => {
  const [previewStatus, setPreviewStatus] = useState<PreviewStatus | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [isEnvModalOpen, setIsEnvModalOpen] = useState(false);
  const [isHomologationModalOpen, setIsHomologationModalOpen] = useState(false);

  useEffect(() => {
    let mounted = true;

    const fetchStatus = async () => {
      try {
        const st = await api.getPreviewStatus(projectId);
        if (mounted) setPreviewStatus(st);
      } catch {}
    };

    fetchStatus();

    const interval = setInterval(() => {
      fetchStatus();
    }, previewStatus?.running ? 3000 : 8000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [projectId, previewStatus?.running]);

  const handleStart = async () => {
    setActionLoading(true);
    try {
      onShowToast?.('success', 'Iniciando servidor de preview do projeto...');
      const st = await api.startPreview(projectId);
      setPreviewStatus(st);
      if (st.running && st.url) {
        onShowToast?.('success', `Aplicativo rodando na porta ${st.port}!`);
        window.open(st.url, '_blank');
      } else if (st.error) {
        onShowToast?.('error', st.error || 'Falha ao iniciar preview');
      }
    } catch (err: any) {
      onShowToast?.('error', `Erro ao iniciar: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleStop = async () => {
    setActionLoading(true);
    try {
      await api.stopPreview(projectId);
      setPreviewStatus(prev => prev ? { ...prev, running: false, status: 'STOPPED', url: undefined, pid: undefined } : null);
      onShowToast?.('success', 'Servidor de preview encerrado.');
    } catch (err: any) {
      onShowToast?.('error', `Erro ao encerrar: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const isRunning = Boolean(previewStatus?.running);
  const isStarting = actionLoading;

  return (
    <>
      <div className={`flex items-center gap-2 select-none ${className}`}>
        {/* Launcher Button Group */}
        {isRunning ? (
          <div className="flex items-center gap-1 bg-[#101524] p-0.5 rounded-lg border border-[#212b45]">
            <a
              href={previewStatus?.url}
              target="_blank"
              rel="noreferrer"
              className="px-2.5 py-1 rounded-md bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 text-xs font-semibold flex items-center gap-1.5 transition-all"
              title={`Abrir em nova aba: ${previewStatus?.url}`}
            >
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              <span>Abrir App ({previewStatus?.port})</span>
              <ExternalLink className="w-3 h-3 text-emerald-400" />
            </a>
            <button
              type="button"
              onClick={handleStop}
              disabled={actionLoading}
              className="p-1.5 rounded-md hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 transition-colors"
              title="Encerrar servidor de preview"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={handleStart}
            disabled={isStarting}
            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold shadow transition-all flex items-center gap-1.5 hover:scale-[1.02]"
            title="Executar aplicação em porta local e abrir no navegador"
          >
            {isStarting ? (
              <RotateCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5 fill-current" />
            )}
            <span>{isStarting ? 'Iniciando...' : 'Rodar App'}</span>
          </button>
        )}

        {/* DOCSIMP .env Studio Button */}
        <button
          type="button"
          onClick={() => setIsEnvModalOpen(true)}
          className="px-2.5 py-1.5 rounded-lg bg-[#121626] hover:bg-[#1a2138] border border-[#232c46] text-slate-300 hover:text-white text-xs font-medium flex items-center gap-1.5 transition-colors"
          title="DOCSIMP .env Studio: Configurar API Keys e variáveis de ambiente"
        >
          <Key className="w-3.5 h-3.5 text-amber-400" />
          <span>API Keys</span>
        </button>

        {/* Homologation & Quality Badges Button */}
        <button
          type="button"
          onClick={() => setIsHomologationModalOpen(true)}
          className="px-2.5 py-1.5 rounded-lg bg-[#121626] hover:bg-[#1a2138] border border-[#232c46] text-slate-300 hover:text-white text-xs font-medium flex items-center gap-1.5 transition-colors"
          title="Ver selos de homologação (Dev, UI Anti-Slop, UX Journey e AppSec Pentest)"
        >
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          <span>Homologação</span>
        </button>
      </div>

      {/* Modals */}
      <EnvStudioModal
        isOpen={isEnvModalOpen}
        onClose={() => setIsEnvModalOpen(false)}
        projectId={projectId}
        projectName={projectName}
        onShowToast={onShowToast}
        onKeysSaved={() => {
          // Re-check preview status in case it was restarted
          api.getPreviewStatus(projectId).then(st => setPreviewStatus(st)).catch(() => {});
        }}
      />

      <HomologationModal
        isOpen={isHomologationModalOpen}
        onClose={() => setIsHomologationModalOpen(false)}
        projectId={projectId}
        projectName={projectName}
        onShowToast={onShowToast}
      />
    </>
  );
};
