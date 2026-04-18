import { getState } from "../state.js";
import { fetchProductsFromCloud, saveProductToCloud } from "./cloudProductService.js";

const MIGRATION_KEY = "inventory_products_migrated";

const markProductsMigrated = () => {
  localStorage.setItem(MIGRATION_KEY, "true");
};

const productsAlreadyMigrated = () => {
  return localStorage.getItem(MIGRATION_KEY) === "true";
};

export async function migrateLocalProductsToCloud() {
  const state = getState();
  const products = state.products || [];

  if (!products.length) {
    console.log("No local products to migrate");
    return;
  }

  for (const product of products) {
    await saveProductToCloud(product);
  }

  console.log(`Migrated ${products.length} products to Firestore`);
}

export async function migrateLocalProductsToCloudOnce() {
  if (productsAlreadyMigrated()) {
    return false;
  }

  const cloudProducts = await fetchProductsFromCloud();

  if (cloudProducts.length > 0) {
    markProductsMigrated();
    return false;
  }

  await migrateLocalProductsToCloud();
  markProductsMigrated();

  return true;
}
