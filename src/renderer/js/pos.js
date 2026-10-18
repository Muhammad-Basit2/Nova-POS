/* ============================================================
 *  Nova POS – POS Cashier Logic
 *  src/renderer/js/pos.js
 * ============================================================ */

import { toast, fmt, currency, openModal, closeModal } from './app.js';

const api = window.novaAPI;
const $ = (sel) => document.querySelector(sel);

let cart = [];
let customers = [];

function renderCart() {
  const body = $('#cartBody');
  body.innerHTML = '';
  $('#cartEmpty').classList.toggle('hidden', cart.length > 0);

  cart.forEach((ci, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${ci.item_name}</td>
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
  } else {
    cart.push({
      item_id: item.id, item_name: item.name, barcode: item.barcode || '',
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

async function completeSale() {
  if (!cart.length) { toast('Cart is empty', true); return; }
  const subtotal = cart.reduce((s, ci) => s + ci.line_total, 0);
  const discount = parseFloat($('#discountInput').value) || 0;
  const total = Math.max(subtotal - discount, 0);
  const paid = parseFloat($('#amountPaidInput').value) || 0;
  const payment_method = $('#paymentMethod').value;
  
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

  let notes = '';
  if (!customer_id && walkInName) {
    notes = `Walk-in: ${walkInName}`;
  }

  if (payment_method === 'cash' && paid < total) {
    toast('Insufficient amount paid', true);
    return;
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
    `<tr><td>${i.item_name}</td><td class="num">${i.quantity}</td><td class="num">${fmt(i.unit_price)}</td><td class="num">${fmt(i.line_total)}</td></tr>`
  ).join('');

  openModal(`
    <h3>Invoice ${sale.invoice_no}</h3>
    <table class="table"><thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="totals" style="margin-top:10px">
      <div class="row"><span>Subtotal</span><span>${fmt(sale.subtotal)}</span></div>
      <div class="row"><span>Discount</span><span>${fmt(sale.discount)}</span></div>
      <div class="row grand"><span>Total</span><span>${fmt(sale.total)}</span></div>
      <div class="row"><span>Change</span><span>${fmt(sale.change_due)}</span></div>
    </div>
    <div class="modal-actions"><button class="btn" id="closeSaleModal">Close</button></div>
  `);
  document.getElementById('closeSaleModal').addEventListener('click', closeModal);
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
      <div class="pos-product-name" title="${item.name}">${item.name}</div>
      <div class="pos-product-price">${fmt(item.sale_price)} ${currency()}</div>
      <div class="pos-product-stock">Stock: ${item.stock} ${item.unit}</div>
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
