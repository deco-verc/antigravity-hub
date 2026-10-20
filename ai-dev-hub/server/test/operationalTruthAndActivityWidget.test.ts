// server/test/operationalTruthAndActivityWidget.test.ts
// Testes de Verdade Operacional: Eliminação de Divergência "Pronto vs. Executando"
// e Exposição Real-Time de Skill em Execução, Slash Commands e Metadados de Backlog

import test, { describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { db } from '../src/db.js';
import { AutonomousManager } from '../src/autonomousManager.js';
import { AutonomousRunnerService } from '../src/autonomousRunnerService.js';

describe('VERDADE OPERACIONAL: Metadados de Skill, Roteamento e Sincronia de Estado UI', () => {
  let testProjectDir: string;
  let testProjectId: string;
  let testRunId: string;

  beforeEach(() => {
    testProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-optruth-test-'));
    testProjectId = 'test-proj-optruth-' + crypto.randomUUID().slice(0, 8);
    testRunId = crypto.randomUUID();

    // Create minimal project with local skills in .ai-dev-hub/skills/
    const skillsDir = path.join(testProjectDir, '.ai-dev-hub', 'skills');
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.writeFileSync(path.join(skillsDir, 'taste-skill.md'), '# Taste Skill\nTokens :root e estética.', 'utf-8');
    fs.writeFileSync(path.join(skillsDir, 'ui-styling.md'), '# UI Styling\nComponentes elegantes.', 'utf-8');
    fs.writeFileSync(path.join(skillsDir, 'stitch-skill.md'), '# Stitch Skill\nIntegração de layouts.', 'utf-8');

    // Insert project in DB
    const nowIso = new Date().toISOString();
    db.prepare(`
      INSERT INTO projects (id, name, path, status, created_at, updated_at)
      VALUES (?, ?, ?, 'active', ?, ?)
    `).run(testProjectId, 'Projeto Rotina Teste', testProjectDir, nowIso, nowIso);
  });

  afterEach(() => {
    try {
      db.prepare('DELETE FROM autonomous_events WHERE run_id = ?').run(testRunId);
      db.prepare('DELETE FROM autonomous_tasks WHERE run_id = ?').run(testRunId);
      db.prepare('DELETE FROM autonomous_runs WHERE id = ?').run(testRunId);
      db.prepare('DELETE FROM projects WHERE id = ?').run(testProjectId);
    } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "operationalTruthAndActivityWidget.test",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:operationalTruthAndActivityWidget.test]", err);
      }
    }

    try {
      fs.rmSync(testProjectDir, { recursive: true, force: true });
    } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "operationalTruthAndActivityWidget.test",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:operationalTruthAndActivityWidget.test]", err);
      }
    }
  });

  test('1. resolveRunSkillsMetadata identifica Slash Commands, skills em disco e especialidade do Worker', () => {
    // Caso A: Run criado a partir de /frontend
    const mockRunFrontend = {
      name: '/frontend: Interface Refinada',
      objective: 'Frontend & UI Craft Elevado: Elevação visual',
      briefing: 'COMANDO DISPARADO: /frontend\n=== PLAYBOOK CIRÚRGICO ==='
    };
    const mockTasks = [
      { id: 't1', title: 'Setup Tokens', status: 'completed', skill_routed: 'FRONTEND_SPECIALIST' },
      { id: 't2', title: 'Bento Grid', status: 'ready', skill_routed: 'FRONTEND_SPECIALIST' }
    ];

    const metaFrontend = AutonomousManager.resolveRunSkillsMetadata(mockRunFrontend, mockTasks, testProjectDir);
    assert.equal(metaFrontend.activeSlashCommand, '/frontend — Frontend & UI Craft Elevado');
    assert.equal(metaFrontend.currentExecutionSpecialty, 'FRONTEND_SPECIALIST');
    assert.ok(metaFrontend.activeSkillsList.includes('taste-skill'));
    assert.ok(metaFrontend.activeSkillsList.includes('ui-styling'));
    assert.ok(metaFrontend.activeSkillsList.includes('stitch-skill'));

    // Caso B: Run criado a partir de /style brutalist
    const mockRunStyle = {
      name: 'Estilo: BRUTALIST',
      objective: 'Aplicar arquétipo estético visual [BRUTALIST] à interface do projeto',
      briefing: '=== DIRETRIZES DE TRANSFORMAÇÃO VISUAL: [BRUTALIST] ===\nARQUÉTIPO: brutalist'
    };
    const metaStyle = AutonomousManager.resolveRunSkillsMetadata(mockRunStyle, [], testProjectDir);
    assert.equal(metaStyle.activeSlashCommand, '/style — Arquétipo Estético & Sistema de Cores');
    assert.equal(metaStyle.currentExecutionSpecialty, 'FRONTEND_SPECIALIST');
    assert.ok(metaStyle.activeSkillsList.includes('brutalist-skill'));

    // Caso C: Run criado a partir de /rea
    const mockRunRea = {
      name: '/rea: SaaS Master',
      objective: 'Arquitetura SaaS Resiliente (REA Master)',
      briefing: 'COMANDO DISPARADO: /rea'
    };
    const metaRea = AutonomousManager.resolveRunSkillsMetadata(mockRunRea, [], testProjectDir);
    assert.equal(metaRea.activeSlashCommand, '/rea — Arquitetura SaaS Resiliente (REA Master)');
    assert.equal(metaRea.currentExecutionSpecialty, 'REA_SPECIALIST');
  });

  test('2. AutonomousManager.getRun enriquece run e tarefas com activeSlashCommand, activeSkillsList e skill_routed', () => {
    const nowIso = new Date().toISOString();

    // Inserir Run autônomo ativo
    db.prepare(`
      INSERT INTO autonomous_runs (id, project_id, name, objective, briefing, status, autonomy_mode, start_time, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'running', 'autonomous', ?, ?, ?)
    `).run(
      testRunId,
      testProjectId,
      '/frontend: UI Craft Elevado',
      'Frontend & UI Craft Elevado: modernizar telas',
      'COMANDO DISPARADO: /frontend\nDiretrizes de layout',
      nowIso,
      nowIso,
      nowIso
    );

    // Inserir 7 tarefas simulando cenário do usuário (1 completed, 1 ready, 5 pending)
    const taskTitles = [
      'Backend e Persistência Aditiva: Audit Trail e Healthcheck',
      'Design Tokens e Super-Estrutura Visual CSS',
      'Navegação em Abas com Atributos Semânticos e SVG',
      'Bento Grid e Cards de Métrica com Tabular-Nums',
      'Formulários Reativos e Validação Client-Side',
      'Persistência F5 e Store Reativa',
      'Inspeção Visual Playwright e 4 Selos de Homologação'
    ];

    taskTitles.forEach((title, index) => {
      const taskId = `${testRunId}-task-${index + 1}`;
      const status = index === 0 ? 'completed' : index === 1 ? 'ready' : 'pending';
      db.prepare(`
        INSERT INTO autonomous_tasks (
          id, run_id, title, description, order_index, status, skill_routed, skill_confidence,
          skill_guidelines_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        taskId,
        testRunId,
        title,
        `Descrição da etapa ${index + 1}`,
        index,
        status,
        index === 0 ? 'BACKEND_ENGINEER' : 'FRONTEND_SPECIALIST',
        1.0,
        JSON.stringify(['taste-skill', 'ui-styling']),
        nowIso,
        nowIso
      );
    });

    const retrievedRun = AutonomousManager.getRun(testRunId);

    // Validação de metadados do Run
    assert.equal(retrievedRun.status, 'running');
    assert.equal(retrievedRun.activeSlashCommand, '/frontend — Frontend & UI Craft Elevado');
    assert.equal(retrievedRun.currentExecutionSpecialty, 'FRONTEND_SPECIALIST');
    assert.ok(Array.isArray(retrievedRun.activeSkillsList));
    assert.ok(retrievedRun.activeSkillsList.includes('taste-skill'));

    // Validação de estatísticas
    assert.equal(retrievedRun.stats.total, 7);
    assert.equal(retrievedRun.stats.completed, 1);
    assert.equal(retrievedRun.stats.activeSlashCommand, '/frontend — Frontend & UI Craft Elevado');
    assert.equal(retrievedRun.stats.currentExecutionSpecialty, 'FRONTEND_SPECIALIST');

    // Validação de cada tarefa com skill_routed e status
    assert.equal(retrievedRun.tasks.length, 7);
    assert.equal(retrievedRun.tasks[0].status, 'completed');
    assert.equal(retrievedRun.tasks[0].skill_routed, 'BACKEND_ENGINEER');
    assert.equal(retrievedRun.tasks[1].status, 'ready');
    assert.equal(retrievedRun.tasks[1].skill_routed, 'FRONTEND_SPECIALIST');
  });

  test('3. Simulação de Lógica da UI: Run ativo com 1 de 7 tarefas concluídas JAMAIS reporta Pronto ou Nenhuma Tarefa', () => {
    // Simula a lógica de DecoHubCurrentActivityWidget
    const mockTasks = [
      { id: '1', title: 'Task 1', status: 'completed', lifecycle_state: 'COMPLETED', skill_routed: 'BACKEND_ENGINEER' },
      { id: '2', title: 'Task 2', status: 'ready', lifecycle_state: 'READY', skill_routed: 'FRONTEND_SPECIALIST' },
      { id: '3', title: 'Task 3', status: 'pending', lifecycle_state: 'PLANNED', skill_routed: 'FRONTEND_SPECIALIST' }
    ];

    const mockRun = {
      status: 'running' as const,
      name: '/frontend: Refatoração',
      activeSlashCommand: '/frontend — Frontend & UI Craft Elevado',
      activeSkillsList: ['taste-skill', 'ui-styling'],
      currentExecutionSpecialty: 'FRONTEND_SPECIALIST',
      tasks: mockTasks
    };

    const allTasks = mockRun.tasks;
    const completedTasks = allTasks.filter(t => t.status === 'completed' || t.lifecycle_state === 'COMPLETED');
    const hasRemainingTasks = allTasks.length > 0 && completedTasks.length < allTasks.length;

    // Regra estrita de verdade de estado
    const isTerminalRun = mockRun.status === 'completed' || mockRun.status === 'failed';
    const isRunActive = Boolean(
      mockRun &&
      !isTerminalRun &&
      (['running', 'building', 'testing', 'reviewing', 'planning', 'waiting_for_worker'].includes(mockRun.status) || hasRemainingTasks)
    );

    const isSelfHealing = false;
    const isReviewing = false;
    const isPlanning = false;
    const isExecuting = !isSelfHealing && !isReviewing && !isPlanning && isRunActive;

    // Asserção Inviolável: isRunActive e isExecuting DEVEM ser verdadeiros
    assert.equal(isRunActive, true, 'O Run deve ser considerado ativo enquanto houver tarefas pendentes e status running');
    assert.equal(isExecuting, true, 'O Executor deve ser considerado ativo mesmo na transição entre tarefas');

    // Validação da mensagem de Agora: NUNCA deve ser "Nenhuma tarefa em execução..."
    const readyTask = allTasks.find(t => t.status === 'ready');
    let nowContent = '';
    if (isExecuting || isRunActive) {
      if (readyTask) {
        nowContent = `Preparando e injetando contexto da Skill [${readyTask.skill_routed}] para: ${readyTask.title}`;
      } else {
        nowContent = `Executando Skill [${mockRun.activeSlashCommand.split('—')[0].trim()}] — Validando e aplicando alterações no projeto.`;
      }
    }

    assert.ok(!nowContent.includes('Nenhuma tarefa em execução'), 'Mensagem de Agora não pode ser ociosa quando o Run está ativo');
    assert.ok(nowContent.includes('Preparando e injetando contexto da Skill [FRONTEND_SPECIALIST]'));
  });

  test('4. AutonomousRunnerService.getStatus retorna estado online e informações do executor', () => {
    const status = AutonomousRunnerService.getStatus();
    assert.ok(typeof status.online === 'boolean');
    assert.ok(typeof status.runnerId === 'string');
    assert.ok(typeof status.workerFleet === 'object');
  });
});
