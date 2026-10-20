import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import {
  Users,
  Bot,
  Play,
  Pause,
  Trash2,
  Activity,
  CheckCircle2,
  AlertTriangle,
  Clock,
  RefreshCw,
  Plus,
  Terminal,
  Shield,
  Layers,
  Copy,
  Check,
  Zap,
  ExternalLink
} from 'lucide-react';

interface Worker {
  id: string;
  name: string;
  provider: string;
  account_label: string | null;
  environment: string;
  status: 'READY' | 'STARTING' | 'WORKING' | 'PAUSED' | 'WAITING' | 'OFFLINE' | 'ERROR' | 'NEEDS_AUTH';
  conversation_id: string | null;
  current_run_id: string | null;
  current_issue_number: number | null;
  current_task_id: string | null;
  workspace: string | null;
  pid: number | null;
  last_heartbeat: string | null;
  last_activity: string | null;
  last_checkpoint: string | null;
  last_error: string | null;
  capabilities: string[];
  activeLease?: any;
}

interface WorkersTabProps {
  onShowToast: (type: 'success' | 'error' | 'info' | 'warn', message: string) => void;
}

export const WorkersTab: React.FC<WorkersTabProps> = ({ onShowToast }) => {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [activity, setActivity] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [testingWorkerId, setTestingWorkerId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // New Worker Form
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newEnv, setNewEnv] = useState('local');

  const loadData = async () => {
    try {
      const [workersList, activityList] = await Promise.all([
        api.getWorkers(),
        api.getWorkerActivity()
      ]);
      setWorkers(workersList);
      setActivity(activityList);
    } catch (err: any) {
      onShowToast('error', `Falha ao carregar workers: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 4000);
    return () => clearInterval(interval);
  }, []);

  const handleTestWorker = async (workerId: string) => {
    setTestingWorkerId(workerId);
    try {
      const res = await api.testWorker(workerId);
      if (res.success) {
        onShowToast('success', res.message);
      } else {
        onShowToast('warn', res.message);
      }
      await loadData();
    } catch (err: any) {
      onShowToast('error', `Erro ao testar worker: ${err.message}`);
    } finally {
      setTestingWorkerId(null);
    }
  };

  const handlePauseWorker = async (workerId: string) => {
    try {
      await api.pauseWorker(workerId);
      onShowToast('info', 'Worker pausado.');
      await loadData();
    } catch (err: any) {
      onShowToast('error', err.message);
    }
  };

  const handleResumeWorker = async (workerId: string) => {
    try {
      await api.resumeWorker(workerId);
      onShowToast('success', 'Worker reativado para READY.');
      await loadData();
    } catch (err: any) {
      onShowToast('error', err.message);
    }
  };

  const handleDeleteWorker = async (workerId: string) => {
    if (!confirm('Deseja realmente desligar/remover este Worker da pool?')) return;
    try {
      await api.deleteWorker(workerId);
      onShowToast('info', 'Worker removido da pool.');
      await loadData();
    } catch (err: any) {
      onShowToast('error', err.message);
    }
  };

  const handleCreateWorker = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    try {
      await api.createWorker({
        name: newName.trim(),
        account_label: newLabel.trim() || undefined,
        environment: newEnv
      });
      onShowToast('success', `Worker "${newName}" adicionado à pool com sucesso.`);
      setNewName('');
      setNewLabel('');
      setIsAddModalOpen(false);
      await loadData();
    } catch (err: any) {
      onShowToast('error', err.message);
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
    onShowToast('info', 'ID copiado para a área de transferência.');
  };

  const getStatusBadge = (status: Worker['status']) => {
    switch (status) {
      case 'WORKING':
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/10 text-amber-400 border border-amber-500/30 animate-pulse flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
            WORKING
          </span>
        );
      case 'READY':
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            READY
          </span>
        );
      case 'STARTING':
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-indigo-500/10 text-indigo-400 border border-indigo-500/30">
            STARTING
          </span>
        );
      case 'WAITING':
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-cyan-500/10 text-cyan-400 border border-cyan-500/30">
            WAITING
          </span>
        );
      case 'PAUSED':
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-slate-500/10 text-slate-400 border border-slate-500/30">
            PAUSED
          </span>
        );
      case 'OFFLINE':
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-rose-500/10 text-rose-400 border border-rose-500/30">
            OFFLINE
          </span>
        );
      case 'ERROR':
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-red-600/20 text-red-300 border border-red-500/40">
            ERROR
          </span>
        );
      case 'NEEDS_AUTH':
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-orange-500/20 text-orange-300 border border-orange-500/40">
            NEEDS_AUTH
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#181b28] text-slate-400 border border-[#2e344e]">
            {status}
          </span>
        );
    }
  };

  const onlineCount = workers.filter(w => w.status !== 'OFFLINE' && w.status !== 'ERROR').length;
  const workingCount = workers.filter(w => w.status === 'WORKING').length;
  const readyCount = workers.filter(w => w.status === 'READY' || w.status === 'WAITING').length;

  return (
    <div className="space-y-6">
      {/* Top Fleet Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="p-4 rounded-xl bg-[#0e111a] border border-[#1e2233] space-y-1">
          <div className="flex items-center justify-between text-[#7e87aa] text-xs">
            <span>TOTAL WORKERS</span>
            <Users className="w-4 h-4 text-indigo-400" />
          </div>
          <span className="text-2xl font-bold text-white font-mono">{workers.length}</span>
          <p className="text-[10px] text-[#636c8f]">Pool de agentes registrados</p>
        </div>

        <div className="p-4 rounded-xl bg-[#0e111a] border border-emerald-500/20 space-y-1">
          <div className="flex items-center justify-between text-emerald-400 text-xs">
            <span>ONLINE / READY</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <span className="text-2xl font-bold text-emerald-300 font-mono">{readyCount}</span>
          <p className="text-[10px] text-[#636c8f]">Prontos para assumir tarefas</p>
        </div>

        <div className="p-4 rounded-xl bg-[#0e111a] border border-amber-500/20 space-y-1">
          <div className="flex items-center justify-between text-amber-400 text-xs">
            <span>EM EXECUÇÃO</span>
            <Zap className="w-4 h-4 text-amber-400" />
          </div>
          <span className="text-2xl font-bold text-amber-300 font-mono">{workingCount}</span>
          <p className="text-[10px] text-[#636c8f]">Trabalhando com lease ativa</p>
        </div>

        <div className="p-4 rounded-xl bg-[#0e111a] border border-cyan-500/20 space-y-1">
          <div className="flex items-center justify-between text-cyan-400 text-xs">
            <span>ONLINE TOTAL</span>
            <Bot className="w-4 h-4 text-cyan-400" />
          </div>
          <span className="text-2xl font-bold text-cyan-300 font-mono">{onlineCount}</span>
          <p className="text-[10px] text-[#636c8f]">Disponíveis na infraestrutura</p>
        </div>
      </div>

      {/* Fleet Controls Bar */}
      <div className="flex items-center justify-between gap-3 p-4 rounded-xl bg-[#0d0f17] border border-[#1e2233]">
        <div>
          <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
            <Bot className="w-4 h-4 text-indigo-400" />
            <span>Worker Fleet — Agentes Autônomos</span>
          </h3>
          <p className="text-xs text-[#7e87aa] mt-0.5">
            Cada worker opera de forma independente com leases atômicas de 60s e rotação transparente.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={loadData}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#181b28] hover:bg-[#202538] border border-[#2e344e] text-slate-300 text-xs font-semibold transition-all active:scale-95"
            title="Atualizar lista de workers"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>ATUALIZAR</span>
          </button>

          <button
            onClick={() => setIsAddModalOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-md shadow-indigo-600/30 transition-all active:scale-95"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>ADICIONAR WORKER</span>
          </button>
        </div>
      </div>

      {/* Workers Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {workers.map(worker => {
          const isWorking = worker.status === 'WORKING';
          const isPaused = worker.status === 'PAUSED';
          const hasError = worker.status === 'ERROR';

          return (
            <div
              key={worker.id}
              className={`p-5 rounded-2xl bg-[#0d0f17] border transition-all space-y-4 shadow-sm flex flex-col justify-between ${
                isWorking
                  ? 'border-amber-500/40 shadow-amber-500/5'
                  : hasError
                  ? 'border-rose-500/40'
                  : 'border-[#1e2233] hover:border-[#2e344e]'
              }`}
            >
              {/* Header */}
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-white text-sm shadow-md ${
                      isWorking
                        ? 'bg-gradient-to-tr from-amber-600 to-orange-500 shadow-amber-600/30'
                        : hasError
                        ? 'bg-gradient-to-tr from-rose-600 to-red-500'
                        : 'bg-gradient-to-tr from-indigo-600 to-cyan-500 shadow-indigo-600/30'
                    }`}>
                      <Bot className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-white leading-tight">{worker.name}</h4>
                      <p className="text-[11px] text-[#7e87aa] font-mono mt-0.5">
                        {worker.account_label || 'Antigravity'} · {worker.environment}
                      </p>
                    </div>
                  </div>

                  <div>{getStatusBadge(worker.status)}</div>
                </div>

                {/* Assignment & Lease Details */}
                <div className="p-3 bg-[#121520] border border-[#1e2233] rounded-xl space-y-2 text-xs font-mono">
                  <div className="flex items-center justify-between text-[#7e87aa] text-[11px]">
                    <span>TAREFA ATUAL:</span>
                    <strong className={worker.current_issue_number ? 'text-cyan-400' : 'text-slate-400'}>
                      {worker.current_issue_number ? `Issue #${worker.current_issue_number}` : 'Nenhuma'}
                    </strong>
                  </div>

                  {worker.activeLease && (
                    <div className="flex items-center justify-between text-[#7e87aa] text-[11px] pt-1 border-t border-[#1e2233]">
                      <span>LEASE ATIVA:</span>
                      <span className="text-amber-400 font-bold">
                        expira em {Math.max(0, Math.round((new Date(worker.activeLease.lease_until).getTime() - Date.now()) / 1000))}s
                      </span>
                    </div>
                  )}

                  {worker.conversation_id && (
                    <div className="flex items-center justify-between text-[#7e87aa] text-[11px] pt-1 border-t border-[#1e2233]">
                      <span>CONVERSATION:</span>
                      <button
                        onClick={() => copyToClipboard(worker.conversation_id!, worker.id)}
                        className="inline-flex items-center gap-1 text-indigo-300 hover:text-indigo-200 transition-colors"
                        title="Copiar Conversation ID"
                      >
                        <span>{worker.conversation_id.slice(0, 8)}...</span>
                        {copiedId === worker.id ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      </button>
                    </div>
                  )}

                  <div className="flex items-center justify-between text-[#7e87aa] text-[11px] pt-1 border-t border-[#1e2233]">
                    <span>HEARTBEAT:</span>
                    <span className="text-slate-300">
                      {worker.last_heartbeat
                        ? `${Math.max(0, Math.round((Date.now() - new Date(worker.last_heartbeat).getTime()) / 1000))}s atrás`
                        : 'Nunca'}
                    </span>
                  </div>

                  {worker.last_checkpoint && (
                    <div className="pt-1 border-t border-[#1e2233] text-[10px] text-emerald-400/90 truncate" title={worker.last_checkpoint}>
                      ✓ {worker.last_checkpoint}
                    </div>
                  )}

                  {worker.last_error && (
                    <div className="pt-1 border-t border-rose-500/20 text-[10px] text-rose-400 truncate" title={worker.last_error}>
                      ⚠ {worker.last_error}
                    </div>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-3 border-t border-[#1e2233] flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <button
                    onClick={() => handleTestWorker(worker.id)}
                    disabled={testingWorkerId === worker.id}
                    className="px-2.5 py-1 rounded-lg bg-[#181b28] hover:bg-[#202538] border border-cyan-500/30 text-cyan-300 text-xs font-semibold transition-all active:scale-95"
                    title="Enviar ping de teste para o agente Antigravity"
                  >
                    {testingWorkerId === worker.id ? 'Testando...' : 'TESTAR'}
                  </button>

                  {isPaused ? (
                    <button
                      onClick={() => handleResumeWorker(worker.id)}
                      className="px-2.5 py-1 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-300 text-xs font-semibold transition-all"
                    >
                      RETOMAR
                    </button>
                  ) : (
                    <button
                      onClick={() => handlePauseWorker(worker.id)}
                      className="px-2.5 py-1 rounded-lg bg-[#181b28] hover:bg-[#202538] border border-amber-500/30 text-amber-300 text-xs font-semibold transition-all"
                    >
                      PAUSAR
                    </button>
                  )}
                </div>

                <button
                  onClick={() => handleDeleteWorker(worker.id)}
                  className="p-1.5 rounded-lg bg-[#181b28] hover:bg-rose-950/40 border border-rose-500/30 text-rose-400 text-xs transition-colors"
                  title="Desligar e remover Worker da pool"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Multi-Worker Activity Log Stream */}
      <div className="bg-[#0d0f17] border border-[#1e2233] rounded-2xl p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-cyan-400" />
            <h3 className="text-xs font-bold text-white uppercase tracking-wider">
              Log de Atividade de Leases & Workers
            </h3>
          </div>
          <span className="text-xs font-mono text-[#7e87aa]">{activity.length} eventos registrados</span>
        </div>

        <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
          {activity.length === 0 ? (
            <p className="text-xs text-[#7e87aa] text-center py-6">Nenhuma atividade de worker registrada ainda.</p>
          ) : (
            activity.map((act: any) => (
              <div key={act.id} className="p-3 bg-[#121520] border border-[#1e2233] rounded-xl text-xs space-y-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-white font-bold">{act.worker_name || act.worker_id}</span>
                    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded font-bold uppercase ${
                      act.event_type.includes('CLAIM')
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                        : act.event_type.includes('RELEASE')
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                        : act.event_type.includes('EXPIRE')
                        ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                        : 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40'
                    }`}>
                      {act.event_type}
                    </span>
                  </div>
                  <span className="text-[10px] font-mono text-[#636c8f]">
                    {new Date(act.created_at).toLocaleTimeString('pt-BR')}
                  </span>
                </div>
                <p className="text-slate-300 text-[11px]">{act.message}</p>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Add Worker Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#0f121d] border border-[#1e2233] rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <Plus className="w-4 h-4 text-indigo-400" />
                <span>Adicionar Novo Worker à Pool</span>
              </h3>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="text-slate-400 hover:text-white text-xs"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateWorker} className="space-y-4 text-xs">
              <div>
                <label className="block text-[#7e87aa] font-semibold mb-1">Nome do Worker</label>
                <input
                  type="text"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="ex: Worker 4 (Antigravity Delta)"
                  className="w-full px-3 py-2 rounded-lg bg-[#181b28] border border-[#2e344e] text-white focus:outline-none focus:border-indigo-500 text-xs"
                  required
                />
              </div>

              <div>
                <label className="block text-[#7e87aa] font-semibold mb-1">Conta / Label</label>
                <input
                  type="text"
                  value={newLabel}
                  onChange={e => setNewLabel(e.target.value)}
                  placeholder="ex: Conta Backup #4"
                  className="w-full px-3 py-2 rounded-lg bg-[#181b28] border border-[#2e344e] text-white focus:outline-none focus:border-indigo-500 text-xs"
                />
              </div>

              <div>
                <label className="block text-[#7e87aa] font-semibold mb-1">Ambiente</label>
                <select
                  value={newEnv}
                  onChange={e => setNewEnv(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[#181b28] border border-[#2e344e] text-white focus:outline-none focus:border-indigo-500 text-xs"
                >
                  <option value="local">Local (Windows Notebook)</option>
                  <option value="vm">Máquina Virtual</option>
                  <option value="container">Container Isolado</option>
                </select>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#1e2233]">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-3 py-1.5 rounded-lg bg-[#181b28] text-slate-300 hover:bg-[#202538] text-xs font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-md shadow-indigo-600/30"
                >
                  Salvar Worker
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
