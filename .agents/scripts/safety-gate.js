#!/usr/bin/env node
/**
 * AI DEV HUB — Antigravity Safety Gate Hook
 * Evaluates PreToolUse against the Deterministic Policy Engine.
 */

const RED_PATTERNS = [
  /(?:drop\s+database|rmdir\s+\/s|rm\s+-rf\s+[\/\*]|del\s+\/s\s+\/q)/i,
  /(?:git\s+push\s+(?:origin\s+)?(?:main|master|prod|production)|git\s+push\s+--force)/i,
  /(?:vercel\s+--prod|netlify\s+deploy\s+--prod|aws\s+s3\s+sync.*prod|terraform\s+apply)/i,
  /(?:stripe|payment|credit_card|buy|purchase|checkout_session|checkout_api|billing)/i,
  /(?:api_key|secret_key|private_key|token|password|credentials\.json|\.env\.production)/i,
  /(?:route53|cloudflare\s+dns|dns\s+record|nameserver)/i
];

const ORANGE_PATTERNS = [
  /(?:alter\s+table.*drop\s+column|migrate\s+down|prisma\s+migrate\s+reset)/i,
  /(?:switch\s+framework|rewrite\s+in\s+vue|rewrite\s+in\s+angular)/i,
  /(?:openai|anthropic|replicate|elevenlabs|aws-sdk|@google\/genai).*install/i,
  /(?:remove\s+feature|deprecate\s+requirement)/i
];

let inputData = '';
process.stdin.setEncoding('utf-8');

process.stdin.on('data', chunk => {
  inputData += chunk;
});

process.stdin.on('end', () => {
  try {
    const payload = JSON.parse(inputData || '{}');
    const toolCall = payload.toolCall || {};
    const cmd = toolCall.args?.CommandLine || '';

    // Check RED
    for (const p of RED_PATTERNS) {
      if (p.test(cmd)) {
        const response = {
          decision: 'deny',
          reason: `[AI DEV HUB SECURITY RED] Operação estritamente bloqueada pela política de segurança: "${cmd.slice(0, 80)}"`
        };
        process.stdout.write(JSON.stringify(response));
        return;
      }
    }

    // Check ORANGE
    for (const p of ORANGE_PATTERNS) {
      if (p.test(cmd)) {
        const response = {
          decision: 'ask',
          reason: `[AI DEV HUB SECURITY ORANGE] Requer autorização manual na Approval Inbox: "${cmd.slice(0, 80)}"`
        };
        process.stdout.write(JSON.stringify(response));
        return;
      }
    }

    // GREEN / YELLOW allow
    const response = {
      decision: 'allow'
    };
    process.stdout.write(JSON.stringify(response));
  } catch (err) {
    // Fallback safe allow if payload wasn't parsed
    process.stdout.write(JSON.stringify({ decision: 'allow' }));
  }
});
