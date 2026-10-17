# Nova POS

> Fast, offline Point of Sale & Inventory Management desktop application.

---

## Tech Stack

| Layer            | Technology                          |
| ---------------- | ----------------------------------- |
| Framework        | Electron.js                         |
| Frontend         | HTML5, CSS3, Plain JavaScript (ES6) |
| Database         | SQLite via `better-sqlite3`         |
| Excel Processing | `xlsx` (SheetJS)                    |
| IPC Security     | `contextBridge` + `preload.js`      |

---

## Folder Structure

```text
nova-pos-app/
├── src/
│   ├── main/
│   │   ├── main.js             # Electron main process & window lifecycle
│   │   ├── preload.js          # Secure IPC Bridge
│   │   ├── database.js         # SQLite connection & schema initialization
│   │   ├── excelHandler.js     # Excel import/export via SheetJS
│   │   └── ipcHandlers.js      # All DB & Settings IPC handlers
│   └── renderer/
│       ├── index.html          # Main UI layout
│       ├── css/
│       │   └── style.css       # Dark-mode responsive POS styling
│       └── js/
│           ├── app.js          # Main UI router, settings manager & shortcuts
│           ├── pos.js          # POS Cashier logic & barcode handling
│           ├── inventory.js    # Items management & Excel upload/export
│           ├── ledger.js       # Customer & Vendor ledger
│           └── backup.js       # Database backup/restore handlers
├── assets/                     # Store logo & default app icons
├── package.json
└── README.md
```

---

## Getting Started

### Prerequisites

- **Node.js** v18+ and **npm** v9+
- Windows 10/11 (primary target) – macOS/Linux also supported

### Installation

```bash
cd nova-pos-app
npm install
```

### Run in Development

```bash
npm run dev
```

### Run in Production Mode

```bash
npm start
```

---

## Features

- **POS Cashier** – Barcode-driven item entry, quantity editing, live totals, discount support, cash/credit payment with change calculation.
- **Inventory Management** – Full CRUD for items with category filtering, stock tracking, Excel bulk import/export.
- **Customer & Vendor Ledger** – Track receivables and payables with running balance calculations.
- **Sales History** – Browse, search, and filter past invoices.
- **Database Backup & Restore** – One-click SQLite file backup with timestamped copies; restore from any backup.
- **Offline-First** – Everything runs locally; no internet required.
- **Dark Mode UI** – Modern, responsive dark-themed interface optimised for touch and desktop.

---

## Keyboard Shortcuts

| Shortcut   | Action                        |
| ---------- | ----------------------------- |
| `F1`       | Switch to POS tab             |
| `F2`       | Switch to Inventory tab       |
| `F3`       | Switch to Ledger tab          |
| `F4`       | Switch to Sales History tab   |
| `F5`       | Switch to Backup tab          |
| `Escape`   | Return barcode focus (POS)    |

---

## License

MIT © Nova POS Team
