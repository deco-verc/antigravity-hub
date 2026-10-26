import React from 'react';
import { AutonomousRun, AutonomousTask, HomologationEvidenceData } from '../types';
import { resolveRunProgressPct } from '../services/progressUtils';
import { api } from '../services/api';
import {
  Loader2,
  CheckCircle2,
  AlertCircle,
  Clock,
  Play,
  RotateCw,
  Check,
  Pause,
  Layers,
  ArrowRight,
  Image as ImageIcon,
  Maximize2,
  ExternalLink,
  Sparkles,
  Terminal,
  Cpu,
  Search,
  Square
} from 'lucide-react';

interface DecoHubCurrentActivityWidgetProps {
  run?: AutonomousRun | null;
  agentStatus?: 'ready' | 'working' | 'error';
  evidence?: HomologationEvidenceData | null;
  onContinueOrResume?: () => void;
  onPause?: () => void;
  onStop?: () => void;
  onResolveApproval?: (decision: 'approved' | 'rejected') => void;
  onOpenAdvanced?: () => void;
  onOpenLightbox?: (img: { url: string; label: string; index?: number }) => void;
  onOpenLiveApp?: () => void;
  isStartingPreview?: boolean;
  isActionLoading?: boolean;
}

export const DecoHubCurrentActivityWidget: React.FC<DecoHubCurrentActivityWidgetProps> = ({
  run,
  agentStatus = 'ready',
  evidence,
  onContinueOrResume,
  onPause,
  onStop,
  onResolveApproval,
  onOpenAdvanced,
  onOpenLightbox,
  onOpenLiveApp,
  isStartingPreview = false,
  isActionLoading = false
}) => {
  // 1. Identify real active tasks, rework tasks and completed tasks from the run
  const allTasks = run?.tasks || [];
  const completedTasks = allTasks.filter(t => t.status === 'completed' || t.lifecycle_state === 'COMPLETED');

  // Retrabalho / Self-Healing task
  const reworkTask = allTasks.find(t =>
    t.status === 'needs_changes' ||
    t.lifecycle_state === 'REWORK_REQUIRED' ||
    t.review_decision === 'REJECTED' ||
    (t as any).reviewDecision === 'REJECTED'
  );

  // Revisão independente
  const reviewTask = allTasks.find(t =>
    t.status === 'in_review' ||
    t.lifecycle_state === 'REVIEW_PENDING' ||
    t.lifecycle_state === 'COMMIT_PENDING'
  );

  // Execução ativa
  const inProgressTask = allTasks.find(t =>
    (t.status === 'in_progress' || t.lifecycle_state === 'IN_PROGRESS') &&
    t.status !== 'needs_changes' &&
    t.lifecycle_state !== 'REWORK_REQUIRED'
  );

  const pendingTasks = allTasks.filter(t =>
    (t.status === 'pending' || t.status === 'ready' || t.lifecycle_state === 'PLANNED' || t.lifecycle_state === 'READY') &&
    t.lifecycle_state !== 'REWORK_REQUIRED' &&
    t.status !== 'needs_changes'
  );

  const readyTask = allTasks.find(t =>
    (t.status === 'ready' || t.lifecycle_state === 'READY') &&
    t.status !== 'needs_changes' &&
    t.lifecycle_state !== 'REWORK_REQUIRED'
  );

  // 2. Derive honest states adhering strictly to the official execution states
  const hasPendingApprovals = Array.isArray(run?.approvals) && run.approvals.some(a => a.status === 'pending');
  const isWaitingApproval = run?.status === 'waiting_approval' || hasPendingApprovals;
  const isWaitingResource = run?.status === 'waiting_resource';
  const isBlocked = run?.status === 'blocked';
  const isError = run?.status === 'error' || agentStatus === 'error';
  const isPaused = run?.status === 'paused';
  const isTechnicalPause = isPaused && Boolean(run?.last_error && !/USER_REQUESTED|MANUAL_PAUSE/.test(run.last_error));
  const isPlanning = run?.status === 'planning';
  const isCompleted = run?.status === 'completed';

  // Specific state distinctions: Single source of truth
  const isTerminalRun = isCompleted || run?.status === 'failed';
  const hasRemainingTasks = allTasks.length > 0 && completedTasks.length < allTasks.length;

  const isRunActive = Boolean(
    run &&
    !isTerminalRun &&
    !isWaitingApproval &&
    !isWaitingResource &&
    !isBlocked &&
    !isError &&
    !isPaused &&
    (
      ['running', 'building', 'testing', 'reviewing', 'planning', 'waiting_for_worker'].includes(run.status) ||
      hasRemainingTasks
    )
  );

  const isSelfHealing = Boolean(reworkTask);
  const isReviewing = (run?.status === 'reviewing' || Boolean(reviewTask)) && !isSelfHealing;
  const isExecuting = !isSelfHealing && !isReviewing && !isPlanning && (
    isRunActive || Boolean(inProgressTask || agentStatus === 'working')
  );

  // 3. Status Badge derivation
  const getStatusBadge = () => {
    if (!run && agentStatus === 'working') {
      return (
        <span className="px-2.5 py-0.5 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 text-xs font-semibold flex items-center gap-1.5">
          <Loader2 className="w-3.5 h-3.5 text-indigo-400 animate-spin" />
          Conectando
        </span>
      );
    }
    if (isWaitingApproval) {
      return (
        <span className="px-2.5 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs font-semibold flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
          Aguardando aprovação
        </span>
      );
    }
    if (isWaitingResource) {
      return (
        <span className="px-2.5 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-200 text-xs font-semibold flex items-center gap-1.5" title="Auto-Recovery ativo: reconexão automática em andamento">
          <RotateCw className="w-3.5 h-3.5 text-amber-400 animate-spin" />
          Aguardando reconexão automática
        </span>
      );
    }
    if (isBlocked) {
      return (
        <span className="px-2.5 py-0.5 rounded-full bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs font-semibold flex items-center gap-1.5">
          <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
          Bloqueado
        </span>
      );
    }
    if (isError) {
      return (
        <span className="px-2.5 py-0.5 rounded-full bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs font-semibold flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-rose-400" />
          Com erro
        </span>
      );
    }
    if (isPaused) {
      return (
        <span className="px-2.5 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-300 text-xs font-semibold flex items-center gap-1.5">
          <Pause className="w-3 h-3 text-slate-400" />
          Pausado
        </span>
      );
    }
    if (isPlanning) {
      const isWaveZero = Boolean(
        run?.next_action && /pesquisa|onda\s*0|discovery|rea|estudo\s*de\s*mercado/i.test(run.next_action)
      );
      return (
        <span className="px-2.5 py-0.5 rounded-full bg-purple-500/15 border border-purple-500/30 text-purple-300 text-xs font-semibold flex items-center gap-1.5">
          {isWaveZero ? (
            <Search className="w-3 h-3 text-purple-400 animate-pulse" />
          ) : (
            <Loader2 className="w-3 h-3 text-purple-400 animate-spin" />
          )}
          {isWaveZero ? 'Onda 0: Pesquisa & REA' : 'Planejando'}
        </span>
      );
    }
    if (isSelfHealing) {
      return (
        <span className="px-2.5 py-0.5 rounded-full bg-orange-500/15 border border-orange-500/30 text-orange-300 text-xs font-semibold flex items-center gap-1.5">
          <RotateCw className="w-3.5 h-3.5 text-orange-400 animate-spin" />
          Auto-correção / Retrabalho
        </span>
      );
    }
    if (isReviewing) {
      return (
        <span className="px-2.5 py-0.5 rounded-full bg-sky-500/15 border border-sky-500/30 text-sky-300 text-xs font-semibold flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-sky-400 animate-pulse" />
          Em revisão independente
        </span>
      );
    }
    if (isExecuting || isRunActive) {
      const phaseLabel = run?.status === 'building'
        ? 'Construindo'
        : run?.status === 'testing'
        ? 'Validando 4 Portões'
        : inProgressTask?.lifecycle_state === 'COMMIT_PENDING'
        ? 'Vinculando commit'
        : run?.activeSlashCommand
        ? 'Sincronizando Skill'
        : 'Em execução';

      return (
        <span className="px-2.5 py-0.5 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 text-xs font-semibold flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
          {phaseLabel}
        </span>
      );
    }
    if (isCompleted) {
      return (
        <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-semibold flex items-center gap-1.5">
          <Check className="w-3.5 h-3.5 text-emerald-400" />
          Concluído
        </span>
      );
    }
    return (
      <span className="px-2.5 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-300 text-xs font-semibold flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-emerald-400" />
        Pronto
      </span>
    );
  };

  // 4. Content fields derivation
  // Agora:
  const getNowContent = () => {
    if (!run && agentStatus === 'working') {
      return 'Iniciando planejamento e conectando ao agente...';
    }
    if (isPlanning) {
      if (run?.next_action && /pesquisa|onda\s*0|discovery|rea|estudo\s*de\s*mercado/i.test(run.next_action)) {
        return 'Onda 0: Analisando mercado, referências globais/BR e modelando arquitetura REA.';
      }
      return 'Construindo o plano hierárquico e mapeando dependências.';
    }
    if (isSelfHealing) {
      const target = reworkTask || inProgressTask;
      const skillName = target?.skill_routed || run?.activeSlashCommand?.split('—')[0]?.trim() || '';
      const skillSuffix = skillName ? ` — Skill: ${skillName}` : '';
      return target
        ? `${target.title} (Auto-correção autônoma: aplicando ajustes solicitados pela revisão${skillSuffix})`
        : 'Auto-correção em andamento: refinando código para atender critérios.';
    }
    if (isReviewing) {
      const target = reviewTask || inProgressTask;
      const skillName = target?.skill_routed || run?.activeSlashCommand?.split('—')[0]?.trim() || '';
      const skillSuffix = skillName ? ` — Skill: ${skillName}` : '';
      return target
        ? `${target.title} (Em revisão independente por Supervisor/Evaluator${skillSuffix})`
        : 'Revisão independente em andamento.';
    }
    if (isExecuting || isRunActive) {
      if (inProgressTask) {
        const actionLabel = inProgressTask.lifecycle_state === 'COMMIT_PENDING'
          ? 'Vinculando commit Git verificado'
          : 'Implementando código e testes';
        const skillName = inProgressTask.skill_routed || run?.activeSlashCommand?.split('—')[0]?.trim() || '';
        const skillSuffix = skillName ? ` — Skill: ${skillName}` : '';
        return `${inProgressTask.title} (${actionLabel}${skillSuffix})`;
      }
      const nextTarget = readyTask || pendingTasks[0];
      if (nextTarget) {
        const skillName = nextTarget.skill_routed || run?.activeSlashCommand?.split('—')[0]?.trim() || '';
        const skillSuffix = skillName ? ` [${skillName}]` : '';
        return `Preparando e injetando contexto da Skill${skillSuffix} para: ${nextTarget.title}`;
      }
      if (run?.activeSlashCommand) {
        return `Executando Skill [${run.activeSlashCommand.split('—')[0].trim()}] — Validando e aplicando alterações no projeto.`;
      }
      return 'Trabalho ativo em execução.';
    }
    if (isWaitingApproval) {
      return 'Aguardando sua aprovação para prosseguir com a próxima etapa.';
    }
    if (isWaitingResource) {
      return 'Runtime Antigravity temporariamente indisponível. Auto-Recovery ativo com reconexão automática em andamento.';
    }
    if (isBlocked || isError) {
      return 'Execução interrompida. Intervenção ou diagnóstico necessário.';
    }
    if (isPaused) {
      return 'Execução pausada. O progresso e arquivos foram preservados.';
    }
    if (isCompleted) {
      return 'Todas as etapas planejadas foram validadas e concluídas com sucesso.';
    }
    return 'Nenhuma tarefa em execução. O sistema está pronto para novas instruções.';
  };

  // Último resultado:
  const getLastResultContent = () => {
    if (completedTasks.length > 0) {
      const last = completedTasks[completedTasks.length - 1];
      return `[VALIDADO] ${last.title}`;
    }
    if (isCompleted) {
      return 'Ciclo anterior validado e aprovado com sucesso.';
    }
    return 'Nenhuma etapa anterior registrada neste ciclo.';
  };

  // Próximo passo (claramente como previsão):
  const getNextStepContent = () => {
    if (!run && agentStatus === 'working') {
      return 'Iniciando planejamento e conectando ao agente...';
    }
    if (isWaitingApproval) {
      return 'Aprovar a etapa pendente para liberar o Worker.';
    }
    if (isWaitingResource) {
      return 'Auto-Recovery: aguardando resposta do runtime para retomar automaticamente.';
    }
    if (isSelfHealing) {
      return 'Concluir correção do código e submeter novamente à revisão independente.';
    }
    if (isReviewing) {
      return 'Validar critérios de aceitação e gerar commit após aprovação.';
    }
    if (isBlocked || isError) {
      return 'Revisar diagnóstico ou clicar em Tentar Novamente para continuar.';
    }
    if (isPaused) {
      return 'Clicar em Retomar para continuar o plano a partir da etapa pendente.';
    }
    const nextInQueue = pendingTasks.find(t => t.id !== inProgressTask?.id && t.id !== reworkTask?.id && t.id !== reviewTask?.id);
    if (nextInQueue) {
      return `Fila: ${nextInQueue.title}`;
    }
    if (run?.next_action && !['null', 'none'].includes(run.next_action.toLowerCase())) {
      return `Previsão: ${run.next_action}`;
    }
    if (isCompleted) {
      return 'Aguardando nova instrução ou objetivo do projeto.';
    }
    return 'Aguardando objetivo ou solicitação no chat.';
  };

  // Clean error message without technical noise
  const cleanReason = run?.last_error
    ? run.last_error
        .replace(/\[AI DEV Council\]:[^\n]*/gi, '')
        .replace(/\(NEEDS_EVIDENCE:[^\n]*/gi, '')
        .trim()
    : null;

  const total = allTasks.length;
  const completed = completedTasks.length;
  const progressPct = resolveRunProgressPct(run);
  const isProgressClamped = total > 0 && completed === total && progressPct === 95 && !isCompleted;

  return (
    <div className="rounded-2xl bg-[#0c0f18] border border-[#1f253a] p-4 shadow-md space-y-3 animate-message-enter">
      {/* Linha Superior: Agora & Estado */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-2.5 border-b border-[#181d2f]">
        <div className="flex items-start sm:items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-400 flex items-center justify-center flex-shrink-0 mt-0.5 sm:mt-0">
            {isSelfHealing ? (
              <RotateCw className="w-4 h-4 animate-spin text-orange-400" />
            ) : isReviewing ? (
              <Clock className="w-4 h-4 animate-pulse text-sky-400" />
            ) : isExecuting || isRunActive || isPlanning ? (
              <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
            ) : isCompleted ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            ) : isBlocked || isError ? (
              <AlertCircle className="w-4 h-4 text-rose-400" />
            ) : (
              <Layers className="w-4 h-4 text-slate-400" />
            )}
          </div>
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
              Atividade Atual
            </span>
            <div className="text-xs font-semibold text-white leading-snug">
              <strong>Agora:</strong> <span className={
                isSelfHealing
                  ? 'text-orange-200'
                  : isReviewing
                  ? 'text-sky-200'
                  : isExecuting || isRunActive
                  ? 'text-indigo-200'
                  : 'text-slate-200'
              }>{getNowContent()}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-[11px] text-slate-400 font-medium">Estado:</span>
          {getStatusBadge()}
          {run && !isTerminalRun && (
            <div className="flex items-center gap-1.5 ml-1">
              {isRunActive && onPause && (
                <button
                  type="button"
                  onClick={onPause}
                  disabled={isActionLoading}
                  aria-label="Pausar execução"
                  title="Pausar execução"
                  className="px-2.5 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 font-semibold text-xs flex items-center gap-1 transition-colors cursor-pointer"
                >
                  <Pause className="w-3.5 h-3.5" />
                  <span>Pausar</span>
                </button>
              )}
              {(isPaused || isBlocked || isError) && onContinueOrResume && (
                <button
                  type="button"
                  onClick={onContinueOrResume}
                  disabled={isActionLoading}
                  aria-label="Retomar execução"
                  title="Retomar execução"
                  className="px-2.5 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 font-semibold text-xs flex items-center gap-1 transition-colors cursor-pointer"
                >
                  {isActionLoading ? <RotateCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                  <span>Retomar</span>
                </button>
              )}
              {onStop && (
                <button
                  type="button"
                  onClick={onStop}
                  disabled={isActionLoading}
                  aria-label="Cancelar build"
                  title="Cancelar build"
                  className="px-2.5 py-1 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 font-semibold text-xs flex items-center gap-1 transition-colors cursor-pointer"
                >
                  <Square className="w-3.5 h-3.5" />
                  <span>Cancelar</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Faixa Técnica: Skill / Slash Command em Execução + Chips de Skills Ativas */}
      {(run?.activeSlashCommand || run?.currentExecutionSpecialty || (run?.activeSkillsList && run.activeSkillsList.length > 0)) && (
        <div className="p-2.5 rounded-xl bg-[#080a13] border border-indigo-500/20 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] uppercase font-bold text-slate-400 flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-indigo-400" />
              Skill em execução:
            </span>
            {run.activeSlashCommand && (
              <span className="px-2 py-0.5 rounded-md bg-indigo-500/20 border border-indigo-500/40 text-indigo-200 font-mono text-[11px] font-semibold flex items-center gap-1">
                <span>{run.activeSlashCommand}</span>
              </span>
            )}
            {run.currentExecutionSpecialty && (
              <span className="px-2 py-0.5 rounded-md bg-slate-800 border border-slate-700 text-slate-300 font-mono text-[10px] font-medium flex items-center gap-1">
                <Terminal className="w-2.5 h-2.5 text-slate-400" />
                <span>{run.currentExecutionSpecialty}</span>
              </span>
            )}
          </div>

          {run.activeSkillsList && run.activeSkillsList.length > 0 && (() => {
            const rawList: string[] = Array.isArray(run.activeSkillsList) ? run.activeSkillsList : [];
            const sanitizedSet = new Set<string>();

            for (const item of rawList) {
              if (typeof item !== 'string') continue;
              const trimmed = item.trim();
              if (!trimmed) continue;

              // Se contiver padrões longos como "ARQUIVOS DE SKILL" ou "[RECEITA...", tenta extrair o nome do arquivo .md
              if (trimmed.length > 35 || trimmed.startsWith('[') || trimmed.includes('\n') || trimmed.includes('ARQUIVOS DE SKILL')) {
                const mdMatches = trimmed.match(/([a-zA-Z0-9_\-]+)\.md/gi);
                if (mdMatches) {
                  for (const m of mdMatches) {
                    const cleanName = m.replace(/\.md$/i, '').trim();
                    if (cleanName.length > 0 && cleanName.length <= 35) {
                      sanitizedSet.add(cleanName);
                    }
                  }
                }
                continue;
              }

              // Nome curto regular: limpa extensão .md se houver
              const clean = trimmed.replace(/\.md$/i, '').trim();
              if (clean.length > 0 && clean.length <= 35 && clean.split(/\s+/).length <= 3) {
                sanitizedSet.add(clean);
              }
            }

            const cleanSkills = Array.from(sanitizedSet);
            if (!cleanSkills.length) return null;

            return (
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] text-slate-400 font-medium">Skills ativas:</span>
                <div className="flex items-center gap-1 flex-wrap">
                  {cleanSkills.slice(0, 5).map((skillName: string) => (
                    <span
                      key={skillName}
                      className="px-1.5 py-0.5 rounded bg-[#101424] border border-[#1e253e] text-slate-300 text-[10px] font-mono"
                      title={`Skill provisionada: ${skillName}`}
                    >
                      {skillName}
                    </span>
                  ))}
                  {cleanSkills.length > 5 && (
                    <span className="text-[9px] text-slate-400 font-mono">
                      +{cleanSkills.length - 5}
                    </span>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* Visão Factual Compacta do Que Já Foi Validado vs. Em Execução vs. Próximo */}
      {allTasks.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 text-xs">
          {/* Coluna 1: Validadas */}
          <div className="p-2.5 rounded-xl bg-[#080a11] border border-[#181d2f] space-y-1.5">
            <span className="text-[10px] uppercase font-bold text-slate-400 flex items-center gap-1.5">
              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
              Validadas ({completedTasks.length}/{allTasks.length})
            </span>
            {completedTasks.length > 0 ? (
              <div className="space-y-1">
                {completedTasks.slice(-2).map(t => (
                  <div key={t.id} className="text-slate-300 font-medium text-[11px] truncate flex items-center gap-1.5" title={t.title}>
                    <span className="text-[9px] px-1 py-0.2 rounded bg-emerald-500/15 text-emerald-300 font-mono flex-shrink-0">
                      VALIDADO
                    </span>
                    <span className="truncate">{t.title}</span>
                  </div>
                ))}
                {completedTasks.length > 2 && (
                  <p className="text-[9px] text-slate-500 font-mono">
                    +{completedTasks.length - 2} etapa(s) validada(s) anteriormente
                  </p>
                )}
              </div>
            ) : (
              <p className="text-slate-500 text-[11px] italic">
                Nenhuma validação concluída ainda.
              </p>
            )}
          </div>

          {/* Coluna 2: Em Execução Agora */}
          <div className="p-2.5 rounded-xl bg-[#080a11] border border-indigo-500/25 space-y-1.5">
            <span className="text-[10px] uppercase font-bold text-indigo-300 flex items-center gap-1.5">
              {isSelfHealing ? (
                <RotateCw className="w-3 h-3 text-orange-400 animate-spin" />
              ) : isReviewing ? (
                <Clock className="w-3 h-3 text-sky-400 animate-pulse" />
              ) : isExecuting || isRunActive ? (
                <Loader2 className="w-3 h-3 text-indigo-400 animate-spin" />
              ) : (
                <Layers className="w-3 h-3 text-slate-400" />
              )}
              Em Execução Agora
            </span>
            <div className="space-y-1">
              <p className="text-white font-medium text-[11px] line-clamp-2">
                {inProgressTask
                  ? inProgressTask.title
                  : reviewTask
                  ? reviewTask.title
                  : reworkTask
                  ? reworkTask.title
                  : readyTask
                  ? `Preparando: ${readyTask.title}`
                  : pendingTasks[0]
                  ? `Aguardando: ${pendingTasks[0].title}`
                  : isCompleted
                  ? 'Todas as tarefas concluídas'
                  : 'Processando ciclo autônomo'}
              </p>
              <div className="flex items-center gap-1 flex-wrap">
                {(inProgressTask?.skill_routed || reviewTask?.skill_routed || reworkTask?.skill_routed || readyTask?.skill_routed || run?.currentExecutionSpecialty) && (
                  <span className="px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-300 font-mono text-[9px]">
                    {inProgressTask?.skill_routed || reviewTask?.skill_routed || reworkTask?.skill_routed || readyTask?.skill_routed || run?.currentExecutionSpecialty}
                  </span>
                )}
                {inProgressTask?.stage_code && (
                  <span className="px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 font-mono text-[9px]">
                    {inProgressTask.stage_code}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Coluna 3: Próxima Validação na Fila */}
          <div className="p-2.5 rounded-xl bg-[#080a11] border border-[#181d2f] space-y-1.5">
            <span className="text-[10px] uppercase font-bold text-slate-400 flex items-center gap-1.5">
              <ArrowRight className="w-3 h-3 text-slate-400" />
              Próxima Validação na Fila
            </span>
            <div className="space-y-1">
              <p className="text-indigo-200 font-medium text-[11px] line-clamp-2">
                {getNextStepContent()}
              </p>
            </div>
          </div>
        </div>
      ) : (
        /* Fallback quando não há tarefas carregadas */
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <div className="p-2.5 rounded-xl bg-[#080a11] border border-[#181d2f] space-y-1">
            <span className="text-[10px] uppercase font-bold text-slate-400 flex items-center gap-1.5">
              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
              Último resultado
            </span>
            <p className="text-slate-300 font-medium text-[11px] line-clamp-2">
              {getLastResultContent()}
            </p>
          </div>

          <div className="p-2.5 rounded-xl bg-[#080a11] border border-[#181d2f] space-y-1">
            <span className="text-[10px] uppercase font-bold text-slate-400 flex items-center gap-1.5">
              <ArrowRight className="w-3 h-3 text-indigo-400" />
              Próximo passo previsto
            </span>
            <p className="text-indigo-200 font-medium text-[11px] line-clamp-2">
              {getNextStepContent()}
            </p>
          </div>
        </div>
      )}

      {/* 4. Card Visual de Entrega Final com Screenshots e 4 Selos de Homologação (quando o run está concluído) */}
      {isCompleted && evidence && evidence.screenshots && evidence.screenshots.length > 0 && (
        <div className="p-3.5 rounded-xl border border-emerald-500/30 bg-[#080d18] space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-[#182236]">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                <ImageIcon className="w-4 h-4" />
              </div>
              <div>
                <h5 className="text-xs font-bold text-white tracking-tight flex items-center gap-1.5">
                  <span>Evidências Visuais do Pedido Concluído</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono font-normal">
                    {evidence.screenshots.length} Captura{evidence.screenshots.length > 1 ? 's' : ''} Playwright Real
                  </span>
                </h5>
                <p className="text-[10px] text-slate-400">
                  Inspeção em navegador real com renderização visual, formulário, mobile e persistência F5
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {evidence.overallScore !== undefined && (
                <div className="flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 font-mono text-[11px] font-bold">
                  <span>{evidence.overallScore}% Homologado</span>
                </div>
              )}
              {evidence.screenshots.length > 0 && onOpenLightbox && (
                <button
                  type="button"
                  onClick={() => {
                    const first = evidence.screenshots[0];
                    if (first) {
                      const cleanFilename = first.filename || (first.url ? first.url.split('/').pop()?.split('?')[0] : '') || 'screenshot.png';
                      const cacheBuster = first.updatedAt ? new Date(first.updatedAt).getTime() : Date.now();
                      const resolvedUrl = api.getEvidenceFileUrl(run?.project_id || evidence.projectId || '', cleanFilename, cacheBuster);
                      onOpenLightbox({ url: resolvedUrl, label: first.label || first.filename, index: 0 });
                    }
                  }}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 text-xs font-medium transition-colors cursor-pointer"
                  title="Abrir galeria completa no visualizador carrossel"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                  <span>Expandir Galeria</span>
                </button>
              )}
            </div>
          </div>

          {/* Grid de Miniaturas Clicáveis com Scroll Interno */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 max-h-[360px] overflow-y-auto pr-1 custom-scrollbar [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-slate-700/60">
            {evidence.screenshots.map((s, idx) => {
              const cleanFilename = s.filename || (s.url ? s.url.split('/').pop()?.split('?')[0] : '') || 'screenshot.png';
              const cacheBuster = s.updatedAt ? new Date(s.updatedAt).getTime() : Date.now();
              const resolvedUrl = api.getEvidenceFileUrl(run?.project_id || evidence.projectId || '', cleanFilename, cacheBuster);

              return (
                <div
                  key={s.filename || idx}
                  onClick={() => onOpenLightbox?.({ url: resolvedUrl, label: s.label || s.filename, index: idx })}
                  className="group cursor-pointer rounded-lg overflow-hidden border border-[#1e2538] bg-[#05070d] hover:scale-[1.02] hover:border-emerald-500/60 transition-all shadow-sm flex flex-col"
                  title="Clique para ampliar em tela cheia"
                >
                  <div className="relative aspect-video bg-[#030508] flex items-center justify-center overflow-hidden">
                    <img
                      src={resolvedUrl}
                      alt={s.label || s.filename}
                      className="w-full h-full object-cover object-top group-hover:scale-105 transition-transform duration-200"
                      loading="lazy"
                    />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white">
                      <Maximize2 className="w-3.5 h-3.5 drop-shadow" />
                    </div>
                    <div className="absolute bottom-0 inset-x-0 bg-black/75 py-0.5 px-1 text-[9px] text-center text-emerald-300 opacity-0 group-hover:opacity-100 transition-opacity font-medium tracking-tight pointer-events-none">
                      Clique para ampliar
                    </div>
                  </div>
                  <div className="p-1.5 text-[10px] bg-[#0c101c]">
                    <p className="font-medium text-slate-200 truncate" title={s.label || s.filename}>
                      {s.label || s.filename}
                    </p>
                    {s.sizeBytes ? (
                      <p className="text-[9px] text-slate-500 font-mono mt-0.5">
                        {(s.sizeBytes / 1024).toFixed(0)} KB
                      </p>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Selos de Homologação + Botão Abrir App Ao Vivo */}
          <div className="pt-2 border-t border-[#182236] flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {evidence.badges && evidence.badges.map(b => (
                <span
                  key={b.id}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                    b.status === 'PASSED'
                      ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                      : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                  }`}
                  title={b.details}
                >
                  <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                  <span>{b.title.split(' ')[0]} ({b.status === 'PASSED' ? 'Aprovado' : 'Pendente'})</span>
                </span>
              ))}
            </div>

            {onOpenLiveApp && (
              <button
                type="button"
                onClick={onOpenLiveApp}
                disabled={isStartingPreview}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm transition-all ml-auto disabled:opacity-50"
              >
                {isStartingPreview ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <ExternalLink className="w-3.5 h-3.5" />
                )}
                <span>Abrir Aplicativo Ao Vivo</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Ação ou Decisão Pendente Quando Existir Bloqueio / Aprovação / Auto-Recovery */}
      {(isWaitingApproval || isWaitingResource || isBlocked || isError || isPaused) && (
        <div className={`p-3 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs ${
          isBlocked || isError
            ? 'bg-rose-950/20 border-rose-500/30 text-rose-200'
            : isWaitingApproval
            ? 'bg-amber-950/20 border-amber-500/30 text-amber-200'
            : isWaitingResource
            ? 'bg-amber-950/20 border-amber-500/30 text-amber-200'
            : 'bg-slate-900 border-slate-700 text-slate-300'
        }`}>
          <div className="space-y-0.5">
            <div className="font-bold flex items-center gap-1.5">
              {isWaitingApproval ? (
                <span>Decisão Pendente: Aprovação de Segurança Necessária</span>
              ) : isWaitingResource ? (
                <span className="flex items-center gap-1.5">
                  <RotateCw className="w-3.5 h-3.5 text-amber-400 animate-spin" />
                  Auto-Recovery Ativo: Aguardando reconexão automática do runtime
                </span>
              ) : isBlocked || isError ? (
                <span>Motivo da Interrupção</span>
              ) : isTechnicalPause ? (
                <span>Execução Pausada por Obstáculo Técnico</span>
              ) : (
                <span>Execução Pausada pelo Usuário</span>
              )}
            </div>
            <p className="text-[11px] opacity-90 line-clamp-2">
              {isWaitingResource
                ? 'Tentativas automáticas de reconexão ativas. O fluxo será retomado assim que o runtime responder.'
                : (cleanReason || 'Nenhuma falha crítica detalhada. Você pode tentar retomar a execução com segurança.')}
            </p>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {onOpenAdvanced && (
              <button
                type="button"
                onClick={onOpenAdvanced}
                aria-label="Ver diagnóstico detalhado da execução"
                className="px-3 py-1.5 rounded-lg bg-[#141824] hover:bg-[#1a2030] border border-[#23293d] text-slate-300 hover:text-white font-medium text-xs transition-colors"
              >
                Ver Diagnóstico
              </button>
            )}
            {isWaitingApproval && onResolveApproval ? (
              <button
                type="button"
                onClick={() => onResolveApproval('approved')}
                disabled={isActionLoading}
                aria-label="Aprovar e prosseguir execução"
                className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold text-xs flex items-center gap-1.5 transition-colors shadow-sm"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Aprovar e Prosseguir</span>
              </button>
            ) : onContinueOrResume ? (
              <button
                type="button"
                onClick={onContinueOrResume}
                disabled={isActionLoading}
                aria-label="Retomar ou continuar execução autônoma"
                className={`px-3.5 py-1.5 rounded-lg font-semibold text-xs flex items-center gap-1.5 transition-colors shadow-sm ${
                  isBlocked || isError
                    ? 'bg-rose-600 hover:bg-rose-500 text-white'
                    : isWaitingResource
                    ? 'bg-amber-600 hover:bg-amber-500 text-white'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                }`}
              >
                {isActionLoading ? (
                  <>
                    <RotateCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Retomando...</span>
                  </>
                ) : isBlocked || isError ? (
                  <>
                    <RotateCw className="w-3.5 h-3.5" />
                    <span>Tentar Novamente (Continuar)</span>
                  </>
                ) : isWaitingResource ? (
                  <>
                    <RotateCw className="w-3.5 h-3.5" />
                    <span>Verificar Reconexão</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5" />
                    <span>Retomar</span>
                  </>
                )}
              </button>
            ) : null}
            {onStop && (
              <button
                type="button"
                onClick={onStop}
                disabled={isActionLoading}
                aria-label="Cancelar execução"
                title="Cancelar execução"
                className="px-3.5 py-1.5 rounded-lg bg-rose-950/40 hover:bg-rose-900/60 border border-rose-500/30 text-rose-300 font-semibold text-xs flex items-center gap-1.5 transition-colors shadow-sm cursor-pointer"
              >
                <Square className="w-3.5 h-3.5" />
                <span>Cancelar</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Progresso com Explicação Honesta e Trava de 95% para Requisitos Obrigatórios */}
      {total > 0 && (
        <div className="pt-1 space-y-1">
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span>
              Progresso comprovado: <strong className="text-white tabular-nums font-mono">{completed} de {total} tarefas validadas</strong>
              {isProgressClamped ? (
                <span className="ml-1 text-amber-300 font-medium">(Trava de 95%: aguardando verificação final de requisitos)</span>
              ) : total > completed && (isBlocked || isError || isPaused) ? (
                <span className="ml-1 text-amber-300">({total - completed} restante{total - completed > 1 ? 's' : ''} aguardando continuidade)</span>
              ) : null}
            </span>
            <span className="font-mono text-indigo-300 font-bold tabular-nums">{progressPct}%</span>
          </div>
          <div className="w-full h-1.5 rounded-full bg-slate-900 overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${
                isBlocked || isError
                  ? 'bg-rose-500'
                  : isSelfHealing
                  ? 'bg-orange-500'
                  : isReviewing
                  ? 'bg-sky-500'
                  : isWaitingApproval || isWaitingResource
                  ? 'bg-amber-500'
                  : isCompleted
                  ? 'bg-emerald-500'
                  : 'bg-indigo-500'
              }`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
};
