import React, { useState, useEffect, useRef } from 'react';
import {
  Activity,
  Zap,
  Cpu,
  HardDrive,
  Check,
  ChevronDown,
  RefreshCw,
  AlertTriangle,
  Lock,
  Plus,
  Settings,
  ShieldCheck
} from 'lucide-react';
import {
  AccountProfile,
  AccountTelemetryResponse,
  AccountTelemetryItem
} from '../types';
import { api } from '../services/api';

interface AccountTelemetryBadgeProps {
  projectId?: string;
  activeAccount?: AccountProfile | null;
  onAccountSwitched?: (acc: AccountProfile) => void;
  onOpenAccountManager?: () => void;
  onOpenAddAccountModal?: () => void;
}

export const AccountTelemetryBadge: React.FC<AccountTelemetryBadgeProps> = ({
  projectId,
  activeAccount,
  onAccountSwitched,
  onOpenAccountManager,
  onOpenAddAccountModal
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [telemetry, setTelemetry] = useState<AccountTelemetryResponse | null>(null);
  const [autoFailoverEnabled, setAutoFailoverEnabled] = useState(true);
  const [isSwitching, setIsSwitching] = useState(false);
  const [isTogglingFailover, setIsTogglingFailover] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Load telemetry data from backend
  const loadTelemetry = async () => {
    try {
      const data = await api.getAccountTelemetry();
      setTelemetry(data);
      setAutoFailoverEnabled(data.autoFailoverEnabled);
    } catch (err) {
      // Fallback silent: keep local state
    }
  };

  useEffect(() => {
    loadTelemetry();
    // Poll telemetry every 6 seconds while component is active
    const interval = setInterval(loadTelemetry, 6000);
    return () => clearInterval(interval);
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Find effective current active account item
  const currentTelemetryAccount =
    telemetry?.accounts.find(a => (activeAccount ? a.id === activeAccount.id : a.isActive)) ||
    telemetry?.accounts[0];

  // Helper for status dot colors (green / amber / red)
  const getStatusColor = (status?: string, isAlive?: boolean) => {
    const normalized = (status || '').toUpperCase();
    if (normalized === 'READY' || normalized === 'ACTIVE') {
      return isAlive
        ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]'
        : 'bg-emerald-400/80 shadow-[0_0_6px_rgba(52,211,153,0.5)]';
    }
    if (
      normalized === 'WAITING_LOGIN' ||
      normalized === 'LOGIN_REQUIRED' ||
      normalized === 'NEEDS_LOGIN' ||
      normalized === 'QUOTA_EXHAUSTED' ||
      normalized === 'RATE_LIMITED' ||
      normalized === 'AUTHENTICATING'
    ) {
      return 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)] animate-pulse';
    }
    return 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.8)]';
  };

  // Status badge label and badge colors
  const getStatusBadge = (status?: string) => {
    const normalized = (status || '').toUpperCase();
    if (normalized === 'READY' || normalized === 'ACTIVE') {
      return {
        text: 'READY',
        classes: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
      };
    }
    if (normalized === 'QUOTA_EXHAUSTED' || normalized === 'RATE_LIMITED') {
      return {
        text: 'COTA ESGOTADA',
        classes: 'bg-amber-500/20 text-amber-300 border-amber-500/40'
      };
    }
    if (
      normalized === 'WAITING_LOGIN' ||
      normalized === 'LOGIN_REQUIRED' ||
      normalized === 'NEEDS_LOGIN' ||
      normalized === 'AUTHENTICATING'
    ) {
      return {
        text: 'WAITING_LOGIN',
        classes: 'bg-amber-500/20 text-amber-300 border-amber-500/40'
      };
    }
    return {
      text: 'OFFLINE',
      classes: 'bg-rose-500/15 text-rose-300 border-rose-500/30'
    };
  };

  // Perform Rapid Switch
  const handleRapidSwitch = async (targetProfileId?: string) => {
    if (isSwitching) return;
    setIsSwitching(true);
    setFeedbackMsg(null);
    try {
      const res = await api.rapidSwitchAccount({
        projectId,
        targetProfileId
      });
      if (res.activeProfile) {
        onAccountSwitched?.(res.activeProfile);
      }
      setFeedbackMsg(res.message || 'Conta alternada com sucesso.');
      await loadTelemetry();
      setTimeout(() => setFeedbackMsg(null), 3000);
    } catch (err: any) {
      setFeedbackMsg(`Erro: ${err.message}`);
      setTimeout(() => setFeedbackMsg(null), 4000);
    } finally {
      setIsSwitching(false);
    }
  };

  // Toggle Auto-Failover setting
  const handleToggleAutoFailover = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isTogglingFailover) return;
    const nextVal = !autoFailoverEnabled;
    setIsTogglingFailover(true);
    try {
      await api.setAutoFailover(nextVal);
      setAutoFailoverEnabled(nextVal);
      if (telemetry) {
        setTelemetry({ ...telemetry, autoFailoverEnabled: nextVal });
      }
    } catch (err: any) {
      console.error('Falha ao atualizar auto-failover:', err);
    } finally {
      setIsTogglingFailover(false);
    }
  };

  const activeDisplayName =
    currentTelemetryAccount?.displayName ||
    activeAccount?.display_name ||
    'Google Pro 1';

  const isCurrentAlive = Boolean(currentTelemetryAccount?.process?.isAlive);
  const currentGrpcPort = currentTelemetryAccount?.process?.grpcPort || currentTelemetryAccount?.process?.port;

  return (
    <div className="relative" ref={containerRef}>
      {/* 1. Header Trigger Badge */}
      <button
        type="button"
        onClick={() => {
          setIsOpen(prev => !prev);
          loadTelemetry();
        }}
        className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs transition-all cursor-pointer ${
          isOpen
            ? 'bg-[#181e30] border-indigo-500/50 text-white shadow-md'
            : 'bg-[#121624] hover:bg-[#1a2135] border-[#22293e] text-slate-200 hover:text-white'
        }`}
        title="Telemetria de Contas Google e Daemons Antigravity"
      >
        <span
          className={`w-2 h-2 rounded-full flex-shrink-0 transition-colors ${getStatusColor(
            currentTelemetryAccount?.authStatus,
            isCurrentAlive
          )}`}
        />

        <span className="font-semibold tracking-tight max-w-[120px] truncate text-slate-100">
          {activeDisplayName}
        </span>

        {currentGrpcPort ? (
          <span className="hidden sm:inline-flex items-center gap-1 font-mono text-[10px] text-cyan-300 bg-cyan-950/40 px-1.5 py-0.5 rounded border border-cyan-500/20">
            <Cpu className="w-2.5 h-2.5 text-cyan-400" />
            :{currentGrpcPort}
          </span>
        ) : (
          <span className="hidden sm:inline-flex items-center font-mono text-[10px] text-slate-400 bg-slate-900/60 px-1.5 py-0.5 rounded border border-slate-700/40">
            {currentTelemetryAccount ? getStatusBadge(currentTelemetryAccount.authStatus).text : 'READY'}
          </span>
        )}

        <ChevronDown
          className={`w-3 h-3 text-slate-400 transition-transform ${
            isOpen ? 'rotate-180 text-indigo-400' : ''
          }`}
        />
      </button>

      {/* 2. Interactive Telemetry Dropdown */}
      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-80 sm:w-96 rounded-2xl bg-[#0b0e17] border border-[#20283e] shadow-2xl p-3 z-50 text-xs space-y-3 animate-message-enter select-none">
          {/* Header & Auto-Failover Switch */}
          <div className="flex items-center justify-between pb-2 border-b border-[#192136]">
            <div className="flex items-center gap-1.5 text-slate-200 font-semibold text-xs">
              <Activity className="w-3.5 h-3.5 text-indigo-400" />
              <span>Telemetria Multi-Conta</span>
            </div>

            {/* Switch Auto-Failover */}
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-slate-300 font-medium">Auto-Failover</span>
              <button
                type="button"
                role="switch"
                aria-checked={autoFailoverEnabled}
                onClick={handleToggleAutoFailover}
                disabled={isTogglingFailover}
                className={`relative inline-flex h-4 w-8 items-center rounded-full transition-colors cursor-pointer focus:outline-none ${
                  autoFailoverEnabled ? 'bg-emerald-600' : 'bg-slate-700'
                }`}
                title={
                  autoFailoverEnabled
                    ? 'Auto-Failover Ativo (chaveia automaticamente para outra conta em caso de limite)'
                    : 'Auto-Failover Desativado'
                }
              >
                <span
                  className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                    autoFailoverEnabled ? 'translate-x-4' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Feedback message banner */}
          {feedbackMsg && (
            <div className="px-2.5 py-1 rounded-lg bg-indigo-950/60 border border-indigo-500/40 text-indigo-200 text-[11px] flex items-center gap-1.5 animate-message-enter">
              <ShieldCheck className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />
              <span className="truncate">{feedbackMsg}</span>
            </div>
          )}

          {/* Accounts List */}
          <div className="space-y-1.5 max-h-64 overflow-y-auto pr-0.5 custom-scrollbar">
            {(telemetry?.accounts || [
              {
                id: 'acc-pro-1',
                name: 'google_pro_1',
                displayName: 'Google Pro 1',
                authStatus: 'READY',
                rawAuthStatus: 'READY',
                isActive: true,
                process: {
                  pid: null,
                  grpcPort: null,
                  port: null,
                  uptimeSeconds: null,
                  uptimeFormatted: 'Parado',
                  isAlive: false
                },
                todayExecutions: 0
              }
            ]).map(acc => {
              const isCur =
                acc.id === (currentTelemetryAccount?.id || activeAccount?.id);
              const badge = getStatusBadge(acc.authStatus);
              const isAlive = Boolean(acc.process?.isAlive);

              return (
                <div
                  key={acc.id}
                  onClick={() => handleRapidSwitch(acc.id)}
                  className={`p-2.5 rounded-xl border transition-all cursor-pointer ${
                    isCur
                      ? 'bg-indigo-950/25 border-indigo-500/50 shadow-sm'
                      : 'bg-[#101422] hover:bg-[#161c30] border-[#1c243a] hover:border-[#283454]'
                  }`}
                >
                  {/* Row 1: Status dot, Display Name, Badges */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`w-2 h-2 rounded-full flex-shrink-0 ${getStatusColor(
                          acc.authStatus,
                          isAlive
                        )}`}
                      />
                      <span className="font-semibold text-slate-100 truncate text-xs">
                        {acc.displayName}
                      </span>
                      {acc.email && (
                        <span className="text-[10px] text-slate-400 truncate hidden sm:inline">
                          ({acc.email})
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold border ${badge.classes}`}
                      >
                        {badge.text}
                      </span>
                      {isCur && (
                        <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/40">
                          <Check className="w-2.5 h-2.5" />
                          ATIVA
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Row 2: Daemon process info */}
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-mono text-slate-400 border-t border-[#182035]/60 pt-1.5">
                    {isAlive ? (
                      <>
                        <span className="inline-flex items-center gap-1 text-emerald-400">
                          <Cpu className="w-3 h-3 text-emerald-400" />
                          PID: {acc.process.pid}
                        </span>
                        {acc.process.grpcPort && (
                          <span className="inline-flex items-center gap-1 text-cyan-300">
                            Porta gRPC: {acc.process.grpcPort}
                          </span>
                        )}
                        <span className="text-slate-400">
                          Uptime: {acc.process.uptimeFormatted}
                        </span>
                      </>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-slate-500">
                        <HardDrive className="w-3 h-3 text-slate-500" />
                        Daemon Antigravity: Parado / Em Standby
                      </span>
                    )}
                  </div>

                  {/* Row 3: Daily executions */}
                  <div className="mt-1 flex items-center justify-between text-[10px] text-slate-400">
                    <span className="inline-flex items-center gap-1">
                      <Zap className="w-3 h-3 text-cyan-400" />
                      <span>{acc.todayExecutions} chamadas hoje</span>
                    </span>
                    {acc.quotaResetsAt && (
                      <span className="text-amber-400 text-[9px]">
                        Cooldown até {new Date(acc.quotaResetsAt).toLocaleTimeString()}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Action Button: Rapid Switch Immediately */}
          <div className="pt-2 border-t border-[#192136] space-y-2">
            <button
              type="button"
              disabled={isSwitching}
              onClick={() => handleRapidSwitch()}
              className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-gradient-to-r from-indigo-600 via-indigo-500 to-cyan-600 hover:from-indigo-500 hover:to-cyan-500 text-white font-semibold text-xs shadow-lg shadow-indigo-950/50 transition-all cursor-pointer disabled:opacity-50 active:scale-[0.98]"
            >
              <Zap
                className={`w-3.5 h-3.5 ${
                  isSwitching ? 'animate-spin text-amber-300' : 'text-cyan-300'
                }`}
              />
              <span>
                {isSwitching
                  ? 'Alternando Conta...'
                  : 'Alternar Conta Imediatamente (Rapid Switch)'}
              </span>
            </button>

            {/* Secondary footer links */}
            <div className="flex items-center justify-between text-[11px] text-slate-400 pt-0.5 px-0.5">
              {onOpenAddAccountModal && (
                <button
                  type="button"
                  onClick={() => {
                    setIsOpen(false);
                    onOpenAddAccountModal();
                  }}
                  className="hover:text-indigo-300 flex items-center gap-1 transition-colors cursor-pointer"
                >
                  <Plus className="w-3 h-3 text-indigo-400" />
                  <span>Adicionar conta</span>
                </button>
              )}
              {onOpenAccountManager && (
                <button
                  type="button"
                  onClick={() => {
                    setIsOpen(false);
                    onOpenAccountManager();
                  }}
                  className="hover:text-indigo-300 flex items-center gap-1 transition-colors cursor-pointer"
                >
                  <Settings className="w-3 h-3 text-slate-400" />
                  <span>Gerenciar contas</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
