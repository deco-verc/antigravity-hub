import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export interface RuntimeProcessSnapshot {
  pid: number;
  parentPid: number;
  name: string;
  executable: string | null;
  started: string;
  userDataDir?: string | null;
  userDataFlagCount?: number;
}

export interface ProfileRuntimeBinding {
  pid: number;
  parentPid: number;
  started: string;
  parentStarted: string;
  executable: string;
  parentExecutable: string;
  userDataDir: string;
}

export class RuntimeProfileSelectionError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

export function collectRuntimeProcessSnapshot(): RuntimeProcessSnapshot[] {
  const script = `
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
  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    timeout: 8000,
    windowsHide: true
  }).trim();

  if (!output) return [];
  const parsed = JSON.parse(output);
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object' && Number.isInteger((parsed as any).pid)) {
    return [parsed as RuntimeProcessSnapshot];
  }
  throw new RuntimeProfileSelectionError('RUNTIME_PROCESS_INVENTORY_INVALID');
}

export function normalizeRuntimePath(value: string): string {
  if (!path.win32.isAbsolute(value)) throw new RuntimeProfileSelectionError('RUNTIME_PATH_NOT_ABSOLUTE');
  let resolved = value;
  if (fs.existsSync(value)) {
    try {
      resolved = fs.realpathSync.native(value);
    } catch {
      resolved = value;
    }
  }
  resolved = resolved.replace(/^\\\\\?\\UNC\\/i, '\\\\').replace(/^\\\\\?\\/, '');
  const normalized = path.win32.normalize(resolved);
  const root = path.win32.parse(normalized).root;
  return (normalized.length > root.length ? normalized.replace(/[\\/]+$/, '') : normalized).toLowerCase();
}

export function profileUserDataDirectory(profilePath: string, defaultPath: string): string {
  const normProfile = normalizeRuntimePath(profilePath);
  const normDefault = normalizeRuntimePath(defaultPath);
  if (normProfile === normDefault) {
    return normDefault;
  }
  const roamingSuffix = path.win32.join('appdata', 'roaming', 'antigravity').toLowerCase();
  if (normProfile.endsWith(roamingSuffix) || normProfile.endsWith('\\' + roamingSuffix)) {
    return normProfile;
  }
  const userDataSuffix = '\\userdata';
  if (normProfile.endsWith(userDataSuffix)) {
    if (fs.existsSync(normProfile)) {
      return normProfile;
    }
    const parentProfile = path.win32.dirname(normProfile);
    const parentRoaming = path.win32.join(parentProfile, 'AppData', 'Roaming', 'Antigravity');
    if (fs.existsSync(parentRoaming)) {
      return normalizeRuntimePath(parentRoaming);
    }
    return normProfile;
  }

  const roamingPath = path.win32.join(profilePath, 'AppData', 'Roaming', 'Antigravity');
  const userDataPath = path.win32.join(profilePath, 'userData');

  if (fs.existsSync(userDataPath) && !fs.existsSync(roamingPath)) {
    return normalizeRuntimePath(userDataPath);
  }
  if (fs.existsSync(roamingPath)) {
    return normalizeRuntimePath(roamingPath);
  }

  return normalizeRuntimePath(roamingPath);
}

/** Safe metadata only. No login files, credentials, ports or historical auth states. */
export function selectProfileRuntime(options: {
  profilePath: string;
  defaultPath: string;
  appExecutable: string;
  languageServerExecutable: string;
  processes: RuntimeProcessSnapshot[];
}): ProfileRuntimeBinding | null {
  const expectedData = profileUserDataDirectory(options.profilePath, options.defaultPath);
  const normProfileRoot = normalizeRuntimePath(options.profilePath);
  const alternateLegacyUserData =
    normProfileRoot !== normalizeRuntimePath(options.defaultPath)
      ? normalizeRuntimePath(path.win32.join(options.profilePath, 'userData'))
      : expectedData;
  const roamingUserData =
    normProfileRoot !== normalizeRuntimePath(options.defaultPath)
      ? normalizeRuntimePath(path.win32.join(options.profilePath, 'AppData', 'Roaming', 'Antigravity'))
      : expectedData;

  const expectedApp = normalizeRuntimePath(options.appExecutable);
  const expectedLs = normalizeRuntimePath(options.languageServerExecutable);
  const processes = options.processes;
  const ids = new Set<number>();

  for (const p of processes) {
    if (!Number.isInteger(p.pid) || p.pid <= 0 || ids.has(p.pid)) {
      throw new RuntimeProfileSelectionError('RUNTIME_PROCESS_INVENTORY_AMBIGUOUS');
    }
    ids.add(p.pid);
  }

  const mains = processes.filter(
    p =>
      p.name.toLowerCase() === 'antigravity.exe' &&
      !processes.some(parent => parent.pid === p.parentPid && parent.name.toLowerCase() === 'antigravity.exe')
  );

  const owners = mains.filter(p => {
    if (!p.executable || normalizeRuntimePath(p.executable) !== expectedApp) return false;
    const flagCount = p.userDataFlagCount ?? (p.userDataDir ? 1 : 0);
    if (flagCount > 1 || (flagCount === 1 && !p.userDataDir)) {
      throw new RuntimeProfileSelectionError('RUNTIME_USER_DATA_ARGUMENT_AMBIGUOUS');
    }
    const effectiveData = p.userDataDir
      ? normalizeRuntimePath(p.userDataDir)
      : normalizeRuntimePath(options.defaultPath);

    if (
      effectiveData === expectedData ||
      effectiveData === alternateLegacyUserData ||
      effectiveData === roamingUserData ||
      effectiveData === normalizeRuntimePath(path.win32.join(options.profilePath, 'AppData', 'Roaming', 'Antigravity')) ||
      effectiveData === normalizeRuntimePath(path.win32.join(options.profilePath, 'userData'))
    ) {
      return true;
    }
    if (p.userDataDir) {
      const resolved = profileUserDataDirectory(p.userDataDir, options.defaultPath);
      if (resolved === expectedData || resolved === alternateLegacyUserData || resolved === roamingUserData) {
        return true;
      }
    }
    return false;
  });

  if (owners.length > 1) throw new RuntimeProfileSelectionError('RUNTIME_MULTIPLE_GUI_OWNERS');
  if (!owners.length) return null;

  const owner = owners[0];
  const children = processes.filter(
    p =>
      (p.name.toLowerCase() === 'language_server.exe' ||
        p.name.toLowerCase() === 'language_server_windows_x64.exe') &&
      p.parentPid === owner.pid
  );

  // Do not silently select the first responsive child when multiple children claim this profile.
  if (children.length > 1) throw new RuntimeProfileSelectionError('RUNTIME_MULTIPLE_LANGUAGE_SERVERS');
  if (!children.length) return null;

  const child = children[0];
  if (!child.executable || normalizeRuntimePath(child.executable) !== expectedLs) {
    throw new RuntimeProfileSelectionError('RUNTIME_LANGUAGE_SERVER_EXECUTABLE_MISMATCH');
  }
  if (
    !Number.isFinite(Date.parse(owner.started)) ||
    !Number.isFinite(Date.parse(child.started)) ||
    Date.parse(child.started) < Date.parse(owner.started)
  ) {
    throw new RuntimeProfileSelectionError('RUNTIME_PROCESS_START_INVALID');
  }

  return {
    pid: child.pid,
    parentPid: owner.pid,
    started: child.started,
    parentStarted: owner.started,
    executable: normalizeRuntimePath(child.executable),
    parentExecutable: normalizeRuntimePath(owner.executable!),
    userDataDir: owner.userDataDir ? normalizeRuntimePath(owner.userDataDir) : expectedData
  };
}