/* ============================================================
 *  Nova POS – Inventory Items Management
 *  src/renderer/js/inventory.js
 * ============================================================ */

import { toast, openModal, closeModal, fmt, currency } from './app.js';

const api = window.novaAPI;
const $ = (sel) => document.querySelector(sel);

/* ---------- Load & Render Items ---------------------------- */
async function refresh() {
  const term = $('#inventorySearch').value.trim();
  const category = $('#categoryFilter').value;

  let items;
  if (term) items = await api.items.search(term);
  else items = await api.items.getAll({ category: category || undefined });

  /* Apply client-side category filter on search results too */
  if (term) {
    if (category) items = items.filter(i => i.category === category);
  }

  const body = $('#inventoryBody');
  body.innerHTML = '';
  $('#inventoryEmpty').classList.toggle('hidden', items.length > 0);

  items.forEach(i => {
    const tr = document.createElement('tr');
    const lowStock = i.stock <= i.min_stock;
    tr.innerHTML = `
      <td>${i.barcode || '—'}</td>
      <td><div>${i.name}</div>${i.urdu_name ? `<div class="urdu" style="font-size:12px; color:var(--accent);">${i.urdu_name}</div>` : ''}</td>
      <td>${i.category || '—'}</td>
      <td class="num">${fmt(i.cost_price)}</td>
      <td class="num">${fmt(i.sale_price)}</td>
      <td class="num" style="color:${lowStock ? 'var(--danger)' : 'inherit'}">${i.stock}</td>
      <td>
        <button class="btn small-btn" data-edit="${i.id}">Edit</button>
        <button class="btn danger small-btn" data-del="${i.id}">Del</button>
      </td>
    `;
    body.appendChild(tr);
  });

  await refreshFilters();
}

async function refreshFilters() {
  const cats = await api.items.getCategories();
  const catSel = $('#categoryFilter');
  const keepCat = catSel.value;
  catSel.innerHTML = '<option value="">All Categories</option>' + cats.map(c => `<option>${c}</option>`).join('');
  catSel.value = keepCat;
}

/* ---------- Item Form Modal -------------------------------- */
function itemForm(item = null) {
  const isEdit = !!item;
  openModal(`
    <h3>${isEdit ? 'Edit Item' : 'Add Item'}</h3>
    <label>Barcode<input class="input" id="f-barcode" value="${item?.barcode ?? ''}" /></label>
    <label>English Name *<input class="input" id="f-name" value="${item?.name ?? ''}" /></label>
    <label>Urdu Name (اردو نام)<input class="input urdu" id="f-urdu-name" value="${item?.urdu_name ?? ''}" placeholder="کوکنگ آئل" /></label>
    <label>Category<input class="input" id="f-category" value="${item?.category ?? ''}" /></label>
    <label>Cost Price<input class="input" type="number" step="0.01" id="f-cost" value="${item?.cost_price ?? 0}" /></label>
    <label>Sale Price<input class="input" type="number" step="0.01" id="f-sale" value="${item?.sale_price ?? 0}" /></label>
    <label>Stock<input class="input" type="number" step="0.01" id="f-stock" value="${item?.stock ?? 0}" /></label>
    <label>Min Stock<input class="input" type="number" step="0.01" id="f-min" value="${item?.min_stock ?? 0}" /></label>
    <label>Unit<input class="input" id="f-unit" value="${item?.unit ?? 'pcs'}" /></label>
    <div class="modal-actions">
      <button class="btn" id="f-cancel">Cancel</button>
      <button class="btn primary" id="f-save">Save</button>
    </div>
  `);
  document.getElementById('f-cancel').addEventListener('click', closeModal);
  document.getElementById('f-save').addEventListener('click', () => saveItem(isEdit ? item.id : null));
  document.getElementById('f-name').focus();
}

async function saveItem(id) {
  const data = {
    barcode: $('#f-barcode').value.trim(),
    name: $('#f-name').value.trim(),
    urdu_name: $('#f-urdu-name').value.trim(),
    category: $('#f-category').value.trim(),
    cost_price: parseFloat($('#f-cost').value) || 0,
    sale_price: parseFloat($('#f-sale').value) || 0,
    stock: parseFloat($('#f-stock').value) || 0,
    min_stock: parseFloat($('#f-min').value) || 0,
    unit: $('#f-unit').value.trim() || 'pcs',
    is_active: 1
  };
  if (!data.name) { toast('Item name is required', true); return; }

  if (id) await api.items.update(id, data);
  else await api.items.create(data);

  closeModal();
  toast('Item saved');
  refresh();
}

async function deleteItem(id) {
  if (!confirm('Are you sure you want to delete this item?')) return;
  await api.items.delete(id);
  toast('Item deleted');
  refresh();
}

/* ---------- Excel Import / Export -------------------------- */
async function importExcel() {
  const res = await api.excel.importItems();
  if (res.success) {
    toast(`Successfully imported ${res.count} items`);
    refresh();
  } else if (res.message !== 'Cancelled') {
    toast(`Import failed: ${res.message}`, true);
  }
}

async function exportExcel() {
  const res = await api.excel.exportItems();
  if (res.success) toast(`Exported to ${res.filePath}`);
  else if (res.message !== 'Cancelled') toast(`Export failed: ${res.message}`, true);
}

/* ---------- Init & Exports --------------------------------- */
function init() {
  $('#inventorySearch').addEventListener('input', refresh);
  $('#categoryFilter').addEventListener('change', refresh);

  $('#addItemBtn').addEventListener('click', () => itemForm());
  $('#importExcelBtn').addEventListener('click', importExcel);
  $('#exportExcelBtn').addEventListener('click', exportExcel);

  $('#inventoryBody').addEventListener('click', async (e) => {
    const editId = e.target.dataset.edit;
    const delId = e.target.dataset.del;
    if (editId) {
      const item = await api.items.getById(Number(editId));
      if (item) itemForm(item);
    }
    if (delId) deleteItem(Number(delId));
  });

  refresh();
}

export const initInventory = { init, refresh };
