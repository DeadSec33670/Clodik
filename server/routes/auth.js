'use strict';
const db = require('../lib/db');
const { hashPassword, verifyPassword, sign, randomPassword } = require('../lib/auth');
const { normalizePhone, validEmail, validPassword, validName } = require('../lib/validate');
const { tierFor } = require('../lib/loyalty');
const { sendEmail } = require('../integrations/email');

const findByPhone = db.prepare('SELECT * FROM users WHERE phone = ?');
const findByEmail = db.prepare('SELECT * FROM users WHERE email = ?');
const insertUser = db.prepare(
  'INSERT INTO users (name, phone, email, password_hash, spent, bonuses, created_at) VALUES (?, ?, ?, ?, 0, 0, ?)'
);
const updatePass = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?');

/** Публичное представление пользователя (без хэша пароля). */
function publicUser(u) {
  const t = tierFor(u.spent);
  return {
    id: u.id, name: u.name, phone: u.phone, email: u.email,
    spent: u.spent, bonuses: u.bonuses,
    tier: { key: t.key, name: t.name, icon: t.icon, rate: t.rate },
    createdAt: u.created_at,
  };
}

function register(ctx) {
  const { name, password, email } = ctx.body;
  const phone = normalizePhone(ctx.body.phone);

  // Все поля обязательны (ТЗ)
  if (!validName(name)) return ctx.error(400, 'name_required', 'Укажите имя');
  if (!phone) return ctx.error(400, 'bad_phone', 'Телефон должен содержать 11 цифр');
  if (!validPassword(password)) return ctx.error(400, 'bad_password', 'Пароль — минимум 6 символов');
  if (!validEmail(email)) return ctx.error(400, 'bad_email', 'Введите корректный email');

  const normEmail = String(email).trim().toLowerCase();
  // Уникальность: один телефон = один аккаунт, одна почта = один аккаунт
  if (findByPhone.get(phone)) return ctx.error(409, 'phone_taken', 'Этот номер уже привязан — войдите');
  if (findByEmail.get(normEmail)) return ctx.error(409, 'email_taken', 'Эта почта уже привязана — войдите');

  const info = insertUser.run(name.trim(), phone, normEmail, hashPassword(password), Date.now());
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  return ctx.created({ token: sign({ uid: user.id }), user: publicUser(user) });
}

function login(ctx) {
  const phone = normalizePhone(ctx.body.phone);
  const { password } = ctx.body;
  if (!phone) return ctx.error(400, 'bad_phone', 'Введите корректный номер телефона');
  if (!password) return ctx.error(400, 'password_required', 'Введите пароль');

  const user = findByPhone.get(phone);
  // Вход только для существующего аккаунта (ТЗ)
  if (!user) return ctx.error(404, 'no_account', 'Аккаунт не найден — создайте новый');
  if (!verifyPassword(password, user.password_hash)) {
    return ctx.error(401, 'bad_credentials', 'Неверный пароль');
  }
  return ctx.ok({ token: sign({ uid: user.id }), user: publicUser(user) });
}

/**
 * Восстановление пароля: по привязанному email генерируем новый пароль
 * и отправляем его на почту (email-сервис). Ответ всегда одинаковый,
 * чтобы не раскрывать, существует ли аккаунт с таким email.
 */
async function forgot(ctx) {
  const email = String(ctx.body.email || '').trim().toLowerCase();
  if (!validEmail(email)) return ctx.error(400, 'bad_email', 'Введите корректный email');

  const user = findByEmail.get(email);
  if (user) {
    const newPass = randomPassword(10);
    updatePass.run(hashPassword(newPass), user.id);
    try {
      await sendEmail({
        to: email,
        subject: 'ArhoShop — восстановление пароля',
        text: `Здравствуйте, ${user.name}!\n\nВаш новый пароль для входа в ArhoShop: ${newPass}\n\nРекомендуем сменить его в личном кабинете после входа.`,
      });
    } catch (e) {
      console.error('[forgot] email send failed:', e.message);
    }
  }
  return ctx.ok({ ok: true, message: 'Если аккаунт с такой почтой существует — пароль отправлен на email' });
}

module.exports = { register, login, forgot, publicUser };
