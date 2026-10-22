import React, { useState, useEffect } from 'react';
import { FullProjectDetails, GitDiffResponse } from '../types';
import { api } from '../services/api';
import {
  GitBranch,
  GitCommit,
  RefreshCw,
  Copy,
  Check,
  FileCode,
  FilePlus,
  FileMinus,
  FileEdit,
  CheckCircle,
  Layers
} from 'lucide-react';

interface DecoHubGitDiffViewProps {
  project: FullProjectDetails;
}

export const DecoHubGitDiffView: React.FC<DecoHubGitDiffViewProps> = ({ project }) => {
  const [diffData, setDiffData] = useState<GitDiffResponse | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const loadDiff = async (file?: string) => {
    setLoading(true);
    try {
      const data = await api.getGitDiff(project.id, file);
      setDiffData(data);
    } catch {
      setDiffData({ diff: '', files: [], rawSummary: 'Não foi possível carregar o diff do Git.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDiff(selectedFile || undefined);
  }, [project.id, selectedFile]);

  const handleSelectFile = (file: string | null) => {
    setSelectedFile(file);
  };

  const copyDiff = () => {
    if (!diffData?.diff) return;
    navigator.clipboard.writeText(diffData.diff);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const totalAdditions = diffData?.files?.reduce((acc, f) => acc + (f.additions || 0), 0) || 0;
  const totalDeletions = diffData?.files?.reduce((acc, f) => acc + (f.deletions || 0), 0) || 0;

  return (
    <div className="flex-1 flex flex-col h-full bg-[#0a0d15] text-slate-100 overflow-hidden">
      {/* Top Bar */}
      <div className="h-12 border-b border-[#1b2033] bg-[#0c101d] px-6 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
            <GitBranch className="w-4 h-4 text-indigo-400" />
            <span className="font-mono text-indigo-300">
              {project.gitInfo?.branch || 'main'}
            </span>
          </div>

          <div className="h-4 w-[1px] bg-[#1b2033]" />

          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-400">
              {diffData?.files?.length || 0} arquivo{(diffData?.files?.length || 0) !== 1 ? 's' : ''} modificado{(diffData?.files?.length || 0) !== 1 ? 's' : ''}
            </span>
            {totalAdditions > 0 && (
              <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-emerald-950/60 text-emerald-400 border border-emerald-800/40">
                +{totalAdditions}
              </span>
            )}
            {totalDeletions > 0 && (
              <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-rose-950/60 text-rose-400 border border-rose-800/40">
                -{totalDeletions}
              </span>
            )}
          </div>
        </div>

        {/* Right actions */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => loadDiff(selectedFile || undefined)}
            disabled={loading}
            title="Recarregar diff do Git"
            className="px-2.5 py-1.5 rounded-lg border border-[#232942] bg-[#121626] text-slate-300 hover:text-white hover:border-slate-600 text-xs flex items-center gap-1.5 transition-all disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-indigo-400 ${loading ? 'animate-spin' : ''}`} />
            <span>Atualizar</span>
          </button>

          <button
            type="button"
            onClick={copyDiff}
            disabled={!diffData?.diff}
            title="Copiar diff completo para a área de transferência"
            className="px-2.5 py-1.5 rounded-lg border border-[#232942] bg-[#121626] text-slate-300 hover:text-white hover:border-slate-600 text-xs flex items-center gap-1.5 transition-all disabled:opacity-40"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-400">Copiado</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-slate-400" />
                <span>Copiar Diff</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Main Content: Files List (Left) + Diff Content (Right) */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Changed Files Sidebar */}
        <div className="w-72 border-r border-[#1b2033] bg-[#090c14] flex flex-col flex-shrink-0">
          <div className="p-3 border-b border-[#1b2033] bg-[#0c101d] flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
              Arquivos Alterados
            </span>
            <span className="text-[11px] font-mono text-slate-500">
              {diffData?.files?.length || 0}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            <button
              type="button"
              onClick={() => handleSelectFile(null)}
              className={`w-full text-left px-2.5 py-2 rounded-lg text-xs font-medium flex items-center justify-between transition-all ${
                selectedFile === null
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-[#121626]'
              }`}
            >
              <div className="flex items-center gap-2 truncate">
                <Layers className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="truncate">Todos os Arquivos</span>
              </div>
            </button>

            {diffData?.files?.map(f => {
              const isSelected = selectedFile === f.file;
              return (
                <button
                  key={f.file}
                  type="button"
                  onClick={() => handleSelectFile(f.file)}
                  className={`w-full text-left px-2.5 py-2 rounded-lg text-xs font-mono flex items-center justify-between transition-all ${
                    isSelected
                      ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/40 shadow-sm'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-[#121626]'
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    {f.status === 'A' ? (
                      <FilePlus className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                    ) : f.status === 'D' ? (
                      <FileMinus className="w-3.5 h-3.5 text-rose-400 flex-shrink-0" />
                    ) : (
                      <FileEdit className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                    )}
                    <span className="truncate" title={f.file}>
                      {f.file}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-[10px] flex-shrink-0 ml-1">
                    {f.additions > 0 && (
                      <span className="text-emerald-400 font-bold">+{f.additions}</span>
                    )}
                    {f.deletions > 0 && (
                      <span className="text-rose-400 font-bold">-{f.deletions}</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right: Unified Diff Viewer */}
        <div className="flex-1 overflow-auto bg-[#06080e] p-4 font-mono text-xs select-text">
          {loading ? (
            <div className="flex items-center justify-center h-full text-slate-500">
              <RefreshCw className="w-5 h-5 animate-spin text-indigo-400 mr-2" />
              <span>Lendo alterações do Git...</span>
            </div>
          ) : !diffData?.diff || diffData.diff.trim() === '' ? (
            <div className="flex flex-col items-center justify-center h-full text-center text-slate-500 p-8">
              <CheckCircle className="w-12 h-12 text-emerald-500/50 mb-3" />
              <h4 className="text-sm font-semibold text-slate-300">Working tree limpa!</h4>
              <p className="text-xs text-slate-500 mt-1 max-w-sm">
                Não há alterações pendentes no Git para este escopo. Todas as modificações já foram commitadas com sucesso.
              </p>
            </div>
          ) : (
            <div className="space-y-0.5">
              {diffData.diff.split('\n').map((line, idx) => {
                if (line.startsWith('+++') || line.startsWith('---')) {
                  return (
                    <div key={idx} className="text-slate-500 font-bold py-0.5 px-2 bg-[#0c101d] rounded">
                      {line}
                    </div>
                  );
                }
                if (line.startsWith('diff --git') || line.startsWith('index ')) {
                  return (
                    <div key={idx} className="text-indigo-400/90 font-bold pt-3 pb-0.5 px-2">
                      {line}
                    </div>
                  );
                }
                if (line.startsWith('@@')) {
                  return (
                    <div
                      key={idx}
                      className="text-cyan-400 bg-cyan-950/20 border-y border-cyan-800/30 px-3 py-1 my-1.5 font-semibold rounded"
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
                      <span className="select-none text-emerald-500/60 mr-2.5">+</span>
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
                      <span className="select-none text-rose-500/60 mr-2.5">-</span>
                      <span>{line.slice(1)}</span>
                    </div>
                  );
                }
                return (
                  <div key={idx} className="text-slate-400 px-3 py-0.5 leading-relaxed whitespace-pre-wrap flex hover:bg-[#0c101d]/60">
                    <span className="select-none text-slate-600 mr-4 w-2 text-right"> </span>
                    <span>{line}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
