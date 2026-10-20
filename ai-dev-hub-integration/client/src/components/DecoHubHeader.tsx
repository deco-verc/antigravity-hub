import React, { useState, useRef, useEffect } from 'react';
import { FullProjectDetails, AccountProfile } from '../types';
import {
  Play,
  MoreHorizontal,
  Folder,
  Copy,
  Check,
  ExternalLink,
  Terminal,
  Bookmark,
  GitBranch,
  Trash2,
  ChevronDown,
  Info,
  SlidersHorizontal,
  Plus,
  Settings,
  Sparkles,
  Zap,
  Activity
} from 'lucide-react';
import { ModelOption, ModelSelectorValue } from '../types';
import { api } from '../services/api';

interface DecoHubHeaderProps {
  project: FullProjectDetails;
  activeAccount: AccountProfile | null;
  accounts: AccountProfile[];
  onContinue: () => void;
  onOpenCheckpoint: () => void;
  onOpenFolder: () => void;
  onOpenTerminal: () => void;
  onOpenGitDiff: () => void;
  onDeleteProject: () => void;
  onOpenAdvanced: () => void;
  onAccountSwitched: (acc: AccountProfile) => void;
  onOpenAccountManager: () => void;
  onOpenAddAccountModal: () => void;
  isRightPanelOpen: boolean;
  onToggleRightPanel: () => void;
}

export const DecoHubHeader: React.FC<DecoHubHeaderProps> = ({
  project,
  activeAccount,
  accounts,
  onContinue,
  onOpenCheckpoint,
  onOpenFolder,
  onOpenTerminal,
  onOpenGitDiff,
  onDeleteProject,
  onOpenAdvanced,
  onAccountSwitched,
  onOpenAccountManager,
  onOpenAddAccountModal,
  isRightPanelOpen,
  onToggleRightPanel,
}) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  // Models & Usage state
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState<ModelSelectorValue>('auto');
  const [todayUsageCount, setTodayUsageCount] = useState<number>(0);

  const menuRef = useRef<HTMLDivElement>(null);
  const accountRef = useRef<HTMLDivElement>(null);
  const modelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Load discovered models
    api.getModels()
      .then(mods => setAvailableModels(mods))
      .catch(() => {});

    // Load active preference
    api.getModelPreferences(activeAccount?.id, project.id)
      .then(prefs => {
        if (prefs?.default) setSelectedModel(prefs.default);
      })
      .catch(() => {});

    // Load today usage
    loadUsage();
    const timer = setInterval(loadUsage, 15000);
    return () => clearInterval(timer);
  }, [activeAccount?.id, project.id]);

  const loadUsage = () => {
    api.getTodayUsage(activeAccount?.id)
      .then(res => setTodayUsageCount(res.todayExecutions))
      .catch(() => {});
  };

  const handleSelectModel = async (modelId: ModelSelectorValue) => {
    setSelectedModel(modelId);
    setIsModelMenuOpen(false);
    try {
      await api.setModelPreference({
        role: 'default',
        modelId,
        accountProfileId: activeAccount?.id,
        projectId: project.id
      });
    } catch {}
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsMenuOpen(false);
      }
      if (accountRef.current && !accountRef.current.contains(e.target as Node)) {
        setIsAccountMenuOpen(false);
      }
      if (modelRef.current && !modelRef.current.contains(e.target as Node)) {
        setIsModelMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const copyPath = () => {
    navigator.clipboard.writeText(project.path);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <header className="px-6 py-3.5 bg-[#0e111a] border-b border-[#1b2033] flex items-center justify-between flex-shrink-0 z-30">
      {/* 1. Informações do Projeto */}
      <div className="flex items-center gap-3 min-w-0">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-base font-bold text-white tracking-tight truncate">
              {project.name}
            </h1>
            <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-[11px] font-medium flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
              <span>Em andamento</span>
            </span>
          </div>

          <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-400">
            <button
              onClick={copyPath}
              className="font-mono text-[11px] text-slate-400 hover:text-slate-200 transition-colors flex items-center gap-1 truncate max-w-md"
              title="Copiar caminho da pasta"
            >
              <span>{project.path}</span>
              {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-slate-500 opacity-60" />}
            </button>
          </div>
        </div>
      </div>

      {/* 2. Controles Principais */}
      <div className="flex items-center gap-3">
        {/* Botão de Destaque: Continuar */}
        <button
          type="button"
          onClick={onContinue}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white text-xs font-semibold shadow-sm transition-all"
          title="Continuar trabalhando neste projeto"
        >
          <Play className="w-3.5 h-3.5 fill-current" />
          <span>Continuar</span>
        </button>

        {/* Menu ... de Ações Secundárias */}
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="p-2 rounded-lg bg-[#141824] hover:bg-[#1c2234] border border-[#23293d] text-slate-300 hover:text-white transition-colors"
            title="Mais opções do projeto"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>

          {isMenuOpen && (
            <div className="absolute right-0 mt-2 w-56 bg-[#10131d] border border-[#23293d] rounded-xl shadow-xl py-1.5 z-50 text-xs">
              <button
                type="button"
                onClick={() => { setIsMenuOpen(false); onOpenCheckpoint(); }}
                className="w-full text-left px-3.5 py-2 text-slate-300 hover:text-white hover:bg-[#181d2e] flex items-center gap-2.5 transition-colors"
              >
                <Bookmark className="w-3.5 h-3.5 text-indigo-400" />
                <span>Salvar Estado (Checkpoint)</span>
              </button>

              <button
                type="button"
                onClick={() => { setIsMenuOpen(false); onOpenGitDiff(); }}
                className="w-full text-left px-3.5 py-2 text-slate-300 hover:text-white hover:bg-[#181d2e] flex items-center gap-2.5 transition-colors"
              >
                <GitBranch className="w-3.5 h-3.5 text-slate-400" />
                <span>Ver Alterações Git</span>
              </button>

              <button
                type="button"
                onClick={() => { setIsMenuOpen(false); onOpenFolder(); }}
                className="w-full text-left px-3.5 py-2 text-slate-300 hover:text-white hover:bg-[#181d2e] flex items-center gap-2.5 transition-colors"
              >
                <Folder className="w-3.5 h-3.5 text-slate-400" />
                <span>Abrir Pasta no Explorer</span>
              </button>

              <button
                type="button"
                onClick={() => { setIsMenuOpen(false); onOpenTerminal(); }}
                className="w-full text-left px-3.5 py-2 text-slate-300 hover:text-white hover:bg-[#181d2e] flex items-center gap-2.5 transition-colors"
              >
                <Terminal className="w-3.5 h-3.5 text-slate-400" />
                <span>Abrir Terminal</span>
              </button>

              <div className="border-t border-[#1e2333] my-1" />

              <button
                type="button"
                onClick={() => { setIsMenuOpen(false); onOpenAdvanced(); }}
                className="w-full text-left px-3.5 py-2 text-indigo-300 hover:text-indigo-200 hover:bg-[#181d2e] flex items-center gap-2.5 transition-colors"
              >
                <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-400" />
                <span>Painel Avançado</span>
              </button>

              <div className="border-t border-[#1e2333] my-1" />

              <button
                type="button"
                onClick={() => { setIsMenuOpen(false); onDeleteProject(); }}
                className="w-full text-left px-3.5 py-2 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 flex items-center gap-2.5 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Desvincular Projeto</span>
              </button>
            </div>
          )}
        </div>

        {/* Separador sutil */}
        <div className="h-5 w-px bg-[#23293d]" />

        {/* Seletor de Contas Simples */}
        <div className="relative" ref={accountRef}>
          {(() => {
            const getStatusDot = (st?: string) => {
              if (st === 'READY' || st === 'ACTIVE') return 'bg-emerald-400';
              if (st === 'WAITING_LOGIN' || st === 'AUTHENTICATING' || st === 'NEEDS_LOGIN') return 'bg-amber-400 animate-pulse';
              if (st === 'ERROR') return 'bg-rose-400';
              return 'bg-slate-400';
            };

            return (
              <>
                <button
                  type="button"
                  onClick={() => setIsAccountMenuOpen(!isAccountMenuOpen)}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#141824] hover:bg-[#1c2234] border border-[#23293d] text-xs text-slate-200 hover:text-white transition-colors"
                  title="Conta conectada"
                >
                  <span className={`w-2 h-2 rounded-full ${getStatusDot(activeAccount?.auth_status)}`} />
                  <span className="font-medium max-w-[120px] truncate">
                    {activeAccount?.display_name || 'Conta Google'}
                  </span>
                  <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform ${isAccountMenuOpen ? 'rotate-180' : ''}`} />
                </button>

                {isAccountMenuOpen && (
                  <div className="absolute right-0 mt-2 w-64 bg-[#10131d] border border-[#23293d] rounded-xl shadow-xl py-1.5 z-50 text-xs">
                    <div className="px-3 py-1.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                      Contas Google
                    </div>

                    {accounts.map(acc => {
                      const isCur = acc.id === activeAccount?.id;
                      const isWaiting = acc.auth_status === 'WAITING_LOGIN' || acc.auth_status === 'NEEDS_LOGIN';
                      return (
                        <button
                          key={acc.id}
                          type="button"
                          onClick={() => {
                            setIsAccountMenuOpen(false);
                            if (!isCur) onAccountSwitched(acc);
                          }}
                          className={`w-full text-left px-3 py-2 flex items-center justify-between transition-colors ${
                            isCur
                              ? 'bg-indigo-600/10 text-white font-medium'
                              : 'text-slate-300 hover:bg-[#181d2e] hover:text-white'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0 pr-2">
                            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${getStatusDot(acc.auth_status)}`} />
                            <div className="truncate">
                              <div className="truncate flex items-center gap-1.5">
                                <span>{acc.display_name}</span>
                                {isCur && <span className="text-[10px] text-indigo-400 font-mono">(ativo)</span>}
                              </div>
                              <div className={`text-[10px] font-mono truncate ${isWaiting ? 'text-amber-400/80' : 'text-slate-500'}`}>
                                {isWaiting ? 'Aguardando login' : acc.google_account_label || 'Pronta'}
                              </div>
                            </div>
                          </div>
                          {isCur && <Check className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />}
                        </button>
                      );
                    })}

                    <div className="border-t border-[#1e2333] my-1" />

                    <button
                      type="button"
                      onClick={() => { setIsAccountMenuOpen(false); onOpenAddAccountModal(); }}
                      className="w-full text-left px-3 py-2 text-slate-300 hover:text-white hover:bg-[#181d2e] flex items-center gap-2 transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5 text-indigo-400" />
                      <span>+ Adicionar conta</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => { setIsAccountMenuOpen(false); onOpenAccountManager(); }}
                      className="w-full text-left px-3 py-2 text-slate-300 hover:text-white hover:bg-[#181d2e] flex items-center gap-2 transition-colors"
                    >
                      <Settings className="w-3.5 h-3.5 text-slate-400" />
                      <span>Gerenciar contas</span>
                    </button>
                  </div>
                )}
              </>
            );
          })()}
        </div>

        {/* Separador sutil */}
        <div className="h-5 w-px bg-[#23293d]" />

        {/* 3. Seletor de Modelo Dinâmico */}
        <div className="relative" ref={modelRef}>
          {(() => {
            const getModelLabel = (m: ModelSelectorValue) => {
              if (m === 'auto') return 'Automático';
              if (m === 'pro') return 'Gemini Pro';
              if (m === 'flash') return 'Gemini Flash';
              if (m === 'flash_lite') return 'Flash Lite';
              return m;
            };

            return (
              <>
                <button
                  type="button"
                  onClick={() => setIsModelMenuOpen(!isModelMenuOpen)}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#141824] hover:bg-[#1c2234] border border-[#23293d] text-xs text-slate-200 hover:text-white transition-colors"
                  title="Selecionar modelo de IA"
                >
                  <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                  <span className="font-medium max-w-[110px] truncate">
                    {getModelLabel(selectedModel)}
                  </span>
                  <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform ${isModelMenuOpen ? 'rotate-180' : ''}`} />
                </button>

                {isModelMenuOpen && (
                  <div className="absolute right-0 mt-2 w-72 bg-[#10131d] border border-[#23293d] rounded-xl shadow-xl py-1.5 z-50 text-xs">
                    <div className="px-3 py-1.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider flex items-center justify-between">
                      <span>Modelos Antigravity</span>
                      <span className="text-emerald-400 font-mono text-[9px]">Runtime Oficial</span>
                    </div>

                    {/* Opção Automática (Recomendada) */}
                    <button
                      type="button"
                      onClick={() => handleSelectModel('auto')}
                      className={`w-full text-left px-3 py-2.5 flex items-start justify-between transition-colors ${
                        selectedModel === 'auto'
                          ? 'bg-indigo-600/10 text-white font-medium'
                          : 'text-slate-300 hover:bg-[#181d2e] hover:text-white'
                      }`}
                    >
                      <div className="pr-2">
                        <div className="flex items-center gap-1.5 font-medium">
                          <span>Automático</span>
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-300 font-normal">Recomendado</span>
                        </div>
                        <p className="text-[10px] text-slate-400 mt-0.5">
                          Pro para Supervisor/Revisão e Flash para Builders de código.
                        </p>
                      </div>
                      {selectedModel === 'auto' && <Check className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0 mt-0.5" />}
                    </button>

                    <div className="border-t border-[#1e2333] my-1" />

                    {/* Modelos Descobertos */}
                    {availableModels.map(m => {
                      const isCur = selectedModel === m.id;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => handleSelectModel(m.id as ModelSelectorValue)}
                          className={`w-full text-left px-3 py-2 flex items-start justify-between transition-colors ${
                            isCur
                              ? 'bg-indigo-600/10 text-white font-medium'
                              : 'text-slate-300 hover:bg-[#181d2e] hover:text-white'
                          }`}
                        >
                          <div className="pr-2">
                            <div className="flex items-center gap-1.5 font-medium">
                              <span>{m.displayName}</span>
                              <span className="text-[10px] font-mono text-slate-400">({m.family})</span>
                            </div>
                            <p className="text-[10px] text-slate-400 mt-0.5 line-clamp-1">
                              {m.description}
                            </p>
                          </div>
                          {isCur && <Check className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0 mt-0.5" />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            );
          })()}
        </div>

        {/* 4. Contador de Uso Hoje */}
        <div
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#141824]/60 border border-[#23293d]/80 text-xs text-slate-300 select-none"
          title={`Uso registrado localmente hoje para esta conta: ${todayUsageCount} execuções`}
        >
          <Activity className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-slate-400">Uso:</span>
          <span className="font-semibold text-slate-100 font-mono">{todayUsageCount}</span>
          <span className="text-[10px] text-slate-400">hoje</span>
        </div>

        {/* Botão de Toggle do Painel Direito (Sobre o Projeto) */}
        <button
          type="button"
          onClick={onToggleRightPanel}
          className={`p-2 rounded-lg border transition-colors ${
            isRightPanelOpen
              ? 'bg-indigo-600/20 border-indigo-500/40 text-indigo-300'
              : 'bg-[#141824] hover:bg-[#1c2234] border-[#23293d] text-slate-400 hover:text-slate-200'
          }`}
          title="Alternar painel de detalhes do projeto"
        >
          <Info className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};
