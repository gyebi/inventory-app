"use strict";

const crypto = require("node:crypto");

const SALES_ROLES = new Set(["admin", "sales"]);
const PAYMENT_METHODS = new Set(["cash", "mobile_money", "card", "credit", "other"]);
const TAX_MODES = new Set(["standard", "zeroRated", "exempt"]);
const BUSINESS_TIME_ZONE = "Africa/Accra";
const MAX_ITEMS_PER_SALE = 20;
const MAX_BATCHES_PER_PRODUCT = 10;
const MAX_BATCH_WRITES_PER_SALE = MAX_ITEMS_PER_SALE * MAX_BATCHES_PER_PRODUCT;
const DEFAULT_TAX_SETTINGS = {
  enabled: true, vatRate: 15, nhilRate: 2.5, getfundRate: 2.5, withholdingVatRate: 7, effectiveDate: null, taxMode: "standard"
};

function createSecureSalesService({ db, FieldValue, HttpsError, now = () => new Date() }) {
  const fail = (code, message) => { throw new HttpsError(code, message); };
  const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
  const safeInteger = (value, field, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
    if (!Number.isSafeInteger(value) || value < min || value > max) fail("failed-precondition", `${field} must be a safe integer from ${min} to ${max}.`);
    return value;
  };
  const add = (left, right, field) => {
    if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right) || right > Number.MAX_SAFE_INTEGER - left) fail("failed-precondition", `${field} exceeds supported integer precision.`);
    return left + right;
  };
  const multiply = (left, right, field) => {
    if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right) || left < 0 || right < 0 || (left && right > Math.floor(Number.MAX_SAFE_INTEGER / left))) fail("failed-precondition", `${field} exceeds supported integer precision.`);
    return left * right;
  };
  const object = (value, field) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail("invalid-argument", `${field} must be an object.`);
    return value;
  };
  const allowed = (value, fields, field) => Object.keys(value).forEach((key) => {
    if (!fields.has(key)) fail("invalid-argument", `${field}.${key} is not supported.`);
  });

  function normalizeRequest(data) {
    const request = object(data, "request");
    allowed(request, new Set(["idempotencyKey", "items", "paymentMethod"]), "request");
    const idempotencyKey = String(request.idempotencyKey || "").trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{15,127}$/.test(idempotencyKey)) fail("invalid-argument", "idempotencyKey must be 16-128 URL-safe characters and be persisted before submission.");
    if (!Array.isArray(request.items) || request.items.length < 1 || request.items.length > MAX_ITEMS_PER_SALE) fail("invalid-argument", `items must contain between 1 and ${MAX_ITEMS_PER_SALE} items.`);
    const ids = new Set();
    const items = request.items.map((raw, index) => {
      const item = object(raw, `items[${index}]`);
      allowed(item, new Set(["productId", "quantity", "unit"]), `items[${index}]`);
      const productId = String(item.productId || "").trim();
      if (!productId || productId.length > 128 || productId.includes("/")) fail("invalid-argument", "Each item must contain a valid productId.");
      if (ids.has(productId)) fail("invalid-argument", "Each product may appear only once in a sale request.");
      ids.add(productId);
      if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 1000000) fail("invalid-argument", "Each item quantity must be a whole number from 1 to 1,000,000.");
      const unit = String(item.unit || "").trim().toLowerCase();
      if (unit !== "base" && unit !== "bulk") fail("invalid-argument", "Each item unit must be either base or bulk.");
      return { productId, quantity: item.quantity, unit };
    });
    const paymentMethod = request.paymentMethod === undefined || request.paymentMethod === null || request.paymentMethod === "" ? null : String(request.paymentMethod).trim().toLowerCase();
    if (paymentMethod !== null && !PAYMENT_METHODS.has(paymentMethod)) fail("invalid-argument", "paymentMethod is not supported.");
    return { idempotencyKey, items, paymentMethod };
  }

  function normalizedTax(data = {}) {
    const settings = { ...DEFAULT_TAX_SETTINGS, ...data };
    const taxMode = String(settings.taxMode || DEFAULT_TAX_SETTINGS.taxMode);
    if (!TAX_MODES.has(taxMode)) fail("failed-precondition", "settings/tax contains an unsupported taxMode.");
    const rate = (value, field) => {
      const number = Number(value);
      if (!Number.isFinite(number) || number < 0 || number > 100) fail("failed-precondition", `${field} must be a percentage from 0 to 100.`);
      return Math.round(number * 100);
    };
    return {
      enabled: settings.enabled !== false && taxMode !== "exempt", taxMode, effectiveDate: settings.effectiveDate || null,
      vatRateBasisPoints: rate(settings.vatRate, "settings/tax.vatRate"),
      nhilRateBasisPoints: rate(settings.nhilRate, "settings/tax.nhilRate"),
      getfundRateBasisPoints: rate(settings.getfundRate, "settings/tax.getfundRate"),
      withholdingVatRateBasisPoints: rate(settings.withholdingVatRate, "settings/tax.withholdingVatRate")
    };
  }

  function calculateTax(subtotalPesewas, tax) {
    const percentage = (basisPoints, field) => Math.round(multiply(subtotalPesewas, basisPoints, field) / 10000);
    const chargeable = tax.enabled && tax.taxMode === "standard";
    const vatAmountPesewas = chargeable ? percentage(tax.vatRateBasisPoints, "VAT") : 0;
    const nhilAmountPesewas = chargeable ? percentage(tax.nhilRateBasisPoints, "NHIL") : 0;
    const getfundAmountPesewas = chargeable ? percentage(tax.getfundRateBasisPoints, "GETFund") : 0;
    const withholdingVatAmountPesewas = chargeable ? percentage(tax.withholdingVatRateBasisPoints, "withholding VAT") : 0;
    const taxAmountPesewas = add(add(vatAmountPesewas, nhilAmountPesewas, "tax total"), getfundAmountPesewas, "tax total");
    return { ...tax, enabled: chargeable, subtotalPesewas, vatAmountPesewas, nhilAmountPesewas, getfundAmountPesewas, withholdingVatAmountPesewas, taxAmountPesewas, totalAmountPesewas: add(subtotalPesewas, taxAmountPesewas, "sale total") };
  }

  function businessDate() {
    const date = now();
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) fail("internal", "The server clock is invalid.");
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date)
      .reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  function expiryState(batch, today) {
    const value = batch.expiryBusinessDate ?? batch.expiryDate;
    if (value === undefined || value === null || value === "") return { kind: "undated" };
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return { kind: "malformed" };
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return { kind: "malformed" };
    return value < today ? { kind: "expired", date: value } : { kind: "valid", date: value };
  }

  function parseBatch(snapshot, productId, today) {
    const data = snapshot.data() || {};
    if (data.productId !== productId) fail("failed-precondition", `Batch ${snapshot.id} has an invalid product reference.`);
    const originalBaseQuantity = safeInteger(data.originalBaseQuantity, `Batch ${snapshot.id}.originalBaseQuantity`, { min: 1 });
    const remainingBaseQuantity = safeInteger(data.remainingBaseQuantity, `Batch ${snapshot.id}.remainingBaseQuantity`, { min: 0, max: originalBaseQuantity });
    const costAllocatedBaseQuantity = safeInteger(data.costAllocatedBaseQuantity ?? (originalBaseQuantity - remainingBaseQuantity), `Batch ${snapshot.id}.costAllocatedBaseQuantity`, { min: 0, max: originalBaseQuantity });
    const receivedAtValue = data.receivedAt && typeof data.receivedAt.toDate === "function" ? data.receivedAt.toDate() : new Date(data.receivedAt);
    if (!data.receivedAt || Number.isNaN(receivedAtValue.getTime())) fail("failed-precondition", `Batch ${snapshot.id} must contain a valid receivedAt timestamp.`);
    return {
      id: snapshot.id, ref: snapshot.ref, originalBaseQuantity, remainingBaseQuantity, costAllocatedBaseQuantity,
      totalLandedCostPesewas: safeInteger(data.totalLandedCostPesewas, `Batch ${snapshot.id}.totalLandedCostPesewas`, { min: 0 }),
      receivedAt: data.receivedAt, receivedAtMs: receivedAtValue.getTime(), expiry: expiryState(data, today),
      inventoryStatus: String(data.inventoryStatus || "active"), baseUnit: String(data.baseUnit || ""), bulkUnit: String(data.bulkUnit || ""),
      unitsPerBulk: safeInteger(data.unitsPerBulk, `Batch ${snapshot.id}.unitsPerBulk`, { min: 1 })
    };
  }

  const sellable = (batch) => batch.remainingBaseQuantity > 0 && batch.inventoryStatus === "active" && (batch.expiry.kind === "valid" || batch.expiry.kind === "undated");
  function compareBatches(left, right) {
    const leftGroup = left.expiry.kind === "valid" ? 0 : 1;
    const rightGroup = right.expiry.kind === "valid" ? 0 : 1;
    if (leftGroup !== rightGroup) return leftGroup - rightGroup;
    if (leftGroup === 0 && left.expiry.date !== right.expiry.date) return left.expiry.date.localeCompare(right.expiry.date);
    return left.receivedAtMs === right.receivedAtMs ? left.id.localeCompare(right.id) : left.receivedAtMs - right.receivedAtMs;
  }

  function allocate(batches, baseQuantity, productId) {
    if (batches.some((batch) => batch.expiry.kind === "malformed" && batch.remainingBaseQuantity > 0 && batch.inventoryStatus === "active")) {
      fail("failed-precondition", `Product ${productId} has malformed expiry data. Quarantine the affected batches before sale.`);
    }
    let outstanding = baseQuantity;
    const allocations = [];
    for (const batch of batches.filter(sellable).sort(compareBatches)) {
      if (!outstanding) break;
      const quantity = Math.min(batch.remainingBaseQuantity, outstanding);
      const costBefore = Math.floor(multiply(batch.totalLandedCostPesewas, batch.costAllocatedBaseQuantity, `Batch ${batch.id} cumulative cost`) / batch.originalBaseQuantity);
      const newCostQuantity = add(batch.costAllocatedBaseQuantity, quantity, `Batch ${batch.id} cost allocation`);
      const costAfter = Math.floor(multiply(batch.totalLandedCostPesewas, newCostQuantity, `Batch ${batch.id} cumulative cost`) / batch.originalBaseQuantity);
      allocations.push({ batch, baseQuantity: quantity, allocatedCostPesewas: costAfter - costBefore, remainingBaseQuantity: batch.remainingBaseQuantity - quantity, costAllocatedBaseQuantity: newCostQuantity });
      outstanding -= quantity;
    }
    if (outstanding) fail("failed-precondition", `Insufficient sellable stock for product ${productId}.`);
    return allocations;
  }

  function pricing(product, unit) {
    if (product.pricingStatus !== "approved") fail("failed-precondition", "This product has no manager-approved canonical selling price.");
    const unitsPerBulk = safeInteger(product.unitsPerBulk, "Product unitsPerBulk", { min: 1 });
    const basePricePesewas = safeInteger(product.sellingPricePesewas, "Product sellingPricePesewas", { min: 1 });
    const bulkPricePesewas = product.bulkSellingPricePesewas === undefined || product.bulkSellingPricePesewas === null ? null : safeInteger(product.bulkSellingPricePesewas, "Product bulkSellingPricePesewas", { min: 1 });
    return { unitsPerBulk, basePricePesewas, bulkPricePesewas, unitPricePesewas: unit === "base" ? basePricePesewas : (bulkPricePesewas ?? multiply(basePricePesewas, unitsPerBulk, "derived bulk price")) };
  }

  function legacyTax(tax) {
    return {
      subtotal: tax.subtotalPesewas / 100, vatRate: tax.vatRateBasisPoints / 100, nhilRate: tax.nhilRateBasisPoints / 100, getfundRate: tax.getfundRateBasisPoints / 100, withholdingVatRate: tax.withholdingVatRateBasisPoints / 100,
      vatAmount: tax.vatAmountPesewas / 100, nhilAmount: tax.nhilAmountPesewas / 100, getfundAmount: tax.getfundAmountPesewas / 100, withholdingVatAmount: tax.withholdingVatAmountPesewas / 100,
      taxAmount: tax.taxAmountPesewas / 100, totalAmount: tax.totalAmountPesewas / 100, taxMode: tax.taxMode, enabled: tax.enabled, effectiveDate: tax.effectiveDate
    };
  }

  async function submitSecureSale(request) {
    if (!request.auth?.uid) fail("unauthenticated", "You must be signed in to submit a sale.");
    const uid = request.auth.uid;
    const payload = normalizeRequest(request.data);
    const requestFingerprint = hash(JSON.stringify(payload));
    const requestHash = hash(`${uid}\u0000${payload.idempotencyKey}`);
    const requestRef = db.collection("saleRequests").doc(requestHash);
    const saleRef = db.collection("sales").doc(`SEC-${requestHash.slice(0, 32)}`);

    return db.runTransaction(async (transaction) => {
      const existing = await transaction.get(requestRef);
      if (existing.exists) {
        const saved = existing.data() || {};
        if (saved.uid !== uid || saved.requestFingerprint !== requestFingerprint || !saved.response) fail("already-exists", "This idempotencyKey has already been used for a different sale request.");
        return saved.response;
      }
      const [profileSnapshot, taxSnapshot, modeSnapshot] = await Promise.all([
        transaction.get(db.collection("users").doc(uid)),
        transaction.get(db.collection("settings").doc("tax")),
        transaction.get(db.collection("settings").doc("secureSales"))
      ]);
      if (!modeSnapshot.exists || modeSnapshot.data()?.enabled !== true) fail("failed-precondition", "Secure sales is disabled. Legacy checkout remains the active path.");
      if (!profileSnapshot.exists) fail("permission-denied", "Caller staff profile was not found.");
      const profile = profileSnapshot.data() || {};
      if (profile.active === false || profile.isActive === false || !SALES_ROLES.has(profile.role)) fail("permission-denied", "This staff role cannot create sales.");
      const today = businessDate();
      const tax = normalizedTax(taxSnapshot.exists ? taxSnapshot.data() || {} : {});
      const inputs = [];
      for (const item of payload.items) {
        const productRef = db.collection("products").doc(item.productId);
        const productSnapshot = await transaction.get(productRef);
        if (!productSnapshot.exists) fail("not-found", `Product ${item.productId} was not found.`);
        const batchSnapshot = await transaction.get(db.collection("stockBatches").where("productId", "==", item.productId).limit(MAX_BATCHES_PER_PRODUCT + 1));
        if (batchSnapshot.size > MAX_BATCHES_PER_PRODUCT) fail("resource-exhausted", `Product ${item.productId} exceeds the ${MAX_BATCHES_PER_PRODUCT}-batch secure-sale limit. Reconcile batches before sale.`);
        inputs.push({ item, productRef, product: productSnapshot.data() || {}, snapshots: batchSnapshot.docs });
      }

      const items = [];
      const productUpdates = [];
      const allocationWrites = [];
      let subtotalPesewas = 0;
      for (const input of inputs) {
        const { item, productRef, product } = input;
        if (product.active === false || product.isActive === false) fail("failed-precondition", `Product ${item.productId} is inactive.`);
        if (product.inventorySchemaVersion !== 2) fail("failed-precondition", `Product ${item.productId} has not been migrated to authoritative batches.`);
        const productPricing = pricing(product, item.unit);
        const baseQuantity = item.unit === "bulk" ? multiply(item.quantity, productPricing.unitsPerBulk, `Product ${item.productId} base quantity`) : item.quantity;
        const batches = input.snapshots.map((snapshot) => parseBatch(snapshot, item.productId, today));
        if (item.unit === "bulk" && batches.some((batch) => batch.unitsPerBulk !== productPricing.unitsPerBulk)) {
          fail("failed-precondition", `Product ${item.productId} has batches with a different unitsPerBulk conversion. Sell by base unit or reconcile the packaging configuration.`);
        }
        const physicalQuantity = batches.reduce((sum, batch) => add(sum, batch.remainingBaseQuantity, `Product ${item.productId} physical quantity`), 0);
        const sellableQuantity = batches.filter(sellable).reduce((sum, batch) => add(sum, batch.remainingBaseQuantity, `Product ${item.productId} sellable quantity`), 0);
        if (safeInteger(product.quantity, `Product ${item.productId}.quantity`, { min: 0 }) !== physicalQuantity || safeInteger(product.sellableQuantity, `Product ${item.productId}.sellableQuantity`, { min: 0 }) !== sellableQuantity) fail("failed-precondition", `Product ${item.productId} aggregate quantities do not reconcile with stockBatches.`);
        const allocations = allocate(batches, baseQuantity, item.productId);
        const lineTotalPesewas = multiply(productPricing.unitPricePesewas, item.quantity, `Product ${item.productId} line total`);
        subtotalPesewas = add(subtotalPesewas, lineTotalPesewas, "sale subtotal");
        const batchAllocations = allocations.map((entry) => ({
          batchId: entry.batch.id, baseQuantity: entry.baseQuantity, quantity: entry.baseQuantity, expiryBusinessDate: entry.batch.expiry.date || null, expiryDate: entry.batch.expiry.date || "", allocatedCostPesewas: entry.allocatedCostPesewas, receivedAt: entry.batch.receivedAt
        }));
        items.push({
          productId: item.productId, name: String(product.name || item.productId), productNameSnapshot: String(product.name || item.productId), quantity: item.quantity, unit: item.unit, saleUnit: item.unit, baseQuantity, actualQtySold: baseQuantity,
          unitsPerBulk: productPricing.unitsPerBulk, unitPricePesewas: productPricing.unitPricePesewas, basePricePesewas: productPricing.basePricePesewas, bulkPricePesewas: productPricing.bulkPricePesewas, lineTotalPesewas,
          unitPrice: productPricing.unitPricePesewas / 100, total: lineTotalPesewas / 100, batchAllocations
        });
        productUpdates.push({ productRef, quantity: physicalQuantity - baseQuantity, sellableQuantity: sellableQuantity - baseQuantity });
        allocationWrites.push(...allocations.map((entry) => ({ productId: item.productId, entry })));
      }
      if (allocationWrites.length > MAX_BATCH_WRITES_PER_SALE) fail("resource-exhausted", "Sale exceeds the secure batch-allocation write limit.");
      const taxBreakdown = calculateTax(subtotalPesewas, tax);
      const committedAt = now().toISOString();
      const createdBy = { uid, fullName: profile.fullName || profile.displayName || profile.username || uid, username: profile.username || "", role: profile.role };
      const response = { saleId: saleRef.id, committed: true, committedAt, currency: "GHS", paymentMethod: payload.paymentMethod, createdBy, items, subtotalPesewas, taxBreakdown, totalAmountPesewas: taxBreakdown.totalAmountPesewas };

      productUpdates.forEach((entry) => transaction.update(entry.productRef, { quantity: entry.quantity, sellableQuantity: entry.sellableQuantity, updatedAt: FieldValue.serverTimestamp(), updatedBy: uid }));
      allocationWrites.forEach(({ productId, entry }) => {
        transaction.update(entry.batch.ref, { remainingBaseQuantity: entry.remainingBaseQuantity, costAllocatedBaseQuantity: entry.costAllocatedBaseQuantity, updatedAt: FieldValue.serverTimestamp(), updatedBy: uid });
        transaction.set(db.collection("stockMovements").doc(`${saleRef.id}_${entry.batch.id}`), {
          schemaVersion: 2, type: "sale", direction: "out", saleId: saleRef.id, productId, batchId: entry.batch.id, baseQuantityDelta: -entry.baseQuantity, allocatedCostPesewas: entry.allocatedCostPesewas,
          batchSnapshot: { receivedAt: entry.batch.receivedAt, expiryBusinessDate: entry.batch.expiry.date || null, unitsPerBulk: entry.batch.unitsPerBulk, baseUnit: entry.batch.baseUnit, bulkUnit: entry.batch.bulkUnit },
          createdBy, createdAt: committedAt, serverCreatedAt: FieldValue.serverTimestamp()
        });
      });
      transaction.set(saleRef, {
        ...response, schemaVersion: 3, inventorySchemaVersion: 2, idempotencyKeyHash: requestHash,
        productId: items.length === 1 ? items[0].productId : null, product: items.length === 1 ? items[0].name : "Multiple Items", qty: items.length === 1 ? items[0].quantity : items.length,
        saleUnit: items.length === 1 ? items[0].unit : "mixed", saleUnitType: items.length === 1 ? items[0].unit : "mixed", actualQtySold: items.reduce((sum, item) => add(sum, item.baseQuantity, "sale quantity"), 0),
        subtotalAmount: subtotalPesewas / 100, totalAmount: taxBreakdown.totalAmountPesewas / 100, taxBreakdown: legacyTax(taxBreakdown), taxSettingsSnapshot: taxBreakdown,
        syncStatus: "synced", cloudSyncedAt: committedAt, createdAt: committedAt, serverCreatedAt: FieldValue.serverTimestamp()
      });
      transaction.set(requestRef, { schemaVersion: 2, uid, requestFingerprint, saleId: saleRef.id, response, createdAt: committedAt, serverCreatedAt: FieldValue.serverTimestamp() });
      return response;
    });
  }
  return { submitSecureSale };
}

module.exports = { BUSINESS_TIME_ZONE, DEFAULT_TAX_SETTINGS, MAX_BATCHES_PER_PRODUCT, MAX_ITEMS_PER_SALE, createSecureSalesService };
