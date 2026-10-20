#!/usr/bin/env node
/**
 * AI DEV HUB — Antigravity Safety Gate Hook
 * Evaluates PreToolUse against the Deterministic Policy Engine.
 */

const RED_PATTERNS = [
  /\b(?:drop\s+database|rmdir\s+\/s|rm\s+-rf\s+(?:\/|\*|--no-preserve-root)|del\s+\/s\s+\/q)\b/i,
  /\bgit\s+push\s+(?:--force|-f|(?:origin\s+)?(?:main|master|prod|production)\s+--force)\b/i,
  /\b(?:vercel\s+--prod|netlify\s+deploy\s+--prod|aws\s+s3\s+sync\b.*--delete.*prod|terraform\s+apply\s+-auto-approve)\b/i,
  /\b(?:stripe\s+charges\s+create|checkout_session|billing\s+override)\b/i,
  /(?:--api[-_]?key|--secret[-_]?key|--private[-_]?key|--password|credentials\.json|\.env\.production)\b/i,
  /\b(?:route53\s+change-resource-record-sets|cloudflare\s+dns\s+delete)\b/i
];

const ORANGE_PATTERNS = [
  /\b(?:alter\s+table\b.*\bdrop\s+column|migrate\s+down|prisma\s+migrate\s+reset)\b/i,
  /\b(?:git\s+push\s+(?:origin\s+)?(?:main|master|prod|production))\b/i,
  /\b(?:npm|pnpm|yarn|bun)\s+(?:install|add|i)\s+.*\b(?:openai|anthropic|replicate|elevenlabs|aws-sdk|@google\/genai)\b/i,
  /\b(?:terraform\s+apply|remove\s+feature|deprecate\s+requirement)\b/i
];

let inputData = '';
process.stdin.setEncoding('utf-8');

process.stdin.on('data', chunk => {
  inputData += chunk;
});

function extractCommand(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const args = payload.toolCall?.args || payload.tool_input || payload.input || payload.args || {};
  return String(
    args.CommandLine ||
    args.command ||
    args.cmd ||
    args.script ||
    payload.command ||
    ''
  ).trim();
}

process.stdin.on('end', () => {
  try {
    if (!inputData.trim()) {
      process.stdout.write(JSON.stringify({ decision: 'allow' }));
      return;
    }

    const payload = JSON.parse(inputData);
    const cmd = extractCommand(payload);

    if (!cmd) {
      process.stdout.write(JSON.stringify({ decision: 'allow' }));
      return;
    }

    // Check RED
    for (const p of RED_PATTERNS) {
      if (p.test(cmd)) {
        process.stdout.write(JSON.stringify({
          decision: 'deny',
          reason: `[AI DEV HUB SECURITY RED] Operação estritamente bloqueada pela política de segurança: "${cmd.slice(0, 80)}"`
        }));
        return;
      }
    }

    // Check ORANGE
    for (const p of ORANGE_PATTERNS) {
      if (p.test(cmd)) {
        process.stdout.write(JSON.stringify({
          decision: 'ask',
          reason: `[AI DEV HUB SECURITY ORANGE] Requer autorização manual na Approval Inbox: "${cmd.slice(0, 80)}"`
        }));
        return;
      }
    }

    // GREEN / YELLOW allow
    process.stdout.write(JSON.stringify({ decision: 'allow' }));
  } catch (err) {
    // Fail-safe: solicita confirmação manual se o payload for corrompido/inválido
    process.stdout.write(JSON.stringify({
      decision: 'ask',
      reason: `[AI DEV HUB SECURITY] Não foi possível validar o payload do comando (${err.message}). Confirme manualmente.`
    }));
  }
});