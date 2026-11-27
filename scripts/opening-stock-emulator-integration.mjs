import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { deleteApp, initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { connectFirestoreEmulator, doc, getDoc, getFirestore, runTransaction, setDoc, terminate } from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";
import { DEMO_EMULATOR_PROJECT_ID, LOCAL_EMULATOR_ENDPOINTS, SYNTHETIC_EMULATOR_FIREBASE_CONFIG, assertLocalEmulatorTarget } from "../js/utils/emulatorConfig.mjs";
import { resolvePersistedProductSellingPrice } from "../js/services/productPriceResolver.mjs";

// The integration runner is an application script, while the Admin SDK is a
// Functions dependency. Resolve it from that package rather than adding a
// production dependency solely for emulator fixture setup.
const requireFunctions = createRequire(new URL("../functions/package.json", import.meta.url));
const { getApps, initializeApp: initializeAdminApp } = requireFunctions("firebase-admin/app");
const { getAuth: getAdminAuth } = requireFunctions("firebase-admin/auth");
const { getFirestore: getAdminFirestore } = requireFunctions("firebase-admin/firestore");

assertLocalEmulatorTarget(process.env.GCLOUD_PROJECT, LOCAL_EMULATOR_ENDPOINTS);
const suffix = `${Date.now()}`;
const apps = [];
const fixtureUsers = {
  admin: { uid: `provisional-admin-${suffix}`, email: `provisional-admin-${suffix}@demo.jyaano.test`, fullName: "Synthetic Provisional Admin", role: "admin" },
  manager: { uid: `provisional-manager-${suffix}`, email: `provisional-manager-${suffix}@demo.jyaano.test`, fullName: "Synthetic Provisional Manager", role: "manager" },
  sales: { uid: `provisional-sales-${suffix}`, email: `provisional-sales-${suffix}@demo.jyaano.test`, fullName: "Synthetic Provisional Sales", role: "sales" },
  keeper: { uid: `provisional-keeper-${suffix}`, email: `provisional-keeper-${suffix}@demo.jyaano.test`, fullName: "Synthetic Provisional Storekeeper", role: "storekeeper" }
};

async function ensureSyntheticUsers() {
  const adminApp = getApps()[0] || initializeAdminApp({ projectId: DEMO_EMULATOR_PROJECT_ID });
  const auth = getAdminAuth(adminApp);
  const db = getAdminFirestore(adminApp);
  await Promise.all(Object.values(fixtureUsers).map(async (user) => {
    await auth.createUser({ uid: user.uid, email: user.email, password: "DemoPass!123", displayName: user.fullName, disabled: false });
    await db.collection("users").doc(user.uid).set({ uid: user.uid, email: user.email, fullName: user.fullName, displayName: user.fullName, username: user.uid, role: user.role, active: true, isActive: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), syntheticFixture: true });
  }));
}
async function client(name, email) {
  const app = initializeApp(SYNTHETIC_EMULATOR_FIREBASE_CONFIG, `opening-stock-${name}-${suffix}`);
  apps.push(app);
  const auth = getAuth(app); const db = getFirestore(app); const functions = getFunctions(app, "us-central1");
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080); connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  await signInWithEmailAndPassword(auth, email, "DemoPass!123");
  return { auth, db, call: (name) => httpsCallable(functions, name) };
}
const failCode = (code) => (error) => String(error?.code || "").replace(/^functions\//, "") === code;
await ensureSyntheticUsers();
const admin = await client("admin", fixtureUsers.admin.email);
const sales = await client("sales", fixtureUsers.sales.email);
const manager = await client("manager", fixtureUsers.manager.email);
const keeper = await client("keeper", fixtureUsers.keeper.email);
const productId = `opening-stock-water-${suffix}`;
const provisionalProductId = `provisional-opening-water-${suffix}`;
const provisionalBulkProductId = `provisional-opening-juice-${suffix}`;

try {
  const secure = await getDoc(doc(admin.db, "settings", "secureSales"));
  if (secure.exists() && secure.data()?.enabled === true) throw new Error("This guarded opening-stock integration requires the existing emulator to already be in legacy mode; it never changes secureSales.");
  const tax = await getDoc(doc(admin.db, "settings", "tax"));
  if (!tax.exists()) throw new Error("This guarded opening-stock integration requires existing saved tax settings; it never seeds shared settings.");
  await Promise.all([
    setDoc(doc(admin.db, "products", provisionalProductId), { name: "Synthetic provisional water", category: "Synthetic provisional", quantity: 0, active: true, createdAt: new Date().toISOString() }),
    setDoc(doc(admin.db, "products", provisionalBulkProductId), { name: "Synthetic provisional juice", category: "Synthetic provisional", quantity: 0, active: true, createdAt: new Date().toISOString() })
  ]);
  const provisionalCheck = await sales.call("checkProvisionalOpeningStockEligibility")({ productId: provisionalProductId });
  assert.equal(provisionalCheck.data.eligible, true);
  await assert.rejects(() => setDoc(doc(sales.db, "provisionalOpeningStockProducts", provisionalProductId), { status: "needs_review" }), (error) => error.code === "permission-denied");
  await assert.rejects(() => setDoc(doc(sales.db, "provisionalOpeningStockProducts", provisionalProductId, "revisions", "1"), { revision: 1 }), (error) => error.code === "permission-denied");
  await assert.rejects(() => setDoc(doc(sales.db, "provisionalOpeningStockProducts", provisionalProductId, "reviews", "1"), { revision: 1 }), (error) => error.code === "permission-denied");
  await assert.rejects(() => setDoc(doc(sales.db, "provisionalOpeningStockSaleRequests", `request-${suffix}`), { uid: "demo-sales" }), (error) => error.code === "permission-denied");
  await assert.rejects(() => setDoc(doc(sales.db, "sales", `direct-provisional-${suffix}`), { productId: provisionalProductId, openingStock: true, provisionalOpeningStock: true, items: [] }), (error) => error.code === "permission-denied");
  const provisionalDetails = { baseUnit: "Bottle", saleUnit: "base", unitPricePesewas: 300 };
  const provisionalBulkDetails = { baseUnit: "Bottle", saleUnit: "bulk", bulkUnit: "Carton", unitsPerBulk: 12, unitPricePesewas: 3200 };
  const provisionalItems = [
    { productId: provisionalProductId, quantity: 2, details: provisionalDetails, expectedRevision: 0 },
    { productId: provisionalBulkProductId, quantity: 2, details: provisionalBulkDetails, expectedRevision: 0 }
  ];
  const provisionalQuote = await sales.call("quoteProvisionalOpeningStockSale")({ items: provisionalItems, paymentMethod: "card" });
  const provisionalPayload = { idempotencyKey: `provisional-opening-sale-${suffix}`, items: provisionalItems, paymentMethod: "card", expectedQuoteFingerprint: provisionalQuote.data.quoteFingerprint };
  const provisionalSale = await sales.call("submitProvisionalOpeningStockSale")(provisionalPayload);
  assert.deepEqual((await sales.call("submitProvisionalOpeningStockSale")(provisionalPayload)).data, provisionalSale.data);
  await assert.rejects(() => sales.call("submitProvisionalOpeningStockSale")({ ...provisionalPayload, items: [{ ...provisionalItems[0], quantity: 3 }] }), failCode("already-exists"));
  const provisionalRecord = await getDoc(doc(admin.db, "sales", provisionalSale.data.saleId));
  assert.equal(provisionalRecord.data()?.provisionalOpeningStock, true);
  assert.equal(provisionalRecord.data()?.profit, null);
  assert.equal(provisionalRecord.data()?.items?.length, 2);
  assert.equal(provisionalRecord.data()?.items?.[1]?.baseQuantity, 24);
  assert.equal((await getDoc(doc(admin.db, "provisionalOpeningStockProducts", provisionalProductId))).data()?.revision, 1);
  assert.equal((await getDoc(doc(admin.db, "provisionalOpeningStockProducts", provisionalBulkProductId))).data()?.revision, 1);
  await manager.call("reviewProvisionalOpeningStockProduct")({ productId: provisionalProductId, expectedRevision: 1, decision: "approve", details: { baseUnit: "Bottle", saleUnit: "bulk", bulkUnit: "Carton", unitsPerBulk: 12, unitPricePesewas: 3200 }, approvedBasePricePesewas: 300, approvedBulkPricePesewas: 3200 });
  const approvedProvisionalSetup = await getDoc(doc(admin.db, "openingStockProducts", provisionalProductId));
  assert.equal(approvedProvisionalSetup.data()?.status, "unverified");
  await setDoc(doc(admin.db, "products", productId), { name: "Synthetic opening water", category: "Synthetic opening", baseUnit: "Bottle", bulkUnit: "Pack", unitsPerBulk: 12, quantity: 0, active: true, createdAt: new Date().toISOString() });
  const setup = { productId, baseUnit: "Bottle", bulkUnit: "Pack", unitsPerBulk: 12, basePricePesewas: 300, bulkPricePesewas: 3600, expectedRevision: 0, confirmUncounted: true };
  await assert.rejects(() => sales.call("configureOpeningStockProduct")(setup), failCode("permission-denied"));
  const configured = await admin.call("configureOpeningStockProduct")(setup);
  assert.equal(configured.data.setup.status, "unverified");
  await assert.rejects(() => setDoc(doc(sales.db, "openingStockProducts", productId), { status: "verified" }), (error) => error.code === "permission-denied");
  const quote = await sales.call("quoteOpeningStockSale")({ items: [{ productId, quantity: 2, unit: "bulk" }], paymentMethod: "cash" });
  assert.equal(quote.data.sale.items[0].actualQtySold, 24);
  const salePayload = { idempotencyKey: `opening-stock-sale-${suffix}`, items: [{ productId, quantity: 2, unit: "bulk" }], paymentMethod: "cash", expectedQuoteFingerprint: quote.data.quoteFingerprint };
  const first = await sales.call("submitOpeningStockSale")(salePayload);
  const retry = await sales.call("submitOpeningStockSale")(salePayload);
  assert.deepEqual(retry.data, first.data);
  await assert.rejects(() => sales.call("submitOpeningStockSale")({ ...salePayload, items: [{ productId, quantity: 3, unit: "bulk" }] }), failCode("already-exists"));
  const savedSale = await getDoc(doc(admin.db, "sales", first.data.saleId));
  assert.equal(savedSale.data()?.openingStock, true);
  assert.equal(savedSale.data()?.profit, null);
  assert.equal((await getDoc(doc(admin.db, "products", productId))).data()?.quantity, 0);
  const started = await admin.call("startOpeningStockCount")({ productId, expectedRevision: 1 });
  await assert.rejects(() => sales.call("quoteOpeningStockSale")({ items: [{ productId, quantity: 1, unit: "base" }], paymentMethod: "cash" }), failCode("failed-precondition"));
  await assert.rejects(() => setDoc(doc(sales.db, "products", productId), { quantity: 1 }, { merge: true }), (error) => error.code === "permission-denied");
  await assert.rejects(() => setDoc(doc(keeper.db, "stockReceipts", `opening-receipt-${suffix}`), { productId, quantityReceived: 1 }), (error) => error.code === "permission-denied");
  await assert.rejects(() => keeper.call("recordLegacyStockAdjustment")({ idempotencyKey: `opening-adjustment-${suffix}`, productId, batchId: "", adjustmentType: "Damaged", quantity: 1, unit: "Bottle", reason: "Synthetic", location: "Test", occurredAt: "2026-10-18T10:00" }), failCode("failed-precondition"));
  await admin.call("cancelOpeningStockCount")({ productId, expectedRevision: started.data.count.setupRevision });
  const restarted = await admin.call("startOpeningStockCount")({ productId, expectedRevision: 3 });
  const confirmed = await admin.call("confirmOpeningStockCount")({ productId, expectedRevision: restarted.data.count.setupRevision, batches: [{ reference: "Shelf A", baseQuantity: 12 }, { reference: "Shelf B", baseQuantity: 3 }] });
  assert.equal(confirmed.data.balance.totalBaseQuantity, 15);
  const balance = await getDoc(doc(admin.db, "openingStockBalances", productId));
  assert.equal(balance.data()?.costStatus, "unknown");
  assert.equal(balance.data()?.batches[0]?.expiryDate, null);
  const reloaded = await client("reloaded-sales", fixtureUsers.sales.email);
  const activatedProduct = (await getDoc(doc(reloaded.db, "products", productId))).data();
  assert.equal(activatedProduct?.quantity, 15);
  assert.equal(resolvePersistedProductSellingPrice(activatedProduct, "base"), 3);
  assert.equal(resolvePersistedProductSellingPrice(activatedProduct, "bulk"), 36);
  const normalSaleId = `normal-opening-sale-${suffix}`;
  await runTransaction(reloaded.db, async (transaction) => {
    const productRef = doc(reloaded.db, "products", productId);
    const productSnapshot = await transaction.get(productRef);
    const product = productSnapshot.data();
    const unitPrice = resolvePersistedProductSellingPrice(product, "base");
    assert.equal(unitPrice, 3);
    assert.equal(unitPrice * 3, 9);
    assert.equal(product.quantity, 15);
    transaction.update(productRef, { quantity: product.quantity - 3, updatedAt: new Date().toISOString() });
    transaction.set(doc(reloaded.db, "sales", normalSaleId), {
      id: normalSaleId,
      productId,
      openingStock: false,
      items: [{ productId, quantity: 3, saleUnit: "base", unit: "Bottle", unitPrice, total: unitPrice * 3, actualQtySold: 3, batchAllocations: [{ batchId: balance.data()?.batches[0]?.id, quantity: 3 }] }],
      subtotalAmount: unitPrice * 3,
      createdAt: new Date().toISOString()
    });
  });
  assert.equal((await getDoc(doc(admin.db, "sales", normalSaleId))).data()?.subtotalAmount, 9);
  assert.equal((await getDoc(doc(admin.db, "products", productId))).data()?.quantity, 12);
  const afterSaleReload = await client("after-sale-reload", fixtureUsers.sales.email);
  const afterSaleProduct = (await getDoc(doc(afterSaleReload.db, "products", productId))).data();
  assert.equal(afterSaleProduct?.quantity, 12);
  assert.equal(resolvePersistedProductSellingPrice(afterSaleProduct, "base"), 3);
  assert.equal(resolvePersistedProductSellingPrice(afterSaleProduct, "bulk"), 36);
  await assert.rejects(() => setDoc(doc(sales.db, "openingStockBalances", productId), { productId, totalBaseQuantity: 999 }), (error) => error.code === "permission-denied");
  console.log(`PASS: atomic provisional base-plus-bulk sale/retry/review/direct-write denial plus approved opening-stock setup, quote, count lock, activation/reload, and normal sale balance verified in ${DEMO_EMULATOR_PROJECT_ID}.`);
} finally {
  await Promise.all(apps.map(async (app) => { await terminate(getFirestore(app)); await deleteApp(app); }));
}
