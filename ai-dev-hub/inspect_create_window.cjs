const fs = require('fs');
const path = require('path');

const asarPath = 'C:\\Users\\Deco\\AppData\\Local\\Programs\\antigravity\\resources\\app.asar';
const utilsJsPath = path.join(asarPath, 'dist', 'utils.js');

try {
  const content = fs.readFileSync(utilsJsPath, 'utf-8');
  console.log('utils.js length:', content.length);
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('function createWindow') || line.includes('new electron_1.BrowserWindow') || line.includes('show:') || line.includes('win.show()')) {
      console.log(`Line ${i + 1}: ${line}`);
    }
  }
} catch (e) {
  console.log('Error:', e.message);
}
