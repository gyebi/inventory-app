import { loadState, saveState } from "./storage/localStorageService.js";

function sanitizeUsers(users = []) {
  return users
    .filter((user) => user && typeof user === "object")
    .map((user) => ({
      id: user.id || user.uid || "",
      uid: user.uid || user.id || "",
      fullName: user.fullName || user.displayName || user.username || user.email || "",
      username: user.username || "",
      email: user.email || "",
      role: user.role || "sales",
      active: user.active !== false && user.isActive !== false,
      isActive: user.active !== false && user.isActive !== false,
      pendingAuthCreation: user.pendingAuthCreation === true,
      createdAt: user.createdAt || null,
      createdBy: user.createdBy || null,
      mustChangePassword: user.mustChangePassword === true,
      credentialSetupMode: user.credentialSetupMode || null
    }))
    .filter((user) => user.id || user.email || user.username || user.fullName);
}

const defaultState = {
  user: null,
  users: [],

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

let state = loadState() || defaultState;

state.users = sanitizeUsers(state.users);

export const getState = () => state;

export const setState = (newState) => {
  state = newState;
  saveState(state);
};

if (!state.suppliers) {
  state.suppliers = [];
}

if (!Array.isArray(state.stock)) {
  state.stock = [];
}

if (!state.stockReceipts) {
  state.stockReceipts = [];
}

if (!state.settings) {
  state.settings = defaultState.settings;
}
