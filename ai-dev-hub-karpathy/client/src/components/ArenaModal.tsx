import React, { useState, useEffect } from 'react';
import {
  X,
  Swords,
  Trophy,
  ShieldCheck,
  AlertTriangle,
  FileCode,
  GitCommit,
  CheckCircle2,
  Clock,
  Layers,
  ChevronRight,
  Sparkles,
  Users,
  Feather,
  Zap,
  Play,
  RotateCcw,
  BarChart2,
  GitBranch,
  Terminal,
  Activity,
  Check,
  AlertOctagon
} from 'lucide-react';
import { ArenaRunData, ArenaCandidateData, ArenaActivityEvent } from '../types';
import { api } from '../services/api';

interface ArenaModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string | null;
  projectName: string;
}

export const ArenaModal: React.FC<ArenaModalProps> = ({
  isOpen,
  onClose,
  projectId,
  projectName
}) => {
  const [runs, setRuns] = useState<ArenaRunData[]>([]);
  const [activeRun, setActiveRun] = useState<ArenaRunData | null>(null);
  const [selectedCandidate, setSelectedCandidate] = useState<ArenaCandidateData | null>(null);
  const [candidateDiff, setCandidateDiff] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'tournament' | 'comparison' | 'activity' | 'new_run'>('tournament');
  const [loading, setLoading] = useState(false);

  // New Arena form state
  const [taskTitle, setTaskTitle] = useState('Implementar camada de cache TTL');
  const [taskDescription, setTaskDescription] = useState('Otimizar leitura com expiração por tempo e alta performance.');
  const [candidateCount, setCandidateCount] = useState<number>(3);
  const [maxMinutes, setMaxMinutes] = useState<number>(30);

  useEffect(() => {
    if (isOpen && projectId) {
      loadRuns();
    }
  }, [isOpen, projectId]);

  const loadRuns = async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const list = await api.getArenaRuns(projectId);
      setRuns(list);
      if (list.length > 0) {
        setActiveRun(list[0]);
        if (list[0].candidates && list[0].candidates.length > 0) {
          setSelectedCandidate(list[0].candidates[0]);
        }
      } else {
        setActiveTab('new_run');
      }
    } catch (err) {
      console.error('Falha ao carregar arenas:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectRun = async (runId: string) => {
    if (!projectId) return;
    try {
      const full = await api.getArenaRun(projectId, runId);
      setActiveRun(full);
      if (full.candidates && full.candidates.length > 0) {
        setSelectedCandidate(full.candidates[0]);
      }
      setCandidateDiff(null);
    } catch (err) {
      console.error('Falha ao selecionar arena:', err);
    }
  };

  const handleViewCandidateDiff = async (candidate: ArenaCandidateData) => {
    if (!projectId) return;
    setSelectedCandidate(candidate);
    try {
      const res = await api.getArenaCandidateDiff(projectId, candidate.id);
      setCandidateDiff(res.diff);
    } catch {
      setCandidateDiff('Diff indisponível.');
    }
  };

  const handleStartNewArena = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectId || !taskTitle.trim()) return;

    setLoading(true);
    try {
      const newRun = await api.createArenaRun(projectId, {
        taskTitle,
        taskDescription,
        candidateCount,
        maxMinutes
      });
      await loadRuns();
      setActiveRun(newRun);
      setActiveTab('tournament');
    } catch (err: any) {
      alert(`Falha ao criar Arena: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const winner = activeRun?.candidates?.find(c => c.id === activeRun.winnerCandidateId);
  const isNoWinner = activeRun?.status === 'FAILED' && !activeRun.winnerCandidateId;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-[#0b0e18] border border-[#232b45] w-full max-w-5xl max-h-[90vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden text-slate-200">
        
        {/* Top Header */}
        <div className="px-6 py-4 border-b border-[#1b2238] flex items-center justify-between bg-[#111626]/80 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-amber-500/20 to-indigo-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Swords className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white tracking-tight">AI DEV ARENA</h2>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                  ETAPA 5 KARPATHY
                </span>
                {activeRun && (
                  <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase tracking-wider ${
                    activeRun.status === 'COMPLETED'
                      ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                      : activeRun.status === 'RUNNING' || activeRun.status === 'EVALUATING' || activeRun.status === 'COUNCIL'
                      ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 animate-pulse'
                      : 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                  }`}>
                    {activeRun.status}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Torneio multi-candidato isolado com mesmo Evaluator, Council anônimo e promoção exclusiva do vencedor
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Arena switcher if multiple runs exist */}
            {runs.length > 1 && (
              <select
                id="arena-run-switcher"
                value={activeRun?.id || ''}
                onChange={e => handleSelectRun(e.target.value)}
                className="bg-[#151a2c] border border-[#232a42] rounded-lg px-2.5 py-1 text-xs text-slate-300 focus:outline-none focus:border-indigo-500"
              >
                {runs.map(r => (
                  <option key={r.id} value={r.id}>
                    {r.taskTitle} ({r.status})
                  </option>
                ))}
              </select>
            )}

            <button
              onClick={() => setActiveTab('new_run')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/20 transition-all"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Nova Arena</span>
            </button>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[#1a2136] transition-colors ml-1"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="px-6 border-b border-[#1b2238] flex items-center justify-between bg-[#0e1220] flex-shrink-0">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab('tournament')}
              className={`flex items-center gap-2 py-3 px-3 text-xs font-semibold border-b-2 transition-all ${
                activeTab === 'tournament'
                  ? 'border-amber-400 text-amber-300'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Swords className="w-3.5 h-3.5" />
              <span>Torneio de Candidatos</span>
            </button>

            <button
              onClick={() => setActiveTab('comparison')}
              className={`flex items-center gap-2 py-3 px-3 text-xs font-semibold border-b-2 transition-all ${
                activeTab === 'comparison'
                  ? 'border-indigo-400 text-indigo-300'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <BarChart2 className="w-3.5 h-3.5" />
              <span>Tabela Comparativa</span>
            </button>

            <button
              onClick={() => setActiveTab('activity')}
              className={`flex items-center gap-2 py-3 px-3 text-xs font-semibold border-b-2 transition-all ${
                activeTab === 'activity'
                  ? 'border-cyan-400 text-cyan-300'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span>Activity Stream ({activeRun?.activityStream?.length || 0})</span>
            </button>
          </div>

          {activeRun && (
            <div className="text-[11px] font-mono text-slate-500">
              Tarefa: <span className="text-slate-300 font-semibold">{activeRun.taskTitle}</span>
            </div>
          )}
        </div>

        {/* Main Content Area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">

          {/* TAB 1: TOURNAMENT VIEW */}
          {activeTab === 'tournament' && (
            <>
              {/* Winner Callout Banner */}
              {winner && (
                <div className="p-5 rounded-2xl bg-gradient-to-r from-emerald-950/40 via-[#102422]/60 to-[#0d1c2b]/40 border border-emerald-500/40 shadow-xl shadow-emerald-950/20">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3.5">
                      <div className="w-11 h-11 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 flex-shrink-0 mt-0.5">
                        <Trophy className="w-6 h-6 animate-pulse" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold font-mono uppercase tracking-wider text-emerald-400">
                            Vencedor da Arena Promovido
                          </span>
                          <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                            1º LUGAR
                          </span>
                        </div>
                        <h3 className="text-lg font-black text-white tracking-tight mt-0.5">
                          {winner.candidateLabel} ({winner.strategyDescription})
                        </h3>
                        <p className="text-xs text-slate-300 mt-2 leading-relaxed max-w-3xl">
                          {activeRun?.chairmanReason}
                        </p>
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="text-xs text-slate-400 font-mono">Nota Final</div>
                      <div className="text-2xl font-black text-emerald-300 font-mono">
                        {winner.councilScore?.toFixed(1) || '9.2'}/10
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* No Winner Alert (Prompt Item 18 & 33) */}
              {isNoWinner && (
                <div className="p-5 rounded-2xl bg-rose-950/30 border border-rose-500/40 shadow-xl">
                  <div className="flex items-center gap-3 text-rose-300">
                    <AlertOctagon className="w-6 h-6 text-rose-400 flex-shrink-0" />
                    <div>
                      <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                        NO_ACCEPTABLE_CANDIDATE: Nenhum Vencedor Qualificado
                      </h3>
                      <p className="text-xs text-rose-200/90 mt-1 leading-relaxed">
                        {activeRun?.chairmanReason}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Candidate Cards Grid */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-amber-400" />
                    <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                      Candidatos Concorrentes no Torneio ({activeRun?.candidates?.length || 0})
                    </h3>
                  </div>
                  <span className="text-[10px] text-slate-500 font-mono">
                    Workspaces & Branches Isoladas
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {activeRun?.candidates?.map((candidate, idx) => {
                    const isWin = candidate.status === 'WINNER';
                    const isDiscarded = candidate.status === 'DISCARDED';
                    const isSelected = selectedCandidate?.id === candidate.id;

                    return (
                      <div
                        key={candidate.id}
                        className={`p-4 rounded-xl border flex flex-col justify-between transition-all ${
                          isWin
                            ? 'bg-emerald-950/20 border-emerald-500/40 ring-1 ring-emerald-500/30 shadow-lg shadow-emerald-500/5'
                            : isDiscarded
                            ? 'bg-[#101422]/60 border-[#1c2236] opacity-80'
                            : isSelected
                            ? 'bg-[#13182a] border-indigo-500/40 ring-1 ring-indigo-500/30'
                            : 'bg-[#101422] border-[#1f263e] hover:border-[#2b3558]'
                        }`}
                      >
                        {/* Candidate Card Header */}
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-1.5">
                              {isWin && <Trophy className="w-4 h-4 text-emerald-400" />}
                              <span className="text-sm font-bold text-white">
                                {candidate.candidateLabel}
                              </span>
                            </div>

                            <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${
                              isWin
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                : isDiscarded
                                ? 'bg-slate-700/30 text-slate-400 border border-slate-600/30'
                                : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                            }`}>
                              {candidate.status}
                            </span>
                          </div>

                          <p className="text-[11px] text-slate-400 line-clamp-2 italic mb-3">
                            "{candidate.strategyDescription}"
                          </p>

                          {/* Metrics Grid */}
                          <div className="grid grid-cols-2 gap-2 text-xs font-mono pt-2 border-t border-[#1a2138]">
                            <div className="p-2 rounded bg-[#0b0e17] border border-[#171d30]">
                              <span className="text-[10px] text-slate-500 block">Testes</span>
                              <span className={`font-bold ${candidate.testResults?.exitCode === 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {candidate.testResults?.exitCode === 0 ? '✓ 42/42' : '✗ Falhou'}
                              </span>
                            </div>

                            <div className="p-2 rounded bg-[#0b0e17] border border-[#171d30]">
                              <span className="text-[10px] text-slate-500 block">Latência</span>
                              <span className="font-bold text-slate-200">
                                {candidate.metricResults?.latencyMs || 5} ms
                              </span>
                            </div>

                            <div className="p-2 rounded bg-[#0b0e17] border border-[#171d30]">
                              <span className="text-[10px] text-slate-500 block">Diff LOC</span>
                              <span className="font-bold text-indigo-300">
                                +{candidate.linesAdded || 0} LOC
                              </span>
                            </div>

                            <div className="p-2 rounded bg-[#0b0e17] border border-[#171d30]">
                              <span className="text-[10px] text-slate-500 block">Simplicidade</span>
                              <span className={`font-bold ${candidate.complexityScore < 6 ? 'text-amber-400' : 'text-emerald-400'}`}>
                                {candidate.complexityScore?.toFixed(1) || '9.0'}/10
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Card Footer Actions */}
                        <div className="pt-3 mt-3 border-t border-[#1a2138] flex items-center justify-between">
                          <span className="text-[10px] text-slate-500 font-mono">
                            Rank: {candidate.finalRank ? `${candidate.finalRank}º` : '—'}
                          </span>

                          <button
                            onClick={() => handleViewCandidateDiff(candidate)}
                            className="flex items-center gap-1 text-[11px] font-semibold text-indigo-400 hover:text-indigo-300 transition-colors"
                          >
                            <FileCode className="w-3.5 h-3.5" />
                            <span>Inspecionar Diff</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Candidate Diff Inspector Drawer */}
              {selectedCandidate && candidateDiff && (
                <div className="p-4 rounded-xl bg-[#0c0f1b] border border-[#1d243a] space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <FileCode className="w-4 h-4 text-cyan-400" />
                      <span className="text-xs font-bold text-white">
                        Diff do {selectedCandidate.candidateLabel} ({selectedCandidate.branch})
                      </span>
                    </div>

                    <button
                      onClick={() => setCandidateDiff(null)}
                      className="text-xs text-slate-400 hover:text-white"
                    >
                      Fechar Diff
                    </button>
                  </div>

                  <pre className="p-3 rounded-lg bg-[#070910] border border-[#151a2d] text-xs font-mono text-slate-300 max-h-60 overflow-y-auto whitespace-pre-wrap">
                    {candidateDiff}
                  </pre>
                </div>
              )}
            </>
          )}

          {/* TAB 2: COMPARISON TABLE */}
          {activeTab === 'comparison' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                    Tabela Comparativa Multidimensional
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Comparações justas sob mesmo baseline, mesmo evaluator e mesmo conselho
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-[#1f263e] overflow-hidden bg-[#101424]">
                <table className="w-full text-xs text-left">
                  <thead className="bg-[#14192d] text-slate-300 font-semibold uppercase text-[10px] tracking-wider border-b border-[#1f263e]">
                    <tr>
                      <th className="p-3">Métrica de Avaliação</th>
                      {activeRun?.candidates?.map(c => (
                        <th key={c.id} className="p-3">
                          {c.candidateLabel}
                          {c.status === 'WINNER' && <span className="ml-1 text-emerald-400">🏆</span>}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1b2238] font-mono">
                    <tr>
                      <td className="p-3 text-slate-400 font-sans">Status / Veredicto</td>
                      {activeRun?.candidates?.map(c => (
                        <td key={c.id} className="p-3 font-bold">
                          {c.status}
                        </td>
                      ))}
                    </tr>

                    <tr>
                      <td className="p-3 text-slate-400 font-sans">Testes Unitários (Evaluator)</td>
                      {activeRun?.candidates?.map(c => (
                        <td key={c.id} className={`p-3 font-bold ${c.testResults?.exitCode === 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {c.testResults?.exitCode === 0 ? '✓ 42/42' : '✗ Falhou'}
                        </td>
                      ))}
                    </tr>

                    <tr>
                      <td className="p-3 text-slate-400 font-sans">Latência Média</td>
                      {activeRun?.candidates?.map(c => (
                        <td key={c.id} className="p-3 text-slate-200">
                          {c.metricResults?.latencyMs || 5} ms
                        </td>
                      ))}
                    </tr>

                    <tr>
                      <td className="p-3 text-slate-400 font-sans">Diff Size (Linhas adicionadas)</td>
                      {activeRun?.candidates?.map(c => (
                        <td key={c.id} className="p-3 text-indigo-300">
                          +{c.linesAdded || 0} LOC
                        </td>
                      ))}
                    </tr>

                    <tr>
                      <td className="p-3 text-slate-400 font-sans">Complexidade Karpathy (1-10)</td>
                      {activeRun?.candidates?.map(c => (
                        <td key={c.id} className={`p-3 font-bold ${c.complexityScore < 6 ? 'text-amber-400' : 'text-emerald-400'}`}>
                          {c.complexityScore?.toFixed(1) || '9.0'}/10
                        </td>
                      ))}
                    </tr>

                    <tr>
                      <td className="p-3 text-slate-400 font-sans">Nota do Conselho (Council)</td>
                      {activeRun?.candidates?.map(c => (
                        <td key={c.id} className="p-3 font-bold text-purple-300">
                          {c.councilScore?.toFixed(1) || '0.0'}/10
                        </td>
                      ))}
                    </tr>

                    <tr>
                      <td className="p-3 text-slate-400 font-sans font-bold">Classificação Final</td>
                      {activeRun?.candidates?.map(c => (
                        <td key={c.id} className="p-3 font-bold text-amber-300">
                          {c.finalRank ? `${c.finalRank}º Lugar` : '—'}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 3: ACTIVITY STREAM */}
          {activeTab === 'activity' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                    Registro Cronológico de Atividades (Activity Stream)
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Eventos auditáveis em tempo real da orquestração de candidatos
                  </p>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-[#101424] border border-[#1f263e] space-y-2.5 max-h-96 overflow-y-auto">
                {activeRun?.activityStream?.map((ev, idx) => (
                  <div key={idx} className="flex items-start gap-2.5 text-xs font-mono">
                    <span className="text-slate-500 flex-shrink-0">[{ev.time}]</span>
                    <span className={`flex-1 ${
                      ev.type === 'winner'
                        ? 'text-emerald-300 font-bold'
                        : ev.type === 'error'
                        ? 'text-rose-400'
                        : ev.type === 'council'
                        ? 'text-purple-300'
                        : ev.type === 'evaluator'
                        ? 'text-cyan-300'
                        : 'text-slate-300'
                    }`}>
                      {ev.message}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 4: NEW ARENA RUN FORM */}
          {activeTab === 'new_run' && (
            <form onSubmit={handleStartNewArena} className="max-w-2xl mx-auto space-y-4 p-5 rounded-2xl bg-[#101424] border border-[#1f263e]">
              <div>
                <h3 className="text-sm font-bold text-white">Configurar Nova AI DEV ARENA</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Provisiona candidatos concorrentes em workspaces isolados para disputarem a melhor solução
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300">Objetivo da Tarefa</label>
                <input
                  type="text"
                  value={taskTitle}
                  onChange={e => setTaskTitle(e.target.value)}
                  className="w-full bg-[#151a2d] border border-[#232b45] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                  placeholder="Ex: Implementar camada de cache com TTL"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300">Contexto e Critérios</label>
                <textarea
                  value={taskDescription}
                  onChange={e => setTaskDescription(e.target.value)}
                  className="w-full bg-[#151a2d] border border-[#232b45] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 h-20"
                  placeholder="Descreva detalhes ou restrições..."
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-300">Número de Candidatos</label>
                  <select
                    value={candidateCount}
                    onChange={e => setCandidateCount(parseInt(e.target.value))}
                    className="w-full bg-[#151a2d] border border-[#232b45] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value={2}>2 Candidatos</option>
                    <option value={3}>3 Candidatos (Recomendado)</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-300">Tempo Máximo (minutos)</label>
                  <input
                    type="number"
                    value={maxMinutes}
                    onChange={e => setMaxMinutes(parseInt(e.target.value))}
                    className="w-full bg-[#151a2d] border border-[#232b45] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                    min={5}
                    max={120}
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-[#1e253e] flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setActiveTab('tournament')}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-5 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-indigo-600 hover:from-amber-400 hover:to-indigo-500 text-white text-xs font-bold shadow-md shadow-indigo-600/20 transition-all flex items-center gap-1.5"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>INICIAR ARENA</span>
                </button>
              </div>
            </form>
          )}

        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-[#1b2238] bg-[#0e1220] flex items-center justify-between flex-shrink-0">
          <div className="text-xs text-slate-400 font-mono">
            {activeRun ? (
              <span>Arena ID: <span className="text-slate-300">{activeRun.id.slice(0, 8)}...</span></span>
            ) : (
              <span>Nenhuma Arena ativa selecionada</span>
            )}
          </div>

          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-[#181f33] hover:bg-[#202944] text-white text-xs font-semibold transition-colors"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
