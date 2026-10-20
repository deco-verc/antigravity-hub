import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  X,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  Image as ImageIcon,
  ExternalLink
} from 'lucide-react';

export interface LightboxImageItem {
  url: string;
  label?: string;
  filename?: string;
  title?: string;
  sectionName?: string;
  index?: number;
  total?: number;
  sizeBytes?: number;
}

export interface ImageCarouselLightboxProps {
  isOpen: boolean;
  onClose: () => void;
  images: LightboxImageItem[];
  initialIndex?: number;
}

export const ImageCarouselLightbox: React.FC<ImageCarouselLightboxProps> = ({
  isOpen,
  onClose,
  images,
  initialIndex = 0
}) => {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [isZoomed, setIsZoomed] = useState(false);

  // Sync index when initialIndex changes or modal opens
  useEffect(() => {
    if (isOpen) {
      const validIndex = typeof initialIndex === 'number' && initialIndex >= 0 && initialIndex < images.length
        ? initialIndex
        : 0;
      setCurrentIndex(validIndex);
      setIsZoomed(false);
    }
  }, [isOpen, initialIndex, images.length]);

  const total = images.length;
  const currentImage = useMemo(() => {
    if (total === 0) return null;
    return images[currentIndex] || images[0];
  }, [images, currentIndex, total]);

  const handleNext = useCallback(() => {
    if (total <= 1) return;
    setCurrentIndex(prev => (prev + 1) % total);
    setIsZoomed(false);
  }, [total]);

  const handlePrev = useCallback(() => {
    if (total <= 1) return;
    setCurrentIndex(prev => (prev - 1 + total) % total);
    setIsZoomed(false);
  }, [total]);

  // Keyboard navigation: ArrowRight (next), ArrowLeft (prev), Escape (close)
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleNext();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handlePrev();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleNext, handlePrev, onClose]);

  if (!isOpen || !currentImage) return null;

  const filename = currentImage.filename || (currentImage.url ? currentImage.url.split('/').pop()?.split('?')[0] : '') || 'screenshot.png';
  const cleanSection = currentImage.sectionName || currentImage.title || currentImage.label || filename;
  const displayNumber = currentImage.index || (currentIndex + 1);
  const displayTotal = currentImage.total || total;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/92 backdrop-blur-md flex flex-col justify-between animate-in fade-in duration-200 select-none overflow-hidden"
      onClick={onClose}
    >
      {/* 1. Header do Lightbox */}
      <div
        className="px-5 py-3.5 bg-[#0a0d17]/95 border-b border-[#1b2234] flex items-center justify-between z-20 text-xs shadow-md"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-indigo-500/15 border border-indigo-500/30 text-indigo-400 flex items-center justify-center flex-shrink-0">
            <ImageIcon className="w-4 h-4" />
          </div>

          <div className="flex items-center gap-2 truncate">
            {/* Contador Tabular Canônico */}
            <span className="px-2.5 py-1 rounded-md bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 font-mono font-bold tabular-nums text-xs flex-shrink-0">
              [ {displayNumber} / {displayTotal} ]
            </span>

            {/* Nome do Ficheiro */}
            <span className="text-white font-mono font-semibold truncate text-xs" title={filename}>
              {filename}
            </span>

            {/* Selo da Secção */}
            <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[11px] font-medium flex-shrink-0">
              Secção: {cleanSection}
            </span>
          </div>
        </div>

        {/* Controles de Topo: Zoom, Abrir em Nova Aba, Fechar */}
        <div className="flex items-center gap-2 flex-shrink-0 ml-3">
          <button
            type="button"
            onClick={() => setIsZoomed(prev => !prev)}
            className="px-3 py-1.5 rounded-xl bg-[#121624] hover:bg-[#1a2033] border border-[#232b40] text-slate-300 hover:text-white flex items-center gap-1.5 text-xs font-semibold transition-colors shadow-sm"
            title={isZoomed ? "Ajustar ao ecrã" : "Ampliar para tamanho original (100%)"}
          >
            {isZoomed ? (
              <>
                <Minimize2 className="w-3.5 h-3.5 text-indigo-400" />
                <span className="hidden sm:inline">Ajustar ao Ecrã</span>
              </>
            ) : (
              <>
                <Maximize2 className="w-3.5 h-3.5 text-indigo-400" />
                <span className="hidden sm:inline">100% Zoom</span>
              </>
            )}
          </button>

          <a
            href={currentImage.url}
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 rounded-xl bg-[#121624] hover:bg-[#1a2033] border border-[#232b40] text-slate-400 hover:text-white transition-colors"
            title="Abrir imagem em nova aba"
          >
            <ExternalLink className="w-4 h-4" />
          </a>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl bg-[#121624] hover:bg-rose-500/20 border border-[#232b40] hover:border-rose-500/40 text-slate-400 hover:text-rose-300 transition-colors ml-1"
            title="Fechar (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 2. Palco Central: Imagem com Botões Laterais Flutuantes */}
      <div
        className="relative flex-1 flex items-center justify-center p-3 sm:p-6 overflow-hidden min-h-[300px]"
        onClick={e => e.stopPropagation()}
      >
        {/* Botão Lateral Anterior (‹) */}
        {total > 1 && (
          <button
            type="button"
            onClick={e => {
              e.stopPropagation();
              handlePrev();
            }}
            className="absolute left-3 sm:left-6 top-1/2 -translate-y-1/2 z-30 p-3 sm:p-3.5 rounded-2xl bg-black/60 hover:bg-indigo-600/90 text-white/80 hover:text-white border border-white/10 hover:border-indigo-400/50 backdrop-blur-md transition-all shadow-2xl hover:scale-105 active:scale-95 group"
            title="Secção Anterior (Seta Esquerda ←)"
            aria-label="Secção Anterior"
          >
            <ChevronLeft className="w-6 h-6 group-hover:-translate-x-0.5 transition-transform" />
          </button>
        )}

        {/* Visualizador da Imagem */}
        <div
          className={`w-full h-full flex items-center justify-center transition-all ${
            isZoomed
              ? 'overflow-auto cursor-zoom-out p-4'
              : 'overflow-hidden cursor-zoom-in'
          }`}
          onClick={() => setIsZoomed(prev => !prev)}
        >
          <img
            key={currentImage.url}
            src={currentImage.url}
            alt={cleanSection}
            className={`transition-all duration-200 select-none rounded-xl shadow-2xl border border-[#1b2236] bg-[#05070d] ${
              isZoomed
                ? 'max-w-none max-h-none w-auto object-none'
                : 'max-h-[66vh] max-w-[88vw] object-contain'
            }`}
            draggable={false}
          />
        </div>

        {/* Botão Lateral Próxima (›) */}
        {total > 1 && (
          <button
            type="button"
            onClick={e => {
              e.stopPropagation();
              handleNext();
            }}
            className="absolute right-3 sm:right-6 top-1/2 -translate-y-1/2 z-30 p-3 sm:p-3.5 rounded-2xl bg-black/60 hover:bg-indigo-600/90 text-white/80 hover:text-white border border-white/10 hover:border-indigo-400/50 backdrop-blur-md transition-all shadow-2xl hover:scale-105 active:scale-95 group"
            title="Próxima Secção (Seta Direita →)"
            aria-label="Próxima Secção"
          >
            <ChevronRight className="w-6 h-6 group-hover:translate-x-0.5 transition-transform" />
          </button>
        )}
      </div>

      {/* 3. Barra Inferior de Miniaturas (Filmstrip com Destaque Vibrante) */}
      <div
        className="px-6 py-3 bg-[#0a0d17]/95 border-t border-[#1b2234] flex flex-col gap-1.5 z-20 shadow-inner"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between text-[11px] text-slate-400 px-1">
          <span className="font-semibold flex items-center gap-1.5 text-slate-300">
            <span>Navegação pelas Secções da Aplicação</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-300 font-mono">
              Use as setas ← e →
            </span>
          </span>
          <span className="text-slate-500 text-[10px] font-mono">
            {currentImage.sizeBytes ? `${(currentImage.sizeBytes / 1024).toFixed(0)} KB` : ''}
          </span>
        </div>

        {/* Fita Horizontal com Miniaturas */}
        <div className="flex items-center gap-2.5 overflow-x-auto py-1 scrollbar-thin">
          {images.map((img, idx) => {
            const isActive = idx === currentIndex;
            const imgFilename = img.filename || (img.url ? img.url.split('/').pop()?.split('?')[0] : '') || `0${idx + 1}.png`;
            const labelText = img.sectionName || img.title || imgFilename;

            return (
              <button
                key={img.url || idx}
                type="button"
                onClick={() => {
                  setCurrentIndex(idx);
                  setIsZoomed(false);
                }}
                className={`relative flex-shrink-0 cursor-pointer rounded-lg overflow-hidden border transition-all text-left focus:outline-none ${
                  isActive
                    ? 'ring-2 ring-indigo-500 border-indigo-400 scale-105 shadow-lg shadow-indigo-500/25 z-10'
                    : 'border-[#1e2538] opacity-60 hover:opacity-100 hover:border-slate-500'
                }`}
                title={`Ir para ${labelText}`}
              >
                <div className="w-20 sm:w-24 h-12 sm:h-14 bg-[#05070d] overflow-hidden flex items-center justify-center">
                  <img
                    src={img.url}
                    alt={labelText}
                    className="w-full h-full object-cover object-top"
                    loading="lazy"
                  />
                </div>
                <div className={`px-1 py-0.5 text-[9px] font-mono text-center truncate max-w-[80px] sm:max-w-[96px] ${
                  isActive ? 'bg-indigo-950/90 text-indigo-200 font-bold' : 'bg-black/80 text-slate-300'
                }`}>
                  {labelText}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
