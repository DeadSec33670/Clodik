'use strict';
const crypto = require('node:crypto');

/**
 * Аутентификация без внешних зависимостей.
 *  - Пароли: scrypt с индивидуальной солью (формат "scrypt$salt$hash").
 *  - Сессии: компактный подписанный токен (HMAC-SHA256) — самодостаточный,
 *    как JWT, но без сторонних библиотек.
 */

const SECRET = process.env.ARHO_SECRET || 'dev-insecure-secret-change-me';
const TOKEN_TTL = Number(process.env.ARHO_TOKEN_TTL || 60 * 60 * 24 * 30); // 30 дней

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const test = crypto.scryptSync(String(password), salt, 64).toString('hex');
  const a = Buffer.from(test, 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function sign(payload) {
  const body = b64url(JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000) }));
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verify(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); }
  catch { return null; }
  if (!payload.iat || Date.now() / 1000 - payload.iat > TOKEN_TTL) return null;
  return payload;
}

/** Случайный пароль для восстановления (читаемый). */
function randomPassword(len = 10) {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let out = '';
  const bytes = crypto.randomBytes(len);
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

module.exports = { hashPassword, verifyPassword, sign, verify, randomPassword };
