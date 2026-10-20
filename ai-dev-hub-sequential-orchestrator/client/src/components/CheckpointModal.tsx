import React, { useState, useEffect } from 'react';
import { FullProjectDetails } from '../types';
import { api } from '../services/api';
import { Sparkles, Copy, Check, X, CheckCircle2, AlertTriangle, ArrowRight, RefreshCw } from 'lucide-react';

interface CheckpointModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: FullProjectDetails;
  onCheckpointGenerated: () => void;
}

export const CheckpointModal: React.FC<CheckpointModalProps> = ({
  isOpen,
  onClose,
  project,
  onCheckpointGenerated
}) => {
  const [implementedText, setImplementedText] = useState('');
  const [changesText, setChangesText] = useState('');
  const [problemsText, setProblemsText] = useState('');
  const [nextTaskText, setNextTaskText] = useState('');
  const [decisionsText, setDecisionsText] = useState('');

  const [generatedResult, setGeneratedResult] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  // Initialize fields with smart defaults based on current state
  useEffect(() => {
    if (isOpen && project) {
      const { parsedTasks, gitInfo, memory } = project;

      // Implemented default from done tasks
      if (parsedTasks.done.length > 0) {
        setImplementedText(parsedTasks.done.join('\n'));
      } else {
        setImplementedText('Estrutura inicial do projeto\nMemória permanente configurada');
      }

      // Changes default from git
      if (gitInfo.changedFiles.length > 0) {
        setChangesText(gitInfo.changedFiles.slice(0, 8).map(f => f.path).join('\n'));
      } else {
        setChangesText('.ai-dev-hub/tasks.md\n.ai-dev-hub/session-summary.md');
      }

      // Next task from doing or pending
      if (parsedTasks.doing.length > 0) {
        setNextTaskText(parsedTasks.doing[0]);
      } else if (parsedTasks.pending.length > 0) {
        setNextTaskText(parsedTasks.pending[0]);
      } else {
        setNextTaskText('Implementar próximas funcionalidades do backlog');
      }

      setProblemsText('Nenhum erro bloqueante identificado');
      setDecisionsText('Persistência local em Markdown e SQLite\nArquitetura desacoplada');
      setGeneratedResult(null);
    }
  }, [isOpen, project]);

  if (!isOpen) return null;

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      const implemented = implementedText.split('\n').map(s => s.trim()).filter(Boolean);
      const recentChanges = changesText.split('\n').map(s => s.trim()).filter(Boolean);
      const problems = problemsText.split('\n').map(s => s.trim()).filter(Boolean);
      const decisions = decisionsText.split('\n').map(s => s.trim()).filter(Boolean);

      const res = await api.generateCheckpoint(project.id, {
        implemented,
        recentChanges,
        problems,
        nextTask: nextTaskText.trim(),
        decisions
      });

      setGeneratedResult(res.checkpointText);
      onCheckpointGenerated();
    } catch (err: any) {
      alert(err.message || 'Erro ao gerar checkpoint');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopy = () => {
    if (!generatedResult) return;
    navigator.clipboard.writeText(generatedResult);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#0d0f17] border border-[#1e2233] w-full max-w-2xl rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="p-5 border-b border-[#1e2233] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 flex items-center justify-center">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Gerar Checkpoint de Sessão</h3>
              <p className="text-xs text-[#7e87aa]">Salva o estado no histórico e em <span className="font-mono text-indigo-300">session-summary.md</span></p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded-lg text-[#525a7f] hover:text-white hover:bg-[#181b28] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1">
          {generatedResult ? (
            /* Result View with Copy Button */
            <div className="space-y-4">
              <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  Checkpoint gerado com sucesso e persistido na memória permanente!
                </span>
              </div>

              <div className="relative">
                <pre className="p-4 bg-[#090a0f] border border-[#1e2233] rounded-xl text-xs font-mono text-slate-200 whitespace-pre-wrap leading-relaxed max-h-80 overflow-y-auto">
                  {generatedResult}
                </pre>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setGeneratedResult(null)}
                  className="px-4 py-2 rounded-lg bg-[#181b28] hover:bg-[#202538] text-xs text-slate-300 font-medium transition-colors"
                >
                  Editar Dados
                </button>

                <button
                  type="button"
                  onClick={handleCopy}
                  className="px-5 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-md shadow-indigo-600/30 flex items-center gap-2 transition-all"
                >
                  {copied ? (
                    <>
                      <Check className="w-4 h-4 text-emerald-300" />
                      <span>COPIADO PARA A ÁREA DE TRANSFERÊNCIA!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" />
                      <span>COPIAR CHECKPOINT</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          ) : (
            /* Form inputs */
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Implementado nesta Sessão (uma linha por item):
                  </label>
                  <textarea
                    rows={4}
                    value={implementedText}
                    onChange={e => setImplementedText(e.target.value)}
                    className="w-full bg-[#121520] border border-[#1e2233] focus:border-indigo-500 rounded-lg p-2.5 text-xs text-slate-200 focus:outline-none resize-none leading-relaxed"
                    placeholder="- feature A&#10;- feature B"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Alterações Recentes / Arquivos:
                  </label>
                  <textarea
                    rows={4}
                    value={changesText}
                    onChange={e => setChangesText(e.target.value)}
                    className="w-full bg-[#121520] border border-[#1e2233] focus:border-indigo-500 rounded-lg p-2.5 text-xs text-slate-200 focus:outline-none resize-none leading-relaxed font-mono"
                    placeholder="src/App.tsx&#10;backend/server.ts"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Problemas ou Bugs Conhecidos:
                </label>
                <input
                  type="text"
                  value={problemsText}
                  onChange={e => setProblemsText(e.target.value)}
                  className="w-full bg-[#121520] border border-[#1e2233] focus:border-indigo-500 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none"
                  placeholder="Ex: Tempo de resposta alto ao carregar modelo"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Próxima Tarefa Recomendada:
                </label>
                <input
                  type="text"
                  value={nextTaskText}
                  onChange={e => setNextTaskText(e.target.value)}
                  className="w-full bg-[#121520] border border-[#1e2233] focus:border-indigo-500 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none"
                  placeholder="Ex: Investigar cache e otimizar rotas"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Decisões Importantes Tomadas:
                </label>
                <input
                  type="text"
                  value={decisionsText}
                  onChange={e => setDecisionsText(e.target.value)}
                  className="w-full bg-[#121520] border border-[#1e2233] focus:border-indigo-500 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none"
                  placeholder="Ex: FastAPI no backend; React no frontend"
                />
              </div>

              <div className="pt-3 border-t border-[#1e2233] flex justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-lg bg-[#181b28] hover:bg-[#202538] text-xs text-slate-300 font-medium transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={isGenerating}
                  className="px-5 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold shadow-md shadow-indigo-600/30 transition-all flex items-center gap-1.5"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>{isGenerating ? 'Gerando Checkpoint...' : 'GERAR E SALVAR CHECKPOINT'}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
