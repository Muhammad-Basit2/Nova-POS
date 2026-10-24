/* ============================================================
 *  Nova POS – Excel Handler Tests
 *  Tests for parseItemsFromExcel and exportItemsToBuffer
 * ============================================================ */

const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { parseItemsFromExcel, exportItemsToBuffer } = require('../src/main/excelHandler');

describe('excelHandler – parseItemsFromExcel', () => {
  let tmpDir;
  let tmpFile;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-pos-test-'));
    tmpFile = path.join(tmpDir, 'test.xlsx');
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  });

  function writeExcel(rows) {
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Items');
    XLSX.writeFile(wb, tmpFile);
  }

  it('parses items with all fields correctly', () => {
    writeExcel([{ Barcode: 'BAR001', Name: 'Wheat Flour', Category: 'Grocery',
      CostPrice: 50, SalePrice: 65, Stock: 100, MinStock: 10, Unit: 'kg' }]);
    const items = parseItemsFromExcel(tmpFile);
    expect(items).toHaveLength(1);
    expect(items[0].barcode).toBe('BAR001');
    expect(items[0].name).toBe('Wheat Flour');
    expect(items[0].category).toBe('Grocery');
    expect(items[0].cost_price).toBe(50);
    expect(items[0].sale_price).toBe(65);
    expect(items[0].stock).toBe(100);
    expect(items[0].min_stock).toBe(10);
    expect(items[0].unit).toBe('kg');
    expect(items[0].urdu_name).toBe('');
  });

  it('skips header / empty-name rows', () => {
    writeExcel([{ Barcode: '', Name: 'name', Category: '' },
      { Barcode: 'B002', Name: 'Sugar', Category: 'Grocery' }]);
    const items = parseItemsFromExcel(tmpFile);
    expect(items).toHaveLength(1);
    expect(items[0].barcode).toBe('B002');
  });

  it('auto-generates unique barcodes for items without barcodes', () => {
    writeExcel([{ Name: 'Rice' }, { Name: 'Oil' }]);
    const items = parseItemsFromExcel(tmpFile);
    expect(items).toHaveLength(2);
    expect(items[0].barcode).toMatch(/^AUTO-/);
    expect(items[1].barcode).toMatch(/^AUTO-/);
    expect(items[0].barcode).not.toBe(items[1].barcode);
  });

  it('deduplicates auto-generated barcodes by appending suffix', () => {
    writeExcel([{ Name: 'Rice' }, { Name: 'Rice' }, { Name: 'Rice' }]);
    const items = parseItemsFromExcel(tmpFile);
    expect(items).toHaveLength(3);
    const barcodes = items.map(i => i.barcode);
    expect(new Set(barcodes).size).toBe(3);
  });

  it('preserves user-provided barcodes and auto-generates for blanks', () => {
    writeExcel([{ Barcode: 'USER1', Name: 'Product A' }, { Name: 'Product B' }]);
    const items = parseItemsFromExcel(tmpFile);
    expect(items).toHaveLength(2);
    expect(items[0].barcode).toBe('USER1');
    expect(items[1].barcode).toMatch(/^AUTO-/);
  });

  it('handles missing optional columns gracefully', () => {
    writeExcel([{ Name: 'Mystery Item' }]);
    const items = parseItemsFromExcel(tmpFile);
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe('Mystery Item');
    expect(items[0].cost_price).toBe(0);
    expect(items[0].sale_price).toBe(0);
    expect(items[0].stock).toBe(0);
    expect(items[0].unit).toBe('pcs');
    expect(items[0].urdu_name).toBe('');
  });

  it('coerces numeric strings to numbers', () => {
    writeExcel([{ Name: 'Item', CostPrice: '50.5', SalePrice: '70', Stock: '10', MinStock: '2' }]);
    const items = parseItemsFromExcel(tmpFile);
    expect(items[0].cost_price).toBe(50.5);
    expect(items[0].sale_price).toBe(70);
    expect(items[0].stock).toBe(10);
    expect(items[0].min_stock).toBe(2);
  });

  it('is case-insensitive to column headers', () => {
    writeExcel([{ barcode: 'C1', name: 'Tea', category: 'Beverage',
      costprice: 20, saleprice: 30, stock: 50, minstock: 5, unit: 'pcs' }]);
    const items = parseItemsFromExcel(tmpFile);
    expect(items).toHaveLength(1);
    expect(items[0].barcode).toBe('C1');
    expect(items[0].name).toBe('Tea');
    expect(items[0].category).toBe('Beverage');
    expect(items[0].cost_price).toBe(20);
    expect(items[0].sale_price).toBe(30);
    expect(items[0].stock).toBe(50);
  });
});

describe('excelHandler – exportItemsToBuffer', () => {
  it('produces a valid XLSX buffer from item array', () => {
    const items = [{ barcode: 'B1', name: 'Flour', urdu_name: 'آٹا', category: 'Grocery',
      cost_price: 50, sale_price: 65, stock: 100, min_stock: 10, unit: 'kg' }];
    const buf = exportItemsToBuffer(items);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);
    const wb = XLSX.read(buf, { type: 'buffer' });
    expect(wb.SheetNames).toContain('Items');
    const data = XLSX.utils.sheet_to_json(wb.Sheets['Items']);
    expect(data).toHaveLength(1);
    expect(data[0].Barcode).toBe('B1');
    expect(data[0].Name).toBe('Flour');
    expect(data[0].UrduName).toBe('آٹا');
  });

  it('exports an empty array as a valid but empty sheet', () => {
    const buf = exportItemsToBuffer([]);
    expect(Buffer.isBuffer(buf)).toBe(true);
    const wb = XLSX.read(buf, { type: 'buffer' });
    const data = XLSX.utils.sheet_to_json(wb.Sheets['Items']);
    expect(data).toHaveLength(0);
  });

  it('handles items with missing optional fields', () => {
    const buf = exportItemsToBuffer([{ barcode: 'X', name: 'Simple' }]);
    const data = XLSX.utils.sheet_to_json(XLSX.read(buf, { type: 'buffer' }).Sheets['Items']);
    expect(data[0].Barcode).toBe('X');
    expect(data[0].Name).toBe('Simple');
  });
});

