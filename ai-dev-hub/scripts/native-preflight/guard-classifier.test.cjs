'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  isValidReadOnlyInventoryQuery,
  isDirectAgent,
  isAgent,
  isPowerShellExecutable
} = require('./guard.cjs');

const evidenceScript = path.join(__dirname, 'runtime-evidence.ps1');

test('Regressão 1: Consulta legítima de processos contendo o texto language_server.exe deve PASSAR', () => {
  // Query 1: collectRuntimeProcessSnapshot from runtimeProfileSelector.ts
  const collectSnapshotScript = `
    $ErrorActionPreference = 'Stop';
    $procs = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('Antigravity.exe','language_server.exe') });
    $safe = @($procs | ForEach-Object {
      $dir = $null; $count = 0;
      if ($_.Name -eq 'Antigravity.exe') {
        $count = [regex]::Matches($_.CommandLine, '(?:^|\\s)"?--user-data-dir(?==|\\s|"|$)').Count;
        $match = [regex]::Match($_.CommandLine, '(?:^|\\s)(?:"--user-data-dir=([^"]+)"|--user-data-dir(?:=|\\s+)(?:"([^"]+)"|([^\\s"]+)))(?=$|\\s)');
        if ($match.Success) { foreach ($g in 1..3) { if ($match.Groups[$g].Success) { $dir = $match.Groups[$g].Value; break } } }
      }
      [PSCustomObject]@{ pid=$_.ProcessId; parentPid=$_.ParentProcessId; name=$_.Name; executable=$_.ExecutablePath;
        started=$_.CreationDate.ToString('o'); userDataDir=$dir; userDataFlagCount=$count }
    });
    ConvertTo-Json -InputObject $safe -Compress
  `;
  assert.equal(
    isValidReadOnlyInventoryQuery('powershell.exe', ['-NoProfile', '-Command', collectSnapshotScript], 'execFileSync', evidenceScript),
    true,
    'collectRuntimeProcessSnapshot deve ser aprovada'
  );

  // Query 2: getRunningInstanceForProfile from accountProfileManager.ts
  const getRunningInstanceScript = `
    $ErrorActionPreference = 'Stop';
    $p = Get-CimInstance Win32_Process -Filter 'ProcessId = 19616';
    $parent = Get-CimInstance Win32_Process -Filter 'ProcessId = 20896';
    if (!$p -or !$parent -or $p.ParentProcessId -ne 20896) { throw 'RUNTIME_CHANGED' };
    if ($p.CreationDate.ToString('o') -cne '2026-10-08T23:51:00.9227840-03:00' -or
        $parent.CreationDate.ToString('o') -cne '2026-10-08T23:51:00.9227840-03:00') { throw 'RUNTIME_CHANGED' };
    $ports = @(Get-NetTCPConnection -OwningProcess $p.ProcessId -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LocalPort -Unique);
    $port = if ($ports.Count) { ($ports | Measure-Object -Maximum).Maximum } else { $null };
    $match = [regex]::Match($p.CommandLine, '--csrf_token\\s+([a-zA-Z0-9\\-]+)');
    [PSCustomObject]@{pid=$p.ProcessId; parentPid=$p.ParentProcessId; started=$p.CreationDate.ToString('o');
      parentStarted=$parent.CreationDate.ToString('o'); port=$port; csrfToken=if($match.Success){$match.Groups[1].Value}else{$null}} | ConvertTo-Json -Compress
  `;
  assert.equal(
    isValidReadOnlyInventoryQuery('powershell.exe', ['-NoProfile', '-Command', getRunningInstanceScript], 'execFileSync', evidenceScript),
    true,
    'getRunningInstanceForProfile deve ser aprovada'
  );

  // Query 3: runtime-evidence.ps1
  assert.equal(
    isValidReadOnlyInventoryQuery('powershell.exe', ['-NoProfile', '-File', evidenceScript], 'execFileSync', evidenceScript),
    true,
    'runtime-evidence.ps1 deve ser aprovada'
  );

  // Funciona com pwsh e com caminho completo
  assert.equal(
    isValidReadOnlyInventoryQuery('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', ['-NoProfile', '-Command', collectSnapshotScript], 'execFileSync', evidenceScript),
    true,
    'powershell com caminho completo deve ser aprovada'
  );
  assert.equal(
    isValidReadOnlyInventoryQuery('pwsh.exe', ['-NoProfile', '-Command', collectSnapshotScript], 'execFileSync', evidenceScript),
    true,
    'pwsh deve ser aprovada'
  );
});

test('Regressão 2: Tentativa direta de executar language_server.exe deve ser BLOQUEADA', () => {
  const directPath = 'C:\\Users\\Deco\\AppData\\Local\\Programs\\antigravity\\resources\\bin\\language_server.exe';
  assert.equal(isDirectAgent(directPath), true, 'language_server.exe deve ser classificado como direct agent');
  assert.equal(isAgent(directPath, ['run']), true, 'invocação de language_server.exe deve ser classificada como isAgent');

  // Não passa como consulta de inventário
  assert.equal(
    isValidReadOnlyInventoryQuery(directPath, ['run'], 'execFileSync', evidenceScript),
    false,
    'language_server.exe direto NÃO é consulta de inventário'
  );
  assert.equal(
    isValidReadOnlyInventoryQuery('language_server.exe', ['--help'], 'execFileSync', evidenceScript),
    false,
    'language_server.exe --help NÃO é consulta PowerShell'
  );
});

test('Regressão 3: PowerShell com comandos adicionais/perigosos deve ser BLOQUEADO', () => {
  const dangerousCommands = [
    'Get-CimInstance Win32_Process; Start-Process notepad.exe',
    'Get-CimInstance Win32_Process; saps calc.exe',
    'Get-CimInstance Win32_Process; start calc.exe',
    'Get-CimInstance Win32_Process; Invoke-Expression "Write-Host test"',
    'Get-CimInstance Win32_Process; iex "Write-Host test"',
    'Get-CimInstance Win32_Process; Invoke-Command -ScriptBlock { dir }',
    'Get-CimInstance Win32_Process; icm -ScriptBlock { dir }',
    'Get-CimInstance Win32_Process; Start-Job -ScriptBlock { dir }',
    'Get-CimInstance Win32_Process; Invoke-Item "c:\\test.txt"',
    'Get-CimInstance Win32_Process; ii "c:\\test.txt"',
    'Get-CimInstance Win32_Process; [System.Diagnostics.Process]::Start("calc.exe")',
    'Get-CimInstance Win32_Process; New-Object System.Net.WebClient',
    'Get-CimInstance Win32_Process; Add-Type -TypeDefinition "public class X {}"',
    'Get-CimInstance Win32_Process; [scriptblock]::Create("dir").Invoke()',
    'Get-CimInstance Win32_Process; cmd.exe /c dir',
    'Get-CimInstance Win32_Process; bash -c ls',
    'Get-CimInstance Win32_Process; wscript.exe script.vbs',
    'Get-CimInstance Win32_Process; Invoke-WebRequest http://127.0.0.1:9999',
    'Get-CimInstance Win32_Process; iwr http://127.0.0.1:9999',
    'Get-CimInstance Win32_Process; Invoke-RestMethod http://127.0.0.1:9999',
    'Get-CimInstance Win32_Process; irm http://127.0.0.1:9999',
    'Get-CimInstance Win32_Process; Set-Content -Path test.txt -Value "hack"',
    'Get-CimInstance Win32_Process | Out-File evil.txt',
    'Get-CimInstance Win32_Process; Add-Content evil.txt "data"',
    'Get-CimInstance Win32_Process; Remove-Item test.txt',
    'Get-CimInstance Win32_Process; del test.txt',
    'Get-CimInstance Win32_Process; New-Item -ItemType File test.txt',
    'Get-CimInstance Win32_Process; Copy-Item a.txt b.txt',
    'Get-CimInstance Win32_Process; Move-Item a.txt b.txt',
    'Get-CimInstance Win32_Process; Set-Variable -Name X -Value 1',
    'Get-CimInstance Win32_Process; Set-Item Env:EVIL "val"'
  ];

  for (const cmd of dangerousCommands) {
    assert.equal(
      isValidReadOnlyInventoryQuery('powershell.exe', ['-NoProfile', '-Command', cmd], 'execFileSync', evidenceScript),
      false,
      `Comando perigoso deve ser bloqueado: ${cmd}`
    );
  }
});

test('Regressão 4: Argumentos malformados de PowerShell devem ser BLOQUEADOS', () => {
  const validScript = 'Get-CimInstance Win32_Process';
  // Sem -NoProfile
  assert.equal(
    isValidReadOnlyInventoryQuery('powershell.exe', ['-Command', validScript], 'execFileSync', evidenceScript),
    false,
    'Falta de -NoProfile deve ser rejeitada'
  );
  // Mais de 3 argumentos
  assert.equal(
    isValidReadOnlyInventoryQuery('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', validScript], 'execFileSync', evidenceScript),
    false,
    'Argumentos adicionais devem ser rejeitados'
  );
  // Menos de 3 argumentos
  assert.equal(
    isValidReadOnlyInventoryQuery('powershell.exe', ['-NoProfile'], 'execFileSync', evidenceScript),
    false,
    'Menos de 3 argumentos deve ser rejeitado'
  );
  // Argumento 1 não é -Command nem -File
  assert.equal(
    isValidReadOnlyInventoryQuery('powershell.exe', ['-NoProfile', '-EncodedCommand', 'AAA='], 'execFileSync', evidenceScript),
    false,
    '-EncodedCommand deve ser rejeitado'
  );
  // Arquivo ps1 diferente de runtime-evidence.ps1
  assert.equal(
    isValidReadOnlyInventoryQuery('powershell.exe', ['-NoProfile', '-File', 'C:\\temp\\evil.ps1'], 'execFileSync', evidenceScript),
    false,
    'Script ps1 arbitrário deve ser rejeitado'
  );
  // Método inválido (spawn, exec, fork)
  assert.equal(
    isValidReadOnlyInventoryQuery('powershell.exe', ['-NoProfile', '-Command', validScript], 'spawn', evidenceScript),
    false,
    'Método spawn deve ser rejeitado'
  );
  assert.equal(
    isValidReadOnlyInventoryQuery('powershell.exe', ['-NoProfile', '-Command', validScript], 'exec', evidenceScript),
    false,
    'Método exec deve ser rejeitado'
  );
  // Args não-array
  assert.equal(
    isValidReadOnlyInventoryQuery('powershell.exe', null, 'execFileSync', evidenceScript),
    false,
    'Args nulo deve ser rejeitado'
  );
});

test('Regressão 5: Executáveis inesperados mencionando agente devem ser BLOQUEADOS', () => {
  assert.equal(
    isAgent('cmd.exe', ['/c', 'language_server.exe']),
    true,
    'cmd.exe com language_server.exe em args é detectado como agente'
  );
  assert.equal(
    isValidReadOnlyInventoryQuery('cmd.exe', ['/c', 'Get-CimInstance Win32_Process'], 'execFileSync', evidenceScript),
    false,
    'cmd.exe não é PowerShell'
  );
  assert.equal(
    isPowerShellExecutable('cmd.exe'),
    false,
    'cmd.exe não é executável PowerShell'
  );
  assert.equal(
    isAgent('git.exe', ['log']),
    false,
    'git log não menciona agente'
  );
  assert.equal(
    isAgent('git.exe', ['checkout', 'language_server.exe']),
    true,
    'git com language_server nos argumentos é interceptado para verificação'
  );
});

test('Regressão 6: Tentativas de contornar validação devem ser BLOQUEADAS', () => {
  const bypassAttempts = [
    // Operador de chamada &
    'Get-CimInstance Win32_Process; & "language_server.exe"',
    'Get-CimInstance Win32_Process; & language_server.exe',
    'Get-CimInstance Win32_Process ; & "evil.exe"',
    // Dot-sourcing .
    'Get-CimInstance Win32_Process; . "language_server.exe"',
    'Get-CimInstance Win32_Process; . evil.ps1',
    // Redirecionamento > e >>
    'Get-CimInstance Win32_Process > out.txt',
    'Get-CimInstance Win32_Process >> out.txt',
    // Identificador language_server fora de aspas
    'Get-CimInstance Win32_Process; language_server',
    'Get-CimInstance Win32_Process; antigravity',
    'Get-CimInstance Win32_Process; agy',
    'Get-CimInstance Win32_Process; agentapi',
    // Pipeline para executável perigoso
    'Get-CimInstance Win32_Process | Start-Process',
    // Quebras de linha e concatenação
    "Get-CimInstance Win32_Process\nStart-Process calc",
    "Get-CimInstance Win32_Process;iex('dir')"
  ];

  for (const script of bypassAttempts) {
    assert.equal(
      isValidReadOnlyInventoryQuery('powershell.exe', ['-NoProfile', '-Command', script], 'execFileSync', evidenceScript),
      false,
      `Tentativa de bypass deve ser bloqueada: ${JSON.stringify(script)}`
    );
  }
});

test('Regressão 7: Persistência do limite absoluto de duas conversas no ledger', () => {
  const { DatabaseSync } = require('node:sqlite');
  const controlDb = new DatabaseSync('C:/IA/DecoHUB-native-sandbox-20261009/control/control.sqlite');
  
  // Confirma que existem exatamente 2 sessões registradas no ledger
  const creations = controlDb.prepare('SELECT role, operation_id, model, conversation_id, status FROM creations').all();
  assert.equal(creations.length, 2, 'Exatamente 2 sessões registradas (Supervisor e Worker)');
  
  const sup = creations.find(c => c.role === 'SUPERVISOR');
  const worker = creations.find(c => c.role === 'WORKER');
  assert.ok(sup, 'Supervisor deve existir');
  assert.ok(worker, 'Worker deve existir');
  assert.equal(sup.status, 'CONFIRMED');
  assert.equal(worker.status, 'CONFIRMED');
  assert.equal(sup.conversation_id, '5489a5ca-40ad-431a-bbd7-f9dcea2b28e5');
  assert.equal(worker.conversation_id, 'd4cbb8f9-a415-4693-876c-2105fc517212');

  // Trigger do SQLite impede remoção de sessões
  assert.throws(() => {
    controlDb.prepare("DELETE FROM creations WHERE role = 'SUPERVISOR'").run();
  }, /PERMANENT_RESERVATION/, 'Trigger de integridade do SQLite deve impedir remoção de sessões');

  // Trigger impede atualização de campos protegidos
  assert.throws(() => {
    controlDb.prepare("UPDATE creations SET model = 'gpt-4' WHERE role = 'SUPERVISOR'").run();
  }, /PRESERVE_CONFIRMED_CREATIONS/, 'Trigger deve impedir alteração de metadados protegidos');

  controlDb.close();
});
