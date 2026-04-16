function renderDashboard() {
  const totalSales = state.sales.reduce((sum, sale) => sum + (sale.actualQtySold || sale.qty), 0);
  const totalProfit = state.sales.reduce((sum, sale) => sum + (sale.totalProfit || 0), 0);
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
        <strong>${totalProfit}</strong>
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
    title = "Total Products";
    body = state.products.length === 0
      ? `<div class="card">No products added yet.</div>`
      : state.products.map((product) => `
          <div class="card dashboard-detail-card">
            <strong>${product.name}</strong><br>
            Category: ${product.category}<br>
            Stock: ${formatStock(product)}<br>
            Base Price: ${product.sellingPrice}<br>
            Bulk Price: ${product.bulkSellingPrice ?? 0}
          </div>
        `).join("");
  }

  if (type === "sales") {
    title = "Items Sold";
    body = state.sales.length === 0
      ? `<div class="card">No sales recorded yet.</div>`
      : state.sales.slice().reverse().map((sale) => `
          <div class="card dashboard-detail-card">
            <strong>${sale.product}</strong><br>
            Quantity: ${sale.qty} ${sale.saleUnit}(s)<br>
            Base Units: ${sale.actualQtySold}<br>
            Amount: ${sale.totalAmount}<br>
            Time: ${sale.date}
          </div>
        `).join("");
  }

  if (type === "profit") {
    title = "Total Profit";
    body = state.sales.length === 0
      ? `<div class="card">No profit entries yet.</div>`
      : state.sales.slice().reverse().map((sale) => `
          <div class="card dashboard-detail-card">
            <strong>${sale.product}</strong><br>
            Profit: ${sale.totalProfit}<br>
            Amount: ${sale.totalAmount}<br>
            Quantity: ${sale.qty} ${sale.saleUnit}(s)<br>
            Time: ${sale.date}
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
