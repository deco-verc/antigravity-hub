import React, { useState, useEffect } from 'react';
import { FullProjectDetails, AccountProfile } from '../types';
import { api } from '../services/api';
import {
  X,
  Folder,
  Copy,
  Check,
  Calendar,
  User,
  GitBranch,
  Terminal,
  Bookmark,
  ExternalLink,
  Info,
  CheckCircle2,
  ShieldCheck,
  ShieldAlert,
  Shield,
  Zap
} from 'lucide-react';

interface DecoHubRightPanelProps {
  project: FullProjectDetails;
  activeAccount: AccountProfile | null;
  isOpen: boolean;
  onClose: () => void;
  onOpenFolder: () => void;
  onOpenTerminal: () => void;
  onOpenCheckpoint: () => void;
  onOpenGitDiff: () => void;
  onRefreshProject?: () => void;
}

export const DecoHubRightPanel: React.FC<DecoHubRightPanelProps> = ({
  project,
  activeAccount,
  isOpen,
  onClose,
  onOpenFolder,
  onOpenTerminal,
  onOpenCheckpoint,
  onOpenGitDiff,
  onRefreshProject
}) => {
  const [copied, setCopied] = useState(false);
  const [isTrusted, setIsTrusted] = useState<boolean>(project.is_trusted !== false);
  const [fullAutonomy, setFullAutonomy] = useState<boolean>(project.full_dev_autonomy !== false);
  const [isSavingAutonomy, setIsSavingAutonomy] = useState(false);
  const [autonomyEnv, setAutonomyEnv] = useState<{ packageManager: string; stack: string; testScript?: string } | null>(null);

  useEffect(() => {
    let mounted = true;
    api.getProjectAutonomy(project.id)
      .then(data => {
        if (!mounted) return;
        setIsTrusted(data.isTrusted);
        setFullAutonomy(data.fullDevAutonomy);
        if (data.environment) {
          setAutonomyEnv(data.environment);
        }
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, [project.id]);

  const handleToggleTrusted = async () => {
    const nextVal = !isTrusted;
    setIsTrusted(nextVal);
    setIsSavingAutonomy(true);
    try {
      await api.updateProjectAutonomy(project.id, { isTrusted: nextVal, fullDevAutonomy: fullAutonomy });
      onRefreshProject?.();
    } catch {}
    setIsSavingAutonomy(false);
  };

  const handleToggleFullAutonomy = async () => {
    const nextVal = !fullAutonomy;
    setFullAutonomy(nextVal);
    setIsSavingAutonomy(true);
    try {
      await api.updateProjectAutonomy(project.id, { isTrusted, fullDevAutonomy: nextVal });
      onRefreshProject?.();
    } catch {}
    setIsSavingAutonomy(false);
  };

  if (!isOpen) return null;

  const isEffectivelyAutonomous = isTrusted && fullAutonomy;
  const isEffectivelySupervised = isTrusted && !fullAutonomy;
  const isEffectivelyBlocked = !isTrusted;

  const copyPath = () => {
    navigator.clipboard.writeText(project.path);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const createdDate = project.created_at
    ? new Date(project.created_at).toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      })
    : 'Não registrado';

  return (
    <aside className="w-80 bg-[#0c0e17] border-l border-[#1b2033] flex flex-col h-full flex-shrink-0 z-20 select-none animate-fadeIn">
      {/* 1. Header do Painel */}
      <div className="p-4 border-b border-[#1b2033] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Info className="w-4 h-4 text-indigo-400" />
          <h3 className="text-xs font-bold text-white uppercase tracking-wider">
            Sobre o Projeto
          </h3>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-[#161a2b] transition-colors"
          title="Fechar painel"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* 2. Informações Gerais */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5 text-xs">
        {/* Nome & Status */}
        <div className="space-y-1.5">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            Nome do Projeto
          </span>
          <p className="text-sm font-bold text-white">{project.name}</p>
          <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-[11px] font-medium mt-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span>Ativo & Em andamento</span>
          </div>
        </div>

        {/* Objetivo */}
        <div className="space-y-1.5">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            Objetivo
          </span>
          <p className="text-xs text-slate-300 bg-[#10131f] p-3 rounded-xl border border-[#1e2333] leading-relaxed">
            "{project.objective || 'Desenvolvimento e aprimoramento contínuo mantendo contexto estruturado.'}"
          </p>
        </div>

        {/* Caminho Local */}
        <div className="space-y-1.5">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            Caminho Local no Disco
          </span>
          <div className="flex items-center gap-1.5 bg-[#10131f] p-2 rounded-xl border border-[#1e2333]">
            <span className="text-[11px] font-mono text-slate-300 truncate flex-1">
              {project.path}
            </span>
            <button
              type="button"
              onClick={copyPath}
              className="p-1 rounded hover:bg-[#1c2234] text-slate-400 hover:text-white transition-colors"
              title="Copiar caminho"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* Conta Ativa */}
        <div className="space-y-1.5">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            Conta Google Ativa
          </span>
          <div className="flex items-center gap-2.5 bg-[#10131f] p-2.5 rounded-xl border border-[#1e2333]">
            <div className="w-6 h-6 rounded-full bg-indigo-600/30 text-indigo-300 font-bold flex items-center justify-center text-[10px]">
              {activeAccount?.display_name ? activeAccount.display_name.charAt(0).toUpperCase() : 'G'}
            </div>
            <div className="truncate flex-1">
              <span className="text-xs font-semibold text-white block truncate">
                {activeAccount?.display_name || 'Conta Padrão'}
              </span>
              <span className="text-[10px] text-slate-400 block truncate font-mono">
                {activeAccount?.google_account_label || activeAccount?.profile_name || 'antigravity-local'}
              </span>
            </div>
          </div>
        </div>

        {/* Detalhes Git */}
        <div className="space-y-1.5">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            Controle de Versão (Git)
          </span>
          <div className="bg-[#10131f] p-2.5 rounded-xl border border-[#1e2333] space-y-1.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-400">Branch atual:</span>
              <span className="text-indigo-300 font-mono font-medium">
                {project.gitInfo?.branch || 'main'}
              </span>
            </div>
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-400">Status da Working Tree:</span>
              <span className={project.gitInfo?.statusSummary?.total === 0 ? 'text-emerald-400' : 'text-amber-400'}>
                {project.gitInfo?.statusSummary?.total === 0 ? 'Limpa (clean)' : 'Arquivos modificados'}
              </span>
            </div>
          </div>
        </div>

        {/* Data de Registro */}
        <div className="space-y-1">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            Data de Conexão
          </span>
          <p className="text-xs text-slate-300 flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-slate-400" />
            <span>{createdDate}</span>
          </p>
        </div>

        {/* Autonomia Operacional & Confiança */}
        <div className="space-y-2 pt-2 border-t border-[#1b2033]">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5 text-indigo-400" />
              Autonomia & Confiança
            </span>

            {/* Status Badge */}
            {isEffectivelyAutonomous && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[10px] font-semibold">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                TOTAL ATIVA
              </span>
            )}
            {isEffectivelySupervised && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[10px] font-semibold">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                SUPERVISIONADO
              </span>
            )}
            {isEffectivelyBlocked && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-500/15 border border-rose-500/30 text-rose-300 text-[10px] font-semibold">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                BLOQUEADO
              </span>
            )}
          </div>

          <div className="bg-[#10131f] p-3 rounded-xl border border-[#1e2333] space-y-2.5">
            {/* Toggle 1: Projeto Confiável */}
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={isTrusted}
                onChange={handleToggleTrusted}
                disabled={isSavingAutonomy}
                className="mt-0.5 rounded border-[#2a3147] bg-[#161a2b] text-indigo-600 focus:ring-0 focus:ring-offset-0 cursor-pointer"
              />
              <div className="text-[11px] leading-tight">
                <span className="font-semibold text-white block">Workspace Confiável</span>
                <span className="text-[10px] text-slate-400">Permite ferramentas e execução dentro do projeto</span>
              </div>
            </label>

            {/* Toggle 2: Autonomia Total */}
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={fullAutonomy}
                onChange={handleToggleFullAutonomy}
                disabled={isSavingAutonomy || !isTrusted}
                className="mt-0.5 rounded border-[#2a3147] bg-[#161a2b] text-indigo-600 focus:ring-0 focus:ring-offset-0 cursor-pointer disabled:opacity-40"
              />
              <div className="text-[11px] leading-tight">
                <span className="font-semibold text-white block">Autonomia Total (Dev)</span>
                <span className="text-[10px] text-slate-400">Instala pacotes e executa testes rotineiros sem prompt</span>
              </div>
            </label>

            {/* Environment tags */}
            {autonomyEnv && (
              <div className="pt-2 border-t border-[#181d2e] flex flex-wrap gap-1.5 text-[10px]">
                <span className="px-2 py-0.5 rounded bg-slate-800/80 text-slate-300 font-mono">
                  Stack: {autonomyEnv.stack}
                </span>
                <span className="px-2 py-0.5 rounded bg-slate-800/80 text-slate-300 font-mono">
                  Pkg: {autonomyEnv.packageManager}
                </span>
                {autonomyEnv.testScript && (
                  <span className="px-2 py-0.5 rounded bg-indigo-950/60 text-indigo-300 font-mono">
                    Testes: OK
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Ações Rápidas */}
        <div className="pt-3 border-t border-[#1b2033] space-y-2">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
            Ações Rápidas
          </span>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={onOpenFolder}
              className="flex items-center justify-center gap-1.5 p-2 rounded-xl bg-[#141824] hover:bg-[#1c2234] border border-[#23293d] text-slate-300 hover:text-white transition-colors text-[11px]"
            >
              <Folder className="w-3.5 h-3.5 text-slate-400" />
              <span>Abrir Pasta</span>
            </button>

            <button
              type="button"
              onClick={onOpenTerminal}
              className="flex items-center justify-center gap-1.5 p-2 rounded-xl bg-[#141824] hover:bg-[#1c2234] border border-[#23293d] text-slate-300 hover:text-white transition-colors text-[11px]"
            >
              <Terminal className="w-3.5 h-3.5 text-slate-400" />
              <span>Terminal</span>
            </button>

            <button
              type="button"
              onClick={onOpenGitDiff}
              className="flex items-center justify-center gap-1.5 p-2 rounded-xl bg-[#141824] hover:bg-[#1c2234] border border-[#23293d] text-slate-300 hover:text-white transition-colors text-[11px]"
            >
              <GitBranch className="w-3.5 h-3.5 text-slate-400" />
              <span>Git Diff</span>
            </button>

            <button
              type="button"
              onClick={onOpenCheckpoint}
              className="flex items-center justify-center gap-1.5 p-2 rounded-xl bg-[#141824] hover:bg-[#1c2234] border border-[#23293d] text-slate-300 hover:text-white transition-colors text-[11px]"
            >
              <Bookmark className="w-3.5 h-3.5 text-indigo-400" />
              <span>Checkpoint</span>
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
};
