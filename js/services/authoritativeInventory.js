export const isAuthoritativeV2Product = (product) => Number(product?.inventorySchemaVersion) === 2;

export const getPhysicalQuantity = (product) => {
  const quantity = Number(product?.quantity);
  return Number.isFinite(quantity) && quantity >= 0 ? quantity : 0;
};

// In v2, quantity is physical stock and sellableQuantity excludes stock which
// is expired or otherwise unavailable to sell. Legacy products retain quantity
// as their sellable display quantity.
export const getSellableQuantity = (product) => {
  if (!isAuthoritativeV2Product(product)) return getPhysicalQuantity(product);
  const quantity = Number(product?.sellableQuantity);
  return Number.isFinite(quantity) && quantity >= 0 ? quantity : 0;
};

export const getAuthoritativeBatchStatus = (state = {}) => state.authoritativeStockBatches?.status || "idle";

export const isAuthoritativeBatchDataReady = (state = {}) => getAuthoritativeBatchStatus(state) === "ready";

export const toAuthoritativeDisplayBatch = (batch = {}) => ({
  ...batch,
  quantity: Number(batch.remainingBaseQuantity || 0),
  expiryDate: batch.expiryBusinessDate || batch.expiryDate || "",
  receivedAt: batch.receivedAt || batch.createdAt || null,
  isAuthoritativeV2: true
});

export const getAuthoritativeDisplayBatches = (state = {}, productId = "") => {
  if (!isAuthoritativeBatchDataReady(state)) return [];
  const batches = Array.isArray(state.authoritativeStockBatches?.batches)
    ? state.authoritativeStockBatches.batches
    : [];
  return batches
    .filter((batch) => !productId || batch.productId === productId)
    .map(toAuthoritativeDisplayBatch);
};

export const shouldUseLegacyStockReconstruction = (product) => !isAuthoritativeV2Product(product);

export const getClientWritableQuantityProjection = (product) => {
  if (isAuthoritativeV2Product(product)) return {};
  return { quantity: getPhysicalQuantity(product) };
};
