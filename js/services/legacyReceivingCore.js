export function applyInitialLegacySellingPrice(product, receipt, unitsPerBulk, now = () => new Date().toISOString()) {
  if (!product || Number(receipt?.unitSellingPrice || 0) <= 0 || Number(product.sellingPrice || 0) > 0) return false;
  product.sellingPrice = Number(receipt.unitSellingPrice);
  product.bulkSellingPrice = Number(receipt.unitSellingPrice) * unitsPerBulk;
  product.sellingPriceEffectiveDate = receipt.purchaseDate || receipt.receivedAt || now();
  product.sellingPriceUpdatedAt = receipt.receivedAt || receipt.purchaseDate || now();
  return true;
}
