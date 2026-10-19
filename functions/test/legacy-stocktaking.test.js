"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createLegacyStocktakingService } = require("../services/legacyStocktakingService");

class FakeHttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
const FieldValue = { serverTimestamp: () => "<server-timestamp>" };
const copy = (value) => structuredClone(value);
class Ref { constructor(db, path) { this.db = db; this.path = path; this.id = path.split("/").pop(); } }
class Snapshot { constructor(ref, value) { this.ref = ref; this.id = ref.id; this.exists = value !== undefined; this.value = value; } data() { return this.value === undefined ? undefined : copy(this.value); } }
class Query { constructor(db, collection, field = null, value = null) { this.db = db; this.kind = "query"; this.collection = collection; this.field = field; this.value = value; } where(field, operator, value) { assert.equal(operator, "=="); return new Query(this.db, this.collection, field, value); } }
class Transaction {
  constructor(db) { this.db = db; this.writes = []; }
  async get(target) { if (target.kind === "query") { const prefix = `${target.collection}/`; const docs = [...this.db.documents.entries()].filter(([key, value]) => key.startsWith(prefix) && !key.slice(prefix.length).includes("/") && (target.field === null || value[target.field] === target.value)).map(([key, value]) => new Snapshot(new Ref(this.db, key), value)); return { docs, size: docs.length, empty: docs.length === 0 }; } return new Snapshot(target, this.db.documents.get(target.path)); }
  update(ref, value) { this.writes.push({ update: true, ref, value }); }
  set(ref, value) { this.writes.push({ update: false, ref, value }); }
  commit() { this.writes.forEach((write) => { const prior = this.db.documents.get(write.ref.path); if (write.update && prior === undefined) throw new Error(`Missing ${write.ref.path}`); this.db.documents.set(write.ref.path, write.update ? { ...prior, ...copy(write.value) } : copy(write.value)); }); }
}
class FakeFirestore { constructor(seed) { this.documents = new Map(Object.entries(seed).map(([key, value]) => [key, copy(value)])); this.tail = Promise.resolve(); } collection(name) { const query = new Query(this, name); query.doc = (id) => new Ref(this, `${name}/${id}`); return query; } async runTransaction(callback) { const previous = this.tail; let release; this.tail = new Promise((resolve) => { release = resolve; }); await previous; try { const transaction = new Transaction(this); const result = await callback(transaction); transaction.commit(); return result; } finally { release(); } } }

const fixedNow = () => new Date("2026-01-04T12:00:00.000Z");
const seed = (more = {}) => ({
  "settings/secureSales": { enabled: false },
  "users/admin": { role: "admin", active: true, fullName: "Admin" },
  "users/manager": { role: "manager", active: true, fullName: "Manager" },
  "users/keeper": { role: "storekeeper", active: true, fullName: "Keeper" },
  "users/sales": { role: "sales", active: true, fullName: "Sales" },
  "products/water": { name: "Water", category: "Water", active: true, baseUnit: "Bottle", bulkUnit: "Carton", unitsPerBulk: 12, quantity: 10, costPrice: 2, updatedAt: "2026-01-04T10:00:00.000Z" },
  "stockReceipts/water": { productId: "water", batchId: "water-batch", quantityReceived: 10, expiryDate: "2099-01-01", receivedAt: "2026-01-01T10:00:00.000Z" },
  ...more
});
const setup = (more = {}, now = fixedNow) => { const db = new FakeFirestore(seed(more)); return { db, service: createLegacyStocktakingService({ db, FieldValue, HttpsError: FakeHttpsError, now }) }; };
const request = (uid, data) => ({ auth: { uid }, data });
const reject = (action, code) => assert.rejects(action, (error) => error instanceof FakeHttpsError && error.code === code);

test("persistent adjustment is idempotent and conflicts do not deduct twice", async () => {
  const { db, service } = setup();
  const data = { idempotencyKey: "adjustment-simple-request-1", productId: "water", batchId: "", adjustmentType: "Damaged", quantity: 2, unit: "Bottle", reason: "Broken", location: "Shop", occurredAt: "2026-01-04T11:00" };
  const first = await service.recordLegacyAdjustment(request("keeper", data));
  assert.deepEqual(await service.recordLegacyAdjustment(request("keeper", data)), first);
  assert.equal(db.documents.get("products/water").quantity, 8);
  await reject(() => service.recordLegacyAdjustment(request("keeper", { ...data, reason: "Changed" })), "already-exists");
  await reject(() => service.recordLegacyAdjustment(request("sales", { ...data, idempotencyKey: "adjustment-sales-request-2" })), "permission-denied");
});

test("draft restores zero distinctly from blank, evaluates server variance, requires reasons, and never mutates inventory", async () => {
  const { db, service } = setup();
  const started = await service.startStocktake(request("keeper", { idempotencyKey: "stocktake-simple-start-1", category: "Water" }));
  let session = started.session;
  assert.equal(session.items[0].actualBaseQuantity, null);
  await reject(() => service.evaluateStocktake(request("manager", { sessionId: session.id, revision: session.revision })), "failed-precondition");
  session = (await service.saveCounts(request("keeper", { sessionId: session.id, revision: session.revision, counts: [{ productId: "water", quantity: 0, unit: "base" }] }))).session;
  assert.equal(session.items[0].actualBaseQuantity, 0);
  await reject(() => service.saveCounts(request("keeper", { sessionId: session.id, revision: session.revision - 1, counts: [{ productId: "water", quantity: 1, unit: "base" }] })), "aborted");
  const evaluated = await service.evaluateStocktake(request("manager", { sessionId: session.id, revision: session.revision }));
  session = evaluated.session;
  assert.equal(session.items[0].varianceBaseQuantity, -10);
  assert.equal(db.documents.get("products/water").quantity, 10, "reporting cannot change inventory");
  await reject(() => service.finaliseStocktake(request("manager", { sessionId: session.id, revision: session.revision, reasons: [] })), "failed-precondition");
  const finalised = await service.finaliseStocktake(request("manager", { sessionId: session.id, revision: session.revision, reasons: [{ productId: "water", reason: "Shelf empty" }] }));
  assert.equal(finalised.session.status, "finalised");
  await reject(() => service.finaliseStocktake(request("manager", { sessionId: session.id, revision: finalised.session.revision, reasons: [] })), "failed-precondition");
  assert.equal(db.documents.get("products/water").quantity, 10);
});

test("only active stock roles may create or save, and only reviewers may evaluate", async () => {
  const { service } = setup({ "users/disabled": { role: "storekeeper", active: false, fullName: "Disabled" } });
  await reject(() => service.startStocktake(request("sales", { idempotencyKey: "stocktake-sales-start-1", category: "Water" })), "permission-denied");
  await reject(() => service.startStocktake(request("disabled", { idempotencyKey: "stocktake-disabled-start-1", category: "Water" })), "permission-denied");
  let session = (await service.startStocktake(request("keeper", { idempotencyKey: "stocktake-review-role-1", category: "Water" }))).session;
  await reject(() => service.saveCounts(request("sales", { sessionId: session.id, revision: session.revision, counts: [{ productId: "water", quantity: 1, unit: "base" }] })), "permission-denied");
  session = (await service.saveCounts(request("keeper", { sessionId: session.id, revision: session.revision, counts: [{ productId: "water", quantity: 1, unit: "base" }] }))).session;
  await reject(() => service.evaluateStocktake(request("keeper", { sessionId: session.id, revision: session.revision })), "permission-denied");
  await reject(() => service.saveCounts(request("keeper", { sessionId: session.id, revision: session.revision, counts: [{ productId: "water", quantity: 1, unit: "bulk" }] })), "invalid-argument");
});

test("movement or conversion changes make a comparison stale instead of inventing an adjusted variance", async () => {
  const { db, service } = setup();
  let session = (await service.startStocktake(request("keeper", { idempotencyKey: "stocktake-stale-start-1", category: "Water" }))).session;
  session = (await service.saveCounts(request("keeper", { sessionId: session.id, revision: session.revision, counts: [{ productId: "water", quantity: 10, unit: "base" }] }))).session;
  db.documents.set("products/water", { ...db.documents.get("products/water"), quantity: 10, unitsPerBulk: 6, updatedAt: "2026-01-04T12:00:00.000Z" });
  const stale = await service.evaluateStocktake(request("manager", { sessionId: session.id, revision: session.revision }));
  assert.equal(stale.stale, true);
  assert.equal(stale.session.status, "stale");
  assert.equal(stale.session.items[0].varianceBaseQuantity, null);
});

test("legacy products with no pack fields retain their normalised snapshot conversion", async () => {
  const { service } = setup({ "products/water": { name: "Water", category: "Water", active: true, quantity: 10, updatedAt: "2026-01-04T10:00:00.000Z" } });
  let session = (await service.startStocktake(request("keeper", { idempotencyKey: "stocktake-default-unit-1", category: "Water" }))).session;
  session = (await service.saveCounts(request("keeper", { sessionId: session.id, revision: session.revision, counts: [{ productId: "water", quantity: 10, unit: "base" }] }))).session;
  assert.equal((await service.evaluateStocktake(request("manager", { sessionId: session.id, revision: session.revision }))).session.status, "evaluated");
});

test("mixed v2 categories are identified rather than silently partially counted", async () => {
  const { service } = setup({ "products/v2-water": { name: "Secure Water", category: "Water", active: true, inventorySchemaVersion: 2, quantity: 1, updatedAt: "2026-01-04T10:00:00.000Z" } });
  await reject(() => service.startStocktake(request("admin", { idempotencyKey: "stocktake-v2-category-1", category: "Water" })), "failed-precondition");
});

test("Sunday cycle remains Africa/Accra based and admin schedule changes are controlled", async () => {
  const { db, service } = setup();
  assert.equal(service.cycleKey(0), "2026-01-04");
  await reject(() => service.updateWeeklySchedule(request("manager", { scheduledWeekday: 1 })), "permission-denied");
  await service.updateWeeklySchedule(request("admin", { scheduledWeekday: 1 }));
  assert.equal(db.documents.get("settings/weeklyStocktaking").scheduledWeekday, 1);
});
