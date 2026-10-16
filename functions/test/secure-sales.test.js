"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createSecureSalesService } = require("../services/secureSalesService");

class FakeHttpsError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const clone = (value) => structuredClone(value);
const FieldValue = { serverTimestamp: () => "<server-timestamp>" };

class Ref {
  constructor(db, path) { this.db = db; this.path = path; this.id = path.split("/").pop(); }
}
class Snapshot {
  constructor(ref, data) { this.ref = ref; this.id = ref.id; this.exists = data !== undefined; this._data = data; }
  data() { return this._data === undefined ? undefined : clone(this._data); }
}
class Transaction {
  constructor(db) { this.db = db; this.writes = []; }
  async get(target) {
    if (target.kind === "query") {
      const docs = [...this.db.documents.entries()]
        .filter(([path, value]) => path.startsWith(`${target.collection}/`) && !path.slice(target.collection.length + 1).includes("/") && value[target.field] === target.value)
        .slice(0, target.limitCount)
        .map(([path, value]) => new Snapshot(new Ref(this.db, path), value));
      return { size: docs.length, docs };
    }
    return new Snapshot(target, this.db.documents.get(target.path));
  }
  update(ref, value) { this.writes.push({ type: "update", ref, value: clone(value) }); }
  set(ref, value) { this.writes.push({ type: "set", ref, value: clone(value) }); }
  commit() {
    for (const write of this.writes) {
      const previous = this.db.documents.get(write.ref.path);
      if (write.type === "update" && previous === undefined) throw new Error(`Missing update target ${write.ref.path}`);
      this.db.documents.set(write.ref.path, write.type === "set" ? clone(write.value) : { ...previous, ...clone(write.value) });
    }
  }
}
class FakeFirestore {
  constructor(seed) { this.documents = new Map(Object.entries(seed).map(([path, data]) => [path, clone(data)])); this.tail = Promise.resolve(); }
  collection(collection) {
    const query = { kind: "query", collection, field: null, value: null, limitCount: Number.MAX_SAFE_INTEGER };
    return {
      doc: (id) => new Ref(this, `${collection}/${id}`),
      where: (field, operator, value) => {
        assert.equal(operator, "==");
        return { ...query, field, value, limit(limitCount) { return { ...this, limitCount }; } };
      }
    };
  }
  async runTransaction(callback) {
    const previous = this.tail;
    let release;
    this.tail = new Promise((resolve) => { release = resolve; });
    await previous;
    try {
      const transaction = new Transaction(this);
      const result = await callback(transaction);
      transaction.commit();
      return result;
    } finally { release(); }
  }
}

const fixedNow = () => new Date("2026-10-16T12:00:00.000Z");
const batch = (id, overrides = {}) => ({
  productId: "water", originalBaseQuantity: 10, remainingBaseQuantity: 10, costAllocatedBaseQuantity: 0,
  totalLandedCostPesewas: 1125, receivedAt: "2026-10-10T08:00:00.000Z", expiryBusinessDate: "", inventoryStatus: "active",
  baseUnit: "Bottle", bulkUnit: "Carton", unitsPerBulk: 10, ...overrides
});
function seed(overrides = {}) {
  return {
    "settings/secureSales": { enabled: true },
    "settings/tax": { enabled: true, vatRate: 15, nhilRate: 2.5, getfundRate: 2.5, withholdingVatRate: 7, taxMode: "standard", effectiveDate: "2026-10-01" },
    "users/sales-user": { uid: "sales-user", role: "sales", active: true, fullName: "Sales User", username: "sales.user" },
    "products/water": { name: "Water", active: true, inventorySchemaVersion: 2, pricingStatus: "approved", sellingPricePesewas: 600, bulkSellingPricePesewas: 6000, unitsPerBulk: 10, quantity: 10, sellableQuantity: 10 },
    "stockBatches/batch-a": batch("batch-a"),
    ...overrides
  };
}
function service(overrides = {}) {
  const db = new FakeFirestore(seed(overrides));
  return { db, service: createSecureSalesService({ db, FieldValue, HttpsError: FakeHttpsError, now: fixedNow }) };
}
function request(overrides = {}) {
  return { auth: { uid: "sales-user" }, data: { idempotencyKey: "sale-request-000001", items: [{ productId: "water", quantity: 2, unit: "base" }], paymentMethod: "cash", ...overrides } };
}
async function reject(action, code) { await assert.rejects(action, (error) => error instanceof FakeHttpsError && error.code === code); }

test("commits immutable server-priced sale, FEFO allocations, movements, and exact fractional batch cost", async () => {
  const { db, service: secureSales } = service({
    "products/water": { name: "Water", active: true, inventorySchemaVersion: 2, pricingStatus: "approved", sellingPricePesewas: 600, unitsPerBulk: 10, quantity: 10, sellableQuantity: 10 },
    "stockBatches/fifo": batch("fifo", { remainingBaseQuantity: 4, originalBaseQuantity: 4, totalLandedCostPesewas: 401, receivedAt: "2026-10-01T08:00:00.000Z" }),
    "stockBatches/fefo": batch("fefo", { remainingBaseQuantity: 6, originalBaseQuantity: 6, totalLandedCostPesewas: 607, receivedAt: "2026-10-15T08:00:00.000Z", expiryBusinessDate: "2026-10-16" }),
    "stockBatches/batch-a": undefined
  });
  db.documents.delete("stockBatches/batch-a");
  const result = await secureSales.submitSecureSale(request({ items: [{ productId: "water", quantity: 7, unit: "base" }] }));
  assert.equal(result.items[0].unitPricePesewas, 600);
  assert.equal(result.items[0].lineTotalPesewas, 4200);
  assert.deepEqual(result.items[0].batchAllocations.map((entry) => [entry.batchId, entry.baseQuantity]), [["fefo", 6], ["fifo", 1]]);
  assert.equal(result.items[0].batchAllocations.reduce((sum, entry) => sum + entry.allocatedCostPesewas, 0), 707);
  assert.equal(db.documents.get("products/water").quantity, 3);
  assert.equal(db.documents.get("products/water").sellableQuantity, 3);
  assert.equal(db.documents.get("stockBatches/fefo").remainingBaseQuantity, 0);
  assert.equal([...db.documents.keys()].filter((key) => key.startsWith("stockMovements/")).length, 2);
  const sale = db.documents.get(`sales/${result.saleId}`);
  assert.equal(sale.createdAt, "2026-10-16T12:00:00.000Z");
  assert.equal(sale.totalAmount, result.totalAmountPesewas / 100);
});

test("idempotent retry returns the original result and conflicting payload is rejected", async () => {
  const { db, service: secureSales } = service();
  const first = await secureSales.submitSecureSale(request());
  const second = await secureSales.submitSecureSale(request());
  assert.deepEqual(second, first);
  assert.equal(db.documents.get("products/water").quantity, 8);
  await reject(() => secureSales.submitSecureSale(request({ items: [{ productId: "water", quantity: 1, unit: "base" }] })), "already-exists");
});

test("concurrent last-stock requests cannot oversell batches or aggregate quantity", async () => {
  const { db, service: secureSales } = service({
    "products/water": { name: "Water", active: true, inventorySchemaVersion: 2, pricingStatus: "approved", sellingPricePesewas: 600, unitsPerBulk: 10, quantity: 1, sellableQuantity: 1 },
    "stockBatches/batch-a": batch("batch-a", { originalBaseQuantity: 1, remainingBaseQuantity: 1, totalLandedCostPesewas: 125 })
  });
  const results = await Promise.allSettled([
    secureSales.submitSecureSale(request({ idempotencyKey: "concurrent-last-stock-1", items: [{ productId: "water", quantity: 1, unit: "base" }] })),
    secureSales.submitSecureSale(request({ idempotencyKey: "concurrent-last-stock-2", items: [{ productId: "water", quantity: 1, unit: "base" }] }))
  ]);
  assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(results.filter((item) => item.status === "rejected")[0].reason.code, "failed-precondition");
  assert.equal(db.documents.get("products/water").quantity, 0);
  assert.equal(db.documents.get("stockBatches/batch-a").remainingBaseQuantity, 0);
});

test("blocks unresolved prices, tampered payloads, inactive users, unauthorized roles, and disabled mode", async () => {
  await reject(() => service({ "products/water": { name: "Water", active: true, inventorySchemaVersion: 2, unitsPerBulk: 10, quantity: 10, sellableQuantity: 10 } }).service.submitSecureSale(request()), "failed-precondition");
  await reject(() => service().service.submitSecureSale(request({ items: [{ productId: "water", quantity: 1, unit: "base", unitPrice: 1 }] })), "invalid-argument");
  await reject(() => service({ "users/sales-user": { role: "sales", active: false } }).service.submitSecureSale(request()), "permission-denied");
  await reject(() => service({ "users/sales-user": { role: "manager", active: true } }).service.submitSecureSale(request()), "permission-denied");
  await reject(() => service({ "settings/secureSales": { enabled: false } }).service.submitSecureSale(request()), "failed-precondition");
});

test("uses Accra expiry boundary, FIFO for undated stock, and blocks malformed expiry batches", async () => {
  const onExpiry = service({
    "products/water": { name: "Water", active: true, inventorySchemaVersion: 2, pricingStatus: "approved", sellingPricePesewas: 600, unitsPerBulk: 10, quantity: 2, sellableQuantity: 1 },
    "stockBatches/batch-a": batch("batch-a", { originalBaseQuantity: 1, remainingBaseQuantity: 1, expiryBusinessDate: "2026-10-15" }),
    "stockBatches/on-date": batch("on-date", { originalBaseQuantity: 1, remainingBaseQuantity: 1, expiryBusinessDate: "2026-10-16" })
  });
  await onExpiry.service.submitSecureSale(request({ items: [{ productId: "water", quantity: 1, unit: "base" }] }));
  assert.equal(onExpiry.db.documents.get("stockBatches/on-date").remainingBaseQuantity, 0);
  await reject(() => service({
    "products/water": { name: "Water", active: true, inventorySchemaVersion: 2, pricingStatus: "approved", sellingPricePesewas: 600, unitsPerBulk: 10, quantity: 10, sellableQuantity: 10 },
    "stockBatches/batch-a": batch("batch-a", { expiryBusinessDate: "not-a-date" })
  }).service.submitSecureSale(request()), "failed-precondition");
});

test("rejects invalid conversions, insufficient sellable stock, and leaves all documents unchanged on failure", async () => {
  const invalid = service({ "products/water": { name: "Water", active: true, inventorySchemaVersion: 2, pricingStatus: "approved", sellingPricePesewas: 600, unitsPerBulk: 1.5, quantity: 10, sellableQuantity: 10 } });
  await reject(() => invalid.service.submitSecureSale(request({ items: [{ productId: "water", quantity: 1, unit: "bulk" }] })), "failed-precondition");
  const mismatched = service({ "stockBatches/batch-a": batch("batch-a", { unitsPerBulk: 12 }) });
  await reject(() => mismatched.service.submitSecureSale(request({ items: [{ productId: "water", quantity: 1, unit: "bulk" }] })), "failed-precondition");
  const insufficient = service({
    "products/water": { name: "Water", active: true, inventorySchemaVersion: 2, pricingStatus: "approved", sellingPricePesewas: 600, unitsPerBulk: 10, quantity: 10, sellableQuantity: 0 },
    "stockBatches/batch-a": batch("batch-a", { expiryBusinessDate: "2026-10-15" })
  });
  await reject(() => insufficient.service.submitSecureSale(request()), "failed-precondition");
  assert.equal(insufficient.db.documents.get("products/water").quantity, 10);
  assert.equal([...insufficient.db.documents.keys()].some((key) => key.startsWith("sales/")), false);
  assert.equal([...insufficient.db.documents.keys()].some((key) => key.startsWith("stockMovements/")), false);
});
