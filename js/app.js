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
  fetchPriceChangesFromCloud,
  fetchSalesFromCloud,
  fetchStockAdjustmentsFromCloud,
  fetchWeeklyStocktakingSettingsFromCloud,
  fetchStockBatchesFromCloud,
  fetchStockReceiptsFromCloud
} from "./services/cloudProductService.js";
import {
  fetchSupplierPaymentsFromCloud,
  fetchSuppliersFromCloud
} from "./services/cloudSupplierService.js";
import { fetchUsersFromCloud } from "./services/cloudUserService.js";
import {
  listenToProducts,
  listenToPriceChanges,
  listenToSales,
  listenToStockAdjustments,
  listenToStocktakeSessions,
  listenToWeeklyStocktakingSettings,
  listenToStockBatches,
  listenToStockReceipts,
  listenToSupplierPayments,
  listenToSuppliers,
  listenToUsers
} from "./services/productListenerService.js";
import { migrateLocalProductsToCloudOnce } from "./services/productMigrationService.js";
import { migrateLocalSuppliersToCloudOnce } from "./services/supplierMigrationService.js";
import { ensureSalesSyncMetadata, retryPendingSalesSync } from "./services/syncService.js";
import { fetchCategorySettingsFromCloud } from "./services/categorySettingsService.js";
import { clearRequiredPasswordChange, getUserProfile } from "./services/userProfileService.js";
import { fetchTaxSettingsFromCloud } from "./services/taxSettingsService.js";
import { createAppError, ERROR_FLAGS, logAppError, toUserMessage } from "./utils/errorUtils.js";
import {
  DASHBOARD_PAGE,
  canAccessPageWithPermission,
  normalizeNavigationPage
} from "./utils/hubNavigation.js";
import { getCloudConnectionBadgeState } from "./utils/cloudConnectionStatus.js";
import {
  getAuthoritativeBatchStatus,
  getAuthoritativeDisplayBatches,
  getPhysicalQuantity,
  getSellableQuantity,
  isAuthoritativeV2Product,
  shouldUseLegacyStockReconstruction
} from "./services/authoritativeInventory.js";


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
  authoritativeStockBatches: { status: "idle", batches: [], error: null },
  sales: [],
  suppliers: [],
  stockReceipts: [],
  stockAdjustments: [],
  stocktakeSessions: [],
  weeklyStocktakingSettings: null,
  priceChanges: [],
  supplierPayments: [],
    settings: {
      lowStockThreshold: 10,
      salesSyncEndpoint: null,
      salesSyncIntervalMs: 30000,
      useCloudProducts: true,
      categories: ["Water", "Soft Drink", "Juice", "Energy Drink"],
      tax: {
      enabled: true,
      vatRate: 15,
      nhilRate: 2.5,
      getfundRate: 2.5,
      withholdingVatRate: 7,
      effectiveDate: null,
      taxMode: "standard"
    }
  }
};

let state = loadAppState();
setSharedState(state);
let stopProductsListener = null;
let stopPriceChangesListener = null;
let stopStockReceiptsListener = null;
let stopStockBatchesListener = null;
let stopSalesListener = null;
let stopStockAdjustmentsListener = null;
let stopStocktakeSessionsListener = null;
let stopWeeklyStocktakingSettingsListener = null;
let stopUsersListener = null;
let stopSuppliersListener = null;
let stopSupplierPaymentsListener = null;
let cloudSyncPromise = null;
let currentPage = DASHBOARD_PAGE;
let cloudStatus = {
  connected: false,
  isConnecting: true,
  isReconnecting: false,
  message: "Connecting to Firestore",
  lastUpdatedAt: null,
  expectedListenerNames: [],
  confirmedListenerNames: [],
  failedListenerNames: []
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
    logAppError("Saved app state could not be loaded", error);
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
    <button class="status-button" onclick="navigate('dashboard')">Dashboard</button>
  `;
}

function setCloudStatus(updates = {}) {
  cloudStatus = {
    ...cloudStatus,
    ...updates
  };
  updateStatusBar();
  updateDashboardConnectionBadge();
}

function getDashboardConnectionBadgeState() {
  return getCloudConnectionBadgeState({
    online: navigator.onLine,
    isConnecting: cloudStatus.isConnecting,
    isReconnecting: cloudStatus.isReconnecting,
    expectedListenerCount: cloudStatus.expectedListenerNames.length,
    confirmedListenerCount: cloudStatus.confirmedListenerNames.length,
    failedListenerCount: cloudStatus.failedListenerNames.length
  });
}

function updateDashboardConnectionBadge() {
  const badge = document.getElementById("dashboardConnectionBadge");

  if (!badge) {
    return;
  }

  const badgeState = getDashboardConnectionBadgeState();
  const label = badge.querySelector(".jyaano-connection-badge-label");
  const hasChanged = badge.dataset.connectionState !== badgeState.id;

  badge.className = `jyaano-connection-badge is-${badgeState.id}`;
  badge.dataset.connectionState = badgeState.id;

  if (hasChanged) {
    badge.setAttribute("aria-label", badgeState.description);
    label.textContent = badgeState.label;
  }
}

function startCloudListenerTracking(listenerNames) {
  setCloudStatus({
    connected: false,
    isConnecting: true,
    isReconnecting: cloudStatus.isReconnecting,
    message: "Connecting to Firestore",
    expectedListenerNames: listenerNames,
    confirmedListenerNames: [],
    failedListenerNames: []
  });
}

function setCloudIdleStatus(message) {
  setCloudStatus({
    connected: false,
    isConnecting: false,
    isReconnecting: false,
    message,
    expectedListenerNames: [],
    confirmedListenerNames: [],
    failedListenerNames: []
  });
}

function markCloudUpdated(message, { listenerName, fromCache }) {
  const confirmedListenerNames = new Set(cloudStatus.confirmedListenerNames);

  if (fromCache) {
    // A cached snapshot can be delivered after an earlier server snapshot, so it
    // cannot retain an old Live indication.
    confirmedListenerNames.delete(listenerName);
  } else {
    confirmedListenerNames.add(listenerName);
  }

  const expectedListenerNames = cloudStatus.expectedListenerNames;
  const connected = expectedListenerNames.length > 0 && expectedListenerNames.every((name) => confirmedListenerNames.has(name));

  setCloudStatus({
    connected,
    isConnecting: false,
    isReconnecting: false,
    message,
    lastUpdatedAt: new Date().toISOString(),
    confirmedListenerNames: [...confirmedListenerNames]
  });
}

function handleCloudListenerError(label, error) {
  const failedListenerNames = new Set(cloudStatus.failedListenerNames);
  failedListenerNames.add(label);
  setCloudStatus({
    connected: false,
    isConnecting: false,
    isReconnecting: false,
    message: `${label} sync needs attention`,
    failedListenerNames: [...failedListenerNames]
  });
  logAppError(`${label} listener failed`, error);
}

function replaceProducts(products = []) {
  state.products = products.map((product) => ({
    quantity: 0,
    ...product
  }));
  const changed = Array.isArray(state.stock) && state.stock.length > 0
    ? syncProductSellingPricesFromStock()
    : false;
  rebuildStockFromCloudReceipts();
  if (changed) {
    saveState();
    return;
  }
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

  saveState();
}

function canSyncAllUsers() {
  return state.user?.role === "admin";
}

function rebuildStockFromCloudReceipts() {
  const productsById = new Map(state.products.map((product) => [product.id, product]));
  const isLegacyReceipt = (receipt) => shouldUseLegacyStockReconstruction(productsById.get(receipt.productId));
  const soldByBatch = new Map();
  const adjustedByBatch = new Map();
  const stocktakeSurpluses = [];

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
    if (adjustment.effectDirection === "increase") {
      // A surplus has no fabricated supplier batch, expiry, or cost. It is
      // visible as physical quarantined stock and excluded from POS until a
      // deliberate receiving/reconciliation process establishes provenance.
      stocktakeSurpluses.push({
        id: `stocktake_surplus_${adjustment.id}`,
        productId: adjustment.productId,
        productName: adjustment.productName,
        quantity: Number(adjustment.baseQuantityAffected || adjustment.quantityAffected || 0),
        expiryDate: "",
        receivedAt: adjustment.createdAt || null,
        inventoryStatus: adjustment.inventoryStatus || "unverified",
        isStocktakeSurplus: true,
        unitCost: null,
        totalLandedCost: null
      });
      return;
    }
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

  const receiptStock = state.stockReceipts.filter(isLegacyReceipt).map((receipt) => {
    const originalQuantity = Number(receipt.quantityReceived || 0);
    const soldQuantity = soldByBatch.get(receipt.batchId) || 0;
    const adjustedQuantity = adjustedByBatch.get(receipt.batchId) || 0;

    return {
      id: receipt.batchId,
      productId: receipt.productId,
      productName: receipt.product,
      quantity: Math.max(originalQuantity - soldQuantity - adjustedQuantity, 0),
      bulkQuantityReceived: Number(receipt.bulkQuantityReceived ?? receipt.bulkUnitsReceived ?? 0),
      bulkUnitsReceived: Number(receipt.bulkUnitsReceived ?? receipt.bulkQuantityReceived ?? 0),
      looseBaseQuantityReceived: Number(receipt.looseBaseQuantityReceived ?? 0),
      baseUnitsReceived: Number(receipt.baseUnitsReceived ?? receipt.quantityReceived ?? 0),
      unitsPerBulk: Number(receipt.unitsPerBulk ?? productsById.get(receipt.productId)?.unitsPerBulk ?? 1),
      receivedQuantityBreakdown: receipt.receivedQuantityBreakdown || null,
      receivedBy: receipt.receivedBy || "",
      supplier: receipt.supplier || "",
      invoiceDetails: receipt.invoiceDetails || "",
      receivedAt: receipt.receivedAt || null,
      expiryDate: receipt.expiryDate || "",
      paymentStatus: receipt.paymentStatus || "",
      unitCost: Number(receipt.unitCost || 0),
      unitSellingPrice: Number(receipt.unitSellingPrice || 0),
      bulkSellingPrice: Number(receipt.bulkSellingPrice || 0),
      totalLandedCost: Number(receipt.totalLandedCost || receipt.lineTotal || 0)
    };
  });

  const productsWithReceipts = new Set(state.stockReceipts.map((receipt) => receipt.productId));
  const syntheticStock = state.products
    .filter((product) => shouldUseLegacyStockReconstruction(product) && !productsWithReceipts.has(product.id) && Number(product.quantity || 0) > 0)
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
      unitCost: Number(product.costPrice || 0),
      unitSellingPrice: Number(product.sellingPrice || 0),
      bulkSellingPrice: Number(product.bulkSellingPrice || 0),
      totalLandedCost: 0,
      isCloudInitial: true
    }));

  state.stock = [...receiptStock, ...syntheticStock, ...stocktakeSurpluses];
  applyPriceChangeHistoryToStock();
  syncProductSellingPricesFromStock();

  state.products.forEach((product) => {
    if (shouldUseLegacyStockReconstruction(product)) {
      product.quantity = getSellableStockQuantity(product.id);
    }
  });
}

function getPriceReferenceTime(entry) {
  const rawValue = entry?.sellingPriceEffectiveDate || entry?.effectiveDate || entry?.sellingPriceUpdatedAt || entry?.receivedAt || entry?.purchaseDate || entry?.createdAt || 0;
  const parsed = new Date(rawValue);

  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function applyPriceChangeHistoryToStock() {
  if (!Array.isArray(state.stock) || state.stock.length === 0) {
    return false;
  }

  const priceChanges = Array.isArray(state.priceChanges) ? state.priceChanges : [];

  if (priceChanges.length === 0) {
    return false;
  }

  const batchesById = new Map(state.stock.map((batch) => [batch.id, batch]));
  let changed = false;

  priceChanges
    .slice()
    .sort((left, right) => getPriceReferenceTime(left) - getPriceReferenceTime(right))
    .forEach((change) => {
      const newSellingPrice = Number(change.newSellingPrice || 0);

      if (!Number.isFinite(newSellingPrice) || newSellingPrice <= 0) {
        return;
      }

      const affectedBatchIds = Array.isArray(change.affectedBatchIds) ? change.affectedBatchIds : [];

      affectedBatchIds.forEach((batchId) => {
        const batch = batchesById.get(batchId);

        if (!batch) {
          return;
        }

        const product = state.products.find((item) => item.id === batch.productId);
        const unitsPerBulk = Number(product?.unitsPerBulk || 1) > 0 ? Number(product.unitsPerBulk || 1) : 1;
        const bulkSellingPrice = newSellingPrice * unitsPerBulk;

        if (batch.unitSellingPrice !== newSellingPrice) {
          batch.unitSellingPrice = newSellingPrice;
          changed = true;
        }

        if (batch.bulkSellingPrice !== bulkSellingPrice) {
          batch.bulkSellingPrice = bulkSellingPrice;
          changed = true;
        }

        if (change.effectiveDate && batch.sellingPriceEffectiveDate !== change.effectiveDate) {
          batch.sellingPriceEffectiveDate = change.effectiveDate;
          changed = true;
        }

        if (batch.sellingPriceChangeId !== change.id) {
          batch.sellingPriceChangeId = change.id;
          changed = true;
        }
      });
    });

  return changed;
}

function resolveCurrentSellingPrice(productOrProductId, saleUnit = "base") {
  const product = typeof productOrProductId === "string"
    ? state.products.find((item) => item.id === productOrProductId)
    : productOrProductId;

  if (!product) {
    return 0;
  }

  if (isAuthoritativeV2Product(product) && product.pricingStatus === "approved") {
    const basePricePesewas = Number(product.sellingPricePesewas);
    const unitsPerBulk = Number(product.unitsPerBulk || 1);
    const bulkPricePesewas = Number(product.bulkSellingPricePesewas);
    if (Number.isSafeInteger(basePricePesewas) && basePricePesewas > 0) {
      if (saleUnit === "base") return basePricePesewas / 100;
      if (Number.isSafeInteger(bulkPricePesewas) && bulkPricePesewas > 0) return bulkPricePesewas / 100;
      if (Number.isSafeInteger(unitsPerBulk) && unitsPerBulk > 0) return (basePricePesewas * unitsPerBulk) / 100;
    }
    return 0;
  }

  const unitsPerBulk = Number(product.unitsPerBulk || 1) > 0 ? Number(product.unitsPerBulk || 1) : 1;
  const sellableBatches = getSellableBatches(product.id)
    .slice()
    .sort((left, right) => getPriceReferenceTime(right) - getPriceReferenceTime(left));

  for (const batch of sellableBatches) {
    const unitPrice = Number(batch.unitSellingPrice || 0);

    if (Number.isFinite(unitPrice) && unitPrice > 0) {
      return saleUnit === "bulk" ? unitPrice * unitsPerBulk : unitPrice;
    }

    const bulkPrice = Number(batch.bulkSellingPrice || 0);

    if (Number.isFinite(bulkPrice) && bulkPrice > 0) {
      return saleUnit === "bulk" ? bulkPrice : bulkPrice / unitsPerBulk;
    }
  }

  const productUnitPrice = Number(product.sellingPrice || 0);

  if (Number.isFinite(productUnitPrice) && productUnitPrice > 0) {
    return saleUnit === "bulk" ? productUnitPrice * unitsPerBulk : productUnitPrice;
  }

  const productBulkPrice = Number(product.bulkSellingPrice || 0);

  if (Number.isFinite(productBulkPrice) && productBulkPrice > 0) {
    return saleUnit === "bulk" ? productBulkPrice : productBulkPrice / unitsPerBulk;
  }

  return 0;
}

function syncProductSellingPricesFromStock() {
  let changed = false;

  state.products.forEach((product) => {
    if (isAuthoritativeV2Product(product)) return;
    const unitPrice = resolveCurrentSellingPrice(product, "base");

    if (unitPrice > 0) {
      const bulkPrice = unitPrice * (Number(product.unitsPerBulk || 1) > 0 ? Number(product.unitsPerBulk || 1) : 1);

      if (product.sellingPrice !== unitPrice) {
        product.sellingPrice = unitPrice;
        changed = true;
      }

      if (product.bulkSellingPrice !== bulkPrice) {
        product.bulkSellingPrice = bulkPrice;
        changed = true;
      }
    }
  });

  return changed;
}

function replaceStockReceipts(receipts = []) {
  state.stockReceipts = receipts;
  rebuildStockFromCloudReceipts();
  saveState();
}

function replacePriceChanges(priceChanges = []) {
  state.priceChanges = Array.isArray(priceChanges) ? priceChanges : [];
  const changed = applyPriceChangeHistoryToStock() || syncProductSellingPricesFromStock();
  if (changed) {
    saveState();
    return;
  }
  saveState();
}

function replaceSales(sales = []) {
  state.sales = sales;
  rebuildStockFromCloudReceipts();
  saveState();
}

function replaceStockAdjustments(adjustments = []) {
  state.stockAdjustments = Array.isArray(adjustments) ? adjustments : [];
  rebuildStockFromCloudReceipts();
  saveState();
}

function replaceStocktakeSessions(sessions = []) {
  state.stocktakeSessions = Array.isArray(sessions) ? sessions : [];
  saveState();
}

function replaceWeeklyStocktakingSettings(settings = null) {
  state.weeklyStocktakingSettings = settings;
  saveState();
}

function setAuthoritativeStockBatchStatus(status, error = null) {
  const previous = state.authoritativeStockBatches || {};
  state.authoritativeStockBatches = {
    status,
    batches: status === "ready" ? (previous.batches || []) : [],
    error: error ? String(error.message || error) : null
  };
}

function replaceAuthoritativeStockBatches(batches = []) {
  state.authoritativeStockBatches = {
    status: "ready",
    batches: Array.isArray(batches) ? batches : [],
    error: null
  };
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
  saveState();
}

function replaceSupplierPayments(payments = []) {
  state.supplierPayments = Array.isArray(payments) ? payments : [];
  saveState();
}

function stopCloudListeners() {
  if (stopProductsListener) {
    stopProductsListener();
    stopProductsListener = null;
  }

  if (stopPriceChangesListener) {
    stopPriceChangesListener();
    stopPriceChangesListener = null;
  }

  if (stopStockReceiptsListener) {
    stopStockReceiptsListener();
    stopStockReceiptsListener = null;
  }

  if (stopStockBatchesListener) {
    stopStockBatchesListener();
    stopStockBatchesListener = null;
  }

  if (stopSalesListener) {
    stopSalesListener();
    stopSalesListener = null;
  }

  if (stopStockAdjustmentsListener) {
    stopStockAdjustmentsListener();
    stopStockAdjustmentsListener = null;
  }

  if (stopStocktakeSessionsListener) {
    stopStocktakeSessionsListener();
    stopStocktakeSessionsListener = null;
  }
  if (stopWeeklyStocktakingSettingsListener) {
    stopWeeklyStocktakingSettingsListener();
    stopWeeklyStocktakingSettingsListener = null;
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
  const listenerNames = [
    "Product",
    "Price change",
    "Stock receipt",
    "Stock batch",
    "Sales",
    "Stock adjustment",
    "Stocktake session",
    "Stocktaking schedule",
    ...(canSyncAllUsers() ? ["User"] : []),
    "Supplier",
    "Supplier payment"
  ];
  startCloudListenerTracking(listenerNames);
  setAuthoritativeStockBatchStatus("loading");
  saveState();
  await migrateLocalProductsToCloudOnce();
  await migrateLocalSuppliersToCloudOnce();

  const syncUsers = canSyncAllUsers();

  const [cloudProducts, cloudPriceChanges, cloudReceipts, cloudSales, cloudAdjustments, cloudWeeklyStocktakingSettings, cloudStockBatches, cloudUsers, cloudSuppliers, cloudSupplierPayments] = await Promise.all([
    fetchProductsFromCloud(),
    fetchPriceChangesFromCloud(),
    fetchStockReceiptsFromCloud(),
    fetchSalesFromCloud(),
    fetchStockAdjustmentsFromCloud(),
    fetchWeeklyStocktakingSettingsFromCloud(),
    fetchStockBatchesFromCloud(),
    syncUsers ? fetchUsersFromCloud() : Promise.resolve([]),
    fetchSuppliersFromCloud(),
    fetchSupplierPaymentsFromCloud()
  ]);

  if (cloudProducts.length > 0 || forceReplaceProducts) {
    replaceProducts(cloudProducts);
  }

  replacePriceChanges(cloudPriceChanges);
  replaceStockReceipts(cloudReceipts);
  replaceSales(cloudSales);
  replaceStockAdjustments(cloudAdjustments);
  replaceWeeklyStocktakingSettings(cloudWeeklyStocktakingSettings);
  replaceAuthoritativeStockBatches(cloudStockBatches);
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
    (products, metadata) => {
      replaceProducts(products);
      markCloudUpdated("Products synced", { listenerName: "Product", fromCache: metadata.fromCache });
    },
    (error) => {
      handleCloudListenerError("Product", error);
    }
  );

  stopPriceChangesListener = listenToPriceChanges(
    (priceChanges, metadata) => {
      replacePriceChanges(priceChanges);
      markCloudUpdated("Price changes synced", { listenerName: "Price change", fromCache: metadata.fromCache });
    },
    (error) => {
      handleCloudListenerError("Price change", error);
    }
  );

  stopStockReceiptsListener = listenToStockReceipts(
    (receipts, metadata) => {
      replaceStockReceipts(receipts);
      markCloudUpdated("Stock synced", { listenerName: "Stock receipt", fromCache: metadata.fromCache });
    },
    (error) => {
      handleCloudListenerError("Stock receipt", error);
    }
  );

  stopStockBatchesListener = listenToStockBatches(
    (batches, metadata) => {
      if (metadata.fromCache) {
        // A cache snapshot may be partial or stale. Do not present it as a
        // confirmed authoritative batch ledger while waiting for the server.
        setAuthoritativeStockBatchStatus("loading");
        saveState();
      } else {
        replaceAuthoritativeStockBatches(batches);
      }
      markCloudUpdated("Authoritative stock batches synced", { listenerName: "Stock batch", fromCache: metadata.fromCache });
    },
    (error) => {
      setAuthoritativeStockBatchStatus("error", error);
      saveState();
      handleCloudListenerError("Stock batch", error);
    }
  );

  stopSalesListener = listenToSales(
    (sales, metadata) => {
      replaceSales(sales);
      markCloudUpdated("Sales synced", { listenerName: "Sales", fromCache: metadata.fromCache });
    },
    (error) => {
      handleCloudListenerError("Sales", error);
    }
  );

  stopStockAdjustmentsListener = listenToStockAdjustments(
    (adjustments, metadata) => {
      replaceStockAdjustments(adjustments);
      markCloudUpdated("Stock adjustments synced", { listenerName: "Stock adjustment", fromCache: metadata.fromCache });
    },
    (error) => handleCloudListenerError("Stock adjustment", error)
  );

  stopStocktakeSessionsListener = listenToStocktakeSessions(
    (sessions, metadata) => {
      replaceStocktakeSessions(sessions);
      markCloudUpdated("Stocktaking sessions synced", { listenerName: "Stocktake session", fromCache: metadata.fromCache });
    },
    (error) => handleCloudListenerError("Stocktake session", error)
  );

  stopWeeklyStocktakingSettingsListener = listenToWeeklyStocktakingSettings(
    (settings, metadata) => {
      replaceWeeklyStocktakingSettings(settings);
      markCloudUpdated("Stocktaking schedule synced", { listenerName: "Stocktaking schedule", fromCache: metadata.fromCache });
    },
    (error) => handleCloudListenerError("Stocktaking schedule", error)
  );

  if (syncUsers) {
    stopUsersListener = listenToUsers(
      (users, metadata) => {
        replaceUsers(users);
        markCloudUpdated("Users synced", { listenerName: "User", fromCache: metadata.fromCache });
      },
      (error) => {
        handleCloudListenerError("User", error);
      }
    );
  }

  stopSuppliersListener = listenToSuppliers(
    (suppliers, metadata) => {
      replaceSuppliers(suppliers);
      markCloudUpdated("Suppliers synced", { listenerName: "Supplier", fromCache: metadata.fromCache });
    },
    (error) => {
      handleCloudListenerError("Supplier", error);
    }
  );

  stopSupplierPaymentsListener = listenToSupplierPayments(
    (payments, metadata) => {
      replaceSupplierPayments(payments);
      markCloudUpdated("Supplier payments synced", { listenerName: "Supplier payment", fromCache: metadata.fromCache });
    },
    (error) => {
      handleCloudListenerError("Supplier payment", error);
    }
  );
}

function isReadyForProtectedCloudSync() {
  return Boolean(state.user?.uid);
}

async function ensureAuthenticatedCloudSync() {
  if (!isReadyForProtectedCloudSync()) {
    stopCloudListeners();
    setCloudIdleStatus("Sign in to sync data");
    return false;
  }

  if (!cloudSyncPromise) {
    cloudSyncPromise = (async () => {
      try {
        setCloudStatus({ connected: false, isConnecting: true, isReconnecting: cloudStatus.isReconnecting, message: "Connecting to Firestore" });
        await startCloudProductSync();
        return true;
      } catch (error) {
        setCloudStatus({
          connected: false,
          isConnecting: false,
          isReconnecting: false,
          message: "Cloud sync needs attention",
          failedListenerNames: ["Cloud sync"]
        });
        logAppError("Cloud startup sync failed", error);
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

  let initialSyncFinished = false;
  const initialSync = ensureAuthenticatedCloudSync().finally(() => {
    initialSyncFinished = true;
  });

  return Promise.race([
    initialSync,
    wait(INITIAL_SYNC_WAIT_MS).then(() => {
      if (initialSyncFinished) {
        return true;
      }

      // Keep listener tracking intact: the startup request can still receive
      // a server-confirmed snapshot after the shell becomes available.
      setCloudStatus({
        connected: false,
        isConnecting: false,
        isReconnecting: false,
        message: "Syncing in background"
      });
      return false;
    })
  ]);
}

const dashboardNavItems = [
  { page: "dashboard", icon: "⌂", title: "Dashboard" },
  { page: "sales", icon: "🛒", title: "Sales (POS)" },
  { page: "inventory", icon: "▣", title: "Inventory" },
  { page: "receiveStock", icon: "⇩", title: "Receive Stock" },
  { page: "addProduct", icon: "＋", title: "Products" },
  { page: "stockAdjustment", icon: "🧯", title: "Stock Adjustment" },
  { page: "supplierPayment", icon: "🧾", title: "Supplier Payment" },
  { page: "suppliers", icon: "♧", title: "Suppliers" },
  { page: "priceChanges", icon: "₵", title: "Price Changes" },
  { page: "reports", icon: "▥", title: "Reports" },
  { page: "stocktakingPrototype", icon: "✓", title: "Weekly stocktaking" },
  { page: "receiptDeliveryPrototype", icon: "✉", title: "Receipt delivery prototype" },
  { page: "categorySettings", icon: "◇", title: "Categories" },
  { page: "taxSettings", icon: "⚙", title: "Settings" },
  { page: "printerSettings", icon: "🖨", title: "Printer" },
  { page: "staff", icon: "♙", title: "Staff" },
  { page: "help", icon: "?", title: "Help" },
  { page: "logout", icon: "⇥", title: "Sign Out" }
];

function canAccessPage(page) {
  return canAccessPageWithPermission(page, hasPermission);
}

function hasPendingRequiredPasswordChange() {
  return isPasswordChangeRequired(state.sessionUser);
}

function navigate(page) {
  page = normalizeNavigationPage(page);

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
      <button onclick="navigate('dashboard')">Back to Dashboard</button>
    `);
    return;
  }

  currentPage = page;
  renderShell();

  if (page === "dashboard" || page === "reports") window["renderDashboard"]?.();
  if (page === "addProduct") window.renderAddProduct?.();
  if (page === "receiveStock") window.renderReceiveStock?.();
  if (page === "supplierPayment") window.renderSupplierPayment?.();
  if (page === "priceChanges") window.renderSellingPriceChanges?.();
  if (page === "printerSettings") window.refreshPrinterSettings?.();
  if (page === "stockAdjustment") window.renderStockAdjustment?.();
  if (page === "suppliers") window.renderSuppliers?.();
  if (page === "categorySettings") window.renderCategorySettings?.();
  if (page === "taxSettings") window.renderTaxSettings?.();
  if (page === "sales") window.renderSales?.();
  if (page === "inventory") window.renderInventory?.();
  if (page === "staff") window.renderStaff?.();
  if (page === "help") window.renderHelp?.();
  if (page === "stocktakingPrototype") window["renderStocktakingPrototype"]?.();
  if (page === "receiptDeliveryPrototype") window["renderReceiptDeliveryPrototype"]?.();
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
        <img class="splash-logo" src="/Kay-Flo.png" alt="Kay-Flo Enterprise">
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
    navigate("dashboard");
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
      <aside class="login-brand-panel" aria-label="Kay-Flo Enterprise">
        <img class="login-brand-logo" src="/jyaanc-kente-hat-logo.png" alt="Jyaano logo featuring a Ghanaian Kente hat">
        <div class="login-brand-copy">
          <p>Inventory made practical</p>
          <h1>Making your business profitable</h1>
          <span>Track every pesewa by managing stock, sales, suppliers, and receipts from one secure workspace.</span>
        </div>
        <div class="login-brand-highlights" aria-label="Application features">
          <span><b aria-hidden="true">✓</b>Stock control</span>
          <span><b aria-hidden="true">✓</b>Fast sales</span>
          <span><b aria-hidden="true">✓</b>Every Device</span>
        </div>
      </aside>

        <div class="login-panel">
        <div class="login-panel-heading">
          <p class="login-enterprise-name">Kay-Flo Enterprise</p>
          <h2>Welcome back</h2>
          <p>Sign in to continue to your dashboard.</p>
        </div>

        ${error ? `<div class="message error">${error}</div>` : ""}

        <form class="form-column" onsubmit="login(event)">
          <div class="form-row">
            <label for="identifier">Staff email address</label>
            <input id="identifier" type="email" autocomplete="email" placeholder="you@company.com">
          </div>

          <div class="form-row">
            <label for="password">Password</label>
            <input id="password" type="password" autocomplete="current-password">
          </div>

          <button class="login-submit" type="submit">Sign in <span aria-hidden="true">→</span></button>
        </form>
        <p class="login-security-note"><span aria-hidden="true">🔒</span> Your account is protected by secure staff authentication.</p>
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

    <form class="form-column panel" onsubmit="completeRequiredPasswordChange(event)">
      <div class="form-row">
        <label for="newPassword">New Password</label>
        <input id="newPassword" type="password" autocomplete="new-password">
      </div>

      <div class="form-row">
        <label for="confirmPassword">Confirm Password</label>
        <input id="confirmPassword" type="password" autocomplete="new-password">
      </div>

      <button id="completePasswordChangeButton" type="submit">Save New Password</button>
      <button type="button" onclick="navigate('logout')">Sign Out</button>
    </form>
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

async function login(event) {
  event?.preventDefault?.();
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
    navigate("dashboard");
  } catch (error) {
    logAppError("Login failed", error);
    renderLogin(toUserMessage(error, "Unable to sign in. Check the email and password, then try again."));
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
    throw createAppError("Use the staff email address to sign in.", {
      code: "auth/email-required",
      source: ERROR_FLAGS.SOURCE_VALIDATION
    });
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
    logAppError("Logout failed", error);
  }

  stopCloudListeners();
  state.user = null;
  state.sessionUser = null;
  saveState();
  setCloudIdleStatus("Sign in to sync data");
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
  try {
    state.settings = {
      ...(state.settings || {}),
      categories: await fetchCategorySettingsFromCloud(),
      tax: await fetchTaxSettingsFromCloud()
    };
    saveState();
  } catch (error) {
    logAppError("Tax settings sync failed", error);
  }

  const sessionUser = buildSessionUser(profile);
  state.user = sessionUser;
  state.sessionUser = profile;
  saveState();
  return true;
}

async function completeRequiredPasswordChange(event) {
  event?.preventDefault?.();
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
    navigate("dashboard");
  } catch (error) {
    logAppError("Required password change failed", error);
    renderRequiredPasswordChange(toUserMessage(error, "Unable to change the password. Check the new password and try again."));
  }
}

function renderShell() {
  renderDashboardShell();
}

function renderDashboardShell() {
  const permittedNavItems = dashboardNavItems.filter((item) => canAccessPage(item.page));
  const primaryMobileItems = [
    { page: "dashboard", icon: "⌂", title: "Home" },
    { page: "sales", icon: "🛒", title: "Sales" },
    { page: "inventory", icon: "▣", title: "Stock" },
    { page: "reports", icon: "▥", title: "Reports" }
  ].filter((item) => canAccessPage(item.page));
  const mobileMoreItems = permittedNavItems.filter((item) => !primaryMobileItems.some((primaryItem) => primaryItem.page === item.page));
  const mobileMoreActive = !primaryMobileItems.some((item) => item.page === currentPage);
  const displayName = state.user?.fullName || state.user?.username || state.user?.email || "User";
  const initial = escapeShellHtml(displayName.trim().charAt(0).toUpperCase() || "U");

  app.innerHTML = `
    <div class="jyaano-app-shell">
      <aside class="jyaano-sidebar" aria-label="Primary navigation">
        <div class="jyaano-wordmark"><img src="/jyaanc-kente-hat-logo.png" alt="Jyaano logo featuring a Ghanaian Kente hat"></div>
        <nav class="jyaano-nav">${permittedNavItems.map((item) => `<button class="${item.page === currentPage ? "is-active" : ""}" ${item.page === currentPage ? 'aria-current="page"' : ""} type="button" onclick="navigate('${item.page}')"><span aria-hidden="true">${item.icon}</span>${item.title}</button>`).join("")}</nav>
      </aside>
      <section class="jyaano-stage">
        <header class="jyaano-topbar">
          ${currentPage === DASHBOARD_PAGE ? '<span id="dashboardConnectionBadge" class="jyaano-connection-badge" role="status" aria-live="polite" aria-atomic="true"><span class="jyaano-connection-badge-dot" aria-hidden="true"></span><span class="jyaano-connection-badge-label"></span></span>' : ""}
          <div class="jyaano-user"><span>${initial}</span><div><strong>${escapeShellHtml(displayName)}</strong><small>${escapeShellHtml(state.user?.role || "Staff")}</small></div><button type="button" onclick="navigate('dashboard')" aria-label="Go to Dashboard">⌂</button></div>
        </header>
        <main id="page"></main>
      </section>
      <nav class="jyaano-mobile-nav" aria-label="Mobile navigation">
        ${primaryMobileItems.map((item) => `<button class="${item.page === currentPage ? "is-active" : ""}" ${item.page === currentPage ? 'aria-current="page"' : ""} type="button" onclick="navigate('${item.page}')"><span aria-hidden="true">${item.icon}</span><small>${item.title}</small></button>`).join("")}
        <button class="${mobileMoreActive ? "is-active" : ""}" type="button" aria-expanded="false" aria-controls="mobileMoreSheet" onclick="toggleMobileMore()"><span aria-hidden="true">•••</span><small>More</small></button>
      </nav>
      <div id="mobileMoreSheet" class="jyaano-mobile-more hidden" role="dialog" aria-modal="true" aria-label="More navigation options">
        <button class="jyaano-mobile-more-backdrop" type="button" aria-label="Close more menu" onclick="toggleMobileMore(false)"></button>
        <section class="jyaano-mobile-more-panel">
          <div class="jyaano-mobile-more-heading"><h2>More</h2><button type="button" aria-label="Close more menu" onclick="toggleMobileMore(false)">×</button></div>
          <div class="jyaano-mobile-more-list">${mobileMoreItems.map((item) => `<button type="button" onclick="navigateFromMobileMore('${item.page}')"><span aria-hidden="true">${item.icon}</span>${item.title}<b aria-hidden="true">›</b></button>`).join("")}</div>
        </section>
      </div>
    </div>
  `;
  updateDashboardConnectionBadge();
}

function toggleMobileMore(forceOpen) {
  const sheet = document.getElementById("mobileMoreSheet");
  const trigger = document.querySelector(".jyaano-mobile-nav button:last-child");
  if (!sheet) return;
  const open = typeof forceOpen === "boolean" ? forceOpen : sheet.classList.contains("hidden");
  sheet.classList.toggle("hidden", !open);
  trigger?.setAttribute("aria-expanded", String(open));
  document.body.classList.toggle("mobile-menu-open", open);
}

function navigateFromMobileMore(page) {
  toggleMobileMore(false);
  navigate(page);
}

function escapeShellHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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
  const product = state.products.find((candidate) => candidate.id === productId);

  if (isAuthoritativeV2Product(product)) {
    return getAuthoritativeDisplayBatches(state, productId)
      .filter((batch) => Number(batch.remainingBaseQuantity || 0) > 0);
  }

  return Array.isArray(state.stock)
    ? state.stock.filter((batch) => batch.productId === productId && (batch.quantity || 0) > 0)
    : [];
}

function getDisplayStockBatches() {
  const productsById = new Map(state.products.map((product) => [product.id, product]));
  const legacyBatches = Array.isArray(state.stock)
    ? state.stock.filter((batch) => shouldUseLegacyStockReconstruction(productsById.get(batch.productId)))
    : [];
  return [...legacyBatches, ...getAuthoritativeDisplayBatches(state)];
}

function getSellableBatches(productId) {
  return getBatchesByProductId(productId).filter((batch) => !isBatchExpired(batch.expiryDate) && (!batch.inventoryStatus || batch.inventoryStatus === "active"));
}

function getExpiredBatches(productId) {
  return getBatchesByProductId(productId).filter((batch) => isBatchExpired(batch.expiryDate));
}

function getBatchQuantityTotal(batches) {
  return batches.reduce((sum, batch) => sum + (Number(batch.quantity) || 0), 0);
}

function getSellableStockQuantity(productId) {
  const product = state.products.find((candidate) => candidate.id === productId);
  if (isAuthoritativeV2Product(product)) return getSellableQuantity(product);
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
    if (isAuthoritativeV2Product(product)) return;
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
    if (isAuthoritativeV2Product(product)) return;
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
  const product = state.products.find((candidate) => candidate.id === productId);
  if (isAuthoritativeV2Product(product)) {
    throw createAppError("Authoritative v2 stock can only be allocated by the secure checkout service.", {
      code: "inventory/authoritative-v2-client-deduction-blocked",
      source: ERROR_FLAGS.SOURCE_VALIDATION
    });
  }
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
    throw createAppError("Not enough sellable stock is available in unexpired batches. Receive fresh stock or reduce the sale quantity.", {
      code: "inventory/insufficient-unexpired-stock",
      source: ERROR_FLAGS.SOURCE_VALIDATION
    });
  }

  syncProductQuantities();

  return allocations;
}

async function refreshFromCloud() {
  if (!isReadyForProtectedCloudSync()) {
    setCloudIdleStatus("Sign in to refresh data");
    navigate("login");
    return false;
  }

  const pageToRefresh = currentPage;

  try {
    setCloudStatus({ connected: false, isConnecting: true, isReconnecting: false, message: "Refreshing from Firestore" });
    await startCloudProductSync({ forceReplaceProducts: true });
    navigate(pageToRefresh);
    return true;
  } catch (error) {
    setCloudStatus({
      connected: false,
      isConnecting: false,
      isReconnecting: false,
      message: "Cloud refresh needs attention",
      failedListenerNames: ["Cloud refresh"]
    });
    logAppError("Cloud refresh failed", error);
    alert(toUserMessage(error, "Unable to refresh from Firebase right now. Please check your connection and try again."));
    return false;
  }
}

function printReceipt() {
  window.print();
}

function printMptReceipt() {
  document.body.classList.add("printing-mpt-receipt");

  window.print();

  setTimeout(() => {
    document.body.classList.remove("printing-mpt-receipt");
  }, 500);
}

function printModalReport() {
  if (!canAccessPage("reports")) {
    return;
  }

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
  getDisplayStockBatches,
  getSellableBatches,
  getExpiredBatches,
  parseExpiryDate,
  getExpiredStockQuantity,
  getSellableStockQuantity,
  getPhysicalQuantity,
  getSellableQuantity,
  getAuthoritativeBatchStatus: () => getAuthoritativeBatchStatus(state),
  syncProductQuantities,
  allocateStockFromBatches,
  createStockBatchId,
  isBatchExpired,
  getCurrentDateTimeValue: window.getCurrentDateTimeValue,
  openModal,
  closeModal,
  refreshFromCloud
  ,
  getCurrentPage: () => currentPage,
  resolveCurrentSellingPrice,
  syncProductSellingPricesFromStock
};

window.navigate = navigate;
window.login = login;
window.completeRequiredPasswordChange = completeRequiredPasswordChange;
window.closeModal = closeModal;
window.printReceipt = printReceipt;
window.printMptReceipt = printMptReceipt;
window.printModalReport = printModalReport;
window.refreshFromCloud = refreshFromCloud;
/** @type {any} */ (window).toggleMobileMore = toggleMobileMore;
/** @type {any} */ (window).navigateFromMobileMore = navigateFromMobileMore;

renderSplash();

const receiptModule = await import("./services/receiptService.js");
window.app.formatReceiptCurrency = receiptModule.formatReceiptCurrency;

await import("./pages/addProduct.js");
await import("./pages/receiveStock.js");
await import("./pages/supplierPayment.js");
await import("./pages/sellingPriceChanges.js");
await import("./pages/printerSettings.js");
await import("./pages/stockAdjustment.js");
await import("./pages/suppliers.js");
await import("./pages/categorySettings.js");
await import("./pages/taxSettings.js");
await import("./pages/sales.js");
await import("./pages/inventory.js");
await import("./pages/dashboard.js");
await import("./pages/staff.js");
await import("./pages/help.js");
await import("./pages/stocktakingPrototype.js");
await import("./pages/receiptDeliveryPrototype.js");

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
      setCloudIdleStatus("Sign in to sync data");
      authReadyResolver?.();
      authReadyResolver = null;
      return;
    }

    await syncAuthenticatedUser(firebaseUser.uid);
    void ensureAuthenticatedCloudSync();
  } catch (error) {
    logAppError("Auth state sync failed", error);
    stopCloudListeners();
    state.user = null;
    state.sessionUser = null;
    saveState();
    setCloudIdleStatus("Sign in to sync data");
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
    setCloudIdleStatus("Ready");
  }

  renderCurrentEntryPage();
}

window.addEventListener("online", () => {
  setCloudStatus({
    connected: false,
    isConnecting: true,
    isReconnecting: true,
    message: "Reconnecting to Firestore",
    confirmedListenerNames: [],
    failedListenerNames: []
  });
  void retryPendingSalesSync();
  void ensureAuthenticatedCloudSync();
});

window.addEventListener("offline", () => {
  setCloudStatus({ connected: false, isConnecting: false, isReconnecting: false, message: "Offline mode" });
});

const salesSyncIntervalMs = Math.max(state.settings?.salesSyncIntervalMs || 30000, 5000);
setInterval(() => {
  void retryPendingSalesSync();
}, salesSyncIntervalMs);

void bootApp();
