const asNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

export function toDate(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  if (typeof value === "object" && Number.isFinite(value.seconds)) return new Date(value.seconds * 1000);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function isActiveProduct(product) {
  return product?.active !== false && product?.isActive !== false;
}

export function getSaleAmount(sale) {
  const directAmount = Number(sale?.totalAmount ?? sale?.total);
  if (Number.isFinite(directAmount)) return directAmount;

  return Array.isArray(sale?.items)
    ? sale.items.reduce((sum, item) => sum + asNumber(item.total), 0)
    : 0;
}

export function getSaleDate(sale) {
  return toDate(sale?.createdAt || sale?.date || sale?.syncedAt);
}

export function getProductLowStockThreshold(product, settings = {}) {
  return asNumber(product?.lowStockThreshold || settings.lowStockThreshold || 10);
}

export function getLowStockProducts(products = [], settings = {}) {
  return products
    .filter(isActiveProduct)
    .filter((product) => asNumber(product.quantity) <= getProductLowStockThreshold(product, settings))
    .sort((left, right) => asNumber(left.quantity) - asNumber(right.quantity) || String(left.name).localeCompare(String(right.name)));
}

export function getTodaySales(sales = [], referenceDate = new Date()) {
  const start = new Date(referenceDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  return sales.reduce((sum, sale) => {
    const date = getSaleDate(sale);
    return date && date >= start && date < end ? sum + getSaleAmount(sale) : sum;
  }, 0);
}

export function getSalesTrend(sales = [], referenceDate = new Date(), days = 7) {
  const today = new Date(referenceDate);
  today.setHours(0, 0, 0, 0);
  const points = Array.from({ length: days }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (days - index - 1));
    return { date, amount: 0 };
  });

  sales.forEach((sale) => {
    const date = getSaleDate(sale);
    if (!date) return;
    const saleDay = new Date(date);
    saleDay.setHours(0, 0, 0, 0);
    const point = points.find((entry) => entry.date.getTime() === saleDay.getTime());
    if (point) point.amount += getSaleAmount(sale);
  });

  return points;
}

export function getRecentSales(sales = [], limit = 5) {
  return sales
    .map((sale) => ({ sale, date: getSaleDate(sale) }))
    .filter(({ date }) => date)
    .sort((left, right) => right.date - left.date)
    .slice(0, limit);
}

export function getExpiryAlerts(stock = [], products = [], referenceDate = new Date(), days = 30) {
  const productNames = new Map(products.map((product) => [product.id, product.name || "Unnamed product"]));
  const start = new Date(referenceDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + days + 1);

  return stock
    .map((batch) => ({ ...batch, expiry: toDate(batch.expiryDate) }))
    .filter((batch) => asNumber(batch.quantity) > 0 && batch.expiry)
    .filter((batch) => batch.expiry < end)
    .map((batch) => ({
      ...batch,
      productName: batch.productName || productNames.get(batch.productId) || "Unknown product",
      status: batch.expiry < start ? "Expired" : "Expiring soon"
    }))
    .sort((left, right) => left.expiry - right.expiry);
}

export function getStockValuation(products = []) {
  const activeProducts = products.filter(isActiveProduct);
  const supported = activeProducts.every((product) => {
    const quantity = asNumber(product.quantity);
    return quantity <= 0 || Number.isFinite(Number(product.costPrice));
  });

  return {
    supported,
    amount: supported
      ? activeProducts.reduce((sum, product) => sum + (asNumber(product.quantity) * asNumber(product.costPrice)), 0)
      : null
  };
}
