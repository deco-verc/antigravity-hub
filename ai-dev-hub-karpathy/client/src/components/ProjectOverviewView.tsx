import React, { useState } from 'react';
import { FullProjectDetails } from '../types';
import {
  Folder,
  Layers,
  GitBranch,
  GitCommit,
  FileDiff,
  Sparkles,
  ArrowRight,
  Search,
  ExternalLink,
  Terminal,
  Clock,
  Target,
  ListTodo,
  CheckCircle2,
  AlertTriangle,
  Copy,
  Check,
  Calendar,
  FileCode
} from 'lucide-react';

interface ProjectOverviewViewProps {
  project: FullProjectDetails;
  onAnalyze: () => void;
  onContinue: () => void;
  onCheckpoint: () => void;
  onOpenFolder: () => void;
  onOpenTerminal: () => void;
  onNavigateTab: (tab: 'chat' | 'memory' | 'tasks' | 'sessions' | 'git') => void;
}

export const ProjectOverviewView: React.FC<ProjectOverviewViewProps> = ({
  project,
  onAnalyze,
  onContinue,
  onCheckpoint,
  onOpenFolder,
  onOpenTerminal,
  onNavigateTab
}) => {
  const [copiedCheckpoint, setCopiedCheckpoint] = useState(false);
  const [copiedPath, setCopiedPath] = useState(false);

  const { name, path: folderPath, stack, gitInfo, parsedTasks, lastSession, isAvailableOnDisk, diskWarning } = project;

  const copyPath = () => {
    navigator.clipboard.writeText(folderPath);
    setCopiedPath(true);
    setTimeout(() => setCopiedPath(false), 2000);
  };

  const copyCheckpoint = () => {
    if (lastSession?.checkpoint_raw) {
      navigator.clipboard.writeText(lastSession.checkpoint_raw);
      setCopiedCheckpoint(true);
      setTimeout(() => setCopiedCheckpoint(false), 2000);
    } else {
      onCheckpoint();
    }
  };

  const nextTask = parsedTasks.doing[0] || parsedTasks.pending[0] || 'Nenhuma tarefa pendente';

  return (
    <div className="flex-1 flex flex-col h-full bg-[#090a0f] p-6 overflow-y-auto space-y-6">
      {/* Missing folder warning banner if deleted from disk */}
      {!isAvailableOnDisk && (
        <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 flex items-start gap-3 shadow-lg">
          <AlertTriangle className="w-5 h-5 text-amber-400 mt-0.5 flex-shrink-0" />
          <div className="flex-1 text-xs">
            <h4 className="font-bold text-amber-300">Pasta não encontrada no computador</h4>
            <p className="mt-1 text-slate-300 leading-relaxed">
              O diretório <code className="px-1.5 py-0.5 rounded bg-black/40 text-amber-300 font-mono">{folderPath}</code> não foi localizado no disco. O projeto pode ter sido movido, renomeado ou excluído.
            </p>
          </div>
        </div>
      )}

      {/* Main Project Header Card */}
      <div className="bg-[#0d0f17] border border-[#1e2233] rounded-2xl p-6 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#1e2233] pb-5">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl font-bold text-white tracking-tight">{name}</h1>
              {stack && (
                <span className="px-2.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 text-xs font-mono font-medium">
                  {stack}
                </span>
              )}
            </div>

            <div className="mt-2 flex items-center gap-2 text-xs text-[#7e87aa] font-mono">
              <Folder className="w-3.5 h-3.5 text-[#525a7f]" />
              <button
                onClick={copyPath}
                title="Copiar caminho completo"
                className="hover:text-slate-200 transition-colors flex items-center gap-1.5 truncate max-w-xl text-left"
              >
                <span className="truncate">{folderPath}</span>
                {copiedPath ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 opacity-60" />}
              </button>
            </div>
          </div>

          {/* Quick Actions Row */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={onAnalyze}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#121520] hover:bg-[#181b28] border border-[#1e2233] text-xs font-medium text-slate-200 hover:border-cyan-500/40 transition-all shadow-sm"
              title="Escanear e atualizar stack"
            >
              <Search className="w-3.5 h-3.5 text-cyan-400" />
              <span>Analisar</span>
            </button>

            <button
              onClick={onContinue}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#121520] hover:bg-[#181b28] border border-indigo-500/40 text-xs font-semibold text-indigo-300 hover:text-white transition-all shadow-sm"
              title="Copiar prompt de continuidade para nova IA"
            >
              <ArrowRight className="w-3.5 h-3.5 text-indigo-400" />
              <span>Continuar</span>
            </button>

            <button
              onClick={onCheckpoint}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-md shadow-indigo-600/30 transition-all active:scale-[0.98]"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Checkpoint</span>
            </button>

            <button
              onClick={onOpenFolder}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#121520] hover:bg-[#181b28] border border-[#1e2233] text-xs font-medium text-slate-300 hover:text-white transition-all shadow-sm"
              title="Abrir no Windows Explorer"
            >
              <ExternalLink className="w-3.5 h-3.5 text-[#7e87aa]" />
              <span>Abrir Pasta</span>
            </button>

            <button
              onClick={onOpenTerminal}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#121520] hover:bg-[#181b28] border border-[#1e2233] text-xs font-medium text-slate-300 hover:text-white transition-all shadow-sm"
              title="Abrir Terminal nesta pasta"
            >
              <Terminal className="w-3.5 h-3.5 text-emerald-400" />
              <span>Abrir Terminal</span>
            </button>
          </div>
        </div>

        {/* Objective & Context Snapshot */}
        <div className="pt-4 grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div className="col-span-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#7e87aa] block mb-1 flex items-center gap-1">
              <Target className="w-3 h-3 text-cyan-400" />
              Objetivo Principal
            </span>
            <p className="text-slate-300 leading-relaxed">
              {project.objective || 'Defina o objetivo do projeto na aba Memória Permanente (project.md)'}
            </p>
          </div>

          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#7e87aa] block mb-1 flex items-center gap-1">
              <Clock className="w-3 h-3 text-amber-400" />
              Próxima Tarefa Recomendada
            </span>
            <div className="p-2 rounded-lg bg-[#121520] border border-[#1e2233] text-slate-200">
              {nextTask}
            </div>
          </div>
        </div>
      </div>

      {/* Grid: Git Status & Tasks Kanban Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Card: Git Overview */}
        <div className="bg-[#0d0f17] border border-[#1e2233] rounded-2xl p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <GitBranch className="w-4 h-4 text-emerald-400" />
              <h3 className="text-xs font-bold text-white uppercase tracking-wider">Git Status</h3>
            </div>
            {gitInfo.isGitRepo && (
              <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 text-xs font-mono">
                {gitInfo.branch || 'main'}
              </span>
            )}
          </div>

          {gitInfo.isGitRepo ? (
            <div className="space-y-3">
              <div className="grid grid-cols-4 gap-2 text-center text-xs font-mono">
                <div className="bg-[#121520] p-2.5 rounded-xl border border-[#1e2233]">
                  <div className="text-amber-400 font-bold text-base">{gitInfo.statusSummary.modified}</div>
                  <div className="text-[10px] text-[#7e87aa]">Modificados</div>
                </div>
                <div className="bg-[#121520] p-2.5 rounded-xl border border-[#1e2233]">
                  <div className="text-emerald-400 font-bold text-base">{gitInfo.statusSummary.newFiles}</div>
                  <div className="text-[10px] text-[#7e87aa]">Novos</div>
                </div>
                <div className="bg-[#121520] p-2.5 rounded-xl border border-[#1e2233]">
                  <div className="text-rose-400 font-bold text-base">{gitInfo.statusSummary.deleted}</div>
                  <div className="text-[10px] text-[#7e87aa]">Deletados</div>
                </div>
                <div className="bg-[#121520] p-2.5 rounded-xl border border-[#1e2233]">
                  <div className="text-indigo-400 font-bold text-base">{gitInfo.statusSummary.total}</div>
                  <div className="text-[10px] text-[#7e87aa]">Total</div>
                </div>
              </div>

              {gitInfo.lastCommit && (
                <div className="p-3 rounded-xl bg-[#121520] border border-[#1e2233] text-xs">
                  <div className="flex items-center gap-1.5 text-[#7e87aa] mb-1 font-mono text-[11px]">
                    <GitCommit className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Último commit:</span>
                    <span className="text-indigo-300 font-bold">{gitInfo.lastCommit.hash}</span>
                  </div>
                  <p className="text-slate-200 line-clamp-2">{gitInfo.lastCommit.message}</p>
                </div>
              )}
            </div>
          ) : (
            <div className="text-xs text-[#525a7f] p-4 text-center bg-[#121520] rounded-xl border border-[#1e2233]">
              Repositório Git não detectado neste diretório.
            </div>
          )}

          <button
            onClick={() => onNavigateTab('git')}
            className="text-xs text-indigo-400 hover:text-indigo-300 font-medium flex items-center gap-1"
          >
            <span>Ver detalhes de Git Status</span>
            <ArrowRight className="w-3 h-3" />
          </button>
        </div>

        {/* Card: Tasks Status Summary */}
        <div className="bg-[#0d0f17] border border-[#1e2233] rounded-2xl p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ListTodo className="w-4 h-4 text-amber-400" />
              <h3 className="text-xs font-bold text-white uppercase tracking-wider">Tarefas Ativas</h3>
            </div>
            <span className="text-xs font-mono text-[#7e87aa]">
              {parsedTasks.pending.length + parsedTasks.doing.length + parsedTasks.done.length} registradas
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2.5 text-center text-xs">
            <div className="p-3 bg-[#121520] rounded-xl border border-amber-500/20">
              <div className="text-xl font-bold font-mono text-amber-400">{parsedTasks.pending.length}</div>
              <div className="text-[10px] text-[#7e87aa] uppercase font-semibold mt-1">Pendentes</div>
            </div>

            <div className="p-3 bg-[#121520] rounded-xl border border-cyan-500/20">
              <div className="text-xl font-bold font-mono text-cyan-400">{parsedTasks.doing.length}</div>
              <div className="text-[10px] text-[#7e87aa] uppercase font-semibold mt-1">Fazendo</div>
            </div>

            <div className="p-3 bg-[#121520] rounded-xl border border-emerald-500/20">
              <div className="text-xl font-bold font-mono text-emerald-400">{parsedTasks.done.length}</div>
              <div className="text-[10px] text-[#7e87aa] uppercase font-semibold mt-1">Concluídas</div>
            </div>
          </div>

          <div className="space-y-1.5 max-h-36 overflow-y-auto">
            {parsedTasks.doing.slice(0, 2).map((t, i) => (
              <div key={i} className="p-2 rounded-lg bg-[#121520] border border-[#1e2233] text-xs text-cyan-200 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 flex-shrink-0" />
                <span className="truncate">{t}</span>
              </div>
            ))}
            {parsedTasks.pending.slice(0, 2).map((t, i) => (
              <div key={i} className="p-2 rounded-lg bg-[#121520] border border-[#1e2233] text-xs text-slate-300 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
                <span className="truncate">{t}</span>
              </div>
            ))}
          </div>

          <button
            onClick={() => onNavigateTab('tasks')}
            className="text-xs text-indigo-400 hover:text-indigo-300 font-medium flex items-center gap-1"
          >
            <span>Abrir Quadro Kanban completo</span>
            <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Card: Last Checkpoint & Session Info */}
      <div className="bg-[#0d0f17] border border-[#1e2233] rounded-2xl p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-[#1e2233] pb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-indigo-400" />
            <h3 className="text-xs font-bold text-white uppercase tracking-wider">Último Checkpoint & Sessão</h3>
          </div>

          {lastSession && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-[#7e87aa] flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-[#525a7f]" />
                {new Date(lastSession.created_at).toLocaleDateString('pt-BR')}
              </span>
              <span className="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-mono text-xs font-bold">
                Sessão #{lastSession.session_number}
              </span>
            </div>
          )}
        </div>

        {lastSession ? (
          <div className="space-y-3">
            <pre className="p-4 bg-[#090a0f] border border-[#1e2233] rounded-xl text-xs font-mono text-slate-300 whitespace-pre-wrap leading-relaxed max-h-56 overflow-y-auto">
              {lastSession.checkpoint_raw}
            </pre>

            <div className="flex items-center justify-between pt-1">
              <button
                onClick={() => onNavigateTab('sessions')}
                className="text-xs text-indigo-400 hover:text-indigo-300 font-medium flex items-center gap-1"
              >
                <span>Ver todas as sessões anteriores</span>
                <ArrowRight className="w-3 h-3" />
              </button>

              <button
                onClick={copyCheckpoint}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#181b28] hover:bg-[#202538] border border-[#2e344e] text-xs font-semibold text-indigo-300 transition-colors"
              >
                {copiedCheckpoint ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-emerald-400">Checkpoint Copiado!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Copiar Checkpoint</span>
                  </>
                )}
              </button>
            </div>
          </div>
        ) : (
          <div className="text-center py-6 text-xs text-[#525a7f] space-y-2">
            <p>Nenhum checkpoint foi gerado para este projeto ainda.</p>
            <button
              onClick={onCheckpoint}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-sm transition-all"
            >
              Gerar Primeiro Checkpoint
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
