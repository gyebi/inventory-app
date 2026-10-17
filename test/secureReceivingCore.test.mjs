import assert from "node:assert/strict";
import test from "node:test";
import {
  createSecureReceivingAttemptStore,
  mapSecureReceiveResponse,
  normalizeSecureReceivePayload,
  parsePesewas,
  purchaseFromSecureReceiveAttempt,
  shouldRetainSecureReceiveAttempt
} from "../js/services/secureReceivingCore.js";

function memoryStorage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
}

const purchase = () => ({
  supplier: "Supplier", invoiceNumber: "INV-1", purchaseDate: "2026-10-16T09:00", paymentStatus: "Credit", dueDate: "2026-11-01", notes: "", receivedByNote: "Storekeeper",
  lines: [{ productId: "water", quantity: 2, unit: "bulk", totalBulkCostPesewas: 12001, additionalExpensesPesewas: 199, expiryBusinessDate: "2026-12-01" }]
});

test("secure receiving persists one immutable payload and locks conflicting retries after an unknown outcome", () => {
  const store = createSecureReceivingAttemptStore({ storage: memoryStorage(), now: () => "2026-10-16T12:00:00.000Z", randomUUID: () => "test-uuid-00000001" });
  const first = store.getOrCreate({ actorId: "storekeeper-a", purchase: purchase() });
  const retry = store.getOrCreate({ actorId: "storekeeper-a", purchase: purchase() });
  assert.equal(retry.idempotencyKey, first.idempotencyKey);
  assert.equal(retry.payloadJson, first.payloadJson);
  assert.deepEqual(purchaseFromSecureReceiveAttempt(store.load()), JSON.parse(first.payloadJson), "a reload must restore a pending request from its exact persisted payload");
  const changedWhilePending = purchase(); changedWhilePending.lines[0].quantity = 3;
  assert.throws(() => store.getOrCreate({ actorId: "storekeeper-a", purchase: changedWhilePending }), /may already have been received/);
  store.markUnknown(first);
  assert.deepEqual(purchaseFromSecureReceiveAttempt(store.load()), JSON.parse(first.payloadJson), "reload restoration must use the exact persisted payload");
  const changed = purchase(); changed.lines[0].quantity = 3;
  assert.throws(() => store.getOrCreate({ actorId: "storekeeper-a", purchase: changed }), /may already have been received/);
});

test("secure receiving keeps integer pesewas and maps only confirmed server totals", () => {
  const normalized = normalizeSecureReceivePayload(purchase());
  assert.equal(normalized.lines[0].totalBulkCostPesewas, 12001);
  assert.throws(() => normalizeSecureReceivePayload({ ...purchase(), lines: [{ ...purchase().lines[0], totalBulkCostPesewas: 1.5 }] }), /whole pesewas/);
  const confirmed = mapSecureReceiveResponse({ committed: true, purchaseId: "REC-1", committedAt: "2026-10-16T12:00:00.000Z", totalLandedCostPesewas: 12200, createdBy: { fullName: "Storekeeper" }, lines: [{ productId: "water", product: "Water", baseQuantity: 24, totalBulkCostPesewas: 12001, additionalExpensesPesewas: 199, totalLandedCostPesewas: 12200, expiryBusinessDate: "2026-12-01" }] });
  assert.equal(confirmed.totalLandedCost, 122);
  assert.equal(confirmed.lines[0].unitCost, 122 / 24);
  assert.equal(confirmed.lines[0].receivedBy, "Storekeeper");
});

test("secure receiving accepts blank optional expenses but requires purchase cost and retains only unknown outcomes", () => {
  assert.equal(parsePesewas("", { blankAsZero: true }), 0);
  assert.equal(parsePesewas(""), null);
  assert.equal(parsePesewas("120.01"), 12001);
  assert.equal(shouldRetainSecureReceiveAttempt({ code: "functions/unavailable" }), true);
  assert.equal(shouldRetainSecureReceiveAttempt({ code: "functions/invalid-argument" }), false);
});
