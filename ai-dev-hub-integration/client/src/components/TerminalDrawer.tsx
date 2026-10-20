import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import { TerminalLogsResponse } from '../types';
import {
  Terminal,
  ChevronUp,
  ChevronDown,
  RefreshCw,
  GitCommit,
  X,
  Maximize2,
  Minimize2,
  CheckCircle2,
  AlertTriangle
} from 'lucide-react';

interface TerminalDrawerProps {
  projectId: string | null;
  isOpen: boolean;
  onToggle: () => void;
}

export const TerminalDrawer: React.FC<TerminalDrawerProps> = ({
  projectId,
  isOpen,
  onToggle
}) => {
  const [activeTab, setActiveTab] = useState<'commands' | 'git'>('commands');
  const [logsData, setLogsData] = useState<TerminalLogsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (projectId && isOpen) {
      loadLogs();
    }
  }, [projectId, isOpen]);

  const loadLogs = async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const res = await api.getTerminalLogs(projectId);
      setLogsData(res);
    } catch (err) {
      console.error('Falha ao obter logs do terminal:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className={`border-t border-[#1b2033] bg-[#090b12] transition-all flex flex-col flex-shrink-0 z-30 ${
        isOpen ? (isMaximized ? 'h-[60vh]' : 'h-64') : 'h-8'
      }`}
    >
      {/* Drawer Bar Header */}
      <div className="h-8 px-4 bg-[#0d101a] border-b border-[#181d2e] flex items-center justify-between select-none">
        <div className="flex items-center gap-3">
          <button
            onClick={onToggle}
            className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 hover:text-white transition-colors"
          >
            <Terminal className="w-3.5 h-3.5 text-emerald-400" />
            <span className="tracking-wide uppercase text-[11px] font-mono">Terminal</span>
            {isOpen ? (
              <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
            ) : (
              <ChevronUp className="w-3.5 h-3.5 text-slate-500" />
            )}
          </button>

          {isOpen && (
            <div className="flex items-center gap-1 ml-4 border-l border-[#20263d] pl-3">
              <button
                onClick={() => setActiveTab('commands')}
                className={`px-2.5 py-0.5 rounded text-[11px] font-medium transition-colors ${
                  activeTab === 'commands'
                    ? 'bg-indigo-600/30 text-indigo-300 font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Comandos & Execução
              </button>
              <button
                onClick={() => setActiveTab('git')}
                className={`px-2.5 py-0.5 rounded text-[11px] font-medium transition-colors ${
                  activeTab === 'git'
                    ? 'bg-indigo-600/30 text-indigo-300 font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Git Log
              </button>
            </div>
          )}
        </div>

        {isOpen && (
          <div className="flex items-center gap-1.5">
            <button
              onClick={loadLogs}
              disabled={loading}
              className="p-1 rounded text-slate-400 hover:text-white hover:bg-[#1a2030] transition-colors"
              title="Recarregar logs"
            >
              <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin text-indigo-400' : ''}`} />
            </button>
            <button
              onClick={() => setIsMaximized(!isMaximized)}
              className="p-1 rounded text-slate-400 hover:text-white hover:bg-[#1a2030] transition-colors"
              title={isMaximized ? 'Restaurar' : 'Maximizar'}
            >
              {isMaximized ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
            </button>
            <button
              onClick={onToggle}
              className="p-1 rounded text-slate-400 hover:text-white hover:bg-[#1a2030] transition-colors"
              title="Fechar gaveta"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Drawer Body Content */}
      {isOpen && (
        <div className="flex-1 overflow-auto bg-[#07080e] p-3 font-mono text-xs text-slate-300 select-text">
          {loading && !logsData ? (
            <div className="flex items-center justify-center h-full text-slate-500">
              <RefreshCw className="w-4 h-4 animate-spin text-indigo-400 mr-2" />
              <span>Carregando logs do terminal...</span>
            </div>
          ) : activeTab === 'commands' ? (
            <div>
              {logsData?.logs && logsData.logs.length > 0 ? (
                <div className="space-y-3">
                  {logsData.logs.map((log, idx) => (
                    <div key={idx} className="border-b border-[#151928] pb-2 last:border-none">
                      <div className="flex items-center gap-2 text-slate-400 text-[11px] mb-1">
                        <span className="text-emerald-400 font-bold">$</span>
                        <span className="text-white font-semibold">{log.command}</span>
                        <span className="text-[10px] text-slate-600 ml-auto">{log.created_at}</span>
                      </div>
                      <pre className="text-slate-300 whitespace-pre-wrap pl-4 leading-relaxed bg-[#0a0d17] p-2 rounded border border-[#14192b]">
                        {log.output || '(Nenhuma saída gerada)'}
                      </pre>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-slate-500 p-4">
                  <div className="flex items-center gap-2 text-emerald-400 font-semibold mb-1">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Ambiente terminal pronto</span>
                  </div>
                  <p className="text-xs text-slate-500">
                    Comandos de build, testes ou automações executados pelo agente aparecerão aqui em tempo real.
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-1.5 text-indigo-400 text-xs font-semibold mb-2">
                <GitCommit className="w-3.5 h-3.5" />
                <span>Histórico de Commits Git</span>
              </div>
              <pre className="text-slate-300 whitespace-pre-wrap leading-relaxed bg-[#0a0d17] p-3 rounded border border-[#14192b]">
                {logsData?.gitLog || 'Nenhum commit encontrado no repositório.'}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
