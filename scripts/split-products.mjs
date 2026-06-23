#!/usr/bin/env node
/**
 * Разбивает монолитный catalog/products.js (~15 МБ) на чанки JSON
 * для ленивой подгрузки витриной (требование п.6 ТЗ — оптимизация загрузки).
 *
 * Вход:  catalog/products.js  →  const SIZE_CHARTS=[...]; const PRODUCTS_DATA=[...];
 * Выход: site/data/manifest.json
 *        site/data/size-charts.json
 *        site/data/products-000.json ... products-NNN.json
 *
 * Формат позиций сохраняется как в оригинале (n,b,c,sc,p,im,s,ch) — вся
 * нормализация и сборка фильтров остаётся на витрине без изменений логики.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'catalog', 'products.js');
const OUT = path.join(ROOT, 'site', 'data');
const CHUNK_SIZE = Number(process.env.CHUNK_SIZE || 400);

if (!fs.existsSync(SRC)) {
  console.error('Не найден', SRC);
  process.exit(1);
}

console.log('Читаю', SRC, '…');
const code = fs.readFileSync(SRC, 'utf8');

// Безопасно извлекаем два массива: оборачиваем тело в функцию и возвращаем их.
const extract = new Function(`${code}\nreturn { SIZE_CHARTS: typeof SIZE_CHARTS!=='undefined'?SIZE_CHARTS:[], PRODUCTS_DATA: typeof PRODUCTS_DATA!=='undefined'?PRODUCTS_DATA:[] };`);
const { SIZE_CHARTS, PRODUCTS_DATA } = extract();

console.log(`Товаров: ${PRODUCTS_DATA.length}, таблиц размеров: ${SIZE_CHARTS.length}`);

fs.mkdirSync(OUT, { recursive: true });
// чистим старые чанки
for (const f of fs.readdirSync(OUT)) {
  if (/^products-\d+\.json$/.test(f) || f === 'manifest.json' || f === 'size-charts.json') {
    fs.unlinkSync(path.join(OUT, f));
  }
}

fs.writeFileSync(path.join(OUT, 'size-charts.json'), JSON.stringify(SIZE_CHARTS));

const chunks = [];
for (let i = 0; i < PRODUCTS_DATA.length; i += CHUNK_SIZE) {
  const part = PRODUCTS_DATA.slice(i, i + CHUNK_SIZE);
  const name = `products-${String(chunks.length).padStart(3, '0')}.json`;
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(part));
  chunks.push(name);
}

const manifest = {
  version: 1,
  generatedAt: new Date().toISOString(),
  total: PRODUCTS_DATA.length,
  chunkSize: CHUNK_SIZE,
  charts: 'size-charts.json',
  chunks,
};
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));

const bytes = chunks.reduce((s, f) => s + fs.statSync(path.join(OUT, f)).size, 0);
console.log(`Готово: ${chunks.length} чанков по ~${CHUNK_SIZE}, всего ${(bytes / 1e6).toFixed(1)} МБ → ${OUT}`);
