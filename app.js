const app = document.getElementById("app");
const modal = document.getElementById("modal");
const modalBody = document.getElementById("modal-body");


function navigate(page) {
  if (page === "dashboard") renderDashboard();
  if (page === "addProduct") renderAddProduct();
  if (page === "sales") renderSales();
  if (page === "inventory") renderInventory();
}

function resetData() {
  localStorage.removeItem("inventoryState");
  location.reload();
}

function renderReceipt(sale) {
  app.innerHTML = `
    <h2> Carl Kris Drinks </h2>

    <div class="card">
      <strong>Product:</strong> ${sale.product}<br>
      <strong>Quantity:</strong> ${sale.qty}<br>
      <strong>Unit Price:</strong> ${sale.sellingPrice}<br>
      <hr>
      <strong>Total Amount:</strong> ${sale.totalAmount}<br>
      <strong>Profit:</strong> ${sale.totalProfit}<br>
      <hr>
      <small>${sale.date}</small>
    </div>

    <br>

    <button onclick="navigate('dashboard')">Back to Dashboard</button>
    <button onclick="printReceipt()">🖨 Print</button>
  `;
}

function printReceipt() {
  window.print();
}


function openModal(content) {
  modalBody.innerHTML = content;
  modal.classList.remove("hidden");
}

function closeModal() {
  modal.classList.add("hidden");
}