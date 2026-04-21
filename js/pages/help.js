const { renderPage } = window.app;

function renderHelp() {
  renderPage(`
    <div class="page-title">
      <h2>❔ Help</h2>
      <p>Use this guide when setting up products, receiving stock, and recording sales.</p>
    </div>

    <div class="list-grid">
      <div class="card">
        <strong>1. Login</strong><br>
        Login with the email and password for your Firebase Auth account.
      </div>

      <div class="card">
        <strong>2. Staff</strong><br>
        Admin users can save staff profiles, assign roles, and then create secure staff accounts through the backend setup.
      </div>

      <div class="card">
        <strong>3. Add Product</strong><br>
        Create each product once. Enter the product name, category, base unit, bulk unit, units per bulk, plus cost and selling prices for both base units and bulk units.
      </div>

      <div class="card">
        <strong>4. Receive Stock</strong><br>
        Use this when suppliers bring goods. Record the product, quantity received, supplier, who received it, invoice details, received time, batch expiry date, and whether it was paid or put on credit.
      </div>

      <div class="card">
        <strong>5. Record Sale</strong><br>
        Choose the product, select whether the sale is in base units or bulk units, then enter the quantity sold. The app sells from the earliest unexpired batch first.
      </div>

      <div class="card">
        <strong>6. Inventory</strong><br>
        Stock is stored in base units. Sellable stock comes from unexpired batches, and expired stock is tracked separately.
      </div>

      <div class="card">
        <strong>7. Suppliers</strong><br>
        Save supplier contact details such as name, contact person, phone, email, address, and notes.
      </div>

      <div class="card">
        <strong>8. Dashboard</strong><br>
        Use the dashboard for quick totals: products, items sold, profit, and low-stock count.
      </div>

      <div class="card">
        <strong>Developer Support</strong><br>
        To reach the developer, WhatsApp: +1 332 323 0435
      </div>
    </div>
  `);
}

window.renderHelp = renderHelp;
