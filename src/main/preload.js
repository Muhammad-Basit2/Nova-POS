/* ============================================================
 *  Nova POS – Preload Script (Secure IPC Bridge)
 *  src/main/preload.js
 *
 *  Exposes a minimal API surface to the renderer via contextBridge.
 *  The renderer NEVER gets direct access to Node or Electron APIs.
 * ============================================================ */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('novaAPI', {

  /* ---- Dashboard --------------------------------------------- */
  dashboard: {
    getStats: () => ipcRenderer.invoke('dashboard:stats'),
  },

  /* ---- Items / Inventory ------------------------------------ */
  items: {
    getAll:    (filters)  => ipcRenderer.invoke('items:getAll', filters),
    getById:   (id)       => ipcRenderer.invoke('items:getById', id),
    create:    (data)     => ipcRenderer.invoke('items:create', data),
    update:    (id, data) => ipcRenderer.invoke('items:update', id, data),
    delete:    (id)       => ipcRenderer.invoke('items:delete', id),
    search:    (term)     => ipcRenderer.invoke('items:search', term),
    getCategories: ()     => ipcRenderer.invoke('items:getCategories'),
  },

  /* ---- POS / Sales ----------------------------------------- */
  sales: {
    create:    (saleData) => ipcRenderer.invoke('sales:create', saleData),
    getAll:    (filters)  => ipcRenderer.invoke('sales:getAll', filters),
    getById:   (id)       => ipcRenderer.invoke('sales:getById', id),
    getItems:  (saleId)   => ipcRenderer.invoke('sales:getItems', saleId),
  },

  /* ---- Customers ------------------------------------------- */
  customers: {
    getAll:    ()         => ipcRenderer.invoke('customers:getAll'),
    getById:   (id)       => ipcRenderer.invoke('customers:getById', id),
    create:    (data)     => ipcRenderer.invoke('customers:create', data),
    update:    (id, data) => ipcRenderer.invoke('customers:update', id, data),
    delete:    (id)       => ipcRenderer.invoke('customers:delete', id),
    getLedger: (id)       => ipcRenderer.invoke('customers:getLedger', id),
  },

  /* ---- Vendors --------------------------------------------- */
  vendors: {
    getAll:    ()         => ipcRenderer.invoke('vendors:getAll'),
    getById:   (id)       => ipcRenderer.invoke('vendors:getById', id),
    create:    (data)     => ipcRenderer.invoke('vendors:create', data),
    update:    (id, data) => ipcRenderer.invoke('vendors:update', id, data),
    delete:    (id)       => ipcRenderer.invoke('vendors:delete', id),
    getLedger: (id)       => ipcRenderer.invoke('vendors:getLedger', id),
  },

  /* ---- Ledger Transactions --------------------------------- */
  ledger: {
    addTransaction: (data) => ipcRenderer.invoke('ledger:addTransaction', data),
  },

  /* ---- Excel Import / Export ------------------------------- */
  excel: {
    importItems:  ()     => ipcRenderer.invoke('excel:importItems'),
    exportItems:  ()     => ipcRenderer.invoke('excel:exportItems'),
  },

  /* ---- Backup / Restore ------------------------------------ */
  backup: {
    create:   ()         => ipcRenderer.invoke('backup:create'),
    restore:  (filePath) => ipcRenderer.invoke('backup:restore', filePath),
    list:     ()         => ipcRenderer.invoke('backup:list'),
    export:   (filePath) => ipcRenderer.invoke('backup:export', filePath),
    import:   ()         => ipcRenderer.invoke('backup:import'),
  },

  /* ---- Data Management --------------------------------------- */
  data: {
    clearSales:     () => ipcRenderer.invoke('data:clearSales'),
    clearInventory: () => ipcRenderer.invoke('data:clearInventory'),
    clearLedger:    () => ipcRenderer.invoke('data:clearLedger'),
    clearAll:       () => ipcRenderer.invoke('data:clearAll'),
  },

  /* ---- Settings -------------------------------------------- */
  settings: {
    get:      (key)       => ipcRenderer.invoke('settings:get', key),
    set:      (key, val)  => ipcRenderer.invoke('settings:set', key, val),
    getAll:   ()          => ipcRenderer.invoke('settings:getAll'),
  },
});
