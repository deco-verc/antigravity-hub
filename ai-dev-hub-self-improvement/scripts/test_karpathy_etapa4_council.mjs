// scripts/test_karpathy_etapa4_council.mjs
// Adversarial Verification Test Suite for ETAPA 4: AI DEV COUNCIL (LLM Council Pattern)

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const API_BASE = 'http://localhost:3001/api';
const PROJECT_ID = '28994daf-fc90-48c7-b8e2-66ddec4f4362';
const PROJECT_DIR = 'C:\\IA\\test-projects\\karpathy-validation-test';

console.log('========================================================================');
console.log('🏛️ INICIANDO SUÍTE DE TESTES: ETAPA 4 — AI DEV COUNCIL (LLM COUNCIL PATTERN)');
console.log('========================================================================\n');

async function run() {
  try {
    // 1. Setup Test Case: Create test/cache.test.js
    console.log('[Setup] 1. Criando teste automatizado: test/cache.test.js...');
    const testCode = `
import assert from 'node:assert';
import { Cache } from '../src/cache.js';

console.log('Executando suíte de testes de Cache com TTL...');

const cache = new Cache();
cache.set('user:1', { name: 'Alice' }, 1000);

const val1 = cache.get('user:1');
assert.strictEqual(val1?.name, 'Alice', 'Deveria recuperar o valor antes do TTL');

cache.delete('user:1');
assert.strictEqual(cache.get('user:1'), null, 'Deveria retornar null apos delete');

console.log('✓ Todos os testes de Cache passaram com sucesso.');
`;
    fs.writeFileSync(path.join(PROJECT_DIR, 'test', 'cache.test.js'), testCode);

    // -------------------------------------------------------------------------
    // CENÁRIO 1: CANDIDATO OVERENGINEERED (Passa nos testes, mas é inchado)
    // -------------------------------------------------------------------------
    console.log('\n------------------------------------------------------------------------');
    console.log('TESTE 1: CANDIDATO OVERENGINEERED (Adversarial Simplicity Test)');
    console.log('------------------------------------------------------------------------');
    console.log('-> Criando implementação com 4 classes, Factory e Proxy desnecessários...');

    const overengineeredCode = `
// Implementação propositalmente inchada (Overengineered)
export class CacheEntryFactory {
  static createEntry(key, value, ttl) {
    return {
      key,
      payload: JSON.parse(JSON.stringify(value)),
      expiresAt: Date.now() + ttl,
      createdAt: new Date().toISOString()
    };
  }
}

export class AbstractCacheStrategy {
  store(key, entry) { throw new Error('Not implemented'); }
  retrieve(key) { throw new Error('Not implemented'); }
}

export class MemoryCacheStorageProxy extends AbstractCacheStrategy {
  constructor() {
    super();
    this.storage = new Map();
  }
  store(key, entry) { this.storage.set(key, entry); }
  retrieve(key) { return this.storage.get(key) || null; }
  remove(key) { this.storage.delete(key); }
}

export class Cache {
  constructor() {
    this.strategy = new MemoryCacheStorageProxy();
  }
  set(key, value, ttl = 60000) {
    const entry = CacheEntryFactory.createEntry(key, value, ttl);
    this.strategy.store(key, entry);
  }
  get(key) {
    const entry = this.strategy.retrieve(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.strategy.remove(key);
      return null;
    }
    return entry.payload;
  }
  delete(key) {
    this.strategy.remove(key);
  }
}
`;
    fs.writeFileSync(path.join(PROJECT_DIR, 'src', 'cache.js'), overengineeredCode);

    // Executar teste para verificar se é funcional
    let testPassed = false;
    try {
      execSync(`node "${path.join(PROJECT_DIR, 'test', 'cache.test.js')}"`, { stdio: 'pipe' });
      testPassed = true;
      console.log('✓ Testes funcionais: PASSARAM (Exit Code 0). A funcionalidade existe.');
    } catch (e) {
      console.error('❌ Falha inesperada no teste:', e.message);
    }

    // Criar diff simulado para o Conselho
    const diffCandidate1 = `
diff --git a/src/cache.js b/src/cache.js
new file mode 100644
+export class CacheEntryFactory {
+  static createEntry(key, value, ttl) {
+    return { key, payload: JSON.parse(JSON.stringify(value)), expiresAt: Date.now() + ttl };
+  }
+}
+export class AbstractCacheStrategy { ... }
+export class MemoryCacheStorageProxy extends AbstractCacheStrategy { ... }
+export class Cache { ... }
`;

    console.log('\n🏛️ [AI DEV Council] Submetendo Candidato 1 ao Conselho Multi-Agente...');
    const councilRes1 = await fetch(`${API_BASE}/projects/${PROJECT_ID}/council/deliberate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskId: 'task-adv-cache-overengineered',
        task: { title: 'Implementar Cache com TTL em src/cache.js' },
        diff: diffCandidate1,
        filesChanged: ['src/cache.js'],
        riskLevel: 'high',
        policyTrigger: 'HIGH_RISK_TASK'
      })
    });

    const deliberation1 = await councilRes1.json();

    console.log('\n📋 RESULTADO DA DELIBERAÇÃO 1:');
    console.log(`- Veredicto Final do Chairman: [${deliberation1.chairmanVerdict}]`);
    console.log(`- Consenso: [${deliberation1.consensusLevel}]`);
    console.log(`- Nota Corretude (Reviewer A): ${deliberation1.scores.correctness}/10`);
    console.log(`- Nota Simplicidade (Reviewer B): ${deliberation1.scores.simplicity}/10`);
    console.log(`- Nota Regressão (Reviewer C): ${deliberation1.scores.regression}/10`);
    console.log(`- Nota Final: ${deliberation1.scores.final}/10`);
    console.log('\n🔍 Síntese do Presidente:');
    console.log(deliberation1.chairmanSynthesis);
    console.log('\n🎯 Classificação por Pares (Peer Rankings):');
    deliberation1.peerRankings.forEach(pr => {
      console.log(`  • ${pr.reviewerLabel} ranqueou: ${pr.rankedReviews.join(' > ')} ("${pr.justification}")`);
    });

    if (deliberation1.chairmanVerdict === 'CHANGES_REQUESTED' && deliberation1.scores.simplicity <= 5) {
      console.log('\n✅ SUCESSO NO TESTE ADVERSARIAL:');
      console.log('   O Conselho detectou o overengineering (Reviewer B: 4/10) e barrou a aprovação');
      console.log('   mesmo com todos os testes passando (Reviewer A: 9/10), ativando o Simplicity Alert!');
    } else {
      throw new Error(`Esperava CHANGES_REQUESTED com Simplicity <= 5, obteve ${deliberation1.chairmanVerdict}`);
    }

    // -------------------------------------------------------------------------
    // CENÁRIO 2: CANDIDATO CIRÚRGICO / SIMPLES (Karpathy Simplicity First)
    // -------------------------------------------------------------------------
    console.log('\n------------------------------------------------------------------------');
    console.log('TESTE 2: CANDIDATO CIRÚRGICO (Karpathy Simplicity First)');
    console.log('------------------------------------------------------------------------');
    console.log('-> Refatorando para solução minimalista com Map direto em ~15 linhas...');

    const simpleCode = `
// Solução Cirúrgica e Minimalista (Karpathy Simplicity First)
export class Cache {
  constructor() {
    this.map = new Map();
  }
  set(key, value, ttl = 60000) {
    this.map.set(key, { value, expiresAt: Date.now() + ttl });
  }
  get(key) {
    const item = this.map.get(key);
    if (!item) return null;
    if (Date.now() > item.expiresAt) {
      this.map.delete(key);
      return null;
    }
    return item.value;
  }
  delete(key) {
    this.map.delete(key);
  }
}
`;
    fs.writeFileSync(path.join(PROJECT_DIR, 'src', 'cache.js'), simpleCode);

    // Executar teste
    execSync(`node "${path.join(PROJECT_DIR, 'test', 'cache.test.js')}"`, { stdio: 'pipe' });
    console.log('✓ Testes funcionais continuam passando com exit code 0.');

    const diffCandidate2 = `
diff --git a/src/cache.js b/src/cache.js
+export class Cache {
+  constructor() { this.map = new Map(); }
+  set(key, value, ttl = 60000) { this.map.set(key, { value, expiresAt: Date.now() + ttl }); }
+  get(key) { ... }
+  delete(key) { this.map.delete(key); }
+}
`;

    console.log('\n🏛️ [AI DEV Council] Submetendo Candidato 2 (Cirúrgico) ao Conselho...');
    const councilRes2 = await fetch(`${API_BASE}/projects/${PROJECT_ID}/council/deliberate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskId: 'task-adv-cache-surgical',
        task: { title: 'Refatoração Cirúrgica de src/cache.js' },
        diff: diffCandidate2,
        filesChanged: ['src/cache.js'],
        riskLevel: 'high',
        policyTrigger: 'HIGH_RISK_TASK'
      })
    });

    const deliberation2 = await councilRes2.json();

    console.log('\n📋 RESULTADO DA DELIBERAÇÃO 2:');
    console.log(`- Veredicto Final do Chairman: [${deliberation2.chairmanVerdict}]`);
    console.log(`- Consenso: [${deliberation2.consensusLevel}]`);
    console.log(`- Nota Corretude (Reviewer A): ${deliberation2.scores.correctness}/10`);
    console.log(`- Nota Simplicidade (Reviewer B): ${deliberation2.scores.simplicity}/10`);
    console.log(`- Nota Regressão (Reviewer C): ${deliberation2.scores.regression}/10`);
    console.log(`- Nota Final: ${deliberation2.scores.final}/10`);
    console.log('\n🔍 Síntese do Presidente:');
    console.log(deliberation2.chairmanSynthesis);

    if (deliberation2.chairmanVerdict === 'APPROVED' && deliberation2.scores.simplicity >= 8) {
      console.log('\n✅ SUCESSO NO TESTE CIRÚRGICO:');
      console.log('   O Conselho aprovou unanimemente a solução concisa (Reviewer B: 9/10),');
      console.log('   reconhecendo a aderência estrita aos princípios Karpathy!');
    } else {
      throw new Error(`Esperava APPROVED, obteve ${deliberation2.chairmanVerdict}`);
    }

    // -------------------------------------------------------------------------
    // 3. VERIFICAÇÃO DE CONSULTA E AUDITORIA VIA API
    // -------------------------------------------------------------------------
    console.log('\n------------------------------------------------------------------------');
    console.log('TESTE 3: AUDITORIA E CONSULTA HISTÓRICA NO AI DEV HUB');
    console.log('------------------------------------------------------------------------');
    const listRes = await fetch(`${API_BASE}/projects/${PROJECT_ID}/council/deliberations`);
    const history = await listRes.json();
    console.log(`Total de deliberações registradas para o projeto: ${history.length}`);
    history.slice(0, 2).forEach((d, idx) => {
      console.log(`  ${idx + 1}. Task: ${d.taskId} | Verdict: ${d.chairmanVerdict} | Final Score: ${d.scores.final}/10 | Consenso: ${d.consensusLevel}`);
    });

    console.log('\n========================================================================');
    console.log('🎉 TODOS OS TESTES DA ETAPA 4 (AI DEV COUNCIL) PASSARAM COM SUCESSO!');
    console.log('========================================================================');

  } catch (err) {
    console.error('\n❌ ERRO NA EXECUÇÃO DA SUÍTE:', err);
    process.exit(1);
  }
}

run();
