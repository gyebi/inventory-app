import { doc, getDocFromServer } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../firebase.js";
import { getCurrentUser } from "./authService.js";
import { createAppError, ERROR_FLAGS } from "../utils/errorUtils.js";
import { createSecureCheckoutAttemptStore, mapSecureSaleResponse, normalizeSecureCheckoutPayload } from "./secureCheckoutCore.js";

const secureSalesSettingsRef = doc(db, "settings", "secureSales");
const attemptStore = createSecureCheckoutAttemptStore();
const normalizedFunctionCode = (error) => String(error?.code || "").replace(/^functions\//, "");
const isUnknownOutcome = (error) => ["unavailable", "deadline-exceeded", "resource-exhausted", "network-request-failed"].includes(normalizedFunctionCode(error));

function secureCheckoutError(error) {
  const code = normalizedFunctionCode(error);
  const serverMessage = String(error?.details?.message || error?.message || "");
  let message = serverMessage || "Secure checkout could not be completed.";
  if (/canonical selling price|pricingStatus/i.test(serverMessage)) message = "This product has no approved selling price. Ask a manager to approve its price, then retry the same checkout.";
  else if (/insufficient sellable stock/i.test(serverMessage)) message = "There is not enough sellable stock for this sale. Reduce the quantity or receive/reconcile stock before retrying.";
  else if (/aggregate quantities do not reconcile|reconcile batches|migrated to authoritative batches/i.test(serverMessage)) message = "Inventory needs reconciliation before this product can be sold. Ask an inventory manager to reconcile its authoritative batches.";
  else if (code === "permission-denied") message = "You do not have permission to complete secure sales. Sign in with an active sales or admin account.";
  else if (code === "unauthenticated") message = "Your session has expired. Sign in again before retrying this secure checkout.";
  else if (isUnknownOutcome(error)) message = "The secure checkout outcome is unknown because the service or connection was unavailable. Your cart is retained and locked: retry this exact checkout to confirm it. Do not create a second sale.";
  else if (code === "failed-precondition" && /Prices or taxes changed after the checkout quote/i.test(serverMessage)) message = "Prices or taxes changed before this sale was submitted. Review the updated server totals and confirm again.";
  else if (code === "failed-precondition" && /disabled/i.test(serverMessage)) message = "Secure checkout was turned off before this sale was confirmed. No legacy checkout was submitted; refresh and try again.";
  return createAppError(message, { code: code || "secure-sales/checkout-failed", source: ERROR_FLAGS.SOURCE_FUNCTIONS, retryable: isUnknownOutcome(error), cause: error });
}

export async function isSecureSalesEnabled() {
  try {
    // A server read prevents an offline cache from silently selecting the legacy path.
    const snapshot = await getDocFromServer(secureSalesSettingsRef);
    return snapshot.exists() && snapshot.data()?.enabled === true;
  } catch (error) {
    throw createAppError("Checkout availability cannot be confirmed while offline or while Firestore is unavailable. Reconnect, then try again; secure sales are never queued through legacy sync.", { code: normalizedFunctionCode(error) || "secure-sales/mode-unavailable", source: ERROR_FLAGS.SOURCE_FUNCTIONS, retryable: true, cause: error });
  }
}

export function getUnresolvedSecureCheckout() {
  const attempt = attemptStore.load();
  return attempt?.outcome === "unknown" ? attempt : null;
}

export async function quoteSecureCheckout({ cartItems, paymentMethod }) {
  const payload = JSON.parse(JSON.stringify({ items: cartItems.map((item) => ({ productId: item.productId, quantity: item.quantity, unit: item.saleUnit || item.unit })), paymentMethod }));
  // Reuse payload validation without persisting an idempotency attempt until the cashier confirms.
  const normalized = normalizeSecureCheckoutPayload(payload.items, payload.paymentMethod);
  try {
    const quote = httpsCallable(functions, "quoteSecureSale");
    const result = await quote(normalized);
    const response = /** @type {any} */ (result?.data || {});
    if (!response.quoteFingerprint || !response.sale) throw createAppError("The secure checkout quote was incomplete. Refresh and review the sale again.", { code: "secure-sales/unconfirmed-quote", source: ERROR_FLAGS.SOURCE_FUNCTIONS });
    return { quoteFingerprint: response.quoteFingerprint, sale: mapSecureSaleResponse(response.sale) };
  } catch (error) {
    throw secureCheckoutError(error);
  }
}

export async function submitSecureCheckout({ cartItems, paymentMethod, expectedQuoteFingerprint }) {
  const currentUser = getCurrentUser();
  const actorId = String(currentUser?.uid || currentUser?.id || currentUser?.username || "").trim();
  if (!actorId) throw createAppError("Sign in before completing a secure sale.", { code: "unauthenticated", source: ERROR_FLAGS.SOURCE_AUTH });
  const attempt = attemptStore.getOrCreate({ actorId, cartItems, paymentMethod, expectedQuoteFingerprint });
  const payload = JSON.parse(attempt.payloadJson);
  try {
    const submit = httpsCallable(functions, "submitSecureSale");
    const result = await submit({ idempotencyKey: attempt.idempotencyKey, ...payload });
    const response = /** @type {any} */ (result?.data || {});
    if (response.committed !== true || !response.saleId) throw createAppError("The secure sale did not return a confirmed server sale. Retry the unchanged checkout to resolve it.", { code: "secure-sales/unconfirmed-response", source: ERROR_FLAGS.SOURCE_FUNCTIONS, retryable: true });
    const sale = mapSecureSaleResponse(response.sale || response);
    if (!sale.id) throw createAppError("The secure sale response was incomplete. Retry the unchanged checkout to resolve it.", { code: "secure-sales/unconfirmed-response", source: ERROR_FLAGS.SOURCE_FUNCTIONS, retryable: true });
    attemptStore.clear();
    return sale;
  } catch (error) {
    if (normalizedFunctionCode(error) === "failed-precondition" && /Prices or taxes changed after the checkout quote/i.test(String(error?.message || ""))) attemptStore.clear();
    else if (error?.code === "secure-sales/unconfirmed-response" || isUnknownOutcome(error)) attemptStore.markUnknown(attempt);
    throw secureCheckoutError(error);
  }
}
