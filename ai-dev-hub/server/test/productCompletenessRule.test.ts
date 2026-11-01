import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PromptArchitectureService } from '../src/promptArchitectureService.js';
import { MetaChatService } from '../src/metaChatService.js';

describe('Regra Inviolável de Completude Funcional de Produto (No Passive Dashboards)', () => {
  test('1. SystemPrompt/PROMPT_INICIAL_PLANEJAMENTO.md existe e contém a regra com os 4 pilares', () => {
    const promptPath = PromptArchitectureService.getInitialPlanningPromptPath();
    assert.ok(fs.existsSync(promptPath), `Arquivo de prompt inicial deve existir em: ${promptPath}`);

    const content = PromptArchitectureService.loadInitialPlanningPrompt();
    assert.ok(content.length > 500, 'Conteúdo do prompt deve ser carregado com sucesso');

    // Validar título da regra
    assert.match(
      content,
      /REGRA INVIOLÁVEL DE COMPLETUDE FUNCIONAL DE PRODUTO \(NO PASSIVE DASHBOARDS\)/i,
      'Deve conter o título da regra inviolável'
    );

    // Validar proibição de dashboards passivos
    assert.match(
      content,
      /É estritamente proibido aprovar ou gerar planos que entreguem apenas dashboards com contadores passivos/i,
      'Deve conter proibição explícita de dashboards passivos'
    );

    // Validar os 4 pilares operacionais
    assert.match(content, /Pilar de Ingestão & Webhook Studio/i, 'Deve conter Pilar 1: Webhook Studio');
    assert.match(content, /botão de copiar/i, 'Deve citar botão de copiar URL de webhook');
    assert.match(content, /Simulador integrado com 1 clique/i, 'Deve citar simulador integrado com 1 clique');

    assert.match(content, /Pilar de Configuração de Mensagens \/ Conteúdo \(Templates\)/i, 'Deve conter Pilar 2: Templates');
    assert.match(content, /\{nome\}, \{produto\}, \{pix\}, \{link\}/i, 'Deve citar variáveis dinâmicas obrigatórias');

    assert.match(content, /Pilar de Execução Direta \(Disparador Operacional\)/i, 'Deve conter Pilar 3: Disparador');
    assert.match(content, /Enviar Agora \/ Disparo Rápido/i, 'Deve citar Enviar Agora / Disparo Rápido manual');

    assert.match(content, /Pilar de Monitoramento & Auditoria \(Fila & Logs\)/i, 'Deve conter Pilar 4: Fila & Logs');
    assert.match(content, /Pendente, Enviado, Falha, Retentativa/i, 'Deve citar status da fila de envio');

    // Validar mandato de rejeição pelo Reviewer
    assert.match(
      content,
      /Qualquer planejamento que omita o Disparador Manual, o Editor de Templates ou o Simulador de Webhooks é considerado INCOMPLETO e deve ser rejeitado pelo Reviewer/i,
      'Deve citar rejeição mandatória pelo Reviewer'
    );
  });

  test('2. PromptArchitectureService.SUPERVISOR_CORE_RULES injeta a regra nos invariantes permanentes', () => {
    const rules = PromptArchitectureService.SUPERVISOR_CORE_RULES;
    assert.ok(rules.includes('REGRA INVIOLÁVEL DE COMPLETUDE FUNCIONAL DE PRODUTO (NO PASSIVE DASHBOARDS)'));
    assert.ok(rules.includes('Ingestão & Webhook Studio'));
    assert.ok(rules.includes('Configuração de Mensagens / Conteúdo'));
    assert.ok(rules.includes('Execução Direta / Disparador Operacional'));
    assert.ok(rules.includes('Monitoramento & Auditoria'));
    assert.ok(rules.includes('{nome}, {produto}, {pix}, {link}'));
    assert.ok(rules.includes('Enviar Agora / Disparo Rápido'));
  });

  test('3. buildSupervisorPrompt injeta o invariante nos modos INITIAL_PLAN e TASK_REVIEW', () => {
    // 3.1 INITIAL_PLAN
    const initialPlanRes = PromptArchitectureService.buildSupervisorPrompt({
      mode: 'INITIAL_PLAN',
      projectId: 'proj-completeness-1',
      projectName: 'WhatsApp Automator',
      projectPath: '/dummy/whatsapp-automator',
      projectObjective: 'Sistema de automação de entregas via WhatsApp e Cakto',
      briefing: 'Criar automação de entrega pós-venda conectada à Cakto via webhooks e WhatsApp Baileys.'
    });

    assert.ok(initialPlanRes.prompt.includes('REGRA INVIOLÁVEL DE COMPLETUDE FUNCIONAL DE PRODUTO (NO PASSIVE DASHBOARDS)'));
    assert.ok(initialPlanRes.prompt.includes('Webhook Studio (URL visível + simulador 1-clique)'));
    assert.ok(initialPlanRes.prompt.includes('Disparador Operacional Manual'));

    // 3.2 TASK_REVIEW
    const taskReviewRes = PromptArchitectureService.buildSupervisorPrompt({
      mode: 'TASK_REVIEW',
      projectId: 'proj-completeness-1',
      projectName: 'WhatsApp Automator',
      projectPath: '/dummy/whatsapp-automator',
      projectObjective: 'Sistema de automação de entregas',
      task: {
        id: 'task-1',
        title: 'Criar dashboard de envio'
      }
    });

    assert.ok(taskReviewRes.prompt.includes('GATE SUCCESS AUDITOR (Anti-Slop, Rota Raiz & Completude Funcional)'));
    assert.ok(taskReviewRes.prompt.includes('REGRA DE COMPLETUDE FUNCIONAL DE PRODUTO'));
  });

  test('4. MetaChatService.buildSupervisorPlanningPrompt inclui a regra inviolável de completude', () => {
    const planningPrompt = MetaChatService.buildSupervisorPlanningPrompt({
      userContent: 'Criar sistema de recuperação de carrinho abandonado com WhatsApp',
      root: '/dummy/root',
      canonicalModelName: 'gemini-3.8-pro',
      intelligenceLevel: 'HIGH'
    });

    assert.ok(planningPrompt.includes('REGRA INVIOLÁVEL DE COMPLETUDE FUNCIONAL DE PRODUTO (NO PASSIVE DASHBOARDS)'));
    assert.ok(planningPrompt.includes('Webhook Studio'));
    assert.ok(planningPrompt.includes('Disparador Manual'));
  });
});
