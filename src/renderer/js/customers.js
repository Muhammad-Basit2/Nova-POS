/* ============================================================
 *  Nova POS – Customer Ledger Logic
 *  src/renderer/js/customers.js
 * ============================================================ */

import { toast, openModal, closeModal, fmt } from './app.js';

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
    <div class="modal-actions" style="margin-top: 14px; display: flex; justify-content: flex-end;">
      <button class="btn primary" id="closeLedgerDone">Close</button>
    </div>
  `);
  document.getElementById('closeLedgerModalBtn').addEventListener('click', closeModal);
  document.getElementById('closeLedgerDone').addEventListener('click', closeModal);
}

function clearUdhaarModal(customer) {
  const today = new Date().toISOString().split('T')[0];
  openModal(`
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
      <h3 style="margin: 0;">Clear Udhaar</h3>
      <button class="btn small-btn" id="closeClearModalX">✕</button>
    </div>
    <div style="margin-bottom: 12px; font-size: 14px;">
      <div>Customer: <strong>${customer.name}</strong></div>
      <div style="margin-top: 4px;">Current Udhaar: <strong style="color: var(--danger);">Rs. ${fmt(customer.balance)}</strong></div>
    </div>
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px;">
      <label style="font-size: 13px; color: var(--text-dim);">From<input type="date" class="input" id="clearFromDate" value="${today}" style="margin-top: 4px;" /></label>
      <label style="font-size: 13px; color: var(--text-dim);">To<input type="date" class="input" id="clearToDate" value="${today}" style="margin-top: 4px;" /></label>
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
    
    await api.ledger.addTransaction({
      entity_type: 'customer',
      entity_id: customer.id,
      type: 'credit',
      amount,
      description: note,
      reference: 'Clear Udhaar'
    });

    if (printReceipt) {
      toast('Payment saved & printing receipt...');
    } else {
      toast('Udhaar cleared successfully');
    }

    closeModal();
    refresh();
  };

  document.getElementById('clearSubmitBtn').addEventListener('click', () => handlePayment(false));
  document.getElementById('clearSavePrintBtn').addEventListener('click', () => handlePayment(true));
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
  document.getElementById('closeCustModalX').addEventListener('click', closeModal);
  document.getElementById('c-cancel').addEventListener('click', closeModal);
  document.getElementById('c-save').addEventListener('click', async () => {
    const data = {
      name: $('#c-name').value.trim(),
      phone: $('#c-phone').value.trim(),
      cnic: $('#c-cnic').value.trim(),
      address: $('#c-address').value.trim()
    };
    if (!data.name) { toast('Customer name is required', true); return; }
    if (isEdit) {
      await api.customers.update(c.id, data);
    } else {
      await api.customers.create(data);
    }
    closeModal();
    toast('Customer saved successfully');
    refresh();
  });
}

function init() {
  $('#addCustomerBtn')?.addEventListener('click', () => customerForm());
  $('#customerSearch')?.addEventListener('input', () => {
    renderList(cachedCustomers);
  });

  $('#customerEntityBody')?.addEventListener('click', async (e) => {
    const editId = e.target.dataset.edit;
    const delId = e.target.dataset.del;
    const clearId = e.target.dataset.clear;
    const ledgerId = e.target.dataset.ledger;

    if (editId) {
      const c = await api.customers.getById(Number(editId));
      if (c) customerForm(c);
    }
    if (clearId) {
      const c = await api.customers.getById(Number(clearId));
      if (c) clearUdhaarModal(c);
    }
    if (ledgerId) {
      const c = await api.customers.getById(Number(ledgerId));
      if (c) showLedgerModal(c);
    }
    if (delId) {
      if (!confirm('Are you sure you want to remove this customer?')) return;
      await api.customers.delete(Number(delId));
      toast('Customer removed');
      refresh();
    }
  });

  refresh();
}

export const initCustomers = { init, refresh };
