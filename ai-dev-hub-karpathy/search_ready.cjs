const fs = require('fs');
const path = require('path');

const asarPath = 'C:\\Users\\Deco\\AppData\\Local\\Programs\\antigravity\\resources\\app.asar';
const mainJsPath = path.join(asarPath, 'dist', 'main.js');

try {
  const content = fs.readFileSync(mainJsPath, 'utf-8');
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('whenReady') || line.includes('app.on(\'ready\'') || line.includes('startLanguageServer') || line.includes('createWindow')) {
      console.log(`Line ${i + 1}: ${line.slice(0, 160)}`);
    }
  }
} catch (e) {
  console.log('Error:', e.message);
}
