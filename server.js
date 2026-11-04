'use strict';

/**
 * Сервер портфолио: серверный HTML + небольшой JSON API для админки.
 * Внешних зависимостей нет, нужен только Node.js 18+.
 */

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const store = require('./lib/store');
const auth = require('./lib/auth');
const views = require('./lib/views');
const { waDigits, maxUrl } = require('./lib/contacts');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const UPLOAD_DIR = path.join(PUBLIC_DIR, 'uploads');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
};

const CSP = [
  "default-src 'self'",
  "img-src 'self' data:",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "script-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ');

/* ── HTTP-помощники ─────────────────────────────────────────────── */

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
}

function respond(req, res, status, body, headers = {}) {
  securityHeaders(res);
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(String(body ?? ''), 'utf8');
  res.writeHead(status, { 'Content-Length': buffer.length, ...headers });
  if (req.method === 'HEAD') res.end();
  else res.end(buffer);
}

function html(req, res, status, body, headers = {}) {
  respond(req, res, status, body, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', ...headers });
}

function json(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  securityHeaders(res);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('Слишком большой запрос'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function jsonBody(req, limit = 1024 * 1024) {
  const raw = await readBody(req, limit);
  if (!raw.length) return {};
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    throw Object.assign(new Error('Некорректный JSON в запросе'), { status: 400 });
  }
}

function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    try {
      out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      /* пропускаем битые куки */
    }
  }
  return out;
}

function cookieString(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (options.maxAge != null) parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}

function isHttps(req) {
  return (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https' || Boolean(req.socket.encrypted);
}

function clientIp(req) {
  const forwarded = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket.remoteAddress || 'unknown';
}

function siteBase(req, db) {
  const configured = String((db && db.settings && db.settings.siteUrl) || '').trim();
  if (/^https?:\/\//i.test(configured)) return configured;
  const proto = isHttps(req) ? 'https' : 'http';
  return `${proto}://${req.headers.host || 'localhost'}`;
}

function escapeXml(value) {
  return String(value || '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
}

function sameOrigin(req) {
  if ((req.headers['sec-fetch-site'] || '') === 'cross-site') return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

/* ── Слаги, валидация ───────────────────────────────────────────── */

const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i',
  й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '',
  э: 'e', ю: 'yu', я: 'ya',
};

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .split('')
    .map((ch) => (TRANSLIT[ch] !== undefined ? TRANSLIT[ch] : ch))
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function uniqueSlug(db, base, exceptId) {
  const root = base || 'rabota';
  let candidate = root;
  let n = 2;
  while (db.projects.some((p) => p.slug === candidate && p.id !== exceptId)) {
    candidate = `${root}-${n}`;
    n += 1;
  }
  return candidate;
}

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function cleanUploadPath(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (!raw.startsWith('/uploads/')) throw badRequest('Недопустимый путь к изображению');
  const name = raw.slice('/uploads/'.length);
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(name)) throw badRequest('Недопустимое имя файла изображения');
  return `/uploads/${name}`;
}

function cleanHttpUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return /^https?:\/\/[^\s<>"']+$/i.test(raw) ? raw.slice(0, 500) : '';
}

function cleanProject(input, existing, db) {
  if (!input || typeof input !== 'object') throw badRequest('Нет данных работы');

  const title = String(input.title || '').trim();
  if (!title) throw badRequest('Укажите название работы');
  if (title.length > 120) throw badRequest('Название длиннее 120 символов');

  const summary = String(input.summary || '').trim().slice(0, 400);
  const description = String(input.description || '').trim().slice(0, 20000);
  const category = String(input.category || '').trim().slice(0, 60);
  const year = String(input.year || '').trim().slice(0, 20);
  if (year && !/^[0-9]{4}$/.test(year)) throw badRequest('Год указывается четырьмя цифрами');

  const stack = (Array.isArray(input.stack) ? input.stack : String(input.stack || '').split(','))
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .slice(0, 14)
    .map((s) => s.slice(0, 40));

  const links = (Array.isArray(input.links) ? input.links : [])
    .map((l) => ({ label: String((l && l.label) || 'Ссылка').trim().slice(0, 60), url: cleanHttpUrl(l && l.url) }))
    .filter((l) => l.url)
    .slice(0, 6);

  const gallery = (Array.isArray(input.gallery) ? input.gallery : [])
    .map((g) => ({ src: cleanUploadPath(g && g.src), alt: String((g && g.alt) || '').trim().slice(0, 200) }))
    .filter((g) => g.src)
    .slice(0, 24);

  const slugSource = slugify(input.slug || title);
  const slug = uniqueSlug(db, slugSource, existing ? existing.id : null);

  return {
    slug,
    title,
    year,
    category,
    summary,
    description,
    stack,
    links,
    cover: cleanUploadPath(input.cover),
    gallery,
    published: input.published !== false,
  };
}

/* ── Загрузка изображений ───────────────────────────────────────── */

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

function sniffImage(buffer) {
  if (buffer.length < 12) return '';
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  if (buffer.slice(0, 4).toString('ascii') === 'GIF8') return 'gif';
  if (buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP') return 'webp';
  if (buffer.slice(4, 8).toString('ascii') === 'ftyp') {
    const brand = buffer.slice(8, 12).toString('ascii');
    if (brand.startsWith('avif') || brand.startsWith('avis') || brand.startsWith('mif1')) return 'avif';
  }
  return '';
}

/* ── API ────────────────────────────────────────────────────────── */

function requireCsrf(req, res) {
  if (!sameOrigin(req)) {
    json(res, 403, { error: 'Запрос с чужого сайта отклонён' });
    return false;
  }
  if (req.headers['x-portfolio-csrf'] !== '1') {
    json(res, 403, { error: 'Нет служебного заголовка запроса' });
    return false;
  }
  return true;
}

async function api(req, res, url) {
  const route = url.pathname;
  const method = req.method;

  if (route === '/api/session' && method === 'GET') {
    return json(res, 200, { authed: auth.hasSession(cookies(req).sid) });
  }

  if (route === '/api/login' && method === 'POST') {
    if (!requireCsrf(req, res)) return;
    const ip = clientIp(req);
    if (!auth.attemptsAllowed(ip)) {
      return json(res, 429, { error: 'Слишком много попыток входа. Попробуйте через 10 минут.' });
    }
    const body = await jsonBody(req, 8 * 1024);
    if (!auth.checkPassword(body.password || '')) {
      auth.noteFailure(ip);
      return json(res, 401, { error: 'Неверный пароль' });
    }
    auth.resetAttempts(ip);
    const token = auth.createSession();
    res.setHeader('Set-Cookie', cookieString('sid', token, { maxAge: auth.TTL_MS / 1000, secure: isHttps(req) }));
    return json(res, 200, { ok: true });
  }

  const sid = cookies(req).sid;
  if (!auth.hasSession(sid)) return json(res, 401, { error: 'Требуется вход' });

  if (route === '/api/logout' && method === 'POST') {
    if (!requireCsrf(req, res)) return;
    auth.destroySession(sid);
    res.setHeader('Set-Cookie', cookieString('sid', '', { maxAge: 0, secure: isHttps(req) }));
    return json(res, 200, { ok: true });
  }

  if (method !== 'GET' && !requireCsrf(req, res)) return;

  const db = store.load();

  if (route === '/api/works' && method === 'GET') {
    return json(res, 200, { projects: db.projects, settings: db.settings });
  }

  if (route === '/api/works' && method === 'POST') {
    const body = await jsonBody(req, 64 * 1024);
    const data = cleanProject(body, null, db);
    const project = {
      id: `p_${crypto.randomBytes(6).toString('hex')}`,
      ...data,
      demo: false,
      createdAt: store.iso(),
      updatedAt: store.iso(),
    };
    store.mutate((d) => {
      d.projects.unshift(project);
    });
    return json(res, 201, { project });
  }

  const workMatch = /^\/api\/works\/([A-Za-z0-9_]+)$/.exec(route);
  if (workMatch) {
    const project = db.projects.find((p) => p.id === workMatch[1]);
    if (!project) return json(res, 404, { error: 'Работа не найдена' });

    if (method === 'PUT') {
      const body = await jsonBody(req, 64 * 1024);
      const data = cleanProject(body, project, db);
      Object.assign(project, data, { demo: false, updatedAt: store.iso() });
      store.save();
      return json(res, 200, { project });
    }

    if (method === 'DELETE') {
      store.mutate((d) => {
        d.projects = d.projects.filter((p) => p.id !== project.id);
      });
      return json(res, 200, { ok: true });
    }

    return json(res, 405, { error: 'Метод не поддерживается' });
  }

  if (route === '/api/demo' && method === 'DELETE') {
    const removed = store.mutate((d) => {
      const before = d.projects.length;
      d.projects = d.projects.filter((p) => !p.demo);
      return before - d.projects.length;
    });
    return json(res, 200, { removed });
  }

  if (route === '/api/settings' && method === 'PUT') {
    const body = await jsonBody(req, 64 * 1024);
    const allowed = [
      'siteName',
      'role',
      'lead',
      'email',
      'telegram',
      'whatsapp',
      'max',
      'mailSubject',
      'waText',
      'city',
      'stack',
      'status',
      'siteUrl',
    ];

    // Сначала проверяем всё, только потом меняем — иначе ошибка оставит
    // наполовину обновлённые настройки в памяти.
    const next = {};
    for (const key of allowed) {
      if (body[key] === undefined) continue;
      next[key] = String(body[key]).trim().slice(0, 1000);
    }
    if (body.about !== undefined) {
      const about = Array.isArray(body.about) ? body.about : String(body.about).split(/\n{2,}/);
      next.about = about.map((p) => String(p).trim()).filter(Boolean).slice(0, 12);
    }
    if (next.telegram) {
      const tg = next.telegram;
      if (/^@/.test(tg)) next.telegram = `https://t.me/${tg.slice(1)}`;
      else if (!/^https?:\/\//.test(tg)) next.telegram = `https://t.me/${tg}`;
      if (!cleanHttpUrl(next.telegram)) throw badRequest('Ссылка Telegram указана неверно');
    }
    if (next.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(next.email)) {
      throw badRequest('Почта указана неверно');
    }
    if (next.siteUrl && !cleanHttpUrl(next.siteUrl)) throw badRequest('Адрес сайта указан неверно');
    if (next.whatsapp) {
      const digits = waDigits(next.whatsapp);
      if (digits.length < 10 || digits.length > 15) throw badRequest('Номер WhatsApp указан неверно');
      next.whatsapp = digits;
    }
    if (next.max) {
      const normalized = maxUrl(next.max);
      let host = '';
      try {
        host = normalized ? new URL(normalized).hostname : '';
      } catch {
        host = '';
      }
      if (!host || !/(^|\.)max\.ru$/i.test(host)) throw badRequest('Ссылка MAX указана неверно');
      next.max = normalized;
    }
    if (next.mailSubject !== undefined) next.mailSubject = next.mailSubject.slice(0, 160);
    if (next.waText !== undefined) next.waText = next.waText.slice(0, 300);

    store.mutate((d) => Object.assign(d.settings, next));
    return json(res, 200, { settings: db.settings });
  }

  if (route === '/api/password' && method === 'POST') {
    const body = await jsonBody(req, 8 * 1024);
    if (!auth.checkPassword(body.current || '')) return json(res, 400, { error: 'Текущий пароль неверен' });
    try {
      auth.setPassword(body.next || '');
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
    return json(res, 200, { ok: true });
  }

  if (route === '/api/upload' && method === 'POST') {
    const body = await jsonBody(req, 12 * 1024 * 1024);
    const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(String(body.dataUrl || ''));
    if (!match) return json(res, 400, { error: 'Ожидается изображение в data URL' });
    const buffer = Buffer.from(match[2], 'base64');
    if (!buffer.length) return json(res, 400, { error: 'Пустой файл' });
    if (buffer.length > MAX_UPLOAD_BYTES) return json(res, 413, { error: 'Файл больше 8 МБ' });
    const ext = sniffImage(buffer);
    if (!ext) return json(res, 415, { error: 'Поддерживаются PNG, JPEG, WebP, GIF, AVIF' });

    await fsp.mkdir(UPLOAD_DIR, { recursive: true });
    const name = `${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
    await fsp.writeFile(path.join(UPLOAD_DIR, name), buffer);
    return json(res, 201, { url: `/uploads/${name}` });
  }

  return json(res, 404, { error: 'Неизвестный метод API' });
}

/* ── Статика ────────────────────────────────────────────────────── */

async function serveFile(req, res, filePath, cacheControl) {
  let stat;
  try {
    stat = await fsp.stat(filePath);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;
  const ext = path.extname(filePath).toLowerCase();
  const body = await fsp.readFile(filePath);
  respond(req, res, 200, body, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': cacheControl,
    'Last-Modified': stat.mtime.toUTCString(),
  });
  return true;
}

function resolveStatic(urlPath) {
  let rel;
  try {
    rel = decodeURIComponent(urlPath).replace(/^\/+/, '');
  } catch {
    return null;
  }
  const filePath = path.resolve(PUBLIC_DIR, rel);
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) return null;
  return filePath;
}

/* ── Страницы ───────────────────────────────────────────────────── */

function page(res, req, body, status = 200) {
  html(req, res, status, body);
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const route = url.pathname;

  if (route.startsWith('/api/')) {
    try {
      await api(req, res, url);
    } catch (err) {
      if (err.status) return json(res, err.status, { error: err.message });
      console.error('API:', err);
      return json(res, 500, { error: 'Внутренняя ошибка сервера' });
    }
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return respond(req, res, 405, 'Метод не поддерживается', { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET, HEAD' });
  }

  const db = store.load();
  const published = db.projects.filter((p) => p.published);

  if (route === '/') {
    return page(res, req, views.indexPage({ settings: db.settings, projects: published }));
  }

  if (route === '/about') {
    return page(res, req, views.aboutPage({ settings: db.settings }));
  }

  if (route.startsWith('/work/')) {
    const slug = decodeURIComponent(route.slice('/work/'.length)).replace(/\/+$/, '');
    const index = published.findIndex((p) => p.slug === slug);
    if (index < 0) {
      return page(res, req, views.notFoundPage({ settings: db.settings }), 404);
    }
    return page(
      res,
      req,
      views.workPage({
        project: published[index],
        settings: db.settings,
        prev: published[index - 1] || null,
        next: published[index + 1] || null,
      }),
    );
  }

  if (route === '/admin' || route === '/admin/') {
    const served = await serveFile(req, res, path.join(PUBLIC_DIR, 'admin.html'), 'no-store');
    return served || page(res, req, views.notFoundPage({ settings: db.settings }), 404);
  }

  if (route === '/robots.txt') {
    const base = siteBase(req, db).replace(/\/+$/, '');
    const body = `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\n\nSitemap: ${base}/sitemap.xml\n`;
    return respond(req, res, 200, body, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' });
  }

  if (route === '/sitemap.xml') {
    const base = siteBase(req, db).replace(/\/+$/, '');
    const urls = ['/', '/about', ...published.map((p) => `/work/${encodeURIComponent(p.slug)}`)];
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (pathname) => `  <url>
    <loc>${escapeXml(base + pathname)}</loc>
  </url>`,
  )
  .join('\n')}
</urlset>
`;
    return respond(req, res, 200, body, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'no-cache' });
  }

  if (route === '/favicon.svg' || route.startsWith('/css/') || route.startsWith('/js/') || route.startsWith('/uploads/')) {
    const filePath = resolveStatic(route);
    if (!filePath) return respond(req, res, 403, 'Доступ запрещён', { 'Content-Type': 'text/plain; charset=utf-8' });
    const cache = route.startsWith('/uploads/') ? 'public, max-age=31536000, immutable' : 'no-cache';
    const served = await serveFile(req, res, filePath, cache);
    if (served) return;
  }

  return page(res, req, views.notFoundPage({ settings: db.settings }), 404);
}

/* ── Запуск ─────────────────────────────────────────────────────── */

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error('Ошибка запроса:', err);
    if (!res.headersSent) respond(req, res, 500, 'Ошибка сервера', { 'Content-Type': 'text/plain; charset=utf-8' });
    else res.end();
  });
});

server.on('clientError', (err, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

const port = process.env.PORT;
auth.ensure();
if (port && Number.isNaN(Number(port))) {
  server.listen(port, () => console.log(`Портфолио запущено на сокете ${port}`));
} else {
  const numericPort = Number(port) || 5173;
  server.listen(numericPort, process.env.HOST || '127.0.0.1', () => {
    console.log(`Портфолио запущено: http://127.0.0.1:${numericPort}`);
    console.log(`Управление:              http://127.0.0.1:${numericPort}/admin`);
  });
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Порт ${port || 5173} уже занят. Запустите с другим портом: $env:PORT=5174; npm start`);
    process.exit(1);
  }
  throw err;
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log('\nОстановка сервера…');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}

module.exports = { server };
