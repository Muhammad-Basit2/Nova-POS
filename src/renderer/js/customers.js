/* ============================================================
 *  Nova POS – Customer Ledger Logic
 *  src/renderer/js/customers.js
 * ============================================================ */

import { toast, openModal, closeModal, fmt, printLogoHTML } from './app.js';

const api = window.novaAPI;
const $ = (sel) => document.querySelector(sel);

let cachedCustomers = [];

async function refresh() {
  cachedCustomers = await api.customers.getAll();
  renderList(cachedCustomers);
}

function renderList(customers) {
  const body = $('#customerEntityBody');
  const empty = $('#customerEmpty');
  if (!body) return;
  body.innerHTML = '';
  
  const searchTerm = $('#customerSearch')?.value.trim().toLowerCase() || '';
  const filtered = customers.filter(c => 
    c.name.toLowerCase().includes(searchTerm) || 
    (c.phone && String(c.phone).toLowerCase().includes(searchTerm)) ||
    (c.cnic && String(c.cnic).toLowerCase().includes(searchTerm))
  );

  if (filtered.length === 0) {
    if (empty) empty.classList.remove('hidden');
    return;
  }
  if (empty) empty.classList.add('hidden');

  filtered.forEach(c => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${c.name}</strong></td>
      <td>${c.phone || 'N/A'}</td>
      <td>${c.cnic || 'N/A'}</td>
      <td class="num" style="color:${c.balance > 0 ? 'var(--danger)' : 'inherit'}; font-weight:600;">Rs. ${fmt(c.balance)}</td>
      <td>
        <div style="display: flex; gap: 6px; align-items: center;">
          <button class="btn small-btn" data-ledger="${c.id}">📁 Ledger</button>
          <button class="btn small-btn" data-edit="${c.id}">✏️ Edit</button>
          <button class="btn success small-btn" data-clear="${c.id}">💵 Clear Udhaar</button>
          <button class="btn danger small-btn" data-del="${c.id}">🗑️ Remove</button>
        </div>
      </td>
    `;
    body.appendChild(tr);
  });
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

async function printDocument(title, content, paperSize, frameId) {
  try {
    const settings = await api.settings.getAll();
    const storeName = escapeHtml(settings.store_name || 'Nova POS Store');
    const storePhone = escapeHtml(settings.store_phone || '');
    const storeAddress = escapeHtml(settings.store_address || '');
    const footer = escapeHtml(settings.receipt_footer || 'Thank you!');
    const bodyContent = content.replace(/\{\{currency\}\}/g, escapeHtml(settings.currency || 'Rs.'));
    const thermal = paperSize === 'thermal';
    const printFrame = document.getElementById(frameId) || document.createElement('iframe');
    printFrame.id = frameId;
    printFrame.style.cssText = 'position: fixed; width: 80mm; height: 100vh; border: none; left: -9999px; top: 0; opacity: 0; pointer-events: none;';
    if (!printFrame.isConnected) document.body.appendChild(printFrame);

    const frameDoc = printFrame.contentWindow.document;
    frameDoc.open();
    frameDoc.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>${escapeHtml(title)}</title>
        <style>
          @page { size: ${thermal ? '80mm auto' : 'A4 portrait'}; margin: ${thermal ? '0' : '14mm'}; }
          body { font-family: Arial, sans-serif; color: #000; background: #fff; font-size: ${thermal ? '11px' : '12px'}; ${thermal ? 'width: 72mm; margin: 0 auto; padding: 5mm;' : 'width: 100%; margin: 0;'} }
          h1 { font-size: ${thermal ? '16px' : '20px'}; text-align: center; margin: 0 0 4px; }
          h2 { font-size: ${thermal ? '14px' : '17px'}; text-align: center; margin: 10px 0; }
          .center { text-align: center; }
          .right { text-align: right; }
          .divider { border-top: 1px dashed #000; margin: 8px 0; }
          table { width: 100%; border-collapse: collapse; }
          th, td { text-align: left; vertical-align: top; padding: ${thermal ? '4px 2px' : '7px 5px'}; border-bottom: 1px solid #bbb; }
          th { border-bottom: 2px solid #000; }
          .summary { margin-top: 10px; }
          .summary td { border: 0; padding: 3px 2px; }
          .footer { text-align: center; margin-top: 16px; padding-top: 10px; border-top: 1px dashed #ccc; line-height: 1.6; }
          .powered-by { display: inline-block; margin-top: 6px; padding: 4px 12px; border: 1px solid #ccc; border-radius: 12px; color: #333; font-size: 11px; font-weight: 700; letter-spacing: .3px; background: #f5f5f5; }
          ${thermal ? 'th, td { font-size: 10px; }' : ''}
        </style>
      </head>
      <body>
        <h1>${storeName}</h1>
        ${printLogoHTML(null, 300)}
        ${storeAddress ? `<div class="center">${storeAddress}</div>` : ''}
        ${storePhone ? `<div class="center">Tel: ${storePhone}</div>` : ''}
        ${bodyContent}
        <div class="footer">${footer}<br><span class="powered-by">Powered by Basit | 0340 1358760</span></div>
      </body>
      </html>
    `);
    frameDoc.close();

    setTimeout(() => {
      try {
        printFrame.contentWindow.focus();
        printFrame.contentWindow.print();
      } catch (error) {
        console.error('Print invocation failed:', error);
        toast('Failed to open print dialog', true);
      }
    }, 250);
  } catch (error) {
    console.error('Print preparation failed:', error);
    toast('Failed to prepare document for printing', true);
  }
}

function printLedgerReceipt(customer, transactions, paperSize) {
  const currency = '{{currency}}';
  const totalDebit = transactions
    .filter(transaction => transaction.type === 'debit')
    .reduce((total, transaction) => total + Number(transaction.amount || 0), 0);
  const totalCredit = transactions
    .filter(transaction => transaction.type === 'credit')
    .reduce((total, transaction) => total + Number(transaction.amount || 0), 0);
  const rows = transactions.length
    ? transactions.map(transaction => `
        <tr>
          <td>${escapeHtml(transaction.created_at)}</td>
          <td>${escapeHtml(transaction.type.toUpperCase())}</td>
          <td class="right">${fmt(transaction.amount)}</td>
          <td>${escapeHtml(transaction.description || '—')}${transaction.reference ? `<br><small>${escapeHtml(transaction.reference)}</small>` : ''}</td>
        </tr>
      `).join('')
    : '<tr><td colspan="4" class="center">No transaction history</td></tr>';
  const content = `
    <div class="divider"></div>
    <div><strong>Customer:</strong> ${escapeHtml(customer.name)}</div>
    ${customer.phone ? `<div><strong>Phone:</strong> ${escapeHtml(customer.phone)}</div>` : ''}
    <div><strong>Printed:</strong> ${escapeHtml(new Date().toLocaleString())}</div>
    <h2>Customer Ledger</h2>
    <table>
      <thead><tr><th>Date</th><th>Type</th><th class="right">Amount</th><th>Description</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <table class="summary">
      <tr><td>Total Debit:</td><td class="right">${fmt(totalDebit)}</td></tr>
      <tr><td>Total Credit:</td><td class="right">${fmt(totalCredit)}</td></tr>
      <tr><td><strong>Current Balance:</strong></td><td class="right"><strong>${fmt(customer.balance)} ${currency}</strong></td></tr>
    </table>
  `;

  printDocument(`${customer.name} — Customer Ledger`, content, paperSize, 'customerLedgerPrintFrame');
}

async function showLedgerModal(customer) {
  const txs = await api.customers.getLedger(customer.id);
  let rows = '';
  if (!txs.length) {
    rows = `<tr><td colspan="4" class="empty-state">No transaction history</td></tr>`;
  } else {
    txs.forEach(t => {
      rows += `
        <tr>
          <td>${t.created_at}</td>
          <td><span style="color:${t.type === 'debit' ? 'var(--danger)' : 'var(--success)'}; font-weight:600;">${t.type.toUpperCase()}</span></td>
          <td class="num">Rs. ${fmt(t.amount)}</td>
          <td>${t.description || '—'}</td>
        </tr>
      `;
    });
  }

  openModal(`
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
      <h3 style="margin: 0;">Ledger History — ${customer.name}</h3>
      <button class="btn small-btn" id="closeLedgerModalBtn">✕</button>
    </div>
    <p style="font-size: 13px; color: var(--text-dim); margin-bottom: 10px;">Current Balance: <strong style="color:${customer.balance > 0 ? 'var(--danger)' : 'inherit'}">Rs. ${fmt(customer.balance)}</strong></p>
    <div class="table-wrap" style="max-height: 300px;">
      <table class="table">
        <thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>Description</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="modal-actions" style="margin-top: 14px; display: flex; justify-content: space-between; align-items: center;">
      <div style="display: flex; gap: 6px;">
        <button class="btn" id="printLedgerThermal">🖨️ Thermal Print</button>
        <button class="btn" id="printLedgerA4">📄 A4 Print</button>
      </div>
      <button class="btn primary" id="closeLedgerDone">Close</button>
    </div>
  `);

  document.getElementById('closeLedgerModalBtn').addEventListener('click', closeModal);
  document.getElementById('closeLedgerDone').addEventListener('click', closeModal);
  document.getElementById('printLedgerThermal').addEventListener('click', () => printLedgerReceipt(customer, txs, 'thermal'));
  document.getElementById('printLedgerA4').addEventListener('click', () => printLedgerReceipt(customer, txs, 'a4'));
}

function clearUdhaarModal(customer) {
  openModal(`
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
      <h3 style="margin: 0;">Clear Udhaar</h3>
      <button class="btn small-btn" id="closeClearModalX">✕</button>
    </div>
    <div style="margin-bottom: 12px; font-size: 14px;">
      <div>Customer: <strong>${customer.name}</strong></div>
      <div style="margin-top: 4px;">Current Udhaar: <strong style="color: var(--danger);">Rs. ${fmt(customer.balance)}</strong></div>
    </div>
    <label style="display: block; margin-bottom: 12px; font-size: 13px;">Received Amount (Rs.) *
      <input type="number" step="0.01" class="input" id="clearReceivedAmount" placeholder="0.00" value="${customer.balance > 0 ? customer.balance : ''}" style="margin-top: 4px;" />
    </label>
    <label style="display: block; margin-bottom: 16px; font-size: 13px;">Payment Note / Details (Optional)
      <textarea class="input" id="clearNote" rows="3" placeholder="Example: Paid in cash for weekly Udhaar" style="margin-top: 4px; resize: vertical;"></textarea>
    </label>
    <div class="modal-actions" style="display: flex; gap: 8px; justify-content: flex-end;">
      <button class="btn" id="clearCancelBtn">Cancel</button>
      <button class="btn success" id="clearSubmitBtn">💵 Clear Udhaar</button>
      <button class="btn primary" id="clearSavePrintBtn">🖨️ Save & Print</button>
    </div>
  `);

  document.getElementById('closeClearModalX').addEventListener('click', closeModal);
  document.getElementById('clearCancelBtn').addEventListener('click', closeModal);

  const handlePayment = async (printReceipt = false) => {
    const amount = parseFloat($('#clearReceivedAmount').value) || 0;
    if (amount <= 0) {
      toast('Please enter a valid received amount', true);
      return;
    }
    const note = $('#clearNote').value.trim() || 'Udhaar payment received';
    const receivedAt = new Date().toLocaleString();

    try {
      await api.ledger.addTransaction({
        entity_type: 'customer',
        entity_id: customer.id,
        type: 'credit',
        amount,
        description: note,
        reference: 'Clear Udhaar'
      });
    } catch (error) {
      console.error('Customer payment failed:', error);
      toast('Failed to save customer payment', true);
      return;
    }

    closeModal();
    let refreshFailed = false;
    try {
      await refresh();
    } catch (error) {
      console.error('Customer list refresh failed after payment:', error);
      refreshFailed = true;
    }

    if (printReceipt) {
      toast(refreshFailed
        ? 'Payment saved, but customer list refresh failed; opening receipt'
        : 'Payment saved; opening receipt...', refreshFailed);
      await printPaymentReceipt(customer, amount, note, receivedAt);
    } else {
      toast(refreshFailed
        ? 'Payment saved, but customer list refresh failed'
        : 'Udhaar cleared successfully', refreshFailed);
    }
  };

  document.getElementById('clearSubmitBtn').addEventListener('click', () => handlePayment(false));
  document.getElementById('clearSavePrintBtn').addEventListener('click', () => handlePayment(true));
}

async function printPaymentReceipt(customer, amount, note, receivedAt) {
  const currency = '{{currency}}';
  const currentBalance = Number(customer.balance || 0);
  const remainingBalance = currentBalance - amount;
  const content = `
    <div class="divider"></div>
    <h2>Payment Received</h2>
    <div><strong>Receipt Date:</strong> ${escapeHtml(receivedAt)}</div>
    <div><strong>Customer:</strong> ${escapeHtml(customer.name)}</div>
    ${customer.phone ? `<div><strong>Phone:</strong> ${escapeHtml(customer.phone)}</div>` : ''}
    <div class="divider"></div>
    <table class="summary">
      <tr><td>Amount Received:</td><td class="right"><strong>${fmt(amount)} ${currency}</strong></td></tr>
      <tr><td>Previous Balance:</td><td class="right">${fmt(currentBalance)} ${currency}</td></tr>
      <tr><td>Remaining Balance:</td><td class="right"><strong>${fmt(remainingBalance)} ${currency}</strong></td></tr>
    </table>
    <div class="divider"></div>
    <div><strong>Payment Details:</strong> ${escapeHtml(note)}</div>
    <div><strong>Reference:</strong> Clear Udhaar</div>
    <div class="divider"></div>
    <div class="center">Received with thanks</div>
  `;

  await printDocument('Payment Received Receipt', content, 'thermal', 'customerPaymentPrintFrame');
}

function customerForm(c = null) {
  const isEdit = !!c;
  openModal(`
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
      <h3 style="margin: 0;">${isEdit ? 'Edit Customer' : 'Add Customer'}</h3>
      <button class="btn small-btn" id="closeCustModalX">✕</button>
    </div>
    <label style="display: block; margin-bottom: 10px;">Name *<input class="input" id="c-name" value="${c?.name ?? ''}" style="margin-top: 4px;" /></label>
    <label style="display: block; margin-bottom: 10px;">Phone<input class="input" id="c-phone" value="${c?.phone ?? ''}" style="margin-top: 4px;" /></label>
    <label style="display: block; margin-bottom: 10px;">CNIC<input class="input" id="c-cnic" value="${c?.cnic ?? ''}" placeholder="00000-0000000-0" style="margin-top: 4px;" /></label>
    <label style="display: block; margin-bottom: 16px;">Address<input class="input" id="c-address" value="${c?.address ?? ''}" style="margin-top: 4px;" /></label>
    <div class="modal-actions" style="display: flex; justify-content: flex-end; gap: 8px;">
      <button class="btn" id="c-cancel">Cancel</button>
      <button class="btn primary" id="c-save">Save Customer</button>
    </div>
  `);
  const saveBtn = document.getElementById('c-save');
  document.getElementById('closeCustModalX').addEventListener('click', closeModal);
  document.getElementById('c-cancel').addEventListener('click', closeModal);
  saveBtn.addEventListener('click', async () => {
    const data = {
      name: $('#c-name').value.trim(),
      phone: $('#c-phone').value.trim(),
      cnic: $('#c-cnic').value.trim(),
      address: $('#c-address').value.trim()
    };
    if (!data.name) { toast('Customer name is required', true); return; }
    saveBtn.disabled = true;
    try {
      if (isEdit) {
        await api.customers.update(c.id, data);
      } else {
        await api.customers.create(data);
      }
    } catch (error) {
      console.error('Customer save failed:', error);
      toast('Failed to save customer', true);
      saveBtn.disabled = false;
      return;
    }
    closeModal();
    toast('Customer saved successfully');
    try {
      await refresh();
    } catch (error) {
      console.error('Customer list refresh failed:', error);
      toast('Customer saved, but the list could not be refreshed', true);
    }
  });
}

function init() {
  $('#addCustomerBtn')?.addEventListener('click', () => customerForm());
  $('#customerSearch')?.addEventListener('input', () => {
    renderList(cachedCustomers);
  });

  $('#customerEntityBody')?.addEventListener('click', async (e) => {
    const button = e.target.closest('button');
    if (!button) return;
    const editId = button.dataset.edit;
    const delId = button.dataset.del;
    const clearId = button.dataset.clear;
    const ledgerId = button.dataset.ledger;

    if (ledgerId) {
      try {
        const cust = await api.customers.getById(Number(ledgerId));
        if (cust) showLedgerModal(cust);
      } catch (error) {
        console.error('Could not open customer ledger:', error);
        toast('Could not open customer ledger', true);
      }
      return;
    }
    if (editId) {
      try {
        const cust = await api.customers.getById(Number(editId));
        if (cust) customerForm(cust);
      } catch (error) {
        console.error('Could not load customer for editing:', error);
        toast('Could not open customer details', true);
      }
    }
    if (clearId) {
      try {
        const cust = await api.customers.getById(Number(clearId));
        if (cust) clearUdhaarModal(cust);
      } catch (error) {
        console.error('Could not open clear udhaar modal:', error);
        toast('Could not open clear udhaar', true);
      }
    }
    if (delId) {
      if (!confirm('Are you sure you want to remove this customer?')) return;
      try {
        await api.customers.delete(Number(delId));
        toast('Customer removed');
        await refresh();
      } catch (error) {
        console.error('Customer deletion failed:', error);
        toast('Failed to delete customer', true);
      }
    }
  });

  refresh().catch(error => {
    console.error('Customer list load failed:', error);
    toast('Could not load customers', true);
  });
}

export const initCustomers = { init, refresh };
