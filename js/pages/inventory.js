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
    <div class="inventory-list">
  `;

  state.products.forEach((p) => {
    html += `
      <div class="inventory-row">
        <div><strong>${p.name}</strong></div>
        <div><strong>Category:</strong> ${p.category}</div>
        <div><strong>Bulk Unit:</strong> ${p.bulkUnit}</div>
        <div><strong>Base Unit:</strong> ${p.baseUnit}</div>
        <div><strong>Units Per Bulk:</strong> ${p.unitsPerBulk}</div>
        <div><strong>Stock:</strong> ${p.quantity} ${p.baseUnit}(s)</div>
        <div><strong>Equivalent:</strong> ${formatStock(p)}</div>
        <div><strong>Base Cost:</strong> ${p.costPrice}</div>
        <div><strong>Base Selling:</strong> ${p.sellingPrice}</div>
        <div><strong>Bulk Cost:</strong> ${p.bulkCostPrice ?? 0}</div>
        <div><strong>Bulk Selling:</strong> ${p.bulkSellingPrice ?? 0}</div>
      </div>
    `;
  });

  html += "</div>";

  renderPage(html);
}
