/* ============================================================
 *  Nova POS – POS Cashier Logic
 *  src/renderer/js/pos.js
 * ============================================================ */

import {
  toast,
  fmt,
  currency,
  openModal,
  closeModal,
  printLogoHTML,
} from "./app.js";

const api = window.novaAPI;
const $ = (sel) => document.querySelector(sel);

let cart = [];
let customers = [];
let searchHighlightedIndex = -1;
let searchResolvedItems = [];
let catalogHighlightedIndex = -1;
let catalogResolvedItems = [];
let catalogColumns = 3;
let catalogFocused = false; // true when grid navigation is active

// Cart keyboard navigation state
let cartFocusedRowIndex = -1;
let cartFocusedFieldIndex = -1; // 0 = qty input, -1 = no focus

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char],
  );
}

function invoiceItemName(item) {
  return `${escapeHtml(item.item_name)}${
    item.urdu_name
      ? `<span class="urdu-item-name" lang="ur" dir="rtl">${escapeHtml(item.urdu_name)}</span>`
      : ""
  }`;
}

function invoiceFontStyles() {
  return `
    @font-face {
      font-family: 'Gulzar';
      src: url('../../assets/fonts/Gulzar-Regular.ttf') format('truetype');
      font-style: normal;
      font-weight: 600;
    }
    .urdu-item-name {
      display: block;
      direction: rtl;
      text-align: right;
      font-family: 'Gulzar', 'Jameel Noori Nastaleeq', 'Urdu Typesetting', serif;
      font-size: 18px;
      line-height: 1.8;
      font-weight: 600;
    }
  `;
}

function renderCart() {
  const body = $("#cartBody");
  body.innerHTML = "";
  $("#cartEmpty").classList.toggle("hidden", cart.length > 0);

  cart.forEach((ci, idx) => {
    const tr = document.createElement("tr");
    tr.dataset.rowIndex = idx;
    tr.innerHTML = `
      <td class="cart-item-name">${invoiceItemName(ci)}</td>
      <td><input type="number" class="input small qty-input" step="0.01" min="0.01" value="${ci.quantity}" data-idx="${idx}" /></td>
      <td class="num cart-price">${fmt(ci.unit_price)}</td>
      <td class="num cart-line-total">${fmt(ci.line_total)}</td>
      <td><button class="btn danger small-btn" data-remove="${idx}">✘</button></td>
    `;
    body.appendChild(tr);
  });
  updateTotals();
}

function updateTotals() {
  const subtotal = cart.reduce((s, ci) => s + ci.line_total, 0);
  const discount = parseFloat($("#discountInput").value) || 0;
  const total = Math.max(subtotal - discount, 0);
  $("#subtotal").textContent = fmt(subtotal);
  $("#grandTotal").textContent = fmt(total);
  recalcChange();
}

function recalcChange() {
  const subtotal = cart.reduce((s, ci) => s + ci.line_total, 0);
  const discount = parseFloat($("#discountInput").value) || 0;
  const total = Math.max(subtotal - discount, 0);
  const paid = parseFloat($("#amountPaidInput").value) || 0;
  $("#changeDue").textContent = fmt(Math.max(paid - total, 0));
}

function addToCart(item) {
  const existing = cart.find((ci) => ci.item_id === item.id);
  if (existing) {
    existing.quantity += 1;
    existing.line_total = existing.quantity * existing.unit_price;
    existing.urdu_name = item.urdu_name || existing.urdu_name || "";
    existing.unit = item.unit || existing.unit || "";
  } else {
    cart.push({
      item_id: item.id,
      item_name: item.name,
      urdu_name: item.urdu_name || "",
      barcode: item.barcode || "",
      quantity: 1,
      unit: item.unit || "",
      unit_price: item.sale_price,
      line_total: item.sale_price,
    });
  }
  renderCart();
}

function removeFromCart(idx) {
  cart.splice(idx, 1);
  renderCart();
}

function setQuantity(idx, qty) {
  const q = Math.max(parseFloat(qty) || 0, 0.01);
  cart[idx].quantity = q;
  cart[idx].line_total = q * cart[idx].unit_price;
  renderCart();
}

let selectedCustomerId = null;

function selectCustomer(c) {
  selectedCustomerId = c.id;
  const inp = $("#customerSearchInput");
  if (inp) {
    inp.value = "";
    inp.classList.add("hidden");
  }
  $("#customerSearchResults")?.classList.add("hidden");
  const badge = $("#selectedCustomerBadge");
  const info = $("#selectedCustomerInfo");
  if (badge && info) {
    info.innerHTML = `<strong>${c.name}</strong> (${c.phone || "No phone"}) � Bal: <span style="color:${c.balance > 0 ? "var(--accent)" : "inherit"}">${fmt(c.balance)}</span>`;
    badge.classList.remove("hidden");
  }
  const walkIn = $("#walkInNameInput");
  if (walkIn) {
    walkIn.value = "";
    walkIn.classList.add("hidden");
  }
}

function clearSelectedCustomer() {
  selectedCustomerId = null;
  const inp = $("#customerSearchInput");
  if (inp) {
    inp.value = "";
    inp.classList.remove("hidden");
  }
  $("#selectedCustomerBadge")?.classList.add("hidden");
  const walkIn = $("#walkInNameInput");
  if (walkIn) {
    walkIn.value = "";
    walkIn.classList.remove("hidden");
    walkIn.disabled = false;
  }
}

function clearCart() {
  cart = [];
  $("#discountInput").value = 0;
  $("#amountPaidInput").value = 0;
  clearSelectedCustomer();
  renderCart();
  focusBarcode();
}

const PAYMENT_METHODS = ["cash", "credit"];
function togglePaymentMethod() {
  const sel = $("#paymentMethod");
  if (!sel) return;
  const idx = PAYMENT_METHODS.indexOf(sel.value);
  const next = PAYMENT_METHODS[(idx + 1) % PAYMENT_METHODS.length];
  sel.value = next;
  toast(`Payment: ${next.charAt(0).toUpperCase() + next.slice(1)}`);
}

let customerSearchTimer = null;
function handleCustomerSearch(term) {
  clearTimeout(customerSearchTimer);
  const box = $("#customerSearchResults");
  if (!box) return;
  if (!term) {
    box.classList.add("hidden");
    selectedCustomerId = null;
    return;
  }
  customerSearchTimer = setTimeout(() => {
    const matches = customers.filter(
      (c) =>
        c.name.toLowerCase().includes(term) ||
        (c.phone && String(c.phone).toLowerCase().includes(term)),
    );
    box.innerHTML = "";
    if (!matches.length) {
      box.innerHTML = `<div class="search-result-item" style="color:var(--text-dim); cursor:default;">No customers found</div>`;
      box.classList.remove("hidden");
      return;
    }
    matches.slice(0, 10).forEach((c) => {
      const div = document.createElement("div");
      div.className = "search-result-item";
      div.innerHTML = `<span><strong>${c.name}</strong> (${c.phone || "No phone"})</span><span style="color:${c.balance > 0 ? "var(--accent)" : "inherit"}">Bal: ${fmt(c.balance)}</span>`;
      div.addEventListener("click", () => {
        selectCustomer(c);
      });
      box.appendChild(div);
    });
    box.classList.remove("hidden");
  }, 150);
}

function focusBarcode() {
  $("#barcodeInput")?.focus();
}

function focusAmountPaid() {
  const el = $("#amountPaidInput");
  if (el) {
    el.focus();
    el.select();
  }
}

let searchTimer = null;
function showResults(term) {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    const items = await api.items.search(term);
    searchResolvedItems = items.slice(0, 12);
    const box = $("#searchResults");
    box.innerHTML = "";
    if (!searchResolvedItems.length) {
      searchHighlightedIndex = -1;
      box.classList.add("hidden");
      return;
    }
    searchResolvedItems.forEach((item, idx) => {
      const div = document.createElement("div");
      div.className = "search-result-item";
      div.dataset.index = idx;
      div.innerHTML = `<span>${item.name}</span><span>${fmt(item.sale_price)} ${currency()}</span>`;
      div.addEventListener("click", (e) => {
        e.stopPropagation();
        addToCart(item);
        hideResults();
        $("#barcodeInput").value = "";
        searchHighlightedIndex = -1;
        searchResolvedItems = [];
        focusBarcode();
      });
      box.appendChild(div);
    });
    box.classList.remove("hidden");
    highlightResult(0);
  }, 150);
}

function highlightResult(index) {
  const box = $("#searchResults");
  if (!box) return;
  const items = box.querySelectorAll(".search-result-item");
  items.forEach((el) => el.classList.remove("search-result-focused"));
  if (index < 0 || index >= items.length) {
    searchHighlightedIndex = -1;
    return;
  }
  searchHighlightedIndex = index;
  const el = items[index];
  el.classList.add("search-result-focused");
  el.scrollIntoView({ block: "nearest" });
}

function highlightCatalogCard(index) {
  const grid = $("#posProductsGrid");
  if (!grid) return;
  const cards = grid.querySelectorAll(".pos-product-card");
  cards.forEach((el) => el.classList.remove("pos-product-focused"));
  if (index < 0 || index >= cards.length || cards.length === 0) {
    catalogHighlightedIndex = -1;
    catalogFocused = false;
    return;
  }
  catalogHighlightedIndex = index;
  catalogFocused = true;
  const card = cards[index];
  card.classList.add("pos-product-focused");
  card.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function clearCatalogFocus() {
  catalogHighlightedIndex = -1;
  catalogFocused = false;
  const grid = $("#posProductsGrid");
  grid?.querySelectorAll(".pos-product-card").forEach((el) =>
    el.classList.remove("pos-product-focused")
  );
}

function detectCatalogColumns() {
  const grid = $("#posProductsGrid");
  const cards = grid?.querySelectorAll(".pos-product-card") || [];
  if (cards.length === 0) return 3;
  const firstLeft = cards[0].offsetLeft;
  for (let i = 1; i < cards.length; i++) {
    if (cards[i].offsetLeft !== firstLeft) return i;
  }
  return cards.length;
}

function getCatalogGridPos(index) {
  const cols = Math.max(catalogColumns, 1);
  return { row: Math.floor(index / cols), col: index % cols, cols };
}

function hideResults() {
  searchHighlightedIndex = -1;
  searchResolvedItems = [];
  $("#searchResults").classList.add("hidden");
}

async function tryBarcodeSubmit(barcode) {
  if (!barcode) return;
  const items = await api.items.search(barcode);
  const exact = items.find((i) => i.barcode === barcode) || items[0];
  if (exact) {
    addToCart(exact);
    $("#barcodeInput").value = "";
  } else {
    toast(`Item not found: ${barcode}`, true);
  }
  focusBarcode();
}

async function printThermalReceipt(saleId) {
  try {
    const sale = await api.sales.getById(saleId);
    const items = await api.sales.getItems(saleId);
    const allSettings = await api.settings.getAll();

    const storeName = allSettings.store_name || "Nova POS Store";
    const storePhone = allSettings.store_phone || "";
    const storeAddress = allSettings.store_address || "";
    const receiptFooter =
      allSettings.receipt_footer || "Thank you for shopping with us!";
    const curr = allSettings.currency || "";

    let custDisplay = sale.customer_name;
    if (!custDisplay) {
      if (sale.notes && sale.notes.startsWith("Walk-in:")) {
        custDisplay = sale.notes;
      } else {
        custDisplay = "Walk-in Customer";
      }
    }

    const itemsRows = items
      .map(
        (i) => `
      <tr>
        <td style="text-align:left; padding:2px 0;"><strong>${invoiceItemName(i)}</strong></td>
        <td style="text-align:center; padding:2px 0;"></td>
        <td style="text-align:right; padding:2px 0;"></td>
        <td style="text-align:right; padding:2px 0;"></td>
      </tr>
      <tr>
        <td style="text-align:left; padding-bottom:4px; color:#555;"></td>
        <td style="text-align:center; padding-bottom:4px;">${i.quantity}${i.unit ? " " + i.unit : ""}</td>
        <td style="text-align:right; padding-bottom:4px;">${fmt(i.unit_price)}</td>
        <td style="text-align:right; padding-bottom:4px; font-weight:600;">${fmt(i.line_total)}</td>
      </tr>
    `,
      )
      .join("");

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Receipt ${sale.invoice_no}</title>
        <style>
          @page { size: 80mm auto; margin: 0; }
          ${invoiceFontStyles()}
          body {
            font-family: 'Roboto', sans-serif;
            font-size: 16px;
            width: 72mm;
            margin: 0 auto;
            padding: 3mm;
            color: #000;
            background: #fff;
            line-height: 1.4;
          }
          .center { text-align: center; }
          .right { text-align: right; }
          .bold { font-weight: bold; }
          .divider { border-top: 1px dashed #000; margin: 7px 0; }
          table { width: 100%; border-collapse: collapse; }
          td { font-size: 13px; }
          .totals-table td { padding: 2px 0; }
          .footer { margin-top: 10px; text-align: center; font-size: 11px; }
          th { font-weight: bold; font-size: 12px; text-transform: uppercase; letter-spacing: .5px; }
          .item-total { font-weight: bold; }
          .meta-label { font-weight: bold; }
          .section-title { text-align: center; font-size: 17px; font-weight: 800; letter-spacing: 2px; margin: 4px 0; }
          .store-name { font-size: 19px; font-weight: 800; margin-bottom: 2px; letter-spacing: .5px; }
          .store-meta { font-size: 12px; }
          .divider-thick { border-top: 2px solid #000; margin: 8px 0; }
          .divider-thin { border-top: 1px solid #000; margin-top: -5px; margin-bottom: 8px; }
          .total-row { font-size: 15px; font-weight: 800; }
          .balance-row { font-size: 13px; font-weight: bold; }
        </style>
      </head>
      <body>
        <div class="center store-name">${storeName}</div>
        ${printLogoHTML(null, 300)}
        <div class="center store-meta">${[storeAddress, storePhone ? "Tel: " + storePhone : null].filter(Boolean).join(", ")}</div>

        <div class="divider-thick"></div>
        <div class="divider-thin"></div>

        <div class="section-title">RECEIPT</div>
        <div><span class="meta-label">Date:</span> ${sale.created_at}</div>
        <div><span class="meta-label">Invoice:</span> ${sale.invoice_no}</div>
        <div><span class="meta-label">Customer:</span> ${custDisplay}</div>
        <div><span class="meta-label">Payment:</span> ${sale.payment_method.toUpperCase()}</div>

        <div class="divider"></div>

        <table>
          <thead>
            <tr>
              <th style="text-align:left; padding:2px 0;">Description</th>
              <th style="text-align:center; padding:2px 0;">Qty</th>
              <th style="text-align:right; padding:2px 0;">Price</th>
              <th style="text-align:right; padding:2px 0;">Total</th>
            </tr>
          </thead>
          <tbody>
            ${itemsRows}
          </tbody>
        </table>

        <div class="divider"></div>

        <table class="totals-table">
          <tr>
            <td>Subtotal:</td>
            <td class="right">${fmt(sale.subtotal)} ${curr}</td>
          </tr>
          ${
            sale.discount > 0
              ? `<tr>
            <td>Discount:</td>
            <td class="right">-${fmt(sale.discount)} ${curr}</td>
          </tr>`
              : `
          <tr>
            <td>Discount:</td>
            <td class="right">0.00 ${curr}</td>
          </tr>`
          }
          <tr class="total-row">
            <td>TOTAL:</td>
            <td class="right">${fmt(sale.total)} ${curr}</td>
          </tr>
          <tr>
            <td>Amount Paid:</td>
            <td class="right">${fmt(sale.amount_paid)} ${curr}</td>
          </tr>
          ${
            Math.max(sale.total - sale.amount_paid, 0) > 0
              ? `<tr class="bold">
            <td>Balance Due:</td>
            <td class="right">${fmt(Math.max(sale.total - sale.amount_paid, 0))} ${curr}</td>
          </tr>`
              : ""
          }
          ${
            sale.change_due > 0
              ? `<tr>
            <td>Change Due:</td>
            <td class="right">${fmt(sale.change_due)} ${curr}</td>
          </tr>`
              : ""
          }
          ${
            sale.customer_id
              ? `<tr>
            <td>Prev Balance:</td>
            <td class="right">${fmt(Math.max((sale.customer_balance || 0) - Math.max(sale.total - sale.amount_paid, 0), 0))} ${curr}</td>
          </tr>
          <tr class="bold">
            <td>Updated Balance:</td>
            <td class="right">${fmt(sale.customer_balance || 0)} ${curr}</td>
          </tr>`
              : ""
          }
        </table>

        <div class="divider-thick"></div>
        <div class="divider-thin"></div>

        <div class="footer">
          ${receiptFooter.toUpperCase()}<br>
          ${storePhone ? `<div style="font-size: 11px;">Visit again! Tel: ${storePhone}</div>` : ""}
          <br><span style="font-size: 10px; color: #111111;">Powered by Basit | 0340 1358760</span>
        </div>
      </body>
      </html>
    `;

    let printFrame = document.getElementById("thermalPrintFrame");
    if (!printFrame) {
      printFrame = document.createElement("iframe");
      printFrame.id = "thermalPrintFrame";
      printFrame.style.cssText =
        "position: fixed; width: 80mm; height: 100vh; border: none; left: -9999px; top: 0; opacity: 0; pointer-events: none;";
      document.body.appendChild(printFrame);
    }

    const frameDoc = printFrame.contentWindow.document;
    frameDoc.open();
    frameDoc.write(html);
    frameDoc.close();

    setTimeout(async () => {
      try {
        await printFrame.contentDocument.fonts.ready;
        printFrame.contentWindow.focus();
        printFrame.contentWindow.print();
      } catch (e) {
        console.error("Print invocation error:", e);
      }
    }, 250);
  } catch (err) {
    console.error("Thermal print failed:", err);
    toast("Failed to print thermal receipt", true);
  }
}

function getCartContext() {
  const subtotal = cart.reduce((s, ci) => s + ci.line_total, 0);
  const discount = parseFloat($("#discountInput").value) || 0;
  const total = Math.max(subtotal - discount, 0);
  const paid = parseFloat($("#amountPaidInput").value) || 0;
  const payment_method = $("#paymentMethod")?.value || "cash";
  const balanceDue = Math.max(total - paid, 0);

  const customerInputVal = $("#customerSearchInput")?.value.trim() || "";
  let walkInName = $("#walkInNameInput")?.value.trim() || "";

  let custDisplay = "Walk-in Customer";
  let custObj = null;
  if (selectedCustomerId) {
    custObj = customers.find((c) => c.id === selectedCustomerId);
    if (custObj)
      custDisplay = `${custObj.name}${custObj.phone ? " (" + custObj.phone + ")" : ""}`;
  } else if (walkInName) {
    custDisplay = `Walk-in: ${walkInName}`;
  } else if (customerInputVal) {
    custObj = customers.find(
      (c) => c.name.toLowerCase() === customerInputVal.toLowerCase(),
    );
    custDisplay = customerInputVal;
  }

  const prevBalance = custObj ? custObj.balance : 0;
  const updatedBalance = prevBalance + balanceDue;

  return {
    invoice_no: "DRAFT / PREVIEW",
    created_at: new Date().toLocaleString(),
    customer_name: custDisplay,
    customer_id: custObj ? custObj.id : null,
    customer_balance: updatedBalance,
    prev_balance: prevBalance,
    payment_method,
    subtotal,
    discount,
    total,
    amount_paid: paid,
    balance_due: balanceDue,
    change_due: Math.max(paid - total, 0),
  };
}

async function printCartThermalReceipt() {
  if (!cart.length) {
    toast("Cart is empty", true);
    return;
  }
  try {
    const sale = getCartContext();
    const allSettings = await api.settings.getAll();

    const storeName = allSettings.store_name || "Nova POS Store";
    const storePhone = allSettings.store_phone || "";
    const storeAddress = allSettings.store_address || "";
    const receiptFooter =
      allSettings.receipt_footer || "Thank you for shopping with us!";
    const curr = allSettings.currency || "";

    const itemsRows = cart
      .map(
        (i) => `
      <tr>
        <td style="text-align:left; padding:2px 0;"><strong>${invoiceItemName(i)}</strong></td>
        <td style="text-align:center; padding:2px 0;"></td>
        <td style="text-align:right; padding:2px 0;"></td>
      </tr>
      <tr>
        <td style="text-align:left; padding-bottom:4px; color:#555;"></td>
        <td style="text-align:center; padding-bottom:4px;">${i.quantity}${i.unit ? " " + i.unit : ""}</td>
        <td style="text-align:right; padding-bottom:4px; font-weight:600;">${fmt(i.line_total)}</td>
      </tr>
    `,
      )
      .join("");

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Receipt Draft</title>
        <style>
          @page { size: 80mm auto; margin: 0; }
          ${invoiceFontStyles()}
          body {
            font-family: 'Roboto', sans-serif;
            font-size: 16px;
            width: 72mm;
            margin: 0 auto;
            padding: 3mm;
            color: #000;
            background: #fff;
            line-height: 1.4;
          }
          .center { text-align: center; }
          .right { text-align: right; }
          .bold { font-weight: bold; }
          .divider { border-top: 1px dashed #000; margin: 7px 0; }
          table { width: 100%; border-collapse: collapse; }
          td { font-size: 13px; }
          .totals-table td { padding: 2px 0; }
          .footer { margin-top: 10px; text-align: center; font-size: 11px; }
          th { font-weight: bold; font-size: 12px; text-transform: uppercase; letter-spacing: .5px; }
          .item-total { font-weight: bold; }
          .meta-label { font-weight: bold; }
          .section-title { text-align: center; font-size: 17px; font-weight: 800; letter-spacing: 2px; margin: 4px 0; }
          .store-name { font-size: 19px; font-weight: 800; margin-bottom: 2px; letter-spacing: .5px; }
          .store-meta { font-size: 12px; }
          .divider-thick { border-top: 2px solid #000; margin: 8px 0; }
          .divider-thin { border-top: 1px solid #000; margin-top: -5px; margin-bottom: 8px; }
          .total-row { font-size: 15px; font-weight: 800; }
          .balance-row { font-size: 13px; font-weight: bold; }
          th { font-weight: bold; font-size: 12px; text-transform: uppercase; letter-spacing: .5px; }
          .item-total { font-weight: bold; }
          .meta-label { font-weight: bold; }
          .section-title { text-align: center; font-size: 17px; font-weight: 800; letter-spacing: 2px; margin: 4px 0; }
          .store-name { font-size: 19px; font-weight: 800; margin-bottom: 2px; letter-spacing: .5px; }
          .store-meta { font-size: 12px; }
          .divider-thick { border-top: 2px solid #000; margin: 8px 0; }
          .divider-thin { border-top: 1px solid #000; margin-top: -5px; margin-bottom: 8px; }
          .total-row { font-size: 15px; font-weight: 800; }
          .balance-row { font-size: 13px; font-weight: bold; }
        </style>
      </head>
      <body>
        <div class="center store-name">${storeName}</div>
        ${printLogoHTML(null, 300)}
        ${storeAddress || storePhone ? `<div class="center store-meta">${[storeAddress, storePhone ? "Tel: " + storePhone : null].filter(Boolean).join(", ")}</div>` : ""}

        <div class="divider-thick"></div>
        <div class="divider-thin"></div>

        <div><span class="meta-label">Date:</span> ${sale.created_at}</div>
        <div><span class="meta-label">Customer:</span> ${sale.customer_name}</div>
        <div><span class="meta-label">Payment:</span> ${sale.payment_method.toUpperCase()}</div>

        <div class="divider"></div>

        <table>
          <thead>
            <tr>
              <th style="text-align:left; padding:2px 0; width: 45%;">Description</th>
              <th style="text-align:center; padding:2px 0; width: 15%;">Qty</th>
              <th style="text-align:right; padding:2px 0; width: 40%;">Total</th>
            </tr>
          </thead>
          <tbody>
            ${itemsRows}
          </tbody>
        </table>

        <div class="divider"></div>

        <table class="totals-table">
          <tr>
            <td>Subtotal:</td>
            <td class="right">${fmt(sale.subtotal)} ${curr}</td>
          </tr>
          ${
            sale.discount > 0
              ? `<tr>
            <td>Discount:</td>
            <td class="right">-${fmt(sale.discount)} ${curr}</td>
          </tr>`
              : `<tr><td>Discount:</td><td class="right">0.00 ${curr}</td></tr>`
          }
          <tr class="total-row">
            <td>TOTAL:</td>
            <td class="right">${fmt(sale.total)} ${curr}</td>
          </tr>
          <tr>
            <td>Amount Paid:</td>
            <td class="right">${fmt(sale.amount_paid)} ${curr}</td>
          </tr>
          ${
            sale.balance_due > 0
              ? `<tr class="balance-row">
            <td>Balance Due:</td>
            <td class="right">${fmt(sale.balance_due)} ${curr}</td>
          </tr>`
              : ""
          }
          ${
            sale.change_due > 0
              ? `<tr>
            <td>Change Due:</td>
            <td class="right">${fmt(sale.change_due)} ${curr}</td>
          </tr>`
              : ""
          }
          ${
            sale.customer_id
              ? `<tr>
            <td>Prev Balance:</td>
            <td class="right">${fmt(sale.prev_balance)} ${curr}</td>
          </tr>
          <tr class="bold">
            <td>Updated Balance:</td>
            <td class="right">${fmt(sale.customer_balance)} ${curr}</td>
          </tr>`
              : ""
          }
        </table>

        <div class="divider-thick"></div>
        <div class="divider-thin"></div>

        <div class="footer">
          ${receiptFooter.toUpperCase()}<br>
          ${storePhone ? `<div style="font-size: 11px;">Visit again! Tel: ${storePhone}</div>` : ""}
          <br><span style="font-size: 10px; color: #555;">Powered by Basit | 0340 1358760</span>
        </div>
      </body>
      </html>
    `;

    let printFrame = document.getElementById("thermalPrintFrame");
    if (!printFrame) {
      printFrame = document.createElement("iframe");
      printFrame.id = "thermalPrintFrame";
      printFrame.style.cssText =
        "position: fixed; width: 80mm; height: 100vh; border: none; left: -9999px; top: 0; opacity: 0; pointer-events: none;";
      document.body.appendChild(printFrame);
    }

    const frameDoc = printFrame.contentWindow.document;
    frameDoc.open();
    frameDoc.write(html);
    frameDoc.close();

    setTimeout(async () => {
      try {
        await printFrame.contentDocument.fonts.ready;
        printFrame.contentWindow.focus();
        printFrame.contentWindow.print();
      } catch (e) {
        console.error("Print invocation error:", e);
      }
    }, 250);
  } catch (err) {
    console.error("Thermal print failed:", err);
    toast("Failed to print thermal receipt", true);
  }
}

async function previewCartInvoice() {
  if (!cart.length) {
    toast("Cart is empty", true);
    return;
  }
  const sale = getCartContext();
  const allSettings = await api.settings.getAll();

  const storeName = allSettings.store_name || "Nova POS Store";
  const storePhone = allSettings.store_phone || "";
  const storeAddress = allSettings.store_address || "";
  const receiptFooter =
    allSettings.receipt_footer || "Thank you for shopping with us!";
  const curr = allSettings.currency || "";

  const itemsRows = cart
    .map(
      (i) => `
    <tr>
      <td style="text-align:left; padding:2px 0;"><strong>${invoiceItemName(i)}</strong></td>
      <td style="text-align:center; padding:2px 0;"></td>
      <td style="text-align:right; padding:2px 0;"></td>
    </tr>
    <tr>
      <td style="text-align:left; padding-bottom:4px; color:#555;"></td>
      <td style="text-align:center; padding-bottom:4px;">${i.quantity}${i.unit ? " " + i.unit : ""}</td>
      <td style="text-align:right; padding-bottom:4px; font-weight:600;">${fmt(i.line_total)}</td>
    </tr>
  `,
    )
    .join("");

  const receiptHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        ${invoiceFontStyles()}
        body {
        font-family: 'Roboto', sans-serif;
          font-size: 16px;
          width: 72mm;
          margin: 0 auto;
          padding: 3mm;
          color: #000;
          background: #fff;
          line-height: 1.4;
        }
        .center { text-align: center; }
        .right { text-align: right; }
        .bold { font-weight: bold; }
        .divider { border-top: 1px dashed #000; margin: 7px 0; }
        table { width: 100%; border-collapse: collapse; }
        td { font-size: 13px; }
        .totals-table td { padding: 2px 0; }
        .footer { margin-top: 10px; text-align: center; font-size: 11px; }
        th { font-weight: bold; font-size: 12px; text-transform: uppercase; letter-spacing: .5px; }
        .item-total { font-weight: bold; }
        .meta-label { font-weight: bold; }
        .section-title { text-align: center; font-size: 17px; font-weight: 800; letter-spacing: 2px; margin: 4px 0; }
        .store-name { font-size: 19px; font-weight: 800; margin-bottom: 2px; letter-spacing: .5px; }
        .store-meta { font-size: 12px; }
        .divider-thick { border-top: 2px solid #000; margin: 8px 0; }
        .divider-thin { border-top: 1px solid #000; margin-top: -5px; margin-bottom: 8px; }
        .total-row { font-size: 15px; font-weight: 800; }
        .balance-row { font-size: 13px; font-weight: bold; }
      </style>
    </head>
    <body>
      <div class="center store-name">${storeName}</div>
      ${printLogoHTML(null, 300)}
      ${storeAddress || storePhone ? `<div class="center store-meta">${[storeAddress, storePhone ? "Tel: " + storePhone : null].filter(Boolean).join(", ")}</div>` : ""}

      <div class="divider-thick"></div>
      <div class="divider-thin"></div>

      <div><span class="meta-label">Date:</span> ${sale.created_at}</div>
      <div><span class="meta-label">Customer:</span> ${sale.customer_name}</div>
      <div><span class="meta-label">Payment:</span> ${sale.payment_method.toUpperCase()}</div>

      <div class="divider"></div>

      <table>
        <thead>
          <tr>
            <th style="text-align:left; padding:2px 0; width: 45%;">Description</th>
            <th style="text-align:center; padding:2px 0; width: 15%;">Qty</th>
            <th style="text-align:right; padding:2px 0; width: 40%;">Total</th>
          </tr>
        </thead>
        <tbody>
          ${itemsRows}
        </tbody>
      </table>

      <div class="divider"></div>

      <table class="totals-table">
        <tr>
          <td>Subtotal:</td>
          <td class="right">${fmt(sale.subtotal)} ${curr}</td>
        </tr>
        ${
          sale.discount > 0
            ? `<tr>
          <td>Discount:</td>
          <td class="right">-${fmt(sale.discount)} ${curr}</td>
        </tr>`
            : `<tr><td>Discount:</td><td class="right">0.00 ${curr}</td></tr>`
        }
        <tr class="total-row">
          <td>TOTAL:</td>
          <td class="right">${fmt(sale.total)} ${curr}</td>
        </tr>
        <tr>
          <td>Amount Paid:</td>
          <td class="right">${fmt(sale.amount_paid)} ${curr}</td>
        </tr>
        ${
          sale.balance_due > 0
            ? `<tr class="bold">
          <td>Balance Due:</td>
          <td class="right">${fmt(sale.balance_due)} ${curr}</td>
        </tr>`
            : ""
        }
        ${
          sale.change_due > 0
            ? `<tr>
          <td>Change Due:</td>
          <td class="right">${fmt(sale.change_due)} ${curr}</td>
        </tr>`
            : ""
        }
        ${
          sale.customer_id
            ? `<tr>
          <td>Prev Balance:</td>
          <td class="right">${fmt(sale.prev_balance)} ${curr}</td>
        </tr>
        <tr class="bold">
          <td>Updated Balance:</td>
          <td class="right">${fmt(sale.customer_balance)} ${curr}</td>
        </tr>`
            : ""
        }
      </table>

      <div style="border-top: 2px solid #000; margin: 8px 0;"></div>
      <div style="border-top: 1px solid #000; margin-top: -5px; margin-bottom: 8px;"></div>

      <div class="footer">
        ${receiptFooter.toUpperCase()}<br>
        ${storePhone ? `<div style="font-size: 11px;">Visit again! Tel: ${storePhone}</div>` : ""}
        <br><span style="font-size: 12px; font-weight: bold; color: #000000;">Powered by Basit | 0340 1358760</span>
      </div>
    </body>
    </html>
  `;

  openModal(`
    <h3 style="margin-bottom: 10px;">🧾 Invoice Preview (Draft)</h3>
    <div style="background: #fff; border-radius: 8px; padding: 0; display: flex; justify-content: center; max-height: 60vh; overflow-y: auto;">
      <iframe id="invoicePreviewFrame" style="width: 82mm; min-height: 420px; border: none; background: #fff; border-radius: 8px;" scrolling="no"></iframe>
    </div>
    <div class="modal-actions" style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 14px;">
      <button class="btn primary" id="previewPrintThermalBtn">🖨️ Print</button>
      <button class="btn" id="closePreviewModal">Close</button>
    </div>
  `);

  // Write receipt HTML into the preview iframe
  const previewFrame = document.getElementById("invoicePreviewFrame");
  const frameDoc = previewFrame.contentWindow.document;
  frameDoc.open();
  frameDoc.write(receiptHtml);
  frameDoc.close();

  // Auto-resize iframe to fit content
  previewFrame.addEventListener("load", () => {
    try {
      const contentHeight =
        previewFrame.contentWindow.document.body.scrollHeight;
      previewFrame.style.height = contentHeight + "px";
    } catch (e) {
      /* ignore */
    }
  });
  // Also try resizing after a short delay (fallback)
  setTimeout(() => {
    try {
      const contentHeight =
        previewFrame.contentWindow.document.body.scrollHeight;
      previewFrame.style.height = contentHeight + "px";
    } catch (e) {
      /* ignore */
    }
  }, 100);

  document
    .getElementById("closePreviewModal")
    .addEventListener("click", closeModal);
  document
    .getElementById("previewPrintThermalBtn")
    .addEventListener("click", () => {
      printCartThermalReceipt();
    });
}

async function completeSale() {
  if (!cart.length) {
    toast("Cart is empty", true);
    return;
  }
  const subtotal = cart.reduce((s, ci) => s + ci.line_total, 0);
  const discount = parseFloat($("#discountInput").value) || 0;
  const total = Math.max(subtotal - discount, 0);
  const paid = parseFloat($("#amountPaidInput").value) || 0;
  const payment_method = $("#paymentMethod").value;
  const remainingBalance = Math.max(total - paid, 0);

  const customerInputVal = $("#customerSearchInput")?.value.trim() || "";
  let customer_id = selectedCustomerId;
  let walkInName = $("#walkInNameInput")?.value.trim() || "";

  if (!customer_id && customerInputVal) {
    const found = customers.find(
      (c) =>
        c.name.toLowerCase() === customerInputVal.toLowerCase() ||
        (c.phone && c.phone === customerInputVal) ||
        `${c.name}${c.phone ? " (" + c.phone + ")" : ""}`.toLowerCase() ===
          customerInputVal.toLowerCase() ||
        c.name.toLowerCase().includes(customerInputVal.toLowerCase()) ||
        (c.phone && c.phone.includes(customerInputVal)),
    );
    if (found) {
      customer_id = found.id;
    } else if (!walkInName) {
      walkInName = customerInputVal;
    }
  }

  if (remainingBalance > 0 && !customer_id) {
    toast(
      "Please select a customer for partial payments / remaining balance",
      true,
    );
    return;
  }

  if (payment_method === "cash" && paid < total && !customer_id) {
    toast("Insufficient amount paid", true);
    return;
  }

  let notes = "";
  if (!customer_id && walkInName) {
    notes = `Walk-in: ${walkInName}`;
  }

  const sale = await api.sales.create({
    items: cart,
    customer_id: customer_id || null,
    discount,
    amount_paid: paid,
    payment_method,
    notes,
  });

  if (sale) {
    toast(`Sale completed � Invoice ${sale.invoice_no}`);
    clearCart();
    loadCatalog();

    openModal(`
      <div style="text-align: center; padding: 10px 0;">
        <div style="font-size: 36px; margin-bottom: 8px;">✅</div>
        <h3>Sale Completed!</h3>
        <p style="color: var(--text-dim); margin-bottom: 14px;">Invoice: <strong>${sale.invoice_no}</strong></p>
        <div style="display: flex; gap: 10px; justify-content: center;">
          <button class="btn primary" id="postPrintThermalBtn">🖨️ Print Thermal Receipt</button>
          <button class="btn" id="postCloseModal">Done / New Sale</button>
        </div>
      </div>
    `);
    document
      .getElementById("postCloseModal")
      .addEventListener("click", closeModal);
    document
      .getElementById("postPrintThermalBtn")
      .addEventListener("click", () => {
        printThermalReceipt(sale.id);
        closeModal();
      });
  } else {
    toast("Failed to record sale", true);
  }
}

async function loadSalesHistory() {
  const from = $("#salesFrom").value;
  const to = $("#salesTo").value;
  const sales = await api.sales.getAll({
    from: from || undefined,
    to: to ? to + " 23:59:59" : undefined,
  });
  const body = $("#salesBody");
  body.innerHTML = "";
  $("#salesEmpty").classList.toggle("hidden", sales.length > 0);
  sales.forEach((s) => {
    const tr = document.createElement("tr");
    let custDisplay = s.customer_name;
    if (!custDisplay) {
      if (s.notes && s.notes.startsWith("Walk-in:")) {
        custDisplay = s.notes;
      } else {
        custDisplay = "Walk-in";
      }
    }
    tr.innerHTML = `
      <td>${s.invoice_no}</td><td>${s.created_at}</td>
      <td>${custDisplay}</td>
      <td class="num">${fmt(s.total)}</td><td class="num">${fmt(s.amount_paid)}</td>
      <td>${s.payment_method}</td>
      <td><span class="return-badge ${s.status === 'PARTIAL_RETURN' ? 'PARTIAL_RETURN' : s.status === 'RETURNED' ? 'RETURNED' : ''}">${s.status || 'PAID'}</span></td>
      <td>
        <button class="btn small-btn" data-view-sale="${s.id}">View</button>
        ${(s.status !== 'RETURNED') ? `<button class="btn small-btn" style="color:var(--warning)" data-return-sale="${s.id}">🔄 Return</button>` : ''}
      </td>
    `;
    body.appendChild(tr);
  });
}

async function viewSale(id) {
  const sale = await api.sales.getById(id);
  const items = await api.sales.getItems(id);
  const returns = await api.sales.getReturns(id);
  const rows = items
    .map(
      (i) =>
        `<tr><td>${invoiceItemName(i)}</td><td class="num">${fmt(i.quantity)}${i.unit ? " " + i.unit : ""}</td><td class="num">${fmt(i.unit_price)}</td><td class="num">${fmt(i.line_total)}</td></tr>`,
    )
    .join("");

  const balanceDue = Math.max(sale.total - sale.amount_paid, 0);
  const currBal = sale.customer_balance || 0;
  const prevBal = sale.customer_id ? Math.max(currBal - balanceDue, 0) : 0;

  const returnsHtml = returns.length > 0
    ? `<details style="margin-top:10px">
        <summary style="cursor:pointer;color:var(--accent);font-weight:600">🔄 Returns (${returns.length}) — Total refunded: ${fmt(returns.reduce((s,r)=>s+r.total_refund,0))}</summary>
        <table class="table" style="margin-top:6px;font-size:12px">
          <thead><tr><th>Return #</th><th>Date</th><th>Items</th><th>Refund</th></tr></thead>
          <tbody>
            ${returns.map(r => `<tr>
              <td>${r.return_no}</td>
              <td>${r.created_at}</td>
              <td>${r.items_summary || '—'}</td>
              <td class="num" style="color:var(--success)">${fmt(r.total_refund)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </details>`
    : '';

  openModal(`
    <h3>Invoice ${sale.invoice_no} (${sale.status || "PAID"})</h3>
    <p style="color: var(--text-dim); font-size: 13px; margin-bottom: 8px;">Customer: <strong>${sale.customer_name || "Walk-in"}</strong></p>
    <table class="table"><thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table>
    ${returnsHtml}
    <div class="totals" style="margin-top:10px">
      <div class="row"><span>Subtotal</span><span>${fmt(sale.subtotal)}</span></div>
      ${sale.discount > 0 ? `<div class="row"><span>Discount</span><span>-${fmt(sale.discount)}</span></div>` : ""}
      <div class="row grand"><span>Total</span><span>${fmt(sale.total)}</span></div>
      <div class="row"><span>Amount Paid</span><span>${fmt(sale.amount_paid)}</span></div>
      ${balanceDue > 0 ? `<div class="row" style="color: var(--accent);"><span>Balance Due</span><span>${fmt(balanceDue)}</span></div>` : ""}
      ${sale.change_due > 0 ? `<div class="row"><span>Change Due</span><span>${fmt(sale.change_due)}</span></div>` : ""}
      ${
        sale.customer_id
          ? `
        <div class="row"><span>Prev Balance</span><span>${fmt(prevBal)}</span></div>
        <div class="row grand"><span>Updated Balance</span><span>${fmt(currBal)}</span></div>
      `
          : ""
      }
      <div class="row"><span>Payment Method</span><span>${sale.payment_method.toUpperCase()}</span></div>
    </div>
    <div class="modal-actions" style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 14px;">
      <button class="btn primary" id="printThermalBtn">🖨️ Thermal Print</button>
      ${(sale.status !== 'RETURNED') ? `<button class="btn" style="color:var(--warning)" id="returnItemsBtn">🔄 Return Items</button>` : ''}
      <button class="btn" id="closeSaleModal">Close</button>
    </div>
  `);
  document
    .getElementById("closeSaleModal")
    .addEventListener("click", closeModal);
  document
    .getElementById("printThermalBtn")
    .addEventListener("click", () => printThermalReceipt(sale.id));
  const returnBtn = document.getElementById("returnItemsBtn");
  if (returnBtn) {
    returnBtn.addEventListener("click", () => openReturnModal(sale, items));
  }
}

async function openReturnModalForSale(saleId) {
  const sale = await api.sales.getById(saleId);
  const items = await api.sales.getItems(saleId);
  openReturnModal(sale, items);
}

function openReturnModal(sale, items) {
  const existingReturns = items.map(i => ({
    sale_item_id: i.id,
    item_name: i.item_name,
    quantity_sold: i.quantity,
    unit: i.unit || '',
    unit_price: i.unit_price,
    max_return: i.quantity,
    return_qty: 0,
    refund_amount: 0,
  }));

  const rowsHtml = existingReturns.map((item, idx) => `
    <tr data-idx="${idx}">
      <td>${invoiceItemName(item)}</td>
      <td class="num">${fmt(item.quantity_sold)}${item.unit ? ' ' + item.unit : ''}</td>
      <td class="num">${fmt(item.max_return)}</td>
      <td><input type="number" class="input small return-qty-input" step="0.01" min="0" max="${item.max_return}" value="0" data-sale-item-id="${item.sale_item_id}" data-unit-price="${item.unit_price}" /></td>
      <td class="num return-refund-amount" data-idx="${idx}">0.00</td>
    </tr>
  `).join('');

  openModal(`
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <h3 style="margin:0">🔄 Return Items — Invoice ${sale.invoice_no}</h3>
      <button class="btn small-btn" id="closeReturnModalX">✕</button>
    </div>
    <p style="font-size:13px;color:var(--text-dim);margin-bottom:10px">
      Max refund: <strong style="color:var(--success)">${fmt(sale.total)}</strong> · Payment: ${sale.payment_method.toUpperCase()}
    </p>
    <table class="table" id="returnItemsTable">
      <thead><tr><th>Item</th><th>Qty Sold</th><th>Max Return</th><th>Refund Qty</th><th>Refund Amount</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    <div class="totals" style="margin-top:10px">
      <div class="row grand"><span>Total Refund</span><span id="returnTotalRefund">0.00</span></div>
    </div>
    <label style="display:block;margin-top:10px;font-size:13px;color:var(--text-dim)">
      Notes <input class="input" id="returnNotes" placeholder="Optional note" />
    </label>
    <div class="modal-actions" style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
      <button class="btn" id="returnConfirmBtn">✅ Confirm Return</button>
      <button class="btn" id="closeReturnModalBtn">Cancel</button>
    </div>
  `);

  document.getElementById('closeReturnModalX').addEventListener('click', closeModal);
  document.getElementById('closeReturnModalBtn').addEventListener('click', closeModal);

  const inputs = document.querySelectorAll('.return-qty-input');
  const totalEl = document.getElementById('returnTotalRefund');
  let totalRefund = 0;

  inputs.forEach(inp => {
    inp.addEventListener('input', () => {
      const saleItemId = Number(inp.dataset.saleItemId);
      const unitPrice = parseFloat(inp.dataset.unitPrice);
      const qty = parseFloat(inp.value) || 0;
      const refundAmount = qty * unitPrice;
      inp.closest('tr').querySelector('.return-refund-amount').textContent = fmt(refundAmount);
      totalRefund = Array.from(inputs).reduce((s, i) => s + ((parseFloat(i.value) || 0) * parseFloat(i.dataset.unitPrice)), 0);
      totalEl.textContent = fmt(totalRefund);
    });
  });

  document.getElementById('returnConfirmBtn')?.addEventListener('click', async () => {
    const returnItems = Array.from(inputs)
      .filter(inp => (parseFloat(inp.value) || 0) > 0)
      .map(inp => ({
        sale_item_id: Number(inp.dataset.saleItemId),
        quantity: parseFloat(inp.value) || 0,
      }));

    if (returnItems.length === 0) {
      toast('Please select at least one item to return', true);
      return;
    }

    const notes = document.getElementById('returnNotes')?.value || '';
    const res = await api.sales.createReturn({ saleId: sale.id, returnItems, notes });
    if (res && res.return_no) {
      toast(`Return ${res.return_no} created — ${fmt(res.totalRefund)} refunded`);
      closeModal();
      loadSalesHistory();
    } else {
      toast(res?.message || 'Return failed', true);
    }
  });
}

async function loadCustomers() {
  customers = await api.customers.getAll();
  loadCatalog();
}

async function loadCatalog() {
  const term = $("#posCatalogSearch")?.value.trim() || "";
  const category = $("#posCategoryFilter")?.value || "";

  let items;
  if (term) {
    items = await api.items.search(term);
  } else {
    items = await api.items.getAll({ category: category || undefined });
  }

  if (term && category) {
    items = items.filter((i) => i.category === category);
  }

  const grid = $("#posProductsGrid");
  if (!grid) return;
  grid.innerHTML = "";
  const empty = $("#posProductsEmpty");
  if (empty) empty.classList.toggle("hidden", items.length > 0);

  items.forEach((item, idx) => {
    const card = document.createElement("div");
    card.className = "pos-product-card";
    card.dataset.index = idx;
    card.innerHTML = `
      <div class="pos-product-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</div>
      ${item.urdu_name ? `<div class="pos-product-urdu urdu-item-name" lang="ur" dir="rtl">${escapeHtml(item.urdu_name)}</div>` : ""}
      <div class="pos-product-price">${fmt(item.sale_price)} ${currency()}</div>
      <div class="pos-product-stock">Stock: ${escapeHtml(item.stock)} ${escapeHtml(item.unit)}</div>
    `;
    card.addEventListener("click", () => {
      addToCart(item);
      focusBarcode();
    });
    grid.appendChild(card);
  });

  catalogResolvedItems = items;
  catalogColumns = detectCatalogColumns();
  // Do NOT auto-highlight; user presses ArrowDown/Right from search to enter grid mode
  catalogHighlightedIndex = -1;
  catalogFocused = false;

  const cats = await api.items.getCategories();
  const catSel = $("#posCategoryFilter");
  if (catSel) {
    const keepCat = catSel.value;
    catSel.innerHTML =
      '<option value="">All Categories</option>' +
      cats.map((c) => `<option>${c}</option>`).join("");
    catSel.value = keepCat;
  }
}

function init() {
  $("#barcodeInput").addEventListener("keydown", (e) => {
    const resultsBox = $("#searchResults");
    const hasOpenResults = resultsBox && !resultsBox.classList.contains("hidden");
    const resultCount = searchResolvedItems.length;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (hasOpenResults && resultCount > 0) {
        const next = searchHighlightedIndex < 0 ? 0 : (searchHighlightedIndex + 1) % resultCount;
        highlightResult(next);
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (hasOpenResults && resultCount > 0) {
        const prev = searchHighlightedIndex <= 0 ? resultCount - 1 : searchHighlightedIndex - 1;
        highlightResult(prev);
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (hasOpenResults && resultCount > 0) {
        // If there's only one result and no highlight yet, or highlight is at index 0, add it directly
        let itemIdx = searchHighlightedIndex;
        if (resultCount === 1) {
          // Single result: add immediately without needing arrow down
          const item = searchResolvedItems[0];
          addToCart(item);
          $("#barcodeInput").value = "";
          searchHighlightedIndex = -1;
          searchResolvedItems = [];
          resultsBox.classList.add("hidden");
          focusBarcode();
          return;
        }
        if (itemIdx < 0) itemIdx = 0;
        const item = searchResolvedItems[itemIdx];
        addToCart(item);
        $("#barcodeInput").value = "";
        searchHighlightedIndex = -1;
        searchResolvedItems = [];
        resultsBox.classList.add("hidden");
        focusBarcode();
      } else {
        hideResults();
        tryBarcodeSubmit(e.target.value.trim());
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      searchHighlightedIndex = -1;
      hideResults();
      focusBarcode();
    }
  });
  $("#barcodeInput").addEventListener("input", (e) => {
    if (e.target.value.trim()) {
      searchHighlightedIndex = -1;
      showResults(e.target.value.trim());
    } else {
      hideResults();
    }
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".pos-toolbar")) hideResults();
  });

  $("#cartBody").addEventListener("click", (e) => {
    const rm = e.target.dataset.remove;
    if (rm !== undefined) removeFromCart(Number(rm));
  });
  $("#cartBody").addEventListener("change", (e) => {
    if (e.target.classList.contains("qty-input"))
      setQuantity(Number(e.target.dataset.idx), e.target.value);
  });

  // Cart keyboard navigation
  function highlightCartRow(idx) {
    const rows = $("#cartBody").querySelectorAll("tr");
    rows.forEach((r, i) => {
      r.classList.toggle("cart-row-focused", i === idx);
      const inp = r.querySelector(".qty-input");
      if (inp) inp.classList.toggle("qty-input-focused", i === idx);
    });
    cartFocusedRowIndex = idx;
    if (idx >= 0 && rows[idx]) {
      rows[idx].scrollIntoView({ block: "nearest" });
    }
  }

  function focusCartRowInput(idx) {
    const rows = $("#cartBody").querySelectorAll("tr");
    rows.forEach((r) => {
      r.classList.remove("cart-row-focused");
      const inp = r.querySelector(".qty-input");
      if (inp) inp.classList.remove("qty-input-focused");
    });
    cartFocusedRowIndex = idx;
    cartFocusedFieldIndex = 0;
    if (idx >= 0 && idx < rows.length) {
      const inp = rows[idx].querySelector(".qty-input");
      if (inp) {
        inp.focus();
        inp.select();
        inp.classList.add("qty-input-focused");
        rows[idx].classList.add("cart-row-focused");
        rows[idx].scrollIntoView({ block: "nearest" });
      }
    }
  }

  function clearCartFocus() {
    const rows = $("#cartBody").querySelectorAll("tr");
    rows.forEach((r) => {
      r.classList.remove("cart-row-focused");
      const inp = r.querySelector(".qty-input");
      if (inp) inp.classList.remove("qty-input-focused");
    });
    cartFocusedRowIndex = -1;
    cartFocusedFieldIndex = -1;
  }

  $("#cartBody").addEventListener("keydown", (e) => {
    if (cartFocusedRowIndex < 0) return;
    const rows = $("#cartBody").querySelectorAll("tr");
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = cartFocusedRowIndex < rows.length - 1 ? cartFocusedRowIndex + 1 : 0;
      highlightCartRow(next);
      const inp = rows[next].querySelector(".qty-input");
      if (inp) { inp.focus(); inp.select(); }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prev = cartFocusedRowIndex > 0 ? cartFocusedRowIndex - 1 : rows.length - 1;
      highlightCartRow(prev);
      const inp = rows[prev].querySelector(".qty-input");
      if (inp) { inp.focus(); inp.select(); }
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      removeFromCart(cartFocusedRowIndex);
      const remaining = $("#cartBody").querySelectorAll("tr");
      const newRowIdx = Math.min(cartFocusedRowIndex, remaining.length - 1);
      if (newRowIdx >= 0) {
        highlightCartRow(newRowIdx);
        const inp = remaining[newRowIdx].querySelector(".qty-input");
        if (inp) { inp.focus(); inp.select(); }
      } else {
        clearCartFocus();
        focusBarcode();
      }
    } else if (e.key === "ArrowRight" || e.key === "Tab") {
      e.preventDefault();
      // Move from last row to complete sale flow
      if (e.key === "Tab") {
        clearCartFocus();
        focusAmountPaid();
      }
    }
  });

  // Qty input keydown handlers (Enter applies and returns to search)
  document.addEventListener("keydown", (e) => {
    if (e.target.classList.contains("qty-input")) {
      if (e.key === "Enter") {
        e.preventDefault();
        const idx = Number(e.target.dataset.idx);
        setQuantity(idx, e.target.value);
        clearCartFocus();
        focusBarcode();
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.target.blur();
        clearCartFocus();
        focusBarcode();
      }
    }
  });

  $("#customerSearchInput")?.addEventListener("input", (e) => {
    handleCustomerSearch(e.target.value.trim().toLowerCase());
  });
  $("#clearCustomerBtn")?.addEventListener("click", (e) => {
    e.preventDefault();
    clearSelectedCustomer();
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".customer-select-wrap")) {
      $("#customerSearchResults")?.classList.add("hidden");
    }
  });
  $("#amountPaidInput").addEventListener("input", recalcChange);
  $("#amountPaidInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      completeSale();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.target.blur();
      focusBarcode();
    }
  });
  $("#completeSaleBtn").addEventListener("click", completeSale);
  $("#previewInvoiceBtn").addEventListener("click", previewCartInvoice);
  $("#printCartBtn").addEventListener("click", printCartThermalReceipt);
  $("#clearCartBtn").addEventListener("click", clearCart);

  // -- Catalog grid keyboard navigation ----------------------------------
  // Search-input handler: arrow keys enter/navigate grid; Enter adds to cart
  $("#posCatalogSearch")?.addEventListener("input", loadCatalog);
  $("#posCatalogSearch")?.addEventListener("keydown", (e) => {
    const total = catalogResolvedItems.length;
    if (total === 0) return;

    if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      e.preventDefault();
      if (!catalogFocused) {
        // Enter grid mode from search bar
        highlightCatalogCard(0);
      } else {
        // Navigate grid: move down one row or right one column
        const pos = getCatalogGridPos(catalogHighlightedIndex);
        const downIdx = catalogHighlightedIndex + pos.cols;
        if (downIdx < total) {
          highlightCatalogCard(downIdx);
        } else {
          // At last row � move right within row, or wrap to first of next row
          const rightIdx = catalogHighlightedIndex + 1;
          if (rightIdx < total && rightIdx % pos.cols !== 0) {
            highlightCatalogCard(rightIdx);
          }
        }
      }
    } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
      e.preventDefault();
      if (catalogFocused) {
        const pos = getCatalogGridPos(catalogHighlightedIndex);
        if (e.key === "ArrowUp") {
          const upIdx = catalogHighlightedIndex - pos.cols;
          if (upIdx >= 0) highlightCatalogCard(upIdx);
        } else {
          // ArrowLeft
          if (pos.col > 0) highlightCatalogCard(catalogHighlightedIndex - 1);
        }
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (catalogFocused && catalogHighlightedIndex >= 0) {
        const item = catalogResolvedItems[catalogHighlightedIndex];
        addToCart(item);
        // Keep highlight so user can hit Enter again to increment quantity
        highlightCatalogCard(catalogHighlightedIndex);
      } else if (!catalogFocused) {
        // From search bar with no grid focus � enter grid mode on first item
        highlightCatalogCard(0);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      clearCatalogFocus();
      focusBarcode();
    }
  });

  // Document-level fallback: handles grid navigation when focus leaves search input
  document.addEventListener("keydown", (e) => {
    if (e.target.id === "posCatalogSearch") return;
    if (!catalogFocused || catalogResolvedItems.length === 0) return;
    const total = catalogResolvedItems.length;
    const pos = getCatalogGridPos(catalogHighlightedIndex);

    if (e.key === "ArrowRight") {
      e.preventDefault();
      if (pos.col < pos.cols - 1 && catalogHighlightedIndex + 1 < total) {
        highlightCatalogCard(catalogHighlightedIndex + 1);
      }
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      if (pos.col > 0 && catalogHighlightedIndex - 1 >= 0) {
        highlightCatalogCard(catalogHighlightedIndex - 1);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const down = catalogHighlightedIndex + pos.cols;
      if (down < total) highlightCatalogCard(down);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const up = catalogHighlightedIndex - pos.cols;
      if (up >= 0) highlightCatalogCard(up);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = catalogResolvedItems[catalogHighlightedIndex];
      addToCart(item);
      highlightCatalogCard(catalogHighlightedIndex);
    } else if (e.key === "Escape") {
      e.preventDefault();
      clearCatalogFocus();
      focusBarcode();
    }
  });

  $("#posCategoryFilter")?.addEventListener("change", loadCatalog);

  $("#salesFilterBtn").addEventListener("click", loadSalesHistory);
  $("#salesRefreshBtn").addEventListener("click", loadSalesHistory);
  $("#salesBody").addEventListener("click", (e) => {
    const id = e.target.dataset.viewSale;
    if (id) { viewSale(Number(id)); return; }
    const retId = e.target.dataset.returnSale;
    if (retId) openReturnModalForSale(Number(retId));
  });

  loadCustomers();
  focusBarcode();

  // Global POS keyboard shortcuts
  function posKeydown(e) {
    if (!$("#view-pos").classList.contains("active")) return;
    // Don't intercept when user is typing in inputs (except for dedicated shortcut keys)
    const inInput = e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable;

    if (e.key === "F1") {
      e.preventDefault();
      clearCartFocus();
      focusBarcode();
      return;
    }
    if (e.key === "F2") {
      e.preventDefault();
      focusAmountPaid();
      return;
    }
    if (e.key === "F3") {
      e.preventDefault();
      togglePaymentMethod();
      return;
    }
    if (e.key === "F9") {
      e.preventDefault();
      completeSale();
      return;
    }
    // Esc: clear search results or close modals, return to barcode
    if (e.key === "Escape") {
      if ($("#modal") && !$("#modal").classList.contains("hidden")) return; // let app.js handle modal close
      if (searchResolvedItems.length > 0) {
        e.preventDefault();
        searchHighlightedIndex = -1;
        hideResults();
        focusBarcode();
        return;
      }
      if (catalogFocused) {
        e.preventDefault();
        clearCatalogFocus();
        focusBarcode();
        return;
      }
      if (cartFocusedRowIndex >= 0) {
        e.preventDefault();
        clearCartFocus();
        focusBarcode();
        return;
      }
    }
  }

  document.addEventListener("keydown", posKeydown);
}

export const initPOS = {
  init,
  refresh: () => {
    loadCustomers();
    loadCatalog();
  },
  clearCart,
  completeSale,
  focusBarcode,
  focusAmountPaid,
  togglePaymentMethod,
  loadSalesHistory,
};


