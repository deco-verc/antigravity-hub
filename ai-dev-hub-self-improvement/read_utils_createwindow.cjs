const fs = require('fs');
const path = require('path');

const asarPath = 'C:\\Users\\Deco\\AppData\\Local\\Programs\\antigravity\\resources\\app.asar';
const utilsJsPath = path.join(asarPath, 'dist', 'utils.js');

try {
  const content = fs.readFileSync(utilsJsPath, 'utf-8');
  const lines = content.split(/\r?\n/);

  console.log('--- Lines 105 to 200 ---');
  for (let i = 104; i < 200 && i < lines.length; i++) {
    console.log(`${i + 1}: ${lines[i]}`);
  }
} catch (e) {
  console.log('Error:', e.message);
}
