import React, {useEffect,useState} from 'react';
import {api} from '../services/api';

export function NativeExecutionSettings({projectId}:{projectId:string}) {
  const [mode,setMode]=useState<'restricted'|'permissive'>('restricted');
  const [saved,setSaved]=useState<'restricted'|'permissive'|null>(null);
  const [ack,setAck]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [bindingInfo,setBindingInfo]=useState<any>(null);
  const [bindingBusy,setBindingBusy]=useState(false);

  const loadData=()=>{
    api.getNativeExecutionPolicy(projectId).then(p=>{setMode(p.mode);setSaved(p.mode);}).catch(e=>{setError(e.message);});
    api.getNativeWorkspaceBinding(projectId).then(b=>setBindingInfo(b)).catch(()=>{});
  };

  useEffect(()=>{
    setSaved(null);setAck(false);setError('');
    loadData();
  },[projectId]);

  const save=async()=>{
    setBusy(true);setError('');
    try{
      const p=await api.setNativeExecutionPolicy(projectId,mode);
      setSaved(p.mode);setAck(false);
      // Re-establish binding with the updated policy
      const b=await api.establishNativeWorkspaceBinding(projectId,{mode});
      setBindingInfo({isBound:true,binding:b.binding});
    }catch(e:any){setError(e.message);}finally{setBusy(false);}
  };

  const handleEstablishBinding=async()=>{
    setBindingBusy(true);setError('');
    try {
      const res=await api.establishNativeWorkspaceBinding(projectId,{mode});
      setBindingInfo({isBound:true,binding:res.binding});
    } catch(e:any){setError(e.message);} finally {setBindingBusy(false);}
  };

  return <section className="p-5 rounded-xl border border-slate-700 space-y-4 text-sm" aria-label="Política nativa do Antigravity">
    <div className="space-y-1">
      <h4 className="font-semibold text-white">Vínculo Nativo & Permissões Antigravity</h4>
      <p className="text-slate-400">Esta escolha informa o DecoHUB. As permissões do Antigravity continuam sendo configuradas na interface oficial.</p>
    </div>

    {/* Status do Vínculo Nativo */}
    <div className="p-3.5 rounded-lg bg-slate-900/60 border border-slate-800 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-300 font-medium">Status do Vínculo Nativo:</span>
        {bindingInfo?.isBound ? (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
            ✓ Vinculado e Ativo
          </span>
        ) : (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">
            ⚠ Vínculo Pendente
          </span>
        )}
      </div>
      {bindingInfo?.binding?.nativeProjectId && (
        <div className="text-[11px] font-mono text-slate-400 truncate">
          ID Nativo: <span className="text-slate-300">{bindingInfo.binding.nativeProjectId}</span>
        </div>
      )}
      {!bindingInfo?.isBound && (
        <div className="pt-1">
          <button
            type="button"
            onClick={handleEstablishBinding}
            disabled={bindingBusy}
            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium rounded transition-colors disabled:opacity-50"
          >
            {bindingBusy ? 'Vinculando…' : 'Validar / Estabelecer Vínculo Nativo'}
          </button>
        </div>
      )}
    </div>

    {/* Seleção de Política */}
    <div className="space-y-2">
      <label className="block text-xs font-semibold text-slate-300">Modo de Execução:</label>
      <select aria-label="Modo nativo" value={mode} disabled={busy||saved===null} onChange={e=>{setMode(e.target.value as typeof mode);setAck(false);}} className="bg-slate-900 text-white p-2 rounded w-full border border-slate-700">
        <option value="restricted">Exigir Deny / Require Review</option>
        <option value="permissive">Aceitar Allow / Eager</option>
      </select>
    </div>

    {mode==='permissive'&&<p className="text-amber-300 text-xs">O agente pode acessar outras pastas e executar comandos automaticamente. A pasta vinculada não impede alterações fora dela. O executor local de testes mantém suas próprias restrições.</p>}
    {mode==='permissive'&&mode!==saved&&<label className="flex gap-2 text-slate-200 text-xs cursor-pointer"><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/>Aceito acesso externo e comandos automáticos, sem contenção de arquivos do agente.</label>}
    
    <div>
      <button onClick={save} disabled={busy||saved===null||mode===saved||(mode==='permissive'&&!ack)} className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-semibold disabled:opacity-40 transition-colors">
        {busy?'Salvando…':'Salvar escolha'}
      </button>
    </div>

    {saved&&<p className="text-slate-400 text-xs">Escolha salva: {saved==='permissive'?'Allow / Eager':'Deny / Require Review'}. Nenhuma configuração global foi alterada.</p>}
    {error&&<p role="alert" className="text-red-300 text-xs">{error}</p>}
  </section>;
}
