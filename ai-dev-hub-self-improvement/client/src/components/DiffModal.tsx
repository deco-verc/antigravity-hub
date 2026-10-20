import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import { GitDiffResponse, GitDiffFile } from '../types';
import {
  X,
  GitCommit,
  FileCode,
  Plus,
  Minus,
  RefreshCw,
  CheckCircle,
  Copy,
  Check,
  ChevronRight
} from 'lucide-react';

interface DiffModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string | null;
  projectName?: string;
}

export const DiffModal: React.FC<DiffModalProps> = ({
  isOpen,
  onClose,
  projectId,
  projectName
}) => {
  const [diffData, setDiffData] = useState<GitDiffResponse | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (isOpen && projectId) {
      loadDiff();
    }
  }, [isOpen, projectId]);

  const loadDiff = async (file?: string) => {
    if (!projectId) return;
    setLoading(true);
    try {
      const res = await api.getGitDiff(projectId, file);
      setDiffData(res);
      if (!selectedFile && res.files.length > 0) {
        setSelectedFile(res.files[0].file);
      }
    } catch (err) {
      console.error('Falha ao carregar Git Diff:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectFile = (file: string) => {
    setSelectedFile(file);
    loadDiff(file);
  };

  const copyDiff = () => {
    if (diffData?.diff) {
      navigator.clipboard.writeText(diffData.diff);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (!isOpen) return null;

  const totalAdditions = diffData?.files.reduce((acc, f) => acc + (f.additions || 0), 0) || 0;
  const totalDeletions = diffData?.files.reduce((acc, f) => acc + (f.deletions || 0), 0) || 0;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#0b0d16] border border-[#1e2338] w-full max-w-5xl rounded-2xl shadow-2xl flex flex-col h-[85vh] overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#1b2033] bg-[#0e111d] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <GitCommit className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white tracking-tight">Alterações no Código (Git Diff)</h3>
                {projectName && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-[#1b2033] text-slate-300 font-mono">
                    {projectName}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 mt-1 text-xs">
                <span className="text-slate-400">
                  {diffData?.files.length || 0} arquivo{(diffData?.files.length || 0) !== 1 ? 's' : ''} modificado{(diffData?.files.length || 0) !== 1 ? 's' : ''}
                </span>
                <span className="flex items-center gap-1 text-emerald-400 font-medium">
                  <Plus className="w-3 h-3" /> +{totalAdditions}
                </span>
                <span className="flex items-center gap-1 text-rose-400 font-medium">
                  <Minus className="w-3 h-3" /> -{totalDeletions}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => loadDiff(selectedFile || undefined)}
              disabled={loading}
              className="p-2 rounded-lg bg-[#141824] hover:bg-[#1b2033] text-slate-300 border border-[#23293d] transition-colors"
              title="Recarregar diff"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-indigo-400' : ''}`} />
            </button>
            <button
              onClick={copyDiff}
              className="p-2 rounded-lg bg-[#141824] hover:bg-[#1b2033] text-slate-300 border border-[#23293d] transition-colors"
              title="Copiar diff completo"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-[#1b2033] transition-colors"
              title="Fechar"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left file selector sidebar */}
          <div className="w-64 border-r border-[#1e2338] bg-[#0c0e18] p-3 overflow-y-auto flex-shrink-0">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 px-2 block mb-2">
              Arquivos Modificados
            </span>

            {diffData?.files.length === 0 ? (
              <div className="p-4 text-center text-xs text-slate-500">
                Nenhum arquivo modificado.
              </div>
            ) : (
              <ul className="space-y-1">
                {diffData?.files.map(f => {
                  const isSelected = selectedFile === f.file;
                  return (
                    <li key={f.file}>
                      <button
                        onClick={() => handleSelectFile(f.file)}
                        className={`w-full text-left px-2.5 py-2 rounded-lg text-xs font-mono transition-all flex items-center justify-between ${
                          isSelected
                            ? 'bg-indigo-600/20 text-indigo-300 font-semibold border-l-2 border-indigo-500'
                            : 'text-slate-400 hover:bg-[#141825] hover:text-slate-200'
                        }`}
                      >
                        <div className="flex items-center gap-2 truncate mr-2">
                          <FileCode className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0" />
                          <span className="truncate">{f.file}</span>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0 text-[10px]">
                          {f.additions > 0 && <span className="text-emerald-400 font-bold">+{f.additions}</span>}
                          {f.deletions > 0 && <span className="text-rose-400 font-bold">-{f.deletions}</span>}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Right Diff Viewer */}
          <div className="flex-1 overflow-auto bg-[#07090f] p-4 font-mono text-xs select-text">
            {loading ? (
              <div className="flex items-center justify-center h-full text-slate-500">
                <RefreshCw className="w-5 h-5 animate-spin text-indigo-400 mr-2" />
                <span>Carregando alterações do Git...</span>
              </div>
            ) : !diffData?.diff || diffData.diff.trim() === '' ? (
              <div className="flex flex-col items-center justify-center h-full text-center text-slate-500 p-8">
                <CheckCircle className="w-12 h-12 text-emerald-500/50 mb-3" />
                <h4 className="text-sm font-semibold text-slate-300">Working tree limpa!</h4>
                <p className="text-xs text-slate-500 mt-1 max-w-sm">
                  Não há alterações pendentes no Git para este arquivo ou projeto. Todas as modificações já foram commitadas.
                </p>
              </div>
            ) : (
              <div className="space-y-0.5">
                {diffData.diff.split('\n').map((line, idx) => {
                  if (line.startsWith('+++') || line.startsWith('---')) {
                    return (
                      <div key={idx} className="text-slate-500 font-bold py-0.5 px-2 bg-[#0d101d]">
                        {line}
                      </div>
                    );
                  }
                  if (line.startsWith('diff --git') || line.startsWith('index ')) {
                    return (
                      <div key={idx} className="text-indigo-400/80 font-bold pt-2 pb-0.5 px-2">
                        {line}
                      </div>
                    );
                  }
                  if (line.startsWith('@@')) {
                    return (
                      <div
                        key={idx}
                        className="text-cyan-400 bg-cyan-950/20 border-y border-cyan-800/30 px-3 py-1 my-1 font-semibold rounded"
                      >
                        {line}
                      </div>
                    );
                  }
                  if (line.startsWith('+')) {
                    return (
                      <div
                        key={idx}
                        className="bg-emerald-950/30 text-emerald-300 px-3 py-0.5 border-l-2 border-emerald-500 leading-relaxed whitespace-pre-wrap flex"
                      >
                        <span className="select-none text-emerald-500/60 mr-2">+</span>
                        <span>{line.slice(1)}</span>
                      </div>
                    );
                  }
                  if (line.startsWith('-')) {
                    return (
                      <div
                        key={idx}
                        className="bg-rose-950/30 text-rose-300 px-3 py-0.5 border-l-2 border-rose-500 leading-relaxed whitespace-pre-wrap flex"
                      >
                        <span className="select-none text-rose-500/60 mr-2">-</span>
                        <span>{line.slice(1)}</span>
                      </div>
                    );
                  }
                  return (
                    <div key={idx} className="text-slate-400 px-3 py-0.5 leading-relaxed whitespace-pre-wrap flex">
                      <span className="select-none text-transparent mr-2"> </span>
                      <span>{line}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-[#1b2033] bg-[#0e111d] flex items-center justify-between">
          <span className="text-xs text-slate-500">
            Dica: Linhas em verde representam adições; linhas em vermelho representam exclusões.
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs transition-colors"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
