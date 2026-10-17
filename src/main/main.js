/* ============================================================
 *  Nova POS – Electron Main Process
 *  src/main/main.js
 * ============================================================ */

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { initDatabase } = require('./database');
const { registerIpcHandlers } = require('./ipcHandlers');

/* ---------- Global references -------------------------------- */
let mainWindow = null;
let db = null;

/* ---------- Create the main application window -------------- */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    title: 'Nova POS',
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false                   // required for better-sqlite3 in preload context
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  /* Open DevTools in dev mode (pass --dev flag) */
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/* ---------- App lifecycle ----------------------------------- */
app.whenReady().then(() => {
  /* Initialise database first – returns the db instance */
  db = initDatabase();

  /* Register all IPC handlers (pass db so handlers can query it) */
  registerIpcHandlers(ipcMain, db, dialog);

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (db) {
    try { db.close(); } catch (_) { /* already closed */ }
  }
});
