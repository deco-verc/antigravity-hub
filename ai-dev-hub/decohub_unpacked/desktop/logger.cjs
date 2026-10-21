const fs = require('fs');
const path = require('path');
const os = require('os');

const LOGS_DIR = path.join(process.env.AI_DEV_HUB_DATA_DIR || path.join(os.homedir(), '.ai-dev-hub'), 'logs');
const MAX_LOG_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_ROTATIONS = 3;

if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

function sanitize(text) {
  if (typeof text !== 'string') {
    try { text = JSON.stringify(text); } catch { text = String(text); }
  }
  return text
    .replace(/ghp_[A-Za-z0-9_]{10,}/g, 'ghp_***')
    .replace(/gho_[A-Za-z0-9_]{10,}/g, 'gho_***')
    .replace(/AIza[A-Za-z0-9_-]{20,}/g, 'AIza***')
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer ***')
    .replace(/password[:=]\s*["']?[^"'\s&]+["']?/gi, 'password=***')
    .replace(/secret[:=]\s*["']?[^"'\s&]+["']?/gi, 'secret=***')
    .replace(/token[:=]\s*["']?[^"'\s&]+["']?/gi, 'token=***');
}

function rotateIfNeeded(filePath) {
  try {
    if (!fs.existsSync(filePath)) return;
    const stats = fs.statSync(filePath);
    if (stats.size >= MAX_LOG_SIZE_BYTES) {
      for (let i = MAX_ROTATIONS - 1; i >= 1; i--) {
        const older = `${filePath}.${i}`;
        const newer = `${filePath}.${i + 1}`;
        if (fs.existsSync(older)) {
          fs.renameSync(older, newer);
        }
      }
      fs.renameSync(filePath, `${filePath}.1`);
    }
  } catch (err) {
    console.error('Falha ao rotacionar log:', err);
  }
}

function appendToLog(fileName, message) {
  const filePath = path.join(LOGS_DIR, fileName);
  rotateIfNeeded(filePath);
  const timestamp = new Date().toISOString();
  const cleanMessage = sanitize(message);
  fs.appendFileSync(filePath, `[${timestamp}] ${cleanMessage}\n`, 'utf-8');
}

module.exports = {
  LOGS_DIR,
  sanitize,
  info(msg) {
    appendToLog('app.log', `[INFO] ${msg}`);
  },
  warn(msg) {
    appendToLog('app.log', `[WARN] ${msg}`);
  },
  error(msg) {
    appendToLog('app.log', `[ERROR] ${msg}`);
  },
  logBackend(msg) {
    appendToLog('backend.log', msg);
  },
  logAgent(msg) {
    appendToLog('agent.log', msg);
  }
};
