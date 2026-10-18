import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase.js";
import { normalizeFirebaseError } from "../utils/errorUtils.js";

const call = async (name, payload, fallback) => {
  try {
    return /** @type {any} */ ((await httpsCallable(functions, name)(payload)).data);
  } catch (error) {
    throw normalizeFirebaseError(error, fallback);
  }
};

export const persistLegacyStockAdjustment = (payload) => call("recordLegacyStockAdjustment", payload, "The adjustment was not confirmed. Keep this request and retry after checking the adjustment history.");
export const startWeeklyStocktake = (payload) => call("startWeeklyStocktake", payload, "Unable to start stocktaking.");
export const saveWeeklyStocktakeCounts = (payload) => call("saveWeeklyStocktakeCounts", payload, "Unable to save this count. Reload if another counter has updated it.");
export const evaluateWeeklyStocktake = (payload) => call("evaluateWeeklyStocktake", payload, "Unable to evaluate this count.");
export const finaliseWeeklyStocktake = (payload) => call("finaliseWeeklyStocktake", payload, "Unable to finalise this report.");
export const updateWeeklyStocktakeSchedule = (payload) => call("updateWeeklyStocktakeSchedule", payload, "Unable to update the weekly stocktaking day.");

export const createPersistedRequestKey = (prefix) => {
  const bytes = globalThis.crypto?.getRandomValues ? globalThis.crypto.getRandomValues(new Uint32Array(4)) : [Date.now(), Math.random() * 1e9, 0, 0];
  return `${prefix}-${Date.now()}-${[...bytes].map((value) => Math.floor(value).toString(36)).join("")}`.slice(0, 120);
};
