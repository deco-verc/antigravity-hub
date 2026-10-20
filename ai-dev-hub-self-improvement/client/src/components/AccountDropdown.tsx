import React, { useState, useEffect, useRef } from 'react';
import { AccountProfile } from '../types';
import { api } from '../services/api';
import { ChevronDown, Plus, Check, RefreshCw, UserCheck, ShieldAlert, Sparkles, Settings } from 'lucide-react';

interface AccountDropdownProps {
  projectId: string | null;
  accounts: AccountProfile[];
  activeAccount: AccountProfile | null;
  onAccountSwitched: (newAccount: AccountProfile) => void;
  onOpenAddAccountModal: () => void;
  onOpenAccountManager?: () => void;
  onShowToast: (type: 'info' | 'success' | 'warn' | 'error', msg: string) => void;
}

export const AccountDropdown: React.FC<AccountDropdownProps> = ({
  projectId,
  accounts,
  activeAccount,
  onAccountSwitched,
  onOpenAddAccountModal,
  onOpenAccountManager,
  onShowToast,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);


  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelectAccount = async (target: AccountProfile) => {
    if (!target || target.id === activeAccount?.id) {
      setIsOpen(false);
      return;
    }

    if (!projectId) {
      onAccountSwitched(target);
      setIsOpen(false);
      return;
    }

    setIsSwitching(true);
    setIsOpen(false);
    try {
      onShowToast('info', `Alternando para "${target.display_name}" (salvando Git e checkpoint)...`);
      const result = await api.switchProjectAccount(projectId, target.id);
      onAccountSwitched(result.activeProfile);
      onShowToast('success', `Conta ativa alterada para "${result.activeProfile.display_name}". Contexto preservado.`);
    } catch (err: any) {
      onShowToast('error', `Falha ao alternar conta: ${err.message}`);
    } finally {
      setIsSwitching(false);
    }
  };

  const getStatusDot = (status: string) => {
    switch (status) {
      case 'READY':
        return 'bg-emerald-400 shadow-emerald-400/50 shadow-sm';
      case 'AUTHENTICATING':
        return 'bg-yellow-400 animate-pulse';
      case 'NEEDS_LOGIN':
        return 'bg-amber-400';
      case 'QUOTA_EXHAUSTED':
        return 'bg-amber-400 shadow-amber-400/50 shadow-sm';
      case 'ERROR':
        return 'bg-rose-400';
      default:
        return 'bg-slate-400';
    }
  };

  const currentDisplay = activeAccount?.display_name || 'Conta Google';

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Dropdown Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        disabled={isSwitching}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all ${
          isOpen
            ? 'bg-[#1b2033] border-indigo-500 text-white shadow-md shadow-indigo-500/10'
            : 'bg-[#121520] hover:bg-[#181d2e] border-[#252b42] text-slate-200 hover:text-white'
        }`}
        title="Selecionar Conta Google para execução"
      >
        <span className={`w-2 h-2 rounded-full ${getStatusDot(activeAccount?.auth_status || 'READY')}`} />
        <span className="font-medium tracking-tight truncate max-w-[140px]">{currentDisplay}</span>
        {isSwitching ? (
          <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-400" />
        ) : (
          <ChevronDown className={`w-3.5 h-3.5 text-[#7e87aa] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        )}
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-72 bg-[#0e111a] border border-[#23293d] rounded-2xl shadow-2xl overflow-hidden z-50 animate-in fade-in zoom-in-95 duration-150">
          <div className="px-3 py-2 bg-[#141824] border-b border-[#23293d] flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">
              Contas Google Conectadas
            </span>
            <span className="text-[10px] text-[#7e87aa] font-mono">
              {accounts.length} disponíveis
            </span>
          </div>

          <div className="p-1.5 space-y-1 max-h-64 overflow-y-auto">
            {accounts.map(acc => {
              const isCurrent = acc.id === activeAccount?.id;
              return (
                <button
                  key={acc.id}
                  onClick={() => handleSelectAccount(acc)}
                  className={`w-full flex items-center justify-between p-2.5 rounded-xl text-left transition-colors ${
                    isCurrent
                      ? 'bg-indigo-600/15 border border-indigo-500/30 text-white'
                      : 'hover:bg-[#181d2e] text-slate-300 border border-transparent'
                  }`}
                >
                  <div className="min-w-0 pr-2">
                    <div className="flex items-center gap-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${getStatusDot(acc.auth_status)}`} />
                      <span className="text-xs font-semibold truncate text-white">
                        {acc.display_name}
                      </span>
                    </div>
                    <div className="text-[11px] text-[#7e87aa] truncate font-mono mt-0.5">
                      {acc.google_account_label || '(Login pendente)'}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 flex-shrink-0">
                    {isCurrent && (
                      <Check className="w-4 h-4 text-indigo-400" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="p-2 bg-[#121520] border-t border-[#23293d] flex flex-col gap-1.5">
            {onOpenAccountManager && (
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  onOpenAccountManager();
                }}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-[#1a1f33] hover:bg-[#252b45] text-indigo-300 hover:text-white text-xs font-semibold border border-indigo-500/25 active:scale-95 transition-all"
              >
                <Settings className="w-3.5 h-3.5" />
                <span>⚙️ GERENCIADOR DE CONTAS</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                onOpenAddAccountModal();
              }}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/20 active:scale-95 transition-all"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>+ ADICIONAR CONTA</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
