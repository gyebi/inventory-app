import { getState, setState } from "../state.js";

export const createProductId = () => {
  return `prod_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
};

export const getProductById = (productId) => {
  return getState().products.find((product) => product.id === productId);
};

export const addProduct = (product) => {
  const state = getState();
  const normalizedName = product.name.trim().toLowerCase();

  const exists = state.products.find(
    (p) => p.name.trim().toLowerCase() === normalizedName
  );

  if (exists) {
    throw new Error("Product already exists");
  }

  state.products.push({
    ...product,
    id: product.id || createProductId()
  });

  setState(state);
};
