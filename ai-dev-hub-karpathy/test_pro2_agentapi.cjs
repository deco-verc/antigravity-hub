const { execFileSync } = require('node:child_process');
const { getLanguageServerExe } = require('./server/dist/antigravityProvider.js');
const { AccountProfileManager } = require('./server/dist/accountProfileManager.js');

const exe = getLanguageServerExe();
const p2 = AccountProfileManager.getProfile('acc-pro-2');
console.log('Perfil Pro 2:', p2);

const env2 = AccountProfileManager.getExecutionEnvForProfile(p2);
console.log('Ambiente resolvido para Pro 2:', {
  ANTIGRAVITY_LS_ADDRESS: env2.ANTIGRAVITY_LS_ADDRESS,
  ANTIGRAVITY_CSRF_TOKEN: env2.ANTIGRAVITY_CSRF_TOKEN ? 'TOKEN_PRESENTE' : 'AUSENTE',
  USERPROFILE: env2.USERPROFILE
});

console.log('Testando chamada agentapi real no perfil Google Pro 2:');
try {
  const out = execFileSync(exe, ['agentapi', 'new-conversation', '--model=flash_lite', '--title=Teste Pro 2 Autenticado', 'Responda OK'], {
    encoding: 'utf-8',
    env: env2,
    timeout: 30000
  });

  console.log('Resultado agentapi no Pro 2:');
  const parsed = JSON.parse(out);
  console.log(JSON.stringify(parsed, null, 2));
} catch (err) {
  console.error('Erro no teste agentapi Pro 2:', err.message);
  if (err.stdout) console.log('stdout:', err.stdout.toString());
  if (err.stderr) console.log('stderr:', err.stderr.toString());
}
