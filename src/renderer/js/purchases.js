/* ===========================================================
 *  Nova POS – Stock Purchases Logic
 *  src/renderer/js/purchases.js
 * ============================================================ */

import { toast, openModal, closeModal, fmt, currency } from './app.js';

const api = window.novaAPI;
const $ = (sel) => document.querySelector(sel);

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

async function refresh() {
  const body = $('#purchasesBody');
  if (!body) return;

  const purchases = await api.purchases.getAll();
  body.innerHTML = '';

  const empty = $('#purchasesEmpty');
  if (purchases.length === 0) {
    empty?.classList.remove('hidden');
    return;
  }
  empty?.classList.add('hidden');

  purchases.forEach(purchase => {
    const tr = document.createElement('tr');
    const canPay = purchase.balance_due > 0 && purchase.vendor_id;
    tr.innerHTML = `
      <td>${escapeHtml(purchase.invoice_no)}</td>
      <td>${escapeHtml(purchase.created_at)}</td>
      <td>${escapeHtml(purchase.supplier_name || 'Deleted supplier')}</td>
      <td class="num">${fmt(purchase.total_amount)} ${escapeHtml(currency())}</td>
      <td class="num">${fmt(purchase.paid_amount)} ${escapeHtml(currency())}</td>
      <td class="num">${fmt(purchase.balance_due)} ${escapeHtml(currency())}</td>
      <td>
        ${canPay ? `<button class="btn success small-btn" data-pay="${purchase.id}">Record Payment</button>` : ''}
        ${purchase.vendor_id ? `<button class="btn small-btn" data-ledger="${purchase.vendor_id}">Supplier Ledger</button>` : ''}
      </td>
    `;
    body.appendChild(tr);
  });

}

async function purchaseModal() {
  let vendors;
  try {
    vendors = await api.vendors.getAll();
  } catch (error) {
    console.error('Could not load suppliers for purchase:', error);
    toast('Could not load suppliers', true);
    return;
  }

  const supplierOptions = vendors.map(v =>
    `<option value="${v.id}">${escapeHtml(v.name)}</option>`
  ).join('');
  openModal(`
    <h3>Record New Stock Purchase</h3>
    ${vendors.length
      ? `<label>Supplier *
          <select class="input" id="p-supplier">
            <option value="">Select a supplier</option>
            ${supplierOptions}
          </select>
        </label>`
      : '<p class="empty-state">Add a supplier before recording a purchase.</p>'}
    <label>Invoice / Bill #<input class="input" id="p-inv" placeholder="Auto-generated if blank" /></label>
    <label>Total Bill Amount *
      <input class="input" type="number" min="0.01" step="0.01" id="p-total" value="" />
    </label>
    <label>Paid Amount
      <input class="input" type="number" min="0" step="0.01" id="p-paid" value="0" />
    </label>
    <div class="modal-actions">
      <button class="btn" id="p-cancel">Cancel</button>
      ${vendors.length
        ? '<button class="btn primary" id="p-save">Save Purchase</button>'
        : '<button class="btn primary" id="p-add-supplier">Add Supplier</button>'}
    </div>
  `);
  document.getElementById('p-cancel').addEventListener('click', closeModal);
  document.getElementById('p-add-supplier')?.addEventListener('click', () => {
    closeModal();
    document.querySelector('[data-view="suppliers"]')?.click();
    document.getElementById('addSupplierBtn')?.click();
  });
  document.getElementById('p-save')?.addEventListener('click', async () => {
    const vendorId = Number($('#p-supplier').value);
    const totalAmount = Number($('#p-total').value);
    const paidAmount = Number($('#p-paid').value || 0);
    if (!vendorId) {
      toast('Select a supplier', true);
      return;
    }
    if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
      toast('Enter a purchase amount greater than zero', true);
      return;
    }
    if (!Number.isFinite(paidAmount) || paidAmount < 0 || paidAmount > totalAmount) {
      toast('Paid amount must be between zero and the total bill', true);
      return;
    }

    const saveButton = document.getElementById('p-save');
    saveButton.disabled = true;
    try {
      await api.purchases.create({
        vendor_id: vendorId,
        invoice_no: $('#p-inv').value.trim(),
        total_amount: totalAmount,
        paid_amount: paidAmount
      });
    } catch (error) {
      console.error('Purchase save failed:', error);
      toast(error.message || 'Failed to save purchase', true);
      saveButton.disabled = false;
      return;
    }

    closeModal();
    toast('Purchase saved and supplier ledger updated');
    try {
      await refresh();
    } catch (error) {
      console.error('Purchase list refresh failed:', error);
      toast('Purchase saved, but the list could not be refreshed', true);
    }
  });
}

async function paymentModal(purchase) {
  openModal(`
    <h3>Record Supplier Payment</h3>
    <p style="margin-bottom: 12px;">${escapeHtml(purchase.supplier_name)} — ${escapeHtml(purchase.invoice_no)}</p>
    <p style="margin-bottom: 12px;">Remaining balance: <strong>${fmt(purchase.balance_due)} ${escapeHtml(currency())}</strong></p>
    <label>Payment Amount *
      <input class="input" type="number" min="0.01" max="${purchase.balance_due}" step="0.01" id="purchase-payment-amount" />
    </label>
    <label>Payment Note
      <input class="input" id="purchase-payment-note" value="Payment on stock purchase" />
    </label>
    <div class="modal-actions">
      <button class="btn" id="purchase-payment-cancel">Cancel</button>
      <button class="btn primary" id="purchase-payment-save">Save Payment</button>
    </div>
  `);
  document.getElementById('purchase-payment-cancel').addEventListener('click', closeModal);
  document.getElementById('purchase-payment-save').addEventListener('click', async () => {
    const amount = Number($('#purchase-payment-amount').value);
    if (!Number.isFinite(amount) || amount <= 0 || amount > purchase.balance_due) {
      toast('Enter a valid payment within the remaining balance', true);
      return;
    }

    const saveButton = document.getElementById('purchase-payment-save');
    saveButton.disabled = true;
    try {
      await api.purchases.recordPayment(purchase.id, {
        amount,
        description: $('#purchase-payment-note').value.trim() || 'Payment on stock purchase'
      });
    } catch (error) {
      console.error('Purchase payment failed:', error);
      toast(error.message || 'Failed to save payment', true);
      saveButton.disabled = false;
      return;
    }

    closeModal();
    toast('Payment saved and supplier ledger updated');
    try {
      await refresh();
    } catch (error) {
      console.error('Purchase list refresh failed after payment:', error);
      toast('Payment saved, but the purchase list could not be refreshed', true);
    }
  });
}

function init() {
  $('#addPurchaseBtn')?.addEventListener('click', purchaseModal);
  $('#purchasesBody')?.addEventListener('click', async (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    const purchaseId = Number(button.dataset.pay);
    if (purchaseId) {
      try {
        const purchases = await api.purchases.getAll();
        const purchase = purchases.find(row => row.id === purchaseId);
        if (purchase) await paymentModal(purchase);
      } catch (error) {
        console.error('Could not load purchase for payment:', error);
        toast('Could not open purchase payment', true);
      }
    }
    const vendorId = Number(button.dataset.ledger);
    if (vendorId) {
      document.querySelector('[data-view="suppliers"]')?.click();
      document.dispatchEvent(new CustomEvent('nova:openSupplierLedger', {
        detail: { vendorId }
      }));
    }
  });
  refresh().catch(error => {
    console.error('Purchase list load failed:', error);
    toast('Could not load purchases', true);
  });
}

export const initPurchases = { init, refresh };
