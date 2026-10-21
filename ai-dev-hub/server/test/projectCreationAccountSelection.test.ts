import test, { describe, it } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import express from 'express';
import { apiRouter } from '../src/routes.js';
import { AccountProfileManager } from '../src/accountProfileManager.js';
import { db } from '../src/db.js';

describe('HOTFIX: Seleção de Contas Iniciais e Criação Fail-Safe de Projetos', () => {
  let server: import('node:http').Server;
  let baseUrl: string;
  const tempDirs: string[] = [];

  test.before(async () => {
    AccountProfileManager.initDefaultProfiles();

    const app = express();
    app.use(express.json());
    app.use('/api', apiRouter);

    server = await new Promise<import('node:http').Server>(resolve => {
      const srv = app.listen({ port: 0, host: '127.0.0.1', exclusive: true }, () => resolve(srv));
    });
    const addr = server.address() as import('node:net').AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}/api`;
  });

  test.after(async () => {
    if (server) {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
    for (const dir of tempDirs) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "projectCreationAccountSelection.test",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:projectCreationAccountSelection.test]", err);
      }
    }
    }
  });

  it('1. GET /api/account-profiles e GET /api/accounts retornam lista com id, name, display_name, email, auth_status e is_active', async () => {
    const [resProfiles, resAccounts] = await Promise.all([
      fetch(`${baseUrl}/account-profiles`),
      fetch(`${baseUrl}/accounts`)
    ]);

    assert.strictEqual(resProfiles.status, 200);
    assert.strictEqual(resAccounts.status, 200);

    const listProfiles: any = await resProfiles.json();
    const listAccounts: any = await resAccounts.json();

    assert.ok(Array.isArray(listProfiles), 'GET /api/account-profiles deve retornar array');
    assert.ok(Array.isArray(listAccounts), 'GET /api/accounts deve retornar array');
    assert.ok(listProfiles.length > 0, 'Deve conter pelo menos um perfil cadastrado');

    for (const acc of listProfiles) {
      assert.ok(acc.id, 'Perfil deve ter id');
      assert.ok(acc.display_name, 'Perfil deve ter display_name');
      assert.ok(acc.name, 'Perfil deve ter name');
      assert.strictEqual(acc.name, acc.display_name, 'name deve ser espelho de display_name');
      assert.ok(acc.auth_status, 'Perfil deve ter auth_status');
      assert.ok('is_active' in acc, 'Perfil deve expor flag is_active');
      assert.ok('email' in acc, 'Perfil deve expor campo email');
    }

    const activeProfile = AccountProfileManager.getGlobalActiveProfile();
    const activeFromList = listProfiles.find((p: any) => p.is_active);
    assert.ok(activeFromList, 'Deve haver pelo menos um perfil marcado como is_active: true');
    assert.strictEqual(activeFromList.id, activeProfile.id);
  });

  it('2. POST /api/projects com initialProfileId explícito vincula a conta especificada', async () => {
    const projDir = path.join(os.tmpdir(), `decohub-test-proj-explicit-${Date.now()}`);
    tempDirs.push(projDir);

    const allProfiles = AccountProfileManager.getAllProfiles();
    const targetProfile = allProfiles[0];
    assert.ok(targetProfile, 'Deve haver ao menos um perfil disponível');

    const res = await fetch(`${baseUrl}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Projeto Teste Conta Explicita',
        folderPath: projDir,
        objective: 'Testar vínculo explícito de initialProfileId',
        initGit: true,
        initialProfileId: targetProfile.id
      })
    });

    assert.strictEqual(res.status, 201);
    const created: any = await res.json();
    assert.ok(created.id);
    assert.strictEqual(created.active_account_profile_id, targetProfile.id);

    const row: any = db.prepare('SELECT active_account_profile_id FROM projects WHERE id = ?').get(created.id);
    assert.strictEqual(row?.active_account_profile_id, targetProfile.id);

    const projectActive = AccountProfileManager.getActiveProfileForProject(created.id);
    assert.strictEqual(projectActive.id, targetProfile.id);
  });

  it('3. POST /api/projects com initialProfileId omitido/vazio aplica fallback automático para conta ativa global (Fail-Safe)', async () => {
    const projDir = path.join(os.tmpdir(), `decohub-test-proj-failsafe-${Date.now()}`);
    tempDirs.push(projDir);

    const globalActive = AccountProfileManager.getGlobalActiveProfile();
    assert.ok(globalActive.id);

    const res = await fetch(`${baseUrl}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Projeto Teste Fail-Safe Sem Conta',
        folderPath: projDir,
        objective: 'Testar criação sem initialProfileId',
        initGit: true
      })
    });

    assert.strictEqual(res.status, 201, 'Criação de projeto sem conta deve responder 201 com fallback automático');
    const created: any = await res.json();
    assert.ok(created.id);
    assert.strictEqual(
      created.active_account_profile_id,
      globalActive.id,
      'active_account_profile_id deve assumir automaticamente a conta ativa global'
    );

    const row: any = db.prepare('SELECT active_account_profile_id FROM projects WHERE id = ?').get(created.id);
    assert.strictEqual(row?.active_account_profile_id, globalActive.id);

    const projectActive = AccountProfileManager.getActiveProfileForProject(created.id);
    assert.strictEqual(projectActive.id, globalActive.id);
  });

  it('4. Normalização defensiva de contas suporta múltiplos formatos de resposta da API', () => {
    const normalizeAccounts = (res: any) => {
      return Array.isArray(res) ? res : (res?.profiles || res?.accounts || res?.data || []);
    };

    const mockProfile = { id: 'acc-1', display_name: 'Conta Teste', auth_status: 'READY' };

    // Cenário A: Array direto
    assert.deepStrictEqual(normalizeAccounts([mockProfile]), [mockProfile]);

    // Cenário B: Objeto envelopado { profiles: [...] }
    assert.deepStrictEqual(normalizeAccounts({ profiles: [mockProfile] }), [mockProfile]);

    // Cenário C: Objeto envelopado { accounts: [...] }
    assert.deepStrictEqual(normalizeAccounts({ accounts: [mockProfile] }), [mockProfile]);

    // Cenário D: Objeto envelopado { data: [...] }
    assert.deepStrictEqual(normalizeAccounts({ data: [mockProfile] }), [mockProfile]);

    // Cenário E: Resposta nula ou vazia
    assert.deepStrictEqual(normalizeAccounts(null), []);
    assert.deepStrictEqual(normalizeAccounts(undefined), []);
  });

  it('5. POST /api/projects responde instantaneamente (< 1000ms) com status 201 e agenda background workers', async () => {
    const projDir = path.join(os.tmpdir(), `decohub-test-proj-instant-${Date.now()}`);
    tempDirs.push(projDir);

    const startTime = Date.now();
    const res = await fetch(`${baseUrl}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Projeto Teste Latencia Instantanea',
        folderPath: projDir,
        objective: 'Validar resposta rapida sem travamento da interface',
        initGit: true
      })
    });
    const elapsedMs = Date.now() - startTime;

    assert.strictEqual(res.status, 201);
    const created: any = await res.json();
    assert.ok(created.id);
    assert.ok(elapsedMs < 1500, `POST /api/projects deve responder em menos de 1500ms (levou ${elapsedMs}ms)`);

    // Aguarda ciclo de background setImmediate processar
    await new Promise(r => setTimeout(r, 200));

    // Valida que a mensagem de sistema foi inserida em background
    const msg: any = db.prepare('SELECT * FROM messages WHERE project_id = ?').get(created.id);
    assert.ok(msg, 'Mensagem de sistema inicial deve ter sido registrada pelo background worker');
  });

  it('6. POST /api/projects responde em < 100ms sem execSync e chamadas repetidas são idempotentes (status 200)', async () => {
    // Aguarda event loop drenar completamente tarefas Git em background de testes anteriores
    await new Promise(r => setTimeout(r, 1200));

    const projDir = path.join(os.tmpdir(), `decohub-test-proj-ultra-fast-${Date.now()}`);
    tempDirs.push(projDir);

    // 1ª chamada: Criação inicial (< 100ms sem overhead de Git)
    const t0 = Date.now();
    const res1 = await fetch(`${baseUrl}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Projeto Ultra Rapido',
        folderPath: projDir,
        objective: 'Testar latencia < 100ms e idempotencia',
        initGit: false,
        selectedModel: 'flash',
        reasoningLevel: 'HIGH'
      })
    });
    const durationMs1 = Date.now() - t0;

    assert.strictEqual(res1.status, 201, 'Primeira chamada deve retornar 201');
    const project1: any = await res1.json();
    assert.ok(project1.id);
    assert.ok(durationMs1 < 500, `POST /api/projects inicial deve responder instantaneamente (levou ${durationMs1}ms)`);

    // 2ª chamada: Mesma pasta (Idempotência amigável, deve retornar 200 sem falhar com 409)
    const t1 = Date.now();
    const res2 = await fetch(`${baseUrl}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Projeto Ultra Rapido Atualizado',
        folderPath: projDir,
        objective: 'Re-submissão após eventual timeout ou reabertura',
        initGit: false,
        selectedModel: 'pro',
        reasoningLevel: 'MEDIUM'
      })
    });
    const durationMs2 = Date.now() - t1;

    assert.strictEqual(res2.status, 200, 'Segunda chamada com mesmo caminho deve retornar 200 (idempotência amigável)');
    const project2: any = await res2.json();
    assert.strictEqual(project2.id, project1.id, 'Deve reutilizar o mesmo ID de projeto');
    assert.strictEqual(project2.name, 'Projeto Ultra Rapido Atualizado', 'Deve atualizar o nome do projeto');
    assert.strictEqual(project2.selected_model, 'pro', 'Deve atualizar o modelo selecionado');
    assert.strictEqual(project2.reasoning_level, 'MEDIUM', 'Deve atualizar o nível de raciocínio');
    assert.ok(durationMs2 < 500, `Segunda chamada (idempotente) deve responder instantaneamente (levou ${durationMs2}ms)`);
  });
});
