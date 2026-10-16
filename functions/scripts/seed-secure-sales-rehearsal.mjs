import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const projectId = String(process.env.GCLOUD_PROJECT || "").trim();
if (!["demo-jyaano", "jyaano-staging"].includes(projectId)) {
  throw new Error("Synthetic rehearsal writes are restricted to demo-jyaano or jyaano-staging; production is never accepted.");
}
if (projectId === "jyaano-staging" && process.env.JYAANO_ALLOW_SYNTHETIC_STAGING !== "true") {
  throw new Error("Set JYAANO_ALLOW_SYNTHETIC_STAGING=true before explicitly seeding staging.");
}
if (projectId === "demo-jyaano" && !process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("demo-jyaano rehearsal writes require FIRESTORE_EMULATOR_HOST.");
}

const db = getFirestore(getApps()[0] || initializeApp({ projectId }));
const stamp = new Date().toISOString();
const productId = "synthetic-secure-sales-rehearsal";
const productRef = db.collection("products").doc(productId);
const batchRef = db.collection("stockBatches").doc("synthetic-secure-sales-rehearsal-batch");

await Promise.all([
  productRef.set({
    name: "Synthetic secure-sales rehearsal item",
    active: true,
    inventorySchemaVersion: 2,
    pricingStatus: "approved",
    sellingPricePesewas: 125,
    unitsPerBulk: 5,
    quantity: 10,
    sellableQuantity: 10,
    syntheticFixture: true,
    updatedAt: stamp
  }, { merge: true }),
  batchRef.set({
    schemaVersion: 2,
    productId,
    originalBaseQuantity: 10,
    remainingBaseQuantity: 10,
    costAllocatedBaseQuantity: 0,
    totalLandedCostPesewas: 1125,
    baseUnit: "Each",
    bulkUnit: "Pack",
    unitsPerBulk: 5,
    receivedAt: stamp,
    expiryBusinessDate: "",
    inventoryStatus: "active",
    syntheticFixture: true,
    updatedAt: stamp
  }, { merge: true })
]);
console.log(`PASS: idempotent synthetic rehearsal fixture prepared in ${projectId}.`);
