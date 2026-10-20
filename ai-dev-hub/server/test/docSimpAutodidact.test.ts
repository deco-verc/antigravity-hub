// server/test/docSimpAutodidact.test.ts
// Testes de Homologação do Motor Autodidata DOCSIMP, Normalização de Requisitos (REQ-01 -> REQ-1)
// e Reconciliação Estrita de Progresso 100%

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { db } from '../src/db.js';
import { DocSimpService, DocSimpCatalog, DocSimpEntry } from '../src/docSimpService.js';
import { HierarchicalOrchestrationService, normalizeRequirementCode } from '../src/hierarchicalOrchestrationService.js';
import { AutonomousManager } from '../src/autonomousManager.js';
import { PromptArchitectureService } from '../src/promptArchitectureService.js';

test('1. Normalização Canônica de Códigos de Requisitos (REQ-01 === REQ-1)', () => {
  assert.equal(normalizeRequirementCode('REQ-01'), 'REQ-1');
  assert.equal(normalizeRequirementCode('REQ-02'), 'REQ-2');
  assert.equal(normalizeRequirementCode('REQ-007'), 'REQ-7');
  assert.equal(normalizeRequirementCode('req-09'), 'REQ-9');
  assert.equal(normalizeRequirementCode('REQ_03'), 'REQ-3');
  assert.equal(normalizeRequirementCode('REQ-10'), 'REQ-10');
  assert.equal(normalizeRequirementCode('REQ-99'), 'REQ-99');
  assert.equal(normalizeRequirementCode('REQ-1'), 'REQ-1');
  assert.equal(normalizeRequirementCode('CUSTOM-01'), 'CUSTOM-1');
  assert.equal(normalizeRequirementCode(''), '');
});

test('2. Cache-First Lookup e Identificação de Integrações no DOCSIMP', () => {
  const sampleCatalog: DocSimpCatalog = {
    version: '1.0.0',
    updated_at: new Date().toISOString(),
    documents: [
      {
        id: 'pushinpay',
        name: 'PushinPay PIX API',
        aliases: ['pushinpay', 'pix', 'gateway pix'],
        summary: 'Guia de integração da API Pix PushinPay com Webhooks.',
        file_path: 'pushinpay_docs_knowledge_ready.md'
      },
      {
        id: 'supabase',
        name: 'Supabase Auth & Database',
        aliases: ['supabase', 'auth', 'postgresql', 'rls'],
        summary: 'Guia de integração Supabase com Auth, RLS e client.',
        file_path: 'supabase_knowledge_ready.md'
      },
      {
        id: 'cloudflare',
        name: 'Cloudflare Turnstile & R2',
        aliases: ['cloudflare', 'turnstile', 'r2'],
        summary: 'Guia Cloudflare para validação de tokens Turnstile e R2.',
        file_path: 'cloudflare_knowledge_ready.md'
      },
      {
        id: 'upstash',
        name: 'Upstash Redis',
        aliases: ['upstash', 'redis', 'cache'],
        summary: 'Guia de integração Upstash Redis REST API.',
        file_path: 'upstash_knowledge_ready.md'
      },
      {
        id: 'saas_standard',
        name: 'SaaS Plug-and-Play Standard',
        aliases: ['saas', 'plug_and_play', 'mock', 'fallback'],
        summary: 'Padrão mandatório: tolerância a falhas sem quebrar boot.',
        file_path: 'saas_plug_and_play_standard.md'
      }
    ]
  };

  // Briefing com Pix PushinPay
  const briefingPix = 'Desenvolver sistema de assinaturas com recebimento via Pix PushinPay e webhook de confirmação.';
  const matchedPix = DocSimpService.matchDocs(briefingPix, sampleCatalog);
  assert.ok(matchedPix.some(d => d.id === 'pushinpay'), 'Deve identificar PushinPay');
  assert.ok(matchedPix.some(d => d.id === 'saas_standard'), 'Deve incluir saas_standard');

  // Briefing com Supabase e Redis
  const briefingSupabase = 'Aplicativo SaaS com banco de dados PostgreSQL no Supabase e cache Redis.';
  const matchedSupa = DocSimpService.matchDocs(briefingSupabase, sampleCatalog);
  assert.ok(matchedSupa.some(d => d.id === 'supabase'), 'Deve identificar Supabase');
  assert.ok(matchedSupa.some(d => d.id === 'upstash'), 'Deve identificar Upstash Redis');
  assert.ok(matchedSupa.some(d => d.id === 'saas_standard'), 'Deve incluir saas_standard');
});

test('3. Limite de Tamanho do Bloco de Contexto (< 1.200 caracteres)', () => {
  const docs: DocSimpEntry[] = [
    {
      id: 'pushinpay',
      name: 'PushinPay PIX API',
      aliases: ['pix'],
      summary: 'Guia de integração da API Pix PushinPay com Webhooks, headers e fallback seguro para simulação de QR Code Pix.',
      file_path: 'pushinpay_docs_knowledge_ready.md'
    },
    {
      id: 'supabase',
      name: 'Supabase Auth & Database',
      aliases: ['supabase'],
      summary: 'Guia de integração Supabase com Auth, RLS e client @supabase/supabase-js, com fallback automático para SQLite.',
      file_path: 'supabase_knowledge_ready.md'
    },
    {
      id: 'cloudflare',
      name: 'Cloudflare Turnstile & R2 Storage',
      aliases: ['cloudflare'],
      summary: 'Guia Cloudflare para validação de tokens Turnstile e R2 storage com bypass de teste e fallback local.',
      file_path: 'cloudflare_knowledge_ready.md'
    },
    {
      id: 'upstash',
      name: 'Upstash Redis Serverless',
      aliases: ['upstash'],
      summary: 'Guia de integração Upstash Redis REST API com suporte a caching e rate limiting, com fallback para Map TTL.',
      file_path: 'upstash_knowledge_ready.md'
    },
    {
      id: 'saas_standard',
      name: 'SaaS Plug-and-Play Architecture Standard',
      aliases: ['saas'],
      summary: 'Padrão arquitetural mandatório para todas as aplicações: nunca falhar boot por chaves ausentes.',
      file_path: 'saas_plug_and_play_standard.md'
    }
  ];

  const block = DocSimpService.buildDocSimpContextBlock(docs);
  assert.ok(block.length > 0, 'Bloco deve ser gerado');
  assert.ok(block.length < 1200, `Bloco deve ter menos de 1.200 caracteres (atual: ${block.length})`);
  assert.ok(block.includes('DIRETRIZES TÉCNICAS DOCSIMP'));
  assert.ok(block.includes('REGRA INVIOLÁVEL DE AUTONOMIA'));
  assert.ok(block.includes('/api/system/integrations'));
  assert.ok(block.includes('.env.example'));

  // Test prompt injection in Worker prompt
  const { prompt } = PromptArchitectureService.buildWorkerPrompt({
    mode: 'IMPLEMENT',
    projectId: 'test-p1',
    projectName: 'Test Project',
    projectPath: 'C:\\test',
    projectObjective: 'Test Objective',
    taskId: 't-1',
    taskTitle: 'Implement Payment Gateway',
    acceptanceCriteria: ['Validar QR Code'],
    docSimpContextBlock: block
  });

  assert.ok(prompt.includes('DIRETRIZES TÉCNICAS DOCSIMP'), 'Worker prompt deve conter o bloco DOCSIMP');
  assert.ok(prompt.includes('REGRA INVIOLÁVEL DE AUTONOMIA'), 'Worker prompt deve conter regras de autonomia');
});

test('4. Injeção de Arquivos de Conhecimento no Workspace do Projeto', () => {
  const tmpProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deco-docsimp-proj-'));
  const tmpDocSimpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deco-docsimp-lib-'));

  try {
    const dummyDocPath = path.join(tmpDocSimpDir, 'pushinpay_knowledge_ready.md');
    fs.writeFileSync(dummyDocPath, '# PushinPay Documentation\nConteúdo completo da documentação.', 'utf-8');

    const docs: DocSimpEntry[] = [
      {
        id: 'pushinpay',
        name: 'PushinPay PIX API',
        aliases: ['pix'],
        summary: 'Guia de integração PushinPay.',
        file_path: 'pushinpay_knowledge_ready.md'
      }
    ];

    const copied = DocSimpService.copyDocsToProject(tmpProjectDir, docs, tmpDocSimpDir);
    assert.equal(copied.length, 1);
    assert.ok(fs.existsSync(copied[0]));
    assert.equal(path.basename(copied[0]), 'pushinpay_knowledge_ready.md');

    const content = fs.readFileSync(copied[0], 'utf-8');
    assert.ok(content.includes('# PushinPay Documentation'));
  } finally {
    fs.rmSync(tmpProjectDir, { recursive: true, force: true });
    fs.rmSync(tmpDocSimpDir, { recursive: true, force: true });
  }
});

test('5. Extração de URLs de Documentação no Briefing', () => {
  const briefingWithUrls = 'Por favor integrar a API documentada em https://docs.minhaempresa.com.br/v2/ e também ver https://api.pagamentos.io/webhook.';
  const urls = DocSimpService.extractUrls(briefingWithUrls);
  assert.equal(urls.length, 2);
  assert.ok(urls.includes('https://docs.minhaempresa.com.br/v2/'));
  assert.ok(urls.includes('https://api.pagamentos.io/webhook'));
});

test('6. Reconciliação Estrita de Progresso 100% e Requisitos Normalizados', () => {
  const projectId = 'proj-test-100pct-' + crypto.randomBytes(4).toString('hex');
  const runId = 'run-test-100pct-' + crypto.randomBytes(4).toString('hex');
  const now = new Date().toISOString();

  // Create project
  db.prepare(`
    INSERT INTO projects (id, name, path, objective, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(projectId, 'Project 100% Test', 'C:\\test', 'Test 100%', now, now);

  // Create run
  db.prepare(`
    INSERT INTO autonomous_runs (id, project_id, name, objective, briefing, status, start_time, created_at, updated_at)
    VALUES (?, ?, 'Run Test 100', 'Test Objective', 'Test Briefing', 'running', ?, ?, ?)
  `).run(runId, projectId, now, now, now);

  // Create requirements with codes REQ-1 and REQ-2
  const req1Id = 'req-' + crypto.randomBytes(4).toString('hex');
  const req2Id = 'req-' + crypto.randomBytes(4).toString('hex');
  db.prepare(`
    INSERT INTO project_requirements (id, project_id, run_id, code, title, description, mandatory, status, linked_task_ids_json, created_at, updated_at)
    VALUES (?, ?, ?, 'REQ-1', 'Requisito 1', 'Desc 1', 1, 'pending', '[]', ?, ?)
  `).run(req1Id, projectId, runId, now, now);
  db.prepare(`
    INSERT INTO project_requirements (id, project_id, run_id, code, title, description, mandatory, status, linked_task_ids_json, created_at, updated_at)
    VALUES (?, ?, ?, 'REQ-2', 'Requisito 2', 'Desc 2', 1, 'pending', '[]', ?, ?)
  `).run(req2Id, projectId, runId, now, now);

  // Create tasks that reference REQ-01 and REQ-02 (using leading zeroes)
  const task1Id = 'task-1-' + crypto.randomBytes(4).toString('hex');
  const task2Id = 'task-2-' + crypto.randomBytes(4).toString('hex');
  db.prepare(`
    INSERT INTO autonomous_tasks (id, run_id, title, status, requirement_ids_json, order_index, created_at, updated_at)
    VALUES (?, ?, 'Task 1', 'completed', ?, 1, ?, ?)
  `).run(task1Id, runId, JSON.stringify(['REQ-01']), now, now);
  db.prepare(`
    INSERT INTO autonomous_tasks (id, run_id, title, status, requirement_ids_json, order_index, created_at, updated_at)
    VALUES (?, ?, 'Task 2', 'completed', ?, 2, ?, ?)
  `).run(task2Id, runId, JSON.stringify(['REQ-02']), now, now);

  // Update run to completed
  db.prepare(`UPDATE autonomous_runs SET status = 'completed' WHERE id = ?`).run(runId);

  // Run synchronization
  HierarchicalOrchestrationService.syncRequirementTraceability(runId);

  // Verify requirements are now verified
  const rows = db.prepare(`SELECT code, status FROM project_requirements WHERE run_id = ?`).all(runId) as Array<{ code: string; status: string }>;
  for (const r of rows) {
    assert.equal(r.status, 'verified', `Requisito ${r.code} deve estar verified`);
  }

  // Verify getRun returns progressPct === 100
  const runData = AutonomousManager.getRun(runId);
  assert.equal(runData.progressPct, 100, `Progresso do run deve ser 100% quando todas as tarefas estão completas (atual: ${runData.progressPct}%)`);
});
