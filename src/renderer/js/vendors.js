/* ============================================================
 *  Nova POS – Supplier Management
 *  src/renderer/js/vendors.js
 * ============================================================ */

import { toast, openModal, closeModal, fmt, currency, printLogoHTML } from './app.js';

const api = window.novaAPI;
const $ = (sel) => document.querySelector(sel);

async function refresh() {
  const vendors = await api.vendors.getAll();
  const body = $('#supplierEntityBody');
  if (!body) return;
  body.innerHTML = '';
  const search = ($('#supplierSearch')?.value || '').trim().toLowerCase();
  const filtered = vendors.filter(v =>
    v.name.toLowerCase().includes(search) ||
    (v.contact_person || '').toLowerCase().includes(search) ||
    (v.phone || '').toLowerCase().includes(search)
  );
  const empty = $('#supplierEmpty');
  empty?.classList.toggle('hidden', filtered.length > 0);
  filtered.forEach(v => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(v.name)}</td>
      <td>${escapeHtml(v.contact_person || '—')}</td>
      <td>${escapeHtml(v.phone || '—')}</td>
      <td class="num">${fmt(v.total_paid)}</td>
      <td class="num" style="color:${v.balance > 0 ? 'var(--danger)' : 'inherit'}">${v.balance < 0
        ? `Advance ${fmt(Math.abs(v.balance))} ${escapeHtml(currency())}`
        : `${fmt(v.balance)} ${escapeHtml(currency())}`}</td>
      <td>
        <button class="btn small-btn" data-ledger="${v.id}">Ledger</button>
        <button class="btn small-btn" data-edit="${v.id}">Edit</button>
        <button class="btn danger small-btn" data-del="${v.id}">Delete</button>
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

function supplierBalanceLabel(balance) {
  const amount = fmt(Math.abs(Number(balance) || 0));
  return Number(balance) < 0
    ? `Supplier advance: ${amount} ${escapeHtml(currency())}`
    : `Payable balance: ${amount} ${escapeHtml(currency())}`;
}

function vendorForm(v = null) {
  const isEdit = !!v;
  openModal(`
    <div class="supplier-modal">
      <header class="supplier-modal-header">
        <h3>${isEdit ? 'Edit Supplier' : 'Add Supplier'}</h3>
        <button class="supplier-modal-close" id="v-close" aria-label="Close">×</button>
      </header>
      <div class="supplier-modal-form">
        <label>Company Name *<input class="input" id="v-name" value="${escapeHtml(v?.name || '')}" autofocus /></label>
        <label>Contact Person<input class="input" id="v-contact" value="${escapeHtml(v?.contact_person || '')}" /></label>
        <label>Phone<input class="input" id="v-phone" value="${escapeHtml(v?.phone || '')}" /></label>
        ${isEdit ? '' : '<label>Initial Payable Balance (Optional)<input class="input" id="v-initial-balance" type="number" min="0" step="0.01" value="0" /></label>'}
      </div>
      <footer class="supplier-modal-footer">
        <button class="btn" id="v-cancel">Cancel</button>
        <button class="btn primary supplier-save-btn" id="v-save">Save Supplier</button>
      </footer>
    </div>
  `);
  document.getElementById('v-close').addEventListener('click', closeModal);
  document.getElementById('v-cancel').addEventListener('click', closeModal);
  document.getElementById('v-save').addEventListener('click', async () => {
    const name = $('#v-name').value.trim();
    const initialBalance = isEdit ? 0 : Number($('#v-initial-balance').value || 0);
    if (!name) { toast('Company name is required', true); return; }
    if (!Number.isFinite(initialBalance) || initialBalance < 0) {
      toast('Enter a valid non-negative payable balance', true);
      return;
    }

    const data = {
      name,
      contact_person: $('#v-contact').value.trim(),
      phone: $('#v-phone').value.trim(),
      address: v?.address || ''
    };
    const saveButton = document.getElementById('v-save');
    saveButton.disabled = true;
    try {
      if (isEdit) {
        await api.vendors.update(v.id, data);
      } else {
        await api.vendors.create({ ...data, initial_balance: initialBalance });
      }
    } catch (error) {
      console.error('Supplier save failed:', error);
      toast('Failed to save supplier', true);
      saveButton.disabled = false;
      return;
    }

    closeModal();
    toast(isEdit ? 'Supplier updated' : 'Supplier added');
    try {
      await refresh();
    } catch (error) {
      console.error('Supplier list refresh failed:', error);
      toast('Supplier saved, but the supplier list could not be refreshed', true);
    }
  });
}

async function showVendorLedger(vendor) {
  let transactions;
  try {
    transactions = await api.vendors.getLedger(vendor.id);
  } catch (error) {
    console.error('Could not load supplier ledger:', error);
    toast('Could not load supplier ledger', true);
    return;
  }

  const rows = transactions.length
    ? transactions.map(transaction => `
        <tr>
          <td>${escapeHtml(transaction.created_at)}</td>
          <td><span style="color:${transaction.type === 'debit' ? 'var(--danger)' : 'var(--success)'}">${escapeHtml(transaction.type.toUpperCase())}</span></td>
          <td class="num">${fmt(transaction.amount)} ${escapeHtml(currency())}</td>
          <td>${escapeHtml(transaction.description || '—')}${transaction.reference ? `<br><small>${escapeHtml(transaction.reference)}</small>` : ''}</td>
        </tr>
      `).join('')
    : '<tr><td colspan="4" class="empty-state">No transactions recorded</td></tr>';

  openModal(`
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
      <h3 style="margin:0;">Supplier Ledger — ${escapeHtml(vendor.name)}</h3>
      <button class="btn small-btn" id="closeSupplierLedger">✕</button>
    </div>
    <p style="margin-bottom:12px;"><strong>${supplierBalanceLabel(vendor.balance)}</strong></p>
    <div class="table-wrap" style="max-height:50vh;">
      <table class="table">
        <thead><tr><th>Date</th><th>Type</th><th class="num">Amount</th><th>Description / Reference</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="modal-actions" style="flex-wrap:wrap;">
      <button class="btn" id="printSupplierLedgerThermal">🖨️ Thermal Print</button>
      <button class="btn" id="printSupplierLedgerA4">📄 A4 Print</button>
      <button class="btn" id="supplierLedgerClose">Close</button>
      <button class="btn success" id="supplierLedgerPayment">＋ Record Payment</button>
    </div>
  `);
  document.getElementById('closeSupplierLedger').addEventListener('click', closeModal);
  document.getElementById('supplierLedgerClose').addEventListener('click', closeModal);
  document.getElementById('printSupplierLedgerThermal').addEventListener('click', () => printSupplierLedger(vendor, transactions, 'thermal'));
  document.getElementById('printSupplierLedgerA4').addEventListener('click', () => printSupplierLedger(vendor, transactions, 'a4'));
  document.getElementById('supplierLedgerPayment').addEventListener('click', () => supplierPaymentModal(vendor));
}

async function printSupplierLedger(vendor, transactions, paperSize) {
  try {
    const settings = await api.settings.getAll();
    const thermal = paperSize === 'thermal';
    const storeName = escapeHtml(settings.store_name || 'Nova POS Store');
    const storePhone = escapeHtml(settings.store_phone || '');
    const storeAddress = escapeHtml(settings.store_address || '');
    const footer = escapeHtml(settings.receipt_footer || 'Thank you!');
    const currencyLabel = escapeHtml(settings.currency || '');
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
            <td class="right">${fmt(transaction.amount)} ${currencyLabel}</td>
            <td>${escapeHtml(transaction.description || '—')}${transaction.reference ? `<br><small>${escapeHtml(transaction.reference)}</small>` : ''}</td>
          </tr>
        `).join('')
      : '<tr><td colspan="4" class="center">No transactions recorded</td></tr>';

    let frame = document.getElementById('supplierLedgerPrintFrame');
    if (!frame) {
      frame = document.createElement('iframe');
      frame.id = 'supplierLedgerPrintFrame';
      document.body.appendChild(frame);
    }
    frame.style.cssText = 'position:fixed;width:80mm;height:100vh;border:0;left:-9999px;top:0;opacity:0;pointer-events:none;';
    const frameDoc = frame.contentWindow.document;
    frameDoc.open();
    frameDoc.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>${escapeHtml(vendor.name)} — Supplier Ledger</title>
        <style>
          @page { size: ${thermal ? '80mm auto' : 'A4 portrait'}; margin: ${thermal ? '0' : '14mm'}; }
          body { font-family: Arial, sans-serif; color: #000; background: #fff; font-size: ${thermal ? '11px' : '12px'}; ${thermal ? 'width:72mm;margin:0 auto;padding:5mm;' : 'width:100%;margin:0;'} }
          h1 { text-align:center;font-size:${thermal ? '16px' : '20px'};margin:0 0 4px; }
          h2 { text-align:center;font-size:${thermal ? '14px' : '17px'};margin:10px 0; }
          .center { text-align:center; }
          .right { text-align:right; }
          .divider { border-top:1px dashed #000;margin:8px 0; }
          table { width:100%;border-collapse:collapse; }
          th,td { text-align:left;vertical-align:top;padding:${thermal ? '4px 2px' : '7px 5px'};border-bottom:1px solid #bbb; }
          th { border-bottom:2px solid #000; }
          .summary { margin-top:10px; }
          .summary td { border:0;padding:3px 2px; }
          .footer { text-align:center;margin-top:12px; }
          ${thermal ? 'th,td{font-size:10px;}' : ''}
        </style>
      </head>
      <body>
        <h1>${storeName}</h1>
        ${printLogoHTML(null, 300)}
        ${storeAddress ? `<div class="center">${storeAddress}</div>` : ''}
        ${storePhone ? `<div class="center">Tel: ${storePhone}</div>` : ''}
        <div class="divider"></div>
        <div><strong>Supplier:</strong> ${escapeHtml(vendor.name)}</div>
        ${vendor.contact_person ? `<div><strong>Contact:</strong> ${escapeHtml(vendor.contact_person)}</div>` : ''}
        ${vendor.phone ? `<div><strong>Phone:</strong> ${escapeHtml(vendor.phone)}</div>` : ''}
        <div><strong>Printed:</strong> ${escapeHtml(new Date().toLocaleString())}</div>
        <h2>Supplier Ledger</h2>
        <table>
          <thead><tr><th>Date</th><th>Type</th><th class="right">Amount</th><th>Description / Reference</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <table class="summary">
          <tr><td>Total Charges:</td><td class="right">${fmt(totalDebit)} ${currencyLabel}</td></tr>
          <tr><td>Total Payments:</td><td class="right">${fmt(totalCredit)} ${currencyLabel}</td></tr>
          <tr><td><strong>${Number(vendor.balance) < 0 ? 'Supplier Advance:' : 'Payable Balance:'}</strong></td><td class="right"><strong>${fmt(Math.abs(Number(vendor.balance) || 0))} ${currencyLabel}</strong></td></tr>
        </table>
        <div class="footer">${footer}<br><small>Powered by Nova POS</small></div>
      </body>
      </html>
    `);
    frameDoc.close();
    setTimeout(() => {
      try {
        frame.contentWindow.focus();
        frame.contentWindow.print();
      } catch (error) {
        console.error('Supplier ledger print invocation failed:', error);
        toast('Failed to open supplier ledger print dialog', true);
      }
    }, 250);
  } catch (error) {
    console.error('Supplier ledger print preparation failed:', error);
    toast('Failed to prepare supplier ledger for printing', true);
  }
}

function supplierPaymentModal(vendor) {
  openModal(`
    <h3>Record Supplier Payment</h3>
    <p style="margin-bottom:12px;">${escapeHtml(vendor.name)} — ${supplierBalanceLabel(vendor.balance)}</p>
    <p style="margin-bottom:12px;color:var(--text-dim);">Payments above the current payable balance will be recorded as a supplier advance.</p>
    <label>Amount Paid *
      <input class="input" type="number" min="0.01" step="0.01" id="vendor-payment-amount" />
    </label>
    <label>Payment Note
      <input class="input" id="vendor-payment-note" value="Supplier payment" />
    </label>
    <div class="modal-actions">
      <button class="btn" id="vendor-payment-cancel">Cancel</button>
      <button class="btn primary" id="vendor-payment-save">Save Payment</button>
    </div>
  `);
  document.getElementById('vendor-payment-cancel').addEventListener('click', closeModal);
  document.getElementById('vendor-payment-save').addEventListener('click', async () => {
    const amount = Number($('#vendor-payment-amount').value);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast('Enter a payment amount greater than zero', true);
      return;
    }
    if (amount > Math.max(Number(vendor.balance) || 0, 0) &&
        !confirm('This payment is greater than the current payable balance. Record the extra amount as a supplier advance?')) {
      return;
    }

    const saveButton = document.getElementById('vendor-payment-save');
    saveButton.disabled = true;
    try {
      await api.vendors.addPayment(vendor.id, {
        amount,
        description: $('#vendor-payment-note').value.trim() || 'Supplier payment'
      });
    } catch (error) {
      console.error('Supplier payment failed:', error);
      toast(error.message || 'Failed to save supplier payment', true);
      saveButton.disabled = false;
      return;
    }

    closeModal();
    toast('Payment saved to supplier ledger');
    try {
      await refresh();
      const updatedVendor = await api.vendors.getById(vendor.id);
      if (updatedVendor) await showVendorLedger(updatedVendor);
    } catch (error) {
      console.error('Could not refresh supplier after payment:', error);
      toast('Payment saved, but supplier details could not be refreshed', true);
    }
  });
}

function init() {
  $('#addSupplierBtn')?.addEventListener('click', () => vendorForm());
  $('#supplierSearch')?.addEventListener('input', () => {
    refresh().catch(error => {
      console.error('Supplier search refresh failed:', error);
      toast('Could not refresh suppliers', true);
    });
  });
  document.addEventListener('nova:openSupplierLedger', async (event) => {
    const vendorId = Number(event.detail?.vendorId);
    if (!vendorId) return;
    try {
      const vendor = await api.vendors.getById(vendorId);
      if (vendor) await showVendorLedger(vendor);
    } catch (error) {
      console.error('Could not open supplier ledger:', error);
      toast('Could not open supplier ledger', true);
    }
  });
  $('#supplierEntityBody')?.addEventListener('click', async (e) => {
    const button = e.target.closest('button');
    if (!button) return;
    const editId = button.dataset.edit, delId = button.dataset.del;
    const ledgerId = button.dataset.ledger;
    if (ledgerId) {
      try {
        const vendor = await api.vendors.getById(Number(ledgerId));
        if (vendor) await showVendorLedger(vendor);
      } catch (error) {
        console.error('Could not open supplier ledger:', error);
        toast('Could not open supplier ledger', true);
      }
      return;
    }
    if (editId) {
      try {
        const v = await api.vendors.getById(Number(editId));
        if (v) vendorForm(v);
      } catch (error) {
        console.error('Could not load supplier for editing:', error);
        toast('Could not open supplier details', true);
      }
    }
    if (delId) {
      if (!confirm('Are you sure you want to delete this supplier?')) return;
      try {
        await api.vendors.delete(Number(delId));
        toast('Supplier deleted');
        await refresh();
      } catch (error) {
        console.error('Supplier deletion failed:', error);
        toast('Failed to delete supplier', true);
      }
    }
  });
  refresh().catch(error => {
    console.error('Supplier list load failed:', error);
    toast('Could not load suppliers', true);
  });
}

export const initVendors = { init, refresh };
