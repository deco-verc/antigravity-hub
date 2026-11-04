import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { planVerification, executeVerification, executeVerificationAsync } from '../src/controlledVerification.js';

test('Controlled Verification Suite — Deterministic Execution & Safety Isolation', async (t) => {
  const tmpRoot = path.join(os.tmpdir(), `decohub-controlled-verif-${Date.now()}`);
  fs.mkdirSync(tmpRoot, { recursive: true });

  const pkgJson = {
    name: 'test-project',
    version: '1.0.0',
    scripts: {
      test: 'node --test test/sample.test.js',
      typecheck: 'tsc --noEmit'
    }
  };
  fs.writeFileSync(path.join(tmpRoot, 'package.json'), JSON.stringify(pkgJson, null, 2));

  const testDir = path.join(tmpRoot, 'test');
  fs.mkdirSync(testDir, { recursive: true });
  fs.writeFileSync(path.join(testDir, 'sample.test.js'), `
    const test = require('node:test');
    const assert = require('node:assert/strict');
    test('sample passing test', () => {
      assert.equal(1 + 1, 2);
    });
  `);

  t.after(() => {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {}
  });

  await t.test('1. planVerification: planeja comandos permitidos de forma determinística', () => {
    // 1.1 node --test
    const opNodeTest = planVerification('node --test test/sample.test.js', tmpRoot);
    assert.equal(opNodeTest.kind, 'test');
    assert.equal(opNodeTest.cwd, path.resolve(tmpRoot));
    assert.ok(opNodeTest.args.includes('--test'));
    assert.ok(opNodeTest.args.some(a => a.includes('sample.test.js')));

    // 1.2 tsc --noEmit
    const opTsc = planVerification('tsc --noEmit', tmpRoot);
    assert.equal(opTsc.kind, 'typecheck');
    assert.ok(opTsc.args.includes('--noEmit'));

    // 1.3 node -e code
    const opNodeEval = planVerification('node -e "console.log(123)"', tmpRoot);
    assert.equal(opNodeEval.kind, 'test');
    assert.ok(opNodeEval.args.includes('-e'));
  });

  await t.test('2. planVerification: bloqueia operadores perigosos e tentativas de escape', () => {
    // Bloqueia encadeamento shell (&&, ;, |)
    assert.throws(
      () => planVerification('npm test && rm -rf /', tmpRoot),
      /composição de shell|COMMAND_REVIEW_REQUIRED/i
    );

    assert.throws(
      () => planVerification('node script.js; echo pwned', tmpRoot),
      /composição de shell|COMMAND_REVIEW_REQUIRED/i
    );

    // Bloqueia caminhos fora do projeto
    assert.throws(
      () => planVerification('node ../outside.js', tmpRoot),
      /caminho fora do projeto|COMMAND_REVIEW_REQUIRED/i
    );
  });

  await t.test('3. executeVerification: executa com sucesso determinístico (exit code 0)', () => {
    fs.writeFileSync(path.join(tmpRoot, 'pass.js'), 'console.log("PASS_VERIFIED"); process.exit(0);');
    const output = executeVerification('node pass.js', tmpRoot);
    assert.ok(output.includes('PASS_VERIFIED'));
  });

  await t.test('4. executeVerification: lança erro controlado quando comando falha (exit code != 0)', () => {
    fs.writeFileSync(path.join(tmpRoot, 'fail.js'), 'console.error("FAIL_INTENTIONAL"); process.exit(1);');
    assert.throws(
      () => executeVerification('node fail.js', tmpRoot),
      (err: any) => {
        return err && err.status === 1;
      }
    );
  });

  await t.test('5. executeVerificationAsync: executa de forma assíncrona com determinismo', async () => {
    fs.writeFileSync(path.join(tmpRoot, 'async-pass.js'), 'console.log("ASYNC_PASS"); process.exit(0);');
    const output = await executeVerificationAsync('node async-pass.js', tmpRoot);
    assert.ok(output.includes('ASYNC_PASS'));
  });
});
