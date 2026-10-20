const fs = require('fs');
const path = require('path');

const asarPath = 'C:\\Users\\Deco\\AppData\\Local\\Programs\\antigravity\\resources\\app.asar';
const mainJsPath = path.join(asarPath, 'dist', 'main.js');

try {
  const content = fs.readFileSync(mainJsPath, 'utf-8');
  const lines = content.split(/\r?\n/);

  console.log('--- Lines 165 to 225 ---');
  for (let i = 164; i < 225 && i < lines.length; i++) {
    console.log(`${i + 1}: ${lines[i]}`);
  }

  console.log('\n--- Lines 320 to 360 ---');
  for (let i = 319; i < 360 && i < lines.length; i++) {
    console.log(`${i + 1}: ${lines[i]}`);
  }
} catch (e) {
  console.log('Error:', e.message);
}
