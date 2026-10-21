/* ============================================================
 *  Nova POS – Main UI Router, Settings & Global Shortcuts
 *  src/renderer/js/app.js
 * ============================================================ */

import { initDashboard } from './dashboard.js';
import { initPOS } from './pos.js';
import { initInventory } from './inventory.js';
import { initCustomers } from './customers.js';
import { initVendors } from './vendors.js';
import { initPurchases } from './purchases.js';
import { initBackup } from './backup.js';
import { initDataManagement } from './dataManagement.js';

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
 *  Invoice Logo helper
 * ============================================================ */
/* Returns HTML for the invoice logo based on the current settings
   (logo_path/DataURL, logo_width, logo_height, logo_alignment).
   Returns '' when no logo is configured so templates stay clean.
   maxWidth clamps the logo for narrow thermal paper (default 80mm body = 62mm). */
export function printLogoHTML(alignOverride, maxWidth = 280) {
  let dataUrl = settings.logo_dataUrl || settings.logo_data_url;
  if (!dataUrl && settings.logo_path) {
    console.warn('invoiceLogo: logo_dataUrl not loaded, logo_path only:', settings.logo_path);
    return '';
  }
  if (!dataUrl) return '';
  const align = alignOverride || settings.logo_alignment || 'center';
  const width = parseInt(settings.logo_width, 10) || 120;
  const height = parseInt(settings.logo_height, 10) || 50;
  const textAlign = align === 'left' ? 'left' : align === 'right' ? 'right' : 'center';
  return `<div class="invoice-logo" style="text-align:${textAlign}; margin-bottom:4px;">
    <img src="${dataUrl}" alt="logo" style="max-width:${maxWidth}px; width:${width}px; height:${height}px; object-fit:contain;" />
  </div>`;
}

/* Cache the data URL in the settings so printLogoHTML can use them
   without extra async work in every template. */
export async function refreshInvoiceLogoData() {
  try {
    settings.logo_dataUrl = await api.logo.getDataUrl();
  } catch (_) {
    settings.logo_dataUrl = '';
  }
  return settings.logo_dataUrl;
}

/* ============================================================
 *  View Router
 * ============================================================ */
const viewInitializers = {
  purchases:  () => initPurchases.refresh?.(),
  dashboard:  () => initDashboard.refresh?.(),
  pos:        () => initPOS.refresh?.(),
  inventory:  () => initInventory.refresh?.(),
  purchases:  () => initPurchases.refresh?.(),
  suppliers:  () => initVendors.refresh?.(),
  sales:      () => initPOS.loadSalesHistory?.(),
  customers:  () => initCustomers.refresh?.(),
  suppliers:  () => initVendors.refresh?.(),
  settings:   () => loadSettingsForm(),
};

export function switchSettingsTab(tabName) {
  document.querySelectorAll('.settings-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.settingsTab === tabName));
  document.querySelectorAll('.settings-panel').forEach(p => {
    const isActive = p.id === `settings-panel-${tabName}`;
    p.classList.toggle('hidden', !isActive);
    p.classList.toggle('active', isActive);
  });
  if (tabName === 'backup') {
    initBackup.refresh?.();
  }
}

export function switchView(name, subTab) {
  document.querySelectorAll('.tab').forEach(t =>
    t.classList.toggle('active', t.dataset.view === name));
  document.querySelectorAll('.view').forEach(v =>
    v.classList.toggle('active', v.id === `view-${name}`));
  if (name === 'settings') {
    loadSettingsForm();
    switchSettingsTab(subTab || 'general');
  } else {
    viewInitializers[name]?.();
  }
}

function initRouter() {
  $('#navTabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (tab) switchView(tab.dataset.view);
  });
  document.addEventListener('click', (e) => {
    const st = e.target.closest('.settings-tab');
    if (st) switchSettingsTab(st.dataset.settingsTab);
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
  await refreshInvoiceLogoData();
  renderLogoPreview();
}

/* Show the current logo preview in Settings */
async function renderLogoPreview() {
  const img = $('#logoPreview');
  const empty = $('#logoPreviewEmpty');
  const dataUrl = await api.logo.getDataUrl();
  if (img) {
    img.src = dataUrl || '';
    img.classList.toggle('hidden', !dataUrl);
  }
  if (empty) {
    empty.classList.toggle('hidden', !!dataUrl);
  }
}

async function pickLogo() {
  const res = await api.logo.pick();
  if (res.success) {
    await refreshInvoiceLogoData();
    renderLogoPreview();
    toast('Logo selected. Click Save Settings to keep changes.');
  } else if (res.message !== 'Cancelled') {
    toast(res.message, true);
  }
}

async function removeLogo() {
  const res = await api.logo.remove();
  if (res.success) {
    await refreshInvoiceLogoData();
    renderLogoPreview();
    $('#logoWidth').value = '';
    $('#logoHeight').value = '';
    toast('Logo removed');
  } else {
    toast(res.message, true);
  }
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
  await refreshInvoiceLogoData();
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
      case 'F4': e.preventDefault(); switchView('purchases'); break;
      case 'F5': e.preventDefault(); switchView('sales'); break;
      case 'F6': e.preventDefault(); switchView('customers'); break;
      case 'F7': e.preventDefault(); switchView('suppliers'); break;
      case 'F8': e.preventDefault(); switchView('settings', 'backup'); break;
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
  const pickLogoBtn = $('#chooseLogoBtn');
  if (pickLogoBtn) pickLogoBtn.addEventListener('click', pickLogo);
  const removeLogoBtn = $('#removeLogoBtn');
  if (removeLogoBtn) removeLogoBtn.addEventListener('click', removeLogo);
  $('#modal').addEventListener('click', (e) => {
    if (e.target.id === 'modal') closeModal();
  });

  await loadSettings();
  await refreshInvoiceLogoData();
  initDashboard.init();
  initPOS.init();
   initPurchases.init();
  initInventory.init();
  initCustomers.init();
  initVendors.init();
  initBackup.init();
  initDataManagement.init();
}

document.addEventListener('DOMContentLoaded', boot);
