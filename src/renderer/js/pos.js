/* ============================================================
 *  Nova POS – POS Cashier Logic
 *  src/renderer/js/pos.js
 * ============================================================ */

import { toast, fmt, currency, openModal, closeModal, printLogoHTML } from './app.js';

const api = window.novaAPI;
const $ = (sel) => document.querySelector(sel);

let cart = [];
let customers = [];

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

function invoiceItemName(item) {
  return `${escapeHtml(item.item_name)}${item.urdu_name
    ? `<span class="urdu-item-name" lang="ur" dir="rtl">${escapeHtml(item.urdu_name)}</span>`
    : ''}`;
}

function invoiceFontStyles() {
  return `
    @font-face {
      font-family: 'Gulzar';
      src: url('../../assets/fonts/Gulzar-Regular.ttf') format('truetype');
      font-style: normal;
      font-weight: 400;
    }
    .urdu-item-name {
      display: block;
      direction: rtl;
      text-align: right;
      font-family: 'Gulzar', 'Jameel Noori Nastaleeq', 'Urdu Typesetting', serif;
      font-size: 16px;
      line-height: 1.8;
      font-weight: normal;
    }
  `;
}

function renderCart() {
  const body = $('#cartBody');
  body.innerHTML = '';
  $('#cartEmpty').classList.toggle('hidden', cart.length > 0);

  cart.forEach((ci, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${invoiceItemName(ci)}</td>
      <td><input type="number" class="input small qty-input" min="1" value="${ci.quantity}" data-idx="${idx}" /></td>
      <td class="num">${fmt(ci.unit_price)}</td>
      <td class="num">${fmt(ci.line_total)}</td>
      <td><button class="btn danger small-btn" data-remove="${idx}">✕</button></td>
    `;
    body.appendChild(tr);
  });
  updateTotals();
}

function updateTotals() {
  const subtotal = cart.reduce((s, ci) => s + ci.line_total, 0);
  const discount = parseFloat($('#discountInput').value) || 0;
  const total = Math.max(subtotal - discount, 0);
  $('#subtotal').textContent = fmt(subtotal);
  $('#grandTotal').textContent = fmt(total);
  recalcChange();
}

function recalcChange() {
  const subtotal = cart.reduce((s, ci) => s + ci.line_total, 0);
  const discount = parseFloat($('#discountInput').value) || 0;
  const total = Math.max(subtotal - discount, 0);
  const paid = parseFloat($('#amountPaidInput').value) || 0;
  $('#changeDue').textContent = fmt(Math.max(paid - total, 0));
}

function addToCart(item) {
  const existing = cart.find(ci => ci.item_id === item.id);
  if (existing) {
    existing.quantity += 1;
    existing.line_total = existing.quantity * existing.unit_price;
    existing.urdu_name = item.urdu_name || existing.urdu_name || '';
  } else {
    cart.push({
      item_id: item.id, item_name: item.name, urdu_name: item.urdu_name || '', barcode: item.barcode || '',
      quantity: 1, unit_price: item.sale_price, line_total: item.sale_price
    });
  }
  renderCart();
}

function removeFromCart(idx) {
  cart.splice(idx, 1);
  renderCart();
}

function setQuantity(idx, qty) {
  const q = Math.max(parseInt(qty, 10) || 1, 1);
  cart[idx].quantity = q;
  cart[idx].line_total = q * cart[idx].unit_price;
  renderCart();
}

let selectedCustomerId = null;

function selectCustomer(c) {
  selectedCustomerId = c.id;
  const inp = $('#customerSearchInput');
  if (inp) {
    inp.value = '';
    inp.classList.add('hidden');
  }
  $('#customerSearchResults')?.classList.add('hidden');
  const badge = $('#selectedCustomerBadge');
  const info = $('#selectedCustomerInfo');
  if (badge && info) {
    info.innerHTML = `<strong>${c.name}</strong> (${c.phone || 'No phone'}) — Bal: <span style="color:${c.balance > 0 ? 'var(--accent)' : 'inherit'}">${fmt(c.balance)}</span>`;
    badge.classList.remove('hidden');
  }
  const walkIn = $('#walkInNameInput');
  if (walkIn) {
    walkIn.value = '';
    walkIn.classList.add('hidden');
  }
}

function clearSelectedCustomer() {
  selectedCustomerId = null;
  const inp = $('#customerSearchInput');
  if (inp) {
    inp.value = '';
    inp.classList.remove('hidden');
  }
  $('#selectedCustomerBadge')?.classList.add('hidden');
  const walkIn = $('#walkInNameInput');
  if (walkIn) {
    walkIn.value = '';
    walkIn.classList.remove('hidden');
    walkIn.disabled = false;
  }
}

function clearCart() {
  cart = [];
  $('#discountInput').value = 0;
  $('#amountPaidInput').value = 0;
  clearSelectedCustomer();
  renderCart();
  focusBarcode();
}

let customerSearchTimer = null;
function handleCustomerSearch(term) {
  clearTimeout(customerSearchTimer);
  const box = $('#customerSearchResults');
  if (!box) return;
  if (!term) {
    box.classList.add('hidden');
    selectedCustomerId = null;
    return;
  }
  customerSearchTimer = setTimeout(() => {
    const matches = customers.filter(c => 
      c.name.toLowerCase().includes(term) || 
      (c.phone && String(c.phone).toLowerCase().includes(term))
    );
    box.innerHTML = '';
    if (!matches.length) {
      box.innerHTML = `<div class="search-result-item" style="color:var(--text-dim); cursor:default;">No customers found</div>`;
      box.classList.remove('hidden');
      return;
    }
    matches.slice(0, 10).forEach(c => {
      const div = document.createElement('div');
      div.className = 'search-result-item';
      div.innerHTML = `<span><strong>${c.name}</strong> (${c.phone || 'No phone'})</span><span style="color:${c.balance > 0 ? 'var(--accent)' : 'inherit'}">Bal: ${fmt(c.balance)}</span>`;
      div.addEventListener('click', () => {
        selectCustomer(c);
      });
      box.appendChild(div);
    });
    box.classList.remove('hidden');
  }, 150);
}

function focusBarcode() { $('#barcodeInput')?.focus(); }

let searchTimer = null;
function showResults(term) {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    const items = await api.items.search(term);
    const box = $('#searchResults');
    box.innerHTML = '';
    if (!items.length) { box.classList.add('hidden'); return; }
    items.slice(0, 12).forEach(item => {
      const div = document.createElement('div');
      div.className = 'search-result-item';
      div.innerHTML = `<span>${item.name}</span><span>${fmt(item.sale_price)} ${currency()}</span>`;
      div.addEventListener('click', () => { addToCart(item); hideResults(); $('#barcodeInput').value = ''; focusBarcode(); });
      box.appendChild(div);
    });
    box.classList.remove('hidden');
  }, 150);
}

function hideResults() { $('#searchResults').classList.add('hidden'); }

async function tryBarcodeSubmit(barcode) {
  if (!barcode) return;
  const items = await api.items.search(barcode);
  const exact = items.find(i => i.barcode === barcode) || items[0];
  if (exact) {
    addToCart(exact);
    $('#barcodeInput').value = '';
  } else {
    toast(`Item not found: ${barcode}`, true);
  }
  focusBarcode();
}

async function printThermalReceipt(saleId) {
  try {
    const sale = await api.sales.getById(saleId);
    const items = await api.sales.getItems(saleId);
    const allSettings = await api.settings.getAll();

    const storeName = allSettings.store_name || 'Nova POS Store';
    const storePhone = allSettings.store_phone || '';
    const storeAddress = allSettings.store_address || '';
    const receiptFooter = allSettings.receipt_footer || 'Thank you for shopping with us!';
    const curr = allSettings.currency || '';

    let custDisplay = sale.customer_name;
    if (!custDisplay) {
      if (sale.notes && sale.notes.startsWith('Walk-in:')) {
        custDisplay = sale.notes;
      } else {
        custDisplay = 'Walk-in Customer';
      }
    }

    const itemsRows = items.map(i => `
      <tr>
        <td style="text-align: left; padding: 3px 0;" colspan="2"><strong>${invoiceItemName(i)}</strong></td>
      </tr>
      <tr>
        <td style="text-align: left; padding-bottom: 4px; color: #555;">${i.quantity} x ${fmt(i.unit_price)}</td>
        <td style="text-align: right; padding-bottom: 4px; font-weight: 600;">${fmt(i.line_total)}</td>
      </tr>
    `).join('');

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Receipt ${sale.invoice_no}</title>
        <style>
          @page { size: 80mm auto; margin: 0; }
          ${invoiceFontStyles()}
          body {
            font-family: 'Courier New', Courier, monospace;
            font-size: 12px;
            width: 72mm;
            margin: 0 auto;
            padding: 5mm;
            color: #000;
            background: #fff;
            line-height: 1.2;
          }
          .center { text-align: center; }
          .right { text-align: right; }
          .bold { font-weight: bold; }
          .divider { border-top: 1px dashed #000; margin: 6px 0; }
          table { width: 100%; border-collapse: collapse; }
          td { font-size: 12px; }
          .totals-table td { padding: 2px 0; }
          .footer { margin-top: 10px; text-align: center; font-size: 11px; }
        </style>
      </head>
      <body>
        <div class="center bold" style="font-size: 16px; margin-bottom: 2px;">${storeName}</div>
        ${printLogoHTML(null, 300)}
        ${storeAddress ? `<div class="center" style="font-size: 11px;">${storeAddress}</div>` : ''}
        ${storePhone ? `<div class="center" style="font-size: 11px;">Tel: ${storePhone}</div>` : ''}
        
        <div class="divider"></div>
        
        <div><span class="bold">Invoice:</span> ${sale.invoice_no}</div>
        <div><span class="bold">Date:</span> ${sale.created_at}</div>
        <div><span class="bold">Customer:</span> ${custDisplay}</div>
        <div><span class="bold">Payment:</span> ${sale.payment_method.toUpperCase()}</div>

        <div class="divider"></div>

        <table>
          <tbody>
            ${itemsRows}
          </tbody>
        </table>

        <div class="divider"></div>

        <table class="totals-table">
          <tr>
            <td>Subtotal:</td>
            <td class="right">${fmt(sale.subtotal)} ${curr}</td>
          </tr>
          ${sale.discount > 0 ? `
          <tr>
            <td>Discount:</td>
            <td class="right">-${fmt(sale.discount)} ${curr}</td>
          </tr>` : ''}
          <tr class="bold" style="font-size: 14px;">
            <td>TOTAL:</td>
            <td class="right">${fmt(sale.total)} ${curr}</td>
          </tr>
          <tr>
            <td>Amount Paid:</td>
            <td class="right">${fmt(sale.amount_paid)} ${curr}</td>
          </tr>
          ${Math.max(sale.total - sale.amount_paid, 0) > 0 ? `
          <tr>
            <td>Balance Due:</td>
            <td class="right">${fmt(Math.max(sale.total - sale.amount_paid, 0))} ${curr}</td>
          </tr>` : ''}
          ${sale.change_due > 0 ? `
          <tr>
            <td>Change Due:</td>
            <td class="right">${fmt(sale.change_due)} ${curr}</td>
          </tr>` : ''}
          ${sale.customer_id ? `
          <tr>
            <td>Prev Balance:</td>
            <td class="right">${fmt(Math.max((sale.customer_balance || 0) - Math.max(sale.total - sale.amount_paid, 0), 0))} ${curr}</td>
          </tr>
          <tr class="bold">
            <td>Updated Balance:</td>
            <td class="right">${fmt(sale.customer_balance || 0)} ${curr}</td>
          </tr>` : ''}
        </table>

        <div class="divider"></div>
        
        <div class="footer">
          ${receiptFooter}<br>
          <span style="font-size: 10px; color: #111111;">Powered by Nova POS</span>
        </div>
      </body>
      </html>
    `;

    let printFrame = document.getElementById('thermalPrintFrame');
    if (!printFrame) {
      printFrame = document.createElement('iframe');
      printFrame.id = 'thermalPrintFrame';
      printFrame.style.cssText = 'position: fixed; width: 80mm; height: 100vh; border: none; left: -9999px; top: 0; opacity: 0; pointer-events: none;';
      document.body.appendChild(printFrame);
    }

    const frameDoc = printFrame.contentWindow.document;
    frameDoc.open();
    frameDoc.write(html);
    frameDoc.close();

    setTimeout(async () => {
      try {
        await printFrame.contentDocument.fonts.ready;
        printFrame.contentWindow.focus();
        printFrame.contentWindow.print();
      } catch (e) {
        console.error('Print invocation error:', e);
      }
    }, 250);
  } catch (err) {
    console.error('Thermal print failed:', err);
    toast('Failed to print thermal receipt', true);
  }
}

function getCartContext() {
  const subtotal = cart.reduce((s, ci) => s + ci.line_total, 0);
  const discount = parseFloat($('#discountInput').value) || 0;
  const total = Math.max(subtotal - discount, 0);
  const paid = parseFloat($('#amountPaidInput').value) || 0;
  const payment_method = $('#paymentMethod')?.value || 'cash';
  const balanceDue = Math.max(total - paid, 0);

  const customerInputVal = $('#customerSearchInput')?.value.trim() || '';
  let walkInName = $('#walkInNameInput')?.value.trim() || '';

  let custDisplay = 'Walk-in Customer';
  let custObj = null;
  if (selectedCustomerId) {
    custObj = customers.find(c => c.id === selectedCustomerId);
    if (custObj) custDisplay = `${custObj.name}${custObj.phone ? ' (' + custObj.phone + ')' : ''}`;
  } else if (walkInName) {
    custDisplay = `Walk-in: ${walkInName}`;
  } else if (customerInputVal) {
    custObj = customers.find(c => c.name.toLowerCase() === customerInputVal.toLowerCase());
    custDisplay = customerInputVal;
  }

  const prevBalance = custObj ? custObj.balance : 0;
  const updatedBalance = prevBalance + balanceDue;

  return {
    invoice_no: 'DRAFT / PREVIEW',
    created_at: new Date().toLocaleString(),
    customer_name: custDisplay,
    customer_id: custObj ? custObj.id : null,
    customer_balance: updatedBalance,
    prev_balance: prevBalance,
    payment_method,
    subtotal,
    discount,
    total,
    amount_paid: paid,
    balance_due: balanceDue,
    change_due: Math.max(paid - total, 0)
  };
}

async function printCartThermalReceipt() {
  if (!cart.length) { toast('Cart is empty', true); return; }
  try {
    const sale = getCartContext();
    const allSettings = await api.settings.getAll();

    const storeName = allSettings.store_name || 'Nova POS Store';
    const storePhone = allSettings.store_phone || '';
    const storeAddress = allSettings.store_address || '';
    const receiptFooter = allSettings.receipt_footer || 'Thank you for shopping with us!';
    const curr = allSettings.currency || '';

    const itemsRows = cart.map(i => `
      <tr>
        <td style="text-align: left; padding: 3px 0;" colspan="2"><strong>${invoiceItemName(i)}</strong></td>
      </tr>
      <tr>
        <td style="text-align: left; padding-bottom: 4px; color: #555;">${i.quantity} x ${fmt(i.unit_price)}</td>
        <td style="text-align: right; padding-bottom: 4px; font-weight: 600;">${fmt(i.line_total)}</td>
      </tr>
    `).join('');

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Receipt Draft</title>
        <style>
          @page { size: 80mm auto; margin: 0; }
          ${invoiceFontStyles()}
          body {
            font-family: 'Courier New', Courier, monospace;
            font-size: 12px;
            width: 72mm;
            margin: 0 auto;
            padding: 5mm;
            color: #000;
            background: #fff;
            line-height: 1.2;
          }
          .center { text-align: center; }
          .right { text-align: right; }
          .bold { font-weight: bold; }
          .divider { border-top: 1px dashed #000; margin: 6px 0; }
          table { width: 100%; border-collapse: collapse; }
          td { font-size: 12px; }
          .totals-table td { padding: 2px 0; }
          .footer { margin-top: 10px; text-align: center; font-size: 11px; }
        </style>
      </head>
      <body>
        <div class="center bold" style="font-size: 16px; margin-bottom: 2px;">${storeName}</div>
        ${printLogoHTML(null, 300)}
        ${storeAddress ? `<div class="center" style="font-size: 11px;">${storeAddress}</div>` : ''}
        ${storePhone ? `<div class="center" style="font-size: 11px;">Tel: ${storePhone}</div>` : ''}
        
        <div class="divider"></div>
        
        <div><span class="bold">Status:</span> DRAFT RECEIPT</div>
        <div><span class="bold">Date:</span> ${sale.created_at}</div>
        <div><span class="bold">Customer:</span> ${sale.customer_name}</div>
        <div><span class="bold">Payment:</span> ${sale.payment_method.toUpperCase()}</div>

        <div class="divider"></div>

        <table>
          <tbody>
            ${itemsRows}
          </tbody>
        </table>

        <div class="divider"></div>

        <table class="totals-table">
          <tr>
            <td>Subtotal:</td>
            <td class="right">${fmt(sale.subtotal)} ${curr}</td>
          </tr>
          ${sale.discount > 0 ? `
          <tr>
            <td>Discount:</td>
            <td class="right">-${fmt(sale.discount)} ${curr}</td>
          </tr>` : ''}
          <tr class="bold" style="font-size: 14px;">
            <td>TOTAL:</td>
            <td class="right">${fmt(sale.total)} ${curr}</td>
          </tr>
          <tr>
            <td>Amount Paid:</td>
            <td class="right">${fmt(sale.amount_paid)} ${curr}</td>
          </tr>
          ${sale.balance_due > 0 ? `
          <tr>
            <td>Balance Due:</td>
            <td class="right">${fmt(sale.balance_due)} ${curr}</td>
          </tr>` : ''}
          ${sale.change_due > 0 ? `
          <tr>
            <td>Change Due:</td>
            <td class="right">${fmt(sale.change_due)} ${curr}</td>
          </tr>` : ''}
          ${sale.customer_id ? `
          <tr>
            <td>Prev Balance:</td>
            <td class="right">${fmt(sale.prev_balance)} ${curr}</td>
          </tr>
          <tr class="bold">
            <td>Updated Balance:</td>
            <td class="right">${fmt(sale.customer_balance)} ${curr}</td>
          </tr>` : ''}
        </table>

        <div class="divider"></div>
        
        <div class="footer">
          ${receiptFooter}<br>
          <span style="font-size: 10px; color: #555;">Powered by Nova POS</span>
        </div>
      </body>
      </html>
    `;

    let printFrame = document.getElementById('thermalPrintFrame');
    if (!printFrame) {
      printFrame = document.createElement('iframe');
      printFrame.id = 'thermalPrintFrame';
      printFrame.style.cssText = 'position: fixed; width: 80mm; height: 100vh; border: none; left: -9999px; top: 0; opacity: 0; pointer-events: none;';
      document.body.appendChild(printFrame);
    }

    const frameDoc = printFrame.contentWindow.document;
    frameDoc.open();
    frameDoc.write(html);
    frameDoc.close();

    setTimeout(async () => {
      try {
        await printFrame.contentDocument.fonts.ready;
        printFrame.contentWindow.focus();
        printFrame.contentWindow.print();
      } catch (e) {
        console.error('Print invocation error:', e);
      }
    }, 250);
  } catch (err) {
    console.error('Thermal print failed:', err);
    toast('Failed to print thermal receipt', true);
  }
}

async function previewCartInvoice() {
  if (!cart.length) { toast('Cart is empty', true); return; }
  const sale = getCartContext();
  const allSettings = await api.settings.getAll();

  const storeName = allSettings.store_name || 'Nova POS Store';
  const storePhone = allSettings.store_phone || '';
  const storeAddress = allSettings.store_address || '';
  const receiptFooter = allSettings.receipt_footer || 'Thank you for shopping with us!';
  const curr = allSettings.currency || '';

  const itemsRows = cart.map(i => `
    <tr>
      <td style="text-align: left; padding: 3px 0;" colspan="2"><strong>${invoiceItemName(i)}</strong></td>
    </tr>
    <tr>
      <td style="text-align: left; padding-bottom: 4px; color: #555;">${i.quantity} x ${fmt(i.unit_price)}</td>
      <td style="text-align: right; padding-bottom: 4px; font-weight: 600;">${fmt(i.line_total)}</td>
    </tr>
  `).join('');

  const receiptHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        ${invoiceFontStyles()}
        body {
          font-family: 'Courier New', Courier, monospace;
          font-size: 12px;
          width: 72mm;
          margin: 0 auto;
          padding: 5mm;
          color: #000;
          background: #fff;
          line-height: 1.2;
        }
        .center { text-align: center; }
        .right { text-align: right; }
        .bold { font-weight: bold; }
        .divider { border-top: 1px dashed #000; margin: 6px 0; }
        table { width: 100%; border-collapse: collapse; }
        td { font-size: 12px; }
        .totals-table td { padding: 2px 0; }
        .footer { margin-top: 10px; text-align: center; font-size: 11px; }
      </style>
    </head>
    <body>
      <div class="center bold" style="font-size: 16px; margin-bottom: 2px;">${storeName}</div>
      ${printLogoHTML(null, 300)}
      ${storeAddress ? `<div class="center" style="font-size: 11px;">${storeAddress}</div>` : ''}
      ${storePhone ? `<div class="center" style="font-size: 11px;">Tel: ${storePhone}</div>` : ''}
      
      <div class="divider"></div>
      
      <div><span class="bold">Status:</span> DRAFT RECEIPT</div>
      <div><span class="bold">Date:</span> ${sale.created_at}</div>
      <div><span class="bold">Customer:</span> ${sale.customer_name}</div>
      <div><span class="bold">Payment:</span> ${sale.payment_method.toUpperCase()}</div>

      <div class="divider"></div>

      <table>
        <tbody>
          ${itemsRows}
        </tbody>
      </table>

      <div class="divider"></div>

      <table class="totals-table">
        <tr>
          <td>Subtotal:</td>
          <td class="right">${fmt(sale.subtotal)} ${curr}</td>
        </tr>
        ${sale.discount > 0 ? `
        <tr>
          <td>Discount:</td>
          <td class="right">-${fmt(sale.discount)} ${curr}</td>
        </tr>` : ''}
        <tr class="bold" style="font-size: 14px;">
          <td>TOTAL:</td>
          <td class="right">${fmt(sale.total)} ${curr}</td>
        </tr>
        <tr>
          <td>Amount Paid:</td>
          <td class="right">${fmt(sale.amount_paid)} ${curr}</td>
        </tr>
        ${sale.balance_due > 0 ? `
        <tr>
          <td>Balance Due:</td>
          <td class="right">${fmt(sale.balance_due)} ${curr}</td>
        </tr>` : ''}
        ${sale.change_due > 0 ? `
        <tr>
          <td>Change Due:</td>
          <td class="right">${fmt(sale.change_due)} ${curr}</td>
        </tr>` : ''}
        ${sale.customer_id ? `
        <tr>
          <td>Prev Balance:</td>
          <td class="right">${fmt(sale.prev_balance)} ${curr}</td>
        </tr>
        <tr class="bold">
          <td>Updated Balance:</td>
          <td class="right">${fmt(sale.customer_balance)} ${curr}</td>
        </tr>` : ''}
      </table>

      <div class="divider"></div>
      
      <div class="footer">
        ${receiptFooter}<br>
        <span style="font-size: 10px; color: #555;">Powered by Nova POS</span>
      </div>
    </body>
    </html>
  `;

  openModal(`
    <h3 style="margin-bottom: 10px;">📋 Invoice Preview (Draft)</h3>
    <div style="background: #fff; border-radius: 8px; padding: 0; display: flex; justify-content: center; max-height: 60vh; overflow-y: auto;">
      <iframe id="invoicePreviewFrame" style="width: 82mm; min-height: 420px; border: none; background: #fff; border-radius: 8px;" scrolling="no"></iframe>
    </div>
    <div class="modal-actions" style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 14px;">
      <button class="btn primary" id="previewPrintThermalBtn">🖨️ Print</button>
      <button class="btn" id="closePreviewModal">Close</button>
    </div>
  `);

  // Write receipt HTML into the preview iframe
  const previewFrame = document.getElementById('invoicePreviewFrame');
  const frameDoc = previewFrame.contentWindow.document;
  frameDoc.open();
  frameDoc.write(receiptHtml);
  frameDoc.close();

  // Auto-resize iframe to fit content
  previewFrame.addEventListener('load', () => {
    try {
      const contentHeight = previewFrame.contentWindow.document.body.scrollHeight;
      previewFrame.style.height = contentHeight + 'px';
    } catch (e) { /* ignore */ }
  });
  // Also try resizing after a short delay (fallback)
  setTimeout(() => {
    try {
      const contentHeight = previewFrame.contentWindow.document.body.scrollHeight;
      previewFrame.style.height = contentHeight + 'px';
    } catch (e) { /* ignore */ }
  }, 100);

  document.getElementById('closePreviewModal').addEventListener('click', closeModal);
  document.getElementById('previewPrintThermalBtn').addEventListener('click', () => {
    printCartThermalReceipt();
  });
}

async function completeSale() {
  if (!cart.length) { toast('Cart is empty', true); return; }
  const subtotal = cart.reduce((s, ci) => s + ci.line_total, 0);
  const discount = parseFloat($('#discountInput').value) || 0;
  const total = Math.max(subtotal - discount, 0);
  const paid = parseFloat($('#amountPaidInput').value) || 0;
  const payment_method = $('#paymentMethod').value;
  const remainingBalance = Math.max(total - paid, 0);
  
  const customerInputVal = $('#customerSearchInput')?.value.trim() || '';
  let customer_id = selectedCustomerId;
  let walkInName = $('#walkInNameInput')?.value.trim() || '';

  if (!customer_id && customerInputVal) {
    const found = customers.find(c => 
      c.name.toLowerCase() === customerInputVal.toLowerCase() || 
      (c.phone && c.phone === customerInputVal) ||
      `${c.name}${c.phone ? ' (' + c.phone + ')' : ''}`.toLowerCase() === customerInputVal.toLowerCase() ||
      c.name.toLowerCase().includes(customerInputVal.toLowerCase()) ||
      (c.phone && c.phone.includes(customerInputVal))
    );
    if (found) {
      customer_id = found.id;
    } else if (!walkInName) {
      walkInName = customerInputVal;
    }
  }

  if (remainingBalance > 0 && !customer_id) {
    toast('Please select a customer for partial payments / remaining balance', true);
    return;
  }

  if (payment_method === 'cash' && paid < total && !customer_id) {
    toast('Insufficient amount paid', true);
    return;
  }

  let notes = '';
  if (!customer_id && walkInName) {
    notes = `Walk-in: ${walkInName}`;
  }

  const sale = await api.sales.create({
    items: cart, customer_id: customer_id || null, discount,
    amount_paid: payment_method === 'credit' ? 0 : paid,
    payment_method, notes
  });

  if (sale) {
    toast(`Sale completed — Invoice ${sale.invoice_no}`);
    clearCart();
    loadCatalog();

    openModal(`
      <div style="text-align: center; padding: 10px 0;">
        <div style="font-size: 36px; margin-bottom: 8px;">✅</div>
        <h3>Sale Completed!</h3>
        <p style="color: var(--text-dim); margin-bottom: 14px;">Invoice: <strong>${sale.invoice_no}</strong></p>
        <div style="display: flex; gap: 10px; justify-content: center;">
          <button class="btn primary" id="postPrintThermalBtn">🖨️ Print Thermal Receipt</button>
          <button class="btn" id="postCloseModal">Done / New Sale</button>
        </div>
      </div>
    `);
    document.getElementById('postCloseModal').addEventListener('click', closeModal);
    document.getElementById('postPrintThermalBtn').addEventListener('click', () => {
      printThermalReceipt(sale.id);
      closeModal();
    });
  } else {
    toast('Failed to record sale', true);
  }
}

async function loadSalesHistory() {
  const from = $('#salesFrom').value;
  const to = $('#salesTo').value;
  const sales = await api.sales.getAll({ from: from || undefined, to: to ? to + ' 23:59:59' : undefined });
  const body = $('#salesBody');
  body.innerHTML = '';
  $('#salesEmpty').classList.toggle('hidden', sales.length > 0);
  sales.forEach(s => {
    const tr = document.createElement('tr');
    let custDisplay = s.customer_name;
    if (!custDisplay) {
      if (s.notes && s.notes.startsWith('Walk-in:')) {
        custDisplay = s.notes;
      } else {
        custDisplay = 'Walk-in';
      }
    }
    tr.innerHTML = `
      <td>${s.invoice_no}</td><td>${s.created_at}</td>
      <td>${custDisplay}</td>
      <td class="num">${fmt(s.total)}</td><td class="num">${fmt(s.amount_paid)}</td>
      <td>${s.payment_method}</td>
      <td><button class="btn small-btn" data-view-sale="${s.id}">View</button></td>
    `;
    body.appendChild(tr);
  });
}

async function viewSale(id) {
  const sale = await api.sales.getById(id);
  const items = await api.sales.getItems(id);
  const rows = items.map(i =>
    `<tr><td>${invoiceItemName(i)}</td><td class="num">${fmt(i.quantity)}</td><td class="num">${fmt(i.unit_price)}</td><td class="num">${fmt(i.line_total)}</td></tr>`
  ).join('');

  const balanceDue = Math.max(sale.total - sale.amount_paid, 0);
  const currBal = sale.customer_balance || 0;
  const prevBal = sale.customer_id ? Math.max(currBal - balanceDue, 0) : 0;

  openModal(`
    <h3>Invoice ${sale.invoice_no} (${sale.status || 'PAID'})</h3>
    <p style="color: var(--text-dim); font-size: 13px; margin-bottom: 8px;">Customer: <strong>${sale.customer_name || 'Walk-in'}</strong></p>
    <table class="table"><thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="totals" style="margin-top:10px">
      <div class="row"><span>Subtotal</span><span>${fmt(sale.subtotal)}</span></div>
      ${sale.discount > 0 ? `<div class="row"><span>Discount</span><span>-${fmt(sale.discount)}</span></div>` : ''}
      <div class="row grand"><span>Total</span><span>${fmt(sale.total)}</span></div>
      <div class="row"><span>Amount Paid</span><span>${fmt(sale.amount_paid)}</span></div>
      ${balanceDue > 0 ? `<div class="row" style="color: var(--accent);"><span>Balance Due</span><span>${fmt(balanceDue)}</span></div>` : ''}
      ${sale.change_due > 0 ? `<div class="row"><span>Change Due</span><span>${fmt(sale.change_due)}</span></div>` : ''}
      ${sale.customer_id ? `
        <div class="row"><span>Prev Balance</span><span>${fmt(prevBal)}</span></div>
        <div class="row grand"><span>Updated Balance</span><span>${fmt(currBal)}</span></div>
      ` : ''}
      <div class="row"><span>Payment Method</span><span>${sale.payment_method.toUpperCase()}</span></div>
    </div>
    <div class="modal-actions" style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 14px;">
      <button class="btn primary" id="printThermalBtn">🖨️ Thermal Print</button>
      <button class="btn" id="closeSaleModal">Close</button>
    </div>
  `);
  document.getElementById('closeSaleModal').addEventListener('click', closeModal);
  document.getElementById('printThermalBtn').addEventListener('click', () => printThermalReceipt(sale.id));
}

async function loadCustomers() {
  customers = await api.customers.getAll();
  loadCatalog();
}

async function loadCatalog() {
  const term = $('#posCatalogSearch')?.value.trim() || '';
  const category = $('#posCategoryFilter')?.value || '';

  let items;
  if (term) {
    items = await api.items.search(term);
  } else {
    items = await api.items.getAll({ category: category || undefined });
  }

  if (term && category) {
    items = items.filter(i => i.category === category);
  }

  const grid = $('#posProductsGrid');
  if (!grid) return;
  grid.innerHTML = '';
  const empty = $('#posProductsEmpty');
  if (empty) empty.classList.toggle('hidden', items.length > 0);

  items.forEach(item => {
    const card = document.createElement('div');
    card.className = 'pos-product-card';
    card.innerHTML = `
      <div class="pos-product-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</div>
      ${item.urdu_name ? `<div class="pos-product-urdu urdu-item-name" lang="ur" dir="rtl">${escapeHtml(item.urdu_name)}</div>` : ''}
      <div class="pos-product-price">${fmt(item.sale_price)} ${currency()}</div>
      <div class="pos-product-stock">Stock: ${escapeHtml(item.stock)} ${escapeHtml(item.unit)}</div>
    `;
    card.addEventListener('click', () => {
      addToCart(item);
      focusBarcode();
    });
    grid.appendChild(card);
  });

  const cats = await api.items.getCategories();
  const catSel = $('#posCategoryFilter');
  if (catSel) {
    const keepCat = catSel.value;
    catSel.innerHTML = '<option value="">All Categories</option>' + cats.map(c => `<option>${c}</option>`).join('');
    catSel.value = keepCat;
  }
}

function init() {
  $('#barcodeInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { hideResults(); tryBarcodeSubmit(e.target.value.trim()); }
  });
  $('#barcodeInput').addEventListener('input', (e) => {
    if (e.target.value.trim()) showResults(e.target.value.trim());
    else hideResults();
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.pos-toolbar')) hideResults(); });

  $('#cartBody').addEventListener('click', (e) => {
    const rm = e.target.dataset.remove;
    if (rm !== undefined) removeFromCart(Number(rm));
  });
  $('#cartBody').addEventListener('change', (e) => {
    if (e.target.classList.contains('qty-input')) setQuantity(Number(e.target.dataset.idx), e.target.value);
  });

  $('#customerSearchInput')?.addEventListener('input', (e) => {
    handleCustomerSearch(e.target.value.trim().toLowerCase());
  });
  $('#clearCustomerBtn')?.addEventListener('click', (e) => {
    e.preventDefault();
    clearSelectedCustomer();
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.customer-select-wrap')) {
      $('#customerSearchResults')?.classList.add('hidden');
    }
  });
  $('#amountPaidInput').addEventListener('input', recalcChange);
  $('#completeSaleBtn').addEventListener('click', completeSale);
  $('#previewInvoiceBtn').addEventListener('click', previewCartInvoice);
  $('#printCartBtn').addEventListener('click', printCartThermalReceipt);
  $('#clearCartBtn').addEventListener('click', clearCart);

  $('#posCatalogSearch')?.addEventListener('input', loadCatalog);
  $('#posCategoryFilter')?.addEventListener('change', loadCatalog);

  $('#salesFilterBtn').addEventListener('click', loadSalesHistory);
  $('#salesRefreshBtn').addEventListener('click', loadSalesHistory);
  $('#salesBody').addEventListener('click', (e) => {
    const id = e.target.dataset.viewSale;
    if (id) viewSale(Number(id));
  });

  loadCustomers();
  focusBarcode();
}

export const initPOS = {
  init, refresh: () => { loadCustomers(); loadCatalog(); }, clearCart, completeSale, focusBarcode, loadSalesHistory
};
