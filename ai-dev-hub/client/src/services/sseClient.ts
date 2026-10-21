/**
 * DecoHub SSE Client
 * Manages Server-Sent Events connection with automatic reconnection,
 * typed callbacks, heartbeat tracking, and clean disposal.
 */

export type SseEventType =
  | 'connected'
  | 'message'
  | 'activity'
  | 'log'
  | 'tool_call'
  | 'status'
  | 'done'
  | 'error';

export type SseEventHandler<T = any> = (data: T) => void;

export interface SseClientOptions {
  url: string;
  reconnectIntervalMs?: number;
  maxReconnectAttempts?: number;
  onOpen?: () => void;
  onError?: (err: any) => void;
}

export class DecoHubSseClient {
  private url: string;
  private eventSource: EventSource | null = null;
  private reconnectIntervalMs: number;
  private maxReconnectAttempts: number;
  private reconnectAttempts = 0;
  private reconnectTimer: any = null;
  private isManuallyClosed = false;
  private listeners: Map<string, Set<SseEventHandler>> = new Map();
  private onOpenCallback?: () => void;
  private onErrorCallback?: (err: any) => void;

  constructor(options: SseClientOptions) {
    this.url = options.url;
    this.reconnectIntervalMs = options.reconnectIntervalMs || 3000;
    this.maxReconnectAttempts = options.maxReconnectAttempts || 20;
    this.onOpenCallback = options.onOpen;
    this.onErrorCallback = options.onError;
    this.connect();
  }

  private connect(): void {
    if (this.isManuallyClosed) return;

    try {
      this.eventSource = new EventSource(this.url);

      this.eventSource.onopen = () => {
        this.reconnectAttempts = 0;
        this.onOpenCallback?.();
      };

      this.eventSource.onerror = (err) => {
        this.onErrorCallback?.(err);
        this.handleReconnect();
      };

      // Register standard and custom event listeners
      const eventTypes: SseEventType[] = [
        'connected',
        'message',
        'activity',
        'log',
        'tool_call',
        'status',
        'done',
        'error'
      ];

      for (const type of eventTypes) {
        this.eventSource.addEventListener(type, (e: MessageEvent) => {
          this.dispatch(type, e.data);
        });
      }

      // Default unnamed message event
      this.eventSource.onmessage = (e: MessageEvent) => {
        this.dispatch('message', e.data);
      };
    } catch {
      this.handleReconnect();
    }
  }

  private dispatch(type: string, rawData: string): void {
    let parsedData: any = rawData;
    try {
      parsedData = JSON.parse(rawData);
    } catch {
      // Raw string fallback
    }

    const handlers = this.listeners.get(type);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(parsedData);
        } catch (err) {
          console.warn(`[SSE] Erro no handler de ${type}:`, err);
        }
      }
    }
  }

  private handleReconnect(): void {
    if (this.isManuallyClosed) return;
    if (this.eventSource) {
      try {
        this.eventSource.close();
      } catch {}
      this.eventSource = null;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.warn(`[SSE] Limite máximo de reconexão atingido para ${this.url}`);
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(this.reconnectIntervalMs * Math.pow(1.5, this.reconnectAttempts - 1), 30000);

    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  on<T = any>(event: SseEventType | string, handler: SseEventHandler<T>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);

    return () => this.off(event, handler);
  }

  off(event: SseEventType | string, handler: SseEventHandler): void {
    const set = this.listeners.get(event);
    if (set) {
      set.delete(handler);
      if (set.size === 0) {
        this.listeners.delete(event);
      }
    }
  }

  close(): void {
    this.isManuallyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.eventSource) {
      try {
        this.eventSource.close();
      } catch {}
      this.eventSource = null;
    }
    this.listeners.clear();
  }
}

export function createProjectSseClient(projectId: string): DecoHubSseClient {
  return new DecoHubSseClient({
    url: `/api/projects/${encodeURIComponent(projectId)}/stream`
  });
}

export function createMetaChatSseClient(): DecoHubSseClient {
  return new DecoHubSseClient({
    url: '/api/metachat/stream'
  });
}
