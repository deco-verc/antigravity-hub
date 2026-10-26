import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { db, ensureDefensiveMigrations, safeAddColumn } from '../src/db.js';

test('HOTFIX: Migrações Defensivas de Schema SQLite (updated_at, created_at)', async (t) => {

  await t.test('1. Aplica migração em banco legado sem colunas de timestamp e previne "no such column"', () => {
    // Cria um banco em memória simulando schema legado do DecoHUB
    const legacyDb = new DatabaseSync(':memory:');

    // Tabela execution_reservations legada (SEM updated_at nem metadata_json)
    legacyDb.exec(`
      CREATE TABLE execution_reservations (
        scope TEXT PRIMARY KEY,
        token TEXT NOT NULL,
        owner_pid INTEGER NOT NULL,
        context_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
    `);

    // Tabela autonomous_runs legada (SEM updated_at)
    legacyDb.exec(`
      CREATE TABLE autonomous_runs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);

    // Tabela agent_turn_observations legada (SEM updated_at)
    legacyDb.exec(`
      CREATE TABLE agent_turn_observations (
        conversation_id TEXT PRIMARY KEY,
        task_id TEXT,
        phase TEXT NOT NULL,
        dispatched_at TEXT NOT NULL
      );
    `);

    // Verificar que antes da migração, a coluna updated_at NÃO existe em execution_reservations
    const beforeCols = legacyDb.prepare('PRAGMA table_info(execution_reservations)').all().map((c: any) => c.name);
    assert.ok(!beforeCols.includes('updated_at'), 'Antes da migração não deve ter updated_at');
    assert.ok(!beforeCols.includes('metadata_json'), 'Antes da migração não deve ter metadata_json');

    // Executar migração defensiva
    ensureDefensiveMigrations(legacyDb);

    // Verificar que após a migração, as colunas foram injetadas defensivamente
    const afterResCols = legacyDb.prepare('PRAGMA table_info(execution_reservations)').all().map((c: any) => c.name);
    assert.ok(afterResCols.includes('updated_at'), 'Deve conter updated_at após migração');
    assert.ok(afterResCols.includes('created_at'), 'Deve conter created_at após migração');
    assert.ok(afterResCols.includes('metadata_json'), 'Deve conter metadata_json após migração');

    const afterRunCols = legacyDb.prepare('PRAGMA table_info(autonomous_runs)').all().map((c: any) => c.name);
    assert.ok(afterRunCols.includes('updated_at'), 'autonomous_runs deve conter updated_at após migração');

    const afterObsCols = legacyDb.prepare('PRAGMA table_info(agent_turn_observations)').all().map((c: any) => c.name);
    assert.ok(afterObsCols.includes('updated_at'), 'agent_turn_observations deve conter updated_at após migração');

    // Testar queries do ExecutionCoordinator no banco migrado: NÃO deve lançar "no such column: updated_at"
    const nowIso = new Date().toISOString();
    assert.doesNotThrow(() => {
      legacyDb.prepare(`
        INSERT INTO execution_reservations (scope, token, owner_pid, context_json, created_at, updated_at)
        VALUES ('test-scope', 'token-123', 1234, '{}', ?, ?)
      `).run(nowIso, nowIso);
    }, 'Insert com updated_at deve funcionar');

    assert.doesNotThrow(() => {
      legacyDb.prepare(`
        UPDATE execution_reservations SET updated_at = ? WHERE scope = 'test-scope'
      `).run(nowIso);
    }, 'Update de updated_at deve funcionar');

    assert.doesNotThrow(() => {
      const res = legacyDb.prepare(`
        SELECT * FROM execution_reservations
        WHERE datetime(COALESCE(updated_at, created_at), '+5 minutes') < datetime('now')
      `).all();
      assert.ok(Array.isArray(res));
    }, 'Select filtrando por COALESCE(updated_at, created_at) deve funcionar');

    legacyDb.close();
  });

  await t.test('2. Idempotência: rodar a migração múltiplas vezes não corrompe nem lança erro', () => {
    const memoryDb = new DatabaseSync(':memory:');
    memoryDb.exec(`
      CREATE TABLE execution_reservations (
        scope TEXT PRIMARY KEY,
        token TEXT NOT NULL,
        owner_pid INTEGER NOT NULL,
        context_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
    `);

    // Inserir um registro prévio
    memoryDb.prepare(`
      INSERT INTO execution_reservations (scope, token, owner_pid, context_json, created_at)
      VALUES ('active-scope', 'token-prev', 999, '{"runId":"r1"}', '2026-10-18T10:00:00.000Z')
    `).run();

    // Rodar 3 vezes consecutivas
    assert.doesNotThrow(() => {
      ensureDefensiveMigrations(memoryDb);
      ensureDefensiveMigrations(memoryDb);
      ensureDefensiveMigrations(memoryDb);
    });

    // O registro prévio deve continuar íntegro
    const record: any = memoryDb.prepare('SELECT * FROM execution_reservations WHERE scope = ?').get('active-scope');
    assert.ok(record);
    assert.equal(record.token, 'token-prev');
    assert.equal(record.updated_at, null); // inicializado como null na adição da coluna

    // Query com COALESCE deve usar created_at quando updated_at é null
    const result: any = memoryDb.prepare(`
      SELECT COALESCE(updated_at, created_at) as effective_time FROM execution_reservations WHERE scope = ?
    `).get('active-scope');
    assert.equal(result.effective_time, '2026-10-18T10:00:00.000Z');

    memoryDb.close();
  });

  await t.test('3. Banco principal do servidor possui todas as colunas de timestamp defensivas ativas', () => {
    const resCols = db.prepare('PRAGMA table_info(execution_reservations)').all().map((c: any) => c.name);
    assert.ok(resCols.includes('updated_at'), 'execution_reservations no db principal deve ter updated_at');
    assert.ok(resCols.includes('created_at'), 'execution_reservations no db principal deve ter created_at');

    const runCols = db.prepare('PRAGMA table_info(autonomous_runs)').all().map((c: any) => c.name);
    assert.ok(runCols.includes('updated_at'), 'autonomous_runs no db principal deve ter updated_at');
    assert.ok(runCols.includes('created_at'), 'autonomous_runs no db principal deve ter created_at');
  });

  await t.test('4. safeAddColumn injeta colunas idempotentemente sem warning ou erro de duplicidade', () => {
    const memoryDb = new DatabaseSync(':memory:');
    memoryDb.exec(`
      CREATE TABLE sample_table (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL
      );
    `);

    // Inserção da primeira vez deve retornar true
    const added1 = safeAddColumn(memoryDb, 'sample_table', 'extra_col', 'TEXT');
    assert.equal(added1, true, 'safeAddColumn deve retornar true ao adicionar nova coluna');

    // Inserção da segunda vez deve retornar false e ser idempotente sem lançar erro
    const added2 = safeAddColumn(memoryDb, 'sample_table', 'extra_col', 'TEXT');
    assert.equal(added2, false, 'safeAddColumn deve retornar false ao detectar coluna existente');

    const cols = memoryDb.prepare('PRAGMA table_info(sample_table)').all().map((c: any) => c.name);
    assert.ok(cols.includes('extra_col'), 'Coluna extra_col deve existir na tabela');

    memoryDb.close();
  });

});
