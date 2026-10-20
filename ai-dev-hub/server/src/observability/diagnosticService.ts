/**
 * Diagnostic and Anomaly Detection Service
 * Detects stalled operations, orphaned leases/reservations, uncompleted agent turns,
 * and state divergences across DecoHUB orchestration components.
 */
import { db } from '../db.js';
import { ObservabilityService } from './observabilityService.js';
import { DetectedAnomaly } from './types.js';

export interface DiagnosticConfig {
  stalledRunThresholdMs?: number;       // default 5 minutes
  stalledTaskThresholdMs?: number;      // default 3 minutes
  stalledAgentCallThresholdMs?: number; // default 3 minutes
  orphanReservationThresholdMs?: number;// default 10 minutes
  stuckReviewThresholdMs?: number;      // default 5 minutes
}

export class DiagnosticService {
  private static lastDetectedAnomalies: DetectedAnomaly[] = [];

  /**
   * Scans system state and history to detect stalls, anomalies, and divergences.
   * Emits `diagnostic.stalled_operation_detected` for any new anomaly found.
   */
  static detectAnomalies(config?: DiagnosticConfig): DetectedAnomaly[] {
    const now = Date.now();
    const runThresholdMs = config?.stalledRunThresholdMs || 5 * 60 * 1000;
    const taskThresholdMs = config?.stalledTaskThresholdMs || 3 * 60 * 1000;
    const agentThresholdMs = config?.stalledAgentCallThresholdMs || 3 * 60 * 1000;
    const reservationThresholdMs = config?.orphanReservationThresholdMs || 10 * 60 * 1000;
    const reviewThresholdMs = config?.stuckReviewThresholdMs || 5 * 60 * 1000;

    const anomalies: DetectedAnomaly[] = [];

    // 1. Detect Stalled Runs (status = running but no recent updates or heartbeat)
    try {
      const activeRuns: any[] = db.prepare(`
        SELECT id, name, project_id, status, current_task, updated_at, consecutive_failures
        FROM autonomous_runs
        WHERE status IN ('running', 'building', 'testing', 'reviewing', 'planning')
      `).all();

      for (const run of activeRuns) {
        const lastUpdated = new Date(run.updated_at).getTime();
        const elapsedMs = now - lastUpdated;

        if (elapsedMs > runThresholdMs) {
          // Check if there is an active lease or running worker
          const activeLease: any = db.prepare("SELECT id, worker_id, lease_until FROM worker_leases WHERE run_id = ? AND status = 'active'").get(run.id);
          const activeTurn: any = db.prepare("SELECT conversation_id, phase FROM agent_turn_observations WHERE task_id IN (SELECT id FROM autonomous_tasks WHERE run_id = ?) AND phase IN ('IN_FLIGHT', 'UNCERTAIN')").get(run.id);

          if (!activeLease && !activeTurn) {
            anomalies.push({
              id: `anomaly-run-${run.id.slice(0, 8)}`,
              type: 'STALLED_RUN',
              severity: 'high',
              affectedEntity: { type: 'run', id: run.id, name: run.name },
              timeSinceLastProgressMs: elapsedMs,
              lastKnownEvent: run.current_task ? `Executando tarefa: ${run.current_task}` : 'Ciclo autônomo ativo',
              currentPersistedState: { status: run.status, updatedAt: run.updated_at, consecutiveFailures: run.consecutive_failures },
              evidence: [
                `Run "${run.name}" está com status "${run.status}" sem atualização há ${Math.round(elapsedMs / 1000)}s (limite configurado: ${Math.round(runThresholdMs / 1000)}s).`,
                'Nenhuma lease ativa encontrada na tabela worker_leases para este run.',
                'Nenhum turno nativo em voo (IN_FLIGHT/UNCERTAIN) registrado no agent_turn_observations.'
              ],
              hypotheses: [
                '[HIPÓTESE] O orquestrador pode ter sido reiniciado sem recuperar a próxima tarefa do backlog.',
                '[HIPÓTESE] As tarefas do marco atual podem estar todas concluídas aguardando revisão final.',
                '[HIPÓTESE] O projeto pode ter perdido autorização de execução ou o diretório foi desvinculado.'
              ],
              recommendedAction: `Inspecione o status das tarefas com GET /api/observability/runs/${run.id}/timeline ou tente retomar o run via painel autônomo.`,
              detectedAt: new Date(now).toISOString()
            });
          }
        }
      }
    } catch {}

    // 2. Detect Stalled Tasks (in_progress without active lease or progress)
    try {
      const inProgressTasks: any[] = db.prepare(`
        SELECT t.*, r.name as run_name
        FROM autonomous_tasks t
        JOIN autonomous_runs r ON t.run_id = r.id
        WHERE t.status = 'in_progress'
      `).all();

      for (const task of inProgressTasks) {
        const lastUpdated = new Date(task.updated_at).getTime();
        const elapsedMs = now - lastUpdated;

        if (elapsedMs > taskThresholdMs) {
          const activeLease: any = db.prepare("SELECT id, lease_until FROM worker_leases WHERE task_id = ? AND status = 'active' AND lease_until > ?").get(task.id, new Date(now).toISOString());
          const activeTurn: any = db.prepare("SELECT conversation_id, phase, updated_at FROM agent_turn_observations WHERE task_id = ? AND phase IN ('IN_FLIGHT', 'UNCERTAIN')").get(task.id);
          const recentCmd: any = db.prepare("SELECT id, command, created_at FROM command_executions WHERE task_id = ? ORDER BY created_at DESC LIMIT 1").get(task.id);

          const recentWindowMs = Math.max(Math.min(taskThresholdMs, 120 * 1000), 60 * 1000);
          const hasRecentTurnActivity = activeTurn?.updated_at && (now - new Date(activeTurn.updated_at).getTime() <= recentWindowMs);
          const hasRecentCmdActivity = recentCmd?.created_at && (now - new Date(recentCmd.created_at).getTime() <= recentWindowMs);

          if (hasRecentTurnActivity || hasRecentCmdActivity || (activeLease && activeTurn)) {
            anomalies.push({
              id: `anomaly-slow-task-${task.id.slice(0, 8)}`,
              type: 'SLOW_BUT_ACTIVE_EXECUTION',
              severity: 'low',
              failureClassification: 'SLOW_ACTIVE',
              autoRemediable: false,
              affectedEntity: { type: 'task', id: task.id, name: task.title },
              timeSinceLastProgressMs: elapsedMs,
              lastKnownEvent: recentCmd ? `Comando recente: ${recentCmd.command}` : `Turno nativo em voo (${activeTurn?.phase || 'ativo'})`,
              currentPersistedState: {
                status: task.status,
                retryCount: task.retry_count,
                updatedAt: task.updated_at,
                hasActiveLease: Boolean(activeLease),
                hasRecentTurnActivity: Boolean(hasRecentTurnActivity),
                hasRecentCmdActivity: Boolean(hasRecentCmdActivity)
              },
              evidence: [
                `Tarefa "${task.title}" está em execução há ${Math.round(elapsedMs / 1000)}s, porém apresenta atividade recente comprovada.`,
                hasRecentCmdActivity ? `Último comando registrado em ${recentCmd.created_at}: "${recentCmd.command}".` : 'Turno nativo do agente ainda em progresso ativo.'
              ],
              hypotheses: [
                '[FATO] Execução lenta mas ativa (compilação longa, suíte de testes ou raciocínio profundo em andamento). Não deve ser interrompida.'
              ],
              recommendedAction: 'Manter execução em curso sem interrupção prematura.',
              detectedAt: new Date(now).toISOString()
            });
          } else if (!activeLease) {
            anomalies.push({
              id: `anomaly-task-${task.id.slice(0, 8)}`,
              type: 'STALLED_TASK_WITHOUT_LEASE',
              severity: 'high',
              failureClassification: 'STALLED',
              autoRemediable: !activeTurn,
              affectedEntity: { type: 'task', id: task.id, name: task.title },
              timeSinceLastProgressMs: elapsedMs,
              lastKnownEvent: `Despachada para worker: ${task.assigned_to || 'builder'}`,
              currentPersistedState: { status: task.status, retryCount: task.retry_count, updatedAt: task.updated_at },
              evidence: [
                `Tarefa "${task.title}" marcada como "in_progress" há ${Math.round(elapsedMs / 1000)}s sem atualização.`,
                'Nenhuma lease ativa válida na tabela worker_leases encontrada para esta tarefa.'
              ],
              hypotheses: [
                '[HIPÓTESE] O worker pode ter caído ou o processo expirou a lease sem liberar a tarefa.',
                '[HIPÓTESE] O turno do agente pode ter terminado sem envio do relatório do Builder.'
              ],
              recommendedAction: `Reconciliar a tarefa "${task.title}" para "ready" ou aguardar ciclo de recuperação do Watchdog.`,
              detectedAt: new Date(now).toISOString()
            });
          }
        }
      }
    } catch {}

    // 3. Detect Stuck Tasks in Intermediate States (in_review for too long)
    try {
      const inReviewTasks: any[] = db.prepare(`
        SELECT t.*, r.name as run_name
        FROM autonomous_tasks t
        JOIN autonomous_runs r ON t.run_id = r.id
        WHERE t.status = 'in_review'
      `).all();

      for (const task of inReviewTasks) {
        const lastUpdated = new Date(task.updated_at).getTime();
        const elapsedMs = now - lastUpdated;

        if (elapsedMs > reviewThresholdMs) {
          const hasReport: any = db.prepare('SELECT id, status FROM builder_reports WHERE task_id = ? ORDER BY created_at DESC LIMIT 1').get(task.id);
          const hasReview: any = db.prepare('SELECT id, verdict FROM supervisor_reviews WHERE task_id = ? ORDER BY created_at DESC LIMIT 1').get(task.id);

          anomalies.push({
            id: `anomaly-review-${task.id.slice(0, 8)}`,
            type: 'TASK_STUCK_IN_REVIEW',
            severity: 'medium',
            failureClassification: 'TRANSIENT',
            autoRemediable: (!hasReport && !hasReview) || (Boolean(hasReview) && hasReview.verdict === 'APPROVED'),
            affectedEntity: { type: 'task', id: task.id, name: task.title },
            timeSinceLastProgressMs: elapsedMs,
            lastKnownEvent: hasReport ? 'Relatório do Builder recebido' : 'Entrou em revisão',
            currentPersistedState: {
              status: task.status,
              hasReport: Boolean(hasReport),
              reportStatus: hasReport?.status,
              hasReview: Boolean(hasReview),
              reviewVerdict: hasReview?.verdict
            },
            evidence: [
              `Tarefa "${task.title}" está em "in_review" há ${Math.round(elapsedMs / 1000)}s.`,
              hasReport ? `Relatório do Builder existe (${hasReport.id.slice(0, 8)}).` : 'Nenhum relatório do Builder encontrado.',
              hasReview ? `Revisão do Supervisor já existe com veredicto "${hasReview.verdict}".` : 'Nenhuma revisão do Supervisor registrada.'
            ],
            hypotheses: [
              '[HIPÓTESE] O Supervisor pode não ter sido acionado ou falhou silenciosamente antes de persistir o parecer.',
              '[HIPÓTESE] Pode ter ocorrido conflito de concorrência durante a transição para completed.'
            ],
            recommendedAction: `Verificar os logs de revisão do Supervisor com GET /api/observability/tasks/${task.id}/events.`,
            detectedAt: new Date(now).toISOString()
          });
        }
      }
    } catch {}

    // 4. Detect Expired Leases in active state
    try {
      const expiredLeases: any[] = db.prepare(`
        SELECT l.*, w.name as worker_name
        FROM worker_leases l
        LEFT JOIN workers w ON l.worker_id = w.id
        WHERE l.status = 'active' AND l.lease_until < ?
      `).all(new Date(now).toISOString());

      for (const lease of expiredLeases) {
        const leaseUntil = new Date(lease.lease_until).getTime();
        const elapsedMs = now - leaseUntil;

        anomalies.push({
          id: `anomaly-lease-${lease.id.slice(0, 8)}`,
          type: 'EXPIRED_LEASE_NOT_RECONCILED',
          severity: 'medium',
          failureClassification: 'TRANSIENT',
          autoRemediable: true,
          affectedEntity: { type: 'lease', id: lease.id, name: `Lease ${lease.worker_name || lease.worker_id}` },
          timeSinceLastProgressMs: elapsedMs,
          lastKnownEvent: `Lease claimed em ${lease.claimed_at}`,
          currentPersistedState: { status: lease.status, leaseUntil: lease.lease_until, workerId: lease.worker_id },
          evidence: [
            `Lease ${lease.id.slice(0, 8)} expirou há ${Math.round(elapsedMs / 1000)}s e ainda está com status="active".`
          ],
          hypotheses: [
            '[HIPÓTESE] O worker deixou de enviar batimentos cardíacos (heartbeats).',
            '[HIPÓTESE] O ciclo do Watchdog ainda não processou a expiração desta lease.'
          ],
          recommendedAction: 'Aguardar o próximo tick do Watchdog para expiração automática ou liberar a lease.',
          detectedAt: new Date(now).toISOString()
        });
      }
    } catch {}

    // 5. Detect Orphaned Execution Reservations
    try {
      const reservations: any[] = db.prepare('SELECT * FROM execution_reservations').all();
      for (const res of reservations) {
        const createdAt = new Date(res.created_at).getTime();
        const elapsedMs = now - createdAt;

        let pidAlive = true;
        try {
          process.kill(res.owner_pid, 0);
        } catch (e: any) {
          if (e.code === 'ESRCH') pidAlive = false;
        }

        if (!pidAlive || elapsedMs > reservationThresholdMs) {
          anomalies.push({
            id: `anomaly-reservation-${res.scope}`,
            type: 'ORPHAN_EXECUTION_RESERVATION',
            severity: !pidAlive ? 'high' : 'medium',
            failureClassification: 'TRANSIENT',
            autoRemediable: !pidAlive,
            affectedEntity: { type: 'reservation', id: res.scope, name: `Reserva ${res.scope}` },
            timeSinceLastProgressMs: elapsedMs,
            lastKnownEvent: `Reserva criada em ${res.created_at} por PID ${res.owner_pid}`,
            currentPersistedState: { scope: res.scope, token: res.token, ownerPid: res.owner_pid, pidAlive },
            evidence: [
              `Reserva "${res.scope}" existe há ${Math.round(elapsedMs / 1000)}s.`,
              `Processo proprietário PID ${res.owner_pid} está ${pidAlive ? 'VIVO' : 'MORTO (não existe mais)'}.`
            ],
            hypotheses: [
              '[HIPÓTESE] O processo que adquiriu a trava de execução terminou inesperadamente antes de liberá-la.'
            ],
            recommendedAction: `Liberar a trava com ExecutionCoordinator.release('${res.scope}', '${res.token}') se nenhuma operação legítima estiver em curso.`,
            detectedAt: new Date(now).toISOString()
          });
        }
      }
    } catch {}

    // 6. Detect State Divergences between Task and Run
    try {
      const completedRunsWithPendingTasks: any[] = db.prepare(`
        SELECT r.id, r.name, r.status, COUNT(t.id) as pending_count
        FROM autonomous_runs r
        JOIN autonomous_tasks t ON r.id = t.run_id
        WHERE r.status = 'completed' AND t.status NOT IN ('completed')
        GROUP BY r.id
      `).all();

      for (const div of completedRunsWithPendingTasks) {
        anomalies.push({
          id: `anomaly-divergence-${div.id.slice(0, 8)}`,
          type: 'RUN_TASK_STATE_DIVERGENCE',
          severity: 'medium',
          failureClassification: 'PERSISTENT',
          affectedEntity: { type: 'run', id: div.id, name: div.name },
          timeSinceLastProgressMs: 0,
          lastKnownEvent: 'Run marcado como completed',
          currentPersistedState: { runStatus: div.status, pendingTasksCount: div.pending_count },
          evidence: [
            `Run "${div.name}" está com status="completed", mas possui ${div.pending_count} tarefa(s) pendente(s) ou em andamento.`
          ],
          hypotheses: [
            '[HIPÓTESE] O run pode ter sido concluído prematuramente ou tarefas adicionais foram adicionadas após a finalização.'
          ],
          recommendedAction: 'Verificar se as tarefas pendentes devem ser canceladas ou se o run deve ser reativado.',
          detectedAt: new Date(now).toISOString()
        });
      }
    } catch {}

    // 7. Detect Repetitive Errors and Correlate with Historical Operational Lessons
    try {
      const repeatedTasks: any[] = db.prepare(`
        SELECT t.*, r.project_id, r.name as run_name
        FROM autonomous_tasks t
        JOIN autonomous_runs r ON t.run_id = r.id
        WHERE t.retry_count >= 2 AND t.status IN ('needs_changes', 'in_progress', 'blocked')
      `).all();

      for (const task of repeatedTasks) {
        const lesson: any = db.prepare(`
          SELECT * FROM operational_lessons
          WHERE project_id = ? AND (task_id = ? OR problem_summary LIKE ?)
          ORDER BY updated_at DESC LIMIT 1
        `).get(task.project_id, task.id, `%${task.title.slice(0, 30)}%`);

        const latestEval: any = db.prepare(`
          SELECT verdict, actual_result FROM evaluation_results
          WHERE task_id = ? ORDER BY evaluated_at DESC LIMIT 1
        `).get(task.id);

        anomalies.push({
          id: `anomaly-repeat-${task.id.slice(0, 8)}`,
          type: 'REPETITIVE_ERROR_PATTERN',
          severity: task.retry_count >= 3 ? 'high' : 'medium',
          failureClassification: 'PERSISTENT',
          relatedLessonId: lesson?.id || null,
          autoRemediable: false,
          affectedEntity: { type: 'task', id: task.id, name: task.title },
          timeSinceLastProgressMs: now - new Date(task.updated_at).getTime(),
          lastKnownEvent: latestEval?.actual_result || lesson?.root_cause || `Tentativa ${task.retry_count} sem convergência`,
          currentPersistedState: {
            status: task.status,
            retryCount: task.retry_count,
            lessonCategory: lesson?.category || null,
            lessonOccurrences: lesson?.occurrences || task.retry_count
          },
          evidence: [
            `Tarefa "${task.title}" acumulou ${task.retry_count} falhas consecutivas (status="${task.status}").`,
            lesson ? `Correlacionada com lição operacional #${lesson.id.slice(0, 8)} (${lesson.category}/${lesson.failure_classification}): "${lesson.root_cause}".` : 'Padrão de erro persistente detectado em retentativas.',
            lesson?.failed_strategy ? `Estratégia que já falhou: "${lesson.failed_strategy}".` : 'Mesma abordagem falhou em múltiplas tentativas.'
          ],
          hypotheses: [
            '[FATO] O erro não é transitório; repetir a mesma estratégia sem alterar a abordagem ou o contrato causará novo bloqueio.'
          ],
          recommendedAction: lesson?.working_strategy
            ? `Aplicar estratégia validada anteriormente: ${lesson.working_strategy}`
            : 'Alterar estratégia de implementação ou decompor a tarefa via replanejamento incremental do Supervisor.',
          detectedAt: new Date(now).toISOString()
        });
      }
    } catch {}

    // 8. Detect Unexecuted Verifications on Reviewed/Completed Tasks
    try {
      const unexecutedEvals: any[] = db.prepare(`
        SELECT e.id as eval_id, e.task_id, e.verdict, e.executed_commands_json, e.evaluated_at,
               t.title as task_title, t.status as task_status, t.run_id
        FROM evaluation_results e
        JOIN autonomous_tasks t ON e.task_id = t.id
        WHERE t.status IN ('in_review', 'completed')
          AND (e.executed_commands_json IS NULL OR e.executed_commands_json = '[]')
      `).all();

      for (const row of unexecutedEvals) {
        anomalies.push({
          id: `anomaly-unexec-verif-${row.task_id.slice(0, 8)}`,
          type: 'UNEXECUTED_VERIFICATION',
          severity: 'high',
          failureClassification: 'PERSISTENT',
          autoRemediable: false,
          affectedEntity: { type: 'task', id: row.task_id, name: row.task_title },
          timeSinceLastProgressMs: now - new Date(row.evaluated_at).getTime(),
          lastKnownEvent: `Avaliação ${row.verdict} registrada sem comandos executados`,
          currentPersistedState: {
            taskStatus: row.task_status,
            evalVerdict: row.verdict,
            executedCommands: []
          },
          evidence: [
            `Tarefa "${row.task_title}" (${row.task_status}) possui registro de avaliação (${row.eval_id.slice(0, 8)}) com lista de comandos executados vazia ([]).`
          ],
          hypotheses: [
            '[HIPÓTESE] O contrato da tarefa não continha etapas de comando executáveis ou a verificação foi ignorada.'
          ],
          recommendedAction: 'Exigir reavaliação pelo IndependentEvaluator com comando de verificação real.',
          detectedAt: new Date(now).toISOString()
        });
      }
    } catch {}

    // 9. Detect Recurring Quota or Authentication Failures
    try {
      const degradedProfiles: any[] = db.prepare(`
        SELECT id, display_name, profile_name, auth_status, quota_resets_at, quota_message, updated_at
        FROM account_profiles
        WHERE auth_status IN ('QUOTA_EXHAUSTED', 'NEEDS_LOGIN', 'INVALID')
      `).all();

      for (const prof of degradedProfiles) {
        const affectedRun: any = db.prepare(`
          SELECT r.id, r.name, r.status
          FROM autonomous_runs r
          JOIN projects p ON r.project_id = p.id
          WHERE (p.active_account_profile_id = ? OR p.active_account_profile_id IS NULL)
            AND r.status IN ('running', 'paused', 'building', 'reviewing')
          ORDER BY r.updated_at DESC LIMIT 1
        `).get(prof.id);

        if (affectedRun) {
          const isQuota = prof.auth_status === 'QUOTA_EXHAUSTED';
          anomalies.push({
            id: `anomaly-auth-${prof.id.slice(0, 8)}`,
            type: 'RECURRING_QUOTA_OR_AUTH_FAILURE',
            severity: isQuota ? 'medium' : 'high',
            failureClassification: isQuota ? 'TRANSIENT' : 'PERSISTENT',
            autoRemediable: false,
            affectedEntity: { type: 'system', id: prof.id, name: prof.display_name },
            timeSinceLastProgressMs: now - new Date(prof.updated_at).getTime(),
            lastKnownEvent: prof.quota_message || `Status de conta: ${prof.auth_status}`,
            currentPersistedState: {
              authStatus: prof.auth_status,
              quotaResetsAt: prof.quota_resets_at,
              affectedRunId: affectedRun.id
            },
            evidence: [
              `Perfil "${prof.display_name}" está em estado "${prof.auth_status}" impactando o run "${affectedRun.name}".`,
              prof.quota_resets_at ? `Janela de reset estimada: ${prof.quota_resets_at}.` : 'Reautenticação necessária.'
            ],
            hypotheses: [
              isQuota
                ? '[FATO] Limite transitório de cota da API atingido; execução poderá retomar após o reset ou troca de perfil.'
                : '[FATO] Falha persistente de autenticação no perfil configurado.'
            ],
            recommendedAction: isQuota
              ? 'Aguardar janela de reset de cota ou alternar para outro perfil autenticado.'
              : 'Reautenticar a conta no gerenciador de perfis do DecoHUB.',
            detectedAt: new Date(now).toISOString()
          });
        }
      }
    } catch {}

    // Emit diagnostic event for newly detected anomalies
    for (const anomaly of anomalies) {
      const alreadyReported = this.lastDetectedAnomalies.some(a => a.id === anomaly.id);
      if (!alreadyReported) {
        ObservabilityService.emit({
          level: anomaly.severity === 'high' || anomaly.severity === 'critical' ? 'ERROR' : 'WARN',
          event: 'diagnostic.stalled_operation_detected',
          message: `[DIAGNÓSTICO] Anomalia detectada: ${anomaly.type} em ${anomaly.affectedEntity.type} "${anomaly.affectedEntity.name || anomaly.affectedEntity.id}"`,
          service: 'diagnostic',
          runId: anomaly.affectedEntity.type === 'run' ? anomaly.affectedEntity.id : undefined,
          taskId: anomaly.affectedEntity.type === 'task' ? anomaly.affectedEntity.id : undefined,
          metadata: {
            anomalyId: anomaly.id,
            anomalyType: anomaly.type,
            severity: anomaly.severity,
            failureClassification: anomaly.failureClassification,
            relatedLessonId: anomaly.relatedLessonId,
            timeSinceLastProgressMs: anomaly.timeSinceLastProgressMs,
            evidence: anomaly.evidence,
            hypotheses: anomaly.hypotheses,
            recommendedAction: anomaly.recommendedAction
          }
        });
      }
    }

    this.lastDetectedAnomalies = anomalies;
    return anomalies;
  }

  /**
   * Smart Auto-Remediation:
   * Safely heals transient orchestration anomalies without falsifying evidence or weakening gates:
   * - Reconciles expired active leases and frees stuck workers
   * - Releases execution_reservations held by dead PIDs
   * - Reconciles tasks stuck in `in_review`:
   *   * If a valid PASS IndependentEvaluator result AND APPROVED Supervisor review already exist, completes the task
   *   * If stuck in `in_review` with NO Builder report and NO review, resets to `ready`
   * - Reconciles `STALLED_TASK_WITHOUT_LEASE` (when no IN_FLIGHT/UNCERTAIN turn exists) back to `ready`
   */
  static remediateAnomalies(config?: DiagnosticConfig): {
    detected: DetectedAnomaly[];
    remediated: Array<{ anomalyId: string; type: string; entityId: string; actionTaken: string }>;
  } {
    const detected = this.detectAnomalies(config);
    const remediated: Array<{ anomalyId: string; type: string; entityId: string; actionTaken: string }> = [];
    const nowIso = new Date().toISOString();

    for (const anomaly of detected) {
      try {
        if (anomaly.type === 'EXPIRED_LEASE_NOT_RECONCILED') {
          const leaseId = anomaly.affectedEntity.id;
          const workerId = anomaly.currentPersistedState?.workerId;
          db.prepare("UPDATE worker_leases SET status = 'expired', released_at = ? WHERE id = ? AND status = 'active'").run(nowIso, leaseId);
          if (workerId) {
            db.prepare("UPDATE workers SET status = 'READY', current_task_id = NULL, current_run_id = NULL, updated_at = ? WHERE id = ? AND status = 'BUSY'").run(nowIso, workerId);
          }
          remediated.push({
            anomalyId: anomaly.id,
            type: anomaly.type,
            entityId: leaseId,
            actionTaken: 'Lease expirada marcada como expired e worker liberado para READY.'
          });
        } else if (anomaly.type === 'ORPHAN_EXECUTION_RESERVATION' && anomaly.currentPersistedState?.pidAlive === false) {
          const scope = anomaly.affectedEntity.id;
          db.prepare('DELETE FROM execution_reservations WHERE scope = ? AND owner_pid = ?').run(scope, anomaly.currentPersistedState.ownerPid);
          remediated.push({
            anomalyId: anomaly.id,
            type: anomaly.type,
            entityId: scope,
            actionTaken: `Reserva órfã do PID morto ${anomaly.currentPersistedState.ownerPid} removida.`
          });
        } else if (anomaly.type === 'TASK_STUCK_IN_REVIEW') {
          const taskId = anomaly.affectedEntity.id;
          const state = anomaly.currentPersistedState || {};
          if (state.hasReview && state.reviewVerdict === 'APPROVED') {
            const evalRow: any = db.prepare(
              "SELECT verdict, task_is_done FROM evaluation_results WHERE task_id = ? ORDER BY evaluated_at DESC LIMIT 1"
            ).get(taskId);
            if (evalRow && evalRow.verdict === 'PASS' && Boolean(evalRow.task_is_done)) {
              db.prepare("UPDATE autonomous_tasks SET status = 'completed', updated_at = ? WHERE id = ? AND status = 'in_review'").run(nowIso, taskId);
              remediated.push({
                anomalyId: anomaly.id,
                type: anomaly.type,
                entityId: taskId,
                actionTaken: 'Tarefa em in_review que já possuía avaliação PASS e revisão APPROVED foi reconciliada para completed.'
              });
            }
          } else if (!state.hasReport && !state.hasReview) {
            db.prepare("UPDATE autonomous_tasks SET status = 'ready', updated_at = ? WHERE id = ? AND status = 'in_review'").run(nowIso, taskId);
            remediated.push({
              anomalyId: anomaly.id,
              type: anomaly.type,
              entityId: taskId,
              actionTaken: 'Tarefa em in_review sem relatório de Builder foi reconciliada para ready.'
            });
          }
        } else if (anomaly.type === 'STALLED_TASK_WITHOUT_LEASE' && anomaly.autoRemediable) {
          const taskId = anomaly.affectedEntity.id;
          const activeTurn: any = db.prepare(
            "SELECT phase FROM agent_turn_observations WHERE task_id = ? AND phase IN ('IN_FLIGHT', 'UNCERTAIN')"
          ).get(taskId);
          if (!activeTurn) {
            db.prepare("UPDATE autonomous_tasks SET status = 'ready', updated_at = ? WHERE id = ? AND status = 'in_progress'").run(nowIso, taskId);
            remediated.push({
              anomalyId: anomaly.id,
              type: anomaly.type,
              entityId: taskId,
              actionTaken: 'Tarefa órfã em in_progress sem lease e sem turno ativo foi reconciliada para ready.'
            });
          }
        }
      } catch {}
    }

    for (const rem of remediated) {
      ObservabilityService.emit({
        level: 'INFO',
        event: 'diagnostic.anomaly_auto_remediated',
        message: `[AUTO-RECUPERAÇÃO] ${rem.type} (${rem.entityId}): ${rem.actionTaken}`,
        service: 'diagnostic',
        taskId: rem.type.includes('TASK') ? rem.entityId : undefined,
        metadata: rem
      });
    }

    return { detected, remediated };
  }

  static getActiveAnomalies(): DetectedAnomaly[] {
    return this.detectAnomalies();
  }
}
