const fs = require('fs');
const path = require('path');

const asarPath = 'C:\\Users\\Deco\\AppData\\Local\\Programs\\antigravity\\resources\\app.asar';
const mainJsPath = path.join(asarPath, 'dist', 'main.js');

try {
  const content = fs.readFileSync(mainJsPath, 'utf-8');
  console.log('main.js length:', content.length);
  // Search for singleInstance, createWindow, BrowserWindow, user-data-dir, etc.
  const lines = content.split(/\r?\n/);
  console.log('Total lines:', lines.length);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('requestSingleInstanceLock') || line.includes('BrowserWindow') || line.includes('createWindow') || line.includes('second-instance') || line.includes('user-data-dir')) {
      console.log(`Line ${i + 1}: ${line.slice(0, 200)}`);
    }
  }
} catch (e) {
  console.log('Error reading main.js:', e.message);
}
