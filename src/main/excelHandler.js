/* ============================================================
 *  Nova POS – Excel Import / Export Helper
 *  src/main/excelHandler.js
 *
 *  Uses SheetJS (xlsx) to convert between Excel files and
 *  the items table in SQLite.
 * ============================================================ */

const XLSX = require('xlsx');

/**
 * Parse an Excel (.xlsx / .xls) file and return an array of item objects.
 * Expected columns: Barcode, Name, Category,
 *                   CostPrice, SalePrice, Stock, MinStock, Unit
 */
function parseItemsFromExcel(filePath) {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });

  return rows.map((r) => ({
    barcode:    String(r['Barcode'] ?? r['barcode'] ?? '').trim(),
    name:       String(r['Name'] ?? r['name'] ?? '').trim(),
    category:   String(r['Category'] ?? r['category'] ?? '').trim(),
    cost_price: parseFloat(r['CostPrice'] ?? r['cost_price'] ?? 0) || 0,
    sale_price: parseFloat(r['SalePrice'] ?? r['sale_price'] ?? 0) || 0,
    stock:      parseInt(r['Stock'] ?? r['stock'] ?? 0, 10) || 0,
    min_stock:  parseInt(r['MinStock'] ?? r['min_stock'] ?? 0, 10) || 0,
    unit:       String(r['Unit'] ?? r['unit'] ?? 'pcs').trim(),
  }));
}

/**
 * Export an array of item objects to an Excel buffer (Uint8Array).
 */
function exportItemsToBuffer(items) {
  const data = items.map((i) => ({
    Barcode:   i.barcode,
    Name:      i.name,
    Category:  i.category,
    CostPrice: i.cost_price,
    SalePrice: i.sale_price,
    Stock:     i.stock,
    MinStock:  i.min_stock,
    Unit:      i.unit,
  }));

  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Items');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = { parseItemsFromExcel, exportItemsToBuffer };
