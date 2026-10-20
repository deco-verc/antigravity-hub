import React, { useState } from 'react';
import { ParsedTasks } from '../types';
import { Plus, ArrowRight, ArrowLeft, CheckCircle2, Clock, ListTodo } from 'lucide-react';

interface TaskKanbanProps {
  tasks: ParsedTasks;
  onAddTask: (text: string, column: 'pending' | 'doing' | 'done') => Promise<void>;
  onMoveTask: (text: string, from: 'pending' | 'doing' | 'done', to: 'pending' | 'doing' | 'done') => Promise<void>;
}

export const TaskKanban: React.FC<TaskKanbanProps> = ({
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
    const txt = newText;
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
      title: 'Pendente',
      items: tasks.pending,
      color: 'border-amber-500/30 text-amber-400 bg-amber-500/5',
      badgeColor: 'bg-amber-500/20 text-amber-300',
      icon: ListTodo
    },
    {
      id: 'doing' as const,
      title: 'Fazendo (Em Andamento)',
      items: tasks.doing,
      color: 'border-cyan-500/30 text-cyan-400 bg-cyan-500/5',
      badgeColor: 'bg-cyan-500/20 text-cyan-300',
      icon: Clock
    },
    {
      id: 'done' as const,
      title: 'Concluído',
      items: tasks.done,
      color: 'border-emerald-500/30 text-emerald-400 bg-emerald-500/5',
      badgeColor: 'bg-emerald-500/20 text-emerald-300',
      icon: CheckCircle2
    }
  ];

  return (
    <div className="flex-1 flex flex-col h-full bg-[#090a0f] p-6 overflow-hidden">
      {/* Quick Add Form */}
      <form onSubmit={handleAdd} className="mb-6 flex gap-2 items-center bg-[#0d0f17] p-3 rounded-xl border border-[#1e2233]">
        <input
          type="text"
          value={newText}
          onChange={e => setNewText(e.target.value)}
          placeholder="Adicionar nova tarefa (ex: 'Configurar rotas de autenticação')..."
          className="flex-1 bg-[#121520] border border-[#1e2233] focus:border-indigo-500 rounded-lg px-3 py-2 text-xs text-white placeholder-[#525a7f] focus:outline-none"
        />

        <select
          value={targetColumn}
          onChange={e => setTargetColumn(e.target.value as any)}
          className="bg-[#121520] border border-[#1e2233] rounded-lg px-3 py-2 text-xs text-slate-300 focus:outline-none"
        >
          <option value="pending">Pendente</option>
          <option value="doing">Fazendo</option>
          <option value="done">Concluído</option>
        </select>

        <button
          type="submit"
          disabled={!newText.trim() || isAdding}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Adicionar</span>
        </button>
      </form>

      {/* Columns Grid */}
      <div className="flex-1 grid grid-cols-3 gap-4 overflow-hidden">
        {columns.map(col => {
          const Icon = col.icon;
          return (
            <div
              key={col.id}
              className="bg-[#0d0f17] border border-[#1e2233] rounded-xl flex flex-col overflow-hidden shadow-sm"
            >
              {/* Column Header */}
              <div className="p-3 border-b border-[#1e2233] flex items-center justify-between bg-[#121520]/50">
                <div className="flex items-center gap-2">
                  <Icon className={`w-4 h-4 ${col.title.includes('Concluído') ? 'text-emerald-400' : col.title.includes('Fazendo') ? 'text-cyan-400' : 'text-amber-400'}`} />
                  <span className="text-xs font-bold text-white tracking-wide">{col.title}</span>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-semibold ${col.badgeColor}`}>
                  {col.items.length}
                </span>
              </div>

              {/* Items List */}
              <div className="flex-1 p-3 overflow-y-auto space-y-2.5">
                {col.items.length === 0 ? (
                  <div className="text-center py-8 text-xs text-[#525a7f] italic">
                    Nenhuma tarefa nesta coluna
                  </div>
                ) : (
                  col.items.map((taskText, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-lg bg-[#121520] border border-[#1e2233] hover:border-[#2e344e] transition-all group shadow-sm text-xs"
                    >
                      <p className="text-slate-200 leading-relaxed break-words">{taskText}</p>

                      {/* Movement controls */}
                      <div className="mt-2.5 pt-2 border-t border-[#1e2233]/70 flex items-center justify-between text-[11px]">
                        <div>
                          {col.id !== 'pending' && (
                            <button
                              onClick={() => onMoveTask(taskText, col.id, col.id === 'done' ? 'doing' : 'pending')}
                              className="text-[#7e87aa] hover:text-slate-200 flex items-center gap-1 transition-colors"
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
                              onClick={() => onMoveTask(taskText, col.id, col.id === 'pending' ? 'doing' : 'done')}
                              className="text-indigo-400 hover:text-indigo-300 font-medium flex items-center gap-1 transition-colors ml-auto"
                              title="Avançar para próxima coluna"
                            >
                              <span>{col.id === 'pending' ? 'Iniciar' : 'Concluir'}</span>
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
          );
        })}
      </div>
    </div>
  );
};
