const app = document.getElementById("app");
const modal = document.getElementById("modal");
const modalBody = document.getElementById("modal-body");

const menuItems = [
  { page: "addProduct", icon: "➕", title: "Add Product", text: "Create product details" },
  { page: "receiveStock", icon: "📥", title: "Receive Stock", text: "Add supplier deliveries" },
  { page: "sales", icon: "💰", title: "Record Sale", text: "Sell bulk or base units" },
  { page: "inventory", icon: "📦", title: "Inventory", text: "Check current stock" },
  { page: "suppliers", icon: "👥", title: "Suppliers", text: "Save supplier contacts" },
  { page: "dashboard", icon: "📊", title: "Dashboard", text: "View business summary" },
  { page: "help", icon: "❔", title: "Help", text: "Learn how to use the app" }
];

function navigate(page) {
  if (page === "login") {
    renderLogin();
    return;
  }

  if (!isLoggedIn() && page !== "login") {
    renderLogin();
    return;
  }

  renderShell();

  if (page === "home") renderHome();
  if (page === "dashboard") renderDashboard();
  if (page === "addProduct") renderAddProduct();
  if (page === "receiveStock") renderReceiveStock();
  if (page === "suppliers") renderSuppliers();
  if (page === "sales") renderSales();
  if (page === "inventory") renderInventory();
  if (page === "help") renderHelp();
}

function isLoggedIn() {
  return localStorage.getItem("inventoryLoggedIn") === "true";
}

function renderLogin(error = "") {
  app.innerHTML = `
    <section class="login-page">
      <div class="login-panel">
        <h1>Chakem Trading Enterprise</h1>
        <h2>Login</h2>

        ${error ? `<div class="message error">${error}</div>` : ""}

        <div class="form-column">
          <div class="form-row">
            <label for="username">Username</label>
            <input id="username">
          </div>

          <div class="form-row">
            <label for="password">Password</label>
            <input id="password" type="password">
          </div>

          <button onclick="login()">Login</button>
        </div>
      </div>
    </section>
  `;
}

function login() {
  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value.trim();

  if (!username || !password) {
    renderLogin("Enter username and password.");
    return;
  }

  localStorage.setItem("inventoryLoggedIn", "true");
  navigate("home");
}

function logout() {
  localStorage.removeItem("inventoryLoggedIn");
  renderLogin();
}

function renderShell() {
  app.innerHTML = `
    <header class="app-header">
      <div>
        <h1>Chakem Trading Enterprise</h1>
        <p>Keeping refreshing drinks moving.</p>
      </div>
      <div class="header-actions">
        <button onclick="navigate('home')">Menu</button>
        <button onclick="logout()">Logout</button>
      </div>
    </header>

    <main id="page"></main>
  `;
}

function renderHome() {
  const page = document.getElementById("page");
  const cards = menuItems.map((item) => `
    <button class="menu-card" onclick="navigate('${item.page}')">
      <span class="menu-icon">${item.icon}</span>
      <strong>${item.title}</strong>
      <small>${item.text}</small>
    </button>
  `).join("");

  page.innerHTML = `
    <section class="page-section home-section">
      <div class="page-title">
        <h2>Menu</h2>
        <p>Choose what you want to do next.</p>
      </div>
      <div class="menu-grid">${cards}</div>
    </section>
  `;
}

function renderPage(content) {
  const page = document.getElementById("page");
  const wrappedContent = `<section class="page-section">${content}</section>`;

  if (page) {
    page.innerHTML = wrappedContent;
  } else {
    app.innerHTML = wrappedContent;
  }
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

if (isLoggedIn()) {
  navigate("home");
} else {
  renderLogin();
}
