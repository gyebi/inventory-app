import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase.js";
import { createAppError, ERROR_FLAGS } from "../utils/errorUtils.js";
import { getCurrentUser } from "./authService.js";

const STORAGE_KEY = "jyaano_provisional_opening_stock_checkout_attempt";
const code = (error) => String(error?.code || "").replace(/^functions\//, "");
const unknownOutcome = (error) => ["unavailable", "deadline-exceeded", "resource-exhausted", "network-request-failed"].includes(code(error));

function currentAttempt() {
  try { const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); return value && typeof value === "object" ? value : null; } catch { return null; }
}
function putAttempt(value) { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)); return value; }
function newKey() { return `provisional-opening-${crypto.randomUUID().replaceAll("-", "")}`; }
function appError(error) {
  if (unknownOutcome(error)) return createAppError("The provisional sale outcome is unknown. Retry the same sale to confirm it; do not start another sale.", { code: "provisional-opening/unknown-outcome", source: ERROR_FLAGS.SOURCE_FUNCTIONS, retryable: true, cause: error });
  return createAppError(String(error?.message || "Provisional opening-stock checkout could not be completed."), { code: code(error) || "provisional-opening/checkout-failed", source: ERROR_FLAGS.SOURCE_FUNCTIONS, cause: error });
}

export function getUnresolvedProvisionalOpeningStockCheckout() {
  const attempt = currentAttempt();
  return attempt?.outcome === "unknown" ? attempt : null;
}

export async function checkProvisionalOpeningStockEligibility(productId) {
  try { return (await httpsCallable(functions, "checkProvisionalOpeningStockEligibility")({ productId })).data; } catch (error) { throw appError(error); }
}

export async function quoteProvisionalOpeningStockCheckout({ cartItems, paymentMethod }) {
  try {
    return (await httpsCallable(functions, "quoteProvisionalOpeningStockSale")({
      items: cartItems.map((item) => ({ productId: item.productId, quantity: item.quantity,
        details: item.provisionalDetails, expectedRevision: item.provisionalExpectedRevision })),
      paymentMethod: ({ Cash: "cash", MoMo: "mobile_money", Card: "card" })[paymentMethod] || String(paymentMethod || "").toLowerCase()
    })).data;
  } catch (error) { throw appError(error); }
}

export async function submitProvisionalOpeningStockCheckout({ cartItems, paymentMethod, expectedQuoteFingerprint }) {
  const actorId = String(getCurrentUser()?.uid || getCurrentUser()?.id || "").trim();
  if (!actorId) throw createAppError("Sign in before completing a sale.", { code: "unauthenticated", source: ERROR_FLAGS.SOURCE_AUTH });
  const payload = { items: cartItems.map((item) => ({ productId: item.productId, quantity: item.quantity,
    details: item.provisionalDetails, expectedRevision: item.provisionalExpectedRevision })), expectedQuoteFingerprint,
    paymentMethod: ({ Cash: "cash", MoMo: "mobile_money", Card: "card" })[paymentMethod] || String(paymentMethod || "").toLowerCase() };
  const payloadJson = JSON.stringify(payload);
  let attempt = currentAttempt();
  if (!attempt || attempt.actorId !== actorId || attempt.payloadJson !== payloadJson) attempt = putAttempt({ actorId, payloadJson, idempotencyKey: newKey(), outcome: "pending" });
  try {
    const response = /** @type {any} */ ((await httpsCallable(functions, "submitProvisionalOpeningStockSale")({ idempotencyKey: attempt.idempotencyKey, ...payload })).data);
    if (response?.committed !== true || !response.sale?.id) throw new Error("The provisional sale response was incomplete.");
    localStorage.removeItem(STORAGE_KEY);
    return response.sale;
  } catch (error) {
    if (unknownOutcome(error)) putAttempt({ ...attempt, outcome: "unknown" });
    throw appError(error);
  }
}
