import {
  getExpiryAlerts as selectExpiryAlerts,
  getLowStockProducts as selectLowStockProducts,
  getRecentSales as selectRecentSales,
  getSalesTrend as selectSalesTrend,
  getStockValuation as selectStockValuation,
  getTodaySales as selectTodaySales,
  getSellableProductQuantity,
  isActiveProduct
} from "../dashboardSelectors.js";
import { hasPermission } from "../services/authService.js";
import { canAccessReportAction } from "../utils/hubNavigation.js";
import { getWeeklyStocktakingAlert } from "../utils/weeklyStocktakingSchedule.js";

const app = /** @type {any} */ (window).app;
const {
  ensureStockState,
  formatReceiptCurrency,
  getCurrentPage,
  getDisplayStockBatches,
  getExpiredStockQuantity,
  getSellableQuantity,
  openModal,
  refreshFromCloud,
  renderPage,
  state
} = app;

const dateFilterReportTypes = new Set([
  "salesByProduct",
  "salesPeriods",
  "profit",
  "stockMovement",
  "damagedLost",
  "purchases"
]);

const reportDateFilters = {};
const reportSalesPersonFilters = {};

function renderDashboard() {
  ensureStockState();

  if (getCurrentPage?.() === "reports") {
    renderReportsPage();
    return;
  }

  const now = new Date();
  const products = Array.isArray(state.products) ? state.products : [];
  const sales = Array.isArray(state.sales) ? state.sales : [];
  const lowStockProducts = selectLowStockProducts(products, state.settings || {});
  const expiryAlerts = selectExpiryAlerts(getDisplayStockBatches(), products, now);
  const salesTrend = selectSalesTrend(sales, now);
  const recentSales = selectRecentSales(sales);
  const activeProducts = products.filter(isActiveProduct).length;
  const todaySales = selectTodaySales(sales, now);
  const stockValuation = selectStockValuation(products);
  const canViewBusinessOverview = hasPermission("view_dashboard");
  const canManageStock = hasPermission("manage_stock");
  const canAddProducts = hasPermission("add_product");
  const canCreateSales = hasPermission("create_sale");
  const canViewReports = canAccessReportAction(hasPermission);
  const canViewInventoryData = canManageStock || canAddProducts;
  const stocktakingAlert = canManageStock ? getWeeklyStocktakingAlert(state) : null;
  const kpis = [
    canViewBusinessOverview
      ? renderKpiCard("sales", "Today’s Sales", formatReceiptCurrency(todaySales), "Sales completed today", canCreateSales ? "sales" : (canViewReports ? "reports" : ""))
      : "",
    canViewInventoryData
      ? renderKpiCard("products", "Total Products", String(activeProducts), `${lowStockProducts.length} low in stock`, canManageStock ? "inventory" : "")
      : "",
    canViewReports && stockValuation.supported
      ? renderKpiCard("value", "Total Stock Value", formatReceiptCurrency(stockValuation.amount), "At recorded cost price", "reports")
      : "",
    canManageStock
      ? renderKpiCard("alerts", "Stock Alerts", String(lowStockProducts.length + expiryAlerts.length), `${lowStockProducts.length} low stock · ${expiryAlerts.length} expiry`, "inventory")
      : ""
  ].filter(Boolean).join("");
  const quickActions = [
    canCreateSales ? renderQuickAction("New Sale (POS)", "sales", "🛒") : "",
    canManageStock ? renderQuickAction("Receive Stock", "receiveStock", "⇩") : "",
    canAddProducts ? renderQuickAction("Add Product", "addProduct", "＋") : "",
    canViewReports ? renderQuickAction("View Reports", "reports", "▥") : ""
  ].filter(Boolean).join("");
  const stockPanels = canManageStock ? `
    ${stocktakingAlert ? `<section class="jyaano-panel jyaano-expiry-panel"><div class="jyaano-panel-heading"><div><h3>Weekly stocktaking</h3><p>${escapeHtml(stocktakingAlert.message)}</p></div><button class="jyaano-text-button" type="button" onclick="navigate('stocktakingPrototype')">Open stocktaking</button></div></section>` : ""}
    <section class="jyaano-panel">
      <div class="jyaano-panel-heading"><div><h3>Low Stock Items</h3><p>Items at or below their reorder level</p></div><button class="jyaano-text-button" type="button" onclick="navigate('inventory')">View all</button></div>
      ${renderLowStockTable(lowStockProducts)}
    </section>
    ${expiryAlerts.length ? `<section class="jyaano-panel jyaano-expiry-panel"><div class="jyaano-panel-heading"><div><h3>Stock Expiry Alerts</h3><p>Current batches requiring attention</p></div><button class="jyaano-text-button" type="button" onclick="navigate('inventory')">View inventory</button></div>${renderExpiryAlerts(expiryAlerts)}</section>` : ""}
  ` : "";
  const salesPanels = canViewBusinessOverview ? `
    <section class="jyaano-panel jyaano-trend-panel">
      <div class="jyaano-panel-heading"><div><h3>Sales Trend</h3><p>Actual sales for the last 7 days</p></div><span class="jyaano-period">This week</span></div>
      ${renderSalesTrend(salesTrend)}
    </section>
  ` : "";
  const recentSalesPanel = canViewBusinessOverview ? `
    <section class="jyaano-panel jyaano-recent-panel">
      <div class="jyaano-panel-heading"><div><h3>Recent Sales</h3><p>Latest completed transactions</p></div>${canViewReports ? `<button class="jyaano-text-button" type="button" onclick="navigate('reports')">View all</button>` : ""}</div>
      ${renderRecentSales(recentSales)}
    </section>
  ` : "";
  const noOverviewMessage = !kpis && !salesPanels && !stockPanels
    ? `<section class="jyaano-panel"><h3>Dashboard ready</h3><p>Your available tools are listed in the navigation. Contact an administrator if you need access to additional business data.</p></section>`
    : "";

  renderPage(`
    <div class="jyaano-dashboard">
      <section class="jyaano-welcome-banner">
        <img class="jyaano-dashboard-mobile-logo" src="/jyaanc-kente-hat-logo.png" alt="Jyaano">
        <div>
          <p class="jyaano-eyebrow">Business overview</p>
          <h2>Good ${getTimeGreeting(now)}!</h2>
          <p>Here’s what’s happening in your business today.</p>
        </div>
        <div class="jyaano-banner-pattern" aria-hidden="true"></div>
      </section>

      ${kpis ? `<div class="jyaano-kpi-grid">${kpis}</div>` : ""}

      <div class="jyaano-dashboard-layout">
        <div class="jyaano-main-column">
          ${salesPanels}
          ${stockPanels}
          ${noOverviewMessage}
        </div>

        <div class="jyaano-side-column">
          ${quickActions ? `<section class="jyaano-quick-actions">
            <h3>Quick Actions <span aria-hidden="true">ϟ</span></h3>
            ${quickActions}
          </section>` : ""}
          ${recentSalesPanel}
        </div>
      </div>
    </div>
  `);
}

function renderKpiCard(tone, label, value, detail, destination) {
  const content = `
    <span class="jyaano-kpi-icon" aria-hidden="true">${getKpiIcon(tone)}</span>
    <span class="jyaano-kpi-label">${label}</span>
    <strong>${value}</strong>
    <small>${detail}</small>`;

  return destination
    ? `<button class="jyaano-kpi-card jyaano-kpi-${tone}" type="button" onclick="navigate('${destination}')">${content}</button>`
    : `<div class="jyaano-kpi-card jyaano-kpi-${tone}">${content}</div>`;
}

function getKpiIcon(tone) {
  return ({ sales: "🛒", products: "◈", value: "▥", alerts: "!" })[tone] || "•";
}

function renderQuickAction(label, destination, icon) {
  return `<button type="button" onclick="navigate('${destination}')"><span aria-hidden="true">${icon}</span>${label}<b aria-hidden="true">›</b></button>`;
}

function renderSalesTrend(points) {
  const max = Math.max(...points.map((point) => point.amount), 1);
  const labels = points.map((point) => new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(point.date));
  return `<div class="jyaano-chart" role="img" aria-label="Sales trend for the last seven days">
    <div class="jyaano-chart-bars">${points.map((point, index) => `<div class="jyaano-chart-bar-wrap"><span class="jyaano-chart-value">${point.amount ? escapeHtml(formatReceiptCurrency(point.amount)) : ""}</span><i style="height:${Math.max((point.amount / max) * 100, point.amount ? 5 : 0)}%"></i><small>${labels[index]}</small></div>`).join("")}</div>
  </div>`;
}

function renderLowStockTable(products) {
  if (!products.length) return `<div class="jyaano-empty-state">All active products are above their reorder level.</div>`;
  return `<div class="jyaano-table-wrap"><table class="jyaano-table"><thead><tr><th>Product</th><th>Current stock</th><th>Reorder level</th><th>Status</th></tr></thead><tbody>${products.slice(0, 5).map((product) => `<tr><td title="${escapeHtml(product.name || "Unnamed product")}"><strong>${escapeHtml(product.name || "Unnamed product")}</strong></td><td class="jyaano-number-danger">${escapeHtml(formatStockQuantity(product))}</td><td>${escapeHtml(String(getProductLowStockThreshold(product)))}</td><td><span class="jyaano-status-badge">Low stock</span></td></tr>`).join("")}</tbody></table></div>`;
}

function renderExpiryAlerts(alerts) {
  return `<div class="jyaano-alert-list">${alerts.slice(0, 5).map((alert) => `<div class="jyaano-expiry-row"><div><strong>${escapeHtml(alert.productName)}</strong><span>${escapeHtml(formatStockBatchQuantity(alert))} · expires ${escapeHtml(formatShortDate(alert.expiry))}</span></div><b class="${alert.status === "Expired" ? "is-expired" : ""}">${alert.status}</b></div>`).join("")}</div>`;
}

function renderRecentSales(recentSales) {
  if (!recentSales.length) return `<div class="jyaano-empty-state">No completed sales have been recorded yet.</div>`;
  return `<div class="jyaano-recent-sales">${recentSales.map(({ sale, date }) => `<div><time datetime="${date.toISOString()}">${escapeHtml(new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(date))}</time><span title="${escapeHtml(getSalePrimaryName(sale))}">${escapeHtml(getSalePrimaryName(sale))}</span><strong>${formatReceiptCurrency(getDashboardSaleAmount(sale))}</strong></div>`).join("")}</div>`;
}

function getDashboardSaleAmount(sale) {
  const amount = Number(sale.totalAmount ?? sale.total);
  return Number.isFinite(amount) ? amount : getSaleItems(sale).reduce((sum, item) => sum + Number(item.total || 0), 0);
}

function formatStockQuantity(product) {
  return `${getSellableQuantity(product)} ${product.baseUnit || "units"}`;
}

function formatStockBatchQuantity(batch) {
  return `${Number(batch.quantity || 0)} ${batch.baseUnit || "units"}`;
}

function formatShortDate(value) {
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(value);
}

function getTimeGreeting(date) {
  const hour = date.getHours();
  if (hour < 12) return "Morning";
  if (hour < 18) return "Afternoon";
  return "Evening";
}

function renderReportsPage() {
  if (!canAccessReportAction(hasPermission)) {
    renderPage(`
      <div class="page-title">
        <h2>Access Denied</h2>
        <p>You do not have permission to view reports.</p>
      </div>
      <button type="button" onclick="navigate('dashboard')">Back to Dashboard</button>
    `);
    return;
  }

  renderPage(`
    <div class="page-title">
      <h2>📑 Reports</h2>
      <p>Open and print stock, sales, profit, purchase, and valuation reports.</p>
    </div>

    <div class="stats-grid">
      ${renderReportCard("lowStock", "⚠️", "Low Stock Report", "See items below reorder level")}
      ${renderReportCard("reorder", "🔁", "Reorder Report", "Highlight products that need replenishment")}
      ${renderReportCard("salesByProduct", "🛒", "Sales by Product Report", "Summarize sales grouped by product")}
      ${renderReportCard("salesPeriods", "🗓️", "Daily/Weekly/Monthly Sales", "Compare sales across time periods")}
      ${renderReportCard("profit", "💰", "Sales Report by Sales Person", "Review sales grouped by cashier")}
      ${renderReportCard("stockMovement", "📈", "Stock Movement Report", "Track stock in and stock out")}
      ${renderReportCard("batchStock", "🧺", "Batch Stock Report", "Review every batch with cost and remaining stock")}
      ${renderReportCard("damagedLost", "🧯", "Damaged/Lost Items Report", "Show adjustments for damaged or lost stock")}
      ${renderReportCard("purchases", "📥", "Purchase Report", "List stock receipts and supplier purchases")}
      ${renderReportCard("inventoryValuation", "🏷️", "Inventory Valuation Report", "Estimate stock value using cost price")}
    </div>
  `);
}

function renderReportCard(type, icon, title, text) {
  return `
    <button class="card stat-card stat-button report-card-button" onclick="showDashboardDetails('${type}')">
      <span>${icon}</span>
      <strong>${title}</strong>
      <small>${text}</small>
    </button>
  `;
}

function showDashboardDetails(type) {
  if (!canAccessReportAction(hasPermission)) {
    return false;
  }

  const report = buildReport(type);

  openModal(`
    <div class="dashboard-modal printable-report">
      <h3>${report.title}</h3>
      ${report.subtitle ? `<p class="report-subtitle">${report.subtitle}</p>` : ""}
      ${renderReportDateFilters(type)}
      ${renderSalesPersonFilter(type)}
      <div class="dashboard-detail-list">${report.body}</div>
      <div class="report-actions">
        <button type="button" onclick="printModalReport()">Print Report</button>
        <button type="button" onclick="closeModal()">Close</button>
      </div>
    </div>
  `);
  return true;
}

function renderReportDateFilters(type) {
  if (!dateFilterReportTypes.has(type)) {
    return "";
  }

  const filters = getReportDateFilters(type);

  return `
    <div class="report-filter-row">
      <label>
        <span>From</span>
        <input
          type="date"
          value="${filters.from}"
          onchange="updateReportDateFilter('${type}', 'from', this.value)"
        >
      </label>
      <label>
        <span>To</span>
        <input
          type="date"
          value="${filters.to}"
          onchange="updateReportDateFilter('${type}', 'to', this.value)"
        >
      </label>
      <button type="button" onclick="clearReportFilters('${type}')">Clear Filters</button>
    </div>
  `;
}

function renderSalesPersonFilter(type) {
  if (type !== "profit") {
    return "";
  }

  const selectedSalesPerson = getReportSalesPersonFilter(type);
  const salesPeople = getSalesPeopleForFilter();

  return `
    <div class="report-filter-row">
      <label>
        <span>Sales Person</span>
        <select onchange="updateReportSalesPersonFilter('${type}', this.value)">
          <option value="">All Sales Persons</option>
          ${salesPeople.map((person) => `
            <option value="${escapeHtml(person.key)}" ${person.key === selectedSalesPerson ? "selected" : ""}>
              ${escapeHtml(person.name)}
            </option>
          `).join("")}
        </select>
      </label>
    </div>
  `;
}

function buildReport(type) {
  const generatedAt = `Generated ${new Date().toLocaleString()}${getReportFilterSummary(type)}`;

  if (type === "products") {
    return {
      title: "Product Report",
      subtitle: generatedAt,
      body: buildProductReport()
    };
  }

  if (type === "lowStock") {
    return {
      title: "Low Stock Report",
      subtitle: generatedAt,
      body: buildLowStockReport()
    };
  }

  if (type === "reorder") {
    return {
      title: "Reorder Report",
      subtitle: generatedAt,
      body: buildReorderReport()
    };
  }

  if (type === "salesByProduct") {
    return {
      title: "Sales by Product Report",
      subtitle: generatedAt,
      body: buildSalesByProductReport()
    };
  }

  if (type === "salesPeriods") {
    return {
      title: "Daily/Weekly/Monthly Sales Report",
      subtitle: generatedAt,
      body: buildSalesPeriodReport()
    };
  }

  if (type === "profit") {
    return {
      title: "Sales Report by Sales Person",
      subtitle: generatedAt,
      body: buildSalesBySalesPersonReport()
    };
  }

  if (type === "stockMovement") {
    return {
      title: "Stock Movement Report",
      subtitle: generatedAt,
      body: buildStockMovementReport()
    };
  }

  if (type === "batchStock") {
    return {
      title: "Batch Stock Report",
      subtitle: generatedAt,
      body: buildBatchStockReport()
    };
  }

  if (type === "damagedLost") {
    return {
      title: "Damaged/Lost Items Report",
      subtitle: generatedAt,
      body: buildDamagedLostReport()
    };
  }

  if (type === "purchases") {
    return {
      title: "Purchase Report",
      subtitle: generatedAt,
      body: buildPurchaseReport()
    };
  }

  if (type === "inventoryValuation") {
    return {
      title: "Inventory Valuation Report",
      subtitle: generatedAt,
      body: buildInventoryValuationReport()
    };
  }

  if (type === "supplierOwed") {
    return {
      title: "Supplier Amount Owed",
      subtitle: generatedAt,
      body: buildSupplierAmountOwedReport()
    };
  }

  return {
    title: "Report",
    subtitle: generatedAt,
    body: `<div class="card">This report is not available yet.</div>`
  };
}

function buildProductReport() {
  if (state.products.length === 0) {
    return `<div class="card">No products added yet.</div>`;
  }

  return buildTableMarkup(
    ["Product", "Category", "Base Price", "Bulk Price", "Units per Bulk"],
    state.products
      .slice()
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((product) => [
        product.name,
        product.category || "N/A",
        formatOptionalCurrency(product.sellingPrice),
        formatOptionalCurrency(product.bulkSellingPrice),
        `${product.unitsPerBulk || 1} ${product.baseUnit}(s)`
      ])
  );
}

function buildLowStockReport() {
  const lowStockProducts = getLowStockProducts();

  if (lowStockProducts.length === 0) {
    return `<div class="card">No low stock items right now.</div>`;
  }

  return buildTableMarkup(
    ["Product", "Current Stock", "Threshold", "Expired Stock", "Action"],
    lowStockProducts.map((product) => [
      product.name,
      `${getSellableQuantity(product)} ${product.baseUnit}(s)`,
      `${getProductLowStockThreshold(product)} ${product.baseUnit}(s)`,
      `${getExpiredStockQuantity(product.id)} ${product.baseUnit}(s)`,
      "Restock soon"
    ])
  );
}

function buildReorderReport() {
  const reorderProducts = state.products
    .filter((product) => getSellableProductQuantity(product) <= getProductLowStockThreshold(product))
    .sort((left, right) => left.name.localeCompare(right.name));

  if (reorderProducts.length === 0) {
    return `<div class="card">No products currently require reordering.</div>`;
  }

  return buildTableMarkup(
    ["Product", "Current Stock", "Reorder Level", "Suggested Order", "Supplier"],
    reorderProducts.map((product) => {
      const reorderLevel = getProductLowStockThreshold(product);
      const sellableQuantity = getSellableProductQuantity(product);
      const suggestedOrder = Math.max((reorderLevel * 2) - sellableQuantity, 0);
      const recentSupplier = getLatestSupplierForProduct(product.id);

      return [
        product.name,
        `${sellableQuantity} ${product.baseUnit}(s)`,
        `${reorderLevel} ${product.baseUnit}(s)`,
        `${suggestedOrder} ${product.baseUnit}(s)`,
        recentSupplier || "N/A"
      ];
    })
  );
}

function buildSalesByProductReport() {
  const groupedSales = getSalesGroupedByProduct(getFilteredSales("salesByProduct"));

  if (groupedSales.length === 0) {
    return `<div class="card">No sales recorded yet.</div>`;
  }

  return buildTableMarkup(
    ["Product", "Base Units Sold", "Bulk Units Sold", "Sales Amount", "Profit", "Transactions"],
    groupedSales.map((entry) => [
      entry.name,
      `${entry.baseUnits} ${entry.baseUnit}(s)`,
      `${entry.bulkUnits} ${entry.bulkUnit}(s)`,
      formatReceiptCurrency(entry.amount),
      formatReceiptCurrency(entry.profit),
      String(entry.transactions)
    ])
  );
}

function buildSalesPeriodReport() {
  const today = new Date();
  const sales = getFilteredSales("salesPeriods");
  const periods = [
    buildSalesPeriodSummary(sales, "Today", (saleDate) => isSameDay(saleDate, today)),
    buildSalesPeriodSummary(sales, "This Week", (saleDate) => isInCurrentWeek(saleDate, today)),
    buildSalesPeriodSummary(sales, "This Month", (saleDate) => isInCurrentMonth(saleDate, today))
  ];

  return buildTableMarkup(
    ["Period", "Transactions", "Base Units Sold", "Bulk Units Sold", "Sales Amount", "Profit"],
    periods.map((period) => [
      period.label,
      String(period.transactions),
      String(period.units),
      String(period.bulkUnits),
      formatReceiptCurrency(period.amount),
      formatReceiptCurrency(period.profit)
    ])
  );
}

function buildSalesBySalesPersonReport() {
  const sales = getFilteredSales("profit");

  if (sales.length === 0) {
    return `<div class="card">No sales recorded for the selected filters.</div>`;
  }

  return buildTableMarkup(
    ["Date", "Sales Person", "Products", "Sales Amount", "Profit"],
    sales
      .slice()
      .sort((left, right) => getReportTime(right.createdAt || right.date) - getReportTime(left.createdAt || left.date))
      .map((sale) => [
        getSaleTimestamp(sale),
        getSalePersonName(sale),
        getSalePrimaryName(sale),
        formatReceiptCurrency(sale.totalAmount),
        formatReceiptCurrency(getSaleProfit(sale))
      ])
  );
}

function buildStockMovementReport() {
  const movements = [
    ...state.stockReceipts.map((receipt) => ({
      type: "Stock In",
      date: receipt.receivedAt || receipt.createdAt || "",
      product: receipt.product || getProductName(receipt.productId),
      quantity: `${Number(receipt.quantityReceived || 0)} ${getProductBaseUnit(receipt.productId)}(s)`,
      reference: receipt.invoiceDetails || receipt.id || "N/A",
      actor: receipt.receivedBy || "N/A"
    })),
    ...state.sales.flatMap((sale) => (
      getSaleItems(sale).map((item) => ({
        type: "Stock Out",
        date: sale.createdAt || sale.date || "",
        product: item.name,
        quantity: `${item.actualQtySold || item.quantity} ${getProductBaseUnit(item.productId)}(s)`,
        reference: sale.id,
        actor: sale.createdBy?.fullName || sale.user || "Unknown"
      }))
    ))
  ]
    .filter((movement) => isWithinReportDateRange("stockMovement", movement.date))
    .sort((left, right) => getReportTime(right.date) - getReportTime(left.date));

  if (movements.length === 0) {
    return `<div class="card">No stock movements recorded yet.</div>`;
  }

  return buildTableMarkup(
    ["Date", "Type", "Product", "Quantity", "Reference", "By"],
    movements.map((movement) => [
      formatDateTime(movement.date),
      movement.type,
      movement.product,
      movement.quantity,
      movement.reference,
      movement.actor
    ])
  );
}

function buildBatchStockReport() {
  const batches = getDisplayStockBatches()
    .slice()
    .sort((left, right) => {
      const leftReceived = getReportTime(left.receivedAt || left.purchaseDate || left.createdAt);
      const rightReceived = getReportTime(right.receivedAt || right.purchaseDate || right.createdAt);
      return rightReceived - leftReceived;
    });

  if (batches.length === 0) {
    return `<div class="card">No batches recorded yet.</div>`;
  }

  const headers = [
    "Batch Number",
    "Product",
    "Supplier",
    "Date Received",
    "Expiry Date",
    "Original Quantity",
    "Remaining Quantity",
    "Total Landed Cost",
    "Unit Cost",
    "Selling Price",
    "Remaining Stock Value"
  ];

  const rows = batches.map((batch) => {
    const receipt = getReceiptByBatchId(batch.id);
    const originalQuantity = Number(batch.originalBaseQuantity ?? receipt?.quantityReceived ?? batch.quantity ?? 0);
    const remainingQuantity = Number(batch.isAuthoritativeV2 ? batch.remainingBaseQuantity : batch.quantity || 0);
    const unitCost = Number(batch.unitCost ?? receipt?.unitCost ?? 0);
    const product = getProductById(batch.productId);
    const sellingPrice = batch.isAuthoritativeV2
      ? Number(app.resolveCurrentSellingPrice?.(product, "base") || 0)
      : Number(batch.unitSellingPrice ?? receipt?.unitSellingPrice ?? 0);
    const landedCost = Number(batch.totalLandedCost ?? receipt?.totalLandedCost ?? receipt?.lineTotal ?? (originalQuantity * unitCost));

    return [
      batch.id || receipt?.batchId || "N/A",
      batch.productName || receipt?.product || getProductName(batch.productId),
      batch.supplier || receipt?.supplier || "N/A",
      formatDateTime(batch.receivedAt || batch.purchaseDate || receipt?.receivedAt || receipt?.purchaseDate || ""),
      batch.expiryDate ? formatDate(batch.expiryDate) : "N/A",
      String(originalQuantity),
      String(remainingQuantity),
      formatReceiptCurrency(landedCost),
      formatReceiptCurrency(unitCost),
      formatReceiptCurrency(sellingPrice),
      formatReceiptCurrency(remainingQuantity * unitCost)
    ];
  });

  const totalRemainingValue = batches.reduce((sum, batch) => {
    const receipt = getReceiptByBatchId(batch.id);
    const remainingQuantity = Number(batch.isAuthoritativeV2 ? batch.remainingBaseQuantity : batch.quantity || 0);
    const unitCost = Number(batch.unitCost ?? receipt?.unitCost ?? 0);
    return sum + (remainingQuantity * unitCost);
  }, 0);

  return `
    ${buildTableMarkup(headers, rows)}
    <div class="card report-total-card">
      <strong>Total Remaining Batch Value:</strong> ${formatReceiptCurrency(totalRemainingValue)}
    </div>
  `;
}

function buildDamagedLostReport() {
  const adjustments = getDamagedLostAdjustments()
    .filter((adjustment) => isWithinReportDateRange("damagedLost", getAdjustmentDate(adjustment)))
    .sort((left, right) => getReportTime(getAdjustmentDate(right)) - getReportTime(getAdjustmentDate(left)));

  const headers = [
    "Date",
    "Product Name",
    "Product ID",
    "Category",
    "Quantity Affected",
    "Unit",
    "Adjustment Type",
    "Reason / Notes",
    "Cost Price",
    "Total Loss Value",
    "Batch Number",
    "Expiry Date",
    "Recorded By",
    "Branch / Warehouse"
  ];

  const table = buildTableMarkup(
    headers,
    adjustments.map((adjustment) => {
      const product = getProductById(adjustment.productId);
      const quantityAffected = Number(adjustment.quantityAffected ?? adjustment.quantity ?? 0);
      const unit = adjustment.unit || product?.baseUnit || "N/A";
      const costPrice = Number(adjustment.costPrice ?? product?.costPrice ?? 0);
      const totalLossValue = Number(adjustment.totalLossValue ?? adjustment.lossValue ?? (quantityAffected * costPrice));

      return [
        formatDateTime(getAdjustmentDate(adjustment)),
        adjustment.productName || adjustment.product || product?.name || "Unknown product",
        adjustment.productId || product?.id || "N/A",
        adjustment.category || product?.category || "N/A",
        String(quantityAffected),
        unit,
        adjustment.adjustmentType || adjustment.type || "N/A",
        adjustment.reason || adjustment.notes || "N/A",
        formatReceiptCurrency(costPrice),
        formatReceiptCurrency(totalLossValue),
        adjustment.batchNumber || adjustment.batchId || "N/A",
        adjustment.expiryDate ? formatDate(adjustment.expiryDate) : "N/A",
        getAdjustmentRecorder(adjustment),
        adjustment.branch || adjustment.warehouse || adjustment.location || "N/A"
      ];
    })
  );

  if (adjustments.length > 0) {
    return table;
  }

  return `
    <div class="card">
      No damaged or lost stock adjustments have been recorded yet.
      Add a stock adjustment workflow to populate this report.
    </div>
    ${table}
  `;
}

function buildPurchaseReport() {
  const receipts = state.stockReceipts.filter((receipt) => (
    isWithinReportDateRange("purchases", receipt.purchaseDate || receipt.receivedAt || receipt.createdAt)
  ));

  if (receipts.length === 0) {
    return `<div class="card">No stock receipts recorded yet.</div>`;
  }

  return buildTableMarkup(
    [
      "Supplier",
      "Invoice Number",
      "Purchase Date",
      "Due Date",
      "Product",
      "Bulk Units",
      "Base Units",
      "Quantity",
      "Unit Cost",
      "Total Amount",
      "Payment Type",
      "Notes"
    ],
    receipts
      .slice()
      .sort((left, right) => (
        getReportTime(right.purchaseDate || right.receivedAt || right.createdAt) -
        getReportTime(left.purchaseDate || left.receivedAt || left.createdAt)
      ))
      .map((receipt) => [
        receipt.supplier || "N/A",
        receipt.invoiceNumber || receipt.invoiceDetails || "N/A",
        formatDateTime(receipt.purchaseDate || receipt.receivedAt || receipt.createdAt),
        receipt.dueDate || "N/A",
        receipt.product || getProductName(receipt.productId),
        `${Number(receipt.bulkQuantityReceived ?? receipt.bulkUnitsReceived ?? 0)} ${receipt.bulkUnit || getProductBulkUnit(receipt.productId)}(s)`,
        `${Number(receipt.looseBaseQuantityReceived ?? 0)} ${receipt.baseUnit || getProductBaseUnit(receipt.productId)}(s)`,
        `${Number(receipt.quantityReceived || 0)} ${getProductBaseUnit(receipt.productId)}(s)`,
        formatReceiptCurrency(getReceiptUnitCost(receipt)),
        formatReceiptCurrency(getReceiptLandedCost(receipt)),
        receipt.paymentStatus || "N/A",
        receipt.notes || "N/A"
      ])
  );
}

function buildInventoryValuationReport() {
  if (state.products.length === 0) {
    return `<div class="card">No products added yet.</div>`;
  }

  const rows = state.products
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((product) => {
      const batchSummary = getInventoryValueSummary(product.id);

      return [
        product.name,
        `${batchSummary.quantity} ${product.baseUnit}(s)`,
        formatReceiptCurrency(batchSummary.unitCost),
        formatReceiptCurrency(batchSummary.stockValue)
      ];
    });

  const totalValue = state.products.reduce(
    (sum, product) => sum + getInventoryValueSummary(product.id).stockValue,
    0
  );

  return `
    ${buildTableMarkup(["Product", "Quantity", "Unit Cost", "Stock Value"], rows)}
    <div class="card report-total-card">
      <strong>Total Inventory Value:</strong> ${formatReceiptCurrency(totalValue)}
    </div>
  `;
}

function buildSupplierAmountOwedReport() {
  const summary = getSupplierPayablesSummary();

  if (summary.rows.length === 0) {
    return `<div class="card">No credit purchases or supplier payments recorded yet.</div>`;
  }

  const table = buildTableMarkup(
    [
      "Supplier",
      "Credit Purchases",
      "Amount Paid",
      "Discount Received",
      "Penalty Charge",
      "Amount Owed"
    ],
    summary.rows.map((row) => [
      row.supplier,
      formatReceiptCurrency(row.creditPurchases),
      formatReceiptCurrency(row.amountPaid),
      formatReceiptCurrency(row.discountReceived),
      formatReceiptCurrency(row.penaltyCharge),
      formatReceiptCurrency(row.balance)
    ])
  );

  return `
    ${table}
    <div class="card report-total-card">
      <strong>Total Amount Owed:</strong> ${formatReceiptCurrency(summary.totalBalance)}
    </div>
  `;
}

function getSupplierPayablesSummary() {
  const grouped = new Map();

  getCreditPurchaseReceipts().forEach((receipt) => {
    const supplier = getSupplierName(receipt.supplier);
    const entry = getSupplierPayableEntry(grouped, supplier);
    entry.creditPurchases += getReceiptPurchaseTotal(receipt);
  });

  (state.supplierPayments || []).forEach((payment) => {
    const supplier = getSupplierName(payment.supplier);
    const entry = getSupplierPayableEntry(grouped, supplier);
    entry.amountPaid += Number(payment.amountPaid || 0);
    entry.discountReceived += Number(payment.discountReceived || 0);
    entry.penaltyCharge += Number(payment.penaltyCharge || 0);
  });

  const rows = Array.from(grouped.values())
    .map((entry) => ({
      ...entry,
      balance: Math.max(
        entry.creditPurchases - entry.amountPaid - entry.discountReceived + entry.penaltyCharge,
        0
      )
    }))
    .sort((left, right) => right.balance - left.balance || left.supplier.localeCompare(right.supplier));

  return {
    rows,
    totalBalance: rows.reduce((sum, row) => sum + row.balance, 0)
  };
}

function getSupplierPayableEntry(grouped, supplier) {
  if (!grouped.has(supplier)) {
    grouped.set(supplier, {
      supplier,
      creditPurchases: 0,
      amountPaid: 0,
      discountReceived: 0,
      penaltyCharge: 0
    });
  }

  return grouped.get(supplier);
}

function getCreditPurchaseReceipts() {
  return (state.stockReceipts || []).filter((receipt) => isCreditPurchaseReceipt(receipt));
}

function isCreditPurchaseReceipt(receipt) {
  const paymentStatus = String(receipt.paymentStatus || receipt.paymentType || "").toLowerCase();
  return paymentStatus === "credit" || paymentStatus === "part payment";
}

function getReceiptPurchaseTotal(receipt) {
  const quantity = Number(receipt.quantityReceived || 0);
  const unitCost = Number(receipt.unitCost ?? 0);

  return Number(receipt.totalLandedCost ?? receipt.lineTotal ?? receipt.totalAmount ?? (quantity * unitCost));
}

function getSupplierName(supplier) {
  return supplier || "Unknown Supplier";
}

function buildTableMarkup(headers, rows) {
  return `
    <table class="report-table">
      <thead>
        <tr>
          ${headers.map((header) => `<th>${header}</th>`).join("")}
        </tr>
      </thead>
      <tbody>
        ${rows.map((row) => `
          <tr>
            ${row.map((cell) => `<td>${cell}</td>`).join("")}
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function getLowStockProducts() {
  return state.products.filter((product) => getSellableProductQuantity(product) <= getProductLowStockThreshold(product));
}

function getProductLowStockThreshold(product) {
  return Number(product.lowStockThreshold || state.settings?.lowStockThreshold || 10);
}

function getProductById(productId) {
  return state.products.find((product) => product.id === productId);
}

function getProductName(productId) {
  return getProductById(productId)?.name || "Unknown product";
}

function getProductBaseUnit(productId) {
  return getProductById(productId)?.baseUnit || "base unit";
}

function formatOptionalCurrency(value) {
  return Number.isFinite(Number(value)) ? formatReceiptCurrency(Number(value)) : "N/A";
}

function getProductBulkUnit(productId) {
  return getProductById(productId)?.bulkUnit || "bulk unit";
}

function getReceiptUnitCost(receipt) {
  const quantity = Number(receipt.quantityReceived || 0);
  if (quantity <= 0) {
    return Number(receipt.unitCost || 0);
  }

  const landedCost = Number(receipt.totalLandedCost ?? receipt.lineTotal ?? receipt.totalAmount ?? 0);
  return Number(receipt.unitCost ?? (landedCost / quantity));
}

function getReceiptLandedCost(receipt) {
  if (Number.isFinite(Number(receipt.totalLandedCost))) {
    return Number(receipt.totalLandedCost);
  }

  if (Number.isFinite(Number(receipt.lineTotal))) {
    return Number(receipt.lineTotal);
  }

  if (Number.isFinite(Number(receipt.totalAmount))) {
    return Number(receipt.totalAmount);
  }

  return Number(receipt.quantityReceived || 0) * getReceiptUnitCost(receipt);
}

function getInventoryValueSummary(productId) {
  const batches = getDisplayStockBatches().filter((batch) => batch.productId === productId);

  return batches.reduce((summary, batch) => {
    const quantity = Number(batch.isAuthoritativeV2 ? batch.remainingBaseQuantity : batch.quantity || 0);
    const unitCost = Number(batch.unitCost ?? getReceiptUnitCost(getReceiptByBatchId(batch.id)));
    summary.quantity += quantity;
    summary.stockValue += quantity * unitCost;
    summary.unitCost = unitCost;
    return summary;
  }, {
    quantity: 0,
    unitCost: 0,
    stockValue: 0
  });
}

function getReceiptByBatchId(batchId) {
  return (state.stockReceipts || []).find((receipt) => receipt.batchId === batchId);
}

function getDamagedLostAdjustments() {
  const adjustments = state.stockAdjustments || state.damagedLostAdjustments || state.adjustments || [];

  if (!Array.isArray(adjustments)) {
    return [];
  }

  return adjustments.filter((adjustment) => {
    const type = String(adjustment.adjustmentType || adjustment.type || "").toLowerCase();

    return [
      "damaged",
      "lost",
      "expired",
      "breakage",
      "theft",
      "leakage"
    ].includes(type);
  });
}

function getAdjustmentDate(adjustment) {
  return adjustment.date || adjustment.adjustedAt || adjustment.recordedAt || adjustment.createdAt || "";
}

function getAdjustmentRecorder(adjustment) {
  if (typeof adjustment.recordedBy === "string") {
    return adjustment.recordedBy;
  }

  return adjustment.recordedBy?.fullName ||
    adjustment.recordedBy?.username ||
    adjustment.createdBy?.fullName ||
    adjustment.createdBy?.username ||
    adjustment.user ||
    "Unknown";
}

function getLatestSupplierForProduct(productId) {
  const receipts = state.stockReceipts
    .filter((receipt) => receipt.productId === productId && receipt.supplier)
    .sort((left, right) => new Date(right.receivedAt || right.createdAt || 0).getTime() - new Date(left.receivedAt || left.createdAt || 0).getTime());

  return receipts[0]?.supplier || "";
}

function getSaleItems(sale) {
  return Array.isArray(sale.items) ? sale.items : [];
}

function getSaleBaseUnitsSold(sale) {
  return getSaleItems(sale).reduce((sum, item) => {
    if ((item.saleUnit || "").toLowerCase() === "bulk") {
      return sum;
    }

    return sum + Number(item.actualQtySold || item.quantity || 0);
  }, 0);
}

function getSaleBulkUnitsSold(sale) {
  return getSaleItems(sale).reduce((sum, item) => {
    if ((item.saleUnit || "").toLowerCase() !== "bulk") {
      return sum;
    }

    return sum + Number(item.quantity || 0);
  }, 0);
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

function getSaleTimestamp(sale) {
  if (sale.createdAt) {
    return formatDateTime(sale.createdAt);
  }

  return sale.date || "N/A";
}

function getSalesGroupedByProduct(sales = state.sales) {
  const grouped = new Map();

  sales.forEach((sale) => {
    getSaleItems(sale).forEach((item) => {
      const existing = grouped.get(item.productId) || {
        name: item.name,
        productId: item.productId,
        baseUnit: getProductBaseUnit(item.productId),
        bulkUnit: getProductBulkUnit(item.productId),
        baseUnits: 0,
        bulkUnits: 0,
        amount: 0,
        profit: 0,
        transactions: 0
      };

      const saleQuantity = Number(item.quantity || 0);

      if ((item.saleUnit || "").toLowerCase() === "bulk") {
        existing.bulkUnits += saleQuantity;
      } else {
        existing.baseUnits += Number(item.actualQtySold || item.quantity || 0);
      }

      existing.amount += Number(item.total || 0);
      existing.transactions += 1;
      grouped.set(item.productId, existing);
    });
  });

  sales.forEach((sale) => {
    const saleItems = getSaleItems(sale);
    const totalUnits = saleItems.reduce((sum, item) => sum + Number(item.actualQtySold || item.quantity || 0), 0);

    saleItems.forEach((item) => {
      const entry = grouped.get(item.productId);

      if (!entry) {
        return;
      }

      const itemUnits = Number(item.actualQtySold || item.quantity || 0);
      const share = totalUnits > 0 ? itemUnits / totalUnits : 0;
      entry.profit += Number(getSaleProfit(sale) || 0) * share;
    });
  });

  return Array.from(grouped.values()).sort((left, right) => right.amount - left.amount);
}

function buildSalesPeriodSummary(sales, label, matcher) {
  return sales.reduce((summary, sale) => {
    const saleDate = getSaleDate(sale);

    if (!saleDate || !matcher(saleDate)) {
      return summary;
    }

    summary.transactions += 1;
    summary.units += getSaleBaseUnitsSold(sale);
    summary.bulkUnits += getSaleBulkUnitsSold(sale);
    summary.amount += Number(sale.totalAmount || 0);
    summary.profit += Number(getSaleProfit(sale) || 0);
    return summary;
  }, {
    label,
    transactions: 0,
    units: 0,
    bulkUnits: 0,
    amount: 0,
    profit: 0
  });
}

function getReportDateFilters(type) {
  return {
    from: reportDateFilters[type]?.from || "",
    to: reportDateFilters[type]?.to || ""
  };
}

function updateReportDateFilter(type, field, value) {
  reportDateFilters[type] = {
    ...getReportDateFilters(type),
    [field]: value
  };
  showDashboardDetails(type);
}

function updateReportSalesPersonFilter(type, value) {
  reportSalesPersonFilters[type] = value;
  showDashboardDetails(type);
}

function clearReportFilters(type) {
  reportDateFilters[type] = {
    from: "",
    to: ""
  };
  reportSalesPersonFilters[type] = "";
  showDashboardDetails(type);
}

function getReportSalesPersonFilter(type) {
  return reportSalesPersonFilters[type] || "";
}

function getReportFilterSummary(type) {
  const summaries = [];

  if (dateFilterReportTypes.has(type)) {
    const { from, to } = getReportDateFilters(type);

    if (from || to) {
      summaries.push(`Date range: ${from || "Start"} to ${to || "Today"}`);
    }
  }

  if (type === "profit") {
    const selectedPerson = getReportSalesPersonFilter(type);
    const selectedName = getSalesPeopleForFilter().find((person) => person.key === selectedPerson)?.name;

    if (selectedName) {
      summaries.push(`Sales person: ${selectedName}`);
    }
  }

  return summaries.length > 0 ? ` | ${summaries.join(" | ")}` : "";
}

function getFilteredSales(type) {
  return state.sales.filter((sale) => (
    isWithinReportDateRange(type, sale.createdAt || sale.date) &&
    isMatchingSalesPersonFilter(type, sale)
  ));
}

function isMatchingSalesPersonFilter(type, sale) {
  if (type !== "profit") {
    return true;
  }

  const selectedPerson = getReportSalesPersonFilter(type);
  return !selectedPerson || getSalePersonKey(sale) === selectedPerson;
}

function isWithinReportDateRange(type, value) {
  if (!dateFilterReportTypes.has(type)) {
    return true;
  }

  const date = parseReportRecordDate(value);

  if (!date) {
    return false;
  }

  const { from, to } = getReportDateFilters(type);
  const fromDate = parseReportFilterDate(from, false);
  const toDate = parseReportFilterDate(to, true);

  if (fromDate && date < fromDate) {
    return false;
  }

  if (toDate && date > toDate) {
    return false;
  }

  return true;
}

function parseReportRecordDate(value) {
  if (!value) {
    return null;
  }

  const parsed = value.toDate?.() || new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getReportTime(value) {
  return parseReportRecordDate(value)?.getTime() || 0;
}

function parseReportFilterDate(value, isEndOfDay) {
  if (!value) {
    return null;
  }

  const parsed = new Date(`${value}T${isEndOfDay ? "23:59:59.999" : "00:00:00.000"}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getSaleDate(sale) {
  const value = sale.createdAt || sale.date;
  return parseReportRecordDate(value);
}

function getSalePersonName(sale) {
  return sale.createdBy?.fullName || sale.createdBy?.username || sale.user || "Unknown";
}

function getSalePersonKey(sale) {
  return sale.createdBy?.id || sale.createdBy?.username || getSalePersonName(sale);
}

function getSalesPeopleForFilter() {
  const salesPeople = new Map();

  state.sales.forEach((sale) => {
    const key = getSalePersonKey(sale);

    if (key && !salesPeople.has(key)) {
      salesPeople.set(key, {
        key,
        name: getSalePersonName(sale)
      });
    }
  });

  return Array.from(salesPeople.values())
    .sort((left, right) => left.name.localeCompare(right.name));
}

function isSameDay(left, right) {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

function isInCurrentWeek(date, reference) {
  const startOfWeek = new Date(reference);
  const day = startOfWeek.getDay();
  const diff = (day + 6) % 7;
  startOfWeek.setHours(0, 0, 0, 0);
  startOfWeek.setDate(startOfWeek.getDate() - diff);

  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(endOfWeek.getDate() + 7);

  return date >= startOfWeek && date < endOfWeek;
}

function isInCurrentMonth(date, reference) {
  return date.getFullYear() === reference.getFullYear()
    && date.getMonth() === reference.getMonth();
}

function formatDateTime(value) {
  if (!value) {
    return "N/A";
  }

  const parsed = parseReportRecordDate(value);
  return parsed ? parsed.toLocaleString() : value;
}

function formatDate(value) {
  const parsed = parseReportRecordDate(value);
  return parsed ? parsed.toLocaleDateString() : value;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

Object.assign(window, {
  renderDashboard,
  showDashboardDetails,
  updateReportDateFilter,
  updateReportSalesPersonFilter,
  clearReportFilters
});
