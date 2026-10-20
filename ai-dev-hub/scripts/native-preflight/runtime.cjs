'use strict';
const path = require('node:path');
const { SafetyError } = require('./ledger.cjs');
const normalize = p => path.win32.normalize(p).replace(/[\\/]+$/, '').toLowerCase();
function extractUserData(command) {
  const matches = [...String(command).matchAll(/(?:^|\s)(?:"--user-data-dir=([^"]+)"|--user-data-dir(?:=|\s+)(?:"([^"]+)"|([^\s"]+)))/gi)];
  if (matches.length > 1) throw new SafetyError('AMBIGUOUS_USER_DATA_FLAGS');
  return matches.length ? matches[0][1] || matches[0][2] || matches[0][3] : null;
}
function selectRuntime(profilePath, defaultPath, processes) {
  const expected = normalize(profilePath) === normalize(defaultPath) ? normalize(defaultPath) : normalize(path.win32.join(profilePath,'AppData','Roaming','Antigravity'));
  const mains = processes.filter(p => p.name.toLowerCase() === 'antigravity.exe' && !processes.some(parent => parent.pid === p.parentPid && parent.name.toLowerCase() === 'antigravity.exe'));
  const matches = [];
  for (const main of mains) {
    const effective = main.userDataDir ? normalize(main.userDataDir) : normalize(defaultPath);
    if (effective !== expected) continue;
    for (const ls of processes.filter(p => p.name.toLowerCase() === 'language_server.exe' && p.parentPid === main.pid)) matches.push({ ...ls, mainPid:main.pid,userDataDir:effective });
  }
  if (matches.length > 1) throw new SafetyError('MULTIPLE_RUNTIMES_FOR_PROFILE');
  return matches[0] || null;
}
function assertStableRuntime(expected, current) {
  if (!current || expected.pid !== current.pid || expected.mainPid !== current.mainPid || expected.started !== current.started || expected.userDataDir !== current.userDataDir) throw new SafetyError('RUNTIME_CHANGED_REVERIFICATION_REQUIRED');
}
module.exports = { extractUserData,selectRuntime,assertStableRuntime,normalize };
