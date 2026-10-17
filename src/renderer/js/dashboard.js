/* ============================================================
 *  Nova POS – Dashboard Logic
 *  src/renderer/js/dashboard.js
 * ============================================================ */

import { fmt, currency } from './app.js';

const api = window.novaAPI;
const $ = (sel) => document.querySelector(sel);

async function loadDashboard() {
  try {
    const stats = await api.dashboard.getStats();
    $('#dashTodaySales').textContent = `${fmt(stats.todaySales)} ${currency()}`;
    $('#dashTxCount').textContent = `${stats.txCount} transactions today`;
    $('#dashTodayProfit').textContent = `${fmt(stats.todayProfit)} ${currency()}`;
    $('#dashLowStockCount').textContent = stats.lowStockItems.length;
    $('#dashTotalItems').textContent = stats.totalItems;

    const body = $('#dashLowStockBody');
    body.innerHTML = '';
    const empty = $('#dashLowStockEmpty');
    empty.classList.toggle('hidden', stats.lowStockItems.length > 0);

    stats.lowStockItems.forEach(i => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${i.barcode || '—'}</td>
        <td>${i.name}</td>
        <td>${i.category || '—'}</td>
        <td class="num" style="color:var(--danger); font-weight:600;">${i.stock}</td>
        <td class="num">${i.min_stock}</td>
        <td>${i.unit}</td>
      `;
      body.appendChild(tr);
    });
  } catch (err) {
    console.error('Failed to load dashboard stats:', err);
  }
}

function init() {
  loadDashboard();
}

export const initDashboard = {
  init, refresh: loadDashboard
};