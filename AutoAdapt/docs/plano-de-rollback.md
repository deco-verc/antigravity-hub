# Plano de Rollback e Contingência — AutoAdapt v0.2.0-candidate

**Projeto:** AutoAdapt  
**Módulo:** Gestão de Riscos e Procedimentos de Reversão  
**Data:** 08/10/2026  
**Status:** APROVADO — Testado e Pronto para Execução  
**Diretriz Fundamental:** Proibido merge automático em master/main sem aprovação humana expressa.

---

## 1. Sumário de Segurança

A versão candidata `v0.2.0-candidate` foi desenvolvida e validada integralmente dentro de branch isolada (`ai/1-isolamento-worktree`) e em worktrees efêmeros descartáveis. A branch principal (`main`/`master`) permaneceu 100% intocada durante todo o ciclo autônomo.

Este documento detalha o procedimento determinístico de rollback caso qualquer anomalia seja detectada durante a homologação humana.

---

## 2. Ponto de Restauração Seguro (Baseline Anchor)

| Parâmetro | Valor de Referência |
|---|---|
| **Branch de Trabalho** | `ai/1-isolamento-worktree` |
| **Commit Estável da Baseline (M1)** | `523dcbc1be9671f851412c21df9407721fa324c6` |
| **Commit da Versão Candidata (M2)** | `a47ef31` |
| **Branch Principal (Não Modificada)** | `main` |

---

## 3. Matriz de Cenários e Respostas de Rollback

| Cenário de Falha | Ação de Rollback | Tempo Estimado | Risco |
|---|---|:---:|:---:|
| **Cenário A:** Rejeição Humana Integral da Versão Candidata | Reverter branch isolada para o commit baseline `523dcbc` | < 1 minuto | Zero (Não afeta master) |
| **Cenário B:** Processo Bloqueado ou Lock Git Pendente | Limpeza forçada de worktrees e exclusão de `.git/index.lock` | < 30 segundos | Baixo |
| **Cenário C:** Descarte Completo do Branch Candidato | Excluir branch `ai/1-isolamento-worktree` e worktrees associados | < 1 minuto | Zero |

---

## 4. Procedimentos Passo a Passo

### 4.1 Procedimento 1: Reversão Atômica para a Baseline Estável

Se a versão candidata for rejeitada ou apresentar comportamento divergente:

```powershell
# 1. Navegar até o diretório do AutoAdapt
cd "C:\IA\Antigravity HUB\AutoAdapt"

# 2. Confirmar status limpo do Git
git status

# 3. Resetar a branch atual para o commit exato da Baseline (M1)
git reset --hard 523dcbc1be9671f851412c21df9407721fa324c6

# 4. Limpar arquivos não rastreados que pertenciam à versão candidata
git clean -fd

# 5. Executar os testes de regressão da baseline
npm test
```

### 4.2 Procedimento 2: Limpeza de Sandboxes e Worktrees Efêmeros Zumbis

Caso restem worktrees temporários ou locks pendentes:

```powershell
# 1. Listar todos os worktrees registrados
git worktree list

# 2. Podar referências administrativas obsoletas
git worktree prune

# 3. Remover qualquer worktree efêmero residual (se existir)
git worktree remove --force "C:\Users\Deco\AppData\Local\Temp\autoadapt-ephemeral-*"

# 4. Remover locks residuais órfãos (se existirem)
Remove-Item -Path ".\.git\index.lock" -Force -ErrorAction SilentlyContinue
```

### 4.3 Procedimento 3: Descarte Completo da Branch Candidata

```powershell
# 1. Trocar para a branch principal
git checkout main

# 2. Excluir a branch de homologação isolada
git branch -D ai/1-isolamento-worktree
```

---

## 5. Critérios de Sucesso Pós-Rollback

Após a execução do rollback, o sistema é considerado em estado seguro quando:
1. `git status` reporta working tree limpo.
2. `git rev-parse HEAD` retorna `523dcbc1be9671f851412c21df9407721fa324c6`.
3. `npm test` executa os 35 testes originais da baseline com 100% de sucesso.
4. Zero arquivos `.git/index.lock` residuais no repositório.
