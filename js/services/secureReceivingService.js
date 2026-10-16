import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase.js";
import { getCurrentUser } from "./authService.js";
import { createAppError, ERROR_FLAGS } from "../utils/errorUtils.js";
import { createSecureReceivingAttemptStore, mapSecureReceiveResponse, shouldRetainSecureReceiveAttempt } from "./secureReceivingCore.js";

const attemptStore = createSecureReceivingAttemptStore();
const functionCode = (error) => String(error?.code || "").replace(/^functions\//, "");
const isUnknownOutcome = (error) => shouldRetainSecureReceiveAttempt(error);

export function getUnresolvedSecureReceive() {
  const attempt = attemptStore.load();
  return attempt?.outcome === "pending" || attempt?.outcome === "unknown" ? attempt : null;
}

export async function submitSecureReceive(purchase) {
  const currentUser = getCurrentUser();
  const actorId = String(currentUser?.uid || currentUser?.id || currentUser?.username || "").trim();
  if (!actorId) throw createAppError("Sign in before receiving stock.", { code: "unauthenticated", source: ERROR_FLAGS.SOURCE_AUTH });
  const attempt = attemptStore.getOrCreate({ actorId, purchase });
  try {
    const receive = httpsCallable(functions, "receiveSecureStock");
    const result = await receive({ idempotencyKey: attempt.idempotencyKey, purchase: JSON.parse(attempt.payloadJson) });
    const response = /** @type {any} */ (result?.data || {});
    if (response.committed !== true || !response.purchaseId) throw createAppError("The secure receive did not return a confirmed purchase. Retry the unchanged form to resolve it.", { code: "secure-receiving/unconfirmed-response", source: ERROR_FLAGS.SOURCE_FUNCTIONS, retryable: true });
    attemptStore.clear();
    return mapSecureReceiveResponse(response);
  } catch (error) {
    if (shouldRetainSecureReceiveAttempt(error)) attemptStore.markUnknown(attempt);
    else attemptStore.clear();
    const serverMessage = String(error?.details?.message || error?.message || "");
    const message = isUnknownOutcome(error) ? "The secure receiving outcome is unknown. The form is retained and locked: retry this exact purchase to confirm it. Do not create a second receipt." : (serverMessage || "Secure receiving could not be completed.");
    throw createAppError(message, { code: functionCode(error) || "secure-receiving/receive-failed", source: ERROR_FLAGS.SOURCE_FUNCTIONS, retryable: isUnknownOutcome(error), cause: error });
  }
}
