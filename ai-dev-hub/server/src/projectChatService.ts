// server/src/projectChatService.ts
// Intelligent conversational service linking chat interactions to ProjectContextBridge and AntigravityConversationalService.

import { ChatIntentResult, ChatIntentType, ChatIntentClassifier } from './chatIntentClassifier.js';
import { AntigravityConversationalService, ConversationalResponse } from './antigravityConversationalService.js';
import { ProjectContextBridge } from './projectContextBridge.js';

export class ProjectChatService {
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
