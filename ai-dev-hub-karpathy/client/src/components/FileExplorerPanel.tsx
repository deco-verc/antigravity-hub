import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import { FileNode, FileContentResponse } from '../types';
import {
  Folder,
  FolderOpen,
  FileCode,
  FileText,
  File,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  X,
  ExternalLink,
  Code2,
  Copy,
  Check,
  Eye,
  PanelRightClose,
  PanelRightOpen
} from 'lucide-react';

interface FileExplorerPanelProps {
  projectId: string | null;
  isOpen: boolean;
  onToggle: () => void;
  onFileSelect?: (filePath: string) => void;
}

export const FileExplorerPanel: React.FC<FileExplorerPanelProps> = ({
  projectId,
  isOpen,
  onToggle,
  onFileSelect
}) => {
  const [files, setFiles] = useState<FileNode[]>([]);
  const [rootPath, setRootPath] = useState('');
  const [loading, setLoading] = useState(false);
  const [expandedDirs, setExpandedDirs] = useState<Record<string, boolean>>({});
  
  // Selected file preview
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<FileContentResponse | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (projectId && isOpen) {
      loadFiles();
    }
  }, [projectId, isOpen]);

  const loadFiles = async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const res = await api.getProjectFiles(projectId);
      setFiles(res.files || []);
      setRootPath(res.rootPath || '');
      // Auto-expand first level directories
      const initialExpanded: Record<string, boolean> = {};
      res.files?.forEach(f => {
        if (f.isDirectory) initialExpanded[f.relativePath] = true;
      });
      setExpandedDirs(initialExpanded);
    } catch (err) {
      console.error('Falha ao carregar arquivos do projeto:', err);
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
    if (!projectId) return;
    setSelectedFile(relPath);
    setContentLoading(true);
    if (onFileSelect) onFileSelect(relPath);
    try {
      const res = await api.getFileContent(projectId, relPath);
      setFileContent(res);
    } catch (err) {
      console.error('Erro ao ler arquivo:', err);
      setFileContent(null);
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

  const getFileIcon = (fileName: string) => {
    const ext = fileName.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'ts':
      case 'tsx':
      case 'js':
      case 'jsx':
      case 'html':
      case 'css':
      case 'json':
      case 'py':
        return <FileCode className="w-4 h-4 text-cyan-400 flex-shrink-0" />;
      case 'md':
      case 'txt':
        return <FileText className="w-4 h-4 text-amber-400 flex-shrink-0" />;
      default:
        return <File className="w-4 h-4 text-slate-400 flex-shrink-0" />;
    }
  };

  const renderTree = (nodes: FileNode[], depth = 0) => {
    return (
      <ul className="space-y-0.5">
        {nodes.map(node => {
          const isExpanded = expandedDirs[node.relativePath];
          const isSelected = selectedFile === node.relativePath;

          if (node.isDirectory) {
            return (
              <li key={node.relativePath}>
                <button
                  onClick={() => toggleDir(node.relativePath)}
                  style={{ paddingLeft: `${depth * 12 + 8}px` }}
                  className="w-full text-left py-1 px-2 rounded-md hover:bg-[#181d2c] text-xs font-mono flex items-center gap-1.5 text-slate-300 transition-colors group"
                >
                  {isExpanded ? (
                    <ChevronDown className="w-3.5 h-3.5 text-slate-500 group-hover:text-slate-300" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 text-slate-500 group-hover:text-slate-300" />
                  )}
                  {isExpanded ? (
                    <FolderOpen className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />
                  ) : (
                    <Folder className="w-3.5 h-3.5 text-indigo-400/70 flex-shrink-0" />
                  )}
                  <span className="truncate">{node.name}</span>
                </button>
                {isExpanded && node.children && node.children.length > 0 && (
                  <div>{renderTree(node.children, depth + 1)}</div>
                )}
              </li>
            );
          }

          return (
            <li key={node.relativePath}>
              <button
                onClick={() => handleOpenFile(node.relativePath)}
                style={{ paddingLeft: `${depth * 12 + 22}px` }}
                className={`w-full text-left py-1 px-2 rounded-md text-xs font-mono flex items-center justify-between transition-colors ${
                  isSelected
                    ? 'bg-indigo-600/20 text-indigo-300 font-medium border-l-2 border-indigo-500'
                    : 'text-slate-400 hover:bg-[#141824] hover:text-slate-200'
                }`}
              >
                <div className="flex items-center gap-1.5 truncate">
                  {getFileIcon(node.name)}
                  <span className="truncate">{node.name}</span>
                </div>
                {node.size !== undefined && (
                  <span className="text-[10px] text-slate-600 font-sans ml-2">
                    {node.size < 1024 ? `${node.size} B` : `${(node.size / 1024).toFixed(1)} KB`}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    );
  };

  if (!isOpen) {
    return (
      <button
        onClick={onToggle}
        className="fixed right-3 top-16 z-20 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#141824] border border-[#23293d] text-xs font-medium text-slate-300 hover:text-white hover:bg-[#1a2030] shadow-md transition-all"
        title="Abrir Explorer de Arquivos"
      >
        <PanelRightOpen className="w-3.5 h-3.5 text-indigo-400" />
        <span>Arquivos</span>
      </button>
    );
  }

  return (
    <aside className="w-80 flex-shrink-0 h-full border-l border-[#1e2233] bg-[#0c0e17] flex flex-col z-20">
      {/* Explorer Header */}
      <div className="px-3 py-2.5 border-b border-[#1b2033] flex items-center justify-between bg-[#0e111c]">
        <div className="flex items-center gap-2">
          <Code2 className="w-4 h-4 text-indigo-400" />
          <span className="text-xs font-bold text-white tracking-wide uppercase">Arquivos</span>
          <span className="text-[10px] bg-[#1e2338] px-1.5 py-0.5 rounded text-slate-400 font-mono">
            {files.length}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={loadFiles}
            disabled={loading}
            className="p-1 rounded text-slate-400 hover:text-white hover:bg-[#181d2e] transition-colors"
            title="Atualizar lista de arquivos"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-indigo-400' : ''}`} />
          </button>
          <button
            onClick={onToggle}
            className="p-1 rounded text-slate-400 hover:text-white hover:bg-[#181d2e] transition-colors"
            title="Recolher painel de arquivos"
          >
            <PanelRightClose className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Explorer Body: File Tree */}
      <div className="flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-xs text-slate-500">
            <RefreshCw className="w-4 h-4 animate-spin text-indigo-400 mr-2" />
            <span>Carregando arquivos...</span>
          </div>
        ) : files.length === 0 ? (
          <div className="text-center p-6 text-xs text-slate-500">
            Nenhum arquivo encontrado no projeto.
          </div>
        ) : (
          renderTree(files)
        )}
      </div>

      {/* Quick File Preview Modal/Panel if file selected */}
      {selectedFile && (
        <div className="border-t border-[#1e2233] bg-[#0a0c14] max-h-64 flex flex-col overflow-hidden">
          <div className="px-3 py-1.5 bg-[#101422] border-b border-[#1b2033] flex items-center justify-between">
            <div className="flex items-center gap-1.5 truncate">
              {getFileIcon(selectedFile)}
              <span className="text-xs font-mono font-medium text-slate-200 truncate">{selectedFile}</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={copyContent}
                className="p-1 rounded text-slate-400 hover:text-white hover:bg-[#181d2c] transition-colors"
                title="Copiar código"
              >
                {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              </button>
              <button
                onClick={() => setSelectedFile(null)}
                className="p-1 rounded text-slate-400 hover:text-white hover:bg-[#181d2c] transition-colors"
                title="Fechar preview"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-auto p-2 text-[11px] font-mono text-slate-300 bg-[#08090f]">
            {contentLoading ? (
              <div className="p-4 text-center text-slate-500">Carregando conteúdo...</div>
            ) : fileContent?.content ? (
              <pre className="whitespace-pre-wrap leading-relaxed select-text">{fileContent.content}</pre>
            ) : (
              <div className="p-4 text-center text-slate-500">Arquivo vazio ou binário</div>
            )}
          </div>
        </div>
      )}
    </aside>
  );
};
