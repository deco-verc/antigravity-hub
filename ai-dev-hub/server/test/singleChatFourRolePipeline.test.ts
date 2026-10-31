import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { META_CHAT_STATUS, MetaChatService } from '../src/metaChatService.js';
import { PromptArchitectureService } from '../src/promptArchitectureService.js';

describe('DecoHUB Single-Chat 4-Role Pipeline Architecture', () => {
  it('1. should define all 4 new timeline status codes in META_CHAT_STATUS', () => {
    assert.equal(META_CHAT_STATUS.STATUS_FACADE_RECEIVED, 'STATUS_FACADE_RECEIVED');
    assert.equal(META_CHAT_STATUS.STATUS_SUPERVISOR_PLANNING, 'STATUS_SUPERVISOR_PLANNING');
    assert.equal(META_CHAT_STATUS.STATUS_WORKER_EXECUTING, 'STATUS_WORKER_EXECUTING');
    assert.equal(META_CHAT_STATUS.STATUS_REVIEWER_AUDITING, 'STATUS_REVIEWER_AUDITING');

    // Backward compatibility statuses are preserved
    assert.equal(META_CHAT_STATUS.STATUS_ANALYZING_PROJECT, 'STATUS_ANALYZING_PROJECT');
    assert.equal(META_CHAT_STATUS.STATUS_EXECUTING_STAGE, 'STATUS_EXECUTING_STAGE');
    assert.equal(META_CHAT_STATUS.STATUS_RUNNING_TYPECHECK, 'STATUS_RUNNING_TYPECHECK');
    assert.equal(META_CHAT_STATUS.STATUS_RUNNING_TESTS, 'STATUS_RUNNING_TESTS');
    assert.equal(META_CHAT_STATUS.STATUS_SYNCING_PRODUCTION, 'STATUS_SYNCING_PRODUCTION');
  });

  it('2. should have master prompt documentation PROMPT_ARQUITETURA_4_PAPEIS.md', () => {
    const candidatePaths = [
      path.resolve(process.cwd(), 'SystemPrompt/PROMPT_ARQUITETURA_4_PAPEIS.md'),
      path.resolve(process.cwd(), '../SystemPrompt/PROMPT_ARQUITETURA_4_PAPEIS.md'),
      path.resolve(process.cwd(), 'prompts/gemini/PROMPT_ARQUITETURA_4_PAPEIS.md'),
      path.resolve(process.cwd(), '../prompts/gemini/PROMPT_ARQUITETURA_4_PAPEIS.md')
    ];
    const docPath = candidatePaths.find(p => fs.existsSync(p));
    assert.ok(docPath && fs.existsSync(docPath), 'SystemPrompt/PROMPT_ARQUITETURA_4_PAPEIS.md must exist');
    const content = fs.readFileSync(docPath, 'utf-8');

    assert.ok(content.includes('PAPEL 1: CHAT FACADE'), 'Must detail Chat Facade');
    assert.ok(content.includes('PAPEL 2: SUPERVISOR'), 'Must detail Supervisor');
    assert.ok(content.includes('PAPEL 3: WORKER'), 'Must detail Worker');
    assert.ok(content.includes('PAPEL 4: REVIEWER'), 'Must detail Reviewer');
    assert.ok(content.includes('[VEREDICTO: APROVADO]'), 'Must include approved verdict');
    assert.ok(content.includes('[VEREDICTO: REJEITADO]'), 'Must include rejected verdict');
    assert.ok(content.includes('Protocolo de Execução em Turno Único (Trace Format)'), 'Must include trace format');
  });

  it('3. should inject 4-role pipeline into buildMetaChatPrompt for both modes', () => {
    const briefingPrompt = MetaChatService.buildMetaChatPrompt({
      mode: 'ANALYTICAL_BRIEFING',
      root: 'C:/IA/Antigravity HUB/ai-dev-hub',
      userQueryOrMission: 'Como funciona a arquitetura do hub?',
      intelligenceLevel: 'HIGH',
      canonicalModelName: 'Gemini 3.8 Pro',
      requestedModel: 'gemini-3.8-pro'
    });

    assert.ok(briefingPrompt.includes('<single_chat_4_role_pipeline>'), 'Briefing prompt must have 4-role pipeline tag');
    assert.ok(briefingPrompt.includes('PAPEL 1: CHAT FACADE'), 'Briefing prompt must define Chat Facade');
    assert.ok(briefingPrompt.includes('PAPEL 2: SUPERVISOR'), 'Briefing prompt must define Supervisor');
    assert.ok(briefingPrompt.includes('PAPEL 3: WORKER'), 'Briefing prompt must define Worker');
    assert.ok(briefingPrompt.includes('PAPEL 4: REVIEWER'), 'Briefing prompt must define Reviewer');
    assert.ok(briefingPrompt.includes('[CHAT FACADE]'), 'Briefing prompt must mention trace tag');

    const evolutionPrompt = MetaChatService.buildMetaChatPrompt({
      mode: 'AUTONOMOUS_EVOLUTION',
      root: 'C:/IA/Antigravity HUB/ai-dev-hub',
      userQueryOrMission: 'Implementar novo endpoint de métricas',
      intelligenceLevel: 'MAX',
      canonicalModelName: 'Gemini 3.8 Pro',
      requestedModel: 'gemini-3.8-pro'
    });

    assert.ok(evolutionPrompt.includes('<single_chat_4_role_pipeline>'), 'Evolution prompt must have 4-role pipeline tag');
    assert.ok(evolutionPrompt.includes('[VEREDICTO: APROVADO]'), 'Evolution prompt must mention verdict');
  });

  it('4. should reference 4-role pipeline in Supervisor and Worker core rules', () => {
    assert.ok(
      PromptArchitectureService.SUPERVISOR_CORE_RULES.includes('ARQUITETURA UNIFICADA EM 4 PAPÉIS'),
      'Supervisor core rules must mandate 4-role pipeline'
    );
    assert.ok(
      PromptArchitectureService.WORKER_CORE_RULES.includes('PROTOCOLO 4 PAPÉIS (WORKER HANDOFF)'),
      'Worker core rules must mandate worker handoff protocol'
    );
  });

  it('5. should cleanly parse single-turn 4-role response trace into role segments', () => {
    const mockAgentResponse = `
[CHAT FACADE]
Entendido. Vamos atualizar o módulo de autenticação. Iniciando ciclo de engenharia.

[SUPERVISOR]
- Contexto analisado: server/src/auth.ts
- DAG cirúrgico:
  1. Adicionar hash de token
  2. Atualizar rota POST /api/login
- Critério de aceite: tsc --noEmit && npm test

[WORKER]
- Alterações realizadas em: \`server/src/auth.ts\`
- Comandos executados: \`npm test test/auth.test.ts\`
- Evidências: PASS (0 falhas)
- Entregando ao REVIEWER.

[REVIEWER]
- Checagem TypeScript: 0 erros de tipagem (tsc --noEmit OK).
- Auditoria de Qualidade: Sem violações de contrato ou anti-slop.
- [VEREDICTO: APROVADO]

[CHAT FACADE]
Módulo de autenticação atualizado e verificado com sucesso!
- Arquivos modificados: \`server/src/auth.ts\`
- Testes: Aprovados (0 erros de tipagem).
`;

    // Parser logic (mirrored from client parse4RoleTrace)
    const roleBlockRegex = /\[(CHAT FACADE|SUPERVISOR|WORKER|REVIEWER)\]([\s\S]*?)(?=\[(?:CHAT FACADE|SUPERVISOR|WORKER|REVIEWER)\]|$)/gi;
    const chatFacadeParts: string[] = [];
    let supervisor = '';
    let worker = '';
    let reviewer = '';

    let match: RegExpExecArray | null;
    while ((match = roleBlockRegex.exec(mockAgentResponse)) !== null) {
      const tag = match[1].toUpperCase();
      const body = match[2].trim();
      if (tag === 'CHAT FACADE') {
        if (body) chatFacadeParts.push(body);
      } else if (tag === 'SUPERVISOR') {
        supervisor = (supervisor ? supervisor + '\n\n' : '') + body;
      } else if (tag === 'WORKER') {
        worker = (worker ? worker + '\n\n' : '') + body;
      } else if (tag === 'REVIEWER') {
        reviewer = (reviewer ? reviewer + '\n\n' : '') + body;
      }
    }

    assert.ok(chatFacadeParts.length >= 2, 'Should capture both opening and closing Chat Facade messages');
    assert.ok(chatFacadeParts[0].includes('Entendido. Vamos atualizar o módulo de autenticação.'));
    assert.ok(chatFacadeParts[1].includes('Módulo de autenticação atualizado e verificado com sucesso!'));

    assert.ok(supervisor.includes('DAG cirúrgico:'), 'Supervisor section extracted');
    assert.ok(worker.includes('Evidências: PASS'), 'Worker section extracted');
    assert.ok(reviewer.includes('[VEREDICTO: APROVADO]'), 'Reviewer section extracted');
  });
});
