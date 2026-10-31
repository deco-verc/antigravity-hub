import test, { describe, it } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import express from 'express';
import { apiRouter } from '../src/routes.js';
import {
  db,
  resolveProjectCapabilities,
  resolveProjectProfileMode,
  formatCapabilitiesProfileBlock,
  DEFAULT_CAPABILITIES_LOCAL_PERSONAL,
  DEFAULT_CAPABILITIES_COMMERCIAL_SAAS,
  ProjectCapabilities,
  ProjectProfileMode
} from '../src/db.js';
import { DocSimpService } from '../src/docSimpService.js';
import { ReaSaaSMasterService } from '../src/reaSaaSMasterService.js';
import { PromptArchitectureService } from '../src/promptArchitectureService.js';
import { HierarchicalOrchestrationService } from '../src/hierarchicalOrchestrationService.js';

describe('Project Profile and Modular Capabilities Architecture Suite', () => {
  let server: import('node:http').Server;
  let baseUrl: string;
  const tempDirs: string[] = [];

  test.before(async () => {
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
      } catch {}
    }
  });

  it('1. resolveProjectCapabilities & resolveProjectProfileMode: Respeita presets e defaults seguros', () => {
    // Caso padrão nulo / indefinido
    const defaultCaps = resolveProjectCapabilities(undefined);
    assert.deepStrictEqual(defaultCaps, DEFAULT_CAPABILITIES_LOCAL_PERSONAL);
    const defaultMode = resolveProjectProfileMode(undefined);
    assert.strictEqual(defaultMode, 'local_personal');

    // Projeto explícito local_personal
    const localProj = {
      project_profile: 'local_personal' as ProjectProfileMode,
      capabilities_json: JSON.stringify({ database: true, auth: false, payments: false, advancedSaas: false, demoSeed: false })
    };
    assert.deepStrictEqual(resolveProjectCapabilities(localProj), DEFAULT_CAPABILITIES_LOCAL_PERSONAL);
    assert.strictEqual(resolveProjectProfileMode(localProj), 'local_personal');

    // Projeto explícito commercial_saas
    const saasProj = {
      project_profile: 'commercial_saas' as ProjectProfileMode,
      capabilities_json: JSON.stringify(DEFAULT_CAPABILITIES_COMMERCIAL_SAAS)
    };
    assert.deepStrictEqual(resolveProjectCapabilities(saasProj), DEFAULT_CAPABILITIES_COMMERCIAL_SAAS);
    assert.strictEqual(resolveProjectProfileMode(saasProj), 'commercial_saas');

    // Projeto custom
    const customCaps: ProjectCapabilities = {
      database: false,
      auth: true,
      payments: false,
      advancedSaas: false,
      demoSeed: false
    };
    const customProj = {
      project_profile: 'custom' as ProjectProfileMode,
      capabilities_json: JSON.stringify(customCaps)
    };
    assert.deepStrictEqual(resolveProjectCapabilities(customProj), customCaps);
    assert.strictEqual(resolveProjectProfileMode(customProj), 'custom');

    // Inferência por briefing legado (apenas quando não há projeto cadastrado)
    const inferredSaas = resolveProjectCapabilities(undefined, 'Quero um sistema SaaS com checkout PIX e login');
    assert.strictEqual(inferredSaas.payments, true);
    assert.strictEqual(inferredSaas.auth, true);

    const inferredPersonal = resolveProjectCapabilities(undefined, 'Um script minerador de dados local');
    assert.strictEqual(inferredPersonal.payments, false);
    assert.strictEqual(inferredPersonal.auth, false);
  });

  it('2. formatCapabilitiesProfileBlock: Gera diretivas arquiteturais explícitas de PROIBIÇÃO e PERMISSÃO', () => {
    const personalBlock = formatCapabilitiesProfileBlock(DEFAULT_CAPABILITIES_LOCAL_PERSONAL, 'local_personal');
    assert.ok(personalBlock.includes('USO PESSOAL / LOCAL'));
    assert.ok(personalBlock.includes('PROIBIDO criar tela de login, cadastro, senha, Supabase Auth ou Turnstile'));
    assert.ok(personalBlock.includes('PROIBIDO criar planos de assinatura, checkout PIX, PushinPay'));
    assert.ok(personalBlock.includes('PROIBIDO criar telas de gestão de equipe, API keys'));
    assert.ok(personalBlock.includes('PROIBIDO inventar registros fictícios/mocks'));

    const saasBlock = formatCapabilitiesProfileBlock(DEFAULT_CAPABILITIES_COMMERCIAL_SAAS, 'commercial_saas');
    assert.ok(saasBlock.includes('SAAS COMERCIAL'));
    assert.ok(saasBlock.includes('SIM — implementar autenticação'));
    assert.ok(saasBlock.includes('SIM — implementar cobrança/PIX'));
    assert.ok(saasBlock.includes('SIM — popular exemplos no boot'));
  });

  it('3. DocSimpService: Respeita estritamente a Regra de Ouro (sem pushinpay/supabase sem capacidade ou pedido explícito)', () => {
    // Prompt genérico com "painel e tabela"
    const genericPrompt = 'Criar um painel e tabela para gerenciar meus contatos locais';

    // Para local_personal
    const personalDocs = DocSimpService.matchDocs(genericPrompt, undefined, DEFAULT_CAPABILITIES_LOCAL_PERSONAL, 'local_personal');
    const personalIds = personalDocs.map(d => d.id);
    assert.ok(!personalIds.includes('pushinpay'), 'Não deve injetar pushinpay em local_personal');
    assert.ok(!personalIds.includes('supabase'), 'Não deve injetar supabase em local_personal');
    assert.ok(!personalIds.includes('turnstile'), 'Não deve injetar turnstile em local_personal');
    assert.ok(!personalIds.includes('saas_standard'), 'Não deve injetar saas_standard em local_personal');

    // Para commercial_saas com briefing pedindo saas
    const saasPrompt = 'Criar uma plataforma SaaS para comercializar relatórios';
    const saasDocs = DocSimpService.matchDocs(saasPrompt, undefined, DEFAULT_CAPABILITIES_COMMERCIAL_SAAS, 'commercial_saas');
    const saasIds = saasDocs.map(d => d.id);
    assert.ok(saasIds.includes('saas_standard'), 'Deve injetar saas_standard para commercial_saas');

    // Se o usuário pedir expressamente "pushinpay", deve respeitar a intenção explícita
    const explicitPixDocs = DocSimpService.matchDocs('Integrar com pushinpay para receber pagamentos', undefined, DEFAULT_CAPABILITIES_LOCAL_PERSONAL, 'local_personal');
    assert.ok(explicitPixDocs.some(d => d.id === 'pushinpay'), 'Deve incluir pushinpay se mencionado explicitamente no prompt');
  });

  it('4. ReaSaaSMasterService: Filtra pilares e microtarefas com base no perfil e capacidades', () => {
    // Em local_personal, constrói diretriz e omite pilares comerciais
    const personalDirective = ReaSaaSMasterService.buildSaaSMasterArchitectureDirective(
      'Ferramenta interna de mineração de leads',
      undefined,
      DEFAULT_CAPABILITIES_LOCAL_PERSONAL,
      'local_personal'
    );
    assert.ok(!personalDirective.includes('BILLING CENTER'), 'Não deve incluir Billing Center em local_personal');
    assert.ok(!personalDirective.includes('DEVELOPER HUB'), 'Não deve incluir Developer Hub em local_personal');
    assert.ok(!personalDirective.includes('30 a 50 registros realistas'), 'Não deve exigir fake seed em local_personal');

    // Microtarefas de UI geradas
    const personalMicrotasks = ReaSaaSMasterService.getRequiredSaaSMasterMicrotasks('MeuApp', DEFAULT_CAPABILITIES_LOCAL_PERSONAL);
    const personalCodes = personalMicrotasks.map(m => m.code);
    assert.ok(!personalCodes.includes('UI-7'), 'UI-7 (Billing e PIX) deve ser omitida se payments: false');
    assert.ok(!personalCodes.includes('UI-8'), 'UI-8 (Developer Hub) deve ser omitida se advancedSaas: false');
    assert.ok(!personalCodes.includes('UI-9'), 'UI-9 (Webhooks Playground) deve ser omitida se advancedSaas: false');

    // Em commercial_saas, todos os pilares e microtarefas devem estar presentes
    const saasDirective = ReaSaaSMasterService.buildSaaSMasterArchitectureDirective(
      'Plataforma SaaS',
      undefined,
      DEFAULT_CAPABILITIES_COMMERCIAL_SAAS,
      'commercial_saas'
    );
    assert.ok(saasDirective.includes('BILLING CENTER'), 'Deve incluir Billing Center em commercial_saas');

    const saasMicrotasks = ReaSaaSMasterService.getRequiredSaaSMasterMicrotasks('SaaSApp', DEFAULT_CAPABILITIES_COMMERCIAL_SAAS);
    const saasCodes = saasMicrotasks.map(m => m.code);
    assert.ok(saasCodes.includes('UI-7'), 'UI-7 deve estar presente em commercial_saas');
    assert.ok(saasCodes.includes('UI-8'), 'UI-8 deve estar presente em commercial_saas');
    assert.ok(saasCodes.includes('UI-9'), 'UI-9 deve estar presente em commercial_saas');
  });

  it('5. PromptArchitectureService: Injeta perfil de capacidades no topo da Camada C nos prompts do Supervisor e Worker', () => {
    const supervisor = PromptArchitectureService.buildSupervisorPrompt({
      mode: 'INITIAL_PLAN',
      projectName: 'Minha Ferramenta Pessoal',
      projectPath: '/tmp/test-proj',
      projectObjective: 'Dashboard local de despesas',
      briefing: 'Criar dashboard local sem login',
      capabilities: DEFAULT_CAPABILITIES_LOCAL_PERSONAL,
      projectProfile: 'local_personal'
    });

    assert.ok(
      supervisor.prompt.includes('=== PERFIL ARQUITETURAL ESCOLHIDO PELO USUÁRIO ==='),
      'Prompt do Supervisor deve conter o bloco de perfil arquitetural'
    );
    assert.ok(
      supervisor.prompt.includes('PROIBIDO criar planos de assinatura, checkout PIX'),
      'Prompt do Supervisor deve proibir planos/PIX para local_personal'
    );

    const worker = PromptArchitectureService.buildWorkerPrompt({
      projectName: 'Minha Ferramenta Pessoal',
      projectPath: '/tmp/test-proj',
      task: {
        id: 't-1',
        title: 'Implementar interface local',
        description: 'Construir dashboard',
        criteria: ['Renderizar tabela de dados']
      },
      capabilities: DEFAULT_CAPABILITIES_LOCAL_PERSONAL,
      projectProfile: 'local_personal'
    });

    assert.ok(
      worker.prompt.includes('=== PERFIL ARQUITETURAL ESCOLHIDO PELO USUÁRIO ==='),
      'Prompt do Worker deve conter o bloco de perfil arquitetural'
    );
  });

  it('6. HierarchicalOrchestrationService: Plano multi-pass contingency não gera tarefas de billing/RBAC em local_personal', () => {
    const planned = HierarchicalOrchestrationService.generateMultiPassPlannedTasks({
      projectName: 'Minerador Local',
      projectPath: '/tmp/minerador-local',
      briefing: 'Ferramenta CLI e visual para minerar dados da web',
      capabilities: DEFAULT_CAPABILITIES_LOCAL_PERSONAL,
      projectProfile: 'local_personal'
    });

    assert.ok(planned.length > 0, 'Deve gerar plano de tarefas');

    // Nenhuma tarefa de billing ou PIX
    const billingTasks = planned.filter(t => /billing|checkout-pix|pushinpay|faturas|planos/i.test(t.title + t.description));
    assert.strictEqual(billingTasks.length, 0, `Não deve conter tarefas de billing em local_personal (encontrou: ${billingTasks.length})`);

    // Nenhuma tarefa de RBAC de equipe / Developer Hub
    const rbacTasks = planned.filter(t => /developer hub|webhooks playground|gestão de equipe|rbac/i.test(t.title + t.description));
    assert.strictEqual(rbacTasks.length, 0, `Não deve conter tarefas de RBAC em local_personal (encontrou: ${rbacTasks.length})`);

    // GT-11 não deve existir em local_personal
    const gt11Tasks = planned.filter(t => t.milestone === 'GT-11' || t.majorTaskCode === 'GT-11');
    assert.strictEqual(gt11Tasks.length, 0, 'GT-11 não deve ser incluída quando advancedSaas: false');
  });

  it('7. Rotas REST: POST /api/projects, GET /api/projects/:id e PUT /api/projects/:id persistem e atualizam capacidades', async () => {
    const projDir = path.join(os.tmpdir(), `decohub-test-caps-${Date.now()}`);
    tempDirs.push(projDir);

    // 1. Criar projeto como local_personal
    const postRes = await fetch(`${baseUrl}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Projeto Pessoal de Teste',
        folderPath: projDir,
        objective: 'Testar persistência de capacidades',
        initGit: true,
        projectProfile: 'local_personal',
        capabilities: DEFAULT_CAPABILITIES_LOCAL_PERSONAL
      })
    });

    assert.strictEqual(postRes.status, 201);
    const created: any = await postRes.json();
    assert.ok(created.id);
    assert.strictEqual(created.project_profile, 'local_personal');
    assert.deepStrictEqual(created.capabilities, DEFAULT_CAPABILITIES_LOCAL_PERSONAL);

    // 2. GET /api/projects/:id
    const getRes = await fetch(`${baseUrl}/projects/${created.id}`);
    assert.strictEqual(getRes.status, 200);
    const fetched: any = await getRes.json();
    assert.strictEqual(fetched.project_profile, 'local_personal');
    assert.deepStrictEqual(fetched.capabilities, DEFAULT_CAPABILITIES_LOCAL_PERSONAL);

    // 3. Atualizar para custom via PUT /api/projects/:id
    const updatedCaps: ProjectCapabilities = {
      database: true,
      auth: true,
      payments: false,
      advancedSaas: false,
      demoSeed: false
    };

    const putRes = await fetch(`${baseUrl}/projects/${created.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectProfile: 'custom',
        capabilities: updatedCaps
      })
    });

    assert.strictEqual(putRes.status, 200);
    const updated: any = await putRes.json();
    assert.strictEqual(updated.project_profile, 'custom');
    assert.deepStrictEqual(updated.capabilities, updatedCaps);

    // 4. Verificar se persiste após novo GET
    const getUpdatedRes = await fetch(`${baseUrl}/projects/${created.id}`);
    const fetchedUpdated: any = await getUpdatedRes.json();
    assert.strictEqual(fetchedUpdated.project_profile, 'custom');
    assert.strictEqual(fetchedUpdated.capabilities.auth, true);
    assert.strictEqual(fetchedUpdated.capabilities.payments, false);
  });
});
