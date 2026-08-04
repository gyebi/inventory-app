import { db } from "../firebase.js";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { normalizeFirebaseError } from "../utils/errorUtils.js";

const taxSettingsRef = doc(db, "settings", "tax");

const defaultTaxSettings = {
  enabled: true,
  vatRate: 15,
  nhilRate: 2.5,
  getfundRate: 2.5,
  withholdingVatRate: 7,
  effectiveDate: null,
  taxMode: "standard"
};

export function normalizeTaxSettings(taxSettings = {}) {
  return {
    ...defaultTaxSettings,
    ...taxSettings,
    enabled: taxSettings.enabled !== false,
    vatRate: Number(taxSettings.vatRate ?? defaultTaxSettings.vatRate),
    nhilRate: Number(taxSettings.nhilRate ?? defaultTaxSettings.nhilRate),
    getfundRate: Number(taxSettings.getfundRate ?? defaultTaxSettings.getfundRate),
    withholdingVatRate: Number(taxSettings.withholdingVatRate ?? defaultTaxSettings.withholdingVatRate),
    effectiveDate: taxSettings.effectiveDate || null,
    taxMode: taxSettings.taxMode || defaultTaxSettings.taxMode
  };
}

export async function fetchTaxSettingsFromCloud() {
  try {
    const snapshot = await getDoc(taxSettingsRef);

    if (!snapshot.exists()) {
      return normalizeTaxSettings();
    }

    return normalizeTaxSettings(snapshot.data());
  } catch (error) {
    throw normalizeFirebaseError(error, "Unable to load tax settings from Firestore. Check your connection and try again.");
  }
}

export async function saveTaxSettingsToCloud(taxSettings) {
  try {
    await setDoc(taxSettingsRef, {
      ...normalizeTaxSettings(taxSettings),
      updatedAt: serverTimestamp()
    }, { merge: true });
  } catch (error) {
    throw normalizeFirebaseError(error, "Unable to save tax settings to Firestore. Check your connection and try again.");
  }
}
