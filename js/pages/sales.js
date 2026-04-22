import { renderReceiptPage } from "../services/receiptService.js";
import { createSale } from "../services/salesService.js";

const { ensureStockState, renderPage, state } = window.app;
let saleCart = [];
let selectedProductId = "";
let selectedSaleUnit = "bulk";

function formatSaleStock(product) {
  return window.app.formatStock(product);
}

function getCommittedBaseQuantity(product) {
  return Number(product?.quantity || 0);
}

function getProductUnitLabel(product, saleUnit = "bulk") {
  if (!product) {
    return saleUnit;
  }

  return saleUnit === "base"
    ? (product.baseUnit || "base unit")
    : (product.bulkUnit || "bulk unit");
}

function getSaleUnitPrice(product, saleUnit = "bulk") {
  if (!product) {
    return 0;
  }

  if (saleUnit === "base") {
    return Number(product.sellingPrice || 0);
  }

  return Number(product.bulkSellingPrice ?? ((product.sellingPrice || 0) * (product.unitsPerBulk || 1)));
}

function toBaseQuantity(product, quantity, saleUnit = "bulk") {
  if (!product) {
    return 0;
  }

  return saleUnit === "base"
    ? quantity
    : quantity * Number(product.unitsPerBulk || 1);
}

function getCartProductBaseQuantity(product) {
  if (!product) {
    return 0;
  }

  return saleCart
    .filter((item) => item.productId === product.id)
    .reduce((sum, item) => sum + toBaseQuantity(product, item.quantity, item.saleUnit), 0);
}

function formatBaseQuantity(product, quantity) {
  const unitLabel = product?.baseUnit || "base unit";
  return `${quantity} ${unitLabel}(s)`;
}

function getSaleAvailabilitySummary(product, saleUnit = "bulk") {
  if (!product) {
    return {
      committedBaseQuantity: 0,
      reservedBaseQuantity: 0,
      availableBaseQuantity: 0,
      unitLabel: saleUnit,
      unitPrice: 0
    };
  }

  const committedBaseQuantity = getCommittedBaseQuantity(product);
  const reservedBaseQuantity = getCartProductBaseQuantity(product);
  const availableBaseQuantity = Math.max(committedBaseQuantity - reservedBaseQuantity, 0);

  return {
    committedBaseQuantity,
    reservedBaseQuantity,
    availableBaseQuantity,
    unitLabel: getProductUnitLabel(product, saleUnit),
    unitPrice: getSaleUnitPrice(product, saleUnit)
  };
}

function getCartTotal() {
  return saleCart.reduce((sum, item) => {
    const product = state.products.find((candidate) => candidate.id === item.productId);
    const unitPrice = getSaleUnitPrice(product, item.saleUnit);

    return sum + (unitPrice * item.quantity);
  }, 0);
}

function renderCartItems() {
  if (saleCart.length === 0) {
    return `<div class="sale-cart-empty">No products added yet.</div>`;
  }

  return saleCart.map((item, index) => {
    const product = state.products.find((candidate) => candidate.id === item.productId);
    const unitLabel = getProductUnitLabel(product, item.saleUnit);
    const unitPrice = getSaleUnitPrice(product, item.saleUnit);
    const itemTotal = unitPrice * item.quantity;

    return `
      <div class="sale-cart-row">
        <div>
          <strong>${product?.name || "Unknown product"}</strong>
          <small>${item.quantity} ${unitLabel}(s)</small>
        </div>
        <div>
          <span>${window.app.formatReceiptCurrency(itemTotal)}</span>
          <button type="button" onclick="removeSaleCartItem(${index})">Remove</button>
        </div>
      </div>
    `;
  }).join("");
}

function renderSales(error = "") {
  ensureStockState();

  if (state.products.length === 0) {
    renderPage(`
      <div class="page-title">
        <h2>💰 Record Sale</h2>
        <p>Sell from existing stock after products have been received.</p>
      </div>
      <div class="message error">Add a product before recording a sale.</div>
      <button onclick="navigate('addProduct')">Add Product</button>
    `);
    return;
  }

  if (!selectedProductId || !state.products.some((product) => product.id === selectedProductId)) {
    selectedProductId = state.products[0]?.id || "";
  }

  const selectedProduct = state.products.find((product) => product.id === selectedProductId) || state.products[0];
  if (!selectedProduct) {
    return;
  }

  const options = state.products.map(
    (product) => `<option value="${product.id}" ${product.id === selectedProduct.id ? "selected" : ""}>${product.name}</option>`
  ).join("");
  const baseUnitLabel = selectedProduct.baseUnit || "base unit";
  const bulkUnitLabel = selectedProduct.bulkUnit || "bulk unit";
  const {
    availableBaseQuantity,
    unitLabel: quantityUnitLabel
  } = getSaleAvailabilitySummary(selectedProduct, selectedSaleUnit);

  renderPage(`
    <div class="page-title">
      <h2>💰 Record Sale</h2>
      <p>Choose a product, unit type, and quantity to complete a sale.</p>
    </div>

    ${error ? `<div class="message error">${error}</div>` : ""}

    <div class="sale-panel">
      <div class="sale-summary">
        <strong>Available Stock</strong>
        <span>${formatSaleStock(selectedProduct)}</span>
        <small>Available for next sale: ${formatBaseQuantity(selectedProduct, availableBaseQuantity)}</small>
      </div>

      <div class="form-column">
        <div class="form-row">
          <label for="productIndex">Product</label>
          <select id="productIndex" onchange="updateSalePreview()">${options}</select>
        </div>

        <div class="form-row">
          <label for="saleUnit">Unit Type</label>
          <select id="saleUnit" onchange="updateSalePreview()">
            <option value="bulk" ${selectedSaleUnit === "bulk" ? "selected" : ""}>Bulk Unit (${bulkUnitLabel})</option>
            <option value="base" ${selectedSaleUnit === "base" ? "selected" : ""}>Base Unit (${baseUnitLabel})</option>
          </select>
        </div>

        <div class="form-row">
          <label for="qty">Quantity (${quantityUnitLabel})</label>
          <input id="qty" class="number-field" type="number" min="1" step="1">
        </div>

        <button type="button" onclick="addSaleCartItem()">Add Product</button>
      </div>

      <div class="sale-cart">
        <div class="sale-cart-header">
          <strong>Sale Items</strong>
          <span>${window.app.formatReceiptCurrency(getCartTotal())}</span>
        </div>
        <div class="sale-cart-list">
          ${renderCartItems()}
        </div>
        <button id="completeSaleButton" onclick="recordSale()">Complete Sale</button>
      </div>
    </div>
  `);
}

function setSaleProcessing(isProcessing) {
  const button = document.getElementById("completeSaleButton");

  if (!button) {
    return;
  }

  button.disabled = isProcessing;
  button.innerHTML = isProcessing
    ? `<span class="button-spinner" aria-hidden="true"></span>Processing sale...`
    : "Complete Sale";
}

function updateSalePreview() {
  const productId = document.getElementById("productIndex")?.value;
  const saleUnit = document.getElementById("saleUnit")?.value || selectedSaleUnit;
  const product = state.products.find((item) => item.id === productId);
  const summary = document.querySelector(".sale-summary");
  const quantityLabel = document.querySelector("label[for='qty']");
  const unitSelect = document.getElementById("saleUnit");

  if (!product || !summary || !quantityLabel || !unitSelect) {
    return;
  }

  selectedProductId = product.id;
  selectedSaleUnit = saleUnit;
  const {
    availableBaseQuantity,
    unitLabel
  } = getSaleAvailabilitySummary(product, saleUnit);
  quantityLabel.textContent = `Quantity (${getProductUnitLabel(product, saleUnit)})`;
  unitSelect.innerHTML = `
    <option value="bulk" ${saleUnit === "bulk" ? "selected" : ""}>Bulk Unit (${product.bulkUnit || "bulk unit"})</option>
    <option value="base" ${saleUnit === "base" ? "selected" : ""}>Base Unit (${product.baseUnit || "base unit"})</option>
  `;

  summary.innerHTML = `
    <strong>Available Stock</strong>
    <span>${formatSaleStock(product)}</span>
    <small>Available for next sale: ${formatBaseQuantity(product, availableBaseQuantity)}</small>
  `;
}

function addSaleCartItem() {
  ensureStockState();

  const productId = document.getElementById("productIndex")?.value;
  const saleUnit = document.getElementById("saleUnit")?.value || "bulk";
  const quantity = Number(document.getElementById("qty")?.value);
  const product = state.products.find((item) => item.id === productId);

  if (!product) {
    renderSales("Choose a product before adding it to the sale.");
    return;
  }

  if (!Number.isInteger(quantity) || quantity <= 0) {
    renderSales("Quantity must be a whole number greater than zero.");
    return;
  }

  selectedProductId = productId;
  selectedSaleUnit = saleUnit;

  const requestedBaseQuantity = toBaseQuantity(product, quantity, saleUnit);
  const existingCartItem = saleCart.find((item) => item.productId === productId && item.saleUnit === saleUnit);
  const existingBaseQuantity = getCartProductBaseQuantity(product);

  if (requestedBaseQuantity + existingBaseQuantity > Number(product.quantity || 0)) {
    renderSales(`Not enough stock available for ${product.name}.`);
    return;
  }

  if (existingCartItem) {
    existingCartItem.quantity += quantity;
  } else {
    saleCart.push({
      productId,
      quantity,
      unit: getProductUnitLabel(product, saleUnit),
      saleUnit
    });
  }

  renderSales();

  const quantityInput = document.getElementById("qty");
  if (quantityInput) {
    quantityInput.value = "";
  }
}

function removeSaleCartItem(index) {
  saleCart.splice(index, 1);
  renderSales();
}

async function recordSale() {
  ensureStockState();

  if (saleCart.length === 0) {
    renderSales("Add at least one product before completing the sale.");
    return;
  }

  try {
    setSaleProcessing(true);
    const sale = await createSale(saleCart);

    window.app.saveState();
    saleCart = [];
    renderReceiptPage(sale);
  } catch (error) {
    setSaleProcessing(false);
    renderSales(error.message || "Unable to complete the sale.");
  }
}

window.renderSales = renderSales;
window.updateSalePreview = updateSalePreview;
window.addSaleCartItem = addSaleCartItem;
window.removeSaleCartItem = removeSaleCartItem;
window.recordSale = recordSale;
