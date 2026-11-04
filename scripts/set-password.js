'use strict';

/**
 * Смена пароля администратора из терминала:
 *   node scripts/set-password.js "новый пароль"
 * Пароль должен быть не короче 8 символов.
 */

const auth = require('../lib/auth');

const password = process.argv[2];

if (!password) {
  console.error('Укажите пароль: node scripts/set-password.js "новый пароль"');
  process.exit(1);
}

try {
  auth.setPassword(password);
  console.log('Пароль изменён. Вход: /admin');
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
