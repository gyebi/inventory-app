const STORAGE_KEY = "inventory_app";

export const loadState = () => {
  const data = localStorage.getItem(STORAGE_KEY);
  return data ? JSON.parse(data) : null;
};

export const saveState = (state) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
};

export const clearState = () => {
  localStorage.removeItem(STORAGE_KEY);
};