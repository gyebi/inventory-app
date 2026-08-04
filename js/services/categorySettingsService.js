import { db } from "../firebase.js";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { normalizeFirebaseError } from "../utils/errorUtils.js";

const categorySettingsRef = doc(db, "settings", "categories");

const defaultCategories = [
  "Water",
  "Soft Drink",
  "Juice",
  "Energy Drink"
];

export function normalizeCategories(categories = []) {
  return Array.from(
    new Set(
      categories
        .map((category) => String(category || "").trim())
        .filter(Boolean)
    )
  );
}

export function getDefaultCategories() {
  return [...defaultCategories];
}

export async function fetchCategorySettingsFromCloud() {
  try {
    const snapshot = await getDoc(categorySettingsRef);

    if (!snapshot.exists()) {
      return getDefaultCategories();
    }

    const data = snapshot.data();
    return normalizeCategories(Array.isArray(data.categories) ? data.categories : defaultCategories);
  } catch (error) {
    throw normalizeFirebaseError(error, "Unable to load product categories from Firestore. Check your connection and try again.");
  }
}

export async function saveCategorySettingsToCloud(categories = []) {
  const normalizedCategories = normalizeCategories(categories);

  try {
    await setDoc(categorySettingsRef, {
      categories: normalizedCategories,
      updatedAt: serverTimestamp()
    }, { merge: true });
  } catch (error) {
    throw normalizeFirebaseError(error, "Unable to save product categories to Firestore. Check your connection and try again.");
  }

  return normalizedCategories;
}
