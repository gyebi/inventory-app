function receiveQuantity(value, field) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return 0;
  const quantity = Number(normalized);
  if (!Number.isSafeInteger(quantity) || quantity < 0) throw new RangeError(`${field} must be a whole number of zero or more.`);
  return quantity;
}

export function calculateLegacyReceivedQuantity(details = {}) {
  const { bulkQuantityReceived, looseBaseQuantityReceived, unitsPerBulk } = /** @type {any} */ (details);
  const conversion = Number(unitsPerBulk);
  if (!Number.isSafeInteger(conversion) || conversion < 1) throw new RangeError("Product pack conversion must be a whole number of at least one.");
  const bulkQuantity = receiveQuantity(bulkQuantityReceived, "Bulk quantity");
  const looseQuantity = receiveQuantity(looseBaseQuantityReceived, "Loose base quantity");
  if (bulkQuantity > Math.floor(Number.MAX_SAFE_INTEGER / conversion)) throw new RangeError("Received quantity is too large.");
  const bulkBaseQuantity = bulkQuantity * conversion;
  if (looseQuantity > Number.MAX_SAFE_INTEGER - bulkBaseQuantity) throw new RangeError("Received quantity is too large.");
  const quantityReceived = bulkBaseQuantity + looseQuantity;
  if (quantityReceived < 1) throw new RangeError("Enter bulk, loose, or both quantities for this line.");
  return { bulkQuantityReceived: bulkQuantity, looseBaseQuantityReceived: looseQuantity, unitsPerBulk: conversion, bulkBaseQuantity, quantityReceived };
}

export function applyInitialLegacySellingPrice(product, receipt, unitsPerBulk, now = () => new Date().toISOString()) {
  if (!product || Number(receipt?.unitSellingPrice || 0) <= 0 || Number(product.sellingPrice || 0) > 0) return false;
  product.sellingPrice = Number(receipt.unitSellingPrice);
  product.bulkSellingPrice = Number(receipt.unitSellingPrice) * unitsPerBulk;
  product.sellingPriceEffectiveDate = receipt.purchaseDate || receipt.receivedAt || now();
  product.sellingPriceUpdatedAt = receipt.receivedAt || receipt.purchaseDate || now();
  return true;
}
