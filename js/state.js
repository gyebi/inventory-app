import { loadState, saveState } from "./storage/localStorageService.js";

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
    lowStockThreshold: 10
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

if (!state.stockReceipts) {
  state.stockReceipts = [];
}
