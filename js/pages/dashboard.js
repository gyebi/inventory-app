const {
  ensureStockState,
  formatReceiptCurrency,
  formatStock,
  getCurrentPage,
  getExpiredStockQuantity,
  getSellableBatches,
  parseExpiryDate,
  openModal,
  renderPage,
  resetData,
  state
} = window.app;

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
      ${renderReportCard("currentStock", "📋", "Current Stock Report", "Print all current stock balances")}
      ${renderReportCard("lowStock", "⚠️", "Low Stock Report", "See items below reorder level")}
      ${renderReportCard("reorder", "🔁", "Reorder Report", "Highlight products that need replenishment")}
      ${renderReportCard("salesByProduct", "🛒", "Sales by Product Report", "Summarize sales grouped by product")}
      ${renderReportCard("salesPeriods", "🗓️", "Daily/Weekly/Monthly Sales", "Compare sales across time periods")}
      ${renderReportCard("profit", "💰", "Profit Report", "Review profit from completed sales")}
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
      <div class="dashboard-detail-list">${report.body}</div>
      <div class="report-actions">
        <button type="button" onclick="printModalReport()">Print Report</button>
        <button type="button" onclick="closeModal()">Close</button>
      </div>
    </div>
  `);
}

function buildReport(type) {
  const generatedAt = `Generated ${new Date().toLocaleString()}`;

  if (type === "currentStock") {
    return {
      title: "Current Stock Report",
      subtitle: generatedAt,
      body: buildCurrentStockReport()
    };
  }

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
      title: "Profit Report",
      subtitle: generatedAt,
      body: buildProfitReport()
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

function buildCurrentStockReport() {
  if (state.products.length === 0) {
    return `<div class="card">No products added yet.</div>`;
  }

  return buildTableMarkup(
    [
      "Product Name",
      "Product ID",
      "Category",
      "Quantity on Hand",
      "Stock Value",
      "Reorder Level",
      "Stock Status",
      "Expiry Date"
    ],
    state.products
      .slice()
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((product) => {
        const quantityOnHand = Number(product.quantity || 0);
        const reorderLevel = getProductLowStockThreshold(product);
        const stockValue = quantityOnHand * Number(product.costPrice || 0);

        return [
          product.name,
          product.id || "N/A",
          product.category || "N/A",
          formatStock(product),
          formatReceiptCurrency(stockValue),
          `${reorderLevel} ${product.baseUnit}(s)`,
          getStockStatus(product, quantityOnHand, reorderLevel),
          getNextExpiryDate(product.id)
        ];
      })
  );
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
  const groupedSales = getSalesGroupedByProduct();

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
  const periods = [
    buildSalesPeriodSummary("Today", (saleDate) => isSameDay(saleDate, today)),
    buildSalesPeriodSummary("This Week", (saleDate) => isInCurrentWeek(saleDate, today)),
    buildSalesPeriodSummary("This Month", (saleDate) => isInCurrentMonth(saleDate, today))
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

function buildProfitReport() {
  if (state.sales.length === 0) {
    return `<div class="card">No profit entries yet.</div>`;
  }

  return buildTableMarkup(
    ["Date", "Products", "Amount", "Profit", "Cashier"],
    state.sales
      .slice()
      .sort((left, right) => new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime())
      .map((sale) => [
        getSaleTimestamp(sale),
        getSalePrimaryName(sale),
        formatReceiptCurrency(sale.totalAmount),
        formatReceiptCurrency(getSaleProfit(sale)),
        sale.createdBy?.fullName || sale.user || "Unknown"
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
    .sort((left, right) => new Date(right.date || 0).getTime() - new Date(left.date || 0).getTime());

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
  return `
    <div class="card">
      No damaged or lost stock adjustments have been recorded yet.
      Add a stock adjustment workflow to populate this report.
    </div>
  `;
}

function buildPurchaseReport() {
  if (state.stockReceipts.length === 0) {
    return `<div class="card">No stock receipts recorded yet.</div>`;
  }

  return buildTableMarkup(
    ["Date", "Product", "Supplier", "Quantity Received", "Payment", "Invoice"],
    state.stockReceipts
      .slice()
      .sort((left, right) => new Date(right.receivedAt || right.createdAt || 0).getTime() - new Date(left.receivedAt || left.createdAt || 0).getTime())
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

function getStockStatus(product, quantityOnHand = Number(product.quantity || 0), reorderLevel = getProductLowStockThreshold(product)) {
  const expiredQuantity = getExpiredStockQuantity(product.id);

  if (quantityOnHand <= 0) {
    return "Out of stock";
  }

  if (quantityOnHand <= reorderLevel) {
    return "Reorder";
  }

  if (expiredQuantity > 0) {
    return "Has expired stock";
  }

  return "In stock";
}

function getNextExpiryDate(productId) {
  const nextExpiry = getSellableBatches(productId)
    .map((batch) => parseExpiryDate(batch.expiryDate))
    .filter(Boolean)
    .sort((left, right) => left.getTime() - right.getTime())[0];

  return nextExpiry ? nextExpiry.toLocaleDateString() : "N/A";
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
    return new Date(sale.createdAt).toLocaleString();
  }

  return sale.date || "N/A";
}

function getSalesGroupedByProduct() {
  const grouped = new Map();

  state.sales.forEach((sale) => {
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

  state.sales.forEach((sale) => {
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

function buildSalesPeriodSummary(label, matcher) {
  return state.sales.reduce((summary, sale) => {
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

function getSaleDate(sale) {
  const value = sale.createdAt || sale.date;
  const parsed = value ? new Date(value) : null;

  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
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

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

window.renderDashboard = renderDashboard;
window.showDashboardDetails = showDashboardDetails;
