import React, { useState, useEffect } from 'react';
import {
  X,
  Key,
  ShieldCheck,
  AlertTriangle,
  Eye,
  EyeOff,
  Save,
  RotateCw,
  Search,
  ExternalLink,
  Sparkles
} from 'lucide-react';
import { api } from '../services/api';
import { ProjectEnvStudioData, EnvKeyCategory } from '../types';

interface EnvStudioModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  projectName: string;
  onShowToast?: (type: 'success' | 'warn' | 'error', msg: string) => void;
  onKeysSaved?: () => void;
}

const CATEGORY_LABELS: Record<EnvKeyCategory, string> = {
  PAYMENTS: 'Pagamentos & Checkout',
  DATABASE_AUTH: 'Banco de Dados & Autenticação',
  CACHE_RATELIMIT: 'Cache & Rate Limit',
  BOT_PROTECTION: 'Proteção Anti-Bot & Captcha',
  AI_MODELS: 'Modelos & Provedores de IA',
  SERVER_CONFIG: 'Servidor & Portas',
  OTHER: 'Geral / Outros'
};

export const EnvStudioModal: React.FC<EnvStudioModalProps> = ({
  isOpen,
  onClose,
  projectId,
  projectName,
  onShowToast,
  onKeysSaved
}) => {
  const [data, setData] = useState<ProjectEnvStudioData | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    if (isOpen && projectId) {
      loadEnvKeys();
    }
  }, [isOpen, projectId]);

  const loadEnvKeys = async () => {
    setLoading(true);
    try {
      const res = await api.getEnvKeys(projectId);
      setData(res);
      const initial: Record<string, string> = {};
      res.keys.forEach(k => {
        initial[k.key] = k.value || '';
      });
      setFormValues(initial);
    } catch (err: any) {
      onShowToast?.('error', `Falha ao carregar chaves .env: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleSecret = (keyName: string) => {
    setShowSecrets(prev => ({ ...prev, [keyName]: !prev[keyName] }));
  };

  const handleInputChange = (keyName: string, val: string) => {
    setFormValues(prev => ({ ...prev, [keyName]: val }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await api.saveEnvKeys(projectId, formValues);
      onShowToast?.('success', 'Chaves .env salvas com sucesso! O aplicativo foi atualizado com as novas variáveis.');
      if (onKeysSaved) onKeysSaved();
      await loadEnvKeys();
    } catch (err: any) {
      onShowToast?.('error', `Erro ao salvar chaves .env: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  const filteredKeys = (data?.keys || []).filter(k => {
    const matchesCategory = selectedCategory === 'ALL' || k.category === selectedCategory;
    const matchesSearch = !searchTerm || 
      k.key.toLowerCase().includes(searchTerm.toLowerCase()) || 
      k.description.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-4xl max-h-[90vh] bg-[#0c101a] border border-[#1e2538] rounded-2xl shadow-2xl flex flex-col overflow-hidden text-slate-200">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#1e2538] flex items-center justify-between bg-[#0e1320]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <Key className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white tracking-tight">DOCSIMP .env Studio</h2>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300 font-mono border border-indigo-500/30">
                  {projectName}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Gerencie variáveis de produção e simulação com hot-reload automático
              </p>
            </div>
          </div>
          
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[#1a2033] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Stats & Filters Bar */}
        <div className="px-6 py-3 bg-[#0a0d17] border-b border-[#1b2234] flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <span className="text-slate-400">Total:</span>
              <span className="font-mono font-semibold text-white">{data?.totalKeys || 0}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
              <span className="text-slate-400">Chaves Ativas (LIVE):</span>
              <span className="font-mono font-semibold text-emerald-400">{data?.liveCount || 0}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-400"></span>
              <span className="text-slate-400">Mock / Sandbox:</span>
              <span className="font-mono font-semibold text-amber-400">{data?.mockCount || 0}</span>
            </div>
          </div>

          {/* Search Input */}
          <div className="relative min-w-[200px]">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              placeholder="Filtrar por nome ou uso..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 bg-[#121726] border border-[#232c44] rounded-lg text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>

        {/* Category Pills */}
        <div className="px-6 py-2.5 bg-[#0a0d17]/60 border-b border-[#1b2234] flex items-center gap-1.5 overflow-x-auto text-xs scrollbar-none">
          <button
            type="button"
            onClick={() => setSelectedCategory('ALL')}
            className={`px-2.5 py-1 rounded-lg font-medium transition-colors ${
              selectedCategory === 'ALL'
                ? 'bg-indigo-600 text-white'
                : 'text-slate-400 hover:text-slate-200 hover:bg-[#141a2c]'
            }`}
          >
            Todas ({data?.totalKeys || 0})
          </button>
          {(['PAYMENTS', 'DATABASE_AUTH', 'AI_MODELS', 'BOT_PROTECTION', 'CACHE_RATELIMIT', 'SERVER_CONFIG', 'OTHER'] as EnvKeyCategory[]).map(cat => {
            const count = (data?.keys || []).filter(k => k.category === cat).length;
            if (count === 0 && selectedCategory !== cat) return null;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className={`px-2.5 py-1 rounded-lg font-medium transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                  selectedCategory === cat
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-[#141a2c]'
                }`}
              >
                <span>{CATEGORY_LABELS[cat] || cat}</span>
                <span className="text-[10px] px-1 rounded bg-[#1e2538] font-mono">{count}</span>
              </button>
            );
          })}
        </div>

        {/* Content / Keys List */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-500 gap-2">
              <RotateCw className="w-6 h-6 animate-spin text-indigo-400" />
              <p className="text-xs">Carregando chaves de ambiente...</p>
            </div>
          ) : filteredKeys.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-500 text-center">
              <Key className="w-8 h-8 mb-2 opacity-40" />
              <p className="text-sm font-medium text-slate-400">Nenhuma variável de ambiente encontrada</p>
              <p className="text-xs text-slate-500 mt-1 max-w-sm">
                Nenhum arquivo .env ou .env.example foi localizado na raiz do projeto com o filtro selecionado.
              </p>
            </div>
          ) : (
            filteredKeys.map(item => {
              const currentValue = formValues[item.key] ?? item.value;
              const isMasked = item.isSecret && !showSecrets[item.key];
              const isLive = item.rawStatus === 'LIVE';

              return (
                <div
                  key={item.key}
                  className="p-4 rounded-xl bg-[#111522] border border-[#1d2438] hover:border-[#2b3550] transition-colors"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-bold text-white tracking-wide">
                        {item.key}
                      </span>
                      <span className="text-[10px] px-2 py-0.5 rounded bg-[#1a2135] text-slate-300 border border-[#28324f]">
                        {CATEGORY_LABELS[item.category] || item.category}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      {isLive ? (
                        <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[10px] font-semibold flex items-center gap-1">
                          <ShieldCheck className="w-3 h-3 text-emerald-400" />
                          <span>LIVE</span>
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[10px] font-semibold flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3 text-amber-400" />
                          <span>MOCK / SANDBOX</span>
                        </span>
                      )}
                    </div>
                  </div>

                  <p className="text-xs text-slate-400 mb-3 leading-relaxed">
                    {item.description}
                  </p>

                  <div className="relative flex items-center">
                    <input
                      type={isMasked ? 'password' : 'text'}
                      value={currentValue}
                      onChange={e => handleInputChange(item.key, e.target.value)}
                      placeholder={item.defaultValue || 'Insira a chave ou valor...'}
                      className="w-full px-3.5 py-2 bg-[#090c14] border border-[#222a42] rounded-lg text-xs font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition-colors pr-10"
                    />
                    {item.isSecret && (
                      <button
                        type="button"
                        onClick={() => handleToggleSecret(item.key)}
                        className="absolute right-2.5 p-1 text-slate-500 hover:text-slate-300 transition-colors"
                        title={showSecrets[item.key] ? 'Ocultar valor' : 'Visualizar valor'}
                      >
                        {showSecrets[item.key] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-[#0a0d17] border-t border-[#1e2538] flex items-center justify-between">
          <div className="text-xs text-slate-400 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
            <span>As chaves são salvas no arquivo <code className="font-mono text-indigo-300">.env</code> do projeto.</span>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white hover:bg-[#1a2033] transition-colors"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || loading}
              className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold shadow-lg transition-all flex items-center gap-2"
            >
              {saving ? <RotateCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              <span>Salvar e Atualizar</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
