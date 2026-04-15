function renderDashboard() {
  let totalSales = state.sales.reduce((sum, s) => sum + (s.actualQtySold || s.qty), 0);

  let totalProfit = state.sales.reduce((sum, s) => sum + s.totalProfit, 0);

  let lowStock = state.products.filter(p => p.quantity < 10).length;

  renderPage(`
    <div class="page-title">
      <h2>📊 Dashboard</h2>
      <p>Quick view of products, sales, profit, and low stock.</p>
    </div>

    <div class="stats-grid">
      <div class="card stat-card">
        <span>🧾</span>
        <strong>${state.products.length}</strong>
        <small>Total Products</small>
      </div>

      <div class="card stat-card">
        <span>📦</span>
        <strong>${totalSales}</strong>
        <small>Items Sold</small>
      </div>

      <div class="card stat-card">
        <span>💰</span>
        <strong>${totalProfit}</strong>
        <small>Total Profit</small>
      </div>

      <div class="card stat-card">
        <span>⚠️</span>
        <strong>${lowStock}</strong>
        <small>Low Stock Items</small>
      </div>
    </div>

    <button class="danger-button" onclick="resetData()">Reset Data</button>
  `);


}
