// server/test/skillSlashCommands.test.ts
// Testes de Validação do Motor Universal de Slash Commands e Catálogo de Skills (FASE 16)

import test, { describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { db } from '../src/db.js';
import { SkillSlashCommandService } from '../src/skillSlashCommandService.js';
import { ChatIntentClassifier } from '../src/chatIntentClassifier.js';
import { AutonomousManager } from '../src/autonomousManager.js';
import { AgentApiGateway } from '../src/agentApiGateway.js';

describe('FASE 16: Motor Universal de Slash Commands e Arsenal de Skills', () => {
  let testProjectDir: string;
  let testProjectId: string;

  beforeEach(() => {
    testProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-slash-cmd-test-'));
    testProjectId = 'test-proj-' + crypto.randomUUID().slice(0, 8);

    // Create a minimal project structure
    fs.mkdirSync(path.join(testProjectDir, 'public'), { recursive: true });
    fs.writeFileSync(
      path.join(testProjectDir, 'public', 'index.html'),
      '<!DOCTYPE html><html><head><title>Test App</title><style>:root { --bg: #000; }</style></head><body><h1>Hello World</h1><button id="btn">Click</button></body></html>',
      'utf-8'
    );
    fs.writeFileSync(
      path.join(testProjectDir, 'package.json'),
      JSON.stringify({ name: 'test-slash-app', version: '1.0.0' }, null, 2),
      'utf-8'
    );

    // Register project in test DB
    try {
      db.prepare(`
        INSERT INTO projects (id, name, path, status, created_at, updated_at)
        VALUES (?, ?, ?, 'active', ?, ?)
      `).run(testProjectId, 'Test Project Slash', testProjectDir, new Date().toISOString(), new Date().toISOString());
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "skillSlashCommands.test",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:skillSlashCommands.test]", err);
      }
    }
  });

  afterEach(() => {
    try {
      db.prepare('DELETE FROM messages WHERE project_id = ?').run(testProjectId);
      db.prepare('DELETE FROM autonomous_runs WHERE project_id = ?').run(testProjectId);
      db.prepare('DELETE FROM projects WHERE id = ?').run(testProjectId);
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "skillSlashCommands.test",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:skillSlashCommands.test]", err);
      }
    }

    try {
      fs.rmSync(testProjectDir, { recursive: true, force: true });
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "skillSlashCommands.test",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:skillSlashCommands.test]", err);
      }
    }
  });

  test('1. Registro completo de todos os Slash Commands e resolução dos arquivos .md', () => {
    const catalog = SkillSlashCommandService.getSlashCommandsCatalog();
    const requiredCommands = [
      '/frontend',
      '/redesign',
      '/style',
      '/image',
      '/img2code',
      '/rea',
      '/karpathy',
      '/brand',
      '/ux',
      '/pentest',
      '/docs',
      '/find',
      '/skills'
    ];

    for (const reqCmd of requiredCommands) {
      const found = catalog.find(c => c.command === reqCmd);
      assert.ok(found, `Comando ${reqCmd} deve estar presente no catálogo oficial`);
      assert.ok(found.title && found.title.length > 0, `Comando ${reqCmd} deve ter título descritivo`);
      assert.ok(found.description && found.description.length > 0, `Comando ${reqCmd} deve ter descrição`);
      assert.ok(found.category && found.category.length > 0, `Comando ${reqCmd} deve ter categoria`);
      assert.ok(found.executionType === 'IMMEDIATE_TOOL' || found.executionType === 'AUTONOMOUS_DELTA', `Comando ${reqCmd} deve ter executionType válido`);
    }

    // Validar resolução de arquivos das skills no disco
    const fileMap = SkillSlashCommandService.getSkillFileMap();
    const coreSkillsToVerify = [
      'taste-skill',
      'taste-skill-v1',
      'taste-skill-v2-experimental',
      'brandkit',
      'brutalist-skill',
      'minimalist-skill',
      'soft-skill',
      'image-to-code-skill',
      'imagegen-frontend-web',
      'imagegen-frontend-mobile',
      'redesign-skill',
      'stitch-skill',
      'output-skill',
      'gpt-tasteskill',
      'banner-design',
      'brand',
      'design',
      'design-system',
      'slides',
      'ui-styling',
      'find-skills',
      'pr-labeling',
      'triage',
      'karpathy-guidelines'
    ];

    for (const sk of coreSkillsToVerify) {
      const candidates = fileMap[sk];
      assert.ok(candidates && candidates.length > 0, `Skill ${sk} deve estar mapeada no getSkillFileMap()`);
      const exists = candidates.some(c => fs.existsSync(c));
      assert.ok(exists, `Arquivo real da skill "${sk}" deve existir no disco em pelo menos um candidato:\n${candidates.join('\n')}`);
    }
  });

  test('2. Reconhecimento sintático e classificação pelo ChatIntentClassifier', () => {
    assert.ok(SkillSlashCommandService.isSlashCommand('/frontend'));
    assert.ok(SkillSlashCommandService.isSlashCommand('   /image   '));
    assert.ok(SkillSlashCommandService.isSlashCommand('/style brutalist'));
    assert.ok(!SkillSlashCommandService.isSlashCommand('Olá, como vai?'));

    const parsedFe = SkillSlashCommandService.parseCommand('/ui deixar mais denso');
    assert.ok(parsedFe);
    assert.equal(parsedFe.def.command, '/frontend');
    assert.equal(parsedFe.matchedCmd, '/ui');
    assert.equal(parsedFe.args, 'deixar mais denso');

    const parsedKarpathy = SkillSlashCommandService.parseCommand('/clean-code refatorar auth');
    assert.ok(parsedKarpathy);
    assert.equal(parsedKarpathy.def.command, '/karpathy');
    assert.equal(parsedKarpathy.matchedCmd, '/clean-code');

    const parsedShot = SkillSlashCommandService.parseCommand('/shot');
    assert.ok(parsedShot);
    assert.equal(parsedShot.def.command, '/image');

    // Intent classifier test
    const intentCmd = ChatIntentClassifier.classify('/frontend refatorar tela');
    assert.equal(intentCmd.intent, 'EXECUTION_INSTRUCTION');
    assert.equal(intentCmd.subType, 'BUILD_TASK');

    const intentInspect = ChatIntentClassifier.classify('/image');
    assert.equal(intentInspect.intent, 'STATE_QUERY');
    assert.equal(intentInspect.subType, 'STATUS_INQUIRY');
  });

  test('3. Execução imediata de /image com captura de tela e telemetria', async () => {
    const result = await SkillSlashCommandService.handleSlashCommand({
      projectId: testProjectId,
      projectPath: testProjectDir,
      command: '/image',
      args: '',
      fullMessage: '/image'
    });

    assert.equal(result.execution.status, 'completed');
    assert.equal(result.execution.command, '/image');
    assert.ok(result.replyContent.includes('Evidências Visuais Capturadas via Playwright'));
    assert.ok(result.screenshots && result.screenshots.length > 0, 'Deve retornar lista de screenshots');
    assert.ok(result.metadata?.screenshots?.length > 0, 'Metadata deve conter os screenshots anexados');

    for (const sc of result.screenshots) {
      assert.ok(sc.url.includes(`/api/projects/${testProjectId}/evidence-file/`));
      assert.ok(sc.filename.length > 0);
    }
  });

  test('4. Execução imediata de /skills com catálogo completo', async () => {
    const result = await SkillSlashCommandService.handleSlashCommand({
      projectId: testProjectId,
      projectPath: testProjectDir,
      command: '/skills',
      args: '',
      fullMessage: '/skills'
    });

    assert.equal(result.execution.status, 'completed');
    assert.equal(result.execution.command, '/skills');
    assert.ok(result.replyContent.includes('Catálogo Central de Slash Commands'));
    assert.ok(result.replyContent.includes('/frontend'));
    assert.ok(result.replyContent.includes('/image'));
    assert.ok(result.replyContent.includes('/rea'));
    assert.ok(result.replyContent.includes('/karpathy'));
    assert.ok(result.replyContent.includes('/pentest'));
  });

  test('5. Execução direta de /ux e /pentest (diagnóstico imediato)', async () => {
    const uxResult = await SkillSlashCommandService.handleSlashCommand({
      projectId: testProjectId,
      projectPath: testProjectDir,
      command: '/ux',
      args: '',
      fullMessage: '/ux'
    });

    assert.equal(uxResult.execution.status, 'completed');
    assert.equal(uxResult.execution.command, '/ux');
    assert.ok(uxResult.replyContent.includes('UserExperienceSimulator'));
    assert.ok(typeof uxResult.execution.score === 'number');

    const pentestResult = await SkillSlashCommandService.handleSlashCommand({
      projectId: testProjectId,
      projectPath: testProjectDir,
      command: '/pentest',
      args: '',
      fullMessage: '/pentest'
    });

    assert.equal(pentestResult.execution.status, 'completed');
    assert.equal(pentestResult.execution.command, '/pentest');
    assert.ok(pentestResult.replyContent.includes('OWASP Top 10 Red Team'));
    assert.ok(typeof pentestResult.execution.score === 'number');
  });

  test('6. Provisionamento de skills e limite de caracteres de briefing para /frontend', async () => {
    const result = await SkillSlashCommandService.handleSlashCommand({
      projectId: testProjectId,
      projectPath: testProjectDir,
      command: '/frontend',
      args: 'refinar dashboard executivo com bento grid',
      fullMessage: '/frontend refinar dashboard executivo com bento grid'
    });

    assert.equal(result.execution.status, 'started');
    assert.equal(result.execution.command, '/frontend');
    assert.ok(result.autonomousRun, 'Deve criar um AutonomousRun real');

    const skillsDir = path.join(testProjectDir, '.ai-dev-hub', 'skills');
    assert.ok(fs.existsSync(skillsDir), 'Diretório .ai-dev-hub/skills deve ter sido criado');

    // Valida que arquivos das skills foram copiados
    const copiedFiles = fs.readdirSync(skillsDir);
    assert.ok(copiedFiles.length >= 2, 'Pelo menos 2 arquivos de skills devem estar provisionados');
    assert.ok(copiedFiles.includes('taste-skill.md') || copiedFiles.some(f => f.includes('taste')));

    // Valida DESIGN.md gerado
    assert.ok(fs.existsSync(path.join(testProjectDir, 'DESIGN.md')), 'DESIGN.md deve ter sido gerado');

    // Valida que o briefing respeita com folga o limite de 28k chars
    const runInDb: any = db.prepare('SELECT * FROM autonomous_runs WHERE id = ?').get(result.autonomousRun.id);
    assert.ok(runInDb);
    assert.ok(runInDb.briefing.length < 28000, `Briefing (${runInDb.briefing.length} chars) deve respeitar clampPromptForCli < 28k`);
    const clamped = AgentApiGateway.clampPromptForCli(runInDb.briefing);
    assert.equal(clamped.length, runInDb.briefing.length, 'Não deve sofrer truncamento agressivo por estar cirúrgico');
  });

  test('7. Provisionamento e execução de /rea (SaaS Master 7 Pilares)', async () => {
    const result = await SkillSlashCommandService.handleSlashCommand({
      projectId: testProjectId,
      projectPath: testProjectDir,
      command: '/rea',
      args: 'auditar e implementar app shell com command palette',
      fullMessage: '/rea auditar e implementar app shell com command palette'
    });

    assert.equal(result.execution.status, 'started');
    assert.equal(result.execution.command, '/rea');
    assert.ok(result.autonomousRun);

    const skillsDir = path.join(testProjectDir, '.ai-dev-hub', 'skills');
    assert.ok(fs.existsSync(skillsDir));

    const runInDb: any = db.prepare('SELECT * FROM autonomous_runs WHERE id = ?').get(result.autonomousRun.id);
    assert.ok(runInDb.briefing.includes('PLAYBOOK CIRÚRGICO'));
    assert.ok(runInDb.briefing.length < 28000);
  });

  test('8. Provisionamento de /style brutalist e /karpathy', async () => {
    const styleResult = await SkillSlashCommandService.handleSlashCommand({
      projectId: testProjectId,
      projectPath: testProjectDir,
      command: '/style',
      args: 'brutalist',
      fullMessage: '/style brutalist'
    });

    assert.equal(styleResult.execution.status, 'started');
    assert.equal(styleResult.execution.command, '/style');
    assert.equal(styleResult.execution.archetype, 'brutalist');

    const designMd = fs.readFileSync(path.join(testProjectDir, 'DESIGN.md'), 'utf-8');
    assert.ok(designMd.toUpperCase().includes('BRUTALIST'), 'DESIGN.md deve refletir o estilo brutalista');

    const karpathyResult = await SkillSlashCommandService.handleSlashCommand({
      projectId: testProjectId,
      projectPath: testProjectDir,
      command: '/karpathy',
      args: 'simplificar camada de rotas',
      fullMessage: '/karpathy simplificar camada de rotas'
    });

    assert.equal(karpathyResult.execution.status, 'started');
    assert.equal(karpathyResult.execution.command, '/karpathy');
    const skillsDir = path.join(testProjectDir, '.ai-dev-hub', 'skills');
    assert.ok(fs.existsSync(path.join(skillsDir, 'karpathy-guidelines.md')), 'karpathy-guidelines.md deve ter sido provisionado');

    // Antigravity 2.0 Native Path Verification
    const nativeSkillFile = path.join(testProjectDir, '.agents', 'skills', 'karpathy-guidelines', 'SKILL.md');
    assert.ok(fs.existsSync(nativeSkillFile), 'karpathy-guidelines nativo .agents/skills/.../SKILL.md deve existir');
    const nativeContent = fs.readFileSync(nativeSkillFile, 'utf-8');
    assert.ok(nativeContent.startsWith('---\nname: karpathy-guidelines'), 'SKILL.md deve conter frontmatter YAML válido com name:');
    assert.ok(nativeContent.includes('description:'), 'SKILL.md deve conter frontmatter YAML com description:');
    assert.ok(
      nativeContent.includes('### Contextual Calibration (Interactive vs. Autonomous Execution)'),
      'SKILL.md deve conter o bloco de calibracao contextual dual-mode'
    );
    assert.ok(
      nativeContent.includes('In Autonomous Worker Execution'),
      'SKILL.md deve calibrar para execucao autonoma (run_id ativo)'
    );

    const nativeExamplesFile = path.join(testProjectDir, '.agents', 'skills', 'karpathy-guidelines', 'examples', 'EXAMPLES.md');
    assert.ok(fs.existsSync(nativeExamplesFile), 'examples/EXAMPLES.md deve ter sido provisionado na anatomia nativa da skill');
    const examplesContent = fs.readFileSync(nativeExamplesFile, 'utf-8');
    assert.ok(examplesContent.length > 500, 'EXAMPLES.md deve conter conteudo completo de exemplos');
  });
});
