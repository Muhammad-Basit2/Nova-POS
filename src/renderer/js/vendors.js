/* ============================================================
 *  Nova POS – Vendor Ledger Logic
 *  src/renderer/js/vendors.js
 * ============================================================ */

import { toast, openModal, closeModal, fmt } from './app.js';

const api = window.novaAPI;
const $ = (sel) => document.querySelector(sel);

let selectedVendor = null;

async function refresh() {
  const vendors = await api.vendors.getAll();
  const body = $('#vendorEntityBody');
  if (!body) return;
  body.innerHTML = '';
  vendors.forEach(v => {
    const tr = document.createElement('tr');
    tr.className = selectedVendor?.id === v.id ? 'active' : '';
    tr.style.cursor = 'pointer';
    tr.innerHTML = `
      <td>${v.name}</td><td>${v.phone || '—'}</td>
      <td class="num" style="color:${v.balance > 0 ? 'var(--accent)' : 'inherit'}">${fmt(v.balance)}</td>
      <td>
        <button class="btn small-btn" data-edit="${v.id}">Edit</button>
        <button class="btn danger small-btn" data-del="${v.id}">Del</button>
      </td>
    `;
    tr.addEventListener('click', (e) => { if (e.target.tagName !== 'BUTTON') selectVendor(v); });
    body.appendChild(tr);
  });
  if (selectedVendor) {
    const updated = vendors.find(v => v.id === selectedVendor.id);
    if (updated) selectVendor(updated);
    else { selectedVendor = null; $('#vendorLedgerBody').innerHTML = ''; $('#vendorDetailTitle').textContent = 'Select a vendor'; }
  }
}

async function selectVendor(v) {
  selectedVendor = v;
  $('#vendorDetailTitle').textContent = `${v.name} (Vendor) — Balance: ${fmt(v.balance)}`;
  const txs = await api.vendors.getLedger(v.id);
  const body = $('#vendorLedgerBody');
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

function vendorForm(v = null) {
  const isEdit = !!v;
  openModal(`
    <h3>${isEdit ? 'Edit' : 'Add'} Vendor</h3>
    <label>Name *<input class="input" id="v-name" value="${v?.name ?? ''}" /></label>
    <label>Phone<input class="input" id="v-phone" value="${v?.phone ?? ''}" /></label>
    <label>Address<input class="input" id="v-address" value="${v?.address ?? ''}" /></label>
    <div class="modal-actions">
      <button class="btn" id="v-cancel">Cancel</button>
      <button class="btn primary" id="v-save">Save</button>
    </div>
  `);
  document.getElementById('v-cancel').addEventListener('click', closeModal);
  document.getElementById('v-save').addEventListener('click', async () => {
    const data = { name: $('#v-name').value.trim(), phone: $('#v-phone').value.trim(), address: $('#v-address').value.trim() };
    if (!data.name) { toast('Name required', true); return; }
    if (isEdit) {
      await api.vendors.update(v.id, data);
    } else {
      await api.vendors.create(data);
    }
    closeModal(); toast('Saved'); refresh();
  });
}

async function transactionModal() {
  if (!selectedVendor) { toast('Select vendor first', true); return; }
  openModal(`
    <h3>Add Transaction (${selectedVendor.name})</h3>
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
      entity_type: 'vendor', entity_id: selectedVendor.id,
      type: $('#t-type').value, amount, description: $('#t-desc').value.trim(), reference: ''
    });
    closeModal(); toast('Added'); refresh();
  });
}

function init() {
  $('#addVendorBtn')?.addEventListener('click', () => vendorForm());
  $('#addVendorTxBtn')?.addEventListener('click', transactionModal);
  $('#vendorEntityBody')?.addEventListener('click', async (e) => {
    const editId = e.target.dataset.edit, delId = e.target.dataset.del;
    if (editId) {
      const v = await api.vendors.getById(Number(editId));
      if (v) vendorForm(v);
    }
    if (delId) {
      if (!confirm('Delete vendor?')) return;
      await api.vendors.delete(Number(delId));
      selectedVendor = null; toast('Deleted'); refresh();
    }
  });
  refresh();
}

export const initVendors = { init, refresh };
