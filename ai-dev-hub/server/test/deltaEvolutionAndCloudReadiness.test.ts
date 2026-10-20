// server/test/deltaEvolutionAndCloudReadiness.test.ts
// Testes automatizados para FASE 12: Delta Feature Mode, Smart Demo Seeding e Cloud Deploy Pack

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DeltaFeatureEngine } from '../src/deltaFeatureEngine.js';
import { PromptArchitectureService } from '../src/promptArchitectureService.js';
import { DesignSkillService } from '../src/designSkillService.js';
import { GeminiSupervisorProvider } from '../src/geminiSupervisorProvider.js';

describe('FASE 12: Delta Feature Mode, Smart Demo Seeding & Cloud Readiness', () => {
  const tempBase = path.join(os.tmpdir(), `decohub-fase12-test-${Date.now()}`);

  it('1. Detecção Automática de Projeto Existente (DELTA_EVOLUTION) vs Greenfield (INITIAL_PLAN)', () => {
    const greenfieldDir = path.join(tempBase, 'greenfield-app');
    fs.mkdirSync(greenfieldDir, { recursive: true });

    // 1.1. Diretório vazio / sem arquivos de código
    const emptyCheck = DeltaFeatureEngine.isExistingProject(greenfieldDir);
    assert.equal(emptyCheck.isExisting, false, 'Diretório vazio deve ser detectado como greenfield');

    // 1.2. Diretório estruturado com package.json, src/ e test/
    const structuredDir = path.join(tempBase, 'structured-app');
    fs.mkdirSync(path.join(structuredDir, 'src'), { recursive: true });
    fs.mkdirSync(path.join(structuredDir, 'test'), { recursive: true });

    fs.writeFileSync(path.join(structuredDir, 'package.json'), JSON.stringify({ name: 'test-app', version: '1.0.0' }));
    fs.writeFileSync(path.join(structuredDir, 'src', 'server.js'), 'export const PORT = 4000;');
    fs.writeFileSync(path.join(structuredDir, 'src', 'db.js'), 'CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY);');
    fs.writeFileSync(path.join(structuredDir, 'test', 'server.test.js'), 'console.log("test");');

    const structuredCheck = DeltaFeatureEngine.isExistingProject(structuredDir);
    assert.equal(structuredCheck.isExisting, true, 'Diretório com package.json e src/ deve ser detectado como projeto existente (DELTA_EVOLUTION)');
    assert.ok(structuredCheck.reason.includes('src/'), 'Razão deve citar arquivos em src/');
  });

  it('2. Scan Técnico do Inventário Real (scanProjectInventory)', () => {
    const projectDir = path.join(tempBase, 'inventory-app');
    const srcDir = path.join(projectDir, 'src');
    const pubDir = path.join(projectDir, 'public');
    const testDir = path.join(projectDir, 'test');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.mkdirSync(pubDir, { recursive: true });
    fs.mkdirSync(testDir, { recursive: true });

    fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({ name: 'inventory-test' }));
    fs.writeFileSync(path.join(srcDir, 'server.js'), `
      import { seedIfEmpty } from './db.js';
      const PORT = Number(process.env.PORT) || 4005;
      app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
      app.post('/api/items', (req, res) => res.json({ created: true }));
    `);
    fs.writeFileSync(path.join(srcDir, 'db.js'), `
      CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, name TEXT);
      CREATE TABLE IF NOT EXISTS logs (id TEXT PRIMARY KEY, message TEXT);
      export function seedIfEmpty() { return true; }
    `);
    fs.writeFileSync(path.join(pubDir, 'index.html'), '<!DOCTYPE html><html><body><main></main></body></html>');
    fs.writeFileSync(path.join(testDir, 'items.test.js'), 'import test from "node:test";');

    const inventory = DeltaFeatureEngine.scanProjectInventory(projectDir);

    assert.equal(inventory.isExisting, true);
    assert.equal(inventory.hasSeed, true, 'Deve detectar presença da rotina seedIfEmpty');
    assert.ok(inventory.tables.includes('items'), 'Deve detectar tabela items');
    assert.ok(inventory.tables.includes('logs'), 'Deve detectar tabela logs');
    assert.ok(inventory.endpoints.some(e => e.path === '/api/health'), 'Deve detectar endpoint /api/health');
    assert.ok(inventory.endpoints.some(e => e.path === '/api/items'), 'Deve detectar endpoint /api/items');
    assert.ok(inventory.ports.includes(4005), 'Deve identificar porta 4005');
    assert.ok(inventory.summary.includes('PROJETO EXISTENTE: SIM'), 'Resumo deve sintetizar inventário real');
  });

  it('3. Planejamento Cirúrgico Delta (2 a 5 tarefas aditivas sem destruição)', () => {
    const deltaDir = path.join(tempBase, 'delta-app');
    fs.mkdirSync(path.join(deltaDir, 'src'), { recursive: true });
    fs.mkdirSync(path.join(deltaDir, 'test'), { recursive: true });
    fs.writeFileSync(path.join(deltaDir, 'package.json'), JSON.stringify({ name: 'delta-app' }));
    fs.writeFileSync(path.join(deltaDir, 'src', 'db.js'), 'CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY);');
    fs.writeFileSync(path.join(deltaDir, 'test', 'users.test.js'), '// existing test');

    const tasks = DeltaFeatureEngine.planDeltaEvolution({
      briefing: 'Adicionar módulo de relatórios financeiros e exportação em CSV',
      projectContext: {
        id: 'proj-delta-test',
        name: 'Delta Test App',
        path: deltaDir,
        objective: 'Adicionar relatórios financeiros'
      }
    });

    assert.ok(tasks.length >= 2 && tasks.length <= 5, `Plano cirúrgico deve ter entre 2 e 5 tarefas (gerou ${tasks.length})`);

    // Delta-1: Backend & Migração Aditiva
    assert.ok(tasks[0].title.startsWith('Delta-1:'), 'Primeira tarefa deve ser Delta-1 Backend');
    assert.ok(tasks[0].description.includes('CREATE TABLE IF NOT EXISTS'), 'Deve exigir migração aditiva sem destruir dados');
    assert.ok(tasks[0].criteria.some(c => c.includes('PORT_GUARD')), 'Critérios devem validar Port Guard');

    // Delta-2: UI & Integração Visual
    assert.ok(tasks[1].title.startsWith('Delta-2:'), 'Segunda tarefa deve ser Delta-2 UI');
    assert.ok(tasks[1].criteria.some(c => c.includes('public/index.html')), 'Deve garantir entrega de public/index.html na rota raiz');

    // Delta-3: Regressão e Homologação
    assert.ok(tasks[2].title.startsWith('Delta-3:'), 'Terceira tarefa deve ser Delta-3 Regressão');
    assert.ok(tasks[2].criteria.some(c => c.includes('100% dos testes anteriores continuam passando')), 'Deve exigir preservação de testes');
  });

  it('4. Geração de Kit Cloud Deploy (Dockerfile e .dockerignore) com Port Guard e Healthcheck', () => {
    const cloudDir = path.join(tempBase, 'cloud-app');
    fs.mkdirSync(cloudDir, { recursive: true });

    const pack = DeltaFeatureEngine.generateCloudDeployPack(cloudDir, { port: 4002 });
    assert.equal(pack.created, true);

    const dockerfile = fs.readFileSync(path.join(cloudDir, 'Dockerfile'), 'utf-8');
    const dockerignore = fs.readFileSync(path.join(cloudDir, '.dockerignore'), 'utf-8');

    assert.ok(dockerfile.includes('FROM node:22-alpine'), 'Deve usar Node 22 Alpine');
    assert.ok(dockerfile.includes('EXPOSE 4002'), 'Deve expor a porta configurada');
    assert.ok(dockerfile.includes('HEALTHCHECK'), 'Deve conter diretiva HEALTHCHECK');
    assert.ok(dockerfile.includes('/api/health'), 'Healthcheck deve sondar /api/health');
    assert.ok(dockerfile.includes('VOLUME ["/app/data"]'), 'Deve definir volume de dados para SQLite');
    assert.ok(dockerignore.includes('node_modules/'), 'Deve ignorar node_modules');
    assert.ok(dockerignore.includes('.ai-dev-hub/'), 'Deve ignorar .ai-dev-hub');
  });

  it('5. Validação das Regras Permanentes de Smart Demo Seeder, Cloud Deploy e Port Guard nos Prompts', () => {
    const supervisorRules = PromptArchitectureService.SUPERVISOR_CORE_RULES;
    const workerRules = PromptArchitectureService.WORKER_CORE_RULES;

    // Regras do Supervisor
    assert.ok(supervisorRules.includes('SMART_DEMO_SEEDING (seedIfEmpty)'), 'Supervisor deve conter regra de Smart Demo Seeding');
    assert.ok(supervisorRules.includes('CLOUD_DEPLOY_PACK'), 'Supervisor deve conter regra de Cloud Deploy Pack');
    assert.ok(supervisorRules.includes('MODO DELTA_EVOLUTION'), 'Supervisor deve conter regra de Modo Delta Evolution');
    assert.ok(supervisorRules.includes('PORT_GUARD'), 'Supervisor deve conter regra de Port Guard');

    // Regras do Worker
    assert.ok(workerRules.includes('SMART_DEMO_SEEDING (seedIfEmpty)'), 'Worker deve conter regra de Smart Demo Seeding');
    assert.ok(workerRules.includes('CLOUD_DEPLOY_PACK'), 'Worker deve conter regra de Cloud Deploy Pack');
    assert.ok(workerRules.includes('PRESERVAÇÃO ESTRITA NO MODO DELTA_EVOLUTION'), 'Worker deve conter regra de preservação no modo Delta');
    assert.ok(workerRules.includes('PORT_GUARD'), 'Worker deve conter regra de Port Guard');

    // Playbooks de Design
    const supervisorPlaybook = DesignSkillService.buildRoleSpecificSkillPlaybook('SUPERVISOR', 'SaaS Subscriptions');
    const workerPlaybook = DesignSkillService.buildRoleSpecificSkillPlaybook('WORKER', 'SaaS Subscriptions');

    assert.ok(supervisorPlaybook.includes('SMART DEMO SEEDING (seedIfEmpty)'), 'Playbook do Supervisor deve exigir seedIfEmpty');
    assert.ok(supervisorPlaybook.includes('CLOUD DEPLOY PACK'), 'Playbook do Supervisor deve exigir Cloud Deploy Pack');
    assert.ok(workerPlaybook.includes('SMART DEMO SEEDING & KIT CLOUD DEPLOY'), 'Playbook do Worker deve conter passo de seed e deploy');
  });

  it('6. Validação dos Projetos Reais (serviceflow2 e rotinateste) com SmartDemoSeeder, Dockerfile e Port Guard', () => {
    // 6.1. ServiceFlow Subscriptions
    const sfDir = 'C:\\IA\\test-projects\\serviceflow2';
    if (fs.existsSync(sfDir)) {
      const sfInventory = DeltaFeatureEngine.scanProjectInventory(sfDir);
      assert.equal(sfInventory.isExisting, true);
      assert.equal(sfInventory.hasSeed, true, 'serviceflow2 deve conter rotina de Smart Demo Seeding');
      assert.equal(sfInventory.hasDockerfile, true, 'serviceflow2 deve conter Dockerfile para Cloud Deploy');

      const sfDocker = fs.readFileSync(path.join(sfDir, 'Dockerfile'), 'utf-8');
      assert.ok(sfDocker.includes('EXPOSE 4000'), 'serviceflow2 deve usar porta 4000 no Dockerfile');
      assert.ok(!sfDocker.includes('3001'), 'serviceflow2 não pode usar porta 3001 reservada ao DecoHUB');
    }

    // 6.2. Rotina Teste (FocusDay Planner)
    const rtDir = 'C:\\IA\\test-projects\\rotinateste';
    if (fs.existsSync(rtDir)) {
      const rtInventory = DeltaFeatureEngine.scanProjectInventory(rtDir);
      assert.equal(rtInventory.isExisting, true);
      assert.equal(rtInventory.hasSeed, true, 'rotinateste deve conter rotina de Smart Demo Seeding');
      assert.equal(rtInventory.hasDockerfile, true, 'rotinateste deve conter Dockerfile para Cloud Deploy');

      const rtDocker = fs.readFileSync(path.join(rtDir, 'Dockerfile'), 'utf-8');
      assert.ok(rtDocker.includes('EXPOSE 4001'), 'rotinateste deve usar porta 4001 no Dockerfile');
      assert.ok(!rtDocker.includes('3001'), 'rotinateste não pode usar porta 3001 reservada ao DecoHUB');
    }
  });
});
