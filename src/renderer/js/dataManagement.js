/* ============================================================
 *  Nova POS – Data Management & Cleanup Logic
 *  src/renderer/js/dataManagement.js
 * ============================================================ */

import { toast } from './app.js';

const api = window.novaAPI;
const $ = (sel) => document.querySelector(sel);

async function clearSales() {
  if (!confirm('WARNING: This will permanently delete all sales history and invoices. Continue?')) return;
  const res = await api.data.clearSales();
  if (res.success) {
    toast(res.message);
  } else {
    toast(`Failed: ${res.message}`, true);
  }
}

async function clearInventory() {
  if (!confirm('WARNING: This will permanently delete all inventory items. Continue?')) return;
  const res = await api.data.clearInventory();
  if (res.success) {
    toast(res.message);
  } else {
    toast(`Failed: ${res.message}`, true);
  }
}

async function clearLedger() {
  if (!confirm('WARNING: This will permanently delete all customers, vendors, and ledger transactions. Continue?')) return;
  const res = await api.data.clearLedger();
  if (res.success) {
    toast(res.message);
  } else {
    toast(`Failed: ${res.message}`, true);
  }
}

async function clearAll() {
  if (!confirm('EXTREME WARNING: This will permanently delete ALL sales, inventory, ledger, customers, and vendors. This cannot be undone. Continue?')) return;
  if (!confirm('Are you absolutely sure? All business data will be lost.')) return;
  const res = await api.data.clearAll();
  if (res.success) {
    toast(res.message);
  } else {
    toast(`Failed: ${res.message}`, true);
  }
}

function init() {
  $('#clearSalesBtn')?.addEventListener('click', clearSales);
  $('#clearInventoryBtn')?.addEventListener('click', clearInventory);
  $('#clearLedgerBtn')?.addEventListener('click', clearLedger);
  $('#clearAllBtn')?.addEventListener('click', clearAll);
}

export const initDataManagement = { init };
