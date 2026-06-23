'use strict';
const db = require('../lib/db');
const { hashPassword, verifyPassword } = require('../lib/auth');
const { normalizePhone, validEmail, validPassword, validName } = require('../lib/validate');
const { publicUser } = require('./auth');
const { tierFor, TIERS, progress } = require('../lib/loyalty');

const byId = db.prepare('SELECT * FROM users WHERE id = ?');
const phoneTaken = db.prepare('SELECT id FROM users WHERE phone = ? AND id <> ?');
const emailTaken = db.prepare('SELECT id FROM users WHERE email = ? AND id <> ?');
const ordersOf = db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC');

/** Достаём авторизованного пользователя или 401. */
function requireUser(ctx) {
  if (!ctx.auth || !ctx.auth.uid) { ctx.error(401, 'unauthorized', 'Требуется вход'); return null; }
  const user = byId.get(ctx.auth.uid);
  if (!user) { ctx.error(401, 'unauthorized', 'Сессия недействительна'); return null; }
  return user;
}

/** Дашборд: профиль + лояльность + история заказов. */
function me(ctx) {
  const user = requireUser(ctx);
  if (!user) return;
  const t = tierFor(user.spent);
  const orders = ordersOf.all(user.id).map((o) => ({
    id: o.id, total: o.total, status: o.status, delivery: o.delivery,
    earnedBonuses: o.earned_bonuses, createdAt: o.created_at,
    items: JSON.parse(o.items_json),
    count: JSON.parse(o.items_json).reduce((s, i) => s + (i.qty || 1), 0),
  }));
  return ctx.ok({
    user: publicUser(user),
    loyalty: {
      spent: user.spent,
      bonuses: user.bonuses,
      tier: { key: t.key, name: t.name, icon: t.icon, rate: t.rate },
      next: t.next ? { name: t.next.name, min: t.next.min } : null,
      toNext: t.next ? t.next.min - user.spent : 0,
      progress: progress(user.spent),
      tiers: TIERS,
    },
    orders,
  });
}

function updateProfile(ctx) {
  const user = requireUser(ctx);
  if (!user) return;
  const { name } = ctx.body;
  const phone = normalizePhone(ctx.body.phone);
  const email = String(ctx.body.email || '').trim().toLowerCase();

  if (!validName(name)) return ctx.error(400, 'name_required', 'Укажите имя');
  if (!phone) return ctx.error(400, 'bad_phone', 'Телефон должен содержать 11 цифр');
  if (!validEmail(email)) return ctx.error(400, 'bad_email', 'Введите корректный email');
  if (phoneTaken.get(phone, user.id)) return ctx.error(409, 'phone_taken', 'Этот номер уже занят');
  if (emailTaken.get(email, user.id)) return ctx.error(409, 'email_taken', 'Эта почта уже занята');

  db.prepare('UPDATE users SET name = ?, phone = ?, email = ? WHERE id = ?')
    .run(name.trim(), phone, email, user.id);
  return ctx.ok({ user: publicUser(byId.get(user.id)) });
}

function changePassword(ctx) {
  const user = requireUser(ctx);
  if (!user) return;
  const { current, next } = ctx.body;
  if (!verifyPassword(current, user.password_hash)) {
    return ctx.error(400, 'bad_current', 'Неверный текущий пароль');
  }
  if (!validPassword(next)) return ctx.error(400, 'bad_password', 'Новый пароль — минимум 6 символов');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(next), user.id);
  return ctx.ok({ ok: true });
}

module.exports = { me, updateProfile, changePassword, requireUser };
