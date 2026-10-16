import assert from "node:assert/strict";
import test from "node:test";
import {
  createSecureCheckoutAttemptStore,
  mapSecureSaleResponse,
  normalizeSecureCheckoutPayload
} from "../js/services/secureCheckoutCore.js";

function memoryStorage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
}

test("secure checkout keeps one immutable idempotent payload across retries and locks unknown outcomes", () => {
  const store = createSecureCheckoutAttemptStore({ storage: memoryStorage(), now: () => "2026-10-16T12:00:00.000Z", randomUUID: () => "test-uuid-00000001" });
  const first = store.getOrCreate({ actorId: "cashier-a", cartItems: [{ productId: "water", quantity: 2, saleUnit: "base" }], paymentMethod: "Cash" });
  const retry = store.getOrCreate({ actorId: "cashier-a", cartItems: [{ productId: "water", quantity: 2, saleUnit: "base" }], paymentMethod: "Cash" });
  assert.equal(retry.idempotencyKey, first.idempotencyKey);
  assert.equal(retry.payloadJson, first.payloadJson);
  store.markUnknown(first);
  assert.throws(() => store.getOrCreate({ actorId: "cashier-a", cartItems: [{ productId: "water", quantity: 3, saleUnit: "base" }], paymentMethod: "Cash" }), /may already have reached the server/);
});

test("secure checkout uses server totals and rejects duplicate product lines", () => {
  assert.throws(() => normalizeSecureCheckoutPayload([{ productId: "water", quantity: 1, saleUnit: "base" }, { productId: "water", quantity: 1, saleUnit: "bulk" }], "Cash"), /cannot be sold in both/);
  const sale = mapSecureSaleResponse({ saleId: "SEC-1", committed: true, committedAt: "2026-10-16T12:00:00.000Z", subtotalPesewas: 600, totalAmountPesewas: 720, createdBy: { fullName: "Cashier" }, items: [{ productId: "water", name: "Water", quantity: 1, unit: "bulk", unitLabel: "Carton", saleUnit: "bulk", baseQuantity: 10, unitPrice: 6, total: 6 }], taxBreakdown: { subtotalPesewas: 600, vatRateBasisPoints: 1500, taxAmountPesewas: 120, totalAmountPesewas: 720, enabled: true } });
  assert.equal(sale.id, "SEC-1");
  assert.equal(sale.totalAmount, 7.2);
  assert.equal(sale.taxBreakdown.taxAmount, 1.2);
  assert.equal(sale.items[0].unitPrice, 6);
  assert.equal(sale.items[0].unitLabel, "Carton");
});
