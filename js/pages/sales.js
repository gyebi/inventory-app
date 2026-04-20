import { renderReceiptPage } from "../services/receiptService.js";
import { createSale } from "../services/salesService.js";

const { ensureStockState, renderPage, state } = window.app;
let saleCart = [];

function formatSaleStock(product) {
  return window.app.formatStock(product);
}

function getCartTotal() {
  return saleCart.reduce((sum, item) => {
    const product = state.products.find((candidate) => candidate.id === item.productId);
    const unitPrice = Number(product?.bulkSellingPrice ?? ((product?.sellingPrice || 0) * (product?.unitsPerBulk || 1)));

    return sum + (unitPrice * item.quantity);
  }, 0);
}

function renderCartItems() {
  if (saleCart.length === 0) {
    return `<div class="sale-cart-empty">No products added yet.</div>`;
  }

  return saleCart.map((item, index) => {
    const product = state.products.find((candidate) => candidate.id === item.productId);
    const unitPrice = Number(product?.bulkSellingPrice ?? ((product?.sellingPrice || 0) * (product?.unitsPerBulk || 1)));
    const itemTotal = unitPrice * item.quantity;

    return `
      <div class="sale-cart-row">
        <div>
          <strong>${product?.name || "Unknown product"}</strong>
          <small>${item.quantity} ${product?.bulkUnit || "bulk unit"}(s)</small>
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

  const options = state.products.map(
    (product) => `<option value="${product.id}">${product.name}</option>`
  ).join("");
  const selectedProduct = state.products[0];

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
        <small>Sold in ${selectedProduct.bulkUnit}(s)</small>
      </div>

      <div class="form-column">
        <div class="form-row">
          <label for="productIndex">Product</label>
          <select id="productIndex" onchange="updateSalePreview()">${options}</select>
        </div>

        <div class="form-row">
          <label for="qty">Quantity (${selectedProduct.bulkUnit})</label>
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
  const product = state.products.find((item) => item.id === productId);
  const summary = document.querySelector(".sale-summary");
  const quantityLabel = document.querySelector("label[for='qty']");

  if (!product || !summary || !quantityLabel) {
    return;
  }

  quantityLabel.textContent = `Quantity (${product.bulkUnit})`;

  summary.innerHTML = `
    <strong>Available Stock</strong>
    <span>${formatSaleStock(product)}</span>
    <small>Sold in ${product.bulkUnit}(s)</small>
  `;
}

function addSaleCartItem() {
  ensureStockState();

  const productId = document.getElementById("productIndex")?.value;
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

  const requestedBaseQuantity = quantity * Number(product.unitsPerBulk || 1);
  const existingCartItem = saleCart.find((item) => item.productId === productId);
  const existingBaseQuantity = existingCartItem
    ? existingCartItem.quantity * Number(product.unitsPerBulk || 1)
    : 0;

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
      unit: product.bulkUnit
    });
  }

  renderSales();
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
