'use strict';
/** Валидация по бизнес-правилам ТЗ. */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Только цифры из строки. */
function digits(s) {
  return String(s || '').match(/\d/g)?.join('') || '';
}

/**
 * Нормализация телефона к 11 цифрам российского формата.
 * 8XXXXXXXXXX → 7XXXXXXXXXX, 9XXXXXXXXXX → 79XXXXXXXXXX.
 * Возвращает 11-значную строку или null.
 */
function normalizePhone(raw) {
  let d = digits(raw);
  if (d && d[0] === '8') d = '7' + d.slice(1);
  if (d.length === 10 && d[0] === '9') d = '7' + d;
  d = d.slice(0, 11);
  return d.length === 11 ? d : null;
}

function validEmail(email) {
  return EMAIL_RE.test(String(email || '').trim());
}

function validPassword(pw) {
  return typeof pw === 'string' && pw.length >= 6;
}

function validName(name) {
  return typeof name === 'string' && name.trim().length > 0;
}

module.exports = { digits, normalizePhone, validEmail, validPassword, validName };
