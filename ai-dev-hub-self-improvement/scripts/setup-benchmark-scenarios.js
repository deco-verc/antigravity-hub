// scripts/setup-benchmark-scenarios.js
// Sets up paired identical benchmark repositories for Scenarios 1-5

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const BENCHMARK_ROOT = 'C:\\IA\\test-projects\\decohub-prompt-benchmark';

if (fs.existsSync(BENCHMARK_ROOT)) {
  fs.rmSync(BENCHMARK_ROOT, { recursive: true, force: true });
}
fs.mkdirSync(BENCHMARK_ROOT, { recursive: true });

function initGitRepo(dir) {
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.name "DecoHUB Benchmark"', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.email "benchmark@decohub.local"', { cwd: dir, stdio: 'pipe' });
  execSync('git add .', { cwd: dir, stdio: 'pipe' });
  execSync('git commit -m "chore: initial benchmark repo setup"', { cwd: dir, stdio: 'pipe' });
}

function clonePair(scenarioDir) {
  const baseDir = path.join(scenarioDir, 'base');
  const legacyDir = path.join(scenarioDir, 'legacy');
  const fableDir = path.join(scenarioDir, 'fable');

  // Clone legacy from base
  execSync(`git clone "${baseDir}" "${legacyDir}"`, { stdio: 'pipe' });
  execSync('git config user.name "DecoHUB Benchmark"', { cwd: legacyDir, stdio: 'pipe' });
  execSync('git config user.email "benchmark@decohub.local"', { cwd: legacyDir, stdio: 'pipe' });

  // Clone fable from base
  execSync(`git clone "${baseDir}" "${fableDir}"`, { stdio: 'pipe' });
  execSync('git config user.name "DecoHUB Benchmark"', { cwd: fableDir, stdio: 'pipe' });
  execSync('git config user.email "benchmark@decohub.local"', { cwd: fableDir, stdio: 'pipe' });

  // Verify initial commit SHAs are identical
  const shaBase = execSync('git rev-parse HEAD', { cwd: baseDir, encoding: 'utf-8' }).trim();
  const shaLegacy = execSync('git rev-parse HEAD', { cwd: legacyDir, encoding: 'utf-8' }).trim();
  const shaFable = execSync('git rev-parse HEAD', { cwd: fableDir, encoding: 'utf-8' }).trim();

  if (shaBase !== shaLegacy || shaBase !== shaFable) {
    throw new Error(`SHA MISMATCH: Base ${shaBase}, Legacy ${shaLegacy}, Fable ${shaFable}`);
  }

  console.log(`[Setup] ${path.basename(scenarioDir)} initial SHA: ${shaBase}`);
}

// -------------------------------------------------------------
// Scenario 1 — Simple implementation
// -------------------------------------------------------------
const s1Dir = path.join(BENCHMARK_ROOT, 'scenario-01');
const s1Base = path.join(s1Dir, 'base');
fs.mkdirSync(path.join(s1Base, 'src'), { recursive: true });
fs.mkdirSync(path.join(s1Base, 'test'), { recursive: true });

fs.writeFileSync(path.join(s1Base, 'package.json'), JSON.stringify({
  name: 'scenario-01-string-utils',
  version: '1.0.0',
  type: 'module',
  scripts: { test: 'node --test test/stringUtils.test.js' }
}, null, 2));

fs.writeFileSync(path.join(s1Base, 'src', 'stringUtils.js'), `// String utilities
export function truncate(str, maxLength, suffix = '...') {
  // TODO: implement
}

export function slugify(str) {
  // TODO: implement
}

export function capitalizeWords(str) {
  // TODO: implement
}
`);

fs.writeFileSync(path.join(s1Base, 'test', 'stringUtils.test.js'), `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { truncate, slugify, capitalizeWords } from '../src/stringUtils.js';

test('truncate should shorten string and append suffix when exceeding maxLength', () => {
  assert.strictEqual(truncate('Hello World', 8), 'Hello...');
  assert.strictEqual(truncate('Hello', 10), 'Hello');
  assert.strictEqual(truncate('Test', 4), 'Test');
  assert.strictEqual(truncate('Custom Suffix', 6, '!'), 'Custom!');
});

test('slugify should normalize and convert string to URL-safe slug', () => {
  assert.strictEqual(slugify('Hello World!'), 'hello-world');
  assert.strictEqual(slugify('  Multiple   Spaces  '), 'multiple-spaces');
  assert.strictEqual(slugify('Café & Restaurant'), 'cafe-restaurant');
  assert.strictEqual(slugify('---Edge--Hyphens---'), 'edge-hyphens');
});

test('capitalizeWords should capitalize the first letter of each word', () => {
  assert.strictEqual(capitalizeWords('hello world'), 'Hello World');
  assert.strictEqual(capitalizeWords('antigravity hub developer'), 'Antigravity Hub Developer');
  assert.strictEqual(capitalizeWords(''), '');
});
`);

initGitRepo(s1Base);
clonePair(s1Dir);

// -------------------------------------------------------------
// Scenario 2 — Real Bug Fix
// -------------------------------------------------------------
const s2Dir = path.join(BENCHMARK_ROOT, 'scenario-02');
const s2Base = path.join(s2Dir, 'base');
fs.mkdirSync(path.join(s2Base, 'src'), { recursive: true });
fs.mkdirSync(path.join(s2Base, 'test'), { recursive: true });

fs.writeFileSync(path.join(s2Base, 'package.json'), JSON.stringify({
  name: 'scenario-02-checkout-bug',
  version: '1.0.0',
  type: 'module',
  scripts: { test: 'node --test test/checkout.test.js' }
}, null, 2));

fs.writeFileSync(path.join(s2Base, 'src', 'checkout.js'), `export function calculateOrderTotal({ items, couponCode = null, taxRate = 0.1, shippingCost = 15 }) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('Items array must not be empty');
  }

  const subtotal = items.reduce((acc, item) => acc + (item.price * item.quantity), 0);

  // BUG: percent discount subtracted literally instead of percentage, and applied after tax
  let discount = 0;
  if (couponCode === 'SAVE20') {
    discount = 20; // BUG: Literal 20 instead of 20% of subtotal!
  } else if (couponCode === 'FLAT10') {
    discount = 10;
  }

  // BUG: tax is computed on raw subtotal instead of discounted subtotal
  const tax = subtotal * taxRate;

  // Free shipping threshold: orders with subtotal >= 100 get free shipping
  const effectiveShipping = subtotal >= 100 ? 0 : shippingCost;

  const total = Number((subtotal - discount + tax + effectiveShipping).toFixed(2));
  return {
    subtotal,
    discount,
    tax: Number(tax.toFixed(2)),
    shipping: effectiveShipping,
    total
  };
}
`);

fs.writeFileSync(path.join(s2Base, 'test', 'checkout.test.js'), `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateOrderTotal } from '../src/checkout.js';

test('calculates correct total without coupons', () => {
  const items = [{ price: 20, quantity: 2 }, { price: 10, quantity: 1 }]; // subtotal = 50
  const result = calculateOrderTotal({ items, taxRate: 0.1, shippingCost: 10 });
  // subtotal 50, discount 0, tax 5 (10% of 50), shipping 10 -> total 65
  assert.strictEqual(result.subtotal, 50);
  assert.strictEqual(result.discount, 0);
  assert.strictEqual(result.tax, 5);
  assert.strictEqual(result.shipping, 10);
  assert.strictEqual(result.total, 65);
});

test('calculates correct total with percentage coupon SAVE20 and tax on discounted amount', () => {
  const items = [{ price: 100, quantity: 2 }]; // subtotal = 200
  const result = calculateOrderTotal({ items, couponCode: 'SAVE20', taxRate: 0.1 });
  // 20% of 200 = 40 discount -> discounted subtotal = 160
  // tax = 10% of 160 = 16
  // shipping = 0 (subtotal >= 100)
  // total = 160 + 16 = 176
  assert.strictEqual(result.subtotal, 200);
  assert.strictEqual(result.discount, 40);
  assert.strictEqual(result.tax, 16);
  assert.strictEqual(result.shipping, 0);
  assert.strictEqual(result.total, 176);
});

test('calculates correct total with FLAT10 discount', () => {
  const items = [{ price: 30, quantity: 1 }]; // subtotal = 30
  const result = calculateOrderTotal({ items, couponCode: 'FLAT10', taxRate: 0.1, shippingCost: 10 });
  // discounted subtotal = 20
  // tax = 10% of 20 = 2
  // shipping = 10
  // total = 20 + 2 + 10 = 32
  assert.strictEqual(result.subtotal, 30);
  assert.strictEqual(result.discount, 10);
  assert.strictEqual(result.tax, 2);
  assert.strictEqual(result.total, 32);
});
`);

initGitRepo(s2Base);
clonePair(s2Dir);

// -------------------------------------------------------------
// Scenario 3 — Multi-file coordinated change
// -------------------------------------------------------------
const s3Dir = path.join(BENCHMARK_ROOT, 'scenario-03');
const s3Base = path.join(s3Dir, 'base');
fs.mkdirSync(path.join(s3Base, 'src'), { recursive: true });
fs.mkdirSync(path.join(s3Base, 'test'), { recursive: true });

fs.writeFileSync(path.join(s3Base, 'package.json'), JSON.stringify({
  name: 'scenario-03-multi-file',
  version: '1.0.0',
  type: 'module',
  scripts: { test: 'node --test test/service.test.js' }
}, null, 2));

fs.writeFileSync(path.join(s3Base, 'src', 'types.js'), `export function validateTask(task) {
  if (!task.title) throw new Error('title is required');
  // Currently missing priority validation ('low', 'medium', 'high')
  return true;
}
`);

fs.writeFileSync(path.join(s3Base, 'src', 'repository.js'), `export class TaskRepository {
  constructor() {
    this.tasks = [];
  }
  add(task) {
    this.tasks.push(task);
    return task;
  }
  getAll() {
    return [...this.tasks];
  }
  // Missing query(filter, pagination) method
}
`);

fs.writeFileSync(path.join(s3Base, 'src', 'service.js'), `import { validateTask } from './types.js';
import { TaskRepository } from './repository.js';

export class TaskService {
  constructor(repo = new TaskRepository()) {
    this.repo = repo;
  }
  createTask(data) {
    validateTask(data);
    return this.repo.add(data);
  }
  listTasks(options = {}) {
    // Currently only returns all without filtering or pagination metadata
    return { items: this.repo.getAll() };
  }
}
`);

fs.writeFileSync(path.join(s3Base, 'src', 'index.js'), `export * from './types.js';
export * from './repository.js';
export * from './service.js';
`);

fs.writeFileSync(path.join(s3Base, 'test', 'service.test.js'), `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TaskService, TaskRepository } from '../src/index.js';

test('TaskService supports priority filtering and pagination metadata', () => {
  const repo = new TaskRepository();
  const service = new TaskService(repo);

  service.createTask({ id: '1', title: 'Task 1', priority: 'high' });
  service.createTask({ id: '2', title: 'Task 2', priority: 'low' });
  service.createTask({ id: '3', title: 'Task 3', priority: 'high' });
  service.createTask({ id: '4', title: 'Task 4', priority: 'medium' });
  service.createTask({ id: '5', title: 'Task 5', priority: 'high' });

  // Test priority filter
  const highTasks = service.listTasks({ priority: 'high' });
  assert.strictEqual(highTasks.total, 3);
  assert.strictEqual(highTasks.items.length, 3);
  assert.ok(highTasks.items.every(t => t.priority === 'high'));

  // Test pagination
  const page1 = service.listTasks({ page: 1, pageSize: 2 });
  assert.strictEqual(page1.total, 5);
  assert.strictEqual(page1.page, 1);
  assert.strictEqual(page1.pageSize, 2);
  assert.strictEqual(page1.totalPages, 3);
  assert.strictEqual(page1.items.length, 2);
  assert.strictEqual(page1.items[0].id, '1');
  assert.strictEqual(page1.items[1].id, '2');

  const page2 = service.listTasks({ page: 2, pageSize: 2 });
  assert.strictEqual(page2.page, 2);
  assert.strictEqual(page2.items.length, 2);
  assert.strictEqual(page2.items[0].id, '3');
  assert.strictEqual(page2.items[1].id, '4');
});
`);

initGitRepo(s3Base);
clonePair(s3Dir);

// -------------------------------------------------------------
// Scenario 4 — Test Failure & Self-Correction
// -------------------------------------------------------------
const s4Dir = path.join(BENCHMARK_ROOT, 'scenario-04');
const s4Base = path.join(s4Dir, 'base');
fs.mkdirSync(path.join(s4Base, 'src'), { recursive: true });
fs.mkdirSync(path.join(s4Base, 'test'), { recursive: true });

fs.writeFileSync(path.join(s4Base, 'package.json'), JSON.stringify({
  name: 'scenario-04-retry-backoff',
  version: '1.0.0',
  type: 'module',
  scripts: { test: 'node --test test/retry.test.js' }
}, null, 2));

fs.writeFileSync(path.join(s4Base, 'src', 'retry.js'), `export function calculateBackoff(attempt, options = {}) {
  // TODO: Implement exponential backoff with clamping and optional jitter
  // Subtle requirement:
  // attempt <= 0 must return 0
  // maxDelayMs must cap the delay BEFORE and AFTER jitter
  // when options.jitter === false, returns deterministic baseMs * (2 ** (attempt - 1))
  // when options.jitter === true, returns value between baseMs and calculated delay
  return 0;
}
`);

fs.writeFileSync(path.join(s4Base, 'test', 'retry.test.js'), `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateBackoff } from '../src/retry.js';

test('boundary conditions: attempt <= 0 returns 0', () => {
  assert.strictEqual(calculateBackoff(0, { baseMs: 100 }), 0);
  assert.strictEqual(calculateBackoff(-1, { baseMs: 100 }), 0);
});

test('deterministic exponential progression when jitter is false', () => {
  const opts = { baseMs: 100, maxDelayMs: 2000, jitter: false };
  assert.strictEqual(calculateBackoff(1, opts), 100);
  assert.strictEqual(calculateBackoff(2, opts), 200);
  assert.strictEqual(calculateBackoff(3, opts), 400);
  assert.strictEqual(calculateBackoff(4, opts), 800);
  assert.strictEqual(calculateBackoff(5, opts), 1600);
  // Must clamp at maxDelayMs
  assert.strictEqual(calculateBackoff(6, opts), 2000);
  assert.strictEqual(calculateBackoff(10, opts), 2000);
});

test('jitter produces bounded results never exceeding maxDelayMs', () => {
  const opts = { baseMs: 100, maxDelayMs: 500, jitter: true };
  for (let i = 1; i <= 20; i++) {
    const delay = calculateBackoff(5, opts);
    assert.ok(delay >= 100, \`Delay \${delay} must be >= baseMs (100)\`);
    assert.ok(delay <= 500, \`Delay \${delay} must be <= maxDelayMs (500)\`);
  }
});
`);

initGitRepo(s4Base);
clonePair(s4Dir);

// -------------------------------------------------------------
// Scenario 5 — Project with Context & Memory Compliance
// -------------------------------------------------------------
const s5Dir = path.join(BENCHMARK_ROOT, 'scenario-05');
const s5Base = path.join(s5Dir, 'base');
fs.mkdirSync(path.join(s5Base, '.ai-dev-hub'), { recursive: true });
fs.mkdirSync(path.join(s5Base, 'src'), { recursive: true });
fs.mkdirSync(path.join(s5Base, 'test'), { recursive: true });

fs.writeFileSync(path.join(s5Base, '.ai-dev-hub', 'project.md'), `# Enterprise Audit Logging System
Scope: Structured audit event logging for compliance and tracing.
`);

fs.writeFileSync(path.join(s5Base, '.ai-dev-hub', 'decisions.md'), `# Architectural Decisions Log

## [DEC-001] Strict ISO 8601 UTC Timestamp Format
- Status: Accepted
- Rule: All recorded timestamps must strictly be formatted as ISO 8601 UTC strings ending with 'Z' (e.g. '2026-10-07T22:00:00.000Z').
- Rationale: Multi-region consistency. Unix epoch integers or non-Z offsets are strictly rejected.

## [DEC-002] RFC 7807 Error Shape
- Status: Accepted
- Rule: When an audit record logs an error or rejection, the error payload must follow RFC 7807 problem details: { type, title, status, detail, instance }.
- Rationale: Standardized client diagnostic contract.
`);

fs.writeFileSync(path.join(s5Base, '.ai-dev-hub', 'session-summary.md'), `# Session Summary
Previous Session #2: Core architecture initialized. Next step: implement AuditLogger conforming to DEC-001 and DEC-002.
`);

fs.writeFileSync(path.join(s5Base, 'package.json'), JSON.stringify({
  name: 'scenario-05-context-memory',
  version: '1.0.0',
  type: 'module',
  scripts: { test: 'node --test test/auditLogger.test.js' }
}, null, 2));

fs.writeFileSync(path.join(s5Base, 'src', 'auditLogger.js'), `// AuditLogger implementation
export class AuditLogger {
  constructor() {
    this.logs = [];
  }
  logEvent(action, payload = {}) {
    // Must respect DEC-001 (ISO 8601 UTC ending with Z)
    // Must store { id, action, timestamp, payload }
  }
  logError(action, errorDetail) {
    // Must respect DEC-002 (RFC 7807 error format)
    // Must store { id, action, timestamp, error: { type, title, status, detail, instance } }
  }
  getEvents() {
    return [...this.logs];
  }
}
`);

fs.writeFileSync(path.join(s5Base, 'test', 'auditLogger.test.js'), `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AuditLogger } from '../src/auditLogger.js';

test('logEvent formats timestamp strictly according to DEC-001 (ISO 8601 UTC ending with Z)', () => {
  const logger = new AuditLogger();
  logger.logEvent('USER_LOGIN', { userId: 'u-123' });

  const events = logger.getEvents();
  assert.strictEqual(events.length, 1);
  const ev = events[0];
  assert.strictEqual(ev.action, 'USER_LOGIN');
  assert.strictEqual(typeof ev.timestamp, 'string');
  assert.ok(ev.timestamp.endsWith('Z'), 'Timestamp must end with Z as required by DEC-001');
  assert.ok(!isNaN(Date.parse(ev.timestamp)), 'Timestamp must be valid ISO date string');
});

test('logError formats error strictly according to DEC-002 (RFC 7807 Problem Details)', () => {
  const logger = new AuditLogger();
  logger.logError('PAYMENT_FAILED', {
    status: 402,
    detail: 'Insufficient funds on credit card',
    instance: '/payments/tx-999'
  });

  const events = logger.getEvents();
  assert.strictEqual(events.length, 1);
  const ev = events[0];
  assert.ok(ev.error, 'Event must contain error object');
  assert.strictEqual(ev.error.status, 402);
  assert.strictEqual(ev.error.detail, 'Insufficient funds on credit card');
  assert.strictEqual(ev.error.instance, '/payments/tx-999');
  assert.ok(typeof ev.error.title === 'string' && ev.error.title.length > 0, 'Error title must be set per RFC 7807');
  assert.ok(typeof ev.error.type === 'string' && ev.error.type.length > 0, 'Error type must be set per RFC 7807');
});
`);

initGitRepo(s5Base);
clonePair(s5Dir);

console.log('\\n[Setup] All 5 Paired Benchmark Scenarios successfully created and validated!');
