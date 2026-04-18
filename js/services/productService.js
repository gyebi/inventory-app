import { getState, setState } from "../state.js";

export const addProduct = (product) => {
  const state = getState();

  const exists = state.products.find(p => p.name === product.name);

  if (exists) {
    throw new Error("Product already exists");
  }

  state.products.push(product);

  setState(state);
};