'use strict';

/**
 * Хранилище данных: один JSON-файл data/db.json.
 *
 * Записи атомарные (tmp + rename), поэтому оборванный процесс не оставит
 * наполовину записанный файл. Чтение кэшируется в памяти.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DEFAULT_MAIL_SUBJECT, DEFAULT_WA_TEXT } = require('./contacts');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const TMP_FILE = path.join(DATA_DIR, 'db.json.tmp');

let cache = null;
let chain = Promise.resolve();

const iso = () => new Date().toISOString();

function seed() {
  const now = iso();
  return {
    settings: {
      siteName: 'Имя Фамилия',
      role: 'Разработчик — интерфейсы и серверные приложения',
      lead: 'Делаю сайты и внутренние системы: от прототипа до продакшена. Здесь собраны работы, которые можно открыть и потрогать.',
      about: [
        'Меня зовут Имя Фамилия. Я разрабатываю веб-приложения: продумываю интерфейс, собираю серверную часть и довожу проект до состояния, в котором им пользуются каждый день.',
        'Работаю с TypeScript, Node.js и PostgreSQL. Люблю небольшие инструменты, которые решают одну задачу хорошо, и интерфейсы, где всё понятно без инструкции.',
        'Открыт к новым проектам и сотрудничеству. Напишите — обсудим задачу.',
      ],
      email: 'hello@example.com',
      telegram: 'https://t.me/username',
      whatsapp: '',
      max: '',
      mailSubject: DEFAULT_MAIL_SUBJECT,
      waText: DEFAULT_WA_TEXT,
      city: 'Москва',
      stack: 'TypeScript · Node.js · React · PostgreSQL',
      status: 'Открыт для проектов',
      siteUrl: '',
    },
    projects: [
      {
        id: 'p_seed_1',
        slug: 'dispetcherskaya-zayavok',
        title: 'Диспетчерская заявок',
        year: '2026',
        category: 'Веб-приложение',
        summary: 'Внутренняя система для сервисной компании: приём заявок, распределение мастеров и отчёты по выездам.',
        description: 'Сервисная компания вела заявки в таблице и в чате — заявки терялись, а диспетчер вручную сверял графики мастеров.\n\nЯ собрал систему, где заявка создаётся в два клика, автоматически попадает к свободному мастеру по району и навыку, а статус виден всем участникам сразу. Диспетчер видит день как временную шкалу, мастер — только свои выезды в телефоне.\n\nОтчёты по нагрузке, срокам и повторным обращениям строятся по тем же данным, без выгрузок в Excel.',
        stack: ['Node.js', 'PostgreSQL', 'React', 'REST API'],
        links: [{ label: 'Демо', url: 'https://example.com/demo' }],
        cover: '/uploads/seed-01.svg',
        gallery: [],
        published: true,
        demo: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'p_seed_2',
        slug: 'podbor-pleylistov',
        title: 'Подбор плейлистов в Telegram',
        year: '2025',
        category: 'API-сервис',
        summary: 'Бот собирает подборки под настроение и активность, кэширует ответы и не упирается в лимиты внешнего API.',
        description: 'Небольшой сервис, который отвечает на запрос «нужен фон для работы» списком из 20 треков, а не ссылкой на огромный каталог.\n\nАлгоритм учитывает историю прослушиваний и время суток, а результаты кэшируются в Redis: повторные запросы отдаются мгновенно и не расходуют квоту внешнего API.\n\nБот работает в личных сообщениях и в группах, поддерживает инлайн-режим и умеет сохранять подборку отдельным плейлистом.',
        stack: ['Node.js', 'Redis', 'Telegram Bot API'],
        links: [{ label: 'Исходный код', url: 'https://example.com/repo' }],
        cover: '/uploads/seed-02.svg',
        gallery: [],
        published: true,
        demo: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'p_seed_3',
        slug: 'sayt-studii',
        title: 'Сайт студии звукозаписи',
        year: '2024',
        category: 'Сайт',
        summary: 'Статический сайт студии: портфолио записей, расписание сессий и заявка без регистрации.',
        description: 'Студии нужен был быстрый сайт, который открывается на телефоне за секунду и не требует администрирования.\n\nСвёрстал шесть страниц на Astro: галерея записей с фильтром по жанру, расписание сессий и форма заявки, которая уходит в Telegram.\n\nСкорость и оценка Lighthouse — 98 по всем разделам; сборка разворачивается одной командой.',
        stack: ['Astro', 'CSS', 'Netlify'],
        links: [{ label: 'Открыть сайт', url: 'https://example.com/studio' }],
        cover: '/uploads/seed-03.svg',
        gallery: [],
        published: true,
        demo: true,
        createdAt: now,
        updatedAt: now,
      },
    ],
  };
}

function normalize(db) {
  if (!db || typeof db !== 'object') return seed();

  const s = db.settings && typeof db.settings === 'object' ? db.settings : {};
  db.settings = {
    siteName: String(s.siteName || 'Имя Фамилия'),
    role: String(s.role || ''),
    lead: String(s.lead || ''),
    about: Array.isArray(s.about) ? s.about.map(String) : String(s.about || '').split(/\n{2,}/).filter(Boolean),
    email: String(s.email || ''),
    telegram: String(s.telegram || ''),
    whatsapp: String(s.whatsapp || ''),
    max: String(s.max || ''),
    mailSubject: s.mailSubject === undefined || s.mailSubject === null ? DEFAULT_MAIL_SUBJECT : String(s.mailSubject),
    waText: s.waText === undefined || s.waText === null ? DEFAULT_WA_TEXT : String(s.waText),
    city: String(s.city || ''),
    stack: String(s.stack || ''),
    status: String(s.status || ''),
    siteUrl: String(s.siteUrl || ''),
  };

  if (!Array.isArray(db.projects)) db.projects = [];

  db.projects = db.projects
    .filter((p) => p && typeof p === 'object' && p.title)
    .map((p) => ({
      id: String(p.id || `p_${crypto.randomBytes(6).toString('hex')}`),
      slug: String(p.slug || ''),
      title: String(p.title),
      year: String(p.year || ''),
      category: String(p.category || ''),
      summary: String(p.summary || ''),
      description: String(p.description || ''),
      stack: Array.isArray(p.stack) ? p.stack.map(String).filter(Boolean) : String(p.stack || '').split(',').map((v) => v.trim()).filter(Boolean),
      links: Array.isArray(p.links)
        ? p.links.filter((l) => l && l.url).map((l) => ({ label: String(l.label || 'Ссылка'), url: String(l.url) }))
        : [],
      cover: String(p.cover || ''),
      gallery: Array.isArray(p.gallery)
        ? p.gallery.filter((g) => g && (g.src || typeof g === 'string')).map((g) => ({
            src: String(typeof g === 'string' ? g : g.src),
            alt: String((typeof g === 'object' && g.alt) || ''),
          }))
        : [],
      published: p.published !== false,
      demo: Boolean(p.demo),
      createdAt: String(p.createdAt || iso()),
      updatedAt: String(p.updatedAt || iso()),
    }));

  return db;
}

function atomicWrite(json) {
  return new Promise((resolve, reject) => {
    fs.writeFile(TMP_FILE, json, (err) => {
      if (err) return reject(err);
      fs.rename(TMP_FILE, DB_FILE, (renameErr) => (renameErr ? reject(renameErr) : resolve()));
    });
  });
}

function load() {
  if (cache) return cache;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    cache = normalize(seed());
    saveSync();
    return cache;
  }
  try {
    cache = normalize(JSON.parse(fs.readFileSync(DB_FILE, 'utf8')));
  } catch (err) {
    const backup = `${DB_FILE}.broken-${Date.now()}`;
    try {
      fs.renameSync(DB_FILE, backup);
      console.warn(`data/db.json не читается (${err.message}). Копия сохранена: ${path.basename(backup)}. Создан пустой каталог.`);
    } catch {
      console.warn('data/db.json не читается, создаю новый.');
    }
    cache = normalize(seed());
    saveSync();
  }
  return cache;
}

function saveSync() {
  fs.writeFileSync(DB_FILE, JSON.stringify(cache, null, 2));
}

function save() {
  const snapshot = JSON.stringify(cache, null, 2);
  chain = chain.then(() => atomicWrite(snapshot)).catch((err) => {
    console.error('Не удалось записать data/db.json:', err.message);
  });
  return chain;
}

function mutate(fn) {
  const db = load();
  const result = fn(db);
  save();
  return result;
}

module.exports = { load, save, mutate, iso };
