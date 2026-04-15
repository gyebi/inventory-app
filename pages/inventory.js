function renderInventory() {
  if (state.products.length === 0) {
    app.innerHTML = `<div class="card">No products yet.</div>`;
    return;
  }

  let html = "<h2>📦 Inventory</h2>";

  state.products.forEach((p) => {
    html += `
      <div class="card">
        <strong>${p.name}</strong><br>
        Category: ${p.category}<br>
        Stock: ${p.quantity} ${p.baseUnit}(s)<br>
        Equivalent: ${formatStock(p)}<br>
        Cost Price: ${p.costPrice}<br>
        Selling Price: ${p.sellingPrice}
      </div>
    `;
  });

  app.innerHTML = html;
}