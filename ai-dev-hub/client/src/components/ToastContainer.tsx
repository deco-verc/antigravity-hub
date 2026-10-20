import React from 'react';
import { ToastMessage } from '../types';
import { CheckCircle2, AlertCircle, Info, AlertTriangle, X } from 'lucide-react';

interface ToastContainerProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      {toasts.map(t => {
        const isSuccess = t.type === 'success';
        const isError = t.type === 'error';
        const isWarn = t.type === 'warn';

        return (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-2.5 p-3 rounded-xl border shadow-xl backdrop-blur-md transition-all duration-200 animate-in fade-in slide-in-from-bottom-3 ${
              isSuccess
                ? 'bg-[#0f172a]/95 border-emerald-500/30 text-emerald-200'
                : isError
                ? 'bg-[#180d12]/95 border-rose-500/30 text-rose-200'
                : isWarn
                ? 'bg-[#1a140b]/95 border-amber-500/30 text-amber-200'
                : 'bg-[#0f1423]/95 border-indigo-500/30 text-indigo-200'
            }`}
          >
            {isSuccess && <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />}
            {isError && <AlertCircle className="w-4 h-4 text-rose-400 mt-0.5 flex-shrink-0" />}
            {isWarn && <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />}
            {!isSuccess && !isError && !isWarn && <Info className="w-4 h-4 text-indigo-400 mt-0.5 flex-shrink-0" />}

            <span className="text-xs flex-1 leading-relaxed font-medium">{t.message}</span>

            <button
              onClick={() => onDismiss(t.id)}
              className="text-slate-400 hover:text-white p-0.5 rounded transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
