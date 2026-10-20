// server/src/conversationManager.ts
// Central manager for persistent agent conversations, reuse lifecycle, and controlled rotation.

import { execFileSync } from 'node:child_process';
import { db } from './db.js';
import { Logger } from './logger.js';
import { getLanguageServerExe } from './antigravityProvider.js';

export type ConversationRole = 'supervisor' | 'worker' | 'probe';
export type ConversationStatus = 'active' | 'retired' | 'invalid';

export interface ConversationRecord {
  conversation_id: string;
  project_id: string | null;
  account_profile_id: string;
  role: ConversationRole;
  worker_id: string | null;
  run_id: string | null;
  title: string;
  status: ConversationStatus;
  created_at: string;
  last_used_at: string;
  turn_count: number;
  rotation_index: number;
  rotation_reason: string | null;
  parent_conversation_id: string | null;
  is_hidden: number;
  prompt_id?: string | null;
  prompt_hash?: string | null;
}

export interface GetOrCreateConversationParams {
  projectId?: string | null;
  accountProfileId: string;
  role: ConversationRole;
  workerId?: string | null;
  runId?: string | null;
  model: string;
  initialPrompt?: string;
  env?: NodeJS.ProcessEnv;
  forceNew?: boolean;
  rotationReason?: string;
  promptId?: string | null;
  promptHash?: string | null;
}

export interface SendMessageOptions {
  conversationId: string;
  prompt: string;
  projectId?: string | null;
  accountProfileId: string;
  role: ConversationRole;
  workerId?: string | null;
  runId?: string | null;
  model: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  promptId?: string | null;
  promptHash?: string | null;
}

export class ConversationManager {
  private static _validationOverride: ((convId: string) => boolean) | null = null;
  private static _createOverride: ((params: GetOrCreateConversationParams, title: string) => string) | null = null;
  private static _sendMessageOverride: ((convId: string, prompt: string) => void) | null = null;

  /**
   * For deterministic testing: override conversation liveness validation
   */
  static setValidationOverride(fn: ((convId: string) => boolean) | null) {
    this._validationOverride = fn;
  }

  /**
   * For deterministic testing: override agentapi conversation creation
   */
  static setCreateOverride(fn: ((params: GetOrCreateConversationParams, title: string) => string) | null) {
    this._createOverride = fn;
  }

  /**
   * For deterministic testing: override agentapi send-message
   */
  static setSendMessageOverride(fn: ((convId: string, prompt: string) => void) | null) {
    this._sendMessageOverride = fn;
  }

  /**
   * Validates if an error is strictly an unequivocal project/workspace mismatch.
   * Generic errors (auth, token, dead process, etc.) must NEVER trigger rotation.
   */
  static isProjectMismatchError(error: any): boolean {
    if (!error) return false;
    const msg = String(error.message || error.stderr || error.stdout || error);
    // Patterns matching language_server gRPC permission denied due to project_id mismatch:
    // e.g.: 'source project_id "..." does not match target project_id "..."'
    const hasPermissionDenied = msg.includes('permission_denied') || msg.includes('PermissionDenied');
    const hasProjectMismatch = (msg.includes('source project_id') && msg.includes('target project_id')) ||
                               msg.includes('does not match target project_id') ||
                               msg.includes('project_id mismatch') ||
                               msg.includes('workspace mismatch');
    return hasPermissionDenied && hasProjectMismatch;
  }

  /**
   * Validates if a conversation is physically alive and responsive via agentapi
   */
  static isConversationAlive(conversationId: string, env?: NodeJS.ProcessEnv): boolean {
    if (!conversationId) return false;
    if (this._validationOverride) {
      return this._validationOverride(conversationId);
    }

    try {
      const exe = getLanguageServerExe();
      const rawEnv = env || process.env;
      const cleanEnv: NodeJS.ProcessEnv = { ...rawEnv };
      delete cleanEnv.ELECTRON_RUN_AS_NODE;
      delete cleanEnv.ELECTRON_NO_ASAR;
      delete cleanEnv.ELECTRON_OZONE_PLATFORM_HINT;
      delete cleanEnv.ELECTRON_ENABLE_LOGGING;

      const output = execFileSync(
        exe,
        ['agentapi', 'get-conversation-metadata', conversationId],
        { encoding: 'utf-8', timeout: 8000, env: cleanEnv }
      );
      const parsed = JSON.parse(output);
      const meta = parsed?.response?.conversationMetadata?.metadata;
      return Boolean(meta && meta.rootConversationId === conversationId);
    } catch {
      return false;
    }
  }

  /**
   * Finds the currently active leaf conversation for a given role and entity.
   */
  static getActiveLeaf(params: {
    projectId?: string | null;
    accountProfileId: string;
    role: ConversationRole;
    workerId?: string | null;
  }): ConversationRecord | undefined {
    const { projectId = null, accountProfileId, role, workerId = null } = params;

    if (role === 'probe') {
      return db.prepare(`
        SELECT * FROM conversations
        WHERE account_profile_id = ? AND role = 'probe' AND status = 'active'
        ORDER BY rotation_index DESC, last_used_at DESC
        LIMIT 1
      `).get(accountProfileId) as ConversationRecord | undefined;
    } else if (role === 'supervisor') {
      return db.prepare(`
        SELECT * FROM conversations
        WHERE project_id = ? AND account_profile_id = ? AND role = 'supervisor' AND status = 'active'
        ORDER BY rotation_index DESC, last_used_at DESC
        LIMIT 1
      `).get(projectId, accountProfileId) as ConversationRecord | undefined;
    } else if (role === 'worker') {
      if (workerId) {
        return db.prepare(`
          SELECT * FROM conversations
          WHERE worker_id = ? AND account_profile_id = ? AND role = 'worker' AND status = 'active'
          ORDER BY rotation_index DESC, last_used_at DESC
          LIMIT 1
        `).get(workerId, accountProfileId) as ConversationRecord | undefined;
      }
    }
    return undefined;
  }

  /**
   * Finds an existing active leaf and healthy conversation or creates a new persistent one.
   */
  static getOrCreateConversation(params: GetOrCreateConversationParams): { conversationId: string; isNew: boolean } {
    const {
      projectId = null,
      accountProfileId,
      role,
      workerId = null,
      runId = null,
      model,
      initialPrompt,
      env,
      forceNew = false,
      rotationReason
    } = params;

    const nowIso = new Date().toISOString();

    if (!forceNew) {
      const candidate = this.getActiveLeaf({ projectId, accountProfileId, role, workerId });

      if (candidate) {
        // If a specific promptId or promptHash is requested (e.g. Fable Worker V1), check for prompt version change
        const promptChanged = Boolean(
          (params.promptId && (!candidate.prompt_id || candidate.prompt_id !== params.promptId)) ||
          (params.promptHash && (!candidate.prompt_hash || candidate.prompt_hash !== params.promptHash))
        );

        if (promptChanged) {
          Logger.warn(`[ConversationManager] PROMPT_VERSION_CHANGE detectada em ${candidate.conversation_id.slice(0, 8)} (${candidate.prompt_id || 'legacy'} -> ${params.promptId}). Executando controlled rotation.`);
          this.retireConversation(candidate.conversation_id, 'PROMPT_VERSION_CHANGE');
          // Fall through to create new conversation with promptId and promptHash
        } else {
          // Validate liveness
          if (this.isConversationAlive(candidate.conversation_id, env)) {
            db.prepare(`
              UPDATE conversations
              SET last_used_at = ?, turn_count = turn_count + 1, run_id = COALESCE(?, run_id),
                  prompt_id = COALESCE(prompt_id, ?), prompt_hash = COALESCE(prompt_hash, ?)
              WHERE conversation_id = ?
            `).run(nowIso, runId, params.promptId || null, params.promptHash || null, candidate.conversation_id);

            Logger.info(`[ConversationManager] Reutilizando conversation persistente "${candidate.title}" (${candidate.conversation_id.slice(0, 8)}) [Role: ${role}, Turn: ${candidate.turn_count + 1}, Rot: ${candidate.rotation_index}]`);
            return { conversationId: candidate.conversation_id, isNew: false };
          } else {
            Logger.warn(`[ConversationManager] Conversation anterior (${candidate.conversation_id.slice(0, 8)}) não responde. Marcando como INVALID.`);
            this.retireConversation(candidate.conversation_id, 'CONVERSATION_INVALID');
          }
        }
      }
    }

    // Determine rotation index and parent from the latest record (active or retired)
    let rotationIndex = 1;
    let parentConversationId: string | null = null;
    const latestAny = db.prepare(`
      SELECT * FROM conversations
      WHERE account_profile_id = ? AND role = ? AND (worker_id IS ? OR worker_id = ?)
      ORDER BY rotation_index DESC, created_at DESC
      LIMIT 1
    `).get(accountProfileId, role, workerId, workerId) as ConversationRecord | undefined;

    if (latestAny) {
      rotationIndex = latestAny.rotation_index + 1;
      parentConversationId = latestAny.conversation_id;
    }

    // Determine clean user-facing title
    let title = '';
    let isHidden = 0;
    if (role === 'probe') {
      title = `DecoHUB — Probe (${accountProfileId})`;
      isHidden = 1;
    } else if (role === 'supervisor') {
      title = rotationIndex === 1
        ? `DecoHUB — Supervisor`
        : `DecoHUB — Supervisor · Context ${rotationIndex}`;
    } else {
      const workerLabel = workerId ? `Worker 1` : 'Worker';
      title = rotationIndex === 1
        ? `DecoHUB — ${workerLabel}`
        : `DecoHUB — ${workerLabel} · Context ${rotationIndex}`;
    }

    // Create new conversation via agentapi
    let conversationId: string;
    if (this._createOverride) {
      conversationId = this._createOverride(params, title);
    } else {
      const exe = getLanguageServerExe();
      const rawEnv = env || process.env;
      const cleanEnv: NodeJS.ProcessEnv = { ...rawEnv };
      delete cleanEnv.ELECTRON_RUN_AS_NODE;
      delete cleanEnv.ELECTRON_NO_ASAR;
      delete cleanEnv.ELECTRON_OZONE_PLATFORM_HINT;
      delete cleanEnv.ELECTRON_ENABLE_LOGGING;

      const prompt = initialPrompt || `Sessão persistente do DecoHUB iniciada para papel ${role}.`;

      const out = execFileSync(
        exe,
        ['agentapi', 'new-conversation', `--model=${model}`, `--title=${title}`, prompt],
        { encoding: 'utf-8', timeout: 45000, env: cleanEnv }
      );
      const parsed = JSON.parse(out);
      conversationId = parsed?.response?.newConversation?.conversationId;
      if (!conversationId) {
        throw new Error(`Falha ao criar conversation via agentapi: ${out}`);
      }
    }

    // Persist in SQLite within a transaction to maintain atomic active leaf invariants
    db.exec('BEGIN IMMEDIATE');
    try {
      if (parentConversationId) {
        // Ensure parent is retired
        db.prepare("UPDATE conversations SET status = 'retired', last_used_at = ? WHERE conversation_id = ?")
          .run(nowIso, parentConversationId);
      }

      db.prepare(`
        INSERT INTO conversations (
          conversation_id, project_id, account_profile_id, role, worker_id, run_id,
          title, status, created_at, last_used_at, turn_count, rotation_index,
          rotation_reason, parent_conversation_id, is_hidden, prompt_id, prompt_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, 1, ?, ?, ?, ?, ?, ?)
      `).run(
        conversationId,
        projectId,
        accountProfileId,
        role,
        workerId,
        runId,
        title,
        nowIso,
        nowIso,
        rotationIndex,
        rotationReason || (rotationIndex > 1 ? 'ROTATION' : null),
        parentConversationId,
        isHidden,
        params.promptId || null,
        params.promptHash || null
      );

      // If this is a worker, update the worker table to point to this active leaf
      if (role === 'worker' && workerId) {
        db.prepare("UPDATE workers SET conversation_id = ?, updated_at = ? WHERE id = ?")
          .run(conversationId, nowIso, workerId);
      }

      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }

    Logger.success(`[ConversationManager] Nova conversation persistente criada: "${title}" (${conversationId.slice(0, 8)}) [Role: ${role}, RotIndex: ${rotationIndex}]`);
    return { conversationId, isNew: true };
  }

  /**
   * Core reuse-first sendMessage method with controlled handoff strictly on verified PROJECT_CONTEXT_MISMATCH.
   */
  static sendMessageOrRotate(options: SendMessageOptions): { conversationId: string; rotated: boolean } {
    const {
      conversationId,
      prompt,
      projectId,
      accountProfileId,
      role,
      workerId,
      runId,
      model,
      env,
      timeoutMs = 45000
    } = options;

    let targetConvId = conversationId;

    // Check if the provided conversation is still the active leaf
    const activeLeaf = this.getActiveLeaf({ projectId, accountProfileId, role, workerId });
    if (activeLeaf && activeLeaf.conversation_id !== targetConvId) {
      Logger.info(`[ConversationManager] Redirecionando para active leaf atualizado: ${activeLeaf.conversation_id.slice(0, 8)}`);
      targetConvId = activeLeaf.conversation_id;
    }

    // 1. Attempt send-message on existing conversation
    try {
      this.rawSendMessage(targetConvId, prompt, env, timeoutMs);
      this.recordTurn(targetConvId);
      Logger.info(`[ConversationManager] send-message reutilizado com sucesso na conversation ${targetConvId.slice(0, 8)}`);
      return { conversationId: targetConvId, rotated: false };
    } catch (err: any) {
      // 2. Strict inspection: only rotate on verified project/workspace mismatch!
      const isMismatch = this.isProjectMismatchError(err);
      if (!isMismatch) {
        Logger.error(`[ConversationManager] send-message falhou com erro real (NÃO é project mismatch): ${err.message}`);
        throw err;
      }

      // 3. Controlled Handoff: atomic creation of exactly 1 new conversation as active leaf
      Logger.warn(`[ConversationManager] CONVERSATION_HANDOFF detectado por project mismatch em ${targetConvId.slice(0, 8)}. Realizando controlled handoff...`);

      // Retire the mismatched conversation
      this.retireConversation(targetConvId, 'PROJECT_CONTEXT_MISMATCH');

      const handoffResult = this.getOrCreateConversation({
        projectId,
        accountProfileId,
        role,
        workerId,
        runId,
        model,
        env,
        forceNew: true,
        rotationReason: 'PROJECT_CONTEXT_MISMATCH',
        initialPrompt: prompt,
        promptId: options.promptId,
        promptHash: options.promptHash
      });

      const newConvId = handoffResult.conversationId;
      const newRec = this.getConversation(newConvId);

      Logger.warn(
        `CONVERSATION_HANDOFF ` +
        `reason=PROJECT_CONTEXT_MISMATCH ` +
        `from=${targetConvId.slice(0, 8)} ` +
        `to=${newConvId.slice(0, 8)} ` +
        `rotation=${newRec?.rotation_index ?? 'N/A'}`
      );

      // If it wasn't created via override with prompt already delivered, send message if needed
      // (new-conversation already received prompt as initialPrompt, so no extra send-message needed!)
      return { conversationId: newConvId, rotated: true };
    }
  }

  /**
   * Internal raw execution of agentapi send-message
   */
  private static rawSendMessage(conversationId: string, prompt: string, env?: NodeJS.ProcessEnv, timeoutMs = 45000): void {
    if (this._sendMessageOverride) {
      this._sendMessageOverride(conversationId, prompt);
      return;
    }

    const exe = getLanguageServerExe();
    const rawEnv = env || process.env;
    const cleanEnv: NodeJS.ProcessEnv = { ...rawEnv };
    delete cleanEnv.ELECTRON_RUN_AS_NODE;
    delete cleanEnv.ELECTRON_NO_ASAR;
    delete cleanEnv.ELECTRON_OZONE_PLATFORM_HINT;
    delete cleanEnv.ELECTRON_ENABLE_LOGGING;

    execFileSync(
      exe,
      ['agentapi', 'send-message', conversationId, prompt],
      { encoding: 'utf-8', timeout: timeoutMs, env: cleanEnv }
    );
  }

  /**
   * Retires an active conversation with an explicit reason
   */
  static retireConversation(conversationId: string, reason: string): void {
    const nowIso = new Date().toISOString();
    db.prepare(`
      UPDATE conversations
      SET status = 'retired', rotation_reason = ?, last_used_at = ?
      WHERE conversation_id = ?
    `).run(reason, nowIso, conversationId);
    Logger.info(`[ConversationManager] Conversation ${conversationId.slice(0, 8)} aposentada. Razão: ${reason}`);
  }

  /**
   * Records a turn increment on an existing conversation
   */
  static recordTurn(conversationId: string): void {
    const nowIso = new Date().toISOString();
    db.prepare(`
      UPDATE conversations
      SET turn_count = turn_count + 1, last_used_at = ?
      WHERE conversation_id = ?
    `).run(nowIso, conversationId);
  }

  /**
   * Gets conversation details from DB
   */
  static getConversation(conversationId: string): ConversationRecord | undefined {
    return db.prepare('SELECT * FROM conversations WHERE conversation_id = ?').get(conversationId) as ConversationRecord | undefined;
  }

  /**
   * Returns all active conversations
   */
  static getActiveConversations(): ConversationRecord[] {
    return db.prepare("SELECT * FROM conversations WHERE status = 'active' ORDER BY last_used_at DESC").all() as unknown as ConversationRecord[];
  }
}
