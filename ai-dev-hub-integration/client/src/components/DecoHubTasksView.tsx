import React, { useState } from 'react';
import { ParsedTasks } from '../types';
import { Plus, ArrowRight, ArrowLeft, CheckCircle2, Clock, ListTodo, Circle } from 'lucide-react';

interface DecoHubTasksViewProps {
  tasks: ParsedTasks;
  onAddTask: (text: string, column: 'pending' | 'doing' | 'done') => Promise<void> | void;
  onMoveTask: (text: string, from: 'pending' | 'doing' | 'done', to: 'pending' | 'doing' | 'done') => Promise<void> | void;
}

export const DecoHubTasksView: React.FC<DecoHubTasksViewProps> = ({
  tasks,
  onAddTask,
  onMoveTask
}) => {
  const [newText, setNewText] = useState('');
  const [targetColumn, setTargetColumn] = useState<'pending' | 'doing' | 'done'>('pending');
  const [isAdding, setIsAdding] = useState(false);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newText.trim() || isAdding) return;
    const txt = newText.trim();
    setNewText('');
    setIsAdding(true);
    try {
      await onAddTask(txt, targetColumn);
    } finally {
      setIsAdding(false);
    }
  };

  const columns = [
    {
      id: 'pending' as const,
      title: 'A Fazer',
      items: tasks.pending,
      dotColor: 'bg-amber-400',
      badgeClass: 'bg-amber-500/10 text-amber-300 border-amber-500/20'
    },
    {
      id: 'doing' as const,
      title: 'Em Andamento',
      items: tasks.doing,
      dotColor: 'bg-indigo-400',
      badgeClass: 'bg-indigo-500/10 text-indigo-300 border-indigo-500/20'
    },
    {
      id: 'done' as const,
      title: 'Concluído',
      items: tasks.done,
      dotColor: 'bg-emerald-400',
      badgeClass: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
    }
  ];

  return (
    <div className="flex-1 flex flex-col h-full bg-[#080a10] p-8 overflow-hidden max-w-6xl mx-auto w-full">
      {/* 1. Header do Kanban com Campo Rápido */}
      <div className="flex items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-base font-bold text-white tracking-tight">Quadro de Tarefas</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Gerencie o fluxo de trabalho do projeto com persistência em <code>tasks.md</code>.
          </p>
        </div>

        {/* Formulário Rápido de Adição */}
        <form onSubmit={handleAdd} className="flex items-center gap-2">
          <input
            type="text"
            value={newText}
            onChange={e => setNewText(e.target.value)}
            placeholder="Nova tarefa..."
            className="w-64 bg-[#10131d] border border-[#202638] rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
          />

          <select
            value={targetColumn}
            onChange={e => setTargetColumn(e.target.value as any)}
            className="bg-[#10131d] border border-[#202638] rounded-lg px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none"
          >
            <option value="pending">A Fazer</option>
            <option value="doing">Em Andamento</option>
            <option value="done">Concluído</option>
          </select>

          <button
            type="submit"
            disabled={!newText.trim() || isAdding}
            className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Adicionar</span>
          </button>
        </form>
      </div>

      {/* 2. Três Colunas Clean */}
      <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-5 overflow-hidden">
        {columns.map(col => (
          <div
            key={col.id}
            className="flex flex-col bg-[#0d1018] border border-[#1b2033] rounded-2xl overflow-hidden shadow-sm"
          >
            {/* Header da Coluna */}
            <div className="p-3.5 border-b border-[#1b2033] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${col.dotColor}`} />
                <span className="text-xs font-bold text-slate-200">{col.title}</span>
              </div>
              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${col.badgeClass}`}>
                {col.items.length}
              </span>
            </div>

            {/* Lista de Cards da Coluna */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
              {col.items.length === 0 ? (
                <div className="h-28 flex items-center justify-center text-xs text-slate-400 italic">
                  Nenhuma tarefa nesta coluna
                </div>
              ) : (
                col.items.map((task, idx) => (
                  <div
                    key={idx}
                    className="p-3 rounded-xl bg-[#121623] border border-[#202638] hover:border-[#2e3752] transition-colors group shadow-sm flex flex-col gap-2.5"
                  >
                    <p className="text-xs text-slate-200 leading-relaxed font-medium">
                      {task}
                    </p>

                    {/* Ações de Mover */}
                    <div className="flex items-center justify-between pt-1 border-t border-[#1a1f30] text-[10px] text-slate-400">
                      <div>
                        {col.id !== 'pending' && (
                          <button
                            type="button"
                            onClick={() => onMoveTask(task, col.id, col.id === 'done' ? 'doing' : 'pending')}
                            className="hover:text-slate-200 flex items-center gap-1 transition-colors"
                            title="Mover para coluna anterior"
                          >
                            <ArrowLeft className="w-3 h-3" />
                            <span>Voltar</span>
                          </button>
                        )}
                      </div>

                      <div>
                        {col.id !== 'done' && (
                          <button
                            type="button"
                            onClick={() => onMoveTask(task, col.id, col.id === 'pending' ? 'doing' : 'done')}
                            className="hover:text-indigo-400 flex items-center gap-1 transition-colors"
                            title="Avançar para próxima coluna"
                          >
                            <span>Avançar</span>
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
