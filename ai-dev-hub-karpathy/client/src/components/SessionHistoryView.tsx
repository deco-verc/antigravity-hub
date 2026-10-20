import React, { useState, useEffect } from 'react';
import { SessionRecord } from '../types';
import { api } from '../services/api';
import { History, Calendar, CheckCircle2, FileCode, ArrowRight, Copy, Check, Clock } from 'lucide-react';

interface SessionHistoryViewProps {
  projectId: string;
}

export const SessionHistoryView: React.FC<SessionHistoryViewProps> = ({ projectId }) => {
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    loadSessions();
  }, [projectId]);

  const loadSessions = async () => {
    setLoading(true);
    try {
      const data = await api.getSessions(projectId);
      setSessions(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const copyRaw = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const parseSafeJson = (str: string): string[] => {
    try {
      const parsed = JSON.parse(str);
      return Array.isArray(parsed) ? parsed : [str];
    } catch {
      return str ? [str] : [];
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#090a0f] p-6 overflow-hidden">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <History className="w-5 h-5 text-indigo-400" />
          <h2 className="text-sm font-bold text-white uppercase tracking-wider">Histórico de Sessões</h2>
        </div>
        <span className="text-xs text-[#7e87aa] font-mono">
          {sessions.length} {sessions.length === 1 ? 'sessão registrada' : 'sessões registradas'}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto space-y-4 pr-1">
        {loading ? (
          <div className="text-center py-12 text-xs text-[#525a7f]">Carregando histórico...</div>
        ) : sessions.length === 0 ? (
          <div className="text-center py-12 text-xs text-[#525a7f] space-y-2">
            <Clock className="w-8 h-8 mx-auto opacity-30 text-indigo-400" />
            <p>Nenhuma sessão gravada para este projeto.</p>
            <p className="text-[11px]">Gere um checkpoint para registrar o estado de uma nova sessão.</p>
          </div>
        ) : (
          sessions.map(s => {
            const implementedList = parseSafeJson(s.implemented);
            const affectedFiles = parseSafeJson(s.affected_files);
            const formattedDate = new Date(s.created_at).toLocaleDateString('pt-BR', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            });

            return (
              <div
                key={s.id}
                className="bg-[#0d0f17] border border-[#1e2233] rounded-xl p-4 shadow-sm space-y-3"
              >
                {/* Header */}
                <div className="flex items-center justify-between border-b border-[#1e2233] pb-2.5">
                  <div className="flex items-center gap-2.5">
                    <span className="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-mono font-bold text-xs">
                      Sessão #{s.session_number}
                    </span>
                    <span className="text-xs text-[#7e87aa] flex items-center gap-1 font-mono">
                      <Calendar className="w-3.5 h-3.5 text-[#525a7f]" />
                      {formattedDate}
                    </span>
                  </div>

                  <button
                    onClick={() => copyRaw(s.id, s.checkpoint_raw)}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#181b28] hover:bg-[#202538] border border-[#2e344e] text-xs text-indigo-300 transition-colors"
                  >
                    {copiedId === s.id ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-400" />
                        <span className="text-emerald-400">Copiado</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Copiar Checkpoint</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Content Breakdown */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  {/* Implemented */}
                  <div className="bg-[#121520] p-3 rounded-lg border border-[#1e2233]">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5 mb-1.5">
                      <CheckCircle2 className="w-3 h-3" />
                      Implementado:
                    </span>
                    <ul className="space-y-1 text-slate-300 list-disc list-inside">
                      {implementedList.length > 0 ? (
                        implementedList.map((item, i) => <li key={i} className="line-clamp-2">{item}</li>)
                      ) : (
                        <li className="text-[#525a7f]">Nenhuma alteração detalhada</li>
                      )}
                    </ul>
                  </div>

                  {/* Affected Files */}
                  <div className="bg-[#121520] p-3 rounded-lg border border-[#1e2233]">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-400 flex items-center gap-1.5 mb-1.5">
                      <FileCode className="w-3 h-3" />
                      Arquivos Afetados:
                    </span>
                    <div className="flex flex-wrap gap-1 font-mono text-[11px]">
                      {affectedFiles.length > 0 ? (
                        affectedFiles.map((file, i) => (
                          <span key={i} className="px-1.5 py-0.5 rounded bg-[#181b28] text-slate-300 border border-[#1e2233]">
                            {file}
                          </span>
                        ))
                      ) : (
                        <span className="text-[#525a7f]">Nenhum arquivo listado</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Next Step */}
                <div className="bg-[#121520] p-2.5 rounded-lg border border-[#1e2233] flex items-start gap-2 text-xs">
                  <ArrowRight className="w-3.5 h-3.5 text-indigo-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <span className="font-semibold text-slate-300">Próximo Passo: </span>
                    <span className="text-slate-300">{s.next_step || 'Dar continuidade ao backlog de tarefas'}</span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
