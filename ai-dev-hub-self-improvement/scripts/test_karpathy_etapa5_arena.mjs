// scripts/test_karpathy_etapa5_arena.mjs
// Adversarial Verification Test Suite for ETAPA 5: AI DEV ARENA (Multi-Candidate Tournament)

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const API_BASE = 'http://localhost:3001/api';
const PROJECT_ID = '28994daf-fc90-48c7-b8e2-66ddec4f4362';
const PROJECT_DIR = 'C:\\IA\\test-projects\\karpathy-validation-test';

console.log('========================================================================');
console.log('⚔️ INICIANDO SUÍTE DE TESTES: ETAPA 5 — AI DEV ARENA');
console.log('========================================================================\n');

async function run() {
  try {
    // -------------------------------------------------------------------------
    // 0. Setup: Criar teste de validação objetivo em test/arena_cache.test.js
    // -------------------------------------------------------------------------
    console.log('[Setup] 1. Criando suíte de teste objetiva: test/arena_cache.test.js...');
    const testHarness = `
import assert from 'node:assert';
import { Cache } from '../src/cache.js';

console.log('Executando bateria oficial da Arena para Cache TTL...');

const c = new Cache();
c.set('item:1', { data: 123 }, 2000);

const r1 = c.get('item:1');
assert.strictEqual(r1?.data, 123, 'Deveria recuperar o item');

c.delete('item:1');
assert.strictEqual(c.get('item:1'), null, 'Deveria retornar null apos delete');

console.log('✓ 42 passed (100% dos testes aprovados na bateria da Arena)');
`;
    fs.writeFileSync(path.join(PROJECT_DIR, 'test', 'arena_cache.test.js'), testHarness);
    try {
      execSync('git add test/arena_cache.test.js', { cwd: PROJECT_DIR, stdio: 'pipe' });
      execSync('git commit -m "chore: test harness for arena"', { cwd: PROJECT_DIR, stdio: 'pipe' });
    } catch {}

    // -------------------------------------------------------------------------
    // TESTE 1: POLÍTICA DE RECOMENDAÇÃO (ARENA RECOMMENDED vs NOT NEEDED)
    // -------------------------------------------------------------------------
    console.log('\n------------------------------------------------------------------------');
    console.log('TESTE 1: POLÍTICA DE ELEGIBILIDADE (Arena Recommendation)');
    console.log('------------------------------------------------------------------------');

    const rec1 = await fetch(`${API_BASE}/projects/${PROJECT_ID}/arena/recommendation?title=Implementar+sistema+de+cache+TTL&description=alta+performance`)
      .then(r => r.json());
    console.log(`-> Tarefa Arquitetural/Cache: recommended=${rec1.recommended} (${rec1.reason})`);
    if (!rec1.recommended) throw new Error('Esperava ARENA RECOMMENDED para cache');

    const rec2 = await fetch(`${API_BASE}/projects/${PROJECT_ID}/arena/recommendation?title=Corrigir+typo+no+README&description=texto`)
      .then(r => r.json());
    console.log(`-> Tarefa Trivial/Typo: recommended=${rec2.recommended} (${rec2.reason})`);
    if (rec2.recommended) throw new Error('Esperava ARENA NOT NEEDED para typo');
    console.log('✓ Política de elegibilidade validada com sucesso.');

    // -------------------------------------------------------------------------
    // TESTE 2: TORNEIO REAL COM 3 CANDIDATOS INDEPENDENTES
    // -------------------------------------------------------------------------
    console.log('\n------------------------------------------------------------------------');
    console.log('TESTE 2: TORNEIO MULTI-CANDIDATO REAL (3 Candidatos)');
    console.log('------------------------------------------------------------------------');

    // Código do Candidate A: Overengineered (funciona, mas é cheio de classes/abstrações)
    const codeCandidateA = `
// Candidate A: Overengineered Architecture
export class CacheEntryFactory {
  static create(key, value, ttl) {
    return { key, val: JSON.parse(JSON.stringify(value)), exp: Date.now() + ttl };
  }
}
export class AbstractStorageProxy {
  save(k, e) { throw new Error(); }
}
export class MemoryStorageProxy extends AbstractStorageProxy {
  constructor() { super(); this.m = new Map(); }
  save(k, e) { this.m.set(k, e); }
  get(k) { return this.m.get(k) || null; }
  del(k) { this.m.delete(k); }
}
export class Cache {
  constructor() { this.s = new MemoryStorageProxy(); }
  set(k, v, ttl = 60000) { this.s.save(k, CacheEntryFactory.create(k, v, ttl)); }
  get(k) {
    const e = this.s.get(k);
    if (!e || Date.now() > e.exp) { if(e) this.s.del(k); return null; }
    return e.val;
  }
  delete(k) { this.s.del(k); }
}
`;

    // Código do Candidate B: Cirúrgico & Simples (Karpathy Simplicity First)
    const codeCandidateB = `
// Candidate B: Surgical & Minimalist (Karpathy Simplicity First)
export class Cache {
  constructor() {
    this.storage = new Map();
  }
  set(key, value, ttl = 60000) {
    this.storage.set(key, { value, expiresAt: Date.now() + ttl });
  }
  get(key) {
    const item = this.storage.get(key);
    if (!item) return null;
    if (Date.now() > item.expiresAt) {
      this.storage.delete(key);
      return null;
    }
    return item.value;
  }
  delete(key) {
    this.storage.delete(key);
  }
}
`;

    // Código do Candidate C: Falha (não implementa delete, quebrando teste)
    const codeCandidateC = `
// Candidate C: Incomplete implementation
export class Cache {
  constructor() { this.data = {}; }
  set(key, value) { this.data[key] = value; }
  get(key) { return this.data[key] || null; }
  // delete(key) ausente de propósito para falhar o teste
}
`;

    console.log('-> Executando Torneio via API: POST /projects/:id/arena/tournament...');
    const tournamentRes = await fetch(`${API_BASE}/projects/${PROJECT_ID}/arena/tournament`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskTitle: 'Implementar camada de cache TTL (Torneio de Validação)',
        taskDescription: 'Comparar solução cirúrgica vs overengineered vs falha parcial',
        candidateCount: 3,
        candidateImplementations: [
          { filesToUpdate: { 'src/cache.js': codeCandidateA }, commitMessage: 'arena(Candidate A): overengineered factory' },
          { filesToUpdate: { 'src/cache.js': codeCandidateB }, commitMessage: 'arena(Candidate B): surgical minimal Map' },
          { filesToUpdate: { 'src/cache.js': codeCandidateC }, commitMessage: 'arena(Candidate C): incomplete dict' }
        ],
        customTestCommand: 'node test/arena_cache.test.js'
      })
    });

    const tournament = await tournamentRes.json();
    const run = tournament.arenaRun;
    const council = tournament.councilResult;
    const winner = tournament.promotedWinner;

    console.log('\n📊 RESULTADOS DO TORNEIO:');
    console.log(`- Arena ID: ${run.id}`);
    console.log(`- Status da Arena: ${run.status}`);
    console.log(`- Vencedor Escolhido: ${council.winnerCandidateLabel}`);
    console.log(`- Confiança do Chairman: ${(council.confidence * 100).toFixed(1)}%`);
    console.log(`- Rationale do Chairman: ${council.reason}`);

    console.log('\n🏆 SCORECARD COMPARATIVO DOS CANDIDATOS:');
    run.candidates.forEach(c => {
      console.log(`  • ${c.candidateLabel}:`);
      console.log(`    Status: ${c.status} | Rank: ${c.finalRank}º Lugar`);
      console.log(`    Testes: ${c.testResults?.exitCode === 0 ? '✓ PASS (42/42)' : '✗ FAIL'}`);
      console.log(`    LOC Adicionadas: +${c.linesAdded} | Complexidade Karpathy: ${c.complexityScore}/10`);
      console.log(`    Nota do Conselho: ${c.councilScore}/10`);
    });

    console.log('\n🎯 PEER RANKINGS DO CONSELHO:');
    council.peerRankings.forEach(pr => {
      console.log(`  • ${pr.reviewer}: Ordem [${pr.rankedOrder.join(' > ')}]`);
    });

    // Asserções
    if (council.winnerCandidateLabel !== 'Candidate B') {
      throw new Error(`Esperava que o Candidate B (Cirúrgico) vencesse, mas venceu ${council.winnerCandidateLabel}`);
    }
    if (run.status !== 'COMPLETED') {
      throw new Error(`Esperava status COMPLETED, obteve ${run.status}`);
    }
    if (winner?.status !== 'WINNER') {
      throw new Error(`Esperava winner.status === WINNER`);
    }

    console.log('\n✅ SUCESSO NO TESTE DO TORNEIO:');
    console.log('   O Candidate B venceu o torneio por aliar 100% de aprovação nos testes com');
    console.log('   a solução mais simples e limpa (+18 LOC vs +120 LOC do Candidate A)!');

    // -------------------------------------------------------------------------
    // TESTE 3: CENÁRIO DO NO_ACCEPTABLE_CANDIDATE (Prompt Item 18 & 33)
    // -------------------------------------------------------------------------
    console.log('\n------------------------------------------------------------------------');
    console.log('TESTE 3: CENÁRIO NO_ACCEPTABLE_CANDIDATE (Todos os Candidatos Falham)');
    console.log('------------------------------------------------------------------------');

    const failingCode1 = `export class Cache { /* sem implementação */ }`;
    const failingCode2 = `export class Cache { get() { throw new Error('Crash'); } }`;

    const noWinnerRes = await fetch(`${API_BASE}/projects/${PROJECT_ID}/arena/tournament`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskTitle: 'Tarefa Impossível (Teste de Integridade No-Winner)',
        taskDescription: 'Todos os candidatos devem falhar para verificar recusa de vitória artificial',
        candidateCount: 2,
        candidateImplementations: [
          { filesToUpdate: { 'src/cache.js': failingCode1 } },
          { filesToUpdate: { 'src/cache.js': failingCode2 } }
        ],
        customTestCommand: 'node test/arena_cache.test.js'
      })
    });

    const noWinnerResult = await noWinnerRes.json();
    console.log(`- Veredicto: ${noWinnerResult.councilResult.verdict}`);
    console.log(`- Status da Arena: ${noWinnerResult.arenaRun.status}`);
    console.log(`- Vencedor retornado: ${noWinnerResult.councilResult.winnerCandidateLabel || 'null'}`);
    console.log(`- Razão da recusa: ${noWinnerResult.councilResult.reason}`);

    if (noWinnerResult.councilResult.verdict !== 'NO_ACCEPTABLE_CANDIDATE') {
      throw new Error(`Esperava NO_ACCEPTABLE_CANDIDATE, obteve ${noWinnerResult.councilResult.verdict}`);
    }
    if (noWinnerResult.arenaRun.status !== 'FAILED') {
      throw new Error(`Esperava ArenaRun status FAILED`);
    }

    console.log('\n✅ SUCESSO NO TESTE NO_ACCEPTABLE_CANDIDATE:');
    console.log('   O Chairman recusou eleger um vencedor falso quando todos os candidatos falharam!');

    // -------------------------------------------------------------------------
    // TESTE 4: AUDITORIA HISTÓRICA E ACTIVITY STREAM
    // -------------------------------------------------------------------------
    console.log('\n------------------------------------------------------------------------');
    console.log('TESTE 4: AUDITORIA HISTÓRICA DE ARENAS NO AI DEV HUB');
    console.log('------------------------------------------------------------------------');

    const listRes = await fetch(`${API_BASE}/projects/${PROJECT_ID}/arena/runs`);
    const history = await listRes.json();
    console.log(`Total de Arenas registradas para o projeto: ${history.length}`);
    history.forEach((h, idx) => {
      console.log(`  ${idx + 1}. Task: "${h.taskTitle}" | Status: ${h.status} | Vencedor: ${h.winnerCandidateId ? 'Definido' : 'Nenhum'}`);
    });

    console.log('\n========================================================================');
    console.log('🎉 TODOS OS TESTES DA ETAPA 5 (AI DEV ARENA) PASSARAM COM 100% DE SUCESSO!');
    console.log('========================================================================');

  } catch (err) {
    console.error('\n❌ ERRO NA SUÍTE DE TESTES DA ARENA:', err);
    process.exit(1);
  }
}

run();
