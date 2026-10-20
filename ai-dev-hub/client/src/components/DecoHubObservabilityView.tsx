import React, { useState, useEffect } from 'react';
import {
  Activity,
  AlertTriangle,
  Bug,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Download,
  Eye,
  Filter,
  RefreshCw,
  Search,
  ShieldAlert,
  Terminal,
  Trash2,
  Layers,
  FileText,
  Copy,
  Check
} from 'lucide-react';
import { api } from '../services/api';
import {
  ObservabilityEvent,
  DetectedAnomaly,
  GroupedError,
  ObservabilityHealthReport,
  LogLevel
} from '../types';

interface DecoHubObservabilityViewProps {
  initialRunId?: string;
  projectId?: string;
}

export const DecoHubObservabilityView: React.FC<DecoHubObservabilityViewProps> = ({
  initialRunId,
  projectId
}) => {
  // Tabs: events, timeline, anomalies, errors
  const [activeTab, setActiveTab] = useState<'events' | 'timeline' | 'anomalies' | 'errors'>('events');

  // Health report state
  const [health, setHealth] = useState<ObservabilityHealthReport | null>(null);

  // Events list state
  const [events, setEvents] = useState<ObservabilityEvent[]>([]);
  const [totalEvents, setTotalEvents] = useState<number>(0);
  const [loadingEvents, setLoadingEvents] = useState<boolean>(false);
  const [selectedEvent, setSelectedEvent] = useState<ObservabilityEvent | null>(null);

  // Filters
  const [filterLevel, setFilterLevel] = useState<LogLevel | 'ALL'>('ALL');
  const [filterService, setFilterService] = useState<string>('ALL');
  const [filterRunId, setFilterRunId] = useState<string>(initialRunId || '');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [pageOffset, setPageOffset] = useState<number>(0);
  const pageSize = 50;

  // Timeline state
  const [timelineRunId, setTimelineRunId] = useState<string>(initialRunId || '');
  const [timelineEvents, setTimelineEvents] = useState<ObservabilityEvent[]>([]);
  const [loadingTimeline, setLoadingTimeline] = useState<boolean>(false);

  // Anomalies state
  const [anomalies, setAnomalies] = useState<DetectedAnomaly[]>([]);
  const [loadingAnomalies, setLoadingAnomalies] = useState<boolean>(false);

  // Errors state
  const [groupedErrors, setGroupedErrors] = useState<GroupedError[]>([]);
  const [loadingErrors, setLoadingErrors] = useState<boolean>(false);
  const [selectedError, setSelectedError] = useState<GroupedError | null>(null);

  // Copy status
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Load Health
  const loadHealth = async () => {
    try {
      const data = await api.getObservabilityHealth();
      setHealth(data);
    } catch {}
  };

  // Load Events
  const loadEvents = async (offset = pageOffset) => {
    setLoadingEvents(true);
    try {
      const res = await api.getObservabilityEvents({
        limit: pageSize,
        offset,
        level: filterLevel !== 'ALL' ? filterLevel : undefined,
        service: filterService !== 'ALL' ? filterService : undefined,
        runId: filterRunId ? filterRunId.trim() : undefined,
        projectId: projectId || undefined,
        search: searchQuery ? searchQuery.trim() : undefined
      });
      setEvents(res.events);
      setTotalEvents(res.total);
      setPageOffset(offset);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingEvents(false);
    }
  };

  // Load Timeline
  const loadTimeline = async (targetRunId = timelineRunId) => {
    if (!targetRunId.trim()) return;
    setLoadingTimeline(true);
    try {
      const list = await api.getRunTimeline(targetRunId.trim());
      setTimelineEvents(list);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingTimeline(false);
    }
  };

  // Load Anomalies
  const loadAnomalies = async () => {
    setLoadingAnomalies(true);
    try {
      const list = await api.getDiagnosticAnomalies();
      setAnomalies(list);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingAnomalies(false);
    }
  };

  // Load Errors
  const loadErrors = async () => {
    setLoadingErrors(true);
    try {
      const list = await api.getDiagnosticErrors();
      setGroupedErrors(list);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingErrors(false);
    }
  };

  // Initial and reactive effects
  useEffect(() => {
    loadHealth();
    loadEvents(0);
    loadAnomalies();
    loadErrors();
    if (initialRunId) {
      setTimelineRunId(initialRunId);
      loadTimeline(initialRunId);
    } else if (projectId) {
      api.getActiveAutonomousRun(projectId).then(run => {
        if (run?.id) {
          setTimelineRunId(run.id);
          loadTimeline(run.id);
        }
      }).catch(() => {});
    }
    const timer = setInterval(() => {
      loadHealth();
    }, 15000);
    return () => clearInterval(timer);
  }, [projectId]);

  useEffect(() => {
    loadEvents(0);
  }, [filterLevel, filterService, filterRunId]);

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const getLevelBadgeClass = (level: LogLevel) => {
    switch (level) {
      case 'FATAL':
        return 'bg-red-950 text-red-200 border-red-800 font-bold';
      case 'ERROR':
        return 'bg-rose-500/15 text-rose-400 border-rose-500/30';
      case 'WARN':
        return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
      case 'INFO':
        return 'bg-blue-500/15 text-blue-300 border-blue-500/30';
      case 'DEBUG':
        return 'bg-purple-500/15 text-purple-300 border-purple-500/30';
      case 'TRACE':
        return 'bg-slate-700/30 text-slate-400 border-slate-600/30';
      default:
        return 'bg-slate-800 text-slate-300 border-slate-700';
    }
  };

  const getSeverityBadgeClass = (sev: string) => {
    switch (sev) {
      case 'critical':
        return 'bg-red-500/20 text-red-300 border-red-500/40';
      case 'high':
        return 'bg-rose-500/20 text-rose-300 border-rose-500/40';
      case 'medium':
        return 'bg-amber-500/20 text-amber-300 border-amber-500/40';
      default:
        return 'bg-blue-500/20 text-blue-300 border-blue-500/40';
    }
  };

  const formatElapsed = (ms?: number) => {
    if (!ms) return '-';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#080a11] text-slate-200 overflow-hidden">
      {/* 1. HEALTH & DIAGNOSTIC RIBBON */}
      <div className="bg-[#0e121d] border-b border-[#1b2133] p-4 flex-shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
              <Activity className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-white tracking-wide uppercase">Observabilidade & Diagnóstico</h2>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                  health?.status === 'healthy'
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                    : health?.status === 'degraded'
                    ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                    : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                }`}>
                  {health?.status ? health.status.toUpperCase() : 'CONECTANDO'}
                </span>
              </div>
              <p className="text-xs text-slate-400">Rastreabilidade ponta a ponta, auditoria forense e detecção de causas-raiz</p>
            </div>
          </div>

          {/* Quick Metrics */}
          <div className="flex items-center gap-3 text-xs">
            <div className="bg-[#141926] border border-[#20273a] rounded-lg px-3 py-1.5 flex items-center gap-2">
              <span className="text-slate-400">Eventos (24h):</span>
              <span className="font-bold text-white">{health?.eventsLast24Hours ?? 0}</span>
            </div>

            <div className="bg-[#141926] border border-[#20273a] rounded-lg px-3 py-1.5 flex items-center gap-2">
              <span className="text-slate-400">Erros (24h):</span>
              <span className={`font-bold ${(health?.errorsLast24Hours || 0) > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                {health?.errorsLast24Hours ?? 0}
              </span>
            </div>

            <button
              onClick={() => { setActiveTab('anomalies'); loadAnomalies(); }}
              className={`rounded-lg px-3 py-1.5 flex items-center gap-2 border transition-all ${
                (health?.activeAnomaliesCount || 0) > 0
                  ? 'bg-amber-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500/20'
                  : 'bg-[#141926] border-[#20273a] text-slate-400'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>Anomalias Ativas:</span>
              <span className="font-bold text-white">{health?.activeAnomaliesCount ?? 0}</span>
            </button>

            {/* Export buttons */}
            <div className="flex items-center gap-1 border-l border-[#20273a] pl-3">
              <a
                href={api.getObservabilityExportUrl(filterRunId ? { runId: filterRunId } : undefined, 'json')}
                target="_blank"
                rel="noreferrer"
                download
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#181f30] hover:bg-[#222b42] border border-[#28324a] text-xs text-indigo-300 transition-colors"
                title="Download JSON sanitizado"
              >
                <Download className="w-3 h-3" />
                <span>JSON</span>
              </a>
              <a
                href={api.getObservabilityExportUrl(filterRunId ? { runId: filterRunId } : undefined, 'jsonl')}
                target="_blank"
                rel="noreferrer"
                download
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#181f30] hover:bg-[#222b42] border border-[#28324a] text-xs text-indigo-300 transition-colors"
                title="Download JSONL sanitizado para ferramentas de log"
              >
                <Download className="w-3 h-3" />
                <span>JSONL</span>
              </a>
            </div>
          </div>
        </div>

        {/* Tab Selection */}
        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-[#1b2133]">
          <button
            onClick={() => setActiveTab('events')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
              activeTab === 'events'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-[#161c2a]'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Eventos Estruturados ({totalEvents})</span>
          </button>

          <button
            onClick={() => { setActiveTab('timeline'); if (timelineRunId) loadTimeline(); }}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
              activeTab === 'timeline'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-[#161c2a]'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>Linha do Tempo do Run</span>
          </button>

          <button
            onClick={() => { setActiveTab('anomalies'); loadAnomalies(); }}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
              activeTab === 'anomalies'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-[#161c2a]'
            }`}
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>Detecção de Anomalias ({anomalies.length})</span>
          </button>

          <button
            onClick={() => { setActiveTab('errors'); loadErrors(); }}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
              activeTab === 'errors'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-[#161c2a]'
            }`}
          >
            <Bug className="w-3.5 h-3.5" />
            <span>Erros Recorrentes ({groupedErrors.length})</span>
          </button>
        </div>
      </div>

      {/* 2. BODY CONTENT ACCORDING TO ACTIVE TAB */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {/* ======================= TAB: EVENTS ======================= */}
        {activeTab === 'events' && (
          <div className="flex-1 flex flex-col overflow-hidden p-4 space-y-3">
            {/* Filter Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 bg-[#0c101a] border border-[#1b2133] rounded-xl p-2.5">
              <div className="flex flex-wrap items-center gap-2 flex-1">
                {/* Search */}
                <div className="flex items-center gap-1.5 bg-[#141926] border border-[#20273a] rounded-lg px-2.5 py-1 text-xs min-w-[200px]">
                  <Search className="w-3.5 h-3.5 text-slate-500" />
                  <input
                    type="text"
                    placeholder="Buscar em mensagem, erro, metadados..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && loadEvents(0)}
                    className="bg-transparent text-white placeholder-slate-500 focus:outline-none w-full text-xs"
                  />
                </div>

                {/* Level selector */}
                <div className="flex items-center gap-1 bg-[#141926] border border-[#20273a] rounded-lg px-2 py-1 text-xs">
                  <Filter className="w-3 h-3 text-slate-500" />
                  <select
                    value={filterLevel}
                    onChange={e => setFilterLevel(e.target.value as any)}
                    className="bg-transparent text-slate-300 focus:outline-none text-xs"
                  >
                    <option value="ALL" className="bg-[#141926]">Nível: Todos</option>
                    <option value="FATAL" className="bg-[#141926]">FATAL</option>
                    <option value="ERROR" className="bg-[#141926]">ERROR</option>
                    <option value="WARN" className="bg-[#141926]">WARN</option>
                    <option value="INFO" className="bg-[#141926]">INFO</option>
                    <option value="DEBUG" className="bg-[#141926]">DEBUG</option>
                    <option value="TRACE" className="bg-[#141926]">TRACE</option>
                  </select>
                </div>

                {/* Service selector */}
                <div className="flex items-center gap-1 bg-[#141926] border border-[#20273a] rounded-lg px-2 py-1 text-xs">
                  <select
                    value={filterService}
                    onChange={e => setFilterService(e.target.value)}
                    className="bg-transparent text-slate-300 focus:outline-none text-xs"
                  >
                    <option value="ALL" className="bg-[#141926]">Serviço: Todos</option>
                    <option value="runner" className="bg-[#141926]">runner</option>
                    <option value="worker" className="bg-[#141926]">worker</option>
                    <option value="agent-gateway" className="bg-[#141926]">agent-gateway</option>
                    <option value="turn-state" className="bg-[#141926]">turn-state</option>
                    <option value="evaluator" className="bg-[#141926]">evaluator</option>
                    <option value="autonomous-manager" className="bg-[#141926]">autonomous-manager</option>
                    <option value="diagnostic" className="bg-[#141926]">diagnostic</option>
                    <option value="core" className="bg-[#141926]">core</option>
                  </select>
                </div>

                {/* RunId filter */}
                <div className="flex items-center gap-1.5 bg-[#141926] border border-[#20273a] rounded-lg px-2.5 py-1 text-xs max-w-[180px]">
                  <input
                    type="text"
                    placeholder="Filtrar por Run ID..."
                    value={filterRunId}
                    onChange={e => setFilterRunId(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && loadEvents(0)}
                    className="bg-transparent text-white placeholder-slate-500 focus:outline-none w-full text-xs font-mono"
                  />
                  {filterRunId && (
                    <button
                      onClick={() => { setFilterRunId(''); }}
                      className="text-slate-500 hover:text-slate-300"
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>

              {/* Refresh & Pagination */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => loadEvents(pageOffset)}
                  disabled={loadingEvents}
                  className="flex items-center gap-1 px-3 py-1 rounded-lg bg-[#181f30] hover:bg-[#222b42] border border-[#28324a] text-xs text-slate-300 transition-colors"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingEvents ? 'animate-spin' : ''}`} />
                  <span>Atualizar</span>
                </button>
              </div>
            </div>

            {/* Event List Table */}
            <div className="flex-1 bg-[#0b0e17] border border-[#1b2133] rounded-xl overflow-y-auto">
              {loadingEvents && events.length === 0 ? (
                <div className="text-center py-16 text-slate-500">Carregando eventos de observabilidade...</div>
              ) : events.length === 0 ? (
                <div className="text-center py-16 text-slate-500">
                  Nenhum evento registrado com os filtros selecionados.
                </div>
              ) : (
                <div className="divide-y divide-[#161c2a]">
                  {events.map(ev => {
                    const isExpanded = selectedEvent?.id === ev.id;
                    const timeFormatted = new Date(ev.timestamp).toLocaleTimeString('pt-BR');
                    return (
                      <div
                        key={ev.id}
                        className={`p-3 text-xs transition-colors hover:bg-[#101524] cursor-pointer ${
                          isExpanded ? 'bg-[#121829]' : ''
                        }`}
                        onClick={() => setSelectedEvent(isExpanded ? null : ev)}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <span className="font-mono text-slate-500 text-[11px] whitespace-nowrap">{timeFormatted}</span>
                            <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-mono border ${getLevelBadgeClass(ev.level)}`}>
                              {ev.level}
                            </span>
                            <span className="px-1.5 py-0.5 rounded bg-[#181f30] text-indigo-300 border border-[#28324a] text-[10px] font-mono">
                              {ev.service}
                            </span>
                            <span className="font-mono text-slate-400 font-medium">{ev.event}</span>
                            <span className="text-slate-300 truncate">{ev.message}</span>
                          </div>

                          <div className="flex items-center gap-2 flex-shrink-0 text-[11px] font-mono text-slate-500">
                            {ev.runId && (
                              <button
                                onClick={e => {
                                  e.stopPropagation();
                                  setFilterRunId(ev.runId!);
                                  setTimelineRunId(ev.runId!);
                                  setActiveTab('timeline');
                                  loadTimeline(ev.runId!);
                                }}
                                className="px-1.5 py-0.5 rounded bg-[#161e30] hover:bg-indigo-600 hover:text-white text-indigo-400 transition-colors"
                                title="Ver linha do tempo deste Run"
                              >
                                run:{ev.runId.slice(0, 8)}
                              </button>
                            )}
                            {ev.durationMs !== undefined && ev.durationMs !== null && (
                              <span className="text-slate-400">{formatElapsed(ev.durationMs)}</span>
                            )}
                            {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-indigo-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-600" />}
                          </div>
                        </div>

                        {/* Expanded Payload / Forensics Drawer */}
                        {isExpanded && (
                          <div
                            className="mt-3 p-3 bg-[#080a11] border border-[#1b2133] rounded-lg space-y-2 font-mono text-[11px]"
                            onClick={e => e.stopPropagation()}
                          >
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-slate-400 pb-2 border-b border-[#161c2a]">
                              <div><span className="text-slate-600">ID:</span> {ev.id}</div>
                              <div><span className="text-slate-600">Trace:</span> {ev.traceId || '-'}</div>
                              <div><span className="text-slate-600">Span:</span> {ev.spanId || '-'}</div>
                              <div><span className="text-slate-600">ParentSpan:</span> {ev.parentSpanId || '-'}</div>
                              <div><span className="text-slate-600">Task:</span> {ev.taskId || '-'}</div>
                              <div><span className="text-slate-600">Attempt:</span> {ev.attempt ?? '-'}</div>
                              <div><span className="text-slate-600">Status:</span> {ev.status || '-'}</div>
                              <div><span className="text-slate-600">PID:</span> {ev.processId}</div>
                            </div>

                            {/* Error Details */}
                            {ev.error && (
                              <div className="bg-rose-950/20 border border-rose-900/30 rounded p-2 text-rose-300 space-y-1">
                                <div className="font-bold flex items-center justify-between">
                                  <span>🚨 {ev.error.name}: {ev.error.message}</span>
                                  {ev.error.code && <span className="text-xs text-rose-400 font-mono">[{ev.error.code}]</span>}
                                </div>
                                {ev.error.stack && (
                                  <pre className="text-[10px] text-rose-400/80 overflow-x-auto whitespace-pre-wrap p-1 bg-black/40 rounded mt-1">
                                    {ev.error.stack}
                                  </pre>
                                )}
                              </div>
                            )}

                            {/* Metadata JSON */}
                            {ev.metadata && Object.keys(ev.metadata).length > 0 && (
                              <div>
                                <div className="flex items-center justify-between text-slate-400 mb-1">
                                  <span>Metadados Estruturados:</span>
                                  <button
                                    onClick={() => handleCopy(JSON.stringify(ev.metadata, null, 2), ev.id)}
                                    className="flex items-center gap-1 text-[10px] text-indigo-400 hover:text-indigo-300"
                                  >
                                    {copiedId === ev.id ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                                    <span>{copiedId === ev.id ? 'Copiado!' : 'Copiar JSON'}</span>
                                  </button>
                                </div>
                                <pre className="bg-black/50 p-2 rounded text-[10px] text-indigo-200/90 overflow-x-auto max-h-48">
                                  {JSON.stringify(ev.metadata, null, 2)}
                                </pre>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Pagination footer */}
            <div className="flex items-center justify-between text-xs text-slate-500 pt-1">
              <span>Mostrando {events.length} de {totalEvents} eventos</span>
              <div className="flex items-center gap-2">
                <button
                  disabled={pageOffset === 0}
                  onClick={() => loadEvents(Math.max(0, pageOffset - pageSize))}
                  className="px-2.5 py-1 rounded bg-[#141926] disabled:opacity-40 text-slate-300"
                >
                  Anterior
                </button>
                <button
                  disabled={pageOffset + pageSize >= totalEvents}
                  onClick={() => loadEvents(pageOffset + pageSize)}
                  className="px-2.5 py-1 rounded bg-[#141926] disabled:opacity-40 text-slate-300"
                >
                  Próxima
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ======================= TAB: TIMELINE ======================= */}
        {activeTab === 'timeline' && (
          <div className="flex-1 flex flex-col overflow-hidden p-4 space-y-3">
            {/* Timeline selector */}
            <div className="flex items-center gap-3 bg-[#0c101a] border border-[#1b2133] rounded-xl p-3">
              <span className="text-xs text-slate-400 whitespace-nowrap">ID do Autonomous Run:</span>
              <input
                type="text"
                placeholder="Ex: 04cc6a01 ou cole o UUID do Run..."
                value={timelineRunId}
                onChange={e => setTimelineRunId(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && loadTimeline()}
                className="flex-1 bg-[#141926] border border-[#20273a] rounded-lg px-3 py-1.5 text-xs text-white font-mono placeholder-slate-500 focus:outline-none"
              />
              <button
                onClick={() => loadTimeline()}
                disabled={loadingTimeline || !timelineRunId.trim()}
                className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1.5"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingTimeline ? 'animate-spin' : ''}`} />
                <span>Reconstruir Linha do Tempo</span>
              </button>
            </div>

            {/* Visual Timeline Stream */}
            <div className="flex-1 bg-[#0b0e17] border border-[#1b2133] rounded-xl overflow-y-auto p-4">
              {loadingTimeline ? (
                <div className="text-center py-16 text-slate-500">Reconstruindo sequência de eventos do Run...</div>
              ) : timelineEvents.length === 0 ? (
                <div className="text-center py-16 text-slate-500">
                  {timelineRunId ? 'Nenhum evento registrado para este Run.' : 'Digite ou selecione um Run ID para reconstruir a linha do tempo forense.'}
                </div>
              ) : (
                <div className="relative border-l border-[#20273a] ml-4 pl-6 space-y-4">
                  {timelineEvents.map((ev, idx) => {
                    const isError = ev.level === 'ERROR' || ev.level === 'FATAL';
                    const timeFormatted = new Date(ev.timestamp).toLocaleTimeString('pt-BR');
                    const prevEv = idx > 0 ? timelineEvents[idx - 1] : null;
                    const deltaMs = prevEv
                      ? new Date(ev.timestamp).getTime() - new Date(prevEv.timestamp).getTime()
                      : 0;

                    return (
                      <div key={ev.id} className="relative group">
                        {/* Node bullet */}
                        <div className={`absolute -left-[31px] top-1.5 w-3 h-3 rounded-full border-2 ${
                          isError
                            ? 'bg-rose-500 border-rose-300'
                            : ev.event.includes('completed')
                            ? 'bg-emerald-500 border-emerald-300'
                            : ev.event.includes('started')
                            ? 'bg-indigo-500 border-indigo-300'
                            : 'bg-[#1b2133] border-slate-500'
                        }`} />

                        <div className="bg-[#101422] border border-[#1d2336] rounded-xl p-3 hover:border-indigo-500/40 transition-colors">
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-slate-500 text-[11px]">{timeFormatted}</span>
                              {deltaMs > 0 && (
                                <span className="text-[10px] text-slate-600 font-mono">+{formatElapsed(deltaMs)}</span>
                              )}
                              <span className={`px-2 py-0.5 rounded text-[10px] font-mono border ${getLevelBadgeClass(ev.level)}`}>
                                {ev.level}
                              </span>
                              <span className="font-mono font-bold text-white">{ev.event}</span>
                            </div>

                            <div className="flex items-center gap-2 text-[11px] font-mono text-slate-400">
                              <span className="px-1.5 py-0.5 rounded bg-[#181f30] text-indigo-300 border border-[#28324a]">
                                {ev.service}
                              </span>
                              {ev.durationMs !== undefined && ev.durationMs !== null && (
                                <span className="text-emerald-400 font-semibold">{formatElapsed(ev.durationMs)}</span>
                              )}
                            </div>
                          </div>

                          <p className="text-xs text-slate-300 mt-1">{ev.message}</p>

                          {/* Error block */}
                          {ev.error && (
                            <div className="mt-2 p-2 bg-rose-950/20 border border-rose-900/30 rounded text-rose-300 text-xs">
                              <div className="font-bold">🚨 {ev.error.name}: {ev.error.message}</div>
                              {ev.error.stack && (
                                <pre className="text-[10px] text-rose-400/80 overflow-x-auto whitespace-pre-wrap mt-1">
                                  {ev.error.stack}
                                </pre>
                              )}
                            </div>
                          )}

                          {/* Metadata breakdown */}
                          {ev.metadata && Object.keys(ev.metadata).length > 0 && (
                            <details className="mt-2 text-[11px] text-slate-500 font-mono">
                              <summary className="cursor-pointer hover:text-slate-300">Detalhes da etapa ({Object.keys(ev.metadata).length} campos)</summary>
                              <pre className="mt-1 bg-black/40 p-2 rounded text-[10px] text-indigo-200/90 overflow-x-auto">
                                {JSON.stringify(ev.metadata, null, 2)}
                              </pre>
                            </details>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ======================= TAB: ANOMALIES ======================= */}
        {activeTab === 'anomalies' && (
          <div className="flex-1 flex flex-col overflow-hidden p-4 space-y-3">
            <div className="flex items-center justify-between bg-[#0c101a] border border-[#1b2133] rounded-xl p-3">
              <div>
                <h3 className="text-sm font-bold text-white">Detecção de Anomalias & Diagnóstico de Causas-Raiz</h3>
                <p className="text-xs text-slate-400">Varredura automática de runs parados, tarefas sem progresso, leases expirados e divergências de estado.</p>
              </div>

              <button
                onClick={loadAnomalies}
                disabled={loadingAnomalies}
                className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1.5"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingAnomalies ? 'animate-spin' : ''}`} />
                <span>Escanear Agora</span>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3">
              {loadingAnomalies ? (
                <div className="text-center py-16 text-slate-500">Executando diagnósticos no sistema...</div>
              ) : anomalies.length === 0 ? (
                <div className="text-center py-16 bg-[#0b0e17] border border-[#1b2133] rounded-xl p-8 space-y-2">
                  <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto" />
                  <h4 className="text-sm font-bold text-white">Nenhuma anomalia ativa detectada</h4>
                  <p className="text-xs text-slate-400">Todos os runs, leases, tarefas e turns de agentes estão consistentes.</p>
                </div>
              ) : (
                anomalies.map(anom => (
                  <div
                    key={anom.id}
                    className="bg-[#0e121e] border border-[#1f263a] rounded-xl p-4 space-y-3 hover:border-amber-500/30 transition-colors"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1b2234] pb-2.5">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${getSeverityBadgeClass(anom.severity)}`}>
                          {anom.severity}
                        </span>
                        <span className="font-mono text-sm font-bold text-white">{anom.type}</span>
                        <span className="text-xs text-slate-400 font-mono">
                          [{anom.affectedEntity.type}: {anom.affectedEntity.name || anom.affectedEntity.id}]
                        </span>
                      </div>

                      {anom.timeSinceLastProgressMs > 0 && (
                        <div className="flex items-center gap-1 text-xs text-amber-400 font-mono">
                          <Clock className="w-3.5 h-3.5" />
                          <span>Parado há {formatElapsed(anom.timeSinceLastProgressMs)}</span>
                        </div>
                      )}
                    </div>

                    {/* Evidence */}
                    <div className="space-y-1 text-xs">
                      <div className="text-slate-400 font-semibold">Evidências Observadas:</div>
                      <ul className="list-disc list-inside space-y-0.5 text-slate-300 bg-[#080a11] p-2.5 rounded-lg border border-[#181e2e]">
                        {anom.evidence.map((ev, i) => (
                          <li key={i}>{ev}</li>
                        ))}
                      </ul>
                    </div>

                    {/* Hypotheses */}
                    <div className="space-y-1 text-xs">
                      <div className="text-slate-400 font-semibold">Hipóteses de Causa-Raiz:</div>
                      <ul className="space-y-0.5 text-indigo-300 bg-indigo-950/20 p-2.5 rounded-lg border border-indigo-900/30">
                        {anom.hypotheses.map((hyp, i) => (
                          <li key={i}>{hyp}</li>
                        ))}
                      </ul>
                    </div>

                    {/* Recommended Action */}
                    <div className="text-xs bg-emerald-950/20 border border-emerald-900/30 rounded-lg p-2.5 flex items-start gap-2 text-emerald-300">
                      <span className="font-bold whitespace-nowrap">Ação Recomendada:</span>
                      <span>{anom.recommendedAction}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* ======================= TAB: ERRORS ======================= */}
        {activeTab === 'errors' && (
          <div className="flex-1 flex flex-col overflow-hidden p-4 space-y-3">
            <div className="flex items-center justify-between bg-[#0c101a] border border-[#1b2133] rounded-xl p-3">
              <div>
                <h3 className="text-sm font-bold text-white">Erros Recorrentes Agrupados</h3>
                <p className="text-xs text-slate-400">Classificação por assinatura de erro para diagnosticar falhas repetitivas de infraestrutura ou agentes.</p>
              </div>

              <button
                onClick={loadErrors}
                disabled={loadingErrors}
                className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1.5"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingErrors ? 'animate-spin' : ''}`} />
                <span>Atualizar</span>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2">
              {loadingErrors ? (
                <div className="text-center py-16 text-slate-500">Agrupando erros do sistema...</div>
              ) : groupedErrors.length === 0 ? (
                <div className="text-center py-16 bg-[#0b0e17] border border-[#1b2133] rounded-xl p-8 space-y-2">
                  <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto" />
                  <h4 className="text-sm font-bold text-white">Nenhum erro registrado</h4>
                  <p className="text-xs text-slate-400">Não há registros de falhas ou exceções no período.</p>
                </div>
              ) : (
                groupedErrors.map((grp, idx) => {
                  const isExpanded = selectedError?.errorKey === grp.errorKey;
                  return (
                    <div
                      key={idx}
                      className="bg-[#0e121e] border border-[#1f263a] rounded-xl p-3 hover:border-rose-500/30 transition-colors cursor-pointer"
                      onClick={() => setSelectedError(isExpanded ? null : grp)}
                    >
                      <div className="flex items-center justify-between gap-3 text-xs">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <span className="px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 font-bold border border-rose-500/30">
                            {grp.count}x
                          </span>
                          <span className="font-mono text-white font-semibold truncate">{grp.errorKey}</span>
                        </div>

                        <div className="flex items-center gap-3 text-[11px] text-slate-500 font-mono flex-shrink-0">
                          <span>Último: {new Date(grp.lastSeen).toLocaleTimeString('pt-BR')}</span>
                          {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                        </div>
                      </div>

                      {isExpanded && (
                        <div
                          className="mt-3 p-3 bg-[#080a11] border border-[#1b2133] rounded-lg space-y-2 text-xs font-mono"
                          onClick={e => e.stopPropagation()}
                        >
                          <div className="text-slate-400 text-[11px]">
                            Primeira ocorrência: {new Date(grp.firstSeen).toLocaleString('pt-BR')} | Última ocorrência: {new Date(grp.lastSeen).toLocaleString('pt-BR')}
                          </div>
                          {grp.sampleEvent.error?.stack && (
                            <pre className="text-[10px] text-rose-300/80 p-2 bg-black/50 rounded overflow-x-auto whitespace-pre-wrap">
                              {grp.sampleEvent.error.stack}
                            </pre>
                          )}
                          {grp.sampleEvent.metadata && (
                            <details className="text-[11px] text-slate-500">
                              <summary className="cursor-pointer hover:text-slate-300">Metadados da amostra</summary>
                              <pre className="mt-1 bg-black/40 p-2 rounded text-[10px] text-indigo-200/90 overflow-x-auto">
                                {JSON.stringify(grp.sampleEvent.metadata, null, 2)}
                              </pre>
                            </details>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
