import React, { useState, useEffect, useRef } from 'react';
import { AccountProfile } from '../types';
import { api } from '../services/api';
import {
  X,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Loader2,
  RefreshCw,
  ExternalLink,
  Shield,
  ArrowRight,
  Check
} from 'lucide-react';

interface AddAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAccountAdded: (account: AccountProfile) => void;
  onShowToast: (type: 'info' | 'success' | 'warn' | 'error', msg: string) => void;
}

export const AddAccountModal: React.FC<AddAccountModalProps> = ({
  isOpen,
  onClose,
  onAccountAdded,
  onShowToast,
}) => {
  const [displayName, setDisplayName] = useState('');
  const [createdProfile, setCreatedProfile] = useState<AccountProfile | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isReopening, setIsReopening] = useState(false);
  const [detectedEmail, setDetectedEmail] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [autoCloseTimer, setAutoCloseTimer] = useState<number | null>(null);

  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Clear polling on unmount or close
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  // Polling for Antigravity login completion when in Step 2
  useEffect(() => {
    if (isOpen && createdProfile && !isReady) {
      pollIntervalRef.current = setInterval(async () => {
        try {
          const result = await api.verifyAccountProfile(createdProfile.id);
          if (result.hasSession || result.profile.auth_status === 'READY') {
            setIsReady(true);
            setDetectedEmail(result.account || result.profile.google_account_label || null);
            if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
            onShowToast('success', `Conta "${result.profile.display_name}" autenticada com sucesso!`);
            onAccountAdded(result.profile);
            
            // Auto close after 2 seconds
            const t = window.setTimeout(() => {
              handleClose();
            }, 2000);
            setAutoCloseTimer(t);
          }
        } catch {
          // Silent polling errors
        }
      }, 2500);

      return () => {
        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      };
    }
  }, [isOpen, createdProfile, isReady]);

  if (!isOpen) return null;

  const handleCreateAndLaunch = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = displayName.trim();
    if (!name || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const profile = await api.createAccountProfile({
        displayName: name,
        autoLaunch: true
      });
      setCreatedProfile(profile);
      onShowToast('info', `Janela do Antigravity aberta em perfil isolado para "${profile.display_name}". Faça o login no aplicativo.`);
    } catch (err: any) {
      onShowToast('error', `Erro ao criar perfil de conta: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleManualVerify = async () => {
    if (!createdProfile || isVerifying) return;
    setIsVerifying(true);
    try {
      const result = await api.verifyAccountProfile(createdProfile.id);
      if (result.hasSession || result.profile.auth_status === 'READY') {
        setIsReady(true);
        setDetectedEmail(result.account || result.profile.google_account_label || null);
        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
        onShowToast('success', `Conta autenticada: ${result.account || result.profile.display_name}`);
        onAccountAdded(result.profile);
        setTimeout(() => handleClose(), 1500);
      } else {
        onShowToast('warn', result.reason || 'Login ainda não detectado. Conclua o login na janela do Antigravity e tente novamente.');
      }
    } catch (err: any) {
      onShowToast('error', `Erro ao verificar: ${err.message}`);
    } finally {
      setIsVerifying(false);
    }
  };

  const handleReopenAntigravity = async () => {
    if (!createdProfile || isReopening) return;
    setIsReopening(true);
    try {
      const res = await api.launchAccountProfileLogin(createdProfile.id);
      onShowToast('info', res.message || 'Janela do Antigravity reaberta.');
    } catch (err: any) {
      onShowToast('error', `Falha ao reabrir Antigravity: ${err.message}`);
    } finally {
      setIsReopening(false);
    }
  };

  const handleClose = () => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    if (autoCloseTimer) clearTimeout(autoCloseTimer);
    setDisplayName('');
    setCreatedProfile(null);
    setIsReady(false);
    setDetectedEmail(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg bg-[#0e111a] border border-[#23293d] rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 bg-[#141824] border-b border-[#23293d] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-indigo-400" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white tracking-tight">Adicionar Conta Google</h3>
              <p className="text-[11px] text-[#7e87aa]">Isolamento nativo de perfil no Antigravity</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-1 rounded-lg text-[#7e87aa] hover:text-white hover:bg-[#1f2438] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {!createdProfile ? (
            /* STEP 1: Name & Initiate */
            <form onSubmit={handleCreateAndLaunch} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Nome da Conta Google: <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                  placeholder="Ex: Google Pro 2, Trabalho, Pessoal..."
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#08090e] border border-[#23293d] text-sm text-white placeholder-[#525a7f] focus:outline-none focus:border-indigo-500 transition-colors"
                  autoFocus
                  required
                />
              </div>

              <div className="p-3.5 rounded-xl bg-[#141824] border border-[#23293d] space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-indigo-300">
                  <Shield className="w-4 h-4 text-indigo-400" />
                  <span>Isolamento Total de Sessão</span>
                </div>
                <p className="text-xs text-[#8e98b7] leading-relaxed">
                  Ao clicar em <strong>Continuar</strong>, o Antigravity será aberto com um perfil separado. Na janela dele, clique em <strong>Entrar com Google</strong> para iniciar o login no navegador.
                </p>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={handleClose}
                  className="px-4 py-2 rounded-xl bg-[#181b28] hover:bg-[#202538] text-xs font-semibold text-slate-300 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !displayName.trim()}
                  className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-xs font-semibold text-white shadow-lg shadow-indigo-600/30 flex items-center gap-2 transition-all"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Iniciando Antigravity...</span>
                    </>
                  ) : (
                    <>
                      <span>Continuar</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            </form>
          ) : (
            /* STEP 2: Waiting for Antigravity Login & Polling */
            <div className="space-y-4">
              {isReady ? (
                /* SUCCESS STATE */
                <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 space-y-3 animate-in zoom-in-95 duration-200">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center flex-shrink-0">
                      <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                    </div>
                    <div>
                      <div className="text-sm font-bold text-white">Conta Autenticada com Sucesso!</div>
                      <div className="text-xs text-emerald-300 mt-0.5 font-mono">
                        {detectedEmail || createdProfile.display_name}
                      </div>
                    </div>
                  </div>
                  <p className="text-xs text-[#8e98b7]">
                    O perfil já está pronto e disponível no seletor de contas do DecoHUB.
                  </p>
                  <div className="pt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={handleClose}
                      className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white shadow-md shadow-emerald-600/30 flex items-center gap-2 transition-all"
                    >
                      <Check className="w-4 h-4" />
                      <span>Concluir</span>
                    </button>
                  </div>
                </div>
              ) : (
                /* WAITING LOGIN STATE */
                <div className="space-y-4">
                  <div className="p-4 rounded-xl bg-[#141824] border border-[#23293d] space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse" />
                        <span className="text-xs font-bold text-white tracking-wide uppercase">
                          Aguardando Login no Antigravity...
                        </span>
                      </div>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/30 text-amber-300">
                        WAITING_LOGIN
                      </span>
                    </div>

                    <div className="text-xs text-[#8e98b7] leading-relaxed">
                      Uma janela do Antigravity foi iniciada para o perfil <strong>"{createdProfile.display_name}"</strong>.
                      <br />
                      Faça login com a sua conta Google diretamente na janela do aplicativo. O DecoHUB detectará a autenticação em tempo real.
                    </div>

                    <div className="pt-1 flex items-center gap-2 text-[11px] text-indigo-300/80">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Sincronizando status a cada 2.5 segundos...</span>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row items-center gap-2 pt-2">
                    <button
                      type="button"
                      onClick={handleManualVerify}
                      disabled={isVerifying}
                      className="w-full sm:flex-1 py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-xs font-semibold text-white flex items-center justify-center gap-2 shadow-md shadow-indigo-600/30 transition-all"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isVerifying ? 'animate-spin' : ''}`} />
                      <span>Verificar Agora</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleReopenAntigravity}
                      disabled={isReopening}
                      className="w-full sm:flex-1 py-2.5 px-4 rounded-xl bg-[#1a1f33] hover:bg-[#222842] border border-[#2c3350] text-xs font-medium text-slate-200 hover:text-white flex items-center justify-center gap-2 transition-colors"
                    >
                      <ExternalLink className="w-3.5 h-3.5 text-indigo-400" />
                      <span>Reabrir Antigravity</span>
                    </button>
                  </div>

                  <div className="pt-2 text-center">
                    <button
                      type="button"
                      onClick={handleClose}
                      className="text-xs text-slate-400 hover:text-slate-200 transition-colors"
                    >
                      Fechar e concluir login mais tarde
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
