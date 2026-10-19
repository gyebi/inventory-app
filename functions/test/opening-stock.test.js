"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createOpeningStockService } =
  require("../services/openingStockService");

class FakeHttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function fixture(overrides = {}) {
  const documents = new Map(Object.entries({
    "users/admin": { role: "admin", active: true },
    "users/sales": { role: "sales", active: true },
    "settings/secureSales": { enabled: false },
    "settings/tax": { enabled: false, taxMode: "exempt" },
    "products/water": { name: "Water", quantity: 0, active: true },
    ...overrides
  }));

  const db = {
    collection(name) {
      return { doc(id) { return { path: `${name}/${id}` }; } };
    },
    async runTransaction(callback) {
      const writes = [];
      const result = await callback({
        async get(ref) {
          const value = documents.get(ref.path);
          return {
            exists: value !== undefined,
            data: () => structuredClone(value)
          };
        },
        set(ref, value) {
          writes.push([ref.path, structuredClone(value)]);
        }
      });
      for (const [path, value] of writes) documents.set(path, value);
      return result;
    }
  };

  const api = createOpeningStockService({
    db,
    FieldValue: { serverTimestamp: () => "<server-timestamp>" },
    HttpsError: FakeHttpsError
  });

  return { api, documents };
}

const payload = () => ({
  productId: "water",
  baseUnit: "Bottle",
  bulkUnit: "Carton",
  unitsPerBulk: 12,
  basePricePesewas: 300,
  bulkPricePesewas: 3200,
  expectedRevision: 0,
  confirmUncounted: true
});

const request = (data = payload(), uid = "admin") => ({
  auth: { uid }, data
});

const rejectsCode = (work, code) =>
  assert.rejects(work, (error) =>
    error instanceof FakeHttpsError && error.code === code);

test("Admin setup preserves product stock, prices and tax settings", async () => {
  const { api, documents } = fixture();
  const beforeProduct = structuredClone(documents.get("products/water"));
  const beforeTax = structuredClone(documents.get("settings/tax"));

  const result = await api.configureProduct(request());

  assert.deepEqual(documents.get("products/water"), beforeProduct);
  assert.deepEqual(documents.get("settings/tax"), beforeTax);
  assert.equal(result.setup.status, "unverified");
  assert.equal(result.setup.unitsPerBulk, 12);
  assert.equal(result.setup.bulkPricePesewas, 3200);
  assert.equal(result.setup.revision, 1);
  assert.equal(JSON.stringify(result).includes("<server-timestamp>"), false);
  assert.equal(documents.size, 6);
});

test("unauthenticated, sales and inactive Admin callers cannot configure", async () => {
  const { api, documents } = fixture();
  await rejectsCode(
    () => api.configureProduct({ data: payload() }), "unauthenticated"
  );
  await rejectsCode(
    () => api.configureProduct(request(payload(), "sales")),
    "permission-denied"
  );
  documents.set("users/admin", { role: "admin", active: false });
  await rejectsCode(() => api.configureProduct(request()), "permission-denied");
  assert.equal(documents.has("openingStockProducts/water"), false);
});

test("invalid packaging, prices, confirmation and unsupported fields reject", async () => {
  for (const change of [
    { unitsPerBulk: 0 },
    { unitsPerBulk: 1.5 },
    { basePricePesewas: 0 },
    { bulkPricePesewas: Number.MAX_SAFE_INTEGER },
    { baseUnit: "" },
    { bulkUnit: "Bottle", unitsPerBulk: 12 },
    { quantity: 999 }
  ]) {
    const { api, documents } = fixture();
    await rejectsCode(
      () => api.configureProduct(request({ ...payload(), ...change })),
      "invalid-argument"
    );
    assert.equal(documents.has("openingStockProducts/water"), false);
  }
  const { api } = fixture();
  await rejectsCode(
    () => api.configureProduct(request({
      ...payload(), confirmUncounted: false
    })),
    "failed-precondition"
  );
});

test("recorded stock, v2, secure mode and missing tax setup remain protected", async () => {
  for (const overrides of [
    { "products/water": { quantity: 10 } },
    { "products/water": { quantity: 0, sellableQuantity: 2 } },
    { "products/water": { quantity: 0, inventorySchemaVersion: 2 } },
    { "products/water": { quantity: 0, active: false } },
    { "settings/secureSales": { enabled: true } }
  ]) {
    const { api, documents } = fixture(overrides);
    await rejectsCode(() => api.configureProduct(request()), "failed-precondition");
    assert.equal(documents.has("openingStockProducts/water"), false);
  }
  const { api, documents } = fixture();
  documents.delete("settings/tax");
  await rejectsCode(() => api.configureProduct(request()), "failed-precondition");
});

test("stale edits reject and details lock after sales or counting starts", async () => {
  const { api, documents } = fixture();
  await api.configureProduct(request());
  await rejectsCode(() => api.configureProduct(request()), "aborted");

  await api.configureProduct(request({
    ...payload(), expectedRevision: 1, bulkPricePesewas: 3300
  }));

  const saved = documents.get("openingStockProducts/water");
  assert.equal(saved.revision, 2);

  for (const change of [
    { salesStarted: true },
    { status: "counting" },
    { status: "verified" }
  ]) {
    documents.set("openingStockProducts/water", { ...saved, ...change });
    await rejectsCode(
      () => api.configureProduct(request({
        ...payload(), expectedRevision: 2
      })),
      "failed-precondition"
    );
  }
});
