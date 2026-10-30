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
  console.log('[DB] Database ready at ' + dbPath);
  return db;
}

function createSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      barcode TEXT UNIQUE,
      name TEXT NOT NULL,
      urdu_name TEXT DEFAULT '',
      category TEXT DEFAULT '',
      cost_price REAL DEFAULT 0,
      sale_price REAL DEFAULT 0,
      stock REAL DEFAULT 0,
      min_stock REAL DEFAULT 0,
      unit TEXT DEFAULT 'pcs',
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT DEFAULT '',
      cnic TEXT DEFAULT '',
      address TEXT DEFAULT '',
      balance REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS vendors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT DEFAULT '',
      address TEXT DEFAULT '',
      balance REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_no TEXT NOT NULL,
      vendor_id INTEGER,
      total_amount REAL NOT NULL,
      paid_amount REAL NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_no TEXT UNIQUE,
      customer_id INTEGER,
      subtotal REAL DEFAULT 0,
      discount REAL DEFAULT 0,
      total REAL DEFAULT 0,
      amount_paid REAL DEFAULT 0,
      change_due REAL DEFAULT 0,
      payment_method TEXT DEFAULT 'cash',
      status TEXT DEFAULT 'PAID',
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL,
      item_id INTEGER,
      item_name TEXT NOT NULL,
      urdu_name TEXT DEFAULT '',
      barcode TEXT DEFAULT '',
      quantity REAL DEFAULT 1,
      unit TEXT DEFAULT '',
      unit_price REAL DEFAULT 0,
      line_total REAL DEFAULT 0,
      FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
      FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS returns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      return_no TEXT UNIQUE,
      sale_id INTEGER NOT NULL,
      customer_id INTEGER,
      total_refund REAL DEFAULT 0,
      refund_method TEXT DEFAULT 'cash',
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS return_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      return_id INTEGER NOT NULL,
      sale_item_id INTEGER NOT NULL,
      item_id INTEGER,
      item_name TEXT NOT NULL,
      quantity REAL DEFAULT 1,
      unit TEXT DEFAULT '',
      unit_price REAL DEFAULT 0,
      refund_amount REAL DEFAULT 0,
      condition TEXT DEFAULT 'resalable',
      FOREIGN KEY (return_id) REFERENCES returns(id) ON DELETE CASCADE,
      FOREIGN KEY (sale_item_id) REFERENCES sale_items(id) ON DELETE CASCADE,
      FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS ledger_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL CHECK(entity_type IN ('customer','vendor')),
      entity_id INTEGER NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('debit','credit')),
      amount REAL NOT NULL,
      description TEXT DEFAULT '',
      reference TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT DEFAULT ''
    );
  `);

  if (!db.pragma('table_info(customers)').some((c) => c.name === 'cnic')) {
    db.exec("ALTER TABLE customers ADD COLUMN cnic TEXT DEFAULT ''");
  }
  if (!db.pragma('table_info(sales)').some((c) => c.name === 'status')) {
    db.exec("ALTER TABLE sales ADD COLUMN status TEXT DEFAULT 'PAID'");
  }
  if (!db.pragma('table_info(sale_items)').some((c) => c.name === 'urdu_name')) {
    db.exec("ALTER TABLE sale_items ADD COLUMN urdu_name TEXT DEFAULT ''");
  }
  if (!db.pragma('table_info(items)').some((c) => c.name === 'urdu_name')) {
    db.exec("ALTER TABLE items ADD COLUMN urdu_name TEXT DEFAULT ''");
  }
  if (!db.pragma('table_info(vendors)').some((c) => c.name === 'contact_person')) {
    db.exec("ALTER TABLE vendors ADD COLUMN contact_person TEXT DEFAULT ''");
  }

  // Migrate integer quantity/stock columns to REAL for kg-weight support
  const saleItemsInfo = db.pragma('table_info(sale_items)');
  if (saleItemsInfo.some((c) => c.name === 'quantity' && c.type === 'INTEGER')) {
    db.exec('ALTER TABLE sale_items RENAME COLUMN quantity TO quantity_old');
    db.exec('ALTER TABLE sale_items ADD COLUMN quantity REAL DEFAULT 1');
    db.exec('UPDATE sale_items SET quantity = quantity_old');
    db.exec('ALTER TABLE sale_items DROP COLUMN quantity_old');
  }
  if (!saleItemsInfo.some((c) => c.name === 'unit')) {
    db.exec("ALTER TABLE sale_items ADD COLUMN unit TEXT DEFAULT ''");
  }

  const returnItemsInfo = db.pragma('table_info(return_items)');
  if (returnItemsInfo.some((c) => c.name === 'quantity' && c.type === 'INTEGER')) {
    db.exec('ALTER TABLE return_items RENAME COLUMN quantity TO quantity_old');
    db.exec('ALTER TABLE return_items ADD COLUMN quantity REAL DEFAULT 1');
    db.exec('UPDATE return_items SET quantity = quantity_old');
    db.exec('ALTER TABLE return_items DROP COLUMN quantity_old');
  }
  if (!returnItemsInfo.some((c) => c.name === 'unit')) {
    db.exec("ALTER TABLE return_items ADD COLUMN unit TEXT DEFAULT ''");
  }

  const itemsInfo = db.pragma('table_info(items)');
  if (itemsInfo.some((c) => c.name === 'stock' && c.type === 'INTEGER')) {
    db.exec('ALTER TABLE items RENAME COLUMN stock TO stock_old');
    db.exec('ALTER TABLE items ADD COLUMN stock REAL DEFAULT 0');
    db.exec('UPDATE items SET stock = stock_old');
    db.exec('ALTER TABLE items DROP COLUMN stock_old');
  }
  if (itemsInfo.some((c) => c.name === 'min_stock' && c.type === 'INTEGER')) {
    db.exec('ALTER TABLE items RENAME COLUMN min_stock TO min_stock_old');
    db.exec('ALTER TABLE items ADD COLUMN min_stock REAL DEFAULT 0');
    db.exec('UPDATE items SET min_stock = min_stock_old');
    db.exec('ALTER TABLE items DROP COLUMN min_stock_old');
  }
}

function seedDefaults(db) {
  const defaults = {
    store_name: 'Nova POS Store',
    store_phone: '',
    store_address: '',
    currency: 'PKR',
    tax_rate: '0',
    receipt_footer: 'Thank you for shopping with us!',
    invoice_prefix: 'INV-',
    return_prefix: 'RET-',
    language: 'en',
    logo_path: '',
    logo_width: '120',
    logo_height: '50',
    logo_alignment: 'center',
    thermal_width: '80',
    printer_interface: '',
    printer_type: 'epson',
  };
  const upsert = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (@key, @value)');
  const insertMany = db.transaction((entries) => {
    for (const [key, value] of entries) {
      upsert.run({ key, value });
    }
  });
  insertMany(Object.entries(defaults));
}

module.exports = { initDatabase, getDbPath };
