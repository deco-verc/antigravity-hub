const { execSync } = require('child_process');

try {
  const out = execSync('powershell.exe -NoProfile -Command "Get-Process -Id 10764 | Select-Object Id, ProcessName, MainWindowTitle, MainWindowHandle | Format-List"', { encoding: 'utf-8' });
  console.log(out);
} catch (e) {
  console.log('Error:', e.message);
}
