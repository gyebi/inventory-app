import { setState as setSharedState } from "./state.js";
import { hasPermission } from "./services/authService.js";
import {
  fetchProductsFromCloud,
  fetchSalesFromCloud,
  fetchStockReceiptsFromCloud
} from "./services/cloudProductService.js";
import {
  listenToProducts,
  listenToSales,
  listenToStockReceipts
} from "./services/productListenerService.js";
import { migrateLocalProductsToCloudOnce } from "./services/productMigrationService.js";
import { ensureSalesSyncMetadata, retryPendingSalesSync } from "./services/syncService.js";
import { getPagePermission } from "./utils/pagePermissions.js";

const app = document.getElementById("app");
const modal = document.getElementById("modal");
const modalBody = document.getElementById("modal-body");
const STORAGE_KEY = "inventory_app";

const defaultUsers = [
  { username: "admin", password: "1234", role: "admin" },
  { username: "sales", password: "1234", role: "sales" },
  { username: "store", password: "1234", role: "storekeeper" }
];

const defaultState = {
  user: null,
  users: defaultUsers,
  products: [],
  stock: [],
  sales: [],
  suppliers: [],
  stockReceipts: [],
  settings: {
    lowStockThreshold: 10,
    salesSyncEndpoint: null,
    salesSyncIntervalMs: 30000,
    useCloudProducts: true
  }
};

let state = loadAppState();
setSharedState(state);
let stopProductsListener = null;
let stopStockReceiptsListener = null;
let stopSalesListener = null;

function loadAppState() {
  const savedState = localStorage.getItem(STORAGE_KEY);

  if (!savedState) {
    return structuredClone(defaultState);
  }

  try {
    const parsedState = JSON.parse(savedState);

    return {
      ...structuredClone(defaultState),
      ...parsedState,
      users: Array.isArray(parsedState.users) && parsedState.users.length > 0
        ? parsedState.users
        : structuredClone(defaultUsers)
    };
  } catch (error) {
    return structuredClone(defaultState);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  setSharedState(state);
}

function replaceProducts(products = []) {
  state.products = products.map((product) => ({
    quantity: 0,
    ...product
  }));
  saveState();
}

function rebuildStockFromCloudReceipts() {
  const soldByBatch = new Map();

  state.sales.forEach((sale) => {
    (sale.items || []).forEach((item) => {
      (item.batchAllocations || []).forEach((allocation) => {
        soldByBatch.set(
          allocation.batchId,
          (soldByBatch.get(allocation.batchId) || 0) + Number(allocation.quantity || 0)
        );
      });
    });
  });

  state.stock = state.stockReceipts.map((receipt) => {
    const originalQuantity = Number(receipt.quantityReceived || 0);
    const soldQuantity = soldByBatch.get(receipt.batchId) || 0;

    return {
      id: receipt.batchId,
      productId: receipt.productId,
      productName: receipt.product,
      quantity: Math.max(originalQuantity - soldQuantity, 0),
      bulkUnitsReceived: receipt.bulkUnitsReceived || 0,
      baseUnitsReceived: receipt.baseUnitsReceived || 0,
      receivedBy: receipt.receivedBy || "",
      supplier: receipt.supplier || "",
      invoiceDetails: receipt.invoiceDetails || "",
      receivedAt: receipt.receivedAt || null,
      expiryDate: receipt.expiryDate || "",
      paymentStatus: receipt.paymentStatus || ""
    };
  });
}

function replaceStockReceipts(receipts = []) {
  state.stockReceipts = receipts;
  rebuildStockFromCloudReceipts();
  saveState();
}

function replaceSales(sales = []) {
  state.sales = sales;
  rebuildStockFromCloudReceipts();
  saveState();
}

async function startCloudProductSync() {
  await migrateLocalProductsToCloudOnce();

  const [cloudProducts, cloudReceipts, cloudSales] = await Promise.all([
    fetchProductsFromCloud(),
    fetchStockReceiptsFromCloud(),
    fetchSalesFromCloud()
  ]);

  if (cloudProducts.length > 0) {
    replaceProducts(cloudProducts);
  }

  replaceStockReceipts(cloudReceipts);
  replaceSales(cloudSales);

  if (stopProductsListener) {
    stopProductsListener();
  }
  if (stopStockReceiptsListener) {
    stopStockReceiptsListener();
  }
  if (stopSalesListener) {
    stopSalesListener();
  }

  stopProductsListener = listenToProducts(
    (products) => {
      replaceProducts(products);
    },
    (error) => {
      console.error("Product listener failed:", error);
    }
  );

  stopStockReceiptsListener = listenToStockReceipts(
    (receipts) => {
      replaceStockReceipts(receipts);
    },
    (error) => {
      console.error("Stock receipt listener failed:", error);
    }
  );

  stopSalesListener = listenToSales(
    (sales) => {
      replaceSales(sales);
    },
    (error) => {
      console.error("Sales listener failed:", error);
    }
  );
}

const menuItems = [
  { page: "addProduct", icon: "➕", title: "Add Product", text: "Create product details" },
  { page: "receiveStock", icon: "📥", title: "Receive Stock", text: "Add supplier deliveries" },
  { page: "sales", icon: "💰", title: "Record Sale", text: "Sell bulk or base units" },
  { page: "inventory", icon: "📦", title: "Inventory", text: "Check current stock" },
  { page: "suppliers", icon: "👥", title: "Suppliers", text: "Save supplier contacts" },
  { page: "dashboard", icon: "📊", title: "Dashboard", text: "View business summary" },
  { page: "help", icon: "❔", title: "Help", text: "Learn how to use the app" },
  { page: "logout", icon: "🚪", title: "Logout", text: "Sign out of the app" }
];

function canAccessPage(page) {
  const requiredPermission = getPagePermission(page);

  if (!requiredPermission) {
    return true;
  }

  return hasPermission(requiredPermission);
}

function navigate(page) {
  if (page === "login") {
    renderLogin();
    return;
  }

  if (page === "logout") {
    logout();
    return;
  }

  if (!isLoggedIn() && page !== "login") {
    renderLogin();
    return;
  }

  if (!canAccessPage(page)) {
    renderShell();
    renderPage(`
      <div class="page-title">
        <h2>Access Denied</h2>
        <p>You do not have permission to open this page.</p>
      </div>
      <button onclick="navigate('home')">Back to Menu</button>
    `);
    return;
  }

  renderShell();

  if (page === "home") renderHome();
  if (page === "dashboard") window.renderDashboard?.();
  if (page === "addProduct") window.renderAddProduct?.();
  if (page === "receiveStock") window.renderReceiveStock?.();
  if (page === "suppliers") window.renderSuppliers?.();
  if (page === "sales") window.renderSales?.();
  if (page === "inventory") window.renderInventory?.();
  if (page === "help") window.renderHelp?.();
}

function isLoggedIn() {
  return Boolean(state.user);
}

function renderLogin(error = "") {
  app.innerHTML = `
    <section class="login-page">
      <div class="login-panel">
        <h1>CALKRIS-DARF VENTURES</h1>
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

  const user = state.users.find(
    (candidate) => candidate.username === username && candidate.password === password
  );

  if (!user) {
    renderLogin("Invalid username or password.");
    return;
  }

  state.user = {
    username: user.username,
    role: user.role
  };
  saveState();
  navigate("home");
}

function logout() {
  state.user = null;
  saveState();
  renderLogin();
}

function renderShell() {
  app.innerHTML = `
    <header class="app-header">
      <div>
        <h1>CALKRIS-DARF VENTURES</h1>
        <p>Stock control, sales, and receipts in one place.</p>
      </div>
    </header>

    <main id="page"></main>
  `;
}

function renderHome() {
  const page = document.getElementById("page");
  const cards = menuItems
    .filter((item) => canAccessPage(item.page))
    .map((item) => `
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

function createProductIdentifier() {
  return `prod_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
}

function createStockBatchId() {
  return `batch_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
}

function parseExpiryDate(value) {
  if (!value) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T23:59:59.999`);
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isBatchExpired(expiryDate, referenceDate = new Date()) {
  const parsedExpiry = parseExpiryDate(expiryDate);

  if (!parsedExpiry) {
    return false;
  }

  return parsedExpiry < referenceDate;
}

function getBatchesByProductId(productId) {
  if (!Array.isArray(state.stock)) {
    return [];
  }

  return state.stock.filter((batch) => batch.productId === productId && (batch.quantity || 0) > 0);
}

function getSellableBatches(productId) {
  return getBatchesByProductId(productId).filter((batch) => !isBatchExpired(batch.expiryDate));
}

function getExpiredBatches(productId) {
  return getBatchesByProductId(productId).filter((batch) => isBatchExpired(batch.expiryDate));
}

function getBatchQuantityTotal(batches) {
  return batches.reduce((sum, batch) => sum + (Number(batch.quantity) || 0), 0);
}

function getSellableStockQuantity(productId) {
  return getBatchQuantityTotal(getSellableBatches(productId));
}

function getExpiredStockQuantity(productId) {
  return getBatchQuantityTotal(getExpiredBatches(productId));
}

function syncProductQuantities() {
  if (state.settings?.useCloudProducts) {
    return false;
  }

  let changed = false;

  state.products.forEach((product) => {
    const sellableQuantity = getSellableStockQuantity(product.id);

    if (product.quantity !== sellableQuantity) {
      product.quantity = sellableQuantity;
      changed = true;
    }
  });

  return changed;
}

function ensureAllProductIds() {
  let changed = false;

  state.products.forEach((product) => {
    if (!product.id) {
      product.id = createProductIdentifier();
      changed = true;
    }
  });

  return changed;
}

function persistStateIfNeeded(changed) {
  if (changed) {
    saveState();
  }
}

function ensureStockState() {
  let changed = ensureAllProductIds();

  if (!Array.isArray(state.stock)) {
    state.stock = [];
    changed = true;
  }

  state.products.forEach((product) => {
    const trackedQuantity = getBatchQuantityTotal(getBatchesByProductId(product.id));

    if (product.quantity > trackedQuantity) {
      state.stock.push({
        id: createStockBatchId(),
        productId: product.id,
        productName: product.name,
        quantity: product.quantity - trackedQuantity,
        receivedAt: null,
        expiryDate: "",
        supplier: "",
        invoiceDetails: "",
        paymentStatus: "",
        receivedBy: "",
        isLegacy: true
      });
      changed = true;
    }
  });

  if (syncProductQuantities()) {
    changed = true;
  }

  persistStateIfNeeded(changed);
}

function allocateStockFromBatches(productId, quantityNeeded) {
  const batches = getSellableBatches(productId).slice().sort((left, right) => {
    const leftExpiry = parseExpiryDate(left.expiryDate);
    const rightExpiry = parseExpiryDate(right.expiryDate);
    const leftTime = leftExpiry ? leftExpiry.getTime() : Number.MAX_SAFE_INTEGER;
    const rightTime = rightExpiry ? rightExpiry.getTime() : Number.MAX_SAFE_INTEGER;

    if (leftTime !== rightTime) {
      return leftTime - rightTime;
    }

    return new Date(left.receivedAt || 0).getTime() - new Date(right.receivedAt || 0).getTime();
  });

  let remaining = quantityNeeded;
  const allocations = [];

  for (const batch of batches) {
    if (remaining <= 0) {
      break;
    }

    const quantityTaken = Math.min(batch.quantity, remaining);

    if (quantityTaken <= 0) {
      continue;
    }

    batch.quantity -= quantityTaken;
    remaining -= quantityTaken;
    allocations.push({
      batchId: batch.id,
      quantity: quantityTaken,
      expiryDate: batch.expiryDate || ""
    });
  }

  if (remaining > 0) {
    throw new Error("Not enough sellable stock available in unexpired batches.");
  }

  syncProductQuantities();

  return allocations;
}

function resetData() {
  localStorage.removeItem("inventoryState");
  localStorage.removeItem("inventory_app");
  localStorage.removeItem("inventoryLoggedIn");
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

ensureStockState();
ensureSalesSyncMetadata();

window.app = {
  state,
  navigate,
  renderPage,
  saveState,
  ensureStockState,
  formatStock: window.formatStock,
  getBatchesByProductId,
  getSellableBatches,
  getExpiredBatches,
  parseExpiryDate,
  getExpiredStockQuantity,
  getSellableStockQuantity,
  syncProductQuantities,
  createStockBatchId,
  isBatchExpired,
  getCurrentDateTimeValue: window.getCurrentDateTimeValue,
  openModal,
  closeModal,
  resetData
};

window.navigate = navigate;
window.login = login;
window.closeModal = closeModal;
window.printReceipt = printReceipt;
window.resetData = resetData;

const receiptModule = await import("./services/receiptService.js");
window.app.formatReceiptCurrency = receiptModule.formatReceiptCurrency;

await import("./pages/addProduct.js");
await import("./pages/receiveStock.js");
await import("./pages/suppliers.js");
await import("./pages/sales.js");
await import("./pages/inventory.js");
await import("./pages/dashboard.js");
await import("./pages/help.js");

window.app.formatStock = window.formatStock;
window.app.getCurrentDateTimeValue = window.getCurrentDateTimeValue;
window.app.retryPendingSalesSync = retryPendingSalesSync;

await startCloudProductSync();

window.addEventListener("online", () => {
  void retryPendingSalesSync();
  void startCloudProductSync();
});

const salesSyncIntervalMs = Math.max(state.settings?.salesSyncIntervalMs || 30000, 5000);
setInterval(() => {
  void retryPendingSalesSync();
}, salesSyncIntervalMs);

if (isLoggedIn()) {
  void retryPendingSalesSync();
  navigate("home");
} else {
  renderLogin();
}
