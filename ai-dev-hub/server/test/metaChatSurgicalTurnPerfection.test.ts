import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { observeTranscript, isIntermediateTransitionText } from '../src/agentTurnState.js';
import { MetaChatService } from '../src/metaChatService.js';

describe('MetaChat Surgical Turn Perfection & Clean Output Verification', () => {
  it('1.1 isIntermediateTransitionText correctly detects short transitional model responses', () => {
    assert.equal(isIntermediateTransitionText('Vou analisar os seguintes arquivos:'), true);
    assert.equal(isIntermediateTransitionText('Iniciando inspeção do arquivo:'), true);
    assert.equal(isIntermediateTransitionText('Vamos verificar o código agora'), true);
    assert.equal(isIntermediateTransitionText('Aqui estão as modificações necessárias:\n\n1. Passo 1\n2. Passo 2'), false);
    assert.equal(isIntermediateTransitionText('Implementação concluída com sucesso no arquivo server/src/service.ts.'), false);
  });

  it('1.2 observeTranscript keeps state as RUNNING for intermediate transition responses', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-trans-test-'));
    const transcriptFile = path.join(tmpDir, 'transcript.jsonl');

    const lines = [
      JSON.stringify({ step_index: 0, type: 'USER_INPUT', content: 'Corrija o bug no serviço' }),
      JSON.stringify({
        step_index: 1,
        type: 'PLANNER_RESPONSE',
        content: 'Vou analisar os arquivos antes de editar:',
        tool_calls: []
      })
    ];
    fs.writeFileSync(transcriptFile, lines.join('\n') + '\n', 'utf-8');

    const result = observeTranscript(transcriptFile, 0);
    assert.equal(result.state, 'RUNNING', 'Resposta intermediária com ":" não deve fechar o turno prematuramente');
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('2.1 diffFileBaseline isolates strictly the modified file without repository contamination', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-repo-test-'));
    const fileA = path.join(tmpDir, 'serviceA.ts');
    const fileB = path.join(tmpDir, 'serviceB.ts');
    const dirtyFile = path.join(tmpDir, 'dirtyLegacy.ts');
    const ignoredSummary = path.join(tmpDir, '.ai-dev-hub', 'session-summary.md');
    const distFile = path.join(tmpDir, 'dist', 'bundle.js');

    fs.mkdirSync(path.join(tmpDir, '.ai-dev-hub'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'dist'), { recursive: true });

    fs.writeFileSync(fileA, 'export const A = 1;\n', 'utf-8');
    fs.writeFileSync(fileB, 'export const B = 1;\n', 'utf-8');
    fs.writeFileSync(dirtyFile, 'export const Dirty = "legacy dirty";\n', 'utf-8');
    fs.writeFileSync(ignoredSummary, '# Session Summary\n', 'utf-8');
    fs.writeFileSync(distFile, 'console.log("dist");\n', 'utf-8');

    // Baseline before turn
    const baselineBefore = MetaChatService.captureFileBaseline(tmpDir);

    // Turn modifies ONLY fileA
    fs.writeFileSync(fileA, 'export const A = 2; // modified in turn\n', 'utf-8');
    // Also modifies internal summary and dist file
    fs.writeFileSync(ignoredSummary, '# Session Summary Updated\n', 'utf-8');
    fs.writeFileSync(distFile, 'console.log("dist updated");\n', 'utf-8');

    const changed = MetaChatService.diffFileBaseline(tmpDir, baselineBefore);

    assert.equal(changed.length, 1, 'Deve reportar estritamente 1 arquivo modificado');
    assert.equal(changed[0], 'serviceA.ts');
    assert.ok(!changed.includes('dirtyLegacy.ts'), 'Não deve incluir arquivos já sujos do workspace');
    assert.ok(!changed.includes('.ai-dev-hub/session-summary.md'), 'Não deve incluir session-summary');
    assert.ok(!changed.includes('dist/bundle.js'), 'Não deve incluir artefatos da pasta dist');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('3.1 sanitizeAgentOutput scrubs binary buffer noise, decompression logs, and ANSI frames', () => {
    const dirtyInput = [
      'Decompressed: <Buffer 1f 8b 08 00 00 00 00 00 00 03 ed bd 07 60 1c 49 96 25 26 2f 6d ca 7b 7f 4e f5 4c d7 94 92 4d 1a 07 48 5e 6e 4a 52 38 78 88 4a 41 82 25 10>',
      '\u001b[32mSucesso na compilação\u001b[39m',
      '<Buffer 48 65 6c 6c 6f>',
      'O serviço foi atualizado cirurgicamente com novos tipos.',
      '[PROTOCOL]: frame 12 ACK'
    ].join('\n');

    const cleaned = MetaChatService.sanitizeAgentOutput(dirtyInput);

    assert.ok(!cleaned.includes('Decompressed:'), 'Must scrub Decompressed: <Buffer ...>');
    assert.ok(!cleaned.includes('<Buffer'), 'Must scrub <Buffer ...>');
    assert.ok(!cleaned.includes('\u001b['), 'Must scrub ANSI frames');
    assert.ok(!cleaned.includes('[PROTOCOL]'), 'Must scrub protocol frame noise');
    assert.ok(cleaned.includes('Sucesso na compilação'), 'Must preserve valid content');
    assert.ok(cleaned.includes('O serviço foi atualizado cirurgicamente'), 'Must preserve technical report');
  });

  it('3.2 formatFourRoleDeliveryReport presents dynamic Facade and clean Worker actions without Decompressed buffers', () => {
    const rawWorkerOutput = [
      'Decompressed: <Buffer 1f 8b 08 00 00 00 00 00>',
      'Implementei a correção cirúrgica no arquivo server/src/metaChatService.ts.'
    ].join('\n');

    const plan = {
      scopeFiles: ['server/src/metaChatService.ts'],
      dagSteps: ['Mapeamento', 'Edição cirúrgica', 'Auditoria'],
      verificationCommand: 'npm --prefix server run typecheck',
      planningDurationMs: 30,
      source: 'offline_ast_inference' as const
    };

    const liveSteps = [
      {
        id: 'step-1',
        type: 'READ' as const,
        target: 'server/src/metaChatService.ts',
        status: 'done' as const,
        timestamp: new Date().toISOString(),
        details: 'Analisou o arquivo de serviço'
      },
      {
        id: 'step-2',
        type: 'EDIT' as const,
        target: 'server/src/metaChatService.ts',
        status: 'done' as const,
        timestamp: new Date().toISOString(),
        details: 'Editou método de entrega'
      }
    ];

    const report = MetaChatService.formatFourRoleDeliveryReport(
      rawWorkerOutput,
      plan,
      ['server/src/metaChatService.ts'],
      { passed: true },
      ' 1 file changed, 10 insertions(+)',
      undefined,
      liveSteps,
      true
    );

    assert.ok(!report.includes('Decompressed:'), 'Worker delivery report must NEVER contain Decompressed: <Buffer ...>');
    assert.ok(report.includes('### 1. Chat Facade'), 'Must include Chat Facade header');
    assert.ok(report.includes('Alterações cirúrgicas implementadas em `server/src/metaChatService.ts`'), 'Facade must describe real changes');
    assert.ok(report.includes('Validada com sucesso nos 4 portões de integridade'), 'Facade must confirm 4 gates passed');
    assert.ok(report.includes('✏️ Editou: `server/src/metaChatService.ts`'), 'Worker must display real actions executed');
    assert.ok(report.includes('🔍 Analisou: `server/src/metaChatService.ts`'), 'Worker must display read steps');
    assert.ok(report.includes('[VEREDICTO: APROVADO]'), 'Must include approved verdict');
  });

  it('4.1 formatFourRoleDeliveryReport marks APROVADO COM RESSALVAS when client build fails', () => {
    const plan = {
      scopeFiles: ['client/src/components/FourRoleTimeline.tsx'],
      dagSteps: ['Edição', 'Build'],
      verificationCommand: 'npm --prefix client run build',
      planningDurationMs: 25,
      source: 'offline_ast_inference' as const
    };

    const report = MetaChatService.formatFourRoleDeliveryReport(
      'Worker editou o componente.',
      plan,
      ['client/src/components/FourRoleTimeline.tsx'],
      { passed: true },
      ' 1 file changed, 5 insertions(+)',
      undefined,
      undefined,
      false // clientBuildPassed === false
    );

    assert.ok(
      report.includes('[VEREDICTO: APROVADO COM RESSALVAS (BUILD PENDENTE)]'),
      'Must report APROVADO COM RESSALVAS when client build fails'
    );
    assert.ok(
      !report.includes('[APROVADO PARA PRODUÇÃO]'),
      'Must NOT report APROVADO PARA PRODUÇÃO when client build fails'
    );
  });
});
