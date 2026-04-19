const {
  ensureStockState,
  getBatchesByProductId,
  getExpiredBatches,
  getExpiredStockQuantity,
  getSellableBatches,
  parseExpiryDate,
  renderPage,
  state,
  formatReceiptCurrency
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
      <p>Use the physical stock breakdown for counting and reconciliation.</p>
    </div>
    <div class="inventory-list">
  `;

  state.products.forEach((p) => {
    const productBatches = getBatchesByProductId(p.id);
    const activeBatches = getSellableBatches(p.id);
    const expiredBatches = getExpiredBatches(p.id);
    const physicalStock = getPhysicalStock(p);
    const nextExpiry = activeBatches
      .map((batch) => parseExpiryDate(batch.expiryDate))
      .filter(Boolean)
      .sort((left, right) => left.getTime() - right.getTime())[0];

    html += `
      <div class="inventory-row">
        <div><strong>${p.name}</strong></div>
        <div><strong>Category:</strong> ${p.category}</div>
        <div><strong>Physical Stock:</strong> ${formatProductStock(p)}</div>
        <div><strong>Bulk Units:</strong> ${physicalStock.fullBulk} ${p.bulkUnit}(s)</div>
        <div><strong>Loose Units:</strong> ${physicalStock.remainder} ${p.baseUnit}(s)</div>
        <div><strong>Total Base Units:</strong> ${p.quantity} ${p.baseUnit}(s)</div>
        <div><strong>Conversion:</strong> 1 ${p.bulkUnit} = ${physicalStock.unitsPerBulk} ${p.baseUnit}(s)</div>
        <div><strong>Expired Stock:</strong> ${getExpiredStockQuantity(p.id)} ${p.baseUnit}(s)</div>
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

function getUnitsPerBulk(product) {
  const unitsPerBulk = Number(product.unitsPerBulk);
  return Number.isFinite(unitsPerBulk) && unitsPerBulk > 0 ? unitsPerBulk : 1;
}

function formatProductStock(product) {
  const physicalStock = getPhysicalStock(product);
  const bulkUnit = product.bulkUnit || "bulk unit";
  const baseUnit = product.baseUnit || "base unit";

  return `${physicalStock.fullBulk} ${bulkUnit}(s) and ${physicalStock.remainder} ${baseUnit}(s)`;
}

function getPhysicalStock(product) {
  const unitsPerBulk = getUnitsPerBulk(product);
  const quantity = Number(product.quantity || 0);

  return {
    unitsPerBulk,
    fullBulk: Math.floor(quantity / unitsPerBulk),
    remainder: quantity % unitsPerBulk
  };
}
