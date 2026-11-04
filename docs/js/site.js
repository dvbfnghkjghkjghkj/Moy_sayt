'use strict';

/**
 * Превью галереи в «Указателе работ».
 *
 * Наведите курсор на любую точку строки и ведите вдоль неё — карточка
 * показывает изображения проекта по порядку: положение курсора по
 * горизонтали задаёт кадр. Точки внизу карточки показывают, сколько
 * изображений в работе и какое открыто сейчас.
 *
 * Работает только на устройствах с точным указателем; на сенсорных
 * экранах превью нет, обложка видна прямо в строке.
 */

(() => {
  const peek = document.querySelector('.peek');
  if (!peek) return;

  const img = peek.querySelector('img');
  const dots = peek.querySelector('.peek-dots');
  if (!img || !dots) return;

  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const GAP = 34;
  const MAX_FRAMES = 8;
  const preloaded = new Set();

  let frames = [];
  let frameIndex = -1;
  let activeRow = null;
  let visible = false;
  let targetX = 0;
  let targetY = 0;
  let x = 0;
  let y = 0;
  let frameId = 0;
  let lastX = 0;
  let lastY = 0;

  /* ── Кадры ─────────────────────────────────────────────────── */

  // Если изображений больше восьми, берём восемь равномерно — иначе
  // на каждые 40 пикселей строки приходился бы новый кадр.
  function pickFrames(list) {
    if (list.length <= MAX_FRAMES) return list;
    const step = (list.length - 1) / (MAX_FRAMES - 1);
    return Array.from({ length: MAX_FRAMES }, (_, i) => list[Math.round(i * step)]);
  }

  function preload(list) {
    for (const src of list) {
      if (preloaded.has(src)) continue;
      preloaded.add(src);
      const image = new Image();
      image.decoding = 'async';
      image.src = src;
    }
  }

  function renderDots() {
    if (frames.length < 2) {
      dots.hidden = true;
      dots.textContent = '';
      return;
    }
    dots.hidden = false;
    if (dots.childElementCount !== frames.length) {
      dots.textContent = '';
      for (let i = 0; i < frames.length; i += 1) dots.appendChild(document.createElement('span'));
    }
    Array.from(dots.children).forEach((dot, i) => {
      dot.className = i === frameIndex ? 'peek-dot is-active' : 'peek-dot';
    });
  }

  function setFrame(index) {
    if (!frames.length) return;
    const next = Math.min(frames.length - 1, Math.max(0, index));
    if (next === frameIndex) return;
    frameIndex = next;
    img.src = frames[next];
    renderDots();
  }

  function frameFromPointer(row, clientX) {
    const rect = row.getBoundingClientRect();
    const progress = Math.min(0.9999, Math.max(0, (clientX - rect.left) / rect.width));
    return Math.floor(progress * frames.length);
  }

  /* ── Положение карточки ────────────────────────────────────── */

  function place(clientX, clientY) {
    const width = peek.offsetWidth || 360;
    const height = peek.offsetHeight || 270;
    lastX = clientX;
    lastY = clientY;
    targetX = clientX + GAP;
    targetY = clientY - height / 2;
    if (targetX + width > window.innerWidth - 16) targetX = clientX - width - GAP;
    if (targetX < 16) targetX = 16;
    if (targetY < 16) targetY = 16;
    if (targetY + height > window.innerHeight - 16) targetY = window.innerHeight - height - 16;
  }

  function tick() {
    const k = reduceMotion ? 1 : 0.22;
    x += (targetX - x) * k;
    y += (targetY - y) * k;
    peek.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
    if (Math.abs(targetX - x) > 0.5 || Math.abs(targetY - y) > 0.5) {
      frameId = requestAnimationFrame(tick);
    } else {
      frameId = 0;
    }
  }

  function startMotion() {
    if (!frameId) frameId = requestAnimationFrame(tick);
  }

  /* ── Показ ─────────────────────────────────────────────────── */

  function open(row, clientX, clientY, forcedFrame) {
    const raw = (row.dataset.images || '').split('|').filter(Boolean);
    if (!raw.length) return false;

    frames = pickFrames(raw);
    frameIndex = -1;
    preload(frames);
    img.alt = '';
    activeRow = row;
    setFrame(typeof forcedFrame === 'number' ? forcedFrame : frameFromPointer(row, clientX));
    place(clientX, clientY);

    if (!visible) {
      visible = true;
      peek.classList.add('is-visible');
      x = targetX;
      y = targetY;
    }
    startMotion();
    return true;
  }

  function hide() {
    visible = false;
    activeRow = null;
    frames = [];
    peek.classList.remove('is-visible');
    if (frameId) {
      cancelAnimationFrame(frameId);
      frameId = 0;
    }
  }

  document.addEventListener('pointerover', (event) => {
    const row = event.target.closest('.row');
    if (!row || row === activeRow) return;
    open(row, event.clientX, event.clientY);
  });

  document.addEventListener('pointermove', (event) => {
    if (!activeRow) return;
    place(event.clientX, event.clientY);
    setFrame(frameFromPointer(activeRow, event.clientX));
    startMotion();
  });

  document.addEventListener('pointerout', (event) => {
    const row = event.target.closest('.row');
    if (!row || row !== activeRow) return;
    if (event.relatedTarget && row.contains(event.relatedTarget)) return;
    hide();
  });

  // С клавиатуры показываем первый кадр — без протяжки.
  document.addEventListener('focusin', (event) => {
    const row = event.target.closest('.row');
    if (!row || row === activeRow) return;
    const rect = row.getBoundingClientRect();
    open(row, rect.right - 60, rect.top + rect.height / 2, 0);
  });

  document.addEventListener('focusout', (event) => {
    const row = event.target.closest('.row');
    if (row && row === activeRow) hide();
  });

  // Прокрутка: карточка «приклеена» к строке, поэтому держим её на месте
  // курсора, а уехавшую из окна строку просто отпускаем.
  window.addEventListener('scroll', () => {
    if (!activeRow) return;
    const rect = activeRow.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight) {
      hide();
      return;
    }
    place(lastX, lastY);
    startMotion();
  }, { passive: true });

  // Курсор ушёл за пределы окна — убираем превью, иначе оно «зависает».
  document.addEventListener('pointerleave', hide);
  window.addEventListener('blur', hide);
})();
