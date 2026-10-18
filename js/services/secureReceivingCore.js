import { createAppError, ERROR_FLAGS } from "../utils/errorUtils.js";

export const SECURE_RECEIVING_ATTEMPT_KEY = "jyaano.secureReceivingAttempt.v1";

const clone = (value) => JSON.parse(JSON.stringify(value));

export function parsePesewas(value, { blankAsZero = false } = {}) {
  const normalized = String(value ?? "").trim();
  if (!normalized && blankAsZero) return 0;
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  const pesewas = Number(whole) * 100 + Number((fraction + "00").slice(0, 2));
  return Number.isSafeInteger(pesewas) ? pesewas : null;
}

export function shouldRetainSecureReceiveAttempt(error) {
  const code = String(error?.code || "").replace(/^functions\//, "");
  return error?.code === "secure-receiving/unconfirmed-response" || ["unavailable", "deadline-exceeded", "resource-exhausted", "network-request-failed"].includes(code);
}

function createIdempotencyKey(randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto)) {
  if (typeof randomUUID === "function") return `receive-${randomUUID()}`;
  return `receive-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

/** @param {any} purchase */
export function normalizeSecureReceivePayload(purchase = {}) {
  if (!purchase || typeof purchase !== "object" || Array.isArray(purchase)) {
    throw createAppError("The supplier purchase is invalid.", { code: "secure-receiving/invalid-purchase", source: ERROR_FLAGS.SOURCE_VALIDATION });
  }

  const supplier = String(purchase.supplier || "").trim();
  const invoiceNumber = String(purchase.invoiceNumber || "").trim();
  const purchaseDate = String(purchase.purchaseDate || "").trim();
  const paymentStatus = String(purchase.paymentStatus || "").trim();
  const dueDate = String(purchase.dueDate || "").trim();

  if (!supplier || !invoiceNumber || !purchaseDate) {
    throw createAppError("Supplier, invoice number, and purchase date are required.", { code: "secure-receiving/missing-purchase-details", source: ERROR_FLAGS.SOURCE_VALIDATION });
  }
  if (!Array.isArray(purchase.lines) || purchase.lines.length === 0) {
    throw createAppError("Add at least one product line before saving.", { code: "secure-receiving/no-lines", source: ERROR_FLAGS.SOURCE_VALIDATION });
  }
  if ((paymentStatus === "Credit" || paymentStatus === "Part Payment") && !dueDate) {
    throw createAppError("Enter a due date for Credit or Part Payment purchases.", { code: "secure-receiving/missing-due-date", source: ERROR_FLAGS.SOURCE_VALIDATION });
  }

  const productIds = new Set();
  const lines = purchase.lines.map((line) => {
    const productId = String(line?.productId || "").trim();
    const hasBreakdown = Object.hasOwn(line || {}, "bulkQuantityReceived") || Object.hasOwn(line || {}, "looseBaseQuantityReceived");
    const bulkQuantityReceived = hasBreakdown
      ? Number(line?.bulkQuantityReceived ?? 0)
      : (String(line?.unit || "").trim().toLowerCase() === "bulk" ? Number(line?.quantity) : 0);
    const looseBaseQuantityReceived = hasBreakdown
      ? Number(line?.looseBaseQuantityReceived ?? 0)
      : (String(line?.unit || "").trim().toLowerCase() === "base" ? Number(line?.quantity) : 0);
    const suppliedPurchaseCost = line?.totalPurchaseCostPesewas;
    const suppliedLegacyCost = line?.totalBulkCostPesewas;
    const totalPurchaseCostPesewas = Number(suppliedPurchaseCost ?? suppliedLegacyCost);
    const additionalExpensesPesewas = Number(line?.additionalExpensesPesewas);

    if (!productId || !Number.isSafeInteger(bulkQuantityReceived) || bulkQuantityReceived < 0 || !Number.isSafeInteger(looseBaseQuantityReceived) || looseBaseQuantityReceived < 0 || (bulkQuantityReceived === 0 && looseBaseQuantityReceived === 0) || !Number.isSafeInteger(totalPurchaseCostPesewas) || totalPurchaseCostPesewas < 0 || !Number.isSafeInteger(additionalExpensesPesewas) || additionalExpensesPesewas < 0 || (suppliedPurchaseCost !== undefined && suppliedLegacyCost !== undefined && Number(suppliedPurchaseCost) !== Number(suppliedLegacyCost))) {
      throw createAppError("Each secure receiving line needs bulk, loose, or both whole quantities and costs expressed in whole pesewas.", { code: "secure-receiving/invalid-line", source: ERROR_FLAGS.SOURCE_VALIDATION });
    }
    if (productIds.has(productId)) {
      throw createAppError("A product may appear only once in a secure receiving request.", { code: "secure-receiving/duplicate-product", source: ERROR_FLAGS.SOURCE_VALIDATION });
    }
    productIds.add(productId);
    return {
      productId,
      bulkQuantityReceived,
      looseBaseQuantityReceived,
      totalPurchaseCostPesewas,
      // Preserve this response/payload alias for existing callers and receipts.
      totalBulkCostPesewas: totalPurchaseCostPesewas,
      additionalExpensesPesewas,
      expiryBusinessDate: String(line?.expiryBusinessDate || "").trim()
    };
  });

  return {
    supplier,
    invoiceNumber,
    purchaseDate,
    paymentStatus,
    dueDate,
    notes: String(purchase.notes || "").trim(),
    receivedByNote: String(purchase.receivedByNote || "").trim(),
    lines
  };
}

export function createSecureReceivingAttemptStore({ storage = globalThis.localStorage, now = () => new Date().toISOString(), randomUUID = undefined } = {}) {
  const clear = () => storage?.removeItem(SECURE_RECEIVING_ATTEMPT_KEY);
  const save = (attempt) => {
    storage?.setItem(SECURE_RECEIVING_ATTEMPT_KEY, JSON.stringify(attempt));
    return attempt;
  };
  const load = () => {
    try {
      const raw = storage?.getItem(SECURE_RECEIVING_ATTEMPT_KEY);
      if (!raw) return null;
      const attempt = JSON.parse(raw);
      if (!attempt?.actorId || !attempt?.idempotencyKey || typeof attempt.payloadJson !== "string") return null;
      normalizeSecureReceivePayload(JSON.parse(attempt.payloadJson));
      return attempt;
    } catch {
      clear();
      return null;
    }
  };

  function getOrCreate({ actorId, purchase }) {
    const payload = normalizeSecureReceivePayload(purchase);
    const payloadJson = JSON.stringify(payload);
    const existing = load();

    if (existing) {
      if (existing.actorId !== actorId && existing.outcome === "unknown") {
        throw createAppError("A previous user has an unresolved secure purchase on this device. That user must retry the unchanged request first.", { code: "secure-receiving/unresolved-purchase", source: ERROR_FLAGS.SOURCE_FUNCTIONS });
      }
      if (existing.actorId === actorId && existing.payloadJson === payloadJson) return existing;
      if (existing.outcome === "unknown" || existing.outcome === "pending") {
        throw createAppError("This purchase may already have been received. Retry the unchanged request to confirm it; do not alter or submit another purchase.", { code: "secure-receiving/unresolved-purchase", source: ERROR_FLAGS.SOURCE_FUNCTIONS, retryable: true });
      }
      clear();
    }

    return save({ version: 1, actorId, idempotencyKey: createIdempotencyKey(randomUUID), payloadJson, createdAt: now(), outcome: "pending" });
  }

  return { clear, getOrCreate, load, markUnknown: (attempt) => save({ ...attempt, outcome: "unknown", lastAttemptAt: now() }) };
}

export function purchaseFromSecureReceiveAttempt(attempt) {
  if (!attempt?.payloadJson) return null;
  try {
    return normalizeSecureReceivePayload(JSON.parse(attempt.payloadJson));
  } catch {
    return null;
  }
}

/** @param {any} response */
export function mapSecureReceiveResponse(response = {}) {
  const purchase = /** @type {any} */ (clone(response));
  purchase.totalLandedCost = Number(response.totalLandedCostPesewas || 0) / 100;
  purchase.lines = (Array.isArray(response.lines) ? response.lines : []).map((line) => ({
    ...line,
    totalPurchaseCost: Number(line.totalPurchaseCostPesewas ?? line.totalBulkCostPesewas ?? 0) / 100,
    totalBulkCost: Number(line.totalPurchaseCostPesewas ?? line.totalBulkCostPesewas ?? 0) / 100,
    additionalExpenses: Number(line.additionalExpensesPesewas || 0) / 100,
    totalLandedCost: Number(line.totalLandedCostPesewas || 0) / 100,
    unitCost: Number(line.totalLandedCostPesewas || 0) / 100 / Number(line.baseQuantity || 1),
    expiryDate: line.expiryBusinessDate || "",
    receivedAt: response.committedAt,
    receivedBy: response.createdBy?.fullName || response.createdBy?.username || ""
  }));
  return purchase;
}
