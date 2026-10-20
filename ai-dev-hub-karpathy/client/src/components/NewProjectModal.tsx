import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import { AnalysisResult, AccountProfile } from '../types';
import { Folder, X, Search, Sparkles, AlertCircle, GitBranch, UserCheck, CheckSquare, Square, Shield, Lock } from 'lucide-react';

const GithubIcon: React.FC<{ className?: string }> = ({ className = "w-4 h-4" }) => (
  <svg className={className} fill="currentColor" viewBox="0 0 24 24">
    <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
  </svg>
);

interface NewProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onProjectCreated: (newProj: any) => void;
}

export const NewProjectModal: React.FC<NewProjectModalProps> = ({
  isOpen,
  onClose,
  onProjectCreated
}) => {
  const [folderPath, setFolderPath] = useState('');
  const [name, setName] = useState('');
  const [initGit, setInitGit] = useState(true);
  const [accounts, setAccounts] = useState<AccountProfile[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [objective, setObjective] = useState('');
  const [quickPaths, setQuickPaths] = useState<Array<{ label: string; path: string }>>([]);

  // GitHub integration state
  const [githubAction, setGithubAction] = useState<'create_private' | 'link_existing' | 'none'>('create_private');
  const [githubRepo, setGithubRepo] = useState('');
  const [githubToken, setGithubToken] = useState('');
  const [showTokenInput, setShowTokenInput] = useState(false);
  const [ghStatus, setGhStatus] = useState<any>(null);

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      api.getQuickPaths().then(res => setQuickPaths(res.suggestions || [])).catch(() => {});
      api.getAccountProfiles().then(list => {
        setAccounts(list);
        if (list.length > 0 && !selectedAccountId) {
          setSelectedAccountId(list[0].id);
        }
      }).catch(() => {});
      api.getGitHubGlobalStatus().then(st => setGhStatus(st)).catch(() => {});
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleAnalyze = async () => {
    if (!folderPath.trim()) {
      setError('Por favor, informe o caminho de uma pasta.');
      return;
    }
    setError(null);
    setIsAnalyzing(true);
    try {
      const res = await api.analyzeFolder(folderPath.trim());
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
    if (!folderPath.trim() || !name.trim()) {
      setError('Nome do projeto e caminho da pasta são obrigatórios.');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const newProj = await api.createProject({
        name: name.trim(),
        folderPath: folderPath.trim(),
        objective: objective.trim() || `Desenvolver e gerenciar ${name.trim()}`,
        initGit,
        initialProfileId: selectedAccountId || undefined,
        githubAction,
        githubRepo: githubRepo.trim() || undefined,
        githubToken: githubToken.trim() || undefined
      });
      onProjectCreated(newProj);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Erro ao registrar o projeto.');
    } finally {
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
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[#181b28] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-4 flex-1">
          {error && (
            <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
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
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              Caminho da Pasta no Computador *
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={folderPath}
                onChange={e => setFolderPath(e.target.value)}
                placeholder="Ex: C:\IA\test-projects\simple-ide-test"
                required
                className="flex-1 bg-[#121522] border border-[#1e243a] focus:border-indigo-500 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none font-mono"
              />
              <button
                type="button"
                onClick={handleAnalyze}
                disabled={isAnalyzing || !folderPath.trim()}
                className="px-3 py-2 rounded-lg bg-[#181d2e] hover:bg-[#20273d] border border-[#27304d] disabled:opacity-50 text-indigo-300 text-xs font-semibold flex items-center gap-1.5 transition-colors"
              >
                <Search className="w-3.5 h-3.5 text-cyan-400" />
                <span>{isAnalyzing ? 'Analisando...' : 'Analisar'}</span>
              </button>
            </div>
            <span className="text-[10px] text-slate-500 mt-1 block">
              Se a pasta não existir, ela será criada automaticamente.
            </span>
          </div>

          {/* Account Selector */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              Conta Google Inicial
            </label>
            <div className="relative">
              <select
                value={selectedAccountId}
                onChange={e => setSelectedAccountId(e.target.value)}
                className="w-full bg-[#121522] border border-[#1e243a] focus:border-indigo-500 rounded-lg px-3 py-2 text-xs text-white focus:outline-none cursor-pointer"
              >
                {accounts.map(acc => (
                  <option key={acc.id} value={acc.id}>
                    {acc.display_name} ({acc.google_account_label || acc.profile_name})
                  </option>
                ))}
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
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-[#151928] hover:bg-[#1e243a] text-xs text-slate-300 font-medium transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !name.trim() || !folderPath.trim()}
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
