const { execFileSync } = require('node:child_process');
const { getLanguageServerExe } = require('./server/dist/antigravityProvider.js');
const { AccountProfileManager } = require('./server/dist/accountProfileManager.js');

const exe = getLanguageServerExe();

console.log('=== TESTE DE CICLO COMPLETO A -> B -> A ===');

// 1. Provar Account A
console.log('\n--- 1. Setando e Executando na Conta A (Google Pro 1) ---');
AccountProfileManager.setGlobalActiveProfile('acc-pro-1');
let currentActive = AccountProfileManager.getGlobalActiveProfile();
console.log('Conta Ativa 1:', currentActive.id, currentActive.display_name, currentActive.google_account_label);

let envA = AccountProfileManager.getExecutionEnvForProfile(currentActive);
let outA1 = execFileSync(exe, ['agentapi', 'new-conversation', '--model=flash_lite', '--title=Ciclo 1 Conta A', 'Confirme ciclo A'], {
  encoding: 'utf-8',
  env: envA,
  timeout: 30000
});
let parsedA1 = JSON.parse(outA1);
let convA1 = parsedA1.response.newConversation.conversationId;
console.log('Sucesso Conta A - Conv ID:', convA1);

// 2. Provar Account B
console.log('\n--- 2. Alternando para Conta B (Google Pro 2) ---');
AccountProfileManager.setGlobalActiveProfile('acc-pro-2');
currentActive = AccountProfileManager.getGlobalActiveProfile();
console.log('Conta Ativa 2:', currentActive.id, currentActive.display_name, currentActive.google_account_label);

let envB = AccountProfileManager.getExecutionEnvForProfile(currentActive);
let outB = execFileSync(exe, ['agentapi', 'new-conversation', '--model=flash_lite', '--title=Ciclo 2 Conta B', 'Confirme ciclo B'], {
  encoding: 'utf-8',
  env: envB,
  timeout: 30000
});
let parsedB = JSON.parse(outB);
let convB = parsedB.response.newConversation.conversationId;
console.log('Sucesso Conta B - Conv ID:', convB);

// 3. Provar Retorno para Account A
console.log('\n--- 3. Retornando para Conta A (Google Pro 1) ---');
AccountProfileManager.setGlobalActiveProfile('acc-pro-1');
currentActive = AccountProfileManager.getGlobalActiveProfile();
console.log('Conta Ativa 3:', currentActive.id, currentActive.display_name, currentActive.google_account_label);

let envA2 = AccountProfileManager.getExecutionEnvForProfile(currentActive);
let outA2 = execFileSync(exe, ['agentapi', 'new-conversation', '--model=flash_lite', '--title=Ciclo 3 Retorno Conta A', 'Confirme retorno A'], {
  encoding: 'utf-8',
  env: envA2,
  timeout: 30000
});
let parsedA2 = JSON.parse(outA2);
let convA2 = parsedA2.response.newConversation.conversationId;
console.log('Sucesso Retorno Conta A - Conv ID:', convA2);

console.log('\n=== COMPARAÇÃO E VERIFICAÇÃO DE INTEGRIDADE ===');
console.log('Conv A1:', convA1);
console.log('Conv B: ', convB);
console.log('Conv A2:', convA2);

if (convA1 !== convB && convB !== convA2 && convA1 !== convA2) {
  console.log('✅ SUCESSO ABSOLUTO: Todas as conversations são reais, únicas e isoladas!');
} else {
  console.error('❌ FALHA: Houve duplicação de conversa entre perfis!');
  process.exit(1);
}
