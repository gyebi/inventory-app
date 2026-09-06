import { receivePurchaseInCloudTransaction } from "../services/cloudProductService.js";
import { createAppError, ERROR_FLAGS, logAppError, toUserMessage } from "../utils/errorUtils.js";

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

  const supplierOptions = state.suppliers.length === 0
    ? `<option value="">No suppliers available</option>`
    : state.suppliers.map(
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
        <select id="stockSupplier">
          <option value="">Choose supplier</option>
          ${supplierOptions}
        </select>
      </div>

      <div class="form-row">
        <label for="invoiceNumber">Invoice Number</label>
        <input id="invoiceNumber" value="${escapeHtml(values.invoiceNumber || "")}">
      </div>

      <div class="form-row">
        <label for="purchaseDate">Purchase Date</label>
        <input id="purchaseDate" type="datetime-local" value="${defaultPurchaseDate}">
      </div>

      <h3>Product Lines</h3>
      <div id="purchaseLines" class="purchase-lines">
        ${lines.map((line, index) => renderPurchaseLine(index, line)).join("")}
      </div>

      <div id="purchaseSummary" class="sync-panel"></div>

      <div class="form-row">
        <label for="paymentStatus">Payment Type</label>
        <select id="paymentStatus" onchange="toggleReceiptDueDate()">
          <option value="Credit" ${values.paymentStatus === "Credit" ? "selected" : ""}>Credit</option>
          <option value="Part Payment" ${values.paymentStatus === "Part Payment" ? "selected" : ""}>Part Payment</option>
          <option value="Paid in Full" ${values.paymentStatus === "Paid in Full" ? "selected" : ""}>Paid in Full</option>
        </select>
      </div>

      <div class="form-row" id="dueDateRow">
        <label for="dueDate">Due Date</label>
        <input id="dueDate" type="date" value="${escapeHtml(values.dueDate || "")}">
        <small class="field-hint">Required for Credit and Part Payment purchases.</small>
      </div>

      <div class="form-row">
        <label for="receivedBy">Received By</label>
        <input id="receivedBy" value="${escapeHtml(defaultReceivedBy)}">
      </div>

      <div class="form-row">
        <label for="purchaseNotes">Notes</label>
        <textarea id="purchaseNotes" rows="3">${escapeHtml(values.notes || "")}</textarea>
      </div>

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
        <label for="lineBatch_${index}">Batch Number</label>
        <input id="lineBatch_${index}" class="line-batch" type="text" value="${escapeHtml(line.batchId || "")}" readonly>
      </div>

      <div class="form-row">
        <label for="lineBulkQuantity_${index}">Bulk Quantity Received</label>
        <input id="lineBulkQuantity_${index}" class="number-field line-bulk-quantity" type="number" min="1" step="1" value="${line.bulkQuantityReceived || ""}" oninput="updatePurchaseSummary()">
      </div>

  

      <div class="form-row">
        <label for="lineTotalBulkCost_${index}">Total Bulk Cost</label>
        <input id="lineTotalBulkCost_${index}" class="number-field line-total-bulk-cost" type="number" min="0" step="0.01" value="${line.totalBulkCost || ""}" oninput="updatePurchaseSummary()">
      </div>

      <div class="form-row">
        <label for="lineAdditionalExpenses_${index}">Additional Expenses</label>
        <input id="lineAdditionalExpenses_${index}" class="number-field line-additional-expenses" type="number" min="0" step="0.01" value="${line.additionalExpenses || ""}" oninput="updatePurchaseSummary()">
      </div>

      <div class="form-row">
        <label for="lineUnitSellingPrice_${index}">Selling Price</label>
        <input id="lineUnitSellingPrice_${index}" class="number-field line-unit-selling-price" type="number" min="0.01" step="0.01" value="${line.unitSellingPrice || ""}">
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
    const bulkQuantityReceived = Number(line.bulkQuantityReceived || 0);
    const unitsPerBulk = getUnitsPerBulk(product);
    const quantityReceived = bulkQuantityReceived * unitsPerBulk;
    const totalBulkCost = Number(line.totalBulkCost || 0);
    const additionalExpenses = Number(line.additionalExpenses || 0);
    const totalLandedCost = totalBulkCost + additionalExpenses;
    const unitCost = quantityReceived > 0 ? totalLandedCost / quantityReceived : 0;
    const unitSellingPrice = Number(line.unitSellingPrice || 0);
    const lineTotal = totalLandedCost;
    const preview = document.querySelector(`[data-line-index="${index}"] .line-preview`);

    totalAmount += lineTotal;
    totalBaseUnits += quantityReceived;

    if (preview) {
      preview.innerHTML = product
        ? `
          <strong>${escapeHtml(product.name)}</strong><br>
          Batch: ${escapeHtml(line.batchId || "pending")}<br>
          Bulk quantity received: ${bulkQuantityReceived} ${escapeHtml(product.bulkUnit || "bulk unit")}(s)<br>
          Unit quantity: ${quantityReceived} ${escapeHtml(product.baseUnit || "base unit")}(s)<br>
          Total landed cost: ${formatCurrency(totalLandedCost)}<br>
          Unit cost: ${formatCurrency(unitCost)} = landed cost ÷ quantity<br>
          Selling price: ${formatCurrency(unitSellingPrice)}
        `
        : "Choose a product to preview this line.";
    }
  });

  if (summary) {
    summary.innerHTML = `
      <strong>Purchase Summary</strong><br>
      Product lines: ${lines.length}<br>
      Total unit quantity received: ${totalBaseUnits}<br>
      Total landed cost: ${formatCurrency(totalAmount)}
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
          <div><strong>Batch Number:</strong> ${escapeHtml(receipt.batchId || receipt.id || "N/A")}</div>
          <div><strong>Date Received:</strong> ${formatReceiptTime(receipt.purchaseDate || receipt.receivedAt)}</div>
          <div><strong>Payment:</strong> ${escapeHtml(receipt.paymentStatus)}</div>
          <div><strong>Due Date:</strong> ${receipt.dueDate || "N/A"}</div>
          <div><strong>Quantity Received:</strong> ${receipt.quantityReceived} ${escapeHtml(receipt.baseUnit || "base unit")}(s)</div>
          <div><strong>Total Bulk Cost:</strong> ${formatCurrency(receipt.totalBulkCost)}</div>
          <div><strong>Additional Expenses:</strong> ${formatCurrency(receipt.additionalExpenses)}</div>
          <div><strong>Total Landed Cost:</strong> ${formatCurrency(receipt.totalLandedCost)}</div>
          <div><strong>Unit Cost:</strong> ${formatCurrency(receipt.unitCost)}</div>
          <div><strong>Unit Selling Price:</strong> ${formatCurrency(receipt.unitSellingPrice)}</div>
          <div><strong>Expiry Date:</strong> ${receipt.expiryDate || "N/A"}</div>
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
  const productsWithInitialPrice = new Set();

  receipts.forEach((receipt, index) => {
    const product = getProductById(receipt.productId);
    const receiptId = cloudLines[index]?.receiptId || receipt.id;

    state.stock.push({
      id: receipt.batchId,
      productId: receipt.productId,
      productName: receipt.product,
      quantity: receipt.quantityReceived,
      bulkQuantityReceived: receipt.bulkQuantityReceived,
      totalBulkCost: receipt.totalBulkCost,
      additionalExpenses: receipt.additionalExpenses,
      totalLandedCost: receipt.totalLandedCost,
      unitCost: receipt.unitCost,
      unitSellingPrice: receipt.unitSellingPrice,
      receivedBy: receipt.receivedBy,
      supplier: receipt.supplier,
      invoiceDetails: receipt.invoiceDetails,
      invoiceNumber: receipt.invoiceNumber,
      purchaseDate: receipt.purchaseDate,
      receivedAt: receipt.receivedAt,
      expiryDate: receipt.expiryDate,
      paymentStatus: receipt.paymentStatus
      ,
      dueDate: receipt.dueDate
    });

    state.stockReceipts.push({
      ...receipt,
      id: receiptId
    });

    if (product) {
      product.quantity = Number(product.quantity || 0) + Number(receipt.quantityReceived || 0);

      const unitSellingPrice = Number(receipt.unitSellingPrice || 0);

      if (unitSellingPrice > 0 && Number(product.sellingPrice || 0) <= 0) {
        product.sellingPrice = unitSellingPrice;
        product.bulkSellingPrice = unitSellingPrice * getUnitsPerBulk(product);
        product.sellingPriceEffectiveDate = receipt.purchaseDate || receipt.receivedAt || new Date().toISOString();
        product.sellingPriceUpdatedAt = receipt.receivedAt || receipt.purchaseDate || new Date().toISOString();
        productsWithInitialPrice.add(product.id);
      }
    }
  });

  saveState();

  return Array.from(productsWithInitialPrice);
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

  if (isCreditLikePayment(values.paymentStatus) && !values.dueDate) {
    renderReceiveStock("Enter a due date for Credit or Part Payment purchases.", { ...values, lines });
    return;
  }

  const validationError = validatePurchaseLines(lines);

  if (validationError) {
    renderReceiveStock(validationError, { ...values, lines });
    return;
  }

  const purchaseId = createPurchaseId();
  const receipts = lines.map((line) => buildReceiptFromLine(values, line, purchaseId));
  const totalAmount = receipts.reduce((sum, receipt) => sum + Number(receipt.totalLandedCost || 0), 0);

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
    logAppError("Purchase save failed", error);
    renderReceiveStock(toUserMessage(error, "Unable to save purchase to Firestore. Check your connection and try again."), { ...values, lines });
    return;
  } finally {
    setReceiveStockProcessing(false);
  }

  renderStockSaved(receipts, totalAmount, purchaseId);
}

function buildReceiptFromLine(values, line, purchaseId) {
  const product = getProductById(line.productId);
  const bulkQuantityReceived = Number(line.bulkQuantityReceived || 0);
  const quantityReceived = bulkQuantityReceived * getUnitsPerBulk(product);
  const totalBulkCost = Number(line.totalBulkCost || 0);
  const additionalExpenses = Number(line.additionalExpenses || 0);
  const totalLandedCost = totalBulkCost + additionalExpenses;
  const unitCost = quantityReceived > 0 ? totalLandedCost / quantityReceived : 0;
  const unitSellingPrice = Number(line.unitSellingPrice || 0);
  const batchId = line.batchId || createStockBatchId();

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
    paymentStatus: values.paymentStatus,
    dueDate: values.dueDate,
    notes: values.notes,
    receivedBy: values.receivedBy,
    receivedAt: values.purchaseDate,
    bulkQuantityReceived,
    quantityReceived,
    totalBulkCost,
    additionalExpenses,
    totalLandedCost,
    unitCost,
    unitSellingPrice,
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

    if (!Number.isFinite(Number(line.bulkQuantityReceived)) || Number(line.bulkQuantityReceived) <= 0) {
      return `Enter a valid bulk quantity received for line ${lineNumber}.`;
    }

    if (!Number.isFinite(Number(line.totalBulkCost)) || Number(line.totalBulkCost) < 0) {
      return `Enter a valid total bulk cost for line ${lineNumber}.`;
    }

    if (!Number.isFinite(Number(line.additionalExpenses)) || Number(line.additionalExpenses) < 0) {
      return `Enter a valid additional expenses amount for line ${lineNumber}.`;
    }

    if (!Number.isFinite(Number(line.unitSellingPrice)) || Number(line.unitSellingPrice) <= 0) {
      return `Enter a valid unit selling price for line ${lineNumber}.`;
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
    paymentStatus: document.getElementById("paymentStatus")?.value || "Credit",
    dueDate: document.getElementById("dueDate")?.value || "",
    receivedBy: document.getElementById("receivedBy")?.value.trim() || "",
    notes: document.getElementById("purchaseNotes")?.value.trim() || ""
  };
}

function collectPurchaseLines() {
  return Array.from(document.querySelectorAll(".purchase-line")).map((line) => ({
    productId: line.querySelector(".line-product")?.value || "",
    batchId: line.querySelector(".line-batch")?.value || "",
    bulkQuantityReceived: line.querySelector(".line-bulk-quantity")?.value || "",
    quantityReceived: line.querySelector(".line-unit-quantity")?.value || "",
    totalBulkCost: line.querySelector(".line-total-bulk-cost")?.value || "",
    additionalExpenses: line.querySelector(".line-additional-expenses")?.value || "",
    expiryDate: line.querySelector(".line-expiry")?.value || "",
    unitSellingPrice: line.querySelector(".line-unit-selling-price")?.value || ""
  }));
}

function createEmptyLine() {
  return {
    productId: state.products[0]?.id || "",
    batchId: createStockBatchId(),
    bulkQuantityReceived: "",
    quantityReceived: "",
    totalBulkCost: "",
    additionalExpenses: "",
    unitSellingPrice: "",
    expiryDate: ""
  };
}

function toggleReceiptDueDate() {
  const dueDateRow = document.getElementById("dueDateRow");
  const paymentStatus = document.getElementById("paymentStatus")?.value || "";

  if (!dueDateRow) {
    return;
  }

  dueDateRow.style.display = isCreditLikePayment(paymentStatus) ? "block" : "none";
}

function getProductById(productId) {
  return state.products.find((product) => product.id === productId);
}

function isCreditLikePayment(paymentStatus = "") {
  const normalized = String(paymentStatus || "").toLowerCase();
  return normalized === "credit" || normalized === "part payment";
}

function getUnitsPerBulk(product) {
  const unitsPerBulk = Number(product?.unitsPerBulk);
  return Number.isFinite(unitsPerBulk) && unitsPerBulk > 0 ? unitsPerBulk : 1;
}

function createPurchaseId() {
  return `purchase_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
}

function getCurrentDateTimeValue() {
  const now = new Date();
  const localTime = new Date(now.getTime() - (now.getTimezoneOffset() * 60000));
  return localTime.toISOString().slice(0, 16);
}

function withTimeout(promise, timeoutMs, message) {
  let timeoutId;

  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(createAppError(message, {
      code: "firestore/save-timeout",
      source: ERROR_FLAGS.SOURCE_FIRESTORE,
      retryable: true
    })), timeoutMs);
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
window.toggleReceiptDueDate = toggleReceiptDueDate;
window.getCurrentDateTimeValue = getCurrentDateTimeValue;
