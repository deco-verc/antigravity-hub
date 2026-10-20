import React, { useState, useEffect } from 'react';
import { LogEntry } from '../types';
import { api } from '../services/api';
import { Terminal, RefreshCw, Trash2, Filter } from 'lucide-react';

export const SystemLogsView: React.FC = () => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterLevel, setFilterLevel] = useState<string>('all');

  useEffect(() => {
    loadLogs();
  }, []);

  const loadLogs = async () => {
    setLoading(true);
    try {
      const data = await api.getLogs(150);
      setLogs(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleClearLogs = async () => {
    if (!confirm('Deseja limpar todos os registros de logs?')) return;
    try {
      await api.clearLogs();
      setLogs([]);
    } catch (err) {
      console.error(err);
    }
  };

  const filtered = logs.filter(l => {
    if (filterLevel === 'all') return true;
    return l.level === filterLevel;
  });

  return (
    <div className="flex-1 flex flex-col h-full bg-[#090a0f] p-6 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#1e2233] pb-4 mb-4 flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <Terminal className="w-5 h-5 text-indigo-400" />
          <div>
            <h2 className="text-base font-bold text-white uppercase tracking-wider">Logs do Sistema</h2>
            <p className="text-xs text-[#7e87aa]">Eventos e auditoria de ações do AI DEV HUB</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Filter */}
          <div className="flex items-center gap-1 bg-[#121520] border border-[#1e2233] rounded-lg px-2 py-1 text-xs">
            <Filter className="w-3 h-3 text-[#525a7f]" />
            <select
              value={filterLevel}
              onChange={e => setFilterLevel(e.target.value)}
              className="bg-transparent text-slate-300 focus:outline-none text-xs"
            >
              <option value="all" className="bg-[#121520]">Todos</option>
              <option value="info" className="bg-[#121520]">Info</option>
              <option value="warn" className="bg-[#121520]">Avisos</option>
              <option value="error" className="bg-[#121520]">Erros</option>
              <option value="success" className="bg-[#121520]">Sucesso</option>
            </select>
          </div>

          <button
            onClick={loadLogs}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#181b28] hover:bg-[#202538] border border-[#2e344e] text-xs text-slate-300 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Atualizar</span>
          </button>

          <button
            onClick={handleClearLogs}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#181b28] hover:bg-rose-500/20 hover:text-rose-300 border border-[#2e344e] text-xs text-[#7e87aa] transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Limpar</span>
          </button>
        </div>
      </div>

      {/* Logs Console Container */}
      <div className="flex-1 bg-[#050608] border border-[#1e2233] rounded-2xl p-4 overflow-y-auto font-mono text-xs space-y-1.5 shadow-inner">
        {loading && logs.length === 0 ? (
          <div className="text-center py-12 text-[#525a7f]">Carregando logs do sistema...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-[#525a7f]">Nenhum registro encontrado.</div>
        ) : (
          filtered.map(l => {
            const timeStr = new Date(l.timestamp).toLocaleTimeString('pt-BR');
            const isErr = l.level === 'error';
            const isWarn = l.level === 'warn';
            const isSuccess = l.level === 'success';

            const tagColor = isErr
              ? 'text-rose-400 bg-rose-500/10'
              : isWarn
              ? 'text-amber-400 bg-amber-500/10'
              : isSuccess
              ? 'text-emerald-400 bg-emerald-500/10'
              : 'text-indigo-400 bg-indigo-500/10';

            const tagLabel = isErr ? '[ERRO]' : isWarn ? '[AVISO]' : isSuccess ? '[OK]' : '[INFO]';

            return (
              <div key={l.id} className="flex items-start gap-2 hover:bg-white/[0.02] p-1 rounded transition-colors leading-relaxed">
                <span className="text-[#525a7f] flex-shrink-0">[{timeStr}]</span>
                <span className={`px-1 rounded text-[10px] uppercase font-bold flex-shrink-0 ${tagColor}`}>
                  {tagLabel}
                </span>
                <span className={`flex-1 break-words ${isErr ? 'text-rose-300' : isWarn ? 'text-amber-200' : 'text-slate-300'}`}>
                  {l.message}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
