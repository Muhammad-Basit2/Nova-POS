/* ============================================================
 *  Nova POS – Database Schema Tests
 *  Verifies SQL schema strings in database.js without needing
 *  the native better-sqlite3 module (which requires Electron ABI).
 * ============================================================ */

const fs = require("fs");
const path = require("path");

const dbSrc = fs.readFileSync(path.join(__dirname, "../src/main/database.js"), "utf8");

describe("database – schema SQL verification", () => {
  it("contains CREATE TABLE IF NOT EXISTS items with all required columns", () => {
    expect(dbSrc).toContain("CREATE TABLE IF NOT EXISTS items");
    const itemsIdx = dbSrc.indexOf("CREATE TABLE IF NOT EXISTS items");
    const itemsBlock = dbSrc.substring(itemsIdx, dbSrc.indexOf(");", itemsIdx) + 2);
    ["barcode", "name", "urdu_name", "category", "cost_price", "sale_price", "stock", "min_stock", "unit"]
      .forEach(col => expect(itemsBlock.toLowerCase()).toContain(col.toLowerCase()));
  });

  it("contains CREATE TABLE IF NOT EXISTS sales with required columns", () => {
    expect(dbSrc).toContain("CREATE TABLE IF NOT EXISTS sales");
    const salesIdx = dbSrc.indexOf("CREATE TABLE IF NOT EXISTS sales");
    const salesBlock = dbSrc.substring(salesIdx, dbSrc.indexOf(");", salesIdx) + 2);
    ["invoice_no", "subtotal", "total", "status", "payment_method"].forEach(col => {
      expect(salesBlock.toLowerCase()).toContain(col.toLowerCase());
    });
  });

  it("contains CREATE TABLE IF NOT EXISTS sale_items with quantity as REAL and urdu_name", () => {
    expect(dbSrc).toContain("CREATE TABLE IF NOT EXISTS sale_items");
    const siIdx = dbSrc.indexOf("CREATE TABLE IF NOT EXISTS sale_items");
    const siBlock = dbSrc.substring(siIdx, dbSrc.indexOf(");", siIdx) + 2);
    expect(siBlock.toLowerCase()).toContain("quantity real");
    expect(siBlock.toLowerCase()).toContain("urdu_name");
  });

  it("vendors table is extended with contact_person via migration", () => {
    expect(dbSrc).toContain("ALTER TABLE vendors ADD COLUMN contact_person");
  });

  it("contains CREATE TABLE IF NOT EXISTS returns and return_items", () => {
    expect(dbSrc).toContain("CREATE TABLE IF NOT EXISTS returns");
    expect(dbSrc).toContain("CREATE TABLE IF NOT EXISTS return_items");
    const retIdx = dbSrc.indexOf("CREATE TABLE IF NOT EXISTS returns");
    const retBlock = dbSrc.substring(retIdx, dbSrc.indexOf(");", retIdx) + 2);
    expect(retBlock.toLowerCase()).toContain("return_no");
    expect(retBlock.toLowerCase()).toContain("total_refund");
    expect(retBlock.toLowerCase()).toContain("sale_id");
    const riIdx = dbSrc.indexOf("CREATE TABLE IF NOT EXISTS return_items");
    const riBlock = dbSrc.substring(riIdx, dbSrc.indexOf(");", riIdx) + 2);
    expect(riBlock.toLowerCase()).toContain("refund_amount");
    expect(riBlock.toLowerCase()).toContain("condition");
  });

  it("contains CREATE TABLE IF NOT EXISTS ledger_transactions with entity_type and type", () => {
    expect(dbSrc).toContain("CREATE TABLE IF NOT EXISTS ledger_transactions");
    const ltIdx = dbSrc.indexOf("CREATE TABLE IF NOT EXISTS ledger_transactions");
    const ltBlock = dbSrc.substring(ltIdx, dbSrc.indexOf(");", ltIdx) + 2);
    expect(ltBlock.toLowerCase()).toContain("entity_type");
    expect(ltBlock.toLowerCase()).toContain("type");
    expect(ltBlock.toLowerCase()).toContain("amount");
    expect(ltBlock.toLowerCase()).toContain("reference");
  });

  it("seeds settings table with default keys via INSERT OR IGNORE", () => {
    // The defaults object is defined in seedDefaults before the INSERT statement
    const seedIdx = dbSrc.indexOf("function seedDefaults");
    const seedBlock = dbSrc.substring(seedIdx, seedIdx + 2000);
    ["store_name", "currency", "invoice_prefix", "return_prefix", "language"].forEach(key => {
      expect(seedBlock.toLowerCase()).toContain(key.toLowerCase());
    });
    expect(seedBlock).toContain("Nova POS Store");
    expect(seedBlock).toContain("PKR");
    expect(seedBlock).toContain("INV-");
    // Also verify the INSERT OR IGNORE statement exists
    expect(dbSrc).toContain("INSERT OR IGNORE INTO settings");
  });

  it("sets WAL journal mode", () => {
    expect(dbSrc.toLowerCase()).toContain("journal_mode = wal");
  });

  it("enables foreign keys", () => {
    expect(dbSrc.toLowerCase()).toContain("foreign_keys = on");
  });

  it("adds new columns via ALTER TABLE migrations", () => {
    expect(dbSrc.toLowerCase()).toContain("alter table");
  });

  it("uses db.transaction for batched inserts", () => {
    expect(dbSrc).toContain("db.transaction");
  });
});
