import React from 'react';
import { X, ShieldCheck, CheckCircle2, AlertTriangle, Terminal, FileCode, Check, AlertOctagon, Clock, ShieldAlert } from 'lucide-react';

export interface SuccessContractData {
  id: string;
  taskId: string;
  objective: string;
  acceptanceCriteria: string[];
  protectedEvaluationFiles: string[];
  baseline?: {
    ran: boolean;
    passed: boolean;
    command?: string;
    exitCode?: number;
    output?: string;
  };
  status: string;
}

export interface EvaluationResultData {
  id: string;
  verdict: 'PASS' | 'FAIL' | 'TAMPERING_DETECTED';
  builderStatus: 'COMPLETED' | 'FAILED';
  evaluatorVerdict: 'PASS' | 'FAIL' | 'TAMPERING_DETECTED';
  taskIsDone: boolean;
  passedCriteria: string[];
  failedCriteria: string[];
  evidence: {
    command?: string;
    exitCode?: number;
    output?: string;
    durationMs?: number;
    tamperingDetected?: boolean;
    tamperedFiles?: string[];
  };
  expected: string;
  actual: string;
  evaluatorNotes: string;
  evaluatorName: string;
  createdAt: string;
}

interface EvaluationDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  contract: SuccessContractData | null;
  evaluation: EvaluationResultData | null;
}

export const EvaluationDetailsModal: React.FC<EvaluationDetailsModalProps> = ({
  isOpen,
  onClose,
  contract,
  evaluation
}) => {
  if (!isOpen) return null;

  const isTampered = evaluation?.verdict === 'TAMPERING_DETECTED';
  const isPass = evaluation?.verdict === 'PASS';
  const isFail = evaluation?.verdict === 'FAIL';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[#0f131f] border border-[#232b45] w-full max-w-3xl max-h-[85vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden text-slate-200">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#1e253e] flex items-center justify-between bg-[#141929]/60">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
              isTampered
                ? 'bg-rose-500/10 border border-rose-500/30 text-rose-400'
                : isPass
                  ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
                  : 'bg-amber-500/10 border border-amber-500/30 text-amber-400'
            }`}>
              {isTampered ? <ShieldAlert className="w-5 h-5" /> : isPass ? <ShieldCheck className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-white">Success Contract & Evaluator</h2>
                <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase tracking-wider ${
                  isTampered
                    ? 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                    : isPass
                      ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                      : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                }`}>
                  {evaluation?.verdict || contract?.status || 'PENDENTE'}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Avaliação independente e proteção contra adulteração de testes (Karpathy Layer)
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
        <div className="flex-1 overflow-y-auto p-6 space-y-5 bg-[#0b0e18] text-xs leading-relaxed">
          {/* Status Banner */}
          <div className={`p-4 rounded-xl border flex items-start gap-3 ${
            isTampered
              ? 'bg-rose-950/20 border-rose-500/30 text-rose-300'
              : isPass
                ? 'bg-emerald-950/20 border-emerald-500/30 text-emerald-300'
                : 'bg-amber-950/20 border-amber-500/30 text-amber-300'
          }`}>
            {isTampered ? (
              <AlertOctagon className="w-5 h-5 text-rose-400 flex-shrink-0 mt-0.5" />
            ) : isPass ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
            )}
            <div>
              <div className="font-semibold text-white text-sm">
                {isTampered
                  ? 'Violação de Avaliação Independente (Adulteração de Testes)'
                  : isPass
                    ? 'Implementado & Verificado com Sucesso'
                    : 'Implementado, mas Verificação Independente Falhou'}
              </div>
              <p className="mt-0.5 text-xs opacity-90">
                {evaluation?.actual || 'Avaliação em andamento ou pendente de execução.'}
              </p>
            </div>
          </div>

          {/* 1. Success Contract Details */}
          {contract && (
            <div className="p-4 rounded-xl bg-[#111627] border border-[#202842] space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-white uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                  <FileCode className="w-3.5 h-3.5 text-indigo-400" />
                  Success Contract
                </span>
                <span className="text-slate-400 font-mono text-[10px]">ID: {contract.id.slice(0, 8)}</span>
              </div>
              <div>
                <span className="text-slate-400">Objetivo:</span>
                <p className="text-slate-200 font-medium mt-0.5">{contract.objective}</p>
              </div>

              {/* Acceptance Criteria */}
              {contract.acceptanceCriteria && contract.acceptanceCriteria.length > 0 && (
                <div>
                  <span className="text-slate-400">Critérios de Aceite:</span>
                  <ul className="mt-1 space-y-1">
                    {contract.acceptanceCriteria.map((c, i) => (
                      <li key={i} className="flex items-center gap-1.5 text-slate-300">
                        <Check className="w-3 h-3 text-emerald-400 flex-shrink-0" />
                        <span>{c}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Protected Evaluation Files */}
              {contract.protectedEvaluationFiles && contract.protectedEvaluationFiles.length > 0 && (
                <div className="pt-2 border-t border-[#1b2238]">
                  <span className="text-slate-400 flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5 text-indigo-400" />
                    Arquivos de Teste Protegidos (PROTECTED_EVALUATION):
                  </span>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {contract.protectedEvaluationFiles.map((file, i) => (
                      <span
                        key={i}
                        className="px-2 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 font-mono text-[11px]"
                      >
                        🔒 {file}
                      </span>
                    ))}
                  </div>
                  <p className="text-[10px] text-slate-500 mt-1">
                    O Builder não tem permissão para alterar ou enfraquecer estes testes.
                  </p>
                </div>
              )}

              {/* Baseline Result */}
              {contract.baseline?.ran && (
                <div className="pt-2 border-t border-[#1b2238] flex items-center justify-between text-[11px]">
                  <span className="text-slate-400">Baseline inicial (Reprodução):</span>
                  <span className={contract.baseline.passed ? 'text-amber-400 font-semibold' : 'text-emerald-400 font-semibold'}>
                    {contract.baseline.passed ? 'PASSOU (Inesperado para bug)' : 'FAIL comprovado (Código ' + contract.baseline.exitCode + ')'}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* 2. Evaluation Results */}
          {evaluation && (
            <div className="p-4 rounded-xl bg-[#111627] border border-[#202842] space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-white uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                  <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                  Evidência Objetiva do Evaluator
                </span>
                <span className="text-slate-400 font-mono text-[10px]">{evaluation.evaluatorName}</span>
              </div>

              <div className="grid grid-cols-2 gap-3 text-[11px]">
                <div className="p-2.5 rounded-lg bg-[#0e121f] border border-[#1a2136]">
                  <span className="text-slate-500">Builder Status:</span>
                  <div className="font-semibold text-slate-200 mt-0.5">{evaluation.builderStatus}</div>
                </div>
                <div className="p-2.5 rounded-lg bg-[#0e121f] border border-[#1a2136]">
                  <span className="text-slate-500">Evaluator Verdict:</span>
                  <div className={`font-semibold mt-0.5 ${
                    isPass ? 'text-emerald-400' : isTampered ? 'text-rose-400' : 'text-amber-400'
                  }`}>
                    {evaluation.evaluatorVerdict} (Done: {evaluation.taskIsDone ? 'SIM' : 'NÃO'})
                  </div>
                </div>
              </div>

              {/* Terminal command & exit code */}
              {evaluation.evidence.command && (
                <div>
                  <div className="flex items-center justify-between text-[11px] mb-1">
                    <span className="text-slate-400 font-mono">Comando: {evaluation.evidence.command}</span>
                    <span className="text-slate-400 font-mono">Código: {evaluation.evidence.exitCode}</span>
                  </div>
                  <pre className="p-3 rounded-lg bg-[#090b14] border border-[#1a2033] font-mono text-[11px] text-slate-300 whitespace-pre-wrap max-h-40 overflow-y-auto select-text leading-relaxed">
                    {evaluation.evidence.output || 'Nenhuma saída capturada'}
                  </pre>
                </div>
              )}

              {/* Tampering details */}
              {evaluation.evidence.tamperingDetected && (
                <div className="p-3 rounded-lg bg-rose-950/30 border border-rose-500/40 text-rose-300">
                  <span className="font-bold">Arquivos Adulterados pelo Agente:</span>
                  <ul className="mt-1 list-disc list-inside font-mono text-[11px]">
                    {evaluation.evidence.tamperedFiles?.map((f, idx) => (
                      <li key={idx}>{f}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-[#141929] border-t border-[#1e253e] flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <Clock className="w-3.5 h-3.5 text-slate-500" />
            <span>Princípio Karpathy: O agente que altera o código não decide se venceu.</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
