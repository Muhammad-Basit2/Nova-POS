/* ============================================================
 *  Nova POS – Customer & Vendor Ledger Logic
 *  src/renderer/js/ledger.js
 * ============================================================ */

import { toast, openModal, closeModal, fmt } from './app.js';

const api = window.novaAPI;
const $ = (sel) => document.querySelector(sel);

let currentType = 'customer';
let selectedEntity = null;

async function refresh() {
  currentType = $('#ledgerType').value;
  const entities = currentType === 'customer' ? await api.customers.getAll() : await api.vendors.getAll();
  const body = $('#entityBody');
  body.innerHTML = '';
  entities.forEach(en => {
    const tr = document.createElement('tr');
    tr.className = selectedEntity?.id === en.id ? 'active' : '';
    tr.style.cursor = 'pointer';
    tr.innerHTML = `
      <td>${en.name}</td><td>${en.phone || '—'}</td>
      <td class="num" style="color:${en.balance > 0 ? 'var(--accent)' : 'inherit'}">${fmt(en.balance)}</td>
      <td>
        <button class="btn small-btn" data-edit="${en.id}">Edit</button>
        <button class="btn danger small-btn" data-del="${en.id}">Del</button>
      </td>
    `;
    tr.addEventListener('click', (e) => { if (e.target.tagName !== 'BUTTON') selectEntity(en); });
    body.appendChild(tr);
  });
  if (selectedEntity) {
    const updated = entities.find(e => e.id === selectedEntity.id);
    if (updated) selectEntity(updated);
    else { selectedEntity = null; $('#ledgerBody').innerHTML = ''; $('#ledgerDetailTitle').textContent = 'Select an entry'; }
  }
}

async function selectEntity(en) {
  selectedEntity = en;
  $('#ledgerDetailTitle').textContent = `${en.name} (${currentType}) — Balance: ${fmt(en.balance)}`;
  const txs = currentType === 'customer' ? await api.customers.getLedger(en.id) : await api.vendors.getLedger(en.id);
  const body = $('#ledgerBody');
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

function entityForm(en = null) {
  const isEdit = !!en;
  openModal(`
    <h3>${isEdit ? 'Edit' : 'Add'} ${currentType}</h3>
    <label>Name *<input class="input" id="e-name" value="${en?.name ?? ''}" /></label>
    <label>Phone<input class="input" id="e-phone" value="${en?.phone ?? ''}" /></label>
    <label>Address<input class="input" id="e-address" value="${en?.address ?? ''}" /></label>
    <div class="modal-actions">
      <button class="btn" id="e-cancel">Cancel</button>
      <button class="btn primary" id="e-save">Save</button>
    </div>
  `);
  document.getElementById('e-cancel').addEventListener('click', closeModal);
  document.getElementById('e-save').addEventListener('click', async () => {
    const data = { name: $('#e-name').value.trim(), phone: $('#e-phone').value.trim(), address: $('#e-address').value.trim() };
    if (!data.name) { toast('Name required', true); return; }
    if (isEdit) {
      if (currentType === 'customer') await api.customers.update(en.id, data);
      else await api.vendors.update(en.id, data);
    } else {
      if (currentType === 'customer') await api.customers.create(data);
      else await api.vendors.create(data);
    }
    closeModal(); toast('Saved'); refresh();
  });
}

async function transactionModal() {
  if (!selectedEntity) { toast('Select entry first', true); return; }
  openModal(`
    <h3>Add Transaction (${selectedEntity.name})</h3>
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
      entity_type: currentType, entity_id: selectedEntity.id,
      type: $('#t-type').value, amount, description: $('#t-desc').value.trim(), reference: ''
    });
    closeModal(); toast('Added'); refresh();
  });
}

function init() {
  $('#ledgerType').addEventListener('change', () => { selectedEntity = null; refresh(); });
  $('#addEntityBtn').addEventListener('click', () => entityForm());
  $('#addTransactionBtn').addEventListener('click', transactionModal);
  $('#entityBody').addEventListener('click', async (e) => {
    const editId = e.target.dataset.edit, delId = e.target.dataset.del;
    if (editId) {
      const en = currentType === 'customer' ? await api.customers.getById(Number(editId)) : await api.vendors.getById(Number(editId));
      if (en) entityForm(en);
    }
    if (delId) {
      if (!confirm('Delete?')) return;
      if (currentType === 'customer') await api.customers.delete(Number(delId));
      else await api.vendors.delete(Number(delId));
      selectedEntity = null; toast('Deleted'); refresh();
    }
  });
  refresh();
}

export const initLedger = { init, refresh };
