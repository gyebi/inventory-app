const app = document.getElementById("app");
const modal = document.getElementById("modal");
const modalBody = document.getElementById("modal-body");


function navigate(page) {
  if (page === "dashboard") renderDashboard();
  if (page === "addProduct") openAddProductModal();
  if (page === "sales") renderSales();
  if (page === "inventory") renderInventory();
}

function resetData() {
  localStorage.removeItem("inventoryState");
  location.reload();
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
