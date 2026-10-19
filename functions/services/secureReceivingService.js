"use strict";

const crypto = require("node:crypto");

const RECEIVING_ROLES = new Set(["admin", "manager", "storekeeper"]);
const PAYMENT_STATUSES = new Set(["Credit", "Part Payment", "Paid in Full"]);
const BUSINESS_TIME_ZONE = "Africa/Accra";
const MAX_RECEIVE_LINES = 20;
const MAX_BATCHES_PER_PRODUCT = 10;

function createSecureReceivingService({ db, FieldValue, HttpsError, now = () => new Date() }) {
  const fail = (code, message) => { throw new HttpsError(code, message); };
  const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
  const safeInteger = (value, field, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
    if (!Number.isSafeInteger(value) || value < min || value > max) fail("invalid-argument", `${field} must be a safe integer from ${min} to ${max}.`);
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
  const string = (value, field, { required = false, max = 500 } = {}) => {
    const normalized = String(value ?? "").trim();
    if (required && !normalized) fail("invalid-argument", `${field} is required.`);
    if (normalized.length > max) fail("invalid-argument", `${field} is too long.`);
    return normalized;
  };

  function businessDate() {
    const date = now();
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) fail("internal", "The server clock is invalid.");
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date)
      .reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  function validBusinessDate(value, field, { allowEmpty = true, today = null } = {}) {
    const date = string(value, field, { max: 10 });
    if (!date && allowEmpty) return "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail("invalid-argument", `${field} must be an ISO calendar date.`);
    const parsed = new Date(`${date}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) fail("invalid-argument", `${field} must be a real calendar date.`);
    if (today && date < today) fail("failed-precondition", `${field} cannot be before today's Africa/Accra business date.`);
    return date;
  }

  function normalizePurchase(data, today) {
    const request = object(data, "request");
    allowed(request, new Set(["idempotencyKey", "purchase"]), "request");
    const idempotencyKey = string(request.idempotencyKey, "idempotencyKey", { required: true, max: 128 });
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{15,127}$/.test(idempotencyKey)) fail("invalid-argument", "idempotencyKey must be 16-128 URL-safe characters and be persisted before submission.");
    const purchase = object(request.purchase, "purchase");
    allowed(purchase, new Set(["supplier", "invoiceNumber", "purchaseDate", "paymentStatus", "dueDate", "notes", "receivedByNote", "lines"]), "purchase");
    const supplier = string(purchase.supplier, "purchase.supplier", { required: true, max: 240 });
    const invoiceNumber = string(purchase.invoiceNumber, "purchase.invoiceNumber", { required: true, max: 240 });
    const purchaseDate = string(purchase.purchaseDate, "purchase.purchaseDate", { required: true, max: 40 });
    if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?)?$/.test(purchaseDate) || Number.isNaN(new Date(purchaseDate).getTime())) fail("invalid-argument", "purchase.purchaseDate must be a valid supplier purchase date/time.");
    const paymentStatus = string(purchase.paymentStatus, "purchase.paymentStatus", { required: true, max: 40 });
    if (!PAYMENT_STATUSES.has(paymentStatus)) fail("invalid-argument", "purchase.paymentStatus is not supported.");
    const dueDate = validBusinessDate(purchase.dueDate, "purchase.dueDate");
    if ((paymentStatus === "Credit" || paymentStatus === "Part Payment") && !dueDate) fail("invalid-argument", "purchase.dueDate is required for credit or part-payment purchases.");
    if (paymentStatus === "Paid in Full" && dueDate) fail("invalid-argument", "purchase.dueDate is only allowed for credit or part-payment purchases.");
    if (!Array.isArray(purchase.lines) || purchase.lines.length < 1 || purchase.lines.length > MAX_RECEIVE_LINES) fail("invalid-argument", `purchase.lines must contain between 1 and ${MAX_RECEIVE_LINES} lines.`);
    const productIds = new Set();
    const lines = purchase.lines.map((raw, index) => {
      const line = object(raw, `purchase.lines[${index}]`);
      allowed(line, new Set(["productId", "quantity", "unit", "bulkQuantityReceived", "looseBaseQuantityReceived", "totalPurchaseCostPesewas", "totalBulkCostPesewas", "additionalExpensesPesewas", "expiryBusinessDate"]), `purchase.lines[${index}]`);
      const productId = string(line.productId, `purchase.lines[${index}].productId`, { required: true, max: 128 });
      if (productId.includes("/")) fail("invalid-argument", "Each productId must be a document ID.");
      if (productIds.has(productId)) fail("invalid-argument", "Each product may appear only once in a receiving request.");
      productIds.add(productId);
      const hasBreakdown = Object.prototype.hasOwnProperty.call(line, "bulkQuantityReceived") || Object.prototype.hasOwnProperty.call(line, "looseBaseQuantityReceived");
      let bulkQuantityReceived;
      let looseBaseQuantityReceived;
      if (hasBreakdown) {
        bulkQuantityReceived = safeInteger(line.bulkQuantityReceived ?? 0, `purchase.lines[${index}].bulkQuantityReceived`, { min: 0, max: 1000000 });
        looseBaseQuantityReceived = safeInteger(line.looseBaseQuantityReceived ?? 0, `purchase.lines[${index}].looseBaseQuantityReceived`, { min: 0, max: 1000000 });
      } else {
        const quantity = safeInteger(line.quantity, `purchase.lines[${index}].quantity`, { min: 1, max: 1000000 });
        const unit = string(line.unit, `purchase.lines[${index}].unit`, { required: true, max: 8 }).toLowerCase();
        if (unit !== "base" && unit !== "bulk") fail("invalid-argument", "Each receiving line unit must be base or bulk.");
        bulkQuantityReceived = unit === "bulk" ? quantity : 0;
        looseBaseQuantityReceived = unit === "base" ? quantity : 0;
      }
      if (bulkQuantityReceived === 0 && looseBaseQuantityReceived === 0) fail("invalid-argument", "Each receiving line must include bulk, loose, or both quantities.");
      const suppliedPurchaseCost = line.totalPurchaseCostPesewas;
      const suppliedLegacyCost = line.totalBulkCostPesewas;
      if (suppliedPurchaseCost !== undefined && suppliedLegacyCost !== undefined && suppliedPurchaseCost !== suppliedLegacyCost) fail("invalid-argument", "Purchase cost aliases must match when both are supplied.");
      const totalPurchaseCostPesewas = safeInteger(suppliedPurchaseCost ?? suppliedLegacyCost, `purchase.lines[${index}].totalPurchaseCostPesewas`, { min: 0 });
      const additionalExpensesPesewas = safeInteger(line.additionalExpensesPesewas, `purchase.lines[${index}].additionalExpensesPesewas`, { min: 0 });
      return { productId, bulkQuantityReceived, looseBaseQuantityReceived, totalPurchaseCostPesewas, totalBulkCostPesewas: totalPurchaseCostPesewas, additionalExpensesPesewas, expiryBusinessDate: validBusinessDate(line.expiryBusinessDate, `purchase.lines[${index}].expiryBusinessDate`, { today }) };
    });
    return { idempotencyKey, purchase: { supplier, invoiceNumber, purchaseDate, paymentStatus, dueDate, notes: string(purchase.notes, "purchase.notes", { max: 4000 }), receivedByNote: string(purchase.receivedByNote, "purchase.receivedByNote", { max: 240 }), lines } };
  }

  function parseExistingBatch(snapshot, productId, today) {
    const batch = snapshot.data() || {};
    if (batch.productId !== productId) fail("failed-precondition", `Batch ${snapshot.id} has an invalid product reference.`);
    const originalBaseQuantity = safeInteger(batch.originalBaseQuantity, `Batch ${snapshot.id}.originalBaseQuantity`, { min: 1 });
    const remainingBaseQuantity = safeInteger(batch.remainingBaseQuantity, `Batch ${snapshot.id}.remainingBaseQuantity`, { min: 0, max: originalBaseQuantity });
    const expiry = validBusinessDate(batch.expiryBusinessDate ?? batch.expiryDate, `Batch ${snapshot.id}.expiryBusinessDate`);
    if (expiry && expiry < today) return { remainingBaseQuantity, sellableQuantity: 0 };
    if (batch.inventoryStatus !== "active") return { remainingBaseQuantity, sellableQuantity: 0 };
    return { remainingBaseQuantity, sellableQuantity: remainingBaseQuantity };
  }

  async function receiveSecureStock(request) {
    if (!request.auth?.uid) fail("unauthenticated", "You must be signed in to receive stock.");
    const uid = request.auth.uid;
    const today = businessDate();
    const payload = normalizePurchase(request.data, today);
    const requestFingerprint = hash(JSON.stringify(payload));
    const requestHash = hash(`${uid}\u0000${payload.idempotencyKey}`);
    const requestRef = db.collection("receiveRequests").doc(requestHash);
    const purchaseRef = db.collection("purchases").doc(`REC-${requestHash.slice(0, 32)}`);

    return db.runTransaction(async (transaction) => {
      const [profileSnapshot, modeSnapshot] = await Promise.all([
        transaction.get(db.collection("users").doc(uid)),
        transaction.get(db.collection("settings").doc("secureSales"))
      ]);
      if (!modeSnapshot.exists || modeSnapshot.data()?.enabled !== true) fail("failed-precondition", "Secure inventory mode is disabled. Legacy receiving remains the active path.");
      if (!profileSnapshot.exists) fail("permission-denied", "Caller staff profile was not found.");
      const profile = profileSnapshot.data() || {};
      if (profile.active === false || profile.isActive === false || !RECEIVING_ROLES.has(profile.role)) fail("permission-denied", "This staff role cannot receive secure stock.");
      const existing = await transaction.get(requestRef);
      if (existing.exists) {
        const saved = existing.data() || {};
        if (saved.uid !== uid || saved.requestFingerprint !== requestFingerprint || !saved.response) fail("already-exists", "This idempotencyKey has already been used for a different receiving request.");
        return saved.response;
      }

      const preparedLines = [];
      for (const line of payload.purchase.lines) {
        const productRef = db.collection("products").doc(line.productId);
        const [productSnapshot, batchesSnapshot] = await Promise.all([
          transaction.get(productRef),
          transaction.get(db.collection("stockBatches").where("productId", "==", line.productId).limit(MAX_BATCHES_PER_PRODUCT + 1))
        ]);
        if (!productSnapshot.exists) fail("not-found", `Product ${line.productId} was not found.`);
        if (batchesSnapshot.size >= MAX_BATCHES_PER_PRODUCT) fail("resource-exhausted", `Product ${line.productId} already has the ${MAX_BATCHES_PER_PRODUCT}-batch secure-sale limit. Reconcile batches before receiving more stock.`);
        const product = productSnapshot.data() || {};
        if (product.active === false || product.isActive === false) fail("failed-precondition", `Product ${line.productId} is inactive.`);
        if (product.inventorySchemaVersion !== 2) fail("failed-precondition", `Product ${line.productId} has not been migrated to authoritative batches.`);
        const unitsPerBulk = safeInteger(product.unitsPerBulk, `Product ${line.productId}.unitsPerBulk`, { min: 1 });
        const bulkBaseQuantity = multiply(line.bulkQuantityReceived, unitsPerBulk, `Product ${line.productId} base quantity`);
        const baseQuantity = add(bulkBaseQuantity, line.looseBaseQuantityReceived, `Product ${line.productId} base quantity`);
        const aggregates = batchesSnapshot.docs.map((snapshot) => parseExistingBatch(snapshot, line.productId, today)).reduce((sum, batch) => ({ quantity: add(sum.quantity, batch.remainingBaseQuantity, `Product ${line.productId} quantity`), sellableQuantity: add(sum.sellableQuantity, batch.sellableQuantity, `Product ${line.productId} sellable quantity`) }), { quantity: 0, sellableQuantity: 0 });
        if (safeInteger(product.quantity, `Product ${line.productId}.quantity`, { min: 0 }) !== aggregates.quantity || safeInteger(product.sellableQuantity, `Product ${line.productId}.sellableQuantity`, { min: 0 }) !== aggregates.sellableQuantity) fail("failed-precondition", `Product ${line.productId} aggregate quantities do not reconcile with stockBatches.`);
        const totalLandedCostPesewas = add(line.totalPurchaseCostPesewas, line.additionalExpensesPesewas, `Product ${line.productId} total landed cost`);
        preparedLines.push({ line, productRef, product, unitsPerBulk, baseQuantity, totalLandedCostPesewas, nextQuantity: add(aggregates.quantity, baseQuantity, `Product ${line.productId} quantity`), nextSellableQuantity: add(aggregates.sellableQuantity, baseQuantity, `Product ${line.productId} sellable quantity`) });
      }

      const committedAt = now().toISOString();
      const createdBy = { uid, fullName: profile.fullName || profile.displayName || profile.username || uid, username: profile.username || "", role: profile.role };
      const lines = preparedLines.map((prepared, index) => {
        const receiptId = `${purchaseRef.id}-L${index + 1}`;
        const batchId = `${purchaseRef.id}-B${index + 1}`;
        const { line, product, unitsPerBulk, baseQuantity, totalLandedCostPesewas } = prepared;
        return {
          receiptId, batchId, productId: line.productId, product: String(product.name || line.productId), productNameSnapshot: String(product.name || line.productId), category: String(product.category || ""),
          unit: line.bulkQuantityReceived && line.looseBaseQuantityReceived ? "mixed" : (line.bulkQuantityReceived ? "bulk" : "base"), unitLabel: String(line.bulkQuantityReceived && line.looseBaseQuantityReceived ? "mixed" : (line.bulkQuantityReceived ? (product.bulkUnit || "bulk unit") : (product.baseUnit || "base unit"))), inputQuantity: line.bulkQuantityReceived && !line.looseBaseQuantityReceived ? line.bulkQuantityReceived : (line.looseBaseQuantityReceived && !line.bulkQuantityReceived ? line.looseBaseQuantityReceived : null), quantityReceived: baseQuantity, bulkQuantityReceived: line.bulkQuantityReceived, looseBaseQuantityReceived: line.looseBaseQuantityReceived, baseQuantity,
          baseUnit: String(product.baseUnit || "base unit"), bulkUnit: String(product.bulkUnit || "bulk unit"), unitsPerBulk,
          receivedQuantityBreakdown: { bulkQuantityReceived: line.bulkQuantityReceived, looseBaseQuantityReceived: line.looseBaseQuantityReceived, unitsPerBulk, totalBaseQuantity: baseQuantity }, totalPurchaseCostPesewas: line.totalPurchaseCostPesewas, totalBulkCostPesewas: line.totalPurchaseCostPesewas, additionalExpensesPesewas: line.additionalExpensesPesewas, totalLandedCostPesewas,
          unitCostNumeratorPesewas: totalLandedCostPesewas, unitCostDenominatorBaseQuantity: baseQuantity, expiryBusinessDate: line.expiryBusinessDate || null
        };
      });
      const totalLandedCostPesewas = lines.reduce((sum, line) => add(sum, line.totalLandedCostPesewas, "purchase total landed cost"), 0);
      const response = { committed: true, purchaseId: purchaseRef.id, committedAt, currency: "GHS", createdBy, supplier: payload.purchase.supplier, invoiceNumber: payload.purchase.invoiceNumber, purchaseDate: payload.purchase.purchaseDate, paymentStatus: payload.purchase.paymentStatus, dueDate: payload.purchase.dueDate || null, notes: payload.purchase.notes, totalLandedCostPesewas, lines };

      transaction.set(purchaseRef, { ...response, schemaVersion: 2, inventorySchemaVersion: 2, idempotencyKeyHash: requestHash, receivedByNote: payload.purchase.receivedByNote, serverCreatedAt: FieldValue.serverTimestamp(), createdAt: committedAt });
      preparedLines.forEach((prepared, index) => {
        const line = lines[index];
        transaction.update(prepared.productRef, { quantity: prepared.nextQuantity, sellableQuantity: prepared.nextSellableQuantity, updatedAt: FieldValue.serverTimestamp(), updatedBy: uid });
        transaction.set(db.collection("stockReceipts").doc(line.receiptId), {
          ...line, id: line.receiptId, purchaseId: purchaseRef.id, batchId: line.batchId, supplier: payload.purchase.supplier, invoiceNumber: payload.purchase.invoiceNumber, invoiceDetails: payload.purchase.invoiceNumber,
          purchaseDate: payload.purchase.purchaseDate, paymentStatus: payload.purchase.paymentStatus, dueDate: payload.purchase.dueDate || null, notes: payload.purchase.notes, receivedBy: createdBy.fullName, createdBy, receivedByNote: payload.purchase.receivedByNote,
          receivedAt: committedAt, createdAt: committedAt, serverCreatedAt: FieldValue.serverTimestamp(), baseUnitsReceived: line.baseQuantity, totalPurchaseCost: line.totalPurchaseCostPesewas / 100, totalBulkCost: line.totalPurchaseCostPesewas / 100, additionalExpenses: line.additionalExpensesPesewas / 100, totalLandedCost: line.totalLandedCostPesewas / 100, unitCost: line.totalLandedCostPesewas / 100 / line.baseQuantity, expiryDate: line.expiryBusinessDate || ""
        });
        transaction.set(db.collection("stockBatches").doc(line.batchId), {
          schemaVersion: 2, productId: line.productId, receiptId: line.receiptId, purchaseId: purchaseRef.id, originalBaseQuantity: line.baseQuantity, remainingBaseQuantity: line.baseQuantity, costAllocatedBaseQuantity: 0, totalLandedCostPesewas: line.totalLandedCostPesewas,
          baseUnit: line.baseUnit, bulkUnit: line.bulkUnit, unitsPerBulk: line.unitsPerBulk, receivedQuantityBreakdown: line.receivedQuantityBreakdown, receivedAt: committedAt, purchaseDate: payload.purchase.purchaseDate, expiryBusinessDate: line.expiryBusinessDate || "", inventoryStatus: "active", createdBy, createdAt: committedAt, serverCreatedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), updatedBy: uid
        });
        transaction.set(db.collection("stockMovements").doc(`${purchaseRef.id}_${line.batchId}`), {
          schemaVersion: 2, type: "receive", direction: "in", purchaseId: purchaseRef.id, receiptId: line.receiptId, productId: line.productId, batchId: line.batchId, baseQuantityDelta: line.baseQuantity, allocatedCostPesewas: 0, totalLandedCostPesewas: line.totalLandedCostPesewas,
          batchSnapshot: { receivedAt: committedAt, expiryBusinessDate: line.expiryBusinessDate, unitsPerBulk: line.unitsPerBulk, baseUnit: line.baseUnit, bulkUnit: line.bulkUnit, receivedQuantityBreakdown: line.receivedQuantityBreakdown }, createdBy, createdAt: committedAt, serverCreatedAt: FieldValue.serverTimestamp()
        });
      });
      transaction.set(requestRef, { schemaVersion: 2, uid, requestFingerprint, purchaseId: purchaseRef.id, response, createdAt: committedAt, serverCreatedAt: FieldValue.serverTimestamp() });
      return response;
    });
  }

  return { receiveSecureStock };
}

module.exports = { BUSINESS_TIME_ZONE, MAX_BATCHES_PER_PRODUCT, createSecureReceivingService };
