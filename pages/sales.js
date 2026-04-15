function renderSales(error = "") {
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

  let options = state.products.map(
    (p, i) => `<option value="${i}">${p.name}</option>`
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
          <label for="saleUnit">Sale Unit</label>
          <select id="saleUnit" onchange="updateSalePreview()">
            <option value="base">Base Unit</option>
            <option value="bulk">Bulk Unit</option>
          </select>
        </div>

        <div class="form-row">
          <label for="qty">Quantity</label>
          <input id="qty" class="number-field" type="number" min="1" step="1">
        </div>

        <button onclick="recordSale()">Complete Sale</button>
      </div>
    </div>
  `);
}

function updateSalePreview() {
  const index = Number(document.getElementById("productIndex").value);
  const product = state.products[index];
  const summary = document.querySelector(".sale-summary");

  if (!product || !summary) {
    return;
  }

  summary.innerHTML = `
    <strong>Available Stock</strong>
    <span>${formatStock(product)}</span>
    <small>${product.quantity} ${product.baseUnit}(s) in stock</small>
  `;
}

function recordSale() {
  const index = Number(document.getElementById("productIndex").value);
  const saleUnit = document.getElementById("saleUnit").value;
  const qty = Number(document.getElementById("qty").value);

  const product = state.products[index];

  if (!product) {
    renderSales("Choose a product before recording a sale.");
    return;
  }

  if (!Number.isInteger(qty) || qty <= 0) {
    renderSales("Quantity must be a whole number greater than zero.");
    return;
  }

  let actualQtySold = qty;
  let displayUnit = product.baseUnit;

  if (saleUnit === "bulk") {
    actualQtySold = qty * product.unitsPerBulk;
    displayUnit = product.bulkUnit;
  }

  if (actualQtySold > product.quantity) {
    renderSales(`Not enough stock available. Current stock is ${formatStock(product)}.`);
    return;
  }

  const profitPerUnit = product.sellingPrice - product.costPrice;
  const totalProfit = profitPerUnit * actualQtySold;
  const totalAmount = product.sellingPrice * actualQtySold;

  product.quantity -= actualQtySold;

  const sale = {
    product: product.name,
    qty,
    saleUnit: displayUnit,
    actualQtySold,
    sellingPrice: product.sellingPrice,
    totalAmount,
    totalProfit,
    date: new Date().toLocaleString()
  };

  state.sales.push(sale);
  saveState();

  renderReceipt(sale);
}

 function renderReceipt(sale) {
  renderPage(`
    <h2>🧾 Receipt</h2>

    <div class="card">
      <strong>Product:</strong> ${sale.product}<br>
      <strong>Quantity Sold:</strong> ${sale.qty} ${sale.saleUnit}(s)<br>
      <strong>Total Base Units:</strong> ${sale.actualQtySold}<br>
      <hr>
      <strong>Total Amount:</strong> ${sale.totalAmount}<br>
      <strong>Profit:</strong> ${sale.totalProfit}<br>
      <hr>
      <small>${sale.date}</small>
    </div>

    <button onclick="navigate('dashboard')">Back to Dashboard</button>
    <button onclick="printReceipt()">🖨 Print</button>
  `);
}
