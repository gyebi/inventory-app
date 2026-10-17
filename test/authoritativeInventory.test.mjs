import assert from "node:assert/strict";
import test from "node:test";
import { getLowStockProducts } from "../js/dashboardSelectors.js";
import {
  getAuthoritativeDisplayBatches,
  getPhysicalQuantity,
  getSellableQuantity,
  getClientWritableQuantityProjection,
  isAuthoritativeBatchDataReady,
  shouldUseLegacyStockReconstruction
} from "../js/services/authoritativeInventory.js";

const product = {
  id: "v2-water",
  inventorySchemaVersion: 2,
  quantity: 13,
  sellableQuantity: 13,
  unitsPerBulk: 5,
  baseUnit: "Each",
  bulkUnit: "Pack",
  lowStockThreshold: 2
};

const batches = [
  { id: "opening", productId: product.id, originalBaseQuantity: 3, remainingBaseQuantity: 3, receivedAt: "2026-10-01T10:00:00.000Z" },
  { id: "received", productId: product.id, originalBaseQuantity: 10, remainingBaseQuantity: 10, receivedAt: "2026-10-02T10:00:00.000Z" }
];

function displayStock(quantity) {
  return `${Math.floor(quantity / product.unitsPerBulk)} ${product.bulkUnit}s + ${quantity % product.unitsPerBulk} ${product.baseUnit}`;
}

test("v2 stock stays authoritative across receipt/product/batch listener arrival orders", () => {
  const orders = [
    ["products", "receipts", "batches"],
    ["receipts", "batches", "products"],
    ["batches", "products", "receipts"]
  ];

  for (const order of orders) {
    const state = { stock: [{ id: "legacy-receipt", productId: product.id, quantity: 10 }], authoritativeStockBatches: { status: "loading", batches: [] } };
    for (const source of order) {
      if (source === "batches") state.authoritativeStockBatches = { status: "ready", batches };
    }

    const displayedBatches = getAuthoritativeDisplayBatches(state, product.id);
    assert.equal(isAuthoritativeBatchDataReady(state), true, order.join(" -> "));
    assert.equal(displayedBatches.reduce((sum, batch) => sum + batch.quantity, 0), 13, order.join(" -> "));
    assert.deepEqual(displayedBatches.map((batch) => batch.quantity), [3, 10], "v2 batch displays use remainingBaseQuantity");
    assert.equal(getPhysicalQuantity(product), 13);
    assert.equal(getSellableQuantity(product), 13);
    assert.equal(displayStock(getPhysicalQuantity(product)), "2 Packs + 3 Each");
    assert.equal(shouldUseLegacyStockReconstruction(product), false);
  }
});

test("v2 data does not present partial batches as confirmed stock and survives reload before a server sale", () => {
  const loadingState = { authoritativeStockBatches: { status: "loading", batches: [batches[0]] } };
  const failedState = { authoritativeStockBatches: { status: "error", batches, error: "permission-denied" } };
  assert.deepEqual(getAuthoritativeDisplayBatches(loadingState, product.id), []);
  assert.deepEqual(getAuthoritativeDisplayBatches(failedState, product.id), []);

  const reloadedProduct = JSON.parse(JSON.stringify(product));
  const reloadedBatches = JSON.parse(JSON.stringify(batches));
  assert.equal(getPhysicalQuantity(reloadedProduct), 13);
  assert.equal(getAuthoritativeDisplayBatches({ authoritativeStockBatches: { status: "ready", batches: reloadedBatches } }, product.id).reduce((sum, batch) => sum + batch.quantity, 0), 13);

  const afterServerSale = { ...reloadedProduct, quantity: 12, sellableQuantity: 12 };
  const afterServerSaleBatches = [{ ...reloadedBatches[0], remainingBaseQuantity: 2 }, reloadedBatches[1]];
  assert.equal(getPhysicalQuantity(afterServerSale), 12);
  assert.equal(getSellableQuantity(afterServerSale), 12);
  assert.equal(getAuthoritativeDisplayBatches({ authoritativeStockBatches: { status: "ready", batches: afterServerSaleBatches } }, product.id).reduce((sum, batch) => sum + batch.quantity, 0), 12);
});

test("legacy quantity behavior remains unchanged while v2 low-stock uses sellable quantity", () => {
  const legacy = { id: "legacy", quantity: 4, lowStockThreshold: 5 };
  const expiredV2 = { ...product, quantity: 13, sellableQuantity: 1 };
  assert.equal(shouldUseLegacyStockReconstruction(legacy), true);
  assert.equal(getSellableQuantity(legacy), 4);
  assert.deepEqual(getClientWritableQuantityProjection(product), {}, "browser product writes must omit v2 server aggregates");
  assert.deepEqual(getClientWritableQuantityProjection(legacy), { quantity: 4 });
  assert.deepEqual(getLowStockProducts([legacy, expiredV2]).map((entry) => entry.id), ["v2-water", "legacy"]);
});
