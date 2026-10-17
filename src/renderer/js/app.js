/* ============================================================
 *  Nova POS – Main UI Router, Settings & Global Shortcuts
 *  src/renderer/js/app.js
 * ============================================================ */

import { initDashboard } from './dashboard.js';
import { initPOS } from './pos.js';
import { initInventory } from './inventory.js';
import { initLedger } from './ledger.js';
import { initBackup } from './backup.js';

const $ = (sel) => document.querySelector(sel);
const api = window.novaAPI;

/* ============================================================
 *  Toast Notification
 * ============================================================ */
let toastTimer = null;
export function toast(message, isError = false) {
  let el = $('#toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.style.borderColor = isError ? 'var(--danger)' : 'var(--accent)';
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2600);
}

/* ============================================================
 *  Modal Helper
 * ============================================================ */
export function openModal(html) {
  $('#modalContent').innerHTML = html;
  $('#modal').classList.remove('hidden');
}
export function closeModal() {
  $('#modal').classList.add('hidden');
  $('#modalContent').innerHTML = '';
}
export function currency() { return settings.currency || ''; }
export function fmt(n) { return Number(n || 0).toFixed(2); }

/* ============================================================
 *  View Router
 * ============================================================ */
const viewInitializers = {
  dashboard:  () => initDashboard.refresh?.(),
  pos:        () => initPOS.refresh?.(),
  inventory:  () => initInventory.refresh?.(),
  ledger:     () => initLedger.refresh?.(),
  sales:      () => initPOS.loadSalesHistory?.(),
  backup:     () => initBackup.refresh?.(),
  settings:   () => loadSettingsForm(),
};

export function switchView(name) {
  document.querySelectorAll('.tab').forEach(t =>
    t.classList.toggle('active', t.dataset.view === name));
  document.querySelectorAll('.view').forEach(v =>
    v.classList.toggle('active', v.id === `view-${name}`));
  viewInitializers[name]?.();
}

function initRouter() {
  $('#navTabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (tab) switchView(tab.dataset.view);
  });
}

/* ============================================================
 *  Settings
 * ============================================================ */
export let settings = {};

export async function loadSettings() {
  settings = await api.settings.getAll();
  $('#storeInfo').textContent = settings.store_name || 'Nova POS Store';
}

export async function loadSettingsForm() {
  await loadSettings();
  document.querySelectorAll('[data-setting]').forEach(inp => {
    inp.value = settings[inp.dataset.setting] ?? '';
  });
}

async function saveSettings() {
  const updates = {};
  document.querySelectorAll('[data-setting]').forEach(inp => {
    updates[inp.dataset.setting] = inp.value;
  });
  for (const [key, value] of Object.entries(updates)) {
    await api.settings.set(key, value);
  }
  await loadSettings();
  toast('Settings saved');
}

/* ============================================================
 *  Clock
 * ============================================================ */
function startClock() {
  const tick = () => {
    $('#clock').textContent = new Date().toLocaleString([], {
      dateStyle: 'medium', timeStyle: 'short'
    });
  };
  tick();
  setInterval(tick, 1000);
}

/* ============================================================
 *  Global Keyboard Shortcuts
 * ============================================================ */
function initShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeModal(); initPOS.focusBarcode(); return; }
    switch (e.key) {
      case 'F1': e.preventDefault(); switchView('dashboard'); break;
      case 'F2': e.preventDefault(); switchView('pos'); break;
      case 'F3': e.preventDefault(); switchView('inventory'); break;
      case 'F4': e.preventDefault(); switchView('ledger'); break;
      case 'F5': e.preventDefault(); switchView('sales'); break;
      case 'F6': e.preventDefault(); switchView('backup'); break;
      case 'F8': if ($('#view-pos').classList.contains('active')) { e.preventDefault(); initPOS.clearCart?.(); } break;
      case 'F9': if ($('#view-pos').classList.contains('active')) { e.preventDefault(); initPOS.completeSale?.(); } break;
    }
  });
}

/* ============================================================
 *  Bootstrap
 * ============================================================ */
async function boot() {
  initRouter();
  startClock();
  initShortcuts();

  $('#saveSettingsBtn').addEventListener('click', saveSettings);
  $('#modal').addEventListener('click', (e) => {
    if (e.target.id === 'modal') closeModal();
  });

  await loadSettings();
  initDashboard.init();
  initPOS.init();
  initInventory.init();
  initLedger.init();
  initBackup.init();
}

document.addEventListener('DOMContentLoaded', boot);
