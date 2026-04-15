function renderDashboard() {
  let totalSales = state.sales.reduce((sum, s) => sum + s.qty, 0);

  let totalProfit = state.sales.reduce((sum, s) => sum + s.totalProfit, 0);

  let lowStock = state.products.filter(p => p.quantity < 10).length;

  app.innerHTML = `
    <h2>📊 Dashboard</h2>

    <div class="card">🧾 Total Products: ${state.products.length}</div>

    <div class="card">📦 Items Sold: ${totalSales}</div>

    <div class="card">💰 Total Profit: ${totalProfit}</div>

    <div class="card">⚠️ Low Stock Items: ${lowStock}</div>

    <button onclick = "resetData()">Reset Data</button>
  `;


}
