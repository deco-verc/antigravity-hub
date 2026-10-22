import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import { FileNode, FileContentResponse, FullProjectDetails } from '../types';
import {
  Folder,
  FolderOpen,
  FileCode,
  FileText,
  File,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  Copy,
  Check,
  Search,
  BookOpen,
  HardDrive
} from 'lucide-react';

interface DecoHubFilesViewProps {
  project: FullProjectDetails;
}

export const DecoHubFilesView: React.FC<DecoHubFilesViewProps> = ({ project }) => {
  const [files, setFiles] = useState<FileNode[]>([]);
  const [rootPath, setRootPath] = useState('');
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedDirs, setExpandedDirs] = useState<Record<string, boolean>>({});

  // Selected file preview
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<FileContentResponse | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  // Memory section
  const [isMemoryOpen, setIsMemoryOpen] = useState(true);

  useEffect(() => {
    if (project.id) {
      loadFiles();
      const interval = setInterval(() => {
        loadFiles();
      }, 8000);
      return () => clearInterval(interval);
    }
  }, [project.id]);

  const loadFiles = async () => {
    setLoading(true);
    try {
      const res = await api.getProjectFiles(project.id);
      setFiles(res.files || []);
      setRootPath(res.rootPath || '');
      // Auto-expand first level dirs
      const initialExpanded: Record<string, boolean> = {};
      res.files?.forEach(f => {
        if (f.isDirectory) initialExpanded[f.relativePath] = true;
      });
      setExpandedDirs(initialExpanded);
    } catch (err) {
      console.error('Falha ao carregar arquivos:', err);
    } finally {
      setLoading(false);
    }
  };

  const toggleDir = (relPath: string) => {
    setExpandedDirs(prev => ({
      ...prev,
      [relPath]: !prev[relPath]
    }));
  };

  const handleOpenFile = async (relPath: string) => {
    setSelectedFile(relPath);
    setContentLoading(true);
    try {
      const res = await api.getFileContent(project.id, relPath);
      setFileContent(res);
    } catch (err) {
      console.error('Erro ao ler arquivo:', err);
      setFileContent(null);
    } finally {
      setContentLoading(false);
    }
  };

  const handleOpenMemoryDoc = async (docPath: string) => {
    setSelectedFile(docPath);
    setContentLoading(true);
    try {
      const res = await api.getFileContent(project.id, docPath);
      if (res && typeof res.content === 'string') {
        setFileContent(res);
        return;
      }
      throw new Error('Conteúdo vazio');
    } catch {
      // Fallback para cache local se API falhar
      const filename = docPath.replace('.ai-dev-hub/', '');
      const memoryMap: Record<string, string> = {
        'project.md': project.memory?.projectMd || '',
        'architecture.md': project.memory?.architectureMd || '',
        'tasks.md': project.memory?.tasksMd || '',
        'decisions.md': project.memory?.decisionsMd || '',
        'changes.md': project.memory?.changesMd || '',
        'session-summary.md': project.memory?.sessionSummaryMd || ''
      };
      const content = memoryMap[filename] || '';
      setFileContent({
        path: docPath,
        content,
        size: content.length,
        extension: '.md'
      });
    } finally {
      setContentLoading(false);
    }
  };

  const copyContent = () => {
    if (fileContent?.content) {
      navigator.clipboard.writeText(fileContent.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const memoryFiles = [
    { path: '.ai-dev-hub/project.md', label: 'project.md', desc: 'Objetivo e escopo consolidado' },
    { path: '.ai-dev-hub/architecture.md', label: 'architecture.md', desc: 'Arquitetura técnica e stack' },
    { path: '.ai-dev-hub/tasks.md', label: 'tasks.md', desc: 'Tarefas e Kanban vivo' },
    { path: '.ai-dev-hub/decisions.md', label: 'decisions.md', desc: 'Log de decisões técnicas' },
    { path: '.ai-dev-hub/changes.md', label: 'changes.md', desc: 'Histórico de arquivos alterados' },
    { path: '.ai-dev-hub/session-summary.md', label: 'session-summary.md', desc: 'Último resumo consolidado' },
    { path: '.ai-dev-hub/specs/CONTEUDO.md', label: 'specs/CONTEUDO.md', desc: 'Conteúdo & REA' },
    { path: '.ai-dev-hub/specs/BACKEND.md', label: 'specs/BACKEND.md', desc: 'Contratos SQLite & REST' },
    { path: '.ai-dev-hub/specs/DESIGN.md', label: 'specs/DESIGN.md', desc: 'Design System & UI' },
    { path: '.ai-dev-hub/specs/PRINCIPIOS.md', label: 'specs/PRINCIPIOS.md', desc: 'Princípios Invariantes' },
    { path: '.ai-dev-hub/specs/JORNADAS.md', label: 'specs/JORNADAS.md', desc: 'Jornadas de Teste' },
    { path: '.ai-dev-hub/rea-blueprint.md', label: 'rea-blueprint.md', desc: 'Blueprint SaaS & Pilares' },
    { path: '.ai-dev-hub/market-research-rea.md', label: 'market-research-rea.md', desc: 'Pesquisa de Mercado' },
    { path: '.ai-dev-hub/lessons.md', label: 'lessons.md', desc: 'Lições Operacionais' },
    { path: '.ai-dev-hub/program.md', label: 'program.md', desc: 'Programa de Execução' }
  ];

  // Filter files by search term
  const filterNodes = (nodes: FileNode[]): FileNode[] => {
    if (!searchTerm.trim()) return nodes;
    const term = searchTerm.toLowerCase();

    return nodes
      .map(node => {
        if (node.isDirectory && node.children) {
          const filteredChildren = filterNodes(node.children);
          if (filteredChildren.length > 0 || node.name.toLowerCase().includes(term)) {
            return { ...node, children: filteredChildren };
          }
          return null;
        }
        if (node.name.toLowerCase().includes(term) || node.relativePath.toLowerCase().includes(term)) {
          return node;
        }
        return null;
      })
      .filter((n): n is FileNode => n !== null);
  };

  const filteredFileList = filterNodes(files);

  const renderFileTree = (nodes: FileNode[], depth = 0) => {
    return nodes.map(node => {
      const isExpanded = expandedDirs[node.relativePath];
      const isSelected = selectedFile === node.relativePath;

      if (node.isDirectory) {
        return (
          <div key={node.relativePath} className="select-none">
            <button
              type="button"
              onClick={() => toggleDir(node.relativePath)}
              style={{ paddingLeft: `${depth * 14 + 10}px` }}
              className="w-full flex items-center gap-1.5 py-1 text-xs text-slate-300 hover:text-white hover:bg-[#151928] rounded-md transition-colors text-left"
            >
              {isExpanded ? (
                <ChevronDown className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
              )}
              {isExpanded ? (
                <FolderOpen className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />
              ) : (
                <Folder className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
              )}
              <span className="truncate font-medium">{node.name}</span>
            </button>

            {isExpanded && node.children && (
              <div>{renderFileTree(node.children, depth + 1)}</div>
            )}
          </div>
        );
      }

      return (
        <button
          key={node.relativePath}
          type="button"
          onClick={() => handleOpenFile(node.relativePath)}
          style={{ paddingLeft: `${depth * 14 + 26}px` }}
          className={`w-full flex items-center gap-2 py-1 text-xs rounded-md transition-colors text-left ${
            isSelected
              ? 'bg-indigo-600/20 text-indigo-300 font-medium'
              : 'text-slate-300 hover:text-white hover:bg-[#151928]'
          }`}
        >
          {node.name.endsWith('.md') ? (
            <FileText className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />
          ) : node.name.match(/\.(ts|tsx|js|jsx|json|py)$/) ? (
            <FileCode className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0" />
          ) : (
            <File className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
          )}
          <span className="truncate">{node.name}</span>
        </button>
      );
    });
  };

  return (
    <div className="flex-1 flex h-full bg-[#080a10] overflow-hidden">
      {/* 1. Painel Esquerdo: Árvore de Arquivos e Memória */}
      <div className="w-80 bg-[#0c0e17] border-r border-[#1b2033] flex flex-col h-full flex-shrink-0">
        {/* Header com Busca */}
        <div className="p-3 border-b border-[#1b2033] space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
              Arquivos do Projeto
            </span>
            <button
              onClick={loadFiles}
              disabled={loading}
              className="p-1 rounded text-slate-400 hover:text-white hover:bg-[#161a2b] transition-colors"
              title="Recarregar arquivos"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          <div className="relative">
            <Search className="w-3 h-3 absolute left-2.5 top-2.5 text-slate-500" />
            <input
              type="text"
              placeholder="Filtrar arquivos..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full bg-[#10131d] border border-[#1e2333] rounded-md py-1.5 pl-7 pr-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>

        {/* Seção Especial: Memória do Projeto (.ai-dev-hub) */}
        <div className="border-b border-[#1b2033]">
          <button
            type="button"
            onClick={() => setIsMemoryOpen(!isMemoryOpen)}
            className="w-full px-3 py-2 flex items-center justify-between text-xs font-semibold text-indigo-300 hover:bg-[#121626] transition-colors"
          >
            <div className="flex items-center gap-1.5">
              <BookOpen className="w-3.5 h-3.5 text-indigo-400" />
              <span>Memória & Especificações (.ai-dev-hub)</span>
            </div>
            {isMemoryOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </button>

          {isMemoryOpen && (
            <div className="px-2 pb-2 space-y-0.5 max-h-56 overflow-y-auto">
              {memoryFiles.map(doc => (
                <button
                  key={doc.path}
                  type="button"
                  onClick={() => handleOpenMemoryDoc(doc.path)}
                  className={`w-full flex items-center justify-between px-2.5 py-1 text-xs rounded-md transition-colors text-left ${
                    selectedFile === doc.path
                      ? 'bg-indigo-600/25 text-indigo-300 font-medium'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-[#141828]'
                  }`}
                >
                  <span className="font-mono text-[11px] truncate">{doc.label}</span>
                  <span className="text-[10px] text-slate-400 truncate max-w-[110px] text-right">{doc.desc}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Lista de Arquivos do Projeto */}
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {loading ? (
            <div className="p-6 text-center text-xs text-slate-500">
              Carregando árvore de arquivos...
            </div>
          ) : filteredFileList.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500">
              Nenhum arquivo encontrado.
            </div>
          ) : (
            renderFileTree(filteredFileList)
          )}
        </div>
      </div>

      {/* 2. Painel Direito: Visualizador de Conteúdo */}
      <div className="flex-1 flex flex-col h-full bg-[#080a10] overflow-hidden">
        {selectedFile && fileContent ? (
          <>
            {/* Header do arquivo selecionado */}
            <div className="px-6 py-3 bg-[#0e111a] border-b border-[#1b2033] flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono font-semibold text-slate-200">
                  {selectedFile}
                </span>
                {fileContent.size !== undefined && (
                  <span className="text-[10px] text-slate-500 font-mono">
                    ({Math.round(fileContent.size / 1024 * 10) / 10} KB)
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={copyContent}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#141824] hover:bg-[#1c2234] border border-[#23293d] text-xs text-slate-300 hover:text-white transition-colors"
                title="Copiar conteúdo"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copiado!' : 'Copiar'}</span>
              </button>
            </div>

            {/* Conteúdo do arquivo */}
            <div className="flex-1 overflow-auto p-6 font-mono text-xs leading-relaxed text-slate-300 bg-[#07090e]">
              {contentLoading ? (
                <div className="text-slate-500 italic">Carregando conteúdo...</div>
              ) : (
                <pre className="whitespace-pre-wrap">{fileContent.content}</pre>
              )}
            </div>
          </>
        ) : (
          /* Estado Vazio */
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-500 space-y-3">
            <HardDrive className="w-10 h-10 text-slate-600" />
            <p className="text-xs">
              Selecione um arquivo ou documento de memória na barra lateral para visualizar o conteúdo.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
