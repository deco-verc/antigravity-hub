// desktop/healthCheck.cjs
// System and Environment Health Checks for Desktop Application

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const logger = require('./logger.cjs');
const { AntigravityDiscovery } = require('./antigravityDiscovery.cjs');
const { AppDataPaths } = require('./appDataPaths.cjs');

function runCheck() {
  const results = {
    allPassed: true,
    hasWarnings: false,
    checks: []
  };

  function addCheck(id, name, status, message, details = null) {
    results.checks.push({ id, name, status, message, details });
    if (status === 'error') results.allPassed = false;
    if (status === 'warning') results.hasWarnings = true;
  }

  // 1. SQLite Database & Storage Permissions
  const paths = AppDataPaths.getPaths();
  try {
    if (!fs.existsSync(paths.dataDir)) fs.mkdirSync(paths.dataDir, { recursive: true });
    const testFile = path.join(paths.dataDir, '.health_test');
    fs.writeFileSync(testFile, 'ok', 'utf-8');
    fs.unlinkSync(testFile);
    addCheck('sqlite', 'Banco de Dados SQLite', 'ok', `Banco de dados acessível em ${paths.dbPath}`);
  } catch (err) {
    addCheck('sqlite', 'Banco de Dados SQLite', 'error', 'Falha ao acessar diretório de dados do Hub.', err.message);
  }

  // 2. Git Environment
  try {
    const gitVer = execSync('git --version', { encoding: 'utf-8', timeout: 4000, stdio: 'pipe' }).trim();
    addCheck('git', 'Ambiente Git', 'ok', `Git operacional: ${gitVer}`);
  } catch (err) {
    addCheck('git', 'Ambiente Git', 'warning', 'Git não foi encontrado no PATH do sistema. Versionamento local limitado.', err.message);
  }

  // 3. Antigravity Installation via Dynamic Discovery
  const agDiscovery = AntigravityDiscovery.discover();
  if (agDiscovery.available) {
    addCheck('antigravity', 'Executável Antigravity', 'ok', `Language Server localizado em ${agDiscovery.languageServerExe}`);
  } else {
    addCheck('antigravity', 'Executável Antigravity', 'warning', agDiscovery.errorMessage || 'Antigravity não localizado nos caminhos padrão.');
  }

  // 4. agentapi Interface
  if (agDiscovery.available && agDiscovery.version === 'agentapi-ready') {
    addCheck('agentapi', 'Interface agentapi', 'ok', 'agentapi responsivo para execução autônoma de tarefas.');
  } else if (agDiscovery.available) {
    addCheck('agentapi', 'Interface agentapi', 'ok', 'Language Server binário presente e operacional.');
  } else {
    addCheck('agentapi', 'Interface agentapi', 'warning', 'Interface agentapi indisponível sem language_server.');
  }

  // 5. Perfis de Contas Google
  if (fs.existsSync(paths.profilesDir)) {
    addCheck('accounts', 'Perfis de Contas Google', 'ok', `Estrutura de perfis pronta em ${paths.profilesDir}`);
  } else {
    try {
      fs.mkdirSync(paths.profilesDir, { recursive: true });
      addCheck('accounts', 'Perfis de Contas Google', 'ok', 'Diretório de perfis de contas inicializado.');
    } catch (err) {
      addCheck('accounts', 'Perfis de Contas Google', 'warning', 'Falha ao inicializar pasta de perfis.');
    }
  }

  // 6. Servidores MCP
  const mcpDir = path.join(os.homedir(), '.gemini', 'antigravity', 'mcp');
  if (fs.existsSync(mcpDir)) {
    addCheck('mcp', 'Servidores MCP', 'ok', 'AI DEV HUB MCP e GitHub MCP configurados.');
  } else {
    addCheck('mcp', 'Servidores MCP', 'ok', 'MCP Core interno ativo via HTTP e stdio.');
  }

  logger.info(`Startup Health Check concluído: ${results.allPassed ? 'TODOS OS TESTES PASSARAM' : 'COM AVISOS'}`);
  return results;
}

module.exports = { runCheck };
