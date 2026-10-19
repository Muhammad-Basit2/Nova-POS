/* ===========================================================
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

    // Render Weekly Sales Chart
    const weeklySales = stats.weeklySales || [];
    const maxSales = Math.max(...weeklySales.map(d => d.total), 1);
    const weeklyTotalSum = weeklySales.reduce((acc, d) => acc + d.total, 0);
    $('#dashWeeklyTotal').textContent = `7-Day Total: ${fmt(weeklyTotalSum)} ${currency()}`;

    const chartBars = $('#dashSalesChart');
    const chartLabels = $('#dashSalesChartLabels');
    chartBars.innerHTML = '';
    chartLabels.innerHTML = '';

    weeklySales.forEach(day => {
      const heightPercent = Math.max((day.total / maxSales) * 100, 4);

      const col = document.createElement('div');
      col.className = 'chart-bar-col';
      col.innerHTML = `
        <div class="chart-tooltip">
          <strong>${day.label}</strong><br>
          Sales: ${fmt(day.total)} ${currency()}<br>
          Tx: ${day.count}
        </div>
        <div class="chart-bar-fill" style="height: ${heightPercent}%;"></div>
      `;
      chartBars.appendChild(col);

      const lbl = document.createElement('div');
      lbl.style.cssText = 'flex: 1; text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
      lbl.textContent = day.label.split(',')[0];
      chartLabels.appendChild(lbl);
    });

    // Render Category Sales Chart
    const categorySales = stats.categorySales || [];
    const maxCatTotal = Math.max(...categorySales.map(c => c.total), 1);
    const catContainer = $('#dashCategoryChart');
    catContainer.innerHTML = '';

    if (categorySales.length === 0) {
      catContainer.innerHTML = `<div class="empty-state" style="padding: 15px;">No sales data by category yet</div>`;
    } else {
      categorySales.forEach(cat => {
        const pct = Math.round((cat.total / maxCatTotal) * 100);
        const item = document.createElement('div');
        item.className = 'category-progress-item';
        item.innerHTML = `
          <div class="category-progress-info">
            <span style="font-weight: 500; color: var(--text);">${cat.category}</span>
            <span style="color: var(--accent); font-weight: 600;">${fmt(cat.total)} ${currency()}</span>
          </div>
          <div class="category-progress-track">
            <div class="category-progress-fill" style="width: ${pct}%;"></div>
          </div>
        `;
        catContainer.appendChild(item);
      });
    }

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