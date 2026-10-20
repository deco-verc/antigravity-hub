import React, { useState, useEffect } from 'react';
import { FullProjectDetails, AutonomousRun, AutonomousTask, AutonomousApproval, AutonomousEvent } from '../types';
import { api } from '../services/api';
import {
  Bot,
  Play,
  Pause,
  Square,
  Sparkles,
  CheckCircle2,
  Clock,
  GitBranch,
  ShieldAlert,
  AlertTriangle,
  RotateCw,
  FileCode,
  Share2,
  ExternalLink,
  ChevronRight,
  ListTodo,
  Layers,
  ArrowRight,
  Check,
  X,
  UserCheck,
  Zap,
  Activity,
  Maximize2,
  Users
} from 'lucide-react';
import { WorkersTab } from './WorkersTab';

interface AutonomousBuildViewProps {
  project: FullProjectDetails;
  onRefreshProject: () => void;
  onShowToast: (type: 'success' | 'error' | 'info' | 'warn', message: string) => void;
}

export const AutonomousBuildView: React.FC<AutonomousBuildViewProps> = ({
  project,
  onRefreshProject,
  onShowToast
}) => {
  const [viewTab, setViewTab] = useState<'build' | 'workers'>('build');
  const [activeRun, setActiveRun] = useState<AutonomousRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [stepping, setStepping] = useState(false);
  const [isLooping, setIsLooping] = useState(false);

  // Modals
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [reportMarkdown, setReportMarkdown] = useState('');
  const [copiedReport, setCopiedReport] = useState(false);

  // New Run Form State
  const [runName, setRunName] = useState('');
  const [objective, setObjective] = useState('');
  const [briefing, setBriefing] = useState('');
  const [completionCriteria, setCompletionCriteria] = useState('');
  const [autonomyMode, setAutonomyMode] = useState<'safe' | 'balanced' | 'autonomous'>('balanced');
  const [maxHours, setMaxHours] = useState(8);
  const [maxCycles, setMaxCycles] = useState(50);
  const [allowBrowser, setAllowBrowser] = useState(true);
  const [allowTerminal, setAllowTerminal] = useState(true);
  const [allowInstall, setAllowInstall] = useState(true);

  // Elapsed timer state
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Autonomous Runner background worker state
  const [runnerStatus, setRunnerStatus] = useState<any>(null);

  const loadRunnerStatus = async () => {
    try {
      const status = await api.getRunnerStatus();
      setRunnerStatus(status);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadRunnerStatus();
    const runnerInterval = setInterval(() => {
      loadRunnerStatus();
    }, 3000);
    return () => clearInterval(runnerInterval);
  }, []);

  useEffect(() => {
    loadActiveRun();
  }, [project.id]);

  useEffect(() => {
    let timer: any;
    if (activeRun && activeRun.status === 'running') {
      const startTime = new Date(activeRun.start_time).getTime();
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startTime) / 1000)));

      timer = setInterval(() => {
        setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startTime) / 1000)));
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [activeRun?.status, activeRun?.start_time]);

  // Periodic polling for status & events
  useEffect(() => {
    const interval = setInterval(() => {
      if (activeRun && activeRun.status === 'running') {
        loadActiveRun(false);
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [activeRun?.id, activeRun?.status]);

  const loadActiveRun = async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const run = await api.getActiveAutonomousRun(project.id);
      setActiveRun(run);
    } catch (err: any) {
      console.error(err);
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  const handleApplyOvernightPreset = () => {
    setRunName(`Overnight Build — ${project.name}`);
    setObjective(project.objective || 'Construção autônoma do MVP com arquitetura modular e validação visual');
    setBriefing(
      `Requisitos Principais:\n- Implementar arquitetura completa do projeto.\n- Criar testes automatizados cobrindo módulos centrais.\n- Validar visualmente interfaces no navegador desktop e mobile.\n- Registrar decisões técnicas e checkpoints com zero erros bloqueantes.`
    );
    setCompletionCriteria('Todas as tarefas de backend, frontend e testes finalizadas com 100% de aprovação');
    setAutonomyMode('autonomous');
    setMaxHours(8);
    setMaxCycles(50);
    setAllowBrowser(true);
    setAllowTerminal(true);
    setAllowInstall(true);
    onShowToast('info', 'Preset Overnight Build aplicado com sucesso!');
  };

  const handleCreateRun = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!objective.trim() || !briefing.trim()) {
      onShowToast('error', 'Objetivo e Briefing são obrigatórios.');
      return;
    }

    try {
      const newRun = await api.createAutonomousRun({
        projectId: project.id,
        name: runName.trim() || `Build Autônomo #${new Date().toLocaleTimeString('pt-BR')}`,
        objective: objective.trim(),
        briefing: briefing.trim(),
        completionCriteria: completionCriteria.trim(),
        autonomyMode,
        maxHours,
        maxCycles,
        allowBrowser,
        allowTerminal,
        allowInstall,
        isOvernight: maxHours >= 8
      });

      setActiveRun(newRun);
      setIsNewModalOpen(false);
      onShowToast('success', `Autonomous Build iniciado na branch ${newRun.branch_name}!`);
      onRefreshProject();
    } catch (err: any) {
      onShowToast('error', `Falha ao iniciar build: ${err.message}`);
    }
  };

  const handleStepCycle = async () => {
    if (!activeRun) return;
    setStepping(true);
    try {
      const res = await api.stepAutonomousRun(activeRun.id);
      setActiveRun(res.run);
      if (res.cycleResult.status === 'approval_required') {
        onShowToast('warn', `Aprovação requerida na Inbox: ${res.cycleResult.reason}`);
      } else if (res.cycleResult.status === 'completed') {
        onShowToast('success', 'Todas as tarefas do MVP foram concluídas!');
      } else {
        onShowToast('info', `Ciclo executado: "${res.cycleResult.task}"`);
      }
    } catch (err: any) {
      onShowToast('error', `Erro no ciclo: ${err.message}`);
    } finally {
      setStepping(false);
    }
  };

  const handleToggleLoop = async () => {
    if (!activeRun) return;
    if (isLooping) {
      await api.stopAutonomousLoop(activeRun.id);
      setIsLooping(false);
      onShowToast('info', 'Loop contínuo pausado.');
    } else {
      await api.startAutonomousLoop(activeRun.id, activeRun.max_cycles);
      setIsLooping(true);
      onShowToast('success', 'Loop contínuo iniciado em segundo plano!');
    }
    await loadActiveRun(false);
  };

  const handlePauseResume = async () => {
    if (!activeRun) return;
    try {
      if (activeRun.status === 'running') {
        const updated = await api.pauseAutonomousRun(activeRun.id);
        setActiveRun(updated);
        setIsLooping(false);
        onShowToast('info', 'Build autônomo pausado.');
      } else {
        const updated = await api.resumeAutonomousRun(activeRun.id);
        setActiveRun(updated);
        onShowToast('success', 'Build autônomo retomado!');
      }
    } catch (err: any) {
      onShowToast('error', err.message);
    }
  };

  const handleStopRun = async () => {
    if (!activeRun) return;
    if (!confirm('Deseja realmente encerrar este build autônomo?')) return;
    try {
      const updated = await api.stopAutonomousRun(activeRun.id);
      setActiveRun(updated);
      setIsLooping(false);
      onShowToast('info', 'Build autônomo finalizado.');
    } catch (err: any) {
      onShowToast('error', err.message);
    }
  };

  const handleResolveApproval = async (approvalId: string, decision: 'approved' | 'rejected' | 'delegated') => {
    try {
      const updated = await api.resolveAutonomousApproval(approvalId, decision);
      setActiveRun(updated);
      onShowToast('success', `Decisão "${decision.toUpperCase()}" registrada com sucesso!`);
    } catch (err: any) {
      onShowToast('error', err.message);
    }
  };

  const handleOpenReport = async () => {
    if (!activeRun) return;
    try {
      const res = await api.getAutonomousReport(activeRun.id);
      setReportMarkdown(res.reportMd);
      setIsReportModalOpen(true);
    } catch (err: any) {
      onShowToast('error', err.message);
    }
  };

  const handleSyncGitHub = async () => {
    try {
      await api.syncProjectGitHub(project.id);
      onShowToast('success', 'Sincronização com GitHub concluída.');
      onRefreshProject();
      loadActiveRun(false);
    } catch (err: any) {
      onShowToast('error', err.message);
    }
  };

  const formatTimer = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#090a0f] p-6 overflow-y-auto space-y-6">
      {/* Top Header & Global Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#1e2233] pb-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-600 to-cyan-500 text-white flex items-center justify-center shadow-md shadow-indigo-600/30">
              <Bot className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <span>Autonomous Multi-Agent Build</span>
                {activeRun && (
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded border uppercase ${
                    activeRun.status === 'running'
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                      : activeRun.status === 'waiting_approval'
                      ? 'bg-amber-500/10 text-amber-400 border-amber-500/30 animate-pulse'
                      : activeRun.status === 'completed'
                      ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30'
                      : 'bg-[#181b28] text-slate-400 border-[#2e344e]'
                  }`}>
                    {activeRun.status === 'waiting_approval' ? 'Aprovação Pendente' : activeRun.status}
                  </span>
                )}
              </h2>
              <p className="text-xs text-[#7e87aa]">
                Supervisão estratégica com Gemini e Execução tática com Antigravity Builder
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {!activeRun || activeRun.status === 'completed' || activeRun.status === 'failed' ? (
            <button
              onClick={() => setIsNewModalOpen(true)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white text-xs font-bold shadow-md shadow-indigo-600/30 active:scale-95 transition-all"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>NOVO BUILD AUTÔNOMO</span>
            </button>
          ) : (
            <>
              <button
                onClick={handleStepCycle}
                disabled={stepping || activeRun.status !== 'running'}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#181b28] hover:bg-[#202538] border border-indigo-500/30 text-indigo-300 text-xs font-semibold active:scale-95 transition-all"
                title="Executa 1 ciclo completo: Supervisor seleciona -> Builder implementa -> Supervisor avalia"
              >
                <RotateCw className={`w-3.5 h-3.5 ${stepping ? 'animate-spin' : ''}`} />
                <span>{stepping ? 'Executando Ciclo...' : 'AVANÇAR 1 CICLO'}</span>
              </button>

              <button
                onClick={handleToggleLoop}
                disabled={activeRun.status !== 'running' && !isLooping}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold shadow-sm transition-all active:scale-95 ${
                  isLooping
                    ? 'bg-amber-600 hover:bg-amber-500 text-white'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                }`}
              >
                {isLooping ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                <span>{isLooping ? 'PAUSAR LOOP' : 'INICIAR LOOP CONTÍNUO'}</span>
              </button>

              <button
                onClick={handlePauseResume}
                className="p-2 rounded-lg bg-[#181b28] hover:bg-[#202538] border border-[#2e344e] text-slate-300 text-xs transition-colors"
                title={activeRun.status === 'running' ? 'Pausar Build' : 'Retomar Build'}
              >
                {activeRun.status === 'running' ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              </button>

              <button
                onClick={handleStopRun}
                className="p-2 rounded-lg bg-[#181b28] hover:bg-rose-950/40 border border-rose-500/30 text-rose-300 text-xs transition-colors"
                title="Encerrar Build"
              >
                <Square className="w-3.5 h-3.5" />
              </button>

              <button
                onClick={handleOpenReport}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#181b28] hover:bg-[#202538] border border-cyan-500/30 text-cyan-300 text-xs font-semibold transition-all"
              >
                <Share2 className="w-3.5 h-3.5 text-cyan-400" />
                <span>Overnight Report</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* View Navigation Tabs: Build vs Multi-Worker Fleet */}
      <div className="flex items-center gap-2 border-b border-[#1e2233] pb-2">
        <button
          onClick={() => setViewTab('build')}
          className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            viewTab === 'build'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'bg-[#121520] text-[#7e87aa] hover:text-white border border-[#1e2233]'
          }`}
        >
          <Bot className="w-3.5 h-3.5" />
          <span>Visão Geral do Build</span>
        </button>

        <button
          onClick={() => setViewTab('workers')}
          className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            viewTab === 'workers'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'bg-[#121520] text-[#7e87aa] hover:text-white border border-[#1e2233]'
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          <span>Worker Fleet (Multi-Worker)</span>
          <span className="px-1.5 py-0.2 rounded-full bg-cyan-500/20 text-cyan-300 text-[10px] font-mono">
            {runnerStatus?.workerFleet ? runnerStatus.workerFleet.online : 3} online
          </span>
        </button>
      </div>

      {/* Multi-Worker Fleet Status Live Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 rounded-xl bg-[#0e111a] border border-[#1e2233] text-xs shadow-sm">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-cyan-400" />
            <span className="font-semibold text-slate-200">Workers:</span>
            <span className="text-cyan-300 font-mono font-bold">
              {runnerStatus?.workerFleet ? `${runnerStatus.workerFleet.online} online` : '3 online'}
            </span>
          </div>

          <span className="text-[#3a4161]">|</span>
          <span className="text-[#8d96b8]">
            Working: <strong className="text-amber-400 font-mono">{runnerStatus?.workerFleet?.working ?? 0}</strong>
          </span>

          <span className="text-[#3a4161]">|</span>
          <span className="text-[#8d96b8]">
            Ready: <strong className="text-emerald-400 font-mono">{runnerStatus?.workerFleet?.ready ?? 3}</strong>
          </span>

          {runnerStatus?.workerFleet?.assignments && runnerStatus.workerFleet.assignments.length > 0 ? (
            <>
              <span className="text-[#3a4161]">|</span>
              <span className="text-[#8d96b8]">
                Atribuições:{' '}
                {runnerStatus.workerFleet.assignments.map((a: any, idx: number) => (
                  <span key={idx} className="text-indigo-300 font-mono font-bold mr-2">
                    {a.workerName} → {a.issueNumber ? `Issue #${a.issueNumber}` : a.taskTitle}
                  </span>
                ))}
              </span>
            </>
          ) : (
            <>
              <span className="text-[#3a4161]">|</span>
              <span className="text-[#8d96b8]">
                Atribuições: <span className="text-slate-400 font-mono">Aguardando tarefas disponíveis</span>
              </span>
            </>
          )}
        </div>

        <button
          onClick={() => setViewTab('workers')}
          className="text-indigo-400 hover:text-indigo-300 text-[11px] font-semibold underline underline-offset-2 transition-colors"
        >
          Gerenciar Workers →
        </button>
      </div>

      {/* Autonomous Runner Heartbeat Status Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 rounded-xl bg-[#0e111a] border border-[#1e2233] text-xs shadow-sm">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${runnerStatus?.online ? 'bg-emerald-400 animate-pulse shadow-sm shadow-emerald-400/50' : 'bg-rose-500'}`} />
            <span className="font-semibold text-slate-200">Autonomous Runner</span>
            <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${
              runnerStatus?.online
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
            }`}>
              {runnerStatus?.online ? '● ONLINE' : '○ OFFLINE'}
            </span>
          </div>

          <span className="text-[#3a4161]">|</span>

          <span className="text-[#8d96b8]">
            Last Heartbeat:{' '}
            <strong className="text-slate-200 font-mono">
              {runnerStatus ? `${runnerStatus.secondsAgo}s atrás` : 'Sincronizando...'}
            </strong>
          </span>

          {runnerStatus?.currentWorker && (
            <>
              <span className="text-[#3a4161]">|</span>
              <span className="text-[#8d96b8]">
                Worker Ativo: <strong className="text-cyan-400">{runnerStatus.currentWorker}</strong>
              </span>
            </>
          )}

          {runnerStatus?.iteration > 0 && (
            <>
              <span className="text-[#3a4161]">|</span>
              <span className="text-[#8d96b8]">
                Iteração: <strong className="text-indigo-400 font-mono">#{runnerStatus.iteration}</strong>
              </span>
            </>
          )}

          {runnerStatus?.currentTask && (
            <>
              <span className="text-[#3a4161]">|</span>
              <span className="text-[#8d96b8] max-w-xs truncate" title={runnerStatus.currentTask}>
                Tarefa: <strong className="text-slate-200">{runnerStatus.currentTask}</strong>
              </span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 text-[11px] font-mono text-[#636c8f]">
          <Activity className="w-3.5 h-3.5 text-indigo-400 animate-pulse" />
          <span>Scheduler 3s · Watchdog 3m · SQLite Persist</span>
        </div>
      </div>

      {/* GitHub Task Graph Integration Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 rounded-xl bg-[#0e111a] border border-[#1e2233] text-xs shadow-sm">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-purple-400" />
            <span className="font-semibold text-slate-200">GitHub Task Graph</span>
            {project.github_repo ? (
              <a
                href={`https://github.com/${project.github_repo}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 border border-purple-500/30 font-mono text-[11px] transition-colors"
              >
                <span>{project.github_repo}</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            ) : (
              <span className="text-slate-400 font-mono text-[11px]">(Não vinculado ao GitHub)</span>
            )}
          </div>

          {activeRun?.github_epic_issue_number && (
            <>
              <span className="text-[#3a4161]">|</span>
              <a
                href={activeRun.github_epic_issue_url || `https://github.com/${project.github_repo}/issues/${activeRun.github_epic_issue_number}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 font-mono text-[11px]"
              >
                <Sparkles className="w-3 h-3" />
                <span>Epic Issue #{activeRun.github_epic_issue_number}</span>
              </a>
            </>
          )}

          {project.github_branch && (
            <>
              <span className="text-[#3a4161]">|</span>
              <span className="text-[#8d96b8]">
                Branch Base: <strong className="text-emerald-400 font-mono">{project.github_branch}</strong>
              </span>
            </>
          )}
        </div>

        {project.github_repo && (
          <button
            onClick={handleSyncGitHub}
            className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[#181b28] hover:bg-[#202538] border border-purple-500/30 text-purple-300 text-xs font-semibold transition-colors"
          >
            <RotateCw className="w-3.5 h-3.5" />
            <span>Sincronizar GitHub</span>
          </button>
        )}
      </div>

      {viewTab === 'workers' ? (
        <WorkersTab onShowToast={onShowToast} />
      ) : activeRun ? (
        <div className="space-y-6">
          {/* Main Dashboard Overview Card */}
          <div className="bg-[#0d0f17] border border-[#1e2233] rounded-2xl p-5 shadow-sm space-y-5">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div>
                <span className="text-[10px] font-mono text-[#7e87aa] uppercase tracking-wider block">
                  Execução Autônoma Ativa
                </span>
                <h3 className="text-base font-bold text-white mt-0.5">{activeRun.name}</h3>
                <p className="text-xs text-[#7e87aa] mt-1 max-w-xl">{activeRun.objective}</p>
                <div className="flex items-center gap-3 mt-2 text-xs font-mono text-[#525a7f]">
                  <span className="flex items-center gap-1 text-emerald-400">
                    <GitBranch className="w-3.5 h-3.5" />
                    {activeRun.branch_name}
                  </span>
                  <span>•</span>
                  <span>Modo: <strong className="text-slate-300 uppercase">{activeRun.autonomy_mode}</strong></span>
                  <span>•</span>
                  <span>Ciclo Atual: <strong className="text-slate-300">{activeRun.current_cycle}/{activeRun.max_cycles}</strong></span>
                </div>
              </div>

              {/* Progress & Timer Widget */}
              <div className="flex items-center gap-6 bg-[#121520] p-4 rounded-xl border border-[#1e2233] flex-shrink-0">
                <div>
                  <span className="text-[10px] font-mono text-[#7e87aa] uppercase block">Tempo Decorrido</span>
                  <div className="text-lg font-bold text-white font-mono flex items-center gap-1.5 mt-0.5">
                    <Clock className="w-4 h-4 text-cyan-400" />
                    <span>{formatTimer(elapsedSeconds)}</span>
                  </div>
                  <span className="text-[10px] text-[#525a7f] font-mono">Limite: {activeRun.max_hours}h</span>
                </div>

                <div className="w-px h-10 bg-[#1e2233]" />

                <div className="w-44">
                  <div className="flex items-center justify-between text-xs font-mono mb-1">
                    <span className="text-[#7e87aa]">MVP Progress</span>
                    <span className="text-white font-bold">{activeRun.stats.progressPct}%</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-[#181b28] overflow-hidden border border-[#2e344e]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-indigo-500 via-cyan-400 to-emerald-400 transition-all duration-500"
                      style={{ width: `${activeRun.stats.progressPct}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-[#525a7f] font-mono mt-1 block text-right">
                    {activeRun.stats.completed}/{activeRun.stats.total} tarefas
                  </span>
                </div>
              </div>
            </div>

            {/* Agent Role Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
              {/* Supervisor Card */}
              <div className="p-4 rounded-xl bg-[#121520] border border-indigo-500/20 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-md bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 flex items-center justify-center">
                      <Sparkles className="w-3.5 h-3.5" />
                    </div>
                    <span className="text-xs font-bold text-white">Supervisor (Gemini Pro)</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-300 border border-indigo-500/30">
                    Estratégia & QA
                  </span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {activeRun.status === 'completed'
                    ? 'Todos os marcos e tarefas foram avaliados e aprovados.'
                    : activeRun.status === 'waiting_approval'
                    ? 'Aguardando decisão do usuário na Approval Inbox para prosseguir com tarefas bloqueadas.'
                    : 'Avaliando critérios de aceite, conformidade com o briefing e dependências do DAG.'}
                </p>
              </div>

              {/* Builder Card */}
              <div className="p-4 rounded-xl bg-[#121520] border border-cyan-500/20 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-md bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 flex items-center justify-center">
                      <Bot className="w-3.5 h-3.5" />
                    </div>
                    <span className="text-xs font-bold text-white">Builder (Antigravity Executor)</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-300 border border-cyan-500/30">
                    Implementação Tática
                  </span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {activeRun.stats.inProgress > 0
                    ? `Executando tarefa ativa com sincronização local, build e validação no navegador.`
                    : 'Aguardando liberação de próxima tarefa não bloqueada pelo Supervisor.'}
                </p>
              </div>
            </div>

            {/* Quick Metrics Counter */}
            <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-center text-xs font-mono pt-1">
              <div className="p-2.5 rounded-lg bg-[#181b28] border border-[#1e2233]">
                <span className="text-[#7e87aa] block text-[10px]">TOTAL</span>
                <span className="text-white font-bold text-sm mt-0.5 block">{activeRun.stats.total}</span>
              </div>
              <div className="p-2.5 rounded-lg bg-[#181b28] border border-emerald-500/20">
                <span className="text-emerald-400 block text-[10px]">CONCLUÍDAS</span>
                <span className="text-emerald-300 font-bold text-sm mt-0.5 block">{activeRun.stats.completed}</span>
              </div>
              <div className="p-2.5 rounded-lg bg-[#181b28] border border-indigo-500/20">
                <span className="text-indigo-400 block text-[10px]">EM PROGRESSO</span>
                <span className="text-indigo-300 font-bold text-sm mt-0.5 block">{activeRun.stats.inProgress + activeRun.stats.inReview}</span>
              </div>
              <div className="p-2.5 rounded-lg bg-[#181b28] border border-[#1e2233]">
                <span className="text-[#7e87aa] block text-[10px]">PENDENTES</span>
                <span className="text-slate-300 font-bold text-sm mt-0.5 block">{activeRun.stats.pending}</span>
              </div>
              <div className="p-2.5 rounded-lg bg-[#181b28] border border-amber-500/20">
                <span className="text-amber-400 block text-[10px]">APROVAÇÕES</span>
                <span className="text-amber-300 font-bold text-sm mt-0.5 block">{activeRun.stats.waitingApproval}</span>
              </div>
              <div className="p-2.5 rounded-lg bg-[#181b28] border border-rose-500/20">
                <span className="text-rose-400 block text-[10px]">BLOQUEADAS</span>
                <span className="text-rose-300 font-bold text-sm mt-0.5 block">{activeRun.stats.blocked}</span>
              </div>
            </div>
          </div>

          {/* APPROVAL INBOX (Human in the loop) */}
          {activeRun.approvals.filter(a => a.status === 'pending').length > 0 && (
            <div className="bg-[#0d0f17] border-2 border-amber-500/40 rounded-2xl p-5 shadow-lg shadow-amber-500/5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <ShieldAlert className="w-5 h-5 text-amber-400 animate-pulse" />
                  <div>
                    <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                      Approval Inbox — Decisão Requerida
                    </h3>
                    <p className="text-[11px] text-[#7e87aa]">
                      As tarefas independentes continuam rodando; apenas o componente dependente aguarda sua confirmação.
                    </p>
                  </div>
                </div>
                <span className="text-xs font-mono font-bold px-2.5 py-1 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
                  {activeRun.approvals.filter(a => a.status === 'pending').length} Pendente(s)
                </span>
              </div>

              <div className="space-y-3">
                {activeRun.approvals.filter(a => a.status === 'pending').map(approval => (
                  <div key={approval.id} className="p-4 bg-[#121520] border border-amber-500/30 rounded-xl space-y-3 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-white text-sm">{approval.title}</span>
                      <span className={`text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded ${
                        approval.risk_level === 'red'
                          ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                          : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                      }`}>
                        Risco: {approval.risk_level.toUpperCase()}
                      </span>
                    </div>

                    <p className="text-slate-300">{approval.context}</p>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px] font-mono bg-[#0d0f17] p-3 rounded-lg border border-[#1e2233]">
                      <div>
                        <span className="text-[#7e87aa] block">Por que precisa de você:</span>
                        <span className="text-slate-200">{approval.why_needed}</span>
                      </div>
                      <div>
                        <span className="text-[#7e87aa] block">Recomendação do Supervisor:</span>
                        <span className="text-emerald-400 font-semibold">{approval.supervisor_recommendation}</span>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center justify-end gap-2 pt-1 flex-wrap">
                      <button
                        onClick={() => handleResolveApproval(approval.id, 'rejected')}
                        className="px-3 py-1.5 rounded-lg bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/30 text-rose-300 text-xs font-semibold transition-colors"
                      >
                        Rejeitar Proposta
                      </button>

                      <button
                        onClick={() => handleResolveApproval(approval.id, 'delegated')}
                        className="px-3 py-1.5 rounded-lg bg-[#181b28] hover:bg-[#202538] border border-[#2e344e] text-slate-300 text-xs font-semibold transition-colors"
                      >
                        Deixar Supervisor Decidir
                      </button>

                      <button
                        onClick={() => handleResolveApproval(approval.id, 'approved')}
                        className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-md shadow-emerald-600/20 transition-all active:scale-95"
                      >
                        Aprovar Recomendação
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TASK GRAPH / DAG & ACTIVITY STREAM */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Task Graph & Milestones */}
            <div className="bg-[#0d0f17] border border-[#1e2233] rounded-2xl p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <Layers className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Grafo de Tarefas & Dependências (DAG)</span>
                </h3>
                <span className="text-xs text-[#7e87aa] font-mono">
                  {activeRun.tasks.length} tarefas mapeadas
                </span>
              </div>

              <div className="space-y-2.5">
                {activeRun.tasks.map((task, i) => {
                  const isDone = task.status === 'completed';
                  const isWorking = task.status === 'in_progress' || task.status === 'in_review';
                  const isBlocked = task.status === 'blocked';

                  return (
                    <div
                      key={task.id}
                      className={`p-3.5 rounded-xl border text-xs space-y-2 transition-all ${
                        isDone
                          ? 'bg-[#121520] border-emerald-500/20'
                          : isWorking
                          ? 'bg-[#121520] border-indigo-500/40 shadow-sm shadow-indigo-500/10'
                          : isBlocked
                          ? 'bg-rose-500/10 border-rose-500/30'
                          : 'bg-[#121520] border-[#1e2233]'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[10px] text-[#7e87aa]">#{i + 1}</span>
                          <span className="font-bold text-white">{task.title}</span>
                        </div>
                        <span className={`text-[10px] font-mono font-semibold uppercase px-2 py-0.5 rounded ${
                          isDone
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                            : isWorking
                            ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 animate-pulse'
                            : isBlocked
                            ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                            : 'bg-black/30 text-[#7e87aa]'
                        }`}>
                          {task.status}
                        </span>
                      </div>

                      <p className="text-[#7e87aa] text-[11px] leading-relaxed">{task.description}</p>

                      {/* GitHub Details */}
                      {(task.github_issue_number || task.github_pr_number || task.github_branch) && (
                        <div className="flex items-center gap-2 flex-wrap pt-1">
                          {task.github_issue_number && (
                            <a
                              href={task.github_issue_url || `https://github.com/${project.github_repo}/issues/${task.github_issue_number}`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 border border-purple-500/30 text-[10px] font-mono transition-colors"
                              title="Abrir Issue no GitHub"
                            >
                              <ExternalLink className="w-2.5 h-2.5" />
                              <span>Issue #{task.github_issue_number}</span>
                            </a>
                          )}

                          {task.github_pr_number && (
                            <a
                              href={task.github_pr_url || `https://github.com/${project.github_repo}/pull/${task.github_pr_number}`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 text-[10px] font-mono transition-colors"
                              title="Abrir Pull Request no GitHub"
                            >
                              <GitBranch className="w-2.5 h-2.5" />
                              <span>PR #{task.github_pr_number}</span>
                            </a>
                          )}

                          {task.github_branch && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 text-[10px] font-mono">
                              <GitBranch className="w-2.5 h-2.5" />
                              <span>{task.github_branch}</span>
                            </span>
                          )}
                        </div>
                      )}

                      <div className="flex items-center justify-between text-[10px] font-mono text-[#525a7f] pt-1 border-t border-[#1e2233]">
                        <span>Milestone: <strong className="text-slate-300">{task.milestone}</strong></span>
                        {task.dependencies && task.dependencies.length > 0 && (
                          <span>Depende de: {task.dependencies.length} tarefa(s)</span>
                        )}
                        {task.retry_count > 0 && (
                          <span className="text-amber-400">Tentativas: {task.retry_count}/3</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Activity Stream */}
            <div className="bg-[#0d0f17] border border-[#1e2233] rounded-2xl p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <Activity className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Activity Stream em Tempo Real</span>
                </h3>
                <span className="text-xs text-[#7e87aa] font-mono">
                  {activeRun.events.length} eventos
                </span>
              </div>

              <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
                {activeRun.events.length === 0 ? (
                  <p className="text-xs text-[#7e87aa] text-center py-8">Nenhum evento registrado ainda.</p>
                ) : (
                  activeRun.events.map(ev => {
                    const isSupervisor = ev.agent_role === 'supervisor';
                    const isBuilder = ev.agent_role === 'builder';
                    const isSystem = ev.agent_role === 'system';

                    return (
                      <div key={ev.id} className="p-3 bg-[#121520] border border-[#1e2233] rounded-xl text-xs space-y-1">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${
                              isSupervisor
                                ? 'bg-indigo-500/20 text-indigo-300'
                                : isBuilder
                                ? 'bg-cyan-500/20 text-cyan-300'
                                : isSystem
                                ? 'bg-amber-500/20 text-amber-300'
                                : 'bg-emerald-500/20 text-emerald-300'
                            }`}>
                              {ev.agent_role.toUpperCase()}
                            </span>
                            <span className="text-[10px] font-mono text-[#525a7f]">{ev.event_type}</span>
                          </div>
                          <span className="text-[10px] font-mono text-[#525a7f]">
                            {new Date(ev.created_at).toLocaleTimeString('pt-BR')}
                          </span>
                        </div>
                        <p className="text-slate-300 text-[11px] leading-relaxed">{ev.message}</p>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Empty State */
        <div className="bg-[#0d0f17] border border-[#1e2233] rounded-2xl p-12 text-center max-w-xl mx-auto space-y-5 my-auto shadow-sm">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-cyan-400 mx-auto flex items-center justify-center shadow-lg shadow-indigo-600/30 text-white">
            <Bot className="w-7 h-7" />
          </div>

          <div>
            <h3 className="text-lg font-bold text-white">Nenhum Build Autônomo Ativo</h3>
            <p className="text-xs text-[#7e87aa] mt-1.5 max-w-md mx-auto leading-relaxed">
              Inicie um ciclo autônomo multi-agente onde o Supervisor (Gemini) coordena o Builder (Antigravity) para construir o projeto enquanto você está ausente.
            </p>
          </div>

          <button
            onClick={() => setIsNewModalOpen(true)}
            className="px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs tracking-wide shadow-md shadow-indigo-600/30 active:scale-95 transition-all inline-flex items-center gap-2"
          >
            <Sparkles className="w-4 h-4" />
            <span>CONFIGURAR NOVO BUILD AUTÔNOMO</span>
          </button>
        </div>
      )}

      {/* New Autonomous Build Modal */}
      {isNewModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-[#0d0f17] border border-[#1e2233] rounded-2xl w-full max-w-2xl max-h-[92vh] flex flex-col shadow-2xl">
            <div className="px-6 py-4 border-b border-[#1e2233] flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-cyan-400" />
                <span>Novo Build Autônomo Multi-Agente</span>
              </h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleApplyOvernightPreset}
                  className="px-3 py-1 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 text-xs font-semibold transition-colors"
                >
                  ⚡ Preset: Overnight Build
                </button>
                <button onClick={() => setIsNewModalOpen(false)} className="text-[#7e87aa] hover:text-white text-xs font-mono">
                  ✕
                </button>
              </div>
            </div>

            <form onSubmit={handleCreateRun} className="p-6 flex-1 overflow-y-auto space-y-4 text-xs">
              <div>
                <label className="text-slate-300 font-semibold block mb-1">Nome do Build</label>
                <input
                  type="text"
                  value={runName}
                  onChange={e => setRunName(e.target.value)}
                  placeholder="Ex: Autonomous Build — MVP Audio Pipeline"
                  className="w-full bg-[#121520] border border-[#1e2233] rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="text-slate-300 font-semibold block mb-1">Objetivo de Alto Nível</label>
                <input
                  type="text"
                  value={objective}
                  onChange={e => setObjective(e.target.value)}
                  placeholder="Ex: Criar uma aplicação completa de clonagem de voz local"
                  required
                  className="w-full bg-[#121520] border border-[#1e2233] rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="text-slate-300 font-semibold block mb-1">Briefing Detalhado com Requisitos</label>
                <textarea
                  value={briefing}
                  onChange={e => setBriefing(e.target.value)}
                  placeholder="Descreva o que deve ser construído, requisitos técnicos, stack esperada, endpoints e telas..."
                  rows={4}
                  required
                  className="w-full bg-[#121520] border border-[#1e2233] rounded-xl p-3 text-white focus:outline-none focus:border-indigo-500 leading-relaxed"
                />
              </div>

              <div>
                <label className="text-slate-300 font-semibold block mb-1">Critério de Conclusão do MVP</label>
                <input
                  type="text"
                  value={completionCriteria}
                  onChange={e => setCompletionCriteria(e.target.value)}
                  placeholder="Ex: Todas as telas funcionais no navegador e testes de ponta a ponta passando"
                  className="w-full bg-[#121520] border border-[#1e2233] rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              {/* Mode & Limits */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
                <div>
                  <label className="text-slate-300 font-semibold block mb-1">Modo de Autonomia</label>
                  <select
                    value={autonomyMode}
                    onChange={e => setAutonomyMode(e.target.value as any)}
                    className="w-full bg-[#121520] border border-[#1e2233] rounded-xl px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="safe">SAFE (Pergunta frequentemente)</option>
                    <option value="balanced">BALANCED (Padrão recomendado)</option>
                    <option value="autonomous">AUTONOMOUS (Amplo desenvolvimento)</option>
                  </select>
                </div>

                <div>
                  <label className="text-slate-300 font-semibold block mb-1">Duração Máxima (horas)</label>
                  <input
                    type="number"
                    min={1}
                    max={24}
                    value={maxHours}
                    onChange={e => setMaxHours(Number(e.target.value))}
                    className="w-full bg-[#121520] border border-[#1e2233] rounded-xl px-3 py-2 text-white focus:outline-none focus:border-indigo-500 font-mono"
                  />
                </div>

                <div>
                  <label className="text-slate-300 font-semibold block mb-1">Máx. Ciclos de Tarefas</label>
                  <input
                    type="number"
                    min={5}
                    max={100}
                    value={maxCycles}
                    onChange={e => setMaxCycles(Number(e.target.value))}
                    className="w-full bg-[#121520] border border-[#1e2233] rounded-xl px-3 py-2 text-white focus:outline-none focus:border-indigo-500 font-mono"
                  />
                </div>
              </div>

              {/* Checkboxes */}
              <div className="pt-2 border-t border-[#1e2233] flex flex-wrap gap-4 text-slate-300">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allowBrowser}
                    onChange={e => setAllowBrowser(e.target.checked)}
                    className="rounded bg-[#121520] border-[#1e2233] text-indigo-600 focus:ring-0"
                  />
                  <span>Permitir Validação Visual (Browser/Puppeteer)</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allowTerminal}
                    onChange={e => setAllowTerminal(e.target.checked)}
                    className="rounded bg-[#121520] border-[#1e2233] text-indigo-600 focus:ring-0"
                  />
                  <span>Permitir Terminal & Compilação</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allowInstall}
                    onChange={e => setAllowInstall(e.target.checked)}
                    className="rounded bg-[#121520] border-[#1e2233] text-indigo-600 focus:ring-0"
                  />
                  <span>Permitir Instalação de Dependências</span>
                </label>
              </div>

              <div className="px-6 py-4 -mx-6 -mb-6 border-t border-[#1e2233] flex justify-end gap-2 bg-[#090a0f] mt-4">
                <button
                  type="button"
                  onClick={() => setIsNewModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-[#181b28] hover:bg-[#202538] text-slate-300 font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold shadow-md shadow-indigo-600/30"
                >
                  INICIAR BUILD AUTÔNOMO
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Overnight Report Modal */}
      {isReportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-[#0d0f17] border border-[#1e2233] rounded-2xl w-full max-w-3xl max-h-[92vh] flex flex-col shadow-2xl">
            <div className="px-6 py-4 border-b border-[#1e2233] flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Share2 className="w-4 h-4 text-cyan-400" />
                <span>Overnight Build Report</span>
              </h3>
              <button onClick={() => setIsReportModalOpen(false)} className="text-[#7e87aa] hover:text-white text-xs font-mono">
                ✕ Fechar
              </button>
            </div>

            <div className="p-6 flex-1 overflow-y-auto space-y-3">
              <textarea
                readOnly
                value={reportMarkdown}
                rows={18}
                className="w-full bg-[#121520] border border-[#1e2233] rounded-xl p-4 text-xs font-mono text-slate-200 focus:outline-none resize-none leading-relaxed"
              />
            </div>

            <div className="px-6 py-4 border-t border-[#1e2233] flex justify-end gap-2 bg-[#090a0f]">
              <button
                onClick={() => setIsReportModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-[#181b28] hover:bg-[#202538] text-xs text-slate-300 font-semibold"
              >
                Fechar
              </button>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(reportMarkdown);
                  setCopiedReport(true);
                  setTimeout(() => setCopiedReport(false), 2000);
                  onShowToast('success', 'Relatório copiado com sucesso!');
                }}
                className="px-5 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-xs text-white font-bold flex items-center gap-1.5 shadow-md shadow-cyan-600/30"
              >
                {copiedReport ? <Check className="w-3.5 h-3.5" /> : <Share2 className="w-3.5 h-3.5" />}
                <span>{copiedReport ? 'COPIADO!' : 'COPIAR RELATÓRIO'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
