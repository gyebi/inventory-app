function renderInventory() {
  if (state.products.length === 0) {
    renderPage(`
      <div class="page-title">
        <h2>📦 Inventory</h2>
        <p>Current stock will appear here after products and deliveries are added.</p>
      </div>
      <div class="card">No products yet.</div>
    `);
    return;
  }

  let html = `
    <div class="page-title">
      <h2>📦 Inventory</h2>
      <p>Stock is stored in base units and shown as bulk equivalents.</p>
    </div>
    <div class="list-grid">
  `;

  state.products.forEach((p) => {
    html += `
      <div class="card">
        <strong>${p.name}</strong><br>
        Category: ${p.category}<br>
        Bulk Unit: ${p.bulkUnit}<br>
        Base Unit: ${p.baseUnit}<br>
        Base Units Per Bulk Unit: ${p.unitsPerBulk}<br>
        Stock: ${p.quantity} ${p.baseUnit}(s)<br>
        Equivalent: ${formatStock(p)}<br>
        Cost Price: ${p.costPrice}<br>
        Selling Price: ${p.sellingPrice}
      </div>
    `;
  });

  html += "</div>";

  renderPage(html);
}
