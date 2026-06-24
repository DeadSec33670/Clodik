'use strict';
const db = require('../lib/db');
const { earnedFor, tierFor } = require('../lib/loyalty');
const { normalizePhone, validName } = require('../lib/validate');
const { createPayment } = require('../integrations/payment');
const { sendEmail } = require('../integrations/email');

const byId = db.prepare('SELECT * FROM users WHERE id = ?');
const insertOrder = db.prepare(`
  INSERT INTO orders (id, user_id, guest_name, guest_phone, items_json, total, delivery, city, status, earned_bonuses, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const addLoyalty = db.prepare('UPDATE users SET spent = spent + ?, bonuses = bonuses + ? WHERE id = ?');
const setStatus = db.prepare('UPDATE orders SET status = ? WHERE id = ?');

function genOrderId() {
  return 'A' + Math.floor(10000 + Math.random() * 90000);
}

/** Сумма заказа из позиций (защита от подмены total на клиенте). */
function computeTotal(items) {
  return items.reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.qty) || 1), 0);
}

/**
 * Создание заказа.
 *  - имя/телефон/город обязательны, телефон — 11 цифр;
 *  - если пользователь авторизован — заказ привязывается к нему и начисляется
 *    кэшбэк по уровню НА МОМЕНТ покупки (от spent до текущего заказа);
 *  - оплата создаётся через платёжный провайдер (по умолчанию stub).
 */
async function createOrder(ctx) {
  const { name, city, items, delivery } = ctx.body;
  const phone = normalizePhone(ctx.body.phone);

  if (!validName(name)) return ctx.error(400, 'name_required', 'Укажите имя');
  if (!phone) return ctx.error(400, 'bad_phone', 'Введите корректный номер телефона');
  if (!city || !String(city).trim()) return ctx.error(400, 'city_required', 'Укажите город');
  if (!Array.isArray(items) || items.length === 0) return ctx.error(400, 'empty_cart', 'Корзина пуста');

  // Каждая позиция должна иметь выбранный размер (бизнес-правило ТЗ)
  for (const it of items) {
    if (!it.size) return ctx.error(400, 'size_required', 'Для каждого товара нужно выбрать размер');
  }

  const total = computeTotal(items);
  const user = ctx.auth && ctx.auth.uid ? byId.get(ctx.auth.uid) : null;

  // Кэшбэк по уровню на момент покупки (до прибавления текущего заказа)
  const earned = user ? earnedFor(user.spent, total) : 0;
  const id = genOrderId();

  insertOrder.run(
    id,
    user ? user.id : null,
    user ? null : name.trim(),
    user ? null : phone,
    JSON.stringify(items.map((i) => ({
      productId: i.productId ?? null, name: i.name || '', size: i.size,
      qty: Number(i.qty) || 1, price: Number(i.price) || 0,
    }))),
    total,
    delivery || null,
    String(city).trim(),
    'created',
    earned,
    Date.now()
  );

  if (user) addLoyalty.run(total, earned, user.id);

  // Оплата
  let payment = null;
  try {
    payment = await createPayment({ orderId: id, amount: total, description: `Заказ ${id} · ArhoShop` });
    if (payment.status === 'succeeded') setStatus.run('paid', id);
    else if (payment.confirmationUrl) setStatus.run('pending_payment', id);
  } catch (e) {
    console.error('[order] payment failed:', e.message);
  }

  // Подтверждение заказа на email (если есть)
  if (user && user.email) {
    sendEmail({
      to: user.email,
      subject: `ArhoShop — заказ ${id} оформлен`,
      text: `Спасибо за заказ!\n\nНомер заказа: ${id}\nСумма: ${total.toLocaleString('ru-RU')} ₽\nНачислено бонусов: ${earned}\n\nМы свяжемся с вами для подтверждения.`,
    }).catch((e) => console.error('[order] email failed:', e.message));
  }

  const status = db.prepare('SELECT status FROM orders WHERE id = ?').get(id).status;
  const newTier = user ? tierFor(user.spent + total) : null;
  return ctx.created({
    order: { id, total, earnedBonuses: earned, status, delivery: delivery || null },
    payment: payment ? { status: payment.status, confirmationUrl: payment.confirmationUrl } : null,
    loyalty: user ? { bonuses: user.bonuses + earned, spent: user.spent + total, tier: { key: newTier.key, name: newTier.name } } : null,
  });
}

module.exports = { createOrder };
