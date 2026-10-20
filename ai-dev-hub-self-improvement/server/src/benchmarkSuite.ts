// server/src/benchmarkSuite.ts
// Fixed Benchmark Suite for AI DEV Quality & Self-Improvement Loop (Fase 6)

export type BenchmarkCategory =
  | 'BUG_FIX'
  | 'FEATURE'
  | 'FRONTEND'
  | 'BACKEND'
  | 'REFACTOR'
  | 'PERFORMANCE'
  | 'TESTING'
  | 'CODE_UNDERSTANDING'
  | 'CONTEXT_CONTINUITY'
  | 'MULTI_FILE_CHANGE';

export type BenchmarkDifficulty = 'simple' | 'medium' | 'hard';

export interface BenchmarkTask {
  id: string;
  title: string;
  category: BenchmarkCategory;
  difficulty: BenchmarkDifficulty;
  isHoldout: boolean;
  briefing: string;
  allowedFilesToModify: string[];
  projectSeed: {
    files: Record<string, string>; // relative path -> initial content
  };
  successContract: {
    objective: string;
    acceptanceCriteria: string[];
    verificationSteps: Array<{ name: string; command: string; expectedExitCode?: number }>;
    protectedEvaluationFiles: string[];
  };
  protectedTests: Record<string, string>; // relative path -> test code (cannot be edited)
  expectedBehavior: string;
  timeLimitMs: number;
  riskLevel: 'low' | 'medium' | 'high';
}

export const BENCHMARK_TASKS: BenchmarkTask[] = [
  // ---------------------------------------------------------------------------
  // 1. BUG_FIX (Simple)
  // ---------------------------------------------------------------------------
  {
    id: 'bm-01-bugfix-pagination',
    title: 'Corrigir bug off-by-one em paginação de lista',
    category: 'BUG_FIX',
    difficulty: 'simple',
    isHoldout: false,
    briefing: 'Em `src/pagination.js`, a função paginateItems está retornando 1 item a menos quando limit é atingido. Corrija o cálculo do slice sem alterar testes.',
    allowedFilesToModify: ['src/pagination.js'],
    projectSeed: {
      files: {
        'package.json': JSON.stringify({ name: 'bm-01', type: 'module' }, null, 2),
        'src/pagination.js': `
export function paginateItems(items, page = 1, pageSize = 10) {
  const start = (page - 1) * pageSize;
  // Bug proposital: subtrai 1 indevidamente
  const end = start + pageSize - 1;
  return items.slice(start, end);
}
`
      }
    },
    successContract: {
      objective: 'Corrigir cálculo do índice final no slice de paginação',
      acceptanceCriteria: [
        'paginateItems([1..10], 1, 5) deve retornar exatamente 5 itens',
        'paginateItems([1..10], 2, 5) deve retornar os próximos 5 itens',
        'Nenhum arquivo fora de src/pagination.js deve ser modificado'
      ],
      verificationSteps: [
        { name: 'Executar teste de paginação', command: 'node test/pagination.test.js', expectedExitCode: 0 }
      ],
      protectedEvaluationFiles: ['test/pagination.test.js']
    },
    protectedTests: {
      'test/pagination.test.js': `
import assert from 'node:assert';
import { paginateItems } from '../src/pagination.js';

const items = Array.from({ length: 20 }, (_, i) => i + 1);
const page1 = paginateItems(items, 1, 5);
assert.strictEqual(page1.length, 5, 'Deveria retornar 5 itens na pagina 1');
assert.deepStrictEqual(page1, [1, 2, 3, 4, 5]);

const page2 = paginateItems(items, 2, 5);
assert.strictEqual(page2.length, 5, 'Deveria retornar 5 itens na pagina 2');
assert.deepStrictEqual(page2, [6, 7, 8, 9, 10]);

console.log('✓ 2 passed (Paginação 100% OK)');
`
    },
    expectedBehavior: 'O slice deve usar start + pageSize.',
    timeLimitMs: 15000,
    riskLevel: 'low'
  },

  // ---------------------------------------------------------------------------
  // 2. FEATURE (Medium)
  // ---------------------------------------------------------------------------
  {
    id: 'bm-02-feature-cache-ttl',
    title: 'Implementar camada de cache em memória com TTL',
    category: 'FEATURE',
    difficulty: 'medium',
    isHoldout: false,
    briefing: 'Em `src/cache.js`, implemente a classe Cache com suporte a set(key, value, ttlMs), get(key) com expiração automática, e delete(key). Foco em simplicidade cirúrgica (Map nativo).',
    allowedFilesToModify: ['src/cache.js'],
    projectSeed: {
      files: {
        'package.json': JSON.stringify({ name: 'bm-02', type: 'module' }, null, 2),
        'src/cache.js': `
export class Cache {
  // A ser implementado
}
`
      }
    },
    successContract: {
      objective: 'Implementar classe Cache com TTL sem overengineering',
      acceptanceCriteria: [
        'set armazena valor e expiração',
        'get retorna valor se ativo e null se expirado',
        'delete remove o item'
      ],
      verificationSteps: [
        { name: 'Executar teste de Cache', command: 'node test/cache.test.js', expectedExitCode: 0 }
      ],
      protectedEvaluationFiles: ['test/cache.test.js']
    },
    protectedTests: {
      'test/cache.test.js': `
import assert from 'node:assert';
import { Cache } from '../src/cache.js';

const c = new Cache();
c.set('k1', 'val1', 5000);
assert.strictEqual(c.get('k1'), 'val1');

c.set('k2', 'val2', 1); // 1ms expira quase instantaneo
await new Promise(r => setTimeout(r, 10));
assert.strictEqual(c.get('k2'), null);

c.delete('k1');
assert.strictEqual(c.get('k1'), null);

console.log('✓ 3 passed (Cache TTL 100% OK)');
`
    },
    expectedBehavior: 'Map nativo armazenando { value, expiresAt }',
    timeLimitMs: 20000,
    riskLevel: 'medium'
  },

  // ---------------------------------------------------------------------------
  // 3. FRONTEND (Medium)
  // ---------------------------------------------------------------------------
  {
    id: 'bm-03-frontend-status-badge',
    title: 'Renderizar Badge de Status com classes semânticas',
    category: 'FRONTEND',
    difficulty: 'medium',
    isHoldout: false,
    briefing: 'Em `src/statusBadge.js`, implemente renderStatusBadge(status, label) retornando a string HTML com classes adequadas (emerald para ready/pass, amber para running/warning, rose para failed/error).',
    allowedFilesToModify: ['src/statusBadge.js'],
    projectSeed: {
      files: {
        'package.json': JSON.stringify({ name: 'bm-03', type: 'module' }, null, 2),
        'src/statusBadge.js': `
export function renderStatusBadge(status, label) {
  return '';
}
`
      }
    },
    successContract: {
      objective: 'Formatar badge HTML com classes CSS corretas por status',
      acceptanceCriteria: [
        'Status ready/pass retorna classe bg-emerald',
        'Status running retorna classe bg-amber',
        'Status failed retorna classe bg-rose'
      ],
      verificationSteps: [
        { name: 'Executar teste do StatusBadge', command: 'node test/statusBadge.test.js', expectedExitCode: 0 }
      ],
      protectedEvaluationFiles: ['test/statusBadge.test.js']
    },
    protectedTests: {
      'test/statusBadge.test.js': `
import assert from 'node:assert';
import { renderStatusBadge } from '../src/statusBadge.js';

const b1 = renderStatusBadge('ready', 'Pronto');
assert.match(b1, /bg-emerald/);
assert.match(b1, /Pronto/);

const b2 = renderStatusBadge('running', 'Executando');
assert.match(b2, /bg-amber/);

const b3 = renderStatusBadge('failed', 'Erro');
assert.match(b3, /bg-rose/);

console.log('✓ 3 passed (StatusBadge 100% OK)');
`
    },
    expectedBehavior: 'Retorna tag span formatada com tailwind classes semânticas',
    timeLimitMs: 15000,
    riskLevel: 'low'
  },

  // ---------------------------------------------------------------------------
  // 4. BACKEND (Medium)
  // ---------------------------------------------------------------------------
  {
    id: 'bm-04-backend-rate-limiter',
    title: 'Implementar middleware de Rate Limiter deslizante',
    category: 'BACKEND',
    difficulty: 'medium',
    isHoldout: false,
    briefing: 'Em `src/rateLimiter.js`, implemente createRateLimiter(maxRequests, windowMs). Deve rastrear requisições por IP e retornar { allowed: boolean, remaining: number }.',
    allowedFilesToModify: ['src/rateLimiter.js'],
    projectSeed: {
      files: {
        'package.json': JSON.stringify({ name: 'bm-04', type: 'module' }, null, 2),
        'src/rateLimiter.js': `
export function createRateLimiter(maxRequests = 5, windowMs = 60000) {
  return (ip) => ({ allowed: true, remaining: 5 });
}
`
      }
    },
    successContract: {
      objective: 'Rate limiter por IP com janela de tempo',
      acceptanceCriteria: [
        'Permitir até maxRequests dentro da janela',
        'Bloquear quando passar de maxRequests',
        'Contadores por IP independentes'
      ],
      verificationSteps: [
        { name: 'Executar teste de Rate Limiter', command: 'node test/rateLimiter.test.js', expectedExitCode: 0 }
      ],
      protectedEvaluationFiles: ['test/rateLimiter.test.js']
    },
    protectedTests: {
      'test/rateLimiter.test.js': `
import assert from 'node:assert';
import { createRateLimiter } from '../src/rateLimiter.js';

const limiter = createRateLimiter(3, 5000);
const r1 = limiter('127.0.0.1');
assert.strictEqual(r1.allowed, true);
assert.strictEqual(r1.remaining, 2);

limiter('127.0.0.1');
const r3 = limiter('127.0.0.1');
assert.strictEqual(r3.allowed, true);
assert.strictEqual(r3.remaining, 0);

const r4 = limiter('127.0.0.1');
assert.strictEqual(r4.allowed, false);

// Outro IP tem cota limpa
assert.strictEqual(limiter('192.168.1.1').allowed, true);

console.log('✓ 4 passed (RateLimiter 100% OK)');
`
    },
    expectedBehavior: 'Uso de Map<ip, timestamps[]> filtrado por Date.now() - windowMs',
    timeLimitMs: 20000,
    riskLevel: 'medium'
  },

  // ---------------------------------------------------------------------------
  // 5. REFACTOR (Simple)
  // ---------------------------------------------------------------------------
  {
    id: 'bm-05-refactor-async-await',
    title: 'Refatorar callback aninhado para Async/Await limpo',
    category: 'REFACTOR',
    difficulty: 'simple',
    isHoldout: false,
    briefing: 'Em `src/pipeline.js`, refatore a função executePipeline para usar async/await de forma limpa, preservando a assinatura e tratamento de erro.',
    allowedFilesToModify: ['src/pipeline.js'],
    projectSeed: {
      files: {
        'package.json': JSON.stringify({ name: 'bm-05', type: 'module' }, null, 2),
        'src/pipeline.js': `
export function executePipeline(initialVal, steps) {
  return new Promise((resolve, reject) => {
    let current = initialVal;
    let i = 0;
    function next() {
      if (i >= steps.length) return resolve(current);
      const fn = steps[i++];
      try {
        Promise.resolve(fn(current)).then(res => {
          current = res;
          next();
        }).catch(reject);
      } catch (err) {
        reject(err);
      }
    }
    next();
  });
}
`
      }
    },
    successContract: {
      objective: 'Refatoração idiomática para loop for...of com await',
      acceptanceCriteria: [
        'Executa passos sequencialmente',
        'Preserva compatibilidade com passos síncronos e assíncronos',
        'Propaga exceções corretamente'
      ],
      verificationSteps: [
        { name: 'Executar teste de Pipeline', command: 'node test/pipeline.test.js', expectedExitCode: 0 }
      ],
      protectedEvaluationFiles: ['test/pipeline.test.js']
    },
    protectedTests: {
      'test/pipeline.test.js': `
import assert from 'node:assert';
import { executePipeline } from '../src/pipeline.js';

const steps = [
  x => x + 10,
  async x => x * 2,
  x => x - 5
];

const res = await executePipeline(5, steps);
assert.strictEqual(res, 25); // (5+10)*2 - 5 = 25

await assert.rejects(
  async () => executePipeline(10, [() => { throw new Error('Falha'); }]),
  /Falha/
);

console.log('✓ 2 passed (Refactor Pipeline 100% OK)');
`
    },
    expectedBehavior: 'Substituição da recursão com Promise por um loop for...of assíncrono enxuto',
    timeLimitMs: 15000,
    riskLevel: 'low'
  },

  // ---------------------------------------------------------------------------
  // 6. PERFORMANCE (Medium)
  // ---------------------------------------------------------------------------
  {
    id: 'bm-06-perf-indexed-lookup',
    title: 'Otimizar busca O(N²) para Map indexado O(1)',
    category: 'PERFORMANCE',
    difficulty: 'medium',
    isHoldout: false,
    briefing: 'Em `src/entitySearch.js`, findRelations cruza dois arrays usando nested filter O(N²). Otimize criando um índice por Map para executar 5000 itens em menos de 20ms.',
    allowedFilesToModify: ['src/entitySearch.js'],
    projectSeed: {
      files: {
        'package.json': JSON.stringify({ name: 'bm-06', type: 'module' }, null, 2),
        'src/entitySearch.js': `
export function findRelations(parents, children) {
  // Ineficiente O(N^2)
  return parents.map(p => ({
    ...p,
    children: children.filter(c => c.parentId === p.id)
  }));
}
`
      }
    },
    successContract: {
      objective: 'Criar Map agrupando children por parentId para tempo O(N+M)',
      acceptanceCriteria: [
        'Retornar exatamente os mesmos dados que a versão ingênua',
        'Executar bateria de 5000 registros em menos de 50ms'
      ],
      verificationSteps: [
        { name: 'Executar teste de Performance', command: 'node test/entitySearch.test.js', expectedExitCode: 0 }
      ],
      protectedEvaluationFiles: ['test/entitySearch.test.js']
    },
    protectedTests: {
      'test/entitySearch.test.js': `
import assert from 'node:assert';
import { findRelations } from '../src/entitySearch.js';

const parents = Array.from({ length: 1000 }, (_, i) => ({ id: 'p_' + i, name: 'P ' + i }));
const children = Array.from({ length: 4000 }, (_, i) => ({ id: 'c_' + i, parentId: 'p_' + (i % 1000) }));

const t0 = performance.now();
const res = findRelations(parents, children);
const elapsed = performance.now() - t0;

assert.strictEqual(res.length, 1000);
assert.strictEqual(res[0].children.length, 4);
assert.ok(elapsed < 60, 'Tempo decorrido (' + elapsed.toFixed(1) + 'ms) deve ser menor que 60ms');

console.log('✓ 2 passed (Performance O(1) index: ' + elapsed.toFixed(1) + 'ms)');
`
    },
    expectedBehavior: 'Construção de Map<parentId, child[]> em passada única O(M) antes do map O(N)',
    timeLimitMs: 25000,
    riskLevel: 'medium'
  },

  // ---------------------------------------------------------------------------
  // 7. TESTING (Simple)
  // ---------------------------------------------------------------------------
  {
    id: 'bm-07-testing-boundaries',
    title: 'Implementar validação estrita de limites numéricos',
    category: 'TESTING',
    difficulty: 'simple',
    isHoldout: false,
    briefing: 'Em `src/validator.js`, implemente validateRange(num, min, max). Deve lançar RangeError se num < min ou num > max, TypeError se não for número, e retornar true caso contrário.',
    allowedFilesToModify: ['src/validator.js'],
    projectSeed: {
      files: {
        'package.json': JSON.stringify({ name: 'bm-07', type: 'module' }, null, 2),
        'src/validator.js': `
export function validateRange(num, min, max) {
  // A implementar
  return false;
}
`
      }
    },
    successContract: {
      objective: 'Validação de tipos e intervalos numéricos',
      acceptanceCriteria: [
        'Lançar TypeError se valor não for número finito',
        'Lançar RangeError fora do intervalo [min, max]',
        'Retornar true para valores válidos e limites exatos'
      ],
      verificationSteps: [
        { name: 'Executar teste de Validador', command: 'node test/validator.test.js', expectedExitCode: 0 }
      ],
      protectedEvaluationFiles: ['test/validator.test.js']
    },
    protectedTests: {
      'test/validator.test.js': `
import assert from 'node:assert';
import { validateRange } from '../src/validator.js';

assert.strictEqual(validateRange(50, 1, 100), true);
assert.strictEqual(validateRange(1, 1, 100), true);
assert.strictEqual(validateRange(100, 1, 100), true);

assert.throws(() => validateRange(0, 1, 100), RangeError);
assert.throws(() => validateRange(101, 1, 100), RangeError);
assert.throws(() => validateRange('abc', 1, 100), TypeError);

console.log('✓ 6 passed (Boundary Validator 100% OK)');
`
    },
    expectedBehavior: 'Validações claras de typeof e comparações numéricas com lançamento de erros nativos',
    timeLimitMs: 15000,
    riskLevel: 'low'
  },

  // ---------------------------------------------------------------------------
  // 8. MULTI_FILE_CHANGE (Hard)
  // ---------------------------------------------------------------------------
  {
    id: 'bm-08-multifile-order-discount',
    title: 'Adicionar campo discount coordenado entre Model e Service',
    category: 'MULTI_FILE_CHANGE',
    difficulty: 'hard',
    isHoldout: false,
    briefing: 'Coordene a adição do campo discount (0 a 1) entre `src/orderModel.js` e `src/orderService.js`. Calcule o total final com desconto. Não altere `src/config.js` nem testes.',
    allowedFilesToModify: ['src/orderModel.js', 'src/orderService.js'],
    projectSeed: {
      files: {
        'package.json': JSON.stringify({ name: 'bm-08', type: 'module' }, null, 2),
        'src/config.js': `export const TAX_RATE = 0.1;`,
        'src/orderModel.js': `
export class OrderModel {
  constructor(id, price) {
    this.id = id;
    this.price = price;
    this.discount = 0; // default
  }
}
`,
        'src/orderService.js': `
import { TAX_RATE } from './config.js';
export class OrderService {
  static calculateTotal(order) {
    return order.price * (1 + TAX_RATE);
  }
}
`
      }
    },
    successContract: {
      objective: 'Coordenar desconto entre dois arquivos mantendo arquivos desnecessários intactos',
      acceptanceCriteria: [
        'OrderModel aceita discount opcional no construtor',
        'OrderService aplica desconto antes dos impostos: (price * (1 - discount)) * (1 + TAX_RATE)',
        'src/config.js não deve ser tocado (Surgical Change)'
      ],
      verificationSteps: [
        { name: 'Executar teste de Order Discount', command: 'node test/order.test.js', expectedExitCode: 0 }
      ],
      protectedEvaluationFiles: ['test/order.test.js']
    },
    protectedTests: {
      'test/order.test.js': `
import assert from 'node:assert';
import { OrderModel } from '../src/orderModel.js';
import { OrderService } from '../src/orderService.js';

const o1 = new OrderModel('1', 100);
assert.strictEqual(Math.round(OrderService.calculateTotal(o1)), 110); // 100 * 1.1

const o2 = new OrderModel('2', 100, 0.2); // 20% desconto
// (100 * 0.8) * 1.1 = 80 * 1.1 = 88
assert.strictEqual(Math.round(OrderService.calculateTotal(o2)), 88);

console.log('✓ 2 passed (Multi-File Order Discount 100% OK)');
`
    },
    expectedBehavior: 'Alteração cirúrgica precisa em src/orderModel.js e src/orderService.js',
    timeLimitMs: 25000,
    riskLevel: 'high'
  },

  // ---------------------------------------------------------------------------
  // 9. CODE_UNDERSTANDING (Holdout - Medium)
  // ---------------------------------------------------------------------------
  {
    id: 'bm-09-code-understanding-holdout',
    title: 'Extrair assinaturas de métodos e computar checksum de API',
    category: 'CODE_UNDERSTANDING',
    difficulty: 'medium',
    isHoldout: true,
    briefing: 'Em `src/contractExtractor.js`, implemente extractPublicMethods(targetClass). Deve inspecionar a classe e retornar array de nomes de métodos que não começam com sublinhado.',
    allowedFilesToModify: ['src/contractExtractor.js'],
    projectSeed: {
      files: {
        'package.json': JSON.stringify({ name: 'bm-09', type: 'module' }, null, 2),
        'src/contractExtractor.js': `
export function extractPublicMethods(cls) {
  return [];
}
`
      }
    },
    successContract: {
      objective: 'Introspecção e identificação de métodos públicos de protótipo',
      acceptanceCriteria: [
        'Retorna nomes de métodos do prototype ignorando constructor e prefixos _',
        'Ordenação alfabética dos métodos'
      ],
      verificationSteps: [
        { name: 'Executar teste de Introspecção', command: 'node test/contractExtractor.test.js', expectedExitCode: 0 }
      ],
      protectedEvaluationFiles: ['test/contractExtractor.test.js']
    },
    protectedTests: {
      'test/contractExtractor.test.js': `
import assert from 'node:assert';
import { extractPublicMethods } from '../src/contractExtractor.js';

class SampleService {
  constructor() {}
  fetchUser() {}
  saveRecord() {}
  _internalHelper() {}
}

const methods = extractPublicMethods(SampleService);
assert.deepStrictEqual(methods, ['fetchUser', 'saveRecord']);

console.log('✓ 1 passed (Code Understanding Holdout 100% OK)');
`
    },
    expectedBehavior: 'Uso de Object.getOwnPropertyNames(cls.prototype) filtrando constructor e prefixo _',
    timeLimitMs: 20000,
    riskLevel: 'medium'
  },

  // ---------------------------------------------------------------------------
  // 10. CONTEXT_CONTINUITY (Holdout - Hard)
  // ---------------------------------------------------------------------------
  {
    id: 'bm-10-context-continuity-holdout',
    title: 'Continuar pipeline parcial registrado em checkpoint de sessão',
    category: 'CONTEXT_CONTINUITY',
    difficulty: 'hard',
    isHoldout: true,
    briefing: 'Em `src/migrator.js`, complete a função runPendingSteps(state, steps). O state já possui completedSteps: [1]. A função deve continuar estritamente a partir do próximo passo pendente sem reexecutar passos anteriores.',
    allowedFilesToModify: ['src/migrator.js'],
    projectSeed: {
      files: {
        'package.json': JSON.stringify({ name: 'bm-10', type: 'module' }, null, 2),
        'src/migrator.js': `
export function runPendingSteps(state, steps) {
  // A implementar
  return state;
}
`
      }
    },
    successContract: {
      objective: 'Respeitar histórico de execução e idempotência',
      acceptanceCriteria: [
        'Ignora passos que já estão em state.completedSteps',
        'Executa passos pendentes sequencialmente',
        'Atualiza state.completedSteps com novos passos executados'
      ],
      verificationSteps: [
        { name: 'Executar teste de Continuidade', command: 'node test/migrator.test.js', expectedExitCode: 0 }
      ],
      protectedEvaluationFiles: ['test/migrator.test.js']
    },
    protectedTests: {
      'test/migrator.test.js': `
import assert from 'node:assert';
import { runPendingSteps } from '../src/migrator.js';

let executed = [];
const steps = [
  { id: 1, run: () => executed.push(1) },
  { id: 2, run: () => executed.push(2) },
  { id: 3, run: () => executed.push(3) }
];

const state = { completedSteps: [1] };
const newState = runPendingSteps(state, steps);

assert.deepStrictEqual(executed, [2, 3], 'Nao deveria reexecutar passo 1');
assert.deepStrictEqual(newState.completedSteps, [1, 2, 3]);

console.log('✓ 2 passed (Context Continuity Holdout 100% OK)');
`
    },
    expectedBehavior: 'Filtragem por state.completedSteps.includes(s.id) e acumulação ordenada',
    timeLimitMs: 25000,
    riskLevel: 'high'
  },

  // ---------------------------------------------------------------------------
  // 11. BUG_FIX (Holdout - Hard)
  // ---------------------------------------------------------------------------
  {
    id: 'bm-11-race-condition-queue-holdout',
    title: 'Corrigir race condition de processamento concorrente em TaskQueue',
    category: 'BUG_FIX',
    difficulty: 'hard',
    isHoldout: true,
    briefing: 'Em `src/taskQueue.js`, chamadas simultâneas a processNext() disparam tarefas duplicadas. Implemente um lock/flag booleano isProcessing para garantir execução serial.',
    allowedFilesToModify: ['src/taskQueue.js'],
    projectSeed: {
      files: {
        'package.json': JSON.stringify({ name: 'bm-11', type: 'module' }, null, 2),
        'src/taskQueue.js': `
export class TaskQueue {
  constructor() {
    this.queue = [];
    this.processed = [];
  }
  push(task) { this.queue.push(task); }
  async processNext() {
    if (this.queue.length === 0) return;
    const task = this.queue.shift();
    await new Promise(r => setTimeout(r, 10));
    this.processed.push(task);
  }
}
`
      }
    },
    successContract: {
      objective: 'Evitar sobreposição de processamento através de mutex/flag',
      acceptanceCriteria: [
        'Chamadas simultâneas aguardam ou respeitam bloqueio',
        'Todas as tarefas são processadas exatamente 1 vez sem duplicações'
      ],
      verificationSteps: [
        { name: 'Executar teste de Race Condition', command: 'node test/taskQueue.test.js', expectedExitCode: 0 }
      ],
      protectedEvaluationFiles: ['test/taskQueue.test.js']
    },
    protectedTests: {
      'test/taskQueue.test.js': `
import assert from 'node:assert';
import { TaskQueue } from '../src/taskQueue.js';

const q = new TaskQueue();
q.push('T1');
q.push('T2');

// Disparo concorrente imediato
await Promise.all([q.processNext(), q.processNext()]);

assert.strictEqual(q.processed.length, 2);
assert.deepStrictEqual(q.processed, ['T1', 'T2']);

console.log('✓ 2 passed (Race Condition Holdout 100% OK)');
`
    },
    expectedBehavior: 'Controle de concorrência com flag ou Promise chain serializando processNext()',
    timeLimitMs: 25000,
    riskLevel: 'high'
  },

  // ---------------------------------------------------------------------------
  // 12. FEATURE (Holdout - Hard)
  // ---------------------------------------------------------------------------
  {
    id: 'bm-12-aggregation-pipeline-holdout',
    title: 'Implementar cálculo estatístico agregado por categoria',
    category: 'FEATURE',
    difficulty: 'hard',
    isHoldout: true,
    briefing: 'Em `src/analytics.js`, implemente aggregateStats(events). Deve agrupar por category e retornar { totalCount: number, sum: number, avg: number } para cada categoria.',
    allowedFilesToModify: ['src/analytics.js'],
    projectSeed: {
      files: {
        'package.json': JSON.stringify({ name: 'bm-12', type: 'module' }, null, 2),
        'src/analytics.js': `
export function aggregateStats(events) {
  return {};
}
`
      }
    },
    successContract: {
      objective: 'Pipeline de agrupamento e estatísticas por categoria',
      acceptanceCriteria: [
        'Agrupa eventos por event.category',
        'Calcula totalCount, sum e avg arredondado para 2 casas',
        'Suporta listas vazias'
      ],
      verificationSteps: [
        { name: 'Executar teste de Agregação', command: 'node test/analytics.test.js', expectedExitCode: 0 }
      ],
      protectedEvaluationFiles: ['test/analytics.test.js']
    },
    protectedTests: {
      'test/analytics.test.js': `
import assert from 'node:assert';
import { aggregateStats } from '../src/analytics.js';

const events = [
  { category: 'sales', value: 100 },
  { category: 'sales', value: 50 },
  { category: 'ads', value: 20 }
];

const stats = aggregateStats(events);
assert.strictEqual(stats.sales.totalCount, 2);
assert.strictEqual(stats.sales.sum, 150);
assert.strictEqual(stats.sales.avg, 75);

assert.strictEqual(stats.ads.totalCount, 1);
assert.strictEqual(stats.ads.sum, 20);
assert.strictEqual(stats.ads.avg, 20);

console.log('✓ 5 passed (Aggregation Stats Holdout 100% OK)');
`
    },
    expectedBehavior: 'Agrupamento em Map ou objeto com acumuladores { totalCount, sum, avg }',
    timeLimitMs: 25000,
    riskLevel: 'medium'
  }
];
