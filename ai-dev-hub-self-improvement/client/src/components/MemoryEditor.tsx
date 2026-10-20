import React, { useState, useEffect } from 'react';
import { ProjectMemory } from '../types';
import { Save, Check, RefreshCw, FileText, Code2, Eye, ShieldCheck } from 'lucide-react';

interface MemoryEditorProps {
  projectId: string;
  projectPath: string;
  memory: ProjectMemory;
  initialFile?: string;
  onSaveFile: (fileName: string, content: string) => Promise<void>;
  onRefresh: () => Promise<void>;
}

const MEMORY_FILES = [
  { key: 'projectMd', name: 'project.md', title: 'Objetivo & Contexto', icon: FileText },
  { key: 'architectureMd', name: 'architecture.md', title: 'Arquitetura & Stack', icon: Code2 },
  { key: 'decisionsMd', name: 'decisions.md', title: 'Decisões Técnicas', icon: ShieldCheck },
  { key: 'tasksMd', name: 'tasks.md', title: 'Tarefas (MD)', icon: FileText },
  { key: 'changesMd', name: 'changes.md', title: 'Alterações', icon: FileText },
  { key: 'sessionSummaryMd', name: 'session-summary.md', title: 'Resumo da Sessão', icon: FileText }
];

export const MemoryEditor: React.FC<MemoryEditorProps> = ({
  projectId,
  projectPath,
  memory,
  initialFile = 'project.md',
  onSaveFile,
  onRefresh
}) => {
  const [selectedFile, setSelectedFile] = useState<string>(initialFile);
  const [content, setContent] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [isPreview, setIsPreview] = useState(false);

  // Sync selected file content
  useEffect(() => {
    const fileDef = MEMORY_FILES.find(f => f.name === selectedFile);
    if (fileDef) {
      const fileKey = fileDef.key as keyof ProjectMemory;
      setContent(memory[fileKey] || '');
    }
  }, [selectedFile, memory]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSaveFile(selectedFile, content);
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 2000);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#090a0f] overflow-hidden">
      {/* File sub-tabs */}
      <div className="px-6 py-2 bg-[#0d0f17] border-b border-[#1e2233] flex items-center justify-between overflow-x-auto flex-shrink-0">
        <div className="flex items-center gap-1">
          {MEMORY_FILES.map(f => {
            const isActive = selectedFile === f.name;
            return (
              <button
                key={f.name}
                onClick={() => setSelectedFile(f.name)}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono transition-all flex items-center gap-1.5 ${
                  isActive
                    ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 font-semibold'
                    : 'text-[#7e87aa] hover:text-slate-200 hover:bg-[#121520]'
                }`}
              >
                <span>{f.name}</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsPreview(!isPreview)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              isPreview
                ? 'bg-indigo-600/20 border-indigo-500/40 text-indigo-300'
                : 'bg-[#181b28] border-[#1e2233] text-[#7e87aa] hover:text-slate-200'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            <span>{isPreview ? 'Editar' : 'Visualizar'}</span>
          </button>

          <button
            onClick={onRefresh}
            title="Recarregar do disco"
            className="p-1.5 rounded-lg bg-[#181b28] border border-[#1e2233] text-[#7e87aa] hover:text-slate-200"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-sm transition-all disabled:opacity-50"
          >
            {savedSuccess ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-300" />
                <span>Salvo!</span>
              </>
            ) : (
              <>
                <Save className="w-3.5 h-3.5" />
                <span>{isSaving ? 'Salvando...' : 'Salvar Alterações'}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Path preview banner */}
      <div className="px-6 py-2 bg-[#121520] border-b border-[#1e2233] text-[11px] font-mono text-[#7e87aa] flex items-center justify-between">
        <span className="truncate">
          Local: <span className="text-slate-300">{projectPath}\.ai-dev-hub\{selectedFile}</span>
        </span>
        <span className="text-emerald-400/80">Sincronizado diretamente no sistema de arquivos</span>
      </div>

      {/* Editor / Preview Content */}
      <div className="flex-1 p-6 overflow-hidden flex flex-col">
        {isPreview ? (
          <div className="flex-1 p-6 bg-[#0d0f17] border border-[#1e2233] rounded-xl overflow-y-auto prose prose-invert max-w-none text-xs leading-relaxed">
            <pre className="whitespace-pre-wrap font-sans text-slate-300">
              {content || '(Arquivo vazio)'}
            </pre>
          </div>
        ) : (
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            className="flex-1 w-full p-4 bg-[#0d0f17] border border-[#1e2233] focus:border-indigo-500 rounded-xl font-mono text-xs text-slate-200 resize-none focus:outline-none leading-relaxed selection:bg-indigo-500/40"
            placeholder={`Edite o arquivo ${selectedFile}...`}
          />
        )}
      </div>
    </div>
  );
};
