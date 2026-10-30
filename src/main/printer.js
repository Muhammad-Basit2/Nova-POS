/* ============================================================
 *  Nova POS – ESC/POS Thermal Printer Module
 *  src/main/printer.js
 *
 *  Direct raw ESC/POS printing that bypasses the Windows
 *  print spooler — no browser render lag, instant cut.
 *
 *  Usage (main process):
 *    const { Printer } = require('./printer');
 *    const printer = new Printer({ interface: 'tcp://192.168.1.100' });
 *    await printer.printReceipt(saleData, settings);
 *
 *  Called from renderer via IPC:
 *    ipcRenderer.invoke('sales:printReceipt', saleId)
 * ============================================================ */

const path = require('path');
const fs = require('fs');

// --- node-thermal-printer ---
const { ThermalPrinter, PrinterTypes, CharacterSet, BreakLine } = require('node-thermal-printer');

// --- Error codes for renderer-side toast classification ---
const PRINT_ERROR = {
  NOT_CONFIGURED: 'printer_not_configured',
  NOT_CONNECTED: 'printer_not_connected',
  OFFLINE: 'printer_offline',
  PAPER_OUT: 'printer_paper_out',
  TIMEOUT: 'printer_timeout',
  UNKNOWN: 'printer_unknown',
};

/**
 * Build a fresh ThermalPrinter instance ready for a receipt.
 * @param {object} cfg  – same shape as the node-thermal-printer constructor options
 * @param {number} cfg.width         Characters per line (42 for 58mm, 48 for 80mm)
 * @param {string} cfg.interface     e.g. 'tcp://192.168.1.100', 'printer:EPSON TM-T88V', '\\\\server\\share'
 * @param {string} cfg.type          'epson' | 'star'  (default 'epson')
 */
function createPrinterInstance(cfg) {
  return new ThermalPrinter({
    type: cfg.type || PrinterTypes.EPSON,
    width: cfg.width || 48,
    interface: cfg.interface,
    driver: cfg.driver,
    characterSet: CharacterSet.WPC1252,
    breakLine: BreakLine.WORD,
    removeSpecialCharacters: false,
    lineCharacter: '-',
    options: cfg.options || {},
  });
}

/**
 * Format and print a full transaction receipt to ESC/POS.
 *
 * @param {object} saleData   – sale row from DB + sale_items array
 * @param {object} settings   – flat settings object from settings table
 * @param {object} printerCfg – printer configuration (interface, width, type)
 * @returns {object}  { success, error, errorCode }
 */
async function printReceipt(saleData, settings, printerCfg) {
  // ---------- validate ----------
  if (!printerCfg?.interface) {
    return { success: false, error: 'No printer interface configured.', errorCode: PRINT_ERROR.NOT_CONFIGURED };
  }
  if (!saleData?.id) {
    return { success: false, error: 'Invalid sale data.', errorCode: PRINT_ERROR.UNKNOWN };
  }

  const {
    invoice_no, created_at, customer_name,
    subtotal, discount, total, amount_paid, change_due,
    payment_method, notes, status,
  } = saleData;

  const items = saleData.items || [];

  // --- receipt text data ---
  const storeName       = settings?.store_name || 'Nova POS Store';
  const storePhone      = settings?.store_phone || '';
  const storeAddress    = settings?.store_address || '';
  const receiptFooter   = settings?.receipt_footer || 'Thank you for your business!';
  const currency        = settings?.currency || 'PKR';
  const taxRate         = parseFloat(settings?.tax_rate || 0) || 0;
  const customerDisplay = customer_name || (notes?.startsWith('Walk-in:') ? notes : 'Walk-in Customer');
  const [dateStr, timeStr] = (created_at || '').split(' ');

  // --- build buffer ---
  const printer = createPrinterInstance(printerCfg);

  // Header ----------------------------------------------------------
  printer.alignCenter();
  printer.setTextSize(2, 2);
  printer.println(storeName.toUpperCase());
  printer.setTextNormal();
  printer.newLine();

  const metaLines = [storeAddress, storePhone ? `Tel: ${storePhone}` : null].filter(Boolean);
  printer.alignCenter();
  printer.println(metaLines.join('  |  '));
  printer.println(`CNIC: ${(settings?.store_cnic) || ''}`.replace(/^CNIC: $/, ''));
  printer.newLine();

  printer.drawLine('=');
  printer.newLine();

  // Invoice meta
  printer.alignCenter();
  printer.setTypeFontB();
  printer.println(`INVOICE: ${invoice_no}`);
  printer.setTypeFontA();
  printer.println(`${dateStr || ''}   ${timeStr || ''}`);
  printer.println(`Cashier: ${(settings?.cashier_name) || 'N/A'}`);
  printer.println(`Method:  ${String(payment_method || '').toUpperCase()}`);
  printer.newLine();
  printer.drawLine('-');
  printer.newLine();

  // Items table header
  printer.setTypeFontB();
  printer.leftRight('Item', 'Qty  Price    Total');
  printer.setTypeFontA();
  printer.drawLine('-');

  // Item rows
  for (const item of items) {
    const name  = String(item.item_name || '').substring(0, 26);
    const qty   = `${item.quantity}${item.unit ? ' ' + item.unit : ''}`;
    const price = Number(item.unit_price || 0).toFixed(2);
    const lineT = Number(item.line_total || 0).toFixed(2);
    const line = `${name.padEnd(26)}${qty.padStart(4).substring(0, 4)} ${price.padStart(8)} ${lineT.padStart(9)}`;
    printer.println(line.substring(0, 48));
  }

  printer.drawLine('-');
  printer.newLine();

  // Summary
  printer.alignLeft();
  printer.leftRight('Subtotal:', `${Number(subtotal || 0).toFixed(2)} ${currency}`);

  if (taxRate > 0) {
    const taxAmount = Number(subtotal || 0) * (taxRate / 100);
    printer.leftRight(`Tax (${taxRate}%):`, `${taxAmount.toFixed(2)} ${currency}`);
  }

  if (discount > 0) {
    printer.leftRight('Discount:', `-${Number(discount).toFixed(2)} ${currency}`);
  }

  printer.newLine();
  printer.setTypeFontB();
  printer.setTextSize(1, 1);
  printer.leftRight('GRAND TOTAL:', `${Number(total || 0).toFixed(2)} ${currency}`);
  printer.setTextNormal();
  printer.setTypeFontA();
  printer.newLine();

  printer.leftRight('Paid:', `${Number(amount_paid || 0).toFixed(2)} ${currency}`);

  if (change_due > 0) {
    printer.leftRight('Change:', `${Number(change_due).toFixed(2)} ${currency}`);
  }

  const balanceDue = Math.max(Number(total || 0) - Number(amount_paid || 0), 0);
  if (balanceDue > 0) {
    printer.alignCenter();
    printer.bold(true);
    printer.println(`BALANCE DUE: ${balanceDue.toFixed(2)} ${currency}`);
    printer.bold(false);
    printer.alignLeft();
  }

  printer.newLine();
  printer.drawLine('=');
  printer.newLine();

  // Footer
  printer.alignCenter();
  printer.println(receiptFooter.toUpperCase());
  if (storePhone) {
    printer.println(`Visit again! Tel: ${storePhone}`);
  }
  printer.bold(true);
  printer.println('Powered by Basit | 0340 1358760');
  printer.bold(false);
  printer.newLine();

  // Auto cut
  printer.cut();

  // --- execute ---
  try {
    const connected = await printer.isPrinterConnected();
    if (!connected) {
      return { success: false, error: 'Printer is not connected.', errorCode: PRINT_ERROR.NOT_CONNECTED };
    }
    await printer.execute();
    return { success: true };
  } catch (err) {
    const code = classifyError(err);
    return { success: false, error: err.message || String(err), errorCode: code };
  }
}

/**
 * Map a node-thermal-printer / OS error to a semantic error code.
 */
function classifyError(err) {
  const msg = (err?.message || String(err)).toLowerCase();
  if (msg.includes('not connect') || msg.includes('ECONNREFUSED') || msg.includes('ENOENT')) {
    return PRINT_ERROR.NOT_CONNECTED;
  }
  if (msg.includes('timeout') || msg.includes('ETIMEDOUT')) {
    return PRINT_ERROR.TIMEOUT;
  }
  if (msg.includes('paper') || msg.includes('cover') || msg.includes('open')) {
    return PRINT_ERROR.PAPER_OUT;
  }
  if (msg.includes('offline') || msg.includes('not available')) {
    return PRINT_ERROR.OFFLINE;
  }
  return PRINT_ERROR.UNKNOWN;
}

// ---------- Export ----------
module.exports = {
  printReceipt,
  createPrinterInstance,
  PRINT_ERROR,
  PrinterTypes,
  CharacterSet,
  BreakLine,
};
