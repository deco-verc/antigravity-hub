import React from 'react';
import { GitInfo } from '../types';
import { GitBranch, GitCommit, FileDiff, RefreshCw, AlertCircle, FilePlus, FileMinus, FileEdit } from 'lucide-react';

interface GitStatusViewProps {
  gitInfo: GitInfo;
  onRefresh: () => void;
}

export const GitStatusView: React.FC<GitStatusViewProps> = ({ gitInfo, onRefresh }) => {
  if (!gitInfo.isGitRepo) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-[#090a0f] text-[#525a7f] space-y-3">
        <AlertCircle className="w-10 h-10 opacity-30 text-amber-400" />
        <h3 className="text-sm font-semibold text-slate-300">Repositório Git Não Inicializado</h3>
        <p className="text-xs max-w-sm">Esta pasta de projeto não possui um repositório Git local (.git).</p>
      </div>
    );
  }

  const { branch, lastCommit, statusSummary, changedFiles } = gitInfo;

  return (
    <div className="flex-1 flex flex-col h-full bg-[#090a0f] p-6 overflow-hidden">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <GitBranch className="w-5 h-5 text-emerald-400" />
          <h2 className="text-sm font-bold text-white uppercase tracking-wider">Git Status do Projeto</h2>
          <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono text-xs">
            {branch || 'main'}
          </span>
        </div>

        <button
          onClick={onRefresh}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#181b28] hover:bg-[#202538] border border-[#2e344e] text-xs text-slate-200 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5 text-indigo-400" />
          <span>Atualizar Git</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto space-y-4">
        {/* Status Counters */}
        <div className="bg-[#0d0f17] border border-[#1e2233] rounded-xl p-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-[#7e87aa] mb-3">
            GIT STATUS (Resumo de Alterações)
          </div>

          <div className="grid grid-cols-4 gap-3 text-center">
            <div className="bg-[#121520] p-3 rounded-lg border border-[#1e2233]">
              <div className="text-xs text-[#7e87aa] mb-1">Modificados</div>
              <div className="text-xl font-bold font-mono text-amber-400">{statusSummary.modified}</div>
            </div>

            <div className="bg-[#121520] p-3 rounded-lg border border-[#1e2233]">
              <div className="text-xs text-[#7e87aa] mb-1">Novos</div>
              <div className="text-xl font-bold font-mono text-emerald-400">{statusSummary.newFiles}</div>
            </div>

            <div className="bg-[#121520] p-3 rounded-lg border border-[#1e2233]">
              <div className="text-xs text-[#7e87aa] mb-1">Deletados</div>
              <div className="text-xl font-bold font-mono text-rose-400">{statusSummary.deleted}</div>
            </div>

            <div className="bg-[#121520] p-3 rounded-lg border border-[#1e2233]">
              <div className="text-xs text-[#7e87aa] mb-1">Total de Alterações</div>
              <div className="text-xl font-bold font-mono text-indigo-400">{statusSummary.total}</div>
            </div>
          </div>
        </div>

        {/* Last Commit */}
        {lastCommit && (
          <div className="bg-[#0d0f17] border border-[#1e2233] rounded-xl p-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-300 mb-2">
              <GitCommit className="w-4 h-4 text-indigo-400" />
              <span>Último Commit Local</span>
              <span className="font-mono text-indigo-300 bg-indigo-500/10 px-1.5 py-0.5 rounded text-[11px]">
                {lastCommit.hash}
              </span>
            </div>
            <p className="text-xs text-white font-medium mb-1">{lastCommit.message}</p>
            <div className="text-[11px] text-[#7e87aa] flex items-center gap-3">
              <span>Autor: {lastCommit.author}</span>
              <span>Data: {lastCommit.date}</span>
            </div>
          </div>
        )}

        {/* Changed Files List */}
        <div className="bg-[#0d0f17] border border-[#1e2233] rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-[#7e87aa] flex items-center gap-1.5">
              <FileDiff className="w-4 h-4 text-cyan-400" />
              Arquivos no Worktree ({changedFiles.length})
            </span>
          </div>

          {changedFiles.length === 0 ? (
            <div className="text-center py-6 text-xs text-emerald-400/80 font-mono">
              ✓ Diretório de trabalho limpo (nenhuma alteração pendente de commit)
            </div>
          ) : (
            <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
              {changedFiles.map((file, i) => {
                const isNew = file.status === 'new';
                const isDel = file.status === 'deleted';
                return (
                  <div
                    key={i}
                    className="flex items-center justify-between p-2 rounded bg-[#121520] border border-[#1e2233] font-mono text-xs"
                  >
                    <div className="flex items-center gap-2 truncate">
                      {isNew ? (
                        <FilePlus className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                      ) : isDel ? (
                        <FileMinus className="w-3.5 h-3.5 text-rose-400 flex-shrink-0" />
                      ) : (
                        <FileEdit className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                      )}
                      <span className="truncate text-slate-200">{file.path}</span>
                    </div>

                    <span
                      className={`text-[10px] px-2 py-0.5 rounded uppercase font-semibold ${
                        isNew
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : isDel
                          ? 'bg-rose-500/20 text-rose-300'
                          : 'bg-amber-500/20 text-amber-300'
                      }`}
                    >
                      {file.status}
                    </span>
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
