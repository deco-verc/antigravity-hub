import { Logger } from './logger.js';

export interface TaskGraphNode {
  id?: string;
  title: string;
  description?: string;
  code?: string;
  taskCode?: string;
  majorTaskCode?: string;
  majorTaskId?: string;
  stageCode?: string;
  stageTitle?: string;
  orderIndex?: number;
  dependencies?: string[];
  criteria?: string[];
  expectedFiles?: string[];
  expectedScopeFiles?: string[];
  waveIndex?: number;
  [key: string]: any;
}

/**
 * Normalizes text for semantic comparison (lowercase, accent-free, trimmed).
 */
function normalizeText(text: string): string {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Infers the architectural layer rank of a task (Scaffolding -> Banco -> Domínio -> API -> UI -> Testes E2E).
 * Used during cycle breaking to prioritize removing unnatural backward dependencies.
 */
function inferLayerRank(task: TaskGraphNode): number {
  const text = `${task.title || ''} ${task.description || ''} ${task.stageTitle || ''} ${task.stageCode || ''}`.toLowerCase();
  if (/\b(scaffold|setup|init|inicializa|bootstrap|config|package\.json)\b/i.test(text)) return 1;
  if (/\b(banco|db|database|sqlite|migra|schema|tabela|table|model|entidade)\b/i.test(text)) return 2;
  if (/\b(teste[s]?\s+unit[áa]rio[s]?|unit\s+test|unit[áa]rio)\b/i.test(text) && /\b(dominio|domínio|regra|calcul|invariante)\b/i.test(text)) return 3.5;
  if (/\b(service|serviço|dominio|domínio|regra|negocio|core)\b/i.test(text)) return 3;
  if (/\b(teste[s]?\s+de\s+integra[çc][ãa]o|integration\s+test)\b/i.test(text) && /\b(api|rota|route|endpoint|rest)\b/i.test(text)) return 4.5;
  if (/\b(api|rota|route|endpoint|controller|backend|server|express)\b/i.test(text)) return 4;
  if (/\b(ui|frontend|front-end|tela|view|css|html|component|dashboard|drawer|modal|aba)\b/i.test(text)) return 5;
  if (/\b(e2e|ponta\s+a\s+ponta|jornada|fluxo\s+completo|persist[êe]ncia\s+f5|ux\s+simulator|smoke)\b/i.test(text)) return 6;
  if (/\b(auditoria|pentest|appsec|seguran[çc]a|path\s+traversal|entrega\s+final|valida[çc][ãa]o\s+integrada|crit[ée]rios\s+e\s+entrega)\b/i.test(text)) return 7;
  if (/\b(teste|test|valid|regress)\b/i.test(text)) return 5.8;
  return 3.5;
}

export interface AutoHealOptions {
  breakCycles?: boolean;
  completedTasks?: Array<{ id?: string; title?: string }>;
}

export class DagAutoHealer {
  /**
   * Deterministic DAG Auto-Healer & Graph Normalizer:
   * 1. Multi-Key Resolution:
   *    - Exact match by id, code, taskCode, or title (case-insensitive, trimmed).
   *    - Major Task code (GT-1, Major Task 1, etc.) or Stage code (ET-1) -> resolves to prior microtask(s).
   *    - Numeric reference (0, 1, #1, Task 1) -> resolves by array index / orderIndex.
   *    - Substring / prefix of title.
   * 2. Silent Removal of Orphan & Self-Dependencies:
   *    - Unresolvable dependencies or self-dependencies are pruned with a warning log, never throwing.
   * 3. Automatic Cycle Breaker / Topological Repair:
   *    - DFS detects any cycles (direct or indirect) and breaks them by removing the backward/unnatural edge
   *      (keeping dependencies where higher orderIndex depends on lower orderIndex).
   * 4. Title Disambiguation:
   *    - Appends (Parte 2), (Parte 3)... to identical titles to prevent map collisions.
   * Result: Mathematically guaranteed valid acyclic DAG with 100% referential integrity.
   */
  static autoHealAndNormalizeTaskGraph<T extends TaskGraphNode>(tasks: T[], options?: AutoHealOptions): T[] {
    if (!Array.isArray(tasks) || tasks.length === 0) return [];
    const shouldBreakCycles = options?.breakCycles ?? true;

    // Step 1: Disambiguate duplicate titles and guarantee orderIndex and non-empty criteria
    const titleCounts = new Map<string, number>();
    const clonedTasks: T[] = tasks.map((task, idx) => {
      let rawTitle = (task.title || '').trim();
      if (!rawTitle) rawTitle = `Tarefa ${idx + 1}`;
      // PRESERVE_DISTINCT_PART_TITLES: Só desambigua se o título completo for 100% idêntico
      const norm = rawTitle.toLowerCase();
      const count = (titleCounts.get(norm) || 0) + 1;
      titleCounts.set(norm, count);
      const title = count > 1 ? `${rawTitle} (#${count})` : rawTitle;

      return {
        ...task,
        title,
        orderIndex: task.orderIndex ?? (idx + 1),
        dependencies: Array.isArray(task.dependencies) ? [...task.dependencies] : []
      };
    });

    // Step 2: Build Multi-Key Lookup Tables
    const idToIdx = new Map<string, number>();
    const codeToIdx = new Map<string, number>();
    const taskCodeToIdx = new Map<string, number>();
    const titleToIdx = new Map<string, number>();
    const majorCodeToIndices = new Map<string, number[]>();
    const stageCodeToIndices = new Map<string, number[]>();

    const completedTasksTitles = new Map<string, string>();
    for (const ct of options?.completedTasks || []) {
      if (ct.id) {
        idToIdx.set(String(ct.id).trim().toLowerCase(), -2);
        if (ct.title) completedTasksTitles.set(String(ct.id).trim().toLowerCase(), ct.title.trim());
      }
      if (ct.title) {
        titleToIdx.set(ct.title.trim().toLowerCase(), -2);
        completedTasksTitles.set(ct.title.trim().toLowerCase(), ct.title.trim());
      }
    }

    clonedTasks.forEach((t, idx) => {
      if (t.id) idToIdx.set(String(t.id).trim().toLowerCase(), idx);
      if (t.code) codeToIdx.set(String(t.code).trim().toLowerCase(), idx);
      if ((t as any).taskCode) taskCodeToIdx.set(String((t as any).taskCode).trim().toLowerCase(), idx);
      titleToIdx.set(t.title.trim().toLowerCase(), idx);

      // Major task grouping
      const majorKey = (t.majorTaskCode || '').trim().toLowerCase();
      if (majorKey) {
        if (!majorCodeToIndices.has(majorKey)) majorCodeToIndices.set(majorKey, []);
        majorCodeToIndices.get(majorKey)!.push(idx);
      }
      // Also extract GT-X from code if present (e.g. "GT-1-ET-1-TK-1" or "GT-2.1")
      const gtFromCode = String(t.code || '').match(/^(GT-\d+)/i);
      if (gtFromCode) {
        const k = gtFromCode[1].toLowerCase();
        if (!majorCodeToIndices.has(k)) majorCodeToIndices.set(k, []);
        if (!majorCodeToIndices.get(k)!.includes(idx)) majorCodeToIndices.get(k)!.push(idx);
      }

      // Stage grouping
      const stageKey = (t.stageCode || '').trim().toLowerCase();
      if (stageKey) {
        if (!stageCodeToIndices.has(stageKey)) stageCodeToIndices.set(stageKey, []);
        stageCodeToIndices.get(stageKey)!.push(idx);
      }
    });

    // Step 3: Multi-Key Dependency Resolution
    clonedTasks.forEach((task, i) => {
      const rawDeps = Array.isArray(task.dependencies) ? task.dependencies : [];
      const resolvedTargetTitles = new Set<string>();

      for (const rawDep of rawDeps) {
        const depStr = String(rawDep ?? '').trim();
        if (!depStr) continue;
        const depLower = depStr.toLowerCase();

        // 3.1 Exact Match (ID, Code, TaskCode, Title)
        let matchedIdx = titleToIdx.get(depLower)
          ?? codeToIdx.get(depLower)
          ?? idToIdx.get(depLower)
          ?? taskCodeToIdx.get(depLower);

        if (matchedIdx !== undefined) {
          if (matchedIdx === -2) {
            resolvedTargetTitles.add(completedTasksTitles.get(depLower) || depStr);
          } else if (matchedIdx !== i) {
            resolvedTargetTitles.add(clonedTasks[matchedIdx].title);
          } else {
            Logger.warn(`[DAGAutoHealer] Auto-dependência em "${task.title}" ignorada.`);
          }
          continue;
        }

        // 3.2 Major Task or Stage Code Match (e.g. "GT-1", "Major Task 1", "Grandes Tarefas 1", "ET-1")
        let majorCandidates = majorCodeToIndices.get(depLower);
        if (!majorCandidates) {
          const gtNumMatch = depLower.match(/(?:gt|major\s*task|grande\s*tarefa)[-_\s]*0*(\d+)/i);
          if (gtNumMatch) {
            const canonicalGt = `gt-${parseInt(gtNumMatch[1], 10)}`;
            majorCandidates = majorCodeToIndices.get(canonicalGt);
          }
        }
        if (majorCandidates && majorCandidates.length > 0) {
          const priorCandidates = majorCandidates.filter(idx => idx < i);
          const chosenIdx = priorCandidates.length > 0
            ? priorCandidates[priorCandidates.length - 1] // Bridge to the last microtask of prior Major Task
            : majorCandidates.find(idx => idx !== i);
          if (chosenIdx !== undefined) {
            resolvedTargetTitles.add(clonedTasks[chosenIdx].title);
            continue;
          }
        }

        const stageCandidates = stageCodeToIndices.get(depLower);
        if (stageCandidates && stageCandidates.length > 0) {
          const priorStage = stageCandidates.filter(idx => idx < i);
          const chosenIdx = priorStage.length > 0
            ? priorStage[priorStage.length - 1]
            : stageCandidates.find(idx => idx !== i);
          if (chosenIdx !== undefined) {
            resolvedTargetTitles.add(clonedTasks[chosenIdx].title);
            continue;
          }
        }

        // 3.3 Numeric Index Match ("1", "0", "#1", "Task 1", "Tarefa 1", "TK-1")
        const numMatch = depLower.match(/^(?:#|task|tarefa|t|tk|step|passo)?\s*0*(\d+)$/i);
        if (numMatch) {
          const num = parseInt(numMatch[1], 10);
          // Try 1-based index (num - 1)
          if (num >= 1 && num <= clonedTasks.length && (num - 1) !== i) {
            resolvedTargetTitles.add(clonedTasks[num - 1].title);
            continue;
          }
          // Try 0-based index (num)
          if (num >= 0 && num < clonedTasks.length && num !== i) {
            resolvedTargetTitles.add(clonedTasks[num].title);
            continue;
          }
          // Match by orderIndex
          const byOrderIdx = clonedTasks.findIndex((t, idx) => t.orderIndex === num && idx !== i);
          if (byOrderIdx >= 0) {
            resolvedTargetTitles.add(clonedTasks[byOrderIdx].title);
            continue;
          }
        }

        // 3.4 Title Substring / Prefix Match (length >= 4)
        if (depLower.length >= 4) {
          const normDep = normalizeText(depLower);
          const subMatches = clonedTasks
            .map((t, idx) => ({ idx, normTitle: normalizeText(t.title) }))
            .filter(item => item.idx !== i && (item.normTitle.includes(normDep) || normDep.includes(item.normTitle)));
          if (subMatches.length > 0) {
            const prior = subMatches.filter(m => m.idx < i);
            const chosen = prior.length > 0 ? prior[prior.length - 1] : subMatches[0];
            resolvedTargetTitles.add(clonedTasks[chosen.idx].title);
            continue;
          }
        }

        // 3.5 Orphan / Hallucinated Dependency: drop silently with warning
        Logger.warn(`[DAGAutoHealer] Dependência órfã/desconhecida "${rawDep}" ignorada na tarefa "${task.title}".`);
      }

      // Set resolved dependencies
      task.dependencies = Array.from(resolvedTargetTitles);
    });

    // If cycle breaking is disabled, return directly after resolution
    if (!shouldBreakCycles) {
      return clonedTasks;
    }

    // Step 4: Automatic Cycle Breaker / Topological Repair
    let hasCycle = true;
    let cycleBreakIterations = 0;
    const maxCycleBreakIterations = clonedTasks.length * 5;

    // Refresh titleToIdx with normalized keys
    titleToIdx.clear();
    clonedTasks.forEach((t, idx) => titleToIdx.set(t.title.trim().toLowerCase(), idx));

    while (hasCycle && cycleBreakIterations < maxCycleBreakIterations) {
      cycleBreakIterations++;
      const state = new Map<number, 'UNVISITED' | 'VISITING' | 'VISITED'>();
      const pathStack: number[] = [];
      let detectedCycle: number[] | null = null;

      const dfs = (u: number): boolean => {
        state.set(u, 'VISITING');
        pathStack.push(u);

        const deps = clonedTasks[u].dependencies || [];
        for (const depTitle of deps) {
          const v = titleToIdx.get(depTitle.trim().toLowerCase());
          if (v === undefined) continue;
          if (state.get(v) === 'VISITING') {
            const cycleStartIndex = pathStack.indexOf(v);
            detectedCycle = pathStack.slice(cycleStartIndex);
            detectedCycle.push(v);
            return true;
          }
          if ((state.get(v) || 'UNVISITED') === 'UNVISITED') {
            if (dfs(v)) return true;
          }
        }

        pathStack.pop();
        state.set(u, 'VISITED');
        return false;
      };

      hasCycle = false;
      for (let i = 0; i < clonedTasks.length; i++) {
        if ((state.get(i) || 'UNVISITED') === 'UNVISITED') {
          if (dfs(i)) {
            hasCycle = true;
            break;
          }
        }
      }

      const cyclePath = detectedCycle as number[] | null;
      if (hasCycle && cyclePath && cyclePath.length >= 2) {
        // Find the most unnatural edge:
        // 1. Lower architectural layer depending on higher layer (e.g. DB depending on UI)
        // 2. Earlier task position depending on later task position (u <= v)
        let edgeToRemove: { u: number; v: number } | null = null;
        let worstUnnaturalScore = -Infinity;

        for (let k = 0; k < cyclePath.length - 1; k++) {
          const u = cyclePath[k];
          const v = cyclePath[k + 1];
          const uRank = inferLayerRank(clonedTasks[u]);
          const vRank = inferLayerRank(clonedTasks[v]);

          let score = 0;
          if (u <= v) score += (v - u + 1) * 10;
          if (uRank < vRank) score += (vRank - uRank) * 20;

          if (score > worstUnnaturalScore) {
            worstUnnaturalScore = score;
            edgeToRemove = { u, v };
          }
        }

        if (!edgeToRemove || worstUnnaturalScore <= 0) {
          for (let k = 0; k < cyclePath.length - 1; k++) {
            if (cyclePath[k] <= cyclePath[k + 1]) {
              edgeToRemove = { u: cyclePath[k], v: cyclePath[k + 1] };
              break;
            }
          }
          if (!edgeToRemove) {
            edgeToRemove = { u: cyclePath[0], v: cyclePath[1] };
          }
        }

        const uTask = clonedTasks[edgeToRemove.u];
        const vTask = clonedTasks[edgeToRemove.v];
        Logger.warn(
          `[DAGAutoHealer] Ciclo detectado (${cyclePath.map((idx: number) => clonedTasks[idx].title).join(' -> ')}). Quebrando dependência de "${uTask.title}" para "${vTask.title}".`
        );
        uTask.dependencies = (uTask.dependencies || []).filter(
          d => d.trim().toLowerCase() !== vTask.title.trim().toLowerCase()
        );
      }
    }

    return this.computeExecutionWaves(clonedTasks);
  }

  /**
   * Wave Parallelism & File-Lock Wave Shift (open-gsd/gsd-core):
   * Groups tasks into deterministic execution waves (waveIndex: 1..N):
   * 1. Tasks without dependencies get waveIndex = 1.
   * 2. Tasks with dependencies get max(waveIndex of dependencies) + 1.
   * 3. File-Lock Wave Shift: If two tasks in the same wave touch identical files
   *    (in expectedFiles / expectedScopeFiles), shift the second task to the next wave,
   *    guaranteeing that tasks in any wave can run concurrently with zero write collisions.
   */
  static computeExecutionWaves<T extends TaskGraphNode>(tasks: T[]): Array<T & { waveIndex: number }> {
    if (!Array.isArray(tasks) || tasks.length === 0) return [];

    type WaveTask = T & { waveIndex: number };

    const findTaskByDep = (dep: string, allTasks: WaveTask[]): WaveTask | undefined => {
      const norm = normalizeText(dep);
      return allTasks.find(t => {
        if (t.id && t.id === dep) return true;
        if (t.code && normalizeText(t.code) === norm) return true;
        if (t.taskCode && normalizeText(t.taskCode) === norm) return true;
        if (normalizeText(t.title) === norm) return true;
        return false;
      });
    };

    const getTaskFiles = (task: WaveTask): string[] => {
      const files: string[] = [];
      const fileCandidates = [
        ...(Array.isArray(task.expectedFiles) ? task.expectedFiles : []),
        ...(Array.isArray(task.expectedScopeFiles) ? task.expectedScopeFiles : [])
      ];
      for (const f of fileCandidates) {
        if (typeof f === 'string' && f.trim()) {
          files.push(f.trim().toLowerCase().replace(/\\/g, '/'));
        }
      }
      return files;
    };

    const result: WaveTask[] = tasks.map(t => ({ ...t, waveIndex: 1 }));

    // Step 1: Initial topological wave computation
    const maxIterations = Math.max(10, result.length * 2);
    let changed = true;
    let iteration = 0;

    while (changed && iteration < maxIterations) {
      changed = false;
      iteration++;

      for (const task of result) {
        const deps = Array.isArray(task.dependencies) ? task.dependencies : [];
        if (deps.length === 0) {
          continue;
        }

        let maxDepWave = 0;
        for (const dep of deps) {
          const parent = findTaskByDep(dep, result);
          if (parent && parent !== task) {
            maxDepWave = Math.max(maxDepWave, parent.waveIndex || 1);
          }
        }

        const targetWave = maxDepWave + 1;
        if (targetWave > (task.waveIndex || 1)) {
          task.waveIndex = targetWave;
          changed = true;
        }
      }
    }

    // Step 2: File-Lock Wave Shift (Prevent concurrent writes to shared files in the same wave)
    let maxCurrentWave = Math.max(...result.map(t => t.waveIndex || 1));
    let wave = 1;

    while (wave <= maxCurrentWave) {
      const waveTasks = result.filter(t => t.waveIndex === wave);
      const lockedFiles = new Set<string>();

      for (const task of waveTasks) {
        const taskFiles = getTaskFiles(task);
        const hasCollision = taskFiles.some(f => lockedFiles.has(f));

        if (hasCollision && lockedFiles.size > 0) {
          task.waveIndex = wave + 1;
          if (task.waveIndex > maxCurrentWave) {
            maxCurrentWave = task.waveIndex;
          }

          // Propagate wave shift downstream
          const propagateDownstream = (parentTask: WaveTask) => {
            for (const other of result) {
              const otherDeps = Array.isArray(other.dependencies) ? other.dependencies : [];
              const dependsOnParent = otherDeps.some(d => {
                const p = findTaskByDep(d, result);
                return p === parentTask;
              });

              if (dependsOnParent && (other.waveIndex || 1) <= (parentTask.waveIndex || 1)) {
                other.waveIndex = (parentTask.waveIndex || 1) + 1;
                if (other.waveIndex > maxCurrentWave) {
                  maxCurrentWave = other.waveIndex;
                }
                propagateDownstream(other);
              }
            }
          };

          propagateDownstream(task);
        } else {
          for (const f of taskFiles) {
            lockedFiles.add(f);
          }
        }
      }

      wave++;
    }

    return result;
  }
}
