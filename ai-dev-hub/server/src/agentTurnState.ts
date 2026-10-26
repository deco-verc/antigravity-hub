import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { db } from './db.js';
import { ObservabilityService } from './observability/observabilityService.js';

export type FileInventory = Record<string,string>;

const IGNORED_DIRECTORY_NAMES = new Set([
  'node_modules',
  '.git',
  'dist',
  'dist-desktop',
  'build',
  'release',
  'out',
  '.ai-dev-hub',
  '.playwright-cli',
  'coverage'
]);

const IGNORED_BINARY_EXTENSIONS = new Set([
  '.exe',
  '.dll',
  '.node',
  '.db',
  '.db-wal',
  '.db-shm',
  '.asar',
  '.zip',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.ico',
  '.webp'
]);

const MAX_INVENTORY_FILE_SIZE = 2 * 1024 * 1024; // 2 MB

export function captureFileInventory(root: string): FileInventory {
  const prevNoAsar = (process as any).noAsar;
  (process as any).noAsar = true;
  try {
    let rootStat: fs.Stats;
    try {
      rootStat = fs.lstatSync(root);
    } catch {
      return {};
    }
    if (rootStat.isSymbolicLink()) throw new Error('TURN_SNAPSHOT_SYMLINK_DENIED');

    const result: FileInventory = {};
    const walk = (dir: string) => {
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        try {
          const name = entry.name;
          if (IGNORED_DIRECTORY_NAMES.has(name)) continue;
          if (name.endsWith('.asar') || name.endsWith('.asar.unpacked') || name.includes('.asar')) continue;

          const file = path.join(dir, name);

          // Never follow a link outside the authorized project while taking a baseline.
          let isSymlink = false;
          try {
            isSymlink = entry.isSymbolicLink();
          } catch {
            continue;
          }
          if (isSymlink) throw new Error('TURN_SNAPSHOT_SYMLINK_DENIED');

          let isDir = false;
          try {
            isDir = entry.isDirectory();
          } catch {
            continue;
          }

          if (isDir) {
            walk(file);
          } else {
            const ext = path.extname(name).toLowerCase();
            if (IGNORED_BINARY_EXTENSIONS.has(ext)) continue;

            let stat: fs.Stats;
            try {
              stat = fs.statSync(file);
            } catch {
              continue;
            }

            if (stat.size > MAX_INVENTORY_FILE_SIZE) continue;

            let fileContent: Buffer;
            try {
              fileContent = fs.readFileSync(file);
            } catch {
              continue;
            }

            result[path.relative(root, file).replace(/\\/g, '/')] = createHash('sha256')
              .update(fileContent)
              .digest('hex');
          }
        } catch (entryErr: any) {
          if (entryErr?.message === 'TURN_SNAPSHOT_SYMLINK_DENIED') {
            throw entryErr;
          }
          continue;
        }
      }
    };

    walk(root);
    return result;
  } finally {
    (process as any).noAsar = prevNoAsar;
  }
}
export function changedFiles(before: FileInventory,after: FileInventory): string[] {
  return [...new Set([...Object.keys(before),...Object.keys(after)])].filter(file=>before[file]!==after[file]).sort();
}

export const FATAL_QUOTA_OR_AUTH_REGEX =
  /RESOURCE_EXHAUSTED|QUOTA_EXHAUSTED|QUOTA_BLOCKED|\b429\b|Individual quota reached|baseline quota will refresh|Weekly Limit|upgrade your subscription to increase your limits|Resets in \d+|AI credits balance is too low|Out of credits|rate limit|UNAUTHENTICATED|AUTH_ERROR|LOGIN_REQUIRED|Verify your account|invalid_grant/i;

/**
 * Predicado utilitário que detecta se um bloco de texto é na verdade uma saída crua de ferramenta/terminal
 * (run_command, grep, listing, etc.) e NÃO uma resposta narrativa ou conclusão real emitida pelo modelo.
 */
export function isRawToolOrCommandOutput(text: string): boolean {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (!trimmed) return false;

  const hasCreatedAt = /^Created At:\s+\d{4}-\d{2}-\d{2}/m.test(trimmed);
  const hasExitCode = /Command exited with code \d+/m.test(trimmed);
  const hasCommandOutput = /^Command output:/m.test(trimmed) || /The tool's output was truncated/i.test(trimmed);
  const hasToolRunning = /Tool is running as a background task/i.test(trimmed);
  const hasLogOutput = /^Log output:/m.test(trimmed);
  const hasShowingLines = /^Showing lines \d+-\d+ of \d+/m.test(trimmed);

  if (hasCreatedAt || hasExitCode || hasCommandOutput || hasToolRunning || hasLogOutput || hasShowingLines) {
    const stripped = trimmed
      .replace(/^Created At:\s+[^\r\n]+/gm, '')
      .replace(/^Completed At:\s+[^\r\n]+/gm, '')
      .replace(/^Command exited with code \d+/gm, '')
      .replace(/^Command output:/gm, '')
      .replace(/^Showing lines \d+-\d+ of \d+/gm, '')
      .replace(/^Log output:/gm, '')
      .replace(/^Last progress:[^\r\n]+/gm, '')
      .replace(/The tool's output was truncated[^\r\n]*/gi, '')
      .replace(/Tool is running as a background task[^\r\n]*/gi, '')
      .replace(/Task logs are available at:[^\r\n]*/gi, '')
      .replace(/Task:[^\r\n]*/gi, '')
      .replace(/Status:[^\r\n]*/gi, '')
      .replace(/Log:[^\r\n]*/gi, '')
      .replace(/Diret[óo]rio:[^\r\n]*/gi, '')
      .replace(/Mode\s+LastWriteTime\s+Length\s+Name[^\r\n]*/gi, '')
      .replace(/-+[a-z-]+\s+\d{2}\/\d{2}\/\d{4}[^\r\n]*/gi, '')
      .trim();

    if (!stripped || stripped.length < 25) {
      return true;
    }

    if (hasCreatedAt && (hasExitCode || hasCommandOutput || hasShowingLines)) {
      const hasNarrative = /(?:vou|vamos|implementar|corrigir|analisando|conclu|resultado|portanto|conforme|passo|###|\*\*)/i.test(stripped);
      if (!hasNarrative) {
        return true;
      }
    }
  }

  if (/^Command exited with code \d+/m.test(trimmed) && !/(?:###|conclu[íi]do|sucesso|implementado)/i.test(trimmed)) {
    return true;
  }

  return false;
}

export function observeTranscript(file: string,baselineLines=0) {
  let entries: any[]=[];
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean)) {
      try {
        entries.push(JSON.parse(line));
      } catch {
        // Ignora linha parcial ou corrompida de escrita concorrente para preservar entradas válidas precedentes
      }
    }
  }
  if (!entries.length && !fs.existsSync(file)) {
    return {state:'UNAVAILABLE' as const,entries:[],pendingTools:[] as string[],lastStep:null,abortedOnStepError:false};
  }
  if (baselineLines > 0) {
    if (baselineLines >= entries.length) {
      // Nenhuma linha nova foi gravada pelo modelo após o envio do turno atual
      return {state:'RUNNING' as const,entries:[],pendingTools:[] as string[],lastStep:null,abortedOnStepError:false};
    }
    entries = entries.slice(baselineLines);
  }
  
  // Ignora checkpoints puramente de infraestrutura para avaliar o estado operacional real
  const operationalEntries = entries.filter(e => e.type !== 'CHECKPOINT');
  const last = operationalEntries.at(-1);

  // Ferramentas pendentes só existem se a última entrada operacional for uma chamada de ferramenta do modelo
  const isLastToolResult = Boolean(
    last &&
    (last.type === 'GENERIC' || last.type === 'GENERIC_TOOL_CALL_RESULT')
  );

  const pendingTools: string[] = (!isLastToolResult && last?.tool_calls && Array.isArray(last.tool_calls))
    ? last.tool_calls.map((tool: any) => tool?.name).filter(Boolean)
    : [];

  const fatal = entries.find(entry => {
    const text = String(entry.error || entry.content || entry.message || '');
    if (FATAL_QUOTA_OR_AUTH_REGEX.test(text)) return true;
    if ((entry.type === 'ERROR_MESSAGE' || entry.status === 'ERROR') && /quota|limit|cota|upgrade|credits|auth/i.test(text)) {
      return true;
    }
    return false;
  });
  const abortedOnStepError = Boolean(!fatal && last && last.type !== 'PLANNER_RESPONSE' && !isLastToolResult && (last.status === 'ERROR' || last.status === 'CANCELED') && !pendingTools.length);

  // Um turno do modelo só está COMPLETO se a ÚLTIMA entrada operacional:
  // 1. For uma resposta do assistente/modelo (e NÃO um resultado de execução de ferramenta nem entrada de usuário)
  // 2. Não possuir chamadas de ferramentas pendentes
  // 3. Estiver com status concluído ou contiver conteúdo substantivo de texto/código emitido pelo modelo
  const isModelTurnEntry = Boolean(
    last &&
    !isLastToolResult &&
    last.type !== 'USER_INPUT' &&
    last.type !== 'SYSTEM_MESSAGE' &&
    last.role !== 'user' &&
    last.source !== 'USER_EXPLICIT' &&
    (
      last.type === 'PLANNER_RESPONSE' ||
      last.type === 'ASSISTANT_RESPONSE' ||
      last.type === 'MODEL_TURN' ||
      last.type === 'MESSAGE' ||
      last.role === 'assistant' ||
      (last.source === 'MODEL' && last.type !== 'GENERIC')
    )
  );

  const lastContent = typeof last?.content === 'string'
    ? last.content
    : (typeof last?.text === 'string' ? last.text : '');

  const isRawOutput = isRawToolOrCommandOutput(lastContent);

  const hasModelContent = Boolean(
    last &&
    (
      (typeof last.content === 'string' && last.content.trim().length > 0) ||
      (last.content && typeof last.content === 'object') ||
      (typeof last.text === 'string' && last.text.trim().length > 0) ||
      (last.status === 'DONE' || last.status === 'COMPLETED')
    )
  );

  const isComplete = Boolean(!fatal && isModelTurnEntry && pendingTools.length === 0 && hasModelContent && !isRawOutput);
  const state = fatal
    ? 'ERROR'
    : isComplete
      ? 'COMPLETE'
      : (pendingTools.length > 0)
        ? 'PENDING_TOOL'
        : (isRawOutput || entries.length > 0)
          ? 'RUNNING'
          : 'UNAVAILABLE';
  return {state,entries,pendingTools,lastStep:last?.step_index??null,abortedOnStepError};
}

/** Persistent baseline before send-message; no inference, auth probing, expiry or automatic reset. */
export class AgentTurnState {
  static get(conversationId: string): any {return db.prepare('SELECT * FROM agent_turn_observations WHERE conversation_id=?').get(conversationId);}
  static forTask(taskId: string): any {return db.prepare('SELECT * FROM agent_turn_observations WHERE task_id=? ORDER BY dispatched_at DESC LIMIT 1').get(taskId);}
  static progress(record: any) {
    const transcriptPath = (record.brain_dir && (record.brain_dir.endsWith(record.conversation_id) || record.brain_dir.endsWith(record.conversation_id.replace(/\\/g, '/'))))
      ? path.join(record.brain_dir, '.system_generated', 'logs', 'transcript.jsonl')
      : path.join(record.brain_dir, record.conversation_id, '.system_generated', 'logs', 'transcript.jsonl');
    return observeTranscript(transcriptPath, record.baseline_lines);
  }
  static begin(conversationId: string,projectPath: string,brainDir: string,taskId?: string): number {
    const prior=this.get(conversationId);
    if(prior&&['IN_FLIGHT','UNCERTAIN'].includes(prior.phase)){
      const isConversationalOrMetaChat = !prior.task_id || String(prior.task_id).startsWith('metachat-');
      let priorTask: any = null;
      if (prior.task_id && !isConversationalOrMetaChat) {
        try {
          priorTask = db.prepare('SELECT status FROM autonomous_tasks WHERE id = ?').get(prior.task_id);
        } catch {}
      }

      // Se o transcript anterior contém erro fatal de quota/auth, reconcilia como CONSUMED para não travar failover
      let hasFatalQuotaOrAuth = false;
      try {
        const priorProg = this.progress(prior);
        if (priorProg.state === 'ERROR') {
          hasFatalQuotaOrAuth = true;
        }
      } catch {}

      if ((priorTask && priorTask.status === 'completed') || isConversationalOrMetaChat || hasFatalQuotaOrAuth) {
        this.setPhase(conversationId, 'CONSUMED');
      } else {
        throw new Error('AGENT_TURN_UNCERTAIN: previous turn requires reconciliation before another message');
      }
    }
    const file = (brainDir && (brainDir.endsWith(conversationId) || brainDir.endsWith(conversationId.replace(/\\/g, '/'))))
      ? path.join(brainDir, '.system_generated', 'logs', 'transcript.jsonl')
      : path.join(brainDir, conversationId, '.system_generated', 'logs', 'transcript.jsonl');
    const baselineLines=fs.existsSync(file)?fs.readFileSync(file,'utf8').split(/\r?\n/).filter(Boolean).length:0;
    const files=captureFileInventory(projectPath);
    db.prepare(`INSERT INTO agent_turn_observations(conversation_id,task_id,project_path,brain_dir,baseline_lines,baseline_files_json,phase,dispatched_at)
      VALUES(?,?,?,?,?,?,'PREPARED',?) ON CONFLICT(conversation_id) DO UPDATE SET task_id=excluded.task_id,project_path=excluded.project_path,brain_dir=excluded.brain_dir,
      baseline_lines=excluded.baseline_lines,baseline_files_json=excluded.baseline_files_json,phase='PREPARED',dispatched_at=excluded.dispatched_at`)
      .run(conversationId,taskId||null,path.resolve(projectPath),brainDir,baselineLines,JSON.stringify(files),new Date().toISOString());

    ObservabilityService.emit({
      level: 'INFO',
      event: 'agent.turn_state_changed',
      message: `Novo turno preparado (conv: ${conversationId.slice(0, 8)}, task: ${taskId || 'N/A'})`,
      service: 'agent',
      conversationId,
      taskId: taskId || null,
      status: 'PREPARED',
      metadata: { baselineLines, newPhase: 'PREPARED' }
    });

    return baselineLines;
  }
  static setPhase(conversationId: string, phase: string) {
    const prior: any = this.get(conversationId);
    const oldPhase = prior?.phase || 'UNKNOWN';
    db.prepare('UPDATE agent_turn_observations SET phase=? WHERE conversation_id=?').run(phase, conversationId);
    ObservabilityService.emit({
      level: 'INFO',
      event: 'agent.turn_state_changed',
      message: `Turn state alterado: ${oldPhase} -> ${phase} (conv: ${conversationId.slice(0, 8)})`,
      service: 'agent',
      conversationId,
      taskId: prior?.task_id || null,
      status: phase,
      metadata: { previousPhase: oldPhase, newPhase: phase }
    });
  }
}
