/* ===========================================================
 *  Nova POS – Stock Purchases Logic
 *  src/renderer/js/purchases.js
 * ============================================================ */

import { toast, openModal, closeModal, fmt, currency } from './app.js';

const api = window.novaAPI;
const $ = (sel) => document.querySelector(sel);

async function refresh() {
  const body = $('#purchasesBody');
  if (!body) return;
  // For now, load purchases or mock list if table is ready
  body.innerHTML = `<tr><td colspan="7" class="empty-state">No stock purchases recorded yet. Click 'Record New Stock Purchase' to begin.</td></tr>`;
  $('#purchasesEmpty')?.classList.remove('hidden');
}

function purchaseModal() {
  openModal(`
    <h3>Record New Stock Purchase</h3>
    <label>Supplier Name<input class="input" id="p-supplier" placeholder="AM Traders" /></label>
    <label>Invoice / Bill #<input class="input" id="p-inv" placeholder="PUR-1001" /></label>
    <label>Total Bill Amount<input class="input" type="number" step="0.01" id="p-total" value="0" /></label>
    <label>Paid Amount<input class="input" type="number" step="0.01" id="p-paid" value="0" /></label>
    <div class="modal-actions">
      <button class="btn" id="p-cancel">Cancel</button>
      <button class="btn primary" id="p-save">Save Purchase</button>
    </div>
  `);
  document.getElementById('p-cancel').addEventListener('click', closeModal);
  document.getElementById('p-save').addEventListener('click', () => {
    toast('Stock purchase recorded');
    closeModal();
    refresh();
  });
}

function init() {
  $('#addPurchaseBtn')?.addEventListener('click', () => purchaseModal());
  refresh();
}

export const initPurchases = { init, refresh };
