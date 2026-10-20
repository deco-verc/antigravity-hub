import React, { useState } from 'react';
import { FullProjectDetails } from '../types';
import {
  CheckCircle2,
  Circle,
  Clock,
  FileText,
  Plus,
  Edit2,
  Check,
  X,
  ArrowRight,
  Folder,
  Layers,
  Sparkles
} from 'lucide-react';

interface DecoHubOverviewProps {
  project: FullProjectDetails;
  onContinue: () => void;
  onAddTask: (text: string, column: 'pending' | 'doing' | 'done') => void;
  onUpdateObjective: (newObjective: string) => void;
  onNavigateTab: (tab: 'tasks' | 'files' | 'activity') => void;
}

export const DecoHubOverview: React.FC<DecoHubOverviewProps> = ({
  project,
  onContinue,
  onAddTask,
  onUpdateObjective,
  onNavigateTab
}) => {
  const [isEditingObjective, setIsEditingObjective] = useState(false);
  const [objectiveInput, setObjectiveInput] = useState(project.objective || '');
  const [newTaskInput, setNewTaskInput] = useState('');
  const [isAddingTask, setIsAddingTask] = useState(false);

  const { parsedTasks, lastSession } = project;
  const totalTasks = parsedTasks.pending.length + parsedTasks.doing.length + parsedTasks.done.length;
  const completedTasks = parsedTasks.done.length;

  const handleSaveObjective = () => {
    onUpdateObjective(objectiveInput.trim());
    setIsEditingObjective(false);
  };

  const handleCreateTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskInput.trim()) return;
    onAddTask(newTaskInput.trim(), 'pending');
    setNewTaskInput('');
    setIsAddingTask(false);
  };

  // Humanized relative time format
  const getRelativeTime = (isoString?: string | null) => {
    if (!isoString) return 'Recentemente';
    const diffMs = Date.now() - new Date(isoString).getTime();
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return `há ${diffSec || 1} segundos`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `há ${diffMin} minuto${diffMin > 1 ? 's' : ''}`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `há ${diffHours} hora${diffHours > 1 ? 's' : ''}`;
    const diffDays = Math.floor(diffHours / 24);
    return `há ${diffDays} dia${diffDays > 1 ? 's' : ''}`;
  };

  return (
    <div className="flex-1 overflow-y-auto p-8 space-y-8 max-w-5xl mx-auto w-full">
      {/* 1. Header simples de Visão Geral com Objetivo */}
      <div className="space-y-3">
        <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
          Visão Geral do Projeto
        </h2>

        <div className="p-5 rounded-2xl bg-[#0e111a] border border-[#1b2033] shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <span className="text-xs font-medium text-slate-400 block mb-1">Objetivo:</span>
              {isEditingObjective ? (
                <div className="flex items-center gap-2 mt-1">
                  <input
                    type="text"
                    value={objectiveInput}
                    onChange={e => setObjectiveInput(e.target.value)}
                    className="flex-1 px-3 py-1.5 rounded-lg bg-[#090b10] border border-[#23293d] text-sm text-white focus:outline-none focus:border-indigo-500"
                    autoFocus
                  />
                  <button
                    onClick={handleSaveObjective}
                    className="p-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white"
                    title="Salvar"
                  >
                    <Check className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => {
                      setObjectiveInput(project.objective || '');
                      setIsEditingObjective(false);
                    }}
                    className="p-2 rounded-lg bg-[#141824] text-slate-400 hover:text-white"
                    title="Cancelar"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <p className="text-base text-slate-100 font-medium leading-relaxed">
                  "{project.objective || 'Desenvolver e aprimorar o projeto de forma contínua e organizada.'}"
                </p>
              )}
            </div>

            {!isEditingObjective && (
              <button
                type="button"
                onClick={() => {
                  setObjectiveInput(project.objective || '');
                  setIsEditingObjective(true);
                }}
                className="px-3 py-1.5 rounded-lg bg-[#141824] hover:bg-[#1a2030] text-slate-400 hover:text-slate-200 text-xs font-medium border border-[#23293d] flex items-center gap-1.5 transition-colors flex-shrink-0"
              >
                <Edit2 className="w-3.5 h-3.5" />
                <span>Editar</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 2. Três Cards Numéricos Limpos */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Card 1: Tarefas */}
        <div
          onClick={() => onNavigateTab('tasks')}
          className="p-5 rounded-2xl bg-[#0e111a] border border-[#1b2033] hover:border-[#2a3250] cursor-pointer transition-all shadow-sm group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Tarefas</span>
            <span className="text-xs text-indigo-400 group-hover:translate-x-0.5 transition-transform">Ver →</span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-white tracking-tight">
              {completedTasks}
            </span>
            <span className="text-sm font-medium text-slate-400">
              de {totalTasks} concluídas
            </span>
          </div>
        </div>

        {/* Card 2: Arquivos */}
        <div
          onClick={() => onNavigateTab('files')}
          className="p-5 rounded-2xl bg-[#0e111a] border border-[#1b2033] hover:border-[#2a3250] cursor-pointer transition-all shadow-sm group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Arquivos</span>
            <span className="text-xs text-indigo-400 group-hover:translate-x-0.5 transition-transform">Ver →</span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-white tracking-tight">
              {project.gitInfo?.statusSummary ? project.gitInfo.statusSummary.total : '✓'}
            </span>
            <span className="text-sm font-medium text-slate-400">
              alterações pendentes
            </span>
          </div>
        </div>

        {/* Card 3: Última Atividade */}
        <div
          onClick={() => onNavigateTab('activity')}
          className="p-5 rounded-2xl bg-[#0e111a] border border-[#1b2033] hover:border-[#2a3250] cursor-pointer transition-all shadow-sm group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Última Atividade</span>
            <span className="text-xs text-indigo-400 group-hover:translate-x-0.5 transition-transform">Histórico →</span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-lg font-bold text-white tracking-tight">
              {getRelativeTime(lastSession?.created_at || project.updated_at)}
            </span>
          </div>
        </div>
      </div>

      {/* 3. Grade Principal: Tarefas Recentes & Atividade Recente */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Bloco de Tarefas */}
        <div className="p-6 rounded-2xl bg-[#0e111a] border border-[#1b2033] shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-[#1b2033] pb-3">
            <h3 className="text-sm font-bold text-white tracking-tight">
              Tarefas
            </h3>
            <button
              type="button"
              onClick={() => setIsAddingTask(true)}
              className="text-xs font-semibold text-indigo-400 hover:text-indigo-300 flex items-center gap-1 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Nova tarefa</span>
            </button>
          </div>

          {/* Form de nova tarefa se aberto */}
          {isAddingTask && (
            <form onSubmit={handleCreateTask} className="flex gap-2">
              <input
                type="text"
                placeholder="Descreva a nova tarefa..."
                value={newTaskInput}
                onChange={e => setNewTaskInput(e.target.value)}
                className="flex-1 px-3 py-1.5 rounded-lg bg-[#090b10] border border-[#23293d] text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                autoFocus
              />
              <button
                type="submit"
                className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white"
              >
                Adicionar
              </button>
              <button
                type="button"
                onClick={() => setIsAddingTask(false)}
                className="px-3 py-1.5 rounded-lg bg-[#141824] text-xs text-slate-400 hover:text-white"
              >
                Cancelar
              </button>
            </form>
          )}

          {/* Lista das tarefas */}
          <div className="space-y-2.5">
            {totalTasks === 0 ? (
              <p className="text-xs text-slate-500 py-3">Nenhuma tarefa cadastrada no projeto.</p>
            ) : (
              <>
                {/* Concluídas (amostra) */}
                {parsedTasks.done.slice(0, 2).map((t, idx) => (
                  <div key={`done-${idx}`} className="flex items-start gap-2.5 p-2 rounded-lg bg-[#090b10] border border-[#1b2033]">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-slate-400 line-through truncate">{t}</div>
                      <span className="text-[10px] text-emerald-400 font-medium">Concluída</span>
                    </div>
                  </div>
                ))}

                {/* Em andamento */}
                {parsedTasks.doing.slice(0, 2).map((t, idx) => (
                  <div key={`doing-${idx}`} className="flex items-start gap-2.5 p-2 rounded-lg bg-indigo-950/20 border border-indigo-500/30">
                    <span className="w-4 h-4 rounded-full border-2 border-indigo-400 flex items-center justify-center mt-0.5 flex-shrink-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-white font-medium truncate">{t}</div>
                      <span className="text-[10px] text-indigo-300 font-medium">Em andamento</span>
                    </div>
                  </div>
                ))}

                {/* Pendentes */}
                {parsedTasks.pending.slice(0, 3).map((t, idx) => (
                  <div key={`pending-${idx}`} className="flex items-start gap-2.5 p-2 rounded-lg bg-[#090b10] border border-[#1b2033]">
                    <Circle className="w-4 h-4 text-slate-600 mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-slate-200 truncate">{t}</div>
                      <span className="text-[10px] text-slate-500">Pendente</span>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>

          <div className="pt-2 text-right">
            <button
              type="button"
              onClick={() => onNavigateTab('tasks')}
              className="text-xs text-indigo-400 hover:text-indigo-300 font-medium transition-colors"
            >
              Ver todas as tarefas no Kanban →
            </button>
          </div>
        </div>

        {/* Bloco de Atividade Recente */}
        <div className="p-6 rounded-2xl bg-[#0e111a] border border-[#1b2033] shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-[#1b2033] pb-3">
            <h3 className="text-sm font-bold text-white tracking-tight">
              Atividade Recente
            </h3>
            <button
              type="button"
              onClick={() => onNavigateTab('activity')}
              className="text-xs font-semibold text-slate-400 hover:text-slate-300 transition-colors"
            >
              Histórico completo →
            </button>
          </div>

          <div className="space-y-3">
            {lastSession ? (
              <div className="p-3 rounded-xl bg-[#090b10] border border-[#1b2033] space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-white">Última sessão de trabalho</span>
                  <span className="text-slate-500 text-[11px] font-mono">
                    {getRelativeTime(lastSession.created_at)}
                  </span>
                </div>
                <p className="text-xs text-slate-400 line-clamp-2">
                  {lastSession.summary || 'Trabalho contínuo registrado na memória permanente do projeto.'}
                </p>
              </div>
            ) : null}

            {project.gitInfo.lastCommit ? (
              <div className="p-3 rounded-xl bg-[#090b10] border border-[#1b2033] space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-300">Alterações no código</span>
                  <span className="text-slate-500 text-[11px] font-mono">
                    {getRelativeTime(project.gitInfo.lastCommit.date)}
                  </span>
                </div>
                <div className="text-xs text-slate-400 truncate font-mono">
                  {project.gitInfo.lastCommit.message}
                </div>
              </div>
            ) : null}

            <div className="p-3 rounded-xl bg-[#090b10] border border-[#1b2033] flex items-center justify-between text-xs">
              <span className="text-slate-300">Projeto vinculado ao DecoHUB</span>
              <span className="text-slate-500 font-mono text-[11px]">
                {getRelativeTime(project.created_at)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
