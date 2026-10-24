/* ============================================================
 *  Nova POS – IPC Handlers Bug Fix Verification Tests
 *  Verifies the invoice numbering fix (MAX vs COUNT) in ipcHandlers.js
 * ============================================================ */

const fs = require("fs");
const path = require("path");

const ipcSrc = fs.readFileSync(path.join(__dirname, "../src/main/ipcHandlers.js"), "utf8");

describe("ipcHandlers – invoice numbering fix", () => {
  it("uses MAX(id) instead of COUNT(*) for invoice number generation", () => {
    expect(ipcSrc).toContain("SELECT COALESCE(MAX(id), 0) AS max_id FROM sales");
    expect(ipcSrc).not.toContain("SELECT COUNT(*) AS cnt FROM sales");
  });

  it("constructs invoice number from prefix + max_id + 1", () => {
    expect(ipcSrc).toContain("String(last + 1).padStart(6, '0')");
  });
});

describe("ipcHandlers – module exports", () => {
  it("exports registerIpcHandlers", () => {
    expect(ipcSrc).toContain("module.exports = { registerIpcHandlers }");
  });
});
