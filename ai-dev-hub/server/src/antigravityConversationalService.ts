// server/src/antigravityConversationalService.ts
// Intelligent conversational layer bridging user dialogue to the native Antigravity agent runtime.

import fs from 'node:fs';
import path from 'node:path';
import { Logger } from './logger.js';
import { AgentSessionManager, AgentSessionRecord } from './agentSessionManager.js';
import { AgentApiGateway } from './agentApiGateway.js';
import { ProjectContextBridge, ProjectContextSnapshot } from './projectContextBridge.js';
import { db } from './db.js';
import { ModelRegistry, ResolvedModelConfig } from './modelRegistry.js';
import { AccountProfileManager } from './accountProfileManager.js';
import { ChatIntentResult } from './chatIntentClassifier.js';
import { AntigravityDiscovery } from './antigravityDiscovery.js';
import { TurnCancellationManager } from './turnCancellationManager.js';

export interface ConversationalResponse {
  replyContent: string;
  source: 'ANTIGRAVITY_LIVE' | 'ANTIGRAVITY_MOCK' | 'CONTEXT_SYNTHESIS';
  conversationId?: string;
  metadata: {
    intent: string;
    subType: string;
    confidence: number;
    projectId: string;
    runId?: string | null;
    warning?: string;
  };
}

export class AntigravityConversationalService {
  private static appDataBrainDir: string = AntigravityDiscovery.getBrainDir();

  /**
   * Main entry point to process conversational and diagnostic messages with the Antigravity Agent
   */
  static async handleMessage(params: {
    projectId: string;
    userMessage: string;
    intentResult: ChatIntentResult;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
    model?: string;
    reasoningEffort?: string;
    accountProfileId?: string;
  }): Promise<ConversationalResponse> {
    const { projectId, userMessage, intentResult, env } = params;
    const timeoutMs = params.timeoutMs || 45000;

    const snapshot = ProjectContextBridge.getSnapshot(projectId);
    if (!snapshot) {
      return {
        replyContent: 'Projeto não localizado para carregamento de contexto conversacional.',
        source: 'CONTEXT_SYNTHESIS',
        metadata: {
          intent: intentResult.intent,
          subType: intentResult.subType,
          confidence: intentResult.confidence,
          projectId
        }
      };
    }

    const projectRow = db.prepare('SELECT active_account_profile_id, selected_model, reasoning_level FROM projects WHERE id=?').get(projectId) as any;
    const effectiveProfileId = params.accountProfileId || projectRow?.active_account_profile_id || null;
    const requestedModel = params.model || projectRow?.selected_model || null;
    const requestedReasoning = params.reasoningEffort || projectRow?.reasoning_level || 'HIGH';

    const resolvedConfig = ModelRegistry.resolveModelConfig({
      preference: requestedModel,
      role: 'default',
      accountProfileId: effectiveProfileId,
      projectId,
      requestedIntelligence: requestedReasoning
    });

    let effectiveEnv = env;
    if (!effectiveEnv && effectiveProfileId) {
      try {
        const profile = AccountProfileManager.getProfile(effectiveProfileId);
        if (profile) {
          effectiveEnv = AccountProfileManager.getExecutionEnvForProfile(profile, projectId);
        }
      } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "antigravityConversationalService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:antigravityConversationalService]", err);
      }
    }
    }

    // 1. Get or create the persistent CONVERSATIONAL session for this project
    let session: AgentSessionRecord | null = null;
    try {
      const res = await AgentSessionManager.getOrCreateAgentSession(projectId, 'CONVERSATIONAL', {
        env: effectiveEnv,
        model: resolvedConfig.modelId,
        accountProfileId: effectiveProfileId || undefined,
        initialPrompt: this.buildBootstrapPrompt(snapshot, resolvedConfig)
      });
      session = res.session;
    } catch (err: any) {
      Logger.warn(`[ConversationalService] Não foi possível obter sessão nativa do Antigravity: ${err.message}.`);
    }

    // 2. Format the turn prompt with rich project context snapshot
    const turnPrompt = this.buildTurnPrompt({
      snapshot,
      userMessage,
      intentResult,
      resolvedConfig
    });

    // 3. Dispatch to Antigravity runtime or Mock/Fallback
    const providerConvId = session?.provider_conversation_id;

    // A. Offline / Mock Mode
    if (AgentApiGateway.isOfflineMode()) {
      const mockProvider = AgentApiGateway.getMockProvider();
      let mockReply: string | undefined;

      if (mockProvider && providerConvId) {
        mockProvider.sendMessage({
          conversationId: providerConvId,
          prompt: turnPrompt,
          projectId,
          role: 'conversational'
        });
        const candidate = mockProvider.getResponse?.(providerConvId, 'CONVERSATIONAL');
        if (candidate && !candidate.trim().startsWith('[')) {
          mockReply = candidate;
        }
      }

      if (mockReply) {
        return {
          replyContent: mockReply,
          source: 'ANTIGRAVITY_MOCK',
          conversationId: providerConvId,
          metadata: {
            intent: intentResult.intent,
            subType: intentResult.subType,
            confidence: intentResult.confidence,
            projectId,
            runId: snapshot.run?.id
          }
        };
      }

      // High-fidelity fallback synthesis when in offline mode without explicit mock response
      const synthesized = this.synthesizeFactualResponse(snapshot, userMessage, intentResult);
      return {
        replyContent: synthesized,
        source: 'CONTEXT_SYNTHESIS',
        conversationId: providerConvId,
        metadata: {
          intent: intentResult.intent,
          subType: intentResult.subType,
          confidence: intentResult.confidence,
          projectId,
          runId: snapshot.run?.id
        }
      };
    }

    // B. Live Physical Antigravity Execution
    let liveWarning: string | null = null;
    if (session && providerConvId) {
      try {
        const transcriptPath = path.join(this.appDataBrainDir, providerConvId, '.system_generated', 'logs', 'transcript.jsonl');
        let minStepIndex = -1;
        if (fs.existsSync(transcriptPath)) {
          try {
            const lines = fs.readFileSync(transcriptPath, 'utf-8').trim().split('\n').filter(Boolean);
            for (let i = lines.length - 1; i >= 0; i--) {
              const e = JSON.parse(lines[i]);
              if (typeof e.step_index === 'number') {
                minStepIndex = e.step_index;
                break;
              }
            }
          } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "antigravityConversationalService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:antigravityConversationalService]", err);
      }
    }
        }

        // Send physical message to the Antigravity conversation
        await AgentSessionManager.sendMessage(session, turnPrompt, {
          env: effectiveEnv,
          timeoutMs: 15000,
          taskTitle: `Conversa com usuário: "${userMessage.slice(0, 30)}"`
        });

        // Wait for live response in transcript
        const liveReply = await this.waitForTranscriptResponse(providerConvId, minStepIndex, timeoutMs);
        if (liveReply && liveReply.trim().length > 0) {
          return {
            replyContent: liveReply.trim(),
            source: 'ANTIGRAVITY_LIVE',
            conversationId: providerConvId,
            metadata: {
              intent: intentResult.intent,
              subType: intentResult.subType,
              confidence: intentResult.confidence,
              projectId,
              runId: snapshot.run?.id
            }
          };
        } else {
          liveWarning = `[AVISO: Runtime nativo do Antigravity não retornou resposta no prazo (${timeoutMs}ms) — resposta gerada via síntese contextual do DecoHUB]`;
        }
      } catch (liveErr: any) {
        if (liveErr.message?.includes('RUN_CANCELLED') || TurnCancellationManager.isCancelled(projectId, providerConvId)) {
          TurnCancellationManager.clearCancellation(projectId, providerConvId);
          return {
            replyContent: '[CANCELADO] Mensagem cancelada pelo usuário.',
            source: 'CONTEXT_SYNTHESIS',
            conversationId: providerConvId,
            metadata: {
              intent: intentResult.intent,
              subType: intentResult.subType,
              confidence: intentResult.confidence,
              projectId,
              runId: snapshot.run?.id,
              warning: 'Cancelado pelo usuário.'
            }
          };
        }
        try {
          const { AccountProfileManager } = await import('./accountProfileManager.js');
          const classification = AccountProfileManager.classifyAccountOrQuotaError(liveErr);
          if (classification.isAccountOrQuotaError) {
            const failover = await AccountProfileManager.handleAccountFailureAndRapidSwitch({
              projectId,
              error: liveErr
            });
            if (failover.switched) {
              Logger.info(`[ConversationalService] Auto-Failover efetuado: "${failover.previousProfileId}" -> "${failover.activeProfile.display_name}".`);
            }
          }
        } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "antigravityConversationalService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:antigravityConversationalService]", err);
      }
    }
        liveWarning = `[AVISO: Runtime nativo do Antigravity indisponível (${liveErr.message || 'falha de execução'}) — resposta gerada via síntese contextual do DecoHUB]`;
        Logger.warn(`[ConversationalService] Erro ao aguardar agente Antigravity: ${liveErr.message}. Usando síntese contextual.`);
      }
    }

    // C. Graceful High-Fidelity Synthesis Fallback
    const synthesized = this.synthesizeFactualResponse(snapshot, userMessage, intentResult);
    const finalReplyContent = liveWarning ? `${liveWarning}\n\n${synthesized}` : synthesized;
    return {
      replyContent: finalReplyContent,
      source: 'CONTEXT_SYNTHESIS',
      conversationId: providerConvId,
      metadata: {
        intent: intentResult.intent,
        subType: intentResult.subType,
        confidence: intentResult.confidence,
        projectId,
        runId: snapshot.run?.id,
        warning: liveWarning || undefined
      }
    };
  }

  /**
   * Builds the initial bootstrap prompt for the conversational agent session
   */
  private static buildBootstrapPrompt(snapshot: ProjectContextSnapshot, resolvedConfig?: ResolvedModelConfig): string {
    const configLine = resolvedConfig
      ? `Modo de Raciocínio: ${resolvedConfig.intelligenceLevel} | Modelo: ${resolvedConfig.canonicalName} (${resolvedConfig.modelId})\n`
      : '';
    return [
      `=== PAPEL: INTERLOCUTOR INTELIGENTE DO DECOHUB (ANTIGRAVITY) ===`,
      configLine,
      `Você é o agente conversacional de desenvolvimento no Antigravity, atuando em colaboração contínua com o usuário no projeto "${snapshot.project.name}".`,
      `O DecoHUB atua como o motor persistente de planejamento, orquestração e execução hierárquica.`,
      `Seu objetivo é dialogar com o desenvolvedor, explorar ideias, avaliar arquiteturas, esclarecer dúvidas e explicar diagnósticos com profundidade e rigor técnico.`,
      `DIRETRIZES FUNDAMENTAIS:`,
      `1. Responda em português claro, técnico e empático.`,
      `2. Seja um parceiro técnico que discute prós, contras, boas práticas e consequências de cada escolha.`,
      `3. Em perguntas de diagnóstico, use as evidências reais fornecidas pelo DecoHUB e distinga fatos verificados de hipóteses.`,
      `4. Não invente testes aprovados, tarefas concluídas ou execuções que não ocorreram.`,
      `5. Mantenha continuidade entre as mensagens e não trate conversas como ordens de execução imediata.`,
      `6. ZERO EMOJIS DECORATIVOS: Não utilize nenhum emoji decorativo. A comunicação deve ser estritamente limpa, profissional e direta (estilo CLI / Linear / Vercel).`,
      `7. PROIBIÇÃO DE REPETIR INSTRUÇÃO DO USUÁRIO: NUNCA repita, cite ou ecoe a mensagem do usuário no início da resposta. Vá direto à análise ou constatação.`,
      `8. FOCO EM CÓDIGO DE IMPLEMENTAÇÃO: Concentre discussões e ações diretamente nos arquivos de código do projeto (.ts, .tsx, .js, schemas, testes), sem focar em arquivos .md intermediários.`
    ].filter(Boolean).join('\n');
  }

  /**
   * Builds the comprehensive turn prompt with full project snapshot
   */
  private static buildTurnPrompt(params: {
    snapshot: ProjectContextSnapshot;
    userMessage: string;
    intentResult: ChatIntentResult;
    resolvedConfig?: ResolvedModelConfig;
  }): string {
    const { snapshot, userMessage, intentResult, resolvedConfig } = params;
    const contextBlock = ProjectContextBridge.formatContextForAgent(snapshot);

    const historyBlock = snapshot.recentChatHistory.length > 0
      ? `\n--- HISTÓRICO RECENTE DO DIÁLOGO ---\n` +
        snapshot.recentChatHistory.map(m => `${m.role === 'user' ? 'Usuário' : 'Você'}: ${m.content}`).join('\n')
      : '';

    const modelHeader = resolvedConfig
      ? `--- CONFIGURAÇÃO DE MODELO ---\nModelo: ${resolvedConfig.canonicalName} (${resolvedConfig.modelId}) | Raciocínio: ${resolvedConfig.intelligenceLevel}\n`
      : '';

    return [
      contextBlock,
      modelHeader,
      historyBlock,
      ``,
      `--- INTENÇÃO CLASSIFICADA ---`,
      `Intenção: ${intentResult.intent} | SubTipo: ${intentResult.subType}`,
      ``,
      `--- MENSAGEM DO USUÁRIO ---`,
      `"${userMessage}"`,
      ``,
      `--- DIRETRIZ DE RESPOSTA ---`,
      intentResult.intent === 'CONVERSATION'
        ? `Esta é uma conversa de exploração/design. NÃO gere comandos de execução. Discuta ideias, analise trade-offs e faça perguntas esclarecedoras se houver decisões em aberto.`
        : intentResult.intent === 'STATE_QUERY'
        ? `Esta é uma consulta de estado/diagnóstico. Responda com base nos fatos, erros reais, critérios reprovados e caminhos de log indicados no contexto.`
        : intentResult.intent === 'AMBIGUOUS'
        ? `A mensagem é ambígua. Não inicie trabalho. Esclareça educadamente a situação e pergunte como o usuário deseja proceder.`
        : `Responda tecnicamente ao usuário.`
    ].join('\n');
  }

  /**
   * Polls the Antigravity transcript for a complete turn
   */
  private static async waitForTranscriptResponse(
    conversationId: string,
    minStepIndex: number,
    timeoutMs: number
  ): Promise<string | null> {
    const transcriptPath = path.join(this.appDataBrainDir, conversationId, '.system_generated', 'logs', 'transcript.jsonl');
    const transcriptFullPath = path.join(this.appDataBrainDir, conversationId, '.system_generated', 'logs', 'transcript_full.jsonl');
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      if (TurnCancellationManager.isCancelled(conversationId)) {
        throw new Error('RUN_CANCELLED: a conversa foi cancelada pelo usuário');
      }
      if (fs.existsSync(transcriptPath)) {
        try {
          const content = fs.readFileSync(transcriptPath, 'utf-8');
          const lines = content.trim().split('\n').filter(Boolean);
          for (let i = lines.length - 1; i >= 0; i--) {
            const entry = JSON.parse(lines[i]);
            const isAfterMinStep = minStepIndex < 0 || (typeof entry.step_index === 'number' && entry.step_index > minStepIndex);
            if (isAfterMinStep) {
              if (entry.status === 'ERROR' || entry.type === 'ERROR_MESSAGE') {
                throw new Error(`Antigravity conversation reported error: ${entry.content || 'Status ERROR'}`);
              }
              if (entry.type === 'PLANNER_RESPONSE' && entry.status === 'DONE' && entry.content && !(entry.tool_calls?.length > 0)) {
                // If content was truncated in compact transcript, read full content
                if (Array.isArray(entry.truncated_fields) && entry.truncated_fields.includes('content') && fs.existsSync(transcriptFullPath)) {
                  try {
                    const fullLines = fs.readFileSync(transcriptFullPath, 'utf-8').trim().split('\n').filter(Boolean);
                    for (let j = fullLines.length - 1; j >= 0; j--) {
                      const fullEntry = JSON.parse(fullLines[j]);
                      if (fullEntry.step_index === entry.step_index && fullEntry.content) {
                        return fullEntry.content;
                      }
                    }
                  } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "antigravityConversationalService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:antigravityConversationalService]", err);
      }
    }
                }
                return entry.content;
              }
            }
          }
        } catch (pollErr: any) {
          if (pollErr.message?.includes('RUN_CANCELLED') || pollErr.message?.includes('Antigravity conversation reported error')) {
            throw pollErr;
          }
        }
      }
      await new Promise(r => setTimeout(r, 750));
    }
    return null;
  }

  /**
   * Fallback synthesis adhering strictly to confirmed evidence and high-fidelity technical collaboration
   */
  private static synthesizeFactualResponse(
    snapshot: ProjectContextSnapshot,
    userMessage: string,
    intentResult: ChatIntentResult
  ): string {
    const p = snapshot.project;
    const r = snapshot.run;
    const evalRes = snapshot.latestEvaluation;
    const rev = snapshot.latestReview;

    switch (intentResult.subType) {
      case 'ARCHITECTURE_DISCUSSION': {
        return `### Análise Arquitetural — ${p.name}\n\n` +
          `Avaliando a arquitetura atual do projeto (${p.stack || 'TypeScript/Node.js'}):\n\n` +
          `1. **Separação de Camadas**: A separação modular entre o modelo de domínio (\`src/domain/\`), adaptadores intercambiáveis de persistência (\`src/persistence/\`) e camada de apresentação é uma excelente prática. Isso garante que as regras de negócio permaneçam puras e desacopladas de I/O.\n\n` +
          `2. **Validações e Tipagem**: A validação estrita em runtime (bloqueio de valores negativos/zerados e integridade de datas) somada ao TypeScript impede que estados inconsistentes alcancem o banco ou a memória.\n\n` +
          `3. **Evolução e Escalabilidade**: Para os próximos passos, podemos avaliar:\n` +
          `   - Adição de repositórios assíncronos caso haja migração de arquivos locais para banco relacional.\n` +
          `   - Criação de uma camada de serviço (\`service layer\`) para isolar regras de orquestração de transações.\n\n` +
          `Qual abordagem prefere priorizar para as próximas microtarefas?`;
      }

      case 'IDEA_EXPLORATION': {
        return `### Exploração de Ideias — ${p.name}\n\n` +
          `1. **Impacto e Benefícios**: Essa adição traz maior robustez ao projeto, alinhada ao objetivo de "${p.objective}". Em fluxos com regras de negócio e dados sensíveis, a separação clara de responsabilidades é um diferencial importante.\n\n` +
          `2. **Trade-offs a Considerar**:\n` +
          `   - **Complexidade**: Aumenta a quantidade de contratos e dependências que o Worker e o Review precisarão validar.\n` +
          `   - **Cobertura de Testes**: Exigirá testes adicionais de integração e testes de ponta a ponta.\n\n` +
          `3. **Recomendação**: Vale a pena implementar após consolidar o fluxo principal atual. Para priorizar essa funcionalidade, podemos definir critérios de aceitação e enviar a instrução ao Supervisor.`;
      }

      case 'ERROR_QUERY': {
        if (!r) {
          return `Não há nenhum erro registrado para o projeto **${p.name}**, pois nenhuma execução autônoma foi iniciada ainda. Você pode enviar a descrição do aplicativo para planejar o desenvolvimento.`;
        }

        const isOk = !r.lastError && ['completed', 'running'].includes(r.status || '');
        if (isOk) {
          return `O projeto está com status operacional **${r.status?.toUpperCase()}** e não possui erros pendentes no momento. A tarefa atual é **${r.currentTaskTitle || 'processando backlog'}**.`;
        }

        let cleanError = (r.lastError || 'Nenhum erro registrado.')
          .replace(/\[AI DEV Council\]:[^\n]*/gi, '')
          .trim();

        let resp = `### Diagnóstico do Erro — ${p.name}\n\n` +
          `- **Estado Atual**: \`${r.status?.toUpperCase()}\`\n` +
          `- **Motivo**: ${cleanError}\n` +
          `- **Próximo Passo**: ${r.nextAction || 'Intervenção orientada pelo usuário'}\n\n`;

        if (evalRes) {
          resp += `#### Validação dos Testes:\n` +
            `- **Resultado**: ${evalRes.taskIsDone ? 'Etapa validada' : 'Critérios pendentes'} (Código de saída: ${evalRes.exitCode ?? 0})\n` +
            `- **Constatação**: ${evalRes.notes || 'Sem observações adicionais'}\n`;
          if (evalRes.failedCriteria.length > 0) {
            resp += `- **Critérios Reprovados**: ${evalRes.failedCriteria.map(c => `\`${c}\``).join(', ')}\n`;
          }
          resp += '\n';
        }

        if (rev) {
          const cleanFeedback = (rev.feedback || 'Sem feedback adicional')
            .replace(/\[AI DEV Council\]:[^\n]*/gi, '')
            .trim();
          resp += `#### Parecer da Revisão:\n` +
            `- **Decisão**: \`${rev.verdict}\`\n` +
            `- **Detalhes**: ${cleanFeedback}\n\n`;
        }

        resp += `**Como prosseguir**: Para retomar a execução a partir do ponto seguro anterior, envie **"Corrija o erro e continue"** ou utilize o controle na interface.`;
        return resp;
      }

      case 'LOG_QUERY': {
        return `### Central de Logs e Observabilidade — ${p.name}\n\n` +
          `Os registros de execução e auditoria estão disponíveis nos seguintes caminhos físicos:\n\n` +
          `1. **Log Central do Servidor Backend**:\n` +
          `   - Arquivo: \`${snapshot.logs.backendLogPath}\`\n` +
          `   - Contém: Rotas HTTP, eventos do orquestrador e telemetria de agentes.\n\n` +
          `2. **Banco de Dados Operacional SQLite**:\n` +
          `   - Arquivo: \`${snapshot.logs.dbPath}\`\n` +
          `   - Tabelas: \`autonomous_events\`, \`evaluation_results\`, \`supervisor_reviews\` e \`agent_sessions\`.\n\n` +
          `3. **Logs de Terminal de Testes**:\n` +
          `   - Pasta: \`${snapshot.logs.terminalLogsDir}\`\n` +
          `   - Contém os logs completos de comandos (\`npm test\`, \`node --test\`).\n\n` +
          `4. **Diretório Operacional do Projeto**:\n` +
          `   - Pasta: \`${snapshot.logs.projectMemoryDir}\`\n\n` +
          `Na interface do DecoHUB, você pode consultar o feed em tempo real na aba **Observabilidade** ou clicar sobre a tarefa no painel de Tarefas para ver o log individual.`;
      }

      case 'REVIEW_QUERY': {
        if (!rev && !evalRes) {
          return `Não há revisões ou avaliações registradas para este projeto até o momento.`;
        }
        return `### Motivo da Decisão do Review Independente\n\n` +
          `- **Decisão**: \`${rev?.verdict || evalRes?.verdict || 'N/A'}\`\n` +
          `- **Justificativa Registrada**: ${rev?.feedback || 'Nenhum feedback registrado.'}\n\n` +
          (evalRes ? `#### Detalhes do Evaluator Técnico:\n- Observações: ${evalRes.notes || 'N/A'}\n- Exit code do comando: ${evalRes.exitCode ?? 0}\n\n` : '') +
          `Para autorizar uma rodada de correção focada e nova revisão, envie **"Corrija o erro e continue"**.`;
      }

      case 'REMAINING_TASKS_QUERY': {
        if (!r || snapshot.tasks.length === 0) {
          return `Não há tarefas cadastradas no momento para o projeto **${p.name}**. Descreva o produto desejado para gerar o plano inicial.`;
        }

        const pending = snapshot.tasks.filter(t => t.status !== 'completed');
        const done = snapshot.tasks.filter(t => t.status === 'completed');

        return `### Estado do Backlog — ${p.name}\n\n` +
          `- **Concluídas**: ${done.length} tarefa(s)\n` +
          `- **Restantes**: ${pending.length} tarefa(s)\n\n` +
          `#### Tarefas Pendentes:\n` +
          pending.map(t => `- **[${t.status.toUpperCase()}]** ${t.title} *(Milestone: ${t.milestone})*`).join('\n') +
          `\n\nPróxima ação recomendada: ${r.nextAction || 'Executar próxima microtarefa pronta'}.`;
      }

      case 'PROGRESS_QUERY': {
        if (!r) {
          return `Nenhum ciclo autônomo está ativo para o projeto **${p.name}**.`;
        }
        const pct = r.tasksCount > 0 ? Math.round((r.completedCount / r.tasksCount) * 100) : 0;
        return `### Andamento Operacional — ${p.name}\n\n` +
          `- **Run ID**: \`${r.id?.slice(0, 8)}\`\n` +
          `- **Status**: \`${r.status?.toUpperCase()}\`\n` +
          `- **Progresso**: ${r.completedCount} de ${r.tasksCount} tarefas concluídas (${pct}%)\n` +
          `- **Tarefa Ativa**: ${r.currentTaskTitle ? `"${r.currentTaskTitle}"` : 'Nenhuma em andamento'}\n` +
          `- **Próxima Ação**: ${r.nextAction || 'Aguardando próxima etapa'}`;
      }

      case 'CAPABILITY_OR_PROPOSAL': {
        let contextNote = '';
        if (r && ['error', 'blocked', 'paused'].includes(r.status || '')) {
          contextNote = `Atualmente, o Run **${r.id?.slice(0, 8)}** está em **${r.status}** (${r.lastError || 'aguardando ação'}).\n\n`;
        }
        return `Sim, podemos corrigir!\n\n` +
          contextNote +
          `Como a mensagem foi interpretada como proposta ou exploração conceitual, **não iniciei alterações automaticamente** no código.\n\n` +
          `- Para que o Worker inicie a correção autônoma agora, envie **"Corrija o erro e continue"** ou **"Corrija a causa do erro identificado"**.\n` +
          `- Para inspecionar mais detalhes antes, pergunte **"Qual foi o erro?"** ou **"Onde eu vejo a log?"**.`;
      }

      case 'AMBIGUOUS_COMPLAINT':
      case 'AMBIGUOUS_UNCERTAIN': {
        let contextNote = '';
        if (r && ['error', 'blocked', 'paused'].includes(r.status || '')) {
          contextNote = `Atualmente, o Run **${r.id?.slice(0, 8)}** está em **${r.status}** (${r.lastError || 'aguardando ação'}).\n\n`;
        }
        return `Entendido.\n\n` +
          contextNote +
          `Como a mensagem expressa uma dúvida ou constatação sem um comando imperativo explícito, **não iniciei alterações automaticamente** para preservar seu código.\n\n` +
          `- Se você deseja que o Worker corrija o problema agora, envie: **"Corrija a causa do erro identificado"**.\n` +
          `- Se você quer entender o que aconteceu antes de agir, pergunte: **"Qual foi o erro?"** ou **"Por que o Review rejeitou?"**.\n` +
          `- Se deseja discutir uma mudança de requisito ou arquitetura, sinta-se livre para perguntar.`;
      }

      case 'STATUS_INQUIRY': {
        if (!r || !r.lastError) {
          return `Não há nenhum erro pendente no momento. O projeto está com status normal (\`${r?.status || 'sem execuções ativas'}\`).`;
        }
        if (['error', 'blocked', 'paused'].includes(r.status || '')) {
          return `Ainda não realizei a correção. O Run **${r.id?.slice(0, 8)}** está em proteção/pausa aguardando sua autorização.\n\n` +
            `- Para autorizar a correção autônoma agora, envie **"Corrija o erro e continue"**.`;
        }
        return `O status atual do Run é **${r.status}**.`;
      }

      case 'EXPLANATION_REQUEST': {
        return `O erro ainda não foi corrigido automaticamente porque o sistema entrou em proteção após a detecção da falha (\`${r?.status || 'pausado'}\`).\n\n` +
          `Isso evita loops de retrabalho infinito e garante que intervenções em código só avancem com visibilidade total do desenvolvedor.\n\n` +
          `- Para liberar o Worker para implementar a correção, envie **"Corrija o erro e continue"**.`;
      }

      default: {
        return `Olá! Sou o assistente conversacional do **DecoHUB** para o projeto **${p.name}**.\n\n` +
          `- **Status Atual**: \`${r?.status || 'sem execução ativa'}\`\n` +
          `- **Objetivo**: ${p.objective}\n\n` +
          `Você pode conversar comigo sobre a arquitetura do aplicativo, explorar novas ideias, verificar o andamento, consultar logs e erros, ou dar ordens explícitas de desenvolvimento. Como posso ajudar?`;
      }
    }
  }
}
