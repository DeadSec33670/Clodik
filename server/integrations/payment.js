'use strict';
const https = require('node:https');
const crypto = require('node:crypto');

/**
 * Pluggable платёжный провайдер. Драйвер выбирается PAYMENT_DRIVER:
 *   - stub (по умолчанию): сразу помечает заказ оплаченным (демо/разработка);
 *   - yookassa: создаёт платёж в ЮKassa (нужны YOOKASSA_SHOP_ID, YOOKASSA_SECRET).
 *
 * Возвращает { paymentId, status, confirmationUrl }.
 * Реальные ключи — в .env. Точки расширения для Tinkoff/CloudPayments
 * добавляются по аналогии (один новый case).
 */

const DRIVER = (process.env.PAYMENT_DRIVER || 'stub').toLowerCase();
const RETURN_URL = process.env.PAYMENT_RETURN_URL || 'https://arhoshop.ru/order';

function postJSON(host, path, headers, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = https.request(
      { host, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers } },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try { resolve(JSON.parse(body)); } catch { reject(new Error('bad payment response: ' + body)); }
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function createPayment({ orderId, amount, description }) {
  if (DRIVER === 'yookassa') {
    const auth = Buffer.from(`${process.env.YOOKASSA_SHOP_ID}:${process.env.YOOKASSA_SECRET}`).toString('base64');
    const res = await postJSON('api.yookassa.ru', '/v3/payments',
      { Authorization: `Basic ${auth}`, 'Idempotence-Key': crypto.randomUUID() },
      {
        amount: { value: (amount).toFixed(2), currency: 'RUB' },
        capture: true,
        confirmation: { type: 'redirect', return_url: `${RETURN_URL}?id=${orderId}` },
        description: description || `Заказ ${orderId} · ArhoShop`,
        metadata: { orderId },
      });
    return { paymentId: res.id, status: res.status, confirmationUrl: res.confirmation?.confirmation_url || null };
  }
  // stub: считаем оплату успешной сразу (демо)
  return { paymentId: 'stub_' + orderId, status: 'succeeded', confirmationUrl: null };
}

module.exports = { createPayment, DRIVER };
