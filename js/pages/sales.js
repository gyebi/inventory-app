import { renderReceiptPage } from "../services/receiptService.js";
import { createSale } from "../services/salesService.js";

const { ensureStockState, renderPage, state, formatStock } = window.app;

function getUnitOptions(product) {
  if (!product) {
    return "";
  }

  return `
    <option value="${product.baseUnit}">${product.baseUnit}</option>
    <option value="${product.bulkUnit}">${product.bulkUnit}</option>
  `;
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
        <span>${formatStock(selectedProduct)}</span>
        <small>${selectedProduct.quantity} ${selectedProduct.baseUnit}(s) in stock</small>
      </div>

      <div class="form-column">
        <div class="form-row">
          <label for="productIndex">Product</label>
          <select id="productIndex" onchange="updateSalePreview()">${options}</select>
        </div>

        <div class="form-row">
          <label for="unitSelect">Sale Unit</label>
          <select id="unitSelect" onchange="updateSalePreview()">
            ${getUnitOptions(selectedProduct)}
          </select>
        </div>

        <div class="form-row">
          <label for="qty">Quantity</label>
          <input id="qty" class="number-field" type="number" min="1" step="1">
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
  button.textContent = isProcessing ? "Processing Sale..." : "Complete Sale";
}

function updateSalePreview() {
  const productId = document.getElementById("productIndex")?.value;
  const product = state.products.find((item) => item.id === productId);
  const summary = document.querySelector(".sale-summary");
  const unitSelect = document.getElementById("unitSelect");

  if (!product || !summary || !unitSelect) {
    return;
  }

  unitSelect.innerHTML = getUnitOptions(product);

  summary.innerHTML = `
    <strong>Available Stock</strong>
    <span>${formatStock(product)}</span>
    <small>${product.quantity} ${product.baseUnit}(s) in stock</small>
  `;
}

async function recordSale() {
  ensureStockState();

  const productId = document.getElementById("productIndex")?.value;
  const unit = document.getElementById("unitSelect")?.value;
  const quantity = Number(document.getElementById("qty")?.value);
  const product = state.products.find((item) => item.id === productId);

  if (!product) {
    renderSales("Choose a product before recording a sale.");
    return;
  }

  if (!Number.isInteger(quantity) || quantity <= 0) {
    renderSales("Quantity must be a whole number greater than zero.");
    return;
  }

  try {
    setSaleProcessing(true);
    const sale = await createSale([
      {
        productId,
        quantity,
        unit
      }
    ]);

    window.app.saveState();
    renderReceiptPage(sale);
  } catch (error) {
    setSaleProcessing(false);
    renderSales(error.message || "Unable to complete the sale.");
  }
}

window.renderSales = renderSales;
window.updateSalePreview = updateSalePreview;
window.recordSale = recordSale;
