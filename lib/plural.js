'use strict';

/**
 * Счётчик штук по-русски: 1 работа, 2 работы, 5 работ.
 */
function plural(n, one, few, many) {
  const abs = Math.abs(Number(n) || 0);
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

module.exports = { plural };
