const positivePrice = (value) => {
  const price = Number(value);
  return Number.isFinite(price) && price > 0 ? price : 0;
};

// Product-level prices are the fallback after any dated batch price. A saved
// bulk price is an explicit approval, so it must win over a derived base-price
// conversion when selling a bulk unit.
export function resolvePersistedProductSellingPrice(product = {}, saleUnit = "base") {
  const unitsPerBulk = Number(product.unitsPerBulk || 1) > 0
    ? Number(product.unitsPerBulk || 1)
    : 1;
  const basePrice = positivePrice(product.sellingPrice);
  const bulkPrice = positivePrice(product.bulkSellingPrice);

  if (saleUnit === "bulk") {
    if (bulkPrice) return bulkPrice;
    return basePrice ? basePrice * unitsPerBulk : 0;
  }

  if (basePrice) return basePrice;
  return bulkPrice ? bulkPrice / unitsPerBulk : 0;
}
