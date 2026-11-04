'use strict';

const { plural } = require('./plural');
const { mailLink, waLink, maxUrl } = require('./contacts');

const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Базовый путь для внутренних ссылок. На сервере он пустой, а на GitHub
 * Pages страница живёт по адресу /<репозиторий>/, поэтому префикс задаёт
 * генератор статики.
 */
function baseOf(settings) {
  return String((settings && settings.base) || '').replace(/\/+$/, '');
}

function link(settings, pathname) {
  return `${baseOf(settings)}${pathname}`;
}

const arrow = `<svg class="row-arrow-icon" viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="square"><path d="M4.5 11.5 11.5 4.5M5.5 4.5h6v6"/></svg>`;

const svg = (body) =>
  `<svg class="icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const icons = {
  mail: svg('<rect x="3.2" y="5.6" width="17.6" height="12.8" rx="1.8"/><path d="m4.3 7.3 7.7 5.5 7.7-5.5"/>'),
  telegram: svg(
    '<path d="M20.9 4.4 3 10.9c-.9.3-.9 1.6 0 1.9l4.5 1.5 1.7 4.8c.2.7 1.1.9 1.6.3l2.3-2.4 4.4 3.2c.7.5 1.5.1 1.7-.7l2.6-14c.1-.7-.5-1.3-1.4-1.1Z"/><path d="m7.5 14.3 9.4-7.2"/>',
  ),
  whatsapp: svg(
    '<path d="M12 3.4a8.6 8.6 0 0 0-7.4 13l-.9 4.2 4.3-1.1A8.6 8.6 0 1 0 12 3.4Z"/><path d="M8.8 8.1c.2-.6.9-.8 1.3-.4l.9 1.2c.3.4.2.9-.1 1.2l-.4.4c.4 1 1.2 1.8 2.2 2.3l.4-.5c.3-.4.8-.4 1.2-.1l1.2.9c.4.3.4 1-.2 1.3-1 .5-2.2.3-3.5-.5-1.3-.8-2.3-1.9-2.9-3.1-.3-.7-.4-1.4-.1-2Z"/>',
  ),
  max: svg('<rect x="3.4" y="3.4" width="17.2" height="17.2" rx="4.6"/><path d="M7.8 16.3V9.7c0-.6.7-.9 1.1-.5l3.1 2.8 3.1-2.8c.4-.4 1.1-.1 1.1.5v6.6"/>'),
};

function safeUrl(url) {
  const value = String(url || '').trim();
  return /^https?:\/\//i.test(value) ? value : '';
}

/**
 * Пиктограммы контактов. Почта несёт тему письма, WhatsApp — первую фразу,
 * чтобы сообщения не смешивались с остальной перепиской.
 */
function contactLinks(settings, options = {}) {
  const items = [];

  if (options.mail !== false) {
    const mail = mailLink(settings.email, settings.mailSubject);
    if (mail) items.push({ label: `Почта: ${settings.email}`, href: mail, icon: icons.mail });
  }

  const telegram = safeUrl(settings.telegram);
  if (telegram) items.push({ label: 'Telegram', href: telegram, icon: icons.telegram });

  const whatsapp = waLink(settings.whatsapp, settings.waText);
  if (whatsapp) items.push({ label: 'WhatsApp', href: whatsapp, icon: icons.whatsapp });

  const max = maxUrl(settings.max);
  if (max) items.push({ label: 'MAX', href: max, icon: icons.max });

  if (!items.length) return '';
  return `<div class="contact-icons">${items
    .map((item) => {
      const external = !item.href.startsWith('mailto:');
      return `<a class="icon-link" href="${esc(item.href)}" aria-label="${esc(item.label)}" title="${esc(item.label)}" rel="noopener"${
        external ? ' target="_blank"' : ''
      }>${item.icon}</a>`;
    })
    .join('')}</div>`;
}

function hasContacts(settings) {
  return Boolean(settings.email || safeUrl(settings.telegram) || waLink(settings.whatsapp, settings.waText) || maxUrl(settings.max));
}

function textBlocks(text) {
  const blocks = String(text || '').trim().split(/\n{2,}/);
  return blocks
    .map((block) => {
      const lines = block.split('\n').map((line) => line.trim());
      if (lines.every((line) => /^[-–•]\s+/.test(line))) {
        return `<ul>${lines.map((line) => `<li>${inline(line.replace(/^[-–•]\s+/, ''))}</li>`).join('')}</ul>`;
      }
      return `<p>${inline(lines.join(' '))}</p>`;
    })
    .filter((html) => html !== '<p></p>')
    .join('\n');
}

function inline(value) {
  return esc(value).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

function yearsSpan(projects) {
  const years = [...new Set(projects.map((p) => p.year).filter(Boolean))].sort();
  if (!years.length) return '';
  return years.length === 1 ? years[0] : `${years[0]}—${years[years.length - 1]}`;
}

function layout({ title, description, body, settings, active = '', bodyClass = '', noindex = false, head = '' }) {
  const name = settings.siteName || 'Портфолио';
  const base = baseOf(settings);
  const isStatic = Boolean(settings.static);
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title || name)}</title>
<meta name="description" content="${esc(description || settings.lead || '')}">
${noindex ? '<meta name="robots" content="noindex, nofollow">' : ''}
<meta name="theme-color" content="#0B0D0C">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title || name)}">
<meta property="og:description" content="${esc(description || settings.lead || '')}">
<link rel="icon" href="${base}/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Golos+Text:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap">
<link rel="stylesheet" href="${base}/css/style.css">
${head}
</head>
<body class="${esc(bodyClass)}">
<a class="skip" href="#main">Перейти к содержанию</a>
<header class="top">
  <a class="mark" href="${base}/">${esc(name)}</a>
  <nav class="nav" aria-label="Основная навигация">
    <a href="${base}/#works"${active === 'works' ? ' aria-current="page"' : ''}>Работы</a>
    <a href="${base}/about"${active === 'about' ? ' aria-current="page"' : ''}>О себе</a>
  </nav>
</header>
<main id="main">
${body}
</main>
<footer class="foot">
  <div class="foot-col">
    <p class="foot-name">${esc(name)}</p>
    <p class="foot-line">${esc(settings.role || '')}</p>
  </div>
  <div class="foot-col foot-contacts">
    ${contactLinks(settings)}
    ${isStatic ? '' : `<a class="foot-admin" href="${base}/admin">Управление</a>`}
  </div>
  <p class="foot-copy">© ${new Date().getFullYear()} ${esc(name)}</p>
</footer>
</body>
</html>`;
}

function spec(settings) {
  const rows = [];
  if (settings.status) {
    rows.push(`<div class="spec-row"><dt>Статус</dt><dd><span class="dot" aria-hidden="true"></span>${esc(settings.status)}</dd></div>`);
  }
  if (settings.city) rows.push(`<div class="spec-row"><dt>Город</dt><dd>${esc(settings.city)}</dd></div>`);
  if (settings.stack) rows.push(`<div class="spec-row"><dt>Стек</dt><dd>${esc(settings.stack)}</dd></div>`);
  if (settings.email) {
    rows.push(
      `<div class="spec-row"><dt>Почта</dt><dd><a href="${esc(mailLink(settings.email, settings.mailSubject))}">${esc(settings.email)}</a></dd></div>`,
    );
  }
  if (!rows.length) return '';
  return `<dl class="spec">${rows.join('')}</dl>`;
}

function rows(projects, base = '') {
  return projects
    .map((p, index) => {
      const cover = p.cover || '';
      // Первые обложки грузим сразу: список — главное содержимое страницы,
      // и пустые рамки в первом экране выглядят поломкой.
      const loading = index < 6 ? 'eager' : 'lazy';
      const gallery = (p.gallery || []).map((item) => item.src).filter(Boolean);
      const frames = [...new Set([cover, ...gallery].filter(Boolean))];
      const data = frames.length
        ? ` data-images="${frames.map((src) => esc(`${base}${src}`)).join('|')}" data-alt="${esc(p.title)}"`
        : '';
      return `<li>
  <a class="row${cover ? '' : ' no-cover'}" href="${base}/work/${esc(p.slug)}"${data}>
    ${cover ? `<span class="row-media"><img src="${base}${esc(cover)}" alt="" loading="${loading}" decoding="async"></span>` : ''}
    <span class="row-year">${esc(p.year || '')}</span>
    <span class="row-title">${esc(p.title)}</span>
    <span class="row-cat">${esc(p.category || '')}</span>
    <span class="row-arrow">${arrow}</span>
  </a>
</li>`;
    })
    .join('\n');
}

function indexPage({ settings, projects }) {
  const base = baseOf(settings);
  const count = projects.length;
  const meta = count
    ? `${count} ${plural(count, 'работа', 'работы', 'работ')}${yearsSpan(projects) ? `, ${yearsSpan(projects)}` : ''}`
    : '';

  const body = `<section class="hero">
  <div class="hero-main">
    <h1 class="hero-name">${esc(settings.siteName)}</h1>
    ${settings.role ? `<p class="hero-role">${esc(settings.role)}</p>` : ''}
    ${settings.lead ? `<p class="hero-lead">${esc(settings.lead)}</p>` : ''}
  </div>
  ${spec(settings)}
</section>

<section class="works" id="works" aria-labelledby="works-title">
  <div class="section-head">
    <h2 class="section-title" id="works-title">Указатель работ</h2>
    ${meta ? `<p class="section-meta">${esc(meta)}</p>` : ''}
  </div>
  ${
    count
      ? `<ol class="index">
${rows(projects, base)}
</ol>`
      : `<div class="empty-state">
    <p class="empty-title">Пока нет опубликованных работ</p>
    ${
      settings.static
        ? '<p class="empty-text">Работы появятся здесь после следующей сборки сайта.</p>'
        : `<p class="empty-text">Откройте <a href="${base}/admin">управление</a> и добавьте первую работу — название, описание и обложку.</p>`
    }
  </div>`
  }
</section>

<div class="peek" aria-hidden="true"><img alt="" decoding="async"><div class="peek-dots" hidden></div></div>`;

  return layout({
    title: settings.siteName ? `${settings.siteName} — работы и проекты` : 'Работы и проекты',
    description: settings.lead,
    body,
    settings,
    active: count ? 'works' : '',
    head: `<script src="${base}/js/site.js" defer></script>`,
  });
}

function aboutPage({ settings }) {
  const body = `<section class="about">
  <h1 class="about-title">О себе</h1>
  <div class="about-grid">
    <div class="prose">${textBlocks((settings.about || []).join('\n\n'))}</div>
    <aside class="about-side">
      ${spec(settings)}
      ${
        hasContacts(settings)
          ? `<div class="contact-block">
        ${settings.email ? `<a class="button" href="${esc(mailLink(settings.email, settings.mailSubject))}">Написать письмо</a>` : ''}
        ${contactLinks(settings, { mail: false })}
      </div>`
          : ''
      }
    </aside>
  </div>
</section>`;

  return layout({
    title: `О себе — ${settings.siteName}`,
    description: (settings.about || [])[0] || settings.lead,
    body,
    settings,
    active: 'about',
  });
}

function workPage({ project, settings, prev, next }) {
  const base = baseOf(settings);
  const links = (project.links || [])
    .map((l) => safeUrl(l.url))
    .map((url, i) => (url ? `<a href="${esc(url)}" rel="noopener">${esc(project.links[i].label || url)}</a>` : ''))
    .filter(Boolean)
    .join('');

  const facts = [
    project.year ? `<div class="fact"><dt>Год</dt><dd>${esc(project.year)}</dd></div>` : '',
    project.stack.length ? `<div class="fact"><dt>Стек</dt><dd>${esc(project.stack.join(', '))}</dd></div>` : '',
    links ? `<div class="fact"><dt>Ссылки</dt><dd class="fact-links">${links}</dd></div>` : '',
  ]
    .filter(Boolean)
    .join('');

  const gallery = (project.gallery || []).length
    ? `<div class="gallery">${project.gallery
        .map(
          (item, i) => `<figure>
  <img src="${base}${esc(item.src)}" alt="${esc(item.alt || `${project.title} — изображение ${i + 1}`)}" loading="lazy" decoding="async">
  ${item.alt ? `<figcaption>${esc(item.alt)}</figcaption>` : ''}
</figure>`,
        )
        .join('')}</div>`
    : '';

  const contact = hasContacts(settings)
    ? `<section class="contact-strip" aria-labelledby="contact-strip-title">
  <div class="contact-strip-text">
    <h2 class="contact-strip-title" id="contact-strip-title">Обсудить задачу</h2>
    <p class="contact-strip-note">Письмо откроется с готовой темой — можно писать сразу.</p>
  </div>
  <div class="contact-strip-actions">
    ${settings.email ? `<a class="button" href="${esc(mailLink(settings.email, settings.mailSubject))}">Написать письмо</a>` : ''}
    ${contactLinks(settings, { mail: false })}
  </div>
</section>`
    : '';

  const pager =
    prev || next
      ? `<nav class="pager" aria-label="Другие работы">
  ${prev ? `<a class="pager-link" href="${base}/work/${esc(prev.slug)}"><span class="pager-label">Предыдущая</span><span class="pager-title">${esc(prev.title)}</span></a>` : '<span></span>'}
  ${next ? `<a class="pager-link pager-next" href="${base}/work/${esc(next.slug)}"><span class="pager-label">Следующая</span><span class="pager-title">${esc(next.title)}</span></a>` : ''}
</nav>`
      : '';

  const body = `<article class="work">
  <a class="back" href="${base}/#works">← Все работы</a>
  <header class="work-head">
    ${project.category ? `<p class="work-cat">${esc(project.category)}</p>` : ''}
    <h1 class="work-title">${esc(project.title)}</h1>
    ${project.summary ? `<p class="work-summary">${esc(project.summary)}</p>` : ''}
  </header>
  ${facts ? `<dl class="facts">${facts}</dl>` : ''}
  ${project.cover ? `<figure class="work-cover"><img src="${base}${esc(project.cover)}" alt="Обложка проекта «${esc(project.title)}»" decoding="async"></figure>` : ''}
  <div class="prose work-body">${textBlocks(project.description)}</div>
  ${gallery}
  ${contact}
  ${pager}
</article>`;

  return layout({
    title: `${project.title} — ${settings.siteName}`,
    description: project.summary || settings.lead,
    body,
    settings,
    active: 'works',
  });
}

function notFoundPage({ settings }) {
  const body = `<section class="not-found">
  <p class="not-found-code">404</p>
  <h1 class="not-found-title">Страница не найдена</h1>
  <p class="not-found-text">Возможно, работа была переименована или снята с публикации.</p>
  <a class="button" href="${baseOf(settings)}/">На главную</a>
</section>`;

  return layout({ title: `Страница не найдена — ${settings.siteName}`, description: '', body, settings, noindex: true });
}

module.exports = { layout, indexPage, aboutPage, workPage, notFoundPage, esc };
