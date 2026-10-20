import React, { useState, useMemo } from 'react';
import { ParsedTasks, AutonomousRun, MajorTask, AutonomousTask, ProjectRequirement } from '../types';
import { api } from '../services/api';
import { DecoHubCurrentActivityWidget } from './DecoHubCurrentActivityWidget';
import { resolveRunProgressPct } from '../services/progressUtils';
import {
  Plus,
  ArrowRight,
  ArrowLeft,
  ChevronRight,
  ChevronDown,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  GitCommit,
  GitBranch,
  GitPullRequest,
  Layers,
  Filter,
  Terminal,
  Sparkles,
  RefreshCw,
  Lock,
  Play,
  RotateCw,
  Check,
  Clock,
  FileText
} from 'lucide-react';

interface DecoHubTasksViewProps {
  tasks: ParsedTasks;
  run?: AutonomousRun | null;
  onAddTask: (text: string, column: 'pending' | 'doing' | 'done') => Promise<void> | void;
  onMoveTask: (text: string, from: 'pending' | 'doing' | 'done', to: 'pending' | 'doing' | 'done') => Promise<void> | void;
}

type TaskFilterMode = 'all' | 'pending' | 'in_progress' | 'in_review' | 'rework' | 'blocked' | 'completed';

export const DecoHubTasksView: React.FC<DecoHubTasksViewProps> = ({
  tasks,
  run: initialRun,
  onAddTask,
  onMoveTask
}) => {
  const [currentRun, setCurrentRun] = useState<AutonomousRun | null>(initialRun || null);
  const [isActionLoading, setIsActionLoading] = useState(false);

  // Sync with prop updates
  React.useEffect(() => {
    if (initialRun) setCurrentRun(initialRun);
  }, [initialRun]);

  // Hierarchical plan interactive state
  const [filterMode, setFilterMode] = useState<TaskFilterMode>('all');
  // Collapsed by default as per design specification
  const [expandedMajors, setExpandedMajors] = useState<Record<string, boolean>>({});
  const [expandedStages, setExpandedStages] = useState<Record<string, boolean>>({});
  const [expandedTaskDetails, setExpandedTaskDetails] = useState<Record<string, boolean>>({});
  const [showMemoryNotes, setShowMemoryNotes] = useState(false);

  // Kanban memory input state
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

  const handleResumeRun = async () => {
    if (!currentRun || isActionLoading) return;
    setIsActionLoading(true);
    try {
      const updated = await api.resumeAutonomousRun(currentRun.id);
      setCurrentRun(updated);
    } catch (err: any) {
      alert(`Erro ao retomar execução: ${err.message}`);
    } finally {
      setIsActionLoading(false);
    }
  };

  const toggleMajor = (id: string) => {
    setExpandedMajors(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleStage = (key: string) => {
    setExpandedStages(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleTaskDetail = (taskId: string) => {
    setExpandedTaskDetails(prev => ({ ...prev, [taskId]: !prev[taskId] }));
  };

  const fullTaskMap = useMemo(() => {
    const map = new Map<string, AutonomousTask>();
    for (const t of currentRun?.tasks || []) {
      map.set(t.id, t);
      if (t.code) map.set(t.code, t);
    }
    return map;
  }, [currentRun?.tasks]);

  const matchesFilter = (mt: any, fullTask?: AutonomousTask): boolean => {
    if (filterMode === 'all') return true;
    const status = String(fullTask?.status || mt.status || '').toLowerCase();
    const lc = String(fullTask?.lifecycle_state || mt.lifecycleState || '').toUpperCase();
    const rev = String(fullTask?.review_decision || mt.reviewDecision || '').toUpperCase();

    if (filterMode === 'completed') {
      return status === 'completed' || lc === 'COMPLETED';
    }
    if (filterMode === 'blocked') {
      return status === 'blocked' || lc === 'BLOCKED';
    }
    if (filterMode === 'rework') {
      return rev === 'REJECTED' || status === 'needs_changes' || lc === 'REWORK_REQUIRED';
    }
    if (filterMode === 'in_review') {
      return (
        status === 'in_review' ||
        status === 'approved' ||
        status === 'commit_pending' ||
        ['REVIEW_PENDING', 'APPROVED', 'COMMIT_PENDING'].includes(lc)
      );
    }
    if (filterMode === 'in_progress') {
      return (
        (status === 'in_progress' || lc === 'IN_PROGRESS') &&
        rev !== 'REJECTED' &&
        status !== 'needs_changes' &&
        lc !== 'REWORK_REQUIRED'
      );
    }
    if (filterMode === 'pending') {
      return (
        (status === 'pending' || status === 'ready' || ['PLANNED', 'READY'].includes(lc)) &&
        rev !== 'REJECTED' &&
        status !== 'needs_changes' &&
        lc !== 'REWORK_REQUIRED'
      );
    }
    return true;
  };

  const filterCounts = useMemo(() => {
    const allTasks = currentRun?.tasks || [];
    return {
      all: allTasks.length,
      pending: allTasks.filter(t => ['pending', 'ready'].includes(t.status) && t.lifecycle_state !== 'REWORK_REQUIRED' && t.status !== 'needs_changes').length,
      in_progress: allTasks.filter(t => (t.status === 'in_progress' || t.lifecycle_state === 'IN_PROGRESS') && t.status !== 'needs_changes' && t.lifecycle_state !== 'REWORK_REQUIRED').length,
      in_review: allTasks.filter(t => ['in_review', 'approved', 'commit_pending'].includes(t.status) || (t.lifecycle_state ? ['REVIEW_PENDING', 'COMMIT_PENDING'].includes(t.lifecycle_state) : false)).length,
      rework: allTasks.filter(t => t.review_decision === 'REJECTED' || (t as any).reviewDecision === 'REJECTED' || t.status === 'needs_changes' || t.lifecycle_state === 'REWORK_REQUIRED').length,
      blocked: allTasks.filter(t => t.status === 'blocked' || t.lifecycle_state === 'BLOCKED').length,
      completed: allTasks.filter(t => t.status === 'completed' || t.lifecycle_state === 'COMPLETED').length
    };
  }, [currentRun?.tasks]);

  // Criteria-based progress calculation with strict 95% ceiling enforcement
  const totalTasks = currentRun?.tasks?.length || 0;
  const completedTasks = currentRun?.tasks?.filter(t => t.status === 'completed' || t.lifecycle_state === 'COMPLETED').length || 0;
  const progressPct = resolveRunProgressPct(currentRun);

  const reqSummary = useMemo(() => {
    const reqs: ProjectRequirement[] = currentRun?.projectRequirements || [];
    const total = reqs.length;
    const verified = reqs.filter(r => r.status === 'verified' || r.verificationStatus === 'verified').length;
    return { total, verified };
  }, [currentRun?.projectRequirements]);

  // Contextual status flags
  const isRunWaitingApproval = currentRun?.status === 'waiting_approval' || Boolean(currentRun?.last_error && /AGENT_NATIVE_TOOL_PENDING/.test(currentRun.last_error));
  const isRunWaitingResource = currentRun?.status === 'waiting_resource';
  const isRunBlocked = currentRun?.status === 'blocked';
  const isRunError = currentRun?.status === 'error';
  const isRunPaused = currentRun?.status === 'paused';
  const isRunActive = currentRun && ['running', 'building', 'testing', 'reviewing', 'planning', 'waiting_for_worker'].includes(currentRun.status);
  const isRunCompleted = currentRun?.status === 'completed';

  const columns = [
    { id: 'pending' as const, title: 'A Fazer', items: tasks.pending, dotColor: 'bg-amber-400', badgeClass: 'bg-amber-500/10 text-amber-300 border-amber-500/20' },
    { id: 'doing' as const, title: 'Em Andamento', items: tasks.doing, dotColor: 'bg-indigo-400', badgeClass: 'bg-indigo-500/10 text-indigo-300 border-indigo-500/20' },
    { id: 'done' as const, title: 'Concluído', items: tasks.done, dotColor: 'bg-emerald-400', badgeClass: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20' }
  ];

  const renderMicrotaskRow = (mt: any) => {
    const fullTask = fullTaskMap.get(mt.id);
    if (!matchesFilter(mt, fullTask)) return null;

    const lc = fullTask?.lifecycle_state || mt.lifecycleState || mt.status?.toUpperCase() || 'PLANNED';
    const isCompleted = lc === 'COMPLETED' || mt.status === 'completed';
    const isBlocked = lc === 'BLOCKED' || mt.status === 'blocked';
    const isRework = lc === 'REWORK_REQUIRED' || mt.status === 'needs_changes' || mt.reviewDecision === 'REJECTED' || fullTask?.review_decision === 'REJECTED';
    const isReview = (lc === 'REVIEW_PENDING' || lc === 'COMMIT_PENDING' || mt.status === 'in_review') && !isRework;
    const isExecuting = (lc === 'IN_PROGRESS' || mt.status === 'in_progress') && !isRework && !isReview;
    const isExpanded = Boolean(expandedTaskDetails[mt.id]);

    const deps: string[] = fullTask?.dependencies || mt.dependencies || [];
    const resolvedDepLabels = deps.map(d => {
      const target = fullTaskMap.get(d);
      return target ? `${target.code || target.milestone}: ${target.title}` : d;
    });
    const reqIds: string[] = fullTask?.requirement_ids || mt.requirementIds || [];
    const blockingReason = fullTask?.blocking_reason || mt.blockingReason || (isBlocked ? fullTask?.review_result?.justification : null);

    return (
      <div
        key={mt.id}
        className={`rounded-xl border p-3 text-xs transition-colors ${
          isCompleted
            ? 'bg-[#0b1118] border-emerald-500/25'
            : isBlocked
            ? 'bg-rose-950/15 border-rose-500/35'
            : isRework
            ? 'bg-orange-950/20 border-orange-500/40'
            : isReview
            ? 'bg-sky-950/20 border-sky-500/40'
            : isExecuting
            ? 'bg-indigo-950/20 border-indigo-500/40'
            : 'bg-[#0b0e17] border-slate-800/80'
        }`}
      >
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => toggleTaskDetail(mt.id)}
              className="flex items-center gap-1.5 text-left hover:text-indigo-300 transition-colors"
              title="Expandir critérios de aceitação, testes e evidências"
            >
              {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-indigo-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
              <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 font-bold">
                {mt.code || fullTask?.milestone || 'TASK'}
              </span>
              <span className="font-semibold text-slate-100">{mt.title}</span>
            </button>

            {isCompleted ? (
              <span className="font-mono text-[10px] px-2 py-0.5 rounded border font-semibold bg-emerald-500/15 text-emerald-300 border-emerald-500/30 flex items-center gap-1">
                <Check className="w-3 h-3 text-emerald-400" />
                <span>Concluído</span>
              </span>
            ) : isRework ? (
              <span className="font-mono text-[10px] px-2 py-0.5 rounded border font-semibold bg-orange-500/20 text-orange-300 border-orange-500/40 flex items-center gap-1">
                <RotateCw className="w-3 h-3 text-orange-400 animate-spin" />
                <span>Auto-correção (Retrabalho)</span>
              </span>
            ) : isReview ? (
              <span className="font-mono text-[10px] px-2 py-0.5 rounded border font-semibold bg-sky-500/20 text-sky-300 border-sky-500/40 flex items-center gap-1">
                <Clock className="w-3 h-3 text-sky-400 animate-pulse" />
                <span>Em revisão independente</span>
              </span>
            ) : isExecuting ? (
              <span className="font-mono text-[10px] px-2 py-0.5 rounded border font-semibold bg-indigo-500/20 text-indigo-300 border-indigo-500/40 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
                <span>Em execução</span>
              </span>
            ) : isBlocked ? (
              <span className="font-mono text-[10px] px-2 py-0.5 rounded border font-semibold bg-rose-500/20 text-rose-300 border-rose-500/40 flex items-center gap-1">
                <AlertCircle className="w-3 h-3 text-rose-400" />
                <span>Bloqueado</span>
              </span>
            ) : (
              <span className="font-mono text-[10px] px-2 py-0.5 rounded border font-semibold bg-slate-800 text-slate-300 border-slate-700">
                {lc === 'READY' ? 'Pronto' : 'Planejado'}
              </span>
            )}

            {reqIds.map(reqCode => (
              <span
                key={reqCode}
                className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-300 border border-cyan-500/30"
              >
                {reqCode}
              </span>
            ))}

            {fullTask?.github_branch && (
              <span className="font-mono text-[10px] text-indigo-300 flex items-center gap-1 bg-indigo-500/10 px-1.5 py-0.5 rounded border border-indigo-500/25">
                <GitBranch className="w-3 h-3" />
                <span>{fullTask.github_branch}</span>
              </span>
            )}

            {(mt.commitSha || fullTask?.task_commit_sha) && (
              <span className="font-mono text-[10px] text-emerald-400 flex items-center gap-1 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/25">
                <GitCommit className="w-3 h-3" />
                <span>{(mt.commitSha || fullTask?.task_commit_sha || '').slice(0, 8)}</span>
              </span>
            )}

            {fullTask?.github_pr_number && (
              <a
                href={fullTask.github_pr_url || '#'}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-[10px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1 bg-cyan-500/10 px-1.5 py-0.5 rounded border border-cyan-500/25 transition-colors"
                title="Ver Pull Request no GitHub"
              >
                <GitPullRequest className="w-3 h-3" />
                <span>PR #{fullTask.github_pr_number}</span>
              </a>
            )}
          </div>

          <button
            type="button"
            onClick={() => toggleTaskDetail(mt.id)}
            className="text-[11px] text-indigo-400 hover:text-indigo-300 underline underline-offset-2 font-mono"
          >
            {isExpanded ? 'Recolher detalhes' : 'Critérios & Evidências'}
          </button>
        </div>

        {/* Motivo de Bloqueio ou Retrabalho */}
        {(blockingReason || (isRework && fullTask?.review_result?.justification)) && (
          <div className="mt-2 px-2.5 py-1.5 rounded bg-rose-950/30 border border-rose-500/30 text-[11px] text-rose-200 flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-rose-400 flex-shrink-0 mt-0.5" />
            <div>
              <strong>{isBlocked ? 'Bloqueio: ' : 'Retrabalho: '}</strong>
              <span>{blockingReason || fullTask?.review_result?.justification}</span>
            </div>
          </div>
        )}

        {/* Dependências */}
        {resolvedDepLabels.length > 0 && (
          <div className="mt-1.5 text-[10px] font-mono text-slate-400">
            Dependências: <span className="text-slate-300">{resolvedDepLabels.join(' → ')}</span>
          </div>
        )}

        {/* Nível 4: Detalhes, Critérios de Aceitação, Comandos de Verificação */}
        {isExpanded && (
          <div className="mt-2.5 pt-2.5 border-t border-slate-800/80 space-y-2 text-[11px] text-slate-300">
            <p className="text-slate-300">{fullTask?.description || mt.objective || mt.title}</p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <div className="bg-[#080a10] p-2.5 rounded-xl border border-slate-800">
                <span className="font-mono text-[10px] uppercase text-indigo-300 flex items-center gap-1 mb-1 font-semibold">
                  <CheckCircle2 className="w-3 h-3" />
                  <span>Critérios de Aceitação ({(fullTask?.criteria || mt.criteria || []).length})</span>
                </span>
                <ul className="list-disc list-inside space-y-0.5 text-[11px] text-slate-300">
                  {(fullTask?.criteria || mt.criteria || []).map((c: string, idx: number) => (
                    <li key={idx}>{c}</li>
                  ))}
                </ul>
              </div>

              <div className="bg-[#080a10] p-2.5 rounded-xl border border-slate-800 space-y-2">
                <div>
                  <span className="font-mono text-[10px] uppercase text-cyan-300 flex items-center gap-1 font-semibold">
                    <Terminal className="w-3 h-3" />
                    <span>Comando de Verificação:</span>
                  </span>
                  <code className="block mt-1 font-mono text-[10px] text-emerald-300 bg-slate-900/90 px-2 py-1 rounded">
                    {fullTask?.verification_command || mt.verificationCommand || 'npm test'}
                  </code>
                </div>

                {(fullTask?.allowed_scope || mt.allowedScope) && (
                  <div>
                    <span className="font-mono text-[10px] uppercase text-slate-400 font-semibold">Escopo delimitado:</span>
                    <div className="mt-0.5 text-[10px] font-mono text-slate-300">
                      {(fullTask?.allowed_scope || mt.allowedScope || []).join(', ')}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const [showFullObjective, setShowFullObjective] = useState(false);

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6 max-w-6xl mx-auto w-full">
      {/* 1. Área Compacta de Atividade Atual (Requisito 4 e 8) */}
      <DecoHubCurrentActivityWidget
        run={currentRun}
        onContinueOrResume={handleResumeRun}
        isActionLoading={isActionLoading}
      />

      {/* 2. Painel Executivo do Plano: Respostas às 4 Perguntas Fundamentais (Requisito 8) */}
      {currentRun ? (
        <div className="rounded-2xl border border-slate-800 bg-[#0d101a] p-5 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3 border-b border-slate-800/80 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                <Layers className="w-4.5 h-4.5" />
              </div>
              <div className="max-w-2xl">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono uppercase tracking-wider text-indigo-300 font-bold">
                    Plano de Engenharia Hierárquico
                  </span>
                  <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-slate-800 text-slate-300">
                    Modo {currentRun.autonomy_mode}
                  </span>
                </div>
                {/* 1. Qual é o objetivo? */}
                <div className="mt-1">
                  <div className="text-sm font-bold text-white leading-snug">
                    <strong>1. Objetivo: </strong>
                    <span className={showFullObjective ? '' : 'line-clamp-2'}>
                      {currentRun.objective}
                    </span>
                  </div>
                  {currentRun.objective && currentRun.objective.length > 140 && (
                    <button
                      type="button"
                      onClick={() => setShowFullObjective(!showFullObjective)}
                      className="text-[11px] text-indigo-400 hover:text-indigo-300 font-mono mt-0.5"
                    >
                      {showFullObjective ? 'Recolher objetivo' : 'Ver briefing completo'}
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Métrica de Progresso Real Comprovado */}
            <div className="flex items-center gap-4 text-xs font-mono">
              <div className="text-right">
                <div className="text-slate-300 font-bold tabular-nums">
                  {completedTasks} / {totalTasks} tarefas concluídas
                </div>
                <div className="text-[11px] text-slate-400 tabular-nums">
                  {reqSummary.total > 0 && `${reqSummary.verified}/${reqSummary.total} requisitos verificados`}
                </div>
              </div>
              <div className="px-3 py-1.5 rounded-xl bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 font-bold text-sm tabular-nums">
                {progressPct}%
              </div>
            </div>
          </div>

          {/* Barra de Progresso Real com Explicação Inequívoca (Sem 83% órfão) */}
          <div className="space-y-1.5">
            <div className="w-full h-2 rounded-full bg-slate-900 overflow-hidden">
              <div
                className={`h-full transition-all duration-500 ${
                  isRunBlocked || isRunError ? 'bg-rose-500' : isRunCompleted ? 'bg-emerald-500' : 'bg-indigo-500'
                }`}
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span>
                {progressPct === 100
                  ? '✓ Todos os critérios obrigatórios e requisitos foram validados e aprovados.'
                  : progressPct === 95 && completedTasks === totalTasks && totalTasks > 0
                  ? `✓ Todas as ${totalTasks} tarefas concluídas (trava de 95%: aguardando aprovação final dos requisitos obrigatórios).`
                  : `${completedTasks} de ${totalTasks} etapas validadas (${progressPct}%). ${totalTasks - completedTasks} etapa(s) restante(s).`}
              </span>
              {currentRun.last_error && (isRunBlocked || isRunError) && (
                <span className="text-rose-400 font-medium truncate max-w-md">
                  Bloqueio: {currentRun.last_error}
                </span>
              )}
            </div>
          </div>

          {/* Filtros de Tarefas */}
          <div className="flex items-center justify-between flex-wrap gap-2 pt-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs font-mono text-slate-400 flex items-center gap-1 mr-1">
                <Filter className="w-3.5 h-3.5 text-indigo-400" />
                <span>Filtrar:</span>
              </span>
              {([
                { id: 'all', label: 'Todas', count: filterCounts.all },
                { id: 'pending', label: 'Pendentes', count: filterCounts.pending },
                { id: 'in_progress', label: 'Em Execução', count: filterCounts.in_progress },
                { id: 'in_review', label: 'Em Revisão', count: filterCounts.in_review },
                { id: 'rework', label: 'Auto-correção', count: filterCounts.rework },
                { id: 'blocked', label: 'Bloqueadas', count: filterCounts.blocked },
                { id: 'completed', label: 'Concluídas', count: filterCounts.completed }
              ] as const).map(f => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilterMode(f.id)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-mono transition-colors border ${
                    filterMode === f.id
                      ? 'bg-indigo-600 text-white border-indigo-500 font-bold'
                      : 'bg-[#101420] text-slate-300 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  {f.label} ({f.count})
                </button>
              ))}
            </div>

            <div className="text-[11px] text-slate-400">
              * Clique em uma etapa para expandir suas tarefas e critérios.
            </div>
          </div>

          {/* Nível 2 & 3: Árvore Hierárquica (Grandes Tarefas -> Etapas -> Tarefas) Colapsadas por padrão */}
          {currentRun.majorTasks && currentRun.majorTasks.length > 0 ? (
            <div className="space-y-3 pt-2">
              {currentRun.majorTasks.map((major: MajorTask) => {
                const isMajorExpanded = expandedMajors[major.id] ?? true;
                const totalDesc = major.descendantsTotal ?? major.microtasks.length;
                const completedDesc = major.descendantsCompleted ?? major.microtasks.filter(m => m.status === 'completed').length;
                const visibleMicrotasks = major.microtasks.filter(mt => matchesFilter(mt, fullTaskMap.get(mt.id)));

                if (filterMode !== 'all' && visibleMicrotasks.length === 0) return null;

                return (
                  <div key={major.id} className="rounded-xl border border-slate-800 bg-[#0f1320] p-4 space-y-3">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => toggleMajor(major.id)}
                        className="flex items-center gap-2.5 flex-wrap text-left hover:text-indigo-200 transition-colors"
                      >
                        {isMajorExpanded ? (
                          <ChevronDown className="w-4 h-4 text-indigo-400" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-slate-400" />
                        )}
                        <span className="font-mono text-xs px-2 py-0.5 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 font-bold">
                          {major.code}
                        </span>
                        <strong className="text-sm text-white">{major.title}</strong>
                        <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-slate-800 text-cyan-300 border border-slate-700 uppercase">
                          {major.lifecycle_state || major.status}
                        </span>
                      </button>

                      <div className="flex items-center gap-3 text-xs font-mono text-slate-300">
                        <span>
                          <strong className="text-emerald-400">{completedDesc}</strong>/{totalDesc} concluídas
                        </span>
                        <span className="px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-300 border border-indigo-500/25">
                          {major.progressPct}%
                        </span>
                      </div>
                    </div>

                    {/* Conteúdo expandido da Grande Tarefa */}
                    {isMajorExpanded && (
                      <div className="pl-4 border-l-2 border-indigo-500/30 space-y-3 pt-2">
                        {major.stages && major.stages.length > 0 ? (
                          major.stages.map(stage => {
                            const stageKey = `${major.id}:${stage.code}`;
                            const isStageExpanded = expandedStages[stageKey] ?? true;
                            const stageMicrotasks = major.microtasks.filter(
                              mt => (mt.stageCode || fullTaskMap.get(mt.id)?.stage_code || `${major.code}-ET-1`) === stage.code
                            );
                            const visibleStageTasks = stageMicrotasks.filter(mt => matchesFilter(mt, fullTaskMap.get(mt.id)));
                            if (filterMode !== 'all' && visibleStageTasks.length === 0) return null;

                            return (
                              <div key={stage.code} className="rounded-lg border border-slate-800/90 bg-[#121626] p-3 space-y-2.5">
                                <button
                                  type="button"
                                  onClick={() => toggleStage(stageKey)}
                                  className="w-full flex items-center justify-between flex-wrap gap-2 text-left"
                                >
                                  <div className="flex items-center gap-2 flex-wrap">
                                    {isStageExpanded ? (
                                      <ChevronDown className="w-3.5 h-3.5 text-cyan-400" />
                                    ) : (
                                      <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                                    )}
                                    <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 font-semibold">
                                      Etapa {stage.code}
                                    </span>
                                    <span className="text-xs font-semibold text-slate-200">{stage.title}</span>
                                  </div>
                                  <span className="font-mono text-[10px] text-slate-400">
                                    {stageMicrotasks.filter(m => m.status === 'completed').length}/{stageMicrotasks.length} tarefas ({stage.progressPct}%)
                                  </span>
                                </button>

                                {isStageExpanded && (
                                  <div className="space-y-2 pl-2 border-l border-slate-800">
                                    {visibleStageTasks.map(mt => renderMicrotaskRow(mt))}
                                  </div>
                                )}
                              </div>
                            );
                          })
                        ) : (
                          <div className="space-y-2">
                            {visibleMicrotasks.map(mt => renderMicrotaskRow(mt))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="space-y-2 pt-2">
              {currentRun.tasks.map(task => renderMicrotaskRow(task))}
            </div>
          )}
        </div>
      ) : (
        <div className="p-8 rounded-2xl border border-slate-800 bg-[#0d101a] text-center space-y-3">
          <Layers className="w-8 h-8 text-slate-500 mx-auto" />
          <h3 className="text-sm font-bold text-white">Nenhum plano autônomo ativo no momento</h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            Envie um objetivo para o projeto na aba Chat para que o Supervisor gere a decomposição hierárquica completa.
          </p>
        </div>
      )}

      {/* 3. Seção Recolhível de Anotações Manuais (.ai-dev-hub/tasks.md) */}
      <div className="rounded-2xl border border-slate-800 bg-[#0d101a] overflow-hidden">
        <button
          type="button"
          onClick={() => setShowMemoryNotes(!showMemoryNotes)}
          className="w-full px-5 py-3.5 flex items-center justify-between text-left hover:bg-slate-900/50 transition-colors"
        >
          <div className="flex items-center gap-2.5">
            <FileText className="w-4 h-4 text-slate-400" />
            <div>
              <span className="text-xs font-bold text-slate-200">Anotações e Memória do Projeto</span>
              <span className="text-[11px] text-slate-500 ml-2">(.ai-dev-hub/tasks.md)</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-slate-400">
              {tasks.pending.length + tasks.doing.length + tasks.done.length} anotações
            </span>
            {showMemoryNotes ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
          </div>
        </button>

        {showMemoryNotes && (
          <div className="p-5 border-t border-slate-800/80 space-y-4 animate-message-enter">
            {/* Formulário Rápido de Adição */}
            <form onSubmit={handleAdd} className="flex items-center gap-2 flex-wrap">
              <input
                type="text"
                value={newText}
                onChange={e => setNewText(e.target.value)}
                placeholder="Adicionar nota rápida ou tarefa manual..."
                className="flex-1 min-w-[240px] bg-[#10131d] border border-[#202638] rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
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

            {/* 3 Colunas de Memória */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {columns.map(col => (
                <div key={col.id} className="bg-[#101420] border border-[#1b2033] rounded-xl overflow-hidden flex flex-col">
                  <div className="p-3 border-b border-[#1b2033] flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${col.dotColor}`} />
                      <span className="text-xs font-bold text-slate-200">{col.title}</span>
                    </div>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${col.badgeClass}`}>
                      {col.items.length}
                    </span>
                  </div>

                  <div className="p-2.5 space-y-2 max-h-56 overflow-y-auto">
                    {col.items.length === 0 ? (
                      <div className="py-6 text-center text-xs text-slate-500 italic">
                        Vazio
                      </div>
                    ) : (
                      col.items.map((task, idx) => (
                        <div key={idx} className="p-2 rounded-lg bg-[#141828] border border-[#202638] text-xs text-slate-300 flex items-center justify-between gap-2">
                          <span className="truncate">{task}</span>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            {col.id !== 'pending' && (
                              <button
                                type="button"
                                onClick={() => onMoveTask(task, col.id, col.id === 'done' ? 'doing' : 'pending')}
                                className="text-slate-400 hover:text-white p-1"
                                title="Voltar coluna"
                              >
                                <ArrowLeft className="w-3 h-3" />
                              </button>
                            )}
                            {col.id !== 'done' && (
                              <button
                                type="button"
                                onClick={() => onMoveTask(task, col.id, col.id === 'pending' ? 'doing' : 'done')}
                                className="text-slate-400 hover:text-indigo-400 p-1"
                                title="Avançar coluna"
                              >
                                <ArrowRight className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
