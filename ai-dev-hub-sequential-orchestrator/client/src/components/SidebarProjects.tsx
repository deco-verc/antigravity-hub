import React, { useState } from 'react';
import { Project } from '../types';
import { FolderGit2, Plus, Sparkles, Folder, Layers, Trash2, Search, CheckCircle2 } from 'lucide-react';

interface SidebarProjectsProps {
  projects: Project[];
  activeProjectId: string | null;
  onSelectProject: (id: string) => void;
  onOpenNewProjectModal: () => void;
  onDeleteProject: (id: string, e: React.MouseEvent) => void;
}

export const SidebarProjects: React.FC<SidebarProjectsProps> = ({
  projects,
  activeProjectId,
  onSelectProject,
  onOpenNewProjectModal,
  onDeleteProject
}) => {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredProjects = projects.filter(p =>
    p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (p.stack && p.stack.toLowerCase().includes(searchTerm.toLowerCase())) ||
    p.path.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <aside className="w-72 bg-[#0d0f17] border-r border-[#1e2233] flex flex-col h-full select-none flex-shrink-0">
      {/* Top Header */}
      <div className="p-4 border-b border-[#1e2233] flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-600 via-indigo-500 to-cyan-400 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-white tracking-wide flex items-center gap-1.5">
              AI DEV HUB
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-300 font-mono">MVP</span>
            </h1>
            <p className="text-[11px] text-[#7e87aa]">Memória Permanente</p>
          </div>
        </div>
      </div>

      {/* New Project Button */}
      <div className="p-3 border-b border-[#1e2233]/70">
        <button
          onClick={onOpenNewProjectModal}
          className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 active:scale-[0.98] text-white text-xs font-semibold shadow-md shadow-indigo-600/20 transition-all duration-150"
        >
          <Plus className="w-4 h-4" />
          <span>NOVO PROJETO</span>
        </button>
      </div>

      {/* Search box */}
      <div className="px-3 pt-3 pb-2">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-[#525a7f]" />
          <input
            type="text"
            placeholder="Filtrar projetos..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full bg-[#121520] border border-[#1e2233] rounded-md py-1.5 pl-8 pr-2 text-xs text-slate-200 placeholder-[#525a7f] focus:outline-none focus:border-indigo-500"
          />
        </div>
      </div>

      {/* Project List */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
        <div className="px-2 py-1 text-[11px] font-semibold text-[#525a7f] uppercase tracking-wider flex items-center justify-between">
          <span>Projetos ({filteredProjects.length})</span>
          <Layers className="w-3 h-3 text-[#525a7f]" />
        </div>

        {filteredProjects.length === 0 ? (
          <div className="p-4 text-center text-xs text-[#525a7f] space-y-2">
            <Folder className="w-8 h-8 mx-auto opacity-30" />
            <p>Nenhum projeto encontrado.</p>
            <p className="text-[10px]">Clique em "+ NOVO PROJETO" para começar.</p>
          </div>
        ) : (
          filteredProjects.map(proj => {
            const isActive = proj.id === activeProjectId;
            return (
              <div
                key={proj.id}
                onClick={() => onSelectProject(proj.id)}
                className={`group relative p-2.5 rounded-lg cursor-pointer transition-all duration-150 border ${
                  isActive
                    ? 'bg-[#181b28] border-indigo-500/50 shadow-sm'
                    : 'bg-transparent border-transparent hover:bg-[#121520] hover:border-[#1e2233]'
                }`}
              >
                <div className="flex items-start justify-between gap-1.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      isActive ? 'bg-emerald-400 ring-2 ring-emerald-400/20' : 'bg-slate-600'
                    }`} />
                    <span className={`text-xs font-medium truncate ${
                      isActive ? 'text-white font-semibold' : 'text-slate-300 group-hover:text-white'
                    }`}>
                      {proj.name}
                    </span>
                  </div>

                  <button
                    onClick={(e) => onDeleteProject(proj.id, e)}
                    title="Remover projeto do Hub"
                    className="opacity-0 group-hover:opacity-100 p-1 hover:text-rose-400 text-[#525a7f] transition-opacity"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>

                <div className="mt-1 flex items-center justify-between text-[10px] text-[#7e87aa]">
                  <span className="truncate max-w-[130px] font-mono opacity-80" title={proj.path}>
                    {proj.path.split(/[\\/]/).pop()}
                  </span>

                  {proj.stack && (
                    <span className="px-1.5 py-0.5 rounded bg-[#1e2233] text-[#a5adc6] text-[9px] font-mono">
                      {proj.stack.split('+')[0].trim()}
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer info */}
      <div className="p-3 border-t border-[#1e2233] bg-[#090a0f]/80 text-[11px] text-[#525a7f] flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
          <span>Local & Offline</span>
        </div>
        <span className="font-mono text-[10px] text-[#525a7f]">v1.0.0</span>
      </div>
    </aside>
  );
};
