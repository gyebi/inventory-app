import { createAppError, ERROR_FLAGS } from "../utils/errorUtils.js";

const {
  ensureStockState,
  formatReceiptCurrency,
  getBatchesByProductId,
  navigate,
  renderPage,
  saveState,
  state
} = window.app;

const adjustmentTypes = [
  "Damaged",
  "Lost",
  "Expired",
  "Breakage",
  "Theft",
  "Leakage",
  "Other"
];

function renderStockAdjustment(error = "", values = {}) {
  ensureStockState();

  if (state.products.length === 0) {
    renderPage(`
      <div class="page-title">
        <h2>Stock Adjustment</h2>
        <p>Record stock losses from damaged, lost, expired, broken, stolen, or leaked goods.</p>
      </div>
      <div class="message error">Add a product before recording a stock adjustment.</div>
      <button onclick="navigate('addProduct')">Add Product</button>
    `);
    return;
  }

  const productOptions = state.products
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((product) => `
      <option value="${product.id}" ${product.id === values.productId ? "selected" : ""}>
        ${escapeHtml(product.name)}
      </option>
    `)
    .join("");
  const selectedProduct = getSelectedProduct(values.productId);
  const typeOptions = adjustmentTypes
    .map((type) => `<option value="${type}" ${type === values.adjustmentType ? "selected" : ""}>${type}</option>`)
    .join("");
  const dateValue = values.date || getCurrentDateTimeValue();
  const recordedBy = state.user?.fullName || state.user?.username || state.user?.email || "Unknown";

  renderPage(`
    <div class="page-title">
      <h2>Stock Adjustment</h2>
      <p>Remove unusable or missing stock and keep an audit trail for reporting.</p>
    </div>

    ${error ? `<div class="message error">${error}</div>` : ""}

    <div class="form-column panel">
      <div class="form-row">
        <label for="adjustmentProductId">Product</label>
        <select id="adjustmentProductId" onchange="renderStockAdjustment('', collectStockAdjustmentValues())">
          ${productOptions}
        </select>
      </div>

      <div class="form-row">
        <label for="adjustmentBatchId">Batch, if applicable</label>
        <select id="adjustmentBatchId" onchange="updateStockAdjustmentPreview()">
          ${renderBatchOptions(selectedProduct?.id, values.batchId)}
        </select>
      </div>

      <div class="form-row">
        <label for="adjustmentType">Adjustment Type</label>
        <select id="adjustmentType">${typeOptions}</select>
      </div>

      <div class="form-row">
        <label for="adjustmentQuantity">Quantity Affected</label>
        <input
          id="adjustmentQuantity"
          class="number-field"
          type="number"
          min="1"
          step="1"
          value="${values.quantityAffected || ""}"
          oninput="updateStockAdjustmentPreview()"
        >
      </div>

      <div class="form-row">
        <label for="adjustmentUnit">Unit</label>
        <select id="adjustmentUnit" onchange="updateStockAdjustmentPreview()">
          ${renderUnitOptions(selectedProduct, values.unit)}
        </select>
      </div>

      <div id="stockAdjustmentPreview" class="sync-panel"></div>

      <div class="form-row">
        <label for="adjustmentReason">Reason / Notes</label>
        <textarea id="adjustmentReason" rows="3">${escapeHtml(values.reason || "")}</textarea>
      </div>

      <div class="form-row">
        <label for="adjustmentLocation">Branch / Warehouse Location</label>
        <input id="adjustmentLocation" value="${escapeHtml(values.location || "")}">
      </div>

      <div class="form-row">
        <label for="adjustmentDate">Date</label>
        <input id="adjustmentDate" type="datetime-local" value="${dateValue}">
      </div>

      <div class="form-row">
        <label>Recorded By</label>
        <input value="${escapeHtml(recordedBy)}" disabled>
      </div>

      <button onclick="recordStockAdjustment()">Record Adjustment</button>
    </div>
  `);

  updateStockAdjustmentPreview();
}

function collectStockAdjustmentValues() {
  return {
    productId: document.getElementById("adjustmentProductId")?.value || "",
    batchId: document.getElementById("adjustmentBatchId")?.value || "",
    adjustmentType: document.getElementById("adjustmentType")?.value || "Damaged",
    quantityAffected: document.getElementById("adjustmentQuantity")?.value || "",
    unit: document.getElementById("adjustmentUnit")?.value || "",
    reason: document.getElementById("adjustmentReason")?.value || "",
    location: document.getElementById("adjustmentLocation")?.value || "",
    date: document.getElementById("adjustmentDate")?.value || ""
  };
}

function recordStockAdjustment() {
  ensureStockState();

  const values = collectStockAdjustmentValues();
  const product = getSelectedProduct(values.productId);
  const quantityAffected = Number(values.quantityAffected);

  if (!product) {
    renderStockAdjustment("Choose a product before recording an adjustment.", values);
    return;
  }

  if (!Number.isInteger(quantityAffected) || quantityAffected <= 0) {
    renderStockAdjustment("Quantity affected must be a whole number greater than zero.", values);
    return;
  }

  if (!values.reason.trim()) {
    renderStockAdjustment("Enter a reason or note for this adjustment.", values);
    return;
  }

  if (!values.location.trim()) {
    renderStockAdjustment("Enter the branch or warehouse location.", values);
    return;
  }

  if (!values.date) {
    renderStockAdjustment("Enter the adjustment date.", values);
    return;
  }

  const baseQuantityAffected = toBaseUnits(product, quantityAffected, values.unit);
  const totalAvailable = values.batchId
    ? Number(getBatchById(values.batchId)?.quantity || 0)
    : getTotalBatchQuantity(product.id);

  if (baseQuantityAffected > totalAvailable) {
    renderStockAdjustment(
      `Quantity affected is more than available stock. Available: ${formatStockQuantity(totalAvailable, product)}.`,
      values
    );
    return;
  }

  const allocations = deductAdjustedStock(product.id, baseQuantityAffected, values.batchId);
  const primaryBatch = values.batchId ? getBatchById(values.batchId) : getBatchById(allocations[0]?.batchId);
  const costPrice = Number(product.costPrice || 0);
  const totalLossValue = baseQuantityAffected * costPrice;
  const adjustment = {
    id: createAdjustmentId(),
    date: values.date,
    productId: product.id,
    productName: product.name,
    category: product.category || "",
    quantityAffected,
    baseQuantityAffected,
    unit: values.unit || product.baseUnit || "base unit",
    adjustmentType: values.adjustmentType,
    reason: values.reason.trim(),
    costPrice,
    totalLossValue,
    batchId: values.batchId || "",
    batchNumber: values.batchId || "",
    batchAllocations: allocations,
    expiryDate: primaryBatch?.expiryDate || "",
    recordedBy: {
      id: state.user?.id || state.user?.uid || "",
      fullName: state.user?.fullName || state.user?.username || state.user?.email || "Unknown",
      username: state.user?.username || "",
      role: state.user?.role || ""
    },
    branch: values.location.trim(),
    createdAt: new Date().toISOString()
  };

  product.quantity = Math.max(Number(product.quantity || 0) - baseQuantityAffected, 0);

  if (!Array.isArray(state.stockAdjustments)) {
    state.stockAdjustments = [];
  }

  state.stockAdjustments.push(adjustment);
  saveState();
  renderStockAdjustmentSaved(adjustment, product);
}

function renderStockAdjustmentSaved(adjustment, product) {
  renderPage(`
    <div class="page-title">
      <h2>Stock Adjustment Saved</h2>
      <p>${escapeHtml(adjustment.adjustmentType)} stock adjustment recorded for ${escapeHtml(product.name)}.</p>
    </div>

    <div class="message success">
      ${adjustment.quantityAffected} ${escapeHtml(adjustment.unit)} recorded.
      Total loss value: ${formatCurrency(adjustment.totalLossValue)}.
    </div>

    <div class="inventory-row">
      <div><strong>Product:</strong> ${escapeHtml(product.name)}</div>
      <div><strong>Type:</strong> ${escapeHtml(adjustment.adjustmentType)}</div>
      <div><strong>Base Units Removed:</strong> ${adjustment.baseQuantityAffected} ${escapeHtml(product.baseUnit || "base unit")}(s)</div>
      <div><strong>Reason:</strong> ${escapeHtml(adjustment.reason)}</div>
      <div><strong>Location:</strong> ${escapeHtml(adjustment.branch)}</div>
      <div><strong>Remaining Stock:</strong> ${formatStockQuantity(product.quantity, product)}</div>
    </div>

    <div class="form-column panel">
      <button onclick="renderStockAdjustment()">Record Another Adjustment</button>
      <button onclick="navigate('reports')">View Reports</button>
      <button onclick="navigate('inventory')">View Inventory</button>
      <button onclick="navigate('home')">Main Menu</button>
    </div>
  `);
}

function updateStockAdjustmentPreview() {
  const preview = document.getElementById("stockAdjustmentPreview");

  if (!preview) {
    return;
  }

  const values = collectStockAdjustmentValues();
  const product = getSelectedProduct(values.productId);
  const quantityAffected = Number(values.quantityAffected || 0);

  if (!product) {
    preview.textContent = "Choose a product to preview the adjustment.";
    return;
  }

  const baseQuantityAffected = quantityAffected > 0
    ? toBaseUnits(product, quantityAffected, values.unit)
    : 0;
  const availableQuantity = values.batchId
    ? Number(getBatchById(values.batchId)?.quantity || 0)
    : getTotalBatchQuantity(product.id);
  const lossValue = baseQuantityAffected * Number(product.costPrice || 0);

  preview.innerHTML = `
    <strong>Preview</strong><br>
    Available stock: ${formatStockQuantity(availableQuantity, product)}<br>
    Base units to remove: ${baseQuantityAffected} ${escapeHtml(product.baseUnit || "base unit")}(s)<br>
    Estimated loss value: ${formatCurrency(lossValue)}
  `;
}

function deductAdjustedStock(productId, quantityNeeded, selectedBatchId = "") {
  const batches = selectedBatchId
    ? [getBatchById(selectedBatchId)].filter(Boolean)
    : getBatchesByProductId(productId).slice().sort(compareBatchesForAdjustment);
  let remaining = quantityNeeded;
  const allocations = [];

  for (const batch of batches) {
    if (remaining <= 0) {
      break;
    }

    const quantityTaken = Math.min(Number(batch.quantity || 0), remaining);

    if (quantityTaken <= 0) {
      continue;
    }

    batch.quantity -= quantityTaken;
    remaining -= quantityTaken;
    allocations.push({
      batchId: batch.id,
      quantity: quantityTaken,
      expiryDate: batch.expiryDate || ""
    });
  }

  if (remaining > 0) {
    throw createAppError("Not enough stock is available for this adjustment. Reduce the quantity or choose another batch.", {
      code: "inventory/insufficient-adjustment-stock",
      source: ERROR_FLAGS.SOURCE_VALIDATION
    });
  }

  return allocations;
}

function compareBatchesForAdjustment(left, right) {
  const leftTime = left.expiryDate ? new Date(left.expiryDate).getTime() : Number.MAX_SAFE_INTEGER;
  const rightTime = right.expiryDate ? new Date(right.expiryDate).getTime() : Number.MAX_SAFE_INTEGER;

  if (leftTime !== rightTime) {
    return leftTime - rightTime;
  }

  return new Date(left.receivedAt || 0).getTime() - new Date(right.receivedAt || 0).getTime();
}

function renderBatchOptions(productId, selectedBatchId = "") {
  const batches = productId ? getBatchesByProductId(productId) : [];

  if (batches.length === 0) {
    return `<option value="">No tracked batches available</option>`;
  }

  return `
    <option value="">Auto select from available batches</option>
    ${batches.map((batch) => `
      <option value="${batch.id}" ${batch.id === selectedBatchId ? "selected" : ""}>
        ${escapeHtml(batch.id)} - ${batch.quantity} unit(s)${batch.expiryDate ? ` - expires ${escapeHtml(batch.expiryDate)}` : ""}
      </option>
    `).join("")}
  `;
}

function renderUnitOptions(product, selectedUnit = "") {
  if (!product) {
    return `<option value="">Choose product first</option>`;
  }

  const baseUnit = product.baseUnit || "base unit";
  const bulkUnit = product.bulkUnit || "bulk unit";
  const selected = selectedUnit || baseUnit;

  return `
    <option value="${escapeHtml(baseUnit)}" ${selected === baseUnit ? "selected" : ""}>${escapeHtml(baseUnit)}</option>
    <option value="${escapeHtml(bulkUnit)}" ${selected === bulkUnit ? "selected" : ""}>${escapeHtml(bulkUnit)}</option>
  `;
}

function getSelectedProduct(productId) {
  return state.products.find((product) => product.id === productId) || state.products[0];
}

function getBatchById(batchId) {
  return state.stock.find((batch) => batch.id === batchId);
}

function getTotalBatchQuantity(productId) {
  return getBatchesByProductId(productId).reduce((sum, batch) => sum + Number(batch.quantity || 0), 0);
}

function toBaseUnits(product, quantity, unit) {
  if (unit === product.bulkUnit) {
    return quantity * getUnitsPerBulk(product);
  }

  return quantity;
}

function getUnitsPerBulk(product) {
  const unitsPerBulk = Number(product.unitsPerBulk);
  return Number.isFinite(unitsPerBulk) && unitsPerBulk > 0 ? unitsPerBulk : 1;
}

function formatStockQuantity(quantity, product) {
  const unitsPerBulk = getUnitsPerBulk(product);
  const fullBulk = Math.floor(Number(quantity || 0) / unitsPerBulk);
  const remainder = Number(quantity || 0) % unitsPerBulk;

  return `${fullBulk} ${product.bulkUnit || "bulk unit"}(s) and ${remainder} ${product.baseUnit || "base unit"}(s)`;
}

function getCurrentDateTimeValue() {
  const now = new Date();
  const localTime = new Date(now.getTime() - (now.getTimezoneOffset() * 60000));
  return localTime.toISOString().slice(0, 16);
}

function createAdjustmentId() {
  return `adj_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
}

function formatCurrency(value) {
  return formatReceiptCurrency
    ? formatReceiptCurrency(value)
    : Number(value || 0).toFixed(2);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

window.renderStockAdjustment = renderStockAdjustment;
window.collectStockAdjustmentValues = collectStockAdjustmentValues;
window.recordStockAdjustment = recordStockAdjustment;
window.updateStockAdjustmentPreview = updateStockAdjustmentPreview;
