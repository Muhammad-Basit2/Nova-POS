/* ============================================================
 *  Nova POS – Excel Import / Export Helper
 *  src/main/excelHandler.js
 *
 *  Uses SheetJS (xlsx) to convert between Excel files and
 *  the items table in SQLite.
 * ============================================================ */

const XLSX = require('xlsx');

/**
 * Look up a value from a row object using case-insensitive key matching.
 */
function getCell(row, ...keys) {
  for (const k of keys) {
    const found = Object.keys(row).find((rk) => rk.toLowerCase() === k.toLowerCase());
    if (found !== undefined) return row[found];
  }
  return undefined;
}

/**
 * Generate a simple deterministic barcode from a name string.
 * Used as a fallback when the Excel file has no barcode column.
 */
function generateBarcode(name, suffix) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  }
  let code = Math.abs(hash).toString(36).toUpperCase();
  if (suffix) code += suffix;
  return "AUTO-" + code;
}

/**
 * Parse an Excel (.xlsx / .xls) file and return an array of item objects.
 * Expected columns: Barcode, Name, UrduName, Category,
 *                   CostPrice, SalePrice, Stock, MinStock, Unit
 */
function parseItemsFromExcel(filePath) {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" });

  // First pass: build all items, tracking barcode usage for auto-generated ones
  const rawItems = rows.map((r) => ({
    barcode:    String(getCell(r, "Barcode", "barCode", "barcode") ?? "").trim(),
    name:       String(getCell(r, "Name", "name") ?? "").trim(),
    urdu_name:  String(getCell(r, "UrduName", "urdu_name") ?? "").trim(),
    category:   String(getCell(r, "Category", "category") ?? "").trim(),
    cost_price: parseFloat(getCell(r, "CostPrice", "cost_price") ?? 0) || 0,
    sale_price: parseFloat(getCell(r, "SalePrice", "sale_price") ?? 0) || 0,
    stock:      parseInt(getCell(r, "Stock", "stock") ?? 0, 10) || 0,
    min_stock:  parseInt(getCell(r, "MinStock", "min_stock") ?? 0, 10) || 0,
    unit:       String(getCell(r, "Unit", "unit") ?? "pcs").trim(),
  }));

  // Count how many times each auto-generated barcode would collide
  const barcodeCount = {};
  for (const item of rawItems) {
    if (!item.name || item.name.toLowerCase() === "name") continue;
    if (item.barcode) continue; // user-provided barcode, skip
    const key = generateBarcode(item.name);
    barcodeCount[key] = (barcodeCount[key] || 0) + 1;
  }

  // Second pass: filter, deduplicate auto-barcode collisions, and apply suffixes
  const usedAutoBarcodes = {};
  return rawItems.filter((item) => {
    // Skip header / empty-name rows
    if (!item.name || item.name.toLowerCase() === "name") return false;
    // Keep rows that already have a user-provided barcode
    if (item.barcode) return true;
    // Auto-generate a unique barcode
    const base = generateBarcode(item.name);
    const count = barcodeCount[base];
    if (count <= 1) {
      item.barcode = base;
      return true;
    }
    // Duplicate — append a numeric suffix
    usedAutoBarcodes[base] = (usedAutoBarcodes[base] || 0) + 1;
    item.barcode = base + usedAutoBarcodes[base];
    return true;
  });
}

/**
 * Export an array of item objects to an Excel buffer (Uint8Array).
 */
function exportItemsToBuffer(items) {
  const data = items.map((i) => ({
    Barcode:   i.barcode,
    Name:      i.name,
    UrduName:  i.urdu_name || "",
    Category:  i.category,
    CostPrice: i.cost_price,
    SalePrice: i.sale_price,
    Stock:     i.stock,
    MinStock:  i.min_stock,
    Unit:      i.unit,
  }));

  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Items");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

module.exports = { parseItemsFromExcel, exportItemsToBuffer };