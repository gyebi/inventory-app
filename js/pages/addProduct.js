import { saveProductToCloud } from "../services/cloudProductService.js";
import { createAppError, ERROR_FLAGS, logAppError, toUserMessage } from "../utils/errorUtils.js";

const CLOUD_SAVE_TIMEOUT_MS = 20000;

const { state, renderPage, saveState, navigate } = window.app;

function getCategoryOptions() {
  const categories = Array.isArray(state.settings?.categories) && state.settings.categories.length > 0
    ? state.settings.categories
    : ["Water", "Soft Drink", "Juice", "Energy Drink", "Tissues"];

  return categories;
}

function renderAddProduct(error = "") {
  const categoryOptions = getCategoryOptions();
  const canEditCategory = state.user?.role === "admin";

  renderPage(`
    <div class="page-title">
      <h2>➕ Add Product</h2>
      <p>Create the product record first. Use Receive Stock when suppliers deliver goods.</p>
    </div>

    ${error ? `<div class="message error">${error}</div>` : ""}

    <div class="form-column panel">
      <div class="form-row">
        <label for="name">Product Name</label>
        <input id="name">
      </div>

      <div class="form-row">
        <label for="category">Category</label>
        <input
          id="category"
          list="category-list"
          placeholder="${canEditCategory ? "Select or type a category" : "Category is read only"}"
          ${canEditCategory ? "" : "readonly"}
        >
        ${canEditCategory ? "" : `<small class="field-hint">Only admin can edit the category field.</small>`}
        <datalist id="category-list">
          ${categoryOptions.map((category) => `<option value="${escapeHtml(category)}"></option>`).join("")}
        </datalist>
      </div>

      <div class="form-row">
        <label for="baseUnit">Base Unit e.g. Bottle, Sachet</label>
        <input id="baseUnit" placeholder="Type a base unit">
      </div>

      <div class="form-row">
        <label for="bulkUnit">Bulk Unit e.g. Crate, Carton</label>
        <input id="bulkUnit" placeholder="Type a bulk unit">
      </div>

      <div class="form-row">
        <label for="unitsPerBulk">Base Units in Bulk Unit</label>
        <input id="unitsPerBulk" class="number-field" type="number" min="1" step="1">
      </div>

      <div class="form-row">
        <label for="lowStockThreshold">Reorder Level in Base Units</label>
        <input id="lowStockThreshold" class="number-field" type="number" min="0" step="1" value="10">
      </div>

      <div class="form-row">
        <label for="costPrice">Cost Price Per Base Unit</label>
        <input id="costPrice" class="number-field" type="number" min="0" step="0.01">
      </div>

      <div class="form-row">
        <label for="sellingPrice">Selling Price Per Base Unit</label>
        <input id="sellingPrice" class="number-field" type="number" min="0.01" step="0.01">
      </div>

      <div class="form-row">
        <label for="bulkCostPrice">Cost Price Per Bulk Unit</label>
        <input id="bulkCostPrice" class="number-field" type="number" min="0" step="0.01">
      </div>

      <div class="form-row">
        <label for="bulkSellingPrice">Selling Price Per Bulk Unit</label>
        <input id="bulkSellingPrice" class="number-field" type="number" min="0.01" step="0.01">
      </div>

      <button id="addProductButton" onclick="addProduct()">Add Product</button>
    </div>
  `);
}

function createNewProductId() {
  return `prod_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
}

function setAddProductProcessing(isProcessing) {
  const button = document.getElementById("addProductButton");

  if (!button) {
    return;
  }

  button.disabled = isProcessing;
  button.innerHTML = isProcessing
    ? `<span class="button-spinner" aria-hidden="true"></span>Saving product...`
    : "Add Product";
}

function renderProductSaved(product) {
  renderPage(`
    <div class="page-title">
      <h2>Product Saved</h2>
      <p>${product.name} is now available for stock receiving and sales setup.</p>
    </div>

    <div class="message success">Product record saved successfully.</div>

    <div class="form-column panel">
      <button onclick="renderAddProduct()">Add Another Product</button>
      <button onclick="navigate('home')">Main Menu</button>
    </div>
  `);
}

async function addProduct() {
  const name = document.getElementById("name").value.trim();
  const category = document.getElementById("category").value;
  const baseUnit = document.getElementById("baseUnit").value.trim();
  const bulkUnit = document.getElementById("bulkUnit").value.trim();
  const unitsPerBulk = Number(document.getElementById("unitsPerBulk").value);
  const lowStockThreshold = Number(document.getElementById("lowStockThreshold").value);
  const costPrice = Number(document.getElementById("costPrice").value);
  const sellingPrice = Number(document.getElementById("sellingPrice").value);
  const bulkCostPrice = Number(document.getElementById("bulkCostPrice").value);
  const bulkSellingPrice = Number(document.getElementById("bulkSellingPrice").value);
  const duplicateProduct = state.products.some(
    (product) => product.name.toLowerCase() === name.toLowerCase()
  );

  if (!name) {
    renderAddProduct("Enter the product name before saving.");
    return;
  }

  if (duplicateProduct) {
    renderAddProduct("A product with this name already exists.");
    return;
  }

  if (!baseUnit) {
    renderAddProduct("Choose the base unit used for single-item stock counts.");
    return;
  }

  if (!bulkUnit) {
    renderAddProduct("Choose the bulk unit used when receiving grouped stock.");
    return;
  }

  if (!Number.isInteger(unitsPerBulk) || unitsPerBulk <= 0) {
    renderAddProduct("Units per bulk must be a whole number greater than zero.");
    return;
  }

  if (!Number.isInteger(lowStockThreshold) || lowStockThreshold < 0) {
    renderAddProduct("Reorder level must be a whole number of base units.");
    return;
  }

  if (!Number.isFinite(costPrice) || costPrice < 0) {
    renderAddProduct("Cost price must be zero or more.");
    return;
  }

  if (!Number.isFinite(sellingPrice) || sellingPrice <= 0) {
    renderAddProduct("Selling price must be greater than zero.");
    return;
  }

  if (!Number.isFinite(bulkCostPrice) || bulkCostPrice < 0) {
    renderAddProduct("Bulk cost price must be zero or more.");
    return;
  }

  if (!Number.isFinite(bulkSellingPrice) || bulkSellingPrice <= 0) {
    renderAddProduct("Bulk selling price must be greater than zero.");
    return;
  }

  if (sellingPrice < costPrice) {
    renderAddProduct("Selling price should not be less than cost price.");
    return;
  }

  if (bulkSellingPrice < bulkCostPrice) {
    renderAddProduct("Bulk selling price should not be less than bulk cost price.");
    return;
  }

  const product = {
    id: createNewProductId(),
    name,
    category,
    baseUnit,
    bulkUnit,
    unitsPerBulk,
    lowStockThreshold,
    quantity: 0,
    costPrice,
    sellingPrice,
    bulkCostPrice,
    bulkSellingPrice
  };

  try {
    setAddProductProcessing(true);
    await withTimeout(
      saveProductToCloud(product),
      CLOUD_SAVE_TIMEOUT_MS,
      "Firestore is taking too long to create this product. Check your internet connection, Firebase config, and Firestore rules before trying again."
    );
  } catch (error) {
    setAddProductProcessing(false);
    logAppError("Product save failed", error);
    renderAddProduct(toUserMessage(error, "Unable to save product to Firestore. Check your connection and try again."));
    return;
  }

  if (!state.products.some((item) => item.id === product.id)) {
    state.products.push(product);
    saveState();
  }

  renderProductSaved(product);
}

function formatStock(product) {
  const fullBulk = Math.floor(product.quantity / product.unitsPerBulk);
  const remainder = product.quantity % product.unitsPerBulk;

  return `${fullBulk} ${product.bulkUnit}(s) and ${remainder} ${product.baseUnit}(s)`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

window.renderAddProduct = renderAddProduct;
window.addProduct = addProduct;
window.formatStock = formatStock;
