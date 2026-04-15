const savedState = JSON.parse(localStorage.getItem("inventoryState"));

const state = savedState || {
  products: [],
  sales: []
};

function saveState() {
  localStorage.setItem("inventoryState", JSON.stringify(state));
}