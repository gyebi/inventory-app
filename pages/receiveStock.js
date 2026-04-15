function renderReceiveStock(error = "") {
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
    (product, index) => `<option value="${index}">${product.name}</option>`
  ).join("");

  renderPage(`
    <div class="page-title">
      <h2>📥 Receive Stock</h2>
      <p>Add bulk units, loose base units, or both.</p>
    </div>

    ${error ? `<div class="message error">${error}</div>` : ""}

    <div class="form-column panel">
      <div class="form-row">
        <label for="stockProductIndex">Product</label>
        <select id="stockProductIndex">${options}</select>
      </div>

      <div class="form-row">
        <label for="bulkUnitsReceived">Bulk Units Received</label>
        <input id="bulkUnitsReceived" class="number-field" type="number" min="0" step="1">
      </div>

      <div class="form-row">
        <label for="baseUnitsReceived">Base Units Received</label>
        <input id="baseUnitsReceived" class="number-field" type="number" min="0" step="1">
      </div>

      <button onclick="receiveStock()">Receive Stock</button>
    </div>
  `);
}

function receiveStock() {
  const index = Number(document.getElementById("stockProductIndex").value);
  const bulkUnitsReceived = Number(document.getElementById("bulkUnitsReceived").value);
  const baseUnitsReceived = Number(document.getElementById("baseUnitsReceived").value);
  const product = state.products[index];

  if (!product) {
    renderReceiveStock("Choose a product before receiving stock.");
    return;
  }

  if (!Number.isInteger(bulkUnitsReceived) || bulkUnitsReceived < 0) {
    renderReceiveStock("Bulk units received must be a whole number of zero or more.");
    return;
  }

  if (!Number.isInteger(baseUnitsReceived) || baseUnitsReceived < 0) {
    renderReceiveStock("Base units received must be a whole number of zero or more.");
    return;
  }

  if (bulkUnitsReceived === 0 && baseUnitsReceived === 0) {
    renderReceiveStock("Enter bulk units received, base units received, or both.");
    return;
  }

  const quantityReceived = (bulkUnitsReceived * product.unitsPerBulk) + baseUnitsReceived;
  product.quantity += quantityReceived;

  saveState();

  renderPage(`
    <div class="message success">
      Stock received. Current stock is ${formatStock(product)}.
    </div>
  `);

  setTimeout(() => navigate("inventory"), 1000);
}
