"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createSecureSalesService } = require("../services/secureSalesService");
const { createSecureReceivingService } = require("../services/secureReceivingService");

class FakeHttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
const clone = (value) => structuredClone(value);
const FieldValue = { serverTimestamp: () => "<server-timestamp>" };
class Ref { constructor(db, path) { this.db = db; this.path = path; this.id = path.split("/").pop(); } }
class Snapshot { constructor(ref, data) { this.ref = ref; this.id = ref.id; this.exists = data !== undefined; this._data = data; } data() { return this._data === undefined ? undefined : clone(this._data); } }
class Transaction {
  constructor(db) { this.db = db; this.writes = []; }
  async get(target) {
    if (target.kind === "query") {
      const docs = [...this.db.documents.entries()].filter(([path, value]) => path.startsWith(`${target.collection}/`) && !path.slice(target.collection.length + 1).includes("/") && value[target.field] === target.value).slice(0, target.limitCount).map(([path, value]) => new Snapshot(new Ref(this.db, path), value));
      return { size: docs.length, docs };
    }
    return new Snapshot(target, this.db.documents.get(target.path));
  }
  update(ref, value) { this.writes.push({ type: "update", ref, value: clone(value) }); }
  set(ref, value) { this.writes.push({ type: "set", ref, value: clone(value) }); }
  commit() { for (const write of this.writes) { const prior = this.db.documents.get(write.ref.path); if (write.type === "update" && prior === undefined) throw new Error(`Missing update target ${write.ref.path}`); this.db.documents.set(write.ref.path, write.type === "set" ? clone(write.value) : { ...prior, ...clone(write.value) }); } }
}
class FakeFirestore {
  constructor(seed) { this.documents = new Map(Object.entries(seed).map(([path, value]) => [path, clone(value)])); this.tail = Promise.resolve(); }
  collection(collection) { const query = { kind: "query", collection, field: null, value: null, limitCount: Number.MAX_SAFE_INTEGER }; return { doc: (id) => new Ref(this, `${collection}/${id}`), where: (field, operator, value) => { assert.equal(operator, "=="); return { ...query, field, value, limit(limitCount) { return { ...this, limitCount }; } }; } }; }
  async runTransaction(callback) { const previous = this.tail; let release; this.tail = new Promise((resolve) => { release = resolve; }); await previous; try { const transaction = new Transaction(this); const result = await callback(transaction); transaction.commit(); return result; } finally { release(); } }
}

const fixedNow = () => new Date("2026-10-16T12:00:00.000Z");
function seed(overrides = {}) {
  return {
    "settings/secureSales": { enabled: true },
    "settings/tax": { enabled: true, vatRate: 15, nhilRate: 2.5, getfundRate: 2.5, withholdingVatRate: 7, taxMode: "standard" },
    "users/receiver": { uid: "receiver", role: "storekeeper", active: true, fullName: "Store Keeper" },
    "users/admin": { uid: "admin", role: "admin", active: true, fullName: "Admin" },
    "products/water": { name: "Water", active: true, baseUnit: "Bottle", bulkUnit: "Carton", unitsPerBulk: 12, inventorySchemaVersion: 2, pricingStatus: "approved", sellingPricePesewas: 600, bulkSellingPricePesewas: 7200, quantity: 0, sellableQuantity: 0 },
    ...overrides
  };
}
function services(overrides = {}) { const db = new FakeFirestore(seed(overrides)); return { db, receiving: createSecureReceivingService({ db, FieldValue, HttpsError: FakeHttpsError, now: fixedNow }), sales: createSecureSalesService({ db, FieldValue, HttpsError: FakeHttpsError, now: fixedNow }) }; }
function request(overrides = {}) { return { auth: { uid: "receiver" }, data: { idempotencyKey: "receive-request-000001", purchase: { supplier: "Demo Supplier", invoiceNumber: "INV-100", purchaseDate: "2026-10-16T08:30", paymentStatus: "Credit", dueDate: "2026-11-01", notes: "Fragile", receivedByNote: "Store room", lines: [{ productId: "water", quantity: 2, unit: "bulk", totalBulkCostPesewas: 12001, additionalExpensesPesewas: 199, expiryBusinessDate: "2026-12-01" }] }, ...overrides } }; }
async function reject(action, code) { await assert.rejects(action, (error) => error instanceof FakeHttpsError && error.code === code); }

test("secure receive atomically creates purchase, receipt, batch, movement, aggregate, then sells and reconciles", async () => {
  const { db, receiving, sales } = services();
  const received = await receiving.receiveSecureStock(request());
  assert.equal(received.committed, true);
  assert.equal(received.lines[0].baseQuantity, 24);
  assert.equal(received.lines[0].quantityReceived, 24);
  assert.equal(received.lines[0].bulkQuantityReceived, 2);
  assert.equal(received.totalLandedCostPesewas, 12200);
  assert.equal(db.documents.get("products/water").quantity, 24);
  assert.equal(db.documents.get("products/water").sellableQuantity, 24);
  const batch = db.documents.get(`stockBatches/${received.lines[0].batchId}`);
  assert.equal(batch.totalLandedCostPesewas, 12200);
  assert.equal(batch.costAllocatedBaseQuantity, 0);
  assert.equal(db.documents.get(`stockReceipts/${received.lines[0].receiptId}`).paymentStatus, "Credit");
  assert.equal(db.documents.get(`purchases/${received.purchaseId}`).purchaseDate, "2026-10-16T08:30");
  assert.equal(db.documents.get("products/water").sellingPricePesewas, 600, "receiving must not change approved prices");
  const quote = await sales.quoteSecureSale({ auth: { uid: "admin" }, data: { items: [{ productId: "water", quantity: 1, unit: "bulk" }], paymentMethod: "cash" } });
  await sales.submitSecureSale({ auth: { uid: "admin" }, data: { idempotencyKey: "sale-after-receive-0001", items: [{ productId: "water", quantity: 1, unit: "bulk" }], paymentMethod: "cash", expectedQuoteFingerprint: quote.quoteFingerprint } });
  assert.equal(db.documents.get("products/water").quantity, 12);
  assert.equal(db.documents.get("products/water").sellableQuantity, 12);
  assert.equal(db.documents.get(`stockBatches/${received.lines[0].batchId}`).remainingBaseQuantity, 12);
});

test("secure receive is idempotent and conflicting retries never add stock twice", async () => {
  const { db, receiving } = services();
  const first = await receiving.receiveSecureStock(request());
  const retry = await receiving.receiveSecureStock(request());
  assert.deepEqual(retry, first);
  assert.equal(db.documents.get("products/water").quantity, 24);
  const conflicting = request();
  conflicting.data.purchase.invoiceNumber = "INV-CHANGED";
  await reject(() => receiving.receiveSecureStock(conflicting), "already-exists");
  assert.equal(db.documents.get("products/water").quantity, 24);
});

test("secure receive persists bulk and loose breakdowns, adds only the total base quantity, and conflicts on changed loose units", async () => {
  const { db, receiving } = services({
    "products/water": { ...seed()["products/water"], quantity: 5, sellableQuantity: 5 },
    "stockBatches/opening": { productId: "water", originalBaseQuantity: 5, remainingBaseQuantity: 5, costAllocatedBaseQuantity: 0, totalLandedCostPesewas: 500, receivedAt: "2026-10-01T08:00:00.000Z", expiryBusinessDate: "", inventoryStatus: "active", baseUnit: "Bottle", bulkUnit: "Carton", unitsPerBulk: 12 }
  });
  const mixed = request();
  mixed.data.idempotencyKey = "receive-mixed-breakdown-1";
  mixed.data.purchase.lines = [{ productId: "water", bulkQuantityReceived: 2, looseBaseQuantityReceived: 3, totalPurchaseCostPesewas: 12001, additionalExpensesPesewas: 199, expiryBusinessDate: "2026-12-01" }];
  const received = await receiving.receiveSecureStock(mixed);
  assert.equal(received.lines[0].quantityReceived, 27);
  assert.equal(received.lines[0].bulkQuantityReceived, 2);
  assert.equal(received.lines[0].looseBaseQuantityReceived, 3);
  assert.deepEqual(received.lines[0].receivedQuantityBreakdown, { bulkQuantityReceived: 2, looseBaseQuantityReceived: 3, unitsPerBulk: 12, totalBaseQuantity: 27 });
  assert.equal(db.documents.get("products/water").quantity, 32);
  assert.equal(db.documents.get(`stockReceipts/${received.lines[0].receiptId}`).totalPurchaseCost, 120.01);
  assert.equal((await receiving.receiveSecureStock(mixed)).lines[0].receiptId, received.lines[0].receiptId);
  const conflict = structuredClone(mixed); conflict.data.purchase.lines[0].looseBaseQuantityReceived = 4;
  await reject(() => receiving.receiveSecureStock(conflict), "already-exists");
  assert.equal(db.documents.get("products/water").quantity, 32);
});

test("secure receive accepts loose-only lines and rejects zero, fractional, or overflowed breakdowns", async () => {
  const { db, receiving } = services();
  const looseOnly = request();
  looseOnly.data.idempotencyKey = "receive-loose-only-line-1";
  looseOnly.data.purchase.lines = [{ productId: "water", bulkQuantityReceived: 0, looseBaseQuantityReceived: 3, totalPurchaseCostPesewas: 300, additionalExpensesPesewas: 0, expiryBusinessDate: "" }];
  assert.equal((await receiving.receiveSecureStock(looseOnly)).lines[0].quantityReceived, 3);
  assert.equal(db.documents.get("products/water").quantity, 3);
  const zero = request(); zero.data.idempotencyKey = "receive-zero-breakdown-1"; zero.data.purchase.lines = [{ productId: "water", bulkQuantityReceived: 0, looseBaseQuantityReceived: 0, totalPurchaseCostPesewas: 0, additionalExpensesPesewas: 0, expiryBusinessDate: "" }];
  await reject(() => receiving.receiveSecureStock(zero), "invalid-argument");
  const fraction = request(); fraction.data.idempotencyKey = "receive-fraction-breakdown"; fraction.data.purchase.lines = [{ productId: "water", bulkQuantityReceived: 1.5, looseBaseQuantityReceived: 0, totalPurchaseCostPesewas: 0, additionalExpensesPesewas: 0, expiryBusinessDate: "" }];
  await reject(() => receiving.receiveSecureStock(fraction), "invalid-argument");
  const overflow = services({ "products/water": { ...seed()["products/water"], unitsPerBulk: Number.MAX_SAFE_INTEGER } });
  const overflowRequest = request(); overflowRequest.data.purchase.lines = [{ productId: "water", bulkQuantityReceived: 2, looseBaseQuantityReceived: 0, totalPurchaseCostPesewas: 0, additionalExpensesPesewas: 0, expiryBusinessDate: "" }];
  await reject(() => overflow.receiving.receiveSecureStock(overflowRequest), "failed-precondition");
});

test("secure receive rejects unauthorized or inactive callers and disabled secure mode", async () => {
  await reject(() => services({ "users/receiver": { role: "sales", active: true } }).receiving.receiveSecureStock(request()), "permission-denied");
  await reject(() => services({ "users/receiver": { role: "manager", active: false } }).receiving.receiveSecureStock(request()), "permission-denied");
  await reject(() => services({ "settings/secureSales": { enabled: false } }).receiving.receiveSecureStock(request()), "failed-precondition");
});

test("secure receive rejects invalid costs, conversion, expiry, and leaves every document unchanged", async () => {
  const invalid = services();
  const fractionalCost = request();
  fractionalCost.data.purchase.lines[0].totalBulkCostPesewas = 1.5;
  await reject(() => invalid.receiving.receiveSecureStock(fractionalCost), "invalid-argument");
  const expired = request();
  expired.data.idempotencyKey = "receive-request-000002";
  expired.data.purchase.lines[0].expiryBusinessDate = "2026-10-15";
  await reject(() => invalid.receiving.receiveSecureStock(expired), "failed-precondition");
  const brokenConversion = services({ "products/water": { ...seed()["products/water"], unitsPerBulk: 1.5 } });
  await reject(() => brokenConversion.receiving.receiveSecureStock(request()), "invalid-argument");
  assert.equal(invalid.db.documents.get("products/water").quantity, 0);
  assert.equal([...invalid.db.documents.keys()].some((path) => path.startsWith("stockBatches/") || path.startsWith("purchases/")), false);
});

test("concurrent receive and sale serialize through the product aggregate without duplicate stock", async () => {
  const { db, receiving, sales } = services({
    "products/water": { ...seed()["products/water"], quantity: 1, sellableQuantity: 1 },
    "stockBatches/opening": { productId: "water", originalBaseQuantity: 1, remainingBaseQuantity: 1, costAllocatedBaseQuantity: 0, totalLandedCostPesewas: 100, receivedAt: "2026-10-01T08:00:00.000Z", expiryBusinessDate: "", inventoryStatus: "active", baseUnit: "Bottle", bulkUnit: "Carton", unitsPerBulk: 12 }
  });
  const quote = await sales.quoteSecureSale({ auth: { uid: "admin" }, data: { items: [{ productId: "water", quantity: 1, unit: "base" }], paymentMethod: "cash" } });
  const outcomes = await Promise.allSettled([
    receiving.receiveSecureStock(request()),
    sales.submitSecureSale({ auth: { uid: "admin" }, data: { idempotencyKey: "concurrent-sale-after-recv", items: [{ productId: "water", quantity: 1, unit: "base" }], paymentMethod: "cash", expectedQuoteFingerprint: quote.quoteFingerprint } })
  ]);
  assert.equal(outcomes.filter((result) => result.status === "fulfilled").length, 2);
  assert.equal(db.documents.get("products/water").quantity, 24);
  assert.equal(db.documents.get("products/water").sellableQuantity, 24);
});
