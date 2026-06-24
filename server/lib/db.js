'use strict';
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

/**
 * Слой данных на встроенном node:sqlite.
 * Схема соответствует модели данных ТЗ:
 *   User    : id, name, phone (уникальный), email (уникальный), passwordHash, createdAt
 *   Loyalty : userId, spent, bonuses, tier (tier вычисляется из spent — не храним отдельно)
 *   Order   : id, userId, items[], total, delivery, status, earnedBonuses, createdAt
 *   Product : справочно — каталог отдаётся статикой/синхронизацией (см. integrations/catalog-sync)
 *
 * Для продакшена легко мигрируется на PostgreSQL: SQL стандартный,
 * параметризованные запросы, без специфичных расширений.
 */

const DB_PATH = process.env.ARHO_DB || path.join(__dirname, '..', 'data', 'arho.sqlite');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT    NOT NULL,
    phone         TEXT    NOT NULL UNIQUE,   -- 11 цифр, нормализованный
    email         TEXT    NOT NULL UNIQUE,   -- в нижнем регистре
    password_hash TEXT    NOT NULL,
    spent         INTEGER NOT NULL DEFAULT 0, -- сумма всех покупок (Loyalty.spent)
    bonuses       INTEGER NOT NULL DEFAULT 0, -- баланс бонусов (Loyalty.bonuses)
    created_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS orders (
    id              TEXT    PRIMARY KEY,      -- номер заказа, напр. A12345
    user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL, -- NULL для гостевых заказов
    guest_name      TEXT,
    guest_phone     TEXT,
    items_json      TEXT    NOT NULL,         -- [{productId,name,size,qty,price}]
    total           INTEGER NOT NULL,
    delivery        TEXT,
    city            TEXT,
    status          TEXT    NOT NULL DEFAULT 'created',
    earned_bonuses  INTEGER NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, created_at DESC);

  -- Счётчик просмотров товаров для блока «Популярное сейчас».
  CREATE TABLE IF NOT EXISTS product_views (
    product_id TEXT PRIMARY KEY,
    views      INTEGER NOT NULL DEFAULT 0
  );
`);

module.exports = db;
