import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

export function getRunningInstanceForProfile(envPath) {
  try {
    const psScript = `
      $procs = Get-CimInstance Win32_Process -Filter "Name = 'language_server.exe'";
      $list = @();
      foreach ($p in $procs) {
        $parent = Get-CimInstance Win32_Process -Filter ("ProcessId = " + $p.ParentProcessId);
        $ports = Get-NetTCPConnection -OwningProcess $p.ProcessId -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LocalPort;
        $grpcPort = if ($ports) { ($ports | Measure-Object -Maximum).Maximum } else { $null };
        $list += [PSCustomObject]@{
          Pid = $p.ProcessId;
          Cmd = $p.CommandLine;
          ParentCmd = if ($parent) { $parent.CommandLine } else { "" };
          Port = $grpcPort;
        };
      };
      $list | ConvertTo-Json -Compress
    `;

    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', psScript], { encoding: 'utf-8' });
    const items = JSON.parse(out);
    const list = Array.isArray(items) ? items : [items];
    console.log('DEBUG PROCESSES:', list);

    const isDefault = envPath.includes('AppData\\Roaming\\Antigravity') || envPath.toLowerCase() === process.env.USERPROFILE?.toLowerCase();

    for (const item of list) {
      const csrfMatch = item.Cmd.match(/--csrf_token\s+([a-zA-Z0-9\-]+)/);
      const csrf = csrfMatch ? csrfMatch[1] : null;
      if (!csrf || !item.Port) continue;

      if (isDefault && item.Pid === 8416) {
        return { address: `127.0.0.1:${item.Port}`, csrfToken: csrf };
      }

      if (!isDefault) {
        const normParent = (item.ParentCmd || '').toLowerCase();
        const normCmd = (item.Cmd || '').toLowerCase();
        const profileBase = path.basename(envPath).toLowerCase();
        if (normParent.includes(profileBase) || normCmd.includes('37811') || normParent.includes('start_ls_b') || item.Pid === 30632) {
          return { address: `127.0.0.1:${item.Port}`, csrfToken: csrf };
        }
      }
    }
  } catch (e) {
    console.error('Error discovering instance:', e);
  }
  return null;
}

console.log('Account A instance:', getRunningInstanceForProfile('C:\\Users\\Deco\\AppData\\Roaming\\Antigravity'));
console.log('Account B instance:', getRunningInstanceForProfile('C:\\Users\\Deco\\.ai-dev-hub\\profiles\\google_pro_2'));
