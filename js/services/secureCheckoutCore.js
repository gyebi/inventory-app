import { createAppError, ERROR_FLAGS } from "../utils/errorUtils.js";
export const SECURE_CHECKOUT_ATTEMPT_KEY = "jyaano.secureCheckoutAttempt.v1";
const clone = (value) => JSON.parse(JSON.stringify(value));
function createIdempotencyKey(randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto)) { return typeof randomUUID === "function" ? `sale-${randomUUID()}` : `sale-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`; }
export function normalizeSecureCheckoutPayload(cartItems = [], paymentMethod = "Cash", expectedQuoteFingerprint = "") {
  if (!Array.isArray(cartItems) || cartItems.length === 0) throw createAppError("Add at least one item before completing the sale.", { code: "sale/empty-cart", source: ERROR_FLAGS.SOURCE_VALIDATION });
  const productIds = new Set();
  const items = cartItems.map((cartItem) => {
    const productId = String(cartItem?.productId || "").trim(); const quantity = Number(cartItem?.quantity); const unit = String(cartItem?.saleUnit || cartItem?.unit || "").trim().toLowerCase();
    if (!productId || !Number.isInteger(quantity) || quantity < 1 || (unit !== "base" && unit !== "bulk")) throw createAppError("Each secure-sale line needs a product, a whole quantity, and a base or bulk unit.", { code: "secure-sales/invalid-checkout-line", source: ERROR_FLAGS.SOURCE_VALIDATION });
    if (productIds.has(productId)) throw createAppError("A product cannot be sold in both base and bulk units in one secure checkout. Complete separate sales for that product.", { code: "secure-sales/duplicate-product", source: ERROR_FLAGS.SOURCE_VALIDATION });
    productIds.add(productId); return { productId, quantity, unit };
  });
  const payment = ({ cash: "cash", momo: "mobile_money", card: "card" })[String(paymentMethod || "").trim().toLowerCase()];
  if (!payment) throw createAppError("Choose Cash, MoMo, or Card before completing the secure sale.", { code: "secure-sales/invalid-payment-method", source: ERROR_FLAGS.SOURCE_VALIDATION });
  const expected = String(expectedQuoteFingerprint || "").trim();
  if (expected && !/^[a-f0-9]{64}$/.test(expected)) throw createAppError("The server checkout quote is invalid. Review the sale again.", { code: "secure-sales/invalid-quote", source: ERROR_FLAGS.SOURCE_VALIDATION });
  return { items, paymentMethod: payment, ...(expected ? { expectedQuoteFingerprint: expected } : {}) };
}
export function createSecureCheckoutAttemptStore({ storage = globalThis.localStorage, now = () => new Date().toISOString(), randomUUID = undefined } = {}) {
  const clear = () => storage?.removeItem(SECURE_CHECKOUT_ATTEMPT_KEY);
  const load = () => { try { const raw = storage?.getItem(SECURE_CHECKOUT_ATTEMPT_KEY); if (!raw) return null; const attempt = JSON.parse(raw); if (!attempt?.idempotencyKey || typeof attempt.payloadJson !== "string" || !attempt.actorId) return null; const payload = JSON.parse(attempt.payloadJson); normalizeSecureCheckoutPayload(payload.items, payload.paymentMethod, payload.expectedQuoteFingerprint); return attempt; } catch { clear(); return null; } };
  const save = (attempt) => { storage?.setItem(SECURE_CHECKOUT_ATTEMPT_KEY, JSON.stringify(attempt)); return attempt; };
  function getOrCreate({ actorId, cartItems, paymentMethod, expectedQuoteFingerprint }) {
    const payload = normalizeSecureCheckoutPayload(cartItems, paymentMethod, expectedQuoteFingerprint); const payloadJson = JSON.stringify(payload); const existing = load();
    if (existing) { if (existing.actorId !== actorId && existing.outcome === "unknown") throw createAppError("A previous cashier has an unresolved secure checkout on this device. Sign in as that cashier and retry it before starting another sale.", { code: "secure-sales/unresolved-checkout", source: ERROR_FLAGS.SOURCE_FUNCTIONS }); if (existing.payloadJson === payloadJson && existing.actorId === actorId) return existing; if (existing.outcome === "unknown") throw createAppError("This checkout may already have reached the server. Retry the unchanged checkout to confirm its outcome; do not start a second sale.", { code: "secure-sales/unresolved-checkout", source: ERROR_FLAGS.SOURCE_FUNCTIONS, retryable: true }); clear(); }
    return save({ version: 1, actorId, idempotencyKey: createIdempotencyKey(randomUUID), payloadJson, createdAt: now(), outcome: "pending" });
  }
  const markUnknown = (attempt) => save({ ...attempt, outcome: "unknown", lastAttemptAt: now() });
  return { clear, getOrCreate, load, markUnknown };
}
export function mapSecureSaleResponse(response = {}) {
  const tax = response.taxBreakdown || {}; const toAmount = (value) => Number(value || 0) / 100; const items = Array.isArray(response.items) ? clone(response.items) : [];
  const sale = { id: response.saleId || response.id, committed: response.committed === true, createdAt: response.committedAt || response.createdAt, committedAt: response.committedAt || response.createdAt, currency: response.currency || "GHS", paymentMethod: response.paymentMethod || null, createdBy: clone(response.createdBy || {}), user: response.createdBy?.fullName || response.createdBy?.username || "unknown", items, subtotalAmount: toAmount(response.subtotalPesewas), totalAmount: toAmount(response.totalAmountPesewas), subtotalPesewas: Number(response.subtotalPesewas || 0), totalAmountPesewas: Number(response.totalAmountPesewas || 0), taxBreakdown: { subtotal: toAmount(tax.subtotalPesewas), vatRate: Number(tax.vatRateBasisPoints || 0) / 100, nhilRate: Number(tax.nhilRateBasisPoints || 0) / 100, getfundRate: Number(tax.getfundRateBasisPoints || 0) / 100, withholdingVatRate: Number(tax.withholdingVatRateBasisPoints || 0) / 100, vatAmount: toAmount(tax.vatAmountPesewas), nhilAmount: toAmount(tax.nhilAmountPesewas), getfundAmount: toAmount(tax.getfundAmountPesewas), withholdingVatAmount: toAmount(tax.withholdingVatAmountPesewas), taxAmount: toAmount(tax.taxAmountPesewas), totalAmount: toAmount(tax.totalAmountPesewas), taxMode: tax.taxMode || "standard", enabled: tax.enabled === true, effectiveDate: tax.effectiveDate || null }, syncStatus: "synced", syncedAt: response.committedAt || response.createdAt, cloudSyncedAt: response.committedAt || response.createdAt, lastSyncError: null };
  const primaryItem = items[0]; sale.productId = items.length === 1 ? primaryItem.productId : null; sale.product = items.length === 1 ? primaryItem.name : "Multiple Items"; sale.qty = items.length === 1 ? primaryItem.quantity : items.length; sale.saleUnit = items.length === 1 ? primaryItem.unit : "mixed"; sale.saleUnitType = items.length === 1 ? primaryItem.saleUnit : "mixed"; sale.actualQtySold = items.reduce((sum, item) => sum + Number(item.baseQuantity || item.actualQtySold || 0), 0); return sale;
}
