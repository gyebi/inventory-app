"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createSecureSalesService } = require("../services/secureSalesService");

class FakeHttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const fakeFieldValue = {
  serverTimestamp: () => "<server-timestamp>"
};

const clone = (value) => structuredClone(value);

class FakeDocumentReference {
  constructor(db, path) {
    this.db = db;
    this.path = path;
    this.id = path.split("/").pop();
  }
}

class FakeTransaction {
  constructor(db) {
    this.db = db;
    this.writes = [];
  }

  async get(ref) {
    const data = this.db.documents.get(ref.path);

    return {
      id: ref.id,
      exists: data !== undefined,
      data: () => data === undefined ? undefined : clone(data)
    };
  }

  update(ref, values) {
    this.writes.push({ type: "update", ref, values: clone(values) });
  }

  set(ref, values) {
    this.writes.push({ type: "set", ref, values: clone(values) });
  }

  commit() {
    for (const write of this.writes) {
      const existing = this.db.documents.get(write.ref.path);

      if (write.type === "update" && existing === undefined) {
        throw new Error(`Cannot update missing document ${write.ref.path}`);
      }

      this.db.documents.set(
        write.ref.path,
        write.type === "set" ? clone(write.values) : { ...existing, ...clone(write.values) }
      );
    }
  }
}

class FakeFirestore {
  constructor(seed = {}) {
    this.documents = new Map(Object.entries(seed).map(([path, data]) => [path, clone(data)]));
    this.transactionTail = Promise.resolve();
  }

  collection(collectionName) {
    return {
      doc: (id) => new FakeDocumentReference(this, `${collectionName}/${id}`)
    };
  }

  async runTransaction(callback) {
    const previous = this.transactionTail;
    let release;
    this.transactionTail = new Promise((resolve) => {
      release = resolve;
    });
    await previous;

    try {
      const transaction = new FakeTransaction(this);
      const result = await callback(transaction);
      transaction.commit();
      return result;
    } finally {
      release();
    }
  }
}

function createService(seed = {}) {
  const db = new FakeFirestore({
    "users/sales-user": {
      uid: "sales-user",
      fullName: "Sales User",
      username: "sales.user",
      role: "sales",
      active: true
    },
    "settings/tax": {
      enabled: true,
      vatRate: 15,
      nhilRate: 2.5,
      getfundRate: 2.5,
      withholdingVatRate: 7,
      taxMode: "standard",
      effectiveDate: "2026-10-01"
    },
    "products/water": {
      name: "Water",
      quantity: 10,
      unitsPerBulk: 12,
      sellingPrice: 6,
      bulkSellingPrice: 72,
      active: true
    },
    ...seed
  });

  return {
    db,
    service: createSecureSalesService({ db, FieldValue: fakeFieldValue, HttpsError: FakeHttpsError })
  };
}

function saleRequest(overrides = {}) {
  return {
    auth: { uid: "sales-user" },
    data: {
      idempotencyKey: "sale-request-000001",
      items: [{ productId: "water", quantity: 2, unit: "base" }],
      paymentMethod: "cash",
      ...overrides
    }
  };
}

async function expectError(action, code) {
  await assert.rejects(action, (error) => error instanceof FakeHttpsError && error.code === code);
}

test("submits canonical server-priced receipt data in integer pesewas", async () => {
  const { db, service } = createService();
  const result = await service.submitSecureSale(saleRequest());

  assert.equal(result.committed, true);
  assert.equal(result.currency, "GHS");
  assert.equal(result.createdBy.uid, "sales-user");
  assert.equal(result.items[0].unitPricePesewas, 600);
  assert.equal(result.items[0].lineTotalPesewas, 1200);
  assert.equal(result.subtotalPesewas, 1200);
  assert.equal(result.taxBreakdown.taxAmountPesewas, 240);
  assert.equal(result.totalAmountPesewas, 1440);
  assert.equal(db.documents.get("products/water").quantity, 8);
  assert.equal(db.documents.get(`sales/${result.saleId}`).totalAmountPesewas, 1440);
});

test("a repeated idempotency key returns the original committed sale without another deduction", async () => {
  const { db, service } = createService();
  const request = saleRequest();
  const first = await service.submitSecureSale(request);
  const second = await service.submitSecureSale(request);

  assert.deepEqual(second, first);
  assert.equal(db.documents.get("products/water").quantity, 8);
  assert.equal([...db.documents.keys()].filter((path) => path.startsWith("sales/")).length, 1);
  assert.equal([...db.documents.keys()].filter((path) => path.startsWith("saleRequests/")).length, 1);
});

test("a retry after an uncertain result cannot create a second sale", async () => {
  const { db, service } = createService();
  const request = saleRequest({ idempotencyKey: "uncertain-result-0001" });

  await service.submitSecureSale(request);
  const retry = await service.submitSecureSale(request);

  assert.equal(retry.saleId.startsWith("SEC-"), true);
  assert.equal(db.documents.get("products/water").quantity, 8);
  assert.equal([...db.documents.keys()].filter((path) => path.startsWith("sales/")).length, 1);
});

test("concurrent requests cannot oversell the authoritative product quantity", async () => {
  const { db, service } = createService({
    "products/water": {
      name: "Water",
      quantity: 1,
      unitsPerBulk: 12,
      sellingPrice: 6,
      active: true
    }
  });
  const first = saleRequest({ idempotencyKey: "concurrent-sale-0001", items: [{ productId: "water", quantity: 1, unit: "base" }] });
  const second = saleRequest({ idempotencyKey: "concurrent-sale-0002", items: [{ productId: "water", quantity: 1, unit: "base" }] });
  const results = await Promise.allSettled([
    service.submitSecureSale(first),
    service.submitSecureSale(second)
  ]);

  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.equal(results.find((result) => result.status === "rejected").reason.code, "failed-precondition");
  assert.equal(db.documents.get("products/water").quantity, 0);
  assert.equal([...db.documents.keys()].filter((path) => path.startsWith("sales/")).length, 1);
});

test("rejects invalid client prices and invalid quantities", async () => {
  const { service } = createService();

  await expectError(
    () => service.submitSecureSale(saleRequest({ items: [{ productId: "water", quantity: 1, unit: "base", unitPrice: 0.01 }] })),
    "invalid-argument"
  );
  await expectError(
    () => service.submitSecureSale(saleRequest({ items: [{ productId: "water", quantity: 0, unit: "base" }] })),
    "invalid-argument"
  );
  await expectError(
    () => service.submitSecureSale(saleRequest({ items: [{ productId: "water", quantity: 1, unit: "each" }] })),
    "invalid-argument"
  );
});

test("rejects unauthenticated, inactive, and non-sales callers", async () => {
  const unauthenticated = createService();
  await expectError(() => unauthenticated.service.submitSecureSale({ data: saleRequest().data }), "unauthenticated");

  const inactive = createService({
    "users/sales-user": { uid: "sales-user", role: "sales", active: false }
  });
  await expectError(() => inactive.service.submitSecureSale(saleRequest()), "permission-denied");

  const manager = createService({
    "users/sales-user": { uid: "sales-user", role: "manager", active: true }
  });
  await expectError(() => manager.service.submitSecureSale(saleRequest()), "permission-denied");
});

test("transaction failures do not partially deduct stock", async () => {
  const { db, service } = createService();
  const request = saleRequest({
    idempotencyKey: "partial-failure-0001",
    items: [
      { productId: "water", quantity: 2, unit: "base" },
      { productId: "missing-product", quantity: 1, unit: "base" }
    ]
  });

  await expectError(() => service.submitSecureSale(request), "not-found");

  assert.equal(db.documents.get("products/water").quantity, 10);
  assert.equal([...db.documents.keys()].some((path) => path.startsWith("sales/")), false);
  assert.equal([...db.documents.keys()].some((path) => path.startsWith("saleRequests/")), false);
});

test("requires a canonical product-level price rather than trusting batch or client price data", async () => {
  const { service } = createService({
    "products/water": {
      name: "Water",
      quantity: 10,
      unitsPerBulk: 12,
      active: true
    }
  });

  await expectError(() => service.submitSecureSale(saleRequest()), "failed-precondition");
});
