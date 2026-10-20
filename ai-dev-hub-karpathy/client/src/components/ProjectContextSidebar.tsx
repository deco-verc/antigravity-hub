import React, { useState } from 'react';
import { FullProjectDetails } from '../types';
import {
  FileText,
  Target,
  ListTodo,
  CheckCircle2,
  Clock,
  Sparkles,
  GitBranch,
  Copy,
  Check,
  ChevronRight,
  ExternalLink,
  BookOpen,
  ArrowRight
} from 'lucide-react';

interface ProjectContextSidebarProps {
  project: FullProjectDetails | null;
  onOpenCheckpointModal: () => void;
  onOpenContinuityModal: () => void;
  onOpenMemoryTab: (fileName: string) => void;
}

export const ProjectContextSidebar: React.FC<ProjectContextSidebarProps> = ({
  project,
  onOpenCheckpointModal,
  onOpenContinuityModal,
  onOpenMemoryTab
}) => {
  const [copiedCheckpoint, setCopiedCheckpoint] = useState(false);

  if (!project) {
    return (
      <aside className="w-80 bg-[#0d0f17] border-l border-[#1e2233] flex flex-col h-full p-6 text-center text-[#525a7f] justify-center items-center select-none">
        <Target className="w-10 h-10 mb-3 opacity-30 text-indigo-400" />
        <p className="text-sm font-medium text-slate-400">Nenhum projeto selecionado</p>
        <p className="text-xs text-[#525a7f] mt-1">Selecione ou crie um projeto para visualizar o contexto persistido.</p>
      </aside>
    );
  }

  const { memory, parsedTasks, lastSession, gitInfo } = project;

  // Extract objective from memory or project
  const objective = project.objective || 'Defina os objetivos em project.md';

  const copyQuickCheckpoint = () => {
    if (lastSession?.checkpoint_raw) {
      navigator.clipboard.writeText(lastSession.checkpoint_raw);
      setCopiedCheckpoint(true);
      setTimeout(() => setCopiedCheckpoint(false), 2000);
    } else {
      onOpenCheckpointModal();
    }
  };

  return (
    <aside className="w-80 bg-[#0d0f17] border-l border-[#1e2233] flex flex-col h-full select-none flex-shrink-0 overflow-y-auto">
      {/* Header */}
      <div className="p-4 border-b border-[#1e2233] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-indigo-400" />
          <h2 className="text-xs font-bold text-white uppercase tracking-wider">Contexto & Memória</h2>
        </div>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono">
          .ai-dev-hub
        </span>
      </div>

      <div className="p-4 space-y-4 flex-1">
        {/* Quick Action Buttons */}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={onOpenCheckpointModal}
            className="flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-lg bg-indigo-600/90 hover:bg-indigo-600 text-white text-xs font-semibold shadow-sm transition-all text-center"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>CHECKPOINT</span>
          </button>

          <button
            onClick={onOpenContinuityModal}
            className="flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-lg bg-[#181b28] hover:bg-[#202538] border border-[#2e344e] text-indigo-300 text-xs font-semibold transition-all text-center"
          >
            <ArrowRight className="w-3.5 h-3.5 text-indigo-400" />
            <span>CONTINUAR</span>
          </button>
        </div>

        {/* Objetivo */}
        <div className="bg-[#121520] border border-[#1e2233] rounded-lg p-3">
          <div className="flex items-center justify-between text-[#7e87aa] text-xs font-semibold mb-1.5">
            <span className="flex items-center gap-1.5 text-slate-300">
              <Target className="w-3.5 h-3.5 text-cyan-400" />
              Objetivo Principal
            </span>
            <button
              onClick={() => onOpenMemoryTab('project.md')}
              className="text-[10px] text-indigo-400 hover:underline"
            >
              Editar
            </button>
          </div>
          <p className="text-xs text-slate-300 line-clamp-3 leading-relaxed">
            {objective}
          </p>
        </div>

        {/* Tarefas Snapshot */}
        <div className="bg-[#121520] border border-[#1e2233] rounded-lg p-3">
          <div className="flex items-center justify-between text-xs font-semibold mb-2 text-slate-300">
            <span className="flex items-center gap-1.5">
              <ListTodo className="w-3.5 h-3.5 text-amber-400" />
              Tarefas
            </span>
            <button
              onClick={() => onOpenMemoryTab('tasks.md')}
              className="text-[10px] text-indigo-400 hover:underline"
            >
              Ver Todas
            </button>
          </div>

          <div className="grid grid-cols-3 gap-1.5 text-center text-xs mb-2.5">
            <div className="bg-[#181b28] p-1.5 rounded border border-[#1e2233]">
              <div className="text-[10px] text-[#7e87aa]">Pendente</div>
              <div className="font-bold text-amber-400">{parsedTasks.pending.length}</div>
            </div>
            <div className="bg-[#181b28] p-1.5 rounded border border-[#1e2233]">
              <div className="text-[10px] text-[#7e87aa]">Fazendo</div>
              <div className="font-bold text-cyan-400">{parsedTasks.doing.length}</div>
            </div>
            <div className="bg-[#181b28] p-1.5 rounded border border-[#1e2233]">
              <div className="text-[10px] text-[#7e87aa]">Concluído</div>
              <div className="font-bold text-emerald-400">{parsedTasks.done.length}</div>
            </div>
          </div>

          {/* Next Task Highlight */}
          <div className="text-xs">
            <span className="text-[10px] font-semibold uppercase text-[#7e87aa] block mb-1">
              Próxima Prioridade:
            </span>
            <div className="p-2 rounded bg-[#181b28] text-slate-200 border border-[#1e2233] flex items-start gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 mt-1.5 flex-shrink-0" />
              <span className="line-clamp-2">
                {parsedTasks.doing[0] || parsedTasks.pending[0] || 'Nenhuma tarefa pendente'}
              </span>
            </div>
          </div>
        </div>

        {/* Último Checkpoint Card */}
        <div className="bg-[#121520] border border-[#1e2233] rounded-lg p-3">
          <div className="flex items-center justify-between text-xs font-semibold mb-2 text-slate-300">
            <span className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-indigo-400" />
              Último Checkpoint
            </span>
            {lastSession && (
              <span className="text-[10px] text-[#7e87aa] font-mono">
                Sessão #{lastSession.session_number}
              </span>
            )}
          </div>

          {lastSession ? (
            <div className="space-y-2">
              <div className="p-2 bg-[#090a0f] rounded border border-[#1e2233] text-[11px] font-mono text-[#a5adc6] max-h-24 overflow-y-auto leading-relaxed">
                {lastSession.summary || 'Resumo do checkpoint disponível'}
              </div>
              <button
                onClick={copyQuickCheckpoint}
                className="w-full flex items-center justify-center gap-1.5 py-1.5 px-2 rounded bg-[#181b28] hover:bg-[#202538] border border-[#2e344e] text-xs text-indigo-300 transition-colors"
              >
                {copiedCheckpoint ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-emerald-400">Copiado com Sucesso!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Copiar Checkpoint Completo</span>
                  </>
                )}
              </button>
            </div>
          ) : (
            <div className="text-center py-2 text-xs text-[#525a7f]">
              <p>Nenhum checkpoint gerado ainda.</p>
              <button
                onClick={onOpenCheckpointModal}
                className="mt-2 text-xs text-indigo-400 hover:underline"
              >
                Gerar primeiro checkpoint
              </button>
            </div>
          )}
        </div>

        {/* Git Summary */}
        <div className="bg-[#121520] border border-[#1e2233] rounded-lg p-3">
          <div className="flex items-center justify-between text-xs font-semibold mb-2 text-slate-300">
            <span className="flex items-center gap-1.5">
              <GitBranch className="w-3.5 h-3.5 text-emerald-400" />
              Git Status
            </span>
            {gitInfo.isGitRepo && (
              <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">
                {gitInfo.branch || 'main'}
              </span>
            )}
          </div>

          {gitInfo.isGitRepo ? (
            <div className="grid grid-cols-3 gap-1 text-center text-[11px] font-mono">
              <div className="bg-[#181b28] py-1 rounded border border-[#1e2233]">
                <div className="text-amber-400 font-bold">{gitInfo.statusSummary.modified}</div>
                <div className="text-[9px] text-[#7e87aa]">Modificados</div>
              </div>
              <div className="bg-[#181b28] py-1 rounded border border-[#1e2233]">
                <div className="text-emerald-400 font-bold">{gitInfo.statusSummary.newFiles}</div>
                <div className="text-[9px] text-[#7e87aa]">Novos</div>
              </div>
              <div className="bg-[#181b28] py-1 rounded border border-[#1e2233]">
                <div className="text-rose-400 font-bold">{gitInfo.statusSummary.deleted}</div>
                <div className="text-[9px] text-[#7e87aa]">Deletados</div>
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-[#525a7f]">Repositório Git não detectado nesta pasta.</p>
          )}
        </div>

        {/* Memória Files Explorer */}
        <div className="bg-[#121520] border border-[#1e2233] rounded-lg p-3">
          <div className="text-xs font-semibold text-slate-300 mb-2 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-indigo-400" />
              Arquivos de Memória
            </span>
            <span className="text-[10px] text-[#7e87aa]">6 arquivos</span>
          </div>

          <div className="space-y-1 text-xs font-mono">
            {[
              { name: 'project.md', desc: 'Objetivo e contexto' },
              { name: 'architecture.md', desc: 'Stack e componentes' },
              { name: 'decisions.md', desc: 'Decisões técnicas' },
              { name: 'tasks.md', desc: 'Pendente / Fazendo / Concluído' },
              { name: 'changes.md', desc: 'Arquivos alterados' },
              { name: 'session-summary.md', desc: 'Último checkpoint e estado' }
            ].map(f => (
              <button
                key={f.name}
                onClick={() => onOpenMemoryTab(f.name)}
                className="w-full text-left px-2 py-1.5 rounded hover:bg-[#181b28] flex items-center justify-between group transition-colors"
              >
                <div className="truncate">
                  <span className="text-indigo-300 group-hover:text-indigo-200">{f.name}</span>
                </div>
                <ChevronRight className="w-3 h-3 text-[#525a7f] group-hover:text-indigo-400" />
              </button>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
};
