import { receivePurchaseInCloudTransaction } from "../services/cloudProductService.js";

const CLOUD_SAVE_TIMEOUT_MS = 12000;

const {
  createStockBatchId,
  ensureStockState,
  isBatchExpired,
  navigate,
  parseExpiryDate,
  renderPage,
  saveState,
  state
} = window.app;

function renderReceiveStock(error = "", values = {}) {
  ensureStockState();

  if (state.products.length === 0) {
    renderPage(`
      <div class="page-title">
        <h2>Receive Stock</h2>
        <p>Create product records before receiving supplier purchases.</p>
      </div>
      <div class="message error">Add a product before receiving stock.</div>
      <button onclick="navigate('addProduct')">Add Product</button>
    `);
    return;
  }

  const supplierOptions = state.suppliers.map(
    (supplier) => `<option value="${escapeHtml(supplier.name)}">${escapeHtml(supplier.name)}</option>`
  ).join("");
  const lines = Array.isArray(values.lines) && values.lines.length > 0 ? values.lines : [createEmptyLine()];
  const defaultPurchaseDate = values.purchaseDate || getCurrentDateTimeValue();
  const defaultReceivedBy = values.receivedBy || state.user?.fullName || state.user?.username || "";

  renderPage(`
    <div class="page-title">
      <h2>Receive Stock</h2>
      <p>Record a supplier invoice with one or more product lines.</p>
    </div>

    ${error ? `<div class="message error">${error}</div>` : ""}

    <div class="form-column panel purchase-form">
      <div class="form-row">
        <label for="stockSupplier">Supplier</label>
        <input id="stockSupplier" list="supplier-list" value="${escapeHtml(values.supplier || "")}">
        <datalist id="supplier-list">${supplierOptions}</datalist>
      </div>

      <div class="form-row">
        <label for="invoiceNumber">Invoice Number</label>
        <input id="invoiceNumber" value="${escapeHtml(values.invoiceNumber || "")}">
      </div>

      <div class="form-row">
        <label for="purchaseDate">Purchase Date</label>
        <input id="purchaseDate" type="datetime-local" value="${defaultPurchaseDate}">
      </div>

      <div class="form-row">
        <label for="dueDate">Due Date</label>
        <input id="dueDate" type="date" value="${values.dueDate || ""}">
      </div>

      <div class="form-row">
        <label for="paymentStatus">Payment Type</label>
        <select id="paymentStatus">
          <option value="Credit" ${values.paymentStatus !== "Paid" ? "selected" : ""}>Credit</option>
          <option value="Paid" ${values.paymentStatus === "Paid" ? "selected" : ""}>Paid</option>
        </select>
      </div>

      <div class="form-row">
        <label for="receivedBy">Received By</label>
        <input id="receivedBy" value="${escapeHtml(defaultReceivedBy)}">
      </div>

      <div class="form-row">
        <label for="purchaseNotes">Notes</label>
        <textarea id="purchaseNotes" rows="3">${escapeHtml(values.notes || "")}</textarea>
      </div>

      <h3>Product Lines</h3>
      <div id="purchaseLines" class="purchase-lines">
        ${lines.map((line, index) => renderPurchaseLine(index, line)).join("")}
      </div>

      <div id="purchaseSummary" class="sync-panel"></div>

      <div class="purchase-actions">
        <button type="button" onclick="addPurchaseLine()">Add Product Line</button>
        <button id="receiveStockButton" onclick="receiveStock()">Save Purchase</button>
      </div>
    </div>
  `);

  updatePurchaseLineControls();
  updatePurchaseSummary();
}

function renderPurchaseLine(index, line = {}) {
  const selectedProduct = getProductById(line.productId) || state.products[0];

  return `
    <div class="purchase-line card" data-line-index="${index}">
      <div class="purchase-line-header">
        <strong>Line ${index + 1}</strong>
        <button type="button" onclick="removePurchaseLine(${index})">Remove</button>
      </div>

      <div class="form-row">
        <label for="lineProduct_${index}">Product</label>
        <select id="lineProduct_${index}" class="line-product" onchange="handlePurchaseLineProductChange(${index})">
          ${renderProductOptions(line.productId)}
        </select>
      </div>

      <div class="form-row">
        <label for="lineBulk_${index}">Bulk Units</label>
        <input id="lineBulk_${index}" class="number-field line-bulk" type="number" min="0" step="1" value="${line.bulkUnitsReceived || ""}" oninput="updatePurchaseSummary()">
      </div>

      <div class="form-row">
        <label for="lineBase_${index}">Base Units</label>
        <input id="lineBase_${index}" class="number-field line-base" type="number" min="0" step="1" value="${line.baseUnitsReceived || ""}" oninput="updatePurchaseSummary()">
      </div>

      <div class="form-row">
        <label for="lineUnitCost_${index}">Unit Cost</label>
        <input id="lineUnitCost_${index}" class="number-field line-unit-cost" type="number" min="0" step="0.01" value="${line.unitCost ?? selectedProduct?.costPrice ?? 0}" oninput="updatePurchaseSummary()">
      </div>

      <div class="form-row">
        <label for="lineExpiry_${index}">Expiry Date</label>
        <input id="lineExpiry_${index}" class="line-expiry" type="date" value="${line.expiryDate || ""}">
      </div>

      <div class="sync-panel line-preview"></div>
    </div>
  `;
}

function renderProductOptions(selectedProductId = "") {
  return state.products
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((product) => `
      <option value="${product.id}" ${product.id === selectedProductId ? "selected" : ""}>
        ${escapeHtml(product.name)}
      </option>
    `)
    .join("");
}

function addPurchaseLine() {
  renderReceiveStock("", {
    ...collectPurchaseValues(),
    lines: [...collectPurchaseLines(), createEmptyLine()]
  });
}

function removePurchaseLine(indexToRemove) {
  const lines = collectPurchaseLines().filter((_, index) => index !== indexToRemove);

  renderReceiveStock("", {
    ...collectPurchaseValues(),
    lines: lines.length > 0 ? lines : [createEmptyLine()]
  });
}

function handlePurchaseLineProductChange(index) {
  const line = document.querySelector(`[data-line-index="${index}"]`);
  const product = getProductById(line?.querySelector(".line-product")?.value);
  const unitCostInput = line?.querySelector(".line-unit-cost");

  if (product && unitCostInput) {
    unitCostInput.value = Number(product.costPrice || 0);
  }

  updatePurchaseSummary();
}

function updatePurchaseLineControls() {
  const lines = document.querySelectorAll(".purchase-line");

  lines.forEach((line) => {
    const removeButton = line.querySelector(".purchase-line-header button");

    if (removeButton) {
      removeButton.disabled = lines.length <= 1;
    }
  });
}

function updatePurchaseSummary() {
  const summary = document.getElementById("purchaseSummary");
  const lines = collectPurchaseLines();
  let totalAmount = 0;
  let totalBaseUnits = 0;

  lines.forEach((line, index) => {
    const product = getProductById(line.productId);
    const quantityReceived = product ? getLineQuantity(product, line) : 0;
    const lineTotal = quantityReceived * Number(line.unitCost || 0);
    const preview = document.querySelector(`[data-line-index="${index}"] .line-preview`);

    totalAmount += lineTotal;
    totalBaseUnits += quantityReceived;

    if (preview) {
      preview.innerHTML = product
        ? `
          <strong>${escapeHtml(product.name)}</strong><br>
          ${Number(line.bulkUnitsReceived || 0)} ${escapeHtml(product.bulkUnit || "bulk unit")}(s)
          x ${getUnitsPerBulk(product)}
          + ${Number(line.baseUnitsReceived || 0)} ${escapeHtml(product.baseUnit || "base unit")}(s)
          = ${quantityReceived} ${escapeHtml(product.baseUnit || "base unit")}(s)<br>
          Line total: ${formatCurrency(lineTotal)}
        `
        : "Choose a product to preview this line.";
    }
  });

  if (summary) {
    summary.innerHTML = `
      <strong>Purchase Summary</strong><br>
      Product lines: ${lines.length}<br>
      Total base units: ${totalBaseUnits}<br>
      Total amount: ${formatCurrency(totalAmount)}
    `;
  }
}

function setReceiveStockProcessing(isProcessing) {
  const button = document.getElementById("receiveStockButton");

  if (!button) {
    return;
  }

  button.disabled = isProcessing;
  button.innerHTML = isProcessing
    ? `<span class="button-spinner" aria-hidden="true"></span>Saving purchase...`
    : "Save Purchase";
}

function renderStockSaved(receipts, totalAmount, purchaseId) {
  renderPage(`
    <div class="page-title">
      <h2>Purchase Saved</h2>
      <p>Firebase confirmed ${receipts.length} product line(s).</p>
    </div>

    <div class="message success">
      Purchase saved successfully. Total amount: ${formatCurrency(totalAmount)}.
      ${purchaseId ? `<br>Purchase ID: ${purchaseId}` : ""}
    </div>

    <div class="inventory-list">
      ${receipts.map((receipt) => `
        <div class="inventory-row">
          <div><strong>Product:</strong> ${escapeHtml(receipt.product)}</div>
          <div><strong>Supplier:</strong> ${escapeHtml(receipt.supplier || "N/A")}</div>
          <div><strong>Invoice:</strong> ${escapeHtml(receipt.invoiceNumber || "N/A")}</div>
          <div><strong>Purchase Date:</strong> ${formatReceiptTime(receipt.purchaseDate || receipt.receivedAt)}</div>
          <div><strong>Due Date:</strong> ${receipt.dueDate || "N/A"}</div>
          <div><strong>Payment:</strong> ${escapeHtml(receipt.paymentStatus)}</div>
          <div><strong>Bulk Units:</strong> ${receipt.bulkUnitsReceived}</div>
          <div><strong>Base Units:</strong> ${receipt.baseUnitsReceived}</div>
          <div><strong>Total Quantity:</strong> ${receipt.quantityReceived} ${escapeHtml(receipt.baseUnit || "base unit")}(s)</div>
          <div><strong>Unit Cost:</strong> ${formatCurrency(receipt.unitCost)}</div>
          <div><strong>Line Total:</strong> ${formatCurrency(receipt.lineTotal)}</div>
        </div>
      `).join("")}
    </div>

    <div class="form-column panel">
      <button onclick="renderReceiveStock()">Receive Another Purchase</button>
      <button onclick="navigate('inventory')">View Inventory</button>
      <button onclick="navigate('reports')">View Reports</button>
      <button onclick="navigate('home')">Main Menu</button>
    </div>
  `);
}

function applyPurchaseLocally({ receipts, cloudLines = [] }) {
  receipts.forEach((receipt, index) => {
    const product = getProductById(receipt.productId);
    const receiptId = cloudLines[index]?.receiptId || receipt.id;

    state.stock.push({
      id: receipt.batchId,
      productId: receipt.productId,
      productName: receipt.product,
      quantity: receipt.quantityReceived,
      bulkUnitsReceived: receipt.bulkUnitsReceived,
      baseUnitsReceived: receipt.baseUnitsReceived,
      receivedBy: receipt.receivedBy,
      supplier: receipt.supplier,
      invoiceDetails: receipt.invoiceDetails,
      invoiceNumber: receipt.invoiceNumber,
      purchaseDate: receipt.purchaseDate,
      receivedAt: receipt.receivedAt,
      expiryDate: receipt.expiryDate,
      paymentStatus: receipt.paymentStatus
    });

    state.stockReceipts.push({
      ...receipt,
      id: receiptId
    });

    if (product) {
      product.quantity = Number(product.quantity || 0) + Number(receipt.quantityReceived || 0);
    }
  });

  saveState();
}

async function receiveStock() {
  ensureStockState();

  const values = collectPurchaseValues();
  const lines = collectPurchaseLines();

  if (!values.supplier) {
    renderReceiveStock("Enter the supplier.", { ...values, lines });
    return;
  }

  if (!values.invoiceNumber) {
    renderReceiveStock("Enter the invoice number.", { ...values, lines });
    return;
  }

  if (!values.purchaseDate) {
    renderReceiveStock("Enter the purchase date.", { ...values, lines });
    return;
  }

  if (!values.receivedBy) {
    renderReceiveStock("Enter who received the stock.", { ...values, lines });
    return;
  }

  const validationError = validatePurchaseLines(lines);

  if (validationError) {
    renderReceiveStock(validationError, { ...values, lines });
    return;
  }

  const purchaseId = createPurchaseId();
  const receipts = lines.map((line) => buildReceiptFromLine(values, line, purchaseId));
  const totalAmount = receipts.reduce((sum, receipt) => sum + Number(receipt.lineTotal || 0), 0);

  try {
    setReceiveStockProcessing(true);
    const cloudResult = await withTimeout(
      receivePurchaseInCloudTransaction({
        lines: receipts.map((receipt) => ({
          productId: receipt.productId,
          quantityReceived: receipt.quantityReceived,
          receipt
        }))
      }),
      CLOUD_SAVE_TIMEOUT_MS,
      "Purchase was not saved because Firestore did not respond. Check your internet connection and confirm Firestore rules allow updates to products and creates in stockReceipts."
    );

    applyPurchaseLocally({ receipts, cloudLines: cloudResult?.lines || [] });
  } catch (error) {
    renderReceiveStock(error.message || "Unable to save purchase to Firestore.", { ...values, lines });
    return;
  } finally {
    setReceiveStockProcessing(false);
  }

  renderStockSaved(receipts, totalAmount, purchaseId);
}

function buildReceiptFromLine(values, line, purchaseId) {
  const product = getProductById(line.productId);
  const quantityReceived = getLineQuantity(product, line);
  const unitCost = Number(line.unitCost || 0);
  const lineTotal = quantityReceived * unitCost;
  const batchId = createStockBatchId();

  return {
    id: batchId,
    purchaseId,
    batchId,
    productId: product.id,
    product: product.name,
    category: product.category || "",
    supplier: values.supplier,
    invoiceNumber: values.invoiceNumber,
    invoiceDetails: values.invoiceNumber,
    purchaseDate: values.purchaseDate,
    dueDate: values.dueDate,
    paymentStatus: values.paymentStatus,
    notes: values.notes,
    receivedBy: values.receivedBy,
    receivedAt: values.purchaseDate,
    bulkUnitsReceived: Number(line.bulkUnitsReceived || 0),
    baseUnitsReceived: Number(line.baseUnitsReceived || 0),
    quantityReceived,
    unitCost,
    lineTotal,
    baseUnit: product.baseUnit || "base unit",
    bulkUnit: product.bulkUnit || "bulk unit",
    expiryDate: line.expiryDate
  };
}

function validatePurchaseLines(lines) {
  if (lines.length === 0) {
    return "Add at least one product line.";
  }

  for (const [index, line] of lines.entries()) {
    const product = getProductById(line.productId);
    const lineNumber = index + 1;

    if (!product) {
      return `Choose a product for line ${lineNumber}.`;
    }

    if (!Number.isInteger(Number(line.bulkUnitsReceived || 0)) || Number(line.bulkUnitsReceived || 0) < 0) {
      return `Bulk units on line ${lineNumber} must be a whole number of zero or more.`;
    }

    if (!Number.isInteger(Number(line.baseUnitsReceived || 0)) || Number(line.baseUnitsReceived || 0) < 0) {
      return `Base units on line ${lineNumber} must be a whole number of zero or more.`;
    }

    if (getLineQuantity(product, line) <= 0) {
      return `Enter bulk units, base units, or both for line ${lineNumber}.`;
    }

    if (!Number.isFinite(Number(line.unitCost)) || Number(line.unitCost) < 0) {
      return `Unit cost on line ${lineNumber} must be zero or more.`;
    }

    if (line.expiryDate && isBatchExpired(line.expiryDate)) {
      return `Expiry date on line ${lineNumber} cannot be in the past.`;
    }
  }

  return "";
}

function collectPurchaseValues() {
  return {
    supplier: document.getElementById("stockSupplier")?.value.trim() || "",
    invoiceNumber: document.getElementById("invoiceNumber")?.value.trim() || "",
    purchaseDate: document.getElementById("purchaseDate")?.value || "",
    dueDate: document.getElementById("dueDate")?.value || "",
    paymentStatus: document.getElementById("paymentStatus")?.value || "Credit",
    receivedBy: document.getElementById("receivedBy")?.value.trim() || "",
    notes: document.getElementById("purchaseNotes")?.value.trim() || ""
  };
}

function collectPurchaseLines() {
  return Array.from(document.querySelectorAll(".purchase-line")).map((line) => ({
    productId: line.querySelector(".line-product")?.value || "",
    bulkUnitsReceived: line.querySelector(".line-bulk")?.value || "",
    baseUnitsReceived: line.querySelector(".line-base")?.value || "",
    unitCost: line.querySelector(".line-unit-cost")?.value || "0",
    expiryDate: line.querySelector(".line-expiry")?.value || ""
  }));
}

function createEmptyLine() {
  return {
    productId: state.products[0]?.id || "",
    bulkUnitsReceived: "",
    baseUnitsReceived: "",
    unitCost: state.products[0]?.costPrice ?? 0,
    expiryDate: ""
  };
}

function getLineQuantity(product, line) {
  return (Number(line.bulkUnitsReceived || 0) * getUnitsPerBulk(product)) + Number(line.baseUnitsReceived || 0);
}

function getProductById(productId) {
  return state.products.find((product) => product.id === productId);
}

function createPurchaseId() {
  return `purchase_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
}

function getCurrentDateTimeValue() {
  const now = new Date();
  const localTime = new Date(now.getTime() - (now.getTimezoneOffset() * 60000));
  return localTime.toISOString().slice(0, 16);
}

function getUnitsPerBulk(product) {
  const unitsPerBulk = Number(product.unitsPerBulk);
  return Number.isFinite(unitsPerBulk) && unitsPerBulk > 0 ? unitsPerBulk : 1;
}

function withTimeout(promise, timeoutMs, message) {
  let timeoutId;

  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return Promise.race([
    promise.finally(() => clearTimeout(timeoutId)),
    timeout
  ]);
}

function formatCurrency(value) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "GHS"
  }).format(Number(value || 0));
}

function formatReceiptTime(value) {
  if (!value) {
    return "N/A";
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

window.renderReceiveStock = renderReceiveStock;
window.receiveStock = receiveStock;
window.addPurchaseLine = addPurchaseLine;
window.removePurchaseLine = removePurchaseLine;
window.handlePurchaseLineProductChange = handlePurchaseLineProductChange;
window.updatePurchaseSummary = updatePurchaseSummary;
window.getCurrentDateTimeValue = getCurrentDateTimeValue;
