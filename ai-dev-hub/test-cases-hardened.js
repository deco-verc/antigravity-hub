import fs from 'node:fs';
import path from 'node:path';
import { ProjectAnalyzer } from './server/src/analyzer.ts';
import { SecurityManager } from './server/src/security.ts';
import { SystemManager } from './server/src/systemManager.ts';
import { GitManager } from './server/src/gitManager.ts';
import { db } from './server/src/db.ts';

const TEST_BASE = 'C:\\IA\\test-projects';

const results = [];

function assert(condition, message) {
  if (condition) {
    results.push({ pass: true, message });
    console.log(`  ✓ [PASS] ${message}`);
  } else {
    results.push({ pass: false, message });
    console.log(`  ❌ [FAIL] ${message}`);
  }
}

async function runErrorTests() {
  console.log('====================================================');
  console.log('🛡️ INICIANDO TESTES DE CASOS REAIS DE ERRO & HARDENING');
  console.log('====================================================\n');

  // ---------------------------------------------------------------
  // CASO A: Pasta Inexistente
  // ---------------------------------------------------------------
  console.log('👉 [CASO A] Testando pasta inexistente: C:\\esta-pasta-nao-existe');
  const valNonExistent = SecurityManager.validateProjectFolder('C:\\esta-pasta-nao-existe');
  assert(!valNonExistent.isValid, 'SecurityManager rejeita caminho inexistente');
  assert(!valNonExistent.exists, 'SecurityManager reporta exists = false');
  assert(valNonExistent.errorMessage.includes('A pasta não existe'), 'Mensagem de erro clara para pasta inexistente');

  try {
    ProjectAnalyzer.analyze('C:\\esta-pasta-nao-existe');
    assert(false, 'ProjectAnalyzer deveria lançar erro para pasta inexistente');
  } catch (err) {
    assert(err.message.includes('A pasta não existe'), 'ProjectAnalyzer lança exceção tratável para pasta inexistente');
  }

  // Path Traversal Security Test
  console.log('\n👉 [SEGURANÇA] Testando path traversal e caminhos maliciosos');
  const valRoot = SecurityManager.validateProjectFolder('C:\\');
  assert(!valRoot.isValid, 'Rejeita registrar a raiz da unidade C:\\ diretamente');
  assert(valRoot.errorMessage.includes('raiz da unidade'), 'Explica que raiz de disco não é permitida');

  try {
    SecurityManager.sanitizeMemoryFilename('../../Windows/System32/cmd.exe');
    assert(false, 'Deveria bloquear acesso fora de .ai-dev-hub/');
  } catch (err) {
    assert(err.message.includes('não autorizado'), 'Bloqueia traversal em arquivos de memória');
  }

  // ---------------------------------------------------------------
  // CASO B: Pasta Vazia
  // ---------------------------------------------------------------
  console.log('\n👉 [CASO B] Testando pasta vazia');
  const emptyDir = path.join(TEST_BASE, 'empty-test-dir');
  if (!fs.existsSync(emptyDir)) fs.mkdirSync(emptyDir, { recursive: true });

  const valEmpty = SecurityManager.validateProjectFolder(emptyDir);
  assert(valEmpty.isValid && valEmpty.isEmpty, 'Identifica pasta vazia');

  const emptyAnalysis = ProjectAnalyzer.analyze(emptyDir);
  assert(emptyAnalysis.isEmpty === true, 'ProjectAnalyzer sinaliza isEmpty = true');
  assert(emptyAnalysis.primaryStack === 'Pasta Vazia', 'Define stack amigável para pasta vazia');
  assert(emptyAnalysis.hasGit === false, 'Git não inicializado em pasta vazia');

  // ---------------------------------------------------------------
  // CASO C: Projeto sem Git
  // ---------------------------------------------------------------
  console.log('\n👉 [CASO C] Testando projeto sem repositório Git');
  const noGitDir = path.join(TEST_BASE, 'no-git-project');
  if (!fs.existsSync(noGitDir)) fs.mkdirSync(noGitDir, { recursive: true });
  fs.writeFileSync(path.join(noGitDir, 'package.json'), JSON.stringify({ name: 'no-git-app', dependencies: { svelte: '^4.0.0' } }));

  const noGitAnalysis = ProjectAnalyzer.analyze(noGitDir);
  assert(noGitAnalysis.hasGit === false, 'Detecta ausência de Git sem erro');
  assert(noGitAnalysis.detectedStack.includes('Svelte'), 'Detecta stack Svelte mesmo sem Git');
  assert(noGitAnalysis.gitInfo.statusSummary.total === 0, 'Git status summary seguro com zeros');

  // ---------------------------------------------------------------
  // CASO D: Projeto com Git
  // ---------------------------------------------------------------
  console.log('\n👉 [CASO D] Testando projeto com Git (AI Voice Studio)');
  const voiceDir = path.join(TEST_BASE, 'ai-voice-studio');
  const gitAnalysis = ProjectAnalyzer.analyze(voiceDir);
  assert(gitAnalysis.hasGit === true, 'Detecta repositório Git ativo');
  assert(gitAnalysis.gitInfo.branch === 'master', `Branch correto detectado: ${gitAnalysis.gitInfo.branch}`);
  assert(gitAnalysis.gitInfo.lastCommit !== null, 'Último commit lido com sucesso');
  assert(gitAnalysis.detectedStack.includes('React'), 'Detecta stack React');

  // ---------------------------------------------------------------
  // CASO E: Projeto Muito Grande (Ignora node_modules, .venv, etc.)
  // ---------------------------------------------------------------
  console.log('\n👉 [CASO E] Testando projeto grande (ignorando node_modules e .venv)');
  const bigDir = path.join(TEST_BASE, 'huge-project');
  const mockNodeModules = path.join(bigDir, 'node_modules', 'huge-lib');
  const mockVenv = path.join(bigDir, '.venv', 'lib');
  fs.mkdirSync(mockNodeModules, { recursive: true });
  fs.mkdirSync(mockVenv, { recursive: true });

  // Create 50 dummy files in node_modules
  for (let i = 0; i < 50; i++) {
    fs.writeFileSync(path.join(mockNodeModules, `dummy_${i}.js`), 'console.log("ignore me");');
  }

  // Root project files
  fs.writeFileSync(path.join(bigDir, 'package.json'), JSON.stringify({
    name: 'huge-app',
    dependencies: { next: '^14.0.0', react: '^18.0.0', redis: '^4.0.0' }
  }));
  fs.writeFileSync(path.join(bigDir, 'Dockerfile'), 'FROM node:20');

  const startScan = Date.now();
  const bigAnalysis = ProjectAnalyzer.analyze(bigDir);
  const scanDuration = Date.now() - startScan;

  assert(scanDuration < 1000, `Análise de pasta grande ultra-rápida (${scanDuration}ms)`);
  assert(!bigAnalysis.fileTree.some(f => f.includes('node_modules')), 'node_modules estritamente ausente da árvore');
  assert(!bigAnalysis.fileTree.some(f => f.includes('.venv')), '.venv estritamente ausente da árvore');
  assert(bigAnalysis.detectedStack.includes('Next.js'), 'Detecta Next.js');
  assert(bigAnalysis.detectedStack.includes('Redis'), 'Detecta Redis');
  assert(bigAnalysis.detectedStack.includes('Docker'), 'Detecta Docker');

  // ---------------------------------------------------------------
  // CASO H: Projeto Removido do Disco após Cadastrado
  // ---------------------------------------------------------------
  console.log('\n👉 [CASO H] Testando projeto removido do disco após cadastrado');
  const deletedDir = path.join(TEST_BASE, 'temp-delete-me');
  if (!fs.existsSync(deletedDir)) fs.mkdirSync(deletedDir, { recursive: true });

  // Register in DB
  const tempId = 'test-deleted-proj-' + Date.now();
  db.prepare(`
    INSERT INTO projects (id, name, path, objective, description, stack, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
  `).run(tempId, 'Temp Delete Project', deletedDir, 'Test', 'Test', 'Node', new Date().toISOString(), new Date().toISOString());

  // Physically delete folder from disk
  fs.rmdirSync(deletedDir);

  // Check how server responds
  const resProj = db.prepare('SELECT * FROM projects WHERE id = ?').get(tempId);
  const isAvailable = fs.existsSync(resProj.path);
  assert(!isAvailable, 'Detecta que a pasta foi fisicamente deletada do disco');

  // Clean up test DB row
  db.prepare('DELETE FROM projects WHERE id = ?').run(tempId);

  // ---------------------------------------------------------------
  // Resumo Final
  // ---------------------------------------------------------------
  console.log('\n====================================================');
  console.log('📊 RESUMO DOS TESTES DE HARDENING:');
  const passedCount = results.filter(r => r.pass).length;
  console.log(`Total de testes: ${results.length}`);
  console.log(`Aprovados: ${passedCount}`);
  console.log(`Falhas: ${results.length - passedCount}`);
  console.log('====================================================');

  if (passedCount === results.length) {
    console.log('✨ TODOS OS TESTES DE CASOS DE ERRO E HARDENING PASSARAM COM SUCESSO!');
  } else {
    process.exit(1);
  }
}

runErrorTests().catch(err => {
  console.error('Erro inesperado no teste:', err);
  process.exit(1);
});
