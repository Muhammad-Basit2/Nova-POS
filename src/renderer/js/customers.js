/* ============================================================
 *  Nova POS – Customer Ledger Logic
 *  src/renderer/js/customers.js
 * ============================================================ */

import { toast, openModal, closeModal, fmt } from './app.js';

const api = window.novaAPI;
const $ = (sel) => document.querySelector(sel);

let selectedCustomer = null;

async function refresh() {
  const customers = await api.customers.getAll();
  const body = $('#customerEntityBody');
  if (!body) return;
  body.innerHTML = '';
  customers.forEach(c => {
    const tr = document.createElement('tr');
    tr.className = selectedCustomer?.id === c.id ? 'active' : '';
    tr.style.cursor = 'pointer';
    tr.innerHTML = `
      <td>${c.name}</td><td>${c.phone || '—'}</td>
      <td class="num" style="color:${c.balance > 0 ? 'var(--accent)' : 'inherit'}">${fmt(c.balance)}</td>
      <td>
        <button class="btn small-btn" data-edit="${c.id}">Edit</button>
        <button class="btn danger small-btn" data-del="${c.id}">Del</button>
      </td>
    `;
    tr.addEventListener('click', (e) => { if (e.target.tagName !== 'BUTTON') selectCustomer(c); });
    body.appendChild(tr);
  });
  if (selectedCustomer) {
    const updated = customers.find(c => c.id === selectedCustomer.id);
    if (updated) selectCustomer(updated);
    else { selectedCustomer = null; $('#customerLedgerBody').innerHTML = ''; $('#customerDetailTitle').textContent = 'Select a customer'; }
  }
}

async function selectCustomer(c) {
  selectedCustomer = c;
  $('#customerDetailTitle').textContent = `${c.name} (Customer) — Balance: ${fmt(c.balance)}`;
  const txs = await api.customers.getLedger(c.id);
  const body = $('#customerLedgerBody');
  if (!body) return;
  body.innerHTML = '';
  if (!txs.length) { body.innerHTML = `<tr><td colspan="4" class="empty-state">No transactions</td></tr>`; return; }
  txs.forEach(t => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${t.created_at}</td>
      <td><span style="color:${t.type === 'debit' ? 'var(--danger)' : 'var(--success)'}">${t.type.toUpperCase()}</span></td>
      <td class="num">${fmt(t.amount)}</td><td>${t.description || '—'}</td>
    `;
    body.appendChild(tr);
  });
}

function customerForm(c = null) {
  const isEdit = !!c;
  openModal(`
    <h3>${isEdit ? 'Edit' : 'Add'} Customer</h3>
    <label>Name *<input class="input" id="c-name" value="${c?.name ?? ''}" /></label>
    <label>Phone<input class="input" id="c-phone" value="${c?.phone ?? ''}" /></label>
    <label>Address<input class="input" id="c-address" value="${c?.address ?? ''}" /></label>
    <div class="modal-actions">
      <button class="btn" id="c-cancel">Cancel</button>
      <button class="btn primary" id="c-save">Save</button>
    </div>
  `);
  document.getElementById('c-cancel').addEventListener('click', closeModal);
  document.getElementById('c-save').addEventListener('click', async () => {
    const data = { name: $('#c-name').value.trim(), phone: $('#c-phone').value.trim(), address: $('#c-address').value.trim() };
    if (!data.name) { toast('Name required', true); return; }
    if (isEdit) {
      await api.customers.update(c.id, data);
    } else {
      await api.customers.create(data);
    }
    closeModal(); toast('Saved'); refresh();
  });
}

async function transactionModal() {
  if (!selectedCustomer) { toast('Select customer first', true); return; }
  openModal(`
    <h3>Add Transaction (${selectedCustomer.name})</h3>
    <label>Type<select class="input" id="t-type"><option value="credit">Credit / Payment</option><option value="debit">Debit / Charge</option></select></label>
    <label>Amount *<input class="input" type="number" step="0.01" id="t-amount" /></label>
    <label>Description<input class="input" id="t-desc" /></label>
    <div class="modal-actions"><button class="btn" id="t-cancel">Cancel</button><button class="btn primary" id="t-save">Add</button></div>
  `);
  document.getElementById('t-cancel').addEventListener('click', closeModal);
  document.getElementById('t-save').addEventListener('click', async () => {
    const amount = parseFloat($('#t-amount').value) || 0;
    if (amount <= 0) { toast('Valid amount required', true); return; }
    await api.ledger.addTransaction({
      entity_type: 'customer', entity_id: selectedCustomer.id,
      type: $('#t-type').value, amount, description: $('#t-desc').value.trim(), reference: ''
    });
    closeModal(); toast('Added'); refresh();
  });
}

function init() {
  $('#addCustomerBtn')?.addEventListener('click', () => customerForm());
  $('#addCustomerTxBtn')?.addEventListener('click', transactionModal);
  $('#customerEntityBody')?.addEventListener('click', async (e) => {
    const editId = e.target.dataset.edit, delId = e.target.dataset.del;
    if (editId) {
      const c = await api.customers.getById(Number(editId));
      if (c) customerForm(c);
    }
    if (delId) {
      if (!confirm('Delete customer?')) return;
      await api.customers.delete(Number(delId));
      selectedCustomer = null; toast('Deleted'); refresh();
    }
  });
  refresh();
}

export const initCustomers = { init, refresh };
