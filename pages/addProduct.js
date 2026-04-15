function renderAddProduct(error = "") {
  app.innerHTML = `
    <h2>➕ Add Product</h2>

    ${error ? `<div class="message error">${error}</div>` : ""}

    <div class="form-column">
      <label for="name">Product Name</label>
      <input id="name">

      <label for="category">Category</label>
      <select id="category">
        <option>Water</option>
        <option>Soft Drink</option>
        <option>Juice</option>
        <option>Energy Drink</option>
      </select>

      <label for="baseUnit">Base Unit</label>
      <select id="baseUnit">
        <option>Bottle</option>
        <option>Sachet</option>
        <option>Can</option>
        <option>Piece</option>
      </select>

      <label for="bulkUnit">Bulk Unit</label>
      <select id="bulkUnit">
        <option>Crate</option>
        <option>Carton</option>
        <option>Pack</option>
        <option>Bag</option>
      </select>

      <label for="unitsPerBulk">Base Units Per Bulk Unit</label>
      <input id="unitsPerBulk" type="number" min="1" step="1">

      <label for="bulkQuantity">Bulk Units In Stock</label>
      <input id="bulkQuantity" type="number" min="0" step="1">

      <label for="costPrice">Cost Price Per Base Unit</label>
      <input id="costPrice" type="number" min="0" step="0.01">

      <label for="sellingPrice">Selling Price Per Base Unit</label>
      <input id="sellingPrice" type="number" min="0.01" step="0.01">

      <button onclick="addProduct()">Add Product</button>
    </div>
  `;
}

function addProduct() {
  const name = document.getElementById("name").value.trim();
  const category = document.getElementById("category").value;
  const baseUnit = document.getElementById("baseUnit").value.trim();
  const bulkUnit = document.getElementById("bulkUnit").value.trim();
  const unitsPerBulk = Number(document.getElementById("unitsPerBulk").value);
  const bulkQuantity = Number(document.getElementById("bulkQuantity").value);
  const costPrice = Number(document.getElementById("costPrice").value);
  const sellingPrice = Number(document.getElementById("sellingPrice").value);
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

  if (!Number.isInteger(bulkQuantity) || bulkQuantity < 0) {
    renderAddProduct("Bulk quantity must be a whole number of zero or more.");
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

  if (sellingPrice < costPrice) {
    renderAddProduct("Selling price should not be less than cost price.");
    return;
  }

  const quantity = bulkQuantity * unitsPerBulk;

  state.products.push({
    name,
    category,
    baseUnit,
    bulkUnit,
    unitsPerBulk,
    quantity,
    costPrice,
    sellingPrice
  });

  saveState();

  app.innerHTML = `<div class="message success">Product added.</div>`;
  setTimeout(() => navigate("inventory"), 1000);
}

function formatStock(product) {
  const fullBulk = Math.floor(product.quantity / product.unitsPerBulk);
  const remainder = product.quantity % product.unitsPerBulk;

  return `${fullBulk} ${product.bulkUnit}(s) and ${remainder} ${product.baseUnit}(s)`;
}
