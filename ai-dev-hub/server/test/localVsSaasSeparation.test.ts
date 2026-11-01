import { describe, it } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { MemoryManager } from '../src/memoryManager.js';
import { db, resolveProjectCapabilities, resolveProjectProfileMode } from '../src/db.js';
import { HierarchicalOrchestrationService } from '../src/hierarchicalOrchestrationService.js';

describe('Separação Explícita: Local (Uso Próprio) vs SaaS (Comercial)', () => {
  it('1. MemoryManager declara cabeçalho correto em project.md e architecture.md para ambos os perfis', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-memory-test-'));

    try {
      const localPath = path.join(tempDir, 'local-tool');
      fs.mkdirSync(localPath, { recursive: true });

      MemoryManager.ensureMemoryStructure(localPath, {
        name: 'WhatsApp Bot Local',
        objective: 'Disparador manual de WhatsApp com Baileys e fila SQLite WAL',
        project_profile: 'local_personal'
      });

      const localProjectMd = fs.readFileSync(path.join(localPath, '.ai-dev-hub', 'project.md'), 'utf-8');
      const localArchMd = fs.readFileSync(path.join(localPath, '.ai-dev-hub', 'architecture.md'), 'utf-8');

      assert.match(localProjectMd, /> \*\*TIPO DE PROJETO:\*\* FERRAMENTA LOCAL \(SEM LOGIN \/ OPERAÇÃO DIRETA\)/);
      assert.match(localArchMd, /> \*\*TIPO DE PROJETO:\*\* FERRAMENTA LOCAL \(SEM LOGIN \/ OPERAÇÃO DIRETA\)/);

      const saasPath = path.join(tempDir, 'saas-product');
      fs.mkdirSync(saasPath, { recursive: true });

      MemoryManager.ensureMemoryStructure(saasPath, {
        name: 'Micro-SaaS Comercial',
        objective: 'Plataforma SaaS com login, planos e checkout PIX',
        project_profile: 'commercial_saas'
      });

      const saasProjectMd = fs.readFileSync(path.join(saasPath, '.ai-dev-hub', 'project.md'), 'utf-8');
      const saasArchMd = fs.readFileSync(path.join(saasPath, '.ai-dev-hub', 'architecture.md'), 'utf-8');

      assert.match(saasProjectMd, /> \*\*TIPO DE PROJETO:\*\* PRODUTO SAAS \(MULTI-TENANT \/ COMERCIAL\)/);
      assert.match(saasArchMd, /> \*\*TIPO DE PROJETO:\*\* PRODUTO SAAS \(MULTI-TENANT \/ COMERCIAL\)/);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('2. resolveProjectCapabilities e resolveProjectProfileMode respeitam as definições de local vs saas', () => {
    const localCaps = resolveProjectCapabilities({ project_profile: 'local_personal' });
    assert.strictEqual(localCaps.auth, false, 'Ferramenta local não deve ter auth ativada');
    assert.strictEqual(localCaps.payments, false, 'Ferramenta local não deve ter pagamentos/billing');
    assert.strictEqual(localCaps.advancedSaas, false, 'Ferramenta local não deve ter advancedSaas');
    assert.strictEqual(localCaps.database, true, 'Ferramenta local usa SQLite');

    const saasCaps = resolveProjectCapabilities({ project_profile: 'commercial_saas' });
    assert.strictEqual(saasCaps.auth, true, 'SaaS deve ter auth ativada');
    assert.strictEqual(saasCaps.payments, true, 'SaaS deve ter pagamentos/billing');
    assert.strictEqual(saasCaps.advancedSaas, true, 'SaaS deve ter advancedSaas');
    assert.strictEqual(saasCaps.multiTenant, true, 'SaaS deve ter multiTenant');
    assert.strictEqual(saasCaps.database, true, 'SaaS usa banco relacional');

    assert.strictEqual(resolveProjectProfileMode({ project_profile: 'local_personal' }), 'local_personal');
    assert.strictEqual(resolveProjectProfileMode({ project_profile: 'commercial_saas' }), 'commercial_saas');
  });

  it('3. Supervisor para modo local_personal: PROÍBE tarefas de login, cadastro, senha e checkout/assinaturas', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-plan-local-'));

    try {
      const briefing = 'Disparador de mensagens de WhatsApp com Baileys, fila de envio local em SQLite WAL e simulador de webhooks Cakto';
      const tasks = HierarchicalOrchestrationService.generateMultiPassPlannedTasks({
        briefing,
        projectName: 'WhatsApp Disparador Local',
        projectPath: tempDir,
        projectId: 'test-local-proj'
      });

      assert.ok(tasks && tasks.length >= 2, 'Deve gerar plano decomposto');

      // Verifica que NENHUMA tarefa é sobre tela de login, cadastro de usuário, recuperação de senha ou planos de assinatura
      for (const t of tasks) {
        const fullText = `${t.title} ${t.description} ${(t.criteria || []).join(' ')}`.toLowerCase();
        assert.doesNotMatch(fullText, /\btela de login\b/i, `Tarefa "${t.title}" não pode conter tela de login`);
        assert.doesNotMatch(fullText, /\bcadastro de usuário\b/i, `Tarefa "${t.title}" não pode conter cadastro de usuário`);
        assert.doesNotMatch(fullText, /\brecuperação de senha\b/i, `Tarefa "${t.title}" não pode conter recuperação de senha`);
        assert.doesNotMatch(fullText, /\bplanos? de assinatura\b/i, `Tarefa "${t.title}" não pode conter planos de assinatura`);

        if (t.expectedFiles) {
          for (const f of t.expectedFiles) {
            assert.doesNotMatch(f, /authMiddleware|login\.tsx|billing\./i, `Arquivo ${f} não deve ser de login ou billing`);
          }
        }
      }
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('4. Supervisor para modo commercial_saas: Contempla o pipeline comercial (auth, multi-tenant, billing, dashboard)', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-plan-saas-'));

    try {
      // Injeta projeto temporário no banco para simular modo commercial_saas
      const testSaasId = 'test-saas-proj-' + Date.now();
      db.prepare(`
        INSERT INTO projects (id, name, path, project_profile, capabilities_json, created_at, updated_at)
        VALUES (?, 'MicroSaaS Pix Pro', ?, 'commercial_saas', '{"database":true,"auth":true,"payments":true,"advancedSaas":true,"demoSeed":true}', datetime('now'), datetime('now'))
      `).run(testSaasId, tempDir);

      const briefing = 'Micro-SaaS comercial completo com autenticação de usuários, planos de assinatura, checkout PIX/Cartão e isolamento multi-tenant';
      const tasks = HierarchicalOrchestrationService.generateMultiPassPlannedTasks({
        briefing,
        projectName: 'MicroSaaS Pix Pro',
        projectPath: tempDir,
        projectId: testSaasId
      });

      assert.ok(tasks && tasks.length >= 6, 'Deve gerar pipeline completo para SaaS comercial');

      const allText = tasks.map(t => `${t.title} ${t.description} ${(t.criteria || []).join(' ')}`).join(' ').toLowerCase();

      // Verifica presença dos pilares comerciais no plano
      assert.ok(allText.includes('billing') || allText.includes('pix') || allText.includes('planos'), 'Plano SaaS deve contemplar billing/planos/pix');
      assert.ok(allText.includes('workspace') || allText.includes('tenant') || allText.includes('equipe') || allText.includes('rbac'), 'Plano SaaS deve contemplar multi-tenant/workspace/rbac');
      assert.ok(allText.includes('dashboard') || allText.includes('analytics'), 'Plano SaaS deve contemplar dashboard/analytics');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
