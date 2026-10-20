import { AutonomousRun, AutonomousTask, ProjectRequirement } from '../types';

/**
 * Resolves the true progress percentage of an autonomous run.
 * Prioritizes the backend's official calculation (run.stats.progressPct or run.progress_pct / run.progressPct),
 * or enforces the strict 95% ceiling rule if mandatory requirements remain unverified,
 * guaranteeing the UI NEVER displays 100% until all mandatory requirements are proven and verified.
 */
export function resolveRunProgressPct(run?: AutonomousRun | null): number {
  if (!run) return 0;

  // 1. Prioritize official backend calculation if present
  if (typeof run.stats?.progressPct === 'number') {
    return Math.max(0, Math.min(100, Math.round(run.stats.progressPct)));
  }
  if (typeof run.progress_pct === 'number') {
    return Math.max(0, Math.min(100, Math.round(run.progress_pct)));
  }
  if (typeof run.progressPct === 'number') {
    return Math.max(0, Math.min(100, Math.round(run.progressPct)));
  }

  // 2. Strict calculation matching backend rule (autonomousManager.ts & hierarchicalOrchestrationService.ts)
  const allTasks = run.tasks || [];
  const totalTasks = allTasks.length;
  if (totalTasks === 0) return 0;

  const completedTasks = allTasks.filter(
    t => t.status === 'completed' || t.lifecycle_state === 'COMPLETED'
  ).length;
  const rawTaskPct = Math.round((completedTasks / totalTasks) * 100);

  const reqs: ProjectRequirement[] = run.projectRequirements || [];
  const mandatoryReqs = reqs.filter(r => r.mandatory);
  const verifiedMandatory = mandatoryReqs.filter(
    r => r.status === 'verified' || r.verificationStatus === 'verified' || (r as any).verificationStatus === 'review_approved'
  ).length;
  const requirementsVerificationPct = mandatoryReqs.length > 0
    ? Math.round((verifiedMandatory / mandatoryReqs.length) * 100)
    : 100;

  // Trava de 95%: se houver requisitos obrigatórios pendentes de verificação
  if (mandatoryReqs.length > 0 && requirementsVerificationPct < 100) {
    if (rawTaskPct >= 95) {
      return Math.min(95, Math.round(rawTaskPct * 0.7 + requirementsVerificationPct * 0.3));
    }
  }

  // Se todas as tarefas estiverem completas mas o status geral ainda não for completed e houver requisitos pendentes
  if (rawTaskPct === 100 && run.status !== 'completed' && mandatoryReqs.length > 0 && requirementsVerificationPct < 100) {
    return 95;
  }

  return rawTaskPct;
}

export type TaskLifecycleDisplayCategory =
  | 'executing'
  | 'reviewing'
  | 'rework'
  | 'waiting_resource'
  | 'waiting_approval'
  | 'blocked'
  | 'completed'
  | 'pending';

/**
 * Categorizes a task or run state into one of the explicit UI operational states:
 * - Em execução (running / in_progress)
 * - Em revisão independente (reviewing / in_review)
 * - Auto-correção / Retrabalho em andamento (needs_changes / REWORK_REQUIRED)
 * - Aguardando reconexão automática do runtime (waiting_resource)
 * - Bloqueado / Aguardando aprovação humana (blocked / waiting_approval / paused)
 */
export function getTaskStateCategory(
  task: AutonomousTask,
  run?: AutonomousRun | null
): TaskLifecycleDisplayCategory {
  const status = (task.status || '').toLowerCase();
  const lc = (task.lifecycle_state || '').toUpperCase();
  const reviewDecision = (task.review_decision || (task as any).reviewDecision || '').toUpperCase();

  if (status === 'completed' || lc === 'COMPLETED') {
    return 'completed';
  }

  if (status === 'needs_changes' || lc === 'REWORK_REQUIRED' || reviewDecision === 'REJECTED') {
    return 'rework';
  }

  if (
    status === 'in_review' ||
    status === 'approved' ||
    status === 'commit_pending' ||
    lc === 'REVIEW_PENDING' ||
    lc === 'COMMIT_PENDING' ||
    run?.status === 'reviewing'
  ) {
    return 'reviewing';
  }

  if (status === 'blocked' || lc === 'BLOCKED') {
    return 'blocked';
  }

  if (status === 'in_progress' || lc === 'IN_PROGRESS') {
    return 'executing';
  }

  if (run?.status === 'waiting_resource') {
    return 'waiting_resource';
  }

  if (run?.status === 'waiting_approval' || (task as any).waitingApproval) {
    return 'waiting_approval';
  }

  return 'pending';
}
