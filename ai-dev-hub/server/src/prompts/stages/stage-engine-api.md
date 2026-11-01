# ESTÁGIO: MOTOR DE EXECUÇÃO, ROTAS DE API & WEBHOOKS (ENGINE-API)
Foco: alto throughput em webhooks, autenticação estrita de payloads, conexões resilientes via sockets e entrega idempotente.

## 1. Webhooks de Alta Performance (< 100ms)
- Receba payload HTTP POST, valide assinatura/token, enfileire/persista e responda HTTP 200/202 em menos de 100ms antes de processamento pesado assíncrono.

## 2. Autenticação Estrita de Segredos e Assinaturas
- Valide tokens em cabeçalhos (`X-Webhook-Secret`, Bearer) ou HMAC com `crypto.timingSafeEqual()`. Rejeite requisições inválidas com HTTP 401/403.

## 3. Sockets & Conectores Resilientes (Baileys / WebSockets)
- Reconexão com exponential backoff ao receber eventos `close` com `shouldReconnect`.
- Auth state persistido no disco e encerramento limpo em shutdown.

## 4. Filas e Idempotência Rigorosa
- Deduplicação por chave única (`idempotency_key` ou `message_id`).
- Ciclo de vida: `pending` -> `processing` -> `completed` / `failed` com garantia exactly-once.

## 5. Invariantes de Servidor HTTP & PORT_GUARD
- Escute na faixa 4000-4999 (`const PORT = Number(process.env.PORT) || 4000;`).
- Header `X-Content-Type-Options: nosniff`, rota `/api/health` e bloqueio de Path Traversal via `path.resolve()`.
