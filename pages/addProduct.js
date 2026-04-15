function openAddProductModal() {
  openModal(
    `
    <h2>➕ Add Product</h2>

    <input id="name" placeholder="Product Name">

    <select id="category">
      <option>Water</option>
      <option>Soft Drink</option>
    </select>

    <input id="baseUnit" placeholder="Base Unit (e.g. Bottle, Sachet)">
    <input id="bulkUnit" placeholder="Bulk Unit (e.g. Crate, Carton, Pack)">
    <input id="unitsPerBulk" type="number" placeholder="How many base units in one bulk unit?">

    <input id="bulkQuantity" type="number" placeholder="How many bulk units in stock?">

    <input id="costPrice" type="number" placeholder="Cost Price per base unit">
    <input id="sellingPrice" type="number" placeholder="Selling Price per base unit">

    <button onclick="addProduct()">Add Product</button>
  `);
  
}

function addProduct() {
  const name = document.getElementById("name").value;
  const category = document.getElementById("category").value;
  const baseUnit = document.getElementById("baseUnit").value;
  const bulkUnit = document.getElementById("bulkUnit").value;
  const unitsPerBulk = Number(document.getElementById("unitsPerBulk").value);
  const bulkQuantity = Number(document.getElementById("bulkQuantity").value);
  const costPrice = Number(document.getElementById("costPrice").value);
  const sellingPrice = Number(document.getElementById("sellingPrice").value);

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

  closeModal();

  app.innerHTML = `<div class="card">✅ Product Added!</div>`;
  setTimeout(() => navigate("inventory"), 1000);
}

function formatStock(product) {
  const fullBulk = Math.floor(product.quantity / product.unitsPerBulk);
  const remainder = product.quantity % product.unitsPerBulk;

  return `${fullBulk} ${product.bulkUnit}(s) and ${remainder} ${product.baseUnit}(s)`;
}
