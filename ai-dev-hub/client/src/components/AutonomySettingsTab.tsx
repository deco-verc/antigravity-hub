import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import { NativeExecutionSettings } from './NativeExecutionSettings';
import { ToastMessage, ProjectAutonomy, SystemSettingsResponse } from '../types';
import {
  ShieldCheck,
  ShieldAlert,
  Shield,
  Zap,
  CheckCircle2,
  AlertTriangle,
  Lock,
  Cpu,
  PackageCheck,
  RefreshCw,
  Terminal,
  FileCheck
} from 'lucide-react';

interface AutonomySettingsTabProps {
  projectId: string;
  projectName: string;
  projectPath: string;
  onShowToast: (type: ToastMessage['type'], message: string) => void;
}

export const AutonomySettingsTab: React.FC<AutonomySettingsTabProps> = ({
  projectId,
  projectName,
  projectPath,
  onShowToast
}) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [globalAutonomy, setGlobalAutonomy] = useState(true);
  const [projectAutonomy, setProjectAutonomy] = useState<ProjectAutonomy | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [settingsRes, autonomyRes] = await Promise.all([
        api.getSettings(),
        api.getProjectAutonomy(projectId)
      ]);
      setGlobalAutonomy(settingsRes.fullDevAutonomyDefault);
      setProjectAutonomy(autonomyRes);
    } catch (err: any) {
      onShowToast('error', `Falha ao carregar configurações de autonomia: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [projectId]);

  const handleToggleGlobal = async () => {
    const nextVal = !globalAutonomy;
    setGlobalAutonomy(nextVal);
    setSaving(true);
    try {
      await api.updateSettings({ fullDevAutonomyDefault: nextVal });
      onShowToast('success', `Autonomia global padrão ${nextVal ? 'ativada' : 'desativada'}.`);
    } catch (err: any) {
      onShowToast('error', `Erro ao salvar configuração global: ${err.message}`);
      setGlobalAutonomy(!nextVal);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleProjectTrusted = async () => {
    if (!projectAutonomy) return;
    const nextTrusted = !projectAutonomy.isTrusted;
    setSaving(true);
    try {
      await api.updateProjectAutonomy(projectId, {
        isTrusted: nextTrusted,
        fullDevAutonomy: projectAutonomy.fullDevAutonomy
      });
      setProjectAutonomy({ ...projectAutonomy, isTrusted: nextTrusted });
      onShowToast('success', `Status de confiança do projeto atualizado.`);
    } catch (err: any) {
      onShowToast('error', `Erro ao atualizar projeto: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleProjectAutonomy = async () => {
    if (!projectAutonomy) return;
    const nextAutonomy = !projectAutonomy.fullDevAutonomy;
    setSaving(true);
    try {
      await api.updateProjectAutonomy(projectId, {
        isTrusted: projectAutonomy.isTrusted,
        fullDevAutonomy: nextAutonomy
      });
      setProjectAutonomy({ ...projectAutonomy, fullDevAutonomy: nextAutonomy });
      onShowToast('success', `Nível de autonomia operacional atualizado.`);
    } catch (err: any) {
      onShowToast('error', `Erro ao atualizar projeto: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const isTrusted = projectAutonomy?.isTrusted ?? true;
  const isFullAutonomy = projectAutonomy?.fullDevAutonomy ?? true;
  const isEffectivelyActive = isTrusted && isFullAutonomy;
  const isEffectivelySupervised = isTrusted && !isFullAutonomy;
  const isEffectivelyBlocked = !isTrusted;

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center p-12 text-slate-400">
        <RefreshCw className="w-6 h-6 animate-spin text-indigo-400 mr-3" />
        <span className="text-sm">Carregando matriz de autonomia e segurança...</span>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-8 max-w-5xl mx-auto w-full space-y-8 animate-fadeIn">
      <NativeExecutionSettings projectId={projectId}/>
      {/* 1. Cabeçalho de Contexto */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-indigo-400" />
          <h3 className="text-base font-bold text-white tracking-tight">
            Autonomia Operacional & Matriz de Segurança
          </h3>
        </div>
        <p className="text-xs text-slate-400 leading-relaxed">
          A autonomia do projeto e as permissões efetivas do Antigravity são controles distintos. A escolha acima não altera suas configurações globais.
        </p>
      </div>

      {/* 2. Grid de Configurações */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Card 1: Configuração Global */}
        <div className="p-6 rounded-2xl bg-[#0e121d] border border-[#1e2438] space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                <Cpu className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-white">Política Global do DecoHUB</h4>
                <p className="text-xs text-slate-400">Padrão do sistema para novos projetos</p>
              </div>
            </div>

            <button
              type="button"
              disabled={saving}
              onClick={handleToggleGlobal}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                globalAutonomy ? 'bg-indigo-600' : 'bg-slate-700'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  globalAutonomy ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          <p className="text-xs text-slate-300 leading-relaxed">
            Permite que o Worker e o Supervisor executem tarefas de ponta a ponta em projetos confiáveis sem interromper o fluxo para cada comando do terminal.
          </p>

          <div className="pt-2 border-t border-[#1b2033] flex items-center gap-2 text-[11px] text-slate-400">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            <span>Configuração persistida em <code className="text-indigo-300">system_settings</code></span>
          </div>
        </div>

        {/* Card 2: Configuração deste Projeto */}
        <div className="p-6 rounded-2xl bg-[#0e121d] border border-[#1e2438] space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-purple-600/20 border border-purple-500/30 flex items-center justify-center text-purple-400">
                <Shield className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-white">Projeto: {projectName}</h4>
                <p className="text-xs text-slate-400 font-mono truncate max-w-[200px]">{projectPath}</p>
              </div>
            </div>

            {/* Effective status badge */}
            {isEffectivelyActive && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[10px] font-bold">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                TOTALMENTE ATIVO
              </span>
            )}
            {isEffectivelySupervised && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[10px] font-bold">
                <span className="w-2 h-2 rounded-full bg-amber-400" />
                SUPERVISIONADO
              </span>
            )}
            {isEffectivelyBlocked && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-500/15 border border-rose-500/30 text-rose-300 text-[10px] font-bold">
                <span className="w-2 h-2 rounded-full bg-rose-400" />
                BLOQUEADO
              </span>
            )}
          </div>

          <div className="space-y-3 pt-1">
            {/* Toggle 1: is_trusted */}
            <label className="flex items-center justify-between cursor-pointer p-2.5 rounded-xl bg-[#080a11] border border-[#1b2033] hover:border-[#28314d] transition-colors">
              <div>
                <span className="text-xs font-semibold text-white block">Workspace Confiável</span>
                <span className="text-[10px] text-slate-400">Autoriza operações de terminal dentro do diretório</span>
              </div>
              <input
                type="checkbox"
                checked={isTrusted}
                onChange={handleToggleProjectTrusted}
                disabled={saving}
                className="rounded border-[#2a3147] bg-[#161a2b] text-indigo-600 focus:ring-0 focus:ring-offset-0 cursor-pointer"
              />
            </label>

            {/* Toggle 2: full_dev_autonomy */}
            <label className="flex items-center justify-between cursor-pointer p-2.5 rounded-xl bg-[#080a11] border border-[#1b2033] hover:border-[#28314d] transition-colors">
              <div>
                <span className="text-xs font-semibold text-white block">Autonomia Total de Desenvolvimento</span>
                <span className="text-[10px] text-slate-400">Instala pacotes e executa testes rotineiros sem prompt</span>
              </div>
              <input
                type="checkbox"
                checked={isFullAutonomy}
                onChange={handleToggleProjectAutonomy}
                disabled={saving || !isTrusted}
                className="rounded border-[#2a3147] bg-[#161a2b] text-indigo-600 focus:ring-0 focus:ring-offset-0 cursor-pointer disabled:opacity-40"
              />
            </label>
          </div>

          {/* Ambiente Detectado */}
          {projectAutonomy?.environment && (
            <div className="pt-2 border-t border-[#1b2033] flex items-center gap-3 text-[11px] text-slate-400">
              <PackageCheck className="w-4 h-4 text-indigo-400" />
              <span>Stack: <strong className="text-white">{projectAutonomy.environment.stack}</strong></span>
              <span>•</span>
              <span>Gerenciador: <strong className="text-white">{projectAutonomy.environment.packageManager}</strong></span>
              <span>•</span>
              <span>Testes: <strong className="text-emerald-400">{projectAutonomy.environment.hasTests ? 'Detectados' : 'N/A'}</strong></span>
            </div>
          )}
        </div>
      </div>

      {/* 3. Matriz Determinística de Permissões (GREEN / ORANGE / RED) */}
      <div className="p-6 rounded-2xl bg-[#0e121d] border border-[#1e2438] space-y-4">
        <h4 className="text-sm font-bold text-white flex items-center gap-2">
          <Terminal className="w-4 h-4 text-indigo-400" />
          Matriz Determinística de Segurança (PolicyEngine)
        </h4>
        <p className="text-xs text-slate-400">
          A segurança do DecoHUB é garantida deterministicamente no código do servidor, fora dos prompts do modelo de linguagem.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
          {/* Coluna GREEN */}
          <div className="p-4 rounded-xl bg-emerald-950/20 border border-emerald-500/20 space-y-2">
            <div className="flex items-center gap-2 text-emerald-400 font-bold text-xs uppercase tracking-wider">
              <CheckCircle2 className="w-4 h-4" />
              GREEN — Autonomia Total
            </div>
            <ul className="text-[11px] text-slate-300 space-y-1.5 list-disc list-inside">
              <li>Instalação rotineira de pacotes (<code className="text-emerald-300">npm install</code>, <code className="text-emerald-300">pnpm</code>, <code className="text-emerald-300">yarn</code>)</li>
              <li>Criação e edição de arquivos do projeto</li>
              <li>Execução de testes (<code className="text-emerald-300">npm test</code>, <code className="text-emerald-300">node --test</code>)</li>
              <li>Build local e compilação TypeScript</li>
              <li>Ciclo de autocorreção em caso de falha de teste</li>
            </ul>
          </div>

          {/* Coluna ORANGE */}
          <div className="p-4 rounded-xl bg-amber-950/20 border border-amber-500/20 space-y-2">
            <div className="flex items-center gap-2 text-amber-400 font-bold text-xs uppercase tracking-wider">
              <AlertTriangle className="w-4 h-4" />
              ORANGE — Decisão do Supervisor
            </div>
            <ul className="text-[11px] text-slate-300 space-y-1.5 list-disc list-inside">
              <li>Adição de bibliotecas pesadas de terceiros</li>
              <li>Migrações estruturais de banco de dados</li>
              <li>Refatoração de rotas e arquitetura principal</li>
              <li>Replanejamento de marcos e backlog</li>
            </ul>
          </div>

          {/* Coluna RED */}
          <div className="p-4 rounded-xl bg-rose-950/20 border border-rose-500/20 space-y-2">
            <div className="flex items-center gap-2 text-rose-400 font-bold text-xs uppercase tracking-wider">
              <Lock className="w-4 h-4" />
              RED — Bloqueio Estrito & Proteção
            </div>
            <ul className="text-[11px] text-slate-300 space-y-1.5 list-disc list-inside">
              <li>Enfraquecimento ou adulteração de testes (Anti-Weakening Guard)</li>
              <li>Remoção de asserções originais ou inserção de <code className="text-rose-300">.skip</code></li>
              <li>Comandos fora do projeto (<code className="text-rose-300">rmdir /s</code>, <code className="text-rose-300">rm -rf /</code>)</li>
              <li>Alteração de arquivos de sistema (C:\Windows)</li>
              <li>Push forçado (<code className="text-rose-300">git push --force</code>)</li>
              <li>Exclusão de banco de produção (<code className="text-rose-300">drop database</code>)</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};
