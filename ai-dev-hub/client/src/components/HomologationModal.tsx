import React, { useState, useEffect } from 'react';
import {
  X,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  Image as ImageIcon,
  RotateCw,
  ExternalLink,
  Lock,
  Layers,
  Sparkles,
  Terminal,
  Activity,
  Maximize2
} from 'lucide-react';
import { api } from '../services/api';
import { HomologationEvidenceData, HomologationBadge, HomologationScreenshotItem } from '../types';
import { ImageCarouselLightbox } from './ImageCarouselLightbox';

interface HomologationModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  projectName: string;
  onShowToast?: (type: 'success' | 'warn' | 'error', msg: string) => void;
}

export const HomologationModal: React.FC<HomologationModalProps> = ({
  isOpen,
  onClose,
  projectId,
  projectName,
  onShowToast
}) => {
  const [data, setData] = useState<HomologationEvidenceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'badges' | 'reports' | 'screenshots'>('badges');
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  useEffect(() => {
    if (isOpen && projectId) {
      loadEvidence();
    }
  }, [isOpen, projectId]);

  const loadEvidence = async () => {
    setLoading(true);
    try {
      const res = await api.getHomologationEvidence(projectId);
      setData(res);
    } catch (err: any) {
      onShowToast?.('error', `Falha ao carregar evidências: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const passedBadges = (data?.badges || []).filter(b => b.status === 'PASSED').length;
  const totalBadges = data?.badges?.length || 4;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-4xl max-h-[90vh] bg-[#0c101a] border border-[#1e2538] rounded-2xl shadow-2xl flex flex-col overflow-hidden text-slate-200">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#1e2538] flex items-center justify-between bg-[#0e1320]">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
              data?.overallPassed
                ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-400'
                : 'bg-indigo-500/15 border border-indigo-500/30 text-indigo-400'
            }`}>
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white tracking-tight">Homologação & Selos de Qualidade</h2>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300 font-mono border border-indigo-500/30">
                  {projectName}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Auditoria 360° com validação técnica, visual, de experiência e de segurança
              </p>
            </div>
          </div>
          
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[#1a2033] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Status Score Banner */}
        <div className="px-6 py-3.5 bg-[#0a0d17] border-b border-[#1b2234] flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">Score Global:</span>
              <span className="text-lg font-bold font-mono text-emerald-400">
                {data?.overallScore ?? 100}%
              </span>
            </div>
            <div className="h-4 w-px bg-[#1f2639]"></div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">Selos Conquistados:</span>
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-mono font-semibold">
                {passedBadges} de {totalBadges} Aprovados
              </span>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex items-center gap-1 bg-[#121624] p-1 rounded-xl border border-[#212940] text-xs">
            <button
              type="button"
              onClick={() => setActiveTab('badges')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-colors flex items-center gap-1.5 ${
                activeTab === 'badges'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>4 Selos</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('screenshots')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-colors flex items-center gap-1.5 ${
                activeTab === 'screenshots'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <ImageIcon className="w-3.5 h-3.5" />
              <span>Screenshots ({data?.screenshots?.length || 0})</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('reports')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-colors flex items-center gap-1.5 ${
                activeTab === 'reports'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>Relatórios Brutos</span>
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 text-slate-500 gap-2">
              <RotateCw className="w-6 h-6 animate-spin text-indigo-400" />
              <p className="text-xs">Carregando auditoria de homologação...</p>
            </div>
          ) : activeTab === 'badges' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {(data?.badges || []).map(badge => {
                const isPassed = badge.status === 'PASSED';
                const isFailed = badge.status === 'FAILED';

                return (
                  <div
                    key={badge.id}
                    className={`p-4 rounded-xl border transition-all ${
                      isPassed
                        ? 'bg-[#0f1523] border-emerald-500/25 hover:border-emerald-500/40'
                        : isFailed
                        ? 'bg-[#181119] border-rose-500/30 hover:border-rose-500/50'
                        : 'bg-[#121624] border-[#222a40]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3 mb-2.5">
                      <div className="flex items-center gap-2.5">
                        <span className="text-xl">{badge.icon}</span>
                        <div>
                          <h3 className="text-sm font-bold text-white tracking-tight">
                            {badge.title}
                          </h3>
                          <p className="text-[11px] text-slate-400">
                            {badge.subtitle}
                          </p>
                        </div>
                      </div>

                      {isPassed ? (
                        <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[10px] font-semibold flex items-center gap-1 shrink-0">
                          <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                          <span>APROVADO</span>
                        </span>
                      ) : isFailed ? (
                        <span className="px-2 py-0.5 rounded-full bg-rose-500/15 border border-rose-500/30 text-rose-300 text-[10px] font-semibold flex items-center gap-1 shrink-0">
                          <ShieldAlert className="w-3 h-3 text-rose-400" />
                          <span>REPROVADO</span>
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[10px] font-semibold flex items-center gap-1 shrink-0">
                          <AlertTriangle className="w-3 h-3 text-amber-400" />
                          <span>PENDENTE</span>
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-slate-300 leading-relaxed bg-[#0a0d17]/80 p-3 rounded-lg border border-[#1b2234]">
                      {badge.details}
                    </p>

                    {badge.score !== undefined && (
                      <div className="mt-3 flex items-center justify-between text-xs">
                        <span className="text-slate-400">Conformidade do Selo:</span>
                        <span className="font-mono font-bold text-emerald-400">{badge.score}%</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : activeTab === 'screenshots' ? (
            <div>
              {(!data?.screenshots || data.screenshots.length === 0) ? (
                <div className="flex flex-col items-center justify-center py-20 text-slate-500 text-center">
                  <ImageIcon className="w-10 h-10 mb-2 opacity-40" />
                  <p className="text-sm font-medium text-slate-400">Nenhum snapshot visual disponível</p>
                  <p className="text-xs text-slate-500 mt-1 max-w-sm">
                    As capturas automáticas do Playwright (`.ai-dev-hub/evidence/*.png`) aparecerão aqui assim que as suítes de UI e jornada forem executadas.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {data.screenshots.map((s, idx) => (
                    <div
                      key={s.filename}
                      onClick={() => setLightboxIndex(idx)}
                      className="group cursor-pointer rounded-xl overflow-hidden border border-[#1f273d] bg-[#101422] hover:border-indigo-500/50 transition-all shadow-md flex flex-col"
                    >
                      <div className="relative aspect-video bg-[#080b12] flex items-center justify-center overflow-hidden">
                        <img
                          src={api.getEvidenceFileUrl(projectId, s.filename, s.updatedAt ? new Date(s.updatedAt).getTime() : undefined)}
                          alt={s.label}
                          className="w-full h-full object-cover object-top group-hover:scale-105 transition-transform duration-300"
                          loading="lazy"
                        />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white">
                          <Maximize2 className="w-5 h-5 drop-shadow" />
                        </div>
                      </div>
                      <div className="p-3 text-xs">
                        <p className="font-semibold text-white truncate" title={s.label}>
                          {s.label}
                        </p>
                        <div className="flex items-center justify-between mt-1 text-[11px] text-slate-400 font-mono">
                          <span>{(s.sizeBytes / 1024).toFixed(0)} KB</span>
                          <span className="text-[10px] text-slate-500">{new Date(s.updatedAt).toLocaleTimeString()}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-[#0e121e] border border-[#1d253a]">
                <div className="flex items-center gap-2 mb-2">
                  <Terminal className="w-4 h-4 text-indigo-400" />
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                    Simulador de Jornada do Usuário (UX)
                  </h4>
                </div>
                <pre className="p-3 bg-[#070911] border border-[#161c2c] rounded-lg text-xs font-mono text-slate-300 overflow-x-auto max-h-60">
                  {data?.reports?.userJourney ? JSON.stringify(data.reports.userJourney, null, 2) : '// Nenhum relatório de jornada gerado ainda'}
                </pre>
              </div>

              <div className="p-4 rounded-xl bg-[#0e121e] border border-[#1d253a]">
                <div className="flex items-center gap-2 mb-2">
                  <Lock className="w-4 h-4 text-rose-400" />
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                    Simulador de Pentest & Segurança (AppSec Red Team)
                  </h4>
                </div>
                <pre className="p-3 bg-[#070911] border border-[#161c2c] rounded-lg text-xs font-mono text-slate-300 overflow-x-auto max-h-60">
                  {data?.reports?.securityPentest ? JSON.stringify(data.reports.securityPentest, null, 2) : '// Nenhum relatório de pentest gerado ainda'}
                </pre>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-[#0a0d17] border-t border-[#1e2538] flex items-center justify-between text-xs">
          <div className="text-slate-400 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
            <span>Evidências salvas em <code className="font-mono text-slate-300">.ai-dev-hub/evidence/</code></span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-[#1a2135] hover:bg-[#222b44] text-white text-xs font-semibold transition-colors"
          >
            Fechar
          </button>
        </div>

      </div>

      {/* Lightbox Carrossel com Navegação Lateral e Filmstrip */}
      <ImageCarouselLightbox
        isOpen={lightboxIndex !== null}
        onClose={() => setLightboxIndex(null)}
        images={(data?.screenshots || []).map(s => ({
          ...s,
          url: api.getEvidenceFileUrl(projectId, s.filename, s.updatedAt ? new Date(s.updatedAt).getTime() : undefined)
        }))}
        initialIndex={lightboxIndex ?? 0}
      />
    </div>
  );
};
