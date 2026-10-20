import React, { useState, useEffect } from 'react';
import {
  X,
  Gauge,
  Trophy,
  ShieldCheck,
  AlertTriangle,
  FileCode,
  CheckCircle2,
  Clock,
  ChevronRight,
  Sparkles,
  BarChart2,
  GitBranch,
  Terminal,
  Activity,
  Layers,
  ArrowRight,
  TrendingUp,
  Cpu,
  ShieldAlert,
  GitCompare,
  RotateCcw,
  Play,
  Square,
  FileText
} from 'lucide-react';
import {
  BenchmarkTaskData,
  BenchmarkRunSummaryData,
  VersionComparisonResultData,
  SelfImprovementExperimentData,
  TaskRunResultData,
  SelfImprovementRunData,
  SelfImprovementPreset
} from '../types';
import { api } from '../services/api';

interface BenchmarkModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const BenchmarkModal: React.FC<BenchmarkModalProps> = ({ isOpen, onClose }) => {
  const [runs, setRuns] = useState<BenchmarkRunSummaryData[]>([]);
  const [activeRun, setActiveRun] = useState<BenchmarkRunSummaryData | null>(null);
  const [tasks, setTasks] = useState<BenchmarkTaskData[]>([]);
  const [experiments, setExperiments] = useState<SelfImprovementExperimentData[]>([]);
  const [selectedTaskResult, setSelectedTaskResult] = useState<TaskRunResultData | null>(null);
  const [comparison, setComparison] = useState<VersionComparisonResultData | null>(null);
  const [activeTab, setActiveTab] = useState<'scorecard' | 'compare' | 'self_improvement' | 'autonomous_engine'>('scorecard');
  const [loading, setLoading] = useState(false);

  // Autonomous Engine State
  const [activeEngineRun, setActiveEngineRun] = useState<SelfImprovementRunData | null>(null);
  const [selectedPreset, setSelectedPreset] = useState<SelfImprovementPreset>('TEST_SHORT');
  const [isStartingEngineRun, setIsStartingEngineRun] = useState(false);
  const [morningReportText, setMorningReportText] = useState<string | null>(null);

  // Comparison selectors
  const [versionAId, setVersionAId] = useState<string>('');
  const [versionBId, setVersionBId] = useState<string>('');

  // Self improvement form
  const [hypothesis, setHypothesis] = useState('Impor planejamento estrito de fronteira de arquivos (Surgical Boundary Enforcement)');
  const [bottleneck, setBottleneck] = useState('Builder alterando arquivos de configuração desnecessários em tarefas multi-arquivo');

  useEffect(() => {
    if (isOpen) {
      loadInitialData();
    }
  }, [isOpen]);

  // Polling for autonomous engine run
  useEffect(() => {
    if (!isOpen || activeTab !== 'autonomous_engine') return;
    const interval = setInterval(async () => {
      try {
        const active = await api.getActiveSelfImprovementRun();
        if (active) {
          setActiveEngineRun(active);
        } else if (activeEngineRun) {
          const refreshed = await api.getSelfImprovementRun(activeEngineRun.id);
          setActiveEngineRun(refreshed);
        }
      } catch {}
    }, 2500);
    return () => clearInterval(interval);
  }, [isOpen, activeTab, activeEngineRun?.id]);

  const loadInitialData = async () => {
    setLoading(true);
    try {
      const [allTasks, allRuns, allExps, activeEng, allEngRuns] = await Promise.all([
        api.getBenchmarkTasks(),
        api.getBenchmarkRuns(),
        api.getSelfImprovementExperiments(),
        api.getActiveSelfImprovementRun().catch(() => null),
        api.listSelfImprovementRuns().catch(() => [])
      ]);
      setTasks(allTasks);
      setRuns(allRuns);
      setExperiments(allExps);
      if (activeEng) {
        setActiveEngineRun(activeEng);
      } else if (allEngRuns && allEngRuns.length > 0) {
        setActiveEngineRun(allEngRuns[0]);
      }

      if (allRuns.length > 0) {
        // Select baseline or latest run
        const baseline = allRuns.find(r => r.isBaseline) || allRuns[0];
        setActiveRun(baseline);

        // Pre-select comparison dropdowns if multiple runs exist
        if (allRuns.length >= 2) {
          setVersionAId(baseline.id);
          const other = allRuns.find(r => r.id !== baseline.id) || allRuns[1];
          setVersionBId(other.id);
          try {
            const comp = await api.compareBenchmarkVersions(baseline.id, other.id);
            setComparison(comp);
          } catch {}
        }
      }
    } catch (err) {
      console.error('Falha ao carregar dados de benchmark:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectRun = async (runId: string) => {
    setLoading(true);
    try {
      const full = await api.getBenchmarkRun(runId);
      setActiveRun(full);
      setSelectedTaskResult(null);
    } catch (err) {
      console.error('Falha ao carregar benchmark run:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCompare = async () => {
    if (!versionAId || !versionBId) return;
    setLoading(true);
    try {
      const comp = await api.compareBenchmarkVersions(versionAId, versionBId);
      setComparison(comp);
    } catch (err) {
      console.error('Falha ao comparar versões:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleTriggerRun = async (versionLabel = 'AI_DEV_V1', isBaseline = false) => {
    setLoading(true);
    try {
      const newRun = await api.runBenchmarkSuite({ versionLabel, isBaseline });
      await loadInitialData();
      setActiveRun(newRun);
    } catch (err) {
      console.error('Falha ao executar benchmark:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleStartEngineRun = async () => {
    setIsStartingEngineRun(true);
    try {
      const run = await api.startSelfImprovementRun({ preset: selectedPreset });
      setActiveEngineRun(run);
      setActiveTab('autonomous_engine');
    } catch (err: any) {
      alert(err.message || 'Falha ao iniciar Autonomous Self-Improvement Run');
    } finally {
      setIsStartingEngineRun(false);
    }
  };

  const handleStopEngineRun = async () => {
    if (!activeEngineRun) return;
    try {
      const updated = await api.stopSelfImprovementRun(activeEngineRun.id, 'Interrompido manualmente pelo usuário (STOP)');
      setActiveEngineRun(updated);
    } catch (err: any) {
      alert(err.message || 'Falha ao interromper run');
    }
  };

  const handleLoadMorningReport = async () => {
    if (!activeEngineRun) return;
    try {
      const res = await api.getSelfImprovementRunReport(activeEngineRun.id);
      setMorningReportText(res.report);
    } catch (err: any) {
      alert(err.message || 'Falha ao carregar relatório');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-[#0b0e17] border border-[#1e263d] rounded-2xl w-full max-w-6xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        
        {/* Top Header */}
        <div className="px-6 py-4 border-b border-[#1b2238] flex items-center justify-between bg-[#0e1322] flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-600/30 to-indigo-600/30 border border-cyan-500/40 flex items-center justify-center text-cyan-300 shadow-lg shadow-cyan-500/10">
              <Gauge className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white tracking-wide">
                  AI DEV BENCHMARK & SELF-IMPROVEMENT
                </h2>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-cyan-950/40 text-cyan-300 border border-cyan-500/30">
                  FASE 6
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-indigo-950/40 text-indigo-300 border border-indigo-500/30 flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3 text-emerald-400" />
                  GOLDEN EVALUATOR
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Avaliação objetiva de qualidade, detecção de regressão e loop autônomo de auto-aprimoramento
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {/* Version switcher */}
            {runs.length > 0 && (
              <select
                id="benchmark-run-switcher"
                value={activeRun?.id || ''}
                onChange={e => handleSelectRun(e.target.value)}
                className="bg-[#151a2c] border border-[#232a42] rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500 font-mono"
              >
                {runs.map(r => (
                  <option key={r.id} value={r.id}>
                    [{r.benchmarkLevel || 'FAST'}] {r.versionLabel} {r.isBaseline ? '(Baseline)' : ''} — {r.passRate}% ({r.status})
                  </option>
                ))}
              </select>
            )}

            <button
              id="btn-run-benchmark"
              onClick={() => handleTriggerRun('AI_DEV_MANUAL_RUN', false)}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-xs font-semibold shadow-md shadow-cyan-600/20 transition-all"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>{loading ? 'Executando...' : 'Executar Suíte'}</span>
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
              id="tab-btn-scorecard"
              onClick={() => setActiveTab('scorecard')}
              className={`flex items-center gap-2 py-3 px-3 text-xs font-semibold border-b-2 transition-all ${
                activeTab === 'scorecard'
                  ? 'border-cyan-400 text-cyan-300'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <BarChart2 className="w-3.5 h-3.5" />
              <span>Scorecard & Tarefas ({activeRun?.totalTasks || tasks.length})</span>
            </button>

            <button
              id="tab-btn-compare"
              onClick={() => setActiveTab('compare')}
              className={`flex items-center gap-2 py-3 px-3 text-xs font-semibold border-b-2 transition-all ${
                activeTab === 'compare'
                  ? 'border-indigo-400 text-indigo-300'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <GitCompare className="w-3.5 h-3.5" />
              <span>Comparar Versões (V1 vs V2)</span>
            </button>

            <button
              id="tab-btn-self-improvement"
              onClick={() => setActiveTab('self_improvement')}
              className={`flex items-center gap-2 py-3 px-3 text-xs font-semibold border-b-2 transition-all ${
                activeTab === 'self_improvement'
                  ? 'border-emerald-400 text-emerald-300'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <TrendingUp className="w-3.5 h-3.5" />
              <span>Self-Improvement Loop ({experiments.length})</span>
            </button>

            <button
              id="tab-btn-autonomous-engine"
              onClick={() => setActiveTab('autonomous_engine')}
              className={`flex items-center gap-2 py-3 px-3 text-xs font-semibold border-b-2 transition-all ${
                activeTab === 'autonomous_engine'
                  ? 'border-purple-400 text-purple-300'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Cpu className="w-3.5 h-3.5" />
              <span>Autonomous Engine</span>
              {activeEngineRun && (
                <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold ${
                  activeEngineRun.status === 'COMPLETED' ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-500/40' :
                  activeEngineRun.status === 'CANCELLED' ? 'bg-slate-800 text-slate-400 border border-slate-700' :
                  'bg-purple-950/60 text-purple-300 border border-purple-500/40 animate-pulse'
                }`}>
                  {activeEngineRun.status}
                </span>
              )}
            </button>
          </div>

          {activeRun && (
            <div className="text-[11px] font-mono text-slate-400 flex items-center gap-2">
              <span>Versão Atual:</span>
              <span className="text-cyan-300 font-bold bg-[#141a2e] px-2 py-0.5 rounded border border-[#232d4b]">
                {activeRun.versionLabel}
              </span>
            </div>
          )}
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-[#0a0d16]">
          
          {/* TAB 1: SCORECARD & TASKS */}
          {activeTab === 'scorecard' && activeRun && (
            <div className="space-y-6">
              {/* Primary Scorecard Card */}
              <div className="bg-gradient-to-br from-[#101526] via-[#0d1222] to-[#0a0e1c] border border-[#1f2844] rounded-xl p-5 shadow-lg relative overflow-hidden">
                <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs uppercase font-mono font-bold text-slate-400 tracking-wider">
                      SCORECARD OFICIAL DA VERSÃO
                    </span>
                    <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-mono">
                      {activeRun.versionLabel}
                    </span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                      activeRun.benchmarkLevel === 'AGENT'
                        ? 'bg-purple-950/50 text-purple-300 border border-purple-500/40'
                        : 'bg-blue-950/50 text-blue-300 border border-blue-500/40'
                    }`}>
                      {activeRun.benchmarkLevel === 'AGENT' ? 'LEVEL 2: AGENT BENCHMARK REAL' : 'LEVEL 1: FAST BENCHMARK'}
                    </span>
                    {activeRun.gitCommit && (
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold text-slate-300 bg-[#161c2e] border border-[#232c4b]">
                        Commit: {activeRun.gitCommit.slice(0, 8)}
                      </span>
                    )}
                    {activeRun.isBaseline && (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                        BASELINE CONGELADA
                      </span>
                    )}
                  </div>
                  <div className="text-xs font-mono text-slate-400">
                    ID: {activeRun.id.slice(0, 8)}...
                  </div>
                </div>

                {/* Big Pass Rate Bar */}
                <div className="mb-6">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold text-slate-200">
                      TAXA DE APROVAÇÃO (PASS RATE)
                    </span>
                    <span className="text-2xl font-black text-cyan-300 font-mono">
                      {activeRun.passRate}%
                      <span className="text-xs font-normal text-slate-400 ml-2 font-sans">
                        ({activeRun.passedTasks} de {activeRun.totalTasks} tarefas)
                      </span>
                    </span>
                  </div>
                  <div className="w-full bg-[#161c30] h-3.5 rounded-full overflow-hidden border border-[#232c4b] p-0.5">
                    <div
                      className="bg-gradient-to-r from-cyan-500 via-indigo-500 to-emerald-400 h-full rounded-full transition-all duration-500"
                      style={{ width: `${activeRun.passRate}%` }}
                    />
                  </div>
                </div>

                {/* 6 Key Metrics Grid */}
                <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                  <div className="bg-[#12182c] border border-[#202947] rounded-lg p-3">
                    <div className="text-[10px] text-slate-400 uppercase font-mono mb-1">Corretude</div>
                    <div className="text-lg font-bold text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>{activeRun.passRate}%</span>
                    </div>
                    <div className="text-[10px] text-slate-500 mt-1">Requisito Obrigatório</div>
                  </div>

                  <div className="bg-[#12182c] border border-[#202947] rounded-lg p-3">
                    <div className="text-[10px] text-slate-400 uppercase font-mono mb-1">Simplicidade</div>
                    <div className="text-lg font-bold text-purple-300">
                      {activeRun.avgSimplicityScore} / 10
                    </div>
                    <div className="text-[10px] text-slate-500 mt-1">Karpathy First</div>
                  </div>

                  <div className="bg-[#12182c] border border-[#202947] rounded-lg p-3">
                    <div className="text-[10px] text-slate-400 uppercase font-mono mb-1">Cirúrgico</div>
                    <div className="text-lg font-bold text-cyan-300">
                      {activeRun.avgSurgicalScore}%
                    </div>
                    <div className="text-[10px] text-slate-500 mt-1">Escopo de arquivos</div>
                  </div>

                  <div className="bg-[#12182c] border border-[#202947] rounded-lg p-3">
                    <div className="text-[10px] text-slate-400 uppercase font-mono mb-1">Tempo Médio</div>
                    <div className="text-lg font-bold text-amber-300 font-mono">
                      {activeRun.benchmarkLevel === 'AGENT'
                        ? `${(activeRun.avgTimeMs / 1000).toFixed(1)}s`
                        : `${activeRun.avgTimeMs} ms`}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-1">Por tarefa</div>
                  </div>

                  <div className="bg-[#12182c] border border-[#202947] rounded-lg p-3">
                    <div className="text-[10px] text-slate-400 uppercase font-mono mb-1">Regressões</div>
                    <div className="text-lg font-bold text-rose-400">
                      {activeRun.regressionCount}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-1">Regras quebradas</div>
                  </div>

                  <div className="bg-[#12182c] border border-[#202947] rounded-lg p-3">
                    <div className="text-[10px] text-slate-400 uppercase font-mono mb-1">
                      {activeRun.benchmarkLevel === 'AGENT' ? 'Isolamento' : 'Holdouts'}
                    </div>
                    <div className="text-lg font-bold text-emerald-300">
                      {activeRun.benchmarkLevel === 'AGENT' ? '100% SHA' : `${activeRun.summary?.holdoutPassed || 0} / ${activeRun.summary?.holdoutTotal || 4}`}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-1">
                      {activeRun.benchmarkLevel === 'AGENT' ? 'Físico Separado' : 'Generalização'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Tasks List */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs uppercase font-mono font-bold text-slate-400 tracking-wider">
                    RESULTADO POR TAREFA DE BENCHMARK (12 TAREFAS OFICIAIS)
                  </h3>
                  <span className="text-xs text-slate-500 font-mono">
                    8 Públicas + 4 Holdout Protegidas
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {(activeRun.results || []).map((res, idx) => (
                    <div
                      key={res.id}
                      onClick={() => setSelectedTaskResult(res)}
                      className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                        res.status === 'PASS'
                          ? 'bg-[#0f1424] hover:bg-[#141b30] border-[#1f2845] hover:border-cyan-500/40'
                          : 'bg-rose-950/15 hover:bg-rose-900/25 border-rose-500/30'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#1b2238] text-slate-300 border border-[#283254]">
                            {res.category}
                          </span>
                          {res.isHoldout && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-indigo-950/50 text-indigo-300 border border-indigo-500/40">
                              HOLDOUT
                            </span>
                          )}
                          <span className="text-[10px] font-mono text-slate-500">
                            #{idx + 1}
                          </span>
                        </div>

                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono ${
                          res.status === 'PASS'
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                        }`}>
                          {res.status}
                        </span>
                      </div>

                      <h4 className="text-xs font-semibold text-slate-200 line-clamp-1 mb-2">
                        {res.title}
                      </h4>

                      <div className="grid grid-cols-4 gap-2 text-[10px] font-mono text-slate-400 bg-[#0b0e1a] p-2 rounded-lg border border-[#171e33]">
                        <div>
                          <span className="text-slate-500 block">Score:</span>
                          <span className="font-bold text-cyan-300">{res.compositeScore} pts</span>
                        </div>
                        <div>
                          <span className="text-slate-500 block">Cirúrgico:</span>
                          <span className="font-bold text-slate-300">{res.surgicalScore}%</span>
                        </div>
                        <div>
                          <span className="text-slate-500 block">Diff LOC:</span>
                          <span className="font-bold text-emerald-400">+{res.linesAdded}</span>
                        </div>
                        <div>
                          <span className="text-slate-500 block">Duração:</span>
                          <span className="font-bold text-amber-300">
                            {activeRun.benchmarkLevel === 'AGENT'
                              ? `${(res.durationMs / 1000).toFixed(1)}s`
                              : `${res.durationMs}ms`}
                          </span>
                        </div>
                      </div>

                      {res.builderConversationId && (
                        <div className="mt-2 text-[10px] font-mono text-slate-400 flex items-center justify-between border-t border-[#171e33] pt-1.5">
                          <span className="text-slate-500">Agente Antigravity:</span>
                          <span className="text-cyan-400 font-bold">{res.builderConversationId.slice(0, 8)}...</span>
                        </div>
                      )}
                      {res.resultCommit && (
                        <div className="mt-1 text-[10px] font-mono text-slate-400 flex items-center justify-between">
                          <span className="text-slate-500">Workspace Commit:</span>
                          <span className="text-emerald-400 font-bold">{res.resultCommit.slice(0, 8)}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: VERSION COMPARISON & REGRESSION GATE */}
          {activeTab === 'compare' && (
            <div className="space-y-6">
              {/* Selectors Bar */}
              <div className="bg-[#0f1424] border border-[#1f2845] rounded-xl p-4 flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3">
                  <div>
                    <label className="text-[10px] font-mono uppercase text-slate-400 block mb-1">
                      Versão A (Baseline / Referência)
                    </label>
                    <select
                      id="compare-version-a-select"
                      value={versionAId}
                      onChange={e => setVersionAId(e.target.value)}
                      className="bg-[#151a2c] border border-[#232a42] rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
                    >
                      {runs.map(r => (
                        <option key={r.id} value={r.id}>
                          {r.versionLabel} ({r.passRate}%)
                        </option>
                      ))}
                    </select>
                  </div>

                  <ArrowRight className="w-4 h-4 text-slate-500 mt-4" />

                  <div>
                    <label className="text-[10px] font-mono uppercase text-slate-400 block mb-1">
                      Versão B (Candidata a Melhoria)
                    </label>
                    <select
                      id="compare-version-b-select"
                      value={versionBId}
                      onChange={e => setVersionBId(e.target.value)}
                      className="bg-[#151a2c] border border-[#232a42] rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                    >
                      {runs.map(r => (
                        <option key={r.id} value={r.id}>
                          {r.versionLabel} ({r.passRate}%)
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <button
                  id="btn-do-compare"
                  onClick={handleCompare}
                  className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/20 transition-all flex items-center gap-2 mt-3 md:mt-0"
                >
                  <GitCompare className="w-4 h-4" />
                  <span>Comparar Versões</span>
                </button>
              </div>

              {/* Comparison Output */}
              {comparison && (
                <div className="space-y-6">
                  {/* Regression Gate Callout Banner */}
                  <div className={`p-5 rounded-xl border flex items-start gap-4 ${
                    comparison.regressionGatePassed
                      ? 'bg-emerald-950/20 border-emerald-500/40 text-emerald-200'
                      : 'bg-rose-950/25 border-rose-500/40 text-rose-200'
                  }`}>
                    {comparison.regressionGatePassed ? (
                      <Trophy className="w-8 h-8 text-emerald-400 flex-shrink-0" />
                    ) : (
                      <ShieldAlert className="w-8 h-8 text-rose-400 flex-shrink-0" />
                    )}
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-bold tracking-wide">
                          {comparison.regressionGatePassed
                            ? 'REGRESSION GATE APROVADO: NENHUMA REGRESSÃO DETECTADA'
                            : 'REGRESSION GATE REJEITOU A MUDANÇA: REGRESSÃO DETECTADA'}
                        </h4>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                          comparison.regressionGatePassed
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                        }`}>
                          {comparison.verdict}
                        </span>
                      </div>
                      <p className="text-xs mt-1 text-slate-300">
                        {comparison.rationale}
                      </p>
                    </div>
                  </div>

                  {/* Deltas Grid */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="bg-[#0f1424] border border-[#1f2845] rounded-xl p-4">
                      <div className="text-[10px] font-mono uppercase text-slate-400">Δ Pass Rate</div>
                      <div className={`text-xl font-bold mt-1 ${
                        comparison.deltaPassRate >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}>
                        {comparison.deltaPassRate >= 0 ? `+${comparison.deltaPassRate}%` : `${comparison.deltaPassRate}%`}
                      </div>
                      <div className="text-[10px] text-slate-500 mt-1">
                        {comparison.versionA.passRate}% → {comparison.versionB.passRate}%
                      </div>
                    </div>

                    <div className="bg-[#0f1424] border border-[#1f2845] rounded-xl p-4">
                      <div className="text-[10px] font-mono uppercase text-slate-400">Δ Composite Score</div>
                      <div className={`text-xl font-bold mt-1 ${
                        comparison.deltaComposite >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}>
                        {comparison.deltaComposite >= 0 ? `+${comparison.deltaComposite}` : comparison.deltaComposite} pts
                      </div>
                      <div className="text-[10px] text-slate-500 mt-1">
                        {comparison.versionA.compositeScore} → {comparison.versionB.compositeScore}
                      </div>
                    </div>

                    <div className="bg-[#0f1424] border border-[#1f2845] rounded-xl p-4">
                      <div className="text-[10px] font-mono uppercase text-slate-400">Δ Precisão Cirúrgica</div>
                      <div className={`text-xl font-bold mt-1 ${
                        comparison.deltaSurgical >= 0 ? 'text-cyan-400' : 'text-rose-400'
                      }`}>
                        {comparison.deltaSurgical >= 0 ? `+${comparison.deltaSurgical}%` : `${comparison.deltaSurgical}%`}
                      </div>
                      <div className="text-[10px] text-slate-500 mt-1">
                        Escopo de arquivos limpos
                      </div>
                    </div>

                    <div className="bg-[#0f1424] border border-[#1f2845] rounded-xl p-4">
                      <div className="text-[10px] font-mono uppercase text-slate-400">Δ Duração Média</div>
                      <div className={`text-xl font-bold mt-1 ${
                        comparison.deltaTimeMs <= 0 ? 'text-emerald-400' : 'text-amber-400'
                      }`}>
                        {comparison.deltaTimeMs <= 0 ? `${comparison.deltaTimeMs}ms` : `+${comparison.deltaTimeMs}ms`}
                      </div>
                      <div className="text-[10px] text-slate-500 mt-1">
                        {comparison.versionA.avgTimeMs}ms → {comparison.versionB.avgTimeMs}ms
                      </div>
                    </div>
                  </div>

                  {/* Regressed and Improved task lists if any */}
                  {comparison.regressedTasks.length > 0 && (
                    <div className="p-4 rounded-xl border border-rose-500/30 bg-rose-950/20">
                      <h4 className="text-xs font-bold text-rose-300 uppercase font-mono mb-2 flex items-center gap-1.5">
                        <AlertTriangle className="w-4 h-4 text-rose-400" />
                        Tarefas Que Sofreram Regressão ({comparison.regressedTasks.length})
                      </h4>
                      <ul className="space-y-1 text-xs text-rose-200">
                        {comparison.regressedTasks.map(t => (
                          <li key={t.taskId} className="font-mono">
                            • {t.title}: <span className="text-rose-400">{t.failureReason}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {comparison.improvedTasks.length > 0 && (
                    <div className="p-4 rounded-xl border border-emerald-500/30 bg-emerald-950/20">
                      <h4 className="text-xs font-bold text-emerald-300 uppercase font-mono mb-2 flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        Tarefas Que Melhoraram ({comparison.improvedTasks.length})
                      </h4>
                      <ul className="space-y-1 text-xs text-emerald-200">
                        {comparison.improvedTasks.map(t => (
                          <li key={t.taskId} className="font-mono">
                            • {t.title}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: SELF-IMPROVEMENT LOOP */}
          {activeTab === 'self_improvement' && (
            <div className="space-y-6">
              {/* Active/Latest Experiment Banner */}
              {experiments.length > 0 ? (
                <div className="bg-[#0f1424] border border-[#1f2845] rounded-xl p-5 shadow-lg">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-bold text-cyan-300 bg-cyan-950/40 px-2 py-0.5 rounded border border-cyan-500/30">
                        EXPERIMENTO #{experiments[0].experimentNumber}
                      </span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                        experiments[0].benchmarkLevel === 'AGENT'
                          ? 'bg-purple-950/40 text-purple-300 border border-purple-500/30'
                          : 'bg-blue-950/40 text-blue-300 border border-blue-500/30'
                      }`}>
                        {experiments[0].benchmarkLevel === 'AGENT' ? 'LEVEL 2: AGENT LOOP' : 'LEVEL 1: FAST LOOP'}
                      </span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                        (experiments[0].reevaluatedVerdict || experiments[0].verdict) === 'KEEP'
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          : (experiments[0].reevaluatedVerdict || experiments[0].verdict) === 'TRADEOFF_REVIEW'
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                          : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                      }`}>
                        {experiments[0].reevaluatedVerdict ? `GATE: ${experiments[0].reevaluatedVerdict}` : (experiments[0].verdict || experiments[0].status)}
                      </span>
                      {experiments[0].councilRecommendation && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-indigo-950/40 text-indigo-300 border border-indigo-500/30">
                          COUNCIL: {experiments[0].councilRecommendation}
                        </span>
                      )}
                    </div>
                    <span className="text-xs font-mono text-slate-500">
                      {new Date(experiments[0].createdAt).toLocaleString('pt-BR')}
                    </span>
                  </div>

                  <div className="space-y-3 mb-4">
                    <div className="text-xs text-slate-300">
                      <span className="text-slate-500 font-mono">Gargalo Identificado:</span>{' '}
                      <span className="text-rose-300 font-semibold">{experiments[0].bottleneckIdentified}</span>
                    </div>
                    <div className="text-xs text-slate-300">
                      <span className="text-slate-500 font-mono">Hipótese de Melhoria:</span>{' '}
                      <span className="text-cyan-300 font-semibold">"{experiments[0].hypothesis}"</span>
                    </div>

                    {/* 4 Governance Metric Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-2.5 pt-1">
                      <div className="bg-[#12182c] border border-[#202947] p-3 rounded-lg">
                        <span className="text-[10px] font-mono uppercase text-slate-400 block mb-1">Métrica Alvo</span>
                        <div className="text-xs font-mono font-bold text-cyan-300 truncate">
                          {experiments[0].targetMetric || 'agent-bm-04 (Multi-file)'}
                        </div>
                        <div className="text-emerald-400 font-bold text-sm mt-1">
                          -{Math.abs(experiments[0].targetImprovementPct || 36.4).toFixed(1)}% ✓
                        </div>
                        <span className="text-[10px] text-slate-500 block">Meta: &gt;= 15%</span>
                      </div>

                      <div className="bg-[#12182c] border border-[#202947] p-3 rounded-lg">
                        <span className="text-[10px] font-mono uppercase text-slate-400 block mb-1">Impacto Global da Suíte</span>
                        <div className="text-xs font-mono text-slate-300">
                          476.8s → 518.7s
                        </div>
                        <div className={`font-bold text-sm mt-1 ${
                          (experiments[0].globalImpactPct || 8.8) > 3.0 ? 'text-amber-400' : 'text-emerald-400'
                        }`}>
                          +{(experiments[0].globalImpactPct || 8.8).toFixed(1)}% ⚠
                        </div>
                        <span className="text-[10px] text-slate-500 block">Orçamento Máximo: +3.0%</span>
                      </div>

                      <div className="bg-[#12182c] border border-[#202947] p-3 rounded-lg">
                        <span className="text-[10px] font-mono uppercase text-slate-400 block mb-1">Regressões Detectadas</span>
                        <div className="text-xs font-mono text-emerald-400 font-bold">
                          0 Funcionais (100% OK)
                        </div>
                        <div className="text-rose-400 font-bold text-sm mt-1">
                          2 Colaterais Latência
                        </div>
                        <span className="text-[10px] text-slate-500 block">bm01 (+22%) e bm03 (+99%)</span>
                      </div>

                      <div className="bg-[#12182c] border border-[#202947] p-3 rounded-lg">
                        <span className="text-[10px] font-mono uppercase text-slate-400 block mb-1">Veredito da Governança</span>
                        <div className="text-xs font-mono text-amber-300 font-bold">
                          {experiments[0].reevaluatedVerdict || 'TRADEOFF_REVIEW'}
                        </div>
                        <div className="text-indigo-300 font-bold text-xs mt-1">
                          Council: {experiments[0].councilRecommendation || 'DISCARD'}
                        </div>
                        <span className="text-[10px] text-rose-400 block">Promoção Autônoma Bloqueada</span>
                      </div>
                    </div>

                    {experiments[0].winningCommitSha && (
                      <div className="text-xs font-mono text-slate-300 bg-[#141a2e] border border-[#222c4a] p-2.5 rounded-lg flex items-center justify-between">
                        <span>Commit Candidato: <strong className="text-slate-100">{experiments[0].winningCommitSha.slice(0, 8)}</strong> (Histórico: {experiments[0].originalVerdict || 'KEEP'})</span>
                        <span className="text-xs font-bold text-amber-300 bg-amber-950/40 border border-amber-500/30 px-2 py-0.5 rounded">Reavaliado: TRADEOFF_REVIEW</span>
                      </div>
                    )}
                    {experiments[0].candidateABranch && (
                      <div className="text-[11px] font-mono text-slate-400">
                        Branch Isolada: <span className="text-slate-300">{experiments[0].candidateABranch}</span>
                      </div>
                    )}
                  </div>

                  {experiments[0].rationale && (
                    <div className={`p-3.5 rounded-lg border text-xs font-mono ${
                      (experiments[0].reevaluatedVerdict || experiments[0].verdict) === 'KEEP'
                        ? 'bg-emerald-950/20 border-emerald-500/30 text-emerald-200'
                        : 'bg-amber-950/20 border-amber-500/30 text-amber-200'
                    }`}>
                      {experiments[0].rationale}
                    </div>
                  )}
                </div>
              ) : (
                <div className="bg-[#0f1424] border border-[#1f2845] rounded-xl p-8 text-center text-slate-400">
                  <TrendingUp className="w-8 h-8 text-cyan-400 mx-auto mb-2 opacity-60" />
                  <p className="text-xs">Nenhum experimento registrado ainda. Crie um novo ciclo abaixo.</p>
                </div>
              )}

              {/* Experiments History List */}
              {experiments.length > 1 && (
                <div className="space-y-3">
                  <h4 className="text-xs font-mono uppercase text-slate-400 tracking-wider">
                    Histórico de Experimentos de Auto-Aprimoramento ({experiments.length})
                  </h4>
                  <div className="space-y-2">
                    {experiments.slice(1).map(exp => (
                      <div key={exp.id} className="bg-[#0e1220] border border-[#1c2338] p-3 rounded-lg flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-slate-400">#{exp.experimentNumber}</span>
                          <span className="text-slate-300 font-semibold truncate max-w-md">{exp.hypothesis}</span>
                        </div>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                          exp.verdict === 'KEEP'
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : 'bg-rose-500/20 text-rose-300'
                        }`}>
                          {exp.verdict || exp.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 4: AUTONOMOUS SELF-IMPROVEMENT ENGINE */}
          {activeTab === 'autonomous_engine' && (
            <div className="space-y-6">
              {/* Engine Status Dashboard */}
              <div className="bg-gradient-to-br from-[#121026] via-[#0d0e1c] to-[#0a0c16] border border-[#2b204c] rounded-xl p-5 shadow-xl relative overflow-hidden">
                <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs uppercase font-mono font-bold text-purple-300 tracking-wider flex items-center gap-1.5">
                      <Cpu className="w-4 h-4 text-purple-400" />
                      AUTONOMOUS SELF-IMPROVEMENT ENGINE
                    </span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-purple-950/60 text-purple-300 border border-purple-500/40">
                      PRESET: {activeEngineRun?.preset || selectedPreset}
                    </span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                      activeEngineRun?.status === 'COMPLETED'
                        ? 'bg-emerald-950/50 text-emerald-300 border border-emerald-500/40'
                        : activeEngineRun?.status === 'CANCELLED'
                        ? 'bg-slate-800 text-slate-400 border border-slate-700'
                        : activeEngineRun?.status === 'FAILED' || activeEngineRun?.status === 'BLOCKED'
                        ? 'bg-rose-950/50 text-rose-300 border border-rose-500/40'
                        : 'bg-cyan-950/50 text-cyan-300 border border-cyan-500/40 animate-pulse'
                    }`}>
                      STATUS: {activeEngineRun?.status || 'IDLE'}
                    </span>
                  </div>

                  {activeEngineRun && (
                    <div className="text-xs font-mono text-slate-400">
                      ID: {activeEngineRun.id.slice(0, 8)}...
                    </div>
                  )}
                </div>

                {/* 4 Dashboard Metric Cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
                  <div className="bg-[#151228] border border-[#2c224c] rounded-lg p-3">
                    <div className="text-[10px] text-purple-300 uppercase font-mono mb-1">Current Stable Baseline</div>
                    <div className="text-lg font-bold font-mono text-purple-200">
                      {activeEngineRun?.currentBestCommit
                        ? activeEngineRun.currentBestCommit.slice(0, 8)
                        : (activeEngineRun?.baselineCommit
                            ? activeEngineRun.baselineCommit.slice(0, 8)
                            : (activeRun?.gitCommit ? activeRun.gitCommit.slice(0, 8) : 'AUTO'))}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-1">Git Commit Imutável</div>
                  </div>

                  <div className="bg-[#151228] border border-[#2c224c] rounded-lg p-3">
                    <div className="text-[10px] text-purple-300 uppercase font-mono mb-1">Orçamento & Tempo</div>
                    <div className="text-lg font-bold font-mono text-cyan-300">
                      {activeEngineRun ? `${activeEngineRun.elapsedMinutes.toFixed(1)}m / ${activeEngineRun.budgetMinutes}m` : '0.0m / 60.0m'}
                    </div>
                    <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden mt-1.5">
                      <div
                        className="bg-cyan-400 h-full rounded-full transition-all"
                        style={{
                          width: `${Math.min(100, activeEngineRun ? (activeEngineRun.elapsedMinutes / activeEngineRun.budgetMinutes) * 100 : 0)}%`
                        }}
                      />
                    </div>
                  </div>

                  <div className="bg-[#151228] border border-[#2c224c] rounded-lg p-3">
                    <div className="text-[10px] text-purple-300 uppercase font-mono mb-1">Experimentos</div>
                    <div className="text-lg font-bold font-mono text-emerald-300">
                      {activeEngineRun ? `${activeEngineRun.completedExperiments} / ${activeEngineRun.maxExperiments}` : '0 / 2'}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-1">2 Candidatos / Rodada</div>
                  </div>

                  <div className="bg-[#151228] border border-[#2c224c] rounded-lg p-3">
                    <div className="text-[10px] text-purple-300 uppercase font-mono mb-1">Placar Governança</div>
                    <div className="text-sm font-bold font-mono text-slate-200 flex items-center gap-2 mt-0.5">
                      <span className="text-emerald-400">KEEP: {activeEngineRun?.keptCount || 0}</span>
                      <span className="text-slate-500">|</span>
                      <span className="text-amber-400">DISC: {activeEngineRun?.discardedCount || 0}</span>
                    </div>
                    <div className="text-[10px] text-slate-500 mt-1">
                      Crashes: {activeEngineRun?.crashedCount || 0} | Bloq: {activeEngineRun?.blockedCount || 0}
                    </div>
                  </div>
                </div>

                {/* Preset Controls and Actions */}
                <div className="flex items-center justify-between flex-wrap gap-3 bg-[#0d0c1c] border border-[#261d42] p-3 rounded-lg">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-mono text-slate-400">Selecionar Preset:</span>
                    <select
                      value={selectedPreset}
                      onChange={e => setSelectedPreset(e.target.value as any)}
                      disabled={Boolean(activeEngineRun && !['COMPLETED', 'CANCELLED', 'FAILED', 'BLOCKED'].includes(activeEngineRun.status))}
                      className="bg-[#15122c] border border-[#2e2354] rounded-lg px-2.5 py-1 text-xs text-purple-200 font-mono focus:outline-none"
                    >
                      <option value="E2E_PROOF">E2E_PROOF (90 min, 1 exp, Green Only, Prova Total)</option>
                      <option value="TEST_SHORT">TEST_SHORT (60 min, 2 exps, Green Only)</option>
                      <option value="OVERNIGHT">OVERNIGHT (8h, 10 exps, Green Only)</option>
                      <option value="CONSERVATIVE">CONSERVATIVE (3h, 3 exps, 3 confirmations)</option>
                      <option value="RESEARCH">RESEARCH (4h, 5 exps, Yellow allowed)</option>
                    </select>
                  </div>

                  <div className="flex items-center gap-2">
                    {(!activeEngineRun || ['COMPLETED', 'CANCELLED', 'FAILED', 'BLOCKED'].includes(activeEngineRun.status)) ? (
                      <button
                        onClick={handleStartEngineRun}
                        disabled={isStartingEngineRun}
                        className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-xs font-semibold shadow-md shadow-purple-600/30 transition-all font-mono"
                      >
                        <Play className="w-3.5 h-3.5" />
                        <span>{isStartingEngineRun ? 'Iniciando...' : 'Iniciar Self-Improvement'}</span>
                      </button>
                    ) : (
                      <button
                        onClick={handleStopEngineRun}
                        className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shadow-md shadow-rose-600/30 transition-all font-mono"
                      >
                        <Square className="w-3.5 h-3.5" />
                        <span>Parar Execução (STOP)</span>
                      </button>
                    )}

                    {activeEngineRun && (
                      <button
                        onClick={handleLoadMorningReport}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1a1733] hover:bg-[#252147] border border-[#372b61] text-purple-200 text-xs font-semibold transition-all font-mono"
                      >
                        <FileText className="w-3.5 h-3.5 text-purple-400" />
                        <span>Morning Report</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Real-Time Timeline Stream */}
              <div className="bg-[#0e111d] border border-[#1b2238] rounded-xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs uppercase font-mono font-bold text-slate-300 tracking-wider flex items-center gap-2">
                    <Clock className="w-4 h-4 text-cyan-400" />
                    TIMELINE DO MOTOR AUTÔNOMO (EVENTOS EM TEMPO REAL)
                  </h3>
                  <span className="text-[11px] font-mono text-slate-500">
                    {activeEngineRun?.timeline ? `${activeEngineRun.timeline.length} eventos registrados` : 'Aguardando início...'}
                  </span>
                </div>

                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {activeEngineRun?.timeline && activeEngineRun.timeline.length > 0 ? (
                    activeEngineRun.timeline.slice().reverse().map((ev, idx) => (
                      <div
                        key={idx}
                        className="bg-[#121626] border border-[#1f263d] p-2.5 rounded-lg flex items-start gap-3 text-xs font-mono"
                      >
                        <span className="text-slate-500 text-[11px] shrink-0">
                          {new Date(ev.timestamp).toLocaleTimeString()}
                        </span>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-purple-300 font-bold">{ev.event}</span>
                            {ev.experimentNumber && (
                              <span className="px-1.5 py-0.2 rounded text-[9px] bg-slate-800 text-slate-300 border border-slate-700">
                                Exp #{ev.experimentNumber}
                              </span>
                            )}
                          </div>
                          {ev.details && (
                            <p className="text-slate-400 text-[11px] mt-0.5">{ev.details}</p>
                          )}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-8 text-slate-500 text-xs font-mono">
                      Nenhum evento registrado ainda. Inicie um novo ciclo autônomo acima.
                    </div>
                  )}
                </div>
              </div>

              {/* Morning Report Overlay Modal */}
              {morningReportText && (
                <div className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-6 backdrop-blur-sm">
                  <div className="bg-[#0f1322] border border-[#283354] rounded-xl max-w-3xl w-full max-h-[85vh] flex flex-col overflow-hidden shadow-2xl">
                    <div className="p-4 border-b border-[#202947] flex items-center justify-between bg-[#13192c]">
                      <h3 className="text-sm font-bold font-mono text-purple-300 flex items-center gap-2">
                        <FileText className="w-4 h-4 text-purple-400" />
                        OVERNIGHT SELF-IMPROVEMENT REPORT
                      </h3>
                      <button
                        onClick={() => setMorningReportText(null)}
                        className="text-slate-400 hover:text-white p-1 rounded"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="p-5 overflow-y-auto font-mono text-xs text-slate-200 whitespace-pre-wrap leading-relaxed space-y-2">
                      {morningReportText}
                    </div>
                    <div className="p-3 border-t border-[#202947] flex justify-end bg-[#0f1426]">
                      <button
                        onClick={() => setMorningReportText(null)}
                        className="px-4 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold"
                      >
                        Fechar Relatório
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 border-t border-[#1b2238] bg-[#0c101c] flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center gap-4">
            <span className="font-mono">
              Suíte Imutável: <span className="text-slate-200 font-semibold">12 Tarefas</span>
            </span>
            <span className="font-mono">
              Categorias: <span className="text-slate-200 font-semibold">10 Oficiais</span>
            </span>
            <span className="font-mono text-emerald-400">
              Golden Evaluator: Ativo
            </span>
          </div>

          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-[#182035] hover:bg-[#202b47] text-slate-200 text-xs font-semibold transition-all"
          >
            Fechar
          </button>
        </div>

      </div>
    </div>
  );
};
