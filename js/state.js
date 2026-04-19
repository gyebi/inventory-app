import { loadState, saveState } from "./storage/localStorageService.js";

const defaultUsers = [
  { id: "user_admin", fullName: "System Administrator", username: "admin", password: "1234", role: "admin", active: true },
  { id: "user_sales", fullName: "Sales Staff", username: "sales", password: "1234", role: "sales", active: true },
  { id: "user_store", fullName: "Storekeeper", username: "store", password: "1234", role: "storekeeper", active: true }
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

let state = loadState() || defaultState;

if (!Array.isArray(state.users) || state.users.length === 0) {
  state.users = defaultUsers;
}

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
