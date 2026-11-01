import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

describe('Desktop ServiceManager & Port Recovery Suite', () => {
  test('1. ServiceManager pode ser instanciado e possui métodos de recuperação de porta', () => {
    const { ServiceManager } = require(path.join(rootDir, 'desktop', 'serviceManager.cjs'));
    const sm = new ServiceManager({ backendPort: 3001 });
    assert.ok(sm, 'ServiceManager deve ser instanciado');
    assert.strictEqual(typeof sm.killProcessOnPort, 'function');
    assert.strictEqual(typeof sm.isPortTaken, 'function');
    assert.strictEqual(typeof sm.findAvailablePort, 'function');
    assert.strictEqual(sm.backendPort, 3001);
  });

  test('2. isPortTaken detecta portas ocupadas e liberadas com precisão', async () => {
    const { ServiceManager } = require(path.join(rootDir, 'desktop', 'serviceManager.cjs'));
    const sm = new ServiceManager();

    // Encontra uma porta livre para o teste
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as net.AddressInfo).port;

    // Deve detectar que a porta está ocupada
    const taken = await sm.isPortTaken(port);
    assert.strictEqual(taken, true, `Porta ${port} deve ser reportada como ocupada`);

    // Fecha o servidor
    await new Promise<void>((resolve) => server.close(() => resolve()));

    // Deve detectar que a porta foi liberada
    const released = await sm.isPortTaken(port);
    assert.strictEqual(released, false, `Porta ${port} deve ser reportada como livre`);
  });

  test('3. findAvailablePort localiza a próxima porta livre sequencialmente', async () => {
    const { ServiceManager } = require(path.join(rootDir, 'desktop', 'serviceManager.cjs'));
    const sm = new ServiceManager();

    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as net.AddressInfo).port;

    const available = await sm.findAvailablePort(port);
    assert.ok(available > port, `Porta disponível (${available}) deve ser maior que a ocupada (${port})`);

    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  test('4. Iniciardecohub.bat possui caminho canônico e chamada taskkill /F nativa sem process.kill silencioso', () => {
    const batPath = path.join(rootDir, 'Iniciardecohub.bat');
    assert.ok(fs.existsSync(batPath), 'Iniciardecohub.bat deve existir na raiz');
    const content = fs.readFileSync(batPath, 'utf8');

    // Valida que o caminho DECOHUB_DIR não tem o erro de duplicação IA\IA
    assert.ok(content.includes('set "DECOHUB_DIR=C:\\IA\\Antigravity HUB\\ai-dev-hub"'), 'DECOHUB_DIR deve apontar para o caminho correto sem duplicidade');
    assert.ok(!content.includes('C:\\IA\\IA\\Antigravity HUB'), 'Não deve conter o caminho duplicado C:\\IA\\IA\\...');

    // Valida que não usa process.kill SIGKILL no Windows na limpeza da porta 3001
    assert.ok(!content.includes("process.kill(+p,'SIGKILL')"), 'Não deve usar process.kill(pid, SIGKILL) ineficaz no Windows');
    assert.ok(content.includes("execFileSync('taskkill',['/F','/PID'"), 'Deve utilizar execFileSync taskkill com /F e /PID no Windows');
  });

  test('5. serviceManager.cjs utiliza taskkill nativo forçado com /F, /PID e /T e timeout de 3000ms', () => {
    const smPath = path.join(rootDir, 'desktop', 'serviceManager.cjs');
    const content = fs.readFileSync(smPath, 'utf8');

    assert.ok(content.includes("execFileSync('taskkill', ['/F', '/PID', String(pid), '/T'], { stdio: 'ignore', timeout: 3000"), 'Deve invocar taskkill com /F, /PID, /T e timeout 3000ms');
    assert.ok(content.includes('server/dist/index.js não encontrado'), 'Deve conter verificação e compilação rápida de emergência');
    assert.ok(content.includes('npmCmd, [\'--prefix\', targetServerDir, \'run\', \'build\']'), 'Deve executar npm.cmd --prefix server run build');
    assert.ok(content.includes('findAvailablePort(this.backendPort + 1)'), 'Deve conter fallback dinâmico de porta');
  });

  test('6. decohub_unpacked/desktop/serviceManager.cjs está sincronizado com desktop/serviceManager.cjs', () => {
    const canonicalPath = path.join(rootDir, 'desktop', 'serviceManager.cjs');
    const unpackedPath = path.join(rootDir, 'decohub_unpacked', 'desktop', 'serviceManager.cjs');

    if (fs.existsSync(unpackedPath)) {
      const canonicalContent = fs.readFileSync(canonicalPath, 'utf8');
      const unpackedContent = fs.readFileSync(unpackedPath, 'utf8');
      assert.strictEqual(canonicalContent, unpackedContent, 'serviceManager.cjs em decohub_unpacked deve estar idêntico ao canônico');
    }
  });
});
