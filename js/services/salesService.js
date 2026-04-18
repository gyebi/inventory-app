import { getState, setState } from "../state.js";
import { getDisplayUnit, toBaseUnit } from "../utils/unitConverter.js";
import { getCurrentUser } from "./authService.js";

const createSaleId = () => {
  return `sale_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
};

const parseExpiryDate = (value) => {
  if (!value) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T23:59:59.999`);
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const isBatchExpired = (expiryDate) => {
  const parsedExpiry = parseExpiryDate(expiryDate);
  return parsedExpiry ? parsedExpiry < new Date() : false;
};

const getSellableBatches = (stockBatches, productId) => {
  return stockBatches
    .filter((batch) => batch.productId === productId && (batch.quantity || 0) > 0 && !isBatchExpired(batch.expiryDate))
    .sort((left, right) => {
      const leftExpiry = parseExpiryDate(left.expiryDate);
      const rightExpiry = parseExpiryDate(right.expiryDate);
      const leftTime = leftExpiry ? leftExpiry.getTime() : Number.MAX_SAFE_INTEGER;
      const rightTime = rightExpiry ? rightExpiry.getTime() : Number.MAX_SAFE_INTEGER;

      if (leftTime !== rightTime) {
        return leftTime - rightTime;
      }

      return new Date(left.receivedAt || 0).getTime() - new Date(right.receivedAt || 0).getTime();
    });
};

const allocateBatchStock = (sellableBatches, quantityToSell) => {
  let remaining = quantityToSell;
  const batchAllocations = [];

  for (const batch of sellableBatches) {
    if (remaining <= 0) {
      break;
    }

    const quantityTaken = Math.min(batch.quantity, remaining);

    if (quantityTaken <= 0) {
      continue;
    }

    batch.quantity -= quantityTaken;
    remaining -= quantityTaken;
    batchAllocations.push({
      batchId: batch.id,
      quantity: quantityTaken,
      expiryDate: batch.expiryDate || ""
    });
  }

  if (remaining > 0) {
    throw new Error("Not enough sellable stock available in unexpired batches.");
  }
  return batchAllocations;
};

const getUnitPrices = (product, saleUnitType) => {
  if (saleUnitType === "bulk") {
    return {
      unitCostPrice: product.bulkCostPrice ?? (product.costPrice * product.unitsPerBulk),
      unitSellingPrice: product.bulkSellingPrice ?? (product.sellingPrice * product.unitsPerBulk)
    };
  }

  return {
    unitCostPrice: product.costPrice,
    unitSellingPrice: product.sellingPrice
  };
};

const resolveSaleUnitType = (product, unit) => {
  if (unit === "bulk" || unit === product.bulkUnit) {
    return "bulk";
  }

  if (unit === "base" || unit === product.baseUnit) {
    return "base";
  }

  throw new Error(`Invalid unit: ${unit}`);
};

export const createSale = (cartItems = []) => {
  const state = getState();
  const currentUser = getCurrentUser();
  const stockBatches = Array.isArray(state.stock) ? state.stock : [];
  const items = [];
  let totalAmount = 0;
  let profit = 0;

  if (!Array.isArray(cartItems) || cartItems.length === 0) {
    throw new Error("Add at least one item before recording a sale.");
  }

  for (const cartItem of cartItems) {
    const { productId, quantity, unit = "base" } = cartItem;
    const product = state.products.find((item) => item.id === productId);

    if (!product) {
      throw new Error(`Product not found: ${productId}`);
    }

    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new Error("Quantity must be a whole number greater than zero.");
    }

    const normalizedSaleUnit = resolveSaleUnitType(product, unit);
    const actualQtySold = toBaseUnit(product, quantity, normalizedSaleUnit);
    const displayUnit = getDisplayUnit(product, unit);
    const { unitCostPrice, unitSellingPrice } = getUnitPrices(product, normalizedSaleUnit);
    const sellableBatches = getSellableBatches(stockBatches, product.id);
    const sellableQuantity = sellableBatches.reduce((sum, batch) => sum + (batch.quantity || 0), 0);

    if (actualQtySold > sellableQuantity) {
      throw new Error(`Not enough sellable stock available for ${product.name}. Current sellable stock is ${sellableQuantity} ${product.baseUnit}(s).`);
    }

    const itemTotal = unitSellingPrice * quantity;
    const itemProfit = (unitSellingPrice - unitCostPrice) * quantity;
    const batchAllocations = allocateBatchStock(sellableBatches, actualQtySold);

    product.quantity = getSellableBatches(stockBatches, product.id).reduce(
      (sum, batch) => sum + (batch.quantity || 0),
      0
    );

    items.push({
      productId: product.id,
      name: product.name,
      quantity,
      saleUnit: normalizedSaleUnit,
      unit: displayUnit,
      unitPrice: unitSellingPrice,
      total: itemTotal,
      actualQtySold,
      batchAllocations
    });

    totalAmount += itemTotal;
    profit += itemProfit;
  }

  const primaryItem = items[0];

  const sale = {
    id: createSaleId(),
    productId: items.length === 1 ? primaryItem.productId : null,
    product: items.length === 1 ? primaryItem.name : "Multiple Items",
    qty: items.length === 1 ? primaryItem.quantity : items.length,
    saleUnit: items.length === 1 ? primaryItem.unit : "items",
    saleUnitType: items.length === 1 ? primaryItem.saleUnit : "mixed",
    actualQtySold: items.reduce((sum, item) => sum + item.actualQtySold, 0),
    items,
    totalAmount,
    profit,
    createdAt: new Date().toISOString(),
    createdBy: currentUser
      ? {
          username: currentUser.username,
          role: currentUser.role
        }
      : null,
    user: currentUser?.username || "unknown"
  };

  state.sales.push(sale);
  setState(state);

  return sale;
};

export const recordSale = ({ productId, quantity, saleUnit }) => {
  const product = getState().products.find((item) => item.id === productId);

  return createSale([
    {
      productId,
      quantity,
      unit: saleUnit === "bulk"
        ? (product?.bulkUnit || "bulk")
        : (product?.baseUnit || "base")
    }
  ]);
};
