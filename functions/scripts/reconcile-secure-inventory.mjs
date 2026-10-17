import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const ALLOWED_PROJECTS = new Set(["demo-jyaano", "jyaano-staging"]);
const projectId = String(process.env.GCLOUD_PROJECT || "").trim();

if (!ALLOWED_PROJECTS.has(projectId)) {
  throw new Error("Reconciliation is restricted to demo-jyaano or jyaano-staging; production is never accepted.");
}
if (projectId === "jyaano-staging" && process.env.JYAANO_ALLOW_SYNTHETIC_STAGING !== "true") {
  throw new Error("Set JYAANO_ALLOW_SYNTHETIC_STAGING=true to read the staging rehearsal environment.");
}
if (process.env.JYAANO_RECONCILIATION_DRY_RUN !== "true") {
  throw new Error("Set JYAANO_RECONCILIATION_DRY_RUN=true. This tool is read-only and never performs migration writes.");
}

const db = getFirestore(getApps()[0] || initializeApp({ projectId }));
const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Accra",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
}).formatToParts(new Date()).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
const todayBusinessDate = `${today.year}-${today.month}-${today.day}`;
const [productsSnapshot, batchesSnapshot] = await Promise.all([
  db.collection("products").get(),
  db.collection("stockBatches").get()
]);
const byProduct = new Map();

for (const document of batchesSnapshot.docs) {
  const batch = document.data();
  const list = byProduct.get(batch.productId) || [];
  list.push({ id: document.id, ...batch });
  byProduct.set(batch.productId, list);
}

const discrepancies = [];
const unresolvedPrices = [];
for (const document of productsSnapshot.docs) {
  const product = document.data();
  const batches = byProduct.get(document.id) || [];
  const remaining = batches.reduce((sum, batch) => sum + (Number.isSafeInteger(batch.remainingBaseQuantity) ? batch.remainingBaseQuantity : 0), 0);
  const sellable = batches
    .filter((batch) => batch.inventoryStatus === "active" && (!batch.expiryBusinessDate || (/^\d{4}-\d{2}-\d{2}$/.test(batch.expiryBusinessDate) && batch.expiryBusinessDate >= todayBusinessDate)))
    .reduce((sum, batch) => sum + (Number.isSafeInteger(batch.remainingBaseQuantity) ? batch.remainingBaseQuantity : 0), 0);
  if (product.inventorySchemaVersion === 2 && (product.quantity !== remaining || product.sellableQuantity !== sellable)) {
    discrepancies.push({ productId: document.id, productQuantity: product.quantity, batchRemaining: remaining, productSellableQuantity: product.sellableQuantity, batchSellable: sellable });
  }
  if (product.inventorySchemaVersion === 2 && (product.pricingStatus !== "approved" || !Number.isSafeInteger(product.sellingPricePesewas) || product.sellingPricePesewas < 1)) {
    unresolvedPrices.push({ productId: document.id, name: product.name || document.id });
  }
}

const report = { dryRun: true, projectId, todayBusinessDate, products: productsSnapshot.size, batches: batchesSnapshot.size, discrepancies, unresolvedPrices };
console.log(JSON.stringify(report, null, 2));
if (discrepancies.length || unresolvedPrices.length) process.exitCode = 2;
