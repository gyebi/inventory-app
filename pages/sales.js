function renderSales(error = "") {
  if (state.products.length === 0) {
    app.innerHTML = `
      <h2>💰 Record Sale</h2>
      <div class="message error">Add a product before recording a sale.</div>
      <button onclick="navigate('addProduct')">Add Product</button>
    `;
    return;
  }

  let options = state.products.map(
    (p, i) => `<option value="${i}">${p.name}</option>`
  ).join("");

  app.innerHTML = `
    <h2>💰 Record Sale</h2>

    ${error ? `<div class="message error">${error}</div>` : ""}

    <select id="productIndex">${options}</select>

    <select id="saleUnit">
      <option value="base">Base Unit</option>
      <option value="bulk">Bulk Unit</option>
    </select>

    <input id="qty" type="number" min="1" step="1" placeholder="Quantity">

    <button onclick="recordSale()">Sell</button>
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
  app.innerHTML = `
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
  `;
}
