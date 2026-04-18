import { getState, setState } from "../state.js";

const generateId = () => "sale_" + Date.now();

export const createSale = (cartItems) => {
  const state = getState();

  if (!cartItems.length) {
    throw new Error("Cart is empty");
  }

  let totalAmount = 0;
  let totalProfit = 0;

  // Validate and process each item
  cartItems.forEach(item => {
    const product = state.products.find(p => p.id === item.productId);

    if (!product) {
      throw new Error(`Product not found: ${item.productId}`);
    }

    // Check stock
    if (product.quantity < item.quantity) {
      throw new Error(`Not enough stock for ${product.name}`);
    }

    // Calculate totals
    const itemTotal = item.quantity * product.sellingPrice;
    const itemProfit =
      (product.sellingPrice - product.costPrice) * item.quantity;

    totalAmount += itemTotal;
    totalProfit += itemProfit;

    // Deduct stock
    product.quantity -= item.quantity;
  });

  // Create sale object
  const sale = {
    id: generateId(),
    items: cartItems,
    totalAmount,
    profit: totalProfit,
    createdAt: new Date().toISOString(),
    user: state.user?.username || "unknown"
  };

  // Save sale
  state.sales.push(sale);

  setState(state);

  return sale;
};