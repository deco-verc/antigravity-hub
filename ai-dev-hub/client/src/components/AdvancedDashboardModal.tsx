import React, { useState, useEffect } from 'react';
import { FullProjectDetails, ToastMessage, AccountProfile, AutonomousRun } from '../types';
import { api } from '../services/api';
import {
  X,
  Cpu,
  Activity,
  Terminal,
  ShieldCheck,
  GitBranch,
  Sliders,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Clock,
  Sparkles,
  Layers,
  Scale,
  Swords,
  Gauge,
  FileCode,
  FileText,
  Copy,
  Check,
  Info,
  Lock,
  Pause,
  Play,
  RotateCw
} from 'lucide-react';
import { AutonomousBuildView } from './AutonomousBuildView';
import { AgentContextView } from './AgentContextView';
import { MemoryEditor } from './MemoryEditor';
import { GitStatusView } from './GitStatusView';
import { SystemHealthView } from './SystemHealthView';
import { SystemLogsView } from './SystemLogsView';
import { ModelsUsageTab } from './ModelsUsageTab';
import { AutonomySettingsTab } from './AutonomySettingsTab';
import { DecoHubObservabilityView } from './DecoHubObservabilityView';

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

// Exactly the 8 official diagnostic categories requested for unequivocal execution transparency
export type DiagnosticSectionId =
  | 'execution_state'    // 1. Estado da execução
  | 'errors_recovery'     // 2. Erros e recuperação
  | 'antigravity_runtime' // 3. Runtime Antigravity
  | 'account_model'       // 4. Conta e modelo
  | 'tasks_reviews'       // 5. Tarefas e revisões
  | 'tests_evidence'      // 6. Testes e evidências
  | 'git_publish'         // 7. Git e publicação
  | 'technical_logs'      // 8. Logs técnicos
  | 'advanced_tools';     // Ferramentas complementares (Council, Arena, Benchmarks, Program, Memória)

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
  const [activeSection, setActiveSection] = useState<DiagnosticSectionId>('execution_state');
  const [activeRun, setActiveRun] = useState<AutonomousRun | null>(null);
  const [copiedError, setCopiedError] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);

  useEffect(() => {
    if (isOpen) {
      api.getActiveAutonomousRun(project.id)
        .then(run => setActiveRun(run))
        .catch(() => setActiveRun(null));
    }
  }, [isOpen, project.id]);

  if (!isOpen) return null;

  // Executive layer calculations
  const totalTasks = activeRun?.tasks?.length || 0;
  const completedTasks = activeRun?.tasks?.filter(t => t.status === 'completed').length || 0;
  const progressPct = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const isBlocked = activeRun?.status === 'blocked';
  const isError = activeRun?.status === 'error';
  const isWaitingResource = activeRun?.status === 'waiting_resource';
  const isWaitingApproval = activeRun?.status === 'waiting_approval';
  const isPaused = activeRun?.status === 'paused';
  const isRunning = activeRun && ['running', 'building', 'testing', 'reviewing', 'waiting_for_worker'].includes(activeRun.status);
  const isPlanning = activeRun?.status === 'planning';
  const isCompleted = activeRun?.status === 'completed';

  const sections: { id: DiagnosticSectionId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'execution_state', label: '1. Diagnóstico do Estado', icon: Activity },
    { id: 'errors_recovery', label: '2. Erros e recuperação', icon: AlertTriangle },
    { id: 'antigravity_runtime', label: '3. Runtime Antigravity', icon: Cpu },
    { id: 'account_model', label: '4. Conta e modelo', icon: Sparkles },
    { id: 'tasks_reviews', label: '5. Tarefas e revisões', icon: CheckCircle2 },
    { id: 'tests_evidence', label: '6. Testes e evidências', icon: ShieldCheck },
    { id: 'git_publish', label: '7. Git e publicação', icon: GitBranch },
    { id: 'technical_logs', label: '8. Logs técnicos de auditoria', icon: Terminal },
    { id: 'advanced_tools', label: 'Ferramentas de Engenharia', icon: Sliders }
  ];

  const handleCopyError = () => {
    if (activeRun?.last_error) {
      navigator.clipboard.writeText(activeRun.last_error);
      setCopiedError(true);
      setTimeout(() => setCopiedError(false), 2000);
    }
  };

  const handleResumeRun = async () => {
    if (!activeRun) return;
    setIsRetrying(true);
    try {
      await api.resumeAutonomousRun(activeRun.id);
      onShowToast('success', 'Comando de retomada enviado ao motor autônomo.');
      const updated = await api.getActiveAutonomousRun(project.id);
      setActiveRun(updated);
      onRefreshProject();
    } catch (err: any) {
      onShowToast('error', `Falha ao retomar execução: ${err.message}`);
    } finally {
      setIsRetrying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/85 backdrop-blur-md animate-fadeIn">
      <div className="bg-[#0b0e17] border border-[#1e2438] rounded-2xl w-full max-w-7xl h-[94vh] flex flex-col shadow-2xl overflow-hidden">
        {/* 1. Header do Painel de Diagnóstico */}
        <div className="px-6 py-3.5 border-b border-[#1b2033] bg-[#0e121d] flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <Activity className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-white tracking-tight">DecoHUB — Painel Avançado: Diagnóstico & Transparência da Execução</h2>
                <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  {project.name}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Visão transparente em 8 categorias oficiais: estado real, causas de parada, runtime e evidências de validação.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[#1a2030] transition-colors"
            title="Fechar painel avançado"
            aria-label="Fechar painel avançado"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 2. Camada Executiva (Executive Layer) no topo com dados 100% transparentes */}
        <div className="bg-[#090b12] border-b border-[#1b2033] p-4 flex-shrink-0">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            {/* Estado Geral inequívoco */}
            <div className="p-3 rounded-xl bg-[#101422] border border-[#1d2338] space-y-1">
              <div className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Estado Geral</div>
              <div className="flex items-center gap-1.5 font-semibold text-xs">
                {isError ? (
                  <span className="text-rose-400 flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" /> Com erro
                  </span>
                ) : isBlocked ? (
                  <span className="text-rose-400 flex items-center gap-1">
                    <Lock className="w-3.5 h-3.5" /> Bloqueado
                  </span>
                ) : isWaitingResource ? (
                  <span className="text-amber-400 flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" /> Aguardando recurso
                  </span>
                ) : isWaitingApproval ? (
                  <span className="text-amber-400 flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5" /> Aguardando aprovação
                  </span>
                ) : isPaused ? (
                  <span className="text-slate-300 flex items-center gap-1">
                    <Pause className="w-3.5 h-3.5 text-slate-400" /> Pausado
                  </span>
                ) : isPlanning ? (
                  <span className="text-purple-400 flex items-center gap-1 animate-pulse">
                    <Sparkles className="w-3.5 h-3.5" /> Planejando
                  </span>
                ) : isRunning ? (
                  <span className="text-indigo-400 flex items-center gap-1 animate-pulse">
                    <Activity className="w-3.5 h-3.5" /> Executando
                  </span>
                ) : isCompleted ? (
                  <span className="text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Concluído
                  </span>
                ) : (
                  <span className="text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Pronto / Ocioso
                  </span>
                )}
              </div>
            </div>

            {/* Run / Ator Ativo */}
            <div className="p-3 rounded-xl bg-[#101422] border border-[#1d2338] space-y-1">
              <div className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Run Ativo</div>
              <div className="text-xs font-semibold text-white truncate" title={activeRun ? `Modo ${activeRun.autonomy_mode}` : 'Nenhum'}>
                {isRunning
                  ? (activeRun?.status === 'building' ? 'Worker (Código)' : activeRun?.status === 'testing' ? 'Evaluator (Testes)' : activeRun?.status === 'reviewing' ? 'Supervisor (Revisão)' : 'Supervisor / Worker')
                  : isPlanning ? 'Supervisor (Planejando)' : isWaitingApproval ? 'Aguardando Usuário' : isBlocked || isError ? 'Execução Interrompida' : 'Nenhum (Ocioso)'}
              </div>
              <div className="text-[10px] text-slate-400 truncate">
                {activeRun ? `Modo ${activeRun.autonomy_mode}` : 'Pronto para novas tarefas'}
              </div>
            </div>

            {/* Próxima Ação Prevista */}
            <div className="p-3 rounded-xl bg-[#101422] border border-[#1d2338] space-y-1 md:col-span-2">
              <div className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Próxima Ação</div>
              <div className="text-xs font-mono text-indigo-300 truncate" title={activeRun?.next_action || 'Pronto para receber instruções'}>
                {activeRun?.next_action || (isBlocked || isError ? 'Resolver bloqueio para continuar' : 'Pronto para receber instruções de engenharia')}
              </div>
              <div className="text-[10px] text-slate-400">
                {isBlocked || isError ? 'Ação corretiva necessária' : isRunning ? 'Execução autônoma em andamento' : 'Aguardando comando'}
              </div>
            </div>

            {/* Progresso Transparente */}
            <div className="p-3 rounded-xl bg-[#101422] border border-[#1d2338] space-y-1">
              <div className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Progresso Real</div>
              <div className="text-xs font-bold text-slate-200">
                {totalTasks > 0 ? `${completedTasks} de ${totalTasks} tarefas` : 'Nenhuma tarefa'}
              </div>
              <div className="text-[10px] text-slate-400">
                {totalTasks > 0
                  ? (isBlocked || isError
                      ? `${progressPct}% concluído (1 pendente de correção)`
                      : `${progressPct}% concluído`)
                  : 'Plano não iniciado'}
              </div>
            </div>

            {/* Git e Integração */}
            <div className="p-3 rounded-xl bg-[#101422] border border-[#1d2338] space-y-1">
              <div className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Git & Remoto</div>
              <div className="text-xs font-mono text-slate-200 truncate flex items-center gap-1">
                <GitBranch className="w-3 h-3 text-indigo-400 flex-shrink-0" />
                <span className="truncate">{project.gitInfo?.branch || 'main'}</span>
              </div>
              <div className="text-[10px] text-slate-400 truncate">
                {project.github_repo || 'Repositório local'}
              </div>
            </div>
          </div>
        </div>

        {/* 3. Barra de Abas das 8 Categorias Oficiais */}
        <div className="px-6 bg-[#0a0d15] border-b border-[#1b2033] flex items-center gap-2 overflow-x-auto flex-shrink-0">
          {sections.map(section => {
            const Icon = section.icon;
            const isActive = activeSection === section.id;
            return (
              <button
                key={section.id}
                type="button"
                onClick={() => setActiveSection(section.id)}
                className={`flex items-center gap-2 px-3.5 py-3 text-xs font-semibold border-b-2 transition-all whitespace-nowrap ${
                  isActive
                    ? 'border-indigo-500 text-white bg-indigo-600/10'
                    : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-[#121625]'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-indigo-400' : 'text-slate-500'}`} />
                <span>{section.label}</span>
              </button>
            );
          })}
        </div>

        {/* 4. Conteúdo Estruturado da Categoria Selecionada */}
        <div className="flex-1 overflow-hidden flex flex-col bg-[#07090e]">
          {/* Categoria 1: Estado da execução */}
          {activeSection === 'execution_state' && (
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Resumo em Linguagem Comum */}
              <div className="p-4 rounded-xl bg-[#0e121d] border border-[#1e2438] space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Activity className="w-4 h-4 text-indigo-400" />
                    Resumo do Estado da Execução
                  </h3>
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 font-medium">
                    {activeRun ? `Modo: ${activeRun.autonomy_mode}` : 'Sem execução ativa'}
                  </span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {isRunning && 'O sistema está executando ativamente tarefas no projeto com um Worker operacional.'}
                  {isPlanning && 'O Supervisor está organizando o plano de tarefas e analisando dependências.'}
                  {isWaitingApproval && 'A execução está pausada aguardando sua autorização expressa para uma ação crítica.'}
                  {isWaitingResource && 'A execução está aguardando um recurso externo ou serviço local ficar disponível.'}
                  {isBlocked && 'A execução foi interrompida porque um critério de aceitação ou dependência não foi satisfeito.'}
                  {isError && 'Ocorreu uma falha na execução que requer verificação de diagnóstico.'}
                  {isPaused && 'A execução foi pausada intencionalmente pelo usuário.'}
                  {isCompleted && 'Todas as tarefas do plano foram concluídas e verificadas com sucesso.'}
                  {!activeRun && 'O sistema está saudável e pronto para receber uma nova solicitação no chat.'}
                </p>
              </div>

              {/* Detalhes Técnicos sob Demanda */}
              <div className="p-4 rounded-xl bg-[#0b0e17] border border-[#1b2033] space-y-3">
                <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Metadados Técnicos da Execução</h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                  <div className="p-3 rounded-lg bg-[#111522] border border-[#1e2438]">
                    <span className="text-slate-400 block text-[11px]">ID da Execução (Run)</span>
                    <span className="font-mono text-slate-200 text-xs">{activeRun?.id || 'Nenhum run ativo'}</span>
                  </div>
                  <div className="p-3 rounded-lg bg-[#111522] border border-[#1e2438]">
                    <span className="text-slate-400 block text-[11px]">Status Interno do Motor</span>
                    <span className="font-mono text-indigo-300 text-xs">{activeRun?.status || 'idle'}</span>
                  </div>
                  <div className="p-3 rounded-lg bg-[#111522] border border-[#1e2438]">
                    <span className="text-slate-400 block text-[11px]">Branch Alvo Git</span>
                    <span className="font-mono text-slate-200 text-xs">{(activeRun as any)?.target_branch || project.gitInfo?.branch || 'main'}</span>
                  </div>
                </div>

                {activeRun && (
                  <div className="pt-2">
                    <AutonomySettingsTab
                      projectId={project.id}
                      projectName={project.name}
                      projectPath={project.path}
                      onShowToast={onShowToast}
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Categoria 2: Erros e recuperação */}
          {activeSection === 'errors_recovery' && (
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Resumo em Linguagem Comum */}
              <div className="p-4 rounded-xl bg-[#0e121d] border border-[#1e2438] space-y-2">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                  Diagnóstico de Erros & Ações de Recuperação
                </h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {activeRun?.last_error ? (
                    <>
                      A execução encontrou um obstáculo técnico. Abaixo você confere a causa exata identificada e o comando para retomar ou corrigir a situação com segurança.
                    </>
                  ) : (
                    <>
                      Nenhum erro ativo registrado. O sistema está operando em conformidade com as regras de qualidade.
                    </>
                  )}
                </p>
              </div>

              {activeRun?.last_error ? (
                <div className="space-y-4">
                  {/* Card de Ação Recomendada */}
                  <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-between gap-4">
                    <div className="space-y-1">
                      <div className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                        <AlertCircle className="w-4 h-4 text-amber-400" />
                        Ação Recomendada para Destravar
                      </div>
                      <p className="text-xs text-slate-300">
                        {activeRun.next_action || 'Revise a última tarefa ou envie uma instrução de correção no chat.'}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={isRetrying}
                      onClick={handleResumeRun}
                      className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold transition-all flex items-center gap-1.5 flex-shrink-0"
                    >
                      <RotateCw className={`w-3.5 h-3.5 ${isRetrying ? 'animate-spin' : ''}`} />
                      <span>{isRetrying ? 'Retomando...' : 'Retomar Execução'}</span>
                    </button>
                  </div>

                  {/* Detalhes Técnicos do Erro */}
                  <div className="p-4 rounded-xl bg-[#0b0e17] border border-[#1b2033] space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">Registro Técnico do Erro</span>
                      <button
                        type="button"
                        onClick={handleCopyError}
                        className="px-2 py-1 rounded text-[11px] bg-[#1a2030] text-slate-300 hover:text-white flex items-center gap-1"
                      >
                        {copiedError ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                        <span>{copiedError ? 'Copiado' : 'Copiar'}</span>
                      </button>
                    </div>
                    <pre className="p-3 rounded-lg bg-[#07090e] border border-[#1a2030] text-[11px] font-mono text-rose-300 whitespace-pre-wrap break-all max-h-60 overflow-y-auto">
                      {activeRun.last_error}
                    </pre>
                  </div>
                </div>
              ) : (
                <div className="p-8 text-center rounded-xl bg-[#0b0e17] border border-[#1b2033] text-slate-400 text-xs">
                  <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2 opacity-80" />
                  <p className="text-slate-200 font-medium">Nenhuma falha técnica pendente de recuperação.</p>
                  <p className="text-slate-500 mt-1">O histórico de ciclos recentes operou sem bloqueios não resolvidos.</p>
                </div>
              )}
            </div>
          )}

          {/* Categoria 3: Runtime Antigravity */}
          {activeSection === 'antigravity_runtime' && (
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Resumo em Linguagem Comum */}
              <div className="p-4 rounded-xl bg-[#0e121d] border border-[#1e2438] space-y-1">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-cyan-400" />
                  Status do Runtime Antigravity & Serviços Locais
                </h3>
                <p className="text-xs text-slate-300">
                  Verificação em tempo real da conectividade com o executável oficial, processos em segundo plano e integridade das portas de comunicação.
                </p>
              </div>

              {/* Detalhes Técnicos sob Demanda */}
              <SystemHealthView />
            </div>
          )}

          {/* Categoria 4: Conta e modelo */}
          {activeSection === 'account_model' && (
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Resumo em Linguagem Comum */}
              <div className="p-4 rounded-xl bg-[#0e121d] border border-[#1e2438] space-y-2">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-indigo-400" />
                  Identidade, Modelos Ativos e Transparência de Cotas
                </h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Conta ativa selecionada: <strong className="text-white">{activeAccount?.display_name || 'Conta Local'}</strong>. Modelo configurado para execução: <strong className="text-indigo-300">Gemini 3.8 Flash (HIGH)</strong>.
                </p>
                <div className="p-3 rounded-lg bg-[#101422] border border-[#1d2338] text-[11px] text-slate-400 flex items-start gap-2">
                  <Info className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                  <span>
                    <strong>Transparência de Uso:</strong> O runtime do Google Antigravity não expõe uma API de contagem de tokens ou limites de 5 horas em tempo real. O DecoHUB recusa-se a inventar números ou barras verdes fictícias. Abaixo são exibidas apenas execuções locais verificadas.
                  </span>
                </div>
              </div>

              {/* Detalhes Técnicos sob Demanda */}
              <ModelsUsageTab
                activeAccount={activeAccount}
                accounts={accounts}
                projectId={project.id}
                onShowToast={onShowToast}
              />
            </div>
          )}

          {/* Categoria 5: Tarefas e revisões */}
          {activeSection === 'tasks_reviews' && (
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Resumo em Linguagem Comum */}
              <div className="p-4 rounded-xl bg-[#0e121d] border border-[#1e2438] space-y-1">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  Tarefas do Plano & Portões de Qualidade
                </h3>
                <p className="text-xs text-slate-300">
                  {totalTasks > 0
                    ? `O plano possui ${totalTasks} tarefas no total (${completedTasks} concluídas com comprovação). Nenhuma tarefa é marcada como concluída sem validação de testes ou evidências.`
                    : 'Nenhum plano de tarefas ativo no momento.'}
                </p>
              </div>

              {/* Detalhes Técnicos sob Demanda */}
              <div className="p-4 rounded-xl bg-[#0b0e17] border border-[#1b2033] space-y-3">
                <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Hierarquia de Tarefas do Run Atual</h4>
                {activeRun?.tasks && activeRun.tasks.length > 0 ? (
                  <div className="space-y-2">
                    {activeRun.tasks.map((task, idx) => (
                      <div
                        key={task.id || idx}
                        className={`p-3 rounded-lg border text-xs flex items-center justify-between ${
                          task.status === 'completed'
                            ? 'bg-emerald-950/20 border-emerald-500/30 text-emerald-200'
                            : task.status === 'in_progress'
                            ? 'bg-indigo-950/20 border-indigo-500/30 text-indigo-200'
                            : task.status === 'blocked'
                            ? 'bg-rose-950/20 border-rose-500/30 text-rose-200'
                            : 'bg-[#111522] border-[#1e2438] text-slate-300'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[10px] text-slate-500">#{idx + 1}</span>
                          <span className="font-medium">{task.title}</span>
                        </div>
                        <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-black/30 border border-white/10">
                          {task.status === 'completed' ? 'Concluída' : task.status === 'in_progress' ? 'Em andamento' : task.status === 'blocked' ? 'Bloqueada' : 'Pendente'}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 italic">Sem tarefas detalhadas no run atual.</p>
                )}
              </div>
            </div>
          )}

          {/* Categoria 6: Testes e evidências */}
          {activeSection === 'tests_evidence' && (
            <div className="flex-1 overflow-y-auto">
              <AutonomousBuildView
                project={project}
                onRefreshProject={onRefreshProject}
                onShowToast={onShowToast}
              />
            </div>
          )}

          {/* Categoria 7: Git e publicação */}
          {activeSection === 'git_publish' && (
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Resumo em Linguagem Comum */}
              <div className="p-4 rounded-xl bg-[#0e121d] border border-[#1e2438] flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <GitBranch className="w-4 h-4 text-indigo-400" />
                    Repositório Git & Status de Integração
                  </h3>
                  <p className="text-xs text-slate-300 mt-0.5">
                    Branch ativa: <strong className="text-indigo-300 font-mono">{project.gitInfo?.branch || 'main'}</strong>. Histórico de alterações cirúrgicas e commits atômicos gerados.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onOpenDiffModal}
                  className="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-all flex items-center gap-1.5 shadow-sm"
                >
                  <GitBranch className="w-3.5 h-3.5" />
                  <span>Ver Diff Visual</span>
                </button>
              </div>

              {/* Detalhes Técnicos sob Demanda */}
              <GitStatusView
                gitInfo={project.gitInfo}
                onRefresh={onRefreshProject}
              />
            </div>
          )}

          {/* Categoria 8: Logs técnicos */}
          {activeSection === 'technical_logs' && (
            <div className="flex-1 overflow-y-auto p-6 space-y-8">
              {/* Resumo em Linguagem Comum */}
              <div className="p-4 rounded-xl bg-[#0e121d] border border-[#1e2438] space-y-1">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-indigo-400" />
                  Logs Técnicos & Telemetria do Backend
                </h3>
                <p className="text-xs text-slate-300">
                  Fluxo operacional do DecoHUB sem ruído no chat principal. Filtre por nível de severidade e componente.
                </p>
              </div>

              {/* Detalhes Técnicos sob Demanda */}
              <div className="space-y-6">
                <div>
                  <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">Visualizador de Logs</h4>
                  <SystemLogsView />
                </div>

                <div>
                  <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">Métricas de Observabilidade</h4>
                  <DecoHubObservabilityView projectId={project.id} />
                </div>
              </div>
            </div>
          )}

          {/* Seção Complementar: Ferramentas de Engenharia (Council, Arena, Benchmarks, Program, Memória) */}
          {activeSection === 'advanced_tools' && (
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              <div className="p-4 rounded-xl bg-[#0e121d] border border-[#1e2438] space-y-1">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-indigo-400" />
                  Módulos de Engenharia & Consenso
                </h3>
                <p className="text-xs text-slate-300">
                  Ferramentas integradas para deliberação multi-agente, testes de arena competitivos e memória permanente.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Memória Permanente */}
                <div className="p-4 rounded-xl bg-[#0e121d] border border-[#1e2438] space-y-2.5">
                  <div className="flex items-center gap-2.5 text-emerald-400 font-bold text-xs">
                    <FileText className="w-4 h-4" />
                    <span>Memória Permanente (.ai-dev-hub)</span>
                  </div>
                  <p className="text-xs text-slate-300">
                    Edição direta dos arquivos de contexto: project.md, architecture.md, tasks.md e decisions.md.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      // Abre o editor de memória
                      setActiveSection('execution_state');
                      onOpenResearchModal();
                    }}
                    className="w-full py-2 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-300 text-xs font-medium transition-colors"
                  >
                    Consultar Pesquisa & Memória
                  </button>
                </div>

                {/* Council */}
                <div className="p-4 rounded-xl bg-[#0e121d] border border-[#1e2438] space-y-2.5">
                  <div className="flex items-center gap-2.5 text-purple-400 font-bold text-xs">
                    <Scale className="w-4 h-4" />
                    <span>AI DEV Council</span>
                  </div>
                  <p className="text-xs text-slate-300">
                    Revisão por múltiplos modelos deliberando sobre decisões arquiteturais com notas ponderadas.
                  </p>
                  <button
                    type="button"
                    onClick={onOpenCouncilModal}
                    className="w-full py-2 rounded-lg bg-purple-600/20 hover:bg-purple-600/30 border border-purple-500/30 text-purple-300 text-xs font-medium transition-colors"
                  >
                    Abrir Council
                  </button>
                </div>

                {/* Arena */}
                <div className="p-4 rounded-xl bg-[#0e121d] border border-[#1e2438] space-y-2.5">
                  <div className="flex items-center gap-2.5 text-amber-400 font-bold text-xs">
                    <Swords className="w-4 h-4" />
                    <span>AI DEV Arena</span>
                  </div>
                  <p className="text-xs text-slate-300">
                    Geração competitiva de patches (A vs B) em worktrees Git isolados com comparação de diffs.
                  </p>
                  <button
                    type="button"
                    onClick={onOpenArenaModal}
                    className="w-full py-2 rounded-lg bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/30 text-amber-300 text-xs font-medium transition-colors"
                  >
                    Abrir Arena
                  </button>
                </div>

                {/* Benchmarks */}
                <div className="p-4 rounded-xl bg-[#0e121d] border border-[#1e2438] space-y-2.5">
                  <div className="flex items-center gap-2.5 text-cyan-400 font-bold text-xs">
                    <Gauge className="w-4 h-4" />
                    <span>Suite de Benchmarks</span>
                  </div>
                  <p className="text-xs text-slate-300">
                    Medição de performance e velocidade de raciocínio de modelos em tarefas reais.
                  </p>
                  <button
                    type="button"
                    onClick={onOpenBenchmarkModal}
                    className="w-full py-2 rounded-lg bg-cyan-600/20 hover:bg-cyan-600/30 border border-cyan-500/30 text-cyan-300 text-xs font-medium transition-colors"
                  >
                    Abrir Benchmarks
                  </button>
                </div>

                {/* Project Program */}
                <div className="p-4 rounded-xl bg-[#0e121d] border border-[#1e2438] space-y-2.5 md:col-span-2">
                  <div className="flex items-center gap-2.5 text-indigo-400 font-bold text-xs">
                    <FileCode className="w-4 h-4" />
                    <span>Project Program (Regras Invariantes & Karpathy Layer)</span>
                  </div>
                  <p className="text-xs text-slate-300">
                    Constituição de regras invariantes e restrições de código do projeto.
                  </p>
                  <button
                    type="button"
                    onClick={onOpenProjectProgramModal}
                    className="w-full py-2 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/30 text-indigo-300 text-xs font-medium transition-colors"
                  >
                    Configurar Project Program
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
