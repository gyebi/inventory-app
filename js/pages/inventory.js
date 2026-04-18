const {
  ensureStockState,
  getBatchesByProductId,
  getExpiredBatches,
  getExpiredStockQuantity,
  getSellableBatches,
  parseExpiryDate,
  renderPage,
  state,
  formatReceiptCurrency,
  formatStock
} = window.app;

function renderInventory() {
  ensureStockState();

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
    const productBatches = getBatchesByProductId(p.id);
    const activeBatches = getSellableBatches(p.id);
    const expiredBatches = getExpiredBatches(p.id);
    const nextExpiry = activeBatches
      .map((batch) => parseExpiryDate(batch.expiryDate))
      .filter(Boolean)
      .sort((left, right) => left.getTime() - right.getTime())[0];

    html += `
      <div class="inventory-row">
        <div><strong>${p.name}</strong></div>
        <div><strong>Category:</strong> ${p.category}</div>
        <div><strong>Bulk Unit:</strong> ${p.bulkUnit}</div>
        <div><strong>Base Unit:</strong> ${p.baseUnit}</div>
        <div><strong>Units Per Bulk:</strong> ${p.unitsPerBulk}</div>
        <div><strong>Sellable Stock:</strong> ${p.quantity} ${p.baseUnit}(s)</div>
        <div><strong>Expired Stock:</strong> ${getExpiredStockQuantity(p.id)} ${p.baseUnit}(s)</div>
        <div><strong>Equivalent:</strong> ${formatStock(p)}</div>
        <div><strong>Tracked Batches:</strong> ${productBatches.length}</div>
        <div><strong>Active Batches:</strong> ${activeBatches.length}</div>
        <div><strong>Expired Batches:</strong> ${expiredBatches.length}</div>
        <div><strong>Next Expiry:</strong> ${nextExpiry ? nextExpiry.toLocaleDateString() : "N/A"}</div>
        <div><strong>Base Cost:</strong> ${formatReceiptCurrency(p.costPrice)}</div>
        <div><strong>Base Selling:</strong> ${formatReceiptCurrency(p.sellingPrice)}</div>
        <div><strong>Bulk Cost:</strong> ${formatReceiptCurrency(p.bulkCostPrice ?? 0)}</div>
        <div><strong>Bulk Selling:</strong> ${formatReceiptCurrency(p.bulkSellingPrice ?? 0)}</div>
      </div>
    `;
  });

  html += "</div>";

  renderPage(html);
}

window.renderInventory = renderInventory;
