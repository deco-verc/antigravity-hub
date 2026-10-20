const fs = require('fs');
const path = require('path');

const asarPath = 'C:\\Users\\Deco\\AppData\\Local\\Programs\\antigravity\\resources\\app.asar';
console.log('Asar exists:', fs.existsSync(asarPath));

// In Node, we can check if fs can read inside app.asar (if Electron) or extract it
try {
  const pkg = fs.readFileSync(path.join(asarPath, 'package.json'), 'utf-8');
  console.log('package.json:\n', pkg);
} catch (e) {
  console.log('Error reading package.json:', e.message);
}
