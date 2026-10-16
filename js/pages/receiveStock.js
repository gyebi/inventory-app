import { receivePurchaseInCloudTransaction } from "../services/cloudProductService.js";
import { isSecureSalesEnabled } from "../services/secureCheckoutService.js";
import { getUnresolvedSecureReceive, submitSecureReceive } from "../services/secureReceivingService.js";
import { parsePesewas, purchaseFromSecureReceiveAttempt } from "../services/secureReceivingCore.js";
import { applyInitialLegacySellingPrice } from "../services/legacyReceivingCore.js";
import { createAppError, ERROR_FLAGS, logAppError, toUserMessage } from "../utils/errorUtils.js";

const CLOUD_SAVE_TIMEOUT_MS = 12000;

let receiveSubmissionInFlight = false;
let secureMode = { status: "loading", enabled: null };
let secureModePromise = null;

const {
  createStockBatchId,
  ensureStockState,
  isBatchExpired,
  navigate,
  renderPage,
  saveState,
  state
} = window.app;

function renderReceiveStock(error = "", suppliedValues = {}) {
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

  const unresolvedAttempt = getUnresolvedSecureReceive();
  const restoredValues = valuesFromUnresolvedAttempt(unresolvedAttempt);
  const values = restoredValues || suppliedValues;
  const lines = Array.isArray(values.lines) && values.lines.length > 0
    ? values.lines
    : [createEmptyLine()];
  const locked = Boolean(unresolvedAttempt || receiveSubmissionInFlight);
  const controlsDisabled = locked ? "disabled" : "";
  const modeReady = secureMode.status === "ready";
  const secureModeEnabled = secureMode.enabled === true;
  const saveDisabled = receiveSubmissionInFlight || !modeReady ? "disabled" : "";
  const supplierOptions = renderSupplierOptions(values.supplier);
  const defaultPurchaseDate = values.purchaseDate || getCurrentDateTimeValue();
  const defaultReceivedBy = values.receivedBy || state.user?.fullName || state.user?.username || "";

  renderPage(`
    <section id="receiveStockPage">
      <div class="page-title">
        <h2>Receive Stock</h2>
        <p>Record a supplier invoice with one or more product lines.</p>
      </div>

      ${error ? `<div class="message error">${escapeHtml(error)}</div>` : ""}
      ${renderSecureModeNotice()}

      <div class="form-column panel purchase-form">
        <div class="form-row">
          <label for="stockSupplier">Supplier</label>
          <select id="stockSupplier" ${controlsDisabled}>
            <option value="">Choose supplier</option>
            ${supplierOptions}
          </select>
        </div>

        <div class="form-row">
          <label for="invoiceNumber">Invoice Number</label>
          <input id="invoiceNumber" value="${escapeHtml(values.invoiceNumber || "")}" ${controlsDisabled}>
        </div>

        <div class="form-row">
          <label for="purchaseDate">Purchase Date</label>
          <input id="purchaseDate" type="datetime-local" value="${escapeHtml(defaultPurchaseDate)}" ${controlsDisabled}>
        </div>

        <h3>Product Lines</h3>
        <div id="purchaseLines" class="purchase-lines">
          ${lines.map((line, index) => renderPurchaseLine(index, line, { locked, secureModeEnabled })).join("")}
        </div>

        <div id="purchaseSummary" class="sync-panel"></div>

        <div class="form-row">
          <label for="paymentStatus">Payment Type</label>
          <select id="paymentStatus" onchange="toggleReceiptDueDate()" ${controlsDisabled}>
            <option value="Credit" ${values.paymentStatus === "Credit" ? "selected" : ""}>Credit</option>
            <option value="Part Payment" ${values.paymentStatus === "Part Payment" ? "selected" : ""}>Part Payment</option>
            <option value="Paid in Full" ${values.paymentStatus === "Paid in Full" ? "selected" : ""}>Paid in Full</option>
          </select>
        </div>

        <div class="form-row" id="dueDateRow">
          <label for="dueDate">Due Date</label>
          <input id="dueDate" type="date" value="${escapeHtml(values.dueDate || "")}" ${controlsDisabled}>
          <small class="field-hint">Required for Credit and Part Payment purchases.</small>
        </div>

        <div class="form-row">
          <label for="receivedBy">Received By</label>
          <input id="receivedBy" value="${escapeHtml(defaultReceivedBy)}" ${controlsDisabled}>
          <small class="field-hint">The authenticated user is recorded as the secure receiving actor.</small>
        </div>

        <div class="form-row">
          <label for="purchaseNotes">Notes</label>
          <textarea id="purchaseNotes" rows="3" ${controlsDisabled}>${escapeHtml(values.notes || "")}</textarea>
        </div>

        ${secureModeEnabled ? `<small class="field-hint">Selling prices are managed separately and are not changed while receiving secure stock.</small>` : ""}

        <div class="purchase-actions">
          <button type="button" onclick="addPurchaseLine()" ${controlsDisabled}>Add Product Line</button>
          <button id="receiveStockButton" onclick="receiveStock()" ${saveDisabled}>${unresolvedAttempt ? "Retry secure purchase" : "Save Purchase"}</button>
        </div>
      </div>
    </section>
  `);

  updatePurchaseLineControls();
  toggleReceiptDueDate();
  updatePurchaseSummary();
  startSecureModeCheck();
}

function renderSecureModeNotice() {
  if (secureMode.status === "loading") {
    return `<div class="message">Checking secure inventory mode. You can complete the form while this check finishes.</div>`;
  }
  if (secureMode.status === "unavailable") {
    return `<div class="message error">Secure inventory mode could not be confirmed. Reconnect before saving; no legacy fallback will be chosen while mode is unknown. <button type="button" onclick="retrySecureModeCheck()">Retry mode check</button></div>`;
  }
  return "";
}

function startSecureModeCheck() {
  if (secureMode.status !== "loading" || secureModePromise) return;

  secureModePromise = isSecureSalesEnabled()
    .then((enabled) => {
      secureMode = { status: "ready", enabled };
      refreshReceivePageAfterModeCheck();
    })
    .catch(() => {
      secureMode = { status: "unavailable", enabled: null };
      refreshReceivePageAfterModeCheck();
    })
    .finally(() => {
      secureModePromise = null;
    });
}

function refreshReceivePageAfterModeCheck() {
  if (!document.getElementById("receiveStockPage")) return;
  renderReceiveStock("", collectPurchaseValuesAndLines());
}

function retrySecureModeCheck() {
  if (!document.getElementById("receiveStockPage")) return;
  const values = collectPurchaseValuesAndLines();
  secureMode = { status: "loading", enabled: null };
  secureModePromise = null;
  renderReceiveStock("", values);
}

function renderSupplierOptions(selectedSupplier = "") {
  if (state.suppliers.length === 0) return `<option value="">No suppliers available</option>`;
  return state.suppliers.map((supplier) => `
    <option value="${escapeHtml(supplier.name)}" ${supplier.name === selectedSupplier ? "selected" : ""}>
      ${escapeHtml(supplier.name)}
    </option>
  `).join("");
}

function renderPurchaseLine(index, line = {}, { locked, secureModeEnabled }) {
  const disabled = locked ? "disabled" : "";
  const sellingPrice = secureModeEnabled ? "" : `
    <div class="form-row">
      <label for="lineUnitSellingPrice_${index}">Selling Price</label>
      <input id="lineUnitSellingPrice_${index}" class="number-field line-unit-selling-price" type="number" min="0.01" step="0.01" value="${escapeHtml(line.unitSellingPrice || "")}" ${disabled}>
    </div>
  `;

  return `
    <div class="purchase-line card" data-line-index="${index}">
      <div class="purchase-line-header">
        <strong>Line ${index + 1}</strong>
        <button type="button" onclick="removePurchaseLine(${index})" ${disabled}>Remove</button>
      </div>

      <div class="form-row">
        <label for="lineProduct_${index}">Product</label>
        <select id="lineProduct_${index}" class="line-product" onchange="handlePurchaseLineProductChange(${index})" ${disabled}>
          ${renderProductOptions(line.productId)}
        </select>
      </div>

      <div class="form-row">
        <label for="lineBatch_${index}">Batch Number</label>
        <input id="lineBatch_${index}" class="line-batch" type="text" value="${escapeHtml(line.batchId || "")}" readonly>
      </div>

      <div class="form-row">
        <label for="lineBulkQuantity_${index}">Bulk Quantity Received</label>
        <input id="lineBulkQuantity_${index}" class="number-field line-bulk-quantity" type="number" min="1" step="1" value="${escapeHtml(line.bulkQuantityReceived || "")}" oninput="updatePurchaseSummary()" ${disabled}>
      </div>

      <div class="form-row">
        <label for="lineTotalBulkCost_${index}">Total Bulk Cost</label>
        <input id="lineTotalBulkCost_${index}" class="number-field line-total-bulk-cost" type="number" min="0" step="0.01" value="${escapeHtml(line.totalBulkCost || "")}" oninput="updatePurchaseSummary()" ${disabled}>
      </div>

      <div class="form-row">
        <label for="lineAdditionalExpenses_${index}">Additional Expenses</label>
        <input id="lineAdditionalExpenses_${index}" class="number-field line-additional-expenses" type="number" min="0" step="0.01" value="${escapeHtml(line.additionalExpenses || "")}" oninput="updatePurchaseSummary()" ${disabled}>
      </div>

      ${sellingPrice}

      <div class="form-row">
        <label for="lineExpiry_${index}">Expiry Date</label>
        <input id="lineExpiry_${index}" class="line-expiry" type="date" value="${escapeHtml(line.expiryDate || "")}" ${disabled}>
      </div>

      <div class="sync-panel line-preview"></div>
    </div>
  `;
}

function renderProductOptions(selectedProductId = "") {
  return state.products
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((product) => `<option value="${product.id}" ${product.id === selectedProductId ? "selected" : ""}>${escapeHtml(product.name)}</option>`)
    .join("");
}

function addPurchaseLine() {
  if (getUnresolvedSecureReceive()) return;
  const values = collectPurchaseValuesAndLines();
  renderReceiveStock("", { ...values, lines: [...values.lines, createEmptyLine()] });
}

function removePurchaseLine(indexToRemove) {
  if (getUnresolvedSecureReceive()) return;
  const values = collectPurchaseValuesAndLines();
  const lines = values.lines.filter((_, index) => index !== indexToRemove);
  renderReceiveStock("", { ...values, lines: lines.length ? lines : [createEmptyLine()] });
}

function handlePurchaseLineProductChange() {
  updatePurchaseSummary();
}

function updatePurchaseLineControls() {
  const lines = document.querySelectorAll(".purchase-line");
  lines.forEach((line) => {
    const button = /** @type {HTMLButtonElement | null} */ (line.querySelector(".purchase-line-header button"));
    if (button) button.disabled = button.disabled || lines.length <= 1;
  });
}

function updatePurchaseSummary() {
  const summary = document.getElementById("purchaseSummary");
  const lines = collectPurchaseLines();
  let totalAmount = 0;
  let totalBaseUnits = 0;

  lines.forEach((line, index) => {
    const product = getProductById(line.productId);
    const bulkQuantity = Number(line.bulkQuantityReceived || 0);
    const quantityReceived = bulkQuantity * getUnitsPerBulk(product);
    const totalLandedCost = Number(line.totalBulkCost || 0) + Number(line.additionalExpenses || 0);
    const preview = document.querySelector(`[data-line-index="${index}"] .line-preview`);
    totalAmount += totalLandedCost;
    totalBaseUnits += quantityReceived;

    if (preview) {
      preview.innerHTML = product ? `
        <strong>${escapeHtml(product.name)}</strong><br>
        Batch: ${escapeHtml(line.batchId || "pending")}<br>
        Bulk quantity received: ${bulkQuantity} ${escapeHtml(product.bulkUnit || "bulk unit")}(s)<br>
        Unit quantity: ${quantityReceived} ${escapeHtml(product.baseUnit || "base unit")}(s)<br>
        Total landed cost: ${formatCurrency(totalLandedCost)}<br>
        Unit cost: ${formatCurrency(quantityReceived ? totalLandedCost / quantityReceived : 0)} = landed cost ÷ quantity
        ${secureMode.enabled === false ? `<br>Selling price: ${formatCurrency(line.unitSellingPrice)}` : ""}
      ` : "Choose a product to preview this line.";
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
  receiveSubmissionInFlight = isProcessing;
  const button = document.getElementById("receiveStockButton");
  if (!button) return;
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
      ${purchaseId ? `<br>Purchase ID: ${escapeHtml(purchaseId)}` : ""}
    </div>
    <div class="inventory-list">
      ${receipts.map((receipt) => renderSavedReceipt(receipt)).join("")}
    </div>
    <div class="form-column panel">
      <button onclick="renderReceiveStock()">Receive Another Purchase</button>
      <button onclick="navigate('inventory')">View Inventory</button>
      <button onclick="navigate('reports')">View Reports</button>
      <button onclick="navigate('dashboard')">Dashboard</button>
    </div>
  `);
}

function renderSavedReceipt(receipt) {
  return `
    <div class="inventory-row">
      <div><strong>Product:</strong> ${escapeHtml(receipt.product || receipt.productNameSnapshot)}</div>
      <div><strong>Supplier:</strong> ${escapeHtml(receipt.supplier || "N/A")}</div>
      <div><strong>Invoice:</strong> ${escapeHtml(receipt.invoiceNumber || "N/A")}</div>
      <div><strong>Batch Number:</strong> ${escapeHtml(receipt.batchId || "N/A")}</div>
      <div><strong>Date Received:</strong> ${formatReceiptTime(receipt.purchaseDate || receipt.receivedAt)}</div>
      <div><strong>Payment:</strong> ${escapeHtml(receipt.paymentStatus || "N/A")}</div>
      <div><strong>Due Date:</strong> ${escapeHtml(receipt.dueDate || "N/A")}</div>
      <div><strong>Quantity Received:</strong> ${receipt.baseQuantity || receipt.quantityReceived} ${escapeHtml(receipt.baseUnit || "base unit")}(s)</div>
      <div><strong>Total Bulk Cost:</strong> ${formatCurrency(receipt.totalBulkCost)}</div>
      <div><strong>Additional Expenses:</strong> ${formatCurrency(receipt.additionalExpenses)}</div>
      <div><strong>Total Landed Cost:</strong> ${formatCurrency(receipt.totalLandedCost)}</div>
      <div><strong>Unit Cost:</strong> ${formatCurrency(receipt.unitCost)}</div>
      <div><strong>Expiry Date:</strong> ${escapeHtml(receipt.expiryDate || "N/A")}</div>
    </div>
  `;
}

async function receiveStock() {
  ensureStockState();
  if (receiveSubmissionInFlight) return;

  if (secureMode.status !== "ready") {
    renderReceiveStock("Secure inventory mode must be confirmed before saving. Reconnect and retry the mode check.", collectPurchaseValuesAndLines());
    return;
  }

  const values = collectPurchaseValues();
  const lines = collectPurchaseLines();
  const formError = validatePurchase(values, lines, { requireSellingPrice: secureMode.enabled === false });
  if (formError) {
    renderReceiveStock(formError, { ...values, lines });
    return;
  }

  try {
    setReceiveStockProcessing(true);
    if (secureMode.enabled) {
      const confirmed = await submitSecureReceive(buildSecurePurchase(values, lines));
      const receipts = confirmed.lines.map((line) => ({
        ...line,
        supplier: confirmed.supplier,
        invoiceNumber: confirmed.invoiceNumber,
        purchaseDate: confirmed.purchaseDate,
        paymentStatus: confirmed.paymentStatus,
        dueDate: confirmed.dueDate,
        notes: confirmed.notes
      }));
      renderStockSaved(receipts, confirmed.totalLandedCost, confirmed.purchaseId);
      return;
    }

    await saveLegacyPurchase(values, lines);
  } catch (error) {
    logAppError("Purchase save failed", error);
    renderReceiveStock(toUserMessage(error, "Unable to save purchase. Check your connection and retry."), { ...values, lines });
  } finally {
    setReceiveStockProcessing(false);
  }
}

async function saveLegacyPurchase(values, lines) {
  const purchaseId = createPurchaseId();
  const receipts = lines.map((line) => buildLegacyReceipt(values, line, purchaseId));
  const totalAmount = receipts.reduce((sum, receipt) => sum + Number(receipt.totalLandedCost || 0), 0);
  const cloudResult = await withTimeout(
    receivePurchaseInCloudTransaction({
      lines: receipts.map((receipt) => ({ productId: receipt.productId, quantityReceived: receipt.quantityReceived, receipt }))
    }),
    CLOUD_SAVE_TIMEOUT_MS,
    "We could not confirm whether this purchase was saved. The form is retained. Do not submit it again automatically; check stock receipts or reconnect before deciding how to proceed."
  );

  applyLegacyPurchaseLocally({ receipts, cloudLines: cloudResult?.lines || [] });
  renderStockSaved(receipts, totalAmount, purchaseId);
}

function validatePurchase(values, lines, { requireSellingPrice }) {
  if (!values.supplier) return "Enter the supplier.";
  if (!values.invoiceNumber) return "Enter the invoice number.";
  if (!values.purchaseDate) return "Enter the purchase date.";
  if (!values.receivedBy) return "Enter who received the stock.";
  if (isCreditLikePayment(values.paymentStatus) && !values.dueDate) return "Enter a due date for Credit or Part Payment purchases.";
  if (!lines.length) return "Add at least one product line.";

  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    if (!getProductById(line.productId)) return `Choose a product for line ${lineNumber}.`;
    if (!Number.isSafeInteger(Number(line.bulkQuantityReceived)) || Number(line.bulkQuantityReceived) < 1) return `Enter a whole bulk quantity for line ${lineNumber}.`;
    if (parsePesewas(line.totalBulkCost) === null) return `Enter a valid total bulk cost for line ${lineNumber}.`;
    if (parsePesewas(line.additionalExpenses, { blankAsZero: true }) === null) return `Enter valid additional expenses for line ${lineNumber}.`;
    if (requireSellingPrice && (!Number.isFinite(Number(line.unitSellingPrice)) || Number(line.unitSellingPrice) <= 0)) return `Enter a valid unit selling price for line ${lineNumber}.`;
    if (line.expiryDate && isBatchExpired(line.expiryDate)) return `Expiry date on line ${lineNumber} cannot be in the past.`;
  }

  return "";
}

function buildSecurePurchase(values, lines) {
  return {
    supplier: values.supplier,
    invoiceNumber: values.invoiceNumber,
    purchaseDate: values.purchaseDate,
    paymentStatus: values.paymentStatus,
    dueDate: values.dueDate,
    notes: values.notes,
    receivedByNote: values.receivedBy,
    lines: lines.map((line) => ({
      productId: line.productId,
      quantity: Number(line.bulkQuantityReceived),
      unit: "bulk",
      totalBulkCostPesewas: parsePesewas(line.totalBulkCost),
      additionalExpensesPesewas: parsePesewas(line.additionalExpenses, { blankAsZero: true }),
      expiryBusinessDate: line.expiryDate
    }))
  };
}

function buildLegacyReceipt(values, line, purchaseId) {
  const product = getProductById(line.productId);
  const bulkQuantityReceived = Number(line.bulkQuantityReceived);
  const quantityReceived = bulkQuantityReceived * getUnitsPerBulk(product);
  const totalBulkCost = Number(line.totalBulkCost);
  const additionalExpenses = Number(line.additionalExpenses || 0);
  const totalLandedCost = totalBulkCost + additionalExpenses;
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
    unitCost: totalLandedCost / quantityReceived,
    unitSellingPrice: Number(line.unitSellingPrice),
    baseUnit: product.baseUnit || "base unit",
    bulkUnit: product.bulkUnit || "bulk unit",
    expiryDate: line.expiryDate
  };
}

function applyLegacyPurchaseLocally({ receipts, cloudLines = [] }) {
  receipts.forEach((receipt, index) => {
    const product = getProductById(receipt.productId);
    const receiptId = cloudLines[index]?.receiptId || receipt.id;

    state.stock.push({ ...receipt, id: receipt.batchId, quantity: receipt.quantityReceived });
    state.stockReceipts.push({ ...receipt, id: receiptId });

    if (!product) return;
    product.quantity = Number(product.quantity || 0) + receipt.quantityReceived;

    applyInitialLegacySellingPrice(product, receipt, getUnitsPerBulk(product));
  });

  saveState();
}

function collectPurchaseValuesAndLines() {
  return { ...collectPurchaseValues(), lines: collectPurchaseLines() };
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
    totalBulkCost: line.querySelector(".line-total-bulk-cost")?.value || "",
    additionalExpenses: line.querySelector(".line-additional-expenses")?.value || "",
    expiryDate: line.querySelector(".line-expiry")?.value || "",
    unitSellingPrice: line.querySelector(".line-unit-selling-price")?.value || ""
  }));
}

function valuesFromUnresolvedAttempt(attempt) {
  const purchase = purchaseFromSecureReceiveAttempt(attempt);
  if (!purchase) return null;

  return {
    supplier: purchase.supplier,
    invoiceNumber: purchase.invoiceNumber,
    purchaseDate: purchase.purchaseDate,
    paymentStatus: purchase.paymentStatus,
    dueDate: purchase.dueDate,
    notes: purchase.notes,
    receivedBy: purchase.receivedByNote,
    lines: purchase.lines.map((line) => ({
      productId: line.productId,
      batchId: createStockBatchId(),
      bulkQuantityReceived: line.quantity,
      totalBulkCost: formatPesewas(line.totalBulkCostPesewas),
      additionalExpenses: formatPesewas(line.additionalExpensesPesewas),
      expiryDate: line.expiryBusinessDate,
      unitSellingPrice: ""
    }))
  };
}

function createEmptyLine() {
  return {
    productId: state.products[0]?.id || "",
    batchId: createStockBatchId(),
    bulkQuantityReceived: "",
    totalBulkCost: "",
    additionalExpenses: "",
    unitSellingPrice: "",
    expiryDate: ""
  };
}

function toggleReceiptDueDate() {
  const dueDateRow = document.getElementById("dueDateRow");
  if (dueDateRow) dueDateRow.style.display = isCreditLikePayment(document.getElementById("paymentStatus")?.value) ? "block" : "none";
}

function getProductById(productId) {
  return state.products.find((product) => product.id === productId);
}

function isCreditLikePayment(status = "") {
  return ["credit", "part payment"].includes(String(status).toLowerCase());
}

function getUnitsPerBulk(product) {
  const value = Number(product?.unitsPerBulk);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function createPurchaseId() {
  return `purchase_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
}

function getCurrentDateTimeValue() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function formatPesewas(value) {
  return (Number(value || 0) / 100).toFixed(2);
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
  return Promise.race([promise.finally(() => clearTimeout(timeoutId)), timeout]);
}

function formatCurrency(value) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "GHS" }).format(Number(value || 0));
}

function formatReceiptTime(value) {
  const parsed = new Date(value);
  return value && !Number.isNaN(parsed.getTime()) ? parsed.toLocaleString() : (value || "N/A");
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
window["retrySecureModeCheck"] = retrySecureModeCheck;
window.getCurrentDateTimeValue = getCurrentDateTimeValue;
