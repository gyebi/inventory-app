const savedState = JSON.parse(localStorage.getItem("inventoryState"));

const state = savedState || {
  products: [],
  sales: [],
  suppliers: [],
  stockReceipts: []
};

if (!state.suppliers) {
  state.suppliers = [];
}

if (!state.stockReceipts) {
  state.stockReceipts = [];
}

function saveState() {
  localStorage.setItem("inventoryState", JSON.stringify(state));
}
