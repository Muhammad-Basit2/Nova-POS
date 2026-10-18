/* ============================================================
 *  Nova POS – IPC Handlers
 *  src/main/ipcHandlers.js
 *
 *  All ipcMain.handle() registrations live here.
 *  Each handler receives the db instance and dialog module.
 * ============================================================ */

const path = require('path');
const fs   = require('fs');
const { app } = require('electron');
const { getDbPath } = require('./database');
const { parseItemsFromExcel, exportItemsToBuffer } = require('./excelHandler');

function registerIpcHandlers(ipcMain, db, dialog) {

  /* ===========================================================
   *  ITEMS
   * =========================================================== */
  ipcMain.handle('items:getAll', (_e, filters = {}) => {
    let sql = 'SELECT * FROM items WHERE 1=1';
    const params = [];
    if (filters.category) { sql += ' AND category = ?'; params.push(filters.category); }
    if (filters.active !== undefined) { sql += ' AND is_active = ?'; params.push(filters.active ? 1 : 0); }
    sql += ' ORDER BY name ASC';
    return db.prepare(sql).all(...params);
  });

  ipcMain.handle('items:getById', (_e, id) => {
    return db.prepare('SELECT * FROM items WHERE id = ?').get(id);
  });

  ipcMain.handle('items:create', (_e, data) => {
    const stmt = db.prepare(`
      INSERT INTO items (barcode, name, category, cost_price, sale_price, stock, min_stock, unit)
      VALUES (@barcode, @name, @category, @cost_price, @sale_price, @stock, @min_stock, @unit)
    `);
    const info = stmt.run(data);
    return { id: info.lastInsertRowid, ...data };
  });

  ipcMain.handle('items:update', (_e, id, data) => {
    const stmt = db.prepare(`
      UPDATE items SET barcode=@barcode, name=@name, category=@category,
        cost_price=@cost_price, sale_price=@sale_price, stock=@stock, min_stock=@min_stock,
        unit=@unit, is_active=@is_active, updated_at=datetime('now','localtime')
      WHERE id = @id
    `);
    stmt.run({ id, ...data });
    return db.prepare('SELECT * FROM items WHERE id = ?').get(id);
  });

  ipcMain.handle('items:delete', (_e, id) => {
    db.prepare('DELETE FROM items WHERE id = ?').run(id);
    return { success: true };
  });

  ipcMain.handle('items:search', (_e, term) => {
    const like = `%${term}%`;
    return db.prepare(
      'SELECT * FROM items WHERE (barcode LIKE ? OR name LIKE ?) AND is_active = 1 ORDER BY name ASC'
    ).all(like, like);
  });

  ipcMain.handle('items:getCategories', () => {
    return db.prepare("SELECT DISTINCT category FROM items WHERE category != '' ORDER BY category").all().map(r => r.category);
  });

  /* ===========================================================
   *  DASHBOARD
   * =========================================================== */
  ipcMain.handle('dashboard:stats', () => {
    const todaySalesRes = db.prepare(`
      SELECT COALESCE(SUM(total), 0) AS total_sales, COALESCE(COUNT(*), 0) AS tx_count
      FROM sales
      WHERE date(created_at) = date('now', 'localtime')
    `).get();

    const todayProfitRes = db.prepare(`
      SELECT COALESCE(SUM((si.unit_price - COALESCE(i.cost_price, 0)) * si.quantity), 0) AS total_profit
      FROM sale_items si
      JOIN sales s ON si.sale_id = s.id
      LEFT JOIN items i ON si.item_id = i.id
      WHERE date(s.created_at) = date('now', 'localtime')
    `).get();

    const lowStockItems = db.prepare(`
      SELECT * FROM items
      WHERE stock <= min_stock AND is_active = 1
      ORDER BY stock ASC
    `).all();

    const totalItems = db.prepare('SELECT COUNT(*) AS cnt FROM items WHERE is_active = 1').get().cnt;

    return {
      todaySales: todaySalesRes.total_sales,
      txCount: todaySalesRes.tx_count,
      todayProfit: todayProfitRes.total_profit,
      lowStockItems,
      totalItems
    };
  });

  /* ===========================================================
   *  SALES
   * =========================================================== */
  ipcMain.handle('sales:create', (_e, saleData) => {
    const { items: cartItems, customer_id, discount, amount_paid, payment_method, notes } = saleData;

    const subtotal = cartItems.reduce((s, i) => s + i.line_total, 0);
    const total    = subtotal - (discount || 0);
    const change   = Math.max((amount_paid || 0) - total, 0);

    /* Generate invoice number */
    const prefix = db.prepare("SELECT value FROM settings WHERE key='invoice_prefix'").get()?.value || 'INV-';
    const last   = db.prepare("SELECT COUNT(*) AS cnt FROM sales").get().cnt;
    const invoice_no = `${prefix}${String(last + 1).padStart(6, '0')}`;

    const insertSale = db.prepare(`
      INSERT INTO sales (invoice_no, customer_id, subtotal, discount, total, amount_paid, change_due, payment_method, notes)
      VALUES (@invoice_no, @customer_id, @subtotal, @discount, @total, @amount_paid, @change_due, @payment_method, @notes)
    `);
    const insertItem = db.prepare(`
      INSERT INTO sale_items (sale_id, item_id, item_name, barcode, quantity, unit_price, line_total)
      VALUES (@sale_id, @item_id, @item_name, @barcode, @quantity, @unit_price, @line_total)
    `);
    const updateStock = db.prepare('UPDATE items SET stock = stock - ? WHERE id = ?');

    const run = db.transaction(() => {
      const info = insertSale.run({
        invoice_no, customer_id: customer_id || null,
        subtotal, discount: discount || 0, total,
        amount_paid: amount_paid || 0, change_due: change,
        payment_method: payment_method || 'cash', notes: notes || ''
      });
      const saleId = info.lastInsertRowid;
      for (const ci of cartItems) {
        insertItem.run({
          sale_id: saleId, item_id: ci.item_id || null,
          item_name: ci.item_name, barcode: ci.barcode || '',
          quantity: ci.quantity, unit_price: ci.unit_price,
          line_total: ci.line_total
        });
        if (ci.item_id) updateStock.run(ci.quantity, ci.item_id);
      }
      /* Update customer balance if credit */
      if (customer_id && payment_method === 'credit') {
        db.prepare('UPDATE customers SET balance = balance + ? WHERE id = ?').run(total, customer_id);
        db.prepare(`INSERT INTO ledger_transactions (entity_type,entity_id,type,amount,description,reference)
          VALUES ('customer',?,'debit',?,?,?)`).run(customer_id, total, 'Sale invoice', invoice_no);
      }
      return saleId;
    });

    const saleId = run();
    return db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId);
  });

  ipcMain.handle('sales:getAll', (_e, filters = {}) => {
    let sql = 'SELECT s.*, c.name AS customer_name FROM sales s LEFT JOIN customers c ON s.customer_id = c.id WHERE 1=1';
    const params = [];
    if (filters.from) { sql += ' AND s.created_at >= ?'; params.push(filters.from); }
    if (filters.to)   { sql += ' AND s.created_at <= ?'; params.push(filters.to); }
    if (filters.payment_method) { sql += ' AND s.payment_method = ?'; params.push(filters.payment_method); }
    sql += ' ORDER BY s.id DESC';
    if (filters.limit) { sql += ' LIMIT ?'; params.push(filters.limit); }
    return db.prepare(sql).all(...params);
  });

  ipcMain.handle('sales:getById', (_e, id) => {
    return db.prepare('SELECT s.*, c.name AS customer_name FROM sales s LEFT JOIN customers c ON s.customer_id = c.id WHERE s.id = ?').get(id);
  });

  ipcMain.handle('sales:getItems', (_e, saleId) => {
    return db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(saleId);
  });

  /* ===========================================================
   *  CUSTOMERS
   * =========================================================== */
  ipcMain.handle('customers:getAll', () => {
    return db.prepare('SELECT * FROM customers ORDER BY name ASC').all();
  });
  ipcMain.handle('customers:getById', (_e, id) => {
    return db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
  });
  ipcMain.handle('customers:create', (_e, data) => {
    const info = db.prepare('INSERT INTO customers (name,phone,address) VALUES (@name,@phone,@address)').run(data);
    return { id: info.lastInsertRowid, ...data, balance: 0 };
  });
  ipcMain.handle('customers:update', (_e, id, data) => {
    db.prepare('UPDATE customers SET name=@name, phone=@phone, address=@address WHERE id=@id').run({ id, ...data });
    return db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
  });
  ipcMain.handle('customers:delete', (_e, id) => {
    db.prepare('DELETE FROM customers WHERE id = ?').run(id);
    return { success: true };
  });
  ipcMain.handle('customers:getLedger', (_e, id) => {
    return db.prepare("SELECT * FROM ledger_transactions WHERE entity_type='customer' AND entity_id=? ORDER BY created_at DESC").all(id);
  });

  /* ===========================================================
   *  VENDORS
   * =========================================================== */
  ipcMain.handle('vendors:getAll', () => {
    return db.prepare('SELECT * FROM vendors ORDER BY name ASC').all();
  });
  ipcMain.handle('vendors:getById', (_e, id) => {
    return db.prepare('SELECT * FROM vendors WHERE id = ?').get(id);
  });
  ipcMain.handle('vendors:create', (_e, data) => {
    const info = db.prepare('INSERT INTO vendors (name,phone,address) VALUES (@name,@phone,@address)').run(data);
    return { id: info.lastInsertRowid, ...data, balance: 0 };
  });
  ipcMain.handle('vendors:update', (_e, id, data) => {
    db.prepare('UPDATE vendors SET name=@name, phone=@phone, address=@address WHERE id=@id').run({ id, ...data });
    return db.prepare('SELECT * FROM vendors WHERE id = ?').get(id);
  });
  ipcMain.handle('vendors:delete', (_e, id) => {
    db.prepare('DELETE FROM vendors WHERE id = ?').run(id);
    return { success: true };
  });
  ipcMain.handle('vendors:getLedger', (_e, id) => {
    return db.prepare("SELECT * FROM ledger_transactions WHERE entity_type='vendor' AND entity_id=? ORDER BY created_at DESC").all(id);
  });

  /* ===========================================================
   *  LEDGER TRANSACTIONS
   * =========================================================== */
  ipcMain.handle('ledger:addTransaction', (_e, data) => {
    const { entity_type, entity_id, type, amount, description, reference } = data;
    db.prepare(`INSERT INTO ledger_transactions (entity_type,entity_id,type,amount,description,reference)
      VALUES (?,?,?,?,?,?)`).run(entity_type, entity_id, type, amount, description || '', reference || '');
    /* Update running balance */
    const delta = type === 'debit' ? amount : -amount;
    const table = entity_type === 'customer' ? 'customers' : 'vendors';
    db.prepare(`UPDATE ${table} SET balance = balance + ? WHERE id = ?`).run(delta, entity_id);
    return { success: true };
  });

  /* ===========================================================
   *  EXCEL IMPORT / EXPORT
   * =========================================================== */
  ipcMain.handle('excel:importItems', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Import Items from Excel',
      filters: [{ name: 'Excel Files', extensions: ['xlsx', 'xls'] }],
      properties: ['openFile']
    });
    if (canceled || !filePaths.length) return { success: false, message: 'Cancelled' };

    try {
      const items = parseItemsFromExcel(filePaths[0]);
      const upsert = db.prepare(`
        INSERT INTO items (barcode,name,category,cost_price,sale_price,stock,min_stock,unit)
        VALUES (@barcode,@name,@category,@cost_price,@sale_price,@stock,@min_stock,@unit)
        ON CONFLICT(barcode) DO UPDATE SET
          name=excluded.name, category=excluded.category,
          cost_price=excluded.cost_price, sale_price=excluded.sale_price,
          stock=excluded.stock, min_stock=excluded.min_stock, unit=excluded.unit,
          updated_at=datetime('now','localtime')
      `);
      const insertMany = db.transaction((rows) => {
        let count = 0;
        for (const row of rows) {
          if (!row.name) continue;
          upsert.run(row);
          count++;
        }
        return count;
      });
      const count = insertMany(items);
      return { success: true, count };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('excel:exportItems', async () => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Export Items to Excel',
      defaultPath: 'nova-pos-items.xlsx',
      filters: [{ name: 'Excel Files', extensions: ['xlsx'] }]
    });
    if (canceled || !filePath) return { success: false, message: 'Cancelled' };

    try {
      const items = db.prepare('SELECT * FROM items ORDER BY name ASC').all();
      const buffer = exportItemsToBuffer(items);
      fs.writeFileSync(filePath, buffer);
      return { success: true, filePath };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  /* ===========================================================
   *  BACKUP / RESTORE
   * =========================================================== */
  ipcMain.handle('backup:create', async () => {
    const backupDir = path.join(app.getPath('userData'), 'backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupPath = path.join(backupDir, `nova-pos-backup-${timestamp}.db`);
    try {
      fs.copyFileSync(getDbPath(), backupPath);
      return { success: true, backupPath };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('backup:restore', async (_e, filePath) => {
    let targetPath = filePath;
    if (!targetPath) {
      const { canceled, filePaths } = await dialog.showOpenDialog({
        title: 'Restore Database Backup',
        filters: [{ name: 'Database Backup', extensions: ['db'] }],
        properties: ['openFile']
      });
      if (canceled || !filePaths.length) return { success: false, message: 'Cancelled' };
      targetPath = filePaths[0];
    }
    try {
      db.close();
      fs.copyFileSync(targetPath, getDbPath());
      return { success: true, message: 'Database restored. Please restart the application.' };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('backup:list', () => {
    const backupDir = path.join(app.getPath('userData'), 'backups');
    if (!fs.existsSync(backupDir)) return [];
    return fs.readdirSync(backupDir)
      .filter(f => f.endsWith('.db'))
      .map(f => {
        const full = path.join(backupDir, f);
        return { name: f, path: full, size: fs.statSync(full).size, created: fs.statSync(full).mtime };
      })
      .sort((a, b) => b.created - a.created);
  });

  ipcMain.handle('backup:export', async (_e, filePath) => {
    if (!filePath) return { success: false, message: 'No backup file specified' };
    const { canceled, filePath: savePath } = await dialog.showSaveDialog({
      title: 'Export Database Backup',
      defaultPath: path.basename(filePath),
      filters: [{ name: 'Database Backup', extensions: ['db'] }]
    });
    if (canceled || !savePath) return { success: false, message: 'Cancelled' };
    try {
      fs.copyFileSync(filePath, savePath);
      return { success: true, message: 'Backup exported successfully' };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('backup:import', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Import Database Backup',
      filters: [{ name: 'Database Backup', extensions: ['db'] }],
      properties: ['openFile']
    });
    if (canceled || !filePaths.length) return { success: false, message: 'Cancelled' };
    const backupDir = path.join(app.getPath('userData'), 'backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
    const srcPath = filePaths[0];
    const fileName = path.basename(srcPath);
    const destPath = path.join(backupDir, fileName);
    try {
      fs.copyFileSync(srcPath, destPath);
      return { success: true, message: 'Backup imported successfully' };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  /* ===========================================================
   *  SETTINGS
   * =========================================================== */
  ipcMain.handle('settings:get', (_e, key) => {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : null;
  });

  ipcMain.handle('settings:set', (_e, key, value) => {
    db.prepare(`INSERT INTO settings (key,value) VALUES (?,?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(key, String(value));
    return { success: true };
  });

  ipcMain.handle('settings:getAll', () => {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    return Object.fromEntries(rows.map(r => [r.key, r.value]));
  });
}

module.exports = { registerIpcHandlers };
