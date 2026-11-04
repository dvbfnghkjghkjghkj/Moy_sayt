'use strict';

/**
 * Ссылки на контакты. Одна логика для страниц и для проверки в API,
 * чтобы формат ссылки не разъезжался между шаблоном и сервером.
 *
 * Метка в ссылке нужна, чтобы сообщение было узнаваемо: у письма это
 * тема, у WhatsApp — первая фраза. Telegram и MAX в личный чат текст
 * подставлять не умеют, поэтому там ссылка идёт как есть.
 */

const DEFAULT_MAIL_SUBJECT = 'Интерфейсы и серверные приложения';
const DEFAULT_WA_TEXT = 'Здравствуйте! Пишу с сайта — интересует разработка интерфейсов и серверных приложений.';

// +7 999 123-45-67, 89991234567, 8 (999) 123-45-67 → 79991234567
function waDigits(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 11 && digits[0] === '8') digits = `7${digits.slice(1)}`;
  else if (digits.length === 10) digits = `7${digits}`;
  return digits;
}

function waLink(number, text) {
  const digits = waDigits(number);
  if (digits.length < 10 || digits.length > 15) return '';
  const base = `https://wa.me/${digits}`;
  const message = String(text || '').trim();
  return message ? `${base}?text=${encodeURIComponent(message)}` : base;
}

function mailLink(email, subject) {
  const address = String(email || '').trim();
  if (!address) return '';
  const theme = String(subject || '').trim();
  return theme ? `mailto:${address}?subject=${encodeURIComponent(theme)}` : `mailto:${address}`;
}

// https://max.ru/u/123, max.ru/u/123, @nickname → полный адрес
function maxUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  // Телефон — не адрес профиля: в MAX ссылка ведёт на @ник или /u/<id>,
  // а номер в пути даёт нерабочий адрес вида max.ru/+7 904 …
  if (/^[+\d\s().-]+$/.test(raw)) return '';

  if (/^https?:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      if (!/(^|\.)max\.ru$/i.test(parsed.hostname)) return '';
      // Адрес мог сохраниться раньше из телефона: max.ru/+7 904 …
      if (/^\+?[\d\s()-]{10,}$/.test(decodeURIComponent(parsed.pathname).replace(/^\/+/, ''))) return '';
      return parsed.href;
    } catch {
      return '';
    }
  }
  // чужой протокол (javascript:, data:, tel:) ссылкой MAX не считаем
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return '';
  if (/\s/.test(raw)) return '';
  if (/^@/.test(raw)) return `https://max.ru/${raw.slice(1)}`;
  if (/^max\.ru(\/|$)/i.test(raw)) return `https://${raw}`;
  return `https://max.ru/${raw.replace(/^\/+/, '')}`;
}

module.exports = { DEFAULT_MAIL_SUBJECT, DEFAULT_WA_TEXT, waDigits, waLink, mailLink, maxUrl };
