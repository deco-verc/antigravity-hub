import React, { useState, useEffect } from 'react';
import {
  X,
  FlaskConical,
  Play,
  StopCircle,
  TrendingUp,
  TrendingDown,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  Flame,
  FileCode,
  Clock,
  Sparkles,
  RefreshCw,
  GitCommit,
  ShieldCheck,
  ChevronRight
} from 'lucide-react';

export interface ResearchExperiment {
  id: string;
  sequence: number;
  hypothesis: string;
  branch: string;
  commitHash: string | null;
  metricBefore: number;
  metricAfter: number;
  delta: number;
  improvementPct: number;
  durationMs: number;
  filesChanged: string[];
  linesAdded: number;
  linesRemoved: number;
  complexityDelta: number;
  status: 'BASELINE' | 'KEEP' | 'DISCARD' | 'CRASH';
  reason: string;
  stdoutExcerpt?: string;
  createdAt: string;
}

export interface ResearchRunData {
  id: string;
  projectId: string;
  objective: string;
  primaryMetric: string;
  direction: 'MINIMIZE' | 'MAXIMIZE';
  measurementCommand: string;
  status: 'running' | 'paused' | 'completed' | 'stopped';
  baselineMetric: number | null;
  bestMetric: number | null;
  bestCommit: string | null;
  branchName: string;
  allowedFiles: string[];
  protectedFiles: string[];
  keepCount: number;
  discardCount: number;
  crashCount: number;
  currentExperiment: number;
  maxExperiments: number;
  currentHypothesis: string | null;
  overallImprovementPct: number;
  experiments: ResearchExperiment[];
}

interface ResearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string | null;
  projectName?: string;
}

export const ResearchModal: React.FC<ResearchModalProps> = ({
  isOpen,
  onClose,
  projectId,
  projectName
}) => {
  const [activeRun, setActiveRun] = useState<ResearchRunData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // New run form state
  const [showNewForm, setShowNewForm] = useState(false);
  const [objective, setObjective] = useState('');
  const [primaryMetric, setPrimaryMetric] = useState('latency_ms');
  const [direction, setDirection] = useState<'MINIMIZE' | 'MAXIMIZE'>('MINIMIZE');
  const [measurementCommand, setMeasurementCommand] = useState('node benchmark.js');
  const [maxExperiments, setMaxExperiments] = useState(20);
  const [maxHours, setMaxHours] = useState(8);
  const [allowedFiles, setAllowedFiles] = useState('src/');
  const [protectedFiles, setProtectedFiles] = useState('benchmark.js, test/');
  const [customHypothesis, setCustomHypothesis] = useState('');

  const fetchActiveRun = async () => {
    if (!projectId) return;
    setIsLoading(true);
    try {
      const res = await fetch(`http://127.0.0.1:3001/api/projects/${projectId}/research/active`);
      if (res.ok) {
        const data = await res.json();
        setActiveRun(data);
        if (!data) setShowNewForm(true);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && projectId) {
      fetchActiveRun();
    }
  }, [isOpen, projectId]);

  const handleStartRun = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectId) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`http://127.0.0.1:3001/api/projects/${projectId}/research/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          objective,
          primaryMetric,
          direction,
          measurementCommand,
          maxExperiments: Number(maxExperiments),
          maxExperimentTime: Number(maxHours),
          allowedFiles: allowedFiles.split(',').map(s => s.trim()).filter(Boolean),
          protectedFiles: protectedFiles.split(',').map(s => s.trim()).filter(Boolean)
        })
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Falha ao iniciar Research Run');
      }
      const newRun = await res.json();
      setActiveRun(newRun);
      setShowNewForm(false);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStopRun = async () => {
    if (!projectId || !activeRun) return;
    setIsSubmitting(true);
    try {
      const res = await fetch(`http://127.0.0.1:3001/api/projects/${projectId}/research/${activeRun.id}/stop`, {
        method: 'POST'
      });
      if (res.ok) {
        const updated = await res.json();
        setActiveRun(updated);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTriggerExperiment = async () => {
    if (!projectId || !activeRun) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`http://127.0.0.1:3001/api/projects/${projectId}/research/${activeRun.id}/experiment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hypothesis: customHypothesis || `Experimento #${(activeRun.experiments?.length || 0) + 1}: Otimização autônoma de parâmetros`
        })
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Falha no experimento');
      }
      setCustomHypothesis('');
      await fetchActiveRun();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[#0f131f] border border-[#232b45] w-full max-w-5xl max-h-[90vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden text-slate-200">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#1e253e] flex items-center justify-between bg-[#141929]/80 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400">
              <FlaskConical className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white tracking-tight">Research Run (Autoresearch Mode)</h2>
                {activeRun && (
                  <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase tracking-wider ${
                    activeRun.status === 'running'
                      ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30 animate-pulse'
                      : activeRun.status === 'completed'
                        ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                        : 'bg-slate-500/15 text-slate-400 border border-slate-500/30'
                  }`}>
                    {activeRun.status}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400">
                Otimização autônoma orientada a métricas (Baseline → Experiment → Measure → Keep / Discard / Revert)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {activeRun && !showNewForm && (
              <button
                onClick={() => setShowNewForm(true)}
                className="px-2.5 py-1.5 rounded-lg bg-[#181d2f] hover:bg-[#20273f] border border-[#252c45] text-xs font-semibold text-slate-300 hover:text-white transition-colors"
              >
                + Novo Run
              </button>
            )}
            <button
              onClick={fetchActiveRun}
              title="Recarregar"
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[#1f2742] transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[#1f2742] transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {error && (
          <div className="mx-6 mt-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {showNewForm || !activeRun ? (
            /* Formulário para Novo Research Run */
            <form onSubmit={handleStartRun} className="max-w-2xl mx-auto space-y-4">
              <div className="border-b border-[#1f2742] pb-3">
                <h3 className="text-sm font-bold text-white">Configurar Novo Experimento Autoresearch</h3>
                <p className="text-xs text-slate-400">
                  O sistema medirá o baseline primeiro sem alterações. Em seguida, iniciará o loop autônomo.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Objetivo da Otimização</label>
                <input
                  type="text"
                  required
                  value={objective}
                  onChange={e => setObjective(e.target.value)}
                  placeholder="ex: Reduzir tempo de execução do endpoint /api/search"
                  className="w-full bg-[#121625] border border-[#222a42] rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 outline-none focus:border-purple-500/60"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Métrica Primária</label>
                  <input
                    type="text"
                    required
                    value={primaryMetric}
                    onChange={e => setPrimaryMetric(e.target.value)}
                    placeholder="latency_ms, bundle_bytes, score, val_bpb"
                    className="w-full bg-[#121625] border border-[#222a42] rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 outline-none focus:border-purple-500/60 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Direção da Otimização</label>
                  <select
                    value={direction}
                    onChange={e => setDirection(e.target.value as any)}
                    className="w-full bg-[#121625] border border-[#222a42] rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-purple-500/60"
                  >
                    <option value="MINIMIZE">MINIMIZE (Menor é melhor: latência, bytes, etc.)</option>
                    <option value="MAXIMIZE">MAXIMIZE (Maior é melhor: throughput, score, etc.)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Comando de Medição no Terminal</label>
                <input
                  type="text"
                  required
                  value={measurementCommand}
                  onChange={e => setMeasurementCommand(e.target.value)}
                  placeholder="node benchmark.js ou npm test"
                  className="w-full bg-[#121625] border border-[#222a42] rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 outline-none focus:border-purple-500/60 font-mono"
                />
                <p className="text-[10px] text-slate-500 mt-1">
                  O comando deve retornar a métrica numérica no stdout (ex: "latency: 120ms" ou JSON {"{"}"metric": 120{"}"}).
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Arquivos Permitidos para Edição</label>
                  <input
                    type="text"
                    value={allowedFiles}
                    onChange={e => setAllowedFiles(e.target.value)}
                    placeholder="src/"
                    className="w-full bg-[#121625] border border-[#222a42] rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 outline-none focus:border-purple-500/60 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Arquivos Protegidos (Imutáveis)</label>
                  <input
                    type="text"
                    value={protectedFiles}
                    onChange={e => setProtectedFiles(e.target.value)}
                    placeholder="benchmark.js, test/"
                    className="w-full bg-[#121625] border border-[#222a42] rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 outline-none focus:border-purple-500/60 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Limite de Experimentos</label>
                  <input
                    type="number"
                    value={maxExperiments}
                    onChange={e => setMaxExperiments(Number(e.target.value))}
                    className="w-full bg-[#121625] border border-[#222a42] rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-purple-500/60"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Tempo Máximo (Horas / Overnight)</label>
                  <input
                    type="number"
                    value={maxHours}
                    onChange={e => setMaxHours(Number(e.target.value))}
                    className="w-full bg-[#121625] border border-[#222a42] rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-purple-500/60"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-3">
                {activeRun && (
                  <button
                    type="button"
                    onClick={() => setShowNewForm(false)}
                    className="px-4 py-2 rounded-xl bg-[#161a29] border border-[#242b44] text-xs font-medium text-slate-300"
                  >
                    Cancelar
                  </button>
                )}
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-semibold text-xs shadow-lg shadow-purple-600/30 flex items-center gap-2"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>{isSubmitting ? 'Medindo Baseline...' : 'Iniciar Autoresearch Run'}</span>
                </button>
              </div>
            </form>
          ) : (
            /* Dashboard do Research Run Ativo */
            <div className="space-y-6">
              {/* Executive Overview Banner */}
              <div className="p-4 rounded-2xl bg-[#121626] border border-[#222a44] space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-purple-400 font-mono">
                      Research Run Objetivo
                    </span>
                    <h3 className="text-base font-bold text-white mt-0.5">{activeRun.objective}</h3>
                    <div className="flex items-center gap-2 mt-1 text-xs text-slate-400 font-mono">
                      <span>Branch: <code className="text-indigo-300">{activeRun.branchName}</code></span>
                      <span>•</span>
                      <span>Comando: <code className="text-indigo-300">{activeRun.measurementCommand}</code></span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {activeRun.status === 'running' && (
                      <button
                        onClick={handleStopRun}
                        disabled={isSubmitting}
                        className="px-3 py-1.5 rounded-lg bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/40 text-xs font-semibold text-rose-300 flex items-center gap-1.5 transition-colors"
                      >
                        <StopCircle className="w-3.5 h-3.5" />
                        <span>PARAR RUN</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* 4 Metric Cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2">
                  {/* Baseline */}
                  <div className="p-3 rounded-xl bg-[#0b0e17] border border-[#1c2338]">
                    <div className="text-[10px] uppercase font-bold text-slate-400 font-mono">Baseline</div>
                    <div className="text-lg font-black text-white mt-1">
                      {activeRun.baselineMetric !== null ? `${activeRun.baselineMetric} ${activeRun.primaryMetric}` : 'N/A'}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">Medição inicial fixa</div>
                  </div>

                  {/* Best Metric */}
                  <div className="p-3 rounded-xl bg-[#0b0e17] border border-emerald-500/30">
                    <div className="text-[10px] uppercase font-bold text-emerald-400 font-mono">Melhor Marca</div>
                    <div className="text-lg font-black text-emerald-300 mt-1">
                      {activeRun.bestMetric !== null ? `${activeRun.bestMetric} ${activeRun.primaryMetric}` : 'N/A'}
                    </div>
                    <div className="text-[10px] text-emerald-500 mt-0.5 font-mono">
                      {activeRun.bestCommit ? `commit ${activeRun.bestCommit.slice(0, 7)}` : 'HEAD'}
                    </div>
                  </div>

                  {/* Improvement */}
                  <div className="p-3 rounded-xl bg-[#0b0e17] border border-purple-500/30">
                    <div className="text-[10px] uppercase font-bold text-purple-400 font-mono">Melhoria Global</div>
                    <div className="text-lg font-black text-purple-300 mt-1 flex items-center gap-1">
                      <TrendingUp className="w-4 h-4 text-purple-400" />
                      <span>{activeRun.overallImprovementPct > 0 ? `+${activeRun.overallImprovementPct}%` : `${activeRun.overallImprovementPct}%`}</span>
                    </div>
                    <div className="text-[10px] text-purple-400/80 mt-0.5">sobre o baseline</div>
                  </div>

                  {/* Experiments count breakdown */}
                  <div className="p-3 rounded-xl bg-[#0b0e17] border border-[#1c2338]">
                    <div className="text-[10px] uppercase font-bold text-slate-400 font-mono">Experimentos</div>
                    <div className="text-lg font-black text-white mt-1">
                      {activeRun.experiments?.length || 0}
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px] font-mono mt-0.5">
                      <span className="text-emerald-400">KEEP {activeRun.keepCount}</span>
                      <span className="text-slate-600">|</span>
                      <span className="text-amber-400">DISCARD {activeRun.discardCount}</span>
                      <span className="text-slate-600">|</span>
                      <span className="text-rose-400">CRASH {activeRun.crashCount}</span>
                    </div>
                  </div>
                </div>

                {/* Current Active Hypothesis Banner */}
                {activeRun.status === 'running' && (
                  <div className="p-3 rounded-xl bg-purple-950/20 border border-purple-500/30 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-purple-400 animate-ping" />
                      <span className="text-slate-300">
                        <strong className="text-purple-300">Atual:</strong> #{activeRun.currentExperiment + 1} {activeRun.currentHypothesis || 'Executando otimizações no código...'}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono text-purple-400">Modo Autônomo Ativo</span>
                  </div>
                )}
              </div>

              {/* Manual/Step Experiment Trigger Bar */}
              <div className="p-3.5 rounded-xl bg-[#101423] border border-[#1e253e] flex items-center gap-3">
                <input
                  type="text"
                  value={customHypothesis}
                  onChange={e => setCustomHypothesis(e.target.value)}
                  placeholder="Propor hipótese experimental (ex: Aplicar memoization no cálculo de totais)..."
                  className="flex-1 bg-[#0b0e18] border border-[#212940] rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 outline-none focus:border-purple-500/60"
                />
                <button
                  onClick={handleTriggerExperiment}
                  disabled={isSubmitting || activeRun.status !== 'running'}
                  className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-semibold text-xs shadow-md shadow-purple-600/20 flex items-center gap-1.5 transition-colors"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>{isSubmitting ? 'Executando...' : 'Rodar Experimento'}</span>
                </button>
              </div>

              {/* Experiment Ledger Table */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300 font-mono">
                    Experiment Ledger (Tabela de Resultados)
                  </h4>
                  <span className="text-[11px] text-slate-500 font-mono">
                    {activeRun.experiments?.length || 0} registros persistidos
                  </span>
                </div>

                <div className="border border-[#1e253e] rounded-xl overflow-hidden bg-[#0c0f1b]">
                  <table className="w-full text-left text-xs font-sans">
                    <thead className="bg-[#121626] border-b border-[#1e253e] text-[10px] uppercase font-mono text-slate-400 font-bold">
                      <tr>
                        <th className="py-2.5 px-3">#</th>
                        <th className="py-2.5 px-3">Hipótese</th>
                        <th className="py-2.5 px-3">Métrica</th>
                        <th className="py-2.5 px-3">Delta (%)</th>
                        <th className="py-2.5 px-3">LOC (Δ)</th>
                        <th className="py-2.5 px-3">Status</th>
                        <th className="py-2.5 px-3">Commit</th>
                        <th className="py-2.5 px-3">Ação / Revert</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#181d2f]">
                      {activeRun.experiments?.map((exp) => (
                        <tr key={exp.id} className="hover:bg-[#121727] transition-colors">
                          <td className="py-2.5 px-3 font-mono text-slate-400">
                            {exp.sequence === 0 ? 'BASE' : `#${exp.sequence}`}
                          </td>
                          <td className="py-2.5 px-3 font-medium text-slate-200 max-w-xs truncate" title={exp.hypothesis}>
                            {exp.hypothesis}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-slate-300">
                            {exp.metricBefore} → <strong className="text-white">{exp.metricAfter}</strong>
                          </td>
                          <td className="py-2.5 px-3 font-mono">
                            {exp.status === 'BASELINE' ? (
                              <span className="text-slate-500">-</span>
                            ) : exp.improvementPct > 0 ? (
                              <span className="text-emerald-400 font-bold">+{exp.improvementPct}%</span>
                            ) : (
                              <span className="text-rose-400">{exp.improvementPct}%</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-[11px]">
                            {exp.complexityDelta > 0 ? (
                              <span className="text-slate-400">+{exp.complexityDelta}</span>
                            ) : exp.complexityDelta < 0 ? (
                              <span className="text-emerald-400">{exp.complexityDelta}</span>
                            ) : (
                              <span className="text-slate-500">0</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase tracking-wider ${
                              exp.status === 'KEEP'
                                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                : exp.status === 'DISCARD'
                                  ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                                  : exp.status === 'CRASH'
                                    ? 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                                    : 'bg-indigo-500/15 text-indigo-400 border border-indigo-500/30'
                            }`}>
                              {exp.status}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 font-mono text-[11px] text-slate-400">
                            {exp.commitHash ? exp.commitHash.slice(0, 7) : '-'}
                          </td>
                          <td className="py-2.5 px-3 text-[11px] text-slate-400">
                            {exp.status === 'KEEP' ? (
                              <span className="text-emerald-400 font-semibold flex items-center gap-1">
                                <CheckCircle2 className="w-3 h-3" /> Commit mantido
                              </span>
                            ) : exp.status === 'DISCARD' ? (
                              <span className="text-amber-400 flex items-center gap-1">
                                <RotateCcw className="w-3 h-3" /> Revertido
                              </span>
                            ) : exp.status === 'CRASH' ? (
                              <span className="text-rose-400 flex items-center gap-1">
                                <Flame className="w-3 h-3" /> Revertido (Crash)
                              </span>
                            ) : (
                              <span className="text-indigo-400">Ponto zero</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
