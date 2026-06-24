'use strict';
const db = require('../lib/db');
const { sign } = require('../lib/auth');
const { TIERS } = require('../lib/loyalty');

/**
 * Админ-панель: вход по паролю (ARHO_ADMIN_PASSWORD) и статистика заказов.
 * Токен админа подписывается с полем { admin:true }; обычные пользовательские
 * токены сюда не подходят.
 */

const ADMIN_PASSWORD = process.env.ARHO_ADMIN_PASSWORD || 'admin';

function login(ctx) {
  const { password } = ctx.body;
  if (!password || password !== ADMIN_PASSWORD) {
    return ctx.error(401, 'bad_admin', 'Неверный пароль администратора');
  }
  return ctx.ok({ token: sign({ admin: true }) });
}

function requireAdmin(ctx) {
  if (!ctx.auth || ctx.auth.admin !== true) {
    ctx.error(401, 'unauthorized', 'Требуется вход администратора');
    return false;
  }
  return true;
}

const q = {
  totals: db.prepare('SELECT COUNT(*) c, COALESCE(SUM(total),0) rev, COALESCE(SUM(earned_bonuses),0) bonuses FROM orders'),
  byStatus: db.prepare('SELECT status, COUNT(*) c, COALESCE(SUM(total),0) rev FROM orders GROUP BY status'),
  byDay: db.prepare(`SELECT date(created_at/1000,'unixepoch') d, COUNT(*) c, COALESCE(SUM(total),0) rev
                     FROM orders GROUP BY d ORDER BY d DESC LIMIT 14`),
  usersCount: db.prepare('SELECT COUNT(*) c FROM users'),
  spentSum: db.prepare('SELECT COALESCE(SUM(spent),0) s, COALESCE(SUM(bonuses),0) b FROM users'),
  recent: db.prepare(`SELECT o.*, u.name u_name, u.phone u_phone, u.email u_email
                      FROM orders o LEFT JOIN users u ON u.id = o.user_id
                      ORDER BY o.created_at DESC LIMIT ?`),
  allItems: db.prepare('SELECT items_json FROM orders'),
  topUsers: db.prepare(`SELECT name, phone, spent, bonuses FROM users ORDER BY spent DESC LIMIT 5`),
};

/** Сводная статистика для дашборда. */
function stats(ctx) {
  if (!requireAdmin(ctx)) return;
  const totals = q.totals.get();
  const byStatus = q.byStatus.all();
  const byDay = q.byDay.all().reverse(); // по возрастанию даты для графика
  const users = q.usersCount.get().c;
  const loyalty = q.spentSum.get();

  // Топ товаров по количеству продаж (из позиций заказов)
  const sold = {};
  for (const row of q.allItems.all()) {
    let items = [];
    try { items = JSON.parse(row.items_json); } catch {}
    for (const it of items) {
      const key = it.productId != null ? String(it.productId) : (it.name || '—');
      if (!sold[key]) sold[key] = { productId: it.productId ?? null, name: it.name || '—', qty: 0, revenue: 0 };
      sold[key].qty += Number(it.qty) || 0;
      sold[key].revenue += (Number(it.price) || 0) * (Number(it.qty) || 0);
    }
  }
  const topProducts = Object.values(sold).sort((a, b) => b.qty - a.qty).slice(0, 8);

  const avg = totals.c ? Math.round(totals.rev / totals.c) : 0;

  // Распределение клиентов по уровням лояльности
  const tierDist = {};
  TIERS.forEach((t) => (tierDist[t.key] = 0));
  for (const u of db.prepare('SELECT spent FROM users').all()) {
    let key = 'none';
    for (const t of TIERS) if (u.spent >= t.min) key = t.key;
    tierDist[key] = (tierDist[key] || 0) + 1;
  }

  return ctx.ok({
    totals: { orders: totals.c, revenue: totals.rev, bonusesIssued: totals.bonuses, avgOrder: avg },
    byStatus,
    byDay,
    users,
    loyalty: { spentTotal: loyalty.s, bonusesBalance: loyalty.b, tierDist, tiers: TIERS },
    topProducts,
    topUsers: q.topUsers.all(),
  });
}

/** Список последних заказов (для таблицы). */
function orders(ctx) {
  if (!requireAdmin(ctx)) return;
  const limit = Math.min(200, Math.max(1, Number(ctx.query.limit) || 50));
  const rows = q.recent.all(limit).map((o) => ({
    id: o.id,
    customer: o.user_id ? { name: o.u_name, phone: o.u_phone, email: o.u_email, registered: true }
                        : { name: o.guest_name, phone: o.guest_phone, registered: false },
    total: o.total,
    delivery: o.delivery,
    city: o.city,
    status: o.status,
    earnedBonuses: o.earned_bonuses,
    items: (() => { try { return JSON.parse(o.items_json); } catch { return []; } })(),
    createdAt: o.created_at,
  }));
  return ctx.ok({ orders: rows });
}

const VALID_STATUS = ['created', 'pending_payment', 'paid', 'shipped', 'delivered', 'cancelled'];

/** Изменение статуса заказа администратором. */
function updateOrderStatus(ctx) {
  if (!requireAdmin(ctx)) return;
  const id = ctx.params.id;
  const { status } = ctx.body;
  if (!VALID_STATUS.includes(status)) return ctx.error(400, 'bad_status', 'Недопустимый статус');
  const order = db.prepare('SELECT id FROM orders WHERE id = ?').get(id);
  if (!order) return ctx.error(404, 'not_found', 'Заказ не найден');
  db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, id);
  return ctx.ok({ id, status });
}

module.exports = { login, stats, orders, updateOrderStatus, VALID_STATUS };
