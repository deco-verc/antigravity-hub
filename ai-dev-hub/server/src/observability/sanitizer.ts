/**
 * Centralized Data Sanitizer for Logs, Observability and Diagnostics
 * Enforces security & privacy by redacting sensitive tokens, passwords, credentials and headers.
 */

const SECRET_PATTERNS: Array<{ regex: RegExp; replacement: string }> = [
  // Google API Keys
  { regex: /AIza[0-9A-Za-z_-]{35}/g, replacement: 'AIza[REDACTED_GOOGLE_KEY]' },
  // GitHub Tokens
  { regex: /gh[pousr]_[0-9A-Za-z_]{36,}/g, replacement: 'gh*_[REDACTED_GITHUB_TOKEN]' },
  // Generic Bearer Tokens
  { regex: /Bearer\s+[A-Za-z0-9._~+/=-]+/gi, replacement: 'Bearer [REDACTED_TOKEN]' },
  // JWT tokens (3 dot-separated base64-ish segments)
  { regex: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._-]{10,}\.[A-Za-z0-9._-]{10,}/g, replacement: '[REDACTED_JWT]' },
  // OpenAI / Anthropic / Gemini Key patterns
  { regex: /sk-[A-Za-z0-9_-]{20,}/g, replacement: 'sk-[REDACTED_API_KEY]' },
  { regex: /sk-ant-[A-Za-z0-9_-]{20,}/g, replacement: 'sk-ant-[REDACTED_API_KEY]' },
  // Private Keys
  { regex: /-----BEGIN\s+(RSA|EC|DSA|OPENSSH|PRIVATE)\s+KEY-----[^]*?-----END\s+(RSA|EC|DSA|OPENSSH|PRIVATE)\s+KEY-----/gi, replacement: '[REDACTED_PRIVATE_KEY]' },
  // URL Userinfo Passwords (e.g. mysql://user:password@host)
  { regex: /(:)([^@\s/:]{3,})(@)/g, replacement: '$1[REDACTED_PASSWORD]$3' },
  // Passwords, Secrets, Tokens in key-value / URL query format
  { regex: /(password|passwd|pwd|secret|api_key|apiKey|token|access_token|refresh_token)(["']?\s*[:=]\s*["']?)([^"'\s&,;]{3,})(["']?)/gi, replacement: '$1$2[REDACTED]$4' },
  // Cookie / Set-Cookie headers
  { regex: /(cookie|set-cookie)(["']?\s*[:=]\s*["']?)([^"'\r\n;]{3,})/gi, replacement: '$1$2[REDACTED_COOKIE]' },
  // Authorization headers
  { regex: /(authorization)(["']?\s*[:=]\s*["']?)([^"'\r\n]{3,})/gi, replacement: '$1$2[REDACTED_AUTH]' }
];

const SENSITIVE_KEY_NAMES = new Set([
  'password',
  'passwd',
  'pwd',
  'secret',
  'token',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'apikey',
  'api_key',
  'auth',
  'authorization',
  'cookie',
  'cookies',
  'private_key',
  'privatekey',
  'credentials'
]);

export class Sanitizer {
  private static MAX_STRING_LENGTH = 8192;
  private static MAX_DEPTH = 6;

  /**
   * Redacts sensitive strings using compiled regexes
   */
  static sanitizeString(input: string, maxLength = this.MAX_STRING_LENGTH): string {
    if (!input || typeof input !== 'string') return '';
    let sanitized = input;

    for (const { regex, replacement } of SECRET_PATTERNS) {
      sanitized = sanitized.replace(regex, replacement);
    }

    if (sanitized.length > maxLength) {
      sanitized = `${sanitized.slice(0, maxLength)}... [TRUNCATED ${sanitized.length - maxLength} chars]`;
    }

    return sanitized;
  }

  /**
   * Deep sanitizes objects, arrays, and primitives.
   * Handles circular references safely via a WeakSet.
   */
  static sanitize<T = any>(data: T, depth = 0, seen = new WeakSet()): T {
    if (data === null || data === undefined) return data;

    if (typeof data === 'string') {
      return this.sanitizeString(data) as unknown as T;
    }

    if (typeof data === 'number' || typeof data === 'boolean') {
      return data;
    }

    if (typeof data === 'function' || typeof data === 'symbol') {
      return String(data) as unknown as T;
    }

    if (depth > this.MAX_DEPTH) {
      return '[MAX_DEPTH_EXCEEDED]' as unknown as T;
    }

    if (typeof data === 'object') {
      if (seen.has(data as object)) {
        return '[CIRCULAR_REFERENCE]' as unknown as T;
      }
      seen.add(data as object);

      if (Array.isArray(data)) {
        return data.map(item => this.sanitize(item, depth + 1, seen)) as unknown as T;
      }

      if (data instanceof Error) {
        return {
          name: data.name,
          message: this.sanitizeString(data.message),
          code: (data as any).code,
          stack: data.stack ? this.sanitizeString(data.stack) : undefined,
          cause: data.cause ? this.sanitize(data.cause, depth + 1, seen) : undefined
        } as unknown as T;
      }

      const cleanObj: Record<string, any> = {};
      for (const [key, val] of Object.entries(data)) {
        const lowerKey = key.toLowerCase().replace(/[-_]/g, '');
        if (SENSITIVE_KEY_NAMES.has(lowerKey)) {
          cleanObj[key] = '[REDACTED_SENSITIVE_FIELD]';
        } else {
          cleanObj[key] = this.sanitize(val, depth + 1, seen);
        }
      }
      return cleanObj as unknown as T;
    }

    return String(data) as unknown as T;
  }

  /**
   * Safely formats an error into a structured, sanitized representation
   */
  static formatError(err: unknown): {
    name: string;
    message: string;
    code?: string;
    stack?: string;
    cause?: string;
    isOperational?: boolean;
    retryable?: boolean;
  } {
    if (!err) {
      return { name: 'UnknownError', message: 'No error object provided' };
    }

    if (err instanceof Error) {
      const code = (err as any).code || (err as any).status || undefined;
      const isOperational = (err as any).isOperational ?? true;
      const retryable = (err as any).retryable ?? (/timeout|econnrefused|econnreset|etimedout|429|503/i.test(`${code || ''} ${err.message}`));

      let causeStr: string | undefined = undefined;
      if (err.cause) {
        if (err.cause instanceof Error) {
          causeStr = `${err.cause.name}: ${this.sanitizeString(err.cause.message)}`;
        } else if (typeof err.cause === 'string') {
          causeStr = this.sanitizeString(err.cause);
        } else {
          try {
            causeStr = JSON.stringify(this.sanitize(err.cause));
          } catch {
            causeStr = String(err.cause);
          }
        }
      }

      return {
        name: err.name || 'Error',
        message: this.sanitizeString(err.message),
        code: code ? String(code) : undefined,
        stack: err.stack ? this.sanitizeString(err.stack, 4096) : undefined,
        cause: causeStr,
        isOperational,
        retryable
      };
    }

    if (typeof err === 'object') {
      const msg = (err as any).message || (err as any).error || JSON.stringify(this.sanitize(err));
      return {
        name: (err as any).name || 'CustomObjectError',
        message: this.sanitizeString(String(msg)),
        code: (err as any).code ? String((err as any).code) : undefined
      };
    }

    return {
      name: 'PrimitiveError',
      message: this.sanitizeString(String(err))
    };
  }

  /**
   * Sanitizes prompt text to record metadata and safe excerpt by default
   */
  static summarizePrompt(prompt: string, maxLength = 300): { summary: string; length: number; hash: string } {
    if (!prompt) return { summary: '', length: 0, hash: '' };
    const crypto = require('node:crypto');
    const hash = crypto.createHash('sha256').update(prompt).digest('hex').slice(0, 12);
    const sanitized = this.sanitizeString(prompt.slice(0, maxLength));
    return {
      summary: sanitized + (prompt.length > maxLength ? `... [Total ${prompt.length} chars]` : ''),
      length: prompt.length,
      hash
    };
  }
}
