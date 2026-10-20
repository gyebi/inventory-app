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
            ref,
            exists: value !== undefined,
            data: () => structuredClone(value)
          };
        },
        set(ref, value) {
          writes.push([ref.path, structuredClone(value)]);
        },
        update(ref, value) {
          const previous = documents.get(ref.path);
          if (previous === undefined) throw new Error(`Missing document ${ref.path}`);
          writes.push([ref.path, { ...structuredClone(previous), ...structuredClone(value) }]);
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
    { "products/water": { active: true } },
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


const quoteRequest = (items, uid = "sales") => request({
  items,
  paymentMethod: "cash"
}, uid);

test("opening-stock quote calculates approved prices and taxes without writes", async () => {
  const { api, documents } = fixture({
    "settings/tax": {
      enabled: true, taxMode: "standard",
      vatRate: 15, nhilRate: 2.5, getfundRate: 2.5,
      withholdingVatRate: 7
    }
  });
  await api.configureProduct(request());
  const before = structuredClone([...documents.entries()]);

  const result = await api.quoteSale(quoteRequest([
    { productId: "water", quantity: 2, unit: "bulk" },
    { productId: "water", quantity: 3, unit: "base" }
  ]));

  assert.equal(result.sale.subtotalPesewas, 7300);
  assert.equal(result.sale.totalAmountPesewas, 8761);
  assert.equal(result.sale.items[0].unit, "Carton");
  assert.equal(result.sale.items[0].actualQtySold, 24);
  assert.equal(result.sale.items[1].unit, "Bottle");
  assert.equal(result.sale.items[1].actualQtySold, 3);
  assert.equal(result.sale.profit, null);
  assert.equal(result.sale.costStatus, "unknown");
  assert.deepEqual(result.sale.items[0].batchAllocations, []);
  assert.deepEqual([...documents.entries()], before);
});

test("opening-stock quote fingerprint is stable and detects setup and tax changes", async () => {
  const { api, documents } = fixture();
  await api.configureProduct(request());
  const input = quoteRequest([
    { productId: "water", quantity: 1, unit: "bulk" }
  ]);

  const first = await api.quoteSale(input);
  const repeated = await api.quoteSale(input);
  assert.match(first.quoteFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(repeated.quoteFingerprint, first.quoteFingerprint);

  await api.configureProduct(request({
    ...payload(), expectedRevision: 1, bulkPricePesewas: 3500
  }));
  const repriced = await api.quoteSale(input);
  assert.notEqual(repriced.quoteFingerprint, first.quoteFingerprint);

  documents.set("settings/tax", {
    enabled: true, taxMode: "standard",
    vatRate: 10, nhilRate: 0, getfundRate: 0,
    withholdingVatRate: 0
  });
  const retaxed = await api.quoteSale(input);
  assert.notEqual(retaxed.quoteFingerprint, repriced.quoteFingerprint);
  assert.equal(retaxed.sale.totalAmountPesewas, 3850);
});

test("opening-stock quotes require an authorized active cashier and explicit setup", async () => {
  const { api, documents } = fixture();
  const input = [{ productId: "water", quantity: 1, unit: "base" }];

  await rejectsCode(() => api.quoteSale(quoteRequest(input)), "failed-precondition");
  await api.configureProduct(request());

  await rejectsCode(
    () => api.quoteSale({ data: quoteRequest(input).data }),
    "unauthenticated"
  );
  documents.set("users/keeper", { role: "storekeeper", active: true });
  await rejectsCode(
    () => api.quoteSale(quoteRequest(input, "keeper")),
    "permission-denied"
  );
  documents.set("users/sales", { role: "sales", active: false });
  await rejectsCode(
    () => api.quoteSale(quoteRequest(input)), "permission-denied"
  );
});

test("opening-stock quote rejects tampering and invalid or duplicate quantities", async () => {
  const { api } = fixture();
  await api.configureProduct(request());
  const line = { productId: "water", quantity: 1, unit: "base" };

  for (const items of [
    [],
    [{ ...line, quantity: 0 }],
    [{ ...line, quantity: 1.5 }],
    [{ ...line, quantity: 1000001 }],
    [{ ...line, unit: "crate" }],
    [{ ...line, unitPricePesewas: 1 }],
    [line, line],
    Array.from({ length: 21 }, () => line)
  ]) {
    await rejectsCode(
      () => api.quoteSale(quoteRequest(items)), "invalid-argument"
    );
  }

  await rejectsCode(
    () => api.quoteSale(request({
      items: [line], paymentMethod: "cash", totalAmount: 1
    }, "sales")),
    "invalid-argument"
  );
});

test("counting, verified, v2 and newly stocked products cannot receive opening-stock quotes", async () => {
  const { api, documents } = fixture();
  await api.configureProduct(request());
  const setup = structuredClone(documents.get("openingStockProducts/water"));
  const product = structuredClone(documents.get("products/water"));
  const input = quoteRequest([
    { productId: "water", quantity: 1, unit: "base" }
  ]);

  for (const status of ["counting", "verified"]) {
    documents.set("openingStockProducts/water", { ...setup, status });
    await rejectsCode(() => api.quoteSale(input), "failed-precondition");
  }

  documents.set("openingStockProducts/water", setup);
  for (const change of [
    { inventorySchemaVersion: 2 },
    { quantity: 5 },
    { sellableQuantity: 5 },
    { active: false }
  ]) {
    documents.set("products/water", { ...product, ...change });
    await rejectsCode(() => api.quoteSale(input), "failed-precondition");
  }
});

test("opening-stock submission is immutable, idempotent, tax-priced, and does not deduct stock", async () => {
  const { api, documents } = fixture({
    "settings/tax": { enabled: true, taxMode: "standard", vatRate: 15, nhilRate: 2.5, getfundRate: 2.5, withholdingVatRate: 7 }
  });
  await api.configureProduct(request());
  const quote = await api.quoteSale(quoteRequest([{ productId: "water", quantity: 2, unit: "bulk" }]));
  const saleRequest = request({
    idempotencyKey: "opening-submit-retry-0001",
    items: [{ productId: "water", quantity: 2, unit: "bulk" }],
    paymentMethod: "cash",
    expectedQuoteFingerprint: quote.quoteFingerprint
  }, "sales");
  const first = await api.submitSale(saleRequest);
  const retry = await api.submitSale(saleRequest);
  assert.deepEqual(retry, first);
  assert.equal(documents.get("products/water").quantity, 0);
  const sale = documents.get(`sales/${first.saleId}`);
  assert.equal(sale.openingStock, true);
  assert.equal(sale.stockEffect, "unverified");
  assert.equal(sale.profit, null);
  assert.equal(sale.items[0].actualQtySold, 24);
  assert.equal(sale.taxBreakdown.totalAmount, sale.totalAmount);
  assert.equal(documents.get("openingStockProducts/water").salesStarted, true);
  await rejectsCode(() => api.submitSale(request({ ...saleRequest.data, items: [{ productId: "water", quantity: 3, unit: "bulk" }] }, "sales")), "already-exists");
});

test("stale opening-stock confirmation and inactive cashiers cannot submit", async () => {
  const { api, documents } = fixture();
  await api.configureProduct(request());
  const quote = await api.quoteSale(quoteRequest([{ productId: "water", quantity: 1, unit: "base" }]));
  documents.set("settings/tax", { enabled: true, taxMode: "standard", vatRate: 10, nhilRate: 0, getfundRate: 0, withholdingVatRate: 0 });
  await rejectsCode(() => api.submitSale(request({ idempotencyKey: "opening-stale-quote-001", items: [{ productId: "water", quantity: 1, unit: "base" }], paymentMethod: "cash", expectedQuoteFingerprint: quote.quoteFingerprint }, "sales")), "failed-precondition");
  documents.set("users/sales", { role: "sales", active: false });
  await rejectsCode(() => api.submitSale(request({ idempotencyKey: "opening-inactive-sale-01", items: [{ productId: "water", quantity: 1, unit: "base" }], paymentMethod: "cash", expectedQuoteFingerprint: quote.quoteFingerprint }, "sales")), "permission-denied");
});

test("count cancellation releases the opening-sale lock and confirmation activates explicit zero or counted batches once", async () => {
  const { api, documents } = fixture();
  await api.configureProduct(request());
  const started = await api.startCount(request({ productId: "water", expectedRevision: 1 }));
  assert.equal(documents.get("openingStockProducts/water").status, "counting");
  await rejectsCode(() => api.quoteSale(quoteRequest([{ productId: "water", quantity: 1, unit: "base" }])) , "failed-precondition");
  await api.cancelCount(request({ productId: "water", expectedRevision: started.count.setupRevision }));
  assert.equal(documents.get("openingStockProducts/water").status, "unverified");
  await assert.doesNotReject(() => api.quoteSale(quoteRequest([{ productId: "water", quantity: 1, unit: "base" }])));

  const restarted = await api.startCount(request({ productId: "water", expectedRevision: 3 }));
  const confirmed = await api.confirmCount(request({ productId: "water", expectedRevision: restarted.count.setupRevision, batches: [
    { reference: "Shelf A", baseQuantity: 12 }, { reference: "Shelf B", baseQuantity: 3 }
  ] }));
  assert.equal(confirmed.balance.totalBaseQuantity, 15);
  assert.equal(documents.get("products/water").quantity, 15);
  assert.equal(documents.get("products/water").sellingPrice, 3);
  assert.equal(documents.get("products/water").bulkSellingPrice, 32);
  assert.equal(documents.get("openingStockProducts/water").status, "verified");
  assert.equal(documents.get("openingStockBalances/water").batches[0].expiryDate, null);
  assert.equal(documents.get("openingStockBalances/water").costStatus, "unknown");
  await rejectsCode(() => api.confirmCount(request({ productId: "water", expectedRevision: restarted.count.setupRevision, batches: [] })), "aborted");
});

test("invalid persisted opening prices cannot activate a zero-price legacy checkout", async () => {
  const { api, documents } = fixture();
  await api.configureProduct(request());
  const started = await api.startCount(request({ productId: "water", expectedRevision: 1 }));
  documents.set("openingStockProducts/water", {
    ...documents.get("openingStockProducts/water"),
    basePricePesewas: 0
  });

  await rejectsCode(() => api.confirmCount(request({
    productId: "water", expectedRevision: started.count.setupRevision, batches: [{ reference: "Shelf A", baseQuantity: 15 }]
  })), "invalid-argument");
  assert.equal(documents.get("products/water").quantity, 0);
  assert.equal(documents.has("openingStockBalances/water"), false);
});

test("explicit zero opening count activates normal stock control without inventing a purchase", async () => {
  const { api, documents } = fixture();
  await api.configureProduct(request());
  const started = await api.startCount(request({ productId: "water", expectedRevision: 1 }));
  const confirmed = await api.confirmCount(request({ productId: "water", expectedRevision: started.count.setupRevision, batches: [] }));
  assert.equal(confirmed.balance.totalBaseQuantity, 0);
  assert.equal(documents.get("products/water").quantity, 0);
  assert.equal(documents.has("stockReceipts/water"), false);
  assert.equal(documents.get("openingStockBalances/water").batches.length, 0);
});
