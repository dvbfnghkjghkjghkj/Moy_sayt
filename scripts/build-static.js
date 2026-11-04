#!/usr/bin/env node
'use strict';

/**
 * Сборка статического сайта для GitHub Pages (или любого статического хостинга).
 *
 *   node scripts/build-static.js
 *   node scripts/build-static.js --base=/Moy_sayt/ --url=https://nick.github.io/Moy_sayt/
 *
 * Настройки берутся из static.config.json, аргументы командной строки их
 * перекрывают. Результат по умолчанию — каталог docs/.
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const store = require('../lib/store');
const views = require('../lib/views');

const ROOT = path.resolve(__dirname, '..');
const CONFIG_FILE = path.join(ROOT, 'static.config.json');

/* ── Настройки ──────────────────────────────────────────────────── */

function readConfig() {
  let file = {};
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      file = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch (err) {
      throw new Error(`static.config.json не читается: ${err.message}`);
    }
  }

  const args = {};
  for (const arg of process.argv.slice(2)) {
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) args[match[1]] = match[2];
    else if (arg === '--help' || arg === '-h') args.help = true;
  }

  const pick = (key, fallback) => (args[key] !== undefined ? args[key] : file[key] !== undefined ? file[key] : fallback);
  const explicitBase = args.base !== undefined || file.base !== undefined;
  const explicitUrl = args.url !== undefined || file.url !== undefined;
  const repo = detectGithub();

  const defaultBase = repo && repo.repo !== `${repo.user}.github.io` ? `/${repo.repo}` : '';
  const defaultUrl = repo ? `https://${repo.user}.github.io/${repo.repo === `${repo.user}.github.io` ? '' : `${repo.repo}/`}` : '';

  return {
    out: String(pick('out', 'docs')),
    base: normalizeBase(String(explicitBase ? pick('base', '') : defaultBase)),
    url: normalizeUrl(String(explicitUrl ? pick('url', '') : defaultUrl)),
    cname: String(pick('cname', '')).trim(),
    detected: repo,
    help: Boolean(args.help),
  };
}

/**
 * Имя репозитория из .git/config — чтобы не спрашивать то, что уже известно.
 * Читаем файл напрямую: запускать git из песочницы ненадёжно.
 */
function detectGithub() {
  try {
    const config = fs.readFileSync(path.join(ROOT, '.git', 'config'), 'utf8');
    const match = config.match(/\[remote "origin"\][^\[]*?url\s*=\s*(\S+)/);
    if (!match) return null;
    const remote = match[1].trim();
    const github = remote.match(/github\.com[:\/]([^\/]+)\/([^\/]+?)(?:\.git)?$/i);
    if (!github) return null;
    return { user: github[1], repo: github[2] };
  } catch {
    return null;
  }
}

/** 'Moy_sayt', '/Moy_sayt/', '/Moy_sayt' → '/Moy_sayt'; '' → '' */
function normalizeBase(raw) {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function normalizeUrl(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

function usage() {
  console.log(`Сборка статического сайта

  node scripts/build-static.js [ключи]

Ключи (перекрывают static.config.json):
  --out=docs                       каталог для сборки
  --base=/Moy_sayt/                путь, по которому сайт лежит на хостинге
  --url=https://nick.github.io/…   адрес сайта для sitemap и robots
  --cname=example.com              свой домен (создаст файл CNAME)
  --help                           эта справка
`);
}

/* ── Утилиты ────────────────────────────────────────────────────── */

const escapeXml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

async function write(relativePath, contents) {
  const target = path.join(OUT_DIR, relativePath);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.writeFile(target, contents);
  return relativePath;
}

async function copy(relativeFrom, relativeTo = relativeFrom.replace(/^public[\\/]/, '')) {
  const from = path.join(ROOT, relativeFrom);
  const to = path.join(OUT_DIR, relativeTo);
  await fsp.mkdir(path.dirname(to), { recursive: true });
  await fsp.copyFile(from, to);
  return relativeTo.split(path.sep).join('/');
}

async function copyDir(relativeFrom, filter = () => true) {
  const from = path.join(ROOT, relativeFrom);
  const entries = await fsp.readdir(from, { withFileTypes: true });
  const copied = [];
  for (const entry of entries) {
    if (!entry.isFile() || !filter(entry.name)) continue;
    const relative = path.posix.join(relativeFrom.split(path.sep).join('/'), entry.name);
    copied.push(await copy(relative));
  }
  return copied;
}

/** Не даём сборке затереть сам проект. */
function assertSafeOut(outDir) {
  const relative = path.relative(ROOT, outDir);
  const inside = relative && !relative.startsWith('..') && !path.isAbsolute(relative);
  if (!inside) throw new Error(`Каталог сборки вне проекта: ${outDir}`);
  if (outDir === ROOT) throw new Error('Каталог сборки не может совпадать с корнем проекта');
  const guarded = ['server.js', 'app.js', 'package.json', 'lib', 'public', 'data', 'scripts', 'node_modules'];
  if (guarded.includes(path.basename(outDir))) {
    throw new Error(`Нельзя собирать в «${path.basename(outDir)}» — это часть проекта. Укажите, например, docs/`);
  }
}

/* ── Сборка ─────────────────────────────────────────────────────── */

let OUT_DIR;

async function build(config) {
  OUT_DIR = path.resolve(ROOT, config.out);
  assertSafeOut(OUT_DIR);

  const db = store.load();
  const settings = { ...db.settings, base: config.base, static: true };
  const urlOf = (page) => (config.url ? `${config.url}${page}` : '');

  const published = db.projects.filter((p) => p.published);
  const pages = [];

  // Файлы, которые копируем как есть.
  if (fs.existsSync(OUT_DIR)) await fsp.rm(OUT_DIR, { recursive: true, force: true });

  const assets = [
    await copy('public/css/style.css'),
    await copy('public/js/site.js'),
    await copy('public/favicon.svg'),
    ...(await copyDir('public/uploads')),
  ];

  // Страницы.
  pages.push(
    await write('index.html', views.indexPage({ settings, projects: published })),
    await write('about/index.html', views.aboutPage({ settings })),
    await write('404.html', views.notFoundPage({ settings })),
  );

  const workUrls = [];
  for (const [index, project] of published.entries()) {
    const html = views.workPage({
      project,
      settings,
      prev: published[index - 1] || null,
      next: published[index + 1] || null,
    });
    const relative = `work/${project.slug}/index.html`;
    await write(relative, html);
    pages.push(relative);
    workUrls.push(`work/${encodeURIComponent(project.slug)}/`);
  }

  // Служебные файлы.
  if (config.url) {
    const urls = ['', 'about/', ...workUrls];
    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((page) => `  <url>\n    <loc>${escapeXml(urlOf(page))}</loc>\n  </url>`).join('\n')}
</urlset>
`;
    await write('sitemap.xml', sitemap);
    await write('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${urlOf('sitemap.xml')}\n`);
  } else {
    await write('robots.txt', 'User-agent: *\nAllow: /\n');
    console.warn('  ! Адрес сайта не задан (--url=…): sitemap.xml не создан, robots.txt без ссылки на карту.');
  }

  await write('.nojekyll', '');
  if (config.cname) await write('CNAME', `${config.cname}\n`);

  return { pages, assets, out: OUT_DIR, published: published.length, size: await dirSize(OUT_DIR) };
}

async function dirSize(dir) {
  let total = 0;
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await dirSize(full);
    else total += (await fsp.stat(full)).size;
  }
  return total;
}

/* ── Запуск ─────────────────────────────────────────────────────── */

(async () => {
  const config = readConfig();
  if (config.help) {
    usage();
    return;
  }

  const started = Date.now();
  console.log('Сборка статического сайта');
  console.log(`  каталог: ${path.relative(ROOT, path.resolve(ROOT, config.out)) || '.'}`);
  console.log(`  база:    ${config.base || '(корень)'}`);
  if (config.url) console.log(`  адрес:   ${config.url}`);
  if (config.detected) console.log(`  репозиторий: ${config.detected.user}/${config.detected.repo} (из .git/config)`);

  const result = await build(config);

  console.log('');
  console.log(`Готово за ${Date.now() - started} мс.`);
  console.log(`  страниц:   ${result.pages.length} (работ: ${result.published})`);
  console.log(`  файлов:    ${result.assets.length + result.pages.length}`);
  console.log(`  объём:     ${(result.size / 1024 / 1024).toFixed(2)} МБ`);
  console.log('');
  console.log('Опубликовать на GitHub Pages: закоммитьте каталог и включите Pages');
  console.log(`(Settings → Pages → ветка main, папка /${config.out}).`);
})().catch((err) => {
  console.error('Сборка не удалась:', err.message);
  process.exit(1);
});
