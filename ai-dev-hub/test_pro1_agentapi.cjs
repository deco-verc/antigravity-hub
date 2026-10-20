const { execFileSync } = require('node:child_process');
const { getLanguageServerExe } = require('./server/dist/antigravityProvider.js');
const { AccountProfileManager } = require('./server/dist/accountProfileManager.js');

const exe = getLanguageServerExe();
const p1 = AccountProfileManager.getProfile('acc-pro-1');
console.log('Perfil Pro 1:', p1);

const env1 = AccountProfileManager.getExecutionEnvForProfile(p1);
console.log('Ambiente resolvido para Pro 1:', {
  ANTIGRAVITY_LS_ADDRESS: env1.ANTIGRAVITY_LS_ADDRESS,
  ANTIGRAVITY_CSRF_TOKEN: env1.ANTIGRAVITY_CSRF_TOKEN ? 'TOKEN_PRESENTE' : 'AUSENTE',
  USERPROFILE: env1.USERPROFILE
});

console.log('Testando chamada agentapi real no perfil Google Pro 1:');
try {
  const out = execFileSync(exe, ['agentapi', 'new-conversation', '--model=flash_lite', '--title=Teste Pro 1 Autenticado', 'Responda OK'], {
    encoding: 'utf-8',
    env: env1,
    timeout: 30000
  });

  console.log('Resultado agentapi no Pro 1:');
  const parsed = JSON.parse(out);
  console.log(JSON.stringify(parsed, null, 2));
} catch (err) {
  console.error('Erro no teste agentapi Pro 1:', err.message);
  if (err.stdout) console.log('stdout:', err.stdout.toString());
  if (err.stderr) console.log('stderr:', err.stderr.toString());
}
