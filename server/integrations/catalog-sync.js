'use strict';
const { execFile } = require('node:child_process');
const path = require('node:path');

/**
 * Импорт и периодическая синхронизация каталога Poizon.
 *
 * Поскольку доступ к источнику Poizon (API/выгрузка) требует ваших ключей,
 * здесь описан контракт и точка подключения. Реальная реализация
 * fetchFromPoizon() заполняется под ваш источник данных.
 *
 * Нормализация (обувь → «Кроссовки», одежда → «Одежда», нижнее бельё → «Одежда»
 * и показывается последним) выполняется на стороне витрины в едином месте
 * (scripts/split-products.mjs использует те же правила, что и фронтенд).
 *
 * Пайплайн синхронизации:
 *   1. fetchFromPoizon() → массив сырых товаров;
 *   2. сохранить как catalog/products.js (формат PRODUCTS_DATA);
 *   3. запустить разбивку на чанки (scripts/split-products.mjs)
 *      → site/data/*.json для ленивой подгрузки.
 */

async function fetchFromPoizon() {
  // TODO: подключить реальный источник Poizon (см. docs/DEPLOYMENT.md).
  // Должен вернуть массив объектов { n, b, c, sc, p, im[], s[], ch }.
  throw new Error('catalog-sync: источник Poizon не настроен. См. docs/DEPLOYMENT.md');
}

/** Перегенерировать чанки витрины из текущего catalog/products.js. */
function rebuildChunks() {
  return new Promise((resolve, reject) => {
    const script = path.join(__dirname, '..', '..', 'scripts', 'split-products.mjs');
    execFile(process.execPath, [script], (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout.trim());
    });
  });
}

module.exports = { fetchFromPoizon, rebuildChunks };
