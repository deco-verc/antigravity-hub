import React, { useState, useEffect, useRef } from 'react';
import { SlashCommandItem } from '../types';
import { api } from '../services/api';
import {
  Sparkles,
  Zap,
  Terminal,
  Shield,
  Palette,
  Camera,
  Layers,
  Code2,
  BookOpen,
  Search,
  CheckCircle2,
  HelpCircle,
  X,
  ChevronRight
} from 'lucide-react';

interface SlashCommandMenuProps {
  isOpen: boolean;
  filterText: string;
  onSelectCommand: (command: SlashCommandItem) => void;
  onClose: () => void;
  commands?: SlashCommandItem[];
}

export const FALLBACK_COMMANDS: SlashCommandItem[] = [
  {
    command: '/frontend',
    aliases: ['/ui', '/taste'],
    title: 'Frontend & UI Craft Elevado',
    description: 'Eleva a interface do projeto para classe mundial com tokens :root, Lucide SVGs, Bento Grids e validação Playwright.',
    category: 'Design & UI',
    skillsUsed: ['taste-skill', 'ui-styling', 'design-system', 'stitch-skill', 'output-skill', 'gpt-tasteskill', 'vercel-web-design-guidelines'],
    executionType: 'AUTONOMOUS_DELTA',
    argHint: '[orientações de estética e layout]'
  },
  {
    command: '/redesign',
    aliases: ['/refactor-ui'],
    title: 'Redesign Integral & Modernização UI',
    description: 'Reestrutura e moderniza a interface visual de ponta a ponta, preservando 100% de backend, banco SQLite e suíte de testes.',
    category: 'Design & UI',
    skillsUsed: ['redesign-skill', 'design', 'ui-styling', 'design-system', 'brandkit'],
    executionType: 'AUTONOMOUS_DELTA',
    argHint: '[instrução de modernização]'
  },
  {
    command: '/style',
    aliases: [],
    title: 'Arquétipo Estético & Sistema de Cores',
    description: 'Aplica um arquétipo visual refinado ao DESIGN.md e transforma as superfícies e componentes da UI.',
    category: 'Design & UI',
    skillsUsed: ['minimalist-skill', 'brutalist-skill', 'soft-skill', 'design-system'],
    executionType: 'AUTONOMOUS_DELTA',
    argHint: 'minimalist | brutalist | soft | linear | stripe | vercel | dark-telemetry'
  },
  {
    command: '/image',
    aliases: ['/shot', '/screenshot', '/print'],
    title: 'Captura Visual Real Playwright',
    description: 'Sobe a aplicação, captura telas reais em alta resolução (Desktop 1280x800 e Mobile 390x844) e retorna as fotos na hora com telemetria.',
    category: 'Playwright Vision',
    skillsUsed: ['playwright-agent-cli'],
    executionType: 'IMMEDIATE_TOOL',
    argHint: '[url ou rota interna ex: /dashboard]'
  },
  {
    command: '/img2code',
    aliases: ['/vision-ui'],
    title: 'Conversão de Print para Código (Image-to-Code)',
    description: 'Converte layout, print ou mockup referenciado em componentes HTML/CSS/JS integrados com precisão visual.',
    category: 'Design & UI',
    skillsUsed: ['image-to-code-skill', 'imagegen-frontend-web', 'imagegen-frontend-mobile', 'stitch-skill'],
    executionType: 'AUTONOMOUS_DELTA',
    argHint: '[caminho do print ou descrição do componente]'
  },
  {
    command: '/rea',
    aliases: ['/enterprise-saas'],
    title: 'SaaS Master morluto/rea (7 Pilares)',
    description: 'Audita e implementa a arquitetura dos 7 Pilares Corporativos: App Shell + Ctrl+K, Drawers laterais, Grids com CSV, BI Charts, Audit Logs e Store.',
    category: 'Architecture',
    skillsUsed: ['rea-saas-master', 'design-system', 'ui-styling'],
    executionType: 'AUTONOMOUS_DELTA',
    argHint: '[foco de auditoria ou pilar específico]'
  },
  {
    command: '/karpathy',
    aliases: ['/clean-code'],
    title: 'Diretrizes Andrej Karpathy (Clean Code)',
    description: 'Refatora, simplifica e elimina complexidade acidental e código espaguete com foco cirúrgico e 100% de testes verdes.',
    category: 'Code Quality',
    skillsUsed: ['karpathy-guidelines'],
    executionType: 'AUTONOMOUS_DELTA',
    argHint: '[módulo ou arquivo para simplificação]'
  },
  {
    command: '/brand',
    aliases: ['/banner', '/slides'],
    title: 'Brandkit, Banners Hero & Slides Interativos',
    description: 'Gera ou atualiza kits de identidade visual, hero banners vetoriais e decks de apresentação HTML interativos.',
    category: 'Design & UI',
    skillsUsed: ['brandkit', 'brand', 'banner-design', 'slides'],
    executionType: 'AUTONOMOUS_DELTA',
    argHint: 'kit | banner | slides [orientações]'
  },
  {
    command: '/ux',
    aliases: ['/user-test'],
    title: 'Simulador de Jornadas de Usuário Real',
    description: 'Testa navegação, formulários, persistência F5 e detecta botões mortos em headless browser com laudo e fotos instantâneas.',
    category: 'Security & QA',
    skillsUsed: ['playwright-agent-cli'],
    executionType: 'IMMEDIATE_TOOL',
    argHint: '[fix | rota específica]'
  },
  {
    command: '/pentest',
    aliases: ['/security'],
    title: 'Security Pentest Red Team (OWASP Top 10)',
    description: 'Dispara testes ofensivos de Path Traversal, SQLi, XSS, Fuzzing e vazamento de credenciais com laudo instantâneo.',
    category: 'Security & QA',
    skillsUsed: [],
    executionType: 'IMMEDIATE_TOOL',
    argHint: '[fix | vetor específico]'
  },
  {
    command: '/docs',
    aliases: [],
    title: 'Extrator & Biblioteca de Documentação DOCSIMP',
    description: 'Extrai documentação técnica de URL externa ou vincula serviços (ex: Stripe, Supabase, Redis) com chaves Mock Fallback.',
    category: 'Docs & Workflow',
    skillsUsed: ['find-skills'],
    executionType: 'IMMEDIATE_TOOL',
    argHint: '<url | nome_do_servico>'
  },
  {
    command: '/find',
    aliases: ['/triage', '/pr-label'],
    title: 'Descoberta de Skills, Triagem & Labels',
    description: 'Localiza skills no catálogo aberto skills.sh/local, executa triagem de tarefas pendentes ou rotula PRs e commits.',
    category: 'Docs & Workflow',
    skillsUsed: ['find-skills', 'triage', 'pr-labeling'],
    executionType: 'IMMEDIATE_TOOL',
    argHint: '[termo de busca | triage | pr-label]'
  },
  {
    command: '/skills',
    aliases: ['/help'],
    title: 'Painel Central de Slash Commands & Arsenal',
    description: 'Exibe a relação completa de comandos sob demanda, atalhos, skills acionadas e sintaxe de uso.',
    category: 'Docs & Workflow',
    skillsUsed: [],
    executionType: 'IMMEDIATE_TOOL',
    argHint: '[comando específico para detalhes]'
  }
];

export const SlashCommandMenu: React.FC<SlashCommandMenuProps> = ({
  isOpen,
  filterText,
  onSelectCommand,
  onClose,
  commands: propCommands
}) => {
  const [commandsList, setCommandsList] = useState<SlashCommandItem[]>(propCommands || FALLBACK_COMMANDS);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let isMounted = true;
    api.getSlashCommands()
      .then(cmds => {
        if (isMounted && Array.isArray(cmds) && cmds.length > 0) {
          setCommandsList(cmds);
        }
      })
      .catch(() => {
        // Fallback already in place
      });
    return () => {
      isMounted = false;
    };
  }, []);

  const cleanFilter = (filterText || '').toLowerCase().trim();

  const filteredCommands = commandsList.filter(cmd => {
    if (!cleanFilter) return true;
    const matchCmd = cmd.command.toLowerCase().replace('/', '').includes(cleanFilter.replace('/', ''));
    const matchAliases = cmd.aliases.some(a => a.toLowerCase().replace('/', '').includes(cleanFilter.replace('/', '')));
    const matchTitle = cmd.title.toLowerCase().includes(cleanFilter);
    const matchCategory = cmd.category.toLowerCase().includes(cleanFilter);
    const matchSkills = cmd.skillsUsed.some(s => s.toLowerCase().includes(cleanFilter));
    return matchCmd || matchAliases || matchTitle || matchCategory || matchSkills;
  });

  useEffect(() => {
    setSelectedIndex(0);
  }, [filterText, commandsList.length]);

  useEffect(() => {
    if (!listRef.current) return;
    const items = listRef.current.querySelectorAll('[data-command-item]');
    if (items[selectedIndex]) {
      items[selectedIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [selectedIndex]);

  // Handle keyboard navigation if menu is open
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(prev => (prev + 1) % Math.max(1, filteredCommands.length));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(prev => (prev - 1 + filteredCommands.length) % Math.max(1, filteredCommands.length));
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        if (filteredCommands.length > 0 && filteredCommands[selectedIndex]) {
          e.preventDefault();
          onSelectCommand(filteredCommands[selectedIndex]);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [isOpen, filteredCommands, selectedIndex, onSelectCommand, onClose]);

  if (!isOpen) return null;

  const getCategoryBadgeClass = (category: string) => {
    switch (category) {
      case 'Design & UI':
        return 'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30';
      case 'Playwright Vision':
        return 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30';
      case 'Architecture':
        return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
      case 'Security & QA':
        return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
      case 'Code Quality':
        return 'bg-violet-500/15 text-violet-300 border-violet-500/30';
      case 'Docs & Workflow':
      default:
        return 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30';
    }
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'Design & UI':
        return <Palette className="w-3.5 h-3.5 text-fuchsia-400" />;
      case 'Playwright Vision':
        return <Camera className="w-3.5 h-3.5 text-cyan-400" />;
      case 'Architecture':
        return <Layers className="w-3.5 h-3.5 text-emerald-400" />;
      case 'Security & QA':
        return <Shield className="w-3.5 h-3.5 text-amber-400" />;
      case 'Code Quality':
        return <Code2 className="w-3.5 h-3.5 text-violet-400" />;
      case 'Docs & Workflow':
      default:
        return <BookOpen className="w-3.5 h-3.5 text-indigo-400" />;
    }
  };

  return (
    <div
      className="absolute bottom-full left-0 right-0 mb-2 z-50 rounded-2xl bg-[#0a0d17]/95 border border-[#20283e] shadow-2xl backdrop-blur-xl overflow-hidden flex flex-col max-h-[380px] animate-in fade-in slide-in-from-bottom-2 duration-150"
      onClick={e => e.stopPropagation()}
    >
      {/* Top Header */}
      <div className="px-3.5 py-2.5 bg-[#0f1422] border-b border-[#1c2438] flex items-center justify-between text-xs">
        <div className="flex items-center gap-2 text-indigo-300 font-semibold tracking-tight">
          <Terminal className="w-4 h-4 text-indigo-400" />
          <span>Slash Commands & Arsenal de Skills</span>
          <span className="text-[10px] px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-300 font-mono">
            {filteredCommands.length} disponível(is)
          </span>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-slate-400">
          <span>Use <kbd className="px-1 py-0.5 rounded bg-[#1c2235] text-slate-300 font-mono">↑</kbd> <kbd className="px-1 py-0.5 rounded bg-[#1c2235] text-slate-300 font-mono">↓</kbd> para navegar e <kbd className="px-1 py-0.5 rounded bg-[#1c2235] text-slate-300 font-mono">Enter</kbd> para selecionar</span>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-[#1a2135] transition-colors"
            title="Fechar menu"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Commands List */}
      <div ref={listRef} className="flex-1 overflow-y-auto p-2 space-y-1 divide-y divide-[#171e30]">
        {filteredCommands.length === 0 ? (
          <div className="py-6 text-center text-xs text-slate-400">
            Nenhum slash command encontrado para "<span className="text-white font-mono">{filterText}</span>".
          </div>
        ) : (
          filteredCommands.map((cmd, idx) => {
            const isSelected = idx === selectedIndex;
            return (
              <div
                key={cmd.command}
                data-command-item
                onClick={() => onSelectCommand(cmd)}
                onMouseEnter={() => setSelectedIndex(idx)}
                className={`group flex items-start justify-between gap-3 p-2.5 rounded-xl cursor-pointer transition-all ${
                  isSelected
                    ? 'bg-indigo-600/20 border border-indigo-500/40 text-white shadow-sm'
                    : 'hover:bg-[#121727] border border-transparent text-slate-300'
                }`}
              >
                <div className="flex items-start gap-2.5 flex-1 min-w-0">
                  <div className={`p-1.5 rounded-lg border mt-0.5 flex-shrink-0 ${getCategoryBadgeClass(cmd.category)}`}>
                    {getCategoryIcon(cmd.category)}
                  </div>

                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-bold text-sm text-indigo-300 group-hover:text-indigo-200">
                        {cmd.command}
                      </span>
                      {cmd.aliases.length > 0 && (
                        <span className="text-[10px] text-slate-500 font-mono">
                          (ou {cmd.aliases.join(', ')})
                        </span>
                      )}
                      {cmd.argHint && (
                        <span className="text-[11px] text-slate-400 font-mono italic">
                          {cmd.argHint}
                        </span>
                      )}
                      <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ml-auto sm:ml-0 ${getCategoryBadgeClass(cmd.category)}`}>
                        {cmd.category}
                      </span>
                    </div>

                    <p className="text-xs text-slate-300 line-clamp-2 leading-relaxed">
                      {cmd.description}
                    </p>

                    {cmd.skillsUsed.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1 pt-0.5">
                        <span className="text-[10px] text-slate-500">Skills:</span>
                        {cmd.skillsUsed.map(sk => (
                          <span
                            key={sk}
                            className="text-[9px] px-1.5 py-0.5 rounded bg-[#131929] border border-[#212a42] text-slate-400 font-mono"
                          >
                            {sk}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex flex-col items-end gap-1 flex-shrink-0 text-[10px]">
                  <span className={`px-2 py-0.5 rounded-md font-mono font-medium ${
                    cmd.executionType === 'IMMEDIATE_TOOL'
                      ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                      : 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                  }`}>
                    {cmd.executionType === 'IMMEDIATE_TOOL' ? 'Imediato' : 'Autônomo'}
                  </span>
                  <ChevronRight className={`w-3.5 h-3.5 transition-transform ${isSelected ? 'text-indigo-300 translate-x-0.5' : 'text-slate-600'}`} />
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
