import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
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

const app = getApps()[0] || initializeApp({ projectId });
const db = getFirestore(app);
const stamp = new Date().toISOString();
const productId = "synthetic-secure-sales-rehearsal";
const productRef = db.collection("products").doc(productId);
const batchRef = db.collection("stockBatches").doc("synthetic-secure-sales-rehearsal-batch");
const rehearsalUser = {
  uid: "synthetic-secure-sales-rehearsal",
  email: "secure-sales-rehearsal@synthetic.jyaano.test",
  fullName: "Synthetic Secure Sales Rehearsal",
  username: "synthetic.secure.sales",
  role: "sales"
};

async function ensureStagingRehearsalUser() {
  if (projectId !== "jyaano-staging") return;

  const password = String(process.env.JYAANO_SYNTHETIC_STAGING_PASSWORD || "");
  if (password.length < 12) {
    throw new Error("Set a unique 12+ character JYAANO_SYNTHETIC_STAGING_PASSWORD before seeding staging.");
  }

  const auth = getAuth(app);
  const authRecord = {
    email: rehearsalUser.email,
    password,
    displayName: rehearsalUser.fullName,
    disabled: false
  };
  try {
    await auth.updateUser(rehearsalUser.uid, authRecord);
  } catch (error) {
    if (error.code !== "auth/user-not-found") throw error;
    await auth.createUser({ uid: rehearsalUser.uid, ...authRecord });
  }

  await db.collection("users").doc(rehearsalUser.uid).set({
    ...rehearsalUser,
    active: true,
    isActive: true,
    syntheticFixture: true,
    updatedAt: stamp
  }, { merge: true });
}

async function ensureFixtureDocuments() {
  return db.runTransaction(async (transaction) => {
    const [productSnapshot, batchSnapshot] = await Promise.all([
      transaction.get(productRef),
      transaction.get(batchRef)
    ]);

    for (const snapshot of [productSnapshot, batchSnapshot]) {
      if (snapshot.exists && snapshot.data()?.syntheticFixture !== true) {
        throw new Error(`Refusing to reuse non-synthetic rehearsal document ${snapshot.ref.path}.`);
      }
    }

    if (!productSnapshot.exists) {
      transaction.create(productRef, {
        name: "Synthetic secure-sales rehearsal item",
        active: true,
        baseUnit: "Each",
        bulkUnit: "Pack",
        inventorySchemaVersion: 2,
        pricingStatus: "approved",
        sellingPricePesewas: 125,
        unitsPerBulk: 5,
        quantity: 10,
        sellableQuantity: 10,
        syntheticFixture: true,
        createdAt: stamp,
        updatedAt: stamp
      });
    }
    if (!batchSnapshot.exists) {
      transaction.create(batchRef, {
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
        createdAt: stamp,
        updatedAt: stamp
      });
    }

    return { productCreated: !productSnapshot.exists, batchCreated: !batchSnapshot.exists };
  });
}

await ensureStagingRehearsalUser();
const fixtureStatus = await ensureFixtureDocuments();
if (projectId === "jyaano-staging") {
  await db.collection("settings").doc("secureSales").set({
    enabled: true,
    schemaVersion: 2,
    rehearsalOnly: true,
    syntheticFixture: true,
    enabledAt: stamp,
    updatedAt: stamp
  }, { merge: true });
}

console.log(`PASS: idempotent synthetic rehearsal fixture prepared in ${projectId} (${fixtureStatus.productCreated ? "product created" : "product preserved"}; ${fixtureStatus.batchCreated ? "batch created" : "batch preserved"}).`);
