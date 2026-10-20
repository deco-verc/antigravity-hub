import React, { useState, useEffect } from 'react';
import { SessionRecord, FullProjectDetails } from '../types';
import { api } from '../services/api';
import {
  Clock,
  Calendar,
  CheckCircle2,
  FileText,
  Bookmark,
  ArrowRight,
  Sparkles,
  GitCommit,
  Copy,
  Check
} from 'lucide-react';

interface DecoHubActivityViewProps {
  project: FullProjectDetails;
}

export const DecoHubActivityView: React.FC<DecoHubActivityViewProps> = ({ project }) => {
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    loadSessions();
  }, [project.id]);

  const loadSessions = async () => {
    setLoading(true);
    try {
      const data = await api.getSessions(project.id);
      setSessions(data);
    } catch (err) {
      console.error('Falha ao carregar sessões:', err);
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
    <div className="flex-1 flex flex-col h-full bg-[#080a10] p-8 overflow-hidden max-w-4xl mx-auto w-full">
      {/* 1. Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-white tracking-tight">Atividade Recente</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Checkpoints de memória. Runs, tarefas e sessões dos agentes aparecem no Chat Autônomo.
          </p>
        </div>

        <span className="text-xs text-slate-400 font-mono px-2.5 py-1 rounded-lg bg-[#10131d] border border-[#1e2333]">
          {sessions.length} {sessions.length === 1 ? 'checkpoint' : 'checkpoints'}
        </span>
      </div>

      {/* 2. Timeline de Sessões */}
      <div className="flex-1 overflow-y-auto space-y-4 pr-1">
        {loading ? (
          <div className="text-center py-12 text-xs text-slate-500">
            Carregando linha do tempo...
          </div>
        ) : sessions.length === 0 ? (
          <div className="text-center py-16 text-slate-500 space-y-3">
            <Clock className="w-8 h-8 mx-auto text-slate-600" />
            <p className="text-xs">Nenhuma atividade registrada ainda.</p>
            <p className="text-[11px] text-slate-400">
              Ao concluir tarefas e gerar checkpoints, o histórico aparecerá aqui automaticamente.
            </p>
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
                className="p-5 rounded-2xl bg-[#0d1018] border border-[#1b2033] shadow-sm space-y-3.5 transition-colors hover:border-[#262e45]"
              >
                {/* Header do Registro */}
                <div className="flex items-center justify-between border-b border-[#1b2033] pb-3">
                  <div className="flex items-center gap-3">
                    <span className="px-2.5 py-1 rounded-lg bg-indigo-600/15 text-indigo-300 font-semibold text-xs border border-indigo-500/20">
                      Checkpoint de memória #{s.session_number}
                    </span>
                    <span className="text-xs text-slate-400 flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-slate-500" />
                      <span>{formattedDate}</span>
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => copyRaw(s.id, s.checkpoint_raw)}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#121623] hover:bg-[#1a2030] border border-[#202638] text-[11px] text-slate-300 transition-colors"
                    title="Copiar markdown bruto do checkpoint"
                  >
                    {copiedId === s.id ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-400" />
                        <span className="text-emerald-400">Copiado</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3 text-slate-400" />
                        <span>Copiar Checkpoint</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Itens Implementados */}
                {implementedList.length > 0 && (
                  <div>
                    <span className="text-[11px] font-semibold text-slate-400 block mb-1.5">
                      Implementado:
                    </span>
                    <ul className="space-y-1">
                      {implementedList.map((item, i) => (
                        <li key={i} className="text-xs text-slate-200 flex items-start gap-2">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0 mt-0.5" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Arquivos Modificados */}
                {affectedFiles.length > 0 && (
                  <div>
                    <span className="text-[11px] font-semibold text-slate-400 block mb-1.5">
                      Arquivos Modificados:
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {affectedFiles.map((file, i) => (
                        <span
                          key={i}
                          className="px-2 py-0.5 rounded-md bg-[#121623] border border-[#202638] text-[11px] font-mono text-slate-300"
                        >
                          {file}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Próximo Passo */}
                {s.next_step && (
                  <div className="p-3 rounded-xl bg-[#121623]/80 border border-[#202638] flex items-start gap-2.5">
                    <ArrowRight className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <span className="text-[10px] uppercase font-bold text-indigo-300 tracking-wider block">
                        Próximo Passo Recomendado:
                      </span>
                      <p className="text-xs text-slate-200 mt-0.5 font-medium">
                        {s.next_step}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
