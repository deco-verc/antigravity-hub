import React, { useState } from 'react';
import { Project } from '../types';
import {
  Plus,
  Folder,
  Layers,
  Settings,
  Cpu,
  Search,
  CheckCircle2,
  SlidersHorizontal,
  ChevronRight,
  Sparkles,
  RotateCw,
  X
} from 'lucide-react';

interface DecoHubSidebarProps {
  projects: Project[];
  activeProjectId: string | null;
  onSelectProject: (id: string) => void;
  onOpenNewProjectModal: () => void;
  onOpenSettings: () => void;
  onOpenModelsInfo: () => void;
  onOpenAdvanced: () => void;
  onOpenMetaChat?: () => void;
  isMetaChatActive?: boolean;
  onRefreshProjects?: () => Promise<void> | void;
}

export const DecoHubSidebar: React.FC<DecoHubSidebarProps> = ({
  projects,
  activeProjectId,
  onSelectProject,
  onOpenNewProjectModal,
  onOpenSettings,
  onOpenModelsInfo,
  onOpenAdvanced,
  onOpenMetaChat,
  isMetaChatActive,
  onRefreshProjects
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    if (!onRefreshProjects || isRefreshing) return;
    setIsRefreshing(true);
    try {
      await onRefreshProjects();
    } finally {
      setTimeout(() => setIsRefreshing(false), 500);
    }
  };

  const filteredProjects = projects.filter(p =>
    p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.path.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <aside className="w-64 bg-[#0a0c13] border-r border-[#1a1e2d] flex flex-col h-full select-none flex-shrink-0">
      {/* 1. Header simples: apenas DecoHUB */}
      <div className="p-4 border-b border-[#1a1e2d] flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center text-white shadow-sm">
            <span className="font-bold text-xs tracking-tight">D</span>
          </div>
          <span className="text-sm font-bold text-white tracking-tight">DecoHUB</span>
        </div>
      </div>

      {/* 2. Botão principal: + Novo Projeto */}
      <div className="p-3 border-b border-[#1a1e2d]/60">
        <button
          type="button"
          onClick={onOpenNewProjectModal}
          className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 active:scale-[0.98] text-white text-xs font-semibold shadow-sm transition-all"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Novo Projeto</span>
        </button>
      </div>

      {/* 3. Menu de Navegação Global */}
      <div className="p-2 border-b border-[#1a1e2d]/60 space-y-0.5">
        <button
          type="button"
          onClick={() => {
            if (isMetaChatActive && projects.length > 0) {
              onSelectProject(activeProjectId || projects[0].id);
            }
          }}
          className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
            !isMetaChatActive
              ? 'text-white bg-[#141824]'
              : 'text-slate-400 hover:text-slate-200 hover:bg-[#121520]'
          }`}
        >
          <Layers className="w-3.5 h-3.5 text-indigo-400" />
          <span>Projetos</span>
        </button>
        {onOpenMetaChat && (
          <button
            type="button"
            onClick={onOpenMetaChat}
            className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
              isMetaChatActive
                ? 'text-white bg-cyan-600/20 border border-cyan-500/30 font-semibold'
                : 'text-slate-400 hover:text-slate-200 hover:bg-[#121520]'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
            <span>Meta-Chat</span>
          </button>
        )}
        <button
          type="button"
          onClick={onOpenModelsInfo}
          className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-[#121520] transition-colors"
        >
          <Cpu className="w-3.5 h-3.5 text-slate-400" />
          <span>Modelos</span>
        </button>
        <button
          type="button"
          onClick={onOpenSettings}
          className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-[#121520] transition-colors"
        >
          <Settings className="w-3.5 h-3.5 text-slate-400" />
          <span>Configurações</span>
        </button>
      </div>

      {/* 4. Campo de Busca de Projetos */}
      <div className="px-3 pt-3 pb-1.5">
        <div className="relative">
          <Search className="w-3 h-3 absolute left-2.5 top-2.5 text-slate-500" />
          <input
            type="text"
            placeholder="Buscar projetos..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full bg-[#10131d] border border-[#1e2333] rounded-md py-1.5 pl-7 pr-7 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm('')}
              className="absolute right-2 top-2 p-0.5 rounded text-slate-500 hover:text-slate-300 transition-colors"
              title="Limpar busca"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* 5. Lista de Projetos: Simples e Limpa */}
      <div className="flex-1 overflow-y-auto px-2 py-1 space-y-0.5">
        <div className="px-2 py-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider flex items-center justify-between">
          <span>Meus Projetos ({filteredProjects.length})</span>
          {onRefreshProjects && (
            <button
              type="button"
              onClick={handleRefresh}
              title="Recarregar projetos do disco"
              className="p-1 rounded text-slate-500 hover:text-slate-300 hover:bg-[#151928] transition-colors"
            >
              <RotateCw className={`w-3 h-3 ${isRefreshing ? 'animate-spin text-indigo-400' : ''}`} />
            </button>
          )}
        </div>

        {filteredProjects.length === 0 ? (
          <div className="p-4 text-center text-xs text-slate-500">
            Nenhum projeto encontrado.
          </div>
        ) : (
          filteredProjects.map(proj => {
            const isActive = proj.id === activeProjectId;
            return (
              <button
                key={proj.id}
                type="button"
                onClick={() => onSelectProject(proj.id)}
                className={`w-full text-left p-2 rounded-lg transition-all border ${
                  isActive
                    ? 'bg-[#151928] border-indigo-500/40 text-white shadow-sm'
                    : 'bg-transparent border-transparent hover:bg-[#111420] text-slate-300 hover:text-white'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                      isActive ? 'bg-emerald-400' : 'bg-slate-600'
                    }`}
                  />
                  <span className="text-xs font-medium truncate flex-1">
                    {proj.name}
                  </span>
                </div>
                <div className="text-[10px] text-slate-400 truncate pl-3.5 mt-0.5 font-mono">
                  {proj.path}
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* 6. Rodapé discreto com atalho para Avançado */}
      <div className="p-3 border-t border-[#1a1e2d] flex items-center justify-between text-[11px] text-slate-400">
        <span className="font-medium text-slate-400">DecoHUB v1.1 (Direct Runtime)</span>
        <button
          type="button"
          onClick={onOpenAdvanced}
          className="flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300 transition-colors"
          title="Acessar painel técnico avançado (Autonomous Engine, Council, Arena, Benchmarks)"
        >
          <SlidersHorizontal className="w-3 h-3" />
          <span>Avançado</span>
        </button>
      </div>
    </aside>
  );
};
