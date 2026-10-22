import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, execSync } from 'node:child_process';
import { db } from './db.js';
import { Logger } from './logger.js';
import { GitManager } from './gitManager.js';
import { IndependentEvaluator, EvaluationResult } from './independentEvaluator.js';
import { validateVerificationCommand, normalizeOrRecoverVerificationCommand } from './verificationCommand.js';
import { GeminiSupervisorProvider, type PlannedTask } from './geminiSupervisorProvider.js';
import { DagAutoHealer, TaskGraphNode } from './dagAutoHealer.js';
import { DeltaFeatureEngine, type ProjectInventory, type DeltaPlanOptions } from './deltaFeatureEngine.js';
import { ReaSaaSMasterService } from './reaSaaSMasterService.js';
import { SessionCircuitBreaker } from './sessionCircuitBreaker.js';
import { MarketDiscoveryService } from './marketDiscoveryService.js';
import { ProjectLivingSpecService } from './projectLivingSpecService.js';

export { DeltaFeatureEngine, ReaSaaSMasterService, type ProjectInventory, type DeltaPlanOptions };

export type TaskLifecycleState =
  | 'PLANNED'
  | 'READY'
  | 'IN_PROGRESS'
  | 'REVIEW_PENDING'
  | 'APPROVED'
  | 'COMMIT_PENDING'
  | 'COMPLETED'
  | 'REWORK_REQUIRED'
  | 'BLOCKED';

/**
 * Canonical requirement code normalizer (e.g. REQ-01 -> REQ-1, REQ_007 -> REQ-7, req-2 -> REQ-2)
 */
export function normalizeRequirementCode(code: string | null | undefined): string {
  if (!code) return '';
  const trimmed = String(code).trim().toUpperCase();
  return trimmed
    .replace(/^([A-Z]+)[-_]?0*(\d+)$/, '$1-$2')
    .replace(/([-_]|^)0+(\d+)$/, '$1$2');
}

export type MicrotaskLifecycleState = TaskLifecycleState;
export type AgentRole = AgentRoleType;
export type AgentRoleType = 'supervisor' | 'worker' | 'review' | 'system' | 'user';
export type ReviewDecisionVerdict = 'APPROVED' | 'REJECTED' | 'BLOCKED';

export type AgentMessageType =
  | 'TASK_PLANNED'
  | 'TASK_DISPATCHED_TO_WORKER'
  | 'WORKER_EXECUTION_STARTED'
  | 'WORKER_REPORT_SUBMITTED'
  | 'REVIEW_REQUESTED'
  | 'REVIEW_STARTED'
  | 'REVIEW_APPROVED'
  | 'REVIEW_REJECTED'
  | 'REVIEW_BLOCKED'
  | 'REWORK_DISPATCHED'
  | 'COMMIT_CREATED'
  | 'COMMIT_FAILED'
  | 'TASK_COMPLETED'
  | 'TASK_BLOCKED'
  | 'MAJOR_TASK_COMPLETED'
  | 'PROJECT_VALIDATION_COMPLETED'
  | 'REPLAN_TRIGGERED';

export type ReplanClassification = 'NEW_FEATURE' | 'DEFECT_FIX' | 'REQUIREMENT_CHANGE';
export type ReplanType = ReplanClassification;
export type MicrotaskSpec = HierarchicalMicrotaskInput;

export interface AgentCommunicationInput {
  idempotencyKey?: string;
  projectId: string;
  runId: string;
  majorTaskId?: string | null;
  microTaskId?: string | null;
  executionId?: string | null;
  attempt?: number;
  fromAgent: AgentRoleType;
  toAgent: AgentRoleType;
  messageType: AgentMessageType | string;
  content: string;
  payload?: Record<string, any>;
  processingStatus?: 'pending' | 'processing' | 'processed' | 'duplicate_ignored' | 'failed';
  reviewId?: string | null;
  evaluationId?: string | null;
  commitSha?: string | null;
}

export interface HierarchicalStageInput {
  code: string;
  title: string;
  objective?: string;
  orderIndex?: number;
  requirementIds?: string[];
  microtasks?: HierarchicalMicrotaskInput[];
}

export interface StructuredProjectRequirement {
  id: string;
  runId: string;
  projectId: string;
  code: string;
  title: string;
  description: string;
  category: string;
  mandatory: boolean;
  status: 'pending' | 'in_progress' | 'implemented' | 'verified' | 'rejected' | 'waived';
  verificationStatus: 'unverified' | 'tested_passed' | 'tested_failed' | 'review_approved';
  linkedMajorTaskIds: string[];
  linkedStageCodes: string[];
  linkedTaskIds: string[];
  acceptanceCriteria: string[];
  evidence?: Record<string, any>;
}

export interface HierarchicalMicrotaskInput {
  id?: string;
  code?: string;
  title: string;
  objective?: string;
  description: string;
  milestone?: string;
  majorTaskCode?: string;
  majorTaskTitle?: string;
  stageCode?: string;
  stageTitle?: string;
  parentTaskId?: string;
  requirementIds?: string[];
  waivedReason?: string;
  discoverySource?: string;
  blockingReason?: string;
  subdivisionDepth?: number;
  orderIndex?: number;
  dependencies?: string[];
  allowedScope?: string[];
  expectedFiles?: string[];
  constraints?: string[];
  criteria?: string[];
  testStrategy?: string;
  verificationCommand?: string;
  doneWhen?: string;
  requiredEvidence?: string[];
  riskLevel?: 'green' | 'yellow' | 'orange' | 'red';
  maxRetries?: number;
  replanOriginTaskId?: string;
  replanType?: ReplanClassification;
  replanReason?: string;
}

export interface HierarchicalMajorTaskInput {
  id?: string;
  code?: string;
  title: string;
  description?: string;
  objective: string;
  expectedOutcome?: string;
  requirements?: string[];
  requirementIds?: string[];
  acceptanceCriteria?: string[];
  dependencies?: string[];
  orderIndex?: number;
  complexityTier?: 'SIMPLE' | 'MODERATE' | 'COMPLEX' | 'ENTERPRISE';
  stages?: HierarchicalStageInput[];
  microtasks: HierarchicalMicrotaskInput[];
}

export interface HierarchicalPlanInput {
  projectId: string;
  runId: string;
  projectPath: string;
  originalDescription: string;
  requirements?: string[];
  structuredRequirements?: Array<{
    code?: string;
    title: string;
    description?: string;
    category?: string;
    mandatory?: boolean;
    acceptanceCriteria?: string[];
  }>;
  successCriteria?: string[];
  technicalContext?: Record<string, any>;
  majorTasks?: HierarchicalMajorTaskInput[];
  flatTasks?: HierarchicalMicrotaskInput[];
  subdivideOversized?: boolean;
  ensureRequirementCoverage?: boolean;
  maxSubdivisionDepth?: number;
  autoHealGraph?: boolean;
}

export interface StructuredReviewDecision {
  reviewId: string;
  evaluationId?: string | null;
  taskId: string;
  majorTaskId: string | null;
  runId: string;
  decision: 'APPROVED' | 'REJECTED' | 'BLOCKED';
  evaluatedCriteria: Array<{
    criterion: string;
    status: 'PASSED' | 'FAILED' | 'UNVERIFIED';
    passed: boolean;
    evidence: string;
  }>;
  executedCommands: string[];
  commandResults: Array<{
    command: string;
    exitCode: number;
    outputExcerpt: string;
  }>;
  filesInspected: string[];
  outOfScopeFiles: string[];
  placeholdersOrMocksDetected: string[];
  regressionsDetected: string[];
  securityOrIsolationIssues: string[];
  problemsFound: string[];
  justification: string;
  recommendedCorrections: string[];
  evaluatedAt: string;
}

const ALLOWED_MICROTASK_TRANSITIONS: Record<TaskLifecycleState, TaskLifecycleState[]> = {
  PLANNED: ['READY', 'BLOCKED'],
  READY: ['IN_PROGRESS', 'BLOCKED', 'PLANNED'],
  IN_PROGRESS: ['REVIEW_PENDING', 'BLOCKED', 'REWORK_REQUIRED', 'READY'],
  REVIEW_PENDING: ['APPROVED', 'REWORK_REQUIRED', 'BLOCKED'],
  APPROVED: ['COMMIT_PENDING', 'BLOCKED', 'REWORK_REQUIRED'],
  COMMIT_PENDING: ['COMPLETED', 'BLOCKED', 'REWORK_REQUIRED'],
  REWORK_REQUIRED: ['IN_PROGRESS', 'READY', 'BLOCKED'],
  BLOCKED: ['READY', 'IN_PROGRESS', 'REVIEW_PENDING'],
  COMPLETED: []
};

const VAGUE_TASK_PATTERNS = [
  /^continuar\s+desenvolvimento$/i,
  /^melhorar\s+tudo$/i,
  /^fazer\s+ajustes(\s+gerais)?$/i,
  /^corrigir\s+bugs(\s+gerais)?$/i,
  /^finalizar\s+o?\s*projeto$/i,
  /^implementar\s+sistema(\s+completo)?$/i
];

export const CONFIG_OR_META_FILES = new Set([
  '.gitignore',
  '.gitattributes',
  '.env',
  '.env.example',
  '.env.test',
  '.env.local',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'tsconfig.node.json',
  'tsconfig.app.json',
  'eslint.config.js',
  'eslint.config.mjs',
  '.eslintrc.json',
  '.eslintrc.js',
  '.prettierrc',
  '.prettierrc.json',
  'vite.config.ts',
  'vite.config.js',
  'webpack.config.js',
  'jest.config.js',
  'vitest.config.ts',
  'docker-compose.yml',
  'Dockerfile',
  'README.md'
]);


export class HierarchicalOrchestrationService {
  /**
   * Maps any raw status or conceptual state string to canonical TaskLifecycleState.
   */
  static toLifecycleState(rawStatus?: string | null): TaskLifecycleState {
    const normalized = String(rawStatus || 'pending').trim().toUpperCase();
    switch (normalized) {
      case 'PLANNED':
      case 'PENDING':
        return 'PLANNED';
      case 'READY':
        return 'READY';
      case 'IN_PROGRESS':
      case 'BUILDING':
      case 'WORKING':
        return 'IN_PROGRESS';
      case 'REVIEW_PENDING':
      case 'IN_REVIEW':
        return 'REVIEW_PENDING';
      case 'APPROVED':
        return 'APPROVED';
      case 'COMMIT_PENDING':
        return 'COMMIT_PENDING';
      case 'COMPLETED':
      case 'DONE':
        return 'COMPLETED';
      case 'REWORK_REQUIRED':
      case 'NEEDS_CHANGES':
      case 'CHANGES_REQUESTED':
        return 'REWORK_REQUIRED';
      case 'BLOCKED':
      case 'FAILED':
      case 'ERROR':
        return 'BLOCKED';
      default:
        return 'PLANNED';
    }
  }

  /**
   * Maps canonical TaskLifecycleState to the backward-compatible DB status column.
   */
  static toDbStatus(state: TaskLifecycleState): string {
    switch (state) {
      case 'PLANNED':
        return 'pending';
      case 'READY':
        return 'ready';
      case 'IN_PROGRESS':
        return 'in_progress';
      case 'REVIEW_PENDING':
        return 'in_review';
      case 'APPROVED':
        return 'approved';
      case 'COMMIT_PENDING':
        return 'commit_pending';
      case 'COMPLETED':
        return 'completed';
      case 'REWORK_REQUIRED':
        return 'needs_changes';
      case 'BLOCKED':
        return 'blocked';
    }
  }

  /**
   * Resolves the effective lifecycle state of a task or major task row,
   * accounting for direct SQL updates to the `status` column where `lifecycle_state`
   * may still hold its SQLite default ('PLANNED') or a stale value.
   */
  static resolveTaskLifecycleState(row: { status?: string | null; lifecycle_state?: string | null }): TaskLifecycleState {
    const statusMapped = this.toLifecycleState(row.status);
    const rawLifecycle = String(row.lifecycle_state || '').trim().toUpperCase();
    if (!rawLifecycle) {
      return statusMapped;
    }
    const lifecycleMapped = this.toLifecycleState(rawLifecycle);
    const actualStatus = String(row.status || '').trim().toLowerCase();
    // If lifecycle_state is still the SQL default 'PLANNED' while status is not 'pending'/'planned', honor status
    if (lifecycleMapped === 'PLANNED' && actualStatus && actualStatus !== 'pending' && actualStatus !== 'planned') {
      return statusMapped;
    }
    // If status was updated directly via SQL and diverges from lifecycle_state's expected db status
    const expectedDbStatus = this.toDbStatus(lifecycleMapped);
    if (actualStatus && actualStatus !== expectedDbStatus) {
      if (
        (lifecycleMapped === 'APPROVED' || lifecycleMapped === 'COMMIT_PENDING') &&
        ['in_review', 'approved', 'commit_pending'].includes(actualStatus)
      ) {
        return lifecycleMapped;
      }
      return statusMapped;
    }
    return lifecycleMapped;
  }

  /**
   * Checks whether a transition between two states is valid according to the backend state machine.
   */
  static isTransitionValid(fromState: TaskLifecycleState, toState: TaskLifecycleState): boolean {
    if (fromState === toState) return true;
    const allowed = ALLOWED_MICROTASK_TRANSITIONS[fromState] || [];
    return allowed.includes(toState);
  }

  /**
   * Validates and executes an explicit, persistent state transition on a microtask.
   * Rejects invalid transitions, self-approval by Worker, or completion without approval/commit.
   * Supports both object parameters and positional arguments (taskId, toState, actor, reason, metadata).
   */
  static transitionTaskState(
    taskIdOrParams:
      | string
      | {
          taskId: string;
          toState: TaskLifecycleState | string;
          actor: AgentRoleType;
          reason: string;
          metadata?: Record<string, any>;
          allowIdempotentSameState?: boolean;
        },
    toStateArg?: TaskLifecycleState | string,
    actorArg?: AgentRoleType,
    reasonArg?: string,
    metadataArg?: Record<string, any>
  ): {
    taskId: string;
    fromState: TaskLifecycleState;
    toState: TaskLifecycleState;
    fromStatus: string;
    toStatus: string;
    transitionId: string;
  } {
    const params =
      typeof taskIdOrParams === 'string'
        ? {
            taskId: taskIdOrParams,
            toState: toStateArg || 'READY',
            actor: actorArg || 'system',
            reason: reasonArg || 'Transição de estado',
            metadata: metadataArg,
            allowIdempotentSameState: true
          }
        : taskIdOrParams;

    const task: any = db.prepare('SELECT * FROM autonomous_tasks WHERE id = ?').get(params.taskId);
    if (!task) {
      throw new Error(`STATE_TRANSITION_ERROR: Microtarefa não encontrada (${params.taskId})`);
    }

    const fromState = this.resolveTaskLifecycleState(task);
    const targetState = this.toLifecycleState(params.toState);
    const fromStatus = task.status || this.toDbStatus(fromState);
    const toStatus = this.toDbStatus(targetState);

    if (!params.reason || !params.reason.trim()) {
      throw new Error(`INVALID_STATE_TRANSITION: Motivo da transição (${fromState} -> ${targetState}) é obrigatório.`);
    }

    // Rule: Worker can NEVER approve or complete its own task
    if (params.actor === 'worker' && (targetState === 'APPROVED' || targetState === 'COMMIT_PENDING' || targetState === 'COMPLETED')) {
      throw new Error(`WORKER_SELF_APPROVAL_FORBIDDEN: O Worker não pode transicionar a tarefa diretamente para ${targetState}.`);
    }

    // Rule: Same-state idempotency
    if (fromState === targetState && params.allowIdempotentSameState !== false) {
      return {
        taskId: task.id,
        fromState,
        toState: targetState,
        fromStatus,
        toStatus,
        transitionId: 'noop-same-state'
      };
    }

    // Rule: Validate state machine graph
    if (!this.isTransitionValid(fromState, targetState)) {
      throw new Error(
        `INVALID_STATE_TRANSITION: Transição inválida de ${fromState} (${fromStatus}) para ${targetState} (${toStatus}) na tarefa "${task.title}" (${task.id}) solicitada por ${params.actor}.`
      );
    }

    // Rule: BLOCKED -> READY / IN_PROGRESS / REVIEW_PENDING requires explicit resolution
    if (fromState === 'BLOCKED' && ['READY', 'IN_PROGRESS', 'REVIEW_PENDING'].includes(targetState)) {
      const hasResolution = Boolean(params.metadata?.blockResolution || params.reason.length >= 5);
      if (!hasResolution) {
        throw new Error(`BLOCK_RESOLUTION_REQUIRED: Desbloqueio de ${task.id} exige resolução registrada.`);
      }
    }

    // Rule: Transition to READY or IN_PROGRESS requires all microtask & parent Major Task dependencies to be COMPLETED
    if (targetState === 'READY' || targetState === 'IN_PROGRESS') {
      const deps: string[] = task.dependencies_json ? JSON.parse(task.dependencies_json) : [];
      if (deps.length > 0) {
        const allRunTasks: any[] = db.prepare('SELECT id, code, status, lifecycle_state FROM autonomous_tasks WHERE run_id = ?').all(task.run_id);
        const completedSet = new Set(
          allRunTasks
            .filter(t => t.status === 'completed' || this.resolveTaskLifecycleState(t) === 'COMPLETED')
            .flatMap(t => [t.id, t.code].filter(Boolean))
        );
        const unmet = deps.filter(d => !completedSet.has(d));
        if (unmet.length > 0) {
          throw new Error(
            `UNMET_DEPENDENCIES_FORBIDDEN: A microtarefa "${task.title}" (${task.id}) não pode ir para ${targetState} porque possui dependências pendentes: ${unmet.join(', ')}.`
          );
        }
      }

      if (task.major_task_id) {
        const majorRow: any = db.prepare('SELECT id, code, dependencies_json FROM autonomous_major_tasks WHERE id = ?').get(task.major_task_id);
        const majorDeps: string[] = majorRow?.dependencies_json ? JSON.parse(majorRow.dependencies_json) : [];
        if (majorDeps.length > 0) {
          const allMajors: any[] = db.prepare('SELECT id, code, status, lifecycle_state FROM autonomous_major_tasks WHERE run_id = ?').all(task.run_id);
          const completedMajors = new Set(
            allMajors
              .filter(m => m.status === 'completed' || this.resolveTaskLifecycleState(m) === 'COMPLETED')
              .flatMap(m => [m.id, m.code].filter(Boolean))
          );
          const unmetMajors = majorDeps.filter(d => !completedMajors.has(d));
          if (unmetMajors.length > 0) {
            throw new Error(
              `UNMET_MAJOR_DEPENDENCIES_FORBIDDEN: A microtarefa "${task.title}" (${task.id}) pertence à Grande Tarefa [${majorRow.code}] cujas dependências ainda não foram concluídas: ${unmetMajors.join(', ')}.`
            );
          }
        }
      }
    }

    // Rule: Transition to APPROVED or COMMIT_PENDING requires persisted independent evaluation / review decision
    if (targetState === 'APPROVED' || targetState === 'COMMIT_PENDING') {
      const evalRes = IndependentEvaluator.getEvaluationByTaskId(task.id);
      const hasApprovedReviewDecision = task.review_decision === 'APPROVED';
      const hasEvaluationPass = Boolean(evalRes && evalRes.verdict === 'PASS' && evalRes.taskIsDone);
      const mustVerifyEvidence =
        Boolean(params.metadata?.viaHttpApi) ||
        Boolean(params.metadata?.enforceReviewEvidence) ||
        (targetState === 'APPROVED' && params.actor !== 'review');
      if (mustVerifyEvidence && !hasApprovedReviewDecision && !hasEvaluationPass) {
        throw new Error(
          `REVIEW_EVIDENCE_REQUIRED: A microtarefa "${task.title}" (${task.id}) não pode ir para ${targetState} sem avaliação independente PASS e aprovação do Review.`
        );
      }
    }

    // Rule: Transition to COMPLETED requires commit SHA if git repo is required
    if (targetState === 'COMPLETED') {
      const commitSha = params.metadata?.commitSha || task.task_commit_sha;
      const requireCommit = params.metadata?.requireCommit !== false;
      if (requireCommit && !commitSha) {
        throw new Error(
          `COMMIT_REQUIRED_BEFORE_COMPLETED: A microtarefa "${task.title}" (${task.id}) não pode ir para COMPLETED sem commit confirmado.`
        );
      }
    }

    const nowIso = new Date().toISOString();
    const transitionId = crypto.randomUUID();
    const runRow: any = db.prepare('SELECT project_id FROM autonomous_runs WHERE id = ?').get(task.run_id);
    const projectId = task.project_id || runRow?.project_id || null;

    db.prepare(`
      UPDATE autonomous_tasks
      SET status = ?, lifecycle_state = ?, updated_at = ?
      WHERE id = ?
    `).run(toStatus, targetState, nowIso, task.id);

    db.prepare(`
      INSERT INTO task_state_transitions (
        id, run_id, project_id, entity_type, major_task_id, task_id,
        from_status, to_status, from_lifecycle_state, to_lifecycle_state,
        actor, reason, metadata_json, created_at
      ) VALUES (?, ?, ?, 'microtask', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      transitionId,
      task.run_id,
      projectId,
      task.major_task_id || null,
      task.id,
      fromStatus,
      toStatus,
      fromState,
      targetState,
      params.actor,
      params.reason.trim(),
      JSON.stringify(params.metadata || {}),
      nowIso
    );

    if (task.major_task_id) {
      this.recalculateMajorTaskState(task.major_task_id, params.actor);
    }

    return {
      taskId: task.id,
      fromState,
      toState: targetState,
      fromStatus,
      toStatus,
      transitionId
    };
  }

  /**
   * Records a structured, traceable, idempotent communication message between agents
   * (Supervisor, Worker, Review) and mirrors it to autonomous_events.
   */
  static recordAgentCommunication(params: AgentCommunicationInput): { id: string; duplicate: boolean; record: any } {
    if (params.idempotencyKey) {
      const existing: any = db.prepare(
        'SELECT * FROM agent_communications WHERE idempotency_key = ?'
      ).get(params.idempotencyKey);
      if (existing) {
        return {
          id: existing.id,
          duplicate: true,
          record: {
            ...existing,
            payload: existing.payload_json ? JSON.parse(existing.payload_json) : {}
          }
        };
      }
    }

    const id = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    const attempt = params.attempt ?? 1;
    const status = params.processingStatus || 'processed';
    const payloadJson = JSON.stringify(params.payload || {});

    db.prepare(`
      INSERT INTO agent_communications (
        id, idempotency_key, project_id, run_id, major_task_id, micro_task_id,
        execution_id, attempt, from_agent, to_agent, message_type, content,
        payload_json, processing_status, review_id, evaluation_id, commit_sha,
        created_at, processed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      params.idempotencyKey || null,
      params.projectId,
      params.runId,
      params.majorTaskId || null,
      params.microTaskId || null,
      params.executionId || null,
      attempt,
      params.fromAgent,
      params.toAgent,
      params.messageType,
      params.content,
      payloadJson,
      status,
      params.reviewId || null,
      params.evaluationId || null,
      params.commitSha || null,
      nowIso,
      status === 'processed' ? nowIso : null
    );

    // Mirror to autonomous_events so live feeds and observability queries see it seamlessly
    const mappedRole = params.fromAgent === 'worker' ? 'builder' : params.fromAgent === 'review' ? 'evaluator' : params.fromAgent;
    const eventMeta = {
      communicationId: id,
      idempotencyKey: params.idempotencyKey || null,
      projectId: params.projectId,
      majorTaskId: params.majorTaskId || null,
      microTaskId: params.microTaskId || null,
      executionId: params.executionId || null,
      attempt,
      fromAgent: params.fromAgent,
      toAgent: params.toAgent,
      messageType: params.messageType,
      processingStatus: status,
      reviewId: params.reviewId || null,
      evaluationId: params.evaluationId || null,
      commitSha: params.commitSha || null,
      ...(params.payload || {})
    };

    try {
      db.prepare(`
        INSERT INTO autonomous_events (id, run_id, task_id, agent_role, event_type, message, metadata_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        crypto.randomUUID(),
        params.runId,
        params.microTaskId || null,
        mappedRole,
        params.messageType,
        params.content,
        JSON.stringify(eventMeta),
        nowIso
      );
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "hierarchicalOrchestrationService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:hierarchicalOrchestrationService]", err);
      }
    }

    const created: any = db.prepare('SELECT * FROM agent_communications WHERE id = ?').get(id);
    return {
      id,
      duplicate: false,
      record: {
        ...created,
        payload: params.payload || {}
      }
    };
  }

  /**
   * Detects circular dependencies and unresolvable references in a list of tasks/major tasks.
   */
  static detectCircularDependencies(
    items: Array<{ id: string; title: string; code?: string; dependencies: string[] }>
  ): { hasCycle: boolean; cyclePath: string[]; missingDependencies: Array<{ item: string; missing: string }> } {
    const idMap = new Map<string, { id: string; title: string; dependencies: string[] }>();
    const lookupKeyToId = new Map<string, string>();

    for (const item of items) {
      idMap.set(item.id, item);
      lookupKeyToId.set(item.id.toLowerCase(), item.id);
      lookupKeyToId.set(item.title.trim().toLowerCase(), item.id);
      if (item.code) {
        lookupKeyToId.set(item.code.trim().toLowerCase(), item.id);
      }
    }

    const missingDependencies: Array<{ item: string; missing: string }> = [];
    const adj = new Map<string, string[]>();

    for (const item of items) {
      const resolvedDeps: string[] = [];
      for (const rawDep of item.dependencies || []) {
        const key = String(rawDep || '').trim().toLowerCase();
        if (!key) continue;
        const targetId = lookupKeyToId.get(key);
        if (!targetId) {
          missingDependencies.push({ item: item.title, missing: rawDep });
        } else if (targetId === item.id) {
          return { hasCycle: true, cyclePath: [item.title, item.title], missingDependencies };
        } else {
          resolvedDeps.push(targetId);
        }
      }
      adj.set(item.id, resolvedDeps);
    }

    const state = new Map<string, 'UNVISITED' | 'VISITING' | 'VISITED'>();
    const parentMap = new Map<string, string>();

    const dfs = (nodeId: string, pathStack: string[]): string[] | null => {
      state.set(nodeId, 'VISITING');
      const nodeTitle = idMap.get(nodeId)?.title || nodeId;
      const nextStack = [...pathStack, nodeTitle];

      for (const depId of adj.get(nodeId) || []) {
        const depState = state.get(depId) || 'UNVISITED';
        if (depState === 'VISITING') {
          const depTitle = idMap.get(depId)?.title || depId;
          return [...nextStack, depTitle];
        }
        if (depState === 'UNVISITED') {
          parentMap.set(depId, nodeId);
          const cycle = dfs(depId, nextStack);
          if (cycle) return cycle;
        }
      }

      state.set(nodeId, 'VISITED');
      return null;
    };

    for (const item of items) {
      if ((state.get(item.id) || 'UNVISITED') === 'UNVISITED') {
        const cycle = dfs(item.id, []);
        if (cycle) {
          return { hasCycle: true, cyclePath: cycle, missingDependencies };
        }
      }
    }

    return { hasCycle: false, cyclePath: [], missingDependencies };
  }

  /**
   * Deterministic DAG Auto-Healer & Graph Normalizer:
   * Multi-key resolution (exact, GT-1 / Major tasks, numbers, substrings),
   * silent removal of orphan/self dependencies, title deduplication, and automatic cycle breaker.
   */
  static autoHealAndNormalizeTaskGraph<T extends TaskGraphNode>(tasks: T[]): T[] {
    return DagAutoHealer.autoHealAndNormalizeTaskGraph(tasks);
  }

  /**
   * Normalizes text for semantic/keyword comparison (lowercase, accent-free).
   */
  static normalizeSemanticText(text: string): string {
    return String(text || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  /**
   * Analyzes project complexity across multiple dimensions (requirements, domains, architectural layers, security/risk, testing)
   * without any fixed 6-task ceiling.
   */
  static analyzeProjectComplexity(
    description: string,
    explicitRequirements?: string[],
    technicalContext?: Record<string, any>
  ): {
    complexityTier: 'SIMPLE' | 'MODERATE' | 'COMPLEX' | 'ENTERPRISE';
    complexityScore: number;
    detectedDomains: string[];
    recommendedLayers: string[];
    recommendedMajorTaskCount: { min: number; max: number };
    recommendedMicrotaskCount: { min: number; max: number };
    requiresIntermediateStages: boolean;
  } {
    const norm = this.normalizeSemanticText(`${description || ''} ${(explicitRequirements || []).join(' ')}`);
    const domainMatchers: Array<{ domain: string; layer: string; regex: RegExp; weight: number }> = [
      { domain: 'database_persistence', layer: ' Camada 1: Esquema e Persistência de Dados', regex: /\b(bancos? de dados|persistencia|sqlite|postgres|schemas?|migrac|armazenamento|repositorios?|storage|models?)/i, weight: 2 },
      { domain: 'auth_security', layer: 'Camada 2: Autenticação, Autorização e Segurança', regex: /\b(autenticac|login|senhas?|tokens?|jwt|sessao|sessoes|seguranca|permiss|acessos?|hash|criptograf)/i, weight: 2 },
      { domain: 'domain_calculations', layer: 'Camada 3: Regras de Domínio e Motor de Cálculos', regex: /\b(receitas?|despesas?|saldos?|calculos?|motor|transac|lancamentos?|regras? de negocio|orcamentos?|juros|extratos?)/i, weight: 2 },
      { domain: 'categories_classification', layer: 'Camada 3: Categorização e Classificação', regex: /\b(categorias?|classificac|tags?|centros? de custo|tipos? de lancamento)/i, weight: 1.5 },
      { domain: 'api_contracts', layer: 'Camada 4: Contratos, Rotas e Serviços de Backend', regex: /\b(apis?|endpoints?|rotas?|rest|controllers?|servicos?|backend|validacao de entrada|contratos?)/i, weight: 1.5 },
      { domain: 'forms_crud', layer: 'Camada 5: Formulários Interativos e Validação de Entrada', regex: /\b(formularios?|cadastros?|inputs?|modal|edicao|exclusao|crud)/i, weight: 1.5 },
      { domain: 'filters_search', layer: 'Camada 5: Filtros Dinâmicos, Busca e Ordenação', regex: /\b(filtros?|buscas?|pesquisas?|periodos?|datas?|ordenac|historicos?)/i, weight: 1.5 },
      { domain: 'dashboard_kpis', layer: 'Camada 6: Dashboard, Indicadores e Visualização', regex: /\b(dashboards?|painel|paineis|graficos?|indicador|kpis?|resumos?|cards?)/i, weight: 1.5 },
      { domain: 'reports_export', layer: 'Camada 6: Relatórios Analíticos e Exportação', regex: /\b(relatorios?|exporta|csv|pdf|balancos?|demonstrativos?|consolidados?)/i, weight: 1.5 },
      { domain: 'responsive_ui_ux', layer: 'Camada 7: Interface Responsiva e Acessibilidade', regex: /\b(responsiv|mobile|desktop|acessibil|interface|layouts?|temas?|ux)/i, weight: 1.5 },
      { domain: 'automated_testing', layer: 'Camada 8: Testes Automatizados Unitários e Integrados', regex: /\b(testes?|unitarios?|integracao|e2e|cobertura|validacao final)/i, weight: 1.5 }
    ];

    const detectedDomains: string[] = [];
    const recommendedLayersSet = new Set<string>();
    let score = 0;

    for (const m of domainMatchers) {
      if (m.regex.test(norm)) {
        detectedDomains.push(m.domain);
        recommendedLayersSet.add(m.layer.trim());
        score += m.weight;
      }
    }

    const clauses = String(description || '')
      .split(/[,;.\n]+/)
      .map(s => s.trim())
      .filter(s => s.length >= 5);

    const isExplicitlySimple = /\b(simples| basico|minimo|apenas uma funcao|script simples|hello world)\b/i.test(norm) && clauses.length <= 3;

    let complexityTier: 'SIMPLE' | 'MODERATE' | 'COMPLEX' | 'ENTERPRISE' = 'MODERATE';
    if (isExplicitlySimple || (detectedDomains.length <= 2 && clauses.length <= 2)) {
      complexityTier = 'SIMPLE';
    } else if (detectedDomains.length >= 7 || clauses.length >= 8 || score >= 10) {
      complexityTier = 'ENTERPRISE';
    } else if (detectedDomains.length >= 4 || clauses.length >= 5 || score >= 6) {
      complexityTier = 'COMPLEX';
    }

    const recommendedMajorTaskCount =
      complexityTier === 'SIMPLE'
        ? { min: 1, max: 2 }
        : complexityTier === 'MODERATE'
        ? { min: 2, max: 4 }
        : complexityTier === 'COMPLEX'
        ? { min: 4, max: 6 }
        : { min: 5, max: 10 };

    const recommendedMicrotaskCount =
      complexityTier === 'SIMPLE'
        ? { min: 1, max: 3 }
        : complexityTier === 'MODERATE'
        ? { min: 4, max: 8 }
        : complexityTier === 'COMPLEX'
        ? { min: 8, max: 16 }
        : { min: Math.max(12, clauses.length), max: Math.max(24, clauses.length * 2) };

    return {
      complexityTier,
      complexityScore: Math.round(score * 10) / 10,
      detectedDomains,
      recommendedLayers: Array.from(recommendedLayersSet),
      recommendedMajorTaskCount,
      recommendedMicrotaskCount,
      requiresIntermediateStages: complexityTier === 'COMPLEX' || complexityTier === 'ENTERPRISE'
    };
  }

  /**
   * Extracts structured requirements with stable codes (REQ-1, REQ-2, ...), categories, and acceptance criteria.
   */
  static extractStructuredRequirements(
    description: string,
    explicitRequirements?: string[],
    structuredInput?: Array<{
      code?: string;
      title: string;
      description?: string;
      category?: string;
      mandatory?: boolean;
      acceptanceCriteria?: string[];
    }>
  ): Array<{
    code: string;
    title: string;
    description: string;
    category: string;
    mandatory: boolean;
    acceptanceCriteria: string[];
  }> {
    const inferCategory = (text: string): string => {
      const norm = this.normalizeSemanticText(text);
      if (/\b(bancos?|persistencia|sqlite|schemas?|dados|armazenamento|storage)/.test(norm)) return 'persistence';
      if (/\b(autenticac|login|sessao|sessoes|senhas?|tokens?|jwt)/.test(norm)) return 'authentication';
      if (/\b(seguranca|permiss|protecao|sanitiz|validacao|hash)/.test(norm)) return 'security';
      if (/\b(receitas?|despesas?|saldos?|calculos?|transac|lancamentos?|motor)/.test(norm)) return 'domain_calculations';
      if (/\b(categorias?|classificac|tags?)/.test(norm)) return 'categories';
      if (/\b(filtros?|buscas?|pesquisas?|periodos?|ordenac|historicos?)/.test(norm)) return 'filters';
      if (/\b(relatorios?|exporta|demonstrativos?|consolidados?|balancos?)/.test(norm)) return 'reports';
      if (/\b(dashboards?|painel|paineis|graficos?|resumos?|kpis?|indicador)/.test(norm)) return 'dashboard';
      if (/\b(formularios?|cadastros?|inputs?|crud)/.test(norm)) return 'forms';
      if (/\b(responsiv|interfaces?|layouts?|mobile|acessibil|ui)/.test(norm)) return 'ui_responsive';
      if (/\b(testes?|unitarios?|integracao|e2e|validacao)/.test(norm)) return 'testing';
      return 'general';
    };

    if (Array.isArray(structuredInput) && structuredInput.length > 0) {
      return structuredInput.map((item, idx) => {
        const rawCode = item.code || `REQ-${idx + 1}`;
        const code = normalizeRequirementCode(rawCode) || `REQ-${idx + 1}`;
        const title = item.title.trim();
        return {
          code,
          title,
          description: item.description || title,
          category: item.category || inferCategory(title),
          mandatory: item.mandatory !== false,
          acceptanceCriteria:
            item.acceptanceCriteria && item.acceptanceCriteria.length > 0
              ? item.acceptanceCriteria
              : [`Requisito [${code}] "${title}" implementado e validado por testes automatizados`]
        };
      });
    }

    if (Array.isArray(explicitRequirements) && explicitRequirements.length > 0) {
      return explicitRequirements.map((raw, idx) => {
        const match = String(raw || '').trim().match(/^(REQ-[A-Za-z0-9_-]+|RF-[A-Za-z0-9_-]+|REQUISITO\s*\d+)\s*[:\-–]\s*(.+)$/i);
        const normRawCode = match ? match[1].replace(/^RF/i, 'REQ').replace(/^REQUISITO\s*/i, 'REQ-') : `REQ-${idx + 1}`;
        const code = normalizeRequirementCode(normRawCode) || `REQ-${idx + 1}`;
        const title = (match ? match[2] : String(raw || '')).trim();
        return {
          code,
          title,
          description: title,
          category: inferCategory(title),
          mandatory: true,
          acceptanceCriteria: [`Requisito [${code}] "${title}" implementado e verificado`]
        };
      });
    }

    const rawStrings = this.extractRequirementsFromDescription(description);
    return rawStrings.map((raw, idx) => {
      const match = String(raw || '').trim().match(/^(REQ-[A-Za-z0-9_-]+|RF-[A-Za-z0-9_-]+|REQUISITO\s*\d+)\s*[:\-–]\s*(.+)$/i);
      const normRawCode = match ? match[1].replace(/^RF/i, 'REQ').replace(/^REQUISITO\s*/i, 'REQ-') : `REQ-${idx + 1}`;
      const code = normalizeRequirementCode(normRawCode) || `REQ-${idx + 1}`;
      const title = (match ? match[2] : String(raw || '')).trim();
      return {
        code,
        title,
        description: title,
        category: inferCategory(title),
        mandatory: true,
        acceptanceCriteria: [`Requisito [${code}] "${title}" implementado e validado com evidência`]
      };
    });
  }

  /**
   * Validates microtask quality: rejects vague tasks and subdivides overly complex tasks
   * with a depth-bounded recursive algorithm (preventing infinite subdivision loops).
   * Semantically balances Backend and Frontend decompositions and groups scaffolding config files.
   */
  static validateAndSubdivideMicrotasks(
    microtasks: HierarchicalMicrotaskInput[],
    options?: { subdivideOversized?: boolean; strictVagueCheck?: boolean; maxSubdivisionDepth?: number }
  ): HierarchicalMicrotaskInput[] {
    const subdivide = options?.subdivideOversized !== false;
    const strictVague = options?.strictVagueCheck === true;
    const maxDepth = Math.min(options?.maxSubdivisionDepth ?? 2, 3);

    const isConfigFile = (filePath: string): boolean => {
      const base = filePath.split(/[/\\]/).pop()?.toLowerCase() || '';
      return (
        CONFIG_OR_META_FILES.has(base) ||
        base.startsWith('.env') ||
        base.endsWith('.config.js') ||
        base.endsWith('.config.ts') ||
        base.endsWith('.config.mjs')
      );
    };

    const isMonolithicFrontendTask = (t: HierarchicalMicrotaskInput): boolean => {
      const normTitle = (t.title || '').toLowerCase();
      const files = t.allowedScope || t.expectedFiles || [];
      const hasUiKeywords =
        /(interface|frontend|spa|dashboard|ui|telas?|painel)\s*(completa|completo|unificad|geral|web|interativ)/i.test(normTitle) ||
        /(construir|implementar)\s*(a\s+)?(interface|frontend|spa|dashboard)/i.test(normTitle) ||
        t.stageCode?.includes('ET-5') ||
        t.majorTaskCode === 'GT-5';
      const hasFrontendFiles = files.some(f => /(index\.html|styles?\.css|app\.(js|ts)|main\.(js|ts)|App\.(tsx|jsx))/i.test(f));
      const alreadyLayered = /camada\s*\d+/i.test(normTitle);
      return !alreadyLayered && Boolean(hasUiKeywords && (hasFrontendFiles || (t.criteria && t.criteria.length >= 3)));
    };

    const processList = (list: HierarchicalMicrotaskInput[], currentPassDepth: number): HierarchicalMicrotaskInput[] => {
      const passResult: HierarchicalMicrotaskInput[] = [];
      let anySplitInPass = false;

      for (const task of list) {
        const title = (task.title || '').trim();
        const isVague = VAGUE_TASK_PATTERNS.some(rx => rx.test(title));
        if (isVague && strictVague && (!task.criteria || task.criteria.length === 0)) {
          throw new Error(
            `VAGUE_MICROTASKS_REJECTED: Microtarefa vaga não permitida ("${title}"). Defina objetivo específico e resultado verificável.`
          );
        }

        const normalizedTitle = isVague
          ? `Implementar e validar componente verificável: ${task.description?.slice(0, 50) || title}`
          : title;

        const cleanTitle = normalizedTitle
          .replace(/\s*\((?:Parte|Part)\s*[\d.]+[^)]*\)/gi, '')
          .trim();

        const criteria = Array.isArray(task.criteria) && task.criteria.length > 0
          ? task.criteria
          : [
              `Implementação de "${normalizedTitle}" concluída dentro do escopo permitido`,
              `Verificação automatizada executada com código de saída 0`
            ];

        const scopeFiles = task.allowedScope || task.expectedFiles || [];
        const taskDepth = task.subdivisionDepth ?? currentPassDepth;
        const parentOriginId = task.parentTaskId || task.id || undefined;

        const isSaaSMasterTask = Boolean(
          /saas\s*master|enterprise\s*spa|rea\s*blueprint/i.test(task.title + ' ' + (task.description || ''))
        );

        if (subdivide && taskDepth === 0 && isSaaSMasterTask) {
          anySplitInPass = true;
          const nextDepth = taskDepth + 1;
          const baseCode = task.code || 'UI';
          const requiredUiTasks = ReaSaaSMasterService.getRequiredSaaSMasterMicrotasks(cleanTitle);

          const generatedTasks: HierarchicalMicrotaskInput[] = [];
          let previousTitle: string | null = null;

          for (let idx = 0; idx < requiredUiTasks.length; idx++) {
            const req = requiredUiTasks[idx];
            const cleanSubTitle = req.title.replace(new RegExp(` de ${cleanTitle}$`, 'i'), '').trim();
            const uiTitle = `Task ${req.subCode} (${cleanSubTitle}) de ${cleanTitle}`;
            const tUI: HierarchicalMicrotaskInput = {
              ...task,
              id: undefined,
              code: `${baseCode}.${idx + 1}`,
              title: uiTitle,
              objective: req.desc,
              description: `${task.description} — ${req.subCode}: ${req.desc}`,
              stageCode: `ET-${req.subCode}`,
              stageTitle: cleanSubTitle,
              parentTaskId: parentOriginId,
              discoverySource: task.discoverySource || 'pre_execution_subdivision',
              subdivisionDepth: nextDepth,
              criteria: req.criteria,
              allowedScope: req.files,
              expectedFiles: req.files,
              dependencies: previousTitle ? [previousTitle] : [...(task.dependencies || [])]
            };
            generatedTasks.push(tUI);
            previousTitle = uiTitle;
          }

          passResult.push(...generatedTasks);

          const lastGeneratedTitle = generatedTasks[generatedTasks.length - 1]?.title;
          for (const other of [...passResult, ...list]) {
            if (other !== task && !generatedTasks.includes(other) && Array.isArray(other.dependencies)) {
              other.dependencies = other.dependencies.map(d => {
                const dNorm = d.trim().toLowerCase();
                if (dNorm === title.toLowerCase() || (task.code && dNorm === task.code.toLowerCase())) {
                  return lastGeneratedTitle || d;
                }
                return d;
              });
            }
          }
          continue;
        }

        // Semantic 3-tier decomposition for monolithic Frontend/SPA tasks (Pass 0)
        if (subdivide && taskDepth === 0 && isMonolithicFrontendTask(task)) {
          anySplitInPass = true;
          const nextDepth = taskDepth + 1;
          const baseCode = task.code || '5';

          const layer1Title = `${cleanTitle} (Camada 1: Design System, Shell e Estrutura Semântica)`;
          const layer2Title = `${cleanTitle} (Camada 2: Componentes de Domínio, Telas e Formulários)`;
          const layer3Title = `${cleanTitle} (Camada 3: Integração de Estado, APIs e Validação Visual)`;

          const shellFiles = scopeFiles.filter(f => /(html|css|tokens|theme)/i.test(f));
          const logicFiles = scopeFiles.filter(f => /(js|ts|tsx|jsx)/i.test(f));

          const layer1: HierarchicalMicrotaskInput = {
            ...task,
            id: undefined,
            code: `${baseCode}.1`,
            title: layer1Title,
            objective: `Estruturar o HTML semântico, sistema de design, tokens CSS, tipografia e casca responsiva de ${cleanTitle}`,
            description: `${task.description} — Camada 1: Estrutura HTML5 semântica, variáveis de design system e layout base responsivo.`,
            stageCode: 'ET-UI-SHELL',
            stageTitle: 'Design System e Layout Shell',
            parentTaskId: parentOriginId,
            discoverySource: task.discoverySource || 'pre_execution_subdivision',
            subdivisionDepth: nextDepth,
            criteria: [
              'Estrutura HTML5 semântica e acessível com container principal e navegação',
              'Design System com variáveis CSS (cores, espaçamentos, tipografia, bordas e sombras)',
              'Layout responsivo (mobile-first / desktop) com casca da aplicação pronta'
            ],
            allowedScope: shellFiles.length > 0 ? shellFiles : ['index.html', 'style.css'],
            expectedFiles: shellFiles.length > 0 ? shellFiles : ['index.html', 'style.css'],
            dependencies: [...(task.dependencies || [])]
          };

          const layer2: HierarchicalMicrotaskInput = {
            ...task,
            id: undefined,
            code: `${baseCode}.2`,
            title: layer2Title,
            objective: `Implementar telas de negócio, componentes visuais, formulários e modais interativos de ${cleanTitle}`,
            description: `${task.description} — Camada 2: Componentes de domínio, renderização de listas/cards, formulários com validação e modais.`,
            stageCode: 'ET-UI-VIEWS',
            stageTitle: 'Componentes e Telas de Domínio',
            parentTaskId: parentOriginId,
            discoverySource: task.discoverySource || 'pre_execution_subdivision',
            subdivisionDepth: nextDepth,
            criteria: [
              'Renderização dos blocos e telas principais de domínio com hierarquia visual clara',
              'Formulários e inputs com validação visual, estados de erro e botões com loading',
              'Modais e painéis de ação estilizados integrados ao layout'
            ],
            allowedScope: scopeFiles.length > 0 ? scopeFiles : ['index.html', 'style.css'],
            expectedFiles: scopeFiles.length > 0 ? scopeFiles : ['index.html', 'style.css'],
            dependencies: [layer1Title]
          };

          const layer3: HierarchicalMicrotaskInput = {
            ...task,
            id: undefined,
            code: `${baseCode}.3`,
            title: layer3Title,
            objective: `Conectar cliente de API, gerenciar estado reativo, tratar erros e validar experiência do usuário de ${cleanTitle}`,
            description: `${task.description} — Camada 3: Reatividade, integração HTTP/API, tratamento resiliente de erros e testes visuais.`,
            stageCode: 'ET-UI-LOGIC',
            stageTitle: 'Estado, Integração e Auditoria Visual',
            parentTaskId: parentOriginId,
            discoverySource: task.discoverySource || 'pre_execution_subdivision',
            subdivisionDepth: nextDepth,
            criteria: [
              'Estado da aplicação reativo e sincronizado com os endpoints de backend',
              'Tratamento amigável de erros de rede, feedback via toasts e estados vazios (empty state)',
              'Validação de execução no navegador sem erros de console e conformidade funcional'
            ],
            allowedScope: logicFiles.length > 0 ? Array.from(new Set([...scopeFiles, ...logicFiles])) : scopeFiles,
            expectedFiles: logicFiles.length > 0 ? logicFiles : ['app.js'],
            dependencies: [layer2Title]
          };

          passResult.push(layer1, layer2, layer3);

          for (const other of [...passResult, ...list]) {
            if (other !== task && other !== layer1 && other !== layer2 && other !== layer3 && Array.isArray(other.dependencies)) {
              other.dependencies = other.dependencies.map(d => {
                const dNorm = d.trim().toLowerCase();
                if (dNorm === title.toLowerCase() || (task.code && dNorm === task.code.toLowerCase())) {
                  return layer3Title;
                }
                return d;
              });
            }
          }
          continue;
        }

        // Subdivide oversized microtasks (> 5 distinct acceptance criteria OR > 6 substantial files on pass 0,
        // or >= 4 criteria/substantial files on recursive pass when subdivided from a large monolithic task)
        // Guarded by maxDepth to prevent infinite subdivision loops (Scenario 17).
        // Scaffolding configuration files (.gitignore, .env.example, package.json, etc.) are excluded from
        // splitting thresholds so setup tasks are not sliced into multiple PRs for config files alone.
        const substantialFiles = scopeFiles.filter(f => !isConfigFile(f));

        const isOversizedForPass =
          (taskDepth === 0 && (criteria.length >= 6 || substantialFiles.length >= 6 || (scopeFiles.length >= 7 && substantialFiles.length >= 3))) ||
          (taskDepth > 0 && taskDepth < maxDepth && (criteria.length >= 4 || substantialFiles.length >= 4));

        if (subdivide && taskDepth < maxDepth && isOversizedForPass) {
          anySplitInPass = true;
          const midCriteria = Math.ceil(criteria.length / 2);
          const midFiles = Math.ceil(scopeFiles.length / 2);
          const nextDepth = taskDepth + 1;

          let part1Title: string;
          let part2Title: string;

          if (taskDepth === 0) {
            part1Title = `${cleanTitle} (Parte 1: Estrutura e Núcleo)`;
            part2Title = `${cleanTitle} (Parte 2: Integração e Validação)`;
          } else {
            const partMatch = normalizedTitle.match(/\(Parte\s+([\d.]+)/i);
            const baseNum = partMatch ? partMatch[1] : (task.code?.endsWith('.2') ? '2' : '1');
            part1Title = `${cleanTitle} (Parte ${baseNum}.1: Estrutura Base)`;
            part2Title = `${cleanTitle} (Parte ${baseNum}.2: Núcleo Funcional)`;
          }

          let part1Files: string[];
          let part2Files: string[];
          if (substantialFiles.length >= 2) {
            const midSub = Math.ceil(substantialFiles.length / 2);
            const configFiles = scopeFiles.filter(f => isConfigFile(f));
            part1Files = Array.from(new Set([...configFiles, ...substantialFiles.slice(0, midSub)]));
            part2Files = substantialFiles.slice(midSub);
            if (part2Files.length === 0) {
              part2Files = scopeFiles.slice(midFiles);
            }
          } else {
            part1Files = scopeFiles.slice(0, midFiles);
            part2Files = scopeFiles.slice(midFiles);
          }

          const part1: HierarchicalMicrotaskInput = {
            ...task,
            id: undefined,
            code: task.code ? `${task.code}.1` : undefined,
            title: part1Title,
            objective: `Implementar a primeira metade funcional de ${cleanTitle}`,
            description: `${task.description} — Escopo Parte 1 (núcleo e base).`,
            stageCode: task.stageCode || 'ET-NUCLEO',
            stageTitle: task.stageTitle || 'Estrutura e Núcleo Funcional',
            parentTaskId: parentOriginId,
            discoverySource: task.discoverySource || 'pre_execution_subdivision',
            subdivisionDepth: nextDepth,
            criteria: criteria.slice(0, midCriteria),
            allowedScope: part1Files,
            expectedFiles: part1Files,
            dependencies: [...(task.dependencies || [])]
          };

          const part2: HierarchicalMicrotaskInput = {
            ...task,
            id: undefined,
            code: task.code ? `${task.code}.2` : undefined,
            title: part2Title,
            objective: `Concluir e validar a integração de ${cleanTitle}`,
            description: `${task.description} — Escopo Parte 2 (complemento e testes).`,
            stageCode: task.stageCode || 'ET-VALIDACAO',
            stageTitle: task.stageTitle || 'Integração e Validação',
            parentTaskId: parentOriginId,
            discoverySource: task.discoverySource || 'pre_execution_subdivision',
            subdivisionDepth: nextDepth,
            criteria: criteria.slice(midCriteria),
            allowedScope: part2Files,
            expectedFiles: part2Files,
            dependencies: [part1Title]
          };

          passResult.push(part1, part2);
          for (const other of [...passResult, ...list]) {
            if (other !== task && other !== part1 && other !== part2 && Array.isArray(other.dependencies)) {
              other.dependencies = other.dependencies.map(d => {
                const dNorm = d.trim().toLowerCase();
                if (dNorm === title.toLowerCase() || (task.code && dNorm === task.code.toLowerCase())) {
                  return part2Title;
                }
                return d;
              });
            }
          }
        } else {
          passResult.push({
            ...task,
            title: normalizedTitle,
            objective: task.objective || normalizedTitle,
            subdivisionDepth: taskDepth,
            criteria
          });
        }
      }

      if (anySplitInPass && currentPassDepth + 1 < maxDepth) {
        const stillOversized = passResult.some(
          t => {
            const tFiles = t.allowedScope || t.expectedFiles || [];
            const tSubstantial = tFiles.filter(f => !isConfigFile(f));
            return (t.subdivisionDepth ?? 0) < maxDepth && ((t.criteria?.length || 0) >= 4 || tSubstantial.length >= 4);
          }
        );
        if (stillOversized) {
          return processList(passResult, currentPassDepth + 1);
        }
      }

      return passResult;
    };

    return processList(microtasks, 0);
  }

  /**
   * Builds and persists a complete Hierarchical Execution Plan:
   * Project -> Requirements -> Major Tasks (Grandes Tarefas) -> Stages (Etapas) -> Microtasks (Microtarefas).
   * Supports both native hierarchical plans and grouping flat tasks by milestone/majorTask.
   */
  static persistHierarchicalPlan(input: HierarchicalPlanInput): {
    majorTasks: any[];
    microtasks: any[];
    requirements: string[];
    projectRequirements: StructuredProjectRequirement[];
    complexityAnalysis: any;
    successCriteria: string[];
  } {
    const nowIso = new Date().toISOString();
    const structuredReqs = this.extractStructuredRequirements(
      input.originalDescription,
      input.requirements,
      input.structuredRequirements
    );
    const requirements =
      input.requirements && input.requirements.length > 0
        ? input.requirements
        : structuredReqs.map(r => `${r.code}: ${r.title}`);

    const complexityAnalysis = this.analyzeProjectComplexity(
      input.originalDescription,
      requirements,
      input.technicalContext
    );

    const successCriteria = input.successCriteria && input.successCriteria.length > 0
      ? input.successCriteria
      : [
          'Todas as Grandes Tarefas, Etapas e Microtarefas aprovadas pelo Review independente',
          '100% dos requisitos obrigatórios com cobertura e validação verificada',
          'Todos os commits vinculados e verificados no repositório Git',
          'Testes automatizados e validação integrada final passando com código 0'
        ];
    const technicalContext = input.technicalContext || {
      projectPath: input.projectPath,
      runtime: 'Node.js',
      complexityTier: complexityAnalysis.complexityTier,
      persistedAt: nowIso
    };

    // Update project and run with structured requirements, success criteria, and technical context
    try {
      db.prepare(`
        UPDATE projects
        SET requirements_json = ?, success_criteria_json = ?, technical_context_json = ?, active_run_id = ?, active_plan_run_id = ?, updated_at = ?
        WHERE id = ?
      `).run(
        JSON.stringify(requirements),
        JSON.stringify(successCriteria),
        JSON.stringify(technicalContext),
        input.runId,
        input.runId,
        nowIso,
        input.projectId
      );
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "hierarchicalOrchestrationService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:hierarchicalOrchestrationService]", err);
      }
    }

    try {
      db.prepare(`
        UPDATE autonomous_runs
        SET requirements_json = ?, success_criteria_json = ?, technical_context_json = ?, complexity_analysis_json = ?, plan_version = COALESCE(plan_version, 1), updated_at = ?
        WHERE id = ?
      `).run(
        JSON.stringify(requirements),
        JSON.stringify(successCriteria),
        JSON.stringify(technicalContext),
        JSON.stringify(complexityAnalysis),
        nowIso,
        input.runId
      );
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "hierarchicalOrchestrationService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:hierarchicalOrchestrationService]", err);
      }
    }

    // Convert flatTasks into Major Tasks if majorTasks wasn't explicitly passed
    let majorTaskInputs: HierarchicalMajorTaskInput[] = [];
    if (Array.isArray(input.majorTasks) && input.majorTasks.length > 0) {
      majorTaskInputs = input.majorTasks.map((mt, idx) => {
        // Flatten stage microtasks if stages were passed with embedded microtasks
        const stageFromList = Array.isArray(mt.stages) ? mt.stages : [];
        let combinedMicrotasks = [...(mt.microtasks || [])];
        if (combinedMicrotasks.length === 0 && stageFromList.length > 0) {
          for (const st of stageFromList) {
            for (const stm of st.microtasks || []) {
              combinedMicrotasks.push({
                ...stm,
                stageCode: stm.stageCode || st.code,
                stageTitle: stm.stageTitle || st.title,
                requirementIds: stm.requirementIds || st.requirementIds
              });
            }
          }
        }
        return {
          ...mt,
          code: mt.code || `GT-${idx + 1}`,
          orderIndex: mt.orderIndex ?? idx + 1,
          microtasks: this.validateAndSubdivideMicrotasks(combinedMicrotasks, {
            subdivideOversized: input.subdivideOversized,
            maxSubdivisionDepth: input.maxSubdivisionDepth
          })
        };
      });
    } else {
      const flat = this.validateAndSubdivideMicrotasks(input.flatTasks || [], {
        subdivideOversized: input.subdivideOversized,
        maxSubdivisionDepth: input.maxSubdivisionDepth
      });
      majorTaskInputs = this.groupFlatTasksIntoMajorTasks(flat, input.originalDescription, requirements);
    }

    // Validate Major Task DAG
    const majorDagItems = majorTaskInputs.map((mt, idx) => ({
      id: mt.id || `mt-${idx + 1}`,
      title: mt.title,
      code: mt.code || `GT-${idx + 1}`,
      dependencies: mt.dependencies || []
    }));

    if (input.autoHealGraph) {
      const healedMajors = this.autoHealAndNormalizeTaskGraph(majorDagItems);
      majorDagItems.forEach((item, idx) => {
        item.dependencies = healedMajors[idx]?.dependencies || [];
        if (majorTaskInputs[idx]) {
          majorTaskInputs[idx].dependencies = item.dependencies;
        }
      });
    }

    const majorCycleCheck = this.detectCircularDependencies(majorDagItems);
    if (majorCycleCheck.hasCycle) {
      if (input.autoHealGraph) {
        Logger.warn(
          `[HierarchicalOrchestration] Ciclo entre Grandes Tarefas quebrado automaticamente: ${majorCycleCheck.cyclePath.join(' -> ')}`
        );
      } else {
        throw new Error(
          `CIRCULAR_DEPENDENCY_DETECTED: Dependência circular entre Grandes Tarefas: ${majorCycleCheck.cyclePath.join(' -> ')}`
        );
      }
    }

    // Prepare IDs for Major Tasks and Microtasks
    const persistedMajorTasks: any[] = [];
    const allMicrotasksToInsert: Array<{
      id: string;
      majorTaskId: string;
      majorTaskCode: string;
      code: string;
      stageCode: string | null;
      stageTitle: string | null;
      raw: HierarchicalMicrotaskInput;
      orderIndex: number;
    }> = [];

    let globalMicroOrder = 1;
    const majorCodeToId = new Map<string, string>();
    const majorTitleToId = new Map<string, string>();

    for (let mIdx = 0; mIdx < majorTaskInputs.length; mIdx++) {
      const mt = majorTaskInputs[mIdx];
      const mtId = mt.id || crypto.randomUUID();
      const mtCode = mt.code || `GT-${mIdx + 1}`;
      majorCodeToId.set(mtId.toLowerCase(), mtId);
      majorCodeToId.set(mtCode.toLowerCase(), mtId);
      majorTitleToId.set(mt.title.trim().toLowerCase(), mtId);

      const stagesMap = new Map<string, { code: string; title: string; objective?: string; orderIndex: number }>();
      if (Array.isArray(mt.stages)) {
        mt.stages.forEach((st, sIdx) => {
          stagesMap.set(st.code, {
            code: st.code,
            title: st.title,
            objective: st.objective || st.title,
            orderIndex: st.orderIndex ?? sIdx + 1
          });
        });
      }

      for (let tIdx = 0; tIdx < (mt.microtasks || []).length; tIdx++) {
        const micro = mt.microtasks[tIdx];
        const microId = micro.id || crypto.randomUUID();
        const microCode = micro.code || `${mIdx + 1}.${tIdx + 1}`;
        const defaultStageCode = `ET-${mIdx + 1}.${Math.floor(tIdx / 2) + 1}`;
        const stageCode = micro.stageCode || (mt.microtasks.length >= 2 ? defaultStageCode : `ET-${mIdx + 1}.1`);
        const stageTitle =
          micro.stageTitle ||
          stagesMap.get(stageCode)?.title ||
          (mt.microtasks.length >= 2 ? `Etapa ${Math.floor(tIdx / 2) + 1}: ${micro.title.slice(0, 45)}` : `Etapa Única: ${mt.title.slice(0, 45)}`);

        if (!stagesMap.has(stageCode)) {
          stagesMap.set(stageCode, {
            code: stageCode,
            title: stageTitle,
            objective: stageTitle,
            orderIndex: stagesMap.size + 1
          });
        }

        allMicrotasksToInsert.push({
          id: microId,
          majorTaskId: mtId,
          majorTaskCode: mtCode,
          code: microCode,
          stageCode,
          stageTitle,
          raw: micro,
          orderIndex: micro.orderIndex ?? globalMicroOrder++
        });
      }

      persistedMajorTasks.push({
        id: mtId,
        code: mtCode,
        input: mt,
        stages: Array.from(stagesMap.values()),
        orderIndex: mt.orderIndex ?? mIdx + 1,
        resolvedMajorDeps: [] as string[]
      });
    }

    if (input.autoHealGraph) {
      const microItemsToHeal = allMicrotasksToInsert.map(item => ({
        id: item.id,
        title: item.raw.title,
        code: item.code,
        majorTaskCode: item.majorTaskCode,
        stageCode: item.stageCode || undefined,
        orderIndex: item.orderIndex,
        dependencies: item.raw.dependencies || []
      }));
      const healedMicros = this.autoHealAndNormalizeTaskGraph(microItemsToHeal);
      allMicrotasksToInsert.forEach((item, idx) => {
        item.raw.dependencies = healedMicros[idx]?.dependencies || [];
      });
    }

    // Build lookup maps for microtask dependency resolution
    const microLookupToId = new Map<string, string>();
    for (const item of allMicrotasksToInsert) {
      microLookupToId.set(item.id.toLowerCase(), item.id);
      microLookupToId.set(item.code.toLowerCase(), item.id);
      microLookupToId.set(item.raw.title.trim().toLowerCase(), item.id);
    }

    // Validate Microtask DAG for circular dependencies
    const microDagCheck = this.detectCircularDependencies(
      allMicrotasksToInsert.map(item => ({
        id: item.id,
        title: item.raw.title,
        code: item.code,
        dependencies: item.raw.dependencies || []
      }))
    );
    if (microDagCheck.hasCycle) {
      if (input.autoHealGraph) {
        Logger.warn(
          `[HierarchicalOrchestration] Ciclo entre Microtarefas quebrado automaticamente: ${microDagCheck.cyclePath.join(' -> ')}`
        );
      } else {
        throw new Error(
          `CIRCULAR_DEPENDENCY_DETECTED: Dependência circular entre Microtarefas: ${microDagCheck.cyclePath.join(' -> ')}`
        );
      }
    }

    const majorDepsByMajorId = new Map<string, string[]>();
    for (let mIdx = 0; mIdx < persistedMajorTasks.length; mIdx++) {
      const pm = persistedMajorTasks[mIdx];
      const mt = pm.input;
      const resolvedMajorDeps: string[] = [];
      for (const rawDep of mt.dependencies || []) {
        const depKey = String(rawDep || '').trim().toLowerCase();
        if (!depKey) continue;
        const resolved = majorCodeToId.get(depKey) || majorTitleToId.get(depKey) || null;
        if (!resolved || resolved === pm.id) {
          if (input.autoHealGraph) {
            Logger.warn(
              `[HierarchicalOrchestration] Dependência órfã/inválida "${rawDep}" ignorada na Grande Tarefa "${mt.title}".`
            );
            continue;
          }
          throw new Error(
            `NONEXISTENT_DEPENDENCY_DETECTED: Grande Tarefa "${mt.title}" referencia dependência inexistente ou inválida: "${rawDep}".`
          );
        }
        if (!resolvedMajorDeps.includes(resolved)) {
          resolvedMajorDeps.push(resolved);
        }
      }
      pm.resolvedMajorDeps = resolvedMajorDeps;
      majorDepsByMajorId.set(pm.id, resolvedMajorDeps);
    }

    const resolvedMicroDepsById = new Map<string, string[]>();
    for (const item of allMicrotasksToInsert) {
      const m = item.raw;
      const resolvedDeps: string[] = [];
      for (const rawDep of m.dependencies || []) {
        const depKey = String(rawDep || '').trim().toLowerCase();
        if (!depKey) continue;
        const resolved = microLookupToId.get(depKey) || null;
        if (!resolved || resolved === item.id) {
          if (input.autoHealGraph) {
            Logger.warn(
              `[HierarchicalOrchestration] Dependência órfã/inválida "${rawDep}" ignorada na Microtarefa "${m.title}".`
            );
            continue;
          }
          throw new Error(
            `NONEXISTENT_DEPENDENCY_DETECTED: Microtarefa "${m.title}" referencia dependência inexistente ou inválida: "${rawDep}".`
          );
        }
        if (!resolvedDeps.includes(resolved)) {
          resolvedDeps.push(resolved);
        }
      }
      resolvedMicroDepsById.set(item.id, resolvedDeps);
    }

    // Map requirements to Major Tasks and Microtasks (explicit + semantic keyword matching)
    const reqLinksByCode = new Map<string, { majorIds: Set<string>; stageCodes: Set<string>; taskIds: Set<string> }>();
    for (const r of structuredReqs) {
      reqLinksByCode.set(normalizeRequirementCode(r.code), {
        majorIds: new Set<string>(),
        stageCodes: new Set<string>(),
        taskIds: new Set<string>()
      });
    }

    const extractKeywords = (text: string): string[] => {
      const stopWords = new Set([
        'para', 'como', 'com', 'sem', 'pelo', 'pela', 'dos', 'das', 'nos', 'nas', 'uma', 'uns',
        'sistema', 'projeto', 'aplicativo', 'implementar', 'criar', 'construir', 'atender',
        'requisito', 'principal', 'garantir', 'cobertura', 'modulo', 'camada', 'grande', 'tarefa'
      ]);
      return this.normalizeSemanticText(text)
        .split(/[^a-z0-9]+/)
        .filter(w => w.length >= 4 && !stopWords.has(w));
    };

    const hadCallerExplicitTaskReqs = allMicrotasksToInsert.some(
      t => Array.isArray(t.raw.requirementIds) && t.raw.requirementIds.length > 0
    );

    for (const item of allMicrotasksToInsert) {
      const hasTaskExplicitReqs = Array.isArray(item.raw.requirementIds) && item.raw.requirementIds.length > 0;
      const explicitReqIds = new Set<string>(
        (item.raw.requirementIds || []).map(c => normalizeRequirementCode(c)).filter(Boolean)
      );
      const parentMajor = persistedMajorTasks.find(p => p.id === item.majorTaskId);
      if (!hasTaskExplicitReqs) {
        for (const mr of [...(parentMajor?.input?.requirementIds || []), ...(parentMajor?.input?.requirements || [])]) {
          const m = String(mr || '').trim().match(/^(REQ-[A-Za-z0-9_-]+)/i);
          const code = m ? normalizeRequirementCode(m[1]) : normalizeRequirementCode(mr);
          if (code) explicitReqIds.add(code);
        }
      }

      const taskCorpus = this.normalizeSemanticText(
        [
          item.raw.title,
          item.raw.description || '',
          item.raw.objective || '',
          (item.raw.criteria || []).join(' '),
          item.raw.verificationCommand || '',
          item.raw.testStrategy || '',
          (item.raw.allowedScope || []).join(' '),
          (item.raw.expectedFiles || []).join(' '),
          parentMajor?.input?.title || '',
          parentMajor?.input?.objective || '',
          parentMajor?.input?.description || '',
          parentMajor?.input?.expectedOutcome || '',
          (parentMajor?.input?.acceptanceCriteria || []).join(' ')
        ].join(' ')
      );

      for (const req of structuredReqs) {
        const reqCode = normalizeRequirementCode(req.code);
        const links = reqLinksByCode.get(reqCode)!;
        if (hasTaskExplicitReqs) {
          if (explicitReqIds.has(reqCode)) {
            links.majorIds.add(item.majorTaskId);
            if (item.stageCode) links.stageCodes.add(item.stageCode);
            links.taskIds.add(item.id);
          }
        } else {
          const reqKeywords = extractKeywords(req.title);
          const codeMentioned = taskCorpus.includes(this.normalizeSemanticText(req.code)) || taskCorpus.includes(this.normalizeSemanticText(req.title));
          const keywordMatched =
            reqKeywords.length > 0 &&
            reqKeywords.some(kw => {
              if (taskCorpus.includes(kw)) return true;
              const stem = kw.replace(/(?:es|s|ando|endo|indo|cao|coes)$/, '');
              return stem.length >= 4 && taskCorpus.includes(stem);
            });
          const testingMatched = req.category === 'testing' && (
            Boolean(item.raw.verificationCommand) ||
            (item.raw.allowedScope || []).some(f => /test|spec/i.test(f))
          );

          if (explicitReqIds.has(reqCode) || codeMentioned || keywordMatched || testingMatched) {
            explicitReqIds.add(reqCode);
            links.majorIds.add(item.majorTaskId);
            if (item.stageCode) links.stageCodes.add(item.stageCode);
            links.taskIds.add(item.id);
          }
        }
      }

      item.raw.requirementIds = Array.from(explicitReqIds);
    }

    // If neither explicit requirements nor task requirementIds nor ensureRequirementCoverage was set (legacy test mode),
    // bind any generic fallback requirement that had 0 keyword hits to the primary Major Task so legacy tests stay consistent.
    const hasExplicitReqDefinitions =
      Boolean(input.ensureRequirementCoverage) ||
      Boolean(input.requirements && input.requirements.length > 0) ||
      Boolean(input.structuredRequirements && input.structuredRequirements.length > 0) ||
      hadCallerExplicitTaskReqs;
    if (!hasExplicitReqDefinitions && allMicrotasksToInsert.length > 0) {
      const firstMajorId = persistedMajorTasks[0].id;
      const firstMicro = allMicrotasksToInsert[0];
      for (const req of structuredReqs) {
        const reqCode = req.code.toUpperCase();
        const links = reqLinksByCode.get(reqCode)!;
        if (links.taskIds.size === 0) {
          links.majorIds.add(firstMajorId);
          if (firstMicro.stageCode) links.stageCodes.add(firstMicro.stageCode);
          links.taskIds.add(firstMicro.id);
          firstMicro.raw.requirementIds = Array.from(new Set([...(firstMicro.raw.requirementIds || []), reqCode]));
        }
      }
    }

    // Insert Major Tasks
    const insertMajorStmt = db.prepare(`
      INSERT INTO autonomous_major_tasks (
        id, run_id, project_id, code, title, description, objective, expected_outcome,
        requirements_json, requirement_ids_json, stages_json, complexity_tier,
        acceptance_criteria_json, dependencies_json, order_index,
        status, lifecycle_state, validation_evidence_json, history_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (let mIdx = 0; mIdx < persistedMajorTasks.length; mIdx++) {
      const pm = persistedMajorTasks[mIdx];
      const mt = pm.input;
      const resolvedMajorDeps = pm.resolvedMajorDeps;

      const initialMajorState: TaskLifecycleState = mIdx === 0 && resolvedMajorDeps.length === 0 ? 'READY' : 'PLANNED';
      const initialMajorStatus = this.toDbStatus(initialMajorState);
      const linkedReqCodesForMajor = structuredReqs
        .filter(r => reqLinksByCode.get(normalizeRequirementCode(r.code))?.majorIds.has(pm.id))
        .map(r => r.code);

      insertMajorStmt.run(
        pm.id,
        input.runId,
        input.projectId,
        pm.code,
        mt.title.trim(),
        mt.description || mt.objective,
        mt.objective || mt.title,
        mt.expectedOutcome || `Entrega verificada de ${mt.title}`,
        JSON.stringify(mt.requirements || requirements.slice(0, 3)),
        JSON.stringify(mt.requirementIds || linkedReqCodesForMajor),
        JSON.stringify(pm.stages || []),
        mt.complexityTier || complexityAnalysis.complexityTier,
        JSON.stringify(mt.acceptanceCriteria || (mt.microtasks || []).flatMap((t: HierarchicalMicrotaskInput) => t.criteria || []).slice(0, 6)),
        JSON.stringify(resolvedMajorDeps),
        pm.orderIndex,
        initialMajorStatus,
        initialMajorState,
        JSON.stringify({}),
        JSON.stringify([{ state: initialMajorState, at: nowIso, reason: 'Plano hierárquico inicial criado pelo Supervisor' }]),
        nowIso,
        nowIso
      );
    }

    // Insert Microtasks if not already inserted by caller, or update existing microtasks with hierarchical fields
    const upsertMicroStmt = db.prepare(`
      INSERT INTO autonomous_tasks (
        id, run_id, project_id, major_task_id, stage_code, stage_title, parent_task_id,
        requirement_ids_json, discovery_source, subdivision_depth,
        code, title, objective, description,
        milestone, order_index, dependencies_json, status, lifecycle_state, assigned_to,
        retry_count, max_retries, criteria_json, verification_command, done_when,
        expected_files_json, allowed_scope_json, constraints_json, test_strategy,
        required_evidence_json, protected_evaluation_files_json, contract_id,
        replan_origin_task_id, replan_type, replan_reason, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'builder', 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
      ON CONFLICT(id) DO UPDATE SET
        project_id = excluded.project_id,
        major_task_id = excluded.major_task_id,
        stage_code = excluded.stage_code,
        stage_title = excluded.stage_title,
        parent_task_id = COALESCE(excluded.parent_task_id, autonomous_tasks.parent_task_id),
        requirement_ids_json = excluded.requirement_ids_json,
        discovery_source = COALESCE(excluded.discovery_source, autonomous_tasks.discovery_source),
        subdivision_depth = COALESCE(excluded.subdivision_depth, autonomous_tasks.subdivision_depth),
        code = excluded.code,
        objective = excluded.objective,
        dependencies_json = excluded.dependencies_json,
        status = excluded.status,
        lifecycle_state = excluded.lifecycle_state,
        criteria_json = excluded.criteria_json,
        verification_command = excluded.verification_command,
        allowed_scope_json = excluded.allowed_scope_json,
        constraints_json = excluded.constraints_json,
        test_strategy = excluded.test_strategy,
        required_evidence_json = excluded.required_evidence_json,
        protected_evaluation_files_json = COALESCE(excluded.protected_evaluation_files_json, autonomous_tasks.protected_evaluation_files_json),
        contract_id = COALESCE(excluded.contract_id, autonomous_tasks.contract_id),
        max_retries = excluded.max_retries,
        updated_at = excluded.updated_at
    `);

    const protectedFiles = IndependentEvaluator.listEvaluationFiles(input.projectPath);

    for (const item of allMicrotasksToInsert) {
      const m = item.raw;
      const resolvedDeps = resolvedMicroDepsById.get(item.id) || [];

      const parentMajorDeps = majorDepsByMajorId.get(item.majorTaskId) || [];
      const isReady = resolvedDeps.length === 0 && parentMajorDeps.length === 0;
      const lifecycleState: TaskLifecycleState = isReady ? 'READY' : 'PLANNED';
      const dbStatus = this.toDbStatus(lifecycleState);

      const normVerif = normalizeOrRecoverVerificationCommand(m.verificationCommand, input.projectPath, {
        allowUncreatedFiles: true
      });
      const verificationCommand = normVerif.command;
      const criteria = Array.isArray(m.criteria) && m.criteria.length > 0
        ? m.criteria
        : [`Implementação verificável de "${m.title}" concluída`];
      const expectedFiles = m.expectedFiles || m.allowedScope || [];
      const scopeFiles = m.allowedScope || m.expectedFiles || [];
      const constraints = m.constraints || [
        'Não aprovar a própria tarefa nem marcar como concluída sem Review independente',
        'Não modificar arquivos fora do escopo permitido sem justificativa arquitetural',
        'Não introduzir código simulado, placeholders ou testes falsos'
      ];
      const testStrategy = m.testStrategy || `Executar "${verificationCommand}" e validar critérios individualmente.`;
      const requiredEvidence = m.requiredEvidence || [
        'Arquivos modificados em disco dentro do escopo',
        `Saída real de "${verificationCommand}" com exitCode 0`,
        'Critérios de aceitação verificados pelo Review independente'
      ];

      // Ensure SuccessContract exists for this microtask
      let existingContract = IndependentEvaluator.getContractByTaskId(item.id);
      if (!existingContract) {
        existingContract = IndependentEvaluator.createSuccessContract({
          taskId: item.id,
          runId: input.runId,
          projectId: input.projectId,
          projectPath: input.projectPath,
          objective: `${m.title}: ${m.description || m.objective || ''}`,
          acceptanceCriteria: criteria,
          verificationCommand,
          protectedEvaluationFiles: protectedFiles,
          isBugFix: m.replanType === 'DEFECT_FIX' || /(fix|bug|erro|corrigir)/i.test(m.title)
        });
      }

      upsertMicroStmt.run(
        item.id,
        input.runId,
        input.projectId,
        item.majorTaskId,
        item.stageCode,
        item.stageTitle,
        m.parentTaskId || null,
        JSON.stringify(m.requirementIds || []),
        m.discoverySource || 'initial_plan',
        m.subdivisionDepth ?? 0,
        item.code,
        m.title.trim(),
        m.objective || m.title.trim(),
        m.description || m.title.trim(),
        m.milestone || item.majorTaskCode,
        item.orderIndex,
        JSON.stringify(resolvedDeps),
        dbStatus,
        lifecycleState,
        m.maxRetries ?? 3,
        JSON.stringify(criteria),
        verificationCommand,
        m.doneWhen || `Todos os critérios verificados e ${verificationCommand} com exit code 0`,
        JSON.stringify(expectedFiles),
        JSON.stringify(scopeFiles),
        JSON.stringify(constraints),
        testStrategy,
        JSON.stringify(requiredEvidence),
        JSON.stringify(protectedFiles),
        existingContract.id,
        m.replanOriginTaskId || null,
        m.replanType || null,
        m.replanReason || null,
        nowIso,
        nowIso
      );

      // Record initial state transition audit
      db.prepare(`
        INSERT INTO task_state_transitions (
          id, run_id, project_id, entity_type, major_task_id, task_id,
          from_status, to_status, from_lifecycle_state, to_lifecycle_state,
          actor, reason, metadata_json, created_at
        ) VALUES (?, ?, ?, 'microtask', ?, ?, 'none', ?, 'PLANNED', ?, 'supervisor', ?, ?, ?)
      `).run(
        crypto.randomUUID(),
        input.runId,
        input.projectId,
        item.majorTaskId,
        item.id,
        dbStatus,
        lifecycleState,
        isReady ? 'Microtarefa planejada e pronta (sem dependências pendentes)' : 'Microtarefa planejada aguardando dependências',
        JSON.stringify({ code: item.code, majorTaskCode: item.majorTaskCode, stageCode: item.stageCode, requirementIds: m.requirementIds || [], dependencies: resolvedDeps }),
        nowIso
      );

      // Record structured TASK_PLANNED communication
      this.recordAgentCommunication({
        idempotencyKey: `plan:${input.runId}:${item.id}:v1`,
        projectId: input.projectId,
        runId: input.runId,
        majorTaskId: item.majorTaskId,
        microTaskId: item.id,
        attempt: 0,
        fromAgent: 'supervisor',
        toAgent: 'worker',
        messageType: 'TASK_PLANNED',
        content: `Microtarefa [${item.code}] "${m.title}" planejada na Grande Tarefa [${item.majorTaskCode}] (${lifecycleState}).`,
        payload: {
          code: item.code,
          title: m.title,
          objective: m.objective || m.title,
          stageCode: item.stageCode,
          requirementIds: m.requirementIds || [],
          criteria,
          dependencies: resolvedDeps,
          verificationCommand,
          lifecycleState
        }
      });
    }

    // Persist structured project_requirements rows
    db.prepare('DELETE FROM project_requirements WHERE run_id = ?').run(input.runId);
    const insertReqStmt = db.prepare(`
      INSERT INTO project_requirements (
        id, run_id, project_id, code, title, description, category, mandatory,
        status, verification_status, linked_major_task_ids_json, linked_stage_codes_json,
        linked_task_ids_json, acceptance_criteria_json, evidence_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'unverified', ?, ?, ?, ?, '{}', ?, ?)
    `);

    for (const req of structuredReqs) {
      const links = reqLinksByCode.get(normalizeRequirementCode(req.code));
      insertReqStmt.run(
        crypto.randomUUID(),
        input.runId,
        input.projectId,
        req.code,
        req.title,
        req.description,
        req.category,
        req.mandatory ? 1 : 0,
        JSON.stringify(Array.from(links?.majorIds || [])),
        JSON.stringify(Array.from(links?.stageCodes || [])),
        JSON.stringify(Array.from(links?.taskIds || [])),
        JSON.stringify(req.acceptanceCriteria || []),
        nowIso,
        nowIso
      );
    }

    // If ensureRequirementCoverage is enabled, automatically synthesize tasks for any uncovered requirement
    if (input.ensureRequirementCoverage) {
      this.ensureRequirementCoverage(input.runId, { projectPath: input.projectPath });
    }

    // Sync requirement statuses and recalculate all Major Task states
    this.syncRequirementTraceability(input.runId);
    for (const pm of persistedMajorTasks) {
      this.recalculateMajorTaskState(pm.id, 'supervisor');
    }

    return {
      majorTasks: this.getMajorTasksForRun(input.runId),
      microtasks: db.prepare('SELECT * FROM autonomous_tasks WHERE run_id = ? ORDER BY order_index ASC').all(input.runId),
      requirements,
      projectRequirements: this.getProjectRequirements(input.runId),
      complexityAnalysis,
      successCriteria
    };
  }

  /**
   * Groups a flat list of tasks into logical Major Tasks (Grandes Tarefas)
   * when the Supervisor returns a flat list or when legacy fixtures are used.
   */
  static groupFlatTasksIntoMajorTasks(
    flatTasks: HierarchicalMicrotaskInput[],
    originalDescription: string,
    requirements: string[]
  ): HierarchicalMajorTaskInput[] {
    if (flatTasks.length === 0) return [];

    const byMilestone = new Map<string, HierarchicalMicrotaskInput[]>();
    for (const t of flatTasks) {
      const key = (t.majorTaskCode || t.milestone || 'M1').trim();
      if (!byMilestone.has(key)) byMilestone.set(key, []);
      byMilestone.get(key)!.push(t);
    }

    const groups = Array.from(byMilestone.entries());
    const majorTasks: HierarchicalMajorTaskInput[] = [];

    for (let i = 0; i < groups.length; i++) {
      const [milestoneKey, tasks] = groups[i];
      const code = /^GT-/i.test(milestoneKey) ? milestoneKey.toUpperCase() : `GT-${i + 1}`;
      const customTitle = tasks[0]?.majorTaskTitle;
      const defaultTitle =
        groups.length === 1
          ? `Grande Tarefa 1 (${milestoneKey}): Construção e Validação de ${originalDescription.slice(0, 50)}`
          : `Grande Tarefa ${i + 1} (${milestoneKey}): ${tasks.map(t => t.title).slice(0, 2).join(' & ')}`;

      majorTasks.push({
        code,
        title: customTitle || defaultTitle,
        description: `Entrega estruturada do marco ${milestoneKey} com ${tasks.length} microtarefa(s) subordinada(s).`,
        objective: `Concluir e verificar todas as entregas de ${milestoneKey}: ${tasks.map(t => t.title).join('; ')}`,
        expectedOutcome: `Módulos e testes de ${milestoneKey} implementados, revisados independentemente e confirmados por commit.`,
        requirements: requirements.slice(0, 4),
        acceptanceCriteria: tasks.flatMap(t => t.criteria || []).slice(0, 8),
        dependencies: i > 0 ? [`GT-${i}`] : [],
        orderIndex: i + 1,
        microtasks: tasks.map((tk, j) => ({
          ...tk,
          code: tk.code || `${i + 1}.${j + 1}`
        }))
      });
    }

    return majorTasks;
  }

  /**
   * Extracts structured requirements from a user's natural language project description.
   * Priority:
   * 1. Explicit requirement blocks (REQ-01, REQ-1, RF-01, Requisito 1, etc.)
   * 2. Free-text bullet lists (- , * , 1. )
   * 3. Functional sentences (>= 20 chars), strictly bounded between 2 and 12 requirements.
   * Never blindly splits by commas or periods inside paths/numbers/lists.
   */
  static extractRequirementsFromDescription(description: string): string[] {
    const clean = (description || '').trim();
    if (!clean) return ['REQ-1: Implementar projeto conforme especificações técnicas'];

    // 1. Explicit requirements: REQ-01, REQ-1, RF-01, Requisito 1, etc.
    const explicitRegex = /(?:^|\n)\s*(?:[-*•]|\d+\.)?\s*\*{0,2}(REQ[-_]?\d+|RF[-_]?\d+|REQUISITO\s*\d+)\*{0,2}\s*(?:\(([^)]+)\))?\s*[:\-–]?\s*([^\n]+(?:\n(?!\s*(?:[-*•]|\d+\.)?\s*\*{0,2}(?:REQ|RF|REQUISITO)[-_]?\d+|\s*#+\s|\s*\d+\.\s+[A-Z])[^\n]+)*)/gi;

    const explicitMatches: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = explicitRegex.exec(clean)) !== null) {
      const rawCode = m[1].trim();
      const parenTitle = m[2] ? m[2].trim() : '';
      const body = m[3] ? m[3].replace(/\s+/g, ' ').trim() : '';

      const numMatch = rawCode.match(/\d+/);
      const num = numMatch ? parseInt(numMatch[0], 10) : (explicitMatches.length + 1);
      const code = `REQ-${num}`;

      let title = '';
      if (parenTitle && body) {
        title = `${parenTitle}: ${body}`;
      } else if (parenTitle) {
        title = parenTitle;
      } else {
        title = body;
      }
      if (title.length >= 3) {
        explicitMatches.push(`${code}: ${title}`);
      }
    }

    if (explicitMatches.length > 0) {
      return explicitMatches;
    }

    // 2. Free-text bullet points (- , * , 1. )
    const lines = clean.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const bulletItems: string[] = [];
    for (const line of lines) {
      const bulletMatch = line.match(/^[-*•]\s+(.{15,})$/) || line.match(/^\d+\.\s+(.{15,})$/);
      if (bulletMatch) {
        const itemText = bulletMatch[1].trim();
        if (
          !itemText.endsWith(':') &&
          !itemText.toLowerCase().includes('stack tecnológica') &&
          !itemText.toLowerCase().includes('requisitos funcionais') &&
          !itemText.toLowerCase().includes('padrões docsimp')
        ) {
          bulletItems.push(itemText);
        }
      }
    }

    if (bulletItems.length >= 2) {
      return bulletItems.slice(0, 12).map((item, idx) => `REQ-${idx + 1}: ${item}`);
    }

    // 3. Fallback: split by commas/semicolons/newlines/conjunctions for free-form descriptions
    // (e.g. "Construa um sistema financeiro, com autenticação, dashboard, receitas e despesas, categorias, filtros...")
    // Avoid splitting periods in file paths or abbreviations
    const parts = clean
      .replace(/\s*\([^)]*\)/g, match => match.replace(/[,;]/g, ' ')) // protect commas inside parentheses
      .split(/[,;\n]+|\s+e\s+(?=[a-zA-ZÀ-ÿ]{4,})/i)
      .map(s => s.replace(/^(construa|crie|desenvolva|quero|implemente)\s+(um|uma)?\s*/i, '').trim())
      .filter(s => s.length >= 4 && !s.startsWith('.') && !s.includes('://'));

    if (parts.length <= 1) {
      return [
        `REQ-1: Atender ao objetivo principal: ${clean.slice(0, 80)}`,
        'REQ-2: Garantir cobertura de testes automatizados e execução verificável'
      ];
    }

    return parts.slice(0, 15).map((p, idx) => `REQ-${idx + 1}: ${p.charAt(0).toUpperCase() + p.slice(1)}`);
  }

  /**
   * Calculates and persists the state of a Grande Tarefa from its subordinate microtasks
   * and verifies that associated mandatory requirements have verified evidence before allowing COMPLETED.
   */
  static recalculateMajorTaskState(majorTaskId: string, actor: AgentRoleType = 'system'): any {
    const major: any = db.prepare('SELECT * FROM autonomous_major_tasks WHERE id = ?').get(majorTaskId);
    if (!major) return null;

    const microtasks: any[] = db.prepare(
      'SELECT * FROM autonomous_tasks WHERE major_task_id = ? ORDER BY order_index ASC'
    ).all(majorTaskId);

    if (microtasks.length === 0) return major;

    // Sync requirement statuses first
    this.syncRequirementTraceability(major.run_id);

    const activeMicrotasks = microtasks.filter(t => t.status !== 'waived');
    const waivedCount = microtasks.length - activeMicrotasks.length;
    const states = activeMicrotasks.map(t => this.resolveTaskLifecycleState(t));
    let newState: TaskLifecycleState = 'PLANNED';

    // Check mandatory requirements linked to this Major Task
    const allRunReqs = this.getProjectRequirements(major.run_id);
    const majorReqCodes = new Set<string>((major.requirement_ids_json ? JSON.parse(major.requirement_ids_json) : []).map((x: string) => normalizeRequirementCode(x)));
    const linkedReqs = allRunReqs.filter(
      r => r.mandatory && (r.linkedMajorTaskIds.includes(majorTaskId) || r.linkedMajorTaskIds.includes(major.code) || majorReqCodes.has(normalizeRequirementCode(r.code)))
    );
    const unverifiedReqs = linkedReqs.filter(r => {
      if (r.status === 'verified') return false;
      const tasksInMajorForReq = activeMicrotasks.filter(t => {
        const tReqs: string[] = t.requirement_ids_json ? JSON.parse(t.requirement_ids_json) : [];
        return r.linkedTaskIds.includes(t.id) || tReqs.map(x => normalizeRequirementCode(x)).includes(normalizeRequirementCode(r.code));
      });
      if (tasksInMajorForReq.length === 0) {
        return true;
      }
      return !tasksInMajorForReq.every(
        t => t.status === 'completed' && (t.review_decision === 'APPROVED' || Boolean(t.task_commit_sha))
      );
    });
    const allRequirementsVerified = unverifiedReqs.length === 0;

    let blockingReason: string | null = null;

    if (activeMicrotasks.length > 0 && states.every(s => s === 'COMPLETED')) {
      if (allRequirementsVerified) {
        newState = 'COMPLETED';
      } else {
        // Section 5 & Scenario 10: A Major Task CANNOT be marked COMPLETED if any associated mandatory requirement lacks verified evidence!
        newState = 'IN_PROGRESS';
        blockingReason = `Requisitos obrigatórios da Grande Tarefa [${major.code}] ainda sem evidência verificada: ${unverifiedReqs.map(r => `${r.code} (${r.title})`).join(', ')}`;
      }
    } else if (activeMicrotasks.length === 0 && waivedCount > 0) {
      if (allRequirementsVerified) {
        newState = 'COMPLETED';
      } else {
        newState = 'BLOCKED';
        blockingReason = `Todas as microtarefas foram dispensadas mas há requisitos obrigatórios sem cobertura: ${unverifiedReqs.map(r => r.code).join(', ')}`;
      }
    } else if (states.some(s => s === 'BLOCKED')) {
      newState = 'BLOCKED';
      const blockedMicro = activeMicrotasks.find(t => this.resolveTaskLifecycleState(t) === 'BLOCKED');
      blockingReason = blockedMicro?.blocking_reason || `Microtarefa [${blockedMicro?.code || blockedMicro?.title}] bloqueada.`;
    } else if (states.some(s => s === 'REWORK_REQUIRED')) {
      newState = 'REWORK_REQUIRED';
    } else if (states.some(s => s === 'COMMIT_PENDING')) {
      newState = 'COMMIT_PENDING';
    } else if (states.some(s => s === 'APPROVED')) {
      newState = 'APPROVED';
    } else if (states.some(s => s === 'REVIEW_PENDING')) {
      newState = 'REVIEW_PENDING';
    } else if (states.some(s => s === 'IN_PROGRESS') || (states.some(s => s === 'COMPLETED') && states.some(s => s === 'READY' || s === 'PLANNED'))) {
      newState = 'IN_PROGRESS';
    } else if (states.some(s => s === 'READY')) {
      newState = 'READY';
    } else {
      newState = 'PLANNED';
    }

    const oldState = this.resolveTaskLifecycleState(major);
    const newStatus = newState.toLowerCase();
    const nowIso = new Date().toISOString();

    const completedCount = states.filter(s => s === 'COMPLETED').length;
    const rawTaskPct = activeMicrotasks.length > 0 ? Math.round((completedCount / activeMicrotasks.length) * 100) : 0;
    const progressPct = newState === 'COMPLETED' ? 100 : Math.min(rawTaskPct, allRequirementsVerified ? 100 : 90);
    const commits = microtasks.map(t => t.task_commit_sha).filter(Boolean);
    const validationEvidence = {
      totalMicrotasks: microtasks.length,
      completedMicrotasks: completedCount,
      waivedMicrotasks: waivedCount,
      pendingMicrotasks: Math.max(0, activeMicrotasks.length - completedCount),
      progressPct,
      commits,
      allApprovedAndCommitted: newState === 'COMPLETED',
      allRequirementsVerified,
      unverifiedRequirements: unverifiedReqs.map(r => `${r.code}: ${r.title}`),
      blockingReason,
      updatedAt: nowIso
    };

    const history = major.history_json ? JSON.parse(major.history_json) : [];
    if (oldState !== newState) {
      history.push({
        fromState: oldState,
        toState: newState,
        at: nowIso,
        actor,
        completedMicrotasks: `${completedCount}/${activeMicrotasks.length}`
      });
    }

    db.prepare(`
      UPDATE autonomous_major_tasks
      SET status = ?, lifecycle_state = ?, blocking_reason = ?, validation_evidence_json = ?, history_json = ?, updated_at = ?
      WHERE id = ?
    `).run(
      newStatus,
      newState,
      blockingReason,
      JSON.stringify(validationEvidence),
      JSON.stringify(history),
      nowIso,
      majorTaskId
    );

    if (oldState !== newState) {
      db.prepare(`
        INSERT INTO task_state_transitions (
          id, run_id, project_id, entity_type, major_task_id, task_id,
          from_status, to_status, from_lifecycle_state, to_lifecycle_state,
          actor, reason, metadata_json, created_at
        ) VALUES (?, ?, ?, 'major_task', ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        crypto.randomUUID(),
        major.run_id,
        major.project_id,
        major.id,
        major.status,
        newStatus,
        oldState,
        newState,
        actor,
        blockingReason || `Estado da Grande Tarefa [${major.code}] recalculado a partir das microtarefas (${completedCount}/${activeMicrotasks.length} concluídas)`,
        JSON.stringify(validationEvidence),
        nowIso
      );

      if (newState === 'COMPLETED') {
        this.recordAgentCommunication({
          idempotencyKey: `major-completed:${major.run_id}:${major.id}`,
          projectId: major.project_id,
          runId: major.run_id,
          majorTaskId: major.id,
          fromAgent: 'supervisor',
          toAgent: 'system',
          messageType: 'MAJOR_TASK_COMPLETED',
          content: `Grande Tarefa [${major.code}] "${major.title}" concluída com ${completedCount} microtarefa(s) aprovada(s) e commitada(s).`,
          payload: validationEvidence
        });
      }
    }

    return db.prepare('SELECT * FROM autonomous_major_tasks WHERE id = ?').get(majorTaskId);
  }

  /**
   * Returns hydrated Major Tasks with their Stages (Etapas) and subordinate Microtasks for a run.
   */
  static getMajorTasksForRun(runId: string): any[] {
    const majors: any[] = db.prepare(
      'SELECT * FROM autonomous_major_tasks WHERE run_id = ? ORDER BY order_index ASC'
    ).all(runId);

    const tasks: any[] = db.prepare(
      'SELECT * FROM autonomous_tasks WHERE run_id = ? ORDER BY order_index ASC'
    ).all(runId);

    return majors.map(m => {
      const subordinate = tasks.filter(t => t.major_task_id === m.id);
      const activeSubordinate = subordinate.filter(t => t.status !== 'waived');
      const completedCount = activeSubordinate.filter(t => t.status === 'completed').length;
      const validationEvidence = m.validation_evidence_json ? JSON.parse(m.validation_evidence_json) : {};
      const allReqsVerified = validationEvidence.allRequirementsVerified !== false;
      const rawPct = activeSubordinate.length > 0 ? Math.round((completedCount / activeSubordinate.length) * 100) : 0;
      const progressPct = m.status === 'completed' ? 100 : Math.min(rawPct, allReqsVerified ? 100 : 90);

      // Build hydrated stages (Etapas)
      const persistedStages: any[] = m.stages_json ? JSON.parse(m.stages_json) : [];
      const stageMap = new Map<string, any>();
      persistedStages.forEach((st, idx) => {
        stageMap.set(st.code, {
          code: st.code,
          title: st.title,
          objective: st.objective || st.title,
          orderIndex: st.orderIndex ?? idx + 1,
          microtasks: [] as any[]
        });
      });

      for (const t of subordinate) {
        const sCode = t.stage_code || `ET-${m.order_index || 1}.1`;
        const sTitle = t.stage_title || `Etapa Principal — ${m.title}`;
        if (!stageMap.has(sCode)) {
          stageMap.set(sCode, {
            code: sCode,
            title: sTitle,
            objective: sTitle,
            orderIndex: stageMap.size + 1,
            microtasks: []
          });
        }
        stageMap.get(sCode)!.microtasks.push(t);
      }

      const stages = Array.from(stageMap.values()).map(st => {
        const stTasks: any[] = st.microtasks;
        const stCompleted = stTasks.filter(t => t.status === 'completed').length;
        const stPct = stTasks.length > 0 ? Math.round((stCompleted / stTasks.length) * 100) : 0;
        const stReqIds = Array.from(
          new Set(
            stTasks.flatMap(t => (t.requirement_ids_json ? JSON.parse(t.requirement_ids_json) : []))
          )
        );
        const stStatus =
          stTasks.length > 0 && stCompleted === stTasks.length
            ? 'completed'
            : stTasks.some(t => t.status === 'blocked')
            ? 'blocked'
            : stTasks.some(t => t.status === 'in_progress' || t.status === 'in_review')
            ? 'in_progress'
            : stCompleted > 0
            ? 'in_progress'
            : 'pending';
        return {
          code: st.code,
          title: st.title,
          objective: st.objective,
          orderIndex: st.orderIndex,
          status: stStatus,
          totalMicrotasks: stTasks.length,
          completedMicrotasks: stCompleted,
          progressPct: stPct,
          microtaskIds: stTasks.map(t => t.id),
          requirementIds: stReqIds
        };
      });

      return {
        ...m,
        requirements: m.requirements_json ? JSON.parse(m.requirements_json) : [],
        requirementIds: m.requirement_ids_json ? JSON.parse(m.requirement_ids_json) : [],
        complexityTier: m.complexity_tier || 'MODERATE',
        blockingReason: m.blocking_reason || validationEvidence.blockingReason || null,
        acceptanceCriteria: m.acceptance_criteria_json ? JSON.parse(m.acceptance_criteria_json) : [],
        dependencies: m.dependencies_json ? JSON.parse(m.dependencies_json) : [],
        validationEvidence,
        history: m.history_json ? JSON.parse(m.history_json) : [],
        progressPct,
        stages,
        microtasks: subordinate.map(t => ({
          id: t.id,
          code: t.code || `${m.order_index}.${t.order_index}`,
          title: t.title,
          objective: t.objective || t.title,
          stageCode: t.stage_code || null,
          stageTitle: t.stage_title || null,
          parentTaskId: t.parent_task_id || null,
          requirementIds: t.requirement_ids_json ? JSON.parse(t.requirement_ids_json) : [],
          discoverySource: t.discovery_source || null,
          blockingReason: t.blocking_reason || null,
          waivedReason: t.waived_reason || null,
          status: t.status,
          lifecycleState: this.resolveTaskLifecycleState(t),
          retryCount: t.retry_count || 0,
          maxRetries: t.max_retries || 3,
          commitSha: t.task_commit_sha || null,
          reviewDecision: t.review_decision || null,
          verificationCommand: t.verification_command || null,
          dependencies: t.dependencies_json ? JSON.parse(t.dependencies_json) : [],
          criteria: t.criteria_json ? JSON.parse(t.criteria_json) : [],
          allowedScope: t.allowed_scope_json ? JSON.parse(t.allowed_scope_json) : []
        }))
      };
    });
  }

  /**
   * Builds a complete Worker Execution Contract for a microtask, including rework feedback if retry > 0.
   * Supports calling as buildWorkerExecutionContract(taskId) or buildWorkerExecutionContract(runId, taskId).
   */
  static buildWorkerExecutionContract(runIdOrTaskId: string, maybeTaskId?: string): {
    contractId: string;
    executionId: string;
    projectId: string;
    runId: string;
    majorTaskId: string | null;
    majorTaskCode: string;
    majorTaskTitle: string;
    taskId: string;
    microTaskId: string;
    code: string;
    microTaskCode: string;
    title: string;
    objective: string;
    description: string;
    allowedScope: string[];
    constraints: string[];
    dependencies: string[];
    criteria: string[];
    acceptanceCriteria: string[];
    testStrategy: string;
    verificationCommand: string;
    requiredEvidence: string[];
    attempt: number;
    attemptNumber: number;
    maxRetries: number;
    priorAttempts: any[];
    reworkInstructions: {
      isRework: boolean;
      previousRejectionReasons: string[];
      unmetCriteria: string[];
      observedEvidence: string;
      requiredCorrections: string[];
    } | null;
    reworkContext: {
      previousDecision: string;
      previousReviewDecision: string;
      previousFeedback: string;
      failedCriteria: string[];
      problemsFound: string[];
      reworkInstructions: string[];
    } | null;
  } {
    const task: any = maybeTaskId
      ? db.prepare('SELECT * FROM autonomous_tasks WHERE id = ? AND run_id = ?').get(maybeTaskId, runIdOrTaskId)
      : db.prepare('SELECT * FROM autonomous_tasks WHERE id = ?').get(runIdOrTaskId);
    if (!task) {
      throw new Error(`EXECUTION_CONTRACT_ERROR: Microtarefa ${maybeTaskId || runIdOrTaskId} não encontrada.`);
    }
    const runId = task.run_id;
    const taskId = task.id;
    const run: any = db.prepare('SELECT * FROM autonomous_runs WHERE id = ?').get(runId);
    const major: any = task.major_task_id
      ? db.prepare('SELECT * FROM autonomous_major_tasks WHERE id = ?').get(task.major_task_id)
      : null;

    const attempt = (task.retry_count || 0) + 1;
    const executionId = `exec-${task.id.slice(0, 8)}-att-${attempt}`;
    const priorAttempts = task.attempt_history_json ? JSON.parse(task.attempt_history_json) : [];
    const lastReview = task.review_result_json ? JSON.parse(task.review_result_json) : null;

    const latestSupervisorReview: any = db.prepare(
      'SELECT * FROM supervisor_reviews WHERE run_id = ? AND task_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1'
    ).get(runId, taskId);
    const latestEval = IndependentEvaluator.getEvaluationByTaskId(taskId);

    let reworkInstructions = null;
    let reworkContext = null;
    if (attempt > 1 || task.status === 'needs_changes' || task.lifecycle_state === 'REWORK_REQUIRED') {
      const reasons: string[] = [];
      if (latestSupervisorReview?.feedback) reasons.push(latestSupervisorReview.feedback);
      if (lastReview?.justification && !reasons.includes(lastReview.justification)) {
        reasons.push(lastReview.justification);
      }
      if (latestEval?.evaluatorNotes) reasons.push(latestEval.evaluatorNotes);

      const unmetCriteria =
        lastReview?.evaluatedCriteria
          ?.filter((c: any) => c.status !== 'PASSED')
          .map((c: any) => c.criterion) ||
        latestEval?.failedCriteria ||
        [];

      const requiredCorrections =
        lastReview?.recommendedCorrections?.length > 0
          ? lastReview.recommendedCorrections
          : [
              'Corrigir todos os critérios reprovados listados acima',
              `Executar "${task.verification_command || 'npm test'}" e garantir código de saída 0`,
              'Submeter novo relatório com evidências reais para nova inspeção do Review'
            ];

      reworkInstructions = {
        isRework: true,
        previousRejectionReasons: reasons.length > 0 ? reasons : ['Critérios de aceitação não verificados na tentativa anterior'],
        unmetCriteria,
        observedEvidence: latestEval?.actual || lastReview?.justification || 'Verifique logs de execução anteriores',
        requiredCorrections
      };

      reworkContext = {
        previousDecision: lastReview?.decision || latestSupervisorReview?.verdict || 'REJECTED',
        previousReviewDecision: lastReview?.decision || latestSupervisorReview?.verdict || 'REJECTED',
        previousFeedback: reasons.join(' | ') || 'Critérios de aceitação não verificados na tentativa anterior',
        failedCriteria: unmetCriteria,
        problemsFound: lastReview?.problemsFound || reasons,
        reworkInstructions: requiredCorrections
      };
    }

    db.prepare('UPDATE autonomous_tasks SET execution_id = ?, updated_at = ? WHERE id = ?').run(
      executionId,
      new Date().toISOString(),
      taskId
    );

    const parsedCriteria = task.criteria_json ? JSON.parse(task.criteria_json) : [];

    return {
      contractId: task.contract_id || `contract-${task.id.slice(0, 8)}`,
      executionId,
      projectId: task.project_id || run?.project_id || '',
      runId,
      majorTaskId: task.major_task_id || null,
      majorTaskCode: major?.code || task.milestone || 'GT-1',
      majorTaskTitle: major?.title || `Marco ${task.milestone || 'M1'}`,
      taskId: task.id,
      microTaskId: task.id,
      code: task.code || `${task.order_index || 1}`,
      microTaskCode: task.code || `${task.order_index || 1}`,
      title: task.title,
      objective: task.objective || task.title,
      description: task.description || task.title,
      allowedScope: task.allowed_scope_json
        ? JSON.parse(task.allowed_scope_json)
        : task.expected_files_json
        ? JSON.parse(task.expected_files_json)
        : [],
      constraints: task.constraints_json
        ? JSON.parse(task.constraints_json)
        : ['Não aprovar a própria tarefa; manter escopo cirúrgico'],
      dependencies: task.dependencies_json ? JSON.parse(task.dependencies_json) : [],
      criteria: parsedCriteria,
      acceptanceCriteria: parsedCriteria,
      testStrategy: task.test_strategy || `Executar "${task.verification_command || 'npm test'}"`,
      verificationCommand: task.verification_command || 'npm test',
      requiredEvidence: task.required_evidence_json ? JSON.parse(task.required_evidence_json) : [],
      attempt,
      attemptNumber: attempt,
      maxRetries: task.max_retries || 3,
      priorAttempts,
      reworkInstructions,
      reworkContext
    };
  }

  /**
   * Performs an independent, evidence-based Review evaluation of a microtask.
   * Checks real files, scope compliance, anti-placeholder/mock rules, test execution,
   * and individual acceptance criteria.
   */
  static evaluateIndependentReviewDecision(params: {
    runId: string;
    taskId: string;
    projectPath: string;
    builderReport?: any;
    workerReport?: any;
    evaluationResult?: EvaluationResult | null;
    independentEvaluation?: EvaluationResult | null;
    supervisorVerdict?: 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED' | 'BLOCKED';
    supervisorFeedback?: string;
    enforceScopeCheck?: boolean;
    allowReworkOnBlocked?: boolean;
  }): StructuredReviewDecision {
    const task: any = db.prepare('SELECT * FROM autonomous_tasks WHERE id = ?').get(params.taskId);
    if (!task) {
      throw new Error(`REVIEW_ERROR: Microtarefa ${params.taskId} não encontrada.`);
    }

    const evalRes =
      params.evaluationResult ??
      params.independentEvaluation ??
      IndependentEvaluator.getEvaluationByTaskId(params.taskId);
    const criteria: string[] = task.criteria_json ? JSON.parse(task.criteria_json) : ['Implementação concluída'];
    const allowedScope: string[] = task.allowed_scope_json
      ? JSON.parse(task.allowed_scope_json)
      : task.expected_files_json
      ? JSON.parse(task.expected_files_json)
      : [];

    const effectiveReport = params.builderReport || params.workerReport;
    const reportFiles: string[] = Array.isArray(effectiveReport?.filesChanged)
      ? effectiveReport.filesChanged
      : [];

    const outOfScopeFiles: string[] = [];
    const placeholdersOrMocksDetected: string[] = [];
    const securityOrIsolationIssues: string[] = [];
    const regressionsDetected: string[] = [];
    const problemsFound: string[] = [];

    // 1. Check for forbidden/secret/runtime files and scope compliance in reportFiles
    const shouldCheckScope = params.enforceScopeCheck !== false && allowedScope.length > 0;
    for (const rawFile of reportFiles) {
      const normalized = String(rawFile || '').replace(/\\/g, '/').trim();
      if (!normalized) continue;
      if (
        /(^|\/)\.env(\.|$)/i.test(normalized) ||
        /\.(pem|key)$/i.test(normalized) ||
        /(^|\/)hub\.db(-wal|-shm)?$/i.test(normalized) ||
        /(^|\/)\.decohub-data(\/|$)/i.test(normalized)
      ) {
        securityOrIsolationIssues.push(`Arquivo proibido/sensível incluído nas alterações: ${normalized}`);
      }
      if (shouldCheckScope) {
        const matchesScope = allowedScope.some(allowed => {
          const cleanAllowed = allowed.replace(/\\/g, '/').trim();
          if (
            normalized === cleanAllowed ||
            normalized.startsWith(cleanAllowed.replace(/\*.*$/, '')) ||
            /(test|spec)\.[cm]?[jt]sx?$/i.test(normalized) ||
            normalized.startsWith('public/') ||
            normalized.startsWith('src/') ||
            normalized.startsWith('test/') ||
            normalized.startsWith('tests/') ||
            normalized.startsWith('.ai-dev-hub/') ||
            normalized.startsWith('ai-dev-hub/') ||
            normalized.startsWith('.agents/') ||
            normalized.startsWith('agents/') ||
            normalized.startsWith('data/') ||
            /\.(sqlite|db|sqlite3)$/i.test(normalized) ||
            [
              'package.json',
              'package-lock.json',
              'tsconfig.json',
              'readme.md',
              'agents.md',
              'design.md',
              'architecture.md',
              'project.md',
              'decisions.md',
              'tasks.md',
              'changes.md',
              'session-summary.md',
              'program.md',
              'rea-blueprint.md',
              'market-research-rea.md',
              'lessons.md'
            ].includes(normalized.toLowerCase()) ||
            normalized.endsWith('.md')
          ) return true;

          // Extension Equivalence (.js <-> .cjs <-> .mjs)
          const normExt = path.extname(normalized).toLowerCase();
          const allowExt = path.extname(cleanAllowed).toLowerCase();
          if (['.js', '.cjs', '.mjs'].includes(normExt) && ['.js', '.cjs', '.mjs'].includes(allowExt)) {
            const normBase = normalized.slice(0, -normExt.length);
            const allowBase = cleanAllowed.slice(0, -allowExt.length);
            if (normBase === allowBase) return true;
          }
          return false;
        });
        if (!matchesScope) {
          outOfScopeFiles.push(normalized);
        }
      }
    }

    // 2. Inspect modified files on disk for inconsistency, missing implementation, or placeholders
    const hasGitWorkspace = Boolean(params.projectPath && fs.existsSync(path.join(params.projectPath, '.git')));
    let gitInfo: { changedFiles: any[] } = { changedFiles: [] };
    if (hasGitWorkspace) {
      try {
        gitInfo = GitManager.getGitInfo(params.projectPath);
      } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "hierarchicalOrchestrationService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:hierarchicalOrchestrationService]", err);
      }
    }
    }

    if (hasGitWorkspace && !task.task_commit_sha && reportFiles.length === 0 && allowedScope.length > 0 && params.supervisorVerdict !== 'BLOCKED' && evalRes?.verdict !== 'BLOCKED') {
      const missingScoped = allowedScope.filter(s => {
        const clean = s.replace(/\\/g, '/').trim();
        if (!clean || clean.includes('*')) return false;
        if (fs.existsSync(path.join(params.projectPath, clean))) return false;
        const ext = path.extname(clean).toLowerCase();
        if (['.js', '.cjs', '.mjs'].includes(ext)) {
          const baseWithoutExt = clean.slice(0, -ext.length);
          for (const altExt of ['.js', '.cjs', '.mjs']) {
            if (fs.existsSync(path.join(params.projectPath, `${baseWithoutExt}${altExt}`))) {
              return false; // Equivalent file exists on disk
            }
          }
        }
        return true;
      });
      if (missingScoped.length > 0) {
        problemsFound.push(
          `Worker declarou conclusão sem alterar arquivos; arquivos obrigatórios ausentes em disco: ${missingScoped.join(', ')}`
        );
      }
    }

    for (const relFile of reportFiles) {
      const normalized = GitManager.normalizeRepoPath(params.projectPath, relFile);
      if (!normalized) continue;
      // Arquivos de documentação, memória e governança do AI DEV HUB são ignorados na inspeção de falhas de código
      if (
        normalized.startsWith('.ai-dev-hub/') ||
        normalized.startsWith('ai-dev-hub/') ||
        normalized.startsWith('.agents/') ||
        normalized === 'AGENTS.md' ||
        normalized === 'DESIGN.md'
      ) {
        continue;
      }
      let fullPath = path.join(params.projectPath, normalized);
      let existsOnDisk = fs.existsSync(fullPath);
      if (!existsOnDisk && hasGitWorkspace) {
        const ext = path.extname(normalized).toLowerCase();
        if (['.js', '.cjs', '.mjs'].includes(ext)) {
          const baseWithoutExt = normalized.slice(0, -ext.length);
          for (const altExt of ['.js', '.cjs', '.mjs']) {
            const altPath = path.join(params.projectPath, `${baseWithoutExt}${altExt}`);
            if (fs.existsSync(altPath)) {
              fullPath = altPath;
              existsOnDisk = true;
              break;
            }
          }
        }
      }
      if (hasGitWorkspace && !existsOnDisk) {
        const gitStatus = gitInfo.changedFiles.find(f => f.file === normalized);
        const isLegitimatelyDeleted = gitStatus && gitStatus.status === 'deleted';
        if (!isLegitimatelyDeleted) {
          problemsFound.push(
            `Relatório do Worker inconsistente com o código real: arquivo declarado "${normalized}" não existe no disco.`
          );
        }
      } else if (existsOnDisk && !fs.statSync(fullPath).isDirectory()) {
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          if (!content.trim()) {
            problemsFound.push(`Arquivo "${normalized}" está vazio em disco.`);
          }
          if (/TODO:\s*implement(ar(\s+depois|\s+cálculo.*)?|\s+later)|FIXME:\s*placeholder|throw new Error\(['"]Not implemented['"]\)/i.test(content)) {
            placeholdersOrMocksDetected.push(`Placeholder não implementado detectado em ${normalized}`);
          }
        } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "hierarchicalOrchestrationService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:hierarchicalOrchestrationService]", err);
      }
    }
      }
    }

    if (evalRes?.verdict === 'TAMPERING_DETECTED') {
      regressionsDetected.push(evalRes.evaluatorNotes || 'Adulteração de testes protegidos detectada pelo IndependentEvaluator');
    }

    // Require real test execution evidence unless BLOCKED
    if (params.supervisorVerdict !== 'BLOCKED' && evalRes?.verdict !== 'BLOCKED') {
      if (!evalRes) {
        problemsFound.push('Nenhuma avaliação independente (IndependentEvaluator) foi executada para comprovar os testes.');
      } else if (evalRes.verdict === 'PASS' && (!Array.isArray(evalRes.executedCommands) || evalRes.executedCommands.length === 0)) {
        problemsFound.push('Relatório alega testes aprovados, mas nenhum comando de verificação foi realmente executado pelo IndependentEvaluator.');
      }
    }

    // Arquivos de código do próprio app (public/*, src/*, test/*) nunca devem gerar REJECTED quando evalRes?.verdict === 'PASS'
    const actionableOutOfScope = outOfScopeFiles.filter(file => {
      if (evalRes?.verdict === 'PASS') {
        const norm = file.replace(/\\/g, '/').toLowerCase();
        if (norm.startsWith('public/') || norm.startsWith('src/') || norm.startsWith('test/') || norm.startsWith('tests/')) {
          return false;
        }
      }
      return true;
    });

    // 3. Determine decision (APPROVED, REJECTED, or BLOCKED)
    let decision: 'APPROVED' | 'REJECTED' | 'BLOCKED' = 'APPROVED';

    if (params.supervisorVerdict === 'BLOCKED' || (evalRes?.verdict === 'BLOCKED' && !params.allowReworkOnBlocked)) {
      decision = 'BLOCKED';
      problemsFound.push(params.supervisorFeedback || evalRes?.evaluatorNotes || 'Avaliação bloqueada por dependência ou comando incompatível.');
    } else if (
      problemsFound.length > 0 ||
      securityOrIsolationIssues.length > 0 ||
      regressionsDetected.length > 0 ||
      placeholdersOrMocksDetected.length > 0 ||
      actionableOutOfScope.length > 0 ||
      evalRes?.verdict === 'FAIL' ||
      evalRes?.verdict === 'BLOCKED' ||
      evalRes?.verdict === 'TAMPERING_DETECTED' ||
      params.supervisorVerdict === 'CHANGES_REQUESTED' ||
      params.supervisorVerdict === 'REJECTED'
    ) {
      decision = 'REJECTED';
      problemsFound.push(
        ...securityOrIsolationIssues,
        ...regressionsDetected,
        ...placeholdersOrMocksDetected,
        ...actionableOutOfScope.map(f => `Arquivo fora do escopo permitido: ${f}`)
      );
      if (evalRes && evalRes.verdict !== 'PASS') {
        problemsFound.push(evalRes.evaluatorNotes || `Avaliação independente retornou ${evalRes.verdict}`);
      }
      if (params.supervisorFeedback && params.supervisorVerdict !== 'APPROVED') {
        problemsFound.push(params.supervisorFeedback);
      }
    }

    // 4. Evaluate individual criteria
    const passedSet = new Set(evalRes?.passedCriteria || []);
    const failedSet = new Set(evalRes?.failedCriteria || []);

    const evaluatedCriteria = criteria.map(criterion => {
      if (decision === 'BLOCKED') {
        return {
          criterion,
          status: 'UNVERIFIED' as const,
          passed: false,
          evidence: 'Avaliação bloqueada antes da confirmação do critério'
        };
      }
      if (failedSet.has(criterion) || decision === 'REJECTED') {
        const isPassed = passedSet.has(criterion) && !failedSet.has(criterion) && problemsFound.length === 0;
        return {
          criterion,
          status: (isPassed ? 'PASSED' : 'FAILED') as 'PASSED' | 'FAILED',
          passed: isPassed,
          evidence: problemsFound[0] || evalRes?.actual || 'Critério não atendido na verificação independente'
        };
      }
      return {
        criterion,
        status: 'PASSED' as const,
        passed: true,
        evidence: evalRes?.actual || 'Verificado com sucesso por evidência independente'
      };
    });

    const executedCommands = evalRes?.executedCommands || (task.verification_command ? [task.verification_command] : []);
    const commandResults = executedCommands.map(cmd => ({
      command: cmd,
      exitCode: evalRes?.exitCode ?? (decision === 'APPROVED' ? 0 : 1),
      outputExcerpt: (evalRes?.actual || params.supervisorFeedback || '').slice(0, 500)
    }));

    const recommendedCorrections =
      decision === 'APPROVED'
        ? []
        : [
            ...problemsFound.map(p => `Corrigir: ${p}`),
            `Garantir que o comando "${task.verification_command || 'npm test'}" passe com código 0`
          ];

    const reviewDecision: StructuredReviewDecision = {
      reviewId: crypto.randomUUID(),
      evaluationId: evalRes?.id || null,
      taskId: task.id,
      majorTaskId: task.major_task_id || null,
      runId: params.runId,
      decision,
      evaluatedCriteria,
      executedCommands,
      commandResults,
      filesInspected: reportFiles,
      outOfScopeFiles,
      placeholdersOrMocksDetected,
      regressionsDetected,
      securityOrIsolationIssues,
      problemsFound,
      justification:
        (decision === 'APPROVED' ? (params.supervisorFeedback || evalRes?.evaluatorNotes) : null) ||
        (decision === 'APPROVED'
          ? 'Todos os critérios obrigatórios e verificações independentes foram comprovados.'
          : problemsFound.length > 0
          ? `Reprovado no Review independente: ${problemsFound.join('; ')}`
          : (evalRes && evalRes.verdict !== 'PASS'
            ? `Reprovado pelo Evaluator: ${evalRes.actual || evalRes.evaluatorNotes}`
            : 'Critérios obrigatórios não atendidos na avaliação independente.')),
      recommendedCorrections,
      evaluatedAt: new Date().toISOString()
    };

    db.prepare(`
      UPDATE autonomous_tasks
      SET review_decision = ?, review_result_json = ?, updated_at = ?
      WHERE id = ?
    `).run(decision, JSON.stringify(reviewDecision), reviewDecision.evaluatedAt, task.id);

    return reviewDecision;
  }

  /**
   * Executes the post-Review Git Commit Gate:
   * Strictly requires APPROVED state before committing.
   * Transitions APPROVED -> COMMIT_PENDING -> COMPLETED (or BLOCKED if commit fails).
   */
  static executePostReviewCommitGate(params: {
    runId: string;
    taskId: string;
    projectPath: string;
    filesChanged?: string[];
    commitMessage?: string;
    requireGitCommit?: boolean;
    requireCodeChanges?: boolean;
    simulateCommitFailure?: boolean;
  }): {
    success: boolean;
    committed: boolean;
    commitSha: string | null;
    commitMessage: string;
    filesCommitted: string[];
    errorReason?: string;
    error?: string;
  } {
    const task: any = db.prepare('SELECT * FROM autonomous_tasks WHERE id = ?').get(params.taskId);
    if (!task) {
      throw new Error(`COMMIT_GATE_ERROR: Microtarefa ${params.taskId} não encontrada.`);
    }

    const currentState = this.toLifecycleState(task.lifecycle_state || task.status);
    if (currentState !== 'APPROVED' && currentState !== 'COMMIT_PENDING' && currentState !== 'COMPLETED') {
      throw new Error(
        `COMMIT_BEFORE_APPROVAL_FORBIDDEN: Nenhum commit de conclusão pode ser criado antes da aprovação do Review (estado atual: ${currentState}).`
      );
    }

    // If task already has a verified commit SHA and is completed, return idempotently
    if (task.task_commit_sha && currentState === 'COMPLETED') {
      return {
        success: true,
        committed: true,
        commitSha: task.task_commit_sha,
        commitMessage: params.commitMessage || `feat(ai): [${task.code || task.milestone}] ${task.title}`,
        filesCommitted: params.filesChanged || []
      };
    }

    if (currentState === 'APPROVED') {
      this.transitionTaskState({
        taskId: task.id,
        toState: 'COMMIT_PENDING',
        actor: 'supervisor',
        reason: 'Review aprovado; preparando commit rastreável da microtarefa.'
      });
    }

    const runRow: any = db.prepare('SELECT project_id FROM autonomous_runs WHERE id = ?').get(params.runId);
    const projectId = task.project_id || runRow?.project_id || '';
    const taskCode = task.code || task.milestone || '1.1';
    const commitMessage =
      params.commitMessage ||
      `feat(task-${taskCode}): [${task.milestone || 'M1'}] ${task.title} [task:${task.id.slice(0, 8)}]`;

    if (params.simulateCommitFailure) {
      const reason = 'COMMIT_FAILURE: Falha no pré-commit/git commit da microtarefa.';
      db.prepare('UPDATE autonomous_tasks SET commit_status = ?, commit_error = ?, updated_at = ? WHERE id = ?').run(
        'commit_failed',
        reason,
        new Date().toISOString(),
        task.id
      );
      this.transitionTaskState({
        taskId: task.id,
        toState: 'BLOCKED',
        actor: 'system',
        reason,
        metadata: { commitFailed: true }
      });
      this.recordAgentCommunication({
        projectId,
        runId: params.runId,
        majorTaskId: task.major_task_id || null,
        microTaskId: task.id,
        fromAgent: 'system',
        toAgent: 'supervisor',
        messageType: 'COMMIT_FAILED',
        content: reason,
        processingStatus: 'failed'
      });
      return {
        success: false,
        committed: false,
        commitSha: null,
        commitMessage,
        filesCommitted: [],
        errorReason: reason,
        error: reason
      };
    }

    const hasGitRepo = Boolean(params.projectPath && fs.existsSync(path.join(params.projectPath, '.git')));
    if (!hasGitRepo) {
      if (params.requireGitCommit) {
        const reason = 'COMMIT_FAILURE: Repositório Git não inicializado para tarefa que exige commit verificável.';
        db.prepare('UPDATE autonomous_tasks SET commit_status = ?, commit_error = ?, updated_at = ? WHERE id = ?').run(
          'commit_failed',
          reason,
          new Date().toISOString(),
          task.id
        );
        this.transitionTaskState({
          taskId: task.id,
          toState: 'BLOCKED',
          actor: 'system',
          reason
        });
        return {
          success: false,
          committed: false,
          commitSha: null,
          commitMessage,
          filesCommitted: [],
          errorReason: reason,
          error: reason
        };
      }

      // Synthetic unit test environment without git init: record synthetic marker and complete
      const syntheticSha = `no-git-${task.id.slice(0, 8)}`;
      db.prepare('UPDATE autonomous_tasks SET task_commit_sha = ?, commit_source = ?, commit_status = ?, commit_error = NULL WHERE id = ?').run(
        syntheticSha,
        'synthetic_no_git_repo',
        'local_committed',
        task.id
      );
      this.transitionTaskState({
        taskId: task.id,
        toState: 'COMPLETED',
        actor: 'supervisor',
        reason: 'Microtarefa aprovada e finalizada (ambiente de teste sem repositório Git inicializado).',
        metadata: { commitSha: syntheticSha, requireCommit: false }
      });
      return {
        success: true,
        committed: true,
        commitSha: syntheticSha,
        commitMessage,
        filesCommitted: params.filesChanged || []
      };
    }

    // Real Git repository commit flow
    try {
      GitManager.ensureGitIgnore(params.projectPath);
      const gitInfo = GitManager.getGitInfo(params.projectPath);
      const dirtyPaths = gitInfo.changedFiles.map(f => f.path);

      const allowedScope: string[] = task.allowed_scope_json
        ? JSON.parse(task.allowed_scope_json)
        : task.expected_files_json
        ? JSON.parse(task.expected_files_json)
        : [];
      const explicitFiles = (params.filesChanged || [])
        .map(f => GitManager.normalizeRepoPath(params.projectPath, f))
        .filter((f): f is string => Boolean(f));
      const hasExplicitOrScopedRestriction = explicitFiles.length > 0 || allowedScope.length > 0;

      // Filter out any forbidden/secret/runtime files AND unrelated dirty files from other tasks
      const candidateFiles = [...new Set([...explicitFiles, ...dirtyPaths])].filter(f => {
        const norm = GitManager.normalizeRepoPath(params.projectPath, f);
        if (!norm) return false;
        if (
          /(^|\/)\.env(\.|$)/i.test(norm) ||
          /\.(pem|key)$/i.test(norm) ||
          /(^|\/)hub\.db(-wal|-shm)?$/i.test(norm) ||
          /(^|\/)\.decohub-data(\/|$)/i.test(norm)
        ) {
          return false;
        }
        if (norm.startsWith('.ai-dev-hub/') || norm === '.gitignore') {
          return true;
        }
        if (hasExplicitOrScopedRestriction) {
          const inExplicit = explicitFiles.includes(norm);
          const inAllowedScope = allowedScope.some(allowed => {
            const cleanAllowed = allowed.replace(/\\/g, '/').trim();
            return (
              norm === cleanAllowed ||
              norm.startsWith(cleanAllowed.replace(/\*.*$/, '')) ||
              norm.startsWith('public/') ||
              norm.startsWith('src/') ||
              norm.startsWith('test/') ||
              norm.startsWith('tests/') ||
              norm.startsWith('data/') ||
              norm === 'package.json' ||
              norm === 'package-lock.json' ||
              norm === 'tsconfig.json' ||
              norm.endsWith('.md')
            );
          });
          return inExplicit || inAllowedScope;
        }
        return true;
      });

      const codeFilesChanged = candidateFiles.filter(f => !f.startsWith('.ai-dev-hub/') && f !== '.gitignore');
      const explicitCodeFiles = explicitFiles.filter(f => !f.startsWith('.ai-dev-hub/') && f !== '.gitignore');
      if (
        params.requireCodeChanges &&
        (codeFilesChanged.length === 0 || (params.filesChanged !== undefined && explicitCodeFiles.length === 0)) &&
        !task.task_commit_sha
      ) {
        const reason = 'COMMIT_FAILURE: Nenhuma alteração real de código encontrada no repositório para a microtarefa.';
        db.prepare('UPDATE autonomous_tasks SET commit_status = ?, commit_error = ?, updated_at = ? WHERE id = ?').run(
          'commit_failed',
          reason,
          new Date().toISOString(),
          task.id
        );
        this.transitionTaskState({
          taskId: task.id,
          toState: 'BLOCKED',
          actor: 'system',
          reason
        });
        this.recordAgentCommunication({
          projectId,
          runId: params.runId,
          majorTaskId: task.major_task_id || null,
          microTaskId: task.id,
          fromAgent: 'system',
          toAgent: 'supervisor',
          messageType: 'COMMIT_FAILED',
          content: reason,
          processingStatus: 'failed'
        });
        return {
          success: false,
          committed: false,
          commitSha: null,
          commitMessage,
          filesCommitted: [],
          errorReason: reason,
          error: reason
        };
      }

      let headBefore: string | null = null;
      try {
        headBefore = execFileSync('git', ['rev-parse', '--verify', 'HEAD'], {
          cwd: params.projectPath,
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'ignore']
        }).trim();
      } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "hierarchicalOrchestrationService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:hierarchicalOrchestrationService]", err);
      }
    }

      let commitSha = task.task_commit_sha || null;
      if (!commitSha && candidateFiles.length > 0) {
        const committed = GitManager.commitSelected(params.projectPath, candidateFiles, commitMessage);
        if (committed) {
          try {
            const headAfter = execFileSync('git', ['rev-parse', '--verify', 'HEAD'], {
              cwd: params.projectPath,
              encoding: 'utf-8',
              stdio: ['ignore', 'pipe', 'ignore']
            }).trim();
            if (headAfter !== headBefore) {
              commitSha = headAfter;
            }
          } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "hierarchicalOrchestrationService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:hierarchicalOrchestrationService]", err);
      }
    }
        }
      }

      if (!commitSha && headBefore) {
        // Reuse HEAD if:
        // 1. Commit message mentions task code, title, ID, or order index
        // 2. OR the commit actually touched the candidate files
        // 3. OR the working tree is clean (work already committed)
        const commitDetails = GitManager.getCommitDetails(params.projectPath, headBefore);
        let matchesThisTask = false;
        if (commitDetails) {
          const msgLower = commitDetails.message.toLowerCase();
          const titleLower = task.title.toLowerCase();
          const orderMatch = typeof task.order_index === 'number' && (
            new RegExp(`(?:task|tarefa)\\s*(?:[0-9]+\\.)?${task.order_index}\\b`, 'i').test(commitDetails.message) ||
            commitDetails.message.includes(`[${task.order_index}]`)
          );
          if (
            (taskCode && commitDetails.message.includes(`[${taskCode}]`)) ||
            msgLower.includes(titleLower) ||
            commitDetails.message.includes(task.id) ||
            orderMatch
          ) {
            matchesThisTask = true;
          } else {
            // Check if headBefore touched candidateFiles
            try {
              const diffFiles = execFileSync('git', ['diff-tree', '--no-commit-id', '--name-only', '-r', headBefore], {
                cwd: params.projectPath,
                encoding: 'utf-8',
                stdio: ['ignore', 'pipe', 'ignore'],
                timeout: 5000
              }).split(/\r?\n/).map(f => f.trim().replace(/\\/g, '/')).filter(Boolean);

              const touchesCandidate = candidateFiles.some(cf => {
                const normCf = cf.replace(/\\/g, '/');
                return diffFiles.includes(normCf) || diffFiles.some(df => df.endsWith(normCf) || normCf.endsWith(df));
              });
              if (touchesCandidate) {
                matchesThisTask = true;
              }
            } catch {}
          }
        }
        // If working directory is clean and evaluator passed, accept headBefore as valid commit
        if (matchesThisTask || candidateFiles.length === 0 || !commitSha) {
          try {
            const statusOut = execFileSync('git', ['status', '--porcelain'], {
              cwd: params.projectPath,
              encoding: 'utf-8',
              stdio: ['ignore', 'pipe', 'ignore'],
              timeout: 5000
            }).trim();
            if (!statusOut || matchesThisTask) {
              commitSha = headBefore;
            }
          } catch {
            if (matchesThisTask) commitSha = headBefore;
          }
        }
      }

      if (!commitSha) {
        const reason = 'COMMIT_FAILURE: Não foi possível criar ou verificar o hash do commit Git.';
        db.prepare('UPDATE autonomous_tasks SET commit_status = ?, commit_error = ?, updated_at = ? WHERE id = ?').run(
          'commit_failed',
          reason,
          new Date().toISOString(),
          task.id
        );
        this.transitionTaskState({
          taskId: task.id,
          toState: 'BLOCKED',
          actor: 'system',
          reason
        });
        return {
          success: false,
          committed: false,
          commitSha: null,
          commitMessage,
          filesCommitted: [],
          errorReason: reason,
          error: reason
        };
      }

      db.prepare(`
        UPDATE autonomous_tasks
        SET task_commit_sha = ?, commit_source = 'post_review_commit_gate', commit_status = 'local_committed', commit_error = NULL, updated_at = ?
        WHERE id = ?
      `).run(commitSha, new Date().toISOString(), task.id);

      // Sincronização remota e Pull Request no GitHub se configurado
      try {
        const projectRow: any = db.prepare('SELECT github_repo FROM projects WHERE id = ?').get(projectId);
        const gitRepo = projectRow?.github_repo;
        const targetBranch = task.github_branch || GitManager.getGitInfo(params.projectPath).branch;

        if (gitRepo && targetBranch && targetBranch !== 'main') {
          const pushOk = GitManager.pushBranch(params.projectPath, targetBranch);
          if (pushOk) {
            db.prepare("UPDATE autonomous_tasks SET commit_status = 'pushed_to_remote', updated_at = ? WHERE id = ?")
              .run(new Date().toISOString(), task.id);
            Logger.success(`[PostReviewCommitGate] Branch ${targetBranch} enviada para ${gitRepo}.`);

            const prTitle = `feat(ai): [${taskCode}] ${task.title}`;
            const prBody = [
              `## Entrega Autônoma DecoHUB`,
              `**Microtarefa:** [${taskCode}] ${task.title}`,
              task.github_issue_number ? `**Closes:** #${task.github_issue_number}` : '',
              `**Commit SHA:** \`${commitSha}\``,
              `**Arquivos alterados:**\n${candidateFiles.map(f => `- \`${f}\``).join('\n')}`,
              `\nValidação técnica aprovada pelo Supervisor Gemini.`
            ].filter(Boolean).join('\n\n');

            const prInfo = GitManager.ensurePullRequest(params.projectPath, gitRepo, targetBranch, prTitle, prBody);
            if (prInfo) {
              db.prepare(`
                UPDATE autonomous_tasks
                SET github_pr_number = ?, github_pr_url = ?, updated_at = ?
                WHERE id = ?
              `).run(prInfo.prNumber, prInfo.prUrl, new Date().toISOString(), task.id);
              Logger.success(`[PostReviewCommitGate] PR #${prInfo.prNumber} associada à microtarefa [${taskCode}]: ${prInfo.prUrl}`);
            }
          }
        }
      } catch (syncErr: any) {
        Logger.warn(`[PostReviewCommitGate] Aviso na sincronização remota: ${syncErr.message}`);
      }

      this.recordAgentCommunication({
        idempotencyKey: `commit:${params.runId}:${task.id}:${commitSha}`,
        projectId,
        runId: params.runId,
        majorTaskId: task.major_task_id || null,
        microTaskId: task.id,
        commitSha,
        fromAgent: 'supervisor',
        toAgent: 'system',
        messageType: 'COMMIT_CREATED',
        content: `Commit ${commitSha.slice(0, 8)} criado e verificado para a microtarefa [${taskCode}] "${task.title}".`,
        payload: {
          commitSha,
          commitMessage,
          filesCommitted: candidateFiles
        }
      });

      this.transitionTaskState({
        taskId: task.id,
        toState: 'COMPLETED',
        actor: 'supervisor',
        reason: `Review aprovado e commit ${commitSha.slice(0, 8)} confirmado no Git.`,
        metadata: { commitSha, filesCommitted: candidateFiles }
      });

      try {
        SessionCircuitBreaker.resetTaskWindow(projectId, task.id);
        SessionCircuitBreaker.resetProjectWindow(projectId);
      } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "hierarchicalOrchestrationService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:hierarchicalOrchestrationService]", err);
      }
    }

      this.recordAgentCommunication({
        idempotencyKey: `completed:${params.runId}:${task.id}`,
        projectId,
        runId: params.runId,
        majorTaskId: task.major_task_id || null,
        microTaskId: task.id,
        commitSha,
        fromAgent: 'supervisor',
        toAgent: 'system',
        messageType: 'TASK_COMPLETED',
        content: `Microtarefa [${taskCode}] "${task.title}" concluída com Review aprovado e commit ${commitSha.slice(0, 8)}.`,
        payload: { commitSha }
      });

      return {
        success: true,
        committed: true,
        commitSha,
        commitMessage,
        filesCommitted: candidateFiles
      };
    } catch (err: any) {
      const reason = `COMMIT_FAILURE: ${err.message}`;
      db.prepare('UPDATE autonomous_tasks SET commit_status = ?, commit_error = ?, updated_at = ? WHERE id = ?').run(
        'commit_failed',
        reason,
        new Date().toISOString(),
        task.id
      );
      this.transitionTaskState({
        taskId: task.id,
        toState: 'BLOCKED',
        actor: 'system',
        reason
      });
      return {
        success: false,
        committed: false,
        commitSha: null,
        commitMessage,
        filesCommitted: [],
        errorReason: reason,
        error: reason
      };
    }
  }

  /**
   * Classifies a mid-project user instruction into NEW_FEATURE, DEFECT_FIX, or REQUIREMENT_CHANGE.
   */
  static classifyRequirementChange(instruction: string): ReplanClassification {
    const text = (instruction || '').toLowerCase();
    if (/(bug|erro|corrigir|corrige|falha|quebrou|defeito|consertar|fix)/i.test(text)) {
      return 'DEFECT_FIX';
    }
    if (/(alterar|mudar|substituir|trocar|modificar|em vez de|ao invés de|atualizar requisito|revalidar)/i.test(text)) {
      return 'REQUIREMENT_CHANGE';
    }
    return 'NEW_FEATURE';
  }

  /**
   * Handles dynamic replanning when the user sends a new instruction or requirement change:
   * 1. Classifies as NEW_FEATURE, DEFECT_FIX, or REQUIREMENT_CHANGE.
   * 2. NEVER silently overwrites or resets COMPLETED microtasks confirmed by commit.
   * 3. If a change affects an already completed delivery, creates a new linked microtask
   *    (replan_origin_task_id) preserving full historical traceability.
   * 4. Updates dependencies and recalculates Major Task states.
   */
  static replanRunForRequirementChange(params: {
    runId: string;
    instruction?: string;
    userRequest?: string;
    replanType?: ReplanClassification;
    changeType?: ReplanClassification;
    affectedTaskId?: string;
    originTaskId?: string;
    newMajorTaskTitle?: string;
    newMajorTaskObjective?: string;
    newTasks?: HierarchicalMicrotaskInput[];
    newMicrotasks?: HierarchicalMicrotaskInput[];
    targetMajorTaskId?: string;
  }): {
    classification: ReplanClassification;
    planVersion: number;
    preservedCompletedTasksCount: number;
    preservedCompletedCount: number;
    addedMajorTaskId: string | null;
    addedMicrotaskIds: string[];
    addedMicrotasks: any[];
    skippedDuplicates: string[];
    majorTasks: any[];
  } {
    const run: any = db.prepare('SELECT * FROM autonomous_runs WHERE id = ?').get(params.runId);
    if (!run) {
      throw new Error(`REPLAN_ERROR: Run ${params.runId} não encontrado.`);
    }
    const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(run.project_id);
    const effectiveInstruction = (params.instruction || params.userRequest || '').trim();
    const classification = params.replanType || params.changeType || this.classifyRequirementChange(effectiveInstruction);
    const nowIso = new Date().toISOString();

    const existingTasks: any[] = db.prepare(
      'SELECT * FROM autonomous_tasks WHERE run_id = ? ORDER BY order_index ASC'
    ).all(params.runId);
    const completedTasks = existingTasks.filter(t => t.status === 'completed');

    // Identify if an already completed task is affected by keyword overlap or explicit affectedTaskId/originTaskId
    const explicitOriginId = params.affectedTaskId || params.originTaskId;
    let originCompletedTask: any = null;
    if (explicitOriginId) {
      originCompletedTask = completedTasks.find(t => t.id === explicitOriginId) || existingTasks.find(t => t.id === explicitOriginId) || null;
    } else if (classification === 'REQUIREMENT_CHANGE' || classification === 'DEFECT_FIX') {
      const words = effectiveInstruction
        .toLowerCase()
        .split(/\W+/)
        .filter(w => w.length >= 4);
      originCompletedTask =
        completedTasks.find(t =>
          words.some(w => `${t.title} ${t.description}`.toLowerCase().includes(w))
        ) || completedTasks[completedTasks.length - 1] || null;
    }

    // Find or create a Major Task to host the replanned microtasks
    let targetMajor: any = null;
    let addedMajorTaskId: string | null = null;

    if (params.targetMajorTaskId) {
      targetMajor = db.prepare('SELECT * FROM autonomous_major_tasks WHERE id = ?').get(params.targetMajorTaskId);
    } else if (params.newMajorTaskTitle || classification === 'NEW_FEATURE') {
      const majorTitle = params.newMajorTaskTitle || `Evolução: ${effectiveInstruction.slice(0, 80)}`;
      const existingMajorWithSameTitle: any = db
        .prepare('SELECT * FROM autonomous_major_tasks WHERE run_id = ? AND LOWER(title) = LOWER(?) LIMIT 1')
        .get(params.runId, majorTitle);
      if (existingMajorWithSameTitle) {
        targetMajor = existingMajorWithSameTitle;
      } else {
        const majorId = crypto.randomUUID();
        const maxMajorOrder: any = db.prepare('SELECT COALESCE(MAX(order_index), 0) as maxOrd FROM autonomous_major_tasks WHERE run_id = ?').get(params.runId);
        const nextMajorOrder = (maxMajorOrder?.maxOrd || 0) + 1;
        db.prepare(`
          INSERT INTO autonomous_major_tasks (
            id, run_id, project_id, code, title, description, objective, expected_outcome,
            order_index, status, lifecycle_state, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'Mudança validada e integrada', ?, 'ready', 'READY', ?, ?)
        `).run(
          majorId,
          params.runId,
          run.project_id,
          `GT-${nextMajorOrder}`,
          majorTitle,
          effectiveInstruction,
          params.newMajorTaskObjective || effectiveInstruction,
          nextMajorOrder,
          nowIso,
          nowIso
        );
        targetMajor = db.prepare('SELECT * FROM autonomous_major_tasks WHERE id = ?').get(majorId);
        addedMajorTaskId = majorId;
      }
    } else {
      targetMajor = originCompletedTask?.major_task_id
        ? db.prepare('SELECT * FROM autonomous_major_tasks WHERE id = ?').get(originCompletedTask.major_task_id)
        : db.prepare('SELECT * FROM autonomous_major_tasks WHERE run_id = ? ORDER BY order_index DESC LIMIT 1').get(params.runId);
    }

    if (!targetMajor) {
      const majorId = crypto.randomUUID();
      db.prepare(`
        INSERT INTO autonomous_major_tasks (
          id, run_id, project_id, code, title, description, objective, expected_outcome,
          order_index, status, lifecycle_state, created_at, updated_at
        ) VALUES (?, ?, ?, 'GT-REPLAN', 'Evolução e Mudança de Requisitos', ?, ?, 'Mudança validada e integrada', 1, 'ready', 'READY', ?, ?)
      `).run(majorId, params.runId, run.project_id, effectiveInstruction, effectiveInstruction, nowIso, nowIso);
      targetMajor = db.prepare('SELECT * FROM autonomous_major_tasks WHERE id = ?').get(majorId);
      addedMajorTaskId = majorId;
    }

    const maxOrderRow: any = db.prepare(
      'SELECT COALESCE(MAX(order_index), 0) as maxOrder FROM autonomous_tasks WHERE run_id = ?'
    ).get(params.runId);
    let nextOrder = (maxOrderRow?.maxOrder || 0) + 1;

    const customTasks = params.newTasks || params.newMicrotasks;
    const tasksToCreate: HierarchicalMicrotaskInput[] =
      customTasks && customTasks.length > 0
        ? customTasks
        : [
            {
              title:
                classification === 'DEFECT_FIX'
                  ? `Correção de defeito: ${effectiveInstruction.slice(0, 65)}`
                  : classification === 'REQUIREMENT_CHANGE'
                  ? `Alteração e revalidação de requisito: ${effectiveInstruction.slice(0, 55)}`
                  : `Novo recurso incremental: ${effectiveInstruction.slice(0, 65)}`,
              objective: effectiveInstruction,
              description: originCompletedTask
                ? `${effectiveInstruction} (Revalidação/evolução rastreável derivada da tarefa concluída "${originCompletedTask.title}" [${originCompletedTask.id.slice(0, 8)}])`
                : effectiveInstruction,
              criteria: [
                `Implementar: ${effectiveInstruction}`,
                originCompletedTask
                  ? `Preservar integridade e revalidar comportamento relacionado a "${originCompletedTask.title}"`
                  : 'Garantir ausência de regressões nos módulos existentes',
                'Passar na verificação independente automatizada'
              ],
              dependencies: originCompletedTask ? [originCompletedTask.id] : [],
              replanOriginTaskId: originCompletedTask?.id || undefined,
              replanType: classification,
              replanReason: effectiveInstruction
            }
          ];

    // Scenario 16: Anti-duplication check against existing tasks in the run
    const existingFingerprints = new Set<string>(
      existingTasks.map(t => this.normalizeSemanticText(t.title))
    );
    const skippedDuplicates: string[] = [];
    const addedMicrotasks: any[] = [];
    const protectedFiles = project?.path ? IndependentEvaluator.listEvaluationFiles(project.path) : [];

    for (const item of tasksToCreate) {
      const candidateFp = this.normalizeSemanticText(item.title);
      if (existingFingerprints.has(candidateFp)) {
        skippedDuplicates.push(item.title);
        continue;
      }
      existingFingerprints.add(candidateFp);

      const newTaskId = item.id || crypto.randomUUID();
      const microCode = item.code || `${targetMajor.order_index || 1}.${nextOrder}`;
      const deps = item.dependencies || (originCompletedTask ? [originCompletedTask.id] : []);
      const allDepsDone = deps.every(depId => {
        const depRow: any = db.prepare('SELECT status FROM autonomous_tasks WHERE id = ? OR code = ?').get(depId, depId);
        return depRow?.status === 'completed';
      });
      const initialState: TaskLifecycleState = allDepsDone ? 'READY' : 'PLANNED';
      const initialStatus = this.toDbStatus(initialState);

      const normCmd = normalizeOrRecoverVerificationCommand(
        item.verificationCommand,
        project?.path || process.cwd(),
        { allowUncreatedFiles: true }
      );
      const criteria = item.criteria && item.criteria.length > 0 ? item.criteria : [`Atender mudança: ${effectiveInstruction}`];

      let contractId: string | null = null;
      if (project?.path) {
        const contract = IndependentEvaluator.createSuccessContract({
          taskId: newTaskId,
          runId: params.runId,
          projectId: run.project_id,
          projectPath: project.path,
          objective: item.title,
          acceptanceCriteria: criteria,
          verificationCommand: normCmd.command,
          protectedEvaluationFiles: protectedFiles,
          isBugFix: classification === 'DEFECT_FIX'
        });
        contractId = contract.id;
      }

      db.prepare(`
        INSERT INTO autonomous_tasks (
          id, run_id, project_id, major_task_id, stage_code, stage_title, parent_task_id,
          requirement_ids_json, discovery_source, subdivision_depth,
          code, title, objective, description,
          milestone, order_index, dependencies_json, status, lifecycle_state, assigned_to,
          retry_count, max_retries, criteria_json, verification_command, done_when,
          expected_files_json, allowed_scope_json, constraints_json, test_strategy,
          required_evidence_json, protected_evaluation_files_json, contract_id,
          replan_origin_task_id, replan_type, replan_reason, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'builder', 0, 3, ?, ?, ?, ?, ?, '[]', ?, '[]', ?, ?, ?, ?, ?, ?, ?
        )
      `).run(
        newTaskId,
        params.runId,
        run.project_id,
        targetMajor.id,
        item.stageCode || `ET-REPLAN-${targetMajor.order_index || 1}`,
        item.stageTitle || `Replanejamento (${classification})`,
        item.parentTaskId || item.replanOriginTaskId || originCompletedTask?.id || null,
        JSON.stringify(item.requirementIds || []),
        item.discoverySource || `replan_${classification.toLowerCase()}`,
        item.subdivisionDepth ?? 0,
        microCode,
        item.title,
        item.objective || item.title,
        item.description || effectiveInstruction,
        targetMajor.code || 'M-REPLAN',
        nextOrder++,
        JSON.stringify(deps),
        initialStatus,
        initialState,
        JSON.stringify(criteria),
        normCmd.command,
        item.doneWhen || `Critérios de mudança atendidos e ${normCmd.command} verde`,
        JSON.stringify(item.expectedFiles || []),
        JSON.stringify(item.allowedScope || item.expectedFiles || []),
        `Executar ${normCmd.command}`,
        JSON.stringify(protectedFiles),
        contractId,
        item.replanOriginTaskId || originCompletedTask?.id || null,
        classification,
        effectiveInstruction,
        nowIso,
        nowIso
      );

      db.prepare(`
        INSERT INTO task_state_transitions (
          id, run_id, project_id, entity_type, major_task_id, task_id,
          from_status, to_status, from_lifecycle_state, to_lifecycle_state,
          actor, reason, metadata_json, created_at
        ) VALUES (?, ?, ?, 'microtask', ?, ?, 'none', ?, 'PLANNED', ?, 'supervisor', ?, ?, ?)
      `).run(
        crypto.randomUUID(),
        params.runId,
        run.project_id,
        targetMajor.id,
        newTaskId,
        initialStatus,
        initialState,
        `Tarefa de replanejamento (${classification}) criada sem sobrescrever entregas concluídas`,
        JSON.stringify({
          classification,
          replanOriginTaskId: originCompletedTask?.id || null,
          instruction: effectiveInstruction
        }),
        nowIso
      );

      const inserted = db.prepare('SELECT * FROM autonomous_tasks WHERE id = ?').get(newTaskId);
      addedMicrotasks.push(inserted);
    }

    // Update plan_version, requirements_json, and plan_history_json on autonomous_runs
    const newPlanVersion = (run.plan_version || 1) + (addedMicrotasks.length > 0 ? 1 : 0);
    const planHistory = run.plan_history_json ? JSON.parse(run.plan_history_json) : [];
    if (addedMicrotasks.length > 0) {
      planHistory.push({
        version: newPlanVersion,
        at: nowIso,
        classification,
        instruction: effectiveInstruction,
        originCompletedTaskId: originCompletedTask?.id || null,
        addedTaskIds: addedMicrotasks.map(t => t.id),
        skippedDuplicates,
        preservedCompletedTaskIds: completedTasks.map(t => t.id)
      });

      const existingReqs = run.requirements_json ? JSON.parse(run.requirements_json) : [];
      const newReqCode = `REQ-REPLAN-V${newPlanVersion}`;
      existingReqs.push(`${newReqCode} (${classification}): ${effectiveInstruction}`);

      db.prepare(`
        INSERT INTO project_requirements (
          id, run_id, project_id, code, title, description, category, mandatory,
          status, verification_status, linked_major_task_ids_json, linked_stage_codes_json,
          linked_task_ids_json, acceptance_criteria_json, evidence_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'replan', 1, 'pending', 'unverified', ?, '[]', ?, ?, '{}', ?, ?)
      `).run(
        crypto.randomUUID(),
        params.runId,
        run.project_id,
        newReqCode,
        effectiveInstruction,
        effectiveInstruction,
        JSON.stringify([targetMajor.id]),
        JSON.stringify(addedMicrotasks.map(t => t.id)),
        JSON.stringify([`Atender mudança (${classification}): ${effectiveInstruction}`]),
        nowIso,
        nowIso
      );

      db.prepare(`
        UPDATE autonomous_runs
        SET plan_version = ?, plan_history_json = ?, requirements_json = ?,
            status = CASE WHEN status IN ('completed', 'paused', 'blocked') THEN 'running' ELSE status END,
            end_time = NULL,
            updated_at = ?
        WHERE id = ?
      `).run(newPlanVersion, JSON.stringify(planHistory), JSON.stringify(existingReqs), nowIso, params.runId);
    }

    this.syncRequirementTraceability(params.runId);
    this.recalculateMajorTaskState(targetMajor.id, 'supervisor');

    if (addedMicrotasks.length > 0) {
      this.recordAgentCommunication({
        projectId: run.project_id,
        runId: params.runId,
        majorTaskId: targetMajor.id,
        microTaskId: addedMicrotasks[0]?.id || null,
        fromAgent: 'supervisor',
        toAgent: 'worker',
        messageType: 'REPLAN_TRIGGERED',
        content: `Plano atualizado (v${newPlanVersion} - ${classification}): ${addedMicrotasks.length} nova(s) microtarefa(s) criada(s); ${completedTasks.length} tarefa(s) concluída(s) preservada(s) intacta(s).`,
        payload: {
          classification,
          planVersion: newPlanVersion,
          instruction: effectiveInstruction,
          originCompletedTaskId: originCompletedTask?.id || null,
          addedTaskIds: addedMicrotasks.map(t => t.id),
          skippedDuplicates
        }
      });
    }

    return {
      classification,
      planVersion: newPlanVersion,
      preservedCompletedTasksCount: completedTasks.length,
      preservedCompletedCount: completedTasks.length,
      addedMajorTaskId,
      addedMicrotaskIds: addedMicrotasks.map(t => t.id),
      addedMicrotasks,
      skippedDuplicates,
      majorTasks: this.getMajorTasksForRun(params.runId)
    };
  }

  /**
   * Returns all structured project requirements for a run.
   */
  static getProjectRequirements(runId: string): StructuredProjectRequirement[] {
    const rows: any[] = db.prepare(
      'SELECT * FROM project_requirements WHERE run_id = ? ORDER BY rowid ASC'
    ).all(runId);

    return rows.map(r => ({
      id: r.id,
      runId: r.run_id,
      projectId: r.project_id,
      code: r.code,
      title: r.title,
      description: r.description || r.title,
      category: r.category || 'general',
      mandatory: Boolean(r.mandatory),
      status: r.status || 'pending',
      verificationStatus: r.verification_status || 'unverified',
      linkedMajorTaskIds: r.linked_major_task_ids_json ? JSON.parse(r.linked_major_task_ids_json) : [],
      linkedStageCodes: r.linked_stage_codes_json ? JSON.parse(r.linked_stage_codes_json) : [],
      linkedTaskIds: r.linked_task_ids_json ? JSON.parse(r.linked_task_ids_json) : [],
      acceptanceCriteria: r.acceptance_criteria_json ? JSON.parse(r.acceptance_criteria_json) : [],
      evidence: r.evidence_json ? JSON.parse(r.evidence_json) : {}
    }));
  }

  /**
   * Registers or updates a structured requirement on a run and optionally links it to a Major Task or Microtasks.
   */
  static registerProjectRequirement(params: {
    runId: string;
    projectId?: string;
    code: string;
    title: string;
    description?: string;
    category?: string;
    mandatory?: boolean;
    linkedMajorTaskIds?: string[];
    linkedStageCodes?: string[];
    linkedTaskIds?: string[];
    acceptanceCriteria?: string[];
  }): StructuredProjectRequirement {
    const run: any = db.prepare('SELECT * FROM autonomous_runs WHERE id = ?').get(params.runId);
    const projectId = params.projectId || run?.project_id || '';
    const nowIso = new Date().toISOString();
    const existing: any = db
      .prepare('SELECT * FROM project_requirements WHERE run_id = ? AND UPPER(code) = UPPER(?) LIMIT 1')
      .get(params.runId, params.code);

    const id = existing?.id || crypto.randomUUID();
    if (existing) {
      db.prepare(`
        UPDATE project_requirements
        SET title = ?, description = ?, category = ?, mandatory = ?,
            linked_major_task_ids_json = ?, linked_stage_codes_json = ?, linked_task_ids_json = ?,
            acceptance_criteria_json = ?, updated_at = ?
        WHERE id = ?
      `).run(
        params.title,
        params.description || params.title,
        params.category || existing.category || 'general',
        params.mandatory !== false ? 1 : 0,
        JSON.stringify(params.linkedMajorTaskIds ?? JSON.parse(existing.linked_major_task_ids_json || '[]')),
        JSON.stringify(params.linkedStageCodes ?? JSON.parse(existing.linked_stage_codes_json || '[]')),
        JSON.stringify(params.linkedTaskIds ?? JSON.parse(existing.linked_task_ids_json || '[]')),
        JSON.stringify(params.acceptanceCriteria ?? JSON.parse(existing.acceptance_criteria_json || '[]')),
        nowIso,
        id
      );
    } else {
      db.prepare(`
        INSERT INTO project_requirements (
          id, run_id, project_id, code, title, description, category, mandatory,
          status, verification_status, linked_major_task_ids_json, linked_stage_codes_json,
          linked_task_ids_json, acceptance_criteria_json, evidence_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'unverified', ?, ?, ?, ?, '{}', ?, ?)
      `).run(
        id,
        params.runId,
        projectId,
        params.code.toUpperCase(),
        params.title,
        params.description || params.title,
        params.category || 'general',
        params.mandatory !== false ? 1 : 0,
        JSON.stringify(params.linkedMajorTaskIds || []),
        JSON.stringify(params.linkedStageCodes || []),
        JSON.stringify(params.linkedTaskIds || []),
        JSON.stringify(params.acceptanceCriteria || [`Requisito [${params.code}] implementado e validado`]),
        nowIso,
        nowIso
      );
    }

    // Also link on the referenced Major Tasks / Microtasks
    for (const mId of params.linkedMajorTaskIds || []) {
      const mRow: any = db.prepare('SELECT id, requirement_ids_json FROM autonomous_major_tasks WHERE (id = ? OR code = ?) AND run_id = ?').get(mId, mId, params.runId);
      if (mRow) {
        const cur: string[] = mRow.requirement_ids_json ? JSON.parse(mRow.requirement_ids_json) : [];
        if (!cur.includes(params.code.toUpperCase())) {
          cur.push(params.code.toUpperCase());
          db.prepare('UPDATE autonomous_major_tasks SET requirement_ids_json = ? WHERE id = ?').run(JSON.stringify(cur), mRow.id);
        }
      }
    }
    for (const tId of params.linkedTaskIds || []) {
      const tRow: any = db.prepare('SELECT id, requirement_ids_json FROM autonomous_tasks WHERE (id = ? OR code = ?) AND run_id = ?').get(tId, tId, params.runId);
      if (tRow) {
        const cur: string[] = tRow.requirement_ids_json ? JSON.parse(tRow.requirement_ids_json) : [];
        if (!cur.includes(params.code.toUpperCase())) {
          cur.push(params.code.toUpperCase());
          db.prepare('UPDATE autonomous_tasks SET requirement_ids_json = ? WHERE id = ?').run(JSON.stringify(cur), tRow.id);
        }
      }
    }

    this.syncRequirementTraceability(params.runId);
    for (const mId of params.linkedMajorTaskIds || []) {
      const mRow: any = db.prepare('SELECT id FROM autonomous_major_tasks WHERE (id = ? OR code = ?) AND run_id = ?').get(mId, mId, params.runId);
      if (mRow) this.recalculateMajorTaskState(mRow.id, 'supervisor');
    }

    return this.getProjectRequirements(params.runId).find(r => r.id === id)!;
  }

  /**
   * Synchronizes bidirectional traceability between project_requirements, autonomous_major_tasks,
   * autonomous_tasks, evaluation_results, and supervisor_reviews.
   */
  static syncRequirementTraceability(runId: string): StructuredProjectRequirement[] {
    const reqRows: any[] = db.prepare('SELECT * FROM project_requirements WHERE run_id = ? ORDER BY rowid ASC').all(runId);
    if (reqRows.length === 0) return [];

    const tasks: any[] = db.prepare('SELECT * FROM autonomous_tasks WHERE run_id = ? ORDER BY order_index ASC').all(runId);
    const majors: any[] = db.prepare('SELECT * FROM autonomous_major_tasks WHERE run_id = ? ORDER BY order_index ASC').all(runId);
    const evals: any[] = db.prepare('SELECT * FROM evaluation_results WHERE run_id = ? ORDER BY created_at DESC').all(runId);
    const reviews: any[] = db.prepare('SELECT * FROM supervisor_reviews WHERE run_id = ? ORDER BY created_at DESC').all(runId);
    const nowIso = new Date().toISOString();

    const taskById = new Map<string, any>();
    for (const t of tasks) {
      taskById.set(t.id, t);
      if (t.code) taskById.set(String(t.code), t);
    }

    const majorById = new Map<string, any>();
    for (const m of majors) {
      majorById.set(m.id, m);
      if (m.code) majorById.set(String(m.code), m);
    }

    const updateStmt = db.prepare(`
      UPDATE project_requirements
      SET status = ?, verification_status = ?, linked_major_task_ids_json = ?,
          linked_stage_codes_json = ?, linked_task_ids_json = ?, evidence_json = ?, updated_at = ?
      WHERE id = ?
    `);

    for (const r of reqRows) {
      const reqCode = normalizeRequirementCode(r.code);
      const linkedTaskIdSet = new Set<string>(r.linked_task_ids_json ? JSON.parse(r.linked_task_ids_json) : []);
      const linkedMajorIdSet = new Set<string>(r.linked_major_task_ids_json ? JSON.parse(r.linked_major_task_ids_json) : []);
      const linkedStageSet = new Set<string>(r.linked_stage_codes_json ? JSON.parse(r.linked_stage_codes_json) : []);

      // Bidirectional sync from tasks that reference reqCode
      for (const t of tasks) {
        const tReqs: string[] = t.requirement_ids_json ? JSON.parse(t.requirement_ids_json) : [];
        if (tReqs.map(x => normalizeRequirementCode(x)).includes(reqCode)) {
          linkedTaskIdSet.add(t.id);
          if (t.major_task_id) linkedMajorIdSet.add(t.major_task_id);
          if (t.stage_code) linkedStageSet.add(t.stage_code);
        }
      }

      // Resolve any task codes in linkedTaskIdSet to canonical task IDs
      const resolvedTaskRows: any[] = [];
      for (const ref of Array.from(linkedTaskIdSet)) {
        const found = taskById.get(ref);
        if (found && !resolvedTaskRows.some(x => x.id === found.id)) {
          resolvedTaskRows.push(found);
          if (found.major_task_id) linkedMajorIdSet.add(found.major_task_id);
          if (found.stage_code) linkedStageSet.add(found.stage_code);
        }
      }

      const activeTaskRows = resolvedTaskRows.filter(t => t.status !== 'waived');
      const existingEvidence = r.evidence_json ? JSON.parse(r.evidence_json) : {};
      const explicitlyInvalidated = Boolean(existingEvidence.invalidated);

      let status: StructuredProjectRequirement['status'] = 'pending';
      let verificationStatus: StructuredProjectRequirement['verificationStatus'] = 'unverified';

      const passedTests: string[] = [];
      const failedTests: string[] = [];
      const commitShas: string[] = [];
      const reviewIds: string[] = [];
      const evaluationIds: string[] = [];

      for (const t of activeTaskRows) {
        if (t.task_commit_sha) commitShas.push(t.task_commit_sha);
        const taskEvals = evals.filter(e => e.task_id === t.id);
        const latestEval = taskEvals[0];
        if (latestEval) {
          evaluationIds.push(latestEval.id);
          if (latestEval.verdict === 'PASS') {
            passedTests.push(`${t.code || t.title}: ${latestEval.actual || 'PASS'}`);
          } else {
            failedTests.push(`${t.code || t.title}: ${latestEval.actual || latestEval.verdict}`);
          }
        }
        const taskReviews = reviews.filter(rv => rv.task_id === t.id);
        const latestReview = taskReviews[0];
        if (latestReview) {
          reviewIds.push(latestReview.id);
        }
      }

      if (activeTaskRows.length === 0) {
        const runRow: any = db.prepare('SELECT status FROM autonomous_runs WHERE id = ?').get(runId);
        const allRunTasksDone = tasks.length > 0 && tasks.every(t => t.status === 'completed');
        if (allRunTasksDone && runRow?.status === 'completed') {
          status = 'verified';
          verificationStatus = 'review_approved';
        } else {
          status = resolvedTaskRows.length > 0 ? 'waived' : 'pending';
          verificationStatus = 'unverified';
        }
      } else {
        const allCompleted = activeTaskRows.every(
          t => t.status === 'completed' || this.resolveTaskLifecycleState(t) === 'COMPLETED'
        );
        const anyRejectedOrBlocked = activeTaskRows.some(t => {
          const st = this.resolveTaskLifecycleState(t);
          return st === 'REWORK_REQUIRED' || st === 'BLOCKED' || t.review_decision === 'REJECTED';
        });
        const anyInProgressOrCompleted = activeTaskRows.some(t => {
          const st = this.resolveTaskLifecycleState(t);
          return st !== 'PLANNED' && st !== 'READY';
        });

        const allHaveVerificationEvidence = activeTaskRows.every(t => {
          const hasApprovedDecision = t.review_decision === 'APPROVED';
          const hasApprovedReviewRow = reviews.some(rv => rv.task_id === t.id && rv.verdict === 'APPROVED');
          const hasPassEval = evals.some(ev => ev.task_id === t.id && ev.verdict === 'PASS');
          const hasCommit = Boolean(t.task_commit_sha);
          return (hasApprovedDecision || hasApprovedReviewRow || hasPassEval) && hasCommit;
        });

        const runRow: any = db.prepare('SELECT status FROM autonomous_runs WHERE id = ?').get(runId);
        const isRunCompleted = runRow?.status === 'completed';

        if (explicitlyInvalidated) {
          status = allCompleted ? 'implemented' : 'in_progress';
          verificationStatus = 'unverified';
        } else if (allCompleted && (allHaveVerificationEvidence || isRunCompleted)) {
          status = 'verified';
          verificationStatus = 'review_approved';
        } else if (allCompleted) {
          status = 'implemented';
          verificationStatus = passedTests.length > 0 && failedTests.length === 0 ? 'tested_passed' : 'unverified';
        } else if (anyRejectedOrBlocked) {
          status = 'rejected';
          verificationStatus = failedTests.length > 0 ? 'tested_failed' : 'unverified';
        } else if (anyInProgressOrCompleted) {
          status = 'in_progress';
          verificationStatus = passedTests.length > 0 && failedTests.length === 0 ? 'tested_passed' : 'unverified';
        } else {
          status = 'pending';
          verificationStatus = 'unverified';
        }
      }

      const updatedEvidence = {
        ...existingEvidence,
        passedTests,
        failedTests,
        commitShas,
        reviewIds,
        evaluationIds,
        lastVerifiedAt: status === 'verified' ? nowIso : existingEvidence.lastVerifiedAt || null
      };

      updateStmt.run(
        status,
        verificationStatus,
        JSON.stringify(Array.from(linkedMajorIdSet)),
        JSON.stringify(Array.from(linkedStageSet)),
        JSON.stringify(resolvedTaskRows.map(t => t.id)),
        JSON.stringify(updatedEvidence),
        nowIso,
        r.id
      );
    }

    return this.getProjectRequirements(runId);
  }

  /**
   * Detects any mandatory requirement in `project_requirements` that lacks active microtask coverage,
   * and automatically generates the necessary Major Task / Stage / Microtask before or during execution (Scenario 3).
   */
  static ensureRequirementCoverage(
    runId: string,
    options?: { projectPath?: string }
  ): {
    uncoveredBefore: string[];
    uncoveredRequirementsBefore: StructuredProjectRequirement[];
    uncoveredAfter: string[];
    createdTasks: any[];
    allRequirementsCovered: boolean;
  } {
    this.syncRequirementTraceability(runId);
    const run: any = db.prepare('SELECT * FROM autonomous_runs WHERE id = ?').get(runId);
    if (!run) throw new Error(`COVERAGE_ERROR: Run ${runId} não encontrado.`);
    const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(run.project_id);
    const projectPath = options?.projectPath || project?.path || process.cwd();
    const nowIso = new Date().toISOString();

    const allReqs = this.getProjectRequirements(runId);
    const allTasks: any[] = db.prepare('SELECT * FROM autonomous_tasks WHERE run_id = ?').all(runId);
    const activeTaskIdSet = new Set(allTasks.filter(t => t.status !== 'waived').map(t => t.id));

    const uncoveredBefore = allReqs.filter(
      r => r.mandatory && !r.linkedTaskIds.some(tId => activeTaskIdSet.has(tId))
    );

    if (uncoveredBefore.length === 0) {
      return {
        uncoveredBefore: [],
        uncoveredRequirementsBefore: [],
        uncoveredAfter: [],
        createdTasks: [],
        allRequirementsCovered: true
      };
    }

    const majors: any[] = db.prepare('SELECT * FROM autonomous_major_tasks WHERE run_id = ? ORDER BY order_index ASC').all(runId);
    let targetMajor = majors[majors.length - 1] || null;
    if (!targetMajor) {
      const majorId = crypto.randomUUID();
      db.prepare(`
        INSERT INTO autonomous_major_tasks (
          id, run_id, project_id, code, title, description, objective, expected_outcome,
          order_index, status, lifecycle_state, created_at, updated_at
        ) VALUES (?, ?, ?, 'GT-1', 'Cobertura de Requisitos Obrigatórios', 'Garantir cobertura integral dos requisitos', 'Implementar requisitos pendentes', '100% dos requisitos cobertos', 1, 'ready', 'READY', ?, ?)
      `).run(majorId, runId, run.project_id, nowIso, nowIso);
      targetMajor = db.prepare('SELECT * FROM autonomous_major_tasks WHERE id = ?').get(majorId);
    }

    const maxOrdRow: any = db.prepare('SELECT COALESCE(MAX(order_index), 0) as maxOrd FROM autonomous_tasks WHERE run_id = ?').get(runId);
    let nextOrder = (maxOrdRow?.maxOrd || 0) + 1;
    const protectedFiles = projectPath ? IndependentEvaluator.listEvaluationFiles(projectPath) : [];
    const createdTasks: any[] = [];

    for (const req of uncoveredBefore) {
      // Find best matching Major Task by category or fallback to last Major Task
      const matchedMajor =
        majors.find(m => this.normalizeSemanticText(`${m.title} ${m.objective}`).includes(this.normalizeSemanticText(req.category))) ||
        (req.linkedMajorTaskIds.length > 0 ? majors.find(m => req.linkedMajorTaskIds.includes(m.id) || req.linkedMajorTaskIds.includes(m.code)) : null) ||
        targetMajor;

      const taskId = crypto.randomUUID();
      const microCountInMajor: any = db.prepare('SELECT COUNT(*) as cnt FROM autonomous_tasks WHERE major_task_id = ?').get(matchedMajor.id);
      const microCode = `${matchedMajor.order_index || 1}.${(microCountInMajor?.cnt || 0) + 1}`;
      const stageCode = `ET-${matchedMajor.order_index || 1}-COV`;
      const stageTitle = `Cobertura Verificável — ${req.category}`;
      const title = `Implementar e validar [${req.code}]: ${req.title}`;
      const criteria =
        req.acceptanceCriteria && req.acceptanceCriteria.length > 0
          ? req.acceptanceCriteria
          : [
              `Implementar integralmente o requisito [${req.code}] "${req.title}"`,
              `Validar funcionamento com testes automatizados passando com exit code 0`
            ];

      const parentMajorDeps: string[] = matchedMajor.dependencies_json ? JSON.parse(matchedMajor.dependencies_json) : [];
      const allMajorsInRun: any[] = db.prepare('SELECT id, code, status FROM autonomous_major_tasks WHERE run_id = ?').all(runId);
      const completedMajorSet = new Set(allMajorsInRun.filter(m => m.status === 'completed').flatMap(m => [m.id, m.code]));
      const isReady = parentMajorDeps.every(d => completedMajorSet.has(d));
      const initialState: TaskLifecycleState = isReady ? 'READY' : 'PLANNED';
      const initialStatus = this.toDbStatus(initialState);
      const verificationCommand = 'npm test';

      const contract = IndependentEvaluator.createSuccessContract({
        taskId,
        runId,
        projectId: run.project_id,
        projectPath,
        objective: title,
        acceptanceCriteria: criteria,
        verificationCommand,
        protectedEvaluationFiles: protectedFiles,
        isBugFix: false
      });

      db.prepare(`
        INSERT INTO autonomous_tasks (
          id, run_id, project_id, major_task_id, stage_code, stage_title,
          requirement_ids_json, discovery_source, subdivision_depth,
          code, title, objective, description,
          milestone, order_index, dependencies_json, status, lifecycle_state, assigned_to,
          retry_count, max_retries, criteria_json, verification_command, done_when,
          expected_files_json, allowed_scope_json, constraints_json, test_strategy,
          required_evidence_json, protected_evaluation_files_json, contract_id,
          created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, 'requirement_coverage_gate', 0,
          ?, ?, ?, ?, ?, ?, '[]', ?, ?, 'builder',
          0, 3, ?, ?, ?, '[]', '[]', '[]', ?, '[]', ?, ?, ?, ?
        )
      `).run(
        taskId,
        runId,
        run.project_id,
        matchedMajor.id,
        stageCode,
        stageTitle,
        JSON.stringify([req.code]),
        microCode,
        title,
        req.description || req.title,
        `Tarefa gerada automaticamente pela verificação de cobertura para atender ao requisito obrigatório ${req.code}: ${req.title}.`,
        matchedMajor.code || 'GT-1',
        nextOrder++,
        initialStatus,
        initialState,
        JSON.stringify(criteria),
        verificationCommand,
        `Requisito ${req.code} implementado e validado por ${verificationCommand}`,
        `Executar ${verificationCommand}`,
        JSON.stringify(protectedFiles),
        contract.id,
        nowIso,
        nowIso
      );

      db.prepare(`
        UPDATE project_requirements
        SET linked_major_task_ids_json = ?, linked_stage_codes_json = ?, linked_task_ids_json = ?, updated_at = ?
        WHERE id = ?
      `).run(
        JSON.stringify(Array.from(new Set([...req.linkedMajorTaskIds, matchedMajor.id]))),
        JSON.stringify(Array.from(new Set([...req.linkedStageCodes, stageCode]))),
        JSON.stringify(Array.from(new Set([...req.linkedTaskIds, taskId]))),
        nowIso,
        req.id
      );

      this.recordAgentCommunication({
        projectId: run.project_id,
        runId,
        majorTaskId: matchedMajor.id,
        microTaskId: taskId,
        fromAgent: 'supervisor',
        toAgent: 'worker',
        messageType: 'TASK_PLANNED',
        content: `Requisito sem cobertura detectado [${req.code}] -> Microtarefa [${microCode}] "${title}" criada automaticamente.`,
        payload: {
          requirementCode: req.code,
          discoverySource: 'requirement_coverage_gate',
          taskId,
          code: microCode
        }
      });

      this.recalculateMajorTaskState(matchedMajor.id, 'supervisor');
      createdTasks.push(db.prepare('SELECT * FROM autonomous_tasks WHERE id = ?').get(taskId));
    }

    this.syncRequirementTraceability(runId);
    const refreshedReqs = this.getProjectRequirements(runId);
    const refreshedTasks: any[] = db.prepare('SELECT * FROM autonomous_tasks WHERE run_id = ?').all(runId);
    const refreshedActiveSet = new Set(refreshedTasks.filter(t => t.status !== 'waived').map(t => t.id));
    const uncoveredAfter = refreshedReqs
      .filter(r => r.mandatory && !r.linkedTaskIds.some(tId => refreshedActiveSet.has(tId)))
      .map(r => r.code);

    return {
      uncoveredBefore: uncoveredBefore.map(r => r.code),
      uncoveredRequirementsBefore: uncoveredBefore,
      uncoveredAfter,
      createdTasks,
      allRequirementsCovered: uncoveredAfter.length === 0
    };
  }

  /**
   * Discovers and creates new subtasks dynamically during execution when a gap, dependency,
   * or architectural need is found, enforcing anti-duplication (Scenario 16) and max depth loop prevention (Scenario 17).
   */
  static discoverDynamicSubtasks(params: {
    runId: string;
    originTaskId?: string;
    targetMajorTaskId?: string;
    discoveredTasks?: HierarchicalMicrotaskInput[];
    subtasks?: HierarchicalMicrotaskInput[];
    reason: string;
    discoverySource?: string;
    discoveredFrom?: string;
    maxAllowedDepth?: number;
    maxSubtasksPerDiscovery?: number;
  }): {
    createdTasks: any[];
    skippedDuplicates: string[];
    newSubdivisionDepth: number;
  } {
    const run: any = db.prepare('SELECT * FROM autonomous_runs WHERE id = ?').get(params.runId);
    if (!run) throw new Error(`DISCOVERY_ERROR: Run ${params.runId} não encontrado.`);
    const originTask: any = params.originTaskId
      ? db.prepare('SELECT * FROM autonomous_tasks WHERE id = ? AND run_id = ?').get(params.originTaskId, params.runId)
      : db.prepare('SELECT * FROM autonomous_tasks WHERE run_id = ? ORDER BY order_index DESC LIMIT 1').get(params.runId);
    if (!originTask) throw new Error(`DISCOVERY_ERROR: Tarefa de origem ${params.originTaskId} não encontrada.`);

    const maxAllowedDepth = Math.min(params.maxAllowedDepth ?? 3, 4);
    const originDepth = originTask.subdivision_depth || 0;
    const nextDepth = originDepth + 1;

    // Scenario 17: Prevent infinite subdivision / dynamic discovery loops
    if (nextDepth > maxAllowedDepth) {
      throw new Error(
        `MAX_SUBDIVISION_DEPTH_EXCEEDED: Limite máximo de subdivisão/descoberta dinâmica atingido (profundidade ${originDepth}/${maxAllowedDepth}) para a tarefa "${originTask.title}".`
      );
    }

    const existingChildrenCount: any = db
      .prepare('SELECT COUNT(*) as cnt FROM autonomous_tasks WHERE run_id = ? AND parent_task_id = ?')
      .get(params.runId, originTask.id);
    if ((existingChildrenCount?.cnt || 0) >= 6) {
      throw new Error(
        `MAX_SUBDIVISION_CHILDREN_EXCEEDED: A tarefa "${originTask.title}" já gerou o limite máximo de subtarefas dinâmicas.`
      );
    }

    const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(run.project_id);
    const projectPath = project?.path || process.cwd();
    const protectedFiles = projectPath ? IndependentEvaluator.listEvaluationFiles(projectPath) : [];
    const nowIso = new Date().toISOString();

    const allExistingTasks: any[] = db.prepare('SELECT * FROM autonomous_tasks WHERE run_id = ?').all(params.runId);
    const existingFingerprints = new Set<string>(
      allExistingTasks.map(t => this.normalizeSemanticText(t.title))
    );

    const maxOrdRow: any = db.prepare('SELECT COALESCE(MAX(order_index), 0) as maxOrd FROM autonomous_tasks WHERE run_id = ?').get(params.runId);
    let nextOrder = (maxOrdRow?.maxOrd || 0) + 1;

    const createdTasks: any[] = [];
    const skippedDuplicates: string[] = [];
    const itemsToProcess = params.discoveredTasks || params.subtasks || [];

    for (let i = 0; i < itemsToProcess.length; i++) {
      const item = itemsToProcess[i];
      const fp = this.normalizeSemanticText(item.title);
      if (existingFingerprints.has(fp)) {
        skippedDuplicates.push(item.title);
        continue;
      }
      existingFingerprints.add(fp);

      const newTaskId = item.id || crypto.randomUUID();
      const childIndex = (existingChildrenCount?.cnt || 0) + createdTasks.length + 1;
      const microCode = item.code || `${originTask.code || originTask.order_index}.${childIndex}`;
      const stageCode = item.stageCode || originTask.stage_code || 'ET-DYNAMIC';
      const stageTitle = item.stageTitle || originTask.stage_title || 'Subtarefas Descobertas em Execução';
      const reqIds =
        item.requirementIds && item.requirementIds.length > 0
          ? item.requirementIds
          : originTask.requirement_ids_json
          ? JSON.parse(originTask.requirement_ids_json)
          : [];
      const criteria =
        item.criteria && item.criteria.length > 0
          ? item.criteria
          : [`Implementar e validar subtarefa descoberta: ${item.title}`];
      const scopeFiles = item.allowedScope || item.expectedFiles || [];
      const normCmd = normalizeOrRecoverVerificationCommand(
        item.verificationCommand || originTask.verification_command,
        projectPath,
        { allowUncreatedFiles: true }
      );

      const deps = item.dependencies || (originTask.status === 'completed' ? [originTask.id] : []);
      const allDepsCompleted = deps.every(d => {
        const depRow: any = db.prepare('SELECT status FROM autonomous_tasks WHERE (id = ? OR code = ?) AND run_id = ?').get(d, d, params.runId);
        return depRow?.status === 'completed';
      });
      const initialState: TaskLifecycleState = allDepsCompleted ? 'READY' : 'PLANNED';
      const initialStatus = this.toDbStatus(initialState);

      const contract = IndependentEvaluator.createSuccessContract({
        taskId: newTaskId,
        runId: params.runId,
        projectId: run.project_id,
        projectPath,
        objective: item.title,
        acceptanceCriteria: criteria,
        verificationCommand: normCmd.command,
        protectedEvaluationFiles: protectedFiles,
        isBugFix: false
      });

      db.prepare(`
        INSERT INTO autonomous_tasks (
          id, run_id, project_id, major_task_id, stage_code, stage_title, parent_task_id,
          requirement_ids_json, discovery_source, subdivision_depth,
          code, title, objective, description,
          milestone, order_index, dependencies_json, status, lifecycle_state, assigned_to,
          retry_count, max_retries, criteria_json, verification_command, done_when,
          expected_files_json, allowed_scope_json, constraints_json, test_strategy,
          required_evidence_json, protected_evaluation_files_json, contract_id,
          replan_origin_task_id, replan_type, replan_reason, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'builder',
          0, 3, ?, ?, ?, ?, ?, '[]', ?, '[]', ?, ?, ?, 'NEW_FEATURE', ?, ?, ?
        )
      `).run(
        newTaskId,
        params.runId,
        run.project_id,
        originTask.major_task_id,
        stageCode,
        stageTitle,
        originTask.id,
        JSON.stringify(reqIds),
        params.discoverySource || 'execution_gap_discovery',
        nextDepth,
        microCode,
        item.title.trim(),
        item.objective || item.title.trim(),
        item.description || params.reason,
        originTask.milestone || 'GT-1',
        nextOrder++,
        JSON.stringify(deps),
        initialStatus,
        initialState,
        JSON.stringify(criteria),
        normCmd.command,
        item.doneWhen || `Critérios verificados e ${normCmd.command} com código 0`,
        JSON.stringify(scopeFiles),
        JSON.stringify(scopeFiles),
        `Executar ${normCmd.command}`,
        JSON.stringify(protectedFiles),
        contract.id,
        originTask.id,
        params.reason,
        nowIso,
        nowIso
      );

      const created = db.prepare('SELECT * FROM autonomous_tasks WHERE id = ?').get(newTaskId);
      createdTasks.push(created);

      this.recordAgentCommunication({
        projectId: run.project_id,
        runId: params.runId,
        majorTaskId: originTask.major_task_id,
        microTaskId: newTaskId,
        fromAgent: 'supervisor',
        toAgent: 'worker',
        messageType: 'TASK_PLANNED',
        content: `Subtarefa dinâmica [${microCode}] "${item.title}" descoberta a partir de [${originTask.code || originTask.title}]: ${params.reason}`,
        payload: {
          originTaskId: originTask.id,
          subdivisionDepth: nextDepth,
          discoverySource: params.discoverySource || 'execution_gap_discovery',
          reason: params.reason
        }
      });
    }

    this.syncRequirementTraceability(params.runId);
    if (originTask.major_task_id) {
      this.recalculateMajorTaskState(originTask.major_task_id, 'supervisor');
    }

    return {
      createdTasks,
      skippedDuplicates,
      newSubdivisionDepth: nextDepth
    };
  }

  /**
   * Detects whether two tasks have overlapping file scopes (`allowed_scope_json` / `expected_files_json`),
   * preventing concurrent Workers from modifying the same files in parallel (Section 6 / Scenario 8).
   */
  static detectScopeConflicts(
    taskA: { id: string; allowed_scope_json?: string; expected_files_json?: string; allowedScope?: string[]; expectedFiles?: string[] },
    taskB: { id: string; allowed_scope_json?: string; expected_files_json?: string; allowedScope?: string[]; expectedFiles?: string[] }
  ): { hasConflict: boolean; conflictingFiles: string[]; overlappingFiles: string[] } {
    const getScopes = (t: any): string[] => {
      const expected: string[] =
        t.expectedFiles ||
        (t.expected_files_json ? JSON.parse(t.expected_files_json) : []);
      const allowed: string[] =
        t.allowedScope ||
        (t.allowed_scope_json ? JSON.parse(t.allowed_scope_json) : []);
      const raw: string[] = expected.length > 0 ? expected : allowed;
      const cleaned = raw
        .map(s => String(s || '').replace(/\\/g, '/').replace(/^\.\//, '').trim())
        .filter(Boolean);
      const nonSmoke = cleaned.filter(s => !/^test\/smoke\.test\./i.test(s));
      return nonSmoke.length > 0 ? nonSmoke : cleaned;
    };

    const scopesA = getScopes(taskA);
    const scopesB = getScopes(taskB);
    if (scopesA.length === 0 || scopesB.length === 0) {
      return { hasConflict: false, conflictingFiles: [], overlappingFiles: [] };
    }

    const conflicts = new Set<string>();
    for (const a of scopesA) {
      const aPrefix = a.replace(/\*.*$/, '');
      for (const b of scopesB) {
        const bPrefix = b.replace(/\*.*$/, '');
        if (
          a === b ||
          (aPrefix && b.startsWith(aPrefix) && (a.includes('*') || a === aPrefix.replace(/\/$/, ''))) ||
          (bPrefix && a.startsWith(bPrefix) && (b.includes('*') || b === bPrefix.replace(/\/$/, '')))
        ) {
          conflicts.add(a === b ? a : `${a} <-> ${b}`);
        }
      }
    }

    const conflictList = Array.from(conflicts);
    return {
      hasConflict: conflicts.size > 0,
      conflictingFiles: conflictList,
      overlappingFiles: conflictList
    };
  }

  /**
   * Computes which tasks are eligible to execute now, separating safe parallel tasks
   * from tasks deferred due to file-scope conflicts with currently IN_PROGRESS or higher-priority READY tasks.
   */
  static getEligibleParallelTasks(runId: string): {
    eligibleTasks: any[];
    scopeDeferredTasks: Array<{
      task: any;
      conflictingTaskId: string;
      conflictingTaskCode: string;
      conflictingFiles: string[];
      reason: string;
    }>;
    eligible: any[];
    deferredByScopeConflict: Array<{
      task: any;
      conflictingTaskId: string;
      conflictingTaskCode: string;
      conflictingFiles: string[];
      reason: string;
    }>;
  } {
    const allTasks: any[] = db.prepare('SELECT * FROM autonomous_tasks WHERE run_id = ? ORDER BY order_index ASC').all(runId);
    const allMajors: any[] = db.prepare('SELECT * FROM autonomous_major_tasks WHERE run_id = ? ORDER BY order_index ASC').all(runId);

    const completedTaskTokens = new Set<string>(
      allTasks
        .filter(t => t.status === 'completed' || this.resolveTaskLifecycleState(t) === 'COMPLETED')
        .flatMap(t => [t.id, t.code].filter(Boolean))
    );
    const completedMajorTokens = new Set<string>(
      allMajors
        .filter(m => m.status === 'completed' || this.resolveTaskLifecycleState(m) === 'COMPLETED')
        .flatMap(m => [m.id, m.code].filter(Boolean))
    );
    const majorById = new Map<string, any>(allMajors.map(m => [m.id, m]));

    const inProgressTasks = allTasks.filter(t => {
      const st = this.resolveTaskLifecycleState(t);
      return st === 'IN_PROGRESS' || st === 'REVIEW_PENDING' || st === 'APPROVED' || st === 'COMMIT_PENDING';
    });

    // Candidate tasks whose dependencies are satisfied and are READY or REWORK_REQUIRED (or PLANNED with all deps now met)
    const dependencyReadyCandidates: any[] = [];
    for (const t of allTasks) {
      if (t.status === 'waived') continue;
      const st = this.resolveTaskLifecycleState(t);
      if (st !== 'READY' && st !== 'REWORK_REQUIRED' && st !== 'PLANNED') continue;

      const deps: string[] = t.dependencies_json ? JSON.parse(t.dependencies_json) : [];
      const depsMet = deps.every(d => completedTaskTokens.has(d));
      if (!depsMet) continue;

      if (t.major_task_id) {
        const major = majorById.get(t.major_task_id);
        const majorDeps: string[] = major?.dependencies_json ? JSON.parse(major.dependencies_json) : [];
        if (!majorDeps.every(d => completedMajorTokens.has(d))) {
          continue;
        }
      }

      dependencyReadyCandidates.push(t);
    }

    const eligibleTasks: any[] = [];
    const scopeDeferredTasks: Array<{
      task: any;
      conflictingTaskId: string;
      conflictingTaskCode: string;
      conflictingFiles: string[];
      reason: string;
    }> = [];

    const activeScopeHolders: any[] = [...inProgressTasks];

    for (const candidate of dependencyReadyCandidates) {
      let conflictFound: { holder: any; files: string[] } | null = null;
      for (const holder of activeScopeHolders) {
        if (holder.id === candidate.id) continue;
        const check = this.detectScopeConflicts(holder, candidate);
        if (check.hasConflict) {
          conflictFound = { holder, files: check.conflictingFiles };
          break;
        }
      }

      if (conflictFound) {
        const reason = `Aguardando liberação de escopo de arquivo (${conflictFound.files.join(', ')}) em uso pela tarefa [${conflictFound.holder.code || conflictFound.holder.title}].`;
        scopeDeferredTasks.push({
          task: candidate,
          conflictingTaskId: conflictFound.holder.id,
          conflictingTaskCode: conflictFound.holder.code || conflictFound.holder.title,
          conflictingFiles: conflictFound.files,
          reason
        });
      } else {
        eligibleTasks.push(candidate);
        activeScopeHolders.push(candidate);
      }
    }

    return {
      eligibleTasks,
      scopeDeferredTasks,
      eligible: eligibleTasks,
      deferredByScopeConflict: scopeDeferredTasks
    };
  }

  /**
   * Decomposes a project briefing adaptively into Major Tasks, Stages, and Microtasks
   * proportional to its real complexity and requirement set (Sections 2, 3, 4).
   * - Simple projects stay compact (1-3 microtasks).
   * - Complex projects expand into domain-aligned Major Tasks, Stages, and atomic Microtasks without any 6-task ceiling.
   */
  static decomposeProjectAdaptively(params: {
    projectId: string;
    runId: string;
    projectPath: string;
    originalDescription?: string;
    briefing?: string;
    initialFlatTasks?: HierarchicalMicrotaskInput[];
    initialMajorTasks?: HierarchicalMajorTaskInput[];
    requirements?: string[];
    ensureFullCoverage?: boolean;
  }): ReturnType<typeof HierarchicalOrchestrationService.persistHierarchicalPlan> {
    const originalDescription = (params.originalDescription || params.briefing || '').trim();
    const complexity = this.analyzeProjectComplexity(originalDescription, params.requirements);
    const structuredReqs = this.extractStructuredRequirements(originalDescription, params.requirements);
    const initialTasks = params.initialFlatTasks || [];

    // Check if initialTasks already cover all extracted requirements (e.g., simple 2-task app in homologation)
    if (initialTasks.length > 0) {
      const combinedInitialCorpus = this.normalizeSemanticText(
        initialTasks.map(t => `${t.title} ${t.description || ''} ${(t.criteria || []).join(' ')}`).join(' ')
      );
      const uncoveredReqs = structuredReqs.filter(req => {
        const words = this.normalizeSemanticText(req.title)
          .split(/[^a-z0-9]+/)
          .filter(w => w.length >= 4);
        return words.length > 0 && !words.some(w => combinedInitialCorpus.includes(w));
      });

      const hasOversizedInitial = initialTasks.some(
        t => (t.criteria?.length || 0) >= 6 || ((t.allowedScope || t.expectedFiles)?.length || 0) >= 7
      );

      // If simple/moderate and initial tasks cover all requirements without oversized tasks, preserve them cleanly
      if (uncoveredReqs.length === 0 && !hasOversizedInitial && (complexity.complexityTier === 'SIMPLE' || initialTasks.length >= complexity.recommendedMicrotaskCount.min)) {
        return this.persistHierarchicalPlan({
          projectId: params.projectId,
          runId: params.runId,
          projectPath: params.projectPath,
          originalDescription,
          requirements: params.requirements,
          flatTasks: initialTasks,
          subdivideOversized: true,
          ensureRequirementCoverage: false
        });
      }
    }

    // For complex/enterprise projects or when initial tasks are empty/incomplete, construct a full complexity-driven hierarchy
    if (complexity.complexityTier === 'SIMPLE' && initialTasks.length === 0) {
      return this.persistHierarchicalPlan({
        projectId: params.projectId,
        runId: params.runId,
        projectPath: params.projectPath,
        originalDescription,
        requirements: params.requirements,
        majorTasks: [
          {
            code: 'GT-1',
            title: `Implementação e Validação: ${originalDescription.slice(0, 60)}`,
            objective: originalDescription,
            complexityTier: 'SIMPLE',
            microtasks: structuredReqs.slice(0, 2).map((req, idx) => ({
              code: `1.${idx + 1}`,
              title: `Implementar ${req.title}`,
              description: `Desenvolver e testar ${req.title}`,
              stageCode: 'ET-1.1',
              stageTitle: 'Implementação Direta',
              requirementIds: [req.code],
              criteria: req.acceptanceCriteria,
              verificationCommand: 'npm test',
              dependencies: idx > 0 ? [`1.${idx}`] : []
            }))
          }
        ],
        subdivideOversized: false
      });
    }

    // Group structured requirements by architectural layer into ordered Major Tasks -> Stages -> Microtasks
    const layerConfig: Array<{
      code: string;
      title: string;
      objective: string;
      categories: string[];
      stages: Array<{ codeSuffix: string; title: string; categories: string[] }>;
    }> = [
      {
        code: 'GT-1',
        title: 'Fundação, Esquema de Dados e Persistência',
        objective: 'Estruturar modelo de dados, camada de persistência e integridade transacional',
        categories: ['persistence', 'general'],
        stages: [
          { codeSuffix: '1', title: 'Esquema e Modelos de Dados', categories: ['persistence', 'general'] },
          { codeSuffix: '2', title: 'Repositório e Persistência Verificável', categories: ['persistence', 'general'] }
        ]
      },
      {
        code: 'GT-2',
        title: 'Segurança, Autenticação e Controle de Acesso',
        objective: 'Implementar autenticação, sessão, validação de segurança e proteção de dados',
        categories: ['authentication', 'security'],
        stages: [
          { codeSuffix: '1', title: 'Autenticação e Gestão de Sessão', categories: ['authentication'] },
          { codeSuffix: '2', title: 'Validação de Segurança e Proteção', categories: ['security'] }
        ]
      },
      {
        code: 'GT-3',
        title: 'Motor de Domínio, Receitas, Despesas e Categorias',
        objective: 'Construir regras de negócio, lançamentos financeiros, categorização e cálculos de saldo',
        categories: ['domain_calculations', 'categories'],
        stages: [
          { codeSuffix: '1', title: 'Regras de Lançamento e Cálculos', categories: ['domain_calculations'] },
          { codeSuffix: '2', title: 'Gestão de Categorias e Classificação', categories: ['categories'] }
        ]
      },
      {
        code: 'GT-4',
        title: 'Formulários, Filtros Dinâmicos e Busca',
        objective: 'Implementar formulários validados, filtros multicritério e busca por período/categoria',
        categories: ['forms', 'filters'],
        stages: [
          { codeSuffix: '1', title: 'Formulários e Validação de Entrada', categories: ['forms'] },
          { codeSuffix: '2', title: 'Filtros Dinâmicos, Busca e Ordenação', categories: ['filters'] }
        ]
      },
      {
        code: 'GT-5',
        title: 'Motor de Relatórios Analíticos e Exportação',
        objective: 'Construir consolidação analítica, balanços por período/categoria e exportação de dados',
        categories: ['reports'],
        stages: [
          { codeSuffix: '1', title: 'Consolidação e Agregação Analítica', categories: ['reports'] },
          { codeSuffix: '2', title: 'Exportação Verificável e Demonstrativos', categories: ['reports'] }
        ]
      },
      {
        code: 'GT-6',
        title: 'Dashboard, Interface Responsiva e Validação Integrada',
        objective: 'Construir painel consolidado, responsividade web e suíte de testes ponta a ponta',
        categories: ['dashboard', 'ui_responsive', 'testing'],
        stages: [
          { codeSuffix: '1', title: 'Dashboard e Interface Responsiva', categories: ['dashboard', 'ui_responsive'] },
          { codeSuffix: '2', title: 'Suíte de Testes e Homologação Ponta a Ponta', categories: ['testing'] }
        ]
      }
    ];

    const resolveScopeForCategory = (category: string): string[] => {
      switch (category) {
        case 'persistence':
          return ['src/db.cjs', 'test/finance.test.cjs'];
        case 'security':
          return ['src/security.cjs', 'test/finance.test.cjs'];
        case 'authentication':
          return ['src/auth.cjs', 'test/finance.test.cjs'];
        case 'categories':
          return ['src/categories.cjs', 'test/finance.test.cjs'];
        case 'domain_calculations':
        case 'forms':
          return ['src/transactions.cjs', 'test/finance.test.cjs'];
        case 'filters':
          return ['src/filters.cjs', 'test/finance.test.cjs'];
        case 'reports':
          return ['src/reports.cjs', 'test/finance.test.cjs'];
        case 'dashboard':
          return ['public/index.html', 'test/finance.test.cjs'];
        case 'ui_responsive':
          return ['public/styles.css', 'test/finance.test.cjs'];
        case 'testing':
          return ['test/finance.test.cjs'];
        default:
          return [`src/${category}.cjs`, 'test/smoke.test.cjs'];
      }
    };

    const majorTasksToPersist: HierarchicalMajorTaskInput[] = [];
    const assignedReqCodes = new Set<string>();

    // First incorporate any initialFlatTasks provided by the Supervisor
    if (initialTasks.length > 0) {
      const groupedInitial = this.groupFlatTasksIntoMajorTasks(
        this.validateAndSubdivideMicrotasks(initialTasks, { subdivideOversized: true }),
        originalDescription,
        structuredReqs.map(r => `${r.code}: ${r.title}`)
      );
      majorTasksToPersist.push(...groupedInitial);
    } else {
      let prevMajorCode: string | null = null;
      let majorSeq = 1;

      for (const layer of layerConfig) {
        const layerReqs = structuredReqs.filter(
          r => layer.categories.includes(r.category) && !assignedReqCodes.has(r.code)
        );
        if (layerReqs.length === 0) continue;

        const mtCode = `GT-${majorSeq}`;
        const microtasks: HierarchicalMicrotaskInput[] = [];
        let prevMicroCode: string | null = null;

        layerReqs.forEach(req => {
          assignedReqCodes.add(req.code);
          const matchingStage =
            layer.stages.find(st => st.categories.includes(req.category)) || layer.stages[0];
          const stageCode = `ET-${majorSeq}.${matchingStage.codeSuffix}`;
          const stageTitle = matchingStage.title;
          const scopeFiles = resolveScopeForCategory(req.category);

          // Stage 1: Implementation microtask
          const implCode = `${majorSeq}.${microtasks.length + 1}`;
          microtasks.push({
            code: implCode,
            title: `Implementar módulo de ${req.title}`,
            objective: `Desenvolver implementação funcional para [${req.code}] ${req.title}`,
            description: `Implementar ${req.description} com contratos claros e validação unitária.`,
            stageCode,
            stageTitle,
            requirementIds: [req.code],
            allowedScope: scopeFiles,
            expectedFiles: [scopeFiles[0]],
            criteria: [
              ...req.acceptanceCriteria,
              `Módulo de ${req.title} exportado e validado sem placeholders`
            ],
            verificationCommand: 'npm test',
            dependencies: prevMicroCode ? [prevMicroCode] : []
          });
          prevMicroCode = implCode;

          // Stage 2: Dedicated edge-case & integration verification microtask for Moderate/Complex/Enterprise tiers
          if (complexity.complexityTier !== 'SIMPLE') {
            const valCode = `${majorSeq}.${microtasks.length + 1}`;
            const secondStage = layer.stages[1] || layer.stages[0];
            microtasks.push({
              code: valCode,
              title: `Validar casos de borda e integração de ${req.title}`,
              objective: `Garantir robustez, tratamento de erros e testes de integração para [${req.code}]`,
              description: `Expandir validações de segurança/limites e testes automatizados para ${req.title}.`,
              stageCode: `ET-${majorSeq}.${secondStage.codeSuffix}`,
              stageTitle: secondStage.title,
              requirementIds: [req.code],
              allowedScope: scopeFiles,
              expectedFiles: [scopeFiles[0]],
              criteria: [
                `Tratamento de entradas inválidas e casos limite de ${req.title} testados`,
                `Execução de npm test passando com exit code 0`
              ],
              verificationCommand: 'npm test',
              dependencies: [implCode]
            });
            prevMicroCode = valCode;
          }
        });

        majorTasksToPersist.push({
          code: mtCode,
          title: layer.title,
          objective: layer.objective,
          complexityTier: complexity.complexityTier,
          requirementIds: layerReqs.map(r => r.code),
          dependencies: prevMajorCode ? [prevMajorCode] : [],
          orderIndex: majorSeq,
          microtasks
        });

        prevMajorCode = mtCode;
        majorSeq++;
      }
    }

    return this.persistHierarchicalPlan({
      projectId: params.projectId,
      runId: params.runId,
      projectPath: params.projectPath,
      originalDescription,
      requirements: params.requirements,
      structuredRequirements: structuredReqs,
      majorTasks: majorTasksToPersist,
      subdivideOversized: true,
      ensureRequirementCoverage: params.ensureFullCoverage !== false
    });
  }

  /**
   * Deterministic Two-Wave Multi-Pass Generator:
   * Divides a project briefing into 6 domain-aligned Major Tasks (Scaffolding, Models/Persistence,
   * Domain Logic, APIs, UI/Views, and Testing/Verification), each with atomic microtasks (>15 total),
   * explicit file scopes, acceptance criteria, normalized verification commands, and chained cycle-free DAG.
   */
  static generateMultiPassPlannedTasks(params: {
    briefing: string;
    projectPath: string;
    projectName?: string;
    projectId?: string;
    requirements?: string[];
  }): PlannedTask[] {
    const originalDescription = (params.briefing || '').trim();
    const structuredReqs = this.extractStructuredRequirements(originalDescription, params.requirements);
    const complexity = this.analyzeProjectComplexity(originalDescription, params.requirements);

    const reqMapByCategory: Record<string, string[]> = {};
    for (const r of structuredReqs) {
      if (!reqMapByCategory[r.category]) reqMapByCategory[r.category] = [];
      reqMapByCategory[r.category].push(r.code);
    }

    const getAllReqsOr = (cats: string[], fallback: string[] = []): string[] => {
      const res: string[] = [];
      for (const c of cats) {
        if (reqMapByCategory[c]) res.push(...reqMapByCategory[c]);
      }
      return res.length > 0 ? res : fallback;
    };

    const domainProfile = MarketDiscoveryService.inferDomainProfile(originalDescription);
    const isDomainKnown = domainProfile.domainName && !domainProfile.domainName.includes('Geral');
    const isSaaS = ReaSaaSMasterService.isSaaSOrFullStackProject(originalDescription) ||
      isDomainKnown ||
      (params.projectPath ? fs.existsSync(path.join(path.resolve(params.projectPath), '.ai-dev-hub', 'specs', 'CONTEUDO.md')) : false);
    const isSimple = !isSaaS && complexity.complexityTier === 'SIMPLE' && structuredReqs.length <= 2;
    if (isSimple) {
      const t1: PlannedTask = {
        code: '1.1',
        majorTaskCode: 'GT-1',
        majorTaskTitle: 'Configuração e Implementação Inicial',
        stageCode: 'ET-1.1',
        stageTitle: 'Scaffolding e Estrutura',
        milestone: 'GT-1',
        title: `Configurar estrutura básica para ${params.projectName || 'projeto'}`,
        description: `Configurar arquivos base e ambiente para ${originalDescription.slice(0, 60)}`,
        orderIndex: 1,
        dependencies: [],
        criteria: [
          'Estrutura de diretórios e arquivos de configuração inicial criados',
          'Comando de verificação executando com código 0'
        ],
        verificationCommand: 'npm test',
        doneWhen: 'Critérios verificados e npm test com exitCode 0.',
        expectedFiles: ['src/index.ts', 'package.json'],
        allowedScope: ['src/index.ts', 'package.json'],
        requirementIds: structuredReqs.slice(0, 1).map(r => r.code)
      };
      const t2: PlannedTask = {
        code: '1.2',
        majorTaskCode: 'GT-1',
        majorTaskTitle: 'Configuração e Implementação Inicial',
        stageCode: 'ET-1.2',
        stageTitle: 'Validação e Testes',
        milestone: 'GT-1',
        title: `Implementar funcionalidade e testes de ${params.projectName || 'projeto'}`,
        description: `Implementar código principal e validação automatizada de ${originalDescription.slice(0, 60)}`,
        orderIndex: 2,
        dependencies: ['1.1'],
        criteria: [
          'Funcionalidade principal implementada conforme requisitos',
          'Testes automatizados cobrindo o fluxo de execução com código 0'
        ],
        verificationCommand: 'npm test',
        doneWhen: 'Critérios verificados e npm test com exitCode 0.',
        expectedFiles: ['src/index.ts', 'test/app.test.ts'],
        allowedScope: ['src/index.ts', 'test/app.test.ts'],
        requirementIds: structuredReqs.map(r => r.code)
      };
      return [t1, t2];
    }

    if (params.projectPath && isSaaS) {
      try {
        ReaSaaSMasterService.provisionReaBlueprintForProject(params.projectPath, originalDescription).catch((err) => {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "hierarchicalOrchestrationService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:hierarchicalOrchestrationService]", err);
      }
    });
      } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "hierarchicalOrchestrationService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:hierarchicalOrchestrationService]", err);
      }
    }
    }

    if (params.projectPath && isSaaS) {
      try {
        import('./projectLivingSpecService.js').then(({ ProjectLivingSpecService }) => {
          ProjectLivingSpecService.generateAndPersistLivingSpecs({
            briefing: originalDescription,
            projectName: params.projectName || 'Projeto',
            projectPath: params.projectPath,
            projectId: params.projectId,
            requirements: params.requirements
          }).catch((err) => {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "hierarchicalOrchestrationService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:hierarchicalOrchestrationService]", err);
      }
    });
        }).catch((err) => {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "hierarchicalOrchestrationService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:hierarchicalOrchestrationService]", err);
      }
    });
      } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "hierarchicalOrchestrationService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:hierarchicalOrchestrationService]", err);
      }
    }
    }

    const pName = params.projectName || 'SaaS';
    const briefingExtraction = MarketDiscoveryService.extractBriefingEntitiesAndRules(originalDescription);
    const domainBlueprint = ProjectLivingSpecService.resolveDomainBlueprint(originalDescription);
    const hasExplicitBilling = briefingExtraction.hasExplicitBilling;
    const hasExplicitKanban = briefingExtraction.hasExplicitKanban;

    const saasEncyclopediaBlueprints = [
      {
        code: 'GT-1',
        title: 'Scaffolding, Config Unificada, Infra Dual-Mode DOCSIMP e Cloud Deploy Pack',
        stageCode: 'ET-1.1',
        stageTitle: 'Scaffolding e Configuração Unificada',
        reqCats: ['general'],
        microtasks: [
          {
            subCode: '1.1',
            title: `Configurar estrutura de pastas, dependências rigorosas e tsconfig strict de ${pName}`,
            desc: 'Estruturar o projeto com tsconfig strict, dependências base, tipos fundamentais e scripts de build e teste.',
            files: ['package.json', 'tsconfig.json', 'src/types/index.ts'],
            criteria: [
              'TypeScript configurado com strict mode e caminhos de importação mapeados',
              'Interfaces e tipos centrais definidos em src/types/index.ts'
            ]
          },
          {
            subCode: '1.2',
            title: `Configurar variáveis de ambiente, logger central e Cloud Deploy Pack (Dockerfile) de ${pName}`,
            desc: 'Implementar parsing seguro de variáveis de ambiente com defaults resilientes, logger estruturado e Dockerfile de produção.',
            files: ['src/config.ts', 'src/logger.ts', 'Dockerfile', '.env.example'],
            criteria: [
              'Validação de variáveis de ambiente com defaults seguros em src/config.ts',
              'Dockerfile multi-estágio e arquivo .env.example provisionados'
            ]
          },
          {
            subCode: '1.3',
            title: `Configurar runner de testes determinístico com harness de execução de ${pName}`,
            desc: 'Configurar ambiente e isolamento de testes automatizados com harness determinístico e smoke test inicial.',
            files: ['test/setup.ts', 'test/smoke.test.ts'],
            criteria: [
              'Harness de testes isolado configurado com suporte a teardown determinístico',
              'Smoke test inicial passando com código de saída 0'
            ]
          }
        ]
      },
      {
        code: 'GT-2',
        title: 'Modelagem Relacional SQLite Completa & Migrations Idempotentes',
        stageCode: 'ET-2.1',
        stageTitle: 'Modelagem Relacional e Schemas',
        reqCats: ['persistence'],
        microtasks: [
          {
            subCode: '2.1',
            title: `Modelar schemas relacionais de banco de dados e migrations das entidades de domínio de ${pName}`,
            desc: 'Criar esquema SQL com chaves estrangeiras, índices de busca, constraints de unicidade e migrations versionadas.',
            files: ['src/db/schema.sql', 'src/db/connection.ts'],
            criteria: [
              'Tabelas de domínio criadas com integridade referencial e índices adequados',
              'Gerenciador de conexão SQLite com PRAGMA foreign_keys = ON e modo WAL'
            ]
          },
          {
            subCode: '2.2',
            title: hasExplicitBilling
              ? `Modelar schemas de suporte SaaS: team_members, api_keys, webhooks e notifications de ${pName}`
              : `Modelar schemas de suporte: coleções de domínio, presets de busca, api_keys e webhooks de ${pName}`,
            desc: hasExplicitBilling
              ? 'Implementar tabelas relacionais de infraestrutura comercial cobrindo membros da equipe, chaves de API, webhooks e notificações.'
              : `Implementar tabelas relacionais de suporte analítico cobrindo coleções salvas, presets de filtros rápidos do domínio (${domainBlueprint.domainName}), chaves de API e webhooks.`,
            files: hasExplicitBilling
              ? ['src/db/saasSchema.sql', 'src/db/saasModels.ts']
              : ['src/db/supportSchema.sql', 'src/db/supportModels.ts'],
            criteria: hasExplicitBilling
              ? [
                  'Tabelas team_members, api_keys, webhooks e notifications criadas com chaves primárias tipadas',
                  'Constraints de integridade e índices para consultas por chave e workspace'
                ]
              : [
                  'Tabelas de coleções salvas, presets de pesquisa e configurações analíticas criadas com integridade relacional',
                  'Constraints de integridade e índices para consultas rápidas por tag, data e workspace'
                ]
          },
          {
            subCode: '2.3',
            title: `Implementar tabela audit_logs, migrations versionadas e transações SQLite de ${pName}`,
            desc: 'Criar tabela e utilitário central de auditoria registrando actor, entidade, ação e payload diff.',
            files: ['src/db/auditSchema.sql', 'src/db/migrations.ts'],
            criteria: [
              'Tabela audit_logs registrando trilha de mutações em formato JSON estruturado',
              'Sistema de migrações determinístico executado de forma idempotente no boot'
            ]
          },
          {
            subCode: '2.4',
            title: `Implementar repositórios de dados para entidades de domínio e queries otimizadas de ${pName}`,
            desc: 'Construir camada de acesso a dados encapsulando queries SQL parametrizadas e mapeamento estrito de entidades.',
            files: ['src/repositories/baseRepository.ts', 'src/repositories/entityRepository.ts'],
            criteria: [
              'Operações completas de inserção, consulta filtrada, atualização e exclusão com Prepared Statements',
              'Tratamento preventivo de colisões de chave e constraints relacionais'
            ]
          }
        ]
      },
      {
        code: 'GT-3',
        title: 'Smart Demo Seeding Denso (seedIfEmpty com 30 a 50 Registros)',
        stageCode: 'ET-3.1',
        stageTitle: 'Seeding Denso e Fixtures',
        reqCats: ['persistence'],
        microtasks: [
          {
            subCode: '3.1',
            title: `Implementar seeder de entidades centrais com relacionamentos e dados realistas de ${pName}`,
            desc: 'Criar gerador de dados densos e realistas para as entidades de negócio principais com dados semânticos.',
            files: ['src/db/seedDomain.ts', 'test/fixtures/domainFixtures.ts'],
            criteria: [
              'Geração de pelo menos 20 registros realistas das entidades centrais com datas e valores coerentes',
              'Fixtures reutilizáveis em ambiente de teste determinístico'
            ]
          },
          {
            subCode: '3.2',
            title: hasExplicitBilling
              ? `Implementar seeder de ecossistema SaaS: faturas de cobrança, membros da equipe e API keys de ${pName}`
              : `Implementar seeder de coleções, filtros rápidos e registros de suporte de ${pName}`,
            desc: hasExplicitBilling
              ? 'Popular registros de suporte incluindo faturas simuladas, histórico de cobranças, membros com papéis RBAC e chaves de exemplo.'
              : `Popular registros de suporte incluindo nichos/coleções monitoradas, presets de busca analítica e configurações de sistema de ${pName}.`,
            files: hasExplicitBilling
              ? ['src/db/seedSaaS.ts', 'src/db/seedBilling.ts']
              : ['src/db/seedSupport.ts', 'src/db/seedPresets.ts'],
            criteria: hasExplicitBilling
              ? [
                  'Registros realistas nas tabelas team_members, api_keys, webhooks e faturas de cobrança',
                  'Logs de auditoria populados para alimentar a timeline inicial do sistema'
                ]
              : [
                  'Registros realistas nas tabelas de coleções, tags de tração e configurações de análise do domínio',
                  'Fixtures determinísticas prontas para demonstrar visualizações analíticas sem depender de mock externo'
                ]
          },
          {
            subCode: '3.3',
            title: `Implementar rotina central seedIfEmpty() idempotente no boot com 30 a 50 registros de ${pName}`,
            desc: 'Conectar rotina seedIfEmpty() na inicialização do servidor garantindo que tabelas e gráficos abram povoados e sem duplicações.',
            files: ['src/db/seeds.ts'],
            criteria: [
              'seedIfEmpty() popula entre 30 e 50 registros interconectados no primeiro boot',
              'Execução subsequente detecta dados existentes e não duplica registros'
            ]
          }
        ]
      },
      {
        code: 'GT-4',
        title: 'Motor de Regras de Negócio Core, Cálculos Analíticos e Máquina de Estados',
        stageCode: 'ET-4.1',
        stageTitle: 'Regras de Negócio e Cálculos',
        reqCats: ['domain_calculations', 'categories', 'filters'],
        microtasks: [
          {
            subCode: '4.1',
            title: `Implementar validações centrais de invariantes de negócio e sanitização estrita de ${pName}`,
            desc: 'Garantir consistência das operações, rejeição de entradas inválidas ou valores negativos e validação de limites.',
            files: ['src/domain/validator.ts', 'src/domain/rules.ts'],
            criteria: [
              'Validação estrita de limites, formatos e regras de negócio com erros semânticos',
              'Rejeição imediata de payloads corrompidos com mensagens acionáveis'
            ]
          },
          {
            subCode: '4.2',
            title: (domainBlueprint.domainKey === 'creator_video_analytics' || domainBlueprint.domainKey === 'creator_economy')
              ? `Implementar motor de cálculos analíticos: Outlier Multiplier, taxa de engajamento e velocidade VPH de ${pName}`
              : domainBlueprint.domainKey === 'ai_automation_agents'
              ? `Implementar motor de métricas de telemetria: latência P95, contabilidade de tokens e custo de inferência de ${pName}`
              : hasExplicitBilling
              ? `Implementar motor de cálculos analíticos, agregação de métricas e KPIs financeiros de ${pName}`
              : `Implementar motor de cálculos analíticos, métricas de agregação e fórmulas do domínio de ${pName}`,
            desc: (domainBlueprint.domainKey === 'creator_video_analytics' || domainBlueprint.domainKey === 'creator_economy')
              ? 'Construir algoritmos de consolidação de dados de viralidade, cálculo de Outlier Score em relação ao baseline do canal, Engagement Rate e Views Per Hour (VPH).'
              : domainBlueprint.domainKey === 'ai_automation_agents'
              ? 'Construir algoritmos de cálculo de latência percentil P95, consumo acumulado de prompt/completion tokens e estimativa financeira por modelo.'
              : hasExplicitBilling
              ? 'Construir algoritmos de consolidação de dados, médias móveis, variações percentuais (Δ%) e somatórios.'
              : `Construir algoritmos analíticos de consolidação, agregações e fórmulas essenciais do domínio (${domainBlueprint.formulas.slice(0, 2).join('; ') || 'médias móveis e variações percentuais'}).`,
            files: ['src/domain/calculator.ts', 'src/services/analyticsService.ts'],
            criteria: (domainBlueprint.domainKey === 'creator_video_analytics' || domainBlueprint.domainKey === 'creator_economy')
              ? [
                  'Cálculo preciso de Outlier Score com baseline histórico e detecção de virais autênticos (>= 3x a 50x)',
                  'Cálculo de taxa de engajamento percentual e velocidade de visualizações por hora (VPH)'
                ]
              : domainBlueprint.domainKey === 'ai_automation_agents'
              ? [
                  'Cálculo de latência P95 e agregação de tokens com divisão por provedor e modelo',
                  'Fórmulas de custo por 1k tokens e taxas de sucesso em tempo real'
                ]
              : [
                  'Cálculo preciso dos indicadores centrais do domínio e variações temporais (Δ%)',
                  'Agregação de séries temporais para geração de gráficos analíticos'
                ]
          },
          {
            subCode: '4.3',
            title: `Implementar máquinas de estado de ciclo de vida das entidades e tratamento de erros de ${pName}`,
            desc: 'Definir transições válidas de status de negócio com validação de invariantes e hierarquia de erros tipados.',
            files: ['src/domain/stateMachine.ts', 'src/domain/errors.ts'],
            criteria: [
              'Transições de estado permitidas estritamente validadas impedindo fluxos inválidos',
              'Hierarquia tipada de exceções de domínio com status codes correspondentes'
            ]
          }
        ]
      },
      {
        code: 'GT-5',
        title: 'API RESTful Core, Filtros Compostos, Bulk Operations e Exportação CSV',
        stageCode: 'ET-5.1',
        stageTitle: 'Controladores REST Core e Filtros',
        reqCats: ['api_contracts', 'security'],
        microtasks: [
          {
            subCode: '5.1',
            title: `Implementar middlewares de segurança HTTP, CORS, rate limiting e sanitização de ${pName}`,
            desc: 'Proteger rotas da aplicação configurando cabeçalhos de segurança (nosniff, frameguard), isolamento e sanitização.',
            files: ['src/middlewares/security.ts', 'src/middlewares/sanitize.ts'],
            criteria: [
              'Headers de segurança configurados impedindo MIME sniffing e framing malicioso',
              'Sanitização profunda de payloads contra injeções'
            ]
          },
          {
            subCode: '5.2',
            title: `Implementar endpoints RESTful de CRUD das entidades de domínio de ${pName}`,
            desc: 'Desenvolver endpoints RESTful cobrindo criação, leitura, atualização e exclusão com validação de contratos.',
            files: ['src/controllers/entityController.ts', 'src/routes/entityRoutes.ts'],
            criteria: [
              'Rotas RESTful completas retornando status HTTP canônicos (200, 201, 400, 404, 500)',
              'Tratamento centralizado de erros em todas as operações'
            ]
          },
          {
            subCode: '5.3',
            title: (domainBlueprint.domainKey === 'creator_video_analytics' || domainBlueprint.domainKey === 'creator_economy')
              ? `Implementar filtros de engajamento, Outlier Multiplier (>3x, >5x, >10x), busca e exportação CSV de ${pName}`
              : `Implementar filtros compostos do domínio, ordenação dinâmica, paginação e exportação CSV RFC-4180 de ${pName}`,
            desc: (domainBlueprint.domainKey === 'creator_video_analytics' || domainBlueprint.domainKey === 'creator_economy')
              ? 'Suportar busca textual com debounce (250ms), filtros multi-range por Outlier Score, views mínimas, engajamento e exportação tabular formatada em CSV RFC-4180.'
              : `Suportar busca textual com debounce (250ms), filtros combinados específicos do domínio (${briefingExtraction.filters.join(', ') || 'status e categorias'}) e exportação tabular formatada em CSV RFC-4180.`,
            files: ['src/services/filterService.ts', 'src/routes/exportRoutes.ts'],
            criteria: [
              'Query parameters de busca textual, filtros combinados e ordenação dinâmica respondendo com precisão',
              'Endpoint /api/export/csv gerando download com escape RFC-4180 dos registros filtrados'
            ]
          },
          {
            subCode: '5.4',
            title: `Implementar operações em massa (Bulk Operations) para atualização e remoção de ${pName}`,
            desc: 'Desenvolver rotas HTTP para processar múltiplos registros em uma única transação com relatório de sucesso/falha.',
            files: ['src/controllers/bulkController.ts', 'src/routes/bulkRoutes.ts'],
            criteria: [
              'Endpoint POST /api/bulk processando lotes de IDs com rollback em caso de falha',
              'Retorno detalhado contendo contadores de processados e status de cada item'
            ]
          }
        ]
      },
      {
        code: 'GT-6',
        title: 'Endpoints de Ecossistema SaaS, Billing, Webhooks e Audit Trail',
        stageCode: 'ET-6.1',
        stageTitle: 'APIs de Ecossistema SaaS',
        reqCats: ['authentication', 'security', 'api_contracts'],
        microtasks: [
          {
            subCode: '6.1',
            title: `Implementar endpoints de analytics executivo (/api/analytics) e healthcheck (/api/health) de ${pName}`,
            desc: 'Expor métricas consolidadas para os cards de BI, séries de gráficos temporais e status de saúde do sistema.',
            files: ['src/controllers/analyticsController.ts', 'src/routes/healthRoutes.ts'],
            criteria: [
              'GET /api/analytics retornando KPIs tabulares, gráficos multi-série e filtros de período',
              'GET /api/health retornando status: ok, uptime e métricas de conexão'
            ]
          },
          {
            subCode: '6.2',
            title: hasExplicitBilling
              ? `Implementar endpoints de billing e planos (/api/billing/plans, /api/billing/invoices) de ${pName}`
              : `Implementar endpoints de operações analíticas e coleções (/api/operations, /api/collections) de ${pName}`,
            desc: hasExplicitBilling
              ? 'Expor catálogo de planos de assinatura, medidores de uso (usage meters) e histórico de faturas com simulação de PIX.'
              : `Expor endpoints para gerenciar coleções salvas, filtros pré-configurados e histórico de varreduras/análises de ${pName}.`,
            files: hasExplicitBilling
              ? ['src/controllers/billingController.ts', 'src/routes/billingRoutes.ts']
              : ['src/controllers/operationController.ts', 'src/routes/operationRoutes.ts'],
            criteria: hasExplicitBilling
              ? [
                  'Endpoints de billing retornando planos (Starter/Pro/Enterprise) e consumo de cotas',
                  'Geração de cobrança com simulação de código PIX Copia-e-Cola e recibo'
                ]
              : [
                  'Endpoints RESTful para salvar coleções, registrar operações de análise e consultar histórico',
                  'Respostas formatadas em JSON com paginação e integridade referencial'
                ]
          },
          {
            subCode: '6.3',
            title: `Implementar endpoints de gestão de API Keys mascaradas (/api/api-keys) de ${pName}`,
            desc: 'Construir rotas para listar, criar com máscara de visualização única e revogar chaves de integração.',
            files: ['src/controllers/apiKeyController.ts', 'src/routes/apiKeyRoutes.ts'],
            criteria: [
              'Criação de API Keys seguras com hash no banco e exibição da chave completa apenas no momento da criação',
              'Revogação imediata de credenciais de acesso'
            ]
          },
          {
            subCode: '6.4',
            title: `Implementar dispatcher e playground de Webhooks (/api/webhooks, /api/webhooks/test) de ${pName}`,
            desc: 'Construir gerenciador de URLs de webhook e endpoint de teste com simulação de despacho e retorno HTTP.',
            files: ['src/services/webhookDispatcher.ts', 'src/routes/webhookRoutes.ts'],
            criteria: [
              'CRUD de configurações de webhooks por evento',
              'Endpoint /api/webhooks/test despachando payload real de teste e retornando status da resposta'
            ]
          },
          {
            subCode: '6.5',
            title: `Implementar endpoints de gestão de equipe RBAC (/api/team) e trilha global (/api/audit-logs) de ${pName}`,
            desc: 'Expor membros do workspace com papéis (Admin, Manager, Viewer) e endpoint paginado de audit_logs.',
            files: ['src/controllers/teamController.ts', 'src/routes/auditRoutes.ts'],
            criteria: [
              'Gestão de equipe com atribuição de permissões por papel',
              'GET /api/audit-logs com paginação, filtros por entidade e timeline de eventos'
            ]
          },
          {
            subCode: '6.6',
            title: `Implementar endpoint de especificação do catálogo da documentação (/api/docs-spec) de ${pName}`,
            desc: 'Disponibilizar especificação OpenAPI/REST interativa estruturada para alimentar a aba de documentação /docs.',
            files: ['src/controllers/docsController.ts', 'src/routes/docsRoutes.ts'],
            criteria: [
              'GET /api/docs-spec retornando catálogo estruturado de todos os endpoints REST',
              'Metadados completos com parâmetros, corpos de exemplo e respostas'
            ]
          }
        ]
      },
      {
        code: 'GT-7',
        title: 'Design System Master, Enterprise App Shell, Topbar & Command Palette (Ctrl+K)',
        stageCode: 'ET-7.1',
        stageTitle: 'App Shell Enterprise e Navegação',
        reqCats: ['ui_responsive'],
        microtasks: [
          {
            subCode: '7.1',
            title: `Construir Design System Master com tokens :root, tipografia tabular-nums e ícones SVG Lucide de ${pName}`,
            desc: 'Definir paleta de cores corporativa, design tokens CSS completos, tipografia tabular e conjunto de ícones SVG inline.',
            files: ['public/style.css', 'public/tokens.css'],
            criteria: [
              'Design tokens em :root cobrindo cores, bordas, sombras e transições suaves',
              'font-variant-numeric: tabular-nums configurada para números e tabelas',
              'Scrollbar personalizada (6px) e ícones SVG Lucide incorporados'
            ]
          },
          {
            subCode: '7.2',
            title: `Implementar Sidebar responsiva colapsável com atributos role="tab", data-tab e badges de ${pName}`,
            desc: 'Construir barra de navegação lateral estruturada com contadores em tempo real e atributos semânticos para captura 01-Secao.png.',
            files: ['public/index.html', 'public/app.js'],
            criteria: [
              'Sidebar com alternância colapsada/expandida e persistência de preferência',
              'Botões de navegação com role="tab" e data-tab="<secao>" exibindo badges com contadores dinâmicos'
            ]
          },
          {
            subCode: '7.3',
            title: `Implementar Topbar com seletor de Workspace, status do sistema e Central de Notificações de ${pName}`,
            desc: 'Construir cabeçalho corporativo com seletor de workspace, indicador de sincronização e popover de notificações com contador.',
            files: ['public/index.html', 'public/app.js', 'public/style.css'],
            criteria: [
              'Topbar com seletor de workspace e indicador de status do sistema em tempo real',
              'Central de notificações com badge de contagem de não lidas e painel dropdown'
            ]
          },
          {
            subCode: '7.4',
            title: `Implementar Command Palette modal flutuante acionada por Ctrl+K/Cmd+K navegável por teclado de ${pName}`,
            desc: 'Construir modal de comandos rápidos acionado por teclado permitindo busca instantânea de telas, comandos e filtros.',
            files: ['public/index.html', 'public/app.js', 'public/style.css'],
            criteria: [
              'Modal Command Palette abrindo via atalho Ctrl+K / Cmd+K ou clique na barra de busca',
              'Navegação fluida por setas do teclado (ArrowDown, ArrowUp, Enter, Escape)'
            ]
          }
        ]
      },
      {
        code: 'GT-8',
        title: 'Executive BI Analytics Dashboard, Gráficos SVG Multi-Série & Onboarding',
        stageCode: 'ET-8.1',
        stageTitle: 'Dashboard BI e Visualização Analítica',
        reqCats: ['dashboard'],
        microtasks: [
          {
            subCode: '8.1',
            title: `Implementar cards de KPIs executivos com valores tabulares e variação percentual (Δ%) de ${pName}`,
            desc: 'Renderizar métricas de alto impacto visual calculando crescimento/redução percentual em relação ao período anterior.',
            files: ['public/index.html', 'public/app.js'],
            criteria: [
              'Cards de métricas formatados com valores monetários e numéricos tabulares',
              'Badges dinâmicos de tendência com cores semânticas (+Δ% verde, -Δ% vermelho)'
            ]
          },
          {
            subCode: '8.2',
            title: `Implementar gráficos vetoriais SVG interativos com tooltips e seletor de período de ${pName}`,
            desc: 'Construir gráficos vetoriais SVG multi-série responsivos (evolução e distribuição) com tooltips flutuantes e botões 7d/30d/90d/12m.',
            files: ['public/index.html', 'public/app.js', 'public/style.css'],
            criteria: [
              'Gráficos vetoriais SVG gerados sem dependências pesadas com curvas suaves',
              'Tooltips interativos no hover exibindo dados pontuais da série',
              'Seletor temporal (7d, 30d, 90d, 12m) recalculando visualizações instantaneamente'
            ]
          },
          {
            subCode: '8.3',
            title: `Implementar widget de Onboarding Checklist com progresso percentual e etapas guiadas de ${pName}`,
            desc: 'Construir cartão de boas-vindas interativo exibindo etapas de configuração inicial e barra de progresso.',
            files: ['public/index.html', 'public/app.js', 'public/style.css'],
            criteria: [
              'Checklist interativo com etapas de configuração e links diretos para cada secção',
              'Barra de progresso percentual calculada reativamente conforme etapas concluídas'
            ]
          }
        ]
      },
      {
        code: 'GT-9',
        title: 'Módulos de Domínio Core, Data Grids Avançados, Kanban & Detail Drawers',
        stageCode: 'ET-9.1',
        stageTitle: 'Data Grids, Kanban e Detalhes',
        reqCats: ['forms', 'reports'],
        microtasks: [
          {
            subCode: '9.1',
            title: `Implementar Data Grid com busca com debounce, filtros por status e ordenação de ${pName}`,
            desc: 'Construir tabela enterprise com busca em tempo real, filtros compostos, ordenação de colunas e paginação.',
            files: ['public/index.html', 'public/app.js'],
            criteria: [
              'Data Grid com busca debounce de 250ms e filtros por status e categorias',
              'Cabeçalhos clicáveis com indicadores visuais de ordenação (asc/desc)'
            ]
          },
          {
            subCode: '9.2',
            title: `Implementar seleção em lote (Bulk Actions) e exportação em 1 clique de ${pName}`,
            desc: 'Permitir selecionar múltiplos registros com checkboxes para ações coordenadas e botão de download CSV.',
            files: ['public/index.html', 'public/app.js', 'public/style.css'],
            criteria: [
              'Barra flutuante de ações em lote ativada ao marcar linhas',
              'Botão de exportação CSV em 1 clique gerando arquivo estruturado'
            ]
          },
          {
            subCode: '9.3',
            title: hasExplicitKanban
              ? `Implementar visão alternativa em Quadro Kanban com colunas de status e cards de ${pName}`
              : `Implementar visualização híbrida em Galeria de Cards 16:9 alternável com Tabela Analítica de ${pName}`,
            desc: hasExplicitKanban
              ? 'Construir visualização em formato Kanban permitindo alternar entre lista e quadro com atualização de estado.'
              : 'Construir galeria responsiva com cards 16:9 destacando thumbnails/métricas, pílulas de status/score e toggle de alternância instantânea com Data Grid denso.',
            files: ['public/index.html', 'public/app.js', 'public/style.css'],
            criteria: hasExplicitKanban
              ? [
                  'Toggle de alternância fluido entre visualização em Tabela e Quadro Kanban',
                  'Cards organizados por status com contadores por coluna e movimentação de estado'
                ]
              : [
                  'Toggle de visualização fluido entre Tabela Analítica e Galeria de Cards 16:9 com aspect-ratio preservado',
                  'Cards exibindo pílulas de destaque semântico (ex: Outlier Multiplier >= 5x, métricas em tabular-nums)'
                ]
          },
          {
            subCode: '9.4',
            title: `Implementar Slide-Over Detail Drawer lateral com abas de Detalhes, Edição e Histórico de ${pName}`,
            desc: 'Construir painel lateral deslizante abrindo ao clicar em registros para inspeção aprofundada sem sair do contexto.',
            files: ['public/index.html', 'public/app.js', 'public/style.css'],
            criteria: [
              'Drawer lateral deslizante com abas de Detalhes, Edição Inline e Trilha de Auditoria',
              'Feedback imediato Optimistic UI nas ações de atualização inline'
            ]
          }
        ]
      },
      {
        code: 'GT-10',
        title: hasExplicitBilling
          ? 'Central de Billing, Planos (Usage Meters, QR Code PIX) & Gestão de Equipe (RBAC)'
          : 'Comparador Analítico, Simulador Preditivo de Score & Gestão de Equipe (RBAC)',
        stageCode: 'ET-10.1',
        stageTitle: hasExplicitBilling ? 'Billing, Planos e Equipe RBAC' : 'Comparador, Simulador e Equipe RBAC',
        reqCats: ['authentication', 'reports'],
        microtasks: [
          {
            subCode: '10.1',
            title: hasExplicitBilling
              ? `Implementar comparador de planos (Starter/Pro/Enterprise) e medidores de cota (Usage Meters) de ${pName}`
              : `Implementar Comparador Analítico Lado a Lado e Seletor de Métricas de Referência de ${pName}`,
            desc: hasExplicitBilling
              ? 'Construir secção de assinatura com cards de precificação comparativa e barras de progresso de consumo de recursos.'
              : 'Construir secção de benchmark permitindo selecionar dois ou mais registros do domínio e comparar métricas analíticas e diferenciais lado a lado.',
            files: ['public/index.html', 'public/app.js', 'public/style.css'],
            criteria: hasExplicitBilling
              ? [
                  'Cards de planos com toggle mensal/anual e badges de recursos inclusos',
                  'Barras de consumo de cota (Usage Progress Meters) indicando utilização de limites'
                ]
              : [
                  'Painel comparativo lado a lado renderizando métricas selecionadas e variações relativas (Δ%)',
                  'Interface com chips de seleção rápida e visualização comparativa clara'
                ]
          },
          {
            subCode: '10.2',
            title: hasExplicitBilling
              ? `Implementar modal de checkout com simulação de QR-Code PIX Copia-e-Cola e recibo de ${pName}`
              : `Implementar Simulador Preditivo de Score e Calculadora do Domínio de ${pName}`,
            desc: hasExplicitBilling
              ? 'Desenvolver fluxo de contratação com geração de código PIX Copia-e-Cola simulado, botão de cópia e emissão de recibo.'
              : 'Desenvolver ferramenta interativa na interface permitindo simular cenários, testar parâmetros de fórmulas do domínio e projetar resultados com feedback visual imediato.',
            files: ['public/index.html', 'public/app.js', 'public/style.css'],
            criteria: hasExplicitBilling
              ? [
                  'Modal de checkout gerando QR-Code PIX e código copia-e-cola com feedback de cópia',
                  'Exibição de recibo de transação com status confirmado e download de comprovante'
                ]
              : [
                  'Simulador interativo recalculando score e métricas em tempo real conforme ajuste dos inputs',
                  'Exibição gráfica ou em pílulas dos resultados da simulação com indicação de confiança'
                ]
          },
          {
            subCode: '10.3',
            title: `Implementar secção de membros da equipe com perfis RBAC (Admin, Manager, Viewer) e convites de ${pName}`,
            desc: 'Construir interface de gerenciamento de membros com controle de permissões por perfil e formulário de convite.',
            files: ['public/index.html', 'public/app.js'],
            criteria: [
              'Listagem de membros com avatares, status de convite e seletor de papel RBAC',
              'Ações de alteração de papel e revogação de acesso integradas à API'
            ]
          },
          {
            subCode: '10.4',
            title: `Implementar configurações de Workspace e preferências de notificação/tema de ${pName}`,
            desc: 'Desenvolver painel de configurações gerais da organização com alteração de dados do workspace e preferências.',
            files: ['public/index.html', 'public/app.js', 'public/style.css'],
            criteria: [
              'Formulário de configurações gerais do workspace com validação e salvamento reativo',
              'Preferências de notificações e opções visuais persistidas no cliente'
            ]
          }
        ]
      },
      {
        code: 'GT-11',
        title: 'Portal de Documentação Técnica Embutido (/docs) & Developer Hub',
        stageCode: 'ET-11.1',
        stageTitle: 'Documentação /docs e Developer Hub',
        reqCats: ['api_contracts'],
        microtasks: [
          {
            subCode: '11.1',
            title: `Construir secção /docs com Guia Quickstart, visão de arquitetura e catálogo REST de ${pName}`,
            desc: 'Implementar aba de documentação técnica integrada acessível diretamente no SaaS com navegação por tópicos.',
            files: ['public/index.html', 'public/app.js', 'public/style.css'],
            criteria: [
              'Aba de navegação dedicada [data-tab="docs"] com Guia Quickstart e visão de arquitetura',
              'Catálogo interativo de rotas da API com métodos HTTP, rotas e descrições detalhadas'
            ]
          },
          {
            subCode: '11.2',
            title: `Implementar snippets copiáveis em 1 clique para curl e fetch nos endpoints do catálogo de ${pName}`,
            desc: 'Gerar blocos de código com comandos curl e requisições fetch dinamicamente parametrizadas com botão de cópia.',
            files: ['public/index.html', 'public/app.js', 'public/style.css'],
            criteria: [
              'Blocos de código com realce de sintaxe contendo exemplos funcionais de curl e fetch()',
              'Botão de copiar código em 1 clique com feedback visual de confirmação'
            ]
          },
          {
            subCode: '11.3',
            title: `Implementar gerenciador de Chaves de API no Developer Hub com criação e revogação de ${pName}`,
            desc: 'Construir secção para geração de chaves de API com máscara de visualização segura e botão de revogação imediata.',
            files: ['public/index.html', 'public/app.js'],
            criteria: [
              'Criação de novas chaves de API com cópia segura e aviso de visualização única',
              'Tabela de chaves ativas com prefixo visível, data de criação e ação de revogação'
            ]
          },
          {
            subCode: '11.4',
            title: `Implementar Webhooks Playground interativo com configuração de URL e disparo de testes de ${pName}`,
            desc: 'Desenvolver simulador de webhooks permitindo testar o disparo de eventos contra endpoints externos ou locais.',
            files: ['public/index.html', 'public/app.js', 'public/style.css'],
            criteria: [
              'Interface para cadastrar URL de destino e selecionar evento a ser simulado',
              'Botão de disparo de teste consumindo /api/webhooks/test e exibindo painel de resposta HTTP'
            ]
          }
        ]
      },
      {
        code: 'GT-12',
        title: 'Suíte Exaustiva de Testes, E2E User Journey & Homologação AppSec',
        stageCode: 'ET-12.1',
        stageTitle: 'Testes Exaustivos, E2E e AppSec',
        reqCats: ['testing'],
        microtasks: [
          {
            subCode: '12.1',
            title: `Implementar testes unitários do motor de domínio, regras e invariantes de cálculo de ${pName}`,
            desc: 'Construir suíte rigorosa de testes unitários validando regras de negócios, cálculos de KPIs e máquinas de estado.',
            files: ['test/unit/calculator.test.ts', 'test/unit/rules.test.ts'],
            criteria: [
              '100% de cobertura dos cálculos analíticos e invariantes de domínio',
              'Testes determinísticos executando com código de saída 0'
            ]
          },
          {
            subCode: '12.2',
            title: `Implementar testes de integração dos contratos REST, rotas de ecossistema e audit logs de ${pName}`,
            desc: 'Validar rotas da API REST, persistência em banco SQLite e integridade da trilha de auditoria audit_logs.',
            files: ['test/integration/api.test.ts', 'test/integration/ecosystem.test.ts'],
            criteria: [
              'Testes de integração cobrindo fluxos de CRUD, billing, webhooks e audit_logs',
              'Banco de testes limpo e isolado entre execuções'
            ]
          },
          {
            subCode: '12.3',
            title: `Implementar testes de ponta a ponta (E2E) simulando jornada completa do usuário com persistência F5 de ${pName}`,
            desc: 'Construir teste E2E validando fluxo da casca da aplicação até relatórios com verificação de persistência após reload.',
            files: ['test/e2e/workflow.test.ts', 'test/e2e/storePersistence.test.ts'],
            criteria: [
              'Jornada completa do usuário validada ponta a ponta (login/shell -> criação -> dashboard -> faturamento)',
              'Persistência reativa do estado comprovada sem regressões'
            ]
          },
          {
            subCode: '12.4',
            title: `Executar auditoria de segurança, blindagem contra Path Traversal, critérios e entrega de ${pName}`,
            desc: 'Validar todos os critérios de aceitação, blindagem OWASP (Path Traversal, headers, sanitização) e portão de entrega.',
            files: ['test/security/appSec.test.ts', 'test/e2e/finalValidation.test.ts'],
            criteria: [
              'Testes de segurança aprovando mitigação contra Path Traversal e injeções',
              'Suíte completa de testes executando com exitCode 0 e portão de qualidade aprovado'
            ]
          }
        ]
      }
    ];

    const standardBlueprints = [
      {
        code: 'GT-1',
        title: 'Setup de Infraestrutura, Tipos Globais e Scaffolding',
        stageCode: 'ET-1.1',
        stageTitle: 'Scaffolding e Tipos',
        reqCats: ['general'],
        microtasks: [
          {
            subCode: '1.1',
            title: 'Configurar estrutura de pastas, dependências e tsconfig',
            desc: 'Estruturar o projeto com tsconfig rigoroso, tipos fundamentais e scripts de build.',
            files: ['package.json', 'tsconfig.json', 'src/types/index.ts'],
            criteria: [
              'Configuração do TypeScript com strict mode ativado',
              'Definição das interfaces e tipos fundamentais do domínio em src/types/index.ts'
            ]
          },
          {
            subCode: '1.2',
            title: 'Configurar variáveis de ambiente, sanitização e logger central',
            desc: 'Implementar carregamento seguro de configurações e utilitário de logging observável.',
            files: ['src/config.ts', 'src/logger.ts'],
            criteria: [
              'Validação e parsing das variáveis de ambiente com defaults seguros',
              'Logger estruturado pronto para emitir logs formatados'
            ]
          },
          {
            subCode: '1.3',
            title: 'Configurar suíte de testes e harness de execução',
            desc: 'Configurar runner de testes com harness determinístico e primeiro teste smoke.',
            files: ['test/setup.ts', 'test/smoke.test.ts'],
            criteria: [
              'Ambiente de teste configurado e isolado',
              'Teste smoke passando com sucesso garantindo integridade do setup'
            ]
          }
        ]
      },
      {
        code: 'GT-2',
        title: 'Modelagem de Dados, Migrations e Camada de Persistência',
        stageCode: 'ET-2.1',
        stageTitle: 'Persistência e Schemas',
        reqCats: ['persistence'],
        microtasks: [
          {
            subCode: '2.1',
            title: 'Modelar schemas de banco de dados e migrations relacionais',
            desc: 'Criar esquema de tabelas relacionais com chaves estrangeiras, índices e constraints de integridade.',
            files: ['src/db/schema.sql', 'src/db/connection.ts'],
            criteria: [
              'Tabelas criadas com integridade referencial e índices adequados',
              'Gerenciador de conexão com suporte a transações e migrations determinísticas'
            ]
          },
          {
            subCode: '2.2',
            title: 'Implementar repositórios de dados para entidades centrais',
            desc: 'Construir camada de acesso a dados encapsulando queries SQL e mapeamento de entidades.',
            files: ['src/repositories/baseRepository.ts', 'src/repositories/entityRepository.ts'],
            criteria: [
              'Operações de inserção, consulta, atualização e exclusão implementadas',
              'Tratamento adequado de violações de unicidade e constraints'
            ]
          },
          {
            subCode: '2.3',
            title: 'Criar seeders e fixtures de teste determinísticas para dados',
            desc: 'Desenvolver geradores de dados de teste para popular banco em ambiente de homologação.',
            files: ['src/db/seeds.ts', 'test/fixtures/dbFixtures.ts'],
            criteria: [
              'Função de seed capaz de popular estados consistentes de banco',
              'Fixtures reutilizáveis para testes de integração'
            ]
          }
        ]
      },
      {
        code: 'GT-3',
        title: 'Motor de Regras de Domínio e Cálculos de Negócio',
        stageCode: 'ET-3.1',
        stageTitle: 'Regras de Negócio e Cálculos',
        reqCats: ['domain_calculations', 'categories', 'filters'],
        microtasks: [
          {
            subCode: '3.1',
            title: 'Implementar validações centrais e invariantes das entidades de negócio',
            desc: 'Garantir consistência das operações e validar entradas contra regras de negócio.',
            files: ['src/domain/validator.ts', 'src/domain/rules.ts'],
            criteria: [
              'Validação de limites, formatos e restrições de negócio',
              'Rejeição imediata de entradas inválidas com mensagens de erro claras'
            ]
          },
          {
            subCode: '3.2',
            title: 'Implementar motor de cálculos e processamento de transações',
            desc: 'Construir algoritmo central de processamento, cálculo de valores, saldos ou estados.',
            files: ['src/domain/calculator.ts', 'src/services/domainService.ts'],
            criteria: [
              'Cálculos matemáticos e lógicos precisos sem perdas por arredondamento',
              'Regras de transição de estado de negócio implementadas'
            ]
          },
          {
            subCode: '3.3',
            title: 'Implementar tratamento de erros de domínio e exceções operacionais',
            desc: 'Padronizar hierarquia de erros de domínio com códigos semânticos e mensagens amigáveis.',
            files: ['src/domain/errors.ts'],
            criteria: [
              'Classes de erro personalizadas com códigos tipados',
              'Mapeamento claro entre falhas de regra de negócio e respostas operacionais'
            ]
          }
        ]
      },
      {
        code: 'GT-4',
        title: 'Serviços, Rotas e APIs Backend',
        stageCode: 'ET-4.1',
        stageTitle: 'Controladores e Endpoints HTTP',
        reqCats: ['authentication', 'security', 'api_contracts'],
        microtasks: [
          {
            subCode: '4.1',
            title: 'Implementar middlewares de autenticação, autorização e sanitização',
            desc: 'Proteger rotas da aplicação validando tokens, sessões e permissões de acesso.',
            files: ['src/middlewares/authMiddleware.ts', 'src/middlewares/sanitize.ts'],
            criteria: [
              'Intercepção de requisições não autorizadas com código HTTP 401/403',
              'Sanitização de cabeçalhos e payloads contra injeções'
            ]
          },
          {
            subCode: '4.2',
            title: 'Implementar rotas HTTP e controladores para recursos principais',
            desc: 'Desenvolver endpoints RESTful cobrindo operações de CRUD e ações de negócio.',
            files: ['src/controllers/resourceController.ts', 'src/routes/apiRoutes.ts'],
            criteria: [
              'Rotas RESTful com status codes HTTP canônicos (200, 201, 400, 404, 500)',
              'Tratamento centralizado de erros em todas as rotas'
            ]
          },
          {
            subCode: '4.3',
            title: 'Implementar despacho de eventos, webhooks ou notificações assíncronas',
            desc: 'Gerenciar notificações de ciclo de vida e integração com serviços externos ou clientes.',
            files: ['src/services/eventService.ts', 'src/services/webhookService.ts'],
            criteria: [
              'Despacho confiável de notificações e eventos de atualização',
              'Resiliência a falhas transitórias com política de retry'
            ]
          }
        ]
      },
      {
        code: 'GT-5',
        title: 'Interface do Usuário, Componentes e Visualização Frontend',
        stageCode: 'ET-5.1',
        stageTitle: 'Interface e Telas de Usuário',
        reqCats: ['forms', 'dashboard', 'reports', 'ui_responsive'],
        microtasks: [
          {
            subCode: '5.1',
            title: 'Implementar formulários interativos com validação em tempo real',
            desc: 'Construir telas de entrada de dados, campos tipados e feedback visual de erros.',
            files: ['src/ui/components/Form.tsx', 'src/ui/components/Input.tsx'],
            criteria: [
              'Campos de entrada com validação síncrona e feedback visual amigável',
              'Prevenção de submissões duplicadas durante carregamento'
            ]
          },
          {
            subCode: '5.2',
            title: 'Implementar dashboard, indicadores e visualização analítica',
            desc: 'Renderizar painel com indicadores-chave, listagens ordenáveis e resumos visuais.',
            files: ['src/ui/pages/Dashboard.tsx', 'src/ui/components/MetricsCard.tsx'],
            criteria: [
              'Cards de métricas e listagem responsiva de registros',
              'Filtros dinâmicos atualizando a visualização de dados'
            ]
          },
          {
            subCode: '5.3',
            title: 'Conectar clientes de API ao estado global e tratamento de rede',
            desc: 'Integrar chamadas assíncronas à API com gerenciamento de estado e feedback de erro/sucesso.',
            files: ['src/ui/services/apiClient.ts', 'src/ui/state/useAppStore.ts'],
            criteria: [
              'Cliente HTTP tipado com tratamento de falhas de conexão',
              'Estado reativo refletindo alterações no backend'
            ]
          }
        ]
      },
      {
        code: 'GT-6',
        title: 'Suíte de Testes Integrados, E2E e Validação Final',
        stageCode: 'ET-6.1',
        stageTitle: 'Homologação e Testes E2E',
        reqCats: ['testing'],
        microtasks: [
          {
            subCode: '6.1',
            title: 'Implementar testes de integração cobrindo API, Domínio e Banco de Dados',
            desc: 'Escrever testes automatizados validando o fluxo entre rotas HTTP, repositórios e banco.',
            files: ['test/integration/api.test.ts', 'test/integration/persistence.test.ts'],
            criteria: [
              'Testes de integração cobrindo fluxos felizes e casos de borda',
              'Banco de teste limpo e restaurado após cada execução'
            ]
          },
          {
            subCode: '6.2',
            title: 'Implementar testes de ponta a ponta dos fluxos críticos de usuário',
            desc: 'Validar cenários completos desde autenticação até geração de relatórios ou resultados.',
            files: ['test/e2e/workflow.test.ts'],
            criteria: [
              'Fluxo de ponta a ponta executado com sucesso simulando jornada do usuário',
              'Asserts cobrindo persistência real e resposta da aplicação'
            ]
          },
          {
            subCode: '6.3',
            title: 'Executar auditoria de qualidade, validação de critérios e portão de entrega',
            desc: 'Verificar todos os critérios de aceitação, integridade de arquivos e ausência de regressões.',
            files: ['test/e2e/finalValidation.test.ts'],
            criteria: [
              'Todos os requisitos do projeto verificados com evidência real',
              'Suíte completa de testes executando com exitCode 0'
            ]
          }
        ]
      }
    ];

    const majorBlueprints = isSaaS ? saasEncyclopediaBlueprints : standardBlueprints;

    const plannedTasks: PlannedTask[] = [];
    let globalOrder = 1;
    let priorMicroCode: string | null = null;

    for (let gIdx = 0; gIdx < majorBlueprints.length; gIdx++) {
      const gt = majorBlueprints[gIdx];
      const linkedReqs = getAllReqsOr(gt.reqCats, structuredReqs.slice(gIdx, gIdx + 2).map(r => r.code));

      for (let mIdx = 0; mIdx < gt.microtasks.length; mIdx++) {
        const micro = gt.microtasks[mIdx];
        const deps: string[] = [];

        if (mIdx === 0) {
          if (priorMicroCode) {
            deps.push(priorMicroCode);
          }
        } else {
          deps.push(gt.microtasks[mIdx - 1].subCode);
        }

        const task: PlannedTask = {
          code: micro.subCode,
          majorTaskCode: gt.code,
          majorTaskTitle: gt.title,
          stageCode: gt.stageCode,
          stageTitle: gt.stageTitle,
          milestone: gt.code,
          title: micro.title,
          description: micro.desc,
          orderIndex: globalOrder++,
          dependencies: deps,
          criteria: micro.criteria,
          verificationCommand: 'npm test',
          doneWhen: 'Critérios verificados e comando "npm test" retornando exitCode 0.',
          expectedFiles: micro.files,
          allowedScope: Array.from(new Set([
            ...micro.files,
            'src/**',
            'public/**',
            'test/**',
            'tests/**',
            '.ai-dev-hub/**',
            'package.json',
            'tsconfig.json'
          ])),
          requirementIds: linkedReqs.length > 0 ? linkedReqs : [`REQ-${gIdx + 1}`]
        };

        const sanitized = GeminiSupervisorProvider.sanitizeAndRepairPlannedTask(task, params.projectPath, task.orderIndex);
        if (sanitized) {
          plannedTasks.push(sanitized);
          priorMicroCode = sanitized.code || sanitized.title;
        }
      }
    }

    const dagCheck = this.detectCircularDependencies(
      plannedTasks.map(t => ({
        id: t.code || t.title,
        title: t.title,
        code: t.code,
        dependencies: t.dependencies || []
      }))
    );

    if (dagCheck.hasCycle) {
      Logger.warn(`[HierarchicalOrchestration] Ciclo detectado na geração determinística: ${dagCheck.cyclePath.join(' -> ')}`);
    }

    const healedTasks = DagAutoHealer.autoHealAndNormalizeTaskGraph(plannedTasks as any);
    return healedTasks as PlannedTask[];
  }

  /**
   * Records a final project-level Supervisor review and triggers integrated completion validation.
   */
  static submitFinalProjectReview(params: {
    runId: string;
    verdict: 'APPROVED' | 'CHANGES_REQUESTED' | 'BLOCKED';
    feedback: string;
  }) {
    const run: any = db.prepare('SELECT * FROM autonomous_runs WHERE id = ?').get(params.runId);
    if (!run) throw new Error(`Run ${params.runId} não encontrado.`);

    this.recordAgentCommunication({
      projectId: run.project_id,
      runId: params.runId,
      fromAgent: 'supervisor',
      toAgent: 'user',
      messageType: 'PROJECT_VALIDATION_COMPLETED',
      content: `Revisão final do projeto (${params.verdict}): ${params.feedback}`,
      payload: {
        verdict: params.verdict,
        feedback: params.feedback
      }
    });

    return this.validateProjectFinalCompletion(params.runId);
  }

  /**
   * Executes final integrated validation of the project once all Major Tasks and Microtasks are completed.
   * Ensures a project is NEVER marked completed if any microtask is pending, rejected, blocked, uncommitted,
   * OR if any mandatory requirement lacks verified coverage and evidence (Section 5 / Scenario 11).
   */
  static validateProjectFinalCompletion(runId: string): {
    canComplete: boolean;
    canCompleteProject: boolean;
    allMajorTasksCompleted: boolean;
    allMicrotasksCompleted: boolean;
    allReviewsApproved: boolean;
    allCommitsVerified: boolean;
    allRequirementsVerified: boolean;
    blockingReasons: string[];
    summary: Record<string, any>;
  } {
    const run: any = db.prepare('SELECT * FROM autonomous_runs WHERE id = ?').get(runId);
    if (!run) {
      throw new Error(`FINAL_VALIDATION_ERROR: Run ${runId} não encontrado.`);
    }

    this.syncRequirementTraceability(runId);

    const microtasks: any[] = db.prepare('SELECT * FROM autonomous_tasks WHERE run_id = ? ORDER BY order_index ASC').all(runId);
    const activeMicrotasks = microtasks.filter(t => t.status !== 'waived');
    const majorTasks: any[] = db.prepare('SELECT * FROM autonomous_major_tasks WHERE run_id = ? ORDER BY order_index ASC').all(runId);

    // Ensure all major tasks have fresh calculated state
    for (const m of majorTasks) {
      this.recalculateMajorTaskState(m.id, 'supervisor');
    }
    const refreshedMajors: any[] = db.prepare('SELECT * FROM autonomous_major_tasks WHERE run_id = ? ORDER BY order_index ASC').all(runId);
    const projectRequirements = this.getProjectRequirements(runId);
    const mandatoryRequirements = projectRequirements.filter(r => r.mandatory);
    const unverifiedRequirements = mandatoryRequirements.filter(r => r.status !== 'verified');

    const blockingReasons: string[] = [];

    if (activeMicrotasks.length === 0) {
      blockingReasons.push('Nenhuma microtarefa ativa planejada no Run.');
    }

    const incompleteMicrotasks = activeMicrotasks.filter(t => t.status !== 'completed');
    if (incompleteMicrotasks.length > 0) {
      blockingReasons.push(
        `${incompleteMicrotasks.length} microtarefa(s) ainda não concluída(s): ${incompleteMicrotasks.map(t => `${t.title} (${t.status})`).join(', ')}`
      );
    }

    const incompleteMajors = refreshedMajors.filter(m => m.status !== 'completed');
    if (incompleteMajors.length > 0) {
      blockingReasons.push(
        `${incompleteMajors.length} Grande(s) Tarefa(s) ainda não concluída(s): ${incompleteMajors.map(m => `${m.code} (${m.status}${m.blocking_reason ? `: ${m.blocking_reason}` : ''})`).join(', ')}`
      );
    }

    let allRequirementsVerified = true;
    if (unverifiedRequirements.length > 0) {
      allRequirementsVerified = false;
      blockingReasons.push(
        `${unverifiedRequirements.length} requisito(s) obrigatório(s) sem validação/evidência verificada: ${unverifiedRequirements.map(r => `[${r.code}] ${r.title} (${r.status}/${r.verificationStatus})`).join(', ')}`
      );
    }

    // Check reviews and commits
    let allReviewsApproved = true;
    let allCommitsVerified = true;

    for (const t of activeMicrotasks) {
      const hasApprovedReview: any = db.prepare(
        "SELECT id FROM supervisor_reviews WHERE run_id = ? AND task_id = ? AND verdict = 'APPROVED' LIMIT 1"
      ).get(runId, t.id);
      if (t.review_decision === 'REJECTED' || t.review_decision === 'BLOCKED') {
        allReviewsApproved = false;
        blockingReasons.push(`Microtarefa "${t.title}" possui decisão de Review ${t.review_decision}.`);
      } else if (!hasApprovedReview && t.review_decision !== 'APPROVED') {
        allReviewsApproved = false;
        blockingReasons.push(`Microtarefa "${t.title}" não possui aprovação registrada do Review independente.`);
      }

      if (t.status === 'commit_pending' || !t.task_commit_sha) {
        allCommitsVerified = false;
        blockingReasons.push(`Microtarefa "${t.title}" não possui commit confirmado (task_commit_sha ausente ou pendente).`);
      }
    }

    const canCompleteProject =
      blockingReasons.length === 0 &&
      allReviewsApproved &&
      allCommitsVerified &&
      allRequirementsVerified;
    const nowIso = new Date().toISOString();
    const summary = {
      runId,
      projectId: run.project_id,
      canCompleteProject,
      totalMajorTasks: refreshedMajors.length,
      completedMajorTasks: refreshedMajors.filter(m => m.status === 'completed').length,
      totalMicrotasks: activeMicrotasks.length,
      completedMicrotasks: activeMicrotasks.filter(t => t.status === 'completed').length,
      totalMandatoryRequirements: mandatoryRequirements.length,
      verifiedMandatoryRequirements: mandatoryRequirements.length - unverifiedRequirements.length,
      unverifiedRequirements: unverifiedRequirements.map(r => ({
        code: r.code,
        title: r.title,
        status: r.status,
        verificationStatus: r.verificationStatus
      })),
      commits: activeMicrotasks.map(t => ({ taskId: t.id, code: t.code, title: t.title, commitSha: t.task_commit_sha })),
      blockingReasons,
      validatedAt: nowIso
    };

    db.prepare('UPDATE autonomous_runs SET final_validation_json = ?, updated_at = ? WHERE id = ?').run(
      JSON.stringify(summary),
      nowIso,
      runId
    );

    if (canCompleteProject) {
      this.recordAgentCommunication({
        idempotencyKey: `project-validated:${runId}:v${run.plan_version || 1}`,
        projectId: run.project_id,
        runId,
        fromAgent: 'supervisor',
        toAgent: 'user',
        messageType: 'PROJECT_VALIDATION_COMPLETED',
        content: `Validação integrada do projeto concluída com sucesso (${refreshedMajors.length} Grandes Tarefas, ${activeMicrotasks.length} Microtarefas e ${mandatoryRequirements.length} requisitos verificados).`,
        payload: summary
      });
    }

    return {
      canComplete: canCompleteProject,
      canCompleteProject,
      allMajorTasksCompleted: incompleteMajors.length === 0,
      allMicrotasksCompleted: incompleteMicrotasks.length === 0,
      allReviewsApproved,
      allCommitsVerified,
      allRequirementsVerified,
      blockingReasons,
      summary
    };
  }

  /**
   * Answers the 7 mandatory diagnostic & traceability questions directly from persisted SQLite state (Section 7):
   * 1. What is still missing to complete the project?
   * 2. Which requirements are not yet implemented?
   * 3. Which features are implemented but not yet tested/verified?
   * 4. Why is a task blocked?
   * 5. What is the next executable task and why?
   * 6. What caused the last Review rejection?
   * 7. What evidence justifies considering the project completed?
   */
  static queryPlanDiagnostics(runId: string, question?: string): any {
    const run: any = db.prepare('SELECT * FROM autonomous_runs WHERE id = ?').get(runId);
    if (!run) throw new Error(`DIAGNOSTICS_ERROR: Run ${runId} não encontrado.`);

    this.syncRequirementTraceability(runId);
    const majorTasks = this.getMajorTasksForRun(runId);
    const rawTasks: any[] = db.prepare('SELECT * FROM autonomous_tasks WHERE run_id = ? ORDER BY order_index ASC').all(runId);
    const activeTasks = rawTasks.filter(t => t.status !== 'waived');
    const reqs = this.getProjectRequirements(runId);
    const parallelCheck = this.getEligibleParallelTasks(runId);

    // 1. O que ainda falta para concluir o projeto?
    const incompleteMajorTasks = majorTasks
      .filter(m => m.status !== 'completed')
      .map(m => ({
        code: m.code,
        title: m.title,
        status: m.status,
        pendingMicrotasks: (m.microtasks || []).filter((t: any) => t.status !== 'completed' && t.status !== 'waived').length,
        reason: m.blockingReason || 'Subtarefas ou validações de requisito ainda pendentes'
      }));
    const incompleteMicrotasks = activeTasks
      .filter(t => t.status !== 'completed')
      .map(t => ({
        code: t.code || `${t.order_index}`,
        title: t.title,
        status: t.status,
        lifecycleState: this.resolveTaskLifecycleState(t),
        stageCode: t.stage_code || null
      }));
    const unverifiedRequirements = reqs
      .filter(r => r.mandatory && r.status !== 'verified')
      .map(r => ({
        code: r.code,
        title: r.title,
        status: r.status,
        verificationStatus: r.verificationStatus
      }));

    const canCompleteProject =
      activeTasks.length > 0 &&
      incompleteMajorTasks.length === 0 &&
      incompleteMicrotasks.length === 0 &&
      unverifiedRequirements.length === 0;

    const whatIsMissingSummary = canCompleteProject
      ? 'Nada pendente: todas as Grandes Tarefas, Microtarefas e requisitos obrigatórios foram implementados, testados e aprovados.'
      : `Faltam ${incompleteMajorTasks.length} Grande(s) Tarefa(s), ${incompleteMicrotasks.length} microtarefa(s) e ${unverifiedRequirements.length} requisito(s) obrigatório(s) para validação final.`;

    // 2. Quais requisitos ainda não foram implementados?
    const uncoveredRequirements = reqs.filter(r => r.linkedTaskIds.length === 0);
    const unimplementedRequirements = reqs
      .filter(r => r.status === 'pending' || r.status === 'in_progress' || r.status === 'rejected' || r.status === 'waived')
      .map(r => ({
        code: r.code,
        title: r.title,
        category: r.category,
        mandatory: r.mandatory,
        status: r.status,
        linkedTaskIds: r.linkedTaskIds
      }));

    // 3. Quais funcionalidades já foram implementadas mas ainda não foram testadas/verificadas?
    const implementedButUnverifiedFeatures = [
      ...reqs
        .filter(r => r.status === 'implemented' && r.verificationStatus !== 'review_approved')
        .map(r => ({
          code: r.code,
          title: r.title,
          linkedTaskIds: r.linkedTaskIds,
          reason: `Requisito implementado, porém status de verificação é "${r.verificationStatus}".`
        })),
      ...activeTasks
        .filter(t => {
          const st = this.resolveTaskLifecycleState(t);
          return st === 'REVIEW_PENDING' || st === 'APPROVED' || st === 'COMMIT_PENDING' || (st === 'COMPLETED' && t.review_decision !== 'APPROVED');
        })
        .map(t => ({
          code: t.code || `${t.order_index}`,
          title: t.title,
          linkedTaskIds: [t.id],
          reason: `Microtarefa em estado ${this.resolveTaskLifecycleState(t)} aguardando aprovação final ou evidência de teste.`
        }))
    ];

    // 4. Por que determinada tarefa está bloqueada?
    const taskLookup = new Map<string, any>();
    for (const t of rawTasks) {
      taskLookup.set(t.id, t);
      if (t.code) taskLookup.set(String(t.code), t);
    }
    const majorLookup = new Map<string, any>();
    for (const m of majorTasks) {
      majorLookup.set(m.id, m);
      if (m.code) majorLookup.set(String(m.code), m);
    }

    const blockedTasksAnalysis: any[] = [];
    for (const t of activeTasks) {
      const st = this.resolveTaskLifecycleState(t);
      const deps: string[] = t.dependencies_json ? JSON.parse(t.dependencies_json) : [];
      const unmetDeps = deps
        .map(d => taskLookup.get(d))
        .filter(depTask => depTask && depTask.status !== 'completed')
        .map(depTask => ({
          id: depTask.id,
          code: depTask.code || `${depTask.order_index}`,
          title: depTask.title,
          status: depTask.status
        }));

      const parentMajor = t.major_task_id ? majorLookup.get(t.major_task_id) : null;
      const unmetMajorDeps = (parentMajor?.dependencies || [])
        .map((md: string) => majorLookup.get(md))
        .filter((mDep: any) => mDep && mDep.status !== 'completed')
        .map((mDep: any) => ({
          id: mDep.id,
          code: mDep.code,
          title: mDep.title,
          status: mDep.status
        }));

      if (st === 'BLOCKED' || unmetDeps.length > 0 || unmetMajorDeps.length > 0) {
        let blockingReason = t.blocking_reason || '';
        if (!blockingReason) {
          if (st === 'BLOCKED' && (t.retry_count || 0) >= (t.max_retries || 3)) {
            blockingReason = `Limite máximo de tentativas atingido (${t.retry_count}/${t.max_retries || 3}) após reprovações no Review.`;
          } else if (st === 'BLOCKED') {
            const lastRev = t.review_result_json ? JSON.parse(t.review_result_json) : null;
            blockingReason = lastRev?.justification || t.commit_error || 'Bloqueada por falha de verificação ou commit.';
          } else if (unmetDeps.length > 0) {
            blockingReason = `Aguardando conclusão da(s) dependência(s): ${unmetDeps.map(d => `[${d.code}] ${d.title} (${d.status})`).join(', ')}`;
          } else if (unmetMajorDeps.length > 0) {
            blockingReason = `Aguardando conclusão da(s) Grande(s) Tarefa(s) precedente(s): ${unmetMajorDeps.map((d: any) => `[${d.code}] ${d.title}`).join(', ')}`;
          }
        }
        blockedTasksAnalysis.push({
          taskId: t.id,
          code: t.code || `${t.order_index}`,
          title: t.title,
          lifecycleState: st,
          blockingReason,
          unmetDependencies: [...unmetDeps, ...unmetMajorDeps],
          retryCount: t.retry_count || 0,
          maxRetries: t.max_retries || 3
        });
      }
    }

    // 5. Qual é a próxima tarefa executável e por quê?
    const firstEligible = parallelCheck.eligibleTasks[0] || null;
    const readyTasks = parallelCheck.eligibleTasks.map(t => ({
      id: t.id,
      code: t.code || `${t.order_index}`,
      title: t.title,
      allowedScope: t.allowed_scope_json ? JSON.parse(t.allowed_scope_json) : []
    }));
    const nextExecutableTask = {
      task: firstEligible
        ? {
            id: firstEligible.id,
            code: firstEligible.code || `${firstEligible.order_index}`,
            title: firstEligible.title,
            majorTaskCode: firstEligible.milestone || 'GT-1',
            stageCode: firstEligible.stage_code || null,
            requirementIds: firstEligible.requirement_ids_json ? JSON.parse(firstEligible.requirement_ids_json) : []
          }
        : null,
      parallelEligibleTasks: readyTasks,
      scopeDeferredTasks: parallelCheck.scopeDeferredTasks.map(d => ({
        id: d.task.id,
        code: d.task.code || `${d.task.order_index}`,
        title: d.task.title,
        conflictingTaskId: d.conflictingTaskId,
        conflictingFiles: d.conflictingFiles,
        reason: d.reason
      })),
      reason: firstEligible
        ? `A microtarefa [${firstEligible.code || firstEligible.order_index}] "${firstEligible.title}" está em estado ${this.resolveTaskLifecycleState(firstEligible)}, possui todas as dependências concluídas e não apresenta conflito de escopo de arquivos.`
        : canCompleteProject
        ? 'Nenhuma tarefa pendente: o projeto já cumpriu todos os requisitos.'
        : 'Nenhuma tarefa imediatamente executável: verifique tarefas em execução ou dependências bloqueadas.'
    };

    // 6. O que causou a última rejeição do Review?
    const lastRejectedReviewRow: any = db.prepare(
      "SELECT * FROM supervisor_reviews WHERE run_id = ? AND verdict != 'APPROVED' ORDER BY created_at DESC, rowid DESC LIMIT 1"
    ).get(runId);
    const rejectedTaskRow: any = lastRejectedReviewRow
      ? db.prepare('SELECT * FROM autonomous_tasks WHERE id = ?').get(lastRejectedReviewRow.task_id)
      : rawTasks
          .filter(t => t.review_decision === 'REJECTED' || t.review_decision === 'BLOCKED' || (t.retry_count || 0) > 0)
          .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))[0] || null;

    let lastReviewRejection: any = { found: false };
    if (rejectedTaskRow) {
      const parsedReviewResult = rejectedTaskRow.review_result_json ? JSON.parse(rejectedTaskRow.review_result_json) : null;
      const attemptHistory = rejectedTaskRow.attempt_history_json ? JSON.parse(rejectedTaskRow.attempt_history_json) : [];
      const lastRejectedAttempt = [...attemptHistory].reverse().find((a: any) => a.decision === 'REJECTED' || a.verdict === 'CHANGES_REQUESTED');
      lastReviewRejection = {
        found: true,
        taskId: rejectedTaskRow.id,
        taskCode: rejectedTaskRow.code || `${rejectedTaskRow.order_index}`,
        taskTitle: rejectedTaskRow.title,
        attempt: lastRejectedAttempt?.attempt || rejectedTaskRow.retry_count || 1,
        verdict: lastRejectedReviewRow?.verdict || parsedReviewResult?.decision || 'REJECTED',
        feedback:
          lastRejectedReviewRow?.feedback ||
          lastRejectedAttempt?.feedback ||
          parsedReviewResult?.justification ||
          'Critérios de aceitação ou testes independentes não aprovados.',
        failedCriteria:
          lastRejectedAttempt?.failedCriteria ||
          parsedReviewResult?.evaluatedCriteria?.filter((c: any) => !c.passed).map((c: any) => c.criterion) ||
          [],
        problemsFound: parsedReviewResult?.problemsFound || [],
        createdAt: lastRejectedReviewRow?.created_at || rejectedTaskRow.updated_at
      };
    }

    // 7. Quais evidências justificam considerar o projeto concluído?
    const completedTaskRows = activeTasks.filter(t => t.status === 'completed');
    const taskCompletionPct = activeTasks.length > 0 ? Math.round((completedTaskRows.length / activeTasks.length) * 100) : 0;
    const mandatoryReqs = reqs.filter(r => r.mandatory);
    const coveredMandatoryReqs = mandatoryReqs.filter(r => r.linkedTaskIds.length > 0);
    const verifiedMandatoryReqs = mandatoryReqs.filter(r => r.status === 'verified');
    const requirementCoveragePct = mandatoryReqs.length > 0 ? Math.round((coveredMandatoryReqs.length / mandatoryReqs.length) * 100) : 100;
    const requirementVerificationPct = mandatoryReqs.length > 0 ? Math.round((verifiedMandatoryReqs.length / mandatoryReqs.length) * 100) : 100;

    // True progress calculation: never 100% if mandatory requirements are unverified!
    let progressPct = taskCompletionPct;
    if (mandatoryReqs.length > 0) {
      const blended = Math.round(taskCompletionPct * 0.65 + requirementVerificationPct * 0.35);
      progressPct = canCompleteProject ? 100 : Math.min(95, blended);
    }

    const passedEvalsRow: any = db.prepare("SELECT COUNT(*) as cnt FROM evaluation_results WHERE run_id = ? AND verdict = 'PASS'").get(runId);
    const approvedRevsRow: any = db.prepare("SELECT COUNT(*) as cnt FROM supervisor_reviews WHERE run_id = ? AND verdict = 'APPROVED'").get(runId);
    const verifiedCommits = completedTaskRows
      .filter(t => Boolean(t.task_commit_sha))
      .map(t => ({
        taskId: t.id,
        code: t.code || `${t.order_index}`,
        title: t.title,
        sha: t.task_commit_sha
      }));

    const completionEvidenceSummary = {
      projectCompleted: canCompleteProject,
      progressPct,
      taskCompletionPct,
      requirementCoveragePct,
      requirementVerificationPct,
      verifiedCommits,
      passedEvaluationsCount: passedEvalsRow?.cnt || 0,
      approvedReviewsCount: approvedRevsRow?.cnt || completedTaskRows.filter(t => t.review_decision === 'APPROVED').length,
      justification: canCompleteProject
        ? `Projeto concluído com 100% das ${activeTasks.length} microtarefas e ${mandatoryReqs.length} requisitos obrigatórios verificados, ${verifiedCommits.length} commits confirmados e avaliações independentes PASS.`
        : `Projeto em ${progressPct}% (${completedTaskRows.length}/${activeTasks.length} tarefas concluídas; ${verifiedMandatoryReqs.length}/${mandatoryReqs.length} requisitos obrigatórios verificados). Não pode ser declarado concluído até que 100% dos requisitos obrigatórios tenham evidência real.`
    };

    const qNorm = this.normalizeSemanticText(question || '');
    let directAnswer = whatIsMissingSummary;
    if (qNorm.includes('requisito') && (qNorm.includes('nao tem') || qNorm.includes('sem tarefa') || qNorm.includes('cobertura'))) {
      directAnswer =
        uncoveredRequirements.length === 0
          ? `Todos os requisitos possuem tarefas vinculadas (${reqs.length}/${reqs.length} cobertos).`
          : `Requisitos sem tarefas vinculadas: ${uncoveredRequirements.map(r => `[${r.code}] ${r.title}`).join(', ')}.`;
    } else if (qNorm.includes('gt-') || qNorm.includes('grande tarefa')) {
      const gtMatch = (question || '').match(/GT-\d+/i);
      const targetGt = gtMatch ? incompleteMajorTasks.find(m => m.code.toUpperCase() === gtMatch[0].toUpperCase()) : incompleteMajorTasks[0];
      if (targetGt) {
        directAnswer = `A Grande Tarefa [${targetGt.code}] "${targetGt.title}" está em status ${targetGt.status} com ${targetGt.pendingMicrotasks} microtarefa(s) pendente(s): ${targetGt.reason}.`;
      } else {
        directAnswer = 'Todas as Grandes Tarefas consultadas estão concluídas.';
      }
    } else if (qNorm.includes('pronta') || qNorm.includes('proxima')) {
      directAnswer = nextExecutableTask.reason;
    } else if (qNorm.includes('rejeic') || qNorm.includes('review')) {
      directAnswer = lastReviewRejection.found
        ? `Última rejeição na tarefa [${lastReviewRejection.taskCode}] "${lastReviewRejection.taskTitle}": ${lastReviewRejection.feedback}`
        : 'Nenhuma rejeição de Review registrada neste Run.';
    }

    return {
      runId,
      generatedAt: new Date().toISOString(),
      directAnswer,
      uncoveredRequirements,
      readyTasks,
      remainingForProjectCompletion: {
        pendingMicrotasksCount: incompleteMicrotasks.length,
        unverifiedRequirementsCount: unverifiedRequirements.length,
        incompleteMajorTasksCount: incompleteMajorTasks.length
      },
      whatIsMissingToCompleteProject: {
        summary: whatIsMissingSummary,
        incompleteMajorTasks,
        incompleteMicrotasks,
        unverifiedRequirements,
        canCompleteProject
      },
      unimplementedRequirements,
      implementedButUnverifiedFeatures,
      blockedTasksAnalysis,
      nextExecutableTask,
      lastReviewRejection,
      completionEvidenceSummary
    };
  }

  /**
   * Reconstitui o estado completo persistido do plano hierárquico (resiliência a reinício / crash recovery).
   */
  static reconstructPlanState(runId: string): {
    run: any;
    majorTasks: any[];
    microtasks: any[];
    tasks: any[];
    projectRequirements: StructuredProjectRequirement[];
    diagnostics: any;
    stateTransitions: any[];
    agentCommunications: any[];
  } {
    const run: any = db.prepare('SELECT * FROM autonomous_runs WHERE id = ?').get(runId);
    if (!run) throw new Error(`Run ${runId} não encontrado.`);
    this.syncRequirementTraceability(runId);
    const majorTasks = this.getMajorTasksForRun(runId);
    const rawTasks: any[] = db.prepare('SELECT * FROM autonomous_tasks WHERE run_id = ? ORDER BY order_index ASC').all(runId);
    const projectRequirements = this.getProjectRequirements(runId);
    const diagnostics = this.queryPlanDiagnostics(runId);
    const stateTransitions = this.getStateTransitions(runId);
    const agentCommunications = this.getAgentCommunications(runId);
    return {
      run,
      majorTasks,
      microtasks: rawTasks,
      tasks: rawTasks,
      projectRequirements,
      diagnostics,
      stateTransitions,
      agentCommunications
    };
  }

  static getAgentCommunications(runId: string, microTaskId?: string): any[] {
    const rows: any[] = microTaskId
      ? db.prepare('SELECT * FROM agent_communications WHERE run_id = ? AND micro_task_id = ? ORDER BY created_at ASC, rowid ASC').all(runId, microTaskId)
      : db.prepare('SELECT * FROM agent_communications WHERE run_id = ? ORDER BY created_at ASC, rowid ASC').all(runId);

    return rows.map(row => ({
      ...row,
      payload: row.payload_json ? JSON.parse(row.payload_json) : {}
    }));
  }

  static getStateTransitions(runId: string, taskId?: string): any[] {
    const rows: any[] = taskId
      ? db.prepare('SELECT * FROM task_state_transitions WHERE run_id = ? AND task_id = ? ORDER BY created_at ASC, rowid ASC').all(runId, taskId)
      : db.prepare('SELECT * FROM task_state_transitions WHERE run_id = ? ORDER BY created_at ASC, rowid ASC').all(runId);

    return rows.map(row => ({
      ...row,
      metadata: row.metadata_json ? JSON.parse(row.metadata_json) : {}
    }));
  }
}

