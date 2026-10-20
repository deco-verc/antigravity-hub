import React, { useState } from 'react';
import { FullProjectDetails, ToastMessage } from '../types';
import {
  X,
  Cpu,
  Scale,
  Swords,
  Gauge,
  FileCode,
  FlaskConical,
  Users,
  GitBranch,
  FileText,
  Activity,
  Terminal,
  ExternalLink,
  ShieldCheck,
  Zap,
  CheckCircle2,
  Folder,
  Sparkles
} from 'lucide-react';
import { AutonomousBuildView } from './AutonomousBuildView';
import { AgentContextView } from './AgentContextView';
import { MemoryEditor } from './MemoryEditor';
import { GitStatusView } from './GitStatusView';
import { SystemHealthView } from './SystemHealthView';
import { SystemLogsView } from './SystemLogsView';
import { ModelsUsageTab } from './ModelsUsageTab';
import { AutonomySettingsTab } from './AutonomySettingsTab';
import { AccountProfile } from '../types';

interface AdvancedDashboardModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: FullProjectDetails;
  activeAccount?: AccountProfile | null;
  accounts?: AccountProfile[];
  onRefreshProject: () => void;
  onSaveMemoryFile: (fileName: string, content: string) => Promise<void>;
  onShowToast: (type: ToastMessage['type'], message: string) => void;
  onOpenCouncilModal: () => void;
  onOpenArenaModal: () => void;
  onOpenBenchmarkModal: () => void;
  onOpenProjectProgramModal: () => void;
  onOpenResearchModal: () => void;
  onOpenDiffModal: () => void;
  onOpenTerminal: () => void;
}

type AdvancedTab =
  | 'autonomous'
  | 'models_usage'
  | 'autonomy_settings'
  | 'council_arena'
  | 'benchmarks'
  | 'program_research'
  | 'agents'
  | 'git'
  | 'memory'
  | 'health_logs';

export const AdvancedDashboardModal: React.FC<AdvancedDashboardModalProps> = ({
  isOpen,
  onClose,
  project,
  activeAccount = null,
  accounts = [],
  onRefreshProject,
  onSaveMemoryFile,
  onShowToast,
  onOpenCouncilModal,
  onOpenArenaModal,
  onOpenBenchmarkModal,
  onOpenProjectProgramModal,
  onOpenResearchModal,
  onOpenDiffModal,
  onOpenTerminal
}) => {
  const [activeTab, setActiveTab] = useState<AdvancedTab>('autonomous');

  if (!isOpen) return null;

  const tabs: { id: AdvancedTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'autonomous', label: 'Autonomous Engine', icon: Zap },
    { id: 'models_usage', label: 'Modelos & Uso', icon: Sparkles },
    { id: 'autonomy_settings', label: 'Autonomia & Segurança', icon: ShieldCheck },
    { id: 'council_arena', label: 'Council & Arena', icon: Scale },
    { id: 'benchmarks', label: 'Benchmarks', icon: Gauge },
    { id: 'program_research', label: 'Program & Research', icon: FileCode },
    { id: 'agents', label: 'Agentes & Workers', icon: Users },
    { id: 'git', label: 'Git & Alterações', icon: GitBranch },
    { id: 'memory', label: 'Memória Permanente', icon: FileText },
    { id: 'health_logs', label: 'Saúde & Logs', icon: Activity },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/85 backdrop-blur-md animate-fadeIn">
      <div className="bg-[#0b0e17] border border-[#1e2438] rounded-2xl w-full max-w-7xl h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        {/* 1. Header do Modal Avançado */}
        <div className="px-6 py-4 border-b border-[#1b2033] bg-[#0e121d] flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <Cpu className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-white tracking-tight">DecoHUB — Painel Avançado</h2>
                <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  Power Tools
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Todas as capacidades de inteligência, auto-aprimoramento e auditoria permanecem 100% ativas.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[#1a2030] transition-colors"
              title="Fechar painel avançado"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* 2. Barra de Navegação de Abas Avançadas */}
        <div className="px-6 bg-[#0a0d15] border-b border-[#1b2033] flex items-center gap-1 overflow-x-auto flex-shrink-0">
          {tabs.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-3.5 py-3 text-xs font-semibold border-b-2 transition-all whitespace-nowrap ${
                  isActive
                    ? 'border-indigo-500 text-white bg-indigo-600/10'
                    : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-[#121625]'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-indigo-400' : 'text-slate-500'}`} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* 3. Conteúdo Dinâmico da Aba Selecionada */}
        <div className="flex-1 overflow-hidden flex flex-col bg-[#07090e]">
          {activeTab === 'autonomous' && (
            <div className="flex-1 overflow-y-auto">
              <AutonomousBuildView
                project={project}
                onRefreshProject={onRefreshProject}
                onShowToast={onShowToast}
              />
            </div>
          )}

          {activeTab === 'models_usage' && (
            <ModelsUsageTab
              activeAccount={activeAccount}
              accounts={accounts}
              projectId={project.id}
              onShowToast={onShowToast}
            />
          )}

          {activeTab === 'autonomy_settings' && (
            <AutonomySettingsTab
              projectId={project.id}
              projectName={project.name}
              projectPath={project.path}
              onShowToast={onShowToast}
            />
          )}

          {activeTab === 'council_arena' && (
            <div className="flex-1 overflow-y-auto p-8 max-w-5xl mx-auto w-full space-y-6">
              <div>
                <h3 className="text-base font-bold text-white tracking-tight">Council & Arena de Candidatos</h3>
                <p className="text-xs text-slate-400 mt-1">
                  Mecanismos de deliberação por pares (LLM Council Pattern) e execução em workspaces isolados.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Card Council */}
                <div className="p-6 rounded-2xl bg-[#0e121d] border border-[#1e2438] space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-purple-600/20 border border-purple-500/30 flex items-center justify-center text-purple-400">
                      <Scale className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-white">AI DEV Council</h4>
                      <p className="text-xs text-slate-400">Revisão por pares & síntese de consenso</p>
                    </div>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    Submete as alterações para múltiplos revisores independentes e sintetiza um veredito formal de aprovação.
                  </p>
                  <button
                    type="button"
                    onClick={onOpenCouncilModal}
                    className="w-full py-2.5 px-4 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold transition-all shadow-sm flex items-center justify-center gap-2"
                  >
                    <Scale className="w-4 h-4" />
                    <span>Abrir Janela do Council</span>
                  </button>
                </div>

                {/* Card Arena */}
                <div className="p-6 rounded-2xl bg-[#0e121d] border border-[#1e2438] space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-amber-600/20 border border-amber-500/30 flex items-center justify-center text-amber-400">
                      <Swords className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-white">AI DEV Arena</h4>
                      <p className="text-xs text-slate-400">Torneio competitivo com Git worktrees</p>
                    </div>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    Gera candidatos concorrentes (A vs B) em ambientes limpos e elege a melhor implementação através de testes e métricas.
                  </p>
                  <button
                    type="button"
                    onClick={onOpenArenaModal}
                    className="w-full py-2.5 px-4 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold transition-all shadow-sm flex items-center justify-center gap-2"
                  >
                    <Swords className="w-4 h-4" />
                    <span>Abrir Janela da Arena</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'benchmarks' && (
            <div className="flex-1 overflow-y-auto p-8 max-w-5xl mx-auto w-full space-y-6">
              <div>
                <h3 className="text-base font-bold text-white tracking-tight">Benchmarks & Auto-Aprimoramento (Fase 6)</h3>
                <p className="text-xs text-slate-400 mt-1">
                  Medição objetiva de qualidade, detecção de regressão e suite de validação contínua.
                </p>
              </div>

              <div className="p-6 rounded-2xl bg-[#0e121d] border border-[#1e2438] space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-cyan-600/20 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
                      <Gauge className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-white">Agent Benchmark Suite</h4>
                      <p className="text-xs text-slate-400">Level 1 Fast Benchmarks & Level 2 Real Benchmarks</p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={onOpenBenchmarkModal}
                    className="py-2 px-4 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold transition-all shadow-sm flex items-center gap-2"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Abrir Suite Completa</span>
                  </button>
                </div>

                <p className="text-xs text-slate-300 leading-relaxed">
                  Avalia tempos de resposta, taxa de sucesso de patches, conformidade com diretrizes e taxa de regressão de código.
                </p>
              </div>
            </div>
          )}

          {activeTab === 'program_research' && (
            <div className="flex-1 overflow-y-auto p-8 max-w-5xl mx-auto w-full space-y-6">
              <div>
                <h3 className="text-base font-bold text-white tracking-tight">Project Program & Autoresearch</h3>
                <p className="text-xs text-slate-400 mt-1">
                  Constituição operacional (Karpathy Layer) e loops de exploração heurística.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="p-6 rounded-2xl bg-[#0e121d] border border-[#1e2438] space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                      <FileCode className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-white">Project Program</h4>
                      <p className="text-xs text-slate-400">Constituição Operacional do Projeto</p>
                    </div>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    Define regras invariantes, contratos de aceitação, restrições e padrões que nenhum agente autônomo pode violar.
                  </p>
                  <button
                    type="button"
                    onClick={onOpenProjectProgramModal}
                    className="w-full py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-all shadow-sm flex items-center justify-center gap-2"
                  >
                    <FileCode className="w-4 h-4" />
                    <span>Configurar Project Program</span>
                  </button>
                </div>

                <div className="p-6 rounded-2xl bg-[#0e121d] border border-[#1e2438] space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-purple-600/20 border border-purple-500/30 flex items-center justify-center text-purple-400">
                      <FlaskConical className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-white">Autoresearch Mode</h4>
                      <p className="text-xs text-slate-400">Otimização autônoma por métricas</p>
                    </div>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    Executa iterações focadas em hipóteses, experimentos e pontuação quantitativa para maximizar performance.
                  </p>
                  <button
                    type="button"
                    onClick={onOpenResearchModal}
                    className="w-full py-2.5 px-4 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold transition-all shadow-sm flex items-center justify-center gap-2"
                  >
                    <FlaskConical className="w-4 h-4" />
                    <span>Iniciar Autoresearch</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'agents' && (
            <div className="flex-1 overflow-y-auto">
              <AgentContextView
                project={project}
                onRefreshProject={onRefreshProject}
                onShowToast={onShowToast}
              />
            </div>
          )}

          {activeTab === 'git' && (
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-white">Status do Repositório Git</h3>
                  <p className="text-xs text-slate-400">Inspeção detalhada de branches, commits e diffs.</p>
                </div>
                <button
                  type="button"
                  onClick={onOpenDiffModal}
                  className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-all flex items-center gap-1.5"
                >
                  <GitBranch className="w-3.5 h-3.5" />
                  <span>Ver Diff Visual</span>
                </button>
              </div>
              <GitStatusView
                gitInfo={project.gitInfo}
                onRefresh={onRefreshProject}
              />
            </div>
          )}

          {activeTab === 'memory' && (
            <div className="flex-1 overflow-hidden flex flex-col">
              <MemoryEditor
                projectId={project.id}
                projectPath={project.path}
                memory={project.memory}
                initialFile="project.md"
                onSaveFile={onSaveMemoryFile}
                onRefresh={async () => { onRefreshProject(); }}
              />
            </div>
          )}

          {activeTab === 'health_logs' && (
            <div className="flex-1 overflow-y-auto p-6 space-y-8">
              <div>
                <h3 className="text-sm font-bold text-white mb-2">Saúde do Sistema & Serviços</h3>
                <SystemHealthView />
              </div>

              <div>
                <h3 className="text-sm font-bold text-white mb-2">Logs do Sistema & Auditoria</h3>
                <SystemLogsView />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
