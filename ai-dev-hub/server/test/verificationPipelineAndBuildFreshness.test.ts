import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {
  validateVerificationCommand,
  normalizeOrRecoverVerificationCommand,
  resolveVerificationCommand,
  isTestFileName,
  hasAnyTestFilesOnDisk
} from '../src/verificationCommand.js';
import { planVerification } from '../src/controlledVerification.js';
import { UserExperienceSimulator } from '../src/userExperienceSimulator.js';
import { IndependentEvaluator } from '../src/independentEvaluator.js';
import { SecurityPentestSimulator } from '../src/securityPentestSimulator.js';

test('Verification Pipeline & Build Freshness Suite', async (t) => {
  const tmpRoot = path.join(os.tmpdir(), `decohub-verif-freshness-test-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`);
  fs.mkdirSync(tmpRoot, { recursive: true });

  t.after(() => {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {}
  });

  await t.test('1. validateVerificationCommand aceita scripts compostos com && no package.json', () => {
    const projDir = path.join(tmpRoot, 'proj-compound');
    fs.mkdirSync(projDir, { recursive: true });
    fs.mkdirSync(path.join(projDir, 'test'), { recursive: true });
    fs.writeFileSync(path.join(projDir, 'test', 'sample.test.js'), '// test\n');

    fs.writeFileSync(
      path.join(projDir, 'package.json'),
      JSON.stringify({
        name: 'compound-test',
        scripts: {
          build: 'tsc --noEmit',
          test: 'npm run build && node --test'
        }
      })
    );

    const validation = validateVerificationCommand('npm test', projDir, { allowUncreatedFiles: false });
    assert.strictEqual(validation.valid, true, 'npm test com npm run build && node --test deve ser considerado válido');
  });

  await t.test('2. validateVerificationCommand aceita node com flag --import tsx para testes TypeScript', () => {
    const projDir = path.join(tmpRoot, 'proj-tsx');
    fs.mkdirSync(projDir, { recursive: true });
    fs.mkdirSync(path.join(projDir, 'test'), { recursive: true });
    fs.writeFileSync(path.join(projDir, 'test', 'app.test.ts'), '// test ts\n');

    fs.writeFileSync(
      path.join(projDir, 'package.json'),
      JSON.stringify({
        name: 'tsx-test',
        scripts: {
          test: 'node --import tsx --test'
        }
      })
    );

    const validation = validateVerificationCommand('npm test', projDir, { allowUncreatedFiles: false });
    assert.strictEqual(validation.valid, true, 'node --import tsx --test deve ser validado com sucesso');
  });

  await t.test('3. normalizeOrRecoverVerificationCommand preserva npm test canônico se definido em package.json', () => {
    const projDir = path.join(tmpRoot, 'proj-preserve');
    fs.mkdirSync(projDir, { recursive: true });
    fs.mkdirSync(path.join(projDir, 'test'), { recursive: true });
    fs.writeFileSync(path.join(projDir, 'test', 'math.test.js'), '// math test\n');

    fs.writeFileSync(
      path.join(projDir, 'package.json'),
      JSON.stringify({
        name: 'preserve-test',
        scripts: {
          build: 'tsc',
          test: 'npm run build && node --test'
        }
      })
    );

    const result = normalizeOrRecoverVerificationCommand('npm test', projDir, {
      allowUncreatedFiles: false,
      requireCanonicalEvidenceOnDisk: true
    });

    assert.strictEqual(result.command, 'npm test', 'O comando não deve ser degradado para node --test');
    assert.strictEqual(result.validInitially, true, 'Deve ser considerado válido inicialmente');
    assert.strictEqual(result.recovered, false, 'Não deve ser marcado como recuperado');
  });

  await t.test('4. normalizeOrRecoverVerificationCommand auto-promove comando trivial para npm test quando presente', () => {
    const projDir = path.join(tmpRoot, 'proj-autopromote');
    fs.mkdirSync(projDir, { recursive: true });
    fs.mkdirSync(path.join(projDir, 'test'), { recursive: true });
    fs.writeFileSync(path.join(projDir, 'test', 'index.test.js'), '// test\n');

    fs.writeFileSync(
      path.join(projDir, 'package.json'),
      JSON.stringify({
        name: 'autopromote-test',
        scripts: {
          test: 'npm run build && node --test'
        }
      })
    );

    const result = normalizeOrRecoverVerificationCommand('node -e "process.exit(0)"', projDir, {
      allowUncreatedFiles: false,
      requireCanonicalEvidenceOnDisk: true
    });

    assert.strictEqual(result.command, 'npm test', 'Comando trivial deve ser auto-promovido para npm test');
    assert.strictEqual(result.recovered, true, 'Deve ser registrado como recuperado');
  });

  await t.test('5. UserExperienceSimulator.findFreePort aloca estritamente dentro da faixa PORT_GUARD (4100-4899)', async () => {
    const port = await UserExperienceSimulator.findFreePort();
    assert.ok(port >= 4100 && port <= 4899, `A porta ${port} deve estar entre 4100 e 4899`);

    const portWithFallback = await UserExperienceSimulator.findFreePort(9999);
    assert.ok(portWithFallback >= 4100 && portWithFallback <= 4899, `Mesmo com fallback inválido, a porta ${portWithFallback} deve estar na faixa segura`);
  });

  await t.test('6. resolveVerificationCommand expande comando bare "node --test" com --import tsx quando há testes .ts', () => {
    const projDir = path.join(tmpRoot, 'proj-bare-ts');
    fs.mkdirSync(path.join(projDir, 'test'), { recursive: true });
    fs.writeFileSync(path.join(projDir, 'test', 'breakdown.test.ts'), '// endpoint test\n');

    const resolved = resolveVerificationCommand('node --test', projDir);
    assert.ok(resolved.includes('--import tsx'), 'Deve incluir --import tsx para carregar testes TypeScript');
    assert.ok(resolved.includes('breakdown.test.ts'), 'Deve enumerar o arquivo de teste TypeScript');
  });

  await t.test('7. resolveVerificationCommand injeta --import tsx quando arquivo .ts é especificado diretamente', () => {
    const projDir = path.join(tmpRoot, 'proj-direct-ts');
    fs.mkdirSync(path.join(projDir, 'test'), { recursive: true });
    fs.writeFileSync(path.join(projDir, 'test', 'analyze.test.ts'), '// analyze test\n');

    const resolved = resolveVerificationCommand('node --test test/analyze.test.ts', projDir);
    assert.strictEqual(resolved, 'node --import tsx --test test/analyze.test.ts', 'Deve injetar --import tsx antes de --test');
  });

  await t.test('8. validateVerificationCommand aceita comandos npx tsc e npx tsx', () => {
    const projDir = path.join(tmpRoot, 'proj-npx');
    fs.mkdirSync(projDir, { recursive: true });

    const valTsc = validateVerificationCommand('npx tsc --noEmit', projDir, { allowUncreatedFiles: true });
    assert.strictEqual(valTsc.valid, true, 'npx tsc --noEmit deve ser considerado válido');

    const valTsx = validateVerificationCommand('npx tsx --test test/app.test.ts', projDir, { allowUncreatedFiles: true });
    assert.strictEqual(valTsx.valid, true, 'npx tsx --test deve ser considerado válido');
  });

  await t.test('9. planVerification aceita e planeja comando "node --import tsx --test" com isolamento seguro', () => {
    const projDir = path.join(tmpRoot, 'proj-plan-tsx');
    fs.mkdirSync(path.join(projDir, 'test'), { recursive: true });
    fs.writeFileSync(path.join(projDir, 'test', 'unit.test.ts'), '// unit\n');

    const plan = planVerification('node --import tsx --test test/unit.test.ts', projDir);
    assert.strictEqual(plan.kind, 'test');
    assert.ok(plan.args.includes('--import'));
    assert.ok(plan.args.includes('tsx'));
    assert.ok(plan.args.includes('--test'));
    assert.ok(plan.args.some(a => a.includes('unit.test.ts')));
  });

  await t.test('10. planVerification aceita e planeja comando "npx tsc --noEmit" como typecheck', () => {
    const projDir = path.join(tmpRoot, 'proj-plan-tsc');
    fs.mkdirSync(projDir, { recursive: true });

    const plan = planVerification('npx tsc --noEmit', projDir);
    assert.strictEqual(plan.kind, 'typecheck');
    assert.ok(plan.args.includes('--noEmit'));
  });

  await t.test('11. isTestFileName e hasAnyTestFilesOnDisk reconhecem arquivos de teste por convenção padrão', () => {
    // Convenções dentro de diretório de testes
    assert.strictEqual(isTestFileName('persistence.js', true), true);
    assert.strictEqual(isTestFileName('server.ts', true), true);
    assert.strictEqual(isTestFileName('api.test.js', true), true);
    assert.strictEqual(isTestFileName('finance_test.mjs', true), true);
    assert.strictEqual(isTestFileName('fixture.js', true), false, 'helpers/fixtures devem ser ignorados');
    assert.strictEqual(isTestFileName('testSetup.ts', true), false, 'testSetup deve ser ignorado');

    // Convenções fora de diretório de testes
    assert.strictEqual(isTestFileName('persistence.js', false), false);
    assert.strictEqual(isTestFileName('persistence.test.js', false), true);
    assert.strictEqual(isTestFileName('persistence_test.ts', false), true);
    assert.strictEqual(isTestFileName('test.js', false), true);
    assert.strictEqual(isTestFileName('tests.ts', false), true);

    const projDir = path.join(tmpRoot, 'proj-has-test-files');
    fs.mkdirSync(path.join(projDir, 'test'), { recursive: true });
    fs.writeFileSync(path.join(projDir, 'test', 'persistence.js'), '// test code\n');
    assert.strictEqual(hasAnyTestFilesOnDisk(projDir), true);
  });

  await t.test('12. resolveVerificationCommand expande bare node --test quando há arquivos como test/persistence.js', () => {
    const projDir = path.join(tmpRoot, 'proj-resolve-persistence');
    fs.mkdirSync(path.join(projDir, 'test'), { recursive: true });
    fs.writeFileSync(path.join(projDir, 'test', 'persistence.js'), '// test code\n');

    const resolved = resolveVerificationCommand('node --test', projDir);
    assert.strictEqual(resolved, 'node --test "test/persistence.js"');
  });

  await t.test('13. normalizeOrRecoverVerificationCommand auto-promove comando trivial para node --test com test/persistence.js', () => {
    const projDir = path.join(tmpRoot, 'proj-recover-persistence');
    fs.mkdirSync(path.join(projDir, 'test'), { recursive: true });
    fs.writeFileSync(path.join(projDir, 'test', 'persistence.js'), '// test code\n');

    const res = normalizeOrRecoverVerificationCommand('node -e "process.exit(0)"', projDir, {
      allowUncreatedFiles: false,
      requireCanonicalEvidenceOnDisk: true
    });
    assert.strictEqual(res.command, 'node --test');
    assert.strictEqual(res.recovered, true);
  });

  await t.test('14. SecurityPentestSimulator não acusa falso-positivo com guards canônicos de path traversal', async () => {
    const projDir = path.join(tmpRoot, 'proj-safe-traversal');
    fs.mkdirSync(path.join(projDir, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(projDir, 'src', 'server.js'),
      `const fs = require('fs');
const path = require('path');
const staticDir = path.join(__dirname, '../public');

function serveStatic(req, res) {
  const pathname = req.url;
  const safePath = path.normalize(path.join(staticDir, pathname));
  if (!safePath.startsWith(staticDir) || req.url.includes('..')) {
    return res.writeHead(403).end();
  }
  return fs.readFileSync(safePath);
}`
    );

    const oldEnv = process.env.DECOHUB_OFFLINE_MODE;
    process.env.DECOHUB_OFFLINE_MODE = 'true';
    try {
      const pentest = await SecurityPentestSimulator.runAutonomousPentest({
        projectPath: projDir,
        forceLiveAttack: false
      });
      const traversal = pentest.vulnerabilities.filter(v => v.vector === 'PATH_TRAVERSAL');
      assert.strictEqual(traversal.length, 0, 'Servidor com guard de path traversal não deve gerar vulnerabilidade');
    } finally {
      process.env.DECOHUB_OFFLINE_MODE = oldEnv;
    }
  });

  await t.test('15. validateVisualAcceptance e validatePersistenceAcceptance suportam express.static, streams e estruturas aninhadas', () => {
    const projDir = path.join(tmpRoot, 'proj-vis-persist-adv');
    fs.mkdirSync(path.join(projDir, 'client', 'src', 'views'), { recursive: true });
    fs.mkdirSync(path.join(projDir, 'server', 'src'), { recursive: true });

    // Componente visual em nível profundo de diretório
    fs.writeFileSync(
      path.join(projDir, 'client', 'src', 'views', 'Dashboard.tsx'),
      'export function Dashboard() { return <div id="dashboard"><h1>Painel</h1></div>; }'
    );

    // Servidor com persistência via createWriteStream
    fs.writeFileSync(
      path.join(projDir, 'server', 'src', 'storage.ts'),
      'import fs from "fs"; export function saveLog(msg: string) { const stream = fs.createWriteStream("audit.log", { flags: "a" }); stream.write(msg); }'
    );

    const vis = IndependentEvaluator.validateVisualAcceptance(projDir);
    assert.strictEqual(vis.hasVisualUi, true);
    assert.ok(vis.matchedFiles.some(f => f.includes('Dashboard.tsx')));

    const persist = IndependentEvaluator.validatePersistenceAcceptance(projDir);
    assert.strictEqual(persist.hasPersistence, true);
    assert.ok(persist.matchedFiles.some(f => f.includes('storage.ts')));
  });
});
