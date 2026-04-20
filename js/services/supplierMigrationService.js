import { getState } from "../state.js";
import { fetchSuppliersFromCloud, saveSupplierToCloud } from "./cloudSupplierService.js";

const MIGRATION_KEY = "inventory_suppliers_migrated";

const markSuppliersMigrated = () => {
  localStorage.setItem(MIGRATION_KEY, "true");
};

const suppliersAlreadyMigrated = () => {
  return localStorage.getItem(MIGRATION_KEY) === "true";
};

function createSupplierId(supplier) {
  const nameSlug = (supplier.name || "supplier")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return `supplier_${nameSlug || Date.now()}`;
}

export async function migrateLocalSuppliersToCloud() {
  const state = getState();
  const suppliers = state.suppliers || [];

  if (!suppliers.length) {
    console.log("No local suppliers to migrate");
    return;
  }

  for (const supplier of suppliers) {
    await saveSupplierToCloud({
      id: supplier.id || createSupplierId(supplier),
      ...supplier
    });
  }

  console.log(`Migrated ${suppliers.length} suppliers to Firestore`);
}

export async function migrateLocalSuppliersToCloudOnce() {
  if (suppliersAlreadyMigrated()) {
    return false;
  }

  const cloudSuppliers = await fetchSuppliersFromCloud();

  if (cloudSuppliers.length > 0) {
    markSuppliersMigrated();
    return false;
  }

  await migrateLocalSuppliersToCloud();
  markSuppliersMigrated();

  return true;
}
