const app = /** @type {any} */ (window).app;
const {
  ensureStockState,
  getExpiredBatches,
  getExpiredStockQuantity,
  getAuthoritativeBatchStatus,
  getSellableQuantity,
  getSellableBatches,
  parseExpiryDate,
  renderPage,
  state,
  formatReceiptCurrency
} = app;

let inventorySearchQuery = "";

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

  const normalizedQuery = inventorySearchQuery.trim().toLowerCase();
  const filteredProducts = normalizedQuery
    ? state.products.filter((product) => {
        const searchableText = [
          product.name,
          product.category,
          product.baseUnit,
          product.bulkUnit
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return searchableText.includes(normalizedQuery);
      })
    : state.products;

  let html = `
    <div class="page-title">
      <h2>📦 Inventory</h2>
      <p>Use the physical stock breakdown for counting and reconciliation.</p>
    </div>
    <div class="inventory-toolbar inventory-toolbar-mobile">
      <input
        id="inventorySearch"
        class="inventory-search-input"
        type="search"
        placeholder="Search products by name or category"
        value="${escapeHtml(inventorySearchQuery)}"
        oninput="updateInventorySearch(this.value)"
      >
      <div class="inventory-toolbar-actions"><button type="button" onclick="navigate('receiveStock')">Receive stock</button><button type="button" onclick="navigate('addProduct')">Add product</button></div>
    </div>
  `;

  if (filteredProducts.length === 0) {
    html += `
      <div class="card">
        No products match "${escapeHtml(inventorySearchQuery.trim())}".
      </div>
    `;
    renderPage(html);
    return;
  }

  const lowStockCount = filteredProducts.filter((product) => getSellableQuantity(product) <= Number(product.lowStockThreshold ?? state.settings?.lowStockThreshold ?? 0)).length;
  html += `<div class="inventory-mobile-summary"><span>${filteredProducts.length} product${filteredProducts.length === 1 ? "" : "s"}</span><span class="${lowStockCount ? "is-alert" : ""}">${lowStockCount} low stock</span></div><div class="inventory-list">`;

  filteredProducts.forEach((p) => {
    const activeBatches = getSellableBatches(p.id);
    const expiredBatches = getExpiredBatches(p.id);
    const physicalStock = getPhysicalStock(p);
    const nextExpiry = activeBatches
      .map((batch) => parseExpiryDate(batch.expiryDate))
      .filter(Boolean)
      .sort((left, right) => left.getTime() - right.getTime())[0];

    const sellableQuantity = getSellableQuantity(p);
    const isV2 = Number(p.inventorySchemaVersion) === 2;
    const v2BatchStatus = getAuthoritativeBatchStatus();
    const lowStock = sellableQuantity <= Number(p.lowStockThreshold ?? state.settings?.lowStockThreshold ?? 0);
    html += `
      <article class="inventory-row inventory-product-card">
        <div class="inventory-product-heading"><div><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(p.category || "Uncategorized")}</small></div><span class="${lowStock ? "inventory-alert" : "inventory-ok"}">${lowStock ? "Low stock" : "In stock"}</span></div>
        <div class="inventory-product-key-stats"><div><span>Available to sell</span><b>${escapeHtml(formatQuantity(sellableQuantity, p))}</b></div><div><span>Base selling</span><b>${formatOptionalCurrency(getProductSellingPrice(p))}</b></div></div>
        <details class="inventory-details"><summary>Product details <span aria-hidden="true">⌄</span></summary><div class="inventory-details-grid">
          <div><strong>Bulk units</strong><span>${physicalStock.fullBulk} ${escapeHtml(p.bulkUnit || "bulk unit")}(s)</span></div>
          <div><strong>Loose units</strong><span>${physicalStock.remainder} ${escapeHtml(p.baseUnit || "base unit")}(s)</span></div>
          <div><strong>Physical base units</strong><span>${p.quantity} ${escapeHtml(p.baseUnit || "base unit")}(s)</span></div>
          <div><strong>Sellable base units</strong><span>${sellableQuantity} ${escapeHtml(p.baseUnit || "base unit")}(s)</span></div>
          <div><strong>Conversion</strong><span>1 ${escapeHtml(p.bulkUnit || "bulk")} = ${physicalStock.unitsPerBulk} ${escapeHtml(p.baseUnit || "base")}(s)</span></div>
          <div><strong>Expired stock</strong><span>${getExpiredStockQuantity(p.id)} ${escapeHtml(p.baseUnit || "base unit")}(s)</span></div>
          <div><strong>Active / expired batches</strong><span>${activeBatches.length} / ${expiredBatches.length}</span></div>
          <div><strong>Next expiry</strong><span>${nextExpiry ? nextExpiry.toLocaleDateString() : "N/A"}</span></div>
          <div><strong>Base cost / selling</strong><span>${formatOptionalCurrency(p.costPrice)} / ${formatOptionalCurrency(getProductSellingPrice(p))}</span></div>
          <div><strong>Bulk cost / selling</strong><span>${formatOptionalCurrency(p.bulkCostPrice)} / ${formatOptionalCurrency(getProductBulkSellingPrice(p))}</span></div>
        </div>${isV2 && v2BatchStatus !== "ready" ? `<p class="field-hint">Authoritative batch details are ${v2BatchStatus === "error" ? "unavailable; refresh after resolving the sync error" : "still loading"}. Physical and sellable totals above are the server product projections, not a confirmed batch breakdown.</p>` : ""}</details>
      </article>
    `;
  });

  html += "</div>";

  renderPage(html);
}

window.renderInventory = renderInventory;
window.updateInventorySearch = updateInventorySearch;

function getUnitsPerBulk(product) {
  const unitsPerBulk = Number(product.unitsPerBulk);
  return Number.isFinite(unitsPerBulk) && unitsPerBulk > 0 ? unitsPerBulk : 1;
}

function formatQuantity(quantity, product) {
  const unitsPerBulk = getUnitsPerBulk(product);
  const total = Number(quantity || 0);
  return `${Math.floor(total / unitsPerBulk)} ${product.bulkUnit || "bulk unit"}(s) and ${total % unitsPerBulk} ${product.baseUnit || "base unit"}(s)`;
}

function getProductSellingPrice(product) {
  return app.resolveCurrentSellingPrice?.(product, "base") ?? Number(product.sellingPrice || 0);
}

function getProductBulkSellingPrice(product) {
  return app.resolveCurrentSellingPrice?.(product, "bulk") ?? Number(product.bulkSellingPrice || 0);
}

function formatOptionalCurrency(value) {
  return Number.isFinite(Number(value)) ? formatReceiptCurrency(Number(value)) : "N/A";
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

function updateInventorySearch(value = "") {
  inventorySearchQuery = value;
  renderInventory();

  const searchInput = document.getElementById("inventorySearch");

  if (searchInput) {
    searchInput.focus();
    searchInput.setSelectionRange(value.length, value.length);
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
