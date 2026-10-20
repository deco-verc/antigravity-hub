import React, { useEffect, useState } from 'react';
import { X, Save, RotateCcw, ShieldCheck, FileCode, BookOpen, Check, AlertCircle, RefreshCw } from 'lucide-react';

interface ProjectProgramModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string | null;
  projectName: string;
  onShowToast: (type: 'success' | 'error' | 'info', message: string) => void;
}

export const ProjectProgramModal: React.FC<ProjectProgramModalProps> = ({
  isOpen,
  onClose,
  projectId,
  projectName,
  onShowToast
}) => {
  const [activeTab, setActiveTab] = useState<'program' | 'guidelines'>('program');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [programPath, setProgramPath] = useState('');
  const [content, setContent] = useState('');
  const [globalGuidelines, setGlobalGuidelines] = useState('');
  const [hasChanges, setHasChanges] = useState(false);
  const [initialContent, setInitialContent] = useState('');

  const fetchProgram = async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/program`);
      if (!res.ok) throw new Error('Falha ao obter program.md');
      const data = await res.json();
      setContent(data.content || '');
      setInitialContent(data.content || '');
      setProgramPath(data.programPath || '');
      setGlobalGuidelines(data.globalGuidelines || '');
      setHasChanges(false);
    } catch (err: any) {
      onShowToast('error', `Erro ao carregar program.md: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && projectId) {
      fetchProgram();
    }
  }, [isOpen, projectId]);

  const handleContentChange = (newVal: string) => {
    setContent(newVal);
    setHasChanges(newVal !== initialContent);
  };

  const handleSave = async () => {
    if (!projectId) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/program`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content })
      });
      if (!res.ok) throw new Error('Falha ao salvar program.md');
      setInitialContent(content);
      setHasChanges(false);
      onShowToast('success', 'Project Program salvo com sucesso! Diretrizes sincronizadas.');
    } catch (err: any) {
      onShowToast('error', `Erro ao salvar: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleRestoreDefault = () => {
    const defaultTemplate = `# PROJECT PROGRAM: ${projectName}\n\n` +
      `## 1. Escopo & Permissões\n` +
      `- Arquivos Principais Permitidos:\n` +
      `  - src/**\n` +
      `  - tests/**\n` +
      `  - package.json\n` +
      `- Arquivos Estritamente Protegidos:\n` +
      `  - .env*\n` +
      `  - .git/**\n` +
      `  - .ai-dev-hub/hub.db\n\n` +
      `## 2. Invariantes de Arquitetura\n` +
      `- Modularidade limpa e direta.\n` +
      `- Proibido acoplamento desnecessário ou padrões de fábrica prematuros.\n` +
      `- Manter compatibilidade com testes automatizados existentes.\n\n` +
      `## 3. Harness de Verificação\n` +
      `- Comando padrão de teste: \`npm test\` ou \`node --test\`.\n` +
      `- Todo código novo deve ser verificável por comando automatizado.\n\n` +
      `## 4. Anti-Patterns Específicos Deste Projeto\n` +
      `- Não criar helpers ou utilitários para uso em um único arquivo.\n` +
      `- Não realizar refatorações estéticas em arquivos fora do escopo.\n`;

    setContent(defaultTemplate);
    setHasChanges(true);
    onShowToast('info', 'Modelo padrão carregado. Clique em "Salvar Alterações" para aplicar.');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[#0f131f] border border-[#232b45] w-full max-w-4xl h-[85vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden text-slate-200">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#1e253e] flex items-center justify-between bg-[#141929]/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <FileCode className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-white">Project Program & Guidelines</h2>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  Karpathy Execution Layer
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Constituição operacional de desenvolvimento para <span className="text-slate-200 font-semibold">{projectName}</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[#1f2742] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Controls & Path info */}
        <div className="px-6 py-2.5 bg-[#121625] border-b border-[#1a2138] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab('program')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                activeTab === 'program'
                  ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 font-semibold'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-[#1a2238]'
              }`}
            >
              <FileCode className="w-3.5 h-3.5" />
              <span>program.md (Ativo)</span>
              {hasChanges && <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />}
            </button>
            <button
              onClick={() => setActiveTab('guidelines')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                activeTab === 'guidelines'
                  ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 font-semibold'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-[#1a2238]'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>Global Agent Guidelines (Herdadas)</span>
            </button>
          </div>

          <div className="hidden sm:flex items-center gap-2 text-[11px] text-slate-400 font-mono">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>Injeção Automática Ativa</span>
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-hidden p-6 flex flex-col bg-[#0b0e18]">
          {loading ? (
            <div className="flex-1 flex items-center justify-center text-slate-400 gap-2">
              <RefreshCw className="w-5 h-5 animate-spin text-indigo-400" />
              <span className="text-sm">Carregando diretrizes operacionais...</span>
            </div>
          ) : activeTab === 'program' ? (
            <div className="flex-1 flex flex-col gap-3">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span className="font-mono text-[11px] truncate max-w-md text-slate-400">
                  {programPath || '.ai-dev-hub/program.md'}
                </span>
                <span className="text-slate-500">
                  Defina escopos permitidos, invariantes e harness de verificação
                </span>
              </div>
              <textarea
                value={content}
                onChange={(e) => handleContentChange(e.target.value)}
                placeholder="# PROJECT PROGRAM..."
                className="flex-1 w-full p-4 rounded-xl bg-[#111627] border border-[#202842] focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono text-xs text-slate-200 resize-none leading-relaxed shadow-inner"
                spellCheck={false}
              />
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-4 rounded-xl bg-[#111627] border border-[#202842] text-xs font-mono text-slate-300 leading-relaxed whitespace-pre-wrap select-text">
              {globalGuidelines || 'Carregando diretrizes globais...'}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-[#141929] border-t border-[#1e253e] flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <AlertCircle className="w-4 h-4 text-slate-500" />
            <span>
              Hierarquia: <strong className="text-slate-300">Safety → Global Guidelines → Program → Context → Task</strong>
            </span>
          </div>

          <div className="flex items-center gap-2.5">
            {activeTab === 'program' && (
              <>
                <button
                  onClick={handleRestoreDefault}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#2b3553] bg-[#1a2136] hover:bg-[#222b47] text-xs font-medium text-slate-300 transition-colors"
                  title="Restaurar template padrão de program.md"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Restaurar Padrão</span>
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || !hasChanges}
                  className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    hasChanges
                      ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/30 font-semibold'
                      : 'bg-[#1b2236] text-slate-500 border border-[#252f4d] cursor-not-allowed'
                  }`}
                >
                  {saving ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Salvando...</span>
                    </>
                  ) : (
                    <>
                      <Save className="w-3.5 h-3.5" />
                      <span>Salvar Alterações</span>
                    </>
                  )}
                </button>
              </>
            )}
            <button
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-white transition-colors"
            >
              Fechar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
