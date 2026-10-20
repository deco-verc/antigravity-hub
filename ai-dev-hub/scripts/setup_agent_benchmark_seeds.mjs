// scripts/setup_agent_benchmark_seeds.mjs
// Sets up the 5 isolated Project Seeds and Protected Holdout tests for Level 2 Agent Benchmark

import fs from 'node:fs';
import path from 'node:path';

const BASE_DIR = 'C:\\IA\\agent-benchmarks';
const SEEDS_DIR = path.join(BASE_DIR, 'seeds');
const PROTECTED_DIR = path.join(BASE_DIR, 'protected');

console.log('📦 Inicializando Seeds e Holdouts Protegidos do LEVEL 2 (AGENT BENCHMARK)...');

// Helper to write file safely
function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content.trim() + '\n', 'utf-8');
}

// -----------------------------------------------------------------------------
// BENCHMARK 01: BUG_FIX (parseQueryString)
// -----------------------------------------------------------------------------
console.log('-> Configurando Seed e Holdout: agent-bm-01-bugfix...');
writeFile(path.join(SEEDS_DIR, 'agent-bm-01-bugfix', 'package.json'), JSON.stringify({ name: 'agent-bm-01', type: 'module' }, null, 2));
writeFile(path.join(SEEDS_DIR, 'agent-bm-01-bugfix', 'src', 'queryString.js'), `
export function parseQueryString(query) {
  if (!query) return {};
  const cleaned = query.startsWith('?') ? query.slice(1) : query;
  const pairs = cleaned.split('&');
  const result = {};

  for (const pair of pairs) {
    if (!pair) continue;
    const [rawKey, rawValue] = pair.split('=');
    // Bug proposital: nao decodifica URI component e sobrescreve chave repetida com valor unico
    const key = rawKey;
    const val = rawValue !== undefined ? rawValue : '';
    result[key] = val;
  }

  return result;
}
`);

// Protected Test (Hidden from Agent)
writeFile(path.join(PROTECTED_DIR, 'agent-bm-01-bugfix', 'test', 'queryString.test.js'), `
import assert from 'node:assert';
import { parseQueryString } from '../src/queryString.js';

// 1. Basic decode
const q1 = parseQueryString('name=Alan%20Turing&city=London');
assert.strictEqual(q1.name, 'Alan Turing', 'Deveria decodificar URL encode');
assert.strictEqual(q1.city, 'London');

// 2. Repeated keys
const q2 = parseQueryString('tag=math&tag=ai&tag=logic');
assert.deepStrictEqual(q2.tag, ['math', 'ai', 'logic'], 'Chaves repetidas devem se tornar array');

// 3. Question mark prefix
const q3 = parseQueryString('?sort=asc&filter=active');
assert.strictEqual(q3.sort, 'asc');
assert.strictEqual(q3.filter, 'active');

console.log('✓ 3 passed (QueryString Bugfix 100% OK)');
`);

// -----------------------------------------------------------------------------
// BENCHMARK 02: FEATURE (InMemoryRepository)
// -----------------------------------------------------------------------------
console.log('-> Configurando Seed e Holdout: agent-bm-02-feature...');
writeFile(path.join(SEEDS_DIR, 'agent-bm-02-feature', 'package.json'), JSON.stringify({ name: 'agent-bm-02', type: 'module' }, null, 2));
writeFile(path.join(SEEDS_DIR, 'agent-bm-02-feature', 'src', 'repository.js'), `
export class InMemoryRepository {
  constructor(items = []) {
    this.items = [...items];
  }

  add(item) {
    this.items.push(item);
    return item;
  }

  getAll() {
    return [...this.items];
  }
}
`);

// Protected Test (Hidden from Agent)
writeFile(path.join(PROTECTED_DIR, 'agent-bm-02-feature', 'test', 'repository.test.js'), `
import assert from 'node:assert';
import { InMemoryRepository } from '../src/repository.js';

const repo = new InMemoryRepository([
  { id: 1, type: 'book', price: 20 },
  { id: 2, type: 'pen', price: 5 },
  { id: 3, type: 'book', price: 35 },
  { id: 4, type: 'notebook', price: 15 },
  { id: 5, type: 'book', price: 50 }
]);

// 1. findBy
const books = repo.findBy(item => item.type === 'book');
assert.strictEqual(books.length, 3, 'Deveria encontrar 3 books');

// 2. paginate
const p1 = repo.paginate(1, 2);
assert.strictEqual(p1.items.length, 2, 'Pagina 1 com pageSize 2 deve ter 2 itens');
assert.strictEqual(p1.total, 5, 'Total deve ser 5');
assert.strictEqual(p1.totalPages, 3, 'Total de paginas deve ser 3');
assert.strictEqual(p1.page, 1, 'Numero da pagina deve ser 1');

const p3 = repo.paginate(3, 2);
assert.strictEqual(p3.items.length, 1, 'Pagina 3 deve ter o item restante');
assert.strictEqual(p3.items[0].id, 5);

console.log('✓ 3 passed (InMemoryRepository Features 100% OK)');
`);

// -----------------------------------------------------------------------------
// BENCHMARK 03: SURGICAL CHANGE (UserService Email Validation)
// -----------------------------------------------------------------------------
console.log('-> Configurando Seed e Holdout: agent-bm-03-surgical...');
writeFile(path.join(SEEDS_DIR, 'agent-bm-03-surgical', 'package.json'), JSON.stringify({ name: 'agent-bm-03', type: 'module' }, null, 2));
writeFile(path.join(SEEDS_DIR, 'agent-bm-03-surgical', 'src', 'authService.js'), `
export const AUTH_VERSION = 'v1.0';
export function hashToken(token) { return 'tok_' + token; }
`);
writeFile(path.join(SEEDS_DIR, 'agent-bm-03-surgical', 'src', 'metricsService.js'), `
export function trackEvent(name) { return { name, ts: Date.now() }; }
`);
writeFile(path.join(SEEDS_DIR, 'agent-bm-03-surgical', 'src', 'config.js'), `
export const APP_ENV = 'production';
`);
writeFile(path.join(SEEDS_DIR, 'agent-bm-03-surgical', 'src', 'userService.js'), `
export class UserService {
  constructor() {
    this.users = [];
  }

  createUser(user) {
    this.users.push(user);
    return user;
  }
}
`);

// Protected Test (Hidden from Agent)
writeFile(path.join(PROTECTED_DIR, 'agent-bm-03-surgical', 'test', 'userService.test.js'), `
import assert from 'node:assert';
import { UserService } from '../src/userService.js';

const service = new UserService();

// 1. Valid user
const u1 = service.createUser({ id: 1, email: 'ada@example.com', name: 'Ada Lovelace' });
assert.strictEqual(u1.email, 'ada@example.com');

// 2. Rejection of invalid email formats
assert.throws(() => service.createUser({ id: 2, email: 'invalid-email', name: 'Bob' }), /Email invalido/);
assert.throws(() => service.createUser({ id: 3, email: '', name: 'Charlie' }), /Email invalido/);
assert.throws(() => service.createUser({ id: 4, name: 'David' }), /Email invalido/);

console.log('✓ 4 passed (Surgical UserService 100% OK)');
`);

// -----------------------------------------------------------------------------
// BENCHMARK 04: MULTI_FILE_CHANGE (Product & CatalogService)
// -----------------------------------------------------------------------------
console.log('-> Configurando Seed e Holdout: agent-bm-04-multifile...');
writeFile(path.join(SEEDS_DIR, 'agent-bm-04-multifile', 'package.json'), JSON.stringify({ name: 'agent-bm-04', type: 'module' }, null, 2));
writeFile(path.join(SEEDS_DIR, 'agent-bm-04-multifile', 'src', 'models', 'product.js'), `
export class Product {
  constructor(id, name, price) {
    this.id = id;
    this.name = name;
    this.price = price;
  }
}
`);
writeFile(path.join(SEEDS_DIR, 'agent-bm-04-multifile', 'src', 'services', 'catalogService.js'), `
export class CatalogService {
  constructor() {
    this.catalog = [];
  }

  addProduct(product) {
    this.catalog.push(product);
    return product;
  }
}
`);

// Protected Test (Hidden from Agent)
writeFile(path.join(PROTECTED_DIR, 'agent-bm-04-multifile', 'test', 'catalog.test.js'), `
import assert from 'node:assert';
import { Product } from '../src/models/product.js';
import { CatalogService } from '../src/services/catalogService.js';

const catalog = new CatalogService();
catalog.addProduct(new Product(1, 'Notebook Pro', 2500, ['tech', 'work']));
catalog.addProduct(new Product(2, 'Coffee Mug', 15, ['home', 'kitchen']));
catalog.addProduct(new Product(3, 'Wireless Mouse', 45, ['tech', 'accessories']));

// 1. Tag filter tech
const techItems = catalog.findByTag('tech');
assert.strictEqual(techItems.length, 2);
assert.deepStrictEqual(techItems.map(p => p.id), [1, 3]);

// 2. Tag filter work
const workItems = catalog.findByTag('work');
assert.strictEqual(workItems.length, 1);
assert.strictEqual(workItems[0].name, 'Notebook Pro');

// 3. Nonexistent tag
const empty = catalog.findByTag('gaming');
assert.strictEqual(empty.length, 0);

console.log('✓ 3 passed (Multi-File Catalog 100% OK)');
`);

// -----------------------------------------------------------------------------
// BENCHMARK 05: CONTEXT_CONTINUITY (Two-Worker Handoff)
// -----------------------------------------------------------------------------
console.log('-> Configurando Seed e Holdout: agent-bm-05-continuity...');
writeFile(path.join(SEEDS_DIR, 'agent-bm-05-continuity', 'package.json'), JSON.stringify({ name: 'agent-bm-05', type: 'module' }, null, 2));
writeFile(path.join(SEEDS_DIR, 'agent-bm-05-continuity', '.ai-dev-hub', 'session-summary.md'), `
# Checkpoint de Sessão — Worker A
- Tarefa em andamento: Migração de Schema em 2 etapas
- Concluído: Step 1 (normalizeKeys) implementado e testado.
- Próximo passo obrigatório para Worker B: Implementar Step 2 (validateSchema) em src/migrator.js.
- Requisitos de validateSchema: se this.data não tiver a propriedade 'id', lançar Error('Schema invalido: missing id'). Adicionar 'validateSchema' ao array this.completedSteps.
`);
writeFile(path.join(SEEDS_DIR, 'agent-bm-05-continuity', 'src', 'migrator.js'), `
export class SchemaMigrator {
  constructor(data) {
    this.data = { ...data };
    this.completedSteps = [];
  }

  // Step 1: Implementado pelo Worker A
  normalizeKeys() {
    const normalized = {};
    for (const [k, v] of Object.entries(this.data)) {
      normalized[k.toLowerCase().trim()] = v;
    }
    this.data = normalized;
    this.completedSteps.push('normalizeKeys');
    return this;
  }

  // Step 2: A ser implementado pelo Worker B preservando o Step 1
}
`);

// Protected Test (Hidden from Agent)
writeFile(path.join(PROTECTED_DIR, 'agent-bm-05-continuity', 'test', 'migration.test.js'), `
import assert from 'node:assert';
import { SchemaMigrator } from '../src/migrator.js';

// 1. Valid data with whitespace keys
const m1 = new SchemaMigrator({ '  ID ': 101, 'NAME': 'Test User' });
m1.normalizeKeys();
m1.validateSchema();

assert.deepStrictEqual(m1.completedSteps, ['normalizeKeys', 'validateSchema'], 'Ambos os steps devem estar registrados');
assert.strictEqual(m1.data.id, 101, 'Chave id normalizada deve ser preservada');

// 2. Invalid data missing id
const m2 = new SchemaMigrator({ 'NAME': 'No Id' });
m2.normalizeKeys();
assert.throws(() => m2.validateSchema(), /Schema invalido/, 'Deve lançar erro quando faltar id');

console.log('✓ 2 passed (Context Continuity Migration 100% OK)');
`);

console.log('✅ Todos os 5 Seeds e Holdouts foram criados com sucesso em C:\\IA\\agent-benchmarks\\!');
