# Guia de Conhecimento e Integração: Upstash (Redis REST & Rate Limiting)

## 1. Visão Geral
O Upstash fornece Redis Serverless via API REST HTTP, amplamente utilizado para caching temporário, controle de taxa (rate limiting), filas e persistência rápida em microsserviços.
Este guia instrui os agentes (Workers) do DecoHUB sobre como implementar integrações de alta performance e à prova de falhas.

## 2. Dependências Recomendadas
- `@upstash/redis` ou chamadas `fetch` HTTP nativas para os endpoints REST do Upstash.

```bash
npm install @upstash/redis
```

## 3. Variáveis de Ambiente (`.env.example`)
```env
# Upstash Redis REST
UPSTASH_REDIS_REST_URL=https://xyz-redis.upstash.io
UPSTASH_REDIS_REST_TOKEN=AX...
```

## 4. Padrão de Autonomia e Graceful Mock Fallback (Plug-and-Play)
**REGRA MANDATÓRIA DE COMPATIBILIDADE**:
1. Se `UPSTASH_REDIS_REST_URL` ou `UPSTASH_REDIS_REST_TOKEN` estiverem ausentes, vazios ou apontarem para hosts inacessíveis:
   - **NÃO LANÇAR EXCEÇÃO NO BOOT**.
   - Crie uma implementação de fallback baseada em `Map<string, { value: any, expiresAt?: number }>` na memória do Node.js.
   - Forneça os mesmos métodos principais: `get(key)`, `set(key, val, { ex?: seconds })`, `del(key)`, `incr(key)`.
2. Emita o log informativo:
   `[CACHE] Upstash Redis credentials not detected, falling back to in-memory TTL Map adapter.`
3. Isso garante que a inicialização do servidor, as rotas de API com rate-limiting e o cache respondam sem erros nos testes e auditorias do Evaluator.

## 5. Implementação de Exemplo (Adapter com Memória Fallback)
```typescript
interface CacheAdapter {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: any, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
}

class MemoryCacheAdapter implements CacheAdapter {
  private store = new Map<string, { value: any; expiresAt?: number }>();

  async get<T>(key: string): Promise<T | null> {
    const item = this.store.get(key);
    if (!item) return null;
    if (item.expiresAt && Date.now() > item.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return item.value as T;
  }

  async set(key: string, value: any, ttlSeconds?: number): Promise<void> {
    const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined;
    this.store.set(key, { value, expiresAt });
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }
}
```
