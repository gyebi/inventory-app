import { getState, setState } from "../state.js";
import { submitSaleToCloudTransaction } from "./cloudProductService.js";
import { getDisplayUnit, toBaseUnit } from "../utils/unitConverter.js";
import { createAppError, ERROR_FLAGS } from "../utils/errorUtils.js";
import { getCurrentUser } from "./authService.js";
import { buildSaleSyncMetadata, getSaleSyncStatus } from "./syncService.js";
import { isSecureSalesEnabled, quoteSecureCheckout, submitSecureCheckout } from "./secureCheckoutService.js";
import { quoteOpeningStockCheckout, submitOpeningStockCheckout } from "./openingStockCheckoutService.js";

const createSaleId = () => {
  return `CDV-${Date.now()}-${String(Math.floor(Math.random() * 1000)).padStart(3, "0")}`;
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
    throw createAppError("Not enough sellable stock is available in unexpired batches. Receive fresh stock or reduce the sale quantity.", {
      code: "inventory/insufficient-unexpired-stock",
      source: ERROR_FLAGS.SOURCE_VALIDATION
    });
  }
  return batchAllocations;
};

const previewBatchAllocations = (sellableBatches, quantityToSell) => {
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

    remaining -= quantityTaken;
    batchAllocations.push({
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

  return batchAllocations;
};

const getUnitPrices = (product, saleUnitType) => {
  const resolveCurrentSellingPrice = window.app?.resolveCurrentSellingPrice;

  if (saleUnitType === "bulk") {
    return {
      unitCostPrice: Number(product.bulkCostPrice ?? (Number(product.costPrice || 0) * Number(product.unitsPerBulk || 1))),
      unitSellingPrice: typeof resolveCurrentSellingPrice === "function"
        ? resolveCurrentSellingPrice(product, "bulk")
        : Number(product.bulkSellingPrice ?? ((product.sellingPrice || 0) * (product.unitsPerBulk || 1)))
    };
  }

  return {
    unitCostPrice: Number(product.costPrice || 0),
    unitSellingPrice: typeof resolveCurrentSellingPrice === "function"
      ? resolveCurrentSellingPrice(product, "base")
      : Number(product.sellingPrice || 0)
  };
};

const getApprovedUnitPrices = (product, saleUnitType) => {
  const prices = getUnitPrices(product, saleUnitType);

  if (!Number.isFinite(prices.unitSellingPrice) || prices.unitSellingPrice <= 0) {
    throw createAppError(`A valid approved ${saleUnitType === "bulk" ? "bulk" : "base"} selling price is required before checkout.`, {
      code: "sale/invalid-selling-price",
      source: ERROR_FLAGS.SOURCE_VALIDATION
    });
  }

  return prices;
};

const getTaxDefaults = () => ({
  enabled: true,
  vatRate: 15,
  nhilRate: 2.5,
  getfundRate: 2.5,
  withholdingVatRate: 7,
  effectiveDate: null,
  taxMode: "standard"
});

const normalizeTaxSettings = (taxSettings = {}) => {
  const defaults = getTaxDefaults();

  return {
    ...defaults,
    ...taxSettings,
    enabled: taxSettings.enabled !== false,
    vatRate: Number(taxSettings.vatRate ?? defaults.vatRate),
    nhilRate: Number(taxSettings.nhilRate ?? defaults.nhilRate),
    getfundRate: Number(taxSettings.getfundRate ?? defaults.getfundRate),
    withholdingVatRate: Number(taxSettings.withholdingVatRate ?? defaults.withholdingVatRate),
    taxMode: String(taxSettings.taxMode || defaults.taxMode),
    effectiveDate: taxSettings.effectiveDate || null
  };
};

const calculateTaxBreakdown = (subtotal, taxSettings = {}) => {
  const settings = normalizeTaxSettings(taxSettings);
  const baseAmount = Number(subtotal || 0);

  if (!settings.enabled || settings.taxMode === "exempt") {
    return {
      subtotal: baseAmount,
      vatRate: settings.vatRate,
      nhilRate: settings.nhilRate,
      getfundRate: settings.getfundRate,
      withholdingVatRate: settings.withholdingVatRate,
      vatAmount: 0,
      nhilAmount: 0,
      getfundAmount: 0,
      withholdingVatAmount: 0,
      taxAmount: 0,
      totalAmount: baseAmount,
      taxMode: settings.taxMode,
      enabled: false,
      effectiveDate: settings.effectiveDate
    };
  }

  const chargeableVatRate = settings.taxMode === "zeroRated" ? 0 : settings.vatRate;
  const chargeableNhilRate = settings.taxMode === "zeroRated" ? 0 : settings.nhilRate;
  const chargeableGetfundRate = settings.taxMode === "zeroRated" ? 0 : settings.getfundRate;
  const vatAmount = baseAmount * (chargeableVatRate / 100);
  const nhilAmount = baseAmount * (chargeableNhilRate / 100);
  const getfundAmount = baseAmount * (chargeableGetfundRate / 100);
  const withholdingVatAmount = baseAmount * (settings.withholdingVatRate / 100);
  const taxAmount = vatAmount + nhilAmount + getfundAmount;

  return {
    subtotal: baseAmount,
    vatRate: settings.vatRate,
    nhilRate: settings.nhilRate,
    getfundRate: settings.getfundRate,
    withholdingVatRate: settings.withholdingVatRate,
    vatAmount,
    nhilAmount,
    getfundAmount,
    withholdingVatAmount,
    taxAmount,
    totalAmount: baseAmount + taxAmount,
    taxMode: settings.taxMode,
    enabled: true,
    effectiveDate: settings.effectiveDate
  };
};

const resolveSaleUnitType = (product, unit) => {
  if (unit === "bulk" || unit === product.bulkUnit) {
    return "bulk";
  }

  if (unit === "base" || unit === product.baseUnit) {
    return "base";
  }

  throw createAppError("The selected sale unit is not valid for this product. Choose base or bulk unit and try again.", {
    code: "sale/invalid-unit",
    source: ERROR_FLAGS.SOURCE_VALIDATION
  });
};

const createLegacySale = (cartItems = []) => {
  const state = getState();
  const currentUser = getCurrentUser();
  const stockBatches = Array.isArray(state.stock) ? state.stock : [];
  const taxSettings = normalizeTaxSettings(state.settings?.tax);
  const saleDrafts = [];
  let totalAmount = 0;
  let profit = 0;
  let hasUnknownAllocatedCost = false;

  if (!Array.isArray(cartItems) || cartItems.length === 0) {
    throw createAppError("Add at least one item before recording a sale.", {
      code: "sale/empty-cart",
      source: ERROR_FLAGS.SOURCE_VALIDATION
    });
  }

  for (const cartItem of cartItems) {
    const { productId, quantity, unit = "base" } = cartItem;
    const product = state.products.find((item) => item.id === productId);

    if (!product) {
      throw createAppError("One of the selected products could not be found. Refresh inventory and try again.", {
        code: "sale/product-not-found",
        source: ERROR_FLAGS.SOURCE_VALIDATION
      });
    }

    if (Number(product.inventorySchemaVersion) === 2) {
      throw createAppError("Authoritative v2 stock can only be sold through secure checkout.", {
        code: "inventory/authoritative-v2-legacy-sale-blocked",
        source: ERROR_FLAGS.SOURCE_VALIDATION
      });
    }

    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw createAppError("Quantity must be a whole number greater than zero.", {
        code: "sale/invalid-quantity",
        source: ERROR_FLAGS.SOURCE_VALIDATION
      });
    }

    const normalizedSaleUnit = resolveSaleUnitType(product, unit);
    const actualQtySold = toBaseUnit(product, quantity, normalizedSaleUnit);
    const displayUnit = getDisplayUnit(product, unit);
    const { unitCostPrice, unitSellingPrice } = getApprovedUnitPrices(product, normalizedSaleUnit);
    const sellableBatches = getSellableBatches(stockBatches, product.id);
    const sellableQuantity = sellableBatches.reduce((sum, batch) => sum + (batch.quantity || 0), 0);

    if (actualQtySold > sellableQuantity) {
      throw createAppError(`Not enough sellable stock available for ${product.name}. Current sellable stock is ${sellableQuantity} ${product.baseUnit}(s).`, {
        code: "inventory/insufficient-stock",
        source: ERROR_FLAGS.SOURCE_VALIDATION
      });
    }

    const itemTotal = unitSellingPrice * quantity;
    const itemProfit = (unitSellingPrice - unitCostPrice) * quantity;
    const batchAllocations = previewBatchAllocations(sellableBatches, actualQtySold);
    const unknownCostBatchIds = new Set(
      sellableBatches
        .filter((batch) => batch.costStatus === "unknown"
          || batch.openingStockBalance === true
          || batch.unitCost === null)
        .map((batch) => batch.id)
    );
    if (batchAllocations.some((allocation) => unknownCostBatchIds.has(allocation.batchId))) {
      hasUnknownAllocatedCost = true;
    }
    saleDrafts.push({
      product,
      sellableBatches,
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

  const taxBreakdown = calculateTaxBreakdown(totalAmount, taxSettings);

  const sale = {
    id: createSaleId(),
    items: saleDrafts.map((item) => ({
      productId: item.productId,
      name: item.name,
      quantity: item.quantity,
      saleUnit: item.saleUnit,
      unit: item.unit,
      unitPrice: item.unitPrice,
      total: item.total,
      actualQtySold: item.actualQtySold,
      batchAllocations: item.batchAllocations
    })),
    subtotalAmount: totalAmount,
    taxBreakdown,
    totalAmount: taxBreakdown.totalAmount,
    profit: hasUnknownAllocatedCost ? null : profit,
    createdAt: new Date().toISOString(),
    createdBy: currentUser
      ? {
          id: currentUser.id || currentUser.username,
          fullName: currentUser.fullName || currentUser.username,
          username: currentUser.username,
          role: currentUser.role
        }
      : null,
    user: currentUser?.fullName || currentUser?.username || "unknown",
    taxSettingsSnapshot: taxSettings,
    ...buildSaleSyncMetadata()
  };

  const stockDeductions = saleDrafts.map((item) => ({
    productId: item.productId,
    quantity: item.actualQtySold
  }));

  const primaryItem = saleDrafts[0];
  sale.productId = saleDrafts.length === 1 ? primaryItem.productId : null;
  sale.product = saleDrafts.length === 1 ? primaryItem.name : "Multiple Items";
  sale.qty = saleDrafts.length === 1 ? primaryItem.quantity : saleDrafts.length;
  sale.saleUnit = saleDrafts.length === 1 ? primaryItem.unit : "items";
  sale.saleUnitType = saleDrafts.length === 1 ? primaryItem.saleUnit : "mixed";
  sale.actualQtySold = saleDrafts.reduce((sum, item) => sum + item.actualQtySold, 0);
  sale.syncStatus = getSaleSyncStatus.synced;
  sale.syncedAt = new Date().toISOString();
  sale.lastSyncError = null;
  sale.lastSyncAttemptAt = sale.syncedAt;

  return submitSaleToCloudTransaction({
    sale,
    stockDeductions
  }).then(() => {
    sale.items = saleDrafts.map((item) => {
      allocateBatchStock(item.sellableBatches, item.actualQtySold);

      item.product.quantity = Math.max((item.product.quantity || 0) - item.actualQtySold, 0);

      return {
        productId: item.productId,
        name: item.name,
        quantity: item.quantity,
        saleUnit: item.saleUnit,
        unit: item.unit,
        unitPrice: item.unitPrice,
        total: item.total,
        actualQtySold: item.actualQtySold,
        batchAllocations: item.batchAllocations
      };
    });

    state.sales.push(sale);
    setState(state);

    return sale;
  });
};

// Secure mode never falls back to legacy writes or its asynchronous sync queue.
export const getCheckoutConfirmation = async (cartItems = [], paymentMethod = "Cash") => {
  if (await isSecureSalesEnabled()) return { secure: true, ...(await quoteSecureCheckout({ cartItems, paymentMethod })) };
  const state = getState();
  const opening = new Map((state.openingStockProducts || [])
    .filter((setup) => setup?.status === "unverified")
    .map((setup) => [setup.productId, setup]));
  const openingItems = cartItems.filter((item) => opening.has(item.productId));
  if (openingItems.length > 0 && openingItems.length !== cartItems.length) {
    throw createAppError("Opening-stock items cannot be combined with verified stock. Complete them as a separate sale so stock is never partially deducted.", {
      code: "opening-stock/mixed-cart", source: ERROR_FLAGS.SOURCE_VALIDATION
    });
  }
  if (openingItems.length === cartItems.length && openingItems.length > 0) {
    const quote = /** @type {any} */ (await quoteOpeningStockCheckout({ cartItems, paymentMethod }));
    return { secure: false, openingStock: true, ...quote };
  }
  for (const cartItem of cartItems) {
    const product = state.products.find((item) => item.id === cartItem.productId);
    if (!product) {
      throw createAppError("One of the selected products could not be found. Refresh inventory and try again.", {
        code: "sale/product-not-found",
        source: ERROR_FLAGS.SOURCE_VALIDATION
      });
    }
    getApprovedUnitPrices(product, resolveSaleUnitType(product, cartItem.unit || "base"));
  }
  return { secure: false };
};

export const createSale = async (cartItems = [], paymentMethod = "Cash", expectedQuoteFingerprint = "", openingStock = false) => {
  if (openingStock) return submitOpeningStockCheckout({ cartItems, paymentMethod, expectedQuoteFingerprint });
  if (expectedQuoteFingerprint || await isSecureSalesEnabled()) return submitSecureCheckout({ cartItems, paymentMethod, expectedQuoteFingerprint });
  return createLegacySale(cartItems);
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
