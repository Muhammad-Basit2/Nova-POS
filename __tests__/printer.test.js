const { printReceipt, createPrinterInstance, PRINT_ERROR } = require('../src/main/printer');

describe('ESC/POS Thermal Printer Module', () => {
  const sampleSale = {
    id: 101,
    invoice_no: 'INV-2026-0001',
    created_at: '2026-10-29 14:30:00',
    customer_name: 'Ahmed Khan',
    subtotal: 1000,
    discount: 50,
    total: 950,
    amount_paid: 1000,
    change_due: 50,
    payment_method: 'cash',
    notes: '',
    items: [
      { item_name: 'Basmati Rice 5kg', quantity: 1, unit: 'bag', unit_price: 600, line_total: 600 },
      { item_name: 'Cooking Oil 1L', quantity: 2, unit: 'bot', unit_price: 200, line_total: 400 },
    ],
  };

  const sampleSettings = {
    store_name: 'Nova Supermarket',
    store_address: 'Main Commercial Area, Lahore',
    store_phone: '+92 300 1234567',
    currency: 'PKR',
    tax_rate: '0',
    receipt_footer: 'Thank you for shopping with us!',
    cashier_name: 'Cashier 01',
  };

  test('createPrinterInstance returns instance configured for 80mm ESC/POS', () => {
    const p = createPrinterInstance({ interface: 'tcp://127.0.0.1:9100', width: 48 });
    expect(p).toBeDefined();
    expect(p.config.width).toBe(48);
  });

  test('printReceipt fails gracefully when printer interface is missing', async () => {
    const res = await printReceipt(sampleSale, sampleSettings, {});
    expect(res.success).toBe(false);
    expect(res.errorCode).toBe(PRINT_ERROR.NOT_CONFIGURED);
  });

  test('printReceipt fails gracefully when printer is unreachable', async () => {
    const res = await printReceipt(sampleSale, sampleSettings, {
      interface: 'tcp://127.0.0.1:65432',
      options: { timeout: 300 },
    });
    expect(res.success).toBe(false);
    expect([PRINT_ERROR.NOT_CONNECTED, PRINT_ERROR.TIMEOUT]).toContain(res.errorCode);
  });
});
