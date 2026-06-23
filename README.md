# ArhoShop

Интернет-магазин оригинальных кроссовок и уличной одежды (поставка с Poizon):
**сайт** + **мобильное приложение (PWA)** + **бэкенд** (аккаунты, заказы, программа лояльности).

Реализовано по двум ТЗ (`docs/spec/`). Прототипы доведены до рабочего продукта:
вместо `localStorage` подключён реальный бэкенд, добавлены оплата/email/синхронизация
каталога как настраиваемые интеграции, каталог разбит на ленивую подгрузку.

## Быстрый старт

```bash
npm start            # node >= 22.5
```

Откройте:
- сайт — http://localhost:3000/
- приложение (PWA) — http://localhost:3000/app
- здоровье API — http://localhost:3000/api/health

Один процесс раздаёт и статику (сайт/приложение/данные каталога), и REST API.
Внешних зависимостей нет — бэкенд построен на встроенных модулях Node
(`node:http`, `node:sqlite`, `node:crypto`), поэтому `npm install` не требуется.

## Тесты

```bash
npm test             # дымовой тест бизнес-правил бэкенда
```

Покрывает: уникальность телефона/почты, валидацию, вход только для существующего
аккаунта, запрет заказа без размера, начисление кэшбэка **по уровню на момент покупки**,
дашборд лояльности, смену/восстановление пароля, ранжирование по просмотрам.

## Структура

```
server/            REST API на встроенных модулях Node
  lib/             db (node:sqlite), auth (scrypt + подписанные токены), loyalty, validate, http-роутер
  routes/          auth, profile, orders, catalog (популярность)
  integrations/    email (console|resend|sendgrid), payment (stub|yookassa), catalog-sync (Poizon)
site/              сайт (прототип, подключён к API)
  index.html       SPA: каталог, корзина, заказ, кабинет, лояльность
  api.js           клиент бэкенда + ленивая подгрузка каталога чанками
  data/            каталог, разбитый на JSON-чанки (manifest + size-charts + products-NNN)
app/               мобильное приложение как PWA (тот же бэкенд)
  index.html       экраны на рантайме прототипа, подключены к API
  manifest.webmanifest, sw.js, icon.svg
catalog/products.js  исходный каталог (вход для разбивки на чанки)
scripts/split-products.mjs  разбивка каталога: npm run build:catalog
docs/              DEPLOYMENT.md, ARCHITECTURE.md, ТЗ
```

## Каталог (ленивая подгрузка)

Монолитный `catalog/products.js` (~15 МБ) разбивается на чанки JSON:

```bash
npm run build:catalog   # → site/data/manifest.json + products-NNN.json
```

Сайт грузит `manifest.json`, затем чанки по очереди (кэшируются по отдельности),
что убирает блокирующую загрузку 15 МБ и ускоряет первый рендер.

## Продакшен

См. `docs/DEPLOYMENT.md`: переход на PostgreSQL, ключи ЮKassa/Resend, домен,
публикация PWA. Конфигурация — через `.env` (шаблон в `.env.example`),
код менять не нужно.
