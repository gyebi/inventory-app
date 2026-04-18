const { state, renderPage, saveState, navigate } = window.app;

function renderAddProduct(error = "") {
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
        <select id="category">
          <option>Water</option>
          <option>Soft Drink</option>
          <option>Juice</option>
          <option>Energy Drink</option>
        </select>
      </div>

      <div class="form-row">
        <label for="baseUnit">Base Unit e.g. Bottle, Sachet</label>
        <select id="baseUnit">
          <option>Bottle</option>
          <option>Sachet</option>
          <option>Can</option>
          <option>Piece</option>
        </select>
      </div>

      <div class="form-row">
        <label for="bulkUnit">Bulk Unit e.g. Crate, Carton</label>
        <select id="bulkUnit">
          <option>Crate</option>
          <option>Carton</option>
          <option>Pack</option>
          <option>Bag</option>
        </select>
      </div>

      <div class="form-row">
        <label for="unitsPerBulk">How many Base Units in Bulk Unit</label>
        <input id="unitsPerBulk" class="number-field" type="number" min="1" step="1">
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

      <button onclick="addProduct()">Add Product</button>
    </div>
  `);
}

function createNewProductId() {
  return `prod_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
}

function addProduct() {
  const name = document.getElementById("name").value.trim();
  const category = document.getElementById("category").value;
  const baseUnit = document.getElementById("baseUnit").value.trim();
  const bulkUnit = document.getElementById("bulkUnit").value.trim();
  const unitsPerBulk = Number(document.getElementById("unitsPerBulk").value);
  const costPrice = Number(document.getElementById("costPrice").value);
  const sellingPrice = Number(document.getElementById("sellingPrice").value);
  const bulkCostPrice = Number(document.getElementById("bulkCostPrice").value);
  const bulkSellingPrice = Number(document.getElementById("bulkSellingPrice").value);
  const duplicateProduct = state.products.some(
    (product) => product.name.toLowerCase() === name.toLowerCase()
  );

  if (!name) {
    renderAddProduct("Product name is required.");
    return;
  }

  if (duplicateProduct) {
    renderAddProduct("A product with this name already exists.");
    return;
  }

  if (!baseUnit) {
    renderAddProduct("Base unit is required.");
    return;
  }

  if (!bulkUnit) {
    renderAddProduct("Bulk unit is required.");
    return;
  }

  if (!Number.isInteger(unitsPerBulk) || unitsPerBulk <= 0) {
    renderAddProduct("Units per bulk must be a whole number greater than zero.");
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

  state.products.push({
    id: createNewProductId(),
    name,
    category,
    baseUnit,
    bulkUnit,
    unitsPerBulk,
    quantity: 0,
    costPrice,
    sellingPrice,
    bulkCostPrice,
    bulkSellingPrice
  });

  saveState();

  renderPage(`<div class="message success">Product added. Use Receive Stock to add supplier deliveries.</div>`);
  setTimeout(() => navigate("inventory"), 1000);
}

function formatStock(product) {
  const fullBulk = Math.floor(product.quantity / product.unitsPerBulk);
  const remainder = product.quantity % product.unitsPerBulk;

  return `${fullBulk} ${product.bulkUnit}(s) and ${remainder} ${product.baseUnit}(s)`;
}

window.renderAddProduct = renderAddProduct;
window.addProduct = addProduct;
window.formatStock = formatStock;
