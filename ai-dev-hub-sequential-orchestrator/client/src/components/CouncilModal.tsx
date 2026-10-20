import React, { useState } from 'react';
import {
  X,
  Users,
  ShieldCheck,
  AlertTriangle,
  Award,
  CheckCircle2,
  AlertOctagon,
  HelpCircle,
  FileCode,
  Layers,
  ChevronRight,
  TrendingUp,
  Cpu,
  Feather,
  ShieldAlert,
  Sliders,
  Scale
} from 'lucide-react';
import { CouncilDeliberation, CouncilReviewerOutput } from '../types';

interface CouncilModalProps {
  isOpen: boolean;
  onClose: () => void;
  deliberation: CouncilDeliberation | null;
}

export const CouncilModal: React.FC<CouncilModalProps> = ({
  isOpen,
  onClose,
  deliberation
}) => {
  const [selectedReviewerIndex, setSelectedReviewerIndex] = useState(0);

  if (!isOpen || !deliberation) return null;

  const isApproved = deliberation.chairmanVerdict === 'APPROVED';
  const isChangesRequested = deliberation.chairmanVerdict === 'CHANGES_REQUESTED';
  const isBlocked = deliberation.chairmanVerdict === 'BLOCKED';

  const selectedReview: CouncilReviewerOutput | undefined =
    deliberation.reviews && deliberation.reviews[selectedReviewerIndex];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[#0e121e] border border-[#232b45] w-full max-w-4xl max-h-[90vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden text-slate-200">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#1d243c] flex items-center justify-between bg-[#131828]/80">
          <div className="flex items-center gap-3">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                isApproved
                  ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
                  : isChangesRequested
                  ? 'bg-amber-500/10 border border-amber-500/30 text-amber-400'
                  : 'bg-rose-500/10 border border-rose-500/30 text-rose-400'
              }`}
            >
              <Scale className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white">AI DEV Council Deliberation</h2>
                <span
                  className={`px-2 py-0.5 rounded text-[11px] font-mono font-bold uppercase tracking-wider ${
                    isApproved
                      ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                      : isChangesRequested
                      ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                      : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                  }`}
                >
                  {deliberation.chairmanVerdict}
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-[#1e253e] text-slate-300 border border-[#2b3558]">
                  {deliberation.consensusLevel}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Revisão por Pares Anônima & Síntese pelo Presidente • Trigger: {deliberation.policyTrigger} (Risco: {deliberation.riskLevel.toUpperCase()})
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[#1f2742] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Top Score Cards Banner */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {/* Correctness */}
            <div className="p-3.5 rounded-xl bg-[#121626] border border-[#202740] flex flex-col justify-between">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                <span>Corretude</span>
                <ShieldCheck className="w-4 h-4 text-cyan-400" />
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-black text-white font-mono">
                  {deliberation.scores?.correctness?.toFixed(1) || '0.0'}
                </span>
                <span className="text-xs text-slate-500 font-mono">/ 10</span>
              </div>
              <span className="text-[10px] text-slate-500 mt-1">Reviewer A (Requisitos & Testes)</span>
            </div>

            {/* Simplicity */}
            <div className="p-3.5 rounded-xl bg-[#121626] border border-[#202740] flex flex-col justify-between">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                <span>Simplicidade</span>
                <Feather className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="flex items-baseline gap-1">
                <span
                  className={`text-2xl font-black font-mono ${
                    (deliberation.scores?.simplicity || 0) < 6 ? 'text-amber-400' : 'text-emerald-400'
                  }`}
                >
                  {deliberation.scores?.simplicity?.toFixed(1) || '0.0'}
                </span>
                <span className="text-xs text-slate-500 font-mono">/ 10</span>
              </div>
              <span className="text-[10px] text-slate-500 mt-1">Reviewer B (Karpathy Anti-Bloat)</span>
            </div>

            {/* Regression */}
            <div className="p-3.5 rounded-xl bg-[#121626] border border-[#202740] flex flex-col justify-between">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                <span>Regressão / Risco</span>
                <ShieldAlert className="w-4 h-4 text-purple-400" />
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-black text-white font-mono">
                  {deliberation.scores?.regression?.toFixed(1) || '0.0'}
                </span>
                <span className="text-xs text-slate-500 font-mono">/ 10</span>
              </div>
              <span className="text-[10px] text-slate-500 mt-1">Reviewer C (Efeitos Colaterais)</span>
            </div>

            {/* Final Council Score */}
            <div
              className={`p-3.5 rounded-xl border flex flex-col justify-between ${
                isApproved
                  ? 'bg-emerald-950/20 border-emerald-500/30'
                  : isChangesRequested
                  ? 'bg-amber-950/20 border-amber-500/30'
                  : 'bg-rose-950/20 border-rose-500/30'
              }`}
            >
              <div className="flex items-center justify-between text-xs text-slate-300 mb-1">
                <span className="font-bold">Nota do Conselho</span>
                <Award className="w-4 h-4 text-amber-400" />
              </div>
              <div className="flex items-baseline gap-1">
                <span
                  className={`text-2xl font-black font-mono ${
                    isApproved ? 'text-emerald-300' : isChangesRequested ? 'text-amber-300' : 'text-rose-300'
                  }`}
                >
                  {deliberation.scores?.final?.toFixed(1) || '0.0'}
                </span>
                <span className="text-xs text-slate-500 font-mono">/ 10</span>
              </div>
              <span className="text-[10px] text-slate-400 mt-1 font-mono uppercase">
                Consenso: {deliberation.consensusLevel}
              </span>
            </div>
          </div>

          {/* STAGE 3: Chairman Synthesis */}
          <div
            className={`p-5 rounded-2xl border ${
              isApproved
                ? 'bg-emerald-950/15 border-emerald-500/30'
                : isChangesRequested
                ? 'bg-amber-950/15 border-amber-500/30'
                : 'bg-rose-950/15 border-rose-500/30'
            }`}
          >
            <div className="flex items-center gap-2 mb-3">
              <Scale
                className={`w-5 h-5 ${
                  isApproved ? 'text-emerald-400' : isChangesRequested ? 'text-amber-400' : 'text-rose-400'
                }`}
              />
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                Stage 3: Síntese e Decisão do Presidente (Chairman)
              </h3>
            </div>

            <p className="text-xs text-slate-200 leading-relaxed font-sans whitespace-pre-wrap">
              {deliberation.chairmanSynthesis}
            </p>

            {deliberation.actionItems && deliberation.actionItems.length > 0 && (
              <div className="mt-4 pt-3 border-t border-slate-700/40">
                <h4 className="text-[11px] font-bold text-amber-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>Ações Exigidas para Aprovação:</span>
                </h4>
                <ul className="space-y-1.5">
                  {deliberation.actionItems.map((item, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-xs text-slate-300">
                      <span className="text-amber-400 font-mono font-bold mt-0.5">•</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* STAGE 2: Anonymous Peer Rankings */}
          <div className="p-4 rounded-xl bg-[#121626] border border-[#202740] space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-indigo-400" />
                <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                  Stage 2: Classificação Anônima por Pares (Peer Ranking)
                </h3>
              </div>
              <span className="text-[10px] text-slate-500 font-mono">
                Identidades cegadas ("Review A/B/C")
              </span>
            </div>

            <p className="text-[11px] text-slate-400">
              Cada revisor avaliou os pareceres dos demais de forma cega, sem saber qual modelo ou papel gerou cada argumento, eliminando viés de autoridade.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 pt-1">
              {deliberation.peerRankings && deliberation.peerRankings.map((pr, idx) => (
                <div key={idx} className="p-3 rounded-lg bg-[#0e111d] border border-[#1b2238] space-y-1.5">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
                    <span className="text-indigo-300">{pr.reviewerLabel}</span>
                    <span className="text-[10px] font-mono text-slate-500">Ordem de Mérito</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs font-mono font-bold text-emerald-400 bg-[#14192a] px-2 py-1 rounded">
                    {pr.rankedReviews && pr.rankedReviews.join(' > ')}
                  </div>
                  <p className="text-[11px] text-slate-400 italic line-clamp-3">
                    "{pr.justification}"
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* STAGE 1: Specialized Independent Reviews */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-cyan-400" />
                <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                  Stage 1: Pareceres Independentes Especializados
                </h3>
              </div>
              <span className="text-[10px] text-slate-500 font-mono">
                3 Perspectivas Complementares
              </span>
            </div>

            {/* Tabs for Reviewers */}
            <div className="flex gap-2 border-b border-[#1f263d] pb-2">
              {deliberation.reviews && deliberation.reviews.map((rev, idx) => {
                const isSelected = selectedReviewerIndex === idx;
                return (
                  <button
                    key={idx}
                    onClick={() => setSelectedReviewerIndex(idx)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium transition-all ${
                      isSelected
                        ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20 font-semibold'
                        : 'bg-[#121626] text-slate-400 hover:text-white hover:bg-[#181d33] border border-[#202740]'
                    }`}
                  >
                    <span>{rev.anonymousLabel}: {rev.roleName}</span>
                    <span
                      className={`px-1.5 py-0.2 rounded text-[10px] font-mono font-bold ${
                        rev.verdict === 'APPROVED'
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : rev.verdict === 'CHANGES_REQUESTED'
                          ? 'bg-amber-500/20 text-amber-300'
                          : 'bg-rose-500/20 text-rose-300'
                      }`}
                    >
                      {rev.score}/10
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Selected Review Details Card */}
            {selectedReview && (
              <div className="p-4 rounded-xl bg-[#121626] border border-[#202740] space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-white">
                      {selectedReview.anonymousLabel} ({selectedReview.roleName})
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${
                        selectedReview.verdict === 'APPROVED'
                          ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                          : selectedReview.verdict === 'CHANGES_REQUESTED'
                          ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                          : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                      }`}
                    >
                      {selectedReview.verdict}
                    </span>
                  </div>

                  <div className="text-xs font-mono text-slate-300">
                    Nota Técnica: <span className="font-bold text-white">{selectedReview.score}/10</span>
                  </div>
                </div>

                {/* Blocking Issues if any */}
                {selectedReview.blockingIssues && selectedReview.blockingIssues.length > 0 && (
                  <div className="p-3 rounded-lg bg-rose-950/20 border border-rose-500/30 space-y-1.5">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-rose-300">
                      <AlertOctagon className="w-4 h-4 text-rose-400" />
                      <span>Problemas Bloqueantes Apontados:</span>
                    </div>
                    <ul className="space-y-1 text-xs text-rose-200">
                      {selectedReview.blockingIssues.map((issue, i) => (
                        <li key={i} className="flex items-start gap-1.5">
                          <span className="font-bold">•</span>
                          <span>{issue}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Findings */}
                {selectedReview.findings && selectedReview.findings.length > 0 && (
                  <div className="space-y-1.5">
                    <h4 className="text-xs font-semibold text-slate-300">Constatações da Avaliação:</h4>
                    <ul className="space-y-1 text-xs text-slate-400">
                      {selectedReview.findings.map((f, i) => (
                        <li key={i} className="flex items-start gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5 text-indigo-400 mt-0.5 flex-shrink-0" />
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Suggestions */}
                {selectedReview.suggestions && selectedReview.suggestions.length > 0 && (
                  <div className="space-y-1.5 pt-2 border-t border-[#1e253e]">
                    <h4 className="text-xs font-semibold text-slate-300">Sugestões de Refinamento:</h4>
                    <ul className="space-y-1 text-xs text-slate-400">
                      {selectedReview.suggestions.map((s, i) => (
                        <li key={i} className="flex items-start gap-1.5">
                          <span className="text-indigo-400 font-bold">•</span>
                          <span>{s}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-[#1d243c] bg-[#101424] flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-slate-400 font-mono">
            <span>Deliberação ID:</span>
            <span className="text-slate-300 font-semibold">{deliberation.id?.slice(0, 8)}...</span>
            <span className="text-slate-600">|</span>
            <span>{new Date(deliberation.createdAt).toLocaleString()}</span>
          </div>

          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-[#1b2238] hover:bg-[#232b47] text-white text-xs font-semibold transition-colors"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
