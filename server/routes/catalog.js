'use strict';
const db = require('../lib/db');

/**
 * Популярность товаров для блока «Популярное сейчас».
 * Ранжирование строго по числу просмотров (кликов по товару) — бизнес-правило ТЗ.
 * Сами данные каталога отдаются статикой (site/data/*.json, ленивая подгрузка).
 */

const bump = db.prepare(`
  INSERT INTO product_views (product_id, views) VALUES (?, 1)
  ON CONFLICT(product_id) DO UPDATE SET views = views + 1
`);
const top = db.prepare('SELECT product_id, views FROM product_views ORDER BY views DESC, product_id ASC LIMIT ?');

/** Зафиксировать просмотр товара. */
function view(ctx) {
  const id = String(ctx.params.id || '').slice(0, 64);
  if (!id) return ctx.error(400, 'bad_id', 'Не указан товар');
  bump.run(id);
  const row = db.prepare('SELECT views FROM product_views WHERE product_id = ?').get(id);
  return ctx.ok({ productId: id, views: row.views });
}

/** Топ популярных товаров (id + просмотры). Витрина сама подмешивает данные товара. */
function popular(ctx) {
  const limit = Math.min(50, Math.max(1, Number(ctx.query.limit) || 12));
  return ctx.ok({ items: top.all(limit) });
}

module.exports = { view, popular };
