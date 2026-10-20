/**
 * Ambient Trace Context Propagation using Node.js AsyncLocalStorage
 * Provides end-to-end correlation across API, runner, agents, leases, and database operations.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'node:crypto';
import { TraceContext } from './types.js';

const asyncLocalStorage = new AsyncLocalStorage<TraceContext>();

export class TraceContextManager {
  /**
   * Generates a unique traceable ID with proper semantic prefix
   */
  static generateId(prefix = 'trace'): string {
    return `${prefix}-${crypto.randomUUID().slice(0, 12)}`;
  }

  /**
   * Creates a fresh trace context for a root operation (e.g. autonomous run start or HTTP request)
   */
  static createRootContext(initial?: Partial<TraceContext>): TraceContext {
    const traceId = initial?.traceId || this.generateId('trace');
    const correlationId = initial?.correlationId || traceId;
    const spanId = initial?.spanId || this.generateId('span');

    return {
      traceId,
      correlationId,
      spanId,
      parentSpanId: initial?.parentSpanId,
      runId: initial?.runId,
      taskId: initial?.taskId,
      milestone: initial?.milestone,
      projectId: initial?.projectId,
      conversationId: initial?.conversationId,
      service: initial?.service || 'core'
    };
  }

  /**
   * Creates a child span context linked to the parent span
   */
  static createChildContext(parent: TraceContext, override?: Partial<TraceContext>): TraceContext {
    return {
      traceId: parent.traceId,
      correlationId: parent.correlationId,
      spanId: this.generateId('span'),
      parentSpanId: parent.spanId,
      runId: override?.runId ?? parent.runId,
      taskId: override?.taskId ?? parent.taskId,
      milestone: override?.milestone ?? parent.milestone,
      projectId: override?.projectId ?? parent.projectId,
      conversationId: override?.conversationId ?? parent.conversationId,
      service: override?.service ?? parent.service
    };
  }

  /**
   * Runs an asynchronous or synchronous function within a trace context
   */
  static run<T>(context: TraceContext, fn: () => T): T {
    return asyncLocalStorage.run(context, fn);
  }

  /**
   * Runs an operation with a child span derived from active context (or fresh if none exists)
   */
  static runInChildSpan<T>(override: Partial<TraceContext>, fn: () => T): T {
    const current = this.getActiveContext();
    const child = current ? this.createChildContext(current, override) : this.createRootContext(override);
    return this.run(child, fn);
  }

  /**
   * Retrieves the currently active ambient trace context, or undefined if none
   */
  static getActiveContext(): TraceContext | undefined {
    return asyncLocalStorage.getStore();
  }

  /**
   * Merges explicit input with active ambient context
   */
  static resolveContext(explicit?: Partial<TraceContext>): Partial<TraceContext> {
    const ambient = this.getActiveContext();
    if (!ambient && !explicit) return {};
    return {
      traceId: explicit?.traceId || ambient?.traceId,
      correlationId: explicit?.correlationId || ambient?.correlationId,
      spanId: explicit?.spanId || ambient?.spanId,
      parentSpanId: explicit?.parentSpanId || ambient?.parentSpanId,
      runId: explicit?.runId || ambient?.runId,
      taskId: explicit?.taskId || ambient?.taskId,
      milestone: explicit?.milestone || ambient?.milestone,
      projectId: explicit?.projectId || ambient?.projectId,
      conversationId: explicit?.conversationId || ambient?.conversationId,
      service: explicit?.service || ambient?.service
    };
  }
}
