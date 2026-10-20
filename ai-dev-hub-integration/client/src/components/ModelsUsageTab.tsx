import React, { useState, useEffect } from 'react';
import { ModelOption, ModelSelectorValue, UsageSummary, UsageEvent, AccountProfile, ToastMessage } from '../types';
import { api } from '../services/api';
import {
  Sparkles,
  Zap,
  Activity,
  Check,
  Clock,
  Shield,
  Layers,
  BarChart3,
  Cpu,
  Info,
  Calendar,
  AlertCircle
} from 'lucide-react';

interface ModelsUsageTabProps {
  activeAccount: AccountProfile | null;
  accounts: AccountProfile[];
  projectId?: string;
  onShowToast: (type: ToastMessage['type'], message: string) => void;
}

export const ModelsUsageTab: React.FC<ModelsUsageTabProps> = ({
  activeAccount,
  accounts,
  projectId,
  onShowToast
}) => {
  const [models, setModels] = useState<ModelOption[]>([]);
  const [preferences, setPreferences] = useState<Record<string, ModelSelectorValue>>({
    default: 'auto',
    supervisor: 'auto',
    builder: 'auto',
    reviewer: 'auto',
    council: 'auto'
  });
  const [usageSummary, setUsageSummary] = useState<UsageSummary | null>(null);
  const [recentEvents, setRecentEvents] = useState<UsageEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingRole, setSavingRole] = useState<string | null>(null);

  const roles = [
    {
      id: 'default',
      title: 'Padrão Geral / Chat',
      desc: 'Modelo padrão utilizado em interações diretas e tarefas sem atribuição explícita de papel.',
      recommended: 'auto'
    },
    {
      id: 'supervisor',
      title: 'Supervisor & Planejamento',
      desc: 'Responsável por decompor briefings em DAG de tarefas, analisar riscos e formular contratos.',
      recommended: 'pro'
    },
    {
      id: 'builder',
      title: 'Builder (Workers de Código)',
      desc: 'Responsável pela escrita cirúrgica de código, refatorações, criação de testes e execução no terminal.',
      recommended: 'flash'
    },
    {
      id: 'reviewer',
      title: 'Revisão & Code Review',
      desc: 'Avaliação de diffs, conformidade de contratos e validação com o Evaluator Independente.',
      recommended: 'pro'
    },
    {
      id: 'council',
      title: 'Conselho (AI Council)',
      desc: 'Deliberação por múltiplos avaliadores para aprovação de arquitetura e mudanças críticas.',
      recommended: 'pro'
    }
  ];

  useEffect(() => {
    loadData();
  }, [activeAccount?.id, projectId]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [mods, prefs, stats] = await Promise.all([
        api.getModels().catch(() => []),
        api.getModelPreferences(activeAccount?.id, projectId).catch(() => ({ default: 'auto' as ModelSelectorValue })),
        api.getUsageStats(activeAccount?.id).catch(() => ({ summary: null, recent: [] }))
      ]);

      setModels(mods);
      if (prefs) setPreferences(prefs);
      if (stats?.summary) setUsageSummary(stats.summary);
      if (stats?.recent) setRecentEvents(stats.recent);
    } catch (err: any) {
      onShowToast('error', `Falha ao carregar modelos e uso: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handlePreferenceChange = async (role: string, modelId: ModelSelectorValue) => {
    setSavingRole(role);
    try {
      const res = await api.setModelPreference({
        role,
        modelId,
        accountProfileId: activeAccount?.id,
        projectId
      });
      setPreferences(res.preferences);
      onShowToast('success', `Preferência para [${role}] atualizada com sucesso!`);
    } catch (err: any) {
      onShowToast('error', `Falha ao salvar preferência: ${err.message}`);
    } finally {
      setSavingRole(null);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-8 max-w-6xl mx-auto w-full space-y-8 animate-fadeIn">
      {/* 1. Header com Status Geral */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-[#1b2033]">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-white tracking-tight">Modelos de IA & Telemetria de Uso</h2>
            <span className="px-2.5 py-0.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-xs font-medium">
              Runtime Antigravity
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1.5">
            Configure o modelo de inteligência artificial atribuído a cada papel do sistema e acompanhe execuções locais verificadas.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">Conta Ativa:</span>
          <span className="px-3 py-1 rounded-lg bg-[#141824] border border-[#23293d] text-xs font-medium text-slate-200">
            {activeAccount?.display_name || 'Conta Principal'}
          </span>
        </div>
      </div>

      {/* 2. Cartões de Resumo de Uso Real */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-5 rounded-2xl bg-[#0e121d] border border-[#1e2438] relative overflow-hidden">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-medium">Execuções Hoje</span>
            <Activity className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold text-white font-mono">
            {usageSummary?.todayExecutions || 0}
          </div>
          <span className="text-[11px] text-slate-500 mt-1 block">sessões de agentes concluídas</span>
        </div>

        <div className="p-5 rounded-2xl bg-[#0e121d] border border-[#1e2438] relative overflow-hidden">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-medium">Tempo de Execução Hoje</span>
            <Clock className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="text-2xl font-bold text-white font-mono">
            {usageSummary?.todayDurationSeconds ? `${usageSummary.todayDurationSeconds}s` : '0s'}
          </div>
          <span className="text-[11px] text-slate-500 mt-1 block">duração combinada de tarefas</span>
        </div>

        <div className="p-5 rounded-2xl bg-[#0e121d] border border-[#1e2438] relative overflow-hidden">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-medium">Histórico Total</span>
            <BarChart3 className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="text-2xl font-bold text-white font-mono">
            {usageSummary?.allTimeExecutions || 0}
          </div>
          <span className="text-[11px] text-slate-500 mt-1 block">execuções nesta máquina</span>
        </div>

        <div className="p-5 rounded-2xl bg-[#0e121d] border border-[#1e2438] relative overflow-hidden">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-medium">Cota & Tokens</span>
            <Shield className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-xs font-medium text-amber-300 mt-1">
            Indisponível no Runtime
          </div>
          <span className="text-[10px] text-slate-500 mt-1 block">
            A CLI Antigravity não exporta medidor numérico de tokens
          </span>
        </div>
      </div>

      {/* 3. Matriz de Atribuição de Modelos por Papel */}
      <div className="space-y-4">
        <div>
          <h3 className="text-base font-bold text-white tracking-tight">Atribuição de Modelos por Papel</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Personalize qual modelo executa cada função dentro do ecossistema autônomo do DecoHUB.
          </p>
        </div>

        <div className="rounded-2xl bg-[#0e121d] border border-[#1e2438] overflow-hidden divide-y divide-[#181d2e]">
          {roles.map(r => {
            const currentVal = preferences[r.id] || 'auto';
            return (
              <div key={r.id} className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="max-w-xl">
                  <div className="flex items-center gap-2.5">
                    <h4 className="text-sm font-bold text-white">{r.title}</h4>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-[#161c2d] text-slate-300 font-mono">
                      {r.id}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                    {r.desc}
                  </p>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  <select
                    value={currentVal}
                    disabled={savingRole === r.id}
                    onChange={(e) => handlePreferenceChange(r.id, e.target.value as ModelSelectorValue)}
                    className="bg-[#141824] border border-[#23293d] rounded-xl px-3.5 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 transition-colors font-medium min-w-[180px]"
                  >
                    <option value="auto">Automático ({r.recommended === 'pro' ? 'Pro' : 'Flash'})</option>
                    {models.map(m => (
                      <option key={m.id} value={m.id} disabled={!m.available}>
                        {m.displayName} ({m.family})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 4. Modelos Descobertos no Runtime Oficial */}
      <div className="space-y-4">
        <div>
          <h3 className="text-base font-bold text-white tracking-tight">Catálogo Descoberto no Runtime Antigravity</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Modelos aceitos diretamente pelos parâmetros da CLI oficial do Antigravity (<code className="text-indigo-400">agentapi new-conversation --model</code>).
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {models.map(m => (
            <div key={m.id} className="p-5 rounded-2xl bg-[#0e121d] border border-[#1e2438] flex flex-col justify-between space-y-4">
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${m.available ? 'bg-emerald-400' : 'bg-slate-500'}`}></span>
                    <h4 className="text-sm font-bold text-white">{m.displayName}</h4>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                    {m.id}
                  </span>
                </div>
                <div className="text-xs text-slate-400 mt-1 font-mono">{m.family}</div>
                <p className="text-xs text-slate-300 mt-3 leading-relaxed">
                  {m.description}
                </p>
              </div>

              <div className="pt-3 border-t border-[#181d2e] flex items-center justify-between text-[11px] text-slate-400">
                <span>Raciocínio: <strong className="text-slate-200 capitalize">{m.reasoning}</strong></span>
                <span>Velocidade: <strong className="text-slate-200 capitalize">{m.speed}</strong></span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 5. Histórico Recente de Execuções */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-white tracking-tight">Execuções Recentes Verificadas</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Modelo solicitado e duração local. O modelo efetivo só é confirmado quando o runtime expõe essa informação.
            </p>
          </div>
        </div>

        <div className="rounded-2xl bg-[#0e121d] border border-[#1e2438] overflow-hidden">
          {recentEvents.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400">
              Nenhuma execução registrada recentemente para esta conta.
            </div>
          ) : (
            <div className="divide-y divide-[#181d2e] max-h-80 overflow-y-auto">
              {recentEvents.map(ev => (
                <div key={ev.id} className="p-4 flex items-center justify-between text-xs hover:bg-[#121624] transition-colors">
                  <div className="flex items-center gap-3 min-w-0 pr-4">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400"></span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-white capitalize">{ev.role}</span>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#181d2e] text-indigo-300">
                          {ev.model_id}
                        </span>
                        {ev.status === 'success' ? (
                          <span className="text-[10px] text-emerald-400">✓ Concluído</span>
                        ) : (
                          <span className="text-[10px] text-rose-400">✗ Falha</span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                        {ev.conversation_id ? `Conv: ${ev.conversation_id.slice(0, 12)}...` : 'Sessão sem ID'}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 flex-shrink-0 text-right">
                    <span className="font-mono text-slate-300 font-medium">{ev.duration_ms}ms</span>
                    <span className="text-[11px] text-slate-500">{new Date(ev.timestamp).toLocaleTimeString()}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
