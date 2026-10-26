import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SkillRouter, calibrateKarpathySkillContent, ensureSkillFrontmatter } from '../src/skillRouter.js';
import { SkillSlashCommandService } from '../src/skillSlashCommandService.js';
import { validateSurgicalDiff } from '../src/agentGuidelines.js';
import { MetaChatService } from '../src/metaChatService.js';

test('Antigravity 2.0 Native Skills & Karpathy Integration Suite', async (t) => {
  const tmpRoot = path.join(os.tmpdir(), `decohub-native-skills-test-${Date.now()}`);
  fs.mkdirSync(tmpRoot, { recursive: true });

  t.after(() => {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors on Windows
    }
  });

  await t.test('1. calibrateKarpathySkillContent injeta calibração contextual sem duplicar', () => {
    const originalSkill = `---
name: karpathy-guidelines
description: "Guidelines"
---
# Karpathy Guidelines
## 1. Think Before Coding
- State your assumptions explicitly. If uncertain, ask.
## 2. Simplicity First
- Minimum code that solves the problem.
`;

    const calibrated = calibrateKarpathySkillContent(originalSkill);
    assert.ok(calibrated.includes('### Contextual Calibration (Interactive vs. Autonomous Execution)'));
    assert.ok(calibrated.includes('In Autonomous Worker Execution'));
    assert.ok(calibrated.includes('NEVER halt execution or call `ask_question`'));

    // Idempotência
    const reCalibrated = calibrateKarpathySkillContent(calibrated);
    assert.equal(calibrated, reCalibrated, 'Calibração deve ser estritamente idempotente');
  });

  await t.test('2. ensureSkillFrontmatter gera frontmatter YAML válido em skills brutas e preserva existentes', () => {
    const rawMarkdown = '# Titulo de Skill\n\nConteudo da skill sem frontmatter.';
    const withFm = ensureSkillFrontmatter(rawMarkdown, 'minha-skill', 'Descricao da minha skill');
    assert.ok(withFm.startsWith('---\nname: minha-skill'));
    assert.ok(withFm.includes('description: "Descricao da minha skill"'));
    assert.ok(withFm.includes('# Titulo de Skill'));

    // Preservar frontmatter existente
    const existingFm = `---
name: karpathy-guidelines
description: Original description
---
# Karpathy`;
    const preserved = ensureSkillFrontmatter(existingFm, 'karpathy-guidelines');
    assert.ok(preserved.includes('name: karpathy-guidelines'));
    assert.ok(preserved.includes('description: Original description'));
  });

  await t.test('3. SkillRouter.resolvePhysicalSkillsForTask provisiona dual-mode (.ai-dev-hub/skills e .agents/skills)', () => {
    const projDir = path.join(tmpRoot, 'proj-skill-router');
    fs.mkdirSync(projDir, { recursive: true });

    const task = {
      title: 'Simplificar e refatorar rotas com Karpathy Minimalist',
      description: 'Remover código redundante e manter cirúrgico',
      criteria: ['Testes passando', 'Zero overengineering']
    };

    const res = SkillRouter.resolvePhysicalSkillsForTask(task, 'KARPATHY_MINIMALIST', projDir);
    assert.ok(res.copiedFiles.length > 0, 'Deve ter copiado arquivos para o projeto');

    // 1. Legado / compatibilidade retroativa
    const legacyKarpathy = path.join(projDir, '.ai-dev-hub', 'skills', 'karpathy-guidelines-skill.md');
    assert.ok(fs.existsSync(legacyKarpathy), '.ai-dev-hub/skills/karpathy-guidelines-skill.md deve existir');
    const legacyContent = fs.readFileSync(legacyKarpathy, 'utf-8');
    assert.ok(legacyContent.includes('Contextual Calibration (Interactive vs. Autonomous Execution)'));

    // 2. Nativo Antigravity 2.0
    const nativeKarpathy = path.join(projDir, '.agents', 'skills', 'karpathy-guidelines', 'SKILL.md');
    assert.ok(fs.existsSync(nativeKarpathy), '.agents/skills/karpathy-guidelines/SKILL.md deve existir');
    const nativeContent = fs.readFileSync(nativeKarpathy, 'utf-8');
    assert.ok(nativeContent.startsWith('---\nname: karpathy-guidelines'));
    assert.ok(nativeContent.includes('Contextual Calibration'));

    // 3. Anatomia nativa de exemplos
    const nativeExamples = path.join(projDir, '.agents', 'skills', 'karpathy-guidelines', 'examples', 'EXAMPLES.md');
    assert.ok(fs.existsSync(nativeExamples), '.agents/skills/karpathy-guidelines/examples/EXAMPLES.md deve existir');
    const examplesContent = fs.readFileSync(nativeExamples, 'utf-8');
    assert.ok(examplesContent.length > 500);
  });

  await t.test('4. validateSurgicalDiff reconhece .agents/ como governança e acusa alterações fora de escopo', () => {
    const expectedScope = ['src/routes.ts', 'src/controllers/user.ts'];

    // 1. Modificações em .agents/ são governança permitida
    const diffWithGovernance = validateSurgicalDiff(
      ['src/routes.ts', '.agents/skills/karpathy-guidelines/SKILL.md', '.agents/rules/custom.md'],
      expectedScope
    );
    assert.equal(diffWithGovernance.isSurgical, true);
    assert.equal(diffWithGovernance.unrelatedFiles.length, 0);

    // 2. Modificações em .ai-dev-hub/ são governança permitida
    const diffWithHubGovernance = validateSurgicalDiff(
      ['src/routes.ts', '.ai-dev-hub/skills/karpathy-guidelines-skill.md', '.ai-dev-hub/tasks.md'],
      expectedScope
    );
    assert.equal(diffWithHubGovernance.isSurgical, true);
    assert.equal(diffWithHubGovernance.unrelatedFiles.length, 0);

    // 3. Arquivo de código fora do escopo deve ser reprovado com diagnóstico explícito
    const diffOutOfScope = validateSurgicalDiff(
      ['src/routes.ts', 'src/unrelatedService.ts', 'package.json'],
      expectedScope
    );
    assert.equal(diffOutOfScope.isSurgical, false);
    assert.equal(diffOutOfScope.unrelatedFiles.length, 2);
    assert.ok(diffOutOfScope.explanation.includes('fora do escopo esperado'));
    assert.ok(diffOutOfScope.explanation.includes('src/unrelatedService.ts'));
    assert.ok(diffOutOfScope.explanation.includes('package.json'));
    assert.ok(diffOutOfScope.explanation.includes('Escopo esperado: [src/routes.ts, src/controllers/user.ts]'));
  });

  await t.test('5. MetaChatService.ensureDecoHubNativeSkills provisiona na raiz do workspace', () => {
    const workspaceDir = path.join(tmpRoot, 'proj-workspace-root');
    fs.mkdirSync(workspaceDir, { recursive: true });

    MetaChatService.ensureDecoHubNativeSkills(workspaceDir);

    const nativeSkill = path.join(workspaceDir, '.agents', 'skills', 'karpathy-guidelines', 'SKILL.md');
    assert.ok(fs.existsSync(nativeSkill), 'SKILL.md nativo deve ser provisionado no workspace');
    const content = fs.readFileSync(nativeSkill, 'utf-8');
    assert.ok(content.startsWith('---\nname: karpathy-guidelines'));
    assert.ok(content.includes('Contextual Calibration (Interactive vs. Autonomous Execution)'));

    const examplesFile = path.join(workspaceDir, '.agents', 'skills', 'karpathy-guidelines', 'examples', 'EXAMPLES.md');
    assert.ok(fs.existsSync(examplesFile), 'examples/EXAMPLES.md deve ser provisionado no workspace');
  });
});
