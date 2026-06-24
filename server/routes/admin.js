'use strict';
const db = require('../lib/db');
const { sign } = require('../lib/auth');
const { TIERS, tierFor } = require('../lib/loyalty');

/**
 * Админ-панель: вход по паролю (ARHO_ADMIN_PASSWORD) и аналитика заказов.
 * Токен админа подписывается с { admin:true }.
 */

const ADMIN_PASSWORD = process.env.ARHO_ADMIN_PASSWORD || 'admin';
const DAY = 86400000;
const VALID_STATUS = ['created', 'pending_payment', 'paid', 'shipped', 'delivered', 'cancelled'];

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

/* ---------- helpers ---------- */

function parseItems(json) { try { return JSON.parse(json) || []; } catch { return []; } }

/** Диапазон по ?period= или ?from=&to= (мс). */
function rangeFor(query) {
  const now = Date.now();
  if (query.from || query.to) {
    const from = Number(query.from) || 0;
    const to = Number(query.to) || now;
    return { from, to, days: Math.max(1, Math.round((to - from) / DAY)), label: 'период' };
  }
  const p = query.period || '30d';
  if (p === 'all') return { from: 0, to: now, days: null, label: 'всё время' };
  if (p === 'today') { const d = new Date(); d.setHours(0, 0, 0, 0); return { from: d.getTime(), to: now, days: 1, label: 'сегодня' }; }
  const map = { '7d': 7, '30d': 30, '90d': 90, '365d': 365 };
  const days = map[p] || 30;
  return { from: now - days * DAY, to: now, days, label: `${days} дн.` };
}

const ordersInRange = db.prepare(
  'SELECT id, user_id, total, delivery, city, status, earned_bonuses, items_json, created_at FROM orders WHERE created_at >= ? AND created_at < ? ORDER BY created_at ASC'
);

/** Свёртка набора заказов в агрегаты. */
function aggregate(rows) {
  let revenue = 0, bonuses = 0, items = 0;
  for (const o of rows) {
    revenue += o.total;
    bonuses += o.earned_bonuses;
    for (const it of parseItems(o.items_json)) items += Number(it.qty) || 0;
  }
  return { orders: rows.length, revenue, bonuses, items };
}

function growth(cur, prev) {
  if (!prev) return cur ? 100 : 0;
  return Math.round(((cur - prev) / prev) * 100);
}

/* ---------- statistics ---------- */

function stats(ctx) {
  if (!requireAdmin(ctx)) return;
  const r = rangeFor(ctx.query);
  const rows = ordersInRange.all(r.from, r.to);
  const cur = aggregate(rows);

  // Предыдущий период равной длины (для сравнения)
  let prev = { orders: 0, revenue: 0, bonuses: 0, items: 0 };
  if (r.from > 0) {
    const len = r.to - r.from;
    prev = aggregate(ordersInRange.all(r.from - len, r.from));
  }

  // Разбивки
  const byStatusMap = {}, byDeliveryMap = {}, byCityMap = {}, byDayMap = {}, soldMap = {};
  for (const o of rows) {
    (byStatusMap[o.status] = byStatusMap[o.status] || { c: 0, rev: 0 }).c++;
    byStatusMap[o.status].rev += o.total;
    const dlv = o.delivery || '—';
    (byDeliveryMap[dlv] = byDeliveryMap[dlv] || { c: 0, rev: 0 }).c++;
    byDeliveryMap[dlv].rev += o.total;
    const city = (o.city || '—').trim() || '—';
    (byCityMap[city] = byCityMap[city] || { c: 0, rev: 0 }).c++;
    byCityMap[city].rev += o.total;
    const day = new Date(o.created_at).toISOString().slice(0, 10);
    (byDayMap[day] = byDayMap[day] || { c: 0, rev: 0 }).c++;
    byDayMap[day].rev += o.total;
    for (const it of parseItems(o.items_json)) {
      const key = it.productId != null ? String(it.productId) : (it.name || '—');
      if (!soldMap[key]) soldMap[key] = { productId: it.productId ?? null, name: it.name || '—', qty: 0, revenue: 0 };
      soldMap[key].qty += Number(it.qty) || 0;
      soldMap[key].revenue += (Number(it.price) || 0) * (Number(it.qty) || 0);
    }
  }

  // Временной ряд по дням с заполнением пропусков (до 92 точек)
  let byDay;
  if (r.days && r.days <= 92) {
    byDay = [];
    const start = new Date(r.from); start.setHours(0, 0, 0, 0);
    for (let t = start.getTime(); t < r.to; t += DAY) {
      const key = new Date(t).toISOString().slice(0, 10);
      const v = byDayMap[key] || { c: 0, rev: 0 };
      byDay.push({ d: key, orders: v.c, revenue: v.rev });
    }
  } else {
    byDay = Object.entries(byDayMap).sort((a, b) => a[0] < b[0] ? -1 : 1).map(([d, v]) => ({ d, orders: v.c, revenue: v.rev }));
  }

  const toArr = (m) => Object.entries(m).map(([k, v]) => ({ key: k, c: v.c, rev: v.rev })).sort((a, b) => b.rev - a.rev);

  // Лояльность (по всем клиентам)
  const tierDist = {}; TIERS.forEach((t) => (tierDist[t.key] = 0));
  let spentTotal = 0, bonusesBalance = 0;
  for (const u of db.prepare('SELECT spent, bonuses FROM users').all()) {
    spentTotal += u.spent; bonusesBalance += u.bonuses;
    tierDist[tierFor(u.spent).key] = (tierDist[tierFor(u.spent).key] || 0) + 1;
  }
  const totalUsers = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  const newUsers = r.from > 0
    ? db.prepare('SELECT COUNT(*) c FROM users WHERE created_at >= ? AND created_at < ?').get(r.from, r.to).c
    : totalUsers;
  const repeatCustomers = db.prepare('SELECT COUNT(*) c FROM (SELECT user_id FROM orders WHERE user_id IS NOT NULL GROUP BY user_id HAVING COUNT(*) > 1)').get().c;

  return ctx.ok({
    range: { from: r.from, to: r.to, label: r.label, days: r.days },
    kpis: {
      orders: cur.orders, revenue: cur.revenue, bonusesIssued: cur.bonuses, items: cur.items,
      avgOrder: cur.orders ? Math.round(cur.revenue / cur.orders) : 0,
      newCustomers: newUsers,
      growth: {
        orders: growth(cur.orders, prev.orders),
        revenue: growth(cur.revenue, prev.revenue),
        avgOrder: growth(cur.orders ? cur.revenue / cur.orders : 0, prev.orders ? prev.revenue / prev.orders : 0),
      },
    },
    series: byDay,
    byStatus: toArr(byStatusMap),
    byDelivery: toArr(byDeliveryMap),
    byCity: toArr(byCityMap).slice(0, 8),
    topProducts: Object.values(soldMap).sort((a, b) => b.qty - a.qty).slice(0, 10),
    loyalty: { tierDist, tiers: TIERS, spentTotal, bonusesBalance },
    totals: { users: totalUsers, repeatCustomers },
  });
}

/* ---------- orders list (фильтры + пагинация) ---------- */

function buildOrderWhere(query) {
  const conds = [], params = [];
  if (query.status && VALID_STATUS.includes(query.status)) { conds.push('o.status = ?'); params.push(query.status); }
  if (query.from) { conds.push('o.created_at >= ?'); params.push(Number(query.from)); }
  if (query.to) { conds.push('o.created_at < ?'); params.push(Number(query.to)); }
  if (query.q) {
    const like = '%' + String(query.q).trim() + '%';
    conds.push('(o.id LIKE ? OR u.name LIKE ? OR u.phone LIKE ? OR u.email LIKE ? OR o.guest_name LIKE ? OR o.guest_phone LIKE ?)');
    params.push(like, like, like, like, like, like);
  }
  return { where: conds.length ? 'WHERE ' + conds.join(' AND ') : '', params };
}

function shapeOrder(o) {
  return {
    id: o.id,
    customer: o.user_id
      ? { name: o.u_name, phone: o.u_phone, email: o.u_email, registered: true }
      : { name: o.guest_name, phone: o.guest_phone, registered: false },
    total: o.total, delivery: o.delivery, city: o.city, status: o.status,
    earnedBonuses: o.earned_bonuses, items: parseItems(o.items_json), createdAt: o.created_at,
  };
}

function orders(ctx) {
  if (!requireAdmin(ctx)) return;
  const { where, params } = buildOrderWhere(ctx.query);
  const page = Math.max(1, Number(ctx.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(ctx.query.limit) || 25));
  const total = db.prepare(`SELECT COUNT(*) c FROM orders o LEFT JOIN users u ON u.id=o.user_id ${where}`).get(...params).c;
  const rows = db.prepare(
    `SELECT o.*, u.name u_name, u.phone u_phone, u.email u_email
     FROM orders o LEFT JOIN users u ON u.id=o.user_id
     ${where} ORDER BY o.created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, (page - 1) * limit);
  return ctx.ok({ orders: rows.map(shapeOrder), total, page, pages: Math.max(1, Math.ceil(total / limit)), limit });
}

function orderDetail(ctx) {
  if (!requireAdmin(ctx)) return;
  const o = db.prepare(
    `SELECT o.*, u.name u_name, u.phone u_phone, u.email u_email
     FROM orders o LEFT JOIN users u ON u.id=o.user_id WHERE o.id = ?`
  ).get(ctx.params.id);
  if (!o) return ctx.error(404, 'not_found', 'Заказ не найден');
  return ctx.ok({ order: shapeOrder(o) });
}

function updateOrderStatus(ctx) {
  if (!requireAdmin(ctx)) return;
  const id = ctx.params.id;
  const { status } = ctx.body;
  if (!VALID_STATUS.includes(status)) return ctx.error(400, 'bad_status', 'Недопустимый статус');
  if (!db.prepare('SELECT id FROM orders WHERE id = ?').get(id)) return ctx.error(404, 'not_found', 'Заказ не найден');
  db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, id);
  return ctx.ok({ id, status });
}

/* ---------- customers ---------- */

function customers(ctx) {
  if (!requireAdmin(ctx)) return;
  const page = Math.max(1, Number(ctx.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(ctx.query.limit) || 25));
  const sortMap = { spent: 'u.spent DESC', bonuses: 'u.bonuses DESC', recent: 'u.created_at DESC', name: 'u.name ASC' };
  const order = sortMap[ctx.query.sort] || 'u.spent DESC';
  const conds = [], params = [];
  if (ctx.query.q) {
    const like = '%' + String(ctx.query.q).trim() + '%';
    conds.push('(u.name LIKE ? OR u.phone LIKE ? OR u.email LIKE ?)');
    params.push(like, like, like);
  }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) c FROM users u ${where}`).get(...params).c;
  const rows = db.prepare(
    `SELECT u.id, u.name, u.phone, u.email, u.spent, u.bonuses, u.created_at,
            (SELECT COUNT(*) FROM orders o WHERE o.user_id=u.id) oc,
            (SELECT MAX(created_at) FROM orders o WHERE o.user_id=u.id) last_order
     FROM users u ${where} ORDER BY ${order} LIMIT ? OFFSET ?`
  ).all(...params, limit, (page - 1) * limit);
  const list = rows.map((u) => {
    const t = tierFor(u.spent);
    return {
      id: u.id, name: u.name, phone: u.phone, email: u.email,
      spent: u.spent, bonuses: u.bonuses, ordersCount: u.oc,
      tier: { key: t.key, name: t.name, icon: t.icon },
      createdAt: u.created_at, lastOrderAt: u.last_order,
    };
  });
  return ctx.ok({ customers: list, total, page, pages: Math.max(1, Math.ceil(total / limit)), limit });
}

/* ---------- CSV export ---------- */

function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function exportOrders(ctx) {
  if (!requireAdmin(ctx)) return;
  const { where, params } = buildOrderWhere(ctx.query);
  const rows = db.prepare(
    `SELECT o.*, u.name u_name, u.phone u_phone, u.email u_email
     FROM orders o LEFT JOIN users u ON u.id=o.user_id ${where} ORDER BY o.created_at DESC`
  ).all(...params);
  const head = ['Номер', 'Дата', 'Клиент', 'Телефон', 'Email', 'Город', 'Доставка', 'Статус', 'Позиций', 'Сумма', 'Бонусы', 'Тип'];
  const lines = [head.join(';')];
  for (const o of rows) {
    const items = parseItems(o.items_json);
    const cnt = items.reduce((s, i) => s + (Number(i.qty) || 0), 0);
    lines.push([
      o.id, new Date(o.created_at).toLocaleString('ru-RU'),
      o.user_id ? o.u_name : o.guest_name, o.user_id ? o.u_phone : o.guest_phone,
      o.user_id ? o.u_email : '', o.city, o.delivery, o.status, cnt, o.total, o.earned_bonuses,
      o.user_id ? 'клиент' : 'гость',
    ].map(csvCell).join(';'));
  }
  // BOM для корректной кириллицы в Excel
  const csv = '﻿' + lines.join('\r\n');
  return ctx.raw(200, csv, 'text/csv; charset=utf-8', {
    'Content-Disposition': 'attachment; filename="arhoshop-orders.csv"',
  });
}

module.exports = { login, stats, orders, orderDetail, updateOrderStatus, customers, exportOrders, VALID_STATUS };
