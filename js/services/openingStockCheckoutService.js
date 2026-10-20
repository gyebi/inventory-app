import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase.js";
import { createAppError, ERROR_FLAGS } from "../utils/errorUtils.js";
import { getCurrentUser } from "./authService.js";

const STORAGE_KEY = "jyaano_opening_stock_checkout_attempt";
const callableCode = (error) => String(error?.code || "").replace(/^functions\//, "");
const unknownOutcome = (error) => ["unavailable", "deadline-exceeded", "resource-exhausted", "network-request-failed"].includes(callableCode(error));

function currentAttempt() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

function putAttempt(value) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  return value;
}

function newKey() {
  return `opening-${crypto.randomUUID().replaceAll("-", "")}`;
}

function errorForOpeningCheckout(error) {
  const message = String(error?.message || "");
  if (unknownOutcome(error)) return createAppError("The opening-stock sale outcome is unknown. Your cart is locked; retry the same sale to confirm it. Do not create another sale.", { code: "opening-stock/unknown-outcome", source: ERROR_FLAGS.SOURCE_FUNCTIONS, retryable: true, cause: error });
  if (/Prices, packaging, stock status, or tax settings changed/i.test(message)) return createAppError("Selling details changed. Review the refreshed checkout before confirming.", { code: "opening-stock/stale-quote", source: ERROR_FLAGS.SOURCE_FUNCTIONS, cause: error });
  return createAppError(message || "Opening-stock checkout could not be completed.", { code: callableCode(error) || "opening-stock/checkout-failed", source: ERROR_FLAGS.SOURCE_FUNCTIONS, cause: error });
}

export function getUnresolvedOpeningStockCheckout() {
  const attempt = currentAttempt();
  return attempt?.outcome === "unknown" ? attempt : null;
}

export async function quoteOpeningStockCheckout({ cartItems, paymentMethod }) {
  try {
    const result = await httpsCallable(functions, "quoteOpeningStockSale")({
      items: cartItems.map((item) => ({ productId: item.productId, quantity: item.quantity, unit: item.saleUnit || item.unit })),
      paymentMethod: ({ Cash: "cash", MoMo: "mobile_money", Card: "card" })[paymentMethod] || String(paymentMethod || "").toLowerCase()
    });
    const response = /** @type {any} */ (result.data || {});
    if (!response.quoteFingerprint || !response.sale) throw new Error("The opening-stock quote was incomplete.");
    return response;
  } catch (error) {
    throw errorForOpeningCheckout(error);
  }
}

export async function submitOpeningStockCheckout({ cartItems, paymentMethod, expectedQuoteFingerprint }) {
  const user = getCurrentUser();
  const actorId = String(user?.uid || user?.id || user?.username || "").trim();
  if (!actorId) throw createAppError("Sign in before completing a sale.", { code: "unauthenticated", source: ERROR_FLAGS.SOURCE_AUTH });
  const payload = {
    items: cartItems.map((item) => ({ productId: item.productId, quantity: item.quantity, unit: item.saleUnit || item.unit })),
    paymentMethod: ({ Cash: "cash", MoMo: "mobile_money", Card: "card" })[paymentMethod] || String(paymentMethod || "").toLowerCase(),
    expectedQuoteFingerprint
  };
  const payloadJson = JSON.stringify(payload);
  let attempt = currentAttempt();
  if (!attempt || attempt.actorId !== actorId || attempt.payloadJson !== payloadJson) {
    attempt = putAttempt({ actorId, payloadJson, idempotencyKey: newKey(), outcome: "pending" });
  }
  try {
    const result = await httpsCallable(functions, "submitOpeningStockSale")({ idempotencyKey: attempt.idempotencyKey, ...payload });
    const response = /** @type {any} */ (result.data || {});
    if (response.committed !== true || !response.sale?.id) throw new Error("The opening-stock sale response was incomplete.");
    localStorage.removeItem(STORAGE_KEY);
    return response.sale;
  } catch (error) {
    if (unknownOutcome(error)) putAttempt({ ...attempt, outcome: "unknown" });
    throw errorForOpeningCheckout(error);
  }
}
