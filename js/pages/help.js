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
        Admin users can save staff profiles, assign roles, and prepare staff access. The account setup message can be copied and sent to the developer when backend account creation is needed.
      </div>

      <div class="card">
        <strong>3. Add Product</strong><br>
        Create each product once. Enter the product name, category, base unit, bulk unit, units per bulk, plus cost and selling prices for both base units and bulk units.
      </div>

      <div class="card">
        <strong>4. Receive Stock</strong><br>
        Use this when suppliers bring goods. Record the supplier, invoice number, purchase date, due date, payment type, notes, and one or more product lines.
      </div>

      <div class="card">
        <strong>5. Product Lines</strong><br>
        Each received stock entry can include multiple products. For each line, select the product, enter bulk units, base units, unit cost, and expiry date if applicable.
      </div>

      <div class="card">
        <strong>6. Supplier Payment</strong><br>
        Use Supplier Payment when paying a supplier for a credit purchase. Record the supplier, invoice or purchase reference, payment date, amount paid, payment method, reference number, discount, penalty, and notes.
      </div>

      <div class="card">
        <strong>7. Record Sale</strong><br>
        Choose the product, select whether the sale is in base units or bulk units, then enter the quantity sold. The app sells from the earliest unexpired batch first.
      </div>

      <div class="card">
        <strong>8. Inventory</strong><br>
        Stock is stored in base units. Sellable stock comes from unexpired batches, and expired stock is tracked separately.
      </div>

      <div class="card">
        <strong>9. Suppliers</strong><br>
        Save supplier contact details such as name, contact person, phone, email, address, and notes.
      </div>

      <div class="card">
        <strong>10. Stock Adjustment</strong><br>
        Use Stock Adjustment to record damaged, lost, expired, broken, stolen, or leaking goods. This keeps stock levels and loss reports accurate.
      </div>

      <div class="card">
        <strong>11. Dashboard</strong><br>
        Use the dashboard for quick totals: products, items sold, profit, stock value, supplier amount owed, and low-stock count.
      </div>

      <div class="card">
        <strong>12. Reports</strong><br>
        Use Reports to view low stock, reorder needs, sales by product, sales by sales person, stock movement, damaged/lost items, purchases, and inventory valuation.
      </div>

      <div class="card">
        <strong>13. Date Filters</strong><br>
        Reports that depend on dates include From and To filters so you can review a specific day, week, month, or custom period.
      </div>

      <div class="card">
        <strong>Developer Support</strong><br>
        To reach the developer, WhatsApp: +1 332 323 0435
      </div>
    </div>
  `);
}

window.renderHelp = renderHelp;
