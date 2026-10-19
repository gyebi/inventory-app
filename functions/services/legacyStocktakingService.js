"use strict";

const crypto = require("node:crypto");

const STOCK_ROLES = new Set(["admin", "manager", "storekeeper"]);
const REVIEW_ROLES = new Set(["admin", "manager"]);
const ADJUSTMENT_TYPES = new Set(["Damaged", "Lost", "Expired", "Breakage", "Theft", "Leakage", "Other"]);
const MAX_ITEMS = 200;
const BUSINESS_TIME_ZONE = "Africa/Accra";

function createLegacyStocktakingService({ db, FieldValue, HttpsError, now = () => new Date() }) {
  const fail = (code, message) => { throw new HttpsError(code, message); };
  const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
  const text = (value, name, { required = false, max = 500 } = {}) => {
    const result = String(value ?? "").trim();
    if (required && !result) fail("invalid-argument", `${name} is required.`);
    if (result.length > max) fail("invalid-argument", `${name} is too long.`);
    return result;
  };
  const integer = (value, name, { min = 0, max = 1000000 } = {}) => {
    if (!Number.isSafeInteger(value) || value < min || value > max) fail("invalid-argument", `${name} must be a whole number from ${min} to ${max}.`);
    return value;
  };
  const object = (value, name) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail("invalid-argument", `${name} must be an object.`);
    return value;
  };
  const allowed = (value, fields, name) => Object.keys(value).forEach((key) => {
    if (!fields.has(key)) fail("invalid-argument", `${name}.${key} is not supported.`);
  });
  const timestamp = () => now().toISOString();
  const marker = (value) => {
    if (value && typeof value.toMillis === "function") return `ts:${value.toMillis()}`;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return `date:${value.toISOString()}`;
    if (typeof value === "string" && value) return `str:${value}`;
    return "";
  };
  const businessDate = () => {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" })
      .formatToParts(now()).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
    return { date: `${parts.year}-${parts.month}-${parts.day}`, weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday) };
  };
  const cycleKey = (scheduledWeekday) => {
    const current = businessDate();
    const date = new Date(`${current.date}T12:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() - ((current.weekday - scheduledWeekday + 7) % 7));
    return date.toISOString().slice(0, 10);
  };
  const getCaller = async (transaction, uid, roles) => {
    const snapshot = await transaction.get(db.collection("users").doc(uid));
    if (!snapshot.exists) fail("permission-denied", "Caller staff profile was not found.");
    const profile = snapshot.data() || {};
    if (profile.active === false || profile.isActive === false || !roles.has(profile.role)) fail("permission-denied", "This staff role is not permitted to perform this operation.");
    return { uid, fullName: profile.fullName || profile.displayName || profile.username || uid, username: profile.username || "", role: profile.role };
  };
  const idempotencyKey = (value) => {
    const key = text(value, "idempotencyKey", { required: true, max: 128 });
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{15,127}$/.test(key)) fail("invalid-argument", "idempotencyKey must be 16-128 URL-safe characters.");
    return key;
  };
  const requestRef = (kind, uid, key) => db.collection(`${kind}Requests`).doc(hash(`${uid}\u0000${key}`));
  const existingRequest = async (transaction, ref, uid, fingerprint) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return null;
    const saved = snapshot.data() || {};
    if (saved.uid !== uid || saved.fingerprint !== fingerprint || !saved.response) fail("already-exists", "This idempotency key was already used with a different request.");
    return saved.response;
  };
  const baseQuantity = (product, quantity, unit) => {
    const units = integer(Number(product.unitsPerBulk || 1), "Product unitsPerBulk", { min: 1 });
    if (unit === product.baseUnit || unit === "base") return quantity;
    if (unit === product.bulkUnit || unit === "bulk") return quantity * units;
    fail("invalid-argument", "unit must match the product base or bulk unit.");
  };

  async function legacyAvailability(transaction, productId) {
    const [receipts, sales, adjustments] = await Promise.all([
      transaction.get(db.collection("stockReceipts").where("productId", "==", productId)),
      transaction.get(db.collection("sales")),
      transaction.get(db.collection("stockAdjustments").where("productId", "==", productId))
    ]);
    const batches = new Map();
    receipts.docs.forEach((entry) => {
      const receipt = entry.data() || {};
      if (receipt.batchId) batches.set(receipt.batchId, { id: receipt.batchId, quantity: integer(Number(receipt.quantityReceived || 0), "receipt quantity", { min: 0 }), expiryDate: receipt.expiryDate || "", receivedAt: receipt.receivedAt || "" });
    });
    const deduct = (allocation) => {
      const batch = batches.get(allocation.batchId);
      if (batch) batch.quantity -= integer(Number(allocation.quantity ?? allocation.baseQuantity ?? 0), "allocation quantity", { min: 0 });
    };
    sales.docs.forEach((entry) => (entry.data()?.items || []).forEach((item) => (item.batchAllocations || []).forEach(deduct)));
    adjustments.docs.forEach((entry) => { const adjustment = entry.data() || {}; if (adjustment.effectDirection !== "increase") (adjustment.batchAllocations || []).forEach(deduct); });
    const values = [...batches.values()];
    if (values.some((batch) => batch.quantity < 0)) fail("failed-precondition", "Existing receipt allocations cannot be reconciled. Repair the affected legacy history before adjusting this product.");
    return values;
  }
  const allocate = (batches, quantity, requestedBatchId = "") => {
    const source = requestedBatchId ? batches.filter((batch) => batch.id === requestedBatchId) : batches.slice().sort((left, right) => String(left.expiryDate || "9999-12-31").localeCompare(String(right.expiryDate || "9999-12-31")) || String(left.receivedAt).localeCompare(String(right.receivedAt)));
    if (requestedBatchId && source.length !== 1) fail("failed-precondition", "The selected batch does not belong to this product.");
    let remaining = quantity;
    const allocations = [];
    source.forEach((batch) => { const taken = Math.min(batch.quantity, remaining); if (taken > 0) { allocations.push({ batchId: batch.id, quantity: taken, expiryDate: batch.expiryDate || "" }); remaining -= taken; } });
    if (remaining) fail("failed-precondition", "Not enough reconciled stock is available. Refresh inventory and try again.");
    return allocations;
  };

  async function recordLegacyAdjustment(request) {
    if (!request.auth?.uid) fail("unauthenticated", "You must be signed in to record a stock adjustment.");
    const raw = object(request.data, "request");
    allowed(raw, new Set(["idempotencyKey", "productId", "batchId", "adjustmentType", "quantity", "unit", "reason", "location", "occurredAt"]), "request");
    const payload = { idempotencyKey: idempotencyKey(raw.idempotencyKey), productId: text(raw.productId, "productId", { required: true, max: 128 }), batchId: text(raw.batchId, "batchId", { max: 128 }), adjustmentType: text(raw.adjustmentType, "adjustmentType", { required: true, max: 50 }), quantity: integer(raw.quantity, "quantity", { min: 1 }), unit: text(raw.unit, "unit", { required: true, max: 80 }), reason: text(raw.reason, "reason", { required: true, max: 4000 }), location: text(raw.location, "location", { required: true, max: 240 }), occurredAt: text(raw.occurredAt, "occurredAt", { required: true, max: 40 }) };
    if (payload.productId.includes("/")) fail("invalid-argument", "productId must be a document ID.");
    if (!ADJUSTMENT_TYPES.has(payload.adjustmentType)) fail("invalid-argument", "adjustmentType is not supported.");
    const fingerprint = hash(JSON.stringify(payload));
    return db.runTransaction(async (transaction) => {
      const caller = await getCaller(transaction, request.auth.uid, STOCK_ROLES);
      const retry = await existingRequest(transaction, requestRef("adjustment", caller.uid, payload.idempotencyKey), caller.uid, fingerprint);
      if (retry) return retry;
      const [modeSnapshot, productSnapshot] = await Promise.all([transaction.get(db.collection("settings").doc("secureSales")), transaction.get(db.collection("products").doc(payload.productId))]);
      if (modeSnapshot.exists && modeSnapshot.data()?.enabled === true) fail("failed-precondition", "Secure inventory mode is enabled; legacy adjustments are unavailable.");
      if (!productSnapshot.exists) fail("not-found", "Product was not found.");
      const product = productSnapshot.data() || {};
      if (Number(product.inventorySchemaVersion) === 2) fail("failed-precondition", "Authoritative v2 products are not supported by legacy adjustments.");
      if (product.active === false || product.isActive === false) fail("failed-precondition", "Product is inactive.");
      const quantity = baseQuantity(product, payload.quantity, payload.unit);
      const current = integer(Number(product.quantity || 0), "product quantity", { min: 0 });
      if (quantity > current) fail("failed-precondition", "The product aggregate is lower than the requested adjustment. Refresh inventory and retry.");
      const allocations = allocate(await legacyAvailability(transaction, payload.productId), quantity, payload.batchId);
      const costPrice = Number.isFinite(Number(product.costPrice)) ? Number(product.costPrice) : null;
      const adjustment = { id: `ADJ-${hash(`${caller.uid}:${payload.idempotencyKey}`).slice(0, 24)}`, schemaVersion: 1, productId: payload.productId, productName: String(product.name || payload.productId), category: String(product.category || ""), quantityAffected: payload.quantity, baseQuantityAffected: quantity, unit: payload.unit, adjustmentType: payload.adjustmentType, reason: payload.reason, branch: payload.location, date: payload.occurredAt, batchId: payload.batchId, batchAllocations: allocations, effectDirection: "decrease", costPrice, totalLossValue: costPrice === null ? null : quantity * costPrice, recordedBy: caller, createdAt: timestamp() };
      const response = { committed: true, adjustment };
      transaction.update(productSnapshot.ref, { quantity: current - quantity, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid });
      transaction.set(db.collection("stockAdjustments").doc(adjustment.id), { ...adjustment, serverCreatedAt: FieldValue.serverTimestamp() });
      transaction.set(requestRef("adjustment", caller.uid, payload.idempotencyKey), { uid: caller.uid, fingerprint, response, createdAt: timestamp(), serverCreatedAt: FieldValue.serverTimestamp() });
      return response;
    });
  }

  async function startStocktake(request) {
    if (!request.auth?.uid) fail("unauthenticated", "You must be signed in to start a stocktaking count.");
    const raw = object(request.data, "request"); allowed(raw, new Set(["idempotencyKey", "category"]), "request");
    const payload = { idempotencyKey: idempotencyKey(raw.idempotencyKey), category: text(raw.category, "category", { required: true, max: 240 }) };
    const fingerprint = hash(JSON.stringify(payload));
    return db.runTransaction(async (transaction) => {
      const caller = await getCaller(transaction, request.auth.uid, STOCK_ROLES);
      const retry = await existingRequest(transaction, requestRef("stocktakeStart", caller.uid, payload.idempotencyKey), caller.uid, fingerprint);
      if (retry) return retry;
      const [productsSnapshot, settingSnapshot] = await Promise.all([transaction.get(db.collection("products")), transaction.get(db.collection("settings").doc("weeklyStocktaking"))]);
      const categoryProducts = productsSnapshot.docs.filter((snapshot) => { const product = snapshot.data() || {}; return product.active !== false && product.isActive !== false && product.category === payload.category; });
      if (!categoryProducts.length) fail("failed-precondition", "No active products were found in this category.");
      const unsupported = categoryProducts.filter((snapshot) => Number(snapshot.data()?.inventorySchemaVersion) === 2).map((snapshot) => String(snapshot.data()?.name || snapshot.id));
      if (unsupported.length) fail("failed-precondition", `This category includes unsupported v2 products: ${unsupported.slice(0, 5).join(", ")}. Count a legacy-only category instead.`);
      if (categoryProducts.length > MAX_ITEMS) fail("resource-exhausted", `A count may contain at most ${MAX_ITEMS} products.`);
      const setting = settingSnapshot.exists ? settingSnapshot.data() || {} : {};
      const scheduledWeekday = Number.isInteger(setting.scheduledWeekday) && setting.scheduledWeekday >= 0 && setting.scheduledWeekday <= 6 ? setting.scheduledWeekday : 0;
      const createdAt = timestamp();
      const items = categoryProducts.map((snapshot) => { const product = snapshot.data() || {}; const unitsPerBulk = integer(Number(product.unitsPerBulk || 1), "Product unitsPerBulk", { min: 1 }); return { productId: snapshot.id, productName: String(product.name || snapshot.id), category: payload.category, baseUnit: String(product.baseUnit || "base unit"), bulkUnit: String(product.bulkUnit || "bulk unit"), unitsPerBulk, snapshotBaseQuantity: integer(Number(product.quantity || 0), "product quantity", { min: 0 }), snapshotUpdatedAtMarker: marker(product.updatedAt), actualBaseQuantity: null, varianceBaseQuantity: null, reason: "" }; });
      const session = { id: `STK-${hash(`${caller.uid}:${payload.idempotencyKey}`).slice(0, 24)}`, schemaVersion: 2, inventoryMode: "legacy", status: "draft", category: payload.category, startedBy: caller, startedAt: createdAt, scheduledWeekday, obligationWeekKey: cycleKey(scheduledWeekday), revision: 1, items, createdAt };
      const response = { committed: true, session };
      transaction.set(db.collection("stocktakeSessions").doc(session.id), { ...session, serverCreatedAt: FieldValue.serverTimestamp() });
      if (!settingSnapshot.exists) transaction.set(settingSnapshot.ref, { scheduledWeekday, effectiveFromBusinessDate: businessDate().date, createdAt, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller });
      transaction.set(requestRef("stocktakeStart", caller.uid, payload.idempotencyKey), { uid: caller.uid, fingerprint, response, createdAt, serverCreatedAt: FieldValue.serverTimestamp() });
      return response;
    });
  }

  function countRequest(data) {
    const raw = object(data, "request"); allowed(raw, new Set(["sessionId", "revision", "counts"]), "request");
    const sessionId = text(raw.sessionId, "sessionId", { required: true, max: 128 }); const revision = integer(raw.revision, "revision", { min: 1 });
    if (!Array.isArray(raw.counts) || raw.counts.length < 1 || raw.counts.length > MAX_ITEMS) fail("invalid-argument", "counts must contain between 1 and 200 items.");
    const ids = new Set();
    const counts = raw.counts.map((entry, index) => { const value = object(entry, `counts[${index}]`); allowed(value, new Set(["productId", "quantity", "unit"]), `counts[${index}]`); const productId = text(value.productId, `counts[${index}].productId`, { required: true, max: 128 }); if (ids.has(productId)) fail("invalid-argument", "Each count line may appear once."); ids.add(productId); if (value.quantity === null || value.quantity === undefined || value.quantity === "") return { productId, actualBaseQuantity: null, unit: text(value.unit, `counts[${index}].unit`, { required: true, max: 80 }) }; return { productId, actualBaseQuantity: integer(value.quantity, `counts[${index}].quantity`, { min: 0 }), unit: text(value.unit, `counts[${index}].unit`, { required: true, max: 80 }) }; });
    return { sessionId, revision, counts };
  }
  async function saveCounts(request) {
    if (!request.auth?.uid) fail("unauthenticated", "You must be signed in to save a count.");
    const payload = countRequest(request.data);
    return db.runTransaction(async (transaction) => {
      const caller = await getCaller(transaction, request.auth.uid, STOCK_ROLES);
      const snapshot = await transaction.get(db.collection("stocktakeSessions").doc(payload.sessionId));
      if (!snapshot.exists) fail("not-found", "Stocktaking count was not found.");
      const session = snapshot.data() || {};
      if (session.status !== "draft") fail("failed-precondition", "Only a draft count can be saved.");
      if (session.revision !== payload.revision) fail("aborted", "This draft changed on another device. Reload it before saving.");
      const items = new Map((session.items || []).map((item) => [item.productId, item]));
      payload.counts.forEach((count) => { const item = items.get(count.productId); if (!item) fail("invalid-argument", "A submitted product is not part of this category count."); if (count.unit !== "base" && count.unit !== item.baseUnit) fail("invalid-argument", "Actual counts must use the snapshot base unit."); item.actualBaseQuantity = count.actualBaseQuantity; });
      const updated = { ...session, items: [...items.values()], revision: session.revision + 1, updatedAt: timestamp(), updatedBy: caller, history: [...(session.history || []), { event: "saved", at: timestamp(), by: caller.uid }] };
      transaction.set(snapshot.ref, updated);
      return { committed: true, session: updated };
    });
  }
  async function evaluateStocktake(request) {
    if (!request.auth?.uid) fail("unauthenticated", "You must be signed in to evaluate a count.");
    const raw = object(request.data, "request"); const sessionId = text(raw.sessionId, "sessionId", { required: true, max: 128 }); const revision = integer(raw.revision, "revision", { min: 1 });
    return db.runTransaction(async (transaction) => {
      const caller = await getCaller(transaction, request.auth.uid, REVIEW_ROLES);
      const snapshot = await transaction.get(db.collection("stocktakeSessions").doc(sessionId));
      if (!snapshot.exists) fail("not-found", "Stocktaking count was not found.");
      const session = snapshot.data() || {};
      if (session.status !== "draft") fail("failed-precondition", "Only a draft count can be evaluated.");
      if (session.revision !== revision) fail("aborted", "This draft changed on another device. Reload it before evaluating.");
      if ((session.items || []).some((item) => item.actualBaseQuantity === null || item.actualBaseQuantity === undefined)) fail("failed-precondition", "Count every product before evaluation. Leave no blank actual counts.");
      const stale = [];
      for (const item of session.items || []) {
        const productSnapshot = await transaction.get(db.collection("products").doc(item.productId));
        const product = productSnapshot.exists ? productSnapshot.data() || {} : null;
        if (!product || Number(product.inventorySchemaVersion) === 2 || product.active === false || product.isActive === false || Number(product.quantity || 0) !== item.snapshotBaseQuantity || String(product.baseUnit || "base unit") !== item.baseUnit || String(product.bulkUnit || "bulk unit") !== item.bulkUnit || Number(product.unitsPerBulk || 1) !== item.unitsPerBulk || !item.snapshotUpdatedAtMarker || marker(product.updatedAt) !== item.snapshotUpdatedAtMarker) stale.push(item.productName);
      }
      if (stale.length) {
        const updated = { ...session, status: "stale", revision: session.revision + 1, staleProducts: stale, staleAt: timestamp(), staleBy: caller, history: [...(session.history || []), { event: "stale", at: timestamp(), by: caller.uid }] };
        transaction.set(snapshot.ref, updated);
        return { committed: false, stale: true, session: updated, message: "Stock or packaging changed after this snapshot. Start a fresh count before evaluating variances." };
      }
      const items = session.items.map((item) => ({ ...item, varianceBaseQuantity: item.actualBaseQuantity - item.snapshotBaseQuantity }));
      const updated = { ...session, status: "evaluated", items, revision: session.revision + 1, evaluatedAt: timestamp(), evaluatedBy: caller, history: [...(session.history || []), { event: "evaluated", at: timestamp(), by: caller.uid }] };
      transaction.set(snapshot.ref, updated);
      return { committed: true, session: updated };
    });
  }
  async function finaliseStocktake(request) {
    if (!request.auth?.uid) fail("unauthenticated", "You must be signed in to finalise a report.");
    const raw = object(request.data, "request"); allowed(raw, new Set(["sessionId", "revision", "reasons"]), "request"); const sessionId = text(raw.sessionId, "sessionId", { required: true, max: 128 }); const revision = integer(raw.revision, "revision", { min: 1 }); if (!Array.isArray(raw.reasons) || raw.reasons.length > MAX_ITEMS) fail("invalid-argument", "reasons is invalid.");
    return db.runTransaction(async (transaction) => {
      const caller = await getCaller(transaction, request.auth.uid, REVIEW_ROLES);
      const snapshot = await transaction.get(db.collection("stocktakeSessions").doc(sessionId));
      if (!snapshot.exists) fail("not-found", "Stocktaking report was not found.");
      const session = snapshot.data() || {};
      if (session.status !== "evaluated") fail("failed-precondition", "Only an evaluated report can be finalised.");
      if (session.revision !== revision) fail("aborted", "This report changed on another device. Reload it before finalising.");
      const validIds = new Set((session.items || []).map((item) => item.productId));
      const reasons = new Map();
      raw.reasons.forEach((entry, index) => {
        const reasonEntry = object(entry, `reasons[${index}]`);
        allowed(reasonEntry, new Set(["productId", "reason"]), `reasons[${index}]`);
        const productId = text(reasonEntry.productId, "reason.productId", { required: true, max: 128 });
        if (!validIds.has(productId) || reasons.has(productId)) fail("invalid-argument", "Reasons must contain each report product at most once.");
        reasons.set(productId, text(reasonEntry.reason, "reason", { max: 4000 }));
      });
      const items = session.items.map((item) => ({ ...item, reason: reasons.get(item.productId) ?? item.reason ?? "" }));
      if (items.some((item) => item.varianceBaseQuantity !== 0 && !item.reason.trim())) fail("failed-precondition", "Enter a reason for every nonzero variance before finalising.");
      const updated = { ...session, status: "finalised", items, revision: session.revision + 1, finalisedAt: timestamp(), finalisedBy: caller, history: [...(session.history || []), { event: "finalised", at: timestamp(), by: caller.uid }] };
      transaction.set(snapshot.ref, updated);
      return { committed: true, session: updated };
    });
  }
  async function updateWeeklySchedule(request) {
    if (!request.auth?.uid) fail("unauthenticated", "You must be signed in.");
    const weekday = integer(request.data?.scheduledWeekday, "scheduledWeekday", { min: 0, max: 6 });
    return db.runTransaction(async (transaction) => { const caller = await getCaller(transaction, request.auth.uid, new Set(["admin"])); const effectiveFromBusinessDate = businessDate().date; transaction.set(db.collection("settings").doc("weeklyStocktaking"), { scheduledWeekday: weekday, effectiveFromBusinessDate, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller }, { merge: true }); return { committed: true, scheduledWeekday: weekday, effectiveFromBusinessDate }; });
  }
  return { recordLegacyAdjustment, startStocktake, saveCounts, evaluateStocktake, finaliseStocktake, updateWeeklySchedule, businessDate, cycleKey };
}

module.exports = { BUSINESS_TIME_ZONE, createLegacyStocktakingService };
