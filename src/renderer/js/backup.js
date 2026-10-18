/* ============================================================
 *  Nova POS – Database Backup & Restore Logic
 *  src/renderer/js/backup.js
 * ============================================================ */

import { toast, fmt } from './app.js';

const api = window.novaAPI;
const $ = (sel) => document.querySelector(sel);

async function refresh() {
  const list = await api.backup.list();
  const body = $('#backupBody');
  if (!body) return;
  body.innerHTML = '';
  $('#backupEmpty')?.classList.toggle('hidden', list.length > 0);

  list.forEach(b => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${b.name}</td>
      <td>${new Date(b.created).toLocaleString()}</td>
      <td class="num">${(b.size / 1024).toFixed(1)} KB</td>
      <td>
        <div style="display: flex; gap: 4px;">
          <button class="btn small warning" data-restore-path="${b.path}">♻️ Restore</button>
          <button class="btn small" data-export-path="${b.path}">📤 Export</button>
        </div>
      </td>
    `;
    body.appendChild(tr);
  });
}

async function createBackup() {
  const res = await api.backup.create();
  if (res.success) {
    toast(`Backup created successfully`);
    refresh();
  } else {
    toast(`Backup failed: ${res.message}`, true);
  }
}

async function restoreBackup(filePath) {
  if (!confirm('WARNING: Restoring a backup will overwrite all current data. Continue?')) return;
  const res = await api.backup.restore(filePath);
  if (res.success) {
    toast(res.message);
  } else if (res.message !== 'Cancelled') {
    toast(`Restore failed: ${res.message}`, true);
  }
}

async function exportBackup(filePath) {
  if (!filePath) {
    toast('Please select a backup from the list to export', true);
    return;
  }
  const res = await api.backup.export(filePath);
  if (res.success) {
    toast(res.message);
  } else if (res.message !== 'Cancelled') {
    toast(`Export failed: ${res.message}`, true);
  }
}

async function importBackup() {
  const res = await api.backup.import();
  if (res.success) {
    toast(res.message);
    refresh();
  } else if (res.message !== 'Cancelled') {
    toast(`Import failed: ${res.message}`, true);
  }
}

function init() {
  $('#backupCreateBtn')?.addEventListener('click', createBackup);
  $('#backupRestoreBtn')?.addEventListener('click', () => restoreBackup());
  $('#backupImportBtn')?.addEventListener('click', importBackup);
  $('#backupTable')?.addEventListener('click', (e) => {
    const restorePath = e.target.dataset.restorePath;
    const exportPath = e.target.dataset.exportPath;
    if (restorePath) restoreBackup(restorePath);
    if (exportPath) exportBackup(exportPath);
  });
  refresh();
}

export const initBackup = { init, refresh };
