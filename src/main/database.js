/* ============================================================
 *  Nova POS – SQLite Database Connection & Schema
 *  src/main/database.js
 *
 *  Uses better-sqlite3 for synchronous, fast, local DB access.
 * ============================================================ */

const Database = require('better-sqlite3');
const path = require('path');
const { app } = require('electron');

const DB_NAME = 'nova-pos.db';

function getDbPath() {
  return path.join(app.getPath('userData'), DB_NAME);
}

function initDatabase() {
  const dbPath = getDbPath();
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  createSchema(db);
  seedDefaults(db);
  console.log(`[DB] Database ready at ${dbPath}`);
  return db;
}

function createSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      barcode       TEXT    UNIQUE,
      name          TEXT    NOT NULL,
      category      TEXT    DEFAULT '',
      cost_price    REAL    DEFAULT 0,
      sale_price    REAL    DEFAULT 0,
      stock         INTEGER DEFAULT 0,
      min_stock     INTEGER DEFAULT 0,
      unit          TEXT    DEFAULT 'pcs',
      is_active     INTEGER DEFAULT 1,
      created_at    TEXT    DEFAULT (datetime('now','localtime')),
      updated_at    TEXT    DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS customers (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT    NOT NULL,
      phone         TEXT    DEFAULT '',
      address       TEXT    DEFAULT '',
      balance       REAL    DEFAULT 0,
      created_at    TEXT    DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS vendors (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT    NOT NULL,
      phone         TEXT    DEFAULT '',
      address       TEXT    DEFAULT '',
      balance       REAL    DEFAULT 0,
      created_at    TEXT    DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS sales (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_no    TEXT    UNIQUE,
      customer_id   INTEGER,
      subtotal      REAL    DEFAULT 0,
      discount      REAL    DEFAULT 0,
      total         REAL    DEFAULT 0,
      amount_paid   REAL    DEFAULT 0,
      change_due    REAL    DEFAULT 0,
      payment_method TEXT   DEFAULT 'cash',
      notes         TEXT    DEFAULT '',
      created_at    TEXT    DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS sale_items (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id       INTEGER NOT NULL,
      item_id       INTEGER,
      item_name     TEXT    NOT NULL,
      barcode       TEXT    DEFAULT '',
      quantity      INTEGER DEFAULT 1,
      unit_price    REAL    DEFAULT 0,
      line_total    REAL    DEFAULT 0,
      FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
      FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS ledger_transactions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type   TEXT    NOT NULL CHECK(entity_type IN ('customer','vendor')),
      entity_id     INTEGER NOT NULL,
      type          TEXT    NOT NULL CHECK(type IN ('debit','credit')),
      amount        REAL    NOT NULL,
      description   TEXT    DEFAULT '',
      reference     TEXT    DEFAULT '',
      created_at    TEXT    DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key           TEXT    PRIMARY KEY,
      value         TEXT    DEFAULT ''
    );
  `);
}

function seedDefaults(db) {
  const defaults = {
    store_name:     'Nova POS Store',
    store_phone:    '',
    store_address:  '',
    currency:       'PKR',
    tax_rate:       '0',
    receipt_footer: 'Thank you for shopping with us!',
    invoice_prefix: 'INV-',
  };
  const upsert = db.prepare(
    `INSERT OR IGNORE INTO settings (key, value) VALUES (@key, @value)`
  );
  const insertMany = db.transaction((entries) => {
    for (const [key, value] of entries) {
      upsert.run({ key, value });
    }
  });
  insertMany(Object.entries(defaults));
}

module.exports = { initDatabase, getDbPath };
