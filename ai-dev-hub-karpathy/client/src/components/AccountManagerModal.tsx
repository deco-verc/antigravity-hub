import React, { useState, useEffect, useRef } from 'react';
import { AccountProfile, AuthStatus } from '../types';
import { api } from '../services/api';
import {
  X,
  Sparkles,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Trash2,
  Edit3,
  Check,
  RefreshCw,
  Plus,
  User,
  Shield,
  Layers,
  Folder,
  ArrowRight,
  Clock
} from 'lucide-react';

interface AccountManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  accounts: AccountProfile[];
  activeAccount: AccountProfile | null;
  activeProjectId: string | null;
  onAccountsChanged: () => void;
  onAccountSwitched: (newAccount: AccountProfile) => void;
  onShowToast: (type: 'info' | 'success' | 'warn' | 'error', msg: string) => void;
}

export const AccountManagerModal: React.FC<AccountManagerModalProps> = ({
  isOpen,
  onClose,
  accounts,
  activeAccount,
  activeProjectId,
  onAccountsChanged,
  onAccountSwitched,
  onShowToast,
}) => {
  const [activeTab, setActiveTab] = useState<'list' | 'add'>('list');

  // Add flow state
  const [newDisplayName, setNewDisplayName] = useState('');
  const [createdProfile, setCreatedProfile] = useState<AccountProfile | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isVerifyingAdd, setIsVerifyingAdd] = useState(false);
  const [isReopeningAdd, setIsReopeningAdd] = useState(false);
  const [isAddReady, setIsAddReady] = useState(false);
  const [detectedEmailAdd, setDetectedEmailAdd] = useState<string | null>(null);

  const addPollRef = useRef<NodeJS.Timeout | null>(null);

  // Edit flow state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  // Delete flow state
  const [deleteModalAccount, setDeleteModalAccount] = useState<AccountProfile | null>(null);
  const [deleteLocalFiles, setDeleteLocalFiles] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Action flow state
  const [launchingId, setLaunchingId] = useState<string | null>(null);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [switchingId, setSwitchingId] = useState<string | null>(null);

  // Clear interval on unmount
  useEffect(() => {
    return () => {
      if (addPollRef.current) clearInterval(addPollRef.current);
    };
  }, []);

  // Polling when adding an account
  useEffect(() => {
    if (activeTab === 'add' && createdProfile && !isAddReady) {
      addPollRef.current = setInterval(async () => {
        try {
          const result = await api.verifyAccountProfile(createdProfile.id);
          if (result.hasSession || result.profile.auth_status === 'READY') {
            setIsAddReady(true);
            setDetectedEmailAdd(result.account || result.profile.google_account_label || null);
            if (addPollRef.current) clearInterval(addPollRef.current);
            onShowToast('success', `Conta "${result.profile.display_name}" autenticada com sucesso!`);
            onAccountsChanged();
          }
        } catch {
          // Silent polling errors
        }
      }, 2500);

      return () => {
        if (addPollRef.current) clearInterval(addPollRef.current);
      };
    }
  }, [activeTab, createdProfile, isAddReady]);

  if (!isOpen) return null;

  const getStatusBadge = (status: AuthStatus) => {
    switch (status) {
      case 'READY':
      case 'ACTIVE':
        return {
          bg: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300',
          dot: 'bg-emerald-400',
          label: 'Conta identificada'
        };
      case 'WAITING_LOGIN':
      case 'LOGIN_REQUIRED':
      case 'VERIFYING':
      case 'AUTHENTICATING':
      case 'NEEDS_LOGIN':
        return {
          bg: 'bg-amber-500/15 border-amber-500/30 text-amber-300',
          dot: 'bg-amber-400 animate-pulse',
          label: 'Aguardando Login'
        };
      case 'QUOTA_EXHAUSTED':
        return {
          bg: 'bg-amber-500/15 border-amber-500/30 text-amber-300',
          dot: 'bg-amber-400',
          label: 'Cota em Cooldown'
        };
      case 'ERROR':
        return {
          bg: 'bg-rose-500/15 border-rose-500/30 text-rose-300',
          dot: 'bg-rose-400',
          label: 'Erro de Autenticação'
        };
      default:
        return {
          bg: 'bg-slate-500/15 border-slate-500/30 text-slate-300',
          dot: 'bg-slate-400',
          label: 'Offline'
        };
    }
  };

  // -------------------------------------------------------------
  // HANDLERS: ADD ACCOUNT
  // -------------------------------------------------------------
  const handleCreateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newDisplayName.trim();
    if (!name || isCreating) return;

    setIsCreating(true);
    try {
      const profile = await api.createAccountProfile({
        displayName: name,
        autoLaunch: true
      });
      setCreatedProfile(profile);
      onAccountsChanged();
      onShowToast('info', `Janela do Antigravity aberta em perfil isolado para "${profile.display_name}". Faça o login no aplicativo.`);
    } catch (err: any) {
      onShowToast('error', `Erro ao criar perfil: ${err.message}`);
    } finally {
      setIsCreating(false);
    }
  };

  const handleManualVerifyAdd = async () => {
    if (!createdProfile || isVerifyingAdd) return;
    setIsVerifyingAdd(true);
    try {
      const result = await api.verifyAccountProfile(createdProfile.id);
      if (result.hasSession || result.profile.auth_status === 'READY') {
        setIsAddReady(true);
        setDetectedEmailAdd(result.account || result.profile.google_account_label || null);
        if (addPollRef.current) clearInterval(addPollRef.current);
        onShowToast('success', `Conta autenticada: ${result.account || result.profile.display_name}`);
        onAccountsChanged();
      } else {
        onShowToast('warn', 'Login ainda não detectado. Conclua o login na janela do Antigravity.');
      }
    } catch (err: any) {
      onShowToast('error', `Erro ao verificar: ${err.message}`);
    } finally {
      setIsVerifyingAdd(false);
    }
  };

  const handleReopenAdd = async () => {
    if (!createdProfile || isReopeningAdd) return;
    setIsReopeningAdd(true);
    try {
      const res = await api.launchAccountProfileLogin(createdProfile.id);
      onShowToast('info', res.message || 'Janela do Antigravity reaberta.');
    } catch (err: any) {
      onShowToast('error', `Falha ao reabrir: ${err.message}`);
    } finally {
      setIsReopeningAdd(false);
    }
  };

  const resetAddForm = () => {
    if (addPollRef.current) clearInterval(addPollRef.current);
    setNewDisplayName('');
    setCreatedProfile(null);
    setIsAddReady(false);
    setDetectedEmailAdd(null);
  };

  // -------------------------------------------------------------
  // HANDLERS: SWITCH ACCOUNT
  // -------------------------------------------------------------
  const handleSwitchAccount = async (target: AccountProfile) => {
    setSwitchingId(target.id);
    try {
      onShowToast('info', `Alternando para "${target.display_name}" (preservando checkpoints e contexto)...`);
      if (activeProjectId) {
        const result = await api.switchProjectAccount(activeProjectId, target.id);
        onAccountSwitched(result.activeProfile);
      } else {
        await api.setGlobalActiveAccountProfile(target.id);
        onAccountSwitched(target);
      }
      onAccountsChanged();
      onShowToast('success', `Conta ativa alterada para "${target.display_name}". Sessão preservada.`);
    } catch (err: any) {
      onShowToast('error', `Falha ao alternar conta: ${err.message}`);
    } finally {
      setSwitchingId(null);
    }
  };

  // -------------------------------------------------------------
  // HANDLERS: LAUNCH LOGIN / REOPEN
  // -------------------------------------------------------------
  const handleLaunchLogin = async (acc: AccountProfile) => {
    setLaunchingId(acc.id);
    try {
      const res = await api.launchAccountProfileLogin(acc.id);
      onShowToast('info', res.message);
      onAccountsChanged();
    } catch (err: any) {
      onShowToast('error', `Erro ao abrir login: ${err.message}`);
    } finally {
      setLaunchingId(null);
    }
  };

  // -------------------------------------------------------------
  // HANDLERS: VERIFY / SYNC
  // -------------------------------------------------------------
  const handleVerify = async (accId: string) => {
    setVerifyingId(accId);
    try {
      const result = await api.verifyAccountProfile(accId);
      if (result.hasSession || result.profile.auth_status === 'READY') {
        onShowToast('success', `Conta validada: ${result.account || result.profile.display_name}`);
      } else {
        onShowToast('warn', `Status: ${result.profile.auth_status}. Realize o login na janela do Antigravity.`);
      }
      onAccountsChanged();
    } catch (err: any) {
      onShowToast('error', `Erro ao sincronizar: ${err.message}`);
    } finally {
      setVerifyingId(null);
    }
  };

  // -------------------------------------------------------------
  // HANDLERS: EDIT ACCOUNT
  // -------------------------------------------------------------
  const startEdit = (acc: AccountProfile) => {
    setEditingId(acc.id);
    setEditName(acc.display_name);
    setEditEmail(acc.google_account_label || '');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName('');
    setEditEmail('');
  };

  const saveEdit = async (accId: string) => {
    if (!editName.trim() || isSavingEdit) return;
    setIsSavingEdit(true);
    try {
      await api.updateAccountProfile(accId, {
        displayName: editName.trim(),
        googleAccountLabel: editEmail.trim() || null
      });
      onShowToast('success', 'Perfil atualizado com sucesso.');
      setEditingId(null);
      onAccountsChanged();
    } catch (err: any) {
      onShowToast('error', `Erro ao atualizar perfil: ${err.message}`);
    } finally {
      setIsSavingEdit(false);
    }
  };

  // -------------------------------------------------------------
  // HANDLERS: DELETE ACCOUNT
  // -------------------------------------------------------------
  const openDeleteModal = (acc: AccountProfile) => {
    setDeleteModalAccount(acc);
    setDeleteLocalFiles(false);
  };

  const executeDelete = async () => {
    if (!deleteModalAccount || isDeleting) return;
    setIsDeleting(true);
    try {
      const res = await api.deleteAccountProfile(deleteModalAccount.id, {
        deleteData: deleteLocalFiles
      });
      onShowToast('success', res.message);
      setDeleteModalAccount(null);
      onAccountsChanged();
    } catch (err: any) {
      onShowToast('error', `Erro ao remover conta: ${err.message}`);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl bg-[#0e111a] border border-[#23293d] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 bg-[#141824] border-b border-[#23293d] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center">
              <User className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white tracking-tight flex items-center gap-2">
                Gerenciador de Contas Google
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-600/20 border border-indigo-500/30 text-indigo-300">
                  {accounts.length} {accounts.length === 1 ? 'conta' : 'contas'}
                </span>
              </h3>
              <p className="text-[11px] text-[#7e87aa]">
                Isolamento multi-account com diretórios, perfis e sessões Antigravity independentes
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#7e87aa] hover:text-white hover:bg-[#1f2438] transition-colors"
            title="Fechar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-[#23293d] bg-[#101420] px-6">
          <button
            onClick={() => setActiveTab('list')}
            className={`py-3 px-4 text-xs font-semibold border-b-2 transition-all flex items-center gap-2 ${
              activeTab === 'list'
                ? 'border-indigo-500 text-white bg-indigo-500/5'
                : 'border-transparent text-[#7e87aa] hover:text-slate-200'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Minhas Contas ({accounts.length})</span>
          </button>
          <button
            onClick={() => {
              setActiveTab('add');
              resetAddForm();
            }}
            className={`py-3 px-4 text-xs font-semibold border-b-2 transition-all flex items-center gap-2 ${
              activeTab === 'add'
                ? 'border-indigo-500 text-white bg-indigo-500/5'
                : 'border-transparent text-[#7e87aa] hover:text-slate-200'
            }`}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>+ Adicionar Conta</span>
          </button>
        </div>

        {/* Body Content */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1">
          {activeTab === 'list' ? (
            <div className="space-y-3">
              {accounts.length === 0 ? (
                <div className="text-center py-10 text-slate-400">
                  <User className="w-10 h-10 mx-auto text-slate-600 mb-2" />
                  <p className="text-sm font-semibold">Nenhuma conta cadastrada.</p>
                  <p className="text-xs text-slate-500 mt-1">Clique na aba "+ Adicionar Conta" para conectar sua primeira conta Google.</p>
                </div>
              ) : (
                accounts.map(acc => {
                  const isActive = activeAccount?.id === acc.id;
                  const isEditing = editingId === acc.id;
                  const isSwitchingThis = switchingId === acc.id;
                  const isLaunchingThis = launchingId === acc.id;
                  const isVerifyingThis = verifyingId === acc.id;
                  const statusBadge = getStatusBadge(acc.auth_status);

                  return (
                    <div
                      key={acc.id}
                      className={`p-4 rounded-xl border transition-all ${
                        isActive
                          ? 'bg-indigo-950/20 border-indigo-500/50 shadow-lg shadow-indigo-950/30'
                          : 'bg-[#121522] border-[#22273d] hover:border-[#323955]'
                      }`}
                    >
                      {/* View or Edit mode */}
                      {isEditing ? (
                        <div className="space-y-3">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div>
                              <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                                Nome de Exibição:
                              </label>
                              <input
                                type="text"
                                value={editName}
                                onChange={e => setEditName(e.target.value)}
                                className="w-full px-3 py-1.5 rounded-lg bg-[#08090e] border border-[#2c334d] text-xs text-white focus:outline-none focus:border-indigo-500"
                              />
                            </div>
                            <div>
                              <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                                E-mail da Conta Google (opcional):
                              </label>
                              <input
                                type="email"
                                value={editEmail}
                                onChange={e => setEditEmail(e.target.value)}
                                placeholder="ex: usuario@gmail.com"
                                className="w-full px-3 py-1.5 rounded-lg bg-[#08090e] border border-[#2c334d] text-xs text-white focus:outline-none focus:border-indigo-500"
                              />
                            </div>
                          </div>
                          <div className="flex justify-end gap-2 pt-1">
                            <button
                              type="button"
                              onClick={cancelEdit}
                              className="px-3 py-1 rounded-lg bg-[#181b28] hover:bg-[#202538] text-xs text-slate-300 transition-colors"
                            >
                              Cancelar
                            </button>
                            <button
                              type="button"
                              onClick={() => saveEdit(acc.id)}
                              disabled={isSavingEdit || !editName.trim()}
                              className="px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white flex items-center gap-1.5 transition-colors"
                            >
                              {isSavingEdit ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                              <span>Salvar</span>
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div>
                          {/* Card Header */}
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-lg bg-[#1a1f33] border border-[#2b3352] flex items-center justify-center flex-shrink-0">
                                <span className={`w-2.5 h-2.5 rounded-full ${statusBadge.dot}`} />
                              </div>
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-bold text-white">
                                    {acc.display_name}
                                  </span>
                                  {isActive && (
                                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 flex items-center gap-1">
                                      <CheckCircle2 className="w-3 h-3 text-indigo-400" />
                                      CONTA ATIVA
                                    </span>
                                  )}
                                </div>
                                <div className="text-xs text-slate-400 font-mono mt-0.5 flex items-center gap-1.5">
                                  <span>{acc.google_account_label || '(Aguardando login)'}</span>
                                </div>
                              </div>
                            </div>

                            {/* Status Badge */}
                            <div className={`px-2.5 py-1 rounded-lg border text-[11px] font-medium flex items-center gap-1.5 ${statusBadge.bg}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${statusBadge.dot}`} />
                              <span>{statusBadge.label}</span>
                            </div>
                          </div>

                          {/* Quota Exhausted notice */}
                          {acc.auth_status === 'QUOTA_EXHAUSTED' && (
                            <div className="mt-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs flex items-center justify-between gap-3">
                              <div className="flex items-center gap-2 min-w-0">
                                <Clock className="w-4 h-4 text-amber-400 flex-shrink-0" />
                                <span className="truncate">
                                  {acc.quota_resets_at
                                    ? `Limite individual atingido (429). Restabelecimento previsto para as ${new Date(acc.quota_resets_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`
                                    : (acc.quota_message || 'Limite de cota temporariamente atingido.')}
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleVerify(acc.id)}
                                disabled={isVerifyingThis}
                                className="px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 text-[11px] font-semibold flex items-center gap-1 flex-shrink-0 transition-colors"
                              >
                                {isVerifyingThis ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                                <span>Verificar Cota</span>
                              </button>
                            </div>
                          )}

                          {/* Environment path info */}
                          <div className="mt-3 pt-2.5 border-t border-[#1e2336] flex items-center justify-between text-[11px] text-slate-400">
                            <div className="flex items-center gap-1.5 truncate max-w-[380px] font-mono text-[10px] text-[#717b9b]">
                              <Folder className="w-3 h-3 flex-shrink-0" />
                              <span className="truncate" title={acc.environment_path}>
                                {acc.environment_path}
                              </span>
                            </div>
                            <span className="text-[10px] text-[#596384]">
                              ID: {acc.id}
                            </span>
                          </div>

                          {/* Action Buttons */}
                          <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              {!isActive && (
                                <button
                                  type="button"
                                  onClick={() => handleSwitchAccount(acc)}
                                  disabled={isSwitchingThis}
                                  className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-all shadow-md shadow-indigo-600/20"
                                >
                                  {isSwitchingThis ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    <Check className="w-3.5 h-3.5" />
                                  )}
                                  <span>Ativar</span>
                                </button>
                              )}

                              <button
                                type="button"
                                onClick={() => handleLaunchLogin(acc)}
                                disabled={isLaunchingThis}
                                className="px-2.5 py-1.5 rounded-lg bg-[#1a1f33] hover:bg-[#222842] border border-[#2c3350] text-slate-300 hover:text-white text-xs font-medium flex items-center gap-1.5 transition-colors"
                                title="Abrir o Antigravity deste perfil; use Entrar com Google no aplicativo"
                              >
                                {isLaunchingThis ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                                ) : (
                                  <ExternalLink className="w-3.5 h-3.5 text-indigo-400" />
                                )}
                                <span>Abrir Antigravity</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => handleVerify(acc.id)}
                                disabled={isVerifyingThis}
                                className="px-2.5 py-1.5 rounded-lg bg-[#1a1f33] hover:bg-[#222842] border border-[#2c3350] text-slate-300 hover:text-white text-xs font-medium flex items-center gap-1.5 transition-colors"
                                title="Sincronizar e verificar sessão do Antigravity"
                              >
                                <RefreshCw className={`w-3.5 h-3.5 ${isVerifyingThis ? 'animate-spin text-indigo-400' : ''}`} />
                                <span>Sincronizar</span>
                              </button>
                            </div>

                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => startEdit(acc)}
                                className="p-1.5 rounded-lg bg-[#141824] hover:bg-[#1f2438] text-slate-400 hover:text-slate-200 border border-[#23293d] transition-colors"
                                title="Renomear perfil"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>

                              <button
                                type="button"
                                onClick={() => openDeleteModal(acc)}
                                disabled={isActive || accounts.length <= 1}
                                className={`p-1.5 rounded-lg border transition-colors ${
                                  isActive || accounts.length <= 1
                                    ? 'opacity-30 cursor-not-allowed border-transparent text-slate-600'
                                    : 'bg-[#141824] hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 border-[#23293d] hover:border-rose-500/30'
                                }`}
                                title={
                                  isActive
                                    ? 'Não é permitido remover a conta ativa. Alterne para outra conta primeiro.'
                                    : accounts.length <= 1
                                    ? 'Não é permitido remover a única conta restante.'
                                    : 'Remover conta'
                                }
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          ) : (
            /* TAB: ADICIONAR CONTA */
            <div className="space-y-4">
              {!createdProfile ? (
                /* Step 1 */
                <form onSubmit={handleCreateProfile} className="space-y-4">
                  <div className="p-3.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-xs text-indigo-200 leading-relaxed flex items-start gap-2.5">
                    <Shield className="w-4 h-4 text-indigo-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <strong>Isolamento Multi-Conta:</strong> Cada conta usa um perfil próprio. Ao continuar, o Antigravity será aberto. Nele, clique em <strong>Entrar com Google</strong> para iniciar a autenticação no navegador.
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      Nome da Conta Google: <span className="text-rose-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={newDisplayName}
                      onChange={e => setNewDisplayName(e.target.value)}
                      placeholder="Ex: Google Pro 3, Pessoal, Trabalho..."
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#08090e] border border-[#23293d] text-sm text-white placeholder-[#525a7f] focus:outline-none focus:border-indigo-500 transition-colors"
                      autoFocus
                      required
                    />
                  </div>

                  <div className="pt-2 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setActiveTab('list')}
                      className="px-4 py-2 rounded-xl bg-[#181b28] hover:bg-[#202538] text-xs font-semibold text-slate-300 transition-colors"
                    >
                      Voltar para Lista
                    </button>
                    <button
                      type="submit"
                      disabled={isCreating || !newDisplayName.trim()}
                      className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-xs font-semibold text-white shadow-lg shadow-indigo-600/30 flex items-center gap-2 transition-all"
                    >
                      {isCreating ? (
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
                /* Step 2: Waiting Login & Polling */
                <div className="space-y-4">
                  {isAddReady ? (
                    <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 space-y-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center flex-shrink-0">
                          <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                        </div>
                        <div>
                          <div className="text-sm font-bold text-white">Conta Autenticada com Sucesso!</div>
                          <div className="text-xs text-emerald-300 mt-0.5 font-mono">
                            {detectedEmailAdd || createdProfile.display_name}
                          </div>
                        </div>
                      </div>
                      <div className="pt-2 flex justify-end">
                        <button
                          type="button"
                          onClick={() => {
                            resetAddForm();
                            setActiveTab('list');
                          }}
                          className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white flex items-center gap-2"
                        >
                          <Check className="w-4 h-4" />
                          <span>Concluir e Voltar para Lista</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="p-4 rounded-xl bg-[#141824] border border-[#23293d] space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse" />
                            <span className="text-xs font-bold text-white uppercase tracking-wide">
                              Aguardando Login no Antigravity...
                            </span>
                          </div>
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/30 text-amber-300">
                            WAITING_LOGIN
                          </span>
                        </div>

                        <div className="text-xs text-[#8e98b7] leading-relaxed">
                          A janela do Antigravity foi aberta para o perfil <strong>"{createdProfile.display_name}"</strong>.
                          <br />
                          Faça login com sua conta Google na janela aberta. O DecoHUB detectará o login automaticamente.
                        </div>

                        <div className="pt-1 flex items-center gap-2 text-[11px] text-indigo-300/80">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Verificando status em tempo real...</span>
                        </div>
                      </div>

                      <div className="flex flex-col sm:flex-row items-center gap-2 pt-2">
                        <button
                          type="button"
                          onClick={handleManualVerifyAdd}
                          disabled={isVerifyingAdd}
                          className="w-full sm:flex-1 py-2 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-xs font-semibold text-white flex items-center justify-center gap-2 shadow-md shadow-indigo-600/30 transition-all"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${isVerifyingAdd ? 'animate-spin' : ''}`} />
                          <span>Verificar Agora</span>
                        </button>

                        <button
                          type="button"
                          onClick={handleReopenAdd}
                          disabled={isReopeningAdd}
                          className="w-full sm:flex-1 py-2 px-4 rounded-xl bg-[#1a1f33] hover:bg-[#222842] border border-[#2c3350] text-xs font-medium text-slate-200 hover:text-white flex items-center justify-center gap-2 transition-colors"
                        >
                          <ExternalLink className="w-3.5 h-3.5 text-indigo-400" />
                          <span>Reabrir Antigravity</span>
                        </button>
                      </div>

                      <div className="pt-2 text-center">
                        <button
                          type="button"
                          onClick={() => {
                            resetAddForm();
                            setActiveTab('list');
                          }}
                          className="text-xs text-slate-400 hover:text-slate-200 transition-colors"
                        >
                          ← Voltar para a lista de contas
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-[#101420] border-t border-[#23293d] flex items-center justify-between text-xs text-[#7e87aa]">
          <span>DecoHUB Multi-Account Engine</span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-[#1a1f33] hover:bg-[#222842] text-slate-200 text-xs font-medium transition-colors"
          >
            Fechar
          </button>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {deleteModalAccount && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-md bg-[#0e111a] border border-[#23293d] rounded-2xl shadow-2xl p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-500/20 border border-rose-500/40 flex items-center justify-center flex-shrink-0">
                <Trash2 className="w-5 h-5 text-rose-400" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-white">Remover Conta Google?</h4>
                <p className="text-xs text-slate-400 mt-0.5">
                  Conta: <strong>"{deleteModalAccount.display_name}"</strong>
                </p>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-[#141824] border border-[#23293d] text-xs text-slate-300 space-y-2">
              <p>Escolha o nível de remoção desta conta:</p>
              <label className="flex items-start gap-2.5 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={deleteLocalFiles}
                  onChange={e => setDeleteLocalFiles(e.target.checked)}
                  className="mt-0.5 rounded border-[#323955] text-rose-600 focus:ring-0 bg-[#0a0c14]"
                />
                <span className="text-xs text-slate-300">
                  <strong className="text-rose-300">Apagar também os arquivos locais deste perfil</strong>
                  <br />
                  <span className="text-[11px] text-[#717b9b]">
                    Exclui a pasta isolada <code className="text-slate-400">{deleteModalAccount.environment_path}</code> do disco.
                  </span>
                </span>
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setDeleteModalAccount(null)}
                disabled={isDeleting}
                className="px-4 py-2 rounded-xl bg-[#181b28] hover:bg-[#202538] text-xs font-semibold text-slate-300 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={executeDelete}
                disabled={isDeleting}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-xs font-semibold text-white flex items-center gap-1.5 transition-all shadow-md shadow-rose-600/30"
              >
                {isDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                <span>Confirmar Remoção</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
