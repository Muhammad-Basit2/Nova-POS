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
      INSERT INTO items (barcode, name, urdu_name, category, cost_price, sale_price, stock, min_stock, unit)
      VALUES (@barcode, @name, @urdu_name, @category, @cost_price, @sale_price, @stock, @min_stock, @unit)
    `);
    const info = stmt.run({ urdu_name: '', ...data });
    return { id: info.lastInsertRowid, ...data };
  });

  ipcMain.handle('items:update', (_e, id, data) => {
    const stmt = db.prepare(`
      UPDATE items SET barcode=@barcode, name=@name, urdu_name=@urdu_name, category=@category,
        cost_price=@cost_price, sale_price=@sale_price, stock=@stock, min_stock=@min_stock,
        unit=@unit, is_active=@is_active, updated_at=datetime('now','localtime')
      WHERE id = @id
    `);
    stmt.run({ id, urdu_name: '', ...data });
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

    const weeklySalesRaw = db.prepare(`
      SELECT date(created_at) AS sale_date, COALESCE(SUM(total), 0) AS total, COALESCE(COUNT(*), 0) AS count
      FROM sales
      WHERE created_at >= datetime('now', '-6 days', 'start of day', 'localtime')
      GROUP BY date(created_at)
      ORDER BY sale_date ASC
    `).all();

    const weeklySales = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const found = weeklySalesRaw.find(r => r.sale_date === dateStr);
      weeklySales.push({
        date: dateStr,
        label: d.toLocaleDateString([], { weekday: 'short', month: 'numeric', day: 'numeric' }),
        total: found ? found.total : 0,
        count: found ? found.count : 0
      });
    }

    const categorySales = db.prepare(`
      SELECT COALESCE(i.category, 'Uncategorized') AS category, COALESCE(SUM(si.line_total), 0) AS total
      FROM sale_items si
      LEFT JOIN items i ON si.item_id = i.id
      GROUP BY category
      ORDER BY total DESC
      LIMIT 5
    `).all();

    const topItems = db.prepare(`
      SELECT si.item_name, COALESCE(SUM(si.quantity), 0) AS qty, COALESCE(SUM(si.line_total), 0) AS total
      FROM sale_items si
      GROUP BY si.item_name
      ORDER BY qty DESC
      LIMIT 5
    `).all();

    return {
      todaySales: todaySalesRes.total_sales,
      txCount: todaySalesRes.tx_count,
      todayProfit: todayProfitRes.total_profit,
      lowStockItems,
      totalItems,
      weeklySales,
      categorySales,
      topItems
    };
  });

  /* ===========================================================
   *  SALES
   * =========================================================== */
  ipcMain.handle('sales:create', (_e, saleData) => {
    const { items: cartItems, customer_id, discount, amount_paid, payment_method, notes } = saleData;

    const subtotal = cartItems.reduce((s, i) => s + i.line_total, 0);
    const total    = subtotal - (discount || 0);
    const paid     = amount_paid || 0;
    const remaining_balance = Math.max(total - paid, 0);
    const change   = Math.max(paid - total, 0);

    let status = 'PAID';
    if (payment_method === 'credit') {
      status = remaining_balance > 0 ? (paid > 0 ? 'PARTIAL_CREDIT' : 'CREDIT') : 'PAID';
    } else {
      if (remaining_balance > 0) {
        status = paid > 0 ? 'PARTIAL' : 'UNPAID';
      }
    }

    /* Generate invoice number */
    const prefix = db.prepare("SELECT value FROM settings WHERE key='invoice_prefix'").get()?.value || 'INV-';
    const last   = db.prepare("SELECT COALESCE(MAX(id), 0) AS max_id FROM sales").get().max_id;
    const invoice_no = `${prefix}${String(last + 1).padStart(6, '0')}`;

    const insertSale = db.prepare(`
      INSERT INTO sales (invoice_no, customer_id, subtotal, discount, total, amount_paid, change_due, payment_method, status, notes)
      VALUES (@invoice_no, @customer_id, @subtotal, @discount, @total, @amount_paid, @change_due, @payment_method, @status, @notes)
    `);
    const insertItem = db.prepare(`
      INSERT INTO sale_items (sale_id, item_id, item_name, urdu_name, barcode, quantity, unit, unit_price, line_total)
      VALUES (@sale_id, @item_id, @item_name, @urdu_name, @barcode, @quantity, @unit, @unit_price, @line_total)
    `);
    const updateStock = db.prepare('UPDATE items SET stock = stock - ? WHERE id = ?');

    const run = db.transaction(() => {
      const info = insertSale.run({
        invoice_no, customer_id: customer_id || null,
        subtotal, discount: discount || 0, total,
        amount_paid: paid, change_due: change,
        payment_method: payment_method || 'cash', status, notes: notes || ''
      });
      const saleId = info.lastInsertRowid;
      for (const ci of cartItems) {
      insertItem.run({
          sale_id: saleId, item_id: ci.item_id || null,
          item_name: ci.item_name, urdu_name: ci.urdu_name || '', barcode: ci.barcode || '',
          quantity: ci.quantity, unit: ci.unit || '', unit_price: ci.unit_price,
          line_total: ci.line_total
        });
        if (ci.item_id) updateStock.run(ci.quantity, ci.item_id);
      }
      /* Update customer balance if credit — add only the unpaid remaining balance */
      if (customer_id && payment_method === 'credit') {
        db.prepare('UPDATE customers SET balance = balance + ? WHERE id = ?').run(remaining_balance, customer_id);
        db.prepare(`INSERT INTO ledger_transactions (entity_type,entity_id,type,amount,description,reference)
          VALUES ('customer',?,'debit',?,?,?)`).run(customer_id, remaining_balance, `Sale ${invoice_no}`, invoice_no);
      }
      return saleId;
    });

    const saleId = run();
    return db.prepare('SELECT s.*, c.name AS customer_name, c.balance AS customer_balance FROM sales s LEFT JOIN customers c ON s.customer_id = c.id WHERE s.id = ?').get(saleId);
  });

  ipcMain.handle('sales:getAll', (_e, filters = {}) => {
    let sql = 'SELECT s.*, c.name AS customer_name, c.balance AS customer_balance FROM sales s LEFT JOIN customers c ON s.customer_id = c.id WHERE 1=1';
    const params = [];
    if (filters.from) { sql += ' AND s.created_at >= ?'; params.push(filters.from); }
    if (filters.to)   { sql += ' AND s.created_at <= ?'; params.push(filters.to); }
    if (filters.payment_method) { sql += ' AND s.payment_method = ?'; params.push(filters.payment_method); }
    sql += ' ORDER BY s.id DESC';
    if (filters.limit) { sql += ' LIMIT ?'; params.push(filters.limit); }
    return db.prepare(sql).all(...params);
  });

  ipcMain.handle('sales:getById', (_e, id) => {
    return db.prepare('SELECT s.*, c.name AS customer_name, c.balance AS customer_balance FROM sales s LEFT JOIN customers c ON s.customer_id = c.id WHERE s.id = ?').get(id);
  });

  ipcMain.handle('sales:getItems', (_e, saleId) => {
    return db.prepare(`
      SELECT sale_items.*, COALESCE(NULLIF(sale_items.urdu_name, ''), items.urdu_name, '') AS urdu_name
      FROM sale_items
      LEFT JOIN items ON items.id = sale_items.item_id
      WHERE sale_items.sale_id = ?
    `).all(saleId);
  });

  /* ===========================================================
   *  STOCK PURCHASES
   * =========================================================== */
  ipcMain.handle('purchases:getAll', () => {
    return db.prepare(`
      SELECT purchases.*, COALESCE(vendors.name, 'Deleted supplier') AS supplier_name,
        MAX(purchases.total_amount - purchases.paid_amount, 0) AS balance_due
      FROM purchases
      LEFT JOIN vendors ON vendors.id = purchases.vendor_id
      ORDER BY purchases.id DESC
    `).all();
  });
  ipcMain.handle('purchases:create', (_e, data) => {
    const vendorId = Number(data.vendor_id);
    const totalAmount = Number(data.total_amount);
    const paidAmount = Number(data.paid_amount || 0);
    const invoiceNo = String(data.invoice_no || '').trim();

    if (!Number.isInteger(vendorId) || !db.prepare('SELECT id FROM vendors WHERE id = ?').get(vendorId)) {
      throw new Error('Select a valid supplier for this purchase');
    }
    if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
      throw new Error('Purchase total must be greater than zero');
    }
    if (!Number.isFinite(paidAmount) || paidAmount < 0 || paidAmount > totalAmount) {
      throw new Error('Paid amount must be between zero and the purchase total');
    }

    const finalInvoiceNo = invoiceNo || `PUR-${String(db.prepare('SELECT COUNT(*) AS count FROM purchases').get().count + 1).padStart(6, '0')}`;
    const createPurchase = db.transaction(() => {
      const vendor = db.prepare('SELECT balance FROM vendors WHERE id = ?').get(vendorId);
      const advanceApplied = Math.min(Math.max(-vendor.balance, 0), totalAmount - paidAmount);
      const recordedPaidAmount = paidAmount + advanceApplied;
      const info = db.prepare(`
        INSERT INTO purchases (invoice_no, vendor_id, total_amount, paid_amount)
        VALUES (?, ?, ?, ?)
      `).run(finalInvoiceNo, vendorId, totalAmount, recordedPaidAmount);

      db.prepare(`
        INSERT INTO ledger_transactions (entity_type, entity_id, type, amount, description, reference)
        VALUES ('vendor', ?, 'debit', ?, 'Stock purchase', ?)
      `).run(vendorId, totalAmount, finalInvoiceNo);
      db.prepare('UPDATE vendors SET balance = balance + ? WHERE id = ?').run(totalAmount, vendorId);

      if (paidAmount > 0) {
        db.prepare(`
          INSERT INTO ledger_transactions (entity_type, entity_id, type, amount, description, reference)
          VALUES ('vendor', ?, 'credit', ?, 'Payment on stock purchase', ?)
        `).run(vendorId, paidAmount, finalInvoiceNo);
        db.prepare('UPDATE vendors SET balance = balance - ? WHERE id = ?').run(paidAmount, vendorId);
      }

      return Number(info.lastInsertRowid);
    });

    const id = createPurchase();
    return db.prepare(`
      SELECT purchases.*, COALESCE(vendors.name, 'Deleted supplier') AS supplier_name,
        MAX(purchases.total_amount - purchases.paid_amount, 0) AS balance_due
      FROM purchases LEFT JOIN vendors ON vendors.id = purchases.vendor_id
      WHERE purchases.id = ?
    `).get(id);
  });
  ipcMain.handle('purchases:recordPayment', (_e, id, data) => {
    const purchaseId = Number(id);
    const amount = Number(data.amount);
    const description = String(data.description || 'Payment on stock purchase').trim();
    if (!Number.isInteger(purchaseId)) throw new Error('Invalid purchase');
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Payment must be greater than zero');

    const recordPayment = db.transaction(() => {
      const purchase = db.prepare('SELECT * FROM purchases WHERE id = ?').get(purchaseId);
      if (!purchase) throw new Error('Purchase not found');
      if (!purchase.vendor_id) throw new Error('The supplier for this purchase is no longer available');
      const due = Math.max(purchase.total_amount - purchase.paid_amount, 0);
      if (amount > due) throw new Error('Payment cannot exceed the remaining balance');
      const vendor = db.prepare('SELECT balance FROM vendors WHERE id = ?').get(purchase.vendor_id);
      if (amount > vendor.balance) throw new Error('Payment cannot exceed the supplier payable balance');

      db.prepare('UPDATE purchases SET paid_amount = paid_amount + ? WHERE id = ?').run(amount, purchaseId);
      db.prepare(`
        INSERT INTO ledger_transactions (entity_type, entity_id, type, amount, description, reference)
        VALUES ('vendor', ?, 'credit', ?, ?, ?)
      `).run(purchase.vendor_id, amount, description, purchase.invoice_no);
      db.prepare('UPDATE vendors SET balance = balance - ? WHERE id = ?').run(amount, purchase.vendor_id);
    });
    recordPayment();
    return db.prepare(`
      SELECT purchases.*, COALESCE(vendors.name, 'Deleted supplier') AS supplier_name,
        MAX(purchases.total_amount - purchases.paid_amount, 0) AS balance_due
      FROM purchases LEFT JOIN vendors ON vendors.id = purchases.vendor_id
      WHERE purchases.id = ?
    `).get(purchaseId);
  });
  ipcMain.handle("purchases:delete", (_e, id) => {
    const purchaseId = Number(id);
    if (!Number.isInteger(purchaseId)) throw new Error("Invalid purchase ID");
    const purchase = db.prepare("SELECT * FROM purchases WHERE id = ?").get(purchaseId);
    if (!purchase) throw new Error("Purchase not found");
    const { vendor_id, total_amount, paid_amount, invoice_no } = purchase;
    const del = db.transaction(() => {
      if (vendor_id) {
        db.prepare(`
          DELETE FROM ledger_transactions
          WHERE entity_type = "vendor" AND entity_id = ? AND reference = ?
        `).run(vendor_id, invoice_no);
        const balanceDue = Math.max(total_amount - paid_amount, 0);
        db.prepare("UPDATE vendors SET balance = balance - ? WHERE id = ?").run(balanceDue, vendor_id);
      }
      db.prepare("DELETE FROM purchases WHERE id = ?").run(purchaseId);
    });
    del();
    return { success: true };
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
    const info = db.prepare('INSERT INTO customers (name,phone,cnic,address) VALUES (@name,@phone,@cnic,@address)').run(data);
    return { id: info.lastInsertRowid, ...data, balance: 0 };
  });
  ipcMain.handle('customers:update', (_e, id, data) => {
    db.prepare('UPDATE customers SET name=@name, phone=@phone, cnic=@cnic, address=@address WHERE id=@id').run({ id, ...data });
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
    return db.prepare(`
      SELECT vendors.*,
        COALESCE(SUM(CASE WHEN ledger_transactions.type = 'credit' THEN ledger_transactions.amount ELSE 0 END), 0) AS total_paid
      FROM vendors
      LEFT JOIN ledger_transactions
        ON ledger_transactions.entity_type = 'vendor' AND ledger_transactions.entity_id = vendors.id
      GROUP BY vendors.id
      ORDER BY vendors.name ASC
    `).all();
  });
  ipcMain.handle('vendors:getById', (_e, id) => {
    return db.prepare('SELECT * FROM vendors WHERE id = ?').get(id);
  });
  ipcMain.handle('vendors:create', (_e, data) => {
    const initialBalance = Number(data.initial_balance || 0);
    if (!Number.isFinite(initialBalance) || initialBalance < 0) {
      throw new Error('Initial payable balance must be a non-negative amount');
    }

    const createVendor = db.transaction(() => {
      const info = db.prepare(`
        INSERT INTO vendors (name,contact_person,phone,address)
        VALUES (@name,@contact_person,@phone,@address)
      `).run({
        name: data.name,
        contact_person: data.contact_person || '',
        phone: data.phone || '',
        address: data.address || ''
      });
      const id = Number(info.lastInsertRowid);
      if (initialBalance > 0) {
        db.prepare(`
          INSERT INTO ledger_transactions (entity_type,entity_id,type,amount,description,reference)
          VALUES ('vendor',?,'debit',?,'Initial payable balance','Opening balance')
        `).run(id, initialBalance);
        db.prepare('UPDATE vendors SET balance = balance + ? WHERE id = ?').run(initialBalance, id);
      }
      return db.prepare('SELECT * FROM vendors WHERE id = ?').get(id);
    });

    return createVendor();
  });
  ipcMain.handle('vendors:update', (_e, id, data) => {
    db.prepare('UPDATE vendors SET name=@name, contact_person=@contact_person, phone=@phone, address=@address WHERE id=@id')
      .run({ id, ...data, contact_person: data.contact_person || '' });
    return db.prepare('SELECT * FROM vendors WHERE id = ?').get(id);
  });
  ipcMain.handle('vendors:delete', (_e, id) => {
    db.prepare('DELETE FROM vendors WHERE id = ?').run(id);
    return { success: true };
  });
  ipcMain.handle('vendors:getLedger', (_e, id) => {
    return db.prepare("SELECT * FROM ledger_transactions WHERE entity_type='vendor' AND entity_id=? ORDER BY created_at DESC").all(id);
  });
  ipcMain.handle('vendors:addPayment', (_e, id, data) => {
    const vendorId = Number(id);
    const amount = Number(data.amount);
    if (!Number.isInteger(vendorId) || !db.prepare('SELECT id FROM vendors WHERE id = ?').get(vendorId)) {
      throw new Error('Supplier not found');
    }
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Payment must be greater than zero');

    const description = String(data.description || 'Supplier payment').trim();
    const recordPayment = db.transaction(() => {
      const vendor = db.prepare('SELECT balance FROM vendors WHERE id = ?').get(vendorId);
      let remainingPayment = Math.min(amount, Math.max(vendor.balance, 0));
      const openPurchases = db.prepare(`
        SELECT id, total_amount, paid_amount
        FROM purchases
        WHERE vendor_id = ? AND total_amount > paid_amount
        ORDER BY id ASC
      `).all(vendorId);
      const updatePurchasePaid = db.prepare('UPDATE purchases SET paid_amount = paid_amount + ? WHERE id = ?');
      for (const purchase of openPurchases) {
        if (remainingPayment <= 0) break;
        const purchaseDue = purchase.total_amount - purchase.paid_amount;
        const appliedAmount = Math.min(remainingPayment, purchaseDue);
        updatePurchasePaid.run(appliedAmount, purchase.id);
        remainingPayment -= appliedAmount;
      }

      db.prepare(`
        INSERT INTO ledger_transactions (entity_type, entity_id, type, amount, description, reference)
        VALUES ('vendor', ?, 'credit', ?, ?, '')
      `).run(vendorId, amount, description);
      db.prepare('UPDATE vendors SET balance = balance - ? WHERE id = ?').run(amount, vendorId);
    });
    recordPayment();
    return { success: true };
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
        INSERT INTO items (barcode,name,urdu_name,category,cost_price,sale_price,stock,min_stock,unit)
        VALUES (@barcode,@name,@urdu_name,@category,@cost_price,@sale_price,@stock,@min_stock,@unit)
        ON CONFLICT(barcode) DO UPDATE SET
          name=excluded.name,
          urdu_name=CASE WHEN excluded.urdu_name='' THEN items.urdu_name ELSE excluded.urdu_name END,
          category=excluded.category,
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

  ipcMain.handle('backup:delete', async (_e, filePath) => {
    if (!filePath) return { success: false, message: 'No backup file specified' };
    const backupDir = path.join(app.getPath('userData'), 'backups');
    const resolvedPath = path.resolve(filePath);
    if (!resolvedPath.startsWith(path.resolve(backupDir)) || !fs.existsSync(resolvedPath)) {
      return { success: false, message: 'Invalid backup file path' };
    }
    try {
      fs.unlinkSync(resolvedPath);
      return { success: true, message: 'Backup deleted successfully' };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  /* ===========================================================
   *  DATA MANAGEMENT / CLEANUP
   * =========================================================== */
  ipcMain.handle('data:clearSales', () => {
    try {
      db.prepare('DELETE FROM sale_items').run();
      db.prepare('DELETE FROM sales').run();
      return { success: true, message: 'Sales history cleared successfully' };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('data:clearInventory', () => {
    try {
      db.prepare('DELETE FROM items').run();
      return { success: true, message: 'Inventory cleared successfully' };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('data:clearLedger', () => {
    try {
      db.prepare('DELETE FROM ledger_transactions').run();
      db.prepare('DELETE FROM customers').run();
      db.prepare('DELETE FROM vendors').run();
      return { success: true, message: 'Ledger, customers and vendors cleared successfully' };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('data:clearAll', () => {
    try {
      db.prepare('DELETE FROM sale_items').run();
      db.prepare('DELETE FROM sales').run();
      db.prepare('DELETE FROM items').run();
      db.prepare('DELETE FROM ledger_transactions').run();
      db.prepare('DELETE FROM customers').run();
      db.prepare('DELETE FROM vendors').run();
      return { success: true, message: 'All business data cleared successfully' };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  /* ===========================================================
   *  INVOICE LOGO
   * =========================================================== */
  const LOGO_MIME = {
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif':  'image/gif',
    '.webp': 'image/webp',
    '.bmp':  'image/bmp',
    '.svg':  'image/svg+xml',
  };

  function getLogoDir() {
    const dir = path.join(app.getPath('userData'), 'logos');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  /* Return a base64 data URL so the renderer can display the image
     without needing file:// access (works with the app CSP). */
  function logoToDataUrl(filePath) {
    if (!filePath || !fs.existsSync(filePath)) return null;
    const mime = LOGO_MIME[path.extname(filePath).toLowerCase()];
    if (!mime) return null;
    try {
      return `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}`;
    } catch (_) {
      return null;
    }
  }

  function writeSetting(key, value) {
    db.prepare(`INSERT INTO settings (key,value) VALUES (?,?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(key, String(value));
  }

  ipcMain.handle('logo:pick', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Choose Invoice Logo',
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] }],
      properties: ['openFile'],
    });
    if (canceled || !filePaths.length) return { success: false, message: 'Cancelled' };

    try {
      const source = filePaths[0];
      const ext = path.extname(source).toLowerCase();
      if (!LOGO_MIME[ext]) return { success: false, message: 'Unsupported image type' };

      /* Keep our own copy so the logo survives if the source file moves */
      const target = path.join(getLogoDir(), `invoice-logo-${Date.now()}${ext}`);
      fs.copyFileSync(source, target);

      /* Clean up the previously stored copy (never the user's own file) */
      const previous = db.prepare("SELECT value FROM settings WHERE key='logo_path'").get()?.value;
      const logoDir = getLogoDir();
      if (previous && previous.startsWith(logoDir) && fs.existsSync(previous)) {
        try { fs.unlinkSync(previous); } catch (_) { /* ignore */ }
      }

      writeSetting('logo_path', target);
      return { success: true, path: target, dataUrl: logoToDataUrl(target) };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('logo:getDataUrl', () => {
    const filePath = db.prepare("SELECT value FROM settings WHERE key='logo_path'").get()?.value;
    if (!filePath) return null;
    return logoToDataUrl(filePath);
  });

  ipcMain.handle('logo:remove', () => {
    const filePath = db.prepare("SELECT value FROM settings WHERE key='logo_path'").get()?.value;
    const logoDir = getLogoDir();
    if (filePath && filePath.startsWith(logoDir) && fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch (_) { /* ignore */ }
    }
    writeSetting('logo_path', '');
    return { success: true };
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

  /* ===========================================================
   *  RETURNS / REFUNDS
   * =========================================================== */
  ipcMain.handle('sales:createReturn', (_e, data) => {
    const { saleId, returnItems, notes } = data;
    if (!Number.isInteger(saleId) || !returnItems?.length) {
      throw new Error('Invalid return data');
    }

    const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId);
    if (!sale) throw new Error('Sale not found');
    if (sale.status === 'RETURNED') throw new Error('This invoice has already been fully returned');

    const returnPrefix = db.prepare("SELECT value FROM settings WHERE key='return_prefix'").get()?.value || 'RET-';
    const lastReturn = db.prepare("SELECT COUNT(*) AS cnt FROM returns").get().cnt;
    const return_no = `${returnPrefix}${String(lastReturn + 1).padStart(6, '0')}`;

    const run = db.transaction(() => {
      // Insert return header
      const retInfo = db.prepare(`
        INSERT INTO returns (return_no, sale_id, customer_id, total_refund, refund_method, notes, created_at)
        VALUES (@return_no, @sale_id, @customer_id, @total_refund, @refund_method, @notes, datetime('now','localtime'))
      `).run({
        return_no, sale_id: saleId, customer_id: sale.customer_id,
        total_refund: 0, refund_method: sale.payment_method, notes: notes || ''
      });
      const returnId = retInfo.lastInsertRowid;

      let totalRefund = 0;

      for (const ri of returnItems) {
        const saleItem = db.prepare('SELECT * FROM sale_items WHERE id = ? AND sale_id = ?').get(ri.sale_item_id, saleId);
        if (!saleItem) throw new Error(`Sale item ${ri.sale_item_id} not found in this invoice`);
        const qtyToReturn = Math.min(Number(ri.quantity) || 1, saleItem.quantity);
        if (qtyToReturn <= 0) continue;

        const refundAmount = qtyToReturn * saleItem.unit_price;
        totalRefund += refundAmount;

        // Insert return item
        db.prepare(`
          INSERT INTO return_items (return_id, sale_item_id, item_id, item_name, quantity, unit, unit_price, refund_amount, condition)
          VALUES (@return_id, @sale_item_id, @item_id, @item_name, @quantity, @unit, @unit_price, @refund_amount, @condition)
        `).run({
          return_id: returnId, sale_item_id: saleItem.id,
          item_id: saleItem.item_id, item_name: saleItem.item_name,
          quantity: qtyToReturn, unit: saleItem.unit || '', unit_price: saleItem.unit_price,
          refund_amount: refundAmount, condition: 'resalable'
        });

        // Restock
        if (saleItem.item_id) {
          db.prepare('UPDATE items SET stock = stock + ? WHERE id = ?').run(qtyToReturn, saleItem.item_id);
        }
      }

      // Update return total
      db.prepare('UPDATE returns SET total_refund = ? WHERE id = ?').run(totalRefund, returnId);

      // Update sale status
      const existingReturn = db.prepare('SELECT COALESCE(SUM(ri.quantity),0) AS returned_qty FROM return_items ri JOIN sale_items si ON ri.sale_item_id = si.id WHERE si.sale_id = ?').get(saleId);
      const totalSold = db.prepare('SELECT COALESCE(SUM(si.quantity),0) AS total_qty FROM sale_items si WHERE si.sale_id = ?').get(saleId);
      const status = existingReturn.returned_qty >= totalSold.total_qty ? 'RETURNED' : 'PARTIAL_RETURN';
      db.prepare('UPDATE sales SET status = ? WHERE id = ?').run(status, saleId);

      // Refund customer balance for credit sales
      if (sale.customer_id && sale.payment_method === 'credit') {
        db.prepare('UPDATE customers SET balance = balance - ? WHERE id = ?').run(totalRefund, sale.customer_id);
        db.prepare(`
          INSERT INTO ledger_transactions (entity_type, entity_id, type, amount, description, reference)
          VALUES ('customer', ?, 'credit', ?, ?, ?)
        `).run(sale.customer_id, totalRefund, `Return refund (${return_no})`, return_no);
      }

      return { returnId, return_no, totalRefund };
    });

    return run();
  });

  ipcMain.handle('sales:getReturns', (_e, saleId) => {
    return db.prepare(`
      SELECT r.*,
        (SELECT GROUP_CONCAT(ri.item_name || ' x' || ri.quantity) FROM return_items ri WHERE ri.return_id = r.id) AS items_summary
      FROM returns r
      WHERE r.sale_id = ?
      ORDER BY r.created_at DESC
    `).all(saleId);
  });
}

module.exports = { registerIpcHandlers };
