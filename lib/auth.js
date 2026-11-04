'use strict';

/**
 * Пароль администратора и сессии.
 *
 * Пароль хранится только в виде scrypt-хэша в data/auth.json.
 * Если файла нет, при первом запуске создаётся пароль:
 *   - из переменной окружения ADMIN_PASSWORD, либо
 *   - случайный, который печатается в консоль один раз.
 *
 * Сессия — подписанная HMAC-кука, а не запись в памяти: вход переживает
 * перезапуск приложения (на uCoz это происходит после каждого обновления кода).
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const AUTH_FILE = path.join(DATA_DIR, 'auth.json');

const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const loginAttempts = new Map();

function hash(plain) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(plain), salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$16384$8$1$${salt.toString('base64')}$${key.toString('base64')}`;
}

function verify(plain, stored) {
  try {
    const parts = String(stored).split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [, N, r, p, saltB64, keyB64] = parts;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(keyB64, 'base64');
    if (expected.length < 32) return false;
    const actual = crypto.scryptSync(String(plain), salt, expected.length, {
      N: Number(N), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024,
    });
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function newSecret() {
  return crypto.randomBytes(32).toString('base64url');
}

function writeAuth(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const payload = { hash: data.hash, secret: data.secret, updatedAt: new Date().toISOString() };
  const tmp = `${AUTH_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, AUTH_FILE);
  cached = payload;
  return payload;
}

let cached = null;

function ensure() {
  if (cached) return cached;
  fs.mkdirSync(DATA_DIR, { recursive: true });

  if (fs.existsSync(AUTH_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
      if (data && data.hash) {
        if (!data.secret) {
          // Файл от старой версии — добавляем секрет для кук.
          return writeAuth({ hash: data.hash, secret: newSecret() });
        }
        cached = data;
        return cached;
      }
    } catch {
      console.warn('Файл data/auth.json повреждён — создаю новый пароль.');
    }
  }

  const plain = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  cached = writeAuth({ hash: hash(plain), secret: newSecret() });
  if (!process.env.ADMIN_PASSWORD) {
    console.log('\n  ──────────────────────────────────────────────');
    console.log('  Пароль для входа в /admin: ' + plain);
    console.log('  Сменить: node scripts/set-password.js "новый пароль"');
    console.log('  ──────────────────────────────────────────────\n');
  }
  return cached;
}

function checkPassword(plain) {
  return verify(plain, ensure().hash);
}

function setPassword(plain) {
  const value = String(plain || '');
  if (value.length < 8) {
    const err = new Error('Пароль должен быть не короче 8 символов');
    err.code = 'WEAK_PASSWORD';
    throw err;
  }
  if (value.length > 200) {
    const err = new Error('Пароль слишком длинный');
    err.code = 'WEAK_PASSWORD';
    throw err;
  }
  const current = ensure();
  writeAuth({ hash: hash(value), secret: current.secret });
}

/* ── Сессии ─────────────────────────────────────────────────────── */

const VERSION = 'v1';

function sign(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function createSession() {
  const expires = Date.now() + TTL_MS;
  const payload = `${VERSION}.${expires}`;
  return `${payload}.${sign(ensure().secret, payload)}`;
}

function hasSession(token) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== VERSION) return false;

  const expires = Number(parts[1]);
  if (!Number.isFinite(expires) || expires < Date.now()) return false;

  const expected = sign(ensure().secret, `${parts[0]}.${parts[1]}`);
  const actual = parts[2];
  if (actual.length !== expected.length) return false;

  try {
    return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
  } catch {
    return false;
  }
}

// Кука подписана: серверу нечего удалять, браузер очищает её сам.
function destroySession() {}

// Ограничение попыток входа: не более 8 неудач за 10 минут с одного адреса.
const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILS = 8;

function attemptsAllowed(ip) {
  const entry = loginAttempts.get(ip);
  if (!entry) return true;
  if (Date.now() > entry.resetAt) {
    loginAttempts.delete(ip);
    return true;
  }
  return entry.fails < MAX_FAILS;
}

function noteFailure(ip) {
  const entry = loginAttempts.get(ip);
  if (!entry || Date.now() > entry.resetAt) {
    loginAttempts.set(ip, { fails: 1, resetAt: Date.now() + WINDOW_MS });
    return;
  }
  entry.fails += 1;
}

function resetAttempts(ip) {
  loginAttempts.delete(ip);
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of loginAttempts) {
    if (now > entry.resetAt) loginAttempts.delete(ip);
  }
}, 10 * 60 * 1000).unref();

module.exports = {
  TTL_MS,
  ensure,
  checkPassword,
  setPassword,
  createSession,
  hasSession,
  destroySession,
  attemptsAllowed,
  noteFailure,
  resetAttempts,
};
