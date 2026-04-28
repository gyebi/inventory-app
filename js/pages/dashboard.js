const {
  ensureStockState,
  formatReceiptCurrency,
  getCurrentPage,
  getExpiredStockQuantity,
  openModal,
  renderPage,
  resetData,
  state
} = window.app;

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

  const totalSales = state.sales.reduce((sum, sale) => sum + getTotalUnitsSold(sale), 0);
  const totalProfit = state.sales.reduce((sum, sale) => sum + getSaleProfit(sale), 0);
  const lowStockProducts = getLowStockProducts();

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

      <button class="card stat-card stat-button" onclick="showDashboardDetails('salesByProduct')">
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

function renderReportsPage() {
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
        formatReceiptCurrency(product.sellingPrice),
        formatReceiptCurrency(product.bulkSellingPrice ?? 0),
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
      `${product.quantity} ${product.baseUnit}(s)`,
      `${getProductLowStockThreshold(product)} ${product.baseUnit}(s)`,
      `${getExpiredStockQuantity(product.id)} ${product.baseUnit}(s)`,
      "Restock soon"
    ])
  );
}

function buildReorderReport() {
  const reorderProducts = state.products
    .filter((product) => Number(product.quantity || 0) <= getProductLowStockThreshold(product))
    .sort((left, right) => left.name.localeCompare(right.name));

  if (reorderProducts.length === 0) {
    return `<div class="card">No products currently require reordering.</div>`;
  }

  return buildTableMarkup(
    ["Product", "Current Stock", "Reorder Level", "Suggested Order", "Supplier"],
    reorderProducts.map((product) => {
      const reorderLevel = getProductLowStockThreshold(product);
      const suggestedOrder = Math.max((reorderLevel * 2) - Number(product.quantity || 0), 0);
      const recentSupplier = getLatestSupplierForProduct(product.id);

      return [
        product.name,
        `${product.quantity} ${product.baseUnit}(s)`,
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
    ["Product", "Base Units Sold", "Sales Amount", "Profit", "Transactions"],
    groupedSales.map((entry) => [
      entry.name,
      `${entry.baseUnits} ${entry.baseUnit}(s)`,
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
    ["Period", "Transactions", "Base Units Sold", "Sales Amount", "Profit"],
    periods.map((period) => [
      period.label,
      String(period.transactions),
      String(period.units),
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
    isWithinReportDateRange("purchases", receipt.receivedAt || receipt.createdAt)
  ));

  if (receipts.length === 0) {
    return `<div class="card">No stock receipts recorded yet.</div>`;
  }

  return buildTableMarkup(
    ["Date", "Product", "Supplier", "Quantity Received", "Payment", "Invoice"],
    receipts
      .slice()
      .sort((left, right) => (
        getReportTime(right.receivedAt || right.createdAt) - getReportTime(left.receivedAt || left.createdAt)
      ))
      .map((receipt) => [
        formatDateTime(receipt.receivedAt || receipt.createdAt),
        receipt.product || getProductName(receipt.productId),
        receipt.supplier || "N/A",
        `${Number(receipt.quantityReceived || 0)} ${getProductBaseUnit(receipt.productId)}(s)`,
        receipt.paymentStatus || "N/A",
        receipt.invoiceDetails || "N/A"
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
      const quantity = Number(product.quantity || 0);
      const unitCost = Number(product.costPrice || 0);
      const stockValue = quantity * unitCost;

      return [
        product.name,
        `${quantity} ${product.baseUnit}(s)`,
        formatReceiptCurrency(unitCost),
        formatReceiptCurrency(stockValue)
      ];
    });

  const totalValue = state.products.reduce(
    (sum, product) => sum + (Number(product.quantity || 0) * Number(product.costPrice || 0)),
    0
  );

  return `
    ${buildTableMarkup(["Product", "Quantity", "Unit Cost", "Stock Value"], rows)}
    <div class="card report-total-card">
      <strong>Total Inventory Value:</strong> ${formatReceiptCurrency(totalValue)}
    </div>
  `;
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
  return state.products.filter((product) => Number(product.quantity || 0) <= getProductLowStockThreshold(product));
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
        baseUnits: 0,
        amount: 0,
        profit: 0,
        transactions: 0
      };

      existing.baseUnits += Number(item.actualQtySold || item.quantity || 0);
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
    summary.units += getTotalUnitsSold(sale);
    summary.amount += Number(sale.totalAmount || 0);
    summary.profit += Number(getSaleProfit(sale) || 0);
    return summary;
  }, {
    label,
    transactions: 0,
    units: 0,
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

window.renderDashboard = renderDashboard;
window.showDashboardDetails = showDashboardDetails;
window.updateReportDateFilter = updateReportDateFilter;
window.updateReportSalesPersonFilter = updateReportSalesPersonFilter;
window.clearReportFilters = clearReportFilters;
