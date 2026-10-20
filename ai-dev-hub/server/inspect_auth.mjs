import fs from 'node:fs';
import path from 'node:path';

const asarPath = path.join(process.env.LOCALAPPDATA, 'Programs', 'antigravity', 'resources', 'app.asar');
const buf = fs.readFileSync(asarPath);
const str = buf.toString('latin1');
const matches = new Set();
const re = /accounts\.google\.com[^\s"'<>]+/g;
let m;
while ((m = re.exec(str)) !== null) {
  matches.add(m[0]);
  if (matches.size >= 15) break;
}
console.log('Google URLs:', Array.from(matches));

// Look for login or signin commands/handlers
const authMatches = new Set();
const reAuth = /(?:login|signIn|authenticate|oauth)[a-zA-Z0-9_\-\.\/]{3,30}/gi;
while ((m = reAuth.exec(str)) !== null) {
  if (m[0].toLowerCase().includes('google') || m[0].toLowerCase().includes('login')) {
    authMatches.add(m[0]);
    if (authMatches.size >= 20) break;
  }
}
console.log('Auth handlers:', Array.from(authMatches));
