import React, { useState } from 'react';
import { FullProjectDetails, AccountProfile } from '../types';
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
  CheckCircle2
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
}

export const DecoHubRightPanel: React.FC<DecoHubRightPanelProps> = ({
  project,
  activeAccount,
  isOpen,
  onClose,
  onOpenFolder,
  onOpenTerminal,
  onOpenCheckpoint,
  onOpenGitDiff
}) => {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

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
