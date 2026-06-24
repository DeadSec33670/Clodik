/* Дымовой тест бэкенда: проверяет ключевые бизнес-правила ТЗ.
   Запуск: npm test  (node --experimental-sqlite test/smoke.mjs) */
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = 3999;
const BASE = `http://localhost:${PORT}`;
const DB = path.join(ROOT, 'server', 'data', 'test.sqlite');

// чистая БД для теста
for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }

const srv = spawn(process.execPath, ['--experimental-sqlite', 'server/index.js'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), ARHO_DB: DB, EMAIL_DRIVER: 'console', PAYMENT_DRIVER: 'stub' },
  stdio: ['ignore', 'pipe', 'inherit'],
});
srv.stdout.on('data', () => {});

async function api(method, p, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

let passed = 0;
function ok(name) { passed++; console.log('  ✓', name); }

try {
  // ждём старта
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(BASE + '/api/health'); if (r.ok) break; } catch {}
    await sleep(100);
  }

  // 1. Регистрация: все поля обязательны
  let r = await api('POST', '/api/auth/register', { name: 'Иван', phone: '89991234567', password: 'secret1', email: 'ivan@test.ru' });
  assert.equal(r.status, 201, 'register ok'); assert.ok(r.data.token); ok('регистрация создаёт аккаунт + токен');
  const token = r.data.token;
  assert.equal(r.data.user.phone, '79991234567', 'телефон нормализован к 11 цифрам'); ok('нормализация телефона 8→7');

  // 2. Короткий пароль отклоняется
  r = await api('POST', '/api/auth/register', { name: 'A', phone: '79990000000', password: '123', email: 'a@a.ru' });
  assert.equal(r.status, 400); ok('пароль < 6 символов отклонён');

  // 3. Уникальность телефона и почты
  r = await api('POST', '/api/auth/register', { name: 'Дубль', phone: '8 (999) 123-45-67', password: 'secret1', email: 'other@test.ru' });
  assert.equal(r.status, 409); assert.equal(r.data.error, 'phone_taken'); ok('один телефон = один аккаунт');
  r = await api('POST', '/api/auth/register', { name: 'Дубль', phone: '79990000001', password: 'secret1', email: 'IVAN@test.ru' });
  assert.equal(r.status, 409); assert.equal(r.data.error, 'email_taken'); ok('одна почта = один аккаунт (без учёта регистра)');

  // 4. Вход: неверный пароль / несуществующий аккаунт
  r = await api('POST', '/api/auth/login', { phone: '79991234567', password: 'wrong' });
  assert.equal(r.status, 401); ok('неверный пароль → ошибка');
  r = await api('POST', '/api/auth/login', { phone: '79995550000', password: 'secret1' });
  assert.equal(r.status, 404); ok('вход только для существующего аккаунта');
  r = await api('POST', '/api/auth/login', { phone: '79991234567', password: 'secret1' });
  assert.equal(r.status, 200); ok('успешный вход');

  // 5. Заказ без размера отклоняется
  r = await api('POST', '/api/orders', { name: 'Иван', phone: '79991234567', city: 'Москва', items: [{ price: 1000, qty: 1 }] }, token);
  assert.equal(r.status, 400); assert.equal(r.data.error, 'size_required'); ok('нельзя оформить без выбора размера');

  // 6. Лояльность: кэшбэк по уровню НА МОМЕНТ покупки
  // Покупка на 60 000 ₽: уровень в момент покупки = «Без уровня» (spent=0) → кэшбэк 0
  r = await api('POST', '/api/orders', { name: 'Иван', phone: '79991234567', city: 'Москва', items: [{ size: '42', price: 60000, qty: 1 }] }, token);
  assert.equal(r.status, 201); assert.equal(r.data.order.earnedBonuses, 0, 'первый заказ — кэшбэк 0 (был «Без уровня»)'); ok('кэшбэк по уровню на момент покупки (1-я покупка = 0)');
  // Теперь spent=60000 → уровень «Бронза» (1%). Вторая покупка на 100 000 → кэшбэк 1% = 1000
  r = await api('POST', '/api/orders', { name: 'Иван', phone: '79991234567', city: 'Москва', items: [{ size: '42', price: 100000, qty: 1 }] }, token);
  assert.equal(r.data.order.earnedBonuses, 1000, 'вторая покупка — 1% (Бронза)'); ok('после порога 50 000 ₽ кэшбэк 1% (Бронза)');

  // 7. /api/me: лояльность и история заказов
  r = await api('GET', '/api/me', null, token);
  assert.equal(r.status, 200);
  assert.equal(r.data.loyalty.spent, 160000, 'сумма покупок');
  assert.equal(r.data.loyalty.bonuses, 1000, 'баланс бонусов');
  assert.equal(r.data.loyalty.tier.key, 'silver', 'уровень Серебро при 160 000');
  assert.equal(r.data.orders.length, 2, 'история из 2 заказов'); ok('дашборд: spent/bonuses/tier/история');

  // 8. Смена пароля
  r = await api('POST', '/api/me/password', { current: 'wrong', next: 'newpass1' }, token);
  assert.equal(r.status, 400); ok('смена пароля: неверный текущий → ошибка');
  r = await api('POST', '/api/me/password', { current: 'secret1', next: 'newpass1' }, token);
  assert.equal(r.status, 200);
  r = await api('POST', '/api/auth/login', { phone: '79991234567', password: 'newpass1' });
  assert.equal(r.status, 200); ok('смена пароля работает');

  // 9. Восстановление пароля (console-драйвер) — всегда ok
  r = await api('POST', '/api/auth/forgot', { email: 'ivan@test.ru' });
  assert.equal(r.status, 200); ok('восстановление пароля по email');

  // 10. Просмотры товаров → популярность
  await api('POST', '/api/products/p1/view');
  await api('POST', '/api/products/p1/view');
  await api('POST', '/api/products/p2/view');
  r = await api('GET', '/api/products/popular?limit=5');
  assert.equal(r.data.items[0].product_id, 'p1'); assert.equal(r.data.items[0].views, 2); ok('популярность по числу просмотров');

  // 11. Админ-панель: вход, статистика, смена статуса заказа
  r = await api('POST', '/api/admin/login', { password: 'wrong' });
  assert.equal(r.status, 401); ok('админ: неверный пароль → ошибка');
  r = await api('GET', '/api/admin/stats', null, token); // пользовательский токен не админский
  assert.equal(r.status, 401); ok('админ: пользовательский токен не даёт доступ');
  r = await api('POST', '/api/admin/login', { password: 'admin' });
  assert.equal(r.status, 200); const adminToken = r.data.token; ok('админ: вход по паролю');
  r = await api('GET', '/api/admin/stats', null, adminToken);
  assert.equal(r.status, 200);
  assert.equal(r.data.totals.orders, 2, 'в статистике 2 заказа');
  assert.equal(r.data.totals.revenue, 160000, 'выручка 160 000');
  assert.equal(r.data.users, 1, 'клиентов: 1'); ok('админ: сводная статистика заказов');
  r = await api('GET', '/api/admin/orders?limit=10', null, adminToken);
  assert.equal(r.status, 200); assert.equal(r.data.orders.length, 2); ok('админ: список заказов');
  const oid = r.data.orders[0].id;
  r = await api('PATCH', `/api/admin/orders/${oid}/status`, { status: 'shipped' }, adminToken);
  assert.equal(r.status, 200); assert.equal(r.data.status, 'shipped'); ok('админ: смена статуса заказа');
  r = await api('PATCH', `/api/admin/orders/${oid}/status`, { status: 'bogus' }, adminToken);
  assert.equal(r.status, 400); ok('админ: недопустимый статус отклонён');

  console.log(`\n✅ Все проверки пройдены (${passed})`);
  srv.kill();
  process.exit(0);
} catch (e) {
  console.error('\n❌ Тест упал:', e.message);
  srv.kill();
  process.exit(1);
}
