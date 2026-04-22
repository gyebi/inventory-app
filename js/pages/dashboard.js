const {
  ensureStockState,
  formatReceiptCurrency,
  formatStock,
  getExpiredStockQuantity,
  openModal,
  renderPage,
  resetData,
  state
} = window.app;

function renderDashboard() {
  ensureStockState();

  const totalSales = state.sales.reduce((sum, sale) => sum + getTotalUnitsSold(sale), 0);
  const totalProfit = state.sales.reduce((sum, sale) => sum + getSaleProfit(sale), 0);
  const lowStockProducts = state.products.filter((product) => product.quantity < 10);

  renderPage(`
    <div class="page-title">
      <h2>📊 Dashboard</h2>
      <p>Quick view of products, sales, profit, and low stock.</p>
    </div>

    <div class="stats-grid">
      <button class="card stat-card stat-button" onclick="showDashboardDetails('products')">
        <span>🧾</span>
        <strong>${state.products.length}</strong>
        <small>Total Products</small>
      </button>

      <button class="card stat-card stat-button" onclick="showDashboardDetails('sales')">
        <span>📦</span>
        <strong>${totalSales}</strong>
        <small>Items Sold</small>
      </button>

      <button class="card stat-card stat-button" onclick="showDashboardDetails('profit')">
        <span>💰</span>
        <strong>${formatReceiptCurrency(totalProfit)}</strong>
        <small>Total Profit</small>
      </button>

      <button class="card stat-card stat-button" onclick="showDashboardDetails('lowStock')">
        <span>⚠️</span>
        <strong>${lowStockProducts.length}</strong>
        <small>Low Stock Items</small>
      </button>
    </div>

    <button class="danger-button" onclick="resetData()">Reset Data</button>
  `);
}

function showDashboardDetails(type) {
  let title = "";
  let body = "";

  if (type === "products") {
    title = "Product Report";
    body = state.products.length === 0
      ? `<div class="card">No products added yet.</div>`
      : state.products
        .slice()
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((product, index) => `
          <div class="card dashboard-detail-card">
            <strong>${index + 1}. ${product.name}</strong><br>
            Category: ${product.category}<br>
            Total Base Units: ${product.quantity} ${product.baseUnit}(s)<br>
            Stock: ${formatStock(product)}<br>
            Expired Stock: ${getExpiredStockQuantity(product.id)} ${product.baseUnit}(s)<br>
            Base Price: ${formatReceiptCurrency(product.sellingPrice)}<br>
            Bulk Price: ${formatReceiptCurrency(product.bulkSellingPrice ?? 0)}
          </div>
        `).join("");
  }

  if (type === "sales") {
    title = "Items Sold";
    body = state.sales.length === 0
      ? `<div class="card">No sales recorded yet.</div>`
      : state.sales.slice().reverse().map((sale) => `
          <div class="card dashboard-detail-card">
            <strong>${getSalePrimaryName(sale)}</strong><br>
            Quantity: ${getSaleQuantitySummary(sale)}<br>
            Base Units: ${getTotalUnitsSold(sale)}<br>
            Amount: ${formatReceiptCurrency(sale.totalAmount)}<br>
            Time: ${getSaleTimestamp(sale)}
          </div>
        `).join("");
  }

  if (type === "profit") {
    title = "Total Profit";
    body = state.sales.length === 0
      ? `<div class="card">No profit entries yet.</div>`
      : state.sales.slice().reverse().map((sale) => `
          <div class="card dashboard-detail-card">
            <strong>${getSalePrimaryName(sale)}</strong><br>
            Profit: ${formatReceiptCurrency(getSaleProfit(sale))}<br>
            Amount: ${formatReceiptCurrency(sale.totalAmount)}<br>
            Quantity: ${getSaleQuantitySummary(sale)}<br>
            Time: ${getSaleTimestamp(sale)}
          </div>
        `).join("");
  }

  if (type === "lowStock") {
    const lowStockProducts = state.products.filter((product) => product.quantity < 10);
    title = "Low Stock Items";
    body = lowStockProducts.length === 0
      ? `<div class="card">No low stock items right now.</div>`
      : lowStockProducts.map((product) => `
          <div class="card dashboard-detail-card">
            <strong>${product.name}</strong><br>
            Stock: ${product.quantity} ${product.baseUnit}(s)<br>
            Expired: ${getExpiredStockQuantity(product.id)} ${product.baseUnit}(s)<br>
            Equivalent: ${formatStock(product)}<br>
            Reorder Level Alert: Below 10 base units
          </div>
        `).join("");
  }

  openModal(`
    <div class="dashboard-modal">
      <h3>${title}</h3>
      <div class="dashboard-detail-list">${body}</div>
    </div>
  `);
}

function getSaleItems(sale) {
  return Array.isArray(sale.items) ? sale.items : [];
}

function getTotalUnitsSold(sale) {
  const items = getSaleItems(sale);

  if (items.length > 0) {
    return items.reduce((sum, item) => sum + (item.actualQtySold || item.quantity || 0), 0);
  }

  return sale.actualQtySold || sale.qty || 0;
}

function getSaleProfit(sale) {
  return sale.profit ?? sale.totalProfit ?? 0;
}

function getSalePrimaryName(sale) {
  const items = getSaleItems(sale);

  if (items.length > 0) {
    return items.map((item) => item.name).join(", ");
  }

  return sale.product || "Sale";
}

function getSaleQuantitySummary(sale) {
  const items = getSaleItems(sale);

  if (items.length > 0) {
    return items.map((item) => `${item.quantity} ${item.unit}(s)`).join(", ");
  }

  return `${sale.qty} ${sale.saleUnit}(s)`;
}

function getSaleTimestamp(sale) {
  if (sale.createdAt) {
    return new Date(sale.createdAt).toLocaleString();
  }

  return sale.date || "N/A";
}

window.renderDashboard = renderDashboard;
window.showDashboardDetails = showDashboardDetails;
