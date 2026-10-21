/**
 * Server-Sent Events (SSE) Streaming Service
 * Manages active SSE connections per project and for Meta-Chat,
 * delivers real-time heartbeats (ping every 15s), and dispatches
 * observability events, tool calls, logs, and activity progress.
 */
import type { Response, Request } from 'express';
import { ObservabilityService } from './observability/observabilityService.js';
import type { ObservabilityEvent } from './observability/types.js';

export class SseStreamService {
  private static channels = new Map<string, Set<Response>>();
  private static heartbeatTimer: NodeJS.Timeout | null = null;
  private static isInitialized = false;

  static initialize(): void {
    if (this.isInitialized) return;
    this.isInitialized = true;

    // Connect to ObservabilityService events
    ObservabilityService.addListener((event: ObservabilityEvent) => {
      this.handleObservabilityEvent(event);
    });
  }

  static addClient(channelId: string, res: Response, req?: Request): void {
    this.initialize();
    const channel = String(channelId);

    // Set standard SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof (res as any).flushHeaders === 'function') {
      (res as any).flushHeaders();
    }

    if (!this.channels.has(channel)) {
      this.channels.set(channel, new Set());
    }
    this.channels.get(channel)!.add(res);

    // Send initial connected event
    const welcome = {
      type: 'connected',
      channel,
      timestamp: new Date().toISOString()
    };
    try {
      res.write(`event: connected\ndata: ${JSON.stringify(welcome)}\n\n`);
    } catch {}

    // Clean up when client disconnects
    const cleanup = () => {
      this.removeClient(channel, res);
    };
    res.on('close', cleanup);
    res.on('finish', cleanup);
    if (req) {
      req.on('close', cleanup);
    }

    // Ensure heartbeat is running
    this.ensureHeartbeat();
  }

  static removeClient(channelId: string, res: Response): void {
    const channel = String(channelId);
    const clients = this.channels.get(channel);
    if (clients) {
      clients.delete(res);
      if (clients.size === 0) {
        this.channels.delete(channel);
      }
    }

    if (this.channels.size === 0 && this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  static hasClients(channelId: string): boolean {
    const channel = String(channelId);
    const clients = this.channels.get(channel);
    return Boolean(clients && clients.size > 0);
  }

  static getClientCount(channelId?: string): number {
    if (channelId) {
      return this.channels.get(String(channelId))?.size || 0;
    }
    let total = 0;
    for (const clients of this.channels.values()) {
      total += clients.size;
    }
    return total;
  }

  static broadcast(channelId: string, eventType: string, data: any): void {
    const channel = String(channelId);
    const clients = this.channels.get(channel);
    if (!clients || clients.size === 0) return;

    const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
    const deadClients: Response[] = [];

    for (const res of clients) {
      try {
        res.write(payload);
      } catch (err) {
        deadClients.push(res);
      }
    }

    for (const dead of deadClients) {
      this.removeClient(channel, dead);
    }
  }

  static ensureHeartbeat(): void {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat();
    }, 15000);
    // Don't prevent process from exiting
    if (typeof this.heartbeatTimer.unref === 'function') {
      this.heartbeatTimer.unref();
    }
  }

  static sendHeartbeat(): void {
    const deadEntries: Array<{ channel: string; res: Response }> = [];

    for (const [channel, clients] of this.channels.entries()) {
      for (const res of clients) {
        try {
          res.write(': ping\n\n');
        } catch {
          deadEntries.push({ channel, res });
        }
      }
    }

    for (const { channel, res } of deadEntries) {
      this.removeClient(channel, res);
    }
  }

  static handleObservabilityEvent(event: ObservabilityEvent): void {
    try {
      const targetChannels: string[] = [];

      if (event.projectId) {
        targetChannels.push(String(event.projectId));
      }

      if (
        event.service === 'metachat' ||
        event.service === 'meta_chat' ||
        event.metadata?.isMetaChat ||
        event.projectId === 'metachat' ||
        event.event?.startsWith('METACHAT')
      ) {
        targetChannels.push('metachat');
      }

      if (targetChannels.length === 0) return;

      for (const ch of targetChannels) {
        // 1. Logs
        this.broadcast(ch, 'log', {
          id: event.id,
          timestamp: event.timestamp,
          level: event.level,
          service: event.service,
          message: event.message,
          metadata: event.metadata,
          error: event.error
        });

        // 2. Tool Calls
        if (
          event.event?.includes('TOOL') ||
          event.event?.includes('tool') ||
          event.metadata?.tool ||
          event.metadata?.toolName
        ) {
          this.broadcast(ch, 'tool_call', {
            tool: event.metadata?.tool || event.metadata?.toolName || event.event,
            args: event.metadata?.args,
            result: event.metadata?.result,
            timestamp: event.timestamp
          });
        }

        // 3. Activity / Tasks / Runs
        if (
          event.event?.includes('RUN') ||
          event.event?.includes('TASK') ||
          event.event?.includes('PROGRESS') ||
          event.event?.includes('PIPELINE') ||
          event.status
        ) {
          this.broadcast(ch, 'activity', {
            status: event.status,
            message: event.message,
            taskId: event.taskId,
            runId: event.runId,
            timestamp: event.timestamp
          });
        }
      }
    } catch {
      // Safe fallback
    }
  }

  static resetForTesting(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.channels.clear();
    this.isInitialized = false;
  }
}

// Auto-initialize on import
SseStreamService.initialize();
