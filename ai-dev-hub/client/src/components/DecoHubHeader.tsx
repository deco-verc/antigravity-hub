import React, { useState, useRef, useEffect } from 'react';
import { FullProjectDetails, AccountProfile, AutonomousRun, ModelOption, ModelSelectorValue } from '../types';
import {
  MoreHorizontal,
  Folder,
  Copy,
  Check,
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
  Activity,
  AlertTriangle,
  Lock,
  Pause,
  Play,
  RotateCw,
  Zap
} from 'lucide-react';
import { api } from '../services/api';

interface DecoHubHeaderProps {
  project: FullProjectDetails;
  run?: AutonomousRun | null;
  executionError?: string | null;
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
  run,
  executionError,
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
  const [isConfigMenuOpen, setIsConfigMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isRapidSwitching, setIsRapidSwitching] = useState(false);

  const handleRapidSwitch = async (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (isRapidSwitching) return;
    setIsRapidSwitching(true);
    try {
      const res = await api.rapidSwitchAccount({ projectId: project.id });
      if (res.activeProfile) {
        onAccountSwitched(res.activeProfile);
      }
    } catch (err: any) {
      console.error('Falha no Rapid Switch:', err);
    } finally {
      setIsRapidSwitching(false);
    }
  };

  // Models & Usage state scoped to project
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState<ModelSelectorValue>(
    (project.selected_model as ModelSelectorValue) || 'auto'
  );

  const menuRef = useRef<HTMLDivElement>(null);
  const configRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Load available models from system
    api.getModels()
      .then(mods => setAvailableModels(mods))
      .catch(() => {});

    // Load active preference for this project
    api.getModelPreferences(activeAccount?.id, project.id)
      .then(prefs => {
        if (prefs?.default) setSelectedModel(prefs.default);
      })
      .catch(() => {});
  }, [activeAccount?.id, project.id]);

  const handleSelectModel = async (modelId: ModelSelectorValue) => {
    setSelectedModel(modelId);
    try {
      await api.setModelPreference({
        role: 'default',
        modelId,
        accountProfileId: activeAccount?.id,
        projectId: project.id
      });
      await api.updateProject(project.id, { selected_model: modelId } as any);
    } catch {}
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsMenuOpen(false);
      }
      if (configRef.current && !configRef.current.contains(e.target as Node)) {
        setIsConfigMenuOpen(false);
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

  // Truthful status badge derivation across all 8 official states
  const getStatusBadge = () => {
    if (executionError) {
      return (
        <span className="px-2 py-0.5 rounded-full bg-rose-500/15 border border-rose-500/30 text-rose-300 text-[11px] font-medium flex items-center gap-1.5" title={executionError}>
          <Lock className="w-3 h-3 text-rose-400" />
          <span>Execução bloqueada</span>
        </span>
      );
    }

    if (!run) {
      return (
        <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 text-[11px] font-medium flex items-center gap-1.5 border border-slate-700">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
          <span>Pronto</span>
        </span>
      );
    }

    const st = run.status;
    if (st === 'running' || st === 'building' || st === 'testing' || st === 'reviewing' || st === 'waiting_for_worker') {
      const label = st === 'building' ? 'Worker implementando' : st === 'testing' ? 'Evaluator verificando' : st === 'reviewing' ? 'Supervisor revisando' : 'Executando';
      return (
        <span className="px-2 py-0.5 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 text-[11px] font-medium flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse"></span>
          <span>{label}</span>
        </span>
      );
    }

    if (st === 'planning') {
      return (
        <span className="px-2 py-0.5 rounded-full bg-purple-500/15 border border-purple-500/30 text-purple-300 text-[11px] font-medium flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse"></span>
          <span>Planejando</span>
        </span>
      );
    }

    if (st === 'waiting_approval') {
      return (
        <span className="px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[11px] font-medium flex items-center gap-1.5">
          <AlertTriangle className="w-3 h-3 text-amber-400" />
          <span>Aguardando aprovação</span>
        </span>
      );
    }

    if (st === 'waiting_resource') {
      return (
        <span className="px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/40 text-amber-200 text-[11px] font-medium flex items-center gap-1.5" title={run.last_error || 'Aguardando recurso externo ou runtime'}>
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span>
          <span>Aguardando recurso</span>
        </span>
      );
    }

    if (st === 'blocked') {
      return (
        <span className="px-2 py-0.5 rounded-full bg-rose-500/15 border border-rose-500/30 text-rose-300 text-[11px] font-medium flex items-center gap-1.5" title={run.last_error || 'Execução impedida por bloqueio externo ou dependência'}>
          <Lock className="w-3 h-3 text-rose-400" />
          <span>Execução bloqueada</span>
        </span>
      );
    }

    if (st === 'error') {
      return (
        <span className="px-2 py-0.5 rounded-full bg-rose-500/15 border border-rose-500/30 text-rose-300 text-[11px] font-medium flex items-center gap-1.5" title={run.last_error || 'Falha técnica na execução'}>
          <AlertTriangle className="w-3 h-3 text-rose-400" />
          <span>Com erro</span>
        </span>
      );
    }

    if (st === 'paused') {
      return (
        <span className="px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-300 text-[11px] font-medium flex items-center gap-1.5">
          <Pause className="w-3 h-3 text-slate-400" />
          <span>Pausado</span>
        </span>
      );
    }

    if (st === 'completed') {
      return (
        <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[11px] font-medium flex items-center gap-1.5">
          <Check className="w-3 h-3 text-emerald-400" />
          <span>Concluído</span>
        </span>
      );
    }

    return (
      <span className="px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-300 text-[11px] font-medium">
        {st}
      </span>
    );
  };

  const getModelLabel = (m: ModelSelectorValue) => {
    if (m === 'auto') return 'Auto (3.8 Flash)';
    if (m === 'pro') return 'Gemini Pro';
    if (m === 'flash') return 'Gemini 3.8 Flash';
    if (m === 'flash_lite') return 'Flash Lite';
    return String(m);
  };

  const getAccountDot = (st?: string) => {
    if (st === 'READY' || st === 'ACTIVE') return 'bg-emerald-400';
    if (st === 'WAITING_LOGIN' || st === 'AUTHENTICATING' || st === 'NEEDS_LOGIN') return 'bg-amber-400 animate-pulse';
    if (st === 'QUOTA_EXHAUSTED') return 'bg-amber-400';
    if (st === 'ERROR') return 'bg-rose-400';
    return 'bg-slate-400';
  };

  return (
    <header className="px-6 py-3 bg-[#0e111a] border-b border-[#1b2033] flex items-center justify-between flex-shrink-0 z-30 select-none">
      {/* 1. Informações do Projeto & Status da Execução */}
      <div className="flex items-center gap-3 min-w-0">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-base font-bold text-white tracking-tight truncate">
              {project.name}
            </h1>
            {getStatusBadge()}
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

      {/* 2. Controles Unificados do Projeto */}
      <div className="flex items-center gap-3">
        {/* Indicador e Seletor Unificado de IA do Projeto */}
        <div className="relative" ref={configRef}>
          <button
            type="button"
            onClick={() => setIsConfigMenuOpen(!isConfigMenuOpen)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#141824] hover:bg-[#1c2234] border border-[#23293d] text-xs text-slate-200 hover:text-white transition-colors"
            title="Configuração de Conta e Modelo de IA deste projeto"
          >
            <span className={`w-2 h-2 rounded-full ${getAccountDot(activeAccount?.auth_status)}`} />
            <span className="font-medium max-w-[110px] truncate">
              {activeAccount?.display_name || 'Conta Antigravity'}
            </span>
            <span className="text-slate-500 font-mono">·</span>
            <span className="text-indigo-300 font-medium max-w-[110px] truncate">
              {getModelLabel(selectedModel)}
            </span>
            <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform ${isConfigMenuOpen ? 'rotate-180' : ''}`} />
          </button>

          {isConfigMenuOpen && (
            <div className="absolute right-0 mt-2 w-72 bg-[#10131d] border border-[#23293d] rounded-xl shadow-xl py-2 z-50 text-xs">
              {/* Seção 1: Conta do Projeto */}
              <div className="px-3.5 pb-1 text-[10px] font-semibold text-slate-500 uppercase tracking-wider flex items-center justify-between">
                <span>Conta do Projeto</span>
                <button
                  type="button"
                  disabled={isRapidSwitching}
                  onClick={handleRapidSwitch}
                  className="flex items-center gap-1 text-[10px] text-indigo-400 hover:text-indigo-300 font-medium transition-colors disabled:opacity-50"
                  title="Alternar em 1 clique para a próxima conta READY"
                >
                  <Zap className={`w-3 h-3 ${isRapidSwitching ? 'animate-pulse text-amber-400' : ''}`} />
                  <span>Rapid Switch</span>
                </button>
              </div>

              {accounts.map(acc => {
                const isCur = acc.id === activeAccount?.id;
                const isWaiting = acc.auth_status === 'WAITING_LOGIN' || acc.auth_status === 'NEEDS_LOGIN';
                return (
                  <button
                    key={acc.id}
                    type="button"
                    onClick={() => {
                      onAccountSwitched(acc);
                    }}
                    className={`w-full text-left px-3.5 py-1.5 flex items-center justify-between transition-colors ${
                      isCur
                        ? 'bg-indigo-600/10 text-white font-medium'
                        : 'text-slate-300 hover:bg-[#181d2e] hover:text-white'
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${getAccountDot(acc.auth_status)}`} />
                      <span className="truncate">{acc.display_name}</span>
                      {isWaiting && <span className="text-[10px] text-amber-400 font-mono">(login necessário)</span>}
                    </div>
                    {isCur && <Check className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />}
                  </button>
                );
              })}

              <div className="px-3.5 pt-1.5 pb-1 flex items-center justify-between text-[11px] border-t border-[#1e2333] mt-1.5">
                <button
                  type="button"
                  onClick={() => { setIsConfigMenuOpen(false); onOpenAddAccountModal(); }}
                  className="text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" />
                  <span>Adicionar conta</span>
                </button>
                <button
                  type="button"
                  onClick={() => { setIsConfigMenuOpen(false); onOpenAccountManager(); }}
                  className="text-slate-400 hover:text-slate-200 flex items-center gap-1"
                >
                  <Settings className="w-3 h-3" />
                  <span>Gerenciar</span>
                </button>
              </div>

              {/* Seção 2: Modelo do Projeto */}
              <div className="border-t border-[#1e2333] my-1.5" />
              <div className="px-3.5 pb-1 text-[10px] font-semibold text-slate-500 uppercase tracking-wider flex items-center justify-between">
                <span>Modelo de IA do Projeto</span>
                <span className="text-emerald-400 font-mono text-[9px]">Oficial</span>
              </div>

              <button
                type="button"
                onClick={() => handleSelectModel('auto')}
                className={`w-full text-left px-3.5 py-1.5 flex items-center justify-between transition-colors ${
                  selectedModel === 'auto'
                    ? 'bg-indigo-600/10 text-white font-medium'
                    : 'text-slate-300 hover:bg-[#181d2e] hover:text-white'
                }`}
              >
                <div>
                  <div className="flex items-center gap-1">
                    <span>Automático</span>
                    <span className="text-[10px] px-1 py-0.2 rounded bg-indigo-500/20 text-indigo-300">Recomendado</span>
                  </div>
                  <p className="text-[10px] text-slate-400">Gemini 3.8 Flash · Raciocínio HIGH</p>
                </div>
                {selectedModel === 'auto' && <Check className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />}
              </button>

              <button
                type="button"
                onClick={() => handleSelectModel('pro')}
                className={`w-full text-left px-3.5 py-1.5 flex items-center justify-between transition-colors ${
                  selectedModel === 'pro'
                    ? 'bg-indigo-600/10 text-white font-medium'
                    : 'text-slate-300 hover:bg-[#181d2e] hover:text-white'
                }`}
              >
                <div>
                  <div className="font-medium text-slate-200">Gemini Pro</div>
                  <p className="text-[10px] text-slate-400">Raciocínio analítico avançado</p>
                </div>
                {selectedModel === 'pro' && <Check className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />}
              </button>

              <button
                type="button"
                onClick={() => handleSelectModel('flash')}
                className={`w-full text-left px-3.5 py-1.5 flex items-center justify-between transition-colors ${
                  selectedModel === 'flash'
                    ? 'bg-indigo-600/10 text-white font-medium'
                    : 'text-slate-300 hover:bg-[#181d2e] hover:text-white'
                }`}
              >
                <div>
                  <div className="font-medium text-slate-200">Gemini 3.8 Flash</div>
                  <p className="text-[10px] text-slate-400">Rápido, econômico e preciso</p>
                </div>
                {selectedModel === 'flash' && <Check className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />}
              </button>
            </div>
          )}
        </div>

        {/* Botão Rapid Switch 1-Clique */}
        <button
          type="button"
          disabled={isRapidSwitching}
          onClick={handleRapidSwitch}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/30 text-xs text-indigo-300 hover:text-white transition-colors disabled:opacity-50"
          title="Troca Rápida de Conta (Rapid Switch 1-Clique para próxima conta READY)"
        >
          <Zap className={`w-3.5 h-3.5 ${isRapidSwitching ? 'animate-pulse text-amber-400' : 'text-indigo-400'}`} />
          <span className="font-medium hidden sm:inline">Rapid Switch</span>
        </button>

        {/* Botão de Diagnóstico & Observabilidade */}
        <button
          type="button"
          onClick={onOpenAdvanced}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#141824] hover:bg-[#1c2234] border border-[#23293d] text-slate-300 hover:text-white text-xs font-medium transition-colors"
          title="Abrir Observabilidade, Logs e Diagnóstico"
        >
          <Activity className="w-3.5 h-3.5 text-indigo-400" />
          <span>Diagnóstico</span>
        </button>

        {/* Menu ... de Ações Secundárias */}
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="p-1.5 rounded-lg bg-[#141824] hover:bg-[#1c2234] border border-[#23293d] text-slate-300 hover:text-white transition-colors"
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

        {/* Botão de Toggle do Painel Direito (Sobre o Projeto) */}
        <button
          type="button"
          onClick={onToggleRightPanel}
          className={`p-1.5 rounded-lg border transition-colors ${
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
