// server/src/projectChatService.ts
// Intelligent conversational service linking chat interactions to ProjectContextBridge and AntigravityConversationalService.

import fs from 'node:fs';
import path from 'node:path';
import { ChatIntentResult, ChatIntentType, ChatIntentClassifier } from './chatIntentClassifier.js';
import { AntigravityConversationalService, ConversationalResponse } from './antigravityConversationalService.js';
import { ProjectContextBridge } from './projectContextBridge.js';
import { HierarchicalOrchestrationService } from './hierarchicalOrchestrationService.js';
import { resolveProjectCapabilities } from './db.js';

export interface PendingPlanData {
  briefing: string;
  createdAt: string;
  projectName: string;
  stack: {
    framework: string;
    architecture: string;
  };
  proposedTasks: Array<{
    code: string;
    title: string;
    description: string;
    expectedFiles: string[];
    criteria: string[];
    dependencies: string[];
    verificationCommand: string;
  }>;
}

export class ProjectChatService {
  /**
   * Generates a structured multi-pass interactive plan proposal, persists PENDING_PLAN.json,
   * and prepares a high-fidelity conversational review card.
   */
  static async generateInteractivePlanProposal(params: {
    projectId: string;
    projectPath: string;
    projectName: string;
    briefing: string;
  }): Promise<{ replyContent: string; pendingPlan: PendingPlanData }> {
    const { projectId, projectPath, projectName, briefing } = params;
    const nowIso = new Date().toISOString();

    // 1. Persist original briefing
    try {
      const briefingPath = path.join(path.resolve(projectPath), '.ai-dev-hub', 'BRIEFING_ORIGINAL.md');
      fs.mkdirSync(path.dirname(briefingPath), { recursive: true });
      fs.writeFileSync(briefingPath, briefing, 'utf-8');
    } catch {}

    // 2. Generate structured tasks
    const planned = HierarchicalOrchestrationService.generateMultiPassPlannedTasks({
      briefing,
      projectPath,
      projectName,
      projectId
    });

    // 3. Resolve project capabilities & stack summary fiel ao prompt do usuário
    const detectedStack = HierarchicalOrchestrationService.extractTechStackFromBriefing(briefing);
    const capabilities = resolveProjectCapabilities(projectPath || projectId, briefing);
    const stackSummary = {
      framework: detectedStack.framework,
      architecture: detectedStack.architecture || (capabilities.database ? 'Arquitetura Modular em Camadas com SQLite WAL' : 'Arquitetura Modular em Camadas')
    };

    const proposedTasks = planned.map((t, idx) => ({
      code: t.code || `TK-${idx + 1}`,
      title: t.title,
      description: t.description,
      expectedFiles: t.expectedFiles || [],
      criteria: t.criteria || [],
      dependencies: t.dependencies || [],
      verificationCommand: t.verificationCommand || 'npm test'
    }));

    const pendingPlan: PendingPlanData = {
      briefing,
      createdAt: nowIso,
      projectName,
      stack: stackSummary,
      proposedTasks
    };

    // 4. Persist PENDING_PLAN.json
    try {
      const planPath = path.join(path.resolve(projectPath), '.ai-dev-hub', 'PENDING_PLAN.json');
      fs.mkdirSync(path.dirname(planPath), { recursive: true });
      fs.writeFileSync(planPath, JSON.stringify(pendingPlan, null, 2), 'utf-8');
    } catch {}

    // 5. Build presentation markdown
    const taskListMd = proposedTasks.map((t, idx) => {
      const filesTag = t.expectedFiles && t.expectedFiles.length > 0
        ? ` \`[${t.expectedFiles.slice(0, 3).join(', ')}]\``
        : '';
      return `**${idx + 1}. [${t.code}] ${t.title}**${filesTag}`;
    }).join('\n\n');

    const replyContent = `Analisei o seu briefing e elaborei uma proposta de arquitetura estruturada em **${proposedTasks.length} etapas coesas** para o projeto **${projectName}**:\n\n${taskListMd}\n\n---\n**Alinhamento de Escopo:**\nO plano acima atende a todas as especificações que você precisa? Se desejar adicionar, remover ou ajustar algum detalhe, basta responder aqui. Para iniciar a construção imediatamente, clique no botão de aprovação abaixo.`;

    return { replyContent, pendingPlan };
  }

  /**
   * Adjusts an existing pending plan based on user feedback.
   */
  static async adjustPendingPlan(params: {
    projectId: string;
    projectPath: string;
    projectName: string;
    adjustment: string;
  }): Promise<{ replyContent: string; pendingPlan: PendingPlanData }> {
    const planPath = path.join(path.resolve(params.projectPath), '.ai-dev-hub', 'PENDING_PLAN.json');
    let previousBriefing = '';
    try {
      if (fs.existsSync(planPath)) {
        const existing = JSON.parse(fs.readFileSync(planPath, 'utf-8'));
        previousBriefing = existing.briefing || '';
      }
    } catch {}

    const combinedBriefing = `${previousBriefing}\n\n## AJUSTE SOLICITADO PELO USUÁRIO:\n${params.adjustment}`.trim();
    return this.generateInteractivePlanProposal({
      projectId: params.projectId,
      projectPath: params.projectPath,
      projectName: params.projectName,
      briefing: combinedBriefing
    });
  }

  /**
   * Retrieves pending plan if present on disk.
   */
  static getPendingPlan(projectPath: string): PendingPlanData | null {
    try {
      const planPath = path.join(path.resolve(projectPath), '.ai-dev-hub', 'PENDING_PLAN.json');
      if (fs.existsSync(planPath)) {
        return JSON.parse(fs.readFileSync(planPath, 'utf-8'));
      }
    } catch {}
    return null;
  }

  /**
   * Clears pending plan file.
   */
  static clearPendingPlan(projectPath: string): void {
    try {
      const planPath = path.join(path.resolve(projectPath), '.ai-dev-hub', 'PENDING_PLAN.json');
      if (fs.existsSync(planPath)) {
        fs.unlinkSync(planPath);
      }
    } catch {}
  }

  /**
   * Asynchronous handler invoking the Antigravity Conversational Agent runtime with context
   */
  static async handleConversationalMessageAsync(params: {
    projectId: string;
    content: string;
    intentResult: ChatIntentResult;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
  }): Promise<{ replyContent: string; source: string; metadata: any }> {
    const res = await AntigravityConversationalService.handleMessage({
      projectId: params.projectId,
      userMessage: params.content,
      intentResult: params.intentResult,
      env: params.env,
      timeoutMs: params.timeoutMs
    });

    return {
      replyContent: res.replyContent,
      source: res.source,
      metadata: res.metadata
    };
  }

  /**
   * Synchronous entry point (for unit tests and deterministic quick paths)
   */
  static handleConversationalMessage(params: {
    projectId: string;
    content: string;
    intentResult: ChatIntentResult;
  }): { replyContent: string; metadata: any } {
    const snapshot = ProjectContextBridge.getSnapshot(params.projectId);
    if (!snapshot) {
      return {
        replyContent: 'Projeto não localizado para carregamento de contexto.',
        metadata: {
          intent: params.intentResult.intent,
          subType: params.intentResult.subType,
          status: 'answered'
        }
      };
    }

    // Call factual synthesis from snapshot
    const synthesized = (AntigravityConversationalService as any).synthesizeFactualResponse(
      snapshot,
      params.content,
      params.intentResult
    );

    return {
      replyContent: synthesized,
      metadata: {
        intent: params.intentResult.intent,
        subType: params.intentResult.subType,
        runId: snapshot.run?.id || null,
        status: 'answered'
      }
    };
  }

  /**
   * Simple query handler for direct API calls
   */
  static async handleQuery(projectId: string, message: string, intent: ChatIntentType): Promise<string> {
    const intentResult = ChatIntentClassifier.classify(message);
    const res = await this.handleConversationalMessageAsync({
      projectId,
      content: message,
      intentResult
    });
    return res.replyContent;
  }
}
