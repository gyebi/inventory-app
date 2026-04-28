import { setState as setSharedState } from "./state.js";
import {
  hasPermission,
  isPasswordChangeRequired,
  loginWithEmail,
  logoutUser,
  normalizeUserProfile,
  observeAuthState,
  updateCurrentUserPassword,
  validateSessionProfile
} from "./services/authService.js";
import {
  fetchProductsFromCloud,
  fetchSalesFromCloud,
  fetchStockReceiptsFromCloud
} from "./services/cloudProductService.js";
import {
  fetchSupplierPaymentsFromCloud,
  fetchSuppliersFromCloud
} from "./services/cloudSupplierService.js";
import { fetchUsersFromCloud } from "./services/cloudUserService.js";
import {
  listenToProducts,
  listenToSales,
  listenToStockReceipts,
  listenToSupplierPayments,
  listenToSuppliers,
  listenToUsers
} from "./services/productListenerService.js";
import { migrateLocalProductsToCloudOnce } from "./services/productMigrationService.js";
import { migrateLocalSuppliersToCloudOnce } from "./services/supplierMigrationService.js";
import { ensureSalesSyncMetadata, retryPendingSalesSync } from "./services/syncService.js";
import { clearRequiredPasswordChange, getUserProfile } from "./services/userProfileService.js";
import { getPagePermission } from "./utils/pagePermissions.js";

const app = document.getElementById("app");
const modal = document.getElementById("modal");
const modalBody = document.getElementById("modal-body");
const STORAGE_KEY = "inventory_app";
const SPLASH_MINIMUM_MS = 5000;
const INITIAL_SYNC_WAIT_MS = 10000;

const defaultState = {
  user: null,
  users: [],
  products: [],
  stock: [],
  sales: [],
  suppliers: [],
  stockReceipts: [],
  stockAdjustments: [],
  supplierPayments: [],
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
let stopUsersListener = null;
let stopSuppliersListener = null;
let stopSupplierPaymentsListener = null;
let cloudSyncPromise = null;
let currentPage = "home";
let cloudStatus = {
  connected: false,
  message: "Connecting to Firestore",
  lastUpdatedAt: null
};
let isPrintingModal = false;

function sanitizePersistedUsers(users = []) {
  return users
    .filter((user) => user && typeof user === "object")
    .map((user) => {
      const normalizedUser = normalizeUserProfile(user);

      return normalizedUser
        ? {
            id: normalizedUser.id,
            uid: normalizedUser.uid,
            fullName: normalizedUser.fullName,
            username: normalizedUser.username,
            email: normalizedUser.email,
            role: normalizedUser.role,
            active: normalizedUser.active,
            isActive: normalizedUser.active,
            pendingAuthCreation: normalizedUser.pendingAuthCreation === true,
            createdAt: normalizedUser.createdAt || null,
            createdBy: normalizedUser.createdBy || null,
            mustChangePassword: normalizedUser.mustChangePassword === true,
            credentialSetupMode: normalizedUser.credentialSetupMode || null
          }
        : null;
    })
    .filter(Boolean);
}

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
        ? sanitizePersistedUsers(parsedState.users)
        : []
    };
  } catch (error) {
    return structuredClone(defaultState);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  setSharedState(state);
}

function formatStatusTime(value) {
  return value ? new Date(value).toLocaleTimeString() : "Not yet";
}

function updateStatusBar() {
  const statusBar = document.getElementById("statusBar");

  if (!statusBar) {
    return;
  }

  const online = navigator.onLine;
  const role = state.user?.role || "guest";
  const name = state.user?.fullName || state.user?.username || state.user?.email || "Guest";

  statusBar.innerHTML = `
    <span class="status-pill ${online ? "online" : "offline"}">${online ? "Online" : "Offline"}</span>
    <span class="status-pill">User: ${name}</span>
    <span class="status-pill">Role: ${role}</span>
    <span class="status-pill">Last update: ${formatStatusTime(cloudStatus.lastUpdatedAt)}</span>
    <button class="status-button" onclick="navigate('home')">Menu</button>
  `;
}

function setCloudStatus(updates = {}) {
  cloudStatus = {
    ...cloudStatus,
    ...updates
  };
  updateStatusBar();
}

function markCloudUpdated(message = "Firestore connected") {
  setCloudStatus({
    connected: true,
    message,
    lastUpdatedAt: new Date().toISOString()
  });
}

function replaceProducts(products = []) {
  state.products = products.map((product) => ({
    quantity: 0,
    ...product
  }));
  markCloudUpdated("Products synced");
  saveState();
}

function normalizeUser(user) {
  const normalizedUser = normalizeUserProfile(user);

  return {
    id: normalizedUser.id || normalizedUser.uid || `user_${normalizedUser.username || normalizedUser.email || Date.now()}`,
    uid: normalizedUser.uid || normalizedUser.id || null,
    fullName: normalizedUser.fullName,
    username: normalizedUser.username || "",
    email: normalizedUser.email || "",
    role: normalizedUser.role,
    active: normalizedUser.active,
    pendingAuthCreation: normalizedUser.pendingAuthCreation === true,
    createdAt: normalizedUser.createdAt || null,
    createdBy: normalizedUser.createdBy || null,
    mustChangePassword: normalizedUser.mustChangePassword === true,
    credentialSetupMode: normalizedUser.credentialSetupMode || null
  };
}

function replaceUsers(users = []) {
  const normalizedUsers = users
    .filter((user) => user.email || user.username || user.fullName || user.displayName)
    .map(normalizeUser);

  state.users = normalizedUsers;

  if (state.user) {
    const refreshedUser = state.users.find((user) => (
      (state.user.uid && (user.uid === state.user.uid || user.id === state.user.uid)) ||
      (state.user.id && user.id === state.user.id) ||
      (state.user.email && user.email === state.user.email)
    ));

    if (refreshedUser) {
      state.user = {
        id: refreshedUser.id,
        uid: refreshedUser.uid || refreshedUser.id,
        fullName: refreshedUser.fullName,
        username: refreshedUser.username,
        email: refreshedUser.email || "",
        role: refreshedUser.role,
        active: refreshedUser.active !== false,
        authSource: "firebase"
      };
    }
  }

  markCloudUpdated("Users synced");
  saveState();
}

function canSyncAllUsers() {
  return state.user?.role === "admin";
}

function rebuildStockFromCloudReceipts() {
  const soldByBatch = new Map();
  const adjustedByBatch = new Map();

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

  (state.stockAdjustments || []).forEach((adjustment) => {
    if (Array.isArray(adjustment.batchAllocations) && adjustment.batchAllocations.length > 0) {
      adjustment.batchAllocations.forEach((allocation) => {
        adjustedByBatch.set(
          allocation.batchId,
          (adjustedByBatch.get(allocation.batchId) || 0) + Number(allocation.quantity || 0)
        );
      });
      return;
    }

    if (adjustment.batchId) {
      adjustedByBatch.set(
        adjustment.batchId,
        (adjustedByBatch.get(adjustment.batchId) || 0) + Number(adjustment.baseQuantityAffected || adjustment.quantityAffected || 0)
      );
    }
  });

  const receiptStock = state.stockReceipts.map((receipt) => {
    const originalQuantity = Number(receipt.quantityReceived || 0);
    const soldQuantity = soldByBatch.get(receipt.batchId) || 0;
    const adjustedQuantity = adjustedByBatch.get(receipt.batchId) || 0;

    return {
      id: receipt.batchId,
      productId: receipt.productId,
      productName: receipt.product,
      quantity: Math.max(originalQuantity - soldQuantity - adjustedQuantity, 0),
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

  const productsWithReceipts = new Set(state.stockReceipts.map((receipt) => receipt.productId));
  const syntheticStock = state.products
    .filter((product) => !productsWithReceipts.has(product.id) && Number(product.quantity || 0) > 0)
    .map((product) => ({
      id: `cloud_initial_${product.id}`,
      productId: product.id,
      productName: product.name,
      quantity: Number(product.quantity || 0),
      bulkUnitsReceived: 0,
      baseUnitsReceived: Number(product.quantity || 0),
      receivedBy: "Cloud",
      supplier: "",
      invoiceDetails: "Initial cloud stock",
      receivedAt: null,
      expiryDate: "",
      paymentStatus: "",
      isCloudInitial: true
    }));

  state.stock = [...receiptStock, ...syntheticStock];

  state.products.forEach((product) => {
    product.quantity = getSellableStockQuantity(product.id);
  });
}

function replaceStockReceipts(receipts = []) {
  state.stockReceipts = receipts;
  rebuildStockFromCloudReceipts();
  markCloudUpdated("Stock synced");
  saveState();
}

function replaceSales(sales = []) {
  state.sales = sales;
  rebuildStockFromCloudReceipts();
  markCloudUpdated("Sales synced");
  saveState();
}

function normalizeSupplier(supplier) {
  return {
    id: supplier.id,
    name: supplier.name || "",
    contactPerson: supplier.contactPerson || "",
    phone: supplier.phone || "",
    email: supplier.email || "",
    address: supplier.address || "",
    notes: supplier.notes || "",
    createdAt: supplier.createdAt || null,
    createdBy: supplier.createdBy || null
  };
}

function replaceSuppliers(suppliers = []) {
  state.suppliers = suppliers
    .filter((supplier) => supplier.name)
    .map(normalizeSupplier);
  markCloudUpdated("Suppliers synced");
  saveState();
}

function replaceSupplierPayments(payments = []) {
  state.supplierPayments = Array.isArray(payments) ? payments : [];
  markCloudUpdated("Supplier payments synced");
  saveState();
}

function stopCloudListeners() {
  if (stopProductsListener) {
    stopProductsListener();
    stopProductsListener = null;
  }

  if (stopStockReceiptsListener) {
    stopStockReceiptsListener();
    stopStockReceiptsListener = null;
  }

  if (stopSalesListener) {
    stopSalesListener();
    stopSalesListener = null;
  }

  if (stopUsersListener) {
    stopUsersListener();
    stopUsersListener = null;
  }

  if (stopSuppliersListener) {
    stopSuppliersListener();
    stopSuppliersListener = null;
  }

  if (stopSupplierPaymentsListener) {
    stopSupplierPaymentsListener();
    stopSupplierPaymentsListener = null;
  }
}

async function startCloudProductSync({ forceReplaceProducts = false } = {}) {
  await migrateLocalProductsToCloudOnce();
  await migrateLocalSuppliersToCloudOnce();

  const syncUsers = canSyncAllUsers();

  const [cloudProducts, cloudReceipts, cloudSales, cloudUsers, cloudSuppliers, cloudSupplierPayments] = await Promise.all([
    fetchProductsFromCloud(),
    fetchStockReceiptsFromCloud(),
    fetchSalesFromCloud(),
    syncUsers ? fetchUsersFromCloud() : Promise.resolve([]),
    fetchSuppliersFromCloud(),
    fetchSupplierPaymentsFromCloud()
  ]);

  if (cloudProducts.length > 0 || forceReplaceProducts) {
    replaceProducts(cloudProducts);
  }

  replaceStockReceipts(cloudReceipts);
  replaceSales(cloudSales);
  if (syncUsers) {
    replaceUsers(cloudUsers);
  } else {
    state.users = [];
    saveState();
  }
  replaceSuppliers(cloudSuppliers);
  replaceSupplierPayments(cloudSupplierPayments);

  stopCloudListeners();

  stopProductsListener = listenToProducts(
    (products) => {
      replaceProducts(products);
    },
    (error) => {
      setCloudStatus({ connected: false, message: "Product sync error" });
      console.error("Product listener failed:", error);
    }
  );

  stopStockReceiptsListener = listenToStockReceipts(
    (receipts) => {
      replaceStockReceipts(receipts);
    },
    (error) => {
      setCloudStatus({ connected: false, message: "Stock sync error" });
      console.error("Stock receipt listener failed:", error);
    }
  );

  stopSalesListener = listenToSales(
    (sales) => {
      replaceSales(sales);
    },
    (error) => {
      setCloudStatus({ connected: false, message: "Sales sync error" });
      console.error("Sales listener failed:", error);
    }
  );

  if (syncUsers) {
    stopUsersListener = listenToUsers(
      (users) => {
        replaceUsers(users);
      },
      (error) => {
        setCloudStatus({ connected: false, message: "User sync error" });
        console.error("User listener failed:", error);
      }
    );
  }

  stopSuppliersListener = listenToSuppliers(
    (suppliers) => {
      replaceSuppliers(suppliers);
    },
    (error) => {
      setCloudStatus({ connected: false, message: "Supplier sync error" });
      console.error("Supplier listener failed:", error);
    }
  );

  stopSupplierPaymentsListener = listenToSupplierPayments(
    (payments) => {
      replaceSupplierPayments(payments);
    },
    (error) => {
      setCloudStatus({ connected: false, message: "Supplier payment sync error" });
      console.error("Supplier payment listener failed:", error);
    }
  );
}

function isReadyForProtectedCloudSync() {
  return Boolean(state.user?.uid);
}

async function ensureAuthenticatedCloudSync() {
  if (!isReadyForProtectedCloudSync()) {
    stopCloudListeners();
    setCloudStatus({ connected: false, message: "Sign in to sync data" });
    return false;
  }

  if (!cloudSyncPromise) {
    cloudSyncPromise = (async () => {
      try {
        setCloudStatus({ connected: false, message: "Connecting to Firestore" });
        await startCloudProductSync();
        return true;
      } catch (error) {
        setCloudStatus({ connected: false, message: "Cloud sync unavailable" });
        console.error("Cloud startup sync failed:", error);
        return false;
      } finally {
        cloudSyncPromise = null;
      }
    })();
  }

  return cloudSyncPromise;
}

async function waitForInitialCloudSync() {
  if (!isReadyForProtectedCloudSync()) {
    return false;
  }

  return Promise.race([
    ensureAuthenticatedCloudSync(),
    wait(INITIAL_SYNC_WAIT_MS).then(() => {
      setCloudStatus({ connected: false, message: "Ready" });
      return false;
    })
  ]);
}

const menuItems = [
  { page: "addProduct", icon: "➕", title: "Add Product", text: "Create product details" },
  { page: "receiveStock", icon: "📥", title: "Receive Stock", text: "Add supplier deliveries" },
  { page: "supplierPayment", icon: "🧾", title: "Supplier Payment", text: "Record payments against supplier invoices" },
  { page: "stockAdjustment", icon: "🧯", title: "Stock Adjustment", text: "Record damaged, lost, expired, or broken stock" },
  { page: "sales", icon: "💰", title: "Record Sale", text: "Sell bulk or base units" },
  { page: "inventory", icon: "📦", title: "Inventory", text: "Check current stock" },
  { page: "reports", icon: "📑", title: "Reports", text: "Open product and sales reports" },
  { page: "suppliers", icon: "👥", title: "Suppliers", text: "Save supplier contacts" },
  { page: "staff", icon: "👤", title: "Staff", text: "Add staff and assign roles" },
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

function hasPendingRequiredPasswordChange() {
  return isPasswordChangeRequired(state.sessionUser);
}

function navigate(page) {
  if (page === "login") {
    currentPage = page;
    renderLogin();
    return;
  }

  if (page === "logout") {
    void logout();
    return;
  }

  if (!isLoggedIn() && page !== "login") {
    renderLogin();
    return;
  }

  if (hasPendingRequiredPasswordChange() && page !== "logout" && page !== "changePassword") {
    currentPage = "changePassword";
    renderRequiredPasswordChange();
    return;
  }

  if (!canAccessPage(page)) {
    currentPage = page;
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

  currentPage = page;
  renderShell();

  if (page === "home") renderHome();
  if (page === "dashboard" || page === "reports") window.renderDashboard?.();
  if (page === "addProduct") window.renderAddProduct?.();
  if (page === "receiveStock") window.renderReceiveStock?.();
  if (page === "supplierPayment") window.renderSupplierPayment?.();
  if (page === "stockAdjustment") window.renderStockAdjustment?.();
  if (page === "suppliers") window.renderSuppliers?.();
  if (page === "sales") window.renderSales?.();
  if (page === "inventory") window.renderInventory?.();
  if (page === "staff") window.renderStaff?.();
  if (page === "help") window.renderHelp?.();
  if (page === "changePassword") renderRequiredPasswordChange();
}

function wait(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function renderSplash() {
  app.innerHTML = `
    <section class="splash-page">
      <div>
        <img class="splash-logo" src="/logo.png" alt="Calkris-Darf Ventures">
        <div class="splash-loader" aria-hidden="true"><span></span></div>
      </div>
    </section>
  `;
}

function renderCurrentEntryPage() {
  if (isLoggedIn()) {
    if (hasPendingRequiredPasswordChange()) {
      renderRequiredPasswordChange();
      return;
    }

    void retryPendingSalesSync();
    navigate("home");
    return;
  }

  renderLogin();
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
            <label for="identifier">Email</label>
            <input id="identifier" type="email" autocomplete="email">
          </div>

          <div class="form-row">
            <label for="password">Password</label>
            <input id="password" type="password" autocomplete="current-password">
          </div>

          <button onclick="login()">Login</button>
        </div>
      </div>
    </section>
  `;
}

function renderRequiredPasswordChange(error = "") {
  currentPage = "changePassword";
  renderShell();

  const setupMode = state.sessionUser?.credentialSetupMode || "temporary_password";
  const helperText = setupMode === "temporary_password"
    ? "You signed in with a temporary password. Choose a new password before using the app."
    : "Choose a new password before using the app.";

  renderPage(`
    <div class="page-title">
      <h2>Change Password</h2>
      <p>${helperText}</p>
    </div>

    ${error ? `<div class="message error">${error}</div>` : ""}

    <div class="form-column panel">
      <div class="form-row">
        <label for="newPassword">New Password</label>
        <input id="newPassword" type="password" autocomplete="new-password">
      </div>

      <div class="form-row">
        <label for="confirmPassword">Confirm Password</label>
        <input id="confirmPassword" type="password" autocomplete="new-password">
      </div>

      <button id="completePasswordChangeButton" onclick="completeRequiredPasswordChange()">Save New Password</button>
      <button type="button" onclick="navigate('logout')">Sign Out</button>
    </div>
  `);
}

function setPasswordChangeProcessing(isProcessing) {
  const button = document.getElementById("completePasswordChangeButton");

  if (!button) {
    return;
  }

  button.disabled = isProcessing;
  button.innerHTML = isProcessing
    ? `<span class="button-spinner" aria-hidden="true"></span>Saving...`
    : "Save New Password";
}

async function login() {
  const identifier = document.getElementById("identifier").value.trim();
  const password = document.getElementById("password").value.trim();

  if (!identifier || !password) {
    renderLogin("Enter your email and password.");
    return;
  }

  try {
    const user = await authenticateUser(identifier, password);

    if (!user) {
      renderLogin("Invalid email or password.");
      return;
    }

    state.user = user.user;
    state.sessionUser = user.profile || null;
    saveState();
    await waitForInitialCloudSync();
    navigate("home");
  } catch (error) {
    console.error("Login failed:", error);
    renderLogin(error.message || "Login failed.");
  }
}

async function loadValidatedSessionProfile(uid) {
  let profile = validateSessionProfile(await getUserProfile(uid));

  if (profile.mustChangePassword && profile.credentialSetupMode === "setup_link") {
    const clearedProfile = await clearRequiredPasswordChange();
    profile = validateSessionProfile(clearedProfile || {
      ...profile,
      mustChangePassword: false
    });
  }

  return profile;
}

async function authenticateUser(identifier, password) {
  const normalizedIdentifier = identifier.trim().toLowerCase();

  if (!normalizedIdentifier.includes("@")) {
    throw new Error("Use the staff email address to sign in.");
  }

  try {
    const authUser = await loginWithEmail(normalizedIdentifier, password);
    const profile = await loadValidatedSessionProfile(authUser.uid);

    return {
      user: buildSessionUser(profile),
      profile
    };
  } catch (error) {
    await logoutUser().catch(() => {});
    throw error;
  }
}

async function logout() {
  try {
    await logoutUser();
  } catch (error) {
    console.error("Logout failed:", error);
  }

  stopCloudListeners();
  state.user = null;
  state.sessionUser = null;
  saveState();
  setCloudStatus({ connected: false, message: "Sign in to sync data" });
  renderLogin();
}

function buildSessionUser(profile) {
  const normalizedProfile = normalizeUserProfile(profile);

  return {
    id: normalizedProfile.id || normalizedProfile.uid,
    uid: normalizedProfile.uid || normalizedProfile.id,
    fullName: normalizedProfile.fullName,
    username: normalizedProfile.username || normalizedProfile.email || "",
    email: normalizedProfile.email || "",
    role: normalizedProfile.role || "sales",
    active: normalizedProfile.active !== false,
    authSource: "firebase"
  };
}

async function syncAuthenticatedUser(uid) {
  if (!uid) {
    state.user = null;
    saveState();
    return false;
  }

  const profile = await loadValidatedSessionProfile(uid);

  const sessionUser = buildSessionUser(profile);
  state.user = sessionUser;
  state.sessionUser = profile;
  saveState();
  return true;
}

async function completeRequiredPasswordChange() {
  const newPassword = document.getElementById("newPassword")?.value.trim() || "";
  const confirmPassword = document.getElementById("confirmPassword")?.value.trim() || "";

  if (!newPassword || !confirmPassword) {
    renderRequiredPasswordChange("Enter and confirm your new password.");
    return;
  }

  if (newPassword.length < 6) {
    renderRequiredPasswordChange("New password must be at least 6 characters.");
    return;
  }

  if (newPassword !== confirmPassword) {
    renderRequiredPasswordChange("The new password and confirmation do not match.");
    return;
  }

  try {
    setPasswordChangeProcessing(true);
    await updateCurrentUserPassword(newPassword);
    const updatedProfile = validateSessionProfile(
      await clearRequiredPasswordChange() || {
        ...state.sessionUser,
        mustChangePassword: false
      }
    );

    state.user = buildSessionUser(updatedProfile);
    state.sessionUser = updatedProfile;
    saveState();
    navigate("home");
  } catch (error) {
    console.error("Required password change failed:", error);
    renderRequiredPasswordChange(error.message || "Unable to change the password.");
  }
}

function renderShell() {
  app.innerHTML = `
    <header class="app-header">
      <div>
        <h1>CALKRIS-DARF VENTURES</h1>
        <p>Stock control, sales, and receipts in one place.</p>
      </div>
      <div id="statusBar" class="status-bar"></div>
    </header>

    <main id="page"></main>
  `;
  updateStatusBar();
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

  if (!Array.isArray(state.stockAdjustments)) {
    state.stockAdjustments = [];
    changed = true;
  }

  if (!Array.isArray(state.supplierPayments)) {
    state.supplierPayments = [];
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

async function refreshFromCloud() {
  if (!isReadyForProtectedCloudSync()) {
    setCloudStatus({ connected: false, message: "Sign in to refresh data" });
    navigate("login");
    return false;
  }

  const pageToRefresh = currentPage;

  try {
    setCloudStatus({ connected: false, message: "Refreshing from Firestore" });
    await startCloudProductSync({ forceReplaceProducts: true });
    markCloudUpdated("Cloud data refreshed");
    navigate(pageToRefresh);
    return true;
  } catch (error) {
    setCloudStatus({ connected: false, message: "Cloud refresh failed" });
    console.error("Cloud refresh failed:", error);
    alert("Unable to refresh from Firebase right now. Please check your connection and try again.");
    return false;
  }
}

function printReceipt() {
  window.print();
}

function printModalReport() {
  if (isPrintingModal) {
    return;
  }

  isPrintingModal = true;
  document.body.classList.add("printing-report");

  const cleanup = () => {
    isPrintingModal = false;
    document.body.classList.remove("printing-report");
    window.removeEventListener("afterprint", cleanup);
  };

  window.addEventListener("afterprint", cleanup);
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
  allocateStockFromBatches,
  createStockBatchId,
  isBatchExpired,
  getCurrentDateTimeValue: window.getCurrentDateTimeValue,
  openModal,
  closeModal,
  refreshFromCloud
  ,
  getCurrentPage: () => currentPage
};

window.navigate = navigate;
window.login = login;
window.completeRequiredPasswordChange = completeRequiredPasswordChange;
window.closeModal = closeModal;
window.printReceipt = printReceipt;
window.printModalReport = printModalReport;
window.refreshFromCloud = refreshFromCloud;

renderSplash();

const receiptModule = await import("./services/receiptService.js");
window.app.formatReceiptCurrency = receiptModule.formatReceiptCurrency;

await import("./pages/addProduct.js");
await import("./pages/receiveStock.js");
await import("./pages/supplierPayment.js");
await import("./pages/stockAdjustment.js");
await import("./pages/suppliers.js");
await import("./pages/sales.js");
await import("./pages/inventory.js");
await import("./pages/dashboard.js");
await import("./pages/staff.js");
await import("./pages/help.js");

window.app.formatStock = window.formatStock;
window.app.getCurrentDateTimeValue = window.getCurrentDateTimeValue;
window.app.retryPendingSalesSync = retryPendingSalesSync;

let authReadyResolver;
const authReady = new Promise((resolve) => {
  authReadyResolver = resolve;
});

observeAuthState(async (firebaseUser) => {
  try {
    if (!firebaseUser) {
      stopCloudListeners();
      if (state.user || state.sessionUser) {
        state.user = null;
        state.sessionUser = null;
        saveState();
      }
      setCloudStatus({ connected: false, message: "Sign in to sync data" });
      authReadyResolver?.();
      authReadyResolver = null;
      return;
    }

    await syncAuthenticatedUser(firebaseUser.uid);
    void ensureAuthenticatedCloudSync();
  } catch (error) {
    console.error("Auth state sync failed:", error);
    stopCloudListeners();
    state.user = null;
    state.sessionUser = null;
    saveState();
    setCloudStatus({ connected: false, message: "Sign in to sync data" });
  } finally {
    authReadyResolver?.();
    authReadyResolver = null;
  }
});

async function bootApp() {
  await Promise.all([
    wait(SPLASH_MINIMUM_MS),
    authReady
  ]);

  if (isLoggedIn()) {
    await waitForInitialCloudSync();
  } else {
    setCloudStatus({ connected: false, message: "Ready" });
  }

  renderCurrentEntryPage();
}

window.addEventListener("online", () => {
  setCloudStatus({ connected: false, message: "Reconnecting to Firestore" });
  void retryPendingSalesSync();
  void ensureAuthenticatedCloudSync();
});

window.addEventListener("offline", () => {
  setCloudStatus({ connected: false, message: "Offline mode" });
});

const salesSyncIntervalMs = Math.max(state.settings?.salesSyncIntervalMs || 30000, 5000);
setInterval(() => {
  void retryPendingSalesSync();
}, salesSyncIntervalMs);

void bootApp();
