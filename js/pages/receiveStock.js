import { receiveStockInCloudTransaction } from "../services/cloudProductService.js";

const CLOUD_SAVE_TIMEOUT_MS = 12000;

const {
  createStockBatchId,
  ensureStockState,
  isBatchExpired,
  navigate,
  parseExpiryDate,
  renderPage,
  saveState,
  state,
  syncProductQuantities
} = window.app;

function renderReceiveStock(error = "", values = {}) {
  ensureStockState();

  if (state.products.length === 0) {
    renderPage(`
      <div class="page-title">
        <h2>📥 Receive Stock</h2>
        <p>Add supplier deliveries to an existing product.</p>
      </div>
      <div class="message error">Add a product before receiving stock.</div>
      <button onclick="navigate('addProduct')">Add Product</button>
    `);
    return;
  }

  const options = state.products.map(
    (product) => `<option value="${product.id}">${product.name}</option>`
  ).join("");
  const supplierOptions = state.suppliers.map(
    (supplier) => `<option value="${supplier.name}">${supplier.name}</option>`
  ).join("");
  const defaultReceivedAt = values.receivedAt || getCurrentDateTimeValue();
  const defaultReceivedBy = values.receivedBy || state.user?.fullName || state.user?.username || "";

  renderPage(`
    <div class="page-title">
      <h2>📥 Receive Stock</h2>
      <p>Add bulk units, loose base units, and delivery details.</p>
    </div>

    ${error ? `<div class="message error">${error}</div>` : ""}

    <div class="form-column panel">
      <div class="form-row">
        <label for="stockProductIndex">Product</label>
        <select id="stockProductIndex" onchange="updateReceiveStockPreview()">${options}</select>
      </div>

      <div class="form-row">
        <label for="stockSupplier">Supplier</label>
        <input id="stockSupplier" list="supplier-list" value="${values.supplier || ""}">
        <datalist id="supplier-list">${supplierOptions}</datalist>
      </div>

      <div class="form-row">
        <label for="bulkUnitsReceived">Bulk Units Received</label>
        <input id="bulkUnitsReceived" class="number-field" type="number" min="0" step="1" value="${values.bulkUnitsReceived || ""}" oninput="updateReceiveStockPreview()">
      </div>

      <div class="form-row">
        <label for="baseUnitsReceived">Base Units Received</label>
        <input id="baseUnitsReceived" class="number-field" type="number" min="0" step="1" value="${values.baseUnitsReceived || ""}" oninput="updateReceiveStockPreview()">
      </div>

      <div id="stockPreview" class="sync-panel"></div>

      <div class="form-row">
        <label for="receivedBy">Received By</label>
        <input id="receivedBy" value="${defaultReceivedBy}">
      </div>

      <div class="form-row">
        <label for="invoiceDetails">Invoice Details</label>
        <input id="invoiceDetails" value="${values.invoiceDetails || ""}">
      </div>

      <div class="form-row">
        <label for="receivedAt">Received Time</label>
        <input id="receivedAt" type="datetime-local" value="${defaultReceivedAt}">
      </div>

      <div class="form-row">
        <label for="expiryDate">Batch Expiry Date</label>
        <input id="expiryDate" type="date" value="${values.expiryDate || ""}">
      </div>

      <div class="form-row">
        <label for="paymentStatus">Payment Status</label>
        <select id="paymentStatus">
          <option value="Paid" ${values.paymentStatus === "Paid" ? "selected" : ""}>Paid</option>
          <option value="Credit" ${values.paymentStatus === "Credit" ? "selected" : ""}>Credit</option>
        </select>
      </div>

      <button id="receiveStockButton" onclick="receiveStock()">Receive Stock</button>
    </div>
  `);

  if (values.productId) {
    document.getElementById("stockProductIndex").value = values.productId;
  }
  updateReceiveStockPreview();
}

function updateReceiveStockPreview() {
  const productId = document.getElementById("stockProductIndex")?.value;
  const bulkUnitsReceived = Number(document.getElementById("bulkUnitsReceived")?.value || 0);
  const baseUnitsReceived = Number(document.getElementById("baseUnitsReceived")?.value || 0);
  const product = state.products.find((item) => item.id === productId);
  const preview = document.getElementById("stockPreview");

  if (!preview) {
    return;
  }

  if (!product) {
    preview.textContent = "Choose a product to preview the stock quantity.";
    return;
  }

  const unitsPerBulk = getUnitsPerBulk(product);
  const bulkUnit = product.bulkUnit || "bulk unit";
  const baseUnit = product.baseUnit || "base unit";
  const quantityReceived = (bulkUnitsReceived * unitsPerBulk) + baseUnitsReceived;

  preview.innerHTML = `
    <strong>Preview</strong><br>
    ${bulkUnitsReceived} ${bulkUnit}(s) x ${unitsPerBulk} + ${baseUnitsReceived} ${baseUnit}(s)
    = ${quantityReceived} ${baseUnit}(s)<br>
    Current stock: ${formatProductStock(product)}
  `;
}

function setReceiveStockProcessing(isProcessing) {
  const button = document.getElementById("receiveStockButton");

  if (!button) {
    return;
  }

  button.disabled = isProcessing;
  button.innerHTML = isProcessing
    ? `<span class="button-spinner" aria-hidden="true"></span>Saving stock...`
    : "Receive Stock";
}

function renderStockSaved(product, receipt, quantityReceived, receiptId) {
  renderPage(`
    <div class="page-title">
      <h2>Stock Saved</h2>
      <p>Firebase confirmed the stock record.</p>
    </div>

    <div class="message success">
      ${quantityReceived} ${product.baseUnit || "base unit"}(s) added to ${product.name}. Current stock is ${formatProductStock(product)}.
      ${receiptId ? `<br>Receipt ID: ${receiptId}` : ""}
    </div>

    <div class="inventory-row">
      <div><strong>Product:</strong> ${product.name}</div>
      <div><strong>Supplier:</strong> ${receipt.supplier || "N/A"}</div>
      <div><strong>Received By:</strong> ${receipt.receivedBy}</div>
      <div><strong>Invoice:</strong> ${receipt.invoiceDetails}</div>
      <div><strong>Time:</strong> ${formatReceiptTime(receipt.receivedAt)}</div>
      <div><strong>Expiry:</strong> ${formatExpiryDate(receipt.expiryDate)}</div>
      <div><strong>Payment:</strong> ${receipt.paymentStatus}</div>
      <div><strong>Bulk Units:</strong> ${receipt.bulkUnitsReceived}</div>
      <div><strong>Base Units:</strong> ${receipt.baseUnitsReceived}</div>
      <div><strong>Total Received:</strong> ${quantityReceived} ${product.baseUnit || "base unit"}(s)</div>
      <div><strong>Current Stock:</strong> ${formatProductStock(product)}</div>
    </div>

    <div class="form-column panel">
      <button onclick="renderReceiveStock()">Receive More Stock</button>
      <button onclick="navigate('inventory')">View Inventory</button>
      <button onclick="navigate('home')">Main Menu</button>
    </div>
  `);
}

function applyReceivedStockLocally({
  product,
  productId,
  batchId,
  receipt,
  quantityReceived,
  receiptId
}) {
  state.stock.push({
    id: batchId,
    productId,
    productName: product.name,
    quantity: quantityReceived,
    bulkUnitsReceived: receipt.bulkUnitsReceived,
    baseUnitsReceived: receipt.baseUnitsReceived,
    receivedBy: receipt.receivedBy,
    supplier: receipt.supplier,
    invoiceDetails: receipt.invoiceDetails,
    receivedAt: receipt.receivedAt,
    expiryDate: receipt.expiryDate,
    paymentStatus: receipt.paymentStatus
  });

  syncProductQuantities();
  state.stockReceipts.push({
    id: receiptId,
    productId,
    ...receipt,
    quantityReceived
  });
  product.quantity += quantityReceived;

  saveState();
}

async function receiveStock() {
  ensureStockState();

  const productId = document.getElementById("stockProductIndex").value;
  const bulkUnitsReceived = Number(document.getElementById("bulkUnitsReceived").value);
  const baseUnitsReceived = Number(document.getElementById("baseUnitsReceived").value);
  const supplier = document.getElementById("stockSupplier").value.trim();
  const receivedBy = document.getElementById("receivedBy").value.trim();
  const invoiceDetails = document.getElementById("invoiceDetails").value.trim();
  const receivedAt = document.getElementById("receivedAt").value;
  const expiryDate = document.getElementById("expiryDate").value;
  const paymentStatus = document.getElementById("paymentStatus").value;
  const product = state.products.find((item) => item.id === productId);
  const values = {
    productId,
    supplier,
    bulkUnitsReceived: document.getElementById("bulkUnitsReceived").value,
    baseUnitsReceived: document.getElementById("baseUnitsReceived").value,
    receivedBy,
    invoiceDetails,
    receivedAt,
    expiryDate,
    paymentStatus
  };

  if (!product) {
    renderReceiveStock("Choose a product before receiving stock.", values);
    return;
  }

  if (!Number.isInteger(bulkUnitsReceived) || bulkUnitsReceived < 0) {
    renderReceiveStock("Bulk units received must be a whole number of zero or more.", values);
    return;
  }

  if (!Number.isInteger(baseUnitsReceived) || baseUnitsReceived < 0) {
    renderReceiveStock("Base units received must be a whole number of zero or more.", values);
    return;
  }

  if (bulkUnitsReceived === 0 && baseUnitsReceived === 0) {
    renderReceiveStock("Enter bulk units received, base units received, or both.", values);
    return;
  }

  if (!receivedBy) {
    renderReceiveStock("Enter who received the stock.", values);
    return;
  }

  if (!invoiceDetails) {
    renderReceiveStock("Enter the invoice details.", values);
    return;
  }

  if (!receivedAt) {
    renderReceiveStock("Enter the date and time the stock was received.", values);
    return;
  }

  if (expiryDate && isBatchExpired(expiryDate)) {
    renderReceiveStock("Batch expiry date cannot be in the past.", values);
    return;
  }

  const unitsPerBulk = getUnitsPerBulk(product);
  const quantityReceived = (bulkUnitsReceived * unitsPerBulk) + baseUnitsReceived;
  const batchId = createStockBatchId();
  const receipt = {
    batchId,
    product: product.name,
    supplier,
    bulkUnitsReceived,
    baseUnitsReceived,
    receivedBy,
    invoiceDetails,
    receivedAt,
    expiryDate,
    paymentStatus
  };
  let cloudResult;

  try {
    setReceiveStockProcessing(true);
    cloudResult = await withTimeout(
      receiveStockInCloudTransaction({
        productId: product.id,
        quantityReceived,
        receipt
      }),
      CLOUD_SAVE_TIMEOUT_MS,
      "Stock was not saved because Firestore did not respond. Check your internet connection and confirm Firestore rules allow updates to products and creates in stockReceipts."
    );
  } catch (error) {
    renderReceiveStock(error.message || "Unable to update stock in Firestore.", values);
    return;
  } finally {
    setReceiveStockProcessing(false);
  }

  applyReceivedStockLocally({
    product,
    productId: product.id,
    batchId,
    receipt,
    quantityReceived,
    receiptId: cloudResult?.receiptId
  });

  renderStockSaved(product, receipt, quantityReceived, cloudResult?.receiptId);
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

function formatProductStock(product) {
  const unitsPerBulk = getUnitsPerBulk(product);
  const quantity = Number(product.quantity || 0);
  const fullBulk = Math.floor(quantity / unitsPerBulk);
  const remainder = quantity % unitsPerBulk;
  const bulkUnit = product.bulkUnit || "bulk unit";
  const baseUnit = product.baseUnit || "base unit";

  return `${fullBulk} ${bulkUnit}(s) and ${remainder} ${baseUnit}(s)`;
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

function formatExpiryDate(value) {
  if (!value) {
    return "No expiry";
  }

  const parsed = parseExpiryDate(value);

  if (!parsed) {
    return value;
  }

  return parsed.toLocaleDateString();
}

window.renderReceiveStock = renderReceiveStock;
window.receiveStock = receiveStock;
window.updateReceiveStockPreview = updateReceiveStockPreview;
window.getCurrentDateTimeValue = getCurrentDateTimeValue;
