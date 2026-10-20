# DecoHUB 1.0.6 — aceitação explícita de ALLOW/EAGER

A escolha do usuário foi implementada no produto, por projeto. O DecoHUB não escreve configurações oficiais do Antigravity. O projeto QA mantém seus metadados reais ALLOW/EAGER, sandboxMode=false e uma única pasta vinculada.

## Pontos encontrados e tratamento

| Ponto | Exigência anterior | Comportamento atual |
| --- | --- | --- |
| `server/src/nativeWorkspaceBinding.ts`, inspect/bind/get/resolve/assertEnvironment | DENY + autoExecution OFF | Validação compartilhada da escolha persistida por projeto; padrão restritivo, ALLOW/EAGER somente com consentimento explícito |
| `AccountProfileManager.buildEnvironmentForProfile`, `AgentApiGateway.newConversation/sendMessage` | Bloqueio herdado de NativeWorkspaceBinding | Usam a mesma política; verificações de runtime, pasta, conta e ambiente permanecem |
| `final106/verification-tool.cjs` | QA_NATIVE_DENY_REVIEW_REQUIRED | Usa o validador puro do próprio build empacotado, sem regras paralelas ou negações universais |
| `final106/native-normal-preload.cjs` e `launch.cjs` | Bloqueio antes do envio/inicialização | Exigem escolha correspondente, metadados oficiais correspondentes e autorização específica; no modo permissivo, autorização deve reconhecer risco fora do escopo |
| `final106/reconcile-policy.cjs` | Só reconciliava DENY/OFF | Configura a escolha através do serviço do produto; atualiza apenas o comprovante no SQLite QA após validar sessões, turnos DONE, runtime e ausência de operações ambíguas |
| `final-readonly-evidence.cjs` | Comparação fixa DENY/OFF e helper legado | Seleciona a preparação 1.0.6 e seu validador/configuração, preservando os relatórios anteriores |
| `qa-verification-bridge.cjs`, `reconcile-native-policy-binding.cjs`, preload/launcher antigos | Regras históricas da 1.0.5, incluindo command(*) e mcp(*) | Permanecem como artefatos históricos; não são utilizados pelo caminho ativo final106. Seus hashes históricos não foram substituídos por uma falsa conformidade |
| `DevAutonomyService` e `IndependentEvaluator/controlledVerification` | Respeito à política nativa e allowlist do executor local | Não exigem globalmente DENY/OFF. As restrições do executor local são independentes e foram preservadas |

## Configuração disponível no produto

Painel Avançado → Autonomia & Segurança → Permissões nativas aceitas neste projeto → Aceitar Allow / Eager. A interface exige confirmação explícita do significado desse modo. API local: GET/PUT `/api/projects/:id/native-execution-policy`.

O serviço registra escolha e histórico no banco da instância. Não infere consentimento de `full_dev_autonomy`, não altera permissões globais e recusa mudanças com Run pendente, turno incerto, reserva de execução ou criação não reconciliada. Políticas desconhecidas, combinações mistas, troca de conta e alterações dos metadados continuam bloqueadas.

## Limitação efetiva

ALLOW/EAGER não oferece contenção de filesystem nem revisão humana obrigatória dos comandos nativos. A associação exata de uma pasta identifica o workspace; não impede ferramentas nativas do Worker de acessar FinanceFlow, AutoAdapt ou produção. Não é tecnicamente possível garantir essa proibição somente com os controles atuais do DecoHUB e a política permissiva do Antigravity. Escopo no prompt, inventário e detecção posterior não são uma barreira preventiva.

O executor local controlado do Evaluator continua utilizando cópia do projeto, comandos e argumentos delimitados, ambiente mínimo, nenhum shell ou subprocesso arbitrário. Não herda ALLOW/EAGER. Suas limitações de segurança permanecem declaradas: permissões Node e verificações locais não equivalem a um sandbox do sistema operacional para código hostil.

Antes da inferência, a autorização específica precisa aceitar o risco de acesso nativo fora do projeto; isto não permite solicitar alterações em outros projetos. Confirmação atual de conta/plano/créditos/ausência de agentes continua necessária. Não foi produzida comprovação automática de OAuth, quota individual ou garantia financeira absoluta.

## Evidências offline desta revisão

- Suíte completa: **291/291**, 30 suites. Typecheck e build: PASS.
- Barreira física/runtime/sessões: **25/25** contra o pacote atualizado. ALLOW/EAGER explícito também bloqueia a terceira criação antes do proxy externo e mantém bloqueios de crédito, identidade, runtime e concorrência.
- Preparação e sequência/orçamento: **8/8**. Evaluator do pacote atualizado reproduz a falha real ERR_INVALID_URL e a reprova; nenhuma correção foi feita manualmente no projeto do Worker.
- React/Electron empacotado: PASS. Escolha permissiva persistida pelos controles React/API; consentimento implícito recusado; reinício do fluxo offline conserva sessões. Modelos e ferramentas externas são fixtures nesse teste, não evidência de homologação nativa.
- Boot protegido sem fixture de modelo: PASS sobre cópia consistente do estado existente; preserva os mesmos IDs, 2 reservas, 3 continuações históricas, zero chamadas reais, encerramento seguro.
- Empacotamento: 59 módulos de servidor conferidos; 60 arquivos comparados com o conteúdo do instalador; zero fixtures no produto. Instalador não executado.

Revisão distribuída separadamente: `dist-desktop-1.0.6-permissive`, versão de produto **1.0.6**, identificação de evidência **1.0.6-explicit-allow-eager**. O build anterior e sua comprovação são preservados. SHA-256 do instalador desta revisão: `0e9ed9b69648f3e02e14b74f242751725e24aea1ac4395493d9af10fae6caf4e`.

## Sandbox existente preparado

Raiz original `C:\IA\DecoHUB-native-sandbox-20261009`. Configuração ativa `control/native-normal-1.0.6.json`, executável e módulos do pacote revisado fixados por hashes. Projeto nativo `40c0f5fe-4585-4ad5-ade5-879a36e0b316`, pasta original `project/`.

- Supervisor `5489a5ca-40ad-431a-bbd7-f9dcea2b28e5`, pro; Worker `d4cbb8f9-a415-4693-876c-2105fc517212`, flash. Últimos turnos DONE; nenhuma ferramenta pendente.
- Ledger imutável de identidade/reservas preservado: **2/2**, três continuações históricas confirmadas, **seis restantes**, sem chamadas/leases ativos. Não resetado ou reinicializado.
- Escolha permissiva e comprovante real reconciliados apenas no banco QA; perfil acc-pro-1 selecionado. AUTH_UNKNOWN não convertido em autenticação verificada.
- Backend legado ausente; runtime principal 20896/19616 associado ao diretório exato. Produção consultada somente em leitura: 31 Runs históricos, fingerprint `8e29cb53e8e37eedd540d842099f7a8c6887389cda49891d5a86bded5f38a1bb`, zero Workers/leases ativos. Projetos preservados.
- Backup antes da reconciliação em `backups/before-allow-eager-1.0.6/`; sessão comparada integralmente antes/depois. Metadados oficiais SHA-256 `b351f1a2e066a75c32aa4328939eeb74122fa924e54d67ac4209079db77412b6`, sem alteração.

Nenhuma inferência, nova conversa ou instalação realizada nesta etapa. A falha de URL malformada continua aguardando reparo pelo mesmo Worker. Produto ainda não aprovado para instalação.

## Plano real sujeito à autorização específica

1. Reconfirmar conta aldxmir.s2@gmail.com / Google AI Pro, overages desligado, famílias pro/flash e ausência de atividade. Verificar runtime, metadados, hashes, ledger e produção sem operações concorrentes.
2. Iniciar apenas os processos do build revisado no sandbox. Enviar pelo Chat normal o prompt original de reparo, sem controlador externo de tarefas.
3. Supervisor existente planeja uma única tarefa (send 1); Worker existente corrige somente o defeito HTTP (send 2).
4. Evaluator executa npm test pela ferramenta local QA revisada e registra testes, hashes/diferenças reais, requisição malformada → 400 e /health posterior → 200.
5. Supervisor revisa a tarefa (send 3) e a conclusão (send 4). Runner conclui somente com PASS independente e aprovação do Supervisor.
6. Se necessário, um único reparo adicional e revisão, total máximo de seis envios. Qualquer resultado externo ambíguo, quota, divergência de identidade/runtime ou criação inesperada bloqueia novas chamadas. Não trocar conta/modelo nem criar conversas.

Esta autorização ainda não foi concedida para a revisão permissiva. A escolha ALLOW/EAGER autoriza compatibilidade e preparação offline, não inicia inferência.
