# Деплой и интеграции ArhoShop

Все внешние интеграции включаются через `.env` (см. `.env.example`) — код менять не нужно.

## 1. Хостинг (этап 1)

Минимально — запустить один Node-процесс, который раздаёт сайт, приложение и API:

```bash
ARHO_SECRET="<длинная случайная строка>" npm start
```

За reverse-proxy (nginx/Caddy) повесьте TLS и проксируйте на `PORT`.
Статику (`site/`, `app/`, `site/data/`) можно вынести на CDN, оставив за бэкендом только `/api/*`
— тогда на фронте задайте `window.ARHO_API_BASE = 'https://api.arhoshop.ru'`.

## 2. База данных (этап 2)

По умолчанию — встроенный `node:sqlite` (файл `server/data/arho.sqlite`), нулевая настройка.

Переход на **PostgreSQL** для продакшена: SQL в `server/lib/db.js` стандартный
(параметризованные запросы, без специфики SQLite). Замените `DatabaseSync` на драйвер
`pg` и адаптируйте 4 запроса-обёртки в `routes/`. Схема (users/orders/product_views)
переносится без изменений; `AUTOINCREMENT` → `GENERATED ALWAYS AS IDENTITY`.

## 3. Email (восстановление пароля, подтверждение заказа)

```env
EMAIL_DRIVER=resend            # или sendgrid
RESEND_API_KEY=...             # ключ провайдера
EMAIL_FROM=ArhoShop <noreply@ваш-домен>
```

`EMAIL_DRIVER=console` (по умолчанию) печатает письма в консоль — удобно для разработки.
Драйверы реализованы в `server/integrations/email.js`.

## 4. Оплата (этап 4)

```env
PAYMENT_DRIVER=yookassa
YOOKASSA_SHOP_ID=...
YOOKASSA_SECRET=...
PAYMENT_RETURN_URL=https://arhoshop.ru/order
```

`PAYMENT_DRIVER=stub` (по умолчанию) помечает заказ оплаченным сразу (демо).
При `yookassa` бэкенд создаёт платёж и возвращает `confirmationUrl` — фронт ведёт на оплату.
Tinkoff/CloudPayments добавляются по аналогии (один новый драйвер в `payment.js`).

> Webhook о статусе платежа: добавьте маршрут `POST /api/payments/webhook`,
> проверяйте подпись провайдера и обновляйте `orders.status`.

## 5. Каталог Poizon (этап 5)

`server/integrations/catalog-sync.js` описывает контракт. Заполните `fetchFromPoizon()`
под ваш источник (он должен вернуть массив `{n,b,c,sc,p,im[],s[],ch}`), сохраните результат
в `catalog/products.js` и пересоберите чанки:

```bash
npm run build:catalog
```

Нормализация (обувь → «Кроссовки», одежда → «Одежда», нижнее бельё → «Одежда» и в конец)
выполняется витриной (`site/index.html` → `prepareData`/`normalizeCats`) — единые правила
для всего каталога. Периодическую синхронизацию повесьте на cron + `rebuildChunks()`.

## 6. Домен / SEO / PWA-релиз (этап 6)

- Свой домен + TLS, мета-теги и `sitemap.xml` на статике сайта.
- `products.js` уже разбит на ленивые чанки (этот пункт ТЗ выполнен).
- Приложение — устанавливаемое **PWA** (`app/manifest.webmanifest` + `sw.js`).
  Для сторов оберните в TWA (Google Play) или используйте Capacitor/React Native (App Store).

## Переменные окружения

| Переменная | Назначение | По умолчанию |
|---|---|---|
| `PORT` | порт HTTP | `3000` |
| `ARHO_SECRET` | секрет подписи токенов | dev-значение (**смените!**) |
| `ARHO_TOKEN_TTL` | TTL токена, сек | `2592000` (30 дней) |
| `ARHO_DB` | путь к SQLite | `server/data/arho.sqlite` |
| `EMAIL_DRIVER` | `console`/`resend`/`sendgrid` | `console` |
| `PAYMENT_DRIVER` | `stub`/`yookassa` | `stub` |
