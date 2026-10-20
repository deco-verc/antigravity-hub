/**
 * Core Types for Observability and Diagnostic System
 */

export type ObservabilityLogLevel = 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';

export interface StructuredError {
  name: string;
  message: string;
  code?: string;
  stack?: string;
  cause?: string;
  isOperational?: boolean;
  retryable?: boolean;
}

export interface ObservabilityEvent {
  id: string;
  timestamp: string; // ISO 8601 UTC
  level: ObservabilityLogLevel;
  event: string;
  message: string;
  service: string;
  environment: string;
  processId: number;
  sessionId?: string | null;
  correlationId?: string | null;
  traceId?: string | null;
  spanId?: string | null;
  parentSpanId?: string | null;
  runId?: string | null;
  taskId?: string | null;
  milestone?: string | null;
  projectId?: string | null;
  conversationId?: string | null;
  attempt?: number | null;
  durationMs?: number | null;
  status?: string | null;
  error?: StructuredError | null;
  metadata?: Record<string, any> | null;
  createdAt: string;
}

export interface EmitEventInput {
  level?: ObservabilityLogLevel;
  event: string;
  message: string;
  service?: string;
  environment?: string;
  sessionId?: string | null;
  correlationId?: string | null;
  traceId?: string | null;
  spanId?: string | null;
  parentSpanId?: string | null;
  runId?: string | null;
  taskId?: string | null;
  milestone?: string | null;
  projectId?: string | null;
  conversationId?: string | null;
  attempt?: number | null;
  durationMs?: number | null;
  status?: string | null;
  error?: unknown;
  metadata?: Record<string, any> | null;
  timestamp?: string;
}

export interface TraceContext {
  traceId: string;
  correlationId: string;
  spanId: string;
  parentSpanId?: string;
  runId?: string;
  taskId?: string;
  milestone?: string;
  projectId?: string;
  conversationId?: string;
  service?: string;
}

export interface DetectedAnomaly {
  id: string;
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  affectedEntity: {
    type: 'run' | 'task' | 'lease' | 'worker' | 'conversation' | 'reservation' | 'system';
    id: string;
    name?: string;
  };
  timeSinceLastProgressMs: number;
  lastKnownEvent: string | null;
  currentPersistedState: Record<string, any>;
  evidence: string[];
  hypotheses: string[];
  recommendedAction: string;
  detectedAt: string;
  failureClassification?: 'TRANSIENT' | 'PERSISTENT' | 'SLOW_ACTIVE' | 'STALLED';
  relatedLessonId?: string | null;
  autoRemediable?: boolean;
}

export interface EventQueryParams {
  limit?: number;
  offset?: number;
  level?: ObservabilityLogLevel;
  service?: string;
  event?: string;
  runId?: string;
  taskId?: string;
  projectId?: string;
  conversationId?: string;
  correlationId?: string;
  traceId?: string;
  search?: string;
  since?: string;
  until?: string;
  status?: string;
  errorCode?: string;
}

export interface ObservabilityHealthReport {
  status: 'healthy' | 'degraded' | 'unhealthy';
  databaseConnected: boolean;
  totalEventsCount: number;
  eventsLast24Hours: number;
  errorsLast24Hours: number;
  activeAnomaliesCount: number;
  fileLogger: {
    directory: string;
    filesCount: number;
    totalSizeBytes: number;
    lastRotation?: string;
  };
  inMemoryQueue: {
    pendingEvents: number;
    droppedEventsCount: number;
  };
}
