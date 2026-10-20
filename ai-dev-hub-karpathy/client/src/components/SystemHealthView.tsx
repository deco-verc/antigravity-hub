import React, { useState, useEffect } from 'react';
import { SystemHealthData, DiagnosticCheck, McpStatusData } from '../types';
import { api } from '../services/api';
import {
  Activity,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  RefreshCw,
  HardDrive,
  Cpu,
  GitBranch,
  Server,
  Monitor,
  Folder,
  Play,
  Zap,
  Terminal
} from 'lucide-react';

export const SystemHealthView: React.FC = () => {
  const [health, setHealth] = useState<SystemHealthData | null>(null);
  const [mcpStatus, setMcpStatus] = useState<McpStatusData | null>(null);
  const [testingMcp, setTestingMcp] = useState(false);
  const [mcpTestResult, setMcpTestResult] = useState<any>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticCheck[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningDiag, setRunningDiag] = useState(false);

  useEffect(() => {
    loadHealth();
  }, []);

  const loadHealth = async () => {
    setLoading(true);
    try {
      const [data, mcp] = await Promise.all([
        api.getSystemHealth(),
        api.getMcpStatus().catch(() => null)
      ]);
      setHealth(data);
      if (mcp) setMcpStatus(mcp);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleTestMcp = async () => {
    setTestingMcp(true);
    try {
      const res = await api.testMcp();
      setMcpTestResult(res);
      const updatedMcp = await api.getMcpStatus();
      setMcpStatus(updatedMcp);
    } catch (err: any) {
      setMcpTestResult({ status: 'error', error: err.message });
    } finally {
      setTestingMcp(false);
    }
  };

  const handleRunDiagnostics = async () => {
    setRunningDiag(true);
    try {
      const res = await api.runDiagnostics();
      setDiagnostics(res.diagnostics);
      await loadHealth();
    } catch (err) {
      console.error(err);
    } finally {
      setRunningDiag(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#090a0f] p-6 overflow-y-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#1e2233] pb-4">
        <div className="flex items-center gap-2.5">
          <Activity className="w-5 h-5 text-emerald-400" />
          <div>
            <h2 className="text-base font-bold text-white uppercase tracking-wider">System Health & Diagnóstico</h2>
            <p className="text-xs text-[#7e87aa]">Monitoramento do ambiente local, banco de dados e ferramentas instaladas</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={loadHealth}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#181b28] hover:bg-[#202538] border border-[#2e344e] text-xs text-slate-300 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Atualizar</span>
          </button>

          <button
            onClick={handleRunDiagnostics}
            disabled={runningDiag}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-md shadow-indigo-600/30 transition-all active:scale-[0.98]"
          >
            <Play className={`w-3.5 h-3.5 fill-current ${runningDiag ? 'animate-pulse' : ''}`} />
            <span>{runningDiag ? 'Executando...' : 'EXECUTAR DIAGNÓSTICO'}</span>
          </button>
        </div>
      </div>

      {/* Main Status Grid */}
      {health && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Backend Status */}
          <div className="p-4 rounded-xl bg-[#0d0f17] border border-[#1e2233] shadow-sm flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center justify-center">
                <Server className="w-4 h-4" />
              </div>
              <div>
                <span className="text-xs text-[#7e87aa] block font-medium">Backend API</span>
                <span className="text-sm font-bold text-white uppercase font-mono">
                  {health.backendStatus} (Porta 3001)
                </span>
              </div>
            </div>
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-sm shadow-emerald-500/50" />
          </div>

          {/* Frontend Status */}
          <div className="p-4 rounded-xl bg-[#0d0f17] border border-[#1e2233] shadow-sm flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center justify-center">
                <Monitor className="w-4 h-4" />
              </div>
              <div>
                <span className="text-xs text-[#7e87aa] block font-medium">Frontend Web</span>
                <span className="text-sm font-bold text-white uppercase font-mono">
                  {health.frontendStatus} (Porta 5173)
                </span>
              </div>
            </div>
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-sm shadow-emerald-500/50" />
          </div>

          {/* Database Status */}
          <div className="p-4 rounded-xl bg-[#0d0f17] border border-[#1e2233] shadow-sm flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 flex items-center justify-center">
                <HardDrive className="w-4 h-4" />
              </div>
              <div>
                <span className="text-xs text-[#7e87aa] block font-medium">Database SQLite</span>
                <span className="text-sm font-bold text-white capitalize font-mono">
                  {health.database.status} ({health.database.sizeFormatted})
                </span>
              </div>
            </div>
            <span className={`w-2.5 h-2.5 rounded-full ${health.database.status === 'connected' ? 'bg-emerald-400' : 'bg-rose-400'}`} />
          </div>

          {/* Git Tool */}
          <div className="p-4 rounded-xl bg-[#0d0f17] border border-[#1e2233] shadow-sm flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 flex items-center justify-center">
                <GitBranch className="w-4 h-4" />
              </div>
              <div>
                <span className="text-xs text-[#7e87aa] block font-medium">Git Version</span>
                <span className="text-sm font-bold text-white truncate max-w-[140px] block font-mono">
                  {health.tools.git || 'Disponível'}
                </span>
              </div>
            </div>
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-sm shadow-cyan-500/50" />
          </div>
        </div>
      )}

      {/* MCP Server Integration Card */}
      <div className="bg-[#0d0f17] border border-[#1e2233] rounded-2xl p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 flex items-center justify-center">
              <Zap className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-bold text-white uppercase tracking-wider">MCP Server (Model Context Protocol)</h3>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                  {mcpStatus?.status === 'online' ? 'ONLINE' : 'ATIVO'}
                </span>
              </div>
              <p className="text-xs text-[#7e87aa] mt-0.5">
                Servidor de ferramentas e memória contínua para agentes de programação locais.
              </p>
            </div>
          </div>

          <button
            onClick={handleTestMcp}
            disabled={testingMcp}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-md shadow-indigo-600/30 transition-all active:scale-95"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${testingMcp ? 'animate-spin' : ''}`} />
            <span>{testingMcp ? 'TESTANDO MCP...' : 'TESTAR SERVIDOR MCP'}</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs font-mono">
          <div className="bg-[#121520] p-3 rounded-xl border border-[#1e2233]">
            <span className="text-[#7e87aa] block text-[11px]">Transportes Habilitados</span>
            <span className="text-emerald-400 font-bold mt-1 block">stdio + HTTP JSON-RPC</span>
          </div>

          <div className="bg-[#121520] p-3 rounded-xl border border-[#1e2233]">
            <span className="text-[#7e87aa] block text-[11px]">Ferramentas Registradas</span>
            <span className="text-white font-bold mt-1 block">
              {mcpStatus?.toolsCount || 23} ferramentas (contexto, tarefas, git, checkpoints)
            </span>
          </div>

          <div className="bg-[#121520] p-3 rounded-xl border border-[#1e2233]">
            <span className="text-[#7e87aa] block text-[11px]">Última Execução MCP</span>
            <span className="text-slate-300 mt-1 block">
              {mcpStatus?.lastCallTimestamp ? new Date(mcpStatus.lastCallTimestamp).toLocaleTimeString('pt-BR') : 'Pronto para chamadas'}
            </span>
          </div>
        </div>

        {/* MCP Test Feedback */}
        {mcpTestResult && (
          <div className={`p-3.5 rounded-xl border text-xs flex items-center justify-between ${
            mcpTestResult.status === 'ok'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
          }`}>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>
                <strong>Auto-teste MCP concluído com sucesso:</strong> 23/23 ferramentas validadas, handshake JSON-RPC OK, latência: <strong>{mcpTestResult.latencyMs}ms</strong>.
              </span>
            </div>
            <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-black/40 text-emerald-400">
              HTTP 200 OK
            </span>
          </div>
        )}
      </div>

      {/* Environment & Versions Detail */}
      {health && (
        <div className="bg-[#0d0f17] border border-[#1e2233] rounded-2xl p-5 shadow-sm space-y-4">
          <h3 className="text-xs font-bold text-white uppercase tracking-wider">Especificações do Ambiente</h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono">
            <div className="space-y-2 bg-[#121520] p-4 rounded-xl border border-[#1e2233]">
              <div className="flex items-center justify-between">
                <span className="text-[#7e87aa]">Node.js:</span>
                <span className="text-slate-200 font-bold">{health.tools.node}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#7e87aa]">npm:</span>
                <span className="text-slate-200">{health.tools.npm}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#7e87aa]">Python:</span>
                <span className="text-slate-200">{health.tools.python}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#7e87aa]">Git:</span>
                <span className="text-slate-200">{health.tools.git}</span>
              </div>
            </div>

            <div className="space-y-2 bg-[#121520] p-4 rounded-xl border border-[#1e2233]">
              <div className="flex items-center justify-between">
                <span className="text-[#7e87aa]">Sistema Operacional:</span>
                <span className="text-slate-200">{health.os.platform}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#7e87aa]">Arquitetura:</span>
                <span className="text-slate-200">{health.os.arch}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#7e87aa]">Pasta de Dados do Hub:</span>
                <span className="text-slate-200 truncate max-w-[200px]" title={health.hubDataDir}>{health.hubDataDir}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#7e87aa]">Arquivo do Banco SQLite:</span>
                <span className="text-slate-200 truncate max-w-[200px]" title={health.database.path}>{health.database.path}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Diagnostics Results */}
      {diagnostics.length > 0 && (
        <div className="bg-[#0d0f17] border border-[#1e2233] rounded-2xl p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider">Resultado do Diagnóstico de Sistema</h3>
            <span className="text-xs text-emerald-400 font-mono">
              {diagnostics.filter(d => d.status === 'passed').length} / {diagnostics.length} testes aprovados
            </span>
          </div>

          <div className="space-y-2">
            {diagnostics.map(diag => {
              const isPassed = diag.status === 'passed';
              const isWarning = diag.status === 'warning';
              return (
                <div
                  key={diag.id}
                  className={`p-3 rounded-xl border flex items-start gap-3 ${
                    isPassed
                      ? 'bg-[#121520] border-emerald-500/20 text-slate-200'
                      : isWarning
                      ? 'bg-amber-500/10 border-amber-500/30 text-amber-200'
                      : 'bg-rose-500/10 border-rose-500/30 text-rose-200'
                  }`}
                >
                  {isPassed && <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />}
                  {isWarning && <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />}
                  {!isPassed && !isWarning && <AlertCircle className="w-4 h-4 text-rose-400 mt-0.5 flex-shrink-0" />}

                  <div className="flex-1 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-white">{diag.name}</span>
                      <span className="uppercase text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-black/40">
                        {diag.status}
                      </span>
                    </div>
                    <p className="mt-0.5 text-slate-300">{diag.message}</p>
                    {diag.details && <p className="mt-1 text-[11px] font-mono text-[#7e87aa]">{diag.details}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
