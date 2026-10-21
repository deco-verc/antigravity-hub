import React, { useState, useEffect, useRef } from 'react';
import { api } from '../services/api';
import { AnalysisResult, AccountProfile, Project } from '../types';
import { Folder, X, Search, Sparkles, AlertCircle, GitBranch, UserCheck, CheckSquare, Square, Shield, Lock, Cpu, Zap } from 'lucide-react';

const GithubIcon: React.FC<{ className?: string }> = ({ className = "w-4 h-4" }) => (
  <svg className={className} fill="currentColor" viewBox="0 0 24 24">
    <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
  </svg>
);

interface NewProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onProjectCreated: (newProj: any) => void;
  accounts?: AccountProfile[];
  activeAccount?: AccountProfile | null;
}

export const NewProjectModal: React.FC<NewProjectModalProps> = ({
  isOpen,
  onClose,
  onProjectCreated,
  accounts: propAccounts,
  activeAccount: propActiveAccount
}) => {
  const [folderPath, setFolderPath] = useState('');
  const [name, setName] = useState('');
  const [selectedModel, setSelectedModel] = useState('gemini-3.8-flash');
  const [reasoningLevel, setReasoningLevel] = useState<'HIGH' | 'MEDIUM' | 'LOW'>('HIGH');
  const [initGit, setInitGit] = useState(true);
  const [accounts, setAccounts] = useState<AccountProfile[]>(propAccounts || []);
  const [selectedAccountId, setSelectedAccountId] = useState<string>(
    propActiveAccount?.id || (propAccounts && propAccounts.length > 0 ? propAccounts[0].id : '')
  );
  const [objective, setObjective] = useState('');
  const [quickPaths, setQuickPaths] = useState<Array<{ label: string; path: string }>>([]);

  const effectiveAccounts = (accounts && accounts.length > 0)
    ? accounts
    : (propAccounts && propAccounts.length > 0 ? propAccounts : []);

  const computedSlug = name.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'novo-projeto';
  const defaultComputedPath = `C:\\IA\\test-projects\\${computedSlug}`;

  // GitHub integration state
  const [githubAction, setGithubAction] = useState<'create_private' | 'link_existing' | 'none'>('none');
  const [githubRepo, setGithubRepo] = useState('');
  const [githubToken, setGithubToken] = useState('');
  const [showTokenInput, setShowTokenInput] = useState(false);
  const [ghStatus, setGhStatus] = useState<any>(null);

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);

  const resetForm = () => {
    setName('');
    setFolderPath('');
    setObjective('');
    setInitGit(true);
    setSelectedModel('flash');
    setReasoningLevel('HIGH');
    setGithubAction('none');
    setGithubRepo('');
    setGithubToken('');
    setShowTokenInput(false);
    setAnalysis(null);
    setError(null);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  useEffect(() => {
    if (isOpen) {
      if (propAccounts && propAccounts.length > 0) {
        setAccounts(propAccounts);
        const defaultId =
          propActiveAccount?.id ||
          propAccounts.find(a => (a as any).is_active || a.auth_status === 'READY')?.id ||
          propAccounts[0]?.id ||
          '';
        setSelectedAccountId(prev => (prev && propAccounts.some(a => a.id === prev) ? prev : defaultId));
      }

      api.getQuickPaths().then(res => setQuickPaths(res.suggestions || [])).catch(() => {});
      api.getAccountProfiles()
        .then(res => {
          const list: AccountProfile[] = Array.isArray(res) ? res : ((res as any)?.profiles || (res as any)?.accounts || (res as any)?.data || []);
          if (Array.isArray(list) && list.length > 0) {
            setAccounts(list);
            setSelectedAccountId(prev => {
              if (prev && list.some(a => a.id === prev)) return prev;
              const active =
                (propActiveAccount && list.find(a => a.id === propActiveAccount.id)) ||
                list.find(a => (a as any).is_active || a.auth_status === 'READY' || a.auth_status === 'ACTIVE') ||
                list[0];
              return active ? active.id : list[0].id;
            });
          }
        })
        .catch(err => {
          console.warn('Erro ao carregar perfis de conta no NewProjectModal:', err);
        });

      api.getGitHubGlobalStatus().then(st => setGhStatus(st)).catch(() => {});
    }
  }, [isOpen, propAccounts, propActiveAccount]);

  if (!isOpen) return null;

  const handleAnalyze = async () => {
    const targetPath = folderPath.trim() || (name.trim() ? defaultComputedPath : '');
    if (!targetPath) {
      setError('Por favor, informe o caminho de uma pasta ou digite o nome do projeto.');
      return;
    }
    setError(null);
    setIsAnalyzing(true);
    try {
      const res = await api.analyzeFolder(targetPath);
      setAnalysis(res);
      if (!name) setName(res.projectName);
      if (!objective) {
        setObjective(`Desenvolver e aprimorar ${res.projectName} mantendo memória estruturada.`);
      }
    } catch (err: any) {
      setError(err.message || 'Falha ao analisar a pasta selecionada.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingRef.current) return;
    if (!name.trim()) {
      setError('Nome do projeto é obrigatório.');
      return;
    }

    const finalPath = folderPath.trim() || defaultComputedPath;
    const finalSelectedAccountId = selectedAccountId || effectiveAccounts[0]?.id || undefined;

    submittingRef.current = true;
    setIsSubmitting(true);
    setError(null);
    try {
      const res: any = await api.createProject({
        name: name.trim(),
        folderPath: finalPath,
        objective: objective.trim() || `Desenvolver e gerenciar ${name.trim()}`,
        initGit,
        initialProfileId: finalSelectedAccountId,
        selectedModel,
        reasoningLevel,
        githubAction,
        githubRepo: githubRepo.trim() || undefined,
        githubToken: githubToken.trim() || undefined
      });

      // Trata caso a API retorne objeto envelopado { project: ... }
      const rawProj = (res && typeof res === 'object' && res.project) ? res.project : res;

      // Garante que o objeto retornado tenha id, name, path e campos essenciais para seleção imediata
      const safeProject: Project = {
        id: rawProj?.id || crypto.randomUUID(),
        name: rawProj?.name || name.trim(),
        path: rawProj?.path || finalPath,
        objective: rawProj?.objective || objective.trim(),
        description: rawProj?.description || '',
        stack: rawProj?.stack || 'Geral',
        status: rawProj?.status || 'active',
        is_trusted: rawProj?.is_trusted !== undefined ? rawProj.is_trusted : 1,
        full_dev_autonomy: rawProj?.full_dev_autonomy !== undefined ? rawProj.full_dev_autonomy : 1,
        active_account_profile_id: rawProj?.active_account_profile_id || finalSelectedAccountId,
        selected_model: rawProj?.selected_model || selectedModel,
        reasoning_level: rawProj?.reasoning_level || reasoningLevel,
        created_at: rawProj?.created_at || new Date().toISOString(),
        updated_at: rawProj?.updated_at || new Date().toISOString(),
        ...rawProj
      };

      resetForm();
      onProjectCreated(safeProject);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Erro ao registrar o projeto.');
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#0b0d16] border border-[#1e2338] w-full max-w-xl rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        {/* Modal Header */}
        <div className="p-5 border-b border-[#1b2033] bg-[#0e111d] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 flex items-center justify-center">
              <Folder className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Criar ou Conectar Projeto</h3>
              <p className="text-xs text-slate-400">Ambiente e memória persistente no disco local</p>
            </div>
          </div>

          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[#181b28] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-4 flex-1">
          {error && (
            <div role="alert" className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-200 text-xs flex items-start gap-2.5 shadow-sm">
              <AlertCircle className="w-4 h-4 text-rose-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1 font-medium leading-relaxed">{error}</div>
            </div>
          )}

          {/* Quick Paths suggestions */}
          {quickPaths.length > 0 && (
            <div>
              <span className="text-[11px] text-slate-400 block mb-1 font-medium">Sugestões de Pastas Rápidas:</span>
              <div className="flex flex-wrap gap-1.5">
                {quickPaths.map((qp, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      setFolderPath(qp.path);
                      if (!name) setName(qp.label);
                    }}
                    className="px-2 py-0.5 rounded bg-[#121522] hover:bg-[#181d2e] border border-[#1e243a] text-[11px] font-mono text-slate-300 transition-colors"
                  >
                    {qp.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Project Name */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              Nome do Projeto *
            </label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Ex: Simple IDE Test"
              required
              className="w-full bg-[#121522] border border-[#1e243a] focus:border-indigo-500 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none"
            />
          </div>

          {/* Folder Path Input */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-semibold text-slate-300">
                Caminho da Pasta no Computador
              </label>
              <span className="text-[10px] text-slate-400">Opcional (padrão automático)</span>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={folderPath}
                onChange={e => setFolderPath(e.target.value)}
                placeholder={defaultComputedPath}
                className="flex-1 bg-[#121522] border border-[#1e243a] focus:border-indigo-500 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none font-mono"
              />
              {typeof window !== 'undefined' && (window as any).desktopAPI?.selectDirectory && (
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const res = await (window as any).desktopAPI.selectDirectory({
                        defaultPath: folderPath || 'C:\\IA\\test-projects'
                      });
                      if (res && !res.canceled && res.filePaths && res.filePaths.length > 0) {
                        setFolderPath(res.filePaths[0]);
                        if (!name) {
                          const parts = res.filePaths[0].split(/[/\\]/);
                          setName(parts[parts.length - 1] || '');
                        }
                      }
                    } catch {}
                  }}
                  className="px-3 py-2 rounded-lg bg-[#181d2e] hover:bg-[#20273d] border border-[#27304d] text-slate-300 text-xs font-semibold flex items-center gap-1.5 transition-colors"
                  title="Procurar pasta no computador"
                >
                  <Folder className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Procurar</span>
                </button>
              )}
              <button
                type="button"
                onClick={handleAnalyze}
                disabled={isAnalyzing || (!folderPath.trim() && !name.trim())}
                className="px-3 py-2 rounded-lg bg-[#181d2e] hover:bg-[#20273d] border border-[#27304d] disabled:opacity-50 text-indigo-300 text-xs font-semibold flex items-center gap-1.5 transition-colors"
              >
                <Search className="w-3.5 h-3.5 text-cyan-400" />
                <span>{isAnalyzing ? 'Analisando...' : 'Analisar'}</span>
              </button>
            </div>
            <span className="text-[10px] text-slate-500 mt-1 block">
              Se não informada, a pasta será criada em <code className="text-slate-400">{defaultComputedPath}</code>
            </span>
          </div>

          {/* Account Selector */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-semibold text-slate-300">
                Conta Google Inicial
              </label>
              <span className="text-[10px] text-slate-400">
                {effectiveAccounts.length} conta(s) disponível(is)
              </span>
            </div>
            <div className="relative">
              <select
                value={selectedAccountId || effectiveAccounts[0]?.id || ''}
                onChange={e => setSelectedAccountId(e.target.value)}
                className="w-full bg-[#121522] border border-[#1e243a] focus:border-indigo-500 rounded-lg px-3 py-2 text-xs text-white focus:outline-none cursor-pointer"
              >
                {effectiveAccounts.length === 0 ? (
                  <option value="">Conta Padrão do Sistema (Automática)</option>
                ) : (
                  effectiveAccounts.map(acc => {
                    const statusLabel =
                      acc.auth_status === 'READY' || acc.auth_status === 'ACTIVE'
                        ? '● Pronto'
                        : acc.auth_status === 'QUOTA_EXHAUSTED'
                        ? '▲ Cota Esgotada'
                        : acc.auth_status === 'WAITING_LOGIN' || acc.auth_status === 'NEEDS_LOGIN'
                        ? '○ Login Necessário'
                        : '';
                    const label = `${acc.display_name || acc.name || 'Conta Google'}${
                      acc.google_account_label || acc.email ? ` (${acc.google_account_label || acc.email})` : ''
                    }${statusLabel ? ` — ${statusLabel}` : ''}`;
                    return (
                      <option key={acc.id} value={acc.id}>
                        {label}
                      </option>
                    );
                  })
                )}
              </select>
            </div>
            {effectiveAccounts.length > 0 && (
              <div className="mt-1 flex items-center justify-between text-[10px] text-slate-400">
                <span>Vinculada aos workers e tarefas autônomas deste projeto.</span>
                {(() => {
                  const currentSelected = effectiveAccounts.find(
                    a => a.id === (selectedAccountId || effectiveAccounts[0]?.id)
                  );
                  if (!currentSelected) return null;
                  const isReady = currentSelected.auth_status === 'READY' || currentSelected.auth_status === 'ACTIVE';
                  return (
                    <span className={isReady ? 'text-emerald-400 font-medium' : 'text-amber-400 font-medium'}>
                      {isReady ? 'Pronto para uso' : 'Autenticação pendente'}
                    </span>
                  );
                })()}
              </div>
            )}
          </div>

          {/* Model and Reasoning Selectors */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
                <Cpu className="w-3.5 h-3.5 text-indigo-400" />
                <span>Modelo Inicial</span>
              </label>
              <select
                value={selectedModel}
                onChange={e => setSelectedModel(e.target.value)}
                className="w-full bg-[#121522] border border-[#1e243a] focus:border-indigo-500 rounded-lg px-3 py-2 text-xs text-white focus:outline-none cursor-pointer"
              >
                <option value="gemini-3.8-flash">Gemini 3.8 Flash (Recomendado / Rápido)</option>
                <option value="gemini-3.8-pro">Gemini 3.8 Pro (Raciocínio Profundo)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-amber-400" />
                <span>Nível de Raciocínio</span>
              </label>
              <select
                value={reasoningLevel}
                onChange={e => setReasoningLevel(e.target.value as any)}
                className="w-full bg-[#121522] border border-[#1e243a] focus:border-indigo-500 rounded-lg px-3 py-2 text-xs text-white focus:outline-none cursor-pointer"
              >
                <option value="HIGH">Alto (HIGH — Padrão)</option>
                <option value="MEDIUM">Médio (MEDIUM — Equilibrado)</option>
                <option value="LOW">Baixo (LOW — Rápido)</option>
              </select>
            </div>
          </div>

          {/* Git Init Checkbox */}
          <div className="pt-1">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={initGit}
                onChange={e => setInitGit(e.target.checked)}
                className="w-4 h-4 rounded bg-[#121522] border-[#1e243a] text-indigo-600 focus:ring-0 focus:ring-offset-0 cursor-pointer"
              />
              <span className="text-xs text-slate-300 font-medium flex items-center gap-1.5">
                <GitBranch className="w-3.5 h-3.5 text-emerald-400" />
                Inicializar repositório Git local (caso ainda não exista)
              </span>
            </label>
          </div>

          {/* GitHub Repository Integration */}
          <div className="p-3.5 rounded-xl bg-[#0f121d] border border-[#1e2338] space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <GithubIcon className="w-4 h-4 text-slate-300" />
                <span className="text-xs font-bold text-white">Integração com GitHub</span>
              </div>
              {ghStatus?.authenticated && (
                <span className="text-[10px] text-emerald-400 flex items-center gap-1 font-mono">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  @{ghStatus.username || 'deco-verc'}
                </span>
              )}
            </div>

            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setGithubAction('create_private')}
                className={`py-1.5 px-2 rounded-lg text-xs font-semibold border transition-all text-center ${
                  githubAction === 'create_private'
                    ? 'bg-indigo-600/20 border-indigo-500 text-indigo-200'
                    : 'bg-[#141824] border-[#22283d] text-slate-400 hover:text-slate-200'
                }`}
              >
                Criar Privado
              </button>
              <button
                type="button"
                onClick={() => setGithubAction('link_existing')}
                className={`py-1.5 px-2 rounded-lg text-xs font-semibold border transition-all text-center ${
                  githubAction === 'link_existing'
                    ? 'bg-indigo-600/20 border-indigo-500 text-indigo-200'
                    : 'bg-[#141824] border-[#22283d] text-slate-400 hover:text-slate-200'
                }`}
              >
                Vincular Existente
              </button>
              <button
                type="button"
                onClick={() => setGithubAction('none')}
                className={`py-1.5 px-2 rounded-lg text-xs font-semibold border transition-all text-center ${
                  githubAction === 'none'
                    ? 'bg-slate-700/20 border-slate-600 text-slate-200'
                    : 'bg-[#141824] border-[#22283d] text-slate-500 hover:text-slate-300'
                }`}
              >
                Não Integrar
              </button>
            </div>

            {githubAction !== 'none' && (
              <div className="space-y-2 pt-1">
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">
                    {githubAction === 'create_private' ? 'Nome do Repositório GitHub' : 'URL ou owner/repo'}
                  </label>
                  <input
                    type="text"
                    value={githubRepo}
                    onChange={e => setGithubRepo(e.target.value)}
                    placeholder={
                      githubAction === 'create_private'
                        ? (name ? name.toLowerCase().replace(/[^a-z0-9-_]/g, '-') : 'meu-projeto-app')
                        : 'https://github.com/usuario/meu-repo'
                    }
                    className="w-full bg-[#141824] border border-[#22283d] focus:border-indigo-500 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none font-mono"
                  />
                </div>

                <div className="flex items-center justify-between pt-1">
                  <span className="text-[10px] text-slate-400 flex items-center gap-1">
                    <Shield className="w-3 h-3 text-emerald-400 flex-shrink-0" />
                    Proteção de chaves (.env, *.key) ativada no .gitignore
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowTokenInput(!showTokenInput)}
                    className="text-[10px] text-indigo-400 hover:underline flex items-center gap-1"
                  >
                    <Lock className="w-3 h-3" />
                    {showTokenInput ? 'Ocultar PAT' : 'Token Personalizado'}
                  </button>
                </div>

                {showTokenInput && (
                  <div className="pt-1">
                    <input
                      type="password"
                      value={githubToken}
                      onChange={e => setGithubToken(e.target.value)}
                      placeholder="ghp_... (Armazenado com criptografia AES-256-GCM)"
                      className="w-full bg-[#141824] border border-[#22283d] focus:border-indigo-500 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none font-mono"
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Submit */}
          <div className="pt-4 border-t border-[#1b2033] flex justify-end gap-2">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 rounded-lg bg-[#151928] hover:bg-[#1e243a] text-xs text-slate-300 font-medium transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !name.trim()}
              className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold shadow-md shadow-indigo-600/20 transition-all flex items-center gap-1.5"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>{isSubmitting ? 'Criando Projeto...' : 'Criar Projeto'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
